import { useState, useMemo, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { MapContainer, TileLayer, CircleMarker, Marker, Popup, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { PageHeader, Section, Status } from '../components/ui.jsx'
import { MapResizer } from '../components/mapUtils.jsx'
import { IconExpand, IconMinimize } from '../components/Icons.jsx'
import { useData } from '../context/DataContext.jsx'
import { useTheme } from '../context/ThemeContext.jsx'

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

// A teardrop pin with the collector's initials.
function collectorIcon(color, initials) {
  return L.divIcon({
    className: 'lf-pin-wrap',
    html: `<div class="lf-pin" style="background:${color}"><span>${initials}</span></div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 30],
    popupAnchor: [0, -28],
  })
}

// Pans/zooms the map when a collector is selected from the list.
function FlyTo({ target }) {
  const map = useMap()
  if (target) map.flyTo([target.lat, target.lng], 15, { duration: 0.7 })
  return null
}

export default function LiveMap() {
  const { collectors, households } = useData()
  const { theme } = useTheme()
  const [active, setActive] = useState(null)
  const [fs, setFs] = useState(false)

  useEffect(() => {
    if (!fs) return
    const onKey = (e) => e.key === 'Escape' && setFs(false)
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = '' }
  }, [fs])

  const onRoute = collectors.filter((c) => c.status === 'on_route')

  // Give each collector a plausible position near a household in their ward.
  const positioned = useMemo(() => collectors.map((c, i) => {
    const wardHome = households.find((h) => h.ward === c.zone) || households[i % households.length]
    return { ...c, lat: wardHome.lat + 0.0016, lng: wardHome.lng - 0.0011 }
  }), [collectors, households])

  const activeCollector = positioned.find((c) => c.id === active)
  const tiles = TILES[theme === 'dark' ? 'dark' : 'light']
  const center = [22.836, 89.53] // Khulna

  const mapBlock = (
    <>
      <MapContainer key={fs ? 'fs' : 'inline'} center={center} zoom={13} scrollWheelZoom style={{ height: '100%', width: '100%' }}>
        <TileLayer key={theme} url={tiles.url} attribution={tiles.attribution} />
        <FlyTo target={activeCollector} />
        <MapResizer watch={fs} />
        {households.map((h) => (
          <CircleMarker key={h.id} center={[h.lat, h.lng]} radius={6}
            pathOptions={{ color: '#ffffff', weight: 1.5, fillColor: h.dues > 0 ? '#d97706' : '#0f7b4e', fillOpacity: 0.9 }}>
            <Popup><b>{h.head}</b><br />{h.id}<br />Holding {h.holding} · {h.road}<br />{h.dues > 0 ? `৳${h.dues} due` : 'No dues'}</Popup>
          </CircleMarker>
        ))}
        {positioned.map((c) => (
          <Marker key={c.id} position={[c.lat, c.lng]}
            icon={collectorIcon(STATUS_COLOR[c.status] || '#0f7b4e', c.name.split(' ').map((w) => w[0]).join('').slice(0, 2))}
            eventHandlers={{ click: () => setActive(c.id) }}>
            <Popup><b>{c.name}</b><br />{c.dspId} · {c.zone}<br />Status: {c.status.replace(/_/g, ' ')}<br />Coverage: {c.coverage}%</Popup>
          </Marker>
        ))}
      </MapContainer>
      <button className="map-fs-btn" onClick={() => setFs((v) => !v)}>
        {fs ? <><IconMinimize size={15} /> Exit fullscreen</> : <><IconExpand size={15} /> Fullscreen</>}
      </button>
      <div className="lf-legend tiny">
        <div className="row gap-8"><span className="lf-key" style={{ background: '#0f7b4e' }} /> On route / serviced</div>
        <div className="row gap-8 mt-4"><span className="lf-key" style={{ background: '#dc2626' }} /> Off route</div>
        <div className="row gap-8 mt-4"><span className="lf-key" style={{ background: '#d97706' }} /> Household w/ dues</div>
      </div>
    </>
  )

  return (
    <div className="fade-in">
      <PageHeader
        title="Live Map"
        subtitle="Real-time collector positions & coverage · Khulna City · refreshes every 5s"
        actions={<span className="badge badge-ok pulse"><span className="dot" />Live · {onRoute.length} on route</span>}
      />

      <div className="two-col">
        <Section title="Field positions" pad={false}>
          <div style={{ padding: 12 }}>
            {fs
              ? createPortal(
                  <div className="map-portal">
                    <div className="leaflet-shell" style={{ flex: 1, minHeight: 0, border: 'none', borderRadius: 0 }}>{mapBlock}</div>
                  </div>, document.body)
              : <div className="leaflet-shell" style={{ height: 480 }}>{mapBlock}</div>}
          </div>
        </Section>

        <Section title="Collectors on shift">
          <div className="grid" style={{ gap: 10 }}>
            {collectors.map((c) => (
              <div key={c.id} className="row between"
                style={{ padding: '11px 12px', borderRadius: 10, cursor: 'pointer', background: active === c.id ? 'var(--brand-050)' : 'var(--surface-2)', border: active === c.id ? '1px solid var(--brand-100)' : '1px solid transparent' }}
                onClick={() => setActive(c.id)}>
                <div className="row gap-12">
                  <div className="avatar" style={{ width: 34, height: 34, fontSize: 12 }}>
                    {c.name.split(' ').map((w) => w[0]).join('').slice(0, 2)}
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{c.name}</div>
                    <div className="tiny muted-3 mono">{c.dspId} · {c.zone}</div>
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <Status value={c.status} />
                  <div className="tiny muted mt-4">{c.coverage}% coverage</div>
                </div>
              </div>
            ))}
          </div>
        </Section>
      </div>
    </div>
  )
}
