"""Falsification tests for preview migration-content evidence (issue #2364).

PR #2354's guard mutation sweep found these refusal guards in
``prove_preview_migration_contents`` could be replaced with ``False`` while
the offline suite stayed green. Each test starts from proof the gate ACCEPTS
and breaks exactly the fact the guard protects.
"""
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from production_business_risk_gate import RiskGateError, canonical_sha256, prove_preview_migration_contents

VERSION = "20260816110750"


class Fixture:
    def __init__(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        (self.root / "supabase/migrations").mkdir(parents=True)
        (self.root / "config").mkdir()
        self.file = self.root / f"supabase/migrations/{VERSION}_safe_forward.sql"
        self.file.write_text("lock table plm.bridge in share mode;\n", encoding="utf-8")
        self.digest = canonical_sha256(self.file)

    def policy(self, entry):
        (self.root / "config/atomic-migration-allowlist.json").write_text(
            json.dumps({"schema_version": 1, "migrations": {VERSION: entry}}), encoding="utf-8")

    def atomic_texts(self, sha, count="8", apply_suffix=None):
        preflight = f"ATOMIC PREFLIGHT OK: target=preview version={VERSION} sha256={sha} statements={count}"
        applied = apply_suffix or f"ATOMIC APPLY OK: target=preview version={VERSION} ledger_row=1 statements={count}"
        return {
            "preview-dry-run.txt": preflight + "\n",
            "preview-apply.txt": preflight + "\n" + applied + "\n",
            "migration-content-manifest.json": json.dumps({VERSION: sha}),
        }


class HistoricalPreviewContentGuardTests(unittest.TestCase):
    def setUp(self):
        self.fx = Fixture()
        self.addCleanup(self.fx.temp.cleanup)
        name = self.fx.file.name
        self.texts = {"preview-dry-run.txt": f"apply {name}\n", "preview-apply.txt": f"applied {name}\n"}

    def prove(self, texts=None, before=None, after=None):
        prove_preview_migration_contents(
            texts=texts or self.texts, allowlist=[VERSION], repo_root=self.fx.root,
            before_versions={VERSION} if before is None else before,
            after_versions={VERSION} if after is None else after, historical=True,
        )

    def test_stable_historical_proof_is_accepted(self):
        self.prove()

    def test_ambiguous_migration_file_is_refused(self):
        (self.fx.root / f"supabase/migrations/{VERSION}_other.sql").write_text("select 1;\n", encoding="utf-8")
        texts = {key: value + f"{VERSION}_other.sql\n" for key, value in self.texts.items()}
        with self.assertRaisesRegex(RiskGateError, f"allowlisted migration {VERSION} is absent or ambiguous"):
            self.prove(texts)

    def test_proof_that_does_not_name_the_exact_file_is_refused(self):
        for missing in ("preview-dry-run.txt", "preview-apply.txt"):
            with self.subTest(missing=missing), self.assertRaisesRegex(RiskGateError, "does not name exact migration"):
                self.prove({**self.texts, missing: "applied something else\n"})

    def test_version_absent_from_the_stable_ledger_is_refused(self):
        with self.assertRaisesRegex(RiskGateError, "does not prove stable prior application"):
            self.prove(before={"20260101000000"}, after={"20260101000000"})

    def test_ledger_that_moved_during_a_no_write_proof_is_refused(self):
        with self.assertRaisesRegex(RiskGateError, "ledger changed during a no-write proof"):
            self.prove(after={VERSION, "20260101000000"})


class AtomicPreviewContentGuardTests(unittest.TestCase):
    def setUp(self):
        self.fx = Fixture()
        self.addCleanup(self.fx.temp.cleanup)

    def prove(self, texts, allowlist=(VERSION,), after_extra=()):
        prove_preview_migration_contents(
            texts=texts, allowlist=list(allowlist), repo_root=self.fx.root,
            before_versions={"old"}, after_versions={"old", *allowlist, *after_extra}, historical=False,
        )

    def test_exact_atomic_proof_is_accepted(self):
        self.fx.policy({"sha256": self.fx.digest, "targets": ["preview", "production"]})
        self.prove(self.fx.atomic_texts(self.fx.digest))

    def test_atomic_proof_bundled_with_another_migration_is_refused(self):
        self.fx.policy({"sha256": self.fx.digest, "targets": ["preview"]})
        other = "20260816110751"
        other_file = self.fx.root / f"supabase/migrations/{other}_plain.sql"
        other_file.write_text("select 1;\n", encoding="utf-8")
        texts = self.fx.atomic_texts(self.fx.digest)
        with self.assertRaisesRegex(RiskGateError, "must contain exactly one allowlisted migration"):
            self.prove(texts, allowlist=(VERSION, other))

    def test_policy_that_does_not_authorize_preview_is_refused(self):
        for entry in ({"sha256": self.fx.digest, "targets": ["production"]}, {"sha256": self.fx.digest}):
            self.fx.policy(entry)
            with self.subTest(entry=entry), self.assertRaisesRegex(RiskGateError, "does not authorize preview"):
                self.prove(self.fx.atomic_texts(self.fx.digest))
        self.fx.policy([self.fx.digest, "preview"])
        with self.assertRaisesRegex(RiskGateError, "does not authorize preview"):
            self.prove(self.fx.atomic_texts(self.fx.digest))

    def test_policy_hash_that_is_not_sha256_is_refused(self):
        for bad in ("", self.fx.digest.upper(), self.fx.digest[:-1]):
            self.fx.policy({"sha256": bad, "targets": ["preview"]})
            with self.subTest(bad=bad), self.assertRaisesRegex(RiskGateError, "atomic policy SHA-256 is invalid"):
                self.prove(self.fx.atomic_texts(bad))

    def test_policy_hash_that_does_not_match_the_file_is_refused(self):
        forged = "0" * 64
        self.fx.policy({"sha256": forged, "targets": ["preview"]})
        with self.assertRaisesRegex(RiskGateError, "does not match exact migration content"):
            self.prove(self.fx.atomic_texts(forged))

    def test_statement_count_must_be_a_positive_integer(self):
        self.fx.policy({"sha256": self.fx.digest, "targets": ["preview"]})
        for count in ("0", "08", "-1", "x"):
            with self.subTest(count=count), self.assertRaisesRegex(RiskGateError, "statement count is invalid"):
                self.prove(self.fx.atomic_texts(self.fx.digest, count=count))

    def test_apply_line_must_be_the_exact_expected_line(self):
        self.fx.policy({"sha256": self.fx.digest, "targets": ["preview"]})
        forged = f"ATOMIC APPLY OK: target=preview version={VERSION} ledger_row=0 statements=8"
        with self.assertRaisesRegex(RiskGateError, "atomic preview apply proof is incomplete or forged"):
            self.prove(self.fx.atomic_texts(self.fx.digest, apply_suffix=forged))


if __name__ == "__main__":
    unittest.main()
