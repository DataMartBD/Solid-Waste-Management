"""Human-readable text primary keys.

The React app already treats every id as an opaque string and displays several
of them verbatim (`HH-KCC-0012840`, `SS-9F3A21`, `RT-W-14-01`). Keeping text PKs
server-side means the seeded database is byte-for-byte recognisable in the UI and
no id translation layer is needed.

Ids are allocated from a Postgres sequence table rather than a timestamp so they
stay short, ordered and collision-free under concurrency.
"""

from __future__ import annotations

from django.db import models, transaction

PREFIXES = {
    "agency": "AGN-KCC",
    "holding": "HLD-KCC",
    "household": "HH-KCC",
    "potential": "POT",
    "collector": "C",
    "route": "RT",
    "assignment": "AS",
    "visit": "V",
    "complaint": "CMP",
    "van": "VAN-KCC",
    "maintenance": "MNT",
    "fuel": "FUEL",
    "bill": "B",
    "payment": "PAY",
    "deposit": "DEP",
    "survey": "SRV",
    "remittance": "REM",
}


class IdSequence(models.Model):
    """One row per id prefix holding the last value handed out."""

    key = models.CharField(max_length=32, primary_key=True)
    last_value = models.BigIntegerField(default=0)

    class Meta:
        db_table = "id_sequence"
        verbose_name = "id sequence"

    def __str__(self) -> str:
        return f"{self.key}={self.last_value}"


def _next_value(key: str, start: int) -> int:
    """Atomically claim the next number for `key`.

    select_for_update serialises concurrent allocations; the row is created on
    first use starting from `start`.
    """
    with transaction.atomic():
        row, created = IdSequence.objects.select_for_update().get_or_create(
            key=key, defaults={"last_value": start}
        )
        if created:
            return row.last_value
        row.last_value += 1
        row.save(update_fields=["last_value"])
        return row.last_value


def next_id(kind: str, *, width: int = 5, start: int = 1) -> str:
    """`next_id('household')` -> 'HH-KCC-0012841'."""
    prefix = PREFIXES[kind]
    return f"{prefix}-{_next_value(kind, start):0{width}d}"


def reserve(kind: str, value: int) -> None:
    """Bump a sequence so seeded ids are never re-issued.

    The seed writes explicit ids (they must match the mock data), so afterwards
    each counter is pushed past the highest seeded number.
    """
    row, created = IdSequence.objects.get_or_create(key=kind, defaults={"last_value": value})
    if not created and row.last_value < value:
        row.last_value = value
        row.save(update_fields=["last_value"])


def agency_id() -> str:
    return next_id("agency", width=4)


def holding_id() -> str:
    return next_id("holding", width=6)


def household_id() -> str:
    return next_id("household", width=7)


def potential_id() -> str:
    return next_id("potential", width=4, start=3001)


def collector_id() -> str:
    return next_id("collector", width=3, start=101)


def assignment_id() -> str:
    return next_id("assignment", width=4)


def visit_id() -> str:
    return next_id("visit", width=6)


def complaint_id() -> str:
    return next_id("complaint", width=5, start=20001)


def van_id() -> str:
    return next_id("van", width=3)


def maintenance_id() -> str:
    return next_id("maintenance", width=4, start=3001)


def fuel_id() -> str:
    return next_id("fuel", width=4, start=5001)


def route_id(ward_id: str) -> str:
    """Routes are numbered within their ward: 'RT-W-14-03'."""
    seq = _next_value(f"route:{ward_id}", 1)
    return f"RT-{ward_id}-{seq:02d}"


def qr_tag(household_pk: str) -> str:
    """Mirror the frontend rule: 'SS-' + last six chars of the id, upper-cased."""
    return "SS-" + household_pk.replace("-", "")[-6:].upper()


def bill_id(period: str, household_pk: str) -> str:
    """`B-2026-07-0012840` — period plus the tail of the household id."""
    return f"B-{period}-{household_pk.replace('-', '')[-7:]}"


def payment_id(period: str) -> str:
    return f"PAY-{period}-{_next_value(f'payment:{period}', 1):05d}"


def deposit_id(period: str) -> str:
    return f"DEP-{period}-{_next_value(f'deposit:{period}', 1):04d}"


def survey_id() -> str:
    return next_id("survey", width=6)


def remittance_id(period: str) -> str:
    return f"REM-{period}-{_next_value(f'remittance:{period}', 1):04d}"
