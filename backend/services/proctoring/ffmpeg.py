"""Optional ffprobe. Assembly does not require ffmpeg (byte-concat matches Next.js)."""

from __future__ import annotations

import json
import shutil
import subprocess


def ffmpeg_version() -> dict:
    ffmpeg = shutil.which("ffmpeg")
    ffprobe = shutil.which("ffprobe")
    version = None
    if ffmpeg:
        try:
            completed = subprocess.run(
                [ffmpeg, "-version"],
                capture_output=True,
                text=True,
                timeout=8,
                check=False,
                shell=False,
            )
            first = (completed.stdout or completed.stderr or "").splitlines()
            version = first[0][:200] if first else None
        except (OSError, subprocess.TimeoutExpired):
            version = None
    return {
        "ffmpeg_available": bool(ffmpeg),
        "ffprobe_available": bool(ffprobe),
        "ffmpeg_version": version,
    }


def probe_file(absolute_path: str) -> dict:
    info = ffmpeg_version()
    ffprobe = shutil.which("ffprobe")
    if not ffprobe:
        return {**info, "probed": False, "has_audio": None, "has_video": None}
    try:
        completed = subprocess.run(
            [
                ffprobe,
                "-v",
                "error",
                "-show_streams",
                "-show_format",
                "-of",
                "json",
                absolute_path,
            ],
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
            shell=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return {**info, "probed": False, "has_audio": None, "has_video": None, "probe_error": "probe_failed"}
    if completed.returncode != 0:
        return {
            **info,
            "probed": False,
            "has_audio": None,
            "has_video": None,
            "probe_error": "unreadable",
        }
    try:
        payload = json.loads(completed.stdout or "{}")
    except json.JSONDecodeError:
        return {**info, "probed": False, "has_audio": None, "has_video": None, "probe_error": "probe_json"}
    streams = payload.get("streams") or []
    codecs = [str(s.get("codec_type") or "") for s in streams if isinstance(s, dict)]
    rotate = None
    for stream in streams:
        if not isinstance(stream, dict):
            continue
        tags = stream.get("tags") if isinstance(stream.get("tags"), dict) else {}
        if tags.get("rotate"):
            rotate = str(tags.get("rotate"))
            break
        side = stream.get("side_data_list")
        if isinstance(side, list):
            for item in side:
                if isinstance(item, dict) and item.get("rotation") is not None:
                    rotate = str(item.get("rotation"))
                    break
    return {
        **info,
        "probed": True,
        "has_audio": "audio" in codecs,
        "has_video": "video" in codecs,
        "container": (payload.get("format") or {}).get("format_name"),
        "rotate_tag": rotate,
        "orientation_corrected": False,
    }
