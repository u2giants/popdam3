"""Issue #3039: automatic qualification must ask the production gate's evidence question.

Runs 35052182196 and 35061726161 were dispatched on historical-rebind preview
evidence whose original apply ran on an older commit; the gate then refused the
producer drift. These tests reproduce that refusal and prove qualification now
routes to evidence the gate accepts, or refuses without dispatching -- with the
gate's own proofs unchanged.
"""
import re
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).parent))

import production_business_risk_gate as gate  # noqa: E402
from production_business_risk_gate import (  # noqa: E402
    EPHEMERAL_CHECK_NAME, PreviewProducerMismatch, RiskGateError, qualify_automatic_route,
)

MAIN = "86da2d44bcd390b3177f322f947b212c8dc9bbc9"
HEAD = "bac58c5f49687c7911d013e1f392fcf5c356e626"
VERSION = "20260916033914"
VERBATIM = (
    "original apply run 35060692115 dispatched at 3fdd16effbd154e1602c29aa5610161910138d68 "
    f"produced evidence with scripts/production-verification-sidecars/{VERSION}.json absent "
    f"where the merge commit {MAIN} of the pull request that authored {VERSION} has it present"
)
RECORD = {"sourcePr": 3007, "mainSha": MAIN, "sourceMergeSha": MAIN,
          "allowlist": [VERSION], "originalApplyRuns": {VERSION: 35060692115}}


def fake_api(checks=None, merged=True):
    checks = checks if checks is not None else [
        {"id": 104674784812, "name": EPHEMERAL_CHECK_NAME, "status": "completed", "conclusion": "success"},
    ]

    def api(endpoint):
        if endpoint.endswith("/pulls/3007"):
            return {"merged": merged, "head": {"sha": HEAD}, "merge_commit_sha": MAIN}
        if endpoint.endswith(f"/commits/{HEAD}/check-runs?per_page=100"):
            return {"check_runs": checks}
        raise AssertionError(f"unexpected read {endpoint}")
    return api


def qualify(record=RECORD, api=None):
    return qualify_automatic_route(
        main_sha=MAIN, allowlist=[VERSION], source_pr=3007, recovery_record=record,
        repo_root=Path("."), api=api or fake_api(), downloader=lambda *_: None,
    )


class AutomaticQualificationRouteTests(unittest.TestCase):
    def test_stale_original_run_is_never_dispatched_as_preview_evidence(self):
        """Reproduces #3039: the gate's producer pin refuses; low-risk takes the ephemeral route."""
        ephemeral = mock.Mock(return_value={})
        with mock.patch.object(gate, "prove_historical_original_apply_runs",
                               side_effect=PreviewProducerMismatch(VERBATIM)) as proof, \
                mock.patch.object(gate, "preview_required_reasons", return_value=[]), \
                mock.patch.object(gate, "prove_ephemeral_ci_evidence", ephemeral):
            result = qualify()
        proof.assert_called_once()
        self.assertEqual(proof.call_args.kwargs["record"], RECORD)
        self.assertEqual(proof.call_args.kwargs["main_sha"], MAIN)
        self.assertEqual(result["route"], "ephemeral")
        self.assertEqual(result["ephemeral_check_run_id"], 104674784812)
        self.assertIn("absent where the merge commit", result["preview_refusal"])
        # The ephemeral evidence is proved with the gate's own function, on the exact PR head.
        self.assertEqual(ephemeral.call_args.kwargs["pr_head"], HEAD)
        self.assertEqual(ephemeral.call_args.kwargs["check_run_id_text"], "104674784812")

    def test_high_risk_stale_evidence_refuses_without_substitution(self):
        ephemeral = mock.Mock()
        with mock.patch.object(gate, "prove_historical_original_apply_runs",
                               side_effect=PreviewProducerMismatch(VERBATIM)), \
                mock.patch.object(gate, "preview_required_reasons", return_value=["drops a column"]), \
                mock.patch.object(gate, "prove_ephemeral_ci_evidence", ephemeral):
            with self.assertRaisesRegex(RiskGateError, "high-risk.*drops a column"):
                qualify()
        ephemeral.assert_not_called()

    def test_ephemeral_proof_failure_refuses(self):
        with mock.patch.object(gate, "prove_historical_original_apply_runs",
                               side_effect=PreviewProducerMismatch(VERBATIM)), \
                mock.patch.object(gate, "preview_required_reasons", return_value=[]), \
                mock.patch.object(gate, "prove_ephemeral_ci_evidence",
                                  side_effect=RiskGateError("ephemeral CI job has wrong head_sha")):
            with self.assertRaisesRegex(RiskGateError, "wrong head_sha"):
                qualify()

    def test_zero_or_ambiguous_successful_ephemeral_checks_refuse(self):
        failed = [{"id": 1, "name": EPHEMERAL_CHECK_NAME, "status": "completed", "conclusion": "failure"}]
        two = [{"id": i, "name": EPHEMERAL_CHECK_NAME, "status": "completed", "conclusion": "success"} for i in (1, 2)]
        for checks in ([], failed, two):
            with mock.patch.object(gate, "prove_historical_original_apply_runs",
                                   side_effect=PreviewProducerMismatch(VERBATIM)), \
                    mock.patch.object(gate, "preview_required_reasons", return_value=[]), \
                    mock.patch.object(gate, "prove_ephemeral_ci_evidence") as ephemeral:
                with self.assertRaisesRegex(RiskGateError, "exactly one successful"):
                    qualify(api=fake_api(checks=checks))
                ephemeral.assert_not_called()

    def test_original_run_the_gate_accepts_keeps_the_preview_route(self):
        with mock.patch.object(gate, "prove_historical_original_apply_runs", return_value=None), \
                mock.patch.object(gate, "prove_ephemeral_ci_evidence") as ephemeral:
            self.assertEqual(qualify(), {"route": "preview"})
        ephemeral.assert_not_called()

    def test_merged_lane_evidence_is_this_run_at_exact_main(self):
        with mock.patch.object(gate, "prove_historical_original_apply_runs") as proof:
            self.assertEqual(qualify(record=None), {"route": "preview"})
        proof.assert_not_called()

    def test_unmerged_source_pr_refuses(self):
        with self.assertRaisesRegex(RiskGateError, "not merged"):
            qualify(api=fake_api(merged=False))


class WorkflowWiringTests(unittest.TestCase):
    def setUp(self):
        text = Path(__file__).parent.parent.joinpath(
            ".github/workflows/shared-supabase-migrations.yml").read_text(encoding="utf-8")
        start = text.index("    name: Automatic production qualification and dispatch")
        self.job = text[start:text.index("\n  # ISSUE #646", start)]

    def test_route_is_qualified_before_evidence_and_dispatch(self):
        route = self.job.index("- name: Qualify the evidence route the production gate accepts")
        self.assertLess(route, self.job.index("- name: Write immutable automatic review evidence"))
        self.assertLess(route, self.job.index("- name: Dispatch the existing serial production lane"))
        self.assertIn("python scripts/production_business_risk_gate.py qualify-route", self.job)
        self.assertIn('RECORD_ARGS=(--recovery-record "$RECOVERY_EVIDENCE")', self.job)

    def test_recovery_record_is_the_proof_the_source_guard_read_and_only_for_historical_runs(self):
        route = self.job.index("- name: Qualify the evidence route the production gate accepts")
        self.assertLess(self.job.index("- name: Read the historical recovery proof from the exact preview artifact"), route)
        path = "RECOVERY_EVIDENCE: ${{ runner.temp }}/recovery-evidence/historical-preview-source.json"
        self.assertEqual(self.job.count(path), 2)
        step = self.job[route:self.job.index("- name: Write immutable automatic review evidence")]
        self.assertIn(path, step)
        self.assertIn("HISTORICAL_PREVIEW_PR: ${{ inputs.historical_preview_source_pr }}", step)
        self.assertRegex(step, r'RECORD_ARGS=\(\)\n\s+if \[ -n "\$\{HISTORICAL_PREVIEW_PR:-\}" \]; then\n'
                               r'\s+RECORD_ARGS=\(--recovery-record "\$RECOVERY_EVIDENCE"\)\n\s+fi')

    def test_refusal_reaches_the_step_log_not_the_route_file(self):
        with mock.patch.object(gate, "qualify_automatic_route", side_effect=RiskGateError("no route")), \
                mock.patch("sys.stdout") as out, mock.patch("sys.stderr") as err:
            code = gate.qualify_route_main(["--main-sha", MAIN, "--allowlist", VERSION, "--pr", "3007"])
        self.assertEqual(code, 2)
        written_err = "".join(c.args[0] for c in err.write.call_args_list)
        self.assertIn("::error::ENGINEER ACTION REQUIRED", written_err)
        self.assertNotIn("::error::", "".join(c.args[0] for c in out.write.call_args_list))

    def test_dispatch_names_exactly_one_route(self):
        self.assertIn("EPHEMERAL_CHECK_RUN_ID: ${{ steps.evidence_route.outputs.ephemeral_check_run_id }}", self.job)
        payload = re.search(r"'\{ref:\"main\",inputs:.*\}' \\", self.job).group(0)
        self.assertIn('if $ephemeral == "" then {preview_run_id:$run_id,preview_artifact_digest:$preview_digest} '
                      'else {ephemeral_check_run_id:$ephemeral} end', payload)
        self.assertEqual(payload.count("preview_run_id"), 1)


if __name__ == "__main__":
    unittest.main()
