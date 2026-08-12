"""Agency operations that are more than a field write."""

from __future__ import annotations

import datetime as dt

from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from swms.common.exceptions import DomainError

from .models import Agency, CollectorEmployment


@transaction.atomic
def transfer_collector(collector, agency: Agency, *, on_date=None, note: str = ""):
    """Move a collector to `agency`, closing their previous employment.

    The current-employer FK and the history row are written together here so
    they cannot disagree. Setting `Collector.agency` directly would leave the
    history with a gap, and a gap is indistinguishable from "never employed" —
    which is how past revenue quietly loses its owner.

    Idempotent: transferring to the agency a collector already works for is a
    no-op, so a retried request cannot split the history into two adjacent rows
    for the same agency.
    """
    on_date = on_date or timezone.localdate()

    current = collector.employments.filter(to_date__isnull=True).first()
    if current and current.agency_id == agency.id:
        return current

    if current:
        if on_date < current.from_date:
            raise DomainError(
                "A transfer cannot pre-date the collector's current employment.",
                code="transfer_before_start",
            )
        if on_date == current.from_date:
            # Transferred on the very day the last one began: that employment
            # never covered a working day, so it is a correction rather than a
            # period of service. Closing it would need to_date < from_date,
            # which the date-order constraint rightly refuses.
            current.delete()
        else:
            # Ends the day before the new one starts, so no date is ever covered
            # by two employments and `agency_on()` has one answer.
            current.to_date = on_date - dt.timedelta(days=1)
            current.save(update_fields=["to_date", "updated_at"])

    employment = CollectorEmployment.objects.create(
        collector=collector, agency=agency, from_date=on_date, note=note
    )
    collector.agency = agency
    collector.save(update_fields=["agency", "updated_at"])
    return employment


def stamp_agency_for(collector, on_date) -> Agency | None:
    """The agency to record against work a collector did on `on_date`.

    Prefers the dated employment record, so a visit synced three days late is
    attributed to whoever employed them *then*. Falls back to the current
    employer when history does not reach back that far — some money in this
    database predates the earliest employment record, and returning None there
    would drop attribution entirely rather than being slightly imprecise.

    Returns None only when there is no collector at all: an office-counter
    payment is KCC's own, not any agency's.
    """
    if collector is None:
        return None
    return agency_on(collector, on_date) or collector.agency


def agency_on(collector, on_date) -> Agency | None:
    """Which agency employed this collector on `on_date`.

    Reports attributing historical work must ask this rather than reading
    `Collector.agency`, which only ever answers "today". Reading the FK instead
    is how a transfer retroactively rewrites last quarter's revenue.
    """
    row = (
        collector.employments.filter(from_date__lte=on_date)
        .filter(Q(to_date__isnull=True) | Q(to_date__gte=on_date))
        .select_related("agency")
        .order_by("-from_date")
        .first()
    )
    return row.agency if row else None
