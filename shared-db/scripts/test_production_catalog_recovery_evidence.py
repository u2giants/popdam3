import copy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from scripts.production_catalog_recovery_evidence import build_binding, validate_jobs

VERSION = "20261007002113"


def jobs():
    names = ("Build bounded checkout", "Fresh dry-run, then apply", "Capture production migration record (after)", "Save apply evidence", "Release the exclusive production lane with ownership proof")
    return {"jobs": [{"name": n, "conclusion": "success"} for n in ("SQL migration guards", "Production apply review (immutable evidence + hard guards)")] + [{"name": "Production apply (automatic evidence gates)", "conclusion": "failure", "steps": [{"name": n, "conclusion": "success"} for n in names] + [{"name": "Post-apply catalog verification", "conclusion": "failure"}]}]}


class RecoveryEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.evidence = self.root / "apply"
        self.evidence.mkdir()
        migrations = self.root / "supabase/migrations"
        migrations.mkdir(parents=True)
        (migrations / (VERSION + "_test.sql")).write_text("select 1;\n")
        self.digest = hashlib.sha256(b"select 1;\n").hexdigest()
        (self.evidence / "production-apply.txt").write_text("applied")
        (self.evidence / "production-ledger-before.txt").write_text(" | 20260101000000 |\n")
        (self.evidence / "production-ledger-after.txt").write_text(" | 20260101000000 |\n | " + VERSION + " |\n")
        (self.evidence / "migration-content-manifest.json").write_text(json.dumps({VERSION: self.digest}))
        self.live = self.root / "live.txt"
        self.live.write_text((self.evidence / "production-ledger-after.txt").read_text())
        self.catalog = {"enforcing": True, "errors": [], "allowlist": [VERSION], "behavior_checks": [{"id": "exact", "kind": "catalog_contract", "contract": "exact_contract", "migration_version": VERSION, "migration_sha256": self.digest, "expected_count": 1}], "behavior_results": {"behavior_checks": [{"id": "exact", "actual_count": 1, "expected_count": 1}]}}
        self.inputs = {"allowlist": [VERSION], "main_sha": "b" * 40, "apply_main_sha": "a" * 40, "apply_run_id": 1, "apply_artifact_id": 2, "apply_artifact_digest": "sha256:" + "c" * 64}

    def build(self, catalog=None, job_rows=None):
        return build_binding(self.root, self.evidence, self.live, catalog or self.catalog, job_rows or jobs(), self.inputs)

    def test_exact_successful_recovery(self):
        self.assertEqual(self.build()["migration_hashes"], {VERSION: self.digest})

    def test_apply_failure_and_missing_guard_are_refused(self):
        for name in ("Fresh dry-run, then apply", "Build bounded checkout", "Save apply evidence"):
            rows = jobs()
            rows["jobs"][-1]["steps"][next(i for i, s in enumerate(rows["jobs"][-1]["steps"]) if s["name"] == name)]["conclusion"] = "failure"
            with self.subTest(name=name), self.assertRaises(ValueError): self.build(job_rows=rows)
        rows = jobs(); rows["jobs"][0]["conclusion"] = "skipped"
        with self.assertRaises(ValueError): validate_jobs(rows)

    def test_abnormal_extra_step_refused(self):
        for conclusion in ("cancelled", "timed_out", "neutral", None):
            rows = jobs(); rows["jobs"][-1]["steps"].append({"name": "unexpected", "conclusion": conclusion})
            with self.subTest(conclusion=conclusion), self.assertRaises(ValueError): validate_jobs(rows)

    def test_extra_or_removed_ledger_and_missing_live_version_refused(self):
        for path, text in ((self.evidence / "production-ledger-after.txt", " | " + VERSION + " |\n"), (self.evidence / "production-ledger-after.txt", self.live.read_text() + " | 20261007003000 |\n"), (self.live, " | 20260101000000 |\n")):
            old = path.read_text(); path.write_text(text)
            with self.subTest(text=text), self.assertRaises(ValueError): self.build()
            path.write_text(old)

    def test_changed_sql_and_duplicate_manifest_refused(self):
        path = next((self.root / "supabase/migrations").glob("*.sql"))
        path.write_text("select 2;\n")
        with self.assertRaises(ValueError): self.build()
        path.write_text("select 1;\n")
        nested = self.evidence / "nested"; nested.mkdir(); (nested / "migration-content-manifest.json").write_text("{}")
        with self.assertRaises(ValueError): self.build()

    def test_unenforced_wrong_hash_failed_or_missing_contract_refused(self):
        for field, value in (("enforcing", False), ("errors", ["failed"]), ("allowlist", []), ("behavior_checks", [])):
            row = copy.deepcopy(self.catalog); row[field] = value
            with self.subTest(field=field), self.assertRaises(ValueError): self.build(catalog=row)
        for field, value in (("migration_sha256", "0" * 64), ("expected_count", 0)):
            row = copy.deepcopy(self.catalog); row["behavior_checks"][0][field] = value
            with self.subTest(field=field), self.assertRaises(ValueError): self.build(catalog=row)
        row = copy.deepcopy(self.catalog); row["behavior_results"]["behavior_checks"][0]["actual_count"] = 0
        with self.assertRaises(ValueError): self.build(catalog=row)


if __name__ == "__main__": unittest.main()
