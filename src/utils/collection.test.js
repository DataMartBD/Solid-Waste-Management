import { describe, it, expect } from 'vitest'
import {
  orderStops, countByStatus, VISIT_STATUS, SKIP_REASONS, isRoutable,
  assignmentFor, routesForCollector, collectorForRoute, dayOf, today,
} from './collection.js'

describe('routes and assignments', () => {
  const routes = [
    { id: 'RT-A', name: 'KDA Avenue', ward: 'W-14', stops: ['HH-1'], active: true },
    { id: 'RT-B', name: 'Majid Sarani', ward: 'W-14', stops: ['HH-2'], active: true },
    { id: 'RT-OLD', name: 'Retired', ward: 'W-14', stops: [], active: false },
  ]
  const assignments = [
    { id: 'AS-1', collector: 'C-01', routes: ['RT-A', 'RT-B', 'RT-OLD'], active: true },
    { id: 'AS-2', collector: 'C-02', routes: ['RT-X'], active: false },
  ]

  it('finds only an active assignment for a collector', () => {
    expect(assignmentFor('C-01', assignments).id).toBe('AS-1')
    expect(assignmentFor('C-02', assignments)).toBeNull()
    expect(assignmentFor('C-01')).toBeNull()
  })

  it('lists the live routes a collector holds, in assignment order', () => {
    expect(routesForCollector('C-01', { routes, assignments }).map((r) => r.id)).toEqual(['RT-A', 'RT-B'])
    expect(routesForCollector('C-99', { routes, assignments })).toEqual([])
  })

  it('tolerates missing collections instead of throwing', () => {
    expect(routesForCollector('C-01', {})).toEqual([])
    expect(routesForCollector('C-01', { assignments })).toEqual([])
  })

  it('resolves which collector walks a route', () => {
    expect(collectorForRoute('RT-A', assignments)).toBe('C-01')
    expect(collectorForRoute('RT-UNHELD', assignments)).toBeNull()
    // an inactive assignment does not claim its routes
    expect(collectorForRoute('RT-X', assignments)).toBeNull()
    expect(collectorForRoute('RT-A')).toBeNull()
  })
})

describe('routability', () => {
  it('only a verified household may be planned into a round', () => {
    expect(isRoutable({ id: 'HH-1', verified: true })).toBe(true)
    expect(isRoutable({ id: 'HH-3', verified: false })).toBe(false)
    expect(isRoutable(undefined)).toBe(false)
  })
})

describe('orderStops', () => {
  it('puts actioned stops first, then pending ones by holding number', () => {
    const ordered = orderStops([
      { holding: '11', visitStatus: 'pending' },
      { holding: '2', visitStatus: 'pending' },
      { holding: '9', visitStatus: 'collected', at: '2026-07-05T06:20:00Z' },
      { holding: '7', visitStatus: 'collected', at: '2026-07-05T06:10:00Z' },
    ])
    expect(ordered.map((s) => s.holding)).toEqual(['7', '9', '2', '11'])
  })

  // The planner's "sort by holding number" runs this over plain household rows,
  // which carry no visit state at all.
  it('sorts records with no visit state by holding, numerically', () => {
    const ordered = orderStops([{ holding: '11' }, { holding: '2' }, { holding: '9' }])
    expect(ordered.map((s) => s.holding)).toEqual(['2', '9', '11'])
  })

  // An intransitive comparator gave different results for the same set
  // depending on the order it arrived in.
  it('is a total order — input order cannot change the result', () => {
    const a = { holding: '9', visitStatus: 'collected', at: '2026-07-05T06:10:00Z' }
    const b = { holding: '5', visitStatus: 'collected', at: null }
    const c = { holding: '1', visitStatus: 'collected', at: '2026-07-05T06:20:00Z' }
    const ids = (arr) => orderStops(arr).map((s) => s.holding)
    expect(ids([a, b, c])).toEqual(ids([c, b, a]))
    expect(ids([a, b, c])).toEqual(ids([b, a, c]))
  })

  it('leaves the array it was given untouched', () => {
    const input = [{ holding: '11' }, { holding: '2' }]
    orderStops(input)
    expect(input.map((s) => s.holding)).toEqual(['11', '2'])
  })
})

describe('countByStatus', () => {
  it('counts each state of the round', () => {
    expect(countByStatus([
      { visitStatus: 'collected' }, { visitStatus: 'collected' },
      { visitStatus: 'skipped' }, { visitStatus: 'pending' },
    ])).toEqual({ all: 4, collected: 2, pending: 1, skipped: 1 })
  })

  it('handles an empty round', () => {
    expect(countByStatus([])).toEqual({ all: 0, collected: 0, pending: 0, skipped: 0 })
  })

  // The buckets have to add up, or a caller has to compute one by subtraction
  // to stay honest — which is what Collection.jsx was doing.
  it('buckets always sum to all, whatever the status says', () => {
    const counts = countByStatus([
      { visitStatus: 'collected' }, { visitStatus: 'skipped' },
      { visitStatus: 'pending' }, { visitStatus: 'something-else' },
    ])
    expect(counts.collected + counts.skipped + counts.pending).toBe(counts.all)
    expect(counts.pending).toBe(2)
  })
})

describe('day helpers', () => {
  it('defaults to today, and dayOf reads the date out of a timestamp', () => {
    expect(today()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(dayOf('2026-07-05T06:14:00Z')).toBe('2026-07-05')
    expect(dayOf(null)).toBe('')
  })
})

describe('shared vocabularies', () => {
  it('names the three visit states the UI renders', () => {
    expect(VISIT_STATUS).toEqual({ collected: 'collected', skipped: 'skipped', pending: 'pending' })
  })

  // These ids are sent to the server as Visit.reason and are looked up as
  // `collection.skip.<id>` — a rename in either place breaks the other.
  it('lists the skip reasons the server accepts', () => {
    expect(SKIP_REASONS).toEqual(['noOne', 'noWaste', 'locked', 'access', 'refused'])
  })
})
