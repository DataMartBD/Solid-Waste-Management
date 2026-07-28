"""Reference-data endpoints.

`GET /api/catalog/` returns everything the React app used to import from
mockData.js as static arrays, in one round trip. The individual CRUD viewsets
below exist so an agency admin can maintain the lists.
"""

from __future__ import annotations

from django.db.models import Prefetch
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from swms.common.roles import ADMIN_WRITERS
from swms.common.views import SwmsModelViewSet

from .models import (
    BLOOD_GROUPS,
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
from .serializers import (
    CurrentPracticeSerializer,
    CustomerTypeSerializer,
    HoldingTypeSerializer,
    PaymentModeSerializer,
    PotentialReasonSerializer,
    RoadSerializer,
    StorageTypeSerializer,
    SuitableTimeSerializer,
    TierSerializer,
    TimeGapSerializer,
    WardSerializer,
    ZoneSerializer,
)

#: name in the API payload -> (model, serializer)
OPTION_LISTS = {
    "customerTypes": (CustomerType, CustomerTypeSerializer),
    "holdingTypes": (HoldingType, HoldingTypeSerializer),
    "storageTypes": (StorageType, StorageTypeSerializer),
    "suitableTimes": (SuitableTime, SuitableTimeSerializer),
    "paymentModes": (PaymentMode, PaymentModeSerializer),
    "potentialReasons": (PotentialReason, PotentialReasonSerializer),
    "timeGaps": (TimeGap, TimeGapSerializer),
    "currentPractices": (CurrentPractice, CurrentPracticeSerializer),
}


@extend_schema(responses=OpenApiTypes.OBJECT)
@api_view(["GET"])
@permission_classes([IsAuthenticated])
def catalog_bundle(request):
    """One call that replaces every static import from mockData.js."""
    wards = Ward.objects.filter(active=True).select_related("zone").prefetch_related(
        Prefetch("roads", queryset=Road.objects.filter(active=True))
    )
    ward_rows = list(wards)

    payload = {
        "zones": ZoneSerializer(Zone.objects.all(), many=True).data,
        "wards": WardSerializer(ward_rows, many=True).data,
        # The Households form indexes roads by ward, exactly as roadsByWard did.
        "roadsByWard": {ward.id: [road.name for road in ward.roads.all()] for ward in ward_rows},
        "tiers": TierSerializer(Tier.objects.filter(active=True), many=True).data,
        "bloodGroups": BLOOD_GROUPS,
    }
    for name, (model, serializer_cls) in OPTION_LISTS.items():
        payload[name] = serializer_cls(model.objects.filter(active=True), many=True).data
    return Response(payload)


class ZoneViewSet(SwmsModelViewSet):
    queryset = Zone.objects.all()
    serializer_class = ZoneSerializer
    write_roles = ADMIN_WRITERS


class WardViewSet(SwmsModelViewSet):
    queryset = Ward.objects.select_related("zone").all()
    serializer_class = WardSerializer
    write_roles = ADMIN_WRITERS
    filterset_fields = ["zone", "active"]
    search_fields = ["id", "name"]


class RoadViewSet(SwmsModelViewSet):
    queryset = Road.objects.select_related("ward").all()
    serializer_class = RoadSerializer
    write_roles = ADMIN_WRITERS
    filterset_fields = ["ward", "active"]
    search_fields = ["name"]


class TierViewSet(SwmsModelViewSet):
    queryset = Tier.objects.all()
    serializer_class = TierSerializer
    write_roles = ADMIN_WRITERS
