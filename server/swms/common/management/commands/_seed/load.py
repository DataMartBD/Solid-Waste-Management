"""Writing the generated dataset into the database.

Every table goes in through `bulk_create`, so no model `save()` override runs:
ids, QR tags and addresses are all supplied explicitly instead of being filled in
for us.

That matters most for payments. `Payment.save()` recalculates its bill and
refreshes the holding's dues — correct for money taken at a gate, and a write
plus two aggregates per row when a whole billing history arrives at once. Payments
are inserted flat and `settle()` reaches the same end state for the entire table
in two aggregates and two bulk updates.

The generated dataset is per family (it predates holding-wise operation), so
it is folded onto holdings here: a holding takes its service terms from its
families, one visit per holding per day survives, and a month's family bills
become one bill per holding.
"""

from __future__ import annotations

from io import StringIO

from django.core.management import call_command

import datetime as dt
from collections import defaultdict
from decimal import Decimal

from django.db.models import Sum
from django.db.models.functions import Coalesce

from swms.accounts.models import ScopeKind, User
from swms.agencies.models import Agency, CollectorEmployment
from swms.billing.models import Bill, BillingRun, BillStatus, Deposit, Payment
from swms.catalog.models import (
    AgencyType,
    City,
    CityType,
    CurrentPractice,
    CustomerType,
    HoldingType,
    PaymentMode,
    PotentialReason,
    Road,
    StorageType,
    SuitableTime,
    Tier,
    TimeGap,
    Ward,
    Zone,
)
from swms.common import ids
from swms.common.ids import bill_id, qr_tag
from swms.complaints.models import SLA_HOURS, Complaint, ComplaintActivity, Priority
from swms.customers.models import Holding, Household, PotentialCustomer
from swms.fieldops.models import Assignment, AssignmentRoute, Collector, Route, RouteStop, Visit
from swms.fleet.models import FuelLog, Maintenance, Van, VanStatus, VehiclePosition

from . import mockdata as mock
from .generate import Dataset
from .js import local, local_midnight, localize

BATCH = 500

#: Which option table each list loads into, in dependency order.
_OPTION_TABLES = [
    (CustomerType, mock.CUSTOMER_TYPES),
    (HoldingType, mock.HOLDING_TYPES),
    (StorageType, mock.STORAGE_TYPES),
    (SuitableTime, mock.SUITABLE_TIMES),
    (PaymentMode, mock.PAYMENT_MODES),
    (PotentialReason, mock.POTENTIAL_REASONS),
    (TimeGap, mock.TIME_GAPS),
    (CurrentPractice, mock.CURRENT_PRACTICES),
    (CityType, mock.CITY_TYPES),
    (AgencyType, mock.AGENCY_TYPES),
]

#: The same option models, for the command's teardown and summary lists.
OPTION_MODELS = [model for model, _ in _OPTION_TABLES]


def _coord(value: float | None) -> Decimal | None:
    return None if value is None else Decimal(str(value))


def _date(value: str | None) -> dt.date | None:
    return None if value is None else dt.date.fromisoformat(value)


def _stamp(value: str | None) -> dt.datetime | None:
    return None if value is None else local(value)


# --------------------------------------------------------------------------- #
# Reference data
# --------------------------------------------------------------------------- #


def load_catalog() -> dict[tuple[str, str], int]:
    """The city, its zones, wards, roads, tiers and the option lists.

    Returns the (ward, road name) → road pk map, because a household's road is a
    foreign key here and free text in the mock.
    """
    # First: City and Agency take their type from two of these lists. Those two
    # are also loaded by migration catalog.0005, so rows already there are kept.
    for model, rows in _OPTION_TABLES:
        model.objects.bulk_create(
            (
                model(id=row["id"], key=row["key"], label=row["label"], sort_order=order)
                for order, row in enumerate(rows)
            ),
            ignore_conflicts=True,
        )
    City.objects.create(
        id="KCC",
        city_type_id="city_corporation",
        name="Khulna City Corporation",
        name_bn="খুলনা সিটি কর্পোরেশন",
        district="Khulna",
        lat=_coord(22.8456),
        lng=_coord(89.5403),
    )
    Zone.objects.bulk_create(
        Zone(
            id=row["id"], city_id="KCC", key=row["key"], name=row["name"],
            name_bn=row.get("nameBn", ""), sort_order=order,
        )
        for order, row in enumerate(mock.ZONES)
    )
    Ward.objects.bulk_create(
        Ward(
            id=row["id"],
            key=row["key"],
            name=row["name"],
            zone_id=row["zone"],
            lat=_coord(mock.WARD_CENTERS[row["id"]][0]),
            lng=_coord(mock.WARD_CENTERS[row["id"]][1]),
            sort_order=order,
        )
        for order, row in enumerate(mock.WARDS)
    )
    Road.objects.bulk_create(
        Road(ward_id=ward_id, name=name, sort_order=order)
        for ward_id, names in mock.ROADS_BY_WARD.items()
        for order, name in enumerate(names)
    )
    # Blocks are the patch a surveyor walks. A fresh demo needs them or the
    # survey form's block dropdown is empty, so the seed calls the same command
    # an operator would rather than growing a second copy of the rule.
    call_command("seed_blocks", stdout=StringIO())
    Tier.objects.bulk_create(
        Tier(
            id=row["id"],
            key=row["key"],
            label=row["label"],
            charge=row["charge"],
            sort_order=order,
        )
        for order, row in enumerate(mock.TIERS)
    )
    return {
        (road.ward_id, road.name): road.pk
        for road in Road.objects.all()
    }


def load_agencies() -> Agency:
    """The one demo contractor, and the wards it works.

    A single agency mirrors the live database, where everything was attached to
    one provider when agencies were introduced. Seeding two would make the demo
    look like tenancy is enforced, which it is not yet.
    """
    agency = Agency.objects.create(
        id="AGN-KCC-0001",
        city_id="KCC",
        name=mock.AGENCY["name"],
        short_code=mock.AGENCY["shortCode"],
        agency_type_id=mock.AGENCY["type"],
        contact_person=mock.AGENCY["contactPerson"],
        phone=mock.AGENCY["phone"],
        contract_no=mock.AGENCY["contractNo"],
        contract_start=_date(mock.AGENCY["contractStart"]),
        contract_end=_date(mock.AGENCY["contractEnd"]),
        status="active",
    )
    agency.service_wards.set([row["id"] for row in mock.WARDS])
    ids.reserve("agency", 1)
    return agency


def load_collectors(agency: Agency) -> None:
    Collector.objects.bulk_create(
        Collector(
            id=row["id"],
            name=row["name"],
            dsp_id=row["dspId"],
            agency=agency,
            # The mock called this `zone` while storing a ward id.
            ward_id=row["zone"],
            phone=row["phone"],
            status=row["status"],
            attendance=row["attendance"],
            license=row["license"],
            license_exp=_date(row["licenseExp"]),
            joined=_date(row["joined"]),
            on_time=row["onTime"],
            coverage=row["coverage"],
        )
        for row in mock.COLLECTORS
    )
    # The history behind `Collector.agency`. Opened on the joining date so the
    # demo can answer "who employed them in March?" the same way live data will.
    CollectorEmployment.objects.bulk_create(
        CollectorEmployment(
            collector_id=row["id"],
            agency=agency,
            from_date=_date(row["joined"]),
            note="Seed opening record.",
        )
        for row in mock.COLLECTORS
    )


# --------------------------------------------------------------------------- #
# Customers
# --------------------------------------------------------------------------- #


def load_holdings(
    rows: list[dict], roads: dict[tuple[str, str], int], agency: Agency
) -> dict[tuple[str, str, str], str]:
    """Create one `Holding` per distinct address across households and surveys.

    The demo data predates the holding table and carries one row per family, so
    a building is inferred from the address its families share. Returns the
    lookup `(ward, road, holding_no) -> holding id` that the loaders below use.

    Ownership is seeded from the first family at the address: the mock has no
    landlord field, and inventing one would put fictional names in a column
    operators are meant to trust.
    """
    seen: dict[tuple[str, str, str], dict] = {}
    families: dict[tuple[str, str, str], list[dict]] = defaultdict(list)
    for row in rows:
        key = (row["ward"], row["road"], row["holding"])
        if key not in seen:
            seen[key] = row
        if "tier" in row:  # a family under service, not a survey row
            families[key].append(row)
    tier_charge = dict(Tier.objects.values_list("id", "charge"))

    holdings = []
    lookup: dict[tuple[str, str, str], str] = {}
    for index, (key, row) in enumerate(sorted(seen.items()), start=1):
        holding_pk = f"HLD-KCC-{index:06d}"
        lookup[key] = holding_pk
        # Service terms are the holding's: one family's as they were, or the
        # sum of what several families paid.
        served = [f for f in families.get(key, []) if f["status"] == "active"] or families.get(key, [])
        terms = {}
        if served:
            first = served[0]
            terms = {
                "tier_id": first["tier"],
                "payment_mode_id": first["paymentMode"],
                "payment_day": first["paymentDay"],
                "charge": first["charge"] if len(served) == 1 else sum(
                    f["charge"] or tier_charge.get(f["tier"], 0) for f in served
                ),
            }
        holdings.append(
            Holding(
                id=holding_pk,
                qr=qr_tag(holding_pk),
                **terms,
                ward_id=row["ward"],
                road_id=roads[(row["ward"], row["road"])],
                holding_no=row["holding"],
                holding_type_id=row["holdingType"],
                agency=agency,
                owner_name=row["head"],
                owner_phone=row["phone"],
                address=row["address"],
                lat=_coord(row.get("lat")),
                lng=_coord(row.get("lng")),
                accuracy=row["accuracy"],
                verified=row["verified"],
                verified_at=local_midnight(_date(row["verifiedAt"])) if row["verifiedAt"] else None,
                verified_by_id=row["verifiedBy"],
                status="active",
            )
        )
    Holding.objects.bulk_create(holdings, batch_size=BATCH)
    ids.reserve("holding", len(holdings))
    return lookup


def _profile_fields(
    row: dict, roads: dict[tuple[str, str], int], holdings: dict[tuple[str, str, str], str]
) -> dict:
    return {
        "holding_id": holdings[(row["ward"], row["road"], row["holding"])],
        "unit": row.get("unit", ""),
        "ward_id": row["ward"],
        "road_id": roads[(row["ward"], row["road"])],
        "holding_no": row["holding"],
        "head": row["head"],
        "phone": row["phone"],
        # No coordinates here any more: the pin belongs to the holding created
        # above, and these rows read it through.
        "customer_type_id": row["customerType"],
        "profession": row["profession"],
        "address": row["address"],
        "email": row["email"],
        "alt_phone": row["altPhone"],
        "contact_person": row["contactPerson"],
        "blood_group": row["bloodGroup"],
        "members": row["members"],
        "members_under5": row["membersUnder5"],
        "members_female": row["membersFemale"],
        "storage_id": row["storage"],
        "holding_type_id": row["holdingType"],
        "floor": row["floor"],
        "suitable_time_id": row["suitableTime"],
    }


def load_households(
    rows: list[dict],
    roads: dict[tuple[str, str], int],
    holdings: dict[tuple[str, str, str], str],
) -> None:
    """Load the families living in each holding — occupant records only."""
    Household.objects.bulk_create(
        (
            Household(
                id=row["id"],
                status=row["status"],
                **_profile_fields(row, roads, holdings),
            )
            for row in rows
        ),
        batch_size=BATCH,
    )


def load_potential_customers(
    rows: list[dict],
    roads: dict[tuple[str, str], int],
    holdings: dict[tuple[str, str, str], str],
) -> None:
    PotentialCustomer.objects.bulk_create(
        PotentialCustomer(
            id=row["id"],
            est_tier_id=row["estTier"],
            surveyed_at=_date(row["surveyedAt"]),
            surveyor_id=row["surveyor"],
            reason_id=row["reason"],
            time_gap_id=row["timeGap"],
            current_practice_id=row["currentPractice"],
            **_profile_fields(row, roads, holdings),
        )
        for row in rows
    )


# --------------------------------------------------------------------------- #
# Route plan and service history
# --------------------------------------------------------------------------- #


def _holdings_for(household_ids: list[str]) -> list[str]:
    """The buildings behind a list of households, in order and without repeats.

    The mock plans a round as a list of households, because that is what it had.
    The plan is holding-wise, so two flats of one building are one stop — the
    first occurrence keeps the position, which preserves the walking order.
    """
    by_household = dict(
        Household.objects.filter(pk__in=household_ids).values_list("id", "holding_id")
    )
    ordered, seen = [], set()
    for household_id in household_ids:
        holding_id = by_household.get(household_id)
        if holding_id is None or holding_id in seen:
            continue
        seen.add(holding_id)
        ordered.append(holding_id)
    return ordered


def load_plan(
    routes: list[dict], assignments: list[dict], effective_from: dt.date, agency: Agency
) -> None:
    Route.objects.bulk_create(
        Route(
            id=route["id"],
            name=route["name"],
            ward_id=route["ward"],
            agency=agency,
            window_start=route["window_start"],
            window_end=route["window_end"],
            active=route["active"],
        )
        for route in routes
    )
    RouteStop.objects.bulk_create(
        (
            # The generator lists stops as households; the plan is holding-wise,
            # so each is mapped to its building and repeats collapse.
            RouteStop(route_id=route["id"], holding_id=holding_id, seq=seq)
            for route in routes
            for seq, holding_id in enumerate(_holdings_for(route["stops"]), start=1)
        ),
        batch_size=BATCH,
    )
    Assignment.objects.bulk_create(
        Assignment(
            id=row["id"],
            collector_id=row["collector"],
            active=row["active"],
            effective_from=effective_from,
        )
        for row in assignments
    )
    AssignmentRoute.objects.bulk_create(
        AssignmentRoute(assignment_id=row["id"], route_id=route_id, seq=seq)
        for row in assignments
        for seq, route_id in enumerate(row["routes"], start=1)
    )


def _holding_of() -> dict[str, str]:
    """`{household id: holding id}` — how the per-family demo data is folded."""
    return dict(Household.objects.values_list("id", "holding_id"))


def load_visits(rows: list[dict], agency: Agency) -> None:
    """One visit per holding per day: a collected family wins over a skipped one."""
    holding_of = _holding_of()
    qr_of = dict(Holding.objects.values_list("id", "qr"))
    best: dict[tuple[str, dt.date], dict] = {}
    for row in rows:
        key = (holding_of[row["hh"]], row["served_on"])
        kept = best.get(key)
        if kept is None or (kept["status"] != "collected" and row["status"] == "collected"):
            best[key] = row
    Visit.objects.bulk_create(
        (
            Visit(
                id=row["id"],
                holding_id=holding_id,
                collector_id=row["collector"],
                agency=agency if row["collector"] else None,
                route_id=row["route"],
                qr=qr_of.get(holding_id) or "",
                status=row["status"],
                at=localize(row["at"]),
                served_on=row["served_on"],
                accuracy=row["accuracy"],
                source=row["source"],
                reason=row["reason"],
                synced=row["synced"],
            )
            for (holding_id, _day), row in best.items()
        ),
        batch_size=BATCH,
    )


# --------------------------------------------------------------------------- #
# Fleet
# --------------------------------------------------------------------------- #


def load_fleet() -> None:
    Van.objects.bulk_create(
        Van(
            id=row["id"],
            plate=row["plate"],
            type=row["type"],
            capacity=row["capacity"],
            fuel=row["fuel"],
            ownership=row["ownership"],
            gps=row["gps"],
            odometer=row["odometer"],
            status=row["status"],
            driver_id=row["driver"],
            fitness_exp=_date(row["fitnessExp"]),
            tax_exp=_date(row["taxExp"]),
            insurance_exp=_date(row["insuranceExp"]),
            permit_exp=_date(row["permitExp"]),
            next_service_km=row["nextServiceKm"],
            kmpl=None if row["kmpl"] is None else Decimal(str(row["kmpl"])),
        )
        for row in mock.VANS
    )
    Maintenance.objects.bulk_create(
        Maintenance(
            id=row["id"],
            van_id=row["van"],
            kind=row["kind"],
            reason=row["reason"],
            odometer=row["odometer"],
            opened=_stamp(row["opened"]),
            closed=_stamp(row["closed"]),
            downtime=Decimal(str(row["downtime"])),
            cost=row["cost"],
            vendor=row["vendor"],
        )
        for row in mock.MAINTENANCE
    )
    FuelLog.objects.bulk_create(
        FuelLog(
            id=row["id"],
            van_id=row["van"],
            litres=Decimal(str(row["litres"])),
            cost=row["cost"],
            odometer=row["odometer"],
            by_id=row["by"],
            at=_stamp(row["at"]),
            kmpl=Decimal(str(row["kmpl"])),
        )
        for row in mock.FUEL_LOGS
    )


def load_positions(rng, now: dt.datetime) -> None:
    """A recent GPS fix for every van that has a driver.

    The mock had no telemetry at all — LiveMap invented collector coordinates by
    nudging the ward centre, which is why the map looked alive on data that did
    not exist. Real positions belong in the database, so the demo seeds one
    plausible recent fix per crewed van: somewhere along its driver's own round,
    which is where the vehicle would actually be.

    An idle or workshop-bound van gets an older fix and its engine off, so the
    map's "last seen" and "live" states both have something to show.
    """
    stops_by_collector: dict[str, list[tuple[Decimal, Decimal]]] = {}
    routed = (
        Holding.objects.filter(
            route_stop__isnull=False,
            lat__isnull=False,
            route_stop__route__assignment_links__assignment__active=True,
        )
        .values_list(
            "route_stop__route__assignment_links__assignment__collector_id",
            "id", "lat", "lng",
        )
        .order_by("route_stop__route_id", "route_stop__seq")
    )
    for collector_id, _holding, lat, lng in routed:
        if collector_id:
            stops_by_collector.setdefault(collector_id, []).append((lat, lng))

    rows = []
    for van in Van.objects.select_related("driver").exclude(status=VanStatus.RETIRED):
        stops = stops_by_collector.get(van.driver_id or "", [])
        if not stops:
            continue
        # Part-way through the round, so the progress figures and the pin agree.
        lat, lng = stops[min(int(len(stops) * 0.6), len(stops) - 1)]
        working = van.status == VanStatus.ACTIVE
        rows.append(
            VehiclePosition(
                van=van,
                collector=van.driver,
                # A few metres off the stop: a vehicle waits on the road, not in
                # the yard.
                lat=lat + Decimal(str(round(rng.uniform(-0.0004, 0.0004), 6))),
                lng=lng + Decimal(str(round(rng.uniform(-0.0004, 0.0004), 6))),
                speed=Decimal(str(round(rng.uniform(0, 22), 2))) if working else Decimal("0"),
                heading=rng.randrange(0, 360),
                accuracy=rng.randrange(4, 13),
                ignition=working,
                at=now - dt.timedelta(minutes=rng.randrange(1, 6) if working else rng.randrange(45, 180)),
            )
        )
    VehiclePosition.objects.bulk_create(rows, batch_size=200)


# --------------------------------------------------------------------------- #
# Complaints
# --------------------------------------------------------------------------- #

#: Activity actions that stop the SLA clock, and the column each stamps.
_CLOSING_ACTIONS = {"resolved": "resolved_at", "closed": "closed_at"}


def load_complaints() -> None:
    """Complaints plus their full activity trail.

    `resolved_at` and `closed_at` did not exist in the mock; they are read off the
    activity entries, which is where the timeline drawer already showed them.
    """
    holding_of = _holding_of()
    complaints = []
    activity = []
    for row in mock.COMPLAINTS:
        stamps = {
            column: local(entry["at"])
            for entry in row["activity"]
            if (column := _CLOSING_ACTIONS.get(entry["action"]))
        }
        complaints.append(
            Complaint(
                id=row["id"],
                holding_id=holding_of[row["hh"]],
                household_id=row["hh"],
                ward_id=row["ward"],
                type=row["type"],
                channel=row["channel"],
                status=row["status"],
                priority=row["priority"],
                description=row["description"],
                assigned_id=row["assigned"],
                opened=local(row["opened"]),
                sla=SLA_HOURS[Priority(row["priority"])],
                **stamps,
            )
        )
        activity.extend(
            ComplaintActivity(
                complaint_id=row["id"],
                at=local(entry["at"]),
                action=entry["action"],
                actor=entry["by"],
                note=entry["note"],
            )
            for entry in row["activity"]
        )
    Complaint.objects.bulk_create(complaints)
    ComplaintActivity.objects.bulk_create(activity, batch_size=BATCH)


# --------------------------------------------------------------------------- #
# Billing
# --------------------------------------------------------------------------- #

#: A bill falls due ten days after it is issued.
DUE_AFTER = dt.timedelta(days=10)


def load_billing(
    bills: list[dict], payments: list[dict], deposits: list[dict], agency: Agency
) -> None:
    # The generated bills are per family; a month's family bills at one
    # building become that building's one bill.
    holding_of = _holding_of()
    merged: dict[tuple[str, str], dict] = {}
    bill_of: dict[str, str] = {}
    for row in bills:
        holding_id = holding_of[row["hh"]]
        key = (holding_id, row["period"])
        target = merged.get(key)
        if target is None:
            target = merged[key] = {
                "id": bill_id(row["period"], holding_id),
                "holding": holding_id,
                "ward": row["ward"],
                "period": row["period"],
                "issued_at": row["issued_at"],
                "amount": 0,
            }
        target["amount"] += row["amount"]
        target["issued_at"] = min(target["issued_at"], row["issued_at"])
        bill_of[row["id"]] = target["id"]
    holding_bills = list(merged.values())

    runs = _load_billing_runs(holding_bills)
    Bill.objects.bulk_create(
        (
            Bill(
                id=row["id"],
                holding_id=row["holding"],
                ward_id=row["ward"],
                run_id=runs[row["period"]],
                period=row["period"],
                issued_at=row["issued_at"],
                due_on=row["issued_at"] + DUE_AFTER,
                amount=row["amount"],
                status=BillStatus.UNPAID,
            )
            for row in holding_bills
        ),
        batch_size=BATCH,
    )
    # Deposits precede payments: a payment points at the hand-in that carried it.
    Deposit.objects.bulk_create(
        (
            Deposit(
                id=row["id"],
                collector_id=row["collector"],
                agency=agency,
                period=row["period"],
                method_id=row["method"],
                amount=row["amount"],
                at=localize(row["at"]),
                ref=row["ref"],
            )
            for row in deposits
        ),
        batch_size=BATCH,
    )
    Payment.objects.bulk_create(
        (
            Payment(
                id=row["id"],
                bill_id=bill_of[row["bill"]],
                holding_id=holding_of[row["hh"]],
                collector_id=row["collector"],
                agency=agency if row["collector"] else None,
                amount=row["amount"],
                method_id=row["method"],
                at=localize(row["at"]),
                deposit_id=row["deposit"],
            )
            for row in payments
        ),
        batch_size=BATCH,
    )


def _load_billing_runs(bills: list[dict]) -> dict[str, int]:
    totals: dict[str, dict] = {}
    for row in bills:
        run = totals.setdefault(
            row["period"], {"issued_on": row["issued_at"], "bill_count": 0, "total_amount": 0}
        )
        run["bill_count"] += 1
        run["total_amount"] += row["amount"]
    BillingRun.objects.bulk_create(
        BillingRun(period=period, **values) for period, values in totals.items()
    )
    return dict(BillingRun.objects.values_list("period", "id"))


def settle(today: dt.date) -> None:
    """Derive every bill's status and every holding's dues from the payment rows.

    This is `Bill.recalculate()` and `refresh_holding_dues()` for the whole table
    at once — two aggregates and two bulk updates, rather than the write and two
    aggregate queries per payment that saving each one individually would cost.
    """
    received = dict(
        Payment.objects.values_list("bill_id").annotate(total=Coalesce(Sum("amount"), 0))
    )
    # Latest payment per bill decides the "paid via" column. Scanning in date
    # order and letting later rows overwrite is cheaper than a window function.
    method_of: dict[str, str] = {}
    for bill_id, method_id in Payment.objects.order_by("at").values_list("bill_id", "method_id"):
        method_of[bill_id] = method_id

    dues: dict[str, int] = defaultdict(int)
    bills = list(Bill.objects.all())
    for bill in bills:
        paid = received.get(bill.id, 0)
        bill.status = _settlement(bill.amount, paid, bill.due_on, today)
        bill.method_id = method_of.get(bill.id)
        dues[bill.holding_id] += max(bill.amount - paid, 0)
    Bill.objects.bulk_update(bills, ["status", "method", "updated_at"], batch_size=BATCH)

    holdings = list(Holding.objects.all())
    for holding in holdings:
        holding.dues = dues.get(holding.id, 0)
    Holding.objects.bulk_update(holdings, ["dues", "updated_at"], batch_size=BATCH)


def _settlement(amount: int, received: int, due_on: dt.date | None, today: dt.date) -> str:
    """`Bill.settlement()`, inlined so it needs no query per bill."""
    if received >= amount:
        return BillStatus.PAID
    if received > 0:
        return BillStatus.PARTIAL
    if due_on and due_on < today:
        return BillStatus.OVERDUE
    return BillStatus.UNPAID


# --------------------------------------------------------------------------- #
# Logins
# --------------------------------------------------------------------------- #


def load_users() -> list[User]:
    """The four demo operators plus an admin-site superuser.

    Every operator gets the same password, which is what the login screen asks
    for. The PIN is still set so the (unused by the UI) PIN endpoints remain
    demonstrable.
    """
    created = []
    for row in mock.OPERATORS:
        user = User.objects.create_user(
            phone=row["phone"],
            name=row["name"],
            role=row["role"],
            password=mock.DEMO_PASSWORD,
            scope_kind=row["scope_kind"],
            scope_zone=row.get("scope_zone", ""),
            collector_id=row.get("collector"),
        )
        user.set_pin(mock.DEMO_PIN)
        user.save(update_fields=["pin_hash", "pin_set_at", "pin_attempts", "pin_locked_until"])
        if row.get("scope_wards"):
            user.scope_wards.set(row["scope_wards"])
        created.append(user)

    superuser = User.objects.create_superuser(
        mock.SUPERUSER_PHONE,
        name="Demo Superuser",
        password=mock.SUPERUSER_PASSWORD,
        scope_kind=ScopeKind.AGENCY,
    )
    created.append(superuser)
    return created


# --------------------------------------------------------------------------- #
# Id sequences
# --------------------------------------------------------------------------- #


def reserve_sequences(data: Dataset) -> None:
    """Push every counter past the ids just inserted, so nothing is re-issued."""
    ids.reserve("household", max(_tail(row["id"]) for row in data.households))
    ids.reserve("potential", max(_tail(row["id"]) for row in data.potential))
    ids.reserve("collector", max(_tail(row["id"]) for row in mock.COLLECTORS))
    ids.reserve("visit", len(data.visits))
    ids.reserve("complaint", max(_tail(row["id"]) for row in mock.COMPLAINTS))
    ids.reserve("van", max(_tail(row["id"]) for row in mock.VANS))
    ids.reserve("maintenance", max(_tail(row["id"]) for row in mock.MAINTENANCE))
    ids.reserve("fuel", max(_tail(row["id"]) for row in mock.FUEL_LOGS))
    # Assignment ids are `AS-<collector>`, so there is no number to skip past;
    # the row is still created so the counter starts from a known place.
    ids.reserve("assignment", 0)

    for ward, highest in _highest_by(data.routes, "ward").items():
        ids.reserve(f"route:{ward}", highest)
    for kind, rows in (("payment", data.payments), ("deposit", data.deposits)):
        for period, highest in _highest_by(rows, "period").items():
            ids.reserve(f"{kind}:{period}", highest)


def _highest_by(rows: list[dict], group: str) -> dict[str, int]:
    """Largest id number per group — route numbers run per ward, payments per month."""
    out: dict[str, int] = {}
    for row in rows:
        key = row[group]
        out[key] = max(out.get(key, 0), _tail(row["id"]))
    return out


def _tail(value: str) -> int:
    """The number at the end of an id: 'HH-KCC-0012840' -> 12840."""
    return int(value.rsplit("-", 1)[-1])
