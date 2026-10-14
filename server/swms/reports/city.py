"""The City Corporation dashboard: one city's collection, by agency and ward.

Closed days come from `DailyCollectionSummary`, written at each cut-off by
`close_collection_day`. Today, until its cut-off, is counted live from visits
and complaints, because there is no summary for it yet.

Every figure keeps the three kinds of "collected" apart — confirmed by the
agency, assumed at the cut-off, missed by complaint — because the point of the
page is to show a city which contractors actually prove their work.
"""

from __future__ import annotations

import datetime as dt
from collections import defaultdict

from django.db.models import Sum
from django.utils import timezone

from swms.agencies.models import Agency
from swms.catalog.models import City, Ward
from swms.complaints.models import Complaint, ComplaintType
from swms.fieldops.collection_day import due_holdings, is_closed
from swms.fieldops.models import DailyCollectionSummary, Visit, VisitSource, VisitStatus

from . import periods

FIGURES = ("due", "confirmed", "auto", "missed", "skipped", "complaints")


def visible_cities(ward_ids: list[str] | None):
    """The cities a caller may pick between: those holding a ward they can see."""
    rows = City.objects.filter(active=True)
    if ward_ids is not None:
        rows = rows.filter(zones__wards__id__in=ward_ids).distinct()
    return rows


def _rates(row: dict) -> dict:
    due = row["due"]
    collected = row["confirmed"] + row["auto"]
    row["collected"] = collected
    row["collectedPct"] = round(collected * 100 / due) if due else 0
    row["confirmedPct"] = round(row["confirmed"] * 100 / due) if due else 0
    row["missedPct"] = round(row["missed"] * 100 / due) if due else 0
    return row


def _blank() -> dict:
    return dict.fromkeys(FIGURES, 0)


def today_live(city: City, *, ward_ids=None, agency_id=None, now=None) -> dict:
    """Today so far: what is due, what agencies have confirmed, what is pending."""
    now = now or timezone.now()
    day = timezone.localtime(now).date()
    due = due_holdings(city, day)
    visits = Visit.objects.filter(served_on=day, holding__ward__zone__city=city)
    complaints = Complaint.objects.filter(
        type=ComplaintType.MISSED_COLLECTION, missed_on=day, ward__zone__city=city
    )
    if ward_ids is not None:
        due = due.filter(ward_id__in=ward_ids)
        visits = visits.filter(holding__ward_id__in=ward_ids)
        complaints = complaints.filter(ward_id__in=ward_ids)
    if agency_id is not None:
        due = due.filter(agency_id=agency_id)
        visits = visits.filter(agency_id=agency_id)
        complaints = complaints.filter(holding__agency_id=agency_id)

    due_count = due.count()
    confirmed = visits.filter(status=VisitStatus.COLLECTED).exclude(source=VisitSource.AUTO).count()
    auto = visits.filter(status=VisitStatus.COLLECTED, source=VisitSource.AUTO).count()
    handled = visits.count()
    return {
        "date": day.isoformat(),
        "closed": is_closed(city, day, now),
        "cutoff": city.collection_cutoff.strftime("%H:%M"),
        "due": due_count,
        "confirmed": confirmed,
        # Non-zero before the cut-off only when an admin pressed "Mark all collected".
        "auto": auto,
        "skipped": visits.filter(status=VisitStatus.SKIPPED).count(),
        "pending": max(due_count - handled, 0),
        "complaints": complaints.count(),
    }


def city_collection(
    city: City,
    *,
    mode: str = periods.DAILY,
    date_from: dt.date,
    date_to: dt.date,
    ward_ids: list[str] | None = None,
    agency_id: str | None = None,
) -> dict:
    """Totals, a series by period, and breakdowns by agency and by ward."""
    rows = DailyCollectionSummary.objects.filter(city=city, day__range=(date_from, date_to))
    if ward_ids is not None:
        rows = rows.filter(ward_id__in=ward_ids)
    if agency_id is not None:
        rows = rows.filter(agency_id=agency_id)

    sums = {name: Sum(name) for name in FIGURES}
    totals = _rates({k: v or 0 for k, v in rows.aggregate(**sums).items()})

    series: dict[str, dict] = defaultdict(_blank)
    for row in rows.values("day", *FIGURES):
        bucket = series[periods.label(row["day"], mode)]
        for name in FIGURES:
            bucket[name] += row[name]

    agency_names = {pk: (name, name_bn) for pk, name, name_bn
                    in Agency.objects.values_list("id", "name", "name_bn")}
    by_agency = [
        _rates({"agency": row["agency_id"],
                "agencyName": agency_names.get(row["agency_id"], ("Unassigned", ""))[0],
                "agencyNameBn": agency_names.get(row["agency_id"], ("", ""))[1],
                **{k: row[k] or 0 for k in FIGURES}})
        for row in rows.values("agency_id").annotate(**sums).order_by("agency_id")
    ]

    ward_names = dict(Ward.objects.values_list("id", "name"))
    by_ward = [
        _rates({"ward": row["ward_id"], "wardName": ward_names.get(row["ward_id"], row["ward_id"]),
                **{k: row[k] or 0 for k in FIGURES}})
        for row in rows.values("ward_id").annotate(**sums).order_by("ward_id")
    ]

    return {
        "totals": totals,
        "series": [_rates({"period": key, **value}) for key, value in sorted(series.items())],
        "byAgency": sorted(by_agency, key=lambda r: (-r["due"], r["agencyName"])),
        "byWard": by_ward,
        "daysClosed": rows.values("day").distinct().count(),
    }
