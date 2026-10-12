"""Close the collection day: every uncomplained household counts as collected.

    manage.py close_collection_day                    # every city past its cut-off
    manage.py close_collection_day --city KCC         # just one city
    manage.py close_collection_day --date 2026-10-09  # a day the server missed
    manage.py close_collection_day --dry-run          # count, write nothing

Meant for cron, every 15 minutes:

    */15 * * * *  cd /srv/swms/server && .venv/bin/python manage.py close_collection_day

Without `--date` each city closes yesterday (in case the server was down at
its cut-off) and, once the clock has passed today's cut-off, today. Re-running
is safe: households that already have a visit for the day are left alone.
"""

from __future__ import annotations

import datetime as dt

from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from swms.catalog.models import City
from swms.fieldops.collection_day import close_day, is_closed


class Command(BaseCommand):
    help = "Mark uncomplained households collected at each city's cut-off."

    def add_arguments(self, parser):
        parser.add_argument(
            "--city", action="append", dest="cities", metavar="CITY_ID",
            help="Limit to this city. Repeatable. Defaults to every active city.",
        )
        parser.add_argument(
            "--date", type=dt.date.fromisoformat, metavar="YYYY-MM-DD",
            help="Close this day only. It must already be past the city's cut-off.",
        )
        parser.add_argument("--dry-run", action="store_true", help="Report, write nothing.")

    def handle(self, *args, cities=None, date=None, dry_run=False, **options):
        rows = City.objects.filter(active=True)
        if cities:
            rows = City.objects.filter(pk__in=cities)
            missing = set(cities) - set(rows.values_list("pk", flat=True))
            if missing:
                raise CommandError(f"Unknown city: {', '.join(sorted(missing))}")

        now = timezone.now()
        today = timezone.localdate()
        for city in rows:
            if date:
                if not is_closed(city, date, now):
                    raise CommandError(
                        f"{city.id} {date} is still open until {city.collection_cutoff:%H:%M}."
                    )
                days = [date]
            else:
                days = [today - dt.timedelta(days=1)]
                if is_closed(city, today, now):
                    days.append(today)

            for day in days:
                result = close_day(city, day, now=now, dry_run=dry_run)
                self.stdout.write(
                    f"{city.id} {day}: {result['auto_collected']} auto-collected, "
                    f"{result['auto_missed']} not collected (complaint)"
                    + (" [dry run]" if dry_run else "")
                )
