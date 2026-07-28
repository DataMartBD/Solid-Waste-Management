from django.contrib import admin

from .models import Household, PotentialCustomer


@admin.register(Household)
class HouseholdAdmin(admin.ModelAdmin):
    list_display = [
        "id",
        "head",
        "holding",
        "road",
        "ward",
        "tier",
        "status",
        "verified",
        "dues",
        "qr",
    ]
    list_filter = ["ward", "status", "verified", "tier", "customer_type"]
    search_fields = ["id", "qr", "head", "holding", "phone", "road__name"]
    autocomplete_fields = ["road"]
    readonly_fields = ["id", "dues", "created_at", "updated_at"]
    fieldsets = (
        (None, {"fields": ("id", "qr", "status", "tier", "charge", "payment_mode", "payment_day", "dues")}),
        ("Address", {"fields": ("ward", "road", "holding", "address", "floor")}),
        ("Contact", {"fields": ("head", "phone", "alt_phone", "email", "contact_person", "profession", "blood_group")}),
        ("Household", {"fields": ("customer_type", "holding_type", "members", "members_under5", "members_female", "storage", "suitable_time")}),
        (
            "Location",
            {"fields": ("lat", "lng", "accuracy", "verified", "verified_at", "verified_by", "verified_by_user", "placed_by_hand")},
        ),
        ("Audit", {"fields": ("converted_from", "created_at", "updated_at")}),
    )


@admin.register(PotentialCustomer)
class PotentialCustomerAdmin(admin.ModelAdmin):
    list_display = [
        "id",
        "head",
        "holding",
        "road",
        "ward",
        "est_tier",
        "reason",
        "surveyed_at",
        "converted_at",
    ]
    list_filter = ["ward", "reason", "time_gap", "current_practice", "verified"]
    search_fields = ["id", "head", "holding", "phone", "road__name"]
    autocomplete_fields = ["road"]
    readonly_fields = ["id", "converted_at", "converted_to", "created_at", "updated_at"]
