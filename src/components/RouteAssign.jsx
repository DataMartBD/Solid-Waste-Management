// Putting holdings on a route, from the holding side (Holding Editor, and the
// Holdings list's "Add selected to route"). The same three rules as Route Plan,
// which the server enforces too:
//   1. a holding sits on exactly one route — adding it to another moves it,
//   2. only a verified holding (confirmed location) can be planned, and
//   3. a holding only goes on a route of its own ward.
// So the picker offers only routes of the selected holdings' wards, and on a
// pick adds just the holdings that fit that route, saying what it skipped.

import { useMemo, useState } from 'react'
import { Modal, ModalActions } from './Modal.jsx'
import { EmptyState } from './ui.jsx'
import { IconRoute, IconSearch, IconCheck, IconAlert } from './Icons.jsx'
import { useData } from '../context/DataContext.jsx'
import { useLang } from '../i18n/index.jsx'
import { collectorForRoute, isRoutable } from '../utils/collection.js'

export function AddToRouteModal({ holdings, onClose, onDone }) {
  const { t, n, digits, wardName } = useLang()
  const { routes = [], assignments = [], collectors = [], act, api } = useData()
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)

  const wards = useMemo(() => new Set(holdings.map((h) => h.ward)), [holdings])
  const unverified = holdings.filter((h) => !isRoutable(h)).length
  const options = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return routes
      .filter((r) => r.active !== false && wards.has(r.ward))
      .filter((r) => !needle || [r.name, r.id].some((v) => String(v || '').toLowerCase().includes(needle)))
      .sort((a, b) => String(a.ward).localeCompare(String(b.ward)) || a.name.localeCompare(b.name))
  }, [routes, wards, q])

  async function pick(route) {
    const fits = holdings.filter((h) => isRoutable(h) && h.ward === route.ward && h.routeId !== route.id)
    const already = holdings.filter((h) => h.routeId === route.id).length
    const otherWard = holdings.filter((h) => isRoutable(h) && h.ward !== route.ward).length
    setBusy(true)
    const failed = []
    for (let i = 0; i < fits.length; i += 1) {
      const last = i === fits.length - 1
      // One holding at a time: add-stop moves a holding off its old route
      // server-side, so it is never on two routes or none.
      const res = await act(api.routes.addStop(route.id, fits[i].id), { refresh: last ? ['routes'] : [] })
      if (!res?.ok) failed.push({ holding: fits[i], error: res?.error?.detail || res?.error?.message || '' })
    }
    setBusy(false)
    setResult({ route, added: fits.length - failed.length, failed, already, otherWard, unverified })
  }

  if (result) {
    const r = result
    return (
      <Modal title={t('routeAssign.doneTitle', { route: r.route.name })} onClose={() => onDone(r)} width={520}>
        <div className={`form-note ${r.failed.length ? 'bad' : 'ok'}`}>
          {r.failed.length ? <IconAlert size={15} /> : <IconCheck size={15} />}
          <span className="grow">{t('routeAssign.added', { count: n(r.added), route: r.route.name })}</span>
        </div>
        <ul className="small mt-8" style={{ paddingLeft: 18 }}>
          {r.already > 0 && <li>{t('routeAssign.skipAlready', { count: n(r.already) })}</li>}
          {r.otherWard > 0 && <li>{t('routeAssign.skipWard', { count: n(r.otherWard) })}</li>}
          {r.unverified > 0 && <li>{t('routeAssign.skipUnverified', { count: n(r.unverified) })}</li>}
          {r.failed.map((f) => <li key={f.holding.id} style={{ color: 'var(--danger)' }}>{digits(f.holding.holdingNo)}: {f.error}</li>)}
        </ul>
        <ModalActions>
          <button type="button" className="btn btn-primary" onClick={() => onDone(r)}>{t('common.close')}</button>
        </ModalActions>
      </Modal>
    )
  }

  return (
    <Modal
      title={holdings.length === 1
        ? t('routeAssign.titleOne', { holding: digits(holdings[0].holdingNo) })
        : t('routeAssign.titleMany', { count: n(holdings.length) })}
      subtitle={t('routeAssign.subtitle')}
      onClose={onClose}
      width={620}
    >
      {unverified > 0 && (
        <div className="form-note bad" style={{ marginBottom: 12 }}>
          <IconAlert size={15} />
          <span className="grow">{t('routeAssign.unverified', { count: n(unverified) })}</span>
        </div>
      )}
      {wards.size > 1 && (
        <div className="form-note info" style={{ marginBottom: 12 }}>
          <IconAlert size={15} />
          <span className="grow">{t('routeAssign.manyWards', { count: n(wards.size) })}</span>
        </div>
      )}
      <div className="chip-input" style={{ marginBottom: 12 }}>
        <IconSearch size={16} />
        <input className="grow" placeholder={t('routeAssign.search')} value={q} onChange={(e) => setQ(e.target.value)}
          aria-label={t('routeAssign.search')} />
      </div>
      {options.length === 0 ? (
        <EmptyState><IconRoute size={26} /><div className="mt-8">{t('routeAssign.none')}</div></EmptyState>
      ) : (
        <div style={{ maxHeight: 380, overflowY: 'auto' }}>
          {options.map((route, i) => {
            const who = collectors.find((c) => c.id === collectorForRoute(route.id, assignments))
            const current = holdings.length === 1 && holdings[0].routeId === route.id
            return (
              <div key={route.id} className="row gap-12 wrap" style={{ padding: '9px 0', borderTop: i ? '1px solid var(--border)' : undefined }}>
                <div className="grow" style={{ minWidth: 200 }}>
                  <div className="row gap-8 wrap">
                    <span style={{ fontWeight: 600 }}>{route.name}</span>
                    {current && <span className="badge badge-ok"><span className="dot" />{t('routeAssign.current')}</span>}
                  </div>
                  <div className="tiny muted-3 mt-4">
                    {wardName(route.ward)} · {digits(route.window || '')} · {t('routePlan.routes.stops', { count: n(route.stops.length) })}
                    {' · '}{who ? who.name : t('routePlan.routes.unassigned')}
                  </div>
                </div>
                <button className="btn btn-primary btn-sm" disabled={busy || current} onClick={() => pick(route)}>
                  {busy ? <span className="spinner" /> : t('routeAssign.add')}
                </button>
              </div>
            )
          })}
        </div>
      )}
      <ModalActions>
        <span className="tiny muted-3 grow">{t('common.shown', { count: n(options.length) })}</span>
        <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>{t('common.cancel')}</button>
      </ModalActions>
    </Modal>
  )
}
