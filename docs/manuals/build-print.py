"""Print-ready versions of the user manuals: one combined HTML page and a PDF per user type.

    python docs/manuals/build-print.py            # Bangla (docs/manuals/bn)
    python docs/manuals/build-print.py en         # English (docs/manuals)

Writes into <manuals>/print/:
    all-manuals.html      every manual, each starting on a new page — open in a
                          browser and press Ctrl+P to print or save as PDF
    all-manuals.pdf       the same, as one PDF
    <role>.pdf            one PDF per user type

No packages needed: the Markdown subset the manuals use is converted here, and
the PDFs are printed by headless Chrome or Edge. Bangla text uses Nirmala UI
(installed with Windows), falling back to Hind Siliguri or Vrinda.
"""

from __future__ import annotations

import html
import re
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
LANG = (sys.argv[1] if len(sys.argv) > 1 else "bn").lower()
SRC = HERE / "bn" if LANG == "bn" else HERE
OUT = SRC / "print"

# Reading order: the index, then the users from the City down to the resident.
ORDER = ["README", "city-viewer", "agency-admin", "supervisor", "collector", "holding-owner", "super-admin"]

BROWSERS = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
]

CSS = """
@page { size: A4; margin: 18mm 16mm 18mm 16mm; }
* { box-sizing: border-box; }
body { font-family: 'Nirmala UI', 'Hind Siliguri', 'Vrinda', 'Segoe UI', Arial, sans-serif;
       font-size: 11.5pt; line-height: 1.6; color: #16241E; margin: 0; }
.manual { page-break-after: always; }
.manual:last-child { page-break-after: auto; }
.cover { border-bottom: 3px solid #2F8F5B; padding-bottom: 10px; margin-bottom: 14px; }
.brand { color: #2F8F5B; font-weight: 700; letter-spacing: 1px; font-size: 10pt; }
h1 { font-size: 20pt; color: #12372A; margin: 4px 0 0; line-height: 1.3; }
h2 { font-size: 14.5pt; color: #12372A; margin: 18px 0 6px; padding-bottom: 3px;
     border-bottom: 1px solid #D4DCCF; page-break-after: avoid; }
h3 { font-size: 12.5pt; color: #1C4A3A; margin: 12px 0 4px; page-break-after: avoid; }
h4 { font-size: 11.5pt; margin: 10px 0 4px; }
p { margin: 5px 0; }
ul, ol { margin: 4px 0 8px; padding-left: 22px; }
li { margin: 2px 0; }
table { border-collapse: collapse; width: 100%; margin: 6px 0 10px; font-size: 10.5pt; page-break-inside: auto; }
tr { page-break-inside: avoid; }
th { background: #E8F0E4; color: #12372A; text-align: left; font-weight: 700; }
th, td { border: 1px solid #CBD5D0; padding: 4px 7px; vertical-align: top; }
tr:nth-child(even) td { background: #F6F8F4; }
code { font-family: Consolas, 'Courier New', monospace; font-size: 10pt; background: #F2F4F1;
       padding: 0 3px; border-radius: 3px; }
blockquote { margin: 8px 0; padding: 6px 10px; background: #F7F0DC; border-left: 4px solid #8A7530; }
hr { border: none; border-top: 1px solid #D4DCCF; margin: 12px 0; }
strong { color: #12372A; }
.toc { margin: 8px 0 0; }
.toc li { margin: 3px 0; }
@media screen { body { max-width: 900px; margin: 24px auto; padding: 0 24px; }
                .manual { border-bottom: 2px dashed #ccc; padding-bottom: 32px; margin-bottom: 32px; } }
"""


def inline(text: str) -> str:
    """Escape, then **bold**, *italic*, `code`; links keep only their text."""
    text = html.escape(text, quote=False)
    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)
    text = re.sub(r"`([^`]+)`", r"<code>\1</code>", text)
    text = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", text)
    text = re.sub(r"(?<![*\w])\*([^*\s][^*]*?)\*(?![*\w])", r"<em>\1</em>", text)
    return text


def cells(line: str) -> list[str]:
    return [c.strip() for c in line.strip().strip("|").split("|")]


def convert(md: str) -> str:
    """The Markdown subset the manuals use: headings, rules, tables, lists, quotes, paragraphs."""
    lines = md.replace("\r\n", "\n").split("\n")
    out: list[str] = []
    i = 0
    while i < len(lines):
        line = lines[i]
        s = line.strip()
        if not s:
            i += 1
            continue
        m = re.match(r"^(#{1,4})\s+(.*)$", s)
        if m:
            level = len(m.group(1))
            out.append(f"<h{level}>{inline(m.group(2))}</h{level}>")
            i += 1
            continue
        if s == "---":
            out.append("<hr>")
            i += 1
            continue
        if s.startswith("|"):
            block = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                block.append(lines[i])
                i += 1
            head, body = block[0], [b for b in block[2:]] if len(block) > 1 and re.match(r"^\|?\s*:?-", block[1].strip()) else block[1:]
            rows = ["<tr>" + "".join(f"<th>{inline(c)}</th>" for c in cells(head)) + "</tr>"]
            rows += ["<tr>" + "".join(f"<td>{inline(c)}</td>" for c in cells(b)) + "</tr>" for b in body]
            out.append("<table>" + "".join(rows) + "</table>")
            continue
        if s.startswith(">"):
            quote = []
            while i < len(lines) and lines[i].strip().startswith(">"):
                quote.append(lines[i].strip().lstrip(">").strip())
                i += 1
            out.append(f"<blockquote>{inline(' '.join(quote))}</blockquote>")
            continue
        ordered = re.match(r"^\d+\.\s+", s)
        if ordered or s.startswith("- "):
            tag = "ol" if ordered else "ul"
            # A numbered list split by a table carries on from its own number.
            start = f' start="{int(ordered.group(0).split(".")[0])}"' if ordered and not s.startswith("1.") else ""
            items: list[str] = []
            while i < len(lines):
                cur = lines[i]
                cs = cur.strip()
                is_item = re.match(r"^\d+\.\s+", cs) if tag == "ol" else cs.startswith("- ")
                if is_item and not cur.startswith("  "):
                    items.append(re.sub(r"^(\d+\.|-)\s+", "", cs))
                    i += 1
                elif cs and cur.startswith(" ") and items:  # continuation line
                    items[-1] += " " + cs
                    i += 1
                else:
                    break
            out.append(f"<{tag}{start}>" + "".join(f"<li>{inline(it)}</li>" for it in items) + f"</{tag}>")
            continue
        para = [s]
        i += 1
        while i < len(lines) and lines[i].strip() and not re.match(r"^(#{1,4}\s|\||>|- |\d+\.\s|---$)", lines[i].strip()):
            para.append(lines[i].strip())
            i += 1
        out.append(f"<p>{inline(' '.join(para))}</p>")
    return "\n".join(out)


def manual_html(name: str) -> tuple[str, str]:
    md = (SRC / f"{name}.md").read_text(encoding="utf-8")
    title = re.search(r"^#\s+(.*)$", md, re.M).group(1)
    body = convert(re.sub(r"^#\s+.*$", "", md, count=1, flags=re.M))
    brand = "স্মার্ট সুইপ · ব্যবহারকারী ম্যানুয়াল" if LANG == "bn" else "SMART SWEEP · USER MANUAL"
    section = (f'<section class="manual" id="{name}"><div class="cover"><div class="brand">{brand}</div>'
               f"<h1>{inline(title)}</h1></div>{body}</section>")
    return title, section


def page(title: str, sections: list[str]) -> str:
    lang = "bn" if LANG == "bn" else "en"
    return (f'<!doctype html><html lang="{lang}"><head><meta charset="utf-8">'
            f'<meta name="viewport" content="width=device-width, initial-scale=1">'
            f"<title>{html.escape(title)}</title>"
            '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Hind+Siliguri:wght@400;600;700&display=swap">'
            f"<style>{CSS}</style></head><body>{''.join(sections)}</body></html>")


def to_pdf(browser: str, html_file: Path, pdf_file: Path) -> bool:
    cmd = [browser, "--headless=new", "--disable-gpu", "--no-pdf-header-footer",
           f"--print-to-pdf={pdf_file}", html_file.as_uri()]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    return result.returncode == 0 and pdf_file.exists() and pdf_file.stat().st_size > 0


def main() -> None:
    OUT.mkdir(exist_ok=True)
    built = {name: manual_html(name) for name in ORDER if (SRC / f"{name}.md").exists()}
    combined_title = "স্মার্ট সুইপ — ব্যবহারকারী ম্যানুয়াল" if LANG == "bn" else "Smart Sweep — User Manuals"
    combined = OUT / "all-manuals.html"
    combined.write_text(page(combined_title, [s for _, s in built.values()]), encoding="utf-8")
    print(f"wrote {combined}")

    browser = next((b for b in BROWSERS if Path(b).exists()), None) or shutil.which("chrome") or shutil.which("msedge")
    if not browser:
        print("No Chrome or Edge found: open all-manuals.html in a browser and press Ctrl+P.")
        return
    tmp = OUT / "_single"
    tmp.mkdir(exist_ok=True)
    jobs = [(combined, OUT / "all-manuals.pdf")]
    for name, (title, section) in built.items():
        if name == "README":
            continue
        single = tmp / f"{name}.html"
        single.write_text(page(title, [section]), encoding="utf-8")
        jobs.append((single, OUT / f"{name}.pdf"))
    for src, dst in jobs:
        ok = to_pdf(browser, src, dst)
        print(("wrote " if ok else "FAILED ") + str(dst))
    shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    main()
