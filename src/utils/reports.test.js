// What remains of the browser-side reporting helpers.
//
// The report builders these tests used to cover (wasteCollectionReport,
// billCollectionReport, billStatusReport, reconciliationReport, the two customer
// reports and their plannedOwners / settlementOf helpers) now live in
// server/swms/reports/aggregates.py and are tested there against the database.
// Testing a re-implementation here would only prove that the copy still agrees
// with itself.

import { describe, it, expect } from 'vitest'
import {
  REPORT_MODES, BILL_STATES, isoWeek, periodKey, totalsOf, stateTally,
} from './reports.js'

describe('report modes and states', () => {
  it('offers daily, weekly, monthly and yearly', () => {
    expect(REPORT_MODES).toEqual(['daily', 'weekly', 'monthly', 'yearly'])
  })

  // The order is the order the summary strip renders; the set must match the
  // server's BILL_STATES or a state would arrive with nowhere to be counted.
  it('names the four settlement states', () => {
    expect(BILL_STATES).toEqual(['paid', 'partial', 'unpaid', 'overdue'])
  })
})

describe('period bucketing', () => {
  it('buckets a timestamp by the chosen granularity', () => {
    const at = '2026-07-05T06:14:00Z'
    expect(periodKey(at, 'daily')).toBe('2026-07-05')
    expect(periodKey(at, 'weekly')).toBe('2026-W27')
    expect(periodKey(at, 'monthly')).toBe('2026-07')
    expect(periodKey(at, 'yearly')).toBe('2026')
  })

  it('defaults to a monthly bucket', () => {
    expect(periodKey('2026-07-05')).toBe('2026-07')
  })

  it('returns null for anything that is not a date', () => {
    expect(periodKey(null, 'daily')).toBeNull()
    expect(periodKey('not-a-date', 'monthly')).toBeNull()
    expect(periodKey('', 'yearly')).toBeNull()
    expect(isoWeek('not-a-date')).toBeNull()
  })

  it('labels an ISO week Monday-first', () => {
    // 2026-06-29 is the Monday that opens week 27; the Sunday that closes it is
    // still the same week.
    expect(isoWeek('2026-06-29')).toBe('2026-W27')
    expect(isoWeek('2026-07-05')).toBe('2026-W27')
    expect(isoWeek('2026-07-06')).toBe('2026-W28')
  })

  // The ISO year is not the calendar year at the turn of the year, and getting
  // this wrong silently splits one week across two buckets.
  it('keeps the ISO year, which can differ from the calendar year', () => {
    expect(isoWeek('2026-01-01')).toBe('2026-W01')
    expect(isoWeek('2027-01-01')).toBe('2026-W53')
  })
})

describe('totals of the rows on screen', () => {
  const rows = [
    { billed: 100, received: 40, outstanding: 60 },
    { billed: 300, received: 300, outstanding: 0 },
  ]

  it('sums the money fields and derives the rate', () => {
    expect(totalsOf(rows)).toMatchObject({ count: 2, billed: 400, received: 340, outstanding: 60, rate: 85 })
  })

  it('sums whichever fields it is asked for', () => {
    const stops = [{ served: 3, skipped: 1 }, { served: 5, skipped: 0 }]
    expect(totalsOf(stops, ['served', 'skipped'])).toMatchObject({ served: 8, skipped: 1, count: 2 })
  })

  // An empty filter result is a normal state — a report for a month with no
  // bills must not report NaN%.
  it('reports a zero rate rather than dividing by zero', () => {
    expect(totalsOf([])).toMatchObject({ count: 0, billed: 0, received: 0, rate: 0 })
  })

  it('treats a missing or non-numeric field as zero', () => {
    expect(totalsOf([{ billed: '120', received: null }])).toMatchObject({ billed: 120, received: 0, outstanding: 0 })
  })

  // Totalling stops asks for fields that have no `received` at all; the rate must
  // still be a number rather than NaN%.
  it('never reports NaN when the money pair is not among the fields', () => {
    expect(totalsOf([{ billed: 50, served: 2 }], ['billed', 'served']).rate).toBe(0)
  })
})

describe('settlement tally', () => {
  it('counts the bills in each state', () => {
    const rows = [{ state: 'paid' }, { state: 'partial' }, { state: 'overdue' }, { state: 'paid' }]
    expect(stateTally(rows)).toEqual({ paid: 2, partial: 1, unpaid: 0, overdue: 1 })
  })

  // Every state is always present, so the summary strip renders four cards even
  // for a month where nothing has been paid.
  it('always reports all four states', () => {
    expect(Object.keys(stateTally([])).sort()).toEqual([...BILL_STATES].sort())
  })

  it('ignores a row whose state it does not recognise', () => {
    expect(stateTally([{ state: 'written_off' }, { state: 'paid' }])).toEqual({
      paid: 1, partial: 0, unpaid: 0, overdue: 0,
    })
  })
})
