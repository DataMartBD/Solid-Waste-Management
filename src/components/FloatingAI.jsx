import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { IconSpark } from './Icons.jsx'
import { useData } from '../context/DataContext.jsx'

// Lightweight rule-based "assistant" — answers from live store data and
// offers quick navigation. (Wire to a real LLM endpoint later.)
const SUGGESTIONS = [
  'How many households have dues?',
  'Which vans need service?',
  'Show open complaints',
  'Collection rate this period',
]

export default function FloatingAI() {
  const [open, setOpen] = useState(false)
  const [log, setLog] = useState([{ from: 'ai', text: 'Hi! I\'m Sweep AI. Ask me about collection, dues, fleet or complaints — or use a shortcut below.' }])
  const [input, setInput] = useState('')
  const navigate = useNavigate()
  const data = useData()

  function answer(q) {
    const s = q.toLowerCase()
    const { households, vans, complaints, bills } = data
    if (/due|outstanding|unpaid/.test(s)) {
      const withDues = households.filter((h) => (h.dues || 0) > 0)
      const total = withDues.reduce((a, h) => a + h.dues, 0)
      return { text: `${withDues.length} households currently have outstanding dues, totalling ৳${total.toLocaleString()}. Opening Billing.`, go: '/app/billing' }
    }
    if (/van|fleet|service|maintenance/.test(s)) {
      const due = vans.filter((v) => v.nextServiceKm - v.odometer <= 1000 || v.status === 'in_maintenance')
      return { text: `${due.length} van(s) need attention (service due or in maintenance). Opening Fleet.`, go: '/app/fleet' }
    }
    if (/complaint|ticket|sla/.test(s)) {
      const openC = complaints.filter((c) => ['open', 'assigned', 'in_progress'].includes(c.status))
      return { text: `There are ${openC.length} active complaint tickets. Opening Complaints.`, go: '/app/complaints' }
    }
    if (/collect|rate|charge|revenue|billing/.test(s)) {
      const billed = bills.reduce((a, b) => a + b.amount, 0)
      const paid = bills.filter((b) => b.status === 'paid').reduce((a, b) => a + b.amount, 0)
      return { text: `Collected ৳${paid.toLocaleString()} of ৳${billed.toLocaleString()} billed (${billed ? Math.round((paid / billed) * 100) : 0}%). Opening Reports.`, go: '/app/reports' }
    }
    if (/household|customer|register|report/.test(s)) {
      return { text: `${households.length} households registered. See the customer reports by ward/road.`, go: '/app/reports' }
    }
    return { text: 'I can help with dues, fleet/maintenance, complaints, and collection rates. Try one of the shortcuts.' }
  }

  function send(q) {
    const text = (q ?? input).trim()
    if (!text) return
    const res = answer(text)
    setLog((l) => [...l, { from: 'me', text }, { from: 'ai', text: res.text, go: res.go }])
    setInput('')
    if (res.go) setTimeout(() => { navigate(res.go); setOpen(false) }, 900)
  }

  return (
    <>
      {open && (
        <div className="ai-panel fade-in">
          <div className="ai-head">
            <div className="row gap-8">
              <span className="ai-badge-icon"><IconSpark size={16} /></span>
              <div><div style={{ fontWeight: 700, fontSize: 14 }}>Sweep AI</div><div className="tiny" style={{ color: 'rgba(255,255,255,.7)' }}>Assistant · beta</div></div>
            </div>
            <button className="ai-x" onClick={() => setOpen(false)}>✕</button>
          </div>
          <div className="ai-body">
            {log.map((m, i) => (
              <div key={i} className={`ai-msg ${m.from}`}>{m.text}</div>
            ))}
          </div>
          <div className="ai-chips">
            {SUGGESTIONS.map((s) => <button key={s} onClick={() => send(s)}>{s}</button>)}
          </div>
          <form className="ai-input" onSubmit={(e) => { e.preventDefault(); send() }}>
            <input placeholder="Ask Sweep AI…" value={input} onChange={(e) => setInput(e.target.value)} />
            <button type="submit" className="btn btn-primary btn-sm">Send</button>
          </form>
        </div>
      )}
      <button className={`ai-fab ${open ? 'active' : ''}`} onClick={() => setOpen((o) => !o)} aria-label="AI assistant">
        <IconSpark size={24} />
        <span className="ai-fab-badge">AI</span>
      </button>
    </>
  )
}
