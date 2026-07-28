"""Bill, payment and deposit serializers.

The JSON keys are the ones the React pages already bind to, so Billing.jsx and
ReportsCustomer.jsx keep working unchanged: a bill speaks `hh`, `head`, `period`,
`issuedAt`, `amount`, `ward`, `status`, `method`; a payment speaks `bill`, `hh`,
`collector`, `amount`, `method`, `at`; a deposit speaks `collector`, `period`,
`method`, `amount`, `at`, `ref`.

Foreign keys travel as their string ids (`'W-14'`, `'cash'`, `'C-042'`), which is
what the UI already puts in `<select>` values.

Bills gain four read-only keys the mock had to compute in the browser —
`received`, `outstanding`, `settlement` and the nested `payments` — because they
are the numbers the Billing page and the customer report actually display, and
deriving them server-side is what stops the two screens disagreeing.
"""

from __future__ import annotations

from rest_framework import serializers

from swms.catalog.models import PaymentMode, Ward
from swms.common.serializers import SwmsModelSerializer
from swms.customers.models import Household
from swms.fieldops.models import Collector

from .models import Bill, BillingRun, Deposit, Payment
from .services import settlement_state


def _outstanding_of(bill: Bill, exclude_payment_id: str | None = None) -> int:
    """Room left on a bill, ignoring one payment (used when editing that payment)."""
    received = bill.received
    if exclude_payment_id:
        row = bill.payments.filter(pk=exclude_payment_id).first()
        if row:
            received -= row.amount
    return max(bill.amount - received, 0)


def _validate_amount_against_bill(bill, amount, *, exclude_payment_id=None):
    """Reject a payment that is not positive, or that would overpay the bill.

    Overpayment is refused rather than absorbed: a bill for 300 BDT that shows
    400 BDT received makes every collection-rate figure in the reports wrong, and
    the real-world cause is a mistyped amount, not a customer's generosity. The
    message names the outstanding figure so the collector can just correct it.
    """
    if bill is None:
        return
    if amount is None or amount <= 0:
        raise serializers.ValidationError({"amount": "A payment must be for a positive amount."})
    outstanding = _outstanding_of(bill, exclude_payment_id)
    if outstanding <= 0:
        raise serializers.ValidationError(
            {"amount": f"{bill.id} is already settled in full — nothing is outstanding."}
        )
    if amount > outstanding:
        raise serializers.ValidationError(
            {"amount": f"{amount} BDT exceeds the {outstanding} BDT outstanding on {bill.id}."}
        )


class PaymentSerializer(SwmsModelSerializer):
    """Money received against a bill."""

    # A payment's bill is not something to edit afterwards — correcting a mistake
    # means voiding the payment and recording the right one.
    write_once_fields = ("bill",)

    bill = serializers.PrimaryKeyRelatedField(queryset=Bill.objects.all())
    # The household is whichever one the bill belongs to. Accepting it from the
    # client would let a payment claim a household its bill does not charge.
    hh = serializers.CharField(source="household_id", read_only=True)
    collector = serializers.PrimaryKeyRelatedField(
        queryset=Collector.objects.all(), allow_null=True, required=False
    )
    method = serializers.PrimaryKeyRelatedField(queryset=PaymentMode.objects.all())
    at = serializers.DateTimeField(required=False)
    #: Read-only: set by handing the cash in (`POST /deposits/record/`).
    deposit = serializers.CharField(source="deposit_id", read_only=True)
    period = serializers.CharField(read_only=True, help_text="Month the money was taken in")

    class Meta:
        model = Payment
        fields = [
            "id",
            "bill",
            "hh",
            "collector",
            "amount",
            "method",
            "at",
            "reference",
            "note",
            "deposit",
            "period",
        ]
        read_only_fields = ["id"]

    def validate(self, attrs):
        attrs = super().validate(attrs)
        bill = attrs.get("bill") or (self.instance.bill if self.instance else None)
        amount = attrs.get("amount", getattr(self.instance, "amount", None))
        _validate_amount_against_bill(
            bill, amount, exclude_payment_id=self.instance.pk if self.instance else None
        )
        return attrs


class BillSerializer(SwmsModelSerializer):
    """A household's charge for one month, plus what has been received on it."""

    #: Which household and which month a charge is for is settled at issue time.
    write_once_fields = ("household", "period")

    hh = serializers.PrimaryKeyRelatedField(source="household", queryset=Household.objects.all())
    # Copied through from the household rather than stored — the mock kept its own
    # copy on every bill, which went stale the moment a name was corrected.
    head = serializers.CharField(source="household.head", read_only=True)
    ward = serializers.PrimaryKeyRelatedField(queryset=Ward.objects.all())
    issuedAt = serializers.DateField(source="issued_at")
    dueOn = serializers.DateField(source="due_on", read_only=True)
    run = serializers.PrimaryKeyRelatedField(read_only=True)

    # `status` and `method` are READ-ONLY, and this is the central rule of the
    # app. In the mock the Billing page flipped a bill to 'paid' and stamped a
    # method without writing any `payments` row, so the billing totals and the
    # report totals were guaranteed to disagree. Here both are caches that
    # `Bill.recalculate()` derives from the payments that exist: settling a bill
    # means POSTing to /bills/{id}/pay/, never PATCHing status.
    status = serializers.CharField(read_only=True)
    method = serializers.PrimaryKeyRelatedField(read_only=True)

    received = serializers.SerializerMethodField()
    outstanding = serializers.SerializerMethodField()
    settlement = serializers.SerializerMethodField()
    payments = PaymentSerializer(many=True, read_only=True)

    class Meta:
        model = Bill
        fields = [
            "id",
            "hh",
            "head",
            "period",
            "issuedAt",
            "dueOn",
            "amount",
            "ward",
            "status",
            "method",
            "run",
            "received",
            "outstanding",
            "settlement",
            "payments",
        ]
        read_only_fields = ["id"]

    # `BillViewSet` annotates `paid_total` with a subquery, so a list of 500 bills
    # costs one query instead of 500. The model properties stay as the fallback
    # for a bill fetched outside that queryset (the admin, a service, a test).
    def _received(self, obj) -> int:
        total = getattr(obj, "paid_total", None)
        return obj.received if total is None else int(total)

    def get_received(self, obj) -> int:
        return self._received(obj)

    def get_outstanding(self, obj) -> int:
        return max(obj.amount - self._received(obj), 0)

    def get_settlement(self, obj) -> str:
        """The truth, derived from payments — `status` is only its cache."""
        return settlement_state(obj.amount, self._received(obj), obj.due_on)


class DepositSerializer(SwmsModelSerializer):
    """A collector handing collected cash in to the office."""

    collector = serializers.PrimaryKeyRelatedField(queryset=Collector.objects.all())
    method = serializers.PrimaryKeyRelatedField(queryset=PaymentMode.objects.all())
    at = serializers.DateTimeField(required=False)

    class Meta:
        model = Deposit
        fields = ["id", "collector", "period", "method", "amount", "at", "ref"]
        read_only_fields = ["id"]

    def validate_period(self, value):
        return _validated_period(value)


class BillingRunSerializer(SwmsModelSerializer):
    """One month's generation, kept so a run is auditable and repeatable."""

    issuedOn = serializers.DateField(source="issued_on", read_only=True)
    billCount = serializers.IntegerField(source="bill_count", read_only=True)
    totalAmount = serializers.IntegerField(source="total_amount", read_only=True)
    generatedBy = serializers.SerializerMethodField()
    createdAt = serializers.DateTimeField(source="created_at", read_only=True)

    class Meta:
        model = BillingRun
        fields = ["id", "period", "issuedOn", "billCount", "totalAmount", "generatedBy",
                  "createdAt"]
        # Everything here is written by `generate_bills()`. A run row edited by
        # hand would claim a month was billed differently from how it was.
        read_only_fields = ["id", "period"]

    def get_generatedBy(self, obj) -> str | None:
        return obj.generated_by.name if obj.generated_by_id else None


# --------------------------------------------------------------------------- #
# Action payloads
# --------------------------------------------------------------------------- #


def _validated_period(value: str) -> str:
    if not isinstance(value, str) or len(value) != 7 or value[4] != "-":
        raise serializers.ValidationError("Expected a billing period as YYYY-MM.")
    year, month = value[:4], value[5:]
    if not (year.isdigit() and month.isdigit() and 1 <= int(month) <= 12):
        raise serializers.ValidationError("Expected a billing period as YYYY-MM.")
    return value


class RecordDepositSerializer(DepositSerializer):
    """`POST /deposits/record/` — the same payload, upserted rather than inserted.

    The `(collector, period, method)` uniqueness validator is dropped on purpose:
    a collector who hands cash in twice in a month should end with one corrected
    total, not a rejected second hand-in (and not two rows the reconciliation
    report would have to know to add together). `record_deposit()` performs the
    upsert; the database constraint still guarantees there is only ever one row.
    """

    class Meta(DepositSerializer.Meta):
        validators = []


class RecordPaymentSerializer(serializers.Serializer):
    """`POST /bills/{id}/pay/` — the only way a bill's status can change.

    The bill comes from the URL, so it cannot be spoofed in the body. `collector`
    is optional because the office also takes payments over the counter; when a
    collector is signed in the view fills in their own staff record.
    """

    amount = serializers.IntegerField(min_value=1)
    method = serializers.PrimaryKeyRelatedField(queryset=PaymentMode.objects.all())
    at = serializers.DateTimeField(required=False)
    reference = serializers.CharField(required=False, allow_blank=True, max_length=64)
    note = serializers.CharField(required=False, allow_blank=True, max_length=200)
    collector = serializers.PrimaryKeyRelatedField(
        queryset=Collector.objects.all(), required=False, allow_null=True
    )

    def validate(self, attrs):
        _validate_amount_against_bill(self.context.get("bill"), attrs.get("amount"))
        return attrs


class GenerateBillsSerializer(serializers.Serializer):
    """`POST /bills/generate/` — run (or preview) one month's charges."""

    period = serializers.CharField()
    issuedOn = serializers.DateField(required=False)
    #: The mock's bills fell due ten days after issue; keep that as the default.
    dueDays = serializers.IntegerField(required=False, default=10, min_value=0, max_value=90)
    dryRun = serializers.BooleanField(required=False, default=False)

    def validate_period(self, value):
        return _validated_period(value)
