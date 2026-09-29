"""Give an agency to the holdings and routes that have none.

Since agency became a real access boundary, a row with no agency is invisible to
every agency-bound user — the scoped queryset filters on the column, and NULL
matches nobody. That is the right rule (an unassigned building is not any
contractor's), but rows reach that state by accident: nothing on the create path
stamps an agency, so anything registered through the app arrives without one.

Strictly a back-fill, never a transfer. Rows that already name an agency are left
alone, and that is the whole safety property: moving a holding from one
contractor to another would rewrite who serviced it, which is a decision for the
transfer tooling and an audit trail, not for a sweep like this one.

    manage.py backfill_agency --agency AGN-KCC-0001 --dry-run
    manage.py backfill_agency --agency AGN-KCC-0001
"""

from __future__ import annotations

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from swms.agencies.models import Agency
from swms.customers.models import Holding
from swms.fieldops.models import Route

#: Model -> what to call it in the report. Both carry `agency` directly; models
#: that reach one through a parent (a household through its holding, a bill
#: through its household) need nothing here, because fixing the parent fixes
#: them.
TARGETS = [(Holding, "holding"), (Route, "route")]


class Command(BaseCommand):
    help = "Assign unassigned holdings and routes to an agency."

    def add_arguments(self, parser):
        parser.add_argument("--agency", help="Agency id, e.g. AGN-KCC-0001")
        parser.add_argument(
            "--dry-run", action="store_true", help="Report what would change, write nothing"
        )

    def handle(self, *args, **options):
        agency = self._agency(options.get("agency"))

        pending = [
            (model, label, list(model.objects.filter(agency__isnull=True)))
            for model, label in TARGETS
        ]
        total = sum(len(rows) for _, _, rows in pending)
        if not total:
            self.stdout.write("Nothing to do: every holding and route already has an agency.")
            return

        for _, label, rows in pending:
            for row in rows:
                self.stdout.write(f"  {label}: {row.pk} — {row}")

        if options["dry_run"]:
            self.stdout.write(f"\n{total} row(s) would be assigned to {agency.name}.")
            return

        with transaction.atomic():
            for model, _, rows in pending:
                if rows:
                    model.objects.filter(pk__in=[r.pk for r in rows]).update(agency=agency)

        counts = ", ".join(f"{len(rows)} {label}(s)" for _, label, rows in pending if rows)
        self.stdout.write(self.style.SUCCESS(f"\nAssigned {counts} to {agency.name}."))

    def _agency(self, given):
        if given:
            agency = Agency.objects.filter(pk=given).first()
            if agency is None:
                raise CommandError(f"No agency {given!r}.")
            return agency

        # Guessing is only safe when there is nothing to guess between. With two
        # contractors on record, picking one would be picking who gets paid for
        # the work these rows represent.
        agencies = list(Agency.objects.all()[:2])
        if len(agencies) == 1:
            return agencies[0]
        raise CommandError(
            "Name the agency with --agency: there is more than one on record, "
            "and which one owns these rows is not something this command can infer."
        )
