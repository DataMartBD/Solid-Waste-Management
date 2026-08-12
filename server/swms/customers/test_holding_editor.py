"""The two-column holding editor: a building and its families on one screen.

The editor shows the holding on the left and its households on the right, with
the same fields the standalone Households form has. What is worth testing is
what only exists because the two are saved together — updating a family in
place, and the guards that stop the nested list reaching a household which is
not part of this building.
"""

from __future__ import annotations

from django.urls import reverse
from rest_framework.test import APIClient

from swms.accounts.models import ScopeKind, User
from swms.catalog.models import Road, Tier
from swms.common.roles import Role

from .models import Holding, Household
from .tests import HoldingData


class FullFieldEditorTests(HoldingData):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(
            phone="01700000020", name="Supervisor", role=Role.SUPERVISOR.value,
            password="x", scope_kind=ScopeKind.CITY,
        )
        self.client.force_authenticate(self.user)
        self.premium = Tier.objects.create(
            id="premium", key="opt.t9", label="Premium", charge=500
        )

    def create_holding(self, families=None, number="55/A"):
        body = {
            "ward": self.ward.id, "road": self.road.name, "holdingNo": number,
            "holdingType": self.holding_type.id, "ownerName": "Landlord Mia",
        }
        if families is not None:
            body["households"] = families
        response = self.client.post(reverse("holding-list"), body, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        return response.data["id"]

    def patch(self, holding_id, body):
        return self.client.patch(
            reverse("holding-detail", args=[holding_id]), body, format="json"
        )

    def full_family(self, **overrides):
        row = {
            "head": "Shirin Akter",
            "customerType": self.customer_type.id,
            "phone": "01712345678",
            "altPhone": "01822222222",
            "profession": "Teacher",
            "email": "shirin@example.com",
            "contactPerson": "Karim",
            "bloodGroup": "B+",
            "unit": "1A",
            "holdingType": self.holding_type.id,
            "floor": "1st",
            "address": "Flat 1A, Holding 55/A",
            "members": 5,
            "membersUnder5": 1,
            "membersFemale": 3,
            "storage": self.storage.id,
            "suitableTime": self.suitable_time.id,
            "tier": self.tier.id,
            "charge": 175,
            "paymentMode": self.payment_mode.id,
            "paymentDay": 10,
            "status": "active",
        }
        row.update(overrides)
        return row

    # ---- creating with the full field set ------------------------------- #

    def test_every_field_on_the_form_reaches_the_household(self):
        self.create_holding([self.full_family()])
        h = Household.objects.get(unit="1A")
        self.assertEqual(h.head, "Shirin Akter")
        self.assertEqual(h.phone, "01712345678")
        self.assertEqual(h.alt_phone, "01822222222")
        self.assertEqual(h.profession, "Teacher")
        self.assertEqual(h.email, "shirin@example.com")
        self.assertEqual(h.contact_person, "Karim")
        self.assertEqual(h.blood_group, "B+")
        self.assertEqual(h.floor, "1st")
        self.assertEqual(h.members, 5)
        self.assertEqual(h.members_under5, 1)
        self.assertEqual(h.members_female, 3)
        self.assertEqual(h.charge, 175)
        self.assertEqual(h.payment_day, 10)
        self.assertEqual(h.tier_id, self.tier.id)
        self.assertEqual(h.storage_id, self.storage.id)
        self.assertEqual(h.suitable_time_id, self.suitable_time.id)
        self.assertEqual(h.payment_mode_id, self.payment_mode.id)
        self.assertEqual(h.customer_type_id, self.customer_type.id)

    def test_an_explicit_charge_overrides_the_tier(self):
        self.create_holding([self.full_family(charge=175)])
        self.assertEqual(Household.objects.get(unit="1A").effective_charge, 175)

    def test_a_family_can_be_created_inactive(self):
        self.create_holding([self.full_family(status="inactive")])
        self.assertEqual(Household.objects.get(unit="1A").status, "inactive")

    # ---- editing an existing family ------------------------------------- #

    def test_a_family_is_updated_in_place_when_it_carries_its_id(self):
        holding = self.create_holding([self.full_family()])
        existing = Household.objects.get(unit="1A")
        response = self.patch(holding, {"households": [
            {"id": existing.id, "head": "Shirin Akter Khatun", "unit": "1A",
             "tier": self.premium.id, "phone": "01799999999"},
        ]})
        self.assertEqual(response.status_code, 200, response.data)
        existing.refresh_from_db()
        self.assertEqual(existing.head, "Shirin Akter Khatun")
        self.assertEqual(existing.tier_id, "premium")
        self.assertEqual(existing.phone, "01799999999")
        self.assertEqual(Household.objects.count(), 1)

    def test_an_edit_leaves_untouched_fields_alone(self):
        """The editor may send only what changed; the rest must survive."""
        holding = self.create_holding([self.full_family()])
        existing = Household.objects.get(unit="1A")
        self.patch(holding, {"households": [
            {"id": existing.id, "head": "Renamed", "unit": "1A", "tier": self.tier.id},
        ]})
        existing.refresh_from_db()
        self.assertEqual(existing.profession, "Teacher")
        self.assertEqual(existing.blood_group, "B+")
        self.assertEqual(existing.members, 5)

    def test_status_is_left_alone_when_not_sent(self):
        """Otherwise every edit would quietly reactivate a family that moved out."""
        holding = self.create_holding([self.full_family(status="inactive")])
        existing = Household.objects.get(unit="1A")
        self.patch(holding, {"households": [
            {"id": existing.id, "head": "Still Gone", "unit": "1A", "tier": self.tier.id},
        ]})
        existing.refresh_from_db()
        self.assertEqual(existing.status, "inactive")

    def test_a_family_is_retired_by_status_not_by_removal(self):
        holding = self.create_holding([self.full_family()])
        existing = Household.objects.get(unit="1A")
        self.patch(holding, {"households": [
            {"id": existing.id, "head": existing.head, "unit": "1A",
             "tier": self.tier.id, "status": "inactive"},
        ]})
        existing.refresh_from_db()
        self.assertEqual(existing.status, "inactive")
        # Retired, not removed: its bills and visits are still attached.
        self.assertTrue(Household.objects.filter(pk=existing.pk).exists())

    def test_editing_and_adding_in_the_same_save(self):
        holding = self.create_holding([self.full_family()])
        existing = Household.objects.get(unit="1A")
        response = self.patch(holding, {"households": [
            {"id": existing.id, "head": "Edited", "unit": "1A", "tier": self.tier.id},
            {"head": "Brand New", "unit": "2B", "tier": self.tier.id},
        ]})
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(Household.objects.count(), 2)
        existing.refresh_from_db()
        self.assertEqual(existing.head, "Edited")
        self.assertEqual(Household.objects.get(unit="2B").head, "Brand New")

    def test_a_family_keeps_its_own_flat_number_on_edit(self):
        """Editing a family must not read its own flat as a clash with itself."""
        holding = self.create_holding([self.full_family()])
        existing = Household.objects.get(unit="1A")
        response = self.patch(holding, {"households": [
            {"id": existing.id, "head": "Same Flat", "unit": "1A", "tier": self.tier.id},
        ]})
        self.assertEqual(response.status_code, 200, response.data)

    def test_a_family_left_out_of_the_list_is_untouched(self):
        holding = self.create_holding([
            self.full_family(),
            self.full_family(unit="2B", head="Second Family"),
        ])
        self.patch(holding, {"ownerName": "New Owner"})
        self.assertEqual(Household.objects.count(), 2)
        self.assertEqual(Household.objects.get(unit="2B").head, "Second Family")

    # ---- guards ---------------------------------------------------------- #

    def test_a_family_from_another_building_is_refused(self):
        """Otherwise the editor would move somebody else's family in here."""
        first = self.create_holding([self.full_family()], number="55/A")
        other = self.create_holding(number="66/B")
        theirs = Household.objects.get(holding_id=first)
        response = self.patch(other, {"households": [
            {"id": theirs.id, "head": "Stolen", "unit": "9Z", "tier": self.tier.id},
        ]})
        self.assertEqual(response.status_code, 400)
        self.assertIn("not a family of this building", str(response.data))
        theirs.refresh_from_db()
        self.assertEqual(theirs.holding_id, first)

    def test_an_unknown_family_id_is_refused(self):
        holding = self.create_holding([self.full_family()])
        response = self.patch(holding, {"households": [
            {"id": "HH-KCC-9999999", "head": "Ghost", "unit": "3C", "tier": self.tier.id},
        ]})
        self.assertEqual(response.status_code, 400)
        self.assertIn("not a family of this building", str(response.data))

    def test_an_id_sent_on_create_is_refused(self):
        """There is no holding yet, so no id can belong to it."""
        response = self.client.post(reverse("holding-list"), {
            "ward": self.ward.id, "road": self.road.name, "holdingNo": "70/Q",
            "holdingType": self.holding_type.id, "ownerName": "Owner",
            "households": [{"id": "HH-KCC-0000001", "head": "X", "tier": self.tier.id}],
        }, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertFalse(Holding.objects.filter(holding_no="70/Q").exists())

    def test_the_address_still_belongs_to_the_building(self):
        """A family may carry a display address, but never its own ward or road."""
        self.create_holding([self.full_family()])
        household = Household.objects.get(unit="1A")
        self.assertEqual(household.ward_id, self.ward.id)
        self.assertEqual(household.road_id, self.road.id)
        self.assertEqual(household.holding_no, "55/A")

    def test_a_resent_family_picks_up_the_buildings_new_address(self):
        """The holding is the only writer of the address, so a move flows down."""
        holding = self.create_holding([self.full_family()])
        existing = Household.objects.get(unit="1A")
        moved = Road.objects.create(ward=self.ward, name="Majid Sarani")
        self.patch(holding, {
            "road": moved.name, "holdingNo": "55/B",
            "households": [{"id": existing.id, "head": existing.head,
                            "unit": "1A", "tier": self.tier.id}],
        })
        existing.refresh_from_db()
        self.assertEqual(existing.road_id, moved.id)
        self.assertEqual(existing.holding_no, "55/B")
