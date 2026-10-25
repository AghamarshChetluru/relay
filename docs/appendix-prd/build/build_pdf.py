"""Build Relay_Complete_PRD_Appendix.pdf from Relay_Complete_PRD_Appendix.md.

    python3 docs/appendix-prd/build/build_pdf.py

The Markdown is the editable source. Pages are separated by <!--page:Name--> markers; each becomes one A4 page.
Requires: pip install markdown ; Google Chrome (headless print to PDF). Screenshots/diagrams come from ../assets.
"""
import re
import subprocess
import sys
from pathlib import Path

import markdown

ROOT = Path(__file__).resolve().parent.parent
MD = ROOT / "Relay_Complete_PRD_Appendix.md"
HTML = ROOT / "Relay_Complete_PRD_Appendix.html"
PDF = ROOT / "Relay_Complete_PRD_Appendix.pdf"
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

CSS = """
@page { size: 210mm 297mm; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #fbf5e6; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #14263a; font-size: 8.6pt; line-height: 1.36; }
.page { width: 210mm; height: 297mm; padding: 11mm 14mm 14mm; position: relative; break-after: page; background: #fbf5e6; overflow: hidden; }
.page:last-child { break-after: auto; }
.foot { position: absolute; left: 14mm; right: 14mm; bottom: 6mm; display: flex; justify-content: space-between; font-size: 6.8pt; color: #7a7566; border-top: 0.3mm solid #e3d9bf; padding-top: 1.4mm; }
h1 { font-family: Georgia, 'Times New Roman', serif; font-size: 17pt; line-height: 1.15; margin: 0 0 3.2mm; padding-bottom: 1.6mm; border-bottom: 0.9mm solid #d9a21b; }
h3 { font-size: 7.8pt; letter-spacing: .09em; text-transform: uppercase; color: #8a6a0f; margin: 3.2mm 0 1.4mm; }
p { margin: 0 0 2mm; }
b, strong { font-weight: 700; }
a { color: #0f4fa8; text-decoration: none; }
ul, ol { margin: 0 0 2mm; padding-left: 4.4mm; }
li { margin: 0 0 .9mm; }
table { width: 100%; border-collapse: collapse; margin: 0 0 3mm; font-size: 7.4pt; line-height: 1.3; break-inside: avoid; }
th { background: #efe3c2; text-align: left; font-weight: 700; padding: 1.1mm 1.6mm; border: 0.25mm solid #d8cba5; }
td { padding: 1.1mm 1.6mm; vertical-align: top; border: 0.25mm solid #e3d9bf; background: #fffdf7; }
.cols2 { display: grid; grid-template-columns: 1fr 1fr; gap: 5mm; align-items: start; }
.cols2 > div > :first-child { margin-top: 0; }
.cols2 table { margin-bottom: 2mm; }
.masthead { display: flex; align-items: center; gap: 6mm; margin: 0 0 4mm; padding-bottom: 3mm; border-bottom: 0.3mm solid #e3d9bf; }
.masthead .logo { height: 17mm; width: auto; }
.kicker { font-size: 7.4pt; letter-spacing: .14em; font-weight: 700; color: #8a6a0f; margin-bottom: 1mm; }
.mast-sub { font-size: 8pt; color: #3b4a5c; }
.legend { font-size: 7.6pt; line-height: 2; margin: 0 0 2mm; }
.toc { font-size: 7.8pt; margin-top: 3mm; padding: 2mm 3mm; background: #fff7e0; border-radius: 1.6mm; border: 0.25mm solid #e3d9bf; }
.tag { display: inline-block; font-size: 6pt; font-weight: 700; letter-spacing: .04em; padding: .15mm 1.5mm; border-radius: 1.6mm; white-space: nowrap; }
.tag.impl { background: #e7f1ff; color: #0f4fa8; }
.tag.test { background: #e4f4e8; color: #1b6a3a; }
.tag.team { background: #fbecc4; color: #7a5a05; }
.tag.prop { background: #f1efe8; color: #5d5a50; border: 0.25mm dashed #8a8576; }
figure { margin: 0; }
figcaption { font-size: 6.9pt; line-height: 1.3; color: #4a5565; margin-top: 1mm; }
figure.wide { margin: 1mm 0 3mm; }
figure.wide img { width: 100%; display: block; }
.phones { display: flex; justify-content: center; gap: 4mm; margin: 0 0 3mm; }
.phones figure { width: 83mm; }
.phones img { width: 100%; display: block; }
figure.strip { margin: 0 0 2.4mm; }
figure.strip img { width: 100%; display: block; }
"""


def build():
    text = MD.read_text(encoding="utf-8")
    chunks = re.split(r"<!--page:(.*?)-->", text)
    pages = list(zip(chunks[1::2], chunks[2::2]))
    md = markdown.Markdown(extensions=["tables", "md_in_html", "attr_list"])
    out = []
    for n, (name, body) in enumerate(pages, start=1):
        md.reset()
        html = md.convert(body.strip())
        out.append(
            f'<section class="page" id="p{n}">{html}'
            f'<div class="foot"><span>Relay · Product Requirements Document (as-built appendix) · {name}</span><span>{n}</span></div></section>'
        )
    doc = f'<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Relay: Product Requirements Document (appendix)</title><style>{CSS}</style></head><body>{"".join(out)}</body></html>'
    HTML.write_text(doc, encoding="utf-8")
    subprocess.run(
        [CHROME, "--headless=new", "--disable-gpu", "--no-pdf-header-footer", f"--user-data-dir={ROOT}/build/.chrome-profile",
         f"--print-to-pdf={PDF}", "--virtual-time-budget=15000", HTML.as_uri()],
        check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    print(f"{len(pages)} pages -> {PDF}")


if __name__ == "__main__":
    sys.exit(build())
