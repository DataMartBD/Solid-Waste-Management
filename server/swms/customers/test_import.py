"""Bulk upload of holdings — the client's minimum-effort setup."""

from __future__ import annotations

import io

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from swms.accounts.models import ScopeKind, User
from swms.agencies.models import Agency
from swms.catalog.models import City, HoldingType, Road, Tier, Ward, Zone
from swms.common.roles import Role
from swms.fieldops.models import Route, RouteStop

from .models import Holding

HEADER = "Holding No,Name,Mobile,City,Ward,Area,Address,Route,GPS Location,Tier,Charge,Units\n"


def csv_file(*lines, name="holdings.csv"):
    return SimpleUploadedFile(name, (HEADER + "\n".join(lines)).encode("utf-8"), "text/csv")


class ImportTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.city = City.objects.create(id="KCC", name="Khulna City Corporation")
        zone = Zone.objects.create(id="Z-03", name="Sonadanga", city=cls.city)
        cls.ward = Ward.objects.create(id="W-14", name="Ward 14 — Sonadanga", zone=zone)
        other_city = City.objects.create(id="SCC", name="Sylhet City Corporation")
        other_zone = Zone.objects.create(id="SCC-Z1", name="Zindabazar", city=other_city)
        cls.other_ward = Ward.objects.create(id="SCC-W22", name="Ward 22", zone=other_zone)
        cls.road = Road.objects.create(ward=cls.ward, name="KDA Avenue")
        cls.htype = HoldingType.objects.create(id="pucca", key="opt.h", label="Pucca")
        cls.tier = Tier.objects.create(id="std", key="opt.t", label="Standard", charge=150)
        cls.route = Route.objects.create(name="KDA Avenue round", ward=cls.ward)

    def setUp(self):
        self.admin = User.objects.create_user(
            phone="01900445566", name="Admin", role=Role.SUPER_ADMIN, scope_kind=ScopeKind.CITY,
        )
        self.client = APIClient()
        self.client.force_authenticate(self.admin)

    def upload(self, file, commit=False, client=None):
        return (client or self.client).post(
            reverse("holding-bulk-import"), {"file": file, "commit": "true" if commit else "false"},
            format="multipart",
        )

    def test_a_preview_validates_and_writes_nothing(self):
        response = self.upload(csv_file(
            "142/B,Abdul Karim,01711000000,KCC,W-14,KDA Avenue,,,\"22.8456, 89.5403\",std,,4",
        ))
        self.assertEqual(response.status_code, 200, response.json())
        body = response.json()
        self.assertTrue(body["dryRun"])
        self.assertEqual(body["summary"]["valid"], 1)
        self.assertEqual(body["rows"][0]["action"], "create")
        self.assertFalse(Holding.objects.exists())

    def test_importing_creates_located_holdings_with_their_terms(self):
        response = self.upload(csv_file(
            "142/B,Abdul Karim,+8801711000000,KCC,14,KDA Avenue,,KDA Avenue round,\"22.8456, 89.5403\",std,200,4",
        ), commit=True)
        self.assertEqual(response.status_code, 200, response.json())
        self.assertEqual(response.json()["summary"]["created"], 1)
        holding = Holding.objects.get(holding_no="142/B")
        self.assertEqual(holding.ward_id, "W-14")
        self.assertEqual(holding.owner_phone, "01711000000")
        self.assertTrue(holding.verified)
        self.assertEqual((holding.tier_id, holding.charge, holding.units_total), ("std", 200, 4))
        self.assertTrue(holding.qr)
        self.assertEqual(RouteStop.objects.get(holding=holding).route_id, self.route.id)

    def test_a_new_area_is_added_to_the_ward(self):
        response = self.upload(csv_file("7,Rina,,KCC,W-14,Boyra Main Road,,,,,,"), commit=True)
        self.assertIn("New area/road", response.json()["rows"][0]["warnings"][0])
        self.assertTrue(Road.objects.filter(ward=self.ward, name="Boyra Main Road").exists())

    def test_an_existing_holding_is_updated_not_duplicated(self):
        Holding.objects.create(
            ward=self.ward, road=self.road, holding_no="142/B", holding_type=self.htype,
            owner_name="Old Owner",
        )
        response = self.upload(csv_file("142/B,New Owner,,,W-14,KDA Avenue,,,,,,"), commit=True)
        self.assertEqual(response.json()["rows"][0]["action"], "update")
        self.assertEqual(Holding.objects.count(), 1)
        self.assertEqual(Holding.objects.get().owner_name, "New Owner")

    def test_bad_rows_are_reported_and_skipped(self):
        response = self.upload(csv_file(
            "1,Good Row,,KCC,W-14,KDA Avenue,,,,,,",
            ",No Number,,KCC,W-14,KDA Avenue,,,,,,",
            "2,Bad Phone,12345,KCC,W-14,KDA Avenue,,,,,,",
            "3,Wrong City,,KCC,SCC-W22,X Road,,,,,,",
            "4,Bad GPS,,KCC,W-14,KDA Avenue,,,\"99, 99\",,,",
            "5,Route No GPS,,KCC,W-14,KDA Avenue,,KDA Avenue round,,,,",
            "1,Repeated,,KCC,W-14,KDA Avenue,,,,,,",
            "6,Unknown Tier,,KCC,W-14,KDA Avenue,,,,gold,,",
        ), commit=True)
        body = response.json()
        self.assertEqual(body["summary"]["valid"], 1)
        self.assertEqual(body["summary"]["created"], 1)
        errors = {row["row"]: " ".join(row["errors"]) for row in body["rows"]}
        self.assertIn("Holding No is required", errors[3])
        self.assertIn("not a valid number", errors[4])
        self.assertIn("Unknown ward", errors[5])
        self.assertIn("outside Bangladesh", errors[6])
        self.assertIn("needs a GPS Location", errors[7])
        self.assertIn("Same holding as row 2", errors[8])
        self.assertIn("Unknown tier", errors[9])
        self.assertEqual(Holding.objects.count(), 1)

    def test_an_excel_file_is_read_too(self):
        from openpyxl import Workbook

        book = Workbook()
        book.active.append(["Holding No", "Name", "Ward", "Area"])
        book.active.append(["55/A", "Shirin", "W-14", "KDA Avenue"])
        buffer = io.BytesIO()
        book.save(buffer)
        upload = SimpleUploadedFile("holdings.xlsx", buffer.getvalue())
        response = self.upload(upload, commit=True)
        self.assertEqual(response.status_code, 200, response.json())
        self.assertTrue(Holding.objects.filter(holding_no="55/A").exists())

    def test_a_file_missing_required_columns_is_refused(self):
        upload = SimpleUploadedFile("x.csv", b"Holding No,Name\n1,A\n", "text/csv")
        response = self.upload(upload)
        self.assertEqual(response.status_code, 400)
        self.assertIn("Missing column", str(response.json()))

    def test_another_file_type_is_refused(self):
        response = self.upload(SimpleUploadedFile("x.pdf", b"%PDF", "application/pdf"))
        self.assertEqual(response.status_code, 400)

    def test_a_supervisor_cannot_bulk_upload(self):
        user = User.objects.create_user(
            phone="01900445567", name="Sup", role=Role.SUPERVISOR, scope_kind=ScopeKind.CITY,
        )
        client = APIClient()
        client.force_authenticate(user)
        response = self.upload(csv_file("1,A,,,W-14,KDA Avenue,,,,,,"), client=client)
        self.assertEqual(response.status_code, 403)

    def test_an_agency_admin_imports_for_their_own_agency_only(self):
        mine = Agency.objects.create(name="Premier", short_code="PCM", city=self.city)
        Agency.objects.create(name="Rival", short_code="RVL", city=self.city)
        user = User.objects.create_user(
            phone="01900445568", name="Tenant", role=Role.AGENCY_ADMIN,
            scope_kind=ScopeKind.AGENCY, agency=mine,
        )
        client = APIClient()
        client.force_authenticate(user)
        header = "Holding No,Name,Ward,Area,Agency\n"
        upload = SimpleUploadedFile(
            "x.csv", (header + "1,A,W-14,KDA Avenue,\n2,B,W-14,KDA Avenue,RVL\n").encode(), "text/csv"
        )
        body = self.upload(upload, commit=True, client=client).json()
        self.assertEqual(body["summary"]["created"], 1)
        self.assertEqual(Holding.objects.get(holding_no="1").agency_id, mine.id)
        self.assertIn("your own agency", " ".join(body["rows"][1]["errors"]))

    def test_the_template_downloads(self):
        response = self.client.get(reverse("holding-import-template"))
        self.assertEqual(response.status_code, 200)
        self.assertIn("spreadsheetml", response["Content-Type"])
