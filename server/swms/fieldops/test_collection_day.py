"""The collection day: collected unless a holding complains.

Times are pinned rather than read from the clock, because every rule here is
about which side of 21:00 (the cut-off) or 12:00 the next day (the complaint
deadline) something happened on.
"""

from __future__ import annotations

import datetime as dt
from io import StringIO
from unittest import mock

from django.core.management import call_command
from django.core.management.base import CommandError
from django.utils import timezone

from swms.catalog.models import City, Zone
from swms.customers.models import Holding
from swms.common.exceptions import DomainError
from swms.complaints import services as complaint_services
from swms.complaints.models import Complaint, ComplaintType

from .collection_day import close_day, record_missed, summarise
from .models import DailyCollectionSummary, SkipReason, Visit, VisitSource, VisitStatus
from .tests import FieldOpsData

DAY = dt.date(2026, 10, 9)


def at(day, hour, minute=0):
    return timezone.make_aware(dt.datetime.combine(day, dt.time(hour, minute)))


class CollectionDayData(FieldOpsData):
    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()
        cls.city = City.objects.create(id="KCC", name="Khulna City Corporation")
        Zone.objects.filter(pk="Z-03").update(city=cls.city)
        cls.city.refresh_from_db()

    def setUp(self):
        families = [self.make_household(no) for no in ("101", "102", "103", "104")]
        self.route = self.make_route("KDA Avenue", households=families[:3])
        # Everything is holding-wise, so the tests work with the buildings.
        self.a, self.b, self.c, self.unrouted = (f.holding for f in families)
        # Registered before DAY, so all three were due that day.
        Holding.objects.update(created_at=at(DAY, 6) - dt.timedelta(days=30))

    def missed(self, holding, day=DAY):
        return Complaint.objects.create(
            holding=holding, type=ComplaintType.MISSED_COLLECTION, missed_on=day, sla=24
        )

    def visit(self, holding, day=DAY):
        return Visit.objects.get(holding=holding, served_on=day)


class CloseDayTests(CollectionDayData):
    def test_the_day_cannot_close_before_the_cutoff(self):
        with self.assertRaises(DomainError):
            close_day(self.city, DAY, now=at(DAY, 20, 59))

    def test_uncomplained_holdings_are_collected_automatically(self):
        result = close_day(self.city, DAY, now=at(DAY, 21))
        self.assertEqual(result["auto_collected"], 3)
        visit = self.visit(self.a)
        self.assertEqual(visit.status, VisitStatus.COLLECTED)
        self.assertEqual(visit.source, VisitSource.AUTO)
        self.assertEqual(visit.route_id, self.route.id)
        self.assertEqual(timezone.localtime(visit.at).time(), dt.time(21, 0))

    def test_a_holding_that_complained_is_not_collected(self):
        self.missed(self.b)
        result = close_day(self.city, DAY, now=at(DAY, 21))
        self.assertEqual(result, {"city": "KCC", "day": "2026-10-09",
                                  "auto_collected": 2, "auto_missed": 1})
        visit = self.visit(self.b)
        self.assertEqual(visit.status, VisitStatus.SKIPPED)
        self.assertEqual(visit.reason, SkipReason.COMPLAINT)

    def test_a_confirmed_visit_is_left_alone(self):
        Visit.objects.create(
            holding=self.a, status=VisitStatus.COLLECTED, source=VisitSource.SCAN,
            at=at(DAY, 7),
        )
        close_day(self.city, DAY, now=at(DAY, 21))
        self.assertEqual(self.visit(self.a).source, VisitSource.SCAN)

    def test_a_holding_not_on_any_route_is_not_due(self):
        close_day(self.city, DAY, now=at(DAY, 21))
        self.assertFalse(Visit.objects.filter(holding=self.unrouted).exists())

    def test_closing_twice_writes_nothing_new(self):
        close_day(self.city, DAY, now=at(DAY, 21))
        result = close_day(self.city, DAY, now=at(DAY, 21, 15))
        self.assertEqual(result["auto_collected"], 0)
        self.assertEqual(Visit.objects.filter(served_on=DAY).count(), 3)

    def test_a_dry_run_writes_nothing(self):
        result = close_day(self.city, DAY, now=at(DAY, 21), dry_run=True)
        self.assertEqual(result["auto_collected"], 3)
        self.assertFalse(Visit.objects.exists())
        self.assertFalse(DailyCollectionSummary.objects.exists())

    def test_another_citys_holdings_are_untouched(self):
        other = City.objects.create(id="SCC", name="Sylhet City Corporation")
        close_day(other, DAY, now=at(DAY, 21))
        self.assertFalse(Visit.objects.exists())


class SummaryTests(CollectionDayData):
    def test_confirmed_auto_and_missed_are_counted_apart(self):
        Visit.objects.create(
            holding=self.a, status=VisitStatus.COLLECTED, source=VisitSource.SCAN,
            at=at(DAY, 7),
        )
        self.missed(self.c)
        close_day(self.city, DAY, now=at(DAY, 21))

        row = DailyCollectionSummary.objects.get(day=DAY, ward=self.ward)
        self.assertEqual(
            (row.due, row.confirmed, row.auto, row.missed, row.skipped, row.complaints),
            (3, 1, 1, 1, 0, 1),
        )
        self.assertEqual(row.collected, 2)

    def test_rebuilding_replaces_the_rows(self):
        close_day(self.city, DAY, now=at(DAY, 21))
        summarise(self.city, DAY)
        self.assertEqual(DailyCollectionSummary.objects.filter(day=DAY).count(), 1)


class LateComplaintTests(CollectionDayData):
    def test_a_complaint_next_morning_turns_auto_into_missed(self):
        close_day(self.city, DAY, now=at(DAY, 21))
        self.missed(self.a)
        changed = record_missed(self.a, DAY, now=at(DAY + dt.timedelta(days=1), 9))

        self.assertTrue(changed)
        self.assertEqual(self.visit(self.a).reason, SkipReason.COMPLAINT)
        row = DailyCollectionSummary.objects.get(day=DAY, ward=self.ward)
        self.assertEqual((row.auto, row.missed), (2, 1))

    def test_a_scanned_visit_is_not_overturned_by_a_complaint(self):
        Visit.objects.create(
            holding=self.a, status=VisitStatus.COLLECTED, source=VisitSource.SCAN,
            at=at(DAY, 7),
        )
        close_day(self.city, DAY, now=at(DAY, 21))
        self.assertFalse(record_missed(self.a, DAY, now=at(DAY, 22)))
        self.assertEqual(self.visit(self.a).status, VisitStatus.COLLECTED)

    def test_before_the_cutoff_the_complaint_waits_for_the_close(self):
        self.assertFalse(record_missed(self.a, DAY, now=at(DAY, 10)))
        self.assertFalse(Visit.objects.exists())


class OpenComplaintTests(CollectionDayData):
    """The complaint form's `missedOn`, checked against the deadline."""

    def open(self, now, **fields):
        with mock.patch("django.utils.timezone.now", return_value=now):
            return complaint_services.open_complaint(
                holding=self.a, type=ComplaintType.MISSED_COLLECTION, **fields
            )

    def test_missed_on_defaults_to_today(self):
        complaint = self.open(at(DAY, 10))
        self.assertEqual(complaint.missed_on, DAY)

    def test_yesterday_may_be_named_until_noon(self):
        complaint = self.open(at(DAY + dt.timedelta(days=1), 11, 59), missed_on=DAY)
        self.assertEqual(complaint.missed_on, DAY)

    def test_yesterday_is_refused_after_noon(self):
        with self.assertRaises(DomainError) as caught:
            self.open(at(DAY + dt.timedelta(days=1), 12, 0), missed_on=DAY)
        self.assertEqual(caught.exception.code, "missed_on_too_late")

    def test_older_days_are_refused(self):
        with self.assertRaises(DomainError):
            self.open(at(DAY + dt.timedelta(days=2), 9), missed_on=DAY)

    def test_a_late_complaint_flips_the_closed_day(self):
        close_day(self.city, DAY, now=at(DAY, 21))
        self.open(at(DAY + dt.timedelta(days=1), 8), missed_on=DAY)
        self.assertEqual(self.visit(self.a).reason, SkipReason.COMPLAINT)

    def test_other_complaint_types_carry_no_day(self):
        with mock.patch("django.utils.timezone.now", return_value=at(DAY, 10)):
            complaint = complaint_services.open_complaint(
                holding=self.a, type=ComplaintType.OVERFLOW, missed_on=DAY
            )
        self.assertIsNone(complaint.missed_on)


class CommandTests(CollectionDayData):
    def run_command(self, now, *args):
        out = StringIO()
        with mock.patch("django.utils.timezone.now", return_value=now):
            call_command("close_collection_day", *args, stdout=out)
        return out.getvalue()

    def test_after_the_cutoff_today_and_yesterday_are_closed(self):
        output = self.run_command(at(DAY, 21, 5))
        self.assertIn("KCC 2026-10-09: 3 auto-collected", output)
        self.assertIn("KCC 2026-10-08", output)

    def test_before_the_cutoff_only_yesterday_is_closed(self):
        output = self.run_command(at(DAY, 15))
        self.assertNotIn("2026-10-09", output)
        self.assertFalse(Visit.objects.filter(served_on=DAY).exists())

    def test_an_open_day_named_explicitly_is_refused(self):
        with self.assertRaises(CommandError):
            self.run_command(at(DAY, 15), "--date", "2026-10-09")

    def test_an_unknown_city_is_named(self):
        with self.assertRaises(CommandError) as caught:
            self.run_command(at(DAY, 22), "--city", "XYZ")
        self.assertIn("XYZ", str(caught.exception))
