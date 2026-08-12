from django.contrib import admin

from .models import Agency, CollectorEmployment


class CollectorEmploymentInline(admin.TabularInline):
    model = CollectorEmployment
    extra = 0
    fields = ["collector", "from_date", "to_date", "note"]
    # Employment is written by `services.transfer_collector`, which keeps the
    # history and `Collector.agency` in step. Editing rows here would move one
    # without the other.
    readonly_fields = fields
    can_delete = False
    show_change_link = False

    def has_add_permission(self, request, obj):
        return False


@admin.register(Agency)
class AgencyAdmin(admin.ModelAdmin):
    list_display = [
        "id",
        "short_code",
        "name",
        "agency_type",
        "status",
        "contract_end",
        "collector_count",
        "active",
    ]
    list_filter = ["status", "agency_type", "active"]
    search_fields = ["id", "name", "short_code", "contact_person", "phone", "contract_no"]
    filter_horizontal = ["service_wards"]
    readonly_fields = ["id", "created_at", "updated_at"]
    inlines = [CollectorEmploymentInline]
    fieldsets = (
        (None, {"fields": ("id", "name", "short_code", "agency_type", "status", "active")}),
        ("Registration", {"fields": ("trade_licence_no", "registration_no", "tin", "bin")}),
        ("Contact", {"fields": ("contact_person", "phone", "alt_phone", "email", "address")}),
        ("Contract", {"fields": ("contract_no", "contract_start", "contract_end", "service_wards")}),
        ("Notes", {"fields": ("notes",)}),
        ("Audit", {"fields": ("created_at", "updated_at")}),
    )

    @admin.display(description="Collectors")
    def collector_count(self, obj):
        return obj.collectors.filter(active=True).count()


@admin.register(CollectorEmployment)
class CollectorEmploymentAdmin(admin.ModelAdmin):
    list_display = ["collector", "agency", "from_date", "to_date", "is_current"]
    list_filter = ["agency"]
    search_fields = ["collector__id", "collector__name", "agency__name", "agency__short_code"]
    autocomplete_fields = ["collector", "agency"]
    readonly_fields = ["created_at", "updated_at"]

    @admin.display(boolean=True, description="Current")
    def is_current(self, obj):
        return obj.is_current
