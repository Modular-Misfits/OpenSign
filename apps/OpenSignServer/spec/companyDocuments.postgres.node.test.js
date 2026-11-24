// Run against a disposable local PostgreSQL database (see COMPANY-DOCUMENTS.md).
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import test from 'node:test';
import express from 'express';
import { ParseServer } from 'parse-server';
import { companyDocuments } from '../cloud/company/documents.js';
import { validateSignedLocalUrl } from '../cloud/parsefunction/getSignedUrl.js';

test('company library: authenticated Parse boundary with real PostgreSQL', async t => {
  const uri = new URL(process.env.COMPANY_TEST_DATABASE_URI);
  assert.ok(['localhost', '127.0.0.1'].includes(uri.hostname));
  assert.equal(uri.pathname, '/opensign_company_test');
  const appId = 'company-test', masterKey = randomUUID(), base = 'http://127.0.0.1:18085/app';
  const files = 'https://sign.example.test/api/app';
  Object.assign(process.env, { DATABASE_URI: uri.href, SERVER_URL: files, APP_ID: appId,
    USE_LOCAL: 'true', MASTER_KEY: masterKey, COMPANY_DOCUMENT_ORG_ID: 'company' });
  const server = new ParseServer({
    databaseURI: uri.href, appId, masterKey, serverURL: base,
    allowClientClassCreation: false, silent: true, logLevel: 'error',
    cloud: Parse => { global.Parse = Parse;
      Parse.Cloud.define('companydocuments', companyDocuments, { requireUser: true }); },
  });
  await server.start();
  const app = express(); app.use('/app', server.app);
  server.server = await new Promise(resolve => { const s = app.listen(18085, '127.0.0.1', () => resolve(s)); });
  t.after(() => server.handleShutdown());
  async function api(path, body, { master, token, method = 'POST' } = {}) {
    const r = await fetch(base + path, { method, headers: {
      'Content-Type': 'application/json', 'X-Parse-Application-Id': appId,
      ...(master ? { 'X-Parse-Master-Key': masterKey } : {}),
      ...(token ? { 'X-Parse-Session-Token': token } : {}) }, body: JSON.stringify(body) });
    return r.json();
  }
  const create = async (cls, body) => {
    const r = await api('/classes/' + cls, body, {master: true});
    assert.ok(r.objectId, JSON.stringify(r)); return r.objectId;
  };
  const ptr = (className, objectId) => ({ __type: 'Pointer', className, objectId });
  async function member(org, name) {
    const user = await api('/users', {username: randomUUID(), password: randomUUID()});
    const ext = await create('contracts_Users', {UserId: ptr('_User',user.objectId),
      OrganizationId: ptr('contracts_Organizations',org), Name: name, IsDisabled: false });
    return { user: user.objectId, ext, token: user.sessionToken };
  }
  const reader = await member('company', 'Reader'), owner = await member('company', 'Owner'),
    other = await member('foreign', 'Other');
  process.env.COMPANY_DOCUMENT_READER_ID = reader.user;
  const address = name => files + '/files/' + appId + '/' + name + '.pdf';
  async function doc(who, name, fields = {}) {
    return create('contracts_Document', {Name: name, Type: 'Document', CreatedBy: ptr('_User',who.user),
      ExtUserPtr: ptr('contracts_Users',who.ext), URL: address('original'),
      ACL: { [who.user]: {read: true, write: true} }, ...fields});
  }
  const main = await doc(owner,'Signed', {SignedUrl: address('signed') + '?token=old',
    CertificateUrl: address('certificate'), IsCompleted: true, IsArchive: true, IsDeclined: false,
    ExpiryDate: {__type:'Date', iso:'2020-01-01T00:00:00.000Z'}});
  const foreign = await doc(other,'External');
  await doc(owner,'Folder',{Type:'Folder'});
  await doc(other,'Conflicting owner',{ExtUserPtr: ptr('contracts_Users',owner.ext)});
  await doc(owner,'Bad URL',{URL:'https://cdn.example.test/test.pdf'});
  await doc(owner,'Traversal',{URL:address('..%2Fsecret')});
  for (let i=0; i<50; i++) await doc(owner, 'Draft ' + i);
  const func = (params, token) => api('/functions/companydocuments',params,{token});
  const key = id => createHash('sha256').update(id).digest('hex');
  await t.test('sessions, not client identity claims, enforce the exact reader grant', async () => {
    assert.ok((await func({action:'list'})).error);
    assert.equal((await func({action:'access'}, owner.token)).result.allowed,false);
    assert.equal((await func({action:'list', userId:reader.user,org:'company'}, other.token)).code,119);
    assert.equal((await func({action:'access'},reader.token)).result.allowed,true);
  });
  await t.test('pages include private and archived company documents, not other orgs or folders', async () => {
    const a = (await func({action:'list'},reader.token)).result;
    assert.equal(a.documents.length,50); assert.ok(a.next);
    const b = (await func({action:'list', after:a.next},reader.token)).result;
    assert.equal(b.next,null);
    const rows = [...a.documents,...b.documents]; assert.equal(rows.length,53);
    assert.equal(new Set(rows.map(r=>r.key)).size,53);
    assert.ok(!rows.some(r=>['Folder','External','Conflicting owner'].includes(r.title)));
    const row = rows.find(r=>r.title==='Signed');
    assert.deepEqual(Object.keys(row).sort(),['archived','hasCertificate','hasPdf','key','owner','status','title','updated'].sort());
    assert.equal(row.archived,true); assert.equal(row.status,'Completed'); assert.equal(row.hasCertificate,true);
    assert.equal(rows.find(r=>r.title==='Draft 1').status,'Draft');
    assert.equal(rows.find(r=>r.title==='Bad URL').hasPdf,false);
    assert.equal(rows.find(r=>r.title==='Traversal').hasPdf,false);
    assert.ok(!JSON.stringify(rows).includes(main));
  });
  await t.test('open checks scope again, signs only the stored local file and grants no document write', async () => {
    for (const [kind, file] of [['pdf','signed'],['certificate','certificate']]) {
      const {url} = (await func({action:'open',key:key(main),kind,url:address('unrelated')},reader.token)).result;
      assert.equal(url.split('?')[0],address(file)); assert.notEqual(await validateSignedLocalUrl(url),'Unauthorized');
    }
    assert.equal((await func({action:'open',key:key(foreign),kind:'pdf'},reader.token)).code,101);
    assert.equal((await func({action:'delete',key:key(main)},reader.token)).code,102);
    assert.ok((await api('/classes/contracts_Document/'+main,{Name:'Not allowed'},
      {token:reader.token,method:'PUT'})).error);
  });
  await t.test('revocation, org changes and disabled accounts deny existing sessions', async () => {
    for (const [settings, on] of [[{IsDisabled:true},false],[{IsDisabled:false},true],
      [{OrganizationId:ptr('contracts_Organizations','foreign')},false]]) {
      await api('/classes/contracts_Users/'+reader.ext,settings,{master:true,method:'PUT'});
      assert.equal((await func({action:'access'},reader.token)).result.allowed,on);
      if (!on) assert.equal((await func({action:'open',key:key(main),kind:'pdf'},reader.token)).code,119);
    }
    delete process.env.COMPANY_DOCUMENT_READER_ID;
    assert.equal((await func({action:'list'},reader.token)).code,119);
  });
});
