"""PIN rules, kept identical to `validatePin` in the React AuthContext.

Error codes ('tooShort', 'tooSimple') are returned verbatim so the existing
Bangla/English dictionaries under src/i18n/dict/auth.js still resolve them.
"""

from __future__ import annotations

from django.conf import settings


def validate_pin(pin: str | None) -> str | None:
    """Return an error code, or None when the PIN is acceptable."""
    pin = (pin or "").strip()
    if len(pin) != settings.PIN_LENGTH or not pin.isdigit():
        return "tooShort"
    if len(set(pin)) == 1:
        return "tooSimple"
    digits = [int(ch) for ch in pin]
    steps = {b - a for a, b in zip(digits, digits[1:])}
    if steps in ({1}, {-1}):
        return "tooSimple"
    return None
