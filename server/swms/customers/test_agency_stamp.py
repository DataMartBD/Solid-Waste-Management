"""New holdings and routes get an agency, so they do not vanish on creation.

The shape this prevents: an agency-bound user registers a building, the row is
saved with no agency, and the very filter that enforces their boundary hides it
from them a second later. Five holdings and two routes reached that state before
the stamping existed, and nothing in the app could show them.

Two halves, and both are needed. The stamp covers a creator who has an agency —
which is everyone the boundary applies to. The writable field covers the creator
who has none, because there the answer cannot be inferred and has to be said.
"""

from __future__ import annotations

from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from swms.accounts.models import ScopeKind, User
from swms.agencies.models import Agency
from swms.catalog.models import HoldingType, Road, Ward, Zone
from swms.common.roles import Role
from swms.fieldops.models import Route

from .models import Holding


class AgencyStampFixture(TestCase):
    @classmethod
    def setUpTestData(cls):
        zone = Zone.objects.create(id="Z-03", name="Sonadanga")
        cls.ward = Ward.objects.create(id="W-14", name="Ward 14 — Sonadanga", zone=zone)
        cls.road = Road.objects.create(ward=cls.ward, name="KDA Avenue")
        cls.kind = HoldingType.objects.create(
            id="single_storey", key="opt.holdingType.single_storey", label="House"
        )
        cls.agency = Agency.objects.create(name="Premier Clean", short_code="PCM")
        cls.rival = Agency.objects.create(name="Rival Clean", short_code="RVL")

        cls.bound = User.objects.create_user(
            phone="01700000001", name="Bound Supervisor", role=Role.SUPERVISOR.value,
            password="x", scope_kind=ScopeKind.AGENCY, agency=cls.agency,
        )
        cls.unbound = User.objects.create_user(
            phone="01700000002", name="City Admin", role=Role.SUPER_ADMIN.value,
            password="x", scope_kind=ScopeKind.CITY,
        )

    def setUp(self):
        self.client = APIClient()

    def post_holding(self, **extra):
        body = {
            "ward": self.ward.id, "road": self.road.name, "holdingNo": "9/Z",
            "holdingType": self.kind.id, "ownerName": "Landlord Mia",
        }
        body.update(extra)
        return self.client.post(reverse("holding-list"), body, format="json")

    def post_route(self, **extra):
        body = {"name": "Morning round", "ward": self.ward.id}
        body.update(extra)
        return self.client.post(reverse("route-list"), body, format="json")


class HoldingStampTests(AgencyStampFixture):
    def test_a_bound_creator_stamps_their_own_agency(self):
        self.client.force_authenticate(self.bound)
        response = self.post_holding()
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(
            Holding.objects.get(pk=response.data["id"]).agency_id, self.agency.id
        )

    def test_the_building_is_still_visible_to_the_person_who_made_it(self):
        """The whole point. Before the stamp this returned 404 immediately."""
        self.client.force_authenticate(self.bound)
        made = self.post_holding().data["id"]
        self.assertEqual(
            self.client.get(reverse("holding-detail", args=[made])).status_code, 200
        )

    def test_an_unbound_creator_may_name_the_agency(self):
        self.client.force_authenticate(self.unbound)
        response = self.post_holding(agency=self.agency.id)
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(
            Holding.objects.get(pk=response.data["id"]).agency_id, self.agency.id
        )

    def test_an_unbound_creator_who_names_none_leaves_it_unset(self):
        """Nothing to infer from, and inventing one would assign work — and the
        revenue for it — to a contractor nobody chose."""
        self.client.force_authenticate(self.unbound)
        response = self.post_holding()
        self.assertEqual(response.status_code, 201, response.data)
        self.assertIsNone(Holding.objects.get(pk=response.data["id"]).agency_id)

    def test_a_bound_creator_cannot_file_under_another_agency(self):
        """They would lose the building in the same stroke, and the rival would
        inherit it."""
        self.client.force_authenticate(self.bound)
        response = self.post_holding(agency=self.rival.id)
        self.assertEqual(response.status_code, 400)
        self.assertIn("agency", response.data["fields"])

    def test_an_explicit_agency_is_not_overwritten_by_the_stamp(self):
        """The stamp fills a gap; it does not overrule what was asked for."""
        self.client.force_authenticate(self.bound)
        response = self.post_holding(agency=self.agency.id)
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(
            Holding.objects.get(pk=response.data["id"]).agency_id, self.agency.id
        )

    def test_the_agency_comes_back_on_read(self):
        self.client.force_authenticate(self.bound)
        made = self.post_holding().data["id"]
        response = self.client.get(reverse("holding-detail", args=[made]))
        self.assertEqual(response.data["agency"], self.agency.id)


class RouteStampTests(AgencyStampFixture):
    def test_a_bound_creator_stamps_their_own_agency(self):
        self.client.force_authenticate(self.bound)
        response = self.post_route()
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(Route.objects.get(pk=response.data["id"]).agency_id, self.agency.id)

    def test_the_round_is_still_visible_to_the_planner_who_made_it(self):
        self.client.force_authenticate(self.bound)
        made = self.post_route().data["id"]
        self.assertEqual(
            self.client.get(reverse("route-detail", args=[made])).status_code, 200
        )

    def test_an_unbound_creator_may_name_the_agency(self):
        self.client.force_authenticate(self.unbound)
        response = self.post_route(agency=self.agency.id)
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(Route.objects.get(pk=response.data["id"]).agency_id, self.agency.id)

    def test_a_route_without_window_times_can_be_created(self):
        """Not about agency, but found by the test above and worth pinning.

        The window defaults were the strings `"06:00"` and `"09:30"`. Postgres
        took them on insert, but a fresh instance holds the default verbatim and
        `Route.window` formats it with `%H:%M` — so creating a route without
        explicit times raised on the way back out, and had always done so.
        """
        self.client.force_authenticate(self.bound)
        response = self.post_route()
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["window"], "06:00–09:30")

    def test_a_bound_creator_cannot_plan_a_round_for_another_agency(self):
        self.client.force_authenticate(self.bound)
        response = self.post_route(agency=self.rival.id)
        self.assertEqual(response.status_code, 400)
        self.assertIn("agency", response.data["fields"])


class NoBackfillOnEditTests(AgencyStampFixture):
    """The stamp is for creation only."""

    def test_editing_a_holding_does_not_adopt_it(self):
        """A building with no agency belongs to nobody yet; an unrelated edit by
        whoever happens to open it is not the moment to decide whose it is. That
        is what `backfill_agency` is for, deliberately and with a dry run."""
        orphan = Holding.objects.create(
            ward=self.ward, road=self.road, holding_no="8/Y",
            holding_type=self.kind, owner_name="Owner",
        )
        self.client.force_authenticate(self.bound)
        # A bound user cannot even see it, so the edit is made by one who can.
        self.client.force_authenticate(self.unbound)
        response = self.client.patch(
            reverse("holding-detail", args=[orphan.pk]),
            {"ownerName": "Renamed"}, format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        orphan.refresh_from_db()
        self.assertIsNone(orphan.agency_id)
