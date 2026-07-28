"""Accounts, OTP codes and PIN credentials.

The mock app kept sessions, PIN digests and lockout counters in localStorage.
All three move here: PINs are hashed with Django's configured password hasher,
OTPs are hashed single-use rows with an expiry, and lockout state is columns on
the user.
"""

from __future__ import annotations

import secrets
from datetime import timedelta

from django.conf import settings
from django.contrib.auth.hashers import check_password, make_password
from django.contrib.auth.models import AbstractBaseUser, BaseUserManager, PermissionsMixin
from django.db import models
from django.utils import timezone

from swms.common.models import TimeStampedModel
from swms.common.roles import Role

from .phone import normalize_phone


class ScopeKind(models.TextChoices):
    WARD = "ward", "Ward"
    ZONE = "zone", "Zone"
    AGENCY = "agency", "All zones"
    CITY = "city", "City-wide"


class UserManager(BaseUserManager):
    use_in_migrations = True

    def _create(self, phone, name, role, password, **extra):
        phone = normalize_phone(phone)
        if not phone:
            raise ValueError("A phone number is required.")
        user = self.model(phone=phone, name=name or "Field Operator", role=role, **extra)
        if password:
            user.set_password(password)
        else:
            user.set_unusable_password()
        user.save(using=self._db)
        return user

    def create_user(self, phone, name="", role=Role.COLLECTOR, password=None, **extra):
        extra.setdefault("is_staff", False)
        extra.setdefault("is_superuser", False)
        return self._create(phone, name, role, password, **extra)

    def create_superuser(self, phone, name="", password=None, **extra):
        extra["is_staff"] = True
        extra["is_superuser"] = True
        extra["is_active"] = True
        return self._create(phone, name, Role.AGENCY_ADMIN, password, **extra)

    def get_by_natural_key(self, username):
        return self.get(phone=normalize_phone(username))


class User(AbstractBaseUser, PermissionsMixin, TimeStampedModel):
    """An operator. Identified by phone number, not an email or username."""

    phone = models.CharField(max_length=15, unique=True, db_index=True)
    name = models.CharField(max_length=120)
    role = models.CharField(max_length=20, choices=Role.choices, default=Role.COLLECTOR)

    # --- what this user is allowed to see -------------------------------- #
    scope_kind = models.CharField(max_length=10, choices=ScopeKind.choices, default=ScopeKind.WARD)
    scope_zone = models.CharField(max_length=8, blank=True, help_text="Zone id, e.g. Z-03")
    scope_wards = models.ManyToManyField(
        "catalog.Ward", blank=True, related_name="users", help_text="Used when scope_kind=ward"
    )

    # --- editable profile (the Profile page writes these) ----------------- #
    email = models.EmailField(blank=True)
    alt_phone = models.CharField(max_length=20, blank=True)
    nid = models.CharField(max_length=30, blank=True, verbose_name="National ID")
    blood_group = models.CharField(max_length=4, blank=True)
    emergency_contact = models.CharField(max_length=120, blank=True)
    avatar = models.ImageField(upload_to="avatars/", blank=True, null=True)

    # --- link to the field-staff record, when this user is a collector ---- #
    collector = models.ForeignKey(
        "fieldops.Collector",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="logins",
    )

    # --- PIN credential --------------------------------------------------- #
    pin_hash = models.CharField(max_length=128, blank=True)
    pin_set_at = models.DateTimeField(null=True, blank=True)
    pin_attempts = models.PositiveSmallIntegerField(default=0)
    pin_locked_until = models.DateTimeField(null=True, blank=True)

    is_active = models.BooleanField(default=True)
    is_staff = models.BooleanField(default=False)

    objects = UserManager()

    USERNAME_FIELD = "phone"
    REQUIRED_FIELDS = ["name"]

    class Meta:
        db_table = "user_account"
        ordering = ["name"]
        indexes = [models.Index(fields=["role"])]

    def __str__(self) -> str:
        return f"{self.name} ({self.phone})"

    def save(self, *args, **kwargs):
        self.phone = normalize_phone(self.phone)
        super().save(*args, **kwargs)

    # --- role helpers ----------------------------------------------------- #

    @property
    def role_label(self) -> str:
        return Role(self.role).label

    @property
    def is_read_only(self) -> bool:
        return self.role == Role.KCC_VIEWER and not self.is_superuser

    @property
    def scope_label(self) -> str:
        """The human string the UI badges, e.g. 'Ward 14' or 'City-wide'."""
        if self.scope_kind == ScopeKind.WARD:
            wards = list(self.scope_wards.all())
            if not wards:
                return "Assigned zone"
            if len(wards) == 1:
                return wards[0].short_label
            return f"{len(wards)} wards"
        if self.scope_kind == ScopeKind.ZONE:
            return f"Zone {self.scope_zone.removeprefix('Z-')}" if self.scope_zone else "Zone"
        return ScopeKind(self.scope_kind).label

    def visible_ward_ids(self) -> list[str] | None:
        """Ward ids this user may see; ``None`` means "no restriction"."""
        from swms.catalog.models import Ward

        if self.is_superuser or self.scope_kind in {ScopeKind.AGENCY, ScopeKind.CITY}:
            return None
        if self.scope_kind == ScopeKind.ZONE and self.scope_zone:
            return list(
                Ward.objects.filter(zone=self.scope_zone).values_list("id", flat=True)
            )
        ids = list(self.scope_wards.values_list("id", flat=True))
        return ids

    # --- PIN -------------------------------------------------------------- #

    @property
    def has_pin(self) -> bool:
        return bool(self.pin_hash)

    def set_pin(self, pin: str) -> None:
        self.pin_hash = make_password(pin)
        self.pin_set_at = timezone.now()
        self.pin_attempts = 0
        self.pin_locked_until = None

    def clear_pin(self) -> None:
        self.pin_hash = ""
        self.pin_set_at = None
        self.pin_attempts = 0
        self.pin_locked_until = None

    @property
    def pin_locked(self) -> bool:
        return bool(self.pin_locked_until and self.pin_locked_until > timezone.now())

    def check_pin(self, pin: str) -> bool:
        """Verify a PIN, tracking attempts and locking out after too many misses."""
        if not self.has_pin or self.pin_locked:
            return False
        if check_password(pin, self.pin_hash):
            self.pin_attempts = 0
            self.pin_locked_until = None
            self.save(update_fields=["pin_attempts", "pin_locked_until", "updated_at"])
            return True
        self.pin_attempts += 1
        if self.pin_attempts >= settings.PIN_MAX_ATTEMPTS:
            self.pin_locked_until = timezone.now() + timedelta(
                seconds=settings.PIN_LOCKOUT_SECONDS
            )
        self.save(update_fields=["pin_attempts", "pin_locked_until", "updated_at"])
        return False

    def reset_pin_attempts(self) -> None:
        if self.pin_attempts or self.pin_locked_until:
            self.pin_attempts = 0
            self.pin_locked_until = None
            self.save(update_fields=["pin_attempts", "pin_locked_until", "updated_at"])


class OtpCode(TimeStampedModel):
    """A single-use login code.

    The code itself is never stored — only a hash — so a database leak cannot be
    replayed. Rows are keyed by phone rather than user so unknown numbers can
    still be issued a code (the mock app auto-provisioned unknown operators, and
    that behaviour is preserved).
    """

    phone = models.CharField(max_length=15, db_index=True)
    code_hash = models.CharField(max_length=128)
    expires_at = models.DateTimeField()
    consumed_at = models.DateTimeField(null=True, blank=True)
    attempts = models.PositiveSmallIntegerField(default=0)
    requested_ip = models.GenericIPAddressField(null=True, blank=True)

    class Meta:
        db_table = "auth_otp_code"
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["phone", "-created_at"])]

    def __str__(self) -> str:
        return f"OTP {self.phone} (expires {self.expires_at:%H:%M})"

    @property
    def is_usable(self) -> bool:
        return self.consumed_at is None and self.expires_at > timezone.now() and self.attempts < 5

    def verify(self, code: str) -> bool:
        if not self.is_usable:
            return False
        if check_password(code, self.code_hash):
            self.consumed_at = timezone.now()
            self.save(update_fields=["consumed_at", "updated_at"])
            return True
        self.attempts += 1
        self.save(update_fields=["attempts", "updated_at"])
        return False

    @classmethod
    def issue(cls, phone: str, ip: str | None = None) -> tuple["OtpCode", str]:
        """Create a fresh code, invalidating any outstanding one for that phone."""
        phone = normalize_phone(phone)
        cls.objects.filter(phone=phone, consumed_at__isnull=True).update(
            consumed_at=timezone.now()
        )
        code = f"{secrets.randbelow(9000) + 1000}"
        row = cls.objects.create(
            phone=phone,
            code_hash=make_password(code),
            expires_at=timezone.now() + timedelta(seconds=settings.OTP_TTL_SECONDS),
            requested_ip=ip,
        )
        return row, code

    @classmethod
    def latest_for(cls, phone: str) -> "OtpCode | None":
        return (
            cls.objects.filter(phone=normalize_phone(phone), consumed_at__isnull=True)
            .order_by("-created_at")
            .first()
        )
