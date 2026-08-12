"""Introduce `Holding` — the building — above `Household`.

Written by hand rather than generated, for two reasons:

* The old `Household.holding` column holds real holding numbers ("142/B"). An
  autodetected rename is offered as an interactive question, and answering it
  wrong turns into DROP + ADD, silently emptying the column. `RenameField` makes
  the intent explicit and keeps the data.
* The `holding` foreign key ends up NOT NULL, which cannot be added to populated
  tables in one step. This migration adds it nullable; 0004 fills it in; 0005
  tightens it.

The old unique constraint on (ward, road, holding) is dropped here because it
encodes the assumption this whole change exists to remove: that one address is
one household. The replacement — unique (holding, unit) — is added in 0005,
once every row has a holding to be unique within.
"""

from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("catalog", "0001_initial"),
        ("fieldops", "0001_initial"),
        ("customers", "0002_initial"),
        ("accounts", "0001_initial"),
    ]

    operations = [
        migrations.CreateModel(
            name="Holding",
            fields=[
                ("created_at", models.DateTimeField(auto_now_add=True, db_index=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("id", models.CharField(editable=False, max_length=32, primary_key=True, serialize=False)),
                ("holding_no", models.CharField(help_text="Holding number, e.g. 142/B", max_length=24)),
                ("owner_name", models.CharField(max_length=120)),
                ("owner_phone", models.CharField(blank=True, max_length=20)),
                ("owner_alt_phone", models.CharField(blank=True, max_length=20)),
                ("owner_email", models.EmailField(blank=True, max_length=254)),
                ("address", models.CharField(blank=True, max_length=200)),
                ("floors", models.PositiveSmallIntegerField(blank=True, null=True)),
                ("units_total", models.PositiveSmallIntegerField(blank=True, help_text="Flats in the building, as declared at survey", null=True)),
                ("lat", models.DecimalField(blank=True, decimal_places=6, max_digits=9, null=True)),
                ("lng", models.DecimalField(blank=True, decimal_places=6, max_digits=9, null=True)),
                ("accuracy", models.PositiveSmallIntegerField(blank=True, help_text="GPS accuracy in metres", null=True)),
                ("verified", models.BooleanField(default=False)),
                ("verified_at", models.DateTimeField(blank=True, null=True)),
                ("placed_by_hand", models.BooleanField(default=False, help_text="Pin dropped manually rather than captured from GPS")),
                ("status", models.CharField(choices=[("active", "Active"), ("inactive", "Inactive")], default="active", max_length=10)),
                ("notes", models.TextField(blank=True)),
                ("holding_type", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="holdings", to="catalog.holdingtype")),
                ("road", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="holdings", to="catalog.road")),
                ("ward", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="holdings", to="catalog.ward")),
                ("verified_by", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="+", to="fieldops.collector")),
                ("verified_by_user", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="+", to="accounts.user")),
            ],
            options={
                "db_table": "holding",
                "ordering": ["ward_id", "road_id", "holding_no"],
            },
        ),
        migrations.AddIndex(
            model_name="holding",
            index=models.Index(fields=["ward", "status"], name="holding_ward_status_idx"),
        ),
        migrations.AddIndex(
            model_name="holding",
            index=models.Index(fields=["verified"], name="holding_verified_idx"),
        ),
        migrations.AddConstraint(
            model_name="holding",
            constraint=models.UniqueConstraint(
                fields=("ward", "road", "holding_no"), name="holding_unique_address"
            ),
        ),
        # --- the address column becomes a mirror ---------------------------- #
        migrations.RemoveConstraint(
            model_name="household",
            name="household_unique_address",
        ),
        migrations.RenameField(
            model_name="household",
            old_name="holding",
            new_name="holding_no",
        ),
        migrations.RenameField(
            model_name="potentialcustomer",
            old_name="holding",
            new_name="holding_no",
        ),
        # --- nullable for now; 0004 fills it, 0005 tightens it -------------- #
        migrations.AddField(
            model_name="household",
            name="holding",
            field=models.ForeignKey(null=True, on_delete=django.db.models.deletion.PROTECT, related_name="households", to="customers.holding"),
        ),
        migrations.AddField(
            model_name="potentialcustomer",
            name="holding",
            field=models.ForeignKey(null=True, on_delete=django.db.models.deletion.PROTECT, related_name="surveys", to="customers.holding"),
        ),
        migrations.AddField(
            model_name="household",
            name="unit",
            field=models.CharField(blank=True, help_text="Flat or unit within the holding, e.g. 3B. Blank for a single-family holding.", max_length=24),
        ),
        migrations.AddField(
            model_name="potentialcustomer",
            name="unit",
            field=models.CharField(blank=True, max_length=24),
        ),
    ]