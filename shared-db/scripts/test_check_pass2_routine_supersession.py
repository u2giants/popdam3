import shutil
import socket
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from check_pass2_routine_supersession import (
    broad_routine_revoke_schemas,
    classify_collisions,
    declared_routines,
    later_collisions,
    later_drops,
    later_only_routines,
    read_applied_migrations,
    redeclared_after_drop,
    snapshot_query,
)


class Pass2RoutineSupersessionTests(unittest.TestCase):
    def test_exact_orderlist_failure_is_refused(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            old = root / "20260810010000_popdam_order_list_contract.sql"
            old.write_text(
                "create or replace function public.create_dam_order(p jsonb) returns void language sql as $$ select $$;\n"
                "create or replace function plm.dam_order_allowed_header_keys() returns text[] language sql as $$ select '{}'::text[] $$;\n",
                encoding="utf-8",
            )
            newer = root / "20260830111545_popdam_orderlist_input_only_write_contract.sql"
            newer.write_text(
                "CREATE OR REPLACE FUNCTION public.create_dam_order(p jsonb) returns void language sql as $$ select $$;\n"
                "CREATE OR REPLACE FUNCTION plm.dam_order_allowed_header_keys() returns text[] language sql as $$ select '{}'::text[] $$;\n",
                encoding="utf-8",
            )
            self.assertEqual(
                later_collisions(old, root),
                {
                    "plm.dam_order_allowed_header_keys": [newer.name],
                    "public.create_dam_order": [newer.name],
                },
            )

    def test_only_later_files_count(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            current = root / "20260810010000_current.sql"
            current.write_text("create or replace function public.f() returns void language sql as $$ select $$;", encoding="utf-8")
            (root / "20260809000000_earlier.sql").write_text("create or replace function public.f() returns void language sql as $$ select $$;", encoding="utf-8")
            self.assertEqual(later_collisions(current, root), {})

    def test_ignores_comment_mentions(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "x.sql"
            path.write_text("-- create or replace function public.fake()\nselect 1;", encoding="utf-8")
            self.assertEqual(declared_routines(path), set())

    def test_snapshot_query_selects_every_colliding_routine(self):
        query = snapshot_query({"public.f": ["later.sql"], '"plm"."g"': ["later.sql"]})
        self.assertIn("'public.f'", query)
        self.assertIn("'plm.g'", query)
        self.assertIn("pg_get_function_identity_arguments", query)
        self.assertIn("reset all", query)
        self.assertIn("security %s", query)
        self.assertIn("p.prosecdef", query)
        self.assertIn("p.prokind", query)
        self.assertIn("to_regprocedure", query)
        self.assertIn("oidvectortypes", query)


class Pass2PrivilegeSupersessionTests(unittest.TestCase):
    """A schema-wide revoke in a pass-2 file reaches functions created LATER.

    20260710135985_reconcile_permission_parity.sql fails to replay from empty,
    so it runs in pass 2 -- after every pass-1 success. Its
    `revoke execute on all functions in schema api from service_role` then
    un-grants api functions that were created months after it, which no real
    database ever does. That silently broke the grants of ~60 api functions and
    surfaced as api.set_source_resolution failing its own grant contract.
    """

    def _dir(self, temp):
        root = Path(temp)
        old = root / "20260710135985_reconcile_permission_parity.sql"
        old.write_text(
            "revoke execute on all functions in schema api from service_role;\n"
            "grant execute on function api.crm_customer_logo_url(jsonb, text) to service_role;\n",
            encoding="utf-8",
        )
        (root / "20260101000000_earlier.sql").write_text(
            "create or replace function api.crm_customer_logo_url(p jsonb, q text)"
            " returns text language sql as $$ select '' $$;\n",
            encoding="utf-8",
        )
        (root / "20260902031743_api_set_source_resolution.sql").write_text(
            "create or replace function api.set_source_resolution(a text)"
            " returns void language sql as $$ select $$;\n"
            "create or replace function plm.unrelated(a text)"
            " returns void language sql as $$ select $$;\n",
            encoding="utf-8",
        )
        return root, old

    def test_schema_wide_routine_revoke_is_detected(self):
        with tempfile.TemporaryDirectory() as temp:
            _, old = self._dir(temp)
            self.assertEqual(broad_routine_revoke_schemas(old), {"api"})

    def test_a_narrow_revoke_is_not_treated_as_schema_wide(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "x.sql"
            path.write_text(
                "revoke all on function api.f(text) from public, anon;\n"
                "-- revoke execute on all functions in schema api from service_role;\n",
                encoding="utf-8",
            )
            self.assertEqual(broad_routine_revoke_schemas(path), set())

    def test_only_later_created_routines_are_repaired(self):
        with tempfile.TemporaryDirectory() as temp:
            root, old = self._dir(temp)
            # api.set_source_resolution is created only AFTER the revoke, so the
            # revoke could never have reached it in a real database.
            # api.crm_customer_logo_url existed before it, so this migration's
            # own intent for that function must be left exactly as written.
            # plm.unrelated lies outside the revoked schema.
            self.assertEqual(
                later_only_routines(old, root, {"api"}),
                {"api.set_source_resolution"},
            )

    def test_no_broad_revoke_means_no_privilege_repair(self):
        with tempfile.TemporaryDirectory() as temp:
            root, old = self._dir(temp)
            self.assertEqual(later_only_routines(old, root, set()), set())

    def test_snapshot_query_restores_execute_grants(self):
        query = snapshot_query({}, {"api.set_source_resolution"})
        self.assertIn("'api.set_source_resolution'", query)
        self.assertIn("aclexplode", query)
        self.assertIn("grant execute on function", query)
        # PUBLIC is grantee 0 and has no regrole name; it must not be dropped.
        self.assertIn("acl.grantee = 0", query)

    def test_both_repairs_travel_in_one_query(self):
        query = snapshot_query({"public.f": ["later.sql"]}, {"api.g"})
        self.assertIn("pg_get_functiondef", query)
        self.assertIn("aclexplode", query)
        self.assertIn("union all", query)
        # Definitions are restored before grants.
        self.assertLess(query.index("pg_get_functiondef"), query.index("aclexplode"))

    def test_nothing_to_repair_yields_no_query(self):
        self.assertEqual(snapshot_query({}, set()), "")


class Pass2ProvenanceTests(unittest.TestCase):
    """Issue #2537. A later FILENAME is not evidence of a later DEFINITION.

    Run 34142055022: 20260901142825_popdam_effective_count_performance.sql
    applied in pass 2 and installed its replacement helpers. Two later
    migrations, 20260902042548 and 20260904121037, ALSO declare those helpers --
    and both rolled back. The catalog therefore still held the BASELINE bodies,
    which the repair snapshotted and put back, silently reverting the pass-2
    file's forward repair. Two effective-count contracts then failed with a plan
    shape that nothing in the diff explained.
    """

    ROUTINE = (
        "create or replace function popdam.effective_count(p text)"
        " returns bigint language sql as $$ select 1::bigint $$;\n"
    )

    def _replay(self, temp):
        root = Path(temp)
        (root / "20260901142825_popdam_effective_count_performance.sql").write_text(
            self.ROUTINE, encoding="utf-8"
        )
        (root / "20260902042548_popdam_unfiltered_facet_count_index_only_path.sql").write_text(
            self.ROUTINE, encoding="utf-8"
        )
        (root / "20260904121037_popdam_tag_facet_count_index_leading_arm.sql").write_text(
            self.ROUTINE, encoding="utf-8"
        )
        return root, root / "20260901142825_popdam_effective_count_performance.sql"

    def test_case1_failed_later_migration_does_not_resurrect_obsolete_routine(self):
        """Later migration failed; the baseline body must NOT be restored."""
        with tempfile.TemporaryDirectory() as temp:
            root, old = self._replay(temp)
            collisions = later_collisions(old, root)
            # Both later files really do collide -- the old code stopped here and
            # restored whatever the catalog happened to hold.
            self.assertEqual(len(collisions["popdam.effective_count"]), 2)
            proven, unproven = classify_collisions(collisions, set())
            self.assertEqual(proven, {})
            self.assertEqual(
                sorted(unproven["popdam.effective_count"]),
                [
                    "20260902042548_popdam_unfiltered_facet_count_index_only_path.sql",
                    "20260904121037_popdam_tag_facet_count_index_leading_arm.sql",
                ],
            )
            # Nothing to restore means no query at all, so the pass-2 file's own
            # forward repair is what survives.
            self.assertEqual(snapshot_query(proven, set()), "")
            # ...whereas restoring on filename alone -- the pre-#2537 behaviour --
            # would have snapshotted and put back the obsolete body. This line is
            # the defect, kept as the control that proves the fix is doing work.
            self.assertIn("'popdam.effective_count'", snapshot_query(collisions, set()))

    def test_case2_successful_later_migration_is_still_preserved(self):
        """The repair this script exists for must keep working."""
        with tempfile.TemporaryDirectory() as temp:
            root, old = self._replay(temp)
            applied = {"20260904121037_popdam_tag_facet_count_index_leading_arm.sql"}
            proven, unproven = classify_collisions(later_collisions(old, root), applied)
            self.assertEqual(
                proven,
                {
                    "popdam.effective_count": [
                        "20260904121037_popdam_tag_facet_count_index_leading_arm.sql"
                    ]
                },
            )
            self.assertEqual(unproven, {})
            query = snapshot_query(proven, set())
            self.assertIn("'popdam.effective_count'", query)
            # Body, SET settings and security label all travel with it.
            self.assertIn("pg_get_functiondef", query)
            self.assertIn("reset all", query)
            self.assertIn("security %s", query)

    def test_case3_overlapping_outcomes_are_classified_one_routine_at_a_time(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            old = root / "20260901142825_old.sql"
            old.write_text(
                "create or replace function popdam.landed(p text) returns void language sql as $$ select $$;\n"
                "create or replace function popdam.rolled_back(p text) returns void language sql as $$ select $$;\n",
                encoding="utf-8",
            )
            (root / "20260902000000_landed.sql").write_text(
                "create or replace function popdam.landed(p text) returns void language sql as $$ select $$;\n",
                encoding="utf-8",
            )
            (root / "20260903000000_rolled_back.sql").write_text(
                "create or replace function popdam.rolled_back(p text) returns void language sql as $$ select $$;\n",
                encoding="utf-8",
            )
            proven, unproven = classify_collisions(
                later_collisions(old, root), {"20260902000000_landed.sql"}
            )
            self.assertEqual(proven, {"popdam.landed": ["20260902000000_landed.sql"]})
            self.assertEqual(
                unproven, {"popdam.rolled_back": ["20260903000000_rolled_back.sql"]}
            )
            query = snapshot_query(proven, set())
            self.assertIn("'popdam.landed'", query)
            self.assertNotIn("'popdam.rolled_back'", query)

    def test_case3_no_record_of_any_later_migration_refuses_everything(self):
        """Absent provenance is not permission. Nothing is claimed as newer."""
        with tempfile.TemporaryDirectory() as temp:
            root, old = self._replay(temp)
            proven, unproven = classify_collisions(later_collisions(old, root), set())
            self.assertFalse(proven)
            self.assertTrue(unproven)

    def test_case4_grant_restoration_survives_without_resurrecting_definitions(self):
        """A schema-wide revoke still has its grants repaired, bodies untouched."""
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            old = root / "20260710135985_reconcile_permission_parity.sql"
            old.write_text(
                "revoke execute on all functions in schema api from service_role;\n"
                "create or replace function api.shared(p text) returns void language sql as $$ select $$;\n",
                encoding="utf-8",
            )
            (root / "20260902031743_later.sql").write_text(
                "create or replace function api.set_source_resolution(a text)"
                " returns void language sql as $$ select $$;\n"
                "create or replace function api.shared(p text) returns void language sql as $$ select $$;\n",
                encoding="utf-8",
            )
            schemas = broad_routine_revoke_schemas(old)
            privilege_routines = later_only_routines(old, root, schemas)
            self.assertEqual(privilege_routines, {"api.set_source_resolution"})
            # 20260902031743 did NOT apply, so api.shared's catalog body is unproven.
            proven, unproven = classify_collisions(later_collisions(old, root), set())
            self.assertEqual(proven, {})
            self.assertIn("api.shared", unproven)
            query = snapshot_query(proven, privilege_routines)
            self.assertIn("grant execute on function", query)
            self.assertIn("'api.set_source_resolution'", query)
            self.assertIn("aclexplode", query)
            # The grant half writes no bodies, so it cannot resurrect one.
            self.assertNotIn("pg_get_functiondef", query)

    def test_applied_record_is_read_line_by_line(self):
        with tempfile.TemporaryDirectory() as temp:
            record = Path(temp) / "applied-migrations.txt"
            record.write_text("a.sql\n\n  b.sql  \n", encoding="utf-8")
            self.assertEqual(read_applied_migrations(record), {"a.sql", "b.sql"})

    def test_missing_applied_record_raises_rather_than_assuming_success(self):
        with tempfile.TemporaryDirectory() as temp:
            with self.assertRaises(FileNotFoundError):
                read_applied_migrations(Path(temp) / "nope.txt")


class Pass2LaterDropTests(unittest.TestCase):
    """PR #2944: 20260905104802 creates public.deactivate_stale_sg_files, fails in
    pass 1; 20260915111317 drops it and applies; pass 2 re-runs 20260905104802
    and resurrected the retired wrapper, failing its retirement contract."""

    OLD = "20260905104802_popsg_bounded_reconcile.sql"
    DROP = "20260915111317_popsg_retire_wrapper.sql"
    CREATE = (
        "create or replace function public.deactivate_stale_sg_files(\n"
        "  p text, q uuid) returns void language sql as $$ select $$;\n"
    )

    def _replay(self, temp, drop_sql):
        root = Path(temp)
        (root / self.OLD).write_text(self.CREATE, encoding="utf-8")
        (root / self.DROP).write_text(drop_sql, encoding="utf-8")
        return root, root / self.OLD

    def test_later_drop_is_replayed_so_routine_is_absent(self):
        with tempfile.TemporaryDirectory() as temp:
            root, old = self._replay(
                temp, "drop function if exists public.deactivate_stale_sg_files(text, uuid);\n"
            )
            drops = later_drops(old, root, {self.DROP})
            self.assertEqual(
                drops,
                {
                    "public.deactivate_stale_sg_files": [
                        "drop function if exists public.deactivate_stale_sg_files(text, uuid);"
                    ]
                },
            )
            query = snapshot_query({}, set(), drops)
            self.assertIn(
                "drop function if exists public.deactivate_stale_sg_files(text, uuid);", query
            )
            # The CLI emits it too, so the workflow replays it after the pass-2 file.
            record = root / "applied.txt"
            record.write_text(self.DROP + "\n", encoding="utf-8")
            out = subprocess.run(
                [sys.executable, str(Path(__file__).with_name("check_pass2_routine_supersession.py")),
                 str(old), "--migrations-dir", str(root), "--applied-migrations", str(record)],
                capture_output=True, text=True, check=True,
            ).stdout
            self.assertIn("deactivate_stale_sg_files(text, uuid)", out)

    def test_every_drop_row_is_guarded_on_the_exact_signature_being_absent(self):
        with tempfile.TemporaryDirectory() as temp:
            root, old = self._replay(
                temp, "drop function public.deactivate_stale_sg_files(text, uuid) cascade;\n"
                "DROP PROCEDURE \"public\".\"deactivate_stale_sg_files\";\n"
            )
            drops = later_drops(old, root, {self.DROP})
            self.assertEqual(
                drops["public.deactivate_stale_sg_files"],
                [
                    "drop function if exists public.deactivate_stale_sg_files(text, uuid);",
                    'drop procedure if exists "public"."deactivate_stale_sg_files";',
                ],
            )
            query = snapshot_query({}, set(), drops)
            self.assertIn(
                "to_regprocedure('public.deactivate_stale_sg_files(text, uuid)') is null", query
            )
            self.assertIn("to_regproc('\"public\".\"deactivate_stale_sg_files\"') is null", query)

    def test_drop_text_inside_a_string_or_body_is_not_a_drop(self):
        with tempfile.TemporaryDirectory() as temp:
            root, old = self._replay(
                temp,
                "select pg_temp.apply('drop function if exists public.deactivate_stale_sg_files(int)');\n"
                "create function public.x() returns void language plpgsql as $b$ begin\n"
                "  drop function public.deactivate_stale_sg_files(text, uuid);\nend $b$;\n",
            )
            self.assertEqual(later_drops(old, root, {self.DROP}), {})

    def test_quoted_identifier_with_comma_is_not_split(self):
        with tempfile.TemporaryDirectory() as temp:
            root, old = self._replay(
                temp, 'drop function "a,b".f(int), public.deactivate_stale_sg_files(text, uuid);\n'
            )
            self.assertEqual(
                later_drops(old, root, {self.DROP}),
                {"public.deactivate_stale_sg_files": [
                    "drop function if exists public.deactivate_stale_sg_files(text, uuid);"
                ]},
            )

    def test_unapplied_later_drop_is_not_replayed(self):
        with tempfile.TemporaryDirectory() as temp:
            root, old = self._replay(
                temp, "drop function public.deactivate_stale_sg_files(text, uuid) cascade;\n"
            )
            self.assertEqual(later_drops(old, root, set()), {})

    def test_multi_target_drop_keeps_exact_signatures_and_ignores_comments(self):
        with tempfile.TemporaryDirectory() as temp:
            root, old = self._replay(
                temp,
                "-- drop function public.deactivate_stale_sg_files(int);\n"
                "DROP ROUTINE public.other(int), public.deactivate_stale_sg_files(text, uuid);\n",
            )
            self.assertEqual(
                later_drops(old, root, {self.DROP}),
                {
                    "public.deactivate_stale_sg_files": [
                        "drop routine if exists public.deactivate_stale_sg_files(text, uuid);"
                    ]
                },
            )


@unittest.skipUnless(shutil.which("initdb") and shutil.which("pg_ctl") and shutil.which("psql"),
                     "PostgreSQL server binaries are not installed")
class Pass2LaterDropCatalogTests(unittest.TestCase):
    """The replay itself, on a throwaway PostgreSQL cluster: later migrations
    apply, the snapshot is taken, the older pass-2 file runs, the snapshot rows
    run -- then the CATALOG is asserted, not emitted text."""

    OLD = Pass2LaterDropTests.OLD
    CREATE = Pass2LaterDropTests.CREATE
    OLD_SIG = "public.deactivate_stale_sg_files(text, uuid)"

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        data = Path(cls.tmp.name) / "data"
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            cls.port = str(sock.getsockname()[1])
        subprocess.run(["initdb", "-A", "trust", "-U", "postgres", "-D", str(data)],
                       check=True, capture_output=True)
        subprocess.run(["pg_ctl", "-D", str(data), "-l", str(Path(cls.tmp.name) / "log"), "-w",
                        "-o", f"-p {cls.port} -h 127.0.0.1 -k \"\"", "start"],
                       # The server inherits these handles; a captured pipe never
                       # reaches EOF while it runs, so pg_ctl would never return.
                       check=True, stdin=subprocess.DEVNULL,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        cls.data = data

    @classmethod
    def tearDownClass(cls):
        subprocess.run(["pg_ctl", "-D", str(cls.data), "-m", "immediate", "-w", "stop"],
                       capture_output=True)
        cls.tmp.cleanup()

    def psql(self, sql, db="postgres"):
        return subprocess.run(
            ["psql", "-h", "127.0.0.1", "-p", self.port, "-U", "postgres", "-d", db, "-At",
             "--no-psqlrc", "-v", "ON_ERROR_STOP=1", "-c", sql],
            check=True, capture_output=True, text=True,
        ).stdout.strip()

    def replay(self, later_sql, baseline_sql=""):
        db = "r" + next(tempfile._get_candidate_names()).lower().replace("_", "")
        self.psql(f"create database {db}")
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / self.OLD).write_text(self.CREATE, encoding="utf-8")
            later = "20260915111317_later.sql"
            (root / later).write_text(later_sql, encoding="utf-8")
            # Pass 1: the older file is deferred; the later file applies.
            self.psql(later_sql, db)
            # The captured baseline loads between the passes (never a migration).
            if baseline_sql:
                self.psql(baseline_sql, db)
            query = snapshot_query(
                {}, set(), later_drops(root / self.OLD, root, {later}),
                redeclared_after_drop(root / self.OLD, root, {later}),
            )
            rows = self.psql(query, db) if query else ""
            # Pass 2: the older file re-runs, then the snapshot rows run.
            self.psql(self.CREATE, db)
            if rows:
                self.psql(rows, db)
        return db

    def exists(self, db, signature):
        return self.psql(f"select to_regprocedure('{signature}') is not null", db) == "t"

    def test_early_create_later_drop_leaves_routine_absent(self):
        db = self.replay(f"drop function if exists {self.OLD_SIG};\n")
        self.assertFalse(self.exists(db, self.OLD_SIG))

    def test_drop_then_same_identity_recreate_leaves_routine_present(self):
        db = self.replay(f"drop function if exists {self.OLD_SIG};\n" + self.CREATE)
        self.assertTrue(self.exists(db, self.OLD_SIG))

    def test_drop_then_new_identity_retires_the_old_identity_only(self):
        new = ("create or replace function public.deactivate_stale_sg_files(p text, q uuid, r int)"
               " returns void language sql as $$ select $$;\n")
        db = self.replay(f"drop function if exists {self.OLD_SIG};\n" + new)
        self.assertFalse(self.exists(db, self.OLD_SIG))
        self.assertTrue(self.exists(db, "public.deactivate_stale_sg_files(text, uuid, integer)"))

    def test_baseline_recreated_between_passes_is_still_dropped(self):
        # PR #2958 run 34973127156: 20260915130626 drops the wrapper in pass 1,
        # the between-pass baseline re-creates it, 20260905104802 re-runs in
        # pass 2. A presence guard skipped the drop; the retired wrapper survived.
        db = self.replay(f"drop function if exists {self.OLD_SIG};\n", baseline_sql=self.CREATE)
        self.assertFalse(self.exists(db, self.OLD_SIG))


class Pass2DropSurvivesBaselineTests(unittest.TestCase):
    """Issue #2959: which later drops replay unconditionally."""

    OLD = Pass2LaterDropTests.OLD
    CREATE = Pass2LaterDropTests.CREATE
    STMT = "drop function if exists public.deactivate_stale_sg_files(text, uuid);"

    def _dir(self, temp, files):
        root = Path(temp)
        (root / self.OLD).write_text(self.CREATE, encoding="utf-8")
        for name, sql in files.items():
            (root / name).write_text(sql, encoding="utf-8")
        return root

    def test_drop_nobody_redeclares_is_unguarded_in_the_cli_output(self):
        with tempfile.TemporaryDirectory() as temp:
            later = "20260915130626_retire.sql"
            root = self._dir(temp, {later: self.STMT + "\n"})
            self.assertEqual(redeclared_after_drop(root / self.OLD, root, {later}), set())
            record = root / "applied.txt"
            record.write_text(later + "\n", encoding="utf-8")
            out = subprocess.run(
                [sys.executable, str(Path(__file__).with_name("check_pass2_routine_supersession.py")),
                 str(root / self.OLD), "--migrations-dir", str(root), "--applied-migrations", str(record)],
                capture_output=True, text=True, check=True,
            ).stdout
            self.assertIn(self.STMT, out)
            self.assertNotIn("to_regproc", out)

    def test_redeclared_in_the_dropping_file_or_later_keeps_the_guard(self):
        with tempfile.TemporaryDirectory() as temp:
            same, after = "20260915130626_drop_and_recreate.sql", "20260915140000_recreate.sql"
            root = self._dir(temp, {same: self.STMT + "\n" + self.CREATE})
            self.assertEqual(redeclared_after_drop(root / self.OLD, root, {same}),
                             {"public.deactivate_stale_sg_files"})
            root2 = Path(temp) / "b"
            root2.mkdir()
            self._dir(root2, {same: self.STMT + "\n", after: self.CREATE})
            self.assertEqual(redeclared_after_drop(root2 / self.OLD, root2, {same, after}),
                             {"public.deactivate_stale_sg_files"})
            # An unapplied later re-create proves nothing: the drop stays unguarded.
            self.assertEqual(redeclared_after_drop(root2 / self.OLD, root2, {same}), set())

    def test_declaration_before_the_drop_does_not_guard_it(self):
        with tempfile.TemporaryDirectory() as temp:
            before, drop = "20260915015414_redefine.sql", "20260915130626_retire.sql"
            root = self._dir(temp, {before: self.CREATE, drop: self.STMT + "\n"})
            self.assertEqual(redeclared_after_drop(root / self.OLD, root, {before, drop}), set())
            query = snapshot_query({}, set(), later_drops(root / self.OLD, root, {before, drop}), set())
            self.assertIn(self.STMT, query)
            self.assertNotIn("to_regproc", query)


if __name__ == "__main__":
    unittest.main()
