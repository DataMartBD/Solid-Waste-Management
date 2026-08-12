"""Field surveys — a questionnaire engine, not one hard-coded form.

The first form this carries is the door-to-door solid-waste household survey
(SCC / READO Bangladesh, ~65 questions). It is deliberately *not* modelled as 65
columns:

* the same questionnaire is run in more than one city corporation, with
  different wards, blocks and surveyors;
* the paper form has visibly already been revised — the numbering restarts and
  several items are unnumbered — so questions will change again;
* a revision must not invalidate surveys already collected under the old
  wording.

So a form is data. `SurveyForm` is a versioned definition, `Question` and
`QuestionOption` are its content, `QuestionRule` is its conditional logic, and
`Survey`/`Answer` are what a surveyor collected. Publishing a new version leaves
old responses attached to the version they were answered under, which is the
only honest way to report across a wording change.

The cost of that flexibility is that answers are rows, not columns, and a report
would have to walk them. `Question.maps_to` buys the important part back: a
question can name an operational column on `Survey` (`holding_no`, `lat`,
`daily_waste_kg`…) and the value is copied there on save. That mapping is data,
so a second form populates the same columns by pointing at them — nothing here
knows anything about *this* questionnaire.
"""

from __future__ import annotations

from django.core.exceptions import ValidationError
from django.db import models

from swms.common.ids import survey_id
from swms.common.models import TextKeyModel, TimeStampedModel


class FormStatus(models.TextChoices):
    DRAFT = "draft", "Draft"
    PUBLISHED = "published", "Published"
    RETIRED = "retired", "Retired"


class QuestionKind(models.TextChoices):
    SINGLE = "single", "One choice"
    MULTI = "multi", "Several choices"
    TEXT = "text", "Text"
    NUMBER = "number", "Number"
    DATE = "date", "Date"
    NOTE = "note", "Section heading / instruction"


class QuestionWidth(models.TextChoices):
    """How much room the answer needs on screen.

    Part of the questionnaire, not of the page: only the form knows that "house
    no." is four characters and "your recommendation for improving the service"
    is a paragraph. Without it the client can only guess from `kind`, and every
    text question comes out the same width — which is what made a seventy-question
    form twice as long as it needed to be.
    """

    NORMAL = "normal", "A third of the row"
    WIDE = "wide", "Half the row"
    FULL = "full", "The whole row"


class OptionSource(models.TextChoices):
    """Where a choice question gets its choices."""

    STATIC = "static", "The options listed on the form"
    WARD = "ward", "Wards, from the catalog"
    BLOCK = "block", "Blocks of the chosen ward"
    COLLECTOR = "collector", "Collectors on record"
    DISTRICT = "district", "Districts, from the national geography"
    THANA = "thana", "Thanas of the chosen district"


#: `options_source` -> the `Survey` column the chosen row lands in.
#:
#: A question drawing on a roster is answered with a real primary key, so it
#: promotes to a foreign key. District and thana are the exception: they are
#: answered with a name, because `catalog.GeoLocation` is one row per union and
#: a premises is sited by district and thana — the same reason `Holding` keeps
#: them as names.
SOURCE_MAPS_TO = {
    OptionSource.WARD: "ward_id",
    OptionSource.BLOCK: "block_id",
    OptionSource.COLLECTOR: "surveyor_id",
    OptionSource.DISTRICT: "district",
    OptionSource.THANA: "thana",
}

#: The sourced columns that hold text rather than a key. Promotion has to know:
#: an unanswered key column takes NULL, an unanswered text column takes "".
SOURCE_TEXT_COLUMNS = {
    SOURCE_MAPS_TO[OptionSource.DISTRICT],
    SOURCE_MAPS_TO[OptionSource.THANA],
}


#: Operational columns a question may populate through `Question.maps_to`.
#: Anything not listed is rejected at validation, so a typo in a seed file
#: cannot silently produce a survey whose address never lands anywhere.
MAPPABLE = {
    "district",
    "thana",
    "ward_id",
    "block_id",
    "road_name",
    "holding_no",
    "respondent_name",
    "respondent_phone",
    "owner_name",
    "premises_type",
    "household_count",
    "daily_waste_kg",
    "gives_to_van",
    "monthly_fee",
    "willing_fee",
    "surveyed_on",
    "surveyor_id",
}


class SurveyForm(TimeStampedModel):
    """One version of one questionnaire."""

    code = models.CharField(max_length=40, help_text="Stable key, e.g. 'd2d-household'")
    version = models.PositiveSmallIntegerField(default=1)
    title = models.CharField(max_length=200)
    title_bn = models.CharField(max_length=200, blank=True)
    description = models.TextField(blank=True)
    #: Who commissioned it — 'Sylhet City Corporation', 'READO Bangladesh'.
    organisation = models.CharField(max_length=160, blank=True)
    status = models.CharField(
        max_length=10, choices=FormStatus.choices, default=FormStatus.DRAFT
    )
    published_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "survey_form"
        ordering = ["code", "-version"]
        constraints = [
            models.UniqueConstraint(fields=["code", "version"], name="survey_form_unique_version")
        ]

    def __str__(self) -> str:
        return f"{self.code} v{self.version}"

    @property
    def is_open(self) -> bool:
        """Only a published form may be answered."""
        return self.status == FormStatus.PUBLISHED


class Question(TimeStampedModel):
    """One question on one version of a form."""

    form = models.ForeignKey(SurveyForm, on_delete=models.CASCADE, related_name="questions")
    #: Stable across versions where the meaning is unchanged, so answers to
    #: "how much do you pay" stay comparable when the wording is edited.
    code = models.CharField(max_length=48)
    number = models.CharField(max_length=8, blank=True, help_text="As printed, e.g. '29'")
    section = models.CharField(max_length=60, blank=True)
    kind = models.CharField(max_length=8, choices=QuestionKind.choices)

    text = models.CharField(max_length=300)
    text_bn = models.CharField(max_length=300, blank=True)
    hint = models.CharField(max_length=300, blank=True)
    hint_bn = models.CharField(max_length=300, blank=True)

    required = models.BooleanField(default=False)
    #: Blank means "let the client decide from `kind`" — a tick-list needs the
    #: whole row, a date needs very little. It is set only where the default
    #: would be wrong, which is a handful of long free-text answers.
    width = models.CharField(
        max_length=6, choices=QuestionWidth.choices, blank=True,
        help_text="Override the width the client would infer from the kind.",
    )
    sort_order = models.PositiveSmallIntegerField(default=0)
    #: Numeric bounds, for `kind=number`.
    min_value = models.IntegerField(null=True, blank=True)
    max_value = models.IntegerField(null=True, blank=True)
    #: Copies this answer onto the named `Survey` column. See the module note.
    maps_to = models.CharField(max_length=32, blank=True)
    #: Ward, block and surveyor lists are the corporation's roster, not part of
    #: the questionnaire — the printed Sylhet form names its two wards and its
    #: eight surveyors, and the same form run in Khulna must offer Khulna's. A
    #: question with a source carries no `QuestionOption` rows; the client fills
    #: it from the catalog and the answer is stored as `Answer.text` holding the
    #: chosen primary key.
    options_source = models.CharField(
        max_length=12, choices=OptionSource.choices, default=OptionSource.STATIC
    )

    class Meta:
        db_table = "survey_question"
        ordering = ["form_id", "sort_order", "id"]
        constraints = [
            models.UniqueConstraint(fields=["form", "code"], name="question_unique_code_per_form")
        ]
        indexes = [models.Index(fields=["form", "sort_order"], name="question_form_order_idx")]

    def __str__(self) -> str:
        return f"{self.number or self.code}. {self.text[:48]}"

    def clean(self):
        if self.maps_to and self.maps_to not in MAPPABLE:
            raise ValidationError(
                {"maps_to": f"'{self.maps_to}' is not an operational column. "
                            f"Choose one of: {', '.join(sorted(MAPPABLE))}."}
            )
        if self.options_source != OptionSource.STATIC:
            if not self.takes_options:
                raise ValidationError(
                    {"options_source": f"A '{self.kind}' question has no options to source."}
                )
            expected = SOURCE_MAPS_TO.get(self.options_source)
            if expected and self.maps_to != expected:
                # Silently promoting a ward id into the wrong column would be
                # worse than refusing to save the question.
                got = self.maps_to or "nothing"
                raise ValidationError(
                    {"maps_to": f"A '{self.options_source}' question must map to "
                                f"'{expected}', not '{got}'."}
                )

    @property
    def takes_options(self) -> bool:
        return self.kind in (QuestionKind.SINGLE, QuestionKind.MULTI)

    @property
    def is_sourced(self) -> bool:
        """True when the choices come from the catalog, not from the form."""
        return self.options_source != OptionSource.STATIC


class QuestionOption(models.Model):
    """A choice under a single- or multi-select question."""

    question = models.ForeignKey(Question, on_delete=models.CASCADE, related_name="options")
    code = models.CharField(max_length=48)
    label = models.CharField(max_length=200)
    label_bn = models.CharField(max_length=200, blank=True)
    sort_order = models.PositiveSmallIntegerField(default=0)
    #: "অন্যান্য" — selecting it should reveal the free-text question that
    #: follows. The form marks these explicitly rather than matching on label,
    #: which would break the moment the wording changed.
    is_other = models.BooleanField(default=False)

    class Meta:
        db_table = "survey_question_option"
        ordering = ["question_id", "sort_order", "id"]
        constraints = [
            models.UniqueConstraint(fields=["question", "code"], name="option_unique_per_question")
        ]

    def __str__(self) -> str:
        return self.label


class RuleOperator(models.TextChoices):
    ANSWERED = "answered", "Has any answer"
    EQUALS = "equals", "Is one of these options"
    NOT_EQUALS = "not_equals", "Is none of these options"


class QuestionRule(models.Model):
    """When a question should be shown at all.

    Most of this form is conditional — the construction-type question only
    applies to a residential building, the "why not" only to somebody who
    refuses the van, the bKash/Nagad list only to somebody paying digitally.
    Left to the client alone, a rule would be enforced only as far as the client
    chose to; stored here it also travels to the offline app and can be checked
    server-side.
    """

    question = models.ForeignKey(Question, on_delete=models.CASCADE, related_name="rules")
    depends_on = models.ForeignKey(
        Question, on_delete=models.CASCADE, related_name="controls"
    )
    operator = models.CharField(
        max_length=12, choices=RuleOperator.choices, default=RuleOperator.EQUALS
    )
    options = models.ManyToManyField(QuestionOption, blank=True, related_name="rules")

    class Meta:
        db_table = "survey_question_rule"

    def __str__(self) -> str:
        return f"{self.question.code} if {self.depends_on.code} {self.operator}"


class SurveyStatus(models.TextChoices):
    DRAFT = "draft", "Draft"
    SUBMITTED = "submitted", "Submitted"
    REVIEWED = "reviewed", "Reviewed"
    CONVERTED = "converted", "Converted to a holding"
    REJECTED = "rejected", "Rejected"


class Survey(TextKeyModel):
    """One completed questionnaire at one premises.

    Deliberately *not* a `Holding`. A survey is what somebody was told at a door
    on a day; a holding is a record the corporation stands behind. Keeping them
    apart means a survey can be wrong, duplicated or disputed without corrupting
    the register — and `converted_to` records the moment somebody decided it was
    good enough to act on.
    """

    form = models.ForeignKey(SurveyForm, on_delete=models.PROTECT, related_name="surveys")
    surveyor = models.ForeignKey(
        "fieldops.Collector", null=True, blank=True, on_delete=models.SET_NULL,
        related_name="surveys",
    )
    surveyor_name = models.CharField(
        max_length=120, blank=True,
        help_text="As given on the form, when the surveyor is not a collector on record",
    )
    recorded_by = models.ForeignKey(
        "accounts.User", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    agency = models.ForeignKey(
        "agencies.Agency", null=True, blank=True, on_delete=models.PROTECT,
        related_name="surveys",
    )

    # --- promoted from answers via Question.maps_to ----------------------- #
    surveyed_on = models.DateField(db_index=True)
    #: Names, not keys — see SOURCE_MAPS_TO. They match `Holding.district` and
    #: `Holding.thana` so a converted survey carries its address across whole.
    district = models.CharField(max_length=64, blank=True)
    thana = models.CharField(max_length=96, blank=True)
    ward = models.ForeignKey(
        "catalog.Ward", null=True, blank=True, on_delete=models.PROTECT, related_name="surveys"
    )
    block = models.ForeignKey(
        "catalog.Block", null=True, blank=True, on_delete=models.PROTECT, related_name="surveys"
    )
    #: Free text rather than a FK: a surveyor writes what the lane is called,
    #: and half of those names are not in the road table yet.
    road_name = models.CharField(max_length=160, blank=True)
    holding_no = models.CharField(max_length=24, blank=True, db_index=True)
    respondent_name = models.CharField(max_length=120, blank=True)
    respondent_phone = models.CharField(max_length=20, blank=True)
    #: The building's owner, who is often not the person who answered the door —
    #: `Holding.owner_name` wants this one, not the tenant's.
    owner_name = models.CharField(max_length=120, blank=True)
    premises_type = models.CharField(max_length=40, blank=True)
    household_count = models.PositiveSmallIntegerField(null=True, blank=True)
    daily_waste_kg = models.DecimalField(
        max_digits=7, decimal_places=2, null=True, blank=True
    )
    gives_to_van = models.BooleanField(null=True, blank=True)
    monthly_fee = models.PositiveIntegerField(null=True, blank=True)
    willing_fee = models.PositiveIntegerField(null=True, blank=True)

    # --- where it was taken ------------------------------------------------ #
    lat = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    lng = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    altitude = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True)
    accuracy = models.PositiveSmallIntegerField(null=True, blank=True)

    status = models.CharField(
        max_length=10, choices=SurveyStatus.choices, default=SurveyStatus.SUBMITTED
    )
    #: False while the record is still only on the surveyor's device — the same
    #: contract `Visit.synced` uses, so the offline queue behaves identically.
    synced = models.BooleanField(default=True)
    notes = models.TextField(blank=True)

    #: The building this survey was started from, when it was started from the
    #: register rather than at an unknown door.
    #:
    #: Optional, and that is the point: most surveys are taken cold — the whole
    #: purpose of the exercise is finding premises nobody has on record — so a
    #: required reference would make the form unusable for its main job. When it
    #: is set it says "this questionnaire is about that building", which is what
    #: stops conversion registering a second copy of a holding already there.
    #:
    #: Distinct from `converted_to`, which is the opposite direction in time:
    #: this is where the survey came *from*, that is what it later became.
    holding = models.ForeignKey(
        "customers.Holding", null=True, blank=True, on_delete=models.SET_NULL,
        related_name="surveys_about",
    )

    converted_at = models.DateTimeField(null=True, blank=True)
    converted_to = models.ForeignKey(
        "customers.Holding", null=True, blank=True, on_delete=models.SET_NULL,
        related_name="surveys_taken",
    )

    class Meta:
        db_table = "survey"
        ordering = ["-surveyed_on", "-created_at"]
        indexes = [
            models.Index(fields=["form", "-surveyed_on"], name="survey_form_date_idx"),
            models.Index(fields=["ward", "-surveyed_on"], name="survey_ward_date_idx"),
            models.Index(fields=["status"], name="survey_status_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.id} — {self.holding_no or self.respondent_name or 'survey'}"

    def save(self, *args, **kwargs):
        if not self.id:
            self.id = survey_id()
        super().save(*args, **kwargs)

    @property
    def has_location(self) -> bool:
        return self.lat is not None and self.lng is not None


class Answer(models.Model):
    """One value a respondent gave.

    A multi-select produces several rows for the same question, one per chosen
    option, which is why the uniqueness is `(survey, question, option)` rather
    than `(survey, question)`.
    """

    survey = models.ForeignKey(Survey, on_delete=models.CASCADE, related_name="answers")
    question = models.ForeignKey(Question, on_delete=models.PROTECT, related_name="answers")
    option = models.ForeignKey(
        QuestionOption, null=True, blank=True, on_delete=models.PROTECT, related_name="answers"
    )
    text = models.TextField(blank=True)
    number = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    date = models.DateField(null=True, blank=True)

    class Meta:
        db_table = "survey_answer"
        ordering = ["survey_id", "question__sort_order"]
        indexes = [models.Index(fields=["survey", "question"], name="answer_survey_q_idx")]
        constraints = [
            models.UniqueConstraint(
                fields=["survey", "question", "option"], name="answer_unique_choice"
            )
        ]

    def __str__(self) -> str:
        return f"{self.survey_id} · {self.question_id}"

    @property
    def value(self):
        """Whatever this answer actually holds, for display and export."""
        if self.option_id:
            return self.option.label
        if self.number is not None:
            return self.number
        if self.date is not None:
            return self.date
        return self.text


class SurveyPhoto(TimeStampedModel):
    """A photo of the premises. The form asks for one to three."""

    survey = models.ForeignKey(Survey, on_delete=models.CASCADE, related_name="photos")
    image = models.ImageField(upload_to="surveys/%Y/%m/")
    caption = models.CharField(max_length=200, blank=True)
    uploaded_by = models.ForeignKey(
        "accounts.User", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )

    class Meta:
        db_table = "survey_photo"
        ordering = ["survey_id", "created_at"]

    def __str__(self) -> str:
        return f"photo of {self.survey_id}"
