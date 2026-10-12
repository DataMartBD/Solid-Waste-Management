# Smart Sweep — user manual

**Solid Waste Management System · multi-city, with Khulna City Corporation as the pilot**

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
- [The one idea to hold on to: everything is holding-wise](#the-one-idea-to-hold-on-to-everything-is-holding-wise)

**Daily work**
- [Daily Collection](#daily-collection) — the collector's round
- [The collection day](#the-collection-day) — collected unless someone complains
- [Holding Master](#holding-master) — buildings, their families and their charge
- [Surveys](#surveys)
- [Complaints](#complaints)
- [Live Map](#live-map)

**Planning and money**
- [Route Plan](#route-plan) · [Routes](#routes)
- [Billing](#billing)
- [Collectors](#collectors) · [Fleet & Vans](#fleet--vans) · [Agency Master](#agency-master)

**Insight**
- [Dashboard](#dashboard)
- [City Collection](#city-collection) — the City Corporation's view
- [Reports](#reports) · [Customer Reports](#customer-reports)
- [Sweep AI](#sweep-ai)

**Administration**
- [Setup](#setup) — cities, zones, wards, dumping points, type lists
- [Users](#users)
- [My Profile](#my-profile)

**Reference**
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
called *Field Operator*. An administrator then sets your real role and area.
This is how field staff are added without a separate registration form.

### After that — by PIN or password

Once signed in, set a **4-digit PIN** from *My Profile*. Then you can sign in
with your number and PIN alone, without waiting for an SMS. This is the normal
way collectors sign in, because mobile coverage in the field is unreliable.
Office accounts created on the Users screen can also sign in with a password.

**If you forget your PIN or lock yourself out**, sign in by SMS code instead. A
successful code sign-in clears the lockout and lets you set a new PIN.

> After **5 wrong PINs** the account locks for **15 minutes**. The count is kept
> on the server, so closing the app or clearing your browser does not reset it.

### Demo accounts

Tap a **demo account** chip on the sign-in screen, or type the number. Every
demo account uses PIN **1470**.

| Mobile | Role | Area | Sees |
|---|---|---|---|
| `01711000042` | Collector | Ward 14 | Their own round, their ward's holdings and complaints |
| `01700112233` | Supervisor | Zone 03 | Full operational control of that zone's wards |
| `01900445566` | Agency Admin | All zones | Everything for their agency, including staff, fleet, billing and bulk upload |
| `01800778899` | City Viewer | City-wide | Read-only: the City Collection dashboard and reports |

Signing in as each of these in turn is the quickest way to understand what the
roles actually differ on.

---

## Finding your way around

The sidebar is grouped:

| Group | Screens |
|---|---|
| **Overview** | Dashboard · City Collection · Live Map |
| **Operations** | Holding Master · Surveys · Daily Collection · Routes · Route Plan · Complaints · Billing |
| **Fleet & People** | Fleet & Vans · Collectors · Agency Master |
| **Insight** | Reports · Customer Reports |
| **System** | Users · Setup · My Profile |

**The sidebar only lists screens your role can actually open.** A collector does
not see Billing at all; a City Viewer does not see Route Plan; only a Super
Admin sees Setup and Agency Master. If a screen is missing, that is why — it is
not a fault.

After signing in you land on the screen that matters most for your role:

| Role | Lands on |
|---|---|
| Collector | Daily Collection |
| Supervisor | Dashboard |
| Agency Admin | Dashboard |
| Super Admin | Dashboard |
| City Viewer | City Collection |

The top bar carries global **search**, notifications, the theme toggle, the
language switch, and your account menu.

---

## Language, theme and Bangla numerals

**Language.** Bangla is the default. Switch from the top bar — the whole
interface changes, including form labels, dropdown options and status badges.
Your choice is remembered.

In Bangla, **numbers are shown in Bangla numerals** (১, ২, ৩) throughout —
counts, money, dates and percentages alike. **Names follow the language too**:
a city, zone, ward, dumping point or agency shows its Bangla name when one has
been entered in Setup, and its English name otherwise.

**Dark mode.** Toggle from the top bar. Remembered between sessions.

---

## What your role can do

| | Collector | Supervisor | Agency Admin | Super Admin | City Viewer |
|---|:---:|:---:|:---:|:---:|:---:|
| Dashboard | ● | ● | ● | ● | ● |
| City Collection | — | ● | ● | ● | ● |
| Live Map | ● | ● | ● | ● | ● |
| Holding Master | ● | ● | ● | ● | — |
| Bulk upload of holdings | — | — | ● | ● | — |
| Surveys | ● | ● | ● | ● | — |
| Daily Collection | ● | ● | ● | ● | — |
| Routes | ● | ● | ● | ● | — |
| Route Plan | — | ● | ● | ● | — |
| Complaints | ● | ● | ● | ● | — |
| Billing | — | ● | ● | ● | — |
| Fleet & Vans · Collectors | — | ● | ● | ● | — |
| Agency Master | — | — | — | ● | — |
| Reports · Customer Reports | — | ● | ● | ● | ● |
| Users | — | — | ● | ● | — |
| Setup | — | — | — | ● | — |

**Area scope** limits what you see even on screens you can open:

- A **collector** sees their own ward.
- A **supervisor** sees their zone's wards.
- An **agency admin** sees everything that belongs to **their agency**.
- A **super admin** sees every city and every agency.
- A **City Viewer** sees **one city** — the one set on their account — or every
  city if none is set.

This is applied by the server, not by the screen. Nobody can widen it by
changing a filter — the dropdowns simply do not offer what is outside your
area, and asking for it anyway returns your own.

---

## The one idea to hold on to: everything is holding-wise

A **holding** is a building. Everything the system does is done **per
holding**:

| Thing | Belongs to |
|---|---|
| The monthly **service charge** (tier, amount, payment mode and day) | The holding |
| The **bill** — one a month | The holding |
| **Payments** and **dues** | The holding |
| The daily **collection** — one visit a day | The holding |
| The **QR tag** — one on the building | The holding |
| A **complaint** | The holding (and, optionally, the family that reported it) |

A **household** is a family or unit living in the building — name, phone, flat
number, members. It is kept for the register and for one rule:

> **Households must equal units.** A building declared with 4 units can never
> have more than 4 active families on record. Fewer is allowed while families
> are still being recorded, and is shown in amber until they match.

---

## Daily Collection

*Collector, Supervisor, Agency Admin, Super Admin*

Your round for the day: every **building** in walking order, one line each.

### The screen

- **Stat cards** — stops today, collected, pending, and *queued to sync* if you
  have recorded anything offline.
- **Tabs** — All · Collected · Pending.
- **Search** by owner, holding number, road or tag.
- Each line shows the **owner**, the **holding number**, the **QR tag**, and how
  many families live there ("4 families").
- **Scan QR code** — the main action.

> **"Pending" includes stops you skipped.** A skip is not a completed stop — it
> still needs a return visit, so it stays in Pending on purpose.

### Recording a collection

1. Tap **Scan QR code** and hold the **building's tag** inside the frame.
2. The app looks the tag up and finds the holding on your round.
3. The collection is recorded — once, for the whole building.

You can also find the stop in the list and tap **Collect** — useful when a tag
is missing or the camera will not focus.

### What a scan can tell you

| Result | Meaning | What to do |
|---|---|---|
| The holding is collected | It is a stop on your round | Nothing more |
| **Already collected** | Recorded earlier today | Nothing — this prevents a double entry |
| **Not on your round** | It belongs to another round | Do not collect it; tell your supervisor |
| **Unknown tag** | Not registered, or the tag is damaged | Report it to the office |
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

The stop stays in **Pending**.

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

A **supervisor or admin** can pick any collector from the dropdown and review
their round from the desk.

A **collector cannot** — you always see your own round, whatever is selected. A
round lists owners' names, phone numbers and what they owe, which is not shared
between collectors.

---

## The collection day

*How the system decides what was collected*

Agencies collect every day. They **may** confirm each holding by QR scan, app or
web — but nobody has to. At the city's **cut-off time** (9:00 PM unless Setup
says otherwise) the day closes:

| On the day | Result |
|---|---|
| The agency confirmed the holding (scan, app, web) | **Collected (confirmed)** — never changed afterwards |
| No confirmation and no complaint | **Collected (auto)** |
| A "missed collection" complaint names that day | **Not collected** |
| A complaint arrives **the next morning, before 12:00 noon** | The auto "collected" becomes **Not collected** |
| A complaint arrives after noon the next day | Refused — too late to name yesterday |

Only holdings on an active route are due on a day. The confirmed, auto and not
collected counts are kept apart everywhere, so the city can see which agencies
actually confirm their work.

> **The day is closed by a scheduled job on the server.** If the history on the
> City Collection screen stays empty, ask your administrator to check that the
> job is running.

---

## Holding Master

*Collector, Supervisor, Agency Admin, Super Admin*

The register of buildings. Each row shows the holding number, address, owner,
how many families live there against its units ("3/4 units", amber until they
match), the **monthly charge**, the **dues**, the service status and whether its
location is confirmed.

Filter by service status (all, fully served, partly served, not served) and
search by holding number, owner, phone, road, district, thana or QR tag. Tap a
row to see the families living in the building.

### Registering or editing a holding

**Register holding** opens a full-page editor: the building on the left, its
families on the right, saved together in one go.

**The building**

- District and thana, then ward and road (the road list follows the ward)
- Holding number, holding type, floors, **units**
- Agency (only asked when the system cannot work it out from your account)
- Owner's name, phone, alternate phone, email
- **Service charge** — tier (sets the standard amount), monthly charge (leave
  blank for the tier's rate), payment mode and payment day
- For a saved holding: the **dues** and the building's **QR code**, ready to
  print and fix at the gate

**The families**

Add one card per family or unit: name, customer type, phones, flat number,
floor, members (total, under 5, female), storage and a suitable collection time.
Families carry **no charge** — that is the building's.

> **More active families than units will not save.** Raise the unit count, or
> set a family that has moved out to inactive, which frees its unit.

A family already on the register is never deleted from the editor — it is set
inactive instead, because complaints may name it.

### Bulk upload from Excel or CSV

*Agency Admin, Super Admin* — the fastest way to set up a new city.

1. On Holding Master, tap **Import**, then **Download template**.
2. Fill one row per holding: **Holding No, Name, Mobile, City, Ward, Area,
   Address, Route, GPS Location** — plus, if you have them, Holding Type, Tier,
   Charge, Units and Agency. The template's Notes sheet explains each column.
3. Choose the file and tap **Check file**. Every row is checked and listed —
   nothing is saved yet.
4. Fix any rows with errors in the sheet and check again, or carry on without
   them.
5. Tap **Import N valid rows**.

What happens to a row:

- **Ward** can be the code (W-14), the name, or just the number (14).
- An **Area** (road) that does not exist yet in the ward is **added**; the check
  tells you so.
- **GPS Location** (e.g. `22.8456, 89.5403`) confirms the building's location,
  which makes it routable.
- **Route** puts the holding at the end of that route's walk — it needs GPS.
- A row matching a holding already registered (same ward, area and number)
  **updates** it instead of creating a copy.
- Rows with errors are skipped and listed; the valid rows are saved together.

### Confirming the location — this one matters

Every holding needs a confirmed GPS pin, because:

> **A holding without a confirmed location cannot be put on a route.** Not
> "should not" — the system refuses.

**In the field**, open the holding and verify while standing at the door. The
app records the coordinates and their accuracy in metres. **From the office**
you can drop the pin on the map instead; the system records that it was placed
by hand, because a desk pin and a doorstep GPS fix are not equally reliable.

---

## Surveys

*Collector, Supervisor, Agency Admin, Super Admin*

The door-to-door questionnaire. A collector fills it in at the door — on the
phone or tablet, with or without a signal — and it uploads when the signal
returns.

A survey goes **reviewed** (or rejected) by a supervisor before anything is done
with it. An **agency admin** can then **convert** a reviewed survey into a
holding on the register. The preview shows what will be created first: the road
it matched, the suggested holding type, the owner and units — and warns if that
address is already registered.

Surveyed families that are not yet paying ("potential customers") are also
listed against their holding, and can be **brought under service** from there:
the tier, charge, payment mode and day you confirm land on the **holding**.

---

## Complaints

*Collector, Supervisor, Agency Admin, Super Admin*

Citizen tickets with a deadline clock and a full audit trail.

### Raising one

1. Choose the **holding** the complaint is about.
2. Optionally choose the **family** in it that reported it — or leave it as the
   holding's owner.
3. Choose the **type** (missed collection, overflow, billing dispute, staff
   behaviour, other), the **channel** (SMS, app) and a **priority**.
4. For a **missed collection**, choose the **day not collected**: today, or
   yesterday until 12:00 noon.
5. Describe the problem. Anything you write becomes the first entry in the
   ticket's history.

A missed-collection complaint is what turns a holding's day into **Not
collected** — see [The collection day](#the-collection-day).

### The deadline clock

The priority sets the time budget:

| Priority | Must be resolved within |
|---|---|
| Urgent | 4 hours |
| High | 12 hours |
| Medium | 24 hours |
| Low | 48 hours |

**Breached** tickets are called out on the list, the Dashboard and Reports.

> **Changing the priority changes the clock.** Re-grading a medium ticket to
> urgent gives it a 4-hour budget measured from when it was opened — which may
> put it straight into breach. That is intended.

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

**Collectors can do all of these** for their own ward's tickets. A **City
Viewer** cannot do any of them.

> **Every one of these is recorded with who did it and when.** You cannot edit a
> ticket's status directly, and you cannot remove an entry from its history.

---

## Live Map

*All roles*

Where the vans are right now, drawn from real GPS telemetry, and a pin for
every located **holding** — amber when it owes money. Positions arrive
continuously; where a live connection is not possible the map refreshes on a
timer instead.

---

## Route Plan

*Supervisor, Agency Admin, Super Admin*

Where routes are built and handed out. A route walks **buildings**.

### Building a route

Give it a name, a ward and a **service window** (start and end time). The
planner shows holdings **not yet on any route**, in two piles:

- **Ready to route** — location confirmed.
- **Blocked** — no confirmed location. Send someone to verify first.

### Ordering the walk

Drag stops into the order a collector would actually walk them. The order is
saved as one change. **Moving a holding between routes** is allowed — it is
never on two routes at once.

### Assigning collectors

Give a collector an assignment and its routes. **Taking a route from another
collector of the same agency is allowed** — reassigning is a normal part of
covering for absence. Routes cannot be taken across agencies.

---

## Routes

*Collector, Supervisor, Agency Admin, Super Admin*

A read-only, stop-by-stop view of a route as it is walked: a timeline of what
has been served and what is left, with a live map of the walk.

---

## Billing

*Supervisor, Agency Admin, Super Admin*

**One bill per holding per month**, for the holding's monthly charge.

### Running a month's billing — admins only

1. Choose the **period** (`YYYY-MM`), the issue date and the days until bills
   fall due (10 by default).
2. **Preview first.** It shows how many bills would be created and for how much,
   and changes nothing.
3. Run it for real.

Who is billed: every **active holding on a route that has a charge**. A holding
with no tier and no charge has not been signed up and is not billed.

> **Always preview.** A billing run has no bulk undo. Re-running the same month
> is safe — holdings already billed are skipped.

### Recording payments

*Collectors, supervisors and admins can all record a payment* — the collector at
the door is the person the money is handed to.

Open the bill, record the amount, choose the method (cash, bKash, Nagad, Rocket,
bank) and add a reference if there is one. **Partial payments are normal**: the
bill moves from unpaid to partial, and to paid once covered. The holding's
**dues** follow automatically.

> **A bill's state is not something you set.** There is no "mark as paid"
> button. Paid, partial, unpaid and overdue are worked out from the payments on
> record — which is why Billing and Reports cannot disagree.

### Fixing a mistake

Payments cannot be edited. An **admin** voids a wrong one and it is recorded
again; the bill is restated immediately.

### Cash hand-ins

At month end a collector's hand-in is recorded: amount, method and a reference
such as a depot slip. Recording it again for the same month updates it. The
**cash position** shows collected, deposited and the variance per collector.

---

## Collectors

*Supervisor, Agency Admin, Super Admin*

The field-staff register: name, staff ID, ward, agency, phone, licence and its
expiry, and the van they drive. Mark attendance for the day; coverage and
on-time figures are calculated from the visit log.

> **Refreshing performance figures is admin only.** They feed staff reviews.

---

## Fleet & Vans

*Supervisor, Agency Admin, Super Admin*

The vehicle register: plate, type (compactor, pickup, rickshaw van, tricycle),
capacity, fuel, ownership, GPS unit, odometer and driver — plus the **ward** the
van works and the **dumping point** it unloads at (only points in that ward's
city are offered).

- **Documents** — fitness, tax, insurance and permit expiries, with alerts.
- **Maintenance** — opening a job takes the van off the road until it is closed.
- **Fuel** — litres, cost and odometer; efficiency is calculated.

---

## Agency Master

*Super Admin*

The organisations that collect waste — what the client calls the "customer". An
agency can be a private company, an NGO, a community organisation, a
cooperative, or the city's own **in-house** service (City Corporation or
Pourashova). The types come from Setup.

Each agency belongs to **one city**, has a name in English and Bangla, a short
code, registration and contact details, a contract, and the **wards it
serves** — only wards of its own city can be ticked. One city may have several
agencies; one agency many wards and vans.

**Remittances** — what an agency hands over to the corporation — are recorded
here, and the month's cash position shows collected, deposited and remitted.

---

## Dashboard

*All roles*

The headline view, calculated live for **your area**: the KPI scorecard
(collection efficiency, charge rate, **coverage of holdings**, complaint
resolution time, on-time completion, fleet availability), the 7-day collection
trend, estimated waste by zone, the top holdings, collector rankings and the
latest visits.

> **Tonnage is an estimate and is labelled as one.** Nothing weighs the waste.

---

## City Collection

*City Viewer, Supervisor, Agency Admin, Super Admin*

The City Corporation's view of its city.

- **Today** — holdings due, confirmed so far, not yet confirmed, and
  not-collected complaints, with a badge saying whether the day is still open
  (until the cut-off) or closed.
- **For the period** — collected %, confirmed by agencies %, auto at cut-off,
  and not collected.
- **Chart** — confirmed, auto and not collected by day, week or month.
- **By agency** and **by ward** — the same figures side by side, so you can see
  which agencies prove their work.

Switch Daily / Weekly / Monthly; export to View, PDF, Excel or CSV. A City
Viewer tied to one city sees only that city; others can pick a city.

---

## Reports

*Supervisor, Agency Admin, Super Admin, City Viewer*

| Report | Answers |
|---|---|
| **Waste collection** | Rounds walked, per period and collector, with cover work called out |
| **Service series** | Day by day: scheduled, served, skipped, billed, collected |
| **Bill collection** | Billed against received, per period and collector |
| **Bill status** | Paid, partial, unpaid and overdue counts per collector |
| **Reconciliation** | Service against revenue, and cash taken against cash handed in |
| **Customers** | Holdings per ward or road: active, on a round, dues, charge |

Every report exports to **CSV, Excel or PDF**, generated from the same figures
you are looking at. Reports always cover **your** area.

---

## Customer Reports

*Supervisor, Agency Admin, Super Admin, City Viewer*

Per-holding billing:

- **Customer collection** — billed and received per holding. The *"who has not
  paid"* list.
- **Customer bill status** — one row per bill, with what was paid, by which
  methods, and in how many instalments.

---

## Sweep AI

The floating assistant, on every screen. Ask in plain language — *"how many
holdings have dues?"*, *"how many complaints are past their deadline?"* — and it
answers from live data, **limited to your area**. Answers may suggest a screen
to open; opening it is your choice.

---

## Setup

*Super Admin*

Where a city is set up. Every list here feeds the dropdowns on the other
screens, and changes show up straight away.

| Tab | What you set |
|---|---|
| **Cities** | Code, name (English and Bangla), type, district, the **collection cut-off** (9:00 PM by default) and the **complaint deadline** (12:00 noon the next day by default) |
| **Zones** | Code, name (English and Bangla), city |
| **Wards** | Code, name (English and Bangla), city and zone, centre point, active |
| **Dumping points** | Name (English and Bangla), kind (dumping area, disposal site, transfer station), city, the wards it serves, location, daily capacity |
| **City types** | e.g. City Corporation, Pourashova — add more any time |
| **Agency types** | e.g. Private company, NGO, City Corporation (in-house) |

**Setting up a new city, in order:**

1. **Cities** — add the city with its type, cut-off and complaint deadline.
2. **Zones**, then **Wards** — codes are shared by every city, so start them
   with the city code (e.g. `SCC-Z1`, `SCC-W22`).
3. **Dumping points** for its wards.
4. **Agency Master** — add its agencies and tick their wards.
5. **Holding Master → Import** — upload its holdings.
6. **Users** — create its staff, and a City Viewer for the corporation.

> **Hiding is not deleting.** Set an entry to *Hidden* to take it out of the
> dropdowns; records already using it keep it. A type in use cannot be deleted.

---

## Users

*Agency Admin, Super Admin*

Operator accounts: phone, name, role, area scope, agency and password. To give
the City Corporation its own login, create a **City Viewer** with the scope
**City-wide** and choose the **city** — that account then sees only that city.

You cannot change your own role, area or active status — another administrator
does that. Accounts are deactivated rather than deleted, because records point
at the person who made them.

---

## My Profile

*All roles*

Your own details: name, email, alternate phone, NID, blood group and emergency
contact. Upload a photo if you like. **Set or change your PIN** here, or remove
it to go back to SMS-only sign-in.

---

## Rules that will surprise you

Twelve things the system does that are deliberate, not faults:

1. **Everything is per holding** — one charge, one bill, one visit and one QR
   tag per building, however many families live in it.
2. **Households must equal units.** More active families than units will not
   save.
3. **A holding is collected unless someone complains.** At the cut-off, every
   holding nobody confirmed and nobody complained about counts as collected.
4. **A complaint can name yesterday only until noon.**
5. **An unconfirmed location cannot be routed.** Verify the pin first.
6. **There is no "mark as paid".** A bill's state follows its payments.
7. **A bill can only come from a billing run**, and only for a holding with a
   charge.
8. **A skipped stop stays in Pending.** It still needs a return visit.
9. **Recording the same holding twice in one day corrects the entry.**
10. **A collector always sees their own round.**
11. **A complaint's status only moves through an action**, recorded with your
    name.
12. **Your reports are your area** — and a City Viewer's are their city.

---

## When something goes wrong

| What you see | What it means | What to do |
|---|---|---|
| **Sign-in says the PIN is wrong** and you are sure it is not | Five wrong attempts locks the account for 15 minutes | Sign in by SMS code instead — that clears the lockout |
| **You are signed out unexpectedly** | Your session expired | Sign in again; anything queued on your device is still there |
| **A screen is missing from the menu** | Your role cannot open it | Not a fault. Ask an administrator if you need access |
| **"Could not load this data"** | The screen could not reach the server | Tap Retry |
| **A holding will not save: "households must equal units"** | More active families than the unit count | Raise the units, or set a family that moved out to inactive |
| **A holding will not go on a route** | Its location is not confirmed | Verify it, then add it |
| **A holding was not billed** | It has no tier or charge, is not on a route, or is inactive | Set its service charge in the Holding editor |
| **Yesterday's complaint is refused** | It is past 12:00 noon | It can no longer change yesterday's result; log it for today if it applies |
| **City Collection history is empty** | No day has been closed yet | Ask your administrator to check the day-end job |
| **Import says a row has errors** | That row failed a check | Read the reason next to it, fix the sheet, check again |
| **Your queue is not uploading** | No connection yet, or a row the server rejected | Keep working. Accepted rows clear on their own |
| **Cash position shows a variance** | Collected and deposited do not match | Check for payments against the wrong collector, or a hand-in not yet entered |
| **"Request was throttled"** | Too many sign-in attempts in an hour | Wait, or sign in with your PIN instead of a code |

### Getting help

- The **Sweep AI** panel answers most "how many" and "which" questions directly.
- Your **supervisor** handles routes, assignments and complaint escalation.
- An **agency admin** handles your agency's accounts, staff, fleet, billing runs
  and bulk uploads.
- The **super admin** handles cities, zones, wards, dumping points, type lists
  and agencies.
