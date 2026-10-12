"""Collection visits become holding-wise: one visit per holding per day.

The rows were cleared by 0010. Rolling back restores the column, not the rows.
"""

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("customers", "0009_holding_wise_service"),
        ("fieldops", "0010_start_fresh_visits"),
    ]

    operations = [
        migrations.RemoveIndex(model_name="visit", name="visit_househo_87cd87_idx"),
        migrations.RemoveConstraint(model_name="visit", name="visit_one_per_household_per_day"),
        migrations.RemoveField(model_name="visit", name="household"),
        migrations.AddField(
            model_name="visit",
            name="holding",
            field=models.ForeignKey(
                null=True, on_delete=django.db.models.deletion.CASCADE,
                related_name="visits", to="customers.holding",
            ),
        ),
        # The table is empty here, so the column can become required at once.
        migrations.AlterField(
            model_name="visit",
            name="holding",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.CASCADE,
                related_name="visits", to="customers.holding",
            ),
        ),
        migrations.AddIndex(
            model_name="visit",
            index=models.Index(fields=["holding", "-served_on"], name="visit_holding_day_idx"),
        ),
        migrations.AddConstraint(
            model_name="visit",
            constraint=models.UniqueConstraint(
                fields=("holding", "served_on"), name="visit_one_per_holding_per_day"
            ),
        ),
        migrations.AlterField(
            model_name="dailycollectionsummary",
            name="due",
            field=models.PositiveIntegerField(default=0, help_text="Holdings on an active route"),
        ),
    ]
