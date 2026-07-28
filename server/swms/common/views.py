"""Base viewsets.

Every domain endpoint inherits `SwmsModelViewSet`, which supplies:

* role-based write permissions (`write_roles`),
* automatic ward scoping so a ward-scoped supervisor or collector only ever sees
  their own rows (`ward_scope_field`),
* `?page_size=all` support for the small collections the SPA loads whole.
"""

from __future__ import annotations

from rest_framework import viewsets

from .permissions import RoleWritePermission
from .roles import OPERATIONAL_WRITERS


class WardScopedQuerysetMixin:
    """Restrict rows to the wards the signed-in user may see.

    `ward_scope_field` is the ORM path from this model to a ward id, e.g.
    `"ward_id"` on Household or `"household__ward_id"` on Payment. Setting it to
    None (the default) means the model is not ward-scoped — reference data,
    fleet, and staff lists are city-wide.
    """

    ward_scope_field: str | None = None

    def scope_queryset(self, queryset):
        user = getattr(self.request, "user", None)
        # The permission class rejects anonymous callers before this runs, but
        # schema generation and any future unauthenticated view would reach it.
        # Returning nothing is the safe default for a scoped resource.
        if user is None or not user.is_authenticated:
            return queryset.none()
        if not self.ward_scope_field:
            return queryset
        ward_ids = user.visible_ward_ids()
        if ward_ids is None:
            return queryset
        return queryset.filter(**{f"{self.ward_scope_field}__in": ward_ids})

    def get_queryset(self):
        return self.scope_queryset(super().get_queryset())


class SwmsModelViewSet(WardScopedQuerysetMixin, viewsets.ModelViewSet):
    """The default CRUD endpoint shape for this project."""

    permission_classes = [RoleWritePermission]
    #: Roles allowed to POST/PATCH/DELETE here.
    write_roles = OPERATIONAL_WRITERS

    def perform_create(self, serializer):
        serializer.save()

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context["user"] = self.request.user
        return context


class SwmsReadOnlyViewSet(WardScopedQuerysetMixin, viewsets.ReadOnlyModelViewSet):
    permission_classes = [RoleWritePermission]
