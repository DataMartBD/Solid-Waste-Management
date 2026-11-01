"""Move buildings off the old building types onto the five offered today.

    single_storey → residential (আবাসিক)
    apartment     → multi_storey (বহুতল ভবন)
    tin_shed      → kacha (কাঁচা বাড়ি)
    shop, office  → commercial (বাণিজ্যিক)

Holdings, their customers and surveyed potential customers are all moved, so
nothing still points at a type that is no longer offered. The old type rows
stay (hidden) — deleting them is not needed and could not be undone.
"""

from django.db import migrations

MAPPING = {
    "single_storey": "residential",
    "apartment": "multi_storey",
    "tin_shed": "kacha",
    "shop": "commercial",
    "office": "commercial",
}


def remap(apps, schema_editor):
    HoldingType = apps.get_model("catalog", "HoldingType")
    present = set(HoldingType.objects.values_list("pk", flat=True))
    for model_name in ("Holding", "Household", "PotentialCustomer"):
        model = apps.get_model("customers", model_name)
        for old, new in MAPPING.items():
            if new in present:
                model.objects.filter(holding_type_id=old).update(holding_type_id=new)


class Migration(migrations.Migration):

    dependencies = [
        ("customers", "0012_customer_occupancy"),
        ("catalog", "0012_building_types_feedback"),
    ]

    operations = [
        migrations.RunPython(remap, migrations.RunPython.noop),
    ]
