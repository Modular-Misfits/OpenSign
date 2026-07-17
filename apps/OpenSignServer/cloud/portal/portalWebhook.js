import { createHmac } from 'node:crypto';

const RETRY_DELAYS_MS = [0, 500, 1500];

function sleep(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

export async function deliverPortalWebhook({ event, document }) {
  const url = process.env.PORTAL_WEBHOOK_URL;
  const secret = process.env.PORTAL_WEBHOOK_SECRET;
  const externalId = document?.get?.('PortalRequestId');
  if (!url || !secret || !externalId) return;

  const auditCount = document?.get?.('AuditTrail')?.length || 0;
  const eventId = `${document.id}:${event}:${event === 'DOCUMENT_SIGNED' ? auditCount : 'final'}`;
  const body = JSON.stringify({
    id: eventId,
    event,
    createdAt: new Date().toISOString(),
    payload: {
      documentId: document.id,
      externalId,
      status: document.get('IsDeclined')
        ? 'DECLINED'
        : document.get('IsCompleted')
          ? 'COMPLETED'
          : 'PENDING',
    },
  });
  const signature = createHmac('sha256', secret).update(body).digest('hex');

  let lastError;
  for (const delay of RETRY_DELAYS_MS) {
    if (delay) await sleep(delay);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-OpenSign-Signature': `sha256=${signature}`,
        },
        body,
        signal: AbortSignal.timeout(10_000),
      });
      if (response.ok) return;
      lastError = new Error(`Portal webhook returned HTTP ${response.status}`);
      if (response.status < 500 && response.status !== 429) break;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('Portal webhook delivery failed');
}
