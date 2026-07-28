"""Back-office views of the complaint tables.

The activity trail is inlined on the complaint because reading a ticket without
its history is close to useless — and it is read-only in the admin for the same
reason it is read-only in the API: an audit trail somebody can retype is not an
audit trail. Rows are written by `services.py` alone.
"""

from django.contrib import admin
from django.utils.html import format_html

from .models import Complaint, ComplaintActivity, ComplaintPhoto


class ComplaintActivityInline(admin.TabularInline):
    model = ComplaintActivity
    extra = 0
    can_delete = False
    fields = ["at", "action", "actor", "actor_user", "note"]
    readonly_fields = fields
    ordering = ["at", "id"]

    def has_add_permission(self, request, obj=None):
        return False


class ComplaintPhotoInline(admin.TabularInline):
    model = ComplaintPhoto
    extra = 0
    fields = ["image", "caption", "uploaded_by", "created_at"]
    readonly_fields = ["created_at"]


@admin.register(Complaint)
class ComplaintAdmin(admin.ModelAdmin):
    list_display = [
        "id",
        "type",
        "household",
        "ward",
        "priority",
        "status",
        "assigned",
        "sla",
        "opened",
        "breached",
    ]
    list_filter = ["status", "priority", "type", "channel", "ward"]
    search_fields = ["id", "household__id", "household__head", "description"]
    list_select_related = ["household", "ward", "assigned"]
    date_hierarchy = "opened"
    # raw_id rather than autocomplete: the customer and staff apps register no
    # ModelAdmin of their own, and autocomplete needs the target admin to exist.
    raw_id_fields = ["household", "assigned"]
    # Set by Complaint.save() and by the lifecycle services, never by hand.
    readonly_fields = ["id", "ward", "resolved_at", "closed_at", "created_at", "updated_at"]
    inlines = [ComplaintActivityInline, ComplaintPhotoInline]

    @admin.display(boolean=True, description="Over SLA")
    def breached(self, obj) -> bool:
        return obj.sla_state()["breached"]


@admin.register(ComplaintActivity)
class ComplaintActivityAdmin(admin.ModelAdmin):
    """Flat view for auditing across tickets ('what did this operator do?')."""

    list_display = ["complaint", "at", "action", "actor", "note"]
    list_filter = ["action"]
    search_fields = ["complaint__id", "actor", "note"]
    list_select_related = ["complaint"]
    date_hierarchy = "at"
    readonly_fields = ["complaint", "at", "action", "actor", "actor_user", "note"]

    def has_add_permission(self, request):
        return False


@admin.register(ComplaintPhoto)
class ComplaintPhotoAdmin(admin.ModelAdmin):
    list_display = ["complaint", "thumbnail", "caption", "uploaded_by", "created_at"]
    search_fields = ["complaint__id", "caption"]
    list_select_related = ["complaint", "uploaded_by"]
    readonly_fields = ["created_at", "updated_at"]

    @admin.display(description="Preview")
    def thumbnail(self, obj):
        if not obj.image:
            return "—"
        return format_html('<img src="{}" style="height:48px;border-radius:4px" />', obj.image.url)
