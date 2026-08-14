import json
import sys
import tempfile
import unittest
from argparse import Namespace
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from production_business_risk_gate import RiskGateError, classify_sql, load_activation, prove_activation, prove_preview


class ProductionBusinessRiskGateTests(unittest.TestCase):
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
                "canonical_skill_sha256": "c" * 64, "installed_skill_sha256": "d" * 64,
                "forward_test_sha256": "e" * 64,
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

    def test_forged_preview_claim_is_rejected_before_download(self):
        run = {
            "status": "completed", "conclusion": "success", "event": "workflow_dispatch",
            "head_sha": "b" * 40, "path": ".github/workflows/shared-supabase-migrations.yml",
        }
        with self.assertRaisesRegex(RiskGateError, "wrong head_sha"):
            prove_preview(
                run_id=7, digest="sha256:" + "c" * 64, pr_head="a" * 40,
                allowlist=["20260814000000"], api=lambda _: run,
                downloader=lambda *_: self.fail("forged run must not download"), repo_root=Path.cwd(),
            )

    def test_production_workflow_enforces_gate_twice_and_keeps_old_boundary(self):
        workflow = Path(__file__).parents[1] / ".github/workflows/shared-supabase-migrations.yml"
        text = workflow.read_text(encoding="utf-8")
        self.assertEqual(text.count("python scripts/production_business_risk_gate.py"), 2)
        self.assertIn("environment: production", text)
        self.assertGreaterEqual(text.count("config/production-risk-policy-activation.json"), 2)


if __name__ == "__main__":
    unittest.main()
