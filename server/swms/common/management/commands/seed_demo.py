"""Seed the database with the demo dataset the React app used to generate itself.

    python manage.py seed_demo --flush

The frontend built its whole world in src/data/mockData.js: four wards, 29
holdings, six collectors, a route plan, 90 days of rounds and 14 months of
billing, all from one seeded generator so a page reload never reshuffled the
figures. This command produces the same world in Postgres.

Two properties matter and are tested by running it twice:

* **deterministic** — the reference date is the only input. Every generator is
  explicitly seeded, so the same date always yields the same rows.
* **idempotent** — `--flush` clears the demo tables first; without it the command
  refuses rather than half-appending to a populated database.

`--only` was considered and left out: catalog, households, the route plan and the
history form one chain where each stage is the previous stage's input, so a
partial seed either rebuilds most of it anyway or produces a database no page can
render.
"""

from __future__ import annotations

import datetime as dt
import random
import time

from django.apps import apps
from django.core.management.base import BaseCommand, CommandError
from django.db import models
from django.db import transaction
from django.utils import timezone

from swms.accounts.models import User
from swms.accounts.validators import validate_pin
from swms.ai.models import AiQuery
from swms.billing.models import Bill, BillingRun, Deposit, Payment, Remittance
from swms.catalog.models import Block, Road, Tier, Ward, Zone
from swms.common.ids import IdSequence
from swms.complaints.models import Complaint, ComplaintActivity
from swms.agencies.models import Agency, CollectorEmployment
from swms.customers.models import Holding, Household, PotentialCustomer
from swms.fieldops.models import Assignment, AssignmentRoute, Collector, Route, RouteStop, Visit
from swms.fleet.models import FuelLog, Maintenance, Van, VehiclePosition
from swms.surveys.models import Survey, SurveyForm

from ._seed import load, mockdata as mock
from ._seed.generate import build

#: Deleted by --flush, in an order no PROTECT constraint objects to.
_TEARDOWN = [
    ComplaintActivity,
    Complaint,
    Payment,
    # The seed writes none, but a live database flushed for a demo reset will
    # have them, and they PROTECT both Agency and PaymentMode.
    Remittance,
    Deposit,
    Bill,
    BillingRun,
    Visit,
    AssignmentRoute,
    Assignment,
    RouteStop,
    Route,
    FuelLog,
    Maintenance,
    VehiclePosition,
    Van,
    # Before Agency, Ward and Block, all of which it PROTECTs. Its answers and
    # photos cascade with it.
    Survey,
    PotentialCustomer,
    Household,
    # After the two above, which PROTECT it.
    Holding,
    CollectorEmployment,
    Collector,
    # Last of the agency-referencing tables: Van, Holding, CollectorEmployment
    # and Collector all PROTECT it and are gone by here. So are the demo logins,
    # which `_flush` now removes before this loop rather than after — the seed
    # is free to set `User.agency`, which it previously could not.
    Agency,
    AiQuery,
    # After Survey, which PROTECTs both.
    SurveyForm,
    Block,
    Road,
    Ward,
    Zone,
    Tier,
    *load.OPTION_MODELS,
]

def protecting_relations():
    """Every `(holder, target, field_name)` where `holder` PROTECTs `target`.

    Shared with `swms.common.test_seed`, which checks the *list* against this
    rule while `_blockers` below checks the actual *rows* against it. Two copies
    of "what PROTECTs what" would drift.
    """
    relations = []
    for model in apps.get_models():
        for field in model._meta.get_fields():
            if isinstance(field, models.ForeignKey) and (
                field.remote_field.on_delete is models.PROTECT
            ):
                relations.append((model, field.remote_field.model, field.name))
    return relations


def survivors(model):
    """The rows of `model` that a flush leaves behind.

    Everything in `_TEARDOWN` is emptied, so only the partially-cleared tables
    are interesting. `User` is the one: the flush removes the demo logins by
    phone number and deliberately spares everyone else, because another
    operator's account is not demo data.
    """
    if model is User:
        return User.objects.exclude(
            phone__in=[row["phone"] for row in mock.OPERATORS] + [mock.SUPERUSER_PHONE]
        )
    return model.objects.all()


#: Tables whose contents mean "this database is already seeded".
_OCCUPANCY = [Ward, Collector, Household, Bill, Visit]

#: Row counts printed at the end, in the order the seed writes them.
_SUMMARY = [
    Zone, Ward, Block, Road, Tier, Household, PotentialCustomer, Collector, Route, RouteStop,
    Assignment, AssignmentRoute, Visit, Van, VehiclePosition, Maintenance, FuelLog,
    Complaint, ComplaintActivity, BillingRun, Bill, Payment, Deposit, User,
]


class Command(BaseCommand):
    help = "Load the Smart Sweep demo dataset (households, routes, 90 days of history)."

    def add_arguments(self, parser) -> None:
        parser.add_argument(
            "--flush",
            action="store_true",
            help="Delete existing demo data first. Required to re-run.",
        )
        parser.add_argument(
            "--detach",
            action="store_true",
            help="Clear references that surviving non-demo rows hold to demo data, "
                 "instead of refusing the flush. See --flush's pre-flight check.",
        )
        parser.add_argument(
            "--today",
            metavar="YYYY-MM-DD",
            help="Pin the reference date the rolling history ends on (default: today).",
        )

    def handle(self, *args, **options) -> None:
        today = self._reference_date(options.get("today"))
        if error := validate_pin(mock.DEMO_PIN):
            raise CommandError(f"The demo PIN {mock.DEMO_PIN!r} is rejected as {error!r}.")

        started = time.monotonic()
        with transaction.atomic():
            if options["flush"]:
                self._flush(detach=options["detach"])
            else:
                self._require_empty()

            self.stdout.write(f"Seeding history for the 90 days ending {today}.")
            data = build(today)

            roads = load.load_catalog()
            agency = load.load_agencies()
            load.load_collectors(agency)
            # Holdings first: a household cannot exist without the building it
            # sits in, which is the rule the whole model now turns on.
            holdings = load.load_holdings(data.households + data.potential, roads, agency)
            load.load_households(data.households, roads, holdings)
            load.load_potential_customers(data.potential, roads, holdings)
            load.load_plan(data.routes, data.assignments, today, agency)
            load.load_visits(data.visits, agency)
            load.load_fleet()
            # Positions are deterministic, but their timestamps are stamped from
            # the wall clock rather than the reference date: a GPS fix means
            # "where it is now", and a fix pinned to 09:30 would show every van
            # as stale the moment the demo is opened in the afternoon.
            load.load_positions(random.Random(20260706), timezone.now())
            load.load_complaints()
            load.load_billing(data.bills, data.payments, data.deposits, agency)
            load.settle(today)
            users = load.load_users()
            load.reserve_sequences(data)

        self._report(users, time.monotonic() - started)

    # --- setup ------------------------------------------------------------ #

    def _reference_date(self, raw: str | None) -> dt.date:
        if not raw:
            return timezone.localdate()
        try:
            return dt.date.fromisoformat(raw)
        except ValueError as exc:
            raise CommandError(f"--today must be YYYY-MM-DD, not {raw!r}.") from exc

    def _require_empty(self) -> None:
        occupied = [model for model in _OCCUPANCY if model.objects.exists()]
        if occupied:
            names = ", ".join(model._meta.db_table for model in occupied)
            raise CommandError(
                f"This database already holds data ({names}). "
                "Re-run with --flush to replace it."
            )

    def _blockers(self) -> list[tuple]:
        """Surviving rows that PROTECT something the flush is about to delete.

        The flush spares non-demo accounts, so a real operator assigned to a
        demo agency would outlive the agency and make the delete fail — halfway
        through, with a `ProtectedError` naming a constraint rather than a
        person. This finds them first, while nothing has been touched yet.

        Generic on purpose: `User.agency` is the only case today, and the next
        one should not have to be discovered the same way.
        """
        deleted = set(_TEARDOWN)
        blockers = []
        for holder, target, name in protecting_relations():
            if target not in deleted or holder in deleted:
                continue
            rows = survivors(holder).filter(**{f"{name}__isnull": False})
            count = rows.count()
            if count:
                nullable = holder._meta.get_field(name).null
                blockers.append((holder, name, target, rows, count, nullable))
        return blockers

    def _preflight(self, detach: bool) -> None:
        blockers = self._blockers()
        if not blockers:
            return

        if not detach:
            lines = []
            for holder, name, target, rows, count, nullable in blockers:
                who = ", ".join(str(row) for row in rows[:5])
                more = f" and {count - 5} more" if count > 5 else ""
                lines.append(
                    f"  {count} {holder._meta.verbose_name_plural} reference a "
                    f"{target._meta.verbose_name} through .{name}: {who}{more}"
                )
            detail = "\n".join(lines)
            raise CommandError(
                "These rows are not demo data, so the flush would keep them — but "
                "they point at demo rows it is about to delete:\n"
                f"{detail}\n\n"
                "Re-run with --detach to clear those references, or unset them "
                "yourself first."
            )

        for holder, name, target, rows, count, nullable in blockers:
            if not nullable:
                raise CommandError(
                    f"{holder.__name__}.{name} cannot be cleared — it is not "
                    f"nullable. Delete or repoint those {count} row(s) by hand."
                )
            rows.update(**{name: None})
            self.stdout.write(self.style.WARNING(
                f"Detached {count} {holder._meta.verbose_name_plural} from "
                f"{target._meta.verbose_name}.{name}."
            ))

    def _flush(self, detach: bool = False) -> None:
        # Before anything is deleted: a failure here leaves the database as it
        # was, whereas a ProtectedError halfway down the list does not explain
        # itself.
        self._preflight(detach)

        # The demo logins go *first*, not last. They PROTECT Agency through
        # `User.agency`, so clearing them afterwards meant the seed could never
        # assign one — a constraint nobody would guess from reading the loader.
        # Nothing PROTECTs User, so they are safe to remove up front, and the
        # only accounts this touches are the ones this command creates: another
        # operator's login is not demo data and must survive a reseed.
        phones = [row["phone"] for row in mock.OPERATORS] + [mock.SUPERUSER_PHONE]
        User.objects.filter(phone__in=phones).delete()

        for model in _TEARDOWN:
            model.objects.all().delete()
        IdSequence.objects.all().delete()
        self.stdout.write("Flushed existing demo data.")

    # --- output ----------------------------------------------------------- #

    def _report(self, users: list[User], elapsed: float) -> None:
        width = max(len(model._meta.db_table) for model in _SUMMARY)
        self.stdout.write(f"\n  {'table':<{width}}  {'rows':>6}")
        self.stdout.write(f"  {'-' * width}  {'-' * 6}")
        for model in _SUMMARY:
            count = model.objects.count()
            self.stdout.write(f"  {model._meta.db_table:<{width}}  {count:>6,}")

        self.stdout.write(self.style.SUCCESS(f"\nSeeded in {elapsed:.1f}s.\n"))
        # ASCII only: this prints to a Windows console under cp1252 more often than not.
        self.stdout.write("Demo logins - request an OTP, then use the PIN:")
        for user in users:
            if user.is_superuser:
                continue
            self.stdout.write(
                f"  {user.phone}  PIN {mock.DEMO_PIN}  "
                f"{user.name} - {user.role_label}, {user.scope_label}"
            )
        self.stdout.write(
            f"\n/admin superuser: {mock.SUPERUSER_PHONE} / {mock.SUPERUSER_PASSWORD}"
        )
