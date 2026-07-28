"""Pagination that the SPA can opt out of.

The React contexts load whole collections into memory (households, routes,
collectors are all small), so list endpoints accept `?page_size=all` and return
a bare array. Large tables — visits, bills, payments — stay paginated.
"""

from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response


class SwmsPagination(PageNumberPagination):
    page_size_query_param = "page_size"
    max_page_size = 5000

    def paginate_queryset(self, queryset, request, view=None):
        if request.query_params.get("page_size") == "all":
            self._unpaginated = True
            return None
        self._unpaginated = False
        return super().paginate_queryset(queryset, request, view)

    def get_paginated_response(self, data):
        return Response(
            {
                "count": self.page.paginator.count,
                "page": self.page.number,
                "pages": self.page.paginator.num_pages,
                "next": self.get_next_link(),
                "previous": self.get_previous_link(),
                "results": data,
            }
        )
