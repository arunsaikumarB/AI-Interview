from django.urls import include, path

from apps.accounts.tests.probes import (
    AdminOnlyProbe,
    AdminProbe,
    CandidateProbe,
    HiringManagerProbe,
    HRProbe,
    InterviewerProbe,
    OrgScopeProbe,
    RecruiterOrHRProbe,
    RecruiterProbe,
    RecruitmentStaffProbe,
    StaffProbe,
)
from common.views import HealthView

urlpatterns = [
    path("api/v1/health/", HealthView.as_view()),
    path("api/v1/accounts/", include("apps.accounts.urls")),
    path("api/v1/accounts/probe/admin/", AdminProbe.as_view()),
    path("api/v1/accounts/probe/admin-only/", AdminOnlyProbe.as_view()),
    path("api/v1/accounts/probe/hr/", HRProbe.as_view()),
    path("api/v1/accounts/probe/recruiter/", RecruiterProbe.as_view()),
    path("api/v1/accounts/probe/hiring-manager/", HiringManagerProbe.as_view()),
    path("api/v1/accounts/probe/interviewer/", InterviewerProbe.as_view()),
    path("api/v1/accounts/probe/candidate/", CandidateProbe.as_view()),
    path("api/v1/accounts/probe/staff/", StaffProbe.as_view()),
    path("api/v1/accounts/probe/recruitment-staff/", RecruitmentStaffProbe.as_view()),
    path("api/v1/accounts/probe/recruiter-or-hr/", RecruiterOrHRProbe.as_view()),
    path("api/v1/accounts/probe/org-scope/", OrgScopeProbe.as_view()),
]
