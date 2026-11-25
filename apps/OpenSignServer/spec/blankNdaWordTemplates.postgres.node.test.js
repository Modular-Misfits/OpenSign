// Requires a disposable loopback Postgres database and the three private verified originals.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, cp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import express from 'express';
import { ParseServer } from 'parse-server';
import { blankNdaTemplates } from '../cloud/company/blankNdaTemplates.js';

test('private blank Word originals: authenticated listing and byte-exact download', async t => {
  const uri = new URL(process.env.WORD_TEST_DATABASE_URI);
  assert.ok(['127.0.0.1', 'localhost'].includes(uri.hostname));
  assert.equal(uri.pathname, '/opensign_word_test');
  const dir = await mkdtemp(path.join(tmpdir(), 'opensign-blank-test-'));
  const dest = path.join(dir, 'blank-word');
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(dest);
  const keys = ['mm', 'cycrypt', 'xpress'];
  for (const k of keys) await cp(path.join(process.env.WORD_TEST_ORIGINALS_DIR,k+'.docx'),path.join(dest,k+'.docx'));
  const appId = 'word-test', master = randomUUID(), serverURL = 'http://127.0.0.1:18143/app';
  Object.assign(process.env, { PORTAL_TEMPLATE_CONFIG: path.join(dir,'layout.json'), DATABASE_URI: uri.href, COMPANY_DOCUMENT_ORG_ID: 'company' });
  const server = new ParseServer({
    databaseURI: uri.href, appId, masterKey: master, serverURL, silent: true, logLevel: 'error',
    cloud: Parse => { global.Parse = Parse; Parse.Cloud.define('blankndawordtemplates', blankNdaTemplates, {requireUser:true}); }
  });
  await server.start();
  const app = express(); app.use('/app', server.app);
  server.server = await new Promise(r => { const s = app.listen(18143,'127.0.0.1',() => r(s)); });
  t.after(() => server.handleShutdown());
  async function api(route, body, token, admin=false, method='POST') {
    const res = await fetch(serverURL+route,{method,headers:{'Content-Type':'application/json','X-Parse-Application-Id':appId,
      ...(admin?{'X-Parse-Master-Key':master}:{}), ...(token?{'X-Parse-Session-Token':token}:{})},body:JSON.stringify(body)});
    return res.json();
  }
  const ptr=(className,objectId)=>({__type:'Pointer',className,objectId});
  async function user(org) {
    const account=await api('/users',{username:randomUUID(),password:randomUUID()});
    const ext=await api('/classes/contracts_Users',{UserId:ptr('_User',account.objectId),OrganizationId:ptr('contracts_Organizations',org),IsDisabled:false},null,true);
    assert.ok(ext.objectId); return {...account,ext:ext.objectId};
  }
  const owner=await user('company'),reader=await user('company'),other=await user('company'),outside=await user('outside');
  process.env.COMPANY_DOCUMENT_READER_ID=reader.objectId;
  await writeFile(path.join(dest,'owner-id'), owner.objectId+'\n');
  const call=(body,acct)=>api('/functions/blankndawordtemplates',body,acct?.sessionToken);
  assert.equal((await call({action:'list'})).code,142);
  for (const acct of [other,outside]) {
    assert.deepEqual((await call({action:'list',user:reader.objectId},acct)).result.templates,[]);
    assert.equal((await call({action:'download',key:'mm',userId:reader.objectId},acct)).code,119);
  }
  for (const acct of [owner,reader]) {
    const listed=(await call({action:'list'},acct)).result.templates;
    assert.deepEqual(listed.map(x=>x.key),keys);
    for(const item of listed) {
      const res=await call({action:'download',key:item.key},acct);
      assert.equal(res.result.filename,item.filename);
      assert.deepEqual(Buffer.from(res.result.base64,'base64'),await readFile(path.join(dest,item.key+'.docx')));
    }
    assert.equal((await call({action:'download',key:'../layout.json'},acct)).code,101);
  }
  await writeFile(path.join(dest,'mm.docx'),'different document');
  assert.equal((await call({action:'download',key:'mm'},owner)).code,101);
  assert.equal((await call({action:'list'},owner)).code,101);
  await api('/classes/contracts_Users/'+reader.ext,{IsDisabled:true},null,true,'PUT');
  assert.equal((await call({action:'download',key:'cycrypt'},reader)).code,119);
  await writeFile(path.join(dest,'owner-id'),outside.objectId);
  assert.equal((await call({action:'download',key:'cycrypt'},outside)).code,119);
});
