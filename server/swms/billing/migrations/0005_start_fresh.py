"""Clear bills, payments, billing runs and deposits before billing goes holding-wise.

Agreed with the client: billing starts again with one bill per holding per
month. Remittances (an agency's bank transfer to the corporation) are kept.

Its own migration, so the deletes commit before 0006 alters these tables —
Postgres will not ALTER a table with deferred foreign-key checks still pending
from rows changed in the same transaction. Not reversible in data.
"""

from django.db import migrations


def start_fresh(apps, schema_editor):
    for name in ("Payment", "Bill", "BillingRun", "Deposit"):
        apps.get_model("billing", name).objects.all().delete()


class Migration(migrations.Migration):

    dependencies = [
        ("billing", "0004_deposit_agency_remittance"),
        ("customers", "0009_holding_wise_service"),
    ]

    operations = [migrations.RunPython(start_fresh, migrations.RunPython.noop)]
