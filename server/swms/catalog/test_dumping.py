"""Dumping / disposal points, and the van that unloads at one."""

from __future__ import annotations

from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from swms.accounts.models import ScopeKind, User
from swms.common.roles import Role
from swms.fleet.models import Van

from .models import City, DumpingPoint, Ward, Zone


class DumpingPointTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.kcc = City.objects.create(id="KCC", name="Khulna City Corporation")
        cls.scc = City.objects.create(id="SCC", name="Sylhet City Corporation")
        cls.ward = Ward.objects.create(
            id="W-14", name="Ward 14", zone=Zone.objects.create(id="Z-03", name="S", city=cls.kcc)
        )
        cls.sylhet_ward = Ward.objects.create(
            id="SCC-W22", name="Ward 22", zone=Zone.objects.create(id="SCC-Z1", name="Z", city=cls.scc)
        )

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(User.objects.create_user(
            phone="01900445566", name="Admin", role=Role.SUPER_ADMIN, scope_kind=ScopeKind.CITY,
        ))

    def test_a_point_is_created_with_the_wards_it_serves(self):
        response = self.client.post(reverse("dumping-point-list"), {
            "name": "Rajbandh Landfill", "nameBn": "রাজবাঁধ ল্যান্ডফিল", "kind": "disposal_site",
            "city": "KCC", "wards": ["W-14"], "lat": 22.79, "lng": 89.50, "capacityTonnes": 450,
        }, format="json")
        self.assertEqual(response.status_code, 201, response.json())
        point = DumpingPoint.objects.get(name="Rajbandh Landfill")
        self.assertEqual(list(point.wards.values_list("id", flat=True)), ["W-14"])
        self.assertEqual(point.kind, "disposal_site")

    def test_a_ward_of_another_city_is_refused(self):
        response = self.client.post(reverse("dumping-point-list"), {
            "name": "X", "kind": "dumping_area", "city": "KCC", "wards": ["SCC-W22"],
        }, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertIn("SCC-W22", str(response.json()))

    def test_the_bundle_lists_active_points(self):
        DumpingPoint.objects.create(name="Old", city=self.kcc, active=False)
        DumpingPoint.objects.create(name="Transfer A", kind="transfer_station", city=self.kcc)
        names = [p["name"] for p in self.client.get(reverse("catalog-bundle")).json()["dumpingPoints"]]
        self.assertEqual(names, ["Transfer A"])

    def test_a_van_works_a_ward_and_unloads_at_a_point(self):
        point = DumpingPoint.objects.create(name="Transfer A", city=self.kcc)
        response = self.client.post(reverse("van-list"), {
            "plate": "KHULNA-TA-1", "type": "pickup", "capacity": 1500, "fuel": "diesel",
            "ward": "W-14", "dumpingPoint": point.id,
        }, format="json")
        self.assertEqual(response.status_code, 201, response.json())
        van = Van.objects.get(plate="KHULNA-TA-1")
        self.assertEqual((van.ward_id, van.dumping_point_id), ("W-14", point.id))

    def test_a_van_cannot_unload_in_another_city(self):
        point = DumpingPoint.objects.create(name="Sylhet Transfer", city=self.scc)
        response = self.client.post(reverse("van-list"), {
            "plate": "KHULNA-TA-2", "type": "pickup", "capacity": 1500, "fuel": "diesel",
            "ward": "W-14", "dumpingPoint": point.id,
        }, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertIn("dumpingPoint", response.json()["fields"])

    def test_only_a_super_admin_edits_the_list(self):
        viewer = APIClient()
        viewer.force_authenticate(User.objects.create_user(
            phone="01900445567", name="V", role=Role.KCC_VIEWER, scope_kind=ScopeKind.CITY,
        ))
        response = viewer.post(reverse("dumping-point-list"), {"name": "X", "city": "KCC"}, format="json")
        self.assertEqual(response.status_code, 403)
