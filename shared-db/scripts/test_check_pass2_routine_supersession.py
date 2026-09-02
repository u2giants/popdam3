import tempfile
import unittest
from pathlib import Path

from check_pass2_routine_supersession import (
    broad_routine_revoke_schemas,
    declared_routines,
    later_collisions,
    later_only_routines,
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


if __name__ == "__main__":
    unittest.main()
