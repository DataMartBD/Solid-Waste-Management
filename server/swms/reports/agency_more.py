"""Agency Reports — survey progress, repeat complaints, route completion, billing runs.

Each takes the caller's scope (`ward_ids`, `agency_id`) like the other reports.
"""

from __future__ import annotations

import datetime as dt
from collections import Counter, defaultdict

from django.db.models import Sum
from django.utils import timezone


def _pct(part, whole) -> float:
    return round(part * 100 / whole, 1) if whole else 0.0


# --------------------------------------------------------------------------- #
# Door-to-door survey progress
# --------------------------------------------------------------------------- #

SURVEY_STATES = ("draft", "submitted", "reviewed", "converted", "rejected")


def survey_progress(*, date_from, date_to, by="surveyor", ward_ids=None, agency_id=None) -> dict:
    """Surveys done per surveyor, or survey coverage per ward.

    Per ward, "surveyed" counts holdings that have ever had a survey (about them,
    or converted into them), against the ward's active holdings.
    """
    from swms.catalog.models import Ward
    from swms.customers.models import Holding, HoldingStatus
    from swms.surveys.models import Survey

    surveys = Survey.objects.all()
    if ward_ids is not None:
        surveys = surveys.filter(ward_id__in=ward_ids)
    if agency_id is not None:
        surveys = surveys.filter(agency_id=agency_id)
    in_range = surveys.filter(surveyed_on__range=(date_from, date_to))

    if by == "ward":
        holdings = Holding.objects.filter(status=HoldingStatus.ACTIVE)
        if ward_ids is not None:
            holdings = holdings.filter(ward_id__in=ward_ids)
        if agency_id is not None:
            holdings = holdings.filter(agency_id=agency_id)
        by_ward = defaultdict(set)
        for hid, ward_id in holdings.values_list("id", "ward_id"):
            by_ward[ward_id].add(hid)
        active = Counter({w: len(ids) for w, ids in by_ward.items()})
        ever = defaultdict(set)
        for ward_id, about, became in surveys.values_list("ward_id", "holding_id", "converted_to_id"):
            for h in (about, became):
                if h:
                    ever[ward_id].add(h)
        done = Counter(in_range.values_list("ward_id", flat=True))
        converted = Counter(in_range.filter(status="converted").values_list("ward_id", flat=True))
        names = dict(Ward.objects.filter(id__in=set(active) | set(done)).values_list("id", "name"))
        rows = []
        for ward_id in sorted(set(active) | set(done), key=lambda w: names.get(w, w or "")):
            if not ward_id:
                continue
            surveyed = len(ever[ward_id] & by_ward[ward_id])
            rows.append({
                "ward": ward_id, "wardName": names.get(ward_id, ward_id), "holdings": active[ward_id],
                "surveyed": surveyed, "coverage": _pct(surveyed, active[ward_id]),
                "notSurveyed": max(active[ward_id] - surveyed, 0),
                "surveys": done[ward_id], "converted": converted[ward_id],
            })
        rows.sort(key=lambda r: (r["coverage"], r["wardName"]))
        total_h = sum(r["holdings"] for r in rows)
        total_s = sum(r["surveyed"] for r in rows)
        return {"by": by, "rows": rows, "totals": {
            "holdings": total_h, "surveyed": total_s, "coverage": _pct(total_s, total_h),
            "surveys": sum(r["surveys"] for r in rows), "converted": sum(r["converted"] for r in rows)}}

    groups: dict[str, dict] = {}
    for s in in_range.values("surveyor_id", "surveyor__name", "surveyor_name", "status", "surveyed_on"):
        key = s["surveyor_id"] or f"name:{s['surveyor_name'] or ''}"
        name = s["surveyor__name"] or s["surveyor_name"] or ""
        row = groups.setdefault(key, {"surveyor": s["surveyor_id"], "name": name, "surveys": 0,
                                      "days": set(), "last": s["surveyed_on"], **dict.fromkeys(SURVEY_STATES, 0)})
        row["surveys"] += 1
        row["days"].add(s["surveyed_on"])
        if s["status"] in SURVEY_STATES:
            row[s["status"]] += 1
        row["last"] = max(row["last"], s["surveyed_on"])
    rows = []
    for row in groups.values():
        days = len(row.pop("days"))
        rows.append({**row, "daysWorked": days, "perDay": round(row["surveys"] / days, 1) if days else 0,
                     "last": row["last"].isoformat(),
                     "conversion": _pct(row["converted"], row["surveys"] - row["draft"])})
    rows.sort(key=lambda r: (-r["surveys"], r["name"]))
    totals = {k: sum(r[k] for r in rows) for k in ("surveys", *SURVEY_STATES)}
    return {"by": by, "rows": rows, "totals": totals}


# --------------------------------------------------------------------------- #
# Holdings that keep complaining
# --------------------------------------------------------------------------- #

def repeat_complaints(*, date_from, date_to, minimum=2, ward_ids=None, agency_id=None) -> dict:
    """Holdings with `minimum` or more complaints opened in the range."""
    from swms.complaints.models import Complaint

    qs = Complaint.objects.filter(opened__date__range=(date_from, date_to), holding__isnull=False)
    if ward_ids is not None:
        qs = qs.filter(ward_id__in=ward_ids)
    if agency_id is not None:
        qs = qs.filter(holding__agency_id=agency_id)
    found: dict[str, dict] = {}
    for c in qs.order_by("opened").values(
            "holding_id", "holding__holding_no", "holding__owner_name", "holding__owner_phone",
            "holding__road__name", "ward__name", "type", "status", "opened", "assigned__name"):
        row = found.setdefault(c["holding_id"], {
            "holding": c["holding_id"], "holdingNo": c["holding__holding_no"],
            "owner": c["holding__owner_name"], "phone": c["holding__owner_phone"],
            "road": c["holding__road__name"], "wardName": c["ward__name"],
            "complaints": 0, "open": 0, "types": Counter(), "first": c["opened"], "last": c["opened"],
            "assigned": "",
        })
        row["complaints"] += 1
        row["types"][c["type"]] += 1
        if c["status"] not in ("resolved", "closed"):
            row["open"] += 1
        row["last"] = c["opened"]
        row["assigned"] = c["assigned__name"] or row["assigned"]
    rows = []
    for row in found.values():
        if row["complaints"] < minimum:
            continue
        types = row.pop("types")
        row.update({
            "typeCounts": dict(types.most_common()),
            "mainType": types.most_common(1)[0][0],
            "first": timezone.localtime(row["first"]).date().isoformat(),
            "last": timezone.localtime(row["last"]).date().isoformat(),
        })
        rows.append(row)
    rows.sort(key=lambda r: (-r["complaints"], -r["open"], r["holdingNo"] or ""))
    by_type = Counter()
    for r in rows:
        by_type.update(r["typeCounts"])
    return {"rows": rows, "holdings": len(rows), "complaints": sum(r["complaints"] for r in rows),
            "open": sum(r["open"] for r in rows), "byType": dict(by_type.most_common()), "minimum": minimum}


# --------------------------------------------------------------------------- #
# Route completion
# --------------------------------------------------------------------------- #

def route_completion(*, date_from, date_to, by="day", ward_ids=None, agency_id=None) -> dict:
    """Per route and day: stops, served, not served, first and last scan, on time.

    "On time" means the last scanned stop was recorded by the end of the route's
    collection window. Days with no visit at all are listed as not started.
    """
    from swms.customers.models import HoldingStatus
    from swms.fieldops.models import Route, RouteStop, Visit, VisitSource, VisitStatus

    from .agency_ops import _collector_names, _route_collectors

    routes = Route.objects.filter(active=True)
    if ward_ids is not None:
        routes = routes.filter(ward_id__in=ward_ids)
    if agency_id is not None:
        routes = routes.filter(agency_id=agency_id)
    routes = {r.id: r for r in routes.select_related("ward")}
    stops = Counter(RouteStop.objects.filter(route_id__in=routes.keys(), holding__status=HoldingStatus.ACTIVE)
                    .values_list("route_id", flat=True))
    owners = _route_collectors()
    names = _collector_names(set(owners.get(r) for r in routes))

    cells = defaultdict(lambda: {"served": 0, "auto": 0, "notServed": 0, "first": None, "last": None})
    for v in Visit.objects.filter(served_on__range=(date_from, date_to),
                                  holding__route_stop__route_id__in=routes.keys()).values(
            "holding__route_stop__route_id", "served_on", "status", "source", "at"):
        cell = cells[(v["holding__route_stop__route_id"], v["served_on"])]
        if v["status"] == VisitStatus.COLLECTED:
            cell["auto" if v["source"] == VisitSource.AUTO else "served"] += 1
        else:
            cell["notServed"] += 1
        if v["source"] != VisitSource.AUTO:
            t = timezone.localtime(v["at"]).time()
            cell["first"] = t if cell["first"] is None or t < cell["first"] else cell["first"]
            cell["last"] = t if cell["last"] is None or t > cell["last"] else cell["last"]

    today = timezone.localdate()
    day_rows = []
    day = date_from
    while day <= min(date_to, today):
        for rid, route in routes.items():
            planned = stops.get(rid, 0)
            if not planned:
                continue
            c = cells.get((rid, day)) or {"served": 0, "auto": 0, "notServed": 0, "first": None, "last": None}
            on_time = None if c["last"] is None else c["last"] <= route.window_end
            owner = owners.get(rid)
            day_rows.append({
                "day": day.isoformat(), "route": rid, "routeName": route.name, "wardName": route.ward.name,
                "collector": owner, "collectorName": names.get(owner, {}).get("name", ""),
                "stops": planned, "served": c["served"], "auto": c["auto"], "notServed": c["notServed"],
                "completion": _pct(c["served"], planned),
                "first": c["first"].strftime("%H:%M") if c["first"] else None,
                "last": c["last"].strftime("%H:%M") if c["last"] else None,
                "windowEnd": route.window_end.strftime("%H:%M"), "onTime": on_time,
                "started": c["first"] is not None,
            })
        day += dt.timedelta(days=1)

    if by == "route":
        grouped: dict[str, dict] = {}
        for r in day_rows:
            g = grouped.setdefault(r["route"], {
                "route": r["route"], "routeName": r["routeName"], "wardName": r["wardName"],
                "collectorName": r["collectorName"], "stops": r["stops"], "days": 0, "started": 0,
                "onTime": 0, "served": 0, "planned": 0})
            g["days"] += 1
            g["started"] += r["started"]
            g["onTime"] += bool(r["onTime"])
            g["served"] += r["served"]
            g["planned"] += r["stops"]
        rows = []
        for g in grouped.values():
            g["completion"] = _pct(g.pop("served"), g.pop("planned"))
            g["onTimePct"] = _pct(g["onTime"], g["started"])
            g["notStarted"] = g["days"] - g["started"]
            rows.append(g)
        rows.sort(key=lambda r: (r["completion"], r["routeName"]))
    else:
        rows = sorted(day_rows, key=lambda r: (r["day"], r["routeName"]))
        rows.sort(key=lambda r: r["day"], reverse=True)

    started = [r for r in day_rows if r["started"]]
    return {"by": by, "rows": rows, "totals": {
        "routeDays": len(day_rows), "started": len(started),
        "onTime": sum(1 for r in started if r["onTime"]),
        "onTimePct": _pct(sum(1 for r in started if r["onTime"]), len(started)),
        "completion": _pct(sum(r["served"] for r in day_rows), sum(r["stops"] for r in day_rows)),
    }, "from": date_from.isoformat(), "to": date_to.isoformat()}


# --------------------------------------------------------------------------- #
# Billing runs
# --------------------------------------------------------------------------- #

def billing_runs(*, months=12, period=None, ward_ids=None, agency_id=None) -> dict:
    """Bills issued per month and how they were paid; or one month by ward."""
    from swms.billing.models import Bill

    bills = Bill.objects.all()
    if ward_ids is not None:
        bills = bills.filter(ward_id__in=ward_ids)
    if agency_id is not None:
        bills = bills.filter(holding__agency_id=agency_id)
    if period:
        bills = bills.filter(period=period)
        key = "ward_id"
    else:
        periods = list(bills.values_list("period", flat=True).distinct().order_by("-period")[:months])
        bills = bills.filter(period__in=periods)
        key = "period"

    groups: dict[str, dict] = {}
    for b in bills.annotate(paid=Sum("payments__amount")).values(key, "ward__name", "amount", "paid", "status"):
        k = b[key]
        row = groups.setdefault(k, {key.replace("_id", ""): k, "bills": 0, "amount": 0, "collected": 0,
                                    "paid": 0, "partial": 0, "unpaid": 0,
                                    **({"wardName": b["ward__name"]} if period else {})})
        paid = min(b["paid"] or 0, b["amount"])
        row["bills"] += 1
        row["amount"] += b["amount"]
        row["collected"] += paid
        if paid >= b["amount"]:
            row["paid"] += 1
        elif paid:
            row["partial"] += 1
        else:
            row["unpaid"] += 1
    rows = []
    for row in groups.values():
        row["outstanding"] = row["amount"] - row["collected"]
        row["collectionPct"] = _pct(row["collected"], row["amount"])
        rows.append(row)
    if period:
        rows.sort(key=lambda r: (r["collectionPct"], r.get("wardName") or ""))
    else:
        rows.sort(key=lambda r: r["period"], reverse=True)
    totals = {k: sum(r[k] for r in rows) for k in ("bills", "amount", "collected", "outstanding", "paid", "partial", "unpaid")}
    totals["collectionPct"] = _pct(totals["collected"], totals["amount"])
    return {"rows": rows, "totals": totals, "period": period}
