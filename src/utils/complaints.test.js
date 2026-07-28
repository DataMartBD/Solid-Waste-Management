import { describe, it, expect } from 'vitest'
import {
  LIFECYCLE, isActive, isClosedOut, typeLabel,
  priorityMeta, PRIORITY, slaOf, slaTone, slaLabel,
  nextStatus, triageSort,
  typeLabelKey, priorityLabelKey, slaLabelKey,
  actionLabelKey, actorLabelKey, SYSTEM_ACTOR,
} from './complaints.js'

// `slaState` as /api/complaints/ sends it. The helpers only ever format this
// object now — the hours are the server's, so nothing here recomputes them.
const sla = (over = {}) => ({
  budget: 24, elapsed: 6, remaining: 18, active: true, breached: false, pct: 25, ...over,
})

const ticket = (over = {}) => ({
  id: 'CMP-1', status: 'open', priority: 'medium', priorityRank: 1,
  opened: '2026-07-06T00:00:00Z', slaState: sla(), activity: [], ...over,
})

describe('status predicates', () => {
  it('isActive is true only for open/assigned/in_progress', () => {
    expect(isActive('open')).toBe(true)
    expect(isActive('assigned')).toBe(true)
    expect(isActive('in_progress')).toBe(true)
    expect(isActive('resolved')).toBe(false)
    expect(isActive('closed')).toBe(false)
  })

  it('isClosedOut is true for resolved and closed', () => {
    expect(isClosedOut('resolved')).toBe(true)
    expect(isClosedOut('closed')).toBe(true)
    expect(isClosedOut('open')).toBe(false)
  })
})

describe('typeLabel', () => {
  it('maps known types and humanises unknown ones', () => {
    expect(typeLabel('missed_collection')).toBe('Missed collection')
    expect(typeLabel('some_new_type')).toBe('some new type')
  })
})

describe('priorityMeta', () => {
  it('returns the metadata for a known priority', () => {
    expect(priorityMeta('urgent').sla).toBe(4)
    expect(priorityMeta('low').sla).toBe(48)
  })

  it('defaults to medium for an unknown priority', () => {
    expect(priorityMeta('bogus')).toBe(PRIORITY.medium)
  })

  it('ranks urgent highest and low lowest', () => {
    expect(priorityMeta('urgent').rank).toBeGreaterThan(priorityMeta('high').rank)
    expect(priorityMeta('high').rank).toBeGreaterThan(priorityMeta('medium').rank)
    expect(priorityMeta('medium').rank).toBeGreaterThan(priorityMeta('low').rank)
  })
})

describe('slaOf', () => {
  it('hands back the server-provided slaState untouched', () => {
    const state = sla({ remaining: 3 })
    expect(slaOf(ticket({ slaState: state }))).toBe(state)
  })

  it('reports an unknown budget rather than inventing one from the priority', () => {
    // A record held optimistically before its response landed. The old
    // client-side slaState() would have guessed 4h from `priority: urgent`.
    const s = slaOf({ status: 'open', priority: 'urgent' })
    expect(s.active).toBe(true)
    expect(s.budget).toBe(0)
    expect(s.breached).toBe(false)
  })

  it('treats a settled ticket with no slaState as inactive', () => {
    expect(slaOf({ status: 'closed' }).active).toBe(false)
    expect(slaOf(undefined).active).toBe(false)
  })
})

// The tone is deliberately NOT sent by the server: the warn threshold is a
// presentation choice, whereas `breached` is not.
describe('slaTone', () => {
  it('is ok while comfortably inside the budget', () => {
    expect(slaTone(sla({ budget: 24, remaining: 18 }))).toBe('ok')
  })

  it('warns inside the last quarter of the budget', () => {
    expect(slaTone(sla({ budget: 24, remaining: 6 }))).toBe('warn')
    expect(slaTone(sla({ budget: 4, remaining: 1 }))).toBe('warn')
  })

  it('is danger once the server says breached', () => {
    expect(slaTone(sla({ remaining: -12, breached: true }))).toBe('danger')
  })

  it('is ok for a settled ticket whatever the hours say', () => {
    expect(slaTone(sla({ active: false, remaining: -40, breached: false }))).toBe('ok')
  })

  it('falls back to ok for a missing state', () => {
    expect(slaTone(undefined)).toBe('ok')
  })
})

describe('slaLabel', () => {
  it('shows remaining hours, overage, or Settled', () => {
    expect(slaLabel(sla({ remaining: 18 }))).toBe('18h left')
    expect(slaLabel(sla({ remaining: -12, breached: true }))).toBe('12h over')
    expect(slaLabel(sla({ active: false }))).toBe('Settled')
  })

  it('rounds the fractional hours the server sends', () => {
    expect(slaLabel(sla({ remaining: 5.6 }))).toBe('6h left')
    expect(slaLabel(sla({ remaining: -2.4, breached: true }))).toBe('2h over')
  })
})

// The UI is bilingual, so these twins hand back translation keys instead of
// English text. Unknown values fall back to readable English because
// translate() echoes an unknown key straight back to the screen.
describe('translation-key helpers', () => {
  it('typeLabelKey maps known types and falls back to humanised text', () => {
    expect(typeLabelKey('missed_collection')).toBe('complaints.type.missed_collection')
    expect(typeLabelKey('billing_dispute')).toBe('complaints.type.billing_dispute')
    expect(typeLabelKey('some_new_type')).toBe('some new type')
  })

  it('priorityLabelKey namespaces every priority and defaults to medium', () => {
    expect(priorityLabelKey('urgent')).toBe('complaints.priority.urgent')
    expect(priorityLabelKey('low')).toBe('complaints.priority.low')
    expect(priorityLabelKey('bogus')).toBe('complaints.priority.medium')
  })

  it('actionLabelKey maps known activity actions and humanises the rest', () => {
    expect(actionLabelKey('in_progress')).toBe('complaints.action.in_progress')
    expect(actionLabelKey('reassigned')).toBe('complaints.action.reassigned')
    expect(actionLabelKey('some_action')).toBe('some action')
    expect(actionLabelKey(undefined)).toBe('')
  })

  it('actorLabelKey maps system actors but leaves person names alone', () => {
    expect(actorLabelKey(SYSTEM_ACTOR)).toBe('complaints.actor.system')
    expect(actorLabelKey('Control Room')).toBe('complaints.actor.controlRoom')
    expect(actorLabelKey('Citizen · SMS')).toBe('complaints.actor.citizenSms')
    expect(actorLabelKey('Rafiqul Islam')).toBe('Rafiqul Islam')
  })

  it('slaLabelKey returns the key plus the hours to interpolate', () => {
    expect(slaLabelKey(sla({ remaining: 18 })))
      .toEqual({ key: 'complaints.sla.left', vars: { hours: 18 } })
    expect(slaLabelKey(sla({ remaining: -12, breached: true })))
      .toEqual({ key: 'complaints.sla.over', vars: { hours: 12 } })
    expect(slaLabelKey(sla({ active: false })))
      .toEqual({ key: 'complaints.sla.settled', vars: null })
  })
})

describe('nextStatus', () => {
  it('walks the lifecycle and stops at closed', () => {
    expect(nextStatus('open')).toBe('assigned')
    expect(nextStatus('assigned')).toBe('in_progress')
    expect(nextStatus('in_progress')).toBe('resolved')
    expect(nextStatus('resolved')).toBe('closed')
    expect(nextStatus('closed')).toBeNull()
  })
  it('returns null for an unknown status', () => {
    expect(nextStatus('nope')).toBeNull()
  })
  it('LIFECYCLE has the five expected states in order', () => {
    expect(LIFECYCLE).toEqual(['open', 'assigned', 'in_progress', 'resolved', 'closed'])
  })
})

describe('triageSort', () => {
  it('orders breached-active first, then by priority, then oldest', () => {
    const list = [
      ticket({
        id: 'settled', status: 'closed', priority: 'urgent', priorityRank: 3,
        opened: '2026-07-05T00:00:00Z',
        slaState: sla({ active: false, breached: false }),
      }),
      ticket({
        id: 'fresh-low', priority: 'low', priorityRank: 0, opened: '2026-07-06T11:00:00Z',
        slaState: sla({ budget: 48, elapsed: 1, remaining: 47 }),
      }),
      ticket({
        id: 'breached', priority: 'medium', priorityRank: 1, opened: '2026-07-04T00:00:00Z',
        slaState: sla({ elapsed: 36, remaining: -12, breached: true, pct: 100 }),
      }),
      ticket({
        id: 'urgent-ok', priority: 'urgent', priorityRank: 3, opened: '2026-07-06T11:00:00Z',
        slaState: sla({ budget: 4, elapsed: 1, remaining: 3 }),
      }),
    ]
    const ids = triageSort(list).map((c) => c.id)
    expect(ids[0]).toBe('breached')   // active + breached wins
    expect(ids[1]).toBe('urgent-ok')  // then highest priority active
    expect(ids[3]).toBe('settled')    // settled sinks to the bottom
  })

  it('falls back to the priority map when a row carries no priorityRank', () => {
    const list = [
      { id: 'low', status: 'open', priority: 'low', opened: '2026-07-06T00:00:00Z', slaState: sla() },
      { id: 'urgent', status: 'open', priority: 'urgent', opened: '2026-07-06T00:00:00Z', slaState: sla() },
    ]
    expect(triageSort(list).map((c) => c.id)).toEqual(['urgent', 'low'])
  })

  it('does not mutate the input array', () => {
    const list = [ticket({ id: 'a' }), ticket({ id: 'b' })]
    const copy = [...list]
    triageSort(list)
    expect(list).toEqual(copy)
  })
})
