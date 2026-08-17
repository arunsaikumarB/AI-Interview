from django.urls import path

from apps.interviews.views import (
    InterviewFinalizeView,
    InterviewPlanView,
    InterviewTaskStatusView,
    InterviewTtsView,
)

urlpatterns = [
    path("plan/", InterviewPlanView.as_view(), name="interview-plan"),
    path("finalize/", InterviewFinalizeView.as_view(), name="interview-finalize"),
    path("tts/", InterviewTtsView.as_view(), name="interview-tts"),
    path("status/", InterviewTaskStatusView.as_view(), name="interview-task-status"),
]
