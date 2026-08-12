"""Reference-data endpoints.

`GET /api/catalog/` returns everything the React app used to import from
mockData.js as static arrays, in one round trip. The individual CRUD viewsets
below exist so an agency admin can maintain the lists.

None of it is agency-scoped, and that is a decision rather than an omission:
wards, roads, tiers and the option lists are the city's own vocabulary. Two
contractors working the same ward must name the same road the same way, and
hiding Ward 14 from one of them would break every form that offers it.
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
    Block,
    BLOOD_GROUPS,
    CurrentPractice,
    CustomerType,
    GeoLocation,
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
    BlockSerializer,
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


def geography():
    """The district and thana lists the holding form offers.

    Read as one pass over the distinct district/upazila pairs — 489 rows, not
    the 4,537 unions — and shipped whole rather than behind a second endpoint
    that the form would have to call every time the district changed. It is the
    same shape as `roadsByWard` for the same reason: a list, and a map from the
    parent that narrows it.
    """
    pairs = (
        GeoLocation.objects
        .values_list("district_name", "district_bn", "upazila_name", "upazila_bn")
        .order_by("district_name", "upazila_name")
        .distinct()
    )

    districts: dict[str, str] = {}
    thanas: dict[str, list[dict]] = {}
    for district, district_bn, upazila, upazila_bn in pairs:
        districts.setdefault(district, district_bn)
        thanas.setdefault(district, []).append({"name": upazila, "nameBn": upazila_bn})

    return (
        [{"name": name, "nameBn": name_bn} for name, name_bn in districts.items()],
        thanas,
    )


@extend_schema(responses=OpenApiTypes.OBJECT)
@api_view(["GET"])
@permission_classes([IsAuthenticated])
def catalog_bundle(request):
    """One call that replaces every static import from mockData.js."""
    wards = Ward.objects.filter(active=True).select_related("zone").prefetch_related(
        Prefetch("roads", queryset=Road.objects.filter(active=True))
    )
    ward_rows = list(wards)
    districts, thanas_by_district = geography()

    payload = {
        "zones": ZoneSerializer(Zone.objects.all(), many=True).data,
        "wards": WardSerializer(ward_rows, many=True).data,
        # The Households form indexes roads by ward, exactly as roadsByWard did.
        "roadsByWard": {ward.id: [road.name for road in ward.roads.all()] for ward in ward_rows},
        # National geography, above the city's own wards: the holding form asks
        # for a district and the thana within it.
        "districts": districts,
        "thanasByDistrict": thanas_by_district,
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


class BlockViewSet(SwmsModelViewSet):
    """Blocks of a ward — the unit a surveyor is given to walk.

    Filtered by ward in practice: the survey form's block dropdown reloads from
    `?ward=W-22` whenever the ward above it changes.
    """

    queryset = Block.objects.select_related("ward").all()
    serializer_class = BlockSerializer
    write_roles = ADMIN_WRITERS
    filterset_fields = ["ward", "active"]
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
