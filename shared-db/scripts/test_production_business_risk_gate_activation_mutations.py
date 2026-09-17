"""Falsification tests for business-risk activation evidence (issue #2362).

PR #2354's guard mutation sweep replaced each refusal condition below with
``False`` and the offline suite stayed green. Every test here starts from an
evidence record the gate ACCEPTS and changes exactly one fact, so disabling the
matching guard lets the forged record through and the test goes red.
"""
import json
import subprocess
import sys
import tempfile
import unittest
from argparse import Namespace
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).parent))

import production_business_risk_gate as gate
from production_business_risk_gate import RISK_TEXT, RiskGateError, load_activation, prove_activation

FORWARD = "docs/verification/issue-1039-production-risk-activation-forward-proof.md"


def valid_activation(forward_sha="a" * 64):
    return {
        "active": True, "schema_version": gate.ACTIVE_SCHEMA,
        "shared_db_pr": 1021, "shared_db_merge_sha": "a" * 40,
        "ai_devops_pr": 24, "ai_devops_merge_sha": "b" * 40,
        "skill_hashes": {
            name: {"canonical": digit * 64, "codex_installed": digit * 64, "claude_installed": digit * 64}
            for name, digit in (("SKILL.md", "c"), ("references/operating-manual.md", "d"), ("agents/openai.yaml", "e"))
        },
        "forward_test_path": FORWARD,
        "forward_test_sha256": forward_sha,
    }


class LoadActivationGuardTests(unittest.TestCase):
    def load(self, data):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp, "activation.json")
            path.write_text(json.dumps(data), encoding="utf-8")
            return load_activation(path)

    def test_the_baseline_record_is_accepted(self):
        self.assertEqual(self.load(valid_activation()), valid_activation())

    def test_inactive_or_old_schema_is_refused(self):
        for override in ({"active": False}, {"active": "true"}, {"schema_version": gate.ACTIVATION_SCHEMA}):
            with self.subTest(override=override), self.assertRaisesRegex(RiskGateError, "is not active"):
                self.load({**valid_activation(), **override})

    def test_merge_shas_must_be_exact_commits(self):
        for key in ("shared_db_merge_sha", "ai_devops_merge_sha"):
            with self.subTest(key=key), self.assertRaisesRegex(RiskGateError, f"activation {key} is not an exact commit"):
                self.load({**valid_activation(), key: "A" * 40})

    def test_forward_test_digest_must_be_sha256(self):
        with self.assertRaisesRegex(RiskGateError, "forward_test_sha256 is not a SHA-256 digest"):
            self.load({**valid_activation(), "forward_test_sha256": "a" * 63})

    def test_skill_hashes_must_pin_exactly_the_three_files(self):
        data = valid_activation()
        del data["skill_hashes"]["agents/openai.yaml"]
        with self.assertRaisesRegex(RiskGateError, "must pin all three orchestrator files"):
            self.load(data)

    def test_each_hash_record_must_have_exactly_three_sides(self):
        data = valid_activation()
        del data["skill_hashes"]["SKILL.md"]["claude_installed"]
        with self.assertRaisesRegex(RiskGateError, "hash record is incomplete for SKILL.md"):
            self.load(data)

    def test_equal_but_non_sha256_hashes_are_refused(self):
        data = valid_activation()
        data["skill_hashes"]["SKILL.md"] = {k: "not-a-digest" for k in ("canonical", "codex_installed", "claude_installed")}
        with self.assertRaisesRegex(RiskGateError, "activation hash is not SHA-256 for SKILL.md"):
            self.load(data)

    def test_forward_test_path_must_be_the_governed_proof(self):
        with self.assertRaisesRegex(RiskGateError, "not the governed issue #1039 proof"):
            self.load({**valid_activation(), "forward_test_path": "docs/elsewhere.md"})


class ProveActivationGuardTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        forward = self.root / FORWARD
        forward.parent.mkdir(parents=True)
        forward.write_text("forward proof\n", encoding="utf-8")
        self.data = valid_activation(gate.sha256_file(forward))
        ok = subprocess.CompletedProcess(args=[], returncode=0, stdout=b"", stderr=b"")
        patcher = mock.patch.object(gate.subprocess, "run", return_value=ok)
        patcher.start()
        self.addCleanup(patcher.stop)

    def api(self, shared=None, ai=None):
        pulls = {
            "u2giants/shared-db/pulls/": {"merged": True, "merge_commit_sha": "a" * 40, **(shared or {})},
            "u2giants/ai-devops/pulls/": {"merged": True, "merge_commit_sha": "b" * 40, **(ai or {})},
        }
        def read(endpoint):
            for prefix, payload in pulls.items():
                if endpoint.startswith(f"repos/{prefix}"):
                    return payload
            raise AssertionError(endpoint)
        return read

    def prove(self, data=None, api=None):
        prove_activation(data or self.data, main_sha="f" * 40, api=api or self.api(), repo_root=self.root)

    def test_the_baseline_activation_is_proved(self):
        self.prove()

    def test_shared_db_policy_pr_must_be_the_exact_merge(self):
        for shared in ({"merged": False}, {"merge_commit_sha": "c" * 40}):
            with self.subTest(shared=shared), self.assertRaisesRegex(RiskGateError, "shared-db policy PR merge is not proved"):
                self.prove(api=self.api(shared=shared))

    def test_ai_devops_policy_pr_must_be_the_exact_merge(self):
        for ai in ({"merged": None}, {"merge_commit_sha": "c" * 40}):
            with self.subTest(ai=ai), self.assertRaisesRegex(RiskGateError, "ai-devops policy PR merge is not proved"):
                self.prove(api=self.api(ai=ai))

    def test_activation_must_name_the_two_reviewed_policy_prs(self):
        for override in ({"shared_db_pr": 1022}, {"ai_devops_pr": 25}):
            with self.subTest(override=override), self.assertRaisesRegex(RiskGateError, "not bound to the two reviewed policy PRs"):
                self.prove({**self.data, **override})

    def test_forward_test_bytes_must_match_the_record(self):
        with self.assertRaisesRegex(RiskGateError, "forward-test proof does not match"):
            self.prove({**self.data, "forward_test_sha256": "0" * 64})


class OwnerDecisionAcceptedRisksGuardTests(unittest.TestCase):
    """The legacy owner-decision path must accept EXACTLY the derived risks."""

    def assess(self, accepted):
        def fake_review(**kwargs):
            path = Path(kwargs["output_dir"], "review.json")
            path.write_text(json.dumps({"schema_version": "shared-db-production-apply-review/v1", "verdict": "APPROVE"}), encoding="utf-8")
            return path
        args = Namespace(
            repo=Path.cwd(), activation=Path("activation.json"), main_sha="a" * 40,
            allowlist="20260915000001", pr=101, work_issue=7, review_run_id=55,
            review_digest="sha256:" + "9" * 64, preview_run_id="66", preview_digest="sha256:" + "8" * 64,
            ephemeral_check_run_id=None, preview_project_ref="mvpkijzfmfcxhnzqogzs",
            owner_decision_run_id="77", owner_decision_digest="sha256:" + "7" * 64, migration_train_record=None,
        )
        with mock.patch.object(gate, "normalize_review_allowlist", return_value=["20260915000001"]), \
             mock.patch.object(gate, "load_activation", return_value={}), \
             mock.patch.object(gate, "prove_activation"), \
             mock.patch.object(gate, "prove_pr_and_checks", return_value=("1" * 40, "b" * 40)), \
             mock.patch.object(gate, "verify_review", side_effect=fake_review), \
             mock.patch.object(gate, "prove_preview"), \
             mock.patch.object(gate, "classify_sql", return_value=[RISK_TEXT["expected_downtime"]]), \
             mock.patch.object(gate, "verify_owner_decision", return_value={"accepted_risks": accepted}):
            return gate.assess(args, api=lambda endpoint: self.fail(endpoint))

    def test_exactly_the_derived_risk_is_accepted(self):
        result = self.assess(["expected_downtime"])
        self.assertEqual(result["governedEvidence"]["ownerDecision"], {"accepted_risks": ["expected_downtime"]})

    def test_owner_decision_accepting_a_different_or_extra_risk_is_refused(self):
        for accepted in ([], ["material_access_change"], ["expected_downtime", "material_access_change"]):
            with self.subTest(accepted=accepted), self.assertRaisesRegex(
                RiskGateError, "does not accept exactly the risks derived"
            ):
                self.assess(accepted)


if __name__ == "__main__":
    unittest.main()
