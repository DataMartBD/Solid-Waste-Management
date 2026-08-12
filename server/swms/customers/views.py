"""Household and potential-customer endpoints."""

from __future__ import annotations

from django.db.models import Count, F, Max, Q
from django_filters import rest_framework as filters
from rest_framework.decorators import action
from rest_framework.response import Response

from swms.common.roles import OPERATIONAL_WRITERS, Role
from swms.common.views import SwmsModelViewSet

from .models import Holding, Household, PotentialCustomer
from .serializers import (
    ConvertSerializer,
    HoldingSerializer,
    HouseholdSerializer,
    PotentialCustomerSerializer,
    VerifyLocationSerializer,
)
from .services import convert_potential, verify_location


class HoldingFilter(filters.FilterSet):
    """Query parameters the Holding Master list needs."""

    ward = filters.CharFilter(field_name="ward_id")
    zone = filters.CharFilter(field_name="ward__zone_id")
    road = filters.CharFilter(field_name="road__name", lookup_expr="iexact")
    holdingType = filters.CharFilter(field_name="holding_type_id")
    located = filters.BooleanFilter(method="filter_located")
    serviceStatus = filters.CharFilter(method="filter_service_status")

    class Meta:
        model = Holding
        fields = ["ward", "zone", "road", "status", "verified"]

    def filter_located(self, queryset, name, value):
        predicate = Q(lat__isnull=False, lng__isnull=False)
        return queryset.filter(predicate) if value else queryset.exclude(predicate)

    def filter_service_status(self, queryset, name, value):
        """`none` / `partial` / `full`, expressed in SQL rather than in Python.

        `Holding.service_status` walks the households in memory, which is fine
        for one row but would drag the whole table through Python to filter a
        list. These counts say the same thing to the database.
        """
        queryset = queryset.annotate(
            _total=Count("households", distinct=True),
            _active=Count(
                "households", filter=Q(households__status="active"), distinct=True
            ),
        )
        if value == "none":
            return queryset.filter(_active=0)
        if value == "full":
            return queryset.filter(_active__gt=0, _total=F("_active"))
        if value == "partial":
            return queryset.filter(_active__gt=0, _total__gt=F("_active"))
        return queryset


class HoldingViewSet(SwmsModelViewSet):
    """The Holding Master — every rated property, serviced or not."""

    serializer_class = HoldingSerializer
    filterset_class = HoldingFilter
    search_fields = [
        "id", "holding_no", "owner_name", "owner_phone", "road__name",
        # The register shows them, so `?search=` has to find them too — the
        # page's own box filters the page it was given, not the whole table.
        "district", "thana",
    ]
    agency_scope_field = "agency_id"
    ordering_fields = ["holding_no", "owner_name", "created_at"]
    ward_scope_field = "ward_id"
    write_roles = OPERATIONAL_WRITERS | {Role.COLLECTOR}

    def get_queryset(self):
        queryset = Holding.objects.select_related(
            "ward", "ward__zone", "road", "holding_type"
        ).prefetch_related("households")
        return self.scope_queryset(queryset)

    @action(detail=True, methods=["post"])
    def verify(self, request, pk=None):
        """Pin the building. Every household in it becomes routable at once."""
        holding = self.get_object()
        serializer = VerifyLocationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        verify_location(
            holding,
            lat=data["lat"],
            lng=data["lng"],
            accuracy=data.get("accuracy"),
            placed_by_hand=data["placedByHand"],
            user=request.user,
        )
        return Response(self.get_serializer(self.get_queryset().get(pk=holding.pk)).data)

    @action(detail=True, methods=["get"])
    def households(self, request, pk=None):
        """The families in this building, for the master's detail panel."""
        holding = self.get_object()
        rows = holding.households.select_related("tier", "payment_mode").annotate(
            last_collected_at=Max("visits__at", filter=Q(visits__status="collected"))
        )
        return Response(HouseholdSerializer(rows, many=True, context={"request": request}).data)

    @action(detail=False, methods=["get"])
    def unplanned(self, request):
        """The route planner's to-do list: buildings not yet on any route.

        A stop is a building, so this is the list the planner drags from. Split
        the way the planner presents it — what could be routed today, and what
        is blocked because nobody has pinned it on the ground yet.
        """
        queryset = self.filter_queryset(self.get_queryset()).filter(route_stop__isnull=True)
        routable = [row for row in queryset if row.verified]
        unverified = [row for row in queryset if not row.verified]
        serialize = self.get_serializer
        return Response(
            {
                "routable": serialize(routable, many=True).data,
                "unverified": serialize(unverified, many=True).data,
                "total": len(routable) + len(unverified),
            }
        )


class HouseholdFilter(filters.FilterSet):
    """Query parameters the Households page and the map need."""

    ward = filters.CharFilter(field_name="ward_id")
    zone = filters.CharFilter(field_name="ward__zone_id")
    tier = filters.CharFilter(field_name="tier_id")
    road = filters.CharFilter(field_name="road__name", lookup_expr="iexact")
    hasDues = filters.BooleanFilter(method="filter_has_dues")
    located = filters.BooleanFilter(method="filter_located")
    unplanned = filters.BooleanFilter(method="filter_unplanned")

    holding = filters.CharFilter(field_name="holding_id")

    # Location now belongs to the building, so both of these ask the holding.
    verified = filters.BooleanFilter(field_name="holding__verified")

    class Meta:
        model = Household
        fields = ["ward", "zone", "tier", "road", "status", "customer_type", "holding"]

    def filter_has_dues(self, queryset, name, value):
        return queryset.filter(dues__gt=0) if value else queryset.filter(dues=0)

    def filter_located(self, queryset, name, value):
        predicate = Q(holding__lat__isnull=False, holding__lng__isnull=False)
        return queryset.filter(predicate) if value else queryset.exclude(predicate)

    def filter_unplanned(self, queryset, name, value):
        """Households whose building has no place in any route.

        The plan is holding-wise, so a family is on a round exactly when its
        building is a stop.
        """
        return queryset.filter(holding__route_stop__isnull=value)


class HouseholdViewSet(SwmsModelViewSet):
    """CRUD plus the two domain actions the Households page performs."""

    serializer_class = HouseholdSerializer
    filterset_class = HouseholdFilter
    search_fields = ["id", "qr", "head", "holding_no", "phone", "road__name"]
    agency_scope_field = "holding__agency_id"
    ordering_fields = ["holding_no", "head", "dues", "created_at"]
    ward_scope_field = "ward_id"
    # Collectors legitimately correct customer details and verify pins in the field.
    write_roles = OPERATIONAL_WRITERS | {Role.COLLECTOR}

    def get_queryset(self):
        queryset = (
            Household.objects.select_related(
                "holding", "ward", "ward__zone", "road", "tier", "customer_type", "storage",
                "holding_type", "suitable_time", "payment_mode", "holding__route_stop",
            )
            # `lastVisit` is derived here instead of being a stale stored column.
            .annotate(
                last_collected_at=Max("visits__at", filter=Q(visits__status="collected"))
            )
        )
        return self.scope_queryset(queryset)

    # No `verify` action here. A building is pinned once, on the Holding Master
    # — POST /api/holdings/{id}/verify/ — and every household in it becomes
    # routable together. Pinning per family let two flats in one building hold
    # different coordinates.

    @action(detail=False, methods=["get"], url_path="by-qr/(?P<tag>[^/.]+)")
    def by_qr(self, request, tag=None):
        """Resolve a scanned QR tag to a household."""
        household = self.get_queryset().filter(Q(qr__iexact=tag) | Q(pk=tag)).first()
        if household is None:
            return Response({"detail": "Unknown tag.", "code": "unknown", "fields": {}}, status=404)
        return Response(self.get_serializer(household).data)


class PotentialCustomerFilter(filters.FilterSet):
    ward = filters.CharFilter(field_name="ward_id")
    zone = filters.CharFilter(field_name="ward__zone_id")
    #: Converted survey rows are hidden unless explicitly asked for.
    converted = filters.BooleanFilter(method="filter_converted")

    verified = filters.BooleanFilter(field_name="holding__verified")

    class Meta:
        model = PotentialCustomer
        fields = ["ward", "zone", "reason", "time_gap", "current_practice"]

    def filter_converted(self, queryset, name, value):
        return queryset.filter(converted_at__isnull=not value)


class PotentialCustomerViewSet(SwmsModelViewSet):
    serializer_class = PotentialCustomerSerializer
    filterset_class = PotentialCustomerFilter
    search_fields = ["id", "head", "holding_no", "phone", "road__name"]
    agency_scope_field = "holding__agency_id"
    ward_scope_field = "ward_id"
    write_roles = OPERATIONAL_WRITERS | {Role.COLLECTOR}

    def get_queryset(self):
        queryset = PotentialCustomer.objects.select_related(
            "holding", "ward", "ward__zone", "road", "est_tier", "customer_type", "storage",
            "holding_type", "suitable_time", "reason", "time_gap", "current_practice",
        )
        # Default view is "still to convert"; ?converted=true opts in to the rest.
        if self.action == "list" and "converted" not in self.request.query_params:
            queryset = queryset.filter(converted_at__isnull=True)
        return self.scope_queryset(queryset)

    # Verification moved to the holding — see the note on HouseholdViewSet.

    @action(detail=True, methods=["post"])
    def convert(self, request, pk=None):
        """Sign this holding up for service, creating a Household."""
        potential = self.get_object()
        serializer = ConvertSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        household = convert_potential(
            potential,
            tier=data.get("tier"),
            charge=data.get("charge"),
            payment_mode=data.get("paymentMode"),
            payment_day=data.get("paymentDay"),
            qr=data.get("qr") or None,
            user=request.user,
        )
        return Response(
            {
                "household": HouseholdSerializer(household, context=self.get_serializer_context()).data,
                "potential": self.get_serializer(potential).data,
            },
            status=201,
        )
