"""Agencies — the contractors that supply collectors to the city corporation.

An agency employs field collectors, services a set of holdings, takes the
service charge at the door and remits it to KCC. Until now the concept existed
only as `Role.AGENCY_ADMIN` and `ScopeKind.AGENCY`, with no table behind either,
and `Collector.dsp_id` looked like an agency reference but was generated from
the collector's own id — one "DSP" per person, carrying no information.

Two things are deliberately *not* in this module yet:

* **Tenancy.** `Agency` does not restrict what anyone can see. Access is still
  governed entirely by ward, exactly as before. Turning agency into an access
  boundary touches every read path in the system and is its own piece of work;
  doing it here would mean shipping a security change disguised as a new table.
* **Money.** Remittance to KCC has no model yet. `Deposit` cannot carry it —
  it is keyed `(collector, period, method)`, so a single bank transfer covering
  forty collectors has nowhere to live.

Both are planned. This module is the structure they will hang off.
"""

from __future__ import annotations

from django.db import models
from django.utils import timezone

from swms.common.ids import agency_id
from swms.common.models import TextKeyModel, TimeStampedModel


class AgencyStatus(models.TextChoices):
    ACTIVE = "active", "Active"
    SUSPENDED = "suspended", "Suspended"
    EXPIRED = "expired", "Contract expired"
    TERMINATED = "terminated", "Terminated"


class Agency(TextKeyModel):
    """A service provider under contract to the city corporation."""

    name = models.CharField(max_length=160)
    #: Shown when the app is in Bangla; empty falls back to `name`.
    name_bn = models.CharField(max_length=160, blank=True)
    short_code = models.CharField(
        max_length=12, unique=True, help_text="Short label for reports and exports, e.g. 'PCM'"
    )
    #: From the setup list (`catalog.AgencyType`): private company, NGO, CBO,
    #: cooperative, or the city's own in-house service.
    agency_type = models.ForeignKey(
        "catalog.AgencyType",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="agencies",
    )

    # --- what KCC audits --------------------------------------------------- #
    trade_licence_no = models.CharField(max_length=40, blank=True)
    registration_no = models.CharField(
        max_length=40, blank=True, help_text="NGO/society/cooperative registration, if any"
    )
    tin = models.CharField(max_length=20, blank=True, verbose_name="TIN")
    bin = models.CharField(max_length=20, blank=True, verbose_name="BIN")

    # --- who to call ------------------------------------------------------- #
    contact_person = models.CharField(max_length=120, blank=True)
    phone = models.CharField(max_length=20, blank=True)
    alt_phone = models.CharField(max_length=20, blank=True)
    email = models.EmailField(blank=True)
    address = models.CharField(max_length=200, blank=True)

    # --- contract ---------------------------------------------------------- #
    contract_no = models.CharField(max_length=40, blank=True)
    contract_start = models.DateField(null=True, blank=True)
    contract_end = models.DateField(null=True, blank=True)

    #: The city corporation or pourashova this contractor works for. The client
    #: calls an agency the "customer"; one city may have several. Nullable for
    #: the same reason as `Zone.city`.
    city = models.ForeignKey(
        "catalog.City", null=True, blank=True, on_delete=models.PROTECT, related_name="agencies"
    )

    #: Wards this agency works in. Reporting and the agency page read this;
    #: it is NOT the access boundary — two agencies may share a ward, so a ward
    #: cannot say who a row belongs to. `Holding.agency` answers that.
    service_wards = models.ManyToManyField(
        "catalog.Ward", blank=True, related_name="agencies"
    )

    status = models.CharField(
        max_length=12, choices=AgencyStatus.choices, default=AgencyStatus.ACTIVE
    )
    active = models.BooleanField(default=True)
    notes = models.TextField(blank=True)

    class Meta:
        db_table = "agency"
        ordering = ["name"]
        verbose_name_plural = "agencies"
        indexes = [models.Index(fields=["status"], name="agency_status_idx")]

    def __str__(self) -> str:
        return f"{self.short_code} — {self.name}"

    def save(self, *args, **kwargs):
        if not self.id:
            self.id = agency_id()
        super().save(*args, **kwargs)

    @property
    def contract_expired(self) -> bool:
        """Derived, never stored — a flag would be stale the day it matters."""
        return bool(self.contract_end and self.contract_end < timezone.localdate())

    @property
    def collector_count(self) -> int:
        return self.collectors.filter(active=True).count()


class CollectorEmployment(TimeStampedModel):
    """Which agency employed a collector, and when.

    Collectors move between agencies, so the current employer is not enough:
    without dates, a transfer would silently re-attribute the collector's past
    work — and therefore past revenue — to whoever employs them today.

    `Collector.agency` holds the *current* employer for filtering and joins;
    this table is the history behind it. Both are written together by
    `services.transfer_collector`, which is the only supported way to change
    either.
    """

    collector = models.ForeignKey(
        "fieldops.Collector", on_delete=models.CASCADE, related_name="employments"
    )
    agency = models.ForeignKey(Agency, on_delete=models.PROTECT, related_name="employments")
    from_date = models.DateField()
    to_date = models.DateField(
        null=True, blank=True, help_text="Null while this is the collector's current agency"
    )
    note = models.CharField(max_length=200, blank=True)

    class Meta:
        db_table = "collector_employment"
        ordering = ["collector_id", "-from_date"]
        indexes = [
            models.Index(fields=["collector", "-from_date"], name="employment_collector_idx"),
            models.Index(fields=["agency"], name="employment_agency_idx"),
        ]
        constraints = [
            # A collector works for one agency at a time. Postgres treats NULLs
            # as distinct, so this only bites open-ended rows — which is exactly
            # the case worth preventing.
            models.UniqueConstraint(
                fields=["collector"],
                condition=models.Q(to_date__isnull=True),
                name="employment_one_current_per_collector",
            ),
            models.CheckConstraint(
                condition=models.Q(to_date__isnull=True) | models.Q(to_date__gte=models.F("from_date")),
                name="employment_dates_ordered",
            ),
        ]

    def __str__(self) -> str:
        end = self.to_date.isoformat() if self.to_date else "current"
        return f"{self.collector_id} @ {self.agency_id} ({self.from_date} → {end})"

    @property
    def is_current(self) -> bool:
        return self.to_date is None

    def covers(self, on_date) -> bool:
        """Was this collector with this agency on `on_date`?"""
        if on_date < self.from_date:
            return False
        return self.to_date is None or on_date <= self.to_date
