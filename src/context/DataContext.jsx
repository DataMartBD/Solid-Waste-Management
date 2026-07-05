import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react'
import { SEED } from '../data/mockData.js'

const DataContext = createContext(null)
const STORAGE_KEY = 'swms.db'
// Bump when the seed data shape/content changes so stale saved copies are discarded.
const SEED_VERSION = 3

// Simple id generator per collection.
let counter = 0
export function genId(prefix) {
  counter += 1
  return `${prefix}-${Date.now().toString(36).toUpperCase().slice(-5)}${counter}`
}

export function DataProvider({ children }) {
  const [db, setDb] = useState(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw)
        // Only reuse the saved copy if it matches the current seed version.
        if (parsed && parsed.__v === SEED_VERSION && parsed.data) {
          return { ...structuredClone(SEED), ...parsed.data }
        }
      }
    } catch { /* ignore */ }
    return structuredClone(SEED)
  })

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ __v: SEED_VERSION, data: db })) } catch { /* ignore */ }
  }, [db])

  // Insert or update by id. Returns nothing; state updates trigger re-render.
  const upsert = useCallback((coll, item) => {
    setDb((prev) => {
      const list = prev[coll] || []
      const idx = list.findIndex((r) => r.id === item.id)
      const next = idx >= 0
        ? list.map((r) => (r.id === item.id ? { ...r, ...item } : r))
        : [item, ...list]
      return { ...prev, [coll]: next }
    })
  }, [])

  const remove = useCallback((coll, id) => {
    setDb((prev) => ({ ...prev, [coll]: (prev[coll] || []).filter((r) => r.id !== id) }))
  }, [])

  const resetDb = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY)
    setDb(structuredClone(SEED))
  }, [])

  // lookup helpers reflect live state
  const helpers = useMemo(() => ({
    collectorName: (id) => db.collectors.find((c) => c.id === id)?.name || id || '—',
    vanById: (id) => db.vans.find((v) => v.id === id),
    householdById: (id) => db.households.find((h) => h.id === id),
    vanForDriver: (id) => db.vans.find((v) => v.driver === id),
  }), [db])

  const value = useMemo(() => ({ ...db, upsert, remove, resetDb, ...helpers }),
    [db, upsert, remove, resetDb, helpers])

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>
}

export const useData = () => useContext(DataContext)
