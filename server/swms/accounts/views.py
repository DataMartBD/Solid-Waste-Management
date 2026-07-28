"""Authentication: OTP login, PIN login, token refresh, logout, profile.

Both login paths that the React app offers are preserved, but the secrets now
live on the server: OTP codes are hashed single-use rows and PINs are hashed with
Django's password hasher. Lockout after too many PIN misses is enforced here
rather than in localStorage, where a user could simply clear it.
"""

from __future__ import annotations

from django.conf import settings
from django.contrib.auth import get_user_model
from django.utils import timezone
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.generics import RetrieveUpdateAPIView
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.exceptions import InvalidToken, TokenError
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenRefreshView

from swms.common.exceptions import DomainError
from swms.common.roles import Role

from .models import OtpCode, ScopeKind
from .serializers import (
    OtpRequestSerializer,
    OtpVerifySerializer,
    PinChangeSerializer,
    PinLoginSerializer,
    PinSetSerializer,
    ProfileUpdateSerializer,
    UserSerializer,
)

User = get_user_model()


def _client_ip(request) -> str | None:
    forwarded = request.META.get("HTTP_X_FORWARDED_FOR")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.META.get("REMOTE_ADDR")


def _tokens_for(user) -> dict:
    refresh = RefreshToken.for_user(user)
    return {"access": str(refresh.access_token), "refresh": str(refresh)}


def _session_response(user, request) -> Response:
    """Issue tokens and return them alongside the session user."""
    user.last_login = timezone.now()
    user.save(update_fields=["last_login"])
    return Response(
        {
            **_tokens_for(user),
            "user": UserSerializer(user, context={"request": request}).data,
        }
    )


def _provision(phone: str):
    """Find or create the operator for a phone number.

    The mock signed unknown numbers in as a generic 'Field Operator'; that is
    kept so field staff can be onboarded by an office user without a separate
    registration screen. New accounts get the least-privileged role.
    """
    user = User.objects.filter(phone=phone).first()
    if user:
        return user, True
    return (
        User.objects.create_user(
            phone=phone,
            name="Field Operator",
            role=Role.COLLECTOR,
            scope_kind=ScopeKind.WARD,
        ),
        False,
    )


class OtpRequestView(APIView):
    """Issue a login code for a phone number."""

    permission_classes = [AllowAny]
    throttle_scope = "otp"
    serializer_class = OtpRequestSerializer

    @extend_schema(request=OtpRequestSerializer, responses={200: None})
    def post(self, request):
        serializer = OtpRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        phone = serializer.validated_data["phone"]

        user = User.objects.filter(phone=phone, is_active=True).first()
        _row, code = OtpCode.issue(phone, ip=_client_ip(request))

        # `hasPin` and `pinLocked` ride along so the login screen can choose
        # between the PIN fast path and SMS without a second round trip.
        payload = {
            "phone": phone,
            "known": user is not None,
            "hasPin": bool(user and user.has_pin),
            "pinLocked": bool(user and user.pin_locked),
            "ttl": settings.OTP_TTL_SECONDS,
        }
        if settings.OTP_EXPOSE_CODE:
            # Dev/demo only — gated on DEBUG in settings. In production the code
            # goes out by SMS and never appears in an API response, and neither
            # does the operator's identity: that would let anyone put in a phone
            # number and learn whose it is.
            payload["devCode"] = code
            if user is not None:
                payload["operator"] = {"name": user.name, "role": user.role_label}
        return Response(payload)


class OtpVerifyView(APIView):
    """Exchange a valid code for a JWT pair."""

    permission_classes = [AllowAny]
    throttle_scope = "otp"
    serializer_class = OtpVerifySerializer

    @extend_schema(request=OtpVerifySerializer, responses={200: None})
    def post(self, request):
        serializer = OtpVerifySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        phone = serializer.validated_data["phone"]

        user, _existed = _provision(phone)
        if not user.is_active:
            raise DomainError("This account is disabled.", code="account_disabled")
        # A successful OTP clears any PIN lockout, matching the frontend's
        # "OTP is the recovery path" behaviour.
        user.reset_pin_attempts()
        return _session_response(user, request)


class PinStatusView(APIView):
    """Does this phone have a PIN, and is it currently locked out?"""

    permission_classes = [AllowAny]

    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request):
        from .phone import normalize_phone

        phone = normalize_phone(request.query_params.get("phone"))
        user = User.objects.filter(phone=phone).first() if phone else None
        if user is None:
            return Response(
                {"phone": phone, "known": False, "hasPin": False, "locked": False, "attemptsLeft": settings.PIN_MAX_ATTEMPTS}
            )
        return Response(
            {
                "phone": phone,
                "known": True,
                "hasPin": user.has_pin,
                "locked": user.pin_locked,
                "lockedUntil": user.pin_locked_until,
                "attemptsLeft": max(settings.PIN_MAX_ATTEMPTS - user.pin_attempts, 0),
            }
        )


class PinLoginView(APIView):
    """Sign in with phone + PIN."""

    permission_classes = [AllowAny]
    throttle_scope = "pin"
    serializer_class = PinLoginSerializer

    @extend_schema(request=PinLoginSerializer, responses={200: None})
    def post(self, request):
        serializer = PinLoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        phone = serializer.validated_data["phone"]

        user = User.objects.filter(phone=phone, is_active=True).first()
        # Same response whether the account is unknown or the PIN is wrong, so
        # this endpoint cannot be used to enumerate registered numbers.
        if user is None or not user.has_pin:
            raise DomainError("auth.wrongPin", code="wrong_pin")
        if user.pin_locked:
            raise DomainError("auth.pinLocked", code="pin_locked")
        if not user.check_pin(serializer.validated_data["pin"]):
            if user.pin_locked:
                raise DomainError("auth.pinLocked", code="pin_locked")
            raise DomainError("auth.wrongPin", code="wrong_pin")
        return _session_response(user, request)


class PinManageView(APIView):
    """Set, change or remove the signed-in user's PIN."""

    permission_classes = [IsAuthenticated]

    @extend_schema(request=PinSetSerializer, responses=OpenApiTypes.OBJECT)
    def post(self, request):
        serializer = PinSetSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = request.user
        user.set_pin(serializer.validated_data["pin"])
        user.save(
            update_fields=["pin_hash", "pin_set_at", "pin_attempts", "pin_locked_until", "updated_at"]
        )
        return Response({"hasPin": True})

    @extend_schema(request=PinChangeSerializer, responses=OpenApiTypes.OBJECT)
    def put(self, request):
        serializer = PinChangeSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = request.user
        if not user.has_pin:
            raise DomainError("auth.noPin", code="no_pin")
        if not user.check_pin(serializer.validated_data["currentPin"]):
            raise DomainError("auth.wrongPin", code="wrong_pin")
        user.set_pin(serializer.validated_data["pin"])
        user.save(
            update_fields=["pin_hash", "pin_set_at", "pin_attempts", "pin_locked_until", "updated_at"]
        )
        return Response({"hasPin": True})

    @extend_schema(responses=OpenApiTypes.OBJECT)
    def delete(self, request):
        user = request.user
        user.clear_pin()
        user.save(
            update_fields=["pin_hash", "pin_set_at", "pin_attempts", "pin_locked_until", "updated_at"]
        )
        return Response({"hasPin": False}, status=status.HTTP_200_OK)


class RefreshView(TokenRefreshView):
    """Rotate a refresh token.

    SimpleJWT handles rotation and blacklisting; this subclass only normalises
    the failure body to the app's `{detail, code, fields}` envelope so the
    frontend's interceptor has one shape to branch on.
    """

    permission_classes = [AllowAny]

    def post(self, request, *args, **kwargs):
        try:
            return super().post(request, *args, **kwargs)
        except (TokenError, InvalidToken):
            return Response(
                {"detail": "Session expired.", "code": "token_invalid", "fields": {}},
                status=status.HTTP_401_UNAUTHORIZED,
            )


class LogoutView(APIView):
    """Revoke a refresh token."""

    permission_classes = [IsAuthenticated]

    @extend_schema(request=OpenApiTypes.OBJECT, responses=OpenApiTypes.OBJECT)
    def post(self, request):
        raw = request.data.get("refresh")
        if raw:
            try:
                RefreshToken(raw).blacklist()
            except TokenError:
                pass  # Already expired or revoked — nothing left to do.
        return Response({"ok": True})


class MeView(RetrieveUpdateAPIView):
    """Read or edit the signed-in operator's own profile."""

    permission_classes = [IsAuthenticated]
    serializer_class = UserSerializer

    def get_object(self):
        return self.request.user

    def get_serializer_class(self):
        if self.request.method in ("PATCH", "PUT"):
            return ProfileUpdateSerializer
        return UserSerializer

    def update(self, request, *args, **kwargs):
        serializer = ProfileUpdateSerializer(
            request.user, data=request.data, partial=True, context={"request": request}
        )
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(UserSerializer(request.user, context={"request": request}).data)


class DemoOperatorsView(APIView):
    """The account list the login screen offers as demo shortcuts.

    Only served while DEBUG is on — it would be an account-enumeration endpoint
    in production.
    """

    permission_classes = [AllowAny]

    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request):
        if not settings.DEBUG:
            return Response([])
        # Superusers are excluded: the /admin account signs in with a password,
        # has no PIN, and is not one of the four operator personas being demoed.
        rows = (
            User.objects.filter(is_active=True, is_superuser=False)
            .prefetch_related("scope_wards")
            .order_by("role", "name")[:12]
        )
        return Response(
            [
                {
                    "phone": user.phone,
                    "name": user.name,
                    "role": user.role_label,
                    "scope": user.scope_label,
                }
                for user in rows
            ]
        )
