import { useState, useMemo, useEffect, useCallback, useRef } from 'react'
import { PageHeader, Status, StatCard, EmptyState } from '../components/ui.jsx'
import { Modal, Field, FormRow, ModalActions } from '../components/Modal.jsx'
import { ExportMenu } from '../components/ExportMenu.jsx'
import { IconAlert, IconClock, IconCheck, IconPlus, IconEye, IconArrow, IconPhone, IconSearch, IconUsers } from '../components/Icons.jsx'
import { useData } from '../context/DataContext.jsx'
import { useLang } from '../i18n/index.jsx'
import {
  COMPLAINT_TYPES, PRIORITIES, priorityMeta, typeLabelKey, priorityLabelKey,
  slaOf, slaTone, slaLabelKey, nextStatus, isActive, isClosedOut,
  triageSort, actionLabelKey, actorLabelKey,
} from '../utils/complaints.js'

const TONE_COLOR = { ok: 'var(--ok)', warn: 'var(--warn)', danger: 'var(--danger)' }

// SLA text with the hour count in the reader's numerals ("6h left" / "৬ ঘণ্টা বাকি").
// The state itself is whatever the server computed for this row.
function slaText(complaint, t, n) {
  const { key, vars } = slaLabelKey(slaOf(complaint))
  return t(key, vars ? { hours: n(vars.hours) } : undefined)
}

// The next lifecycle step, preferring the server's own answer over walking
// LIFECYCLE in the browser — it is the side that will accept or refuse the move.
const nextOf = (c) => c.nextStatus ?? nextStatus(c.status)

function PriorityBadge({ value }) {
  const { t } = useLang()
  const p = priorityMeta(value)
  return <span className={`badge ${p.badge}`}><span className="dot" />{t(priorityLabelKey(value))}</span>
}

function SlaMeter({ complaint, wide }) {
  const { t, n } = useLang()
  const s = slaOf(complaint)
  const color = TONE_COLOR[slaTone(s)] || 'var(--ok)'
  return (
    <div className={`sla-meter${wide ? ' wide' : ''}`}>
      <div className="sla-track"><div className="sla-fill" style={{ width: `${s.pct}%`, background: color }} /></div>
      <span className="tiny" style={{ fontWeight: 600, color: s.active ? color : 'var(--text-3)' }}>
        {slaText(complaint, t, n)}
      </span>
    </div>
  )
}

export default function Complaints() {
  const { complaints, collectors, households, ready, create, act, api, collectorName } = useData()
  const { t, n, dateTime } = useLang()

  const [status, setStatus] = useState('all') // all | active | done
  const [type, setType] = useState('all')
  const [priority, setPriority] = useState('all')
  const [q, setQ] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [selectedId, setSelectedId] = useState(null)
  // The id of the ticket with a write in flight, so a slow round trip cannot be
  // double-submitted from the row button and the drawer at the same time.
  const [busyId, setBusyId] = useState(null)
  const [error, setError] = useState(null)
  const [summary, setSummary] = useState(null)
  // Bumped after every successful write, to re-pull the KPI strip.
  const [writes, setWrites] = useState(0)

  const selected = complaints.find((c) => c.id === selectedId) || null

  // The header strip comes from GET /api/complaints/summary/ rather than being
  // recomputed over the loaded rows: the median resolution time is a figure over
  // the whole set, and half a page is not a median.
  useEffect(() => {
    if (!ready) return undefined
    let cancelled = false
    api.complaints.summary()
      .then((data) => { if (!cancelled) setSummary(data) })
      // A failed summary is not worth an error banner — the cards below fall back
      // to counting the rows already in hand.
      .catch(() => { if (!cancelled) setSummary(null) })
    return () => { cancelled = true }
  }, [api, ready, writes])

  const stats = useMemo(() => {
    const active = complaints.filter((c) => isActive(c.status))
    return {
      active: summary?.active ?? active.length,
      resolved: summary?.settled ?? complaints.filter((c) => isClosedOut(c.status)).length,
      // `breached` is the server's verdict either way — on the summary, or on
      // each row's slaState. The browser never decides it.
      breached: summary?.breached ?? active.filter((c) => slaOf(c).breached).length,
      urgent: summary?.urgent ?? active.filter((c) => c.priority === 'urgent').length,
      median: summary?.medianResolutionHours == null ? null : Math.round(summary.medianResolutionHours),
    }
  }, [complaints, summary])

  const rows = useMemo(() => {
    const filtered = complaints.filter((c) => {
      if (status === 'active' && !isActive(c.status)) return false
      if (status === 'done' && !isClosedOut(c.status)) return false
      if (type !== 'all' && c.type !== type) return false
      if (priority !== 'all' && c.priority !== priority) return false
      if (q) {
        const s = q.toLowerCase()
        // `head`, `holding` and `road` are denormalised onto every row, so the
        // search no longer needs a household lookup per ticket.
        const hay = [c.id, c.type, c.ward, c.description, c.head, c.holding, collectorName(c.assigned)]
        if (!hay.some((v) => String(v || '').toLowerCase().includes(s))) return false
      }
      return true
    })
    return triageSort(filtered)
  }, [complaints, status, type, priority, q, collectorName])

  const exportColumns = [
    { key: 'id', label: t('complaints.col.ticket') },
    { key: 'type', label: t('complaints.col.type'), get: (r) => t(typeLabelKey(r.type)) },
    { key: 'priority', label: t('complaints.col.priority'), get: (r) => t(priorityLabelKey(r.priority)) },
    { key: 'hh', label: t('complaints.col.household'), get: (r) => r.head || r.hh },
    { key: 'ward', label: t('complaints.col.ward') },
    { key: 'channel', label: t('complaints.col.channel'), get: (r) => t(`complaints.channelBadge.${r.channel}`) },
    { key: 'assigned', label: t('complaints.col.assigned'), get: (r) => collectorName(r.assigned) },
    { key: 'status', label: t('complaints.col.status'), get: (r) => t(`status.${r.status}`) },
    { key: 'sla', label: t('complaints.col.sla'), get: (r) => slaText(r, t, n) },
    { key: 'opened', label: t('complaints.col.opened'), get: (r) => dateTime(r.opened) },
    { key: 'description', label: t('complaints.col.description') },
  ]

  // ---- mutations -----------------------------------------------------------
  //
  // Every lifecycle move is a POST that writes the change and its audit entry in
  // one transaction and answers with the whole updated ticket. Nothing below
  // builds the next state: the server's copy is what lands in the store, so the
  // trail, the status and the recomputed slaState are always the ones it wrote.
  //
  // `act`'s `apply` list is assembled before its promise runs, so it cannot fold
  // in a value it has not seen yet. Handing the response straight back through a
  // settled promise applies the server's record without re-listing the whole
  // collection on every note.
  const runAction = useCallback(async (id, promise) => {
    setBusyId(id)
    setError(null)
    const result = await act(promise)
    setBusyId(null)
    if (!result.ok) {
      // The server refuses moves the UI cannot always know are impossible
      // (advancing a closed ticket, reopening a live one) with { detail, code }.
      setError(result.error?.detail || t('complaints.error.generic'))
      return null
    }
    // Photo upload answers with { photos, complaint }; every other action answers
    // with the ticket itself, so one unwrap covers all of them.
    const record = result.data?.complaint || result.data
    if (record?.id) await act(Promise.resolve(record), { apply: [['complaints', record]] })
    setWrites((v) => v + 1)
    return record
  }, [act, t])

  const advance = (c) => runAction(c.id, api.complaints.advance(c.id, ''))
  const reassign = (c, id) => {
    if ((id || null) === (c.assigned || null)) return
    // Handing a ticket back to the pool has no name to quote, so the server's own
    // wording ("Returned to the unassigned pool") is left to stand.
    const note = id ? t('complaints.note.reassigned', { name: collectorName(id) }) : ''
    runAction(c.id, api.complaints.assign(c.id, id || null, note))
  }
  const changePriority = (c, p) => {
    if (p === c.priority) return
    runAction(c.id, api.complaints.priority(c.id, p, t('complaints.note.priority', { priority: t(priorityLabelKey(p)) })))
  }
  const reopen = (c) => runAction(c.id, api.complaints.reopen(c.id, t('complaints.note.reopened')))
  const resolveWith = (c, note) => runAction(c.id, api.complaints.resolve(c.id, note || ''))
  const addNote = (c, note) => runAction(c.id, api.complaints.note(c.id, note))
  const addPhotos = (c, files, caption) => runAction(c.id, api.complaints.photos(c.id, files, caption))

  return (
    <div className="fade-in">
      <PageHeader
        title={t('complaints.title')}
        subtitle={t('complaints.subtitle')}
        actions={<>
          <ExportMenu title={t('complaints.export.title')} subtitle={t('complaints.export.subtitle', { count: n(rows.length) })}
            columns={exportColumns} rows={rows} filename="complaints" />
          <button className="btn btn-primary" onClick={() => setShowForm(true)}><IconPlus size={16} /> {t('complaints.logComplaint')}</button>
        </>}
      />

      {/* One error surface for every rejected write on this page. */}
      {error && (
        <div className="form-note bad" style={{ marginBottom: 16 }}>
          <IconAlert size={15} /> <span>{error}</span>
        </div>
      )}

      <div className="stat-grid" style={{ marginBottom: 20 }}>
        <StatCard icon={<IconAlert size={18} />} tone="warn" label={t('complaints.stat.active')} value={n(stats.active)}
          sub={`${t('status.open')} · ${t('status.assigned')} · ${t('status.in_progress')}`} />
        <StatCard icon={<IconClock size={18} />} tone="danger" label={t('complaints.stat.breached')} value={n(stats.breached)} sub={t('complaints.stat.breachedSub')} />
        <StatCard icon={<IconAlert size={18} />} tone="danger" label={t('complaints.stat.urgent')} value={n(stats.urgent)}
          sub={t('complaints.stat.urgentSub', { hours: n(priorityMeta('urgent').sla) })} />
        <StatCard icon={<IconCheck size={18} />} tone="ok" label={t('complaints.stat.median')}
          value={stats.median == null ? '—' : t('complaints.hours', { hours: n(stats.median) })}
          sub={t('complaints.stat.medianSub', { count: n(stats.resolved) })} />
      </div>

      <div className="filter-bar">
        <div className="seg">
          {[['all', t('common.all')], ['active', t('status.active')], ['done', t('status.resolved')]].map(([k, l]) => (
            <button key={k} className={status === k ? 'on' : ''} onClick={() => setStatus(k)}>{l}</button>
          ))}
        </div>
        <div className="chip-input">
          <IconSearch size={16} />
          <input placeholder={t('complaints.searchPlaceholder')} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select className="select" style={{ width: 'auto' }} value={type} onChange={(e) => setType(e.target.value)}>
          <option value="all">{t('complaints.allTypes')}</option>
          {COMPLAINT_TYPES.map((ct) => <option key={ct} value={ct}>{t(typeLabelKey(ct))}</option>)}
        </select>
        <select className="select" style={{ width: 'auto' }} value={priority} onChange={(e) => setPriority(e.target.value)}>
          <option value="all">{t('complaints.allPriorities')}</option>
          {PRIORITIES.map((p) => <option key={p} value={p}>{t(priorityLabelKey(p))}</option>)}
        </select>
        <div className="grow" />
        <span className="tiny muted">{t('complaints.ticketCount', { count: n(rows.length) })}</span>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr><th>{t('complaints.col.ticket')}</th><th>{t('complaints.col.type')}</th><th>{t('complaints.col.household')}</th><th>{t('complaints.col.priority')}</th><th>{t('complaints.col.channel')}</th><th>{t('complaints.col.assigned')}</th><th>{t('complaints.col.sla')}</th><th>{t('complaints.col.status')}</th><th></th></tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className="rowlink" onClick={() => setSelectedId(c.id)}>
                  <td className="mono">{c.id}</td>
                  <td style={{ fontWeight: 600 }}>{t(typeLabelKey(c.type))}</td>
                  <td>
                    <div className="small">{c.head || c.hh}</div>
                    <div className="tiny muted-3 mono">{c.ward}</div>
                  </td>
                  <td><PriorityBadge value={c.priority} /></td>
                  <td><span className="badge badge-muted">{t(`complaints.channelBadge.${c.channel}`)}</span></td>
                  <td className="small">{collectorName(c.assigned)}</td>
                  <td style={{ minWidth: 120 }}><SlaMeter complaint={c} /></td>
                  <td><Status value={c.status} /></td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <div className="row" style={{ gap: 2 }}>
                      {nextOf(c)
                        ? <button className="btn btn-ghost btn-sm" disabled={busyId === c.id} onClick={() => advance(c)}>
                          {busyId === c.id ? <span className="spinner spinner-dark" /> : t('complaints.advance')}
                        </button>
                        : <span className="tiny muted-3">—</span>}
                      <button className="act-btn" title={t('common.details')} onClick={() => setSelectedId(c.id)}><IconEye size={16} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && <EmptyState><IconAlert size={28} /><div className="mt-8">{t('complaints.empty')}</div></EmptyState>}
        </div>
      </div>

      {selected && (
        <ComplaintDrawer
          complaint={selected} collectors={collectors}
          collectorName={collectorName} onClose={() => setSelectedId(null)}
          busy={busyId === selected.id} error={error}
          onAdvance={() => advance(selected)}
          onReassign={(id) => reassign(selected, id)}
          onPriority={(p) => changePriority(selected, p)}
          onResolve={(note) => resolveWith(selected, note)}
          onReopen={() => reopen(selected)}
          onNote={(note) => addNote(selected, note)}
          onPhotos={(files, caption) => addPhotos(selected, files, caption)}
        />
      )}

      {showForm && (
        <ComplaintForm collectors={collectors} households={households} onClose={() => setShowForm(false)}
          onSave={async (data, assignTo) => {
            setError(null)
            // `id`, `status`, `sla`, `ward` and `activity` are all the server's to
            // assign — `sla` follows the priority and `ward` follows the holding.
            // `note` is the write-only text of the `created` audit entry.
            const created = await create('complaints', {
              hh: data.hh,
              type: data.type,
              channel: data.channel,
              priority: data.priority,
              description: data.description,
              note: t('complaints.note.logged'),
            })
            if (!created.ok) {
              setError(created.error?.fieldError?.('hh') || created.error?.detail || t('complaints.error.generic'))
              return
            }
            // Routing the ticket is a separate audited act (it also moves
            // open → assigned), so it follows the insert rather than riding along
            // in the payload where it would leave no trail. That call refreshes
            // the KPI strip itself, hence the else.
            if (assignTo) await runAction(created.data.id, api.complaints.assign(created.data.id, assignTo, ''))
            else setWrites((v) => v + 1)
            setShowForm(false)
          }} />
      )}
    </div>
  )
}

function ComplaintDrawer({ complaint: c, collectors, collectorName, onClose, busy, error, onAdvance, onReassign, onPriority, onResolve, onReopen, onNote, onPhotos }) {
  const { t, n, dateTime, digits } = useLang()
  const [note, setNote] = useState('')
  const fileInput = useRef(null)
  const s = slaOf(c)
  const meta = priorityMeta(c.priority)
  const next = nextOf(c)
  const active = isActive(c.status)
  const trail = c.activity || []
  const photos = c.photos || []

  const submitNote = () => { const text = note.trim(); if (!text) return; onNote(text); setNote('') }
  const submitResolve = () => { onResolve(note.trim()); setNote('') }

  // The note box doubles as the caption, so evidence arrives described. The
  // server validates type, size and that the bytes really decode as an image —
  // nothing is pre-screened here beyond the picker's own filter.
  async function pickPhotos(e) {
    const files = e.target.files
    if (!files?.length) return
    await onPhotos(files, note.trim())
    setNote('')
    if (fileInput.current) fileInput.current.value = ''
  }

  return (
    <>
      <div className="drawer-scrim" onClick={onClose} />
      <aside className="drawer">
        <div className="drawer-head">
          <div>
            <div className="row gap-8 wrap">
              <h3 style={{ fontSize: 17 }}>{t(typeLabelKey(c.type))}</h3>
              <span className={`badge ${meta.badge}`}><span className="dot" />{t(priorityLabelKey(c.priority))}</span>
              <Status value={c.status} />
            </div>
            <div className="tiny muted-3 mono mt-4">{c.id} · {t(`complaints.channelBadge.${c.channel}`)}</div>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label={t('common.close')}>✕</button>
        </div>
        <div className="drawer-body">
          {/* SLA banner */}
          <div className="card-pad" style={{ background: s.breached ? 'var(--danger-bg)' : 'var(--surface-2)', borderRadius: 10, marginBottom: 18 }}>
            <div className="row between">
              <span className="small" style={{ fontWeight: 700, color: s.breached ? 'var(--danger-fg)' : 'var(--text)' }}>
                {s.active ? (s.breached ? t('complaints.sla.breached') : t('complaints.sla.within')) : t('complaints.sla.settled')}
              </span>
              <span className="tiny muted">{t('complaints.sla.target', { hours: n(s.budget) })}</span>
            </div>
            <div className="mt-8"><SlaMeter complaint={c} wide /></div>
          </div>

          {/* The drawer covers the page's error note, so a rejected action is
              repeated here where the button that caused it is. */}
          {error && (
            <div className="form-note bad" style={{ marginBottom: 16 }}>
              <IconAlert size={15} /> <span>{error}</span>
            </div>
          )}

          {c.description && <p className="small" style={{ margin: '0 0 18px', lineHeight: 1.55 }}>{c.description}</p>}

          {/* head / holding / road / phone travel on the ticket itself. */}
          <dl className="kv">
            <dt>{t('complaints.col.household')}</dt><dd>{c.head || c.hh}</dd>
            <dt>{t('complaints.detail.wardRoad')}</dt><dd>{c.ward}{c.road ? ` · ${c.road}` : ''}</dd>
            {c.phone && <><dt>{t('complaints.detail.contact')}</dt><dd className="mono row gap-8"><IconPhone size={13} /> {digits(c.phone)}</dd></>}
            <dt>{t('complaints.col.opened')}</dt><dd>{dateTime(c.opened)}</dd>
          </dl>

          {/* Controls */}
          <div className="row gap-12 wrap mt-24" style={{ alignItems: 'flex-start' }}>
            <Field half as="select" label={t('complaints.detail.assignedTo')} value={c.assigned || ''} disabled={busy}
              onChange={(e) => onReassign(e.target.value)}
              options={[{ value: '', label: t('complaints.unassigned') }, ...collectors.map((col) => ({ value: col.id, label: col.name }))]} />
            <Field half as="select" label={t('complaints.col.priority')} value={c.priority} disabled={busy}
              onChange={(e) => onPriority(e.target.value)}
              options={PRIORITIES.map((p) => ({ value: p, label: t(priorityLabelKey(p)) }))} />
          </div>

          <div className="row gap-8 wrap mt-16">
            {next && <button className="btn btn-primary" disabled={busy} onClick={onAdvance}><IconArrow size={15} /> {t('complaints.advanceTo', { status: t(`status.${next}`) })}</button>}
            {active && c.status !== 'resolved' && <button className="btn btn-ghost" disabled={busy} onClick={submitResolve}><IconCheck size={15} /> {t('complaints.resolve')}</button>}
            {isClosedOut(c.status) && <button className="btn btn-ghost" disabled={busy} onClick={onReopen}>{t('complaints.reopen')}</button>}
          </div>

          {/* Evidence */}
          <h4 className="mt-24" style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--text-3)' }}>
            <IconEye size={13} style={{ verticalAlign: '-2px', marginRight: 6 }} />{t('complaints.photos', { count: n(photos.length) })}
          </h4>
          {photos.length > 0 ? (
            <div className="row gap-8 wrap mt-8">
              {photos.map((p) => (
                <a key={p.id} href={p.url} target="_blank" rel="noreferrer" title={p.caption || dateTime(p.at)}>
                  <img src={p.url} alt={p.caption || ''} loading="lazy"
                    style={{ width: 76, height: 76, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border)', display: 'block' }} />
                </a>
              ))}
            </div>
          ) : <div className="tiny muted-3 mt-8">{t('complaints.noPhotos')}</div>}
          <div className="mt-8">
            <input ref={fileInput} className="input" type="file" accept="image/*" multiple
              disabled={busy} onChange={pickPhotos} aria-label={t('complaints.addPhotos')} />
            <div className="tiny muted-3 mt-4">{busy ? t('complaints.uploading') : t('complaints.photoHint')}</div>
          </div>

          {/* Activity timeline */}
          <h4 className="mt-24" style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--text-3)' }}>
            <IconUsers size={13} style={{ verticalAlign: '-2px', marginRight: 6 }} />{t('complaints.activity', { count: n(trail.length) })}
          </h4>
          <ol className="cmp-timeline mt-8">
            {trail.map((a, i) => (
              <li key={i} className={`cmp-event ${i === trail.length - 1 ? 'latest' : ''}`}>
                <span className="cmp-node" />
                <div>
                  <div className="small" style={{ fontWeight: 600 }}>{t(actionLabelKey(a.action))}</div>
                  {a.note && <div className="tiny muted mt-4">{a.note}</div>}
                  <div className="tiny muted-3 mt-4">{t(actorLabelKey(a.by))} · {dateTime(a.at)}</div>
                </div>
              </li>
            ))}
          </ol>

          {/* Note composer */}
          <div className="mt-16">
            <Field as="textarea" label={t('complaints.noteLabel')} value={note} placeholder={t('complaints.notePlaceholder')}
              disabled={busy} onChange={(e) => setNote(e.target.value)} />
            <div className="row gap-8 mt-8" style={{ justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost btn-sm" disabled={busy} onClick={submitNote}>{t('complaints.addNote')}</button>
              {active && <button className="btn btn-primary btn-sm" disabled={busy} onClick={submitResolve}>
                {busy ? <span className="spinner" /> : <><IconCheck size={14} /> {t('complaints.resolveWithNote')}</>}
              </button>}
            </div>
          </div>
        </div>
      </aside>
    </>
  )
}

function ComplaintForm({ collectors, households, onClose, onSave }) {
  const { t, n, wardName } = useLang()
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({
    hh: households[0]?.id || '', type: 'missed_collection', channel: 'app',
    assigned: collectors[0]?.id || '', priority: 'medium', description: '',
  })
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  // The ward is not an input any more: Complaint.save() copies it off the
  // holding, so a ticket can never be filed against a ward its holding is not in.
  const ward = households.find((h) => h.id === form.hh)?.ward

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    await onSave(form, form.assigned)
    setBusy(false)
  }

  return (
    <Modal title={t('complaints.form.title')} subtitle={t('complaints.form.subtitle')} onClose={onClose} width={560}>
      <form onSubmit={submit}>
        <Field as="select" label={t('complaints.col.household')} value={form.hh} onChange={set('hh')}
          options={households.map((h) => ({ value: h.id, label: `${h.head} · ${h.id}` }))} />
        <FormRow>
          <Field half as="select" label={t('complaints.col.type')} value={form.type} onChange={set('type')}
            options={COMPLAINT_TYPES.map((ct) => ({ value: ct, label: t(typeLabelKey(ct)) }))} />
          <Field half as="select" label={t('complaints.col.priority')} value={form.priority} onChange={set('priority')}
            options={PRIORITIES.map((p) => ({ value: p, label: t('complaints.form.priorityOption', { priority: t(priorityLabelKey(p)), hours: n(priorityMeta(p).sla) }) }))} />
        </FormRow>
        <FormRow>
          <Field half as="select" label={t('complaints.col.channel')} value={form.channel} onChange={set('channel')}
            options={[{ value: 'app', label: t('complaints.channel.app') }, { value: 'sms', label: t('complaints.channel.sms') }]} />
          <Field half as="select" label={t('complaints.form.assignTo')} value={form.assigned} onChange={set('assigned')}
            options={[{ value: '', label: t('complaints.unassigned') }, ...collectors.map((c) => ({ value: c.id, label: c.name }))]} />
        </FormRow>
        <Field half label={t('complaints.col.ward')} value={ward ? wardName(ward) : '—'} readOnly
          hint={t('complaints.form.wardHint')} />
        <Field as="textarea" label={t('complaints.col.description')} value={form.description} onChange={set('description')} placeholder={t('complaints.form.descriptionPlaceholder')} />
        <ModalActions>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>{t('common.cancel')}</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? <span className="spinner" /> : t('complaints.form.submit')}
          </button>
        </ModalActions>
      </form>
    </Modal>
  )
}
