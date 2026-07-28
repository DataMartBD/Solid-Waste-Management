import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import * as api from '../api/endpoints.js'
import { ApiError } from '../api/client.js'
import { useAuth } from './AuthContext.jsx'
import {
  EMPTY_CATALOG, effectiveCharge as computeCharge, optLabel,
  tierCharge as lookupCharge, tierLabel as lookupTier, wardName as lookupWard, wardShort, zoneName,
} from '../data/reference.js'

const DataContext = createContext(null)

// The collections the app mirrors in memory. Small ones (households, routes,
// staff) are genuinely needed everywhere; the large ones (visits, bills,
// payments) are loaded because the Reports screens compute over the full set.
// Anything that grows past a demo-sized dataset should move to a server-side
// aggregate — those endpoints already exist under /api/reports/.
const COLLECTIONS = Object.keys(api.RESOURCES)

const EMPTY_DB = COLLECTIONS.reduce((acc, name) => ({ ...acc, [name]: [] }), {})

// Ids are assigned by the database now — `create` strips whatever the caller
// supplied. This remains only so a form can key a not-yet-saved draft row; never
// persist or display the result, and never expect the saved record to carry it.
let draftCounter = 0
export function genId(prefix) {
  draftCounter += 1
  return `${prefix}-draft-${draftCounter}`
}

// Deleting a row cascades server-side (a household's visits and bills go with
// it, a collector's assignment is removed, a route is unlinked). Rather than
// replicate those rules in the browser, refetch what the delete could have
// touched.
const RELOAD_AFTER_REMOVE = {
  households: ['households', 'routes', 'visits', 'bills', 'payments', 'complaints'],
  potentialCustomers: ['potentialCustomers'],
  collectors: ['collectors', 'assignments', 'vans', 'complaints', 'visits'],
  routes: ['routes', 'assignments'],
  assignments: ['assignments'],
  vans: ['vans', 'maintenance', 'fuelLogs'],
  complaints: ['complaints'],
  visits: ['visits'],
  bills: ['bills', 'payments', 'households'],
  payments: ['payments', 'bills', 'households'],
  deposits: ['deposits'],
  maintenance: ['maintenance', 'vans'],
  fuelLogs: ['fuelLogs', 'vans'],
}

export function DataProvider({ children }) {
  const { user, ready: authReady } = useAuth()
  const [db, setDb] = useState(EMPTY_DB)
  const [catalog, setCatalog] = useState(EMPTY_CATALOG)
  const [loading, setLoading] = useState(false)
  const [ready, setReady] = useState(false)
  const [lastError, setLastError] = useState(null)

  // Guards against a late response from a previous user overwriting the current
  // one's data after a logout/login.
  const sessionRef = useRef(0)

  const fetchCollection = useCallback(async (name) => {
    const rows = await api[name].list()
    return [name, rows]
  }, [])

  const loadAll = useCallback(async () => {
    const session = ++sessionRef.current
    setLoading(true)
    setLastError(null)
    try {
      const [catalogData, ...pairs] = await Promise.all([
        api.catalog.load(),
        ...COLLECTIONS.map(fetchCollection),
      ])
      if (session !== sessionRef.current) return
      setCatalog({ ...EMPTY_CATALOG, ...catalogData })
      setDb(Object.fromEntries(pairs))
      setReady(true)
    } catch (error) {
      if (session !== sessionRef.current) return
      setLastError(error)
      setReady(true)
    } finally {
      if (session === sessionRef.current) setLoading(false)
    }
  }, [fetchCollection])

  // Load once signed in; drop everything on sign-out so the next user never sees
  // a flash of the previous one's rows.
  useEffect(() => {
    if (!authReady) return
    if (!user) {
      sessionRef.current += 1
      setDb(EMPTY_DB)
      setCatalog(EMPTY_CATALOG)
      setReady(false)
      return
    }
    loadAll()
  }, [authReady, user, loadAll])

  const reload = useCallback(async (...names) => {
    const wanted = names.flat().filter((name) => COLLECTIONS.includes(name))
    if (!wanted.length) return
    try {
      const pairs = await Promise.all(wanted.map(fetchCollection))
      setDb((prev) => ({ ...prev, ...Object.fromEntries(pairs) }))
    } catch (error) {
      setLastError(error)
    }
  }, [fetchCollection])

  // --- writes -------------------------------------------------------------
  //
  // Every mutation returns `{ ok, data, error }` rather than throwing. Pages call
  // these without awaiting in places, and an unhandled rejection there would
  // take out the whole view; a failed write instead surfaces through `lastError`.

  const applyRecord = useCallback((name, record) => {
    setDb((prev) => {
      const rows = prev[name] || []
      const index = rows.findIndex((row) => row.id === record.id)
      const next = index >= 0
        ? rows.map((row) => (row.id === record.id ? { ...row, ...record } : row))
        : [record, ...rows]
      return { ...prev, [name]: next }
    })
  }, [])

  const fail = useCallback((error) => {
    setLastError(error)
    return { ok: false, error, data: null }
  }, [])

  // Some resources deliberately have no generic write: a bill comes from a
  // billing run, a payment cannot be edited after the fact. Say so clearly
  // instead of failing with a TypeError.
  const method = useCallback((name, verb) => {
    const fn = api[name]?.[verb]
    if (typeof fn === 'function') return fn
    throw new ApiError({
      status: 405,
      code: 'unsupported',
      detail: `${name} does not support ${verb} — use the dedicated action instead.`,
    })
  }, [])

  const create = useCallback(async (name, body) => {
    try {
      // The server assigns ids, so a client-side placeholder is dropped.
      const { id: _draftId, ...payload } = body || {}
      const record = await method(name, 'create')(payload)
      applyRecord(name, record)
      return { ok: true, data: record, error: null }
    } catch (error) { return fail(error) }
  }, [applyRecord, fail, method])

  const update = useCallback(async (name, id, changes) => {
    try {
      const record = await method(name, 'update')(id, changes)
      applyRecord(name, record)
      return { ok: true, data: record, error: null }
    } catch (error) { return fail(error) }
  }, [applyRecord, fail, method])

  // Kept for call-site compatibility: an id the browser already knows means an
  // update, anything else is a create.
  const upsert = useCallback(async (name, item) => {
    const known = (db[name] || []).some((row) => row.id === item?.id)
    return known ? update(name, item.id, item) : create(name, item)
  }, [db, create, update])

  const remove = useCallback(async (name, id) => {
    try {
      await method(name, 'remove')(id)
      setDb((prev) => ({ ...prev, [name]: (prev[name] || []).filter((row) => row.id !== id) }))
      // Pick up whatever the server's cascade changed.
      await reload(RELOAD_AFTER_REMOVE[name] || [name])
      return { ok: true, data: null, error: null }
    } catch (error) { return fail(error) }
  }, [reload, fail, method])

  // Run a server action (verify, convert, pay, assign…) and fold the result back
  // into local state without a full refetch.
  const act = useCallback(async (promise, { apply = [], refresh = [] } = {}) => {
    try {
      const data = await promise
      apply.forEach(([name, record]) => { if (record) applyRecord(name, record) })
      if (refresh.length) await reload(refresh)
      return { ok: true, data, error: null }
    } catch (error) { return fail(error) }
  }, [applyRecord, reload, fail])

  // --- lookups ------------------------------------------------------------

  const helpers = useMemo(() => ({
    collectorName: (id) => db.collectors.find((row) => row.id === id)?.name || id || '—',
    collectorById: (id) => db.collectors.find((row) => row.id === id),
    vanById: (id) => db.vans.find((row) => row.id === id),
    householdById: (id) => db.households.find((row) => row.id === id),
    vanForDriver: (id) => db.vans.find((row) => row.driver === id),
    routeById: (id) => db.routes.find((row) => row.id === id),
    billById: (id) => db.bills.find((row) => row.id === id),
  }), [db])

  const reference = useMemo(() => ({
    ...catalog,
    // roadsByWard is an object; flatten it once for the "any road" pickers.
    allRoads: Object.values(catalog.roadsByWard || {}).flat(),
    tierLabel: (id) => lookupTier(catalog.tiers, id),
    tierCharge: (id) => lookupCharge(catalog.tiers, id),
    effectiveCharge: (holding) => computeCharge(catalog.tiers, holding),
    wardName: (id) => lookupWard(catalog.wards, id),
    wardShort: (id) => wardShort(catalog.wards, id),
    zoneName: (id) => zoneName(catalog.zones, id),
    optLabel,
  }), [catalog])

  const value = useMemo(() => ({
    ...db,
    ...reference,
    ...helpers,
    catalog,
    loading, ready, lastError,
    clearError: () => setLastError(null),
    refresh: loadAll,
    reload,
    create, update, upsert, remove, act,
    // The raw endpoint module, for the calls that are not plain CRUD.
    api,
  }), [db, reference, helpers, catalog, loading, ready, lastError, loadAll, reload, create, update, upsert, remove, act])

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>
}

export const useData = () => useContext(DataContext)

// Re-exported so pages can narrow on the error type without importing the client.
export { ApiError }
