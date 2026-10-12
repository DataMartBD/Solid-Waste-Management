"""Registering a building and its families in one form.

A surveyor or clerk stands at a building once and enters it once: the holding
and the flats inside it arrive in the same save. What matters here is that the
save is all-or-nothing — a form that half-succeeded would leave a building
registered with some of its flats missing and nothing to say which — and that
the list only ever adds, because treating it as the complete set would let an
edit delete a family along with its bills and visit history.
"""

from __future__ import annotations

from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from swms.accounts.models import ScopeKind, User
from swms.catalog.models import PaymentMode, StorageType, Tier
from swms.common.roles import Role

from .models import Holding, Household
from .tests import HoldingData


class CombinedEntryTests(HoldingData):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(
            phone="01700000010", name="Supervisor", role=Role.SUPERVISOR.value,
            password="x", scope_kind=ScopeKind.CITY,
        )
        self.client.force_authenticate(self.user)
        self.premium = Tier.objects.create(
            id="premium", key="opt.t2", label="Premium", charge=300
        )

    def payload(self, families=None, **overrides):
        body = {
            "ward": self.ward.id,
            "road": self.road.name,
            "holdingNo": "77/A",
            "holdingType": self.holding_type.id,
            "ownerName": "Landlord Mia",
            "ownerPhone": "01711111111",
        }
        if families is not None:
            body["households"] = families
        body.update(overrides)
        return body

    def family(self, unit, head="Head", **overrides):
        row = {"unit": unit, "head": head}
        row.update(overrides)
        return row

    def post(self, body):
        return self.client.post(reverse("holding-list"), body, format="json")

    # ------------------------------------------------------------------ #

    def test_a_building_and_its_flats_save_together(self):
        response = self.post(self.payload([
            self.family("1A", "Shirin Akter"),
            self.family("1B", "Rafiq Mia"),
            self.family("2A", "Nasima Khatun"),
        ]))
        self.assertEqual(response.status_code, 201, response.data)
        holding = Holding.objects.get(pk=response.data["id"])
        self.assertEqual(holding.households.count(), 3)
        self.assertEqual(
            sorted(holding.households.values_list("unit", flat=True)), ["1A", "1B", "2A"]
        )
        self.assertEqual(response.data["householdCount"], 3)

    def test_a_holding_with_no_families_still_saves(self):
        """The list is optional — registering the building alone is normal."""
        response = self.post(self.payload())
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(Holding.objects.get(pk=response.data["id"]).households.count(), 0)

    def test_families_inherit_the_buildings_address(self):
        """The holding is the only writer of the address; households mirror it."""
        response = self.post(self.payload([self.family("1A")]))
        household = Household.objects.get(holding_id=response.data["id"])
        self.assertEqual(household.ward_id, self.ward.id)
        self.assertEqual(household.road_id, self.road.id)
        self.assertEqual(household.holding_no, "77/A")

    def test_the_service_charge_is_the_buildings(self):
        """One tier and one charge for the holding, however many flats it has."""
        response = self.post(self.payload(
            [self.family("Shop"), self.family("1A")], tier=self.premium.id,
        ))
        holding = Holding.objects.get(pk=response.data["id"])
        self.assertEqual(holding.tier_id, "premium")
        self.assertEqual(response.data["effectiveCharge"], self.premium.charge)

    def test_the_charge_is_left_to_the_tier(self):
        """0 means 'use the tier's standard charge' — not 'free'."""
        response = self.post(self.payload([self.family("1A")], tier=self.tier.id))
        holding = Holding.objects.get(pk=response.data["id"])
        self.assertEqual(holding.charge, 0)
        self.assertEqual(holding.effective_charge, self.tier.charge)

    def test_an_agreed_charge_overrides_the_tier(self):
        response = self.post(self.payload(
            [self.family("1A")], tier=self.tier.id, charge=420, paymentDay=12,
        ))
        holding = Holding.objects.get(pk=response.data["id"])
        self.assertEqual((holding.effective_charge, holding.payment_day), (420, 12))

    def test_a_family_carries_no_charge(self):
        """Sending charge terms on a flat changes nothing: they are not its to hold."""
        self.post(self.payload([self.family("1A", tier=self.premium.id, charge=999)]))
        household = Household.objects.get(unit="1A")
        self.assertFalse(hasattr(household, "charge"))
        self.assertFalse(hasattr(household, "tier_id"))

    def test_the_flats_take_the_buildings_type(self):
        response = self.post(self.payload([self.family("1A")]))
        household = Household.objects.get(holding_id=response.data["id"])
        self.assertEqual(household.holding_type_id, self.holding_type.id)

    # ---- shared choices ---------------------------------------------- #

    def test_shared_choices_apply_to_every_flat(self):
        sack = StorageType.objects.create(id="sack", key="opt.s2", label="Sack")
        self.post(self.payload(
            [self.family("1A"), self.family("1B")],
            householdDefaults={"storage": sack.id},
        ))
        for household in Household.objects.all():
            self.assertEqual(household.storage_id, "sack")

    def test_choices_fall_back_to_the_catalog_when_not_given(self):
        """The form need not ask for all of them; the flats are still valid."""
        self.post(self.payload([self.family("1A")]))
        household = Household.objects.get(unit="1A")
        self.assertEqual(household.customer_type_id, self.customer_type.id)
        self.assertEqual(household.storage_id, self.storage.id)
        self.assertEqual(household.suitable_time_id, self.suitable_time.id)

    def test_an_unknown_shared_choice_is_refused(self):
        response = self.post(self.payload(
            [self.family("1A")], householdDefaults={"storage": "nonsense"}))
        self.assertEqual(response.status_code, 400)
        self.assertIn("nonsense", str(response.data))
        self.assertFalse(Holding.objects.exists())

    def test_a_bad_payment_day_is_refused(self):
        response = self.post(self.payload([self.family("1A")], paymentDay=31))
        self.assertEqual(response.status_code, 400)
        self.assertIn("paymentDay", response.data["fields"])
        self.assertFalse(Holding.objects.exists())

    # ---- the save is all or nothing ---------------------------------- #

    def test_a_duplicate_flat_in_the_form_is_refused_by_row(self):
        response = self.post(self.payload([
            self.family("1A", "First"),
            self.family("1B", "Second"),
            self.family("1A", "Third"),
        ]))
        self.assertEqual(response.status_code, 400)
        # One entry per row, empty where the row is fine, so the form can mark
        # the third line rather than showing one message above three
        # identical-looking rows. Same shape DRF gives any `many=True` field.
        rows = response.data["fields"]["households"]
        self.assertEqual(len(rows), 3)
        self.assertEqual(rows[0], {})
        self.assertEqual(rows[1], {})
        self.assertIn("appears twice", str(rows[2]))

    def test_nothing_is_written_when_one_row_fails(self):
        response = self.post(self.payload([
            self.family("1A"),
            self.family("1B", storage="no-such-storage"),
        ]))
        self.assertEqual(response.status_code, 400)
        self.assertFalse(Holding.objects.exists())
        self.assertFalse(Household.objects.exists())

    def test_a_family_with_no_head_is_refused(self):
        response = self.post(self.payload([{"unit": "1A"}]))
        self.assertEqual(response.status_code, 400)
        self.assertFalse(Holding.objects.exists())

    def test_more_women_than_people_is_refused(self):
        response = self.post(self.payload([
            self.family("1A", members=3, membersFemale=5),
        ]))
        self.assertEqual(response.status_code, 400)
        self.assertFalse(Holding.objects.exists())

    def test_a_bad_building_does_not_create_orphan_families(self):
        response = self.post(self.payload(
            [self.family("1A")], road="Nowhere Lane"))
        self.assertEqual(response.status_code, 400)
        self.assertFalse(Household.objects.exists())

    # ---- appending to a building already registered ------------------ #

    def test_families_can_be_appended_on_edit(self):
        created = self.post(self.payload([self.family("1A")])).data["id"]
        response = self.client.patch(
            reverse("holding-detail", args=[created]),
            {"households": [self.family("1B"), self.family("1C")]},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(
            sorted(Household.objects.values_list("unit", flat=True)), ["1A", "1B", "1C"]
        )

    def test_an_edit_never_removes_a_family(self):
        """The list adds; it is not the complete set.

        If it replaced, an edit that resent only one flat would delete the other
        family's record.
        """
        created = self.post(self.payload([
            self.family("1A"), self.family("1B"),
        ])).data["id"]
        self.client.patch(
            reverse("holding-detail", args=[created]),
            {"ownerName": "New Owner"}, format="json",
        )
        self.assertEqual(Household.objects.count(), 2)

    def test_appending_a_flat_that_exists_is_refused(self):
        created = self.post(self.payload([self.family("1A")])).data["id"]
        response = self.client.patch(
            reverse("holding-detail", args=[created]),
            {"households": [self.family("1A")]}, format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("already registered", str(response.data))
        self.assertIn("1A", str(response.data["fields"]["households"][0]["unit"]))
        self.assertEqual(Household.objects.count(), 1)

    # ---- scoping ------------------------------------------------------ #

    def test_a_scoped_user_cannot_register_outside_their_ward(self):
        scoped = User.objects.create_user(
            phone="01700000011", name="Ward staff", role=Role.SUPERVISOR.value,
            password="x", scope_kind=ScopeKind.WARD,
        )
        scoped.scope_wards.set([self.ward])
        self.client.force_authenticate(scoped)
        response = self.post(self.payload(
            [self.family("1A")], ward=self.other_ward.id, road=self.other_road.name))
        self.assertEqual(response.status_code, 400)
        self.assertFalse(Household.objects.exists())

    def test_a_read_only_role_cannot_use_the_combined_form(self):
        viewer = User.objects.create_user(
            phone="01700000012", name="Viewer", role=Role.KCC_VIEWER.value,
            password="x", scope_kind=ScopeKind.CITY,
        )
        self.client.force_authenticate(viewer)
        response = self.post(self.payload([self.family("1A")]))
        self.assertEqual(response.status_code, 403)
        self.assertFalse(Holding.objects.exists())

    # ---- the household list keeps working ----------------------------- #

    def test_the_families_appear_on_the_holding(self):
        created = self.post(self.payload([
            self.family("1A"), self.family("1B"),
        ])).data["id"]
        response = self.client.get(reverse("holding-households", args=[created]))
        self.assertEqual(response.status_code, 200)
        rows = response.data if isinstance(response.data, list) else response.data["results"]
        self.assertCountEqual([r["unit"] for r in rows], ["1A", "1B"])

    def test_a_created_family_is_a_normal_household(self):
        """Nothing about the combined form makes a second-class record."""
        self.post(self.payload([self.family("1A", "Shirin Akter", phone="01799999999")]))
        household = Household.objects.get(unit="1A")
        self.assertTrue(household.id.startswith("HH-KCC-"))
        # The QR tag is the building's, not the family's.
        self.assertTrue(household.holding.qr)
        self.assertEqual(household.head, "Shirin Akter")
        self.assertEqual(household.phone, "01799999999")
        self.assertEqual(household.status, "active")
