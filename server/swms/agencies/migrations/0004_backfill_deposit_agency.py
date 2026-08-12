"""Stamp the agency on existing deposits.

Same reasoning as 0003, applied to the other half of the cash trail: a hand-in
belongs to the agency that held the money, and reading it back through the
collector's current employer would move a settled month onto whoever employs
them now.

Exact while one agency exists — every collector belongs to it, so every hand-in
does too. Guarded the same way: if a second agency has already appeared, the
question is no longer answerable from the data and this does nothing rather than
guessing.
"""

from django.db import migrations


def backfill(apps, schema_editor):
    Agency = apps.get_model("agencies", "Agency")
    Collector = apps.get_model("fieldops", "Collector")
    Deposit = apps.get_model("billing", "Deposit")

    if Agency.objects.count() != 1:
        return

    agency = Agency.objects.get()
    employed = list(Collector.objects.filter(agency=agency).values_list("id", flat=True))
    if not employed:
        return

    Deposit.objects.filter(collector_id__in=employed, agency__isnull=True).update(agency=agency)


def clear(apps, schema_editor):
    apps.get_model("billing", "Deposit").objects.update(agency=None)


class Migration(migrations.Migration):

    dependencies = [
        ("agencies", "0003_backfill_stamped_agency"),
        ("billing", "0004_deposit_agency_remittance"),
    ]

    operations = [migrations.RunPython(backfill, clear)]
