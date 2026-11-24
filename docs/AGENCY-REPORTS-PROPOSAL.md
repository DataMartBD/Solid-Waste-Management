# Agency Reporting — suggested report list

For the **Agency Admin** and **Supervisor**. Every report is limited to the
user's own agency (and a supervisor's own wards), using the same area rules the
rest of the system already uses.

Built only from data Smart Sweep already holds: holdings, visits, daily
collection summaries, collectors, routes and assignments, bills, payments,
deposits and remittances, complaints, vans, fuel and maintenance logs, and
door-to-door surveys.

Legend: **[Have]** = already in Reports · **[Reuse]** = exists for the City Dashboard and only
needs opening to the agency, limited to its own data · **[New]** = needs building

---

## A. Daily operations (what happened today / yesterday)

| # | Report | What it shows | Source | Status |
|---|---|---|---|---|
| 1 | **Daily collection sheet** | Per collector, per day: due, confirmed, auto-collected, missed, skipped, collected % | DailyCollectionSummary, Visit | [New] (the Collection tab shows this city-wide, not per collector) |
| 2 | **Missed & skipped holdings** | Each holding not served, with skip reason, collector, ward, road and how many times it was missed this month | Visit (skip reason), complaints | [New] |
| 3 | **Route completion** | Per route / assignment: stops planned against stops served, finish time, on-time or late | Route, Assignment, Visit | [New] |
| 4 | **Collector attendance** | Checked in, absent, late per day; monthly attendance % | Collector attendance | [New], but the system keeps only each collector's current status, so attendance must start being recorded day by day first |

## B. Customers and holdings

| # | Report | What it shows | Source | Status |
|---|---|---|---|---|
| 5 | **Holding register** | All holdings by ward and road: type, owner, phone, status, assigned collector | Holding, Household | [Have] partly (Holdings page); add export by ward/road |
| 6 | **New and dropped holdings** | Holdings added, deactivated or moved this month, by ward and collector | Holding history | [Reuse] the City Dashboard service trend, limited to the agency |
| 7 | **Door-to-door survey progress** | Surveys done per collector or ward, against holdings still to survey | Survey, Answer | [New] |

## C. Money (agency only; the City Viewer never sees these)

| # | Report | What it shows | Source | Status |
|---|---|---|---|---|
| 8 | **Bill collection by collector / ward** | Billed, received, outstanding, collection rate | Bill, Payment | [Have] (Reports → Bills) |
| 9 | **Dues ageing** | Outstanding per holding split into 0–30 / 31–60 / 61–90 / 90+ days, with phone, to drive follow-up | Bill | [New] |
| 10 | **Collector cash in hand** | Cash each collector has taken from customers but not yet deposited, and for how many days | Payment, Deposit | [New] (an important control) |
| 11 | **Deposit & remittance reconciliation** | Collected, then deposited, then remitted to the City; any gaps | Deposit, Remittance | [Have] (Reports → Reconciliation) |
| 12 | **Monthly billing run summary** | Bills issued, total amount, waived or failed, by ward | BillingRun, Bill | [New] (small) |

## D. Complaints

| # | Report | What it shows | Source | Status |
|---|---|---|---|---|
| 13 | **Complaint performance** | By collector, supervisor, ward, type: received, resolved, within deadline %, average hours, reopened | Complaint | [Reuse] from the City Dashboard |
| 14 | **Overdue complaints** | Open complaints past their deadline, who they're assigned to, hours overdue | Complaint | [Reuse] from the City Dashboard |
| 15 | **Repeat-complaint holdings** | Holdings with 2+ complaints in 30 days, so their cause can be fixed | Complaint | [New] |

## E. Fleet

| # | Report | What it shows | Source | Status |
|---|---|---|---|---|
| 16 | **Van register and document expiry** | Vans, drivers, licence / fitness / tax-token expiry in the next 60 days | Van, Collector | [Reuse] the City Dashboard registers |
| 17 | **Fuel report** | Fuel litres and cost per van per month; cost per holding served | FuelLog, Visit | [New] |
| 18 | **Maintenance history** | Repairs per van, cost, days off road; vans most often in the workshop | Maintenance | [New] |

## F. Performance and contract

| # | Report | What it shows | Source | Status |
|---|---|---|---|---|
| 19 | **Collector scorecard (monthly)** | One row per collector: coverage %, on-time %, missed, complaints, bill collection %, attendance, then a rank | Visits, complaints, payments | [New] (the most useful single report for an agency) |
| 20 | **"What the City sees" — agency contract report** | The agency's own City Dashboard figures: target against served, growth, complaint deadline %, its place in the league | City Dashboard endpoints | [Reuse] limited to the agency's own data, without the other agencies' rows |
| 21 | **Monthly agency report (PDF)** | One printable pack: service, collection, money, complaints, fleet, for the agency's management or to submit to the City | All of the above | [New] (built once the above exist) |

---

## Suggested order of work

1. **#13, #14, #16, #20 — Reuse.** Open the City Dashboard reports to agency
   admins, limited to their own agency. Little effort, big value: the agency
   sees exactly what the City sees.
2. **#19 Collector scorecard** — the agency's main management tool.
3. **#10 Collector cash in hand** and **#9 Dues ageing** — protects the money.
4. **#1 Daily collection sheet** and **#2 Missed & skipped holdings** — the daily follow-up.
5. **#17 Fuel** and **#18 Maintenance** — cost control.
6. **#7 Survey progress**, **#15 Repeat complaints**, **#3 Route completion**, **#12 Billing run**.
7. **#4 Attendance** (record attendance day by day first) and **#21 Monthly PDF pack**.

## Where it would live

A new **Agency Reports** page (or new tabs on the existing Reports page) for
Agency Admin and Supervisor, with the same CSV / Excel / PDF export buttons as
the City Dashboard. The super admin can pick any agency; agency users are fixed
to their own.
