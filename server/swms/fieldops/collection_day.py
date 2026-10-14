"""The city's collection day: assumed collected unless a holding complains.

Agencies collect every day and may confirm a holding by QR scan, app or web.
Nobody has to. At the city's `collection_cutoff` every holding on an active
route that has no visit yet is written a visit with `source=auto`:

* **collected**, if no missed-collection complaint names that day, or
* **skipped, reason "complaint"**, if one does.

Everything is holding-wise: one building, one visit, whichever family in it
made the complaint.

A complaint can still arrive after the cut-off: until the city's
`complaint_deadline` the next morning it may name yesterday, and
`record_missed` then turns that holding's auto visit into a missed one.
Visits an agency confirmed itself are never overwritten — a QR scan is proof,
and the complaint stays on the ticket queue for a supervisor to settle.

Each close, and each late flip, rebuilds `DailyCollectionSummary` for the
city and day so the city dashboard reads a few rows rather than every visit.

The close normally runs from `close_collection_day`, but an admin may also run
it by hand from the City Collection page ("Mark all collected"), even before
the cut-off. A complaint that arrives after such an early close still turns the
holding's auto visit into a missed one.
"""

from __future__ import annotations

import datetime as dt
from collections import Counter

from django.db import transaction
from django.utils import timezone

from swms.catalog.models import City
from swms.common.exceptions import DomainError
from swms.complaints.models import Complaint, ComplaintType
from swms.customers.models import Holding, HoldingStatus

from .models import DailyCollectionSummary, SkipReason, Visit, VisitSource, VisitStatus


def city_of(holding: Holding) -> City | None:
    """The holding's city, read by ward id so a stale in-memory zone cannot hide it."""
    return City.objects.filter(zones__wards__id=holding.ward_id).first()


def cutoff_at(city: City, day: dt.date) -> dt.datetime:
    """The aware moment `day` closes in `city`."""
    return timezone.make_aware(dt.datetime.combine(day, city.collection_cutoff))


def complaint_deadline_at(city: City | None, day: dt.date) -> dt.datetime:
    """The last moment a complaint may still name `day`: the next morning."""
    deadline = city.complaint_deadline if city else dt.time(12, 0)
    return timezone.make_aware(dt.datetime.combine(day + dt.timedelta(days=1), deadline))


def is_closed(city: City, day: dt.date, now: dt.datetime | None = None) -> bool:
    return (now or timezone.now()) >= cutoff_at(city, day)


def check_missed_on(holding: Holding, day: dt.date, now: dt.datetime | None = None) -> None:
    """A missed-collection complaint may name today, or yesterday before the deadline."""
    now = now or timezone.now()
    today = timezone.localtime(now).date()
    if day == today:
        return
    if day == today - dt.timedelta(days=1):
        deadline = complaint_deadline_at(city_of(holding), day)
        if now < deadline:
            return
        raise DomainError(
            f"Yesterday's collection can only be reported until "
            f"{timezone.localtime(deadline):%H:%M} today.",
            code="missed_on_too_late",
        )
    raise DomainError(
        "A missed collection can only be reported for today or yesterday.",
        code="missed_on_out_of_range",
    )


def due_holdings(city: City, day: dt.date):
    """Active holdings in `city` that are a stop on an active route.

    A holding registered after `day` was not due that day, which matters when
    a missed day is closed late.
    """
    end_of_day = timezone.make_aware(dt.datetime.combine(day + dt.timedelta(days=1), dt.time()))
    return Holding.objects.filter(
        status=HoldingStatus.ACTIVE,
        ward__zone__city=city,
        route_stop__route__active=True,
        created_at__lt=end_of_day,
    )


def _missed_holding_ids(city: City, day: dt.date) -> set[str]:
    return set(
        Complaint.objects.filter(
            type=ComplaintType.MISSED_COLLECTION,
            missed_on=day,
            ward__zone__city=city,
        ).values_list("holding_id", flat=True)
    )


@transaction.atomic
def close_day(
    city: City,
    day: dt.date,
    *,
    now: dt.datetime | None = None,
    force: bool = False,
    dry_run: bool = False,
    agency_id: str | None = None,
) -> dict:
    """Write an auto visit for every due holding nobody confirmed.

    Idempotent: a holding that already has a visit for `day` is left alone,
    so running this every few minutes after the cut-off changes nothing more.
    `force` closes before the cut-off (the manual button); `agency_id` limits
    the close to one agency's holdings (an agency admin's button).
    """
    now = now or timezone.now()
    if not force and not is_closed(city, day, now):
        raise DomainError(
            f"{city.name} closes {day} at {city.collection_cutoff:%H:%M}.",
            code="collection_day_open",
        )

    due = due_holdings(city, day)
    if agency_id is not None:
        due = due.filter(agency_id=agency_id)
    due_count = due.count()
    holdings = list(due.exclude(visits__served_on=day).select_related("route_stop"))
    missed = _missed_holding_ids(city, day)
    at = cutoff_at(city, day)

    visits = []
    for holding in holdings:
        complained = holding.id in missed
        visits.append(
            Visit(
                holding=holding,
                agency_id=holding.agency_id,
                route_id=holding.route_stop.route_id,
                qr=holding.qr or "",
                status=VisitStatus.SKIPPED if complained else VisitStatus.COLLECTED,
                reason=SkipReason.COMPLAINT if complained else "",
                source=VisitSource.AUTO,
                at=at,
            )
        )

    result = {
        "city": city.id,
        "day": day.isoformat(),
        "due": due_count,
        "already_visited": due_count - len(visits),
        "auto_collected": sum(v.status == VisitStatus.COLLECTED for v in visits),
        "auto_missed": sum(v.status == VisitStatus.SKIPPED for v in visits),
    }
    if dry_run:
        transaction.set_rollback(True)
        return result

    # One at a time: Visit.save() allocates the id and derives `served_on`.
    for visit in visits:
        visit.save()
    summarise(city, day, now=now)
    return result


def record_missed(holding: Holding, day: dt.date, *, now: dt.datetime | None = None) -> bool:
    """Apply a missed-collection complaint to a day that has already closed.

    An auto visit — written at the cut-off, or earlier by the manual close —
    becomes a missed one. With no visit yet, before the cut-off there is
    nothing to do (`close_day` will see the complaint); after it, a missed
    visit is written. Returns whether a visit changed.
    """
    city = city_of(holding)
    if city is None:
        return False

    visit = Visit.objects.filter(holding=holding, served_on=day).first()
    if visit is None:
        if not is_closed(city, day, now):
            return False
        Visit(
            holding=holding,
            agency_id=holding.agency_id,
            route_id=getattr(getattr(holding, "route_stop", None), "route_id", None),
            qr=holding.qr or "",
            status=VisitStatus.SKIPPED,
            reason=SkipReason.COMPLAINT,
            source=VisitSource.AUTO,
            at=cutoff_at(city, day),
        ).save()
    elif visit.source == VisitSource.AUTO and visit.status == VisitStatus.COLLECTED:
        visit.status = VisitStatus.SKIPPED
        visit.reason = SkipReason.COMPLAINT
        visit.save(update_fields=["status", "reason", "updated_at"])
    else:
        return False

    summarise(city, day, now=now)
    return True


def summarise(city: City, day: dt.date, *, now: dt.datetime | None = None) -> int:
    """Rebuild the city's summary rows for `day`, one per (ward, agency)."""
    due = Counter(due_holdings(city, day).values_list("ward_id", "agency_id"))
    tallies: dict[tuple, Counter] = {}
    visits = Visit.objects.filter(served_on=day, holding__ward__zone__city=city).values_list(
        "holding__ward_id", "agency_id", "status", "source", "reason"
    )
    for ward_id, agency_id, status, source, reason in visits:
        tally = tallies.setdefault((ward_id, agency_id), Counter())
        if status == VisitStatus.COLLECTED:
            tally["auto" if source == VisitSource.AUTO else "confirmed"] += 1
        elif reason == SkipReason.COMPLAINT:
            tally["missed"] += 1
        else:
            tally["skipped"] += 1

    complaints = Counter(
        Complaint.objects.filter(
            type=ComplaintType.MISSED_COLLECTION, missed_on=day, ward__zone__city=city
        ).values_list("ward_id", "holding__agency_id")
    )

    closed_at = now or timezone.now()
    keys = set(due) | set(tallies) | set(complaints)
    empty = Counter()
    rows = [
        DailyCollectionSummary(
            day=day,
            city=city,
            ward_id=ward_id,
            agency_id=agency_id,
            due=due.get((ward_id, agency_id), 0),
            confirmed=tallies.get((ward_id, agency_id), empty)["confirmed"],
            auto=tallies.get((ward_id, agency_id), empty)["auto"],
            missed=tallies.get((ward_id, agency_id), empty)["missed"],
            skipped=tallies.get((ward_id, agency_id), empty)["skipped"],
            complaints=complaints.get((ward_id, agency_id), 0),
            closed_at=closed_at,
        )
        for ward_id, agency_id in keys
    ]
    DailyCollectionSummary.objects.filter(city=city, day=day).delete()
    DailyCollectionSummary.objects.bulk_create(rows)
    return len(rows)


__all__ = [
    "check_missed_on",
    "close_day",
    "complaint_deadline_at",
    "cutoff_at",
    "due_holdings",
    "is_closed",
    "record_missed",
    "summarise",
]
