import tempfile
import unittest
from pathlib import Path

from check_pass2_routine_supersession import (
    broad_routine_revoke_schemas,
    classify_collisions,
    declared_routines,
    later_collisions,
    later_only_routines,
    read_applied_migrations,
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


if __name__ == "__main__":
    unittest.main()
