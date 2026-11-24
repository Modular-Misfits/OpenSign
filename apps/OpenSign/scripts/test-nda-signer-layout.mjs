// Offline Chromium qualification using the actual guest sign-page validator and PDF embedder.
// Use only the synthetic artifacts produced by ndaEffectiveDate.postgres.node.test.js.
import {build} from 'vite';
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('../',import.meta.url)), dir=process.env.NDA_TEST_ARTIFACTS;
assert(dir && path.isAbsolute(dir));
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const output = await build({root,logLevel:'error',base:'/',build:{write:false,
  rollupOptions:{input:{main:'virtual:nda-test'}}},plugins:[{
  name:'offline-nda-runner',resolveId(id){if(id==='virtual:nda-test')return '\0'+id;},
  load(id){if(id==='\0virtual:nda-test')return `
  import { PDFDocument } from 'pdf-lib';
  import { handleCheckResponse, embedWidgetsToDoc } from '/src/constant/Utils.js';
  window.testTypeset = async ({pdf,signer,index}) => {
    const mark=document.createElement('canvas'); mark.width=180;mark.height=35;
    const c=mark.getContext('2d');c.fillText('SYNTHETIC ROLE '+index,5,15);
    const signature=mark.toDataURL('image/png');
    const answer={signature,name:'Test Signer '+index,'job title':'Test Officer '+index,
      email:'person'+index+'@example.test',date:'11/24/2026'};
    for(const group of signer.placeHolder) for(const field of group.pos) {
      field.options.response=field.type==='signature'?signature:answer[field.type];
    }
    if(handleCheckResponse([signer],()=>{}).showAlert)throw Error('Required signer fields failed');
    const result=await embedWidgetsToDoc(signer.placeHolder,await PDFDocument.load(pdf),false,1);
    if(typeof result!=='string')throw Error('Guest PDF embedding failed');
    return result;
  };`;}
}]});
const files=new Map((Array.isArray(output)?output[0]:output).output.map(x=>['/'+x.fileName,x]));
const entry=[...files.values()].find(x=>x.isEntry && x.facadeModuleId?.includes('virtual:nda-test'));
assert(entry);
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||undefined});
try {
 const page=await browser.newPage({viewport:{width:1280,height:900}});
 await page.route('**/*',async route=>{
   const u=new URL(route.request().url());
   if(u.href==='https://cdn.opensignlabs.com/webfonts/times.ttf')return route.fulfill({path:path.join(root,'../OpenSignServer/font/times.ttf'),headers:{'Access-Control-Allow-Origin':'*'}});
   if(u.origin!=='http://offline.test')return route.abort();
   if(u.pathname==='/')return route.fulfill({contentType:'text/html',body:`<script type="module" src="/${entry.fileName}"></script>`});
   const file=files.get(u.pathname);
   return file? route.fulfill({contentType:file.type==='chunk'?'text/javascript':'application/octet-stream',body:file.code||file.source}):route.fulfill({status:404,body:''});
 });
 page.on('pageerror',e=>console.error(e.message));
 await page.goto('http://offline.test');await page.waitForFunction(()=>typeof window.testTypeset==='function');
 for(const company of ['mm','cycrypt','xpress']){
   const signers=JSON.parse(await fs.readFile(path.join(dir,company+'.json')));
   let pdf=(await fs.readFile(path.join(dir,company+'.pdf'))).toString('base64');
   for(const [index,signer] of signers.entries()){
     pdf=await page.evaluate(input=>window.testTypeset(input),{pdf,signer,index});
     await fs.writeFile(path.join(dir,company+'-role'+index+'.pdf'),Buffer.from(pdf,'base64'),{mode:0o600});
   }
   console.log(company+': both guest field sets validated and embedded sequentially');
 }
}finally{await browser.close();}
