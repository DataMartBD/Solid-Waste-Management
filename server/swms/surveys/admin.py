"""Admin for the form engine.

Questions are editable here but forms are loaded by `seed_survey_form` from a
module under version control. Editing a question in the admin makes the live
questionnaire differ from the file, and the next seed run would overwrite it —
so the inline is read-only, and a change means editing `forms_*.py`.
"""

from __future__ import annotations

from django.contrib import admin

from .models import (
    Answer,
    Question,
    QuestionOption,
    QuestionRule,
    Survey,
    SurveyForm,
    SurveyPhoto,
)


class QuestionOptionInline(admin.TabularInline):
    model = QuestionOption
    extra = 0
    fields = ["code", "label", "label_bn", "sort_order", "is_other"]
    can_delete = False

    def has_add_permission(self, request, obj=None):
        return False


@admin.register(SurveyForm)
class SurveyFormAdmin(admin.ModelAdmin):
    list_display = ["code", "version", "title", "status", "question_total", "survey_total"]
    list_filter = ["status", "code"]
    search_fields = ["code", "title", "title_bn", "organisation"]
    readonly_fields = ["created_at", "updated_at", "published_at"]

    @admin.display(description="questions")
    def question_total(self, form) -> int:
        return form.questions.count()

    @admin.display(description="surveys")
    def survey_total(self, form) -> int:
        return form.surveys.count()


@admin.register(Question)
class QuestionAdmin(admin.ModelAdmin):
    list_display = ["form", "number", "code", "section", "kind", "required", "maps_to",
                    "options_source"]
    list_filter = ["form", "section", "kind", "required", "options_source"]
    search_fields = ["code", "text", "text_bn"]
    inlines = [QuestionOptionInline]
    ordering = ["form", "sort_order"]


@admin.register(QuestionRule)
class QuestionRuleAdmin(admin.ModelAdmin):
    list_display = ["question", "depends_on", "operator"]
    list_filter = ["operator", "question__form"]
    autocomplete_fields = ["question", "depends_on"]
    filter_horizontal = ["options"]


class AnswerInline(admin.TabularInline):
    model = Answer
    extra = 0
    fields = ["question", "option", "text", "number", "date"]
    readonly_fields = fields
    can_delete = False

    def has_add_permission(self, request, obj=None):
        return False


class SurveyPhotoInline(admin.TabularInline):
    model = SurveyPhoto
    extra = 0
    fields = ["image", "caption"]


@admin.register(Survey)
class SurveyAdmin(admin.ModelAdmin):
    list_display = ["id", "surveyed_on", "form", "ward", "holding_no", "respondent_name",
                    "status", "synced"]
    list_filter = ["status", "synced", "form", "ward", "premises_type"]
    search_fields = ["id", "holding_no", "respondent_name", "respondent_phone"]
    date_hierarchy = "surveyed_on"
    inlines = [AnswerInline, SurveyPhotoInline]
    # Every one of these is promoted from an answer or stamped at record time.
    # Editing them here would put the survey out of step with what was actually
    # said at the door.
    readonly_fields = [
        "id", "form", "surveyor", "surveyor_name", "recorded_by", "agency",
        "ward", "block", "road_name", "holding_no", "respondent_name",
        "respondent_phone", "premises_type", "household_count", "daily_waste_kg",
        "gives_to_van", "monthly_fee", "willing_fee", "lat", "lng", "altitude",
        "accuracy", "created_at", "updated_at", "converted_at", "converted_to",
    ]
