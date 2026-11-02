"""The client asked for "Residential mixed" (আবাসিক মিশ্র) to read just "Mixed" (মিশ্র).

Only the label changes; the id `residential_mixed` stays, so buildings already
registered with it keep their type.
"""

from django.db import migrations


def relabel(apps, schema_editor):
    HoldingType = apps.get_model("catalog", "HoldingType")
    HoldingType.objects.filter(pk="residential_mixed").update(label="Mixed")


def restore(apps, schema_editor):
    HoldingType = apps.get_model("catalog", "HoldingType")
    HoldingType.objects.filter(pk="residential_mixed").update(label="Residential mixed")


class Migration(migrations.Migration):

    dependencies = [
        ("catalog", "0012_building_types_feedback"),
    ]

    operations = [
        migrations.RunPython(relabel, restore),
    ]
