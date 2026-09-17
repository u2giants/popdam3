"""Falsification tests for historical original apply-run binding (issue #2367).

PR #2354's guard mutation sweep found these refusal guards in
``prove_historical_original_apply_runs`` could be replaced with ``False``
while the offline suite stayed green.

Four of them (map shape, map coverage, run-id shape, source-PR shape) and the
exact-main file cardinality guard are unreachable through ``prove_preview``:
re-derivation refuses such records earlier. The function is importable and
callable on its own, so those guards are driven directly here. The instance
binding shape guard is reachable end to end and is driven through the existing
``prove_preview`` fixture.
"""
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).parent))

import production_business_risk_gate as gate
import test_production_business_risk_gate as base
from production_business_risk_gate import RiskGateError, prove_historical_original_apply_runs

VERSION = "20260814130000"


def refuse_io(*_args):
    raise AssertionError("a malformed record must be refused before any read")


class DirectRecordShapeGuardTests(unittest.TestCase):
    def prove(self, record, allowlist=(VERSION,)):
        prove_historical_original_apply_runs(
            record=record, allowlist=list(allowlist), repo_root=Path("."), main_sha="f" * 40,
            api=refuse_io, downloader=refuse_io,
        )

    def test_record_without_an_original_run_map_is_refused(self):
        for runs in (None, {}, [], [[VERSION, 555]], "555"):
            with self.subTest(runs=runs), self.assertRaisesRegex(RiskGateError, "does not name the original apply run"):
                self.prove({"sourcePr": 984, "originalApplyRuns": runs})

    def test_run_map_that_does_not_cover_exactly_the_allowlist_is_refused(self):
        for runs in ({"20260814130001": 555}, {VERSION: 555, "20260814130001": 556}):
            with self.subTest(runs=runs), self.assertRaisesRegex(RiskGateError, "does not cover exactly the promoted allowlist"):
                self.prove({"sourcePr": 984, "originalApplyRuns": runs})

    def test_run_id_that_is_not_a_positive_integer_is_refused(self):
        for run_id in (True, 0, -5, "555", 555.0, None):
            with self.subTest(run_id=run_id), self.assertRaisesRegex(RiskGateError, "is not a run id"):
                self.prove({"sourcePr": 984, "originalApplyRuns": {VERSION: run_id}})

    def test_record_without_an_integer_source_pr_is_refused(self):
        for record in ({}, {"sourcePr": "984"}, {"sourcePr": True}, {"sourcePrMap": {VERSION: None}, "sourcePr": 984}):
            with self.subTest(record=record), self.assertRaisesRegex(RiskGateError, "names no source pull request"):
                self.prove({**record, "originalApplyRuns": {VERSION: 555}})


class EndToEndOriginalRunGuardTests(unittest.TestCase):
    def setUp(self):
        # The method name only satisfies TestCase.__init__; that base test is never
        # run. Every test here calls run_historical_prove_preview directly.
        self.fixture = base.ProductionBusinessRiskGateTests(
            "test_original_run_against_the_deleted_preview_is_still_accepted"
        )

    def test_honest_recovery_is_accepted(self):
        self.fixture.run_historical_prove_preview()

    def test_instance_binding_that_is_not_an_object_is_refused(self):
        for instance in ("[]", '"preview"', "42"):
            with self.subTest(instance=instance), self.assertRaisesRegex(RiskGateError, "binding that is not an object"):
                self.fixture.run_historical_prove_preview(original_instance=instance)

    def test_version_absent_or_duplicated_on_exact_main_is_refused_at_the_byte_binding(self):
        real = gate.prove_historical_original_apply_runs
        for case in ("none", "two"):
            def reshape_main_then_prove(**kwargs):
                current = kwargs["repo_root"] / f"supabase/migrations/{VERSION}_release_a.sql"
                if case == "none":
                    current.unlink()
                else:
                    current.with_name(f"{VERSION}_release_b.sql").write_bytes(current.read_bytes())
                return real(**kwargs)

            # prove_preview_migration_contents repeats this cardinality check with the
            # same message, so it must never be reached: the refusal has to come from
            # prove_historical_original_apply_runs itself.
            twin = AssertionError("refusal came from the later content check, not the original-run binding")
            with self.subTest(case=case), \
                 mock.patch.object(gate, "prove_historical_original_apply_runs", side_effect=reshape_main_then_prove) as spy, \
                 mock.patch.object(gate, "prove_preview_migration_contents", side_effect=twin), \
                 self.assertRaisesRegex(RiskGateError, "absent or ambiguous on exact main"):
                self.fixture.run_historical_prove_preview()
            spy.assert_called_once()


if __name__ == "__main__":
    unittest.main()
