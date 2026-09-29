"""Load a questionnaire module into the form engine.

    manage.py seed_survey_form                 # loads d2d-household v1
    manage.py seed_survey_form --publish       # ...and opens it for answering
    manage.py seed_survey_form --form other    # loads swms/surveys/forms_other.py

Re-running is safe: the command matches on `(code, version)` and updates the
questions in place, so a typo in the Bangla can be corrected by editing the
module and running it again.

It refuses to touch a version that already has surveys attached. Editing a
question under answers already given would silently change what those people
were asked — publish a new version instead, which is the whole point of the
version column.
"""

from __future__ import annotations

import importlib

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from swms.surveys.models import (
    FormStatus,
    OptionSource,
    Question,
    QuestionOption,
    QuestionRule,
    RuleOperator,
    SurveyForm,
)


class Command(BaseCommand):
    help = "Load a questionnaire definition module into the survey form engine."

    def add_arguments(self, parser):
        parser.add_argument(
            "--form", default="d2d",
            help="Module suffix under swms.surveys, e.g. 'd2d' -> forms_d2d.py",
        )
        parser.add_argument(
            "--publish", action="store_true",
            help="Mark the form published so surveys may be recorded against it.",
        )

    @transaction.atomic
    def handle(self, *args, **options):
        module_name = f"swms.surveys.forms_{options['form']}"
        try:
            spec = importlib.import_module(module_name)
        except ModuleNotFoundError as exc:
            raise CommandError(f"No questionnaire module {module_name}: {exc}") from exc

        form, created = SurveyForm.objects.get_or_create(
            code=spec.CODE,
            version=spec.VERSION,
            defaults={
                "title": spec.TITLE,
                "title_bn": getattr(spec, "TITLE_BN", ""),
                "organisation": getattr(spec, "ORGANISATION", ""),
            },
        )
        if not created:
            if form.surveys.exists():
                raise CommandError(
                    f"{form} already has {form.surveys.count()} survey(s). "
                    f"Bump VERSION in {module_name} rather than editing this one."
                )
            form.title = spec.TITLE
            form.title_bn = getattr(spec, "TITLE_BN", "")
            form.organisation = getattr(spec, "ORGANISATION", "")
            form.save(update_fields=["title", "title_bn", "organisation", "updated_at"])
            # No answers exist, so a clean rebuild is the honest way to pick up
            # deletions and reordering.
            form.questions.all().delete()

        questions = self._load_questions(form, spec)
        rules = self._load_rules(spec, questions)

        if options["publish"] and form.status != FormStatus.PUBLISHED:
            form.status = FormStatus.PUBLISHED
            form.published_at = timezone.now()
            form.save(update_fields=["status", "published_at", "updated_at"])

        option_count = QuestionOption.objects.filter(question__form=form).count()
        self.stdout.write(self.style.SUCCESS(
            f"{'Created' if created else 'Rebuilt'} {form}: "
            f"{len(questions)} questions, {option_count} options, {rules} rules, "
            f"status={form.status}."
        ))

    # ------------------------------------------------------------------ #

    def _load_questions(self, form, spec) -> dict:
        """Write every question and its options; return {code: Question}."""
        questions = {}
        for order, item in enumerate(spec.QUESTIONS, start=1):
            source = item.get("options_source", OptionSource.STATIC)
            question = Question(
                form=form,
                code=item["code"],
                number=item.get("number", ""),
                section=item.get("section", ""),
                kind=item["kind"],
                text=item["text"],
                text_bn=item.get("text_bn", ""),
                hint=item.get("hint", ""),
                hint_bn=item.get("hint_bn", ""),
                required=item.get("required", False),
                width=item.get("width", ""),
                sort_order=order,
                min_value=item.get("min_value"),
                max_value=item.get("max_value"),
                maps_to=item.get("maps_to", ""),
                options_source=source,
                default_value=str(item.get("default", "")),
            )
            # full_clean here is the point of the MAPPABLE check — a typo in the
            # module must fail the seed, not produce a form that quietly drops
            # its address into nowhere.
            question.full_clean(exclude=["form"])
            question.save()
            questions[question.code] = question

            listed = item.get("options", [])
            if listed and source != OptionSource.STATIC:
                raise CommandError(
                    f"Question '{question.code}' both lists options and sources "
                    f"them from '{source}'. Pick one."
                )
            if question.takes_options and not listed and source == OptionSource.STATIC:
                raise CommandError(
                    f"Question '{question.code}' is a {question.kind} question "
                    f"with no options and no options_source."
                )
            QuestionOption.objects.bulk_create([
                QuestionOption(
                    question=question,
                    code=opt["code"],
                    label=opt["label"],
                    label_bn=opt.get("label_bn", ""),
                    sort_order=i,
                    is_other=opt.get("is_other", False),
                )
                for i, opt in enumerate(listed, start=1)
            ])
            # Checked here rather than in `Question.clean()`: the options are
            # written after the question, so nothing earlier could have known
            # whether the default names one of them. A default pointing at an
            # option that does not exist prefills a dropdown with a blank.
            if question.default_value and source == OptionSource.STATIC:
                codes = {opt["code"] for opt in listed}
                if codes and question.default_value not in codes:
                    raise CommandError(
                        f"Question '{question.code}' defaults to "
                        f"'{question.default_value}', which is not one of its "
                        f"options ({', '.join(sorted(codes))})."
                    )
        return questions

    def _load_rules(self, spec, questions: dict) -> int:
        """Turn each `shown_if=(code, [option_codes])` into a QuestionRule."""
        made = 0
        for item in spec.QUESTIONS:
            shown_if = item.get("shown_if")
            if not shown_if:
                continue
            depends_code, option_codes = shown_if
            question = questions[item["code"]]
            try:
                depends_on = questions[depends_code]
            except KeyError:
                raise CommandError(
                    f"Question '{question.code}' depends on '{depends_code}', "
                    f"which is not in this form."
                ) from None
            if depends_on.sort_order > question.sort_order:
                raise CommandError(
                    f"Question '{question.code}' depends on '{depends_code}', "
                    f"which is asked later. A surveyor cannot answer it yet."
                )

            rule = QuestionRule.objects.create(
                question=question,
                depends_on=depends_on,
                operator=RuleOperator.EQUALS if option_codes else RuleOperator.ANSWERED,
            )
            if option_codes:
                chosen = list(depends_on.options.filter(code__in=option_codes))
                missing = set(option_codes) - {o.code for o in chosen}
                if missing:
                    raise CommandError(
                        f"Question '{question.code}' is shown when '{depends_code}' "
                        f"is {sorted(missing)}, but that is not an option there."
                    )
                rule.options.set(chosen)
            made += 1
        return made
