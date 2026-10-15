from django.contrib import admin

from .models import CitizenAccount


@admin.register(CitizenAccount)
class CitizenAccountAdmin(admin.ModelAdmin):
    list_display = ("phone", "name", "last_login", "active")
    search_fields = ("phone", "name")
    list_filter = ("active",)
    readonly_fields = ("pin_hash", "pin_set_at", "pin_attempts", "pin_locked_until", "last_login")
    actions = ["reset_to_default_pin"]

    @admin.action(description="Reset PIN to the default (last 4 digits of the number)")
    def reset_to_default_pin(self, request, queryset):
        for citizen in queryset:
            citizen.reset_pin()
            citizen.save()
