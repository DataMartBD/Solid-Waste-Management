// Reporting helpers that still belong in the browser.
//
// The rollups that used to live here — waste collection, bill collection, bill
// status, reconciliation and the two customer reports, plus their attribution and
// settlement helpers — were ported to server/swms/reports/aggregates.py and are
// reached through `api.reports.*`. They moved rather than being duplicated for
// two reasons: computing them here meant shipping every visit, bill and payment
// to the client before a single figure could be drawn, and two implementations of
// the same rollup drift apart the moment one of them is fixed.
//
// What is left is what the server cannot do on our behalf:
//
//   * bucketing a day-level series the screen re-groups locally, because
//     /reports/service-series/ is deliberately daily — one row per day is the
//     finest truth, and weekly / monthly views are a presentation choice;
//   * totalling whichever slice of rows is on screen after a client-side filter.
//
// Prefer the `totals` / `tally` a report endpoint already returns; reach for
// `totalsOf` / `stateTally` only for a locally filtered subset of its rows, where
// the server's figures would cover more than the table shows.

export const REPORT_MODES = ['daily', 'weekly', 'monthly', 'yearly']

// The four settlement states, in the order the summary strip renders them. Kept
// in step with BILL_STATES in server/swms/reports/aggregates.py — the server
// decides which state a bill is in, this list only decides how they are laid out.
export const BILL_STATES = ['paid', 'partial', 'unpaid', 'overdue']

// ISO week, Monday-based. Produces the same label as `periods.iso_week_label` on
// the server, so a bucket grouped here reads identically to one grouped there —
// including at a year boundary, where the ISO year can differ from the calendar
// year (2027-01-01 falls in 2026-W53).
export function isoWeek(date) {
  const d = new Date(`${String(date).slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return null
  const day = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - day + 3)
  const firstThu = new Date(Date.UTC(d.getUTCFullYear(), 0, 4))
  const week = 1 + Math.round(((d - firstThu) / 86400000 - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7)
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

// The bucket a date falls in, for the chosen granularity. Only the leading
// YYYY-MM-DD is read, so a timestamp and a plain date bucket alike.
export function periodKey(iso, mode = 'monthly') {
  const day = String(iso || '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null
  if (mode === 'daily') return day
  if (mode === 'weekly') return isoWeek(day)
  if (mode === 'yearly') return day.slice(0, 4)
  return day.slice(0, 7)
}

// Totals for whichever slice of rows is on screen, so a report footer cannot
// drift from the rows above it. Mirrors `aggregates.totals_of`.
export function totalsOf(rows, fields = ['billed', 'received', 'outstanding']) {
  const out = Object.fromEntries(fields.map((f) => [f, 0]))
  rows.forEach((r) => fields.forEach((f) => { out[f] += Number(r[f]) || 0 }))
  // `fields` does not always include the money pair — a service report totals
  // stops — so the rate falls back to zero rather than reporting NaN%.
  out.rate = out.billed ? Math.round(((out.received || 0) / out.billed) * 100) : 0
  out.count = rows.length
  return out
}

// How many bills sit in each settlement state — the summary strip above the list.
// Mirrors `aggregates.state_tally`.
export function stateTally(rows) {
  const tally = Object.fromEntries(BILL_STATES.map((s) => [s, 0]))
  rows.forEach((r) => { if (tally[r.state] !== undefined) tally[r.state] += 1 })
  return tally
}
