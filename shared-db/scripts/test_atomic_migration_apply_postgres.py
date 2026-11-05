"""Disposable PostgreSQL proofs for the exceptional atomic migration path."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import atomic_migration_apply as atomic


@unittest.skipUnless(os.environ.get("ATOMIC_MIGRATION_POSTGRES_TEST") == "1", "disposable PostgreSQL only")
class AtomicMigrationPostgresTests(unittest.TestCase):
    def psql(self, sql, ok=True):
        result = subprocess.run(["psql", "-X", "-v", "ON_ERROR_STOP=1", "-At"], input=sql, text=True, capture_output=True)
        self.assertEqual(result.returncode == 0, ok, result.stderr)
        return result

    def setUp(self):
        self.psql("drop schema if exists atomic_test cascade; create schema atomic_test; create schema if not exists supabase_migrations; create table if not exists supabase_migrations.schema_migrations(version varchar primary key, statements text[], name text); delete from supabase_migrations.schema_migrations where version like '299902%';")

    def connection_url(self):
        host = os.environ.get("PGHOST", "127.0.0.1")
        port = os.environ.get("PGPORT", "5432")
        user = os.environ.get("PGUSER", "postgres")
        database = os.environ.get("PGDATABASE", "postgres")
        return f"postgresql://{user}@{host}:{port}/{database}"

    def run_main(self, version, sql, strip_outer_transaction=False):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            migration = root / f"{version}_main_path.sql"
            migration.write_text(sql, encoding="utf-8")
            policy = root / "policy.json"
            entry = {
                "sha256": hashlib.sha256(migration.read_bytes()).hexdigest(),
                "targets": ["preview"],
            }
            if strip_outer_transaction:
                entry["strip_outer_transaction"] = True
            policy.write_text(json.dumps({
                "schema_version": 1,
                "migrations": {version: entry},
            }), encoding="utf-8")
            argv = [
                "atomic_migration_apply.py", "--migrations-dir", str(root),
                "--linked-dir", str(root), "--version", version,
                "--target", "preview", "--expected-project-ref", "local-preview",
                "--mode", "apply",
            ]
            with patch.object(atomic, "POLICY", policy), patch.object(
                atomic, "linked_connection", return_value=(self.connection_url(), os.environ.copy())
            ), patch.object(sys, "argv", argv):
                return atomic.main()

    def run_batch(self, bodies, mode="apply", tamper=False):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            entries = {}
            for version, sql in bodies.items():
                path = root / f"{version}_batch.sql"
                path.write_text(sql)
                entries[version] = {"sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                                    "targets": ["preview"], "batch_group": "test-batch"}
            policy = root / "policy.json"
            policy.write_text(json.dumps({"schema_version": 1, "migrations": entries}))
            if tamper:
                path.write_text(path.read_text() + "\nselect 9;")
            argv = ["atomic", "--migrations-dir", str(root), "--linked-dir", str(root),
                    "--versions", ",".join(bodies), "--target", "preview",
                    "--expected-project-ref", "local-preview", "--mode", mode]
            with patch.object(atomic, "POLICY", policy), patch.object(
                atomic, "linked_connection", return_value=(self.connection_url(), os.environ.copy())
            ), patch.object(sys, "argv", argv):
                return atomic.main()

    def test_batch_preflights_later_hash_and_transaction_controls_before_any_write(self):
        for suffix, body, tamper in [("11", "select 1;", True), ("12", "commit;", False)]:
            first = "299902010002" + suffix
            second = "299902010003" + suffix
            self.assertEqual(self.run_batch({first: "create table atomic_test.preflight_never_writes(id int);", second: body}, tamper=tamper), 2)
            self.assertEqual(self.psql("select (to_regclass('atomic_test.preflight_never_writes') is null)::int||'|'||count(*) from supabase_migrations.schema_migrations where version=any(array['"+first+"','"+second+"']);").stdout.strip(), "1|0")

    def test_batch_effective_lock_timeout_rolls_back_file(self):
        self.psql("create table atomic_test.lock_target(id int);")
        blocker = subprocess.Popen(["psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1"], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        blocker.stdin.write("begin; lock table atomic_test.lock_target in access exclusive mode; select 'locked'; select pg_sleep(10); rollback;\n")
        blocker.stdin.close()
        try:
            self.assertEqual(blocker.stdout.readline().strip(), "locked")
            self.assertEqual(self.run_batch({"29990201000109": "set local lock_timeout='500ms'; set local statement_timeout='2500ms'; set local transaction_timeout='3s'; create table atomic_test.lock_rollback(id int); select * from atomic_test.lock_target;"}), 2)
            self.assertEqual(self.psql("select (to_regclass('atomic_test.lock_rollback') is null)::int||'|'||count(*) from supabase_migrations.schema_migrations where version='29990201000109';").stdout.strip(), "1|0")
        finally:
            blocker.terminate()
            blocker.wait(timeout=5)

    def test_batch_per_file_commit_failure_rollback_and_stop(self):
        bodies = {
            "29990201000101": "create table atomic_test.prior_commit(id int);",
            "29990201000102": "create table atomic_test.must_rollback(id int); select 1/0;",
            "29990201000103": "create table atomic_test.must_not_run(id int);",
        }
        self.assertEqual(self.run_batch(bodies), 2)
        self.assertEqual(self.psql("select (to_regclass('atomic_test.prior_commit') is not null)::int||'|'||"
                                  "(to_regclass('atomic_test.must_rollback') is null)::int||'|'||"
                                  "(to_regclass('atomic_test.must_not_run') is null)::int;").stdout.strip(), "1|1|1")
        self.assertEqual(self.psql("select string_agg(version,',') from supabase_migrations.schema_migrations where version like '299902%';").stdout.strip(), "29990201000101")

    def test_batch_check_has_zero_writes_and_local_budgets_are_effective(self):
        bodies = {"29990201000104": """set local lock_timeout='500ms';
set local statement_timeout='2500ms'; set local transaction_timeout='3s';
do $$begin if current_setting('lock_timeout') <> '500ms'
or current_setting('statement_timeout') <> '2500ms'
or current_setting('transaction_timeout') <> '3s' then raise exception 'budgets inactive'; end if; end$$;
create table atomic_test.budgets_active(id int);"""}
        self.assertEqual(self.run_batch(bodies, "check"), 0)
        self.assertEqual(self.psql("select (to_regclass('atomic_test.budgets_active') is null)::int||'|'||count(*) from supabase_migrations.schema_migrations where version='29990201000104';").stdout.strip(), "1|0")
        self.assertEqual(self.run_batch(bodies), 0)

    def test_batch_statement_timeout_rolls_back_file_and_stops(self):
        bodies = {
            "29990201000105": "create table atomic_test.timeout_prior(id int);",
            "29990201000106": "set local lock_timeout='500ms'; set local statement_timeout='2500ms'; set local transaction_timeout='3s'; create table atomic_test.timeout_rollback(id int); select pg_sleep(4);",
            "29990201000107": "create table atomic_test.timeout_later(id int);",
        }
        self.assertEqual(self.run_batch(bodies), 2)
        self.assertEqual(self.psql("select (to_regclass('atomic_test.timeout_prior') is not null)::int||'|'||(to_regclass('atomic_test.timeout_rollback') is null)::int||'|'||(to_regclass('atomic_test.timeout_later') is null)::int;").stdout.strip(), "1|1|1")
        self.assertEqual(self.psql("select string_agg(version,',') from supabase_migrations.schema_migrations where version like '299902%';").stdout.strip(), "29990201000105")

    def test_batch_transaction_timeout_rolls_back_entire_file(self):
        bodies = {"29990201000108": "set local lock_timeout='500ms'; set local statement_timeout='2500ms'; set local transaction_timeout='3s'; create table atomic_test.transaction_rollback(id int); select pg_sleep(1.2); select pg_sleep(1.2); select pg_sleep(1.2);"}
        self.assertEqual(self.run_batch(bodies), 2)
        self.assertEqual(self.psql("select (to_regclass('atomic_test.transaction_rollback') is null)::int||'|'||count(*) from supabase_migrations.schema_migrations where version='29990201000108';").stdout.strip(), "1|0")

    def test_exact_health_sql_replays_under_new_runner_with_real_budgets(self):
        self.addCleanup(self.psql, "drop function if exists public.get_search_embedding_health(); drop function if exists public.reset_dam_search_embedding_errors(text,integer); drop function if exists public.reset_dam_search_embedding_errors(text,integer,text); drop table if exists public.dam_search_documents,public.style_guide_search_documents,public.style_guide_files; drop function if exists public.has_role(uuid,text); delete from supabase_migrations.schema_migrations where version=any(array['20261105073854','20261105073903','20261105073911','20261105073920']);")
        self.psql("""
create schema if not exists auth;
do $$begin if to_regprocedure('auth.uid()') is null then execute 'create function auth.uid() returns uuid language sql as ''select null::uuid'''; end if; end$$;
create function public.has_role(uuid,text) returns boolean language sql as 'select true';
do $$begin create role anon; exception when duplicate_object then null; end$$;
do $$begin create role authenticated; exception when duplicate_object then null; end$$;
do $$begin create role service_role; exception when duplicate_object then null; end$$;
create table public.dam_search_documents(
 document_type text,entity_id uuid,embedding text,embedding_attempts int default 0,
 embedding_max_attempts int default 3,embedding_error_category text,metadata jsonb,
 embedding_error text,embedding_updated_at timestamptz,indexed_at timestamptz,
 embedding_lease_expires_at timestamptz,embedding_next_retry_at timestamptz,
 embedding_lease_token uuid,embedding_lease_owner text);
create table public.style_guide_search_documents(
 is_active boolean,content_sha256 text,embedding text,embedding_attempts int,
 embedding_max_attempts int,embedding_error_category text,style_guide_file_id uuid,
 embedding_error text,embedding_updated_at timestamptz,document_updated_at timestamptz);
create table public.style_guide_files(id uuid,thumbnail_url text);
""")
        versions = ["20261105073854", "20261105073903", "20261105073911", "20261105073920"]
        root = Path(atomic.ROOT) / "supabase/migrations"
        if not list(root.glob(versions[0] + "_*.sql")):
            # Database-contract workflow temporarily moves immutable SQL here.
            root = Path(os.environ["RUNNER_TEMP"]) / "migrations"
        argv = ["atomic", "--migrations-dir", str(root), "--linked-dir", str(root),
                "--versions", ",".join(versions), "--target", "preview",
                "--expected-project-ref", "local-preview", "--mode", "apply"]
        with patch.object(atomic, "linked_connection", return_value=(self.connection_url(), os.environ.copy())), patch.object(sys, "argv", argv):
            self.assertEqual(atomic.main(), 0)
        self.assertEqual(self.psql("select count(*) from supabase_migrations.schema_migrations where version=any(array['"+"','".join(versions)+"']);").stdout.strip(), "4")
        self.assertEqual(self.psql("set request.jwt.claim.role='service_role'; select corpus||'|'||pending||'|'||errored from public.get_search_embedding_health() order by corpus;").stdout.strip().splitlines()[-2:], ["dam|0|0", "popsg|0|0"])

    def test_real_main_path_commits_and_rerun_refuses(self):
        version = "29990201000011"
        self.assertEqual(self.run_main(version, "create table atomic_test.main_success(id int);"), 0)
        out = self.psql(f"select (to_regclass('atomic_test.main_success') is not null)::int||'|'||count(*) from supabase_migrations.schema_migrations where version='{version}';").stdout.strip()
        self.assertEqual(out, "1|1")
        self.assertEqual(self.run_main(version, "create table atomic_test.main_success(id int);"), 2)

    def test_real_main_path_ledger_failure_rolls_back_ddl(self):
        version = "29990201000012"
        self.psql(f"create function atomic_test.block_main_ledger() returns trigger language plpgsql as $$begin if new.version='{version}' then raise exception 'blocked'; end if; return new; end$$; create trigger block_main_atomic before insert on supabase_migrations.schema_migrations for each row execute function atomic_test.block_main_ledger();")
        self.assertEqual(self.run_main(version, "create table atomic_test.main_ledger_fail(id int);"), 2)
        out = self.psql(f"select (to_regclass('atomic_test.main_ledger_fail') is null)::int||'|'||count(*) from supabase_migrations.schema_migrations where version='{version}';").stdout.strip()
        self.assertEqual(out, "1|0")

    def test_real_main_path_ddl_failure_adds_no_ledger(self):
        version = "29990201000013"
        self.assertEqual(self.run_main(version, "create table atomic_test.main_ddl_fail(id definitely_not_a_type);"), 2)
        self.assertEqual(self.psql(f"select count(*) from supabase_migrations.schema_migrations where version='{version}';").stdout.strip(), "0")

    def test_real_main_path_sql_atomic_function_commits_with_ledger(self):
        version = "29990201000014"
        sql = """create function atomic_test.sql_atomic(v integer)
returns integer language sql begin atomic
  select v + 1;
end;"""
        self.assertEqual(self.run_main(version, sql), 0)
        out = self.psql(
            "select atomic_test.sql_atomic(6)||'|'||count(*)||'|'||"
            "max(cardinality(statements)) from supabase_migrations.schema_migrations "
            f"where version='{version}';"
        ).stdout.strip()
        self.assertEqual(out, "7|1|1")

    def test_real_main_path_sql_atomic_function_rolls_back_with_later_ddl_failure(self):
        version = "29990201000015"
        sql = """create function atomic_test.sql_atomic_rollback(v integer)
returns integer language sql begin atomic
  select v + 1;
end;
create table atomic_test.atomic_rollback_fail(id definitely_not_a_type);"""
        self.assertEqual(self.run_main(version, sql), 2)
        out = self.psql(
            "select (to_regprocedure('atomic_test.sql_atomic_rollback(integer)') is null)::int"
            "||'|'||count(*) from supabase_migrations.schema_migrations "
            f"where version='{version}';"
        ).stdout.strip()
        self.assertEqual(out, "1|0")

    def test_real_main_path_opted_outer_sql_atomic_commits_function_and_ledger(self):
        version = "29990201000016"
        sql = """begin;
create function atomic_test.opted_sql_atomic(v integer)
returns integer language sql begin atomic
  select v + 1;
end;
commit;"""
        self.assertEqual(self.run_main(version, sql, strip_outer_transaction=True), 0)
        out = self.psql(
            "select atomic_test.opted_sql_atomic(6)||'|'||count(*)||'|'||"
            "max(cardinality(statements)) from supabase_migrations.schema_migrations "
            f"where version='{version}';"
        ).stdout.strip()
        self.assertEqual(out, "7|1|1")

    def test_real_main_path_opted_outer_rollback_keeps_ddl_and_ledger_atomic(self):
        version = "29990201000017"
        sql = """begin;
create function atomic_test.opted_sql_atomic_rollback(v integer)
returns integer language sql begin atomic
  select v + 1;
end;
create table atomic_test.opted_outer_rollback_fail(id definitely_not_a_type);
commit;"""
        self.assertEqual(self.run_main(version, sql, strip_outer_transaction=True), 2)
        out = self.psql(
            "select (to_regprocedure('atomic_test.opted_sql_atomic_rollback(integer)') is null)::int"
            "||'|'||count(*) from supabase_migrations.schema_migrations "
            f"where version='{version}';"
        ).stdout.strip()
        self.assertEqual(out, "1|0")

    def test_success_commits_ddl_and_ledger_and_rerun_refuses(self):
        wrapper = atomic.build_wrapper("29990201000001", "success", "create table atomic_test.success(id int);", ["create table atomic_test.success(id int)"])
        self.psql(wrapper)
        out = self.psql("select (to_regclass('atomic_test.success') is not null)::int||'|'||count(*) from supabase_migrations.schema_migrations where version='29990201000001';").stdout.strip()
        self.assertEqual(out, "1|1")
        self.psql(wrapper, ok=False)
        self.assertEqual(self.psql("select count(*) from supabase_migrations.schema_migrations where version='29990201000001';").stdout.strip(), "1")

    def test_forced_ledger_failure_rolls_back_ddl(self):
        self.psql("create function atomic_test.block_ledger() returns trigger language plpgsql as $$begin if new.version='29990201000002' then raise exception 'blocked'; end if; return new; end$$; create trigger block_atomic before insert on supabase_migrations.schema_migrations for each row execute function atomic_test.block_ledger();")
        wrapper = atomic.build_wrapper("29990201000002", "ledger_fail", "create table atomic_test.ledger_fail(id int);", ["create table atomic_test.ledger_fail(id int)"])
        self.psql(wrapper, ok=False)
        self.assertEqual(self.psql("select (to_regclass('atomic_test.ledger_fail') is null)::int||'|'||count(*) from supabase_migrations.schema_migrations where version='29990201000002';").stdout.strip(), "1|0")

    def test_forced_ddl_failure_adds_no_ledger(self):
        wrapper = atomic.build_wrapper("29990201000003", "ddl_fail", "create table atomic_test.ddl_fail(id definitely_not_a_type);", ["create table atomic_test.ddl_fail(id definitely_not_a_type)"])
        self.psql(wrapper, ok=False)
        self.assertEqual(self.psql("select count(*) from supabase_migrations.schema_migrations where version='29990201000003';").stdout.strip(), "0")


if __name__ == "__main__": unittest.main()
