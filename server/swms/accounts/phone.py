"""Phone normalisation — the login identifier.

Mirrors `normalizePhone` in the React AuthContext: keep digits only, then drop a
leading Bangladesh country code so `+8801711-000042`, `8801711000042` and
`01711000042` are all the same account. Bangla numerals are accepted because the
UI's number pad emits them when the language is Bangla.
"""

from __future__ import annotations

import re

#: Bangla digits ০-৯ → ASCII.
_BANGLA = str.maketrans("০১২৩৪৫৬৭৮৯", "0123456789")

_NON_DIGITS = re.compile(r"\D+")


def normalize_phone(raw: str | None) -> str:
    if not raw:
        return ""
    digits = _NON_DIGITS.sub("", str(raw).translate(_BANGLA))
    if digits.startswith("88") and len(digits) > 11:
        digits = digits[2:]
    return digits


def is_valid_phone(value: str) -> bool:
    """Bangladeshi mobile: 11 digits, `01` + operator digit 3-9."""
    return bool(re.fullmatch(r"01[3-9]\d{8}", value))


def display_phone(value: str) -> str:
    """`01711000042` -> `+8801711-000042`, matching the seeded contact strings."""
    if not is_valid_phone(value):
        return value
    return f"+88{value[:5]}-{value[5:]}"
