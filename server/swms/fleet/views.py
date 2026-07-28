"""Fleet endpoints: the vehicle registry, the workshop log, fuel, and telemetry.

Two things here are not plain CRUD:

* the map's initial state (`GET /api/live/`), which replaces the fake collector
  coordinates `LiveMap.jsx` invented by nudging the ward centre, and
* `POST /api/positions/ingest/`, the door a tracker gateway posts through.
"""

from __future__ import annotations

from django_filters import rest_framework as filters
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from swms.common.exceptions import DomainError
from swms.common.permissions import RoleWritePermission
from swms.common.roles import ADMIN_WRITERS, OPERATIONAL_WRITERS, Role
from swms.common.views import SwmsModelViewSet

from .models import FuelLog, Maintenance, Van
from .serializers import (
    AssignDriverSerializer,
    CloseMaintenanceSerializer,
    FuelLogSerializer,
    MaintenanceSerializer,
    PositionIngestSerializer,
    VanSerializer,
    VehiclePositionSerializer,
)
from .services import (
    assign_driver,
    close_maintenance,
    fleet_kpis,
    live_snapshot,
    log_fuel,
    open_maintenance,
    record_position,
    van_alerts,
)

#: Telemetry is written by whoever is holding the vehicle — including the
#: collector's own device — not only by the office.
POSITION_WRITERS = OPERATIONAL_WRITERS | {Role.COLLECTOR}


def _int_param(request, name, default):
    try:
        return int(request.query_params.get(name, default))
    except (TypeError, ValueError):
        return default


def _date_param(request, name):
    """Parse `?asOf=YYYY-MM-DD`; anything unparseable means 'use today'."""
    from django.utils.dateparse import parse_date

    raw = request.query_params.get(name)
    return parse_date(raw) if raw else None


class VanFilter(filters.FilterSet):
    """The Fleet registry's filter bar."""

    driver = filters.CharFilter(field_name="driver_id")
    unassigned = filters.BooleanFilter(field_name="driver_id", lookup_expr="isnull")

    class Meta:
        model = Van
        fields = ["status", "type", "fuel", "ownership", "driver"]


class VanViewSet(SwmsModelViewSet):
    """The vehicle registry, plus driver assignment, telemetry, alerts and KPIs."""

    serializer_class = VanSerializer
    filterset_class = VanFilter
    search_fields = ["id", "plate", "gps", "driver__name"]
    ordering_fields = ["id", "plate", "odometer", "status", "capacity"]
    # No ward scoping: the fleet is a city-wide asset pool. A van works whichever
    # ward it is sent to, so `ward_scope_field` stays unset.
    ward_scope_field = None
    # Buying, registering and retiring vehicles is an admin act, not an
    # operational one — a supervisor logs work against a van but does not create it.
    write_roles = ADMIN_WRITERS

    def get_queryset(self):
        return self.scope_queryset(Van.objects.select_related("driver", "driver__ward"))

    def get_permissions(self):
        # Telemetry arrives from the vehicle, so that one action widens the write
        # roles without opening the rest of the registry to collectors.
        if self.action == "position":
            self.write_roles = POSITION_WRITERS
        return super().get_permissions()

    @action(detail=True, methods=["post"], url_path="assign-driver")
    def assign_driver(self, request, pk=None):
        """Set (or clear) this van's driver, releasing them from any other van."""
        van = self.get_object()
        serializer = AssignDriverSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        assign_driver(van, serializer.validated_data["driver"])
        return Response(self.get_serializer(self.get_queryset().get(pk=van.pk)).data)

    @action(detail=True, methods=["post"])
    def position(self, request, pk=None):
        """Accept one GPS ping for this van and fan it out to the live map."""
        van = self.get_object()
        if isinstance(request.data, list):
            raise DomainError(
                "Post one ping here; use /api/positions/ingest/ for a batch.",
                code="single_ping_only",
            )
        # The van comes from the URL, so the body does not have to repeat it.
        serializer = PositionIngestSerializer(data={**request.data, "van": van.pk})
        serializer.is_valid(raise_exception=True)
        data = dict(serializer.validated_data)
        data.pop("van")
        position = record_position(van, **data)
        return Response(VehiclePositionSerializer(position).data, status=201)

    @extend_schema(responses={200: OpenApiTypes.OBJECT})
    @action(detail=False, methods=["get"])
    def alerts(self, request):
        """Expiring paperwork and service-due warnings for the whole fleet.

        Computed against **today**, unlike the mock's `buildAlerts()`, which
        compared every date to a hard-coded `new Date('2026-07-05')` and so froze
        the panel at the day the demo data was written. `?asOf=YYYY-MM-DD` is
        there for testing and for "what will be due next month" questions;
        `?within=30` widens or narrows the horizon.
        """
        return Response(
            van_alerts(
                as_of=_date_param(request, "asOf"),
                within_days=_int_param(request, "within", 30),
            )
        )

    @extend_schema(responses={200: OpenApiTypes.OBJECT})
    @action(detail=False, methods=["get"])
    def kpis(self, request):
        """Availability, downtime, efficiency and spend — the page's stat cards."""
        return Response(
            fleet_kpis(
                as_of=_date_param(request, "asOf"),
                within_days=_int_param(request, "within", 30),
            )
        )


class MaintenanceFilter(filters.FilterSet):
    van = filters.CharFilter(field_name="van_id")
    #: `?isOpen=true` is the workshop's own to-do list.
    isOpen = filters.BooleanFilter(field_name="closed", lookup_expr="isnull")

    class Meta:
        model = Maintenance
        fields = ["van", "kind", "isOpen"]


class MaintenanceViewSet(SwmsModelViewSet):
    """Workshop history. Creating a job may take the van off the road."""

    serializer_class = MaintenanceSerializer
    filterset_class = MaintenanceFilter
    search_fields = ["id", "van_id", "reason", "vendor"]
    ordering_fields = ["opened", "closed", "cost", "downtime"]
    # Fleet is city-wide (see VanViewSet).
    ward_scope_field = None
    write_roles = OPERATIONAL_WRITERS

    def get_queryset(self):
        return self.scope_queryset(Maintenance.objects.select_related("van"))

    def perform_create(self, serializer):
        """Route creation through the service so the van's status follows.

        The mock did this in the page — write the record, then write the van —
        and a failure between the two left a broken-down vehicle still counted as
        available.
        """
        data = serializer.validated_data
        serializer.instance = open_maintenance(
            data["van"],
            kind=data["kind"],
            reason=data["reason"],
            odometer=data["odometer"],
            vendor=data.get("vendor", ""),
            cost=data.get("cost", 0),
            user=self.request.user,
        )

    @action(detail=True, methods=["post"])
    def close(self, request, pk=None):
        """Sign the job off, computing downtime and freeing the van."""
        maintenance = self.get_object()
        serializer = CloseMaintenanceSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        close_maintenance(
            maintenance,
            closed=data.get("closed"),
            cost=data.get("cost"),
            downtime=data.get("downtime"),
        )
        return Response(self.get_serializer(maintenance).data)


class FuelLogFilter(filters.FilterSet):
    van = filters.CharFilter(field_name="van_id")
    #: Exposes `?at_after=` / `?at_before=` for the monthly fuel-spend view.
    at = filters.DateTimeFromToRangeFilter()

    class Meta:
        model = FuelLog
        fields = ["van", "by", "at"]


class FuelLogViewSet(SwmsModelViewSet):
    """Refuelling and charging events."""

    serializer_class = FuelLogSerializer
    filterset_class = FuelLogFilter
    search_fields = ["id", "van_id"]
    ordering_fields = ["at", "litres", "cost", "odometer", "kmpl"]
    # Fleet is city-wide (see VanViewSet).
    ward_scope_field = None
    write_roles = OPERATIONAL_WRITERS

    def get_queryset(self):
        return self.scope_queryset(FuelLog.objects.select_related("van", "by"))

    def perform_create(self, serializer):
        """Use the service so the pump reading also moves the van's odometer."""
        data = serializer.validated_data
        serializer.instance = log_fuel(
            data["van"],
            litres=data["litres"],
            cost=data["cost"],
            odometer=data["odometer"],
            by=data.get("by"),
            at=data.get("at"),
        )


class PositionIngestView(APIView):
    """Where a tracker gateway posts telemetry.

    Accepts either one ping or an array of them: a device coming back from a dead
    spot flushes its queue in a single request, which is much cheaper than one
    HTTP round trip per stored ping over a mobile link.
    """

    permission_classes = [RoleWritePermission]
    write_roles = POSITION_WRITERS
    serializer_class = PositionIngestSerializer

    def post(self, request):
        serializer = PositionIngestSerializer.for_payload(request.data)
        serializer.is_valid(raise_exception=True)
        batch = serializer.validated_data
        if not isinstance(batch, list):
            batch = [batch]

        positions = []
        for ping in batch:
            ping = dict(ping)
            van = ping.pop("van")
            positions.append(record_position(van, **ping))
        return Response(
            {
                "accepted": len(positions),
                "positions": VehiclePositionSerializer(positions, many=True).data,
            },
            status=201,
        )


class LiveMapView(APIView):
    """`GET /api/live/` — everything the map draws on first paint.

    The mock's LiveMap had no positions to draw, so it fabricated them by shifting
    a household in the collector's ward by a fixed offset. This returns real
    telemetry; the websocket at `/ws/live/` then streams updates on top of it, so
    the page loads a snapshot once instead of polling.
    """

    permission_classes = [IsAuthenticated]

    @extend_schema(responses={200: OpenApiTypes.OBJECT})
    def get(self, request):
        return Response(live_snapshot(ward_ids=request.user.visible_ward_ids()))
