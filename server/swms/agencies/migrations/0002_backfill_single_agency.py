"""Create the one agency that exists today and attach everything to it.

This back-fill is *exact* rather than a best guess, and only because it runs
while there is exactly one service provider: every collector, holding, van and
non-KCC user necessarily belongs to it. Running the same step after a second
agency is onboarded would mean guessing, and a wrong guess there is a data leak
between competitors rather than a wrong number on a screen.

Nothing changes behaviour. The columns being filled restrict nothing — access
is still governed entirely by ward — so this migration is observable only as
rows gaining an agency id.

Users are deliberately left alone. There is no way to tell from the data whether
an account belongs to the contractor or to KCC, and guessing wrong would assign
a city corporation officer to a contractor. They are set by hand afterwards.

Reversing detaches everything and deletes the agency, restoring the previous
state exactly.
"""

from django.db import migrations

AGENCY_ID = "AGN-KCC-0001"
AGENCY_NAME = "Khulna City Corporation — in-house"
AGENCY_CODE = "KCC"


def backfill(apps, schema_editor):
    Agency = apps.get_model("agencies", "Agency")
    CollectorEmployment = apps.get_model("agencies", "CollectorEmployment")
    Collector = apps.get_model("fieldops", "Collector")
    Holding = apps.get_model("customers", "Holding")
    Van = apps.get_model("fleet", "Van")
    IdSequence = apps.get_model("common", "IdSequence")

    if not (Collector.objects.exists() or Holding.objects.exists()):
        return  # fresh database — the seed creates its own agency

    agency = Agency.objects.create(
        id=AGENCY_ID,
        name=AGENCY_NAME,
        short_code=AGENCY_CODE,
        agency_type="private",
        status="active",
        active=True,
        notes=(
            "Created automatically when agencies were introduced. Every existing "
            "collector, holding and van was attached to it. Rename it, or split "
            "the work across real agencies, before onboarding a second provider."
        ),
    )

    Holding.objects.filter(agency__isnull=True).update(agency=agency)
    Van.objects.filter(agency__isnull=True).update(agency=agency)
    Collector.objects.filter(agency__isnull=True).update(agency=agency)

    # Employment history has to start somewhere. `joined` is the honest date
    # where we have it; otherwise the collector's own creation date. Inventing
    # an earlier one would claim service that was never recorded.
    CollectorEmployment.objects.bulk_create(
        [
            CollectorEmployment(
                collector=collector,
                agency=agency,
                from_date=collector.joined or collector.created_at.date(),
                note="Opening record, created when agencies were introduced.",
            )
            for collector in Collector.objects.all()
        ],
        batch_size=500,
    )

    # Keep the id sequence past what was handed out here, or the next agency
    # created through the UI collides with this one on the primary key.
    row, created = IdSequence.objects.get_or_create(key="agency", defaults={"last_value": 1})
    if not created and row.last_value < 1:
        row.last_value = 1
        row.save(update_fields=["last_value"])


def unlink(apps, schema_editor):
    Agency = apps.get_model("agencies", "Agency")
    CollectorEmployment = apps.get_model("agencies", "CollectorEmployment")
    Collector = apps.get_model("fieldops", "Collector")
    Holding = apps.get_model("customers", "Holding")
    Van = apps.get_model("fleet", "Van")
    User = apps.get_model("accounts", "User")

    CollectorEmployment.objects.all().delete()
    for model in (Holding, Van, Collector, User):
        model.objects.filter(agency__isnull=False).update(agency=None)
    Agency.objects.all().delete()


class Migration(migrations.Migration):

    dependencies = [
        ("agencies", "0001_initial"),
        ("accounts", "0003_user_agency"),
        ("customers", "0007_holding_agency"),
        ("fieldops", "0004_collector_agency"),
        ("fleet", "0002_van_agency"),
        ("common", "0001_initial"),
    ]

    operations = [migrations.RunPython(backfill, unlink)]
