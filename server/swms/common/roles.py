"""Roles.

Stored as slugs, exposed to the SPA as the display labels it already switches on
(`'Collector'`, `'Supervisor'`, `'Agency Admin'`, `'KCC Viewer'`).

The mock app gated routes only on "is logged in"; the sidebar showed every page
to everyone. Here the four roles get real, distinct capabilities:

    collector     — sees their own round; records visits, payments, complaint notes
    supervisor    — full operational control over their zone's wards
    agency_admin  — everything, including staff, fleet and billing runs
    kcc_viewer    — read-only city-wide oversight (reports, dashboards)
"""

from django.db import models


class Role(models.TextChoices):
    COLLECTOR = "collector", "Collector"
    SUPERVISOR = "supervisor", "Supervisor"
    AGENCY_ADMIN = "agency_admin", "Agency Admin"
    KCC_VIEWER = "kcc_viewer", "KCC Viewer"


#: Roles allowed to change operational records (routes, households, complaints…).
OPERATIONAL_WRITERS = {Role.SUPERVISOR, Role.AGENCY_ADMIN}

#: Roles allowed to change master data (staff, fleet, tiers, billing runs).
ADMIN_WRITERS = {Role.AGENCY_ADMIN}

#: Roles that may never write anything.
READ_ONLY = {Role.KCC_VIEWER}

#: Landing route after login — mirrors ROLE_HOME in the React AuthContext.
ROLE_HOME = {
    Role.COLLECTOR: "/app/collection",
    Role.SUPERVISOR: "/app/dashboard",
    Role.AGENCY_ADMIN: "/app/dashboard",
    Role.KCC_VIEWER: "/app/reports",
}


def label_for(role: str) -> str:
    return Role(role).label


def role_from_label(label: str) -> str:
    for choice in Role:
        if choice.label == label:
            return choice.value
    raise ValueError(f"unknown role label: {label!r}")
