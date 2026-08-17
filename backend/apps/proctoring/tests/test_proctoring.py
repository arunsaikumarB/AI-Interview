"""Phase 3G post-session proctoring tests. Live ingest is not exercised."""

from __future__ import annotations

import tempfile
from pathlib import Path
from unittest.mock import patch

from django.test import SimpleTestCase, override_settings
from rest_framework.test import APIClient

from apps.accounts.tests.test_rbac import ORG_A, ORG_B, SETTINGS, mint
from services.proctoring.errors import PermanentProctoringError
from services.proctoring.labels import observed_signal_label
from services.proctoring.paths import recording_dir
from services.proctoring.repository import ProctoringSessionRow

PC_SETTINGS = {
    **SETTINGS,
    "ROOT_URLCONF": "config.urls",
    "PROCTORING_LOCK_TTL_SECONDS": 900,
    "PROCTORING_STATUS_TTL_SECONDS": 86400,
    "STORAGE_ROOT": str(Path(__file__).resolve().parents[4] / "storage"),
}


class FakeRedis:
    def __init__(self) -> None:
        self.store: dict[str, str] = {}

    def set(self, key, value, nx=False, ex=None, xx=False):
        if nx and key in self.store:
            return False
        self.store[key] = str(value)
        return True

    def get(self, key):
        return self.store.get(key)

    def delete(self, *keys):
        n = 0
        for key in keys:
            if self.store.pop(key, None) is not None:
                n += 1
        return n


def _row(**kwargs) -> ProctoringSessionRow:
    data = dict(
        id="cmssessiontestid01",
        organization_id=ORG_A,
        application_id="app_1",
        job_id="job_1",
        candidate_id="cand_1",
        status="COMPLETED",
        started_at=None,
        ended_at=None,
        duration_minutes=30,
        proctoring_enabled=True,
        proctoring_mode="ENHANCED",
        proctoring_consent_at=None,
        secondary_recording_consent_at=None,
        integrity_terminated_reason=None,
        secondary_device_status="DISCONNECTED",
        secondary_pair_token_present=False,
        recording_id="scr_ab12cd34ef56",
        recording_status="RECORDING",
        recording_path=None,
        recording_mime="video/webm",
        last_chunk_index=1,
        has_gap=False,
        interrupted_ms=0,
        application_stage="ASSESSMENT",
        application_status="ACTIVE",
    )
    data.update(kwargs)
    return ProctoringSessionRow(**data)


@override_settings(**PC_SETTINGS)
class ProctoringQueueTests(SimpleTestCase):
    def setUp(self):
        self.client = APIClient()
        self.redis = FakeRedis()
        patches = [
            patch("services.proctoring.locks.redis_client", return_value=self.redis),
            patch("apps.proctoring.tasks.assemble_recording_task.apply_async", return_value=None),
            patch("apps.proctoring.tasks.package_report_task.apply_async", return_value=None),
            patch("apps.proctoring.tasks.process_session_task.apply_async", return_value=None),
        ]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)

    def auth(self, **kwargs):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {mint(**kwargs)}")

    def test_unauthorized(self):
        self.assertEqual(
            self.client.post(
                "/api/v1/proctoring/process/",
                {"session_id": "cmssessiontestid01"},
                format="json",
            ).status_code,
            401,
        )

    def test_candidate_forbidden(self):
        self.auth(role="CANDIDATE")
        self.assertEqual(
            self.client.post(
                "/api/v1/proctoring/process/",
                {"session_id": "cmssessiontestid01"},
                format="json",
            ).status_code,
            403,
        )

    def test_interviewer_forbidden(self):
        self.auth(role="INTERVIEWER")
        self.assertEqual(
            self.client.post(
                "/api/v1/proctoring/process/",
                {"session_id": "cmssessiontestid01"},
                format="json",
            ).status_code,
            403,
        )

    @patch("services.proctoring.enqueue.get_session", return_value=_row())
    def test_process_queued(self, _g):
        self.auth()
        res = self.client.post(
            "/api/v1/proctoring/process/",
            {"session_id": "cmssessiontestid01", "kind": "process"},
            format="json",
        )
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertEqual(set(body.keys()), {"status", "task_id", "kind"})
        self.assertEqual(body["kind"], "process")
        self.assertNotIn("storage", str(body).lower())
        self.assertNotIn("pair", str(body).lower())

    @patch("services.proctoring.enqueue.get_session", return_value=_row())
    def test_duplicate_lock(self, _g):
        self.auth()
        first = self.client.post(
            "/api/v1/proctoring/process/",
            {"session_id": "cmssessiontestid01"},
            format="json",
        )
        second = self.client.post(
            "/api/v1/proctoring/process/",
            {"session_id": "cmssessiontestid01"},
            format="json",
        )
        self.assertEqual(second.json()["status"], "already_processing")
        self.assertEqual(second.json()["task_id"], first.json()["task_id"])

    @patch("services.proctoring.enqueue.get_session", return_value=None)
    def test_cross_org_404(self, _g):
        self.auth(organization_id=ORG_B)
        self.assertEqual(
            self.client.post(
                "/api/v1/proctoring/process/",
                {"session_id": "cmssessiontestid01"},
                format="json",
            ).status_code,
            404,
        )

    @patch(
        "services.proctoring.enqueue.get_session",
        return_value=_row(status="IN_PROGRESS"),
    )
    def test_active_session_rejected(self, _g):
        self.auth()
        self.assertEqual(
            self.client.post(
                "/api/v1/proctoring/process/",
                {"session_id": "cmssessiontestid01"},
                format="json",
            ).status_code,
            400,
        )


class ProctoringSafetyTests(SimpleTestCase):
    def test_signal_labels_are_not_verdicts(self):
        text = observed_signal_label("SECONDARY_MULTIPLE_PERSONS").lower()
        self.assertIn("additional person detected", text)
        self.assertNotIn("cheat", text)
        self.assertNotIn("fraud", text)

    def test_path_traversal_rejected(self):
        with self.assertRaises(PermanentProctoringError):
            recording_dir("../etc", "scr_ab12cd34ef56")

    def test_python_has_no_ai_or_live_ingest(self):
        root = Path(__file__).resolve().parents[3]
        banned = (
            "screenapplication",
            "generateplan",
            "finalevaluation",
            "evaluateansweronly",
            "runresumescreening",
            "ollama",
            "cheating probability",
            "trust score",
            "emotion detection",
        )
        for rel in ("services/proctoring", "apps/proctoring"):
            for path in (root / rel).rglob("*.py"):
                if path.name.startswith("test_") or "__pycache__" in path.parts:
                    continue
                text = path.read_text(encoding="utf-8").lower()
                for word in banned:
                    self.assertNotIn(word, text, f"{path} {word}")

    def test_concat_preserves_source_chunks(self):
        from services.proctoring.assemble import assemble_recording

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            session_id = "cmssessiontestid01"
            recording_id = "scr_ab12cd34ef56"
            directory = root / "interviews" / session_id / "secondary-camera" / recording_id
            directory.mkdir(parents=True)
            (directory / "chunk-000000.part").write_bytes(b"AAAA")
            (directory / "chunk-000001.part").write_bytes(b"BBBB")
            row = _row()
            with override_settings(STORAGE_ROOT=str(root), REPO_ROOT=root):
                with patch("services.proctoring.assemble.get_session", return_value=row):
                    with patch(
                        "services.proctoring.assemble.application_pipeline",
                        return_value=("ASSESSMENT", "ACTIVE"),
                    ):
                        with patch("services.proctoring.assemble.mark_recording_saved"):
                            result = assemble_recording(session_id, ORG_A)
            self.assertEqual(result["outcome"], "assembled")
            self.assertTrue(result["chunks_preserved"])
            self.assertFalse(result["orientation_corrected"])
            self.assertEqual((directory / "recording.webm").read_bytes(), b"AAAABBBB")
            self.assertTrue((directory / "chunk-000000.part").is_file())
            self.assertTrue((directory / "chunk-000001.part").is_file())

    def test_missing_chunk_is_incomplete(self):
        from services.proctoring.assemble import assemble_recording

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            session_id = "cmssessiontestid01"
            recording_id = "scr_ab12cd34ef56"
            directory = root / "interviews" / session_id / "secondary-camera" / recording_id
            directory.mkdir(parents=True)
            (directory / "chunk-000000.part").write_bytes(b"AAAA")
            (directory / "chunk-000002.part").write_bytes(b"CCCC")
            row = _row()
            with override_settings(STORAGE_ROOT=str(root), REPO_ROOT=root):
                with patch("services.proctoring.assemble.get_session", return_value=row):
                    with patch(
                        "services.proctoring.assemble.application_pipeline",
                        return_value=("ASSESSMENT", "ACTIVE"),
                    ):
                        result = assemble_recording(session_id, ORG_A)
            self.assertEqual(result["outcome"], "incomplete")
            self.assertIn(1, result["missing_chunks"])
            self.assertFalse((directory / "recording.webm").exists())
            self.assertTrue((directory / "chunk-000000.part").is_file())

    def test_saved_without_file_does_not_claim_available(self):
        from services.proctoring.assemble import assemble_recording

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            session_id = "cmssessiontestid01"
            recording_id = "scr_ab12cd34ef56"
            directory = root / "interviews" / session_id / "secondary-camera" / recording_id
            directory.mkdir(parents=True)
            row = _row(
                recording_status="SAVED",
                recording_path="interviews/cmssessiontestid01/secondary-camera/scr_ab12cd34ef56/recording.webm",
            )
            with override_settings(STORAGE_ROOT=str(root), REPO_ROOT=root):
                with patch("services.proctoring.assemble.get_session", return_value=row):
                    with patch(
                        "services.proctoring.assemble.application_pipeline",
                        return_value=("ASSESSMENT", "ACTIVE"),
                    ):
                        with patch(
                            "services.proctoring.assemble.mark_recording_artifact_missing"
                        ) as missing:
                            result = assemble_recording(session_id, ORG_A)
            self.assertEqual(result["outcome"], "incomplete")
            self.assertFalse(result["recording_present"])
            missing.assert_called_once()

    def test_ffmpeg_playable_assemble(self):
        import shutil
        import subprocess

        from services.proctoring.assemble import assemble_recording
        from services.proctoring.ffmpeg import probe_file

        if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
            self.skipTest("ffmpeg/ffprobe not on PATH")
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            session_id = "cmssessiontestid01"
            recording_id = "scr_ab12cd34ef56"
            directory = root / "interviews" / session_id / "secondary-camera" / recording_id
            directory.mkdir(parents=True)
            source = directory / "source.webm"
            made = subprocess.run(
                [
                    "ffmpeg",
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-f",
                    "lavfi",
                    "-i",
                    "testsrc=size=160x120:rate=10",
                    "-f",
                    "lavfi",
                    "-i",
                    "sine=frequency=440:duration=1",
                    "-t",
                    "1",
                    "-c:v",
                    "libvpx",
                    "-c:a",
                    "libopus",
                    str(source),
                ],
                check=False,
                capture_output=True,
                shell=False,
            )
            if made.returncode != 0 or not source.is_file():
                self.skipTest("could not encode test webm")
            (directory / "chunk-000000.part").write_bytes(source.read_bytes())
            source.unlink()
            row = _row()
            with override_settings(STORAGE_ROOT=str(root), REPO_ROOT=root):
                with patch("services.proctoring.assemble.get_session", return_value=row):
                    with patch(
                        "services.proctoring.assemble.application_pipeline",
                        return_value=("ASSESSMENT", "ACTIVE"),
                    ):
                        with patch("services.proctoring.assemble.mark_recording_saved"):
                            result = assemble_recording(session_id, ORG_A)
            self.assertEqual(result["outcome"], "assembled")
            output = directory / "recording.webm"
            self.assertTrue(output.is_file() and output.stat().st_size > 0)
            probe = probe_file(str(output))
            self.assertTrue(probe.get("probed"))
            self.assertTrue(probe.get("has_video"))
            self.assertTrue(probe.get("has_audio"))
            self.assertFalse(result["orientation_corrected"])
            self.assertTrue((directory / "chunk-000000.part").is_file())
