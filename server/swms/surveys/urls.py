from django.urls import include, path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register("survey-forms", views.SurveyFormViewSet, basename="survey-form")
router.register("surveys", views.SurveyViewSet, basename="survey")

urlpatterns = [path("", include(router.urls))]
