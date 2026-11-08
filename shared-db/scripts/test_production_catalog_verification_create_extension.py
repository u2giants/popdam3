"""`create extension` applies must be VERIFIED, not refused as "proved nothing".

Issue popcre/shared-db#5874: production run 42147611207 (pg_repack install)
applied correctly but log verification failed because no catalog object was
derived from `create extension`. The statement now names a pg_extension row
that must exist afterwards. No database: pure derivation and reporting.
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

VERSION = "20260810140000"
REPACK_SQL = """
create extension if not exists pg_repack;
revoke all on schema repack from public;
revoke all on all functions in schema repack from public, anon, authenticated;
"""


def targets_for(sql: str):
    with tempfile.TemporaryDirectory() as tmp:
        migrations = Path(tmp) / "supabase" / "migrations"
        migrations.mkdir(parents=True)
        path = migrations / f"{VERSION}_test.sql"
        path.write_text(sql, encoding="utf-8")
        return derive_targets({VERSION: path}, [VERSION])


def catalog(present: bool) -> dict:
    return {
        "server_version": "17.4",
        "extensions": [
            {"name": "pg_repack", "exists": present,
             "version": "1.5.2" if present else None,
             "schema": "public" if present else None}
        ],
    }


class CreateExtensionTest(unittest.TestCase):
    def test_create_extension_is_derived(self):
        targets = targets_for(REPACK_SQL)
        self.assertEqual(targets.extensions, ["pg_repack"])
        self.assertFalse(targets.is_empty())
        self.assertIn("create extension", targets.change_types)

    def test_spellings(self):
        for sql in (
            "create extension pg_repack;",
            'CREATE EXTENSION IF NOT EXISTS "pg_repack" WITH SCHEMA extensions;',
            "create extension pg_repack version '1.5.2' cascade",
        ):
            with self.subTest(sql=sql):
                self.assertEqual(targets_for(sql).extensions, ["pg_repack"])

    def test_installed_extension_passes(self):
        markdown, failures = render_report(
            [VERSION], targets_for(REPACK_SQL), catalog(True), None, [], True
        )
        self.assertEqual(failures, [])
        self.assertIn("## Extensions (`pg_extension`)", markdown)

    def test_missing_extension_fails(self):
        _, failures = render_report(
            [VERSION], targets_for(REPACK_SQL), catalog(False), None, [], True
        )
        self.assertIn("extension pg_repack: must be installed (pg_extension)", failures)

    def test_unparseable_name_is_noted_not_accepted(self):
        targets = targets_for('create extension "uuid-ossp";')
        self.assertEqual(targets.extensions, [])
        self.assertTrue(targets.is_empty())
        self.assertTrue(any("CREATE EXTENSION was not safely parseable" in n for n in targets.notes))

    def test_real_pg_repack_migration_is_verified(self):
        path = Path(__file__).resolve().parents[1] / "supabase" / "migrations" / "20261105201736_install_pg_repack.sql"
        targets = derive_targets({"20261105201736": path}, ["20261105201736"])
        self.assertIn("pg_repack", targets.extensions)

    def test_catalog_query_reads_pg_extension(self):
        self.assertIn("pg_extension", build_catalog_sql(targets_for(REPACK_SQL)))


if __name__ == "__main__":
    unittest.main()
