import { useState } from 'react'
import { PageHeader, StatCard, Status } from '../components/ui.jsx'
import { Modal, Field, FormRow, ModalActions } from '../components/Modal.jsx'
import { IconUsers, IconCheck, IconAlert, IconPlus, IconDownload, IconEye, IconEdit, IconTrash } from '../components/Icons.jsx'
import { useData, genId } from '../context/DataContext.jsx'
import { wards } from '../data/mockData.js'
import { downloadCSV } from '../utils/export.js'

const today = new Date('2026-07-05')
const daysUntil = (d) => Math.round((new Date(d) - today) / 86400000)

const EMPTY = {
  name: '', dspId: '', zone: 'W-14', phone: '', license: '', licenseExp: '2027-01-01',
  joined: '2026-07-05', status: 'idle', attendance: 'checked_in', onTime: 90, coverage: 90, complaints: 0,
}

export default function Drivers() {
  const { collectors, vans, upsert, remove, vanForDriver } = useData()
  const [selected, setSelected] = useState(null)
  const [editing, setEditing] = useState(null)

  const active = collectors.filter((c) => c.attendance === 'checked_in').length
  const licenceSoon = collectors.filter((c) => daysUntil(c.licenseExp) <= 60).length
  const avgCov = collectors.length ? Math.round(collectors.reduce((a, c) => a + c.coverage, 0) / collectors.length) : 0

  function exportCsv() {
    downloadCSV('drivers', collectors, [
      { key: 'name', label: 'Name' }, { key: 'dspId', label: 'DSP ID' }, { key: 'zone', label: 'Zone' },
      { key: 'phone', label: 'Contact' }, { key: 'license', label: 'Licence' }, { key: 'licenseExp', label: 'Licence expiry' },
      { key: 'van', label: 'Van', get: (r) => vanForDriver(r.id)?.id || '' },
      { key: 'coverage', label: 'Coverage %' }, { key: 'onTime', label: 'On-time %' }, { key: 'attendance', label: 'Attendance' },
    ])
  }

  return (
    <div className="fade-in">
      <PageHeader
        title="Drivers & Collectors"
        subtitle="DSP database — profiles, licensing, van assignment & performance"
        actions={<>
          <button className="btn btn-ghost" onClick={exportCsv}><IconDownload size={16} /> Export</button>
          <button className="btn btn-primary" onClick={() => setEditing({ ...EMPTY })}><IconPlus size={16} /> Add driver</button>
        </>}
      />

      <div className="stat-grid" style={{ marginBottom: 20 }}>
        <StatCard icon={<IconUsers size={18} />} label="Total DSPs" value={collectors.length} sub="Registered service providers" />
        <StatCard icon={<IconCheck size={18} />} tone="ok" label="Checked in today" value={active} sub={`of ${collectors.length} · attendance`} progress={collectors.length ? (active / collectors.length) * 100 : 0} />
        <StatCard icon={<IconAlert size={18} />} tone="warn" label="Licence renewals due" value={licenceSoon} sub="Within 60 days" />
        <StatCard icon={<IconCheck size={18} />} tone="info" label="Avg coverage" value={`${avgCov}%`} sub="Across all DSPs" />
      </div>

      <div className="card">
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr><th>Driver</th><th>DSP ID</th><th>Zone</th><th>Van</th><th>Licence exp.</th><th>Coverage</th><th>On-time</th><th>Attendance</th><th></th></tr>
            </thead>
            <tbody>
              {collectors.map((c) => {
                const van = vanForDriver(c.id)
                const licDays = daysUntil(c.licenseExp)
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
                    <td className="mono small">{van ? van.id : <span className="muted-3">—</span>}</td>
                    <td><span className={licDays <= 60 ? 'badge badge-warn' : 'badge badge-muted'}>{c.licenseExp}</span></td>
                    <td><div className="row gap-8"><div className="mini-bar"><i style={{ width: `${c.coverage}%` }} /></div><span className="tiny mono">{c.coverage}%</span></div></td>
                    <td className="mono">{c.onTime}%</td>
                    <td><Status value={c.attendance} /></td>
                    <td>
                      <div className="row" style={{ gap: 2 }}>
                        <button className="act-btn" title="Details" onClick={() => setSelected(c)}><IconEye size={16} /></button>
                        <button className="act-btn" title="Edit" onClick={() => setEditing(c)}><IconEdit size={15} /></button>
                        <button className="act-btn danger" title="Remove" onClick={() => { if (confirm(`Remove ${c.name}?`)) remove('collectors', c.id) }}><IconTrash size={15} /></button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {selected && <DriverDrawer c={selected} van={vanForDriver(selected.id)} onClose={() => setSelected(null)} onEdit={() => { setEditing(selected); setSelected(null) }} />}
      {editing && <DriverForm initial={editing} vans={vans} onClose={() => setEditing(null)}
        onSave={({ driver, ...data }) => {
          const id = data.id || genId('C')
          const rec = { ...data, id, dspId: data.dspId || 'DSP-' + id.slice(-4) }
          upsert('collectors', rec)
          // sync van assignment
          vans.forEach((v) => { if (v.driver === id && v.id !== driver) upsert('vans', { ...v, driver: null }) })
          if (driver) { const v = vans.find((x) => x.id === driver); if (v) upsert('vans', { ...v, driver: id }) }
          setEditing(null)
        }} />}
    </div>
  )
}

function DriverForm({ initial, vans, onClose, onSave }) {
  const { vanForDriver } = useData()
  const [form, setForm] = useState({ ...initial, driver: initial.id ? (vanForDriver(initial.id)?.id || '') : '' })
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  return (
    <Modal title={initial.id ? 'Edit driver' : 'Add driver'} subtitle={initial.id ? initial.dspId : 'New DSP profile'} onClose={onClose} width={560}>
      <form onSubmit={(e) => { e.preventDefault(); if (!form.name.trim()) { alert('Name required.'); return } onSave({ ...form, onTime: Number(form.onTime) || 0, coverage: Number(form.coverage) || 0 }) }}>
        <FormRow>
          <Field half label="Full name" value={form.name} onChange={set('name')} autoFocus />
          <Field half label="Contact" value={form.phone} onChange={set('phone')} placeholder="+8801…" />
        </FormRow>
        <FormRow>
          <Field half as="select" label="Assigned zone" value={form.zone} onChange={set('zone')} options={wards.map((w) => ({ value: w.id, label: w.name }))} />
          <Field half as="select" label="Assigned van" value={form.driver} onChange={set('driver')} options={[{ value: '', label: 'Unassigned' }, ...vans.map((v) => ({ value: v.id, label: `${v.id} (${v.type})` }))]} />
        </FormRow>
        <FormRow>
          <Field half label="Licence no." value={form.license} onChange={set('license')} placeholder="DK-…" />
          <Field half label="Licence expiry" type="date" value={form.licenseExp} onChange={set('licenseExp')} />
        </FormRow>
        <FormRow>
          <Field half as="select" label="Status" value={form.status} onChange={set('status')} options={['on_route', 'idle', 'off_route'].map((s) => ({ value: s, label: s.replace(/_/g, ' ') }))} />
          <Field half as="select" label="Attendance" value={form.attendance} onChange={set('attendance')} options={['checked_in', 'absent'].map((s) => ({ value: s, label: s.replace(/_/g, ' ') }))} />
        </FormRow>
        <ModalActions>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary">{initial.id ? 'Save' : 'Add driver'}</button>
        </ModalActions>
      </form>
    </Modal>
  )
}

function DriverDrawer({ c, van, onClose, onEdit }) {
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
            <dt>Contact</dt><dd className="mono">{c.phone}</dd>
            <dt>Assigned zone</dt><dd>{c.zone}</dd>
            <dt>Joined</dt><dd>{c.joined}</dd>
            <dt>Licence no.</dt><dd className="mono">{c.license}</dd>
            <dt>Licence expiry</dt><dd>{c.licenseExp}</dd>
            <dt>Assigned van</dt><dd className="mono">{van ? `${van.id} (${van.type})` : '—'}</dd>
          </dl>
          <h4 className="mt-24" style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--text-3)' }}>Performance</h4>
          <div className="grid mt-8" style={{ gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
            {[['Coverage', `${c.coverage}%`], ['On-time', `${c.onTime}%`], ['Complaints', c.complaints]].map(([l, v]) => (
              <div key={l} className="center" style={{ padding: '14px 8px', background: 'var(--surface-2)', borderRadius: 10 }}>
                <div style={{ fontSize: 20, fontWeight: 800 }}>{v}</div><div className="tiny muted-3 mt-4">{l}</div>
              </div>
            ))}
          </div>
          <div className="row gap-8 mt-24">
            <button className="btn btn-primary grow" onClick={onEdit}><IconEdit size={15} /> Edit / reassign</button>
            <button className="btn btn-ghost grow" onClick={onClose}>Close</button>
          </div>
        </div>
      </aside>
    </>
  )
}
