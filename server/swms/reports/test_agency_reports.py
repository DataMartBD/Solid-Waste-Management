"""Agency Reports: the collector scorecard and the City Dashboard reports narrowed to one agency."""

from __future__ import annotations

import datetime as dt

from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient

from swms.accounts.models import ScopeKind, User
from swms.agencies.models import Agency
from swms.agencies.services import transfer_collector
from swms.common.roles import Role
from swms.customers.models import Holding
from swms.fieldops.models import Collector, Visit, VisitSource, VisitStatus
from swms.fieldops.test_collection_day import DAY, CollectionDayData, at

from . import oversight


class AgencyReportData(CollectionDayData):
    def setUp(self):
        super().setUp()
        self.green = Agency.objects.create(name="Green Co", short_code="GRN", target_holdings=10)
        self.green.cities.set([self.city])
        self.far = Agency.objects.create(name="Far Co", short_code="FAR")
        self.far.cities.set([self.city])
        Holding.objects.update(agency=self.green)
        self.rahim = self.make_collector("Rahim")
        self.karim = self.make_collector("Karim")
        # Through the service, so payments are stamped with the employer of the day.
        transfer_collector(self.rahim, self.green, on_date=DAY - dt.timedelta(days=60))
        transfer_collector(self.karim, self.far, on_date=DAY - dt.timedelta(days=60))
        Collector.objects.filter(pk=self.rahim.pk).update(on_time=80)
        self.rahim.refresh_from_db()
        # Rahim served two of Green's four buildings in October.
        for h in (self.a, self.b):
            Visit.objects.create(holding=h, collector=self.rahim, agency=self.green, route=self.route,
                                 status=VisitStatus.COLLECTED, source=VisitSource.SCAN, at=at(DAY, 7))

    def client_for(self, role, **fields):
        user = User.objects.create_user(phone=f"0190055{User.objects.count():04d}", name=role,
                                        role=role, **fields)
        client = APIClient()
        client.force_authenticate(user)
        return client


class AgencyReportTests(AgencyReportData):
    def test_the_scorecard_measures_each_collector(self):
        rows = oversight.collector_scorecard(period="2026-10", agency_id=self.green.id)["rows"]
        self.assertEqual([r["name"] for r in rows], ["Rahim"])
        row = rows[0]
        self.assertEqual((row["holdings"], row["served"], row["coverage"]), (4, 2, 50.0))
        self.assertEqual(row["onTime"], 80)
        # 40% of 50 + 30% of 0 + 20% of 80 + 10% of 100 (no complaints)
        self.assertEqual(row["score"], 46.0)
        self.assertEqual(row["rank"], 1)

    def test_an_agency_admin_sees_only_their_own_collectors(self):
        boss = self.client_for(Role.AGENCY_ADMIN, scope_kind=ScopeKind.AGENCY, agency=self.green)
        rows = boss.get(reverse("report-agency-scorecard"), {"period": "2026-10", "agency": self.far.id}).json()["rows"]
        self.assertEqual({r["name"] for r in rows}, {"Rahim"})

    def test_a_super_admin_may_pick_an_agency(self):
        admin = self.client_for(Role.SUPER_ADMIN)
        url = reverse("report-agency-scorecard")
        self.assertEqual({r["name"] for r in admin.get(url, {"period": "2026-10"}).json()["rows"]},
                         {"Rahim", "Karim"})
        self.assertEqual({r["name"] for r in admin.get(url, {"period": "2026-10", "agency": self.far.id}).json()["rows"]},
                         {"Karim"})

    def test_the_contract_report_shows_the_rank_not_the_others(self):
        boss = self.client_for(Role.AGENCY_ADMIN, scope_kind=ScopeKind.AGENCY, agency=self.green)
        data = boss.get(reverse("report-agency-contract")).json()
        self.assertEqual({r["agency"] for r in data["league"]}, {self.green.id})
        self.assertEqual(data["rank"], 1)
        self.assertGreaterEqual(data["of"], 1)
        self.assertEqual([t["agency"] for t in data["targets"]], [self.green.id])

    def test_who_may_open_agency_reports(self):
        viewer = self.client_for(Role.KCC_VIEWER, scope_kind=ScopeKind.CITY)
        boss = self.client_for(Role.AGENCY_ADMIN, scope_kind=ScopeKind.AGENCY, agency=self.green)
        for name in ("report-agency-scorecard", "report-agency-complaint-performance",
                     "report-agency-complaints-overdue", "report-agency-contract"):
            self.assertEqual(viewer.get(reverse(name)).status_code, 403, name)
            self.assertEqual(boss.get(reverse(name)).status_code, 200, name)
        for kind in ("collectors", "supervisors", "vans", "documents"):
            self.assertEqual(boss.get(reverse("report-agency-register", args=[kind])).status_code, 200, kind)
        self.assertEqual(boss.get(reverse("report-agency-register", args=["agencies"])).status_code, 400)


class AgencyMoneyTests(AgencyReportData):
    """Cash still in a collector's hand, and unpaid bills by age."""

    def bill(self, holding, period, due_on, amount=300):
        from swms.billing.models import Bill
        from swms.common.ids import bill_id

        return Bill.objects.create(id=bill_id(period, holding.id), holding=holding, ward=holding.ward, period=period,
                                   issued_at=due_on, due_on=due_on, amount=amount, status="unpaid")

    def pay(self, bill, amount, day):
        from swms.billing.models import Payment

        return Payment.objects.create(bill=bill, holding=bill.holding, collector=self.rahim,
                                      amount=amount, method=self.payment_mode, at=at(day, 10))

    def test_cash_not_handed_in_is_aged_from_the_oldest_payment(self):
        import datetime as dt

        from swms.reports import agency_money

        bill = self.bill(self.a, "2026-10", DAY)
        self.pay(bill, 100, DAY)
        self.pay(bill, 50, DAY + dt.timedelta(days=5))
        data = agency_money.cash_in_hand(agency_id=self.green.id, today=DAY + dt.timedelta(days=10))
        row = data["rows"][0]
        self.assertEqual((row["name"], row["amount"], row["payments"], row["days"]), ("Rahim", 150, 2, 10))
        self.assertEqual(row["status"], "overdue")
        self.assertEqual(agency_money.cash_in_hand(agency_id=self.far.id)["rows"], [])

    def test_dues_are_split_by_days_past_due(self):
        import datetime as dt

        from swms.reports import agency_money

        today = DAY + dt.timedelta(days=100)
        old = self.bill(self.a, "2026-06", DAY - dt.timedelta(days=0))      # 100 days late
        self.bill(self.a, "2026-12", today + dt.timedelta(days=5))           # not due yet
        mid = self.bill(self.b, "2026-11", today - dt.timedelta(days=45))    # 45 days late
        self.pay(mid, 100, today)
        data = agency_money.dues_ageing(agency_id=self.green.id, today=today)
        self.assertEqual(data["totals"]["d90"], 300)
        self.assertEqual(data["totals"]["d31_60"], 200)
        self.assertEqual(data["totals"]["notDue"], 300)
        first = data["rows"][0]
        self.assertEqual((first["holding"], first["outstanding"], first["oldestPeriod"]), (self.a.id, 600, "2026-06"))
        self.assertEqual(old.holding_id, first["holding"])
        wards = agency_money.dues_ageing(by="ward", agency_id=self.green.id, today=today)["rows"]
        self.assertEqual((wards[0]["holdings"], wards[0]["outstanding"]), (2, 800))

    def test_money_reports_open_for_agency_people_only(self):
        viewer = self.client_for(Role.KCC_VIEWER, scope_kind=ScopeKind.CITY)
        boss = self.client_for(Role.AGENCY_ADMIN, scope_kind=ScopeKind.AGENCY, agency=self.green)
        for name in ("report-agency-cash-in-hand", "report-agency-dues-ageing"):
            self.assertEqual(viewer.get(reverse(name)).status_code, 403, name)
            self.assertEqual(boss.get(reverse(name)).status_code, 200, name)


class AgencyOpsTests(AgencyReportData):
    """The daily collection sheet, and missed & skipped holdings."""

    def setUp(self):
        super().setUp()
        self.assign(self.rahim, [self.route])
        before = DAY - dt.timedelta(days=1)
        # c: skipped by Rahim the day before (nobody home), then missed by complaint
        # on DAY — the cut-off's visit carries no collector, only the route.
        Visit.objects.create(holding=self.c, collector=self.rahim, agency=self.green, route=self.route,
                             status=VisitStatus.SKIPPED, reason="noOne", source=VisitSource.SCAN, at=at(before, 8))
        Visit.objects.create(holding=self.c, agency=self.green, route=self.route, status=VisitStatus.SKIPPED,
                             reason="complaint", source=VisitSource.AUTO, at=at(DAY, 21))

    def test_the_sheet_counts_each_collectors_day(self):
        from swms.reports import agency_ops

        data = agency_ops.collection_sheet(date_from=DAY - dt.timedelta(days=1), date_to=DAY,
                                           agency_id=self.green.id)
        rows = {(r["day"], r["name"]): r for r in data["rows"]}
        today = rows[(DAY.isoformat(), "Rahim")]
        self.assertEqual((today["due"], today["confirmed"], today["missed"], today["collectedPct"]), (3, 2, 1, 67))
        before = rows[((DAY - dt.timedelta(days=1)).isoformat(), "Rahim")]
        self.assertEqual((before["due"], before["skipped"], before["notRecorded"]), (3, 1, 2))
        self.assertEqual(data["rows"][0]["day"], DAY.isoformat())  # newest first

    def test_missed_holdings_list_how_often_and_why(self):
        from swms.reports import agency_ops

        data = agency_ops.missed_holdings(date_from=DAY - dt.timedelta(days=5), date_to=DAY,
                                          agency_id=self.green.id)
        self.assertEqual((data["holdings"], data["repeat"], data["missed"], data["skipped"]), (1, 1, 1, 1))
        row = data["rows"][0]
        self.assertEqual((row["holding"], row["times"], row["collectorName"]), (self.c.id, 2, "Rahim"))
        self.assertIn("No one home", row["reasons"])
        self.assertEqual(agency_ops.missed_holdings(date_from=DAY, date_to=DAY, agency_id=self.far.id)["rows"], [])

    def test_daily_reports_open_for_agency_people_only(self):
        viewer = self.client_for(Role.KCC_VIEWER, scope_kind=ScopeKind.CITY)
        boss = self.client_for(Role.AGENCY_ADMIN, scope_kind=ScopeKind.AGENCY, agency=self.green)
        for name in ("report-agency-collection-sheet", "report-agency-missed-holdings"):
            self.assertEqual(viewer.get(reverse(name)).status_code, 403, name)
            self.assertEqual(boss.get(reverse(name)).status_code, 200, name)


class AgencyFleetTests(AgencyReportData):
    """Fuel per van per month, and maintenance history."""

    def setUp(self):
        from swms.fleet.models import Van

        super().setUp()
        self.van = Van.objects.create(plate="KHULNA-T-1", type="pickup", capacity=1000, fuel="diesel",
                                      agency=self.green, driver=self.rahim, kmpl=8, odometer=10500,
                                      next_service_km=10800)
        self.far_van = Van.objects.create(plate="KHULNA-T-2", type="pickup", capacity=1000, fuel="diesel",
                                          agency=self.far)

    def test_fuel_gives_distance_economy_and_cost_per_holding(self):
        from swms.fleet.models import FuelLog
        from swms.fieldops.models import Visit as V
        from swms.reports import agency_fleet

        FuelLog.objects.create(van=self.van, litres=20, cost=2400, odometer=10000, at=at(DAY - dt.timedelta(days=40), 9))
        FuelLog.objects.create(van=self.van, litres=25, cost=3000, odometer=10150, at=at(DAY, 9))  # 150 km → 6 km/l
        V.objects.filter(holding__in=[self.a, self.b]).update(van=self.van)
        data = agency_fleet.fuel_report(period="2026-10", agency_id=self.green.id)
        row = data["rows"][0]
        self.assertEqual((row["id"], row["fills"], row["cost"], row["km"]), (self.van.id, 1, 3000, 150))
        self.assertEqual(row["kmpl"], 6.0)
        self.assertTrue(row["check"])  # 6 km/l against a usual 8
        self.assertEqual((row["holdings"], row["costPerHolding"], row["costPerKm"]), (2, 1500.0, 20.0))
        self.assertEqual(row["costBefore"], 0)
        self.assertEqual(agency_fleet.fuel_report(period="2026-10", agency_id=self.far.id)["rows"], [])

    def test_maintenance_counts_jobs_cost_and_days_off_the_road(self):
        from swms.fleet.models import Maintenance
        from swms.reports import agency_fleet

        Maintenance.objects.create(van=self.van, kind="scheduled", reason="Oil change", odometer=10400,
                                   opened=at(DAY, 8), closed=at(DAY, 20), downtime=12, cost=1500)
        Maintenance.objects.create(van=self.van, kind="unscheduled", reason="Puncture", odometer=10450,
                                   opened=at(DAY + dt.timedelta(days=2), 8), cost=400)
        data = agency_fleet.maintenance_report(date_from=DAY - dt.timedelta(days=10), date_to=DAY + dt.timedelta(days=10),
                                               agency_id=self.green.id)
        row = data["rows"][0]
        self.assertEqual((row["jobs"], row["scheduled"], row["unscheduled"], row["cost"], row["open"]), (2, 1, 1, 1900, 1))
        self.assertEqual(row["serviceDueIn"], 300)
        self.assertEqual(row["lastReason"], "Puncture")
        self.assertEqual(len(data["jobs"]), 2)
        self.assertGreater(row["downtimeDays"], 0.5)  # the open job counts until now

    def test_fleet_reports_open_for_agency_people_only(self):
        viewer = self.client_for(Role.KCC_VIEWER, scope_kind=ScopeKind.CITY)
        boss = self.client_for(Role.AGENCY_ADMIN, scope_kind=ScopeKind.AGENCY, agency=self.green)
        for name in ("report-agency-fuel", "report-agency-maintenance"):
            self.assertEqual(viewer.get(reverse(name)).status_code, 403, name)
            self.assertEqual(boss.get(reverse(name)).status_code, 200, name)


class AgencyMoreTests(AgencyReportData):
    """Survey progress, repeat complaints, route completion and billing runs."""

    def setUp(self):
        super().setUp()
        self.assign(self.rahim, [self.route])
        type(self.route).objects.filter(pk=self.route.pk).update(agency=self.green)

    def test_survey_progress_per_surveyor_and_ward_coverage(self):
        from swms.reports import agency_more
        from swms.surveys.models import Survey, SurveyForm

        form = SurveyForm.objects.create(code="d2d-t", version=1, title="Door to door")
        Survey.objects.create(form=form, surveyor=self.rahim, agency=self.green, ward=self.ward,
                              surveyed_on=DAY, status="reviewed", holding=self.a)
        Survey.objects.create(form=form, surveyor=self.rahim, agency=self.green, ward=self.ward,
                              surveyed_on=DAY, status="converted", converted_to=self.b)
        Survey.objects.create(form=form, surveyor_name="Volunteer", agency=self.green, ward=self.ward,
                              surveyed_on=DAY - dt.timedelta(days=1), status="draft")
        rows = agency_more.survey_progress(date_from=DAY - dt.timedelta(days=5), date_to=DAY,
                                           agency_id=self.green.id)["rows"]
        rahim = next(r for r in rows if r["name"] == "Rahim")
        self.assertEqual((rahim["surveys"], rahim["converted"], rahim["daysWorked"], rahim["conversion"]), (2, 1, 1, 50.0))
        self.assertIn("Volunteer", {r["name"] for r in rows})
        ward = agency_more.survey_progress(date_from=DAY, date_to=DAY, by="ward", agency_id=self.green.id)["rows"][0]
        self.assertEqual((ward["holdings"], ward["surveyed"], ward["coverage"], ward["notSurveyed"]), (4, 2, 50.0, 2))

    def test_repeat_complaints_lists_holdings_that_keep_complaining(self):
        from swms.reports import agency_more

        for _ in range(2):
            self.missed(self.c)
        self.missed(self.a)
        data = agency_more.repeat_complaints(date_from=DAY - dt.timedelta(days=30),
                                             date_to=timezone.localdate(), agency_id=self.green.id)
        self.assertEqual([r["holding"] for r in data["rows"]], [self.c.id])
        self.assertEqual((data["rows"][0]["complaints"], data["rows"][0]["mainType"]), (2, "missed_collection"))

    def test_route_completion_measures_stops_and_finish_time(self):
        from swms.reports import agency_more

        data = agency_more.route_completion(date_from=DAY, date_to=DAY, agency_id=self.green.id)
        row = data["rows"][0]
        self.assertEqual((row["route"], row["stops"], row["served"], row["completion"]), (self.route.id, 3, 2, 66.7))
        self.assertEqual((row["last"], row["onTime"], row["collectorName"]), ("07:00", True, "Rahim"))
        by_route = agency_more.route_completion(date_from=DAY - dt.timedelta(days=1), date_to=DAY, by="route",
                                                agency_id=self.green.id)["rows"][0]
        self.assertEqual((by_route["days"], by_route["notStarted"], by_route["onTimePct"]), (2, 1, 100.0))

    def test_billing_runs_by_month_and_by_ward(self):
        from swms.billing.models import Bill, Payment
        from swms.common.ids import bill_id
        from swms.reports import agency_more

        for h in (self.a, self.b):
            Bill.objects.create(id=bill_id("2026-10", h.id), holding=h, ward=h.ward, period="2026-10",
                                issued_at=DAY, due_on=DAY, amount=200)
        Payment.objects.create(bill=Bill.objects.get(holding=self.a), collector=self.rahim, amount=200,
                               method=self.payment_mode, at=at(DAY, 10))
        month = agency_more.billing_runs(agency_id=self.green.id)["rows"][0]
        self.assertEqual((month["period"], month["bills"], month["amount"], month["collected"]), ("2026-10", 2, 400, 200))
        self.assertEqual((month["paid"], month["unpaid"], month["collectionPct"]), (1, 1, 50.0))
        ward = agency_more.billing_runs(period="2026-10", agency_id=self.green.id)["rows"][0]
        self.assertEqual((ward["ward"], ward["outstanding"]), (self.ward.id, 200))

    def test_these_reports_open_for_agency_people_only(self):
        viewer = self.client_for(Role.KCC_VIEWER, scope_kind=ScopeKind.CITY)
        boss = self.client_for(Role.AGENCY_ADMIN, scope_kind=ScopeKind.AGENCY, agency=self.green)
        for name in ("report-agency-survey-progress", "report-agency-repeat-complaints",
                     "report-agency-route-completion", "report-agency-billing-runs"):
            self.assertEqual(viewer.get(reverse(name)).status_code, 403, name)
            self.assertEqual(boss.get(reverse(name)).status_code, 200, name)


class AgencyPackTests(AgencyReportData):
    """Day-by-day attendance, and the monthly pack."""

    def setUp(self):
        super().setUp()
        self.assign(self.rahim, [self.route])
        type(self.route).objects.filter(pk=self.route.pk).update(agency=self.green)

    def test_marking_attendance_keeps_a_day_by_day_history(self):
        from unittest import mock

        from swms.fieldops.models import AttendanceDay
        from swms.fieldops.services import set_attendance

        morning = at(DAY, 6)
        with mock.patch("django.utils.timezone.now", return_value=morning):
            set_attendance(self.karim, "checked_in")
        with mock.patch("django.utils.timezone.now", return_value=at(DAY, 9)):
            set_attendance(self.karim, "absent")       # corrected later that day
            set_attendance(self.karim, "checked_in")   # and back
        row = AttendanceDay.objects.get(collector=self.karim, day=DAY)
        self.assertEqual((row.status, row.first_in), ("checked_in", morning))
        self.assertEqual(AttendanceDay.objects.count(), 1)

    def test_attendance_counts_marks_and_work(self):
        from swms.fieldops.models import AttendanceDay
        from swms.reports import agency_pack

        before = DAY - dt.timedelta(days=1)
        AttendanceDay.objects.create(collector=self.rahim, day=before, status="absent")
        # On DAY Rahim was never marked in, but scanned at 07:00 — present, and
        # late against a 06:00 window (the route default).
        data = agency_pack.attendance(period="2026-10", by="day", agency_id=self.green.id, today=DAY)
        days = {r["day"]: r for r in data["rows"]}
        self.assertEqual(days[DAY.isoformat()]["status"], "present")
        self.assertEqual(days[DAY.isoformat()]["firstScan"], "07:00")
        self.assertEqual(days[before.isoformat()]["status"], "absent")
        totals = agency_pack.attendance(period="2026-10", agency_id=self.green.id, today=DAY)["rows"][0]
        self.assertEqual((totals["days"], totals["present"], totals["absent"]), (DAY.day, 1, 1))
        self.assertEqual(totals["noRecord"], DAY.day - 2)

    def test_the_monthly_pack_previews_and_prints(self):
        boss = self.client_for(Role.AGENCY_ADMIN, scope_kind=ScopeKind.AGENCY, agency=self.green)
        data = boss.get(reverse("report-agency-monthly-pack"), {"period": "2026-10"}).json()
        self.assertEqual(data["period"], "2026-10")
        self.assertIn("Collector scorecard", [s["title"] for s in data["sections"]])
        scorecard = next(s for s in data["sections"] if s["title"] == "Collector scorecard")
        self.assertEqual([r["name"] for r in scorecard["rows"]], ["Rahim"])
        pdf = boss.get(reverse("report-agency-monthly-pack"), {"period": "2026-10", "format": "pdf"})
        self.assertEqual(pdf.status_code, 200)
        self.assertEqual(pdf["Content-Type"], "application/pdf")
        self.assertTrue(pdf.content.startswith(b"%PDF"))

    def test_attendance_and_pack_open_for_agency_people_only(self):
        viewer = self.client_for(Role.KCC_VIEWER, scope_kind=ScopeKind.CITY)
        for name in ("report-agency-attendance", "report-agency-monthly-pack"):
            self.assertEqual(viewer.get(reverse(name)).status_code, 403, name)


class ReportsRestructureTests(AgencyOpsTests):
    """The merged pages: a day view of the daily sheet, and the agency pick everywhere."""

    def test_the_daily_collection_has_a_day_view(self):
        from swms.reports import agency_ops

        rows = agency_ops.collection_sheet(date_from=DAY - dt.timedelta(days=1), date_to=DAY, by="day",
                                           agency_id=self.green.id)["rows"]
        self.assertEqual([r["day"] for r in rows], [DAY.isoformat(), (DAY - dt.timedelta(days=1)).isoformat()])
        self.assertEqual((rows[0]["due"], rows[0]["confirmed"], rows[0]["missed"], rows[0]["collectedPct"]), (3, 2, 1, 67))

    def test_a_super_admin_can_narrow_older_reports_to_one_agency(self):
        admin = self.client_for(Role.SUPER_ADMIN)
        rows = admin.get(reverse("report-waste-collection"), {"mode": "monthly", "agency": self.far.id}).json()["rows"]
        self.assertEqual(rows, [])
        self.assertEqual(admin.get(reverse("report-waste-collection"), {"agency": "NOPE"}).status_code, 400)
        boss = self.client_for(Role.AGENCY_ADMIN, scope_kind=ScopeKind.AGENCY, agency=self.green)
        # An agency user's own agency wins over anything asked for.
        self.assertEqual(boss.get(reverse("report-agency-scorecard"), {"agency": self.far.id,
                                                                       "period": "2026-10"}).json()["rows"][0]["name"], "Rahim")


class DailyDashboardAccessTests(AgencyReportData):
    def test_the_city_viewer_cannot_read_the_daily_dashboard(self):
        viewer = self.client_for(Role.KCC_VIEWER, scope_kind=ScopeKind.CITY)
        response = viewer.get(reverse("report-dashboard"))
        self.assertEqual(response.status_code, 403)
        self.assertIn("City Dashboard", response.json()["detail"])
        for role, fields in ((Role.SUPER_ADMIN, {}), (Role.SUPERVISOR, {"scope_kind": ScopeKind.CITY}),
                             (Role.AGENCY_ADMIN, {"scope_kind": ScopeKind.AGENCY, "agency": self.green})):
            self.assertEqual(self.client_for(role, **fields).get(reverse("report-dashboard")).status_code, 200, role)


class DailyAttendanceResetTests(AgencyReportData):
    def test_yesterdays_check_in_becomes_absent_today(self):
        from unittest import mock

        from swms.fieldops.models import AttendanceDay
        from swms.fieldops.services import reset_daily_attendance, set_attendance

        with mock.patch("django.utils.timezone.now", return_value=at(DAY, 6)):
            set_attendance(self.rahim, "checked_in")    # checked in on DAY
        next_day = DAY + dt.timedelta(days=1)
        with mock.patch("django.utils.timezone.now", return_value=at(next_day, 6)):
            set_attendance(self.karim, "checked_in")    # checked in on the next day
        self.assertEqual(reset_daily_attendance(today=next_day, dry_run=True), 1)
        self.assertEqual(reset_daily_attendance(today=next_day), 1)
        self.rahim.refresh_from_db()
        self.karim.refresh_from_db()
        self.assertEqual((self.rahim.attendance, self.karim.attendance), ("absent", "checked_in"))
        # Not a real absence: no history row is written for the reset.
        self.assertFalse(AttendanceDay.objects.filter(collector=self.rahim, day=next_day).exists())
        self.assertEqual(reset_daily_attendance(today=next_day), 0)  # idempotent

    def test_close_collection_day_also_resets(self):
        from io import StringIO

        from django.core.management import call_command

        Collector.objects.filter(pk=self.rahim.pk).update(attendance="checked_in")
        out = StringIO()
        call_command("close_collection_day", "--dry-run", stdout=out)
        self.assertIn("reset to absent", out.getvalue())
        call_command("reset_attendance", stdout=StringIO())
        self.rahim.refresh_from_db()
        self.assertEqual(self.rahim.attendance, "absent")

    def test_a_new_collector_starts_not_checked_in(self):
        self.assertEqual(self.make_collector("Newcomer").attendance, "absent")
