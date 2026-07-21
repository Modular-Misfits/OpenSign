import { randomBytes, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';

import sendSystemMail from '../parsefunction/sendSystemMail.js';
import { presignedlocalUrl } from '../parsefunction/getSignedUrl.js';

const COMPANY_KEYS = new Set(['mm', 'cycrypt', 'xpress']);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const REQUEST_ID_RE = /^nda_[0-9a-f-]{36}$/i;
const MAX_PDF_BYTES = 25 * 1024 * 1024;
let layoutPromise;

class PortalRequestError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function secureEqual(received, expected) {
  const left = Buffer.from(received || '');
  const right = Buffer.from(expected || '');
  return left.length === right.length && timingSafeEqual(left, right);
}

function authorize(req, _res, next) {
  const expected = process.env.PORTAL_BRIDGE_SECRET;
  const received = req.get('authorization') || '';
  if (!expected || !secureEqual(received, `Bearer ${expected}`)) {
    return next(new PortalRequestError(401, 'PORTAL_UNAUTHORIZED', 'Unauthorized'));
  }
  return next();
}

function requiredString(value, field, maxLength) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new PortalRequestError(400, 'PORTAL_INVALID_REQUEST', `${field} is required`);
  }
  const normalized = value.trim().replace(/\r\n?/g, '\n');
  if (normalized.length > maxLength) {
    throw new PortalRequestError(
      400,
      'PORTAL_INVALID_REQUEST',
      `${field} must be ${maxLength} characters or fewer`
    );
  }
  return normalized;
}

function requiredEmail(value, field) {
  const email = requiredString(value, field, 320).toLowerCase();
  if (!EMAIL_RE.test(email)) {
    throw new PortalRequestError(400, 'PORTAL_INVALID_REQUEST', `${field} is invalid`);
  }
  return email;
}

function validatePayload(body) {
  const requestId = requiredString(body?.requestId, 'requestId', 80);
  const ndaCompany = requiredString(body?.ndaCompany, 'ndaCompany', 20);
  if (!REQUEST_ID_RE.test(requestId) || !COMPANY_KEYS.has(ndaCompany)) {
    throw new PortalRequestError(400, 'PORTAL_INVALID_REQUEST', 'NDA request is invalid');
  }
  const input = {
    requestId,
    ndaCompany,
    companyName: requiredString(body.companyName, 'companyName', 200),
    companyAddress: requiredString(body.companyAddress, 'companyAddress', 500),
    companyPoc: requiredString(body.companyPoc, 'companyPoc', 200),
    companyPocEmail: requiredEmail(body.companyPocEmail, 'companyPocEmail'),
    internalPoc: requiredString(body.internalPoc, 'internalPoc', 200),
    internalPocEmail: requiredEmail(body.internalPocEmail, 'internalPocEmail'),
  };
  if (input.companyPocEmail === input.internalPocEmail) {
    throw new PortalRequestError(
      400,
      'PORTAL_INVALID_REQUEST',
      'The counterparty and internal signer must use different email addresses'
    );
  }
  return input;
}

async function loadLayout() {
  if (!layoutPromise) {
    const configPath = process.env.PORTAL_TEMPLATE_CONFIG;
    if (!configPath) throw new Error('PORTAL_TEMPLATE_CONFIG is required');
    layoutPromise = fs.readFile(configPath, 'utf8').then(JSON.parse);
  }
  return layoutPromise;
}

function pointer(className, objectId) {
  return { __type: 'Pointer', className, objectId };
}

function referenceId(value) {
  if (typeof value === 'string' && value) return value;
  return value?.id || value?.objectId || null;
}

function normalizeEmail(email) {
  return email.trim().toLowerCase();
}

async function getOrCreateUser({ email, name }) {
  const normalizedEmail = normalizeEmail(email);
  const query = new Parse.Query(Parse.User);
  query.equalTo('username', normalizedEmail);
  let user = await query.first({ useMasterKey: true });
  if (user) return user;

  user = new Parse.User();
  user.set('username', normalizedEmail);
  user.set('email', normalizedEmail);
  user.set('normalizedEmail', normalizedEmail);
  user.set('name', name);
  user.set('password', randomBytes(32).toString('base64url'));
  return user.save(null, { useMasterKey: true });
}

async function getOwner() {
  const email = requiredEmail(process.env.PORTAL_OWNER_EMAIL, 'PORTAL_OWNER_EMAIL');
  const name = process.env.PORTAL_OWNER_NAME || 'Modular Misfits Agreements';
  const company = process.env.PORTAL_OWNER_COMPANY || 'Modular Misfits';
  const user = await getOrCreateUser({ email, name });
  const userPtr = pointer('_User', user.id);

  const extQuery = new Parse.Query('contracts_Users');
  extQuery.equalTo('UserId', userPtr);
  extQuery.include('TenantId');
  let extUser = await extQuery.first({ useMasterKey: true });
  if (extUser) return { user, extUser };

  const tenant = new Parse.Object('partners_Tenant');
  tenant.set('UserId', userPtr);
  tenant.set('TenantName', company);
  tenant.set('EmailAddress', email);
  tenant.set('IsActive', true);
  tenant.set('CreatedBy', userPtr);
  await tenant.save(null, { useMasterKey: true });

  extUser = new Parse.Object('contracts_Users');
  extUser.set('UserId', userPtr);
  extUser.set('UserRole', 'contracts_Admin');
  extUser.set('Email', email);
  extUser.set('Name', name);
  extUser.set('Company', company);
  extUser.set('TenantId', pointer('partners_Tenant', tenant.id));
  await extUser.save(null, { useMasterKey: true });
  return { user, extUser };
}

async function getOrCreateContact({ owner, email, name, company }) {
  const normalizedEmail = normalizeEmail(email);
  const ownerPtr = pointer('_User', owner.user.id);
  const tenantId = referenceId(owner.extUser.get('TenantId'));
  if (!tenantId) throw new Error('Portal owner tenant is missing');
  const query = new Parse.Query('contracts_Contactbook');
  query.equalTo('CreatedBy', ownerPtr);
  query.equalTo('Email', normalizedEmail);
  query.notEqualTo('IsDeleted', true);
  query.include('UserId,TenantId');
  let contact = await query.first({ useMasterKey: true });
  if (contact) {
    let guestId = referenceId(contact.get('UserId'));
    if (!guestId) {
      const guest = await getOrCreateUser({ email: normalizedEmail, name });
      guestId = guest.id;
    }
    contact.set('Name', name);
    contact.set('Company', company);
    contact.set('IsDeleted', false);
    contact.set('IsImported', false);
    contact.set('CreatedBy', ownerPtr);
    contact.set('UserId', pointer('_User', guestId));
    contact.set('TenantId', pointer('partners_Tenant', tenantId));
    const acl = new Parse.ACL();
    acl.setReadAccess(owner.user.id, true);
    acl.setWriteAccess(owner.user.id, true);
    acl.setReadAccess(guestId, true);
    acl.setWriteAccess(guestId, true);
    contact.setACL(acl);
    return contact.save(null, { useMasterKey: true });
  }

  const guest = await getOrCreateUser({ email: normalizedEmail, name });
  contact = new Parse.Object('contracts_Contactbook');
  contact.set('Name', name);
  contact.set('Email', normalizedEmail);
  contact.set('Company', company);
  contact.set('UserRole', 'contracts_Guest');
  contact.set('IsDeleted', false);
  contact.set('IsImported', false);
  contact.set('CreatedBy', ownerPtr);
  contact.set('UserId', pointer('_User', guest.id));
  contact.set('TenantId', pointer('partners_Tenant', tenantId));
  const acl = new Parse.ACL();
  acl.setReadAccess(owner.user.id, true);
  acl.setWriteAccess(owner.user.id, true);
  acl.setReadAccess(guest.id, true);
  acl.setWriteAccess(guest.id, true);
  contact.setACL(acl);
  return contact.save(null, { useMasterKey: true });
}

function formatEffectiveDate() {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date());
}

function fieldValue(field, input, companyConfig) {
  switch (field.value) {
    case 'effectiveDate':
      return formatEffectiveDate();
    case 'companyName':
      return input.companyName;
    case 'companyAddress':
      return input.companyAddress;
    case 'internalCompanyName':
      return companyConfig.internalCompanyName;
    default:
      throw new Error(`Unknown prefill field value ${field.value}`);
  }
}

async function preparePdf(companyConfig) {
  const templateRoot = process.env.PORTAL_TEMPLATE_DIR;
  if (!templateRoot) throw new Error('PORTAL_TEMPLATE_DIR is required');
  const pdfPath = path.resolve(templateRoot, companyConfig.pdf);
  const expectedRoot = `${path.resolve(templateRoot)}${path.sep}`;
  if (!pdfPath.startsWith(expectedRoot)) throw new Error('Template path escapes template directory');
  const bytes = await fs.readFile(pdfPath);
  if (bytes.length > MAX_PDF_BYTES) throw new Error('NDA template exceeds maximum size');

  const pdf = await PDFDocument.load(bytes);
  const fields = [
    ...companyConfig.prefill,
    ...companyConfig.signers.counterparty,
    ...companyConfig.signers.internal,
  ];
  for (const field of fields) {
    const page = pdf.getPage(field.page - 1);
    if (!page) throw new Error(`Template page ${field.page} does not exist`);
    const { width, height } = page.getSize();
    if (Math.abs(width - 612) > 0.5 || Math.abs(height - 792) > 0.5) {
      throw new Error(`Template page ${field.page} is not US Letter size`);
    }
    if (
      field.x < 0 ||
      field.y < 0 ||
      field.width <= 0 ||
      field.height <= 0 ||
      field.x + field.width > 100 ||
      field.y + field.height > 100
    ) {
      throw new Error(`Template field on page ${field.page} is outside the page`);
    }
  }
  return bytes;
}

function widgetOptions(field, signer, index) {
  const base = {
    name: `${field.type}-${signer.id}-${index + 1}`,
    status: field.required === false ? 'optional' : 'required',
    fontSize: field.fontSize || 9,
    fontColor: 'black',
  };
  if (field.isReadOnly) {
    return {
      ...base,
      status: 'optional',
      defaultValue: field.defaultValue,
      isReadOnly: true,
      isHideLabel: true,
    };
  }
  if (field.type === 'name') return { ...base, defaultValue: signer.name };
  if (field.type === 'email') {
    return {
      ...base,
      defaultValue: signer.email,
      validation: { type: 'email', pattern: '' },
    };
  }
  if (field.type === 'date') {
    return {
      ...base,
      isSigningDate: true,
      validation: { type: 'date-format', format: 'MM/dd/yyyy' },
    };
  }
  if (field.type === 'job title') return { ...base, defaultValue: '' };
  return base;
}

function buildPlaceholder({ role, signer, fields, color }) {
  const pages = new Map();
  fields.forEach((field, index) => {
    const width = (field.width / 100) * 612;
    const height = (field.height / 100) * 792;
    const entry = {
      xPosition: (field.x / 100) * 612,
      yPosition: (field.y / 100) * 792,
      key: `${signer.id}-${index + 1}`,
      scale: 1,
      zIndex: index + 1,
      type: field.type,
      options: widgetOptions(field, signer, index),
      Width: width,
      Height: height,
    };
    const page = pages.get(field.page) || [];
    page.push(entry);
    pages.set(field.page, page);
  });
  return {
    Id: signer.id,
    Role: 'signer',
    SignerRole: 'signer',
    Name: role,
    blockColor: color,
    signerPtr: pointer('contracts_Contactbook', signer.id),
    signerObjId: signer.id,
    email: signer.email,
    placeHolder: Array.from(pages, ([pageNumber, pos]) => ({ pageNumber, pos })),
  };
}

function publicRoot() {
  const value = process.env.PUBLIC_URL || process.env.SERVER_URL;
  const url = new URL(value);
  return url.origin;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

async function sendInitialSignerEmail(document, signer) {
  if (document.get('PortalInitialMailSentAt')) return;
  const token = Buffer.from(`${document.id}/${signer.email}/${signer.id}/true`, 'utf8').toString(
    'base64'
  );
  const signingUrl = `${publicRoot()}/login/${encodeURIComponent(token)}`;
  const senderName = document.get('SenderName') || 'Modular Misfits Agreements';
  const senderEmail = document.get('SenderMail') || process.env.PORTAL_OWNER_EMAIL;
  const title = document.get('Name');
  const subject = `${senderName} has requested your signature on ${title}`;
  const text = `Hello ${signer.name},

${senderName} has requested your signature on ${title}.

Review and sign the NDA:
${signingUrl}

This signing link is unique to you. Do not forward it.`;
  const result = await sendSystemMail({
    params: {
      extUserId: document.get('ExtUserPtr')?.id,
      recipient: signer.email,
      subject,
      from: senderName,
      replyto: senderEmail,
      text,
      html: `<!doctype html>
        <html lang="en">
          <body style="margin:0;padding:0;background:#f4f6f8;color:#18202a;font-family:Arial,Helvetica,sans-serif;">
            <div style="display:none;max-height:0;overflow:hidden;opacity:0;">A mutual NDA is ready for your review and signature.</div>
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f6f8;padding:32px 16px;">
              <tr>
                <td align="center">
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#ffffff;border:1px solid #dfe5ea;border-radius:12px;">
                    <tr>
                      <td style="padding:32px;">
                        <p style="margin:0 0 24px;color:#16878a;font-size:14px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;">Modular Misfits Agreements</p>
                        <h1 style="margin:0 0 20px;color:#101820;font-size:26px;line-height:1.25;">Signature requested</h1>
                        <p style="margin:0 0 16px;font-size:16px;line-height:1.6;">Hello ${escapeHtml(signer.name)},</p>
                        <p style="margin:0 0 24px;font-size:16px;line-height:1.6;">${escapeHtml(senderName)} has requested your signature on <strong>${escapeHtml(title)}</strong>.</p>
                        <p style="margin:0 0 28px;">
                          <a href="${escapeHtml(signingUrl)}" style="display:inline-block;background:#16878a;color:#ffffff;text-decoration:none;font-size:16px;font-weight:700;line-height:1;padding:14px 22px;border-radius:8px;">Review and sign the NDA</a>
                        </p>
                        <p style="margin:0;color:#596673;font-size:13px;line-height:1.6;">This secure signing link is unique to you. Do not forward it.</p>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </body>
        </html>`,
    },
  });
  if (result?.status !== 'success') {
    throw new PortalRequestError(502, 'OPENSIGN_EMAIL_FAILED', 'The signing email could not be sent');
  }
  document.set('PortalInitialMailSentAt', new Date());
  await document.save(null, { useMasterKey: true });
}

function serializeDocument(document) {
  return {
    id: document.id,
    externalId: document.get('PortalRequestId'),
    title: document.get('Name'),
    status: document.get('IsDeclined')
      ? 'DECLINED'
      : document.get('IsCompleted')
        ? 'COMPLETED'
        : 'PENDING',
    completedAt: document.get('IsCompleted') ? document.updatedAt?.toISOString() : null,
    certificateAvailable: Boolean(document.get('CertificateUrl')),
  };
}

async function queryPortalDocument(documentId) {
  const query = new Parse.Query('contracts_Document');
  query.equalTo('objectId', documentId);
  query.exists('PortalRequestId');
  query.include('ExtUserPtr,Signers');
  const document = await query.first({ useMasterKey: true });
  if (!document) throw new PortalRequestError(404, 'OPENSIGN_DOCUMENT_NOT_FOUND', 'Document not found');
  return document;
}

async function createDocument(input) {
  const duplicateQuery = new Parse.Query('contracts_Document');
  duplicateQuery.equalTo('PortalRequestId', input.requestId);
  duplicateQuery.include('ExtUserPtr,Signers');
  const duplicate = await duplicateQuery.first({ useMasterKey: true });
  if (duplicate) {
    const firstSigner = duplicate.get('Signers')?.[0];
    if (firstSigner) {
      await sendInitialSignerEmail(duplicate, {
        id: firstSigner.id,
        email: firstSigner.get('Email'),
        name: firstSigner.get('Name'),
      });
    }
    return duplicate;
  }

  const layout = await loadLayout();
  const companyConfig = layout[input.ndaCompany];
  if (!companyConfig) {
    throw new PortalRequestError(500, 'OPENSIGN_TEMPLATE_MISSING', 'NDA template is missing');
  }
  const owner = await getOwner();
  const counterparty = await getOrCreateContact({
    owner,
    email: input.companyPocEmail,
    name: input.companyPoc,
    company: input.companyName,
  });
  const internal = await getOrCreateContact({
    owner,
    email: input.internalPocEmail,
    name: input.internalPoc,
    company: companyConfig.internalCompanyName,
  });
  const pdfBytes = await preparePdf(companyConfig);
  const filename = `${input.ndaCompany}-mutual-nda-${input.requestId}.pdf`;
  const file = new Parse.File(filename, { base64: pdfBytes.toString('base64') }, 'application/pdf');
  await file.save({ useMasterKey: true });

  const signers = [counterparty, internal];
  const signerData = [
    { id: counterparty.id, email: input.companyPocEmail, name: input.companyPoc },
    { id: internal.id, email: input.internalPocEmail, name: input.internalPoc },
  ];
  const prefillFields = companyConfig.prefill.map(field => ({
    ...field,
    type: 'text',
    required: false,
    isReadOnly: true,
    defaultValue: fieldValue(field, input, companyConfig),
  }));
  const placeholders = [
    buildPlaceholder({
      role: 'Counterparty signer',
      signer: signerData[0],
      fields: [...prefillFields, ...companyConfig.signers.counterparty],
      color: '#45BFC2',
    }),
    buildPlaceholder({
      role: `${companyConfig.shortName} signer`,
      signer: signerData[1],
      fields: companyConfig.signers.internal,
      color: '#A855F7',
    }),
  ];

  const document = new Parse.Object('contracts_Document');
  const ownerPtr = pointer('_User', owner.user.id);
  document.set('Name', `${companyConfig.shortName} Mutual NDA - ${input.companyName}`);
  document.set('Note', 'Please review and sign this mutual non-disclosure agreement.');
  document.set('URL', file.url());
  document.set('SignedUrl', file.url());
  document.set('CreatedBy', ownerPtr);
  document.set('ExtUserPtr', pointer('contracts_Users', owner.extUser.id));
  document.set('Signers', signers.map(signer => pointer('contracts_Contactbook', signer.id)));
  document.set('Placeholders', placeholders);
  document.set('SentToOthers', true);
  document.set('SendinOrder', true);
  document.set('SendInOrderStrict', true);
  document.set('TimeToCompleteDays', 15);
  document.set('AutomaticReminders', false);
  document.set('IsEnableOTP', false);
  document.set('SendMail', true);
  document.set('IsSendMail', true);
  document.set('DocSentAt', new Date());
  document.set('SenderName', process.env.PORTAL_OWNER_NAME || 'Modular Misfits Agreements');
  document.set('SenderMail', process.env.PORTAL_OWNER_EMAIL);
  document.set('PortalRequestId', input.requestId);
  document.set('PortalNdaCompany', input.ndaCompany);
  const acl = new Parse.ACL();
  acl.setReadAccess(owner.user.id, true);
  acl.setWriteAccess(owner.user.id, true);
  for (const signer of signers) {
    const userId = referenceId(signer.get('UserId'));
    if (userId) {
      acl.setReadAccess(userId, true);
      acl.setWriteAccess(userId, true);
    }
  }
  document.setACL(acl);
  await document.save(null, { useMasterKey: true });
  await sendInitialSignerEmail(document, signerData[0]);
  return document;
}

async function fetchStoredPdf(url) {
  if (!url) throw new PortalRequestError(409, 'OPENSIGN_PDF_NOT_READY', 'PDF is not ready');
  let fetchUrl = url;
  if (url.includes('/files/')) {
    const signedUrl = new URL(presignedlocalUrl(url, 60));
    const internal = new URL(signedUrl.toString());
    internal.protocol = 'http:';
    internal.hostname = '127.0.0.1';
    internal.port = String(process.env.PORT || 8080);
    internal.pathname = internal.pathname.replace(/^\/api(?=\/app\/files\/)/, '');
    fetchUrl = internal.toString();
  }
  const response = await fetch(fetchUrl, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) {
    throw new PortalRequestError(502, 'OPENSIGN_PDF_DOWNLOAD_FAILED', 'PDF download failed');
  }
  const length = Number(response.headers.get('content-length') || 0);
  if (length > MAX_PDF_BYTES) {
    throw new PortalRequestError(413, 'OPENSIGN_PDF_TOO_LARGE', 'PDF exceeds maximum size');
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_PDF_BYTES || bytes.subarray(0, 5).toString() !== '%PDF-') {
    throw new PortalRequestError(502, 'OPENSIGN_INVALID_PDF', 'Stored document is not a PDF');
  }
  return bytes;
}

export function mountPortalNdaRoutes(app) {
  app.post('/portal/v1/nda', authorize, async (req, res, next) => {
    try {
      const document = await createDocument(validatePayload(req.body));
      res.status(201).json(serializeDocument(document));
    } catch (error) {
      next(error);
    }
  });

  app.get('/portal/v1/nda/:documentId', authorize, async (req, res, next) => {
    try {
      res.json(serializeDocument(await queryPortalDocument(req.params.documentId)));
    } catch (error) {
      next(error);
    }
  });

  app.get('/portal/v1/nda/:documentId/download', authorize, async (req, res, next) => {
    try {
      const document = await queryPortalDocument(req.params.documentId);
      if (!document.get('IsCompleted')) {
        throw new PortalRequestError(409, 'OPENSIGN_DOCUMENT_NOT_COMPLETED', 'Document is not completed');
      }
      const kind = req.query.kind === 'certificate' ? 'certificate' : 'signed';
      const url = kind === 'certificate' ? document.get('CertificateUrl') : document.get('SignedUrl');
      const bytes = await fetchStoredPdf(url);
      res.set({
        'Content-Type': 'application/pdf',
        'Content-Length': String(bytes.length),
        'Cache-Control': 'no-store',
        'Content-Disposition': `attachment; filename="${kind}-${document.id}.pdf"`,
      });
      res.send(bytes);
    } catch (error) {
      next(error);
    }
  });

  app.use((error, _req, res, _next) => {
    void _next;
    const status = Number(error?.status) || 500;
    const code = error?.code || 'OPENSIGN_INTERNAL_ERROR';
    if (status >= 500) console.error('Portal NDA bridge error:', error);
    res.status(status).json({ code, error: status >= 500 ? 'Signing service failed' : error.message });
  });
}
