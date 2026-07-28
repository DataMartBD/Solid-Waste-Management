"""Vehicles, their paperwork, workshop history and GPS trail.

`VehiclePosition` is new. The mock LiveMap invented collector coordinates by
nudging the ward centre; with a real backend, positions are telemetry rows that
also feed the websocket stream.
"""

from __future__ import annotations

from django.db import models
from django.utils import timezone

from swms.common.ids import fuel_id, maintenance_id, van_id
from swms.common.models import TextKeyModel, TimeStampedModel


class VanType(models.TextChoices):
    COMPACTOR = "compactor", "Compactor"
    PICKUP = "pickup", "Pickup"
    RICKSHAW_VAN = "rickshaw-van", "Rickshaw van"
    TRICYCLE = "tricycle", "Tricycle"


class FuelType(models.TextChoices):
    DIESEL = "diesel", "Diesel"
    PETROL = "petrol", "Petrol"
    CNG = "cng", "CNG"
    ELECTRIC = "electric", "Electric"


class Ownership(models.TextChoices):
    OWNED = "owned", "Owned"
    LEASED = "leased", "Leased"


class VanStatus(models.TextChoices):
    ACTIVE = "active", "Active"
    IN_MAINTENANCE = "in_maintenance", "In maintenance"
    IDLE = "idle", "Idle"
    RETIRED = "retired", "Retired"


class MaintenanceKind(models.TextChoices):
    SCHEDULED = "scheduled", "Scheduled"
    UNSCHEDULED = "unscheduled", "Unscheduled"


class Van(TextKeyModel):
    """A collection vehicle. `id` looks like 'VAN-KCC-017'."""

    plate = models.CharField(max_length=48, unique=True)
    type = models.CharField(max_length=16, choices=VanType.choices)
    capacity = models.PositiveIntegerField(help_text="Payload capacity in kg")
    fuel = models.CharField(max_length=10, choices=FuelType.choices)
    ownership = models.CharField(max_length=8, choices=Ownership.choices, default=Ownership.OWNED)
    gps = models.CharField(max_length=24, blank=True, help_text="Tracker device id")
    odometer = models.PositiveIntegerField(default=0, help_text="Kilometres")
    status = models.CharField(max_length=16, choices=VanStatus.choices, default=VanStatus.ACTIVE)
    driver = models.ForeignKey(
        "fieldops.Collector",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="vans",
    )

    fitness_exp = models.DateField(null=True, blank=True)
    tax_exp = models.DateField(null=True, blank=True)
    insurance_exp = models.DateField(null=True, blank=True)
    permit_exp = models.DateField(null=True, blank=True)

    next_service_km = models.PositiveIntegerField(null=True, blank=True)
    #: Null for electric vehicles.
    kmpl = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)

    class Meta:
        db_table = "van"
        ordering = ["id"]
        indexes = [models.Index(fields=["status"]), models.Index(fields=["driver"])]

    def __str__(self) -> str:
        return f"{self.id} — {self.plate}"

    def save(self, *args, **kwargs):
        if not self.id:
            self.id = van_id()
        super().save(*args, **kwargs)

    def expiring_documents(self, within_days: int = 30, today=None) -> list[dict]:
        """Paperwork due within `within_days`, or already lapsed.

        The Fleet page compared against a hard-coded date; this takes the real
        current day unless a reference date is supplied.
        """
        today = today or timezone.localdate()
        out = []
        for field, label in (
            ("fitness_exp", "fitness"),
            ("tax_exp", "tax"),
            ("insurance_exp", "insurance"),
            ("permit_exp", "permit"),
        ):
            value = getattr(self, field)
            if not value:
                continue
            days = (value - today).days
            if days <= within_days:
                out.append({"document": label, "expires": value, "days": days})
        return sorted(out, key=lambda row: row["days"])

    @property
    def service_due_in_km(self) -> int | None:
        if self.next_service_km is None:
            return None
        return self.next_service_km - self.odometer


class Maintenance(TextKeyModel):
    """A workshop visit. Open while `closed` is null."""

    van = models.ForeignKey(Van, on_delete=models.CASCADE, related_name="maintenance")
    kind = models.CharField(max_length=12, choices=MaintenanceKind.choices)
    reason = models.CharField(max_length=200)
    odometer = models.PositiveIntegerField()
    opened = models.DateTimeField(default=timezone.now)
    closed = models.DateTimeField(null=True, blank=True)
    downtime = models.DecimalField(
        max_digits=7, decimal_places=2, default=0, help_text="Hours out of service"
    )
    cost = models.PositiveIntegerField(default=0, help_text="BDT")
    vendor = models.CharField(max_length=120, blank=True)

    class Meta:
        db_table = "maintenance"
        ordering = ["-opened"]
        indexes = [models.Index(fields=["van", "-opened"]), models.Index(fields=["closed"])]

    def __str__(self) -> str:
        return f"{self.id} — {self.van_id}"

    def save(self, *args, **kwargs):
        if not self.id:
            self.id = maintenance_id()
        super().save(*args, **kwargs)

    @property
    def is_open(self) -> bool:
        return self.closed is None


class FuelLog(TextKeyModel):
    """A refuelling or charging event."""

    van = models.ForeignKey(Van, on_delete=models.CASCADE, related_name="fuel_logs")
    litres = models.DecimalField(max_digits=7, decimal_places=2)
    cost = models.PositiveIntegerField(help_text="BDT")
    odometer = models.PositiveIntegerField()
    by = models.ForeignKey(
        "fieldops.Collector", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    at = models.DateTimeField(default=timezone.now)
    kmpl = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)

    class Meta:
        db_table = "fuel_log"
        ordering = ["-at"]
        indexes = [models.Index(fields=["van", "-at"])]

    def __str__(self) -> str:
        return f"{self.id} — {self.van_id}"

    def save(self, *args, **kwargs):
        if not self.id:
            self.id = fuel_id()
        if self.kmpl is None and self.litres:
            previous = (
                FuelLog.objects.filter(van=self.van, odometer__lt=self.odometer)
                .order_by("-odometer")
                .first()
            )
            if previous:
                distance = self.odometer - previous.odometer
                if distance > 0:
                    self.kmpl = round(distance / float(self.litres), 2)
        super().save(*args, **kwargs)


class VehiclePosition(TimeStampedModel):
    """A GPS ping. The newest row per van drives the live map."""

    van = models.ForeignKey(Van, on_delete=models.CASCADE, related_name="positions")
    collector = models.ForeignKey(
        "fieldops.Collector", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    lat = models.DecimalField(max_digits=9, decimal_places=6)
    lng = models.DecimalField(max_digits=9, decimal_places=6)
    speed = models.DecimalField(
        max_digits=5, decimal_places=2, null=True, blank=True, help_text="km/h"
    )
    heading = models.PositiveSmallIntegerField(null=True, blank=True, help_text="Degrees")
    accuracy = models.PositiveSmallIntegerField(null=True, blank=True)
    ignition = models.BooleanField(default=True)
    at = models.DateTimeField(default=timezone.now, db_index=True)

    class Meta:
        db_table = "vehicle_position"
        ordering = ["-at"]
        indexes = [models.Index(fields=["van", "-at"])]
        get_latest_by = "at"

    def __str__(self) -> str:
        return f"{self.van_id} @ {self.lat},{self.lng}"
