"""What the citizen portal reads: a holding's daily collection and complaints."""

from __future__ import annotations

import datetime as dt

from django.db.models import Q
from django.utils import timezone

from swms.complaints.models import Complaint
from swms.fieldops.collection_day import city_of, is_closed
from swms.fieldops.models import SkipReason, Visit, VisitSource, VisitStatus

from .access import Access

#: How far back the collection calendar reaches.
HISTORY_DAYS = 30


def day_status(visit: Visit | None, *, closed: bool) -> str:
    """confirmed | collected | missed | skipped | pending | none."""
    if visit is None:
        return "none" if closed else "pending"
    if visit.status == VisitStatus.COLLECTED:
        return "collected" if visit.source == VisitSource.AUTO else "confirmed"
    if visit.reason == SkipReason.COMPLAINT:
        return "missed"
    return "skipped"


def holding_card(entry: Access) -> dict:
    holding = entry.holding
    return {
        "id": holding.pk,
        "holdingNo": holding.holding_no,
        "address": holding.address,
        "road": holding.road.name if holding.road_id else "",
        "ward": holding.ward_id,
        "wardName": holding.ward.name if holding.ward_id else "",
        "wardNameBn": getattr(holding.ward, "name_bn", "") if holding.ward_id else "",
        "role": entry.role,
        "household": entry.household.pk if entry.household else None,
        "unit": entry.household.unit if entry.household else "",
    }


def collection(entry: Access, *, today: dt.date | None = None) -> dict:
    """Today's state and the last 30 days, oldest first."""
    today = today or timezone.localdate()
    since = today - dt.timedelta(days=HISTORY_DAYS - 1)
    visits = {
        v.served_on: v
        for v in Visit.objects.filter(holding=entry.holding, served_on__range=(since, today))
    }
    city = city_of(entry.holding)
    days = []
    for offset in range(HISTORY_DAYS):
        day = since + dt.timedelta(days=offset)
        closed = day < today or (city is not None and is_closed(city, day))
        days.append({"day": day.isoformat(), "status": day_status(visits.get(day), closed=closed)})
    return {
        "today": days[-1],
        "cutoff": city.collection_cutoff.strftime("%H:%M") if city else None,
        "complaintDeadline": city.complaint_deadline.strftime("%H:%M") if city else None,
        "days": days,
        "counts": {
            name: sum(1 for d in days if d["status"] == name)
            for name in ("confirmed", "collected", "missed", "skipped")
        },
    }


def complaints_for(entry: Access, phone: str):
    """Owners see every complaint on the holding; a household sees its own."""
    rows = Complaint.objects.filter(holding=entry.holding)
    if not entry.is_owner:
        rows = rows.filter(Q(household=entry.household) | Q(reporter_phone=phone))
    return rows.prefetch_related("activity", "photos").order_by("-opened")
