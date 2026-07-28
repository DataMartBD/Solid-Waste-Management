"""Complaint domain operations.

Everything that changes a ticket lives here, and every one of these functions
appends exactly one `ComplaintActivity` row. That is the whole point: in the mock
the activity trail was assembled by the page (`withActivity(...makeActivity())`),
so any caller that forgot to wrap its change produced a ticket whose history
lied. Here the mutation and its audit entry are the same operation, inside one
transaction — there is no way to move a ticket without leaving a mark.

The lifecycle rules the frontend enforced only by hiding buttons are enforced
here as `DomainError`s, because an API cannot rely on the UI to be the guard.
"""

from __future__ import annotations

from datetime import timedelta

from django.db import transaction
from django.db.models import (
    BooleanField,
    Case,
    DateTimeField,
    DurationField,
    ExpressionWrapper,
    F,
    IntegerField,
    Q,
    Value,
    When,
)
from django.db.models.functions import Cast
from django.utils import timezone

from swms.common.exceptions import DomainError
from swms.common.realtime import COMPLAINT_OPENED, COMPLAINT_UPDATED, publish

from .models import (
    ACTIVE_STATUSES,
    PRIORITY_RANK,
    SLA_HOURS,
    ActivityAction,
    Channel,
    Complaint,
    ComplaintActivity,
    ComplaintStatus,
    Priority,
)

# --------------------------------------------------------------------------- #
# Actors
#
# `ComplaintActivity.actor` is free text because not every entry is written by a
# signed-in operator: the SMS gateway and the citizen app file tickets too. These
# four strings are the ones the frontend has translations for (ACTOR_KEY in
# utils/complaints.js), so they must match byte-for-byte — note the U+00B7
# MIDDLE DOT, not a full stop.
# --------------------------------------------------------------------------- #

SYSTEM_ACTOR = "System"
CONTROL_ROOM_ACTOR = "Control Room"
CITIZEN_APP_ACTOR = "Citizen · App"
CITIZEN_SMS_ACTOR = "Citizen · SMS"

#: Who a self-service ticket is attributed to when nobody is signed in.
CHANNEL_ACTOR = {
    Channel.APP: CITIZEN_APP_ACTOR,
    Channel.SMS: CITIZEN_SMS_ACTOR,
}

#: Default note on the `created` entry, matching t('complaints.note.logged').
CREATED_NOTE = "Complaint logged."


def actor_label(user) -> str:
    """The display string this activity entry is signed with.

    A real operator signs with their own name. Everything else is a system
    actor: an unauthenticated write is `'System'`, and a signed-in account with
    no name falls back to `'Control Room'` — which is what the mock used when
    `user?.name` was empty.
    """
    if user is None or not getattr(user, "is_authenticated", False):
        return SYSTEM_ACTOR
    return (getattr(user, "name", "") or "").strip() or CONTROL_ROOM_ACTOR


def channel_actor(channel: str) -> str:
    """Attribution for a ticket the citizen raised themselves."""
    try:
        return CHANNEL_ACTOR.get(Channel(channel), SYSTEM_ACTOR)
    except ValueError:
        return SYSTEM_ACTOR


def _log(complaint: Complaint, action: str, *, note: str = "", user=None, actor: str | None = None):
    """The single funnel every mutation below writes its audit row through."""
    label = actor or actor_label(user)
    entry = complaint.log(action, note=note, actor=label, user=user)
    # Complaint.log() prefers `user.name` over the label it was handed. Keep the
    # resolved label authoritative so a citizen-channel or blank-named actor
    # still reads correctly in the timeline, without a second INSERT.
    if entry.actor != label:
        ComplaintActivity.objects.filter(pk=entry.pk).update(actor=label)
        entry.actor = label
    return entry


def _broadcast(complaint: Complaint, event: str = COMPLAINT_UPDATED) -> None:
    """Nudge the live map / dashboard. Never allowed to fail the write."""
    publish(
        event,
        {
            "id": complaint.id,
            "hh": complaint.household_id,
            "ward": complaint.ward_id,
            "type": complaint.type,
            "status": complaint.status,
            "priority": complaint.priority,
            "assigned": complaint.assigned_id,
            "sla": complaint.sla,
            "opened": complaint.opened.isoformat() if complaint.opened else None,
        },
    )


# --------------------------------------------------------------------------- #
# Mutations
# --------------------------------------------------------------------------- #


@transaction.atomic
def open_complaint(*, user=None, note: str = "", **fields) -> Complaint:
    """Log a new ticket.

    The SLA budget follows the priority (urgent 4h … low 48h) unless the caller
    passes one explicitly — a supervisor negotiating a deadline with a citizen
    needs that escape hatch. `ward` is not accepted: `Complaint.save()` derives
    it from the household.
    """
    fields.pop("ward", None)
    fields.pop("ward_id", None)

    priority = fields.get("priority") or Priority.MEDIUM
    if not fields.get("sla"):
        fields["sla"] = SLA_HOURS[Priority(priority)]

    complaint = Complaint(**fields)
    complaint.save()

    # An unauthenticated ticket came in over SMS or the citizen app, so it is
    # signed with the channel rather than 'System'.
    actor = actor_label(user)
    if actor == SYSTEM_ACTOR:
        actor = channel_actor(complaint.channel)
    _log(
        complaint,
        ActivityAction.CREATED,
        note=note or CREATED_NOTE,
        user=user,
        actor=actor,
    )

    _broadcast(complaint, COMPLAINT_OPENED)
    return complaint


@transaction.atomic
def assign(complaint: Complaint, collector, *, user=None, note: str = "") -> Complaint:
    """Put a ticket on a collector's list.

    Assigning also moves `open` → `assigned`, because a ticket with an owner is
    not "open" any more; later statuses are left alone so re-assigning work that
    is already in progress does not rewind it. Handing the same ticket to the
    same collector is a no-op and writes nothing — the drawer's select fires on
    every render, and a trail full of identical rows is worse than none.
    """
    previous = complaint.assigned_id
    new_id = getattr(collector, "pk", collector)
    if previous == new_id:
        return complaint

    complaint.assigned = collector
    fields = ["assigned", "updated_at"]
    if complaint.status == ComplaintStatus.OPEN and new_id is not None:
        complaint.status = ComplaintStatus.ASSIGNED
        fields.append("status")
    complaint.save(update_fields=fields)

    # 'reassigned' is a distinct event: it is what an audit asks about when a
    # ticket bounced between staff before anyone worked it.
    action = ActivityAction.REASSIGNED if previous else ActivityAction.ASSIGNED
    who = getattr(collector, "name", None) or new_id
    label = note or (f"Assigned to {who}" if new_id else "Returned to the unassigned pool")
    _log(complaint, action, note=label, user=user)
    _broadcast(complaint)
    return complaint


@transaction.atomic
def advance(complaint: Complaint, *, user=None, note: str = "") -> Complaint:
    """Walk one step along LIFECYCLE.

    The next status is never supplied by the client, so a ticket cannot skip
    `in_progress` or jump backwards. Two refusals matter:

    * a `closed` ticket is terminal — it must be reopened first;
    * `open` → `assigned` needs somebody to assign it to, otherwise the board
      shows work as owned that nobody is doing.
    """
    if complaint.status == ComplaintStatus.CLOSED:
        raise DomainError(
            f"{complaint.id} is already closed. Reopen it first.", code="already_closed"
        )

    nxt = complaint.next_status()
    if nxt is None:
        raise DomainError(
            f"{complaint.id} cannot be advanced from {complaint.status}.",
            code="cannot_advance",
        )
    if nxt == ComplaintStatus.ASSIGNED and not complaint.assigned_id:
        raise DomainError(
            "Assign a collector before moving this complaint on.", code="no_assignee"
        )

    now = timezone.now()
    complaint.status = nxt
    fields = ["status", "updated_at"]
    # Stamping these stops the SLA clock — see Complaint.sla_state().
    if nxt == ComplaintStatus.RESOLVED:
        complaint.resolved_at = now
        fields.append("resolved_at")
    elif nxt == ComplaintStatus.CLOSED:
        complaint.closed_at = now
        fields.append("closed_at")
    complaint.save(update_fields=fields)

    # ActivityAction shares its values with ComplaintStatus for the four
    # forward steps, which is what the mock's `commit(c, {status: next}, next)`
    # relied on — the timeline reads 'Work started', 'Resolved', 'Closed'.
    _log(complaint, str(nxt), note=note, user=user)
    _broadcast(complaint)
    return complaint


@transaction.atomic
def resolve_with(complaint: Complaint, note: str = "", *, user=None) -> Complaint:
    """Jump straight to `resolved`, carrying the resolution note.

    The drawer's 'Resolve' button skips the intermediate statuses: a collector
    who fixed an overflow on the spot never passes through `in_progress`, and
    forcing the operator to click twice only produced noise in the trail.
    """
    if complaint.is_closed_out:
        raise DomainError(
            f"{complaint.id} is already {complaint.status}.", code="already_settled"
        )

    complaint.status = ComplaintStatus.RESOLVED
    complaint.resolved_at = timezone.now()
    complaint.save(update_fields=["status", "resolved_at", "updated_at"])
    _log(complaint, ActivityAction.RESOLVED, note=note, user=user)
    _broadcast(complaint)
    return complaint


@transaction.atomic
def reopen(complaint: Complaint, *, user=None, note: str = "") -> Complaint:
    """Send a settled ticket back to `open`.

    Only from `resolved`/`closed`: reopening something that was never settled is
    a no-op that would hide a mis-click behind a legitimate-looking audit entry.
    Both timestamps are cleared so the SLA clock restarts from `opened` — the
    citizen's original wait still counts against us.
    """
    if not complaint.is_closed_out:
        raise DomainError(
            f"{complaint.id} is still {complaint.status}; only a resolved or closed "
            "complaint can be reopened.",
            code="not_settled",
        )

    complaint.status = ComplaintStatus.OPEN
    complaint.resolved_at = None
    complaint.closed_at = None
    complaint.save(update_fields=["status", "resolved_at", "closed_at", "updated_at"])
    _log(complaint, ActivityAction.REOPENED, note=note or "Reopened.", user=user)
    _broadcast(complaint)
    return complaint


@transaction.atomic
def change_priority(complaint: Complaint, priority: str, *, user=None, note: str = "") -> Complaint:
    """Re-grade a ticket, which also re-grades its deadline.

    Priority and SLA are one decision, not two: escalating to urgent without
    pulling the budget down to 4h would leave the ticket looking comfortable
    while a citizen waits. An explicitly overridden SLA is intentionally
    discarded here — the new priority is the more recent instruction.
    """
    new = Priority(priority)
    old = Priority(complaint.priority)
    if new == old:
        return complaint

    complaint.priority = new
    complaint.sla = SLA_HOURS[new]
    complaint.save(update_fields=["priority", "sla", "updated_at"])

    detail = f"Priority {old.label} → {new.label} (SLA {complaint.sla}h)"
    _log(
        complaint,
        ActivityAction.PRIORITY,
        note=f"{detail}. {note}".strip() if note else detail,
        user=user,
    )
    _broadcast(complaint)
    return complaint


@transaction.atomic
def add_note(complaint: Complaint, note: str, *, user=None) -> ComplaintActivity:
    """Append a comment. The only mutation that changes no column."""
    text = (note or "").strip()
    if not text:
        raise DomainError("A note cannot be empty.", code="empty_note")
    # No _broadcast: the map and dashboard render columns, and none changed.
    return _log(complaint, ActivityAction.NOTE, note=text, user=user)


# --------------------------------------------------------------------------- #
# Triage ordering
# --------------------------------------------------------------------------- #


def _triage_annotations(now):
    """The three sort keys, as SQL."""
    # Cast() because `sla` is a PositiveSmallIntegerField, and multiplying one by
    # an interval is rejected outright on SQLite; a plain integer is portable.
    sla_interval = ExpressionWrapper(
        Cast("sla", IntegerField()) * timedelta(hours=1), output_field=DurationField()
    )
    return {
        "_active": Case(
            When(status__in=list(ACTIVE_STATUSES), then=Value(True)),
            default=Value(False),
            output_field=BooleanField(),
        ),
        "_deadline": ExpressionWrapper(
            F("opened") + sla_interval, output_field=DateTimeField()
        ),
        "_priority_rank": Case(
            *[When(priority=value, then=Value(rank)) for value, rank in PRIORITY_RANK.items()],
            default=Value(0),
            output_field=IntegerField(),
        ),
    }


def annotate_triage(queryset, now=None):
    """Add `_active`, `_deadline`, `_priority_rank` and `_breached` to a queryset.

    Split out from `triage_order` so filters (`?breached=true`) and the summary
    endpoint can reuse the same definition of "breached" the ordering uses.
    """
    now = now or timezone.now()
    queryset = queryset.annotate(**_triage_annotations(now))
    # A second annotate() because `_deadline` cannot be referenced in the call
    # that defines it.
    return queryset.annotate(
        _breached=Case(
            When(Q(_active=True) & Q(_deadline__lt=now), then=Value(True)),
            default=Value(False),
            output_field=BooleanField(),
        )
    )


def triage_order(queryset, now=None):
    """Order tickets the way an operator triages, i.e. what `triageSort` did.

    Active before settled, breached before on-time, then urgent→low, then
    oldest-first so nothing starves at the bottom of a priority band.

    All four keys are computed in the database. The breach test is
    `opened + sla * interval '1 hour' < now`, which is why the SLA budget is
    stored as plain hours rather than a rendered label. Two caveats worth
    knowing, neither of which needed Python:

    * `now` is bound when the query is built, so a queryset held open across a
      long request does not silently re-evaluate. Every request re-orders.
    * the *display* values in `slaState` (rounded hours, percentage) stay in
      `Complaint.sla_state()`; only the comparisons live in SQL, so there is one
      formula for sorting and one for presentation and they cannot drift, since
      both read `opened` and `sla`.
    """
    return annotate_triage(queryset, now).order_by(
        "-_active", "-_breached", "-_priority_rank", "opened", "id"
    )
