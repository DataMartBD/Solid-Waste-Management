"""Complaint endpoints.

The Complaints page filters, triages and mutates tickets; the Dashboard and
Reports read aggregates off the same rows. Both are served here.

Two things are deliberately not client-controlled. Status moves only through the
action endpoints below (so every move carries an audit entry), and the default
ordering is triage order rather than newest-first — an operator opening this list
should see the ticket that is hurting most at the top without touching a
control, which is what `triageSort` gave them in the browser.
"""

from __future__ import annotations

from statistics import median

from django.conf import settings
from django.db.models import Count
from django.db.models.functions import Coalesce
from django_filters import rest_framework as filters
from PIL import Image, UnidentifiedImageError
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response

from swms.common.exceptions import DomainError
from swms.common.roles import OPERATIONAL_WRITERS, Role
from swms.common.views import SwmsModelViewSet

from .models import ACTIVE_STATUSES, Complaint, ComplaintPhoto
from .serializers import (
    AdvanceSerializer,
    AssignSerializer,
    ComplaintCreateSerializer,
    ComplaintPhotoSerializer,
    ComplaintSerializer,
    NoteSerializer,
    PrioritySerializer,
    ResolveSerializer,
)
from .services import (
    add_note,
    advance,
    assign,
    change_priority,
    reopen,
    resolve_with,
    triage_order,
)

#: Pillow's own name for each format we accept, mapped back to its MIME type.
#: Used to cross-check the client's `content_type` against the actual bytes.
_PILLOW_FORMAT_MIME = {
    "JPEG": "image/jpeg",
    "PNG": "image/png",
    "WEBP": "image/webp",
}


def validate_image_upload(upload) -> str:
    """Reject anything that is not a small, decodable image of an allowed type.

    A `content_type` header is whatever the client chose to send, so it is
    checked *and then ignored*: Pillow has to decode the bytes before the file is
    stored. That closes the obvious hole where a script or a polyglot file
    arrives labelled `image/jpeg`, gets written under MEDIA_ROOT and is later
    served back to a browser.

    Returns the MIME type actually detected. The file pointer is left at 0 so
    the caller can still save the upload.
    """
    if upload.size > settings.MAX_UPLOAD_BYTES:
        limit_mb = settings.MAX_UPLOAD_BYTES / (1024 * 1024)
        raise DomainError(
            f"{upload.name} is {upload.size / (1024 * 1024):.1f} MB; the limit is "
            f"{limit_mb:.0f} MB.",
            code="file_too_large",
        )

    allowed = list(settings.ALLOWED_UPLOAD_TYPES)
    if upload.content_type not in allowed:
        raise DomainError(
            f"{upload.name} is a {upload.content_type or 'unknown'} file. "
            f"Allowed types: {', '.join(allowed)}.",
            code="unsupported_type",
        )

    try:
        image = Image.open(upload)
        # verify() reads the whole stream and raises on corrupt or non-image
        # data. It leaves the image unusable for further operations, but
        # `.format` survives, which is all we need.
        image.verify()
        detected = _PILLOW_FORMAT_MIME.get((image.format or "").upper())
    except (UnidentifiedImageError, OSError, ValueError, SyntaxError) as exc:
        raise DomainError(
            f"{upload.name} is not a readable image.", code="not_an_image"
        ) from exc
    finally:
        # Django has already consumed the stream; rewind so .save() stores it all.
        upload.seek(0)

    if detected not in allowed:
        raise DomainError(
            f"{upload.name} claims to be {upload.content_type} but its contents are "
            f"{detected or 'not an allowed image format'}.",
            code="content_type_mismatch",
        )
    return detected


class ComplaintFilter(filters.FilterSet):
    """Every query parameter the Complaints page, Dashboard and Reports use."""

    ward = filters.CharFilter(field_name="ward_id")
    zone = filters.CharFilter(field_name="ward__zone_id")
    assigned = filters.CharFilter(field_name="assigned_id")
    hh = filters.CharFilter(field_name="household_id")
    #: The page's all / active / done segmented control.
    active = filters.BooleanFilter(method="filter_active")
    breached = filters.BooleanFilter(method="filter_breached")
    opened_after = filters.DateFilter(field_name="opened", lookup_expr="date__gte")
    opened_before = filters.DateFilter(field_name="opened", lookup_expr="date__lte")

    class Meta:
        model = Complaint
        fields = ["ward", "zone", "status", "priority", "type", "channel", "assigned", "hh"]

    def filter_active(self, queryset, name, value):
        if value:
            return queryset.filter(status__in=list(ACTIVE_STATUSES))
        return queryset.exclude(status__in=list(ACTIVE_STATUSES))

    def filter_breached(self, queryset, name, value):
        """Filter on the same annotation the triage ordering sorts by.

        `get_queryset()` always runs the queryset through `triage_order()`, so
        `_breached` is present — one definition of "over SLA", used by the sort,
        this filter and the summary counts alike.
        """
        return queryset.filter(_breached=value)


class ComplaintViewSet(SwmsModelViewSet):
    """Tickets, their lifecycle actions and the KPI summary."""

    serializer_class = ComplaintSerializer
    filterset_class = ComplaintFilter
    search_fields = ["id", "household__head", "household__id", "description"]
    #: Ordering is triage order unless the client asks for something else.
    ordering_fields = ["opened", "priority", "status", "sla", "id"]
    ward_scope_field = "ward_id"
    agency_scope_field = "household__holding__agency_id"
    # Collectors add notes and progress the jobs on their own round; ward scoping
    # already stops them seeing another ward's tickets.
    write_roles = OPERATIONAL_WRITERS | {Role.COLLECTOR}

    def get_queryset(self):
        queryset = Complaint.objects.select_related(
            "household", "household__road", "ward", "ward__zone", "assigned"
        ).prefetch_related("activity", "photos")
        return triage_order(self.scope_queryset(queryset))

    def get_serializer_class(self):
        # Creating derives the SLA and writes the `created` entry; see the
        # serializer's docstring.
        if self.action == "create":
            return ComplaintCreateSerializer
        return ComplaintSerializer

    # --- helpers ----------------------------------------------------------- #

    def _payload(self, data, serializer_class):
        serializer = serializer_class(data=data)
        serializer.is_valid(raise_exception=True)
        return serializer.validated_data

    def _fresh(self, complaint):
        """Re-read through the list queryset so computed fields are consistent."""
        return Response(self.get_serializer(self.get_queryset().get(pk=complaint.pk)).data)

    # --- lifecycle actions ------------------------------------------------- #

    @action(detail=True, methods=["post"])
    def assign(self, request, pk=None):
        """Hand the ticket to a collector (or back to the unassigned pool)."""
        complaint = self.get_object()
        data = self._payload(request.data, AssignSerializer)
        assign(complaint, data["assigned"], user=request.user, note=data["note"])
        return self._fresh(complaint)

    @action(detail=True, methods=["post"])
    def advance(self, request, pk=None):
        """Move one step along the lifecycle."""
        complaint = self.get_object()
        data = self._payload(request.data, AdvanceSerializer)
        advance(complaint, user=request.user, note=data["note"])
        return self._fresh(complaint)

    @action(detail=True, methods=["post"])
    def resolve(self, request, pk=None):
        """Resolve now, recording how it was resolved."""
        complaint = self.get_object()
        data = self._payload(request.data, ResolveSerializer)
        resolve_with(complaint, data["note"], user=request.user)
        return self._fresh(complaint)

    @action(detail=True, methods=["post"])
    def reopen(self, request, pk=None):
        """The citizen says it is not fixed. Restart the clock."""
        complaint = self.get_object()
        data = self._payload(request.data, AdvanceSerializer)
        reopen(complaint, user=request.user, note=data["note"])
        return self._fresh(complaint)

    @action(detail=True, methods=["post"])
    def priority(self, request, pk=None):
        """Re-grade the ticket; its SLA budget follows."""
        complaint = self.get_object()
        data = self._payload(request.data, PrioritySerializer)
        change_priority(complaint, data["priority"], user=request.user, note=data["note"])
        return self._fresh(complaint)

    @action(detail=True, methods=["post"])
    def note(self, request, pk=None):
        """Append a comment to the trail without changing the ticket."""
        complaint = self.get_object()
        data = self._payload(request.data, NoteSerializer)
        add_note(complaint, data["note"], user=request.user)
        return self._fresh(complaint)

    # --- evidence ---------------------------------------------------------- #

    @action(
        detail=True,
        methods=["post"],
        parser_classes=[MultiPartParser, FormParser],
    )
    def photos(self, request, pk=None):
        """Attach one or many photos.

        The collector app posts several at once from the camera roll, so any
        number of parts is accepted. Every file is validated *before* the first
        one is stored, so a rejected batch leaves nothing behind on disk.
        """
        complaint = self.get_object()
        files = request.FILES.getlist("images") or request.FILES.getlist("image")
        if not files:
            # Fall back to whatever field names the client used.
            files = [f for values in request.FILES.lists() for f in values[1]]
        if not files:
            raise DomainError("Attach at least one image.", code="no_file")

        for upload in files:
            validate_image_upload(upload)

        caption = (request.data.get("caption") or "").strip()
        created = [
            ComplaintPhoto.objects.create(
                complaint=complaint,
                image=upload,
                caption=caption,
                uploaded_by=request.user if request.user.is_authenticated else None,
            )
            for upload in files
        ]
        # Evidence arriving is part of the ticket's history, so it lands in the
        # trail like every other change.
        add_note(
            complaint,
            caption or f"{len(created)} photo(s) attached.",
            user=request.user,
        )
        return Response(
            {
                "photos": ComplaintPhotoSerializer(
                    created, many=True, context=self.get_serializer_context()
                ).data,
                "complaint": self.get_serializer(
                    self.get_queryset().get(pk=complaint.pk)
                ).data,
            },
            status=201,
        )

    # --- aggregates -------------------------------------------------------- #

    @action(detail=False, methods=["get"])
    def summary(self, request):
        """KPI counts for the Dashboard cards and the Reports page.

        Honours the same filters as the list, so "breached tickets in Ward 14
        this month" is one request rather than downloading the rows and counting
        them in the browser (which is what the mock's `stats` memo did).
        """
        # order_by() is essential: the triage sort keys would otherwise join the
        # GROUP BY and split every count into one row per ticket.
        base = self.filter_queryset(self.get_queryset()).order_by()

        def tally(field):
            return {
                row[field]: row["n"] for row in base.values(field).annotate(n=Count("id"))
            }

        by_status = tally("status")
        by_priority = tally("priority")
        by_type = tally("type")
        active = sum(by_status.get(s, 0) for s in ACTIVE_STATUSES)
        total = sum(by_status.values())

        # No portable median aggregate exists in the ORM (Postgres could do it
        # with percentile_cont via raw SQL). The settled set for a filtered view
        # is small and this is a KPI card, so it is computed here.
        settled = (
            base.annotate(_settled_at=Coalesce("resolved_at", "closed_at"))
            .filter(_settled_at__isnull=False)
            .values_list("opened", "_settled_at")
        )
        hours = [(end - start).total_seconds() / 3600 for start, end in settled]

        return Response(
            {
                "total": total,
                "active": active,
                "settled": total - active,
                "byStatus": by_status,
                "byPriority": by_priority,
                "byType": by_type,
                "breached": base.filter(_breached=True).count(),
                "urgent": base.filter(
                    status__in=list(ACTIVE_STATUSES), priority="urgent"
                ).count(),
                "medianResolutionHours": round(median(hours), 1) if hours else None,
                "resolvedCount": len(hours),
            }
        )
