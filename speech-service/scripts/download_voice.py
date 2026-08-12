#!/usr/bin/env python3
"""
Download the bundled Piper en_US-lessac-medium voice (onnx + json).
Do NOT commit the model files — they are gitignored under speech-service/voices/.
"""

from __future__ import annotations

import sys
import urllib.request
from pathlib import Path

VOICE = "en_US-lessac-medium"
BASE = (
    "https://huggingface.co/rhasspy/piper-voices/resolve/main/"
    "en/en_US/lessac/medium"
)

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "voices"
FILES = [f"{VOICE}.onnx", f"{VOICE}.onnx.json"]


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    for name in FILES:
        dest = OUT / name
        url = f"{BASE}/{name}"
        if dest.exists() and dest.stat().st_size > 1000:
            print(f"OK exists {dest}")
            continue
        print(f"Downloading {url} …")
        urllib.request.urlretrieve(url, dest)
        print(f"Wrote {dest} ({dest.stat().st_size} bytes)")
    print("Done. Start the service with: python run.py")
    return 0


if __name__ == "__main__":
    sys.exit(main())
