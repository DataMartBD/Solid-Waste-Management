// Live Map — where the vans actually are.
//
// Two data paths, in this order of preference:
//
//   1. GET /api/live/ for the initial state (van positions, route progress, the
//      household pins and the map centre, all ward-scoped by the server).
//   2. A websocket at /ws/live/ that streams `vehicle.position`, `visit.recorded`,
//      `collector.status` and `complaint.opened` frames, merged into that state in
//      place so a moving van does not cost a full refetch.
//
// The socket is the normal path, not a requirement: a proxy that strips the
// Upgrade header, or a backend running without channels, falls back to polling
// the snapshot. The map must work either way, and the header says which mode it
// is in so a pin that has not moved is never a mystery.
//
// Positions are never invented. A van with no GPS fix is listed without a pin,
// and a fix older than ten minutes is drawn dimmed and labelled "last seen"
// rather than presented as where the van is now.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { MapContainer, TileLayer, CircleMarker, Marker, Popup, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { PageHeader, Section, Status } from '../components/ui.jsx'
import { MapResizer } from '../components/mapUtils.jsx'
import { IconExpand, IconMinimize, IconRefresh } from '../components/Icons.jsx'
import { socketUrl } from '../api/client.js'
import { useData } from '../context/DataContext.jsx'
import { useTheme } from '../context/ThemeContext.jsx'
import { useLang } from '../i18n/index.jsx'

const TILES = {
  light: {
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    attribution: '&copy; OpenStreetMap &copy; CARTO',
  },
  dark: {
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attribution: '&copy; OpenStreetMap &copy; CARTO',
  },
}

const STATUS_COLOR = { on_route: '#0f7b4e', off_route: '#dc2626', idle: '#8a968f' }

// Only a viewport fallback, for the moment before the snapshot lands.
const CITY_CENTRE = { lat: 22.836, lng: 89.53 } // Khulna

// The server marks a fix stale after ten minutes; the same threshold is applied
// here so a pin keeps ageing between snapshots instead of staying "live" forever.
const STALE_MS = 10 * 60 * 1000
const AGE_TICK_MS = 30_000
const POLL_SECONDS = 20
const RECONNECT_BASE_MS = 1_000
const RECONNECT_MAX_MS = 30_000

const initialsOf = (name) => String(name || '?').split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()

// Counts are recomputed from the van list whenever a frame changes it, so the
// header cannot drift from the pins on the map.
const countsFor = (vans, households) => ({
  vans: vans.length,
  tracked: vans.filter((v) => v.lat != null).length,
  live: vans.filter((v) => v.lat != null && !v.stale).length,
  households,
})

// A teardrop pin with the driver's initials. A stale fix is dimmed rather than
// hidden — the last known position is still useful, it just is not current.
function vanIcon(color, initials, stale) {
  return L.divIcon({
    className: 'lf-pin-wrap',
    html: `<div class="lf-pin" style="background:${color}${stale ? ';opacity:.45' : ''}"><span>${initials}</span></div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 30],
    popupAnchor: [0, -28],
  })
}

// Pans/zooms the map when a van is selected from the list.
function FlyTo({ target }) {
  const map = useMap()
  // In an effect, keyed on the target: running this in the render body fired on
  // every unrelated re-render (theme, fullscreen, any store change) and yanked
  // the supervisor's map back from wherever they had panned it.
  useEffect(() => {
    if (target) map.flyTo([target.lat, target.lng], 15, { duration: 0.7 })
  }, [map, target?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  return null
}

export default function LiveMap() {
  const { api, householdById } = useData()
  const { theme } = useTheme()
  const { t, n, taka, percent, time } = useLang()
  const [active, setActive] = useState(null)
  const [fs, setFs] = useState(false)

  const [snapshot, setSnapshot] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [attempt, setAttempt] = useState(0)
  // 'connecting' until the socket says hello, then 'live' or 'polling'.
  const [link, setLink] = useState('connecting')
  const [alerts, setAlerts] = useState(0)
  // A clock, so a fix that goes quiet turns stale on screen without a refetch.
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), AGE_TICK_MS)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    if (!fs) return
    const onKey = (e) => e.key === 'Escape' && setFs(false)
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = '' }
  }, [fs])

  // --- snapshot -----------------------------------------------------------

  // Guards against a late response landing after unmount. It must be re-armed on
  // mount, not just cleared on unmount: React re-runs mount/unmount in StrictMode
  // (and on any remount), and a ref left false would make every later response
  // bail out, leaving the map on its loading state forever.
  const aliveRef = useRef(true)
  useEffect(() => {
    aliveRef.current = true
    return () => { aliveRef.current = false }
  }, [])

  const load = useCallback(async () => {
    try {
      const data = await api.live.snapshot()
      if (!aliveRef.current) return
      setSnapshot(data)
      setError(null)
    } catch (err) {
      if (aliveRef.current) setError(err)
    } finally {
      if (aliveRef.current) setLoading(false)
    }
  }, [api])

  useEffect(() => {
    setLoading(true)
    load()
  }, [load, attempt])

  // --- realtime -----------------------------------------------------------

  const apply = useCallback((frame) => {
    const { event, payload, at } = frame || {}
    if (!payload) return

    if (event === 'vehicle.position') {
      setSnapshot((prev) => {
        if (!prev) return prev
        const index = prev.vans.findIndex((v) => v.id === payload.van)
        // A frame for a van outside this user's ward scope is not ours to draw.
        if (index < 0) return prev
        const vans = prev.vans.slice()
        vans[index] = {
          ...vans[index],
          lat: payload.lat, lng: payload.lng, speed: payload.speed,
          heading: payload.heading, ignition: payload.ignition,
          at: payload.at || at, stale: false,
        }
        return { ...prev, at: at || prev.at, vans, counts: countsFor(vans, prev.households.length) }
      })
      return
    }

    if (event === 'visit.recorded') {
      // Nudge the round's progress bar rather than refetching the snapshot for
      // one stop; the next snapshot reconciles it either way.
      setSnapshot((prev) => {
        if (!prev) return prev
        const vans = prev.vans.map((van) => {
          if (!van.route || van.route.id !== payload.route) return van
          const progress = { ...van.progress }
          if (payload.status === 'collected') progress.collected += 1
          else if (payload.status === 'skipped') progress.skipped += 1
          progress.percent = progress.total ? Math.round((progress.collected / progress.total) * 100) : 0
          return { ...van, progress }
        })
        return { ...prev, vans }
      })
      return
    }

    if (event === 'collector.status') {
      setSnapshot((prev) => {
        if (!prev) return prev
        const vans = prev.vans.map((van) => (van.driver?.id === payload.id
          ? { ...van, driver: { ...van.driver, status: payload.status } }
          : van))
        return { ...prev, vans }
      })
      return
    }

    // A new complaint has nothing to draw on the map, but the supervisor watching
    // it should see that one arrived.
    if (event === 'complaint.opened') setAlerts((count) => count + 1)
  }, [])

  useEffect(() => {
    let socket = null
    let retry = null
    let poll = null
    let tries = 0
    let done = false

    const startPolling = () => {
      if (poll) return
      setLink('polling')
      poll = setInterval(load, POLL_SECONDS * 1000)
    }
    const stopPolling = () => {
      if (poll) clearInterval(poll)
      poll = null
    }

    const connect = () => {
      if (done) return
      let ws
      try {
        ws = new WebSocket(socketUrl('/ws/live/'))
      } catch {
        // No WebSocket at all (blocked, or a bad URL) — poll and stop trying.
        startPolling()
        return
      }
      socket = ws

      ws.onmessage = (message) => {
        let frame
        try { frame = JSON.parse(message.data) } catch { return }
        // The `ready` frame is the only proof the handshake was accepted, so it
        // is what promotes us off polling.
        if (frame.event === 'ready') {
          tries = 0
          stopPolling()
          setLink('live')
          // Frames only carry deltas; resync in case anything moved while the
          // socket was down.
          load()
          return
        }
        if (frame.event === 'pong') return
        apply(frame)
      }

      ws.onclose = () => {
        socket = null
        if (done) return
        tries += 1
        // Keep the map moving on HTTP while the socket retries in the background.
        startPolling()
        retry = setTimeout(connect, Math.min(RECONNECT_BASE_MS * 2 ** (tries - 1), RECONNECT_MAX_MS))
      }
    }

    connect()

    return () => {
      done = true
      if (retry) clearTimeout(retry)
      stopPolling()
      // Clear the handlers before closing: unmounting fires onclose, which would
      // otherwise schedule a reconnect for a page that no longer exists.
      if (socket) {
        socket.onmessage = null
        socket.onclose = null
        socket.close()
      }
    }
  }, [load, apply, attempt])

  // --- derived ------------------------------------------------------------

  const vans = useMemo(() => (snapshot?.vans || []).map((van) => {
    const fix = van.at ? Date.parse(van.at) : NaN
    // Prefer our own ageing when the timestamp parses; fall back to whatever the
    // snapshot decided.
    const stale = Number.isNaN(fix) ? Boolean(van.stale) : now - fix > STALE_MS
    return { ...van, stale, tracked: van.lat != null && van.lng != null }
  }), [snapshot, now])

  const pinned = useMemo(() => vans.filter((v) => v.tracked), [vans])
  const activeVan = pinned.find((v) => v.id === active)
  const households = snapshot?.households || []
  const counts = snapshot?.counts || { vans: 0, tracked: 0, live: 0, households: 0 }
  // The server picks the viewport from the caller's visible wards; the fallbacks
  // only decide where an empty map opens, never what it claims to show.
  const centre = snapshot?.centre || households[0] || CITY_CENTRE

  const tiles = TILES[theme === 'dark' ? 'dark' : 'light']
  const vanColor = (van) => STATUS_COLOR[van.driver?.status || van.status] || '#0f7b4e'
  const vanLabel = (van) => van.driver?.name || t('liveMap.van.plate', { plate: van.plate })

  const linkBadge = link === 'live'
    ? <span className="badge badge-ok pulse"><span className="dot" />{t('liveMap.realtime.live')}</span>
    : link === 'polling'
      ? <span className="badge badge-warn"><span className="dot" />{t('liveMap.realtime.polling', { seconds: n(POLL_SECONDS) })}</span>
      : <span className="badge badge-muted"><span className="dot" />{t('liveMap.realtime.connecting')}</span>

  const header = (
    <PageHeader
      title={t('liveMap.title')}
      subtitle={t('liveMap.subtitle', { seconds: n(POLL_SECONDS) })}
      actions={(
        <>
          {linkBadge}
          {alerts > 0 && <span className="badge badge-warn">{t('liveMap.newComplaints', { count: n(alerts) })}</span>}
          <span className="badge badge-ok"><span className="dot" />{t('liveMap.liveBadge', { count: n(counts.live) })}</span>
        </>
      )}
    />
  )

  if (loading && !snapshot) {
    return (
      <div className="fade-in">
        {header}
        <div className="card card-pad center row gap-8" style={{ padding: '48px 16px', justifyContent: 'center' }}>
          <span className="spinner spinner-dark" /> <span className="muted">{t('common.loading')}</span>
        </div>
      </div>
    )
  }

  // A snapshot that never arrived is reported, not drawn as an empty city.
  if (error && !snapshot) {
    return (
      <div className="fade-in">
        {header}
        <div className="card card-pad center" style={{ padding: '40px 20px' }}>
          <div style={{ color: 'var(--danger)', fontWeight: 700 }}>{t('common.loadFailed')}</div>
          <div className="small muted mt-8">{error.detail || error.message || t('common.loadFailedUnknown')}</div>
          <button className="btn btn-ghost btn-sm mt-16" onClick={() => setAttempt((v) => v + 1)}>
            <IconRefresh size={15} /> {t('common.retry')}
          </button>
        </div>
      </div>
    )
  }

  const mapBlock = (
    <>
      <MapContainer key={fs ? 'fs' : 'inline'} center={[centre.lat, centre.lng]} zoom={13} scrollWheelZoom style={{ height: '100%', width: '100%' }}>
        <TileLayer key={theme} url={tiles.url} attribution={tiles.attribution} />
        <FlyTo target={activeVan} />
        <MapResizer watch={fs} />
        {households.map((h) => {
          // The snapshot carries only what the map plots; the address for the
          // popup comes from the household already in memory.
          const record = householdById(h.id)
          return (
            <CircleMarker key={h.id} center={[h.lat, h.lng]} radius={6}
              pathOptions={{ color: '#ffffff', weight: 1.5, fillColor: h.dues > 0 ? '#d97706' : '#0f7b4e', fillOpacity: 0.9 }}>
              <Popup>
                <b>{record?.head || h.id}</b><br />{h.id}<br />
                {t('liveMap.popup.holding', { holding: record?.holding || '—', road: record?.road || '—' })}<br />
                {h.dues > 0 ? t('liveMap.popup.due', { amount: taka(h.dues) }) : t('liveMap.popup.noDues')}
              </Popup>
            </CircleMarker>
          )
        })}
        {pinned.map((van) => (
          <Marker key={van.id} position={[van.lat, van.lng]}
            icon={vanIcon(vanColor(van), initialsOf(vanLabel(van)), van.stale)}
            eventHandlers={{ click: () => setActive(van.id) }}>
            <Popup>
              <b>{vanLabel(van)}</b><br />
              {van.driver ? `${van.driver.dspId} · ${van.driver.zone}` : t('liveMap.van.noDriver')}<br />
              {t('liveMap.popup.status', { status: t(`status.${van.driver?.status || van.status}`) })}<br />
              {van.driver && <>{t('liveMap.popup.coverage', { value: percent(van.driver.coverage) })}<br /></>}
              {van.stale
                ? t('liveMap.van.lastSeen', { when: time(van.at) })
                : t('liveMap.van.progress', { done: n(van.progress.collected), total: n(van.progress.total) })}
            </Popup>
          </Marker>
        ))}
      </MapContainer>
      <button className="map-fs-btn" onClick={() => setFs((v) => !v)}>
        {fs ? <><IconMinimize size={15} /> {t('liveMap.exitFullscreen')}</> : <><IconExpand size={15} /> {t('liveMap.fullscreen')}</>}
      </button>
      <div className="lf-legend tiny">
        <div className="row gap-8"><span className="lf-key" style={{ background: '#0f7b4e' }} /> {t('liveMap.legend.onRoute')}</div>
        <div className="row gap-8 mt-4"><span className="lf-key" style={{ background: '#dc2626' }} /> {t('liveMap.legend.offRoute')}</div>
        <div className="row gap-8 mt-4"><span className="lf-key" style={{ background: '#d97706' }} /> {t('liveMap.legend.dues')}</div>
        <div className="row gap-8 mt-4"><span className="lf-key" style={{ background: '#0f7b4e', opacity: 0.45 }} /> {t('liveMap.legend.stale')}</div>
      </div>
    </>
  )

  return (
    <div className="fade-in">
      {header}

      {/* A snapshot refresh that failed while an older one is on screen is worth
          saying out loud — the pins are real, they are just no longer current. */}
      {error && (
        <div className="card card-pad row between gap-12" style={{ marginBottom: 16, borderColor: 'var(--danger)' }}>
          <span className="small" style={{ color: 'var(--danger)' }}>
            {error.detail || error.message || t('common.loadFailed')}
          </span>
          <button className="btn btn-ghost btn-sm" onClick={() => setAttempt((v) => v + 1)}>
            <IconRefresh size={15} /> {t('common.retry')}
          </button>
        </div>
      )}

      <div className="two-col">
        <Section title={t('liveMap.section.positions')} pad={false}
          actions={<span className="tiny muted">{t('liveMap.counts', {
            tracked: n(counts.tracked), vans: n(counts.vans), households: n(counts.households),
          })}</span>}>
          <div style={{ padding: 12 }}>
            {fs
              ? createPortal(
                  <div className="map-portal">
                    <div className="leaflet-shell" style={{ flex: 1, minHeight: 0, border: 'none', borderRadius: 0 }}>{mapBlock}</div>
                  </div>, document.body)
              : <div className="leaflet-shell" style={{ height: 480 }}>{mapBlock}</div>}
          </div>
        </Section>

        <Section title={t('liveMap.section.collectors')}>
          <div className="grid" style={{ gap: 10 }}>
            {vans.map((van) => (
              <div key={van.id} className="row between"
                style={{ padding: '11px 12px', borderRadius: 10, cursor: van.tracked ? 'pointer' : 'default', background: active === van.id ? 'var(--brand-050)' : 'var(--surface-2)', border: active === van.id ? '1px solid var(--brand-100)' : '1px solid transparent' }}
                onClick={() => van.tracked && setActive(van.id)}>
                <div className="row gap-12">
                  <div className="avatar" style={{ width: 34, height: 34, fontSize: 12, opacity: van.tracked ? 1 : 0.5 }}>
                    {initialsOf(vanLabel(van))}
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{vanLabel(van)}</div>
                    <div className="tiny muted-3 mono">
                      {van.driver ? `${van.driver.dspId} · ${van.driver.zone}` : t('liveMap.van.noDriver')}
                    </div>
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <Status value={van.driver?.status || van.status} />
                  <div className="tiny muted mt-4">
                    {!van.tracked
                      ? t('liveMap.van.untracked')
                      : van.stale
                        ? t('liveMap.van.lastSeen', { when: time(van.at) })
                        : van.driver
                          ? t('liveMap.coverage', { value: percent(van.driver.coverage) })
                          : t('liveMap.van.progress', { done: n(van.progress.collected), total: n(van.progress.total) })}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Section>
      </div>
    </div>
  )
}
