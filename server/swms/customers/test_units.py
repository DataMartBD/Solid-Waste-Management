"""Households must equal units — the client's rule for a holding."""

from __future__ import annotations

from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from swms.accounts.models import ScopeKind, User
from swms.catalog.models import CustomerType, HoldingType, Road, StorageType, SuitableTime, Ward, Zone
from swms.common.roles import Role

from .models import Holding, Household


class UnitsRuleTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        zone = Zone.objects.create(id="Z-03", name="Sonadanga")
        cls.ward = Ward.objects.create(id="W-14", name="Ward 14", zone=zone)
        cls.road = Road.objects.create(ward=cls.ward, name="KDA Avenue")
        cls.htype = HoldingType.objects.create(id="pucca", key="opt.h", label="Pucca")
        cls.profile = {
            "customer_type": CustomerType.objects.create(id="res", key="opt.c", label="Res"),
            "storage": StorageType.objects.create(id="bin", key="opt.s", label="Bin"),
            "holding_type": cls.htype,
            "suitable_time": SuitableTime.objects.create(id="am", key="opt.st", label="AM"),
        }

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(User.objects.create_user(
            phone="01900445566", name="Admin", role=Role.SUPER_ADMIN, scope_kind=ScopeKind.CITY,
        ))

    def holding(self, units, families=0):
        holding = Holding.objects.create(
            ward=self.ward, road=self.road, holding_no=f"{units}-{families}",
            holding_type=self.htype, owner_name="Owner", units_total=units,
        )
        for index in range(families):
            Household.objects.create(holding=holding, head=f"F{index}", unit=str(index), **self.profile)
        return holding

    def body(self, **extra):
        return {
            "ward": self.ward.id, "road": self.road.name, "holdingNo": "9/A",
            "holdingType": self.htype.id, "ownerName": "Owner", **extra,
        }

    def test_the_holding_says_whether_households_equal_units(self):
        self.assertTrue(self.holding(2, 2).units_match)
        self.assertFalse(self.holding(3, 1).units_match)
        self.assertIsNone(self.holding(None, 1).units_match)

    def test_more_families_than_units_is_refused_in_the_editor(self):
        response = self.client.post(reverse("holding-list"), self.body(
            unitsTotal=1, households=[{"head": "A", "unit": "1"}, {"head": "B", "unit": "2"}],
        ), format="json")
        self.assertEqual(response.status_code, 400)
        self.assertIn("Households must equal units", str(response.json()))
        self.assertFalse(Holding.objects.exists())

    def test_fewer_families_than_units_saves_and_is_flagged(self):
        response = self.client.post(reverse("holding-list"), self.body(
            unitsTotal=3, households=[{"head": "A", "unit": "1"}],
        ), format="json")
        self.assertEqual(response.status_code, 201, response.json())
        self.assertFalse(response.json()["unitsMatch"])

    def test_lowering_units_below_the_families_is_refused(self):
        holding = self.holding(3, 3)
        response = self.client.patch(
            reverse("holding-detail", args=[holding.id]), {"unitsTotal": 2}, format="json"
        )
        self.assertEqual(response.status_code, 400)

    def test_a_retired_family_frees_its_unit(self):
        holding = self.holding(2, 2)
        family = holding.households.first()
        response = self.client.patch(reverse("holding-detail", args=[holding.id]), {
            "households": [
                {"id": family.id, "head": family.head, "unit": family.unit, "status": "inactive"},
                {"head": "Newcomer", "unit": "9"},
            ],
        }, format="json")
        self.assertEqual(response.status_code, 200, response.json())
        self.assertTrue(response.json()["unitsMatch"])

    def test_adding_a_household_to_a_full_holding_is_refused(self):
        holding = self.holding(1, 1)
        response = self.client.post(reverse("household-list"), {
            "holding": holding.id, "head": "One Too Many", "unit": "X",
            "customerType": "res", "storage": "bin", "holdingType": "pucca", "suitableTime": "am",
        }, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertIn("holding", response.json()["fields"])

    def test_the_list_filters_mismatched_holdings(self):
        full = self.holding(2, 2)
        short = self.holding(3, 1)
        ids = lambda response: {row["id"] for row in (response.json().get("results") or response.json())}
        self.assertEqual(ids(self.client.get(reverse("holding-list"), {"unitsMismatch": "true"})), {short.id})
        self.assertEqual(ids(self.client.get(reverse("holding-list"), {"unitsMismatch": "false"})), {full.id})
