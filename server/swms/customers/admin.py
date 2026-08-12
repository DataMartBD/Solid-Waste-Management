from django.contrib import admin

from .models import Holding, Household, PotentialCustomer

#: Copied down from the parent holding on every save, so editing them here would
#: be undone the next time the row is written. Shown, but not editable.
#: Location is not in this list because it is not stored on these rows at all —
#: it is read through to the holding.
MIRRORED = ["ward", "road", "holding_no"]


@admin.register(Holding)
class HoldingAdmin(admin.ModelAdmin):
    list_display = [
        "id",
        "holding_no",
        "road",
        "ward",
        "owner_name",
        "service_status",
        "status",
        "verified",
    ]
    list_filter = ["ward", "status", "verified", "holding_type"]
    # Required for autocomplete_fields = ["holding"] on the models below.
    search_fields = ["id", "holding_no", "owner_name", "owner_phone", "road__name"]
    autocomplete_fields = ["road"]
    readonly_fields = ["id", "created_at", "updated_at"]
    fieldsets = (
        (None, {"fields": ("id", "status", "holding_type", "notes")}),
        ("Address", {"fields": ("ward", "road", "holding_no", "address", "floors", "units_total")}),
        ("Owner", {"fields": ("owner_name", "owner_phone", "owner_alt_phone", "owner_email")}),
        (
            "Location",
            {"fields": ("lat", "lng", "accuracy", "verified", "verified_at", "verified_by", "verified_by_user", "placed_by_hand")},
        ),
        ("Audit", {"fields": ("created_at", "updated_at")}),
    )

    @admin.display(description="Service")
    def service_status(self, obj):
        return obj.service_status


@admin.register(Household)
class HouseholdAdmin(admin.ModelAdmin):
    list_display = [
        "id",
        "head",
        "holding_no",
        "unit",
        "road",
        "ward",
        "tier",
        "status",
        "dues",
        "qr",
    ]
    list_filter = ["ward", "status", "tier", "customer_type"]
    search_fields = ["id", "qr", "head", "holding_no", "unit", "phone", "road__name"]
    autocomplete_fields = ["holding"]
    readonly_fields = ["id", "dues", "created_at", "updated_at", *MIRRORED]
    fieldsets = (
        (None, {"fields": ("id", "qr", "status", "tier", "charge", "payment_mode", "payment_day", "dues")}),
        ("Holding", {"fields": ("holding", "unit", "floor", "address")}),
        ("Address (from holding)", {"fields": ("ward", "road", "holding_no"), "classes": ["collapse"]}),
        ("Contact", {"fields": ("head", "phone", "alt_phone", "email", "contact_person", "profession", "blood_group")}),
        ("Household", {"fields": ("customer_type", "holding_type", "members", "members_under5", "members_female", "storage", "suitable_time")}),
        ("Audit", {"fields": ("converted_from", "created_at", "updated_at")}),
    )


@admin.register(PotentialCustomer)
class PotentialCustomerAdmin(admin.ModelAdmin):
    list_display = [
        "id",
        "head",
        "holding_no",
        "unit",
        "road",
        "ward",
        "est_tier",
        "reason",
        "surveyed_at",
        "converted_at",
    ]
    list_filter = ["ward", "reason", "time_gap", "current_practice"]
    search_fields = ["id", "head", "holding_no", "unit", "phone", "road__name"]
    autocomplete_fields = ["holding"]
    readonly_fields = ["id", "converted_at", "converted_to", "created_at", "updated_at", *MIRRORED]