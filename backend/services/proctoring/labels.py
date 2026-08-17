"""Neutral observed-signal labels. Never cheating verdicts. Mirrors src/lib/integrity.ts."""

from __future__ import annotations


def observed_signal_label(event_type: str, meta: dict | None = None) -> str:
    meta = meta or {}
    if event_type == "TAB_BLUR":
        return "Interview window lost focus"
    if event_type == "TAB_FOCUS":
        return "Interview window regained focus"
    if event_type == "FULLSCREEN_EXIT":
        return "Fullscreen exited"
    if event_type == "COPY_PASTE":
        length = meta.get("pastedLength") if isinstance(meta.get("pastedLength"), int) else None
        return f"Paste observed (length {length})" if length is not None else "Paste observed"
    if event_type == "WINDOW_SWITCH":
        kind = meta.get("kind")
        if kind == "blur":
            return "Interview window lost focus"
        if kind == "focus":
            return "Interview window regained focus"
        return "Window focus changed"
    if event_type == "NO_FACE":
        return "Candidate was not visible (primary camera signal)"
    if event_type == "MULTIPLE_FACES":
        return "Additional person detected (primary camera signal)"
    if event_type == "SECONDARY_CAMERA_CONNECTED":
        return "Secondary camera connected"
    if event_type == "SECONDARY_CAMERA_DISCONNECTED":
        return "Secondary camera interruption"
    if event_type == "SECONDARY_CAMERA_MOVED":
        return "Secondary camera moved"
    if event_type == "SECONDARY_NO_FACE":
        return "Candidate was not visible"
    if event_type in {"SECONDARY_MULTIPLE_FACES", "SECONDARY_MULTIPLE_PERSONS"}:
        return "Additional person detected"
    if event_type == "SECONDARY_PERSON_RETURNED_TO_ONE":
        return "Additional person no longer detected"
    if event_type == "SECONDARY_PERSON_INTERACTION":
        return "Possible interaction with another person detected. Review recommended."
    if event_type == "SECONDARY_LOOKING_AT_DEVICE":
        return "Attention toward the side camera"
    if event_type == "SECONDARY_PERSON_MOVED":
        return "Candidate position changed"
    if event_type == "SECONDARY_PERSON_RETURNED":
        return "Candidate returned to interview position"
    if event_type == "SECONDARY_ATTENTION_DEVIATION":
        return "Attention deviation"
    if event_type == "SECONDARY_DEVICE_VISIBLE":
        return "Possible additional-device activity"
    if event_type == "SECONDARY_DEVICE_REMOVED":
        return "Additional device no longer visible"
    if event_type == "SECONDARY_DEVICE_INTERACTION":
        return "Possible interaction with an additional device"
    return event_type.replace("_", " ").lower()


def termination_reason_label(reason: str | None) -> str | None:
    if not reason:
        return None
    mapping = {
        "focus_threshold": "Interview ended by integrity policy (repeated window focus loss)",
        "paste_threshold": "Interview ended by integrity policy (repeated paste)",
        "fullscreen_threshold": "Interview ended by integrity policy (repeated fullscreen exit)",
        "secondary_camera_moved": "Interview ended (secondary camera was moved after placement)",
        "secondary_person_missing": "Interview ended (candidate not visible on secondary camera)",
        "secondary_extra_person": "Interview ended (another person visible on secondary camera)",
        "secondary_looking_at_device": "Interview ended (candidate looked at the secondary camera)",
        "secondary_person_moved": "Interview ended (candidate left the expected interview position)",
        "secondary_attention": "Interview ended (repeated attention deviation)",
        "secondary_person_interaction": "Interview ended (possible interaction with another person)",
    }
    return mapping.get(reason, "Interview ended by integrity policy")
