// Read-only projection for the dedicated PostgreSQL/local-files installation.
// No ACL, workflow, signing capability, signer identity or Parse doc ID is exposed.
import pg from 'pg';
import { presignedlocalUrl } from '../parsefunction/getSignedUrl.js';

let pool;
const denied = () => new Parse.Error(119, 'Company document access is not enabled for this account.');
const notFound = () => new Parse.Error(101, 'File not available.');
const handle = 'encode(sha256(convert_to(d."objectId", \'UTF8\')), \'hex\')';
const scope = `FROM "contracts_Document" d
  JOIN "contracts_Users" owner ON owner."UserId" = d."CreatedBy"
    AND owner."OrganizationId" = $1
    AND (d."ExtUserPtr" = owner."objectId" OR d."ExtUserPtr" IS NULL)
  WHERE d."Type" IS DISTINCT FROM 'Folder'
    AND NOT EXISTS (SELECT 1 FROM "contracts_Users" other
      WHERE other."UserId" = owner."UserId" AND other."objectId" <> owner."objectId")`;
const actorSql = `SELECT count(*) = 1 AND bool_and("OrganizationId" IS NOT DISTINCT FROM $1
    AND "IsDisabled" IS DISTINCT FROM true) AS allowed
  FROM "contracts_Users" WHERE "UserId" = $2`;

function localArtifact(raw) {
  if (!raw) return null;
  const base = new URL(process.env.SERVER_URL);
  if (base.protocol !== 'https:' || process.env.USE_LOCAL !== 'true') return null;
  // Accept exactly a local Parse file, ignoring an old JWT in storage. Never
  // sign user-supplied URLs, remote destinations, escaped paths or other apps.
  const prefix = base.origin + base.pathname.replace(/\/$/, '') + '/files/' + process.env.APP_ID + '/';
  const url = raw.split('?')[0];
  const file = url.slice(prefix.length);
  if (!url.startsWith(prefix) || !/^[A-Za-z0-9_-][A-Za-z0-9_.-]*$/.test(file)) return null;
  return url;
}

export async function companyDocuments(request) {
  const { action = 'list', after = '', key, kind } = request.params || {};
  const org = process.env.COMPANY_DOCUMENT_ORG_ID;
  const reader = process.env.COMPANY_DOCUMENT_READER_ID;
  const actor = request.user?.id;
  if (!org || !reader || actor !== reader) {
    if (action === 'access') return { allowed: false };
    throw denied();
  }
  pool ||= new pg.Pool({ connectionString: process.env.DATABASE_URI, max: 2, idleTimeoutMillis: 10000 });
  const db = await pool.connect();
  try {
    await db.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const { rows: [access] } = await db.query(actorSql, [org, actor]);
    if (action === 'access') return { allowed: access.allowed === true };
    if (!access.allowed) throw denied();
    if (action === 'list') {
      if (typeof after !== 'string' || (after && !/^[a-f0-9]{64}$/.test(after))) {
        throw new Parse.Error(102, 'Invalid page cursor.');
      }
      const { rows } = await db.query(`SELECT ${handle} AS key, d."Name" AS title,
        owner."Name" AS owner, d."updatedAt" AS updated, d."IsArchive" IS TRUE AS archived,
        CASE WHEN d."IsDeclined" THEN 'Declined' WHEN d."IsCompleted" THEN 'Completed'
          WHEN nullif(d."SignedUrl",'') IS NULL THEN 'Draft'
          WHEN d."ExpiryDate" < now() THEN 'Expired' ELSE 'In progress' END AS status,
        coalesce(nullif(d."SignedUrl",''),d."URL") AS pdf, d."CertificateUrl" AS certificate
        ${scope} AND ${handle} > $2 ORDER BY key LIMIT 51`, [org, after]);
      const page = rows.slice(0, 50);
      return {
        documents: page.map(({ pdf, certificate, ...row }) => ({
          ...row, hasPdf: !!localArtifact(pdf), hasCertificate: !!localArtifact(certificate),
        })),
        next: rows.length > 50 ? page.at(-1).key : null,
      };
    }
    if (action !== 'open' || typeof key !== 'string' || !/^[a-f0-9]{64}$/.test(key) ||
        !['pdf', 'certificate'].includes(kind)) throw new Parse.Error(102, 'Invalid file request.');
    const { rows } = await db.query(`SELECT coalesce(nullif(d."SignedUrl",''),d."URL") AS pdf,
      d."CertificateUrl" AS certificate ${scope} AND ${handle} = $2 LIMIT 2`, [org, key]);
    const url = rows.length === 1 && localArtifact(rows[0][kind]);
    if (!url) throw notFound();
    return { url: presignedlocalUrl(url, 120) };
  } finally {
    // No statement in this endpoint may change a row, even inadvertently.
    try { await db.query('ROLLBACK'); } catch (err) { db.release(true); throw err; }
    db.release();
  }
}
