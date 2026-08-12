"""The single-agency back-fill, exercised against pre-agency rows.

Running the migration on an empty database proves only that the SQL parses.
What matters is that existing collectors, holdings and vans come out attached to
the one agency with an employment record each — and that nothing else moves.

0002 is data-only: every agency *column* is created by the other apps' schema
migrations, which depend on `agencies.0001` and stay applied while 0002 is
rolled back. So the table shape is identical either side of it, and the real
model classes can be used rather than the historical registry — which would not
work here anyway, since `agencies.0001` has no dependency on `customers` and so
its project state has never heard of `Holding`.
"""

from __future__ import annotations

from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.test import TransactionTestCase

from swms.accounts.models import User
from swms.agencies.models import Agency, CollectorEmployment
from swms.catalog.models import HoldingType, Road, Ward, Zone
from swms.common.ids import IdSequence
from swms.customers.models import Holding
from swms.fieldops.models import Collector

BEFORE = "0001_initial"
AFTER = "0002_backfill_single_agency"


class SingleAgencyBackfillTests(TransactionTestCase):
    available_apps = None

    def _migrate(self, target):
        executor = MigrationExecutor(connection)
        executor.loader.build_graph()
        executor.migrate([("agencies", target)])
        executor.loader.build_graph()

    def setUp(self):
        # Roll the data migration back, then write rows the way they looked
        # before agencies existed: no agency, no employment history.
        self._migrate(BEFORE)

        zone = Zone.objects.create(id="Z-03", name="Sonadanga")
        ward = Ward.objects.create(id="W-14", name="Ward 14 — Sonadanga", zone=zone)
        road = Road.objects.create(name="KDA Avenue", ward=ward)
        htype = HoldingType.objects.create(id="pucca", key="opt.h", label="Pucca")

        Collector.objects.create(name="Rafiq Mia", ward=ward)
        Collector.objects.create(name="Salma Begum", ward=ward)
        for number in ("142/B", "143"):
            Holding.objects.create(
                ward=ward, road=road, holding_no=number,
                holding_type=htype, owner_name=f"Owner {number}",
            )

    def tearDown(self):
        self._migrate(AFTER)

    def test_everything_is_attached_to_one_agency(self):
        self._migrate(AFTER)

        self.assertEqual(Agency.objects.count(), 1)
        agency = Agency.objects.get()
        self.assertEqual(Collector.objects.filter(agency__isnull=True).count(), 0)
        self.assertEqual(Holding.objects.filter(agency__isnull=True).count(), 0)
        self.assertTrue(all(c.agency_id == agency.id for c in Collector.objects.all()))

    def test_every_collector_gets_one_open_employment_record(self):
        self._migrate(AFTER)
        self.assertEqual(CollectorEmployment.objects.count(), 2)
        self.assertEqual(CollectorEmployment.objects.filter(to_date__isnull=True).count(), 2)

    def test_users_are_left_alone(self):
        """Nothing in the data says whether an account is KCC's or the contractor's."""
        self._migrate(AFTER)
        self.assertEqual(User.objects.filter(agency__isnull=False).count(), 0)

    def test_id_sequence_is_advanced_past_the_backfilled_agency(self):
        self._migrate(AFTER)
        self.assertGreaterEqual(IdSequence.objects.get(key="agency").last_value, 1)

    def test_reversing_detaches_without_losing_rows(self):
        self._migrate(AFTER)
        self._migrate(BEFORE)

        self.assertEqual(Collector.objects.count(), 2)
        self.assertEqual(Holding.objects.count(), 2)
        self.assertEqual(Collector.objects.filter(agency__isnull=False).count(), 0)
        self.assertEqual(Agency.objects.count(), 0)
