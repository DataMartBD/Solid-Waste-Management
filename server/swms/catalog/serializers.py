"""Reference-data serializers.

Every option row keeps both `key` (i18n lookup) and `label` (English fallback),
because the React dictionaries resolve `key` and fall back to `label`.
"""

from __future__ import annotations

from rest_framework import serializers

from .models import (
    AgencyType,
    Block,
    City,
    CityType,
    DumpingPoint,
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


def option_serializer(model_cls, *, extra=()):
    """Build a `{id, key, label}` serializer for an option table.

    The eight option tables are structurally identical, so the serializers are
    generated rather than written out eight times.
    """

    meta = type("Meta", (), {"model": model_cls, "fields": ["id", "key", "label", *extra]})
    return type(f"{model_cls.__name__}Serializer", (serializers.ModelSerializer,), {"Meta": meta})


CustomerTypeSerializer = option_serializer(CustomerType)
HoldingTypeSerializer = option_serializer(HoldingType)
StorageTypeSerializer = option_serializer(StorageType)
SuitableTimeSerializer = option_serializer(SuitableTime)
PaymentModeSerializer = option_serializer(PaymentMode)
PotentialReasonSerializer = option_serializer(PotentialReason)
TimeGapSerializer = option_serializer(TimeGap)
CurrentPracticeSerializer = option_serializer(CurrentPractice)
# The two setup lists edited on the Setup page, which needs `active` to hide one.
CityTypeSerializer = option_serializer(CityType, extra=("sort_order", "active"))
AgencyTypeSerializer = option_serializer(AgencyType, extra=("sort_order", "active"))


class TierSerializer(serializers.ModelSerializer):
    class Meta:
        model = Tier
        fields = ["id", "key", "label", "charge"]


class CitySerializer(serializers.ModelSerializer):
    nameBn = serializers.CharField(source="name_bn", required=False, allow_blank=True)
    cityType = serializers.PrimaryKeyRelatedField(
        source="city_type", queryset=CityType.objects.all(), allow_null=True, required=False
    )
    lat = serializers.FloatField(allow_null=True, required=False)
    lng = serializers.FloatField(allow_null=True, required=False)
    collectionCutoff = serializers.TimeField(source="collection_cutoff", required=False)
    complaintDeadline = serializers.TimeField(source="complaint_deadline", required=False)

    class Meta:
        model = City
        fields = [
            "id",
            "name",
            "nameBn",
            "cityType",
            "district",
            "lat",
            "lng",
            "collectionCutoff",
            "complaintDeadline",
            "active",
        ]


class ZoneSerializer(serializers.ModelSerializer):
    city = serializers.PrimaryKeyRelatedField(
        queryset=City.objects.all(), allow_null=True, required=False
    )
    nameBn = serializers.CharField(source="name_bn", required=False, allow_blank=True, max_length=64)

    class Meta:
        model = Zone
        fields = ["id", "key", "name", "nameBn", "city"]


class WardSerializer(serializers.ModelSerializer):
    """`zone` is the zone id, matching the mock's `{ id, key, name, zone }`."""

    zone = serializers.PrimaryKeyRelatedField(queryset=Zone.objects.all())
    #: Through the zone; read-only, so a ward moves city by moving zone.
    city = serializers.CharField(source="zone.city_id", read_only=True, default=None)
    nameBn = serializers.CharField(source="name_bn", required=False, allow_blank=True, max_length=96)
    lat = serializers.FloatField(allow_null=True, required=False)
    lng = serializers.FloatField(allow_null=True, required=False)

    class Meta:
        model = Ward
        fields = ["id", "key", "name", "nameBn", "zone", "city", "lat", "lng", "active"]


class DumpingPointSerializer(serializers.ModelSerializer):
    """A dumping area, disposal site or transfer station, and the wards it serves."""

    nameBn = serializers.CharField(source="name_bn", required=False, allow_blank=True, max_length=120)
    city = serializers.PrimaryKeyRelatedField(queryset=City.objects.all())
    wards = serializers.PrimaryKeyRelatedField(queryset=Ward.objects.all(), many=True, required=False)
    lat = serializers.FloatField(allow_null=True, required=False)
    lng = serializers.FloatField(allow_null=True, required=False)
    capacityTonnes = serializers.DecimalField(
        source="capacity_tonnes", max_digits=8, decimal_places=2, allow_null=True,
        required=False, coerce_to_string=False,
    )

    class Meta:
        model = DumpingPoint
        fields = [
            "id", "name", "nameBn", "kind", "city", "wards", "lat", "lng",
            "capacityTonnes", "notes", "active",
        ]

    def validate(self, attrs):
        """It serves wards of its own city only."""
        attrs = super().validate(attrs)
        city = attrs.get("city", getattr(self.instance, "city", None))
        wards = attrs.get("wards")
        if city is not None and wards:
            foreign = sorted(w.id for w in wards if w.zone.city_id != city.id)
            if foreign:
                raise serializers.ValidationError({"wards": f"Not in {city.name}: {', '.join(foreign)}"})
        return attrs


class BlockSerializer(serializers.ModelSerializer):
    ward = serializers.CharField(source="ward_id")

    class Meta:
        model = Block
        fields = ["id", "ward", "name"]


class RoadSerializer(serializers.ModelSerializer):
    ward = serializers.CharField(source="ward_id")

    class Meta:
        model = Road
        fields = ["id", "ward", "name"]
