from __future__ import annotations

from django.conf import settings

from services.interviews.errors import PermanentInterviewError, TransientInterviewError
from services.node_cli import run_tsx_json


def _run(script_name: str, args: list[str], timeout: float, extra_flags: list[str] | None = None) -> dict:
    script = settings.REPO_ROOT / "scripts" / script_name
    code, payload = run_tsx_json(script, args, timeout=timeout, extra_flags=extra_flags)
    error_class = str(payload.get("error_class") or "interview_task_failed")
    retryable = bool(payload.get("retryable"))
    if code == 124 or error_class in {"ollama_timeout", "cli_os_error", "parser_runtime_unavailable"}:
        raise TransientInterviewError(error_class)
    if not payload.get("ok"):
        if retryable or error_class in {"ollama_unavailable", "speech_unavailable"}:
            raise TransientInterviewError(error_class)
        raise PermanentInterviewError(error_class)
    return payload


def fingerprint_plan(session_id: str, organization_id: str) -> dict:
    return _run(
        "generate-interview-plan.mjs",
        [session_id, organization_id],
        timeout=60,
        extra_flags=["--fingerprint"],
    )


def generate_plan(session_id: str, organization_id: str) -> dict:
    payload = _run(
        "generate-interview-plan.mjs",
        [session_id, organization_id],
        timeout=float(settings.INTERVIEW_PLAN_TIMEOUT_SECONDS),
    )
    if payload.get("status_unchanged") is False:
        raise PermanentInterviewError("pipeline_mutated")
    return payload


def finalize_interview(session_id: str, organization_id: str) -> dict:
    payload = _run(
        "finalize-interview.mjs",
        [session_id, organization_id],
        timeout=float(settings.INTERVIEW_FINALIZE_TIMEOUT_SECONDS),
    )
    if payload.get("kind") != "INTERVIEW_OVERALL":
        raise PermanentInterviewError("unexpected_evaluation_kind")
    if payload.get("status_unchanged") is False:
        raise PermanentInterviewError("pipeline_mutated")
    return payload


def prefetch_tts(session_id: str, organization_id: str, question_id: str) -> dict:
    return _run(
        "prefetch-question-tts.mjs",
        [session_id, organization_id, question_id],
        timeout=float(settings.INTERVIEW_TTS_TIMEOUT_SECONDS),
    )
