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
    # City Corporation oversight
    path("city-collection/", views.city_collection, name="report-city-collection"),
    path("service-trend/", views.service_trend, name="report-service-trend"),
    path("complaint-performance/", views.complaint_performance, name="report-complaint-performance"),
    path("complaints-overdue/", views.complaints_overdue, name="report-complaints-overdue"),
    path("register/<str:kind>/", views.register, name="report-register"),
    path("agency-targets/", views.agency_targets, name="report-agency-targets"),
    path("oversight/", views.oversight_summary, name="report-oversight"),
    path("agency/scorecard/", views.agency_scorecard, name="report-agency-scorecard"),
    path("agency/complaint-performance/", views.agency_complaint_performance, name="report-agency-complaint-performance"),
    path("agency/complaints-overdue/", views.agency_complaints_overdue, name="report-agency-complaints-overdue"),
    path("agency/register/<str:kind>/", views.agency_register, name="report-agency-register"),
    path("agency/contract/", views.agency_contract, name="report-agency-contract"),
    path("agency/cash-in-hand/", views.agency_cash_in_hand, name="report-agency-cash-in-hand"),
    path("agency/dues-ageing/", views.agency_dues_ageing, name="report-agency-dues-ageing"),
    path("agency/collection-sheet/", views.agency_collection_sheet, name="report-agency-collection-sheet"),
    path("agency/missed-holdings/", views.agency_missed_holdings, name="report-agency-missed-holdings"),
    path("agency/fuel/", views.agency_fuel, name="report-agency-fuel"),
    path("agency/maintenance/", views.agency_maintenance, name="report-agency-maintenance"),
    path("agency/survey-progress/", views.agency_survey_progress, name="report-agency-survey-progress"),
    path("agency/repeat-complaints/", views.agency_repeat_complaints, name="report-agency-repeat-complaints"),
    path("agency/route-completion/", views.agency_route_completion, name="report-agency-route-completion"),
    path("agency/billing-runs/", views.agency_billing_runs, name="report-agency-billing-runs"),
    path("agency/attendance/", views.agency_attendance, name="report-agency-attendance"),
    path("agency/monthly-pack/", views.agency_monthly_pack, name="report-agency-monthly-pack"),
]
