import json
import subprocess
import sys
import tempfile
import unittest
from argparse import Namespace
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from production_business_risk_gate import RiskGateError, canonical_sha256, classify_sql, decide_business_risk, gh_json, is_pinned_historical_disney_source, load_activation, prove_activation, prove_preview, prove_preview_migration_contents


class ProductionBusinessRiskGateTests(unittest.TestCase):
    def test_live_owner_comment_read_retries_transient_failure(self):
        responses=iter([
            subprocess.CompletedProcess([],1,"","HTTP 503: unavailable"),
            subprocess.CompletedProcess([],0,'{"author_association":"OWNER"}',""),
        ])
        sleeps=[]
        result=gh_json("repos/u2giants/shared-db/issues/comments/7",
            runner=lambda *a,**k: next(responses),sleep=sleeps.append)
        self.assertEqual(result,{"author_association":"OWNER"})
        self.assertEqual(sleeps,[1])

    def test_non_comment_evidence_read_never_retries(self):
        calls=[]
        def runner(*args,**kwargs):
            calls.append(1); return subprocess.CompletedProcess([],1,"","HTTP 503: unavailable")
        with self.assertRaisesRegex(RiskGateError,"HTTP 503"):
            gh_json("repos/u2giants/shared-db/pulls/1108",runner=runner,
                sleep=lambda _: self.fail("non-comment read slept"))
        self.assertEqual(len(calls),1)

    def test_live_owner_comment_permanent_absence_never_retries(self):
        calls=[]
        def runner(*args,**kwargs):
            calls.append(1); return subprocess.CompletedProcess([],1,"","HTTP 404: Not Found")
        with self.assertRaisesRegex(RiskGateError,"HTTP 404"):
            gh_json("repos/u2giants/shared-db/issues/comments/7",runner=runner,
                sleep=lambda _: self.fail("permanent absence slept"))
        self.assertEqual(len(calls),1)

    def atomic_preview_fixture(self):
        temp = tempfile.TemporaryDirectory()
        root = Path(temp.name)
        migrations = root / "supabase/migrations"
        migrations.mkdir(parents=True)
        config = root / "config"
        config.mkdir()
        version = "20260816110750"
        filename = migrations / f"{version}_safe_forward.sql"
        filename.write_text("lock table plm.bridge in share mode;\n", encoding="utf-8")
        digest = canonical_sha256(filename)
        (config / "atomic-migration-allowlist.json").write_text(json.dumps({
            "schema_version": 1,
            "migrations": {version: {"sha256": digest, "targets": ["preview", "production"]}},
        }), encoding="utf-8")
        preflight = f"ATOMIC PREFLIGHT OK: target=preview version={version} sha256={digest} statements=8"
        texts = {
            "preview-dry-run.txt": preflight + "\n",
            "preview-apply.txt": preflight + "\n" + f"ATOMIC APPLY OK: target=preview version={version} ledger_row=1 statements=8\n",
            "migration-content-manifest.json": json.dumps({version: digest}),
        }
        return temp, root, version, digest, texts

    def test_atomic_preview_proof_binds_version_hash_manifest_apply_and_ledger_delta(self):
        temp, root, version, _, texts = self.atomic_preview_fixture()
        with temp:
            prove_preview_migration_contents(
                texts=texts, allowlist=[version], repo_root=root,
                before_versions={"20260801000000"},
                after_versions={"20260801000000", version}, historical=False,
            )

    def test_atomic_preview_proof_rejects_wrong_version_hash_filename_and_incomplete_proof(self):
        mutations = {
            "wrong version": lambda t, v, d: t.__setitem__("preview-apply.txt", t["preview-apply.txt"].replace(v, "20260816110751")),
            "wrong hash": lambda t, v, d: t.__setitem__("preview-dry-run.txt", t["preview-dry-run.txt"].replace(d, "f" * 64)),
            "wrong manifest": lambda t, v, d: t.__setitem__("migration-content-manifest.json", json.dumps({v: "e" * 64})),
            "missing apply": lambda t, v, d: t.__setitem__("preview-apply.txt", t["preview-apply.txt"].splitlines()[0] + "\n"),
            "forged extra line": lambda t, v, d: t.__setitem__("preview-dry-run.txt", t["preview-dry-run.txt"] + "trust me\n"),
        }
        for name, mutate in mutations.items():
            temp, root, version, digest, texts = self.atomic_preview_fixture()
            with self.subTest(name=name), temp, self.assertRaises(RiskGateError):
                mutate(texts, version, digest)
                prove_preview_migration_contents(
                    texts=texts, allowlist=[version], repo_root=root,
                    before_versions=set(), after_versions={version}, historical=False,
                )

    def test_legacy_preview_proof_still_rejects_wrong_filename(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            migrations = root / "supabase/migrations"
            migrations.mkdir(parents=True)
            (root / "config").mkdir()
            (root / "config/atomic-migration-allowlist.json").write_text(
                '{"schema_version":1,"migrations":{}}', encoding="utf-8"
            )
            version = "20260814000000"
            (migrations / f"{version}_exact.sql").write_text("select 1;", encoding="utf-8")
            texts = {
                "preview-dry-run.txt": f"Applying migration {version}_wrong.sql...",
                "preview-apply.txt": f"Applying migration {version}_wrong.sql...",
            }
            with self.assertRaisesRegex(RiskGateError, "exact migration"):
                prove_preview_migration_contents(
                    texts=texts, allowlist=[version], repo_root=root,
                    before_versions=set(), after_versions={version}, historical=False,
                )

    def test_preview_ledger_delta_rejects_extra_additions_removals_and_prior_version(self):
        cases = [
            ({"old"}, {"old", "20260816110750", "extra"}),
            ({"old"}, {"20260816110750"}),
            ({"20260816110750"}, {"20260816110750"}),
        ]
        for before, after in cases:
            temp, root, version, _, texts = self.atomic_preview_fixture()
            with self.subTest(before=before, after=after), temp, self.assertRaisesRegex(RiskGateError, "delta"):
                prove_preview_migration_contents(
                    texts=texts, allowlist=[version], repo_root=root,
                    before_versions=before, after_versions=after, historical=False,
                )
    def test_inactive_policy_fails_closed(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp, "activation.json")
            path.write_text('{"active":false,"schema_version":"shared-db-production-risk-activation/v1"}\n')
            data = load_activation(path)
            with self.assertRaisesRegex(RiskGateError, "old exact owner-approval rule"):
                prove_activation(data, main_sha="a" * 40, api=lambda _: {}, repo_root=Path(temp))

    def test_forged_activation_booleans_and_prose_are_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp, "activation.json")
            path.write_text(json.dumps({"active": True, "evidence": "trust me"}))
            with self.assertRaisesRegex(RiskGateError, "forged or incomplete"):
                load_activation(path)

    def test_installed_skill_hash_must_equal_canonical(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp, "activation.json")
            data = {
                "active": True, "schema_version": "shared-db-production-risk-activation/v2",
                "shared_db_pr": 1021, "shared_db_merge_sha": "a" * 40,
                "ai_devops_pr": 24, "ai_devops_merge_sha": "b" * 40,
                "skill_hashes": {
                    "SKILL.md": {"canonical": "c" * 64, "codex_installed": "d" * 64, "claude_installed": "c" * 64},
                    "references/operating-manual.md": {"canonical": "e" * 64, "codex_installed": "e" * 64, "claude_installed": "e" * 64},
                    "agents/openai.yaml": {"canonical": "f" * 64, "codex_installed": "f" * 64, "claude_installed": "f" * 64},
                },
                "forward_test_path": "docs/verification/issue-1039-production-risk-activation-forward-proof.md",
                "forward_test_sha256": "a" * 64,
            }
            path.write_text(json.dumps(data))
            with self.assertRaisesRegex(RiskGateError, "does not match"):
                load_activation(path)

    def test_static_analysis_is_conservative(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            migrations = root / "supabase/migrations"
            migrations.mkdir(parents=True)
            (migrations / "20260814000000_safe.sql").write_text("create table core.safe(id bigint); insert into core.safe values (1);")
            self.assertEqual(classify_sql(root, ["20260814000000"]), [])
            (migrations / "20260814000001_risky.sql").write_text("alter table core.safe add column x text; revoke select on core.safe from anon;")
            reasons = classify_sql(root, ["20260814000001"])
            self.assertIn("users may be interrupted", reasons)
            self.assertIn("access or permissions materially change", reasons)

    def test_synthetic_low_risk_and_all_five_risk_classes_fail_closed(self):
        self.assertEqual(
            decide_business_risk([], recovery_proven=True, review_approved=True),
            {"automaticPromotionAllowed": True, "ownerDecisionReasons": []},
        )
        cases = [
            (["existing production data may be lost or permanently altered"], True, True),
            (["users may be interrupted"], True, True),
            (["access or permissions materially change"], True, True),
            ([], False, True),
            ([], True, False),
        ]
        for sql_reasons, recovery, review in cases:
            with self.subTest(sql_reasons=sql_reasons, recovery=recovery, review=review):
                result = decide_business_risk(sql_reasons, recovery_proven=recovery, review_approved=review)
                self.assertFalse(result["automaticPromotionAllowed"])
                self.assertEqual(len(result["ownerDecisionReasons"]), 1)

    def test_forged_preview_claim_is_rejected_before_download(self):
        run = {
            "status": "completed", "conclusion": "success", "event": "workflow_dispatch",
            "head_sha": "b" * 40, "path": ".github/workflows/shared-supabase-migrations.yml",
        }
        with self.assertRaisesRegex(RiskGateError, "wrong head_sha"):
            prove_preview(
                run_id=7, digest="sha256:" + "c" * 64, pr_head="a" * 40,
                main_sha="d" * 40, source_pr=1, allowlist=["20260814000000"], api=lambda _: run,
                downloader=lambda *_: self.fail("forged run must not download"), repo_root=Path.cwd(),
            )

    def test_preview_artifact_must_match_pinned_run_and_digest_before_download(self):
        head = "a" * 40
        run = {
            "status": "completed", "conclusion": "success", "event": "workflow_dispatch",
            "head_sha": head, "path": ".github/workflows/shared-supabase-migrations.yml",
        }
        artifact = {
            "id": 9,
            "name": f"preview-migration-apply-{head}",
            "digest": "sha256:" + "d" * 64,
            "expired": False,
            "workflow_run": {"id": 7},
        }

        def api(endpoint):
            return {"artifacts": [artifact]} if endpoint.endswith("artifacts?per_page=100") else run

        with self.assertRaisesRegex(RiskGateError, "pinned digest"):
            prove_preview(
                run_id=7, digest="sha256:" + "c" * 64, pr_head=head,
                main_sha="b" * 40, source_pr=1, allowlist=["20260814000000"], api=api,
                downloader=lambda *_: self.fail("wrong digest must not download"), repo_root=Path.cwd(),
            )

        artifact["digest"] = "sha256:" + "c" * 64
        artifact["workflow_run"] = {"id": 8}
        with self.assertRaisesRegex(RiskGateError, "another run"):
            prove_preview(
                run_id=7, digest="sha256:" + "c" * 64, pr_head=head,
                main_sha="b" * 40, source_pr=1, allowlist=["20260814000000"], api=api,
                downloader=lambda *_: self.fail("wrong run must not download"), repo_root=Path.cwd(),
            )

    def test_production_workflow_enforces_gate_twice_and_keeps_old_boundary(self):
        workflow = Path(__file__).parents[1] / ".github/workflows/shared-supabase-migrations.yml"
        text = workflow.read_text(encoding="utf-8")
        self.assertEqual(text.count("python scripts/production_business_risk_gate.py"), 2)
        self.assertIn("environment: production", text)
        self.assertGreaterEqual(text.count("config/production-risk-policy-activation.json"), 2)

    def test_historical_preview_recovery_proves_existing_ledger_without_writing(self):
        workflow = Path(__file__).parents[1] / ".github/workflows/shared-supabase-migrations.yml"
        text = workflow.read_text(encoding="utf-8")
        self.assertIn("Recover proof for migrations already present on preview", text)
        self.assertIn("HISTORICAL PREVIEW PROOF: already applied; no database write performed", text)
        self.assertIn("REFUSED: historical preview recovery is missing ledger versions", text)
        self.assertIn("inputs.mode == 'apply' && inputs.historical_preview_source_pr == ''", text)

    def test_legacy_author_check_waiver_is_exactly_pinned(self):
        args = [924, "5135b668d87c1639281c506ae75fde75211b7019", "96bf385aa5c0f703ec98f5730249f586964f5142", ["20260813210000", "20260813220000"]]
        self.assertTrue(is_pinned_historical_disney_source(*args))
        for changed in [
            [925, *args[1:]],
            [args[0], "a" * 40, *args[2:]],
            [*args[:2], "b" * 40, args[3]],
            [*args[:3], ["20260813210000"]],
        ]:
            self.assertFalse(is_pinned_historical_disney_source(*changed))


if __name__ == "__main__":
    unittest.main()
