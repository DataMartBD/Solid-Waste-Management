"""Loading the local-government workbook into the existing tables.

The workbook is read once for the whole module — it is 2.4 MB and 44,000 ward
rows — and each test loads that parsed copy into its own database.
"""

from __future__ import annotations

from io import StringIO

from django.core.management import call_command
from django.test import TestCase

from .management.commands.load_local_government import DEFAULT_PATH, load, read_workbook
from .models import City, CityType, GeoLocation, Ward, Zone

_parsed = {}


def workbook(path=DEFAULT_PATH):
    if path not in _parsed:
        _parsed[path] = read_workbook(path)
    return _parsed[path]


class LoadLocalGovernmentTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        CityType.objects.get_or_create(pk="city_corporation", defaults={"key": "k", "label": "CC"})
        cls.kcc = City.objects.create(id="KCC", name="Khulna", active=True, city_type_id="city_corporation")
        zone = Zone.objects.create(id="Z-03", name="Sonadanga", city=cls.kcc)
        cls.w14 = Ward.objects.create(id="W-14", name="Ward 14 — Sonadanga", zone=zone)
        GeoLocation.objects.create(
            division_name="Barisal", division_bn="বরিশাল", district_name="Barisal", district_bn="বরিশাল",
            upazila_name="Old", upazila_bn="পুরান", union_name="Old", union_bn="পুরান",
        )

    def test_cities_wards_and_districts_land_in_the_existing_tables(self):
        load(workbook())
        self.assertEqual(City.objects.filter(city_type_id="city_corporation").count(), 13)
        self.assertEqual(City.objects.filter(city_type_id="pourashova").count(), 331)
        self.assertTrue(Ward.objects.filter(pk="DNCC-W01", zone__city_id="DNCC").exists())
        self.assertFalse(City.objects.get(pk="BgCC").active)  # approved, not yet gazetted
        districts = set(GeoLocation.objects.values_list("district_name", flat=True))
        self.assertIn("Barishal", districts)
        self.assertNotIn("Barisal", districts)

    def test_pourashava_wards_load_but_union_wards_stay_in_the_workbook(self):
        report = load(workbook())
        self.assertEqual(Ward.objects.filter(zone__city_id="PS-001").count(), 9)
        self.assertEqual(Ward.objects.get(pk="P001-W01").name_bn, "ওয়ার্ড নং ১")
        self.assertFalse(Ward.objects.filter(pk__startswith="U").exists())
        self.assertGreater(report["Union Parishad wards left in the workbook (no city here)"], 0)

    def test_an_existing_city_and_its_wards_are_kept(self):
        self.kcc.collection_cutoff = "20:00"
        self.kcc.save()
        load(workbook())
        kcc = City.objects.get(pk="KCC")
        self.assertEqual(kcc.name, "Khulna City Corporation")
        self.assertEqual(kcc.collection_cutoff.strftime("%H:%M"), "20:00")
        self.assertEqual(Ward.objects.get(pk="W-14").name, "Ward 14 — Sonadanga")
        self.assertFalse(Ward.objects.filter(pk="KCC-W14").exists())  # not duplicated
        self.assertEqual(Ward.objects.filter(zone__city_id="KCC").count(), 31)

    def test_running_twice_changes_nothing(self):
        load(workbook())
        counts = (City.objects.count(), Ward.objects.count(), Zone.objects.count(), GeoLocation.objects.count())
        report = load(workbook())
        self.assertEqual(report["wards created"], 0)
        self.assertEqual(
            (City.objects.count(), Ward.objects.count(), Zone.objects.count(), GeoLocation.objects.count()),
            counts,
        )

    def test_version_one_of_the_workbook_still_loads(self):
        load(workbook(DEFAULT_PATH.with_name("bd_local_government_v1.xlsx")))
        self.assertTrue(Ward.objects.filter(pk="DNCC-W01").exists())
        self.assertFalse(Ward.objects.filter(pk="P001-W01").exists())

    def test_the_command_dry_run_writes_nothing(self):
        out = StringIO()
        call_command("load_local_government", "--dry-run",
                     path=str(DEFAULT_PATH.with_name("bd_local_government_v1.xlsx")), stdout=out)
        self.assertIn("Dry run", out.getvalue())
        self.assertFalse(City.objects.filter(pk="DNCC").exists())
