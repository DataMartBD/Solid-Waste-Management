"""The user register: /api/users/.

Mounted beside holdings, collectors and agencies rather than under /api/auth/,
because this is master data about operators — who they are, what they may see —
not the act of signing in. Only an agency administrator may read or write it.
"""

from django.urls import include, path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register("users", views.UserViewSet, basename="user")

urlpatterns = [path("", include(router.urls))]
