#!/usr/bin/env python3
"""Offline tests for the post-apply catalog verification (issue #697).

NO DATABASE. Nothing here connects to anything. Every test drives the pure
derivation, SQL-building and reporting logic on temporary files or literal
strings, which is the point: #695 records that `supabase/tests/` exists and
nothing runs it, and this module must not join that pile. These run in the
`validate` job of .github/workflows/shared-supabase-migrations.yml, on every
pull request, alongside the existing production-guard tests.
"""

from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))

from production_catalog_verification import (  # noqa: E402
    ALWAYS_PROBED_ROLES,
    BASE_PRIVILEGES,
    MAINTAIN_PRIVILEGE,
    Targets,
    build_catalog_sql,
    build_row_count_sql,
    derive_targets,
    extract_report,
    render_report,
    split_statements,
)
from production_migration_guard import GuardError, strip_sql  # noqa: E402

REPO = Path(__file__).resolve().parents[1]


def targets_for(sql: str) -> Targets:
    """Derive targets from one throwaway migration file."""
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        migrations = root / "supabase" / "migrations"
        migrations.mkdir(parents=True)
        path = migrations / "20260810140000_test.sql"
        path.write_text(sql, encoding="utf-8")
        return derive_targets({"20260810140000": path}, ["20260810140000"])


class DeriveTargetsTests(unittest.TestCase):
    def test_create_table_is_found(self):
        t = targets_for("create table if not exists plm.widget (id bigint);")
        self.assertIn("plm.widget", t.tables)
        self.assertIn("plm.widget", t.relations)

    def test_create_view_is_a_view_not_a_table(self):
        t = targets_for("create or replace view api.widget_list as select 1;")
        self.assertEqual(t.views, ["api.widget_list"])
        self.assertNotIn("api.widget_list", t.tables)

    def test_function_and_procedure(self):
        t = targets_for(
            "create or replace function plm.f() returns int language sql as $$ select 1 $$;\n"
            "create procedure plm.p() language plpgsql as $$ begin end $$;"
        )
        self.assertEqual(t.functions, ["plm.f", "plm.p"])

    def test_rls_enable_is_detected(self):
        t = targets_for(
            "create table plm.widget (id int);\n"
            "alter table plm.widget enable row level security;"
        )
        self.assertIn("plm.widget", t.rls_relations)

    def test_every_relation_gets_an_rls_reading(self):
        # RLS-on-with-zero-policies was the ONE check the canary run could not
        # confirm at all, so a relation is probed whether or not its migration
        # says anything about RLS.
        t = targets_for("create table plm.widget (id int);")
        self.assertIn("plm.widget", t.rls_relations)

    def test_policy_target(self):
        t = targets_for("create policy p on plm.widget for select using (true);")
        self.assertIn("plm.widget", t.rls_relations)

    def test_insert_is_recorded_as_seeded(self):
        t = targets_for("insert into plm.widget (note) values ('x');")
        self.assertEqual(t.seeded, ["plm.widget"])

    def test_grant_roles_are_probed(self):
        t = targets_for("grant select on table plm.widget to loader_role;")
        self.assertIn("loader_role", t.roles)
        self.assertIn("plm.widget", t.tables)

    def test_revoke_roles_are_probed(self):
        t = targets_for("revoke all on plm.widget from some_other_role;")
        self.assertIn("some_other_role", t.roles)

    def test_multiple_grantees_in_one_statement(self):
        t = targets_for("grant select on plm.widget to alpha, beta with grant option;")
        self.assertIn("alpha", t.roles)
        self.assertIn("beta", t.roles)

    def test_the_four_roles_are_always_probed(self):
        t = targets_for("create table plm.widget (id int);")
        for role in ALWAYS_PROBED_ROLES:
            self.assertIn(role, t.roles)

    def test_all_tables_in_schema_is_not_guessed_at(self):
        # It names a SCHEMA, not a relation. Guessing its membership is exactly
        # the mis-parse this module refuses to make.
        t = targets_for("grant select on all tables in schema plm to anon;")
        self.assertEqual(t.tables, [])

    def test_prose_in_a_comment_literal_cannot_invent_an_object(self):
        # The live 20260807170000 defect: prose inside a `comment on ... is '...'`
        # literal used to be parsed as SQL. `strip_sql` blanks literals; assert
        # the derivation inherits that.
        t = targets_for(
            "create table plm.widget (id int);\n"
            "comment on table plm.widget is "
            "'character can appear in multiple properties. Distinct from "
            "core.style_guide_character, and insert into evil.table too';"
        )
        self.assertEqual(t.tables, ["plm.widget"])
        self.assertEqual(t.seeded, [])

    def test_dollar_quote_inside_a_comment_does_not_eat_the_file(self):
        # The other recorded lexer bug: a `$$` inside a `--` comment became the
        # opening half of a pair and deleted every statement after it.
        t = targets_for(
            "-- guarded do $$ block\n"
            "create table plm.widget (id int);\n"
            "create table plm.gadget (id int);"
        )
        self.assertEqual(t.tables, ["plm.gadget", "plm.widget"])

    def test_keyword_mid_statement_is_not_a_statement_head(self):
        t = targets_for(
            "create table plm.widget (id int references plm.other(id));"
        )
        self.assertEqual(t.tables, ["plm.widget"])

    def test_alter_view_is_derived(self):
        # 20260810110000's ONLY statement outside a `do $$` block is
        # `alter view api.dam_order_list set (security_invoker = true)`, a real
        # security fix. A table-only pattern derived nothing at all from it.
        t = targets_for("alter view api.dam_order_list set (security_invoker = true);")
        self.assertIn("api.dam_order_list", t.required_relations)

    def test_alter_materialized_view_is_derived(self):
        t = targets_for("alter materialized view plm.mv owner to postgres;")
        self.assertIn("plm.mv", t.required_relations)

    def test_alter_if_exists_is_optional_not_required(self):
        # The migration itself tolerates absence, so hard-failing on it would be
        # a false positive that blocks a correct promotion.
        t = targets_for("alter table if exists plm.maybe add column x int;")
        self.assertEqual(t.optional, ["plm.maybe"])
        self.assertNotIn("plm.maybe", t.required_relations)
        self.assertIn("plm.maybe", t.relations)

    def test_alter_view_does_not_claim_row_level_security(self):
        t = targets_for("alter view api.v set (security_invoker = true);")
        self.assertNotIn("api.v", t.rls_relations)

    # ------------------------------------------------------------------
    # THE NON-CLAIMS. Each of these is something the report says it does NOT
    # check. They are tested precisely because a future regex tweak could
    # silently start claiming them, and a claim this module cannot stand behind
    # is worse than no claim at all.
    # ------------------------------------------------------------------

    def test_execute_format_is_not_claimed(self):
        t = targets_for(
            "do $$ begin execute format('create table plm.dynamic (id int)'); end $$;"
        )
        self.assertEqual(t.tables, [])
        self.assertTrue(t.is_empty())

    def test_quoted_identifiers_are_not_claimed(self):
        t = targets_for('create table "PLM"."Widget" (id int);')
        self.assertEqual(t.tables, [])

    def test_search_path_relative_names_are_not_claimed(self):
        # An unqualified name depends on the session search_path, which this
        # module does not model. Silence beats a guess at the schema.
        t = targets_for("set search_path to plm;\ncreate table widget (id int);")
        self.assertEqual(t.tables, [])

    def test_alter_default_privileges_is_not_claimed(self):
        # 20260710135975's `alter default privileges in schema plm grant all on
        # tables to service_role` names no relation, and inventing the set of
        # tables it will affect is exactly the mis-parse to avoid.
        t = targets_for(
            "alter default privileges in schema plm grant all on tables to service_role;"
        )
        self.assertEqual(t.tables, [])
        self.assertTrue(t.is_empty())

    def test_unqualified_grant_target_is_not_claimed(self):
        t = targets_for("grant select on widget to anon;")
        self.assertEqual(t.tables, [])

    def test_unknown_version_is_refused(self):
        with self.assertRaises(GuardError):
            derive_targets({}, ["20260810140000"])

    def test_empty_targets_are_detectable(self):
        t = targets_for("select 1;")
        self.assertTrue(t.is_empty())

    def test_targets_are_sorted_and_stable(self):
        t = targets_for(
            "create table plm.zebra (id int);\ncreate table plm.alpha (id int);"
        )
        self.assertEqual(t.tables, ["plm.alpha", "plm.zebra"])


class CanaryDerivationTests(unittest.TestCase):
    """Against the real canary file, whose apply is the reason #697 exists."""

    PATH = REPO / "supabase" / "migrations" / "20260810140000_production_lane_canary.sql"

    def setUp(self):
        if not self.PATH.exists():
            self.skipTest("canary migration not present")
        self.targets = derive_targets({"20260810140000": self.PATH}, ["20260810140000"])

    def test_the_canary_table_is_derived(self):
        self.assertIn("plm.production_lane_canary", self.targets.relations)

    def test_the_canary_is_rls_probed(self):
        # Check 3 of 5 on issue #677: "RLS enabled with zero policies" was NOT
        # CONFIRMED AT ALL. This is the line that closes it.
        self.assertIn("plm.production_lane_canary", self.targets.rls_relations)

    def test_the_canary_row_is_counted(self):
        # Check 2 of 5: "exactly 1 row" was inferred, never counted.
        self.assertEqual(self.targets.seeded, ["plm.production_lane_canary"])

    def test_the_four_revoked_roles_are_probed(self):
        for role in ("public", "anon", "authenticated", "service_role"):
            self.assertIn(role, self.targets.roles)


class SqlBuildTests(unittest.TestCase):
    def test_maintain_is_probed_conditionally(self):
        sql = build_catalog_sql(targets_for("create table plm.widget (id int);"))
        self.assertIn(MAINTAIN_PRIVILEGE, sql)
        self.assertIn("server_version_num", sql)
        for priv in BASE_PRIVILEGES:
            self.assertIn(priv, sql)

    def test_catalog_sql_is_a_single_read_only_statement(self):
        sql = build_catalog_sql(targets_for("create table plm.widget (id int);"))
        self.assertTrue(sql.lower().startswith("with "))
        self.assertEqual(sql.count(";"), 0)
        # Blank the string literals before looking for writing keywords --
        # 'TRUNCATE' is a privilege NAME inside a literal here, not a statement.
        body = strip_sql(sql)
        for forbidden in (
            "insert into",
            "update ",
            "delete from",
            "drop ",
            "alter ",
            "grant ",
            "revoke ",
            "truncate",
            "create ",
        ):
            self.assertNotIn(forbidden, body, forbidden)

    def test_catalog_sql_uses_catalogs_not_the_filtered_views(self):
        sql = build_catalog_sql(targets_for("create table plm.widget (id int);"))
        self.assertIn("pg_policy ", sql)
        self.assertNotIn("pg_policies", sql)
        self.assertIn("to_regclass", sql)
        self.assertIn("relrowsecurity", sql)
        self.assertIn("aclexplode", sql)
        self.assertIn("pg_get_functiondef", sql)

    def test_function_privileges_are_queried(self):
        # H1: without these the report shows a function existing with a readable
        # definition and says NOTHING about whether its revoke took.
        sql = build_catalog_sql(
            targets_for("create or replace function plm.f() returns int language sql as $$ select 1 $$;")
        )
        self.assertIn("aclexplode(p.proacl)", sql)
        self.assertIn("has_function_privilege", sql)
        self.assertIn("acl_is_default", sql)

    def test_public_grantee_is_named_not_rendered_as_a_dash(self):
        # aclexplode returns OID 0 for PUBLIC, never NULL, and 0::regrole::text
        # renders as a bare `-`. A grant to PUBLIC is the drift class of
        # #664/#649 and must be searchable by name in the artifact.
        sql = build_catalog_sql(targets_for("create table plm.widget (id int);"))
        self.assertIn("a.grantee = 0 then 'PUBLIC'", sql)
        self.assertNotIn("coalesce(a.grantee::regrole::text", sql)

    def test_reloptions_are_read(self):
        # So `security_invoker` on an altered view is observable.
        sql = build_catalog_sql(targets_for("alter view api.v set (security_invoker = true);"))
        self.assertIn("reloptions", sql)

    def test_row_count_sql_is_empty_when_nothing_is_seeded(self):
        self.assertEqual(build_row_count_sql([]), "")

    def test_row_count_sql_names_each_relation(self):
        sql = build_row_count_sql(["plm.a", "plm.b"])
        self.assertIn("from plm.a", sql)
        self.assertIn("from plm.b", sql)
        self.assertIn("union all", sql)

    def test_unsafe_identifiers_are_refused_not_interpolated(self):
        bad = Targets({"plm.widget'; drop table x --"}, set(), set(), set(), set(), set())
        with self.assertRaises(GuardError):
            build_catalog_sql(bad)
        with self.assertRaises(GuardError):
            build_row_count_sql(["plm.x'; drop table y --"])


class ExtractReportTests(unittest.TestCase):
    def test_bare_list_of_rows(self):
        self.assertEqual(extract_report([{"report": {"a": 1}}]), {"a": 1})

    def test_wrapped_in_result_key(self):
        self.assertEqual(extract_report({"result": [{"report": 7}]}), 7)

    def test_empty_result_is_an_error_not_a_pass(self):
        with self.assertRaises(GuardError):
            extract_report([])

    def test_unexpected_shape_is_an_error(self):
        with self.assertRaises(GuardError):
            extract_report([{"something_else": 1}])


class RenderReportTests(unittest.TestCase):
    TARGETS = Targets({"plm.widget"}, set(), {"plm.widget"}, set(), {"anon"}, set())

    def render(self, catalog, enforcing=True, targets=None, errors=None):
        return render_report(
            ["20260810140000"],
            targets or self.TARGETS,
            catalog,
            None,
            errors or [],
            enforcing,
        )

    def test_missing_relation_is_a_hard_failure(self):
        _, failures = self.render(
            {"relations": [{"name": "plm.widget", "to_regclass": None}]}
        )
        self.assertEqual(len(failures), 1)
        self.assertIn("to_regclass is NULL", failures[0])

    def test_present_relation_is_not_a_failure(self):
        _, failures = self.render(
            {"relations": [{"name": "plm.widget", "to_regclass": "plm.widget"}]}
        )
        self.assertEqual(failures, [])

    def test_absent_evidence_is_a_hard_failure(self):
        # The whole point of #697: "no evidence" must never render as
        # "evidence passed".
        _, failures = self.render(None)
        self.assertEqual(len(failures), 1)
        self.assertIn("NO evidence", failures[0])

    def test_nothing_to_check_is_a_hard_failure(self):
        # #697 exists because a green tick was mistaken for evidence. A run in
        # which this step proved NOTHING must not report itself green.
        empty = Targets(set(), set(), set(), set(), set(), set())
        _, failures = self.render(None, targets=empty)
        self.assertEqual(len(failures), 1)
        self.assertIn("proved nothing", failures[0])

    def test_missing_function_is_a_hard_failure(self):
        # The lane knows this expected answer identically to to_regclass: an
        # applied `create or replace function` with nothing in pg_proc.
        _, failures = self.render(
            {
                "relations": [{"name": "plm.widget", "to_regclass": "plm.widget"}],
                "functions": [{"name": "plm.sync_wb_character", "overloads": []}],
            }
        )
        self.assertEqual(len(failures), 1)
        self.assertIn("pg_proc", failures[0])

    def test_present_function_is_not_a_failure(self):
        _, failures = self.render(
            {
                "relations": [{"name": "plm.widget", "to_regclass": "plm.widget"}],
                "functions": [
                    {
                        "name": "plm.f",
                        "overloads": [
                            {
                                "identity": "plm.f(uuid)",
                                "prokind": "f",
                                "has_definition": True,
                                "acl_is_default": False,
                                "acl": [],
                                "execute_held_by": [],
                            }
                        ],
                    }
                ],
            }
        )
        self.assertEqual(failures, [])

    def test_function_privileges_are_rendered_and_never_failed(self):
        markdown, failures = self.render(
            {
                "relations": [{"name": "plm.widget", "to_regclass": "plm.widget"}],
                "functions": [
                    {
                        "name": "plm.load_pmt_capture_chunk",
                        "overloads": [
                            {
                                "identity": "plm.load_pmt_capture_chunk(uuid,text,jsonb)",
                                "prokind": "f",
                                "has_definition": True,
                                # proacl NULL == EXECUTE TO PUBLIC, i.e. the
                                # revoke did NOT take. Reported, not enforced --
                                # the lane has no expected value for it.
                                "acl_is_default": True,
                                "acl": [],
                                "execute_held_by": ["anon", "authenticated", "public"],
                            }
                        ],
                    }
                ],
            }
        )
        self.assertEqual(failures, [])
        self.assertIn("Function privileges", markdown)
        self.assertIn("load_pmt_capture_chunk(uuid,text,jsonb)", markdown)
        self.assertIn("EXECUTE` to `PUBLIC", markdown)

    def test_optional_relation_absence_is_not_a_failure(self):
        # `alter table if exists` says in the SQL that absence is tolerated.
        targets = Targets(set(), set(), set(), set(), set(), set(), {"plm.maybe"})
        _, failures = render_report(
            ["20260810140000"],
            targets,
            {"relations": [{"name": "plm.maybe", "to_regclass": None}]},
            None,
            [],
            True,
        )
        self.assertEqual(failures, [])

    def test_privileges_are_recorded_never_failed(self):
        # A held grant is EVIDENCE. The lane has no expected value for it, and
        # inventing one manufactures false positives that block correct
        # promotions. If this test ever fails, someone made grants blocking --
        # read the module docstring before "fixing" it.
        _, failures = self.render(
            {
                "relations": [{"name": "plm.widget", "to_regclass": "plm.widget"}],
                "effective_privileges": [
                    {"name": "plm.widget", "role": "anon", "privilege": "MAINTAIN"}
                ],
                "acl": [
                    {
                        "name": "plm.widget",
                        "grantee": "service_role",
                        "privilege": "TRUNCATE",
                        "grantor": "postgres",
                    }
                ],
            }
        )
        self.assertEqual(failures, [])

    def test_rls_off_is_recorded_never_failed(self):
        markdown, failures = self.render(
            {
                "relations": [{"name": "plm.widget", "to_regclass": "plm.widget"}],
                "row_security": [
                    {
                        "name": "plm.widget",
                        "exists": True,
                        "relrowsecurity": False,
                        "policy_count": 0,
                        "policies": [],
                    }
                ],
            }
        )
        self.assertEqual(failures, [])
        self.assertIn("relrowsecurity", "".join(markdown.splitlines()[:0]) or markdown)

    def test_report_states_its_own_limits(self):
        markdown, _ = self.render({"relations": []})
        self.assertIn("not a clean bill of health", markdown)
        self.assertIn("EVIDENCE", markdown)

    def test_record_mode_is_labelled_in_the_artifact(self):
        markdown, _ = self.render({"relations": []}, enforcing=False)
        self.assertIn("RECORD ONLY", markdown)

    def test_errors_are_rendered(self):
        markdown, _ = self.render(
            {"relations": []}, errors=["row-count query failed: boom"]
        )
        self.assertIn("row-count query failed: boom", markdown)


class SplitStatementTests(unittest.TestCase):
    def test_semicolons_inside_stripped_constructs_cannot_split(self):
        raw = (
            "create table plm.a (id int);\n"
            "-- a comment with ; inside\n"
            "create function plm.f() returns int language sql as $$ select 1; $$;\n"
            "comment on table plm.a is 'has ; inside';\n"
            "create table plm.b (id int);"
        )
        heads = [s.strip().split()[0] for s in split_statements(strip_sql(raw))]
        self.assertEqual(heads.count("create"), 3)
        self.assertIn("comment", heads)


if __name__ == "__main__":
    unittest.main()
