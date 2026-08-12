"""src/data/mockData.js, transcribed.

Only the hand-written tables live here; everything the mock generated at import
time (extra households, profiles, routes, assignments, 90 days of history) is in
`generate.py`. Keys keep their JavaScript spelling — `zone` on a collector, `hh`
on a complaint — so this file can be diffed against the source by eye. The loader
is where they become model field names.

`dailyCollection`, `wardCollection`, `collectionTrend`, `wasteByZone` and `kpis`
are deliberately absent: swms.reports derives all five from the seeded rows.
"""

from __future__ import annotations

import datetime as dt

# --------------------------------------------------------------------------- #
# Geography
# --------------------------------------------------------------------------- #

WARDS = [
    {"id": "W-14", "key": "opt.ward.W-14", "name": "Ward 14 — Sonadanga", "zone": "Z-03"},
    {"id": "W-15", "key": "opt.ward.W-15", "name": "Ward 15 — Nirala", "zone": "Z-03"},
    {"id": "W-21", "key": "opt.ward.W-21", "name": "Ward 21 — Khalishpur", "zone": "Z-05"},
    {"id": "W-09", "key": "opt.ward.W-09", "name": "Ward 09 — Daulatpur", "zone": "Z-02"},
]

#: mockData.js has no zone table — `zone` was a bare string on the ward. The name
#: is the zone's lowest-numbered ward's locality, which is how `wasteByZone`
#: labelled its rows.
ZONES = [
    {"id": "Z-02", "key": "opt.zone.Z-02", "name": "Daulatpur"},
    {"id": "Z-03", "key": "opt.zone.Z-03", "name": "Sonadanga"},
    {"id": "Z-05", "key": "opt.zone.Z-05", "name": "Khalishpur"},
]

ROADS_BY_WARD = {
    "W-14": ["KDA Avenue", "Majid Sarani", "Sonadanga Main Road"],
    "W-15": ["Nirala Residential Rd", "Islampur Road"],
    "W-21": ["Platinum Jubilee Rd", "BIDC Road"],
    "W-09": ["Mohsin Road", "Deyana Main Road"],
}

#: Ward centres the generated households scatter around, and the live map centres on.
WARD_CENTERS = {
    "W-14": (22.8452, 89.5405),
    "W-15": (22.8212, 89.5552),
    "W-21": (22.8340, 89.5002),
    "W-09": (22.8510, 89.5175),
}

TIERS = [
    {"id": "residential_standard", "key": "opt.tier.residential_standard",
     "label": "Residential — standard", "charge": 100},
    {"id": "residential_premium", "key": "opt.tier.residential_premium",
     "label": "Residential — premium", "charge": 300},
    {"id": "commercial_small", "key": "opt.tier.commercial_small",
     "label": "Commercial — small", "charge": 250},
    {"id": "commercial_large", "key": "opt.tier.commercial_large",
     "label": "Commercial — large", "charge": 600},
]

# --------------------------------------------------------------------------- #
# Option lists
# --------------------------------------------------------------------------- #

CUSTOMER_TYPES = [
    {"id": "residential", "key": "opt.customerType.residential", "label": "Residential"},
    {"id": "commercial", "key": "opt.customerType.commercial", "label": "Commercial"},
    {"id": "institutional", "key": "opt.customerType.institutional", "label": "Institutional"},
    {"id": "industrial", "key": "opt.customerType.industrial", "label": "Industrial"},
]

HOLDING_TYPES = [
    {"id": "single_storey", "key": "opt.holdingType.single_storey",
     "label": "Single-storey house"},
    {"id": "multi_storey", "key": "opt.holdingType.multi_storey",
     "label": "Multi-storey building"},
    {"id": "apartment", "key": "opt.holdingType.apartment", "label": "Apartment / flat"},
    {"id": "tin_shed", "key": "opt.holdingType.tin_shed", "label": "Tin-shed / semi-pucca"},
    {"id": "shop", "key": "opt.holdingType.shop", "label": "Shop / market stall"},
    {"id": "office", "key": "opt.holdingType.office", "label": "Office / institution"},
]

STORAGE_TYPES = [
    {"id": "covered_bin", "key": "opt.storage.covered_bin", "label": "Covered bin"},
    {"id": "open_bin", "key": "opt.storage.open_bin", "label": "Open bin"},
    {"id": "segregated", "key": "opt.storage.segregated", "label": "Segregated (wet / dry)"},
    {"id": "sack", "key": "opt.storage.sack", "label": "Sack or bag"},
    {"id": "none", "key": "opt.storage.none", "label": "No storage"},
]

SUITABLE_TIMES = [
    {"id": "morning", "key": "opt.suitableTime.morning", "label": "Morning (6–9 am)"},
    {"id": "midday", "key": "opt.suitableTime.midday", "label": "Midday (9 am–12 pm)"},
    {"id": "afternoon", "key": "opt.suitableTime.afternoon", "label": "Afternoon (12–4 pm)"},
    {"id": "evening", "key": "opt.suitableTime.evening", "label": "Evening (4–8 pm)"},
    {"id": "any", "key": "opt.suitableTime.any", "label": "Any time"},
]

PAYMENT_MODES = [
    {"id": "cash", "key": "opt.paymentMode.cash", "label": "Cash"},
    {"id": "bkash", "key": "opt.paymentMode.bkash", "label": "bKash"},
    {"id": "nagad", "key": "opt.paymentMode.nagad", "label": "Nagad"},
    {"id": "rocket", "key": "opt.paymentMode.rocket", "label": "Rocket"},
    {"id": "bank", "key": "opt.paymentMode.bank", "label": "Bank transfer"},
]

POTENTIAL_REASONS = [
    {"id": "never_approached", "key": "opt.reason.never_approached", "label": "Never approached"},
    {"id": "refused_charge", "key": "opt.reason.refused_charge",
     "label": "Unwilling to pay the charge"},
    {"id": "own_arrangement", "key": "opt.reason.own_arrangement",
     "label": "Has a private arrangement"},
    {"id": "vacant", "key": "opt.reason.vacant", "label": "Vacant / under construction"},
    {"id": "past_dispute", "key": "opt.reason.past_dispute", "label": "Past service dispute"},
    {"id": "other", "key": "opt.reason.other", "label": "Other"},
]

TIME_GAPS = [
    {"id": "never", "key": "opt.timeGap.never", "label": "Never served"},
    {"id": "lt_3m", "key": "opt.timeGap.lt_3m", "label": "Under 3 months"},
    {"id": "3_6m", "key": "opt.timeGap.3_6m", "label": "3–6 months"},
    {"id": "6_12m", "key": "opt.timeGap.6_12m", "label": "6–12 months"},
    {"id": "gt_1y", "key": "opt.timeGap.gt_1y", "label": "Over a year"},
]

CURRENT_PRACTICES = [
    {"id": "private_collector", "key": "opt.practice.private_collector",
     "label": "Private collector"},
    {"id": "roadside_dump", "key": "opt.practice.roadside_dump",
     "label": "Dumps at roadside / drain"},
    {"id": "community_bin", "key": "opt.practice.community_bin",
     "label": "Carries to community bin"},
    {"id": "burns", "key": "opt.practice.burns", "label": "Burns the waste"},
    {"id": "composts", "key": "opt.practice.composts", "label": "Buries / composts on site"},
    {"id": "none", "key": "opt.practice.none", "label": "No fixed practice"},
]

#: Note U+2212 MINUS SIGN, matching catalog.BLOOD_GROUPS.
BLOOD_GROUPS = ["A+", "A−", "B+", "B−", "O+", "O−", "AB+", "AB−"]

# --------------------------------------------------------------------------- #
# Field staff
# --------------------------------------------------------------------------- #
# `zone` holds a ward id; the column it loads into is `Collector.ward`.
# `complaints` is dropped — the count is derived from the complaint table.

COLLECTORS = [
    {"id": "C-042", "name": "Rafiqul Islam", "dspId": "DSP-0042", "zone": "W-14",
     "phone": "+8801711-000042", "onTime": 96, "coverage": 98, "status": "on_route",
     "license": "DK-1145-A", "licenseExp": "2027-03-14", "joined": "2025-11-02",
     "attendance": "checked_in"},
    {"id": "C-058", "name": "Shahin Alam", "dspId": "DSP-0058", "zone": "W-14",
     "phone": "+8801711-000058", "onTime": 91, "coverage": 94, "status": "on_route",
     "license": "DK-2290-B", "licenseExp": "2026-08-30", "joined": "2026-01-19",
     "attendance": "checked_in"},
    {"id": "C-073", "name": "Jamal Uddin", "dspId": "DSP-0073", "zone": "W-15",
     "phone": "+8801711-000073", "onTime": 88, "coverage": 90, "status": "idle",
     "license": "DK-3381-A", "licenseExp": "2026-07-22", "joined": "2025-09-11",
     "attendance": "checked_in"},
    {"id": "C-091", "name": "Nasir Uddin", "dspId": "DSP-0091", "zone": "W-21",
     "phone": "+8801711-000091", "onTime": 99, "coverage": 97, "status": "on_route",
     "license": "DK-4417-C", "licenseExp": "2028-01-05", "joined": "2026-02-28",
     "attendance": "checked_in"},
    {"id": "C-104", "name": "Habibur Rahman", "dspId": "DSP-0104", "zone": "W-09",
     "phone": "+8801711-000104", "onTime": 84, "coverage": 87, "status": "on_route",
     "license": "DK-5528-A", "licenseExp": "2026-09-18", "joined": "2025-07-04",
     "attendance": "checked_in"},
    {"id": "C-117", "name": "Moshiur Rahman", "dspId": "DSP-0117", "zone": "W-15",
     "phone": "+8801711-000117", "onTime": 93, "coverage": 95, "status": "on_route",
     "license": "DK-6639-B", "licenseExp": "2027-11-27", "joined": "2026-03-15",
     "attendance": "checked_in"},
]

# --------------------------------------------------------------------------- #
# Households
# --------------------------------------------------------------------------- #
# `lastVisit` is dropped: there is no such column, and "last served" is derived
# from the visit log.

HOUSEHOLDS = [
    {"id": "HH-KCC-0012840", "qr": "SS-9F3A21", "ward": "W-14", "road": "KDA Avenue",
     "holding": "142/B", "head": "Abdul Karim", "phone": "+8801812-334455",
     "tier": "residential_standard", "status": "active", "lat": 22.8456, "lng": 89.5403},
    {"id": "HH-KCC-0012841", "qr": "SS-9F3A22", "ward": "W-14", "road": "KDA Avenue",
     "holding": "143", "head": "Rina Sultana", "phone": "+8801812-334456",
     "tier": "residential_standard", "status": "active", "lat": 22.8461, "lng": 89.5411},
    {"id": "HH-KCC-0012842", "qr": "SS-9F3A23", "ward": "W-14", "road": "Majid Sarani",
     "holding": "144/A", "head": "Mizanur Rahman", "phone": "+8801812-334457",
     "tier": "commercial_small", "status": "active", "lat": 22.8449, "lng": 89.5398},
    {"id": "HH-KCC-0012843", "qr": "SS-9F3A24", "ward": "W-14", "road": "Sonadanga Main Road",
     "holding": "77", "head": "Bilkis Ara", "phone": "+8801812-334458",
     "tier": "residential_standard", "status": "active", "lat": 22.8440, "lng": 89.5420},
    {"id": "HH-KCC-0013110", "qr": "SS-A1B2C3", "ward": "W-15", "road": "Nirala Residential Rd",
     "holding": "07/C", "head": "Farida Yasmin", "phone": "+8801812-556677",
     "tier": "residential_standard", "status": "active", "lat": 22.8201, "lng": 89.5567},
    {"id": "HH-KCC-0013111", "qr": "SS-A1B2C4", "ward": "W-15", "road": "Nirala Residential Rd",
     "holding": "08", "head": "Kamal Hossain", "phone": "+8801812-556678",
     "tier": "residential_premium", "status": "active", "lat": 22.8210, "lng": 89.5559},
    {"id": "HH-KCC-0013112", "qr": "SS-A1B2C5", "ward": "W-15", "road": "Islampur Road",
     "holding": "31", "head": "Sultana Razia", "phone": "+8801812-556679",
     "tier": "commercial_small", "status": "active", "lat": 22.8225, "lng": 89.5541},
    {"id": "HH-KCC-0021004", "qr": "SS-D4E5F6", "ward": "W-21", "road": "Platinum Jubilee Rd",
     "holding": "221", "head": "Selina Parvin", "phone": "+8801812-778899",
     "tier": "residential_standard", "status": "active", "lat": 22.8332, "lng": 89.5011},
    {"id": "HH-KCC-0021005", "qr": "SS-D4E5F7", "ward": "W-21", "road": "Platinum Jubilee Rd",
     "holding": "222", "head": "Anwar Hossain", "phone": "+8801812-778900",
     "tier": "commercial_small", "status": "inactive", "lat": 22.8339, "lng": 89.5004},
    {"id": "HH-KCC-0021006", "qr": "SS-D4E5F8", "ward": "W-21", "road": "BIDC Road",
     "holding": "19", "head": "Jahangir Alam", "phone": "+8801812-778901",
     "tier": "residential_standard", "status": "active", "lat": 22.8351, "lng": 89.4990},
    {"id": "HH-KCC-0009050", "qr": "SS-77AA11", "ward": "W-09", "road": "Mohsin Road",
     "holding": "15/B", "head": "Ruksana Begum", "phone": "+8801812-990011",
     "tier": "residential_standard", "status": "active", "lat": 22.8501, "lng": 89.5183},
    {"id": "HH-KCC-0009051", "qr": "SS-77AA12", "ward": "W-09", "road": "Mohsin Road",
     "holding": "16", "head": "Tariqul Islam", "phone": "+8801812-990012",
     "tier": "residential_standard", "status": "active", "lat": 22.8512, "lng": 89.5190},
    {"id": "HH-KCC-0009052", "qr": "SS-77AA13", "ward": "W-09", "road": "Deyana Main Road",
     "holding": "04/A", "head": "Momena Khatun", "phone": "+8801812-990013",
     "tier": "residential_premium", "status": "active", "lat": 22.8523, "lng": 89.5165},
]

POTENTIAL_CUSTOMERS = [
    {"id": "POT-3001", "ward": "W-14", "road": "Majid Sarani", "holding": "150",
     "head": "Nurul Amin", "phone": "+8801713-100001", "estTier": "residential_standard",
     "surveyedAt": "2026-07-02", "surveyor": "C-058"},
    {"id": "POT-3002", "ward": "W-14", "road": "Sonadanga Main Road", "holding": "81",
     "head": "Rehana Begum", "phone": "+8801713-100002", "estTier": "commercial_small",
     "surveyedAt": "2026-07-02", "surveyor": "C-058"},
    {"id": "POT-3003", "ward": "W-15", "road": "Islampur Road", "holding": "33",
     "head": "Delwar Hossain", "phone": "+8801713-100003", "estTier": "residential_standard",
     "surveyedAt": "2026-07-03", "surveyor": "C-117"},
    {"id": "POT-3004", "ward": "W-21", "road": "BIDC Road", "holding": "25",
     "head": "Shirin Akter", "phone": "+8801713-100004", "estTier": "residential_standard",
     "surveyedAt": "2026-07-01", "surveyor": "C-091"},
    {"id": "POT-3005", "ward": "W-21", "road": "BIDC Road", "holding": "26",
     "head": "Fazlul Haque", "phone": "+8801713-100005", "estTier": "commercial_large",
     "surveyedAt": "2026-07-01", "surveyor": "C-091"},
    {"id": "POT-3006", "ward": "W-09", "road": "Deyana Main Road", "holding": "09",
     "head": "Ayesha Siddika", "phone": "+8801713-100006", "estTier": "residential_standard",
     "surveyedAt": "2026-07-04", "surveyor": "C-104"},
]

#: Holdings kept without a confirmed GPS fix, so the verification queue and the
#: "not on any route" warning both have something to show.
UNVERIFIED = {"HH-KCC-0012841", "HH-KCC-0021005", "HH-KCC-0009051", "HH-KCC-05009"}

# Profile enrichment, applied by index so every seeded row demos a full sheet.
HEAD_NAMES = [
    "Abdur Rob", "Shahida Khatun", "Nazmul Huda", "Parvez Alam", "Rokeya Begum",
    "Delwar Hossain", "Shefali Akter", "Golam Rabbani", "Nurjahan Begum", "Aminul Islam",
    "Sharmin Sultana", "Kabir Ahmed", "Rehana Parvin", "Sohel Rana", "Momtaz Begum",
    "Faruk Hossain", "Jesmin Ara", "Bashir Uddin", "Anwara Begum", "Rashedul Karim",
    "Salma Khatun", "Emdadul Haque", "Nasima Begum", "Torikul Islam",
]
PROFESSIONS = [
    "Shopkeeper", "School teacher", "Garment worker", "Rickshaw puller", "Govt. service",
    "Homemaker", "Small trader", "Bank officer", "Day labourer", "Tailor", "Van driver", "Nurse",
]
RELATIONS = ["Son", "Spouse", "Daughter", "Brother", "Caretaker", "Manager"]
FLOORS = ["Ground", "1st floor", "2nd floor", "3rd floor", "4th floor"]

# --------------------------------------------------------------------------- #
# Fleet
# --------------------------------------------------------------------------- #

VANS = [
    {"id": "VAN-KCC-017", "plate": "KHULNA-METRO-TA-11-4520", "type": "compactor",
     "capacity": 3000, "fuel": "diesel", "ownership": "owned", "gps": "GPS-7781",
     "odometer": 48210, "status": "active", "driver": "C-042", "fitnessExp": "2026-11-30",
     "taxExp": "2026-09-15", "insuranceExp": "2026-12-01", "permitExp": "2027-01-20",
     "nextServiceKm": 53000, "kmpl": 6.1},
    {"id": "VAN-KCC-004", "plate": "KHULNA-METRO-TA-11-2210", "type": "pickup",
     "capacity": 1200, "fuel": "diesel", "ownership": "owned", "gps": "GPS-3320",
     "odometer": 91240, "status": "in_maintenance", "driver": None, "fitnessExp": "2026-08-05",
     "taxExp": "2026-07-19", "insuranceExp": "2027-02-11", "permitExp": "2026-12-03",
     "nextServiceKm": 92000, "kmpl": 8.4},
    {"id": "VAN-KCC-022", "plate": "KHULNA-METRO-HA-13-8890", "type": "rickshaw-van",
     "capacity": 400, "fuel": "electric", "ownership": "leased", "gps": "GPS-9910",
     "odometer": 12030, "status": "active", "driver": "C-091", "fitnessExp": "2027-05-22",
     "taxExp": "2026-10-01", "insuranceExp": "2026-11-14", "permitExp": "2027-06-30",
     "nextServiceKm": 15000, "kmpl": None},
    {"id": "VAN-KCC-009", "plate": "KHULNA-METRO-TA-11-3345", "type": "tricycle",
     "capacity": 250, "fuel": "electric", "ownership": "owned", "gps": "GPS-1180",
     "odometer": 8420, "status": "idle", "driver": None, "fitnessExp": "2026-07-10",
     "taxExp": "2026-08-25", "insuranceExp": "2027-01-30", "permitExp": "2026-09-09",
     "nextServiceKm": 10000, "kmpl": None},
    {"id": "VAN-KCC-031", "plate": "KHULNA-METRO-TA-11-5567", "type": "compactor",
     "capacity": 3000, "fuel": "diesel", "ownership": "owned", "gps": "GPS-4402",
     "odometer": 60110, "status": "active", "driver": "C-117", "fitnessExp": "2026-10-18",
     "taxExp": "2026-12-12", "insuranceExp": "2026-07-28", "permitExp": "2027-03-04",
     "nextServiceKm": 63000, "kmpl": 5.8},
]

MAINTENANCE = [
    {"id": "MNT-3341", "van": "VAN-KCC-004", "kind": "unscheduled",
     "reason": "Hydraulic lift failure", "odometer": 91240, "opened": "2026-07-04T09:00Z",
     "closed": None, "downtime": 30, "cost": 8600, "vendor": "City Workshop Ltd."},
    {"id": "MNT-3336", "van": "VAN-KCC-017", "kind": "scheduled", "reason": "5000km service",
     "odometer": 48000, "opened": "2026-07-02T09:00Z", "closed": "2026-07-02T15:30Z",
     "downtime": 6.5, "cost": 4300, "vendor": "City Workshop Ltd."},
    {"id": "MNT-3330", "van": "VAN-KCC-031", "kind": "scheduled",
     "reason": "Brake pad replacement", "odometer": 59500, "opened": "2026-06-28T10:00Z",
     "closed": "2026-06-28T13:00Z", "downtime": 3, "cost": 2100, "vendor": "Metro Auto Care"},
]

FUEL_LOGS = [
    {"id": "FUEL-5521", "van": "VAN-KCC-017", "litres": 32.5, "cost": 3900, "odometer": 48210,
     "by": "C-042", "at": "2026-07-05T05:50Z", "kmpl": 6.1},
    {"id": "FUEL-5518", "van": "VAN-KCC-031", "litres": 40.0, "cost": 4800, "odometer": 60110,
     "by": "C-117", "at": "2026-07-04T05:40Z", "kmpl": 5.8},
    {"id": "FUEL-5512", "van": "VAN-KCC-004", "litres": 28.0, "cost": 3360, "odometer": 91100,
     "by": "C-073", "at": "2026-07-02T06:10Z", "kmpl": 8.4},
    {"id": "FUEL-5509", "van": "VAN-KCC-017", "litres": 30.0, "cost": 3600, "odometer": 47720,
     "by": "C-042", "at": "2026-07-01T05:55Z", "kmpl": 4.2},
]

# --------------------------------------------------------------------------- #
# Complaints
# --------------------------------------------------------------------------- #
# `sla` is dropped: complaints.SLA_HOURS derives it from the priority, and every
# hand-written value in the mock already agreed with it.

COMPLAINTS = [
    {
        "id": "CMP-20714", "hh": "HH-KCC-0012841", "type": "missed_collection",
        "channel": "sms", "status": "open", "assigned": "C-058",
        "opened": "2026-07-05T08:12Z", "ward": "W-14", "priority": "high",
        "description": "Bin not collected on the scheduled morning round; "
                       "waste piling up at the gate.",
        "activity": [
            {"at": "2026-07-05T08:12Z", "action": "created", "by": "Citizen · SMS",
             "note": "Logged via SMS short-code."},
        ],
    },
    {
        "id": "CMP-20713", "hh": "HH-KCC-0021005", "type": "overflow", "channel": "app",
        "status": "in_progress", "assigned": "C-091", "opened": "2026-07-05T07:40Z",
        "ward": "W-21", "priority": "urgent",
        "description": "Community bin overflowing onto Platinum Jubilee Rd — "
                       "public health hazard.",
        "activity": [
            {"at": "2026-07-05T07:40Z", "action": "created", "by": "Citizen · App",
             "note": "Photo attached."},
            {"at": "2026-07-05T07:52Z", "action": "assigned", "by": "Control Room",
             "note": "Routed to Nasir Uddin (zone W-21)."},
            {"at": "2026-07-05T08:30Z", "action": "in_progress", "by": "Nasir Uddin",
             "note": "On site; arranging an extra pickup."},
        ],
    },
    {
        "id": "CMP-20710", "hh": "HH-KCC-0009050", "type": "billing_dispute", "channel": "app",
        "status": "assigned", "assigned": "C-104", "opened": "2026-07-05T06:05Z",
        "ward": "W-09", "priority": "medium",
        "description": "Charged at residential-premium but the household is standard tier.",
        "activity": [
            {"at": "2026-07-05T06:05Z", "action": "created", "by": "Citizen · App", "note": ""},
            {"at": "2026-07-05T06:40Z", "action": "assigned", "by": "Control Room",
             "note": "Assigned to Habibur Rahman for tier verification."},
        ],
    },
    {
        "id": "CMP-20705", "hh": "HH-KCC-0013111", "type": "staff_behaviour", "channel": "sms",
        "status": "resolved", "assigned": "C-073", "opened": "2026-07-04T14:22Z",
        "ward": "W-15", "priority": "low",
        "description": "Collector reportedly rude to the household during pickup.",
        "activity": [
            {"at": "2026-07-04T14:22Z", "action": "created", "by": "Citizen · SMS", "note": ""},
            {"at": "2026-07-04T15:10Z", "action": "assigned", "by": "Control Room", "note": ""},
            {"at": "2026-07-05T09:00Z", "action": "in_progress", "by": "Jamal Uddin",
             "note": "Spoke with the household."},
            {"at": "2026-07-05T11:30Z", "action": "resolved", "by": "Tanvir Ahmed",
             "note": "Staff counselled; household satisfied."},
        ],
    },
    {
        "id": "CMP-20701", "hh": "HH-KCC-0012842", "type": "missed_collection", "channel": "app",
        "status": "closed", "assigned": "C-042", "opened": "2026-07-03T09:10Z",
        "ward": "W-14", "priority": "medium",
        "description": "Collection skipped on 3 July.",
        "activity": [
            {"at": "2026-07-03T09:10Z", "action": "created", "by": "Citizen · App", "note": ""},
            {"at": "2026-07-03T09:30Z", "action": "assigned", "by": "Control Room", "note": ""},
            {"at": "2026-07-03T12:00Z", "action": "in_progress", "by": "Rafiqul Islam",
             "note": "Return visit scheduled."},
            {"at": "2026-07-03T15:20Z", "action": "resolved", "by": "Rafiqul Islam",
             "note": "Waste collected the same day."},
            {"at": "2026-07-04T08:00Z", "action": "closed", "by": "Control Room",
             "note": "Confirmed with household."},
        ],
    },
    {
        "id": "CMP-20698", "hh": "HH-KCC-0013110", "type": "overflow", "channel": "sms",
        "status": "resolved", "assigned": "C-117", "opened": "2026-07-03T05:55Z",
        "ward": "W-15", "priority": "high",
        "description": "Overflowing bin near Nirala Residential Rd.",
        "activity": [
            {"at": "2026-07-03T05:55Z", "action": "created", "by": "Citizen · SMS", "note": ""},
            {"at": "2026-07-03T07:10Z", "action": "in_progress", "by": "Moshiur Rahman",
             "note": "Cleared and sanitised the spot."},
            {"at": "2026-07-03T08:30Z", "action": "resolved", "by": "Moshiur Rahman",
             "note": ""},
        ],
    },
]

# --------------------------------------------------------------------------- #
# History generation parameters
# --------------------------------------------------------------------------- #

HISTORY_SEED = 20260706
HISTORY_DAYS = 90
BILL_MONTHS = 14

#: Khulna plans no round on Fridays. Python's weekday(): Monday 0, Friday 4.
FRIDAY = 4

ROUTE_WINDOWS = [
    (dt.time(6, 0), dt.time(9, 30)),
    (dt.time(6, 30), dt.time(10, 0)),
    (dt.time(7, 0), dt.time(10, 30)),
]

SKIP_REASONS = ["noOne", "noWaste", "locked", "access"]

# --------------------------------------------------------------------------- #
# Login accounts
# --------------------------------------------------------------------------- #
# `role` and `scope` in the mock were display strings; here they resolve to a
# Role slug and a ScopeKind. `collector` links the login to its field-staff row.

OPERATORS = [
    {"phone": "01711000042", "name": "Rafiqul Islam", "role": "collector",
     "scope_kind": "ward", "scope_wards": ["W-14"], "collector": "C-042"},
    {"phone": "01700112233", "name": "Tanvir Ahmed", "role": "supervisor",
     "scope_kind": "zone", "scope_zone": "Z-03"},
    {"phone": "01900445566", "name": "Farhana Haque", "role": "agency_admin",
     "scope_kind": "agency"},
    {"phone": "01800778899", "name": "KCC Cell", "role": "kcc_viewer", "scope_kind": "city"},
]

#: The contractor supplying the demo collectors. One agency, matching how the
#: live database looked when agencies were introduced.
AGENCY = {
    "name": "Premier Clean Management",
    "shortCode": "PCM",
    "type": "private",
    "contactPerson": "Shahidul Islam",
    "phone": "+8801711-445566",
    "contractNo": "KCC/SWM/2026/07",
    "contractStart": "2026-01-01",
    "contractEnd": "2027-12-31",
}

DEMO_PIN = "1470"
# Login is phone + password, so every seeded operator needs one or the demo
# accounts cannot sign in at all.
DEMO_PASSWORD = "swms1234"
SUPERUSER_PHONE = "01900000000"
SUPERUSER_PASSWORD = "admin1234"


def tier_charge(tier_id: str | None) -> int:
    for tier in TIERS:
        if tier["id"] == tier_id:
            return tier["charge"]
    return 0


def effective_charge(record: dict) -> int:
    """A negotiated charge beats the tier's standard rate — mockData's `effectiveCharge`."""
    agreed = record.get("charge") or 0
    return agreed if agreed > 0 else tier_charge(record.get("tier") or record.get("estTier"))
