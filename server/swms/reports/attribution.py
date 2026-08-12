"""Who a record belongs to.

A bill carries no collector, and a visit carries the person who actually walked
the road — which is not always the person the plan expected. Both answers are
legitimate and they are *supposed* to differ:

    planned — the collector assigned the route the holding sits on. Stable, and
              what a supervisor plans and bills against.
    actual  — the collector whose record touched the holding. Reflects who really
              turned up, including cover for an absent colleague.

Reporting both is what makes cover-work and missed rounds visible. Collapsing
them into one number hides exactly what a ward office needs to see.

The planned owner is resolved as a correlated subquery limited to one row, so
joining through the assignment tables can never multiply the rows being counted.
"""

from __future__ import annotations

from django.db.models import OuterRef, Subquery

from swms.fieldops.models import RouteStop


def planned_owner_subquery(household_field: str = "household_id") -> Subquery:
    """A Subquery yielding the collector planned to serve the outer row's household.

    `household_field` is the outer query's column holding the household id —
    `"household_id"` on Visit, Bill and Payment; `"id"` when the outer query *is*
    Household.

    The plan is holding-wise, so the stop is found through the family's
    *building*: whoever walks the block is the planned owner of every flat in
    it. The join lands on one household id, so the subquery still yields at
    most one row per outer row.
    """
    return Subquery(
        RouteStop.objects.filter(
            holding__households__id=OuterRef(household_field),
            route__active=True,
            route__assignment_links__assignment__active=True,
        ).values("route__assignment_links__assignment__collector_id")[:1]
    )


def planned_owners(
    ward_ids: list[str] | None = None, agency_id: str | None = None
) -> dict[str, str]:
    """`{household_id: collector_id}` for every routed holding.

    One flat query. Used where attribution has to happen in Python — the
    exception lists in the reconciliation report, which compare *sets* of
    households rather than aggregating rows.
    """
    rows = RouteStop.objects.filter(
        route__active=True,
        route__assignment_links__assignment__active=True,
    )
    if ward_ids is not None:
        rows = rows.filter(holding__ward_id__in=ward_ids)
    if agency_id is not None:
        rows = rows.filter(holding__agency_id=agency_id)
    # A stop is a building, so each one answers for every family inside it —
    # the map is still keyed by household, because that is what a bill, a
    # payment and a visit carry.
    pairs = rows.values_list(
        "holding__households__id", "route__assignment_links__assignment__collector_id"
    ).distinct()
    return {household: collector for household, collector in pairs if collector and household}
