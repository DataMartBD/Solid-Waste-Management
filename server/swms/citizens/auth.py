"""Citizen tokens, kept apart from staff tokens.

A citizen token is a SimpleJWT token of its own type (`citizen`) carrying a
`citizen_id`. Staff authentication only accepts `access` tokens, and this one
only accepts `citizen` tokens, so neither can be used on the other's API — a
citizen id can never be read as a staff user id.
"""

from __future__ import annotations

import datetime as dt

from rest_framework_simplejwt.authentication import JWTAuthentication
from rest_framework_simplejwt.exceptions import AuthenticationFailed, InvalidToken, TokenError
from rest_framework_simplejwt.tokens import Token

from .models import CitizenAccount


class CitizenToken(Token):
    token_type = "citizen"
    #: No refresh token: a citizen simply signs in again with their PIN.
    lifetime = dt.timedelta(days=30)

    @classmethod
    def for_citizen(cls, citizen: CitizenAccount) -> "CitizenToken":
        token = cls()
        token["citizen_id"] = citizen.pk
        return token


class CitizenAuthentication(JWTAuthentication):
    def get_validated_token(self, raw_token):
        try:
            return CitizenToken(raw_token)
        except TokenError as exc:
            raise InvalidToken({"detail": "Please sign in again.", "code": "token_not_valid"}) from exc

    def get_user(self, validated_token):
        citizen = CitizenAccount.objects.filter(
            pk=validated_token.get("citizen_id"), active=True
        ).first()
        if citizen is None:
            raise AuthenticationFailed("This account is not active.", code="citizen_inactive")
        return citizen
