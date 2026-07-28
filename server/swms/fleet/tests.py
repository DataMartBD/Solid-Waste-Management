"""Fleet service and serializer tests.

These cover the rules the mock got wrong or expressed only as UI side effects:
a collector driving two vans, an odometer typed backwards, an electric van with a
km/L figure, a van left in `in_maintenance` after its job closed, and a live map
that showed anything other than each van's newest ping.
"""

from __future__ import annotations

from datetime import timedelta
from decimal import Decimal

from django.test import TestCase
from django.utils import timezone

from swms.catalog.models import Ward, Zone
from swms.common.exceptions import DomainError
from swms.fieldops.models import Collector

from .models import (
    FuelLog,
    FuelType,
    Maintenance,
    MaintenanceKind,
    Ownership,
    Van,
    VanStatus,
    VanType,
    VehiclePosition,
)
from .serializers import VanSerializer
from .services import (
    assign_driver,
    close_maintenance,
    fleet_kpis,
    live_snapshot,
    log_fuel,
    open_maintenance,
    record_position,
    van_alerts,
)


class FleetTestCase(TestCase):
    """Reference data every test needs: one ward and two collectors."""

    @classmethod
    def setUpTestData(cls):
        cls.zone = Zone.objects.create(id="Z-03", name="Sonadanga")
        cls.ward = Ward.objects.create(
            id="W-14",
            name="Ward 14 — Sonadanga",
            zone=cls.zone,
            lat=Decimal("22.836000"),
            lng=Decimal("89.530000"),
        )
        cls.rahim = Collector.objects.create(
            id="C-101", name="Rahim Uddin", dsp_id="DSP-0101", ward=cls.ward
        )
        cls.karim = Collector.objects.create(
            id="C-102", name="Karim Mia", dsp_id="DSP-0102", ward=cls.ward
        )

    def make_van(self, **overrides):
        defaults = {
            "plate": f"KHULNA-METRO-{Van.objects.count() + 1:03d}",
            "type": VanType.COMPACTOR,
            "capacity": 1000,
            "fuel": FuelType.DIESEL,
            "ownership": Ownership.OWNED,
            "odometer": 10_000,
            "status": VanStatus.ACTIVE,
            "next_service_km": 15_000,
        }
        defaults.update(overrides)
        return Van.objects.create(**defaults)


class AssignDriverTests(FleetTestCase):
    def test_assigning_a_driver_releases_their_previous_van(self):
        first = self.make_van()
        second = self.make_van()
        assign_driver(first, self.rahim)

        assign_driver(second, self.rahim)

        first.refresh_from_db()
        second.refresh_from_db()
        self.assertIsNone(first.driver_id, "the old van should have been freed")
        self.assertEqual(second.driver_id, self.rahim.id)
        self.assertEqual(Van.objects.filter(driver=self.rahim).count(), 1)

    def test_assigning_none_unassigns_without_touching_other_vans(self):
        first = self.make_van()
        second = self.make_van()
        assign_driver(first, self.rahim)
        assign_driver(second, self.karim)

        assign_driver(second, None)

        first.refresh_from_db()
        second.refresh_from_db()
        self.assertEqual(first.driver_id, self.rahim.id)
        self.assertIsNone(second.driver_id)


class VanSerializerTests(FleetTestCase):
    def test_odometer_cannot_go_backwards(self):
        van = self.make_van(odometer=42_000)

        serializer = VanSerializer(van, data={"odometer": 41_000}, partial=True)

        self.assertFalse(serializer.is_valid())
        self.assertIn("odometer", serializer.errors)

    def test_odometer_may_advance(self):
        van = self.make_van(odometer=42_000)

        serializer = VanSerializer(van, data={"odometer": 42_600}, partial=True)

        self.assertTrue(serializer.is_valid(), serializer.errors)

    def test_electric_van_rejects_a_kmpl_figure(self):
        serializer = VanSerializer(
            data={
                "plate": "KHULNA-METRO-E01",
                "type": VanType.TRICYCLE,
                "capacity": 300,
                "fuel": FuelType.ELECTRIC,
                "ownership": Ownership.OWNED,
                "odometer": 0,
                "status": VanStatus.ACTIVE,
                "kmpl": "6.20",
            }
        )

        self.assertFalse(serializer.is_valid())
        self.assertIn("kmpl", serializer.errors)

    def test_electric_van_without_kmpl_is_accepted(self):
        serializer = VanSerializer(
            data={
                "plate": "KHULNA-METRO-E02",
                "type": VanType.TRICYCLE,
                "capacity": 300,
                "fuel": FuelType.ELECTRIC,
                "ownership": Ownership.OWNED,
                "odometer": 0,
                "status": VanStatus.ACTIVE,
                "kmpl": None,
            }
        )

        self.assertTrue(serializer.is_valid(), serializer.errors)

    def test_decimals_and_derived_fields_serialise_as_numbers(self):
        van = self.make_van(
            odometer=14_500,
            next_service_km=15_000,
            kmpl=Decimal("6.10"),
            fitness_exp=timezone.localdate() + timedelta(days=10),
        )

        data = VanSerializer(van).data

        self.assertEqual(data["kmpl"], 6.1)
        self.assertIsInstance(data["kmpl"], float)
        self.assertEqual(data["serviceDueInKm"], 500)
        self.assertEqual([row["document"] for row in data["expiringDocuments"]], ["fitness"])


class MaintenanceTests(FleetTestCase):
    def test_unscheduled_job_takes_the_van_off_the_road(self):
        van = self.make_van()

        record = open_maintenance(
            van,
            kind=MaintenanceKind.UNSCHEDULED,
            reason="Hydraulic leak",
            odometer=van.odometer,
            vendor="KCC Workshop",
        )

        van.refresh_from_db()
        self.assertEqual(van.status, VanStatus.IN_MAINTENANCE)
        self.assertTrue(record.is_open)

    def test_scheduled_job_is_logged_closed_and_leaves_the_van_active(self):
        van = self.make_van()

        record = open_maintenance(
            van, kind=MaintenanceKind.SCHEDULED, reason="Oil change", odometer=van.odometer
        )

        van.refresh_from_db()
        self.assertFalse(record.is_open)
        self.assertEqual(van.status, VanStatus.ACTIVE)

    def test_closing_returns_the_van_to_active_and_computes_downtime(self):
        van = self.make_van()
        record = open_maintenance(
            van, kind=MaintenanceKind.UNSCHEDULED, reason="Brake failure", odometer=van.odometer
        )
        # Backdate the opening so the elapsed hours are predictable.
        record.opened = record.opened - timedelta(hours=6, minutes=30)
        record.save(update_fields=["opened"])

        close_maintenance(record)

        record.refresh_from_db()
        van.refresh_from_db()
        self.assertIsNotNone(record.closed)
        self.assertEqual(record.downtime, Decimal("6.50"))
        self.assertEqual(van.status, VanStatus.ACTIVE)

    def test_supplied_downtime_wins_over_the_computed_figure(self):
        van = self.make_van()
        record = open_maintenance(
            van, kind=MaintenanceKind.UNSCHEDULED, reason="Tyre", odometer=van.odometer
        )

        close_maintenance(record, downtime=Decimal("2.25"), cost=3400)

        record.refresh_from_db()
        self.assertEqual(record.downtime, Decimal("2.25"))
        self.assertEqual(record.cost, 3400)

    def test_van_stays_in_maintenance_while_another_job_is_open(self):
        van = self.make_van()
        first = open_maintenance(
            van, kind=MaintenanceKind.UNSCHEDULED, reason="Gearbox", odometer=van.odometer
        )
        open_maintenance(
            van, kind=MaintenanceKind.UNSCHEDULED, reason="Wiring", odometer=van.odometer
        )

        close_maintenance(first)

        van.refresh_from_db()
        self.assertEqual(van.status, VanStatus.IN_MAINTENANCE)

    def test_closing_twice_is_refused(self):
        van = self.make_van()
        record = open_maintenance(
            van, kind=MaintenanceKind.UNSCHEDULED, reason="Clutch", odometer=van.odometer
        )
        close_maintenance(record)

        with self.assertRaises(DomainError):
            close_maintenance(record)


class FuelTests(FleetTestCase):
    def test_log_fuel_advances_the_odometer_and_derives_kmpl(self):
        van = self.make_van(odometer=10_000)

        log_fuel(van, litres=Decimal("40.00"), cost=4400, odometer=10_000, by=self.rahim)
        second = log_fuel(van, litres=Decimal("40.00"), cost=4400, odometer=10_240)

        van.refresh_from_db()
        self.assertEqual(van.odometer, 10_240)
        # 240 km on 40 litres.
        self.assertEqual(second.kmpl, Decimal("6.00"))

    def test_a_lower_reading_does_not_wind_the_odometer_back(self):
        van = self.make_van(odometer=10_000)

        log_fuel(van, litres=Decimal("20.00"), cost=2200, odometer=9_800)

        van.refresh_from_db()
        self.assertEqual(van.odometer, 10_000)

    def test_first_log_has_no_kmpl_to_derive(self):
        van = self.make_van(odometer=10_000)

        first = log_fuel(van, litres=Decimal("35.00"), cost=3850, odometer=10_000)

        self.assertIsNone(first.kmpl)


class LiveSnapshotTests(FleetTestCase):
    def test_one_row_per_van_carrying_its_latest_position(self):
        van = self.make_van()
        assign_driver(van, self.rahim)
        now = timezone.now()

        record_position(van, lat=Decimal("22.800000"), lng=Decimal("89.500000"), at=now - timedelta(minutes=5))
        record_position(van, lat=Decimal("22.840000"), lng=Decimal("89.540000"), speed=Decimal("18.50"), at=now)

        snapshot = live_snapshot()

        self.assertEqual(len(snapshot["vans"]), 1)
        row = snapshot["vans"][0]
        self.assertEqual(row["id"], van.id)
        # The newer ping wins — DISTINCT ON (van_id) ORDER BY at DESC.
        self.assertEqual(row["lat"], 22.84)
        self.assertEqual(row["lng"], 89.54)
        self.assertEqual(row["speed"], 18.5)
        self.assertFalse(row["stale"])
        self.assertEqual(row["driver"]["id"], self.rahim.id)
        self.assertEqual(VehiclePosition.objects.filter(van=van).count(), 2)

    def test_position_is_attributed_to_the_current_driver(self):
        van = self.make_van()
        assign_driver(van, self.karim)

        position = record_position(van, lat=Decimal("22.830000"), lng=Decimal("89.520000"))

        self.assertEqual(position.collector_id, self.karim.id)

    def test_untracked_and_retired_vans(self):
        tracked = self.make_van()
        self.make_van()  # never sent a ping
        self.make_van(status=VanStatus.RETIRED)
        record_position(tracked, lat=Decimal("22.830000"), lng=Decimal("89.520000"))

        snapshot = live_snapshot()

        self.assertEqual(len(snapshot["vans"]), 2, "retired vans are not drawn")
        self.assertEqual(snapshot["counts"]["tracked"], 1)
        untracked = next(row for row in snapshot["vans"] if row["id"] != tracked.id)
        self.assertIsNone(untracked["lat"])
        self.assertFalse(untracked["stale"])

    def test_an_old_ping_is_marked_stale(self):
        van = self.make_van()
        record_position(
            van,
            lat=Decimal("22.830000"),
            lng=Decimal("89.520000"),
            at=timezone.now() - timedelta(hours=2),
        )

        row = live_snapshot()["vans"][0]

        self.assertTrue(row["stale"])
        self.assertEqual(live_snapshot()["counts"]["live"], 0)

    def test_ward_scope_limits_vans_to_those_with_a_driver_in_that_ward(self):
        other_ward = Ward.objects.create(id="W-21", name="Ward 21 — Khalishpur", zone=self.zone)
        outsider = Collector.objects.create(
            id="C-103", name="Jashim Ali", dsp_id="DSP-0103", ward=other_ward
        )
        mine = self.make_van()
        theirs = self.make_van()
        assign_driver(mine, self.rahim)
        assign_driver(theirs, outsider)

        snapshot = live_snapshot(ward_ids=[self.ward.id])

        self.assertEqual([row["id"] for row in snapshot["vans"]], [mine.id])
        self.assertAlmostEqual(snapshot["centre"]["lat"], 22.836, places=3)


class FleetKpiTests(FleetTestCase):
    def test_availability_is_measured_against_the_serviceable_fleet(self):
        self.make_van(status=VanStatus.ACTIVE)
        self.make_van(status=VanStatus.ACTIVE)
        self.make_van(status=VanStatus.ACTIVE)
        self.make_van(status=VanStatus.IN_MAINTENANCE)
        # Retired vehicles are out of the denominator: they are not "unavailable",
        # they are gone.
        self.make_van(status=VanStatus.RETIRED)

        kpis = fleet_kpis()

        self.assertEqual(kpis["total"], 5)
        self.assertEqual(kpis["fleetSize"], 4)
        self.assertEqual(kpis["active"], 3)
        self.assertEqual(kpis["inMaintenance"], 1)
        self.assertEqual(kpis["availability"], 75)

    def test_availability_of_an_empty_fleet_is_zero_not_an_error(self):
        self.assertEqual(fleet_kpis()["availability"], 0)

    def test_spend_efficiency_and_document_counts(self):
        today = timezone.localdate()
        van = self.make_van(fuel=FuelType.DIESEL, kmpl=Decimal("6.00"))
        self.make_van(fuel=FuelType.DIESEL, kmpl=Decimal("4.00"))
        self.make_van(fuel=FuelType.ELECTRIC, kmpl=None)
        self.make_van(fitness_exp=today + timedelta(days=5), tax_exp=today - timedelta(days=2))

        log_fuel(van, litres=Decimal("40.00"), cost=4400, odometer=van.odometer + 100)
        record = open_maintenance(
            van, kind=MaintenanceKind.UNSCHEDULED, reason="Gearbox", odometer=van.odometer
        )
        close_maintenance(record, cost=12_000)

        kpis = fleet_kpis()

        self.assertEqual(kpis["fuelSpend"], 4400)
        self.assertEqual(kpis["maintenanceSpend"], 12_000)
        # Electric vans carry no km/L and must not drag the diesel average down.
        self.assertEqual(kpis["kmplByFuel"], {FuelType.DIESEL: 5.0})
        self.assertEqual(kpis["documentsExpiring"], 2)
        self.assertEqual(kpis["period"], today.strftime("%Y-%m"))


class VanAlertTests(FleetTestCase):
    def test_alerts_are_computed_against_the_supplied_day(self):
        as_of = timezone.localdate()
        self.make_van(
            fitness_exp=as_of - timedelta(days=3),
            tax_exp=as_of + timedelta(days=12),
            insurance_exp=as_of + timedelta(days=400),
            odometer=14_800,
            next_service_km=15_000,
        )

        result = van_alerts(as_of=as_of)

        kinds = sorted(row["type"] for row in result["alerts"])
        self.assertEqual(kinds, ["expired", "expiring", "serviceDue"])
        self.assertEqual(result["asOf"], as_of.isoformat())
        self.assertEqual(result["vans"][0]["serviceDueInKm"], 200)

    def test_a_narrow_horizon_hides_distant_renewals(self):
        as_of = timezone.localdate()
        self.make_van(fitness_exp=as_of + timedelta(days=20), next_service_km=None)

        self.assertEqual(van_alerts(as_of=as_of, within_days=7)["count"], 0)
        self.assertEqual(van_alerts(as_of=as_of, within_days=30)["count"], 1)


class FuelLogModelTests(FleetTestCase):
    def test_ids_are_allocated_from_the_shared_sequence(self):
        van = self.make_van()

        log = FuelLog.objects.create(van=van, litres=Decimal("10.00"), cost=1100, odometer=10_100)
        record = Maintenance.objects.create(
            van=van, kind=MaintenanceKind.SCHEDULED, reason="Service", odometer=10_100
        )

        self.assertTrue(log.id.startswith("FUEL-"))
        self.assertTrue(record.id.startswith("MNT-"))
        self.assertTrue(van.id.startswith("VAN-KCC-"))
