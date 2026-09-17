"""Falsification tests for the #1615/#1646 governed historical supersession (issue #2366).

PR #2354's guard mutation sweep found these refusal guards in
``prove_governed_historical_supersession`` could be replaced with ``False``
while the offline suite stayed green. Every test starts from the exact
evidence the gate ACCEPTS and changes one fact.
"""
import hashlib
import json
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).parent))

from production_business_risk_gate import (
    GOVERNED_HISTORICAL_SUPERSESSION as CASE, RiskGateError, canonical_sha256, prove_governed_historical_supersession,
)

MIGRATION_NAME = f"{CASE['version']}_crm_update_customer_clear_domain.sql"


class GovernedHistoricalSupersessionGuardTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / "supabase/migrations").mkdir(parents=True)
        migration = self.root / "supabase/migrations" / MIGRATION_NAME
        migration.write_text("select 1;\n", encoding="utf-8")
        digest = canonical_sha256(migration)
        fixed = {
            "schema": "shared-db-preview-ledger-orphan-reconciliation/v1", "issue": 1615, "claim": 1636, "source_pr": 1637,
            "orphan_version": CASE["original_version"], "replacement_version": CASE["version"],
            "preview_run_id": CASE["original_run_id"], "preview_artifact_id": CASE["original_artifact_id"],
            "preview_artifact_digest": CASE["original_artifact_digest"], "main_sha": CASE["reconciliation_head"],
            "governance": {"case_mode": "byte_identical_rename", "orphan_sha256": digest, "replacement_sha256": digest},
        }
        old = [{"version": CASE["original_version"], "name": "x", "statements": ["select 1"]}]
        new = [{"version": CASE["version"], "name": "x", "statements": ["select 1"]}]
        self.check = {**fixed, "mode": "check", "before": old, "after": old}
        self.applied = {**fixed, "mode": "apply", "before": old, "after": new}
        self.entries = None
        self.original_artifact = {"id": CASE["original_artifact_id"], "digest": CASE["original_artifact_digest"]}
        self.pr = {"merged": True, "merge_commit_sha": CASE["reconciliation_head"]}
        self.run = {"status": "completed", "conclusion": "success", "event": "workflow_dispatch",
                    "head_sha": CASE["reconciliation_head"], "path": ".github/workflows/preview-ledger-orphan-reconciliation.yml"}
        self.artifacts = None
        self.artifact_override = {}
        self.tamper_download = False

    def prove(self):
        archive = self.root / "fixture.zip"
        entries = self.entries or {"reconciliation-check.json": self.check, "reconciliation-apply.json": self.applied}
        with zipfile.ZipFile(archive, "w") as z:
            for name, value in entries.items():
                z.writestr(name, json.dumps(value))
        digest = "sha256:" + hashlib.sha256(archive.read_bytes()).hexdigest()
        artifact = {"id": CASE["reconciliation_artifact_id"], "digest": digest, "expired": False,
                    "name": f"preview-ledger-orphan-reconciliation-{CASE['original_version']}",
                    "workflow_run": {"id": CASE["reconciliation_run_id"]}, **self.artifact_override}

        def api(endpoint):
            if endpoint.endswith(f"/pulls/{CASE['reconciliation_pr']}"):
                return self.pr
            if "/compare/" in endpoint:
                return {"status": "ahead", "behind_by": 0}
            if endpoint.endswith(f"/actions/runs/{CASE['reconciliation_run_id']}"):
                return self.run
            if endpoint.endswith(f"/actions/runs/{CASE['reconciliation_run_id']}/artifacts?per_page=100"):
                return {"artifacts": self.artifacts(artifact) if self.artifacts else [artifact]}
            raise AssertionError(endpoint)

        def downloader(_artifact_id, destination):
            data = archive.read_bytes()
            Path(destination).write_bytes(data + b"tampered" if self.tamper_download else data)

        with mock.patch.dict(CASE, {"reconciliation_artifact_digest": digest}):
            return prove_governed_historical_supersession(
                version=CASE["version"], source_pr=CASE["source_pr"], run_id=CASE["original_run_id"],
                original_commit=CASE["original_commit"], original_artifact=self.original_artifact,
                repo_root=self.root, main_sha="f" * 40, api=api, downloader=downloader,
            )

    def test_exact_governed_supersession_is_accepted(self):
        self.assertEqual(self.prove(), CASE["original_version"])

    def test_changed_original_artifact_is_refused(self):
        for override in ({"id": 1}, {"digest": "sha256:" + "0" * 64}):
            self.original_artifact = {**self.original_artifact, **override}
            with self.subTest(override=override), self.assertRaisesRegex(RiskGateError, "original artifact identity changed"):
                self.prove()
            self.original_artifact = {"id": CASE["original_artifact_id"], "digest": CASE["original_artifact_digest"]}

    def test_reconciliation_pr_that_is_not_the_pinned_merge_is_refused(self):
        for pr in ({"merged": False, "merge_commit_sha": CASE["reconciliation_head"]}, {"merged": True, "merge_commit_sha": "0" * 40}):
            self.pr = pr
            with self.subTest(pr=pr), self.assertRaisesRegex(RiskGateError, "reconciliation PR is not the pinned merge"):
                self.prove()

    def test_changed_reconciliation_run_is_refused(self):
        self.run["event"] = "push"
        with self.assertRaisesRegex(RiskGateError, "reconciliation run identity changed"):
            self.prove()

    def test_ambiguous_reconciliation_artifacts_are_refused(self):
        for build in (lambda a: [], lambda a: [a, a], lambda a: ["not-an-object"], lambda a: None):
            self.artifacts = build
            with self.subTest(build=build), self.assertRaisesRegex(RiskGateError, "reconciliation artifact is ambiguous"):
                self.prove()

    def test_changed_reconciliation_artifact_is_refused(self):
        self.artifact_override = {"expired": True}
        with self.assertRaisesRegex(RiskGateError, "reconciliation artifact identity changed"):
            self.prove()

    def test_download_that_differs_from_the_pinned_digest_is_refused(self):
        self.tamper_download = True
        with self.assertRaisesRegex(RiskGateError, "reconciliation download digest changed"):
            self.prove()

    def test_extra_evidence_file_is_refused(self):
        self.entries = {"reconciliation-check.json": self.check, "reconciliation-apply.json": self.applied, "notes.json": {}}
        with self.assertRaisesRegex(RiskGateError, "reconciliation evidence set changed"):
            self.prove()

    def test_changed_reconciliation_tuple_is_refused(self):
        self.check["claim"] = 9999
        with self.assertRaisesRegex(RiskGateError, "reconciliation tuple changed"):
            self.prove()

    def test_bytes_that_do_not_match_exact_main_are_refused(self):
        self.applied["governance"] = {**self.applied["governance"], "replacement_sha256": "0" * 64, "orphan_sha256": "0" * 64}
        with self.assertRaisesRegex(RiskGateError, "bytes do not match exact main"):
            self.prove()


if __name__ == "__main__":
    unittest.main()
