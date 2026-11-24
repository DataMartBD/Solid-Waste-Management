"""Report endpoints.

Every report is a GET that returns JSON by default and a file when
`?format=csv|xlsx|pdf` is supplied — the same rows either way, so an exported
sheet can never disagree with the screen it came from.

All of them are ward-scoped to the caller. A ward supervisor asking for the
reconciliation report gets their wards; an agency admin or KCC viewer gets the
city. That scoping is applied here rather than trusted from a query parameter.
"""

from __future__ import annotations

import datetime as dt

from django.utils import timezone
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from swms.common.exceptions import DomainError
from swms.common.permissions import IsCityViewerOrSuperAdmin, IsNotCityViewer, SeesMoney, sees_money

from . import aggregates, city as city_report, periods
from .exports import FORMATS, Column, columns_from, export

# --------------------------------------------------------------------------- #
# Request parsing
# --------------------------------------------------------------------------- #


def _ward_scope(request):
    """The wards this caller may see; None means city-wide."""
    return request.user.visible_ward_ids()


def _agency_scope(request):
    """The agency this caller is confined to; None means every contractor.

    Reports used to refuse an agency account outright, because each aggregate
    scopes by its own ward path and one blanket filter could not express the
    agency equivalent. `aggregates.AGENCY_PATHS` now states the path per
    model, so every report can be narrowed honestly instead.
    """
    own = request.user.visible_agency_id()
    if own is not None:
        return own
    # A super admin may narrow any report to one agency (the report pages'
    # agency picker); everyone else is already fixed to theirs, or to none.
    wanted = request.query_params.get("agency")
    if wanted and (request.user.is_superuser or request.user.role == "super_admin"):
        from swms.agencies.models import Agency

        if not Agency.objects.filter(pk=wanted).exists():
            raise DomainError(f"No agency {wanted}.", code="no_agency")
        return wanted
    return None


def _mode(request, default=periods.MONTHLY) -> str:
    return periods.normalise_mode(request.query_params.get("mode") or default)


def _period(request, *, required=False) -> str | None:
    value = request.query_params.get("period")
    if value and not periods.is_month(value):
        raise DomainError("`period` must look like 2026-07.", code="bad_period")
    if not value and required:
        return periods.current_month()
    return value


def _date(request, name: str) -> dt.date | None:
    value = request.query_params.get(name)
    if not value:
        return None
    try:
        return dt.date.fromisoformat(value)
    except ValueError as exc:
        raise DomainError(f"`{name}` must look like 2026-07-27.", code="bad_date") from exc


def _int(request, name: str, default: int, *, low: int = 1, high: int = 3650) -> int:
    raw = request.query_params.get(name)
    if raw is None:
        return default
    try:
        value = int(raw)
    except ValueError as exc:
        raise DomainError(f"`{name}` must be a whole number.", code="bad_number") from exc
    return max(low, min(value, high))


def _flag(request, name: str) -> bool:
    return str(request.query_params.get(name, "")).lower() in {"1", "true", "yes"}


def _fmt(request) -> str | None:
    value = (request.query_params.get("format") or "").lower()
    if not value:
        return None
    if value not in FORMATS:
        raise DomainError(f"`format` must be one of {', '.join(FORMATS)}.", code="bad_format")
    return value


#: Row keys that are money, dropped for an account that is not shown money.
MONEY_KEYS = {"billed", "collected", "received", "charge", "chargeRate", "monthlyValueAtStake"}


def _no_money(request, rows, columns=None):
    """Strip money from rows (and export columns) for the City Viewer."""
    if sees_money(request.user):
        return rows, columns
    rows = [{k: v for k, v in row.items() if k not in MONEY_KEYS} for row in rows]
    if columns is not None:
        columns = [c for c in columns if c.key not in MONEY_KEYS]
    return rows, columns


def _no_money_one(request, data):
    if sees_money(request.user) or not isinstance(data, dict):
        return data
    return {k: v for k, v in data.items() if k not in MONEY_KEYS}


def _respond(request, *, title: str, columns, rows, extra: dict | None = None, subtitle: str = ""):
    """Return rows as JSON, or as a file when an export format was requested."""
    fmt = _fmt(request)
    if fmt:
        return export(fmt, title, columns, rows, subtitle=subtitle or _scope_note(request))
    body = {"rows": rows, "count": len(rows)}
    if extra:
        body.update(extra)
    return Response(body)


def _scope_note(request) -> str:
    wards = _ward_scope(request)
    where = "City-wide" if wards is None else f"Wards: {', '.join(sorted(wards))}"
    return f"{where} · generated {dt.datetime.now():%Y-%m-%d %H:%M} · {request.user.name}"


# --------------------------------------------------------------------------- #
# Service delivery
# --------------------------------------------------------------------------- #

WASTE_COLUMNS = columns_from(
    [
        ("period", "Period"),
        ("collector", "Collector"),
        ("planned", "Planned stops"),
        ("served", "Served"),
        ("skipped", "Skipped"),
        ("actioned", "Actioned"),
        ("covered", "Cover work"),
        ("coverage", "Coverage %"),
    ]
)


@extend_schema(
    parameters=[
        OpenApiParameter("mode", str, description="daily | weekly | monthly | yearly"),
        OpenApiParameter("from", str, description="Start date, YYYY-MM-DD"),
        OpenApiParameter("to", str, description="End date, YYYY-MM-DD"),
        OpenApiParameter("collector", str),
        OpenApiParameter("overall", bool, description="Collapse to one row per period"),
        OpenApiParameter("format", str, description="csv | xlsx | pdf"),
    ]
)
@extend_schema(responses=OpenApiTypes.OBJECT)
@api_view(["GET"])
@permission_classes([IsAuthenticated])
def waste_collection(request):
    """Rounds walked per period and collector, with cover work called out."""
    mode = _mode(request, periods.DAILY)
    rows = aggregates.waste_collection(
        mode=mode,
        ward_ids=_ward_scope(request),
        agency_id=_agency_scope(request),
        date_from=_date(request, "from"),
        date_to=_date(request, "to"),
        collector=request.query_params.get("collector") or None,
    )
    columns = WASTE_COLUMNS
    if _flag(request, "overall"):
        rows = aggregates.overall_by_period(
            rows, ["planned", "served", "skipped", "actioned", "covered"]
        )
        for row in rows:
            row["coverage"] = round((row["served"] / row["planned"]) * 100) if row["planned"] else 0
        columns = [column for column in WASTE_COLUMNS if column.key != "collector"]
    return _respond(
        request, title="Waste collection", columns=columns, rows=rows, extra={"mode": mode}
    )


@extend_schema(responses=OpenApiTypes.OBJECT)
@api_view(["GET"])
@permission_classes([IsAuthenticated])
def service_series(request):
    """Day-by-day scheduled / served / billed / collected."""
    rows = aggregates.service_series(
        days=_int(request, "days", 30, high=730),
        ward_ids=_ward_scope(request),
        agency_id=_agency_scope(request),
        end=_date(request, "end"),
    )
    rows, columns = _no_money(request, rows, columns_from(
        [
            ("date", "Date"),
            ("scheduled", "Scheduled"),
            ("served", "Served"),
            ("skipped", "Skipped"),
            ("billed", "Billed (BDT)"),
            ("collected", "Collected (BDT)"),
        ]
    ))
    return _respond(request, title="Service collection", columns=columns, rows=rows)


@extend_schema(responses=OpenApiTypes.OBJECT)
@api_view(["GET"])
@permission_classes([IsAuthenticated])
def ward_collection(request):
    """Per-ward service and revenue for a month."""
    rows = aggregates.ward_collection(period=_period(request, required=True), ward_ids=_ward_scope(request),
        agency_id=_agency_scope(request))
    rows, columns = _no_money(request, rows, columns_from(
        [
            ("ward", "Ward"),
            ("name", "Name"),
            ("holdings", "Holdings"),
            ("households", "Households"),
            ("scheduled", "Scheduled holdings"),
            ("served", "Served"),
            ("billed", "Billed (BDT)"),
            ("collected", "Collected (BDT)"),
        ]
    ))
    return _respond(request, title="Ward collection", columns=columns, rows=rows)


# --------------------------------------------------------------------------- #
# Revenue
# --------------------------------------------------------------------------- #


@extend_schema(responses=OpenApiTypes.OBJECT)
@api_view(["GET"])
@permission_classes([IsAuthenticated, SeesMoney])
def bill_collection(request):
    """Money billed against money received, per period and collector."""
    mode = _mode(request)
    rows = aggregates.bill_collection(
        mode=mode,
        ward_ids=_ward_scope(request),
        agency_id=_agency_scope(request),
        period_from=request.query_params.get("from") or None,
        period_to=request.query_params.get("to") or None,
    )
    columns = columns_from(
        [
            ("period", "Period"),
            ("collector", "Collector"),
            ("bills", "Bills"),
            ("billed", "Billed (BDT)"),
            ("received", "Received (BDT)"),
            ("outstanding", "Outstanding (BDT)"),
            ("rate", "Rate %"),
        ]
    )
    if _flag(request, "overall"):
        rows = aggregates.overall_by_period(rows, ["bills", "billed", "received", "outstanding"])
        for row in rows:
            row["rate"] = round((row["received"] / row["billed"]) * 100) if row["billed"] else 0
        columns = [column for column in columns if column.key != "collector"]
    return _respond(
        request,
        title="Bill collection",
        columns=columns,
        rows=rows,
        extra={"mode": mode, "totals": aggregates.totals_of(rows)},
    )


@extend_schema(responses=OpenApiTypes.OBJECT)
@api_view(["GET"])
@permission_classes([IsAuthenticated, SeesMoney])
def bill_status(request):
    """Paid / partial / unpaid / overdue counts for a billing month, per collector."""
    period = _period(request, required=True)
    rows = aggregates.bill_status(period=period, ward_ids=_ward_scope(request),
        agency_id=_agency_scope(request))
    return _respond(
        request,
        title="Bill status",
        columns=columns_from(
            [
                ("collector", "Collector"),
                ("bills", "Bills"),
                ("paid", "Paid"),
                ("partial", "Partial"),
                ("unpaid", "Unpaid"),
                ("overdue", "Overdue"),
                ("billed", "Billed (BDT)"),
                ("received", "Received (BDT)"),
                ("outstanding", "Outstanding (BDT)"),
                ("rate", "Rate %"),
            ]
        ),
        rows=rows,
        extra={"period": period, "totals": aggregates.totals_of(rows)},
    )


@extend_schema(responses=OpenApiTypes.OBJECT)
@api_view(["GET"])
@permission_classes([IsAuthenticated, SeesMoney])
def customer_collection(request):
    """Billed and received per holding — the "who has not paid" list."""
    mode = _mode(request)
    rows = aggregates.customer_collection(
        mode=mode,
        ward_ids=_ward_scope(request),
        agency_id=_agency_scope(request),
        period_from=request.query_params.get("from") or None,
        period_to=request.query_params.get("to") or None,
        holding=request.query_params.get("holding") or None,
    )
    return _respond(
        request,
        title="Customer collection",
        columns=columns_from(
            [
                ("period", "Period"),
                ("holding", "Holding ID"),
                ("holdingNo", "Holding"),
                ("head", "Owner"),
                ("ward", "Ward"),
                ("road", "Road"),
                ("bills", "Bills"),
                ("billed", "Billed (BDT)"),
                ("received", "Received (BDT)"),
                ("outstanding", "Outstanding (BDT)"),
                ("rate", "Rate %"),
            ]
        ),
        rows=rows,
        extra={"mode": mode, "totals": aggregates.totals_of(rows)},
    )


@extend_schema(responses=OpenApiTypes.OBJECT)
@api_view(["GET"])
@permission_classes([IsAuthenticated, SeesMoney])
def customer_bill_status(request):
    """One row per bill, settlement derived from the payments that exist."""
    period = _period(request, required=True)
    rows = aggregates.customer_bill_status(period=period, ward_ids=_ward_scope(request),
        agency_id=_agency_scope(request))
    return _respond(
        request,
        title="Customer bill status",
        columns=[
            Column("bill", "Bill"),
            Column("holding", "Holding ID"),
            Column("holdingNo", "Holding"),
            Column("head", "Owner"),
            Column("ward", "Ward"),
            Column("road", "Road"),
            Column("collector", "Collector"),
            Column("billed", "Billed (BDT)"),
            Column("received", "Received (BDT)"),
            Column("outstanding", "Outstanding (BDT)"),
            Column("state", "State"),
            Column("methods", "Paid via"),
            Column("instalments", "Instalments"),
        ],
        rows=rows,
        extra={
            "period": period,
            "totals": aggregates.totals_of(rows),
            "tally": aggregates.state_tally(rows),
        },
    )


@extend_schema(responses=OpenApiTypes.OBJECT)
@api_view(["GET"])
@permission_classes([IsAuthenticated, SeesMoney])
def reconciliation(request):
    """Service versus revenue, and cash taken versus cash handed in.

    The exception lists are the point of this report, so an export flattens the
    cash rows and returns the exceptions alongside in the JSON body.
    """
    period = _period(request, required=True)
    data = aggregates.reconciliation(period=period, ward_ids=_ward_scope(request),
        agency_id=_agency_scope(request))
    fmt = _fmt(request)
    if fmt:
        return export(
            fmt,
            "Reconciliation",
            columns_from(
                [
                    ("collector", "Collector"),
                    ("collected", "Collected (BDT)"),
                    ("deposited", "Deposited (BDT)"),
                    ("variance", "Variance (BDT)"),
                    ("byMethod", "By method"),
                ]
            ),
            data["cash"],
            subtitle=f"{period} · {_scope_note(request)}",
        )
    return Response(data)


# --------------------------------------------------------------------------- #
# Headline figures
# --------------------------------------------------------------------------- #


@extend_schema(responses=OpenApiTypes.OBJECT)
@api_view(["GET"])
@permission_classes([IsAuthenticated])
def kpis(request):
    """The six-figure scorecard, every number derived rather than hard-coded."""
    return Response(_no_money_one(request,
        # With ?city= (the City Dashboard's picker) the KPIs follow that city.
        aggregates.kpis(period=_period(request, required=True),
                        ward_ids=_city_wards(request) if request.query_params.get("city") else _ward_scope(request),
        agency_id=_agency_scope(request))
    ))


@extend_schema(responses=OpenApiTypes.OBJECT)
@api_view(["GET"])
@permission_classes([IsAuthenticated])
def waste_by_zone(request):
    """Estimated tonnage per zone. Rows carry `estimated: true` — nothing weighs it."""
    return Response(
        aggregates.waste_by_zone(period=_period(request), ward_ids=_ward_scope(request),
        agency_id=_agency_scope(request))
    )


@extend_schema(responses=OpenApiTypes.OBJECT)
@api_view(["GET"])
@permission_classes([IsAuthenticated])
def complaint_summary(request):
    return Response(
        aggregates.complaint_summary(period=_period(request), ward_ids=_ward_scope(request),
        agency_id=_agency_scope(request))
    )


@extend_schema(responses=OpenApiTypes.OBJECT)
@api_view(["GET"])
@permission_classes([IsAuthenticated])
def customer_funnel(request):
    """Survey-to-customer conversion, and the monthly revenue still on the table."""
    return Response(_no_money_one(request, aggregates.customer_funnel(ward_ids=_ward_scope(request),
        agency_id=_agency_scope(request))))


@extend_schema(responses=OpenApiTypes.OBJECT)
@api_view(["GET"])
@permission_classes([IsAuthenticated, IsNotCityViewer])
def dashboard(request):
    """Everything the Dashboard renders, in one round trip.

    The page previously drew from four separate static arrays. Bundling them keeps
    the panels consistent with each other — they are all computed from the same
    ward scope at the same instant.
    """
    wards = _ward_scope(request)
    agency = _agency_scope(request)
    period = _period(request, required=True)
    return Response(
        {
            "period": period,
            "kpis": _no_money_one(
                request, aggregates.kpis(period=period, ward_ids=wards, agency_id=agency)
            ),
            "collectionTrend": _no_money(request, aggregates.collection_trend(
                days=_int(request, "trendDays", 7, high=90), ward_ids=wards, agency_id=agency
            ))[0],
            "wasteByZone": aggregates.waste_by_zone(
                period=period, ward_ids=wards, agency_id=agency
            ),
            "wardCollection": _no_money(request, aggregates.ward_collection(
                period=period, ward_ids=wards, agency_id=agency
            ))[0],
            "complaints": aggregates.complaint_summary(
                period=period, ward_ids=wards, agency_id=agency
            ),
            "funnel": _no_money_one(
                request, aggregates.customer_funnel(ward_ids=wards, agency_id=agency)
            ),
        }
    )


# --------------------------------------------------------------------------- #
# City Corporation dashboard
# --------------------------------------------------------------------------- #

CITY_COLUMNS = columns_from(
    [
        ("period", "Period"),
        ("due", "Due"),
        ("confirmed", "Confirmed by agency"),
        ("auto", "Auto at cut-off"),
        ("missed", "Not collected (complaint)"),
        ("skipped", "Skipped by collector"),
        ("collectedPct", "Collected %"),
        ("confirmedPct", "Confirmed %"),
        ("complaints", "Complaints"),
    ]
)

#: How far back each mode looks when no `from` is given.
CITY_DEFAULT_SPAN = {
    periods.DAILY: dt.timedelta(days=29),
    periods.WEEKLY: dt.timedelta(weeks=12),
    periods.MONTHLY: dt.timedelta(days=365),
    periods.YEARLY: dt.timedelta(days=365 * 3),
}


def _city(request):
    """The city to report on: the caller's own, or the one asked for if visible."""
    return _city_for(request, request.query_params.get("city"))


def _city_for(request, wanted):
    """The caller's own city, or `wanted` if they can see it, or their busiest.

    "Busiest" is the visible city with the most holdings, so a super admin over
    hundreds of cities does not land on an empty one that merely sorts first.
    """
    from django.db.models import Count

    from swms.catalog.models import City
    from swms.customers.models import Holding

    own = request.user.city_id
    if own:
        return City.objects.get(pk=own)
    cities = city_report.visible_cities(_ward_scope(request))
    if wanted:
        city = cities.filter(pk=wanted).first()
    else:
        busiest = (Holding.objects.filter(ward__zone__city__in=cities)
                   .values("ward__zone__city").annotate(n=Count("id")).order_by("-n").first())
        city = cities.filter(pk=busiest["ward__zone__city"]).first() if busiest else cities.first()
    if city is None:
        raise DomainError(
            "No city to report on." if not wanted else f"City {wanted} is not visible to you.",
            code="no_city",
        )
    return city


@extend_schema(
    parameters=[
        OpenApiParameter("city", str, description="City id, e.g. KCC"),
        OpenApiParameter("mode", str, description="daily | weekly | monthly | yearly"),
        OpenApiParameter("from", str, description="Start date, YYYY-MM-DD"),
        OpenApiParameter("to", str, description="End date, YYYY-MM-DD"),
        OpenApiParameter("format", str, description="csv | xlsx | pdf"),
    ]
)
@extend_schema(responses=OpenApiTypes.OBJECT)
@api_view(["GET"])
@permission_classes([IsAuthenticated, IsCityViewerOrSuperAdmin])
def city_collection(request):
    """One city's collection: confirmed, auto and missed, by period, agency and ward."""
    city = _city(request)
    mode = _mode(request, periods.DAILY)
    date_to = _date(request, "to") or timezone.localdate()
    date_from = _date(request, "from") or date_to - CITY_DEFAULT_SPAN[mode]
    if date_from > date_to:
        raise DomainError("`from` must not be after `to`.", code="bad_range")

    ward_ids = _ward_scope(request)
    agency_id = _agency_scope(request)
    data = city_report.city_collection(
        city, mode=mode, date_from=date_from, date_to=date_to,
        ward_ids=ward_ids, agency_id=agency_id,
    )
    cities = [] if request.user.city_id else [
        {"id": c.id, "name": c.name, "nameBn": c.name_bn}
        for c in city_report.visible_cities(ward_ids)
    ]
    return _respond(
        request,
        title=f"City collection — {city.name}",
        columns=CITY_COLUMNS,
        rows=data.pop("series"),
        extra={
            "mode": mode,
            "from": date_from.isoformat(),
            "to": date_to.isoformat(),
            "city": {
                "id": city.id,
                "name": city.name,
                "nameBn": city.name_bn,
                "cutoff": city.collection_cutoff.strftime("%H:%M"),
                "complaintDeadline": city.complaint_deadline.strftime("%H:%M"),
            },
            "cities": cities,
            "today": city_report.today_live(city, ward_ids=ward_ids, agency_id=agency_id),
            **data,
        },
    )



# --------------------------------------------------------------------------- #
# City Corporation oversight (no money): service growth, complaints,
# registers, targets and the summary. The City Viewer's and the super admin's.
# --------------------------------------------------------------------------- #

from . import oversight  # noqa: E402


def _city_wards(request):
    """The wards of the city picked on the page (`?city=`), within the caller's reach.

    City Oversight reports on one city at a time, so every tab agrees with the
    Collection tab: a super admin over several cities picks one; a City Viewer
    bound to a city always gets theirs.
    """
    from swms.catalog.models import Ward

    city = _city(request)
    wards = set(Ward.objects.filter(zone__city=city).values_list("id", flat=True))
    visible = _ward_scope(request)
    if visible is not None:
        wards &= set(visible)
    return sorted(wards)


def _city_choice(request):
    """The picked city and, for a caller not bound to one, the cities to pick from."""
    city = _city(request)
    cities = [] if request.user.city_id else [
        {"id": c.id, "name": c.name, "nameBn": c.name_bn}
        for c in city_report.visible_cities(_ward_scope(request))
    ]
    return {"id": city.id, "name": city.name, "nameBn": city.name_bn}, cities, city

OVERSIGHT_PERMS = [IsAuthenticated, IsCityViewerOrSuperAdmin]


def _range(request, default_days=30):
    date_to = _date(request, "to") or timezone.localdate()
    date_from = _date(request, "from") or date_to - dt.timedelta(days=default_days - 1)
    if date_from > date_to:
        raise DomainError("`from` must not be after `to`.", code="bad_range")
    return date_from, date_to


@extend_schema(responses=OpenApiTypes.OBJECT)
@api_view(["GET"])
@permission_classes(OVERSIGHT_PERMS)
def service_trend(request):
    """Holdings registered and served per month/year, per group, with growth."""
    mode = oversight.YEARLY if request.query_params.get("mode") == "yearly" else oversight.MONTHLY
    by = request.query_params.get("by") or "agency"
    rows = oversight.service_trend(
        mode=mode, count=_int(request, "count", 12 if mode == oversight.MONTHLY else 3, high=36),
        by=by, ward_ids=_city_wards(request), agency_id=_agency_scope(request),
    )
    return _respond(request, title=f"Service trend by {by}", rows=rows, extra={"mode": mode, "by": by},
                    columns=columns_from([
                        ("name", by.title()), ("period", "Period"), ("registered", "Registered"),
                        ("served", "Served"), ("servedPct", "Served %"), ("new", "New"),
                        ("dropped", "Dropped"), ("change", "Change"), ("changePct", "Change %"),
                        ("trend", "Trend"),
                    ]))


@extend_schema(responses=OpenApiTypes.OBJECT)
@api_view(["GET"])
@permission_classes(OVERSIGHT_PERMS)
def complaint_performance(request):
    """How complaints were answered, per agency / supervisor / collector / ward / type."""
    date_from, date_to = _range(request)
    by = request.query_params.get("by") or "agency"
    rows = oversight.complaint_performance(
        date_from=date_from, date_to=date_to, by=by,
        ward_ids=_city_wards(request), agency_id=_agency_scope(request))
    nature = oversight.complaint_nature(
        date_from=date_from, date_to=date_to,
        ward_ids=_city_wards(request), agency_id=_agency_scope(request))
    return _respond(request, title=f"Complaint performance by {by}", rows=rows,
                    extra={"by": by, "from": date_from, "to": date_to, "nature": nature},
                    columns=columns_from([
                        ("name", by.title()), ("received", "Received"), ("resolved", "Resolved"),
                        ("withinSla", "Within deadline"), ("slaPct", "Within deadline %"),
                        ("avgResolveH", "Avg. hours to resolve"), ("reopened", "Reopened"),
                        ("openNow", "Open now"), ("overdueNow", "Overdue now"),
                        ("per100", "Per 100 holdings"),
                    ]))


@extend_schema(responses=OpenApiTypes.OBJECT)
@api_view(["GET"])
@permission_classes(OVERSIGHT_PERMS)
def complaints_overdue(request):
    rows = oversight.overdue_complaints(ward_ids=_city_wards(request), agency_id=_agency_scope(request))
    return _respond(request, title="Overdue complaints", rows=rows, columns=columns_from([
        ("id", "Complaint"), ("type", "Type"), ("priority", "Priority"), ("status", "Status"),
        ("wardName", "Ward"), ("agency", "Agency"), ("assigned", "Assigned to"),
        ("opened", "Opened"), ("slaH", "Deadline (h)"), ("overdueH", "Overdue by (h)"),
    ]))


REGISTERS = {
    "agencies": (oversight.register_agencies, "Agency register", [
        ("name", "Agency"), ("type", "Type"), ("district", "District"), ("cities", "City / Pourashova"),
        ("contractStart", "Contract start"), ("contractEnd", "Contract end"), ("status", "Status"),
        ("collectors", "Collectors"), ("vans", "Vans"), ("holdings", "Holdings"), ("target", "Target"),
    ]),
    "collectors": (oversight.register_collectors, "Collector register", [
        ("name", "Collector"), ("dspId", "DSP ID"), ("phone", "Phone"), ("agency", "Agency"),
        ("district", "District"), ("city", "City"), ("wards", "Wards"), ("van", "Van"),
        ("license", "Licence"), ("licenseExp", "Licence expiry"), ("attendance", "Attendance"),
        ("coverage", "Coverage %"), ("onTime", "On-time %"),
    ]),
    "supervisors": (oversight.register_supervisors, "Supervisor register", [
        ("name", "Supervisor"), ("phone", "Phone"), ("agency", "Agency"), ("area", "Area"),
        ("wards", "Wards"), ("collectors", "Collectors"), ("openComplaints", "Open complaints"),
    ]),
    "vans": (oversight.register_vans, "Van and driver register", [
        ("id", "Van"), ("plate", "Plate"), ("type", "Type"), ("capacity", "Capacity (kg)"),
        ("status", "Status"), ("agency", "Agency"), ("driver", "Driver"), ("driverPhone", "Driver phone"),
        ("driverLicense", "Driving licence"), ("driverLicenseExp", "Licence expiry"),
        ("documentsDue", "Papers due"),
    ]),
    "documents": (oversight.register_documents, "Document expiry (next 60 days)", [
        ("kind", "Kind"), ("subject", "Van / collector"), ("agency", "Agency"),
        ("document", "Document"), ("expires", "Expires"), ("days", "Days left"),
    ]),
}


@extend_schema(responses=OpenApiTypes.OBJECT)
@api_view(["GET"])
@permission_classes(OVERSIGHT_PERMS)
def register(request, kind):
    """Read-only registers: agencies, collectors, supervisors, vans, documents."""
    if kind not in REGISTERS:
        raise DomainError(f"No register called {kind}.", code="no_register")
    build, title, spec = REGISTERS[kind]
    rows = build(ward_ids=_city_wards(request), agency_id=_agency_scope(request))
    return _respond(request, title=title, rows=rows, columns=columns_from(spec))


@extend_schema(responses=OpenApiTypes.OBJECT)
@api_view(["GET"])
@permission_classes(OVERSIGHT_PERMS)
def agency_targets(request):
    data = oversight.agency_targets(period=_period(request), ward_ids=_city_wards(request),
                                    agency_id=_agency_scope(request))
    return _respond(request, title=f"Agency targets {data['period']}", rows=data["rows"],
                    extra={"period": data["period"]}, columns=columns_from([
                        ("name", "Agency"), ("target", "Target holdings"), ("registered", "Registered"),
                        ("served", "Served"), ("achievement", "Achievement %"), ("new", "New"),
                        ("dropped", "Dropped"), ("status", "Status"),
                    ]))


@extend_schema(responses=OpenApiTypes.OBJECT)
@api_view(["GET"])
@permission_classes(OVERSIGHT_PERMS)
def oversight_summary(request):
    """The Overview tab: the summary, today's pickup and 30 days of collection per agency."""
    picked, cities, city = _city_choice(request)
    ward_ids = _city_wards(request)
    agency_id = _agency_scope(request)
    today = timezone.localdate()
    data = oversight.oversight_summary(ward_ids=ward_ids, agency_id=agency_id, today=today)
    collection = city_report.city_collection(
        city, mode=periods.DAILY, date_from=today - dt.timedelta(days=29), date_to=today,
        ward_ids=ward_ids, agency_id=agency_id,
    )
    oversight.merge_collection(data, collection["byAgency"])
    data["pickupToday"] = city_report.today_live(city, ward_ids=ward_ids, agency_id=agency_id)
    data["city"] = picked
    data["cities"] = cities
    return Response(data)


# --------------------------------------------------------------------------- #
# Agency Reports: the City Dashboard's reports narrowed to one agency, and the
# collector scorecard. Agency admin and supervisor (own agency, own wards);
# the super admin picks an agency with ?agency=, or sees every agency.
# --------------------------------------------------------------------------- #

from swms.common.permissions import IsAgencyReporter  # noqa: E402

AGENCY_PERMS = [IsAuthenticated, IsAgencyReporter]
AGENCY_REGISTERS = ("collectors", "supervisors", "vans", "documents")


def _report_agency(request):
    """The caller's own agency; a super admin may name one, or leave it open."""
    return _agency_scope(request)


@extend_schema(responses=OpenApiTypes.OBJECT)
@api_view(["GET"])
@permission_classes(AGENCY_PERMS)
def agency_scorecard(request):
    """Collector scorecard for a month: coverage, money, complaints, on-time, rank."""
    data = oversight.collector_scorecard(period=_period(request), ward_ids=_ward_scope(request),
                                         agency_id=_report_agency(request))
    return _respond(request, title=f"Collector scorecard {data['period']}", rows=data["rows"],
                    extra={"period": data["period"], "weights": data["weights"]},
                    columns=columns_from([
                        ("rank", "Rank"), ("name", "Collector"), ("dspId", "DSP ID"), ("agency", "Agency"),
                        ("wards", "Wards"), ("holdings", "Holdings"), ("served", "Served"),
                        ("coverage", "Coverage %"), ("skipped", "Skipped"), ("complaints", "Complaints"),
                        ("per100", "Per 100 holdings"), ("billed", "Billed"), ("received", "Received"),
                        ("collectionPct", "Collection %"), ("onTime", "On-time %"), ("score", "Score"),
                    ]))


@extend_schema(responses=OpenApiTypes.OBJECT)
@api_view(["GET"])
@permission_classes(AGENCY_PERMS)
def agency_complaint_performance(request):
    date_from, date_to = _range(request)
    by = request.query_params.get("by") or "collector"
    ward_ids, agency_id = _ward_scope(request), _report_agency(request)
    rows = oversight.complaint_performance(date_from=date_from, date_to=date_to, by=by,
                                           ward_ids=ward_ids, agency_id=agency_id)
    nature = oversight.complaint_nature(date_from=date_from, date_to=date_to,
                                        ward_ids=ward_ids, agency_id=agency_id)
    return _respond(request, title=f"Complaint performance by {by}", rows=rows,
                    extra={"by": by, "from": date_from, "to": date_to, "nature": nature},
                    columns=columns_from([
                        ("name", by.title()), ("received", "Received"), ("resolved", "Resolved"),
                        ("withinSla", "Within deadline"), ("slaPct", "Within deadline %"),
                        ("avgResolveH", "Avg. hours to resolve"), ("reopened", "Reopened"),
                        ("openNow", "Open now"), ("overdueNow", "Overdue now"),
                        ("per100", "Per 100 holdings"),
                    ]))


@extend_schema(responses=OpenApiTypes.OBJECT)
@api_view(["GET"])
@permission_classes(AGENCY_PERMS)
def agency_complaints_overdue(request):
    rows = oversight.overdue_complaints(ward_ids=_ward_scope(request), agency_id=_report_agency(request))
    return _respond(request, title="Overdue complaints", rows=rows, columns=columns_from([
        ("id", "Complaint"), ("type", "Type"), ("priority", "Priority"), ("status", "Status"),
        ("wardName", "Ward"), ("agency", "Agency"), ("assigned", "Assigned to"),
        ("opened", "Opened"), ("slaH", "Deadline (h)"), ("overdueH", "Overdue by (h)"),
    ]))


@extend_schema(responses=OpenApiTypes.OBJECT)
@api_view(["GET"])
@permission_classes(AGENCY_PERMS)
def agency_register(request, kind):
    if kind not in AGENCY_REGISTERS:
        raise DomainError(f"No register called {kind}.", code="no_register")
    build, title, spec = REGISTERS[kind]
    rows = build(ward_ids=_ward_scope(request), agency_id=_report_agency(request))
    return _respond(request, title=title, rows=rows, columns=columns_from(spec))


@extend_schema(responses=OpenApiTypes.OBJECT)
@api_view(["GET"])
@permission_classes(AGENCY_PERMS)
def agency_contract(request):
    """What the City sees about this agency: targets, growth, complaints, its rank."""
    ward_ids, agency_id = _ward_scope(request), _report_agency(request)
    data = oversight.agency_contract(ward_ids=ward_ids, agency_id=agency_id)
    data["targets"] = oversight.agency_targets(period=_period(request), ward_ids=ward_ids,
                                               agency_id=agency_id)["rows"]
    return Response(data)


from . import agency_money  # noqa: E402


@extend_schema(responses=OpenApiTypes.OBJECT)
@api_view(["GET"])
@permission_classes(AGENCY_PERMS)
def agency_cash_in_hand(request):
    """Money each collector has taken and not yet handed in, oldest first."""
    data = agency_money.cash_in_hand(ward_ids=_ward_scope(request), agency_id=_report_agency(request))
    rows = data.pop("rows")
    return _respond(request, title="Collector cash in hand", rows=rows, extra=data, columns=columns_from([
        ("name", "Collector"), ("dspId", "DSP ID"), ("phone", "Phone"), ("agency", "Agency"),
        ("amount", "In hand (BDT)"), ("payments", "Payments"), ("oldest", "Oldest payment"),
        ("days", "Days held"), ("status", "Status"), ("methods", "By method"),
        ("lastDeposit", "Last deposit"),
    ]))


@extend_schema(responses=OpenApiTypes.OBJECT)
@api_view(["GET"])
@permission_classes(AGENCY_PERMS)
def agency_dues_ageing(request):
    """Unpaid bills split by days past due: per holding (default) or per ward."""
    by = "ward" if request.query_params.get("by") == "ward" else "holding"
    data = agency_money.dues_ageing(by=by, ward_ids=_ward_scope(request), agency_id=_report_agency(request))
    rows = data.pop("rows")
    head = ([("wardName", "Ward"), ("holdings", "Holdings")] if by == "ward" else
            [("holdingNo", "Holding"), ("owner", "Owner"), ("phone", "Phone"), ("road", "Road"),
             ("wardName", "Ward"), ("oldestPeriod", "Oldest month")])
    return _respond(request, title=f"Dues ageing by {by}", rows=rows, extra=data, columns=columns_from(head + [
        ("bills", "Bills"), ("notDue", "Not yet due"), ("d0_30", "1-30 days"), ("d31_60", "31-60 days"),
        ("d61_90", "61-90 days"), ("d90", "Over 90 days"), ("outstanding", "Total due"),
    ]))


from . import agency_ops  # noqa: E402


@extend_schema(responses=OpenApiTypes.OBJECT)
@api_view(["GET"])
@permission_classes(AGENCY_PERMS)
def agency_collection_sheet(request):
    """Per day and collector: due, confirmed, auto, skipped, missed (default: last 7 days)."""
    date_from, date_to = _range(request, default_days=7)
    data = agency_ops.collection_sheet(date_from=date_from, date_to=date_to, ward_ids=_ward_scope(request),
                                       agency_id=_report_agency(request),
                                       collector=request.query_params.get("collector") or None,
                                       by="day" if request.query_params.get("by") == "day" else "collector")
    rows = data.pop("rows")
    head = ([("day", "Day"), ("collectors", "Collectors")] if data["by"] == "day"
            else [("day", "Day"), ("name", "Collector"), ("agency", "Agency")])
    return _respond(request, title="Daily collection", rows=rows, extra=data, columns=columns_from(head + [
        ("due", "Due"),
        ("confirmed", "Confirmed"), ("auto", "Auto-collected"), ("skipped", "Skipped"),
        ("missed", "Missed (complaint)"), ("notRecorded", "Not recorded"), ("collectedPct", "Collected %"),
    ]))


@extend_schema(responses=OpenApiTypes.OBJECT)
@api_view(["GET"])
@permission_classes(AGENCY_PERMS)
def agency_missed_holdings(request):
    """Holdings not served in the range (default: this month), most-missed first."""
    today = timezone.localdate()
    date_to = _date(request, "to") or today
    date_from = _date(request, "from") or date_to.replace(day=1)
    if date_from > date_to:
        raise DomainError("`from` must not be after `to`.", code="bad_range")
    data = agency_ops.missed_holdings(date_from=date_from, date_to=date_to, ward_ids=_ward_scope(request),
                                      agency_id=_report_agency(request))
    rows = data.pop("rows")
    return _respond(request, title="Missed and skipped holdings", rows=rows, extra=data, columns=columns_from([
        ("holdingNo", "Holding"), ("owner", "Owner"), ("phone", "Phone"), ("road", "Road"),
        ("wardName", "Ward"), ("collectorName", "Collector"), ("missed", "Missed (complaint)"),
        ("skipped", "Skipped"), ("reasons", "Skip reasons"), ("last", "Last time"),
    ]))


from . import agency_fleet  # noqa: E402


@extend_schema(responses=OpenApiTypes.OBJECT)
@api_view(["GET"])
@permission_classes(AGENCY_PERMS)
def agency_fuel(request):
    """Fuel per van for a month: litres, cost, km, km/l, cost per km and per holding."""
    data = agency_fleet.fuel_report(period=_period(request), ward_ids=_ward_scope(request),
                                    agency_id=_report_agency(request))
    rows = data.pop("rows")
    return _respond(request, title=f"Fuel report {data['period']}", rows=rows, extra=data, columns=columns_from([
        ("id", "Van"), ("plate", "Plate"), ("agency", "Agency"), ("driver", "Driver"), ("fills", "Fills"),
        ("litres", "Litres"), ("cost", "Cost (BDT)"), ("costBefore", "Last month (BDT)"), ("km", "Km"),
        ("kmpl", "Km per litre"), ("usualKmpl", "Usual km/l"), ("costPerKm", "BDT per km"),
        ("holdings", "Holdings served"), ("costPerHolding", "BDT per holding"),
    ]))


@extend_schema(responses=OpenApiTypes.OBJECT)
@api_view(["GET"])
@permission_classes(AGENCY_PERMS)
def agency_maintenance(request):
    """Maintenance per van over a range (default: last 180 days), with the job list."""
    date_from, date_to = _range(request, default_days=180)
    data = agency_fleet.maintenance_report(date_from=date_from, date_to=date_to, ward_ids=_ward_scope(request),
                                           agency_id=_report_agency(request))
    rows = data.pop("rows")
    return _respond(request, title="Maintenance history", rows=rows, extra=data, columns=columns_from([
        ("id", "Van"), ("plate", "Plate"), ("agency", "Agency"), ("status", "Status"), ("jobs", "Jobs"),
        ("scheduled", "Scheduled"), ("unscheduled", "Breakdowns"), ("cost", "Cost (BDT)"),
        ("downtimeDays", "Days off road"), ("open", "Open now"), ("last", "Last job"),
        ("lastReason", "Last reason"), ("odometer", "Odometer"), ("serviceDueIn", "Service due in (km)"),
    ]))


from . import agency_more  # noqa: E402


def _month_to_date(request):
    date_to = _date(request, "to") or timezone.localdate()
    date_from = _date(request, "from") or date_to.replace(day=1)
    if date_from > date_to:
        raise DomainError("`from` must not be after `to`.", code="bad_range")
    return date_from, date_to


@extend_schema(responses=OpenApiTypes.OBJECT)
@api_view(["GET"])
@permission_classes(AGENCY_PERMS)
def agency_survey_progress(request):
    """Door-to-door surveys per surveyor (default) or coverage per ward; this month by default."""
    date_from, date_to = _month_to_date(request)
    by = "ward" if request.query_params.get("by") == "ward" else "surveyor"
    data = agency_more.survey_progress(date_from=date_from, date_to=date_to, by=by,
                                       ward_ids=_ward_scope(request), agency_id=_report_agency(request))
    rows = data.pop("rows")
    spec = ([("wardName", "Ward"), ("holdings", "Holdings"), ("surveyed", "Surveyed"), ("coverage", "Coverage %"),
             ("notSurveyed", "Not surveyed"), ("surveys", "Surveys in range"), ("converted", "Converted")]
            if by == "ward" else
            [("name", "Surveyor"), ("surveys", "Surveys"), ("daysWorked", "Days"), ("perDay", "Per day"),
             ("draft", "Draft"), ("submitted", "Submitted"), ("reviewed", "Reviewed"),
             ("converted", "Converted"), ("rejected", "Rejected"), ("conversion", "Conversion %"),
             ("last", "Last survey")])
    return _respond(request, title=f"Survey progress by {by}", rows=rows,
                    extra={**data, "from": date_from, "to": date_to}, columns=columns_from(spec))


@extend_schema(responses=OpenApiTypes.OBJECT)
@api_view(["GET"])
@permission_classes(AGENCY_PERMS)
def agency_repeat_complaints(request):
    """Holdings with 2+ complaints in the range (default: last 30 days)."""
    date_from, date_to = _range(request, default_days=30)
    data = agency_more.repeat_complaints(date_from=date_from, date_to=date_to,
                                         minimum=_int(request, "min", 2, low=2, high=50),
                                         ward_ids=_ward_scope(request), agency_id=_report_agency(request))
    rows = data.pop("rows")
    return _respond(request, title="Repeat-complaint holdings", rows=rows,
                    extra={**data, "from": date_from, "to": date_to}, columns=columns_from([
                        ("holdingNo", "Holding"), ("owner", "Owner"), ("phone", "Phone"), ("road", "Road"),
                        ("wardName", "Ward"), ("complaints", "Complaints"), ("open", "Open now"),
                        ("mainType", "Main type"), ("first", "First"), ("last", "Last"), ("assigned", "Assigned to"),
                    ]))


@extend_schema(responses=OpenApiTypes.OBJECT)
@api_view(["GET"])
@permission_classes(AGENCY_PERMS)
def agency_route_completion(request):
    """Per route and day (default) or per route: stops served, times, on time; last 7 days."""
    date_from, date_to = _range(request, default_days=7)
    if (date_to - date_from).days > 61:
        date_from = date_to - dt.timedelta(days=61)
    by = "route" if request.query_params.get("by") == "route" else "day"
    data = agency_more.route_completion(date_from=date_from, date_to=date_to, by=by,
                                        ward_ids=_ward_scope(request), agency_id=_report_agency(request))
    rows = data.pop("rows")
    spec = ([("routeName", "Route"), ("wardName", "Ward"), ("collectorName", "Collector"), ("stops", "Stops"),
             ("days", "Days"), ("notStarted", "Not started"), ("completion", "Completion %"),
             ("onTimePct", "On-time %")]
            if by == "route" else
            [("day", "Day"), ("routeName", "Route"), ("wardName", "Ward"), ("collectorName", "Collector"),
             ("stops", "Stops"), ("served", "Scanned"), ("auto", "Auto"), ("notServed", "Not served"),
             ("completion", "Completion %"), ("first", "First scan"), ("last", "Last scan"),
             ("windowEnd", "Window ends"), ("onTime", "On time")])
    return _respond(request, title=f"Route completion by {by}", rows=rows, extra=data, columns=columns_from(spec))


@extend_schema(responses=OpenApiTypes.OBJECT)
@api_view(["GET"])
@permission_classes(AGENCY_PERMS)
def agency_billing_runs(request):
    """Bills per month (last 12) and how they were paid; with ?period=, that month by ward."""
    period = _period(request)
    data = agency_more.billing_runs(period=period, ward_ids=_ward_scope(request), agency_id=_report_agency(request))
    rows = data.pop("rows")
    head = [("wardName", "Ward")] if period else [("period", "Month")]
    return _respond(request, title=f"Billing run {period}" if period else "Billing runs", rows=rows, extra=data,
                    columns=columns_from(head + [
                        ("bills", "Bills"), ("amount", "Billed (BDT)"), ("collected", "Collected (BDT)"),
                        ("outstanding", "Outstanding (BDT)"), ("collectionPct", "Collection %"),
                        ("paid", "Paid"), ("partial", "Part-paid"), ("unpaid", "Unpaid"),
                    ]))


from . import agency_pack  # noqa: E402
from .exports import to_pdf_pack  # noqa: E402


@extend_schema(responses=OpenApiTypes.OBJECT)
@api_view(["GET"])
@permission_classes(AGENCY_PERMS)
def agency_attendance(request):
    """Attendance per collector for a month (default) or every day of it."""
    by = "day" if request.query_params.get("by") == "day" else "collector"
    data = agency_pack.attendance(period=_period(request), by=by, ward_ids=_ward_scope(request),
                                  agency_id=_report_agency(request))
    rows = data.pop("rows")
    spec = ([("day", "Day"), ("name", "Collector"), ("status", "Status"), ("checkIn", "Checked in"),
             ("firstScan", "First scan"), ("startsAt", "Route starts"), ("late", "Late")]
            if by == "day" else
            [("name", "Collector"), ("dspId", "DSP ID"), ("agency", "Agency"), ("days", "Days"),
             ("present", "Present"), ("absent", "Absent"), ("noRecord", "No record"), ("late", "Late"),
             ("attendancePct", "Attendance %"), ("startsAt", "Route starts")])
    return _respond(request, title=f"Attendance {data['period']}", rows=rows, extra=data, columns=columns_from(spec))


@extend_schema(responses=OpenApiTypes.OBJECT)
@api_view(["GET"])
@permission_classes(AGENCY_PERMS)
def agency_monthly_pack(request):
    """One month of the agency's reports: JSON preview, or ?format=pdf for the printable pack."""
    from swms.agencies.models import Agency

    agency_id = _report_agency(request)
    name = Agency.objects.filter(pk=agency_id).values_list("name", flat=True).first() if agency_id else ""
    data = agency_pack.monthly_pack(period=_period(request), ward_ids=_ward_scope(request),
                                    agency_id=agency_id, agency_name=name or "")
    if _fmt(request) == "pdf":
        title = f"Monthly report {data['period']}" + (f" - {name}" if name else "")
        note = "Month to date. " if data["partial"] else ""
        subtitle = f"{note}Generated {timezone.localtime().strftime('%d %b %Y %H:%M')}"
        return to_pdf_pack(title, subtitle, [(f["label"], f["value"]) for f in data["figures"]], [
            (s["title"], columns_from([(c["key"], c["label"]) for c in s["columns"]]), s["rows"])
            for s in data["sections"]
        ])
    return Response(data)
