/* Smart Sweep SWMS — end-user manual, as a Word document.
 *
 *   node build-user-manual.cjs Smart-Sweep-User-Manual.docx
 *
 * The text comes from USER-MANUAL.md; this file only decides how it looks.
 */

const fs = require('fs')
const {
  AlignmentType, BorderStyle, Document, Footer, Header, HeadingLevel, LevelFormat,
  PageBreak, PageNumber, Packer, Paragraph, ShadingType, Table, TableCell, TableRow,
  TableOfContents, TextRun, VerticalAlign, WidthType,
} = require('docx')

// --------------------------------------------------------------------------- //
// Palette — the app's deep forest green, light and dark surfaces
// --------------------------------------------------------------------------- //

const GREEN_DARK = '1F3D2B'
const GREEN = '2E5339'
const GREEN_MID = '5A7A4A'
const FILL_GREEN = 'E8F0E4'
const FILL_GREY = 'F2F4F1'
const FILL_WARN = 'F7F0DC'
const RULE_WARN = '8A7530'
const FILL_STOP = 'F5E0DC'
const RULE_STOP = 'A4553F'
const TEXT = '1A1A1A'
const MUTED = '5A5A5A'
const BORDER = 'D4DCCF'

const FONT = 'Calibri'

// A4 (11906 DXA) less 1" margins each side.
const CONTENT_W = 9026

// --------------------------------------------------------------------------- //
// Building blocks
// --------------------------------------------------------------------------- //

/** Inline markup: **bold**, *italic*, `code`. */
function runs(text, base = {}) {
  const out = []
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g
  let last = 0
  let m
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(new TextRun({ text: text.slice(last, m.index), ...base }))
    const token = m[0]
    if (token.startsWith('**')) {
      out.push(new TextRun({ text: token.slice(2, -2), bold: true, ...base }))
    } else if (token.startsWith('`')) {
      out.push(new TextRun({
        text: token.slice(1, -1), font: 'Consolas', size: 19,
        color: GREEN_DARK, shading: { type: ShadingType.CLEAR, fill: FILL_GREY },
        ...base,
      }))
    } else {
      out.push(new TextRun({ text: token.slice(1, -1), italics: true, ...base }))
    }
    last = m.index + token.length
  }
  if (last < text.length) out.push(new TextRun({ text: text.slice(last), ...base }))
  return out
}

const p = (text, opts = {}) => new Paragraph({
  children: runs(text),
  spacing: { after: 140, line: 276 },
  ...opts,
})

const lead = (text) => new Paragraph({
  children: runs(text, { size: 23, color: MUTED }),
  spacing: { after: 200, line: 288 },
})

const h1 = (text) => new Paragraph({
  heading: HeadingLevel.HEADING_1,
  children: [new TextRun({ text, bold: true, size: 34, color: GREEN_DARK, font: FONT })],
  spacing: { before: 360, after: 160 },
  border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: GREEN_MID, space: 6 } },
})

const h2 = (text) => new Paragraph({
  heading: HeadingLevel.HEADING_2,
  children: [new TextRun({ text, bold: true, size: 27, color: GREEN, font: FONT })],
  spacing: { before: 300, after: 120 },
})

const h3 = (text) => new Paragraph({
  heading: HeadingLevel.HEADING_3,
  children: [new TextRun({ text, bold: true, size: 23, color: GREEN_DARK, font: FONT })],
  spacing: { before: 220, after: 100 },
})

const bullets = (items) => items.map((t) => new Paragraph({
  children: runs(t),
  numbering: { reference: 'bullets', level: 0 },
  spacing: { after: 80, line: 276 },
}))

// Each numbered list needs its own numbering instance, or Word continues the
// count from the previous one — the Billing steps come out as 7, 8, 9, 10.
const stepRefs = []
const steps = (items) => {
  const reference = `steps-${stepRefs.length}`
  stepRefs.push(reference)
  return items.map((t) => new Paragraph({
    children: runs(t),
    numbering: { reference, level: 0 },
    spacing: { after: 80, line: 276 },
  }))
}

/** A shaded callout box with a coloured left rule. */
function callout(label, lines, { fill = FILL_GREEN, rule = GREEN_MID } = {}) {
  const body = []
  if (label) {
    body.push(new Paragraph({
      children: [new TextRun({ text: label.toUpperCase(), bold: true, size: 17, color: rule, font: FONT })],
      spacing: { after: 60 },
    }))
  }
  lines.forEach((line, i) => body.push(new Paragraph({
    children: runs(line),
    spacing: { after: i === lines.length - 1 ? 0 : 100, line: 276 },
  })))

  return new Table({
    columnWidths: [CONTENT_W],
    width: { size: CONTENT_W, type: WidthType.DXA },
    borders: {
      top: { style: BorderStyle.NIL }, bottom: { style: BorderStyle.NIL },
      right: { style: BorderStyle.NIL }, insideHorizontal: { style: BorderStyle.NIL },
      insideVertical: { style: BorderStyle.NIL },
      left: { style: BorderStyle.SINGLE, size: 18, color: rule },
    },
    rows: [new TableRow({
      children: [new TableCell({
        width: { size: CONTENT_W, type: WidthType.DXA },
        shading: { type: ShadingType.CLEAR, fill },
        margins: { top: 160, bottom: 160, left: 220, right: 220 },
        children: body,
      })],
    })],
  })
}

const note = (lines) => callout('Note', lines)
const warn = (lines) => callout('Important', lines, { fill: FILL_WARN, rule: RULE_WARN })
const stop = (lines) => callout('Take care', lines, { fill: FILL_STOP, rule: RULE_STOP })

/** Table with a green header row. `widths` must sum to CONTENT_W. */
function table(headers, rows, widths, { align = [] } = {}) {
  const cell = (text, w, { head = false, i = 0, zebra = false } = {}) => new TableCell({
    width: { size: w, type: WidthType.DXA },
    shading: { type: ShadingType.CLEAR, fill: head ? GREEN : (zebra ? FILL_GREY : 'FFFFFF') },
    margins: { top: 90, bottom: 90, left: 130, right: 130 },
    verticalAlign: VerticalAlign.CENTER,
    children: [new Paragraph({
      children: head
        ? [new TextRun({ text, bold: true, color: 'FFFFFF', size: 20, font: FONT })]
        : runs(String(text), { size: 20 }),
      alignment: align[i] === 'center' ? AlignmentType.CENTER : AlignmentType.LEFT,
      spacing: { after: 0, line: 260 },
    })],
  })

  return new Table({
    columnWidths: widths,
    width: { size: CONTENT_W, type: WidthType.DXA },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: BORDER },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: BORDER },
      left: { style: BorderStyle.SINGLE, size: 4, color: BORDER },
      right: { style: BorderStyle.SINGLE, size: 4, color: BORDER },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: BORDER },
      insideVertical: { style: BorderStyle.SINGLE, size: 4, color: BORDER },
    },
    rows: [
      new TableRow({
        tableHeader: true,
        children: headers.map((t, i) => cell(t, widths[i], { head: true, i })),
      }),
      ...rows.map((r, ri) => new TableRow({
        children: r.map((t, i) => cell(t, widths[i], { i, zebra: ri % 2 === 1 })),
      })),
    ],
  })
}

const spacer = (after = 200) => new Paragraph({ text: '', spacing: { after } })
const pageBreak = () => new Paragraph({ children: [new PageBreak()] })

// --------------------------------------------------------------------------- //
// Title page
// --------------------------------------------------------------------------- //

const titlePage = [
  spacer(1400),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 60 },
    children: [new TextRun({ text: 'SMART SWEEP', bold: true, size: 72, color: GREEN_DARK, font: FONT })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 420 },
    children: [new TextRun({
      text: 'Solid Waste Management System', size: 30, color: GREEN_MID, font: FONT,
    })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 200, after: 200 },
    border: {
      top: { style: BorderStyle.SINGLE, size: 12, color: GREEN_MID, space: 14 },
      bottom: { style: BorderStyle.SINGLE, size: 12, color: GREEN_MID, space: 14 },
    },
    children: [new TextRun({ text: 'User Manual', bold: true, size: 52, color: TEXT, font: FONT })],
  }),
  spacer(600),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 100 },
    children: [new TextRun({
      text: 'Multi-city · Khulna City Corporation pilot', size: 26, color: TEXT, font: FONT,
    })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 100 },
    children: [new TextRun({
      text: 'For collectors, supervisors, administrators and City Corporation staff',
      size: 21, color: MUTED, italics: true, font: FONT,
    })],
  }),
  spacer(1800),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: 'Version 2.0', size: 20, color: MUTED, font: FONT })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: 'October 2026', size: 20, color: MUTED, font: FONT })],
  }),
  pageBreak(),
]

// --------------------------------------------------------------------------- //
// Contents
// --------------------------------------------------------------------------- //

const contents = [
  // Deliberately not a Heading style — a heading here would list itself in the
  // table of contents it introduces.
  new Paragraph({
    spacing: { before: 360, after: 160 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: GREEN_MID, space: 6 } },
    children: [new TextRun({ text: 'Contents', bold: true, size: 34, color: GREEN_DARK, font: FONT })],
  }),
  new Paragraph({
    spacing: { after: 240 },
    children: runs('*Ctrl-click an entry to jump to it. If you edit this document, right-click the list and choose “Update Field” to refresh the page numbers.*',
      { size: 19, color: MUTED }),
  }),
  new TableOfContents('Contents', { hyperlink: true, headingStyleRange: '1-2' }),
  pageBreak(),
]

// --------------------------------------------------------------------------- //
// Body — read from USER-MANUAL.md
// --------------------------------------------------------------------------- //
//
// The manual is written once, in docs/USER-MANUAL.md, and this file renders it.
// It used to carry its own copy of every sentence, and the two drifted apart;
// now an edit to the Markdown is an edit to the Word document too.
//
// The subset understood is the one the manual uses: ## / ### / #### headings,
// paragraphs, "- " bullets, "1. " steps, "> " callouts, pipe tables (":---:"
// centres a column), and inline **bold**, *italic*, `code` and [links](…),
// which keep their text. The title, intro and the Markdown "Contents" list are
// skipped — the title page and Word's own table of contents replace them.

const path = require('path')

const MANUAL = path.join(__dirname, 'USER-MANUAL.md')

/** Links keep their text; table cells may escape a pipe as \|. */
const inline = (text) => text
  .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
  .replace(/\\\|/g, '|')
  .trim()

const splitRow = (line) => line
  .trim()
  .replace(/^\|/, '')
  .replace(/\|$/, '')
  .split(/(?<!\\)\|/)
  .map(inline)

/** Column widths in proportion to their longest cell, summing to CONTENT_W. */
function widthsFor(rows) {
  const columns = rows[0].length
  const weight = Array.from({ length: columns }, (_, i) => Math.max(
    3, ...rows.map((r) => Math.min((r[i] || '').length, 60)),
  ))
  const total = weight.reduce((a, b) => a + b, 0)
  const widths = weight.map((w) => Math.max(700, Math.round((w / total) * CONTENT_W)))
  const drift = CONTENT_W - widths.reduce((a, b) => a + b, 0)
  widths[widths.indexOf(Math.max(...widths))] += drift
  return widths
}

function renderMarkdown(source) {
  const lines = source.replace(/\r\n/g, '\n').split('\n')
  const out = []

  // Skip the title, intro links and the Contents list: start at the first
  // "## " heading after "## Contents".
  let i = lines.findIndex((l) => l.startsWith('## ') && !l.startsWith('## Contents'))
  const intro = lines.slice(0, i)
    .filter((l) => l && !l.startsWith('#') && !l.startsWith('**') && !l.startsWith('Companion')
      && !l.startsWith('---') && !l.startsWith('- '))
  if (intro.length) out.push(lead(inline(intro.join(' '))))

  const isBlockStart = (l) => /^(#{2,4} |- |\d+\. |> |\||---)/.test(l)

  while (i < lines.length) {
    const line = lines[i]

    if (!line.trim() || line.trim() === '---') { i += 1; continue }

    if (line.startsWith('#### ')) { out.push(h3(inline(line.slice(5)))); i += 1; continue }
    if (line.startsWith('### ')) { out.push(h2(inline(line.slice(4)))); i += 1; continue }
    if (line.startsWith('## ')) { out.push(h1(inline(line.slice(3)))); i += 1; continue }

    if (line.startsWith('|')) {
      const block = []
      while (i < lines.length && lines[i].startsWith('|')) { block.push(lines[i]); i += 1 }
      const headers = splitRow(block[0])
      const align = splitRow(block[1]).map((c) => (/^:-+:$/.test(c) ? 'center' : 'left'))
      const rows = block.slice(2).map(splitRow)
      out.push(table(headers, rows, widthsFor([headers, ...rows]), { align }), spacer(120))
      continue
    }

    if (line.startsWith('> ')) {
      const quote = []
      while (i < lines.length && lines[i].startsWith('>')) {
        quote.push(lines[i].replace(/^>\s?/, ''))
        i += 1
      }
      // Paragraphs inside the quote are separated by a bare ">".
      const paras = quote.join('\n').split(/\n\s*\n/).map((t) => inline(t.replace(/\n/g, ' ')))
      // A callout that opens in bold states a rule; give it the warning style.
      out.push(paras[0].startsWith('**') ? warn(paras) : note(paras), spacer(120))
      continue
    }

    if (/^- /.test(line) || /^\d+\. /.test(line)) {
      const numbered = /^\d+\. /.test(line)
      const items = []
      while (i < lines.length && (numbered ? /^\d+\. /.test(lines[i]) : /^- /.test(lines[i]))) {
        let item = lines[i].replace(numbered ? /^\d+\.\s+/ : /^-\s+/, '')
        i += 1
        // Continuation lines are indented.
        while (i < lines.length && /^\s{2,}\S/.test(lines[i])) { item += ` ${lines[i].trim()}`; i += 1 }
        items.push(inline(item))
      }
      out.push(...(numbered ? steps(items) : bullets(items)))
      continue
    }

    const para = []
    while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i])) {
      para.push(lines[i].trim())
      i += 1
    }
    out.push(p(inline(para.join(' '))))
  }
  return out
}

const body = renderMarkdown(fs.readFileSync(MANUAL, 'utf8'))

// --------------------------------------------------------------------------- //
// Document
// --------------------------------------------------------------------------- //

const doc = new Document({
  creator: 'Smart Sweep',
  title: 'Smart Sweep SWMS — User Manual',
  description: 'End-user manual for the Smart Sweep Solid Waste Management System.',
  styles: {
    default: {
      document: { run: { font: FONT, size: 21, color: TEXT } },
    },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', quickFormat: true, run: { font: FONT } },
      { id: 'Heading2', name: 'Heading 2', quickFormat: true, run: { font: FONT } },
      { id: 'Heading3', name: 'Heading 3', quickFormat: true, run: { font: FONT } },
    ],
  },
  numbering: {
    config: [
      {
        reference: 'bullets',
        levels: [{
          level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 460, hanging: 260 } } },
        }],
      },
      // One instance per list, so every list restarts at 1. The hanging indent
      // leaves room for a two-digit number ("10.") without the text jumping.
      ...stepRefs.map((reference) => ({
        reference,
        levels: [{
          level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT,
          style: {
            paragraph: { indent: { left: 560, hanging: 360 } },
            run: { bold: true, color: GREEN },
          },
        }],
      })),
    ],
  },
  sections: [
    // Title page + contents, no header
    {
      properties: { page: { margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: 'Smart Sweep · SWMS', size: 17, color: MUTED, font: FONT })],
          })],
        }),
      },
      children: [...titlePage, ...contents],
    },
    // Body, with running header and page numbers
    {
      properties: {
        page: { margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } },
      },
      headers: {
        default: new Header({
          children: [new Paragraph({
            spacing: { after: 120 },
            border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: BORDER, space: 6 } },
            children: [
              new TextRun({ text: 'Smart Sweep', bold: true, size: 17, color: GREEN, font: FONT }),
              new TextRun({ text: '   ·   User Manual', size: 17, color: MUTED, font: FONT }),
            ],
          })],
        }),
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({ text: 'Page ', size: 17, color: MUTED, font: FONT }),
              new TextRun({ children: [PageNumber.CURRENT], size: 17, color: MUTED, font: FONT }),
              new TextRun({ text: ' of ', size: 17, color: MUTED, font: FONT }),
              new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 17, color: MUTED, font: FONT }),
            ],
          })],
        }),
      },
      children: body,
    },
  ],
})

const out = process.argv[2]
Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(out, buf)
  console.log(`wrote ${out} (${(buf.length / 1024).toFixed(0)} KB)`)
})
