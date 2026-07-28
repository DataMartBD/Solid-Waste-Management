"""Reference-data serializers.

Every option row keeps both `key` (i18n lookup) and `label` (English fallback),
because the React dictionaries resolve `key` and fall back to `label`.
"""

from __future__ import annotations

from rest_framework import serializers

from .models import (
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


def option_serializer(model_cls):
    """Build a `{id, key, label}` serializer for an option table.

    The eight option tables are structurally identical, so the serializers are
    generated rather than written out eight times.
    """

    meta = type("Meta", (), {"model": model_cls, "fields": ["id", "key", "label"]})
    return type(f"{model_cls.__name__}Serializer", (serializers.ModelSerializer,), {"Meta": meta})


CustomerTypeSerializer = option_serializer(CustomerType)
HoldingTypeSerializer = option_serializer(HoldingType)
StorageTypeSerializer = option_serializer(StorageType)
SuitableTimeSerializer = option_serializer(SuitableTime)
PaymentModeSerializer = option_serializer(PaymentMode)
PotentialReasonSerializer = option_serializer(PotentialReason)
TimeGapSerializer = option_serializer(TimeGap)
CurrentPracticeSerializer = option_serializer(CurrentPractice)


class TierSerializer(serializers.ModelSerializer):
    class Meta:
        model = Tier
        fields = ["id", "key", "label", "charge"]


class ZoneSerializer(serializers.ModelSerializer):
    class Meta:
        model = Zone
        fields = ["id", "key", "name"]


class WardSerializer(serializers.ModelSerializer):
    """`zone` is the zone id, matching the mock's `{ id, key, name, zone }`."""

    zone = serializers.CharField(source="zone_id")
    lat = serializers.FloatField(allow_null=True, required=False)
    lng = serializers.FloatField(allow_null=True, required=False)

    class Meta:
        model = Ward
        fields = ["id", "key", "name", "zone", "lat", "lng"]


class RoadSerializer(serializers.ModelSerializer):
    ward = serializers.CharField(source="ward_id")

    class Meta:
        model = Road
        fields = ["id", "ward", "name"]
