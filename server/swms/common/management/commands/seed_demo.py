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

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from swms.accounts.models import User
from swms.accounts.validators import validate_pin
from swms.ai.models import AiQuery
from swms.billing.models import Bill, BillingRun, Deposit, Payment
from swms.catalog.models import Road, Tier, Ward, Zone
from swms.common.ids import IdSequence
from swms.complaints.models import Complaint, ComplaintActivity
from swms.customers.models import Household, PotentialCustomer
from swms.fieldops.models import Assignment, AssignmentRoute, Collector, Route, RouteStop, Visit
from swms.fleet.models import FuelLog, Maintenance, Van, VehiclePosition

from ._seed import load, mockdata as mock
from ._seed.generate import build

#: Deleted by --flush, in an order no PROTECT constraint objects to.
_TEARDOWN = [
    ComplaintActivity,
    Complaint,
    Payment,
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
    PotentialCustomer,
    Household,
    Collector,
    AiQuery,
    Road,
    Ward,
    Zone,
    Tier,
    *load.OPTION_MODELS,
]

#: Tables whose contents mean "this database is already seeded".
_OCCUPANCY = [Ward, Collector, Household, Bill, Visit]

#: Row counts printed at the end, in the order the seed writes them.
_SUMMARY = [
    Zone, Ward, Road, Tier, Household, PotentialCustomer, Collector, Route, RouteStop,
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
                self._flush()
            else:
                self._require_empty()

            self.stdout.write(f"Seeding history for the 90 days ending {today}.")
            data = build(today)

            roads = load.load_catalog()
            load.load_collectors()
            load.load_households(data.households, roads)
            load.load_potential_customers(data.potential, roads)
            load.load_plan(data.routes, data.assignments, today)
            load.load_visits(data.visits)
            load.load_fleet()
            # Positions are deterministic, but their timestamps are stamped from
            # the wall clock rather than the reference date: a GPS fix means
            # "where it is now", and a fix pinned to 09:30 would show every van
            # as stale the moment the demo is opened in the afternoon.
            load.load_positions(random.Random(20260706), timezone.now())
            load.load_complaints()
            load.load_billing(data.bills, data.payments, data.deposits)
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

    def _flush(self) -> None:
        for model in _TEARDOWN:
            model.objects.all().delete()
        # Only the accounts this command creates: another operator's login is not
        # demo data and must survive a reseed.
        phones = [row["phone"] for row in mock.OPERATORS] + [mock.SUPERUSER_PHONE]
        User.objects.filter(phone__in=phones).delete()
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
