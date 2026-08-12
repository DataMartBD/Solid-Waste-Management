"""Fill the agency stamp on every existing visit and payment.

Exact, not a guess — and only because it runs while there is one agency: every
collector belongs to it, so every round they walked and every taka they took
belongs to it too. This is the whole reason the stamp is being added *now*
rather than alongside the second agency, when the same question would have no
answer from the data.

The stamp is taken from the collector's current employer rather than from
`agency_on(collector, date)`. Some money in this database predates the earliest
employment record, and asking the dated lookup would return NULL for those rows
— dropping attribution that is not actually in doubt. With one agency the
current employer *is* the historical one.

Rows with no collector keep a NULL agency. A visit nobody is recorded as walking
and a payment taken at the office counter are not any agency's work, and filling
them in would invent a debt.

Reversing clears the columns. Nothing else is touched either way.
"""

from django.db import migrations


def backfill(apps, schema_editor):
    Agency = apps.get_model("agencies", "Agency")
    Visit = apps.get_model("fieldops", "Visit")
    Payment = apps.get_model("billing", "Payment")
    Collector = apps.get_model("fieldops", "Collector")

    if Agency.objects.count() != 1:
        # Zero agencies: a fresh database, nothing to attribute. More than one:
        # the assumption this migration rests on is already gone, and guessing
        # would put one contractor's revenue on another's books.
        return

    agency = Agency.objects.get()
    employed = set(
        Collector.objects.filter(agency=agency).values_list("id", flat=True)
    )
    if not employed:
        return

    Visit.objects.filter(collector_id__in=employed, agency__isnull=True).update(agency=agency)
    Payment.objects.filter(collector_id__in=employed, agency__isnull=True).update(agency=agency)


def clear(apps, schema_editor):
    apps.get_model("fieldops", "Visit").objects.update(agency=None)
    apps.get_model("billing", "Payment").objects.update(agency=None)


class Migration(migrations.Migration):

    dependencies = [
        ("agencies", "0002_backfill_single_agency"),
        ("fieldops", "0005_visit_agency"),
        ("billing", "0003_payment_agency"),
    ]

    operations = [migrations.RunPython(backfill, clear)]
