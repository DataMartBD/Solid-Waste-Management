"""Sweep AI conversation log."""

from django.db import models

from swms.common.models import TimeStampedModel


class AiQuery(TimeStampedModel):
    """One question asked of the assistant, kept for auditing and cost control."""

    user = models.ForeignKey(
        "accounts.User", null=True, blank=True, on_delete=models.SET_NULL, related_name="ai_queries"
    )
    question = models.TextField()
    answer = models.TextField(blank=True)
    context_summary = models.JSONField(
        default=dict, blank=True, help_text="The database facts handed to the model"
    )
    model = models.CharField(max_length=64, blank=True)
    input_tokens = models.PositiveIntegerField(default=0)
    output_tokens = models.PositiveIntegerField(default=0)
    latency_ms = models.PositiveIntegerField(default=0)
    error = models.CharField(max_length=240, blank=True)

    class Meta:
        db_table = "ai_query"
        ordering = ["-created_at"]
        verbose_name_plural = "AI queries"

    def __str__(self) -> str:
        return self.question[:60]
