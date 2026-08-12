"""The daily round, server-side.

This is the counterpart of `src/utils/collection.js`. Route ownership and stop
order used to be recomputed in the browser from three arrays, which meant the
supervisor's Routes view and the collector's own round could only agree by
accident. Here the plan is read once, from the tables that enforce it, and both
screens call the same function.

Two rules the mock left to the UI are enforced here instead:

* one visit per household per day — correcting a mistaken skip updates that row
  rather than adding a second one (the table constrains it too);
* a skip carries a reason, because that is the first thing a supervisor is asked
  for when a household disputes a missed collection.
"""

from __future__ import annotations

from datetime import timedelta

from django.db import transaction
from django.db.models import Count, Prefetch, Q
from django.utils import timezone

from swms.agencies.services import stamp_agency_for
from swms.common.exceptions import DomainError
from swms.common.realtime import COLLECTOR_STATUS, VISIT_RECORDED, publish
from swms.customers.models import HoldingStatus, Household

from .models import Assignment, Collector, Route, RouteStop, Visit, VisitStatus

#: A stop with no visit row for the day *is* pending; there is no such column.
PENDING = "pending"


def _as_float(value):
    return float(value) if value is not None else None


def _error_text(exc) -> str:
    """Flatten a DRF/domain error into one line for the bulk report."""
    detail = getattr(exc, "detail", None)
    if isinstance(detail, dict):
        parts = []
        for field, messages in detail.items():
            if not isinstance(messages, list):
                messages = [messages]
            parts.append(f"{field}: {' '.join(str(m) for m in messages)}")
        return "; ".join(parts)
    if isinstance(detail, list):
        return "; ".join(str(m) for m in detail)
    return str(detail if detail is not None else exc)


# --------------------------------------------------------------------------- #
# Recording work
# --------------------------------------------------------------------------- #


@transaction.atomic
def record_visit(
    household,
    *,
    collector=None,
    status: str = VisitStatus.COLLECTED,
    at=None,
    accuracy: int | None = None,
    lat=None,
    lng=None,
    source: str = "",
    reason: str = "",
    note: str = "",
    synced: bool = True,
    user=None,
) -> Visit:
    """Create or update the one visit for (household, today).

    The mock appended a row per tap, so undoing a skip left two records for one
    holding and every count downstream had to guess which one was current. The
    day's row is reused instead, which is also what the table's
    `(household, served_on)` constraint demands.

    `qr` and `route` are taken from the household rather than from the client:
    the tag is copied so an audit reads what was on the bin at the time, and the
    route is whatever the planner laid out, not what the device believes.
    """
    if not isinstance(household, Household):
        household = (
            Household.objects.select_related("holding", "holding__route_stop")
            .filter(pk=household)
            .first()
        )
    if household is None:
        raise DomainError("No such household.", code="unknown_household")

    status = str(status)
    if status == VisitStatus.SKIPPED and not reason:
        raise DomainError("A skipped stop needs a reason.", code="reason_required")

    at = at or timezone.now()
    served_on = timezone.localtime(at).date()
    # The plan is holding-wise, so the route a visit belongs to is the one this
    # family's *building* sits on.
    stop = getattr(household.holding, "route_stop", None)

    values = {
        "collector": collector,
        # Stamped, not derived: see the note on `Visit.agency`. Resolved as of
        # the day served so a round synced late is credited to whoever employed
        # the collector then, not to whoever does now.
        "agency": stamp_agency_for(collector, served_on),
        "route_id": stop.route_id if stop else None,
        "qr": household.qr or "",
        "status": status,
        "at": at,
        "accuracy": accuracy,
        "lat": lat,
        "lng": lng,
        "source": source or "",
        # A correction to 'collected' must clear the old reason, or the check
        # constraint's intent survives as stale text on the row.
        "reason": "" if status == VisitStatus.COLLECTED else reason,
        "note": note or "",
        "synced": synced,
        "recorded_by": user if getattr(user, "is_authenticated", False) else None,
    }

    visit = Visit.objects.filter(household=household, served_on=served_on).first()
    if visit is None:
        visit = Visit(household=household)
    for field, value in values.items():
        setattr(visit, field, value)
    visit.save()

    publish(
        VISIT_RECORDED,
        {
            "id": visit.id,
            "hh": visit.household_id,
            "collector": visit.collector_id,
            "route": visit.route_id,
            "ward": household.ward_id,
            "status": visit.status,
            "at": visit.at.isoformat(),
            "lat": _as_float(visit.lat),
            "lng": _as_float(visit.lng),
        },
        agency_id=visit.agency_id,
    )
    return visit


def bulk_record_visits(rows, user=None) -> dict:
    """Take an offline queue upload.

    Every row is recorded in its own transaction so one unusable row cannot cost
    a collector a morning's work; the caller gets told exactly which indices
    failed and why. Rows arrive marked unsynced on the device and are stored
    synced — reaching here *is* the sync.
    """
    from .serializers import RecordVisitSerializer

    saved: list[str] = []
    failed: list[dict] = []

    for index, row in enumerate(rows):
        serializer = RecordVisitSerializer(data=row, context={"user": user})
        try:
            serializer.is_valid(raise_exception=True)
            data = serializer.validated_data
            visit = record_visit(
                data["hh"],
                collector=data.get("collector"),
                status=data.get("status", VisitStatus.COLLECTED),
                at=data.get("at"),
                accuracy=data.get("accuracy"),
                lat=data.get("lat"),
                lng=data.get("lng"),
                source=data.get("source", ""),
                reason=data.get("reason", ""),
                note=data.get("note", ""),
                synced=True,
                user=user,
            )
            saved.append(visit.id)
        except Exception as exc:  # noqa: BLE001 — one bad row must not sink the batch
            failed.append({"index": index, "error": _error_text(exc)})

    return {"saved": saved, "failed": failed}


def set_attendance(collector: Collector, attendance: str, user=None) -> Collector:
    """Record a depot check-in or an absence.

    Only attendance moves: `status` says where a collector is right now and is
    driven by their work, so marking somebody absent must not silently claim they
    are off route.
    """
    collector.attendance = attendance
    collector.save(update_fields=["attendance", "updated_at"])
    publish(
        COLLECTOR_STATUS,
        {
            "id": collector.id,
            "name": collector.name,
            "ward": collector.ward_id,
            "status": collector.status,
            "attendance": collector.attendance,
        },
        agency_id=collector.agency_id,
    )
    return collector


# --------------------------------------------------------------------------- #
# Reading the round
# --------------------------------------------------------------------------- #


def assignment_for(collector_id: str) -> Assignment | None:
    """The collector's live plan. At most one is active — the table enforces it."""
    return (
        Assignment.objects.filter(collector_id=collector_id, active=True)
        .prefetch_related("route_links")
        .first()
    )


def routes_for_collector(collector_id: str) -> list[Route]:
    """The routes a collector holds, in the order they were assigned."""
    assignment = assignment_for(collector_id)
    if assignment is None:
        return []
    ordered_ids = [link.route_id for link in assignment.route_links.all()]
    by_id = {
        route.id: route
        for route in Route.objects.filter(pk__in=ordered_ids, active=True).prefetch_related(
            "stops"
        )
    }
    return [by_id[rid] for rid in ordered_ids if rid in by_id]


def round_for_collector(collector_id: str, day=None, *, user=None) -> list[dict]:
    """One collector's stops for one day, in walking order.

    The plan is authoritative: the round is exactly what a supervisor laid out,
    route after route, stop after stop — not re-sorted by progress, because the
    collector reads the list the way they walk the street. Each stop carries its
    route so somebody holding a morning road and an afternoon one can see where
    the first ends.

    `user` narrows the result to the wards that user may see, matching every
    other endpoint; a city-wide user sees the whole round.
    """
    day = day or timezone.localdate()
    routes = routes_for_collector(collector_id)
    if not routes:
        return []

    stop_rows = (
        RouteStop.objects.filter(route_id__in=[route.id for route in routes])
        .select_related("holding")
        # A stop is a building; the round is a list of families. Each stop is
        # expanded into the households inside it, so a block of twelve flats is
        # one stop on the plan and twelve doors on the round — which is what the
        # collector actually knocks on, and what billing needs.
        .prefetch_related(
            Prefetch(
                "holding__households",
                queryset=Household.objects.filter(status=HoldingStatus.ACTIVE)
                .select_related("road", "holding")
                .order_by("unit", "id"),
                to_attr="round_households",
            )
        )
        .order_by("route_id", "seq")
    )
    if user is not None:
        ward_ids = user.visible_ward_ids()
        if ward_ids is not None:
            stop_rows = stop_rows.filter(holding__ward_id__in=ward_ids)
        agency_id = user.visible_agency_id()
        if agency_id is not None:
            stop_rows = stop_rows.filter(holding__agency_id=agency_id)

    by_route: dict[str, list[RouteStop]] = {}
    for stop in stop_rows:
        by_route.setdefault(stop.route_id, []).append(stop)

    household_ids = [
        household.id
        for stops in by_route.values()
        for stop in stops
        for household in stop.holding.round_households
    ]
    visits = {
        visit.household_id: visit
        for visit in Visit.objects.filter(household_id__in=household_ids, served_on=day)
    }

    stops: list[dict] = []
    seen: set[str] = set()
    for route in routes:
        for stop in by_route.get(route.id, []):
            for household in stop.holding.round_households:
                # A building sits on exactly one route (RouteStop is one-to-one
                # on holding), so this only guards a plan repaired mid-read.
                if household.id in seen:
                    continue
                seen.add(household.id)
                stops.append(
                    _stop_payload(stop, household, route, visits.get(household.id))
                )
    return stops


def _stop_payload(stop: RouteStop, household, route: Route, visit: Visit | None) -> dict:
    return {
        "hh": household.id,
        "routeId": route.id,
        "routeName": route.name,
        "seq": stop.seq,
        "head": household.head,
        "holding": household.holding_no,
        "road": household.road.name,
        "ward": household.ward_id,
        "lat": _as_float(household.lat),
        "lng": _as_float(household.lng),
        "qr": household.qr,
        "dues": household.dues,
        "tier": household.tier_id,
        "phone": household.phone,
        "suitableTime": household.suitable_time_id,
        "visitStatus": visit.status if visit else PENDING,
        "at": visit.at.isoformat() if visit else None,
        # The round table prints the GPS accuracy under the collection time.
        "accuracy": visit.accuracy if visit else None,
        "visitId": visit.id if visit else None,
        "synced": visit.synced if visit else None,
        "by": visit.collector_id if visit else None,
    }


def count_by_status(stops) -> dict:
    """The three buckets always sum to `all` — anything else is still waiting."""
    collected = sum(1 for stop in stops if stop["visitStatus"] == VisitStatus.COLLECTED)
    skipped = sum(1 for stop in stops if stop["visitStatus"] == VisitStatus.SKIPPED)
    return {
        "all": len(stops),
        "collected": collected,
        "skipped": skipped,
        "pending": len(stops) - collected - skipped,
    }


# --------------------------------------------------------------------------- #
# Scanning
# --------------------------------------------------------------------------- #


def parse_scan(raw) -> dict | None:
    """Pull a household id and/or tag out of a scan.

    Bin stickers encode `SWMS|<household id>|<qr tag>`. Collectors also key a tag
    in by hand when a label is too worn to scan, so a bare `HH-…` or `SS-…` is
    accepted, and anything else is still tried as a tag rather than refused.
    """
    text = str(raw or "").strip()
    if not text:
        return None

    upper = text.upper()
    if upper.startswith("SWMS|"):
        parts = upper.split("|")
        household_id = parts[1] if len(parts) > 1 else ""
        tag = parts[2] if len(parts) > 2 else ""
        if not household_id and not tag:
            return None
        return {"id": household_id or None, "qr": tag or None}
    if upper.startswith("HH-"):
        return {"id": upper, "qr": None}
    if upper.startswith("SS-"):
        return {"id": None, "qr": upper}
    return {"id": None, "qr": upper}


def match_scan(raw, collector_id: str, day=None, *, user=None) -> dict:
    """Resolve a scan against one collector's round.

    The four failures are distinct on purpose. 'otherRoute' is a wrong-round
    mistake the collector can fix on the spot; 'unknown' is an unregistered or
    damaged tag that needs the office; 'alreadyCollected' stops a double entry;
    'unreadable' means the camera got nothing.
    """
    parsed = parse_scan(raw)
    if parsed is None:
        return {"ok": False, "reason": "unreadable"}

    stops = round_for_collector(collector_id, day, user=user)
    for stop in stops:
        if _matches(parsed, stop["hh"], stop["qr"]):
            if stop["visitStatus"] == VisitStatus.COLLECTED:
                return {"ok": False, "reason": "alreadyCollected", "stop": stop}
            return {"ok": True, "stop": stop}

    predicate = Q()
    if parsed["id"]:
        predicate |= Q(pk=parsed["id"])
    if parsed["qr"]:
        predicate |= Q(qr__iexact=parsed["qr"])
    elsewhere = (
        Household.objects.select_related("road", "holding").filter(predicate).first() if predicate else None
    )
    if elsewhere is not None:
        return {
            "ok": False,
            "reason": "otherRoute",
            "household": {
                "hh": elsewhere.id,
                "head": elsewhere.head,
                "holding": elsewhere.holding_no,
                "road": elsewhere.road.name,
                "ward": elsewhere.ward_id,
                "qr": elsewhere.qr,
            },
        }
    return {"ok": False, "reason": "unknown", "code": parsed["qr"] or parsed["id"]}


def _matches(parsed: dict, household_id: str, tag: str | None) -> bool:
    if parsed["id"] and household_id == parsed["id"]:
        return True
    return bool(parsed["qr"] and tag and tag.upper() == parsed["qr"])


# --------------------------------------------------------------------------- #
# Performance figures
# --------------------------------------------------------------------------- #


def refresh_collector_metrics(collector=None, *, days: int = 30) -> int:
    """Recompute `on_time` and `coverage` from the visit log.

    Both are whole percentages over the trailing `days` days, ending today.

    **coverage** — collected visits ÷ planned stop-days. A planned stop-day is one
    stop on one of the collector's currently assigned active routes, on one day
    they actually worked (a day with at least one visit of any kind). Days off do
    not count against them, which is why the denominator uses worked days rather
    than the calendar.

    **on_time** — collected visits whose `at`, read as a local time of day, fell
    inside the route's window, ÷ collected visits that can be judged. A visit with
    no route attached has no window to compare with, so it is left out of both
    sides instead of being scored as a miss.

    Returns the number of collectors updated. The mock carried both figures as
    seeded columns nobody recalculated; here they are stamped with
    `metrics_updated_at` so a stale number is visibly stale.
    """
    if collector is None:
        rows = list(Collector.objects.all())
    elif isinstance(collector, Collector):
        rows = [collector]
    else:
        rows = list(Collector.objects.filter(pk=collector))
    if not rows:
        return 0

    ids = [row.id for row in rows]
    since = timezone.localdate() - timedelta(days=days - 1)

    # Counted in *households*, not stops. A stop is a building since the plan
    # went holding-wise, but a visit is still one family — so counting stops
    # here would divide twelve collections by one planned stop and report 1200%
    # coverage for a block of flats.
    planned = {
        entry["holding__route_stop__route__assignment_links__assignment__collector_id"]:
            entry["total"]
        for entry in Household.objects.filter(
            status=HoldingStatus.ACTIVE,
            holding__route_stop__route__active=True,
            holding__route_stop__route__assignment_links__assignment__active=True,
            holding__route_stop__route__assignment_links__assignment__collector_id__in=ids,
        )
        .values("holding__route_stop__route__assignment_links__assignment__collector_id")
        .annotate(total=Count("id", distinct=True))
    }

    by_collector: dict[str, list[Visit]] = {row.id: [] for row in rows}
    for visit in Visit.objects.filter(
        collector_id__in=ids, served_on__gte=since
    ).select_related("route"):
        by_collector[visit.collector_id].append(visit)

    stamp = timezone.now()
    for row in rows:
        visits = by_collector.get(row.id, [])
        worked_days = {visit.served_on for visit in visits}
        collected = [visit for visit in visits if visit.status == VisitStatus.COLLECTED]

        stop_days = planned.get(row.id, 0) * len(worked_days)
        row.coverage = _percent(len(collected), stop_days)

        judged = [visit for visit in collected if visit.route_id]
        punctual = [visit for visit in judged if _within_window(visit)]
        row.on_time = _percent(len(punctual), len(judged))
        row.metrics_updated_at = stamp

    Collector.objects.bulk_update(rows, ["on_time", "coverage", "metrics_updated_at"])
    return len(rows)


def _percent(part: int, whole: int) -> int:
    if not whole:
        return 0
    # Clamped: a collector who served a holding twice over the window would
    # otherwise report more than 100% coverage and fail the column's validator.
    return min(100, round(100 * part / whole))


def _within_window(visit: Visit) -> bool:
    moment = timezone.localtime(visit.at).time()
    return visit.route.window_start <= moment <= visit.route.window_end
