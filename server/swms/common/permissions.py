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
    """An administrator — of one agency, or of the whole corporation.

    Both are admitted, because everything gated on this is administration *of*
    something an agency owns. What separates them is not the door, it is the
    queryset behind it: an agency admin's narrows to their own contractor, a
    super admin's does not. See `IsSuperAdmin` for the acts that belong to no
    agency at all.
    """

    message = "Agency administrator access required."

    def has_permission(self, request, view):
        user = request.user
        return bool(
            user
            and user.is_authenticated
            and (user.is_superuser or user.role in {r.value for r in ADMIN_WRITERS})
        )


class IsSuperAdmin(BasePermission):
    """The corporation's own administrator.

    For the acts that are not any one contractor's: redrawing the city's wards
    and roads, setting service tiers, registering a new agency, and running the
    month's billing over every agency at once. An agency admin confined to their
    own tenant has no standing to do these, which is the whole point of the
    confinement.
    """

    message = "Super administrator access required."

    def has_permission(self, request, view):
        user = request.user
        return bool(
            user
            and user.is_authenticated
            and (user.is_superuser or user.role == Role.SUPER_ADMIN.value)
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
