import { describe, it, expect } from 'vitest'
import {
  tiers, tierLabel, tierCharge, effectiveCharge, optLabel,
  wards, roadsByWard, allRoads,
  collectors, households, potentialCustomers, vans,
  complaints, bills, visits, maintenance, fuelLogs,
  operators, dailyCollection, SEED, routes, assignments, payments, deposits,
  customerTypes, holdingTypes, storageTypes, suitableTimes, paymentModes, bloodGroups,
  potentialReasons, timeGaps, currentPractices,
} from './mockData.js'

describe('tier helpers', () => {
  it('returns the label for a known tier id', () => {
    expect(tierLabel('residential_standard')).toBe('Residential — standard')
    expect(tierLabel('commercial_large')).toBe('Commercial — large')
  })

  it('falls back to the raw id for an unknown tier label', () => {
    expect(tierLabel('does_not_exist')).toBe('does_not_exist')
  })

  it('returns the charge for a known tier id', () => {
    expect(tierCharge('residential_standard')).toBe(100)
    expect(tierCharge('commercial_large')).toBe(600)
  })

  it('returns 0 for an unknown tier charge', () => {
    expect(tierCharge('nope')).toBe(0)
  })

  it('every tier has a positive numeric charge and a label', () => {
    for (const t of tiers) {
      expect(typeof t.charge).toBe('number')
      expect(t.charge).toBeGreaterThan(0)
      expect(t.label.length).toBeGreaterThan(0)
    }
  })
})

describe('customer-information option lists', () => {
  const lists = {
    customerTypes, holdingTypes, storageTypes, suitableTimes, paymentModes,
    potentialReasons, timeGaps, currentPractices,
  }

  it('every list has unique ids and non-empty labels', () => {
    for (const [name, list] of Object.entries(lists)) {
      expect(list.length, name).toBeGreaterThan(0)
      expect(new Set(list.map((o) => o.id)).size, name).toBe(list.length)
      for (const o of list) expect(o.label.length, `${name}.${o.id}`).toBeGreaterThan(0)
    }
  })

  it('optLabel resolves a known id and falls back to the raw value', () => {
    expect(optLabel(customerTypes, 'residential')).toBe('Residential')
    expect(optLabel(customerTypes, 'nope')).toBe('nope')
    expect(optLabel(customerTypes, '')).toBe('—')
  })

  it('offers the eight blood groups', () => {
    expect(bloodGroups.length).toBe(8)
    expect(new Set(bloodGroups).size).toBe(8)
  })
})

describe('effectiveCharge', () => {
  it('uses the agreed charge when one is set', () => {
    expect(effectiveCharge({ tier: 'residential_standard', charge: 150 })).toBe(150)
  })

  it('falls back to the tier standard when no charge is agreed', () => {
    expect(effectiveCharge({ tier: 'residential_standard', charge: 0 })).toBe(100)
    expect(effectiveCharge({ tier: 'commercial_large' })).toBe(600)
  })

  it('reads the estimated tier of a potential customer', () => {
    expect(effectiveCharge({ estTier: 'residential_premium' })).toBe(300)
  })
})

describe('roads', () => {
  it('allRoads is the flattened set of every ward road', () => {
    const expected = Object.values(roadsByWard).flat()
    expect(allRoads).toEqual(expected)
  })

  it('has a road list for every ward', () => {
    for (const w of wards) {
      expect(Array.isArray(roadsByWard[w.id])).toBe(true)
      expect(roadsByWard[w.id].length).toBeGreaterThan(0)
    }
  })
})

describe('seed data integrity', () => {
  const wardIds = new Set(wards.map((w) => w.id))
  const collectorIds = new Set(collectors.map((c) => c.id))
  const householdIds = new Set(households.map((h) => h.id))
  const tierIds = new Set(tiers.map((t) => t.id))

  it('every collector is assigned to a real ward', () => {
    for (const c of collectors) expect(wardIds.has(c.zone)).toBe(true)
  })

  it('every household references a real ward and tier', () => {
    for (const h of households) {
      expect(wardIds.has(h.ward)).toBe(true)
      expect(tierIds.has(h.tier)).toBe(true)
    }
  })

  it('every household road belongs to its ward', () => {
    for (const h of households) {
      expect(roadsByWard[h.ward]).toContain(h.road)
    }
  })

  it('household ids are unique', () => {
    expect(householdIds.size).toBe(households.length)
  })

  it('every bill points at a household that exists', () => {
    for (const b of bills) expect(householdIds.has(b.hh)).toBe(true)
  })

  it('every visit points at a real household and collector', () => {
    for (const v of visits) {
      expect(householdIds.has(v.hh)).toBe(true)
      expect(collectorIds.has(v.collector)).toBe(true)
    }
  })

  it('every complaint references a real household, collector and ward', () => {
    for (const c of complaints) {
      expect(householdIds.has(c.hh)).toBe(true)
      expect(collectorIds.has(c.assigned)).toBe(true)
      expect(wardIds.has(c.ward)).toBe(true)
    }
  })

  it('every complaint has a valid priority and a non-empty activity trail', () => {
    const priorities = new Set(['urgent', 'high', 'medium', 'low'])
    for (const c of complaints) {
      expect(priorities.has(c.priority)).toBe(true)
      expect(Array.isArray(c.activity)).toBe(true)
      expect(c.activity.length).toBeGreaterThan(0)
      // the first logged event is always the ticket's creation
      expect(c.activity[0].action).toBe('created')
      for (const e of c.activity) {
        expect(typeof e.at).toBe('string')
        expect(typeof e.by).toBe('string')
      }
    }
  })

  it('every van driver is a real collector (or unassigned)', () => {
    for (const v of vans) {
      if (v.driver !== null) expect(collectorIds.has(v.driver)).toBe(true)
    }
  })

  it('maintenance and fuel logs reference real vans', () => {
    const vanIds = new Set(vans.map((v) => v.id))
    for (const m of maintenance) expect(vanIds.has(m.van)).toBe(true)
    for (const f of fuelLogs) expect(vanIds.has(f.van)).toBe(true)
  })

  it('potential customers reference a real ward and surveyor', () => {
    for (const p of potentialCustomers) {
      expect(wardIds.has(p.ward)).toBe(true)
      expect(collectorIds.has(p.surveyor)).toBe(true)
    }
  })

  it('every record carries the full customer-information profile', () => {
    const customerTypeIds = new Set(customerTypes.map((o) => o.id))
    const holdingTypeIds = new Set(holdingTypes.map((o) => o.id))
    const storageIds = new Set(storageTypes.map((o) => o.id))
    const timeIds = new Set(suitableTimes.map((o) => o.id))
    for (const r of [...households, ...potentialCustomers]) {
      expect(customerTypeIds.has(r.customerType), r.id).toBe(true)
      expect(holdingTypeIds.has(r.holdingType), r.id).toBe(true)
      expect(storageIds.has(r.storage), r.id).toBe(true)
      expect(timeIds.has(r.suitableTime), r.id).toBe(true)
      expect(bloodGroups).toContain(r.bloodGroup)
      expect(r.profession.length, r.id).toBeGreaterThan(0)
      expect(r.address.length, r.id).toBeGreaterThan(0)
      expect(r.floor.length, r.id).toBeGreaterThan(0)
      expect(effectiveCharge(r)).toBeGreaterThan(0)
    }
  })

  it('only under-service households carry payment terms', () => {
    const modeIds = new Set(paymentModes.map((o) => o.id))
    for (const h of households) {
      expect(modeIds.has(h.paymentMode), h.id).toBe(true)
      expect(h.paymentDay).toBeGreaterThanOrEqual(1)
      expect(h.paymentDay).toBeLessThanOrEqual(28)
    }
    // nothing is billed until a holding is brought under service
    for (const p of potentialCustomers) {
      expect(p.paymentMode, p.id).toBeUndefined()
      expect(p.paymentDay, p.id).toBeUndefined()
      expect(p.charge, p.id).toBeUndefined()
    }
  })

  it('member counts are consistent — sub-counts never exceed the total', () => {
    for (const r of [...households, ...potentialCustomers]) {
      expect(r.membersUnder5, r.id).toBeLessThanOrEqual(r.members)
      expect(r.membersFemale, r.id).toBeLessThanOrEqual(r.members)
    }
  })

  it('potential customers carry the "to be customer" survey answers', () => {
    const reasonIds = new Set(potentialReasons.map((o) => o.id))
    const gapIds = new Set(timeGaps.map((o) => o.id))
    const practiceIds = new Set(currentPractices.map((o) => o.id))
    for (const p of potentialCustomers) {
      expect(reasonIds.has(p.reason), p.id).toBe(true)
      expect(gapIds.has(p.timeGap), p.id).toBe(true)
      expect(practiceIds.has(p.currentPractice), p.id).toBe(true)
    }
  })
})

describe('deterministic generated data', () => {
  it('generates exactly 4 extra households per ward', () => {
    // Generated homes get ids of the form HH-KCC-05NNN (see generateExtra()).
    const generated = households.filter((h) => /^HH-KCC-05\d{3}$/.test(h.id))
    expect(generated.length).toBe(Object.keys(roadsByWard).length * 4)
  })

  it('every generated visit status is collected or skipped', () => {
    for (const v of visits) expect(['collected', 'skipped']).toContain(v.status)
  })

  it('bill amounts are non-negative numbers', () => {
    for (const b of bills) {
      expect(typeof b.amount).toBe('number')
      expect(b.amount).toBeGreaterThanOrEqual(0)
    }
  })
})

describe('operators (login directory)', () => {
  it('holds the four demo accounts with distinct phone numbers', () => {
    const phones = new Set(operators.map((o) => o.phone))
    expect(phones.size).toBe(operators.length)
    expect(operators.length).toBeGreaterThanOrEqual(4)
  })

  it('phone numbers are normalized (digits only, no +88)', () => {
    for (const o of operators) expect(o.phone).toMatch(/^\d+$/)
  })
})

describe('daily collection series', () => {
  it('has 30 days of city-wide totals', () => {
    expect(dailyCollection.length).toBe(30)
  })

  it('served never exceeds scheduled and collected never exceeds billed', () => {
    for (const d of dailyCollection) {
      expect(d.served).toBeLessThanOrEqual(d.scheduled)
      expect(d.collected).toBeLessThanOrEqual(d.billed)
    }
  })

  it('dates are in ascending order', () => {
    const dates = dailyCollection.map((d) => d.date)
    expect([...dates].sort()).toEqual(dates)
  })
})

describe('SEED bundle', () => {
  it('exposes every editable collection the store hydrates', () => {
    expect(Object.keys(SEED).sort()).toEqual(
      ['assignments', 'bills', 'collectors', 'complaints', 'deposits', 'fuelLogs', 'households', 'maintenance', 'payments', 'potentialCustomers', 'routes', 'vans', 'visits'].sort(),
    )
  })
})

describe('location verification', () => {
  it('a verified household has real coordinates and an audit trail', () => {
    for (const h of households.filter((x) => x.verified)) {
      expect(typeof h.lat, h.id).toBe('number')
      expect(typeof h.lng, h.id).toBe('number')
      expect(h.verifiedAt, h.id).toBeTruthy()
      expect(h.verifiedBy, h.id).toBeTruthy()
    }
  })

  it('an unverified household carries no coordinates to be trusted', () => {
    const pending = households.filter((h) => !h.verified)
    expect(pending.length).toBeGreaterThan(0) // the queue must be demonstrable
    for (const h of pending) {
      expect(h.lat, h.id).toBeNull()
      expect(h.lng, h.id).toBeNull()
      expect(h.verifiedAt, h.id).toBeNull()
    }
  })

  it('a surveyed potential customer is never pre-verified', () => {
    for (const p of potentialCustomers) expect(p.verified, p.id).toBe(false)
  })
})

describe('route plan', () => {
  const householdIds = new Set(households.map((h) => h.id))
  const collectorIds = new Set(collectors.map((c) => c.id))
  const routeIds = new Set(routes.map((r) => r.id))

  it('every route is named, belongs to a real ward and has a window', () => {
    expect(routes.length).toBeGreaterThan(0)
    for (const r of routes) {
      expect(r.name.length, r.id).toBeGreaterThan(0)
      expect(wards.some((w) => w.id === r.ward), r.id).toBe(true)
      expect(r.window, r.id).toMatch(/^\d{2}:\d{2}–\d{2}:\d{2}$/)
    }
  })

  it('route ids are unique', () => {
    expect(routeIds.size).toBe(routes.length)
  })

  it('every planned stop is a household that exists', () => {
    for (const r of routes) {
      expect(r.stops.length, r.id).toBeGreaterThan(0)
      for (const id of r.stops) expect(householdIds.has(id), `${r.id} → ${id}`).toBe(true)
    }
  })

  // The rule the planner works to: a holding sits on exactly one route.
  it('no household appears on more than one route', () => {
    const all = routes.flatMap((r) => r.stops)
    expect(new Set(all).size).toBe(all.length)
  })

  it('only verified households are planned', () => {
    const verified = new Set(households.filter((h) => h.verified).map((h) => h.id))
    for (const r of routes) {
      for (const id of r.stops) expect(verified.has(id), `${r.id} → ${id} is unverified`).toBe(true)
    }
  })

  it('every stop on a route sits in that same ward', () => {
    const wardOf = new Map(households.map((h) => [h.id, h.ward]))
    for (const r of routes) {
      for (const id of r.stops) expect(wardOf.get(id), `${r.id} → ${id}`).toBe(r.ward)
    }
  })
})

describe('collector assignments', () => {
  const collectorIds = new Set(collectors.map((c) => c.id))
  const routeIds = new Set(routes.map((r) => r.id))

  it('every assignment names a real collector and real routes', () => {
    expect(assignments.length).toBeGreaterThan(0)
    for (const a of assignments) {
      expect(collectorIds.has(a.collector), a.id).toBe(true)
      expect(Array.isArray(a.routes), a.id).toBe(true)
      for (const id of a.routes) expect(routeIds.has(id), `${a.id} → ${id}`).toBe(true)
    }
  })

  it('gives each collector at most one active assignment', () => {
    const active = assignments.filter((a) => a.active !== false).map((a) => a.collector)
    expect(new Set(active).size).toBe(active.length)
  })

  // Two collectors sent down the same road is the failure this guards against.
  it('no route is handed to two collectors', () => {
    const held = assignments.filter((a) => a.active !== false).flatMap((a) => a.routes)
    expect(new Set(held).size).toBe(held.length)
  })

  it('every route is walked by someone', () => {
    const held = new Set(assignments.flatMap((a) => a.routes))
    for (const r of routes) expect(held.has(r.id), `${r.id} is unassigned`).toBe(true)
  })

  // The case the daily round has to cope with: more roads than collectors.
  it('at least one collector holds more than one route', () => {
    expect(assignments.some((a) => a.routes.length > 1)).toBe(true)
  })

  it('never assigns work to an off-route collector', () => {
    const offRoute = new Set(collectors.filter((c) => c.status === 'off_route').map((c) => c.id))
    for (const a of assignments) expect(offRoute.has(a.collector), a.id).toBe(false)
  })
})

describe('operational history', () => {
  const householdIds = new Set(households.map((h) => h.id))
  const collectorIds = new Set(collectors.map((c) => c.id))
  const billIds = new Set(bills.map((b) => b.id))
  // The mock stamps visits with the *local* date (`isoDay`, built from
  // getFullYear/getMonth/getDate). Comparing against `toISOString()` compares
  // against UTC, and Dhaka is UTC+6 — so between midnight and 6am the local
  // date is a day ahead and every visit looked like it was in the future.
  const now = new Date()
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

  it('carries enough service history for a daily, weekly, monthly and yearly view', () => {
    const days = new Set(visits.map((v) => v.at.slice(0, 10)))
    const months = new Set(bills.map((b) => b.period))
    const years = new Set(bills.map((b) => b.period.slice(0, 4)))
    expect(days.size).toBeGreaterThan(60)
    expect(months.size).toBeGreaterThanOrEqual(13)
    // a yearly report needs at least two years to compare
    expect(years.size).toBeGreaterThanOrEqual(2)
  })

  // The history rolls with the clock — a demo frozen on a fixed date drifts
  // further into the past every day it is not looked at.
  it('runs up to today, so the daily round has work in it', () => {
    expect(visits.some((v) => v.at.slice(0, 10) === today)).toBe(true)
    expect(visits.every((v) => v.at.slice(0, 10) <= today)).toBe(true)
  })

  it('every visit points at a real household and collector', () => {
    for (const v of visits) {
      expect(householdIds.has(v.hh), v.id).toBe(true)
      expect(collectorIds.has(v.collector), v.id).toBe(true)
      expect(['collected', 'skipped']).toContain(v.status)
    }
  })

  it('visit ids are unique', () => {
    expect(new Set(visits.map((v) => v.id)).size).toBe(visits.length)
  })

  it('a skipped visit records why, and claims no GPS accuracy', () => {
    for (const v of visits.filter((x) => x.status === 'skipped')) {
      expect(v.reason, v.id).toBeTruthy()
      expect(v.accuracy, v.id).toBeNull()
    }
  })

  it('every bill points at a real household and has a positive amount', () => {
    for (const b of bills) {
      expect(householdIds.has(b.hh), b.id).toBe(true)
      expect(b.amount, b.id).toBeGreaterThan(0)
      expect(b.period, b.id).toMatch(/^\d{4}-\d{2}$/)
    }
  })

  it('bill ids are unique — one bill per household per month', () => {
    expect(billIds.size).toBe(bills.length)
  })

  it('every payment points at a real bill, household and collector', () => {
    for (const p of payments) {
      expect(billIds.has(p.bill), p.id).toBe(true)
      expect(householdIds.has(p.hh), p.id).toBe(true)
      expect(collectorIds.has(p.collector), p.id).toBe(true)
      expect(p.amount, p.id).toBeGreaterThan(0)
    }
  })

  // A household cannot pay more than it was billed.
  it('no bill is over-settled', () => {
    const billed = new Map(bills.map((b) => [b.id, b.amount]))
    const received = {}
    payments.forEach((p) => { received[p.bill] = (received[p.bill] || 0) + p.amount })
    for (const [id, sum] of Object.entries(received)) {
      expect(sum, id).toBeLessThanOrEqual(billed.get(id))
    }
  })

  it('the stored status agrees with what was actually received', () => {
    const received = {}
    payments.forEach((p) => { received[p.bill] = (received[p.bill] || 0) + p.amount })
    for (const b of bills) {
      const got = received[b.id] || 0
      if (b.status === 'paid') expect(got, b.id).toBe(b.amount)
      if (b.status === 'partial') { expect(got).toBeGreaterThan(0); expect(got).toBeLessThan(b.amount) }
      if (b.status === 'unpaid' || b.status === 'overdue') expect(got, b.id).toBe(0)
    }
  })

  it('covers all four settlement states, so the status report has something to show', () => {
    const states = new Set(bills.map((b) => b.status))
    for (const s of ['paid', 'partial', 'unpaid', 'overdue']) expect(states.has(s), s).toBe(true)
  })

  it('every deposit names a real collector and never exceeds what they took', () => {
    const taken = {}
    payments.forEach((p) => {
      const k = `${p.collector}|${p.at.slice(0, 7)}|${p.method}`
      taken[k] = (taken[k] || 0) + p.amount
    })
    for (const d of deposits) {
      expect(collectorIds.has(d.collector), d.id).toBe(true)
      expect(d.amount, d.id).toBeGreaterThan(0)
      expect(d.amount, d.id).toBeLessThanOrEqual(taken[`${d.collector}|${d.period}|${d.method}`] || 0)
    }
  })

  // Reconciliation only earns its place if some hand-ins do not balance.
  it('leaves some cash unreconciled, which is the point of the report', () => {
    const taken = {}
    payments.forEach((p) => {
      const k = `${p.collector}|${p.at.slice(0, 7)}|${p.method}`
      taken[k] = (taken[k] || 0) + p.amount
    })
    const handed = {}
    deposits.forEach((d) => { handed[`${d.collector}|${d.period}|${d.method}`] = d.amount })
    const shortfalls = Object.entries(taken).filter(([k, amount]) => (handed[k] || 0) < amount)
    expect(shortfalls.length).toBeGreaterThan(0)
  })
})
