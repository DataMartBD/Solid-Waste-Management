"""Collectors, route plans and the daily round.

Two mock-data shapes are normalised here:

* `route.stops` was an ordered array of ids → the `RouteStop` through table,
  with the ordering held in `seq`. A stop is a **building**: a collector walks
  to an address once and empties every flat in it, so the plan is holding-wise
  and a block of twelve is one stop rather than twelve. A building belongs to
  exactly one route, which is a database constraint rather than a convention.
  Collection remains per family — see `RouteStop` and `round_for_collector`.
* `assignment.routes` was an array of route ids → `AssignmentRoute`. A collector
  has at most one *active* assignment, also enforced.

`Collector.ward` is the column the mock called `zone` while storing a ward id
(`'W-14'`). The API still speaks `zone` for compatibility; the column tells the
truth.
"""

from __future__ import annotations

import datetime as dt

from django.core.validators import MaxValueValidator
from django.db import models, transaction
from django.db.models import Q
from django.utils import timezone

from swms.common.ids import assignment_id, collector_id, route_id, visit_id
from swms.common.models import TextKeyModel, TimeStampedModel


class CollectorStatus(models.TextChoices):
    ON_ROUTE = "on_route", "On route"
    IDLE = "idle", "Idle"
    OFF_ROUTE = "off_route", "Off route"


class Attendance(models.TextChoices):
    CHECKED_IN = "checked_in", "Checked in"
    ABSENT = "absent", "Absent"


class VisitStatus(models.TextChoices):
    COLLECTED = "collected", "Collected"
    SKIPPED = "skipped", "Skipped"


class VisitSource(models.TextChoices):
    SCAN = "scan", "QR scan"
    MANUAL = "manual", "Manual entry"


class SkipReason(models.TextChoices):
    NO_ONE = "noOne", "No one home"
    NO_WASTE = "noWaste", "No waste to collect"
    LOCKED = "locked", "Premises locked"
    ACCESS = "access", "Could not access"
    REFUSED = "refused", "Householder refused"


class Collector(TextKeyModel):
    """A field collector (DSP staff). `id` looks like 'C-042'."""

    name = models.CharField(max_length=120)
    dsp_id = models.CharField(max_length=20, unique=True, help_text="e.g. DSP-0042")
    #: Current employer. History lives in `agencies.CollectorEmployment`, and
    #: both are written together by `agencies.services.transfer_collector` —
    #: setting this directly leaves the history with a gap. Nullable while
    #: agencies are being adopted; a collector with no agency is KCC's own.
    agency = models.ForeignKey(
        "agencies.Agency",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="collectors",
    )
    ward = models.ForeignKey(
        "catalog.Ward",
        on_delete=models.PROTECT,
        related_name="collectors",
        help_text="Home ward. Exposed as 'zone' by the API for backwards compatibility.",
    )
    phone = models.CharField(max_length=20, blank=True)

    status = models.CharField(
        max_length=12, choices=CollectorStatus.choices, default=CollectorStatus.IDLE
    )
    attendance = models.CharField(
        max_length=12, choices=Attendance.choices, default=Attendance.CHECKED_IN
    )

    license = models.CharField(max_length=32, blank=True)
    license_exp = models.DateField(null=True, blank=True)
    joined = models.DateField(null=True, blank=True)
    active = models.BooleanField(default=True)

    # Rolling performance figures, refreshed by
    # fieldops.services.refresh_collector_metrics rather than written by hand.
    on_time = models.PositiveSmallIntegerField(
        default=0, validators=[MaxValueValidator(100)], help_text="On-time completion %"
    )
    coverage = models.PositiveSmallIntegerField(
        default=0, validators=[MaxValueValidator(100)], help_text="Stop coverage %"
    )
    metrics_updated_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "collector"
        ordering = ["id"]
        indexes = [models.Index(fields=["ward", "status"])]

    def __str__(self) -> str:
        return f"{self.id} — {self.name}"

    def save(self, *args, **kwargs):
        if not self.id:
            self.id = collector_id()
        if not self.dsp_id:
            self.dsp_id = "DSP-" + self.id.split("-")[-1].zfill(4)
        super().save(*args, **kwargs)

    @property
    def open_complaint_count(self) -> int:
        """Live count — the mock stored this as a drifting integer column."""
        return self.assigned_complaints.filter(
            status__in=["open", "assigned", "in_progress"]
        ).count()

    def active_assignment(self) -> "Assignment | None":
        return self.assignments.filter(active=True).first()


class Route(TextKeyModel):
    """An ordered walk of stops down one road, run inside a time window."""

    name = models.CharField(max_length=120, help_text="Usually the road name")
    ward = models.ForeignKey("catalog.Ward", on_delete=models.PROTECT, related_name="routes")
    #: Whose round this is. A route used to be identified by its ward alone,
    #: which stopped being enough once two contractors could work one ward —
    #: "the KDA Avenue round" is then two different rounds.
    agency = models.ForeignKey(
        "agencies.Agency",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="routes",
    )
    # Real `time` objects, not the strings these used to be. A string default is
    # accepted on the way into the database, but the in-memory instance keeps it
    # verbatim — so a route created without explicit times and then serialised in
    # the same breath reached `window` below holding a `str`, and formatting it
    # raised. That is every route created through the API without a window.
    window_start = models.TimeField(default=dt.time(6, 0))
    window_end = models.TimeField(default=dt.time(9, 30))
    active = models.BooleanField(default=True)

    class Meta:
        db_table = "route"
        ordering = ["ward_id", "id"]
        indexes = [models.Index(fields=["ward", "active"])]

    def __str__(self) -> str:
        return f"{self.id} — {self.name}"

    def save(self, *args, **kwargs):
        if not self.id:
            self.id = route_id(self.ward_id)
        super().save(*args, **kwargs)

    @property
    def window(self) -> str:
        """'06:00–09:30' with an en dash, as the UI renders it."""
        return f"{self.window_start:%H:%M}–{self.window_end:%H:%M}"

    def holding_ids(self) -> list[str]:
        return list(self.stops.order_by("seq").values_list("holding_id", flat=True))

    @transaction.atomic
    def resequence(self, holding_ids: list[str]) -> None:
        """Rewrite the stop order from a list of holding ids.

        Runs in a transaction because reordering necessarily passes through
        states where two stops briefly share a `seq` — the uniqueness check is
        deferred to commit (see RouteStop.Meta), which is what makes a plain
        move-up/move-down permutation possible in one pass.
        """
        existing = {s.holding_id: s for s in self.stops.all()}
        keep = []
        for index, holding_id in enumerate(holding_ids, start=1):
            stop = existing.pop(holding_id, None)
            if stop is None:
                RouteStop.objects.update_or_create(
                    holding_id=holding_id, defaults={"route": self, "seq": index}
                )
            elif stop.seq != index:
                stop.seq = index
                keep.append(stop)
        if keep:
            RouteStop.objects.bulk_update(keep, ["seq"])
        if existing:
            RouteStop.objects.filter(pk__in=[s.pk for s in existing.values()]).delete()


class RouteStop(models.Model):
    """One building's place in one route's running order.

    A stop is a *building*, not a family. A collector walks to an address once
    and takes the waste of everyone in it, so a twelve-flat block is one stop on
    the plan rather than twelve — which is what a planner dragging a round
    actually means, and what the pin on the map represents.

    Collection stays per family: the round expands each stop into the households
    inside it, so every flat keeps its own QR tag, visit record and bill.
    """

    route = models.ForeignKey(Route, on_delete=models.CASCADE, related_name="stops")
    holding = models.OneToOneField(
        "customers.Holding", on_delete=models.CASCADE, related_name="route_stop"
    )
    seq = models.PositiveSmallIntegerField()

    class Meta:
        db_table = "route_stop"
        ordering = ["route_id", "seq"]
        constraints = [
            # DEFERRED: swapping two stops writes both new positions in one
            # statement, so the rows legitimately collide mid-transaction. An
            # immediate check would reject every reorder on the planner screen.
            models.UniqueConstraint(
                fields=["route", "seq"],
                name="route_stop_unique_seq",
                deferrable=models.Deferrable.DEFERRED,
            )
        ]

    def __str__(self) -> str:
        return f"{self.route_id}#{self.seq} {self.holding_id}"


class Assignment(TextKeyModel):
    """Which routes a collector is responsible for."""

    collector = models.ForeignKey(
        Collector, on_delete=models.CASCADE, related_name="assignments"
    )
    routes = models.ManyToManyField(
        Route, through="AssignmentRoute", related_name="assignments"
    )
    active = models.BooleanField(default=True)
    effective_from = models.DateField(default=timezone.localdate)

    class Meta:
        db_table = "assignment"
        ordering = ["collector_id"]
        constraints = [
            # A collector runs one plan at a time.
            models.UniqueConstraint(
                fields=["collector"],
                condition=Q(active=True),
                name="assignment_one_active_per_collector",
            )
        ]

    def __str__(self) -> str:
        return f"{self.id} → {self.collector_id}"

    def save(self, *args, **kwargs):
        if not self.id:
            self.id = assignment_id()
        super().save(*args, **kwargs)

    def route_ids(self) -> list[str]:
        return list(self.route_links.order_by("seq").values_list("route_id", flat=True))

    def set_routes(self, route_ids: list[str]) -> None:
        """Replace this assignment's routes, stealing them from other collectors.

        The RoutePlan page allows reassigning a route that already belongs to
        somebody else, so any conflicting active link is removed first.

        Stealing stops at the agency boundary. Within one contractor a
        supervisor moving a round between their own collectors is ordinary
        planning; across contractors it would take a rival's work off them
        silently, and no ownership check existed here before.
        """
        from swms.common.exceptions import DomainError

        taking_from = (
            AssignmentRoute.objects.filter(route_id__in=route_ids, assignment__active=True)
            .exclude(assignment=self)
            .select_related("assignment__collector", "route")
        )
        mine = self.collector.agency_id
        poached = [
            link
            for link in taking_from
            if link.assignment.collector.agency_id != mine
        ]
        if poached:
            names = ", ".join(sorted({link.route_id for link in poached}))
            raise DomainError(
                f"These routes belong to another agency and cannot be reassigned: {names}.",
                code="route_other_agency",
            )

        taking_from.delete()
        self.route_links.all().delete()
        AssignmentRoute.objects.bulk_create(
            [
                AssignmentRoute(assignment=self, route_id=rid, seq=index)
                for index, rid in enumerate(route_ids, start=1)
            ]
        )


class AssignmentRoute(models.Model):
    assignment = models.ForeignKey(
        Assignment, on_delete=models.CASCADE, related_name="route_links"
    )
    route = models.ForeignKey(Route, on_delete=models.CASCADE, related_name="assignment_links")
    seq = models.PositiveSmallIntegerField(default=0)

    class Meta:
        db_table = "assignment_route"
        ordering = ["assignment_id", "seq"]
        constraints = [
            models.UniqueConstraint(
                fields=["assignment", "route"], name="assignment_route_unique"
            )
        ]

    def __str__(self) -> str:
        return f"{self.assignment_id}:{self.route_id}"


class Visit(TextKeyModel):
    """A collection attempt at one household on one day.

    There is no 'pending' status: a stop with no `Visit` row for today *is*
    pending. Correcting a skip updates the existing row rather than adding a
    second one, which the `(household, served_on)` constraint guarantees.
    """

    household = models.ForeignKey(
        "customers.Household", on_delete=models.CASCADE, related_name="visits"
    )
    collector = models.ForeignKey(
        Collector, null=True, blank=True, on_delete=models.SET_NULL, related_name="visits"
    )
    #: Which vehicle actually served the stop. Stamped from the collector's van
    #: at the moment of recording, because `Van.driver` is only ever the *current*
    #: driver — reading it later would misattribute an old visit to whoever
    #: happens to be driving now. Null on every visit recorded before this field
    #: existed; that history is not recoverable from the data we hold.
    van = models.ForeignKey(
        "fleet.Van", null=True, blank=True, on_delete=models.SET_NULL, related_name="visits"
    )
    #: Whose operation did this work — stamped from the collector's employment
    #: at the moment of recording, never resolved at read time. A collector who
    #: moves to another agency would otherwise take every past round with them,
    #: silently restating last quarter's coverage figures. Null when no
    #: collector is attached, because then nobody's agency did it.
    agency = models.ForeignKey(
        "agencies.Agency",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="visits",
    )
    route = models.ForeignKey(
        Route, null=True, blank=True, on_delete=models.SET_NULL, related_name="visits"
    )
    qr = models.CharField(
        max_length=24, blank=True, help_text="Tag as scanned, kept for audit even if it changes"
    )

    status = models.CharField(max_length=10, choices=VisitStatus.choices)
    at = models.DateTimeField(db_index=True)
    served_on = models.DateField(
        db_index=True, help_text="Local date of `at`; one visit per household per day"
    )

    accuracy = models.PositiveSmallIntegerField(null=True, blank=True)
    lat = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    lng = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    source = models.CharField(max_length=8, choices=VisitSource.choices, blank=True)
    reason = models.CharField(
        max_length=12, choices=SkipReason.choices, blank=True, help_text="Required when skipped"
    )
    note = models.CharField(max_length=240, blank=True)
    photo = models.ImageField(upload_to="visits/%Y/%m/", null=True, blank=True)

    #: False while the record is still only on the collector's device.
    synced = models.BooleanField(default=True)
    recorded_by = models.ForeignKey(
        "accounts.User", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )

    class Meta:
        db_table = "visit"
        ordering = ["-at"]
        indexes = [
            models.Index(fields=["household", "-served_on"]),
            models.Index(fields=["collector", "-served_on"]),
            models.Index(fields=["served_on", "status"]),
            models.Index(fields=["synced"]),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["household", "served_on"], name="visit_one_per_household_per_day"
            ),
            models.CheckConstraint(
                condition=Q(status="collected") | ~Q(reason=""),
                name="visit_skip_needs_reason",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.id} {self.household_id} {self.status}"

    def save(self, *args, **kwargs):
        if not self.id:
            self.id = visit_id()
        if not self.at:
            self.at = timezone.now()
        self.served_on = timezone.localtime(self.at).date()
        if self.status == VisitStatus.COLLECTED:
            self.reason = ""
        super().save(*args, **kwargs)
