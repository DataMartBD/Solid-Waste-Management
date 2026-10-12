"""Service charge moves from the household to the holding.

Everything is done by building now: one charge, one bill, one visit, one QR
tag per holding. The household keeps only who lives there.

The holding takes its terms from the households it had:

* tier and payment mode/day from the first active household (the most common
  tier, when they differ);
* charge: a single household's agreed charge as it was (0 still meaning "the
  tier's standard"); for several households, the sum of what each was paying,
  so the building is not suddenly charged for one flat.

Dues start at zero: bills and payments are cleared and start fresh holding-wise
(billing.0005).
"""

from collections import Counter

import django.core.validators
import django.db.models.deletion
from django.db import migrations, models


def qr_tag(holding_pk):
    """Frozen copy of swms.common.ids.qr_tag — migrations must not import app code."""
    return "SS-" + holding_pk.replace("-", "")[-6:].upper()


def copy_service(apps, schema_editor):
    Holding = apps.get_model("customers", "Holding")
    Household = apps.get_model("customers", "Household")
    Tier = apps.get_model("catalog", "Tier")
    tier_charge = dict(Tier.objects.values_list("id", "charge"))

    for holding in Holding.objects.all():
        families = list(Household.objects.filter(holding=holding).order_by("unit", "id"))
        active = [h for h in families if h.status == "active"] or families
        holding.qr = qr_tag(holding.id)
        if active:
            first = active[0]
            holding.tier_id = Counter(h.tier_id for h in active).most_common(1)[0][0]
            holding.payment_mode_id = first.payment_mode_id
            holding.payment_day = first.payment_day
            if len(active) == 1:
                holding.charge = first.charge
            else:
                holding.charge = sum(
                    h.charge if h.charge else tier_charge.get(h.tier_id, 0) for h in active
                )
        holding.dues = 0
        holding.save(
            update_fields=["qr", "tier", "payment_mode", "payment_day", "charge", "dues"]
        )


class Migration(migrations.Migration):

    dependencies = [
        ("catalog", "0001_initial"),
        ("customers", "0008_holding_district_holding_thana"),
    ]

    operations = [
        migrations.AddField(
            model_name="holding",
            name="qr",
            field=models.CharField(
                blank=True, help_text="QR tag fixed at the building, e.g. SS-000123",
                max_length=24, null=True, unique=True,
            ),
        ),
        migrations.AddField(
            model_name="holding",
            name="tier",
            field=models.ForeignKey(
                blank=True, null=True, on_delete=django.db.models.deletion.PROTECT,
                related_name="holdings", to="catalog.tier",
            ),
        ),
        migrations.AddField(
            model_name="holding",
            name="charge",
            field=models.PositiveIntegerField(default=0),
        ),
        migrations.AddField(
            model_name="holding",
            name="payment_mode",
            field=models.ForeignKey(
                blank=True, null=True, on_delete=django.db.models.deletion.PROTECT,
                related_name="+", to="catalog.paymentmode",
            ),
        ),
        migrations.AddField(
            model_name="holding",
            name="payment_day",
            field=models.PositiveSmallIntegerField(
                default=5,
                validators=[
                    django.core.validators.MinValueValidator(1),
                    django.core.validators.MaxValueValidator(28),
                ],
            ),
        ),
        migrations.AddField(
            model_name="holding",
            name="dues",
            field=models.IntegerField(default=0),
        ),
        migrations.RunPython(copy_service, migrations.RunPython.noop),
        migrations.RemoveIndex(model_name="household", name="household_qr_cef95b_idx"),
        migrations.RemoveField(model_name="household", name="qr"),
        migrations.RemoveField(model_name="household", name="tier"),
        migrations.RemoveField(model_name="household", name="charge"),
        migrations.RemoveField(model_name="household", name="payment_mode"),
        migrations.RemoveField(model_name="household", name="payment_day"),
        migrations.RemoveField(model_name="household", name="dues"),
    ]
