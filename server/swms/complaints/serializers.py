"""Complaint serializers.

The React pages bind to the mock's key names, so those names are the contract:
`hh` for the household, `assigned` for the collector, and `activity` for the
audit trail — whose entries carry **`by`**, not the model's `actor`.

Three translations happen here:

* foreign keys travel as their string ids (`hh`, `assigned`, `ward`), which is
  what the UI already puts in `<select>` values;
* `ward` is read-only. `Complaint.save()` copies it off the household, so a
  ticket can never be filed against a ward its holding does not sit in;
* the SLA / priority / lifecycle arithmetic that `utils/complaints.js` did in
  the browser is served pre-computed as `slaState`, `priorityRank` and
  `nextStatus`, so no page has to reimplement it — and every client agrees on
  what "breached" means.

`status` is deliberately **not** writable. Every status change is a domain event
with an audit entry attached, so it goes through the action endpoints
(`advance/`, `resolve/`, `reopen/`) and `services.py`, never a bare PATCH.
"""

from __future__ import annotations

from rest_framework import serializers

from swms.common.serializers import SwmsModelSerializer
from swms.customers.models import Household
from swms.fieldops.models import Collector

from .models import (
    Complaint,
    ComplaintActivity,
    ComplaintPhoto,
    Priority,
)
from .services import open_complaint


class ComplaintActivitySerializer(serializers.ModelSerializer):
    """One line of the timeline, in the shape `makeActivity()` produced.

    The model column is `actor` (free text, so 'Control Room' and 'Citizen · SMS'
    fit alongside real staff names) but the drawer reads `by`, so it is renamed
    rather than the frontend being touched.
    """

    by = serializers.CharField(source="actor", read_only=True)

    class Meta:
        model = ComplaintActivity
        fields = ["at", "action", "by", "note"]
        read_only_fields = fields


class ComplaintPhotoSerializer(serializers.ModelSerializer):
    """Evidence thumbnails. `url` is absolute so the SPA can use it verbatim."""

    url = serializers.SerializerMethodField()
    at = serializers.DateTimeField(source="created_at", read_only=True)

    class Meta:
        model = ComplaintPhoto
        fields = ["id", "url", "caption", "at"]
        read_only_fields = fields

    def get_url(self, obj) -> str | None:
        if not obj.image:
            return None
        request = self.context.get("request")
        url = obj.image.url
        return request.build_absolute_uri(url) if request else url


class ComplaintSerializer(SwmsModelSerializer):
    """A ticket as the Complaints page, Dashboard and Reports read it."""

    hh = serializers.PrimaryKeyRelatedField(
        source="household", queryset=Household.objects.all()
    )
    assigned = serializers.PrimaryKeyRelatedField(
        queryset=Collector.objects.all(), allow_null=True, required=False
    )
    # Derived from the household in Complaint.save(); see the module docstring.
    ward = serializers.CharField(source="ward_id", read_only=True)
    # The model has no default: an unset SLA is filled from the priority by
    # services.open_complaint(), so the client may omit it or override it.
    sla = serializers.IntegerField(required=False, min_value=1)
    opened = serializers.DateTimeField(required=False)
    resolvedAt = serializers.DateTimeField(source="resolved_at", read_only=True)
    closedAt = serializers.DateTimeField(source="closed_at", read_only=True)

    activity = ComplaintActivitySerializer(many=True, read_only=True)
    photos = ComplaintPhotoSerializer(many=True, read_only=True)

    # --- computed, so the browser stops doing this arithmetic --------------- #
    slaState = serializers.SerializerMethodField()
    priorityRank = serializers.IntegerField(source="priority_rank", read_only=True)
    nextStatus = serializers.SerializerMethodField()

    # --- denormalised household columns ------------------------------------ #
    # The list view renders the head of household, the holding and the phone
    # next to every row. Shipping them inline keeps the table one request
    # instead of a second lookup per ticket.
    head = serializers.CharField(source="household.head", read_only=True)
    holding = serializers.CharField(source="household.holding_no", read_only=True)
    road = serializers.CharField(source="household.road.name", read_only=True)
    phone = serializers.CharField(source="household.phone", read_only=True)

    #: Moving a ticket to another holding would strand its denormalised ward.
    write_once_fields = ("household",)

    class Meta:
        model = Complaint
        fields = [
            "id",
            "hh",
            "type",
            "channel",
            "status",
            "assigned",
            "opened",
            "sla",
            "ward",
            "priority",
            "description",
            "activity",
            "photos",
            "slaState",
            "priorityRank",
            "nextStatus",
            "head",
            "holding",
            "road",
            "phone",
            "resolvedAt",
            "closedAt",
        ]
        read_only_fields = ["id", "status"]

    def get_slaState(self, obj) -> dict:
        return obj.sla_state()

    def get_nextStatus(self, obj) -> str | None:
        nxt = obj.next_status()
        return str(nxt) if nxt else None


class ComplaintCreateSerializer(ComplaintSerializer):
    """Logging a ticket, which is more than an INSERT.

    The create shape differs in two ways, both handled by
    `services.open_complaint()`: the SLA budget is derived from the priority
    unless explicitly overridden, and a `created` activity row is written so a
    ticket is never without a trail. `note` is the text that entry carries.
    """

    note = serializers.CharField(write_only=True, required=False, allow_blank=True)

    class Meta(ComplaintSerializer.Meta):
        fields = ComplaintSerializer.Meta.fields + ["note"]

    def create(self, validated_data):
        note = validated_data.pop("note", "")
        return open_complaint(user=self.context.get("user"), note=note, **validated_data)


# --------------------------------------------------------------------------- #
# Action payloads. Each mirrors one control in the complaint drawer.
# --------------------------------------------------------------------------- #


class _NotedActionSerializer(serializers.Serializer):
    """Base for actions that may carry an operator's comment."""

    note = serializers.CharField(required=False, allow_blank=True, default="")


class AssignSerializer(_NotedActionSerializer):
    """The drawer's 'Assigned to' select. Null hands the ticket back to the pool."""

    assigned = serializers.PrimaryKeyRelatedField(
        queryset=Collector.objects.all(), allow_null=True
    )


class PrioritySerializer(_NotedActionSerializer):
    priority = serializers.ChoiceField(choices=Priority.choices)


class NoteSerializer(serializers.Serializer):
    """A note is the payload, so unlike the others it may not be blank."""

    note = serializers.CharField(allow_blank=False)


class ResolveSerializer(_NotedActionSerializer):
    """'Resolve with note' — the note is the resolution, so it is optional but
    strongly encouraged; the mock allowed an empty one and that is preserved."""


class AdvanceSerializer(_NotedActionSerializer):
    """One step along LIFECYCLE. The next status is never client-supplied."""
