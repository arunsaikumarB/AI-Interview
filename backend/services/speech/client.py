"""Speech-service client — talks to existing FastAPI at SPEECH_SERVICE_URL.

Does not replace or start speech-service/.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Any

from django.conf import settings


class SpeechServiceClient:
    def __init__(self, base_url: str, timeout: float = 5.0) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    @classmethod
    def from_settings(cls) -> SpeechServiceClient:
        return cls(settings.SPEECH_SERVICE_URL)

    def health(self) -> dict[str, Any]:
        url = f"{self.base_url}/health"
        try:
            req = urllib.request.Request(url, method="GET")
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                body = json.loads(resp.read().decode("utf-8"))
            ok = body.get("ok") is True
            return {"ok": ok, "url": url, "body": body}
        except urllib.error.URLError as exc:
            return {"ok": False, "url": url, "error": str(exc.reason)}
        except Exception as exc:  # noqa: BLE001
            return {"ok": False, "url": url, "error": str(exc)}
