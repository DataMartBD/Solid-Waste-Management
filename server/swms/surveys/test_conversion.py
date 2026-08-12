"""Promoting a survey into the register.

The step where a claim becomes a record, so most of what is worth testing here
is what conversion *refuses* to do: convert something nobody reviewed, invent a
road from a surveyor's spelling, create a second building at an address that
already has one, or guess a property type it cannot know.
"""

from __future__ import annotations

from django.urls import reverse
from rest_framework.test import APIClient

from swms.accounts.models import ScopeKind, User
from swms.catalog.models import HoldingType, Road
from swms.common.exceptions import DomainError
from swms.common.roles import Role
from swms.customers.models import Holding

from .models import SurveyStatus
from .services import convert_survey, record_survey, suggest_holding_type
from .tests import FormFixture


class ConversionFixture(FormFixture):
    """A reviewed survey, plus the catalog rows the register insists on."""

    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()
        cls.road = Road.objects.create(ward=cls.ward, name="KDA Avenue")
        cls.other_road = Road.objects.create(ward=cls.other_ward, name="Mohsin Road")
        for pk, label in [
            ("single_storey", "Single-storey house"),
            ("multi_storey", "Multi-storey building"),
            ("shop", "Shop"),
            ("office", "Office"),
        ]:
            HoldingType.objects.create(id=pk, key=f"opt.holdingType.{pk}", label=label)

    #: The tiny form asks nothing about the house number, road, owner or unit
    #: count — the engine that promotes those is covered in `tests.py`, so here
    #: they are set directly and conversion is what is under test.
    EXTRA = {
        "holding_no": "142/B",
        "road_name": "KDA Avenue",
        "owner_name": "Nasima Khatun",
        "household_count": 1,
    }

    def reviewed(self, **overrides):
        survey = record_survey(self.form, self.full_answers(), surveyor=self.collector)
        for field, value in {**self.EXTRA, **overrides}.items():
            setattr(survey, field, value)
        survey.status = SurveyStatus.REVIEWED
        survey.save()
        return survey


class ConversionTests(ConversionFixture):
    def test_the_address_crosses_over_whole(self):
        """District and thana are asked at the door and kept under the same
        names on the register, so conversion copies rather than re-derives."""
        survey = self.reviewed(district="Khulna", thana="Dumuria")
        holding, _ = convert_survey(survey)
        self.assertEqual((holding.district, holding.thana), ("Khulna", "Dumuria"))

    def test_a_survey_that_was_never_asked_leaves_them_blank(self):
        """v1 of the form did not ask, and nothing may be invented for it."""
        holding, _ = convert_survey(self.reviewed())
        self.assertEqual((holding.district, holding.thana), ("", ""))

    def test_a_reviewed_survey_becomes_a_holding(self):
        survey = self.reviewed()
        holding, created = convert_survey(survey)
        self.assertTrue(created)
        self.assertEqual(holding.ward_id, self.ward.id)
        self.assertEqual(holding.road_id, self.road.id)
        self.assertEqual(holding.holding_no, survey.holding_no)
        self.assertEqual(holding.owner_name, "Nasima Khatun")
        self.assertEqual(holding.units_total, 1)

    def test_the_survey_records_what_it_produced(self):
        survey = self.reviewed()
        holding, _ = convert_survey(survey)
        survey.refresh_from_db()
        self.assertEqual(survey.status, SurveyStatus.CONVERTED)
        self.assertEqual(survey.converted_to_id, holding.id)
        self.assertIsNotNone(survey.converted_at)

    def test_an_unreviewed_survey_is_refused(self):
        """The review step is the point; converting past it would void it."""
        survey = record_survey(self.form, self.full_answers())
        with self.assertRaises(DomainError) as caught:
            convert_survey(survey)
        self.assertEqual(caught.exception.code, "not_reviewed")

    def test_a_rejected_survey_is_refused(self):
        survey = self.reviewed()
        survey.status = SurveyStatus.REJECTED
        survey.save(update_fields=["status"])
        with self.assertRaises(DomainError) as caught:
            convert_survey(survey)
        self.assertEqual(caught.exception.code, "not_reviewed")

    def test_converting_twice_is_refused(self):
        survey = self.reviewed()
        convert_survey(survey)
        survey.refresh_from_db()
        with self.assertRaises(DomainError) as caught:
            convert_survey(survey)
        self.assertEqual(caught.exception.code, "already_converted")

    def test_an_unknown_road_is_refused_and_none_is_created(self):
        """Roads are curated catalog data; free text does not add one."""
        survey = self.reviewed(road_name="K.D.A. Ave")
        with self.assertRaises(DomainError) as caught:
            convert_survey(survey)
        self.assertEqual(caught.exception.code, "unknown_road")
        self.assertIn("K.D.A. Ave", str(caught.exception))
        self.assertEqual(Road.objects.filter(ward=self.ward).count(), 1)

    def test_the_supervisor_may_name_the_road_instead(self):
        survey = self.reviewed(road_name="K.D.A. Ave")
        holding, _ = convert_survey(survey, road=self.road)
        self.assertEqual(holding.road_id, self.road.id)

    def test_a_road_in_another_ward_is_refused(self):
        survey = self.reviewed()
        with self.assertRaises(DomainError) as caught:
            convert_survey(survey, road=self.other_road)
        self.assertEqual(caught.exception.code, "road_wrong_ward")

    def test_road_matching_ignores_case_and_padding(self):
        survey = self.reviewed(road_name="  kda avenue ")
        holding, _ = convert_survey(survey)
        self.assertEqual(holding.road_id, self.road.id)

    def test_an_address_already_registered_is_refused_by_name(self):
        holding, _ = convert_survey(self.reviewed())
        with self.assertRaises(DomainError) as caught:
            convert_survey(self.reviewed())
        self.assertEqual(caught.exception.code, "address_taken")
        self.assertIn(holding.id, str(caught.exception))

    def test_a_survey_can_be_linked_to_a_building_already_registered(self):
        holding, _ = convert_survey(self.reviewed())
        second = self.reviewed()
        linked, created = convert_survey(second, link=holding)
        self.assertFalse(created)
        self.assertEqual(linked.id, holding.id)
        second.refresh_from_db()
        self.assertEqual(second.converted_to_id, holding.id)
        self.assertEqual(Holding.objects.count(), 1)

    def test_a_survey_with_no_ward_cannot_be_placed(self):
        survey = self.reviewed()
        survey.ward = None
        survey.save(update_fields=["ward"])
        with self.assertRaises(DomainError) as caught:
            convert_survey(survey)
        self.assertEqual(caught.exception.code, "no_ward")

    def test_a_property_type_that_cannot_be_guessed_is_asked_for(self):
        survey = self.reviewed(premises_type="other", household_count=None)
        with self.assertRaises(DomainError) as caught:
            convert_survey(survey)
        self.assertEqual(caught.exception.code, "no_holding_type")

    def test_an_explicit_property_type_wins_over_the_guess(self):
        holding, _ = convert_survey(self.reviewed(), holding_type="multi_storey")
        self.assertEqual(holding.holding_type_id, "multi_storey")

    def test_the_owner_is_preferred_over_whoever_answered_the_door(self):
        """A tenant answered; the register wants the landlord."""
        survey = self.reviewed(owner_name="Nasima Khatun", respondent_name="A Tenant")
        holding, _ = convert_survey(survey)
        self.assertEqual(holding.owner_name, "Nasima Khatun")

    def test_the_respondent_stands_in_when_no_owner_was_named(self):
        survey = self.reviewed(owner_name="", respondent_name="Shirin Akter")
        holding, _ = convert_survey(survey)
        self.assertEqual(holding.owner_name, "Shirin Akter")

    def test_a_survey_fix_counts_as_a_verified_pin(self):
        survey = self.reviewed(lat="22.845000", lng="89.540000", accuracy=8)
        holding, _ = convert_survey(survey)
        self.assertTrue(holding.verified)
        self.assertEqual(float(holding.lat), 22.845)
        # Stamped with whoever stood at the door, not whoever converted it later.
        self.assertEqual(holding.verified_by_id, self.collector.id)
        self.assertFalse(holding.placed_by_hand)

    def test_a_survey_without_a_fix_leaves_the_holding_unlocated(self):
        holding, _ = convert_survey(self.reviewed())
        self.assertFalse(holding.verified)
        self.assertIsNone(holding.lat)

    def test_the_agency_follows_the_survey_not_the_converter(self):
        survey = self.reviewed()
        self.assertEqual(survey.agency_id, self.agency.id)
        holding, _ = convert_survey(survey)
        self.assertEqual(holding.agency_id, self.agency.id)

    def test_nothing_is_written_when_conversion_fails(self):
        survey = self.reviewed(road_name="Nowhere Lane")
        with self.assertRaises(DomainError):
            convert_survey(survey)
        self.assertEqual(Holding.objects.count(), 0)
        survey.refresh_from_db()
        self.assertEqual(survey.status, SurveyStatus.REVIEWED)


class SuggestionTests(ConversionFixture):
    """The property-type guess reads promoted columns only, never answers."""

    def test_commercial_suggests_a_shop(self):
        self.assertEqual(
            suggest_holding_type(self.reviewed(premises_type="commercial")), "shop"
        )

    def test_an_institution_suggests_an_office(self):
        self.assertEqual(
            suggest_holding_type(self.reviewed(premises_type="institution")), "office"
        )

    def test_several_families_suggest_a_multi_storey_building(self):
        self.assertEqual(
            suggest_holding_type(self.reviewed(household_count=6)), "multi_storey"
        )

    def test_one_family_suggests_a_single_storey_house(self):
        self.assertEqual(
            suggest_holding_type(self.reviewed(household_count=1)), "single_storey"
        )

    def test_it_declines_to_guess_rather_than_guessing_wrong(self):
        self.assertIsNone(
            suggest_holding_type(self.reviewed(premises_type="other", household_count=None))
        )
        self.assertIsNone(
            suggest_holding_type(self.reviewed(premises_type="", household_count=None))
        )


class ConversionApiTests(ConversionFixture):
    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_user(
            phone="01700000005", name="Admin", role=Role.AGENCY_ADMIN.value,
            password="x", scope_kind=ScopeKind.CITY,
        )
        self.supervisor = User.objects.create_user(
            phone="01700000006", name="Supervisor", role=Role.SUPERVISOR.value,
            password="x", scope_kind=ScopeKind.CITY,
        )

    def test_the_preview_says_what_would_be_created(self):
        survey = self.reviewed()
        self.client.force_authenticate(self.admin)
        response = self.client.get(reverse("survey-convert-preview", args=[survey.id]))
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data["canConvert"])
        self.assertEqual(response.data["road"], self.road.id)
        self.assertEqual(response.data["holdingType"], "single_storey")
        self.assertEqual(response.data["ownerName"], "Nasima Khatun")
        self.assertIsNone(response.data["existing"])

    def test_the_preview_offers_the_wards_roads_when_none_matched(self):
        survey = self.reviewed(road_name="K.D.A. Ave")
        self.client.force_authenticate(self.admin)
        response = self.client.get(reverse("survey-convert-preview", args=[survey.id]))
        self.assertIsNone(response.data["road"])
        self.assertEqual([r["name"] for r in response.data["roads"]], ["KDA Avenue"])

    def test_the_preview_names_a_building_already_registered(self):
        holding, _ = convert_survey(self.reviewed())
        survey = self.reviewed()
        self.client.force_authenticate(self.admin)
        response = self.client.get(reverse("survey-convert-preview", args=[survey.id]))
        self.assertEqual(response.data["existing"]["id"], holding.id)

    def test_an_admin_can_convert(self):
        survey = self.reviewed()
        self.client.force_authenticate(self.admin)
        response = self.client.post(reverse("survey-convert", args=[survey.id]), {}, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        self.assertTrue(response.data["created"])
        self.assertEqual(response.data["survey"]["status"], SurveyStatus.CONVERTED)
        self.assertTrue(Holding.objects.filter(pk=response.data["holding"]).exists())

    def test_a_supervisor_cannot_convert(self):
        """Creating a rated property starts a bill; that is not a supervisor's call."""
        survey = self.reviewed()
        self.client.force_authenticate(self.supervisor)
        response = self.client.post(reverse("survey-convert", args=[survey.id]), {}, format="json")
        self.assertEqual(response.status_code, 403)
        self.assertEqual(Holding.objects.count(), 0)

    def test_the_caller_may_correct_the_road_type_and_owner(self):
        survey = self.reviewed(road_name="K.D.A. Ave")
        self.client.force_authenticate(self.admin)
        response = self.client.post(
            reverse("survey-convert", args=[survey.id]),
            {"road": self.road.id, "holdingType": "multi_storey",
             "ownerName": "Corrected Name"},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        holding = Holding.objects.get(pk=response.data["holding"])
        self.assertEqual(holding.road_id, self.road.id)
        self.assertEqual(holding.holding_type_id, "multi_storey")
        self.assertEqual(holding.owner_name, "Corrected Name")

    def test_correcting_the_conversion_does_not_rewrite_the_survey(self):
        """A survey is a record of a conversation, not a draft of a holding."""
        survey = self.reviewed(road_name="K.D.A. Ave")
        self.client.force_authenticate(self.admin)
        self.client.post(
            reverse("survey-convert", args=[survey.id]),
            {"road": self.road.id, "ownerName": "Corrected Name"}, format="json",
        )
        survey.refresh_from_db()
        self.assertEqual(survey.road_name, "K.D.A. Ave")
        self.assertEqual(survey.owner_name, "Nasima Khatun")

    def test_linking_answers_200_not_201(self):
        holding, _ = convert_survey(self.reviewed())
        survey = self.reviewed()
        self.client.force_authenticate(self.admin)
        response = self.client.post(
            reverse("survey-convert", args=[survey.id]), {"link": holding.id}, format="json"
        )
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.data["created"])
        self.assertEqual(Holding.objects.count(), 1)

    def test_an_unknown_road_comes_back_as_a_usable_message(self):
        survey = self.reviewed(road_name="Nowhere Lane")
        self.client.force_authenticate(self.admin)
        response = self.client.post(reverse("survey-convert", args=[survey.id]), {}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertIn("Nowhere Lane", str(response.data))

    def test_a_ward_scoped_admin_cannot_reach_another_wards_survey(self):
        survey = self.reviewed()
        scoped = User.objects.create_user(
            phone="01700000007", name="Other", role=Role.AGENCY_ADMIN.value,
            password="x", scope_kind=ScopeKind.WARD,
        )
        scoped.scope_wards.set([self.other_ward])
        self.client.force_authenticate(scoped)
        response = self.client.post(
            reverse("survey-convert", args=[survey.id]), {}, format="json"
        )
        self.assertEqual(response.status_code, 404)
        self.assertEqual(Holding.objects.count(), 0)


class SurveyFromHoldingTests(ConversionFixture):
    """A survey started from the register keeps a reference to that building.

    Optional by design: most surveys are taken at a door nobody has on record,
    which is what the exercise is for. What the reference buys is conversion —
    a survey that already says which building it is about must not put a second
    copy of that building on the register.
    """

    def existing(self, number="99/Z"):
        return Holding.objects.create(
            ward=self.ward, road=self.road, holding_no=number,
            holding_type_id="single_storey", owner_name="Nasima Khatun",
        )

    def test_a_survey_can_name_the_building_it_was_started_from(self):
        holding = self.existing()
        survey = record_survey(self.form, self.full_answers(), holding=holding)
        self.assertEqual(survey.holding_id, holding.id)

    def test_a_survey_taken_cold_names_none(self):
        """The ordinary case, and not a deficient one."""
        survey = record_survey(self.form, self.full_answers())
        self.assertIsNone(survey.holding_id)

    def test_conversion_attaches_rather_than_registering_a_second_copy(self):
        holding = self.existing()
        survey = self.reviewed()
        survey.holding = holding
        survey.save(update_fields=["holding"])

        before = Holding.objects.count()
        attached, created = convert_survey(survey)
        self.assertFalse(created)
        self.assertEqual(attached.id, holding.id)
        self.assertEqual(Holding.objects.count(), before)
        survey.refresh_from_db()
        self.assertEqual(survey.converted_to_id, holding.id)
        self.assertEqual(survey.status, SurveyStatus.CONVERTED)

    def test_the_reference_does_not_overwrite_the_building_it_points_at(self):
        """Attaching is a link, not an edit: the register is not a survey's
        to rewrite, which is the whole reason the two tables are separate."""
        holding = self.existing()
        survey = self.reviewed(owner_name="Somebody Else", holding_no="different")
        survey.holding = holding
        survey.save(update_fields=["holding"])

        convert_survey(survey)
        holding.refresh_from_db()
        self.assertEqual(holding.owner_name, "Nasima Khatun")
        self.assertEqual(holding.holding_no, "99/Z")

    def test_an_explicit_link_still_wins(self):
        """The reference is a default, not a lock — a reviewer who spots that
        the surveyor started from the wrong building can say so."""
        started_from, actually = self.existing(), self.existing("100/Z")
        survey = self.reviewed()
        survey.holding = started_from
        survey.save(update_fields=["holding"])

        attached, created = convert_survey(survey, link=actually)
        self.assertFalse(created)
        self.assertEqual(attached.id, actually.id)

    def test_a_survey_with_no_reference_still_creates_a_holding(self):
        holding, created = convert_survey(self.reviewed())
        self.assertTrue(created)
        self.assertEqual(holding.holding_no, "142/B")
