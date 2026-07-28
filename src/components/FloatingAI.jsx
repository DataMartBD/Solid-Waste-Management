import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { IconSpark, IconArrow } from './Icons.jsx'
import { ai } from '../api/endpoints.js'
import { useLang } from '../i18n/index.jsx'

// Thin client over POST /api/ai/ask. The server computes every figure from the
// live database, scoped to the signed-in operator, and falls back to rule-based
// answers when no model key is configured — so the panel answers either way and
// the browser never recomputes an operational number of its own.
//
// `key` is the label shown on the chip; `q` is the English phrase actually sent,
// so a translated chip still hits the server's rule matcher.
const SUGGESTIONS = [
  { key: 'ai.sug.dues', q: 'How many households have dues?' },
  { key: 'ai.sug.vans', q: 'Which vans need service?' },
  { key: 'ai.sug.complaints', q: 'Show open complaints' },
  { key: 'ai.sug.rate', q: 'Collection rate this period' },
]

export default function FloatingAI() {
  const [open, setOpen] = useState(false)
  // The greeting is stored as a key so it follows a language switch; replies
  // keep the wording they were generated with, like a real chat transcript.
  const [log, setLog] = useState([{ from: 'ai', key: 'ai.greeting' }])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()
  const { t } = useLang()
  const bodyRef = useRef(null)
  // Identifies the placeholder bubble a reply has to land in, so the transcript
  // keeps its order even though the answer arrives asynchronously.
  const seq = useRef(0)

  // keep the latest message in view
  useEffect(() => { if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight }, [log, open])

  // `askWith` lets a translated shortcut chip echo its own wording while the
  // server still receives the English phrase.
  async function send(q, askWith) {
    const text = (q ?? input).trim()
    // One question at a time: the input is disabled while busy, and this stops a
    // double submit from an Enter key repeat.
    if (!text || busy) return
    const id = ++seq.current
    setInput('')
    setBusy(true)
    setLog((l) => [...l, { from: 'me', text }, { from: 'ai', id, pending: true }])

    const replace = (message) => setLog((l) => l.map((m) => (m.id === id ? { ...message, from: 'ai', id } : m)))
    try {
      const res = await ai.ask(askWith ?? text)
      replace({ text: res.answer, go: res.go || null, goLabel: res.goLabel || null })
    } catch (error) {
      // A failed request is a bubble, never a thrown exception — the panel has to
      // stay usable when the backend is down mid-conversation.
      replace({ text: t(error?.status === 0 ? 'ai.offline' : 'ai.error'), failed: true })
    } finally {
      setBusy(false)
    }
  }

  // Navigate WITHOUT closing the panel, so the assistant stays available.
  function goTo(path) { navigate(path) }

  return (
    <>
      {open && (
        <div className="ai-panel fade-in" id="sweep-ai-panel">
          <div className="ai-head">
            <div className="row gap-8">
              <span className="ai-badge-icon"><IconSpark size={16} /></span>
              <div><div style={{ fontWeight: 700, fontSize: 14 }}>{t('ai.title')}</div><div className="tiny" style={{ color: 'var(--on-brand)', opacity: .78 }}>{t('ai.subtitle')}</div></div>
            </div>
            <button className="ai-x" onClick={() => setOpen(false)} aria-label={t('common.close')}>✕</button>
          </div>

          <div className="ai-body" ref={bodyRef}>
            {log.map((m, i) => (
              <div key={i} className={`ai-msg ${m.from}`}>
                {m.pending
                  ? (
                    <span className="row gap-8">
                      <span className="spinner spinner-dark" style={{ width: 13, height: 13, borderWidth: 2 }} />
                      <span className="tiny muted">{t('ai.thinking')}</span>
                    </span>
                  )
                  : <div style={m.failed ? { color: 'var(--danger-fg)' } : undefined}>{m.key ? t(m.key) : m.text}</div>}
                {m.go && (
                  <button className="ai-go" onClick={() => goTo(m.go)}>
                    {m.goLabel || t('ai.go.default')} <IconArrow size={13} />
                  </button>
                )}
              </div>
            ))}
          </div>

          <div className="ai-chips">
            {SUGGESTIONS.map((sug) => (
              <button key={sug.key} disabled={busy} onClick={() => send(t(sug.key), sug.q)}>{t(sug.key)}</button>
            ))}
          </div>

          <form className="ai-input" onSubmit={(e) => { e.preventDefault(); send() }}>
            <input placeholder={t('ai.placeholder')} value={input} onChange={(e) => setInput(e.target.value)} disabled={busy} />
            <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>{busy ? t('ai.sending') : t('ai.send')}</button>
          </form>
        </div>
      )}

      <button className={`ai-fab ${open ? 'active' : ''}`} onClick={() => setOpen((o) => !o)}
        aria-label={t('ai.title')} aria-expanded={open} aria-controls="sweep-ai-panel">
        <IconSpark size={24} />
        <span className="ai-fab-badge">AI</span>
      </button>
    </>
  )
}
