from __future__ import annotations

import logging

logger = logging.getLogger("hireos.interview")


def interview_log(
    *,
    session_id: str,
    organization_id: str,
    task_id: str,
    kind: str,
    stage: str,
    success: bool,
    error_class: str | None = None,
) -> None:
    logger.info(
        "interview_bg session_id=%s organization_id=%s task_id=%s kind=%s stage=%s success=%s error_class=%s",
        session_id,
        organization_id,
        task_id,
        kind,
        stage,
        "true" if success else "false",
        error_class or "",
    )
