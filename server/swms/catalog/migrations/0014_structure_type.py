"""Building type splits in two: by use and by structure.

By use (ব্যবহার অনুযায়ী) stays `HoldingType`: residential, commercial, mixed.
By structure (অবকাঠামো অনুযায়ী) is the new `StructureType`: kacha, semi-pucca,
tin-shed, multi-storey. "Kacha house" and "Multi-storey building" leave the
by-use list — hidden, not deleted; customers.0020 moves buildings off them.
"""

from django.db import migrations, models

STRUCTURES = [
    ("kacha", "Kacha"),
    ("semi_pucca", "Semi-pucca"),
    ("tin_shed", "Tin-shed"),
    ("multi_storey", "Multi-storey"),
]
USES = ["residential", "commercial", "residential_mixed"]


def seed(apps, schema_editor):
    StructureType = apps.get_model("catalog", "StructureType")
    for order, (pk, label) in enumerate(STRUCTURES):
        StructureType.objects.update_or_create(
            pk=pk,
            defaults={"key": f"opt.structureType.{pk}", "label": label,
                      "sort_order": order, "active": True},
        )
    HoldingType = apps.get_model("catalog", "HoldingType")
    HoldingType.objects.exclude(pk__in=USES).update(active=False)


def unseed(apps, schema_editor):
    HoldingType = apps.get_model("catalog", "HoldingType")
    HoldingType.objects.filter(pk__in=["kacha", "multi_storey"]).update(active=True)


class Migration(migrations.Migration):

    dependencies = [
        ('catalog', '0013_building_type_mixed_label'),
    ]

    operations = [
        migrations.CreateModel(
            name='StructureType',
            fields=[
                ('id', models.CharField(max_length=48, primary_key=True, serialize=False)),
                ('key', models.CharField(max_length=96)),
                ('label', models.CharField(max_length=96)),
                ('sort_order', models.PositiveSmallIntegerField(default=0)),
                ('active', models.BooleanField(default=True)),
            ],
            options={
                'db_table': 'structure_type',
                'ordering': ['sort_order', 'id'],
                'abstract': False,
            },
        ),
        migrations.RunPython(seed, unseed),
    ]
