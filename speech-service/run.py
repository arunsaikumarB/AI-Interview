#!/usr/bin/env python3
"""Start local speech service (default http://127.0.0.1:8001)."""

import os

import uvicorn

if __name__ == "__main__":
    # Containers must bind 0.0.0.0; local desktop keeps loopback-only by default.
    host = os.environ.get("SPEECH_HOST", "127.0.0.1")
    uvicorn.run(
        "main:app",
        host=host,
        port=int(os.environ.get("SPEECH_PORT", "8001")),
        reload=False,
    )
