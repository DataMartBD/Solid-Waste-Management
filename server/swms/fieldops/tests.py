"""Field-operations tests.

The frontend logic these replace lived in `src/utils/collection.js`, so the cases
below are the rules that file encoded and the mock data could not enforce: only a
verified holding may be routed, a holding is visited once a day, a skip carries a
reason, and a collector reads their own round and nobody else's.

Reference rows are built inline rather than loaded from a fixture — the seed is a
separate concern and a test that depends on it stops being a test of this app.
"""

from __future__ import annotations

from datetime import datetime, time, timedelta

from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient

from swms.accounts.models import ScopeKind, User
from swms.catalog.models import (
    CustomerType,
    HoldingType,
    PaymentMode,
    Road,
    StorageType,
    SuitableTime,
    Tier,
    Ward,
    Zone,
)
from swms.common.exceptions import DomainError
from swms.common.roles import Role
from swms.customers.models import Holding, Household

from .models import Assignment, Collector, Route, RouteStop, Visit, VisitStatus
from .serializers import RouteSerializer
from .services import match_scan, record_visit, refresh_collector_metrics, round_for_collector


class FieldOpsData(TestCase):
    """Reference data, two wards and a small set of holdings."""

    @classmethod
    def setUpTestData(cls):
        zone = Zone.objects.create(id="Z-03", name="Sonadanga")
        cls.ward = Ward.objects.create(id="W-14", name="Ward 14 — Sonadanga", zone=zone)
        cls.other_ward = Ward.objects.create(id="W-15", name="Ward 15 — Nirala", zone=zone)
        cls.road = Road.objects.create(ward=cls.ward, name="KDA Avenue")
        cls.other_road = Road.objects.create(ward=cls.other_ward, name="Nirala Cross Road")

        cls.tier = Tier.objects.create(
            id="residential_standard",
            key="opt.tier.residential_standard",
            label="Residential — standard",
            charge=150,
        )
        cls.customer_type = CustomerType.objects.create(
            id="household", key="opt.customerType.household", label="Household"
        )
        cls.storage = StorageType.objects.create(
            id="bin", key="opt.storage.bin", label="Covered bin"
        )
        cls.holding_type = HoldingType.objects.create(
            id="pucca", key="opt.holdingType.pucca", label="Pucca"
        )
        cls.suitable_time = SuitableTime.objects.create(
            id="morning", key="opt.suitableTime.morning", label="Morning"
        )
        cls.payment_mode = PaymentMode.objects.create(
            id="cash", key="opt.paymentMode.cash", label="Cash"
        )

    @classmethod
    def make_holding(cls, holding_no, *, verified=True, ward=None, road=None):
        return Holding.objects.create(
            ward=ward or cls.ward,
            road=road or cls.road,
            holding_no=holding_no,
            holding_type=cls.holding_type,
            owner_name=f"Owner {holding_no}",
            owner_phone="01711000000",
            lat=22.836000 if verified else None,
            lng=89.530000 if verified else None,
            verified=verified,
        )

    @classmethod
    def make_household(cls, holding, *, verified=True, ward=None, road=None, dues=0, unit=""):
        """A family, and the building it sits in if that does not exist yet.

        Address and pin are no longer passed here: they belong to the holding
        and are mirrored down on save, so setting them on the household would
        be overwritten and mask a real mismatch.
        """
        parent = Holding.objects.filter(
            ward=ward or cls.ward, road=road or cls.road, holding_no=holding
        ).first() or cls.make_holding(holding, verified=verified, ward=ward, road=road)
        return Household.objects.create(
            holding=parent,
            unit=unit,
            head=f"Head {holding}{unit}",
            phone="01711000000",
            dues=dues,
            tier=cls.tier,
            customer_type=cls.customer_type,
            storage=cls.storage,
            holding_type=cls.holding_type,
            suitable_time=cls.suitable_time,
            payment_mode=cls.payment_mode,
        )

    @classmethod
    def make_route(cls, name, *, ward=None, households=()):
        """A route. `households` is taken as the families to walk.

        A stop is a *building*, so the households are mapped to theirs and
        repeats collapse — which is exactly what routing two flats of one block
        means.
        """
        route = Route.objects.create(
            name=name,
            ward=ward or cls.ward,
            window_start=time(6, 0),
            window_end=time(9, 30),
        )
        if households:
            seen, holdings = set(), []
            for household in households:
                if household.holding_id in seen:
                    continue
                seen.add(household.holding_id)
                holdings.append(household.holding_id)
            route.resequence(holdings)
        return route

    @classmethod
    def make_collector(cls, name="Rafiq Mia", *, ward=None):
        return Collector.objects.create(name=name, ward=ward or cls.ward)

    @classmethod
    def assign(cls, collector, routes):
        assignment = Assignment.objects.create(collector=collector)
        assignment.set_routes([route.id for route in routes])
        return assignment


class RoutePlanningTests(FieldOpsData):
    """`isRoutable` and "a round stays in its ward", now enforced server-side."""

    def test_unverified_holding_cannot_be_routed(self):
        route = self.make_route("KDA Avenue")
        unverified = self.make_holding("142/B", verified=False)

        serializer = RouteSerializer(instance=route, data={"stops": [unverified.id]}, partial=True)

        self.assertFalse(serializer.is_valid())
        self.assertIn("stops", serializer.errors)
        # The planner needs to know *which* building was refused.
        self.assertIn(unverified.id, str(serializer.errors["stops"]))
        self.assertEqual(RouteStop.objects.count(), 0)

    def test_holding_from_another_ward_cannot_be_routed(self):
        route = self.make_route("KDA Avenue")
        stray = self.make_holding("7", ward=self.other_ward, road=self.other_road)

        serializer = RouteSerializer(instance=route, data={"stops": [stray.id]}, partial=True)

        self.assertFalse(serializer.is_valid())
        self.assertIn(stray.id, str(serializer.errors["stops"]))

    def test_verified_holdings_are_saved_in_the_given_order(self):
        route = self.make_route("KDA Avenue")
        first = self.make_holding("1")
        second = self.make_holding("2")

        serializer = RouteSerializer(
            instance=route, data={"stops": [second.id, first.id]}, partial=True
        )
        self.assertTrue(serializer.is_valid(), serializer.errors)
        serializer.save()

        self.assertEqual(
            list(route.stops.order_by("seq").values_list("holding_id", "seq")),
            [(second.id, 1), (first.id, 2)],
        )


class RecordVisitTests(FieldOpsData):
    """One row per household per day, and a skip that explains itself."""

    def setUp(self):
        self.household = self.make_household("142/B")
        self.collector = self.make_collector()
        self.route = self.make_route("KDA Avenue", households=[self.household])

    def test_second_visit_on_the_same_day_updates_the_first(self):
        skipped = record_visit(
            self.household,
            collector=self.collector,
            status=VisitStatus.SKIPPED,
            reason="noOne",
        )
        corrected = record_visit(
            self.household, collector=self.collector, status=VisitStatus.COLLECTED
        )

        self.assertEqual(Visit.objects.filter(household=self.household).count(), 1)
        self.assertEqual(corrected.id, skipped.id)
        self.assertEqual(corrected.status, VisitStatus.COLLECTED)
        # Correcting a skip must not leave the old reason behind on the row.
        self.assertEqual(corrected.reason, "")

    def test_visit_takes_its_tag_and_route_from_the_plan(self):
        visit = record_visit(self.household, collector=self.collector)

        self.assertEqual(visit.qr, self.household.qr)
        self.assertEqual(visit.route_id, self.route.id)

    def test_a_skip_without_a_reason_is_rejected(self):
        with self.assertRaises(DomainError):
            record_visit(
                self.household, collector=self.collector, status=VisitStatus.SKIPPED
            )
        self.assertEqual(Visit.objects.count(), 0)

    def test_yesterdays_visit_does_not_settle_today(self):
        yesterday = timezone.now() - timedelta(days=1)
        record_visit(self.household, collector=self.collector, at=yesterday)

        record_visit(self.household, collector=self.collector, status=VisitStatus.SKIPPED,
                     reason="locked")

        self.assertEqual(Visit.objects.filter(household=self.household).count(), 2)


class RoundTests(FieldOpsData):
    """`stopsForCollector`, server-side: plan order, day scoping, no repeats."""

    def setUp(self):
        self.first = self.make_household("1", dues=300)
        self.second = self.make_household("2")
        self.third = self.make_household("3")
        self.collector = self.make_collector()
        self.morning = self.make_route("KDA Avenue", households=[self.second, self.first])
        self.afternoon = self.make_route("Majid Sarani", households=[self.third])
        self.assign(self.collector, [self.morning, self.afternoon])

    def test_round_follows_the_planner_order_and_lists_each_holding_once(self):
        stops = round_for_collector(self.collector.id, timezone.localdate())

        self.assertEqual(
            [stop["hh"] for stop in stops], [self.second.id, self.first.id, self.third.id]
        )
        self.assertEqual(len({stop["hh"] for stop in stops}), len(stops))
        self.assertEqual(
            [stop["routeId"] for stop in stops],
            [self.morning.id, self.morning.id, self.afternoon.id],
        )
        self.assertEqual([stop["seq"] for stop in stops], [1, 2, 1])

    def test_visit_status_reflects_todays_work_only(self):
        record_visit(self.first, collector=self.collector)
        record_visit(
            self.second, collector=self.collector, status=VisitStatus.SKIPPED, reason="noWaste"
        )
        record_visit(
            self.third, collector=self.collector, at=timezone.now() - timedelta(days=1)
        )

        by_id = {stop["hh"]: stop for stop in round_for_collector(self.collector.id)}

        self.assertEqual(by_id[self.first.id]["visitStatus"], "collected")
        self.assertEqual(by_id[self.second.id]["visitStatus"], "skipped")
        # Yesterday's collection leaves today's stop to be worked.
        self.assertEqual(by_id[self.third.id]["visitStatus"], "pending")
        self.assertIsNone(by_id[self.third.id]["at"])
        self.assertEqual(by_id[self.first.id]["by"], self.collector.id)
        self.assertEqual(by_id[self.first.id]["dues"], 300)
        self.assertEqual(by_id[self.first.id]["road"], self.road.name)
        self.assertIsInstance(by_id[self.first.id]["lat"], float)

    def test_a_collector_with_no_assignment_has_no_round(self):
        self.assertEqual(round_for_collector(self.make_collector("Nobody").id), [])


class ScanTests(FieldOpsData):
    """The four `matchScan` outcomes a collector has to be able to tell apart."""

    def setUp(self):
        self.on_round = self.make_household("1")
        self.elsewhere = self.make_household("2")
        self.collector = self.make_collector()
        self.route = self.make_route("KDA Avenue", households=[self.on_round])
        self.assign(self.collector, [self.route])

    def test_blank_scan_is_unreadable(self):
        result = match_scan("", self.collector.id)
        self.assertEqual(result, {"ok": False, "reason": "unreadable"})

    def test_tag_on_the_round_matches(self):
        result = match_scan(self.on_round.scan_payload, self.collector.id)
        self.assertTrue(result["ok"])
        self.assertEqual(result["stop"]["hh"], self.on_round.id)

    def test_a_second_scan_reports_already_collected(self):
        record_visit(self.on_round, collector=self.collector)

        result = match_scan(self.on_round.qr, self.collector.id)

        self.assertFalse(result["ok"])
        self.assertEqual(result["reason"], "alreadyCollected")
        self.assertEqual(result["stop"]["hh"], self.on_round.id)

    def test_a_known_holding_off_the_round_reports_other_route(self):
        result = match_scan(self.elsewhere.id, self.collector.id)

        self.assertFalse(result["ok"])
        self.assertEqual(result["reason"], "otherRoute")
        self.assertEqual(result["household"]["hh"], self.elsewhere.id)

    def test_an_unregistered_tag_is_unknown(self):
        result = match_scan("SS-ZZZZZZ", self.collector.id)

        self.assertFalse(result["ok"])
        self.assertEqual(result["reason"], "unknown")
        self.assertEqual(result["code"], "SS-ZZZZZZ")


class MetricsTests(FieldOpsData):
    """Coverage and on-time, recomputed rather than seeded."""

    def setUp(self):
        self.household = self.make_household("1")
        self.other = self.make_household("2")
        self.collector = self.make_collector()
        self.route = self.make_route("KDA Avenue", households=[self.household, self.other])
        self.assign(self.collector, [self.route])

    def test_half_the_stops_worked_is_half_coverage(self):
        record_visit(self.household, collector=self.collector)

        refresh_collector_metrics(self.collector)
        self.collector.refresh_from_db()

        # One collection against two planned stops on the one day worked.
        self.assertEqual(self.collector.coverage, 50)
        self.assertIsNotNone(self.collector.metrics_updated_at)

    def test_a_collection_outside_the_window_is_not_on_time(self):
        today = timezone.localdate()
        inside = timezone.make_aware(datetime.combine(today, time(7, 30)))
        outside = timezone.make_aware(datetime.combine(today, time(14, 0)))
        record_visit(self.household, collector=self.collector, at=inside)
        record_visit(self.other, collector=self.collector, at=outside)

        refresh_collector_metrics(self.collector)
        self.collector.refresh_from_db()

        self.assertEqual(self.collector.on_time, 50)


@override_settings(ROOT_URLCONF="swms.fieldops.urls")
class RoundAccessTests(FieldOpsData):
    """A collector reads their own round. The other pages are for supervisors."""

    def setUp(self):
        self.mine = self.make_household("1")
        self.theirs = self.make_household("2")
        self.me = self.make_collector("Rafiq Mia")
        self.them = self.make_collector("Shahin Alam")
        self.assign(self.me, [self.make_route("KDA Avenue", households=[self.mine])])
        self.assign(self.them, [self.make_route("Majid Sarani", households=[self.theirs])])

        self.user = User.objects.create_user(
            phone="01711000001",
            name="Rafiq Mia",
            role=Role.COLLECTOR,
            scope_kind=ScopeKind.WARD,
            collector=self.me,
        )
        self.user.scope_wards.add(self.ward)
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_a_collector_asking_for_another_round_gets_their_own(self):
        response = self.client.get(
            reverse("collection-round"), {"collector": self.them.id}
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["collector"], self.me.id)
        self.assertEqual([stop["hh"] for stop in response.data["stops"]], [self.mine.id])
        self.assertEqual(response.data["counts"], {"all": 1, "collected": 0, "skipped": 0, "pending": 1})

    def test_a_collector_login_with_no_staff_record_is_refused(self):
        stranger = User.objects.create_user(
            phone="01711000002", name="Unlinked", role=Role.COLLECTOR
        )
        client = APIClient()
        client.force_authenticate(user=stranger)

        response = client.get(reverse("collection-round"), {"collector": self.me.id})

        self.assertEqual(response.status_code, 403)

    def test_a_supervisor_may_read_any_round(self):
        supervisor = User.objects.create_user(
            phone="01711000003",
            name="Supervisor",
            role=Role.SUPERVISOR,
            scope_kind=ScopeKind.CITY,
        )
        client = APIClient()
        client.force_authenticate(user=supervisor)

        response = client.get(reverse("collection-round"), {"collector": self.them.id})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["collector"], self.them.id)
        self.assertEqual([stop["hh"] for stop in response.data["stops"]], [self.theirs.id])


@override_settings(ROOT_URLCONF="swms.fieldops.urls")
class OfflineQueueTests(FieldOpsData):
    """One unusable row must not cost a collector the rest of their queue."""

    def setUp(self):
        self.household = self.make_household("1")
        self.collector = self.make_collector()
        self.assign(self.collector, [self.make_route("KDA Avenue", households=[self.household])])

        self.user = User.objects.create_user(
            phone="01711000004",
            name="Supervisor",
            role=Role.SUPERVISOR,
            scope_kind=ScopeKind.CITY,
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_bulk_upload_reports_the_bad_row_and_saves_the_rest(self):
        response = self.client.post(
            reverse("visit-bulk"),
            {
                "rows": [
                    {
                        "hh": self.household.id,
                        "collector": self.collector.id,
                        "status": "collected",
                        "source": "scan",
                    },
                    {"hh": "HH-KCC-9999999", "status": "collected"},
                    {"hh": self.household.id, "status": "skipped"},
                ]
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data["saved"]), 1)
        self.assertEqual([row["index"] for row in response.data["failed"]], [1, 2])
        visit = Visit.objects.get(household=self.household)
        self.assertTrue(visit.synced)
