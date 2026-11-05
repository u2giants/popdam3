"""Issue #5751: static guards and opt-in disposable PostgreSQL rehearsal.

Set MERCHGROUP_DROP_TEST_CONTAINER to an expendable PostgreSQL Docker container
to run the effect branches. Never accepts a production connection URL.
"""
import os
from pathlib import Path
import re
import subprocess
import unittest


MIGRATION = Path(__file__).resolve().parents[1] / "supabase/migrations/20261105193957_drop_dflow_prod_merchgroup_04112026_backup.sql"
SQL = MIGRATION.read_text(encoding="utf-8")
TARGET = 'dflow_prod."merchGroup_04112026"'
CONTAINER = os.environ.get("MERCHGROUP_DROP_TEST_CONTAINER")


class StaticGuards(unittest.TestCase):
    def test_exact_target_and_restrict(self):
        drops = re.findall(r"^\s*DROP TABLE (.*?);", SQL, re.MULTILINE)
        self.assertEqual(drops, [TARGET + " RESTRICT"])
        self.assertIn(f"to_regclass('{TARGET}') IS NULL", SQL)
        self.assertLess(SQL.index("RETURN;"), SQL.index("::regclass"))

    def test_postcondition_after_drop(self):
        drop = SQL.index(f"DROP TABLE {TARGET} RESTRICT;")
        check = SQL.index(f"to_regclass('{TARGET}') IS NOT NULL")
        self.assertLess(drop, check)
        self.assertIn("RAISE EXCEPTION", SQL[check:SQL.index("END\n$drop_backup$")])

    def test_ownership_checked_before_drop(self):
        guard = SQL.index("pg_has_role(c.relowner, 'USAGE')")
        self.assertIn("pg_has_role(n.nspowner, 'USAGE')", SQL)
        self.assertLess(guard, SQL.index(f"DROP TABLE {TARGET}"))
        self.assertIn("RAISE EXCEPTION '5748: applying role", SQL)


@unittest.skipUnless(CONTAINER, "requires an explicitly designated disposable PostgreSQL container")
class PostgresRehearsal(unittest.TestCase):
    def query(self, sql, error=None):
        result = subprocess.run(
            ["docker", "exec", "-i", CONTAINER, "psql", "-U", "postgres",
             "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1"],
            input=sql, text=True, capture_output=True, timeout=30,
        )
        if error is None:
            self.assertEqual(result.returncode, 0, result.stderr)
        else:
            self.assertNotEqual(result.returncode, 0)
            self.assertIn(error, result.stderr)
        return result.stdout.strip()

    def setUp(self):
        # This schema reset is allowed only in the opt-in expendable container.
        self.query('DROP SCHEMA IF EXISTS dflow_prod CASCADE; CREATE SCHEMA dflow_prod;'
                   'CREATE TABLE dflow_prod."merchGroup"(id int PRIMARY KEY);'
                   'INSERT INTO dflow_prod."merchGroup" VALUES (99);')

    def tearDown(self):
        self.query('DROP SCHEMA dflow_prod CASCADE;')

    def create_backup(self):
        self.query(f'CREATE TABLE {TARGET}(id int PRIMARY KEY); INSERT INTO {TARGET} VALUES (1);')

    def test_present_drops_only_backup(self):
        self.create_backup()
        self.query(SQL)
        self.assertEqual(self.query(f"SELECT to_regclass('{TARGET}') IS NULL;"), "t")
        self.assertEqual(self.query('SELECT id FROM dflow_prod."merchGroup";'), "99")

    def test_absent_and_repeated_apply_are_noops(self):
        self.query(SQL)
        self.create_backup()
        self.query(SQL)
        self.query(SQL)
        self.assertEqual(self.query('SELECT id FROM dflow_prod."merchGroup";'), "99")

    def test_inbound_fk_refuses_and_preserves_rows(self):
        self.create_backup()
        self.query(f'CREATE TABLE dflow_prod.child(id int REFERENCES {TARGET}(id));'
                   'INSERT INTO dflow_prod.child VALUES (1);')
        self.query(SQL, "foreign keys still reference the backup table")
        self.assertEqual(self.query(f'SELECT id FROM {TARGET};'), "1")
        self.assertEqual(self.query('SELECT id FROM dflow_prod.child;'), "1")

    def test_dependent_view_refuses_without_cascade(self):
        self.create_backup()
        self.query(f'CREATE VIEW dflow_prod.backup_view AS SELECT * FROM {TARGET};')
        self.query(SQL, "depend on it")
        self.assertEqual(self.query('SELECT id FROM dflow_prod.backup_view;'), "1")

    def test_nonowner_refuses_and_preserves_backup(self):
        self.create_backup()
        # Built-in nonowner role, without creating or changing any role grants.
        self.query('GRANT USAGE ON SCHEMA dflow_prod TO pg_read_all_data;')
        self.query('SET ROLE pg_read_all_data;\n' + SQL, "does not own the backup table or its schema")
        self.assertEqual(self.query(f'SELECT id FROM {TARGET};'), "1")


if __name__ == "__main__":
    unittest.main()
