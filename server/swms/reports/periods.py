"""Period bucketing, ported from `periodKey`/`isoWeek`/`billPeriodKey`.

Four granularities, each with a stable text label the UI already renders:

    daily    2026-07-27
    weekly   2026-W31      (ISO week, Monday-based)
    monthly  2026-07
    yearly   2026

Two subtleties are carried over deliberately:

* A **bill covers a month**, so it buckets by its `period` column rather than a
  timestamp it does not have. Only in daily/weekly view does it fall back to its
  issue date.
* A **payment happens on a day**, so it buckets by when the money was taken. A
  July bill settled in August therefore lands in two different buckets — that lag
  is precisely what a collection-rate report exists to show.

All truncation happens in Postgres in the project's timezone (Asia/Dhaka), so a
6am round is never pushed into the previous day by UTC.
"""

from __future__ import annotations

import datetime as dt
import re

from django.db.models import F
from django.db.models.functions import TruncDate, TruncMonth, TruncWeek, TruncYear
from django.utils import timezone

DAILY = "daily"
WEEKLY = "weekly"
MONTHLY = "monthly"
YEARLY = "yearly"

MODES = (DAILY, WEEKLY, MONTHLY, YEARLY)
DEFAULT_MODE = MONTHLY

_MONTH_RE = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")
_DAY_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

_TRUNC = {DAILY: TruncDate, WEEKLY: TruncWeek, MONTHLY: TruncMonth, YEARLY: TruncYear}


def normalise_mode(mode: str | None) -> str:
    mode = (mode or DEFAULT_MODE).lower()
    return mode if mode in MODES else DEFAULT_MODE


def trunc(field: str, mode: str, *, date_field: bool = False):
    """The Postgres date_trunc expression for `mode`.

    Timestamps are truncated in the project's timezone so a 6am round is never
    pushed into the previous day by UTC. A plain `DateField` (like
    `Visit.served_on`, which is already the local service date) carries no
    timezone, and Django rejects `tzinfo` on one — so those are truncated without
    it, and a daily bucket is simply the column itself.
    """
    mode = normalise_mode(mode)
    if date_field:
        return F(field) if mode == DAILY else _TRUNC[mode](field)
    return _TRUNC[mode](field, tzinfo=timezone.get_current_timezone())


def iso_week_label(value: dt.date) -> str:
    """`2026-07-27` -> `2026-W31`. Uses the ISO calendar, so the year can differ
    from the calendar year in the first and last days of a year."""
    iso = value.isocalendar()
    return f"{iso[0]}-W{iso[1]:02d}"


def label(value: dt.date | dt.datetime | None, mode: str) -> str | None:
    """Turn a truncated date into the text bucket key the UI displays."""
    if value is None:
        return None
    if isinstance(value, dt.datetime):
        value = timezone.localtime(value).date() if timezone.is_aware(value) else value.date()
    mode = normalise_mode(mode)
    if mode == DAILY:
        return value.isoformat()
    if mode == WEEKLY:
        return iso_week_label(value)
    if mode == YEARLY:
        return f"{value.year}"
    return f"{value.year}-{value.month:02d}"


def bill_label(period: str, issued_at: dt.date | None, mode: str) -> str | None:
    """Bucket a bill. Monthly/yearly read `period`; finer views use the issue date."""
    if not period or not _MONTH_RE.match(period):
        return None
    mode = normalise_mode(mode)
    if mode == MONTHLY:
        return period
    if mode == YEARLY:
        return period[:4]
    basis = issued_at or dt.date(int(period[:4]), int(period[5:7]), 1)
    return label(basis, mode)


def is_month(value: str | None) -> bool:
    return bool(value and _MONTH_RE.match(value))


def is_day(value: str | None) -> bool:
    return bool(value and _DAY_RE.match(value))


def month_bounds(period: str) -> tuple[dt.date, dt.date]:
    """Inclusive first and last day of a `YYYY-MM` month."""
    if not is_month(period):
        raise ValueError(f"expected YYYY-MM, got {period!r}")
    year, month = int(period[:4]), int(period[5:7])
    start = dt.date(year, month, 1)
    end = dt.date(year + (month == 12), (month % 12) + 1, 1) - dt.timedelta(days=1)
    return start, end


def month_range_filter(field: str, period: str) -> dict:
    """Kwargs restricting a datetime field to one month, in local time."""
    start, end = month_bounds(period)
    tz = timezone.get_current_timezone()
    return {
        f"{field}__gte": timezone.make_aware(dt.datetime.combine(start, dt.time.min), tz),
        f"{field}__lt": timezone.make_aware(
            dt.datetime.combine(end + dt.timedelta(days=1), dt.time.min), tz
        ),
    }


def current_month() -> str:
    return timezone.localdate().strftime("%Y-%m")


def previous_months(count: int, *, ending: str | None = None) -> list[str]:
    """The `count` month keys ending at `ending` (default: this month), oldest first."""
    end = ending or current_month()
    year, month = int(end[:4]), int(end[5:7])
    out = []
    for _ in range(count):
        out.append(f"{year}-{month:02d}")
        month -= 1
        if month == 0:
            year, month = year - 1, 12
    return list(reversed(out))
