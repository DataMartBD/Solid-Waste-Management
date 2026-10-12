"""Reference data: geography, service tiers and the dropdown lists.

The React app hard-coded these as arrays of `{ id, key, label }`. Serving them
from the database keeps a single source of truth, and every row keeps **both**
`key` (the i18n lookup the Bangla dictionaries use) and `label` (English
fallback) because the UI needs both.

Geography is normalised into City → Zone → Ward → Road, the same administrative
area Clean Care puts on a citizen's profile (City Corporation, Zone, Ward,
Address). The mock stored `zone` as a bare string on the ward and `road` as free
text on the household; here both are real foreign keys, while the API still
speaks the old shapes.
"""

from __future__ import annotations

import datetime as dt

from django.db import models

from swms.common.models import OptionModel


class CityType(OptionModel):
    """What kind of local government a city is — City Corporation, Pourashova…

    A setup list rather than fixed choices, so a new kind can be added from
    admin without a release.
    """

    class Meta(OptionModel.Meta):
        db_table = "city_type"
        abstract = False


class AgencyType(OptionModel):
    """How an agency is constituted: private company, NGO, the city's own
    in-house service (City Corporation, Pourashova)… Maintained in setup."""

    class Meta(OptionModel.Meta):
        db_table = "agency_type"
        abstract = False


class City(models.Model):
    """A city corporation or pourashova — the top of the service geography.

    Everything below it (zones, wards, roads) and every contractor working
    there hangs off one of these, so a second city is a new row rather than a
    second deployment.

    It also owns the city's collection day. Agencies may confirm visits by QR,
    app or web, but at `collection_cutoff` every household nobody complained
    about counts as collected. A complaint arriving by `complaint_deadline` the
    next morning still turns that day into "not collected".
    """

    id = models.CharField(max_length=8, primary_key=True, help_text="Short code, e.g. 'KCC'")
    name = models.CharField(max_length=120)
    name_bn = models.CharField(max_length=120, blank=True)
    city_type = models.ForeignKey(
        CityType, null=True, blank=True, on_delete=models.PROTECT, related_name="cities"
    )
    #: National district, as `GeoLocation.district_name` spells it.
    district = models.CharField(max_length=64, blank=True)
    lat = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    lng = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)

    collection_cutoff = models.TimeField(
        default=dt.time(21, 0),
        help_text="After this time, uncomplained households count as collected",
    )
    complaint_deadline = models.TimeField(
        default=dt.time(12, 0),
        help_text="Next-day time until which a complaint can still mark a day not collected",
    )

    sort_order = models.PositiveSmallIntegerField(default=0)
    active = models.BooleanField(default=True)

    class Meta:
        db_table = "city"
        ordering = ["sort_order", "id"]
        verbose_name_plural = "cities"

    def __str__(self) -> str:
        return self.name


class Zone(models.Model):
    """A collection area, e.g. Z-03 'Sonadanga'. Drives the waste-by-zone chart."""

    id = models.CharField(max_length=8, primary_key=True)
    #: Nullable only so rows can exist before a city is assigned; migration
    #: 0004 puts every existing zone under KCC.
    city = models.ForeignKey(
        City, null=True, blank=True, on_delete=models.PROTECT, related_name="zones"
    )
    key = models.CharField(max_length=96, blank=True)
    name = models.CharField(max_length=64)
    #: Shown when the app is in Bangla; empty falls back to `name`.
    name_bn = models.CharField(max_length=64, blank=True, db_default="")
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
    #: Shown in Bangla mode for a ward with no dictionary entry — every ward of a
    #: city added from the Setup page. KCC's wards are translated in the app.
    name_bn = models.CharField(max_length=96, blank=True, db_default="")
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
    def city_id(self) -> str | None:
        return self.zone.city_id

    @property
    def short_label(self) -> str:
        """'Ward 14 — Sonadanga' -> 'Ward 14'."""
        return self.name.split("—")[0].strip()


class Block(models.Model):
    """A named division of a ward — 'Block-A', 'Block-B'.

    A ward is too coarse for door-to-door work: surveyors are given a block and
    walk it. It sits beside `Road` rather than above or below it, because the
    two are different ways of cutting the same ward and a road can run through
    more than one block.

    Optional everywhere. Wards that are not divided into blocks simply have
    none, and nothing requires one.
    """

    id = models.CharField(max_length=16, primary_key=True, help_text="e.g. W-22-A")
    ward = models.ForeignKey(Ward, on_delete=models.CASCADE, related_name="blocks")
    name = models.CharField(max_length=60, help_text="e.g. Block-A")
    sort_order = models.PositiveSmallIntegerField(default=0)
    active = models.BooleanField(default=True)

    class Meta:
        db_table = "block"
        ordering = ["ward_id", "sort_order", "name"]
        constraints = [
            models.UniqueConstraint(fields=["ward", "name"], name="block_unique_per_ward")
        ]

    def __str__(self) -> str:
        return f"{self.name} ({self.ward_id})"


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


class DumpingPointKind(models.TextChoices):
    DUMPING_AREA = "dumping_area", "Dumping area"
    DISPOSAL_SITE = "disposal_site", "Disposal site"
    TRANSFER_STATION = "transfer_station", "Transfer station"


class DumpingPoint(models.Model):
    """Where collected waste is taken: a dumping area, disposal site or transfer station.

    Each one belongs to a city and serves one or more of its wards — the
    client's "different dumping / disposal points" per ward. A van can be told
    which one it unloads at.
    """

    id = models.BigAutoField(primary_key=True)
    name = models.CharField(max_length=120)
    name_bn = models.CharField(max_length=120, blank=True, db_default="")
    kind = models.CharField(
        max_length=20, choices=DumpingPointKind.choices, default=DumpingPointKind.DUMPING_AREA
    )
    city = models.ForeignKey(City, on_delete=models.PROTECT, related_name="dumping_points")
    #: The wards whose waste goes here.
    wards = models.ManyToManyField(Ward, blank=True, related_name="dumping_points")
    lat = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    lng = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    capacity_tonnes = models.DecimalField(
        max_digits=8, decimal_places=2, null=True, blank=True, help_text="Daily capacity"
    )
    notes = models.TextField(blank=True)
    active = models.BooleanField(default=True)

    class Meta:
        db_table = "dumping_point"
        ordering = ["city_id", "name"]
        constraints = [
            models.UniqueConstraint(fields=["city", "name"], name="dumping_point_unique_per_city")
        ]

    def __str__(self) -> str:
        return self.name


class GeoLocation(models.Model):
    """The national administrative table: division → district → upazila → union.

    Separate from `Zone`/`Ward`/`Road` on purpose. Those are Khulna City
    Corporation's own service geography — the units routes and collectors are
    organised by. This is Bangladesh's, and it is the same 4,537 rows for every
    deployment. Holding an upazila here does not make it a ward, and no route
    will ever be planned from it.

    Deliberately flat, one row per union, exactly as the source file lists them.
    Normalising it into four tables would buy referential tidiness for data that
    is loaded whole, never edited, and only ever read as "the districts" or "the
    upazilas of this district" — both of which are one indexed query here.

    Every name is carried in English and Bangla because the form is used in both.
    """

    id = models.BigAutoField(primary_key=True)
    division_name = models.CharField(max_length=64)
    division_bn = models.CharField(max_length=64)
    district_name = models.CharField(max_length=64)
    district_bn = models.CharField(max_length=64)
    #: Thana and upazila are the same unit under two names — the form asks for
    #: "thana / upazila" and this is the column behind it.
    upazila_name = models.CharField(max_length=96)
    upazila_bn = models.CharField(max_length=96)
    union_name = models.CharField(max_length=96)
    union_bn = models.CharField(max_length=96)

    class Meta:
        db_table = "geo_location"
        ordering = ["division_name", "district_name", "upazila_name", "union_name"]
        indexes = [
            # The two reads the holding form makes: the district list, and the
            # upazilas of the district just chosen.
            models.Index(fields=["district_name"], name="geo_district_idx"),
            models.Index(fields=["district_name", "upazila_name"], name="geo_upazila_idx"),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["division_name", "district_name", "upazila_name", "union_name"],
                name="geo_location_unique_union",
            )
        ]

    def __str__(self) -> str:
        return f"{self.union_name}, {self.upazila_name}, {self.district_name}"


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
