// Private read-only Word originals. Never query signing records or accept file paths.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import pg from 'pg';

const catalog = [
  ['mm', 'Modular Misfits', 'ModularMisfits_Mutual_NDA_Template.docx', '8e6d2a7b7fde7dcd88619e55e5f5f7c19a12c4bd7e5ccfdd6f27554215890510'],
  ['cycrypt', 'CyCrypt', 'CyCrypt_Mutual_NDA_Template.docx', 'a4c29e86575229402b48eb276e0282f5d89c9e1ce15901f537232ae6c7af09ba'],
  ['xpress', 'Xpress Group', 'XpressGroup_Mutual_NDA_Template.docx', 'ff557feac0d28e680367bf4533dcb3e39cc14b1a1d1e31feaacc7cc58ccff8c0'],
];
let pool;
async function activeMember(actor, org) {
  pool ||= new pg.Pool({ connectionString: process.env.DATABASE_URI, max: 2, idleTimeoutMillis: 10000 });
  const { rows } = await pool.query(`SELECT count(*)=1 AND bool_and("OrganizationId" IS NOT DISTINCT FROM $2
    AND "IsDisabled" IS DISTINCT FROM true) AS allowed FROM "contracts_Users" WHERE "UserId"=$1`, [actor, org]);
  return rows[0]?.allowed === true;
}
export async function blankNdaTemplates(request) {
  const denied = () => new Parse.Error(119, 'Blank Word template access is not enabled for this account.');
  const unavailable = () => new Parse.Error(101, 'The blank Word template is unavailable.');
  const { action = 'list', key } = request.params || {};
  const actor = request.user?.id;
  const config = process.env.PORTAL_TEMPLATE_CONFIG;
  const org = process.env.COMPANY_DOCUMENT_ORG_ID;
  const reader = process.env.COMPANY_DOCUMENT_READER_ID;
  if (!actor) throw denied();
  const deny = () => { if (action === 'list') return { templates: [] }; throw denied(); };
  if (!config || !org || !path.isAbsolute(config)) return deny();
  const dir = path.join(path.dirname(config), 'blank-word');
  if (actor !== reader) {
    let owner;
    try { owner = (await readFile(path.join(dir, 'owner-id'), 'utf8')).trim(); }
    catch { return deny(); }
    if (actor !== owner) return deny();
  }
  if (!(await activeMember(actor, org))) return deny();

  async function load(row) {
    let bytes;
    try { bytes = await readFile(path.join(dir, row[0] + '.docx')); }
    catch { throw unavailable(); }
    if (createHash('sha256').update(bytes).digest('hex') !== row[3]) throw unavailable();
    return bytes;
  }
  if (action === 'list') {
    // Do not advertise missing, modified, or accidentally substituted contracts.
    await Promise.all(catalog.map(load));
    return { templates: catalog.map(([key, company, filename]) => ({ key, company, filename })) };
  }
  const row = catalog.find(([id]) => id === key);
  if (action !== 'download' || !row) throw unavailable();
  return { filename: row[2], base64: (await load(row)).toString('base64') };
}
