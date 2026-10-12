"""Catalog geography — the city's blocks, and the national district list."""

from __future__ import annotations

import json
import tempfile
from io import StringIO
from pathlib import Path

from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import IntegrityError, transaction
from django.db.models import ProtectedError
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from swms.accounts.models import ScopeKind, User
from swms.common.roles import Role

from .models import AgencyType, Block, City, CityType, GeoLocation, Ward, Zone
from .views import geography


class BlockModelTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        zone = Zone.objects.create(id="Z-03", name="Sonadanga")
        cls.ward = Ward.objects.create(id="W-14", name="Ward 14 — Sonadanga", zone=zone)
        cls.other = Ward.objects.create(id="W-21", name="Ward 21 — Khalishpur", zone=zone)

    def test_a_name_is_unique_within_a_ward(self):
        Block.objects.create(id="W-14-A", ward=self.ward, name="Block-A")
        with self.assertRaises(IntegrityError), transaction.atomic():
            Block.objects.create(id="W-14-A2", ward=self.ward, name="Block-A")

    def test_the_same_name_may_exist_in_another_ward(self):
        """Every ward has a Block-A; they are different places."""
        Block.objects.create(id="W-14-A", ward=self.ward, name="Block-A")
        Block.objects.create(id="W-21-A", ward=self.other, name="Block-A")
        self.assertEqual(Block.objects.filter(name="Block-A").count(), 2)


class SeedBlocksTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        zone = Zone.objects.create(id="Z-03", name="Sonadanga")
        cls.ward = Ward.objects.create(id="W-14", name="Ward 14 — Sonadanga", zone=zone)
        cls.other = Ward.objects.create(id="W-21", name="Ward 21 — Khalishpur", zone=zone)
        cls.closed = Ward.objects.create(
            id="W-99", name="Ward 99 — Retired", zone=zone, active=False
        )

    def run_command(self, *args):
        out = StringIO()
        call_command("seed_blocks", *args, stdout=out)
        return out.getvalue()

    def test_it_letters_every_active_ward(self):
        self.run_command()
        self.assertEqual(
            sorted(Block.objects.filter(ward=self.ward).values_list("id", flat=True)),
            ["W-14-A", "W-14-B", "W-14-C", "W-14-D"],
        )
        self.assertEqual(Block.objects.count(), 8)

    def test_an_inactive_ward_is_left_out(self):
        """A retired ward gets no new geography."""
        self.run_command()
        self.assertFalse(Block.objects.filter(ward=self.closed).exists())

    def test_the_letter_range_is_adjustable(self):
        self.run_command("--ward", "W-14", "--through", "F")
        self.assertEqual(Block.objects.filter(ward=self.ward).count(), 6)
        self.assertTrue(Block.objects.filter(pk="W-14-F").exists())

    def test_it_can_be_limited_to_one_ward(self):
        self.run_command("--ward", "W-14")
        self.assertEqual(Block.objects.filter(ward=self.other).count(), 0)

    def test_a_dry_run_writes_nothing(self):
        output = self.run_command("--dry-run")
        self.assertIn("W-14-A", output)
        self.assertEqual(Block.objects.count(), 0)

    def test_re_running_adds_only_what_is_missing(self):
        self.run_command("--ward", "W-14", "--through", "B")
        first = list(Block.objects.filter(ward=self.ward).values_list("id", flat=True))
        self.run_command("--ward", "W-14", "--through", "D")
        self.assertEqual(Block.objects.filter(ward=self.ward).count(), 4)
        # The two that already existed keep their ids — a block id may already
        # be written across surveys, so re-seeding must not churn them.
        for block_id in first:
            self.assertTrue(Block.objects.filter(pk=block_id).exists())

    def test_re_running_identically_creates_nothing(self):
        self.run_command()
        before = Block.objects.count()
        output = self.run_command()
        self.assertEqual(Block.objects.count(), before)
        self.assertIn("already existed", output)

    def test_named_blocks_replace_the_letters(self):
        self.run_command("--ward", "W-14", "--names", "Shibbari, Boyra, Gollamari")
        self.assertEqual(
            list(Block.objects.filter(ward=self.ward).values_list("name", flat=True)),
            ["Shibbari", "Boyra", "Gollamari"],
        )
        # No letter to carry through, so the id falls back to the number.
        self.assertTrue(Block.objects.filter(pk="W-14-01").exists())

    def test_names_need_a_single_ward(self):
        """Block names belong to one ward; they are not a city-wide scheme."""
        with self.assertRaises(CommandError) as caught:
            self.run_command("--names", "Shibbari, Boyra")
        self.assertIn("single --ward", str(caught.exception))

    def test_an_unknown_ward_is_named_in_the_error(self):
        with self.assertRaises(CommandError) as caught:
            self.run_command("--ward", "W-77")
        self.assertIn("W-77", str(caught.exception))

    def test_a_bad_letter_is_refused(self):
        with self.assertRaises(CommandError) as caught:
            self.run_command("--through", "AA")
        self.assertIn("single letter", str(caught.exception))

    def test_blocks_come_back_in_order(self):
        self.run_command("--ward", "W-14")
        self.assertEqual(
            [b.name for b in Block.objects.filter(ward=self.ward)],
            ["Block-A", "Block-B", "Block-C", "Block-D"],
        )


class GeoLocationTests(TestCase):
    """The national geography table and the file it is loaded from."""

    ROWS = [
        {
            "division_name": "Khulna", "division_bn": "খুলনা",
            "district_name": "Khulna", "district_bn": "খুলনা",
            "upazila_name": "Dumuria", "upazila_bn": "ডুমুরিয়া",
            "union_name": "Magurghona", "union_bn": "মাগুরঘোনা",
            # Meaningless here — a key out of the system this was exported from.
            "business_id_id": 1,
        },
        {
            "division_name": "Khulna", "division_bn": "খুলনা",
            "district_name": "Khulna", "district_bn": "খুলনা",
            "upazila_name": "Batiaghata", "upazila_bn": "বটিয়াঘাটা",
            "union_name": "Jalma", "union_bn": "জলমা",
            "business_id_id": 1,
        },
        {
            "division_name": "Khulna", "division_bn": "খুলনা",
            "district_name": "Bagerhat", "district_bn": "বাগেরহাট",
            "upazila_name": "Fakirhat", "upazila_bn": "ফকিরহাট",
            "union_name": "Betaga", "union_bn": "বেতাগা",
            "business_id_id": 1,
        },
    ]

    def write(self, rows):
        path = Path(self.enterContext(tempfile.TemporaryDirectory())) / "geo.json"
        path.write_text(json.dumps(rows, ensure_ascii=False), encoding="utf-8")
        return str(path)

    def load(self, rows, *args):
        out = StringIO()
        call_command("load_geo_locations", "--path", self.write(rows), *args, stdout=out)
        return out.getvalue()

    def test_the_file_loads(self):
        self.load(self.ROWS)
        self.assertEqual(GeoLocation.objects.count(), 3)
        row = GeoLocation.objects.get(union_name="Jalma")
        self.assertEqual(row.district_bn, "খুলনা")

    def test_business_id_is_not_stored(self):
        """It is a foreign key out of another system and means nothing here."""
        self.load(self.ROWS)
        self.assertFalse(hasattr(GeoLocation.objects.first(), "business_id_id"))
        self.assertNotIn("business_id_id", [f.name for f in GeoLocation._meta.get_fields()])

    def test_loading_twice_does_not_double_the_table(self):
        """Reference data is reloaded whenever the file is refreshed."""
        self.load(self.ROWS)
        report = self.load(self.ROWS)
        self.assertEqual(GeoLocation.objects.count(), 3)
        self.assertIn("0 union(s) added", report)

    def test_a_repeated_union_in_the_file_lands_once(self):
        self.load(self.ROWS + [self.ROWS[0]])
        self.assertEqual(GeoLocation.objects.count(), 3)

    def test_a_row_missing_a_name_is_refused(self):
        """An empty name would reach an operator as a blank dropdown entry."""
        broken = dict(self.ROWS[0], upazila_name="")
        with self.assertRaises(CommandError) as caught:
            self.load([broken])
        self.assertIn("upazila_name", str(caught.exception))
        self.assertEqual(GeoLocation.objects.count(), 0)

    def test_dry_run_writes_nothing(self):
        report = self.load(self.ROWS, "--dry-run")
        self.assertIn("3 new", report)
        self.assertEqual(GeoLocation.objects.count(), 0)

    def test_a_missing_file_is_named(self):
        with self.assertRaises(CommandError) as caught:
            call_command("load_geo_locations", "--path", "no/such/geo.json")
        self.assertIn("geo.json", str(caught.exception))

    def test_the_same_union_cannot_be_stored_twice(self):
        self.load(self.ROWS)
        with self.assertRaises(IntegrityError), transaction.atomic():
            GeoLocation.objects.create(**{k: v for k, v in self.ROWS[0].items()
                                          if k != "business_id_id"})


class GeographyPayloadTests(TestCase):
    """What the holding form's two dropdowns are built from."""

    @classmethod
    def setUpTestData(cls):
        for row in GeoLocationTests.ROWS:
            GeoLocation.objects.create(**{k: v for k, v in row.items() if k != "business_id_id"})

    def test_districts_are_listed_once_each(self):
        districts, _ = geography()
        self.assertEqual([d["name"] for d in districts], ["Bagerhat", "Khulna"])

    def test_a_district_carries_its_bangla_name(self):
        """The form is used in both languages, so both names travel."""
        districts, _ = geography()
        self.assertEqual(districts[1], {"name": "Khulna", "nameBn": "খুলনা"})

    def test_thanas_are_grouped_under_their_district(self):
        _, thanas = geography()
        self.assertEqual(
            [t["name"] for t in thanas["Khulna"]], ["Batiaghata", "Dumuria"]
        )
        self.assertEqual([t["name"] for t in thanas["Bagerhat"]], ["Fakirhat"])

    def test_a_thana_appears_once_however_many_unions_it_holds(self):
        GeoLocation.objects.create(
            division_name="Khulna", division_bn="খুলনা",
            district_name="Khulna", district_bn="খুলনা",
            upazila_name="Dumuria", upazila_bn="ডুমুরিয়া",
            union_name="Rudaghara", union_bn="রুদাঘরা",
        )
        _, thanas = geography()
        self.assertEqual([t["name"] for t in thanas["Khulna"]], ["Batiaghata", "Dumuria"])


class CityTests(TestCase):
    """The city sits above the zones and owns the collection-day times."""

    @classmethod
    def setUpTestData(cls):
        cls.kcc = City.objects.create(id="KCC", name="Khulna City Corporation")
        cls.scc = City.objects.create(id="SCC", name="Sylhet City Corporation")
        cls.zone = Zone.objects.create(id="Z-03", name="Sonadanga", city=cls.kcc)
        cls.ward = Ward.objects.create(id="W-14", name="Ward 14 — Sonadanga", zone=cls.zone)

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(User.objects.create_user(
            phone="01900445566", name="Admin", role=Role.SUPER_ADMIN,
            scope_kind=ScopeKind.CITY,
        ))

    def test_a_new_city_defaults_to_nine_pm_and_noon(self):
        self.assertEqual(str(self.kcc.collection_cutoff), "21:00:00")
        self.assertEqual(str(self.kcc.complaint_deadline), "12:00:00")

    def test_a_ward_knows_its_city_through_its_zone(self):
        self.assertEqual(self.ward.city_id, "KCC")

    def test_a_city_with_zones_cannot_be_deleted(self):
        with self.assertRaises(ProtectedError):
            self.kcc.delete()

    def test_the_bundle_lists_cities_and_each_zone_names_its_city(self):
        payload = self.client.get(reverse("catalog-bundle")).json()
        self.assertEqual([c["id"] for c in payload["cities"]], ["KCC", "SCC"])
        self.assertEqual(payload["zones"][0]["city"], "KCC")

    def test_zones_filter_by_city(self):
        Zone.objects.create(id="Z-90", name="Zindabazar", city=self.scc)
        rows = self.client.get(reverse("zone-list"), {"city": "SCC"}).json()
        rows = rows.get("results", rows) if isinstance(rows, dict) else rows
        self.assertEqual([z["id"] for z in rows], ["Z-90"])

    def test_a_city_can_be_created_with_its_own_cutoff(self):
        response = self.client.post(
            reverse("city-list"),
            {"id": "RPS", "name": "Rangpur Pourashova", "cityType": "pourashova",
             "collectionCutoff": "20:30"},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.json())
        self.assertEqual(str(City.objects.get(pk="RPS").collection_cutoff), "20:30:00")


class TypeSetupListTests(TestCase):
    """City and agency types are setup rows, not choices fixed in code."""

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(User.objects.create_user(
            phone="01900445566", name="Admin", role=Role.SUPER_ADMIN,
            scope_kind=ScopeKind.CITY,
        ))

    def test_the_standard_types_are_loaded(self):
        self.assertEqual(
            list(CityType.objects.values_list("id", flat=True)),
            ["city_corporation", "pourashova"],
        )
        self.assertTrue(AgencyType.objects.filter(pk="city_corporation").exists())
        self.assertTrue(AgencyType.objects.filter(pk="pourashova").exists())

    def test_the_bundle_carries_both_lists(self):
        payload = self.client.get(reverse("catalog-bundle")).json()
        self.assertIn("pourashova", [row["id"] for row in payload["cityTypes"]])
        self.assertIn("private", [row["id"] for row in payload["agencyTypes"]])

    def test_an_inactive_type_drops_out_of_the_dropdown(self):
        AgencyType.objects.filter(pk="cbo").update(active=False)
        payload = self.client.get(reverse("catalog-bundle")).json()
        self.assertNotIn("cbo", [row["id"] for row in payload["agencyTypes"]])

    def test_a_new_type_can_be_added_in_setup_and_used(self):
        response = self.client.post(
            reverse("city-type-list"),
            {"id": "union_parishad", "key": "opt.cityType.union_parishad",
             "label": "Union Parishad"},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.json())
        response = self.client.post(
            reverse("city-list"),
            {"id": "UP1", "name": "Some Union", "cityType": "union_parishad"},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.json())
        self.assertEqual(City.objects.get(pk="UP1").city_type_id, "union_parishad")

    def test_an_unknown_type_is_refused(self):
        response = self.client.post(
            reverse("city-list"), {"id": "XX", "name": "X", "cityType": "nope"}, format="json"
        )
        self.assertEqual(response.status_code, 400)

    def test_a_type_in_use_cannot_be_deleted(self):
        City.objects.create(id="KCC", name="Khulna", city_type_id="city_corporation")
        with self.assertRaises(ProtectedError):
            CityType.objects.get(pk="city_corporation").delete()

    def test_only_a_super_admin_edits_the_lists(self):
        viewer = APIClient()
        viewer.force_authenticate(User.objects.create_user(
            phone="01900445567", name="V", role=Role.KCC_VIEWER, scope_kind=ScopeKind.CITY,
        ))
        response = viewer.post(
            reverse("agency-type-list"), {"id": "x", "key": "k", "label": "X"}, format="json"
        )
        self.assertEqual(response.status_code, 403)


class ZoneWardSetupTests(TestCase):
    """Zones and wards for a new city, as the Setup page creates them."""

    @classmethod
    def setUpTestData(cls):
        cls.kcc = City.objects.create(id="KCC", name="Khulna City Corporation")
        cls.scc = City.objects.create(id="SCC", name="Sylhet City Corporation")
        cls.zone = Zone.objects.create(id="Z-03", name="Sonadanga", city=cls.kcc)
        Ward.objects.create(id="W-14", name="Ward 14 — Sonadanga", zone=cls.zone)

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(User.objects.create_user(
            phone="01900445566", name="Admin", role=Role.SUPER_ADMIN,
            scope_kind=ScopeKind.CITY,
        ))

    def rows(self, response):
        body = response.json()
        return body.get("results", body) if isinstance(body, dict) else body

    def test_a_new_city_gets_a_zone_and_a_ward(self):
        response = self.client.post(
            reverse("zone-list"), {"id": "SCC-Z1", "name": "Zindabazar", "city": "SCC"},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.json())
        response = self.client.post(
            reverse("ward-list"),
            {"id": "SCC-W22", "key": "opt.ward.SCC-W22", "name": "Ward 22",
             "zone": "SCC-Z1", "lat": 24.8949, "lng": 91.8687},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.json())
        self.assertEqual(response.json()["city"], "SCC")
        self.assertEqual(Ward.objects.get(pk="SCC-W22").city_id, "SCC")

    def test_a_zone_carries_its_bangla_name(self):
        response = self.client.post(
            reverse("zone-list"),
            {"id": "SCC-Z1", "name": "Zindabazar", "nameBn": "জিন্দাবাজার", "city": "SCC"},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.json())
        self.assertEqual(Zone.objects.get(pk="SCC-Z1").name_bn, "জিন্দাবাজার")
        payload = self.client.get(reverse("catalog-bundle")).json()
        zone = next(z for z in payload["zones"] if z["id"] == "SCC-Z1")
        self.assertEqual(zone["nameBn"], "জিন্দাবাজার")

    def test_a_ward_carries_its_bangla_name(self):
        zone = Zone.objects.create(id="SCC-Z1", name="Zindabazar", city=self.scc)
        response = self.client.post(
            reverse("ward-list"),
            {"id": "SCC-W22", "name": "Ward 22 — Zindabazar", "nameBn": "ওয়ার্ড ২২ — জিন্দাবাজার",
             "zone": zone.id},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.json())
        self.assertEqual(Ward.objects.get(pk="SCC-W22").name_bn, "ওয়ার্ড ২২ — জিন্দাবাজার")
        payload = self.client.get(reverse("catalog-bundle")).json()
        ward = next(w for w in payload["wards"] if w["id"] == "SCC-W22")
        self.assertEqual(ward["nameBn"], "ওয়ার্ড ২২ — জিন্দাবাজার")

    def test_wards_filter_by_city(self):
        zone = Zone.objects.create(id="SCC-Z1", name="Zindabazar", city=self.scc)
        Ward.objects.create(id="SCC-W22", name="Ward 22", zone=zone)
        rows = self.rows(self.client.get(reverse("ward-list"), {"zone__city": "SCC"}))
        self.assertEqual([w["id"] for w in rows], ["SCC-W22"])

    def test_a_ward_code_already_used_by_another_city_is_refused(self):
        zone = Zone.objects.create(id="SCC-Z1", name="Zindabazar", city=self.scc)
        response = self.client.post(
            reverse("ward-list"), {"id": "W-14", "name": "Ward 14", "zone": zone.id},
            format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_a_hidden_ward_leaves_the_dropdowns(self):
        response = self.client.patch(
            reverse("ward-detail", args=["W-14"]), {"active": False}, format="json"
        )
        self.assertEqual(response.status_code, 200, response.json())
        payload = self.client.get(reverse("catalog-bundle")).json()
        self.assertNotIn("W-14", [w["id"] for w in payload["wards"]])
        listed = self.rows(self.client.get(reverse("ward-list")))
        self.assertFalse(next(w for w in listed if w["id"] == "W-14")["active"])

    def test_an_unknown_zone_is_refused(self):
        response = self.client.post(
            reverse("ward-list"), {"id": "X-1", "name": "X", "zone": "NOPE"}, format="json"
        )
        self.assertEqual(response.status_code, 400)
