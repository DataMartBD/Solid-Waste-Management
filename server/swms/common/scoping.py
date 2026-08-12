"""Write-side scope guards.

Reading is scoped by `WardScopedQuerysetMixin`; writing was not. A queryset
filter stops a caller *seeing* another agency's rows, but `PrimaryKeyRelatedField`
happily accepts any id in the table, so a tenant could still post a reference to
something they cannot read — filing a household into a rival's building, or
recording a payment against their bill.

These helpers are the write-side counterpart, meant to be called from
`validate_<field>` so the error lands on the field the user must change.
"""

from __future__ import annotations

from rest_framework import serializers

#: What the caller is told. Deliberately identical whichever object was refused:
#: a distinct message per model would let someone probe which ids exist.
OUTSIDE = "That record is outside your assigned area."


def caller(serializer):
    """The signed-in user, or None outside a request (shell, seed, migrations).

    **The serializer must be given context.** A guard with no caller passes
    silently, so a serializer built as `Thing(data=request.data)` inside a view —
    with no `context=self.get_serializer_context()` — disables every guard on it
    without any sign that it has. That is how `RecordVisitSerializer` shipped
    unguarded until a test caught it. ModelViewSet supplies context on its own;
    hand-built serializers in `@action` handlers do not.
    """
    request = serializer.context.get("request")
    user = getattr(request, "user", None) or serializer.context.get("user")
    return user if getattr(user, "is_authenticated", False) else None


def guard_ward(serializer, ward_id):
    """Refuse a ward the caller may not see."""
    user = caller(serializer)
    if user is None or ward_id is None:
        return
    allowed = user.visible_ward_ids()
    if allowed is not None and ward_id not in allowed:
        raise serializers.ValidationError(OUTSIDE)


def guard_agency(serializer, agency_id):
    """Refuse an object belonging to another agency.

    A null `agency_id` is *not* refused: unassigned rows exist while agencies
    are being adopted, and rejecting them would break ordinary work for the
    contractor who has not been given theirs yet.
    """
    user = caller(serializer)
    if user is None or agency_id is None:
        return
    mine = user.visible_agency_id()
    if mine is not None and agency_id != mine:
        raise serializers.ValidationError(OUTSIDE)


def guard(serializer, *, ward_id=None, agency_id=None):
    """Both axes at once, for a related object that carries each."""
    guard_ward(serializer, ward_id)
    guard_agency(serializer, agency_id)
