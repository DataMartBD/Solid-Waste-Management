"""Collector, route, assignment, visit and daily-round endpoints."""

from __future__ import annotations

from django.db.models import Count, Q
from django.utils import timezone
from django.utils.dateparse import parse_date
from django_filters import rest_framework as filters
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound, PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from swms.common.exceptions import DomainError
from swms.common.permissions import IsAgencyAdmin
from swms.common.roles import OPERATIONAL_WRITERS, Role
from swms.common.views import SwmsModelViewSet
from swms.complaints.models import ComplaintStatus

from .models import Assignment, Collector, Route, Visit
from .serializers import (
    AssignRoutesSerializer,
    AssignmentSerializer,
    AttendanceSerializer,
    BulkVisitSerializer,
    CollectorSerializer,
    RecordVisitSerializer,
    ReorderStopsSerializer,
    RouteSerializer,
    ScanSerializer,
    SingleStopSerializer,
    VisitSerializer,
    validate_stop_households,
)
from .services import (
    bulk_record_visits,
    count_by_status,
    match_scan,
    record_visit,
    refresh_collector_metrics,
    round_for_collector,
    routes_for_collector,
    set_attendance,
)

#: What "outstanding" means for the live complaint count on a collector.
OPEN_COMPLAINT_STATES = [
    ComplaintStatus.OPEN,
    ComplaintStatus.ASSIGNED,
    ComplaintStatus.IN_PROGRESS,
]


def own_round_only(request, requested: str) -> str:
    """Pin a collector-role caller to their own round.

    Supervisors and admins look in on any collector — that is how a round gets
    reviewed from a desk. A collector may not, because a round names households,
    their phone numbers and what they owe.
    """
    user = request.user
    if user.is_superuser or user.role != Role.COLLECTOR.value:
        return requested
    if not user.collector_id:
        raise PermissionDenied("This login is not linked to a collector record.")
    return user.collector_id


class CollectorFilter(filters.FilterSet):
    """Query parameters the Collectors table and the round picker need."""

    ward = filters.CharFilter(field_name="ward_id")
    #: The mock's name for the same thing — a ward id, not a zone id.
    zone = filters.CharFilter(field_name="ward_id")
    hasVan = filters.BooleanFilter(method="filter_has_van")

    class Meta:
        model = Collector
        fields = ["ward", "zone", "status", "attendance", "active"]

    def filter_has_van(self, queryset, name, value):
        return queryset.filter(vans__isnull=not value).distinct()


class CollectorViewSet(SwmsModelViewSet):
    """CRUD plus attendance and the metrics recalculation."""

    serializer_class = CollectorSerializer
    filterset_class = CollectorFilter
    search_fields = ["id", "name", "dsp_id", "phone", "license"]
    ordering_fields = ["name", "coverage", "on_time", "joined", "id"]
    ward_scope_field = "ward_id"
    write_roles = OPERATIONAL_WRITERS

    def get_queryset(self):
        queryset = (
            Collector.objects.select_related("ward")
            # `vanId` and `assignmentId` are read off these; without the prefetch
            # a 60-row staff list costs 120 extra queries.
            .prefetch_related("vans", "assignments")
            .annotate(
                open_complaints=Count(
                    "assigned_complaints",
                    filter=Q(assigned_complaints__status__in=OPEN_COMPLAINT_STATES),
                    distinct=True,
                )
            )
        )
        return self.scope_queryset(queryset)

    @action(detail=True, methods=["post"])
    def attendance(self, request, pk=None):
        """Depot check-in or absence for today."""
        collector = self.get_object()
        serializer = AttendanceSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        set_attendance(collector, serializer.validated_data["attendance"], user=request.user)
        return Response(self.get_serializer(self.get_queryset().get(pk=collector.pk)).data)

    @action(
        detail=False,
        methods=["post"],
        url_path="refresh-metrics",
        permission_classes=[IsAgencyAdmin],
    )
    def refresh_metrics(self, request):
        """Recompute coverage and on-time for every collector from the visit log.

        Admin-only: the figures feed staff reviews, so a supervisor cannot
        recalculate their own team's numbers on demand.
        """
        raw = request.data.get("days", 30)
        try:
            days = int(raw)
        except (TypeError, ValueError):
            raise DomainError(f"'{raw}' is not a number of days.", code="bad_days") from None
        if not 1 <= days <= 365:
            raise DomainError("Use a window between 1 and 365 days.", code="bad_days")
        updated = refresh_collector_metrics(days=days)
        return Response({"updated": updated, "days": days})


class RouteFilter(filters.FilterSet):
    ward = filters.CharFilter(field_name="ward_id")
    zone = filters.CharFilter(field_name="ward__zone_id")
    collector = filters.CharFilter(method="filter_collector")
    unassigned = filters.BooleanFilter(method="filter_unassigned")

    class Meta:
        model = Route
        fields = ["ward", "zone", "active"]

    def filter_collector(self, queryset, name, value):
        return queryset.filter(
            assignment_links__assignment__collector_id=value,
            assignment_links__assignment__active=True,
        ).distinct()

    def filter_unassigned(self, queryset, name, value):
        """Routes nobody walks — the gap a supervisor is looking for."""
        held = Q(assignment_links__assignment__active=True)
        return (
            queryset.exclude(held).distinct() if value else queryset.filter(held).distinct()
        )


class RouteViewSet(SwmsModelViewSet):
    """CRUD plus the stop-list edits the Route Plan screen performs."""

    serializer_class = RouteSerializer
    filterset_class = RouteFilter
    search_fields = ["id", "name"]
    ordering_fields = ["name", "ward_id", "id"]
    ward_scope_field = "ward_id"
    write_roles = OPERATIONAL_WRITERS

    def get_queryset(self):
        queryset = Route.objects.select_related("ward").prefetch_related("stops")
        return self.scope_queryset(queryset)

    def _reordered(self, route, household_ids):
        """Apply a walking order and answer with the route as it now stands."""
        route.resequence(household_ids)
        return Response(self.get_serializer(self.get_queryset().get(pk=route.pk)).data)

    @action(detail=True, methods=["post"])
    def stops(self, request, pk=None):
        """Replace the whole ordered stop list."""
        route = self.get_object()
        serializer = ReorderStopsSerializer(data=request.data, context={"route": route})
        serializer.is_valid(raise_exception=True)
        return self._reordered(route, serializer.validated_data["stops"])

    @action(detail=True, methods=["post"], url_path="add-stop")
    def add_stop(self, request, pk=None):
        """Append one holding to the end of the walk.

        A holding already on another route moves here rather than being refused:
        that is what dragging it across routes on the planner means.
        """
        route = self.get_object()
        serializer = SingleStopSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        household_id = serializer.validated_data["hh"]
        validate_stop_households([household_id], route.ward_id)

        current = [stop.household_id for stop in route.stops.all()]
        if household_id in current:
            return Response(self.get_serializer(route).data)
        return self._reordered(route, current + [household_id])

    @action(detail=True, methods=["post"], url_path="remove-stop")
    def remove_stop(self, request, pk=None):
        """Take one holding off the walk, closing the gap in the numbering."""
        route = self.get_object()
        serializer = SingleStopSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        household_id = serializer.validated_data["hh"]

        current = [stop.household_id for stop in route.stops.all()]
        if household_id not in current:
            raise DomainError(
                f"{household_id} is not a stop on {route.id}.", code="not_a_stop"
            )
        return self._reordered(route, [hh for hh in current if hh != household_id])


class AssignmentFilter(filters.FilterSet):
    collector = filters.CharFilter(field_name="collector_id")
    ward = filters.CharFilter(field_name="collector__ward_id")

    class Meta:
        model = Assignment
        fields = ["collector", "ward", "active"]


class AssignmentViewSet(SwmsModelViewSet):
    serializer_class = AssignmentSerializer
    filterset_class = AssignmentFilter
    search_fields = ["id", "collector_id", "collector__name"]
    ward_scope_field = "collector__ward_id"
    write_roles = OPERATIONAL_WRITERS

    def get_queryset(self):
        queryset = Assignment.objects.select_related("collector").prefetch_related("route_links")
        return self.scope_queryset(queryset)

    @action(detail=True, methods=["post"])
    def routes(self, request, pk=None):
        """Set the routes this assignment covers.

        A route already held by somebody else is taken over — the planner allows
        reassigning it, and `set_routes` drops the conflicting link.
        """
        assignment = self.get_object()
        serializer = AssignRoutesSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        assignment.set_routes(serializer.validated_data["routes"])
        return Response(self.get_serializer(self.get_queryset().get(pk=assignment.pk)).data)


class VisitFilter(filters.FilterSet):
    hh = filters.CharFilter(field_name="household_id")
    collector = filters.CharFilter(field_name="collector_id")
    route = filters.CharFilter(field_name="route_id")
    ward = filters.CharFilter(field_name="household__ward_id")
    day = filters.DateFilter(field_name="served_on")
    dateFrom = filters.DateFilter(field_name="served_on", lookup_expr="gte")
    dateTo = filters.DateFilter(field_name="served_on", lookup_expr="lte")

    class Meta:
        model = Visit
        fields = ["hh", "collector", "route", "ward", "day", "status", "source", "synced"]


class VisitViewSet(SwmsModelViewSet):
    """The visit log, plus the offline queue's two endpoints."""

    serializer_class = VisitSerializer
    filterset_class = VisitFilter
    search_fields = ["id", "household_id", "qr"]
    ordering_fields = ["at", "served_on", "id"]
    ward_scope_field = "household__ward_id"
    # Recording collections is the collector's core job.
    write_roles = OPERATIONAL_WRITERS | {Role.COLLECTOR}

    def get_queryset(self):
        queryset = Visit.objects.select_related(
            "household", "household__ward", "household__road", "collector", "route"
        )
        return self.scope_queryset(queryset)

    def _acting_collector(self, request, requested):
        """A collector records as themselves, whatever the payload claims."""
        user = request.user
        if user.is_superuser or user.role != Role.COLLECTOR.value:
            return requested
        if not user.collector_id:
            raise PermissionDenied("This login is not linked to a collector record.")
        return Collector.objects.filter(pk=user.collector_id).first()

    def create(self, request, *args, **kwargs):
        """Record a collection or a skip.

        Goes through `record_visit` rather than a plain save so the day's existing
        row is reused, the tag and route are taken from the plan, and the live map
        hears about it.
        """
        serializer = RecordVisitSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        visit = record_visit(
            data["hh"],
            collector=self._acting_collector(request, data.get("collector")),
            status=data["status"],
            at=data.get("at"),
            accuracy=data.get("accuracy"),
            lat=data.get("lat"),
            lng=data.get("lng"),
            source=data.get("source", ""),
            reason=data.get("reason", ""),
            note=data.get("note", ""),
            user=request.user,
        )
        return Response(self.get_serializer(visit).data, status=201)

    @action(detail=False, methods=["post"])
    def bulk(self, request):
        """Upload a device's offline queue.

        Answers with per-row outcomes instead of one status code: the device has
        to know which rows it may drop and which to keep trying.
        """
        serializer = BulkVisitSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        rows = serializer.validated_data["rows"]
        if request.user.role == Role.COLLECTOR.value and request.user.collector_id:
            for row in rows:
                row["collector"] = request.user.collector_id
        return Response(bulk_record_visits(rows, user=request.user))

    @action(detail=True, methods=["post"])
    def sync(self, request, pk=None):
        """Acknowledge that a queued record has reached the server."""
        visit = self.get_object()
        if not visit.synced:
            visit.synced = True
            visit.save(update_fields=["synced", "updated_at"])
        return Response(self.get_serializer(visit).data)


class CollectionRoundView(APIView):
    """`GET /api/collection/round/?collector=<id>&day=YYYY-MM-DD`

    Everything the round screen renders in one call: the stops in walking order,
    the three counts its tabs show, and the routes behind them for the headings.
    """

    permission_classes = [IsAuthenticated]

    @extend_schema(
        parameters=[
            OpenApiParameter("collector", str, description="Collector id, e.g. C-142."),
            OpenApiParameter("day", str, description="Round date as YYYY-MM-DD. Defaults to today."),
        ],
        responses={200: None},
    )
    def get(self, request):
        collector_id = own_round_only(request, request.query_params.get("collector") or "")
        day = _parse_day(request.query_params.get("day"))

        collector = Collector.objects.filter(pk=collector_id).first()
        if collector is None:
            raise NotFound("No such collector.")

        stops = round_for_collector(collector.id, day, user=request.user)
        routes = routes_for_collector(collector.id)
        return Response(
            {
                "day": day.isoformat(),
                # The id, not the record: the SPA already holds the collector list
                # and a collector-role caller must not read a colleague's profile.
                "collector": collector.id,
                "stops": stops,
                "counts": count_by_status(stops),
                "routes": RouteSerializer(routes, many=True).data,
            }
        )


class ScanView(APIView):
    """`POST /api/collection/scan/` — resolve a QR payload against a round."""

    permission_classes = [IsAuthenticated]
    serializer_class = ScanSerializer

    def post(self, request):
        serializer = ScanSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        requested = data.get("collector")
        collector_id = own_round_only(request, requested.id if requested else "")
        result = match_scan(data["raw"], collector_id, data.get("day"), user=request.user)
        # Always 200. A wrong-round or worn-label scan is an answer the collector
        # acts on, not a failed request.
        return Response(result)


def _parse_day(raw):
    if not raw:
        return timezone.localdate()
    day = parse_date(raw)
    if day is None:
        raise DomainError(f"'{raw}' is not a date (use YYYY-MM-DD).", code="bad_date")
    return day
