# What the system offers the City Corporation

Proposal for the City Corporation's own login ("City Viewer" role, read-only).
Focus: customer-service targets, service growth, and complaint management.
No money figures anywhere in this role (no bills, payments, remittances).

---------------------------------------------------------------------------
## 1. Who sees what (access)

| Role                  | Area                                    | Can change data? | Financial? |
|-----------------------|-----------------------------------------|------------------|------------|
| City Corporation user | Whole city (or one city/pourashova)     | No (read-only)   | No         |
| Agency admin          | Own agency, its cities' wards           | Yes              | Own only   |
| Supervisor            | Own wards / zone / agency area          | Yes (field work) | No         |
| Collector             | Own wards                               | Own round only   | No         |

The City Corporation sees every agency side by side, so it can compare
contractors. Contractors never see each other.

---------------------------------------------------------------------------
## 2. Service coverage and growth (the main target report)

Question answered: "How many holdings does each collector / supervisor /
agency serve, month by month, and is it growing or shrinking?"

### 2a. Monthly service trend (by agency, supervisor area or collector)

| Month    | Agency      | Holdings registered | Holdings served | Served % | Change vs last month | Trend |
|----------|-------------|---------------------|-----------------|----------|----------------------|-------|
| 2026-09  | Green Co    | 1,240               | 1,105           | 89%      | +35 (+3.3%)          | UP    |
| 2026-10  | Green Co    | 1,260               | 1,090           | 87%      | -15 (-1.4%)          | DOWN  |

- "Registered" = active holdings in the agency's / collector's wards.
- "Served" = holdings with at least one confirmed collection in the month.
- Trend = UP / DOWN / FLAT against the previous month, and against the
  same month last year (yearly view).
- Same table switchable to: per collector, per supervisor area, per ward.
- Yearly view: one row per year with year-on-year growth.

### 2b. Target vs actual

| Agency   | Target holdings (contract) | Served this month | Achievement | New this month | Dropped |
|----------|----------------------------|-------------------|-------------|----------------|---------|
| Green Co | 1,500                      | 1,090             | 73%         | +42            | -12     |

- Target comes from the agency's contract (one new field: target holdings,
  or target per ward).
- "New" = holdings added; "Dropped" = holdings marked inactive / not served
  for the whole month.
- Colour: green >= 90%, amber 75-89%, red < 75%.

### 2c. Daily collection reliability

| Ward | Due today | Collected | Missed | Confirmed by agency | Auto-closed | Reliability |
|------|-----------|-----------|--------|---------------------|-------------|-------------|

(Already exists as the City Dashboard; add a month/year roll-up.)

---------------------------------------------------------------------------
## 3. Complaint management

### 3a. Complaint nature (what citizens complain about)

Types already in the system: Missed collection, Bin overflow, Billing dispute,
Staff behaviour, Other. Channels: SMS, phone, app, walk-in.

| Type              | This month | Last month | Change | Share |
|-------------------|------------|------------|--------|-------|
| Missed collection | 48         | 61         | -21%   | 52%   |
| Bin overflow      | 22         | 18         | +22%   | 24%   |
| Staff behaviour   | 9          | 4          | +125%  | 10%   |

Also by ward and by agency (heat-map: wards with most complaints per 100 holdings).

### 3b. How complaints are answered (response process)

Lifecycle: Open -> Assigned -> In progress -> Resolved -> Closed (Reopen if the
citizen says it is not fixed).

| Priority | Response deadline (SLA) |
|----------|-------------------------|
| Urgent   | 4 hours                 |
| High     | 12 hours                |
| Medium   | 24 hours                |
| Low      | 48 hours                |

Who responds:
- Collector: sees complaints of own wards, records "attended" with photo.
- Supervisor: assigns to a collector of own wards, follows up, resolves.
- Agency admin: watches the agency's queue, escalates.
- City Corporation: read-only watch + can add a note / reopen (suggested new
  permission) so the corporation can push a contractor without editing data.

### 3c. Complaint performance (per agency / supervisor / collector)

| Agency   | Received | Resolved | Within SLA | Avg. time to resolve | Reopened | Open now | Overdue now |
|----------|----------|----------|------------|----------------------|----------|----------|-------------|
| Green Co | 92       | 85       | 78%        | 16 h                 | 6        | 7        | 2           |

- Complaints per 100 holdings (fair comparison between big and small agencies).
- Overdue list (live): every ticket past its SLA, oldest first.

---------------------------------------------------------------------------
## 4. Operational / resource reports (non-financial)

| Report                | Columns                                                                                   |
|-----------------------|-------------------------------------------------------------------------------------------|
| Agency register       | Agency, type, district, city, wards, contract start/end, status, collectors, vans, holdings |
| Collector register    | Name, DSP ID, agency, district, city, wards, van, licence expiry, attendance %, coverage %, on-time % |
| Supervisor register   | Name, agency, area (wards/zone), collectors under them, complaints handled               |
| Van / fleet register  | Van ID, plate, type, capacity, agency, driver, status, GPS, documents expiring          |
| Driver information    | Driver (collector) name, phone, licence no., licence expiry, van, agency                 |
| Document expiry       | Vans: fitness / tax / insurance / route permit; collectors: driving licence (next 60 days) |
| Fleet availability    | Vans active / in workshop / idle, downtime hours, km run per month                      |
| Attendance            | Collectors checked in per day, absent, by agency and ward                                |
| Ward coverage map     | Wards with no collector, no van, or no service in the last 7 days                       |
| Survey progress       | Door-to-door surveys done, holdings converted to customers, by ward/agency              |

Every report: filter by district, city/pourashova, agency, ward, period
(day / week / month / year), and export to Excel / PDF / CSV.

---------------------------------------------------------------------------
## 5. City Corporation dashboard (one screen)

Top cards:
1. Holdings served this month (and growth %)
2. Target achievement % (all agencies)
3. Complaints open / overdue
4. Complaints resolved within SLA %
5. Active collectors today / active vans today

Below: agency league table (rank by service %, SLA %, complaints per 100
holdings) and a ward map coloured by service level.

---------------------------------------------------------------------------
## 6. What already exists vs what to build

| Item                                         | Status in system |
|----------------------------------------------|------------------|
| City Viewer role (read-only)                 | Exists           |
| City Dashboard (daily collection by ward/agency) | Exists       |
| Reports page (waste, service series, ward, KPIs, complaint summary) | Exists (some are financial - hide for City Viewer) |
| Complaints with SLA, lifecycle, assignment   | Exists           |
| Fleet, collector, agency registers           | Exist as screens; City Viewer has no access yet |
| Monthly/yearly service trend with growth %   | To build         |
| Target per agency + target vs actual         | To build (new contract field) |
| Complaint performance per agency/collector   | Partly (summary exists; per-agency SLA table to build) |
| Read-only register reports for City Viewer   | To build (open read-only views + exports) |
| Hide financial reports from City Viewer      | To build         |
| City Viewer "note / reopen" on complaints    | Optional         |

---------------------------------------------------------------------------
## 7. Suggested order of work

1. Hide all financial reports/figures from the City Viewer role.
2. Service trend report (monthly/yearly, growth/decline) by agency/supervisor/collector.
3. Complaint performance report (nature, SLA, per agency) + overdue list.
4. Read-only registers: agencies, collectors, supervisors, vans/drivers, document expiry.
5. Agency targets (contract field) and target-vs-actual report.
6. City Corporation dashboard tying it together.
