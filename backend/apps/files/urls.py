from django.urls import path

from apps.files.views import ResumeProcessStatusView, ResumeProcessView

urlpatterns = [
    path("process/", ResumeProcessView.as_view(), name="resume-process"),
    path("status/", ResumeProcessStatusView.as_view(), name="resume-process-status"),
]
