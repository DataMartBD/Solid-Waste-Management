"""Survey form and response endpoints."""

from __future__ import annotations

from django.db.models import Count
from django_filters import rest_framework as filters
from rest_framework.decorators import action
from rest_framework.response import Response

from swms.common.exceptions import DomainError
from swms.common.roles import OPERATIONAL_WRITERS, Role
from swms.common.permissions import IsAgencyAdmin
from swms.common.views import SwmsModelViewSet, SwmsReadOnlyViewSet

from .models import FormStatus, Survey, SurveyForm, SurveyStatus
from .serializers import (
    BulkSurveySerializer,
    ConvertSurveySerializer,
    RecordSurveySerializer,
    SurveyDetailSerializer,
    SurveyFormDetailSerializer,
    SurveyFormSerializer,
    SurveySerializer,
)
from .services import (
    _resolve_road,
    bulk_record_surveys,
    convert_survey,
    suggest_holding_type,
)


class SurveyFormViewSet(SwmsReadOnlyViewSet):
    """The questionnaires themselves.

    Read-only over the API: a form is loaded by `seed_survey_form` from a module
    under version control, so that the questions somebody was asked can be
    traced to a reviewed file rather than to whoever last opened the admin.

    Not scoped. A form is city-wide reference data, like the ward list — and an
    agency's surveyors need the form before they have anything to scope by.
    """

    serializer_class = SurveyFormSerializer
    filterset_fields = ["code", "status"]
    search_fields = ["code", "title", "title_bn", "organisation"]
    ordering_fields = ["code", "version", "title"]
    ward_scope_field = None
    agency_scope_field = None

    def get_queryset(self):
        # `annotate()` discards Meta.ordering (it would land in the GROUP BY),
        # and an unordered queryset paginates inconsistently — page 2 can repeat
        # a row from page 1. Restate it.
        return SurveyForm.objects.annotate(
            question_count=Count("questions", distinct=True),
            survey_count=Count("surveys", distinct=True),
        ).order_by("code", "-version")

    def get_serializer_class(self):
        # The list stays light; the detail carries every question, option and
        # rule, which is also what a device downloads to work offline.
        if self.action in ("retrieve", "published"):
            return SurveyFormDetailSerializer
        return SurveyFormSerializer

    def get_object(self):
        form = super().get_object()
        return self._with_content(form)

    def _with_content(self, form):
        """Re-fetch with the prefetches the detail shape needs.

        Rendering 72 questions with their options and rules is 4 queries this
        way and roughly 300 without.
        """
        return (
            self.get_queryset()
            .prefetch_related("questions__options", "questions__rules__options",
                              "questions__rules__depends_on")
            .get(pk=form.pk)
        )

    @action(detail=False, methods=["get"])
    def published(self, request):
        """`GET /api/survey-forms/published/?code=d2d-household`

        The newest published version of a form — what the field app asks for
        when it starts, without having to know which version is current.
        """
        forms = self.filter_queryset(self.get_queryset()).filter(
            status=FormStatus.PUBLISHED
        )
        code = request.query_params.get("code")
        if code:
            forms = forms.filter(code=code)
        form = forms.order_by("code", "-version").first()
        if form is None:
            raise DomainError(
                f"No published form{f' with code {code}' if code else ''}.",
                code="no_published_form",
            )
        serializer = self.get_serializer(self._with_content(form))
        return Response(serializer.data)


class SurveyFilter(filters.FilterSet):
    form = filters.CharFilter(field_name="form__code")
    ward = filters.CharFilter(field_name="ward_id")
    block = filters.CharFilter(field_name="block_id")
    surveyor = filters.CharFilter(field_name="surveyor_id")
    from_date = filters.DateFilter(field_name="surveyed_on", lookup_expr="gte")
    to_date = filters.DateFilter(field_name="surveyed_on", lookup_expr="lte")
    converted = filters.BooleanFilter(field_name="converted_to", lookup_expr="isnull",
                                      exclude=True)

    class Meta:
        model = Survey
        fields = ["form", "ward", "block", "surveyor", "status", "synced", "gives_to_van"]


class SurveyViewSet(SwmsModelViewSet):
    """Collected responses: list, detail, record, and the offline queue."""

    serializer_class = SurveySerializer
    filterset_class = SurveyFilter
    search_fields = [
        "id", "holding_no", "respondent_name", "respondent_phone", "road_name",
        # The list shows them, so `?search=` has to reach them — the page's own
        # box filters the page it was given, not the whole table.
        "district", "thana",
    ]
    ordering_fields = ["surveyed_on", "ward_id", "holding_no", "id"]
    ward_scope_field = "ward_id"
    agency_scope_field = "agency_id"
    write_roles = OPERATIONAL_WRITERS

    def get_queryset(self):
        queryset = Survey.objects.select_related(
            "form", "ward", "block", "surveyor", "converted_to"
        ).annotate(photo_total=Count("photos", distinct=True)).order_by(
            # Restated because `annotate()` drops Meta.ordering. See above.
            "-surveyed_on", "-created_at"
        )
        return self.scope_queryset(queryset)

    def get_serializer_class(self):
        if self.action == "retrieve":
            return SurveyDetailSerializer
        return SurveySerializer

    def get_object(self):
        survey = super().get_object()
        if self.action != "retrieve":
            return survey
        return (
            self.get_queryset()
            .prefetch_related("answers__question", "answers__option", "photos")
            .get(pk=survey.pk)
        )

    def create(self, request, *args, **kwargs):
        """Record one completed questionnaire."""
        serializer = RecordSurveySerializer(
            data=request.data, context=self.get_serializer_context()
        )
        serializer.is_valid(raise_exception=True)
        survey = serializer.save()
        return Response(SurveySerializer(self.get_queryset().get(pk=survey.pk)).data, status=201)

    @action(detail=False, methods=["post"])
    def bulk(self, request):
        """Upload a device's offline queue.

        Answers with per-row outcomes rather than one status code, so the device
        knows which rows it may drop and which to keep trying.
        """
        serializer = BulkSurveySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        rows = serializer.validated_data["rows"]
        if request.user.role == Role.COLLECTOR.value and request.user.collector_id:
            # A surveyor's own queue is their own work; the client does not get
            # to attribute it to somebody else.
            for row in rows:
                row["surveyor"] = request.user.collector_id
        return Response(bulk_record_surveys(rows, user=request.user))

    @action(detail=True, methods=["post"])
    def sync(self, request, pk=None):
        """Acknowledge that a queued record has reached the server."""
        survey = self.get_object()
        if not survey.synced:
            survey.synced = True
            survey.save(update_fields=["synced", "updated_at"])
        return Response(self.get_serializer(survey).data)

    @action(detail=True, methods=["post"])
    def review(self, request, pk=None):
        """Mark a survey checked, or reject it.

        A survey is what somebody was told at a door. Reviewing is the step
        where a supervisor says it is good enough to act on — nothing is
        promoted into the register before that.
        """
        survey = self.get_object()
        wanted = request.data.get("status", SurveyStatus.REVIEWED)
        if wanted not in (SurveyStatus.REVIEWED, SurveyStatus.REJECTED):
            raise DomainError(
                "A review sets 'reviewed' or 'rejected'.", code="bad_review_status"
            )
        if survey.status == SurveyStatus.CONVERTED:
            raise DomainError(
                f"{survey.id} has already been made into holding "
                f"{survey.converted_to_id}.", code="already_converted",
            )
        survey.status = wanted
        note = str(request.data.get("notes", "")).strip()
        if note:
            survey.notes = f"{survey.notes}\n{note}".strip()
        survey.save(update_fields=["status", "notes", "updated_at"])
        return Response(self.get_serializer(self.get_queryset().get(pk=survey.pk)).data)

    @action(detail=True, methods=["get"], url_path="convert-preview")
    def convert_preview(self, request, pk=None):
        """What converting this survey would create, before anybody commits.

        The register refuses an unknown road and needs a property type the
        survey may not imply, so the useful thing to hand the supervisor is not
        a form to guess at but a statement of which of those two are missing.
        """
        from swms.catalog.models import Road
        from swms.customers.models import Holding

        survey = self.get_object()
        road = None
        if survey.ward_id:
            road = _resolve_road(survey.ward, survey.road_name)

        clash = None
        if survey.ward_id and road and survey.holding_no:
            clash = Holding.objects.filter(
                ward_id=survey.ward_id, road=road, holding_no=survey.holding_no
            ).first()

        return Response({
            "survey": survey.id,
            "status": survey.status,
            "canConvert": survey.status == SurveyStatus.REVIEWED,
            "ward": survey.ward_id,
            "wardName": survey.ward.name if survey.ward_id else None,
            "holdingNo": survey.holding_no,
            "roadName": survey.road_name,
            # None means the surveyor's spelling matches no road in the ward and
            # the supervisor has to pick one.
            "road": road.id if road else None,
            "roadMatched": road.name if road else None,
            "roads": [
                {"id": r.id, "name": r.name}
                for r in Road.objects.filter(ward_id=survey.ward_id, active=True)
            ] if survey.ward_id else [],
            "holdingType": suggest_holding_type(survey),
            "ownerName": survey.owner_name or survey.respondent_name,
            "ownerPhone": survey.respondent_phone,
            "unitsTotal": survey.household_count,
            "hasLocation": survey.has_location,
            # An address already on the register: linking, not creating, is the
            # right answer and the UI should offer that instead.
            "existing": (
                {"id": clash.id, "ownerName": clash.owner_name} if clash else None
            ),
        })

    @action(detail=True, methods=["post"], permission_classes=[IsAgencyAdmin])
    def convert(self, request, pk=None):
        """Put a reviewed survey on the register as a holding.

        Agency-admin only. Creating a rated property is the moment a survey
        starts costing somebody money, and it is not a supervisor's call.
        """
        survey = self.get_object()
        serializer = ConvertSurveySerializer(
            data=request.data, context=self.get_serializer_context()
        )
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        holding, created = convert_survey(
            survey,
            holding_type=(
                data["holding_type"].id if data.get("holding_type") else None
            ),
            road=data.get("road"),
            holding_no=data.get("holding_no"),
            owner_name=data.get("owner_name"),
            owner_phone=data.get("owner_phone"),
            link=data.get("link") or None,
            user=request.user,
        )
        return Response({
            "survey": self.get_serializer(self.get_queryset().get(pk=survey.pk)).data,
            "holding": holding.id,
            "created": created,
        }, status=201 if created else 200)
