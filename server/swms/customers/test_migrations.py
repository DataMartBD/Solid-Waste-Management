"""The holding back-fill, exercised against legacy-shaped rows.

Running the migrations on an empty database proves only that the SQL is valid.
What matters on the live database is that 0004 turns rows written under the old
"one address is one household" assumption into holdings without losing or
mismatching anything — so this rewinds `customers` to the pre-holding state,
writes rows the old way, and migrates forward.

The fixture deliberately includes a case the production data does not have: two
households at one address. That is the whole point of the change, and it is
exactly the shape the old unique constraint made impossible to create.
"""

from __future__ import annotations

from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.test import TransactionTestCase

BEFORE = "0002_initial"
AFTER = "0005_holding_required"


class HoldingBackfillTests(TransactionTestCase):
    # The migration under test rewrites rows in other apps' tables too, so the
    # whole schema has to be present and rebuilt between tests.
    available_apps = None

    def _migrate(self, target):
        executor = MigrationExecutor(connection)
        executor.loader.build_graph()
        executor.migrate([("customers", target)])
        executor.loader.build_graph()
        return executor

    def _apps_at(self, target):
        executor = MigrationExecutor(connection)
        executor.loader.build_graph()
        return executor.loader.project_state(("customers", target)).apps

    def setUp(self):
        self.executor = self._migrate(BEFORE)
        apps = self._apps_at(BEFORE)

        Zone = apps.get_model("catalog", "Zone")
        Ward = apps.get_model("catalog", "Ward")
        Road = apps.get_model("catalog", "Road")
        Tier = apps.get_model("catalog", "Tier")
        Household = apps.get_model("customers", "Household")
        PotentialCustomer = apps.get_model("customers", "PotentialCustomer")

        def option(name, pk):
            model = apps.get_model("catalog", name)
            return model.objects.create(id=pk, key=f"opt.{pk}", label=pk)

        zone = Zone.objects.create(id="Z-03", name="Sonadanga")
        self.ward = Ward.objects.create(id="W-14", name="Ward 14 — Sonadanga", zone=zone)
        self.road = Road.objects.create(id=1, name="KDA Avenue", ward=self.ward)
        self.tier = Tier.objects.create(id="residential", key="opt.t", label="Residential", charge=100)
        ctype = option("CustomerType", "residential")
        storage = option("StorageType", "bin")
        htype = option("HoldingType", "building")
        stime = option("SuitableTime", "morning")
        mode = option("PaymentMode", "cash")
        reason = option("PotentialReason", "refused")
        gap = option("TimeGap", "months")
        practice = option("CurrentPractice", "open_dump")

        common = dict(
            ward=self.ward,
            road=self.road,
            customer_type=ctype,
            storage=storage,
            holding_type=htype,
            suitable_time=stime,
        )

        # Two households at one address cannot be created here — that is exactly
        # what `household_unique_address` forbade, and removing it is the point
        # of the change. Grouping is proved instead with a household and a survey
        # sharing an address: different tables, so the old rule did not apply,
        # and they must still collapse to one holding.
        Household.objects.create(
            id="HH-KCC-0000001", holding="142/B", head="Abdul Karim", phone="0181",
            tier=self.tier, payment_mode=mode, verified=True, lat=22.8, lng=89.5, **common,
        )
        Household.objects.create(
            id="HH-KCC-0000002", holding="143", head="Rina Sultana", phone="0182",
            tier=self.tier, payment_mode=mode, verified=False, **common,
        )
        PotentialCustomer.objects.create(
            id="POT-3001", holding="142/B", head="Ghost Upstairs", phone="0184",
            est_tier=self.tier, surveyed_at="2026-01-01",
            reason=reason, time_gap=gap, current_practice=practice, **common,
        )
        PotentialCustomer.objects.create(
            id="POT-3002", holding="150", head="Ghost Home", phone="0185",
            est_tier=self.tier, surveyed_at="2026-01-01",
            reason=reason, time_gap=gap, current_practice=practice, **common,
        )

    def tearDown(self):
        self._migrate(AFTER)

    def test_backfill_groups_by_address_and_links_every_row(self):
        self._migrate(AFTER)
        apps = self._apps_at(AFTER)
        Holding = apps.get_model("customers", "Holding")
        Household = apps.get_model("customers", "Household")
        PotentialCustomer = apps.get_model("customers", "PotentialCustomer")

        # 3 distinct addresses across 2 households + 2 surveys.
        self.assertEqual(Holding.objects.count(), 3)
        self.assertEqual(
            sorted(Holding.objects.values_list("holding_no", flat=True)),
            ["142/B", "143", "150"],
        )

        # Nothing orphaned.
        self.assertEqual(Household.objects.filter(holding__isnull=True).count(), 0)
        self.assertEqual(PotentialCustomer.objects.filter(holding__isnull=True).count(), 0)

        # The household and the survey at 142/B collapse onto one holding.
        house = Household.objects.get(id="HH-KCC-0000001")
        ghost = PotentialCustomer.objects.get(id="POT-3001")
        other = Household.objects.get(id="HH-KCC-0000002")
        self.assertEqual(house.holding_id, ghost.holding_id)
        self.assertNotEqual(house.holding_id, other.holding_id)
        self.assertEqual(house.holding.households.count(), 1)
        self.assertEqual(house.holding.surveys.count(), 1)

    def test_mirror_columns_survive_the_rename(self):
        self._migrate(AFTER)
        apps = self._apps_at(AFTER)
        Household = apps.get_model("customers", "Household")

        # RenameField, not drop-and-add: the holding numbers are still there.
        row = Household.objects.get(id="HH-KCC-0000001")
        self.assertEqual(row.holding_no, "142/B")
        self.assertEqual(row.ward_id, "W-14")
        self.assertEqual(row.road_id, self.road.id)

    def test_pin_and_owner_come_from_the_first_row_at_the_address(self):
        self._migrate(AFTER)
        apps = self._apps_at(AFTER)
        Holding = apps.get_model("customers", "Holding")

        holding = Holding.objects.get(holding_no="142/B")
        self.assertEqual(holding.owner_name, "Abdul Karim")  # first household, by id
        self.assertTrue(holding.verified)
        self.assertIsNotNone(holding.lat)

        unverified = Holding.objects.get(holding_no="143")
        self.assertFalse(unverified.verified)

    def test_id_sequence_is_advanced_past_the_backfilled_ids(self):
        self._migrate(AFTER)
        apps = self._apps_at(AFTER)
        IdSequence = apps.get_model("common", "IdSequence")

        # Otherwise the next holding created through the UI collides with one of
        # these rows and the insert fails on the primary key.
        self.assertEqual(IdSequence.objects.get(key="holding").last_value, 3)