"""The client's registration feedback: lane, 11-digit phones, President /
Secretary, no owner email or alt phone, single collection point, optional
holding type and customer defaults."""

from __future__ import annotations

from django.urls import reverse
from rest_framework.test import APIClient

from swms.accounts.models import ScopeKind, User
from swms.common.roles import Role
from swms.fieldops.tests import FieldOpsData

from .models import CollectionPoint, Holding, Household


class FeedbackData(FieldOpsData):
    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(User.objects.create_user(
            phone="01799000009", name="Admin", role=Role.SUPER_ADMIN.value,
            password="x", scope_kind=ScopeKind.CITY,
        ))

    def body(self, **extra):
        return {"ward": self.ward.id, "road": self.road.name, "holdingNo": "7/A",
                "ownerName": "Karim", **extra}

    def create(self, **extra):
        return self.client.post(reverse("holding-list"), self.body(**extra), format="json")


class HoldingFeedbackTests(FeedbackData):
    def test_lane_role_and_single_point_are_saved_without_a_holding_type(self):
        response = self.create(lane="Lane 3", ownerRole="president", ownerPhone="+8801711-222333")
        self.assertEqual(response.status_code, 201, response.data)
        holding = Holding.objects.get(pk=response.data["id"])
        self.assertEqual(holding.lane, "Lane 3")
        self.assertEqual(holding.owner_role, "president")
        self.assertEqual(holding.owner_phone, "01711222333")
        self.assertIsNone(holding.holding_type)
        self.assertEqual(holding.collection_point, CollectionPoint.SINGLE)
        self.assertEqual(holding.address, "Holding 7/A, Lane 3, KDA Avenue")

    def test_a_phone_must_be_exactly_eleven_digits(self):
        for bad in ("0171122233", "017112223334", "+8801713-30014"):
            response = self.create(ownerPhone=bad)
            self.assertEqual(response.status_code, 400, bad)
            self.assertIn("ownerPhone", response.data["fields"])

    def test_owner_email_and_alt_phone_are_gone(self):
        response = self.create(ownerEmail="a@b.com", ownerAltPhone="01711000000")
        self.assertEqual(response.status_code, 201)
        self.assertNotIn("ownerEmail", response.data)
        self.assertNotIn("ownerAltPhone", response.data)

    def test_a_single_point_holding_registers_no_customers(self):
        response = self.create(collectionPoint="single", households=[{"head": "Rahim"}])
        self.assertEqual(response.status_code, 400)
        self.assertIn("households", response.data["fields"])

    def test_floor_by_floor_registers_customers_with_defaults_and_checks_their_phone(self):
        response = self.create(collectionPoint="floor", unitsTotal=2,
                               households=[{"head": "Rahim", "unit": "1A", "phone": "01811444555"}])
        self.assertEqual(response.status_code, 201, response.data)
        family = Household.objects.get(holding_id=response.data["id"])
        self.assertEqual(family.phone, "01811444555")
        self.assertIsNotNone(family.holding_type_id)  # filled by default, not asked

        bad = self.create(holdingNo="8/A", collectionPoint="floor",
                          households=[{"head": "Rahim", "phone": "12345"}])
        self.assertEqual(bad.status_code, 400)

    def test_households_equal_units_only_applies_floor_by_floor(self):
        holding = self.make_holding("9/A")
        holding.units_total = 3
        holding.collection_point = CollectionPoint.SINGLE
        holding.save()
        self.assertIsNone(holding.units_match)
        holding.collection_point = CollectionPoint.FLOOR
        holding.save()
        self.assertFalse(holding.units_match)

    def test_the_households_endpoint_refuses_a_single_point_holding(self):
        holding = self.make_holding("10/A")
        response = self.client.post(reverse("household-list"),
                                    {"holding": holding.pk, "head": "Rahim"}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertIn("holding", response.data["fields"])

        holding.collection_point = CollectionPoint.FLOOR
        holding.save()
        response = self.client.post(reverse("household-list"),
                                    {"holding": holding.pk, "head": "Rahim"}, format="json")
        self.assertEqual(response.status_code, 201, response.data)
