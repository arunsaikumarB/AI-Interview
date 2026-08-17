"""Local disk paths — same STORAGE_ROOT convention as Next.js."""

from pathlib import Path

from django.conf import settings


def storage_root() -> Path:
    raw = Path(settings.STORAGE_ROOT)
    if raw.is_absolute():
        return raw.resolve()
    return (settings.REPO_ROOT / "storage").resolve()
