"""An agency works for several city corporations / pourashovas of one district.

`city` stays the main one. Existing agencies start out with their own city.
"""

from django.db import migrations, models


def copy_city(apps, schema_editor):
    Agency = apps.get_model("agencies", "Agency")
    Through = Agency.cities.through
    Through.objects.bulk_create(
        [Through(agency_id=a.id, city_id=a.city_id)
         for a in Agency.objects.exclude(city__isnull=True)],
        ignore_conflicts=True,
    )


class Migration(migrations.Migration):

    dependencies = [
        ("catalog", "0014_structure_type"),
        ("agencies", "0009_agency_name_bn"),
    ]

    operations = [
        migrations.AddField(
            model_name="agency",
            name="cities",
            field=models.ManyToManyField(
                blank=True, related_name="served_by_agencies", to="catalog.city"
            ),
        ),
        migrations.RunPython(copy_city, migrations.RunPython.noop),
    ]
