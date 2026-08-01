"""Build the Smart Sweep SWMS Postman collection (v2.1.0).

Paths and query parameters are taken from the drf-spectacular schema; request
bodies for @action endpoints are written by hand, because spectacular defaults
those to the viewset serializer rather than the action's own serializer.
"""

from __future__ import annotations

import json
import sys

COLLECTION_NAME = "Smart Sweep SWMS API"


def q(key, value, desc="", enabled=True):
    row = {"key": key, "value": value, "description": desc}
    if not enabled:
        row["disabled"] = True
    return row


def req(name, method, path, *, desc="", query=None, body=None, formdata=None,
        auth=True, tests=None, prereq=None):
    """One Postman request item.

    `path` is written with {{var}} placeholders and a leading /api.
    """
    segments = [s for s in path.strip("/").split("/") if s]
    # Postman rebuilds the URL from `path`, so the trailing slash Django requires
    # has to survive as an empty final segment. Without it a POST hits
    # APPEND_SLASH's 301 and the body is dropped on the redirect.
    if path.endswith("/"):
        segments.append("")
    url = {
        "raw": "{{baseUrl}}" + path + ("?" + "&".join(
            f"{p['key']}={p['value']}" for p in (query or []) if not p.get("disabled")
        ) if query else ""),
        "host": ["{{baseUrl}}"],
        "path": segments,
    }
    if query:
        url["query"] = query

    item = {
        "name": name,
        "request": {
            "method": method,
            "header": [],
            "url": url,
            "description": desc,
        },
        "response": [],
    }

    if body is not None:
        item["request"]["header"].append(
            {"key": "Content-Type", "value": "application/json"}
        )
        item["request"]["body"] = {
            "mode": "raw",
            "raw": json.dumps(body, indent=2, ensure_ascii=False),
            "options": {"raw": {"language": "json"}},
        }
    elif formdata is not None:
        item["request"]["body"] = {"mode": "formdata", "formdata": formdata}

    if not auth:
        item["request"]["auth"] = {"type": "noauth"}

    events = []
    if prereq:
        events.append({"listen": "prerequest",
                       "script": {"type": "text/javascript", "exec": prereq}})
    if tests:
        events.append({"listen": "test",
                       "script": {"type": "text/javascript", "exec": tests}})
    if events:
        item["event"] = events
    return item


def folder(name, desc, items):
    return {"name": name, "description": desc, "item": items}


# --------------------------------------------------------------------------- #
# Reusable snippets
# --------------------------------------------------------------------------- #

CAPTURE_SESSION = [
    "// Store the JWT pair and the signed-in operator for every later request.",
    "const ok = pm.response.code === 200;",
    "pm.test('signed in', () => pm.expect(ok).to.be.true);",
    "if (ok) {",
    "  const body = pm.response.json();",
    "  pm.collectionVariables.set('accessToken', body.access);",
    "  pm.collectionVariables.set('refreshToken', body.refresh);",
    "  pm.collectionVariables.set('roleKey', body.user.roleKey);",
    "  if (body.user.collector) pm.collectionVariables.set('collectorId', body.user.collector);",
    "  console.log('Signed in as', body.user.name, '(' + body.user.role + ')');",
    "}",
]

CAPTURE_OTP = [
    "// With OTP_EXPOSE_CODE=True and DEBUG=True the server returns the code so",
    "// the demo can sign in without an SMS gateway. It is absent in production.",
    "const body = pm.response.json();",
    "if (body.devCode) {",
    "  pm.collectionVariables.set('otpCode', body.devCode);",
    "  console.log('Login code:', body.devCode);",
    "} else {",
    "  console.warn('No devCode in the response — read the code from the SMS.');",
    "}",
    "pm.test('code issued', () => pm.expect(pm.response.code).to.eql(200));",
]

PAGING = [
    q("page", "1", "Page number.", enabled=False),
    q("page_size", "50", "Rows per page. `all` returns a bare array, unpaginated.", enabled=False),
    q("search", "", "Free-text search over this resource's search fields.", enabled=False),
    q("ordering", "", "Field to sort by; prefix with `-` to reverse.", enabled=False),
]


def paged(*extra):
    return list(extra) + PAGING


FORMAT_Q = q("format", "", "Omit for JSON; `csv`, `xlsx` or `pdf` returns a file.", enabled=False)

# --------------------------------------------------------------------------- #
# 00 · Auth
# --------------------------------------------------------------------------- #

auth_items = [
    req("Demo operators (DEBUG only)", "GET", "/api/auth/demo-operators/",
        auth=False,
        desc="The four demo personas the login screen offers as shortcuts. Returns "
             "an empty list when `DJANGO_DEBUG=False` — it would otherwise be an "
             "account-enumeration endpoint."),

    req("PIN status", "GET", "/api/auth/pin/status/",
        auth=False,
        query=[q("phone", "{{phone}}", "Mobile number in any accepted local format.")],
        desc="Does this number have a PIN, and is it locked out? The login screen "
             "calls this first to decide whether to offer the PIN fast path or go "
             "straight to SMS."),

    req("1 · Request login code (OTP)", "POST", "/api/auth/otp/request/",
        auth=False,
        body={"phone": "{{phone}}"},
        tests=CAPTURE_OTP,
        desc="Issues a 4-digit code. The response also carries `known`, `hasPin` and "
             "`pinLocked` so the login screen can branch without a second round "
             "trip. In DEBUG with `OTP_EXPOSE_CODE=True`, `devCode` holds the code "
             "and this request's test script captures it into `{{otpCode}}`.\n\n"
             "Throttled under the `otp` scope."),

    req("2 · Verify code → JWT pair", "POST", "/api/auth/otp/verify/",
        auth=False,
        body={"phone": "{{phone}}", "code": "{{otpCode}}"},
        tests=CAPTURE_SESSION,
        desc="Exchanges a valid code for `{access, refresh, user}`. An unknown "
             "number is provisioned as a Collector-role 'Field Operator', which is "
             "how field staff are onboarded without a registration screen. A "
             "successful OTP also clears any PIN lockout — OTP is the recovery path."),

    req("Sign in with PIN", "POST", "/api/auth/pin/login/",
        auth=False,
        body={"phone": "{{phone}}", "pin": "{{pin}}"},
        tests=CAPTURE_SESSION,
        desc="The fast path field collectors use where mobile coverage is "
             "unreliable. Returns the same `{access, refresh, user}` body as OTP "
             "verification.\n\nAn unknown number and a wrong PIN fail identically "
             "(`wrong_pin`), so this cannot be used to enumerate accounts. After "
             "`PIN_MAX_ATTEMPTS` misses the account locks for `PIN_LOCKOUT_SECONDS` "
             "and answers `pin_locked`."),

    req("Set a PIN", "POST", "/api/auth/pin/",
        body={"pin": "{{pin}}"},
        desc="Sets the signed-in operator's PIN. Requires a live access token — a "
             "PIN is set *after* an OTP sign-in, never instead of one."),

    req("Change PIN", "PUT", "/api/auth/pin/",
        body={"currentPin": "{{pin}}", "pin": "2468"},
        desc="Fails with `no_pin` if none is set, `wrong_pin` if `currentPin` is wrong."),

    req("Remove PIN", "DELETE", "/api/auth/pin/",
        desc="Clears the PIN; the account falls back to OTP-only sign-in."),

    req("Who am I", "GET", "/api/auth/me/",
        desc="The session user: role, ward scope, `home` landing route, `readOnly` "
             "flag, and the linked `collector` id when the operator is one."),

    req("Update my profile", "PATCH", "/api/auth/me/",
        body={
            "name": "Rahim Uddin",
            "email": "rahim@example.com",
            "altPhone": "01711000043",
            "nid": "1990123456789",
            "bloodGroup": "B+",
            "emergencyContact": "01700000000",
        },
        desc="Self-service profile edit. Role and ward scope are **not** writable "
             "here — those are set by an agency admin. Returns the full user."),

    req("Refresh access token", "POST", "/api/auth/refresh/",
        auth=False,
        body={"refresh": "{{refreshToken}}"},
        tests=[
            "if (pm.response.code === 200) {",
            "  const body = pm.response.json();",
            "  pm.collectionVariables.set('accessToken', body.access);",
            "  if (body.refresh) pm.collectionVariables.set('refreshToken', body.refresh);",
            "}",
        ],
        desc="Rotates the refresh token. A dead token answers 401 with "
             "`{detail, code: 'token_invalid', fields}` rather than SimpleJWT's own "
             "shape, so the frontend interceptor has one envelope to branch on."),

    req("Sign out", "POST", "/api/auth/logout/",
        body={"refresh": "{{refreshToken}}"},
        desc="Blacklists the refresh token. Always answers `{ok: true}` — revoking "
             "an already-dead token is not an error."),
]

# --------------------------------------------------------------------------- #
# 01 · Catalog
# --------------------------------------------------------------------------- #

catalog_items = [
    req("Catalog bundle", "GET", "/api/catalog/",
        desc="**Call this once after signing in.** Every dropdown the app needs in "
             "one round trip: zones, wards, `roadsByWard`, tiers, blood groups, and "
             "the eight option lists (customer types, holding types, storage types, "
             "suitable times, payment modes, potential reasons, time gaps, current "
             "practices).\n\nEvery option row carries both `key` (the i18n key the "
             "Bangla dictionary resolves) and `label` (the English fallback)."),

    req("List zones", "GET", "/api/zones/", query=paged()),
    req("Create zone", "POST", "/api/zones/",
        body={"id": "Z-07", "key": "opt.zone.Z-07", "name": "Boyra"},
        desc="Agency admin only. Ids are supplied, not generated — they appear on "
             "printed material."),
    req("Get zone", "GET", "/api/zones/{{zoneId}}/"),
    req("Update zone", "PATCH", "/api/zones/{{zoneId}}/", body={"name": "Sonadanga"}),
    req("Delete zone", "DELETE", "/api/zones/{{zoneId}}/"),

    req("List wards", "GET", "/api/wards/",
        query=paged(q("zone", "{{zoneId}}", "Filter to one zone.", enabled=False),
                    q("active", "true", "", enabled=False))),
    req("Create ward", "POST", "/api/wards/",
        body={"id": "W-22", "key": "opt.ward.W-22", "name": "Ward 22 — Boyra",
              "zone": "{{zoneId}}", "lat": 22.8340, "lng": 89.5002},
        desc="Agency admin only. `lat`/`lng` is the ward centre the live map "
             "centres on and generated households scatter around."),
    req("Get ward", "GET", "/api/wards/{{wardId}}/"),
    req("Update ward", "PATCH", "/api/wards/{{wardId}}/", body={"name": "Ward 14 — Sonadanga"}),
    req("Delete ward", "DELETE", "/api/wards/{{wardId}}/"),

    req("List roads", "GET", "/api/roads/",
        query=paged(q("ward", "{{wardId}}", "Filter to one ward.", enabled=False),
                    q("active", "true", "", enabled=False))),
    req("Create road", "POST", "/api/roads/",
        body={"ward": "{{wardId}}", "name": "KDA Avenue"}),
    req("Get road", "GET", "/api/roads/{{roadId}}/"),
    req("Update road", "PATCH", "/api/roads/{{roadId}}/", body={"name": "KDA Avenue (South)"}),
    req("Delete road", "DELETE", "/api/roads/{{roadId}}/"),

    req("List tiers", "GET", "/api/tiers/", query=paged(),
        desc="Service tiers and the monthly charge each one carries. A household's "
             "`charge` defaults from its tier."),
    req("Create tier", "POST", "/api/tiers/",
        body={"id": "commercial_medium", "key": "opt.tier.commercial_medium",
              "label": "Commercial — medium", "charge": 400}),
    req("Get tier", "GET", "/api/tiers/{{tierId}}/"),
    req("Update tier", "PATCH", "/api/tiers/{{tierId}}/", body={"charge": 120},
        desc="Changing a tier's charge does **not** restate bills already issued — "
             "a bill records the amount at the moment it was raised."),
    req("Delete tier", "DELETE", "/api/tiers/{{tierId}}/"),
]

# --------------------------------------------------------------------------- #
# 02 · Customers
# --------------------------------------------------------------------------- #

HOUSEHOLD_BODY = {
    "ward": "{{wardId}}",
    "road": "KDA Avenue",
    "holding": "42/A",
    "head": "Rahim Uddin",
    "phone": "01711223344",
    "tier": "{{tierId}}",
    "charge": 100,
    "paymentMode": "cash",
    "paymentDay": 5,
    "status": "active",
    "customerType": "residential",
    "holdingType": "single_storey",
    "storage": "covered_bin",
    "suitableTime": "morning",
    "floor": "Ground",
    "members": 5,
    "membersUnder5": 1,
    "membersFemale": 3,
    "profession": "Teacher",
    "address": "42/A KDA Avenue, Sonadanga",
    "lat": 22.8452,
    "lng": 89.5405,
    "accuracy": 8,
    "qr": "",
}

customers_items = [
    req("List households", "GET", "/api/households/",
        query=paged(
            q("ward", "{{wardId}}", "", enabled=False),
            q("zone", "{{zoneId}}", "", enabled=False),
            q("road", "", "", enabled=False),
            q("tier", "{{tierId}}", "", enabled=False),
            q("status", "active", "`active` | `inactive`.", enabled=False),
            q("customer_type", "residential", "", enabled=False),
            q("verified", "true", "GPS pin confirmed.", enabled=False),
            q("located", "true", "Has coordinates at all.", enabled=False),
            q("hasDues", "true", "Outstanding money on record.", enabled=False),
            q("unplanned", "true", "Not on any route.", enabled=False),
        ),
        desc="The customer register. Results are **ward-scoped server-side** to the "
             "caller: a supervisor's `?ward=` cannot widen past their own wards."),

    req("Create household", "POST", "/api/households/", body=HOUSEHOLD_BODY,
        desc="`ward`, `road`, `holding`, `head`, `tier`, `paymentMode`, "
             "`customerType`, `storage`, `holdingType` and `suitableTime` are "
             "required. The id (`HH-KCC-…`) is allocated by the server.\n\n"
             "`charge` defaults from the tier when omitted."),

    req("Get household", "GET", "/api/households/{{householdId}}/",
        desc="Also carries derived fields: `lastVisit` (computed from the visit "
             "log, never stored), `effectiveCharge`, `routable` and `routeId`."),

    req("Update household", "PATCH", "/api/households/{{householdId}}/",
        body={"phone": "01711223355", "suitableTime": "evening"}),

    req("Delete household", "DELETE", "/api/households/{{householdId}}/"),

    req("Verify GPS location", "POST", "/api/households/{{householdId}}/verify/",
        body={"lat": 22.8452, "lng": 89.5405, "accuracy": 8, "placedByHand": False},
        desc="Confirms the holding's pin. **This is the gate for routing** — the "
             "server refuses to put an unverified holding on a route.\n\n"
             "`placedByHand: true` records that an office user dropped the pin on a "
             "map rather than a collector standing at the door with GPS."),

    req("Resolve a QR tag", "GET", "/api/households/by-qr/{{qrTag}}/",
        desc="Look up the household behind a scanned bin sticker. Use "
             "`/api/collection/scan/` instead when the scan happens during a round — "
             "that one also answers *whether the stop belongs to this collector today*."),

    req("Unplanned holdings", "GET", "/api/households/unplanned/",
        desc="The route planner's to-do list, split the way the planner presents it: "
             "holdings that could be routed now, and holdings blocked because their "
             "location is unverified."),

    req("List potential customers (surveys)", "GET", "/api/potential-customers/",
        query=paged(
            q("ward", "{{wardId}}", "", enabled=False),
            q("zone", "{{zoneId}}", "", enabled=False),
            q("converted", "false", "Exclude surveys already signed up.", enabled=False),
            q("reason", "refused_charge", "", enabled=False),
            q("time_gap", "never", "", enabled=False),
            q("current_practice", "roadside_dump", "", enabled=False),
            q("verified", "true", "", enabled=False),
        ),
        desc="Surveyed 'ghost homes' — holdings not yet paying for service. Kept "
             "separate from households so the conversion funnel has history."),

    req("Create survey", "POST", "/api/potential-customers/",
        body={
            "ward": "{{wardId}}", "road": "KDA Avenue", "holding": "77/B",
            "head": "Salma Begum", "phone": "01911223344",
            "estTier": "{{tierId}}", "surveyedAt": "{{today}}",
            "surveyor": "{{collectorId}}",
            "reason": "never_approached", "timeGap": "never",
            "currentPractice": "roadside_dump",
            "customerType": "residential", "holdingType": "single_storey",
            "storage": "open_bin", "suitableTime": "morning",
            "lat": 22.8455, "lng": 89.5410, "accuracy": 10,
            "notes": "Interested if the charge can be paid weekly.",
        }),

    req("Get survey", "GET", "/api/potential-customers/{{potentialId}}/"),
    req("Update survey", "PATCH", "/api/potential-customers/{{potentialId}}/",
        body={"notes": "Follow up after Eid."}),
    req("Delete survey", "DELETE", "/api/potential-customers/{{potentialId}}/"),

    req("Verify survey location", "POST", "/api/potential-customers/{{potentialId}}/verify/",
        body={"lat": 22.8455, "lng": 89.5410, "accuracy": 10, "placedByHand": False}),

    req("Convert survey → household", "POST", "/api/potential-customers/{{potentialId}}/convert/",
        body={"tier": "{{tierId}}", "charge": 100, "paymentMode": "cash",
              "paymentDay": 5, "qr": ""},
        desc="Signs the holding up for service. Returns `{household, potential}`: "
             "the new customer **and** the survey, which is closed rather than "
             "deleted so the conversion funnel keeps its history.\n\n"
             "Every field is optional — omitted ones fall back to the survey's "
             "estimates (`estTier` becomes `tier`). Converting twice fails with "
             "`already_converted`."),
]

# --------------------------------------------------------------------------- #
# 03 · Collectors
# --------------------------------------------------------------------------- #

collector_items = [
    req("List collectors", "GET", "/api/collectors/",
        query=paged(
            q("ward", "{{wardId}}", "", enabled=False),
            q("zone", "{{zoneId}}", "", enabled=False),
            q("status", "on_route", "`on_route` | `idle` | `off_route`.", enabled=False),
            q("attendance", "checked_in", "`checked_in` | `absent`.", enabled=False),
            q("hasVan", "true", "", enabled=False),
            q("active", "true", "", enabled=False),
        ),
        desc="DSP field staff. Rows carry live `complaints`, `vanId` and "
             "`assignmentId` alongside the licensing and performance fields."),

    req("Create collector", "POST", "/api/collectors/",
        body={"name": "Karim Sheikh", "dspId": "DSP-2291", "zone": "{{wardId}}",
              "phone": "01712345678", "license": "DK-114522",
              "licenseExp": "2027-03-31", "joined": "2025-01-15",
              "status": "idle", "attendance": "absent", "active": True},
        desc="Agency admin only. Note that `zone` on a collector holds a **ward** "
             "id — the field keeps its JavaScript-era name so the frontend "
             "contract did not have to change."),

    req("Get collector", "GET", "/api/collectors/{{collectorId}}/"),
    req("Update collector", "PATCH", "/api/collectors/{{collectorId}}/",
        body={"phone": "01712345679", "licenseExp": "2028-03-31"}),
    req("Delete collector", "DELETE", "/api/collectors/{{collectorId}}/"),

    req("Mark attendance", "POST", "/api/collectors/{{collectorId}}/attendance/",
        body={"attendance": "checked_in"},
        desc="Depot check-in or absence for today. `checked_in` | `absent`."),

    req("Recalculate performance metrics", "POST", "/api/collectors/refresh-metrics/",
        body={"days": 30},
        desc="Recomputes `coverage` and `onTime` for every collector from the visit "
             "log.\n\n**Agency admin only** — the figures feed staff reviews, so a "
             "supervisor cannot recalculate their own team's numbers on demand."),
]

# --------------------------------------------------------------------------- #
# 04 · Routes & assignments
# --------------------------------------------------------------------------- #

routes_items = [
    req("List routes", "GET", "/api/routes/",
        query=paged(
            q("ward", "{{wardId}}", "", enabled=False),
            q("zone", "{{zoneId}}", "", enabled=False),
            q("collector", "{{collectorId}}", "Routes this collector is assigned.", enabled=False),
            q("unassigned", "true", "Routes nobody is walking.", enabled=False),
            q("active", "true", "", enabled=False),
        )),

    req("Create route", "POST", "/api/routes/",
        body={"name": "KDA Avenue morning", "ward": "{{wardId}}",
              "windowStart": "06:30", "windowEnd": "09:30",
              "stops": ["{{householdId}}"], "active": True},
        desc="`stops` is the ordered walk. Every household in it must have a "
             "**verified** location or the request fails.\n\nThe id "
             "(`RT-W-14-01`) is allocated per ward."),

    req("Get route", "GET", "/api/routes/{{routeId}}/"),
    req("Update route", "PATCH", "/api/routes/{{routeId}}/",
        body={"windowStart": "06:00", "windowEnd": "09:00"}),
    req("Delete route", "DELETE", "/api/routes/{{routeId}}/"),

    req("Replace the whole stop list", "POST", "/api/routes/{{routeId}}/stops/",
        body={"stops": ["HH-KCC-0012840", "HH-KCC-0012841", "HH-KCC-0012842"]},
        desc="Sets the ordered walk in one call, so a drag-reorder on the planner "
             "is **atomic** — the route is never briefly half-ordered. Prefer this "
             "over a sequence of add/remove calls when the user reorders."),

    req("Append one stop", "POST", "/api/routes/{{routeId}}/add-stop/",
        body={"hh": "{{householdId}}"},
        desc="Adds the holding to the end of the walk. A holding already on another "
             "route **moves** here rather than being refused — that is what "
             "dragging it across routes on the planner means."),

    req("Remove one stop", "POST", "/api/routes/{{routeId}}/remove-stop/",
        body={"hh": "{{householdId}}"},
        desc="Takes the holding off the walk and closes the gap in the numbering."),

    req("List assignments", "GET", "/api/assignments/",
        query=paged(
            q("collector", "{{collectorId}}", "", enabled=False),
            q("ward", "{{wardId}}", "", enabled=False),
            q("active", "true", "", enabled=False),
        ),
        desc="Which collector walks which routes."),

    req("Create assignment", "POST", "/api/assignments/",
        body={"collector": "{{collectorId}}", "routes": ["{{routeId}}"], "active": True}),

    req("Get assignment", "GET", "/api/assignments/{{assignmentId}}/"),
    req("Update assignment", "PATCH", "/api/assignments/{{assignmentId}}/",
        body={"active": False}),
    req("Delete assignment", "DELETE", "/api/assignments/{{assignmentId}}/"),

    req("Set the routes this assignment covers", "POST", "/api/assignments/{{assignmentId}}/routes/",
        body={"routes": ["{{routeId}}"]},
        desc="A route already held by somebody else is **taken over** — the planner "
             "allows reassigning, and the conflicting link is dropped."),
]

# --------------------------------------------------------------------------- #
# 05 · Round & visits
# --------------------------------------------------------------------------- #

round_items = [
    req("My round today", "GET", "/api/collection/round/",
        query=[q("collector", "{{collectorId}}", "Collector id, e.g. C-042."),
               q("day", "{{today}}", "YYYY-MM-DD. Defaults to today.")],
        desc="Everything the round screen renders in one call: `stops` in walking "
             "order, the three `counts` its tabs show, and the `routes` behind them "
             "for the headings.\n\nA **collector-role** caller is pinned to their "
             "own round whatever they pass — a round names households and phone "
             "numbers. Supervisors and admins may look in on anyone, which is how a "
             "round gets reviewed from a desk."),

    req("Resolve a scan against the round", "POST", "/api/collection/scan/",
        body={"raw": "{{qrTag}}", "collector": "{{collectorId}}", "day": "{{today}}"},
        desc="Answers **200 in every case** — a wrong-round or worn-label scan is "
             "something the collector acts on, not a failed request.\n\n"
             "`{ok: true, stop}` — scan is a stop on this round.\n"
             "`{ok: false, reason: 'alreadyCollected', stop}` — stops a double entry.\n"
             "`{ok: false, reason: 'otherRoute', ...}` — a wrong-round mistake the "
             "collector can fix on the spot.\n"
             "`{ok: false, reason: 'unknown'}` — unregistered or damaged tag; needs the office.\n"
             "`{ok: false, reason: 'unreadable'}` — the camera got nothing."),

    req("List visits", "GET", "/api/visits/",
        query=paged(
            q("collector", "{{collectorId}}", "", enabled=False),
            q("hh", "{{householdId}}", "", enabled=False),
            q("route", "{{routeId}}", "", enabled=False),
            q("ward", "{{wardId}}", "", enabled=False),
            q("day", "{{today}}", "One date.", enabled=False),
            q("dateFrom", "", "YYYY-MM-DD.", enabled=False),
            q("dateTo", "", "YYYY-MM-DD.", enabled=False),
            q("status", "collected", "`collected` | `skipped`.", enabled=False),
            q("source", "scan", "`scan` | `manual`.", enabled=False),
            q("synced", "false", "Still queued on a device.", enabled=False),
        )),

    req("Record a collection", "POST", "/api/visits/",
        body={"hh": "{{householdId}}", "collector": "{{collectorId}}",
              "status": "collected", "at": "{{nowIso}}", "source": "scan",
              "lat": 22.8452, "lng": 89.5405, "accuracy": 6, "note": ""},
        desc="**One visit per household per day**, enforced by a unique constraint "
             "on `(household, served_on)`. Re-posting for the same day updates that "
             "row rather than inserting a second one — which is exactly what "
             "correcting a skip to a collection, and the offline queue, rely on.\n\n"
             "The tag and route are taken from the plan, not the request, and the "
             "live map is notified."),

    req("Record a skip", "POST", "/api/visits/",
        body={"hh": "{{householdId}}", "collector": "{{collectorId}}",
              "status": "skipped", "at": "{{nowIso}}", "source": "manual",
              "reason": "locked", "note": "Nobody home; gate padlocked."},
        desc="A skip needs a `reason`: `noOne` | `noWaste` | `locked` | `access` | "
             "`refused`. Correcting it later to `collected` updates the same row."),

    req("Get visit", "GET", "/api/visits/{{visitId}}/"),
    req("Update visit", "PATCH", "/api/visits/{{visitId}}/", body={"note": "Corrected on review."}),
    req("Delete visit", "DELETE", "/api/visits/{{visitId}}/"),

    req("Upload the offline queue", "POST", "/api/visits/bulk/",
        body={"rows": [
            {"hh": "HH-KCC-0012840", "collector": "{{collectorId}}",
             "status": "collected", "at": "{{nowIso}}", "source": "scan",
             "lat": 22.8452, "lng": 89.5405, "accuracy": 6},
            {"hh": "HH-KCC-0012841", "collector": "{{collectorId}}",
             "status": "skipped", "at": "{{nowIso}}", "source": "manual",
             "reason": "locked", "note": "Gate locked"},
        ]},
        desc="What a device flushes when it regains connectivity.\n\n**Answers with "
             "per-row outcomes rather than one status code** — the device has to "
             "know which rows it may drop and which to keep retrying. A single bad "
             "row never rejects the batch."),

    req("Acknowledge a synced row", "POST", "/api/visits/{{visitId}}/sync/",
        desc="Marks a queued record as having reached the server. No body."),
]

# --------------------------------------------------------------------------- #
# 06 · Complaints
# --------------------------------------------------------------------------- #

complaint_items = [
    req("List complaints", "GET", "/api/complaints/",
        query=paged(
            q("status", "open", "`open` | `assigned` | `in_progress` | `resolved` | `closed`.", enabled=False),
            q("priority", "urgent", "`urgent` | `high` | `medium` | `low`.", enabled=False),
            q("type", "missed_collection", "", enabled=False),
            q("channel", "phone", "`sms` | `app` | `phone` | `counter`.", enabled=False),
            q("assigned", "{{collectorId}}", "", enabled=False),
            q("hh", "{{householdId}}", "", enabled=False),
            q("ward", "{{wardId}}", "", enabled=False),
            q("zone", "{{zoneId}}", "", enabled=False),
            q("active", "true", "Not yet resolved or closed.", enabled=False),
            q("breached", "true", "Past its SLA budget.", enabled=False),
            q("opened_after", "", "YYYY-MM-DD.", enabled=False),
            q("opened_before", "", "YYYY-MM-DD.", enabled=False),
        ),
        desc="Rows carry the derived `slaState`, `priorityRank` and `nextStatus`, "
             "plus the household's `head`, `holding`, `road` and `phone` so the "
             "list needs no second lookup."),

    req("Open a complaint", "POST", "/api/complaints/",
        body={"hh": "{{householdId}}", "type": "missed_collection",
              "channel": "phone", "priority": "high",
              "description": "Bin not emptied for three days.",
              "assigned": "{{collectorId}}",
              "note": "Caller says this is the second time this month."},
        desc="`type`: `missed_collection` | `overflow` | `billing_dispute` | "
             "`staff_behaviour` | `other`.\n\n`note` is write-only — it becomes the "
             "first entry in the audit trail. `sla` defaults from the priority."),

    req("Get complaint", "GET", "/api/complaints/{{complaintId}}/",
        desc="Includes the full `activity` trail and any attached `photos`."),

    req("Edit complaint details", "PATCH", "/api/complaints/{{complaintId}}/",
        body={"description": "Bin not emptied since Sunday."},
        desc="**`status` is not writable here.** Each lifecycle move is its own "
             "action endpoint, so a ticket cannot change hands without a trail."),

    req("Delete complaint", "DELETE", "/api/complaints/{{complaintId}}/"),

    req("Assign to a collector", "POST", "/api/complaints/{{complaintId}}/assign/",
        body={"assigned": "{{collectorId}}", "note": "Nearest collector on shift."},
        desc="Hands the ticket over — or back to the unassigned pool with "
             "`\"assigned\": null`. Appends an audit entry."),

    req("Advance one step", "POST", "/api/complaints/{{complaintId}}/advance/",
        body={"note": "Collector en route."},
        desc="Moves along the lifecycle: open → assigned → in_progress → resolved → "
             "closed. Read `nextStatus` on the ticket to know where this lands."),

    req("Re-grade priority", "POST", "/api/complaints/{{complaintId}}/priority/",
        body={"priority": "urgent", "note": "Overflow onto the road."},
        desc="**The SLA budget follows the priority** — re-grading changes the clock."),

    req("Resolve", "POST", "/api/complaints/{{complaintId}}/resolve/",
        body={"note": "Bin emptied and collector briefed."},
        desc="Records how it was resolved and stops the SLA clock."),

    req("Reopen", "POST", "/api/complaints/{{complaintId}}/reopen/",
        body={"note": "Citizen says it is not fixed."},
        desc="Restarts the clock."),

    req("Add a note", "POST", "/api/complaints/{{complaintId}}/note/",
        body={"note": "Left a voicemail for the head of household."},
        desc="Appends to the trail without changing the ticket."),

    req("Attach photos", "POST", "/api/complaints/{{complaintId}}/photos/",
        formdata=[
            {"key": "images", "type": "file", "src": [],
             "description": "One or many image files — pick them in Postman."},
            {"key": "caption", "value": "Overflow at the corner bin", "type": "text"},
        ],
        desc="`multipart/form-data`. The collector app posts several at once from "
             "the camera roll, so any number of `images` parts is accepted.\n\n"
             "**Every file is validated before the first one is stored**, so a "
             "rejected batch leaves nothing behind."),

    req("Complaint KPI summary", "GET", "/api/complaints/summary/",
        query=[q("ward", "{{wardId}}", "", enabled=False),
               q("status", "open", "", enabled=False),
               q("breached", "true", "", enabled=False)],
        desc="Honours the same filters as the list, so *'breached tickets in Ward 14 "
             "this month'* is one request rather than downloading the rows and "
             "counting them in the browser."),
]

# --------------------------------------------------------------------------- #
# 07 · Billing
# --------------------------------------------------------------------------- #

billing_items = [
    req("List bills", "GET", "/api/bills/",
        query=paged(
            q("period", "{{period}}", "Billing month, YYYY-MM.", enabled=False),
            q("hh", "{{householdId}}", "", enabled=False),
            q("ward", "{{wardId}}", "", enabled=False),
            q("zone", "{{zoneId}}", "", enabled=False),
            q("run", "", "Billing-run id.", enabled=False),
            q("status", "unpaid", "The cached column.", enabled=False),
            q("settlement", "unpaid", "Derived in SQL from the payments that exist — "
                                      "prefer this over `status`.", enabled=False),
            q("hasOutstanding", "true", "", enabled=False),
        ),
        desc="Each row carries `received`, `outstanding` and `settlement`, computed "
             "from the payments that actually exist.\n\nFilter on **`settlement`**, "
             "not `status`: `status` is only ever as fresh as the last "
             "`recalculate()`, while `settlement` is derived in SQL and can never "
             "disagree with the figures shown."),

    req("Preview a billing run (dry run)", "POST", "/api/bills/generate/",
        body={"period": "{{period}}", "issuedOn": "{{today}}", "dueDays": 10, "dryRun": True},
        desc="**Agency admin only.** Returns the same summary as a real run — how "
             "many bills, for how much — without writing anything. Answers 200.\n\n"
             "Always dry-run first: a run is the only way bills come into "
             "existence, and there is no bulk undo."),

    req("Run the month's billing", "POST", "/api/bills/generate/",
        body={"period": "{{period}}", "issuedOn": "{{today}}", "dueDays": 10, "dryRun": False},
        desc="**Agency admin only.** Issues one bill per active household for the "
             "period and writes a `BillingRun` audit row. Answers 201.\n\n"
             "Re-running the same period does not double-charge — existing bills "
             "for the month are respected."),

    req("Billing stat cards", "GET", "/api/bills/summary/",
        query=[q("period", "{{period}}", "Billing month, YYYY-MM."),
               q("ward", "{{wardId}}", "", enabled=False)],
        desc="Honours the same query parameters as the list, so the cards always "
             "describe exactly the rows shown beneath them."),

    req("Get bill", "GET", "/api/bills/{{billId}}/"),

    req("Record a payment against a bill", "POST", "/api/bills/{{billId}}/pay/",
        body={"amount": 100, "method": "cash", "collector": "{{collectorId}}",
              "at": "{{nowIso}}", "reference": "", "note": ""},
        desc="**The only way a bill's status changes.** `Bill.status` is a cache "
             "that `recalculate()` derives from the payments that exist, and "
             "`Household.dues` follows from that.\n\nPartial payments are normal — "
             "post several and the bill moves unpaid → partial → paid on its own.\n\n"
             "Open to **collectors** as well as office roles: the collector at the "
             "door is the person the cash is handed to. `collector` defaults to the "
             "signed-in collector; leave it out at the office counter, and that "
             "difference is what makes the cash reconciliation meaningful.\n\n"
             "Returns the restated bill."),

    req("Create bill directly (blocked)", "POST", "/api/bills/",
        body={"hh": "{{householdId}}", "period": "{{period}}", "issuedAt": "{{today}}",
              "amount": 100, "ward": "{{wardId}}"},
        desc="**Fails with `use_billing_run` for everyone but a superuser.** A "
             "hand-made bill would have no `run`, so the month's totals would stop "
             "describing the month and a household could quietly be charged twice. "
             "Use `POST /api/bills/generate/`.\n\nKept in the collection to document "
             "the refusal."),

    req("List payments", "GET", "/api/payments/",
        query=paged(
            q("period", "{{period}}", "The month the money was **taken** in, not the "
                                      "month its bill covers.", enabled=False),
            q("collector", "{{collectorId}}", "", enabled=False),
            q("hh", "{{householdId}}", "", enabled=False),
            q("bill", "{{billId}}", "", enabled=False),
            q("method", "cash", "", enabled=False),
            q("undeposited", "true", "Cash taken but not yet handed in.", enabled=False),
            q("at_after", "", "ISO datetime.", enabled=False),
            q("at_before", "", "ISO datetime.", enabled=False),
        ),
        desc="A July bill settled in August is money received in **August** — "
             "keeping the two apart is what makes a collection lag visible."),

    req("Record a payment directly", "POST", "/api/payments/",
        body={"bill": "{{billId}}", "collector": "{{collectorId}}", "amount": 100,
              "method": "cash", "at": "{{nowIso}}", "reference": "", "note": ""},
        desc="Equivalent to `POST /bills/{id}/pay/`; prefer that one, which returns "
             "the restated bill."),

    req("Get payment", "GET", "/api/payments/{{paymentId}}/"),

    req("Void a payment", "POST", "/api/payments/{{paymentId}}/void/",
        desc="**Agency admin only.** Removes a mis-keyed payment and restates the "
             "bill from what remains — returning the restated bill.\n\nThis is the "
             "one operation that can make money on record disappear, so it "
             "deliberately does not belong to the person who keyed it in. Payments "
             "are otherwise immutable: correct one by voiding it and re-recording."),

    req("List deposits", "GET", "/api/deposits/",
        query=paged(
            q("collector", "{{collectorId}}", "", enabled=False),
            q("period", "{{period}}", "", enabled=False),
            q("method", "cash", "", enabled=False),
        ),
        desc="Collector cash hand-ins. **Not ward-scoped** — a hand-in is a fact "
             "about a collector and a month, and scoping it by ward would hide "
             "hand-ins from the very supervisor reconciling them."),

    req("Record a hand-in", "POST", "/api/deposits/record/",
        body={"collector": "{{collectorId}}", "period": "{{period}}",
              "method": "cash", "amount": 4500, "at": "{{nowIso}}",
              "ref": "Depot slip 2291"},
        desc="Upserts this collector's hand-in for the month and links the payments "
             "it covers. Posting again for the same collector and month updates the "
             "existing row rather than adding a second one."),

    req("Get deposit", "GET", "/api/deposits/{{depositId}}/"),
    req("Update deposit", "PATCH", "/api/deposits/{{depositId}}/", body={"ref": "Depot slip 2292"}),
    req("Delete deposit", "DELETE", "/api/deposits/{{depositId}}/"),

    req("Cash position", "GET", "/api/deposits/cash-position/",
        query=[q("period", "{{period}}", "Required. YYYY-MM.")],
        desc="Collected vs deposited vs variance, per collector, for one month. "
             "Omitting `period` fails with `period_required`."),

    req("List billing runs", "GET", "/api/billing-runs/",
        query=paged(q("period", "{{period}}", "", enabled=False)),
        desc="The audit list. Written by `POST /bills/generate/` — creating one "
             "directly fails with `use_billing_run`."),

    req("Get billing run", "GET", "/api/billing-runs/{{billingRunId}}/"),
]

# --------------------------------------------------------------------------- #
# 08 · Fleet
# --------------------------------------------------------------------------- #

fleet_items = [
    req("List vans", "GET", "/api/vans/",
        query=paged(
            q("status", "active", "`active` | `in_maintenance` | `idle` | `retired`.", enabled=False),
            q("type", "compactor", "`compactor` | `pickup` | `rickshaw-van` | `tricycle`.", enabled=False),
            q("fuel", "diesel", "`diesel` | `petrol` | `cng` | `electric`.", enabled=False),
            q("ownership", "owned", "`owned` | `leased`.", enabled=False),
            q("driver", "{{collectorId}}", "", enabled=False),
            q("unassigned", "true", "Vans with no driver.", enabled=False),
        ),
        desc="Rows carry derived `expiringDocuments` and `serviceDueInKm`."),

    req("Add a van", "POST", "/api/vans/",
        body={"plate": "KHULNA-METRO-TA-11-4520", "type": "compactor",
              "capacity": 3000, "fuel": "diesel", "ownership": "owned",
              "gps": "GPS-7781", "odometer": 48210, "status": "active",
              "driver": "{{collectorId}}", "fitnessExp": "2026-11-30",
              "taxExp": "2026-09-15", "insuranceExp": "2026-12-01",
              "permitExp": "2027-01-20", "nextServiceKm": 53000, "kmpl": 6.1}),

    req("Get van", "GET", "/api/vans/{{vanId}}/"),
    req("Update van", "PATCH", "/api/vans/{{vanId}}/", body={"odometer": 48900}),
    req("Delete van", "DELETE", "/api/vans/{{vanId}}/"),

    req("Assign a driver", "POST", "/api/vans/{{vanId}}/assign-driver/",
        body={"driver": "{{collectorId}}"},
        desc="Sets — or with `null`, clears — the driver, **releasing them from any "
             "other van** so one person never appears to drive two."),

    req("Post one GPS ping", "POST", "/api/vans/{{vanId}}/position/",
        body={"lat": 22.8452, "lng": 89.5405, "speed": 14.2, "heading": 271,
              "accuracy": 5, "ignition": True, "at": "{{nowIso}}"},
        desc="The van comes from the URL, so the body does not repeat it. The ping "
             "fans out to every live-map client over the websocket.\n\nPosting an "
             "array here fails with `single_ping_only` — use "
             "`/api/positions/ingest/` for a batch."),

    req("Ingest telemetry (gateway)", "POST", "/api/positions/ingest/",
        body=[
            {"van": "{{vanId}}", "collector": "{{collectorId}}", "lat": 22.8452,
             "lng": 89.5405, "speed": 14.2, "heading": 271, "accuracy": 5,
             "ignition": True, "at": "{{nowIso}}"},
            {"van": "{{vanId}}", "lat": 22.8461, "lng": 89.5399, "speed": 11.0,
             "heading": 268, "ignition": True, "at": "{{nowIso}}"},
        ],
        desc="Where a tracker gateway posts telemetry. Accepts **either one ping or "
             "an array** — a device coming back from a dead spot flushes its whole "
             "queue in a single request, which is far cheaper than one HTTP round "
             "trip per stored point."),

    req("Fleet alerts", "GET", "/api/vans/alerts/",
        desc="Expiring paperwork and service-due warnings, computed against "
             "**today** rather than a fixed date."),

    req("Fleet KPIs", "GET", "/api/vans/kpis/",
        desc="Availability, downtime, efficiency and spend — the Fleet page's stat cards."),

    req("List maintenance jobs", "GET", "/api/maintenance/",
        query=paged(
            q("van", "{{vanId}}", "", enabled=False),
            q("kind", "scheduled", "`scheduled` | `unscheduled`.", enabled=False),
            q("isOpen", "true", "Still in the workshop.", enabled=False),
        )),

    req("Open a maintenance job", "POST", "/api/maintenance/",
        body={"van": "{{vanId}}", "kind": "unscheduled", "reason": "Hydraulic leak",
              "odometer": 48900, "vendor": "KDA Motors", "cost": 0},
        desc="**Opening a job may take the van off the road** — its status moves to "
             "`in_maintenance`, and it stops being available to assign."),

    req("Get maintenance job", "GET", "/api/maintenance/{{maintenanceId}}/"),
    req("Update maintenance job", "PATCH", "/api/maintenance/{{maintenanceId}}/", body={"vendor": "KDA Motors Ltd"}),
    req("Delete maintenance job", "DELETE", "/api/maintenance/{{maintenanceId}}/"),

    req("Close a maintenance job", "POST", "/api/maintenance/{{maintenanceId}}/close/",
        body={"closed": "{{nowIso}}", "cost": 7800, "downtime": 6.5},
        desc="Signs the job off, computing downtime and **freeing the van** back to "
             "`active`. Omit `downtime` to have it computed from the open and close "
             "timestamps."),

    req("List fuel logs", "GET", "/api/fuel-logs/",
        query=paged(
            q("van", "{{vanId}}", "", enabled=False),
            q("by", "{{collectorId}}", "", enabled=False),
            q("at_after", "", "ISO datetime.", enabled=False),
            q("at_before", "", "ISO datetime.", enabled=False),
        )),

    req("Log a refuelling", "POST", "/api/fuel-logs/",
        body={"van": "{{vanId}}", "litres": 42.5, "cost": 4900, "odometer": 48950,
              "by": "{{collectorId}}", "at": "{{nowIso}}"},
        desc="`kmpl` is computed from the odometer gap when omitted."),

    req("Get fuel log", "GET", "/api/fuel-logs/{{fuelLogId}}/"),
    req("Update fuel log", "PATCH", "/api/fuel-logs/{{fuelLogId}}/", body={"cost": 5000}),
    req("Delete fuel log", "DELETE", "/api/fuel-logs/{{fuelLogId}}/"),
]

# --------------------------------------------------------------------------- #
# 09 · Live
# --------------------------------------------------------------------------- #

live_items = [
    req("Live snapshot", "GET", "/api/live/",
        desc="Everything the map draws on first paint: current vehicle positions, "
             "collector states and today's progress.\n\nAfter this, open the "
             "websocket at `ws://127.0.0.1:8000/ws/live/` for incremental frames. "
             "Postman can connect to it as a WebSocket request — see the "
             "**Realtime** section of the API reference. Clients that cannot use "
             "websockets fall back to polling this endpoint."),
]

# --------------------------------------------------------------------------- #
# 10 · Reports
# --------------------------------------------------------------------------- #

REPORT_NOTE = ("\n\nEvery report is ward-scoped **to the caller**, applied on the "
               "server rather than trusted from a query parameter: a ward "
               "supervisor gets their wards, an agency admin or KCC viewer gets the "
               "city. Add `?format=csv|xlsx|pdf` to download the same rows as a "
               "file — an exported sheet can never disagree with the screen it came "
               "from.")

report_items = [
    req("Dashboard bundle", "GET", "/api/reports/dashboard/",
        query=[q("period", "{{period}}", "YYYY-MM. Defaults to the current month."),
               q("trendDays", "7", "Length of the trend series, 1–90.", enabled=False)],
        desc="Everything the Dashboard renders in one round trip: `kpis`, "
             "`collectionTrend`, `wasteByZone`, `wardCollection`, `complaints` and "
             "`funnel`.\n\nBundled deliberately — the panels are all computed from "
             "the same ward scope at the same instant, so they cannot drift apart."),

    req("KPI scorecard", "GET", "/api/reports/kpis/",
        query=[q("period", "{{period}}", "YYYY-MM.")],
        desc="The six-figure scorecard, every number derived rather than stored."),

    req("Waste collection", "GET", "/api/reports/waste-collection/",
        query=[q("mode", "daily", "`daily` | `weekly` | `monthly` | `yearly`."),
               q("from", "", "YYYY-MM-DD.", enabled=False),
               q("to", "", "YYYY-MM-DD.", enabled=False),
               q("collector", "{{collectorId}}", "", enabled=False),
               q("overall", "true", "Collapse to one row per period.", enabled=False),
               FORMAT_Q],
        desc="Rounds walked per period and collector, with cover work called out." + REPORT_NOTE),

    req("Service series", "GET", "/api/reports/service-series/",
        query=[q("days", "30", "Length of the series, 1–730.", enabled=False),
               q("end", "", "End date, YYYY-MM-DD. Defaults to today.", enabled=False),
               FORMAT_Q],
        desc="Day-by-day scheduled / served / skipped / billed / collected." + REPORT_NOTE),

    req("Ward collection", "GET", "/api/reports/ward-collection/",
        query=[q("period", "{{period}}", "YYYY-MM."), FORMAT_Q],
        desc="Per-ward service and revenue for a month." + REPORT_NOTE),

    req("Bill collection", "GET", "/api/reports/bill-collection/",
        query=[q("mode", "monthly", "`daily` | `weekly` | `monthly` | `yearly`."),
               q("from", "", "Start period.", enabled=False),
               q("to", "", "End period.", enabled=False),
               q("overall", "true", "Collapse to one row per period.", enabled=False),
               FORMAT_Q],
        desc="Money billed against money received, per period and collector." + REPORT_NOTE),

    req("Bill status", "GET", "/api/reports/bill-status/",
        query=[q("period", "{{period}}", "YYYY-MM."), FORMAT_Q],
        desc="Paid / partial / unpaid / overdue counts for a billing month, per "
             "collector." + REPORT_NOTE),

    req("Customer collection", "GET", "/api/reports/customer-collection/",
        query=[q("mode", "monthly", ""),
               q("from", "", "", enabled=False),
               q("to", "", "", enabled=False),
               q("hh", "{{householdId}}", "One household.", enabled=False),
               FORMAT_Q],
        desc="Billed and received per household — the *'who has not paid'* list." + REPORT_NOTE),

    req("Customer bill status", "GET", "/api/reports/customer-bill-status/",
        query=[q("period", "{{period}}", "YYYY-MM."), FORMAT_Q],
        desc="One row per bill, with `state` derived from the payments that exist "
             "and the instalments behind it." + REPORT_NOTE),

    req("Reconciliation", "GET", "/api/reports/reconciliation/",
        query=[q("period", "{{period}}", "YYYY-MM."), FORMAT_Q],
        desc="Service versus revenue, and cash taken versus cash handed in.\n\n**The "
             "exception lists are the point of this report** — an export flattens "
             "the cash rows into the sheet and returns the exceptions alongside in "
             "the JSON body." + REPORT_NOTE),

    req("Waste by zone", "GET", "/api/reports/waste-by-zone/",
        query=[q("period", "{{period}}", "YYYY-MM.", enabled=False)],
        desc="Estimated tonnage per zone.\n\n**Every row carries `estimated: true`** "
             "— nothing weighs the waste. The figure multiplies collected stops by "
             "per-customer-type averages, and is labelled as an estimate wherever "
             "it is shown."),

    req("Complaint summary", "GET", "/api/reports/complaint-summary/",
        query=[q("period", "{{period}}", "YYYY-MM.", enabled=False)]),

    req("Customer funnel", "GET", "/api/reports/customer-funnel/",
        desc="Survey-to-customer conversion, and the monthly revenue still on the "
             "table from unconverted surveys."),
]

# --------------------------------------------------------------------------- #
# 11 · Sweep AI
# --------------------------------------------------------------------------- #

ai_items = [
    req("Ask Sweep AI", "POST", "/api/ai/ask/",
        body={"question": "Which households in my ward have not been collected this week?"},
        desc="Answers an operational question from a live, **ward-scoped** snapshot "
             "of the database.\n\nWith `ANTHROPIC_API_KEY` set it reasons over that "
             "snapshot with the Claude API; without one it falls back to rule-based "
             "answers, so the panel works either way."),

    req("Assistant fact snapshot", "GET", "/api/ai/facts/",
        desc="The exact snapshot the assistant reasons over. Exposed so the UI can "
             "show the same numbers the assistant quotes — and so its answers are "
             "auditable."),
]

# --------------------------------------------------------------------------- #
# Assemble
# --------------------------------------------------------------------------- #

collection = {
    "info": {
        "name": COLLECTION_NAME,
        "_postman_id": "5a9d4c10-7e2b-4f66-9a31-swms0000001",
        "description": (
            "Smart Sweep — Solid Waste Management System for the Khulna City "
            "Corporation pilot.\n\n"
            "Django 5.2 + DRF on PostgreSQL 18. Every endpoint under `/api/`.\n\n"
            "## Getting started\n\n"
            "1. Start the backend: `cd server && .venv\\Scripts\\python.exe manage.py runserver`\n"
            "2. Select the **Smart Sweep — Local** environment.\n"
            "3. Run **00 · Auth → 1 · Request login code**, then **2 · Verify code**. "
            "The test scripts capture the JWT pair, the role and the collector id "
            "into collection variables, so every other request is authorised "
            "automatically.\n"
            "4. Run **01 · Catalog → Catalog bundle** to see the real ids for wards, "
            "tiers and the option lists, then point the `wardId` / `tierId` "
            "variables at them.\n\n"
            "## Conventions\n\n"
            "- **Auth** — collection-level Bearer `{{accessToken}}`. Access tokens "
            "are short-lived; re-run **Refresh access token** when a request "
            "answers 401 with `code: \"token_invalid\"`.\n"
            "- **Errors** — every failure has one shape: "
            "`{\"detail\": \"…\", \"code\": \"stable_key\", \"fields\": {\"road\": [\"…\"]}}`. "
            "`code` is a stable key the UI maps to a translated string.\n"
            "- **Pagination** — list endpoints return "
            "`{count, page, pages, next, previous, results}`. Pass `?page_size=all` "
            "for a bare array (capped at 5000).\n"
            "- **Ward scoping** — applied on the server from the caller's role. It "
            "cannot be widened by a query parameter.\n"
            "- **Ids are text and meaningful** — `HH-KCC-0012840`, `RT-W-14-01`, "
            "`C-042` — because field staff read them off bin stickers.\n\n"
            "Interactive schema: `http://127.0.0.1:8000/api/docs/`"
        ),
        "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
    },
    "auth": {
        "type": "bearer",
        "bearer": [{"key": "token", "value": "{{accessToken}}", "type": "string"}],
    },
    "event": [
        {
            "listen": "prerequest",
            "script": {
                "type": "text/javascript",
                "exec": [
                    "// Keep the date-ish variables current so example bodies stay runnable.",
                    "const now = new Date();",
                    "const pad = (n) => String(n).padStart(2, '0');",
                    "pm.collectionVariables.set('today', `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`);",
                    "pm.collectionVariables.set('period', `${now.getFullYear()}-${pad(now.getMonth() + 1)}`);",
                    "pm.collectionVariables.set('nowIso', now.toISOString());",
                ],
            },
        },
        {
            "listen": "test",
            "script": {
                "type": "text/javascript",
                "exec": [
                    "// Surface the app's error envelope in the Postman console rather",
                    "// than making you open the body every time.",
                    "if (pm.response.code >= 400) {",
                    "  try {",
                    "    const body = pm.response.json();",
                    "    console.error(`${pm.response.code} ${body.code}: ${body.detail}`,",
                    "                  Object.keys(body.fields || {}).length ? body.fields : '');",
                    "  } catch (e) { /* not JSON — a file export or a 500 page */ }",
                    "}",
                ],
            },
        },
    ],
    "variable": [
        {"key": "baseUrl", "value": "http://127.0.0.1:8000", "type": "string"},
        {"key": "accessToken", "value": "", "type": "string"},
        {"key": "refreshToken", "value": "", "type": "string"},
        {"key": "roleKey", "value": "", "type": "string"},
        {"key": "phone", "value": "01900445566", "type": "string"},
        {"key": "otpCode", "value": "", "type": "string"},
        {"key": "pin", "value": "1470", "type": "string"},
        {"key": "zoneId", "value": "Z-03", "type": "string"},
        {"key": "wardId", "value": "W-14", "type": "string"},
        {"key": "tierId", "value": "residential_standard", "type": "string"},
        {"key": "householdId", "value": "HH-KCC-0012840", "type": "string"},
        {"key": "potentialId", "value": "POT-3006", "type": "string"},
        {"key": "collectorId", "value": "C-042", "type": "string"},
        {"key": "routeId", "value": "RT-W-14-01", "type": "string"},
        {"key": "assignmentId", "value": "AS-C-042", "type": "string"},
        {"key": "visitId", "value": "V-000001", "type": "string"},
        {"key": "complaintId", "value": "CMP-20698", "type": "string"},
        {"key": "billId", "value": "B-2026-07-0009050", "type": "string"},
        {"key": "paymentId", "value": "PAY-2026-07-00015", "type": "string"},
        {"key": "depositId", "value": "DEP-2026-07-0002", "type": "string"},
        {"key": "vanId", "value": "VAN-KCC-017", "type": "string"},
        {"key": "qrTag", "value": "SS-05003", "type": "string"},
        {"key": "roadId", "value": "170", "type": "string"},
        {"key": "maintenanceId", "value": "MNT-3341", "type": "string"},
        {"key": "fuelLogId", "value": "FUEL-5521", "type": "string"},
        {"key": "billingRunId", "value": "266", "type": "string"},
        {"key": "period", "value": "2026-07", "type": "string"},
        {"key": "today", "value": "2026-07-29", "type": "string"},
        {"key": "nowIso", "value": "2026-07-29T09:14:02Z", "type": "string"},
    ],
    "item": [
        folder("00 · Auth & session",
               "Mobile-number login by SMS code or 4-digit PIN, JWT rotation, and "
               "the operator's own profile. Run the two numbered OTP requests in "
               "order — their test scripts populate every other request's token.",
               auth_items),
        folder("01 · Catalog & reference data",
               "Zones, wards, roads, tiers and the eight option lists. `GET "
               "/api/catalog/` returns all of it in one call; the CRUD endpoints "
               "exist so an agency admin can maintain the lists.",
               catalog_items),
        folder("02 · Customers",
               "Households under service, and surveyed potential customers — the "
               "'ghost homes' not yet paying. Converting a survey creates the "
               "household and keeps the survey, so the funnel has history.",
               customers_items),
        folder("03 · Collectors",
               "DSP field staff: licensing, attendance, van assignment and "
               "performance.",
               collector_items),
        folder("04 · Routes & assignments",
               "Building the walk, ordering its stops, and deciding who walks it. "
               "Only a household with a verified GPS pin can be put on a route.",
               routes_items),
        folder("05 · Collection round & visits",
               "What a collector's device talks to: the day's round, QR scanning, "
               "recording collections and skips, and flushing the offline queue.",
               round_items),
        folder("06 · Complaints",
               "Ticket lifecycle with SLA timers, an immutable audit trail and "
               "photo evidence. Status is never a plain field write — each move is "
               "its own action endpoint.",
               complaint_items),
        folder("07 · Billing, payments & cash",
               "Monthly billing runs, payments including partials, collector cash "
               "hand-ins and the reconciliation they feed. Recording a payment is "
               "the only way a bill's status changes.",
               billing_items),
        folder("08 · Fleet",
               "Vans, document expiry, workshop jobs, fuel logs and GPS telemetry.",
               fleet_items),
        folder("09 · Live map",
               "The first-paint snapshot behind the live map. Incremental frames "
               "arrive over the websocket at `/ws/live/`.",
               live_items),
        folder("10 · Reports & exports",
               "Service delivery, revenue, bill status and reconciliation. Each "
               "returns JSON, or a CSV/XLSX/PDF file when `?format=` is set.",
               report_items),
        folder("11 · Sweep AI",
               "The floating assistant: answers from a live ward-scoped snapshot of "
               "the database, and the snapshot itself.",
               ai_items),
    ],
}

environment = {
    "id": "b2f7c8d4-3a91-4e05-8c72-swmsenv00001",
    "name": "Smart Sweep — Local",
    "values": [
        {"key": "baseUrl", "value": "http://127.0.0.1:8000", "type": "default", "enabled": True},
        {"key": "phone", "value": "01900445566", "type": "default", "enabled": True},
        {"key": "pin", "value": "1470", "type": "secret", "enabled": True},
        {"key": "accessToken", "value": "", "type": "secret", "enabled": True},
        {"key": "refreshToken", "value": "", "type": "secret", "enabled": True},
    ],
    "_postman_variable_scope": "environment",
}

out_dir = sys.argv[1].rstrip("/\\")
with open(f"{out_dir}/SmartSweep-SWMS.postman_collection.json", "w", encoding="utf-8") as fh:
    json.dump(collection, fh, indent=2, ensure_ascii=False)
with open(f"{out_dir}/SmartSweep-SWMS.postman_environment.json", "w", encoding="utf-8") as fh:
    json.dump(environment, fh, indent=2, ensure_ascii=False)

count = sum(len(f["item"]) for f in collection["item"])
print(f"{len(collection['item'])} folders, {count} requests")
