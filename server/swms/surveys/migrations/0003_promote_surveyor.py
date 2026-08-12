"""The surveyor answer belongs on the survey, not only in the answer log.

Question 3 asks who is holding the clipboard and draws its choices from the
collector list, but the answer only ever landed in `Answer.text`. Two things
were wrong as a result:

* "surveyed by" was blank on every survey and in every export;
* `record_survey` stamps the agency from the surveyor, so with it null a survey
  was attributed to whoever happened to be signed in rather than to whoever
  walked the street.

This points the question at `Survey.surveyor` and back-fills the surveys already
recorded from the answers they already carry. `seed_survey_form` cannot do it:
it refuses to touch a version that has responses, which is the right rule — a
question must not be edited under answers already given. Changing only where an
answer is *copied to* does not change what anybody was asked.

Reversible: going back unsets the mapping and clears the surveyors this filled,
leaving the answers untouched.
"""

from django.db import migrations


def promote_surveyor(apps, schema_editor):
    Question = apps.get_model("surveys", "Question")
    Answer = apps.get_model("surveys", "Answer")
    Survey = apps.get_model("surveys", "Survey")
    Collector = apps.get_model("fieldops", "Collector")

    questions = Question.objects.filter(options_source="collector")
    questions.update(maps_to="surveyor_id")

    ids = set(questions.values_list("id", flat=True))
    if not ids:
        return

    known = set(Collector.objects.values_list("id", flat=True))
    filled, unknown = [], 0
    for survey_id, text in (
        Answer.objects.filter(question_id__in=ids, survey__surveyor__isnull=True)
        .values_list("survey_id", "text")
    ):
        collector_id = (text or "").strip()
        # An answer naming a collector who has since been deleted is left alone
        # rather than guessed at.
        if collector_id and collector_id in known:
            filled.append((survey_id, collector_id))
        elif collector_id:
            unknown += 1

    for survey_id, collector_id in filled:
        Survey.objects.filter(pk=survey_id).update(surveyor_id=collector_id)

    if filled or unknown:
        print(
            f"\n  Surveyor back-filled on {len(filled)} survey(s)"
            + (f"; {unknown} named a collector no longer on record." if unknown else ".")
        )


def demote_surveyor(apps, schema_editor):
    Question = apps.get_model("surveys", "Question")
    Answer = apps.get_model("surveys", "Answer")
    Survey = apps.get_model("surveys", "Survey")

    ids = set(
        Question.objects.filter(options_source="collector").values_list("id", flat=True)
    )
    if ids:
        survey_ids = set(
            Answer.objects.filter(question_id__in=ids).values_list("survey_id", flat=True)
        )
        Survey.objects.filter(pk__in=survey_ids).update(surveyor=None)
    Question.objects.filter(options_source="collector").update(maps_to="")


class Migration(migrations.Migration):

    dependencies = [
        ("fieldops", "0007_route_stop_holding"),
        ("surveys", "0002_survey_owner_name"),
    ]

    operations = [migrations.RunPython(promote_surveyor, demote_surveyor)]
