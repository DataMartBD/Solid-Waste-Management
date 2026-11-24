# Reports — what each page has today, the overlaps, and a better structure

## 1. What the three pages have today

### Reports  (`/app/reports`)
Who: City Viewer (no money tabs), Supervisor, Agency Admin, Super Admin

| Tab | What it shows | Money? |
|---|---|---|
| Service collection | Per day/week/month: holdings scheduled vs served, efficiency; billed vs collected | partly |
| Waste collection | Per period and collector: stops planned, served, skipped, coverage % | no |
| Bills by collector | Per period and collector: billed, received, outstanding, rate | yes |
| Reconciliation | One month per collector: collected → deposited → variance | yes |
| Customers | Households by type: active, serviced, coverage, dues, charges, potential homes | yes |
| KPI scorecard | Six KPIs against targets (efficiency, charge rate, coverage, complaint hours, on-time, fleet) | partly |

### Customer Reports  (`/app/reports-customer`)
Who: Supervisor, Agency Admin, Super Admin

| Tab | What it shows |
|---|---|
| Bill collection per household | Per day/week/month/year: what each household was billed and paid |
| Bill status per household | One month: paid / partial / unpaid / overdue per household |

### Agency Reports  (`/app/agency-reports`)
Who: Supervisor, Agency Admin, Super Admin

| Group | Tabs |
|---|---|
| Performance | Collector scorecard · Daily sheet · Missed & skipped · Route completion · Attendance · What the City sees |
| Money | Cash in hand · Dues ageing · Billing runs |
| Complaints | Complaints · Repeat complaints |
| Fleet | Fuel · Maintenance |
| Records | Monthly report (PDF) · Survey progress · Registers |

### City Dashboard  (`/app/city-dashboard`)
Who: City Viewer, Super Admin. Summary, Collection, Service trend, Complaints, Registers, Targets.

---

## 2. Who sees what today

| Page | City Viewer | Supervisor | Agency Admin | Super Admin |
|---|---|---|---|---|
| City Dashboard | ✔ | – | – | ✔ |
| Reports | ✔ (no money tabs) | ✔ | ✔ | ✔ |
| Customer Reports | – | ✔ | ✔ | ✔ |
| Agency Reports | – | ✔ | ✔ | ✔ |

Problem: an agency admin has **three** report pages that partly repeat each
other, and the names don't say what is inside ("Reports" vs "Agency Reports").

---

## 3. The overlaps

| # | Overlap | Where | Merge into |
|---|---|---|---|
| 1 | Daily collection counts | Reports → Service collection (totals per day) and Agency → Daily sheet (per day **per collector**) | **One "Daily collection" tab** with a "group by: day / collector" switch |
| 2 | Collector field work | Reports → Waste collection (planned / served / skipped per collector) and Agency → Collector scorecard (served / coverage / skipped per collector) | Keep the **Scorecard**; Waste collection becomes its "by period" view |
| 3 | Money per collector | Reports → Bills by collector and Agency → Scorecard billed / received | Keep **Bills by collector** in Finance; scorecard keeps only the % |
| 4 | Collector cash | Reports → Reconciliation (collected → deposited) and Agency → Cash in hand (not yet deposited) | **One "Cash & deposits" tab**: cash in hand now + the month's reconciliation |
| 5 | Unpaid bills per household | Customer → Bill status per household and Agency → Dues ageing by holding | **One "Household dues" tab** with a switch: by month status / by age |
| 6 | Bills per month | Customer → Bill collection per household (monthly) and Agency → Billing runs (per month totals) | Keep both, side by side in Finance (totals first, households on click) |
| 7 | Targets & KPIs | Reports → KPI scorecard and Agency → What the City sees (target, rank) | **One "Targets & KPIs" tab** |
| 8 | City Viewer | Reports (service, waste, KPI) and City Dashboard (collection, service trend, targets) | City Viewer uses **City Dashboard only**; its KPI card moves there |

---

## 4. Suggested structure and names — 3 pages, each answering one question

| New name (English / বাংলা) | Answers | Who |
|---|---|---|
| **City Dashboard** / সিটি ড্যাশবোর্ড | "How are the agencies doing for the city?" | City Viewer, Super Admin (unchanged) |
| **Operations Reports** / অপারেশন রিপোর্ট | "Is the waste being collected, by whom, and with what?" | Supervisor, Agency Admin, Super Admin |
| **Finance Reports** / ফাইন্যান্স রিপোর্ট | "Were customers billed, did they pay, where is the money?" | Supervisor, Agency Admin, Super Admin |

### Operations Reports — groups and tabs
| Group | Tabs |
|---|---|
| Collection | Daily collection (day / collector) · Missed & skipped · Route completion |
| Staff | Collector scorecard (month / period views) · Attendance |
| Complaints | Complaints · Repeat complaints |
| Fleet | Fuel · Maintenance |
| Records | Survey progress · Customer coverage (non-money part of "Customers") · Registers |
| Contract | Targets & KPIs (KPI scorecard + what the City sees) · Monthly report (PDF) |

### Finance Reports — tabs
Billing runs → Bills by collector → Household collection → Household dues (status / age) → Cash & deposits

### What goes away
- "Reports", "Customer Reports" and "Agency Reports" as separate pages (old
  addresses redirect to the new ones).
- City Viewer's access to the old Reports page (City Dashboard covers it;
  the KPI card is added to its Summary).

Net result: 3 pages instead of 4, each with one clear purpose; no figure
shown twice; every report kept.

---

## 5. Other name options

| Instead of | Could also be |
|---|---|
| Operations Reports | Field Reports · Service Reports · কাজের রিপোর্ট |
| Finance Reports | Billing & Collection Reports · Money Reports · টাকার রিপোর্ট |
| City Dashboard | City Overview · সিটি ওভারভিউ |
