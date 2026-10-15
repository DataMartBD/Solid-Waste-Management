from django.urls import path

from . import views

urlpatterns = [
    path("login/", views.LoginView.as_view(), name="citizen-login"),
    path("me/", views.MeView.as_view(), name="citizen-me"),
    path("pin/", views.PinView.as_view(), name="citizen-pin"),
    path("holdings/<str:holding_id>/", views.HoldingView.as_view(), name="citizen-holding"),
    path("complaints/", views.ComplaintsView.as_view(), name="citizen-complaints"),
    path("complaints/<str:complaint_id>/reopen/", views.ReopenView.as_view(), name="citizen-reopen"),
    path("complaints/<str:complaint_id>/photos/", views.PhotosView.as_view(), name="citizen-photos"),
]
