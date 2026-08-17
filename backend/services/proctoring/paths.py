"""Safe local paths for secondary recordings. Never trusts client paths."""

from __future__ import annotations

import re
from pathlib import Path

from django.conf import settings

from services.proctoring.errors import PermanentProctoringError

SAFE_ID = re.compile(r"^[a-zA-Z0-9_-]{8,80}$")
CHUNK_NAME = re.compile(r"^chunk-(\d{6})\.part$")


def storage_root() -> Path:
    raw = Path(settings.STORAGE_ROOT)
    if raw.is_absolute():
        return raw.resolve()
    return (Path(settings.REPO_ROOT) / "storage").resolve()


def assert_safe_id(value: str, *, field: str) -> str:
    if not SAFE_ID.fullmatch(value or ""):
        raise PermanentProctoringError("invalid_id")
    if ".." in value or "/" in value or "\\" in value:
        raise PermanentProctoringError("invalid_id")
    return value


def recording_dir(session_id: str, recording_id: str) -> Path:
    session_id = assert_safe_id(session_id, field="session_id")
    recording_id = assert_safe_id(recording_id, field="recording_id")
    root = storage_root()
    path = (root / "interviews" / session_id / "secondary-camera" / recording_id).resolve()
    try:
        path.relative_to(root)
    except ValueError as exc:
        raise PermanentProctoringError("path_traversal") from exc
    return path


def stored_file_ok(relative_path: str | None) -> bool:
    if not relative_path or ".." in relative_path.replace("\\", "/").split("/"):
        return False
    try:
        candidate = (storage_root() / relative_path.replace("\\", "/").lstrip("/")).resolve()
        candidate.relative_to(storage_root())
    except ValueError:
        return False
    return candidate.is_file() and candidate.stat().st_size > 0


def relative_posix(path: Path) -> str:
    return path.resolve().relative_to(storage_root()).as_posix()


def list_chunk_indexes(directory: Path) -> list[int]:
    if not directory.is_dir():
        return []
    found: list[int] = []
    for name in directory.iterdir():
        if not name.is_file():
            continue
        match = CHUNK_NAME.fullmatch(name.name)
        if match:
            found.append(int(match.group(1)))
    return sorted(found)


def chunk_path(directory: Path, index: int) -> Path:
    return directory / f"chunk-{index:06d}.part"


def final_path(directory: Path, ext: str) -> Path:
    if ext not in {"webm", "mp4"}:
        ext = "webm"
    return directory / f"recording.{ext}"
