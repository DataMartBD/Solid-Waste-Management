// ============================================================
// Smart Sweep — seed data (initial values for the editable store)
// DataContext loads these into state; pages read/write via useData().
// ============================================================

// `key` is the i18n key for the display name; `name` stays as the English
// fallback for any non-React caller (exports, tests).
export const wards = [
  { id: 'W-14', key: 'opt.ward.W-14', name: 'Ward 14 — Sonadanga', zone: 'Z-03' },
  { id: 'W-15', key: 'opt.ward.W-15', name: 'Ward 15 — Nirala', zone: 'Z-03' },
  { id: 'W-21', key: 'opt.ward.W-21', name: 'Ward 21 — Khalishpur', zone: 'Z-05' },
  { id: 'W-09', key: 'opt.ward.W-09', name: 'Ward 09 — Daulatpur', zone: 'Z-02' },
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
  { id: 'residential_standard', key: 'opt.tier.residential_standard', label: 'Residential — standard', charge: 100 },
  { id: 'residential_premium', key: 'opt.tier.residential_premium', label: 'Residential — premium', charge: 300 },
  { id: 'commercial_small', key: 'opt.tier.commercial_small', label: 'Commercial — small', charge: 250 },
  { id: 'commercial_large', key: 'opt.tier.commercial_large', label: 'Commercial — large', charge: 600 },
]
export const tierLabel = (id) => tiers.find((t) => t.id === id)?.label || id
export const tierCharge = (id) => tiers.find((t) => t.id === id)?.charge || 0

// ============================================================
// Customer-information option lists
// These mirror the field-office customer sheet: every row of that sheet has a
// home in the household record, so a registration captured on paper can be
// entered here without loss.
// ============================================================

export const customerTypes = [
  { id: 'residential', key: 'opt.customerType.residential', label: 'Residential' },
  { id: 'commercial', key: 'opt.customerType.commercial', label: 'Commercial' },
  { id: 'institutional', key: 'opt.customerType.institutional', label: 'Institutional' },
  { id: 'industrial', key: 'opt.customerType.industrial', label: 'Industrial' },
]

// "Type of holdings" — the structure the waste comes from.
export const holdingTypes = [
  { id: 'single_storey', key: 'opt.holdingType.single_storey', label: 'Single-storey house' },
  { id: 'multi_storey', key: 'opt.holdingType.multi_storey', label: 'Multi-storey building' },
  { id: 'apartment', key: 'opt.holdingType.apartment', label: 'Apartment / flat' },
  { id: 'tin_shed', key: 'opt.holdingType.tin_shed', label: 'Tin-shed / semi-pucca' },
  { id: 'shop', key: 'opt.holdingType.shop', label: 'Shop / market stall' },
  { id: 'office', key: 'opt.holdingType.office', label: 'Office / institution' },
]

// "Storage in house" — how waste is held between collections.
export const storageTypes = [
  { id: 'covered_bin', key: 'opt.storage.covered_bin', label: 'Covered bin' },
  { id: 'open_bin', key: 'opt.storage.open_bin', label: 'Open bin' },
  { id: 'segregated', key: 'opt.storage.segregated', label: 'Segregated (wet / dry)' },
  { id: 'sack', key: 'opt.storage.sack', label: 'Sack or bag' },
  { id: 'none', key: 'opt.storage.none', label: 'No storage' },
]

// "Suitable time" — when the household wants the collector to call.
export const suitableTimes = [
  { id: 'morning', key: 'opt.suitableTime.morning', label: 'Morning (6–9 am)' },
  { id: 'midday', key: 'opt.suitableTime.midday', label: 'Midday (9 am–12 pm)' },
  { id: 'afternoon', key: 'opt.suitableTime.afternoon', label: 'Afternoon (12–4 pm)' },
  { id: 'evening', key: 'opt.suitableTime.evening', label: 'Evening (4–8 pm)' },
  { id: 'any', key: 'opt.suitableTime.any', label: 'Any time' },
]

export const paymentModes = [
  { id: 'cash', key: 'opt.paymentMode.cash', label: 'Cash' },
  { id: 'bkash', key: 'opt.paymentMode.bkash', label: 'bKash' },
  { id: 'nagad', key: 'opt.paymentMode.nagad', label: 'Nagad' },
  { id: 'rocket', key: 'opt.paymentMode.rocket', label: 'Rocket' },
  { id: 'bank', key: 'opt.paymentMode.bank', label: 'Bank transfer' },
]

export const bloodGroups = ['A+', 'A−', 'B+', 'B−', 'O+', 'O−', 'AB+', 'AB−']

// ---- "To be customer" survey answers (potential customers only) ----

// Why the holding is not yet under service.
export const potentialReasons = [
  { id: 'never_approached', key: 'opt.reason.never_approached', label: 'Never approached' },
  { id: 'refused_charge', key: 'opt.reason.refused_charge', label: 'Unwilling to pay the charge' },
  { id: 'own_arrangement', key: 'opt.reason.own_arrangement', label: 'Has a private arrangement' },
  { id: 'vacant', key: 'opt.reason.vacant', label: 'Vacant / under construction' },
  { id: 'past_dispute', key: 'opt.reason.past_dispute', label: 'Past service dispute' },
  { id: 'other', key: 'opt.reason.other', label: 'Other' },
]

// How long the holding has been without a municipal service.
export const timeGaps = [
  { id: 'never', key: 'opt.timeGap.never', label: 'Never served' },
  { id: 'lt_3m', key: 'opt.timeGap.lt_3m', label: 'Under 3 months' },
  { id: '3_6m', key: 'opt.timeGap.3_6m', label: '3–6 months' },
  { id: '6_12m', key: 'opt.timeGap.6_12m', label: '6–12 months' },
  { id: 'gt_1y', key: 'opt.timeGap.gt_1y', label: 'Over a year' },
]

// What they do with their waste today.
export const currentPractices = [
  { id: 'private_collector', key: 'opt.practice.private_collector', label: 'Private collector' },
  { id: 'roadside_dump', key: 'opt.practice.roadside_dump', label: 'Dumps at roadside / drain' },
  { id: 'community_bin', key: 'opt.practice.community_bin', label: 'Carries to community bin' },
  { id: 'burns', key: 'opt.practice.burns', label: 'Burns the waste' },
  { id: 'composts', key: 'opt.practice.composts', label: 'Buries / composts on site' },
  { id: 'none', key: 'opt.practice.none', label: 'No fixed practice' },
]

// Label lookup for any of the option lists above.
export const optLabel = (list, id) => list.find((o) => o.id === id)?.label || id || '—'

// The charge actually agreed with a household — a negotiated amount overrides
// the tier's standard charge. Works for households and potential customers.
export const effectiveCharge = (h) => {
  const agreed = Number(h?.charge)
  return agreed > 0 ? agreed : tierCharge(h?.tier || h?.estTier)
}

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

// ---- Customer-information enrichment ----------------------------------------
// The core records above stay readable; the full customer sheet (profession,
// members, storage, payment terms, …) is layered on deterministically by index
// so every seeded row demos the complete profile.
const PROFESSIONS = [
  'Shopkeeper', 'School teacher', 'Garment worker', 'Rickshaw puller', 'Govt. service',
  'Homemaker', 'Small trader', 'Bank officer', 'Day labourer', 'Tailor', 'Van driver', 'Nurse',
]
const RELATIONS = ['Son', 'Spouse', 'Daughter', 'Brother', 'Caretaker', 'Manager']
const FLOORS = ['Ground', '1st floor', '2nd floor', '3rd floor', '4th floor']

function attachProfile(rec, i) {
  const tier = rec.tier || rec.estTier || ''
  const commercial = tier.startsWith('commercial')
  const members = commercial ? 0 : 3 + (i % 5)
  const slug = rec.head.toLowerCase().replace(/[^a-z]+/g, '.')
  return {
    customerType: commercial ? (i % 4 === 0 ? 'institutional' : 'commercial') : 'residential',
    profession: PROFESSIONS[i % PROFESSIONS.length],
    address: `Holding ${rec.holding}, ${rec.road}`,
    email: i % 3 === 0 ? `${slug}@mail.com` : '',
    altPhone: i % 2 === 0 ? `+8801912-${String(200000 + i * 37).slice(-6)}` : '',
    contactPerson: i % 2 === 0 ? `${RELATIONS[i % RELATIONS.length]} — ${rec.head.split(' ')[0]} family` : '',
    bloodGroup: bloodGroups[i % bloodGroups.length],
    members,
    membersUnder5: members ? (i % 3 === 0 ? 1 : 0) : 0,
    membersFemale: members ? 1 + (i % 3) : 0,
    storage: storageTypes[i % storageTypes.length].id,
    holdingType: commercial ? holdingTypes[4 + (i % 2)].id : holdingTypes[i % 4].id,
    floor: FLOORS[i % FLOORS.length],
    suitableTime: suitableTimes[i % suitableTimes.length].id,
    // a few holdings negotiated a charge away from the tier's standard rate
    charge: i % 7 === 3 ? tierCharge(tier) + 50 : tierCharge(tier),
    paymentMode: paymentModes[i % paymentModes.length].id,
    paymentDay: 1 + (i % 10),
    ...rec,
  }
}

// Extra survey answers the "to be customer" column of the sheet asks for.
// Payment terms are deliberately absent: nothing is billed until the holding is
// brought under service, so they are only agreed at conversion time.
// A surveyed home has no verified location yet — that happens at conversion.
function attachSurvey(rec, i) {
  const { charge, paymentMode, paymentDay, ...profile } = attachProfile(rec, i)
  return {
    ...profile,
    reason: potentialReasons[i % potentialReasons.length].id,
    timeGap: timeGaps[i % timeGaps.length].id,
    currentPractice: currentPractices[i % currentPractices.length].id,
    verified: false,
    verifiedAt: null,
    verifiedBy: null,
    accuracy: null,
  }
}

// Location verification. A household is only routable once someone has stood at
// the gate and captured a GPS fix, so the seed keeps a handful unverified to
// exercise the verification queue and the "not on any route" warning.
const UNVERIFIED_SEED = new Set(['HH-KCC-0012841', 'HH-KCC-0021005', 'HH-KCC-0009051', 'HH-KCC-05009'])

function attachVerification(rec, i) {
  if (UNVERIFIED_SEED.has(rec.id)) {
    // no confirmed coordinates until someone verifies on site
    return { ...rec, lat: null, lng: null, verified: false, verifiedAt: null, verifiedBy: null, accuracy: null }
  }
  return {
    ...rec,
    verified: true,
    verifiedAt: `2026-07-0${1 + (i % 4)}`,
    verifiedBy: collectors[i % collectors.length].id,
    accuracy: 4 + (i % 9),
  }
}

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
].map(attachProfile).map(attachVerification)

// "Ghost homes" — surveyed but not yet registered/charged (potential customers)
export const potentialCustomers = [
  { id: 'POT-3001', ward: 'W-14', road: 'Majid Sarani',        holding: '150', head: 'Nurul Amin',    phone: '+8801713-100001', estTier: 'residential_standard', surveyedAt: '2026-07-02', surveyor: 'C-058' },
  { id: 'POT-3002', ward: 'W-14', road: 'Sonadanga Main Road', holding: '81',  head: 'Rehana Begum',  phone: '+8801713-100002', estTier: 'commercial_small',     surveyedAt: '2026-07-02', surveyor: 'C-058' },
  { id: 'POT-3003', ward: 'W-15', road: 'Islampur Road',       holding: '33',  head: 'Delwar Hossain',phone: '+8801713-100003', estTier: 'residential_standard', surveyedAt: '2026-07-03', surveyor: 'C-117' },
  { id: 'POT-3004', ward: 'W-21', road: 'BIDC Road',           holding: '25',  head: 'Shirin Akter',  phone: '+8801713-100004', estTier: 'residential_standard', surveyedAt: '2026-07-01', surveyor: 'C-091' },
  { id: 'POT-3005', ward: 'W-21', road: 'BIDC Road',           holding: '26',  head: 'Fazlul Haque',  phone: '+8801713-100005', estTier: 'commercial_large',     surveyedAt: '2026-07-01', surveyor: 'C-091' },
  { id: 'POT-3006', ward: 'W-09', road: 'Deyana Main Road',    holding: '09',  head: 'Ayesha Siddika',phone: '+8801713-100006', estTier: 'residential_standard', surveyedAt: '2026-07-04', surveyor: 'C-104' },
].map(attachSurvey)

// ---- Routes and collector assignments ---------------------------------------
//
// Two separate records, because they answer two different questions.
//
//   routes      — WHICH holdings make up a round, in walking order. A route is
//                 a reusable thing tied to a place, not to a person, so it can
//                 be handed to whoever is on shift.
//   assignments — WHO walks which rounds. A collector may hold several routes,
//                 for example a morning road and an afternoon one.
//
// A household belongs to exactly one route, and a collector's daily round is
// their assigned routes' stops in walking order. Only verified households are
// planned: an unverified holding has no confirmed location, so nobody can be
// sent to it.
const ROUTE_WINDOWS = ['06:00–09:30', '06:30–10:00', '07:00–10:30']

const byHolding = (a, b) => String(a.holding).localeCompare(String(b.holding), undefined, { numeric: true })

// One route per road — the way a round is actually described out loud
// ("you take KDA Avenue this morning").
function buildRoutes() {
  const grouped = {}
  households.filter((h) => h.verified).forEach((h) => {
    const key = `${h.ward}|${h.road}`
    ;(grouped[key] = grouped[key] || []).push(h)
  })
  return Object.entries(grouped).map(([key, homes], i) => {
    const [ward, road] = key.split('|')
    return {
      id: `RT-${ward}-${String(i + 1).padStart(2, '0')}`,
      name: road,
      ward,
      window: ROUTE_WINDOWS[i % ROUTE_WINDOWS.length],
      stops: [...homes].sort(byHolding).map((h) => h.id),
      active: true,
    }
  })
}

export const routes = buildRoutes()

// Deal each ward's routes round-robin across that ward's collectors. Wards with
// more roads than collectors leave someone holding two routes, which is exactly
// the case the daily round has to cope with.
function buildAssignments() {
  const poolByWard = {}
  collectors.filter((c) => c.status !== 'off_route')
    .forEach((c) => { (poolByWard[c.zone] = poolByWard[c.zone] || []).push(c) })

  const held = {}
  const turn = {}
  routes.forEach((r) => {
    const pool = poolByWard[r.ward]
    if (!pool || !pool.length) return
    const c = pool[(turn[r.ward] || 0) % pool.length]
    turn[r.ward] = (turn[r.ward] || 0) + 1
    ;(held[c.id] = held[c.id] || []).push(r.id)
  })

  return Object.entries(held).map(([collector, routeIds]) => ({
    id: `AS-${collector}`,
    collector,
    routes: routeIds,
    active: true,
  }))
}

export const assignments = buildAssignments()

export const vans = [
  { id: 'VAN-KCC-017', plate: 'KHULNA-METRO-TA-11-4520', type: 'compactor',    capacity: 3000, fuel: 'diesel',   ownership: 'owned',  gps: 'GPS-7781', odometer: 48210, status: 'active',         driver: 'C-042', fitnessExp: '2026-11-30', taxExp: '2026-09-15', insuranceExp: '2026-12-01', permitExp: '2027-01-20', nextServiceKm: 53000, kmpl: 6.1 },
  { id: 'VAN-KCC-004', plate: 'KHULNA-METRO-TA-11-2210', type: 'pickup',       capacity: 1200, fuel: 'diesel',   ownership: 'owned',  gps: 'GPS-3320', odometer: 91240, status: 'in_maintenance',driver: null,    fitnessExp: '2026-08-05', taxExp: '2026-07-19', insuranceExp: '2027-02-11', permitExp: '2026-12-03', nextServiceKm: 92000, kmpl: 8.4 },
  { id: 'VAN-KCC-022', plate: 'KHULNA-METRO-HA-13-8890', type: 'rickshaw-van', capacity: 400,  fuel: 'electric', ownership: 'leased', gps: 'GPS-9910', odometer: 12030, status: 'active',         driver: 'C-091', fitnessExp: '2027-05-22', taxExp: '2026-10-01', insuranceExp: '2026-11-14', permitExp: '2027-06-30', nextServiceKm: 15000, kmpl: null },
  { id: 'VAN-KCC-009', plate: 'KHULNA-METRO-TA-11-3345', type: 'tricycle',     capacity: 250,  fuel: 'electric', ownership: 'owned',  gps: 'GPS-1180', odometer: 8420,  status: 'idle',           driver: null,    fitnessExp: '2026-07-10', taxExp: '2026-08-25', insuranceExp: '2027-01-30', permitExp: '2026-09-09', nextServiceKm: 10000, kmpl: null },
  { id: 'VAN-KCC-031', plate: 'KHULNA-METRO-TA-11-5567', type: 'compactor',    capacity: 3000, fuel: 'diesel',   ownership: 'owned',  gps: 'GPS-4402', odometer: 60110, status: 'active',         driver: 'C-117', fitnessExp: '2026-10-18', taxExp: '2026-12-12', insuranceExp: '2026-07-28', permitExp: '2027-03-04', nextServiceKm: 63000, kmpl: 5.8 },
]

// Complaints carry a priority (drives SLA target), a description, and a full
// activity trail so the ticket drawer can show a lifecycle timeline.
export const complaints = [
  {
    id: 'CMP-20714', hh: 'HH-KCC-0012841', type: 'missed_collection', channel: 'sms',
    status: 'open', assigned: 'C-058', opened: '2026-07-05T08:12Z', sla: 12, ward: 'W-14',
    priority: 'high', description: 'Bin not collected on the scheduled morning round; waste piling up at the gate.',
    activity: [
      { at: '2026-07-05T08:12Z', action: 'created', by: 'Citizen · SMS', note: 'Logged via SMS short-code.' },
    ],
  },
  {
    id: 'CMP-20713', hh: 'HH-KCC-0021005', type: 'overflow', channel: 'app',
    status: 'in_progress', assigned: 'C-091', opened: '2026-07-05T07:40Z', sla: 4, ward: 'W-21',
    priority: 'urgent', description: 'Community bin overflowing onto Platinum Jubilee Rd — public health hazard.',
    activity: [
      { at: '2026-07-05T07:40Z', action: 'created', by: 'Citizen · App', note: 'Photo attached.' },
      { at: '2026-07-05T07:52Z', action: 'assigned', by: 'Control Room', note: 'Routed to Nasir Uddin (zone W-21).' },
      { at: '2026-07-05T08:30Z', action: 'in_progress', by: 'Nasir Uddin', note: 'On site; arranging an extra pickup.' },
    ],
  },
  {
    id: 'CMP-20710', hh: 'HH-KCC-0009050', type: 'billing_dispute', channel: 'app',
    status: 'assigned', assigned: 'C-104', opened: '2026-07-05T06:05Z', sla: 24, ward: 'W-09',
    priority: 'medium', description: 'Charged at residential-premium but the household is standard tier.',
    activity: [
      { at: '2026-07-05T06:05Z', action: 'created', by: 'Citizen · App', note: '' },
      { at: '2026-07-05T06:40Z', action: 'assigned', by: 'Control Room', note: 'Assigned to Habibur Rahman for tier verification.' },
    ],
  },
  {
    id: 'CMP-20705', hh: 'HH-KCC-0013111', type: 'staff_behaviour', channel: 'sms',
    status: 'resolved', assigned: 'C-073', opened: '2026-07-04T14:22Z', sla: 48, ward: 'W-15',
    priority: 'low', description: 'Collector reportedly rude to the household during pickup.',
    activity: [
      { at: '2026-07-04T14:22Z', action: 'created', by: 'Citizen · SMS', note: '' },
      { at: '2026-07-04T15:10Z', action: 'assigned', by: 'Control Room', note: '' },
      { at: '2026-07-05T09:00Z', action: 'in_progress', by: 'Jamal Uddin', note: 'Spoke with the household.' },
      { at: '2026-07-05T11:30Z', action: 'resolved', by: 'Tanvir Ahmed', note: 'Staff counselled; household satisfied.' },
    ],
  },
  {
    id: 'CMP-20701', hh: 'HH-KCC-0012842', type: 'missed_collection', channel: 'app',
    status: 'closed', assigned: 'C-042', opened: '2026-07-03T09:10Z', sla: 24, ward: 'W-14',
    priority: 'medium', description: 'Collection skipped on 3 July.',
    activity: [
      { at: '2026-07-03T09:10Z', action: 'created', by: 'Citizen · App', note: '' },
      { at: '2026-07-03T09:30Z', action: 'assigned', by: 'Control Room', note: '' },
      { at: '2026-07-03T12:00Z', action: 'in_progress', by: 'Rafiqul Islam', note: 'Return visit scheduled.' },
      { at: '2026-07-03T15:20Z', action: 'resolved', by: 'Rafiqul Islam', note: 'Waste collected the same day.' },
      { at: '2026-07-04T08:00Z', action: 'closed', by: 'Control Room', note: 'Confirmed with household.' },
    ],
  },
  {
    id: 'CMP-20698', hh: 'HH-KCC-0013110', type: 'overflow', channel: 'sms',
    status: 'resolved', assigned: 'C-117', opened: '2026-07-03T05:55Z', sla: 12, ward: 'W-15',
    priority: 'high', description: 'Overflowing bin near Nirala Residential Rd.',
    activity: [
      { at: '2026-07-03T05:55Z', action: 'created', by: 'Citizen · SMS', note: '' },
      { at: '2026-07-03T07:10Z', action: 'in_progress', by: 'Moshiur Rahman', note: 'Cleared and sanitised the spot.' },
      { at: '2026-07-03T08:30Z', action: 'resolved', by: 'Moshiur Rahman', note: '' },
    ],
  },
]

// ============================================================
// Operational history
// ============================================================
//
// Reports need depth: a daily/weekly/monthly/yearly view of collection and
// revenue is meaningless against two days of visits and one month of bills.
// This generates a rolling window that ends today, so the demo is always
// current rather than frozen on a date that recedes into the past.
//
// Everything is derived from the route plan, so a household's service history,
// its bills and the collector credited with them all agree by construction.

const HISTORY_DAYS = 90     // rolling service history
const BILL_MONTHS = 14      // spans two calendar years, so a yearly report has something to compare

// Deterministic PRNG — the same day always produces the same history, so a
// reload does not reshuffle every figure on screen.
function seededRandom(seed) {
  let state = seed >>> 0
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff
    return state / 0x7fffffff
  }
}

const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const isoMonth = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x }
const addMonths = (d, n) => { const x = new Date(d.getFullYear(), d.getMonth() + n, 1); return x }

function buildHistory() {
  const rnd = seededRandom(20260706)
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)]
  const pad = (v, n) => String(v).padStart(n, '0')
  const TODAY = new Date()
  TODAY.setHours(0, 0, 0, 0)

  const byId = new Map(households.map((h) => [h.id, h]))
  // Who walks each holding, and which holdings each collector walks.
  const owner = {}
  const round = {}
  routes.forEach((r) => {
    const holder = assignments.find((a) => (a.routes || []).includes(r.id))?.collector
    if (!holder) return
    r.stops.forEach((hh) => {
      owner[hh] = holder
      ;(round[holder] = round[holder] || []).push(hh)
    })
  })

  // ---- service history: one round per collector per working day ----
  const visits = []
  let vn = 0
  for (let back = HISTORY_DAYS; back >= 0; back--) {
    const date = addDays(TODAY, -back)
    const isToday = back === 0
    // Fridays are a lighter day in Khulna; no round is planned.
    if (date.getDay() === 5) continue

    Object.entries(round).forEach(([collector, stops]) => {
      stops.forEach((hh, i) => {
        // Today is still in progress — roughly half the round is done so far.
        if (isToday && rnd() > 0.55) return
        const roll = rnd()
        if (roll > 0.97) return                       // not reached at all
        const skipped = roll > 0.9
        vn += 1
        const hour = 6 + (i % 4)
        const minute = (i * 7 + Math.floor(rnd() * 6)) % 60
        visits.push({
          id: `V-${pad(vn, 6)}`,
          hh,
          collector,
          qr: byId.get(hh)?.qr || null,
          status: skipped ? 'skipped' : 'collected',
          at: `${isoDay(date)}T${pad(hour, 2)}:${pad(minute, 2)}:00`,
          accuracy: skipped ? null : 4 + Math.floor(rnd() * 9),
          source: rnd() > 0.35 ? 'scan' : 'manual',
          reason: skipped ? pick(['noOne', 'noWaste', 'locked', 'access']) : null,
          // the newest day may not have reached the server yet
          synced: !isToday || rnd() > 0.4,
        })
      })
    })
  }

  // ---- billing history: one bill per serviced holding per month ----
  const bills = []
  const payments = []
  let pn = 0
  const monthStart = addMonths(TODAY, -(BILL_MONTHS - 1))

  for (let m = 0; m < BILL_MONTHS; m++) {
    const month = addMonths(monthStart, m)
    const period = isoMonth(month)
    const isCurrent = period === isoMonth(TODAY)

    households.filter((h) => owner[h.id] && h.status === 'active').forEach((h) => {
      const amount = effectiveCharge(h)
      const issuedAt = `${period}-01`
      const bill = {
        id: `B-${period}-${h.id.slice(-7)}`,
        hh: h.id,
        head: h.head,
        period,
        issuedAt,
        amount,
        ward: h.ward,
        status: 'unpaid',
        method: null,
      }

      // Older months settle more completely than the current one.
      const roll = rnd()
      const settleRate = isCurrent ? 0.55 : 0.88
      let received = 0
      let method = null

      if (roll < settleRate) {
        method = h.paymentMode || pick(['cash', 'bkash', 'nagad'])
        const partial = rnd() < 0.14
        received = partial ? Math.round(amount * (0.3 + rnd() * 0.4)) : amount
        const payDay = Math.min(28, (h.paymentDay || 5) + Math.floor(rnd() * 6))
        pn += 1
        payments.push({
          id: `PAY-${period}-${pad(pn, 5)}`,
          bill: bill.id,
          hh: h.id,
          collector: owner[h.id],
          amount: received,
          method,
          at: `${period}-${pad(payDay, 2)}T${pad(10 + Math.floor(rnd() * 7), 2)}:00:00`,
        })
        bill.status = received >= amount ? 'paid' : 'partial'
        bill.method = method
      } else if (!isCurrent) {
        // Unpaid and the month has closed — that is overdue.
        bill.status = 'overdue'
      }

      bills.push(bill)
    })
  }

  // ---- cash handling: what each collector handed in, per month ----
  // Most deposits reconcile exactly; a few carry a shortfall or a late hand-in,
  // which is the whole reason a reconciliation report exists.
  const deposits = []
  const takings = {}
  payments.forEach((p) => {
    const key = `${p.collector}|${p.at.slice(0, 7)}|${p.method}`
    takings[key] = (takings[key] || 0) + p.amount
  })
  let dn = 0
  Object.entries(takings).forEach(([key, amount]) => {
    const [collector, period, method] = key.split('|')
    const roll = rnd()
    // 12% of hand-ins are short, 6% are still outstanding entirely.
    if (roll < 0.06) return
    const handed = roll < 0.18 ? Math.round(amount * (0.8 + rnd() * 0.15)) : amount
    dn += 1
    deposits.push({
      id: `DEP-${period}-${pad(dn, 4)}`,
      collector,
      period,
      method,
      amount: handed,
      at: `${period}-${pad(26 + Math.floor(rnd() * 3), 2)}T16:00:00`,
      ref: `DR-${pad(dn, 5)}`,
    })
  })

  return { visits, bills, payments, deposits }
}

const HISTORY = buildHistory()

export const visits = HISTORY.visits
export const bills = HISTORY.bills
export const payments = HISTORY.payments
export const deposits = HISTORY.deposits

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
  households, potentialCustomers, collectors, routes, assignments, vans, complaints,
  bills, payments, deposits, visits, maintenance, fuelLogs,
}
