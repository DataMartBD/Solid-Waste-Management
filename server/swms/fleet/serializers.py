"""Fleet serializers.

The JSON keys are the ones `Fleet.jsx` already binds to — `fitnessExp`,
`taxExp`, `insuranceExp`, `permitExp`, `nextServiceKm`, `kmpl` — so the page
keeps working against the real API.

Three things are worth knowing:

* Every decimal (`kmpl`, `litres`, `downtime`, `lat`, `lng`, `speed`) goes out as
  a JSON **number** via `NullableDecimal`. DRF's default emits strings, which the
  Fleet stat cards and the map would have to parse before doing arithmetic.
* Foreign keys (`driver`, `van`, `by`, `collector`) travel as their string ids,
  which is what the `<select>` values in the forms already are.
* `expiringDocuments` and `serviceDueInKm` are read-only projections of the model
  helpers, so the alert logic lives in one place instead of being recomputed in
  the browser.
"""

from __future__ import annotations

from decimal import Decimal

from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from swms.common.serializers import NullableDecimal, SwmsModelSerializer
from swms.fieldops.models import Collector

from .models import FuelLog, FuelType, Maintenance, Van, VehiclePosition


class VanSerializer(SwmsModelSerializer):
    """A vehicle in the registry, with its paperwork and service status."""

    driver = serializers.PrimaryKeyRelatedField(
        queryset=Collector.objects.all(), allow_null=True, required=False
    )

    fitnessExp = serializers.DateField(source="fitness_exp", allow_null=True, required=False)
    taxExp = serializers.DateField(source="tax_exp", allow_null=True, required=False)
    insuranceExp = serializers.DateField(source="insurance_exp", allow_null=True, required=False)
    permitExp = serializers.DateField(source="permit_exp", allow_null=True, required=False)

    nextServiceKm = serializers.IntegerField(
        source="next_service_km", allow_null=True, required=False, min_value=0
    )
    kmpl = NullableDecimal(max_digits=5, decimal_places=2, allow_null=True, required=False)

    # Derived, so the browser never has to recompute the alert rules.
    expiringDocuments = serializers.SerializerMethodField()
    serviceDueInKm = serializers.IntegerField(source="service_due_in_km", read_only=True)

    class Meta:
        model = Van
        fields = [
            "id",
            "plate",
            "type",
            "capacity",
            "fuel",
            "ownership",
            "gps",
            "odometer",
            "status",
            "driver",
            "fitnessExp",
            "taxExp",
            "insuranceExp",
            "permitExp",
            "nextServiceKm",
            "kmpl",
            "expiringDocuments",
            "serviceDueInKm",
        ]
        read_only_fields = ["id"]

    @extend_schema_field(serializers.ListField(child=serializers.DictField()))
    def get_expiringDocuments(self, obj):
        """Paperwork due (or lapsed) inside the alert horizon, nearest first."""
        within = int(self.context.get("within", 30))
        return [
            {
                "document": row["document"],
                "expires": row["expires"].isoformat(),
                "days": row["days"],
            }
            for row in obj.expiring_documents(within_days=within, today=self.context.get("as_of"))
        ]

    def validate_odometer(self, value):
        """A meter reading cannot decrease.

        The mock let an edit type any number into the odometer box, which silently
        broke km/L (it is derived from the distance between two readings) and the
        service-due countdown. Corrections downwards are a workshop matter, not a
        form field.
        """
        if self.instance is not None and value < self.instance.odometer:
            raise serializers.ValidationError(
                f"An odometer cannot go backwards — {self.instance.odometer} km is already recorded."
            )
        return value

    def validate(self, attrs):
        attrs = super().validate(attrs)
        # Fall back to the stored values so a PATCH that touches only one of the
        # two fields is still checked against the other.
        fuel = attrs.get("fuel", getattr(self.instance, "fuel", None))
        kmpl = attrs.get("kmpl", getattr(self.instance, "kmpl", None))
        if fuel == FuelType.ELECTRIC and kmpl is not None:
            raise serializers.ValidationError(
                {"kmpl": "An electric vehicle has no km/L figure — leave it empty."}
            )
        return attrs


class MaintenanceSerializer(SwmsModelSerializer):
    """A workshop visit.

    `opened` and `closed` are server-stamped: a job opens when it is created and
    closes through `POST /maintenance/{id}/close/`, which is also what computes
    downtime and puts the van back on the road.
    """

    van = serializers.PrimaryKeyRelatedField(queryset=Van.objects.all())
    downtime = NullableDecimal(max_digits=7, decimal_places=2, required=False)
    isOpen = serializers.BooleanField(source="is_open", read_only=True)

    class Meta:
        model = Maintenance
        fields = [
            "id",
            "van",
            "kind",
            "reason",
            "odometer",
            "opened",
            "closed",
            "downtime",
            "cost",
            "vendor",
            "isOpen",
        ]
        read_only_fields = ["id", "opened", "closed"]


class FuelLogSerializer(SwmsModelSerializer):
    """A refuelling or charging event.

    `kmpl` may be left out: the model derives it from the distance since this
    van's previous log, which is more trustworthy than a hand-typed figure.
    """

    van = serializers.PrimaryKeyRelatedField(queryset=Van.objects.all())
    by = serializers.PrimaryKeyRelatedField(
        queryset=Collector.objects.all(), allow_null=True, required=False
    )
    litres = NullableDecimal(max_digits=7, decimal_places=2)
    kmpl = NullableDecimal(max_digits=5, decimal_places=2, allow_null=True, required=False)
    at = serializers.DateTimeField(required=False)

    class Meta:
        model = FuelLog
        fields = ["id", "van", "litres", "cost", "odometer", "by", "at", "kmpl"]
        read_only_fields = ["id"]


class VehiclePositionSerializer(SwmsModelSerializer):
    """One GPS ping. Read-only in practice — writes go through the ingest view."""

    van = serializers.PrimaryKeyRelatedField(queryset=Van.objects.all())
    collector = serializers.PrimaryKeyRelatedField(
        queryset=Collector.objects.all(), allow_null=True, required=False
    )
    lat = NullableDecimal(max_digits=9, decimal_places=6)
    lng = NullableDecimal(max_digits=9, decimal_places=6)
    speed = NullableDecimal(max_digits=5, decimal_places=2, allow_null=True, required=False)
    at = serializers.DateTimeField(required=False)

    class Meta:
        model = VehiclePosition
        fields = ["van", "collector", "lat", "lng", "speed", "heading", "accuracy", "ignition", "at"]


class PositionIngestSerializer(serializers.Serializer):
    """A telemetry ping, or a batch of them.

    Trackers behave two ways and both post here: a connected device sends one
    ping at a time, while a device coming back from a dead spot flushes a queue.
    `for_payload()` picks single or `many=True` from the shape of the body so the
    gateway does not need two endpoints.
    """

    van = serializers.PrimaryKeyRelatedField(queryset=Van.objects.all())
    collector = serializers.PrimaryKeyRelatedField(
        queryset=Collector.objects.all(), allow_null=True, required=False
    )
    lat = serializers.FloatField()
    lng = serializers.FloatField()
    speed = serializers.FloatField(required=False, allow_null=True)
    heading = serializers.IntegerField(required=False, allow_null=True, min_value=0, max_value=359)
    accuracy = serializers.IntegerField(required=False, allow_null=True, min_value=0)
    ignition = serializers.BooleanField(default=True)
    at = serializers.DateTimeField(required=False, allow_null=True)

    @classmethod
    def for_payload(cls, data, **kwargs):
        return cls(data=data, many=isinstance(data, list), **kwargs)

    # A tracker that has lost its fix reports 0,0 or a wildly wrong figure.
    # Plotting that would drag the live map into the Gulf of Guinea, so a ping
    # outside the country is treated as a fault rather than a location.
    def validate_lat(self, value):
        if not (20.0 <= value <= 27.0):
            raise serializers.ValidationError("Latitude is outside Bangladesh.")
        return value

    def validate_lng(self, value):
        if not (87.0 <= value <= 93.0):
            raise serializers.ValidationError("Longitude is outside Bangladesh.")
        return value


class AssignDriverSerializer(serializers.Serializer):
    """Who drives this van. `null` unassigns it."""

    driver = serializers.PrimaryKeyRelatedField(
        queryset=Collector.objects.all(), allow_null=True
    )


class CloseMaintenanceSerializer(serializers.Serializer):
    """Sign a workshop job off.

    Everything is optional: `closed` defaults to now and `downtime` is computed
    from `opened` → `closed` unless the workshop reports a different figure (a job
    can sit finished in the yard for a day before anyone records it).
    """

    closed = serializers.DateTimeField(required=False)
    cost = serializers.IntegerField(required=False, min_value=0)
    downtime = serializers.DecimalField(
        max_digits=7,
        decimal_places=2,
        required=False,
        min_value=Decimal("0"),
        coerce_to_string=False,
    )
