"""Tests for fail-closed idempotent apply-attempt recovery (issue #3397)."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from apply_attempt_recovery import (  # noqa: E402
    ApplyRecoveryError,
    RecoveryClaim,
    ApplyAttemptEvidence,
    evaluate_recovery,
    recover_apply_attempt,
    stable_claim_digest,
    strip_observation_metadata,
)


def _claim(**overrides):
    base = dict(
        source="f" * 40,
        migration_hashes=(("20260920000001", "a" * 64), ("20260920000002", "b" * 64)),
        target="preview",
        baseline_sha="c" * 64,
        producer="trusted-producer",
        expected_catalog_sha256="d" * 64,
    )
    base.update(overrides)
    return RecoveryClaim(**base)


class TestStableClaim(unittest.TestCase):
    def test_observation_metadata_is_stripped(self):
        payload = {
            "source": "x",
            "observed_at": "2026-09-23T00:00:00Z",
            "run_id": 12345,
            "target": "preview",
        }
        stable = strip_observation_metadata(payload)
        self.assertEqual(stable, {"source": "x", "target": "preview"})

    def test_digest_ignores_observation_fields(self):
        a = {"source": "x", "target": "y", "observed_at": "1"}
        b = {"source": "x", "target": "y", "observed_at": "2", "run_id": 99}
        self.assertEqual(stable_claim_digest(a), stable_claim_digest(b))

    def test_digest_changes_with_stable_fields(self):
        a = {"source": "x", "target": "y"}
        b = {"source": "x", "target": "z"}
        self.assertNotEqual(stable_claim_digest(a), stable_claim_digest(b))


class TestRecoveryClaim(unittest.TestCase):
    def test_requires_exact_shas(self):
        with self.assertRaises(ApplyRecoveryError):
            _claim(baseline_sha="nope")
        with self.assertRaises(ApplyRecoveryError):
            _claim(migration_hashes=(("20260920000001", "short"),))

    def test_refuses_duplicate_migration_version(self):
        with self.assertRaisesRegex(ApplyRecoveryError, "duplicate version"):
            _claim(migration_hashes=(("20260920000001", "a" * 64), ("20260920000001", "b" * 64)))

    def test_requires_at_least_one_migration(self):
        with self.assertRaises(ApplyRecoveryError):
            _claim(migration_hashes=())

    def test_claim_digest_is_stable(self):
        c1 = _claim()
        c2 = _claim()
        self.assertEqual(c1.claim_digest, c2.claim_digest)
        self.assertEqual(len(c1.claim_digest), 64)


class TestEvaluateRecovery(unittest.TestCase):
    def _evidence(self, **overrides):
        claim = overrides.pop("claim", _claim())
        base = dict(
            ledger_rows=({"version": "20260920000001", "sha256": "a" * 64}, {"version": "20260920000002", "sha256": "b" * 64}),
            catalog_result={"passed": True, "target": "preview", "baseline_sha256": "c" * 64,
                            "catalog_sha256": "d" * 64},
            prepared_write_status="landed",
            exclusive_lock_held=True,
            qualification={k: claim.as_dict()[k] for k in
                           ("source", "migration_hashes", "target", "baseline_sha", "producer", "expected_catalog_sha256")},
        )
        base.update(overrides)
        return ApplyAttemptEvidence(**base)

    def test_refuses_without_lock(self):
        with self.assertRaises(ApplyRecoveryError) as ctx:
            evaluate_recovery(_claim(), self._evidence(exclusive_lock_held=False))
        self.assertIn("exclusive lock", str(ctx.exception))

    def test_ambiguous_prepared_write_never_authorizes(self):
        with self.assertRaises(ApplyRecoveryError) as ctx:
            evaluate_recovery(_claim(), self._evidence(prepared_write_status="ambiguous"))
        self.assertIn("ambiguous", str(ctx.exception))

    def test_unknown_prepared_write_refused(self):
        with self.assertRaises(ApplyRecoveryError):
            evaluate_recovery(_claim(), self._evidence(prepared_write_status="maybe"))

    def test_absent_is_not_applied_and_does_not_authorize_reapply(self):
        result = evaluate_recovery(_claim(), self._evidence(prepared_write_status="absent", ledger_rows=(), catalog_result=None))
        self.assertEqual(result["disposition"], "not-applied")
        self.assertFalse(result["authorizes_reapply"])

    def test_absent_with_ledger_or_catalog_proof_refused(self):
        for patch in ({"ledger_rows": self._evidence().ledger_rows, "catalog_result": None},
                      {"ledger_rows": (), "catalog_result": self._evidence().catalog_result}):
            with self.subTest(patch=patch), self.assertRaisesRegex(ApplyRecoveryError, "absent but ledger or catalog"):
                evaluate_recovery(_claim(), self._evidence(prepared_write_status="absent", **patch))

    def test_missing_ledger_content_refused(self):
        evidence = self._evidence(
            ledger_rows=({"version": "20260920000001", "sha256": "a" * 64},),
        )
        with self.assertRaises(ApplyRecoveryError) as ctx:
            evaluate_recovery(_claim(), evidence)
        self.assertIn("missing claimed migration", str(ctx.exception))

    def test_catalog_failure_refused(self):
        with self.assertRaises(ApplyRecoveryError):
            evaluate_recovery(_claim(), self._evidence(catalog_result={"passed": False}))
        with self.assertRaises(ApplyRecoveryError):
            evaluate_recovery(_claim(), self._evidence(catalog_result=None))

    def test_catalog_target_baseline_and_digest_are_bound(self):
        for patch in ({"target": "production"}, {"baseline_sha256": "e" * 64},
                      {"catalog_sha256": "bad"}, {"catalog_sha256": "e" * 64}):
            with self.subTest(patch=patch), self.assertRaises(ApplyRecoveryError):
                evaluate_recovery(_claim(), self._evidence(catalog_result={**self._evidence().catalog_result, **patch}))

    def test_happy_path_recovered_without_reapply(self):
        result = evaluate_recovery(_claim(), self._evidence())
        self.assertEqual(result["disposition"], "recovered")
        self.assertFalse(result["authorizes_reapply"])
        self.assertIn("verification_digest", result)

    def test_ledger_content_mismatch_refused(self):
        evidence = self._evidence(
            ledger_rows=({"version": "20260920000001", "sha256": "d" * 64},
                         {"version": "20260920000002", "sha256": "b" * 64}),
        )
        with self.assertRaisesRegex(ApplyRecoveryError, "content hash differs"):
            evaluate_recovery(_claim(), evidence)

    def test_extra_ledger_migration_refused(self):
        rows = self._evidence().ledger_rows + ({"version": "20260920000003", "sha256": "e" * 64},)
        with self.assertRaisesRegex(ApplyRecoveryError, "extra migration"):
            evaluate_recovery(_claim(), self._evidence(ledger_rows=rows))

    def test_untrusted_source_or_producer_refused(self):
        for field in ("source", "producer"):
            claim = _claim(**{field: ("e" * 40 if field == "source" else "another-producer")})
            with self.subTest(field=field), self.assertRaisesRegex(ApplyRecoveryError, "qualification differs"):
                evaluate_recovery(claim, self._evidence())

    def test_migration_order_and_uppercase_digests_refused(self):
        with self.assertRaisesRegex(ApplyRecoveryError, "ascending version order"):
            _claim(migration_hashes=(("20260920000002", "b" * 64), ("20260920000001", "a" * 64)))
        with self.assertRaisesRegex(ApplyRecoveryError, "sha256"):
            _claim(expected_catalog_sha256="D" * 64)

    def test_unhashed_ledger_content_refused(self):
        evidence = self._evidence(ledger_rows=({"version": "20260920000001", "hash": "a" * 64},))
        with self.assertRaisesRegex(ApplyRecoveryError, "sha256"):
            evaluate_recovery(_claim(), evidence)


class TestTrustedAdapters(unittest.TestCase):
    def test_callers_supply_adapters_not_assertions(self):
        result = recover_apply_attempt(
            source="f" * 40,
            migration_hashes=(("20260920000001", "a" * 64),),
            target="preview",
            baseline_sha="b" * 64,
            producer="p",
            expected_catalog_sha256="d" * 64,
            read_qualification=lambda: {"source": "f" * 40,
                                        "migration_hashes": [["20260920000001", "a" * 64]],
                                        "target": "preview", "baseline_sha": "b" * 64,
                                        "producer": "p", "expected_catalog_sha256": "d" * 64},
            read_ledger=lambda: ({"version": "20260920000001", "sha256": "a" * 64},),
            read_catalog=lambda: {"passed": True, "target": "preview", "baseline_sha256": "b" * 64,
                                  "catalog_sha256": "d" * 64},
            read_prepared_write=lambda: "landed",
            lock_is_held=lambda: True,
            read_lock_owner=lambda: "e" * 40,
        )
        self.assertEqual(result["disposition"], "recovered")

    def test_rejects_non_callable_adapters(self):
        with self.assertRaises(ApplyRecoveryError):
            recover_apply_attempt(
                source="f" * 40,
                migration_hashes=(("20260920000001", "a" * 64),),
                target="preview",
                baseline_sha="b" * 64,
                producer="p",
                expected_catalog_sha256="d" * 64,
                read_qualification=lambda: {},
                read_ledger=None,
                read_catalog=lambda: {"passed": True},
                read_prepared_write=lambda: "landed",
                lock_is_held=lambda: True,
                read_lock_owner=lambda: "e" * 40,
            )

    def test_refuses_before_adapter_reads_without_lock(self):
        calls = []
        with self.assertRaisesRegex(ApplyRecoveryError, "before reads"):
            recover_apply_attempt(
                source="f" * 40,
                migration_hashes=(("20260920000001", "a" * 64),),
                target="preview", baseline_sha="b" * 64, producer="p",
                expected_catalog_sha256="d" * 64,
                read_qualification=lambda: calls.append("qualification"),
                read_ledger=lambda: calls.append("ledger"),
                read_catalog=lambda: calls.append("catalog"),
                read_prepared_write=lambda: calls.append("prepared"),
                lock_is_held=lambda: False,
                read_lock_owner=lambda: calls.append("owner"),
            )
        self.assertEqual(calls, [])

    def test_refuses_lock_loss_or_owner_change_after_reads(self):
        for statuses, owners, expected in ((iter((True, False)), iter(("e" * 40, "e" * 40)), "lost"),
                                           (iter((True, True)), iter(("e" * 40, "f" * 40)), "owner changed")):
            with self.subTest(expected=expected), self.assertRaisesRegex(ApplyRecoveryError, expected):
                recover_apply_attempt(
                    source="f" * 40, migration_hashes=(("20260920000001", "a" * 64),),
                    target="preview", baseline_sha="b" * 64, producer="p",
                    expected_catalog_sha256="d" * 64,
                    read_qualification=lambda: {}, read_ledger=lambda: (), read_catalog=lambda: None,
                    read_prepared_write=lambda: "absent", lock_is_held=lambda: next(statuses),
                    read_lock_owner=lambda: next(owners),
                )


if __name__ == "__main__":
    unittest.main()
