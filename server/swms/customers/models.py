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

from swms.common.ids import holding_id, household_id, potential_id, qr_tag
from swms.common.models import TextKeyModel


class HoldingStatus(models.TextChoices):
    ACTIVE = "active", "Active"
    INACTIVE = "inactive", "Inactive"


class ServiceStatus(models.TextChoices):
    """A holding's service standing, derived from its households — never stored.

    Computed rather than kept in a column because it is a function of the
    households hanging off the holding: a stored copy goes stale the moment one
    of them is deactivated, and nothing would tell anyone it had.
    """

    NONE = "none", "No service"
    PARTIAL = "partial", "Partly served"
    FULL = "full", "Fully served"


class Holding(TextKeyModel):
    """A rated property — the building, not the family inside it.

    One holding carries many `Household` rows: a four-storey building is one
    holding with one flat per household, each billed separately. The address and
    the GPS pin live here and nowhere else; `Household` mirrors them so the ~450
    existing `ward` lookups (including the role scoping in
    `User.visible_ward_ids`) keep working, but this table is the only writer.
    """

    # --- national geography ---------------------------------------------- #
    # Held as names rather than a foreign key into `catalog.GeoLocation`. That
    # table's grain is the union, and a building is sited by district and thana
    # — pointing at one union row would force the operator to pick a union the
    # form never asks for. The pair is validated against the table on write, so
    # a name that is not real cannot be saved.
    #
    # Both optional: every holding registered before these existed has neither,
    # and requiring them would block editing any of them.
    district = models.CharField(max_length=64, blank=True)
    thana = models.CharField(max_length=96, blank=True, help_text="Thana / upazila")

    ward = models.ForeignKey("catalog.Ward", on_delete=models.PROTECT, related_name="holdings")
    road = models.ForeignKey("catalog.Road", on_delete=models.PROTECT, related_name="holdings")
    holding_no = models.CharField(max_length=24, help_text="Holding number, e.g. 142/B")
    holding_type = models.ForeignKey(
        "catalog.HoldingType", on_delete=models.PROTECT, related_name="holdings"
    )

    # The owner of the building, who is often not the head of any household in
    # it — a landlord's tenants each have their own `Household.head`.
    owner_name = models.CharField(max_length=120)
    owner_phone = models.CharField(max_length=20, blank=True)
    owner_alt_phone = models.CharField(max_length=20, blank=True)
    owner_email = models.EmailField(blank=True)

    address = models.CharField(max_length=200, blank=True)
    floors = models.PositiveSmallIntegerField(null=True, blank=True)
    units_total = models.PositiveSmallIntegerField(
        null=True, blank=True, help_text="Flats in the building, as declared at survey"
    )

    # --- one building, one pin ------------------------------------------- #
    lat = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    lng = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    accuracy = models.PositiveSmallIntegerField(
        null=True, blank=True, help_text="GPS accuracy in metres"
    )
    verified = models.BooleanField(default=False)
    verified_at = models.DateTimeField(null=True, blank=True)
    verified_by = models.ForeignKey(
        "fieldops.Collector", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    verified_by_user = models.ForeignKey(
        "accounts.User", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    placed_by_hand = models.BooleanField(
        default=False, help_text="Pin dropped manually rather than captured from GPS"
    )

    #: Which agency services this building.
    #:
    #: This is the row that will answer "whose is it?" when agency becomes an
    #: access boundary. It is explicit rather than derived through the route
    #: chain, because that chain is null for an unrouted holding, single-valued
    #: by construction, and any supervisor can reassign a route out from under
    #: another agency — none of which a tenancy boundary can tolerate.
    #:
    #: Nullable, and it restricts nothing yet: access is still governed by ward.
    agency = models.ForeignKey(
        "agencies.Agency",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="holdings",
    )

    status = models.CharField(
        max_length=10, choices=HoldingStatus.choices, default=HoldingStatus.ACTIVE
    )
    notes = models.TextField(blank=True)

    class Meta:
        db_table = "holding"
        ordering = ["ward_id", "road_id", "holding_no"]
        indexes = [
            models.Index(fields=["ward", "status"], name="holding_ward_status_idx"),
            models.Index(fields=["verified"], name="holding_verified_idx"),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["ward", "road", "holding_no"], name="holding_unique_address"
            )
        ]

    def __str__(self) -> str:
        return f"{self.id} — {self.holding_no}"

    def save(self, *args, **kwargs):
        if not self.id:
            self.id = holding_id()
        if not self.address:
            self.address = f"Holding {self.holding_no}, {self.road.name}"
        super().save(*args, **kwargs)

    @property
    def has_location(self) -> bool:
        return self.lat is not None and self.lng is not None

    @property
    def verified_by_label(self) -> str | None:
        if self.verified_by_id:
            return self.verified_by_id
        if self.verified_by_user_id:
            return self.verified_by_user.name
        return None

    @property
    def service_status(self) -> str:
        """`none` / `partial` / `full`, from the households on this holding."""
        households = list(self.households.all())
        if not households:
            return ServiceStatus.NONE
        active = sum(1 for h in households if h.status == HoldingStatus.ACTIVE)
        if active == 0:
            return ServiceStatus.NONE
        return ServiceStatus.FULL if active == len(households) else ServiceStatus.PARTIAL


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
    """A family, and the address mirrored down from its `Holding`.

    **Location is not stored here.** A building has one position, so the pin,
    the accuracy and the whole verification trail belong to `Holding` and are
    read through to this row as properties. Storing a per-family copy invited
    the two to disagree — and a household whose pin says one thing while its
    building says another sends a collector to the wrong lane.

    `ward`, `road` and `holding_no` *are* still copies, written by
    `sync_from_holding()` and by nothing else. That duplication is deliberate:
    ~450 call sites filter on `household.ward` — among them
    `User.visible_ward_ids`, which decides what an operator is allowed to see —
    and rewriting those to traverse the FK would put a data-exposure bug one
    typo away. One writer means the copy cannot drift.
    """

    ward = models.ForeignKey("catalog.Ward", on_delete=models.PROTECT, related_name="+")
    road = models.ForeignKey("catalog.Road", on_delete=models.PROTECT, related_name="+")
    holding_no = models.CharField(max_length=24, help_text="Holding number, e.g. 142/B")
    head = models.CharField(max_length=120, help_text="Head of household / contact name")
    phone = models.CharField(max_length=20, blank=True)

    class Meta:
        abstract = True

    def sync_from_holding(self) -> None:
        """Copy the parent holding's address onto this row. Called from save()."""
        holding = self.holding
        self.ward_id = holding.ward_id
        self.road_id = holding.road_id
        self.holding_no = holding.holding_no

    # --- location, read through to the building --------------------------- #
    # Properties rather than columns: every reader below keeps working
    # unchanged, but there is only one place the value can be written.

    @property
    def lat(self):
        return self.holding.lat

    @property
    def lng(self):
        return self.holding.lng

    @property
    def accuracy(self):
        return self.holding.accuracy

    @property
    def verified(self) -> bool:
        return self.holding.verified

    @property
    def verified_at(self):
        return self.holding.verified_at

    @property
    def placed_by_hand(self) -> bool:
        return self.holding.placed_by_hand

    @property
    def verified_by_label(self) -> str | None:
        """What the UI shows in the 'verified by' column."""
        return self.holding.verified_by_label

    @property
    def has_location(self) -> bool:
        return self.holding.has_location


class Household(ContactProfile, LocatableHolding):
    """One serviced family. Many of these can share a `Holding`."""

    holding = models.ForeignKey(
        Holding, on_delete=models.PROTECT, related_name="households"
    )
    unit = models.CharField(
        max_length=24,
        blank=True,
        help_text="Flat or unit within the holding, e.g. 3B. Blank for a single-family holding.",
    )

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
        ordering = ["ward_id", "road_id", "holding_no", "unit"]
        indexes = [
            models.Index(fields=["ward", "status"]),
            models.Index(fields=["qr"]),
            models.Index(fields=["holding"], name="household_holding_idx"),
        ]
        constraints = [
            # Replaces the old unique(ward, road, holding): one holding may now
            # hold many households, told apart by their flat number. Postgres
            # treats '' as a value (unlike NULL), so this also enforces the
            # "only one unnumbered household per holding" rule for free.
            models.UniqueConstraint(
                fields=["holding", "unit"], name="household_unique_unit"
            )
        ]

    def __str__(self) -> str:
        return f"{self.id} — {self.head}"

    def save(self, *args, **kwargs):
        if not self.id:
            self.id = household_id()
        if not self.qr:
            self.qr = qr_tag(self.id)
        self.sync_from_holding()
        if not self.address:
            base = f"Holding {self.holding_no}, {self.road.name}"
            self.address = f"Flat {self.unit}, {base}" if self.unit else base
        super().save(*args, **kwargs)

    @property
    def effective_charge(self) -> int:
        """A negotiated charge wins over the tier's standard charge."""
        return self.charge if self.charge and self.charge > 0 else self.tier.charge

    @property
    def is_routable(self) -> bool:
        """Only a household on a located building can be put on a route.

        Verification is now the holding's, so every household in a building
        becomes routable the moment a surveyor pins that building once.
        """
        return bool(self.verified)

    @property
    def scan_payload(self) -> str:
        """The QR body the collector app decodes: `SWMS|<id>|<tag>`."""
        return f"SWMS|{self.id}|{self.qr}"


class PotentialCustomer(ContactProfile, LocatableHolding):
    """A surveyed family that is not yet a paying customer ("ghost home")."""

    holding = models.ForeignKey(
        Holding, on_delete=models.PROTECT, related_name="surveys"
    )
    unit = models.CharField(max_length=24, blank=True)

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
        indexes = [
            models.Index(fields=["ward"]),
            models.Index(fields=["converted_at"]),
            models.Index(fields=["holding"], name="potential_holding_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.id} — {self.head}"

    def save(self, *args, **kwargs):
        if not self.id:
            self.id = potential_id()
        self.sync_from_holding()
        if not self.address:
            base = f"Holding {self.holding_no}, {self.road.name}"
            self.address = f"Flat {self.unit}, {base}" if self.unit else base
        super().save(*args, **kwargs)

    @property
    def estimated_monthly_value(self) -> Decimal:
        return Decimal(self.est_tier.charge)
