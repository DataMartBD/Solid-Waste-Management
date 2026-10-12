"""Household and potential-customer endpoints."""

from __future__ import annotations

from django.db.models import Count, F, Q
from django.http import HttpResponse
from django_filters import rest_framework as filters
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema, inline_serializer
from rest_framework import serializers
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response

from swms.common.exceptions import DomainError
from swms.common.roles import ADMIN_WRITERS, OPERATIONAL_WRITERS, Role
from swms.common.views import StampsCreatorAgencyMixin, SwmsModelViewSet

from . import importer

XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

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
    #: `?unitsMismatch=true` — holdings whose active households do not equal units.
    unitsMismatch = filters.BooleanFilter(method="filter_units_mismatch")

    class Meta:
        model = Holding
        fields = ["ward", "zone", "road", "status", "verified"]

    def filter_located(self, queryset, name, value):
        predicate = Q(lat__isnull=False, lng__isnull=False)
        return queryset.filter(predicate) if value else queryset.exclude(predicate)

    def filter_units_mismatch(self, queryset, name, value):
        queryset = queryset.filter(units_total__isnull=False).annotate(
            _families=Count("households", filter=Q(households__status="active"), distinct=True)
        )
        if value:
            return queryset.exclude(_families=F("units_total"))
        return queryset.filter(_families=F("units_total"))

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


class HoldingViewSet(StampsCreatorAgencyMixin, SwmsModelViewSet):
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
            "ward", "ward__zone", "road", "holding_type", "tier", "payment_mode", "route_stop"
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
        rows = holding.households.select_related("holding", "holding__route_stop")
        return Response(HouseholdSerializer(rows, many=True, context={"request": request}).data)

    def _require_admin(self, request):
        user = request.user
        if not (user.is_superuser or user.role in ADMIN_WRITERS):
            raise PermissionDenied("Only an administrator can upload holdings in bulk.")

    @extend_schema(
        request={
            "multipart/form-data": inline_serializer(
                name="HoldingImportRequest",
                fields={
                    "file": serializers.FileField(help_text="Excel (.xlsx) or CSV (.csv)"),
                    "commit": serializers.BooleanField(
                        required=False, help_text="false (default) previews; true writes the valid rows"
                    ),
                },
            )
        },
        responses=OpenApiTypes.OBJECT,
    )
    @action(
        detail=False, methods=["post"], url_path="import",
        parser_classes=[MultiPartParser, FormParser],
    )
    def bulk_import(self, request):
        """Upload holdings from Excel or CSV. `commit=false` (default) only previews.

        Every row is validated and reported; `commit=true` then writes the
        valid rows in one transaction and skips the invalid ones.
        """
        self._require_admin(request)
        upload = request.FILES.get("file")
        if upload is None:
            raise DomainError("Choose an Excel or CSV file to upload.", code="file_required")
        commit = str(request.data.get("commit", "")).lower() in {"1", "true", "yes"}
        try:
            result = importer.run_import(upload, request.user, commit=commit)
        except importer.ImportFileError as exc:
            raise DomainError(str(exc), code="bad_import_file") from exc
        return Response(result)

    @extend_schema(responses={(200, XLSX): OpenApiTypes.BINARY})
    @action(detail=False, methods=["get"], url_path="import-template")
    def import_template(self, request):
        """The .xlsx to fill in: the client's columns, an example row and notes."""
        self._require_admin(request)
        response = HttpResponse(importer.template_workbook(), content_type=XLSX)
        response["Content-Disposition"] = 'attachment; filename="holdings-upload-template.xlsx"'
        return response

    @extend_schema(parameters=[OpenApiParameter("tag", str, OpenApiParameter.PATH,
        description="Building QR tag (SS-…) or holding id")])
    @action(detail=False, methods=["get"], url_path="by-qr/(?P<tag>[^/.]+)")
    def by_qr(self, request, tag=None):
        """Resolve a scanned building QR tag (or a holding id) to its holding."""
        holding = self.get_queryset().filter(Q(qr__iexact=tag) | Q(pk=tag)).first()
        if holding is None:
            return Response({"detail": "Unknown tag.", "code": "unknown", "fields": {}}, status=404)
        return Response(self.get_serializer(holding).data)

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
    road = filters.CharFilter(field_name="road__name", lookup_expr="iexact")
    located = filters.BooleanFilter(method="filter_located")
    unplanned = filters.BooleanFilter(method="filter_unplanned")

    holding = filters.CharFilter(field_name="holding_id")

    # Location now belongs to the building, so both of these ask the holding.
    verified = filters.BooleanFilter(field_name="holding__verified")

    class Meta:
        model = Household
        fields = ["ward", "zone", "road", "status", "customer_type", "holding"]

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
    search_fields = ["id", "head", "holding_no", "phone", "road__name"]
    agency_scope_field = "holding__agency_id"
    ordering_fields = ["holding_no", "head", "created_at"]
    ward_scope_field = "ward_id"
    # Collectors legitimately correct customer details and verify pins in the field.
    write_roles = OPERATIONAL_WRITERS | {Role.COLLECTOR}

    def get_queryset(self):
        queryset = (
            Household.objects.select_related(
                "holding", "ward", "ward__zone", "road", "customer_type", "storage",
                "holding_type", "suitable_time", "holding__route_stop",
            )
        )
        return self.scope_queryset(queryset)

    # No `verify` action here. A building is pinned once, on the Holding Master
    # — POST /api/holdings/{id}/verify/ — and every household in it becomes
    # routable together. Pinning per family let two flats in one building hold
    # different coordinates.



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
        """Sign this survey up: a Household in the holding, terms on the holding."""
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
            user=request.user,
        )
        return Response(
            {
                "household": HouseholdSerializer(household, context=self.get_serializer_context()).data,
                "potential": self.get_serializer(potential).data,
            },
            status=201,
        )
