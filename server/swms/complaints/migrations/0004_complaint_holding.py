"""A complaint names a holding; the household becomes optional.

Existing complaints are kept: each takes the holding its household lives in,
and keeps the household as the optional "who reported it".
"""

import django.db.models.deletion
from django.db import migrations, models


def backfill(apps, schema_editor):
    Complaint = apps.get_model("complaints", "Complaint")
    for complaint in Complaint.objects.select_related("household"):
        complaint.holding_id = complaint.household.holding_id
        complaint.save(update_fields=["holding"])


def restore(apps, schema_editor):
    Complaint = apps.get_model("complaints", "Complaint")
    # Rolling back makes the household required again; a complaint lodged
    # against a holding with no household cannot survive that.
    Complaint.objects.filter(household__isnull=True).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("complaints", "0003_complaint_missed_on"),
        ("customers", "0009_holding_wise_service"),
    ]

    operations = [
        migrations.AddField(
            model_name="complaint",
            name="holding",
            field=models.ForeignKey(
                null=True, on_delete=django.db.models.deletion.CASCADE,
                related_name="complaints", to="customers.holding",
            ),
        ),
        migrations.RunPython(backfill, restore),
    ]
