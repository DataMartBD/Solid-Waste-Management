"""Building types the client asked for.

আবাসিক (residential), বাণিজ্যিক (commercial), কাঁচা বাড়ি (kacha house),
বহুতল ভবন (multi-storey building) and আবাসিক মিশ্র (residential mixed).

The older types are hidden from the dropdowns (active = False), not deleted:
buildings registered with them keep their type, and the editor still shows it.
"""

from django.db import migrations

NEW = [
    ("residential", "Residential"),
    ("commercial", "Commercial"),
    ("kacha", "Kacha house"),
    ("multi_storey", "Multi-storey building"),
    ("residential_mixed", "Residential mixed"),
]


def set_types(apps, schema_editor):
    HoldingType = apps.get_model("catalog", "HoldingType")
    keep = [pk for pk, _ in NEW]
    HoldingType.objects.exclude(pk__in=keep).update(active=False)
    for order, (pk, label) in enumerate(NEW):
        HoldingType.objects.update_or_create(
            pk=pk,
            defaults={"key": f"opt.holdingType.{pk}", "label": label, "sort_order": order, "active": True},
        )


class Migration(migrations.Migration):

    dependencies = [
        ("catalog", "0011_customer_types_feedback"),
    ]

    operations = [
        migrations.RunPython(set_types, migrations.RunPython.noop),
    ]
