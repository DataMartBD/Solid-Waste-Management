import { useState } from 'react'
import { PageHeader, StatCard, Status } from '../components/ui.jsx'
import { Modal, Field, FormRow, ModalActions } from '../components/Modal.jsx'
import { IconUsers, IconCheck, IconAlert, IconPlus, IconDownload, IconEye, IconEdit, IconTrash, IconRefresh } from '../components/Icons.jsx'
import { useData } from '../context/DataContext.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { useLang } from '../i18n/index.jsx'
import { downloadCSV } from '../utils/export.js'

const daysUntil = (d) => (d ? Math.round((new Date(d) - new Date()) / 86400000) : null)
const LICENCE_WINDOW_DAYS = 60
// The window the server recomputes coverage / on-time over.
const METRICS_WINDOW_DAYS = 30

const TODAY = new Date().toISOString().slice(0, 10)

// `onTime`, `coverage` and `complaints` are deliberately absent: they are
// server-computed metrics, and `dspId` is assigned by the server when omitted.
const EMPTY = {
  name: '', zone: '', phone: '', license: '', licenseExp: '',
  joined: TODAY, status: 'idle', attendance: 'checked_in',
}

export default function Collectors() {
  const { collectors, vans, wards, create, update, remove, act, api, vanById } = useData()
  const { isAdmin } = useAuth()
  const { t, n, percent, date } = useLang()
  const [selected, setSelected] = useState(null)
  const [editing, setEditing] = useState(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState(null)

  const active = collectors.filter((c) => c.attendance === 'checked_in').length
  const licenceSoon = collectors.filter((c) => {
    const days = daysUntil(c.licenseExp)
    return days !== null && days <= LICENCE_WINDOW_DAYS
  }).length
  const avgCov = collectors.length ? Math.round(collectors.reduce((a, c) => a + (c.coverage || 0), 0) / collectors.length) : 0

  function exportCsv() {
    downloadCSV('collectors', collectors, [
      { key: 'name', label: t('collectors.field.name') }, { key: 'dspId', label: t('collectors.th.dspId') }, { key: 'zone', label: t('collectors.th.zone') },
      { key: 'phone', label: t('collectors.field.contact') }, { key: 'license', label: t('collectors.csv.licence') }, { key: 'licenseExp', label: t('collectors.field.licenceExpiry') },
      // The van link is owned by Fleet and read back as `vanId`.
      { key: 'van', label: t('collectors.th.van'), get: (r) => r.vanId || '' },
      { key: 'coverage', label: t('collectors.csv.coveragePct') }, { key: 'onTime', label: t('collectors.csv.onTimePct') },
      { key: 'attendance', label: t('collectors.th.attendance'), get: (r) => t(`status.${r.attendance}`) },
    ], { t })
  }

  // Recomputes every collector's coverage and on-time from the visit log. Admin
  // only, because the figures feed staff reviews — the server enforces that too.
  async function refreshMetrics() {
    setBusy(true)
    setNote(null)
    const result = await act(api.collectors.refreshMetrics(METRICS_WINDOW_DAYS), { refresh: ['collectors'] })
    setBusy(false)
    setNote(result.ok
      ? { tone: 'ok', text: t('collectors.metricsRefreshed', { count: n(result.data?.updated || 0), days: n(METRICS_WINDOW_DAYS) }) }
      : { tone: 'bad', text: result.error?.detail || t('collectors.saveFailed') })
  }

  async function removeCollector(c) {
    if (!confirm(t('collectors.removeConfirm', { name: c.name }))) return
    setBusy(true)
    const result = await remove('collectors', c.id)
    setBusy(false)
    if (!result.ok) setNote({ tone: 'bad', text: result.error?.detail || t('collectors.saveFailed') })
  }

  return (
    <div className="fade-in">
      <PageHeader
        title={t('collectors.title')}
        subtitle={t('collectors.subtitle')}
        actions={<>
          {isAdmin && (
            <button className="btn btn-ghost" disabled={busy} onClick={refreshMetrics}>
              {busy ? <span className="spinner spinner-dark" /> : <IconRefresh size={16} />} {t('collectors.refreshMetrics')}
            </button>
          )}
          <button className="btn btn-ghost" onClick={exportCsv}><IconDownload size={16} /> {t('collectors.export')}</button>
          <button className="btn btn-primary" onClick={() => setEditing({ ...EMPTY, zone: wards[0]?.id || '' })}><IconPlus size={16} /> {t('collectors.addCollector')}</button>
        </>}
      />

      {note && (
        <div className={`form-note ${note.tone}`} style={{ marginBottom: 16 }}>
          {note.tone === 'ok' ? <IconCheck size={15} /> : <IconAlert size={15} />}<span>{note.text}</span>
        </div>
      )}

      <div className="stat-grid" style={{ marginBottom: 20 }}>
        <StatCard icon={<IconUsers size={18} />} label={t('collectors.stat.totalDsps')} value={n(collectors.length)} sub={t('collectors.stat.totalDspsSub')} />
        <StatCard icon={<IconCheck size={18} />} tone="ok" label={t('collectors.stat.checkedIn')} value={n(active)} sub={t('collectors.stat.checkedInSub', { count: n(collectors.length) })} progress={collectors.length ? (active / collectors.length) * 100 : 0} />
        <StatCard icon={<IconAlert size={18} />} tone="warn" label={t('collectors.stat.licenceDue')} value={n(licenceSoon)} sub={t('collectors.stat.licenceDueSub', { days: n(LICENCE_WINDOW_DAYS) })} />
        <StatCard icon={<IconCheck size={18} />} tone="info" label={t('collectors.stat.avgCoverage')} value={percent(avgCov)} sub={t('collectors.stat.avgCoverageSub')} />
      </div>

      <div className="card">
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr><th>{t('collectors.th.collector')}</th><th>{t('collectors.th.dspId')}</th><th>{t('collectors.th.zone')}</th><th>{t('collectors.th.van')}</th><th>{t('collectors.th.licenceExp')}</th><th>{t('collectors.th.coverage')}</th><th>{t('collectors.th.onTime')}</th><th>{t('collectors.th.attendance')}</th><th></th></tr>
            </thead>
            <tbody>
              {collectors.map((c) => {
                const licDays = daysUntil(c.licenseExp)
                const licenceSoonRow = licDays !== null && licDays <= LICENCE_WINDOW_DAYS
                return (
                  <tr key={c.id}>
                    <td style={{ cursor: 'pointer' }} onClick={() => setSelected(c)}>
                      <div className="row gap-12">
                        <div className="avatar" style={{ width: 32, height: 32, fontSize: 11 }}>{c.name.split(' ').map((w) => w[0]).join('').slice(0, 2)}</div>
                        <span style={{ fontWeight: 600 }}>{c.name}</span>
                      </div>
                    </td>
                    <td className="mono small">{c.dspId}</td>
                    <td>{c.zone}</td>
                    <td className="mono small">{c.vanId || <span className="muted-3">—</span>}</td>
                    <td><span className={licenceSoonRow ? 'badge badge-warn' : 'badge badge-muted'}>{date(c.licenseExp)}</span></td>
                    <td><div className="row gap-8"><div className="mini-bar"><i style={{ width: `${c.coverage || 0}%` }} /></div><span className="tiny mono">{percent(c.coverage || 0)}</span></div></td>
                    <td className="mono">{percent(c.onTime || 0)}</td>
                    <td><Status value={c.attendance} /></td>
                    <td>
                      <div className="row" style={{ gap: 2 }}>
                        <button className="act-btn" title={t('common.details')} onClick={() => setSelected(c)}><IconEye size={16} /></button>
                        <button className="act-btn" title={t('common.edit')} onClick={() => setEditing(c)}><IconEdit size={15} /></button>
                        <button className="act-btn danger" title={t('collectors.remove')} disabled={busy} onClick={() => removeCollector(c)}><IconTrash size={15} /></button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {selected && <CollectorDrawer c={selected} van={vanById(selected.vanId)} onClose={() => setSelected(null)} onEdit={() => { setEditing(selected); setSelected(null) }} />}
      {editing && (
        <CollectorForm
          initial={editing}
          vans={vans}
          wards={wards}
          onClose={() => setEditing(null)}
          onSave={async ({ driver, ...data }) => {
            const payload = {
              name: data.name.trim(), zone: data.zone, phone: data.phone,
              license: data.license, licenseExp: data.licenseExp || null,
              joined: data.joined || null, status: data.status, attendance: data.attendance,
              // Only sent when the operator typed one; otherwise the server mints it.
              ...(data.dspId ? { dspId: data.dspId } : {}),
            }
            const saved = data.id
              ? await update('collectors', data.id, payload)
              : await create('collectors', payload)
            if (!saved.ok) return saved

            // One server call owns the pairing: it also releases this collector
            // from any other van, which the old two-step client sync could not
            // guarantee — a failure between the two writes left them driving two.
            const wasDriving = data.vanId || ''
            if (driver !== wasDriving) {
              const pairing = driver
                ? await act(api.vans.assignDriver(driver, saved.data.id), { refresh: ['vans', 'collectors'] })
                : await act(api.vans.assignDriver(wasDriving, null), { refresh: ['vans', 'collectors'] })
              if (!pairing.ok) return pairing
            }
            setEditing(null)
            return saved
          }}
        />
      )}
    </div>
  )
}

function CollectorForm({ initial, vans, wards, onClose, onSave }) {
  const { t, wardName } = useLang()
  // The van link comes from the collector's own read-only `vanId`.
  const [form, setForm] = useState({ ...initial, driver: initial.vanId || '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const fieldError = (name) => error?.fieldError?.(name)

  async function submit(e) {
    e.preventDefault()
    if (busy) return
    if (!form.name.trim()) { setError({ detail: t('collectors.nameRequired') }); return }
    setBusy(true)
    setError(null)
    const result = await onSave(form)
    setBusy(false)
    if (result && !result.ok) setError(result.error)
  }

  return (
    <Modal title={initial.id ? t('collectors.editTitle') : t('collectors.addTitle')} subtitle={initial.id ? initial.dspId : t('collectors.newProfile')} onClose={onClose} width={560}>
      <form onSubmit={submit}>
        <FormRow>
          <Field half label={t('collectors.field.fullName')} value={form.name} onChange={set('name')} autoFocus disabled={busy} />
          <Field half label={t('collectors.field.contact')} value={form.phone} onChange={set('phone')} placeholder={t('collectors.placeholder.phone')} disabled={busy} />
        </FormRow>
        <FieldError>{fieldError('name') || fieldError('phone')}</FieldError>
        <FormRow>
          <Field half as="select" label={t('collectors.field.zone')} value={form.zone} onChange={set('zone')} disabled={busy}
            options={wards.map((w) => ({ value: w.id, label: wardName(w.id) }))} />
          <Field half as="select" label={t('collectors.field.van')} value={form.driver} onChange={set('driver')} disabled={busy}
            options={[{ value: '', label: t('collectors.field.unassigned') }, ...vans.map((v) => ({ value: v.id, label: `${v.id} (${t(`collectors.vanType.${v.type}`)})` }))]} />
        </FormRow>
        <FieldError>{fieldError('zone') || fieldError('driver')}</FieldError>
        <FormRow>
          <Field half label={t('collectors.field.licenceNo')} value={form.license} onChange={set('license')} placeholder={t('collectors.placeholder.licence')} disabled={busy} />
          <Field half label={t('collectors.field.licenceExpiry')} type="date" value={form.licenseExp || ''} onChange={set('licenseExp')} disabled={busy} />
        </FormRow>
        <FieldError>{fieldError('licenseExp') || fieldError('dspId')}</FieldError>
        <FormRow>
          <Field half as="select" label={t('collectors.field.status')} value={form.status} onChange={set('status')} disabled={busy} options={['on_route', 'idle', 'off_route'].map((s) => ({ value: s, label: t(`status.${s}`) }))} />
          <Field half as="select" label={t('collectors.field.attendance')} value={form.attendance} onChange={set('attendance')} disabled={busy} options={['checked_in', 'absent'].map((s) => ({ value: s, label: t(`status.${s}`) }))} />
        </FormRow>
        {/* Coverage, on-time and the complaint count are computed server-side, so
            the form no longer offers them as editable numbers. */}
        <div className="tiny muted-3 mt-8">{t('collectors.metricsReadOnly')}</div>
        {error?.detail && (
          <div className="form-note bad" style={{ marginTop: 12 }}>
            <IconAlert size={15} /><span>{error.detail}</span>
          </div>
        )}
        <ModalActions>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>{t('common.cancel')}</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? <><span className="spinner" /> {t('collectors.saving')}</> : initial.id ? t('common.save') : t('collectors.addCollector')}
          </button>
        </ModalActions>
      </form>
    </Modal>
  )
}

// One server field message, under the row that produced it.
function FieldError({ children }) {
  if (!children) return null
  return <div className="tiny" style={{ color: 'var(--danger-fg)', fontWeight: 600 }}>{children}</div>
}

function CollectorDrawer({ c, van, onClose, onEdit }) {
  const { t, n, percent, date, digits } = useLang()
  return (
    <>
      <div className="drawer-scrim" onClick={onClose} />
      <aside className="drawer">
        <div className="drawer-head">
          <div className="row gap-12">
            <div className="avatar" style={{ width: 46, height: 46, fontSize: 16, borderRadius: 12 }}>{c.name.split(' ').map((w) => w[0]).join('').slice(0, 2)}</div>
            <div><h3 style={{ fontSize: 17 }}>{c.name}</h3><div className="tiny muted-3 mono mt-4">{c.dspId}</div></div>
          </div>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>
        <div className="drawer-body">
          <div className="row gap-8" style={{ marginBottom: 18 }}><Status value={c.status} /><Status value={c.attendance} /></div>
          <dl className="kv">
            <dt>{t('collectors.field.contact')}</dt><dd className="mono">{digits(c.phone)}</dd>
            <dt>{t('collectors.field.zone')}</dt><dd>{c.zone}</dd>
            <dt>{t('collectors.field.joined')}</dt><dd>{date(c.joined)}</dd>
            <dt>{t('collectors.field.licenceNo')}</dt><dd className="mono">{c.license}</dd>
            <dt>{t('collectors.field.licenceExpiry')}</dt><dd>{date(c.licenseExp)}</dd>
            <dt>{t('collectors.field.van')}</dt><dd className="mono">{van ? `${van.id} (${t(`collectors.vanType.${van.type}`)})` : '—'}</dd>
          </dl>
          <h4 className="mt-24" style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--text-3)' }}>{t('collectors.performance')}</h4>
          <div className="grid mt-8" style={{ gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
            {/* `complaints` is a live count of this collector's open tickets. */}
            {[[t('collectors.perf.coverage'), percent(c.coverage || 0)], [t('collectors.perf.onTime'), percent(c.onTime || 0)], [t('collectors.perf.complaints'), n(c.complaints || 0)]].map(([l, v]) => (
              <div key={l} className="center" style={{ padding: '14px 8px', background: 'var(--surface-2)', borderRadius: 10 }}>
                <div style={{ fontSize: 20, fontWeight: 800 }}>{v}</div><div className="tiny muted-3 mt-4">{l}</div>
              </div>
            ))}
          </div>
          <div className="row gap-8 mt-24">
            <button className="btn btn-primary grow" onClick={onEdit}><IconEdit size={15} /> {t('collectors.editReassign')}</button>
            <button className="btn btn-ghost grow" onClick={onClose}>{t('common.close')}</button>
          </div>
        </div>
      </aside>
    </>
  )
}
