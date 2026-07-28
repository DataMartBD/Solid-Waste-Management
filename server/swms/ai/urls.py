from django.urls import path

from . import views

urlpatterns = [
    path("ask/", views.AskView.as_view(), name="ai-ask"),
    path("facts/", views.FactsView.as_view(), name="ai-facts"),
]
