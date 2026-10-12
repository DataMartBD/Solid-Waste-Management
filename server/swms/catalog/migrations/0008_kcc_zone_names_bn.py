"""Bangla names for Khulna City Corporation's three zones.

Matched on id *and* English name, and written only where the Bangla name is
still empty, so a zone renamed or already translated from the Setup page is
left exactly as it is.
"""

from django.db import migrations

KCC_ZONES = {
    ("Z-02", "Daulatpur"): "দৌলতপুর",
    ("Z-03", "Sonadanga"): "সোনাডাঙ্গা",
    ("Z-05", "Khalishpur"): "খালিশপুর",
}


def fill(apps, schema_editor):
    Zone = apps.get_model("catalog", "Zone")
    for (zone_id, name), name_bn in KCC_ZONES.items():
        Zone.objects.filter(pk=zone_id, name=name, name_bn="").update(name_bn=name_bn)


class Migration(migrations.Migration):

    dependencies = [
        ("catalog", "0007_zone_name_bn"),
    ]

    operations = [migrations.RunPython(fill, migrations.RunPython.noop)]
