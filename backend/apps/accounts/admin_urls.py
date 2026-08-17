from django.urls import path

from apps.accounts.admin_views import (
    AdminDepartmentListWriteView,
    AdminDepartmentWriteView,
    AdminOrganizationWriteView,
    AdminUserListWriteView,
    AdminUserWriteView,
)

urlpatterns = [
    path("users/", AdminUserListWriteView.as_view(), name="admin-users-write"),
    path("users/<str:id>/", AdminUserWriteView.as_view(), name="admin-user-write"),
    path("departments/", AdminDepartmentListWriteView.as_view(), name="admin-departments-write"),
    path(
        "departments/<str:id>/",
        AdminDepartmentWriteView.as_view(),
        name="admin-department-write",
    ),
    path("org/", AdminOrganizationWriteView.as_view(), name="admin-org-write"),
]
