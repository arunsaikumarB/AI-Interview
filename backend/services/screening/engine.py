"""Invoke existing Next.js screenApplication via tsx. IDs only."""

from __future__ import annotations

from django.conf import settings

from services.node_cli import run_tsx_json
from services.screening.errors import PermanentScreeningError, TransientScreeningError

ALLOWED_RECOMMENDATIONS = frozenset({"YES", "MAYBE", "NO"})


def _script():
    return settings.REPO_ROOT / "scripts" / "screen-application.mjs"


def fingerprint_prompt(application_id: str, organization_id: str) -> dict:
    code, payload = run_tsx_json(
        _script(),
        [application_id, organization_id],
        timeout=60,
        extra_flags=["--fingerprint"],
    )
    if not payload.get("ok"):
        raise PermanentScreeningError(str(payload.get("error_class") or "fingerprint_failed"))
    if code != 0:
        raise PermanentScreeningError("fingerprint_failed")
    return payload


def run_existing_screen_engine(application_id: str, organization_id: str) -> dict:
    timeout = float(settings.SCREENING_PROCESS_TIMEOUT_SECONDS)
    code, payload = run_tsx_json(
        _script(),
        [application_id, organization_id],
        timeout=timeout,
    )
    error_class = str(payload.get("error_class") or "screening_failure")
    retryable = bool(payload.get("retryable"))
    if code == 124 or error_class in {"ollama_timeout", "cli_os_error", "parser_runtime_unavailable"}:
        raise TransientScreeningError(error_class)
    if not payload.get("ok"):
        if retryable or error_class == "ollama_unavailable":
            raise TransientScreeningError(error_class)
        raise PermanentScreeningError(error_class)
    if payload.get("kind") != "RESUME_SCREEN":
        raise PermanentScreeningError("unexpected_evaluation_kind")
    if payload.get("recommendation") not in ALLOWED_RECOMMENDATIONS:
        raise PermanentScreeningError("unexpected_recommendation")
    if not payload.get("model"):
        raise PermanentScreeningError("missing_model_provenance")
    if payload.get("stage_unchanged") is False or payload.get("status_unchanged") is False:
        raise PermanentScreeningError("pipeline_mutated")
    return payload
