"""DRF authentication: existing HireOS JWT (Bearer or aros_session cookie)."""

from __future__ import annotations

from django.conf import settings
from rest_framework.authentication import BaseAuthentication
from rest_framework.exceptions import AuthenticationFailed
from rest_framework.request import Request

from apps.accounts.directory import directory_from_settings
from apps.accounts.jwt import TokenError, authenticate_token, token_error_to_auth_failed
from apps.accounts.principals import HireOSPrincipal


def extract_token(request: Request) -> str | None:
    header = request.headers.get("Authorization") or request.META.get("HTTP_AUTHORIZATION")
    if header and isinstance(header, str) and header.lower().startswith("bearer "):
        return header[7:].strip() or None
    cookie_name = getattr(settings, "AUTH_COOKIE_NAME", "aros_session")
    cookie = request.COOKIES.get(cookie_name)
    if cookie:
        return cookie
    return None


class HireOSJWTAuthentication(BaseAuthentication):
    def authenticate(self, request: Request) -> tuple[HireOSPrincipal, str] | None:
        token = extract_token(request)
        if not token:
            return None
        try:
            principal = authenticate_token(token)
        except TokenError as exc:
            raise token_error_to_auth_failed(exc) from exc

        if getattr(settings, "HIREOS_ENFORCE_PRISMA_USER_STATUS", True):
            record = directory_from_settings().get(principal.id)
            if record is None:
                raise AuthenticationFailed(detail="Authentication required", code="unknown_user")
            if not record.is_active:
                raise AuthenticationFailed(detail="Authentication required", code="inactive")

        return principal, token

    def authenticate_header(self, request: Request) -> str:
        # DRF returns 403 instead of 401 unless this is set.
        return 'Bearer realm="api"'
