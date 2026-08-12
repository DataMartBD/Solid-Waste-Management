"""Attach existing routes to the one agency.

A route used to be identified by its ward alone. That was enough while one
contractor worked each ward; with two, "the KDA Avenue round" is two different
rounds and the route needs to say whose it is.

Exact while one agency exists, and guarded the same way as the earlier
back-fills: with a second agency already present the answer is no longer in the
data, so this does nothing rather than guessing.
"""

from django.db import migrations


def backfill(apps, schema_editor):
    Agency = apps.get_model("agencies", "Agency")
    Route = apps.get_model("fieldops", "Route")

    if Agency.objects.count() != 1:
        return
    Route.objects.filter(agency__isnull=True).update(agency=Agency.objects.get())


def clear(apps, schema_editor):
    apps.get_model("fieldops", "Route").objects.update(agency=None)


class Migration(migrations.Migration):

    dependencies = [
        ("agencies", "0004_backfill_deposit_agency"),
        ("fieldops", "0006_route_agency"),
    ]

    operations = [migrations.RunPython(backfill, clear)]
