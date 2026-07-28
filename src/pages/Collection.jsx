import { useState, useMemo, useCallback, useEffect, Fragment } from 'react'
import { PageHeader, StatCard, Status, EmptyState } from '../components/ui.jsx'
import { Modal, Field, ModalActions } from '../components/Modal.jsx'
import QrScanner from '../components/QrScanner.jsx'
import {
  IconQr, IconCheck, IconClock, IconRoute, IconHome,
  IconArrow, IconRefresh, IconSearch, IconAlert,
} from '../components/Icons.jsx'
import { useData } from '../context/DataContext.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { useLang } from '../i18n/index.jsx'
import { SKIP_REASONS, VISIT_STATUS, today } from '../utils/collection.js'

const EMPTY_COUNTS = { all: 0, collected: 0, skipped: 0, pending: 0 }

// A rejected write says why under `fields` — "A skipped stop needs a reason." is
// far more use in the field than the top-level "Invalid input."
function errorText(error) {
  const [first] = Object.values(error.fields || {})
  const text = Array.isArray(first) ? first[0] : first
  return text || error.detail
}

// A collection is stamped with wherever the device thinks it is. The round must
// never stall on a slow GPS fix, so this resolves with nulls rather than waiting.
function readPosition() {
  return new Promise((resolve) => {
    const blank = { accuracy: null, lat: null, lng: null }
    if (!navigator.geolocation) { resolve(blank); return }
    let settled = false
    const done = (v) => { if (!settled) { settled = true; resolve(v) } }
    const timer = setTimeout(() => done(blank), 2500)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(timer)
        done({
          accuracy: Math.round(pos.coords.accuracy),
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        })
      },
      () => { clearTimeout(timer); done(blank) },
      { enableHighAccuracy: true, timeout: 2500, maximumAge: 10000 },
    )
  })
}

export default function Collection() {
  const { collectors, visits, api, act, remove, ready } = useData()
  const { user } = useAuth()
  const { t, n, digits, date, time, percent, wardName } = useLang()

  // A collector always gets their own round: the server pins the request to the
  // logged-in collector and ignores whatever id we ask for. The picker stays for
  // supervisors and admins, which is also how the round gets demoed on a desktop.
  const isCollector = user?.roleKey === 'collector'
  const [who, setWho] = useState('')

  const [filter, setFilter] = useState('all') // all | collected | pending
  const [q, setQ] = useState('')
  const [scanning, setScanning] = useState(false)
  const [skipping, setSkipping] = useState(null)
  const [flash, setFlash] = useState(null) // { tone, text }
  // Stops with a write in flight. The GPS read takes up to 2.5s, during which
  // the row still showed "Collect" — a second tap wrote a second visit record.
  const [working, setWorking] = useState(() => new Set())
  const [syncing, setSyncing] = useState(false)
  const [round, setRound] = useState(null)
  const [loadingRound, setLoadingRound] = useState(false)
  const day = today()

  // The picker needs a real collector id — the round endpoint has no "everyone"
  // reading. A collector-role caller sends none and the server fills it in.
  useEffect(() => {
    if (isCollector || who) return
    const first = collectors[0]?.id
    if (first) setWho(first)
  }, [isCollector, who, collectors])

  // The round is the route plan, read server-side: same stops, same walking order
  // a supervisor laid out on the Route Plan screen, route after route. Reading it
  // here rather than rebuilding it is what keeps this list and the supervisor's
  // Routes view showing the same thing.
  const loadRound = useCallback(async () => {
    if (!isCollector && !who) return
    setLoadingRound(true)
    const res = await act(api.collection.round({ collector: isCollector ? undefined : who, day }))
    setLoadingRound(false)
    if (res.ok) setRound(res.data)
    else { setRound(null); setFlash({ tone: 'bad', text: errorText(res.error) }) }
  }, [act, api, isCollector, who, day])

  useEffect(() => { if (ready) loadRound() }, [ready, loadRound])

  const stops = round?.stops || []
  const counts = round?.counts || EMPTY_COUNTS
  const myRoutes = round?.routes || []
  // The round is read for whoever the server decided it belongs to, which for a
  // collector is themselves whatever the picker says.
  const roundOwner = round?.collector || who

  // Count the queue from the visit records themselves, not from the round: a
  // record the round no longer surfaces still has to reach the server.
  const queuedVisits = useMemo(
    () => visits.filter((v) => v.collector === roundOwner && v.synced === false),
    [visits, roundOwner],
  )
  const queued = queuedVisits.length

  const rows = useMemo(() => stops.filter((s) => {
    // "Pending" means anything not yet collected — a skipped stop still needs a
    // return visit, so hiding it behind a fourth tab would lose it.
    if (filter === 'collected' && s.visitStatus !== VISIT_STATUS.collected) return false
    if (filter === 'pending' && s.visitStatus === VISIT_STATUS.collected) return false
    if (!q) return true
    const needle = q.toLowerCase()
    return [s.head, s.holding, s.road, s.qr, s.hh].some((v) => String(v || '').toLowerCase().includes(needle))
  }), [stops, filter, q])

  // Break the round back into its routes for the table. The filters and the
  // search deliberately span the whole round, so the headings are built from
  // what survived them — a road with nothing left to show drops out instead of
  // leaving an empty heading behind. Stops arrive route by route, so a single
  // pass is enough to find the boundaries.
  const groups = useMemo(() => {
    const out = []
    for (const s of rows) {
      const last = out[out.length - 1]
      if (last && last.id === s.routeId) last.stops.push(s)
      else out.push({ id: s.routeId, name: s.routeName, stops: [s] })
    }
    return out.map((g) => ({
      ...g,
      window: myRoutes.find((r) => r.id === g.id)?.window || null,
      done: g.stops.filter((s) => s.visitStatus === VISIT_STATUS.collected).length,
    }))
  }, [rows, myRoutes])

  // What the collector holds today, named — a route id alone tells a collector
  // nothing, the road name is what they were told at the depot.
  const routeSummary = myRoutes.length === 0
    ? t('collection.stat.stopsSub')
    : myRoutes.length === 1
      ? t('collection.stat.onRoute', { name: myRoutes[0].name, window: digits(myRoutes[0].window) })
      : t('collection.stat.onRoutes', { count: n(myRoutes.length), names: myRoutes.map((r) => r.name).join(' · ') })

  // One POST /api/visits/ create-or-updates the day's single record for the
  // holding, so correcting a skip into a collection is the same call — there is
  // no client-side id to reuse any more.
  const record = useCallback(async (stop, status, extra = {}) => {
    if (working.has(stop.hh)) return null
    setWorking((prev) => new Set(prev).add(stop.hh))
    try {
      const where = status === VISIT_STATUS.collected ? await readPosition() : {}
      const res = await act(
        api.visits.create({ hh: stop.hh, status, ...where, ...extra }),
        { refresh: ['visits'] },
      )
      if (!res.ok) setFlash({ tone: 'bad', text: errorText(res.error) })
      else await loadRound()
      return res
    } finally {
      setWorking((prev) => { const next = new Set(prev); next.delete(stop.hh); return next })
    }
  }, [act, api, loadRound, working])

  async function collect(stop, source = 'manual') {
    const res = await record(stop, VISIT_STATUS.collected, { source })
    if (!res?.ok) return
    setFlash({ tone: 'ok', text: t('collection.result.ok', { name: stop.head, holding: digits(stop.holding) }) })
  }

  // Undo removes the visit outright — a record with status "pending" would be a
  // third state the rest of the app does not model. There is exactly one record
  // per holding per day now, so the stop carries the only id to delete.
  async function undo(stop) {
    if (!stop.visitId || working.has(stop.hh)) return
    setWorking((prev) => new Set(prev).add(stop.hh))
    const res = await remove('visits', stop.visitId)
    setWorking((prev) => { const next = new Set(prev); next.delete(stop.hh); return next })
    if (!res.ok) { setFlash({ tone: 'bad', text: errorText(res.error) }); return }
    setFlash(null)
    await loadRound()
  }

  // Uploading the queue answers per row, not per batch: a collector has to be
  // told which records are still stuck rather than seeing "all synced" over a
  // silent failure.
  async function syncQueue() {
    if (syncing || !queued) return
    setSyncing(true)
    const res = await act(
      // `collector` travels with each row: the server only fills it in for a
      // collector-role caller, so a supervisor uploading a queue would otherwise
      // strip the attribution off every record.
      api.visits.bulk(queuedVisits.map((v) => ({
        hh: v.hh, collector: v.collector, status: v.status, at: v.at, accuracy: v.accuracy,
        lat: v.lat, lng: v.lng, source: v.source || '', reason: v.reason || '', note: v.note || '',
      }))),
      { refresh: ['visits'] },
    )
    setSyncing(false)
    if (!res.ok) { setFlash({ tone: 'bad', text: errorText(res.error) }); return }
    const saved = res.data?.saved?.length || 0
    const failed = res.data?.failed?.length || 0
    setFlash(failed
      ? { tone: 'warn', text: t('collection.syncPartial', { saved: n(saved), failed: n(failed) }) }
      : { tone: 'ok', text: t('collection.syncDone', { count: n(saved) }) })
    await loadRound()
  }

  // The server resolves a scan against this round, then against every household,
  // so a wrong-round scan can say so instead of just failing. It answers 200
  // either way — a worn label is something the collector acts on, not an error.
  const onDetect = useCallback(async (raw) => {
    setScanning(false)
    // Pass the round being viewed so a supervisor scanning on someone else's
    // behalf resolves against that round, not their own empty one. The server
    // ignores both for a collector-role caller.
    const res = await act(api.collection.scan(raw, { collector: isCollector ? undefined : who, day }))
    if (!res.ok) { setFlash({ tone: 'bad', text: errorText(res.error) }); return }
    const result = res.data
    if (result.ok) { collect(result.stop, 'scan'); return }
    if (result.reason === 'alreadyCollected') {
      setFlash({ tone: 'warn', text: t('collection.result.alreadyCollected', { name: result.stop.head, time: time(result.stop.at) }) })
    } else if (result.reason === 'otherRoute') {
      setFlash({ tone: 'warn', text: t('collection.result.otherRoute', { holding: digits(result.household.holding), ward: wardName(result.household.ward) }) })
    } else if (result.reason === 'unknown') {
      setFlash({ tone: 'bad', text: t('collection.result.unknown', { code: result.code }) })
    } else {
      setFlash({ tone: 'bad', text: t('collection.result.unreadable') })
    }
  }, [act, api, t, time, digits, wardName, isCollector, who, day]) // eslint-disable-line react-hooks/exhaustive-deps

  const pct = counts.all ? Math.round((counts.collected / counts.all) * 100) : 0

  return (
    <div className="fade-in">
      <PageHeader
        title={t('collection.title')}
        subtitle={t('collection.subtitle', { date: date(new Date()) })}
        actions={<>
          {loadingRound && <span className="spinner spinner-dark" />}
          {queued > 0 && (
            <button className="btn btn-ghost" disabled={syncing} onClick={syncQueue}>
              {syncing ? <span className="spinner spinner-dark" /> : <IconRefresh size={16} />}
              {t('collection.action.sync', { count: n(queued) })}
            </button>
          )}
          <button className="btn btn-primary" onClick={() => { setFlash(null); setScanning(true) }}>
            <IconQr size={16} /> {t('collection.scanCta')}
          </button>
        </>}
      />

      <div className="stat-grid" style={{ marginBottom: 20 }}>
        <StatCard icon={<IconRoute size={18} />} label={t('collection.stat.stops')} value={n(counts.all)}
          sub={routeSummary} />
        <StatCard icon={<IconCheck size={18} />} tone="ok" label={t('collection.stat.collected')} value={n(counts.collected)}
          sub={t('collection.stat.collectedSub', { pct: percent(pct) })} progress={pct} />
        <StatCard icon={<IconClock size={18} />} tone="warn" label={t('collection.stat.pending')} value={n(counts.all - counts.collected)}
          sub={t('collection.stat.pendingSub')} />
        <StatCard icon={<IconRefresh size={18} />} tone="info" label={t('collection.stat.queued')} value={n(queued)}
          sub={queued ? t('collection.stat.queuedSub') : t('collection.action.synced')} />
      </div>

      {flash && (
        <div className={`form-note ${flash.tone === 'ok' ? 'ok' : flash.tone === 'bad' ? 'bad' : 'info'}`} style={{ marginBottom: 16 }}>
          {flash.tone === 'ok' ? <IconCheck size={15} /> : <IconAlert size={15} />}
          <span className="grow">{flash.text}</span>
          <button className="icon-btn" onClick={() => setFlash(null)} aria-label={t('common.close')}>✕</button>
        </div>
      )}

      <div className="filter-bar">
        <div className="seg">
          {[['all', t('collection.filter.all'), counts.all],
            ['collected', t('collection.filter.collected'), counts.collected],
            ['pending', t('collection.filter.pending'), counts.all - counts.collected],
          ].map(([key, label, count]) => (
            <button key={key} className={filter === key ? 'on' : ''} onClick={() => setFilter(key)}>
              {label} ({n(count)})
            </button>
          ))}
        </div>
        <div className="chip-input">
          <IconSearch size={16} />
          <input placeholder={t('collection.search')} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select className="select" style={{ width: 'auto' }} aria-label={t('collection.pickCollector')}
          value={roundOwner} disabled={isCollector}
          onChange={(e) => { setWho(e.target.value); setFlash(null) }}>
          {collectors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <div className="grow" />
        <span className="tiny muted">{t('common.shown', { count: n(rows.length) })}</span>
      </div>

      {filter === 'pending' && counts.skipped > 0 && (
        <div className="tiny muted-3" style={{ margin: '-8px 0 12px' }}>{t('collection.filter.hint')}</div>
      )}

      <div className="card">
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>{t('collection.col.household')}</th>
                <th>{t('collection.col.holding')}</th>
                <th>{t('collection.col.tag')}</th>
                <th>{t('collection.col.time')}</th>
                <th>{t('collection.col.status')}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <Fragment key={g.id}>
                  <tr>
                    <td colSpan={6} style={{ background: 'var(--surface-2)', padding: '9px 14px' }}>
                      <div className="row between wrap gap-8">
                        <div className="row gap-8 wrap">
                          <IconRoute size={14} />
                          <span style={{ fontWeight: 700 }}>{g.name}</span>
                          <span className="tiny muted-3 mono">{g.id}</span>
                          {g.window && <span className="tiny muted-3">{digits(g.window)}</span>}
                        </div>
                        <span className="tiny muted-3">
                          {t('collection.route.progress', { done: n(g.done), total: n(g.stops.length) })}
                        </span>
                      </div>
                    </td>
                  </tr>
                  {g.stops.map((s) => {
                    const done = s.visitStatus === VISIT_STATUS.collected
                    const busy = working.has(s.hh)
                    return (
                      <tr key={s.hh}>
                        <td>
                          <div style={{ fontWeight: 600 }}>{s.head}</div>
                          <div className="tiny muted-3">{s.road}</div>
                        </td>
                        <td>{s.holding}</td>
                        <td className="mono small">{s.qr || <span className="muted-3">—</span>}</td>
                        <td className="small">
                          {s.at ? <>
                            {time(s.at)}
                            {s.accuracy != null && <div className="tiny muted-3">{t('collection.gps', { m: n(s.accuracy) })}</div>}
                          </> : <span className="muted-3">{t('collection.notCollected')}</span>}
                        </td>
                        <td>
                          <div className="row gap-8 wrap">
                            <Status value={s.visitStatus} />
                            {s.synced === false && <span className="badge badge-info"><span className="dot" />{t('collection.queued')}</span>}
                          </div>
                        </td>
                        <td>
                          <div className="row gap-8" style={{ justifyContent: 'flex-end' }}>
                            {done ? (
                              <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => undo(s)}>{t('collection.action.undo')}</button>
                            ) : (
                              <>
                                <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setSkipping(s)}>{t('collection.action.skip')}</button>
                                <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => collect(s)}>
                                  <IconCheck size={14} /> {t('collection.action.collect')}
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </Fragment>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && (
            <EmptyState>
              <IconHome size={28} />
              <div className="mt-8">
                {loadingRound ? t('common.loading') : counts.all === 0 ? t('collection.noRoute') : t('collection.noMatch')}
              </div>
            </EmptyState>
          )}
        </div>
      </div>

      {scanning && (
        <ScanModal
          onClose={() => setScanning(false)}
          onDetect={onDetect}
        />
      )}

      {skipping && (
        <SkipModal
          stop={skipping}
          busy={working.has(skipping.hh)}
          onClose={() => setSkipping(null)}
          onConfirm={async (reason) => {
            // The server rejects a skip with no reason, so the picker's default
            // is always sent rather than an empty string.
            const res = await record(skipping, VISIT_STATUS.skipped, { reason })
            if (res?.ok) setSkipping(null)
          }}
        />
      )}
    </div>
  )
}

function ScanModal({ onClose, onDetect }) {
  const { t } = useLang()
  const [manual, setManual] = useState('')

  return (
    <Modal title={t('collection.scanTitle')} subtitle={t('collection.scanSubtitle')} onClose={onClose} width={480}>
      <QrScanner onDetect={onDetect} />
      <form
        style={{ marginTop: 16 }}
        onSubmit={(e) => { e.preventDefault(); if (manual.trim()) onDetect(manual.trim()) }}
      >
        <Field
          label={t('collection.scan.manualLabel')}
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          placeholder={t('collection.scan.manualPlaceholder')}
          className="input mono"
        />
        <ModalActions>
          <button type="button" className="btn btn-ghost" onClick={onClose}>{t('common.cancel')}</button>
          <button type="submit" className="btn btn-primary" disabled={!manual.trim()}>
            <IconArrow size={15} /> {t('collection.scan.check')}
          </button>
        </ModalActions>
      </form>
    </Modal>
  )
}

function SkipModal({ stop, busy, onClose, onConfirm }) {
  const { t } = useLang()
  const [reason, setReason] = useState(SKIP_REASONS[0])

  return (
    <Modal title={t('collection.skipReason')} subtitle={`${stop.head} · ${stop.holding}`} onClose={onClose} width={440}>
      <Field
        label={t('collection.skipReason')}
        as="select" value={reason} disabled={busy} onChange={(e) => setReason(e.target.value)}
        options={SKIP_REASONS.map((r) => ({ value: r, label: t(`collection.skip.${r}`) }))}
      />
      <ModalActions>
        <button type="button" className="btn btn-ghost" onClick={onClose}>{t('common.cancel')}</button>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => onConfirm(reason)}>
          {busy ? <span className="spinner" /> : t('collection.confirmSkip')}
        </button>
      </ModalActions>
    </Modal>
  )
}
