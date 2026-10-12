"""Agency serializers.

Field names follow the SPA's camelCase contract, as everywhere else in this
codebase — `shortCode`, `contractEnd`, `serviceWards`.
"""

from __future__ import annotations

from rest_framework import serializers

from swms.catalog.models import AgencyType, City, Ward
from swms.common.serializers import SwmsModelSerializer

from .models import Agency, CollectorEmployment


class AgencySerializer(SwmsModelSerializer):
    shortCode = serializers.CharField(source="short_code")
    nameBn = serializers.CharField(source="name_bn", required=False, allow_blank=True, max_length=160)
    #: An id from the setup list (`/api/agency-types/`).
    agencyType = serializers.PrimaryKeyRelatedField(
        source="agency_type", queryset=AgencyType.objects.all(), allow_null=True, required=False
    )
    tradeLicenceNo = serializers.CharField(
        source="trade_licence_no", required=False, allow_blank=True
    )
    registrationNo = serializers.CharField(
        source="registration_no", required=False, allow_blank=True
    )
    contactPerson = serializers.CharField(
        source="contact_person", required=False, allow_blank=True
    )
    altPhone = serializers.CharField(source="alt_phone", required=False, allow_blank=True)
    contractNo = serializers.CharField(source="contract_no", required=False, allow_blank=True)
    contractStart = serializers.DateField(source="contract_start", required=False, allow_null=True)
    contractEnd = serializers.DateField(source="contract_end", required=False, allow_null=True)
    city = serializers.PrimaryKeyRelatedField(
        queryset=City.objects.all(), allow_null=True, required=False
    )
    serviceWards = serializers.PrimaryKeyRelatedField(
        source="service_wards", many=True, queryset=Ward.objects.all(), required=False
    )

    # Derived, never stored — a stored "expired" flag is wrong the day it
    # matters, and a stored count is wrong the moment someone transfers.
    contractExpired = serializers.BooleanField(source="contract_expired", read_only=True)
    collectorCount = serializers.SerializerMethodField()
    holdingCount = serializers.SerializerMethodField()

    class Meta:
        model = Agency
        fields = [
            "id",
            "name",
            "nameBn",
            "shortCode",
            "agencyType",
            "tradeLicenceNo",
            "registrationNo",
            "tin",
            "bin",
            "contactPerson",
            "phone",
            "altPhone",
            "email",
            "address",
            "contractNo",
            "contractStart",
            "contractEnd",
            "city",
            "serviceWards",
            "status",
            "active",
            "notes",
            "contractExpired",
            "collectorCount",
            "holdingCount",
        ]
        read_only_fields = ["id"]

    def validate(self, attrs):
        """An agency may only be given wards in its own city."""
        attrs = super().validate(attrs)
        instance = self.instance
        city = attrs["city"] if "city" in attrs else getattr(instance, "city", None)
        if "service_wards" in attrs:
            wards = attrs["service_wards"]
        elif instance is not None and "city" in attrs:
            wards = list(instance.service_wards.select_related("zone"))
        else:
            wards = []
        if city is not None:
            foreign = sorted(w.id for w in wards if w.zone.city_id != city.id)
            if foreign:
                raise serializers.ValidationError(
                    {"serviceWards": f"Not in {city.name}: {', '.join(foreign)}"}
                )
        return attrs

    def get_collectorCount(self, obj) -> int:
        return obj.collectors.filter(active=True).count()

    def get_holdingCount(self, obj) -> int:
        return obj.holdings.count()


class CollectorEmploymentSerializer(SwmsModelSerializer):
    """Read-only history. Changing it goes through the transfer action."""

    agencyName = serializers.CharField(source="agency.name", read_only=True)
    agencyNameBn = serializers.CharField(source="agency.name_bn", read_only=True)
    fromDate = serializers.DateField(source="from_date", read_only=True)
    toDate = serializers.DateField(source="to_date", read_only=True)
    isCurrent = serializers.BooleanField(source="is_current", read_only=True)

    class Meta:
        model = CollectorEmployment
        fields = [
            "id", "collector", "agency", "agencyName", "agencyNameBn",
            "fromDate", "toDate", "isCurrent", "note",
        ]
        read_only_fields = fields


class TransferCollectorSerializer(serializers.Serializer):
    """Move a collector to another agency, as of a date."""

    agency = serializers.PrimaryKeyRelatedField(queryset=Agency.objects.all())
    onDate = serializers.DateField(required=False, allow_null=True)
    note = serializers.CharField(required=False, allow_blank=True, max_length=200)
