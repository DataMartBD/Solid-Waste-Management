"""The KCC requirements gap analysis, as data.

Both renderers — `gap_analysis_build.py` (Word) and `gap_analysis_pdf.py` (PDF)
— read from here, so the two documents cannot say different things. Update a
finding once and regenerate both.

Every "Built" claim was checked against the code, not remembered: models in
server/swms/*/models.py, routes in server/swms/*/urls.py, pages in src/pages/.

Each finding is (section, requirement, status, what exists, what is missing);
status is one of Built / Partial / Missing.
"""

from __future__ import annotations

import re


def first_sentence(text: str) -> str:
    """The opening sentence of a gap note, for the summary tables.

    Splitting on "." alone cut `Agency.service_wards` in half, so this breaks on
    a full stop followed by whitespace and a capital — the shape of a real
    sentence end rather than of a dotted name.
    """
    stripped = text.strip()
    if stripped == "—":
        return stripped
    match = re.search(r"(?<=[.!?])\s+(?=[A-Z“\"])", stripped)
    return stripped[: match.start()] if match else stripped


# --------------------------------------------------------------------------- #
# The analysis. (section, requirement, status, what exists, what is missing)
# --------------------------------------------------------------------------- #

FINDINGS = [
    # ---------------------------------------------------- A. KCC perspective
    ("A. Khulna City Corporation", "A1. Monthly reporting and accountability", "Partial",
     "Agency master holds each operator with type (private / NGO / CBO / cooperative), "
     "contract dates, licence and TIN/BIN. Royalty is tracked end to end: collector "
     "deposit → agency → KCC remittance, with a reconciliation report that ties "
     "collected, deposited and remitted together per month. Reports for service "
     "delivery, bill collection, complaints and KPIs all filter by agency.",
     "There is no monthly return as a document an operator submits and KCC marks off. "
     "Nothing answers “which operators have reported for July, and which have not”. "
     "The figures exist but are pulled by KCC, not pushed by the operator, so an "
     "operator that stops reporting is invisible rather than flagged. No exception "
     "alerts. “Individual collector” is not one of the four agency types."),

    ("A. Khulna City Corporation", "A2. Road-wise service coverage and authorisation", "Missing",
     "Roads exist as real records under each ward. Routes carry an ordered stop list "
     "and are stamped with the agency that walks them, and every holding can hold a "
     "verified GPS pin. A Leaflet map is already in the product for live vehicle "
     "tracking.",
     "Service areas are defined at ward level only (Agency.service_wards). There is no "
     "road-to-operator assignment, so the question the document asks — “which NGO "
     "or operator works which road” — cannot be answered directly. No written "
     "authorisation is recorded against a service area. Nothing detects two operators "
     "claiming the same road, or an operator working outside their area. The map shows "
     "vehicles, not service boundaries or coverage status."),

    ("A. Khulna City Corporation", "A3. Household coverage and registry", "Built",
     "This is the most complete area. Holding Master records the building "
     "(holding number, owner name and mobile, ward, road, GPS pin, type, unit count) "
     "and households hang off it, so one building with twelve flats is one address and "
     "twelve billable customers. Service status is derived from the households rather "
     "than stored, so it cannot go stale. Households outside the service are held "
     "separately as potential customers with a recorded reason. Collection history is "
     "the visit log, per household per day.",
     "Only the campaign side is absent: uncovered households can be listed but not "
     "worked as a campaign list (see B2/B6)."),

    # -------------------------------------------- B. Primary collector view
    ("B. Primary Collector", "B1. Service continuity and backup arrangements", "Missing",
     "Collectors carry a current status and attendance value, and employment history "
     "records which agency employed them and when.",
     "Attendance is today’s value only — there is no dated register, so “how "
     "often was this collector absent last month” cannot be answered. No backup worker "
     "arrangement: nothing names a substitute or reassigns a route when someone is "
     "sick, which is the specific failure the document describes. Supervisor and "
     "collector contact numbers are not published to holding owners."),

    ("B. Primary Collector", "B2. Citizen campaign and enforcement support", "Missing",
     "Service tiers carry the standard monthly charge, so tariff figures exist. "
     "Households outside the service are already listed with a reason and current "
     "disposal practice.",
     "No campaign module of any kind: miking, handbill distribution, courtyard "
     "meetings and ward campaigns have nowhere to be recorded or tracked. No violation "
     "or enforcement register for illegal disposal, and no follow-up workflow. Tariff "
     "information is internal only — nothing publishes it to citizens."),

    ("B. Primary Collector", "B3. Daily work records and complaint handling", "Built",
     "Complaints carry a ticket id, type, ward, household, channel, priority, assigned "
     "person, status and SLA, with a full activity trail and photo attachments. Daily "
     "work is the visit log: every household visit records collector, time, GPS "
     "accuracy, whether it was scanned or keyed, and a skip reason when waste was not "
     "taken. Both survive a poor connection through bulk upload endpoints that report "
     "per-row outcomes.",
     "A complaint is located by ward and household rather than by a map pin. There is "
     "no daily work register as a signed-off document per collector per day — the "
     "data is there, but as a derived view rather than a submitted return."),

    ("B. Primary Collector", "B4. Collection delay and missed-collection alerts", "Partial",
     "The daily round screen shows each collector their stops in walking order with "
     "counts for done, skipped and pending. Coverage and on-time percentages are "
     "recalculated from the visit log rather than typed in.",
     "Nothing raises an alert. A round that is never completed produces a low number "
     "on a report somebody has to open — there is no missed-collection alert, no "
     "route-completion signal and no supervisor verification step. Waste found dumped "
     "on a road inside the coverage area has nowhere to be recorded."),

    ("B. Primary Collector", "B5. Infrastructure, equipment and dumping points", "Partial",
     "Vans are fully covered: plate, type, capacity, fuel, ownership, GPS unit, "
     "odometer, driver, and expiry dates for fitness, tax, insurance and permit, plus "
     "maintenance and fuel logs and live positions.",
     "Everything that is not a vehicle is absent. No dumping points or secondary "
     "transfer stations, no bin inventory or bin location map, no equipment or stock "
     "register, and no record of equipment deficits — all of which the document names "
     "explicitly. Van condition is a single status value, not an inspection record."),

    ("B. Primary Collector", "B6. Community participation and engagement", "Missing",
     "Household and holding records carry owner contact details, and the new survey "
     "module captures willingness to pay, current disposal practice and reasons for "
     "not using a van.",
     "No engagement tracker: no contact history, no participation status over time, no "
     "campaign coverage per household and no follow-up actions. Local committees have "
     "nowhere to be recorded. The survey answers the question once; nothing tracks what "
     "was done about the answer."),

    ("B. Primary Collector", "B7. Financial sustainability and fee collection", "Partial",
     "Strong coverage. Monthly billing runs generate bills per household; payments "
     "record amount, method, collector, agency and transaction reference; arrears and "
     "dues are reported per household and per ward; and money is traceable from the "
     "doorstep to KCC through deposit and remittance with a reconciliation report.",
     "No formal receipt is issued to the household — the payment reference field is a "
     "bKash or bank transaction id, not a numbered receipt the citizen keeps. No cash "
     "book, ledger or voucher views, which the document lists as current practice. "
     "Households repeatedly unavailable at collection time are not flagged."),

    ("B. Primary Collector", "B8. Worker capacity, training and wellbeing", "Missing",
     "Collector records hold name, staff id, phone, licence number and expiry, joining "
     "date and current agency, with employment history across agencies.",
     "None of the wellbeing or capacity data the document asks for exists: no training "
     "record, no attendance register, no salary register, no health incident log, no "
     "PPE issue and status tracking, and no document storage for appointment letters. "
     "This is the largest single gap by volume of missing records."),

    ("B. Primary Collector", "B9. Monitoring, escalation and taskforce", "Partial",
     "Complaints carry priority and an SLA in hours, and the dashboard gives "
     "supervisors open counts by status and ward. Access is role-based and scoped by "
     "ward and agency, so each operator sees only their own work.",
     "The SLA is recorded but not enforced — nothing escalates a breach or alerts "
     "anyone. No taskforce issue tracker separate from citizen complaints, so an "
     "internal operational problem has to be filed as if a citizen reported it. No "
     "action-status monitoring or escalation workflow."),

    # ------------------------------------------- C. Data management modules
    ("C. Data Management", "C1. Baseline and household information", "Built",
     "Location, ward, holding number, owner details, mobile number and the number of "
     "households under each holding are all held, and the holding is the single writer "
     "of the address so the figures cannot disagree between screens.",
     "—"),

    ("C. Data Management", "C2. Waste worker and route records", "Partial",
     "Route assignment is complete: routes, ordered stops, assignments to collectors, "
     "and reassignment. Collector biodata is partly held.",
     "Appointment letters, salary register, monthly worker meeting records and "
     "training records have no home in the system. Attendance is current-state only."),

    ("C. Data Management", "C3. Finance and payment records", "Partial",
     "Fee collection, service charge communication and royalty payment records are "
     "covered by bills, payments, deposits and remittances with a reconciliation view.",
     "Cash book, ledger and voucher records are not modelled, and no fee collection "
     "sheet or numbered receipt is produced as a document."),

    ("C. Data Management", "C4. Vehicle, equipment and stock records", "Partial",
     "Van register and van maintenance register are complete and in daily use.",
     "Stock register, equipment deficit records, and disposal or dispatch records are "
     "absent, as is any dumping point record."),

    ("C. Data Management", "C5. Service, complaint and reporting records", "Partial",
     "Service recipient register, complaint register and the reporting dashboard are "
     "built, and the survey data collection sheet is now a full versioned survey module "
     "with a 72-question door-to-door form, offline capture and promotion of a "
     "reviewed survey into the holding register.",
     "Meeting resolutions, training and workshop files, and a knowledge repository have "
     "nowhere to live — the document lists all three as records KCC keeps today."),
]

CROSS_CUTTING = [
    ("Bengali language support", "Built",
     "The whole interface ships in Bangla and English, and a test enforces that every "
     "key exists in both so a new screen cannot ship half-translated. The survey "
     "module carries Bangla for every question, hint and option, served from the "
     "database rather than the front end, so a revised form needs no release."),
    ("Role-based access", "Built",
     "Four roles, with access scoped on two independent axes — ward and agency — so "
     "two contractors working the same ward never see each other’s records. Write "
     "guards apply on the way in as well as the way out."),
    ("Mobile-friendly for low-skill users", "Partial",
     "The layout is responsive and the daily round screen is built for a phone, with "
     "QR scanning for households. But this is a browser application, not an installable "
     "app: there is no home-screen install, no offline shell, and a worker who loses "
     "signal loses the page."),
    ("Working offline in the field", "Partial",
     "The server side is ready: visits and surveys both accept a queued batch and "
     "answer per row, so one bad record cannot cost a worker their morning. The design "
     "the document needs is in place.",),
    ("Notifications to citizens and staff", "Missing",
     "Nothing leaves the system. There is no SMS or email delivery at all — the login "
     "code is generated but never sent, and SMS exists only as a label on how a "
     "complaint arrived. Tariff notices, collection reminders, dues reminders and "
     "complaint updates all require this."),
]

PRIORITIES = [
    ("1", "Road-wise operator assignment and authorisation", "A2",
     "KCC's clearest unmet ask, and everything about overlap and unauthorised entry "
     "depends on it. Assign roads to operators, record the authorisation, and flag "
     "roads claimed twice or served by nobody.",
     "Medium — the road and agency records already exist; this is a join, a screen "
     "and an overlap report."),
    ("2", "Monthly operator return with submission tracking", "A1",
     "Turns reporting from something KCC pulls into something operators submit and KCC "
     "signs off, which is what accountability means here. The figures are already "
     "calculated; what is missing is the envelope and the submitted / not submitted "
     "state.",
     "Medium — mostly assembling existing reports behind a submit-and-review flow."),
    ("3", "SMS notifications", "Cross-cutting",
     "Unblocks tariff communication, dues reminders, complaint updates and collection "
     "alerts in one piece of work. Several other gaps are only half-solvable without "
     "it. A provider is already in use elsewhere in your estate.",
     "Small — one service, one queue, and the call sites."),
    ("4", "Worker register: attendance, training, PPE, health, salary", "B8",
     "The largest block of missing records, and the document is specific about each "
     "one. Also the precondition for the backup-worker arrangement in B1.",
     "Large — several related records, but each one simple."),
    ("5", "Missed-collection alerts and supervisor verification", "B4",
     "The visit data needed already exists; what is missing is the rule that turns an "
     "incomplete round into something that reaches a supervisor the same day.",
     "Small — a scheduled check over the visit log, plus a verification action."),
    ("6", "Campaign and enforcement module", "B2 / B6",
     "Covers miking, handbills, courtyard meetings, ward campaigns, the "
     "non-participating household list and violation follow-up. Directly serves the "
     "behaviour problem the collectors described.",
     "Medium — a campaign record, a participation tracker and a violation register."),
    ("7", "Dumping points, bins and equipment stock", "B5 / C4",
     "Completes the asset side, which currently stops at vehicles.",
     "Medium — three straightforward registers plus a bin location map."),
    ("8", "Numbered receipts, cash book and voucher trail", "B7 / C3",
     "Matches the paper records operators keep today, which matters for adoption and "
     "for audit.",
     "Medium — a receipt series on payments, then ledger views over existing data."),
    ("9", "Taskforce tracker and SLA escalation", "B9",
     "Separates internal operational issues from citizen complaints, and makes the SLA "
     "that is already recorded actually do something.",
     "Small to medium — escalation rules over complaints, plus an internal issue type."),
    ("10", "Installable mobile app with offline capture", "Cross-cutting",
     "The server already accepts queued batches; the missing half is a client that "
     "keeps working with no signal. The document is explicit that workers have limited "
     "digital skills and need this to be simple.",
     "Large — offline storage, sync state and an install target."),
]


