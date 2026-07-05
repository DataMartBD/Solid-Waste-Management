import { useState, useMemo } from 'react'
import { PageHeader, Status, StatCard, EmptyState } from '../components/ui.jsx'
import { Modal, Field, FormRow, ModalActions } from '../components/Modal.jsx'
import { IconAlert, IconClock, IconCheck, IconPlus, IconDownload } from '../components/Icons.jsx'
import { useData, genId } from '../context/DataContext.jsx'
import { wards } from '../data/mockData.js'
import { downloadCSV } from '../utils/export.js'

const LIFECYCLE = ['open', 'assigned', 'in_progress', 'resolved', 'closed']
const TYPES = ['missed_collection', 'overflow', 'billing_dispute', 'staff_behaviour', 'other']
const hoursOpen = (iso) => Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 3600000))

export default function Complaints() {
  const { complaints, collectors, households, upsert, collectorName, householdById } = useData()
  const [filter, setFilter] = useState('all')
  const [showForm, setShowForm] = useState(false)

  const stats = useMemo(() => ({
    open: complaints.filter((c) => ['open', 'assigned', 'in_progress'].includes(c.status)).length,
    resolved: complaints.filter((c) => ['resolved', 'closed'].includes(c.status)).length,
    breached: complaints.filter((c) => ['open', 'assigned', 'in_progress'].includes(c.status) && hoursOpen(c.opened) > c.sla).length,
  }), [complaints])

  const rows = complaints.filter((c) => filter === 'all' ? true
    : filter === 'active' ? ['open', 'assigned', 'in_progress'].includes(c.status)
    : ['resolved', 'closed'].includes(c.status))

  function advance(c) {
    const idx = LIFECYCLE.indexOf(c.status)
    if (idx < LIFECYCLE.length - 1) upsert('complaints', { ...c, status: LIFECYCLE[idx + 1] })
  }

  function exportCsv() {
    downloadCSV('complaints', rows, [
      { key: 'id', label: 'Ticket' }, { key: 'type', label: 'Type' },
      { key: 'hh', label: 'Household' }, { key: 'ward', label: 'Ward' },
      { key: 'channel', label: 'Channel' }, { key: 'assigned', label: 'Assigned', get: (r) => collectorName(r.assigned) },
      { key: 'status', label: 'Status' }, { key: 'opened', label: 'Opened' },
    ])
  }

  return (
    <div className="fade-in">
      <PageHeader
        title="Complaint Management"
        subtitle="Single channel — app & SMS · target resolution < 24h"
        actions={<>
          <button className="btn btn-ghost" onClick={exportCsv}><IconDownload size={16} /> Export</button>
          <button className="btn btn-primary" onClick={() => setShowForm(true)}><IconPlus size={16} /> Log complaint</button>
        </>}
      />

      <div className="stat-grid" style={{ marginBottom: 20 }}>
        <StatCard icon={<IconAlert size={18} />} tone="warn" label="Active tickets" value={stats.open} sub="Open · assigned · in-progress" />
        <StatCard icon={<IconCheck size={18} />} tone="ok" label="Resolved / closed" value={stats.resolved} sub="This week" />
        <StatCard icon={<IconClock size={18} />} tone="danger" label="SLA breached" value={stats.breached} sub="Over 24h & unresolved" />
        <StatCard icon={<IconClock size={18} />} tone="info" label="Median resolution" value="18h" sub="Target < 24h" progress={75} />
      </div>

      <div className="filter-bar">
        <div className="seg">
          {[['all', 'All'], ['active', 'Active'], ['done', 'Resolved']].map(([k, l]) => (
            <button key={k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{l}</button>
          ))}
        </div>
        <div className="grow" />
        <span className="tiny muted">{rows.length} tickets</span>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr><th>Ticket</th><th>Type</th><th>Household</th><th>Channel</th><th>Assigned</th><th>Age</th><th>Status</th><th></th></tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const age = hoursOpen(c.opened)
                const breached = age > c.sla && ['open', 'assigned', 'in_progress'].includes(c.status)
                const hh = householdById(c.hh)
                return (
                  <tr key={c.id}>
                    <td className="mono">{c.id}</td>
                    <td style={{ fontWeight: 600 }}>{c.type.replace(/_/g, ' ')}</td>
                    <td>
                      <div className="small">{hh?.head || c.hh}</div>
                      <div className="tiny muted-3 mono">{c.ward}</div>
                    </td>
                    <td><span className="badge badge-muted">{c.channel.toUpperCase()}</span></td>
                    <td className="small">{collectorName(c.assigned)}</td>
                    <td><span className={breached ? 'badge badge-danger' : 'badge badge-muted'}><IconClock size={12} /> {age}h</span></td>
                    <td><Status value={c.status} /></td>
                    <td>
                      {!['resolved', 'closed'].includes(c.status)
                        ? <button className="btn btn-ghost btn-sm" onClick={() => advance(c)}>Advance →</button>
                        : c.status === 'resolved'
                          ? <button className="btn btn-ghost btn-sm" onClick={() => advance(c)}>Close</button>
                          : <span className="tiny muted-3">—</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {rows.length === 0 && <EmptyState>No tickets in this view.</EmptyState>}
        </div>
      </div>

      {showForm && (
        <ComplaintForm collectors={collectors} households={households} onClose={() => setShowForm(false)}
          onSave={(data) => { upsert('complaints', { ...data, id: genId('CMP'), status: 'open', sla: 24, opened: new Date().toISOString() }); setShowForm(false) }} />
      )}
    </div>
  )
}

function ComplaintForm({ collectors, households, onClose, onSave }) {
  const [form, setForm] = useState({ hh: households[0]?.id || '', type: 'missed_collection', channel: 'app', assigned: collectors[0]?.id || '', ward: households[0]?.ward || 'W-14' })
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  return (
    <Modal title="Log complaint" subtitle="Auto-routes to the responsible collector by zone" onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); onSave(form) }}>
        <Field as="select" label="Household" value={form.hh}
          onChange={(e) => { const hh = households.find((h) => h.id === e.target.value); setForm((f) => ({ ...f, hh: e.target.value, ward: hh?.ward || f.ward })) }}
          options={households.map((h) => ({ value: h.id, label: `${h.head} · ${h.id}` }))} />
        <FormRow>
          <Field half as="select" label="Type" value={form.type} onChange={set('type')} options={TYPES.map((t) => ({ value: t, label: t.replace(/_/g, ' ') }))} />
          <Field half as="select" label="Channel" value={form.channel} onChange={set('channel')} options={[{ value: 'app', label: 'App' }, { value: 'sms', label: 'SMS' }]} />
        </FormRow>
        <FormRow>
          <Field half as="select" label="Assign to" value={form.assigned} onChange={set('assigned')} options={collectors.map((c) => ({ value: c.id, label: c.name }))} />
          <Field half as="select" label="Ward" value={form.ward} onChange={set('ward')} options={wards.map((w) => ({ value: w.id, label: w.id }))} />
        </FormRow>
        <ModalActions>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary">Create ticket</button>
        </ModalActions>
      </form>
    </Modal>
  )
}
