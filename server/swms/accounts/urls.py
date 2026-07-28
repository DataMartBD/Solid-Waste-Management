"""Auth routes, all under /api/auth/."""

from django.urls import path

from . import views

urlpatterns = [
    path("otp/request/", views.OtpRequestView.as_view(), name="otp-request"),
    path("otp/verify/", views.OtpVerifyView.as_view(), name="otp-verify"),
    path("pin/status/", views.PinStatusView.as_view(), name="pin-status"),
    path("pin/login/", views.PinLoginView.as_view(), name="pin-login"),
    # POST sets, PUT changes, DELETE removes.
    path("pin/", views.PinManageView.as_view(), name="pin-manage"),
    path("refresh/", views.RefreshView.as_view(), name="token-refresh"),
    path("logout/", views.LogoutView.as_view(), name="logout"),
    path("me/", views.MeView.as_view(), name="me"),
    path("demo-operators/", views.DemoOperatorsView.as_view(), name="demo-operators"),
]
