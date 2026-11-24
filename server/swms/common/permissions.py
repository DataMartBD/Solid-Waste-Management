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


def sees_money(user) -> bool:
    """Whether this account is shown money: bills, payments, revenue.

    The City Viewer is the corporation's oversight login for service and
    complaints; billing is between a contractor and its customers, so none of
    it is shown to that role.
    """
    if not (user and user.is_authenticated):
        return False
    return user.is_superuser or user.role != Role.KCC_VIEWER.value


class SeesMoney(BasePermission):
    """Refuses the financial endpoints to the City Viewer."""

    message = "Financial reports are not available to the City Viewer."

    def has_permission(self, request, view):
        return sees_money(request.user)


class IsCityViewerOrSuperAdmin(BasePermission):
    """The City Dashboard: the City Viewer's own screen, and the super admin's."""

    message = "The City Dashboard is for the City Viewer and the super admin."

    def has_permission(self, request, view):
        user = request.user
        return bool(
            user and user.is_authenticated
            and (user.is_superuser or user.role in {Role.KCC_VIEWER.value, Role.SUPER_ADMIN.value})
        )


class IsAgencyReporter(BasePermission):
    """Agency Reports: the agency admin, the supervisor and the super admin.

    What each sees is narrowed by the report itself (own agency, own wards).
    """

    message = "Agency reports are for agency admins, supervisors and the super admin."

    def has_permission(self, request, view):
        user = request.user
        return bool(
            user and user.is_authenticated
            and (user.is_superuser or user.role in {
                Role.AGENCY_ADMIN.value, Role.SUPERVISOR.value, Role.SUPER_ADMIN.value})
        )


class IsNotCityViewer(BasePermission):
    """The Daily Dashboard: every signed-in role except the City Viewer.

    The City Viewer has the City Dashboard instead; this keeps the daily one's
    figures from being read by calling its endpoint directly.
    """

    message = "The Daily Dashboard is not available to the City Viewer; use the City Dashboard."

    def has_permission(self, request, view):
        user = request.user
        return bool(user and user.is_authenticated and getattr(user, "role", None) != Role.KCC_VIEWER.value)
