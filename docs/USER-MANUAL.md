# Smart Sweep — user manual

**Solid Waste Management System · Khulna City Corporation pilot**

This manual covers every screen in the app, what each role can do, and the
handful of rules that will otherwise surprise you.

Companion documents: [Workflows](WORKFLOWS.md) · [API reference](API-REFERENCE.md)

---

## Contents

**Getting started**
- [Signing in](#signing-in)
- [Finding your way around](#finding-your-way-around)
- [Language, theme and Bangla numerals](#language-theme-and-bangla-numerals)
- [What your role can do](#what-your-role-can-do)

**Daily work**
- [Daily Collection](#daily-collection) — the collector's round
- [Households](#households) — the customer register
- [Complaints](#complaints)
- [Live Map](#live-map)

**Planning and money**
- [Route Plan](#route-plan) · [Routes](#routes)
- [Billing](#billing)
- [Collectors](#collectors) · [Fleet & Vans](#fleet--vans)

**Insight**
- [Dashboard](#dashboard)
- [Reports](#reports) · [Customer Reports](#customer-reports)
- [Sweep AI](#sweep-ai)

**Reference**
- [My Profile](#my-profile)
- [Rules that will surprise you](#rules-that-will-surprise-you)
- [When something goes wrong](#when-something-goes-wrong)

---

## Signing in

Smart Sweep signs you in by **mobile number**. There is no username.

### First time — by SMS code

1. Enter your mobile number.
2. Tap **Send code**. A 4-digit code arrives by SMS.
3. Enter the code.

> **On the demo system** there is no SMS gateway, so the login screen shows the
> code on screen. That only happens in demo mode — on a live system the code
> arrives by SMS and never appears on screen.

If your number is not yet registered, signing in creates a Collector account
called *Field Operator*. An agency admin then sets your real role and area. This
is how field staff are added without a separate registration form.

### After that — by PIN

Once signed in, set a **4-digit PIN** from *My Profile*. Then you can sign in
with your number and PIN alone, without waiting for an SMS. This is the normal
way collectors sign in, because mobile coverage in the field is unreliable.

**If you forget your PIN or lock yourself out**, sign in by SMS code instead. A
successful code sign-in clears the lockout and lets you set a new PIN.

> After **5 wrong PINs** the account locks for **15 minutes**. The count is kept
> on the server, so closing the app or clearing your browser does not reset it.

### Demo accounts

Tap a **demo account** chip on the sign-in screen, or type the number. Every
demo account uses PIN **1470**.

| Mobile | Role | Area | Sees |
|---|---|---|---|
| `01711000042` | Collector | Ward 14 | Their own round, their ward's customers and complaints |
| `01700112233` | Supervisor | Zone 03 | Full operational control of that zone's wards |
| `01900445566` | Agency Admin | All zones | Everything, including staff, fleet and billing runs |
| `01800778899` | KCC Viewer | City-wide | Read-only oversight and reports |

Signing in as each of these in turn is the quickest way to understand what the
roles actually differ on.

---

## Finding your way around

The sidebar is grouped:

| Group | Screens |
|---|---|
| **Overview** | Dashboard · Live Map |
| **Operations** | Households · Daily Collection · Routes · Route Plan · Complaints · Billing |
| **Fleet & People** | Fleet & Vans · Collectors |
| **Insight** | Reports · Customer Reports |
| **System** | My Profile |

**The sidebar only lists screens your role can actually open.** A collector does
not see Billing at all; a KCC viewer does not see Route Plan. If a screen is
missing, that is why — it is not a fault.

After signing in you land on the screen that matters most for your role:

| Role | Lands on |
|---|---|
| Collector | Daily Collection |
| Supervisor | Dashboard |
| Agency Admin | Dashboard |
| KCC Viewer | Reports |

The top bar carries global **search** (households, vans, complaints),
notifications, the theme toggle, the language switch, and your account menu.

---

## Language, theme and Bangla numerals

**Language.** Bangla is the default. Switch from the top bar — the whole
interface changes, including form labels, dropdown options and status badges.
Your choice is remembered.

In Bangla, **numbers are shown in Bangla numerals** (১, ২, ৩) throughout —
counts, money, dates and percentages alike.

**Dark mode.** Toggle from the top bar. Remembered between sessions.

---

## What your role can do

| | Collector | Supervisor | Agency Admin | KCC Viewer |
|---|:---:|:---:|:---:|:---:|
| Dashboard | ● | ● | ● | ● |
| Live Map | ● | ● | ● | ● |
| Households | ● | ● | ● | — |
| Daily Collection | ● | ● | ● | — |
| Routes | ● | ● | ● | — |
| Route Plan | — | ● | ● | — |
| Complaints | ● | ● | ● | — |
| Billing | — | ● | ● | — |
| Fleet & Vans | — | ● | ● | — |
| Collectors | — | ● | ● | — |
| Reports | — | ● | ● | ● |
| Customer Reports | — | ● | ● | ● |

**Area scope** limits what you see even on screens you can open:

- A **collector** sees their own ward.
- A **supervisor** sees their zone's wards.
- An **agency admin** and a **KCC viewer** see the whole city.

This is applied by the server, not by the screen. A supervisor cannot widen it
by changing a filter — the ward dropdown simply does not offer wards outside
their zone, and asking for one anyway returns their own.

---

## Daily Collection

*Collector, Supervisor, Agency Admin*

Your round for the day: every stop in walking order.

### The screen

- **Stat cards** — stops today, collected, pending, and *queued to sync* if you
  have recorded anything offline.
- **Tabs** — All · Collected · Pending.
- **Search** by name, holding, road or tag.
- **Scan QR code** — the main action.

> **"Pending" includes stops you skipped.** A skip is not a completed stop — it
> still needs a return visit, so it stays in Pending on purpose.

### Recording a collection

1. Tap **Scan QR code** and hold the tag on the bin or gate inside the frame.
2. The app looks the tag up and shows the household.
3. Confirm to record the collection.

You can also find the stop in the list and record it by hand — useful when a tag
is missing or the camera will not focus.

### What a scan can tell you

| Result | Meaning | What to do |
|---|---|---|
| The household appears | It is a stop on your round | Collect and confirm |
| **Already collected** | Recorded earlier today | Nothing — this prevents a double entry |
| **Not on your round** | It belongs to another collector | Do not collect it; tell your supervisor |
| **Unknown tag** | Not registered, or the sticker is damaged | Report it to the office |
| **Could not read** | The camera got nothing | Clean the tag and scan again |

None of these is an error message you need to dismiss and retry — they are
answers.

### Recording a skip

If you cannot serve a stop, record a **skip** and choose a reason:

- No one home
- No waste to collect
- Premises locked
- Could not access
- Householder refused

Add a note if the reason needs explaining. The stop stays in **Pending**.

**Correcting a skip.** If you come back later and collect it, just record the
collection normally. It replaces the skip — you will not end up with two entries
for the same day.

### Working without a signal

**Keep working.** Everything you record without a connection is saved on your
device and shown under **Queued to sync**.

When the signal returns, the app uploads the queue automatically. Rows the
server accepts disappear from the queue; anything it could not accept stays and
is retried, so nothing is silently lost.

> One bad record never blocks the rest of your round from uploading.

### Looking at someone else's round

A **supervisor or agency admin** can pick any collector from the dropdown and
review their round from the desk.

A **collector cannot** — you always see your own round, whatever is selected. A
round lists householders' names and phone numbers, which is not shared between
collectors.

---

## Households

*Collector, Supervisor, Agency Admin*

The customer register. Two kinds of record sit here, on separate tabs:

- **Under service** — paying customers, QR-tagged, billed monthly.
- **Potential** — surveyed holdings that are *not* yet paying. The "ghost
  homes".

Tabs: All · Under service · Potential · Verified · Unverified.

Filter by ward, customer type, tier and status; search by ID, name, QR tag,
holding or road.

### Registering a household

**Register household** opens the full form. Required:

- Ward, road, holding number, head of household
- Service tier — this sets the monthly charge
- Payment mode and payment day
- Customer type, holding type, storage type, suitable collection time

Optional but useful: phone, alternate phone, contact person, profession,
address, floor, household size (total, under-5, female), blood group.

The ID (`HH-KCC-…`) is assigned automatically.

### Confirming the location — this one matters

Every holding needs a confirmed GPS pin, because:

> **A holding without a confirmed location cannot be put on a route.** Not
> "should not" — the system refuses.

**In the field**, open the holding and tap to verify while standing at the door.
The app records the coordinates and their accuracy in metres.

**From the office**, you can drop the pin on the map instead. The system records
that it was placed by hand, because a desk pin and a doorstep GPS fix are not
equally reliable.

The **Unverified** tab is your work list. The header also shows how many
holdings are not on any route and how many of those are blocked by verification.

### Find by tag

**Find by tag** scans a QR sticker — or lets you key the code in — and opens the
holding it belongs to. Useful when someone reports a problem and the only thing
you have is the number on the bin.

### Surveys and conversion

Record a survey on a holding that is not under service. Alongside the usual
details you capture:

- **Estimated tier** — what they would pay
- **Reason** they are not served (never approached, refused the charge, …)
- **Time gap** — how long since any service
- **Current practice** — what they do with their waste now

To sign one up, open it and **bring it under service**. Confirm the tier, charge,
payment mode and payment day — leave any of them and the survey's estimates are
used.

> The survey is **kept**, not deleted. That is what lets the Customer Funnel
> report show how many holdings were approached, how many converted, and how
> much monthly revenue is still on the table.

You cannot convert the same survey twice.

---

## Complaints

*Collector, Supervisor, Agency Admin*

Citizen tickets with an SLA clock and a full audit trail.

### Raising one

Choose the household, the **type** (missed collection, overflow, billing
dispute, staff behaviour, other) and the **channel** it arrived by (SMS, app,
phone, counter). Set a priority and describe the problem. Anything you write in
the note becomes the first entry in the ticket's history.

### The SLA clock

The priority sets the time budget:

| Priority | Must be resolved within |
|---|---|
| Urgent | 4 hours |
| High | 12 hours |
| Medium | 24 hours |
| Low | 48 hours |

Each ticket shows how it is doing against its budget, and **breached** tickets
are called out on the list, the Dashboard and the Reports screen.

> **Changing the priority changes the clock.** Re-grading a medium ticket to
> urgent gives it a 4-hour budget measured from when it was opened — which may
> put it straight into breach. That is intended: it was always urgent, you just
> found out late.

### Moving a ticket along

Open → Assigned → In progress → Resolved → Closed.

| Action | Effect |
|---|---|
| **Assign** | Hand to a collector, or back to the pool |
| **Advance** | Move one step |
| **Change priority** | Re-grades and resets the budget |
| **Resolve** | Records how it was fixed; stops the clock |
| **Reopen** | The citizen says it is not fixed; restarts the clock |
| **Add note** | Adds to the history; changes nothing else |
| **Attach photos** | Evidence from the camera roll |

**Collectors can do all of these**, not just add notes — they progress the jobs
on their own round. Area scope is what keeps them to their own ward's tickets,
so no extra restriction is needed. A **KCC viewer** cannot do any of them.

> **Every one of these is recorded with who did it and when.** You cannot edit a
> ticket's status directly, and you cannot remove an entry from its history. A
> ticket cannot change hands without a trace.

Photos can be attached several at a time. If any one file is rejected, none of
them is saved — so you never end up with half a batch.

---

## Live Map

*All roles*

A map of Khulna showing where the vans are right now, drawn from real GPS
telemetry.

Positions arrive continuously — you do not need to refresh. Where a live
connection is not possible, the map falls back to refreshing on a timer, and
carries on working.

Alongside vehicles, the map shows household pins and today's progress. It also
reacts live to collections recorded in the field and complaints raised anywhere
in your area.

---

## Route Plan

*Supervisor, Agency Admin*

Where routes are built and handed out.

### Building a route

Give it a name, a ward and a **service window** (start and end time). Then add
stops.

The planner shows holdings **not yet on any route**, split into two piles:

- **Ready to route** — location confirmed.
- **Blocked** — no confirmed location. Send someone to verify before you can use
  them.

### Ordering the walk

Drag stops into the order a collector would actually walk them. The order is
saved as one change, so a collector opening their round mid-edit never sees a
half-sorted route.

**Moving a holding between routes** is allowed — drag it and it moves. It is
never on two routes at once.

### Assigning collectors

Create an assignment for a collector and give it routes.

**Taking a route from another collector is allowed** — the planner reassigns it
and removes the old link. It does not stop and ask, because reassigning is a
normal part of covering for absence.

---

## Routes

*Collector, Supervisor, Agency Admin*

A read-only, stop-by-stop view of a route as it is walked: a timeline of what
has been served and what is left, with a live map of the walk.

Collectors use this to see the shape of their day; supervisors use it to see how
a round is progressing without interrupting anyone.

---

## Billing

*Supervisor, Agency Admin*

### Running a month's billing — Agency Admin only

1. Choose the **period** (`YYYY-MM`), the issue date and the number of days
   until bills fall due (10 by default).
2. **Preview first.** The preview shows exactly how many bills would be created
   and for how much, and changes nothing.
3. Check the count and total against what you expect.
4. Run it for real.

> **Always preview.** A billing run has no bulk undo.

Re-running the same month is safe — households already billed are skipped, not
charged twice.

Every run is recorded, so you can always see who billed which month and when.

### Recording payments

*Collectors, supervisors and admins can all record a payment* — the collector at
the door is the person the money is handed to.

Open the bill, record the amount, choose the method (cash, bKash, Nagad, Rocket,
bank) and add a reference if there is one.

**Partial payments are normal.** Record what was actually handed over. The bill
moves from unpaid to **partial**, and to **paid** once the total is covered.

> **A bill's state is not something you set.** There is no "mark as paid"
> button. Paid, partial, unpaid and overdue are all worked out from the payments
> on record. This is deliberate: it is why the Billing screen's totals and the
> Reports screen's totals cannot disagree.

**Who the payment is credited to matters.** A payment recorded by a collector is
money that collector must later hand in. A payment taken at the office counter
has no collector against it and no hand-in is expected. Getting this wrong is
the usual cause of a cash position that looks wrong at month end.

### Fixing a mistake

Payments cannot be edited. To correct one, an **agency admin** voids it and it
is recorded again correctly. The bill is immediately restated from the payments
that remain.

Voiding is admin-only because it is the only action that can make money on
record disappear — so it does not sit with the person who keyed it in.

### Cash hand-ins

At the end of the month a collector records what they have handed in: the
amount, the method and a reference such as a depot slip number.

Recording it again for the same month **updates** the entry rather than adding a
second one, so a correction is just a re-entry.

The **cash position** view shows, per collector: collected, deposited, and the
variance between them. That variance is what a supervisor works through at month
end.

---

## Collectors

*Supervisor, Agency Admin*

The DSP staff register: name, staff ID, ward, phone, licence and its expiry,
joining date, and the van they drive.

- **Attendance** — mark a collector checked in or absent for the day.
- **Performance** — coverage and on-time figures, calculated from the visit log.
- **Complaints** — how many open tickets are on each collector right now.

> **Refreshing performance figures is agency-admin only.** They feed staff
> reviews, so a supervisor cannot recalculate their own team's numbers on
> demand.

---

## Fleet & Vans

*Supervisor, Agency Admin*

The vehicle register: plate, type (compactor, pickup, rickshaw van, tricycle),
capacity, fuel type, ownership, GPS unit, odometer and driver.

### Documents

Fitness, tax, insurance and permit expiry dates are tracked, and the **alerts**
panel lists what is expiring — measured against today, so it stays current
without anyone maintaining it.

### Maintenance

Open a job with the reason, odometer reading and vendor.

> **Opening a job may take the van off the road.** It moves to *in maintenance*
> and stops being available to assign.

Close the job when it comes back, with the final cost. Downtime is worked out
from when it went in and came out, so you do not need to calculate it.

### Fuel

Log refuelling with litres, cost and odometer. Efficiency (km/l) is calculated
from the distance since the last fill.

The **KPI cards** show availability, downtime, average efficiency by fuel type,
and fuel and maintenance spend.

---

## Dashboard

*All roles*

The headline view, all of it calculated live for **your area**:

- **KPI scorecard** — collection efficiency, charge rate, coverage, median
  complaint resolution time, on-time completion, fleet availability.
- **Collection trend** — the last 7 days.
- **Waste by zone** — estimated tonnage.
- **Ward collection** — service and revenue per ward.
- **Complaints** — open, breached, urgent.
- **Customer funnel** — surveys, conversions, revenue at stake.

Every panel is calculated at the same moment from the same area scope, so they
always agree with each other.

> **Tonnage is an estimate and is labelled `est.`** Nothing weighs the waste. The
> figure comes from the number of stops collected multiplied by typical amounts
> per customer type. Treat it as an indicator of trend, not a measurement.

---

## Reports

*Supervisor, Agency Admin, KCC Viewer*

| Report | Answers |
|---|---|
| **Waste collection** | Rounds walked, per period and collector, with cover work called out |
| **Service series** | Day by day: scheduled, served, skipped, billed, collected |
| **Ward collection** | Service and revenue per ward for a month |
| **Bill collection** | Billed against received, per period and collector |
| **Bill status** | Paid, partial, unpaid and overdue counts per collector |
| **Reconciliation** | Service against revenue, and cash taken against cash handed in |

Most reports take a **period** and a **grouping** (daily, weekly, monthly,
yearly), and several offer an **overall** view that collapses to one row per
period.

### Exporting

Every report exports to **CSV, Excel or PDF** from the same screen. The export is
generated by the server from the same figures you are looking at, so a sheet you
send to someone can never disagree with the screen it came from. The export
notes your area scope and the time it was generated.

The **reconciliation** export is worth knowing about: alongside the cash summary
it carries the **exception list** — the cases that do not balance. Those are the
point of the report.

Reports always cover **your** area. A ward supervisor's city-wide-looking report
is their wards.

---

## Customer Reports

*Supervisor, Agency Admin, KCC Viewer*

Per-household billing:

- **Customer collection** — billed and received per household. This is the *"who
  has not paid"* list.
- **Customer bill status** — one row per bill, with what was paid, by which
  methods, and in how many instalments.

Both export to CSV, Excel and PDF.

---

## Sweep AI

The floating assistant, available on every screen.

Ask an operational question in plain language — *"how many complaints are past
their deadline?"*, *"which households in my ward have not been collected this
week?"* — and it answers from live data, **limited to your area**.

Answers often come with a **suggested screen** to open. Opening it is your
choice: the assistant never navigates on its own, and the panel stays open while
you read.

You can see the exact figures the assistant is working from, so its answers can
always be checked.

> The assistant works whether or not the AI service is configured. Without it,
> it answers from a set of built-in rules — shorter answers, same numbers.

---

## My Profile

*All roles*

Your own details: name, email, alternate phone, NID, blood group and emergency
contact. Upload a photo if you like.

**Set or change your PIN** here, or remove it to go back to SMS-only sign-in.

You cannot change your own role or area — an agency admin does that.

---

## Rules that will surprise you

Ten things the system does that are deliberate, not faults:

1. **An unconfirmed location cannot be routed.** Verify the pin first; the
   system will not let you around it.
2. **There is no "mark as paid".** A bill's state follows the payments recorded
   against it, and nothing else.
3. **A bill can only come from a billing run.** There is no way to add one by
   hand.
4. **A skipped stop stays in Pending.** It still needs a return visit.
5. **Recording the same household twice in one day corrects the entry** rather
   than adding a second one.
6. **A collector always sees their own round**, whichever collector is selected.
7. **A complaint's status can only move through an action**, and each move is
   recorded with your name against it.
8. **Changing a complaint's priority moves its deadline**, possibly into breach.
9. **Tonnage is estimated**, and labelled as such everywhere it appears.
10. **Your reports are your area**, whatever the filters appear to offer.

---

## When something goes wrong

| What you see | What it means | What to do |
|---|---|---|
| **Sign-in says the PIN is wrong** and you are sure it is not | Five wrong attempts locks the account for 15 minutes | Sign in by SMS code instead — that clears the lockout |
| **You are signed out unexpectedly** | Your session expired | Sign in again; anything queued on your device is still there |
| **A screen is missing from the menu** | Your role cannot open it | Not a fault. Ask an agency admin if you need access |
| **"Could not load this data"** | The screen could not reach the server | Tap Retry. The screen shows the failure rather than an empty chart, because zeros would read as real figures |
| **A stop will not go on a route** | Its location is not confirmed | Verify it from Households, then add it |
| **A bill will not save** | Bills come only from a billing run | Ask an agency admin to run the month |
| **Your queue is not uploading** | No connection yet, or a row the server rejected | Keep working. Accepted rows clear on their own; a row that keeps failing needs the office |
| **A figure looks wrong on a report** | Reports cover your area only | Check the period and remember the scope; if it still looks wrong, raise it with an agency admin |
| **Cash position shows a variance** | Collected and deposited do not match | Check for payments recorded against the wrong collector, and for a hand-in not yet entered |
| **"Request was throttled"** | Too many sign-in attempts in an hour | Wait, or sign in with your PIN instead of a code |

### Getting help

- The **Sweep AI** panel answers most "how many" and "which" questions directly.
- Your **supervisor** handles routes, assignments and complaint escalation.
- An **agency admin** handles accounts, roles, staff, fleet, service tiers,
  billing runs and voided payments.
