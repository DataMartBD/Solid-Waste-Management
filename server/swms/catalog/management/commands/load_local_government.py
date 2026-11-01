"""Load Bangladesh's local-government master data from the workbook.

    manage.py load_local_government              # load / refresh
    manage.py load_local_government --dry-run    # report, write nothing

The source is `swms/catalog/data/bd_local_government.xlsx` (a copy of
Documents/Bangladesh_CityCorporation_Pourashava_List.xlsx), kept in the project
unchanged — every sheet, note and column — so data with no field here yet
(division, year established, ward counts, upazila websites, CC thanas, the
summaries and cross-checks) stays available for future use.

Mapped onto existing tables only; no new fields:

* **Unions** → `geo_location` (division / district / upazila / union, English
  and Bangla). It replaces the old copy, so districts carry the official
  spellings (Barishal, Cumilla, Cox's Bazar, Jhalokathi). District and thana
  text already stored on holdings and cities is moved to the new spelling,
  matched by its Bangla name.
* **City Corporations** → `city` (type City Corporation), coded as in the ward
  sheet (DNCC, KCC, RpCC, …); Bogura, approved but not yet gazetted, is BgCC
  and left inactive.
* **Pourashavas** → `city` (type Pourashava), coded PS-001 … in sheet order.
* **All Wards** (version 2; "CC Wards" in version 1) → `ward`, coded as in the
  sheet (DNCC-W01, P001-W01, …), under one zone per city, "Unassigned", to be
  organised in Setup. City corporation and pourashava wards only: union
  parishad wards are rural, have no city here, and stay in the workbook. A
  city's existing ward with the same number (KCC's W-14 is ward 14) is kept
  and not duplicated; a ward loaded before has its name refreshed.

An existing city keeps its own settings (active, cut-off, complaint deadline);
only its name, Bangla name, district and type are refreshed. Re-running is safe.
"""

from __future__ import annotations

import re
import unicodedata
from collections import Counter
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from swms.catalog.models import City, CityType, GeoLocation, Ward, Zone

DEFAULT_PATH = Path(__file__).resolve().parents[2] / "data" / "bd_local_government.xlsx"

CITY_CORPORATION = "city_corporation"
#: "Body Type" values in the All Wards sheet.
BODY_CC = "City Corporation"
BODY_PS = "Pourashava"
POURASHOVA = "pourashova"

#: Codes for city corporations that have no rows in the ward sheet.
EXTRA_CC_CODES = {"Bogura City Corporation": "BgCC"}
#: Approved but not yet in force — loaded, but not offered for selection.
PENDING = {"BgCC"}

_BN_DIGITS = str.maketrans("0123456789", "০১২৩৪৫৬৭৮৯")


def nfc(value) -> str:
    return unicodedata.normalize("NFC", str(value or "").strip())


def rows(sheet, header_row: int):
    """Data rows below the heading row, skipping blank ones."""
    for row in sheet.iter_rows(min_row=header_row + 1, values_only=True):
        if row and row[0] not in (None, ""):
            yield row


def read_workbook(path: Path) -> dict:
    import openpyxl

    book = openpyxl.load_workbook(path, read_only=True, data_only=True)
    try:
        unions = [
            {
                "division_name": nfc(r[2]), "division_bn": nfc(r[3]),
                "district_name": nfc(r[4]), "district_bn": nfc(r[5]),
                "upazila_name": nfc(r[6]), "upazila_bn": nfc(r[7]),
                "union_name": nfc(r[8]), "union_bn": nfc(r[9]),
            }
            for r in rows(book["Unions"], 4)
        ]
        corporations = [
            {"name": nfc(r[1]), "name_bn": nfc(r[2]), "district": nfc(r[4])}
            for r in rows(book["City Corporations"], 4)
        ]
        pourashavas = [
            {"sl": int(r[0]), "district": nfc(r[3]), "name": nfc(r[7]), "name_bn": nfc(r[8])}
            for r in rows(book["Pourashavas"], 4)
        ]
        skipped = Counter()
        if "All Wards" in book.sheetnames:
            # Version 2: one sheet for every ward in the country. City
            # corporation and pourashava wards are loaded; union parishad wards
            # are rural, have no city here, and stay in the workbook only.
            wards = []
            for r in rows(book["All Wards"], 4):
                body = nfc(r[1])
                if body not in (BODY_CC, BODY_PS):
                    skipped[body] += 1
                    continue
                wards.append({
                    "body": body, "city": nfc(r[5]), "number": int(r[7]), "code": nfc(r[0]),
                    "name": nfc(r[8]), "name_bn": nfc(r[9]),
                })
        else:
            # Version 1: city corporation wards only.
            wards = [
                {"body": BODY_CC, "city": nfc(r[0]), "number": int(r[2]), "code": nfc(r[3]),
                 "name": "", "name_bn": ""}
                for r in rows(book["CC Wards"], 4)
            ]
    finally:
        book.close()
    return {"unions": unions, "corporations": corporations, "pourashavas": pourashavas,
            "wards": wards, "wards_not_loaded": skipped}


def ward_number(ward: Ward) -> int | None:
    match = re.search(r"(\d+)\s*$", ward.id) or re.search(r"(\d+)", ward.name or "")
    return int(match.group(1)) if match else None


def load(data: dict) -> Counter:
    from swms.customers.models import Holding

    report = Counter()

    # --- districts, upazilas, unions -------------------------------------- #
    new_district = {}  # Bangla district name → official English
    new_upazila = {}   # (Bangla district, Bangla upazila) → official English upazila
    for u in data["unions"]:
        new_district[u["district_bn"]] = u["district_name"]
        new_upazila[(u["district_bn"], u["upazila_bn"])] = u["upazila_name"]

    rename_district, rename_upazila = {}, {}
    for d, d_bn, z, z_bn in GeoLocation.objects.values_list(
        "district_name", "district_bn", "upazila_name", "upazila_bn"
    ).distinct():
        official = new_district.get(nfc(d_bn))
        if official and official != d:
            rename_district[d] = official
        official_upazila = new_upazila.get((nfc(d_bn), nfc(z_bn)))
        if official_upazila and official_upazila != z:
            rename_upazila[(d, z)] = (official or d, official_upazila)

    # The table holds a union once per upazila; the sheet repeats a few names
    # (same union listed twice). The first is kept — the workbook keeps both.
    unique, seen = [], set()
    for u in data["unions"]:
        key = (u["division_name"], u["district_name"], u["upazila_name"], u["union_name"])
        if key in seen:
            report["union rows repeated in the sheet (kept once)"] += 1
            continue
        seen.add(key)
        unique.append(u)
    GeoLocation.objects.all().delete()
    GeoLocation.objects.bulk_create(GeoLocation(**u) for u in unique)
    report["geo rows"] = len(unique)

    for (old_d, old_z), (d, z) in rename_upazila.items():
        report["holding thanas renamed"] += Holding.objects.filter(
            district=old_d, thana=old_z).update(district=d, thana=z)
    for old, new in rename_district.items():
        report["holding districts renamed"] += Holding.objects.filter(district=old).update(district=new)
        report["city districts renamed"] += City.objects.filter(district=old).update(district=new)
    report["districts respelled"] = len(rename_district)

    # --- city corporations and pourashavas -------------------------------- #
    for type_id, label in ((CITY_CORPORATION, "City Corporation"), (POURASHOVA, "Pourashova / Municipality")):
        CityType.objects.get_or_create(
            pk=type_id, defaults={"key": f"opt.cityType.{type_id}", "label": label}
        )

    codes = dict(EXTRA_CC_CODES)
    for w in data["wards"]:
        if w["body"] == BODY_CC:
            codes.setdefault(w["city"], w["code"].split("-")[0])

    def city_of(ward) -> str:
        """The city a sheet ward belongs to: a CC by name, a pourashava by its
        code — P001 is the first pourashava, which is city PS-001."""
        if ward["body"] == BODY_CC:
            return codes[ward["city"]]
        return f"PS-{int(ward['code'].split('-')[0][1:]):03d}"

    present = {city.pk: city for city in City.objects.all()}
    new_cities, changed_cities = [], []

    def upsert(code, name, name_bn, district, city_type):
        city = present.get(code)
        if city is None:
            new_cities.append(City(
                id=code, name=name, name_bn=name_bn, district=district,
                city_type_id=city_type, active=code not in PENDING,
            ))
            report[f"{city_type} created"] += 1
            return
        # An existing city keeps its own settings; only these are refreshed,
        # and only when the sheet says something different.
        fresh = (name, name_bn, district, city_type)
        if (city.name, city.name_bn, city.district, city.city_type_id) != fresh:
            city.name, city.name_bn, city.district, city.city_type_id = fresh
            changed_cities.append(city)
            report[f"{city_type} updated"] += 1

    for cc in data["corporations"]:
        code = codes.get(cc["name"])
        if not code:
            raise CommandError(f"No code for {cc['name']}: add it to EXTRA_CC_CODES.")
        upsert(code, cc["name"], cc["name_bn"], cc["district"], CITY_CORPORATION)

    for p in data["pourashavas"]:
        upsert(
            f"PS-{p['sl']:03d}", f"{p['name']} Pourashava", f"{p['name_bn']} পৌরসভা",
            p["district"], POURASHOVA,
        )

    City.objects.bulk_create(new_cities)
    City.objects.bulk_update(changed_cities, ["name", "name_bn", "district", "city_type"], batch_size=500)

    # --- city corporation and pourashava wards ---------------------------- #
    for body, count in data.get("wards_not_loaded", {}).items():
        report[f"{body} wards left in the workbook (no city here)"] = count
    # A city's wards already present, by number — read once, not per ward.
    numbered: dict[str, set[int]] = {}
    for ward in Ward.objects.select_related("zone").filter(zone__city__isnull=False):
        numbered.setdefault(ward.zone.city_id, set()).add(ward_number(ward))
    taken = {ward.pk: ward for ward in Ward.objects.all()}
    zones, new_wards, renamed = {}, [], []
    for w in data["wards"]:
        code = city_of(w)
        name = w["name"] or f"Ward {w['number']:02d}"
        name_bn = w["name_bn"] or f"ওয়ার্ড {str(w['number']).zfill(2).translate(_BN_DIGITS)}"
        if w["code"] in taken:
            # Loaded before: refresh its name from the sheet if it changed.
            ward = taken[w["code"]]
            if (ward.name, ward.name_bn) != (name, name_bn):
                ward.name, ward.name_bn = name, name_bn
                renamed.append(ward)
            report["wards kept (already present)"] += 1
            continue
        if w["number"] in numbered.get(code, set()):
            # The city's own ward with this number (KCC's W-14) — kept as it is.
            report["wards kept (already present)"] += 1
            continue
        prefix = w["code"].split("-")[0]
        if prefix not in zones:
            zones[prefix], made = Zone.objects.get_or_create(
                pk=f"{prefix}-Z0",
                defaults={"city_id": code, "name": "Unassigned", "name_bn": "অনির্ধারিত",
                          "sort_order": 99},
            )
            report["zones created"] += int(made)
        new_wards.append(Ward(
            id=w["code"], zone=zones[prefix], name=name, name_bn=name_bn, sort_order=w["number"],
        ))
    Ward.objects.bulk_create(new_wards, batch_size=1000)
    Ward.objects.bulk_update(renamed, ["name", "name_bn"], batch_size=1000)
    report["wards updated"] = len(renamed)
    report["wards created"] = len(new_wards)
    return report


class Command(BaseCommand):
    help = "Load city corporations, pourashavas, CC wards and districts from the workbook."

    def add_arguments(self, parser):
        parser.add_argument("--path", default=str(DEFAULT_PATH), help="Workbook to read")
        parser.add_argument("--dry-run", action="store_true", help="Report, write nothing")

    def handle(self, *args, path, dry_run, **options):
        source = Path(path)
        if not source.exists():
            raise CommandError(f"{source} not found.")
        data = read_workbook(source)
        with transaction.atomic():
            report = load(data)
            if dry_run:
                transaction.set_rollback(True)
        for key, value in sorted(report.items()):
            self.stdout.write(f"  {key}: {value}")
        self.stdout.write(self.style.SUCCESS("Dry run — nothing written." if dry_run else "Loaded."))
