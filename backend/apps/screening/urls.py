from django.urls import path

from apps.screening.views import ScreeningEnqueueView, ScreeningStatusView

urlpatterns = [
    path("", ScreeningEnqueueView.as_view(), name="screening-enqueue"),
    path("status/", ScreeningStatusView.as_view(), name="screening-status"),
]
