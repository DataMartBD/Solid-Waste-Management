"""Survey wire formats.

Two shapes, for two different readers:

* the **form** shape (`SurveyFormDetailSerializer`) is what a device downloads
  once and then renders offline — questions, options, rules, all of it;
* the **survey** shape is one collected response, either summarised for the list
  or expanded with its answers for the detail drawer.

Writing goes through `RecordSurveySerializer`, which validates the envelope and
hands the answers to `services.record_survey`. It deliberately does *not* declare
a field per question: the questions are data, and a serializer that knew them
would have to be regenerated every time a form was revised.
"""

from __future__ import annotations

from rest_framework import serializers

from swms.catalog.models import Block, HoldingType, Road, Ward
from swms.common.scoping import guard, guard_ward
from swms.customers.models import Holding
from swms.fieldops.models import Collector

from .models import (
    Answer,
    OptionSource,
    Question,
    QuestionOption,
    QuestionRule,
    Survey,
    SurveyForm,
    SurveyPhoto,
    SurveyStatus,
)
from .services import record_survey


class QuestionOptionSerializer(serializers.ModelSerializer):
    class Meta:
        model = QuestionOption
        fields = ["code", "label", "label_bn", "is_other"]


class QuestionRuleSerializer(serializers.ModelSerializer):
    """A display rule, flattened to codes so the client needs no id lookups."""

    dependsOn = serializers.CharField(source="depends_on.code", read_only=True)
    options = serializers.SerializerMethodField()

    class Meta:
        model = QuestionRule
        fields = ["dependsOn", "operator", "options"]

    def get_options(self, rule) -> list:
        return [option.code for option in rule.options.all()]


class QuestionSerializer(serializers.ModelSerializer):
    options = QuestionOptionSerializer(many=True, read_only=True)
    rules = QuestionRuleSerializer(many=True, read_only=True)
    optionsSource = serializers.CharField(source="options_source", read_only=True)
    textBn = serializers.CharField(source="text_bn", read_only=True)
    hintBn = serializers.CharField(source="hint_bn", read_only=True)
    mapsTo = serializers.CharField(source="maps_to", read_only=True)
    minValue = serializers.IntegerField(source="min_value", read_only=True)
    maxValue = serializers.IntegerField(source="max_value", read_only=True)

    class Meta:
        model = Question
        fields = [
            "code", "number", "section", "kind", "text", "textBn", "hint", "hintBn",
            "required", "width", "minValue", "maxValue", "mapsTo", "optionsSource",
            "options", "rules",
        ]


class SurveyFormSerializer(serializers.ModelSerializer):
    """The list row — enough to choose a form, without its 72 questions."""

    titleBn = serializers.CharField(source="title_bn", read_only=True)
    questionCount = serializers.IntegerField(source="question_count", read_only=True)
    surveyCount = serializers.IntegerField(source="survey_count", read_only=True)

    class Meta:
        model = SurveyForm
        fields = [
            "id", "code", "version", "title", "titleBn", "organisation",
            "description", "status", "questionCount", "surveyCount",
        ]


class SurveyFormDetailSerializer(SurveyFormSerializer):
    """The whole questionnaire, for rendering and for offline download."""

    questions = QuestionSerializer(many=True, read_only=True)

    class Meta(SurveyFormSerializer.Meta):
        fields = SurveyFormSerializer.Meta.fields + ["questions"]


class AnswerSerializer(serializers.ModelSerializer):
    question = serializers.CharField(source="question.code", read_only=True)
    #: What was actually asked. Without it a reader of one survey gets a column
    #: name — "holding_no", "gives_to_van" — where the question should be, and
    #: the point of keeping the answer log is that it records the conversation.
    #: `questionNumber`, not `number`: that key is the numeric *answer*.
    questionNumber = serializers.CharField(source="question.number", read_only=True)
    questionText = serializers.CharField(source="question.text", read_only=True)
    questionTextBn = serializers.CharField(source="question.text_bn", read_only=True)
    number = serializers.CharField(read_only=True)
    option = serializers.CharField(source="option.code", read_only=True, default=None)
    label = serializers.CharField(source="option.label", read_only=True, default=None)
    labelBn = serializers.CharField(source="option.label_bn", read_only=True, default=None)

    class Meta:
        model = Answer
        fields = [
            "question", "questionNumber", "questionText", "questionTextBn",
            "option", "label", "labelBn", "text", "number", "date",
        ]


class SurveyPhotoSerializer(serializers.ModelSerializer):
    class Meta:
        model = SurveyPhoto
        fields = ["id", "image", "caption"]
        read_only_fields = ["id"]


class SurveySerializer(serializers.ModelSerializer):
    """One collected response, as the list shows it."""

    formCode = serializers.CharField(source="form.code", read_only=True)
    formVersion = serializers.IntegerField(source="form.version", read_only=True)
    surveyedOn = serializers.DateField(source="surveyed_on", read_only=True)
    surveyorName = serializers.SerializerMethodField()
    # District and thana are names, so unlike ward and block there is no second
    # "…Name" key to send — the stored value is already what a reader wants.
    ward = serializers.CharField(source="ward_id", read_only=True, default=None)
    wardName = serializers.CharField(source="ward.name", read_only=True, default=None)
    block = serializers.CharField(source="block_id", read_only=True, default=None)
    blockName = serializers.CharField(source="block.name", read_only=True, default=None)
    roadName = serializers.CharField(source="road_name", read_only=True)
    holdingNo = serializers.CharField(source="holding_no", read_only=True)
    respondentName = serializers.CharField(source="respondent_name", read_only=True)
    respondentPhone = serializers.CharField(source="respondent_phone", read_only=True)
    premisesType = serializers.CharField(source="premises_type", read_only=True)
    householdCount = serializers.IntegerField(source="household_count", read_only=True)
    dailyWasteKg = serializers.DecimalField(
        source="daily_waste_kg", max_digits=7, decimal_places=2, read_only=True
    )
    givesToVan = serializers.BooleanField(source="gives_to_van", read_only=True)
    monthlyFee = serializers.IntegerField(source="monthly_fee", read_only=True)
    willingFee = serializers.IntegerField(source="willing_fee", read_only=True)
    #: Where the survey came *from*; `convertedTo` is what it later became.
    holding = serializers.CharField(source="holding_id", read_only=True, default=None)
    convertedTo = serializers.CharField(source="converted_to_id", read_only=True, default=None)
    photoCount = serializers.IntegerField(source="photo_total", read_only=True)

    class Meta:
        model = Survey
        fields = [
            "id", "formCode", "formVersion", "status", "synced", "surveyedOn",
            "surveyorName", "district", "thana",
            "ward", "wardName", "block", "blockName", "roadName",
            "holdingNo", "respondentName", "respondentPhone", "premisesType",
            "householdCount", "dailyWasteKg", "givesToVan", "monthlyFee",
            "willingFee", "lat", "lng", "accuracy", "notes",
            "holding", "convertedTo", "photoCount",
        ]

    def get_surveyorName(self, survey) -> str:
        """The collector's name when there is one, else what the form said."""
        return survey.surveyor.name if survey.surveyor_id else survey.surveyor_name


class SurveyDetailSerializer(SurveySerializer):
    answers = AnswerSerializer(many=True, read_only=True)
    photos = SurveyPhotoSerializer(many=True, read_only=True)

    class Meta(SurveySerializer.Meta):
        fields = SurveySerializer.Meta.fields + ["answers", "photos"]


class RecordSurveySerializer(serializers.Serializer):
    """A completed questionnaire arriving from the field.

    `answers` is `{question_code: value}` — the only workable shape when the
    questions are rows in a table. Per-question validation lives in
    `services.record_survey`, which has the form in front of it.
    """

    form = serializers.PrimaryKeyRelatedField(queryset=SurveyForm.objects.all())
    answers = serializers.DictField(allow_empty=False)
    surveyor = serializers.PrimaryKeyRelatedField(
        queryset=Collector.objects.all(), required=False, allow_null=True
    )
    surveyorName = serializers.CharField(
        source="surveyor_name", required=False, allow_blank=True, max_length=120
    )
    #: The building this was started from, when the surveyor came at it through
    #: the register. Absent for a survey taken at a door nobody has on record,
    #: which is the normal case and not a deficient one.
    holding = serializers.PrimaryKeyRelatedField(
        queryset=Holding.objects.all(), required=False, allow_null=True
    )
    lat = serializers.DecimalField(
        max_digits=9, decimal_places=6, required=False, allow_null=True
    )
    lng = serializers.DecimalField(
        max_digits=9, decimal_places=6, required=False, allow_null=True
    )
    altitude = serializers.DecimalField(
        max_digits=8, decimal_places=2, required=False, allow_null=True
    )
    accuracy = serializers.IntegerField(required=False, allow_null=True, min_value=0)
    notes = serializers.CharField(required=False, allow_blank=True)
    status = serializers.ChoiceField(
        choices=SurveyStatus.choices, required=False, default=SurveyStatus.SUBMITTED
    )

    def validate_holding(self, holding):
        """A ward-scoped caller may only reference a building they can see.

        Without this, naming a holding outside the caller's area would file a
        survey against it — and conversion attaches to whatever the survey
        names, so the reference is a write into somebody else's register by a
        longer route.
        """
        if holding is not None:
            guard_ward(self, holding.ward_id)
        return holding

    def validate_answers(self, answers):
        """Check the roster answers against real rows, and against the caller.

        A ward or block code that does not exist would otherwise only fail at
        `save()` with a foreign-key error nobody can act on, and a ward the
        caller cannot see would let a scoped supervisor file a survey into
        somebody else's area.
        """
        questions = Question.objects.filter(
            form_id=self.initial_data.get("form"),
            code__in=list(answers),
        ).exclude(options_source=OptionSource.STATIC)

        picked = {}
        for question in questions:
            value = answers.get(question.code)
            if not value:
                continue
            picked[question.options_source] = value[0] if isinstance(value, list) else value

        ward_id = picked.get(OptionSource.WARD)
        if ward_id is not None:
            if not Ward.objects.filter(pk=ward_id).exists():
                raise serializers.ValidationError(f"No ward '{ward_id}'.")
            guard_ward(self, ward_id)

        block_id = picked.get(OptionSource.BLOCK)
        if block_id is not None:
            block = Block.objects.filter(pk=block_id).first()
            if block is None:
                raise serializers.ValidationError(f"No block '{block_id}'.")
            # A block from the wrong ward is the mistake a slow dropdown makes:
            # the surveyor picks the block, then corrects the ward above it.
            if ward_id and block.ward_id != ward_id:
                raise serializers.ValidationError(
                    f"Block '{block_id}' is not in ward '{ward_id}'."
                )

        collector_id = picked.get(OptionSource.COLLECTOR)
        if collector_id is not None and not Collector.objects.filter(pk=collector_id).exists():
            raise serializers.ValidationError(f"No collector '{collector_id}'.")
        return answers

    def create(self, validated_data):
        user = self.context.get("user") or getattr(self.context.get("request"), "user", None)
        surveyor = validated_data.get("surveyor")
        return record_survey(
            validated_data["form"],
            validated_data["answers"],
            surveyor=surveyor,
            surveyor_name=validated_data.get("surveyor_name", ""),
            holding=validated_data.get("holding"),
            lat=validated_data.get("lat"),
            lng=validated_data.get("lng"),
            altitude=validated_data.get("altitude"),
            accuracy=validated_data.get("accuracy"),
            notes=validated_data.get("notes", ""),
            status=validated_data.get("status", SurveyStatus.SUBMITTED),
            user=user if getattr(user, "is_authenticated", False) else None,
        )


class BulkSurveySerializer(serializers.Serializer):
    """A device's offline queue, exactly as `BulkVisitSerializer` takes visits.

    Rows stay loosely typed on purpose: rejecting the whole upload over one bad
    row would cost a surveyor a morning's work, and their phone is the only copy.
    """

    rows = serializers.ListField(child=serializers.DictField(), allow_empty=True)


class ConvertSurveySerializer(serializers.Serializer):
    """The supervisor's decision to put a surveyed building on the register.

    Every field is optional: the defaults come from the survey, and each one is
    here so the supervisor can correct what the surveyor wrote without editing
    the survey itself. A survey is a record of a conversation and must not be
    rewritten to make the register come out tidy.
    """

    holdingType = serializers.PrimaryKeyRelatedField(
        source="holding_type", queryset=HoldingType.objects.all(),
        required=False, allow_null=True,
    )
    #: A road *id*, not a name — the caller is choosing from the ward's roads,
    #: having been told the surveyor's spelling is not one of them.
    road = serializers.PrimaryKeyRelatedField(
        queryset=Road.objects.all(), required=False, allow_null=True
    )
    holdingNo = serializers.CharField(
        source="holding_no", required=False, allow_blank=True, max_length=24
    )
    ownerName = serializers.CharField(
        source="owner_name", required=False, allow_blank=True, max_length=120
    )
    ownerPhone = serializers.CharField(
        source="owner_phone", required=False, allow_blank=True, max_length=20
    )
    #: Attach to a building already on the register instead of creating one.
    link = serializers.PrimaryKeyRelatedField(
        queryset=Holding.objects.all(), required=False, allow_null=True
    )

    def validate_link(self, holding):
        """A holding the caller cannot see is not one they may attach to."""
        if holding is not None:
            guard(self, ward_id=holding.ward_id, agency_id=holding.agency_id)
        return holding

    def validate_road(self, road):
        if road is not None:
            guard_ward(self, road.ward_id)
        return road
