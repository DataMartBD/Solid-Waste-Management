from django.urls import include, path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register("holdings", views.HoldingViewSet, basename="holding")
router.register("households", views.HouseholdViewSet, basename="household")
router.register("potential-customers", views.PotentialCustomerViewSet, basename="potential")

urlpatterns = [path("", include(router.urls))]
