"""District and thana on a holding.

These are stored as names, not a foreign key: `catalog.GeoLocation` is one row
per union, and a building is sited by district and thana — pointing at a union
row would force the operator to pick a union the form never asks for. Nothing in
the database therefore stops a typo or a thana filed under the wrong district,
so the serializer is the only thing that does, and it is what these cover.
"""

from __future__ import annotations

from django.urls import reverse
from rest_framework.test import APIClient

from swms.accounts.models import ScopeKind, User
from swms.catalog.models import GeoLocation
from swms.common.roles import Role

from .models import Holding
from .tests import HoldingData


class HoldingGeographyTests(HoldingData):
    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()
        for upazila, union in [("Dumuria", "Magurghona"), ("Batiaghata", "Jalma")]:
            GeoLocation.objects.create(
                division_name="Khulna", division_bn="খুলনা",
                district_name="Khulna", district_bn="খুলনা",
                upazila_name=upazila, upazila_bn=upazila,
                union_name=union, union_bn=union,
            )
        GeoLocation.objects.create(
            division_name="Khulna", division_bn="খুলনা",
            district_name="Bagerhat", district_bn="বাগেরহাট",
            upazila_name="Fakirhat", upazila_bn="ফকিরহাট",
            union_name="Betaga", union_bn="বেতাগা",
        )

    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(
            phone="01700000031", name="Supervisor", role=Role.SUPERVISOR.value,
            password="x", scope_kind=ScopeKind.CITY,
        )
        self.client.force_authenticate(self.user)

    def post(self, **extra):
        body = {
            "ward": self.ward.id, "road": self.road.name, "holdingNo": "77/C",
            "holdingType": self.holding_type.id, "ownerName": "Landlord Mia",
        }
        body.update(extra)
        return self.client.post(reverse("holding-list"), body, format="json")

    # --- the happy path ---------------------------------------------------- #

    def test_a_real_pair_is_stored(self):
        response = self.post(district="Khulna", thana="Dumuria")
        self.assertEqual(response.status_code, 201, response.data)
        holding = Holding.objects.get(pk=response.data["id"])
        self.assertEqual((holding.district, holding.thana), ("Khulna", "Dumuria"))

    def test_both_come_back_on_read(self):
        holding_id = self.post(district="Khulna", thana="Dumuria").data["id"]
        response = self.client.get(reverse("holding-detail", args=[holding_id]))
        self.assertEqual(response.data["district"], "Khulna")
        self.assertEqual(response.data["thana"], "Dumuria")

    def test_a_district_alone_is_allowed(self):
        """A building can be sited before anyone pins down its thana."""
        response = self.post(district="Khulna")
        self.assertEqual(response.status_code, 201, response.data)

    def test_neither_is_allowed(self):
        """Every holding registered before these fields existed has neither."""
        response = self.post()
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(Holding.objects.get(pk=response.data["id"]).district, "")

    def test_surrounding_space_is_trimmed(self):
        response = self.post(district="  Khulna  ", thana=" Dumuria ")
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(Holding.objects.get(pk=response.data["id"]).thana, "Dumuria")

    # --- what it refuses --------------------------------------------------- #

    def test_a_district_that_does_not_exist_is_refused(self):
        response = self.post(district="Atlantis")
        self.assertEqual(response.status_code, 400)
        self.assertIn("district", response.data["fields"])

    def test_a_thana_of_another_district_is_refused(self):
        """Fakirhat is real, but it is in Bagerhat, not Khulna."""
        response = self.post(district="Khulna", thana="Fakirhat")
        self.assertEqual(response.status_code, 400)
        self.assertIn("thana", response.data["fields"])

    def test_a_thana_without_a_district_is_refused(self):
        response = self.post(thana="Dumuria")
        self.assertEqual(response.status_code, 400)
        self.assertIn("district", response.data["fields"])

    # --- editing ----------------------------------------------------------- #

    def test_an_edit_may_send_only_the_thana(self):
        """A partial update is validated against the district already stored."""
        holding_id = self.post(district="Khulna", thana="Dumuria").data["id"]
        response = self.client.patch(
            reverse("holding-detail", args=[holding_id]),
            {"thana": "Batiaghata"}, format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(Holding.objects.get(pk=holding_id).thana, "Batiaghata")

    def test_a_partial_edit_is_checked_against_the_stored_district(self):
        holding_id = self.post(district="Khulna", thana="Dumuria").data["id"]
        response = self.client.patch(
            reverse("holding-detail", args=[holding_id]),
            {"thana": "Fakirhat"}, format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("Khulna", str(response.data["fields"]["thana"]))

    def test_an_edit_that_mentions_neither_leaves_them_alone(self):
        holding_id = self.post(district="Khulna", thana="Dumuria").data["id"]
        response = self.client.patch(
            reverse("holding-detail", args=[holding_id]),
            {"ownerName": "Someone Else"}, format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        holding = Holding.objects.get(pk=holding_id)
        self.assertEqual((holding.district, holding.thana), ("Khulna", "Dumuria"))

    def test_both_can_be_cleared(self):
        holding_id = self.post(district="Khulna", thana="Dumuria").data["id"]
        response = self.client.patch(
            reverse("holding-detail", args=[holding_id]),
            {"district": "", "thana": ""}, format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        holding = Holding.objects.get(pk=holding_id)
        self.assertEqual((holding.district, holding.thana), ("", ""))

    # --- finding one again ------------------------------------------------- #

    def test_a_holding_can_be_searched_by_district(self):
        """The register shows the column, so `?search=` has to reach it."""
        holding_id = self.post(district="Khulna", thana="Dumuria").data["id"]
        response = self.client.get(reverse("holding-list"), {"search": "Khulna"})
        self.assertIn(holding_id, [row["id"] for row in response.data["results"]])

    def test_a_holding_can_be_searched_by_thana(self):
        holding_id = self.post(district="Khulna", thana="Dumuria").data["id"]
        response = self.client.get(reverse("holding-list"), {"search": "Dumuria"})
        self.assertEqual([row["id"] for row in response.data["results"]], [holding_id])

    def test_clearing_the_district_alone_is_refused(self):
        """It would leave a thana hanging under no district at all."""
        holding_id = self.post(district="Khulna", thana="Dumuria").data["id"]
        response = self.client.patch(
            reverse("holding-detail", args=[holding_id]), {"district": ""}, format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("district", response.data["fields"])


class CatalogBundleGeographyTests(HoldingData):
    """The dropdowns arrive with the rest of the reference data, in one call."""

    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()
        GeoLocation.objects.create(
            division_name="Khulna", division_bn="খুলনা",
            district_name="Khulna", district_bn="খুলনা",
            upazila_name="Dumuria", upazila_bn="ডুমুরিয়া",
            union_name="Magurghona", union_bn="মাগুরঘোনা",
        )

    def setUp(self):
        self.client = APIClient()
        user = User.objects.create_user(
            phone="01700000032", name="Operator", role=Role.SUPERVISOR.value,
            password="x", scope_kind=ScopeKind.CITY,
        )
        self.client.force_authenticate(user)

    def test_the_bundle_carries_both_lists(self):
        response = self.client.get(reverse("catalog-bundle"))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["districts"], [{"name": "Khulna", "nameBn": "খুলনা"}])
        self.assertEqual(
            response.data["thanasByDistrict"],
            {"Khulna": [{"name": "Dumuria", "nameBn": "ডুমুরিয়া"}]},
        )
