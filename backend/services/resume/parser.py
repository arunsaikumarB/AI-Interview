"""Invoke the existing Node extractResumeText implementation for parser parity."""

from __future__ import annotations

import json
import os
import subprocess
import tempfile
from pathlib import Path

from django.conf import settings

from services.resume.errors import PermanentResumeError, TransientResumeError


def _tsx_bin() -> Path:
    name = "tsx.cmd" if os.name == "nt" else "tsx"
    return settings.REPO_ROOT / "node_modules" / ".bin" / name


def extract_resume_text(absolute_path: Path) -> str:
    tsx = _tsx_bin()
    script = settings.REPO_ROOT / "scripts" / "extract-resume.mjs"
    if not tsx.exists() or not script.exists():
        raise TransientResumeError("parser_runtime_unavailable")

    fd, out_name = tempfile.mkstemp(suffix=".json", prefix="hireos-resume-")
    os.close(fd)
    out_path = Path(out_name)
    try:
        kwargs: dict = {
            "cwd": str(settings.REPO_ROOT),
            "capture_output": True,
            "timeout": settings.RESUME_PARSE_TIMEOUT_SECONDS,
            "check": False,
        }
        if os.name == "nt":
            kwargs["creationflags"] = subprocess.CREATE_NO_WINDOW
        completed = subprocess.run(
            [str(tsx), str(script), str(absolute_path), str(out_path)],
            **kwargs,
        )
        if completed.returncode != 0 and not out_path.exists():
            raise PermanentResumeError("parser_failure")
        try:
            payload = json.loads(out_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise PermanentResumeError("parser_failure") from exc
        if not payload.get("ok"):
            error_class = str(payload.get("error_class") or "parser_failure")
            raise PermanentResumeError(error_class)
        text = payload.get("text")
        if not isinstance(text, str) or not text.strip():
            raise PermanentResumeError("empty_resume_text")
        return text
    except subprocess.TimeoutExpired as exc:
        raise TransientResumeError("parser_timeout") from exc
    except OSError as exc:
        raise TransientResumeError("parser_os_error") from exc
    finally:
        out_path.unlink(missing_ok=True)
