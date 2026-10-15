"""Which holdings a citizen may see, read from the phone numbers on record.

A number on a holding (`owner_phone` or `owner_alt_phone`) gives **owner**
access to that holding: its daily collection and every complaint on it. A
number on a household gives **household** access to the building it lives in:
daily collection and that family's own complaints. Nothing else is shown to a
citizen — no bills, staff or other buildings.

Phones are stored as typed (`+8801711-000042`, `01711000042`, …), so both
sides are compared as digits only, on the last ten digits (the number without
its leading 0 or country code).
"""

from __future__ import annotations

from dataclasses import dataclass

from django.db.models import F, Func, Q, Value

from swms.customers.models import Holding, HoldingStatus, Household

OWNER = "owner"
HOUSEHOLD = "household"


@dataclass
class Access:
    holding: Holding
    role: str  # OWNER | HOUSEHOLD
    household: Household | None = None

    @property
    def is_owner(self) -> bool:
        return self.role == OWNER


def _digits(field: str) -> Func:
    return Func(F(field), Value(r"\D"), Value(""), Value("g"), function="regexp_replace")


def _tail(phone: str) -> str:
    return phone[-10:]


def access_for(phone: str) -> list[Access]:
    """Every holding this number may see, owners first; one entry per holding."""
    if len(phone) < 10:
        return []
    tail = _tail(phone)

    owned = (
        Holding.objects.filter(status=HoldingStatus.ACTIVE)
        .annotate(owner_digits=_digits("owner_phone"), alt_digits=_digits("owner_alt_phone"))
        .filter(Q(owner_digits__endswith=tail) | Q(alt_digits__endswith=tail))
        .select_related("ward", "road")
        .order_by("holding_no")
    )
    entries: dict[str, Access] = {h.pk: Access(h, OWNER) for h in owned}

    families = (
        Household.objects.filter(status=HoldingStatus.ACTIVE, holding__status=HoldingStatus.ACTIVE)
        .annotate(phone_digits=_digits("phone"))
        .filter(phone_digits__endswith=tail)
        .select_related("holding", "holding__ward", "holding__road")
        .order_by("holding__holding_no")
    )
    for family in families:
        # An owner who also lives in their building keeps owner access.
        entries.setdefault(family.holding_id, Access(family.holding, HOUSEHOLD, family))
    return list(entries.values())


def access_to(phone: str, holding_id: str) -> Access | None:
    return next((a for a in access_for(phone) if a.holding.pk == holding_id), None)


def display_name(entries: list[Access]) -> str:
    """A name to greet the citizen with: the owner's, else the family head's."""
    for entry in entries:
        if entry.is_owner and entry.holding.owner_name:
            return entry.holding.owner_name
    for entry in entries:
        if entry.household and entry.household.head:
            return entry.household.head
    return ""
