"""Agency Reports — fleet costs: fuel per van per month, and maintenance history.

Both take the caller's scope (`ward_ids`, `agency_id`) like the other reports,
through the same van scope the registers use (`oversight._vans`).
"""

from __future__ import annotations

import datetime as dt
from collections import defaultdict

from django.utils import timezone

from .oversight import _add_months, _vans, month_range

#: A van burning this much worse than its usual km/l is flagged for a check.
KMPL_DROP_PCT = 15


def _bounds(start: dt.date, end: dt.date):
    tz = timezone.get_current_timezone()
    return (timezone.make_aware(dt.datetime.combine(start, dt.time()), tz),
            timezone.make_aware(dt.datetime.combine(end + dt.timedelta(days=1), dt.time()), tz))


def fuel_report(*, period=None, ward_ids=None, agency_id=None) -> dict:
    """Per van for one month: fills, litres, cost, km, km/l, cost per km and per holding served.

    Distance is taken from each fill's km/l (worked out from the fill before it),
    so the first fill a van ever had adds litres and cost but no distance.
    """
    from swms.fieldops.models import Visit, VisitStatus
    from swms.fleet.models import FuelLog

    start, end = month_range(period)
    label = start.strftime("%Y-%m")
    prev_start = _add_months(start, -1)
    vans = list(_vans(ward_ids, agency_id))
    ids = [v.id for v in vans]

    lo, hi = _bounds(start, end)
    this = defaultdict(lambda: {"fills": 0, "litres": 0.0, "cost": 0, "km": 0.0, "kmLitres": 0.0})
    for f in FuelLog.objects.filter(van_id__in=ids, at__gte=lo, at__lt=hi).values("van_id", "litres", "cost", "kmpl"):
        row = this[f["van_id"]]
        litres = float(f["litres"])
        row["fills"] += 1
        row["litres"] += litres
        row["cost"] += f["cost"]
        if f["kmpl"]:
            row["km"] += float(f["kmpl"]) * litres
            row["kmLitres"] += litres

    plo, phi = _bounds(prev_start, start - dt.timedelta(days=1))
    before = defaultdict(int)
    for f in FuelLog.objects.filter(van_id__in=ids, at__gte=plo, at__lt=phi).values("van_id", "cost"):
        before[f["van_id"]] += f["cost"]

    served = defaultdict(set)
    for v in Visit.objects.filter(van_id__in=ids, served_on__range=(start, end),
                                  status=VisitStatus.COLLECTED).values("van_id", "holding_id"):
        served[v["van_id"]].add(v["holding_id"])

    rows = []
    for van in vans:
        r = this.get(van.id)
        if r is None and not before.get(van.id):
            continue
        r = r or {"fills": 0, "litres": 0.0, "cost": 0, "km": 0.0, "kmLitres": 0.0}
        kmpl = round(r["km"] / r["kmLitres"], 2) if r["kmLitres"] else None
        usual = float(van.kmpl) if van.kmpl else None
        check = bool(kmpl and usual and kmpl < usual * (100 - KMPL_DROP_PCT) / 100)
        holdings = len(served[van.id])
        rows.append({
            "id": van.id, "plate": van.plate, "agency": van.agency.name if van.agency_id else "",
            "driver": van.driver.name if van.driver_id else "", "fuel": van.fuel,
            "fills": r["fills"], "litres": round(r["litres"], 2), "cost": r["cost"],
            "costBefore": before.get(van.id, 0), "km": round(r["km"]), "kmpl": kmpl, "usualKmpl": usual,
            "check": check, "costPerKm": round(r["cost"] / r["km"], 2) if r["km"] else None,
            "holdings": holdings, "costPerHolding": round(r["cost"] / holdings, 2) if holdings else None,
        })
    rows.sort(key=lambda r: -r["cost"])
    total = {
        "cost": sum(r["cost"] for r in rows), "costBefore": sum(r["costBefore"] for r in rows),
        "litres": round(sum(r["litres"] for r in rows), 2), "km": sum(r["km"] for r in rows),
        "vans": sum(1 for r in rows if r["fills"]), "check": sum(1 for r in rows if r["check"]),
    }
    total["costPerKm"] = round(total["cost"] / total["km"], 2) if total["km"] else None
    return {"period": label, "rows": rows, "totals": total, "dropPct": KMPL_DROP_PCT}


def maintenance_report(*, date_from, date_to, ward_ids=None, agency_id=None) -> dict:
    """Per van over a range: jobs, cost, days off the road, open jobs, next service; and the jobs."""
    from swms.fleet.models import Maintenance

    vans = {v.id: v for v in _vans(ward_ids, agency_id)}
    lo, hi = _bounds(date_from, date_to)
    jobs = (Maintenance.objects.filter(van_id__in=vans.keys())
            .filter(opened__lt=hi).exclude(closed__lt=lo).order_by("-opened"))

    per_van = defaultdict(lambda: {"jobs": 0, "scheduled": 0, "unscheduled": 0, "cost": 0,
                                   "downtimeH": 0.0, "open": 0, "last": None, "lastReason": ""})
    listed = []
    now = timezone.now()
    for j in jobs:
        row = per_van[j.van_id]
        row["jobs"] += 1
        row[j.kind if j.kind in ("scheduled", "unscheduled") else "unscheduled"] += 1
        row["cost"] += j.cost
        # An open job is off the road until now; a closed one by its recorded
        # downtime, or by its open-to-close time when none was recorded.
        if j.closed is None:
            hours = (now - j.opened).total_seconds() / 3600
        else:
            hours = float(j.downtime or 0) or (j.closed - j.opened).total_seconds() / 3600
        row["downtimeH"] += hours
        if j.closed is None:
            row["open"] += 1
        opened = timezone.localtime(j.opened).date()
        if row["last"] is None:
            row["last"], row["lastReason"] = opened, j.reason
        van = vans[j.van_id]
        listed.append({
            "id": j.id, "van": j.van_id, "plate": van.plate, "kind": j.kind, "reason": j.reason,
            "vendor": j.vendor, "opened": opened.isoformat(),
            "closed": timezone.localtime(j.closed).date().isoformat() if j.closed else None,
            "downtimeH": round(hours, 1), "cost": j.cost, "odometer": j.odometer,
        })

    rows = []
    for van_id, van in vans.items():
        r = per_van.get(van_id)
        due_km = (van.next_service_km - van.odometer) if van.next_service_km else None
        if r is None and (due_km is None or due_km > 500):
            continue
        r = r or per_van[van_id]
        rows.append({
            "id": van_id, "plate": van.plate, "agency": van.agency.name if van.agency_id else "",
            "status": van.status, "jobs": r["jobs"], "scheduled": r["scheduled"],
            "unscheduled": r["unscheduled"], "cost": r["cost"],
            "downtimeDays": round(r["downtimeH"] / 24, 1), "open": r["open"],
            "last": r["last"].isoformat() if r["last"] else None, "lastReason": r["lastReason"],
            "odometer": van.odometer, "nextServiceKm": van.next_service_km, "serviceDueIn": due_km,
        })
    rows.sort(key=lambda r: (-r["open"], -r["cost"], r["id"]))
    totals = {
        "jobs": sum(r["jobs"] for r in rows), "cost": sum(r["cost"] for r in rows),
        "downtimeDays": round(sum(r["downtimeDays"] for r in rows), 1),
        "open": sum(r["open"] for r in rows),
        "serviceDue": sum(1 for r in rows if r["serviceDueIn"] is not None and r["serviceDueIn"] <= 500),
    }
    return {"rows": rows, "jobs": listed, "totals": totals,
            "from": date_from.isoformat(), "to": date_to.isoformat()}
