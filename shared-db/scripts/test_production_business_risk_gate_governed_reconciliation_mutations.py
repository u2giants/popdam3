"""Falsification tests for the #1722 governed original reconciliation (issue #2365).

PR #2354's guard mutation sweep found these refusal guards in
``prove_governed_original_reconciliation`` could be replaced with ``False``
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
    GOVERNED_ORIGINAL_RECONCILIATION as CASE, PREVIEW_WORKFLOW, RiskGateError, canonical_sha256,
    prove_governed_original_reconciliation,
)

REPO_ROOT = Path(__file__).resolve().parents[1]


class GovernedOriginalReconciliationGuardTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        migration = next(REPO_ROOT.glob(f"supabase/migrations/{CASE['version']}_*.sql"))
        digest = canonical_sha256(migration)
        row = {"name": "orderlist_bridge_covering_index", "statements": ["same governed SQL"]}
        fixed = {
            "schema": "shared-db-preview-ledger-orphan-reconciliation/v1", "issue": CASE["issue"],
            "claim": CASE["claim"], "source_pr": CASE["source_pr"], "orphan_version": CASE["original_version"],
            "replacement_version": CASE["version"], "preview_run_id": CASE["preview_run_id"],
            "preview_artifact_id": CASE["preview_artifact_id"], "preview_artifact_digest": CASE["preview_artifact_digest"],
            "project_ref": CASE["project_ref"], "main_sha": CASE["run_head"],
        }
        governance = {"case_mode": "byte_identical_rename", "orphan_sha256": digest, "replacement_sha256": digest}
        old = [{**row, "version": CASE["original_version"]}]
        self.check = {**fixed, "mode": "check", "before": old, "after": old, "governance": governance}
        self.applied = {**fixed, "mode": "apply", "before": old, "after": [{**row, "version": CASE["version"]}], "governance": governance}
        self.entries = None
        self.run = {"status": "completed", "conclusion": "success", "event": "workflow_dispatch",
                    "path": ".github/workflows/preview-ledger-orphan-reconciliation.yml", "head_sha": CASE["run_head"], "run_attempt": 1}
        self.original_run = {"status": "completed", "conclusion": "success", "event": "workflow_dispatch",
                             "path": PREVIEW_WORKFLOW, "head_sha": CASE["preview_run_head"], "run_attempt": 1}
        self.source_artifacts = [{
            "id": CASE["preview_artifact_id"], "digest": CASE["preview_artifact_digest"], "expired": False,
            "name": f"preview-migration-apply-{CASE['preview_run_head']}",
            "workflow_run": {"id": CASE["preview_run_id"], "head_sha": CASE["preview_run_head"]},
        }]
        self.tamper_download = False
        self.reconciliation_artifacts = None

    def prove(self):
        archive = Path(self.temp.name, "evidence.zip")
        entries = self.entries or {"reconciliation-check.json": self.check, "reconciliation-apply.json": self.applied}
        with zipfile.ZipFile(archive, "w") as z:
            for name, value in entries.items():
                z.writestr(name, json.dumps(value, sort_keys=True))
        digest = "sha256:" + hashlib.sha256(archive.read_bytes()).hexdigest()
        artifact = {"id": CASE["artifact_id"], "digest": digest, "expired": False,
                    "name": f"preview-ledger-orphan-reconciliation-{CASE['original_version']}",
                    "workflow_run": {"id": CASE["run_id"], "head_sha": CASE["run_head"]}}

        def api(endpoint):
            if "/compare/" in endpoint:
                return {"status": "ahead", "behind_by": 0}
            if endpoint.endswith(f"runs/{CASE['run_id']}/artifacts?per_page=100"):
                if self.reconciliation_artifacts is not None:
                    return {"artifacts": self.reconciliation_artifacts(artifact)}
                return {"artifacts": [artifact]}
            if endpoint.endswith(f"runs/{CASE['preview_run_id']}"):
                return self.original_run
            if endpoint.endswith(f"runs/{CASE['preview_run_id']}/artifacts?per_page=100"):
                return {"artifacts": self.source_artifacts}
            raise AssertionError(endpoint)

        def downloader(_artifact_id, target):
            data = archive.read_bytes()
            target.write_bytes(data + b"tampered" if self.tamper_download else data)

        with mock.patch.dict(CASE, {"artifact_digest": digest}):
            return prove_governed_original_reconciliation(
                version=CASE["version"], source_pr=CASE["source_pr"], run_id=CASE["run_id"], run=self.run,
                repo_root=REPO_ROOT, main_sha="f" * 40, api=api, downloader=downloader,
            )

    def test_exact_governed_reconciliation_is_accepted(self):
        self.assertTrue(self.prove())

    def test_changed_run_identity_is_refused(self):
        self.run["run_attempt"] = 2
        with self.assertRaisesRegex(RiskGateError, "governed original reconciliation run identity changed"):
            self.prove()

    def test_ambiguous_reconciliation_artifacts_are_refused(self):
        for build in (lambda a: [], lambda a: [a, a], lambda a: ["not-an-object"], lambda a: None):
            self.reconciliation_artifacts = build
            with self.subTest(build=build), self.assertRaisesRegex(RiskGateError, "governed original reconciliation artifact is ambiguous"):
                self.prove()

    def test_download_that_differs_from_the_pinned_digest_is_refused(self):
        self.tamper_download = True
        with self.assertRaisesRegex(RiskGateError, "governed original reconciliation download digest changed"):
            self.prove()

    def test_extra_evidence_file_is_refused(self):
        self.entries = {"reconciliation-check.json": self.check, "reconciliation-apply.json": self.applied, "notes.json": {}}
        with self.assertRaisesRegex(RiskGateError, "governed original reconciliation evidence set changed"):
            self.prove()

    def test_changed_reconciliation_tuple_is_refused(self):
        self.applied["project_ref"] = "otherprojectref0000"
        with self.assertRaisesRegex(RiskGateError, "governed original reconciliation tuple changed"):
            self.prove()

    def test_rename_that_is_not_statement_identical_is_refused(self):
        self.applied["after"] = [{**self.applied["after"][0], "statements": ["different SQL"]}]
        with self.assertRaisesRegex(RiskGateError, "did not prove the exact statement-identical rename"):
            self.prove()

    def test_changed_source_preview_run_is_refused(self):
        self.original_run["conclusion"] = "failure"
        with self.assertRaisesRegex(RiskGateError, "source preview run identity changed"):
            self.prove()

    def test_ambiguous_source_preview_artifacts_are_refused(self):
        for artifacts in ([], self.source_artifacts * 2, None):
            self.source_artifacts = artifacts
            with self.subTest(artifacts=artifacts), self.assertRaisesRegex(RiskGateError, "source preview artifact is ambiguous"):
                self.prove()

    def test_changed_source_preview_artifact_is_refused(self):
        self.source_artifacts = [{**self.source_artifacts[0], "expired": True}]
        with self.assertRaisesRegex(RiskGateError, "source preview artifact identity changed"):
            self.prove()


if __name__ == "__main__":
    unittest.main()
