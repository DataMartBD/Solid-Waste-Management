import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { MapContainer, TileLayer, Polyline, Marker, Tooltip, Popup, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { PageHeader, StatCard, Status } from '../components/ui.jsx'
import { IconRoute, IconClock, IconCheck, IconAlert, IconQr, IconArrow, IconMap, IconTruck, IconExpand, IconMinimize } from '../components/Icons.jsx'
import { MapResizer } from '../components/mapUtils.jsx'
import { useData } from '../context/DataContext.jsx'
import { useTheme } from '../context/ThemeContext.jsx'
import { wards } from '../data/mockData.js'

const TILES = {
  light: { url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', attribution: '&copy; OpenStreetMap &copy; CARTO' },
  dark: { url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', attribution: '&copy; OpenStreetMap &copy; CARTO' },
}

const fmtTime = (iso) => new Date(iso).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' })

// Order stops so completed ones lead (in visit-time order), then pending by holding —
// this reads as forward progress along the route.
function orderStops(stops) {
  const rank = (s) => (s.visitStatus === 'pending' ? 1 : 0)
  return [...stops].sort((a, b) => {
    if (rank(a) !== rank(b)) return rank(a) - rank(b)
    if (a.at && b.at) return new Date(a.at) - new Date(b.at)
    return String(a.holding).localeCompare(String(b.holding), undefined, { numeric: true })
  })
}

export default function RoutesPage() {
  const { collectors, households, visits } = useData()
  const [open, setOpen] = useState(null)
  const [mapView, setMapView] = useState({}) // routeId -> boolean

  const active = collectors.filter((c) => c.status !== 'off_route')

  // Assign each household to ONE collector so routes don't overlap:
  // whoever scanned it owns it; otherwise round-robin among that ward's collectors.
  const byWard = {}
  active.forEach((c) => { (byWard[c.zone] = byWard[c.zone] || []).push(c) })
  const owner = {} // householdId -> collectorId
  const rr = {}
  households.forEach((h) => {
    const v = visits.find((x) => x.hh === h.id)
    if (v && active.some((c) => c.id === v.collector)) { owner[h.id] = v.collector; return }
    const pool = byWard[h.ward]
    if (!pool || !pool.length) return
    owner[h.id] = pool[(rr[h.ward] || 0) % pool.length].id
    rr[h.ward] = (rr[h.ward] || 0) + 1
  })

  const routes = active.map((c, i) => {
    const myHomes = households.filter((h) => owner[h.id] === c.id)
    const stops = orderStops(myHomes.map((h) => {
      const v = visits.find((x) => x.hh === h.id)
      return { ...h, visitStatus: v ? v.status : 'pending', at: v ? v.at : null, by: v ? v.collector : null }
    }))
    const visited = stops.filter((s) => s.visitStatus !== 'pending').length
    const nextIdx = stops.findIndex((s) => s.visitStatus === 'pending')
    return {
      id: `RT-${c.zone}-${String(i + 1).padStart(2, '0')}`,
      collector: c,
      ward: wards.find((w) => w.id === c.zone),
      stops, visited, total: stops.length, nextIdx,
      window: ['06:00–09:30', '06:30–10:00', '07:00–10:30'][i % 3],
      sensitive: i % 2 === 0 ? ['School', 'Hospital'] : ['Hospital'],
    }
  }).filter((r) => r.total > 0)

  const totalStops = routes.reduce((a, r) => a + r.total, 0)
  const doneStops = routes.reduce((a, r) => a + r.visited, 0)

  const isOpen = (i, id) => open === id || (open === null && i === 0)
  const toggle = (id) => setOpen((o) => (o === id ? '__none__' : id))
  const setView = (id, v) => setMapView((m) => ({ ...m, [id]: v }))

  return (
    <div className="fade-in">
      <PageHeader title="Routes" subtitle="Progressive collection — visited vs pending households, live from scan events" />

      <div className="stat-grid" style={{ marginBottom: 24 }}>
        <StatCard icon={<IconRoute size={18} />} label="Active routes" value={routes.length} sub="Across wards" />
        <StatCard icon={<IconCheck size={18} />} tone="ok" label="Stops visited" value={`${doneStops}/${totalStops}`} sub={`${totalStops ? Math.round((doneStops / totalStops) * 100) : 0}% of today's plan`} progress={totalStops ? (doneStops / totalStops) * 100 : 0} />
        <StatCard icon={<IconClock size={18} />} tone="info" label="Pending stops" value={totalStops - doneStops} sub="Not yet visited" />
        <StatCard icon={<IconAlert size={18} />} tone="warn" label="Sensitive zones avoided" value="7" sub="Schools & hospitals" />
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
                    <div className="row gap-8">
                      <span style={{ fontWeight: 700 }}>{r.id}</span>
                      <Status value={r.collector.status} />
                    </div>
                    <div className="tiny muted-3 mt-4">{r.ward?.name} · {r.collector.name} · {r.window}</div>
                  </div>
                </div>

                <div className="row gap-24 wrap" style={{ justifyContent: 'flex-end' }}>
                  <div style={{ textAlign: 'right' }}>
                    <div className="tiny muted-3">{next ? 'Next stop' : 'Route complete'}</div>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{next ? next.head : '✓ all visited'}</div>
                  </div>
                  <div style={{ minWidth: 150 }}>
                    <div className="row between tiny muted-3"><span>{r.visited}/{r.total} visited</span><span>{pct}%</span></div>
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
                      <button className={!showMap ? 'on' : ''} onClick={() => setView(r.id, false)}><IconRoute size={13} /> Timeline</button>
                      <button className={showMap ? 'on' : ''} onClick={() => setView(r.id, true)}><IconMap size={13} /> Live map</button>
                    </div>
                    <div className="row gap-16 tiny muted wrap">
                      <span className="row gap-8"><span className="lg-dot done" /> Collected</span>
                      <span className="row gap-8"><span className="lg-dot skip" /> Skipped</span>
                      <span className="row gap-8"><span className="lg-dot next" /> Next</span>
                      <span className="row gap-8"><span className="lg-dot pend" /> Pending</span>
                    </div>
                  </div>

                  {showMap ? <RouteMap route={r} /> : (
                    <ol className="route-steps">
                      {r.stops.map((s, idx) => {
                        const state = s.visitStatus === 'collected' ? 'done'
                          : s.visitStatus === 'skipped' ? 'skip'
                          : idx === r.nextIdx ? 'next' : 'pend'
                        return (
                          <li key={s.id} className={`route-step ${state}`}>
                            <span className="step-node">
                              {state === 'done' ? <IconCheck size={13} /> : state === 'skip' ? '!' : idx + 1}
                            </span>
                            <div className="step-body">
                              <div className="row between wrap gap-8">
                                <div>
                                  <span style={{ fontWeight: 600 }}>{s.head}</span>
                                  <span className="tiny muted-3 mono"> · {s.id}</span>
                                </div>
                                {state === 'done' && <span className="badge badge-ok"><IconQr size={11} /> {fmtTime(s.at)}</span>}
                                {state === 'skip' && <span className="badge badge-warn">skipped {s.at ? fmtTime(s.at) : ''}</span>}
                                {state === 'next' && <span className="badge badge-info"><span className="dot" />next stop</span>}
                                {state === 'pend' && <span className="badge badge-muted">pending</span>}
                              </div>
                              <div className="tiny muted-3 mt-4">Holding {s.holding} · {s.road}{s.dues > 0 ? ` · ৳${s.dues} due` : ''}</div>
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

function stopIcon(state, idx) {
  const inner = state === 'done' ? CHECK_SVG : state === 'skip' ? '!' : idx + 1
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
  const [fs, setFs] = useState(false)
  const tiles = TILES[theme === 'dark' ? 'dark' : 'light']
  const stops = route.stops
  const coords = stops.map((s) => [s.lat, s.lng])
  const doneCount = route.visited
  const solid = coords.slice(0, Math.max(1, doneCount))            // collected
  const dashed = coords.slice(Math.max(0, doneCount - 1))          // last collected → pending
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
        {stops.map((s, idx) => {
          const st = stateOf(idx, s)
          return (
            <Marker key={s.id} position={[s.lat, s.lng]} icon={stopIcon(st, idx)}>
              <Tooltip permanent direction="bottom" offset={[0, 15]} className="rt-tip">
                <b>{s.head}</b><br />{st === 'done' ? `✓ ${fmtTime(s.at)}` : st === 'skip' ? 'skipped' : st === 'next' ? 'next stop' : 'pending'}
              </Tooltip>
              <Popup>{s.head} · {s.id}<br />Holding {s.holding} · {s.road}{s.dues > 0 ? ` · ৳${s.dues} due` : ''}</Popup>
            </Marker>
          )
        })}
        {solid.length > 1 && <MovingCollector coords={solid} />}
      </MapContainer>
      <button className="map-fs-btn" onClick={() => setFs((v) => !v)}>
        {fs ? <><IconMinimize size={15} /> Exit fullscreen</> : <><IconExpand size={15} /> Fullscreen</>}
      </button>
    </>
  )

  const caption = (
    <div className="route-map-cap tiny muted">
      <IconTruck size={14} /> {route.collector.name}&apos;s collection path · solid = collected, dashed = still to collect
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
