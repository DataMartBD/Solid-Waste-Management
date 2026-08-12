"""Agency serializers.

Field names follow the SPA's camelCase contract, as everywhere else in this
codebase — `shortCode`, `contractEnd`, `serviceWards`.
"""

from __future__ import annotations

from rest_framework import serializers

from swms.catalog.models import Ward
from swms.common.serializers import SwmsModelSerializer

from .models import Agency, CollectorEmployment


class AgencySerializer(SwmsModelSerializer):
    shortCode = serializers.CharField(source="short_code")
    agencyType = serializers.ChoiceField(
        source="agency_type", choices=Agency._meta.get_field("agency_type").choices
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
            "serviceWards",
            "status",
            "active",
            "notes",
            "contractExpired",
            "collectorCount",
            "holdingCount",
        ]
        read_only_fields = ["id"]

    def get_collectorCount(self, obj) -> int:
        return obj.collectors.filter(active=True).count()

    def get_holdingCount(self, obj) -> int:
        return obj.holdings.count()


class CollectorEmploymentSerializer(SwmsModelSerializer):
    """Read-only history. Changing it goes through the transfer action."""

    agencyName = serializers.CharField(source="agency.name", read_only=True)
    fromDate = serializers.DateField(source="from_date", read_only=True)
    toDate = serializers.DateField(source="to_date", read_only=True)
    isCurrent = serializers.BooleanField(source="is_current", read_only=True)

    class Meta:
        model = CollectorEmployment
        fields = ["id", "collector", "agency", "agencyName", "fromDate", "toDate", "isCurrent", "note"]
        read_only_fields = fields


class TransferCollectorSerializer(serializers.Serializer):
    """Move a collector to another agency, as of a date."""

    agency = serializers.PrimaryKeyRelatedField(queryset=Agency.objects.all())
    onDate = serializers.DateField(required=False, allow_null=True)
    note = serializers.CharField(required=False, allow_blank=True, max_length=200)
