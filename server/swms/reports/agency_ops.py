"""Agency Reports — daily follow-up: the collection sheet, and missed & skipped holdings.

Who a holding "belongs to" on a day: the collector on the visit if one is
recorded; otherwise the collector currently assigned to the holding's route
(an auto-collected or missed visit made at the cut-off has no collector on it).
Assignments are not kept as history, so a route that changed hands mid-period
is credited to its current collector for the days nobody scanned.
"""

from __future__ import annotations

import datetime as dt
from collections import Counter, defaultdict

from django.utils import timezone

#: The longest range the daily sheet will compute, in days.
MAX_DAYS = 62


def _route_collectors() -> dict[str, str]:
    from swms.fieldops.models import AssignmentRoute

    return dict(
        AssignmentRoute.objects.filter(assignment__active=True)
        .order_by("assignment__effective_from")
        .values_list("route_id", "assignment__collector_id")
    )


def _collector_names(ids) -> dict[str, dict]:
    from swms.fieldops.models import Collector

    return {c.id: {"name": c.name, "agency": c.agency.name if c.agency_id else ""}
            for c in Collector.objects.filter(id__in=[i for i in ids if i]).select_related("agency")}


def _scoped_visits(date_from, date_to, ward_ids, agency_id):
    from swms.fieldops.models import Visit

    visits = Visit.objects.filter(served_on__range=(date_from, date_to))
    if ward_ids is not None:
        visits = visits.filter(holding__ward_id__in=ward_ids)
    if agency_id is not None:
        visits = visits.filter(agency_id=agency_id)
    return visits


def _owner(visit: dict, routes: dict) -> str | None:
    return visit["collector_id"] or routes.get(visit["route_id"]) or routes.get(visit["holding__route_stop__route_id"])


def collection_sheet(*, date_from, date_to, ward_ids=None, agency_id=None, collector=None, by="collector") -> dict:
    """Per day and collector (or, with `by="day"`, per day): due, confirmed, auto, skipped, missed, not recorded."""
    from swms.customers.models import Holding, HoldingStatus
    from swms.fieldops.models import SkipReason, VisitSource, VisitStatus

    if (date_to - date_from).days >= MAX_DAYS:
        date_from = date_to - dt.timedelta(days=MAX_DAYS - 1)
    routes = _route_collectors()
    blank = lambda: {"due": 0, "confirmed": 0, "auto": 0, "skipped": 0, "missed": 0}  # noqa: E731
    cells: dict[tuple, dict] = defaultdict(blank)

    # One query for every holding that could be due, then counted per day: a
    # holding is due on a day if it is active, on an active route, and was
    # registered by the end of that day (the rule `due_holdings` applies).
    due = Holding.objects.filter(status=HoldingStatus.ACTIVE, route_stop__route__active=True,
                                 ward__zone__city__isnull=False)
    if ward_ids is not None:
        due = due.filter(ward_id__in=ward_ids)
    if agency_id is not None:
        due = due.filter(agency_id=agency_id)
    due = [(timezone.localtime(created).date(), routes.get(route_id))
           for created, route_id in due.values_list("created_at", "route_stop__route_id")]
    day = date_from
    while day <= date_to:
        for registered, owner in due:
            if registered <= day:
                cells[(day, owner)]["due"] += 1
        day += dt.timedelta(days=1)

    for v in _scoped_visits(date_from, date_to, ward_ids, agency_id).values(
            "served_on", "collector_id", "route_id", "holding__route_stop__route_id",
            "status", "source", "reason"):
        cell = cells[(v["served_on"], _owner(v, routes))]
        if v["status"] == VisitStatus.COLLECTED:
            cell["auto" if v["source"] == VisitSource.AUTO else "confirmed"] += 1
        elif v["reason"] == SkipReason.COMPLAINT:
            cell["missed"] += 1
        else:
            cell["skipped"] += 1

    names = _collector_names({c for _, c in cells})
    rows = []
    for (day, cid), c in cells.items():
        if collector and cid != collector:
            continue
        if not any(c.values()):
            continue
        handled = c["confirmed"] + c["auto"] + c["skipped"] + c["missed"]
        collected = c["confirmed"] + c["auto"]
        rows.append({
            "day": day.isoformat(), "collector": cid,
            "name": names.get(cid, {}).get("name") or "",
            "agency": names.get(cid, {}).get("agency", ""),
            **c, "notRecorded": max(c["due"] - handled, 0),
            "collectedPct": round(collected * 100 / c["due"]) if c["due"] else 0,
        })
    rows.sort(key=lambda r: r["name"])
    rows.sort(key=lambda r: r["day"], reverse=True)  # newest day first, names A–Z within it

    if by == "day":
        days: dict[str, dict] = {}
        for r in rows:
            d = days.setdefault(r["day"], {"day": r["day"], "collectors": 0, **dict.fromkeys(
                ("due", "confirmed", "auto", "skipped", "missed", "notRecorded"), 0)})
            d["collectors"] += 1 if r["collector"] else 0
            for k in ("due", "confirmed", "auto", "skipped", "missed", "notRecorded"):
                d[k] += r[k]
        rows = sorted(days.values(), key=lambda r: r["day"], reverse=True)
        for r in rows:
            r["collectedPct"] = round((r["confirmed"] + r["auto"]) * 100 / r["due"]) if r["due"] else 0

    totals = {k: sum(r[k] for r in rows) for k in ("due", "confirmed", "auto", "skipped", "missed", "notRecorded")}
    totals["collectedPct"] = round((totals["confirmed"] + totals["auto"]) * 100 / totals["due"]) if totals["due"] else 0
    return {"by": by, "rows": rows, "totals": totals, "from": date_from.isoformat(), "to": date_to.isoformat()}


def missed_holdings(*, date_from, date_to, ward_ids=None, agency_id=None) -> dict:
    """Each holding not served in the range: how often, why, and whose route."""
    from swms.fieldops.models import SkipReason, VisitStatus

    routes = _route_collectors()
    labels = dict(SkipReason.choices)
    found: dict[str, dict] = {}
    for v in _scoped_visits(date_from, date_to, ward_ids, agency_id).filter(status=VisitStatus.SKIPPED).values(
            "served_on", "collector_id", "route_id", "reason", "holding_id",
            "holding__route_stop__route_id", "holding__holding_no", "holding__owner_name",
            "holding__owner_phone", "holding__road__name", "holding__ward__name"):
        row = found.setdefault(v["holding_id"], {
            "holding": v["holding_id"], "holdingNo": v["holding__holding_no"],
            "owner": v["holding__owner_name"], "phone": v["holding__owner_phone"],
            "road": v["holding__road__name"], "wardName": v["holding__ward__name"],
            "missed": 0, "skipped": 0, "reasons": Counter(), "collectors": Counter(), "last": v["served_on"],
        })
        if v["reason"] == SkipReason.COMPLAINT:
            row["missed"] += 1
        else:
            row["skipped"] += 1
            row["reasons"][v["reason"] or ""] += 1
        row["collectors"][_owner(v, routes)] += 1
        row["last"] = max(row["last"], v["served_on"])

    names = _collector_names({c for r in found.values() for c in r["collectors"]})
    rows = []
    for r in found.values():
        owner = r.pop("collectors").most_common(1)[0][0]
        reasons = r.pop("reasons")
        r.update({
            "times": r["missed"] + r["skipped"],
            "reasonCounts": dict(reasons.most_common()),
            "reasons": ", ".join(f"{labels.get(k, k or 'No reason')} ×{n}" for k, n in reasons.most_common()),
            "collector": owner, "collectorName": names.get(owner, {}).get("name", ""),
            "last": r["last"].isoformat(),
        })
        rows.append(r)
    rows.sort(key=lambda r: (-r["missed"], -r["times"], r["holdingNo"] or ""))
    return {
        "rows": rows,
        "holdings": len(rows),
        "repeat": sum(1 for r in rows if r["times"] >= 2),
        "missed": sum(r["missed"] for r in rows),
        "skipped": sum(r["skipped"] for r in rows),
        "from": date_from.isoformat(), "to": date_to.isoformat(),
    }
