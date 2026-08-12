#!/usr/bin/env python3
"""Offline tests for immutable production-apply review evidence."""

import copy
import hashlib
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parent))
import production_apply_review_evidence as gate  # noqa: E402

SHA = "0f42555c9dca23574a23fc6fe992cd0a716c5991"
ALLOWLIST = "20260812020000"
RUN_ID = 123456789
ACTOR = "reviewer-login"


def evidence(**changes):
    data = {
        "schema_version": gate.SCHEMA_VERSION,
        "repository": gate.REPOSITORY,
        "workflow_file": gate.WORKFLOW_PATH,
        "workflow_run_id": RUN_ID,
        "workflow_run_attempt": 1,
        "reviewed_main_sha": SHA,
        "ordered_allowlist": [ALLOWLIST],
        "verdict": "APPROVE",
        "reviewer_actor": ACTOR,
        "reviewer_label": "independent reviewer",
        "created_at": "2026-08-12T16:00:00Z",
    }
    data.update(changes)
    return data


def zip_bytes(data=None, filename=gate.EVIDENCE_FILE):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(filename, gate.canonical_json(data or evidence()))
    return buffer.getvalue()


class EvidenceTests(unittest.TestCase):
    def assert_rejected(self, **changes):
        with self.assertRaises(gate.EvidenceError):
            gate.validate_evidence(
                evidence(**changes), run_id=RUN_ID, run_attempt=1, sha=SHA,
                allowlist=[ALLOWLIST], reviewer_actor=ACTOR,
            )

    def test_strict_valid_evidence_passes(self):
        gate.validate_evidence(evidence(), run_id=RUN_ID, run_attempt=1, sha=SHA, allowlist=[ALLOWLIST], reviewer_actor=ACTOR)

    def test_unknown_missing_and_bad_schema_fail(self):
        self.assert_rejected(extra="no")
        data = evidence(); del data["verdict"]
        with self.assertRaises(gate.EvidenceError):
            gate.validate_evidence(data, run_id=RUN_ID, run_attempt=1, sha=SHA, allowlist=[ALLOWLIST], reviewer_actor=ACTOR)
        self.assert_rejected(schema_version="v2")

    def test_non_approve_and_wrong_actor_fail(self):
        self.assert_rejected(verdict="REQUEST_CHANGES")
        self.assert_rejected(reviewer_actor="someone-else")

    def test_wrong_sha_and_ordered_allowlist_fail(self):
        self.assert_rejected(reviewed_main_sha="1" * 40)
        expected = ["20260811070000", "20260812020000"]
        for actual in (
            list(reversed(expected)),
            expected[:1],
            expected + ["20260812030000"],
            [expected[0], expected[0], expected[1]],
        ):
            with self.subTest(actual=actual), self.assertRaises(gate.EvidenceError):
                gate.validate_evidence(
                    evidence(ordered_allowlist=actual), run_id=RUN_ID, run_attempt=1, sha=SHA,
                    allowlist=expected, reviewer_actor=ACTOR,
                )

    def test_run_id_attempt_time_and_label_are_strict(self):
        self.assert_rejected(workflow_run_id=RUN_ID + 1)
        self.assert_rejected(workflow_run_attempt=True)
        self.assert_rejected(created_at="yesterday")
        self.assert_rejected(reviewer_label="bad\nlabel")

    def test_request_rejects_url_path_bad_digest_sha_duplicates_and_order(self):
        bad = [
            ("https://github/run/1", "sha256:" + "a" * 64, SHA, ALLOWLIST),
            ("../1", "sha256:" + "a" * 64, SHA, ALLOWLIST),
            ("1", "a" * 64, SHA, ALLOWLIST),
            ("1", "sha256:" + "A" * 64, SHA, ALLOWLIST),
            ("1", "sha256:" + "a" * 64, "abc", ALLOWLIST),
            ("1", "sha256:" + "a" * 64, SHA, f"{ALLOWLIST},{ALLOWLIST}"),
            ("1", "sha256:" + "a" * 64, SHA, "20260812020000,20260811070000"),
        ]
        for args in bad:
            with self.subTest(args=args), self.assertRaises(gate.EvidenceError):
                gate.validate_request(*args)

    def test_run_metadata_and_artifact_selection_fail_closed(self):
        run = {
            "id": RUN_ID, "status": "completed", "conclusion": "success",
            "event": "workflow_dispatch", "head_sha": SHA, "path": gate.WORKFLOW_PATH,
            "repository": {"full_name": gate.REPOSITORY}, "actor": {"login": ACTOR},
        }
        run["run_attempt"] = 1
        self.assertEqual(gate.validate_run(run, RUN_ID, SHA), (ACTOR, 1))
        for field, value in (("conclusion", "failure"), ("head_sha", "1" * 40), ("path", "wrong.yml")):
            changed = copy.deepcopy(run); changed[field] = value
            with self.assertRaises(gate.EvidenceError): gate.validate_run(changed, RUN_ID, SHA)
        with self.assertRaises(gate.EvidenceError): gate.select_artifact({"artifacts": []}, RUN_ID)
        with self.assertRaises(gate.EvidenceError): gate.select_artifact({"artifacts": [{"name": gate.ARTIFACT_NAME, "id": 1, "expired": True}]}, RUN_ID)

    def test_end_to_end_verifies_digest_and_writes_canonical_json(self):
        blob = zip_bytes()
        digest = "sha256:" + hashlib.sha256(blob).hexdigest()
        run = {
            "id": RUN_ID, "status": "completed", "conclusion": "success",
            "event": "workflow_dispatch", "head_sha": SHA, "path": gate.WORKFLOW_PATH,
            "repository": {"full_name": gate.REPOSITORY}, "actor": {"login": ACTOR}, "run_attempt": 1,
        }
        def api(endpoint):
            return {"artifacts": [{"name": gate.ARTIFACT_NAME, "id": 77, "expired": False, "digest": digest, "workflow_run": {"id": RUN_ID}}]} if "artifacts" in endpoint else run
        def download(_artifact_id, path): path.write_bytes(blob)
        with tempfile.TemporaryDirectory() as temp:
            output = gate.verify(run_id_text=str(RUN_ID), expected_digest=digest, sha=SHA, allowlist_raw=ALLOWLIST, api=api, downloader=download, output_dir=Path(temp))
            self.assertEqual(output.read_text(encoding="utf-8"), gate.canonical_json(evidence()))

    def test_downloaded_digest_mismatch_fails(self):
        blob = zip_bytes()
        digest = "sha256:" + hashlib.sha256(blob).hexdigest()
        run = {"id": RUN_ID, "status": "completed", "conclusion": "success", "event": "workflow_dispatch", "head_sha": SHA, "path": gate.WORKFLOW_PATH, "repository": {"full_name": gate.REPOSITORY}, "actor": {"login": ACTOR}, "run_attempt": 1}
        def api(endpoint): return {"artifacts": [{"name": gate.ARTIFACT_NAME, "id": 77, "expired": False, "digest": digest, "workflow_run": {"id": RUN_ID}}]} if "artifacts" in endpoint else run
        with tempfile.TemporaryDirectory() as temp, self.assertRaises(gate.EvidenceError):
            gate.verify(run_id_text=str(RUN_ID), expected_digest=digest, sha=SHA, allowlist_raw=ALLOWLIST, api=api, downloader=lambda _id, path: path.write_bytes(b"wrong"), output_dir=Path(temp))

    def test_noncanonical_json_and_extra_artifact_file_fail(self):
        with tempfile.TemporaryDirectory() as temp:
            pretty = Path(temp, "pretty.zip")
            with zipfile.ZipFile(pretty, "w") as archive:
                archive.writestr(gate.EVIDENCE_FILE, json.dumps(evidence(), indent=2))
            with self.assertRaises(gate.EvidenceError):
                gate.read_evidence(pretty)
            extra = Path(temp, "extra.zip")
            with zipfile.ZipFile(extra, "w") as archive:
                archive.writestr(gate.EVIDENCE_FILE, gate.canonical_json(evidence()))
                archive.writestr("extra.txt", "no")
            with self.assertRaises(gate.EvidenceError):
                gate.read_evidence(extra)


class WorkflowWiringTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.repo = Path(__file__).resolve().parents[1]
        cls.apply = (cls.repo / ".github/workflows/shared-supabase-migrations.yml").read_text(encoding="utf-8")
        cls.review = (cls.repo / ".github/workflows/production-apply-review-evidence.yml").read_text(encoding="utf-8")

    def test_inputs_and_old_pointer_gate_are_replaced(self):
        self.assertIn("review_run_id:", self.apply)
        self.assertIn("review_artifact_digest:", self.apply)
        self.assertNotIn("review_reference:", self.apply)
        self.assertNotIn("production_apply_review_reference.py", self.apply)

    def test_verifier_runs_in_both_jobs_and_actions_read_is_least_privilege(self):
        self.assertEqual(self.apply.count("python scripts/production_apply_review_evidence.py"), 2)
        self.assertGreaterEqual(self.apply.count("actions: read"), 2)
        self.assertIn("environment: production", self.apply)

    def test_review_workflow_is_non_writing_and_provider_neutral(self):
        self.assertIn("production_migration_guard import parse_allowlist", self.review)
        self.assertIn("github.actor", self.review)
        self.assertIn('Path(os.environ["RUNNER_TEMP"]', self.review)
        self.assertIn("actions/upload-artifact@v4", self.review)
        self.assertIn('"reviewer_actor"', self.review)
        self.assertIn('"reviewer_label"', self.review)
        self.assertNotRegex(self.review, r"supabase|db push|psql")


if __name__ == "__main__":
    unittest.main()
