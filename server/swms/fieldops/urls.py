from django.urls import include, path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register("collectors", views.CollectorViewSet, basename="collector")
router.register("routes", views.RouteViewSet, basename="route")
router.register("assignments", views.AssignmentViewSet, basename="assignment")
router.register("visits", views.VisitViewSet, basename="visit")

urlpatterns = [
    path("", include(router.urls)),
    # The round and the scanner are read/act endpoints over the tables above
    # rather than resources of their own, so they sit outside the router.
    path("collection/round/", views.CollectionRoundView.as_view(), name="collection-round"),
    path("collection/scan/", views.ScanView.as_view(), name="collection-scan"),
]
