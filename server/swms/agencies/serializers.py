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
    #: The main city. Optional on write: it follows `cities` (the first one
    #: sent, unless the current main city is still among them).
    city = serializers.PrimaryKeyRelatedField(
        queryset=City.objects.all(), allow_null=True, required=False
    )
    #: Every city corporation / pourashova served, all in one district.
    cities = serializers.PrimaryKeyRelatedField(
        many=True, queryset=City.objects.all(), required=False
    )
    #: Holdings to serve each month, for the target-vs-actual report.
    targetHoldings = serializers.IntegerField(
        source="target_holdings", required=False, allow_null=True, min_value=0
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
            "cities",
            "serviceWards",
            "targetHoldings",
            "status",
            "active",
            "notes",
            "contractExpired",
            "collectorCount",
            "holdingCount",
        ]
        read_only_fields = ["id"]

    def validate(self, attrs):
        """Cities of one district; wards only in those cities.

        A new agency must name its city corporation(s) / pourashova(s), and so
        its district. Ticking no ward means every ward of those cities.
        """
        attrs = super().validate(attrs)
        instance = self.instance
        new = instance is None

        if "cities" in attrs:
            cities = attrs["cities"]
            if len({(c.district or "").strip().lower() for c in cities}) > 1:
                raise serializers.ValidationError(
                    {"cities": "All city corporations / pourashovas must be in one district."}
                )
            main = attrs.get("city") or getattr(instance, "city", None)
            attrs["city"] = main if main in cities else (cities[0] if cities else None)
        elif "city" in attrs:
            # An older client that sends one city only: that city alone.
            cities = [attrs["city"]] if attrs["city"] else []
            attrs["cities"] = cities
        elif instance is not None:
            cities = list(instance.cities.all()) or ([instance.city] if instance.city else [])
        else:
            cities = []

        if not cities and (new or "cities" in attrs or "city" in attrs):
            raise serializers.ValidationError(
                {"cities": "Choose the district and at least one city corporation / pourashova."}
            )

        if cities and (new or "service_wards" in attrs) and not attrs.get("service_wards"):
            attrs["service_wards"] = list(
                Ward.objects.filter(zone__city__in=cities).select_related("zone")
            )

        if "service_wards" in attrs:
            wards = attrs["service_wards"]
        elif instance is not None and ("cities" in attrs or "city" in attrs):
            wards = list(instance.service_wards.select_related("zone"))
        else:
            wards = []
        if cities:
            allowed = {c.id for c in cities}
            foreign = sorted(w.id for w in wards if w.zone.city_id not in allowed)
            if foreign:
                names = ", ".join(c.name for c in cities)
                raise serializers.ValidationError(
                    {"serviceWards": f"Not in {names}: {', '.join(foreign)}"}
                )
        return attrs

    def create(self, validated_data):
        cities = validated_data.pop("cities", None)
        agency = super().create(validated_data)
        agency.cities.set(cities if cities is not None else ([agency.city] if agency.city else []))
        return agency

    def update(self, instance, validated_data):
        cities = validated_data.pop("cities", None)
        agency = super().update(instance, validated_data)
        if cities is not None:
            agency.cities.set(cities)
        return agency

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

    def validate_agency(self, agency):
        if agency.status != "active":
            raise serializers.ValidationError("This agency is not active.")
        return agency
    note = serializers.CharField(required=False, allow_blank=True, max_length=200)
