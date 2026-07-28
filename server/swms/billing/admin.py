"""Back-office views of the money tables.

The bill list shows `received` and `outstanding` because a bill's `status` alone
is the thing that used to lie — seeing the figure next to the badge makes a
disagreement obvious at a glance instead of only in a report.

Nothing here lets an operator type a status: the fields that `recalculate()`
owns are read-only, so even in the admin a bill can only be settled by a payment.
"""

from __future__ import annotations

from django.contrib import admin

from .models import Bill, BillingRun, Deposit, Payment
from .services import paid_total_expr


class PaymentInline(admin.TabularInline):
    """A bill's payments, in place — the evidence behind its status."""

    model = Payment
    extra = 0
    fields = ("id", "amount", "method", "collector", "at", "reference", "deposit")
    readonly_fields = ("id",)
    # raw_id rather than autocomplete: the catalog and staff apps do not register
    # their own ModelAdmins, and autocomplete needs a registered target.
    raw_id_fields = ("method", "collector")


@admin.register(BillingRun)
class BillingRunAdmin(admin.ModelAdmin):
    list_display = ("period", "issued_on", "bill_count", "total_amount", "generated_by")
    search_fields = ("period",)
    ordering = ("-period",)
    readonly_fields = ("bill_count", "total_amount", "created_at", "updated_at")


@admin.register(Bill)
class BillAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "household",
        "ward",
        "period",
        "amount",
        "received_display",
        "outstanding_display",
        "status",
        "method",
        "due_on",
    )
    list_filter = ("period", "status", "ward", "method")
    search_fields = ("id", "household__id", "household__head", "household__holding")
    date_hierarchy = "issued_at"
    ordering = ("-period", "household_id")
    raw_id_fields = ("household", "ward", "method")
    # `status` and `method` are caches of the payments below, so they are shown
    # but never typed. Correcting a settlement means adding or voiding a payment.
    readonly_fields = ("id", "status", "method", "run", "created_at", "updated_at")
    inlines = [PaymentInline]

    def get_queryset(self, request):
        # Annotated so the two money columns cost one subquery, not one per row.
        return super().get_queryset(request).annotate(paid_total=paid_total_expr())

    @admin.display(description="Received", ordering="paid_total")
    def received_display(self, obj) -> int:
        return getattr(obj, "paid_total", None) or 0

    @admin.display(description="Outstanding")
    def outstanding_display(self, obj) -> int:
        return max(obj.amount - (getattr(obj, "paid_total", None) or 0), 0)


@admin.register(Payment)
class PaymentAdmin(admin.ModelAdmin):
    list_display = ("id", "bill", "household", "collector", "amount", "method", "at", "deposit")
    list_filter = ("method", "collector", "at")
    search_fields = ("id", "bill__id", "household__id", "household__head", "reference")
    date_hierarchy = "at"
    ordering = ("-at",)
    raw_id_fields = ("bill", "household", "collector", "method", "deposit")
    readonly_fields = ("id", "created_at", "updated_at")


@admin.register(Deposit)
class DepositAdmin(admin.ModelAdmin):
    list_display = ("id", "collector", "period", "method", "amount", "at", "ref", "received_by")
    list_filter = ("period", "method", "collector")
    search_fields = ("id", "collector__id", "collector__name", "ref")
    ordering = ("-at",)
    raw_id_fields = ("collector", "method", "received_by")
    readonly_fields = ("id", "created_at", "updated_at")
