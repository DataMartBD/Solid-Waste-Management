"""Load the national geography table from `geo_locations.json`.

The file is the published division → district → upazila → union list, 4,537
rows, one per union. It carries a `business_id_id` column that means nothing
here — it is a foreign key out of the system it was exported from — and that
column is dropped rather than stored.

Idempotent: the table is keyed on the four names, so re-running inserts only
what is missing. That matters because this is reference data loaded once per
deployment and then again whenever the file is refreshed, and the second run
must not double it.

    python manage.py load_geo_locations
    python manage.py load_geo_locations --path /some/other/geo.json --dry-run
"""

from __future__ import annotations

import json
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from swms.catalog.models import GeoLocation

#: Source column -> model field. `business_id_id` is absent on purpose.
COLUMNS = {
    "division_name": "division_name",
    "division_bn": "division_bn",
    "district_name": "district_name",
    "district_bn": "district_bn",
    "upazila_name": "upazila_name",
    "upazila_bn": "upazila_bn",
    "union_name": "union_name",
    "union_bn": "union_bn",
}

#: Where the file sits when nobody says otherwise: the repository root, one
#: level above the Django project.
DEFAULT_PATH = Path(settings.BASE_DIR).parent / "geo_locations.json"


def key_of(row: dict) -> tuple:
    return (
        row["division_name"],
        row["district_name"],
        row["upazila_name"],
        row["union_name"],
    )


class Command(BaseCommand):
    help = "Load division/district/upazila/union rows from geo_locations.json."

    def add_arguments(self, parser):
        parser.add_argument("--path", default=str(DEFAULT_PATH), help="JSON file to read")
        parser.add_argument(
            "--dry-run", action="store_true", help="Report what would be inserted, write nothing"
        )

    def handle(self, *args, **options):
        path = Path(options["path"])
        if not path.exists():
            raise CommandError(f"No such file: {path}")

        try:
            rows = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            raise CommandError(f"{path} is not valid JSON: {exc}") from exc
        if not isinstance(rows, list):
            raise CommandError(f"{path} should hold a list of rows, found {type(rows).__name__}.")

        # A row missing a name would land in the table as an empty dropdown
        # entry, so it is refused here rather than shown to an operator.
        cleaned: dict[tuple, dict] = {}
        for index, row in enumerate(rows, start=1):
            missing = [source for source in COLUMNS if not str(row.get(source, "")).strip()]
            if missing:
                raise CommandError(f"Row {index} is missing {', '.join(missing)}.")
            values = {field: str(row[source]).strip() for source, field in COLUMNS.items()}
            # The file itself may repeat a union; the table may not.
            cleaned[key_of(values)] = values

        existing = set(
            GeoLocation.objects.values_list(
                "division_name", "district_name", "upazila_name", "union_name"
            )
        )
        fresh = [values for key, values in cleaned.items() if key not in existing]

        districts = len({(v["division_name"], v["district_name"]) for v in cleaned.values()})
        upazilas = len({(v["district_name"], v["upazila_name"]) for v in cleaned.values()})

        if options["dry_run"]:
            self.stdout.write(
                f"{len(cleaned)} union(s) in {path.name}: "
                f"{len(fresh)} new, {len(cleaned) - len(fresh)} already loaded."
            )
            return

        with transaction.atomic():
            GeoLocation.objects.bulk_create(
                [GeoLocation(**values) for values in fresh], batch_size=1000
            )

        self.stdout.write(
            self.style.SUCCESS(
                f"Geography loaded: {len(fresh)} union(s) added, "
                f"{len(cleaned) - len(fresh)} already present. "
                f"{districts} district(s), {upazilas} thana/upazila(s) now selectable."
            )
        )
