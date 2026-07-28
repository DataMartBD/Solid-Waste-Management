"""Fleet domain operations, and the live map's initial state.

Everything here is something the mock did in the browser across several store
writes, where a half-finished sequence left the data inconsistent — a collector
driving two vans, a van stuck in `in_maintenance` after its job closed, an
odometer that never moved. Each operation is one server-side transaction.
"""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

from django.db import transaction
from django.db.models import Avg, Count, Q, Sum
from django.utils import timezone

from swms.common.exceptions import DomainError
from swms.common.realtime import VEHICLE_POSITION, publish

from .models import (
    FuelLog,
    FuelType,
    Maintenance,
    MaintenanceKind,
    Van,
    VanStatus,
    VehiclePosition,
)

#: A van with no ping in this long is drawn as "last seen", not as live.
STALE_AFTER = timedelta(minutes=10)

#: Where the map opens when the user can see the whole city — Khulna, matching
#: the constant LiveMap.jsx used.
CITY_CENTRE = (22.836, 89.53)

#: Service is flagged once the van is this close to its next scheduled visit.
SERVICE_WARNING_KM = 1000

#: km/L below this is a mechanical problem, not thrift.
LOW_EFFICIENCY_KMPL = Decimal("5")


def _num(value):
    """Decimal -> float, so the payload carries JSON numbers the map can use."""
    return None if value is None else float(value)


# --------------------------------------------------------------------------- #
# Vehicle assignment
# --------------------------------------------------------------------------- #


@transaction.atomic
def assign_driver(van: Van, collector) -> Van:
    """Put `collector` behind the wheel of `van`, and only of `van`.

    The mock set the driver in two places — the van form and the collector
    screen — with neither clearing the collector's previous vehicle, so a
    collector could end up recorded as driving two vans at once. Here the release
    and the assignment are one atomic operation: any *other* van pointing at this
    collector is unassigned first. Pass `collector=None` to simply free the van.
    """
    if collector is not None:
        # updated_at is auto_now, which .update() bypasses — stamp it by hand.
        Van.objects.filter(driver=collector).exclude(pk=van.pk).update(
            driver=None, updated_at=timezone.now()
        )
    van.driver = collector
    van.save(update_fields=["driver", "updated_at"])
    return van


# --------------------------------------------------------------------------- #
# Workshop
# --------------------------------------------------------------------------- #


@transaction.atomic
def open_maintenance(
    van: Van,
    *,
    kind: str,
    reason: str,
    odometer: int,
    vendor: str = "",
    cost: int = 0,
    user=None,
) -> Maintenance:
    """Record a workshop job, mirroring what `Fleet.jsx` did in two store writes.

    The two kinds behave differently, which the mock expressed implicitly:

    * **unscheduled** — a breakdown. The job stays open and the van is taken off
      the road (`status = in_maintenance`) until someone closes it.
    * **scheduled** — routine servicing, almost always entered *after* the van is
      back. It is therefore closed immediately and the van's status is left
      alone, so logging last week's oil change does not park a working vehicle.

    A retired van keeps its status: retirement is final, and flipping it to
    `in_maintenance` would quietly return it to the availability count.
    """
    now = timezone.now()
    record = Maintenance(
        van=van,
        kind=kind,
        reason=reason,
        odometer=odometer,
        vendor=vendor or "",
        cost=cost or 0,
        opened=now,
        closed=now if kind == MaintenanceKind.SCHEDULED else None,
    )
    record.save()

    if kind == MaintenanceKind.UNSCHEDULED and van.status != VanStatus.RETIRED:
        van.status = VanStatus.IN_MAINTENANCE
        van.save(update_fields=["status", "updated_at"])
    return record


@transaction.atomic
def close_maintenance(
    maintenance: Maintenance, *, closed=None, cost: int | None = None, downtime=None
) -> Maintenance:
    """Sign a job off and, if nothing else is open, put the van back on the road.

    Downtime is the elapsed workshop time in hours unless the caller supplies a
    figure — the vehicle may have been usable for part of the window, and only
    the workshop knows that. The van returns to `active` only when it has no
    other open job, otherwise closing one of two faults would put a vehicle that
    is still on a ramp back into the availability count.
    """
    if not maintenance.is_open:
        raise DomainError(
            f"{maintenance.id} was already closed on {maintenance.closed:%Y-%m-%d}.",
            code="already_closed",
        )

    maintenance.closed = closed or timezone.now()
    if maintenance.closed < maintenance.opened:
        raise DomainError("A job cannot close before it opened.", code="closed_before_opened")

    if downtime is not None:
        maintenance.downtime = Decimal(downtime)
    else:
        hours = (maintenance.closed - maintenance.opened).total_seconds() / 3600
        maintenance.downtime = Decimal(f"{hours:.2f}")
    if cost is not None:
        maintenance.cost = cost
    maintenance.save(update_fields=["closed", "downtime", "cost", "updated_at"])

    van = maintenance.van
    still_open = (
        Maintenance.objects.filter(van=van, closed__isnull=True).exclude(pk=maintenance.pk).exists()
    )
    if not still_open and van.status == VanStatus.IN_MAINTENANCE:
        van.status = VanStatus.ACTIVE
        van.save(update_fields=["status", "updated_at"])
    return maintenance


# --------------------------------------------------------------------------- #
# Fuel
# --------------------------------------------------------------------------- #


@transaction.atomic
def log_fuel(van: Van, *, litres, cost: int, odometer: int, by=None, at=None) -> FuelLog:
    """Record a refuelling and move the van's odometer forward.

    The pump slip is the most reliable odometer reading the office ever gets, so
    it updates the van — the mock stored the reading on the log and left
    `van.odometer` at its seeded value, which made the service-due countdown
    permanently wrong. The reading never *lowers* the odometer (see
    `VanSerializer.validate_odometer`). `FuelLog.save()` derives km/L from the
    distance since this van's previous log, so it is not passed in here.
    """
    log = FuelLog.objects.create(
        van=van,
        litres=litres,
        cost=cost,
        odometer=odometer,
        by=by,
        at=at or timezone.now(),
    )
    if odometer > van.odometer:
        van.odometer = odometer
        van.save(update_fields=["odometer", "updated_at"])
    return log


# --------------------------------------------------------------------------- #
# Telemetry
# --------------------------------------------------------------------------- #


def record_position(
    van: Van,
    *,
    lat,
    lng,
    speed=None,
    heading=None,
    accuracy=None,
    ignition: bool = True,
    at=None,
    collector=None,
) -> VehiclePosition:
    """Store a GPS ping and push it to every open live-map socket.

    The ping is attributed to the van's current driver unless the tracker names
    somebody else, which keeps the map's collector pins working without the
    device having to know who signed on today.
    """
    position = VehiclePosition.objects.create(
        van=van,
        collector=collector if collector is not None else van.driver,
        lat=lat,
        lng=lng,
        speed=speed,
        heading=heading,
        accuracy=accuracy,
        ignition=ignition,
        at=at or timezone.now(),
    )
    publish(
        VEHICLE_POSITION,
        {
            "van": van.id,
            "collector": position.collector_id,
            "lat": _num(position.lat),
            "lng": _num(position.lng),
            "speed": _num(position.speed),
            "heading": position.heading,
            "ignition": position.ignition,
            "at": position.at.isoformat(),
        },
    )
    return position


# --------------------------------------------------------------------------- #
# Live map
# --------------------------------------------------------------------------- #


def live_snapshot(*, ward_ids=None) -> dict:
    """The live map's initial state: where every working van is, and what to plot.

    Shape of the work, and why:

    * **Latest position per van** is one `DISTINCT ON (van_id)` query
      (`.order_by("van_id", "-at").distinct("van_id")`, which Postgres supports
      natively). The obvious alternative — asking each van for `positions.first()`
      — is a query per van against the largest table in the schema.
    * **Route and progress** are three set-based queries (the active assignment
      links, the stop count per route, today's visit counts per route) that are
      then joined in Python by id. Vans are tens of rows, so a dictionary lookup
      is cheaper than the correlated subqueries the equivalent annotation needs.
    * **Households** are fetched with `.values()` rather than as models: the map
      needs six columns for a few thousand pins and never touches a method on
      them.

    Total cost is a fixed handful of queries regardless of fleet size, which
    matters because the map polls this endpoint on reconnect.

    `ward_ids=None` means city-wide. When ward ids are given, households are
    filtered to those wards and vans are limited to those driven by a collector
    based in one of them — an unassigned van has no ward, so it is not something a
    ward-scoped supervisor is responsible for.
    """
    from swms.customers.models import Household, HoldingStatus
    from swms.fieldops.models import AssignmentRoute, RouteStop, Visit, VisitStatus

    now = timezone.now()
    today = timezone.localdate()

    # --- 1. the vans worth drawing ---------------------------------------- #
    vans = Van.objects.exclude(status=VanStatus.RETIRED).select_related("driver", "driver__ward")
    if ward_ids is not None:
        vans = vans.filter(driver__ward_id__in=ward_ids)
    van_rows = list(vans)
    van_ids = [van.id for van in van_rows]

    # --- 2. one latest ping per van (DISTINCT ON) -------------------------- #
    latest = {
        position.van_id: position
        for position in VehiclePosition.objects.filter(van_id__in=van_ids)
        .order_by("van_id", "-at")
        .distinct("van_id")
    }

    # --- 3. each driver's current route ----------------------------------- #
    collector_ids = [van.driver_id for van in van_rows if van.driver_id]
    route_for_collector = {}
    for link in (
        AssignmentRoute.objects.filter(
            assignment__active=True, assignment__collector_id__in=collector_ids
        )
        .select_related("route", "route__ward", "assignment")
        .order_by("assignment__collector_id", "seq")
    ):
        # First link wins: `seq` is the running order, so seq=1 is today's round.
        route_for_collector.setdefault(link.assignment.collector_id, link.route)

    route_ids = [route.id for route in route_for_collector.values()]

    # --- 4. progress on those routes -------------------------------------- #
    stop_totals = {
        row["route_id"]: row["total"]
        for row in RouteStop.objects.filter(route_id__in=route_ids)
        .values("route_id")
        .annotate(total=Count("pk"))
    }
    progress = {
        row["route_id"]: row
        for row in Visit.objects.filter(route_id__in=route_ids, served_on=today)
        .values("route_id")
        .annotate(
            collected=Count("pk", filter=Q(status=VisitStatus.COLLECTED)),
            skipped=Count("pk", filter=Q(status=VisitStatus.SKIPPED)),
        )
    }

    van_payload = []
    for van in van_rows:
        position = latest.get(van.id)
        route = route_for_collector.get(van.driver_id) if van.driver_id else None
        counts = progress.get(route.id if route else None, {})
        total = stop_totals.get(route.id, 0) if route else 0
        collected = counts.get("collected", 0)
        van_payload.append(
            {
                "id": van.id,
                "plate": van.plate,
                "type": van.type,
                "status": van.status,
                "gps": van.gps,
                "lat": _num(position.lat) if position else None,
                "lng": _num(position.lng) if position else None,
                "speed": _num(position.speed) if position else None,
                "heading": position.heading if position else None,
                "ignition": position.ignition if position else None,
                "at": position.at.isoformat() if position else None,
                # The map dims a pin it has not heard from rather than pretending
                # a ten-minute-old fix is where the van is now.
                "stale": bool(position and (now - position.at) > STALE_AFTER),
                "driver": (
                    {
                        "id": van.driver.id,
                        "name": van.driver.name,
                        "dspId": van.driver.dsp_id,
                        # The UI calls a collector's home ward their "zone".
                        "zone": van.driver.ward_id,
                        "status": van.driver.status,
                        "coverage": van.driver.coverage,
                    }
                    if van.driver_id
                    else None
                ),
                "route": (
                    {
                        "id": route.id,
                        "name": route.name,
                        "ward": route.ward_id,
                        "window": route.window,
                    }
                    if route
                    else None
                ),
                "progress": {
                    "collected": collected,
                    "skipped": counts.get("skipped", 0),
                    "total": total,
                    "percent": round(collected / total * 100) if total else 0,
                },
            }
        )

    # --- 5. the pins ------------------------------------------------------- #
    households = Household.objects.filter(
        status=HoldingStatus.ACTIVE, lat__isnull=False, lng__isnull=False
    )
    if ward_ids is not None:
        households = households.filter(ward_id__in=ward_ids)
    household_payload = [
        {
            "id": row["id"],
            "lat": _num(row["lat"]),
            "lng": _num(row["lng"]),
            "verified": row["verified"],
            "dues": row["dues"],
            "ward": row["ward_id"],
        }
        for row in households.values("id", "lat", "lng", "verified", "dues", "ward_id")
    ]

    return {
        "at": now.isoformat(),
        "centre": _centre_for(ward_ids),
        "vans": van_payload,
        "households": household_payload,
        "counts": {
            "vans": len(van_payload),
            "tracked": sum(1 for row in van_payload if row["lat"] is not None),
            "live": sum(1 for row in van_payload if row["lat"] is not None and not row["stale"]),
            "households": len(household_payload),
        },
    }


def _centre_for(ward_ids) -> dict:
    """Where to open the map: the mean of the visible ward centres, else the city."""
    if ward_ids:
        from swms.catalog.models import Ward

        centre = Ward.objects.filter(id__in=ward_ids, lat__isnull=False).aggregate(
            lat=Avg("lat"), lng=Avg("lng")
        )
        if centre["lat"] is not None:
            return {"lat": _num(centre["lat"]), "lng": _num(centre["lng"])}
    return {"lat": CITY_CENTRE[0], "lng": CITY_CENTRE[1]}


# --------------------------------------------------------------------------- #
# Headline figures
# --------------------------------------------------------------------------- #


def fleet_kpis(*, as_of: date | None = None, within_days: int = 30) -> dict:
    """The four numbers on top of the Fleet page, computed rather than typed.

    Availability is measured against the *serviceable* fleet (everything not
    retired). The mock divided by every row it had, so retiring a van made
    availability look worse instead of better.
    """
    today = as_of or timezone.localdate()
    serviceable = Van.objects.exclude(status=VanStatus.RETIRED)

    by_status = {
        row["status"]: row["n"]
        for row in Van.objects.values("status").annotate(n=Count("pk"))
    }
    total = sum(by_status.values())
    fleet_size = total - by_status.get(VanStatus.RETIRED, 0)
    active = by_status.get(VanStatus.ACTIVE, 0)

    # Averages come from the vans' recorded figures; electric vans have no km/L
    # and are excluded rather than counted as zero.
    kmpl_by_fuel = {
        row["fuel"]: _num(row["avg"])
        for row in serviceable.exclude(fuel=FuelType.ELECTRIC)
        .filter(kmpl__isnull=False)
        .values("fuel")
        .annotate(avg=Avg("kmpl"))
    }

    month_start = today.replace(day=1)
    fuel_spend = (
        FuelLog.objects.filter(at__date__gte=month_start, at__date__lte=today).aggregate(
            total=Sum("cost")
        )["total"]
        or 0
    )
    maintenance_spend = (
        Maintenance.objects.filter(opened__date__gte=month_start, opened__date__lte=today).aggregate(
            total=Sum("cost")
        )["total"]
        or 0
    )

    # Count *documents*, not vans: one vehicle with three lapsed papers is three
    # things somebody has to go and renew.
    horizon = today + timedelta(days=within_days)
    doc_counts = serviceable.aggregate(
        fitness=Count("pk", filter=Q(fitness_exp__lte=horizon)),
        tax=Count("pk", filter=Q(tax_exp__lte=horizon)),
        insurance=Count("pk", filter=Q(insurance_exp__lte=horizon)),
        permit=Count("pk", filter=Q(permit_exp__lte=horizon)),
    )

    return {
        "asOf": today.isoformat(),
        "total": total,
        "fleetSize": fleet_size,
        "active": active,
        "inMaintenance": by_status.get(VanStatus.IN_MAINTENANCE, 0),
        "idle": by_status.get(VanStatus.IDLE, 0),
        "retired": by_status.get(VanStatus.RETIRED, 0),
        "availability": round(active / fleet_size * 100) if fleet_size else 0,
        "kmplByFuel": kmpl_by_fuel,
        "avgKmpl": _num(
            serviceable.filter(kmpl__isnull=False).aggregate(avg=Avg("kmpl"))["avg"]
        ),
        "period": month_start.strftime("%Y-%m"),
        "fuelSpend": fuel_spend,
        "maintenanceSpend": maintenance_spend,
        "documentsExpiring": sum(doc_counts.values()),
        "documentsByKind": doc_counts,
        "within": within_days,
    }


def van_alerts(*, as_of: date | None = None, within_days: int = 30) -> dict:
    """Everything the Fleet page's alert panel lists, per van.

    `buildAlerts()` in the mock compared against a hard-coded `new Date(
    '2026-07-05')`, so the panel froze in time and would have shown stale
    warnings forever. This computes against today (or an explicit `as_of`, which
    is what makes the behaviour testable).

    Alert rows carry structured data — `type`, `document`, `days`, `km` — not
    English sentences, because the UI already owns the Bangla/English strings.
    """
    today = as_of or timezone.localdate()
    rows = []
    per_van = []
    for van in Van.objects.exclude(status=VanStatus.RETIRED).select_related("driver"):
        documents = [
            {
                "document": doc["document"],
                "expires": doc["expires"].isoformat(),
                "days": doc["days"],
            }
            for doc in van.expiring_documents(within_days=within_days, today=today)
        ]
        for doc in documents:
            rows.append(
                {
                    "van": van.id,
                    "type": "expired" if doc["days"] < 0 else "expiring",
                    "severity": "danger" if doc["days"] < 0 else "warn",
                    "document": doc["document"],
                    "expires": doc["expires"],
                    "days": doc["days"],
                }
            )

        due_in = van.service_due_in_km
        service_due = (
            due_in is not None and due_in <= SERVICE_WARNING_KM and van.status == VanStatus.ACTIVE
        )
        if service_due:
            rows.append(
                {
                    "van": van.id,
                    "type": "serviceDue",
                    "severity": "danger" if due_in <= 0 else "warn",
                    "km": due_in,
                }
            )

        low_efficiency = van.kmpl is not None and van.kmpl < LOW_EFFICIENCY_KMPL
        if low_efficiency:
            rows.append(
                {
                    "van": van.id,
                    "type": "lowEfficiency",
                    "severity": "danger",
                    "kmpl": _num(van.kmpl),
                }
            )

        per_van.append(
            {
                "van": van.id,
                "plate": van.plate,
                "status": van.status,
                "driver": van.driver_id,
                "documents": documents,
                "serviceDueInKm": due_in,
                "serviceDue": service_due,
                "kmpl": _num(van.kmpl),
                "lowEfficiency": low_efficiency,
            }
        )

    return {
        "asOf": today.isoformat(),
        "within": within_days,
        "count": len(rows),
        "alerts": rows,
        "vans": per_van,
    }
