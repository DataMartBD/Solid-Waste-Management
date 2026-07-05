import { useState } from 'react'
import { IconDownload, IconEye, IconBill } from './Icons.jsx'
import { downloadCSV, downloadExcel, viewReport, printReport, tableToHTML } from '../utils/export.js'

// Dropdown offering View / PDF / Excel / CSV for a set of rows+columns.
export function ExportMenu({ title, subtitle, columns, rows, filename, label = 'View / Export' }) {
  const [open, setOpen] = useState(false)
  const html = () => tableToHTML(title, subtitle, columns, rows)
  const close = () => setOpen(false)

  const OPTIONS = [
    { key: 'view', label: 'View report', icon: <IconEye size={15} />, run: () => viewReport(title, html()) },
    { key: 'pdf', label: 'Export PDF', icon: <IconBill size={15} />, run: () => printReport(title, html()) },
    { key: 'xls', label: 'Export Excel', icon: <IconDownload size={15} />, run: () => downloadExcel(filename, rows, columns, title) },
    { key: 'csv', label: 'Export CSV', icon: <IconDownload size={15} />, run: () => downloadCSV(filename, rows, columns) },
  ]

  return (
    <div className="export-menu">
      <button className="btn btn-ghost" onClick={() => setOpen((o) => !o)}>
        <IconDownload size={16} /> {label} <span style={{ fontSize: 10, opacity: .6 }}>▾</span>
      </button>
      {open && (
        <>
          <div className="export-backdrop" onClick={close} />
          <div className="export-pop fade-in">
            {OPTIONS.map((o) => (
              <button key={o.key} onClick={() => { o.run(); close() }}>{o.icon} {o.label}</button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
