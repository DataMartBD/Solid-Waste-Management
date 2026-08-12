from django.urls import include, path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register("bills", views.BillViewSet, basename="bill")
router.register("payments", views.PaymentViewSet, basename="payment")
router.register("deposits", views.DepositViewSet, basename="deposit")
router.register("remittances", views.RemittanceViewSet, basename="remittance")
router.register("billing-runs", views.BillingRunViewSet, basename="billing-run")

urlpatterns = [path("", include(router.urls))]
