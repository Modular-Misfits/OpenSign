import {
  createHmac,
  createPublicKey,
  verify as verifySignature,
} from 'node:crypto';
import pg from 'pg';

const { Pool } = pg;

const MAX_WEBHOOK_BYTES = 128 * 1024;
const TIMESTAMP_TOLERANCE_SECONDS = 5 * 60;
const REPLAY_INTERVAL_MS = 30_000;
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

let pool;
let replayTimer;
let replayRunning = false;

function databasePool() {
  if (!pool) {
    const connectionString = process.env.DATABASE_URI;
    if (!connectionString?.startsWith('postgres')) {
      throw new Error('DATABASE_URI must be a PostgreSQL connection string');
    }
    pool = new Pool({ connectionString, max: 2 });
  }
  return pool;
}

function base64Bytes(value, expectedLength) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return null;
  try {
    const bytes = Buffer.from(value, 'base64');
    return bytes.length === expectedLength ? bytes : null;
  } catch {
    return null;
  }
}

export function verifyTelnyxRequest(rawBody, signature, timestamp) {
  const timestampSeconds = Number(timestamp);
  if (
    !/^\d{10,13}$/.test(timestamp || '') ||
    !Number.isSafeInteger(timestampSeconds) ||
    Math.abs(Math.floor(Date.now() / 1000) - timestampSeconds) > TIMESTAMP_TOLERANCE_SECONDS
  ) {
    return false;
  }
  const publicKeyBytes = base64Bytes(process.env.TELNYX_PUBLIC_KEY, 32);
  const signatureBytes = base64Bytes(signature, 64);
  if (!publicKeyBytes || !signatureBytes) return false;

  try {
    const publicKey = createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, publicKeyBytes]),
      format: 'der',
      type: 'spki',
    });
    return verifySignature(
      null,
      Buffer.concat([Buffer.from(`${timestamp}|`), rawBody]),
      publicKey,
      signatureBytes
    );
  } catch {
    return false;
  }
}

export function parseTelnyxFailoverEvent(rawBody) {
  let parsed;
  try {
    parsed = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return null;
  }
  const data = parsed?.data;
  const payload = data?.payload;
  if (
    !data ||
    typeof data.id !== 'string' ||
    data.id.length > 200 ||
    data.event_type !== 'message.received' ||
    payload?.direction !== 'inbound'
  ) {
    return null;
  }
  return {
    id: data.id,
    messagingProfileId: payload.messaging_profile_id,
    rawPayload: rawBody.toString('utf8'),
  };
}

function primaryWebhookUrl() {
  const value =
    process.env.TELNYX_PRIMARY_WEBHOOK_URL ||
    'https://misfits.modularmisfits.io/api/nda/webhooks/telnyx';
  const url = new URL(value);
  if (url.protocol !== 'https:') throw new Error('TELNYX_PRIMARY_WEBHOOK_URL must use HTTPS');
  return url.toString();
}

function failoverSignature(eventId, rawPayload) {
  const secret = process.env.TELNYX_FAILOVER_SECRET;
  if (!secret) throw new Error('TELNYX_FAILOVER_SECRET is required');
  return `sha256=${createHmac('sha256', secret)
    .update(`${eventId}|`)
    .update(rawPayload)
    .digest('hex')}`;
}

async function deliverEvent(row) {
  const response = await fetch(primaryWebhookUrl(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'telnyx-signature-ed25519': row.telnyx_signature,
      'telnyx-timestamp': row.telnyx_timestamp,
      'x-portal-telnyx-failover-event': row.event_id,
      'x-portal-telnyx-failover-signature': failoverSignature(row.event_id, row.raw_payload),
    },
    body: row.raw_payload,
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`Portal returned HTTP ${response.status}`);
  }
  await databasePool().query(
    `UPDATE portal_telnyx_failover_events
       SET status = 'delivered', delivered_at = NOW(), updated_at = NOW(), last_error = NULL
     WHERE event_id = $1`,
    [row.event_id]
  );
}

async function markReplayFailed(row, error) {
  const attempts = Number(row.attempts || 0) + 1;
  const delaySeconds = Math.min(900, 30 * 2 ** Math.min(attempts - 1, 5));
  await databasePool().query(
    `UPDATE portal_telnyx_failover_events
       SET status = 'pending', attempts = $2, last_error = $3,
           next_attempt_at = NOW() + ($4 * INTERVAL '1 second'), updated_at = NOW()
     WHERE event_id = $1`,
    [
      row.event_id,
      attempts,
      error instanceof Error ? error.message.slice(0, 500) : 'Unknown delivery error',
      delaySeconds,
    ]
  );
}

async function replayPendingEvents() {
  if (replayRunning) return;
  replayRunning = true;
  try {
    const result = await databasePool().query(
      `SELECT event_id, raw_payload, telnyx_signature, telnyx_timestamp, attempts
       FROM portal_telnyx_failover_events
       WHERE status = 'pending' AND next_attempt_at <= NOW()
       ORDER BY received_at ASC
       LIMIT 20`
    );
    await Promise.all(
      result.rows.map(async row => {
        try {
          await deliverEvent(row);
        } catch (error) {
          await markReplayFailed(row, error);
        }
      })
    );
  } catch (error) {
    console.error('Telnyx failover replay failed:', error);
  } finally {
    replayRunning = false;
  }
}

function startReplayTimer() {
  if (replayTimer || process.env.NODE_ENV === 'test') return;
  replayTimer = setInterval(() => {
    void replayPendingEvents();
  }, REPLAY_INTERVAL_MS);
  replayTimer.unref();
}

function secureConfigurationPresent() {
  const secret = Buffer.from(process.env.TELNYX_FAILOVER_SECRET || '');
  return (
    Boolean(process.env.TELNYX_PUBLIC_KEY) &&
    Boolean(process.env.TELNYX_MESSAGING_PROFILE_ID) &&
    secret.length >= 32
  );
}

export function mountPortalTelnyxFailoverRoutes(app) {
  startReplayTimer();
  app.post('/portal/nda/webhooks/telnyx/failover', async (req, res) => {
    try {
      if (!secureConfigurationPresent()) {
        return res.status(503).json({ code: 'TELNYX_FAILOVER_NOT_CONFIGURED' });
      }
      if (!Buffer.isBuffer(req.body) || req.body.length > MAX_WEBHOOK_BYTES) {
        return res.status(400).json({ code: 'TELNYX_FAILOVER_INVALID_BODY' });
      }
      const signature = req.get('telnyx-signature-ed25519') || '';
      const timestamp = req.get('telnyx-timestamp') || '';
      if (!verifyTelnyxRequest(req.body, signature, timestamp)) {
        return res.status(401).json({ code: 'TELNYX_FAILOVER_UNAUTHORIZED' });
      }
      const event = parseTelnyxFailoverEvent(req.body);
      if (!event) return res.status(200).json({ received: true, actionable: false });
      if (event.messagingProfileId !== process.env.TELNYX_MESSAGING_PROFILE_ID) {
        return res.status(200).json({ received: true, actionable: false });
      }

      await databasePool().query(
        `INSERT INTO portal_telnyx_failover_events (
          event_id, raw_payload, telnyx_signature, telnyx_timestamp
        ) VALUES ($1, $2, $3, $4)
        ON CONFLICT (event_id) DO NOTHING`,
        [event.id, event.rawPayload, signature, timestamp]
      );
      res.status(200).json({ received: true, persisted: true });
      setImmediate(() => {
        void replayPendingEvents();
      });
      return undefined;
    } catch (error) {
      console.error('Telnyx failover webhook failed:', error);
      return res.status(503).json({ code: 'TELNYX_FAILOVER_FAILED' });
    }
  });
}
