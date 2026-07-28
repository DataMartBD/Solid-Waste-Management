"""The JavaScript behaviours the seed has to reproduce.

Three of them, subtle enough to be worth isolating from the data itself:

* the linear-congruential generator every random choice in mockData.js comes from;
* `localeCompare(a, b, {numeric: true})`, which is how holding numbers are put
  into walking order;
* the timestamp strings, which mixed a `Z` suffix with naive values and are all
  read here as Asia/Dhaka wall-clock time.
"""

from __future__ import annotations

import datetime as dt
import math
import re
from typing import Sequence, TypeVar

from django.utils import timezone

T = TypeVar("T")


class Lcg:
    """`state = (state * 1103515245 + 12345) & 0x7fffffff`, as mockData.js runs it.

    Python's integers make this an exact LCG; JavaScript lost the low bits of the
    multiplication to float64 before masking, so the two sequences diverge after
    the first few draws. Nothing downstream depends on matching the browser —
    only on the same seed giving the same data on every run — so exact arithmetic
    is used rather than a float64 emulation.
    """

    __slots__ = ("state",)

    def __init__(self, seed: int) -> None:
        self.state = seed & 0xFFFFFFFF

    def next(self) -> float:
        self.state = (self.state * 1103515245 + 12345) & 0x7FFFFFFF
        return self.state / 0x7FFFFFFF

    def below(self, bound: int) -> int:
        """`Math.floor(rnd() * bound)`."""
        return min(int(self.next() * bound), bound - 1)

    def pick(self, options: Sequence[T]) -> T:
        return options[self.below(len(options))]


def js_round(value: float) -> int:
    """`Math.round`: halves go up, where Python's `round` sends them to even."""
    return math.floor(value + 0.5)


_DIGIT_RUNS = re.compile(r"(\d+)")


def natural_key(value: object) -> tuple:
    """Sort key matching `localeCompare(a, b, {numeric: true})`.

    Holding numbers are only orderable this way: '77' comes before '142/B' and
    '15/B' before '16', because digit runs compare as numbers and the rest as text.
    """
    return tuple(
        (0, int(part), "") if part.isdigit() else (1, 0, part.casefold())
        for part in _DIGIT_RUNS.split(str(value))
        if part
    )


def localize(value: dt.datetime) -> dt.datetime:
    return timezone.make_aware(value, timezone.get_current_timezone())


def local(stamp: str) -> dt.datetime:
    """Read a mockData timestamp as Asia/Dhaka wall-clock time.

    mockData.js wrote both `'2026-07-05T08:12Z'` and `'2026-07-05T08:12:00'`. The
    `Z` was never meant literally — an 05:50 refuelling and an 08:12 complaint
    about a missed morning round are both readings off a local clock — so the
    suffix is dropped and every value is localised in settings.TIME_ZONE.
    """
    return localize(dt.datetime.fromisoformat(stamp.removesuffix("Z")))


def local_midnight(day: dt.date) -> dt.datetime:
    return localize(dt.datetime.combine(day, dt.time.min))


def add_months(day: dt.date, months: int) -> dt.date:
    """First of the month `months` away — mockData's `addMonths`."""
    total = day.year * 12 + (day.month - 1) + months
    return dt.date(total // 12, total % 12 + 1, 1)
