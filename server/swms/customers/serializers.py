"""Household and potential-customer serializers.

The JSON keys are the React app's existing field names, so the pages keep
working: `qr`, `holding`, `head`, `altPhone`, `membersUnder5`, `estTier`,
`verifiedAt`, `placedByHand`, and so on.

Two translations happen here:

* `ward`, `tier`, `storage` and friends are foreign keys but travel as their
  string ids, which is what the UI already binds to `<select>` values.
* `road` travels as a **name** (`'KDA Avenue'`) while being stored as a foreign
  key. It is resolved against the holding's ward, so the same road name in two
  wards stays two distinct rows.
"""

from __future__ import annotations

from rest_framework import serializers

from swms.catalog.models import (
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
)
from swms.common.serializers import SwmsModelSerializer
from swms.fieldops.models import Collector

from .models import Household, PotentialCustomer


class RoadNameField(serializers.CharField):
    """Reads/writes a road as its name; the ward decides which row that is."""

    def to_representation(self, value):
        return value.name if value else ""


class HoldingSerializerBase(SwmsModelSerializer):
    """Fields shared by households and surveyed potential customers."""

    ward = serializers.PrimaryKeyRelatedField(queryset=Ward.objects.all())
    road = RoadNameField()

    lat = serializers.FloatField(allow_null=True, required=False)
    lng = serializers.FloatField(allow_null=True, required=False)
    verifiedAt = serializers.DateTimeField(source="verified_at", allow_null=True, required=False)
    verifiedBy = serializers.CharField(source="verified_by_label", read_only=True)
    placedByHand = serializers.BooleanField(source="placed_by_hand", required=False)

    # --- contact profile --------------------------------------------------- #
    customerType = serializers.PrimaryKeyRelatedField(
        source="customer_type", queryset=CustomerType.objects.all()
    )
    altPhone = serializers.CharField(source="alt_phone", required=False, allow_blank=True)
    contactPerson = serializers.CharField(source="contact_person", required=False, allow_blank=True)
    bloodGroup = serializers.CharField(source="blood_group", required=False, allow_blank=True)
    membersUnder5 = serializers.IntegerField(source="members_under5", required=False)
    membersFemale = serializers.IntegerField(source="members_female", required=False)
    storage = serializers.PrimaryKeyRelatedField(queryset=StorageType.objects.all())
    holdingType = serializers.PrimaryKeyRelatedField(
        source="holding_type", queryset=HoldingType.objects.all()
    )
    suitableTime = serializers.PrimaryKeyRelatedField(
        source="suitable_time", queryset=SuitableTime.objects.all()
    )

    #: Subclasses list the profile keys they expose.
    PROFILE_FIELDS = [
        "customerType",
        "profession",
        "address",
        "email",
        "altPhone",
        "contactPerson",
        "bloodGroup",
        "members",
        "membersUnder5",
        "membersFemale",
        "storage",
        "holdingType",
        "floor",
        "suitableTime",
    ]
    LOCATION_FIELDS = [
        "ward",
        "road",
        "holding",
        "head",
        "phone",
        "lat",
        "lng",
        "accuracy",
        "verified",
        "verifiedAt",
        "verifiedBy",
        "placedByHand",
    ]

    def validate(self, attrs):
        attrs = super().validate(attrs)
        self._resolve_road(attrs)
        return attrs

    def _resolve_road(self, attrs):
        """Turn the incoming road *name* into a Road row inside the right ward."""
        if "road" not in attrs:
            return
        name = (attrs.pop("road") or "").strip()
        ward = attrs.get("ward") or (self.instance.ward if self.instance else None)
        if not name:
            raise serializers.ValidationError({"road": "A road is required."})
        if ward is None:
            raise serializers.ValidationError({"ward": "A ward is required."})
        road = Road.objects.filter(ward=ward, name__iexact=name).first()
        if road is None:
            raise serializers.ValidationError(
                {"road": f"'{name}' is not a known road in {ward.short_label}."}
            )
        attrs["road"] = road


class HouseholdSerializer(HoldingSerializerBase):
    """A holding under service."""

    tier = serializers.PrimaryKeyRelatedField(queryset=Tier.objects.all())
    paymentMode = serializers.PrimaryKeyRelatedField(
        source="payment_mode", queryset=PaymentMode.objects.all()
    )
    paymentDay = serializers.IntegerField(source="payment_day", required=False)
    # Derived, not stored: the mock's `lastVisit` column went stale because
    # recording a collection never updated it.
    lastVisit = serializers.SerializerMethodField()
    effectiveCharge = serializers.IntegerField(source="effective_charge", read_only=True)
    routable = serializers.BooleanField(source="is_routable", read_only=True)
    routeId = serializers.SerializerMethodField()

    class Meta:
        model = Household
        fields = (
            ["id", "qr", "tier", "status", "dues", "charge", "paymentMode", "paymentDay"]
            + HoldingSerializerBase.LOCATION_FIELDS
            + HoldingSerializerBase.PROFILE_FIELDS
            + ["lastVisit", "effectiveCharge", "routable", "routeId"]
        )
        read_only_fields = ["id", "dues"]

    def get_lastVisit(self, obj):
        value = getattr(obj, "last_collected_at", None)
        return value.isoformat() if value else None

    def get_routeId(self, obj):
        stop = getattr(obj, "route_stop", None)
        return stop.route_id if stop else None


class PotentialCustomerSerializer(HoldingSerializerBase):
    """A surveyed holding that is not paying yet.

    Note `estTier` rather than `tier`: the tier is an estimate until the holding
    signs up and payment terms are agreed.
    """

    estTier = serializers.PrimaryKeyRelatedField(source="est_tier", queryset=Tier.objects.all())
    surveyedAt = serializers.DateField(source="surveyed_at")
    surveyor = serializers.PrimaryKeyRelatedField(
        queryset=Collector.objects.all(), allow_null=True, required=False
    )
    reason = serializers.PrimaryKeyRelatedField(queryset=PotentialReason.objects.all())
    timeGap = serializers.PrimaryKeyRelatedField(source="time_gap", queryset=TimeGap.objects.all())
    currentPractice = serializers.PrimaryKeyRelatedField(
        source="current_practice", queryset=CurrentPractice.objects.all()
    )
    convertedTo = serializers.CharField(source="converted_to_id", read_only=True)
    estimatedValue = serializers.IntegerField(source="est_tier.charge", read_only=True)

    class Meta:
        model = PotentialCustomer
        fields = (
            ["id", "estTier", "surveyedAt", "surveyor", "reason", "timeGap", "currentPractice"]
            + HoldingSerializerBase.LOCATION_FIELDS
            + HoldingSerializerBase.PROFILE_FIELDS
            + ["notes", "convertedTo", "estimatedValue"]
        )
        read_only_fields = ["id"]


class VerifyLocationSerializer(serializers.Serializer):
    """Payload for confirming a holding's map pin on the ground."""

    lat = serializers.FloatField()
    lng = serializers.FloatField()
    accuracy = serializers.IntegerField(required=False, allow_null=True)
    placedByHand = serializers.BooleanField(default=False)

    def validate_lat(self, value):
        if not (20.0 <= value <= 27.0):
            raise serializers.ValidationError("Latitude is outside Bangladesh.")
        return value

    def validate_lng(self, value):
        if not (87.0 <= value <= 93.0):
            raise serializers.ValidationError("Longitude is outside Bangladesh.")
        return value


class ConvertSerializer(serializers.Serializer):
    """Turn a potential customer into a paying household.

    Everything is optional: unspecified terms fall back to the surveyed estimate.
    """

    tier = serializers.PrimaryKeyRelatedField(queryset=Tier.objects.all(), required=False)
    charge = serializers.IntegerField(required=False, min_value=0)
    paymentMode = serializers.PrimaryKeyRelatedField(
        queryset=PaymentMode.objects.all(), required=False
    )
    paymentDay = serializers.IntegerField(required=False, min_value=1, max_value=28)
    qr = serializers.CharField(required=False, allow_blank=True)
