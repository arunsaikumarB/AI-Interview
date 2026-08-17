"""Structured resume logs — never include resume text, embeddings, or paths."""

from __future__ import annotations

import logging

logger = logging.getLogger("hireos.resume")


def resume_log(
    *,
    candidate_id: str,
    organization_id: str,
    task_id: str,
    stage: str,
    success: bool,
    error_class: str | None = None,
) -> None:
    logger.info(
        "resume_process candidate_id=%s organization_id=%s task_id=%s stage=%s success=%s error_class=%s",
        candidate_id,
        organization_id,
        task_id,
        stage,
        "true" if success else "false",
        error_class or "",
    )
