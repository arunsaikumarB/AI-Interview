from django.urls import path

from apps.proctoring.views import ProctoringProcessView, ProctoringStatusView

urlpatterns = [
    path("process/", ProctoringProcessView.as_view(), name="proctoring-process"),
    path("status/", ProctoringStatusView.as_view(), name="proctoring-status"),
]
