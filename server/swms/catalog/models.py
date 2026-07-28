"""Reference data: geography, service tiers and the dropdown lists.

The React app hard-coded these as arrays of `{ id, key, label }`. Serving them
from the database keeps a single source of truth, and every row keeps **both**
`key` (the i18n lookup the Bangla dictionaries use) and `label` (English
fallback) because the UI needs both.

Geography is normalised into Zone → Ward → Road. The mock stored `zone` as a
bare string on the ward and `road` as free text on the household; here both are
real foreign keys, while the API still speaks the old shapes.
"""

from __future__ import annotations

from django.db import models

from swms.common.models import OptionModel


class Zone(models.Model):
    """A collection area, e.g. Z-03 'Sonadanga'. Drives the waste-by-zone chart."""

    id = models.CharField(max_length=8, primary_key=True)
    key = models.CharField(max_length=96, blank=True)
    name = models.CharField(max_length=64)
    sort_order = models.PositiveSmallIntegerField(default=0)

    class Meta:
        db_table = "zone"
        ordering = ["sort_order", "id"]

    def __str__(self) -> str:
        return f"{self.id} — {self.name}"


class Ward(models.Model):
    """A city ward, e.g. W-14 'Ward 14 — Sonadanga'."""

    id = models.CharField(max_length=8, primary_key=True)
    key = models.CharField(max_length=96, blank=True)
    name = models.CharField(max_length=96)
    zone = models.ForeignKey(Zone, on_delete=models.PROTECT, related_name="wards")
    # Centre point: seeds scatter households around it and the live map centres on it.
    lat = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    lng = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    sort_order = models.PositiveSmallIntegerField(default=0)
    active = models.BooleanField(default=True)

    class Meta:
        db_table = "ward"
        ordering = ["sort_order", "id"]

    def __str__(self) -> str:
        return self.name

    @property
    def short_label(self) -> str:
        """'Ward 14 — Sonadanga' -> 'Ward 14'."""
        return self.name.split("—")[0].strip()


class Road(models.Model):
    """A road within a ward. Households live on one."""

    id = models.BigAutoField(primary_key=True)
    ward = models.ForeignKey(Ward, on_delete=models.CASCADE, related_name="roads")
    name = models.CharField(max_length=120)
    sort_order = models.PositiveSmallIntegerField(default=0)
    active = models.BooleanField(default=True)

    class Meta:
        db_table = "road"
        ordering = ["ward_id", "sort_order", "name"]
        constraints = [
            models.UniqueConstraint(fields=["ward", "name"], name="road_unique_per_ward")
        ]

    def __str__(self) -> str:
        return f"{self.name} ({self.ward_id})"


class Tier(OptionModel):
    """Service tier and its standard monthly charge in BDT."""

    charge = models.PositiveIntegerField(help_text="Standard monthly charge, BDT")

    class Meta(OptionModel.Meta):
        db_table = "tier"
        abstract = False


# --------------------------------------------------------------------------- #
# Dropdown lists. Separate tables (rather than one table with a discriminator)
# so each reference from a household is a real, enforced foreign key.
# --------------------------------------------------------------------------- #


class CustomerType(OptionModel):
    class Meta(OptionModel.Meta):
        db_table = "customer_type"
        abstract = False


class HoldingType(OptionModel):
    class Meta(OptionModel.Meta):
        db_table = "holding_type"
        abstract = False


class StorageType(OptionModel):
    class Meta(OptionModel.Meta):
        db_table = "storage_type"
        abstract = False


class SuitableTime(OptionModel):
    class Meta(OptionModel.Meta):
        db_table = "suitable_time"
        abstract = False


class PaymentMode(OptionModel):
    class Meta(OptionModel.Meta):
        db_table = "payment_mode"
        abstract = False


class PotentialReason(OptionModel):
    """Why a surveyed holding is not yet under service."""

    class Meta(OptionModel.Meta):
        db_table = "potential_reason"
        abstract = False


class TimeGap(OptionModel):
    """How long a potential customer has been without service."""

    class Meta(OptionModel.Meta):
        db_table = "time_gap"
        abstract = False


class CurrentPractice(OptionModel):
    """How a potential customer disposes of waste today."""

    class Meta(OptionModel.Meta):
        db_table = "current_practice"
        abstract = False


#: Blood groups are a fixed list with no i18n key — kept as choices, not a table.
#: Note U+2212 MINUS SIGN, matching the seeded profile values.
BLOOD_GROUPS = ["A+", "A−", "B+", "B−", "O+", "O−", "AB+", "AB−"]
