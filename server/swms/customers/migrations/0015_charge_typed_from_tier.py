"""Write the tier's rate in where a holding relied on it.

The charge is now typed by hand and the tier is only a label, so a holding
whose charge was 0 ("use the tier's standard rate") would stop being billed.
Its amount is written in from its tier, so every holding keeps billing what it
did before. Every existing holding stays building-based.
"""

from django.db import migrations


def fill_from_tier(apps, schema_editor):
    Holding = apps.get_model("customers", "Holding")
    Tier = apps.get_model("catalog", "Tier")
    rates = dict(Tier.objects.values_list("pk", "charge"))
    for holding in Holding.objects.filter(charge=0, tier__isnull=False).only("pk", "tier_id"):
        rate = rates.get(holding.tier_id) or 0
        if rate:
            Holding.objects.filter(pk=holding.pk).update(charge=rate)


class Migration(migrations.Migration):

    dependencies = [
        ("customers", "0014_charge_basis"),
    ]

    operations = [
        migrations.RunPython(fill_from_tier, migrations.RunPython.noop),
    ]
