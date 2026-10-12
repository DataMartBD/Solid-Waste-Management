"""Agency type now comes from the setup list in `catalog.AgencyType`.

Existing values are copied across unchanged (the setup rows reuse the old
slugs). An agency whose name says it is the city's in-house service — before
this list existed it could only be filed as "private" — becomes the matching
in-house type: City Corporation, or Pourashova for a pourashova.
"""

import django.db.models.deletion
from django.db import migrations, models


LABELS = {
    "private": "Private company",
    "ngo": "NGO",
    "cbo": "Community-based organisation",
    "cooperative": "Cooperative",
    "city_corporation": "City Corporation (in-house)",
    "pourashova": "Pourashova / Municipality (in-house)",
}


def copy_type(apps, schema_editor):
    Agency = apps.get_model("agencies", "Agency")
    AgencyType = apps.get_model("catalog", "AgencyType")
    for agency in Agency.objects.select_related("city", "city__city_type"):
        slug = agency.agency_type_old or "private"
        if "in-house" in agency.name.lower():
            city_type = getattr(getattr(agency.city, "city_type", None), "id", None)
            slug = "pourashova" if city_type == "pourashova" else "city_corporation"
        # catalog.0005 loads these, but a missing one is recreated rather than
        # leaving the link dangling.
        AgencyType.objects.get_or_create(
            id=slug, defaults={"key": f"opt.agencyType.{slug}", "label": LABELS.get(slug, slug)}
        )
        agency.agency_type_id = slug
        agency.save(update_fields=["agency_type"])


def restore_type(apps, schema_editor):
    Agency = apps.get_model("agencies", "Agency")
    legacy = {"private", "ngo", "cbo", "cooperative"}
    for agency in Agency.objects.all():
        slug = agency.agency_type_id
        agency.agency_type_old = slug if slug in legacy else "private"
        agency.save(update_fields=["agency_type_old"])


class Migration(migrations.Migration):

    dependencies = [
        ("agencies", "0007_backfill_kcc_city"),
        ("catalog", "0005_city_and_agency_types"),
    ]

    operations = [
        migrations.RenameField("agency", "agency_type", "agency_type_old"),
        migrations.AddField(
            model_name="agency",
            name="agency_type",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="agencies",
                to="catalog.agencytype",
            ),
        ),
        migrations.RunPython(copy_type, restore_type),
        migrations.RemoveField("agency", "agency_type_old"),
    ]
