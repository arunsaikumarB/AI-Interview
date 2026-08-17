from __future__ import annotations

import json
from datetime import datetime, timezone
from services.proctoring.errors import PermanentProctoringError, TransientProctoringError
from services.proctoring.labels import observed_signal_label, termination_reason_label
from services.proctoring.paths import assert_safe_id, relative_posix, storage_root, stored_file_ok
from services.proctoring.repository import TERMINAL_STATUSES, get_session, list_events


def _iso(value) -> str | None:
    if value is None:
        return None
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return str(value)


def _meta(raw) -> dict:
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str):
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            return {}
        return parsed if isinstance(parsed, dict) else {}
    return {}


def package_report(session_id: str, organization_id: str) -> dict:
    row = get_session(session_id, organization_id)
    if row is None:
        raise PermanentProctoringError("invalid_session")
    if row.status not in TERMINAL_STATUSES:
        raise PermanentProctoringError("session_not_terminal")
    assert_safe_id(row.id, field="session_id")

    events = []
    counts: dict[str, int] = {}
    for event_id, event_type, timestamp, meta_raw in list_events(row.id):
        meta = _meta(meta_raw)
        stripped = {
            k: v
            for k, v in meta.items()
            if k
            not in {
                "pairToken",
                "accessToken",
                "secondaryPairToken",
                "path",
                "absolutePath",
                "stack",
                "prompt",
            }
        }
        label = observed_signal_label(str(event_type), stripped)
        events.append(
            {
                "id": event_id,
                "type": event_type,
                "observed_at": _iso(timestamp),
                "observed_signal": label,
                "recruiter_interpretation": "Human review required. This is not a cheating verdict.",
                "advisory_only": True,
            }
        )
        counts[str(event_type)] = counts.get(str(event_type), 0) + 1

    payload = {
        "kind": "PROCTORING_STAFF_PACKAGE",
        "advisory_only": True,
        "not_a_cheating_verdict": True,
        "not_ai_input": True,
        "session": {
            "id": row.id,
            "status": row.status,
            "started_at": _iso(row.started_at),
            "ended_at": _iso(row.ended_at),
            "duration_minutes": row.duration_minutes,
            "application_id": row.application_id,
            "job_id": row.job_id,
            "candidate_id": row.candidate_id,
        },
        "consent": {
            "proctoring_enabled": row.proctoring_enabled,
            "proctoring_mode": row.proctoring_mode,
            "proctoring_consent_at": _iso(row.proctoring_consent_at),
            "secondary_recording_consent": bool(row.secondary_recording_consent_at),
        },
        "integrity": {
            "terminated_reason_key": row.integrity_terminated_reason,
            "terminated_reason_label": termination_reason_label(row.integrity_terminated_reason),
        },
        "secondary_camera": {
            "device_status": row.secondary_device_status,
            "pair_token_present": False,
        },
        "recording": {
            "status": row.recording_status,
            "has_recording_id": bool(row.recording_id),
            "has_final_file": stored_file_ok(row.recording_path),
            "mime": row.recording_mime,
            "has_gap": row.has_gap,
            "interrupted_ms": row.interrupted_ms,
            "last_chunk_index": row.last_chunk_index,
            "review_only": True,
        },
        "event_counts": counts,
        "event_count_total": len(events),
        "events": events,
        "packaged_at": datetime.now(timezone.utc).isoformat(),
    }

    dest = storage_root() / "interviews" / row.id / "proctoring-report.json"
    try:
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    except OSError as exc:
        raise TransientProctoringError("disk_write_failed") from exc

    text = dest.read_text(encoding="utf-8")
    if "secondaryPairToken" in text or "accessToken" in text:
        dest.unlink(missing_ok=True)
        raise PermanentProctoringError("report_leaked_secret")
    if str(storage_root()) in text.replace("\\\\", "/"):
        dest.unlink(missing_ok=True)
        raise PermanentProctoringError("report_leaked_path")

    relative_posix(dest)  # validate the file sits under STORAGE_ROOT
    return {
        "outcome": "packaged",
        "event_count": len(events),
        "has_report": True,
        "application_stage_untouched": True,
    }
