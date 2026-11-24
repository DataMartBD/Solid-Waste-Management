"""Start the day with nobody checked in.

    manage.py reset_attendance            # "Checked in" from an earlier day -> "Absent"
    manage.py reset_attendance --dry-run  # count, write nothing

`close_collection_day` (run every 15 minutes by the scheduler) already does
this on every run, so a separate schedule is not needed; this command is for
running it by hand.
"""

from __future__ import annotations

from django.core.management.base import BaseCommand

from swms.fieldops.services import reset_daily_attendance


class Command(BaseCommand):
    help = "Reset yesterday's check-ins: collectors not checked in today become Absent."

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true", help="Report, write nothing.")

    def handle(self, *args, dry_run=False, **options):
        count = reset_daily_attendance(dry_run=dry_run)
        self.stdout.write(f"{count} collector(s) reset to absent" + (" [dry run]" if dry_run else ""))
