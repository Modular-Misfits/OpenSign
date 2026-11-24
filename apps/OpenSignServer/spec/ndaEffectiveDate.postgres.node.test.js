// Isolated Parse + PostgreSQL + real PDFs. All notification traffic goes to the
// in-process loopback sink; no SMTP accounts, real signers or live services.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { ParseServer } from 'parse-server';
import FSFilesAdapter from '@parse/fs-files-adapter';
import { PDFDocument } from 'pdf-lib';
import { validEffectiveDate } from '../cloud/portal/ndaEffectiveDate.js';
import migrate from '../databases/migrations/20261124000000-add_nda_effective_date.cjs';

test('date-only validation rejects normalized, malformed and future dates', () => {
  const now = new Date('2024-03-01T03:00:00Z'); // still February 29 in Chicago
  assert.equal(validEffectiveDate('2024-02-29', now), true);
  for (const bad of [
    '2024-03-01',
    '2023-02-29',
    '2024-02-31',
    '0000-01-01',
    '',
    null,
    {},
    '2020-03-01T01:00Z',
  ]) {
    assert.equal(validEffectiveDate(bad, now), false);
  }
});

test('private bridge embeds agreed date before sending, preserves signing clocks and cannot redate an existing request', async t => {
  const uri = new URL(process.env.NDA_TEST_DATABASE_URI);
  assert.ok(['127.0.0.1', 'localhost'].includes(uri.hostname));
  assert.equal(uri.pathname, '/opensign_nda_date_test');
  const cwd = process.cwd(),
    scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'nda-date-test-'));
  const port = 18129,
    root = 'http://127.0.0.1:' + port,
    master = { useMasterKey: true };
  const date = '2024-02-29';
  const appId = 'nda-date-test',
    masterKey = randomUUID(),
    secret = randomUUID();
  const sourceDir = process.env.NDA_TEST_TEMPLATE_DIR,
    layoutPath = process.env.NDA_TEST_LAYOUT;
  assert.equal(Boolean(sourceDir), Boolean(layoutPath));
  process.chdir(scratch);
  t.after(async () => {
    process.chdir(cwd);
    await fs.rm(scratch, { recursive: true, force: true });
  });
  assert.ok(sourceDir && layoutPath, 'Use the three pinned blank PDFs and their config; substitutes must fail closed.');
  Object.assign(process.env, {
    APP_ID: appId,
    SERVER_URL: root + '/app',
    PUBLIC_URL: root,
    PORTAL_BRIDGE_SECRET: secret,
    PORTAL_WEBHOOK_URL: root + '/mail-sink',
    PORTAL_WEBHOOK_SECRET: randomUUID(),
    SMTP_ENABLE: 'false',
    MAILGUN_API_KEY: '',
    PORTAL_OWNER_EMAIL: 'owner@example.test',
    PORTAL_TEMPLATE_DIR: sourceDir || scratch,
    PORTAL_TEMPLATE_CONFIG: layoutPath || path.join(scratch, 'layout.json'),
  });
  const { mountPortalNdaRoutes } = await import('../cloud/customRoute/portalNda.js');
  const { default: beforeSave } = await import('../cloud/parsefunction/DocumentBeforesave.js');
  const server = new ParseServer({
    databaseURI: uri.href,
    serverURL: root + '/app',
    publicServerURL: root + '/app',
    appId,
    masterKey,
    filesAdapter: new FSFilesAdapter(),
    allowClientClassCreation: false,
    silent: true,
    logLevel: 'error',
    cloud: Parse => {
      global.Parse = Parse;
      Parse.Cloud.beforeSave('contracts_Document', beforeSave);
    },
  });
  await server.start();
  const app = express();
  app.use('/app', server.app);
  app.use(express.json());
  let messages = 0;
  app.post('/mail-sink', (req, res) => {
    assert.equal(req.body.payload.recipient, 'guest@example.test');
    messages++;
    res.sendStatus(200);
  });
  mountPortalNdaRoutes(app);
  server.server = await new Promise(resolve => {
    const s = app.listen(port, '127.0.0.1', () => resolve(s));
  });
  t.after(() => server.handleShutdown());
  for (const [name, fields] of [
    ['contracts_Document', { PortalRequestId: 'String' }],
    ['contracts_Users', { UserId: '_User' }],
    ['contracts_Contactbook', { Email: 'String', CreatedBy: '_User', IsDeleted: 'Boolean' }],
  ]) {
    const schema = new Parse.Schema(name);
    for (const [k, v] of Object.entries(fields)) {
      if (v === '_User') schema.addPointer(k, v);
      else schema.addField(k, v);
    }
    if (!(await Parse.Schema.all()).some(s => s.className === name)) await schema.save();
  }
  await migrate.up(Parse);
  await migrate.up(Parse);
  const input = {
    requestId: 'nda_' + randomUUID(),
    ndaCompany: 'mm',
    companyName: 'Example Continental Scientific Engineering and Applied Research Holdings, LLC',
    companyAddress: '123 Example Research Boulevard, Building Seven, Suite 400, Alexandria, Virginia',
    companyPoc: 'Guest',
    companyPocEmail: 'guest@example.test',
    internalPoc: 'Staff',
    internalPocEmail: 'staff@example.test',
  };
  const post = (route, body, auth = true) =>
    fetch(root + '/portal/v1/nda' + route, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(auth ? { Authorization: 'Bearer ' + secret } : {}),
      },
      body: JSON.stringify(body),
    });
  assert.equal((await post('/with-effective-date', input)).status, 400);
  assert.equal(
    (await post('/with-effective-date', { ...input, effectiveDate: '2023-02-29' })).status,
    400
  );
  assert.equal((await post('', { ...input, effectiveDate: date })).status, 400);
  assert.equal(
    (await post('/with-effective-date', { ...input, effectiveDate: date, signedAt: date })).status,
    400
  );
  assert.equal(
    (await post('/with-effective-date', { ...input, effectiveDate: date }, false)).status,
    401
  );
  assert.equal(messages, 0);
  for (const company of ['mm', 'cycrypt', 'xpress']) {
    const request = {
      ...input,
      ndaCompany: company,
      requestId: 'nda_' + randomUUID(),
      effectiveDate: date,
    };
    const sentAt = Date.now();
    const res = await post('/with-effective-date', request);
    const obj = await res.json();
    assert.equal(res.status, 201, JSON.stringify(obj));
    const doc = await new Parse.Query('contracts_Document').get(obj.id, master);
    assert.equal(doc.get('PortalEffectiveDate'), date);
    assert.equal(obj.completedAt, null);
    assert.ok(doc.get('DocSentAt').getTime() >= sentAt);
    const widgets = doc.get('Placeholders').flatMap(p => p.placeHolder.flatMap(g => g.pos));
    const dates = widgets.filter(w => w.type === 'date');
    assert.equal(dates.length, 2);
    assert.ok(dates.every(w => w.options.isSigningDate === true && !w.options.defaultValue));
    assert.ok(!widgets.some(w => w.options.defaultValue === 'February 29, 2024'));
    const source = await fetch(doc.get('URL'));
    assert.equal(source.status, 200);
    const pdf = await PDFDocument.load(await source.arrayBuffer());
    assert.ok(pdf.getPageCount() >= 3);
    for (const [index, placeholder] of doc.get('Placeholders').entries()) {
      const widgetList = placeholder.placeHolder.flatMap(g => g.pos);
      assert.equal(placeholder.signerObjId, doc.get('Signers')[index].id);
      assert.deepEqual(widgetList.map(w => w.type).sort(), ['date','email','job title','name','signature']);
      for (const w of widgetList) {
        assert.equal(w.Width,430);
        assert.ok(w.xPosition >= 100 && w.yPosition + w.Height <= 724);
        assert.ok(!w.options.isReadOnly);
      }
    }
    if (process.env.NDA_TEST_ARTIFACTS) {
      await fs.writeFile(path.join(process.env.NDA_TEST_ARTIFACTS,company+'.pdf'),await pdf.save(),{mode:0o600});
      await fs.writeFile(path.join(process.env.NDA_TEST_ARTIFACTS,company+'.json'),JSON.stringify(doc.get('Placeholders')),{mode:0o600});
    }
    const count = messages;
    assert.equal((await post('/with-effective-date', request)).status, 201);
    assert.equal(
      (await post('/with-effective-date', { ...request, effectiveDate: '2024-02-28' })).status,
      409
    );
    const { effectiveDate, ...legacy } = request;
    assert.equal((await post('', legacy)).status, 409);
    assert.equal(messages, count);
    doc.set('PortalEffectiveDate', '2024-01-01');
    await assert.rejects(doc.save(null, master), /set only before creation/);
  }
  const normal = await post('', input);
  assert.equal(normal.status, 201);
  const normalDoc = await new Parse.Query('contracts_Document').get(
    (await normal.json()).id,
    master
  );
  assert.equal(normalDoc.get('PortalEffectiveDate'), undefined);
  assert.equal(messages, 4);
});
