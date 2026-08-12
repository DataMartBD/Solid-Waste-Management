"""Billing rules that must not regress.

The invariant under test throughout is the one the module docstring in models.py
sets out: a bill's status and a household's dues are *derived* from the payments
that exist. Every assertion here is ultimately checking that nothing can put the
two out of step — which is exactly the bug the mock data shipped with.
"""

from __future__ import annotations

from datetime import date, datetime

from django.test import TestCase
from django.utils import timezone

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
from swms.customers.models import Holding, HoldingStatus, Household
from swms.fieldops.models import Collector, Route, RouteStop

from .models import Bill, BillingRun, BillStatus, Deposit, Payment
from .services import (
    billing_summary,
    cash_position,
    generate_bills,
    record_deposit,
    record_payment,
    void_payment,
    with_paid_total,
)
from .views import BillFilter

PERIOD = "2026-07"


def at(day: int, hour: int = 11) -> datetime:
    """An aware timestamp inside PERIOD, in the project's local timezone."""
    return timezone.make_aware(datetime(2026, 7, day, hour, 0))


class BillingTestCase(TestCase):
    """Reference data every billing test needs, built inline."""

    @classmethod
    def setUpTestData(cls):
        cls.zone = Zone.objects.create(id="Z-03", name="Sonadanga")
        cls.ward = Ward.objects.create(
            id="W-14", name="Ward 14 — Sonadanga", zone=cls.zone, lat=22.815, lng=89.548
        )
        cls.road = Road.objects.create(ward=cls.ward, name="KDA Avenue")

        cls.tier = Tier.objects.create(
            id="residential_standard", key="opt.tier.residential_standard",
            label="Residential — standard", charge=300,
        )
        cls.customer_type = CustomerType.objects.create(
            id="residential", key="opt.customerType.residential", label="Residential"
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
        cls.cash = PaymentMode.objects.create(id="cash", key="opt.payment.cash", label="Cash")
        cls.bkash = PaymentMode.objects.create(id="bkash", key="opt.payment.bkash", label="bKash")

        cls.collector = Collector.objects.create(name="Rafiq Islam", ward=cls.ward)
        cls.other_collector = Collector.objects.create(name="Salma Begum", ward=cls.ward)
        cls.route = Route.objects.create(name="KDA Avenue", ward=cls.ward)

    # --- factories --------------------------------------------------------- #

    def make_household(self, holding: str, *, charge: int = 0, status=HoldingStatus.ACTIVE,
                       routed: bool = True) -> Household:
        parent = Holding.objects.filter(
            ward=self.ward, road=self.road, holding_no=holding
        ).first() or Holding.objects.create(
            ward=self.ward,
            road=self.road,
            holding_no=holding,
            holding_type=self.holding_type,
            owner_name=f"Owner of {holding}",
            verified=True,
        )
        household = Household.objects.create(
            holding=parent,
            head=f"Head of {holding}",
            customer_type=self.customer_type,
            storage=self.storage,
            holding_type=self.holding_type,
            suitable_time=self.suitable_time,
            tier=self.tier,
            payment_mode=self.cash,
            charge=charge,
            status=status,
        )
        if routed:
            # A stop is a building, so a second flat in the same block does not
            # add a stop — it is already walked.
            RouteStop.objects.get_or_create(
                holding=household.holding,
                defaults={"route": self.route, "seq": RouteStop.objects.count() + 1},
            )
        return household


class GenerateBillsTests(BillingTestCase):
    def test_bills_every_active_routed_household_once(self):
        self.make_household("1/A")
        self.make_household("2/A")

        summary = generate_bills(PERIOD, issued_on=date(2026, 7, 1), due_days=10)

        self.assertEqual(summary["created"], 2)
        self.assertEqual(Bill.objects.filter(period=PERIOD).count(), 2)
        bill = Bill.objects.filter(period=PERIOD).first()
        self.assertEqual(bill.amount, 300)
        self.assertEqual(bill.issued_at, date(2026, 7, 1))
        self.assertEqual(bill.due_on, date(2026, 7, 11))
        self.assertEqual(bill.status, BillStatus.UNPAID)
        self.assertIsNone(bill.method_id)

    def test_running_twice_creates_no_duplicates(self):
        self.make_household("1/A")
        self.make_household("2/A")

        generate_bills(PERIOD)
        second = generate_bills(PERIOD)

        self.assertEqual(second["created"], 0)
        self.assertEqual(second["skipped"], 2)
        self.assertEqual(Bill.objects.filter(period=PERIOD).count(), 2)
        # One run row for the month, and its totals describe the month.
        self.assertEqual(BillingRun.objects.filter(period=PERIOD).count(), 1)
        run = BillingRun.objects.get(period=PERIOD)
        self.assertEqual(run.bill_count, 2)
        self.assertEqual(run.total_amount, 600)

    def test_second_run_picks_up_a_newly_signed_up_household(self):
        self.make_household("1/A")
        generate_bills(PERIOD)
        self.make_household("9/C")

        summary = generate_bills(PERIOD)

        self.assertEqual(summary["created"], 1)
        self.assertEqual(Bill.objects.filter(period=PERIOD).count(), 2)
        self.assertEqual(BillingRun.objects.get(period=PERIOD).bill_count, 2)

    def test_skips_inactive_and_unrouted_households(self):
        billed = self.make_household("1/A")
        inactive = self.make_household("2/A", status=HoldingStatus.INACTIVE)
        unrouted = self.make_household("3/A", routed=False)

        generate_bills(PERIOD)

        self.assertTrue(Bill.objects.filter(household=billed, period=PERIOD).exists())
        self.assertFalse(Bill.objects.filter(household=inactive).exists())
        self.assertFalse(Bill.objects.filter(household=unrouted).exists())

    def test_negotiated_charge_beats_the_tier_charge(self):
        standard = self.make_household("1/A")
        negotiated = self.make_household("2/A", charge=175)

        generate_bills(PERIOD)

        self.assertEqual(Bill.objects.get(household=standard).amount, self.tier.charge)
        self.assertEqual(Bill.objects.get(household=negotiated).amount, 175)

    def test_dry_run_writes_nothing(self):
        self.make_household("1/A")

        summary = generate_bills(PERIOD, dry_run=True)

        self.assertEqual(summary["created"], 1)
        self.assertEqual(summary["amount"], 300)
        self.assertTrue(summary["dryRun"])
        self.assertFalse(Bill.objects.exists())
        self.assertFalse(BillingRun.objects.exists())

    def test_generating_bills_updates_cached_dues(self):
        household = self.make_household("1/A")

        generate_bills(PERIOD)

        household.refresh_from_db()
        self.assertEqual(household.dues, 300)

    def test_a_malformed_period_is_refused(self):
        with self.assertRaises(DomainError):
            generate_bills("2026-13")
        with self.assertRaises(DomainError):
            generate_bills("July")


class RecordPaymentTests(BillingTestCase):
    def setUp(self):
        self.household = self.make_household("1/A")
        generate_bills(PERIOD, issued_on=date(2026, 7, 1), due_days=10)
        self.bill = Bill.objects.get(household=self.household, period=PERIOD)

    def test_partial_payment_sets_status_partial(self):
        record_payment(
            self.bill, amount=100, method=self.cash, collector=self.collector, at=at(5)
        )

        self.bill.refresh_from_db()
        self.assertEqual(self.bill.status, BillStatus.PARTIAL)
        self.assertEqual(self.bill.received, 100)
        self.assertEqual(self.bill.outstanding, 200)
        # The 'paid via' column follows the most recent payment.
        self.assertEqual(self.bill.method_id, self.cash.id)

    def test_full_payment_sets_status_paid(self):
        record_payment(self.bill, amount=300, method=self.bkash, at=at(6))

        self.bill.refresh_from_db()
        self.assertEqual(self.bill.status, BillStatus.PAID)
        self.assertEqual(self.bill.outstanding, 0)
        self.assertEqual(self.bill.method_id, self.bkash.id)

    def test_instalments_settle_the_bill(self):
        record_payment(self.bill, amount=100, method=self.cash, at=at(5))
        record_payment(self.bill, amount=200, method=self.bkash, at=at(9))

        self.bill.refresh_from_db()
        self.assertEqual(self.bill.status, BillStatus.PAID)
        self.assertEqual(self.bill.received, 300)
        self.assertEqual(self.bill.payments.count(), 2)

    def test_overpayment_is_rejected(self):
        with self.assertRaises(DomainError) as caught:
            record_payment(self.bill, amount=400, method=self.cash, at=at(5))

        self.assertEqual(caught.exception.code, "overpayment")
        # Naming the figure is what lets the collector correct the keystroke.
        self.assertIn("300", str(caught.exception.detail))
        self.assertFalse(Payment.objects.exists())

    def test_overpayment_after_a_partial_is_rejected(self):
        record_payment(self.bill, amount=100, method=self.cash, at=at(5))

        with self.assertRaises(DomainError):
            record_payment(self.bill, amount=250, method=self.cash, at=at(6))

        self.bill.refresh_from_db()
        self.assertEqual(self.bill.received, 100)

    def test_paying_a_settled_bill_is_rejected(self):
        record_payment(self.bill, amount=300, method=self.cash, at=at(5))

        with self.assertRaises(DomainError) as caught:
            record_payment(self.bill, amount=50, method=self.cash, at=at(6))

        self.assertEqual(caught.exception.code, "already_paid")

    def test_non_positive_payment_is_rejected(self):
        with self.assertRaises(DomainError):
            record_payment(self.bill, amount=0, method=self.cash, at=at(5))

    def test_dues_follow_the_payments(self):
        self.household.refresh_from_db()
        self.assertEqual(self.household.dues, 300)

        record_payment(self.bill, amount=120, method=self.cash, at=at(5))
        self.household.refresh_from_db()
        self.assertEqual(self.household.dues, 180)

        record_payment(self.bill, amount=180, method=self.cash, at=at(7))
        self.household.refresh_from_db()
        self.assertEqual(self.household.dues, 0)

    def test_dues_span_several_months(self):
        generate_bills("2026-08", issued_on=date(2026, 8, 1))
        self.household.refresh_from_db()
        self.assertEqual(self.household.dues, 600)

        record_payment(self.bill, amount=300, method=self.cash, at=at(20))
        self.household.refresh_from_db()
        self.assertEqual(self.household.dues, 300)

    def test_payment_inherits_the_bills_household(self):
        payment = record_payment(self.bill, amount=50, method=self.cash, at=at(5))

        self.assertEqual(payment.household_id, self.household.id)
        self.assertTrue(payment.id.startswith(f"PAY-{PERIOD}-"))
        self.assertEqual(payment.period, PERIOD)


class VoidPaymentTests(BillingTestCase):
    def setUp(self):
        self.household = self.make_household("1/A")
        # Issued today so the bill is not yet due whenever the suite runs — the
        # point here is the status a void falls back to, not the overdue rule.
        generate_bills(PERIOD, issued_on=timezone.localdate(), due_days=10)
        self.bill = Bill.objects.get(household=self.household, period=PERIOD)

    def test_voiding_the_only_payment_restores_unpaid_and_dues(self):
        payment = record_payment(self.bill, amount=300, method=self.cash, at=at(5))
        self.bill.refresh_from_db()
        self.assertEqual(self.bill.status, BillStatus.PAID)

        bill = void_payment(payment, user=None)

        self.assertEqual(bill.status, BillStatus.UNPAID)
        self.assertEqual(bill.received, 0)
        self.assertIsNone(bill.method_id)
        self.household.refresh_from_db()
        self.assertEqual(self.household.dues, 300)
        self.assertFalse(Payment.objects.exists())

    def test_voiding_one_instalment_falls_back_to_partial(self):
        record_payment(self.bill, amount=100, method=self.cash, at=at(5))
        second = record_payment(self.bill, amount=200, method=self.bkash, at=at(9))
        self.bill.refresh_from_db()
        self.assertEqual(self.bill.status, BillStatus.PAID)

        bill = void_payment(second, user=None)

        self.assertEqual(bill.status, BillStatus.PARTIAL)
        self.assertEqual(bill.received, 100)
        # 'Paid via' falls back to the payment that is still on record.
        self.assertEqual(bill.method_id, self.cash.id)
        self.household.refresh_from_db()
        self.assertEqual(self.household.dues, 200)


class DepositTests(BillingTestCase):
    def setUp(self):
        self.household = self.make_household("1/A")
        self.other = self.make_household("2/A")
        generate_bills(PERIOD, issued_on=date(2026, 7, 1), due_days=10)
        self.bill = Bill.objects.get(household=self.household, period=PERIOD)
        self.other_bill = Bill.objects.get(household=self.other, period=PERIOD)

    def test_recording_a_hand_in_links_the_collectors_payments(self):
        payment = record_payment(
            self.bill, amount=300, method=self.cash, collector=self.collector, at=at(5)
        )

        deposit = record_deposit(self.collector, PERIOD, self.cash, 300, ref="DR-1")

        payment.refresh_from_db()
        self.assertEqual(payment.deposit_id, deposit.id)
        self.assertTrue(deposit.id.startswith(f"DEP-{PERIOD}-"))

    def test_only_the_matching_collector_method_and_month_are_linked(self):
        mine = record_payment(
            self.bill, amount=300, method=self.cash, collector=self.collector, at=at(5)
        )
        theirs = record_payment(
            self.other_bill, amount=300, method=self.cash, collector=self.other_collector,
            at=at(5),
        )

        deposit = record_deposit(self.collector, PERIOD, self.cash, 300)

        mine.refresh_from_db()
        theirs.refresh_from_db()
        self.assertEqual(mine.deposit_id, deposit.id)
        self.assertIsNone(theirs.deposit_id)

    def test_second_hand_in_upserts_rather_than_duplicating(self):
        first = record_deposit(self.collector, PERIOD, self.cash, 200, ref="DR-1")
        second = record_deposit(self.collector, PERIOD, self.cash, 275, ref="DR-2")

        self.assertEqual(first.pk, second.pk)
        self.assertEqual(Deposit.objects.count(), 1)
        row = Deposit.objects.get()
        self.assertEqual(row.amount, 275)
        self.assertEqual(row.ref, "DR-2")

    def test_the_same_month_in_a_different_method_is_a_separate_row(self):
        record_deposit(self.collector, PERIOD, self.cash, 200)
        record_deposit(self.collector, PERIOD, self.bkash, 100)

        self.assertEqual(Deposit.objects.filter(collector=self.collector).count(), 2)


class CashPositionTests(BillingTestCase):
    def setUp(self):
        self.household = self.make_household("1/A")
        self.other = self.make_household("2/A")
        generate_bills(PERIOD, issued_on=date(2026, 7, 1), due_days=10)
        self.bill = Bill.objects.get(household=self.household, period=PERIOD)
        self.other_bill = Bill.objects.get(household=self.other, period=PERIOD)

    def test_variance_shows_a_shortfall_in_the_hand_in(self):
        record_payment(
            self.bill, amount=300, method=self.cash, collector=self.collector, at=at(5)
        )
        record_payment(
            self.other_bill, amount=300, method=self.cash, collector=self.collector, at=at(6)
        )
        # 600 taken, only 450 handed in.
        record_deposit(self.collector, PERIOD, self.cash, 450)

        position = cash_position(PERIOD)
        row = next(r for r in position["rows"] if r["collector"] == self.collector.id)

        self.assertEqual(row["collected"], 600)
        self.assertEqual(row["deposited"], 450)
        self.assertEqual(row["variance"], 150)
        self.assertEqual(position["totals"]["variance"], 150)

    def test_variance_is_zero_when_the_hand_in_reconciles(self):
        record_payment(
            self.bill, amount=300, method=self.cash, collector=self.collector, at=at(5)
        )
        record_deposit(self.collector, PERIOD, self.cash, 300)

        row = next(
            r for r in cash_position(PERIOD)["rows"] if r["collector"] == self.collector.id
        )
        self.assertEqual(row["variance"], 0)

    def test_methods_are_reported_separately(self):
        record_payment(
            self.bill, amount=200, method=self.cash, collector=self.collector, at=at(5)
        )
        record_payment(
            self.bill, amount=100, method=self.bkash, collector=self.collector, at=at(6)
        )
        record_deposit(self.collector, PERIOD, self.cash, 200)

        row = next(
            r for r in cash_position(PERIOD)["rows"] if r["collector"] == self.collector.id
        )
        self.assertEqual(row["byMethod"][self.cash.id]["variance"], 0)
        # The bKash money is on record as taken but not yet handed in.
        self.assertEqual(row["byMethod"][self.bkash.id]["variance"], 100)

    def test_payments_outside_the_month_are_excluded(self):
        record_payment(
            self.bill, amount=300, method=self.cash, collector=self.collector,
            at=timezone.make_aware(datetime(2026, 8, 2, 11, 0)),
        )

        position = cash_position(PERIOD)

        self.assertEqual(position["totals"]["collected"], 0)
        self.assertEqual(cash_position("2026-08")["totals"]["collected"], 300)


class SummaryAndFilterTests(BillingTestCase):
    """The derived state must be computed in SQL, not in a Python loop.

    These cover the pieces the API layer leans on: the `paid_total` subquery, the
    settlement filter built on it, and the summary aggregates.
    """

    def setUp(self):
        # Issued in the past and already due, so 'unpaid' and 'overdue' are
        # distinguishable whichever day the suite runs.
        self.paid_hh = self.make_household("1/A")
        self.partial_hh = self.make_household("2/A")
        self.overdue_hh = self.make_household("3/A")
        generate_bills(PERIOD, issued_on=date(2026, 7, 1), due_days=10)
        # And one that is not due yet, so it counts as unpaid rather than overdue.
        self.unpaid_hh = self.make_household("4/A")
        generate_bills(PERIOD, issued_on=timezone.localdate(), due_days=30)

        record_payment(
            Bill.objects.get(household=self.paid_hh), amount=300, method=self.cash, at=at(5)
        )
        record_payment(
            Bill.objects.get(household=self.partial_hh), amount=100, method=self.cash, at=at(5)
        )

    def test_paid_total_is_annotated_per_bill(self):
        rows = {
            row.household_id: row.paid_total
            for row in with_paid_total(Bill.objects.filter(period=PERIOD))
        }
        self.assertEqual(rows[self.paid_hh.id], 300)
        self.assertEqual(rows[self.partial_hh.id], 100)
        self.assertEqual(rows[self.overdue_hh.id], 0)

    def test_summary_totals_and_counts(self):
        summary = billing_summary(Bill.objects.all(), period=PERIOD)

        self.assertEqual(summary["bills"], 4)
        self.assertEqual(summary["billed"], 1200)
        # Not "paid bills plus half of each partial", which is how the mock got a
        # different answer here than the reports did.
        self.assertEqual(summary["received"], 400)
        self.assertEqual(summary["outstanding"], 800)
        self.assertEqual(summary["rate"], 33)
        self.assertEqual(
            summary["counts"], {"paid": 1, "partial": 1, "unpaid": 1, "overdue": 1}
        )

    def test_summary_of_an_empty_period_is_all_zeroes(self):
        summary = billing_summary(Bill.objects.all(), period="2026-01")

        self.assertEqual(summary["billed"], 0)
        self.assertEqual(summary["rate"], 0)
        self.assertEqual(summary["counts"]["paid"], 0)

    def test_two_instalments_do_not_double_count_the_billed_amount(self):
        """A join to payments would report this bill's 300 BDT twice."""
        record_payment(
            Bill.objects.get(household=self.partial_hh), amount=50, method=self.bkash, at=at(9)
        )

        summary = billing_summary(Bill.objects.all(), period=PERIOD)

        self.assertEqual(summary["billed"], 1200)
        self.assertEqual(summary["received"], 450)

    def _filtered(self, **params):
        queryset = BillFilter(params, queryset=Bill.objects.filter(period=PERIOD)).qs
        return {row.household_id for row in queryset}

    def test_settlement_filter_derives_each_state_in_sql(self):
        self.assertEqual(self._filtered(settlement="paid"), {self.paid_hh.id})
        self.assertEqual(self._filtered(settlement="partial"), {self.partial_hh.id})
        self.assertEqual(self._filtered(settlement="overdue"), {self.overdue_hh.id})
        self.assertEqual(self._filtered(settlement="unpaid"), {self.unpaid_hh.id})

    def test_has_outstanding_filter(self):
        self.assertEqual(
            self._filtered(hasOutstanding="true"),
            {self.partial_hh.id, self.overdue_hh.id, self.unpaid_hh.id},
        )
        self.assertEqual(self._filtered(hasOutstanding="false"), {self.paid_hh.id})

    def test_settlement_filter_disagrees_with_a_stale_status_column(self):
        """The filter must trust the payments, not the cached column.

        Writing a wrong `status` straight to the database is exactly what the mock
        UI effectively did; the derived filter is unmoved by it.
        """
        Bill.objects.filter(household=self.overdue_hh).update(status=BillStatus.PAID)

        self.assertEqual(self._filtered(settlement="paid"), {self.paid_hh.id})
        self.assertEqual(self._filtered(status="paid"), {self.paid_hh.id, self.overdue_hh.id})
