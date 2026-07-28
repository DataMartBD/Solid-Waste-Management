from django.contrib import admin

from .models import AiQuery


@admin.register(AiQuery)
class AiQueryAdmin(admin.ModelAdmin):
    """Read-only log — useful for auditing what the assistant was asked and told."""

    list_display = ["created_at", "user", "short_question", "model", "output_tokens", "latency_ms"]
    list_filter = ["model", "created_at"]
    search_fields = ["question", "answer", "user__name", "user__phone"]
    readonly_fields = [
        "user",
        "question",
        "answer",
        "context_summary",
        "model",
        "input_tokens",
        "output_tokens",
        "latency_ms",
        "error",
        "created_at",
        "updated_at",
    ]

    @admin.display(description="Question")
    def short_question(self, obj):
        return obj.question[:70]

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False
