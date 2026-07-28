import { useState, useEffect, useMemo, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { MapContainer, TileLayer, Polyline, Marker, Tooltip, Popup, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { PageHeader, StatCard, Status } from '../components/ui.jsx'
import { IconRoute, IconClock, IconCheck, IconAlert, IconQr, IconArrow, IconMap, IconTruck, IconExpand, IconMinimize } from '../components/Icons.jsx'
import { MapResizer } from '../components/mapUtils.jsx'
import { useData } from '../context/DataContext.jsx'
import { useTheme } from '../context/ThemeContext.jsx'
import { useLang } from '../i18n/index.jsx'
import { assignmentFor, collectorForRoute, dayOf, today, VISIT_STATUS } from '../utils/collection.js'

const TILES = {
  light: { url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', attribution: '&copy; OpenStreetMap &copy; CARTO' },
  dark: { url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', attribution: '&copy; OpenStreetMap &copy; CARTO' },
}

export default function RoutesPage() {
  const { collectors, households, visits, routes: routePlan, assignments, api, act, ready } = useData()
  const { t, n, digits, taka, time, percent, wardName } = useLang()
  const [open, setOpen] = useState(null)
  const [mapView, setMapView] = useState({}) // routeId -> boolean
  const [rounds, setRounds] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const day = today()

  // Only collectors who actually hold a plan have a round to read; asking for the
  // rest would be one wasted request each.
  const holders = useMemo(
    () => collectors.filter((c) => assignmentFor(c.id, assignments)),
    [collectors, assignments],
  )

  // Read every collector's round from `/api/collection/round/` — the same call
  // their own Collection screen makes — then split it back out per route. A
  // collector may hold several routes, so this is the only way the supervisor's
  // card and the collector's list are guaranteed to show the same stops in the
  // same order.
  const loadRounds = useCallback(async () => {
    if (!holders.length) { setRounds([]); return }
    setLoading(true)
    const results = await Promise.all(holders.map((c) => act(api.collection.round({ collector: c.id, day }))))
    setLoading(false)
    const refused = results.find((r) => !r.ok)
    setError(refused ? refused.error : null)
    setRounds(results.filter((r) => r.ok).map((r) => r.data))
  }, [holders, act, api, day])

  useEffect(() => { if (ready) loadRounds() }, [ready, loadRounds])

  const byId = useMemo(() => new Map(households.map((h) => [h.id, h])), [households])
  const visitToday = useMemo(() => {
    const map = new Map()
    visits.forEach((v) => { if (dayOf(v.at) === day) map.set(v.hh, v) })
    return map
  }, [visits, day])

  const stopsByRoute = useMemo(() => {
    const map = new Map()
    rounds.forEach((round) => round.stops.forEach((s) => {
      map.set(s.routeId, [...(map.get(s.routeId) || []), s])
    }))
    // A round is read through an assignment, so a route nobody holds has none —
    // yet its planned walk is exactly the gap a supervisor is looking for. Those
    // stops are assembled from the plan and the day's visit log instead, in the
    // same shape and the same order the server would have returned.
    routePlan.forEach((r) => {
      if (map.has(r.id)) return
      map.set(r.id, (r.stops || []).map((hh) => {
        const h = byId.get(hh)
        if (!h) return null
        const visit = visitToday.get(hh)
        return {
          hh, routeId: r.id, routeName: r.name,
          head: h.head, holding: h.holding, road: h.road, ward: h.ward,
          lat: h.lat, lng: h.lng, qr: h.qr, dues: h.dues,
          visitStatus: visit ? visit.status : VISIT_STATUS.pending,
          at: visit ? visit.at : null,
          accuracy: visit ? visit.accuracy : null,
          visitId: visit ? visit.id : null,
          synced: visit ? visit.synced : null,
          by: visit ? visit.collector : null,
        }
      }).filter(Boolean))
    })
    return map
  }, [rounds, routePlan, byId, visitToday])

  // One card per route, not per collector: the route is the thing that gets
  // walked, and one collector may walk several of them.
  const routes = routePlan.filter((r) => r.active !== false).map((r) => {
    const stops = stopsByRoute.get(r.id) || []
    const held = collectorForRoute(r.id, assignments)
    return {
      id: r.id,
      name: r.name,
      ward: r.ward,
      window: r.window,
      collector: collectors.find((c) => c.id === held) || null,
      stops,
      visited: stops.filter((s) => s.visitStatus !== 'pending').length,
      total: stops.length,
      nextIdx: stops.findIndex((s) => s.visitStatus === 'pending'),
    }
  }).filter((r) => r.total > 0)

  const totalStops = routes.reduce((a, r) => a + r.total, 0)
  const doneStops = routes.reduce((a, r) => a + r.visited, 0)

  const isOpen = (i, id) => open === id || (open === null && i === 0)
  const toggle = (id) => setOpen((o) => (o === id ? '__none__' : id))
  const setView = (id, v) => setMapView((m) => ({ ...m, [id]: v }))

  return (
    <div className="fade-in">
      <PageHeader
        title={t('routes.title')}
        subtitle={t('routes.subtitle')}
        actions={loading ? <span className="spinner spinner-dark" /> : null}
      />

      {error && (
        <div className="form-note bad" style={{ marginBottom: 16 }}>
          <IconAlert size={15} />
          <span className="grow">{error.detail}</span>
          <button className="icon-btn" onClick={() => setError(null)} aria-label={t('common.close')}>✕</button>
        </div>
      )}

      <div className="stat-grid" style={{ marginBottom: 24 }}>
        <StatCard icon={<IconRoute size={18} />} label={t('routes.stat.activeRoutes')} value={n(routes.length)} sub={t('routes.stat.acrossWards')} />
        <StatCard icon={<IconCheck size={18} />} tone="ok" label={t('routes.stat.stopsVisited')} value={`${n(doneStops)}/${n(totalStops)}`} sub={t('routes.stat.ofTodaysPlan', { pct: percent(totalStops ? Math.round((doneStops / totalStops) * 100) : 0) })} progress={totalStops ? (doneStops / totalStops) * 100 : 0} />
        <StatCard icon={<IconClock size={18} />} tone="info" label={t('routes.stat.pendingStops')} value={n(totalStops - doneStops)} sub={t('routes.stat.notYetVisited')} />
        <StatCard icon={<IconAlert size={18} />} tone="warn" label={t('routes.stat.sensitiveAvoided')} value={n(7)} sub={t('routes.stat.schoolsHospitals')} />
      </div>

      <div className="grid" style={{ gap: 16 }}>
        {routes.map((r, i) => {
          const pct = r.total ? Math.round((r.visited / r.total) * 100) : 0
          const opened = isOpen(i, r.id)
          const next = r.nextIdx >= 0 ? r.stops[r.nextIdx] : null
          const showMap = !!mapView[r.id]
          return (
            <div key={r.id} className="card fade-in">
              <button className="route-head" onClick={() => toggle(r.id)}>
                <div className="row gap-12">
                  <div className="route-ico"><IconRoute size={22} /></div>
                  <div style={{ textAlign: 'left' }}>
                    <div className="row gap-8 wrap">
                      <span style={{ fontWeight: 700 }}>{r.name}</span>
                      <span className="tiny muted-3 mono">{r.id}</span>
                      {r.collector
                        ? <Status value={r.collector.status} />
                        : <span className="badge badge-muted"><span className="dot" />{t('routes.unassigned')}</span>}
                    </div>
                    <div className="tiny muted-3 mt-4">
                      {wardName(r.ward)} · {r.collector ? r.collector.name : t('routes.noCollector')} · {digits(r.window)}
                    </div>
                  </div>
                </div>

                <div className="row gap-24 wrap" style={{ justifyContent: 'flex-end' }}>
                  <div style={{ textAlign: 'right' }}>
                    <div className="tiny muted-3">{next ? t('routes.nextStop') : t('routes.routeComplete')}</div>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{next ? next.head : t('routes.allVisited')}</div>
                  </div>
                  <div style={{ minWidth: 150 }}>
                    <div className="row between tiny muted-3"><span>{t('routes.visitedCount', { done: n(r.visited), total: n(r.total) })}</span><span>{percent(pct)}</span></div>
                    <div className="mini-bar" style={{ width: '100%', marginTop: 6 }}>
                      <i style={{ width: `${pct}%`, background: pct === 100 ? 'var(--ok)' : 'var(--brand)' }} />
                    </div>
                  </div>
                  <span className={`route-caret ${opened ? 'open' : ''}`}><IconArrow size={16} /></span>
                </div>
              </button>

              {opened && (
                <div className="route-steps-wrap">
                  <div className="row between wrap gap-8" style={{ marginBottom: 14 }}>
                    <div className="seg">
                      <button className={!showMap ? 'on' : ''} onClick={() => setView(r.id, false)}><IconRoute size={13} /> {t('routes.view.timeline')}</button>
                      <button className={showMap ? 'on' : ''} onClick={() => setView(r.id, true)}><IconMap size={13} /> {t('routes.view.liveMap')}</button>
                    </div>
                    <div className="row gap-16 tiny muted wrap">
                      <span className="row gap-8"><span className="lg-dot done" /> {t('routes.legend.collected')}</span>
                      <span className="row gap-8"><span className="lg-dot skip" /> {t('routes.legend.skipped')}</span>
                      <span className="row gap-8"><span className="lg-dot next" /> {t('routes.legend.next')}</span>
                      <span className="row gap-8"><span className="lg-dot pend" /> {t('routes.legend.pending')}</span>
                    </div>
                  </div>

                  {showMap ? <RouteMap route={r} /> : (
                    <ol className="route-steps">
                      {r.stops.map((s, idx) => {
                        const state = s.visitStatus === 'collected' ? 'done'
                          : s.visitStatus === 'skipped' ? 'skip'
                          : idx === r.nextIdx ? 'next' : 'pend'
                        return (
                          <li key={s.hh} className={`route-step ${state}`}>
                            <span className="step-node">
                              {state === 'done' ? <IconCheck size={13} /> : state === 'skip' ? '!' : n(idx + 1)}
                            </span>
                            <div className="step-body">
                              <div className="row between wrap gap-8">
                                <div>
                                  <span style={{ fontWeight: 600 }}>{s.head}</span>
                                  <span className="tiny muted-3 mono"> · {s.hh}</span>
                                </div>
                                {state === 'done' && <span className="badge badge-ok"><IconQr size={11} /> {time(s.at)}</span>}
                                {state === 'skip' && <span className="badge badge-warn">{s.at ? t('routes.badge.skippedAt', { time: time(s.at) }) : t('routes.badge.skipped')}</span>}
                                {state === 'next' && <span className="badge badge-info"><span className="dot" />{t('routes.badge.nextStop')}</span>}
                                {state === 'pend' && <span className="badge badge-muted">{t('routes.badge.pending')}</span>}
                              </div>
                              <div className="tiny muted-3 mt-4">{t('routes.holding', { holding: digits(s.holding) })} · {s.road}{s.dues > 0 ? ` · ${t('routes.due', { amount: taka(s.dues) })}` : ''}</div>
                            </div>
                          </li>
                        )
                      })}
                    </ol>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ---- Route map on real streets: draws the collection path & moves the collector along it ----
const STOP_COLOR = { done: '#0f7b4e', skip: '#d97706', next: '#2563eb', pend: '#7c8a82' }
const CHECK_SVG = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>'

// `label` is the already-localised stop number, so Bangla markers read ১, ২, ৩…
function stopIcon(state, label) {
  const inner = state === 'done' ? CHECK_SVG : state === 'skip' ? '!' : label
  return L.divIcon({ className: 'rt-stop', html: `<div class="rt-node ${state}">${inner}</div>`, iconSize: [30, 30], iconAnchor: [15, 15] })
}
const truckIcon = L.divIcon({
  className: 'rt-truck',
  html: '<div class="rt-truck-inner"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h11v9H3z"/><path d="M14 9h4l3 3v3h-7z"/><circle cx="7" cy="18" r="1.8"/><circle cx="17" cy="18" r="1.8"/></svg></div>',
  iconSize: [34, 34], iconAnchor: [17, 17],
})

// Fit the map to the route stops (and fix sizing when it mounts inside the card).
function MapSetup({ coords }) {
  const map = useMap()
  useEffect(() => {
    const t = setTimeout(() => {
      map.invalidateSize()
      if (coords.length === 1) map.setView(coords[0], 15)
      else if (coords.length > 1) map.fitBounds(L.latLngBounds(coords), { padding: [55, 55], maxZoom: 16 })
    }, 60)
    return () => clearTimeout(t)
  }, [map, coords])
  return null
}

const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
function alongPath(coords, f) {
  if (coords.length < 2) return coords[0]
  const x = Math.min(0.99999, Math.max(0, f)) * (coords.length - 1)
  const i = Math.floor(x)
  return lerp(coords[i], coords[i + 1], x - i)
}

// A collector marker that animates back and forth along the collected path.
function MovingCollector({ coords }) {
  const [pos, setPos] = useState(coords[0])
  useEffect(() => {
    if (!coords || coords.length < 2) { setPos(coords?.[0]); return }
    let raf, start = null
    const dur = Math.max(3500, coords.length * 1500)
    const step = (t) => {
      if (start === null) start = t
      setPos(alongPath(coords, ((t - start) / dur) % 1))
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [coords])
  if (!pos) return null
  return <Marker position={pos} icon={truckIcon} interactive={false} zIndexOffset={1000} />
}

function RouteMap({ route }) {
  const { theme } = useTheme()
  const { t, n, digits, taka, time } = useLang()
  const [fs, setFs] = useState(false)
  const tiles = TILES[theme === 'dark' ? 'dark' : 'light']
  const stops = route.stops
  // a stop can only be mapped once its location is verified
  const plotted = stops.filter((s) => typeof s.lat === 'number' && typeof s.lng === 'number')
  const coords = plotted.map((s) => [s.lat, s.lng])
  // Split by each stop's own state, never by a count. `route.visited` is a
  // tally, and completed stops are rarely a prefix of the walking order, so
  // slicing by it drew a solid "already collected" line straight through pins
  // badged Pending — and `coords` (verified stops only) does not even share an
  // index base with `stops`.
  const solid = plotted.filter((s) => s.visitStatus !== 'pending').map((s) => [s.lat, s.lng])
  const dashed = plotted.filter((s) => s.visitStatus === 'pending').map((s) => [s.lat, s.lng])
  const stateOf = (idx, s) => s.visitStatus === 'collected' ? 'done'
    : s.visitStatus === 'skipped' ? 'skip'
    : idx === route.nextIdx ? 'next' : 'pend'

  useEffect(() => {
    if (!fs) return
    const onKey = (e) => e.key === 'Escape' && setFs(false)
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = '' }
  }, [fs])

  const mapInner = (
    <>
      <MapContainer key={fs ? 'fs' : 'inline'} center={coords[0] || [22.836, 89.53]} zoom={14} scrollWheelZoom style={{ height: '100%', width: '100%' }}>
        <TileLayer key={theme} url={tiles.url} attribution={tiles.attribution} />
        <MapSetup coords={coords} />
        <MapResizer watch={fs} />
        {dashed.length > 1 && <Polyline positions={dashed} pathOptions={{ color: '#94a39b', weight: 4, dashArray: '2 11', lineCap: 'round' }} />}
        {solid.length > 1 && <Polyline positions={solid} pathOptions={{ color: '#0f7b4e', weight: 5, lineCap: 'round', lineJoin: 'round' }} />}
        {plotted.map((s) => {
          const idx = stops.indexOf(s) // keep the stop number from the planned order
          const st = stateOf(idx, s)
          return (
            <Marker key={s.hh} position={[s.lat, s.lng]} icon={stopIcon(st, n(idx + 1))}>
              <Tooltip permanent direction="bottom" offset={[0, 15]} className="rt-tip">
                <b>{s.head}</b><br />{st === 'done' ? `✓ ${time(s.at)}` : st === 'skip' ? t('routes.badge.skipped') : st === 'next' ? t('routes.badge.nextStop') : t('routes.badge.pending')}
              </Tooltip>
              <Popup>{s.head} · {s.hh}<br />{t('routes.holding', { holding: digits(s.holding) })} · {s.road}{s.dues > 0 ? ` · ${t('routes.due', { amount: taka(s.dues) })}` : ''}</Popup>
            </Marker>
          )
        })}
        {solid.length > 1 && <MovingCollector coords={solid} />}
      </MapContainer>
      <button className="map-fs-btn" onClick={() => setFs((v) => !v)}>
        {fs ? <><IconMinimize size={15} /> {t('routes.exitFullscreen')}</> : <><IconExpand size={15} /> {t('routes.fullscreen')}</>}
      </button>
    </>
  )

  const caption = (
    <div className="route-map-cap tiny muted">
      <IconTruck size={14} /> {route.collector
        ? t('routes.mapCaption', { name: route.collector.name })
        : t('routes.mapCaptionUnassigned', { route: route.name })}
    </div>
  )

  if (fs) {
    return createPortal(
      <div className="map-portal">
        <div className="leaflet-shell" style={{ border: 'none', borderRadius: 0, flex: 1, minHeight: 0 }}>{mapInner}</div>
        {caption}
      </div>,
      document.body,
    )
  }

  return (
    <div className="route-map">
      <div className="leaflet-shell" style={{ border: 'none', borderRadius: 0, height: 440 }}>{mapInner}</div>
      {caption}
    </div>
  )
}
