"""Role-based write permissions.

A viewset declares who may write; reads are open to any authenticated user
(scoping of *which rows* they see is done by the viewsets' querysets).

    class HouseholdViewSet(...):
        write_roles = OPERATIONAL_WRITERS | {Role.COLLECTOR}
"""

from rest_framework.permissions import SAFE_METHODS, BasePermission

from .roles import ADMIN_WRITERS, OPERATIONAL_WRITERS, Role

SAFE = SAFE_METHODS


class RoleWritePermission(BasePermission):
    """Reads for everyone signed in; writes only for the view's `write_roles`."""

    message = "Your role cannot modify this record."

    def has_permission(self, request, view):
        user = request.user
        if not (user and user.is_authenticated):
            return False
        if request.method in SAFE:
            return True
        if user.is_superuser:
            return True
        allowed = getattr(view, "write_roles", OPERATIONAL_WRITERS)
        return user.role in {getattr(r, "value", r) for r in allowed}


class IsAgencyAdmin(BasePermission):
    message = "Agency administrator access required."

    def has_permission(self, request, view):
        user = request.user
        return bool(
            user
            and user.is_authenticated
            and (user.is_superuser or user.role in {r.value for r in ADMIN_WRITERS})
        )


class IsFieldCollector(BasePermission):
    """The signed-in user is a collector with a linked staff record."""

    message = "Only field collectors can perform this action."

    def has_permission(self, request, view):
        user = request.user
        if not (user and user.is_authenticated):
            return False
        if user.role != Role.COLLECTOR.value:
            return user.is_superuser or user.role in {r.value for r in OPERATIONAL_WRITERS}
        return user.collector_id is not None
