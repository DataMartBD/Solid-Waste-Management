// One place that knows the shape of the API.
//
// Pages never build a URL: they call these functions. That keeps path changes to
// a single file and makes it obvious which server actions exist — several
// operations are deliberately NOT plain field updates (a complaint's status, a
// bill's payment, a route's stop order) because each one writes an audit trail or
// enforces a rule server-side.

import { del, download, get, list, patch, post, request } from './client.js'

// Collections the app mirrors in memory, mapped to their REST resource.
// DataContext uses this map for generic create/update/delete.
export const RESOURCES = {
  households: '/households/',
  potentialCustomers: '/potential-customers/',
  collectors: '/collectors/',
  routes: '/routes/',
  assignments: '/assignments/',
  vans: '/vans/',
  complaints: '/complaints/',
  bills: '/bills/',
  payments: '/payments/',
  deposits: '/deposits/',
  visits: '/visits/',
  maintenance: '/maintenance/',
  fuelLogs: '/fuel-logs/',
}

export const catalog = {
  load: () => get('/catalog/'),
}

export const households = {
  list: (params) => list('/households/', params),
  get: (id) => get(`/households/${id}/`),
  create: (body) => post('/households/', body),
  update: (id, body) => patch(`/households/${id}/`, body),
  remove: (id) => del(`/households/${id}/`),
  verify: (id, body) => post(`/households/${id}/verify/`, body),
  unplanned: (params) => get('/households/unplanned/', params),
  byQr: (tag) => get(`/households/by-qr/${encodeURIComponent(tag)}/`),
}

export const potentialCustomers = {
  list: (params) => list('/potential-customers/', params),
  create: (body) => post('/potential-customers/', body),
  update: (id, body) => patch(`/potential-customers/${id}/`, body),
  remove: (id) => del(`/potential-customers/${id}/`),
  verify: (id, body) => post(`/potential-customers/${id}/verify/`, body),
  // Returns { household, potential } — the new customer and the closed survey.
  convert: (id, body) => post(`/potential-customers/${id}/convert/`, body || {}),
}

export const collectors = {
  list: (params) => list('/collectors/', params),
  create: (body) => post('/collectors/', body),
  update: (id, body) => patch(`/collectors/${id}/`, body),
  remove: (id) => del(`/collectors/${id}/`),
  attendance: (id, attendance) => post(`/collectors/${id}/attendance/`, { attendance }),
  refreshMetrics: (days) => post('/collectors/refresh-metrics/', { days }),
}

export const routes = {
  list: (params) => list('/routes/', params),
  create: (body) => post('/routes/', body),
  update: (id, body) => patch(`/routes/${id}/`, body),
  remove: (id) => del(`/routes/${id}/`),
  // Replace the whole ordered stop list in one call, so a reorder is atomic.
  setStops: (id, stops) => post(`/routes/${id}/stops/`, { stops }),
  addStop: (id, hh) => post(`/routes/${id}/add-stop/`, { hh }),
  removeStop: (id, hh) => post(`/routes/${id}/remove-stop/`, { hh }),
}

export const assignments = {
  list: (params) => list('/assignments/', params),
  create: (body) => post('/assignments/', body),
  update: (id, body) => patch(`/assignments/${id}/`, body),
  remove: (id) => del(`/assignments/${id}/`),
  setRoutes: (id, routeIds) => post(`/assignments/${id}/routes/`, { routes: routeIds }),
}

export const visits = {
  list: (params) => list('/visits/', params),
  create: (body) => post('/visits/', body),
  update: (id, body) => patch(`/visits/${id}/`, body),
  remove: (id) => del(`/visits/${id}/`),
  // Offline queue upload — never rejects the whole batch over one bad row.
  bulk: (rows) => post('/visits/bulk/', { rows }),
  markSynced: (id) => post(`/visits/${id}/sync/`),
}

export const collection = {
  // The server-side equivalent of "my round today".
  round: (params) => get('/collection/round/', params),
  // `collector`/`day` matter when a supervisor is previewing someone else's
  // round; for a collector-role caller the server pins both to their own.
  scan: (raw, params) => post('/collection/scan/', { raw, ...params }),
}

export const complaints = {
  list: (params) => list('/complaints/', params),
  create: (body) => post('/complaints/', body),
  update: (id, body) => patch(`/complaints/${id}/`, body),
  remove: (id) => del(`/complaints/${id}/`),
  // Status moves are actions, not field writes: each one appends an audit entry.
  assign: (id, assigned, note) => post(`/complaints/${id}/assign/`, { assigned, note }),
  advance: (id, note) => post(`/complaints/${id}/advance/`, { note }),
  resolve: (id, note) => post(`/complaints/${id}/resolve/`, { note }),
  reopen: (id, note) => post(`/complaints/${id}/reopen/`, { note }),
  priority: (id, priority, note) => post(`/complaints/${id}/priority/`, { priority, note }),
  note: (id, note) => post(`/complaints/${id}/note/`, { note }),
  summary: (params) => get('/complaints/summary/', params),
  photos: (id, files, caption) => {
    const body = new FormData()
    Array.from(files).forEach((file) => body.append('images', file))
    if (caption) body.append('caption', caption)
    return request(`/complaints/${id}/photos/`, { method: 'POST', body })
  },
}

export const bills = {
  list: (params) => list('/bills/', params),
  get: (id) => get(`/bills/${id}/`),
  // Recording a payment is the ONLY way a bill's status changes.
  pay: (id, body) => post(`/bills/${id}/pay/`, body),
  generate: (body) => post('/bills/generate/', body),
  summary: (params) => get('/bills/summary/', params),
}

export const payments = {
  list: (params) => list('/payments/', params),
  create: (body) => post('/payments/', body),
  void: (id) => post(`/payments/${id}/void/`),
}

export const billingRuns = {
  list: (params) => list('/billing-runs/', params),
}

export const deposits = {
  list: (params) => list('/deposits/', params),
  record: (body) => post('/deposits/record/', body),
  cashPosition: (period) => get('/deposits/cash-position/', { period }),
}

export const vans = {
  list: (params) => list('/vans/', params),
  create: (body) => post('/vans/', body),
  update: (id, body) => patch(`/vans/${id}/`, body),
  remove: (id) => del(`/vans/${id}/`),
  assignDriver: (id, driver) => post(`/vans/${id}/assign-driver/`, { driver }),
  position: (id, body) => post(`/vans/${id}/position/`, body),
  alerts: (params) => get('/vans/alerts/', params),
  kpis: () => get('/vans/kpis/'),
}

export const maintenance = {
  list: (params) => list('/maintenance/', params),
  create: (body) => post('/maintenance/', body),
  update: (id, body) => patch(`/maintenance/${id}/`, body),
  remove: (id) => del(`/maintenance/${id}/`),
  close: (id, body) => post(`/maintenance/${id}/close/`, body || {}),
}

export const fuelLogs = {
  list: (params) => list('/fuel-logs/', params),
  create: (body) => post('/fuel-logs/', body),
  update: (id, body) => patch(`/fuel-logs/${id}/`, body),
  remove: (id) => del(`/fuel-logs/${id}/`),
}

export const live = {
  snapshot: () => get('/live/'),
}

// Reports return `{ rows, ... }` as JSON, or a file when `format` is set.
const report = (path) => ({
  load: (params) => get(`/reports/${path}/`, params),
  export: (params) => download(`/reports/${path}/`, params),
})

export const reports = {
  wasteCollection: report('waste-collection'),
  serviceSeries: report('service-series'),
  wardCollection: report('ward-collection'),
  billCollection: report('bill-collection'),
  billStatus: report('bill-status'),
  customerCollection: report('customer-collection'),
  customerBillStatus: report('customer-bill-status'),
  reconciliation: report('reconciliation'),
  kpis: () => get('/reports/kpis/'),
  wasteByZone: (params) => get('/reports/waste-by-zone/', params),
  complaintSummary: (params) => get('/reports/complaint-summary/', params),
  customerFunnel: () => get('/reports/customer-funnel/'),
  dashboard: (params) => get('/reports/dashboard/', params),
}

export const ai = {
  ask: (question) => post('/ai/ask/', { question }),
  facts: () => get('/ai/facts/'),
}
