from django.urls import include, path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register("vans", views.VanViewSet, basename="van")
router.register("maintenance", views.MaintenanceViewSet, basename="maintenance")
router.register("fuel-logs", views.FuelLogViewSet, basename="fuel-log")

urlpatterns = [
    # The map's snapshot is not a fleet resource in REST terms — it is a
    # cross-cutting read of vans, collectors, routes and households — so it sits
    # at /api/live/ next to the /ws/live/ stream it pairs with.
    path("live/", views.LiveMapView.as_view(), name="live-map"),
    path("positions/ingest/", views.PositionIngestView.as_view(), name="position-ingest"),
    path("", include(router.urls)),
]
