from django.urls import include, path

from common.views import HealthView

urlpatterns = [
    path("api/v1/health/", HealthView.as_view(), name="health"),
    path("api/v1/accounts/", include("apps.accounts.urls")),
    path("api/v1/admin/", include("apps.accounts.admin_urls")),
    path("api/v1/jobs/", include("apps.jobs.urls")),
    path("api/v1/candidates/", include("apps.candidates.urls")),
    path("api/v1/applications/", include("apps.applications.urls")),
    path("api/v1/resumes/", include("apps.files.urls")),
    path("api/v1/screening/", include("apps.screening.urls")),
    path("api/v1/interviews/", include("apps.interviews.urls")),
    path("api/v1/proctoring/", include("apps.proctoring.urls")),
]
