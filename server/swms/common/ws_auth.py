"""JWT authentication for websockets.

Browsers cannot set an Authorization header on a WebSocket handshake, so the
access token arrives as `?token=…`. The token is validated with the same
SimpleJWT machinery the REST API uses.
"""

from __future__ import annotations

from urllib.parse import parse_qs

from channels.db import database_sync_to_async
from django.contrib.auth import get_user_model
from django.contrib.auth.models import AnonymousUser
from rest_framework_simplejwt.exceptions import InvalidToken, TokenError
from rest_framework_simplejwt.tokens import AccessToken


@database_sync_to_async
def _user_from_token(raw: str):
    try:
        token = AccessToken(raw)
    except (InvalidToken, TokenError):
        return AnonymousUser()
    user_id = token.get("user_id")
    if not user_id:
        return AnonymousUser()
    User = get_user_model()
    try:
        return User.objects.get(pk=user_id, is_active=True)
    except User.DoesNotExist:
        return AnonymousUser()


class JWTAuthMiddleware:
    def __init__(self, inner):
        self.inner = inner

    async def __call__(self, scope, receive, send):
        query = parse_qs((scope.get("query_string") or b"").decode())
        raw = (query.get("token") or [""])[0]
        scope = dict(scope)
        scope["user"] = await _user_from_token(raw) if raw else AnonymousUser()
        return await self.inner(scope, receive, send)


def JWTAuthMiddlewareStack(inner):
    return JWTAuthMiddleware(inner)
