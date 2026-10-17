"""Customer types the client asked for: Family / Hotel / Residence / Office.

They go to the top of the list; the existing types are kept after them, so
records that use them are unaffected. The list stays editable in setup.
"""

from django.db import migrations

NEW = [
    ("family", "Family"),
    ("hotel", "Hotel"),
    ("residence", "Residence"),
    ("office", "Office"),
]


def add_types(apps, schema_editor):
    CustomerType = apps.get_model("catalog", "CustomerType")
    for row in CustomerType.objects.exclude(pk__in=[pk for pk, _ in NEW]):
        row.sort_order = row.sort_order + len(NEW)
        row.save(update_fields=["sort_order"])
    for order, (pk, label) in enumerate(NEW):
        CustomerType.objects.update_or_create(
            pk=pk,
            defaults={"key": f"opt.customerType.{pk}", "label": label, "sort_order": order, "active": True},
        )


class Migration(migrations.Migration):

    dependencies = [
        ("catalog", "0010_dumpingpoint"),
    ]

    operations = [
        migrations.RunPython(add_types, migrations.RunPython.noop),
    ]
