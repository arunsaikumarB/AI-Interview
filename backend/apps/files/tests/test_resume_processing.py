"""Phase 3D resume queue + Celery tests. SimpleTestCase — no test database."""

from __future__ import annotations

import json
import logging
import tempfile
from pathlib import Path
from unittest.mock import patch

from celery.exceptions import MaxRetriesExceededError
from django.test import SimpleTestCase, override_settings
from rest_framework.test import APIClient

from apps.accounts.tests.test_rbac import ORG_A, ORG_B, SETTINGS, mint
from apps.files.tasks import process_resume
from services.resume.embeddings import build_candidate_embed_text, embed_text
from services.resume.errors import PermanentResumeError, TransientResumeError
from services.resume.files import resolve_resume_file
from services.resume.pipeline import process_candidate_resume
from services.resume.repository import CandidateResumeRow

RESUME_SETTINGS = {
    **SETTINGS,
    "ROOT_URLCONF": "config.urls",
    "RESUME_LOCK_TTL_SECONDS": 600,
    "RESUME_STATUS_TTL_SECONDS": 86400,
    "RESUME_EMBED_DIMS": 768,
    "RESUME_EMBED_MAX_CHARS": 6000,
    "RESUME_MAX_BYTES": 10 * 1024 * 1024,
    "RESUME_PROCESS_MAX_RETRIES": 4,
}


class FakeRedis:
    def __init__(self) -> None:
        self.store: dict[str, str] = {}

    def set(self, key, value, nx=False, ex=None, xx=False):
        if nx and key in self.store:
            return False
        if xx and key not in self.store:
            return False
        self.store[key] = str(value)
        return True

    def get(self, key):
        return self.store.get(key)

    def delete(self, *keys):
        n = 0
        for key in keys:
            if key in self.store:
                del self.store[key]
                n += 1
        return n


def _row(**kwargs) -> CandidateResumeRow:
    data = dict(
        id="cand_1",
        organization_id=ORG_A,
        resume_url="resumes/ok.txt",
        summary="Summary",
        skills=["Python"],
        experience=4.0,
    )
    data.update(kwargs)
    return CandidateResumeRow(**data)


class CaptureHandler(logging.Handler):
    def __init__(self) -> None:
        super().__init__()
        self.records: list[str] = []

    def emit(self, record: logging.LogRecord) -> None:
        self.records.append(self.format(record))


@override_settings(**RESUME_SETTINGS)
class ResumeQueueRBACTests(SimpleTestCase):
    def setUp(self):
        self.client = APIClient()
        self.redis = FakeRedis()
        self.storage = tempfile.TemporaryDirectory()
        self.addCleanup(self.storage.cleanup)
        root = Path(self.storage.name)
        (root / "resumes").mkdir()
        (root / "resumes" / "ok.txt").write_text("Python engineer resume body.\n", encoding="utf-8")
        self.settings_cm = override_settings(STORAGE_ROOT=str(root))
        self.settings_cm.enable()
        self.addCleanup(self.settings_cm.disable)
        self.patches = [
            patch("services.resume.locks.redis_client", return_value=self.redis),
            patch(
                "apps.files.tasks.process_resume.apply_async",
                return_value=None,
            ),
        ]
        for p in self.patches:
            p.start()
            self.addCleanup(p.stop)

    def auth(self, **kwargs):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {mint(**kwargs)}")

    def post(self, candidate_id="cand_1"):
        return self.client.post(
            "/api/v1/resumes/process/",
            {"candidate_id": candidate_id},
            format="json",
        )

    def test_unauthorized(self):
        self.assertEqual(self.post().status_code, 401)

    def test_candidate_forbidden(self):
        self.auth(sub="cand", role="CANDIDATE", email="c@example.com")
        self.assertEqual(self.post().status_code, 403)

    def test_interviewer_forbidden(self):
        self.auth(role="INTERVIEWER")
        self.assertEqual(self.post().status_code, 403)

    @patch("services.resume.enqueue.get_candidate", return_value=_row())
    def test_valid_queue(self, _get):
        self.auth()
        res = self.post()
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertEqual(body["status"], "queued")
        self.assertTrue(body["task_id"])
        dumped = json.dumps(body)
        self.assertNotIn("storage", dumped)
        self.assertNotIn("resumes/", dumped)
        self.assertNotIn(str(Path(self.storage.name)), dumped)

    @patch("services.resume.enqueue.get_candidate", return_value=None)
    def test_missing_candidate(self, _get):
        self.auth()
        self.assertEqual(self.post("missing").status_code, 404)

    @patch("services.resume.enqueue.get_candidate", return_value=None)
    def test_cross_organization(self, _get):
        self.auth(organization_id=ORG_B)
        self.assertEqual(self.post("cand_1").status_code, 404)

    @patch(
        "services.resume.enqueue.get_candidate",
        return_value=_row(resume_url=None),
    )
    def test_missing_resume(self, _get):
        self.auth()
        res = self.post()
        self.assertEqual(res.status_code, 400)

    @patch(
        "services.resume.enqueue.get_candidate",
        return_value=_row(resume_url="resumes/legacy.doc"),
    )
    def test_unsupported_file(self, _get):
        root = Path(self.storage.name)
        (root / "resumes" / "legacy.doc").write_bytes(b"x")
        self.auth()
        res = self.post()
        self.assertEqual(res.status_code, 400)
        self.assertIn("unsupported_file", json.dumps(res.json()))

    @patch("services.resume.enqueue.get_candidate", return_value=_row())
    def test_duplicate_processing(self, _get):
        self.auth()
        first = self.post()
        self.assertEqual(first.status_code, 200)
        second = self.post()
        self.assertEqual(second.status_code, 200)
        self.assertEqual(second.json()["status"], "already_processing")
        self.assertEqual(second.json()["task_id"], first.json()["task_id"])

    @patch("services.resume.enqueue.get_candidate", return_value=_row())
    def test_staff_roles_allowed(self, _get):
        for role in ("SUPER_ADMIN", "HR_ADMIN", "RECRUITER", "HIRING_MANAGER"):
            self.redis.store.clear()
            self.auth(role=role, sub=f"u_{role}")
            self.assertEqual(self.post().status_code, 200, role)


@override_settings(**RESUME_SETTINGS)
class ResumePipelineUnitTests(SimpleTestCase):
    def setUp(self):
        self.redis = FakeRedis()
        self.storage = tempfile.TemporaryDirectory()
        self.addCleanup(self.storage.cleanup)
        root = Path(self.storage.name)
        (root / "resumes").mkdir()
        (root / "resumes" / "ok.txt").write_text("SECRET_RESUME_BODY_XYZ\n", encoding="utf-8")
        self.settings_cm = override_settings(STORAGE_ROOT=str(root))
        self.settings_cm.enable()
        self.addCleanup(self.settings_cm.disable)
        p = patch("services.resume.locks.redis_client", return_value=self.redis)
        p.start()
        self.addCleanup(p.stop)

    def test_successful_parse_and_embed(self):
        row = _row()
        vector = [0.1] * 768
        with (
            patch("services.resume.pipeline.get_candidate", return_value=row),
            patch("services.resume.pipeline.extract_resume_text", return_value="extracted"),
            patch("services.resume.pipeline.embed_text", return_value=vector),
            patch("services.resume.pipeline.update_resume_text") as upd_text,
            patch("services.resume.pipeline.update_embedding") as upd_emb,
            patch("services.resume.pipeline.embedding_dims", return_value=768),
        ):
            result = process_candidate_resume(
                candidate_id="cand_1",
                organization_id=ORG_A,
                task_id="task-1",
            )
        self.assertTrue(result["ok"])
        self.assertEqual(result["embedding_dims"], 768)
        self.assertEqual(result["resume_text_length"], len("extracted"))
        upd_text.assert_called_once()
        upd_emb.assert_called_once()
        dumped = json.dumps(result)
        self.assertNotIn("SECRET_RESUME_BODY", dumped)
        self.assertNotIn("resumes/ok.txt", dumped)

    def test_parser_failure_is_permanent(self):
        with (
            patch("services.resume.pipeline.get_candidate", return_value=_row()),
            patch(
                "services.resume.pipeline.extract_resume_text",
                side_effect=PermanentResumeError("parser_failure"),
            ),
        ):
            with self.assertRaises(PermanentResumeError) as ctx:
                process_candidate_resume(
                    candidate_id="cand_1",
                    organization_id=ORG_A,
                    task_id="task-1",
                )
        self.assertEqual(ctx.exception.error_class, "parser_failure")

    def test_ollama_unavailable_is_transient(self):
        with (
            patch("services.resume.pipeline.get_candidate", return_value=_row()),
            patch("services.resume.pipeline.extract_resume_text", return_value="extracted"),
            patch("services.resume.pipeline.update_resume_text"),
            patch(
                "services.resume.pipeline.embed_text",
                side_effect=TransientResumeError("ollama_unavailable"),
            ),
        ):
            with self.assertRaises(TransientResumeError):
                process_candidate_resume(
                    candidate_id="cand_1",
                    organization_id=ORG_A,
                    task_id="task-1",
                )

    def test_wrong_embedding_dims_permanent(self):
        with patch.object(
            embed_text.__globals__["OllamaClient"],
            "from_settings",
        ) as from_settings:
            client = from_settings.return_value
            client.embed.return_value = [0.1] * 32
            with self.assertRaises(PermanentResumeError) as ctx:
                embed_text("hello")
        self.assertEqual(ctx.exception.error_class, "embedding_dimension_mismatch")

    def test_embed_oserror_is_transient(self):
        with patch.object(
            embed_text.__globals__["OllamaClient"],
            "from_settings",
        ) as from_settings:
            client = from_settings.return_value
            client.embed.side_effect = OSError("connection refused")
            with self.assertRaises(TransientResumeError) as ctx:
                embed_text("hello")
        self.assertEqual(ctx.exception.error_class, "ollama_unavailable")

    def test_task_retries_then_stops(self):
        with (
            patch(
                "apps.files.tasks.process_candidate_resume",
                side_effect=TransientResumeError("ollama_unavailable"),
            ),
            patch("apps.files.tasks.fail_processing"),
            patch.object(
                process_resume,
                "retry",
                side_effect=MaxRetriesExceededError(),
            ),
        ):
            process_resume.push_request(id="tid", retries=4)
            try:
                result = process_resume.run("cand_1", ORG_A)
            finally:
                process_resume.pop_request()
        self.assertEqual(result["error_class"], "retries_exhausted")
        self.assertFalse(result["retryable"])

    def test_permanent_failure_does_not_retry(self):
        with (
            patch(
                "apps.files.tasks.process_candidate_resume",
                side_effect=PermanentResumeError("unsupported_file"),
            ),
            patch("apps.files.tasks.fail_processing") as fail,
            patch.object(process_resume, "retry") as retry,
        ):
            process_resume.push_request(id="tid", retries=0)
            try:
                result = process_resume.run("cand_1", ORG_A)
            finally:
                process_resume.pop_request()
        retry.assert_not_called()
        fail.assert_called_once()
        self.assertEqual(result["error_class"], "unsupported_file")

    def test_org_isolation_in_pipeline(self):
        with patch("services.resume.pipeline.get_candidate", return_value=None):
            with self.assertRaises(PermanentResumeError) as ctx:
                process_candidate_resume(
                    candidate_id="cand_1",
                    organization_id=ORG_B,
                    task_id="task-1",
                )
        self.assertEqual(ctx.exception.error_class, "invalid_candidate")

    def test_path_traversal_rejected(self):
        with self.assertRaises(PermanentResumeError):
            resolve_resume_file("resumes/../secret.txt")

    def test_embed_text_recipe_matches_next(self):
        blob = build_candidate_embed_text(
            summary="  Hello ",
            skills=["TypeScript", "React"],
            experience=4,
            resume_text=" Body ",
        )
        self.assertEqual(
            blob,
            "Hello\n\nSkills: TypeScript, React\n\nExperience: 4 years\n\nBody",
        )

    def test_logs_omit_resume_contents(self):
        handler = CaptureHandler()
        handler.setFormatter(logging.Formatter("%(message)s"))
        log = logging.getLogger("hireos.resume")
        log.addHandler(handler)
        log.setLevel(logging.INFO)
        self.addCleanup(lambda: log.removeHandler(handler))
        secret = "SECRET_RESUME_BODY_XYZ"
        with (
            patch("services.resume.pipeline.get_candidate", return_value=_row()),
            patch("services.resume.pipeline.extract_resume_text", return_value=secret),
            patch("services.resume.pipeline.embed_text", return_value=[0.1] * 768),
            patch("services.resume.pipeline.update_resume_text"),
            patch("services.resume.pipeline.update_embedding"),
            patch("services.resume.pipeline.embedding_dims", return_value=768),
        ):
            process_candidate_resume(
                candidate_id="cand_1",
                organization_id=ORG_A,
                task_id="task-1",
            )
        joined = "\n".join(handler.records)
        self.assertNotIn(secret, joined)
        self.assertIn("candidate_id=cand_1", joined)
        self.assertIn("stage=completed", joined)
