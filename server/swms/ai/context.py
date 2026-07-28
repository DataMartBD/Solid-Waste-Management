"""Facts handed to Sweep AI.

The assistant never queries the database itself. Instead a compact, ward-scoped
snapshot is computed here and passed to the model, which may only answer from it.
That keeps the assistant honest (it cannot invent a figure), keeps the prompt
small and cacheable, and means a prompt-injection attempt in the user's question
has no data access to abuse.
"""

from __future__ import annotations

from django.db.models import Count, F, Q, Sum
from django.db.models.functions import Coalesce
from django.utils import timezone

from swms.billing.models import Bill, Payment
from swms.complaints.models import ACTIVE_STATUSES, Complaint
from swms.customers.models import HoldingStatus, Household, PotentialCustomer
from swms.fieldops.models import Collector, RouteStop, Visit, VisitStatus
from swms.fleet.models import Van, VanStatus
from swms.reports import aggregates, periods


def _scoped(queryset, ward_ids, path="ward_id"):
    return queryset if ward_ids is None else queryset.filter(**{f"{path}__in": ward_ids})


def build_facts(user) -> dict:
    """A snapshot of the things the assistant is asked about.

    Scoped to what this user is allowed to see, so a ward supervisor's assistant
    cannot report another ward's figures.
    """
    ward_ids = user.visible_ward_ids()
    period = periods.current_month()
    today = timezone.localdate()

    households = _scoped(Household.objects.all(), ward_ids)
    dues = households.filter(dues__gt=0).aggregate(
        count=Count("id"), total=Coalesce(Sum("dues"), 0)
    )

    bills = _scoped(Bill.objects.filter(period=period), ward_ids)
    billed = bills.aggregate(total=Coalesce(Sum("amount"), 0))["total"]
    received = (
        _scoped(Payment.objects.all(), ward_ids, "household__ward_id")
        .filter(**periods.month_range_filter("at", period))
        .aggregate(total=Coalesce(Sum("amount"), 0))["total"]
    )

    complaints = _scoped(Complaint.objects.all(), ward_ids)
    active_complaints = complaints.filter(status__in=ACTIVE_STATUSES)

    today_visits = _scoped(
        Visit.objects.filter(served_on=today), ward_ids, "household__ward_id"
    ).aggregate(
        collected=Count("id", filter=Q(status=VisitStatus.COLLECTED)),
        skipped=Count("id", filter=Q(status=VisitStatus.SKIPPED)),
    )
    planned_today = _scoped(
        RouteStop.objects.filter(route__active=True), ward_ids, "household__ward_id"
    ).count()

    vans = Van.objects.exclude(status=VanStatus.RETIRED)
    service_due = vans.filter(
        next_service_km__isnull=False, next_service_km__lte=F("odometer") + 1000
    ).count()
    documents_due = sum(1 for van in vans if van.expiring_documents(within_days=30))

    surveys = _scoped(PotentialCustomer.objects.filter(converted_at__isnull=True), ward_ids)

    return {
        "asOf": timezone.localtime().isoformat(timespec="minutes"),
        "period": period,
        "scope": "city-wide" if ward_ids is None else f"wards {', '.join(sorted(ward_ids))}",
        "households": {
            "total": households.count(),
            "active": households.filter(status=HoldingStatus.ACTIVE).count(),
            "verified": households.filter(verified=True).count(),
            "unrouted": households.filter(route_stop__isnull=True).count(),
            "withDues": dues["count"],
            "duesTotalBdt": dues["total"],
        },
        "billing": {
            "billedBdt": billed,
            "receivedBdt": received,
            "collectionRatePct": round((received / billed) * 100) if billed else 0,
            "outstandingBdt": max(billed - received, 0),
            "unpaidBills": bills.filter(status__in=["unpaid", "overdue"]).count(),
        },
        "today": {
            "date": today.isoformat(),
            "plannedStops": planned_today,
            "collected": today_visits["collected"],
            "skipped": today_visits["skipped"],
            "pending": max(planned_today - today_visits["collected"] - today_visits["skipped"], 0),
        },
        "complaints": {
            "open": active_complaints.count(),
            "breached": sum(
                1
                for opened, sla in active_complaints.values_list("opened", "sla")
                if (timezone.now() - opened).total_seconds() / 3600 > (sla or 0)
            ),
            "byPriority": {
                row["priority"]: row["total"]
                for row in active_complaints.values("priority").annotate(total=Count("id"))
            },
        },
        "fleet": {
            "total": vans.count(),
            "active": vans.filter(status=VanStatus.ACTIVE).count(),
            "inMaintenance": vans.filter(status=VanStatus.IN_MAINTENANCE).count(),
            "serviceDue": service_due,
            "documentsExpiringIn30Days": documents_due,
        },
        "staff": {
            "collectors": Collector.objects.filter(active=True).count(),
            "checkedInToday": Collector.objects.filter(attendance="checked_in").count(),
        },
        "surveys": {
            "pendingConversion": surveys.count(),
            "monthlyValueAtStakeBdt": surveys.aggregate(
                total=Coalesce(Sum("est_tier__charge"), 0)
            )["total"],
        },
        "kpis": aggregates.kpis(period=period, ward_ids=ward_ids),
    }
