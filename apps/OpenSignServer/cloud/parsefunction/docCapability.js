import crypto from 'node:crypto';

/**
 * Document capability tokens.
 *
 * SECURITY (MM-02). `getDocument` and `getcontact` return a full document or
 * contact to anyone who knows an objectId. Parse objectIds are short, appear in
 * invitation URLs, and leak through browser history, referrers, proxy logs and
 * forwarded mail — so "knows the id" is not an authorization decision.
 *
 * A capability token binds a link to one (document, signer) pair with an expiry
 * and an HMAC, so possessing the id is no longer sufficient: the holder must
 * also possess a token this server issued.
 *
 * Deliberately stateless. The token is an HMAC over its own claims, so there is
 * no table to migrate, no row per invitation, and nothing to clean up. It cannot
 * be revoked individually — rotating DOC_CAPABILITY_KEY invalidates all of them
 * at once, which is the intended blunt instrument.
 *
 * NOT a replacement for signer authorization: anyone holding a valid link can
 * still act as that signer. That is inherent to emailed guest links, and is
 * tracked separately from this.
 */

export const CAPABILITY_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// Reuse the dedicated-secret pattern established for file URLs. Falls back to
// MASTER_KEY so a deployment that has not set the secret still functions.
function capabilityKey() {
  return process.env.DOC_CAPABILITY_KEY || process.env.FILE_URL_SIGNING_KEY || process.env.MASTER_KEY;
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Mint a token for one (docId, contactId) pair.
 * `contactId` may be empty for links that address the document as a whole.
 */
export function mintCapability(docId, contactId, ttlMs = CAPABILITY_TTL_MS) {
  const exp = Date.now() + ttlMs;
  const payload = `${docId}.${contactId || ''}.${exp}`;
  const sig = crypto.createHmac('sha256', capabilityKey()).update(payload).digest();
  return `${exp}.${b64url(sig).slice(0, 32)}`;
}

/**
 * Does `token` authorize access to this (docId, contactId)?
 *
 * Returns false for anything malformed, expired, or signed for a different
 * document or signer. Comparison is constant-time.
 */
export function verifyCapability(token, docId, contactId) {
  if (!token || typeof token !== 'string') return false;
  const dot = token.indexOf('.');
  if (dot < 1) return false;

  const exp = Number(token.slice(0, dot));
  const provided = token.slice(dot + 1);
  if (!Number.isFinite(exp) || exp < Date.now()) return false;

  const payload = `${docId}.${contactId || ''}.${exp}`;
  const expected = b64url(
    crypto.createHmac('sha256', capabilityKey()).update(payload).digest()
  ).slice(0, 32);

  const A = Buffer.from(provided, 'utf8');
  const B = Buffer.from(expected, 'utf8');
  if (A.length !== B.length || A.length === 0) return false;
  return crypto.timingSafeEqual(A, B);
}

/**
 * Is capability enforcement switched on?
 *
 * Off by default, and that is deliberate. Invitation links already sitting in
 * external counterparties' inboxes carry no token; enforcing on day one would
 * 403 them and break signing for real people mid-agreement. Operators turn this
 * on once outstanding links have been reissued or have completed.
 */
export function capabilityRequired() {
  return String(process.env.DOC_CAPABILITY_REQUIRED || '').toLowerCase() === 'true';
}

/**
 * Cloud function: mint a capability for a (docId, contactId) the caller is
 * entitled to link. Requires a session — only the sending side builds links.
 */
export async function issueCapability(request) {
  if (!request?.user) {
    throw new Parse.Error(Parse.Error.INVALID_SESSION_TOKEN, 'User is not authenticated.');
  }
  const docId = request.params?.docId;
  const contactId = request.params?.contactId || '';
  if (!docId) {
    throw new Parse.Error(Parse.Error.INVALID_QUERY, 'docId is required.');
  }
  // Only for documents that exist; do not mint tokens for arbitrary strings.
  const doc = await new Parse.Query('contracts_Document')
    .select(['objectId'])
    .get(docId, { useMasterKey: true })
    .catch(() => null);
  if (!doc) {
    throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'Document not found.');
  }
  return { capability: mintCapability(docId, contactId), expiresInMs: CAPABILITY_TTL_MS };
}
