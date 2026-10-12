"""City and agency types become setup lists instead of fixed choices.

The values that were hard-coded are loaded as rows, with the same ids, so
every existing city keeps its type. Agency types live here too, beside the
other setup lists; `agencies.0008` moves agencies onto them.
"""

import django.db.models.deletion
from django.db import migrations, models

CITY_TYPES = [
    ("city_corporation", "City Corporation"),
    ("pourashova", "Pourashova / Municipality"),
]

AGENCY_TYPES = [
    ("private", "Private company"),
    ("ngo", "NGO"),
    ("cbo", "Community-based organisation"),
    ("cooperative", "Cooperative"),
    ("city_corporation", "City Corporation (in-house)"),
    ("pourashova", "Pourashova / Municipality (in-house)"),
]


def load_types(apps, schema_editor):
    for model_name, prefix, rows in (
        ("CityType", "opt.cityType", CITY_TYPES),
        ("AgencyType", "opt.agencyType", AGENCY_TYPES),
    ):
        model = apps.get_model("catalog", model_name)
        for order, (slug, label) in enumerate(rows):
            model.objects.get_or_create(
                id=slug, defaults={"key": f"{prefix}.{slug}", "label": label, "sort_order": order}
            )


def copy_city_type(apps, schema_editor):
    City = apps.get_model("catalog", "City")
    CityType = apps.get_model("catalog", "CityType")
    labels = dict(CITY_TYPES)
    for city in City.objects.all():
        slug = city.city_type_old or "city_corporation"
        # Loaded above, but recreated if missing so the link can never dangle.
        CityType.objects.get_or_create(
            id=slug, defaults={"key": f"opt.cityType.{slug}", "label": labels.get(slug, slug)}
        )
        city.city_type_id = slug
        city.save(update_fields=["city_type"])


def restore_city_type(apps, schema_editor):
    City = apps.get_model("catalog", "City")
    for city in City.objects.all():
        city.city_type_old = city.city_type_id or "city_corporation"
        city.save(update_fields=["city_type_old"])


class Migration(migrations.Migration):

    dependencies = [
        ("catalog", "0004_city_zone_city"),
    ]

    operations = [
        migrations.CreateModel(
            name="CityType",
            fields=[
                ("id", models.CharField(max_length=48, primary_key=True, serialize=False)),
                ("key", models.CharField(max_length=96)),
                ("label", models.CharField(max_length=96)),
                ("sort_order", models.PositiveSmallIntegerField(default=0)),
                ("active", models.BooleanField(default=True)),
            ],
            options={"db_table": "city_type", "ordering": ["sort_order", "id"], "abstract": False},
        ),
        migrations.CreateModel(
            name="AgencyType",
            fields=[
                ("id", models.CharField(max_length=48, primary_key=True, serialize=False)),
                ("key", models.CharField(max_length=96)),
                ("label", models.CharField(max_length=96)),
                ("sort_order", models.PositiveSmallIntegerField(default=0)),
                ("active", models.BooleanField(default=True)),
            ],
            options={"db_table": "agency_type", "ordering": ["sort_order", "id"], "abstract": False},
        ),
        migrations.RunPython(load_types, migrations.RunPython.noop),
        migrations.RenameField("city", "city_type", "city_type_old"),
        migrations.AddField(
            model_name="city",
            name="city_type",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="cities",
                to="catalog.citytype",
            ),
        ),
        migrations.RunPython(copy_city_type, restore_city_type),
        migrations.RemoveField("city", "city_type_old"),
    ]
