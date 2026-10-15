"""Citizen accounts: holding owners and households who sign in to the portal.

Kept apart from `accounts.User` on purpose. A citizen is not an operator: they
have no role, no scope and no staff screen, and a separate table means no
mistake on the Users page can ever hand one a staff role.

A citizen signs in with their mobile number and a 4-digit PIN. Until they set
their own, the PIN is the last four digits of the number. Which holdings they
may see is not stored here — it is looked up from the phone numbers on
holdings and households every time (see `access.py`), so when an agency
corrects a number, access follows.
"""

from __future__ import annotations

import datetime as dt

from django.conf import settings
from django.contrib.auth.hashers import check_password, make_password
from django.db import models
from django.utils import timezone

from swms.common.models import TimeStampedModel


class CitizenAccount(TimeStampedModel):
    phone = models.CharField(max_length=15, unique=True)
    name = models.CharField(max_length=120, blank=True)
    #: Empty means the default PIN (the last four digits of `phone`).
    pin_hash = models.CharField(max_length=128, blank=True)
    pin_set_at = models.DateTimeField(null=True, blank=True)
    pin_attempts = models.PositiveSmallIntegerField(default=0)
    pin_locked_until = models.DateTimeField(null=True, blank=True)
    last_login = models.DateTimeField(null=True, blank=True)
    active = models.BooleanField(default=True)

    class Meta:
        db_table = "citizen_account"
        ordering = ["phone"]

    def __str__(self) -> str:
        return self.phone

    # DRF's IsAuthenticated reads this on `request.user`.
    is_authenticated = True
    is_anonymous = False

    @property
    def default_pin(self) -> str:
        return self.phone[-4:]

    @property
    def using_default_pin(self) -> bool:
        return not self.pin_hash

    @property
    def pin_locked(self) -> bool:
        return bool(self.pin_locked_until and self.pin_locked_until > timezone.now())

    def check_pin(self, pin: str) -> bool:
        """Check a PIN, counting failures toward a lockout."""
        pin = (pin or "").strip()
        ok = check_password(pin, self.pin_hash) if self.pin_hash else pin == self.default_pin
        if ok:
            self.pin_attempts = 0
            self.pin_locked_until = None
        else:
            self.pin_attempts += 1
            if self.pin_attempts >= settings.PIN_MAX_ATTEMPTS:
                self.pin_locked_until = timezone.now() + dt.timedelta(
                    seconds=settings.PIN_LOCKOUT_SECONDS
                )
                self.pin_attempts = 0
        self.save(update_fields=["pin_attempts", "pin_locked_until", "updated_at"])
        return ok

    def set_pin(self, pin: str) -> None:
        self.pin_hash = make_password(pin)
        self.pin_set_at = timezone.now()
        self.pin_attempts = 0
        self.pin_locked_until = None

    def reset_pin(self) -> None:
        """Back to the default PIN — the office's answer to "I forgot my PIN"."""
        self.pin_hash = ""
        self.pin_set_at = None
        self.pin_attempts = 0
        self.pin_locked_until = None
