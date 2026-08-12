from django.contrib import admin

from .models import (
    Block,
    CurrentPractice,
    CustomerType,
    GeoLocation,
    HoldingType,
    PaymentMode,
    PotentialReason,
    Road,
    StorageType,
    SuitableTime,
    Tier,
    TimeGap,
    Ward,
    Zone,
)


class OptionAdmin(admin.ModelAdmin):
    """Shared admin for the eight dropdown tables."""

    list_display = ["id", "label", "key", "sort_order", "active"]
    list_editable = ["label", "sort_order", "active"]
    search_fields = ["id", "label", "key"]


for model in (
    CustomerType,
    HoldingType,
    StorageType,
    SuitableTime,
    PaymentMode,
    PotentialReason,
    TimeGap,
    CurrentPractice,
):
    admin.site.register(model, OptionAdmin)


@admin.register(Tier)
class TierAdmin(OptionAdmin):
    list_display = ["id", "label", "charge", "key", "sort_order", "active"]
    list_editable = ["label", "charge", "sort_order", "active"]


class RoadInline(admin.TabularInline):
    model = Road
    extra = 1


class BlockInline(admin.TabularInline):
    model = Block
    extra = 1


@admin.register(Zone)
class ZoneAdmin(admin.ModelAdmin):
    list_display = ["id", "name", "sort_order"]
    search_fields = ["id", "name"]


@admin.register(Ward)
class WardAdmin(admin.ModelAdmin):
    list_display = ["id", "name", "zone", "lat", "lng", "active"]
    list_filter = ["zone", "active"]
    search_fields = ["id", "name"]
    inlines = [BlockInline, RoadInline]


@admin.register(Block)
class BlockAdmin(admin.ModelAdmin):
    list_display = ["id", "name", "ward", "sort_order", "active"]
    list_filter = ["ward", "active"]
    search_fields = ["id", "name"]


@admin.register(Road)
class RoadAdmin(admin.ModelAdmin):
    list_display = ["name", "ward", "sort_order", "active"]
    list_filter = ["ward", "active"]
    search_fields = ["name"]


@admin.register(GeoLocation)
class GeoLocationAdmin(admin.ModelAdmin):
    """Read-only: the national list is loaded from file, not typed in.

    `load_geo_locations` is the only writer, so editing a row here would be
    silently reverted the next time the file is refreshed.
    """

    list_display = ["union_name", "upazila_name", "district_name", "division_name"]
    list_filter = ["division_name"]
    search_fields = ["district_name", "district_bn", "upazila_name", "upazila_bn", "union_name"]

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False
