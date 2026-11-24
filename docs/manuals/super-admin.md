# Smart Sweep — manual for the Super Admin

**Who this is for:** the system owner who sets up cities, agencies and users and
can see everything.

**What you see:** every city, every agency, every screen.

**Your screens:** everything staff can open, plus **Setup**, **Agency Master**
and the **City Dashboard**.

---

## 1. Setting up a new city — in this order

1. **Setup → Cities** — code, name (English and Bangla), type, district, the
   **collection cut-off** (default 9:00 PM) and the **complaint deadline**
   (default 12:00 noon next day).
2. **Setup → Zones**, then **Wards** — start codes with the city code (e.g. `SCC-W22`).
3. **Setup → Dumping points** for its wards.
4. **Agency Master** — add its agencies (see below).
5. **Holding Master → Import** — upload its holdings.
6. **Users** — create agency admins, supervisors, collectors and a **City Viewer**.

Hiding a Setup entry takes it out of dropdowns; records using it keep it. A type
in use cannot be deleted.

---

## 2. Agency Master

### Adding an agency

1. Name (English and Bangla), short code, type, contact and contract details.
2. **District** and **City Corporation / Pourashova** — both required.
3. **Wards** — tick the wards it serves. Leave them all unticked and the agency
   gets **every ward of the chosen cities**.
4. **Target holdings** — the number of holdings its contract expects it to serve
   (used by the City Dashboard's Targets and league table).
5. Save. A new agency is **active**.

### Deactivating

Edit the agency → **Status**. Only active agencies appear in agency dropdowns.

### Moving a collector between agencies

**Collectors → open the collector → Transfer** → choose the new (active) agency
and the date. Their history stays with the right agency.

---

## 3. Users

| Role | Rule |
|---|---|
| **Agency Admin** | Must have an agency |
| **Supervisor / Collector** | Area must be inside their agency's cities |
| **City Viewer** | Only a super admin can create one. Scope is always the city; choose the city to restrict them to it. No agency. |

Agency admins can add only collectors and supervisors; supervisors only
collectors. You cannot change your own role or area. Accounts are deactivated,
not deleted.

---

## 4. The City Dashboard

Same as the City Viewer's (see that manual), with a **city picker** for any
city: Summary · Collection · Service trend · Complaints · Registers · Targets.
"Mark all collected" on the Collection tab closes a day by hand (preview first).

---

## 5. Operations and Finance Reports across agencies

Both report pages have an **agency picker** at the top: **All agencies**, or one.
The pick applies to every tab. See the Agency Admin manual for what each tab shows.

---

## 6. Scheduled job on the server

`manage.py close_collection_day` must run from the server's scheduler every 15
minutes. It closes each city's collection day at its cut-off, and also resets
collector attendance for the new day. Without it, collection history stays empty.

---

## 7. If something goes wrong

| You see | It means | Do this |
|---|---|---|
| City Dashboard history empty | The day-end job is not running | Schedule `close_collection_day` |
| An agency is missing from dropdowns | It is inactive | Set it active in Agency Master |
| A City Viewer sees every city | No city on their account | Edit the user and choose the city |
| An agency user cannot add a collector in a city | That city is outside the agency's area | Add the city to the agency, or use another agency |
