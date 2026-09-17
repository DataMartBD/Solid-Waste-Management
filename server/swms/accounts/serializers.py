"""Auth and profile serializers.

`UserSerializer` emits exactly the session shape the React app already stores:
`{ phone, name, role, scope, email, altPhone, nid, bloodGroup, emergencyContact,
loginAt }` — plus a few additions the mock could not provide (`roleKey`,
`hasPin`, `collector`, `home`).
"""

from __future__ import annotations

from django.conf import settings
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers
from rest_framework.validators import UniqueValidator

from swms.agencies.models import Agency
from swms.catalog.models import Ward
from swms.common.roles import ROLE_HOME, Role
from swms.common.scoping import caller, guard_agency

from .models import OtpCode, ScopeKind, User
from .phone import is_valid_phone, normalize_phone
from .validators import validate_pin


class PhoneField(serializers.CharField):
    """Accepts any of `+8801711-000042`, `8801711000042`, `01711000042`."""

    def to_internal_value(self, data):
        value = normalize_phone(super().to_internal_value(data))
        if not is_valid_phone(value):
            raise serializers.ValidationError("Enter a valid Bangladeshi mobile number.")
        return value


class UserSerializer(serializers.ModelSerializer):
    """The signed-in operator, as the SPA's AuthContext expects it."""

    role = serializers.CharField(source="role_label", read_only=True)
    roleKey = serializers.CharField(source="role", read_only=True)
    scope = serializers.CharField(source="scope_label", read_only=True)
    scopeKind = serializers.CharField(source="scope_kind", read_only=True)
    scopeWards = serializers.SlugRelatedField(
        source="scope_wards", slug_field="id", many=True, read_only=True
    )
    altPhone = serializers.CharField(source="alt_phone", required=False, allow_blank=True)
    bloodGroup = serializers.CharField(source="blood_group", required=False, allow_blank=True)
    emergencyContact = serializers.CharField(
        source="emergency_contact", required=False, allow_blank=True
    )
    loginAt = serializers.DateTimeField(source="last_login", read_only=True)
    hasPin = serializers.BooleanField(source="has_pin", read_only=True)
    collector = serializers.CharField(source="collector_id", read_only=True)
    #: Which contractor this account belongs to, or null for KCC's own staff.
    #: Now that agency is an access boundary the session has to carry it: a page
    #: that asks the operator which agency a new building belongs to should not
    #: ask somebody who has no choice in the matter.
    agency = serializers.CharField(source="agency_id", read_only=True, default=None)
    home = serializers.SerializerMethodField()
    readOnly = serializers.BooleanField(source="is_read_only", read_only=True)
    avatarUrl = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            "id",
            "phone",
            "name",
            "role",
            "roleKey",
            "scope",
            "scopeKind",
            "scopeWards",
            "email",
            "altPhone",
            "nid",
            "bloodGroup",
            "emergencyContact",
            "loginAt",
            "hasPin",
            "collector",
            "agency",
            "home",
            "readOnly",
            "avatarUrl",
        ]
        read_only_fields = ["id", "phone"]

    def get_home(self, obj) -> str:
        return ROLE_HOME.get(Role(obj.role), "/app/dashboard")

    def get_avatarUrl(self, obj) -> str | None:
        if not obj.avatar:
            return None
        request = self.context.get("request")
        url = obj.avatar.url
        return request.build_absolute_uri(url) if request else url


class ProfileUpdateSerializer(serializers.ModelSerializer):
    """The Profile page may edit contact details — never role or scope."""

    altPhone = serializers.CharField(source="alt_phone", required=False, allow_blank=True)
    bloodGroup = serializers.CharField(source="blood_group", required=False, allow_blank=True)
    emergencyContact = serializers.CharField(
        source="emergency_contact", required=False, allow_blank=True
    )

    class Meta:
        model = User
        fields = ["name", "email", "altPhone", "nid", "bloodGroup", "emergencyContact", "avatar"]
        extra_kwargs = {"name": {"required": False}}


# --------------------------------------------------------------------------- #
# Password
# --------------------------------------------------------------------------- #


class PasswordLoginSerializer(serializers.Serializer):
    """Phone + password — the only sign-in path the login screen offers."""

    phone = PhoneField()
    # `trim_whitespace=False`: a trailing space is part of the password, and
    # silently stripping it would reject a password that was set with one.
    password = serializers.CharField(
        trim_whitespace=False, style={"input_type": "password"}, write_only=True
    )


class PasswordChangeSerializer(serializers.Serializer):
    """Change the signed-in user's own password."""

    currentPassword = serializers.CharField(trim_whitespace=False, write_only=True)
    password = serializers.CharField(trim_whitespace=False, write_only=True)

    def validate_password(self, value):
        # Runs the AUTH_PASSWORD_VALIDATORS already configured in settings —
        # minimum length, too-common, and all-numeric. Passing `user` lets the
        # similarity validator reject a password that echoes the name or phone.
        try:
            validate_password(value, user=self.context.get("user"))
        except DjangoValidationError as exc:
            raise serializers.ValidationError(list(exc.messages)) from exc
        return value

    def validate(self, attrs):
        if attrs["currentPassword"] == attrs["password"]:
            raise serializers.ValidationError({"password": "profile.passwordUnchanged"})
        return attrs


# --------------------------------------------------------------------------- #
# OTP
# --------------------------------------------------------------------------- #


class OtpRequestSerializer(serializers.Serializer):
    phone = PhoneField()


class OtpVerifySerializer(serializers.Serializer):
    phone = PhoneField()
    code = serializers.RegexField(r"^\d{4}$")

    def validate(self, attrs):
        row = OtpCode.latest_for(attrs["phone"])
        if row is None:
            raise serializers.ValidationError({"code": "auth.otpExpired"})
        if not row.is_usable:
            raise serializers.ValidationError({"code": "auth.otpExpired"})
        if not row.verify(attrs["code"]):
            raise serializers.ValidationError({"code": "auth.wrongOtp"})
        attrs["otp"] = row
        return attrs


# --------------------------------------------------------------------------- #
# PIN
# --------------------------------------------------------------------------- #


class PinField(serializers.CharField):
    def to_internal_value(self, data):
        value = super().to_internal_value(data)
        error = validate_pin(value)
        if error:
            raise serializers.ValidationError(f"auth.{error}")
        return value


class PinLoginSerializer(serializers.Serializer):
    phone = PhoneField()
    # Not PinField: a login attempt must not leak *why* a PIN is unacceptable.
    pin = serializers.RegexField(rf"^\d{{{settings.PIN_LENGTH}}}$")


class PinSetSerializer(serializers.Serializer):
    pin = PinField()


class PinChangeSerializer(serializers.Serializer):
    currentPin = serializers.CharField()
    pin = PinField()

    def validate(self, attrs):
        if attrs["currentPin"] == attrs["pin"]:
            raise serializers.ValidationError({"pin": "auth.pinUnchanged"})
        return attrs


# --------------------------------------------------------------------------- #
# User administration
# --------------------------------------------------------------------------- #


class UserAdminSerializer(serializers.ModelSerializer):
    """Creating and editing operators, from the Users page.

    Separate from `UserSerializer` on purpose. That one is the *session* shape —
    the signed-in user reading themselves, with phone, role and scope read-only
    because nobody may promote themselves. This one is an administrator acting
    on somebody else, so those are exactly the fields it must be able to write.

    What it still refuses is in `validate`: an admin may not edit their own role,
    scope or active flag. Not because it is dangerous in itself, but because the
    account doing it is the one that would have to undo it — a city with one
    agency admin who demotes themselves has nobody left who can put it back.
    """

    role = serializers.ChoiceField(choices=Role.choices)
    roleLabel = serializers.CharField(source="role_label", read_only=True)
    #: Declaring the field explicitly replaces the one ModelSerializer would have
    #: built, and takes its uniqueness check with it — leaving the clash to
    #: surface as a database IntegrityError, which the form cannot attach to a
    #: field. The validator is put back by hand, against the *normalised* number
    #: so `+8801911…` and `01911…` collide as they should.
    phone = PhoneField(validators=[UniqueValidator(queryset=User.objects.all())])
    scopeKind = serializers.ChoiceField(
        source="scope_kind", choices=ScopeKind.choices, required=False
    )
    scopeZone = serializers.CharField(
        source="scope_zone", required=False, allow_blank=True, max_length=8
    )
    scopeWards = serializers.PrimaryKeyRelatedField(
        source="scope_wards", queryset=Ward.objects.all(), many=True, required=False
    )
    scope = serializers.CharField(source="scope_label", read_only=True)
    altPhone = serializers.CharField(source="alt_phone", required=False, allow_blank=True)
    bloodGroup = serializers.CharField(source="blood_group", required=False, allow_blank=True)
    emergencyContact = serializers.CharField(
        source="emergency_contact", required=False, allow_blank=True
    )
    isActive = serializers.BooleanField(source="is_active", required=False)
    #: Write-only, and required only on create: phone + password is the only way
    #: the sign-in screen offers, so an account made without one could not be
    #: used. On edit it is a reset — absent means "leave the password alone".
    password = serializers.CharField(
        write_only=True, required=False, trim_whitespace=False, style={"input_type": "password"}
    )
    hasPin = serializers.BooleanField(source="has_pin", read_only=True)
    lastLogin = serializers.DateTimeField(source="last_login", read_only=True)

    class Meta:
        model = User
        fields = [
            "id", "phone", "name", "role", "roleLabel",
            "scopeKind", "scopeZone", "scopeWards", "scope",
            "agency", "collector",
            "email", "altPhone", "nid", "bloodGroup", "emergencyContact",
            "isActive", "password", "hasPin", "lastLogin",
        ]
        read_only_fields = ["id"]

    def validate_password(self, value):
        # The same validators the Profile page's change-password already runs —
        # an account created here must not be weaker than one whose owner
        # changed their own password.
        try:
            validate_password(value)
        except DjangoValidationError as exc:
            raise serializers.ValidationError(list(exc.messages)) from exc
        return value

    def validate_agency(self, agency):
        """An agency-bound admin may only place users in their own agency."""
        guard_agency(self, agency.id if agency else None)
        return agency

    def validate(self, attrs):
        attrs = super().validate(attrs)
        me = caller(self)
        self._check_agency_boundary(attrs, me)

        if self.instance is None and not attrs.get("password"):
            raise serializers.ValidationError(
                {"password": "A password is required — it is how this account signs in."}
            )

        # Editing yourself: contact details yes, your own authority no.
        if me is not None and self.instance is not None and self.instance.pk == me.pk:
            locked = {
                "role": "role", "scope_kind": "scopeKind", "scope_zone": "scopeZone",
                "scope_wards": "scopeWards", "is_active": "isActive", "agency": "agency",
            }
            for field, key in locked.items():
                if field not in attrs:
                    continue
                current = getattr(self.instance, field)
                given = attrs[field]
                if field == "scope_wards":
                    if {w.pk for w in given} == {w.pk for w in current.all()}:
                        continue
                elif given == current:
                    continue
                raise serializers.ValidationError(
                    {key: "You cannot change your own access. Ask another administrator."}
                )

        # A ward scope with no wards is not a narrow scope, it is an empty one:
        # `visible_ward_ids` returns [] and the user sees nothing anywhere, with
        # nothing on screen to say why.
        #
        # Only checked when the scope is actually being set. Re-validating what
        # is already stored would make an account that somehow has an empty ward
        # scope impossible to edit at all — including impossible to *fix*, since
        # renaming the person would fail on a field the form never sent.
        touching_scope = (
            self.instance is None
            or "scope_kind" in attrs or "scope_wards" in attrs or "scope_zone" in attrs
        )
        if not touching_scope:
            return attrs

        kind = attrs.get("scope_kind", getattr(self.instance, "scope_kind", None))
        if kind == ScopeKind.WARD:
            wards = attrs.get("scope_wards")
            if wards is None and self.instance is not None:
                wards = list(self.instance.scope_wards.all())
            if not wards:
                raise serializers.ValidationError(
                    {"scopeWards": "Choose at least one ward, or pick a wider scope."}
                )
        if kind == ScopeKind.ZONE and not (
            attrs.get("scope_zone", getattr(self.instance, "scope_zone", ""))
        ):
            raise serializers.ValidationError({"scopeZone": "Choose a zone."})
        return attrs

    def _check_agency_boundary(self, attrs, me):
        """Keep the agency boundary from being escaped through this form.

        Three rules, and the order matters.

        **Only a super admin may grant the unconfined role.** Checked first, so
        an agency admin attempting it is told that — rather than being told
        something about an agency they never filled in, which is what happened
        when the defaulting below ran ahead of this.

        **A super admin has no agency and an agency admin must have one.** The
        column is what confines a tenant: blank, `visible_agency_id()` answers
        the same as it does for a super admin, and the role becomes a label
        rather than a boundary. The pairing is therefore required in both
        directions rather than merely expected.

        **A blank agency means the creator's own.** Only for a role that may
        have one, and only when the creator has one themselves. Left alone it
        would mean *unconfined* — an account wider than the person making it,
        the one shape this form must never produce.
        """
        role = attrs.get("role", getattr(self.instance, "role", None))

        if role == Role.SUPER_ADMIN:
            granting = "role" in attrs and (
                self.instance is None or self.instance.role != Role.SUPER_ADMIN
            )
            if granting and me is not None and me.role != Role.SUPER_ADMIN.value:
                raise serializers.ValidationError(
                    {"role": "Only a super administrator can grant that role."}
                )
            if attrs.get("agency") or getattr(self.instance, "agency_id", None):
                raise serializers.ValidationError(
                    {"agency": "A super administrator belongs to no agency."}
                )
            return

        mine = me.visible_agency_id() if me is not None else None
        if mine is not None and not attrs.get("agency"):
            attrs["agency"] = Agency.objects.get(pk=mine)

        # Only when the pairing is actually being set. Accounts predating this
        # release are agency admins with no agency; re-checking what is already
        # stored would make every one of them uneditable, including uneditable
        # by the administrator trying to give them the agency that fixes it.
        if self.instance is not None and "role" not in attrs and "agency" not in attrs:
            return

        agency = attrs.get("agency", getattr(self.instance, "agency", None))
        if role == Role.AGENCY_ADMIN and agency is None:
            raise serializers.ValidationError(
                {"agency": "An agency administrator must belong to an agency — "
                           "it is what limits them to it."}
            )

    def _apply_password(self, user, password):
        if password:
            user.set_password(password)
            user.save(update_fields=["password"])

    def create(self, validated_data):
        password = validated_data.pop("password", None)
        wards = validated_data.pop("scope_wards", [])
        user = User(**validated_data)
        user.set_password(password)
        user.save()
        user.scope_wards.set(wards)
        return user

    def update(self, instance, validated_data):
        password = validated_data.pop("password", None)
        user = super().update(instance, validated_data)
        self._apply_password(user, password)
        return user
