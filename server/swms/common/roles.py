"""Roles.

Stored as slugs, exposed to the SPA as the display labels it already switches on
(`'Collector'`, `'Supervisor'`, `'Agency Admin'`, `'KCC Viewer'`).

The mock app gated routes only on "is logged in"; the sidebar showed every page
to everyone. Here the five roles get real, distinct capabilities:

    collector     — sees their own round; records visits, payments, complaint notes
    supervisor    — full operational control over their zone's wards
    agency_admin  — everything **for one contractor**: their own staff, fleet,
                    holdings, bills and users, and nothing belonging to another
    super_admin   — the corporation's own administrator: every agency at once,
                    plus the city-wide master data no single contractor owns
    kcc_viewer    — read-only city-wide oversight (reports, dashboards)

The line between the last two is the tenancy boundary. An agency admin is a
tenant: `User.agency` is what confines them, and every scoped queryset narrows
to it. A super admin has no agency and so is narrowed by nothing — which is why
the two are separate roles rather than one role with a flag, and why an account
must never be both.
"""

from django.db import models


class Role(models.TextChoices):
    COLLECTOR = "collector", "Collector"
    SUPERVISOR = "supervisor", "Supervisor"
    AGENCY_ADMIN = "agency_admin", "Agency Admin"
    SUPER_ADMIN = "super_admin", "Super Admin"
    KCC_VIEWER = "kcc_viewer", "KCC Viewer"


#: Roles allowed to change operational records (routes, households, complaints…).
OPERATIONAL_WRITERS = {Role.SUPERVISOR, Role.AGENCY_ADMIN, Role.SUPER_ADMIN}

#: Roles allowed to change master data *within an agency* — staff, fleet, the
#: agency's own users. An agency admin may do all of this for their own
#: contractor; the querysets are what stop them reaching another's.
ADMIN_WRITERS = {Role.AGENCY_ADMIN, Role.SUPER_ADMIN}

#: Roles allowed to change what belongs to **no single agency**: the city's
#: wards, roads, zones and service tiers, the billing run that charges every
#: contractor at once, and the agency register itself.
#:
#: Separate from `ADMIN_WRITERS` because an agency admin confined to their own
#: contractor has no business redrawing the city's ward list or issuing a
#: city-wide charge — those are the corporation's acts, not a tenant's.
SUPER_ADMINS = {Role.SUPER_ADMIN}

#: Roles that may never write anything.
READ_ONLY = {Role.KCC_VIEWER}

#: Landing route after login — mirrors ROLE_HOME in the React AuthContext.
ROLE_HOME = {
    Role.COLLECTOR: "/app/collection",
    Role.SUPERVISOR: "/app/dashboard",
    Role.AGENCY_ADMIN: "/app/dashboard",
    Role.SUPER_ADMIN: "/app/dashboard",
    Role.KCC_VIEWER: "/app/reports",
}


def label_for(role: str) -> str:
    return Role(role).label


def role_from_label(label: str) -> str:
    for choice in Role:
        if choice.label == label:
            return choice.value
    raise ValueError(f"unknown role label: {label!r}")
