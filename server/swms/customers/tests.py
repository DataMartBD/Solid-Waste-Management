"""Holding Master: the rules the schema now enforces, and the API over it.

The point of the change is that one building holds many families, so these
cover the boundaries that follow from it — what may share a holding, what the
mirror is allowed to contain, and who may file a household where.
"""

from __future__ import annotations

from django.db import IntegrityError, transaction
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from swms.accounts.models import ScopeKind, User
from swms.catalog.models import (
    CustomerType,
    HoldingType,
    PaymentMode,
    Road,
    StorageType,
    SuitableTime,
    Tier,
    Ward,
    Zone,
)
from swms.common.roles import Role

from .models import Holding, Household, ServiceStatus


class HoldingData(TestCase):
    @classmethod
    def setUpTestData(cls):
        zone = Zone.objects.create(id="Z-03", name="Sonadanga")
        cls.ward = Ward.objects.create(id="W-14", name="Ward 14 — Sonadanga", zone=zone)
        cls.other_ward = Ward.objects.create(id="W-21", name="Ward 21 — Khalishpur", zone=zone)
        cls.road = Road.objects.create(ward=cls.ward, name="KDA Avenue")
        cls.other_road = Road.objects.create(ward=cls.other_ward, name="BIDC Road")

        cls.tier = Tier.objects.create(id="std", key="opt.t", label="Standard", charge=150)
        cls.customer_type = CustomerType.objects.create(id="hh", key="opt.c", label="Household")
        cls.storage = StorageType.objects.create(id="bin", key="opt.s", label="Bin")
        cls.holding_type = HoldingType.objects.create(id="pucca", key="opt.h", label="Pucca")
        cls.suitable_time = SuitableTime.objects.create(id="am", key="opt.st", label="Morning")
        cls.payment_mode = PaymentMode.objects.create(id="cash", key="opt.pm", label="Cash")

    @classmethod
    def make_holding(cls, number="142/B", *, ward=None, road=None, verified=True):
        return Holding.objects.create(
            ward=ward or cls.ward,
            road=road or cls.road,
            holding_no=number,
            holding_type=cls.holding_type,
            owner_name="Landlord Mia",
            lat=22.836 if verified else None,
            lng=89.530 if verified else None,
            verified=verified,
        )

    @classmethod
    def make_household(cls, holding, unit="", *, status="active"):
        return Household.objects.create(
            holding=holding,
            unit=unit,
            head=f"Head {unit or 'ground'}",
            status=status,
            tier=cls.tier,
            customer_type=cls.customer_type,
            storage=cls.storage,
            holding_type=cls.holding_type,
            suitable_time=cls.suitable_time,
            payment_mode=cls.payment_mode,
        )


class ConstraintTests(HoldingData):
    def test_one_holding_carries_many_households(self):
        """The whole point: a building with four flats is one holding."""
        holding = self.make_holding()
        for unit in ("1A", "1B", "2A", "2B"):
            self.make_household(holding, unit)
        self.assertEqual(holding.households.count(), 4)

    def test_the_same_flat_cannot_be_registered_twice(self):
        holding = self.make_holding()
        self.make_household(holding, "3B")
        with self.assertRaises(IntegrityError), transaction.atomic():
            self.make_household(holding, "3B")

    def test_only_one_unnumbered_household_per_holding(self):
        """Blank is a value in Postgres, not a NULL, so the constraint covers it.

        Were `unit` nullable instead, every NULL would count as distinct and a
        single-family holding could quietly accumulate duplicates.
        """
        holding = self.make_holding()
        self.make_household(holding, "")
        with self.assertRaises(IntegrityError), transaction.atomic():
            self.make_household(holding, "")

    def test_same_flat_number_in_different_buildings_is_fine(self):
        first = self.make_holding("142/B")
        second = self.make_holding("143")
        self.make_household(first, "3B")
        self.make_household(second, "3B")  # must not raise
        self.assertEqual(Household.objects.filter(unit="3B").count(), 2)

    def test_two_buildings_cannot_share_one_address(self):
        self.make_holding("142/B")
        with self.assertRaises(IntegrityError), transaction.atomic():
            self.make_holding("142/B")

    def test_a_holding_with_households_cannot_be_deleted(self):
        """PROTECT, so nobody removes a building out from under its families."""
        holding = self.make_holding()
        self.make_household(holding, "1A")
        from django.db.models import ProtectedError

        with self.assertRaises(ProtectedError):
            holding.delete()


class MirrorTests(HoldingData):
    def test_address_is_copied_down_from_the_holding(self):
        holding = self.make_holding()
        household = self.make_household(holding, "1A")
        self.assertEqual(household.ward_id, holding.ward_id)
        self.assertEqual(household.road_id, holding.road_id)
        self.assertEqual(household.holding_no, "142/B")

    def test_a_mirror_edit_does_not_survive_a_save(self):
        """One writer. Setting the copy directly is meant to be pointless."""
        holding = self.make_holding()
        household = self.make_household(holding, "1A")
        household.holding_no = "999"
        household.ward = self.other_ward
        household.save()
        household.refresh_from_db()
        self.assertEqual(household.holding_no, "142/B")
        self.assertEqual(household.ward_id, self.ward.id)

    def test_location_is_not_a_column_on_the_household(self):
        """It is read through to the building, so the two cannot disagree."""
        field_names = {f.name for f in Household._meta.get_fields()}
        for gone in ("lat", "lng", "accuracy", "verified", "verified_at", "placed_by_hand"):
            self.assertNotIn(gone, field_names, f"{gone} should live on Holding only")

    def test_location_reads_through_to_the_holding(self):
        holding = self.make_holding()
        household = self.make_household(holding, "1A")
        self.assertEqual(household.lat, holding.lat)
        self.assertEqual(household.lng, holding.lng)
        self.assertTrue(household.verified)

    def test_moving_a_household_moves_the_location_it_reports(self):
        """No stale copy to leave behind — the pin is wherever the building is."""
        first = self.make_holding("142/B")
        second = self.make_holding("143", verified=False)
        household = self.make_household(first, "1A")
        self.assertTrue(household.verified)

        household.holding = second
        household.save()
        household.refresh_from_db()

        self.assertFalse(household.verified)
        self.assertIsNone(household.lat)

    def test_verifying_the_building_makes_every_flat_routable(self):
        from .services import verify_location

        holding = self.make_holding(verified=False)
        a = self.make_household(holding, "1A")
        b = self.make_household(holding, "1B")
        self.assertFalse(a.is_routable)

        verify_location(holding, lat=22.84, lng=89.53, accuracy=8, placed_by_hand=False)

        a.refresh_from_db()
        b.refresh_from_db()
        self.assertTrue(a.is_routable)
        self.assertTrue(b.is_routable)


class ServiceStatusTests(HoldingData):
    def test_no_households_reads_as_no_service(self):
        self.assertEqual(self.make_holding().service_status, ServiceStatus.NONE)

    def test_all_active_reads_as_full(self):
        holding = self.make_holding()
        self.make_household(holding, "1A")
        self.make_household(holding, "1B")
        self.assertEqual(holding.service_status, ServiceStatus.FULL)

    def test_some_inactive_reads_as_partial(self):
        holding = self.make_holding()
        self.make_household(holding, "1A")
        self.make_household(holding, "1B", status="inactive")
        self.assertEqual(holding.service_status, ServiceStatus.PARTIAL)

    def test_all_inactive_reads_as_none(self):
        holding = self.make_holding()
        self.make_household(holding, "1A", status="inactive")
        self.assertEqual(holding.service_status, ServiceStatus.NONE)


class HoldingApiTests(HoldingData):
    def setUp(self):
        self.admin = User.objects.create_user(
            phone="01900445566", name="Admin", role=Role.AGENCY_ADMIN,
            scope_kind=ScopeKind.AGENCY,
        )
        self.client = APIClient()
        self.client.force_authenticate(self.admin)

    def test_list_reports_derived_service_status_and_counts(self):
        holding = self.make_holding()
        self.make_household(holding, "1A")
        self.make_household(holding, "1B", status="inactive")

        response = self.client.get(reverse("holding-list"))
        self.assertEqual(response.status_code, 200)
        row = (response.json().get("results") or response.json())[0]
        self.assertEqual(row["serviceStatus"], "partial")
        self.assertEqual(row["householdCount"], 2)
        self.assertEqual(row["activeHouseholdCount"], 1)

    def test_household_cannot_be_created_without_a_holding(self):
        """The rule you asked for, enforced server-side rather than in the form."""
        response = self.client.post(
            reverse("household-list"),
            {
                "head": "New Family", "tier": self.tier.id,
                "customerType": self.customer_type.id, "storage": self.storage.id,
                "holdingType": self.holding_type.id, "suitableTime": self.suitable_time.id,
                "paymentMode": self.payment_mode.id,
            },
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("holding", response.json()["fields"])

    def test_ward_scoped_user_cannot_file_into_another_ward(self):
        """PrimaryKeyRelatedField would otherwise accept any id in the table."""
        stray = self.make_holding("9", ward=self.other_ward, road=self.other_road)
        collector = User.objects.create_user(
            phone="01711000042", name="Rafiq", role=Role.COLLECTOR,
            scope_kind=ScopeKind.ZONE, scope_zone="Z-99",  # sees no ward at all
        )
        client = APIClient()
        client.force_authenticate(collector)

        response = client.post(
            reverse("household-list"),
            {
                "holding": stray.id, "head": "Sneaky", "tier": self.tier.id,
                "customerType": self.customer_type.id, "storage": self.storage.id,
                "holdingType": self.holding_type.id, "suitableTime": self.suitable_time.id,
                "paymentMode": self.payment_mode.id,
            },
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("holding", response.json()["fields"])

    def test_households_action_lists_the_families_in_a_building(self):
        holding = self.make_holding()
        self.make_household(holding, "1A")
        self.make_household(holding, "1B")

        response = self.client.get(reverse("holding-households", args=[holding.id]))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(sorted(r["unit"] for r in response.json()), ["1A", "1B"])