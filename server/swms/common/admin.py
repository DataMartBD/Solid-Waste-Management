from django.contrib import admin

from .ids import IdSequence


@admin.register(IdSequence)
class IdSequenceAdmin(admin.ModelAdmin):
    """Visible for diagnostics — editing these by hand risks duplicate ids."""

    list_display = ["key", "last_value"]
    readonly_fields = ["key"]
    search_fields = ["key"]

    def has_add_permission(self, request):
        return False
