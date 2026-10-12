"""Put the existing geography and contractors under Khulna City Corporation.

Before cities existed every zone and agency was implicitly KCC's, so on a
database that already has rows the answer is in the data. On an empty database
(a fresh install, the test run) there is nothing to attach and no city is
invented — the seed or an operator creates the first one.
"""

import datetime as dt
from decimal import Decimal

from django.db import migrations


def backfill(apps, schema_editor):
    City = apps.get_model("catalog", "City")
    Zone = apps.get_model("catalog", "Zone")
    Agency = apps.get_model("agencies", "Agency")

    zones = Zone.objects.filter(city__isnull=True)
    agencies = Agency.objects.filter(city__isnull=True)
    if not zones.exists() and not agencies.exists():
        return

    # `city_type` is plain text before catalog.0005 and a link to the setup
    # list after it; this migration may run on either side, so it asks.
    if City._meta.get_field("city_type").is_relation:
        CityType = apps.get_model("catalog", "CityType")
        known = CityType.objects.filter(pk="city_corporation").exists()
        type_field = {"city_type_id": "city_corporation"} if known else {}
    else:
        type_field = {"city_type": "city_corporation"}

    kcc, _ = City.objects.get_or_create(
        id="KCC",
        defaults={
            "name": "Khulna City Corporation",
            "name_bn": "খুলনা সিটি কর্পোরেশন",
            **type_field,
            "district": "Khulna",
            "lat": Decimal("22.845600"),
            "lng": Decimal("89.540300"),
            "collection_cutoff": dt.time(21, 0),
            "complaint_deadline": dt.time(12, 0),
        },
    )
    zones.update(city=kcc)
    agencies.update(city=kcc)


def clear(apps, schema_editor):
    apps.get_model("catalog", "Zone").objects.update(city=None)
    apps.get_model("agencies", "Agency").objects.update(city=None)


class Migration(migrations.Migration):

    dependencies = [
        ("agencies", "0006_agency_city"),
        ("catalog", "0004_city_zone_city"),
    ]

    operations = [migrations.RunPython(backfill, clear)]
