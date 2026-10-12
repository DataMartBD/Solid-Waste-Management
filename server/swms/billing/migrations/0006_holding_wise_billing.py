"""Bills and payments become holding-wise.

The rows were cleared by 0005, so the new columns can be required at once.
Rolling back restores the columns, not the rows.
"""

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("billing", "0005_start_fresh"),
    ]

    operations = [
        migrations.RemoveIndex(model_name="bill", name="bill_househo_8eb1d5_idx"),
        migrations.RemoveConstraint(model_name="bill", name="bill_one_per_household_per_period"),
        migrations.RemoveIndex(model_name="payment", name="payment_househo_239402_idx"),
        migrations.RemoveField(model_name="bill", name="household"),
        migrations.RemoveField(model_name="payment", name="household"),
        migrations.AddField(
            model_name="bill",
            name="holding",
            field=models.ForeignKey(
                null=True, on_delete=django.db.models.deletion.CASCADE,
                related_name="bills", to="customers.holding",
            ),
        ),
        migrations.AddField(
            model_name="payment",
            name="holding",
            field=models.ForeignKey(
                null=True, on_delete=django.db.models.deletion.CASCADE,
                related_name="payments", to="customers.holding",
            ),
        ),
        # Both tables are empty here, so the columns can become required at once.
        migrations.AlterField(
            model_name="bill",
            name="holding",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.CASCADE,
                related_name="bills", to="customers.holding",
            ),
        ),
        migrations.AlterField(
            model_name="payment",
            name="holding",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.CASCADE,
                related_name="payments", to="customers.holding",
            ),
        ),
        migrations.AlterModelOptions(
            name="bill",
            options={"ordering": ["-period", "holding_id"]},
        ),
        migrations.AddIndex(
            model_name="bill",
            index=models.Index(fields=["holding", "-period"], name="bill_holding_period_idx"),
        ),
        migrations.AddConstraint(
            model_name="bill",
            constraint=models.UniqueConstraint(
                fields=("holding", "period"), name="bill_one_per_holding_per_period"
            ),
        ),
        migrations.AddIndex(
            model_name="payment",
            index=models.Index(fields=["holding", "-at"], name="payment_holding_at_idx"),
        ),
    ]
