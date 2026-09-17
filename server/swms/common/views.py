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
    """Restrict rows to what the signed-in user may see.

    Two independent axes, both narrowing:

    `ward_scope_field` is the ORM path from this model to a ward id, e.g.
    `"ward_id"` on Household or `"household__ward_id"` on Payment. Setting it to
    None (the default) means the model is not ward-scoped — reference data and
    staff lists are city-wide.

    `agency_scope_field` is the path to an agency id. It applies only to users
    who **have** an agency: KCC's own staff and viewers have `User.agency = None`
    and are unaffected, which is what keeps this mechanism inert until somebody
    is deliberately made a tenant.

    Ward alone stopped being sufficient the moment two agencies could work the
    same ward — filtering by ward would hand one contractor the other's rows.
    Both filters apply, so a ward-scoped agency supervisor sees the intersection.

    A model that *can* belong to an agency but has no `agency_scope_field` is a
    leak by omission, so `agency_scope_field = None` should be a decision with a
    comment, exactly as `ward_scope_field = None` already is.
    """

    ward_scope_field: str | None = None
    agency_scope_field: str | None = None

    def scope_queryset(self, queryset):
        user = getattr(self.request, "user", None)
        # The permission class rejects anonymous callers before this runs, but
        # schema generation and any future unauthenticated view would reach it.
        # Returning nothing is the safe default for a scoped resource.
        if user is None or not user.is_authenticated:
            return queryset.none()

        if self.ward_scope_field:
            ward_ids = user.visible_ward_ids()
            if ward_ids is not None:
                queryset = queryset.filter(**{f"{self.ward_scope_field}__in": ward_ids})

        if self.agency_scope_field:
            agency_id = user.visible_agency_id()
            if agency_id is not None:
                queryset = queryset.filter(**{self.agency_scope_field: agency_id})
        return queryset

    def get_queryset(self):
        return self.scope_queryset(super().get_queryset())


class StampsCreatorAgencyMixin:
    """Give a new row the creating user's agency, when they have one.

    Agency is an access boundary, and the filter that enforces it matches on the
    column — so a row created with none is invisible to every agency-bound user,
    including the one who just created it. That is not a theoretical shape: it is
    how five holdings and two routes ended up unreachable before this existed.

    Only fills a gap, never overrides. A caller who names an agency has already
    been checked against their own by the serializer's `guard_agency`, and a
    survey converted into a holding carries the agency of whoever walked the
    street — neither should be second-guessed here.

    An unbound creator — KCC's own staff, a super admin — has nothing to infer
    from, so the field is left as sent. For them the answer has to come from the
    form, which is why `agency` is writable on both endpoints.
    """

    def perform_create(self, serializer):
        mine = self.request.user.visible_agency_id()
        if mine is not None and not serializer.validated_data.get("agency"):
            serializer.save(agency_id=mine)
            return
        serializer.save()


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
