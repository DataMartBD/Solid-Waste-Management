from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin

from .models import OtpCode, User


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    """Phone-based accounts, so the stock username fieldsets do not apply."""

    ordering = ["name"]
    list_display = ["phone", "name", "role", "scope_kind", "collector", "has_pin", "is_active"]
    list_filter = ["role", "scope_kind", "is_active", "is_staff"]
    search_fields = ["phone", "name", "email", "nid"]
    filter_horizontal = ["scope_wards", "groups", "user_permissions"]
    readonly_fields = ["pin_hash", "pin_set_at", "pin_attempts", "pin_locked_until", "last_login"]

    fieldsets = (
        (None, {"fields": ("phone", "password", "name", "role")}),
        ("Scope", {"fields": ("scope_kind", "scope_zone", "scope_wards", "collector")}),
        (
            "Profile",
            {"fields": ("email", "alt_phone", "nid", "blood_group", "emergency_contact", "avatar")},
        ),
        ("PIN", {"fields": ("pin_hash", "pin_set_at", "pin_attempts", "pin_locked_until")}),
        ("Permissions", {"fields": ("is_active", "is_staff", "is_superuser", "groups", "user_permissions")}),
        ("Dates", {"fields": ("last_login",)}),
    )
    add_fieldsets = (
        (None, {"classes": ("wide",), "fields": ("phone", "name", "role", "password1", "password2")}),
    )

    @admin.display(boolean=True, description="PIN set")
    def has_pin(self, obj):
        return obj.has_pin


@admin.register(OtpCode)
class OtpCodeAdmin(admin.ModelAdmin):
    list_display = ["phone", "expires_at", "consumed_at", "attempts", "requested_ip"]
    list_filter = ["consumed_at"]
    search_fields = ["phone"]
    # The code itself is only ever stored hashed; nothing here is editable.
    readonly_fields = ["phone", "code_hash", "expires_at", "consumed_at", "attempts", "requested_ip"]

    def has_add_permission(self, request):
        return False
