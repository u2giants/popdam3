#!/usr/bin/env python3
"""Offline refusal tests for independent production review identity."""

import hashlib
import io
import json
from pathlib import Path
import sys
import subprocess
import tempfile
import unittest
from unittest import mock
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parent))
import production_independent_review as gate  # noqa: E402
import production_apply_review_evidence as apply_gate  # noqa: E402

SHA = "a" * 40
SOURCE_HEAD = "b" * 40
DIGEST = "sha256:" + "c" * 64
DRY_DIGEST = "sha256:" + "d" * 64
ALLOWLIST = ["20260928000000"]


def packet(**changes):
    data = {
        "schema_version": gate.REVIEW_SCHEMA,
        "repository": gate.REPOSITORY,
        "workflow_file": gate.REVIEW_WORKFLOW,
        "workflow_run_id": 31,
        "workflow_run_attempt": 1,
        "reviewed_main_sha": SHA,
        "target_project_ref": gate.PRODUCTION_PROJECT_REF,
        "action": "production-apply",
        "ordered_allowlist": ALLOWLIST,
        "source_pr": 42,
        "source_pr_head": SOURCE_HEAD,
        "work_issue": 41,
        "preview_run_id": 24,
        "preview_artifact_digest": DIGEST,
        "dry_run_run_id": 30,
        "dry_run_artifact_digest": DRY_DIGEST,
        "sql_risk_reasons": ["material_access_change"],
        "verdict": "APPROVE",
        "reviewer_actor": "independent-reviewer",
    }
    data.update(changes)
    return data


def validate(data):
    gate.validate_packet(
        data, sha=SHA, allowlist=ALLOWLIST, source_pr=42,
        source_pr_head=SOURCE_HEAD, work_issue=41, preview_run_id=24,
        preview_digest=DIGEST, dry_run_id=30, dry_run_digest=DRY_DIGEST,
        sql_risk_reasons=["material_access_change"],
        reviewer_actor="independent-reviewer", run_id=31, attempt=1,
        roster={"independent-reviewer"},
    )


class IndependentReviewTests(unittest.TestCase):
    def test_reviewer_fetches_live_main_before_freshness_check(self):
        workflow = (Path(__file__).resolve().parents[1] /
                    ".github/workflows/production-independent-review.yml").read_text(encoding="utf-8")
        self.assertIn("if: github.ref == 'refs/heads/main'", workflow)
        fetch = workflow.index("git fetch origin main")
        check = workflow.index("check-main-tip-freshness.mjs")
        self.assertLess(fetch, check)
        self.assertIn('test "$(git rev-parse origin/main)" = "$MAIN_SHA"', workflow)

    def test_roster_reads_only_listed_reviewers_and_empty_means_none(self):
        with tempfile.TemporaryDirectory() as temp:
            roster = Path(temp, "roster.json")
            roster.write_text(json.dumps({"schema_version": 1, "authorized_github_reviewers": []}), encoding="utf-8")
            self.assertEqual(gate.authorized_reviewers(roster), set())
            roster.write_text(json.dumps({"schema_version": 1, "authorized_github_reviewers": ["Named-Reviewer"]}), encoding="utf-8")
            self.assertEqual(gate.authorized_reviewers(roster), {"named-reviewer"})

    def test_full_packet_and_changed_fields(self):
        validate(packet())
        mutations = (
            {"reviewed_main_sha": "0" * 40},
            {"target_project_ref": "preview"},
            {"action": "production-dry-run"},
            {"ordered_allowlist": list(reversed(ALLOWLIST)) + ["20260928000001"]},
            {"source_pr": 43}, {"source_pr_head": "0" * 40},
            {"work_issue": 43}, {"preview_run_id": 25},
            {"preview_artifact_digest": "sha256:" + "0" * 64},
            {"dry_run_run_id": 32},
            {"dry_run_artifact_digest": "sha256:" + "0" * 64},
            {"sql_risk_reasons": []},
            {"verdict": "REQUEST_CHANGES"},
            {"reviewer_actor": "spoofed"},
            {"workflow_run_id": 32}, {"workflow_run_attempt": 2},
            {"extra": "operator assertion"},
        )
        for change in mutations:
            with self.subTest(change=change), self.assertRaises(gate.EvidenceError):
                validate(packet(**change))

    def test_unlisted_reviewer_and_same_actor_refuse(self):
        with self.assertRaisesRegex(gate.EvidenceError, "not on owner-approved roster"):
            gate.validate_packet(
                packet(), sha=SHA, allowlist=ALLOWLIST, source_pr=42,
                source_pr_head=SOURCE_HEAD, work_issue=41, preview_run_id=24,
                preview_digest=DIGEST, dry_run_id=30, dry_run_digest=DRY_DIGEST,
                sql_risk_reasons=["material_access_change"],
                reviewer_actor="independent-reviewer", run_id=31, attempt=1,
                roster=set(),
            )
        with self.assertRaisesRegex(gate.EvidenceError, "independent actors"):
            gate.record_operator(packet=packet(), reviewer_actor="u2giants",
                                 operator_actor="U2Giants", review_run_id=31,
                                 review_digest=DIGEST, run_id=40, attempt=1)

    def test_operator_record_preserves_reviewer_and_discloses_operator(self):
        recorded = gate.record_operator(
            packet=packet(), reviewer_actor="independent-reviewer",
            operator_actor="u2giants", review_run_id=31, review_digest=DIGEST,
            run_id=40, attempt=1,
        )
        self.assertEqual(recorded["reviewer_actor"], "independent-reviewer")
        self.assertEqual(recorded["operator_actor"], "u2giants")
        self.assertEqual(recorded["review_run_id"], 31)
        self.assertEqual(set(recorded), gate.RECORD_FIELDS)

    def test_provider_failure_missing_artifact_and_digest_drift_refuse(self):
        def run_api(endpoint):
            if "artifacts" in endpoint:
                return {"artifacts": []}
            return {
                "id": 31, "status": "completed", "conclusion": "success",
                "event": "workflow_dispatch", "head_sha": SHA,
                "head_branch": "main",
                "path": gate.REVIEW_WORKFLOW,
                "repository": {"full_name": gate.REPOSITORY},
                "actor": {"login": "independent-reviewer"}, "run_attempt": 1,
            }
        with self.assertRaises(gate.EvidenceError):
            gate.verify_review(
                run_id=31, digest=DIGEST, sha=SHA, allowlist=ALLOWLIST,
                source_pr=42, source_pr_head=SOURCE_HEAD, work_issue=41,
                preview_run_id=24, preview_digest=DIGEST, dry_run_id=30,
                dry_run_digest=DRY_DIGEST, roster={"independent-reviewer"},
                api=run_api,
            )
        with self.assertRaises(RuntimeError):
            gate.verify_review(
                run_id=31, digest=DIGEST, sha=SHA, allowlist=ALLOWLIST,
                source_pr=42, source_pr_head=SOURCE_HEAD, work_issue=41,
                preview_run_id=24, preview_digest=DIGEST, dry_run_id=30,
                dry_run_digest=DRY_DIGEST, roster={"independent-reviewer"},
                api=lambda _endpoint: (_ for _ in ()).throw(RuntimeError("provider unavailable")),
            )

    def test_risk_vector_is_canonical_and_source_derived(self):
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp, "supabase", "migrations")
            folder.mkdir(parents=True)
            (folder / f"{ALLOWLIST[0]}_risk.sql").write_text(
                "create table public.review_test(id bigint primary key);\n",
                encoding="utf-8",
            )
            vector = gate.risk_vector(sha=SHA, allowlist=ALLOWLIST,
                                      repo_root=Path(temp))
            self.assertEqual(vector["reviewed_main_sha"], SHA)
            self.assertEqual(vector["ordered_allowlist"], ALLOWLIST)
            self.assertIsInstance(vector["sql_risk_reasons"], list)
            self.assertEqual(json.loads(gate.canonical_json(vector)), vector)

    def test_risk_vector_accepts_real_risk_reasons_from_the_classifier(self):
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp, "supabase", "migrations")
            folder.mkdir(parents=True)
            (folder / f"{ALLOWLIST[0]}_risk.sql").write_text(
                "drop table public.review_test;\n", encoding="utf-8",
            )
            vector = gate.risk_vector(sha=SHA, allowlist=ALLOWLIST,
                                      repo_root=Path(temp))
            self.assertTrue(vector["sql_risk_reasons"])

    def test_package_style_workflow_import_reaches_the_risk_gate(self):
        root = Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp, "supabase", "migrations")
            folder.mkdir(parents=True)
            (folder / f"{ALLOWLIST[0]}_risk.sql").write_text(
                "drop table public.review_test;\n", encoding="utf-8",
            )
            code = ("import sys; from pathlib import Path\n"
                    "sys.path[:] = [p for p in sys.path if not p.rstrip('/').endswith('scripts')]\n"
                    "from scripts.production_independent_review import risk_vector\n"
                    f"v = risk_vector(sha={SHA!r}, allowlist={ALLOWLIST!r}, repo_root=Path({temp!r}))\n"
                    "assert v['sql_risk_reasons'], v\n")
            result = subprocess.run([sys.executable, "-c", code], cwd=root,
                                    capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_dry_run_digest_and_recomputed_risk_are_both_required(self):
        vector = {"sql_risk_reasons": ["material_access_change"]}
        def archive(changed=False):
            buffer = io.BytesIO()
            with zipfile.ZipFile(buffer, "w") as zipped:
                zipped.writestr("production-ledger-before.txt", "ledger")
                zipped.writestr("production-dry-run.txt", "dry")
                zipped.writestr("bounded/supabase/migration-content-manifest.json", "{}")
                zipped.writestr(gate.DRY_RUN_FILE, gate.canonical_json(
                    {"sql_risk_reasons": []} if changed else vector))
            return buffer.getvalue()
        raw = archive()
        digest = "sha256:" + hashlib.sha256(raw).hexdigest()
        def api(endpoint):
            if "artifacts" in endpoint:
                return {"artifacts": [{"id": 7, "name": f"production-migration-dry-run-{SHA}",
                    "expired": False, "digest": digest, "workflow_run": {"id": 30}}]}
            return {"id": 30, "status": "completed", "conclusion": "success",
                    "event": "workflow_dispatch", "head_sha": SHA, "head_branch": "main",
                    "path": gate.APPLY_WORKFLOW,
                    "repository": {"full_name": gate.REPOSITORY},
                    "actor": {"login": "operator"}, "run_attempt": 1}
        with mock.patch.object(gate, "risk_vector", return_value=vector):
            good = gate.verify_dry_run(run_id=30, digest=digest, sha=SHA,
                allowlist=ALLOWLIST, repo_root=Path("."), api=api,
                downloader=lambda _id, path: path.write_bytes(raw))
            self.assertEqual(good, vector)
            with self.assertRaisesRegex(gate.EvidenceError, "downloaded dry-run bytes"):
                gate.verify_dry_run(run_id=30, digest=digest, sha=SHA,
                    allowlist=ALLOWLIST, repo_root=Path("."), api=api,
                    downloader=lambda _id, path: path.write_bytes(archive(changed=True)))
            with mock.patch.object(gate, "risk_vector", return_value={"sql_risk_reasons": []}):
                with self.assertRaisesRegex(gate.EvidenceError, "risk vector differs"):
                    gate.verify_dry_run(run_id=30, digest=digest, sha=SHA,
                        allowlist=ALLOWLIST, repo_root=Path("."), api=api,
                        downloader=lambda _id, path: path.write_bytes(raw))

    def test_apply_rechecks_both_artifacts_and_independent_actors(self):
        record = gate.record_operator(
            packet=packet(), reviewer_actor="independent-reviewer",
            operator_actor="operator", review_run_id=31, review_digest=DIGEST,
            run_id=40, attempt=1,
        )
        context = dict(
            run_id=40, run_attempt=1, sha=SHA, allowlist=ALLOWLIST,
            operator_actor="operator", apply_actor="operator",
            apply_triggering_actor="operator",
            source_pr=42, source_pr_head=SOURCE_HEAD, work_issue=41,
            preview_run_id=24, preview_digest=DIGEST,
            dry_run_run_id=30, dry_run_digest=DRY_DIGEST,
            api=lambda endpoint: ({"object": {"sha": SHA}}
                if endpoint.endswith("/git/ref/heads/main") else
                {"state": "closed", "merged_at": "2026-09-28T00:00:00Z",
                 "head": {"sha": SOURCE_HEAD}}),
            downloader=lambda _id, _path: None,
        )
        with mock.patch.object(gate, "verify_review", return_value=(packet(), "independent-reviewer")) as reviewer, \
             mock.patch.object(gate, "verify_dry_run", return_value={}) as dry_run:
            apply_gate.validate_independent_record(record, **context)
            self.assertEqual(reviewer.call_count, 1)
            self.assertEqual(dry_run.call_count, 1)
            for changed in (
                {"apply_actor": "independent-reviewer"},
                {"apply_triggering_actor": "independent-reviewer"},
                {"dry_run_digest": "sha256:" + "0" * 64},
                {"source_pr_head": "0" * 40},
            ):
                with self.subTest(changed=changed), self.assertRaises(apply_gate.EvidenceError):
                    apply_gate.validate_independent_record(record, **{**context, **changed})
            with mock.patch.object(gate, "verify_review", side_effect=RuntimeError("provider unavailable")):
                with self.assertRaises(RuntimeError):
                    apply_gate.validate_independent_record(record, **context)

    def test_legacy_v1_is_refused_for_new_manual_recovery(self):
        blob = io.BytesIO()
        with zipfile.ZipFile(blob, "w") as archive:
            archive.writestr(apply_gate.EVIDENCE_FILE, apply_gate.canonical_json({}))
        raw = blob.getvalue()
        digest = "sha256:" + hashlib.sha256(raw).hexdigest()
        def api(endpoint):
            if "artifacts" in endpoint:
                return {"artifacts": [{"name": apply_gate.ARTIFACT_NAME,
                    "id": 1, "expired": False, "digest": digest,
                    "workflow_run": {"id": 40}}]}
            return {"id": 40, "status": "completed", "conclusion": "success",
                    "event": "workflow_dispatch", "head_sha": SHA,
                    "path": apply_gate.WORKFLOW_PATH,
                    "repository": {"full_name": apply_gate.REPOSITORY},
                    "actor": {"login": "operator"}, "run_attempt": 1}
        with tempfile.TemporaryDirectory() as temp, self.assertRaisesRegex(
            apply_gate.EvidenceError, "legacy manual v1 evidence cannot authorize"
        ):
            apply_gate.verify(
                run_id_text="40", expected_digest=digest, sha=SHA,
                allowlist_raw=ALLOWLIST[0], api=api,
                downloader=lambda _id, path: path.write_bytes(raw),
                output_dir=Path(temp), require_independent=True,
            )

    def test_full_nested_provider_chain_passes_and_changed_risk_refuses(self):
        vector = {"sql_risk_reasons": ["material_access_change"]}
        def zipped(files):
            buffer = io.BytesIO()
            with zipfile.ZipFile(buffer, "w") as archive:
                for name, content in files.items():
                    archive.writestr(name, content)
            return buffer.getvalue()
        dry_blob = zipped({
            "production-ledger-before.txt": "ledger", "production-dry-run.txt": "dry",
            "bounded/migration-content-manifest.json": "{}",
            gate.DRY_RUN_FILE: gate.canonical_json(vector),
        })
        dry_digest = "sha256:" + hashlib.sha256(dry_blob).hexdigest()
        review = packet(dry_run_artifact_digest=dry_digest)
        review_blob = zipped({gate.REVIEW_FILE: gate.canonical_json(review)})
        review_digest = "sha256:" + hashlib.sha256(review_blob).hexdigest()
        record = gate.record_operator(
            packet=review, reviewer_actor="independent-reviewer",
            operator_actor="operator", review_run_id=31,
            review_digest=review_digest, run_id=40, attempt=1,
        )
        record_blob = zipped({gate.RECORD_FILE: gate.canonical_json(record)})
        record_digest = "sha256:" + hashlib.sha256(record_blob).hexdigest()
        blobs = {30: dry_blob, 31: review_blob, 40: record_blob}
        digests = {30: dry_digest, 31: review_digest, 40: record_digest}
        names = {30: f"production-migration-dry-run-{SHA}",
                 31: gate.REVIEW_ARTIFACT, 40: gate.RECORD_ARTIFACT}
        paths = {30: gate.APPLY_WORKFLOW, 31: gate.REVIEW_WORKFLOW,
                 40: gate.RECORD_WORKFLOW}
        actors = {30: "operator", 31: "independent-reviewer", 40: "operator"}
        def api(endpoint):
            if endpoint.endswith("/git/ref/heads/main"):
                return {"object": {"sha": SHA}}
            if endpoint.endswith("/pulls/42"):
                return {"state": "closed", "merged_at": "2026-09-28T00:00:00Z",
                        "head": {"sha": SOURCE_HEAD}}
            for run_id in (30, 31, 40):
                if f"/actions/runs/{run_id}/artifacts?" in endpoint:
                    return {"artifacts": [{"id": run_id, "name": names[run_id],
                        "expired": False, "digest": digests[run_id],
                        "workflow_run": {"id": run_id}}]}
                if endpoint.endswith(f"/actions/runs/{run_id}"):
                    return {"id": run_id, "status": "completed", "conclusion": "success",
                        "event": "workflow_dispatch", "head_sha": SHA,
                        "head_branch": "main", "path": paths[run_id],
                        "repository": {"full_name": gate.REPOSITORY},
                        "actor": {"login": actors[run_id]},
                        "triggering_actor": {"login": actors[run_id]},
                        "run_attempt": 1}
            raise RuntimeError(f"unexpected provider request: {endpoint}")
        def download(artifact_id, destination):
            destination.write_bytes(blobs[artifact_id])
        kwargs = dict(
            run_id_text="40", expected_digest=record_digest, sha=SHA,
            allowlist_raw=ALLOWLIST[0], api=api, downloader=download,
            require_independent=True, apply_actor="operator",
            apply_triggering_actor="operator", source_pr=42,
            work_issue=41,
            preview_run_id=24, preview_digest=DIGEST,
        )
        with tempfile.TemporaryDirectory() as temp, \
             mock.patch.object(gate, "authorized_reviewers", return_value={"independent-reviewer"}), \
             mock.patch.object(gate, "risk_vector", return_value=vector):
            output = apply_gate.verify(output_dir=Path(temp), **kwargs)
            self.assertEqual(json.loads(output.read_text()), record)
            with mock.patch.object(gate, "risk_vector", return_value={"sql_risk_reasons": []}):
                with self.assertRaisesRegex(gate.EvidenceError, "risk vector differs"):
                    apply_gate.verify(output_dir=Path(temp), **kwargs)
            def stale_api(endpoint):
                if endpoint.endswith("/git/ref/heads/main"):
                    return {"object": {"sha": "0" * 40}}
                return api(endpoint)
            with self.assertRaisesRegex(gate.EvidenceError, "current main differs"):
                apply_gate.verify(output_dir=Path(temp), **{**kwargs, "api": stale_api})


if __name__ == "__main__":
    unittest.main()
