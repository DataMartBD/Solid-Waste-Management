"""Household and potential-customer endpoints."""

from __future__ import annotations

from django.db.models import Max, Q
from django_filters import rest_framework as filters
from rest_framework.decorators import action
from rest_framework.response import Response

from swms.common.roles import OPERATIONAL_WRITERS, Role
from swms.common.views import SwmsModelViewSet

from .models import Household, PotentialCustomer
from .serializers import (
    ConvertSerializer,
    HouseholdSerializer,
    PotentialCustomerSerializer,
    VerifyLocationSerializer,
)
from .services import convert_potential, verify_location


class HouseholdFilter(filters.FilterSet):
    """Query parameters the Households page and the map need."""

    ward = filters.CharFilter(field_name="ward_id")
    zone = filters.CharFilter(field_name="ward__zone_id")
    tier = filters.CharFilter(field_name="tier_id")
    road = filters.CharFilter(field_name="road__name", lookup_expr="iexact")
    hasDues = filters.BooleanFilter(method="filter_has_dues")
    located = filters.BooleanFilter(method="filter_located")
    unplanned = filters.BooleanFilter(method="filter_unplanned")

    class Meta:
        model = Household
        fields = ["ward", "zone", "tier", "road", "status", "verified", "customer_type"]

    def filter_has_dues(self, queryset, name, value):
        return queryset.filter(dues__gt=0) if value else queryset.filter(dues=0)

    def filter_located(self, queryset, name, value):
        predicate = Q(lat__isnull=False, lng__isnull=False)
        return queryset.filter(predicate) if value else queryset.exclude(predicate)

    def filter_unplanned(self, queryset, name, value):
        """Holdings with no place in any route."""
        return queryset.filter(route_stop__isnull=value)


class HouseholdViewSet(SwmsModelViewSet):
    """CRUD plus the two domain actions the Households page performs."""

    serializer_class = HouseholdSerializer
    filterset_class = HouseholdFilter
    search_fields = ["id", "qr", "head", "holding", "phone", "road__name"]
    ordering_fields = ["holding", "head", "dues", "created_at"]
    ward_scope_field = "ward_id"
    # Collectors legitimately correct customer details and verify pins in the field.
    write_roles = OPERATIONAL_WRITERS | {Role.COLLECTOR}

    def get_queryset(self):
        queryset = (
            Household.objects.select_related(
                "ward", "ward__zone", "road", "tier", "customer_type", "storage",
                "holding_type", "suitable_time", "payment_mode", "route_stop",
            )
            # `lastVisit` is derived here instead of being a stale stored column.
            .annotate(
                last_collected_at=Max("visits__at", filter=Q(visits__status="collected"))
            )
        )
        return self.scope_queryset(queryset)

    @action(detail=True, methods=["post"])
    def verify(self, request, pk=None):
        """Confirm this holding's GPS pin — the gate for putting it on a route."""
        household = self.get_object()
        serializer = VerifyLocationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        verify_location(
            household,
            lat=data["lat"],
            lng=data["lng"],
            accuracy=data.get("accuracy"),
            placed_by_hand=data["placedByHand"],
            user=request.user,
        )
        return Response(self.get_serializer(self.get_queryset().get(pk=household.pk)).data)

    @action(detail=False, methods=["get"])
    def unplanned(self, request):
        """The route planner's to-do list: what is not yet on any route.

        Split the way the planner presents it — holdings that *could* be routed
        today, and holdings blocked because their location is unverified.
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

    class Meta:
        model = PotentialCustomer
        fields = ["ward", "zone", "reason", "time_gap", "current_practice", "verified"]

    def filter_converted(self, queryset, name, value):
        return queryset.filter(converted_at__isnull=not value)


class PotentialCustomerViewSet(SwmsModelViewSet):
    serializer_class = PotentialCustomerSerializer
    filterset_class = PotentialCustomerFilter
    search_fields = ["id", "head", "holding", "phone", "road__name"]
    ward_scope_field = "ward_id"
    write_roles = OPERATIONAL_WRITERS | {Role.COLLECTOR}

    def get_queryset(self):
        queryset = PotentialCustomer.objects.select_related(
            "ward", "ward__zone", "road", "est_tier", "customer_type", "storage",
            "holding_type", "suitable_time", "reason", "time_gap", "current_practice",
        )
        # Default view is "still to convert"; ?converted=true opts in to the rest.
        if self.action == "list" and "converted" not in self.request.query_params:
            queryset = queryset.filter(converted_at__isnull=True)
        return self.scope_queryset(queryset)

    @action(detail=True, methods=["post"])
    def verify(self, request, pk=None):
        potential = self.get_object()
        serializer = VerifyLocationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        verify_location(
            potential,
            lat=data["lat"],
            lng=data["lng"],
            accuracy=data.get("accuracy"),
            placed_by_hand=data["placedByHand"],
            user=request.user,
        )
        return Response(self.get_serializer(potential).data)

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
