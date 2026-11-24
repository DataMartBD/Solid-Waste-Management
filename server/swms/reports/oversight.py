"""City Corporation oversight: service growth, complaint performance, registers
and agency targets. No money anywhere in this module — it is what the City
Viewer is shown.

Every function takes the caller's scope (`ward_ids`, `agency_id`) the same way
`aggregates` does: None means unrestricted on that axis.
"""

from __future__ import annotations

import datetime as dt
from collections import defaultdict

from django.db.models import Count, Q
from django.db.models.functions import TruncMonth, TruncYear
from django.utils import timezone

MONTHLY = "monthly"
YEARLY = "yearly"
GROUPS = ("agency", "supervisor", "collector", "ward")


# --------------------------------------------------------------------------- #
# Periods
# --------------------------------------------------------------------------- #


def _month_start(day: dt.date) -> dt.date:
    return day.replace(day=1)


def _add_months(day: dt.date, n: int) -> dt.date:
    index = day.year * 12 + day.month - 1 + n
    return dt.date(index // 12, index % 12 + 1, 1)


def buckets(mode: str, count: int, today: dt.date | None = None):
    """[(label, start, end)] oldest first, ending with the current period."""
    today = today or timezone.localdate()
    out = []
    if mode == YEARLY:
        for i in range(count - 1, -1, -1):
            year = today.year - i
            out.append((str(year), dt.date(year, 1, 1), dt.date(year, 12, 31)))
    else:
        first = _month_start(today)
        for i in range(count - 1, -1, -1):
            start = _add_months(first, -i)
            end = _add_months(start, 1) - dt.timedelta(days=1)
            out.append((start.strftime("%Y-%m"), start, end))
    return out


def month_range(period: str | None):
    """`YYYY-MM` -> (start, end); the current month when not given."""
    if period:
        year, month = (int(x) for x in period.split("-"))
        start = dt.date(year, month, 1)
    else:
        start = _month_start(timezone.localdate())
    return start, _add_months(start, 1) - dt.timedelta(days=1)


def _pct(part, whole) -> float:
    return round(part * 100.0 / whole, 1) if whole else 0.0


def _trend(now: int, before: int | None) -> tuple[int | None, float | None, str]:
    if before is None:
        return None, None, "flat"
    change = now - before
    pct = round(change * 100.0 / before, 1) if before else (100.0 if now else 0.0)
    return change, pct, "up" if change > 0 else "down" if change < 0 else "flat"


# --------------------------------------------------------------------------- #
# Scope helpers
# --------------------------------------------------------------------------- #


def _holdings(ward_ids, agency_id):
    from swms.customers.models import Holding

    qs = Holding.objects.all()
    if ward_ids is not None:
        qs = qs.filter(ward_id__in=ward_ids)
    if agency_id is not None:
        qs = qs.filter(agency_id=agency_id)
    return qs


def _is_registered(row, end: dt.date) -> bool:
    """Active on `end`: created by then, and not made inactive by then."""
    created = timezone.localtime(row["created_at"]).date()
    if created > end:
        return False
    if row["status"] != "active":
        return timezone.localtime(row["updated_at"]).date() > end
    return True


def _supervisors(ward_ids, agency_id):
    """Supervisors in scope, each with the set of wards they look after."""
    from swms.accounts.models import User
    from swms.catalog.models import Ward
    from swms.common.roles import Role

    qs = User.objects.filter(role=Role.SUPERVISOR.value, is_active=True).select_related("agency")
    if agency_id is not None:
        qs = qs.filter(agency_id=agency_id)
    all_wards = None
    out = []
    for user in qs:
        wards = user.visible_ward_ids()
        if wards is None:
            if all_wards is None:
                all_wards = set(Ward.objects.values_list("id", flat=True))
            wards = all_wards
        wards = set(wards)
        if ward_ids is not None:
            wards &= set(ward_ids)
        if wards:
            out.append((user, wards))
    return out


def _collector_wards(ward_ids, agency_id):
    from swms.fieldops.models import Collector

    qs = Collector.objects.filter(active=True).prefetch_related("wards")
    if agency_id is not None:
        qs = qs.filter(agency_id=agency_id)
    out = []
    for c in qs:
        wards = {w.id for w in c.wards.all()} or ({c.ward_id} if c.ward_id else set())
        if ward_ids is not None:
            wards &= set(ward_ids)
        if wards:
            out.append((c, wards))
    return out


def _names(by: str, keys):
    from swms.agencies.models import Agency
    from swms.catalog.models import Ward

    if by == "agency":
        return {a.id: a.name for a in Agency.objects.filter(pk__in=keys)} | {None: "KCC / unassigned"}
    if by == "ward":
        return {w.id: w.name for w in Ward.objects.filter(pk__in=keys)}
    return {}


# --------------------------------------------------------------------------- #
# 2. Service trend
# --------------------------------------------------------------------------- #


def service_trend(*, mode=MONTHLY, count=12, by="agency", ward_ids=None, agency_id=None, today=None):
    """Holdings registered and served per period, per group, with growth.

    Served = at least one collection recorded in the period. A collector's
    holdings are those of their wards (and agency); a supervisor's, those of
    their area.
    """
    from swms.fieldops.models import Visit

    by = by if by in GROUPS else "agency"
    periods = buckets(mode, count, today)
    first, last = periods[0][1], periods[-1][2]

    holdings = list(_holdings(ward_ids, agency_id).values(
        "id", "ward_id", "agency_id", "status", "created_at", "updated_at"))
    trunc = TruncYear if mode == YEARLY else TruncMonth
    visits = (
        Visit.objects.filter(status="collected", at__date__gte=first, at__date__lte=last,
                             holding_id__in=[h["id"] for h in holdings])
        .annotate(p=trunc("at")).values("p", "holding_id", "collector_id").distinct()
    )
    label = (lambda d: str(d.year)) if mode == YEARLY else (lambda d: d.strftime("%Y-%m"))
    served_by_holding = defaultdict(set)        # period -> holdings served
    served_by_collector = defaultdict(set)      # (period, collector) -> holdings
    for v in visits:
        p = label(timezone.localtime(v["p"]) if isinstance(v["p"], dt.datetime) else v["p"])
        served_by_holding[p].add(v["holding_id"])
        if v["collector_id"]:
            served_by_collector[(p, v["collector_id"])].add(v["holding_id"])

    # group key -> (name, predicate over a holding row)
    groups = {}
    if by == "agency":
        keys = {h["agency_id"] for h in holdings}
        names = _names("agency", keys)
        for key in keys:
            groups[key] = (names.get(key, key), lambda h, k=key: h["agency_id"] == k)
    elif by == "ward":
        keys = {h["ward_id"] for h in holdings}
        names = _names("ward", keys)
        for key in keys:
            groups[key] = (names.get(key, key), lambda h, k=key: h["ward_id"] == k)
    elif by == "supervisor":
        for user, wards in _supervisors(ward_ids, agency_id):
            groups[user.id] = (user.name, lambda h, w=wards, a=user.agency_id:
                               h["ward_id"] in w and (a is None or h["agency_id"] == a))
    else:
        for c, wards in _collector_wards(ward_ids, agency_id):
            groups[c.id] = (c.name, lambda h, w=wards, a=c.agency_id:
                            h["ward_id"] in w and (a is None or h["agency_id"] == a))

    rows = []
    for key, (name, member) in groups.items():
        mine = [h for h in holdings if member(h)]
        ids = {h["id"] for h in mine}
        before = None
        for p, start, end in periods:
            registered = sum(1 for h in mine if _is_registered(h, end))
            if by == "collector":
                served = len(served_by_collector.get((p, key), set()))
            else:
                served = len(served_by_holding.get(p, set()) & ids)
            new = sum(1 for h in mine if start <= timezone.localtime(h["created_at"]).date() <= end)
            dropped = sum(
                1 for h in mine if h["status"] != "active"
                and start <= timezone.localtime(h["updated_at"]).date() <= end
            )
            change, change_pct, trend = _trend(served, before)
            rows.append({
                "group": key, "name": name, "period": p,
                "registered": registered, "served": served, "servedPct": _pct(served, registered),
                "new": new, "dropped": dropped,
                "change": change, "changePct": change_pct, "trend": trend,
            })
            before = served
    rows.sort(key=lambda r: (str(r["name"]), r["period"]))
    return rows


# --------------------------------------------------------------------------- #
# 3. Complaints
# --------------------------------------------------------------------------- #


def _complaints(ward_ids, agency_id):
    from swms.complaints.models import Complaint

    qs = Complaint.objects.select_related("holding", "ward", "assigned")
    if ward_ids is not None:
        qs = qs.filter(ward_id__in=ward_ids)
    if agency_id is not None:
        qs = qs.filter(holding__agency_id=agency_id)
    return qs


def _hours(a, b) -> float:
    return max((b - a).total_seconds() / 3600.0, 0.0)


def complaint_performance(*, date_from, date_to, by="agency", ward_ids=None, agency_id=None):
    """Received, resolved, within deadline, time to resolve, per group."""
    from swms.complaints.models import ACTIVE_STATUSES, ActivityAction

    by = by if by in GROUPS + ("type",) else "agency"
    now = timezone.now()
    qs = _complaints(ward_ids, agency_id).filter(
        opened__date__gte=date_from, opened__date__lte=date_to)
    reopened = set(
        qs.filter(activity__action=ActivityAction.REOPENED).values_list("id", flat=True))
    complaints = list(qs)

    def key_of(c):
        if by == "agency":
            return [c.holding.agency_id if c.holding_id else None]
        if by == "ward":
            return [c.ward_id]
        if by == "collector":
            return [c.assigned_id]
        if by == "type":
            return [c.type]
        return [u.id for u, wards in sups if c.ward_id in wards
                and (u.agency_id is None or (c.holding_id and c.holding.agency_id == u.agency_id))]

    sups = _supervisors(ward_ids, agency_id) if by == "supervisor" else []
    names = {u.id: u.name for u, _ in sups}
    if by in ("agency", "ward"):
        names = _names(by, {k for c in complaints for k in key_of(c)})
    elif by == "collector":
        names = {c.assigned_id: c.assigned.name for c in complaints if c.assigned_id}
        names[None] = "Unassigned"

    # Holdings per group, for complaints per 100 holdings.
    base = defaultdict(int)
    if by in ("agency", "ward"):
        field = "agency_id" if by == "agency" else "ward_id"
        for row in _holdings(ward_ids, agency_id).filter(status="active").values(field).annotate(n=Count("id")):
            base[row[field]] = row["n"]

    acc = defaultdict(lambda: {"received": 0, "resolved": 0, "withinSla": 0, "hours": 0.0,
                               "reopened": 0, "openNow": 0, "overdueNow": 0})
    for c in complaints:
        done = c.resolved_at or c.closed_at
        for key in key_of(c):
            a = acc[key]
            a["received"] += 1
            if c.id in reopened:
                a["reopened"] += 1
            if done:
                a["resolved"] += 1
                took = _hours(c.opened, done)
                a["hours"] += took
                if took <= (c.sla or 0):
                    a["withinSla"] += 1
            if c.status in ACTIVE_STATUSES:
                a["openNow"] += 1
                if _hours(c.opened, now) > (c.sla or 0):
                    a["overdueNow"] += 1

    rows = []
    for key, a in acc.items():
        label = names.get(key, key) if by != "type" else key
        rows.append({
            "group": key, "name": label or "—",
            "received": a["received"], "resolved": a["resolved"],
            "withinSla": a["withinSla"], "slaPct": _pct(a["withinSla"], a["resolved"]),
            "avgResolveH": round(a["hours"] / a["resolved"], 1) if a["resolved"] else None,
            "reopened": a["reopened"], "openNow": a["openNow"], "overdueNow": a["overdueNow"],
            "per100": round(a["received"] * 100.0 / base[key], 1) if base.get(key) else None,
        })
    rows.sort(key=lambda r: -r["received"])
    return rows


def complaint_nature(*, date_from, date_to, ward_ids=None, agency_id=None):
    """Complaints by type, against the same length of time just before."""
    span = (date_to - date_from).days + 1
    prev_to = date_from - dt.timedelta(days=1)
    prev_from = prev_to - dt.timedelta(days=span - 1)
    qs = _complaints(ward_ids, agency_id)

    def counts(a, b):
        return {r["type"]: r["n"] for r in qs.filter(opened__date__gte=a, opened__date__lte=b)
                .values("type").annotate(n=Count("id"))}

    now, before = counts(date_from, date_to), counts(prev_from, prev_to)
    total = sum(now.values())
    rows = []
    for kind in sorted(set(now) | set(before)):
        change, change_pct, trend = _trend(now.get(kind, 0), before.get(kind, 0))
        rows.append({"type": kind, "count": now.get(kind, 0), "previous": before.get(kind, 0),
                     "change": change, "changePct": change_pct, "trend": trend,
                     "share": _pct(now.get(kind, 0), total)})
    rows.sort(key=lambda r: -r["count"])
    return rows


def overdue_complaints(*, ward_ids=None, agency_id=None):
    """Every open complaint past its deadline, most overdue first."""
    from swms.complaints.models import ACTIVE_STATUSES

    now = timezone.now()
    rows = []
    for c in _complaints(ward_ids, agency_id).filter(status__in=ACTIVE_STATUSES).select_related("holding__agency"):
        elapsed = _hours(c.opened, now)
        if elapsed <= (c.sla or 0):
            continue
        rows.append({
            "id": c.id, "type": c.type, "priority": c.priority, "status": c.status,
            "ward": c.ward_id, "wardName": c.ward.name if c.ward_id else "",
            "agency": c.holding.agency.name if c.holding_id and c.holding.agency_id else "",
            "assigned": c.assigned.name if c.assigned_id else "",
            "opened": c.opened, "slaH": c.sla, "overdueH": round(elapsed - (c.sla or 0), 1),
        })
    rows.sort(key=lambda r: -r["overdueH"])
    return rows


# --------------------------------------------------------------------------- #
# 4. Registers
# --------------------------------------------------------------------------- #


def _city_ids(ward_ids):
    from swms.catalog.models import Ward

    return set(Ward.objects.filter(id__in=ward_ids).values_list("zone__city_id", flat=True))


def _ward_geo():
    """ward id -> (district, city name)."""
    from swms.catalog.models import Ward

    return {w.id: ((w.zone.city.district if w.zone.city_id else ""), (w.zone.city.name if w.zone.city_id else ""))
            for w in Ward.objects.select_related("zone__city")}


def register_agencies(*, ward_ids=None, agency_id=None):
    from swms.agencies.models import Agency
    from swms.customers.models import Holding

    qs = Agency.objects.prefetch_related("cities").select_related("city", "agency_type")
    if agency_id is not None:
        qs = qs.filter(pk=agency_id)
    if ward_ids is not None:
        cities = _city_ids(ward_ids)
        qs = qs.filter(Q(cities__in=cities) | Q(city_id__in=cities)).distinct()
    rows = []
    for a in qs.order_by("name"):
        cities = list(a.cities.all()) or ([a.city] if a.city_id else [])
        rows.append({
            "id": a.id, "name": a.name, "type": a.agency_type.label if a.agency_type_id else "",
            "district": next((c.district for c in cities if c.district), ""),
            "cities": ", ".join(c.name for c in cities),
            "contractStart": a.contract_start, "contractEnd": a.contract_end, "status": a.status,
            "collectors": a.collectors.filter(active=True).count(),
            "vans": a.vans.count() if hasattr(a, "vans") else 0,
            "holdings": Holding.objects.filter(agency=a, status="active").count(),
            "target": a.target_holdings,
        })
    return rows


def register_collectors(*, ward_ids=None, agency_id=None):
    from swms.fieldops.models import Collector

    qs = Collector.objects.filter(active=True).select_related("agency", "ward").prefetch_related("wards", "vans")
    if ward_ids is not None:
        qs = qs.filter(Q(ward_id__in=ward_ids) | Q(wards__in=ward_ids)).distinct()
    if agency_id is not None:
        qs = qs.filter(agency_id=agency_id)
    geo = _ward_geo()
    rows = []
    for c in qs.order_by("name"):
        wards = [w for w in c.wards.all()] or ([c.ward] if c.ward_id else [])
        district, city = geo.get(wards[0].id, ("", "")) if wards else ("", "")
        van = next(iter(c.vans.all()), None)
        rows.append({
            "id": c.id, "name": c.name, "dspId": c.dsp_id, "phone": c.phone,
            "agency": c.agency.name if c.agency_id else "", "district": district, "city": city,
            "wards": ", ".join(w.name for w in wards), "van": van.id if van else "",
            "license": c.license, "licenseExp": c.license_exp, "attendance": c.attendance,
            "coverage": c.coverage, "onTime": c.on_time,
        })
    return rows


def register_supervisors(*, ward_ids=None, agency_id=None):
    from swms.complaints.models import ACTIVE_STATUSES

    collectors = _collector_wards(ward_ids, agency_id)
    open_by_ward = defaultdict(int)
    for row in _complaints(ward_ids, agency_id).filter(status__in=ACTIVE_STATUSES).values("ward_id"):
        open_by_ward[row["ward_id"]] += 1
    rows = []
    for user, wards in _supervisors(ward_ids, agency_id):
        mine = [c for c, cw in collectors if cw & wards and (user.agency_id is None or c.agency_id == user.agency_id)]
        rows.append({
            "id": user.id, "name": user.name, "phone": user.phone,
            "agency": user.agency.name if user.agency_id else "",
            "area": user.scope_kind, "wards": len(wards), "collectors": len(mine),
            "openComplaints": sum(open_by_ward[w] for w in wards),
        })
    rows.sort(key=lambda r: r["name"])
    return rows


def _vans(ward_ids, agency_id):
    from swms.fleet.models import Van

    qs = Van.objects.select_related("agency", "driver")
    if agency_id is not None:
        qs = qs.filter(agency_id=agency_id)
    if ward_ids is not None:
        qs = qs.filter(Q(ward_id__in=ward_ids) | Q(driver__ward_id__in=ward_ids)
                       | Q(driver__wards__in=ward_ids)).distinct()
    return qs


def register_vans(*, ward_ids=None, agency_id=None, within_days=60):
    rows = []
    for v in _vans(ward_ids, agency_id).order_by("id"):
        d = v.driver
        docs = v.expiring_documents(within_days=within_days)
        rows.append({
            "id": v.id, "plate": v.plate, "type": v.type, "capacity": v.capacity, "status": v.status,
            "agency": v.agency.name if v.agency_id else "",
            "driver": d.name if d else "", "driverPhone": d.phone if d else "",
            "driverLicense": d.license if d else "", "driverLicenseExp": d.license_exp if d else None,
            "documentsDue": ", ".join(f"{x['document']} {x['expires']}" for x in docs),
        })
    return rows


def register_documents(*, ward_ids=None, agency_id=None, within_days=60, today=None):
    """Van papers and driving licences lapsed or due within `within_days`."""
    today = today or timezone.localdate()
    rows = []
    for v in _vans(ward_ids, agency_id):
        for x in v.expiring_documents(within_days=within_days, today=today):
            rows.append({"kind": "van", "subject": f"{v.id} ({v.plate})",
                         "agency": v.agency.name if v.agency_id else "",
                         "document": x["document"], "expires": x["expires"], "days": x["days"]})
    for c in register_collectors(ward_ids=ward_ids, agency_id=agency_id):
        exp = c["licenseExp"]
        if exp and (exp - today).days <= within_days:
            rows.append({"kind": "collector", "subject": f"{c['name']} ({c['dspId']})",
                         "agency": c["agency"], "document": "driving_licence",
                         "expires": exp, "days": (exp - today).days})
    rows.sort(key=lambda r: r["days"])
    return rows


# --------------------------------------------------------------------------- #
# 5. Targets
# --------------------------------------------------------------------------- #


def agency_targets(*, period=None, ward_ids=None, agency_id=None):
    """Each agency's contract target against holdings served in the month."""
    start, end = month_range(period)
    label = start.strftime("%Y-%m")
    trend = {r["group"]: r for r in service_trend(
        mode=MONTHLY, count=1, by="agency", ward_ids=ward_ids, agency_id=agency_id, today=end)
        if r["period"] == label}
    rows = []
    for a in register_agencies(ward_ids=ward_ids, agency_id=agency_id):
        t = trend.get(a["id"], {})
        served = t.get("served", 0)
        target = a["target"]
        rows.append({
            "agency": a["id"], "name": a["name"], "target": target,
            "registered": t.get("registered", 0), "served": served,
            "achievement": _pct(served, target) if target else None,
            "new": t.get("new", 0), "dropped": t.get("dropped", 0),
            "status": None if not target else (
                "good" if served >= target * 0.9 else "fair" if served >= target * 0.75 else "poor"),
        })
    return {"period": label, "rows": rows}


# --------------------------------------------------------------------------- #
# 6. Summary
# --------------------------------------------------------------------------- #


def oversight_summary(*, ward_ids=None, agency_id=None, today=None):
    """The City Corporation dashboard in one call."""
    from swms.fieldops.models import Collector
    from swms.fleet.models import Van

    today = today or timezone.localdate()
    by_agency = service_trend(mode=MONTHLY, count=2, by="agency", ward_ids=ward_ids,
                              agency_id=agency_id, today=today)
    this = today.strftime("%Y-%m")
    current = [r for r in by_agency if r["period"] == this]
    previous = [r for r in by_agency if r["period"] != this]
    served = sum(r["served"] for r in current)
    served_before = sum(r["served"] for r in previous)
    registered = sum(r["registered"] for r in current)
    change, change_pct, trend = _trend(served, served_before)

    start, end = month_range(this)
    perf = complaint_performance(date_from=start, date_to=end, by="agency",
                                 ward_ids=ward_ids, agency_id=agency_id)
    targets = agency_targets(period=this, ward_ids=ward_ids, agency_id=agency_id)["rows"]
    with_target = [t for t in targets if t["target"]]
    overdue = overdue_complaints(ward_ids=ward_ids, agency_id=agency_id)
    resolved = sum(r["resolved"] for r in perf)
    within = sum(r["withinSla"] for r in perf)

    collectors = Collector.objects.filter(active=True)
    if ward_ids is not None:
        collectors = collectors.filter(Q(ward_id__in=ward_ids) | Q(wards__in=ward_ids)).distinct()
    if agency_id is not None:
        collectors = collectors.filter(agency_id=agency_id)
    vans = _vans(ward_ids, agency_id)

    perf_by = {r["group"]: r for r in perf}
    league = []
    for r in current:
        p = perf_by.get(r["group"], {})
        league.append({
            "agency": r["group"], "name": r["name"], "registered": r["registered"],
            "served": r["served"], "servedPct": r["servedPct"], "trend": r["trend"],
            "complaints": p.get("received", 0), "slaPct": p.get("slaPct"), "per100": p.get("per100"),
        })
    league.sort(key=lambda r: (-r["servedPct"], -(r["slaPct"] or 0)))
    return {
        "period": this,
        "served": served, "servedBefore": served_before, "registered": registered,
        "servedPct": _pct(served, registered), "change": change, "changePct": change_pct, "trend": trend,
        "target": sum(t["target"] for t in with_target),
        "targetServed": sum(t["served"] for t in with_target),
        "targetPct": _pct(sum(t["served"] for t in with_target), sum(t["target"] for t in with_target)),
        "complaintsOpen": sum(r["openNow"] for r in perf) + 0,
        "complaintsOverdue": len(overdue),
        "slaPct": _pct(within, resolved),
        "collectorsActive": collectors.count(),
        "collectorsCheckedIn": collectors.filter(attendance="checked_in").count(),
        "vansTotal": vans.count(), "vansActive": vans.filter(status="active").count(),
        "league": league,
    }


def merge_collection(summary: dict, by_agency: list[dict]) -> None:
    """Fold 30 days of pickup (collected %, missed) into the league, one row per agency.

    An agency with pickups but no holdings served this month still gets a row.
    """
    rows = {r["agency"]: r for r in summary["league"]}
    for c in by_agency:
        row = rows.get(c["agency"])
        if row is None:
            if c["agency"] is None:
                continue
            row = {"agency": c["agency"], "name": c["agencyName"], "registered": 0, "served": 0,
                   "servedPct": 0, "trend": "flat", "complaints": 0, "slaPct": None, "per100": None}
            summary["league"].append(row)
            rows[c["agency"]] = row
        row["due30"] = c["due"]
        row["collectedPct"] = c["collectedPct"]
        row["missed"] = c["missed"]
    for row in summary["league"]:
        row.setdefault("due30", 0)
        row.setdefault("collectedPct", None)
        row.setdefault("missed", 0)


# --------------------------------------------------------------------------- #
# 7. Agency reporting: the collector scorecard and "what the City sees"
# --------------------------------------------------------------------------- #

#: How the scorecard's single score is weighed. Shown on the page, so a
#: collector can be told exactly why they rank where they do.
SCORE_WEIGHTS = {"coverage": 40, "collection": 30, "onTime": 20, "complaints": 10}


def collector_scorecard(*, period=None, ward_ids=None, agency_id=None):
    """One row per active collector for a month: service, money, complaints, rank.

    - holdings: active holdings in the collector's wards (their agency's, if any)
    - served / coverage: distinct holdings they collected from in the month
    - skipped: their visits marked skipped
    - complaints: complaints opened in the month on those holdings' wards, per 100 holdings
    - billed / received: the month's bills on those holdings; the money they took
    - onTime: the rolling on-time % kept on the collector
    """
    from swms.billing.models import Bill, Payment
    from swms.complaints.models import Complaint
    from swms.fieldops.models import Visit, VisitStatus

    start, end = month_range(period)
    label = start.strftime("%Y-%m")
    holdings = _holdings(ward_ids, agency_id).filter(status="active")
    by_ward = defaultdict(list)
    for h in holdings.values("id", "ward_id", "agency_id"):
        by_ward[h["ward_id"]].append(h)

    visits = Visit.objects.filter(served_on__range=(start, end))
    served = defaultdict(set)
    skipped = defaultdict(int)
    for v in visits.values("collector_id", "holding_id", "status"):
        if v["status"] == VisitStatus.COLLECTED:
            served[v["collector_id"]].add(v["holding_id"])
        elif v["status"] == VisitStatus.SKIPPED:
            skipped[v["collector_id"]] += 1

    complaints = defaultdict(int)
    for c in Complaint.objects.filter(opened__date__range=(start, end)).values("ward_id", "holding__agency_id"):
        complaints[(c["ward_id"], c["holding__agency_id"])] += 1

    billed = defaultdict(int)
    for b in Bill.objects.filter(period=label).values("holding_id", "amount"):
        billed[b["holding_id"]] += b["amount"]
    received = defaultdict(int)
    for p in Payment.objects.filter(at__date__range=(start, end), collector__isnull=False).values("collector_id", "amount"):
        received[p["collector_id"]] += p["amount"]

    rows = []
    for c, wards in _collector_wards(ward_ids, agency_id):
        mine = [h for w in wards for h in by_ward.get(w, [])
                if c.agency_id is None or h["agency_id"] == c.agency_id]
        ids = {h["id"] for h in mine}
        got = len(served[c.id] & ids) if ids else len(served[c.id])
        n_complaints = sum(n for (w, a), n in complaints.items()
                           if w in wards and (c.agency_id is None or a == c.agency_id))
        bill_total = sum(billed[i] for i in ids)
        coverage = _pct(got, len(ids))
        collection = _pct(received[c.id], bill_total)
        per100 = round(n_complaints * 100 / len(ids), 1) if ids else None
        complaint_score = max(0.0, 100 - (per100 or 0) * 10)
        score = round((SCORE_WEIGHTS["coverage"] * coverage
                       + SCORE_WEIGHTS["collection"] * min(collection, 100)
                       + SCORE_WEIGHTS["onTime"] * (c.on_time or 0)
                       + SCORE_WEIGHTS["complaints"] * complaint_score) / 100, 1)
        rows.append({
            "id": c.id, "name": c.name, "dspId": c.dsp_id,
            "agency": c.agency.name if c.agency_id else "",
            "wards": len(wards), "holdings": len(ids), "served": got, "coverage": coverage,
            "skipped": skipped[c.id], "complaints": n_complaints, "per100": per100,
            "billed": bill_total, "received": received[c.id], "collectionPct": collection,
            "onTime": c.on_time or 0, "attendance": c.attendance, "score": score,
        })
    rows.sort(key=lambda r: (-r["score"], r["name"]))
    for i, r in enumerate(rows, 1):
        r["rank"] = i
    return {"period": label, "rows": rows, "weights": SCORE_WEIGHTS}


def agency_contract(*, ward_ids=None, agency_id=None, today=None):
    """What the City sees about one agency, and its place among the agencies in its area.

    Only the agency's own row is returned; the others are counted, not shown.
    """
    data = oversight_summary(ward_ids=ward_ids, agency_id=agency_id, today=today)
    if agency_id is None:
        data["rank"], data["of"] = None, len(data["league"])
        return data
    everyone = oversight_summary(ward_ids=ward_ids, agency_id=None, today=today)["league"]
    everyone = [r for r in everyone if r["agency"]]
    order = [r["agency"] for r in everyone]
    data["rank"] = order.index(agency_id) + 1 if agency_id in order else None
    data["of"] = len(order)
    return data
