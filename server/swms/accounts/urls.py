"""Auth routes, all under /api/auth/.

Managing *other people's* accounts is not authentication, so it is not here —
see `user_urls.py`, mounted at /api/users/ alongside the other registers.
"""

from django.urls import path

from . import views

urlpatterns = [
    path("login/", views.PasswordLoginView.as_view(), name="password-login"),
    path("password/", views.PasswordChangeView.as_view(), name="password-change"),
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
