// ============================================================
// Smart Sweep — seed data (initial values for the editable store)
// DataContext loads these into state; pages read/write via useData().
// ============================================================

export const wards = [
  { id: 'W-14', name: 'Ward 14 — Sonadanga', zone: 'Z-03' },
  { id: 'W-15', name: 'Ward 15 — Nirala', zone: 'Z-03' },
  { id: 'W-21', name: 'Ward 21 — Khalishpur', zone: 'Z-05' },
  { id: 'W-09', name: 'Ward 09 — Daulatpur', zone: 'Z-02' },
]

// roads per ward — used by the "by road" customer reports
export const roadsByWard = {
  'W-14': ['KDA Avenue', 'Majid Sarani', 'Sonadanga Main Road'],
  'W-15': ['Nirala Residential Rd', 'Islampur Road'],
  'W-21': ['Platinum Jubilee Rd', 'BIDC Road'],
  'W-09': ['Mohsin Road', 'Deyana Main Road'],
}
export const allRoads = Object.values(roadsByWard).flat()

export const tiers = [
  { id: 'residential_standard', label: 'Residential — standard', charge: 100 },
  { id: 'residential_premium', label: 'Residential — premium', charge: 300 },
  { id: 'commercial_small', label: 'Commercial — small', charge: 250 },
  { id: 'commercial_large', label: 'Commercial — large', charge: 600 },
]
export const tierLabel = (id) => tiers.find((t) => t.id === id)?.label || id
export const tierCharge = (id) => tiers.find((t) => t.id === id)?.charge || 0

export const collectors = [
  { id: 'C-042', name: 'Rafiqul Islam',  dspId: 'DSP-0042', zone: 'W-14', phone: '+8801711-000042', onTime: 96, coverage: 98, complaints: 1, status: 'on_route', license: 'DK-1145-A', licenseExp: '2027-03-14', joined: '2025-11-02', attendance: 'checked_in' },
  { id: 'C-058', name: 'Shahin Alam',    dspId: 'DSP-0058', zone: 'W-14', phone: '+8801711-000058', onTime: 91, coverage: 94, complaints: 3, status: 'on_route', license: 'DK-2290-B', licenseExp: '2026-08-30', joined: '2026-01-19', attendance: 'checked_in' },
  { id: 'C-073', name: 'Jamal Uddin',    dspId: 'DSP-0073', zone: 'W-15', phone: '+8801711-000073', onTime: 88, coverage: 90, complaints: 4, status: 'idle',     license: 'DK-3381-A', licenseExp: '2026-07-22', joined: '2025-09-11', attendance: 'checked_in' },
  { id: 'C-091', name: 'Nasir Uddin',    dspId: 'DSP-0091', zone: 'W-21', phone: '+8801711-000091', onTime: 99, coverage: 97, complaints: 0, status: 'on_route', license: 'DK-4417-C', licenseExp: '2028-01-05', joined: '2026-02-28', attendance: 'checked_in' },
  { id: 'C-104', name: 'Habibur Rahman', dspId: 'DSP-0104', zone: 'W-09', phone: '+8801711-000104', onTime: 84, coverage: 87, complaints: 5, status: 'on_route', license: 'DK-5528-A', licenseExp: '2026-09-18', joined: '2025-07-04', attendance: 'checked_in' },
  { id: 'C-117', name: 'Moshiur Rahman', dspId: 'DSP-0117', zone: 'W-15', phone: '+8801711-000117', onTime: 93, coverage: 95, complaints: 2, status: 'on_route', license: 'DK-6639-B', licenseExp: '2027-11-27', joined: '2026-03-15', attendance: 'checked_in' },
]

// Generate extra households (with matching visits & bills) so each collector's
// route timeline and the live map are well-populated — ~4 per ward.
const HEAD_NAMES = [
  'Abdur Rob', 'Shahida Khatun', 'Nazmul Huda', 'Parvez Alam', 'Rokeya Begum', 'Delwar Hossain',
  'Shefali Akter', 'Golam Rabbani', 'Nurjahan Begum', 'Aminul Islam', 'Sharmin Sultana', 'Kabir Ahmed',
  'Rehana Parvin', 'Sohel Rana', 'Momtaz Begum', 'Faruk Hossain', 'Jesmin Ara', 'Bashir Uddin',
  'Anwara Begum', 'Rashedul Karim', 'Salma Khatun', 'Emdadul Haque', 'Nasima Begum', 'Torikul Islam',
]
const WARD_CENTERS = { 'W-14': [22.8452, 89.5405], 'W-15': [22.8212, 89.5552], 'W-21': [22.8340, 89.5002], 'W-09': [22.8510, 89.5175] }

function generateExtra() {
  let seed = 20260706
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)]
  const pad = (v, n) => String(v).padStart(n, '0')
  const tierIds = tiers.map((t) => t.id)
  const homes = [], vis = [], moreBills = []
  let n = 0, hi = 0
  Object.keys(WARD_CENTERS).forEach((w) => {
    const [clat, clng] = WARD_CENTERS[w]
    const roads = roadsByWard[w]
    const wardCols = collectors.filter((c) => c.zone === w)
    for (let k = 0; k < 4; k++) {
      n += 1
      const id = `HH-KCC-05${pad(n, 3)}`
      const qr = `SS-05${pad(n, 3)}`
      const head = HEAD_NAMES[hi++ % HEAD_NAMES.length]
      const tier = tierIds[Math.floor(rnd() * tierIds.length)]
      const duesRoll = rnd()
      const dues = duesRoll < 0.55 ? 0 : Math.round(tierCharge(tier) * (duesRoll < 0.85 ? 1 : 2))
      const collected = k % 2 === 0
      const skipped = k === 3
      const col = wardCols.length ? wardCols[k % wardCols.length].id : null
      const at = `2026-07-06T0${6 + (k % 3)}:${pad(12 + n, 2)}:00Z`
      homes.push({
        id, qr, ward: w, road: pick(roads), holding: `${100 + n}${k % 2 ? '/A' : ''}`, head,
        phone: `+8801713-3${pad(n, 4)}`, tier, status: rnd() < 0.92 ? 'active' : 'inactive',
        lastVisit: collected && !skipped ? at : null, dues,
        lat: +(clat + (rnd() - 0.5) * 0.0085).toFixed(4), lng: +(clng + (rnd() - 0.5) * 0.0085).toFixed(4),
      })
      if ((collected || skipped) && col) {
        vis.push({ id: `V-95${pad(n, 3)}`, hh: id, collector: col, qr, status: skipped ? 'skipped' : 'collected', at, accuracy: 5 + (n % 8), synced: rnd() < 0.85 })
      }
      const paidRoll = rnd()
      const status = dues > 0 ? (paidRoll < 0.5 ? 'unpaid' : 'overdue') : (paidRoll < 0.8 ? 'paid' : 'partial')
      moreBills.push({ id: `B-2026-07-05${pad(n, 3)}`, hh: id, head, period: '2026-07', amount: tierCharge(tier), status, method: status === 'paid' ? pick(['cash', 'bkash', 'nagad']) : status === 'partial' ? 'cash' : null, ward: w })
    }
  })
  return { homes, vis, moreBills }
}
const EXTRA = generateExtra()

export const households = [
  { id: 'HH-KCC-0012840', qr: 'SS-9F3A21', ward: 'W-14', road: 'KDA Avenue',           holding: '142/B', head: 'Abdul Karim',   phone: '+8801812-334455', tier: 'residential_standard', status: 'active',   lastVisit: '2026-07-05T06:14Z', dues: 0,   lat: 22.8456, lng: 89.5403 },
  { id: 'HH-KCC-0012841', qr: 'SS-9F3A22', ward: 'W-14', road: 'KDA Avenue',           holding: '143',   head: 'Rina Sultana',   phone: '+8801812-334456', tier: 'residential_standard', status: 'active',   lastVisit: '2026-07-05T06:19Z', dues: 100, lat: 22.8461, lng: 89.5411 },
  { id: 'HH-KCC-0012842', qr: 'SS-9F3A23', ward: 'W-14', road: 'Majid Sarani',         holding: '144/A', head: 'Mizanur Rahman', phone: '+8801812-334457', tier: 'commercial_small',     status: 'active',   lastVisit: '2026-07-04T06:41Z', dues: 250, lat: 22.8449, lng: 89.5398 },
  { id: 'HH-KCC-0012843', qr: 'SS-9F3A24', ward: 'W-14', road: 'Sonadanga Main Road',  holding: '77',    head: 'Bilkis Ara',     phone: '+8801812-334458', tier: 'residential_standard', status: 'active',   lastVisit: '2026-07-05T06:22Z', dues: 0,   lat: 22.8440, lng: 89.5420 },
  { id: 'HH-KCC-0013110', qr: 'SS-A1B2C3', ward: 'W-15', road: 'Nirala Residential Rd',holding: '07/C',  head: 'Farida Yasmin',  phone: '+8801812-556677', tier: 'residential_standard', status: 'active',   lastVisit: '2026-07-05T07:02Z', dues: 0,   lat: 22.8201, lng: 89.5567 },
  { id: 'HH-KCC-0013111', qr: 'SS-A1B2C4', ward: 'W-15', road: 'Nirala Residential Rd',holding: '08',    head: 'Kamal Hossain',  phone: '+8801812-556678', tier: 'residential_premium',  status: 'active',   lastVisit: '2026-07-03T07:14Z', dues: 300, lat: 22.8210, lng: 89.5559 },
  { id: 'HH-KCC-0013112', qr: 'SS-A1B2C5', ward: 'W-15', road: 'Islampur Road',        holding: '31',    head: 'Sultana Razia',  phone: '+8801812-556679', tier: 'commercial_small',     status: 'active',   lastVisit: '2026-07-05T07:20Z', dues: 250, lat: 22.8225, lng: 89.5541 },
  { id: 'HH-KCC-0021004', qr: 'SS-D4E5F6', ward: 'W-21', road: 'Platinum Jubilee Rd',  holding: '221',   head: 'Selina Parvin',  phone: '+8801812-778899', tier: 'residential_standard', status: 'active',   lastVisit: '2026-07-05T06:58Z', dues: 0,   lat: 22.8332, lng: 89.5011 },
  { id: 'HH-KCC-0021005', qr: 'SS-D4E5F7', ward: 'W-21', road: 'Platinum Jubilee Rd',  holding: '222',   head: 'Anwar Hossain',  phone: '+8801812-778900', tier: 'commercial_small',     status: 'inactive', lastVisit: '2026-06-28T06:33Z', dues: 500, lat: 22.8339, lng: 89.5004 },
  { id: 'HH-KCC-0021006', qr: 'SS-D4E5F8', ward: 'W-21', road: 'BIDC Road',            holding: '19',    head: 'Jahangir Alam',  phone: '+8801812-778901', tier: 'residential_standard', status: 'active',   lastVisit: '2026-07-05T07:05Z', dues: 0,   lat: 22.8351, lng: 89.4990 },
  { id: 'HH-KCC-0009050', qr: 'SS-77AA11', ward: 'W-09', road: 'Mohsin Road',          holding: '15/B',  head: 'Ruksana Begum',  phone: '+8801812-990011', tier: 'residential_standard', status: 'active',   lastVisit: '2026-07-05T06:26Z', dues: 100, lat: 22.8501, lng: 89.5183 },
  { id: 'HH-KCC-0009051', qr: 'SS-77AA12', ward: 'W-09', road: 'Mohsin Road',          holding: '16',    head: 'Tariqul Islam',  phone: '+8801812-990012', tier: 'residential_standard', status: 'active',   lastVisit: null,                dues: 200, lat: 22.8512, lng: 89.5190 },
  { id: 'HH-KCC-0009052', qr: 'SS-77AA13', ward: 'W-09', road: 'Deyana Main Road',     holding: '04/A',  head: 'Momena Khatun',  phone: '+8801812-990013', tier: 'residential_premium',  status: 'active',   lastVisit: '2026-07-04T06:30Z', dues: 0,   lat: 22.8523, lng: 89.5165 },
  ...EXTRA.homes,
]

// "Ghost homes" — surveyed but not yet registered/charged (potential customers)
export const potentialCustomers = [
  { id: 'POT-3001', ward: 'W-14', road: 'Majid Sarani',        holding: '150', head: 'Nurul Amin',    phone: '+8801713-100001', estTier: 'residential_standard', surveyedAt: '2026-07-02', surveyor: 'C-058' },
  { id: 'POT-3002', ward: 'W-14', road: 'Sonadanga Main Road', holding: '81',  head: 'Rehana Begum',  phone: '+8801713-100002', estTier: 'commercial_small',     surveyedAt: '2026-07-02', surveyor: 'C-058' },
  { id: 'POT-3003', ward: 'W-15', road: 'Islampur Road',       holding: '33',  head: 'Delwar Hossain',phone: '+8801713-100003', estTier: 'residential_standard', surveyedAt: '2026-07-03', surveyor: 'C-117' },
  { id: 'POT-3004', ward: 'W-21', road: 'BIDC Road',           holding: '25',  head: 'Shirin Akter',  phone: '+8801713-100004', estTier: 'residential_standard', surveyedAt: '2026-07-01', surveyor: 'C-091' },
  { id: 'POT-3005', ward: 'W-21', road: 'BIDC Road',           holding: '26',  head: 'Fazlul Haque',  phone: '+8801713-100005', estTier: 'commercial_large',     surveyedAt: '2026-07-01', surveyor: 'C-091' },
  { id: 'POT-3006', ward: 'W-09', road: 'Deyana Main Road',    holding: '09',  head: 'Ayesha Siddika',phone: '+8801713-100006', estTier: 'residential_standard', surveyedAt: '2026-07-04', surveyor: 'C-104' },
]

export const vans = [
  { id: 'VAN-KCC-017', plate: 'KHULNA-METRO-TA-11-4520', type: 'compactor',    capacity: 3000, fuel: 'diesel',   ownership: 'owned',  gps: 'GPS-7781', odometer: 48210, status: 'active',         driver: 'C-042', fitnessExp: '2026-11-30', taxExp: '2026-09-15', insuranceExp: '2026-12-01', permitExp: '2027-01-20', nextServiceKm: 53000, kmpl: 6.1 },
  { id: 'VAN-KCC-004', plate: 'KHULNA-METRO-TA-11-2210', type: 'pickup',       capacity: 1200, fuel: 'diesel',   ownership: 'owned',  gps: 'GPS-3320', odometer: 91240, status: 'in_maintenance',driver: null,    fitnessExp: '2026-08-05', taxExp: '2026-07-19', insuranceExp: '2027-02-11', permitExp: '2026-12-03', nextServiceKm: 92000, kmpl: 8.4 },
  { id: 'VAN-KCC-022', plate: 'KHULNA-METRO-HA-13-8890', type: 'rickshaw-van', capacity: 400,  fuel: 'electric', ownership: 'leased', gps: 'GPS-9910', odometer: 12030, status: 'active',         driver: 'C-091', fitnessExp: '2027-05-22', taxExp: '2026-10-01', insuranceExp: '2026-11-14', permitExp: '2027-06-30', nextServiceKm: 15000, kmpl: null },
  { id: 'VAN-KCC-009', plate: 'KHULNA-METRO-TA-11-3345', type: 'tricycle',     capacity: 250,  fuel: 'electric', ownership: 'owned',  gps: 'GPS-1180', odometer: 8420,  status: 'idle',           driver: null,    fitnessExp: '2026-07-10', taxExp: '2026-08-25', insuranceExp: '2027-01-30', permitExp: '2026-09-09', nextServiceKm: 10000, kmpl: null },
  { id: 'VAN-KCC-031', plate: 'KHULNA-METRO-TA-11-5567', type: 'compactor',    capacity: 3000, fuel: 'diesel',   ownership: 'owned',  gps: 'GPS-4402', odometer: 60110, status: 'active',         driver: 'C-117', fitnessExp: '2026-10-18', taxExp: '2026-12-12', insuranceExp: '2026-07-28', permitExp: '2027-03-04', nextServiceKm: 63000, kmpl: 5.8 },
]

export const complaints = [
  { id: 'CMP-20714', hh: 'HH-KCC-0012841', type: 'missed_collection', channel: 'sms',  status: 'open',        assigned: 'C-058', opened: '2026-07-05T08:12Z', sla: 24, ward: 'W-14' },
  { id: 'CMP-20713', hh: 'HH-KCC-0021005', type: 'overflow',          channel: 'app',  status: 'in_progress', assigned: 'C-091', opened: '2026-07-05T07:40Z', sla: 24, ward: 'W-21' },
  { id: 'CMP-20710', hh: 'HH-KCC-0009050', type: 'billing_dispute',   channel: 'app',  status: 'assigned',    assigned: 'C-104', opened: '2026-07-05T06:05Z', sla: 24, ward: 'W-09' },
  { id: 'CMP-20705', hh: 'HH-KCC-0013111', type: 'staff_behaviour',   channel: 'sms',  status: 'resolved',    assigned: 'C-073', opened: '2026-07-04T14:22Z', sla: 24, ward: 'W-15' },
  { id: 'CMP-20701', hh: 'HH-KCC-0012842', type: 'missed_collection', channel: 'app',  status: 'closed',      assigned: 'C-042', opened: '2026-07-03T09:10Z', sla: 24, ward: 'W-14' },
  { id: 'CMP-20698', hh: 'HH-KCC-0013110', type: 'overflow',          channel: 'sms',  status: 'resolved',    assigned: 'C-117', opened: '2026-07-03T05:55Z', sla: 24, ward: 'W-15' },
]

export const bills = [
  { id: 'B-2026-07-0012840', hh: 'HH-KCC-0012840', head: 'Abdul Karim',   period: '2026-07', amount: 100, status: 'paid',    method: 'cash',  ward: 'W-14' },
  { id: 'B-2026-07-0012841', hh: 'HH-KCC-0012841', head: 'Rina Sultana',   period: '2026-07', amount: 100, status: 'unpaid',  method: null,    ward: 'W-14' },
  { id: 'B-2026-07-0012842', hh: 'HH-KCC-0012842', head: 'Mizanur Rahman', period: '2026-07', amount: 250, status: 'partial', method: 'cash',  ward: 'W-14' },
  { id: 'B-2026-07-0012843', hh: 'HH-KCC-0012843', head: 'Bilkis Ara',     period: '2026-07', amount: 100, status: 'paid',    method: 'bkash', ward: 'W-14' },
  { id: 'B-2026-07-0013110', hh: 'HH-KCC-0013110', head: 'Farida Yasmin',  period: '2026-07', amount: 100, status: 'paid',    method: 'bkash', ward: 'W-15' },
  { id: 'B-2026-07-0013111', hh: 'HH-KCC-0013111', head: 'Kamal Hossain',  period: '2026-07', amount: 300, status: 'unpaid',  method: null,    ward: 'W-15' },
  { id: 'B-2026-07-0013112', hh: 'HH-KCC-0013112', head: 'Sultana Razia',  period: '2026-07', amount: 250, status: 'partial', method: 'cash',  ward: 'W-15' },
  { id: 'B-2026-07-0021004', hh: 'HH-KCC-0021004', head: 'Selina Parvin',  period: '2026-07', amount: 100, status: 'paid',    method: 'cash',  ward: 'W-21' },
  { id: 'B-2026-07-0021005', hh: 'HH-KCC-0021005', head: 'Anwar Hossain',  period: '2026-07', amount: 250, status: 'overdue', method: null,    ward: 'W-21' },
  { id: 'B-2026-07-0021006', hh: 'HH-KCC-0021006', head: 'Jahangir Alam',  period: '2026-07', amount: 100, status: 'paid',    method: 'cash',  ward: 'W-21' },
  { id: 'B-2026-07-0009050', hh: 'HH-KCC-0009050', head: 'Ruksana Begum',  period: '2026-07', amount: 100, status: 'unpaid',  method: null,    ward: 'W-09' },
  { id: 'B-2026-07-0009052', hh: 'HH-KCC-0009052', head: 'Momena Khatun',  period: '2026-07', amount: 300, status: 'paid',    method: 'bkash', ward: 'W-09' },
  ...EXTRA.moreBills,
]

export const visits = [
  { id: 'V-88213', hh: 'HH-KCC-0012840', collector: 'C-042', qr: 'SS-9F3A21', status: 'collected', at: '2026-07-05T06:14Z', accuracy: 6,  synced: true },
  { id: 'V-88214', hh: 'HH-KCC-0012841', collector: 'C-058', qr: 'SS-9F3A22', status: 'collected', at: '2026-07-05T06:19Z', accuracy: 8,  synced: true },
  { id: 'V-88215', hh: 'HH-KCC-0021004', collector: 'C-091', qr: 'SS-D4E5F6', status: 'collected', at: '2026-07-05T06:58Z', accuracy: 5,  synced: true },
  { id: 'V-88216', hh: 'HH-KCC-0013110', collector: 'C-117', qr: 'SS-A1B2C3', status: 'collected', at: '2026-07-05T07:02Z', accuracy: 7,  synced: true },
  { id: 'V-88217', hh: 'HH-KCC-0009050', collector: 'C-104', qr: 'SS-77AA11', status: 'collected', at: '2026-07-05T06:26Z', accuracy: 11, synced: false },
  { id: 'V-88218', hh: 'HH-KCC-0012842', collector: 'C-042', qr: 'SS-9F3A23', status: 'skipped',   at: '2026-07-05T06:33Z', accuracy: 6,  synced: true },
  ...EXTRA.vis,
]

export const maintenance = [
  { id: 'MNT-3341', van: 'VAN-KCC-004', kind: 'unscheduled', reason: 'Hydraulic lift failure', odometer: 91240, opened: '2026-07-04T09:00Z', closed: null,               downtime: 30, cost: 8600, vendor: 'City Workshop Ltd.' },
  { id: 'MNT-3336', van: 'VAN-KCC-017', kind: 'scheduled',   reason: '5000km service',         odometer: 48000, opened: '2026-07-02T09:00Z', closed: '2026-07-02T15:30Z', downtime: 6.5, cost: 4300, vendor: 'City Workshop Ltd.' },
  { id: 'MNT-3330', van: 'VAN-KCC-031', kind: 'scheduled',   reason: 'Brake pad replacement',  odometer: 59500, opened: '2026-06-28T10:00Z', closed: '2026-06-28T13:00Z', downtime: 3,   cost: 2100, vendor: 'Metro Auto Care' },
]

export const fuelLogs = [
  { id: 'FUEL-5521', van: 'VAN-KCC-017', litres: 32.5, cost: 3900, odometer: 48210, by: 'C-042', at: '2026-07-05T05:50Z', kmpl: 6.1 },
  { id: 'FUEL-5518', van: 'VAN-KCC-031', litres: 40.0, cost: 4800, odometer: 60110, by: 'C-117', at: '2026-07-04T05:40Z', kmpl: 5.8 },
  { id: 'FUEL-5512', van: 'VAN-KCC-004', litres: 28.0, cost: 3360, odometer: 91100, by: 'C-073', at: '2026-07-02T06:10Z', kmpl: 8.4 },
  { id: 'FUEL-5509', van: 'VAN-KCC-017', litres: 30.0, cost: 3600, odometer: 47720, by: 'C-042', at: '2026-07-01T05:55Z', kmpl: 4.2 },
]

// -------- Daily service-collection records (last 30 days), deterministic --------
// Used by the Daily/Weekly/Monthly reports. One row per day (city-wide totals).
function buildDaily() {
  const out = []
  const base = new Date('2026-07-05T00:00:00Z')
  for (let i = 29; i >= 0; i--) {
    const d = new Date(base)
    d.setUTCDate(base.getUTCDate() - i)
    const iso = d.toISOString().slice(0, 10)
    const dow = d.getUTCDay()
    const scheduled = 1180
    // deterministic wave
    const served = Math.round(scheduled * (0.90 + 0.06 * Math.sin(i / 2) + (dow === 5 ? 0.02 : 0)))
    const billed = served * 115
    const collected = Math.round(billed * (0.70 + 0.12 * Math.sin(i / 3 + 1)))
    out.push({ date: iso, dow, scheduled, served, billed, collected })
  }
  return out
}
export const dailyCollection = buildDaily()

// Per-ward monthly rollup for 2026-07 (derived-ish; used in reports)
export const wardCollection = [
  { ward: 'W-14', name: 'Sonadanga',  households: 4, billed: 550, collected: 300, served: 118, scheduled: 124 },
  { ward: 'W-15', name: 'Nirala',     households: 3, billed: 650, collected: 350, served: 96,  scheduled: 102 },
  { ward: 'W-21', name: 'Khalishpur', households: 3, billed: 450, collected: 200, served: 132, scheduled: 140 },
  { ward: 'W-09', name: 'Daulatpur',  households: 3, billed: 400, collected: 300, served: 88,  scheduled: 96 },
]

export const collectionTrend = [
  { day: 'Mon', scheduled: 1180, collected: 1092, charge: 71 },
  { day: 'Tue', scheduled: 1180, collected: 1121, charge: 74 },
  { day: 'Wed', scheduled: 1180, collected: 1064, charge: 69 },
  { day: 'Thu', scheduled: 1180, collected: 1140, charge: 78 },
  { day: 'Fri', scheduled: 1180, collected: 1155, charge: 81 },
  { day: 'Sat', scheduled: 1180, collected: 1098, charge: 76 },
  { day: 'Sun', scheduled: 1180, collected: 1168, charge: 84 },
]

export const wasteByZone = [
  { zone: 'Sonadanga', tonnes: 42 },
  { zone: 'Nirala', tonnes: 31 },
  { zone: 'Khalishpur', tonnes: 55 },
  { zone: 'Daulatpur', tonnes: 38 },
]

export const kpis = {
  collectionEfficiency: 93,
  chargeRate: 78,
  coverage: 96,
  complaintMedianH: 18,
  onTimeCompletion: 91,
  fleetAvailability: 80,
}

export const operators = [
  { phone: '01711000042', name: 'Rafiqul Islam', role: 'Collector',    scope: 'Ward 14' },
  { phone: '01700112233', name: 'Tanvir Ahmed',  role: 'Supervisor',   scope: 'Zone 03' },
  { phone: '01900445566', name: 'Farhana Haque',  role: 'Agency Admin', scope: 'All zones' },
  { phone: '01800778899', name: 'KCC Cell',       role: 'KCC Viewer',   scope: 'City-wide' },
]

// The seed bundle DataContext hydrates from.
export const SEED = {
  households, potentialCustomers, collectors, vans, complaints,
  bills, visits, maintenance, fuelLogs,
}
