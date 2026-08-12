"""A route stop becomes a building rather than a family.

A collector walks to an address once and empties every flat in it, so the plan
is holding-wise: a block of twelve flats is one stop, not twelve. Collection is
unaffected — the round expands each stop into the households inside it, and
every flat keeps its own QR tag, visit and bill.

The back-fill maps each stop to its household's holding. Two flats of the same
building routed separately would collapse into one stop, so the numbering is
rebuilt per route afterwards and the collapse is reported rather than silently
performed. On the live database at the time of writing there were 15 stops
across 15 distinct buildings, so nothing collapses.

Reversible: going back re-points each stop at a household of its building. It
picks the lowest household id for determinism, which is the original row
wherever the forward migration collapsed nothing.
"""

from django.db import migrations, models
import django.db.models.deletion


def stop_holdings(apps, schema_editor):
    """Fill `holding` from each stop's household, then renumber each route."""
    RouteStop = apps.get_model("fieldops", "RouteStop")

    rows = list(
        RouteStop.objects.select_related("household").order_by("route_id", "seq")
    )
    if not rows:
        return

    kept, dropped = [], []
    seen = set()
    for row in rows:
        key = row.household.holding_id
        if key in seen:
            # Two flats of one building on the plan. The building is already a
            # stop, so the second row is redundant rather than lost.
            dropped.append(row)
            continue
        seen.add(key)
        row.holding_id = key
        kept.append(row)

    # Renumber inside each route so `seq` stays 1..n with no holes after a
    # collapse — the unique constraint is on (route, seq).
    by_route = {}
    for row in kept:
        by_route.setdefault(row.route_id, []).append(row)
    for route_rows in by_route.values():
        for index, row in enumerate(route_rows, start=1):
            row.seq = index

    RouteStop.objects.bulk_update(kept, ["holding_id", "seq"])
    if dropped:
        RouteStop.objects.filter(pk__in=[r.pk for r in dropped]).delete()
        print(
            f"\n  {len(dropped)} stop(s) removed: their building was already on "
            f"the route. {len(kept)} stop(s) kept."
        )


def stop_households(apps, schema_editor):
    """Point each stop back at a household of its building."""
    RouteStop = apps.get_model("fieldops", "RouteStop")
    Household = apps.get_model("customers", "Household")

    first_of = {}
    for holding_id, household_id in (
        Household.objects.order_by("holding_id", "id")
        .values_list("holding_id", "id")
    ):
        first_of.setdefault(holding_id, household_id)

    rows, orphans = [], []
    for row in RouteStop.objects.all():
        household_id = first_of.get(row.holding_id)
        if household_id is None:
            # A building with no households cannot be a household-keyed stop.
            orphans.append(row)
            continue
        row.household_id = household_id
        rows.append(row)
    RouteStop.objects.bulk_update(rows, ["household_id"])
    if orphans:
        RouteStop.objects.filter(pk__in=[r.pk for r in orphans]).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("customers", "0007_holding_agency"),
        ("fieldops", "0006_route_agency"),
    ]

    # The order matters in *both* directions. Django reverses the list, so the
    # back-fill has to sit between "column exists and is nullable" and "column
    # is required" on the way down as well as up. Removing the old column
    # before relaxing it would make the reverse re-add a NOT NULL column to a
    # populated table, which cannot succeed.
    operations = [
        # Added as a nullable *OneToOne*, not a ForeignKey later widened to one.
        # Going FK → OneToOne makes Postgres swap a plain index for a unique
        # constraint, and reversing that tries to re-create the `_like` index
        # the first step already left behind — which fails with "relation
        # route_stop_holding_id_..._like already exists". Only nullability
        # changes below, so no index is rebuilt in either direction.
        migrations.AddField(
            model_name="routestop",
            name="holding",
            field=models.OneToOneField(
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name="route_stop",
                to="customers.holding",
            ),
        ),
        migrations.AlterField(
            model_name="routestop",
            name="household",
            field=models.OneToOneField(
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name="route_stop",
                to="customers.household",
            ),
        ),
        migrations.RunPython(stop_holdings, stop_households),
        migrations.RemoveField(model_name="routestop", name="household"),
        migrations.AlterField(
            model_name="routestop",
            name="holding",
            field=models.OneToOneField(
                on_delete=django.db.models.deletion.CASCADE,
                related_name="route_stop",
                to="customers.holding",
            ),
        ),
    ]
