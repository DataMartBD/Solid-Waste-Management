import { describe, it, expect, beforeEach, vi } from 'vitest'
import { downloadCSV, downloadExcel, tableToHTML } from './export.js'

// Capture what download() would have produced. In jsdom, URL.createObjectURL
// isn't implemented and <a>.click() is a no-op, so we stub the blob plumbing
// and read the blob text instead of hitting a real download.
let lastBlob
let lastFilename

beforeEach(() => {
  lastBlob = undefined
  lastFilename = undefined
  globalThis.URL.createObjectURL = vi.fn((blob) => {
    lastBlob = blob
    return 'blob:mock'
  })
  globalThis.URL.revokeObjectURL = vi.fn()
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () {
    lastFilename = this.download
  })
  vi.spyOn(window, 'alert').mockImplementation(() => {})
})

function blobText(blob) {
  // jsdom's Blob has no .text(), so read it via FileReader.
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(fr.result)
    fr.onerror = reject
    fr.readAsText(blob)
  })
}

const rows = [
  { id: 'HH-1', head: 'Abdul Karim', dues: 0 },
  { id: 'HH-2', head: 'Rina, Sultana', dues: 100 }, // comma forces quoting
]

describe('downloadCSV', () => {
  it('writes a header row and one line per record', async () => {
    downloadCSV('households', rows)
    // Note: the blob is prefixed with a UTF-8 BOM for Excel; FileReader strips
    // it on decode, so we assert on the decoded header/body content.
    const text = await blobText(lastBlob)
    const lines = text.split('\n')
    expect(lines[0]).toBe('id,head,dues')
    expect(lines[1]).toBe('HH-1,Abdul Karim,0')
    expect(lines.length).toBe(3) // header + 2 rows
  })

  it('quotes values that contain commas and escapes embedded quotes', async () => {
    downloadCSV('households', [{ name: 'Rina, "R"' }])
    const text = await blobText(lastBlob)
    expect(text).toContain('"Rina, ""R"""')
  })

  it('honours custom columns with label + get resolvers', async () => {
    const cols = [
      { key: 'id', label: 'Household' },
      { label: 'Owner', get: (r) => r.head.toUpperCase() },
    ]
    downloadCSV('report', rows, cols)
    const text = await blobText(lastBlob)
    const lines = text.replace('﻿', '').split('\n')
    expect(lines[0]).toBe('Household,Owner')
    expect(lines[1]).toBe('HH-1,ABDUL KARIM')
  })

  it('appends the .csv extension when missing', () => {
    downloadCSV('households', rows)
    expect(lastFilename).toBe('households.csv')
    downloadCSV('already.csv', rows)
    expect(lastFilename).toBe('already.csv')
  })

  it('alerts and does not download when there are no rows', () => {
    downloadCSV('empty', [])
    expect(window.alert).toHaveBeenCalledWith('Nothing to export.')
    expect(lastBlob).toBeUndefined()
  })
})

describe('downloadExcel', () => {
  it('produces an Excel-flavoured HTML blob with the right mime type', async () => {
    downloadExcel('households', rows, null, 'Household Register')
    expect(lastBlob.type).toContain('application/vnd.ms-excel')
    const text = await blobText(lastBlob)
    expect(text).toContain('<table>')
    expect(text).toContain('Household Register')
    expect(text).toContain('Abdul Karim')
  })

  it('appends the .xls extension when missing', () => {
    downloadExcel('households', rows)
    expect(lastFilename).toBe('households.xls')
  })

  it('alerts when there is nothing to export', () => {
    downloadExcel('empty', [])
    expect(window.alert).toHaveBeenCalledWith('Nothing to export.')
  })
})

describe('tableToHTML', () => {
  const cols = [
    { key: 'id', label: 'ID' },
    { label: 'Owner', get: (r) => r.head },
  ]

  it('renders a title, subtitle and a row per record', () => {
    const html = tableToHTML('Households', 'Ward 14', cols, rows)
    expect(html).toContain('<h1>Households</h1>')
    expect(html).toContain('Ward 14')
    expect(html).toContain('<th>ID</th>')
    expect(html).toContain('<td>HH-1</td>')
    expect(html).toContain('<td>Abdul Karim</td>')
  })

  it('escapes HTML in cell values to prevent markup injection', () => {
    const html = tableToHTML('T', '', [{ key: 'x', label: 'X' }], [{ x: '<script>alert(1)</script>' }])
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('renders an empty subtitle gracefully when omitted', () => {
    const html = tableToHTML('T', undefined, cols, rows)
    expect(html).toContain('class="sub"')
  })
})
