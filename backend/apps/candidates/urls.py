from django.urls import path

from apps.candidates.views import CandidateDetailView, CandidateListView

urlpatterns = [
    path("", CandidateListView.as_view(), name="candidate-list"),
    path("<str:id>/", CandidateDetailView.as_view(), name="candidate-detail"),
]
