"""Ollama HTTP client — foundation only. Does not replace Next.js `src/lib/ai/ollama.ts`."""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Any

from django.conf import settings


class OllamaClient:
    def __init__(
        self,
        *,
        local_url: str,
        cloud_url: str,
        api_key: str,
        provider: str,
        chat_model: str,
        embed_model: str,
        timeout: float = 5.0,
    ) -> None:
        self.local_url = local_url.rstrip("/")
        self.cloud_url = cloud_url.rstrip("/")
        self.api_key = api_key
        self.provider = provider
        self.chat_model = chat_model
        self.embed_model = embed_model
        self.timeout = timeout

    @classmethod
    def from_settings(cls) -> OllamaClient:
        return cls(
            local_url=settings.OLLAMA_LOCAL_URL,
            cloud_url=settings.OLLAMA_CLOUD_URL,
            api_key=settings.OLLAMA_API_KEY,
            provider=settings.AI_PROVIDER,
            chat_model=settings.OLLAMA_CHAT_MODEL,
            embed_model=settings.OLLAMA_EMBED_MODEL,
        )

    def chat_base_url(self) -> str:
        if self.provider.lower() == "cloud":
            return self.cloud_url
        return self.local_url

    def health(self) -> dict[str, Any]:
        """GET /api/tags on local Ollama (embeddings always local)."""
        url = f"{self.local_url}/api/tags"
        try:
            req = urllib.request.Request(url, method="GET")
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                body = json.loads(resp.read().decode("utf-8"))
            models = body.get("models") or []
            names = [m.get("name") for m in models if isinstance(m, dict)]
            return {"ok": True, "url": url, "models": names[:20]}
        except urllib.error.URLError as exc:
            return {"ok": False, "url": url, "error": str(exc.reason)}
        except Exception as exc:  # noqa: BLE001
            return {"ok": False, "url": url, "error": str(exc)}

    def embed(self, text: str, *, timeout: float | None = None) -> list[float]:
        """POST /api/embeddings on local Ollama only. Never logs the prompt."""
        url = f"{self.local_url}/api/embeddings"
        payload = json.dumps({"model": self.embed_model, "prompt": text}).encode("utf-8")
        req = urllib.request.Request(
            url,
            data=payload,
            method="POST",
            headers={"Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout or self.timeout) as resp:
                body = json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            raise OSError(f"ollama_http_{exc.code}") from exc
        except urllib.error.URLError as exc:
            raise OSError(str(exc.reason or exc)) from exc
        vector = body.get("embedding")
        if not isinstance(vector, list) or not vector:
            raise OSError("ollama_empty_embedding")
        return [float(x) for x in vector]
