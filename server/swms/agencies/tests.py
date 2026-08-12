"""Agency structure, employment history, and the promise that nothing changed.

Phase 1 introduces agencies without giving them any authority. The last class
here is the important one: it asserts that adding this module changed nobody's
access, because a "new table" that quietly widens or narrows what an operator
can see is the failure mode worth guarding against.
"""

from __future__ import annotations

import datetime as dt

from django.db import IntegrityError, transaction
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from swms.accounts.models import ScopeKind, User
from swms.catalog.models import Ward, Zone
from swms.common.exceptions import DomainError
from swms.common.roles import Role
from swms.fieldops.models import Collector

from .models import Agency, AgencyStatus, CollectorEmployment
from .services import agency_on, transfer_collector


class AgencyData(TestCase):
    @classmethod
    def setUpTestData(cls):
        zone = Zone.objects.create(id="Z-03", name="Sonadanga")
        cls.ward = Ward.objects.create(id="W-14", name="Ward 14 — Sonadanga", zone=zone)
        cls.other_ward = Ward.objects.create(id="W-21", name="Ward 21 — Khalishpur", zone=zone)
        cls.first = Agency.objects.create(name="Premier Clean", short_code="PCM")
        cls.second = Agency.objects.create(name="Sonadanga Cooperative", short_code="SDC")

    @classmethod
    def make_collector(cls, name="Rafiq Mia", *, agency=None):
        return Collector.objects.create(name=name, ward=cls.ward, agency=agency)


class AgencyModelTests(AgencyData):
    def test_id_is_allocated_from_the_sequence(self):
        self.assertTrue(self.first.id.startswith("AGN-KCC-"))
        self.assertNotEqual(self.first.id, self.second.id)

    def test_short_code_is_unique(self):
        with self.assertRaises(IntegrityError), transaction.atomic():
            Agency.objects.create(name="Another", short_code="PCM")

    def test_contract_expiry_is_derived_not_stored(self):
        """A stored flag is wrong on exactly the day it starts to matter."""
        today = dt.date.today()
        self.assertFalse(self.first.contract_expired)  # no end date

        self.first.contract_end = today - dt.timedelta(days=1)
        self.assertTrue(self.first.contract_expired)

        self.first.contract_end = today
        self.assertFalse(self.first.contract_expired)  # expires at end of day

    def test_an_agency_with_collectors_cannot_be_deleted(self):
        from django.db.models import ProtectedError

        self.make_collector(agency=self.first)
        with self.assertRaises(ProtectedError):
            self.first.delete()


class EmploymentTests(AgencyData):
    def test_transfer_sets_the_fk_and_opens_a_history_row(self):
        collector = self.make_collector()
        transfer_collector(collector, self.first, on_date=dt.date(2026, 1, 1))

        collector.refresh_from_db()
        self.assertEqual(collector.agency_id, self.first.id)
        row = collector.employments.get()
        self.assertEqual(row.agency_id, self.first.id)
        self.assertIsNone(row.to_date)

    def test_moving_agencies_closes_the_previous_period_without_overlap(self):
        collector = self.make_collector()
        transfer_collector(collector, self.first, on_date=dt.date(2026, 1, 1))
        transfer_collector(collector, self.second, on_date=dt.date(2026, 6, 1))

        old, new = collector.employments.order_by("from_date")
        # The old period ends the day *before* the new one starts, so no date is
        # ever covered by two employments.
        self.assertEqual(old.to_date, dt.date(2026, 5, 31))
        self.assertEqual(new.from_date, dt.date(2026, 6, 1))
        self.assertIsNone(new.to_date)
        collector.refresh_from_db()
        self.assertEqual(collector.agency_id, self.second.id)

    def test_transfer_to_the_same_agency_is_a_no_op(self):
        """A retried request must not fragment the history."""
        collector = self.make_collector()
        transfer_collector(collector, self.first, on_date=dt.date(2026, 1, 1))
        transfer_collector(collector, self.first, on_date=dt.date(2026, 3, 1))
        self.assertEqual(collector.employments.count(), 1)

    def test_transfer_on_the_same_day_replaces_rather_than_overlaps(self):
        """Closing it would need to_date < from_date, which the DB refuses."""
        collector = self.make_collector()
        transfer_collector(collector, self.first, on_date=dt.date(2026, 1, 1))
        transfer_collector(collector, self.second, on_date=dt.date(2026, 1, 1))

        row = collector.employments.get()
        self.assertEqual(row.agency_id, self.second.id)
        self.assertEqual(row.from_date, dt.date(2026, 1, 1))

    def test_a_transfer_cannot_pre_date_the_current_employment(self):
        collector = self.make_collector()
        transfer_collector(collector, self.first, on_date=dt.date(2026, 6, 1))
        with self.assertRaises(DomainError):
            transfer_collector(collector, self.second, on_date=dt.date(2026, 1, 1))

    def test_only_one_open_employment_per_collector(self):
        collector = self.make_collector()
        CollectorEmployment.objects.create(
            collector=collector, agency=self.first, from_date=dt.date(2026, 1, 1)
        )
        with self.assertRaises(IntegrityError), transaction.atomic():
            CollectorEmployment.objects.create(
                collector=collector, agency=self.second, from_date=dt.date(2026, 2, 1)
            )

    def test_end_date_cannot_precede_start_date(self):
        collector = self.make_collector()
        with self.assertRaises(IntegrityError), transaction.atomic():
            CollectorEmployment.objects.create(
                collector=collector,
                agency=self.first,
                from_date=dt.date(2026, 6, 1),
                to_date=dt.date(2026, 1, 1),
            )

    def test_agency_on_answers_for_a_past_date_not_today(self):
        """The whole reason history exists: a transfer must not rewrite the past."""
        collector = self.make_collector()
        transfer_collector(collector, self.first, on_date=dt.date(2026, 1, 1))
        transfer_collector(collector, self.second, on_date=dt.date(2026, 6, 1))

        self.assertEqual(agency_on(collector, dt.date(2026, 3, 15)), self.first)
        self.assertEqual(agency_on(collector, dt.date(2026, 5, 31)), self.first)
        self.assertEqual(agency_on(collector, dt.date(2026, 6, 1)), self.second)
        self.assertEqual(agency_on(collector, dt.date(2026, 9, 1)), self.second)
        # Before they were employed at all.
        self.assertIsNone(agency_on(collector, dt.date(2025, 12, 31)))


class AgencyApiTests(AgencyData):
    def setUp(self):
        self.admin = User.objects.create_user(
            phone="01900445566", name="Admin", role=Role.AGENCY_ADMIN,
            scope_kind=ScopeKind.AGENCY,
        )
        self.client = APIClient()
        self.client.force_authenticate(self.admin)

    def test_list_reports_derived_counts(self):
        self.make_collector("A", agency=self.first)
        self.make_collector("B", agency=self.first)

        response = self.client.get(reverse("agency-list"))
        self.assertEqual(response.status_code, 200)
        rows = response.json().get("results") or response.json()
        row = next(r for r in rows if r["id"] == self.first.id)
        self.assertEqual(row["collectorCount"], 2)
        self.assertEqual(row["shortCode"], "PCM")

    def test_create_and_assign_service_wards(self):
        response = self.client.post(
            reverse("agency-list"),
            {
                "name": "New Provider", "shortCode": "NEW", "agencyType": "ngo",
                "serviceWards": [self.ward.id, self.other_ward.id],
                "status": AgencyStatus.ACTIVE,
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.json())
        self.assertCountEqual(
            response.json()["serviceWards"], [self.ward.id, self.other_ward.id]
        )

    def test_transfer_endpoint_moves_a_collector(self):
        collector = self.make_collector(agency=self.first)
        transfer_collector(collector, self.first, on_date=dt.date(2026, 1, 1))

        response = self.client.post(
            reverse("collector-transfer", args=[collector.id]),
            {"agency": self.second.id, "onDate": "2026-06-01"},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.json())
        collector.refresh_from_db()
        self.assertEqual(collector.agency_id, self.second.id)
        self.assertEqual(collector.employments.count(), 2)

    def test_a_collector_cannot_write_agencies(self):
        """Contract records are master data — agency admins only."""
        worker = User.objects.create_user(
            phone="01711000042", name="Rafiq", role=Role.COLLECTOR,
            scope_kind=ScopeKind.WARD,
        )
        client = APIClient()
        client.force_authenticate(worker)
        response = client.post(
            reverse("agency-list"), {"name": "X", "shortCode": "XXX"}, format="json"
        )
        self.assertEqual(response.status_code, 403)


class StampedAttributionTests(AgencyData):
    """The reason `Visit.agency` and `Payment.agency` exist at all.

    Attribution is written when the work is recorded. Resolving it at read time
    through the collector's current employer would mean a transfer silently
    restates every past report — the exact trap `Assignment.effective_from`
    fell into, where the column exists but no query has ever read it.
    """

    def setUp(self):
        from swms.catalog.models import (
            CustomerType, HoldingType, PaymentMode, Road, StorageType, SuitableTime, Tier,
        )
        from swms.customers.models import Holding, Household

        self.collector = self.make_collector()
        transfer_collector(self.collector, self.first, on_date=dt.date(2026, 1, 1))

        road = Road.objects.create(ward=self.ward, name="KDA Avenue")
        htype = HoldingType.objects.create(id="pucca", key="opt.h", label="Pucca")
        holding = Holding.objects.create(
            ward=self.ward, road=road, holding_no="142/B", holding_type=htype,
            owner_name="Landlord", verified=True, lat=22.83, lng=89.53,
        )
        self.household = Household.objects.create(
            holding=holding, head="Abdul Karim",
            tier=Tier.objects.create(id="std", key="opt.t", label="Std", charge=150),
            customer_type=CustomerType.objects.create(id="hh", key="opt.c", label="HH"),
            storage=StorageType.objects.create(id="bin", key="opt.s", label="Bin"),
            holding_type=htype,
            suitable_time=SuitableTime.objects.create(id="am", key="opt.st", label="AM"),
            payment_mode=PaymentMode.objects.create(id="cash", key="opt.pm", label="Cash"),
        )

    def test_a_visit_is_stamped_with_the_agency_that_did_it(self):
        from swms.fieldops.services import record_visit

        visit = record_visit(self.household, collector=self.collector)
        self.assertEqual(visit.agency_id, self.first.id)

    def test_a_transfer_does_not_rewrite_a_past_visit(self):
        from swms.fieldops.services import record_visit

        visit = record_visit(self.household, collector=self.collector)
        transfer_collector(self.collector, self.second, on_date=dt.date(2026, 12, 1))

        visit.refresh_from_db()
        self.collector.refresh_from_db()
        self.assertEqual(self.collector.agency_id, self.second.id)  # moved on…
        self.assertEqual(visit.agency_id, self.first.id)  # …but the work did not

    def test_a_payment_is_stamped_and_survives_a_transfer(self):
        from swms.billing.models import Bill, Payment
        from swms.catalog.models import PaymentMode

        bill = Bill.objects.create(
            household=self.household, ward=self.ward, period="2026-03",
            issued_at=dt.date(2026, 3, 1), due_on=dt.date(2026, 3, 11), amount=150,
        )
        payment = Payment.objects.create(
            bill=bill, collector=self.collector, amount=150,
            method=PaymentMode.objects.get(id="cash"),
        )
        self.assertEqual(payment.agency_id, self.first.id)

        transfer_collector(self.collector, self.second, on_date=dt.date(2026, 12, 1))
        payment.refresh_from_db()
        self.assertEqual(payment.agency_id, self.first.id)

    def test_an_office_counter_payment_has_no_agency(self):
        """No collector means nobody's agency took it — KCC did."""
        from swms.billing.models import Bill, Payment
        from swms.catalog.models import PaymentMode

        bill = Bill.objects.create(
            household=self.household, ward=self.ward, period="2026-04",
            issued_at=dt.date(2026, 4, 1), due_on=dt.date(2026, 4, 11), amount=150,
        )
        payment = Payment.objects.create(
            bill=bill, collector=None, amount=150,
            method=PaymentMode.objects.get(id="cash"),
        )
        self.assertIsNone(payment.agency_id)


class RemittanceTests(StampedAttributionTests):
    """The second hop: agency → KCC, and where the money is in between."""

    def _bill(self, period="2026-03", amount=150):
        from swms.billing.models import Bill

        return Bill.objects.create(
            household=self.household, ward=self.ward, period=period,
            issued_at=dt.date(2026, 3, 1), due_on=dt.date(2026, 3, 11), amount=amount,
        )

    #: `collector=None` has to mean "the office counter", which is different
    #: from "not specified" — hence a sentinel rather than a None default.
    _DEFAULT = object()

    def _pay(self, bill, amount, *, collector=_DEFAULT):
        from swms.billing.models import Payment
        from swms.catalog.models import PaymentMode

        return Payment.objects.create(
            bill=bill,
            collector=self.collector if collector is self._DEFAULT else collector,
            amount=amount, method=PaymentMode.objects.get(id="cash"),
            at=dt.datetime(2026, 3, 10, 10, 0, tzinfo=dt.timezone.utc),
        )

    def test_a_deposit_is_stamped_with_the_agency(self):
        from swms.billing.services import record_deposit
        from swms.catalog.models import PaymentMode

        deposit = record_deposit(
            self.collector, "2026-03", PaymentMode.objects.get(id="cash"), 100
        )
        self.assertEqual(deposit.agency_id, self.first.id)

    def test_several_remittances_in_one_month_are_kept_separate(self):
        """Unlike a deposit: each bank transfer has its own reference."""
        from swms.billing.services import record_remittance
        from swms.catalog.models import PaymentMode

        cash = PaymentMode.objects.get(id="cash")
        record_remittance(self.first, "2026-03", cash, 500, ref="TRX-1")
        record_remittance(self.first, "2026-03", cash, 300, ref="TRX-2")

        self.assertEqual(self.first.remittances.count(), 2)
        self.assertEqual(
            sorted(r.ref for r in self.first.remittances.all()), ["TRX-1", "TRX-2"]
        )

    def test_a_remittance_must_be_positive(self):
        from swms.billing.services import record_remittance
        from swms.catalog.models import PaymentMode

        with self.assertRaises(DomainError):
            record_remittance(self.first, "2026-03", PaymentMode.objects.get(id="cash"), 0)

    def test_cash_position_tracks_both_hops(self):
        from swms.billing.services import agency_cash_position, record_deposit, record_remittance
        from swms.catalog.models import PaymentMode

        cash = PaymentMode.objects.get(id="cash")
        bill = self._bill(amount=1000)
        self._pay(bill, 1000)
        record_deposit(self.collector, "2026-03", cash, 600)   # 400 still in the field
        record_remittance(self.first, "2026-03", cash, 250)    # 350 still with the agency

        result = agency_cash_position("2026-03")
        row = next(r for r in result["rows"] if r["agency"] == self.first.id)
        self.assertEqual(row["collected"], 1000)
        self.assertEqual(row["deposited"], 600)
        self.assertEqual(row["remitted"], 250)
        self.assertEqual(row["inField"], 400)      # collected − deposited
        self.assertEqual(row["withAgency"], 350)   # deposited − remitted
        self.assertEqual(row["outstanding"], 750)  # collected − remitted

    def test_a_fully_settled_month_closes_to_zero(self):
        """Agencies remit in full, so a settled month leaves no gap."""
        from swms.billing.services import agency_cash_position, record_deposit, record_remittance
        from swms.catalog.models import PaymentMode

        cash = PaymentMode.objects.get(id="cash")
        self._pay(self._bill(amount=800), 800)
        record_deposit(self.collector, "2026-03", cash, 800)
        record_remittance(self.first, "2026-03", cash, 800)

        row = next(
            r for r in agency_cash_position("2026-03")["rows"] if r["agency"] == self.first.id
        )
        self.assertEqual((row["inField"], row["withAgency"], row["outstanding"]), (0, 0, 0))

    def test_counter_money_is_reported_but_owes_no_remittance(self):
        """No collector means KCC already holds it — it is not an agency debt."""
        from swms.billing.services import agency_cash_position

        self._pay(self._bill(amount=200), 200, collector=None)

        result = agency_cash_position("2026-03")
        self.assertEqual(result["counterCollected"], 200)
        self.assertEqual(result["totals"]["collected"], 0)  # none of it is any agency's

    def test_a_transfer_does_not_move_a_settled_month(self):
        """The point of stamping, expressed in money rather than rounds."""
        from swms.billing.services import agency_cash_position, record_deposit
        from swms.catalog.models import PaymentMode

        record_deposit(self.collector, "2026-03", PaymentMode.objects.get(id="cash"), 500)
        self._pay(self._bill(amount=500), 500)

        before = agency_cash_position("2026-03")["rows"]
        transfer_collector(self.collector, self.second, on_date=dt.date(2026, 12, 1))
        after = agency_cash_position("2026-03")["rows"]

        self.assertEqual(before, after)


class TenancyTests(AgencyData):
    """Agency as an access boundary: what a tenant sees, and what they must not.

    Ward stopped being sufficient the moment two agencies could work one ward —
    these all use a *single* ward deliberately, because that is the case ward
    scoping cannot express.
    """

    def setUp(self):
        from swms.catalog.models import (
            CustomerType, HoldingType, PaymentMode, Road, StorageType, SuitableTime, Tier,
        )
        from swms.customers.models import Holding, Household

        road = Road.objects.create(ward=self.ward, name="KDA Avenue")
        self.htype = HoldingType.objects.create(id="pucca", key="opt.h", label="Pucca")
        self.tier = Tier.objects.create(id="std", key="opt.t", label="Std", charge=150)
        self.profile = {
            "customer_type": CustomerType.objects.create(id="hh", key="opt.c", label="HH"),
            "storage": StorageType.objects.create(id="bin", key="opt.s", label="Bin"),
            "holding_type": self.htype,
            "suitable_time": SuitableTime.objects.create(id="am", key="opt.st", label="AM"),
        }
        self.mode = PaymentMode.objects.create(id="cash", key="opt.pm", label="Cash")

        # Both buildings sit on the same road in the same ward. Only the agency
        # tells them apart.
        def building(number, agency):
            return Holding.objects.create(
                ward=self.ward, road=road, holding_no=number, holding_type=self.htype,
                owner_name=f"Owner {number}", agency=agency, verified=True,
            )

        self.mine = building("1", self.first)
        self.theirs = building("2", self.second)
        for holding, head in ((self.mine, "Mine"), (self.theirs, "Theirs")):
            Household.objects.create(
                holding=holding, head=head, tier=self.tier,
                payment_mode=self.mode, **self.profile,
            )

        self.my_collector = self.make_collector("Mine", agency=self.first)
        self.their_collector = self.make_collector("Theirs", agency=self.second)

        self.tenant = User.objects.create_user(
            phone="01711000001", name="Tenant Admin", role=Role.AGENCY_ADMIN,
            scope_kind=ScopeKind.AGENCY, agency=self.first,
        )
        self.client = APIClient()
        self.client.force_authenticate(self.tenant)

    def _ids(self, path, client=None):
        response = (client or self.client).get(path)
        self.assertEqual(response.status_code, 200, response.content[:200])
        body = response.json()
        # `or body` would fall through to the envelope dict on an empty page and
        # iterate its keys — which is exactly the case these tests care about.
        rows = body["results"] if isinstance(body, dict) and "results" in body else body
        return {row["id"] for row in rows}

    def test_holdings_are_limited_to_my_agency(self):
        ids = self._ids(reverse("holding-list"))
        self.assertIn(self.mine.id, ids)
        self.assertNotIn(self.theirs.id, ids)

    def test_households_follow_their_building(self):
        heads = {
            row["head"]
            for row in (self.client.get(reverse("household-list")).json().get("results") or [])
        }
        self.assertEqual(heads, {"Mine"})

    def test_collectors_are_limited_to_my_agency(self):
        ids = self._ids(reverse("collector-list"))
        self.assertIn(self.my_collector.id, ids)
        self.assertNotIn(self.their_collector.id, ids)

    def test_an_agency_sees_only_its_own_agency_record(self):
        ids = self._ids(reverse("agency-list"))
        self.assertEqual(ids, {self.first.id})

    def test_ward_scoping_still_applies_on_top(self):
        """Both axes narrow; they do not replace one another."""
        self.tenant.scope_kind = ScopeKind.WARD
        self.tenant.save(update_fields=["scope_kind"])
        self.tenant.scope_wards.set([self.other_ward.id])  # a ward with nothing in it

        self.assertEqual(self._ids(reverse("holding-list")), set())

    def test_kcc_staff_are_not_restricted(self):
        """No agency means no agency filter — this is what keeps it inert."""
        officer = User.objects.create_user(
            phone="01800778899", name="KCC Cell", role=Role.KCC_VIEWER,
            scope_kind=ScopeKind.CITY,
        )
        client = APIClient()
        client.force_authenticate(officer)
        self.assertEqual(
            self._ids(reverse("holding-list"), client=client), {self.mine.id, self.theirs.id}
        )

    def test_every_report_serves_an_agency_account(self):
        """They used to refuse outright; now each one is scoped per model."""
        for name in (
            "report-waste-collection", "report-service-series", "report-ward-collection",
            "report-bill-collection", "report-bill-status", "report-customer-collection",
            "report-customer-bill-status", "report-reconciliation", "report-kpis",
            "report-waste-by-zone", "report-complaint-summary", "report-customer-funnel",
            "report-dashboard",
        ):
            with self.subTest(report=name):
                self.assertEqual(self.client.get(reverse(name)).status_code, 200)

    def test_a_report_counts_only_my_agencys_work(self):
        from swms.fieldops.services import record_visit
        from swms.customers.models import Household

        record_visit(Household.objects.get(head="Mine"), collector=self.my_collector)
        record_visit(Household.objects.get(head="Theirs"), collector=self.their_collector)

        rows = self.client.get(reverse("report-waste-collection")).json()["rows"]
        owners = {row["collector"] for row in rows}
        self.assertIn(self.my_collector.id, owners)
        self.assertNotIn(self.their_collector.id, owners)

    def test_kcc_still_sees_both_agencies(self):
        from swms.fieldops.services import record_visit
        from swms.customers.models import Household

        record_visit(Household.objects.get(head="Mine"), collector=self.my_collector)
        record_visit(Household.objects.get(head="Theirs"), collector=self.their_collector)

        officer = User.objects.create_user(
            phone="01900000009", name="KCC Reports", role=Role.KCC_VIEWER,
            scope_kind=ScopeKind.CITY,
        )
        client = APIClient()
        client.force_authenticate(officer)
        rows = client.get(reverse("report-waste-collection")).json()["rows"]
        owners = {row["collector"] for row in rows}
        self.assertIn(self.my_collector.id, owners)
        self.assertIn(self.their_collector.id, owners)

    def test_an_unmapped_model_raises_rather_than_leaking(self):
        """A model with no AGENCY_PATHS entry must crash, not pass unfiltered."""
        from swms.fleet.models import Van
        from swms.reports.aggregates import _scoped

        with self.assertRaises(RuntimeError):
            _scoped(Van.objects.all(), None, agency_id=self.first.id)


class WriteGuardTests(TenancyTests):
    """Reading was scoped; writing was not.

    A queryset filter stops a tenant *seeing* a rival's rows, but
    `PrimaryKeyRelatedField` accepts any id in the table — so without these
    guards a tenant could post a reference to something they cannot read.
    """

    def test_a_visit_cannot_be_recorded_against_another_agencys_building(self):
        from swms.customers.models import Household

        theirs = Household.objects.get(head="Theirs")
        response = self.client.post(
            reverse("visit-list"),
            {"hh": theirs.id, "status": "collected"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("hh", response.json()["fields"])

    def test_a_visit_cannot_name_another_agencys_collector(self):
        from swms.customers.models import Household

        mine = Household.objects.get(head="Mine")
        response = self.client.post(
            reverse("visit-list"),
            {"hh": mine.id, "collector": self.their_collector.id, "status": "collected"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("collector", response.json()["fields"])

    def test_an_assignment_cannot_be_given_another_agencys_collector(self):
        response = self.client.post(
            reverse("assignment-list"),
            {"collector": self.their_collector.id},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("collector", response.json()["fields"])

    def test_a_remittance_cannot_be_recorded_for_another_agency(self):
        from swms.catalog.models import PaymentMode

        PaymentMode.objects.get_or_create(id="cash", defaults={"key": "opt.pm", "label": "Cash"})
        response = self.client.post(
            reverse("remittance-record"),
            {"agency": self.second.id, "period": "2026-03", "method": "cash", "amount": 100},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("agency", response.json()["fields"])

    def test_my_own_records_are_still_writable(self):
        """The guards must narrow, not block."""
        from swms.customers.models import Household

        mine = Household.objects.get(head="Mine")
        response = self.client.post(
            reverse("visit-list"),
            {"hh": mine.id, "collector": self.my_collector.id, "status": "collected"},
            format="json",
        )
        self.assertIn(response.status_code, (200, 201), response.content[:200])

    def test_routes_cannot_be_stolen_across_agencies(self):
        """`set_routes` deleted another collector's links with no ownership check."""
        from swms.fieldops.models import Assignment, Route

        theirs = Route.objects.create(name="Theirs", ward=self.ward, agency=self.second)
        their_plan = Assignment.objects.create(collector=self.their_collector)
        their_plan.set_routes([theirs.id])

        my_plan = Assignment.objects.create(collector=self.my_collector)
        with self.assertRaises(DomainError):
            my_plan.set_routes([theirs.id])

        # Their plan is untouched.
        self.assertEqual(their_plan.route_ids(), [theirs.id])

    def test_routes_move_freely_within_one_agency(self):
        """Reassigning between your own collectors is ordinary planning."""
        from swms.fieldops.models import Assignment, Route

        route = Route.objects.create(name="Mine", ward=self.ward, agency=self.first)
        other = self.make_collector("Second of mine", agency=self.first)
        first_plan = Assignment.objects.create(collector=self.my_collector)
        first_plan.set_routes([route.id])

        second_plan = Assignment.objects.create(collector=other)
        second_plan.set_routes([route.id])  # must not raise

        self.assertEqual(second_plan.route_ids(), [route.id])
        self.assertEqual(first_plan.route_ids(), [])


class RealtimeScopingTests(AgencyData):
    """One global channel group meant every client got every frame city-wide."""

    def test_an_event_reaches_kcc_and_only_its_own_agency(self):
        from swms.common.realtime import LIVE_GROUP, agency_group, publish

        sent = []

        class FakeLayer:
            def group_send(self, group, frame):
                sent.append(group)

        import swms.common.realtime as realtime

        original = realtime.get_channel_layer
        realtime.get_channel_layer = lambda: FakeLayer()
        realtime.async_to_sync = lambda fn: fn  # the fake is already sync
        try:
            publish("visit.recorded", {"id": "V-1"}, agency_id=self.first.id)
        finally:
            realtime.get_channel_layer = original

        self.assertIn(LIVE_GROUP, sent)
        self.assertIn(agency_group(self.first.id), sent)
        self.assertNotIn(agency_group(self.second.id), sent)

    def test_an_unattributed_event_reaches_kcc_only(self):
        """Safer direction: a stale marker beats a rival's live tracking."""
        from swms.common.realtime import LIVE_GROUP, publish

        sent = []

        class FakeLayer:
            def group_send(self, group, frame):
                sent.append(group)

        import swms.common.realtime as realtime

        original = realtime.get_channel_layer
        realtime.get_channel_layer = lambda: FakeLayer()
        realtime.async_to_sync = lambda fn: fn
        try:
            publish("visit.recorded", {"id": "V-2"})
        finally:
            realtime.get_channel_layer = original

        self.assertEqual(sent, [LIVE_GROUP])


class NothingChangedTests(AgencyData):
    """Phase 1 must be inert. These guard that promise."""

    def test_agency_does_not_affect_what_a_user_can_see(self):
        """`visible_ward_ids` must not consult agency — access is still ward-based."""
        user = User.objects.create_user(
            phone="01700112233", name="Supervisor", role=Role.SUPERVISOR,
            scope_kind=ScopeKind.ZONE, scope_zone="Z-03",
        )
        before = user.visible_ward_ids()

        user.agency = self.first
        user.save(update_fields=["agency"])
        user.refresh_from_db()

        self.assertEqual(user.visible_ward_ids(), before)

    def test_agency_scope_still_means_unrestricted(self):
        """Not an endorsement — a record that Phase 1 did not silently change it.

        `ScopeKind.AGENCY` returns None (city-wide) and several live users rely
        on that today. Turning it into real tenancy is the tenancy phase's job,
        and doing it here would change access under cover of a new table.
        """
        user = User.objects.create_user(
            phone="01900000001", name="Agency Admin", role=Role.AGENCY_ADMIN,
            scope_kind=ScopeKind.AGENCY, agency=self.first,
        )
        self.assertIsNone(user.visible_ward_ids())

    def test_a_collector_without_an_agency_is_still_valid(self):
        """Nullable everywhere, so adoption can be gradual."""
        collector = self.make_collector()
        self.assertIsNone(collector.agency_id)
        collector.full_clean(exclude=["dsp_id", "id"])
