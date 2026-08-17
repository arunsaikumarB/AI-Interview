"""Structured screening logs — never include resume, prompts, reasoning, or scores text."""

from __future__ import annotations

import logging

logger = logging.getLogger("hireos.screening")


def screening_log(
    *,
    application_id: str,
    organization_id: str,
    task_id: str,
    stage: str,
    success: bool,
    error_class: str | None = None,
) -> None:
    logger.info(
        "screen_application application_id=%s organization_id=%s task_id=%s stage=%s success=%s error_class=%s",
        application_id,
        organization_id,
        task_id,
        stage,
        "true" if success else "false",
        error_class or "",
    )
