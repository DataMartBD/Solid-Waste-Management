"""Clear visits and daily summaries before collection goes holding-wise.

Agreed with the client: collection history starts again, one visit per
holding per day. Its own migration so the deletes commit before 0011 alters
the table (Postgres refuses an ALTER with deferred FK checks pending).
Not reversible in data.
"""

from django.db import migrations


def start_fresh(apps, schema_editor):
    apps.get_model("fieldops", "DailyCollectionSummary").objects.all().delete()
    apps.get_model("fieldops", "Visit").objects.all().delete()


class Migration(migrations.Migration):

    dependencies = [
        ("customers", "0009_holding_wise_service"),
        ("fieldops", "0009_auto_collection_day"),
    ]

    operations = [migrations.RunPython(start_fresh, migrations.RunPython.noop)]
