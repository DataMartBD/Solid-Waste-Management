"""The City Corporation dashboard, and the City Viewer who reads it."""

from __future__ import annotations

from unittest import mock

from django.urls import reverse
from rest_framework.test import APIClient

from swms.accounts.models import ScopeKind, User
from swms.agencies.models import Agency
from swms.catalog.models import City, Ward, Zone
from swms.common.roles import ROLE_HOME, Role
from swms.customers.models import Holding
from swms.fieldops.collection_day import close_day, summarise
from swms.fieldops.models import Visit, VisitSource, VisitStatus
from swms.fieldops.test_collection_day import DAY, CollectionDayData, at


class CityReportTests(CollectionDayData):
    def setUp(self):
        super().setUp()
        Visit.objects.create(
            holding=self.a, status=VisitStatus.COLLECTED, source=VisitSource.SCAN,
            at=at(DAY, 7),
        )
        self.missed(self.c)
        close_day(self.city, DAY, now=at(DAY, 21))

        self.scc = City.objects.create(id="SCC", name="Sylhet City Corporation")
        zone = Zone.objects.create(id="Z-90", name="Zindabazar", city=self.scc)
        Ward.objects.create(id="W-90", name="Ward 90 — Zindabazar", zone=zone)

    def client_for(self, **fields):
        user = User.objects.create_user(phone="01900445566", name="Viewer", **fields)
        client = APIClient()
        client.force_authenticate(user)
        return client

    def load(self, client, **params):
        params.setdefault("from", DAY.isoformat())
        params.setdefault("to", DAY.isoformat())
        with mock.patch("django.utils.timezone.now", return_value=at(DAY, 22)):
            response = client.get(reverse("report-city-collection"), params)
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()

    def test_totals_keep_confirmed_auto_and_missed_apart(self):
        body = self.load(self.client_for(role=Role.SUPER_ADMIN, scope_kind=ScopeKind.CITY))
        totals = body["totals"]
        self.assertEqual(
            (totals["due"], totals["confirmed"], totals["auto"], totals["missed"]), (3, 1, 1, 1)
        )
        self.assertEqual(totals["collectedPct"], 67)
        self.assertEqual(totals["confirmedPct"], 33)
        self.assertEqual(body["rows"][0]["period"], "2026-10-09")

    def test_breakdowns_by_agency_and_ward(self):
        body = self.load(self.client_for(role=Role.SUPER_ADMIN, scope_kind=ScopeKind.CITY))
        self.assertEqual([w["ward"] for w in body["byWard"]], ["W-14"])
        self.assertEqual(body["byAgency"][0]["due"], 3)

    def test_an_agency_row_carries_its_bangla_name(self):
        agency = Agency.objects.create(
            name="Premier Clean", name_bn="প্রিমিয়ার ক্লিন", short_code="PCM"
        )
        Holding.objects.update(agency=agency)
        Visit.objects.update(agency=agency)
        summarise(self.city, DAY)
        body = self.load(self.client_for(role=Role.SUPER_ADMIN, scope_kind=ScopeKind.CITY))
        row = next(r for r in body["byAgency"] if r["agency"] == agency.id)
        self.assertEqual((row["agencyName"], row["agencyNameBn"]), ("Premier Clean", "প্রিমিয়ার ক্লিন"))

    def test_today_is_reported_live(self):
        body = self.load(self.client_for(role=Role.SUPER_ADMIN, scope_kind=ScopeKind.CITY))
        today = body["today"]
        self.assertEqual(today["date"], "2026-10-09")
        self.assertTrue(today["closed"])
        self.assertEqual(today["cutoff"], "21:00")

    def test_a_city_viewer_sees_only_their_city(self):
        client = self.client_for(role=Role.KCC_VIEWER, scope_kind=ScopeKind.CITY, city=self.scc)
        body = self.load(client, city="KCC")
        self.assertEqual(body["city"]["id"], "SCC")
        self.assertEqual(body["cities"], [])
        self.assertEqual(body["totals"]["due"], 0)

    def test_an_unconfined_viewer_may_pick_a_city(self):
        client = self.client_for(role=Role.KCC_VIEWER, scope_kind=ScopeKind.CITY)
        body = self.load(client, city="SCC")
        self.assertEqual(body["city"]["id"], "SCC")
        self.assertEqual([c["id"] for c in body["cities"]], ["KCC", "SCC"])

    def test_a_ward_supervisor_cannot_open_another_city(self):
        user = User.objects.create_user(
            phone="01900445567", name="Sup", role=Role.SUPERVISOR, scope_kind=ScopeKind.WARD
        )
        user.scope_wards.set([self.ward])
        client = APIClient()
        client.force_authenticate(user)
        response = client.get(reverse("report-city-collection"), {"city": "SCC"})
        self.assertEqual(response.status_code, 400)

    def test_the_series_exports(self):
        client = self.client_for(role=Role.SUPER_ADMIN, scope_kind=ScopeKind.CITY)
        response = client.get(
            reverse("report-city-collection"),
            {"from": DAY.isoformat(), "to": DAY.isoformat(), "format": "csv"},
        )
        self.assertEqual(response.status_code, 200)
        self.assertIn(b"Confirmed by agency", b"".join(response.streaming_content)
                      if hasattr(response, "streaming_content") else response.content)


class CityScopeTests(CollectionDayData):
    def test_a_city_bound_account_sees_only_that_citys_wards(self):
        scc = City.objects.create(id="SCC", name="Sylhet City Corporation")
        zone = Zone.objects.create(id="Z-90", name="Zindabazar", city=scc)
        Ward.objects.create(id="W-90", name="Ward 90", zone=zone)
        user = User.objects.create_user(
            phone="01900445566", name="V", role=Role.KCC_VIEWER,
            scope_kind=ScopeKind.CITY, city=scc,
        )
        self.assertEqual(user.visible_ward_ids(), ["W-90"])

    def test_without_a_city_city_wide_stays_unrestricted(self):
        user = User.objects.create_user(
            phone="01900445566", name="V", role=Role.KCC_VIEWER, scope_kind=ScopeKind.CITY,
        )
        self.assertIsNone(user.visible_ward_ids())

    def test_the_viewer_lands_on_the_city_dashboard(self):
        self.assertEqual(ROLE_HOME[Role.KCC_VIEWER], "/app/city")
        self.assertEqual(Role.KCC_VIEWER.label, "City Viewer")
