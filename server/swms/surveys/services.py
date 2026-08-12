"""Recording a survey.

The API hands over a form, a few header fields and a dict of `{question_code:
value}`. Everything below turns that into a `Survey`, its `Answer` rows, and the
handful of operational columns promoted off those answers.

Promotion is driven entirely by `Question.maps_to` — nothing here knows that
this questionnaire calls its address field `holding_no`. Point a question on a
second form at the same column and it fills the same way.
"""

from __future__ import annotations

from decimal import Decimal, InvalidOperation

from django.db import transaction
from django.utils import timezone

from swms.agencies.services import stamp_agency_for
from swms.common.exceptions import DomainError

from .models import (
    Answer,
    FormStatus,
    Question,
    QuestionKind,
    RuleOperator,
    SOURCE_TEXT_COLUMNS,
    Survey,
    SurveyStatus,
)

#: Values a yes/no question may promote into a boolean column. Anything else is
#: left null rather than guessed at — "do not know" is a real answer here and
#: must not become False.
TRUTHY = {"yes", "true", "1"}
FALSEY = {"no", "false", "0"}


def _as_decimal(value, question):
    try:
        return Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        raise DomainError(
            f"'{value}' is not a number for question {question.number or question.code}.",
            code="bad_number",
        ) from None


def visible_questions(questions, answers: dict) -> set:
    """Question codes whose display rules are satisfied by `answers`.

    Used to decide which required questions actually had to be answered: the
    form marks the ward mandatory, but the construction-type question is only
    mandatory once somebody said the premises is residential.

    Takes an already-fetched list rather than the form, so the caller controls
    the prefetch — walking `rules__options` lazily over 72 questions would cost
    a query apiece.
    """
    return {
        q.code for q in questions
        if all(_rule_holds(rule, answers) for rule in q.rules.all())
    }


def _rule_holds(rule, answers: dict) -> bool:
    given = answers.get(rule.depends_on.code)
    if given is None or given == "" or given == []:
        return False
    chosen = set(given) if isinstance(given, (list, tuple, set)) else {given}
    if rule.operator == RuleOperator.ANSWERED:
        return True
    wanted = {option.code for option in rule.options.all()}
    if rule.operator == RuleOperator.EQUALS:
        return bool(chosen & wanted)
    return not (chosen & wanted)


def _promote(survey, question, value):
    """Copy one answer onto the `Survey` column named by `question.maps_to`."""
    column = question.maps_to
    if not column:
        return

    if column == "gives_to_van":
        text = str(value).lower()
        survey.gives_to_van = True if text in TRUTHY else (False if text in FALSEY else None)
    elif question.kind == QuestionKind.NUMBER:
        setattr(survey, column, _as_decimal(value, question))
    elif question.kind == QuestionKind.DATE:
        setattr(survey, column, value)
    elif question.is_sourced and column in SOURCE_TEXT_COLUMNS:
        # District and thana are sourced, but from a table whose rows are named
        # rather than keyed, so the answer is a name landing in a text column —
        # where an absent answer is "" and not NULL.
        setattr(survey, column, str(value or "")[:96])
    elif question.is_sourced:
        # ward_id / block_id / surveyor_id — the answer already *is* the key.
        setattr(survey, column, value or None)
    elif question.takes_options:
        # A choice promoted into a text column stores the option code, not the
        # label: labels are translated and edited, codes are the stable thing a
        # report can group by.
        setattr(survey, column, str(value)[:40])
    else:
        setattr(survey, column, str(value)[:160])


def _check_geography(survey):
    """The district and thana promoted onto a survey must be a real pair.

    Ward and block are foreign keys, so a bad answer to those cannot be stored.
    District and thana are names, so nothing in the database stops a thana being
    filed under the wrong district — this is what does, and it is the same rule
    `HoldingSerializer` applies, because a survey becomes a holding.
    """
    from swms.catalog.models import GeoLocation

    district, thana = survey.district.strip(), survey.thana.strip()
    survey.district, survey.thana = district, thana
    if not district:
        if thana:
            raise DomainError(
                "A thana was given with no district.", code="thana_without_district"
            )
        return

    rows = GeoLocation.objects.filter(district_name=district)
    if not rows.exists():
        raise DomainError(f"'{district}' is not a district.", code="unknown_district")
    # A district on its own is fine: the paper form asks for the thana but does
    # not require it, and a surveyor who does not know it should not be blocked.
    if thana and not rows.filter(upazila_name=thana).exists():
        raise DomainError(
            f"'{thana}' is not a thana of {district}.", code="unknown_thana"
        )


@transaction.atomic
def record_survey(
    form,
    answers: dict,
    *,
    surveyor=None,
    surveyor_name="",
    holding=None,
    lat=None,
    lng=None,
    altitude=None,
    accuracy=None,
    notes="",
    status=SurveyStatus.SUBMITTED,
    synced=True,
    user=None,
) -> Survey:
    """Store one completed questionnaire.

    `answers` is `{question_code: value}` where a value is a string, a number, a
    date, or — for a multi-select — a list of option codes.

    `holding` is the building the survey was started from, when it was started
    from the register. Optional, and left alone when absent: a survey taken at a
    door nobody has on record is the normal case, not a deficient one.
    """
    if form.status != FormStatus.PUBLISHED:
        raise DomainError(
            f"{form} is {form.get_status_display().lower()} and cannot be answered.",
            code="form_not_published",
        )

    questions = list(
        form.questions.prefetch_related("options", "rules__options", "rules__depends_on")
    )
    by_code = {q.code: q for q in questions}

    unknown = set(answers) - set(by_code)
    if unknown:
        raise DomainError(
            f"{form} has no question(s) {', '.join(sorted(unknown))}.", code="unknown_question"
        )

    shown = visible_questions(questions, answers)
    missing = [
        q.code for q in questions
        if q.required and q.code in shown and not _given(answers.get(q.code))
    ]
    if missing:
        raise DomainError(
            f"These questions must be answered: {', '.join(missing)}.", code="missing_answers"
        )

    survey = Survey(
        form=form,
        surveyor=surveyor,
        surveyor_name=surveyor_name,
        holding=holding,
        recorded_by=user,
        surveyed_on=timezone.localdate(),
        lat=lat, lng=lng, altitude=altitude, accuracy=accuracy,
        status=status, synced=synced, notes=notes,
    )

    rows = []
    for code, value in answers.items():
        question = by_code[code]
        if not _given(value):
            continue
        # An answer to a question the rules hide is dropped rather than stored:
        # it is usually a stale value left in the client when the respondent
        # changed an earlier answer, and keeping it would contradict the form.
        if code not in shown:
            continue
        rows.extend(_answer_rows(question, value))
        _promote(survey, question, _first(value))

    _check_geography(survey)

    if survey.surveyed_on is None:
        survey.surveyed_on = timezone.localdate()

    # Who actually walked the street. The form asks for it (a collector-sourced
    # question promotes into `surveyor_id`), and that answer is the truth — the
    # `surveyor` argument only covers callers that name one directly, such as
    # the offline queue pinning a collector to their own uploads.
    walker = survey.surveyor if survey.surveyor_id else surveyor
    survey.surveyor = walker

    # Stamped, not derived, and stamped with the date the survey was *taken*:
    # a surveyor who later moves to another contractor must not silently
    # re-attribute the work they already did. `Visit.agency` follows the same
    # rule. Set after promotion because `surveyed_on` is itself an answer.
    survey.agency = (
        stamp_agency_for(walker, survey.surveyed_on) if walker
        else getattr(user, "agency", None)
    )
    survey.save()

    for row in rows:
        row.survey = survey
    Answer.objects.bulk_create(rows)
    return survey


def _given(value) -> bool:
    if value is None:
        return False
    if isinstance(value, (list, tuple, set)):
        return len(value) > 0
    return str(value).strip() != ""


def _first(value):
    if isinstance(value, (list, tuple)):
        return value[0] if value else None
    return value


def _answer_rows(question: Question, value) -> list:
    """One `Answer` per stored value — several for a multi-select."""
    if question.is_sourced:
        # The chosen row's primary key. Kept as text so the answer log stays
        # readable without a join, while the promoted FK does the real work.
        return [Answer(question=question, text=str(_first(value)))]

    if question.takes_options:
        codes = value if isinstance(value, (list, tuple, set)) else [value]
        options = {o.code: o for o in question.options.all()}
        rows = []
        for code in codes:
            option = options.get(str(code))
            if option is None:
                raise DomainError(
                    f"'{code}' is not an option for question "
                    f"{question.number or question.code}.",
                    code="unknown_option",
                )
            rows.append(Answer(question=question, option=option))
        if question.kind == QuestionKind.SINGLE and len(rows) > 1:
            raise DomainError(
                f"Question {question.number or question.code} takes one answer, "
                f"not {len(rows)}.",
                code="too_many_answers",
            )
        return rows

    if question.kind == QuestionKind.NUMBER:
        number = _as_decimal(_first(value), question)
        if question.min_value is not None and number < question.min_value:
            raise DomainError(
                f"Question {question.number or question.code} cannot be below "
                f"{question.min_value}.", code="below_min",
            )
        if question.max_value is not None and number > question.max_value:
            raise DomainError(
                f"Question {question.number or question.code} cannot be above "
                f"{question.max_value}.", code="above_max",
            )
        return [Answer(question=question, number=number)]

    if question.kind == QuestionKind.DATE:
        return [Answer(question=question, date=_first(value))]

    return [Answer(question=question, text=str(_first(value)))]


def bulk_record_surveys(rows, user=None) -> dict:
    """Take a device's offline queue.

    Row-by-row, each in its own transaction, reporting which indices failed —
    the same contract `bulk_record_visits` uses, because the field app already
    knows how to drain a queue that answers this way. A surveyor's phone holds
    the only copy of that morning's work, so one unusable row must not reject
    the upload.
    """
    from .serializers import RecordSurveySerializer

    saved: list[str] = []
    failed: list[dict] = []

    for index, row in enumerate(rows):
        serializer = RecordSurveySerializer(data=row, context={"user": user})
        try:
            serializer.is_valid(raise_exception=True)
            saved.append(serializer.save().id)
        except Exception as exc:  # noqa: BLE001 — one bad row must not sink the batch
            failed.append({"index": index, "error": _error_text(exc)})

    return {"saved": saved, "failed": failed}


def _error_text(exc) -> str:
    detail = getattr(exc, "detail", None)
    if isinstance(detail, dict):
        return "; ".join(f"{k}: {v[0] if isinstance(v, list) else v}" for k, v in detail.items())
    if isinstance(detail, list):
        return "; ".join(str(d) for d in detail)
    return str(detail or exc)


# --------------------------------------------------------------------------- #
# Promoting a survey into the register
# --------------------------------------------------------------------------- #

#: A first guess at `HoldingType` from what the survey recorded, offered to the
#: supervisor doing the conversion and freely overridden by them.
#:
#: It is a guess and nothing more. The questionnaire asks what a surveyor could
#: see from the door; `HoldingType` is what the corporation rates the property
#: as. Those are close enough to save typing and not close enough to trust, so
#: the conversion takes an explicit `holding_type` and only falls back here.
def suggest_holding_type(survey) -> str | None:
    """A `HoldingType` id, or None when the survey does not say enough.

    Reads only promoted columns, so a second questionnaire that fills the same
    columns gets the same suggestion without this knowing anything about it.
    """
    premises = (survey.premises_type or "").lower()
    if premises in ("commercial", "shop"):
        return "shop"
    if premises in ("institution", "office"):
        return "office"
    if premises in ("", "other"):
        return None
    # Residential or mixed. The number of families in the building is the only
    # promoted signal for how big it is.
    if survey.household_count and survey.household_count > 1:
        return "multi_storey"
    if survey.household_count == 1:
        return "single_storey"
    return None


def _resolve_road(ward, name):
    """The `Road` row a surveyor's free text refers to, inside `ward`.

    Deliberately does **not** create one. The Holdings form already refuses an
    unknown road for the same reason: roads are curated catalog data, and taking
    them from free text would fill the table with 'KDA Ave', 'K.D.A Avenue' and
    'kda avenue' as three different roads. The supervisor either adds the road
    first or names the right one when converting.
    """
    from swms.catalog.models import Road

    cleaned = (name or "").strip()
    if not cleaned:
        return None
    return Road.objects.filter(ward=ward, name__iexact=cleaned).first()


@transaction.atomic
def convert_survey(
    survey,
    *,
    holding_type=None,
    road=None,
    holding_no=None,
    owner_name=None,
    owner_phone=None,
    link=None,
    user=None,
):
    """Turn a reviewed survey into a `Holding`, or attach it to an existing one.

    This is the step where a claim becomes a record. Everything before it is
    what somebody was told at a door; a holding is what the corporation bills
    against, so it is deliberately a decision a supervisor takes rather than
    something that happens on submission.

    `link` attaches the survey to a holding that already exists instead of
    creating one — the answer to surveying a building that is already on the
    register, which is common and is not an error.
    """
    from swms.customers.models import Holding

    if survey.status == SurveyStatus.CONVERTED:
        raise DomainError(
            f"{survey.id} is already holding {survey.converted_to_id}.",
            code="already_converted",
        )
    if survey.status != SurveyStatus.REVIEWED:
        # The whole point of the review step: nothing reaches the register
        # before somebody has checked it.
        raise DomainError(
            "Only a reviewed survey can be made into a holding. "
            f"{survey.id} is {survey.get_status_display().lower()}.",
            code="not_reviewed",
        )

    if link is not None:
        holding = link if isinstance(link, Holding) else Holding.objects.get(pk=link)
        return _attach(survey, holding, user=user, created=False)

    # A survey started from the register is already about a building on it.
    # Creating a second record for the same one is the mistake `address_taken`
    # exists to catch — and here there is no need to catch it, because the
    # survey said which building it was about before anybody answered a question.
    if survey.holding_id is not None:
        return _attach(survey, survey.holding, user=user, created=False)

    if survey.ward_id is None:
        raise DomainError(
            f"{survey.id} has no ward, so it cannot be placed on the register.",
            code="no_ward",
        )

    number = (holding_no or survey.holding_no or "").strip()
    if not number:
        raise DomainError(f"{survey.id} has no house number.", code="no_holding_no")

    road_row = road if road is not None else _resolve_road(survey.ward, survey.road_name)
    if road_row is None:
        named = (survey.road_name or "").strip()
        raise DomainError(
            f"'{named}' is not a road in {survey.ward.short_label}."
            if named else
            f"{survey.id} names no road, and a holding needs one.",
            code="unknown_road",
        )
    if road_row.ward_id != survey.ward_id:
        raise DomainError(
            f"{road_row.name} is in {road_row.ward_id}, not {survey.ward_id}.",
            code="road_wrong_ward",
        )

    kind = holding_type or suggest_holding_type(survey)
    if not kind:
        raise DomainError(
            "Choose what kind of property this is — the survey does not say.",
            code="no_holding_type",
        )

    owner = (owner_name or survey.owner_name or survey.respondent_name or "").strip()
    if not owner:
        raise DomainError(f"{survey.id} names nobody to record as owner.", code="no_owner")

    existing = Holding.objects.filter(
        ward_id=survey.ward_id, road=road_row, holding_no=number
    ).first()
    if existing is not None:
        # Not an error the caller can fix by editing: the building is already on
        # the register. Naming it lets them link instead.
        raise DomainError(
            f"{existing.id} is already registered at {number}, {road_row.name}. "
            f"Link this survey to it instead of creating a second record.",
            code="address_taken",
        )

    holding = Holding(
        # The survey asked for these and the register keeps them under the same
        # names, so the address crosses over whole rather than being re-entered.
        district=survey.district,
        thana=survey.thana,
        ward_id=survey.ward_id,
        road=road_row,
        holding_no=number,
        holding_type_id=kind,
        owner_name=owner,
        owner_phone=(owner_phone or survey.respondent_phone or "").strip(),
        units_total=survey.household_count,
        # Stamped from the survey, not from the converting user's agency: the
        # building belongs to whoever surveyed it, and a desk officer converting
        # it three weeks later must not reassign it.
        agency=survey.agency,
        notes=f"Registered from survey {survey.id}.",
    )
    if survey.has_location:
        # A survey fix was taken by somebody standing at the door, which is
        # exactly what the Holdings page means by a verified pin — so it counts
        # as one, stamped with who took it rather than with who converted it.
        holding.lat = survey.lat
        holding.lng = survey.lng
        holding.accuracy = survey.accuracy
        holding.verified = True
        holding.verified_at = timezone.now()
        holding.verified_by = survey.surveyor
        holding.placed_by_hand = False
    holding.save()
    return _attach(survey, holding, user=user, created=True)


def _attach(survey, holding, *, user, created):
    """Record that this survey produced (or was matched to) `holding`."""
    survey.converted_to = holding
    survey.converted_at = timezone.now()
    survey.status = SurveyStatus.CONVERTED
    survey.save(update_fields=["converted_to", "converted_at", "status", "updated_at"])
    return holding, created
