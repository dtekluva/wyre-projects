from django.urls import path

from . import views

urlpatterns = [
    path("health/", views.HealthView.as_view()),
    path("auth/token/", views.TokenView.as_view()),
    path("auth/token/refresh/", views.RefreshView.as_view()),
    path("me/", views.MeView.as_view()),
    path("snapshot/", views.SnapshotView.as_view()),
    path("commands/<str:name>/", views.CommandView.as_view()),
    path("reviews/", views.ReviewQueueView.as_view()),
    path("approvals/mine/", views.ApprovalsForMeView.as_view()),
    path("projects/<str:project_id>/money/", views.MoneyView.as_view()),
    path("stock/balances/", views.BalancesView.as_view()),
    path("finance/qb-bills/", views.QbBillsView.as_view()),
]
