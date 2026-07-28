import { useState } from 'react'
import { IconDownload, IconEye, IconBill } from './Icons.jsx'
import { downloadCSV, downloadExcel, viewReport, printReport, tableToHTML } from '../utils/export.js'
import { useLang } from '../i18n/index.jsx'

// Dropdown offering View / PDF / Excel / CSV for a set of rows+columns.
export function ExportMenu({ title, subtitle, columns, rows, filename, label }) {
  const { t, lang } = useLang()
  const [open, setOpen] = useState(false)
  // The exported document carries the language the operator is reading in.
  const html = () => tableToHTML(title, subtitle, columns, rows, { t, lang })
  const close = () => setOpen(false)

  const OPTIONS = [
    { key: 'view', label: t('export.view'), icon: <IconEye size={15} />, run: () => viewReport(title, html(), { t }) },
    { key: 'pdf', label: t('export.pdf'), icon: <IconBill size={15} />, run: () => printReport(title, html(), { t }) },
    { key: 'xls', label: t('export.excel'), icon: <IconDownload size={15} />, run: () => downloadExcel(filename, rows, columns, title, { t }) },
    { key: 'csv', label: t('export.csv'), icon: <IconDownload size={15} />, run: () => downloadCSV(filename, rows, columns, { t }) },
  ]

  return (
    <div className="export-menu">
      <button className="btn btn-ghost" onClick={() => setOpen((o) => !o)}>
        <IconDownload size={16} /> {label || t('export.label')} <span style={{ fontSize: 10, opacity: .6 }}>▾</span>
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
