"""Report routes, all under /api/reports/."""

from django.urls import path

from . import views

urlpatterns = [
    # Service delivery
    path("waste-collection/", views.waste_collection, name="report-waste-collection"),
    path("service-series/", views.service_series, name="report-service-series"),
    path("ward-collection/", views.ward_collection, name="report-ward-collection"),
    # Revenue
    path("bill-collection/", views.bill_collection, name="report-bill-collection"),
    path("bill-status/", views.bill_status, name="report-bill-status"),
    path("customer-collection/", views.customer_collection, name="report-customer-collection"),
    path("customer-bill-status/", views.customer_bill_status, name="report-customer-bill-status"),
    path("reconciliation/", views.reconciliation, name="report-reconciliation"),
    # Headline figures
    path("kpis/", views.kpis, name="report-kpis"),
    path("waste-by-zone/", views.waste_by_zone, name="report-waste-by-zone"),
    path("complaint-summary/", views.complaint_summary, name="report-complaint-summary"),
    path("customer-funnel/", views.customer_funnel, name="report-customer-funnel"),
    path("dashboard/", views.dashboard, name="report-dashboard"),
]
