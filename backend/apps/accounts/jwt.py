"""Verify the existing Next.js `aros_session` JWT. Does not mint a new format."""

from __future__ import annotations

from typing import Any

import jwt
from django.conf import settings
from jwt import ExpiredSignatureError, InvalidTokenError
from rest_framework.exceptions import AuthenticationFailed

from apps.accounts.principals import HireOSPrincipal
from apps.accounts.roles import hireos_role_from_jwt


class TokenError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def _secret() -> str:
    secret = getattr(settings, "AUTH_SECRET", "") or ""
    if not secret:
        raise TokenError("misconfigured", "AUTH_SECRET is not set")
    return secret


def decode_hireos_token(token: str) -> dict[str, Any]:
    try:
        return jwt.decode(
            token,
            _secret(),
            algorithms=["HS256"],
            options={
                "require": ["exp", "sub"],
                "verify_aud": False,
            },
        )
    except ExpiredSignatureError as exc:
        raise TokenError("expired", "Token expired") from exc
    except InvalidTokenError as exc:
        raise TokenError("invalid", "Invalid token") from exc


def principal_from_payload(payload: dict[str, Any]) -> HireOSPrincipal:
    sub = payload.get("sub")
    email = payload.get("email")
    source_role = payload.get("role")
    if not isinstance(sub, str) or not sub:
        raise TokenError("malformed", "Token missing subject")
    if not isinstance(email, str) or not email:
        raise TokenError("malformed", "Token missing email")
    if not isinstance(source_role, str):
        raise TokenError("malformed", "Token missing role")
    role = hireos_role_from_jwt(source_role)
    if role is None:
        raise TokenError("malformed", "Token has unknown role")
    org = payload.get("organizationId")
    organization_id = org if isinstance(org, str) and org else None
    name = payload.get("name") if isinstance(payload.get("name"), str) else ""
    return HireOSPrincipal(
        id=sub,
        email=email,
        name=name,
        role=role,
        source_role=source_role,
        organization_id=organization_id,
    )


def authenticate_token(token: str) -> HireOSPrincipal:
    if not token or not isinstance(token, str):
        raise TokenError("malformed", "Malformed token")
    token = token.strip()
    if token.count(".") != 2:
        raise TokenError("malformed", "Malformed token")
    return principal_from_payload(decode_hireos_token(token))


def token_error_to_auth_failed(exc: TokenError) -> AuthenticationFailed:
    return AuthenticationFailed(detail=exc.message, code=exc.code)
