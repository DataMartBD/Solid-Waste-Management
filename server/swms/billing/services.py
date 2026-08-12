"""Billing domain operations: the monthly run, money in, and cash hand-ins.

Everything that moves money lives here rather than in a serializer or a view,
because each of these operations touches more than one table and must either
happen completely or not at all.

The one rule the whole module exists to protect is the one in `models.py`:
**a bill's settlement state is derived from its payments.** Nothing here writes
`Bill.status` directly — it either creates or deletes a `Payment` and lets
`Bill.recalculate()` (called from `Payment.save()`) restate the cache.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta

from django.db import transaction
from django.db.models import Count, F, IntegerField, OuterRef, Q, Subquery, Sum, Value
from django.db.models.functions import Coalesce
from django.utils import timezone

from swms.common.exceptions import DomainError
from swms.common.ids import bill_id
from swms.customers.models import HoldingStatus, Household

from .models import (
    Bill,
    BillingRun,
    BillStatus,
    Deposit,
    Payment,
    Remittance,
    refresh_household_dues,
)

# --------------------------------------------------------------------------- #
# Shared helpers
# --------------------------------------------------------------------------- #


def period_bounds(period: str) -> tuple[datetime, datetime]:
    """The half-open local-time window `[start, end)` covering a 'YYYY-MM'.

    Payments are timestamps, not months, and `Payment.period` reads them in
    local time (Asia/Dhaka). Filtering on the same local boundaries keeps a
    payment taken at 00:30 on the 1st in the month the collector says it was.
    """
    year, month = parse_period(period)
    start = timezone.make_aware(datetime(year, month, 1))
    end_year, end_month = (year + 1, 1) if month == 12 else (year, month + 1)
    return start, timezone.make_aware(datetime(end_year, end_month, 1))


def parse_period(period: str) -> tuple[int, int]:
    """Validate and split a 'YYYY-MM' billing period."""
    try:
        year, month = int(period[:4]), int(period[5:7])
        if period[4] != "-" or len(period) != 7 or not 1 <= month <= 12:
            raise ValueError
    except (TypeError, ValueError, IndexError):
        raise DomainError(
            f"'{period}' is not a billing period. Expected YYYY-MM.", code="bad_period"
        ) from None
    return year, month


def paid_total_expr():
    """`Coalesce(Subquery(sum of payments), 0)` for annotating a Bill queryset.

    A correlated subquery rather than `Sum('payments__amount')` on purpose: the
    join form fans a bill's own `amount` out once per payment (so `billed` comes
    back doubled for a bill settled in two instalments), and an aggregate cannot
    be used inside the `filter=` of another aggregate — which is exactly what the
    paid/partial/unpaid/overdue counts in `/bills/summary/` need.
    """
    payments = (
        Payment.objects.filter(bill=OuterRef("pk"))
        .values("bill")
        .annotate(total=Sum("amount"))
        .values("total")[:1]
    )
    return Coalesce(Subquery(payments, output_field=IntegerField()), Value(0))


def with_paid_total(queryset):
    """Ensure `paid_total` is annotated before something leans on it.

    `BillViewSet.get_queryset()` always annotates it, but the filters, the admin
    and the summary are each usable on a plain `Bill.objects` queryset too, and a
    filter that silently matched nothing would be worse than one that pays for
    its own annotation.
    """
    if "paid_total" not in queryset.query.annotations:
        queryset = queryset.annotate(paid_total=paid_total_expr())
    return queryset


def settlement_state(amount: int, received: int, due_on: date | None, today=None) -> str:
    """The same rule as `Bill.settlement()`, over values already in hand.

    The model method re-queries the payments table per bill; list endpoints have
    the total annotated already, so they pass it in here instead of paying for
    one query per row. Both must always agree — the rule lives in one place and
    is called from two.
    """
    if received >= amount:
        return BillStatus.PAID
    if received > 0:
        return BillStatus.PARTIAL
    today = today or timezone.localdate()
    if due_on and due_on < today:
        return BillStatus.OVERDUE
    return BillStatus.UNPAID


# --------------------------------------------------------------------------- #
# The monthly billing run
# --------------------------------------------------------------------------- #


def generate_bills(
    period: str,
    *,
    issued_on: date | None = None,
    due_days: int = 10,
    user=None,
    dry_run: bool = False,
) -> dict:
    """Issue one month's charges. Safe to run twice.

    Who gets billed: every **active** household that has a route stop. An
    unrouted holding is not on anybody's round, so nobody serves it and it is
    not charged — the mock generated bills the same way (`households.filter(h =>
    owner[h.id] && h.status === 'active')`), and billing a holding we never visit
    is precisely the "billed but not served" exception the reconciliation report
    is built to surface.

    Idempotence comes from the `(household, period)` unique constraint plus the
    exclusion below, so re-running a month tops up households signed up since the
    first run and touches nothing else. The `BillingRun` row is upserted and its
    totals describe *the month*, not this invocation, so they stay true whichever
    way the run was reached.

    `dry_run=True` returns the same summary having written nothing — the Billing
    page shows it as a confirmation step before an agency admin commits.
    """
    year, month = parse_period(period)
    issued_on = issued_on or date(year, month, 1)
    if due_days < 0:
        raise DomainError("Due days cannot be negative.", code="bad_due_days")
    due_on = issued_on + timedelta(days=due_days)

    already_billed = Bill.objects.filter(period=period).values("household_id")
    candidates = (
        Household.objects.filter(
            status=HoldingStatus.ACTIVE, holding__route_stop__isnull=False
        )
        .exclude(pk__in=already_billed)
        .select_related("tier")
        .order_by("pk")
    )

    rows = [
        Bill(
            id=bill_id(period, household.pk),
            household_id=household.pk,
            ward_id=household.ward_id,
            period=period,
            issued_at=issued_on,
            due_on=due_on,
            # A negotiated charge beats the tier's standard rate; `effective_charge`
            # is the single place that decision is made.
            amount=household.effective_charge,
        )
        for household in candidates
    ]

    skipped = Bill.objects.filter(period=period).count()
    summary = {
        "period": period,
        "issuedOn": issued_on.isoformat(),
        "dueOn": due_on.isoformat(),
        "created": len(rows),
        "skipped": skipped,
        "amount": sum(row.amount for row in rows),
        "dryRun": dry_run,
    }
    if dry_run:
        # Deliberately outside the transaction: nothing was written, so there is
        # nothing to roll back, and the caller gets the shape of the real answer.
        summary["billCount"] = skipped + len(rows)
        summary["totalAmount"] = (
            Bill.objects.filter(period=period).aggregate(t=Coalesce(Sum("amount"), 0))["t"]
            + summary["amount"]
        )
        return summary

    with transaction.atomic():
        run, _ = BillingRun.objects.update_or_create(
            period=period,
            defaults={"issued_on": issued_on, "generated_by": user},
        )
        for row in rows:
            row.run = run
        if rows:
            Bill.objects.bulk_create(rows, batch_size=500)

        # Totals for the month as it now stands, not just for this pass.
        totals = Bill.objects.filter(period=period).aggregate(
            count=Count("pk"), amount=Coalesce(Sum("amount"), 0)
        )
        run.bill_count = totals["count"] or 0
        run.total_amount = totals["amount"] or 0
        run.save(update_fields=["bill_count", "total_amount", "updated_at"])

        # Charging a household moves its balance, so the cached dues follow.
        for household_id in {row.household_id for row in rows}:
            refresh_household_dues(household_id)

    summary["billCount"] = run.bill_count
    summary["totalAmount"] = run.total_amount
    summary["run"] = run.pk
    return summary


# --------------------------------------------------------------------------- #
# Money in
# --------------------------------------------------------------------------- #


def record_payment(
    bill: Bill,
    *,
    amount: int,
    method,
    collector=None,
    at=None,
    reference: str = "",
    note: str = "",
    user=None,
) -> Payment:
    """Take money against a bill. The only thing that can settle one.

    `Payment.save()` already calls `Bill.recalculate()`, which restates the
    bill's status and method and refreshes the household's dues — so this
    function deliberately does none of that itself. Duplicating it would mean two
    places could disagree about what a payment implies.
    """
    if amount is None or amount <= 0:
        raise DomainError("A payment must be for a positive amount.", code="bad_amount")

    outstanding = bill.outstanding
    if outstanding <= 0:
        raise DomainError(
            f"{bill.id} is already settled in full ({bill.received} of {bill.amount} BDT).",
            code="already_paid",
        )
    if amount > outstanding:
        raise DomainError(
            f"{amount} BDT exceeds the {outstanding} BDT outstanding on {bill.id}.",
            code="overpayment",
        )

    with transaction.atomic():
        payment = Payment(
            bill=bill,
            household_id=bill.household_id,
            collector=collector,
            amount=amount,
            method=method,
            at=at or timezone.now(),
            reference=reference or "",
            note=note or "",
            recorded_by=user,
        )
        payment.save()
    return payment


def void_payment(payment: Payment, *, user) -> Bill:
    """Undo a payment that should never have been recorded. Agency admin only.

    Deletion rather than a reversing entry, on purpose. A reversing entry is the
    right answer when the original document has left the building — it has been
    printed, filed, or reported to somebody who will look for it again. Here the
    realistic error is a collector keying 500 instead of 50 on a phone, noticed
    within the hour by the ward office, before any statement or hand-in has been
    produced from it. Leaving a +500/-500 pair behind would put two rows in the
    household's payment history for money that never changed hands, and every
    report in `reports.js` sums `payments` without inspecting sign, so each of
    them would need to learn about reversals to keep telling the truth.

    Two things make the deletion safe rather than sloppy: the money figure is not
    lost (a `Deposit` reconciliation still shows the collector's cash against
    what the system holds, so a variance surfaces), and the bill's status is not
    edited but *recomputed* from the payments that remain — the same path a real
    payment takes. If this deployment ever grows audited statements, the change
    is to write a negative-amount `Payment` here instead and teach `received` to
    respect sign; the rest of the module would not move.
    """
    bill = payment.bill
    household_id = payment.household_id
    with transaction.atomic():
        payment.delete()
        # Recompute from what is left, exactly as recording a payment does.
        bill.recalculate()
        refresh_household_dues(household_id)
    bill.refresh_from_db()
    return bill


# --------------------------------------------------------------------------- #
# Rollups
# --------------------------------------------------------------------------- #


def billing_summary(queryset, period: str | None = None) -> dict:
    """The Billing page's stat cards for one period, in a single query.

    Every figure is an aggregate. The mock approximated collected revenue as
    "the amount of every paid bill, plus half of each partial one", which is the
    other half of why its totals never matched the reports — `received` here is
    the actual sum of payments.
    """
    if period:
        parse_period(period)
        queryset = queryset.filter(period=period)
    queryset = with_paid_total(queryset)

    today = timezone.localdate()
    # Spelled out positively rather than as a negation: `due_on` is nullable, and
    # `NOT (due_on < today)` evaluates to NULL — not true — for a bill with no due
    # date, which would quietly drop it from every bucket.
    nothing_paid = Q(paid_total__lte=0)
    not_yet_due = Q(due_on__isnull=True) | Q(due_on__gte=today)

    totals = queryset.aggregate(
        bills=Count("pk"),
        billed=Coalesce(Sum("amount"), 0),
        # `paid_total` is a correlated subquery, not an aggregate, so summing it
        # here does not fan the bill amounts out the way a join to payments would,
        # and it may legally appear inside another aggregate's `filter=`.
        received=Coalesce(Sum("paid_total"), 0),
        paid=Count("pk", filter=Q(paid_total__gte=F("amount"))),
        partial=Count("pk", filter=Q(paid_total__gt=0, paid_total__lt=F("amount"))),
        overdue=Count("pk", filter=nothing_paid & Q(due_on__lt=today)),
        unpaid=Count("pk", filter=nothing_paid & not_yet_due),
    )
    billed, received = totals["billed"] or 0, totals["received"] or 0
    return {
        "period": period,
        "bills": totals["bills"],
        "billed": billed,
        "received": received,
        "outstanding": max(billed - received, 0),
        "rate": round(received * 100 / billed) if billed else 0,
        "counts": {
            "paid": totals["paid"],
            "partial": totals["partial"],
            "unpaid": totals["unpaid"],
            "overdue": totals["overdue"],
        },
    }


# --------------------------------------------------------------------------- #
# Cash hand-ins and reconciliation
# --------------------------------------------------------------------------- #


def record_deposit(
    collector,
    period: str,
    method,
    amount: int,
    *,
    at=None,
    ref: str = "",
    user=None,
) -> Deposit:
    """Record what a collector handed in for one month, in one payment method.

    `(collector, period, method)` is unique in the database, so this is an upsert:
    a collector who hands in twice in a month has one corrected total, not two
    rows that a reconciliation report would have to know to add up. The amount is
    what they actually handed over — it is *not* derived from their payments,
    because the whole point of `cash_position()` is to compare the two.

    The payments covered are then linked to the deposit, which is what makes
    "money still in a collector's pocket" (`deposit__isnull=True`) answerable.
    """
    parse_period(period)
    if amount is None or amount < 0:
        raise DomainError("A deposit cannot be negative.", code="bad_amount")

    start, end = period_bounds(period)
    with transaction.atomic():
        deposit, _ = Deposit.objects.update_or_create(
            collector=collector,
            period=period,
            method=method,
            defaults={"amount": amount, "at": at or timezone.now(), "ref": ref or "",
                      "received_by": user},
        )
        Payment.objects.filter(
            collector=collector,
            method=method,
            deposit__isnull=True,
            at__gte=start,
            at__lt=end,
        ).update(deposit=deposit)
    return deposit


def cash_position(period: str) -> dict:
    """What each collector took in against what they handed over, for one month.

    A variance here is a cash-handling problem, which is a different thing from an
    unpaid bill — one is a staff matter, the other is a customer matter. Mirrors
    the `cash` / `cashTotals` blocks of `reconciliationReport()` in reports.js so
    the report reads the same whether it is computed here or in the browser.
    """
    parse_period(period)
    start, end = period_bounds(period)

    rows: dict[str, dict] = {}

    def row_for(collector_id):
        key = collector_id or ""
        if key not in rows:
            rows[key] = {
                "collector": collector_id,
                "collected": 0,
                "deposited": 0,
                "variance": 0,
                "byMethod": {},
            }
        return rows[key]

    def method_cell(row, method_id):
        cell = row["byMethod"].setdefault(
            method_id, {"collected": 0, "deposited": 0, "variance": 0}
        )
        return cell

    collected = (
        Payment.objects.filter(at__gte=start, at__lt=end)
        .values("collector_id", "method_id")
        .annotate(total=Coalesce(Sum("amount"), 0))
    )
    for entry in collected:
        row = row_for(entry["collector_id"])
        row["collected"] += entry["total"]
        method_cell(row, entry["method_id"])["collected"] += entry["total"]

    deposited = (
        Deposit.objects.filter(period=period)
        .values("collector_id", "method_id")
        .annotate(total=Coalesce(Sum("amount"), 0))
    )
    for entry in deposited:
        row = row_for(entry["collector_id"])
        row["deposited"] += entry["total"]
        method_cell(row, entry["method_id"])["deposited"] += entry["total"]

    for row in rows.values():
        row["variance"] = row["collected"] - row["deposited"]
        for cell in row["byMethod"].values():
            cell["variance"] = cell["collected"] - cell["deposited"]

    ordered = sorted(rows.values(), key=lambda r: (r["collector"] is None, r["collector"] or ""))
    return {
        "period": period,
        "rows": ordered,
        "totals": {
            "collected": sum(r["collected"] for r in ordered),
            "deposited": sum(r["deposited"] for r in ordered),
            "variance": sum(r["variance"] for r in ordered),
        },
    }


# --------------------------------------------------------------------------- #
# Remittance — the agency's hand-over to the corporation
# --------------------------------------------------------------------------- #


@transaction.atomic
def record_remittance(
    agency,
    period: str,
    method,
    amount: int,
    *,
    at=None,
    ref: str = "",
    note: str = "",
    user=None,
) -> Remittance:
    """Record money an agency has handed to KCC for one month.

    Deliberately an insert, not the upsert `record_deposit` performs. A hand-in
    by a collector is a single running total for the month; a remittance is a
    bank transfer with its own reference, and several in a month are normal.
    Collapsing them would lose the link to the bank statement.

    The amount is what was actually transferred. It is not derived from what was
    collected, because comparing the two is the entire purpose of
    `agency_cash_position()`.
    """
    parse_period(period)
    if amount is None or amount <= 0:
        raise DomainError("A remittance must be a positive amount.", code="bad_amount")

    return Remittance.objects.create(
        agency=agency,
        period=period,
        method=method,
        amount=amount,
        at=at or timezone.now(),
        ref=ref or "",
        note=note or "",
        received_by=user if getattr(user, "is_authenticated", False) else None,
    )


def agency_cash_position(period: str, *, agency=None) -> dict:
    """Where one month's money is, per agency: collected → deposited → remitted.

    Three figures and two gaps, because the cash makes two hops and each can
    stall independently:

    * ``collected``  households paid the agency's collectors
    * ``deposited``  collectors handed it to their agency
    * ``remitted``   the agency handed it to KCC

    ``inField``    = collected − deposited, still in collectors' pockets.
    ``withAgency`` = deposited − remitted, banked by the agency but not yet KCC's.

    Every figure reads the stamped ``agency`` column rather than joining through
    the collector's current employer, so a transfer cannot move a settled month's
    money onto another contractor's books.

    Agencies remit in full, so both gaps should close to zero once a month is
    settled. A standing shortfall is a real finding, not a modelling artefact.
    """
    parse_period(period)
    start, end = period_bounds(period)

    collected = (
        Payment.objects.filter(at__gte=start, at__lt=end, agency__isnull=False)
        .values("agency_id")
        .annotate(total=Coalesce(Sum("amount"), 0))
    )
    deposited = (
        Deposit.objects.filter(period=period, agency__isnull=False)
        .values("agency_id")
        .annotate(total=Coalesce(Sum("amount"), 0))
    )
    remitted = (
        Remittance.objects.filter(period=period)
        .values("agency_id")
        .annotate(total=Coalesce(Sum("amount"), 0))
    )

    if agency is not None:
        agency_id = getattr(agency, "id", agency)
        collected = collected.filter(agency_id=agency_id)
        deposited = deposited.filter(agency_id=agency_id)
        remitted = remitted.filter(agency_id=agency_id)

    rows: dict[str, dict] = {}

    def row_for(key: str) -> dict:
        return rows.setdefault(
            key, {"agency": key, "collected": 0, "deposited": 0, "remitted": 0}
        )

    for source, field in ((collected, "collected"), (deposited, "deposited"), (remitted, "remitted")):
        for entry in source:
            row_for(entry["agency_id"])[field] += entry["total"]

    ordered = sorted(rows.values(), key=lambda r: r["agency"])
    for row in ordered:
        row["inField"] = row["collected"] - row["deposited"]
        row["withAgency"] = row["deposited"] - row["remitted"]
        row["outstanding"] = row["collected"] - row["remitted"]

    # Money taken at the office counter has no collector and therefore no
    # agency. It is KCC's already and owes no remittance, but leaving it out
    # entirely would make the total disagree with the bill reports.
    counter = (
        Payment.objects.filter(at__gte=start, at__lt=end, agency__isnull=True)
        .aggregate(total=Coalesce(Sum("amount"), 0))["total"]
    )

    return {
        "period": period,
        "rows": ordered,
        "counterCollected": counter,
        "totals": {
            "collected": sum(r["collected"] for r in ordered),
            "deposited": sum(r["deposited"] for r in ordered),
            "remitted": sum(r["remitted"] for r in ordered),
            "inField": sum(r["inField"] for r in ordered),
            "withAgency": sum(r["withAgency"] for r in ordered),
            "outstanding": sum(r["outstanding"] for r in ordered),
        },
    }
