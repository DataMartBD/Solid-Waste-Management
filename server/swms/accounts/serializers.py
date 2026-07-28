"""Auth and profile serializers.

`UserSerializer` emits exactly the session shape the React app already stores:
`{ phone, name, role, scope, email, altPhone, nid, bloodGroup, emergencyContact,
loginAt }` — plus a few additions the mock could not provide (`roleKey`,
`hasPin`, `collector`, `home`).
"""

from __future__ import annotations

from django.conf import settings
from rest_framework import serializers

from swms.common.roles import ROLE_HOME, Role

from .models import OtpCode, User
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
