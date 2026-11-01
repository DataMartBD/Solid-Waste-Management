"""Floor-by-floor buildings that carry a building charge become "both".

The collection point now decides the charge: floor by floor bills the flats'
own charges, which no existing flat has yet. A floor-by-floor building that
already has a building charge is moved to "both" (building charge + flats), so
its monthly bill stays exactly what it was.
"""

from django.db import migrations


def charged_floor_to_both(apps, schema_editor):
    Holding = apps.get_model("customers", "Holding")
    Holding.objects.filter(collection_point="floor", charge__gt=0).update(collection_point="both")


class Migration(migrations.Migration):

    dependencies = [
        ("customers", "0015_charge_typed_from_tier"),
    ]

    operations = [
        migrations.RunPython(charged_floor_to_both, migrations.RunPython.noop),
    ]
