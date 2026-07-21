import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import test from 'node:test';

import {
  parseTelnyxFailoverEvent,
  verifyTelnyxRequest,
} from '../cloud/customRoute/portalTelnyxFailover.js';

test('verifies a fresh Telnyx Ed25519 webhook and rejects a stale timestamp', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicDer = publicKey.export({ format: 'der', type: 'spki' });
  process.env.TELNYX_PUBLIC_KEY = publicDer.subarray(-32).toString('base64');
  const rawBody = Buffer.from(JSON.stringify({ data: { id: 'event-1' } }));
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = sign(null, Buffer.concat([Buffer.from(`${timestamp}|`), rawBody]), privateKey)
    .toString('base64');

  assert.equal(verifyTelnyxRequest(rawBody, signature, timestamp), true);
  assert.equal(verifyTelnyxRequest(rawBody, signature, String(Number(timestamp) - 301)), false);
});

test('parses only an inbound message for the expected failover shape', () => {
  const rawBody = Buffer.from(
    JSON.stringify({
      data: {
        id: 'event-1',
        event_type: 'message.received',
        payload: {
          direction: 'inbound',
          messaging_profile_id: 'profile-1',
        },
      },
    })
  );

  assert.deepEqual(parseTelnyxFailoverEvent(rawBody), {
    id: 'event-1',
    messagingProfileId: 'profile-1',
    rawPayload: rawBody.toString('utf8'),
  });
});
