"""The form engine, the promotion of answers into columns, and the queue.

The questionnaire is data, so most of what can go wrong here is a *seed* being
wrong rather than code being wrong — hence `SeededFormTests`, which loads the
real d2d module and asserts what the paper actually says. The rest exercises the
engine with a tiny hand-built form, so a change to the questionnaire cannot make
these tests fail for the wrong reason.
"""

from __future__ import annotations

import datetime as dt
from decimal import Decimal
from io import StringIO

from django.core.exceptions import ValidationError
from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import IntegrityError, transaction
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from swms.accounts.models import ScopeKind, User
from swms.agencies.models import Agency
from swms.catalog.models import Block, GeoLocation, Ward, Zone
from swms.common.exceptions import DomainError
from swms.common.roles import Role
from swms.fieldops.models import Collector

from .forms_d2d import CODE as D2D_CODE, VERSION as D2D_VERSION
from .models import (
    Answer,
    FormStatus,
    OptionSource,
    Question,
    QuestionOption,
    QuestionRule,
    RuleOperator,
    Survey,
    SurveyForm,
    SurveyStatus,
)
from .services import record_survey, visible_questions


class FormFixture(TestCase):
    """A five-question form: ward, premises type, a conditional, a fee, a note."""

    @classmethod
    def setUpTestData(cls):
        zone = Zone.objects.create(id="Z-03", name="Sonadanga")
        cls.ward = Ward.objects.create(id="W-14", name="Ward 14 — Sonadanga", zone=zone)
        cls.other_ward = Ward.objects.create(id="W-21", name="Ward 21 — Khalishpur", zone=zone)
        cls.block = Block.objects.create(id="W-14-A", ward=cls.ward, name="Block-A")
        cls.other_block = Block.objects.create(
            id="W-21-A", ward=cls.other_ward, name="Block-A"
        )
        cls.agency = Agency.objects.create(name="Premier Clean", short_code="PCM")
        cls.collector = Collector.objects.create(
            name="Rafiq Mia", ward=cls.ward, agency=cls.agency
        )

        cls.form = SurveyForm.objects.create(
            code="tiny", version=1, title="Tiny form", status=FormStatus.PUBLISHED
        )
        cls.q_ward = Question.objects.create(
            form=cls.form, code="ward", kind="single", text="Ward", required=True,
            sort_order=1, maps_to="ward_id", options_source=OptionSource.WARD,
        )
        cls.q_block = Question.objects.create(
            form=cls.form, code="block", kind="single", text="Block", sort_order=2,
            maps_to="block_id", options_source=OptionSource.BLOCK,
        )
        cls.q_type = Question.objects.create(
            form=cls.form, code="premises", kind="single", text="Premises type",
            required=True, sort_order=3, maps_to="premises_type",
        )
        cls.opt_res = QuestionOption.objects.create(
            question=cls.q_type, code="residential", label="Residential"
        )
        cls.opt_com = QuestionOption.objects.create(
            question=cls.q_type, code="commercial", label="Commercial"
        )
        cls.q_storeys = Question.objects.create(
            form=cls.form, code="storeys", kind="number", text="Storeys",
            required=True, sort_order=4, min_value=1, max_value=20,
        )
        QuestionRule.objects.create(
            question=cls.q_storeys, depends_on=cls.q_type, operator=RuleOperator.EQUALS
        ).options.set([cls.opt_res])
        cls.q_waste = Question.objects.create(
            form=cls.form, code="waste", kind="multi", text="Waste types", sort_order=5,
        )
        cls.opt_org = QuestionOption.objects.create(
            question=cls.q_waste, code="organic", label="Organic"
        )
        cls.opt_inorg = QuestionOption.objects.create(
            question=cls.q_waste, code="inorganic", label="Inorganic"
        )
        cls.q_van = Question.objects.create(
            form=cls.form, code="van", kind="single", text="Gives to a van?",
            sort_order=6, maps_to="gives_to_van",
        )
        for code, label in [("yes", "Yes"), ("no", "No"), ("dont_know", "Do not know")]:
            QuestionOption.objects.create(question=cls.q_van, code=code, label=label)
        cls.q_fee = Question.objects.create(
            form=cls.form, code="fee", kind="number", text="Monthly fee",
            sort_order=7, maps_to="monthly_fee",
        )
        cls.q_name = Question.objects.create(
            form=cls.form, code="name", kind="text", text="Respondent",
            sort_order=8, maps_to="respondent_name",
        )

    def full_answers(self, **overrides):
        answers = {
            "ward": self.ward.id,
            "block": self.block.id,
            "premises": "residential",
            "storeys": 3,
            "waste": ["organic", "inorganic"],
            "van": "yes",
            "fee": 150,
            "name": "Shirin Akter",
        }
        answers.update(overrides)
        return {k: v for k, v in answers.items() if v is not None}


class ModelValidationTests(FormFixture):
    def test_maps_to_must_be_a_real_column(self):
        question = Question(form=self.form, code="x", kind="text", text="X", maps_to="nonsense")
        with self.assertRaises(ValidationError) as caught:
            question.clean()
        self.assertIn("not an operational column", str(caught.exception))

    def test_a_sourced_question_must_map_to_the_matching_column(self):
        """A ward id landing in `road_name` would be silent and wrong."""
        question = Question(
            form=self.form, code="x", kind="single", text="X",
            options_source=OptionSource.WARD, maps_to="road_name",
        )
        with self.assertRaises(ValidationError) as caught:
            question.clean()
        self.assertIn("must map to 'ward_id'", str(caught.exception))

    def test_a_text_question_cannot_source_options(self):
        question = Question(
            form=self.form, code="x", kind="text", text="X",
            options_source=OptionSource.WARD, maps_to="ward_id",
        )
        with self.assertRaises(ValidationError):
            question.clean()

    def test_question_codes_are_unique_within_a_form(self):
        with self.assertRaises(IntegrityError), transaction.atomic():
            Question.objects.create(form=self.form, code="ward", kind="text", text="Dup")

    def test_the_same_code_may_exist_on_another_version(self):
        two = SurveyForm.objects.create(code="tiny", version=2, title="Tiny form v2")
        Question.objects.create(form=two, code="ward", kind="text", text="Ward")  # no error

    def test_a_multi_select_stores_one_row_per_option(self):
        survey = record_survey(self.form, self.full_answers())
        self.assertEqual(survey.answers.filter(question=self.q_waste).count(), 2)

    def test_the_same_option_cannot_be_answered_twice(self):
        survey = record_survey(self.form, self.full_answers())
        with self.assertRaises(IntegrityError), transaction.atomic():
            Answer.objects.create(
                survey=survey, question=self.q_waste, option=self.opt_org
            )


class PromotionTests(FormFixture):
    """`Question.maps_to` is the only thing that puts an answer in a column."""

    def test_every_mapped_answer_reaches_its_column(self):
        survey = record_survey(self.form, self.full_answers())
        self.assertEqual(survey.ward_id, self.ward.id)
        self.assertEqual(survey.block_id, self.block.id)
        self.assertEqual(survey.premises_type, "residential")
        self.assertEqual(survey.monthly_fee, 150)
        self.assertEqual(survey.respondent_name, "Shirin Akter")
        self.assertIs(survey.gives_to_van, True)

    def test_a_choice_promotes_its_code_not_its_label(self):
        """Labels are translated and reworded; codes are what a report groups by."""
        survey = record_survey(self.form, self.full_answers())
        self.assertEqual(survey.premises_type, "residential")
        self.assertNotEqual(survey.premises_type, "Residential")

    def test_do_not_know_does_not_become_no(self):
        survey = record_survey(self.form, self.full_answers(van="dont_know"))
        self.assertIsNone(survey.gives_to_van)

    def test_an_unmapped_answer_is_stored_but_promotes_nothing(self):
        survey = record_survey(self.form, self.full_answers())
        self.assertEqual(survey.answers.filter(question=self.q_storeys).count(), 1)
        self.assertEqual(
            survey.answers.get(question=self.q_storeys).number, Decimal("3.00")
        )

    def test_surveyed_on_defaults_to_today(self):
        survey = record_survey(self.form, self.full_answers())
        self.assertEqual(survey.surveyed_on, dt.date.today())

    def test_the_agency_is_stamped_from_the_surveyor(self):
        survey = record_survey(self.form, self.full_answers(), surveyor=self.collector)
        self.assertEqual(survey.agency_id, self.agency.id)

    def test_a_later_transfer_does_not_rewrite_the_stamp(self):
        """A survey belongs to whoever held the contract on the day it was taken."""
        survey = record_survey(self.form, self.full_answers(), surveyor=self.collector)
        other = Agency.objects.create(name="Rival", short_code="RVL")
        self.collector.agency = other
        self.collector.save(update_fields=["agency"])
        survey.refresh_from_db()
        self.assertEqual(survey.agency_id, self.agency.id)


class RuleTests(FormFixture):
    def test_a_hidden_question_is_not_required(self):
        """'Storeys' is mandatory, but only of a residential premises."""
        survey = record_survey(
            self.form, self.full_answers(premises="commercial", storeys=None)
        )
        self.assertEqual(survey.premises_type, "commercial")

    def test_a_shown_question_is_still_required(self):
        with self.assertRaises(DomainError) as caught:
            record_survey(self.form, self.full_answers(storeys=None))
        self.assertIn("storeys", str(caught.exception))

    def test_an_answer_to_a_hidden_question_is_dropped(self):
        """A stale value left in the client must not contradict the form."""
        survey = record_survey(self.form, self.full_answers(premises="commercial"))
        self.assertFalse(survey.answers.filter(question=self.q_storeys).exists())

    def test_visible_questions_reflects_the_answers_given(self):
        questions = list(self.form.questions.prefetch_related("rules__options",
                                                             "rules__depends_on"))
        self.assertIn("storeys", visible_questions(questions, {"premises": "residential"}))
        self.assertNotIn("storeys", visible_questions(questions, {"premises": "commercial"}))
        self.assertNotIn("storeys", visible_questions(questions, {}))


class RecordingTests(FormFixture):
    def test_a_draft_form_cannot_be_answered(self):
        draft = SurveyForm.objects.create(code="draft", version=1, title="Draft")
        with self.assertRaises(DomainError) as caught:
            record_survey(draft, {})
        self.assertEqual(caught.exception.code, "form_not_published")

    def test_an_unknown_question_is_refused(self):
        with self.assertRaises(DomainError) as caught:
            record_survey(self.form, self.full_answers(nonexistent="x"))
        self.assertEqual(caught.exception.code, "unknown_question")

    def test_an_unknown_option_is_refused(self):
        with self.assertRaises(DomainError) as caught:
            record_survey(self.form, self.full_answers(premises="spaceship"))
        self.assertEqual(caught.exception.code, "unknown_option")

    def test_a_single_choice_takes_one_answer(self):
        with self.assertRaises(DomainError) as caught:
            record_survey(self.form, self.full_answers(premises=["residential", "commercial"]))
        self.assertEqual(caught.exception.code, "too_many_answers")

    def test_numeric_bounds_are_enforced(self):
        with self.assertRaises(DomainError) as caught:
            record_survey(self.form, self.full_answers(storeys=99))
        self.assertEqual(caught.exception.code, "above_max")

    def test_nothing_is_written_when_a_row_fails(self):
        """The whole survey is one transaction — half a questionnaire is useless."""
        before = Survey.objects.count()
        with self.assertRaises(DomainError):
            record_survey(self.form, self.full_answers(storeys=99))
        self.assertEqual(Survey.objects.count(), before)
        self.assertFalse(Answer.objects.exists())

    def test_ids_come_from_the_sequence(self):
        first = record_survey(self.form, self.full_answers())
        second = record_survey(self.form, self.full_answers())
        self.assertTrue(first.id.startswith("SRV-"))
        self.assertNotEqual(first.id, second.id)


class ApiTests(FormFixture):
    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_user(
            phone="01700000001", name="Admin", role=Role.AGENCY_ADMIN.value,
            password="x", scope_kind=ScopeKind.CITY,
        )
        self.client.force_authenticate(self.admin)

    def post_survey(self, **overrides):
        payload = {"form": self.form.id, "answers": self.full_answers(**overrides)}
        return self.client.post(reverse("survey-list"), payload, format="json")

    def test_the_form_is_served_whole_for_offline_use(self):
        response = self.client.get(reverse("survey-form-detail", args=[self.form.id]))
        self.assertEqual(response.status_code, 200)
        codes = [q["code"] for q in response.data["questions"]]
        self.assertEqual(codes, ["ward", "block", "premises", "storeys", "waste", "van",
                                 "fee", "name"])
        storeys = next(q for q in response.data["questions"] if q["code"] == "storeys")
        self.assertEqual(storeys["rules"][0]["dependsOn"], "premises")
        self.assertEqual(storeys["rules"][0]["options"], ["residential"])

    def test_published_returns_the_newest_version(self):
        SurveyForm.objects.create(
            code="tiny", version=2, title="Tiny v2", status=FormStatus.PUBLISHED
        )
        response = self.client.get(reverse("survey-form-published"), {"code": "tiny"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["version"], 2)

    def test_published_ignores_a_draft(self):
        response = self.client.get(reverse("survey-form-published"), {"code": "missing"})
        self.assertEqual(response.status_code, 400)

    def test_a_survey_can_be_recorded(self):
        response = self.post_survey()
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["ward"], self.ward.id)
        self.assertEqual(response.data["monthlyFee"], 150)

    def test_a_block_from_another_ward_is_refused(self):
        response = self.post_survey(block=self.other_block.id)
        self.assertEqual(response.status_code, 400)
        self.assertIn("not in ward", str(response.data))

    def test_an_unknown_ward_is_refused_with_a_usable_message(self):
        response = self.post_survey(ward="W-99")
        self.assertEqual(response.status_code, 400)
        self.assertIn("No ward", str(response.data))

    def test_the_detail_carries_the_answers(self):
        created = self.post_survey().data["id"]
        response = self.client.get(reverse("survey-detail", args=[created]))
        self.assertEqual(response.status_code, 200)
        answered = {a["question"] for a in response.data["answers"]}
        self.assertIn("waste", answered)
        labels = [a["label"] for a in response.data["answers"] if a["question"] == "waste"]
        self.assertCountEqual(labels, ["Organic", "Inorganic"])

    def test_review_marks_a_survey_checked(self):
        created = self.post_survey().data["id"]
        response = self.client.post(
            reverse("survey-review", args=[created]), {"status": "reviewed"}, format="json"
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["status"], SurveyStatus.REVIEWED)

    def test_review_refuses_a_status_it_does_not_mean(self):
        created = self.post_survey().data["id"]
        response = self.client.post(
            reverse("survey-review", args=[created]), {"status": "converted"}, format="json"
        )
        self.assertEqual(response.status_code, 400)


class ScopingTests(FormFixture):
    """A ward-scoped user sees and files only their own ward."""

    def setUp(self):
        self.client = APIClient()
        self.scoped = User.objects.create_user(
            phone="01700000002", name="Supervisor", role=Role.SUPERVISOR.value,
            password="x", scope_kind=ScopeKind.WARD,
        )
        self.scoped.scope_wards.set([self.ward])

    def test_a_survey_in_another_ward_is_invisible(self):
        record_survey(self.form, self.full_answers())
        record_survey(self.form, self.full_answers(ward=self.other_ward.id,
                                                   block=self.other_block.id))
        self.client.force_authenticate(self.scoped)
        response = self.client.get(reverse("survey-list"))
        wards = {row["ward"] for row in response.data["results"]}
        self.assertEqual(wards, {self.ward.id})

    def test_a_survey_cannot_be_filed_into_another_ward(self):
        self.client.force_authenticate(self.scoped)
        response = self.client.post(
            reverse("survey-list"),
            {"form": self.form.id,
             "answers": self.full_answers(ward=self.other_ward.id,
                                          block=self.other_block.id)},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("outside your assigned area", str(response.data))

    def test_a_survey_cannot_reference_a_building_in_another_ward(self):
        """Conversion attaches to whatever the survey names, so an unchecked
        reference is a write into somebody else's register by a longer route."""
        from swms.catalog.models import HoldingType, Road
        from swms.customers.models import Holding
        theirs = Holding.objects.create(
            ward=self.other_ward,
            road=Road.objects.create(ward=self.other_ward, name="Mohsin Road"),
            holding_no="7/C", owner_name="Somebody Else",
            holding_type=HoldingType.objects.create(
                id="single_storey", key="opt.holdingType.single_storey", label="House"
            ),
        )
        self.client.force_authenticate(self.scoped)
        response = self.client.post(
            reverse("survey-list"),
            {"form": self.form.id, "answers": self.full_answers(), "holding": theirs.id},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("outside your assigned area", str(response.data))

    def test_the_form_itself_is_not_ward_scoped(self):
        """A surveyor needs the questionnaire before they have a ward to scope by."""
        self.client.force_authenticate(self.scoped)
        response = self.client.get(reverse("survey-form-list"))
        self.assertEqual(response.status_code, 200)
        self.assertGreaterEqual(len(response.data["results"]), 1)


class OfflineQueueTests(FormFixture):
    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_user(
            phone="01700000003", name="Admin", role=Role.AGENCY_ADMIN.value,
            password="x", scope_kind=ScopeKind.CITY,
        )
        self.client.force_authenticate(self.admin)

    def upload(self, rows):
        return self.client.post(
            reverse("survey-bulk"), {"rows": rows}, format="json"
        )

    def test_a_queue_is_drained(self):
        rows = [{"form": self.form.id, "answers": self.full_answers()} for _ in range(3)]
        response = self.upload(rows)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data["saved"]), 3)
        self.assertEqual(response.data["failed"], [])

    def test_one_bad_row_does_not_sink_a_morning_of_work(self):
        rows = [
            {"form": self.form.id, "answers": self.full_answers()},
            {"form": self.form.id, "answers": self.full_answers(premises="spaceship")},
            {"form": self.form.id, "answers": self.full_answers()},
        ]
        response = self.upload(rows)
        self.assertEqual(len(response.data["saved"]), 2)
        self.assertEqual([f["index"] for f in response.data["failed"]], [1])
        self.assertIn("spaceship", response.data["failed"][0]["error"])

    def test_an_empty_queue_is_accepted(self):
        response = self.upload([])
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data, {"saved": [], "failed": []})

    def test_scope_guards_still_apply_inside_the_queue(self):
        """The guards no-op without serializer context — the queue must supply it."""
        scoped = User.objects.create_user(
            phone="01700000004", name="Supervisor", role=Role.SUPERVISOR.value,
            password="x", scope_kind=ScopeKind.WARD,
        )
        scoped.scope_wards.set([self.ward])
        self.client.force_authenticate(scoped)
        response = self.upload([
            {"form": self.form.id,
             "answers": self.full_answers(ward=self.other_ward.id,
                                          block=self.other_block.id)},
        ])
        self.assertEqual(response.data["saved"], [])
        self.assertIn("outside your assigned area", response.data["failed"][0]["error"])

    def test_sync_acknowledges_a_queued_record(self):
        survey = record_survey(self.form, self.full_answers(), synced=False)
        response = self.client.post(reverse("survey-sync", args=[survey.id]))
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data["synced"])


class SeededFormTests(TestCase):
    """The real questionnaire, as `seed_survey_form` loads it.

    These assert the *content* of the transcription, which is the part a code
    review cannot check by reading the engine.
    """

    @classmethod
    def setUpTestData(cls):
        call_command("seed_survey_form", "--publish", stdout=StringIO())
        # Read the version off the module rather than pinning it here: every
        # edit to the questionnaire bumps it, and a hard-coded number turns
        # that ordinary act into a failing test about nothing.
        cls.form = SurveyForm.objects.get(code=D2D_CODE, version=D2D_VERSION)

    def test_it_is_published_and_complete(self):
        self.assertEqual(self.form.status, FormStatus.PUBLISHED)
        self.assertEqual(self.form.questions.count(), 73)

    def test_the_roster_questions_are_sourced_from_the_catalog(self):
        """Sylhet's two wards and eight surveyors are not part of the form."""
        for code, source in [("ward", OptionSource.WARD), ("block", OptionSource.BLOCK),
                             ("surveyor", OptionSource.COLLECTOR),
                             ("district", OptionSource.DISTRICT),
                             ("thana", OptionSource.THANA)]:
            question = self.form.questions.get(code=code)
            self.assertEqual(question.options_source, source)
            self.assertEqual(question.options.count(), 0)

    def test_the_survey_area_offers_khulna_first_and_still_offers_sylhet(self):
        """The corporation running this system leads the list.

        Sylhet stays behind it: v1 and v2 answers carry the `scc` code, and an
        option dropped from the form leaves those reading as a bare code.
        """
        options = self.form.questions.get(code="survey_area").options.all()
        self.assertEqual([o.code for o in options], ["kcc", "scc"])
        self.assertEqual(options[0].label, "Khulna City Corporation")
        self.assertEqual(options[0].label_bn, "খুলনা সিটি কর্পোরেশন")

    def test_every_choice_question_has_options_to_choose_from(self):
        empty = [
            q.code for q in self.form.questions.filter(kind__in=["single", "multi"])
            if q.options_source == OptionSource.STATIC and not q.options.exists()
        ]
        self.assertEqual(empty, [])

    def test_every_mapped_column_is_a_real_one(self):
        from .models import MAPPABLE
        mapped = set(self.form.questions.exclude(maps_to="").values_list("maps_to", flat=True))
        self.assertTrue(mapped <= MAPPABLE)
        self.assertEqual(mapped, MAPPABLE, "a mappable column no question fills")

    def test_conditional_questions_depend_on_earlier_ones(self):
        for rule in QuestionRule.objects.filter(question__form=self.form):
            self.assertLess(
                rule.depends_on.sort_order, rule.question.sort_order,
                f"{rule.question.code} depends on a later question",
            )

    def test_the_construction_type_only_applies_to_a_residential_premises(self):
        rule = self.form.questions.get(code="residential_detail").rules.get()
        self.assertEqual(rule.depends_on.code, "premises_type")
        self.assertEqual([o.code for o in rule.options.all()], ["residential"])

    def test_bangla_is_carried_for_every_question(self):
        missing = [q.code for q in self.form.questions.all() if not q.text_bn]
        self.assertEqual(missing, [], "Bangla is the source language of this form")

    def test_reseeding_is_safe_and_idempotent(self):
        call_command("seed_survey_form", stdout=StringIO())
        self.assertEqual(SurveyForm.objects.filter(code="d2d-household").count(), 1)
        self.assertEqual(self.form.questions.count(), 73)

    def real_answers(self):
        """The questions the printed form marks mandatory."""
        zone = Zone.objects.create(id="Z-01", name="Kotwali")
        ward = Ward.objects.create(id="W-22", name="Ward 22", zone=zone)
        collector = Collector.objects.create(name="Salma Begum", ward=ward)
        # From v2 the district is a real one out of the national table rather
        # than the single option the Sylhet paper printed.
        GeoLocation.objects.create(
            division_name="Sylhet", division_bn="সিলেট",
            district_name="Sylhet", district_bn="সিলেট",
            upazila_name="Kotwali", upazila_bn="কোতোয়ালী",
            union_name="Tuker Bazar", union_bn="টুকের বাজার",
        )
        return {
            "survey_area": "scc",
            "district": "Sylhet",
            "thana": "Kotwali",
            "surveyor": collector.id,
            "surveyed_on": dt.date.today(),
            "ward": ward.id,
            "holding_no": "12/A",
            "premises_type": "residential",
            "gives_to_van": "yes",
        }

    def test_the_real_form_records_an_answer_end_to_end(self):
        survey = record_survey(self.form, self.real_answers())
        self.assertEqual(survey.ward_id, "W-22")
        self.assertEqual(survey.holding_no, "12/A")
        self.assertEqual(survey.premises_type, "residential")
        self.assertIs(survey.gives_to_van, True)

    def test_the_surveyor_answer_reaches_the_survey(self):
        """Question 3 names who walked the street; the survey must know it.

        It landed only in the answer log for a while, which left "surveyed by"
        blank everywhere and — because the agency is stamped from the surveyor —
        attributed the work to whoever happened to be signed in.
        """
        answers = self.real_answers()
        survey = record_survey(self.form, answers)
        self.assertEqual(survey.surveyor_id, answers["surveyor"])

    def test_the_agency_follows_the_surveyor_named_on_the_form(self):
        answers = self.real_answers()
        collector = Collector.objects.get(pk=answers["surveyor"])
        agency = Agency.objects.create(name="Field Partner", short_code="FLD")
        collector.agency = agency
        collector.save(update_fields=["agency"])

        survey = record_survey(self.form, answers)
        self.assertEqual(survey.agency_id, agency.id)


    def test_a_version_with_answers_is_never_rewritten(self):
        """Editing questions under collected answers would falsify them."""
        record_survey(self.form, self.real_answers())
        with self.assertRaises(CommandError) as caught:
            call_command("seed_survey_form", stdout=StringIO())
        self.assertIn("Bump VERSION", str(caught.exception))


class SurveyGeographyTests(FormFixture):
    """District and thana: sourced from the catalog, stored as names.

    Ward and block are foreign keys, so a bad answer to those cannot reach the
    table. These two are names, which is why they need checking in code — and
    why the check has to be the same rule the holding register applies, since a
    reviewed survey becomes a holding.
    """

    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()
        for upazila, union in [("Dumuria", "Magurghona"), ("Batiaghata", "Jalma")]:
            GeoLocation.objects.create(
                division_name="Khulna", division_bn="খুলনা",
                district_name="Khulna", district_bn="খুলনা",
                upazila_name=upazila, upazila_bn=upazila,
                union_name=union, union_bn=union,
            )
        GeoLocation.objects.create(
            division_name="Khulna", division_bn="খুলনা",
            district_name="Bagerhat", district_bn="বাগেরহাট",
            upazila_name="Fakirhat", upazila_bn="ফকিরহাট",
            union_name="Betaga", union_bn="বেতাগা",
        )
        cls.district_q = Question.objects.create(
            form=cls.form, code="district", number="3", kind="single", text="District",
            maps_to="district", options_source=OptionSource.DISTRICT, sort_order=90,
        )
        cls.thana_q = Question.objects.create(
            form=cls.form, code="thana", number="4", kind="single", text="Thana",
            maps_to="thana", options_source=OptionSource.THANA, sort_order=91,
        )

    def record(self, **answers):
        return record_survey(self.form, self.full_answers(**answers))

    def test_the_names_are_promoted_onto_the_survey(self):
        survey = self.record(district="Khulna", thana="Dumuria")
        self.assertEqual((survey.district, survey.thana), ("Khulna", "Dumuria"))

    def test_an_unanswered_pair_is_blank_not_null(self):
        """They land in text columns, where NULL is not allowed."""
        survey = self.record()
        self.assertEqual((survey.district, survey.thana), ("", ""))

    def test_a_district_alone_is_accepted(self):
        """The paper asks for the thana but does not require it."""
        survey = self.record(district="Khulna")
        self.assertEqual((survey.district, survey.thana), ("Khulna", ""))

    def test_a_district_that_does_not_exist_is_refused(self):
        with self.assertRaises(DomainError) as caught:
            self.record(district="Atlantis")
        self.assertEqual(caught.exception.code, "unknown_district")
        self.assertEqual(Survey.objects.count(), 0)

    def test_a_thana_of_another_district_is_refused(self):
        """Fakirhat is real, but it is in Bagerhat."""
        with self.assertRaises(DomainError) as caught:
            self.record(district="Khulna", thana="Fakirhat")
        self.assertEqual(caught.exception.code, "unknown_thana")

    def test_a_thana_without_a_district_is_refused(self):
        with self.assertRaises(DomainError) as caught:
            self.record(thana="Dumuria")
        self.assertEqual(caught.exception.code, "thana_without_district")

    def test_the_answer_is_still_kept_in_the_answer_log(self):
        """Promotion is a copy, not a move — the log is what was actually said."""
        survey = self.record(district="Khulna", thana="Dumuria")
        said = dict(survey.answers.values_list("question__code", "text"))
        self.assertEqual(said["district"], "Khulna")
        self.assertEqual(said["thana"], "Dumuria")

    def test_the_list_carries_both_names(self):
        """The page shows them, so the row it is built from has to hold them."""
        survey = self.record(district="Khulna", thana="Dumuria")
        client = APIClient()
        client.force_authenticate(User.objects.create_user(
            phone="01700000044", name="Operator", role=Role.SUPERVISOR.value,
            password="x", scope_kind=ScopeKind.CITY,
        ))
        row = next(
            r for r in client.get(reverse("survey-list")).data["results"]
            if r["id"] == survey.id
        )
        self.assertEqual((row["district"], row["thana"]), ("Khulna", "Dumuria"))

    def test_a_survey_can_be_searched_by_thana(self):
        survey = self.record(district="Khulna", thana="Dumuria")
        client = APIClient()
        client.force_authenticate(User.objects.create_user(
            phone="01700000045", name="Operator", role=Role.SUPERVISOR.value,
            password="x", scope_kind=ScopeKind.CITY,
        ))
        found = client.get(reverse("survey-list"), {"search": "Dumuria"})
        self.assertEqual([r["id"] for r in found.data["results"]], [survey.id])

    def test_a_sourced_question_must_map_to_its_own_column(self):
        """The same guard that stops a ward id landing in the block column."""
        question = Question(
            form=self.form, code="wrong", kind="single", text="Where",
            maps_to="thana", options_source=OptionSource.DISTRICT,
        )
        with self.assertRaises(ValidationError):
            question.full_clean(exclude=["form"])
