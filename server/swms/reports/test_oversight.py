"""City Oversight: service growth, complaints, registers, targets — no money."""

from __future__ import annotations

import datetime as dt

from django.urls import reverse
from rest_framework.test import APIClient

from swms.accounts.models import ScopeKind, User
from swms.agencies.models import Agency
from django.utils import timezone

from swms.catalog.models import City, Road, Ward, Zone
from swms.common.roles import Role
from swms.customers.models import Holding
from swms.fieldops.models import Visit, VisitSource, VisitStatus
from swms.fieldops.test_collection_day import DAY, CollectionDayData, at

from . import oversight


class OversightTests(CollectionDayData):
    def setUp(self):
        super().setUp()
        self.agency = Agency.objects.create(name="Green Co", short_code="GRN", target_holdings=4)
        Holding.objects.update(agency=self.agency)
        prev = DAY - dt.timedelta(days=31)
        # Last month: one building served. This month: two.
        Visit.objects.create(holding=self.a, status=VisitStatus.COLLECTED, source=VisitSource.SCAN, at=at(prev, 7))
        for h in (self.a, self.b):
            Visit.objects.create(holding=h, status=VisitStatus.COLLECTED, source=VisitSource.SCAN, at=at(DAY, 7))

    def client_for(self, role, **fields):
        user = User.objects.create_user(phone=f"0190044{User.objects.count():04d}", name=role,
                                        role=role, **fields)
        client = APIClient()
        client.force_authenticate(user)
        return client

    def test_service_trend_shows_growth(self):
        rows = oversight.service_trend(count=2, by="agency", today=DAY)
        now = next(r for r in rows if r["period"] == "2026-10")
        self.assertEqual((now["registered"], now["served"]), (4, 2))
        self.assertEqual((now["change"], now["trend"]), (1, "up"))

    def test_service_trend_by_collector_and_ward(self):
        self.assertTrue(oversight.service_trend(count=1, by="ward", today=DAY))
        oversight.service_trend(count=1, by="collector", today=DAY)
        oversight.service_trend(count=1, by="supervisor", today=DAY)

    def test_targets_compare_served_with_the_contract(self):
        rows = oversight.agency_targets(period="2026-10")["rows"]
        row = next(r for r in rows if r["agency"] == self.agency.id)
        self.assertEqual((row["target"], row["served"], row["achievement"]), (4, 2, 50.0))
        self.assertEqual(row["status"], "poor")

    def test_complaints_are_measured_against_their_deadline(self):
        complaint = self.missed(self.c)
        complaint.resolved_at = complaint.opened + dt.timedelta(hours=5)
        complaint.status = "resolved"
        complaint.save()
        day = timezone.localtime(complaint.opened).date()
        rows = oversight.complaint_performance(date_from=day, date_to=day, by="agency")
        row = rows[0]
        self.assertEqual((row["received"], row["resolved"], row["withinSla"]), (1, 1, 1))
        self.assertEqual(row["slaPct"], 100.0)

    def test_the_viewer_and_super_admin_may_open_it_no_one_else(self):
        viewer = self.client_for(Role.KCC_VIEWER, scope_kind=ScopeKind.CITY)
        boss = self.client_for(Role.AGENCY_ADMIN, scope_kind=ScopeKind.AGENCY, agency=self.agency)
        for name in ("report-service-trend", "report-complaint-performance", "report-complaints-overdue",
                     "report-agency-targets", "report-oversight"):
            self.assertEqual(viewer.get(reverse(name)).status_code, 200, name)
            self.assertEqual(boss.get(reverse(name)).status_code, 403, name)
        for kind in ("agencies", "collectors", "supervisors", "vans", "documents"):
            self.assertEqual(viewer.get(reverse("report-register", args=[kind])).status_code, 200, kind)

    def test_a_viewer_given_a_city_sees_that_city_only(self):
        far = City.objects.create(id="SCC", name="Sylhet")
        ward = Ward.objects.create(id="W-90", name="90", zone=Zone.objects.create(id="Z-90", name="Z", city=far))
        other = Agency.objects.create(name="Far Co", short_code="FAR")
        other.cities.set([far])
        Holding.objects.create(ward=ward, road=Road.objects.create(ward=ward, name="Far Rd"),
                               holding_no="9", owner_name="X", agency=other,
                               holding_type=self.a.holding_type)
        viewer = self.client_for(Role.KCC_VIEWER, scope_kind=ScopeKind.CITY, city=self.city)
        names = {r["name"] for r in viewer.get(reverse("report-register", args=["agencies"])).json()["rows"]}
        self.assertNotIn("Far Co", names)
        rows = viewer.get(reverse("report-service-trend")).json()["rows"]
        self.assertNotIn(other.id, {r["group"] for r in rows})

    def test_a_super_admin_picks_the_city_every_tab_reports_on(self):
        far = City.objects.create(id="SCC", name="Sylhet")
        ward = Ward.objects.create(id="W-91", name="91", zone=Zone.objects.create(id="Z-91", name="Z", city=far))
        other = Agency.objects.create(name="Far Co", short_code="FAR")
        other.cities.set([far])
        Holding.objects.create(ward=ward, road=Road.objects.create(ward=ward, name="Far Rd"),
                               holding_no="9", owner_name="X", agency=other,
                               holding_type=self.a.holding_type)
        admin = self.client_for(Role.SUPER_ADMIN)

        summary = admin.get(reverse("report-oversight"), {"city": "SCC"}).json()
        self.assertEqual(summary["city"]["id"], "SCC")
        self.assertEqual({c["id"] for c in summary["cities"]}, {"KCC", "SCC"})
        self.assertEqual(summary["registered"], 1)
        self.assertIn("pickupToday", summary)
        names = {r["name"] for r in admin.get(reverse("report-register", args=["agencies"]),
                                              {"city": "SCC"}).json()["rows"]}
        self.assertEqual(names, {"Far Co"})

        home = admin.get(reverse("report-oversight"), {"city": "KCC"}).json()
        row = next(r for r in home["league"] if r["agency"] == self.agency.id)
        self.assertIn("collectedPct", row)
        self.assertIn("missed", row)
        self.assertNotIn(other.id, {r["agency"] for r in home["league"]})

    def test_a_city_viewer_cannot_pick_another_city(self):
        City.objects.create(id="SCC", name="Sylhet")
        viewer = self.client_for(Role.KCC_VIEWER, scope_kind=ScopeKind.CITY, city=self.city)
        summary = viewer.get(reverse("report-oversight"), {"city": "SCC"}).json()
        self.assertEqual(summary["city"]["id"], "KCC")
        self.assertEqual(summary["cities"], [])
