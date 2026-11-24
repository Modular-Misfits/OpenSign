"""Regression checks on the three actual approved blank PDFs; no network or signing."""
import hashlib
import os
from pathlib import Path
import re
import tempfile
import unittest

import pymupdf as pdf
from nda_layout import BLANK, extract_form, make_pdf, save_new, norm

class LayoutTests(unittest.TestCase):
    def test_all_actual_templates(self):
        root=Path(os.environ["NDA_TEMPLATE_DIR"])
        templates=list(root.glob("*-mutual-nda-template.pdf"))
        self.assertEqual({hashlib.sha256(p.read_bytes()).hexdigest() for p in templates},set(BLANK))
        # Long field values that wrap across multiple lines in the old fixed boxes.
        company="Example Continental Engineering and Applied Research Holdings, LLC"
        address="1280 North Research Boulevard, Building Seven, Suite 400, Alexandria, Virginia 22314"
        signers=[dict(name="Example Signer "+n,title="Deputy Director of Program Administration",
                      email="director.of.program.administration."+n+"@example.invalid") for n in ("one","two")]
        for template in templates:
            with self.subTest(template=template.name):
                form=extract_form(template,"September 13, 2026",company,address)
                out,areas=make_pdf(form,company,signers)
                doc=pdf.open(stream=out,filetype="pdf")
                self.assertFalse(doc.get_sigflags()>0)
                self.assertEqual(len(areas),2)
                legal=[]
                for page in doc:
                    self.assertEqual(list(page.widgets() or []),[])
                    spans=[s for b in page.get_text("dict")["blocks"] if not b["type"] for l in b["lines"] for s in l["spans"] if s["text"].strip()]
                    for s in spans:
                        x,y,x1,y1=s["bbox"]
                        self.assertTrue(53<=x<x1<=559 and 20<=y<y1<=760)
                        if 50<y<730:legal.append(s["text"])
                    # Check actual measured text boxes, not just form field rectangles.
                    for i,s in enumerate(spans):
                        for v in spans[i+1:]:
                            overlap=pdf.Rect(s["bbox"]) & pdf.Rect(v["bbox"])
                            self.assertTrue(overlap.is_empty or overlap.width<=.5 or overlap.height<=1.5)
                text=" ".join(" ".join(legal).split())
                self.assertIn(" ".join(form.paragraphs),text)
                self.assertEqual(text.count(company),4)
                self.assertEqual(text.count(address),1)
                self.assertEqual(text.count("Signature Date signed"),2)
                self.assertNotIn("09/13/2026",text)
                for a in areas:
                    self.assertTrue(1<=a["page"]<=len(doc))
                    for k in ("signature","date"):
                        x,y,w,h=a[k]; self.assertGreater(w,160)
                        chars=doc[a["page"]-1].get_textbox(pdf.Rect(x,y+1,x+w,y+h-1))
                        self.assertEqual(chars.strip(),"")
    def test_live_signer_regions_all_templates(self):
        company="Example International Scientific Research Holdings " * 3 + "LLC"
        address="123 Research Way, Building Five, Suite 400, Alexandria, Virginia"
        for key in BLANK.values():
            template=Path(os.environ["NDA_TEMPLATE_DIR"])/(key+"-mutual-nda-template.pdf")
            form=extract_form(template,"September 30, 2024",company,address,company_key=key)
            with self.assertRaises(ValueError):
                extract_form(template,"date",company,address,company_key="other")
            out,regions=make_pdf(form,company,[dict(name="",title="",email="")]*2,interactive=True)
            doc=pdf.open(stream=out,filetype="pdf")
            words=norm(" ".join(p.get_text() for p in doc))
            self.assertIn("September 30, 2024",words)
            self.assertEqual(len(regions),2)
            for area in regions:
                page=doc[area["page"]-1]
                boxes=[]
                for kind in ("name","job title","email","signature","date"):
                    r=area[kind]; box=pdf.Rect(r[0],r[1],r[0]+r[2],r[1]+r[3])
                    self.assertEqual(page.get_textbox(box).strip(),"")
                    self.assertTrue(box.y1<=724 and page.rect.contains(box))
                    self.assertTrue(all((box & old).is_empty for old in boxes))
                    boxes.append(box)
    def test_unknown_or_signed_source_and_overwrite_rejected(self):
        with tempfile.TemporaryDirectory() as td:
            p=Path(td)/"other.pdf"
            save_new(p,b"not an approved blank PDF")
            with self.assertRaisesRegex(ValueError,"pinned"):extract_form(p,"date","company","address")
            with self.assertRaises(FileExistsError):save_new(p,b"replacement")
            self.assertEqual(p.read_bytes(),b"not an approved blank PDF")

if __name__=="__main__": unittest.main()
