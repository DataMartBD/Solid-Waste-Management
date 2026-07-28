"""Django admin for the fleet.

Back-office fallback for the things the SPA does not cover — correcting a
mistyped plate, auditing a van's ping trail after a dispute about a missed round.
"""

from django.contrib import admin

from .models import FuelLog, Maintenance, Van, VehiclePosition


@admin.register(Van)
class VanAdmin(admin.ModelAdmin):
    list_display = ("id", "plate", "type", "fuel", "status", "driver", "odometer", "fitness_exp")
    list_filter = ("status", "type", "fuel", "ownership")
    search_fields = ("id", "plate", "gps", "driver__name")
    list_select_related = ("driver",)
    raw_id_fields = ("driver",)
    # `id` is allocated by swms.common.ids and is not an editable field.
    readonly_fields = ("created_at", "updated_at")
    fieldsets = (
        (None, {"fields": ("plate", "type", "capacity", "fuel", "ownership", "gps")}),
        ("Operation", {"fields": ("status", "driver", "odometer", "next_service_km", "kmpl")}),
        ("Paperwork", {"fields": ("fitness_exp", "tax_exp", "insurance_exp", "permit_exp")}),
        ("Audit", {"fields": ("created_at", "updated_at")}),
    )


@admin.register(Maintenance)
class MaintenanceAdmin(admin.ModelAdmin):
    list_display = ("id", "van", "kind", "reason", "opened", "closed", "downtime", "cost", "vendor")
    list_filter = ("kind", "closed")
    search_fields = ("id", "van__id", "van__plate", "reason", "vendor")
    list_select_related = ("van",)
    raw_id_fields = ("van",)
    date_hierarchy = "opened"
    readonly_fields = ("created_at", "updated_at")


@admin.register(FuelLog)
class FuelLogAdmin(admin.ModelAdmin):
    list_display = ("id", "van", "at", "litres", "cost", "odometer", "kmpl", "by")
    list_filter = ("van__fuel",)
    search_fields = ("id", "van__id", "van__plate")
    list_select_related = ("van", "by")
    raw_id_fields = ("van", "by")
    date_hierarchy = "at"
    readonly_fields = ("created_at", "updated_at")


@admin.register(VehiclePosition)
class VehiclePositionAdmin(admin.ModelAdmin):
    list_display = ("van", "at", "lat", "lng", "speed", "heading", "ignition", "collector")
    list_filter = ("ignition",)
    search_fields = ("van__id", "van__plate", "collector__name")
    list_select_related = ("van", "collector")
    raw_id_fields = ("van", "collector")
    date_hierarchy = "at"
    # Telemetry is machine-written; the admin is for reading it back.
    readonly_fields = ("created_at", "updated_at")
