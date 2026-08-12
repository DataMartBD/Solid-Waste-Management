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

from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from swms.common.exceptions import DomainError

from . import aggregates, periods
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
    return request.user.visible_agency_id()


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
    return _respond(
        request,
        title="Service collection",
        columns=columns_from(
            [
                ("date", "Date"),
                ("scheduled", "Scheduled"),
                ("served", "Served"),
                ("skipped", "Skipped"),
                ("billed", "Billed (BDT)"),
                ("collected", "Collected (BDT)"),
            ]
        ),
        rows=rows,
    )


@extend_schema(responses=OpenApiTypes.OBJECT)
@api_view(["GET"])
@permission_classes([IsAuthenticated])
def ward_collection(request):
    """Per-ward service and revenue for a month."""
    rows = aggregates.ward_collection(period=_period(request, required=True), ward_ids=_ward_scope(request),
        agency_id=_agency_scope(request))
    return _respond(
        request,
        title="Ward collection",
        columns=columns_from(
            [
                ("ward", "Ward"),
                ("name", "Name"),
                ("households", "Households"),
                ("scheduled", "Scheduled stops"),
                ("served", "Served"),
                ("billed", "Billed (BDT)"),
                ("collected", "Collected (BDT)"),
            ]
        ),
        rows=rows,
    )


# --------------------------------------------------------------------------- #
# Revenue
# --------------------------------------------------------------------------- #


@extend_schema(responses=OpenApiTypes.OBJECT)
@api_view(["GET"])
@permission_classes([IsAuthenticated])
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
@permission_classes([IsAuthenticated])
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
@permission_classes([IsAuthenticated])
def customer_collection(request):
    """Billed and received per household — the "who has not paid" list."""
    mode = _mode(request)
    rows = aggregates.customer_collection(
        mode=mode,
        ward_ids=_ward_scope(request),
        agency_id=_agency_scope(request),
        period_from=request.query_params.get("from") or None,
        period_to=request.query_params.get("to") or None,
        household=request.query_params.get("hh") or None,
    )
    return _respond(
        request,
        title="Customer collection",
        columns=columns_from(
            [
                ("period", "Period"),
                ("hh", "Household"),
                ("head", "Head"),
                ("ward", "Ward"),
                ("road", "Road"),
                ("holding", "Holding"),
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
@permission_classes([IsAuthenticated])
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
            Column("hh", "Household"),
            Column("head", "Head"),
            Column("ward", "Ward"),
            Column("road", "Road"),
            Column("holding", "Holding"),
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
@permission_classes([IsAuthenticated])
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
    return Response(
        aggregates.kpis(period=_period(request, required=True), ward_ids=_ward_scope(request),
        agency_id=_agency_scope(request))
    )


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
    return Response(aggregates.customer_funnel(ward_ids=_ward_scope(request),
        agency_id=_agency_scope(request)))


@extend_schema(responses=OpenApiTypes.OBJECT)
@api_view(["GET"])
@permission_classes([IsAuthenticated])
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
            "kpis": aggregates.kpis(period=period, ward_ids=wards, agency_id=agency),
            "collectionTrend": aggregates.collection_trend(
                days=_int(request, "trendDays", 7, high=90), ward_ids=wards, agency_id=agency
            ),
            "wasteByZone": aggregates.waste_by_zone(
                period=period, ward_ids=wards, agency_id=agency
            ),
            "wardCollection": aggregates.ward_collection(
                period=period, ward_ids=wards, agency_id=agency
            ),
            "complaints": aggregates.complaint_summary(
                period=period, ward_ids=wards, agency_id=agency
            ),
            "funnel": aggregates.customer_funnel(ward_ids=wards, agency_id=agency),
        }
    )
