import copy
import importlib.util
import os
import unittest
from contextlib import contextmanager
from pathlib import Path
from types import SimpleNamespace

spec = importlib.util.spec_from_file_location("proof4060", Path(__file__).with_name("shared-db-4060-observation.py"))
p = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p)


def catalog():
    return {"table_kind": "r", "table_am": "heap", "ledger_heap": True, "inheritance_edges": 0, "table_oid": 100, "profile_oid": 101,
            "index": {"unique": True, "valid": True, "ready": True, "table_oid": 100,
                      "method": "btree", "builtin_method": True, "keys": 1, "attributes": 1,
                      "definition": p.INDEX_DEFINITION, "opclass_exact": True, "collation_exact": True,
                      "options": [0], "storage_options": None, "immediate": True, "primary": False,
                      "exclusion": False, "nulls_not_distinct": False,
                      "expression": "lower(btrim((email)::text))",
                      "predicate": "(NULLIF(btrim((email)::text), ''::text) IS NOT NULL)"},
            "columns": [{"name": n, "type": "integer" if n == "id" else "uuid" if n == "app_profile_id" else "character varying(255)",
                         "not_null": n == "id", "identity": "a" if n == "id" else "", "generated": "", "default": None}
                        for n in sorted(p.EXPECTED_COLUMNS)],
            "insert_triggers": [{"internal": True, "type": 5, "function_schema": "pg_catalog",
                                 "function": "RI_FKey_check_ins", "constraint_type": "f", "constraint_table": 100,
                                 "referenced_table": 101, "key_columns": ["app_profile_id"]}],
            "checks": 0, "unsafe_indexes": 0, "rules": 0, "ledger_present": True, "duplicate_groups": 0}


class Sql(str):
    def format(self, *args):
        return Sql(str(self).format(*args))

    def join(self, values):
        return Sql(str(self).join(map(str, values)))


sql = SimpleNamespace(SQL=Sql, Identifier=lambda n: '"' + n + '"', Placeholder=lambda: "%s")


class Cursor:
    def __init__(self, connection):
        self.c = connection
        self.rows = []

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def execute(self, query, values=None, **kwargs):
        q = str(query)
        self.c.calls.append((q, values))
        self.rows = []
        if q.startswith("SELECT current_user"):
            self.rows = [("postgres", "postgres", "postgres", "off", "8s", "1s")]
        elif q.startswith("SELECT rolbypassrls"):
            self.rows = [(True, False)]
        elif q.startswith("-- Fixed #4060"):
            self.rows = [(self.c.metadata,)]
        elif q == p.LEDGER:
            self.rows = [(self.c.metadata.get("ledger_present", True),)]
        elif q == p.DUPLICATES:
            self.rows = [(self.c.metadata.get("duplicate_groups", 0),)]
        elif q == p.SNAPSHOT:
            self.rows = [self.c.snapshot]
        elif q == p.SEQUENCE:
            self.rows = [self.c.sequence]
        elif q.startswith("SELECT pg_get_serial_sequence"):
            self.rows = [("dflow.users_id_seq",)]
        elif q.startswith("SELECT id, email"):
            self.rows = [(1, "proof@example.test")]
        elif q.startswith("SELECT upper"):
            self.rows = [("PROOF@EXAMPLE.TEST",)]
        elif q.startswith("SELECT lower") or q.startswith("SELECT NOT EXISTS"):
            self.rows = [(True,)]
        elif q.startswith("INSERT"):
            self.c.inserts += 1
            if self.c.error:
                raise self.c.error

    def fetchone(self):
        return self.rows.pop(0) if self.rows else None


class Connection:
    def __init__(self):
        self.autocommit = True
        self.info = SimpleNamespace(transaction_status=0)
        self.metadata = catalog()
        self.snapshot = (52, "a" * 32)
        self.sequence = (1000, True)
        self.error = Exception("NEVER PRINT DATABASE ERROR OR EMAIL")
        self.error.sqlstate = "23505"
        self.error.diag = SimpleNamespace(constraint_name="users_email_lower_uidx")
        self.calls = []
        self.inserts = 0
        self.rollbacks = 0

    @contextmanager
    def transaction(self, *, force_rollback):
        assert force_rollback is True
        self.info.transaction_status = 2
        try:
            yield
        finally:
            self.info.transaction_status = 0
            self.rollbacks += 1

    def cursor(self):
        return Cursor(self)


class ProofTests(unittest.TestCase):
    def test_exact_unique_violation_proves_rollback_without_sequence_consumption(self):
        c = Connection()
        result = p.prove(c, sql)
        self.assertTrue(result["duplicate_rejected"])
        self.assertEqual(c.inserts, 1)
        self.assertEqual(c.rollbacks, 2)
        self.assertEqual(c.info.transaction_status, 0)
        statements = [q for q, _ in c.calls]
        self.assertFalse(any("COMMIT" in q or "DELETE" in q or "nextval" in q or "setval" in q for q in statements))
        insert = next((q, v) for q, v in c.calls if q.startswith("INSERT"))
        self.assertIn("OVERRIDING SYSTEM VALUE", insert[0])
        self.assertIn(-406001, insert[1])
        self.assertLess(statements.index("LOCK TABLE ONLY dflow.users IN SHARE MODE"), statements.index(insert[0]))
        self.assertNotIn("@", str(result))

    def test_every_unsafe_catalog_refuses_before_insert(self):
        changes = [lambda m: m.update(table_kind="f"), lambda m: m.update(rules=1),
                   lambda m: m.update(checks=1), lambda m: m.update(unsafe_indexes=1),
                   lambda m: m.update(inheritance_edges=1), lambda m: m.update(table_am="custom"), lambda m: m.update(ledger_heap=False),
                   lambda m: m["index"].update(unique=False), lambda m: m["index"].update(valid=False),
                   lambda m: m["index"].update(ready=False), lambda m: m["index"].update(table_oid=99),
                   lambda m: m["index"].update(expression="lower(email)"), lambda m: m["index"].update(predicate="true"),
                   lambda m: m["columns"][0].update(default="unsafe_function()"),
                   lambda m: m["columns"][0].update(generated="s"),
                   lambda m: m["columns"][0].update(name="unknown"),
                   lambda m: m["insert_triggers"][0].update(internal=False),
                   lambda m: m["insert_triggers"][0].update(type=7),
                   lambda m: m["insert_triggers"][0].update(function_schema="public"),
                   lambda m: m["insert_triggers"][0].update(function="external_effect"),
                   lambda m: m["insert_triggers"][0].update(referenced_table=99),
                   lambda m: m["insert_triggers"][0].update(key_columns=["email"])]
        for key, value in [("builtin_method", False), ("method", "hash"), ("keys", 2), ("attributes", 2), ("opclass_exact", False),
                           ("collation_exact", False), ("options", [1]), ("storage_options", ["fillfactor=80"]),
                           ("definition", "wrong"), ("immediate", False), ("primary", True),
                           ("exclusion", True), ("nulls_not_distinct", True)]:
            changes.append(lambda m, key=key, value=value: m["index"].update({key: value}))
        for change in changes:
            with self.subTest(change=changes.index(change)):
                c = Connection()
                change(c.metadata)
                with self.assertRaises(p.Refusal):
                    p.prove(c, sql)
                self.assertEqual(c.inserts, 0)
                self.assertNotIn(p.DUPLICATES, [q for q, _ in c.calls])
                self.assertNotIn(p.SNAPSHOT, [q for q, _ in c.calls])
                self.assertEqual(c.rollbacks, 1)

    def test_value_checks_run_only_after_catalog_and_refuse_bad_ledger_duplicates(self):
        for key, value in [("ledger_present", False), ("duplicate_groups", 1)]:
            c = Connection(); c.metadata[key] = value
            with self.assertRaises(p.Refusal): p.prove(c, sql)
            self.assertEqual(c.inserts, 0)
            queries = [q for q, _ in c.calls]
            self.assertLess(next(i for i, q in enumerate(queries) if q.startswith("-- Fixed #4060")), queries.index(p.LEDGER))

    def test_all_target_locks_and_row_reads_are_only_parent(self):
        c = Connection(); p.prove(c, sql)
        for query, _ in c.calls:
            for target in ["dflow.users", "supabase_migrations.schema_migrations"]:
                if query.startswith("LOCK TABLE") and target in query:
                    self.assertIn("LOCK TABLE ONLY " + target, query)
                if "FROM " + target in query:
                    self.fail("inherited row scan")
        self.assertIn("FROM ONLY dflow.users", p.SNAPSHOT)

    def test_wrong_failure_or_success_never_produces_proof(self):
        for code, name in [("23505", "users_pkey"), ("23503", "users_email_lower_uidx"), (None, None)]:
            c = Connection()
            if code:
                c.error.sqlstate, c.error.diag.constraint_name = code, name
            else:
                c.error = None
            with self.assertRaises(p.Refusal):
                p.prove(c, sql)
            self.assertEqual(c.rollbacks, 1)
            self.assertEqual(c.info.transaction_status, 0)
            self.assertIn("ROLLBACK TO SAVEPOINT duplicate_only", [q for q, _ in c.calls])

    def test_changed_rows_or_sequence_refuse(self):
        for changed in ["snapshot", "sequence"]:
            c = Connection()
            original = c.cursor
            count = 0

            def cursor():
                instance = original()
                execute = instance.execute

                def execute_changing(query, values=None, **kwargs):
                    nonlocal count
                    execute(query, values, **kwargs)
                    target = p.SNAPSHOT if changed == "snapshot" else p.SEQUENCE
                    if str(query) == target:
                        count += 1
                        if count > 1:
                            instance.rows = [(53, "b" * 32)] if changed == "snapshot" else [(1001, True)]
                instance.execute = execute_changing
                return instance
            c.cursor = cursor
            with self.assertRaises(p.Refusal):
                p.prove(c, sql)

    def test_context_refuses_unreviewed_branch_and_foreign_repository(self):
        env = {"GITHUB_REPOSITORY": "popcre/shared-db", "GITHUB_REF": "refs/heads/main",
               "GITHUB_EVENT_NAME": "workflow_dispatch",
               "GITHUB_WORKFLOW_REF": "popcre/shared-db/" + p.WORKFLOW + "@refs/heads/main",
               "GITHUB_SHA": "a" * 40, "APPLICATION_COMMIT_SHA": "b" * 40,
               "GITHUB_RUN_ID": "123", "GITHUB_RUN_ATTEMPT": "1"}
        p.context(env)
        for key, value in [("GITHUB_REF", "refs/heads/feature"), ("GITHUB_REPOSITORY", "foreign/shared-db"),
                           ("APPLICATION_COMMIT_SHA", "main"), ("GITHUB_RUN_ID", "01")]:
            bad = copy.deepcopy(env)
            bad[key] = value
            with self.assertRaises(p.Refusal):
                p.context(bad)


@unittest.skipUnless(os.environ.get("PROOF4060_TEST_PORT"), "owned local PostgreSQL service only")
class PostgreSQLTests(unittest.TestCase):
    """Real duplicate-index behavior on the owned CI localhost service, not prod."""
    @classmethod
    def setUpClass(cls):
        import psycopg
        from psycopg import sql as real_sql
        cls.sql = real_sql
        cls.port = int(os.environ["PROOF4060_TEST_PORT"])
        cls.connect = staticmethod(lambda user: psycopg.connect(host="127.0.0.1", port=cls.port,
                                        dbname="postgres", user=user, autocommit=True))
        with cls.connect("proof_admin") as connection, connection.cursor() as cursor:
            cursor.execute("CREATE ROLE postgres LOGIN NOSUPERUSER BYPASSRLS; CREATE SCHEMA dflow AUTHORIZATION postgres; CREATE SCHEMA app AUTHORIZATION postgres; CREATE SCHEMA supabase_migrations AUTHORIZATION postgres; SET ROLE postgres; CREATE TABLE app.profile(id uuid PRIMARY KEY); CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY); INSERT INTO supabase_migrations.schema_migrations VALUES ('20261009064439')")
            columns = []
            for name in sorted(p.EXPECTED_COLUMNS):
                kind = "integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY" if name == "id" else "uuid REFERENCES app.profile(id)" if name == "app_profile_id" else "varchar(255)"
                columns.append(real_sql.SQL("{} " + kind).format(real_sql.Identifier(name)))
            cursor.execute(real_sql.SQL("CREATE TABLE dflow.users ({})").format(real_sql.SQL(",").join(columns)))
            cursor.execute("INSERT INTO dflow.users(id,email) OVERRIDING SYSTEM VALUE VALUES(1,'First@Example.test'),(2,'second@example.test'); CREATE UNIQUE INDEX users_email_lower_uidx ON dflow.users(lower(btrim(email))) WHERE nullif(btrim(email),'') IS NOT NULL")

    def test_exact_after_fk_guard_and_real_unique_violation_leave_users_sequence_unchanged(self):
        with self.connect("postgres") as connection:
            result = p.prove(connection, self.sql)
            self.assertEqual(result["row_count"], 2)
            self.assertTrue(result["duplicate_rejected"])
            self.assertTrue(result["users_unchanged"])
            self.assertTrue(result["sequence_unchanged"])

    def test_real_alternate_opclass_and_storage_options_refuse(self):
        for option in ["text_pattern_ops", "WITH (fillfactor=80)"]:
            with self.connect("proof_admin") as connection, connection.cursor() as cursor:
                cursor.execute("DROP INDEX dflow.users_email_lower_uidx")
                definition = "CREATE UNIQUE INDEX users_email_lower_uidx ON dflow.users(lower(btrim(email)) " + (option if option == "text_pattern_ops" else "") + ") " + (option if option != "text_pattern_ops" else "") + " WHERE nullif(btrim(email), '') IS NOT NULL"
                cursor.execute(definition)
            try:
                with self.connect("postgres") as connection:
                    with self.assertRaises(p.Refusal): p.prove(connection, self.sql)
            finally:
                with self.connect("proof_admin") as connection, connection.cursor() as cursor:
                    cursor.execute("DROP INDEX dflow.users_email_lower_uidx; CREATE UNIQUE INDEX users_email_lower_uidx ON dflow.users(lower(btrim(email))) WHERE nullif(btrim(email), '') IS NOT NULL")

    def test_real_inheritance_edges_refuse_before_row_scans(self):
        for parent in ["dflow.users", "supabase_migrations.schema_migrations"]:
            with self.connect("proof_admin") as connection, connection.cursor() as cursor:
                cursor.execute("CREATE TABLE dflow.probe_child() INHERITS (" + parent + ")")
            try:
                with self.connect("postgres") as connection:
                    with self.assertRaises(p.Refusal): p.prove(connection, self.sql)
            finally:
                with self.connect("proof_admin") as connection, connection.cursor() as cursor:
                    cursor.execute("DROP TABLE dflow.probe_child")

    def test_external_before_trigger_refuses_without_executing(self):
        with self.connect("proof_admin") as connection, connection.cursor() as cursor:
            cursor.execute("CREATE FUNCTION dflow.probe_forbidden() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'external trigger executed'; END$$; CREATE TRIGGER probe_forbidden BEFORE INSERT ON dflow.users FOR EACH ROW EXECUTE FUNCTION dflow.probe_forbidden()")
        try:
            with self.connect("postgres") as connection:
                with self.assertRaises(p.Refusal):
                    p.prove(connection, self.sql)
        finally:
            with self.connect("proof_admin") as connection, connection.cursor() as cursor:
                cursor.execute("DROP TRIGGER probe_forbidden ON dflow.users; DROP FUNCTION dflow.probe_forbidden()")


if __name__ == "__main__":
    unittest.main()
