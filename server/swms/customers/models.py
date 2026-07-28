"""Households under service, and surveyed holdings that are not yet customers.

Two tables share most of their columns because a `PotentialCustomer` is a
household-shaped survey record. The difference is deliberate and matches the
field workflow: payment terms (`charge`, `payment_mode`, `payment_day`) only
exist once a holding is actually signed up, so they live on `Household` alone.

Two fixes over the mock data are baked in here:

* `lastVisit` is **not** a column. The mock carried a stale seed value that
  collecting never updated; "last served" is now derived from `Visit` rows.
* `verified_by` is a real reference instead of a string that was sometimes a
  collector id and sometimes an operator's name.
"""

from __future__ import annotations

from decimal import Decimal

from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models

from swms.common.ids import household_id, potential_id, qr_tag
from swms.common.models import TextKeyModel


class HoldingStatus(models.TextChoices):
    ACTIVE = "active", "Active"
    INACTIVE = "inactive", "Inactive"


class ContactProfile(models.Model):
    """The customer-sheet block collected during a survey."""

    customer_type = models.ForeignKey(
        "catalog.CustomerType", on_delete=models.PROTECT, related_name="+"
    )
    profession = models.CharField(max_length=80, blank=True)
    address = models.CharField(max_length=200, blank=True)
    email = models.EmailField(blank=True)
    alt_phone = models.CharField(max_length=20, blank=True)
    contact_person = models.CharField(max_length=120, blank=True)
    blood_group = models.CharField(max_length=4, blank=True)

    members = models.PositiveSmallIntegerField(default=0)
    members_under5 = models.PositiveSmallIntegerField(default=0)
    members_female = models.PositiveSmallIntegerField(default=0)

    storage = models.ForeignKey("catalog.StorageType", on_delete=models.PROTECT, related_name="+")
    holding_type = models.ForeignKey(
        "catalog.HoldingType", on_delete=models.PROTECT, related_name="+"
    )
    floor = models.CharField(max_length=32, blank=True)
    suitable_time = models.ForeignKey(
        "catalog.SuitableTime", on_delete=models.PROTECT, related_name="+"
    )

    class Meta:
        abstract = True


class LocatableHolding(TextKeyModel):
    """Where a holding is, and whether its pin has been confirmed on the ground."""

    ward = models.ForeignKey("catalog.Ward", on_delete=models.PROTECT, related_name="+")
    road = models.ForeignKey("catalog.Road", on_delete=models.PROTECT, related_name="+")
    holding = models.CharField(max_length=24, help_text="Holding number, e.g. 142/B")
    head = models.CharField(max_length=120, help_text="Head of household / contact name")
    phone = models.CharField(max_length=20, blank=True)

    lat = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    lng = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    accuracy = models.PositiveSmallIntegerField(
        null=True, blank=True, help_text="GPS accuracy in metres"
    )
    verified = models.BooleanField(default=False)
    verified_at = models.DateTimeField(null=True, blank=True)
    verified_by = models.ForeignKey(
        "fieldops.Collector",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
    verified_by_user = models.ForeignKey(
        "accounts.User", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    placed_by_hand = models.BooleanField(
        default=False, help_text="Pin dropped manually rather than captured from GPS"
    )

    class Meta:
        abstract = True

    @property
    def verified_by_label(self) -> str | None:
        """What the UI shows in the 'verified by' column."""
        if self.verified_by_id:
            return self.verified_by_id
        if self.verified_by_user_id:
            return self.verified_by_user.name
        return None

    @property
    def has_location(self) -> bool:
        return self.lat is not None and self.lng is not None


class Household(ContactProfile, LocatableHolding):
    """A holding under service. The centre of the domain."""

    qr = models.CharField(
        max_length=24,
        unique=True,
        null=True,
        blank=True,
        help_text="QR tag printed on the bin sticker, e.g. SS-9F3A21",
    )
    tier = models.ForeignKey("catalog.Tier", on_delete=models.PROTECT, related_name="households")
    status = models.CharField(
        max_length=10, choices=HoldingStatus.choices, default=HoldingStatus.ACTIVE
    )

    # Negotiated charge. 0 means "use the tier's standard charge".
    charge = models.PositiveIntegerField(default=0)
    payment_mode = models.ForeignKey(
        "catalog.PaymentMode", on_delete=models.PROTECT, related_name="+"
    )
    payment_day = models.PositiveSmallIntegerField(
        default=5, validators=[MinValueValidator(1), MaxValueValidator(28)]
    )

    #: Cached outstanding balance in BDT, maintained by the billing services.
    dues = models.IntegerField(default=0)

    converted_from = models.CharField(
        max_length=32, blank=True, help_text="PotentialCustomer id, if converted"
    )

    class Meta:
        db_table = "household"
        ordering = ["ward_id", "road_id", "holding"]
        indexes = [
            models.Index(fields=["ward", "status"]),
            models.Index(fields=["verified"]),
            models.Index(fields=["qr"]),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["ward", "road", "holding"], name="household_unique_address"
            )
        ]

    def __str__(self) -> str:
        return f"{self.id} — {self.head}"

    def save(self, *args, **kwargs):
        if not self.id:
            self.id = household_id()
        if not self.qr:
            self.qr = qr_tag(self.id)
        if not self.address:
            self.address = f"Holding {self.holding}, {self.road.name}"
        super().save(*args, **kwargs)

    @property
    def effective_charge(self) -> int:
        """A negotiated charge wins over the tier's standard charge."""
        return self.charge if self.charge and self.charge > 0 else self.tier.charge

    @property
    def is_routable(self) -> bool:
        """Only verified holdings can be put on a route — matches isRoutable()."""
        return bool(self.verified)

    @property
    def scan_payload(self) -> str:
        """The QR body the collector app decodes: `SWMS|<id>|<tag>`."""
        return f"SWMS|{self.id}|{self.qr}"


class PotentialCustomer(ContactProfile, LocatableHolding):
    """A surveyed holding that is not yet a paying customer ("ghost home")."""

    est_tier = models.ForeignKey(
        "catalog.Tier",
        on_delete=models.PROTECT,
        related_name="potential_customers",
        help_text="Tier this holding would fall into once signed up",
    )
    surveyed_at = models.DateField()
    surveyor = models.ForeignKey(
        "fieldops.Collector", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    reason = models.ForeignKey(
        "catalog.PotentialReason", on_delete=models.PROTECT, related_name="+"
    )
    time_gap = models.ForeignKey("catalog.TimeGap", on_delete=models.PROTECT, related_name="+")
    current_practice = models.ForeignKey(
        "catalog.CurrentPractice", on_delete=models.PROTECT, related_name="+"
    )
    notes = models.TextField(blank=True)

    converted_at = models.DateTimeField(null=True, blank=True)
    converted_to = models.OneToOneField(
        Household,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="source_survey",
    )

    class Meta:
        db_table = "potential_customer"
        ordering = ["-surveyed_at", "id"]
        indexes = [models.Index(fields=["ward"]), models.Index(fields=["converted_at"])]

    def __str__(self) -> str:
        return f"{self.id} — {self.head}"

    def save(self, *args, **kwargs):
        if not self.id:
            self.id = potential_id()
        if not self.address:
            self.address = f"Holding {self.holding}, {self.road.name}"
        super().save(*args, **kwargs)

    @property
    def estimated_monthly_value(self) -> Decimal:
        return Decimal(self.est_tier.charge)
