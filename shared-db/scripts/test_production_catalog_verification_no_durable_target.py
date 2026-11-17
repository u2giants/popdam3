"""Dynamic-SQL migrations with reviewed `no_durable_target` sidecars (#6571).

Production runs 44103933198 and 44106460484 applied correctly but went red at
post-apply catalog verification: the migrations name objects only through
`execute format(...)`, so the lexer derives nothing, and their hash-bound
sidecars already record every marker as `no_durable_target`. These tests pin
that such a batch passes, that a missing sidecar still fails, and that a mixed
batch still verifies the objects the lexer can read. No database.
"""

from pathlib import Path
import hashlib
import json
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))

from production_catalog_verification import (  # noqa: E402
    BEHAVIOR_SIDECAR_DIR,
    derive_targets,
    load_behavior_sidecars,
    render_report,
    reviewed_no_durable_target_versions,
)

DYNAMIC = "20261201000001"
DYNAMIC_SQL = (
    "do $$\n"
    "begin\n"
    "  execute format('drop table if exists %I.%I', 'tmp', 'scratch');\n"
    "end $$;\n"
)
VISIBLE = "20261201000002"
VISIBLE_SQL = "create table public.no_durable_visible (id int);\n"


def _sidecar(sql: str, version: str, disposition: str = "no_durable_target") -> dict:
    return {
        "schema_version": 1,
        "migration_version": version,
        "migration_sha256": hashlib.sha256(sql.encode()).hexdigest(),
        "marker_schema_version": 1,
        "marker_reviews": [
            {
                "line_start": 1,
                "line_end": 4,
                "disposition": disposition,
                "reason": "The dynamic statement drops a scratch table only; nothing durable remains.",
            }
        ],
        "checks": [],
    }


class NoDurableTargetTests(unittest.TestCase):
    def run_batch(self, files: dict[str, str], sidecars: dict[str, dict], catalog=None):
        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp)
            mig_dir = repo / "supabase" / "migrations"
            mig_dir.mkdir(parents=True)
            (repo / BEHAVIOR_SIDECAR_DIR).mkdir(parents=True)
            migrations = {}
            for version, sql in files.items():
                path = mig_dir / f"{version}_t.sql"
                path.write_text(sql, encoding="utf-8")
                migrations[version] = path
            for version, data in sidecars.items():
                (repo / BEHAVIOR_SIDECAR_DIR / f"{version}.json").write_text(
                    json.dumps(data), encoding="utf-8"
                )
            allowlist = sorted(files)
            targets = derive_targets(migrations, allowlist)
            checks = load_behavior_sidecars(repo, migrations, allowlist)
            reviewed = reviewed_no_durable_target_versions(repo, migrations, allowlist)
            return targets, render_report(
                allowlist, targets, catalog, None, [], True,
                behavior_checks=checks, reviewed_no_durable=reviewed,
            )

    def test_all_dynamic_batch_with_sidecars_passes(self):
        targets, (markdown, failures) = self.run_batch(
            {DYNAMIC: DYNAMIC_SQL}, {DYNAMIC: _sidecar(DYNAMIC_SQL, DYNAMIC)}
        )
        self.assertTrue(targets.is_empty())
        self.assertEqual(failures, [])
        self.assertIn("no durable target", markdown)

    def test_missing_sidecar_still_fails(self):
        _, (_, failures) = self.run_batch({DYNAMIC: DYNAMIC_SQL}, {})
        self.assertTrue(any("NO catalog object" in f for f in failures))

    def test_second_unreviewed_dynamic_file_still_fails(self):
        other = "20261201000003"
        _, (_, failures) = self.run_batch(
            {DYNAMIC: DYNAMIC_SQL, other: DYNAMIC_SQL},
            {DYNAMIC: _sidecar(DYNAMIC_SQL, DYNAMIC)},
        )
        self.assertTrue(any("NO catalog object" in f for f in failures))

    def test_mixed_batch_still_verifies_visible_objects(self):
        targets, (_, failures) = self.run_batch(
            {DYNAMIC: DYNAMIC_SQL, VISIBLE: VISIBLE_SQL},
            {DYNAMIC: _sidecar(DYNAMIC_SQL, DYNAMIC)},
            catalog={"relations": [{"name": "public.no_durable_visible", "to_regclass": None}]},
        )
        self.assertFalse(targets.is_empty())
        self.assertTrue(failures, "missing visible table must still fail")
        self.assertTrue(any("no_durable_visible" in f for f in failures))


if __name__ == "__main__":
    unittest.main()
