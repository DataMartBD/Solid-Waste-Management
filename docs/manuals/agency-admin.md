# Smart Sweep — manual for the Agency Admin

**Who this is for:** the person who runs an agency — a private contractor, an
NGO, or the City Corporation's in-house team.

**What you see:** everything that belongs to **your agency** — its holdings,
collectors, supervisors, vans, routes, bills, payments and reports. You never see
another agency's data.

**Your screens:** Daily Dashboard · Live Map · Holding Master · Surveys · Daily
Collection · Routes · Route Plan · Complaints · Billing · Fleet & Vans ·
Collectors · Operations Reports · Finance Reports · Users · My Profile.

---

## 1. Your daily routine

1. **Daily Dashboard** — today's collections, payments and complaints.
2. **Operations Reports → Collection → Daily collection** — yesterday by collector.
3. **Finance Reports → Cash & deposits** — collectors holding cash too long.
4. **Complaints** — anything overdue.

Once a month: **Billing** (run the month), **Operations Reports → Staff →
Collector scorecard**, and **Contract → Monthly report (PDF)** for the City.

---

## 2. People

### Adding a collector or supervisor account (Users)

You can create **collector** and **supervisor** accounts only.

1. **Users → Add user.**
2. Enter name and mobile number; choose the role.
3. District and City show only your agency's; your agency is filled in for you.
4. Set the area (wards). It must be inside your agency's cities.
5. Save. The person signs in with their mobile number.

### The collector register (Collectors)

- **Add collector** — name, phone, licence, wards; your agency is set automatically.
- **Routes column** — how many routes and stops each collector walks; **No route**
  in orange means they have nothing to do.
- **Assign route** (route icon on the row, or in the details panel) opens
  Route Plan on that collector with the route picker open.
- **Attendance** — mark a collector checked in or absent each day. Everyone is
  reset to absent at the start of a new day until marked in again.
- Moving a collector to another agency is done by the super admin (**Transfer**).

### Vans (Fleet & Vans)

A van belongs to its driver's agency. Add or edit vans for your own collectors:
plate, type, capacity, fuel, driver, documents (fitness, tax, insurance, permit),
maintenance jobs and fuel logs.

---

## 3. Holdings

### Registering one (Holding Master → Register holding)

1. Fill the building: ward, road, holding number, type, floors, **units**, owner.
2. Set the **service charge**: tier or a monthly amount, payment mode and day.
3. Add one card per family. Active families can never exceed units.
4. Save, then **verify the location** at the door. Only verified holdings can be
   put on a route.

### Bulk upload

**Holding Master → Import → Download template**, fill it, **Check file**, fix the
rows it flags, then **Import N valid rows**.

### Putting holdings on a route

- **From one holding:** open it — the **Route & collector** panel shows its route
  and collector. **Add to route** / **Move to another route** / **Take off route**.
- **Many at once:** Holding Master → filter **Not on a route** → tick the holdings
  → **Add selected to route** → pick a route of their ward.

Unverified holdings and holdings of another ward are skipped, and the result
says so.

---

## 4. Routes and collectors (Route Plan)

The **"Still to do"** strip at the top lists routes without a collector, routes
with no stops and holdings on no route. Click one to filter.

### Creating a route in one go

1. **Routes tab → New route.**
2. Name (usually the road), ward, collection window (e.g. 06:00–09:30).
3. Optional **Collector** — the ward's collectors are listed first.
4. **Create route.** The stop picker opens — tick the holdings and add them.

### Changing who walks a route

Open the route → **Walked by → Change** (or click **Unassigned · Assign** on its
card) → pick a collector. Collectors who are off route cannot be picked; taking a
route from another collector asks you to confirm.

---

## 5. Billing

1. **Billing → run the month:** choose the period, issue date and days to pay.
2. **Preview first** — it shows how many bills and how much, and saves nothing.
3. Run it. Running the same month again only bills holdings not yet billed.

Payments are recorded on the bill (cash, bKash, Nagad, Rocket, bank). Partial
payments are normal. There is no "mark as paid" — a bill's state follows its
payments. A wrong payment is voided by an admin and recorded again.

---

## 6. Reports

### Operations Reports

| Group | Tabs |
|---|---|
| Collection | **Daily collection** (by day / by collector) · **Missed & skipped** · **Route completion** |
| Staff | **Collector scorecard** (monthly score / by period) · **Attendance** |
| Complaints | Complaints · **Repeat complaints** |
| Fleet | **Fuel** (flags vans with poor km/litre) · **Maintenance** |
| Records | Survey progress · Customers · Registers |
| Contract | **Targets & KPIs** (what the City sees, your rank) · **Monthly report (PDF)** |

### Finance Reports

| Tab | Use it to |
|---|---|
| **Billing runs** | See each month's bills and collection %; click a month for its wards |
| **Bills by collector** | Billed, received and outstanding per collector |
| **Household collection** | What each household was billed and paid |
| **Household dues** | Unpaid bills by month status, or **by age** (1–30, 31–60, 61–90, 90+ days) with phone numbers |
| **Cash & deposits** | Cash each collector holds and for how long (late after 3 days, overdue after 7), then the month's reconciliation |

### Monthly report for the City

**Operations Reports → Contract → Monthly report** → pick the month → **Download
PDF**. It holds key figures and every main table.

---

## 7. If something goes wrong

| You see | It means | Do this |
|---|---|---|
| A holding will not go on a route | Its location is not verified | Verify it at the door |
| A holding was not billed | No charge, not on a route, or inactive | Set its charge; put it on a route |
| "Households must equal units" | More active families than units | Raise units or set a family inactive |
| Cash shows "overdue" | A collector has held cash over 7 days | Record the deposit |
| A route shows "No collector assigned" | Nobody walks it | Assign one from Route Plan |
