// A closed, resource-bounded subprocess: reviewed template filename in argv,
// private party fields on stdin, new unsigned PDF and widget rectangles on stdout.
import { execFile } from 'node:child_process';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { ndaEffectiveDateText } from './ndaEffectiveDate.js';

const types = ['signature', 'name', 'job title', 'email', 'date'];
let rendering = 0;
export async function renderPortalNda(config, input) {
  const root = process.env.PORTAL_TEMPLATE_DIR;
  if (!root || config.pdf !== input.ndaCompany + '-mutual-nda-template.pdf')
    throw new Error('Unexpected NDA template configuration');
  if (rendering >= 2) throw Object.assign(new Error('Layout service busy'), { status: 503 });
  rendering++;
  try {
    const data = await new Promise((resolve, reject) => {
      const child = execFile(process.env.NDA_LAYOUT_PYTHON || '/opt/nda-layout/bin/python',
        ['-I', process.env.NDA_LAYOUT_SCRIPT || '/opt/nda-layout/nda_layout.py',
          '--template', path.join(root, config.pdf), '--portal'],
        { timeout: 30000, killSignal: 'SIGKILL', maxBuffer: 8 * 1024 * 1024,
          env: { LANG: 'C.UTF-8', PATH: '/usr/bin:/bin' } }, (err, stdout) => {
          if (err) return reject(new Error('Unable to typeset the NDA using the reviewed template'));
          try { resolve(JSON.parse(stdout)); } catch { reject(new Error('Invalid NDA renderer output')); }
        });
      child.stdin.on('error', () => {}); // exit is handled above
      child.stdin.end(JSON.stringify({ companyKey: input.ndaCompany, companyName: input.companyName,
        companyAddress: input.companyAddress, effectiveDateText: ndaEffectiveDateText(input.effectiveDate) }));
    });
    const bytes = Buffer.from(data.pdf, 'base64');
    const pdf = await PDFDocument.load(bytes);
    if (!Array.isArray(data.regions) || data.regions.length !== 2) throw new Error('Invalid signer count');
    const fields = data.regions.map(region => {
      if (!Number.isInteger(region.page) || region.page < 1 || region.page > pdf.getPageCount())
        throw new Error('Invalid NDA signer page');
      const {width, height} = pdf.getPage(region.page - 1).getSize();
      if (width !== 612 || height !== 792) throw new Error('Unexpected page size');
      return types.map(type => {
        const rect = region[type];
        if (!Array.isArray(rect) || rect.length !== 4 || !rect.every(Number.isFinite)) throw new Error('Invalid signer field');
        const [x, y, w, h] = rect;
        if (x < 0 || y < 0 || w <= 0 || h <= 0 || x+w > width || y+h > height) throw new Error('Signer field outside page');
        return { type, page: region.page, x, y, width: w, height: h, fontSize: 11, required: type !== 'job title' };
      });
    });
    return {bytes, fields};
  } finally { rendering--; }
}
