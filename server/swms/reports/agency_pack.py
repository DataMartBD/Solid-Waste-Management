"""Agency Reports — attendance, and the monthly report pack.

Attendance reads `AttendanceDay` (the day-by-day history `set_attendance`
writes) and the collector's own scans: a collector who scanned a stop worked
that day, whether or not anybody marked them in.

The monthly pack gathers one month of every agency report into key figures and
a handful of tables, for the JSON preview and the printable PDF.
"""

from __future__ import annotations

import datetime as dt
from collections import defaultdict

from django.utils import timezone

from .oversight import _collector_wards, month_range

#: Minutes after the collector's earliest route window opens before they are late.
LATE_GRACE_MIN = 15
DEFAULT_START = dt.time(6, 0)


def _pct(part, whole) -> float:
    return round(part * 100 / whole, 1) if whole else 0.0


def attendance(*, period=None, by="collector", ward_ids=None, agency_id=None, today=None) -> dict:
    """Per collector for a month: present, absent, no record, late — or every day."""
    from swms.fieldops.models import AssignmentRoute, AttendanceDay, Visit, VisitSource

    today = today or timezone.localdate()
    start, end = month_range(period)
    end = min(end, today)
    collectors = [c for c, _ in _collector_wards(ward_ids, agency_id)]
    ids = [c.id for c in collectors]
    days = [start + dt.timedelta(days=i) for i in range((end - start).days + 1)] if end >= start else []

    starts: dict[str, dt.time] = {}
    for cid, opens in AssignmentRoute.objects.filter(assignment__active=True, assignment__collector_id__in=ids) \
            .values_list("assignment__collector_id", "route__window_start"):
        if opens and (cid not in starts or opens < starts[cid]):
            starts[cid] = opens

    marks = {(a.collector_id, a.day): a for a in AttendanceDay.objects.filter(collector_id__in=ids, day__range=(start, end))}
    first_scan: dict[tuple, dt.time] = {}
    for cid, at in Visit.objects.filter(collector_id__in=ids, served_on__range=(start, end)) \
            .exclude(source=VisitSource.AUTO).values_list("collector_id", "at"):
        local = timezone.localtime(at)
        key = (cid, local.date())
        if key not in first_scan or local.time() < first_scan[key]:
            first_scan[key] = local.time()

    day_rows, per = [], defaultdict(lambda: {"present": 0, "absent": 0, "noRecord": 0, "late": 0})
    for c in collectors:
        opens = starts.get(c.id, DEFAULT_START)
        limit = (dt.datetime.combine(dt.date.today(), opens) + dt.timedelta(minutes=LATE_GRACE_MIN)).time()
        for day in days:
            if c.joined and day < c.joined:
                continue
            mark = marks.get((c.id, day))
            scan = first_scan.get((c.id, day))
            check_in = timezone.localtime(mark.first_in).time() if mark and mark.first_in else None
            arrived = min(t for t in (check_in, scan) if t) if (check_in or scan) else None
            if (mark and mark.status == "checked_in") or scan:
                status = "present"
            elif mark and mark.status == "absent":
                status = "absent"
            else:
                status = "noRecord"
            late = bool(status == "present" and arrived and arrived > limit)
            per[c.id][status] += 1
            per[c.id]["late"] += late
            if by == "day":
                day_rows.append({
                    "day": day.isoformat(), "collector": c.id, "name": c.name, "status": status,
                    "checkIn": check_in.strftime("%H:%M") if check_in else None,
                    "firstScan": scan.strftime("%H:%M") if scan else None,
                    "startsAt": opens.strftime("%H:%M"), "late": late,
                })

    rows = []
    for c in collectors:
        p = per.get(c.id)
        if p is None:
            continue
        counted = p["present"] + p["absent"] + p["noRecord"]
        rows.append({"collector": c.id, "name": c.name, "dspId": c.dsp_id,
                     "agency": c.agency.name if c.agency_id else "", "days": counted, **p,
                     "attendancePct": _pct(p["present"], counted), "startsAt": starts.get(c.id, DEFAULT_START).strftime("%H:%M")})
    rows.sort(key=lambda r: (r["attendancePct"], r["name"]))
    first = AttendanceDay.objects.order_by("day").values_list("day", flat=True).first()
    totals = {k: sum(r[k] for r in rows) for k in ("days", "present", "absent", "noRecord", "late")}
    totals["attendancePct"] = _pct(totals["present"], totals["days"])
    out_rows = sorted(day_rows, key=lambda r: r["name"]) if by == "day" else rows
    if by == "day":
        out_rows.sort(key=lambda r: r["day"], reverse=True)
    return {"by": by, "period": start.strftime("%Y-%m"), "rows": out_rows, "totals": totals,
            "recordingSince": first.isoformat() if first else None, "graceMinutes": LATE_GRACE_MIN}


# --------------------------------------------------------------------------- #
# The monthly pack
# --------------------------------------------------------------------------- #

def monthly_pack(*, period=None, ward_ids=None, agency_id=None, agency_name="") -> dict:
    """One month of the agency's reports: key figures and the tables behind them."""
    from . import agency_fleet, agency_money, agency_more, agency_ops, oversight

    start, end = month_range(period)
    label = start.strftime("%Y-%m")
    today = timezone.localdate()
    upto = min(end, today)
    scope = {"ward_ids": ward_ids, "agency_id": agency_id}

    score = oversight.collector_scorecard(period=label, **scope)
    targets = oversight.agency_targets(period=label, **scope)["rows"]
    perf = oversight.complaint_performance(date_from=start, date_to=upto, by="collector", **scope)
    sheet = agency_ops.collection_sheet(date_from=start, date_to=upto, **scope)
    missed = agency_ops.missed_holdings(date_from=start, date_to=upto, **scope)
    cash = agency_money.cash_in_hand(**scope)
    dues = agency_money.dues_ageing(by="ward", **scope)
    bills = agency_more.billing_runs(period=label, **scope)
    routes = agency_more.route_completion(date_from=start, date_to=upto, by="route", **scope)
    fuel = agency_fleet.fuel_report(period=label, **scope)
    repairs = agency_fleet.maintenance_report(date_from=start, date_to=upto, **scope)
    present = attendance(period=label, **scope)

    received = sum(r["received"] for r in perf)
    within = sum(r["withinSla"] for r in perf)
    resolved = sum(r["resolved"] for r in perf)
    target = sum(t["target"] or 0 for t in targets)
    served = sum(t["served"] for t in targets if t["target"])
    figures = [
        ("Holdings due (collection days)", sheet["totals"]["due"]),
        ("Collected %", f"{sheet['totals']['collectedPct']}%"),
        ("Missed by complaint", sheet["totals"]["missed"]),
        ("Holdings not served (missed or skipped)", missed["holdings"]),
        ("Target achievement", f"{_pct(served, target)}% ({served} of {target})" if target else "No target set"),
        ("Route completion (scanned stops)", f"{routes['totals']['completion']}%"),
        ("Routes finished on time", f"{routes['totals']['onTimePct']}%"),
        ("Collector attendance", f"{present['totals']['attendancePct']}%"),
        ("Complaints received", received),
        ("Resolved within deadline", f"{_pct(within, resolved)}%"),
        ("Billed (BDT)", bills["totals"]["amount"]),
        ("Collected against the month's bills (BDT)", bills["totals"]["collected"]),
        ("Bill collection %", f"{bills['totals']['collectionPct']}%"),
        ("Cash not yet handed in (BDT, today)", cash["total"]),
        ("Dues more than 60 days late (BDT, today)", dues["totals"]["d61_90"] + dues["totals"]["d90"]),
        ("Fuel cost (BDT)", fuel["totals"]["cost"]),
        ("Repair cost (BDT)", repairs["totals"]["cost"]),
    ]

    sections = [
        ("Collector scorecard", [
            ("rank", "#"), ("name", "Collector"), ("holdings", "Holdings"), ("served", "Served"),
            ("coverage", "Coverage %"), ("complaints", "Complaints"), ("collectionPct", "Bill collection %"),
            ("onTime", "On-time %"), ("score", "Score")], score["rows"]),
        ("Attendance", [
            ("name", "Collector"), ("days", "Days"), ("present", "Present"), ("absent", "Absent"),
            ("noRecord", "No record"), ("late", "Late"), ("attendancePct", "Attendance %")], present["rows"]),
        ("Route completion", [
            ("routeName", "Route"), ("wardName", "Ward"), ("collectorName", "Collector"), ("stops", "Stops"),
            ("notStarted", "Days not started"), ("completion", "Completion %"), ("onTimePct", "On-time %")],
         routes["rows"]),
        ("Complaints by collector", [
            ("name", "Collector"), ("received", "Received"), ("resolved", "Resolved"),
            ("slaPct", "Within deadline %"), ("avgResolveH", "Avg. hours"), ("openNow", "Open now")], perf),
        ("Holdings not served most often", [
            ("holdingNo", "Holding"), ("owner", "Owner"), ("road", "Road"), ("wardName", "Ward"),
            ("collectorName", "Collector"), ("missed", "Missed"), ("skipped", "Skipped")], missed["rows"][:25]),
        ("Billing by ward", [
            ("wardName", "Ward"), ("bills", "Bills"), ("amount", "Billed"), ("collected", "Collected"),
            ("outstanding", "Outstanding"), ("collectionPct", "Collection %")], bills["rows"]),
        ("Dues ageing by ward (today)", [
            ("wardName", "Ward"), ("holdings", "Holdings"), ("d0_30", "1-30 days"), ("d31_60", "31-60"),
            ("d61_90", "61-90"), ("d90", "90+"), ("outstanding", "Total due")], dues["rows"]),
        ("Cash not yet handed in (today)", [
            ("name", "Collector"), ("amount", "In hand"), ("payments", "Payments"), ("days", "Days held"),
            ("status", "Status")], cash["rows"]),
        ("Fuel by van", [
            ("id", "Van"), ("plate", "Plate"), ("litres", "Litres"), ("cost", "Cost"), ("km", "Km"),
            ("kmpl", "Km/l"), ("costPerKm", "BDT/km"), ("costPerHolding", "BDT/holding")], fuel["rows"]),
        ("Maintenance by van", [
            ("id", "Van"), ("plate", "Plate"), ("jobs", "Jobs"), ("unscheduled", "Breakdowns"),
            ("cost", "Cost"), ("downtimeDays", "Days off road"), ("open", "Open now")], repairs["rows"]),
    ]
    return {
        "period": label, "agency": agency_name, "partial": end > today,
        "figures": [{"label": k, "value": v} for k, v in figures],
        "sections": [{"title": t, "columns": [{"key": k, "label": l} for k, l in cols], "rows": rows}
                     for t, cols, rows in sections],
    }
