"""Monthly charges, the money collected against them, and collector hand-ins.

The mock had a structural flaw the reports worked around: the Billing page marked
a bill "paid" without writing a `payments` row, so billing totals and report
totals disagreed by design. Here **recording a payment is the only way a bill's
status changes** — `Bill.status` is a cache that `recalculate()` derives from the
payments that actually exist.

Money is stored in whole taka (BDT has no subunit in practice here), as integers.
"""

from __future__ import annotations

from django.db import models
from django.db.models import Sum
from django.db.models.functions import Coalesce
from django.utils import timezone

from swms.common.ids import deposit_id, payment_id, remittance_id
from swms.common.models import TextKeyModel, TimeStampedModel


class BillStatus(models.TextChoices):
    UNPAID = "unpaid", "Unpaid"
    PARTIAL = "partial", "Partially paid"
    PAID = "paid", "Paid"
    OVERDUE = "overdue", "Overdue"


class BillingRun(TimeStampedModel):
    """One month's bill generation. Makes the run auditable and idempotent."""

    period = models.CharField(max_length=7, unique=True, help_text="YYYY-MM")
    issued_on = models.DateField()
    generated_by = models.ForeignKey(
        "accounts.User", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    bill_count = models.PositiveIntegerField(default=0)
    total_amount = models.PositiveIntegerField(default=0)

    class Meta:
        db_table = "billing_run"
        ordering = ["-period"]

    def __str__(self) -> str:
        return f"Billing run {self.period} ({self.bill_count} bills)"


class Bill(TextKeyModel):
    """A household's charge for one month. Id: 'B-2026-07-0012840'."""

    household = models.ForeignKey(
        "customers.Household", on_delete=models.CASCADE, related_name="bills"
    )
    #: Denormalised so ward-level billing reports avoid a join on a large table.
    ward = models.ForeignKey("catalog.Ward", on_delete=models.PROTECT, related_name="bills")
    run = models.ForeignKey(
        BillingRun, null=True, blank=True, on_delete=models.SET_NULL, related_name="bills"
    )

    period = models.CharField(max_length=7, db_index=True, help_text="YYYY-MM being charged for")
    issued_at = models.DateField()
    due_on = models.DateField(null=True, blank=True)
    amount = models.PositiveIntegerField(help_text="BDT")

    #: Cached settlement state. Never set by hand — see recalculate().
    status = models.CharField(
        max_length=8, choices=BillStatus.choices, default=BillStatus.UNPAID, db_index=True
    )
    #: Method of the most recent payment, for the "paid via" column.
    method = models.ForeignKey(
        "catalog.PaymentMode", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )

    class Meta:
        db_table = "bill"
        ordering = ["-period", "household_id"]
        indexes = [
            models.Index(fields=["period", "status"]),
            models.Index(fields=["household", "-period"]),
            models.Index(fields=["ward", "period"]),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["household", "period"], name="bill_one_per_household_per_period"
            )
        ]

    def __str__(self) -> str:
        return f"{self.id} — {self.amount} BDT"

    @property
    def head(self) -> str:
        """The mock carried a copy of the householder's name on each bill."""
        return self.household.head

    @property
    def received(self) -> int:
        return self.payments.aggregate(total=Sum("amount"))["total"] or 0

    @property
    def outstanding(self) -> int:
        return max(self.amount - self.received, 0)

    def settlement(self, today=None) -> str:
        """Derive the true state from payments — never trust `status` blindly."""
        received = self.received
        if received >= self.amount:
            return BillStatus.PAID
        if received > 0:
            return BillStatus.PARTIAL
        today = today or timezone.localdate()
        if self.due_on and self.due_on < today:
            return BillStatus.OVERDUE
        return BillStatus.UNPAID

    def recalculate(self, *, save: bool = True) -> str:
        """Refresh the cached status and the household's dues balance."""
        state = self.settlement()
        latest = self.payments.order_by("-at").first()
        self.status = state
        self.method_id = latest.method_id if latest else None
        if save:
            self.save(update_fields=["status", "method", "updated_at"])
            refresh_household_dues(self.household_id)
        return state


class Payment(TextKeyModel):
    """Money received against a bill. Id: 'PAY-2026-07-00042'."""

    bill = models.ForeignKey(Bill, on_delete=models.CASCADE, related_name="payments")
    household = models.ForeignKey(
        "customers.Household", on_delete=models.CASCADE, related_name="payments"
    )
    collector = models.ForeignKey(
        "fieldops.Collector",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="payments",
        help_text="Who actually took the money",
    )
    #: Which agency's collector took it, stamped in `save()` from their
    #: employment on the day. This is the row that will say who owes KCC the
    #: remittance; resolving it through today's employer instead would move a
    #: past debt every time somebody changed jobs. Null for an office-counter
    #: payment, which has no collector and is KCC's own.
    agency = models.ForeignKey(
        "agencies.Agency",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="payments",
    )
    amount = models.PositiveIntegerField(help_text="BDT")
    method = models.ForeignKey("catalog.PaymentMode", on_delete=models.PROTECT, related_name="+")
    at = models.DateTimeField(default=timezone.now, db_index=True)
    reference = models.CharField(max_length=64, blank=True, help_text="bKash/bank transaction id")
    note = models.CharField(max_length=200, blank=True)
    recorded_by = models.ForeignKey(
        "accounts.User", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    deposit = models.ForeignKey(
        "billing.Deposit",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="payments",
        help_text="Set once this cash has been handed in",
    )

    class Meta:
        db_table = "payment"
        ordering = ["-at"]
        indexes = [
            models.Index(fields=["household", "-at"]),
            models.Index(fields=["collector", "-at"]),
            models.Index(fields=["bill"]),
        ]

    def __str__(self) -> str:
        return f"{self.id} — {self.amount} BDT"

    def save(self, *args, **kwargs):
        if not self.household_id:
            self.household_id = self.bill.household_id
        if not self.id:
            self.id = payment_id(self.bill.period)
        if self.agency_id is None and self.collector_id is not None:
            # Stamped here rather than resolved at read time: this row says
            # which agency owes KCC this taka, and a later transfer must not
            # move that debt to the collector's new employer.
            from swms.agencies.services import stamp_agency_for

            self.agency = stamp_agency_for(self.collector, timezone.localtime(self.at).date())
        super().save(*args, **kwargs)
        # A payment is the only thing that can change a bill's settlement.
        self.bill.recalculate()

    @property
    def period(self) -> str:
        """The month the money was *taken* in — not the month it pays for."""
        return timezone.localtime(self.at).strftime("%Y-%m")


class Deposit(TextKeyModel):
    """A collector handing collected cash in to the office. Id: 'DEP-2026-07-0012'."""

    collector = models.ForeignKey(
        "fieldops.Collector", on_delete=models.CASCADE, related_name="deposits"
    )
    #: Stamped like `Payment.agency`, and for the same reason: this hand-in is
    #: part of what one agency owes KCC. Reading it back through the collector's
    #: current employer would move a settled month's cash onto whoever employs
    #: them now.
    agency = models.ForeignKey(
        "agencies.Agency",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="deposits",
    )
    period = models.CharField(max_length=7, db_index=True, help_text="YYYY-MM")
    method = models.ForeignKey("catalog.PaymentMode", on_delete=models.PROTECT, related_name="+")
    amount = models.PositiveIntegerField(help_text="BDT handed in")
    at = models.DateTimeField(default=timezone.now)
    ref = models.CharField(max_length=32, blank=True, help_text="Deposit slip reference")
    received_by = models.ForeignKey(
        "accounts.User", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )

    class Meta:
        db_table = "deposit"
        ordering = ["-at"]
        indexes = [models.Index(fields=["collector", "period"])]
        constraints = [
            models.UniqueConstraint(
                fields=["collector", "period", "method"], name="deposit_unique_per_method"
            )
        ]

    def __str__(self) -> str:
        return f"{self.id} — {self.collector_id} {self.period}"

    def save(self, *args, **kwargs):
        if not self.id:
            self.id = deposit_id(self.period)
        if self.agency_id is None and self.collector_id is not None:
            from swms.agencies.services import stamp_agency_for

            # Resolved as of the month being settled, not today, so a hand-in
            # keyed months later still lands on the agency that held the cash.
            self.agency = stamp_agency_for(self.collector, timezone.localtime(self.at).date())
        super().save(*args, **kwargs)


class Remittance(TextKeyModel):
    """An agency handing collected service charges to KCC. Id: 'REM-2026-07-0003'.

    The second hop of the money. A household pays a collector (`Payment`), the
    collector hands the cash to their agency (`Deposit`), and the agency remits
    it to the corporation — this row. Agencies remit in full, so what KCC should
    receive is simply what was collected.

    Unlike `Deposit`, this is **not** keyed unique per period: a bank transfer is
    an external document with its own reference, and folding two of them into one
    corrected total would break the trail back to the bank statement. Several
    remittances in a month are normal and the reconciliation sums them.
    """

    agency = models.ForeignKey(
        "agencies.Agency", on_delete=models.PROTECT, related_name="remittances"
    )
    period = models.CharField(max_length=7, db_index=True, help_text="YYYY-MM being settled")
    method = models.ForeignKey(
        "catalog.PaymentMode",
        on_delete=models.PROTECT,
        related_name="+",
        help_text="How the agency paid KCC — bank transfer, cheque, cash",
    )
    amount = models.PositiveIntegerField(help_text="BDT remitted")
    at = models.DateTimeField(default=timezone.now, db_index=True)
    ref = models.CharField(
        max_length=64, blank=True, help_text="Bank transfer / cheque / challan number"
    )
    received_by = models.ForeignKey(
        "accounts.User",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
        help_text="The KCC officer who accepted it",
    )
    note = models.CharField(max_length=200, blank=True)

    class Meta:
        db_table = "remittance"
        ordering = ["-at"]
        indexes = [
            models.Index(fields=["agency", "period"], name="remittance_agency_period_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.id} — {self.agency_id} {self.period} {self.amount} BDT"

    def save(self, *args, **kwargs):
        if not self.id:
            self.id = remittance_id(self.period)
        super().save(*args, **kwargs)


def refresh_household_dues(household_id: str) -> int:
    """Recompute a household's outstanding balance from its bills.

    `Household.dues` is a cache the UI reads on every list; keeping it correct
    here means no report has to sum bills on the fly.
    """
    from swms.customers.models import Household

    rows = Bill.objects.filter(household_id=household_id).annotate(
        paid=Coalesce(Sum("payments__amount"), 0)
    )
    dues = sum(max(row.amount - row.paid, 0) for row in rows)
    Household.objects.filter(pk=household_id).update(dues=dues)
    return dues
