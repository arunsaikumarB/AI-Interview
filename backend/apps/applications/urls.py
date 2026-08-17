from django.urls import path

from apps.applications.views import (
    ApplicationDetailView,
    ApplicationListView,
    ApplicationPipelineCountsView,
    ApplicationStageView,
)

urlpatterns = [
    path("", ApplicationListView.as_view(), name="application-list"),
    path(
        "pipeline-counts/",
        ApplicationPipelineCountsView.as_view(),
        name="application-pipeline-counts",
    ),
    path("<str:id>/stage/", ApplicationStageView.as_view(), name="application-stage"),
    path("<str:id>/", ApplicationDetailView.as_view(), name="application-detail"),
]
