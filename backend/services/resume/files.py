"""Validate that a Candidate.resumeUrl points at a HireOS resume file we may process."""

from __future__ import annotations

from pathlib import Path

from django.conf import settings

from services.resume.errors import PermanentResumeError
from services.storage.paths import storage_root

ALLOWED_EXTENSIONS = frozenset({".pdf", ".docx", ".txt"})


def normalize_relative(relative: str) -> str:
    return relative.replace("\\", "/").lstrip("/")


def resolve_resume_file(relative_url: str) -> Path:
    rel = normalize_relative(relative_url)
    if not rel or ".." in rel.split("/"):
        raise PermanentResumeError("invalid_storage_location")
    if not rel.startswith("resumes/"):
        raise PermanentResumeError("invalid_storage_location")

    root = storage_root()
    resolved = (root / rel).resolve()
    try:
        resolved.relative_to(root)
    except ValueError as exc:
        raise PermanentResumeError("invalid_storage_location") from exc
    return resolved


def extension_of(path: Path) -> str:
    return path.suffix.lower()


def assert_processable_file(path: Path) -> None:
    if not path.is_file():
        raise PermanentResumeError("missing_resume")
    if extension_of(path) not in ALLOWED_EXTENSIONS:
        raise PermanentResumeError("unsupported_file")
    size = path.stat().st_size
    if size <= 0:
        raise PermanentResumeError("empty_file")
    if size > settings.RESUME_MAX_BYTES:
        raise PermanentResumeError("file_too_large")
