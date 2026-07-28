"""Sweep AI endpoints."""

from __future__ import annotations

from django.conf import settings
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework import serializers
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .context import build_facts
from .services import ask


class AskSerializer(serializers.Serializer):
    question = serializers.CharField(max_length=500, trim_whitespace=True)


class AskView(APIView):
    """`POST /api/ai/ask` — answer an operational question from live data."""

    permission_classes = [IsAuthenticated]
    throttle_scope = "ai"
    serializer_class = AskSerializer

    def post(self, request):
        serializer = AskSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        return Response(ask(serializer.validated_data["question"], user=request.user))


class FactsView(APIView):
    """`GET /api/ai/facts` — the snapshot the assistant reasons over.

    Exposed so the UI can show the same numbers the assistant quotes, and so the
    assistant's answers are auditable.
    """

    permission_classes = [IsAuthenticated]

    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request):
        return Response(
            {
                "facts": build_facts(request.user),
                "engine": "claude" if settings.ANTHROPIC_API_KEY else "rules",
                "model": settings.ANTHROPIC_MODEL if settings.ANTHROPIC_API_KEY else None,
            }
        )
