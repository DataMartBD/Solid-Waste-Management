// Pure helpers for the Complaint Management module — kept framework-free so the
// lifecycle, priority and label logic is unit-testable on its own.
//
// The SLA *arithmetic* that used to live here is gone. /api/complaints/ returns a
// `slaState` on every row ({ budget, elapsed, remaining, active, breached, pct }),
// computed from the same `opened`/`sla` columns the server sorts and filters on,
// so a second implementation in the browser could only ever drift from it — and
// "breached" is a number the citizen is owed, not a rendering detail. Deleted for
// the same reason: `hoursSince` (only ever fed that arithmetic), and
// `makeActivity`/`withActivity`, because the audit entry is now written inside the
// same transaction as the change it describes; a page that assembled its own
// trail could produce a ticket whose history lied.
//
// What is left is presentation — the tone a meter is painted in, the caption it
// carries — plus the constants the forms, badges and sorting render from.

// Ticket lifecycle, in order. `advance` walks this list left→right.
export const LIFECYCLE = ['open', 'assigned', 'in_progress', 'resolved', 'closed']

// Statuses that count as "still needs work" (drive SLA + active counts).
export const ACTIVE_STATUSES = ['open', 'assigned', 'in_progress']
export const isActive = (status) => ACTIVE_STATUSES.includes(status)
export const isClosedOut = (status) => status === 'resolved' || status === 'closed'

export const COMPLAINT_TYPES = ['missed_collection', 'overflow', 'billing_dispute', 'staff_behaviour', 'other']

export const TYPE_LABEL = {
  missed_collection: 'Missed collection',
  overflow: 'Bin overflow',
  billing_dispute: 'Billing dispute',
  staff_behaviour: 'Staff behaviour',
  other: 'Other',
}
export const typeLabel = (t) => TYPE_LABEL[t] || String(t || '').replace(/_/g, ' ')

// i18n twin of TYPE_LABEL. The UI is bilingual, so the helper hands back a
// translation key and the JSX runs it through t(); unknown types fall back to
// the humanised English, which translate() echoes back unchanged.
export const TYPE_KEY = {
  missed_collection: 'complaints.type.missed_collection',
  overflow: 'complaints.type.overflow',
  billing_dispute: 'complaints.type.billing_dispute',
  staff_behaviour: 'complaints.type.staff_behaviour',
  other: 'complaints.type.other',
}
export const typeLabelKey = (t) => TYPE_KEY[t] || String(t || '').replace(/_/g, ' ')

// Priority ladder. `sla` is the target resolution window (hours) the server will
// assign for that level — kept here only so the "log complaint" form can say what
// a choice implies before it is made; the authoritative budget is the `sla` the
// server writes and reports back in `slaState.budget`. `rank` orders urgent→low
// for sorting; `badge` maps to the shared badge classes.
export const PRIORITY = {
  urgent: { key: 'urgent', label: 'Urgent', badge: 'badge-danger', rank: 3, sla: 4 },
  high: { key: 'high', label: 'High', badge: 'badge-warn', rank: 2, sla: 12 },
  medium: { key: 'medium', label: 'Medium', badge: 'badge-info', rank: 1, sla: 24 },
  low: { key: 'low', label: 'Low', badge: 'badge-muted', rank: 0, sla: 48 },
}
export const PRIORITIES = ['urgent', 'high', 'medium', 'low']
export const priorityMeta = (p) => PRIORITY[p] || PRIORITY.medium

// Translation key for a priority label (the `label` above stays English-only so
// non-React callers and the unit tests keep working).
export const priorityLabelKey = (p) => `complaints.priority.${priorityMeta(p).key}`

// --- SLA presentation -------------------------------------------------------

// The posture of a ticket the server has not described. Every row from
// /api/complaints/ carries `slaState`, so this only covers a record held
// optimistically before its response landed: the status still says whether the
// ticket is live, but its deadline is genuinely unknown here, and inventing a
// budget from the priority is precisely the drift that moving this arithmetic
// server-side removed.
const UNKNOWN_SLA = { budget: 0, elapsed: 0, remaining: 0, breached: false, pct: 0 }

// The server's `slaState` for a ticket, never undefined.
export function slaOf(complaint) {
  return complaint?.slaState || { ...UNKNOWN_SLA, active: isActive(complaint?.status) }
}

// Colour band for an SLA meter. The server deliberately does not send this: the
// warn threshold (the last quarter of the budget) is a presentation decision and
// the frontend's to tune, whereas `breached` is not.
export function slaTone(sla) {
  const s = sla || UNKNOWN_SLA
  if (!s.active) return 'ok'
  if (s.breached) return 'danger'
  return s.remaining <= s.budget * 0.25 ? 'warn' : 'ok'
}

// Human-friendly SLA caption over a server-provided slaState, e.g. "18h left",
// "12h over", "Settled".
export function slaLabel(sla) {
  const s = sla || UNKNOWN_SLA
  if (!s.active) return 'Settled'
  if (s.breached) return `${Math.round(-s.remaining)}h over`
  return `${Math.round(s.remaining)}h left`
}

// i18n twin of slaLabel: returns the key plus the hour count to interpolate, so
// the page can render "৬ ঘণ্টা বাকি" with Bangla numerals.
export function slaLabelKey(sla) {
  const s = sla || UNKNOWN_SLA
  if (!s.active) return { key: 'complaints.sla.settled', vars: null }
  if (s.breached) return { key: 'complaints.sla.over', vars: { hours: Math.round(-s.remaining) } }
  return { key: 'complaints.sla.left', vars: { hours: Math.round(s.remaining) } }
}

// The status a ticket moves to when advanced (null once it can't advance
// further). Each row also arrives with the server's own `nextStatus`; this stays
// as the fallback and as the single definition LIFECYCLE is read through.
export function nextStatus(status) {
  const i = LIFECYCLE.indexOf(status)
  return i >= 0 && i < LIFECYCLE.length - 1 ? LIFECYCLE[i + 1] : null
}

// Activity-log actions the timeline knows how to name.
export const ACTIVITY_ACTIONS = [
  'created', 'assigned', 'in_progress', 'resolved', 'closed',
  'reassigned', 'priority', 'note', 'reopened',
]
export const actionLabelKey = (action) =>
  (ACTIVITY_ACTIONS.includes(action) ? `complaints.action.${action}` : String(action || '').replace(/_/g, ' '))

// Non-person authors of activity entries. Real collector / supervisor names are
// written by the server and pass through untouched. These four strings must match
// the server's actors byte-for-byte (see complaints/services.py) — note the
// U+00B7 MIDDLE DOT.
export const SYSTEM_ACTOR = 'System'
export const CONTROL_ROOM_ACTOR = 'Control Room'
export const ACTOR_KEY = {
  [SYSTEM_ACTOR]: 'complaints.actor.system',
  [CONTROL_ROOM_ACTOR]: 'complaints.actor.controlRoom',
  'Citizen · App': 'complaints.actor.citizenApp',
  'Citizen · SMS': 'complaints.actor.citizenSms',
}
export const actorLabelKey = (by) => ACTOR_KEY[by] || String(by || '')

// Priority order for sorting, preferring the rank the server computed.
const rankOf = (complaint) => complaint?.priorityRank ?? priorityMeta(complaint?.priority).rank

// Sort tickets the way an operator triages: breached first, then by priority,
// then oldest-first. Settled tickets sink to the bottom.
//
// The list endpoint already returns exactly this order, computed in SQL. This
// stays because the page re-sorts after filtering client-side, and because a row
// folded back in from an action response sits wherever it was in a list the
// server has not re-ordered.
export function triageSort(list) {
  return [...list].sort((a, b) => {
    const sa = slaOf(a)
    const sb = slaOf(b)
    if (sa.active !== sb.active) return sa.active ? -1 : 1
    if (sa.breached !== sb.breached) return sa.breached ? -1 : 1
    const pr = rankOf(b) - rankOf(a)
    if (pr) return pr
    return new Date(a.opened) - new Date(b.opened)
  })
}
