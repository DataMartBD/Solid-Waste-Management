import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { MapContainer, TileLayer, Marker, Circle, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { Modal, ModalActions } from './Modal.jsx'
import { MapResizer } from './mapUtils.jsx'
import { IconMap, IconCheck, IconAlert, IconRefresh, IconExpand, IconMinimize } from './Icons.jsx'
import { useTheme } from '../context/ThemeContext.jsx'
import { useLang } from '../i18n/index.jsx'

// Location verification: capture the device position, show it on the map, let
// the verifier place the pin exactly on the holding, then confirm.
//
// The position is set on the map only — the coordinates are shown as a readout,
// never as an editable field. Pointing at a gate you can see is a judgement
// someone standing there can make; typing six decimal places from a desk is not,
// and a verified location has to mean the former.

const TILES = {
  light: { url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', attribution: '&copy; OpenStreetMap &copy; CARTO' },
  dark: { url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', attribution: '&copy; OpenStreetMap &copy; CARTO' },
}

// Khulna, used only to frame the map before a reading arrives.
const FALLBACK_CENTRE = [22.836, 89.53]

const round6 = (v) => Number(Number(v).toFixed(6))

const pinIcon = L.divIcon({
  className: 'verify-pin',
  html: '<span></span>',
  iconSize: [26, 26],
  iconAnchor: [13, 13],
})

// Re-centre when a fresh GPS reading arrives. Deliberately keyed on the reading,
// not the pin, so dragging does not fight the map back to centre.
function Recentre({ fix, moved }) {
  const map = useMap()
  useEffect(() => {
    // Never pull the map away from a pin the verifier placed themselves.
    if (fix && !moved) map.setView([fix.lat, fix.lng], Math.max(map.getZoom(), 17), { animate: true })
  }, [fix, moved, map])
  return null
}

// Tapping the map moves the pin — easier than dragging on a phone.
function ClickToPlace({ onPlace }) {
  useMapEvents({ click: (e) => onPlace(round6(e.latlng.lat), round6(e.latlng.lng)) })
  return null
}

// `saving` covers the round trip to POST /{collection}/{id}/verify/ — the server
// stamps who verified and when, and rejects a pin outside Bangladesh, so the
// confirm button stays locked until it answers.
export default function VerifyLocationModal({ household, verifierName, busy, saving, error, fix, onRecapture, onConfirm, onClose }) {
  const { t, n, digits, wardName } = useLang()
  const { theme } = useTheme()
  const tiles = TILES[theme === 'dark' ? 'dark' : 'light']

  // The pin the verifier is about to commit. Starts at the GPS reading and
  // follows it on every recapture, but they may move it.
  const [point, setPoint] = useState(null)
  const [moved, setMoved] = useState(false)
  const [fs, setFs] = useState(false)
  const markerRef = useRef(null)

  // A reading only moves the pin if the verifier has not already placed it.
  // Without this, a slow fix landing after they tapped the gate would discard
  // their judgement *and* re-attach the instrument's accuracy to a hand-placed
  // point — defeating the guarantee from the other direction.
  useEffect(() => {
    if (!fix || moved) return
    setPoint({ lat: fix.lat, lng: fix.lng })
  }, [fix, moved])

  // Re-verifying a holding that already has a location: start from where it is.
  useEffect(() => {
    if (fix || point) return
    if (Number.isFinite(household?.lat) && Number.isFinite(household?.lng)) {
      setPoint({ lat: household.lat, lng: household.lng })
    }
  }, [household, fix, point])

  useEffect(() => {
    if (!fs) return
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); setFs(false) } }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [fs])

  const place = (lat, lng) => { setPoint({ lat, lng }); setMoved(true) }

  const markerHandlers = useMemo(() => ({
    dragend() {
      const ll = markerRef.current?.getLatLng()
      if (ll) place(round6(ll.lat), round6(ll.lng))
    },
  }), [])

  const centre = point ? [point.lat, point.lng] : FALLBACK_CENTRE

  const mapInner = (
    <>
      <MapContainer
        key={fs ? 'fs' : 'inline'}
        center={centre}
        zoom={point ? 17 : 13}
        scrollWheelZoom
        style={{ height: '100%', width: '100%' }}
      >
        <TileLayer key={theme} url={tiles.url} attribution={tiles.attribution} />
        <MapResizer watch={fs} />
        <Recentre fix={fix} moved={moved} />
        <ClickToPlace onPlace={place} />
        {point && (
          <>
            {/* the device's stated margin of error, only while the pin is still its reading */}
            {!moved && fix?.accuracy != null && (
              <Circle center={centre} radius={fix.accuracy}
                pathOptions={{ color: 'var(--brand)', weight: 1, fillOpacity: 0.12 }} />
            )}
            <Marker position={centre} icon={pinIcon} draggable eventHandlers={markerHandlers} ref={markerRef} />
          </>
        )}
      </MapContainer>
      <button type="button" className="map-fs-btn" onClick={() => setFs((v) => !v)}>
        {fs
          ? <><IconMinimize size={15} /> {t('households.verify.exitFullscreen')}</>
          : <><IconExpand size={15} /> {t('households.verify.fullscreen')}</>}
      </button>
      {!point && !busy && <div className="verify-map-empty">{t('households.verify.noFix')}</div>}
    </>
  )

  const readout = (
    <div className="verify-readout">
      <div>
        <div className="tiny muted-3">{t('households.field.latitude')}</div>
        <div className="mono" style={{ fontWeight: 600 }}>{point ? digits(point.lat.toFixed(6)) : '—'}</div>
      </div>
      <div>
        <div className="tiny muted-3">{t('households.field.longitude')}</div>
        <div className="mono" style={{ fontWeight: 600 }}>{point ? digits(point.lng.toFixed(6)) : '—'}</div>
      </div>
      <div>
        <div className="tiny muted-3">{t('households.field.accuracy')}</div>
        <div style={{ fontWeight: 600 }}>
          {moved
            ? <span className="tiny muted">{t('households.verify.placedByHand')}</span>
            : fix?.accuracy != null ? t('households.metres', { n: n(fix.accuracy) }) : '—'}
        </div>
      </div>
    </div>
  )

  // Fullscreen keeps the readout and the confirm action on screen — the whole
  // point of the big map is to place the pin and commit without leaving it.
  if (fs) {
    return createPortal(
      <div className="map-portal verify-portal">
        <div className="leaflet-shell" style={{ border: 'none', borderRadius: 0, flex: 1, minHeight: 0 }}>{mapInner}</div>
        <div className="verify-portal-foot">
          <div className="grow">
            <div style={{ fontWeight: 700 }}>{household.head}</div>
            <div className="tiny muted-3">
              {t('households.verify.holding', { holding: digits(household.holding) })} · {household.road} · {wardName(household.ward)}
            </div>
          </div>
          {readout}
          <div className="row gap-8">
            <button type="button" className="btn btn-ghost" onClick={() => setFs(false)}>
              <IconMinimize size={15} /> {t('households.verify.exitFullscreen')}
            </button>
            <button type="button" className="btn btn-primary" onClick={() => onConfirm(commit(point, fix, moved))} disabled={!point || busy || saving}>
              {saving ? <span className="spinner" /> : <IconCheck size={15} />} {saving ? t('households.verify.saving') : t('households.verify.confirm')}
            </button>
          </div>
        </div>
      </div>,
      document.body,
    )
  }

  return (
    <Modal
      title={t('households.verify.title')}
      subtitle={`${household.head} · ${t('households.verify.holding', { holding: digits(household.holding) })}`}
      onClose={onClose}
      width={620}
    >
      <div className="verify-id">
        <div>
          <div className="tiny muted-3">{t('households.col.ward')}</div>
          <div style={{ fontWeight: 600 }}>{wardName(household.ward)}</div>
        </div>
        <div>
          <div className="tiny muted-3">{t('households.col.road')}</div>
          <div style={{ fontWeight: 600 }}>{household.road}</div>
        </div>
        <div>
          <div className="tiny muted-3">{t('households.verify.verifier')}</div>
          <div style={{ fontWeight: 600 }}>{verifierName}</div>
        </div>
      </div>

      {busy && (
        <div className="form-note info" style={{ marginTop: 12 }}>
          <IconMap size={15} /><span>{t('households.verify.locating')}</span>
        </div>
      )}
      {error && !busy && (
        <div className="form-note bad" style={{ marginTop: 12 }}>
          <IconAlert size={15} /><span>{error}</span>
        </div>
      )}

      <div className="verify-map" style={{ marginTop: 14 }}>{mapInner}</div>

      {readout}
      <div className="tiny muted-3 mt-8">{t('households.verify.placeHint')}</div>

      <ModalActions>
        <button type="button" className="btn btn-ghost" onClick={onClose}>{t('common.cancel')}</button>
        <button type="button" className="btn btn-ghost" onClick={onRecapture} disabled={busy || saving}>
          <IconRefresh size={15} /> {busy ? t('households.verifying') : t('households.verify.recapture')}
        </button>
        <button type="button" className="btn btn-primary" onClick={() => onConfirm(commit(point, fix, moved))} disabled={!point || busy || saving}>
          {saving ? <span className="spinner" /> : <IconCheck size={15} />} {saving ? t('households.verify.saving') : t('households.verify.confirm')}
        </button>
      </ModalActions>
    </Modal>
  )
}

// What actually gets written. A pin the verifier placed is no longer the
// instrument's reading, so the GPS accuracy figure is dropped rather than
// carried forward as a stale claim about precision.
function commit(point, fix, moved) {
  if (!point) return null
  return {
    lat: point.lat,
    lng: point.lng,
    accuracy: moved ? null : (fix?.accuracy ?? null),
    placedByHand: moved,
  }
}
