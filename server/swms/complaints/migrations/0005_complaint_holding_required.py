"""The holding becomes required; the household optional.

Separate from 0004's backfill so the updates commit before the ALTER
(Postgres refuses an ALTER with deferred FK checks pending).
"""

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("complaints", "0004_complaint_holding"),
    ]

    operations = [
        migrations.AlterField(
            model_name="complaint",
            name="holding",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.CASCADE,
                related_name="complaints", to="customers.holding",
            ),
        ),
        migrations.AlterField(
            model_name="complaint",
            name="household",
            field=models.ForeignKey(
                blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL,
                related_name="complaints", to="customers.household",
            ),
        ),
        migrations.RemoveIndex(model_name="complaint", name="complaint_househo_da2545_idx"),
        migrations.AddIndex(
            model_name="complaint",
            index=models.Index(fields=["holding"], name="complaint_holding_idx"),
        ),
    ]
