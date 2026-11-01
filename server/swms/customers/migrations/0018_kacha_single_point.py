"""A kacha house (কাঁচা বাড়ি) is always collected at one place.

Kacha houses marked floor by floor or "both" become a single collection point.
Their customers are kept (and keep showing on record); their bills do not
change, because none of those flats carries a charge of its own.
"""

from django.db import migrations


def kacha_single(apps, schema_editor):
    Holding = apps.get_model("customers", "Holding")
    Holding.objects.filter(holding_type_id="kacha").exclude(collection_point="single").update(
        collection_point="single"
    )


class Migration(migrations.Migration):

    dependencies = [
        ("customers", "0017_collection_point_both"),
    ]

    operations = [
        migrations.RunPython(kacha_single, migrations.RunPython.noop),
    ]
