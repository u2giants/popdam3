"""`drop schema` applies must be VERIFIED (schema absent), not refused.

Issue popcre/shared-db#6747: production run 43548290525 (PR #6303,
migration 20261114022200, `drop schema if exists dflow_prod_old cascade`)
applied correctly but post-apply verification failed because no catalog
object was derived from `drop schema`. The statement now names a
pg_namespace row that must be ABSENT afterwards. No database.
"""

from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))

from production_catalog_verification import (  # noqa: E402
    build_catalog_sql,
    derive_targets,
    render_report,
)

VERSION = "20261114022200"
REAL_MIGRATION = (
    Path(__file__).resolve().parent.parent
    / "supabase" / "migrations" / "20261114022200_drop_dflow_prod_old.sql"
)


def targets_for(sql: str):
    with tempfile.TemporaryDirectory() as tmp:
        migrations = Path(tmp) / "supabase" / "migrations"
        migrations.mkdir(parents=True)
        path = migrations / f"{VERSION}_test.sql"
        path.write_text(sql, encoding="utf-8")
        return derive_targets({VERSION: path}, [VERSION])


def catalog(rows: list[dict]) -> dict:
    return {"server_version": "17.4", "schemas": rows}


class DropSchemaTest(unittest.TestCase):
    def test_real_migration_is_derived(self):
        targets = derive_targets({VERSION: REAL_MIGRATION}, [VERSION])
        self.assertEqual(targets.dropped_schemas, ["dflow_prod_old"])
        self.assertFalse(targets.is_empty())
        self.assertIn("drop schema", targets.change_types)
        self.assertIn("'dflow_prod_old'", build_catalog_sql(targets))

    def test_spellings(self):
        cases = {
            "drop schema dflow_prod_old;": ["dflow_prod_old"],
            'DROP SCHEMA IF EXISTS "dflow_prod_old" CASCADE;': ["dflow_prod_old"],
            "drop schema a_old, b_old restrict": ["a_old", "b_old"],
        }
        for sql, expected in cases.items():
            with self.subTest(sql=sql):
                self.assertEqual(targets_for(sql).dropped_schemas, expected)

    def test_absent_schema_passes(self):
        markdown, failures = render_report(
            [VERSION], targets_for("drop schema if exists dflow_prod_old cascade;"),
            catalog([{"name": "dflow_prod_old", "exists": False}]), None, [], True,
        )
        self.assertEqual(failures, [])
        self.assertIn("## Dropped schemas (`pg_namespace`)", markdown)

    def test_present_schema_fails(self):
        _, failures = render_report(
            [VERSION], targets_for("drop schema dflow_prod_old cascade;"),
            catalog([{"name": "dflow_prod_old", "exists": True}]), None, [], True,
        )
        self.assertIn(
            "schema dflow_prod_old: must be absent after DROP SCHEMA (pg_namespace)",
            failures,
        )

    def test_missing_probe_row_fails_closed(self):
        _, failures = render_report(
            [VERSION], targets_for("drop schema dflow_prod_old;"), catalog([]),
            None, [], True,
        )
        self.assertIn(
            "schema dflow_prod_old: must be absent after DROP SCHEMA (pg_namespace)",
            failures,
        )

    def test_unparseable_name_is_noted_not_accepted(self):
        targets = targets_for('drop schema "Mixed-Case";')
        self.assertEqual(targets.dropped_schemas, [])
        self.assertTrue(targets.is_empty())
        self.assertTrue(any("DROP SCHEMA was not safely parseable" in n
                            for n in targets.notes))


if __name__ == "__main__":
    unittest.main()
