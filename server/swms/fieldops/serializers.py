"""Collector, route, assignment and visit serializers.

The JSON keys are the React app's existing field names, so `Collection.jsx`,
`RoutePlan.jsx`, `RoutesPage.jsx` and `Collectors.jsx` keep binding to what they
already bind to: `dspId`, `zone`, `onTime`, `licenseExp`, and `hh` for a visit's
household.

Three translations happen here:

* `zone` on a collector is a **ward id**. The mock named the field `zone` while
  storing `'W-14'`; the API keeps the old name and the column tells the truth.
* `route.stops` and `assignment.routes` travel as ordered arrays of ids — the
  shape the planner UI manipulates — and are written through the models'
  `resequence()` / `set_routes()` so the through tables stay consistent.
* `window` is a read-only display string (`'06:00–09:30'`, en dash). Writes send
  `windowStart` / `windowEnd` as `'HH:MM'`, because a parsed range is what the
  database stores and what on-time metrics compare against.
"""

from __future__ import annotations

from collections import Counter

from rest_framework import serializers

from swms.catalog.models import Ward
from swms.common.scoping import guard
from swms.common.serializers import IdListField, NullableDecimal, SwmsModelSerializer
from swms.customers.models import Holding, Household

from .models import (
    Assignment,
    Attendance,
    Collector,
    Route,
    SkipReason,
    Visit,
    VisitSource,
    VisitStatus,
)

#: Accepted on the wire and emitted back; seconds are noise in a shift window.
TIME_FORMATS = ["%H:%M", "%H:%M:%S"]


def validate_stop_holdings(holding_ids: list[str], ward_id: str | None) -> list[str]:
    """Check a proposed walking order before it is written.

    A stop is a building, so these are holding ids. Three rules:

    * a building appears once — `RouteStop` is one-to-one on holding, so a
      repeat would silently collapse rather than error;
    * its pin is verified — an unverified building has no confirmed coordinates,
      so nobody can be sent to it (this is `isRoutable`);
    * it sits in the route's own ward, because a round stays inside one ward.

    Offenders are named in the error: a planner dragging thirty buildings needs
    to know which one was refused.
    """
    repeated = sorted(name for name, count in Counter(holding_ids).items() if count > 1)
    if repeated:
        raise serializers.ValidationError(
            {"stops": f"Listed more than once: {', '.join(repeated)}."}
        )

    known = {
        row["id"]: row
        for row in Holding.objects.filter(pk__in=holding_ids).values(
            "id", "verified", "ward_id"
        )
    }

    missing = [pk for pk in holding_ids if pk not in known]
    if missing:
        raise serializers.ValidationError({"stops": f"Unknown holdings: {', '.join(missing)}."})

    unverified = [pk for pk in holding_ids if not known[pk]["verified"]]
    if unverified:
        raise serializers.ValidationError(
            {
                "stops": (
                    "These holdings are not verified on the ground yet, so they cannot "
                    f"be routed: {', '.join(unverified)}."
                )
            }
        )

    if ward_id:
        strays = [pk for pk in holding_ids if known[pk]["ward_id"] != ward_id]
        if strays:
            raise serializers.ValidationError(
                {"stops": f"Not in {ward_id}: {', '.join(strays)}."}
            )

    return holding_ids


class StopIdsField(IdListField):
    """`route.stops` — reads the walking order, writes are applied by the parent.

    The ids are **buildings**: the plan is holding-wise, so a block of flats is
    one stop. `get_attribute` hands over the route itself because the order
    lives in the through table, not in an attribute of that name.
    """

    def get_attribute(self, instance):
        return instance

    def to_representation(self, route):
        # Uses the prefetched `stops` (RouteStop.Meta orders them by seq) rather
        # than re-querying, so a route list stays one query.
        return [stop.holding_id for stop in route.stops.all()]


class RouteIdsField(IdListField):
    """`assignment.routes` — the routes a collector holds, in assignment order."""

    def get_attribute(self, instance):
        return instance

    def to_representation(self, assignment):
        return [link.route_id for link in assignment.route_links.all()]


class CollectorSerializer(SwmsModelSerializer):
    """A field collector, as the Collectors table and the round header read it."""

    dspId = serializers.CharField(source="dsp_id", required=False)
    #: The mock's `zone`. It always held a ward id, and still does.
    zone = serializers.PrimaryKeyRelatedField(source="ward", queryset=Ward.objects.all())
    onTime = serializers.IntegerField(
        source="on_time", required=False, min_value=0, max_value=100
    )
    coverage = serializers.IntegerField(required=False, min_value=0, max_value=100)
    licenseExp = serializers.DateField(source="license_exp", required=False, allow_null=True)
    #: Counted live. The mock stored this as an integer column that drifted.
    complaints = serializers.SerializerMethodField()
    vanId = serializers.SerializerMethodField()
    assignmentId = serializers.SerializerMethodField()
    #: Read-only: employment is changed through POST /collectors/{id}/transfer/,
    #: which writes the history row and this FK together.
    agencyName = serializers.CharField(source="agency.name", read_only=True, default=None)

    class Meta:
        model = Collector
        fields = [
            "id",
            "name",
            "dspId",
            "agency",
            "agencyName",
            "zone",
            "phone",
            "onTime",
            "coverage",
            "complaints",
            "status",
            "license",
            "licenseExp",
            "joined",
            "attendance",
            "active",
            "vanId",
            "assignmentId",
        ]
        read_only_fields = ["id", "agency"]

    def get_complaints(self, obj) -> int:
        """Prefers the viewset's annotation; falls back for one-off serialising."""
        annotated = getattr(obj, "open_complaints", None)
        return annotated if annotated is not None else obj.open_complaint_count

    def get_vanId(self, obj) -> str | None:
        """The van this collector drives. Fleet owns the link, so it is read-only."""
        vans = list(obj.vans.all())
        return vans[0].id if vans else None

    def get_assignmentId(self, obj) -> str | None:
        for assignment in obj.assignments.all():
            if assignment.active:
                return assignment.id
        return None


class RouteSerializer(SwmsModelSerializer):
    """A route and its walking order."""

    ward = serializers.PrimaryKeyRelatedField(queryset=Ward.objects.all())
    #: Display string built by the model — '06:00–09:30' with an en dash.
    window = serializers.CharField(read_only=True)
    windowStart = serializers.TimeField(
        source="window_start", required=False, format="%H:%M", input_formats=TIME_FORMATS
    )
    windowEnd = serializers.TimeField(
        source="window_end", required=False, format="%H:%M", input_formats=TIME_FORMATS
    )
    stops = StopIdsField(required=False)

    class Meta:
        model = Route
        fields = ["id", "name", "ward", "window", "windowStart", "windowEnd", "stops", "active"]
        read_only_fields = ["id"]

    def validate(self, attrs):
        attrs = super().validate(attrs)
        self._check_window(attrs)
        if "stops" in attrs:
            ward = attrs.get("ward")
            ward_id = ward.id if ward is not None else getattr(self.instance, "ward_id", None)
            validate_stop_holdings(attrs["stops"], ward_id)
        return attrs

    def _check_window(self, attrs):
        start = attrs.get("window_start") or getattr(self.instance, "window_start", None)
        end = attrs.get("window_end") or getattr(self.instance, "window_end", None)
        if start and end and end <= start:
            raise serializers.ValidationError(
                {"windowEnd": "A collection window has to end after it starts."}
            )

    def create(self, validated_data):
        stops = validated_data.pop("stops", None)
        route = super().create(validated_data)
        if stops is not None:
            route.resequence(stops)
        return route

    def update(self, instance, validated_data):
        stops = validated_data.pop("stops", None)
        route = super().update(instance, validated_data)
        if stops is not None:
            route.resequence(stops)
        return route


class AssignmentSerializer(SwmsModelSerializer):
    """Which routes a collector is responsible for."""

    collector = serializers.PrimaryKeyRelatedField(queryset=Collector.objects.all())
    routes = RouteIdsField(required=False)

    class Meta:
        model = Assignment
        fields = ["id", "collector", "routes", "active"]
        read_only_fields = ["id"]

    def validate_collector(self, collector):
        guard(self, ward_id=collector.ward_id, agency_id=collector.agency_id)
        return collector

    def validate_routes(self, value):
        repeated = sorted(name for name, count in Counter(value).items() if count > 1)
        if repeated:
            raise serializers.ValidationError(f"Listed more than once: {', '.join(repeated)}.")
        known = set(Route.objects.filter(pk__in=value).values_list("id", flat=True))
        missing = [rid for rid in value if rid not in known]
        if missing:
            raise serializers.ValidationError(f"Unknown routes: {', '.join(missing)}.")
        return value

    def create(self, validated_data):
        routes = validated_data.pop("routes", None)
        assignment = super().create(validated_data)
        if routes is not None:
            assignment.set_routes(routes)
        return assignment

    def update(self, instance, validated_data):
        routes = validated_data.pop("routes", None)
        assignment = super().update(instance, validated_data)
        if routes is not None:
            assignment.set_routes(routes)
        return assignment


class VisitSerializer(SwmsModelSerializer):
    """One collection attempt. `hh` is the household, as the mock called it."""

    hh = serializers.PrimaryKeyRelatedField(
        source="household", queryset=Household.objects.all()
    )
    collector = serializers.PrimaryKeyRelatedField(
        queryset=Collector.objects.all(), required=False, allow_null=True
    )
    #: Derived from the holding's place in the plan, never sent by the client.
    route = serializers.PrimaryKeyRelatedField(read_only=True)
    # Numbers, not strings: RoutesPage plots a stop only when lat/lng are numeric.
    lat = NullableDecimal(max_digits=9, decimal_places=6, required=False, allow_null=True)
    lng = NullableDecimal(max_digits=9, decimal_places=6, required=False, allow_null=True)

    class Meta:
        model = Visit
        fields = [
            "id",
            "hh",
            "collector",
            "route",
            "qr",
            "status",
            "at",
            "accuracy",
            "source",
            "reason",
            "note",
            "lat",
            "lng",
            "synced",
        ]
        read_only_fields = ["id", "qr"]

    def validate(self, attrs):
        # Creates go through `record_visit`; this catches a PATCH that would turn
        # a collection into a skip and leave the table's check constraint to
        # explain itself as a 409.
        attrs = super().validate(attrs)
        status = attrs.get("status", getattr(self.instance, "status", None))
        reason = attrs.get("reason", getattr(self.instance, "reason", ""))
        if status == VisitStatus.SKIPPED and not reason:
            raise serializers.ValidationError({"reason": "A skipped stop needs a reason."})
        return attrs


class RecordVisitSerializer(serializers.Serializer):
    """One collection or skip, as the round screen posts it.

    Mirrors `buildVisit`: the client says which holding, what happened and how it
    was actioned; the server decides the id, the tag and the route.
    """

    hh = serializers.PrimaryKeyRelatedField(queryset=Household.objects.all())
    collector = serializers.PrimaryKeyRelatedField(
        queryset=Collector.objects.all(), required=False, allow_null=True
    )

    def validate_hh(self, household):
        guard(self, ward_id=household.ward_id, agency_id=household.holding.agency_id)
        return household

    def validate_collector(self, collector):
        if collector is not None:
            guard(self, ward_id=collector.ward_id, agency_id=collector.agency_id)
        return collector
    status = serializers.ChoiceField(choices=VisitStatus.choices, default=VisitStatus.COLLECTED)
    source = serializers.ChoiceField(
        choices=VisitSource.choices, required=False, allow_blank=True, default=""
    )
    reason = serializers.ChoiceField(
        choices=SkipReason.choices, required=False, allow_blank=True, default=""
    )
    at = serializers.DateTimeField(required=False, allow_null=True)
    accuracy = serializers.IntegerField(required=False, allow_null=True, min_value=0)
    lat = serializers.FloatField(required=False, allow_null=True)
    lng = serializers.FloatField(required=False, allow_null=True)
    note = serializers.CharField(required=False, allow_blank=True, max_length=240, default="")

    def validate(self, attrs):
        # A supervisor answering "why was my bin missed?" needs the reason, so the
        # field is mandatory at the edge as well as in the service and the table.
        if attrs.get("status") == VisitStatus.SKIPPED and not attrs.get("reason"):
            raise serializers.ValidationError({"reason": "A skipped stop needs a reason."})
        return attrs


class BulkVisitSerializer(serializers.Serializer):
    """The offline queue as a device uploads it.

    Rows stay loosely typed on purpose: validating them here would reject the
    whole upload over one malformed row, and a collector's queue is the only copy
    of that work. `bulk_record_visits` validates row by row instead and reports
    which ones failed.
    """

    rows = serializers.ListField(child=serializers.DictField(), allow_empty=True)


class ScanSerializer(serializers.Serializer):
    """A scanned or hand-keyed QR payload to resolve against a round."""

    # Blank is allowed so an empty read reaches `match_scan` and comes back as
    # 'unreadable', which is what the field app tells the collector.
    raw = serializers.CharField(max_length=120, allow_blank=True)
    collector = serializers.PrimaryKeyRelatedField(
        queryset=Collector.objects.all(), required=False, allow_null=True
    )
    day = serializers.DateField(required=False)


class ReorderStopsSerializer(serializers.Serializer):
    """Replace a route's whole walking order."""

    stops = IdListField()

    def validate_stops(self, value):
        route = self.context.get("route")
        return validate_stop_holdings(value, getattr(route, "ward_id", None))


class SingleStopSerializer(serializers.Serializer):
    """Put one holding on a route, or take it off again."""

    hh = serializers.CharField(max_length=32)


class AssignRoutesSerializer(serializers.Serializer):
    """Set the routes an assignment covers."""

    routes = IdListField()

    def validate_routes(self, value):
        repeated = sorted(name for name, count in Counter(value).items() if count > 1)
        if repeated:
            raise serializers.ValidationError(f"Listed more than once: {', '.join(repeated)}.")
        known = set(Route.objects.filter(pk__in=value).values_list("id", flat=True))
        missing = [rid for rid in value if rid not in known]
        if missing:
            raise serializers.ValidationError(f"Unknown routes: {', '.join(missing)}.")
        return value


class AttendanceSerializer(serializers.Serializer):
    """Depot check-in / absence for the day."""

    attendance = serializers.ChoiceField(choices=Attendance.choices)
