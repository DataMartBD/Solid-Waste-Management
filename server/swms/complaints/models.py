"""Citizen complaints, their audit trail and SLA clock.

The mock kept `activity` as a nested array on the complaint; it becomes a child
table so entries are individually queryable and immutable. SLA hours derive from
priority (urgent 4h, high 12h, medium 24h, low 48h) but remain overridable.
"""

from __future__ import annotations

from django.db import models
from django.utils import timezone

from swms.common.ids import complaint_id
from swms.common.models import TextKeyModel, TimeStampedModel


class ComplaintType(models.TextChoices):
    MISSED_COLLECTION = "missed_collection", "Missed collection"
    OVERFLOW = "overflow", "Bin overflow"
    BILLING_DISPUTE = "billing_dispute", "Billing dispute"
    STAFF_BEHAVIOUR = "staff_behaviour", "Staff behaviour"
    OTHER = "other", "Other"


class Channel(models.TextChoices):
    SMS = "sms", "SMS"
    APP = "app", "App"
    PHONE = "phone", "Phone call"
    COUNTER = "counter", "Service counter"


class ComplaintStatus(models.TextChoices):
    OPEN = "open", "Open"
    ASSIGNED = "assigned", "Assigned"
    IN_PROGRESS = "in_progress", "In progress"
    RESOLVED = "resolved", "Resolved"
    CLOSED = "closed", "Closed"


class Priority(models.TextChoices):
    URGENT = "urgent", "Urgent"
    HIGH = "high", "High"
    MEDIUM = "medium", "Medium"
    LOW = "low", "Low"


class ActivityAction(models.TextChoices):
    CREATED = "created", "Created"
    ASSIGNED = "assigned", "Assigned"
    IN_PROGRESS = "in_progress", "Work started"
    RESOLVED = "resolved", "Resolved"
    CLOSED = "closed", "Closed"
    REASSIGNED = "reassigned", "Reassigned"
    PRIORITY = "priority", "Priority changed"
    NOTE = "note", "Note added"
    REOPENED = "reopened", "Reopened"


#: The forward path a complaint walks. Matches LIFECYCLE in utils/complaints.js.
LIFECYCLE = [
    ComplaintStatus.OPEN,
    ComplaintStatus.ASSIGNED,
    ComplaintStatus.IN_PROGRESS,
    ComplaintStatus.RESOLVED,
    ComplaintStatus.CLOSED,
]

ACTIVE_STATUSES = [
    ComplaintStatus.OPEN,
    ComplaintStatus.ASSIGNED,
    ComplaintStatus.IN_PROGRESS,
]

#: Hours allowed before the SLA is breached.
SLA_HOURS = {
    Priority.URGENT: 4,
    Priority.HIGH: 12,
    Priority.MEDIUM: 24,
    Priority.LOW: 48,
}

#: Higher rank sorts first in triage.
PRIORITY_RANK = {Priority.URGENT: 3, Priority.HIGH: 2, Priority.MEDIUM: 1, Priority.LOW: 0}


class Complaint(TextKeyModel):
    household = models.ForeignKey(
        "customers.Household", on_delete=models.CASCADE, related_name="complaints"
    )
    #: Denormalised from the household so ward reports stay a single-table scan.
    ward = models.ForeignKey("catalog.Ward", on_delete=models.PROTECT, related_name="complaints")

    type = models.CharField(max_length=24, choices=ComplaintType.choices)
    channel = models.CharField(max_length=10, choices=Channel.choices, default=Channel.APP)
    status = models.CharField(
        max_length=12, choices=ComplaintStatus.choices, default=ComplaintStatus.OPEN
    )
    priority = models.CharField(max_length=8, choices=Priority.choices, default=Priority.MEDIUM)
    description = models.TextField(blank=True)

    assigned = models.ForeignKey(
        "fieldops.Collector",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="assigned_complaints",
    )
    opened = models.DateTimeField(default=timezone.now, db_index=True)
    resolved_at = models.DateTimeField(null=True, blank=True)
    closed_at = models.DateTimeField(null=True, blank=True)

    sla = models.PositiveSmallIntegerField(help_text="Budget in hours")
    reported_by = models.ForeignKey(
        "accounts.User", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    reporter_phone = models.CharField(max_length=20, blank=True)

    class Meta:
        db_table = "complaint"
        ordering = ["-opened"]
        indexes = [
            models.Index(fields=["status", "-opened"]),
            models.Index(fields=["ward", "status"]),
            models.Index(fields=["assigned", "status"]),
            models.Index(fields=["household"]),
        ]

    def __str__(self) -> str:
        return f"{self.id} — {self.get_type_display()}"

    def save(self, *args, **kwargs):
        if not self.id:
            self.id = complaint_id()
        if not self.ward_id:
            self.ward_id = self.household.ward_id
        if not self.sla:
            self.sla = SLA_HOURS[Priority(self.priority)]
        super().save(*args, **kwargs)

    # --- SLA ------------------------------------------------------------- #

    @property
    def is_active(self) -> bool:
        return self.status in ACTIVE_STATUSES

    @property
    def is_closed_out(self) -> bool:
        return self.status in {ComplaintStatus.RESOLVED, ComplaintStatus.CLOSED}

    def sla_state(self, now=None) -> dict:
        """Elapsed/remaining hours and breach flag.

        A resolved or closed complaint is never "breached" — the clock stops at
        the moment it was resolved, mirroring slaState() in the frontend.
        """
        now = now or timezone.now()
        end = self.resolved_at or self.closed_at or now
        elapsed = max((end - self.opened).total_seconds() / 3600.0, 0.0)
        budget = float(self.sla or 0)
        remaining = budget - elapsed
        active = self.is_active
        return {
            "budget": budget,
            "elapsed": round(elapsed, 2),
            "remaining": round(remaining, 2),
            "active": active,
            "breached": bool(active and remaining < 0),
            "pct": round(min(elapsed / budget, 1.0) * 100, 1) if budget else 0.0,
        }

    @property
    def priority_rank(self) -> int:
        return PRIORITY_RANK.get(Priority(self.priority), 0)

    def next_status(self) -> str | None:
        try:
            index = LIFECYCLE.index(ComplaintStatus(self.status))
        except ValueError:
            return None
        return LIFECYCLE[index + 1] if index + 1 < len(LIFECYCLE) else None

    def log(self, action: str, *, note: str = "", actor: str = "System", user=None, at=None):
        """Append an audit entry. Every mutation must go through this."""
        return ComplaintActivity.objects.create(
            complaint=self,
            action=action,
            note=note,
            actor=actor if not user else user.name,
            actor_user=user,
            at=at or timezone.now(),
        )


class ComplaintActivity(TimeStampedModel):
    """One immutable line of a complaint's history."""

    complaint = models.ForeignKey(Complaint, on_delete=models.CASCADE, related_name="activity")
    at = models.DateTimeField(default=timezone.now)
    action = models.CharField(max_length=16, choices=ActivityAction.choices)
    #: Free-text actor, so system actors ('Control Room', 'Citizen · SMS') fit too.
    actor = models.CharField(max_length=120, default="System")
    actor_user = models.ForeignKey(
        "accounts.User", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    note = models.TextField(blank=True)

    class Meta:
        db_table = "complaint_activity"
        ordering = ["at", "id"]
        indexes = [models.Index(fields=["complaint", "at"])]
        verbose_name_plural = "complaint activity"

    def __str__(self) -> str:
        return f"{self.complaint_id} {self.action} @ {self.at:%Y-%m-%d %H:%M}"


class ComplaintPhoto(TimeStampedModel):
    """Evidence attached by a citizen or a collector."""

    complaint = models.ForeignKey(Complaint, on_delete=models.CASCADE, related_name="photos")
    image = models.ImageField(upload_to="complaints/%Y/%m/")
    caption = models.CharField(max_length=200, blank=True)
    uploaded_by = models.ForeignKey(
        "accounts.User", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )

    class Meta:
        db_table = "complaint_photo"
        ordering = ["created_at"]

    def __str__(self) -> str:
        return f"photo for {self.complaint_id}"
