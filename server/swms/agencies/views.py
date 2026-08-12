"""Agency endpoints.

Deliberately **not** ward-scoped. An agency is master data like the fleet and
the tier list: a supervisor needs to see which contractor works the next ward to
read a report at all. When agency becomes a tenancy boundary that changes, and
it changes here as one decision rather than as a side effect of this module.
"""

from __future__ import annotations

from django_filters import rest_framework as filters
from drf_spectacular.utils import extend_schema
from rest_framework.decorators import action
from rest_framework.response import Response

from swms.common.roles import ADMIN_WRITERS
from swms.common.views import SwmsModelViewSet
from swms.fieldops.models import Collector

from .models import Agency
from .serializers import (
    AgencySerializer,
    CollectorEmploymentSerializer,
    TransferCollectorSerializer,
)
from .services import transfer_collector


class AgencyFilter(filters.FilterSet):
    ward = filters.CharFilter(field_name="service_wards__id")
    agencyType = filters.CharFilter(field_name="agency_type")

    class Meta:
        model = Agency
        fields = ["status", "active", "ward", "agencyType"]


class AgencyViewSet(SwmsModelViewSet):
    """The agencies under contract to the city corporation."""

    serializer_class = AgencySerializer
    filterset_class = AgencyFilter
    search_fields = ["id", "name", "short_code", "contact_person", "phone", "contract_no"]
    ordering_fields = ["name", "short_code", "contract_end", "created_at"]
    agency_scope_field = "id"
    # Staff and contract records are master data, like the fleet and the tiers.
    write_roles = ADMIN_WRITERS

    def get_queryset(self):
        return self.scope_queryset(
            Agency.objects.prefetch_related("service_wards", "collectors", "holdings")
        )

    @action(detail=True, methods=["get"])
    def collectors(self, request, pk=None):
        """Who this agency currently employs."""
        agency = self.get_object()
        rows = agency.collectors.select_related("ward").order_by("name")
        return Response(
            [
                {
                    "id": c.id,
                    "name": c.name,
                    "dspId": c.dsp_id,
                    "ward": c.ward_id,
                    "status": c.status,
                    "active": c.active,
                }
                for c in rows
            ]
        )

    @action(detail=True, methods=["get"], url_path="employment-history")
    def employment_history(self, request, pk=None):
        """Every collector this agency has employed, and when."""
        agency = self.get_object()
        rows = agency.employments.select_related("agency").order_by("-from_date", "collector_id")
        return Response(CollectorEmploymentSerializer(rows, many=True).data)


class CollectorTransferMixin:
    """Adds `POST /collectors/{id}/transfer/` to the fieldops viewset.

    Kept here rather than in fieldops so the employment rules live beside the
    model that records them; fieldops mixes it in.
    """

    @extend_schema(request=TransferCollectorSerializer, responses={200: None})
    @action(detail=True, methods=["post"])
    def transfer(self, request, pk=None):
        collector = self.get_object()
        serializer = TransferCollectorSerializer(
            data=request.data, context=self.get_serializer_context()
        )
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        transfer_collector(
            collector,
            data["agency"],
            on_date=data.get("onDate"),
            note=data.get("note", ""),
        )
        collector.refresh_from_db()
        return Response(
            CollectorEmploymentSerializer(
                collector.employments.order_by("-from_date"), many=True
            ).data
        )
