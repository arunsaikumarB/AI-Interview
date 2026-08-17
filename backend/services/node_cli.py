"""Shared tsx subprocess helper. Never logs stdout/stderr bodies (may contain PII)."""

from __future__ import annotations

import json
import os
import subprocess
import tempfile
from pathlib import Path

from django.conf import settings


def tsx_bin() -> Path:
    name = "tsx.cmd" if os.name == "nt" else "tsx"
    return settings.REPO_ROOT / "node_modules" / ".bin" / name


def run_tsx_json(
    script: Path,
    args: list[str],
    *,
    timeout: float,
    extra_flags: list[str] | None = None,
) -> tuple[int, dict]:
    tsx = tsx_bin()
    if not tsx.exists() or not script.exists():
        return 2, {"ok": False, "error_class": "parser_runtime_unavailable", "retryable": True}

    fd, out_name = tempfile.mkstemp(suffix=".json", prefix="hireos-node-")
    os.close(fd)
    out_path = Path(out_name)
    try:
        kwargs: dict = {
            "cwd": str(settings.REPO_ROOT),
            "capture_output": True,
            "timeout": timeout,
            "check": False,
        }
        if os.name == "nt":
            kwargs["creationflags"] = subprocess.CREATE_NO_WINDOW
        completed = subprocess.run(
            [str(tsx), str(script), *args, str(out_path), *(extra_flags or [])],
            **kwargs,
        )
        try:
            payload = json.loads(out_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            payload = {"ok": False, "error_class": "cli_output_invalid", "retryable": False}
        if not isinstance(payload, dict):
            payload = {"ok": False, "error_class": "cli_output_invalid", "retryable": False}
        return completed.returncode, payload
    except subprocess.TimeoutExpired:
        return 124, {"ok": False, "error_class": "ollama_timeout", "retryable": True}
    except OSError:
        return 2, {"ok": False, "error_class": "cli_os_error", "retryable": True}
    finally:
        out_path.unlink(missing_ok=True)
