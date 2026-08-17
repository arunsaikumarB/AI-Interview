from __future__ import annotations

import json
from datetime import datetime, timezone

from services.proctoring.errors import PermanentProctoringError, TransientProctoringError
from services.proctoring.ffmpeg import probe_file
from services.proctoring.paths import (
    chunk_path,
    final_path,
    list_chunk_indexes,
    recording_dir,
    relative_posix,
)
from services.proctoring.repository import (
    TERMINAL_STATUSES,
    application_pipeline,
    get_session,
    mark_recording_artifact_missing,
    mark_recording_saved,
)


def assemble_recording(session_id: str, organization_id: str) -> dict:
    before = application_pipeline(session_id)
    row = get_session(session_id, organization_id)
    if row is None:
        raise PermanentProctoringError("invalid_session")
    if row.status not in TERMINAL_STATUSES:
        raise PermanentProctoringError("session_not_terminal")

    if not row.recording_id:
        return {
            "outcome": "no_recording",
            "recording_present": False,
            "chunks_preserved": True,
            "orientation_corrected": False,
            "application_stage_untouched": True,
        }

    directory = recording_dir(row.id, row.recording_id)
    indexes = list_chunk_indexes(directory)
    ext = "mp4" if "mp4" in (row.recording_mime or "").lower() else "webm"
    output = final_path(directory, ext)
    existing = None
    if row.recording_path:
        rel = row.recording_path.replace("\\", "/").lstrip("/")
        if ".." in rel.split("/"):
            raise PermanentProctoringError("path_traversal")
        from services.proctoring.paths import storage_root

        candidate = (storage_root() / rel).resolve()
        try:
            candidate.relative_to(storage_root())
        except ValueError as exc:
            raise PermanentProctoringError("path_traversal") from exc
        if candidate.is_file() and candidate.stat().st_size > 0:
            existing = candidate

    if row.recording_status == "SAVED" and existing is not None:
        probe = probe_file(str(existing))
        return {
            "outcome": "already_completed",
            "recording_present": True,
            "byte_length": existing.stat().st_size,
            "chunk_count": len(indexes),
            "chunks_preserved": True,
            "missing_chunks": [],
            "has_gap": row.has_gap,
            "ffmpeg_available": probe.get("ffmpeg_available"),
            "has_audio": probe.get("has_audio"),
            "has_video": probe.get("has_video"),
            "orientation_corrected": False,
            "orientation_note": "Source chunks unmodified. Recruiter playback may apply CSS rotation.",
            "application_stage_untouched": True,
        }

    if not indexes:
        if row.recording_status == "SAVED":
            mark_recording_artifact_missing(session_id=row.id, organization_id=organization_id)
        return {
            "outcome": "incomplete",
            "recording_present": False,
            "chunk_count": 0,
            "missing_chunks": [],
            "missing_count": 0,
            "chunks_preserved": True,
            "orientation_corrected": False,
            "application_stage_untouched": True,
            "error_class": "missing_artifact",
        }

    expected = list(range(0, indexes[-1] + 1))
    missing = [i for i in expected if i not in set(indexes)]
    if missing:
        return {
            "outcome": "incomplete",
            "recording_present": False,
            "chunk_count": len(indexes),
            "missing_chunks": missing[:50],
            "missing_count": len(missing),
            "chunks_preserved": True,
            "orientation_corrected": False,
            "application_stage_untouched": True,
        }

    parts: list[bytes] = []
    for index in expected:
        path = chunk_path(directory, index)
        try:
            data = path.read_bytes()
        except OSError as exc:
            raise TransientProctoringError("chunk_unreadable") from exc
        if not data:
            raise PermanentProctoringError("corrupt_chunk")
        parts.append(data)

    combined = b"".join(parts)
    if not combined:
        raise PermanentProctoringError("empty_recording")

    try:
        directory.mkdir(parents=True, exist_ok=True)
        output.write_bytes(combined)
    except OSError as exc:
        raise TransientProctoringError("disk_write_failed") from exc

    if not output.is_file() or output.stat().st_size <= 0:
        raise PermanentProctoringError("output_invalid")

    relative = relative_posix(output)
    mark_recording_saved(
        session_id=row.id,
        organization_id=organization_id,
        relative_path=relative,
        mime=row.recording_mime,
        has_gap=False,
    )

    sidecar = directory / "meta.json"
    sidecar.write_text(
        json.dumps(
            {
                "sessionId": row.id,
                "recordingId": row.recording_id,
                "finalizedAt": datetime.now(timezone.utc).isoformat(),
                "lastChunkIndex": expected[-1],
                "reviewOnly": True,
                "noAiInput": True,
                "orientationCorrected": False,
                "sourceChunksPreserved": True,
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    probe = probe_file(str(output))
    after = application_pipeline(session_id)
    if before != after:
        raise PermanentProctoringError("pipeline_mutated")

    return {
        "outcome": "assembled",
        "recording_present": True,
        "byte_length": output.stat().st_size,
        "chunk_count": len(expected),
        "chunks_preserved": True,
        "missing_chunks": [],
        "has_gap": False,
        "ffmpeg_available": probe.get("ffmpeg_available"),
        "has_audio": probe.get("has_audio"),
        "has_video": probe.get("has_video"),
        "orientation_corrected": False,
        "orientation_note": "Source chunks unmodified. Recruiter playback may apply CSS rotation.",
        "application_stage_untouched": True,
    }
