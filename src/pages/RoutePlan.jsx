// Route planning — the supervisor's side of the daily round.
//
// Two records answer two different questions, and this screen edits both:
//
//   routes      — WHICH holdings make up a round, in walking order. A route is
//                 tied to a place, so it can be handed to whoever is on shift
//                 without rewriting the round itself.
//   assignments — WHO walks which rounds. A collector may hold several.
//
// Four rules the screen must never bend:
//
//   1. a holding sits on exactly one route,
//   2. only a verified holding may be planned (no confirmed location means
//      nobody can be sent to it),
//   3. every stop on a route sits in that route's ward, and
//   4. no work is ever handed to a collector who is off route.
//
// The first three are now the server's: `POST /routes/<id>/stops/` validates the
// whole proposed walk and names the holding it refused, so a list rendered a
// moment ago cannot write a plan that breaks them. The picker still filters by
// them, to keep a planner from being told "no" for something it could have
// hidden. Rule 4 has no server counterpart and stays here.
import { useState, useMemo, useEffect, useCallback } from 'react'
import { PageHeader, StatCard, Section, EmptyState, Status } from '../components/ui.jsx'
import { Modal, Field, ModalActions } from '../components/Modal.jsx'
import {
  IconRoute, IconHome, IconAlert, IconCheck, IconPlus, IconTrash,
  IconSearch, IconShield, IconEdit, IconUsers,
} from '../components/Icons.jsx'
import { useData } from '../context/DataContext.jsx'
import { useLang } from '../i18n/index.jsx'
import {
  assignmentFor, routesForCollector, collectorForRoute, isRoutable, orderStops,
} from '../utils/collection.js'

const DEFAULT_WINDOW = '06:00–09:30'
// 06:00–09:30 — an en dash is what the seed uses, but a typed hyphen is accepted.
const WINDOW_RE = /^(\d{1,2}):(\d{2})\s*[–—-]\s*(\d{1,2}):(\d{2})$/
const PREVIEW = 6
const NO_GAPS = { routable: [], unverified: [], total: 0 }

const isActive = (r) => r && r.active !== false

// `window` is a read-only display string on the wire; writes send the two ends
// separately. The planner still types one range, so it is split on save.
const splitWindow = (text) => {
  const parts = WINDOW_RE.exec(String(text || '').trim())
  if (!parts) return null
  const pad = (v) => String(v).padStart(2, '0')
  return { windowStart: `${pad(parts[1])}:${parts[2]}`, windowEnd: `${pad(parts[3])}:${parts[4]}` }
}

// …and back, so the edit dialog reopens on exactly what was stored rather than
// on a display string it would have to re-parse.
const joinWindow = (route) => (
  route?.windowStart && route?.windowEnd
    ? `${route.windowStart}–${route.windowEnd}`
    : route?.window || DEFAULT_WINDOW
)

// A refused write names the holding or the route it refused, under `fields`.
// That is what a planner dragging thirty holdings needs; the top-level detail
// only says "Invalid input".
function message(error) {
  const named = error.fieldError('stops') || error.fieldError('routes')
  if (named) return named
  const [first] = Object.values(error.fields || {})
  const text = Array.isArray(first) ? first[0] : first
  return text || error.detail
}

export default function RoutePlan() {
  const { collectors, households, routes, assignments, wards, api, act, create, update, remove, ready } = useData()
  const { t, n } = useLang()

  const [tab, setTab] = useState('routes')
  const [picked, setPicked] = useState(null)   // selected route id
  const [form, setForm] = useState(null)       // { route } — null route means "create"
  const [picking, setPicking] = useState(false)
  const [attachTo, setAttachTo] = useState(null) // collector id awaiting a route
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [unplanned, setUnplanned] = useState(NO_GAPS)

  const byId = useMemo(() => new Map(households.map((h) => [h.id, h])), [households])
  const plannedCount = households.length - unplanned.total

  // The coverage gap is a server aggregate now: "on no route" is a join the
  // browser can only guess at once the household list is paginated.
  const loadGaps = useCallback(async () => {
    const res = await act(api.households.unplanned())
    if (res.ok) setUnplanned(res.data)
  }, [act, api])

  useEffect(() => { if (ready) loadGaps() }, [ready, loadGaps])

  // Keep the selection pointing at a route that still exists — a deleted route
  // would otherwise leave the editor rendering a ghost.
  useEffect(() => {
    if (!routes.some((r) => r.id === picked)) setPicked(routes[0]?.id || null)
  }, [routes, picked])

  const route = routes.find((r) => r.id === picked) || null

  // ---- writes ---------------------------------------------------------------
  // Every write funnels through these two: one busy flag stops a double submit,
  // and a refusal surfaces in the note above instead of failing silently.
  const finish = useCallback(async (res) => {
    setBusy(false)
    if (!res.ok) setError(message(res.error))
    else { setError(null); await loadGaps() }
    return res
  }, [loadGaps])

  const run = useCallback(async (promise, refresh = ['routes']) => {
    if (busy) return null
    setBusy(true)
    return finish(await act(promise, { refresh }))
  }, [busy, act, finish])

  // create / update / remove already return the `{ ok, data, error }` envelope.
  const runWrite = useCallback(async (fn) => {
    if (busy) return null
    setBusy(true)
    return finish(await fn())
  }, [busy, finish])

  // ---- route writes ---------------------------------------------------------
  // One call replaces the whole ordered list, so a reorder is atomic — patching
  // `stops` field-wise could leave a half-applied walk behind.
  const writeStops = (target, stops) => run(api.routes.setStops(target.id, stops))

  async function saveRoute({ id, name, ward, win }) {
    const period = splitWindow(win)
    const existing = routes.find((r) => r.id === id)
    if (existing) {
      // The ward is only editable while the round is empty, so stops can never
      // be stranded outside their route's ward.
      const patch = { name, ...period }
      if (!existing.stops.length) patch.ward = ward
      const res = await runWrite(() => update('routes', id, patch))
      return res?.ok === true
    }
    const res = await runWrite(() => create('routes', { name, ward, ...period, stops: [], active: true }))
    if (res?.ok) setPicked(res.data.id)
    return res?.ok === true
  }

  async function deleteRoute(target) {
    const ok = window.confirm(t('routePlan.editor.deleteConfirm', {
      route: target.name, count: n(target.stops.length),
    }))
    if (!ok) return
    // The delete cascades server-side: the route is dropped from whoever held it
    // and its stops go back to the unplanned list. DataContext refetches both.
    const res = await runWrite(() => remove('routes', target.id))
    if (res?.ok) setPicked(null)
  }

  // The single gate every add passes through — bulk, ticked or one at a time.
  // Filtering here only spares the planner a refusal it could not have foreseen;
  // the server re-checks every rule before it writes.
  function addStops(target, ids) {
    if (!target) return
    const onRoute = new Set(target.stops)
    const next = []
    for (const id of ids) {
      const h = byId.get(id)
      if (!h) continue
      if (!isRoutable(h)) continue          // rule 2 — unverified is never planned
      if (onRoute.has(id) || next.includes(id)) continue
      if (h.ward !== target.ward) continue  // rule 3 — a round stays in its ward
      next.push(id)
    }
    if (!next.length) return
    // A single holding goes through add-stop, which also lifts it off whatever
    // route it was on; a batch replaces the walking order in one write.
    if (next.length === 1) run(api.routes.addStop(target.id, next[0]))
    else writeStops(target, [...target.stops, ...next])
  }

  const dropStop = (target, id) => run(api.routes.removeStop(target.id, id))

  // Reorder by id, not by row index: a stop whose household record has since
  // vanished still holds its place in the stored order.
  function move(target, id, delta) {
    const next = [...target.stops]
    const index = next.indexOf(id)
    if (index < 0) return
    const to = index + delta
    if (to < 0 || to >= next.length) return
    ;[next[index], next[to]] = [next[to], next[index]]
    writeStops(target, next)
  }

  // Holding order is the fallback the seed uses; offered as a one-click tidy-up
  // for a round that was built by ticking boxes out of order.
  function sortStops(target) {
    const known = target.stops.map((id) => byId.get(id)).filter(Boolean)
    const missing = target.stops.filter((id) => !byId.has(id))
    writeStops(target, [...orderStops(known).map((h) => h.id), ...missing])
  }

  // Leaves one round and joins another in a single call, so a holding is never
  // briefly on two routes or on none — add-stop moves it server-side.
  function moveStop(from, id, toId) {
    const to = routes.find((r) => r.id === toId)
    const h = byId.get(id)
    if (!to || !h || to.id === from.id) return
    if (h.ward !== to.ward) return
    run(api.routes.addStop(to.id, id))
  }

  // ---- assignment writes ----------------------------------------------------
  async function attachRoute(collector, routeId) {
    if (!collector || collector.status === 'off_route') return // rule 4
    if (!routes.some((r) => r.id === routeId)) return

    const holder = collectorForRoute(routeId, assignments)
    if (holder === collector.id) return
    if (holder) {
      // At most one collector per route: moving it is the only way to hand a
      // held round over, and the planner has to say so out loud. The server
      // performs the hand-over itself, so nothing has to be detached first.
      const from = collectors.find((c) => c.id === holder)
      const named = routes.find((r) => r.id === routeId)
      const ok = window.confirm(t('routePlan.attach.moveConfirm', {
        route: named?.name || routeId, from: from?.name || holder, to: collector.name,
      }))
      if (!ok) return
    }

    const mine = assignmentFor(collector.id, assignments)
    if (mine) await run(api.assignments.setRoutes(mine.id, [...(mine.routes || []), routeId]), ['assignments', 'routes'])
    else await runWrite(() => create('assignments', { collector: collector.id, routes: [routeId], active: true }))
  }

  // Detaching the last route removes the record — an assignment holding nothing
  // says nothing, and leaving one behind would read as "assigned, no work".
  function detachRoute(collectorId, routeId) {
    const plan = assignmentFor(collectorId, assignments)
    if (!plan) return
    const rest = (plan.routes || []).filter((id) => id !== routeId)
    if (rest.length) run(api.assignments.setRoutes(plan.id, rest), ['assignments'])
    else runWrite(() => remove('assignments', plan.id))
  }

  const heldCount = assignments.filter((a) => a.active !== false).length

  return (
    <div className="fade-in">
      <PageHeader
        title={t('routePlan.title')}
        subtitle={t('routePlan.subtitle')}
        actions={(
          <div className="row gap-8 wrap">
            {busy && <span className="spinner spinner-dark" />}
            <div className="seg">
              <button type="button" className={tab === 'routes' ? 'on' : ''} onClick={() => setTab('routes')}>
                {t('routePlan.tab.routes')} ({n(routes.length)})
              </button>
              <button type="button" className={tab === 'crew' ? 'on' : ''} onClick={() => setTab('crew')}>
                {t('routePlan.tab.assignments')} ({n(heldCount)})
              </button>
            </div>
          </div>
        )}
      />

      {error && (
        <div className="form-note bad" style={{ marginBottom: 16 }}>
          <IconAlert size={15} />
          <span className="grow">{error}</span>
          <button className="icon-btn" onClick={() => setError(null)} aria-label={t('common.close')}>✕</button>
        </div>
      )}

      <div className="stat-grid" style={{ marginBottom: 20 }}>
        <StatCard icon={<IconRoute size={18} />} label={t('routePlan.stat.routes')}
          value={n(routes.length)} sub={t('routePlan.stat.routesSub')} />
        <StatCard icon={<IconCheck size={18} />} tone="ok" label={t('routePlan.stat.planned')}
          value={n(plannedCount)} sub={t('routePlan.stat.plannedSub')}
          progress={households.length ? (plannedCount / households.length) * 100 : 0} />
        <StatCard icon={<IconHome size={18} />} tone="warn" label={t('routePlan.stat.unplanned')}
          value={n(unplanned.total)} sub={t('routePlan.stat.unplannedSub')} />
        <StatCard icon={<IconShield size={18} />} tone="danger" label={t('routePlan.stat.unverified')}
          value={n(unplanned.unverified.length)} sub={t('routePlan.stat.unverifiedSub')} />
      </div>

      <CoverageGap unplanned={unplanned} />

      {tab === 'routes' ? (
        <>
          <RouteList
            routes={routes}
            assignments={assignments}
            collectors={collectors}
            picked={picked}
            onPick={setPicked}
            onNew={() => setForm({ route: null })}
          />

          <div className="mt-16">
            {!route ? (
              <Section title={t('routePlan.editor.title')}>
                <EmptyState><IconRoute size={28} /><div className="mt-8">{t('routePlan.routes.select')}</div></EmptyState>
              </Section>
            ) : (
              <RouteEditor
                route={route}
                busy={busy}
                collector={collectors.find((c) => c.id === collectorForRoute(route.id, assignments)) || null}
                rows={route.stops.map((id) => byId.get(id) || { id, missing: true })}
                siblings={routes.filter((r) => r.id !== route.id && r.ward === route.ward)}
                onAdd={() => setPicking(true)}
                onEdit={() => setForm({ route })}
                onDelete={() => deleteRoute(route)}
                onSort={() => sortStops(route)}
                onMove={(id, delta) => move(route, id, delta)}
                onRemove={(id) => dropStop(route, id)}
                onMoveTo={(id, toId) => moveStop(route, id, toId)}
              />
            )}
          </div>
        </>
      ) : (
        <AssignmentBoard
          collectors={collectors}
          routes={routes}
          assignments={assignments}
          busy={busy}
          onAttach={setAttachTo}
          onDetach={detachRoute}
        />
      )}

      {form && (
        <RouteForm
          route={form.route}
          wards={wards}
          busy={busy}
          onSave={async (values) => { if (await saveRoute(values)) setForm(null) }}
          onClose={() => setForm(null)}
        />
      )}

      {picking && route && (
        <StopPicker
          route={route}
          unplanned={unplanned}
          busy={busy}
          onAdd={(ids) => addStops(route, ids)}
          onClose={() => setPicking(false)}
        />
      )}

      {attachTo && (
        <AttachRoute
          collector={collectors.find((c) => c.id === attachTo)}
          routes={routes}
          assignments={assignments}
          collectors={collectors}
          busy={busy}
          onPick={(routeId) => attachRoute(collectors.find((c) => c.id === attachTo), routeId)}
          onClose={() => setAttachTo(null)}
        />
      )}
    </div>
  )
}

// ---- coverage --------------------------------------------------------------
// The planner's to-do list: what is on no route, split by whether it *can* be
// planned. Two very different follow-ups, so they never share a single number.
function CoverageGap({ unplanned }) {
  const { t, n, digits, wardName } = useLang()

  if (unplanned.total === 0) {
    return (
      <div className="form-note ok" style={{ marginBottom: 20 }}>
        <IconCheck size={15} />
        <span className="grow">{t('routePlan.coverage.allPlanned')}</span>
      </div>
    )
  }

  const list = (homes, title, tone) => (
    <div style={{ flex: '1 1 260px', minWidth: 240 }}>
      <div className="tiny" style={{ fontWeight: 700, marginBottom: 6 }}>
        <span className={`badge badge-${tone}`}><span className="dot" />{title}</span>
      </div>
      {homes.slice(0, PREVIEW).map((h) => (
        <div key={h.id} className="tiny muted" style={{ padding: '3px 0' }}>
          {h.head} · {digits(h.holding)} · {h.road} · {wardName(h.ward)}
        </div>
      ))}
      {homes.length > PREVIEW && (
        <div className="tiny muted-3 mt-4">{t('routePlan.coverage.more', { count: n(homes.length - PREVIEW) })}</div>
      )}
    </div>
  )

  return (
    <div style={{ marginBottom: 20 }}>
      <Section title={t('routePlan.coverage.title')}>
        <div className="form-note info" style={{ marginBottom: 14 }}>
          <IconAlert size={15} />
          <span className="grow">{t('routePlan.coverage.summary', { count: n(unplanned.total) })}</span>
        </div>
        <div className="row gap-8 wrap" style={{ marginBottom: 14 }}>
          <span className="badge badge-ok"><span className="dot" />{t('routePlan.coverage.ready', { count: n(unplanned.routable.length) })}</span>
          <span className="badge badge-danger"><span className="dot" />{t('routePlan.coverage.needVerify', { count: n(unplanned.unverified.length) })}</span>
        </div>
        <div className="row gap-16 wrap" style={{ alignItems: 'flex-start' }}>
          {unplanned.routable.length > 0 && list(unplanned.routable, t('routePlan.coverage.readyTitle'), 'ok')}
          {unplanned.unverified.length > 0 && list(unplanned.unverified, t('routePlan.coverage.needVerifyTitle'), 'danger')}
        </div>
      </Section>
    </div>
  )
}

// ---- route list ------------------------------------------------------------
function RouteList({ routes, assignments, collectors, picked, onPick, onNew }) {
  const { t, n, digits, wardName } = useLang()

  return (
    <Section
      title={t('routePlan.routes.title')}
      actions={(
        <div className="row gap-12 wrap">
          <span className="tiny muted-3">{t('routePlan.routes.hint')}</span>
          <button className="btn btn-primary btn-sm" onClick={onNew}>
            <IconPlus size={14} /> {t('routePlan.routes.new')}
          </button>
        </div>
      )}
    >
      {routes.length === 0 ? (
        <EmptyState><IconRoute size={26} /><div className="mt-8">{t('routePlan.routes.none')}</div></EmptyState>
      ) : (
        <div className="row gap-8 wrap" style={{ alignItems: 'stretch' }}>
          {routes.map((r) => {
            const held = collectorForRoute(r.id, assignments)
            const who = collectors.find((c) => c.id === held)
            const on = r.id === picked
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => onPick(r.id)}
                aria-pressed={on}
                style={{
                  textAlign: 'start',
                  minWidth: 210,
                  padding: '10px 13px',
                  borderRadius: 10,
                  cursor: 'pointer',
                  background: on ? 'var(--brand-050, var(--surface-2))' : 'var(--surface)',
                  border: `1px solid ${on ? 'var(--brand)' : 'var(--border)'}`,
                }}
              >
                <div style={{ fontWeight: 600, fontSize: 13.5 }}>{r.name}</div>
                <div className="tiny muted-3 mt-4">{wardName(r.ward)} · {digits(r.window || '')}</div>
                <div className="row gap-8 wrap mt-8">
                  <span className="badge badge-info"><span className="dot" />{t('routePlan.routes.stops', { count: n(r.stops.length) })}</span>
                  {who
                    ? <span className="badge badge-ok"><span className="dot" />{who.name}</span>
                    : <span className="badge badge-warn"><span className="dot" />{t('routePlan.routes.unassigned')}</span>}
                </div>
              </button>
            )
          })}
        </div>
      )}
    </Section>
  )
}

// ---- route form ------------------------------------------------------------
// Create and edit share a dialog: the fields are the same three, and a rename
// is far more common than a fresh round.
function RouteForm({ route, wards, busy, onSave, onClose }) {
  const { t } = useLang()
  const [name, setName] = useState(route?.name || '')
  const [ward, setWard] = useState(route?.ward || wards[0]?.id || '')
  const [win, setWin] = useState(() => (route ? joinWindow(route) : DEFAULT_WINDOW))

  const trimmed = win.trim()
  const windowOk = WINDOW_RE.test(trimmed)
  const nameOk = name.trim().length > 0
  const wardLocked = Boolean(route && route.stops.length)

  return (
    <Modal
      title={route ? t('routePlan.form.editTitle') : t('routePlan.form.createTitle')}
      subtitle={t('routePlan.form.subtitle')}
      onClose={onClose}
      width={520}
    >
      <Field
        label={t('routePlan.form.name')}
        hint={nameOk ? t('routePlan.form.nameHint') : t('routePlan.form.nameRequired')}
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <div className="mt-16">
        <Field
          as="select"
          label={t('routePlan.form.ward')}
          hint={wardLocked ? t('routePlan.form.wardLocked') : undefined}
          value={ward}
          disabled={wardLocked}
          onChange={(e) => setWard(e.target.value)}
          options={wards.map((w) => ({ value: w.id, label: t(w.key) }))}
        />
      </div>
      <div className="mt-16">
        <Field
          label={t('routePlan.form.window')}
          hint={windowOk ? t('routePlan.form.windowHint') : t('routePlan.form.windowInvalid')}
          value={win}
          onChange={(e) => setWin(e.target.value)}
          placeholder={DEFAULT_WINDOW}
        />
      </div>

      <ModalActions>
        <button type="button" className="btn btn-ghost" onClick={onClose}>{t('common.cancel')}</button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!nameOk || !windowOk || busy}
          onClick={() => onSave({ id: route?.id, name: name.trim(), ward, win: trimmed })}
        >
          {busy ? <span className="spinner" /> : route ? t('common.save') : t('routePlan.form.create')}
        </button>
      </ModalActions>
    </Modal>
  )
}

// ---- route editor ----------------------------------------------------------
function RouteEditor({
  route, collector, rows, siblings, busy,
  onAdd, onEdit, onDelete, onSort, onMove, onRemove, onMoveTo,
}) {
  const { t, n, digits, wardName } = useLang()
  const shown = joinWindow(route)

  return (
    <Section
      title={`${t('routePlan.editor.title')} · ${route.name}`}
      actions={(
        <div className="row gap-8 wrap">
          <button className="btn btn-ghost btn-sm" onClick={onEdit}>
            <IconEdit size={14} /> {t('routePlan.editor.edit')}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={onSort} disabled={busy || rows.length < 2}>
            {t('routePlan.editor.sort')}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={onDelete} disabled={busy}>
            <IconTrash size={14} /> {t('routePlan.editor.delete')}
          </button>
          <button className="btn btn-primary btn-sm" onClick={onAdd}>
            <IconPlus size={14} /> {t('routePlan.editor.addStops')}
          </button>
        </div>
      )}
    >
      <div className="row gap-24 wrap" style={{ alignItems: 'flex-start', marginBottom: 16 }}>
        <div>
          <div className="tiny muted-3">{t('routePlan.editor.routeLabel')}</div>
          <div className="mono" style={{ fontWeight: 600 }}>{route.id}</div>
        </div>
        <div>
          <div className="tiny muted-3">{t('routePlan.editor.wardLabel')}</div>
          <div style={{ fontWeight: 600, fontSize: 13 }}>{wardName(route.ward)}</div>
        </div>
        <div>
          <div className="tiny muted-3">{t('routePlan.editor.windowLabel')}</div>
          <div style={{ fontWeight: 600, fontSize: 13 }}>{digits(shown)}</div>
        </div>
        <div>
          <div className="tiny muted-3">{t('routePlan.editor.collectorLabel')}</div>
          <div style={{ fontWeight: 600, fontSize: 13 }}>
            {collector ? collector.name : t('routePlan.routes.unassigned')}
          </div>
        </div>
        <div className="grow" />
        <span className="tiny muted-3">
          {t('routePlan.editor.summary', { count: n(rows.length), window: digits(shown) })}
        </span>
      </div>

      <div className="row between wrap gap-8" style={{ marginBottom: 8 }}>
        <h4 style={{ fontSize: 13.5 }}>{t('routePlan.editor.stops')}</h4>
        <span className="tiny muted-3">{t('routePlan.editor.orderHint')}</span>
      </div>

      {rows.length === 0 ? (
        <EmptyState><IconHome size={26} /><div className="mt-8">{t('routePlan.editor.noStops')}</div></EmptyState>
      ) : (
        <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {rows.map((s, i) => (
            <li
              key={s.id}
              className="row gap-12 wrap"
              style={{ padding: '10px 0', borderTop: i ? '1px solid var(--border)' : undefined }}
            >
              <span
                className="mono center"
                style={{
                  width: 26, height: 26, lineHeight: '26px', borderRadius: '50%',
                  background: 'var(--surface-2)', border: '1px solid var(--border)', flex: '0 0 auto',
                }}
              >{n(i + 1)}</span>
              <div className="grow" style={{ minWidth: 180 }}>
                <div style={{ fontWeight: 600 }}>{s.missing ? s.id : s.head}</div>
                <div className="tiny muted-3">
                  {s.missing
                    ? t('routePlan.editor.missing')
                    : `${t('routePlan.col.holding')} ${digits(s.holding)} · ${s.road} · ${wardName(s.ward)}`}
                </div>
              </div>
              <div className="row gap-8 wrap">
                <select
                  className="select"
                  style={{ width: 'auto', minWidth: 150 }}
                  value=""
                  disabled={busy || siblings.length === 0}
                  onChange={(e) => e.target.value && onMoveTo(s.id, e.target.value)}
                  aria-label={t('routePlan.editor.moveTo')}
                >
                  <option value="">
                    {siblings.length ? t('routePlan.editor.moveTo') : t('routePlan.editor.moveToNone')}
                  </option>
                  {siblings.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
                <button className="icon-btn" onClick={() => onMove(s.id, -1)} disabled={busy || i === 0}
                  title={t('routePlan.editor.moveUp')} aria-label={t('routePlan.editor.moveUp')}>↑</button>
                <button className="icon-btn" onClick={() => onMove(s.id, 1)} disabled={busy || i === rows.length - 1}
                  title={t('routePlan.editor.moveDown')} aria-label={t('routePlan.editor.moveDown')}>↓</button>
                <button className="btn btn-ghost btn-sm" onClick={() => onRemove(s.id)} disabled={busy}
                  title={t('routePlan.editor.removeStop')}>
                  <IconTrash size={14} /> {t('common.delete')}
                </button>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Section>
  )
}

// ---- stop picker -----------------------------------------------------------
// Everything offered here is unplanned and in the route's ward. Unverified
// holdings stay visible but unusable — hiding them would leave the planner
// wondering why a holding they know exists is missing from the list.
function StopPicker({ route, unplanned, busy, onAdd, onClose }) {
  const { t, n, digits, wardName } = useLang()
  const [q, setQ] = useState('')
  const [ticked, setTicked] = useState(() => new Set())

  const inWard = (list) => list.filter((h) => h.ward === route.ward)
  const routable = useMemo(() => inWard(unplanned.routable), [unplanned, route.ward])
  const blocked = useMemo(() => inWard(unplanned.unverified), [unplanned, route.ward])

  const rows = useMemo(() => {
    const all = [...routable, ...blocked]
    if (!q) return all
    const needle = q.toLowerCase()
    return all.filter((h) => [h.head, h.holding, h.road, h.id]
      .some((v) => String(v || '').toLowerCase().includes(needle)))
  }, [routable, blocked, q])

  // "Every unplanned holding on this road" — the way a planner actually thinks
  // about filling a round out.
  const roads = useMemo(() => {
    const map = new Map()
    routable.forEach((h) => map.set(h.road, [...(map.get(h.road) || []), h.id]))
    return [...map.entries()]
  }, [routable])

  const toggle = (id) => setTicked((prev) => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  const listedRoutable = rows.filter(isRoutable)
  const tickedHere = listedRoutable.filter((h) => ticked.has(h.id))

  // Only clear what was actually added. Clearing the whole set discarded ticks
  // for rows the current search had scrolled out of view.
  const commit = (ids) => {
    onAdd(ids)
    setTicked((prev) => new Set([...prev].filter((id) => !ids.includes(id))))
  }

  return (
    <Modal
      title={t('routePlan.picker.title', { route: route.name })}
      subtitle={t('routePlan.picker.subtitle', { ward: wardName(route.ward) })}
      onClose={onClose}
      width={660}
    >
      <div className="chip-input" style={{ marginBottom: 12 }}>
        <IconSearch size={16} />
        <input className="grow" placeholder={t('routePlan.picker.search')} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {routable.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div className="tiny muted-3" style={{ marginBottom: 6, fontWeight: 700 }}>{t('routePlan.picker.bulk')}</div>
          <div className="row gap-8 wrap">
            <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => commit(routable.map((h) => h.id))}>
              {t('routePlan.picker.bulkWard', { ward: wardName(route.ward), count: n(routable.length) })}
            </button>
            {roads.map(([road, ids]) => (
              <button key={road} className="btn btn-ghost btn-sm" disabled={busy} onClick={() => commit(ids)}>
                {t('routePlan.picker.bulkRoad', { road, count: n(ids.length) })}
              </button>
            ))}
          </div>
        </div>
      )}

      {rows.length === 0 ? (
        <EmptyState>
          <IconHome size={26} />
          <div className="mt-8">
            {routable.length + blocked.length === 0 ? t('routePlan.picker.empty') : t('routePlan.picker.noMatch')}
          </div>
        </EmptyState>
      ) : (
        <>
          <div className="row gap-8 wrap" style={{ marginBottom: 8 }}>
            <button className="btn btn-ghost btn-sm" disabled={listedRoutable.length === 0}
              onClick={() => setTicked(new Set(listedRoutable.map((h) => h.id)))}>
              {t('routePlan.picker.selectAll')}
            </button>
            <button className="btn btn-ghost btn-sm" disabled={ticked.size === 0} onClick={() => setTicked(new Set())}>
              {t('routePlan.picker.clear')}
            </button>
            <span className="tiny muted-3">{t('routePlan.picker.selected', { count: n(ticked.size) })}</span>
          </div>

          <div style={{ maxHeight: 340, overflowY: 'auto' }}>
            {rows.map((h, i) => {
              const ok = isRoutable(h)
              return (
                <div
                  key={h.id}
                  className="row gap-12 wrap"
                  style={{
                    padding: '10px 0',
                    borderTop: i ? '1px solid var(--border)' : undefined,
                    opacity: ok ? 1 : 0.55,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={ok && ticked.has(h.id)}
                    disabled={!ok}
                    onChange={() => toggle(h.id)}
                    aria-label={h.head}
                  />
                  <div className="grow" style={{ minWidth: 200 }}>
                    <div className="row gap-8 wrap">
                      <span style={{ fontWeight: 600 }}>{h.head}</span>
                      {!ok && <span className="badge badge-danger"><span className="dot" />{t('routePlan.picker.unverified')}</span>}
                    </div>
                    <div className="tiny muted-3 mt-4">
                      {t('routePlan.col.holding')} {digits(h.holding)} · {h.road} · {wardName(h.ward)}
                    </div>
                    {!ok && (
                      <div className="tiny" style={{ color: 'var(--danger-fg, var(--danger))', marginTop: 4 }}>
                        <IconAlert size={12} /> {t('routePlan.picker.blocked')}
                      </div>
                    )}
                  </div>
                  <button
                    className="btn btn-primary btn-sm"
                    disabled={!ok || busy}
                    aria-disabled={!ok}
                    onClick={() => ok && commit([h.id])}
                  >
                    <IconPlus size={14} /> {t('common.add')}
                  </button>
                </div>
              )
            })}
          </div>
        </>
      )}

      <ModalActions>
        <span className="tiny muted-3 grow">{t('common.shown', { count: n(rows.length) })}</span>
        <button
          type="button"
          className="btn btn-primary"
          disabled={tickedHere.length === 0 || busy}
          onClick={() => commit(tickedHere.map((h) => h.id))}
        >
          <IconPlus size={14} /> {t('routePlan.picker.addSelected', { count: n(tickedHere.length) })}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onClose}>{t('routePlan.picker.done')}</button>
      </ModalActions>
    </Modal>
  )
}

// ---- assignments -----------------------------------------------------------
// One card per collector: the rounds they hold and what those add up to. An
// off-route collector keeps their card so the planner can see why they are
// empty, but nothing can be handed to them.
function AssignmentBoard({ collectors, routes, assignments, busy, onAttach, onDetach }) {
  const { t, n, digits, wardName } = useLang()

  const orphans = routes.filter((r) => !collectorForRoute(r.id, assignments))

  return (
    <Section
      title={t('routePlan.assign.title')}
      actions={<span className="tiny muted-3">{t('routePlan.assign.hint')}</span>}
    >
      <div className={`form-note ${orphans.length ? 'info' : 'ok'}`} style={{ marginBottom: 16 }}>
        {orphans.length ? <IconAlert size={15} /> : <IconCheck size={15} />}
        <span className="grow">
          {orphans.length
            ? t('routePlan.assign.unassigned', { count: n(orphans.length) })
            : t('routePlan.assign.allAssigned')}
        </span>
      </div>

      {collectors.length === 0 ? (
        <EmptyState><IconUsers size={26} /><div className="mt-8">{t('routePlan.assign.none')}</div></EmptyState>
      ) : (
        <div className="row gap-16 wrap" style={{ alignItems: 'stretch' }}>
          {collectors.map((c) => {
            const held = routesForCollector(c.id, { routes, assignments })
            const stops = held.reduce((sum, r) => sum + r.stops.length, 0)
            const off = c.status === 'off_route'
            return (
              <div
                key={c.id}
                style={{
                  flex: '1 1 300px', minWidth: 280, padding: 14,
                  borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)',
                }}
              >
                <div className="row between wrap gap-8">
                  <div>
                    <div style={{ fontWeight: 600 }}>{c.name}</div>
                    <div className="tiny muted-3 mt-4">{wardName(c.zone)}</div>
                  </div>
                  <Status value={c.status} />
                </div>

                <div className="row gap-8 wrap mt-8">
                  <span className="badge badge-info"><span className="dot" />{t('routePlan.assign.routesHeld', { count: n(held.length) })}</span>
                  <span className="badge badge-muted"><span className="dot" />{t('routePlan.assign.totalStops', { count: n(stops) })}</span>
                </div>

                {off && (
                  <div className="form-note bad mt-8">
                    <IconAlert size={14} />
                    <span className="grow">{t('routePlan.assign.offRoute')}</span>
                  </div>
                )}

                <div className="mt-8">
                  {held.length === 0 ? (
                    <div className="tiny muted-3" style={{ padding: '8px 0' }}>{t('routePlan.assign.noRoutes')}</div>
                  ) : held.map((r, i) => (
                    <div
                      key={r.id}
                      className="row gap-8 wrap"
                      style={{ padding: '8px 0', borderTop: i ? '1px solid var(--border)' : undefined }}
                    >
                      <div className="grow" style={{ minWidth: 150 }}>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{r.name}</div>
                        <div className="tiny muted-3">
                          {wardName(r.ward)} · {digits(r.window || '')} · {t('routePlan.routes.stops', { count: n(r.stops.length) })}
                        </div>
                      </div>
                      <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => onDetach(c.id, r.id)}>
                        {t('routePlan.assign.detach')}
                      </button>
                    </div>
                  ))}
                </div>

                <button
                  className="btn btn-ghost btn-sm mt-8"
                  disabled={off || busy}
                  aria-disabled={off}
                  onClick={() => !off && onAttach(c.id)}
                >
                  <IconPlus size={14} /> {t('routePlan.assign.attach')}
                </button>
              </div>
            )
          })}
        </div>
      )}
    </Section>
  )
}

// ---- attach picker ---------------------------------------------------------
// Free routes come first; the ones already held are still listed, because
// re-balancing a ward usually means taking a round off somebody — but the move
// is explicit and confirmed, never a silent second holder.
function AttachRoute({ collector, routes, assignments, collectors, busy, onPick, onClose }) {
  const { t, n, digits, wardName } = useLang()
  const [q, setQ] = useState('')

  const mine = new Set((assignmentFor(collector?.id, assignments)?.routes) || [])

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return routes
      .filter(isActive)
      .filter((r) => !mine.has(r.id))
      .filter((r) => !needle || [r.name, r.id].some((v) => String(v || '').toLowerCase().includes(needle)))
      .map((r) => ({ route: r, holder: collectorForRoute(r.id, assignments) }))
  }, [routes, assignments, q, collector])

  const free = rows.filter((r) => !r.holder)
  const taken = rows.filter((r) => r.holder)

  const group = (title, list, tone) => (
    <div style={{ marginBottom: 14 }}>
      <div className="tiny" style={{ fontWeight: 700, marginBottom: 6 }}>
        <span className={`badge badge-${tone}`}><span className="dot" />{title}</span>
      </div>
      {list.map(({ route, holder }, i) => {
        const who = collectors.find((c) => c.id === holder)
        return (
          <div
            key={route.id}
            className="row gap-12 wrap"
            style={{ padding: '9px 0', borderTop: i ? '1px solid var(--border)' : undefined }}
          >
            <div className="grow" style={{ minWidth: 200 }}>
              <div className="row gap-8 wrap">
                <span style={{ fontWeight: 600 }}>{route.name}</span>
                {route.ward !== collector.zone && (
                  <span className="badge badge-warn"><span className="dot" />{t('routePlan.attach.otherWard')}</span>
                )}
              </div>
              <div className="tiny muted-3 mt-4">
                {wardName(route.ward)} · {digits(route.window || '')} · {t('routePlan.routes.stops', { count: n(route.stops.length) })}
              </div>
              {holder && (
                <div className="tiny muted-3 mt-4">{t('routePlan.attach.heldBy', { name: who?.name || holder })}</div>
              )}
            </div>
            <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => onPick(route.id)}>
              {holder ? t('routePlan.attach.move') : t('routePlan.attach.attach')}
            </button>
          </div>
        )
      })}
    </div>
  )

  if (!collector) return null

  return (
    <Modal
      title={t('routePlan.attach.title', { name: collector.name })}
      subtitle={t('routePlan.attach.subtitle')}
      onClose={onClose}
      width={620}
    >
      <div className="chip-input" style={{ marginBottom: 12 }}>
        <IconSearch size={16} />
        <input className="grow" placeholder={t('routePlan.attach.search')} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {rows.length === 0 ? (
        <EmptyState><IconRoute size={26} /><div className="mt-8">{t('routePlan.attach.none')}</div></EmptyState>
      ) : (
        <div style={{ maxHeight: 380, overflowY: 'auto' }}>
          {free.length > 0 && group(t('routePlan.attach.free'), free, 'ok')}
          {taken.length > 0 && group(t('routePlan.attach.taken'), taken, 'warn')}
        </div>
      )}

      <ModalActions>
        <span className="tiny muted-3 grow">{t('common.shown', { count: n(rows.length) })}</span>
        <button type="button" className="btn btn-ghost" onClick={onClose}>{t('common.close')}</button>
      </ModalActions>
    </Modal>
  )
}
