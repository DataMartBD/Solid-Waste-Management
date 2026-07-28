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

from swms.common.ids import deposit_id, payment_id
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
