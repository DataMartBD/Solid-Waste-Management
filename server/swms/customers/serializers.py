"""Household and potential-customer serializers.

The JSON keys are the React app's existing field names, so the pages keep
working: `qr`, `holding`, `head`, `altPhone`, `membersUnder5`, `estTier`,
`verifiedAt`, `placedByHand`, and so on.

Two translations happen here:

* `ward`, `tier`, `storage` and friends are foreign keys but travel as their
  string ids, which is what the UI already binds to `<select>` values.
* `road` travels as a **name** (`'KDA Avenue'`) while being stored as a foreign
  key. It is resolved against the holding's ward, so the same road name in two
  wards stays two distinct rows.
"""

from __future__ import annotations

from django.db import transaction
from rest_framework import serializers

from swms.catalog.models import (
    CurrentPractice,
    CustomerType,
    GeoLocation,
    HoldingType,
    PaymentMode,
    PotentialReason,
    Road,
    StorageType,
    SuitableTime,
    Tier,
    TimeGap,
    Ward,
)
from swms.agencies.models import Agency
from swms.common.scoping import guard_agency, guard_ward
from swms.common.serializers import SwmsModelSerializer
from swms.fieldops.models import Collector

from .models import Holding, HoldingStatus, Household, PotentialCustomer


class RoadNameField(serializers.CharField):
    """Reads/writes a road as its name; the ward decides which row that is."""

    def to_representation(self, value):
        return value.name if value else ""


class NestedHouseholdSerializer(serializers.Serializer):
    """One family, as the Holding editor writes it.

    A building and the families inside it are entered on one visit, so they are
    entered on one screen: the editor shows the holding on the left and its
    households on the right, and this is the right-hand side of that payload.
    Every field the standalone Households form has is accepted here, so the two
    screens agree on what a household is.

    `id` is what distinguishes an edit from an addition. Present, it updates
    that household — and it must already belong to this holding, or the editor
    could be used to reassign somebody else's family into this building. Absent,
    it creates one. A household is never deleted from here: bills, payments and
    visits hang off it, so retiring one is a `status` change, which is a field
    on this form like any other.

    The address is *not* here. Ward, road and holding number belong to the
    building and are copied down on save; accepting them per family would let a
    caller write a value the next save silently overwrites.
    """

    id = serializers.CharField(required=False, allow_blank=True)

    # --- who ------------------------------------------------------------- #
    head = serializers.CharField(max_length=120)
    customerType = serializers.PrimaryKeyRelatedField(
        source="customer_type", queryset=CustomerType.objects.all(), required=False
    )
    phone = serializers.CharField(max_length=20, required=False, allow_blank=True)
    altPhone = serializers.CharField(
        source="alt_phone", max_length=20, required=False, allow_blank=True
    )
    profession = serializers.CharField(max_length=80, required=False, allow_blank=True)
    email = serializers.EmailField(required=False, allow_blank=True)
    contactPerson = serializers.CharField(
        source="contact_person", max_length=120, required=False, allow_blank=True
    )
    bloodGroup = serializers.CharField(
        source="blood_group", max_length=4, required=False, allow_blank=True
    )

    # --- where in the building -------------------------------------------- #
    unit = serializers.CharField(max_length=24, required=False, allow_blank=True)
    holdingType = serializers.PrimaryKeyRelatedField(
        source="holding_type", queryset=HoldingType.objects.all(), required=False
    )
    floor = serializers.CharField(max_length=32, required=False, allow_blank=True)
    address = serializers.CharField(max_length=200, required=False, allow_blank=True)

    # --- the household ---------------------------------------------------- #
    members = serializers.IntegerField(required=False, min_value=0, max_value=99)
    membersUnder5 = serializers.IntegerField(
        source="members_under5", required=False, min_value=0, max_value=99
    )
    membersFemale = serializers.IntegerField(
        source="members_female", required=False, min_value=0, max_value=99
    )
    storage = serializers.PrimaryKeyRelatedField(
        queryset=StorageType.objects.all(), required=False
    )
    suitableTime = serializers.PrimaryKeyRelatedField(
        source="suitable_time", queryset=SuitableTime.objects.all(), required=False
    )

    # --- service and money ------------------------------------------------ #
    #: Per-flat because it sets the charge: a shop on the ground floor of a
    #: residential building is not on the residential tier.
    tier = serializers.PrimaryKeyRelatedField(queryset=Tier.objects.all())
    #: 0 means "use the tier's standard charge" rather than "free", which is why
    #: it is not simply left blank.
    charge = serializers.IntegerField(required=False, min_value=0)
    paymentMode = serializers.PrimaryKeyRelatedField(
        source="payment_mode", queryset=PaymentMode.objects.all(), required=False
    )
    paymentDay = serializers.IntegerField(
        source="payment_day", required=False, min_value=1, max_value=28
    )
    #: No default: absent means "leave this family's status alone". A default of
    #: `active` would quietly reactivate a family that had moved out, every time
    #: anything else on the building was edited.
    status = serializers.ChoiceField(choices=HoldingStatus.choices, required=False)

    def validate(self, attrs):
        total = attrs.get("members")
        if total is not None:
            for key, label in [("members_female", "female"), ("members_under5", "under-5")]:
                part = attrs.get(key)
                if part is not None and part > total:
                    raise serializers.ValidationError(
                        {key: f"More {label} members than members in total."}
                    )
        return attrs


class HoldingSerializer(SwmsModelSerializer):
    """A rated property — the building the households sit in."""

    ward = serializers.PrimaryKeyRelatedField(queryset=Ward.objects.all())
    road = RoadNameField()
    holdingNo = serializers.CharField(source="holding_no")
    holdingType = serializers.PrimaryKeyRelatedField(
        source="holding_type", queryset=HoldingType.objects.all()
    )
    ownerName = serializers.CharField(source="owner_name")
    ownerPhone = serializers.CharField(source="owner_phone", required=False, allow_blank=True)
    ownerAltPhone = serializers.CharField(
        source="owner_alt_phone", required=False, allow_blank=True
    )
    ownerEmail = serializers.EmailField(source="owner_email", required=False, allow_blank=True)
    unitsTotal = serializers.IntegerField(source="units_total", required=False, allow_null=True)

    lat = serializers.FloatField(allow_null=True, required=False)
    lng = serializers.FloatField(allow_null=True, required=False)
    verifiedAt = serializers.DateTimeField(source="verified_at", allow_null=True, required=False)

    # --- families entered alongside the building --------------------------- #
    #: Write-only. A row with an `id` updates that family, a row without one
    #: creates it, and a family left out of the list is **untouched** — the list
    #: is never read as the complete set. Treating it as complete would mean an
    #: edit that forgot to resend a flat deleted that family along with its
    #: bills, payments and visit history. Retiring a family is `status`.
    households = NestedHouseholdSerializer(many=True, required=False, write_only=True)
    #: The choices shared by every flat in the building, made once. Ignored when
    #: `households` is absent.
    householdDefaults = serializers.DictField(required=False, write_only=True)
    verifiedBy = serializers.CharField(source="verified_by_label", read_only=True)
    placedByHand = serializers.BooleanField(source="placed_by_hand", required=False)

    # Derived, never stored — a column would go stale the moment a household on
    # this holding was deactivated, with nothing to say it had.
    serviceStatus = serializers.CharField(source="service_status", read_only=True)
    householdCount = serializers.SerializerMethodField()
    activeHouseholdCount = serializers.SerializerMethodField()

    #: Which contractor services this building. Writable so an unbound creator —
    #: KCC's own staff, a super admin — can say; `perform_create` fills it from
    #: the creator when they have an agency of their own, which covers everyone
    #: else. Left unset the building is invisible to every agency-bound user,
    #: which is how five of them went missing before this was exposed.
    agency = serializers.PrimaryKeyRelatedField(
        queryset=Agency.objects.all(), required=False, allow_null=True
    )

    #: National geography. Optional — nothing registered before these fields
    #: existed has them, and an edit that does not mention them leaves them be.
    district = serializers.CharField(required=False, allow_blank=True)
    thana = serializers.CharField(required=False, allow_blank=True)

    class Meta:
        model = Holding
        fields = [
            "id",
            "agency",
            "district",
            "thana",
            "ward",
            "road",
            "holdingNo",
            "holdingType",
            "ownerName",
            "ownerPhone",
            "ownerAltPhone",
            "ownerEmail",
            "address",
            "floors",
            "unitsTotal",
            "lat",
            "lng",
            "accuracy",
            "verified",
            "verifiedAt",
            "verifiedBy",
            "placedByHand",
            "status",
            "notes",
            "serviceStatus",
            "householdCount",
            "activeHouseholdCount",
            "households",
            "householdDefaults",
        ]
        read_only_fields = ["id", "verified", "address"]

    def get_householdCount(self, obj) -> int:
        return obj.households.count()

    def get_activeHouseholdCount(self, obj) -> int:
        return sum(1 for h in obj.households.all() if h.status == "active")

    def validate_agency(self, agency):
        """Refuse an agency the caller is not part of.

        Without it a bound supervisor could file a building under a rival
        contractor — and then never see it again, because the same boundary that
        hides it from them is the one they just wrote across.
        """
        guard_agency(self, agency.id if agency else None)
        return agency

    def validate_ward(self, ward):
        """Refuse a ward the caller is not scoped to.

        Reading was already scoped, and a household could not be filed into a
        holding outside the caller's area — but nothing stopped a ward-scoped
        operator *creating the holding itself* in somebody else's ward, and then
        filing into it quite legitimately. The write-side guard closes the way
        in rather than the way out.
        """
        guard_ward(self, ward.id if ward else None)
        return ward

    def validate(self, attrs):
        attrs = super().validate(attrs)
        self._check_geography(attrs)
        self._resolve_road(attrs)
        self._check_family_ids(attrs)
        self._check_flats(attrs)
        return attrs

    def _check_geography(self, attrs):
        """The district and thana must be a real pair, or neither.

        They are stored as names rather than a foreign key, so nothing in the
        database stops a typo or a thana filed under the wrong district. This is
        that check. It runs on whatever the save will end up with — an edit that
        sends only a thana is validated against the district already on the row,
        not against nothing.
        """
        # `partial` updates only carry what changed, so fall back to the record.
        def settled(field):
            if field in attrs:
                return (attrs[field] or "").strip()
            return (getattr(self.instance, field, "") or "").strip()

        district, thana = settled("district"), settled("thana")
        if not district and not thana:
            return
        if not district:
            raise serializers.ValidationError(
                {"district": "Choose a district before a thana."}
            )

        rows = GeoLocation.objects.filter(district_name=district)
        if not rows.exists():
            raise serializers.ValidationError({"district": f"'{district}' is not a district."})
        # A district on its own is allowed: a building can be sited before
        # anybody has pinned down which thana it falls in.
        if thana and not rows.filter(upazila_name=thana).exists():
            raise serializers.ValidationError(
                {"thana": f"'{thana}' is not a thana of {district}."}
            )

        if "district" in attrs:
            attrs["district"] = district
        if "thana" in attrs:
            attrs["thana"] = thana

    def _check_flats(self, attrs):
        """Refuse a flat number used twice before anything is written.

        The database enforces one household per flat per holding, but it fails
        on whichever row reaches it second and reports a constraint rather than
        a row number. Checking here lets the form point at the offending line.
        """
        rows = attrs.get("households") or []
        if not rows:
            return

        # Flats already registered here, keyed by flat so a row editing its own
        # household is not told that it clashes with itself.
        taken = {}
        if self.instance is not None:
            for pk, unit in self.instance.households.values_list("id", "unit"):
                taken[unit.strip().casefold()] = pk

        # One entry per row, empty where the row is fine — the same shape DRF
        # itself produces for a `many=True` field, so the client has one format
        # to read rather than two.
        errors, seen = [], set()
        for row in rows:
            unit = (row.get("unit") or "").strip()
            key = unit.casefold()
            mine = (row.get("id") or "").strip()
            if key in seen:
                errors.append({"unit": f"Flat '{unit}' appears twice in this form."})
            elif key in taken and taken[key] != mine:
                errors.append(
                    {"unit": f"Flat '{unit}' is already registered at this holding."}
                )
            else:
                errors.append({})
            seen.add(key)

        if any(errors):
            raise serializers.ValidationError({"households": errors})

    def _check_family_ids(self, attrs):
        """Every `id` sent must already be a household of this building.

        Without this, the editor would be a way to move somebody else's family
        into this holding — or, on create, to send an id that means something
        elsewhere and have it silently ignored.
        """
        rows = attrs.get("households") or []
        ids = [(row.get("id") or "").strip() for row in rows]
        if not any(ids):
            return
        mine = set()
        if self.instance is not None:
            mine = set(self.instance.households.values_list("id", flat=True))
        errors = [
            {"id": f"{pk} is not a family of this building."} if pk and pk not in mine else {}
            for pk in ids
        ]
        if any(errors):
            raise serializers.ValidationError({"households": errors})

    @transaction.atomic
    def create(self, validated_data):
        rows = validated_data.pop("households", [])
        defaults = validated_data.pop("householdDefaults", {})
        holding = super().create(validated_data)
        self._save_families(holding, rows, defaults)
        return holding

    @transaction.atomic
    def update(self, instance, validated_data):
        rows = validated_data.pop("households", [])
        defaults = validated_data.pop("householdDefaults", {})
        holding = super().update(instance, validated_data)
        self._save_families(holding, rows, defaults)
        return holding

    #: What the editor may set on a family, grouped by how it is applied.
    #: Listed rather than looped over the whole payload, so a field added to the
    #: serializer later cannot reach the model without somebody deciding it may.
    _FAMILY_TEXT = [
        "head", "phone", "alt_phone", "profession", "email", "contact_person",
        "blood_group", "unit", "floor", "address",
    ]
    _FAMILY_NUMBERS = ["members", "members_under5", "members_female", "charge", "payment_day"]
    _FAMILY_LINKS = [
        "customer_type", "holding_type", "storage", "suitable_time", "tier", "payment_mode",
    ]

    def _save_families(self, holding, rows, defaults):
        """Write the families on the form: update the ones with an id, create the rest.

        One transaction with the holding. A form that half-saved would leave a
        building registered with some of its flats missing and nothing to say
        which, and the operator standing at the door has no way to tell.

        Nothing is deleted here. A family that has moved out is set inactive:
        its bills, payments and collection history hang off it, and removing the
        row from a form is far too easy an action to have that consequence.
        """
        if not rows:
            return
        shared = self._shared_choices(defaults, holding)
        existing = {h.id: h for h in holding.households.all()}

        for row in rows:
            pk = (row.get("id") or "").strip()
            household = existing.get(pk) if pk else None
            if household is None:
                # A new family starts from the building's shared choices, so a
                # form that leaves the optional pickers alone still saves.
                household = Household(holding=holding, **shared)

            # The address is the building's, always. Household mirrors it so the
            # ~450 existing ward lookups keep working, but the holding is the
            # only writer of it.
            household.ward = holding.ward
            household.road = holding.road
            household.holding_no = holding.holding_no

            for field in self._FAMILY_TEXT:
                if field in row:
                    setattr(household, field, (row.get(field) or "").strip())
            for field in self._FAMILY_NUMBERS:
                if row.get(field) is not None:
                    setattr(household, field, row[field])
            for field in self._FAMILY_LINKS:
                if row.get(field) is not None:
                    setattr(household, field, row[field])
            if row.get("status"):
                household.status = row["status"]

            household.save()

    def _shared_choices(self, defaults, holding):
        """The building-level choices, falling back to the catalog's first row.

        A household cannot be saved without a customer type, storage type,
        collection time and payment mode, and the form does not ask for them per
        flat. Where the form supplies them they are used for every flat; where it
        does not, the same default the Households page offers is used, and the
        operator can correct any of it there.
        """
        def pick(model, key):
            wanted = defaults.get(key)
            if wanted:
                row = model.objects.filter(pk=wanted).first()
                if row is None:
                    raise serializers.ValidationError(
                        {"householdDefaults": f"'{wanted}' is not a valid {key}."}
                    )
                return row
            row = model.objects.filter(active=True).order_by("sort_order", "id").first()
            if row is None:
                raise serializers.ValidationError(
                    {"householdDefaults": f"No {key} is configured to fall back on."}
                )
            return row

        day = defaults.get("paymentDay") or 5
        try:
            day = int(day)
        except (TypeError, ValueError):
            raise serializers.ValidationError(
                {"householdDefaults": f"'{day}' is not a day of the month."}
            ) from None
        if not 1 <= day <= 28:
            raise serializers.ValidationError(
                {"householdDefaults": "Payment day must be between 1 and 28."}
            )

        return {
            "customer_type": pick(CustomerType, "customerType"),
            "storage": pick(StorageType, "storage"),
            "suitable_time": pick(SuitableTime, "suitableTime"),
            "payment_mode": pick(PaymentMode, "paymentMode"),
            # The flat is in this building, so it is of this building's type.
            "holding_type": holding.holding_type,
            "payment_day": day,
        }

    def _resolve_road(self, attrs):
        """Turn the incoming road *name* into a Road row inside the right ward."""
        if "road" not in attrs:
            return
        name = (attrs.pop("road") or "").strip()
        ward = attrs.get("ward") or (self.instance.ward if self.instance else None)
        if not name:
            raise serializers.ValidationError({"road": "A road is required."})
        if ward is None:
            raise serializers.ValidationError({"ward": "A ward is required."})
        road = Road.objects.filter(ward=ward, name__iexact=name).first()
        if road is None:
            raise serializers.ValidationError(
                {"road": f"'{name}' is not a known road in {ward.short_label}."}
            )
        attrs["road"] = road


class HoldingSerializerBase(SwmsModelSerializer):
    """Fields shared by households and surveyed potential customers.

    Address and pin are **read-only** here. They belong to the parent `Holding`
    and are copied down on save, so accepting them on this endpoint would let a
    caller write a value that the next save silently overwrites. Edit the
    holding instead. `holding` is the only writable part of the address.
    """

    holding = serializers.PrimaryKeyRelatedField(queryset=Holding.objects.all())
    holdingNo = serializers.CharField(source="holding_no", read_only=True)
    ward = serializers.PrimaryKeyRelatedField(read_only=True)
    road = RoadNameField(read_only=True)

    # Location lives on the building and is read through from it. The keys are
    # kept so the map, the route planner and the collector app carry on reading
    # `lat`/`lng`/`verified` off a household exactly as before — only the place
    # the value comes from has changed.
    lat = serializers.FloatField(source="holding.lat", read_only=True)
    lng = serializers.FloatField(source="holding.lng", read_only=True)
    accuracy = serializers.IntegerField(source="holding.accuracy", read_only=True)
    verified = serializers.BooleanField(source="holding.verified", read_only=True)
    verifiedAt = serializers.DateTimeField(source="holding.verified_at", read_only=True)
    verifiedBy = serializers.CharField(source="holding.verified_by_label", read_only=True)
    placedByHand = serializers.BooleanField(source="holding.placed_by_hand", read_only=True)

    # --- contact profile --------------------------------------------------- #
    customerType = serializers.PrimaryKeyRelatedField(
        source="customer_type", queryset=CustomerType.objects.all()
    )
    altPhone = serializers.CharField(source="alt_phone", required=False, allow_blank=True)
    contactPerson = serializers.CharField(source="contact_person", required=False, allow_blank=True)
    bloodGroup = serializers.CharField(source="blood_group", required=False, allow_blank=True)
    membersUnder5 = serializers.IntegerField(source="members_under5", required=False)
    membersFemale = serializers.IntegerField(source="members_female", required=False)
    storage = serializers.PrimaryKeyRelatedField(queryset=StorageType.objects.all())
    holdingType = serializers.PrimaryKeyRelatedField(
        source="holding_type", queryset=HoldingType.objects.all()
    )
    suitableTime = serializers.PrimaryKeyRelatedField(
        source="suitable_time", queryset=SuitableTime.objects.all()
    )

    #: Subclasses list the profile keys they expose.
    PROFILE_FIELDS = [
        "customerType",
        "profession",
        "address",
        "email",
        "altPhone",
        "contactPerson",
        "bloodGroup",
        "members",
        "membersUnder5",
        "membersFemale",
        "storage",
        "holdingType",
        "floor",
        "suitableTime",
    ]
    LOCATION_FIELDS = [
        "holding",
        "holdingNo",
        "unit",
        "ward",
        "road",
        "head",
        "phone",
        "lat",
        "lng",
        "accuracy",
        "verified",
        "verifiedAt",
        "verifiedBy",
        "placedByHand",
    ]

    def validate_holding(self, holding):
        """Refuse a holding the caller is not scoped to see.

        `PrimaryKeyRelatedField` accepts any id in the table, so without this a
        ward-14 operator could post a ward-21 holding id and file a household
        into an area they have no access to — writing across the boundary that
        every read path enforces.
        """
        request = self.context.get("request")
        user = getattr(request, "user", None)
        allowed = user.visible_ward_ids() if user and user.is_authenticated else None
        if allowed is not None and holding.ward_id not in allowed:
            raise serializers.ValidationError("That holding is outside your assigned area.")
        return holding


class HouseholdSerializer(HoldingSerializerBase):
    """A holding under service."""

    tier = serializers.PrimaryKeyRelatedField(queryset=Tier.objects.all())
    paymentMode = serializers.PrimaryKeyRelatedField(
        source="payment_mode", queryset=PaymentMode.objects.all()
    )
    paymentDay = serializers.IntegerField(source="payment_day", required=False)
    # Derived, not stored: the mock's `lastVisit` column went stale because
    # recording a collection never updated it.
    lastVisit = serializers.SerializerMethodField()
    effectiveCharge = serializers.IntegerField(source="effective_charge", read_only=True)
    routable = serializers.BooleanField(source="is_routable", read_only=True)
    routeId = serializers.SerializerMethodField()

    class Meta:
        model = Household
        fields = (
            ["id", "qr", "tier", "status", "dues", "charge", "paymentMode", "paymentDay"]
            + HoldingSerializerBase.LOCATION_FIELDS
            + HoldingSerializerBase.PROFILE_FIELDS
            + ["lastVisit", "effectiveCharge", "routable", "routeId"]
        )
        read_only_fields = ["id", "dues"]
        # The generated unique-together validator reports
        # "The fields holding, unit must make a unique set." under
        # `non_field_errors`, which names columns rather than telling an
        # operator what to do. `validate()` below replaces it with a message
        # attached to the field they actually need to change.
        validators = []

    def validate(self, attrs):
        attrs = super().validate(attrs)
        holding = attrs.get("holding") or (self.instance.holding if self.instance else None)
        unit = attrs.get("unit", self.instance.unit if self.instance else "")
        if holding is None:
            return attrs

        clash = Household.objects.filter(holding=holding, unit=unit)
        if self.instance is not None:
            clash = clash.exclude(pk=self.instance.pk)
        if clash.exists():
            raise serializers.ValidationError(
                {
                    "unit": (
                        f"Flat '{unit}' is already registered at holding "
                        f"{holding.holding_no}."
                        if unit
                        else (
                            f"Holding {holding.holding_no} already has a household with no "
                            "flat number. Give this one a flat or unit."
                        )
                    )
                }
            )
        return attrs

    def get_lastVisit(self, obj):
        value = getattr(obj, "last_collected_at", None)
        return value.isoformat() if value else None

    def get_routeId(self, obj):
        """The route this family is on, which is the one its building sits on.

        The plan is holding-wise, so the stop hangs off the holding — a family
        is walked because its building is a stop.
        """
        stop = getattr(obj.holding, "route_stop", None) if obj.holding_id else None
        return stop.route_id if stop else None


class PotentialCustomerSerializer(HoldingSerializerBase):
    """A surveyed holding that is not paying yet.

    Note `estTier` rather than `tier`: the tier is an estimate until the holding
    signs up and payment terms are agreed.
    """

    estTier = serializers.PrimaryKeyRelatedField(source="est_tier", queryset=Tier.objects.all())
    surveyedAt = serializers.DateField(source="surveyed_at")
    surveyor = serializers.PrimaryKeyRelatedField(
        queryset=Collector.objects.all(), allow_null=True, required=False
    )
    reason = serializers.PrimaryKeyRelatedField(queryset=PotentialReason.objects.all())
    timeGap = serializers.PrimaryKeyRelatedField(source="time_gap", queryset=TimeGap.objects.all())
    currentPractice = serializers.PrimaryKeyRelatedField(
        source="current_practice", queryset=CurrentPractice.objects.all()
    )
    convertedTo = serializers.CharField(source="converted_to_id", read_only=True)
    estimatedValue = serializers.IntegerField(source="est_tier.charge", read_only=True)

    class Meta:
        model = PotentialCustomer
        fields = (
            ["id", "estTier", "surveyedAt", "surveyor", "reason", "timeGap", "currentPractice"]
            + HoldingSerializerBase.LOCATION_FIELDS
            + HoldingSerializerBase.PROFILE_FIELDS
            + ["notes", "convertedTo", "estimatedValue"]
        )
        read_only_fields = ["id"]


class VerifyLocationSerializer(serializers.Serializer):
    """Payload for confirming a holding's map pin on the ground."""

    lat = serializers.FloatField()
    lng = serializers.FloatField()
    accuracy = serializers.IntegerField(required=False, allow_null=True)
    placedByHand = serializers.BooleanField(default=False)

    def validate_lat(self, value):
        if not (20.0 <= value <= 27.0):
            raise serializers.ValidationError("Latitude is outside Bangladesh.")
        return value

    def validate_lng(self, value):
        if not (87.0 <= value <= 93.0):
            raise serializers.ValidationError("Longitude is outside Bangladesh.")
        return value


class ConvertSerializer(serializers.Serializer):
    """Turn a potential customer into a paying household.

    Everything is optional: unspecified terms fall back to the surveyed estimate.
    """

    tier = serializers.PrimaryKeyRelatedField(queryset=Tier.objects.all(), required=False)
    charge = serializers.IntegerField(required=False, min_value=0)
    paymentMode = serializers.PrimaryKeyRelatedField(
        queryset=PaymentMode.objects.all(), required=False
    )
    paymentDay = serializers.IntegerField(required=False, min_value=1, max_value=28)
    qr = serializers.CharField(required=False, allow_blank=True)
