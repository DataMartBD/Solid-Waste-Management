import { useEffect, useRef, useState } from 'react'
import jsQR from 'jsqr'
import { households } from '../api/endpoints.js'
import { useLang } from '../i18n/index.jsx'
import { IconQr, IconAlert } from './Icons.jsx'

// Live QR reader for household tags.
//
// Two decoders, in order of preference:
//   1. BarcodeDetector — native, hardware-accelerated, Android/desktop Chrome.
//   2. jsQR — pure JS over a canvas frame; the only option on iOS Safari and
//      Firefox, which is most of the phones a ward office actually hands out.
// If neither the camera nor permission is available the caller still has the
// manual tag entry, so a worn label never blocks a round.

const SCAN_INTERVAL_MS = 220 // ~4.5 reads/sec — enough to feel instant, easy on the battery

// The sticker encodes `SWMS|<household id>|<tag>`; a bare tag is also accepted so
// a hand-keyed code works. The server resolves either form.
export function tagOf(raw) {
  const parts = String(raw || '').trim().split('|')
  return (parts.length >= 3 && parts[0] === 'SWMS' ? parts[2] : parts[0]).trim()
}

async function makeDetector() {
  if (typeof window === 'undefined' || !('BarcodeDetector' in window)) return null
  try {
    const supported = await window.BarcodeDetector.getSupportedFormats()
    if (!supported.includes('qr_code')) return null
    return new window.BarcodeDetector({ formats: ['qr_code'] })
  } catch { return null }
}

// `onDetect(raw, household)` — the second argument is the row the server resolved
// the tag to, or null. Resolving server-side rather than against whatever list the
// calling page happens to hold means a real tag is always recognised, even when
// the holding is outside the current round or page of data.
export default function QrScanner({ onDetect, paused, resolve = true }) {
  const { t } = useLang()
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const rafRef = useRef(0)
  const lastRef = useRef({ code: '', at: 0 })
  const pausedRef = useRef(paused)
  const resolveRef = useRef(resolve)
  // Held in a ref so a new callback identity from the parent's next render does
  // not tear down and restart the camera mid-scan.
  const onDetectRef = useRef(onDetect)
  const [error, setError] = useState(null)
  const [engine, setEngine] = useState(null)
  const [checking, setChecking] = useState(false)

  useEffect(() => { pausedRef.current = paused }, [paused])
  useEffect(() => { resolveRef.current = resolve }, [resolve])
  useEffect(() => { onDetectRef.current = onDetect }, [onDetect])

  useEffect(() => {
    let stream = null
    let detector = null
    let cancelled = false
    let timer = 0

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) { setError('unsupported'); return }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } },
          audio: false,
        })
      } catch (err) {
        // The distinction matters: a denied permission is fixable by the user,
        // a missing camera is not.
        setError(err?.name === 'NotAllowedError' ? 'denied' : 'noCamera')
        return
      }
      if (cancelled) { stream.getTracks().forEach((tr) => tr.stop()); return }

      const video = videoRef.current
      if (!video) { stream.getTracks().forEach((tr) => tr.stop()); return }
      video.srcObject = stream
      video.setAttribute('playsinline', 'true') // iOS refuses to inline-play without this
      try { await video.play() } catch { /* autoplay can reject; the loop still reads frames */ }

      detector = await makeDetector()
      if (cancelled) return
      setEngine(detector ? 'native' : 'jsqr')
      loop()
    }

    async function emit(value) {
      // A frame decoded after the modal closed must not record a collection —
      // detect() resolves asynchronously and the user may already have cancelled.
      if (cancelled || !value) return
      const now = Date.now()
      // One tag stays in frame for many frames — debounce so a single label
      // does not fire a dozen collections.
      if (lastRef.current.code === value && now - lastRef.current.at < 2500) return
      lastRef.current = { code: value, at: now }

      if (!resolveRef.current) { onDetectRef.current(value, null); return }
      setChecking(true)
      let household = null
      try {
        household = await households.byQr(tagOf(value))
      } catch {
        // An unknown tag is a normal outcome — the caller decides what to say.
        household = null
      }
      if (cancelled) return
      setChecking(false)
      onDetectRef.current(value, household)
    }

    async function read() {
      const video = videoRef.current
      if (!video || video.readyState < 2 || pausedRef.current) return
      try {
        if (detector) {
          const found = await detector.detect(video)
          if (cancelled) return
          if (found.length) emit(found[0].rawValue)
          return
        }
        const canvas = canvasRef.current
        if (!canvas) return
        const w = video.videoWidth
        const h = video.videoHeight
        if (!w || !h) return
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        ctx.drawImage(video, 0, 0, w, h)
        const { data } = ctx.getImageData(0, 0, w, h)
        const result = jsQR(data, w, h, { inversionAttempts: 'dontInvert' })
        if (result?.data) emit(result.data)
      } catch { /* a dropped frame is not worth surfacing */ }
    }

    function loop() {
      if (cancelled) return
      timer = setTimeout(async () => {
        await read()
        rafRef.current = requestAnimationFrame(loop)
      }, SCAN_INTERVAL_MS)
    }

    start()
    return () => {
      cancelled = true
      clearTimeout(timer)
      cancelAnimationFrame(rafRef.current)
      if (stream) stream.getTracks().forEach((tr) => tr.stop())
      const video = videoRef.current
      if (video) video.srcObject = null
    }
  }, []) // the camera starts once and lives for the lifetime of the modal

  if (error) {
    return (
      <div className="scan-frame scan-frame-error">
        <IconAlert size={26} />
        <div className="small" style={{ fontWeight: 600, marginTop: 8 }}>{t(`collection.scan.${error}`)}</div>
        <div className="tiny muted mt-4">{t('collection.scan.useManual')}</div>
      </div>
    )
  }

  return (
    <div className="scan-frame">
      <video ref={videoRef} muted playsInline className="scan-video" />
      <canvas ref={canvasRef} style={{ display: 'none' }} />
      <div className="scan-reticle"><span /><span /><span /><span /></div>
      <div className="scan-hint">
        <IconQr size={14} /> {checking ? t('collection.scan.checking') : t('collection.scan.aim')}
        {engine === 'jsqr' && <span className="scan-engine">{t('collection.scan.softwareDecoder')}</span>}
      </div>
    </div>
  )
}
