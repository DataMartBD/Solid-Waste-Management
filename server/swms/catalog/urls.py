from django.urls import include, path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register("zones", views.ZoneViewSet, basename="zone")
router.register("wards", views.WardViewSet, basename="ward")
router.register("blocks", views.BlockViewSet, basename="block")
router.register("roads", views.RoadViewSet, basename="road")
router.register("tiers", views.TierViewSet, basename="tier")

urlpatterns = [
    path("catalog/", views.catalog_bundle, name="catalog-bundle"),
    path("", include(router.urls)),
]
