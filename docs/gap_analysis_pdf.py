"""Render the KCC gap analysis as a PDF.

    server/.venv/Scripts/python.exe docs/gap_analysis_pdf.py

The findings live in `gap_analysis_data.py`, shared with the Word renderer, so
the two documents cannot say different things.

This draws the PDF directly rather than converting the .docx — neither Word nor
LibreOffice is installed on this machine, and a converter that silently reflows
a table is worse than laying it out once on purpose.
"""

from __future__ import annotations

import sys
from datetime import date
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    KeepTogether,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)

sys.path.insert(0, str(Path(__file__).resolve().parent))
from gap_analysis_data import (  # noqa: E402
    CROSS_CUTTING,
    FINDINGS,
    PRIORITIES,
    first_sentence,
)

OUT = Path(__file__).resolve().parent / "SWMS-Gap-Analysis.pdf"

INK = colors.HexColor("#1A1A1A")
MUTED = colors.HexColor("#5A5A5A")
RULE = colors.HexColor("#DDDDDD")
GREEN = colors.HexColor("#1B7F3B")
AMBER = colors.HexColor("#9A5B00")
RED = colors.HexColor("#B02A2A")

STATUS_COLOUR = {"Built": GREEN, "Partial": AMBER, "Missing": RED}
STATUS_FILL = {
    "Built": colors.HexColor("#E7F4EA"),
    "Partial": colors.HexColor("#FDF1E0"),
    "Missing": colors.HexColor("#FBE9E9"),
}

TITLE = "Smart Sweep SWMS — Requirements gap analysis"

#: The built-in Type 1 faces encode WinAnsi only, which silently drops any
#: character outside it — the arrows in "collector deposit → agency → KCC" came
#: out as blank gaps. Registering a TrueType face fixes that and matches the
#: Word document, which is Calibri. Falls back to Helvetica so the script still
#: runs on a machine without these fonts, accepting the dropped glyphs there.
FONT_FILES = {
    "regular": (r"C:\Windows\Fonts\calibri.ttf", "Calibri"),
    "bold": (r"C:\Windows\Fonts\calibrib.ttf", "Calibri-Bold"),
    "italic": (r"C:\Windows\Fonts\calibrii.ttf", "Calibri-Italic"),
}


def register_fonts():
    """Return (regular, bold, italic) font names that are safe to use."""
    try:
        for path, name in FONT_FILES.values():
            if not Path(path).exists():
                raise FileNotFoundError(path)
            pdfmetrics.registerFont(TTFont(name, path))
        family = tuple(name for _, name in FONT_FILES.values())
        pdfmetrics.registerFontFamily(
            "Calibri", normal=family[0], bold=family[1], italic=family[2]
        )
        return family
    except Exception:
        return ("Helvetica", "Helvetica-Bold", "Helvetica-Oblique")


REGULAR, BOLD, ITALIC = register_fonts()


def styles():
    base = getSampleStyleSheet()
    s = {}
    s["title"] = ParagraphStyle(
        "title", parent=base["Normal"], fontName=BOLD, fontSize=22,
        leading=26, textColor=INK, spaceAfter=2,
    )
    s["subtitle"] = ParagraphStyle(
        "subtitle", parent=base["Normal"], fontName=REGULAR, fontSize=12.5,
        leading=16, textColor=MUTED, spaceAfter=10,
    )
    s["meta"] = ParagraphStyle(
        "meta", parent=base["Normal"], fontName=REGULAR, fontSize=8.5,
        leading=12, textColor=MUTED, spaceAfter=16,
    )
    s["h1"] = ParagraphStyle(
        "h1", parent=base["Normal"], fontName=BOLD, fontSize=16,
        leading=20, textColor=INK, spaceBefore=16, spaceAfter=6,
    )
    s["h2"] = ParagraphStyle(
        "h2", parent=base["Normal"], fontName=BOLD, fontSize=12.5,
        leading=16, textColor=INK, spaceBefore=14, spaceAfter=5,
    )
    s["body"] = ParagraphStyle(
        "body", parent=base["Normal"], fontName=REGULAR, fontSize=9.5,
        leading=13.5, textColor=INK, spaceAfter=7,
    )
    s["indent"] = ParagraphStyle(
        "indent", parent=s["body"], leftIndent=10, spaceAfter=4,
    )
    s["cell"] = ParagraphStyle(
        "cell", parent=base["Normal"], fontName=REGULAR, fontSize=8.5,
        leading=11, textColor=INK,
    )
    s["cellMuted"] = ParagraphStyle("cellMuted", parent=s["cell"], textColor=MUTED)
    s["cellHead"] = ParagraphStyle(
        "cellHead", parent=s["cell"], fontName=BOLD,
    )
    s["note"] = ParagraphStyle(
        "note", parent=base["Normal"], fontName=ITALIC, fontSize=8,
        leading=11, textColor=MUTED, alignment=TA_CENTER, spaceBefore=18,
    )
    return s


S = styles()


def esc(text: str) -> str:
    """Platypus reads a subset of HTML, so the source text must not look like it."""
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def status_tag(status: str) -> str:
    colour = STATUS_COLOUR[status].hexval()[2:]
    return f'<font color="#{colour}" size="8"><b>{status.upper()}</b></font>'


def rule(width):
    t = Table([[""]], colWidths=[width], rowHeights=[0.6])
    t.setStyle(TableStyle([("LINEBELOW", (0, 0), (-1, -1), 0.6, RULE)]))
    return t


def summary_table(width):
    """Every row the counts are drawn from, so the two can never disagree."""
    rows = [(f[1], f[2], f[4]) for f in FINDINGS]
    rows += [(f"Cross-cutting: {c[0]}", c[1], c[2]) for c in CROSS_CUTTING]

    data = [[
        Paragraph("Requirement", S["cellHead"]),
        Paragraph("Status", S["cellHead"]),
        Paragraph("Principal gap", S["cellHead"]),
    ]]
    style = [
        ("GRID", (0, 0), (-1, -1), 0.4, RULE),
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#EFEFEF")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]

    for index, (requirement, status, missing) in enumerate(rows, start=1):
        short = first_sentence(missing)
        colour = STATUS_COLOUR[status].hexval()[2:]
        data.append([
            Paragraph(esc(requirement), S["cell"]),
            Paragraph(f'<font color="#{colour}"><b>{status}</b></font>', S["cell"]),
            Paragraph(esc(short), S["cellMuted"]),
        ])
        style.append(("BACKGROUND", (1, index), (1, index), STATUS_FILL[status]))

    table = Table(
        data, colWidths=[width * 0.42, width * 0.12, width * 0.46], repeatRows=1
    )
    table.setStyle(TableStyle(style))
    return table


def legend(width):
    cells, style = [], [
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 7),
        ("RIGHTPADDING", (0, 0), (-1, -1), 7),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]
    for i, (label, meaning) in enumerate([
        ("Built", "In the product and usable today"),
        ("Partial", "The foundation exists; something specific is missing"),
        ("Missing", "Not addressed at all"),
    ]):
        colour = STATUS_COLOUR[label].hexval()[2:]
        cells.append(Paragraph(
            f'<font color="#{colour}"><b>{label}</b></font><br/>'
            f'<font size="8" color="#5A5A5A">{meaning}</font>', S["cell"]))
        style.append(("BACKGROUND", (i, 0), (i, 0), STATUS_FILL[label]))
    table = Table([cells], colWidths=[width / 3.0] * 3)
    table.setStyle(TableStyle(style))
    return table


def chrome(canvas, doc):
    """Running header and page number, drawn on every page but the first."""
    canvas.saveState()
    if doc.page > 1:
        canvas.setFont(REGULAR, 7.5)
        canvas.setFillColor(MUTED)
        canvas.drawString(20 * mm, A4[1] - 12 * mm, TITLE)
        canvas.setStrokeColor(RULE)
        canvas.setLineWidth(0.4)
        canvas.line(20 * mm, A4[1] - 14 * mm, A4[0] - 20 * mm, A4[1] - 14 * mm)
    canvas.setFont(REGULAR, 7.5)
    canvas.setFillColor(MUTED)
    canvas.drawCentredString(A4[0] / 2, 12 * mm, str(doc.page))
    canvas.restoreState()


def build():
    doc = BaseDocTemplate(
        str(OUT), pagesize=A4,
        leftMargin=20 * mm, rightMargin=20 * mm,
        topMargin=20 * mm, bottomMargin=18 * mm,
        title=TITLE, author="Smart Sweep SWMS",
    )
    frame = Frame(
        doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="body",
        leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0,
    )
    doc.addPageTemplates([PageTemplate(id="all", frames=[frame], onPage=chrome)])
    width = doc.width
    story = []

    # ---- opening --------------------------------------------------------- #
    story.append(Paragraph("Smart Sweep SWMS", S["title"]))
    story.append(Paragraph(
        "Requirements gap analysis against the KCC stakeholder document", S["subtitle"]))
    story.append(rule(width))
    story.append(Spacer(1, 8))
    story.append(Paragraph(
        f"Prepared {date.today():%d %B %Y}&nbsp; · &nbsp;"
        f"Source: Documents.docx (KCC, primary collectors, data management)"
        f"&nbsp; · &nbsp;Reviewed against the live application", S["meta"]))

    story.append(Paragraph("How to read this", S["h2"]))
    story.append(Paragraph(
        "Every requirement in the source document has been checked against the "
        "application as it actually stands — the database models, the API routes and "
        "the screens — rather than against a feature list. Each item is marked:",
        S["body"]))
    story.append(legend(width))
    story.append(Spacer(1, 10))
    story.append(Paragraph(
        "The headline: the household and property registry, billing and money trail, "
        "complaints, routes, vehicles and the new survey module are substantially "
        "built. The gaps cluster in three places — anything that has to leave the "
        "system and reach a person (notifications, campaigns, published tariffs), "
        "anything about the workforce beyond who they are (attendance, training, PPE, "
        "health, salary), and anything about service geography finer than a ward "
        "(road-wise operator assignment, dumping points, bins).", S["body"]))

    # ---- summary --------------------------------------------------------- #
    counts = {"Built": 0, "Partial": 0, "Missing": 0}
    for finding in FINDINGS:
        counts[finding[2]] += 1
    for item in CROSS_CUTTING:
        counts[item[1]] += 1

    story.append(Paragraph("Summary", S["h2"]))
    story.append(Paragraph(
        f"{sum(counts.values())} requirement areas assessed: {counts['Built']} built, "
        f"{counts['Partial']} partial, {counts['Missing']} missing.", S["body"]))
    story.append(summary_table(width))
    story.append(PageBreak())

    # ---- detail ---------------------------------------------------------- #
    story.append(Paragraph("Findings in detail", S["h1"]))
    current_section = None
    for section, requirement, status, have, missing in FINDINGS:
        if section != current_section:
            story.append(Paragraph(esc(section), S["h2"]))
            current_section = section

        block = [Paragraph(
            f"<b>{esc(requirement)}</b> &nbsp; {status_tag(status)}", S["body"])]
        block.append(Paragraph(
            f"<b>What exists.</b>  {esc(have)}", S["indent"]))
        if missing.strip() != "—":
            colour = RED.hexval()[2:]
            block.append(Paragraph(
                f'<font color="#{colour}"><b>What is missing.</b></font>  {esc(missing)}',
                S["indent"]))
        # A finding split across a page break reads as two unrelated fragments.
        story.append(KeepTogether(block))
        story.append(Spacer(1, 6))

    # ---- cross-cutting --------------------------------------------------- #
    story.append(Paragraph("Cross-cutting requirements", S["h2"]))
    story.append(Paragraph(
        "The document closes by asking for a system that is mobile-friendly, "
        "Bengali-supported, role-based and introduced gradually to workers with "
        "limited digital skills. Those are assessed separately here because they cut "
        "across every module.", S["body"]))
    for item in CROSS_CUTTING:
        name, status, note = item[0], item[1], item[2]
        story.append(KeepTogether([
            Paragraph(f"<b>{esc(name)}</b> &nbsp; {status_tag(status)}", S["body"]),
            Paragraph(esc(note), S["indent"]),
        ]))
        story.append(Spacer(1, 4))

    story.append(PageBreak())

    # ---- priorities ------------------------------------------------------ #
    story.append(Paragraph("Recommended order of work", S["h1"]))
    story.append(Paragraph(
        "Ordered by what the document treats as urgent, weighted towards work that "
        "unblocks several gaps at once and that builds on what is already there. "
        "Effort is relative to the modules already delivered, not an estimate in days.",
        S["body"]))

    for rank, name, refs, why, effort in PRIORITIES:
        story.append(KeepTogether([
            Paragraph(
                f'<font color="#5A5A5A"><b>{rank}.</b></font> &nbsp;<b>{esc(name)}</b>'
                f'&nbsp; <font size="8" color="#5A5A5A">({esc(refs)})</font>', S["body"]),
            Paragraph(esc(why), S["indent"]),
            Paragraph(
                f'<font size="8.5" color="#5A5A5A"><b>Effort:</b> {esc(effort)}</font>',
                S["indent"]),
        ]))
        story.append(Spacer(1, 5))

    # ---- closing --------------------------------------------------------- #
    story.append(Paragraph("A note on what is already strong", S["h2"]))
    story.append(Paragraph(
        "The document’s stated first phase is “household registry, road-wise operator "
        "mapping, daily work reporting, complaint management, fee and royalty tracking, "
        "workforce and van records, and a KCC monitoring dashboard”. Six of those seven "
        "are built or close to it. Road-wise operator mapping is the one that is not "
        "started, and workforce records are the one that is thinnest — which is why "
        "they sit first and fourth in the list above.", S["body"]))
    story.append(Paragraph(
        "The survey module delivered most recently also covers the document’s "
        "“survey data collection sheet” requirement more thoroughly than asked: the "
        "questionnaire is stored as data rather than code, so a revised form is a "
        "configuration change, and a reviewed survey can be promoted straight into the "
        "holding register.", S["body"]))
    story.append(Paragraph(
        "Prepared from the source requirements document and a direct review of the "
        "application code.", S["note"]))

    doc.build(story)
    return OUT


if __name__ == "__main__":
    print(f"Wrote {build()}")
