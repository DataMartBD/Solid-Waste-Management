"""Report aggregates — the server-side port of src/utils/reports.js.

Every function returns plain dicts with the same keys the React tables already
render, so the Reports pages keep working. Aggregation happens in Postgres;
Python only assembles the results.

Where a figure differs from the mock, it is because the mock was guessing. Those
places are called out inline:

* `settlement` derives "overdue" from the bill's due date instead of trusting the
  stored status flag.
* the daily service series reports real invoiced and received money rather than a
  synthetic sine wave.
* estimated tonnage is labelled as an estimate, because nothing weighs the waste.
"""

from __future__ import annotations

import datetime as dt
import statistics
from collections import defaultdict

from django.db.models import CharField, Count, F, Q, Sum, Value
from django.db.models.functions import Coalesce
from django.utils import timezone

from swms.billing.models import Bill, Deposit, Payment
from swms.catalog.models import Ward, Zone
from swms.complaints.models import ACTIVE_STATUSES, Complaint
from swms.customers.models import Household, HoldingStatus, PotentialCustomer
from swms.fieldops.models import RouteStop, Visit, VisitStatus
from swms.fleet.models import Van, VanStatus

from . import periods
from .attribution import planned_owner_subquery, planned_owners

#: Khulna runs no round on Fridays, so Friday is not a scheduled service day.
#: Python's weekday(): Monday is 0, Friday is 4.
NON_WORKING_WEEKDAY = 4

#: Waste generated per collection, by customer type. Nothing on a rickshaw van
#: weighs anything, so tonnage is an ESTIMATE from these per-visit averages —
#: replace them with weighbridge readings when that data exists.
ESTIMATED_KG_PER_COLLECTION = {
    "residential": 4.5,
    "commercial": 12.0,
    "institutional": 18.0,
    "industrial": 30.0,
}
DEFAULT_KG_PER_COLLECTION = 5.0

BILL_STATES = ["paid", "partial", "unpaid", "overdue"]


def _pct(numerator, denominator) -> int:
    """Percentages are reported as whole numbers, as the UI formats them."""
    return round((numerator / denominator) * 100) if denominator else 0


#: How to reach an agency id from each model a report aggregates over.
#:
#: The ward path cannot be transformed into this mechanically — four different
#: models are scoped by a bare ``ward_id`` and each reaches its agency
#: differently — so the mapping is written out once, here, where it can be read
#: and checked in one place rather than repeated at thirty-odd call sites.
#:
#: `Visit`, `Payment` and `Deposit` carry the agency directly because it is
#: stamped when the row is written; everything else traverses to the holding,
#: which is what says who services a building.
#:
#: ``None`` means the model genuinely has no agency: wards and zones are the
#: city's own geography, shared by every contractor.
AGENCY_PATHS = {
    Bill: "household__holding__agency_id",
    Complaint: "household__holding__agency_id",
    Deposit: "agency_id",
    Household: "holding__agency_id",
    Payment: "agency_id",
    PotentialCustomer: "holding__agency_id",
    RouteStop: "holding__agency_id",
    Visit: "agency_id",
    Ward: None,
    Zone: None,
}


def _scoped(queryset, ward_ids, path="ward_id", *, agency_id=None):
    """Narrow a report queryset by ward and, for a tenant, by agency.

    The agency path is looked up from the queryset's own model rather than
    passed in, so a call site cannot quietly get it wrong. A model missing from
    `AGENCY_PATHS` raises: an unmapped model would otherwise be served
    unfiltered to a contractor, which is the one outcome worth crashing over.
    """
    if ward_ids is not None:
        queryset = queryset.filter(**{f"{path}__in": ward_ids})
    if agency_id is None:
        return queryset

    model = queryset.model
    if model not in AGENCY_PATHS:
        raise RuntimeError(
            f"{model.__name__} has no entry in AGENCY_PATHS, so it cannot be "
            "scoped to an agency. Add one before reporting on it."
        )
    agency_path = AGENCY_PATHS[model]
    if agency_path is None:
        return queryset
    return queryset.filter(**{agency_path: agency_id})


def _planned_households(ward_ids, agency_id=None):
    """Active families whose building is on a live round.

    Counted in families, not stops. Since the plan went holding-wise a stop is
    a *building*, so comparing stops with visits would divide a block's twelve
    collections by its one stop. Everything downstream compares this against
    `Visit` rows, which are one per family per day.
    """
    return _scoped(
        Household.objects.filter(
            status=HoldingStatus.ACTIVE,
            holding__route_stop__route__active=True,
        ),
        ward_ids,
        agency_id=agency_id,
    )


# --------------------------------------------------------------------------- #
# Service delivery
# --------------------------------------------------------------------------- #


def waste_collection(
    *,
    mode: str = periods.DAILY,
    ward_ids: list[str] | None = None,
    agency_id: str | None = None,
    date_from: dt.date | None = None,
    date_to: dt.date | None = None,
    collector: str | None = None,
) -> list[dict]:
    """Rounds walked per period and collector.

    `planned` is the number of holdings that collector owns in the plan — a
    standing figure, not multiplied by the days in the period. That is how the
    Reports page has always read it: at daily granularity `coverage` is a true
    percentage of the day's round, and at coarser granularity it becomes a
    multiple of it. Kept as-is so the numbers on screen do not shift.

    `covered` counts rounds this collector recorded on holdings that the plan
    assigned to somebody else — cover work made visible.
    """
    mode = periods.normalise_mode(mode)
    visits = _scoped(Visit.objects.all(), ward_ids, "household__ward_id", agency_id=agency_id)
    if date_from:
        visits = visits.filter(served_on__gte=date_from)
    if date_to:
        visits = visits.filter(served_on__lte=date_to)
    if collector:
        visits = visits.filter(collector_id=collector)

    bucket = periods.trunc("served_on", mode, date_field=True)

    # Served and skipped, grouped in the database.
    grouped = (
        visits.annotate(bucket=bucket)
        .values("bucket", "collector_id")
        .annotate(
            served=Count("id", filter=Q(status=VisitStatus.COLLECTED)),
            skipped=Count("id", filter=Q(status=VisitStatus.SKIPPED)),
        )
    )

    # Cover work: a second aggregate, so the planned-owner join cannot disturb
    # the counts above.
    cover = (
        visits.annotate(bucket=bucket, planned=planned_owner_subquery())
        .filter(planned__isnull=False)
        .exclude(planned=F("collector_id"))
        .values("bucket", "collector_id")
        .annotate(covered=Count("id"))
    )
    covered_by = {
        (periods.label(row["bucket"], mode), row["collector_id"]): row["covered"] for row in cover
    }

    planned_per_collector: dict[str, int] = defaultdict(int)
    for owner in planned_owners(ward_ids, agency_id).values():
        planned_per_collector[owner] += 1

    rows = []
    for row in grouped:
        period = periods.label(row["bucket"], mode)
        if period is None:
            continue
        actual = row["collector_id"]
        planned = planned_per_collector.get(actual, 0)
        served, skipped = row["served"], row["skipped"]
        rows.append(
            {
                "period": period,
                "collector": actual,
                "served": served,
                "skipped": skipped,
                "covered": covered_by.get((period, actual), 0),
                "planned": planned,
                "actioned": served + skipped,
                "coverage": _pct(served, planned),
            }
        )
    rows.sort(key=lambda r: (r["period"], str(r["collector"] or "")))
    return rows


def overall_by_period(rows: list[dict], fields: list[str]) -> list[dict]:
    """Collapse per-collector rows into one row per period."""
    out: dict[str, dict] = {}
    for row in rows:
        target = out.setdefault(row["period"], {"period": row["period"], **{f: 0 for f in fields}})
        for field in fields:
            target[field] += row.get(field) or 0
    return sorted(out.values(), key=lambda r: r["period"])


def service_series(
    *, days: int = 30, ward_ids: list[str] | None = None,
    agency_id: str | None = None, end: dt.date | None = None
) -> list[dict]:
    """Day-by-day service and money, oldest first.

    Replaces the mock's `dailyCollection`, which was a hand-rolled sine wave.
    `billed` is money actually invoiced that day and `collected` is money
    actually received, so at daily granularity you will see invoicing land in a
    spike at the start of the month. That is what really happens; the Reports page
    buckets the series up to weekly/monthly/yearly where the two line up.
    """
    end = end or timezone.localdate()
    start = end - dt.timedelta(days=days - 1)

    visits = _scoped(
        Visit.objects.filter(served_on__gte=start, served_on__lte=end),
        ward_ids,
        "household__ward_id", agency_id=agency_id)
    served_by_day = {
        row["served_on"]: row
        for row in visits.values("served_on").annotate(
            served=Count("id", filter=Q(status=VisitStatus.COLLECTED)),
            skipped=Count("id", filter=Q(status=VisitStatus.SKIPPED)),
        )
    }

    bills = _scoped(Bill.objects.filter(issued_at__gte=start, issued_at__lte=end), ward_ids, agency_id=agency_id)
    billed_by_day = {
        row["issued_at"]: row["billed"]
        for row in bills.values("issued_at").annotate(billed=Coalesce(Sum("amount"), 0))
    }

    payments = _scoped(
        Payment.objects.all(), ward_ids, "household__ward_id", agency_id=agency_id).filter(**_datetime_window("at", start, end))
    collected_by_day = {
        periods.label(row["day"], periods.DAILY): row["collected"]
        for row in payments.annotate(day=periods.trunc("at", periods.DAILY))
        .values("day")
        .annotate(collected=Coalesce(Sum("amount"), 0))
    }

    scheduled = _planned_households(ward_ids, agency_id).count()

    out = []
    for offset in range(days):
        day = start + dt.timedelta(days=offset)
        counts = served_by_day.get(day, {})
        out.append(
            {
                "date": day.isoformat(),
                # Kept as JS getDay() (0 = Sunday) because the UI labels weekdays
                # from this number.
                "dow": (day.weekday() + 1) % 7,
                "scheduled": 0 if day.weekday() == NON_WORKING_WEEKDAY else scheduled,
                "served": counts.get("served", 0),
                "skipped": counts.get("skipped", 0),
                "billed": billed_by_day.get(day, 0),
                "collected": collected_by_day.get(day.isoformat(), 0),
            }
        )
    return out


def _datetime_window(field: str, start: dt.date, end: dt.date) -> dict:
    tz = timezone.get_current_timezone()
    return {
        f"{field}__gte": timezone.make_aware(dt.datetime.combine(start, dt.time.min), tz),
        f"{field}__lt": timezone.make_aware(
            dt.datetime.combine(end + dt.timedelta(days=1), dt.time.min), tz
        ),
    }


def collection_trend(*, days: int = 7, ward_ids: list[str] | None = None,
    agency_id: str | None = None) -> list[dict]:
    """The dashboard's area chart: last `days` days with a weekday label."""
    series = service_series(days=days, ward_ids=ward_ids)
    names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    out = []
    for row in series:
        day = dt.date.fromisoformat(row["date"])
        out.append(
            {
                "day": names[day.weekday()],
                "date": row["date"],
                "scheduled": row["scheduled"],
                "collected": row["served"],
                "charge": row["collected"],
            }
        )
    return out


def waste_by_zone(*, period: str | None = None, ward_ids: list[str] | None = None,
    agency_id: str | None = None) -> list[dict]:
    """Estimated tonnage per zone for a month.

    Nothing weighs the waste, so this multiplies collected stops by the per-
    customer-type averages in ESTIMATED_KG_PER_COLLECTION. `estimated: True` is
    returned on every row so the UI can label it honestly.
    """
    period = period if periods.is_month(period) else periods.current_month()
    start, end = periods.month_bounds(period)
    visits = _scoped(
        Visit.objects.filter(
            status=VisitStatus.COLLECTED, served_on__gte=start, served_on__lte=end
        ),
        ward_ids,
        "household__ward_id", agency_id=agency_id)
    rows = visits.values(
        "household__ward__zone_id", "household__ward__zone__name", "household__customer_type_id"
    ).annotate(stops=Count("id"))

    totals: dict[tuple[str, str], float] = defaultdict(float)
    for row in rows:
        kg = ESTIMATED_KG_PER_COLLECTION.get(
            row["household__customer_type_id"], DEFAULT_KG_PER_COLLECTION
        )
        key = (row["household__ward__zone_id"], row["household__ward__zone__name"])
        totals[key] += row["stops"] * kg

    known = {zone.id: zone.name for zone in Zone.objects.all()}
    out = [
        {"zoneId": zone_id, "zone": name or known.get(zone_id, zone_id),
         "tonnes": round(kilos / 1000, 2), "estimated": True}
        for (zone_id, name), kilos in totals.items()
    ]
    return sorted(out, key=lambda r: r["zoneId"] or "")


def ward_collection(*, period: str | None = None, ward_ids: list[str] | None = None,
    agency_id: str | None = None) -> list[dict]:
    """Per-ward service and revenue for a month."""
    period = period if periods.is_month(period) else periods.current_month()
    start, end = periods.month_bounds(period)

    wards = _scoped(Ward.objects.filter(active=True), ward_ids, "id", agency_id=agency_id).select_related("zone")
    households = dict(
        _scoped(Household.objects.filter(status=HoldingStatus.ACTIVE), ward_ids, agency_id=agency_id)
        .values_list("ward_id")
        .annotate(total=Count("id"))
    )
    scheduled = dict(
        _planned_households(ward_ids, agency_id)
        .values_list("ward_id")
        .annotate(total=Count("id"))
    )
    served = dict(
        _scoped(
            Visit.objects.filter(
                status=VisitStatus.COLLECTED, served_on__gte=start, served_on__lte=end
            ),
            ward_ids,
            "household__ward_id", agency_id=agency_id)
        .values_list("household__ward_id")
        .annotate(total=Count("id"))
    )
    billed = dict(
        _scoped(Bill.objects.filter(period=period), ward_ids, agency_id=agency_id)
        .values_list("ward_id")
        .annotate(total=Coalesce(Sum("amount"), 0))
    )
    collected = dict(
        _scoped(Payment.objects.all(), ward_ids, "household__ward_id", agency_id=agency_id)
        .filter(**periods.month_range_filter("at", period))
        .values_list("household__ward_id")
        .annotate(total=Coalesce(Sum("amount"), 0))
    )

    return [
        {
            "ward": ward.id,
            "name": ward.name,
            "zone": ward.zone_id,
            "households": households.get(ward.id, 0),
            "scheduled": scheduled.get(ward.id, 0),
            "served": served.get(ward.id, 0),
            "billed": billed.get(ward.id, 0),
            "collected": collected.get(ward.id, 0),
        }
        for ward in wards
    ]


# --------------------------------------------------------------------------- #
# Revenue
# --------------------------------------------------------------------------- #


def _received_by_bill(bill_queryset) -> dict[str, int]:
    rows = (
        Payment.objects.filter(bill__in=bill_queryset)
        .values_list("bill_id")
        .annotate(total=Coalesce(Sum("amount"), 0))
    )
    return dict(rows)


def bill_collection(
    *,
    mode: str = periods.MONTHLY,
    ward_ids: list[str] | None = None,
    agency_id: str | None = None,
    period_from: str | None = None,
    period_to: str | None = None,
) -> list[dict]:
    """Money billed and money received per period and collector.

    A bill lands in the period it *covers*; a payment lands in the period it was
    *taken*. They deliberately need not match — a July bill settled in August is
    exactly the lag this report exists to surface.
    """
    mode = periods.normalise_mode(mode)
    bills = _scoped(Bill.objects.all(), ward_ids, agency_id=agency_id)
    if period_from:
        bills = bills.filter(period__gte=period_from)
    if period_to:
        bills = bills.filter(period__lte=period_to)

    rows: dict[tuple[str, str | None], dict] = {}

    def touch(period, collector):
        key = (period, collector)
        if key not in rows:
            rows[key] = {
                "period": period,
                "collector": collector,
                "billed": 0,
                "received": 0,
                "bills": 0,
            }
        return rows[key]

    for row in (
        bills.annotate(planned=planned_owner_subquery())
        .values("period", "issued_at", "planned")
        .annotate(billed=Coalesce(Sum("amount"), 0), count=Count("id"))
    ):
        period = periods.bill_label(row["period"], row["issued_at"], mode)
        if period is None:
            continue
        target = touch(period, row["planned"])
        target["billed"] += row["billed"]
        target["bills"] += row["count"]

    payments = _scoped(Payment.objects.all(), ward_ids, "household__ward_id", agency_id=agency_id)
    if period_from:
        payments = payments.filter(bill__period__gte=period_from)
    if period_to:
        payments = payments.filter(bill__period__lte=period_to)

    for row in (
        payments.annotate(bucket=periods.trunc("at", mode), planned=planned_owner_subquery())
        # Money is credited to whoever took it; the plan is only a fallback.
        # The output field is explicit because the FK column and the subquery
        # resolve to different types, which Django refuses to guess between.
        .annotate(owner=Coalesce("collector_id", "planned", output_field=CharField()))
        .values("bucket", "owner")
        .annotate(received=Coalesce(Sum("amount"), 0))
    ):
        period = periods.label(row["bucket"], mode)
        if period is None:
            continue
        touch(period, row["owner"])["received"] += row["received"]

    out = []
    for row in rows.values():
        out.append(
            {
                **row,
                "outstanding": max(row["billed"] - row["received"], 0),
                "rate": _pct(row["received"], row["billed"]),
            }
        )
    out.sort(key=lambda r: (r["period"], str(r["collector"] or "")))
    return out


def _settlement(amount: int, received: int, due_on: dt.date | None, today: dt.date) -> str:
    """Derive a bill's state from money actually received.

    The mock read "overdue" off the bill's stored status flag; here it comes from
    the due date, so a bill cannot claim to be current after its deadline has
    passed.
    """
    if received >= amount and amount > 0:
        return "paid"
    if received > 0:
        return "partial"
    if due_on and due_on < today:
        return "overdue"
    return "unpaid"


def bill_status(*, period: str | None = None, ward_ids: list[str] | None = None,
    agency_id: str | None = None) -> list[dict]:
    """Paid / partial / unpaid / overdue counts for one billing month, per collector."""
    today = timezone.localdate()
    bills = _scoped(Bill.objects.all(), ward_ids, agency_id=agency_id)
    if period:
        bills = bills.filter(period=period)

    rows: dict[str | None, dict] = {}
    scoped = bills.annotate(
        planned=planned_owner_subquery(),
        paid=Coalesce(Sum("payments__amount"), Value(0)),
    ).values("id", "amount", "due_on", "planned", "paid")

    for row in scoped:
        collector = row["planned"]
        target = rows.setdefault(
            collector,
            {
                "collector": collector,
                "bills": 0,
                "billed": 0,
                "received": 0,
                **{state: 0 for state in BILL_STATES},
            },
        )
        received = row["paid"] or 0
        target["bills"] += 1
        target[_settlement(row["amount"], received, row["due_on"], today)] += 1
        target["billed"] += row["amount"]
        target["received"] += received

    out = [
        {
            **row,
            "outstanding": max(row["billed"] - row["received"], 0),
            "rate": _pct(row["received"], row["billed"]),
        }
        for row in rows.values()
    ]
    out.sort(key=lambda r: str(r["collector"] or ""))
    return out


def customer_collection(
    *,
    mode: str = periods.MONTHLY,
    ward_ids: list[str] | None = None,
    agency_id: str | None = None,
    period_from: str | None = None,
    period_to: str | None = None,
    household: str | None = None,
) -> list[dict]:
    """Billed and received per household, per period.

    The per-collector view answers "is my team collecting?". This one answers
    "who has not paid?" — the list a ward office actually acts on.
    """
    mode = periods.normalise_mode(mode)
    bills = _scoped(Bill.objects.all(), ward_ids, agency_id=agency_id)
    payments = _scoped(Payment.objects.all(), ward_ids, "household__ward_id", agency_id=agency_id)
    if period_from:
        bills, payments = bills.filter(period__gte=period_from), payments.filter(
            bill__period__gte=period_from
        )
    if period_to:
        bills, payments = bills.filter(period__lte=period_to), payments.filter(
            bill__period__lte=period_to
        )
    if household:
        bills, payments = bills.filter(household_id=household), payments.filter(
            household_id=household
        )

    rows: dict[tuple[str, str], dict] = {}

    def touch(period, hh, meta):
        key = (period, hh)
        if key not in rows:
            rows[key] = {
                "period": period,
                "hh": hh,
                "head": meta.get("head") or hh,
                "ward": meta.get("ward"),
                "road": meta.get("road"),
                "holding": meta.get("holding"),
                "billed": 0,
                "received": 0,
                "bills": 0,
                "payments": 0,
            }
        return rows[key]

    for row in bills.values(
        "period",
        "issued_at",
        "household_id",
        "household__head",
        "household__ward_id",
        "household__road__name",
        "household__holding_no",
    ).annotate(billed=Coalesce(Sum("amount"), 0), count=Count("id")):
        period = periods.bill_label(row["period"], row["issued_at"], mode)
        if period is None:
            continue
        target = touch(
            period,
            row["household_id"],
            {
                "head": row["household__head"],
                "ward": row["household__ward_id"],
                "road": row["household__road__name"],
                "holding": row["household__holding_no"],
            },
        )
        target["billed"] += row["billed"]
        target["bills"] += row["count"]

    for row in (
        payments.annotate(bucket=periods.trunc("at", mode))
        .values(
            "bucket",
            "household_id",
            "household__head",
            "household__ward_id",
            "household__road__name",
            "household__holding_no",
        )
        .annotate(received=Coalesce(Sum("amount"), 0), count=Count("id"))
    ):
        period = periods.label(row["bucket"], mode)
        if period is None:
            continue
        target = touch(
            period,
            row["household_id"],
            {
                "head": row["household__head"],
                "ward": row["household__ward_id"],
                "road": row["household__road__name"],
                "holding": row["household__holding_no"],
            },
        )
        target["received"] += row["received"]
        target["payments"] += row["count"]

    out = [
        {
            **row,
            "outstanding": max(row["billed"] - row["received"], 0),
            "rate": _pct(row["received"], row["billed"]),
        }
        for row in rows.values()
    ]
    out.sort(key=lambda r: (r["period"], str(r["hh"])))
    return out


def customer_bill_status(
    *, period: str | None = None, ward_ids: list[str] | None = None,
    agency_id: str | None = None
) -> list[dict]:
    """One row per bill, with its settlement state derived from real payments.

    `methods` is a list because a bill can be settled in instalments through
    different channels — part cash at the gate, the rest by bKash. Reporting only
    the first would misstate how the money arrived.
    """
    today = timezone.localdate()
    bills = _scoped(Bill.objects.select_related("household", "household__road"), ward_ids, agency_id=agency_id)
    if period:
        bills = bills.filter(period=period)
    bills = bills.annotate(planned=planned_owner_subquery())

    payment_rows = Payment.objects.filter(bill__in=bills).values_list(
        "bill_id", "method_id", "amount", "at"
    )
    by_bill: dict[str, list] = defaultdict(list)
    for bill_id, method, amount, at in payment_rows:
        by_bill[bill_id].append((method, amount, at))

    out = []
    for bill in bills:
        entries = sorted(by_bill.get(bill.id, []), key=lambda row: row[2])
        received = sum(amount for _, amount, _ in entries)
        methods = list(dict.fromkeys(method for method, _, _ in entries if method))
        household = bill.household
        out.append(
            {
                "bill": bill.id,
                "period": bill.period,
                "hh": bill.household_id,
                "head": household.head,
                "ward": household.ward_id,
                "road": household.road.name if household.road_id else None,
                "holding": household.holding_no,
                "collector": bill.planned,
                "billed": bill.amount,
                "received": received,
                "outstanding": max(bill.amount - received, 0),
                "state": _settlement(bill.amount, received, bill.due_on, today),
                "methods": methods,
                "method": methods[0] if methods else None,
                "instalments": len(entries),
            }
        )
    out.sort(key=lambda r: str(r["hh"]))
    return out


def totals_of(rows: list[dict], fields: tuple[str, ...] = ("billed", "received", "outstanding")) -> dict:
    """Footer totals, computed from the same rows on screen so they cannot drift."""
    out = {field: 0 for field in fields}
    for row in rows:
        for field in fields:
            out[field] += row.get(field) or 0
    out["rate"] = _pct(out.get("received", 0), out.get("billed", 0))
    out["count"] = len(rows)
    return out


def state_tally(rows: list[dict]) -> dict:
    tally = {state: 0 for state in BILL_STATES}
    for row in rows:
        if row.get("state") in tally:
            tally[row["state"]] += 1
    return tally


# --------------------------------------------------------------------------- #
# Reconciliation
# --------------------------------------------------------------------------- #


def reconciliation(*, period: str | None = None, ward_ids: list[str] | None = None,
    agency_id: str | None = None) -> dict:
    """Service against revenue, and cash taken against cash handed in.

    Two questions in one report:

    1. Was every holding we billed actually served, and every holding we served
       actually billed? The mismatches are where revenue leaks and where a
       household's complaint will be justified.
    2. What did each collector take in versus hand over? A shortfall here is a
       different problem from an unpaid bill.
    """
    period = period if periods.is_month(period) else periods.current_month()
    start, end = periods.month_bounds(period)
    owner = planned_owners(ward_ids, agency_id)

    bills = _scoped(Bill.objects.filter(period=period), ward_ids, agency_id=agency_id)
    payments = _scoped(Payment.objects.all(), ward_ids, "household__ward_id", agency_id=agency_id).filter(
        **periods.month_range_filter("at", period)
    )
    visits = _scoped(
        Visit.objects.filter(served_on__gte=start, served_on__lte=end),
        ward_ids,
        "household__ward_id", agency_id=agency_id)
    deposits = Deposit.objects.filter(period=period)
    if ward_ids is not None:
        # Deposits belong to a collector, not a ward; scope by the collector's ward.
        deposits = deposits.filter(collector__ward_id__in=ward_ids)
    if agency_id is not None:
        # …but the agency is stamped on the row, so it needs no such detour.
        deposits = deposits.filter(agency_id=agency_id)

    served_households = set(
        visits.filter(status=VisitStatus.COLLECTED).values_list("household_id", flat=True)
    )
    billed_households = set(bills.values_list("household_id", flat=True))
    paid_households = set(payments.values_list("household_id", flat=True))

    billed_total = bills.aggregate(total=Coalesce(Sum("amount"), 0))["total"]
    received_total = payments.aggregate(total=Coalesce(Sum("amount"), 0))["total"]
    stop_counts = visits.aggregate(
        served=Count("id", filter=Q(status=VisitStatus.COLLECTED)),
        skipped=Count("id", filter=Q(status=VisitStatus.SKIPPED)),
    )

    labels = dict(
        Household.objects.filter(
            id__in=served_households | billed_households | paid_households
        ).values_list("id", "head")
    )

    def describe(ids):
        return [{"id": hh, "head": labels.get(hh, hh)} for hh in sorted(ids)]

    service = {
        "period": period,
        "holdingsServed": len(served_households),
        "holdingsBilled": len(billed_households),
        "stopsServed": stop_counts["served"],
        "stopsSkipped": stop_counts["skipped"],
        "billed": billed_total,
        "received": received_total,
        "outstanding": max(billed_total - received_total, 0),
        "rate": _pct(received_total, billed_total),
    }

    exceptions = {
        # Served but never invoiced — revenue we simply did not ask for.
        "servedNotBilled": describe(served_households - billed_households),
        # Invoiced with no service on record — the household has grounds to dispute.
        "billedNotServed": describe(billed_households - served_households),
        # Money taken with no service on record — worth a second look.
        "paidNotServed": describe(paid_households - served_households),
    }

    cash: dict[str | None, dict] = {}

    def cash_row(collector):
        if collector not in cash:
            cash[collector] = {
                "collector": collector,
                "collected": 0,
                "deposited": 0,
                "byMethod": {},
            }
        return cash[collector]

    for row in payments.values("collector_id", "household_id", "method_id").annotate(
        total=Coalesce(Sum("amount"), 0)
    ):
        collector = row["collector_id"] or owner.get(row["household_id"])
        target = cash_row(collector)
        target["collected"] += row["total"]
        method = row["method_id"]
        target["byMethod"][method] = target["byMethod"].get(method, 0) + row["total"]

    for row in deposits.values("collector_id").annotate(total=Coalesce(Sum("amount"), 0)):
        cash_row(row["collector_id"])["deposited"] += row["total"]

    cash_rows = sorted(
        (
            {**row, "variance": row["collected"] - row["deposited"]}
            for row in cash.values()
        ),
        key=lambda r: str(r["collector"] or ""),
    )
    cash_totals = {
        "collected": sum(row["collected"] for row in cash_rows),
        "deposited": sum(row["deposited"] for row in cash_rows),
        "variance": sum(row["variance"] for row in cash_rows),
    }

    return {
        "service": service,
        "exceptions": exceptions,
        "cash": cash_rows,
        "cashTotals": cash_totals,
    }


# --------------------------------------------------------------------------- #
# Headline figures
# --------------------------------------------------------------------------- #


def kpis(*, period: str | None = None, ward_ids: list[str] | None = None,
    agency_id: str | None = None) -> dict:
    """The scorecard on the Dashboard and the Reports KPI tab.

    Every figure is derived; the mock hard-coded all six.
    """
    period = period if periods.is_month(period) else periods.current_month()
    start, end = periods.month_bounds(period)
    today = timezone.localdate()

    visits = _scoped(
        Visit.objects.filter(served_on__gte=start, served_on__lte=end),
        ward_ids,
        "household__ward_id", agency_id=agency_id)
    counts = visits.aggregate(
        served=Count("id", filter=Q(status=VisitStatus.COLLECTED)),
        actioned=Count("id"),
    )

    # Scheduled stop-days: the standing round multiplied by the service days that
    # have actually happened in the period so far.
    stops = _planned_households(ward_ids, agency_id).count()
    last_day = min(end, today)
    service_days = sum(
        1
        for offset in range((last_day - start).days + 1)
        if (start + dt.timedelta(days=offset)).weekday() != NON_WORKING_WEEKDAY
    )
    scheduled = stops * service_days

    bills = _scoped(Bill.objects.filter(period=period), ward_ids, agency_id=agency_id)
    billed = bills.aggregate(total=Coalesce(Sum("amount"), 0))["total"]
    received = (
        _scoped(Payment.objects.all(), ward_ids, "household__ward_id", agency_id=agency_id)
        .filter(**periods.month_range_filter("at", period))
        .aggregate(total=Coalesce(Sum("amount"), 0))["total"]
    )

    active_households = _scoped(
        Household.objects.filter(status=HoldingStatus.ACTIVE), ward_ids, agency_id=agency_id).count()
    # "Covered" means the family's *building* is on a round — the plan is
    # holding-wise, so a stop covers every flat behind that door.
    covered_households = _scoped(
        Household.objects.filter(
            status=HoldingStatus.ACTIVE, holding__route_stop__isnull=False
        ),
        ward_ids, agency_id=agency_id).count()

    vans = Van.objects.exclude(status=VanStatus.RETIRED)
    if agency_id is not None:
        # Fleet readiness means *my* fleet; the city total is not a tenant's
        # business and would otherwise sail through untouched.
        vans = vans.filter(agency_id=agency_id)
    fleet_total = vans.count()
    fleet_active = vans.filter(status=VanStatus.ACTIVE).count()

    return {
        "period": period,
        "collectionEfficiency": _pct(counts["served"], scheduled),
        "chargeRate": _pct(received, billed),
        "coverage": _pct(covered_households, active_households),
        "complaintMedianH": complaint_resolution_median(
            period=period, ward_ids=ward_ids, agency_id=agency_id
        ),
        "onTimeCompletion": on_time_completion(
            period=period, ward_ids=ward_ids, agency_id=agency_id
        ),
        "fleetAvailability": _pct(fleet_active, fleet_total),
        # Denominators, so the UI can show "1,240 of 1,330" rather than just a %.
        "servedStops": counts["served"],
        "scheduledStops": scheduled,
        "billed": billed,
        "received": received,
        "activeHouseholds": active_households,
        "coveredHouseholds": covered_households,
    }


def on_time_completion(*, period: str | None = None, ward_ids: list[str] | None = None,
    agency_id: str | None = None) -> int:
    """Share of collections recorded inside their route's time window.

    The comparison is a local time-of-day against a per-row window, which SQL
    makes awkward and unreadable, so only the three columns needed are pulled and
    the check is done here. The query is always bounded to one month and one ward
    scope, which keeps that cheap.
    """
    period = period if periods.is_month(period) else periods.current_month()
    start, end = periods.month_bounds(period)
    visits = _scoped(
        Visit.objects.filter(
            status=VisitStatus.COLLECTED,
            served_on__gte=start,
            served_on__lte=end,
            route__isnull=False,
        ),
        ward_ids,
        "household__ward_id", agency_id=agency_id).values_list("at", "route__window_start", "route__window_end")

    total = on_time = 0
    for at, window_start, window_end in visits:
        total += 1
        clock = timezone.localtime(at).time()
        if window_start <= clock <= window_end:
            on_time += 1
    return _pct(on_time, total)


def complaint_resolution_median(
    *, period: str | None = None, ward_ids: list[str] | None = None,
    agency_id: str | None = None
) -> int:
    """Median hours from opening to resolution, for complaints closed out in the month."""
    period = period if periods.is_month(period) else periods.current_month()
    rows = _scoped(
        Complaint.objects.filter(resolved_at__isnull=False), ward_ids, agency_id=agency_id).filter(**periods.month_range_filter("resolved_at", period)).values_list(
        "opened", "resolved_at"
    )
    hours = [(resolved - opened).total_seconds() / 3600 for opened, resolved in rows]
    return round(statistics.median(hours)) if hours else 0


def complaint_summary(*, period: str | None = None, ward_ids: list[str] | None = None,
    agency_id: str | None = None) -> dict:
    """Counts by status, priority and type, plus how many have breached SLA."""
    complaints = _scoped(Complaint.objects.all(), ward_ids, agency_id=agency_id)
    if periods.is_month(period):
        complaints = complaints.filter(**periods.month_range_filter("opened", period))

    def tally(field):
        return {
            row[field]: row["total"]
            for row in complaints.values(field).annotate(total=Count("id"))
        }

    now = timezone.now()
    breached = 0
    for opened, sla in complaints.filter(status__in=ACTIVE_STATUSES).values_list("opened", "sla"):
        if (now - opened).total_seconds() / 3600 > (sla or 0):
            breached += 1

    return {
        "byStatus": tally("status"),
        "byPriority": tally("priority"),
        "byType": tally("type"),
        "total": complaints.count(),
        "active": complaints.filter(status__in=ACTIVE_STATUSES).count(),
        "breached": breached,
        "medianResolutionHours": complaint_resolution_median(
            period=period, ward_ids=ward_ids, agency_id=agency_id
        ),
    }


def customer_funnel(*, ward_ids: list[str] | None = None,
    agency_id: str | None = None) -> dict:
    """Survey-to-customer conversion.

    Only possible because converted survey rows are kept rather than deleted —
    the mock threw the survey away on conversion and lost this entirely.
    """
    from swms.customers.models import PotentialCustomer

    surveys = _scoped(PotentialCustomer.objects.all(), ward_ids, agency_id=agency_id)
    total = surveys.count()
    converted = surveys.filter(converted_at__isnull=False).count()
    by_reason = {
        row["reason_id"]: row["total"]
        for row in surveys.filter(converted_at__isnull=True)
        .values("reason_id")
        .annotate(total=Count("id"))
    }
    pending_value = (
        surveys.filter(converted_at__isnull=True)
        .aggregate(total=Coalesce(Sum("est_tier__charge"), 0))["total"]
    )
    return {
        "surveyed": total,
        "converted": converted,
        "pending": total - converted,
        "conversionRate": _pct(converted, total),
        "byReason": by_reason,
        "monthlyValueAtStake": pending_value,
    }
