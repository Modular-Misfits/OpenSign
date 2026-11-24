#!/usr/bin/env python3
"""Typeset an UNSIGNED NDA from a reviewed blank PDF; never edit a signed source."""
from __future__ import annotations
import argparse
import base64
import sys
from dataclasses import dataclass
import hashlib
import json
import os
import re
from pathlib import Path
import pymupdf as pdf

BLANK = {
    "39834e3b40df3511c150d3d4555296c97148cc9dea3d9a575001de9f1ca10e24": "mm",
    "85a0d325018c595ef33d0ec071e636c0a1c303032d817a1ebed1490820328556": "cycrypt",
    "e2b1e362ac098f5257829932fb4c6803c7f10814b0c29409500e263b560d5e7e": "xpress",
}
SERIF, BOLD, SANS, LABEL = [pdf.Font(n) for n in ("Times-Roman","Times-Bold","Helvetica","Helvetica-Bold")]
W,H,L,R,BOTTOM = 612,792,54,558,723
SIZE,LEAD = 11.5,15.8
ink = (.075,.095,.11)
quiet = (.24,.29,.31)
accent = (.05,.28,.30)

def norm(s):
    return " ".join(s.split())

def insist(ok, message):
    if not ok: raise ValueError(message)

@dataclass
class Form:
    paragraphs: list[str]
    internal: str
    roles: tuple[str,str]

def extract_form(path, date, company, address, *, company_key=None):
    raw = Path(path).read_bytes()
    insist(hashlib.sha256(raw).hexdigest() in BLANK, "Not a pinned, reviewed, blank template")
    if company_key is not None:
        insist(BLANK[hashlib.sha256(raw).hexdigest()] == company_key, "Template does not match requested company")
    doc = pdf.open(stream=raw, filetype="pdf")
    insist(len(doc)==3 and not doc.get_sigflags()>0, "Expected unsigned three-page template")
    blocks=[]
    for i,page in enumerate(doc):
        bs=[]
        for b in page.get_text("dict")["blocks"]:
            if b["type"]: continue
            s=" ".join("".join(span["text"] for span in line["spans"]) for line in b["lines"])
            if s.strip(): bs.append(s.strip(" \n"))
        blocks.append(bs)
    a,b,c=blocks
    j=a.index("WITNESSETH:")
    intro = " ".join(a[2:j])
    fields=iter([date,company,address,company,company])
    intro,count = re.subn(r"\u00a0{5,}",lambda _: next(fields),intro)
    insist(count==5 and all(x=="MUTUAL NON-DISCLOSURE AGREEMENT" for x in a[:2]),"Intro changed")
    # Page 2 continues clause 3; page 3 continues the notices paragraph. No paraphrasing.
    a[-1] += " "+b.pop(0)
    b[-1] += " "+c.pop(0)
    end=next(i for i,s in enumerate(c) if s.startswith("IN WITNESS WHEREOF,"))
    paras=[norm(s) for s in [intro,*a[j:],*b,*c[:end+1]]]
    insist([int(m.group(1)) for s in paras if (m:=re.match(r"^(\d+)\. ",s))]==list(range(1,15)), "Unexpected clause structure")
    signs=[norm(s) for s in c[end+1:]]
    roles=[s for s in signs if s.startswith("(") and s.endswith("Signer)")]
    insist(len(roles)==2 and signs.count("Signature:")==2, "Unexpected execution block")
    return Form(paras,signs[signs.index(roles[1])-1],tuple(roles))

def split_lines(text, font, size, width):
    # An overlong token is never silently truncated or shrunk. Hard wraps are used only
    # in display values/URLs as necessary; a final check verifies the character sequence.
    lines=[]; line=""
    for word in text.split():
        if line and font.text_length(line+" "+word,size)>width:
            lines.append(line); line=""
        if font.text_length(word,size)>width:
            for ch in word:
                if line and font.text_length(line+ch,size)>width:
                    lines.append(line); line=""
                line+=ch
        else: line=(line+" "+word).strip()
    if line: lines.append(line)
    return lines

def make_pdf(form, company, signers, *, source=None, interactive=False):
    """source is a reviewed provenance object for a reading copy, NEVER signer marks."""
    insist(not (interactive and source), "No reading copy in signing workflow")
    doc=pdf.open(); page=None; y=0; ref=source is not None; sign_regions=[]
    status="READING COPY  /  NOT THE SIGNED ORIGINAL" if ref else "EXECUTION COPY"
    def line(x,y,s,font=SANS,size=10,color=ink):
        insist(all(font.has_glyph(ord(c)) for c in s), "Font cannot represent supplied text; use a reviewed Unicode font")
        insist(x+font.text_length(s,size) <= R+0.3 and y<=760,"Page boundary exceeded")
        writer=pdf.TextWriter(page.rect);writer.append((x,y),s,font=font,fontsize=size)
        writer.write_text(page,color=color)
    def rule(x1,x2,h,th=.6):
        page.draw_line((x1,h),(x2,h),color=(.62,.66,.66),width=th)
    def new(first=False):
        nonlocal page,y
        page=doc.new_page(width=W,height=H)
        line(L,39,form.internal.upper()+"  /  AGREEMENTS",LABEL,8.7,accent)
        shift=R-LABEL.text_length(status,8.7);line(shift,39,status,LABEL,8.7,quiet)
        rule(L,R,49)
        if first:
            line(L,93,"Mutual Non-Disclosure Agreement",BOLD,23)
            y=122
        else:y=77
    def paragraph(s):
        nonlocal y
        prefix=re.match(r"^(\d+\.) (.*)$",s)
        x=L+26 if prefix else L
        text=prefix.group(2) if prefix else s
        font=BOLD if text=="WITNESSETH:" else SERIF
        lines=split_lines(text,font,SIZE,R-x)
        remain=int((BOTTOM-y)//LEAD)+1
        if remain<min(3,len(lines)) or (len(lines)==remain+1 and remain<4):new()
        for ix,t in enumerate(lines):
            # Keep at least two lines of a continued paragraph together.
            if y>BOTTOM or (ix>0 and len(lines)-ix==2 and y+LEAD>BOTTOM):new()
            if prefix and ix==0:line(L,y,prefix.group(1),BOLD,SIZE)
            line(x,y,t,font,SIZE)
            y+=LEAD
        y+=6
    new(first=True)
    for p in form.paragraphs[:-1]:paragraph(p)
    # Keep the attestation with both parties, not stranded on the preceding page.
    orgs=[company,form.internal]
    entries=[]
    for org,person,role in zip(orgs,signers,form.roles,strict=True):
        rows=[]
        for label,key in (("Name","name"),("Title","title"),("Email","email")):
            rows.append((label,split_lines(person[key],SANS,11,R-(L+74))))
        entries.append((split_lines(org,BOLD,14,R-L),role,rows,person.get("date")))
    def height(entry):
        org,role,rows,date=entry
        if interactive:
            return 20+len(org)*18+17+3*56+52+30+16
        return len(org)*18+17+sum(len(lines)*15+2 for _,lines in rows)+(34 if ref else 77)
    needed=60+sum(height(e) for e in entries)+(74 if ref else 0)
    if BOTTOM-y<needed:new()
    paragraph(form.paragraphs[-1])
    line(L,y,"Signature record" if ref else "Signatures",BOLD,15); y+=12
    if ref:
        y+=6;line(L,y,"Signer details below are transcribed. Signature images remain in the signed original.",SANS,10,quiet);y+=18
    for n,(org,role,rows,date) in enumerate(entries):
        if y+height(entries[n])>BOTTOM:new()
        rule(L,R,y);y+=20
        for s in org:line(L,y,s,BOLD,14);y+=18
        line(L,y,role,SANS,10,quiet);y+=17
        if interactive:
            # Do not typeset signer answers here: both recipients keep their own
            # editable name, title, email and actual signing-date widgets.
            region={"page":len(doc)}
            for label,key in (("Name","name"),("Title","job title"),("Email","email"),
                              ("Signature","signature"),("Date signed","date")):
                h=48 if key=="signature" else 26 if key=="date" else 52
                line(L,y+12,label,LABEL,9,quiet)
                region[key]=[L+74,y,R-(L+74),h]
                rule(L+74,R,y+h+1)
                y+=h+4
            sign_regions.append(region)
            y+=16
            continue
        for label,lines in rows:
            line(L,y,label,LABEL,9,quiet)
            for s in lines:line(L+74,y,s,SANS,11);y+=15
            y+=2
        if ref:
            line(L,y,"Date in source",LABEL,9,quiet);line(L+74,y,date,SANS,11);y+=23
        else:
            # Only these two blank fields are writable on a future execution. Identity fields
            # are typeset at readable sizes above. pdf positions below are measured from top.
            top=y+2; y+=29
            line(L,y,"Signature",LABEL,9,quiet);rule(L+74,R,y+2);y+=23
            line(L,y,"Date signed",LABEL,9,quiet);rule(L+74,L+247,y+2)
            sign_regions.append({"page":len(doc),"signature":[L+74,top,R-(L+74),29],
                                 "date":[L+74,y-16,173,17]})
            y+=20
    if ref:
        if y+60>BOTTOM:new()
        y+=8;rule(L,R,y);y+=18
        line(L,y,"Source document ID: "+source["id"],LABEL,10,quiet);y+=16
        line(L,y,"Original PDF SHA-256",SANS,9,quiet);y+=13
        line(L,y,source["sha256"],SANS,9,quiet)
    for i in range(len(doc)):
        page=doc[i];rule(L,R,737)
        f=("Readable transcription  |  Source: "+source["id"]) if ref else "Mutual Non-Disclosure Agreement"
        line(L,753,f,SANS,9,quiet);n=f"{i+1} / {len(doc)}";line(R-SANS.text_length(n,9),753,n,SANS,9,quiet)
    doc.set_metadata({"title":"Mutual Non-Disclosure Agreement — "+("Reading copy" if ref else "Execution copy"),
                      "subject":"Not the electronically signed original" if ref else "No signatures or signing dates copied"})
    doc.subset_fonts()
    result=doc.tobytes(garbage=4,deflate=True)
    return result,sign_regions

def save_new(path,data):
    with os.fdopen(os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600),"wb") as f:f.write(data)

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--template",type=Path,required=True)
    p.add_argument("--portal",action="store_true")
    for k in ("input","output"):p.add_argument("--"+k,type=Path)
    args=p.parse_args()
    if args.portal:
        insist(not args.input and not args.output, "Portal mode uses pipes only")
        data=sys.stdin.buffer.read(16385)
        insist(len(data)<=16384,"Request too large")
        v=json.loads(data)
        form=extract_form(args.template,v["effectiveDateText"],v["companyName"],v["companyAddress"],company_key=v["companyKey"])
        empty=[{"name":"","title":"","email":""} for _ in range(2)]
        out,areas=make_pdf(form,v["companyName"],empty,interactive=True)
        json.dump({"pdf":base64.b64encode(out).decode("ascii"),"regions":areas},sys.stdout)
        return
    insist(args.input and args.output,"Input and output files required")
    v=json.loads(args.input.read_text())
    # Explicit date: never silently substitute an earlier effective date or a signing date.
    for k in ("effectiveDateText","companyName","companyAddress"):
        insist(isinstance(v[k],str) and bool(v[k].strip()),"Missing "+k)
    insist(len(v["signers"])==2 and all(all(isinstance(s[k],str) and s[k].strip() for k in ("name","title","email")) for s in v["signers"]),"Two identified signers required")
    form=extract_form(args.template,v["effectiveDateText"],v["companyName"],v["companyAddress"])
    output,_=make_pdf(form,v["companyName"],v["signers"])
    save_new(args.output,output)

if __name__=="__main__": main()
