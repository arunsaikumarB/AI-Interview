"""Local Ollama embeddings — nomic-embed-text, 768-d. Never cloud."""

from __future__ import annotations

from django.conf import settings

from services.ai.ollama import OllamaClient
from services.resume.errors import PermanentResumeError, TransientResumeError


def build_candidate_embed_text(
    *,
    summary: str | None,
    skills: list[str] | None,
    experience: float | int | None,
    resume_text: str | None,
) -> str:
    skill_list = [s for s in (skills or []) if s]
    parts = [
        (summary or "").strip(),
        f"Skills: {', '.join(skill_list)}" if skill_list else "",
        f"Experience: {experience} years",
        (resume_text or "").strip(),
    ]
    return "\n\n".join(p for p in parts if p)[: settings.RESUME_EMBED_MAX_CHARS]


def embed_text(text: str) -> list[float]:
    if not text.strip():
        raise PermanentResumeError("empty_embed_text")
    client = OllamaClient.from_settings()
    try:
        vector = client.embed(text, timeout=float(settings.OLLAMA_EMBED_TIMEOUT_SECONDS))
    except TimeoutError as exc:
        raise TransientResumeError("ollama_timeout") from exc
    except OSError as exc:
        raise TransientResumeError("ollama_unavailable") from exc
    expected = settings.RESUME_EMBED_DIMS
    if len(vector) != expected:
        raise PermanentResumeError("embedding_dimension_mismatch")
    return vector
