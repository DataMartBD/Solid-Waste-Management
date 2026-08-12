"""Make the holding link mandatory, now that every row has one.

This is the migration that enforces your rule: a household cannot exist without
the building it sits in. It runs only after 0004 has given every existing row a
holding, so it cannot fail on live data.

The new unique constraint is (holding, unit) rather than the old
(ward, road, holding_no). Postgres treats '' as an ordinary value — unlike NULL,
which is distinct from every other NULL — so a blank `unit` participates in the
constraint normally, and "only one unnumbered household per holding" is enforced
without a second rule.
"""

from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("customers", "0004_backfill_holdings"),
    ]

    operations = [
        migrations.AlterField(
            model_name="household",
            name="holding",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT,
                related_name="households",
                to="customers.holding",
            ),
        ),
        migrations.AlterField(
            model_name="potentialcustomer",
            name="holding",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT,
                related_name="surveys",
                to="customers.holding",
            ),
        ),
        migrations.AddIndex(
            model_name="household",
            index=models.Index(fields=["holding"], name="household_holding_idx"),
        ),
        migrations.AddIndex(
            model_name="potentialcustomer",
            index=models.Index(fields=["holding"], name="potential_holding_idx"),
        ),
        migrations.AddConstraint(
            model_name="household",
            constraint=models.UniqueConstraint(
                fields=("holding", "unit"), name="household_unique_unit"
            ),
        ),
        migrations.AlterModelOptions(
            name="household",
            options={"ordering": ["ward_id", "road_id", "holding_no", "unit"]},
        ),
    ]