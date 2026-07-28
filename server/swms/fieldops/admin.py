"""Back-office admin for field operations.

Aimed at the two things staff actually do here by hand: look up why a household
was or was not served on a given day, and fix a route's walking order.
"""

from django.contrib import admin

from .models import Assignment, AssignmentRoute, Collector, Route, RouteStop, Visit


class RouteStopInline(admin.TabularInline):
    model = RouteStop
    extra = 0
    ordering = ["seq"]
    # raw id rather than autocomplete: customers has no ModelAdmin to search.
    raw_id_fields = ["household"]
    fields = ["seq", "household"]


class AssignmentRouteInline(admin.TabularInline):
    model = AssignmentRoute
    extra = 0
    ordering = ["seq"]
    autocomplete_fields = ["route"]
    fields = ["seq", "route"]


@admin.register(Collector)
class CollectorAdmin(admin.ModelAdmin):
    list_display = [
        "id",
        "name",
        "dsp_id",
        "ward",
        "status",
        "attendance",
        "coverage",
        "on_time",
        "license_exp",
        "active",
    ]
    list_filter = ["status", "attendance", "active", "ward"]
    search_fields = ["id", "name", "dsp_id", "phone", "license"]
    list_select_related = ["ward"]
    ordering = ["id"]
    # Written by fieldops.services.refresh_collector_metrics, not by hand.
    readonly_fields = ["metrics_updated_at", "created_at", "updated_at"]


@admin.register(Route)
class RouteAdmin(admin.ModelAdmin):
    list_display = ["id", "name", "ward", "window", "stop_count", "active"]
    list_filter = ["active", "ward"]
    search_fields = ["id", "name"]
    list_select_related = ["ward"]
    ordering = ["ward_id", "id"]
    inlines = [RouteStopInline]

    @admin.display(description="Stops")
    def stop_count(self, obj):
        return obj.stops.count()


@admin.register(RouteStop)
class RouteStopAdmin(admin.ModelAdmin):
    list_display = ["route", "seq", "household"]
    list_filter = ["route__ward", "route"]
    search_fields = ["route__id", "route__name", "household__id", "household__holding"]
    list_select_related = ["route", "household"]
    raw_id_fields = ["household"]
    ordering = ["route_id", "seq"]


@admin.register(Assignment)
class AssignmentAdmin(admin.ModelAdmin):
    list_display = ["id", "collector", "route_count", "active", "effective_from"]
    list_filter = ["active", "collector__ward"]
    search_fields = ["id", "collector__id", "collector__name"]
    list_select_related = ["collector"]
    ordering = ["collector_id"]
    inlines = [AssignmentRouteInline]

    @admin.display(description="Routes")
    def route_count(self, obj):
        return obj.route_links.count()


@admin.register(AssignmentRoute)
class AssignmentRouteAdmin(admin.ModelAdmin):
    list_display = ["assignment", "seq", "route"]
    list_filter = ["assignment__active", "route__ward"]
    search_fields = ["assignment__id", "route__id", "route__name"]
    list_select_related = ["assignment", "route"]
    ordering = ["assignment_id", "seq"]


@admin.register(Visit)
class VisitAdmin(admin.ModelAdmin):
    list_display = [
        "id",
        "served_on",
        "household",
        "collector",
        "route",
        "status",
        "reason",
        "source",
        "synced",
        "at",
    ]
    list_filter = ["status", "source", "synced", "reason", "served_on", "household__ward"]
    search_fields = ["id", "household__id", "household__holding", "qr", "collector__name"]
    list_select_related = ["household", "collector", "route"]
    raw_id_fields = ["household", "recorded_by"]
    date_hierarchy = "served_on"
    ordering = ["-at"]
    # `served_on` is derived from `at` in save(); editing it would let the two
    # disagree and break the one-visit-per-day lookup.
    readonly_fields = ["served_on", "created_at", "updated_at"]
