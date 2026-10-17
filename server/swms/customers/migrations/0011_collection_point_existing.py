"""Existing buildings that already have customers are collected floor by floor.

New buildings default to a single collection point, where flats are not
registered. A building whose flats were registered before the choice existed
keeps them, so it is marked floor by floor; the rest stay single point.
"""

from django.db import migrations


def mark_floor_by_floor(apps, schema_editor):
    Holding = apps.get_model("customers", "Holding")
    Holding.objects.filter(households__isnull=False).distinct().update(collection_point="floor")


class Migration(migrations.Migration):

    dependencies = [
        ("customers", "0010_holding_feedback_fields"),
    ]

    operations = [
        migrations.RunPython(mark_floor_by_floor, migrations.RunPython.noop),
    ]
