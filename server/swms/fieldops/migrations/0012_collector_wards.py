"""A collector serves several wards of one city; `ward` stays the home ward.

Existing collectors start out serving their home ward.
"""

from django.db import migrations, models


def copy_home_ward(apps, schema_editor):
    Collector = apps.get_model("fieldops", "Collector")
    Through = Collector.wards.through
    Through.objects.bulk_create(
        [Through(collector_id=c.id, ward_id=c.ward_id) for c in Collector.objects.all()],
        ignore_conflicts=True,
    )


class Migration(migrations.Migration):

    dependencies = [
        ("catalog", "0014_structure_type"),
        ("fieldops", "0011_holding_wise_visits"),
    ]

    operations = [
        migrations.AddField(
            model_name="collector",
            name="wards",
            field=models.ManyToManyField(
                blank=True, related_name="served_by_collectors", to="catalog.ward"
            ),
        ),
        migrations.RunPython(copy_home_ward, migrations.RunPython.noop),
    ]
