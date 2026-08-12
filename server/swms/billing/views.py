"""Billing endpoints: charges, money in, and cash hand-ins.

Three access rules shape this module, and they are deliberately different from
each other:

* Only an agency admin issues charges (`Bill`, `BillingRun` are ADMIN_WRITERS) —
  a supervisor cannot invent a bill for a household.
* Collectors record payments, because they are the people who take the money at
  the door, so `Payment` adds `Role.COLLECTOR` to the operational writers.
* Deposits are not ward-scoped at all. A collector's cash hand-in belongs to the
  collector and the month, not to a ward, so scoping it by ward would hide
  hand-ins from the very supervisor reconciling them.
"""

from __future__ import annotations

from django.db.models import F, Q
from django.utils import timezone
from django_filters import rest_framework as filters
from rest_framework.decorators import action
from rest_framework.response import Response

from swms.common.exceptions import DomainError
from swms.common.permissions import IsAgencyAdmin
from swms.common.roles import ADMIN_WRITERS, OPERATIONAL_WRITERS, Role
from swms.common.views import SwmsModelViewSet

from .models import Bill, BillingRun, BillStatus, Deposit, Payment, Remittance
from .serializers import (
    BillingRunSerializer,
    BillSerializer,
    DepositSerializer,
    GenerateBillsSerializer,
    PaymentSerializer,
    RecordDepositSerializer,
    RecordPaymentSerializer,
    RecordRemittanceSerializer,
    RemittanceSerializer,
)
from .services import (
    agency_cash_position,
    billing_summary,
    cash_position,
    generate_bills,
    paid_total_expr,
    period_bounds,
    record_deposit,
    record_payment,
    record_remittance,
    void_payment,
    with_paid_total,
)

#: Who may put money on record. Deliberately wider than who may bill for it: the
#: collector at the door is the person the cash is handed to.
PAYMENT_WRITERS = OPERATIONAL_WRITERS | {Role.COLLECTOR}


class BillFilter(filters.FilterSet):
    """What the Billing page and the customer-collection report ask for."""

    period = filters.CharFilter(field_name="period")
    ward = filters.CharFilter(field_name="ward_id")
    zone = filters.CharFilter(field_name="ward__zone_id")
    hh = filters.CharFilter(field_name="household_id")
    status = filters.ChoiceFilter(choices=BillStatus.choices)
    #: Derived state, computed in SQL. See `filter_settlement`.
    settlement = filters.ChoiceFilter(choices=BillStatus.choices, method="filter_settlement")
    hasOutstanding = filters.BooleanFilter(method="filter_has_outstanding")

    class Meta:
        model = Bill
        fields = ["period", "status", "ward", "zone", "hh", "run"]

    def filter_settlement(self, queryset, name, value):
        """Filter on what the payments say, not on the cached `status` column.

        `status` is only ever as fresh as the last `recalculate()`. Deriving the
        state in SQL from the annotated payment total means this filter and
        `BillSerializer.settlement` can never disagree, and it stays a queryset —
        filtering in Python would break pagination and ordering.
        """
        queryset = with_paid_total(queryset)
        today = timezone.localdate()
        if value == BillStatus.PAID:
            return queryset.filter(paid_total__gte=F("amount"))
        if value == BillStatus.PARTIAL:
            return queryset.filter(paid_total__gt=0, paid_total__lt=F("amount"))
        nothing_paid = queryset.filter(paid_total__lte=0)
        if value == BillStatus.OVERDUE:
            return nothing_paid.filter(due_on__lt=today)
        if value == BillStatus.UNPAID:
            return nothing_paid.filter(Q(due_on__isnull=True) | Q(due_on__gte=today))
        return queryset

    def filter_has_outstanding(self, queryset, name, value):
        queryset = with_paid_total(queryset)
        if value:
            return queryset.filter(paid_total__lt=F("amount"))
        return queryset.filter(paid_total__gte=F("amount"))


class BillViewSet(SwmsModelViewSet):
    """Monthly charges. Read widely, written only by a billing run or a payment."""

    serializer_class = BillSerializer
    filterset_class = BillFilter
    search_fields = ["id", "household_id", "household__head", "household__holding_no"]
    ordering_fields = ["period", "issued_at", "amount", "status", "household_id"]
    ordering = ["-period", "household_id"]
    ward_scope_field = "ward_id"
    #: A bill has no collector, so it belongs to whoever services the building.
    agency_scope_field = "household__holding__agency_id"
    #: Issuing charges is an agency-admin act; a supervisor collects, not bills.
    write_roles = ADMIN_WRITERS

    def get_permissions(self):
        """`pay` answers to the payment roles, not the billing roles.

        Issuing a charge and receiving money against one are different acts done
        by different people — an agency admin bills, a collector collects — and
        `pay` is the second of those even though it hangs off this viewset. Every
        other write here stays admin-only.
        """
        if self.action == "pay":
            self.write_roles = PAYMENT_WRITERS
        return super().get_permissions()

    def get_queryset(self):
        queryset = (
            Bill.objects.select_related("household", "ward", "method", "run")
            .prefetch_related("payments__method", "payments__collector")
            # One subquery for the whole page instead of one query per row for
            # `received`, `outstanding` and `settlement`.
            .annotate(paid_total=paid_total_expr())
        )
        return self.scope_queryset(queryset)

    def create(self, request, *args, **kwargs):
        """Bills come from a billing run, never from an ad-hoc insert.

        A hand-made bill would have no `run`, so the month's `BillingRun` totals
        would no longer describe the month, and a household could quietly end up
        charged twice for reasons no audit trail explains. Superusers are let
        through as a maintenance escape hatch (fixing seed data, backfilling a
        month the run missed) — they are the one caller who can be assumed to
        know they are stepping outside the process.
        """
        if not request.user.is_superuser:
            raise DomainError(
                "Bills are issued by a billing run. POST /api/bills/generate/ instead.",
                code="use_billing_run",
            )
        return super().create(request, *args, **kwargs)

    @action(detail=True, methods=["post"])
    def pay(self, request, pk=None):
        """Record money against this bill — the only way its status can change."""
        bill = self.get_object()
        serializer = RecordPaymentSerializer(
            data=request.data, context={**self.get_serializer_context(), "bill": bill}
        )
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        # A collector taking money at the door is the payment's collector by
        # default; the office counter has none, and that difference is what makes
        # the cash reconciliation meaningful.
        collector = data.get("collector") or getattr(request.user, "collector", None)

        record_payment(
            bill,
            amount=data["amount"],
            method=data["method"],
            collector=collector,
            at=data.get("at"),
            reference=data.get("reference", ""),
            note=data.get("note", ""),
            user=request.user,
        )
        # Re-read through the annotated queryset so the response carries the new
        # `received` / `outstanding` / `settlement` rather than stale values.
        return Response(self.get_serializer(self.get_queryset().get(pk=bill.pk)).data)

    @action(detail=False, methods=["post"], permission_classes=[IsAgencyAdmin])
    def generate(self, request):
        """Run — or with `dryRun`, preview — one month's charges."""
        serializer = GenerateBillsSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        summary = generate_bills(
            data["period"],
            issued_on=data.get("issuedOn"),
            due_days=data.get("dueDays", 10),
            user=request.user,
            dry_run=data.get("dryRun", False),
        )
        return Response(summary, status=200 if summary["dryRun"] else 201)

    @action(detail=False, methods=["get"])
    def summary(self, request):
        """The Billing page's stat cards, for one period.

        Honours the same query parameters as the list, so the cards always
        describe exactly the rows shown beneath them.
        """
        period = request.query_params.get("period")
        queryset = self.filter_queryset(self.get_queryset())
        return Response(billing_summary(queryset, period=period))


class PaymentFilter(filters.FilterSet):
    period = filters.CharFilter(method="filter_period")
    collector = filters.CharFilter(field_name="collector_id")
    hh = filters.CharFilter(field_name="household_id")
    bill = filters.CharFilter(field_name="bill_id")
    method = filters.CharFilter(field_name="method_id")
    #: Yields the `at_after` / `at_before` pair the reports page sends.
    at = filters.DateTimeFromToRangeFilter(field_name="at")
    undeposited = filters.BooleanFilter(method="filter_undeposited")

    class Meta:
        model = Payment
        fields = ["period", "collector", "hh", "bill", "method", "at"]

    def filter_period(self, queryset, name, value):
        """A payment's period is the month it was *taken* in, in local time.

        Not the month its bill covers — a July bill settled in August is money
        received in August, and keeping the two apart is what makes a collection
        lag visible instead of invisible.
        """
        start, end = period_bounds(value)
        return queryset.filter(at__gte=start, at__lt=end)

    def filter_undeposited(self, queryset, name, value):
        """Money a collector has taken but not yet handed in."""
        return queryset.filter(deposit__isnull=value)


class PaymentViewSet(SwmsModelViewSet):
    """Money received. Immutable in practice: correct one by voiding it."""

    serializer_class = PaymentSerializer
    filterset_class = PaymentFilter
    search_fields = ["id", "bill_id", "household_id", "reference"]
    ordering_fields = ["at", "amount"]
    ordering = ["-at"]
    #: A payment belongs to the ward its household sits in.
    ward_scope_field = "household__ward_id"
    agency_scope_field = "agency_id"
    #: Collectors take money in the field, so they must be able to record it.
    write_roles = PAYMENT_WRITERS

    def get_queryset(self):
        queryset = Payment.objects.select_related(
            "bill", "household", "collector", "method", "deposit"
        )
        return self.scope_queryset(queryset)

    def perform_create(self, serializer):
        """Stamp who recorded this, and credit a signed-in collector by default."""
        collector = serializer.validated_data.get("collector") or getattr(
            self.request.user, "collector", None
        )
        serializer.save(recorded_by=self.request.user, collector=collector)

    @action(detail=True, methods=["post"], permission_classes=[IsAgencyAdmin])
    def void(self, request, pk=None):
        """Remove a mis-keyed payment and restate the bill from what remains.

        Agency-admin only: this is the one operation that can make money on record
        disappear, so it does not belong to the person who keyed it in.
        """
        payment = self.get_object()
        bill = void_payment(payment, user=request.user)
        return Response(
            BillSerializer(
                Bill.objects.annotate(paid_total=paid_total_expr()).get(pk=bill.pk),
                context=self.get_serializer_context(),
            ).data
        )


class DepositFilter(filters.FilterSet):
    collector = filters.CharFilter(field_name="collector_id")
    method = filters.CharFilter(field_name="method_id")

    class Meta:
        model = Deposit
        fields = ["period", "collector", "method"]


class DepositViewSet(SwmsModelViewSet):
    """Collector cash hand-ins, and the reconciliation they feed."""

    serializer_class = DepositSerializer
    filterset_class = DepositFilter
    search_fields = ["id", "collector_id", "ref"]
    ordering_fields = ["at", "period", "amount"]
    ordering = ["-at"]
    # Not ward-scoped: a hand-in is a fact about a collector and a month, not
    # about a ward, and a supervisor reconciling their team needs to see all of
    # it. `None` here is a decision, not an omission.
    ward_scope_field = None
    # …but it *is* an agency fact: the cash belongs to whoever employed the
    # collector, which is why `Deposit.agency` is stamped at write time.
    agency_scope_field = "agency_id"
    write_roles = OPERATIONAL_WRITERS

    def get_queryset(self):
        return self.scope_queryset(Deposit.objects.select_related("collector", "method"))

    @action(detail=False, methods=["post"])
    def record(self, request):
        """Upsert this collector's hand-in for the month and link its payments."""
        serializer = RecordDepositSerializer(
            data=request.data, context=self.get_serializer_context()
        )
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        deposit = record_deposit(
            data["collector"],
            data["period"],
            data["method"],
            data["amount"],
            at=data.get("at"),
            ref=data.get("ref", ""),
            user=request.user,
        )
        return Response(self.get_serializer(deposit).data, status=201)

    @action(detail=False, methods=["get"], url_path="cash-position")
    def cash_position(self, request):
        """Collected vs deposited vs variance, per collector, for one month."""
        period = request.query_params.get("period")
        if not period:
            raise DomainError("A ?period=YYYY-MM is required.", code="period_required")
        return Response(cash_position(period))


class BillingRunViewSet(SwmsModelViewSet):
    """The audit list of billing runs. Written by `POST /bills/generate/`."""

    serializer_class = BillingRunSerializer
    filterset_fields = ["period"]
    ordering_fields = ["period", "created_at"]
    search_fields = ["period"]
    #: A run is not ward-scoped — it covers the whole city for one month.
    ward_scope_field = None
    #: Nor agency-scoped: KCC issues the charges, and a run is the corporation's
    #: own act covering every contractor at once. There is nothing here that
    #: belongs to one agency.
    agency_scope_field = None
    write_roles = ADMIN_WRITERS

    def get_queryset(self):
        return self.scope_queryset(BillingRun.objects.select_related("generated_by"))

    def create(self, request, *args, **kwargs):
        raise DomainError(
            "A billing run is created by POST /api/bills/generate/.",
            code="use_billing_run",
        )


class RemittanceFilter(filters.FilterSet):
    agency = filters.CharFilter(field_name="agency_id")

    class Meta:
        model = Remittance
        fields = ["agency", "period", "method"]


class RemittanceViewSet(SwmsModelViewSet):
    """Agency hand-overs to KCC, and the cash position they close out."""

    serializer_class = RemittanceSerializer
    filterset_class = RemittanceFilter
    search_fields = ["id", "agency__name", "agency__short_code", "ref"]
    ordering_fields = ["at", "period", "amount"]
    ordering = ["-at"]
    # Like deposits: a remittance is a fact about an agency and a month, not
    # about a ward.
    ward_scope_field = None
    agency_scope_field = "agency_id"
    # Money leaving the contractor for the corporation is master-data territory.
    write_roles = ADMIN_WRITERS

    def get_queryset(self):
        return self.scope_queryset(
            Remittance.objects.select_related("agency", "method", "received_by")
        )

    @action(detail=False, methods=["post"])
    def record(self, request):
        """Record one transfer. Several a month are normal — see the model."""
        serializer = RecordRemittanceSerializer(
            data=request.data, context=self.get_serializer_context()
        )
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        remittance = record_remittance(
            data["agency"],
            data["period"],
            data["method"],
            data["amount"],
            at=data.get("at"),
            ref=data.get("ref", ""),
            note=data.get("note", ""),
            user=request.user,
        )
        return Response(self.get_serializer(remittance).data, status=201)

    @action(detail=False, methods=["get"], url_path="cash-position")
    def cash_position(self, request):
        """Collected → deposited → remitted, per agency, for one month."""
        period = request.query_params.get("period")
        if not period:
            raise DomainError("A ?period=YYYY-MM is required.", code="period_required")
        return Response(
            agency_cash_position(period, agency=request.query_params.get("agency") or None)
        )
