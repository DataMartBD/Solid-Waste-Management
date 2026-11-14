"""A holding gets a building type by structure (অবকাঠামো অনুযায়ী).

Buildings typed "Kacha house" or "Multi-storey building" — which were a
structure, not a use — move that into `structure_type` and become Residential
by use. Their households, which copied the building's type, follow.
"""

from django.db import migrations

MOVED = ["kacha", "multi_storey"]


def move_structures(apps, schema_editor):
    Holding = apps.get_model("customers", "Holding")
    Household = apps.get_model("customers", "Household")
    HoldingType = apps.get_model("catalog", "HoldingType")
    residential = HoldingType.objects.filter(pk="residential").first()
    for pk in MOVED:
        Holding.objects.filter(holding_type_id=pk).update(
            structure_type_id=pk, holding_type=residential
        )
        Household.objects.filter(holding_type_id=pk).update(holding_type=residential)


def restore_structures(apps, schema_editor):
    Holding = apps.get_model("customers", "Holding")
    for pk in MOVED:
        Holding.objects.filter(structure_type_id=pk).update(holding_type_id=pk)


class Migration(migrations.Migration):

    dependencies = [
        ("customers", "0020_holding_structure_type"),
    ]

    operations = [
        migrations.RunPython(move_structures, restore_structures),
    ]
