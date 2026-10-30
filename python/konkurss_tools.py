#!/usr/bin/env python3
"""konkurss_tools — Word/Excel template tools for the Konkursu App.

One CLI, JSON in and out, so the Electron app can call it the same way in development
(`py -3 konkurss_tools.py <cmd> <spec.json>`) and from a frozen exe (phase 6).

Commands
  inspect-docx <docx>            structure of a template: paragraphs (italic/heading flags), tables, hash
  fill-docx    <spec.json>       write a NEW docx from a template + edits (never the template itself)
  fill-xlsx    <spec.json>       write a NEW xlsx from a template + cell edits
  grep-terms   <spec.json>       find terms (other tenders' names, other builders) in docx/xlsx files

Rules enforced here (mistake catalogue A6, A10): the destination must differ from the source, must not
exist as a directory, and a source file is never opened for writing.
"""
import hashlib
import json
import os
import re
import sys

RED = (0xB4, 0x34, 0x2C)
GREEN = (0x2E, 0x6B, 0x4F)
GREY = (0x80, 0x80, 0x80)
DARK_RED = (0x8B, 0x00, 0x00)
LIGHT_RED = (0xFF, 0x4D, 0x4D)


def out(obj):
    sys.stdout.buffer.write((json.dumps(obj, ensure_ascii=False) + "\n").encode("utf-8"))


def fail(msg):
    out({"ok": False, "error": msg})
    sys.exit(1)


def load_spec(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def guard_dst(src, dst):
    if os.path.normcase(os.path.abspath(src)) == os.path.normcase(os.path.abspath(dst)):
        fail("Mērķa fails nedrīkst būt tas pats, kas oriģināls: " + dst)
    if os.path.isdir(dst):
        fail("Mērķis ir mape, nevis fails: " + dst)
    if dst.lower().endswith(".edoc"):
        fail("Parakstītus .edoc failus app neveido.")
    os.makedirs(os.path.dirname(os.path.abspath(dst)), exist_ok=True)


# ----------------------------------------------------------------------------- inspect
def run_italic_ratio(p):
    total = sum(len(r.text) for r in p.runs)
    if total == 0:
        return 0.0
    ital = sum(len(r.text) for r in p.runs if r.italic or (r.style is not None and r.style.font.italic))
    # paragraph-level italic via style
    if p.style is not None and p.style.font is not None and p.style.font.italic:
        return 1.0
    return ital / total


def heading_level(p):
    name = p.style.name if p.style is not None else ""
    m = re.match(r"Heading (\d)", name)
    return int(m.group(1)) if m else 0


def inspect_docx(path):
    import docx

    d = docx.Document(path)
    paragraphs = []
    for i, p in enumerate(d.paragraphs):
        paragraphs.append({
            "i": i,
            "text": p.text,
            "style": p.style.name if p.style is not None else "",
            "heading": heading_level(p),
            "italic": round(run_italic_ratio(p), 2),
        })
    # position of each table: index of the paragraph that precedes it in the document body
    after = []
    seen_p = 0
    for child in d.element.body.iterchildren():
        tag = child.tag.rsplit("}", 1)[-1]
        if tag == "p":
            seen_p += 1
        elif tag == "tbl":
            after.append(seen_p - 1)
    tables = []
    for t, tbl in enumerate(d.tables):
        cells = []
        for row in tbl.rows:
            seen = []
            line = []
            for c in row.cells:
                # merged cells repeat the same underlying cell: report once, blank afterwards
                if any(c._tc is s for s in seen):
                    line.append("")
                    continue
                seen.append(c._tc)
                line.append(c.text.strip())
            cells.append(line)
        tables.append({"t": t, "rows": len(tbl.rows), "cols": len(tbl.columns), "cells": cells, "after_p": after[t] if t < len(after) else -1})
    skeleton_src = json.dumps(
        {
            "headings": [(p["heading"], p["text"].strip()) for p in paragraphs if p["heading"]],
            "tables": [[[c for c in row] for row in tb["cells"][:1]] + [tb["rows"], tb["cols"]] for tb in tables],
        },
        ensure_ascii=False,
    )
    return {
        "ok": True,
        "paragraphs": paragraphs,
        "tables": tables,
        "skeleton": hashlib.sha1(skeleton_src.encode("utf-8")).hexdigest()[:16],
    }


# ----------------------------------------------------------------------------- fill docx
def rgb(color):
    from docx.shared import RGBColor

    return RGBColor(*color)


def set_runs(p, text, color=None, italic=False, size=None, bold=None):
    """Replace all runs of a paragraph with one run of `text` (keeping the paragraph's style)."""
    from docx.shared import Pt

    first = p.runs[0] if p.runs else None
    for r in list(p.runs)[1:]:
        r._r.getparent().remove(r._r)
    if first is None:
        first = p.add_run()
    first.text = text
    first.italic = italic
    if bold is not None:
        first.bold = bold
    if color is not None:
        first.font.color.rgb = rgb(color)
    if size is not None:
        first.font.size = Pt(size)
    return first


def add_note(p_after_container, note, color=GREY):
    """Small italic 'Avots: …' line in a new paragraph of the same container."""
    from docx.shared import Pt

    p = p_after_container.add_paragraph()
    r = p.add_run(note)
    r.italic = True
    r.font.size = Pt(8)
    r.font.color.rgb = rgb(color)
    return p


STATUS_COLOR = {"source": GREEN, "missing": RED, "na": GREY, "added": LIGHT_RED, "manual": None}


def apply_cell(tbl, row, col, text, status, note):
    from docx.shared import Pt

    cell = tbl.rows[row].cells[col]
    p = cell.paragraphs[0]
    if status == "missing":
        text = text or "[aizpildīt]"
    set_runs(p, text, color=STATUS_COLOR.get(status), italic=(status == "na"))
    for extra in cell.paragraphs[1:]:
        extra._p.getparent().remove(extra._p)
    if note:
        add_note(cell, note)


def insert_paragraph_after(p, text=""):
    import copy

    from docx.text.paragraph import Paragraph

    new = copy.deepcopy(p._p)
    p._p.addnext(new)
    para = Paragraph(new, p._parent)
    for r in list(para.runs):
        r._r.getparent().remove(r._r)
    if text:
        para.add_run(text)
    return para


def fill_docx(spec):
    import docx
    from docx.shared import Pt

    src, dst = spec["src"], spec["dst"]
    guard_dst(src, dst)
    d = docx.Document(src)
    done = 0
    # paragraph edits first, from the end, so inserted paragraphs never shift later indexes
    pedits = sorted([e for e in spec.get("edits", []) if e["kind"] == "paragraph"], key=lambda e: -e["i"])
    paragraphs = list(d.paragraphs)
    for e in pedits:
        p = paragraphs[e["i"]]
        if e.get("delete"):
            p._p.getparent().remove(p._p)
            done += 1
            continue
        lines = [l for l in (e.get("text") or "").split("\n")]
        status = e.get("status", "source")
        text0 = lines[0] if lines and lines[0] else ("[aizpildīt]" if status == "missing" else "")
        set_runs(p, text0, color=STATUS_COLOR.get(status), italic=False)
        last = p
        for line in lines[1:]:
            last = insert_paragraph_after(last, "")
            set_runs(last, line, color=STATUS_COLOR.get(status), italic=False)
        if e.get("note"):
            n = insert_paragraph_after(last, "")
            set_runs(n, e["note"], color=GREY, italic=True, size=8)
        done += 1
    for e in spec.get("edits", []):
        if e["kind"] == "cell":
            apply_cell(d.tables[e["t"]], e["r"], e["c"], e.get("text", ""), e.get("status", "source"), e.get("note"))
            done += 1
        elif e["kind"] == "add_rows":
            tbl = d.tables[e["t"]]
            import copy

            for _ in range(e.get("count", 1)):
                tbl._tbl.append(copy.deepcopy(tbl.rows[-1]._tr))
            done += 1
    if spec.get("legend"):
        first = d.paragraphs[0]
        leg = first.insert_paragraph_before("")
        for text, color in spec["legend"]:
            r = leg.add_run(text + "   ")
            r.font.size = Pt(8)
            if color:
                r.font.color.rgb = rgb(STATUS_COLOR.get(color, GREY) or GREY)
    d.save(dst)
    return {"ok": True, "dst": dst, "edits": done}


# ----------------------------------------------------------------------------- fill xlsx
def fill_xlsx(spec):
    import openpyxl
    from openpyxl.comments import Comment
    from openpyxl.styles import Font, PatternFill

    src, dst = spec["src"], spec["dst"]
    guard_dst(src, dst)
    keep_vba = src.lower().endswith(".xlsm")
    wb = openpyxl.load_workbook(src, keep_vba=keep_vba)
    n = 0
    for e in spec.get("edits", []):
        ws = wb[e["sheet"]] if e.get("sheet") else wb.worksheets[0]
        cell = ws[e["ref"]]
        if cell.coordinate in ws.merged_cells:
            # write to the top-left cell of a merged range
            for rng in ws.merged_cells.ranges:
                if cell.coordinate in rng:
                    cell = ws.cell(rng.min_row, rng.min_col)
                    break
        status = e.get("status", "source")
        cell.value = e.get("value") if e.get("value") is not None else ("[aizpildīt]" if status == "missing" else None)
        color = {"source": "2E6B4F", "missing": "B4342C", "na": "808080"}.get(status)
        if color:
            cell.font = Font(name=cell.font.name, size=cell.font.size, bold=cell.font.bold, color=color)
        if status == "missing":
            cell.fill = PatternFill("solid", fgColor="FBF3DC")
        if e.get("note"):
            cell.comment = Comment(e["note"], "Konkursu App")
        n += 1
    wb.save(dst)
    return {"ok": True, "dst": dst, "edits": n}


# ----------------------------------------------------------------------------- grep terms
def docx_text(path):
    import docx

    d = docx.Document(path)
    parts = [p.text for p in d.paragraphs]
    for t in d.tables:
        for row in t.rows:
            for c in row.cells:
                parts.append(c.text)
    return "\n".join(parts)


def xlsx_text(path):
    import openpyxl

    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    parts = []
    for ws in wb.worksheets:
        for row in ws.iter_rows(values_only=True):
            for v in row:
                if v is not None:
                    parts.append(str(v))
    return "\n".join(parts)


def norm(s):
    import unicodedata

    s = unicodedata.normalize("NFD", s.lower())
    return re.sub(r"\s+", " ", "".join(ch for ch in s if unicodedata.category(ch) != "Mn"))


def grep_terms(spec):
    terms = [t for t in spec.get("terms", []) if t and len(t.strip()) >= 3]
    patterns = [re.compile(p, re.IGNORECASE) for p in spec.get("patterns", [])]
    hits = []
    scanned = 0
    for path in spec["files"]:
        low = path.lower()
        try:
            text = docx_text(path) if low.endswith(".docx") else xlsx_text(path) if low.endswith(".xlsx") else None
        except Exception as e:  # unreadable file: report, do not hide
            hits.append({"file": path, "term": None, "context": "NEIZDEVĀS NOLASĪT: %s" % e})
            continue
        if text is None:
            continue
        scanned += 1
        flat = norm(text)
        for pat in patterns:
            for m in list(pat.finditer(text))[:10]:
                hits.append({"file": path, "term": pat.pattern, "context": text[max(0, m.start() - 40): m.end() + 40].replace(chr(10), " ")})
        for term in terms:
            t = norm(term)
            start = 0
            while True:
                i = flat.find(t, start)
                if i < 0:
                    break
                hits.append({"file": path, "term": term, "context": flat[max(0, i - 50): i + len(t) + 50]})
                start = i + len(t)
                if sum(1 for h in hits if h["file"] == path and h["term"] == term) >= 5:
                    break
    return {"ok": True, "scanned": scanned, "hits": hits}


def inspect_xlsx(path):
    """Every sheet as {ref: value} plus merged ranges — enough to find a matrix layout without guessing."""
    import openpyxl

    wb = openpyxl.load_workbook(path, data_only=True)
    sheets = []
    for ws in wb.worksheets:
        cells = {}
        for row in ws.iter_rows():
            for c in row:
                if c.value is not None and str(c.value).strip() != "":
                    cells[c.coordinate] = str(c.value).strip()
        sheets.append({"name": ws.title, "cells": cells, "merged": [str(r) for r in ws.merged_cells.ranges]})
    return {"ok": True, "sheets": sheets}


def _der(buf, i):
    """One DER element at i -> (tag, start_of_value, end)."""
    tag = buf[i]
    ln = buf[i + 1]
    j = i + 2
    if ln & 0x80:
        n = ln & 0x7F
        ln = int.from_bytes(buf[j:j + n], "big")
        j += n
    return tag, j, j + ln


def cert_subject(der):
    """Subject RDNs of an X.509 certificate as {oid: text}. Stdlib only."""
    _, v, _ = _der(der, 0)                 # Certificate
    _, v, _ = _der(der, v)                 # TBSCertificate
    i = v
    tag, s, e = _der(der, i)
    if tag == 0xA0:                        # optional version
        i = e
    for _ in range(4):                     # serial, signature alg, issuer, validity
        _, _, i = _der(der, i)
    _, s, e = _der(der, i)                 # subject Name
    out = {}
    k = s
    while k < e:
        _, rs, re_ = _der(der, k)          # RDN (SET)
        _, as_, ae = _der(der, rs)         # AttributeTypeAndValue (SEQUENCE)
        _, os_, oe = _der(der, as_)        # OID
        oid_b = der[os_:oe]
        parts = [oid_b[0] // 40, oid_b[0] % 40]
        acc = 0
        for b in oid_b[1:]:
            acc = (acc << 7) | (b & 0x7F)
            if not b & 0x80:
                parts.append(acc)
                acc = 0
        _, vs, ve = _der(der, oe)
        try:
            text = der[vs:ve].decode("utf-8")
        except UnicodeDecodeError:
            text = der[vs:ve].decode("latin-1")
        out[".".join(str(p) for p in parts)] = text
        k = re_
    return out


def read_edoc(path):
    """eDoc / ASiC-E: who signed and when. Personal codes are never returned."""
    import base64
    import zipfile
    sig_name = re.compile(r"<(?:\w+:)?X509SubjectName>([^<]+)</", re.I)
    sig_time = re.compile(r"<(?:\w+:)?SigningTime>([^<]+)</", re.I)
    cn_rx = re.compile(r"CN=([^,<]+)")
    cert_rx = re.compile(r"<(?:\w+:)?X509Certificate>([^<]+)</", re.I)
    pnr = re.compile(r"^(PNO[A-Z]{2}-|\d{6}-\d{5})")
    signers = []
    inner = []
    with zipfile.ZipFile(path) as zf:
        for n in zf.namelist():
            if "META-INF" in n and "signature" in n.lower():
                xml = zf.read(n).decode("utf-8", errors="replace")
                times = list(dict.fromkeys(sig_time.findall(xml)))
                subjects = list(dict.fromkeys(sig_name.findall(xml)))
                names = []
                for s in subjects:
                    m = cn_rx.search(s)
                    if m:
                        names.append(m.group(1).strip())
                if not names:
                    for cert in cert_rx.findall(xml)[:1]:
                        try:
                            sub = cert_subject(base64.b64decode("".join(cert.split())))
                        except Exception:
                            continue
                        nm = sub.get("2.5.4.3") or " ".join(x for x in (sub.get("2.5.4.42"), sub.get("2.5.4.4")) if x)
                        if nm:
                            names.append(nm)
                names = [x for x in names if not pnr.match(x)]
                for i, nm in enumerate(names):
                    signers.append({"name": nm, "time": times[i] if i < len(times) else (times[0] if times else None), "file": n})
            elif not n.startswith("META-INF") and n != "mimetype":
                inner.append(n)
    return {"ok": True, "signers": signers, "files": inner}


def write_docx(spec):
    """A plain, new .docx from paragraphs and tables (clarification drafts, letters)."""
    from docx import Document
    dst = spec["dst"]
    if os.path.exists(dst):
        fail("fails jau pastāv: " + dst)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    doc = Document()
    for b in spec.get("blocks", []):
        if b.get("table"):
            rows = b["table"]
            t = doc.add_table(rows=len(rows), cols=max(len(r) for r in rows))
            t.style = "Table Grid"
            for ri, r in enumerate(rows):
                for ci, v in enumerate(r):
                    t.cell(ri, ci).text = str(v)
        elif b.get("heading"):
            doc.add_heading(b["heading"], level=b.get("level", 2))
        else:
            p = doc.add_paragraph()
            run = p.add_run(b.get("text", ""))
            run.bold = bool(b.get("bold"))
    doc.save(dst)
    return {"ok": True, "dst": dst}


def main():
    if len(sys.argv) < 3:
        fail("lietojums: konkurss_tools.py <komanda> <fails>")
    cmd, arg = sys.argv[1], sys.argv[2]
    try:
        if cmd == "inspect-docx":
            out(inspect_docx(arg))
        elif cmd == "fill-docx":
            out(fill_docx(load_spec(arg)))
        elif cmd == "fill-xlsx":
            out(fill_xlsx(load_spec(arg)))
        elif cmd == "inspect-xlsx":
            out(inspect_xlsx(arg))
        elif cmd == "read-edoc":
            out(read_edoc(arg))
        elif cmd == "write-docx":
            out(write_docx(load_spec(arg)))
        elif cmd == "grep-terms":
            out(grep_terms(load_spec(arg)))
        else:
            fail("nezināma komanda: " + cmd)
    except SystemExit:
        raise
    except Exception as e:
        fail("%s: %s" % (type(e).__name__, e))


if __name__ == "__main__":
    main()
