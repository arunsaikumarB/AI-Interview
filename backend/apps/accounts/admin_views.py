from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.admin_write import (
    DEPT_WRITE_KEYS,
    ORG_WRITE_KEYS,
    USER_WRITE_KEYS,
    create_department,
    create_staff_user,
    delete_department,
    extra_keys,
    rename_department,
    update_organization,
    update_staff_user,
)
from apps.accounts.authentication import HireOSJWTAuthentication
from apps.accounts.permissions import IsAdminOrHR
from apps.accounts.scoping import require_organization_id


def _err(exc):
    if isinstance(exc, PermissionDenied):
        return Response({"error": str(exc.detail)}, status=403)
    if isinstance(exc, NotFound):
        detail = getattr(exc, "detail", "Not found")
        message = str(detail) if not isinstance(detail, list) else str(detail[0])
        if "Department" in message:
            return Response({"error": "Department not found"}, status=404)
        if "Organization" in message:
            return Response({"error": "Organization not found"}, status=404)
        return Response({"error": "User not found"}, status=404)
    if isinstance(exc, ValidationError):
        detail = exc.detail
        if isinstance(detail, list) and detail:
            message = str(detail[0])
        elif isinstance(detail, str):
            message = detail
        else:
            message = "Validation failed"
        status = 409 if message == "Email already in use" else 400
        return Response({"error": message}, status=status)
    raise exc


class AdminUserListWriteView(APIView):
    authentication_classes = [HireOSJWTAuthentication]
    permission_classes = [IsAuthenticated, IsAdminOrHR]

    def post(self, request):
        org_id = require_organization_id(request.user)
        data = request.data if isinstance(request.data, dict) else {}
        if extra_keys(data, USER_WRITE_KEYS):
            return Response({"error": "Unsupported fields"}, status=400)
        try:
            result = create_staff_user(
                organization_id=org_id,
                actor_source_role=request.user.source_role,
                body=data,
            )
        except (ValidationError, PermissionDenied, NotFound) as exc:
            return _err(exc)
        return Response(result, status=201)


class AdminUserWriteView(APIView):
    authentication_classes = [HireOSJWTAuthentication]
    permission_classes = [IsAuthenticated, IsAdminOrHR]

    def patch(self, request, id: str):
        org_id = require_organization_id(request.user)
        data = request.data if isinstance(request.data, dict) else {}
        if extra_keys(data, USER_WRITE_KEYS - {"email"}):
            return Response({"error": "Unsupported fields"}, status=400)
        try:
            result = update_staff_user(
                user_id=id,
                organization_id=org_id,
                actor_id=request.user.id,
                actor_source_role=request.user.source_role,
                body=data,
            )
        except (ValidationError, PermissionDenied, NotFound) as exc:
            return _err(exc)
        return Response(result)


class AdminDepartmentListWriteView(APIView):
    authentication_classes = [HireOSJWTAuthentication]
    permission_classes = [IsAuthenticated, IsAdminOrHR]

    def post(self, request):
        org_id = require_organization_id(request.user)
        data = request.data if isinstance(request.data, dict) else {}
        if extra_keys(data, DEPT_WRITE_KEYS):
            return Response({"error": "Unsupported fields"}, status=400)
        try:
            department = create_department(organization_id=org_id, name=data.get("name"))
        except (ValidationError, PermissionDenied, NotFound) as exc:
            return _err(exc)
        return Response({"department": department}, status=201)


class AdminDepartmentWriteView(APIView):
    authentication_classes = [HireOSJWTAuthentication]
    permission_classes = [IsAuthenticated, IsAdminOrHR]

    def patch(self, request, id: str):
        org_id = require_organization_id(request.user)
        data = request.data if isinstance(request.data, dict) else {}
        if extra_keys(data, DEPT_WRITE_KEYS):
            return Response({"error": "Unsupported fields"}, status=400)
        try:
            department = rename_department(
                department_id=id, organization_id=org_id, name=data.get("name")
            )
        except (ValidationError, PermissionDenied, NotFound) as exc:
            return _err(exc)
        return Response({"department": department})

    def delete(self, request, id: str):
        org_id = require_organization_id(request.user)
        try:
            delete_department(department_id=id, organization_id=org_id)
        except (ValidationError, PermissionDenied, NotFound) as exc:
            return _err(exc)
        return Response({"ok": True})


class AdminOrganizationWriteView(APIView):
    authentication_classes = [HireOSJWTAuthentication]
    permission_classes = [IsAuthenticated, IsAdminOrHR]

    def patch(self, request):
        org_id = require_organization_id(request.user)
        data = request.data if isinstance(request.data, dict) else {}
        if extra_keys(data, ORG_WRITE_KEYS):
            return Response({"error": "Unsupported fields"}, status=400)
        try:
            organization = update_organization(organization_id=org_id, body=data)
        except (ValidationError, PermissionDenied, NotFound) as exc:
            return _err(exc)
        return Response({"organization": organization})
