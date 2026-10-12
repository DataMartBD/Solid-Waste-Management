from django.urls import include, path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register("city-types", views.CityTypeViewSet, basename="city-type")
router.register("agency-types", views.AgencyTypeViewSet, basename="agency-type")
router.register("cities", views.CityViewSet, basename="city")
router.register("dumping-points", views.DumpingPointViewSet, basename="dumping-point")
router.register("zones", views.ZoneViewSet, basename="zone")
router.register("wards", views.WardViewSet, basename="ward")
router.register("blocks", views.BlockViewSet, basename="block")
router.register("roads", views.RoadViewSet, basename="road")
router.register("tiers", views.TierViewSet, basename="tier")

urlpatterns = [
    path("catalog/", views.catalog_bundle, name="catalog-bundle"),
    path("", include(router.urls)),
]
