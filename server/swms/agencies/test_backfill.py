"""Giving an agency to the rows that have none.

A back-fill, not a transfer. The distinction is the whole safety property: an
unassigned holding belongs to nobody yet, so naming its contractor is a
correction — but a holding that already names one has a service history, and
moving it would rewrite who did that work. The tests that matter here are the
ones that pin the second case as untouched.
"""

from __future__ import annotations

from io import StringIO

from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase

from swms.catalog.models import Road, Ward, Zone
from swms.customers.models import Holding
from swms.fieldops.models import Route

from .models import Agency


class BackfillAgencyTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        zone = Zone.objects.create(id="Z-03", name="Sonadanga")
        cls.ward = Ward.objects.create(id="W-14", name="Ward 14 — Sonadanga", zone=zone)
        cls.road = Road.objects.create(ward=cls.ward, name="KDA Avenue")
        from swms.catalog.models import HoldingType

        cls.kind = HoldingType.objects.create(
            id="single_storey", key="opt.holdingType.single_storey", label="House"
        )
        cls.inhouse = Agency.objects.create(name="KCC in-house", short_code="KCC")

    def holding(self, number, agency=None):
        return Holding.objects.create(
            ward=self.ward, road=self.road, holding_no=number,
            holding_type=self.kind, owner_name="Owner", agency=agency,
        )

    def run_command(self, *args):
        out = StringIO()
        call_command("backfill_agency", *args, stdout=out)
        return out.getvalue()

    def test_it_assigns_the_unassigned(self):
        holding = self.holding("1/A")
        route = Route.objects.create(id="RT-1", name="Round 1", ward=self.ward)

        self.run_command("--agency", self.inhouse.id)

        holding.refresh_from_db()
        route.refresh_from_db()
        self.assertEqual(holding.agency_id, self.inhouse.id)
        self.assertEqual(route.agency_id, self.inhouse.id)

    def test_it_never_moves_a_row_that_already_has_one(self):
        """The one thing this must not do. A holding with an agency has a
        service history behind it, and reassigning would rewrite whose it was."""
        rival = Agency.objects.create(name="Rival Clean", short_code="RVL")
        theirs = self.holding("2/B", agency=rival)

        self.run_command("--agency", self.inhouse.id)

        theirs.refresh_from_db()
        self.assertEqual(theirs.agency_id, rival.id)

    def test_a_dry_run_writes_nothing(self):
        holding = self.holding("3/C")
        report = self.run_command("--agency", self.inhouse.id, "--dry-run")

        self.assertIn("would be assigned", report)
        holding.refresh_from_db()
        self.assertIsNone(holding.agency_id)

    def test_running_twice_is_a_no_op(self):
        self.holding("4/D")
        self.run_command("--agency", self.inhouse.id)
        self.assertIn("Nothing to do", self.run_command("--agency", self.inhouse.id))

    def test_an_unknown_agency_is_refused(self):
        self.holding("5/E")
        with self.assertRaises(CommandError) as caught:
            self.run_command("--agency", "AGN-NOPE")
        self.assertIn("AGN-NOPE", str(caught.exception))

    def test_it_will_not_guess_between_two_agencies(self):
        """Picking one would be picking who gets paid for this work."""
        Agency.objects.create(name="Rival Clean", short_code="RVL")
        self.holding("6/F")
        with self.assertRaises(CommandError) as caught:
            self.run_command()
        self.assertIn("--agency", str(caught.exception))

    def test_it_may_guess_when_there_is_only_one(self):
        self.assertEqual(Agency.objects.count(), 1)
        holding = self.holding("7/G")
        self.run_command()
        holding.refresh_from_db()
        self.assertEqual(holding.agency_id, self.inhouse.id)

    # Households are deliberately not touched, and not tested here: a household
    # is scoped through `holding__agency_id`, so fixing the building is what
    # makes them visible. That traversal is Django's, and the agency tenancy
    # tests already cover it — reproducing it would need a fixture with six
    # unrelated foreign keys to assert something this command does not do.
