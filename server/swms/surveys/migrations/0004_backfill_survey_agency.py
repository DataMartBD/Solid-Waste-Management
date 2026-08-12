"""Give the back-filled surveys the agency their surveyor worked for.

`0003` restored the surveyor but stopped there, which left the second half of
the same defect in place: `record_survey` stamps the agency from the surveyor,
so a survey recorded while that link was missing carries no agency at all. An
unstamped survey is invisible to every agency-scoped report and to a contractor
looking at their own work.

Resolved as of the day the survey was *taken*, not today — a surveyor who has
since moved to another contractor must not have their old work re-attributed.
That is the rule `stamp_agency_for` encodes and `Visit.agency` already follows;
it is repeated here rather than imported because a migration must keep working
when the service function changes.

Only surveys with no agency are touched. Reversible: going back clears exactly
the ones this filled.
"""

from django.db import migrations
from django.db.models import Q


def agency_on(collector, employments, on_date):
    """Which agency employed `collector` on `on_date`, else their current one."""
    rows = [
        row for row in employments
        if row.collector_id == collector.id
        and row.from_date <= on_date
        and (row.to_date is None or row.to_date >= on_date)
    ]
    if rows:
        return max(rows, key=lambda r: r.from_date).agency_id
    # Some work predates the earliest employment record; the current employer is
    # slightly imprecise but better than dropping attribution entirely.
    return collector.agency_id


def stamp_agency(apps, schema_editor):
    Survey = apps.get_model("surveys", "Survey")
    CollectorEmployment = apps.get_model("agencies", "CollectorEmployment")

    pending = list(
        Survey.objects.filter(agency__isnull=True, surveyor__isnull=False)
        .select_related("surveyor")
    )
    if not pending:
        return

    employments = list(
        CollectorEmployment.objects.filter(
            collector_id__in={s.surveyor_id for s in pending}
        )
    )

    stamped = 0
    for survey in pending:
        agency_id = agency_on(survey.surveyor, employments, survey.surveyed_on)
        if agency_id:
            Survey.objects.filter(pk=survey.pk).update(agency_id=agency_id)
            stamped += 1

    if stamped:
        print(f"\n  Agency stamped on {stamped} survey(s) from their surveyor.")


def clear_agency(apps, schema_editor):
    Survey = apps.get_model("surveys", "Survey")
    # Only the ones this could have filled: a survey with a surveyor but no
    # conversion is the shape `stamp_agency` acted on.
    Survey.objects.filter(surveyor__isnull=False).filter(
        Q(agency__isnull=False)
    ).update(agency=None)


class Migration(migrations.Migration):

    dependencies = [
        ("agencies", "0001_initial"),
        ("surveys", "0003_promote_surveyor"),
    ]

    operations = [migrations.RunPython(stamp_agency, clear_agency)]
