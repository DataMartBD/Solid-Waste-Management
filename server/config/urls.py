"""Root URL configuration.

Everything the SPA talks to lives under /api/. The frontend's VITE_API_BASE_URL
points at this prefix.
"""

from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import include, path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView

api_patterns = [
    path("auth/", include("swms.accounts.urls")),
    path("", include("swms.catalog.urls")),
    path("", include("swms.customers.urls")),
    path("", include("swms.fieldops.urls")),
    path("", include("swms.fleet.urls")),
    path("", include("swms.complaints.urls")),
    path("", include("swms.billing.urls")),
    path("reports/", include("swms.reports.urls")),
    path("ai/", include("swms.ai.urls")),
]

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/", include(api_patterns)),
    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
    path(
        "api/docs/",
        SpectacularSwaggerView.as_view(url_name="schema"),
        name="swagger-ui",
    ),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
