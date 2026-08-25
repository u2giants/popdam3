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
from unittest import mock
import io
import json
import sys
import tempfile
import unittest
import urllib.error

sys.path.insert(0, str(Path(__file__).resolve().parent))

from production_catalog_verification import (  # noqa: E402
    USER_AGENT,
    build_query_request,
    read_error_body,
    run_query,
    ALWAYS_PROBED_ROLES,
    BASE_PRIVILEGES,
    MAINTAIN_PRIVILEGE,
    PrivilegeExpectation,
    Targets,
    _objtype_array,
    assert_privileges,
    build_catalog_sql,
    build_behavior_sql,
    build_row_count_sql,
    derive_targets,
    extract_report,
    parse_dynamic_acl,
    load_behavior_sidecars,
    render_report,
    split_statements,
    verify,
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


def collapse_ws(sql: str) -> str:
    """Collapse every run of whitespace to one space.

    ISSUE #702 POINT 1. The two SQL lines the whole function-privilege
    verification rests on were pinned only by loose substring assertions, so an
    edit that changed the PREDICATE to something wrong still passed green. The
    fix is to assert the exact predicate -- but the exact predicate is indented
    differently in each ACL block, and re-indenting the SQL is not a defect.
    Normalising whitespace first is what makes an exact-text assertion both
    strict about semantics and tolerant of reformatting.
    """
    return " ".join(sql.split())


# ISSUE #702 POINT 1. `case when a.grantee = 0 then 'PUBLIC' ...` is the line
# that makes a grant-to-everyone searchable by name instead of rendering as a
# bare `-`. It appears once in EACH of the three ACL blocks the catalog query
# builds, and that is exactly why a bare `assertIn` proved nothing: break the
# copy in one block and the other two keep the substring alive. Pinning the
# COUNT is what makes each block's copy individually load-bearing. If a fourth
# ACL block is ever added, raise this deliberately -- do not loosen the check.
PUBLIC_GRANTEE_EXPR = (
    "'grantee', case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end"
)
PUBLIC_GRANTEE_BLOCKS = 3


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

    def test_expression_index_is_derived_with_exact_table(self):
        t = targets_for(
            "create index if not exists item_upper_trim_item_number_idx "
            "on plm.item ((upper(trim(item_number))));"
        )
        self.assertEqual(
            t.indexes,
            [("plm.item_upper_trim_item_number_idx", "plm.item")],
        )
        self.assertIn("plm.item", t.tables)
        self.assertFalse(t.is_empty())

    def test_unique_concurrent_index_is_derived(self):
        t = targets_for(
            "create unique index concurrently if not exists widget_code_idx "
            "on plm.widget (code);"
        )
        self.assertEqual(t.indexes, [("plm.widget_code_idx", "plm.widget")])

    def test_unsupported_index_forms_are_not_silently_dropped(self):
        for sql in (
            'create index "MixedCase" on plm.widget (id);',
            "create index widget_idx on widget (id);",
            "create index on plm.widget (id);",
        ):
            with self.subTest(sql=sql):
                t = targets_for(sql)
                self.assertEqual(t.indexes, [])
                self.assertTrue(
                    any("not safely parseable" in note for note in t.notes),
                    t.notes,
                )

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

    def test_catalog_sql_reads_exact_index_definition_and_state(self):
        sql = build_catalog_sql(
            targets_for(
                "create index if not exists widget_expr_idx "
                "on plm.widget ((upper(trim(code))));"
            )
        )
        self.assertIn("pg_get_indexdef", sql)
        self.assertIn("pg_index", sql)
        self.assertIn("indisvalid", sql)
        self.assertIn("indisready", sql)
        self.assertIn("plm.widget_expr_idx", sql)

    def test_function_privileges_are_queried(self):
        # H1: without these the report shows a function existing with a readable
        # definition and says NOTHING about whether its revoke took.
        sql = build_catalog_sql(
            targets_for("create or replace function plm.f() returns int language sql as $$ select 1 $$;")
        )
        self.assertIn("aclexplode(p.proacl)", sql)
        self.assertIn("has_function_privilege", sql)

        # ISSUE #702 POINT 1. `assertIn("acl_is_default", sql)` only proved the
        # LABEL was present, never the predicate behind it. `proacl is null`
        # means DEFAULT privileges, and for a function the default is EXECUTE
        # to PUBLIC -- exactly the state a missing `revoke` leaves behind. Get
        # the polarity or the column wrong and a Paramount promotion whose
        # revoke silently failed produces a report that reads clean. So assert
        # the whole predicate including the trailing comma, which pins the
        # column, the polarity and the field it is bound to. The inverted form
        # is asserted absent as well: it is the one wrong edit a reviewer is
        # most likely to wave through, and it reverses the meaning of every
        # HARD FAIL downstream.
        normalised = collapse_ws(sql)
        self.assertIn("'acl_is_default', p.proacl is null,", normalised)
        self.assertNotIn("'acl_is_default', p.proacl is not null", normalised)

        # The label and the predicate must stay welded to the function ACL
        # block: a correct predicate reported under the wrong object is the
        # same misread with extra steps.
        self.assertIn(
            "'acl_is_default', p.proacl is null, 'acl', coalesce(( select jsonb_agg(jsonb_build_object( "
            + PUBLIC_GRANTEE_EXPR,
            normalised,
        )

    def test_public_grantee_is_named_not_rendered_as_a_dash(self):
        # aclexplode returns OID 0 for PUBLIC, never NULL, and 0::regrole::text
        # renders as a bare `-`. A grant to PUBLIC is the drift class of
        # #664/#649 and must be searchable by name in the artifact.
        sql = build_catalog_sql(targets_for("create table plm.widget (id int);"))
        normalised = collapse_ws(sql)

        # ISSUE #702 POINT 1. The old assertion was `assertIn("a.grantee = 0
        # then 'PUBLIC'", sql)`. Three other copies of that literal live in the
        # same query, so breaking any ONE block's copy left the substring alive
        # and all tests green. Assert the FULL expression -- including the
        # `else` branch that does the regrole lookup, which is the half that
        # actually renders a named role -- and assert it appears once per ACL
        # block, so each copy is individually load-bearing.
        self.assertEqual(
            normalised.count(PUBLIC_GRANTEE_EXPR),
            PUBLIC_GRANTEE_BLOCKS,
            "the PUBLIC grantee expression must appear intact in every ACL "
            "block; a changed count means a block lost it, gained a variant, "
            "or a new ACL block was added without pinning it here",
        )

        # The grantor side renders from the same aclexplode OID space and has
        # the same bare-dash failure, so it is pinned identically.
        self.assertEqual(
            normalised.count(
                "'grantor', case when a.grantor = 0 then 'PUBLIC' "
                "else a.grantor::regrole::text end"
            ),
            PUBLIC_GRANTEE_BLOCKS,
            "the PUBLIC grantor expression must appear intact in every ACL block",
        )

        # The rejected shape: `coalesce` cannot rescue this, because aclexplode
        # returns OID 0 for PUBLIC and never NULL, so the coalesce never fires
        # and PUBLIC renders as a bare `-`.
        self.assertNotIn("coalesce(a.grantee::regrole::text", sql)
        self.assertNotIn("coalesce(a.grantor::regrole::text", sql)

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


class RecoveryWorkflowTests(unittest.TestCase):
    def test_current_and_historical_main_are_bound_separately(self):
        workflow = (
            REPO / ".github" / "workflows" /
            "production-catalog-verification-recovery.yml"
        ).read_text(encoding="utf-8")
        self.assertIn('MAIN_SHA: "${{ inputs.main_sha }}"', workflow)
        self.assertIn('APPLY_MAIN_SHA: ${{ inputs.apply_main_sha }}', workflow)
        self.assertIn('git rev-parse origin/main)" = "$MAIN_SHA"', workflow)
        self.assertIn('jq -r .head_sha <<<"$run")" = "$APPLY_MAIN_SHA"', workflow)
        self.assertIn('production-migration-apply-$APPLY_MAIN_SHA', workflow)
        self.assertNotIn('production-migration-apply-$MAIN_SHA', workflow)


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

    def test_index_definition_is_reported_and_enforced(self):
        targets = targets_for(
            "create index if not exists widget_expr_idx "
            "on plm.widget ((upper(trim(code))));"
        )
        catalog = {
            "indexes": [{
                "name": "plm.widget_expr_idx",
                "relation": "plm.widget",
                "exists": True,
                "actual_relation": "plm.widget",
                "valid": True,
                "ready": True,
                "definition": "CREATE INDEX widget_expr_idx ON plm.widget USING btree (upper(TRIM(BOTH FROM code)))",
            }],
            "relations": [{"name": "plm.widget", "to_regclass": "plm.widget"}],
        }
        report, failures = self.render(catalog, targets=targets)
        self.assertEqual(failures, [])
        self.assertIn("CREATE INDEX widget_expr_idx", report)

    def test_missing_or_wrong_table_index_fails(self):
        targets = targets_for("create index widget_idx on plm.widget (id);")
        for row in (
            {"name": "plm.widget_idx", "exists": False},
            {"name": "plm.widget_idx", "exists": True,
             "actual_relation": "plm.other", "valid": True, "ready": True,
             "definition": "CREATE INDEX widget_idx ON plm.other USING btree (id)"},
        ):
            with self.subTest(row=row):
                _, failures = self.render(
                    {"indexes": [row], "relations": [
                        {"name": "plm.widget", "to_regclass": "plm.widget"}
                    ]},
                    targets=targets,
                )
                self.assertTrue(failures)

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


class OutgoingRequestTests(unittest.TestCase):
    """Issue #709: no network here -- only the constructed request is inspected."""

    def request(self):
        return build_query_request("abc123", "token-value", "select 1")

    def test_user_agent_is_explicit_and_not_the_urllib_default(self):
        ua = self.request().get_header("User-agent")
        self.assertTrue(ua)
        self.assertNotIn("Python-urllib", ua)
        self.assertEqual(ua, USER_AGENT)

    def test_user_agent_constant_is_descriptive(self):
        self.assertTrue(USER_AGENT.strip())
        self.assertNotIn("Python-urllib", USER_AGENT)

    def test_request_still_carries_auth_and_read_only(self):
        request = self.request()
        self.assertEqual(request.get_header("Authorization"), "Bearer token-value")
        self.assertEqual(request.method, "POST")
        self.assertTrue(json.loads(request.data.decode("utf-8"))["read_only"])
        self.assertIn("/v1/projects/abc123/database/query", request.full_url)


class HTTPErrorReportingTests(unittest.TestCase):
    """The failure message must carry the status AND the body."""

    @staticmethod
    def http_error(body):
        return urllib.error.HTTPError(
            "https://api.supabase.com/v1/projects/abc123/database/query",
            403,
            "Forbidden",
            {},
            io.BytesIO(body) if isinstance(body, bytes) else body,
        )

    def run_with_error(self, exc):
        with mock.patch(
            "production_catalog_verification.urllib.request.urlopen", side_effect=exc
        ):
            with self.assertRaises(GuardError) as caught:
                run_query("abc123", "token-value", "select 1")
        return str(caught.exception)

    def test_status_and_body_are_both_reported(self):
        message = self.run_with_error(
            self.http_error(b'{"error":"error code: 1010"}')
        )
        self.assertIn("403", message)
        self.assertIn("1010", message)
        self.assertIn("/v1/projects/abc123/database/query", message)

    def test_unreadable_body_does_not_mask_the_error(self):
        class Exploding:
            def read(self, *args):
                raise OSError("stream gone")

            def close(self):
                pass

        message = self.run_with_error(self.http_error(Exploding()))
        self.assertIn("403", message)
        self.assertIn("unreadable", message)

    def test_empty_body_is_labelled(self):
        self.assertIn("empty response body", read_error_body(self.http_error(b"")))

    def test_failure_is_still_raised_not_swallowed(self):
        """Change #709 makes the failure louder, never more forgiving."""
        with mock.patch(
            "production_catalog_verification.urllib.request.urlopen",
            side_effect=self.http_error(b"nope"),
        ):
            with self.assertRaises(GuardError):
                run_query("abc123", "token-value", "select 1")


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


class PrivilegeDerivationTests(unittest.TestCase):
    """Issue #790 point 1: privilege-shaped migrations must derive targets."""

    def test_alter_default_privileges_is_derived(self):
        t = targets_for(
            "alter default privileges for role postgres in schema plm\n"
            "  revoke truncate, references, trigger, maintain on tables "
            "from service_role;"
        )
        self.assertFalse(t.is_empty(), "the #790 migration shape derived nothing")
        self.assertEqual(t.default_acls, [("plm", "postgres", "r")])
        self.assertEqual(len(t.privileges), 1)
        expectation = t.privileges[0]
        self.assertEqual(expectation.kind, "default_acl")
        self.assertEqual(expectation.grantee, "service_role")
        self.assertFalse(expectation.expect_held)
        self.assertEqual(
            expectation.privileges, ("MAINTAIN", "REFERENCES", "TRIGGER", "TRUNCATE")
        )

    def test_the_real_migration_that_failed_now_derives_an_assertion(self):
        """20260810180000 is the file whose CORRECT apply went red."""
        from production_migration_guard import local_migrations

        t = derive_targets(local_migrations(REPO), ["20260810180000"])
        self.assertFalse(t.is_empty())
        self.assertIn(("plm", "postgres", "r"), t.default_acls)

    def test_default_privileges_without_for_role_is_recorded_not_guessed(self):
        t = targets_for(
            "alter default privileges in schema plm grant select on tables to anon;"
        )
        self.assertEqual(t.privileges, [])
        self.assertTrue(any("for role" in n for n in t.notes))

    def test_default_privileges_without_schema_is_recorded_not_guessed(self):
        t = targets_for(
            "alter default privileges for role postgres grant select on tables "
            "to anon;"
        )
        self.assertEqual(t.privileges, [])
        self.assertTrue(any("in schema" in n for n in t.notes))

    def test_grant_on_table_is_derived(self):
        t = targets_for("grant select, insert on plm.widget to anon;")
        self.assertEqual(len(t.privileges), 1)
        e = t.privileges[0]
        self.assertEqual((e.kind, e.target, e.grantee), ("relation", "plm.widget", "anon"))
        self.assertTrue(e.expect_held)
        self.assertIn("plm.widget", t.tables)

    def test_revoke_on_function_is_derived_and_the_routine_is_required(self):
        t = targets_for(
            "revoke all on function plm.load_pmt_capture_chunk(bigint, jsonb) "
            "from public, anon, authenticated;"
        )
        self.assertIn("plm.load_pmt_capture_chunk", t.functions)
        grantees = {e.grantee for e in t.privileges}
        self.assertEqual(grantees, {"PUBLIC", "anon", "authenticated"})
        self.assertTrue(all(e.kind == "function" for e in t.privileges))
        self.assertTrue(all(not e.expect_held for e in t.privileges))

    def test_all_tables_in_schema_is_recorded_not_invented(self):
        t = targets_for("grant select on all tables in schema plm to anon;")
        self.assertEqual(t.privileges, [])
        self.assertTrue(any("not modelled" in n for n in t.notes))

    def test_column_level_grant_is_recorded_not_guessed(self):
        t = targets_for("grant select (a, b) on plm.widget to anon;")
        self.assertEqual(t.privileges, [])
        self.assertTrue(any("column-level" in n for n in t.notes))

    def test_all_expands_per_object_type(self):
        table = PrivilegeExpectation("relation", "plm.w", "anon", ("ALL",), False, "v")
        self.assertIn("TRUNCATE", table.expand(maintain_probed=False))
        self.assertNotIn("MAINTAIN", table.expand(maintain_probed=False))
        self.assertIn("MAINTAIN", table.expand(maintain_probed=True))
        fn = PrivilegeExpectation("function", "plm.f", "anon", ("ALL",), False, "v", "f")
        self.assertEqual(fn.expand(maintain_probed=True), ("EXECUTE",))

    def test_default_acl_targets_reach_the_sql(self):
        t = targets_for(
            "alter default privileges for role postgres in schema plm "
            "revoke truncate on tables from service_role;"
        )
        sql = build_catalog_sql(t)
        self.assertIn("pg_default_acl", sql)
        self.assertIn("'plm'", sql)
        self.assertIn("'postgres'", sql)
        self.assertIn("'r'", sql)
        self.assertEqual(sql.count(";"), 0)

    def test_objtype_array_refuses_an_unknown_code(self):
        with self.assertRaises(GuardError):
            _objtype_array(["r; drop table x"])


class PrivilegeAssertionTests(unittest.TestCase):
    """Issue #790 point 2: assert the end state, do not merely print an ACL."""

    def assert_for(self, sql, catalog):
        return assert_privileges(targets_for(sql), catalog)

    DEFACL_SQL = (
        "alter default privileges for role postgres in schema plm "
        "revoke truncate, references, trigger, maintain on tables "
        "from service_role;"
    )

    def defacl_catalog(self, privileges, row_exists=True, objtype="r"):
        return {
            "maintain_probed": True,
            "probe_roles": ["anon", "authenticated", "public", "service_role"],
            "default_acl": [
                {
                    "schema": "plm",
                    "defacl_role": "postgres",
                    "objtype": objtype,
                    "role_exists": True,
                    "row_exists": row_exists,
                    "acl_text": "{...}",
                    "acl": [
                        {"grantee": "service_role", "privilege": p}
                        for p in privileges
                    ],
                }
            ],
        }

    def test_the_production_end_state_passes(self):
        """`{service_role=arwd/postgres}` — the state the apply actually left."""
        rows, failures = self.assert_for(
            self.DEFACL_SQL,
            self.defacl_catalog(["INSERT", "SELECT", "UPDATE", "DELETE"]),
        )
        self.assertEqual(failures, [])
        self.assertEqual([r[1] for r in rows], ["PASS"])

    def test_the_pre_apply_state_fails(self):
        """`{service_role=arwdDxtm/postgres}` — the revoke did NOT take."""
        rows, failures = self.assert_for(
            self.DEFACL_SQL,
            self.defacl_catalog(
                [
                    "INSERT",
                    "SELECT",
                    "UPDATE",
                    "DELETE",
                    "TRUNCATE",
                    "REFERENCES",
                    "TRIGGER",
                    "MAINTAIN",
                ]
            ),
        )
        self.assertEqual([r[1] for r in rows], ["FAIL"])
        self.assertIn("STILL in the default privileges", failures[0])

    def test_a_public_default_grant_defeats_a_role_revoke(self):
        catalog = self.defacl_catalog(["SELECT"])
        catalog["default_acl"][0]["acl"].append(
            {"grantee": "PUBLIC", "privilege": "TRUNCATE"}
        )
        _, failures = self.assert_for(self.DEFACL_SQL, catalog)
        self.assertEqual(len(failures), 1)
        self.assertIn("TRUNCATE", failures[0])

    def test_missing_default_acl_row_for_functions_is_execute_to_public(self):
        """#790 point 4, the default-privilege half of the blind spot."""
        _, failures = self.assert_for(
            "alter default privileges for role postgres in schema plm "
            "revoke execute on functions from public;",
            self.defacl_catalog([], row_exists=False, objtype="f"),
        )
        self.assertEqual(len(failures), 1)
        self.assertIn("BUILT-IN default", failures[0])

    def test_missing_default_acl_row_for_tables_is_owner_only(self):
        _, failures = self.assert_for(
            self.DEFACL_SQL, self.defacl_catalog([], row_exists=False)
        )
        self.assertEqual(failures, [])

    def test_a_default_acl_row_that_could_not_be_read_is_a_failure(self):
        _, failures = self.assert_for(
            self.DEFACL_SQL, {"maintain_probed": True, "default_acl": []}
        )
        self.assertEqual(len(failures), 1)
        self.assertIn("not read back", failures[0])

    # -- relations ---------------------------------------------------------
    def relation_catalog(self, held, owner="postgres"):
        return {
            "maintain_probed": True,
            "probe_roles": ["anon", "authenticated", "public", "service_role"],
            "relations": [
                {
                    "name": "plm.widget",
                    "to_regclass": "plm.widget",
                    "owner": owner,
                }
            ],
            "effective_privileges": [
                {"name": "plm.widget", "role": "service_role", "privilege": p}
                for p in held
            ],
        }

    def test_relation_revoke_that_took_passes(self):
        _, failures = self.assert_for(
            "revoke truncate on plm.widget from service_role;",
            self.relation_catalog(["SELECT"]),
        )
        self.assertEqual(failures, [])

    def test_relation_revoke_that_did_not_take_fails(self):
        _, failures = self.assert_for(
            "revoke truncate on plm.widget from service_role;",
            self.relation_catalog(["SELECT", "TRUNCATE"]),
        )
        self.assertEqual(len(failures), 1)
        self.assertIn("STILL HELD", failures[0])

    def test_relation_grant_that_did_not_take_fails(self):
        _, failures = self.assert_for(
            "grant select on plm.widget to service_role;",
            self.relation_catalog([]),
        )
        self.assertEqual(len(failures), 1)
        self.assertIn("not held after the apply", failures[0])

    def public_relation_catalog(self, held_by_public):
        """PUBLIC's effective privileges as the SQL actually reports them.

        The `probe_roles` CTE probes the pseudo-role under its literal lowercase
        name `public`, so `effective_privileges` rows carry `role = 'public'`.
        `PrivilegeExpectation` normalises the grantee to `PUBLIC`. If the lookup
        does not fold the two together, PUBLIC matches nothing and every revoke
        reads green while every grant reads red.
        """
        catalog = self.relation_catalog([])
        catalog["effective_privileges"] = [
            {"name": "plm.widget", "role": "public", "privilege": p}
            for p in held_by_public
        ]
        return catalog

    def test_public_revoke_that_did_not_take_fails(self):
        """The silent-pass direction: PUBLIC still holds it, and it must FAIL."""
        rows, failures = self.assert_for(
            "revoke truncate on plm.widget from public;",
            self.public_relation_catalog(["SELECT", "TRUNCATE"]),
        )
        self.assertEqual([r[1] for r in rows], ["FAIL"])
        self.assertEqual(len(failures), 1)
        self.assertIn("STILL HELD", failures[0])
        self.assertIn("TRUNCATE", failures[0])

    def test_public_grant_that_took_passes(self):
        """The false-negative direction: a correct apply must not be blocked."""
        rows, failures = self.assert_for(
            "grant select on plm.widget to public;",
            self.public_relation_catalog(["SELECT"]),
        )
        self.assertEqual(failures, [])
        self.assertEqual([r[1] for r in rows], ["PASS"])

    def test_owner_is_recorded_with_a_reason_not_failed(self):
        rows, failures = self.assert_for(
            "revoke truncate on plm.widget from service_role;",
            self.relation_catalog(["TRUNCATE"], owner="service_role"),
        )
        self.assertEqual(failures, [])
        self.assertEqual(rows[0][1], "RECORD")
        self.assertIn("OWNS", rows[0][2])

    # -- functions ---------------------------------------------------------
    def function_catalog(self, overloads):
        return {
            "maintain_probed": True,
            "probe_roles": ["anon", "authenticated", "public", "service_role"],
            "functions": [{"name": "plm.f", "overloads": overloads}],
        }

    def test_null_proacl_is_execute_to_public_not_no_grants(self):
        """ISSUE #790 POINT 4 — the whole point: NULL must not read as safe."""
        rows, failures = self.assert_for(
            "revoke all on function plm.f(bigint) from public;",
            self.function_catalog(
                [
                    {
                        "identity": "plm.f(bigint)",
                        "owner": "postgres",
                        "acl_is_default": True,
                        "acl": [],
                        "execute_held_by": [],
                    }
                ]
            ),
        )
        self.assertEqual(rows[0][1], "FAIL")
        self.assertIn("EXECUTE TO PUBLIC", failures[0])

    def test_a_function_revoke_that_took_passes(self):
        _, failures = self.assert_for(
            "revoke all on function plm.f(bigint) from public;",
            self.function_catalog(
                [
                    {
                        "identity": "plm.f(bigint)",
                        "owner": "postgres",
                        "acl_is_default": False,
                        "acl": [{"grantee": "postgres", "privilege": "EXECUTE"}],
                        "execute_held_by": ["service_role"],
                    }
                ]
            ),
        )
        self.assertEqual(failures, [])

    def test_a_role_that_still_holds_execute_fails(self):
        _, failures = self.assert_for(
            "revoke all on function plm.f(bigint) from anon;",
            self.function_catalog(
                [
                    {
                        "identity": "plm.f(bigint)",
                        "owner": "postgres",
                        "acl_is_default": False,
                        "acl": [{"grantee": "anon", "privilege": "EXECUTE"}],
                        "execute_held_by": ["anon"],
                    }
                ]
            ),
        )
        self.assertEqual(len(failures), 1)
        self.assertIn("STILL holds EXECUTE", failures[0])

    def test_ambiguous_overloads_record_a_grant_with_the_reason(self):
        rows, failures = self.assert_for(
            "grant execute on function plm.f(bigint) to anon;",
            self.function_catalog(
                [
                    {"identity": "plm.f(bigint)", "acl_is_default": False,
                     "acl": [], "execute_held_by": ["anon"]},
                    {"identity": "plm.f(text)", "acl_is_default": False,
                     "acl": [], "execute_held_by": []},
                ]
            ),
        )
        self.assertEqual(failures, [])
        self.assertEqual(rows[0][1], "RECORD")
        self.assertIn("overloads", rows[0][2])


class PrivilegeOrderTests(unittest.TestCase):
    """A batch may grant then revoke. Only the LAST statement is the end state."""

    SQL = (
        "grant truncate on plm.widget to service_role;\n"
        "revoke truncate on plm.widget from service_role;\n"
    )

    def catalog(self, held):
        return {
            "maintain_probed": True,
            "probe_roles": ["service_role"],
            "relations": [
                {"name": "plm.widget", "to_regclass": "plm.widget", "owner": "postgres"}
            ],
            "effective_privileges": [
                {"name": "plm.widget", "role": "service_role", "privilege": p}
                for p in held
            ],
        }

    def test_derivation_keeps_statement_order(self):
        t = targets_for(self.SQL)
        self.assertEqual([e.expect_held for e in t.privileges], [True, False])

    def test_the_later_revoke_wins_and_the_run_is_green(self):
        rows, failures = assert_privileges(targets_for(self.SQL), self.catalog([]))
        self.assertEqual(failures, [])
        self.assertIn("RECORD", [r[1] for r in rows])
        self.assertIn("PASS", [r[1] for r in rows])

    def test_the_later_revoke_is_still_asserted(self):
        _, failures = assert_privileges(
            targets_for(self.SQL), self.catalog(["TRUNCATE"])
        )
        self.assertEqual(len(failures), 1)
        self.assertIn("STILL HELD", failures[0])


class NoopDeclarationTests(unittest.TestCase):
    """Issue #790 point 3: a genuine no-op needs a recorded, CHECKED reason."""

    DATA_ONLY = (
        "-- catalog-verification: no-op corrects three mistyped rows only, "
        "touches no catalog object\n"
        "update plm.widget set name = 'x' where id = 1;\n"
        "delete from plm.widget where id = 2;\n"
    )

    def render(self, sql):
        targets = targets_for(sql)
        return targets, render_report(
            ["20260810140000"], targets, {"relations": []}, None, [], True
        )

    def test_an_undeclared_empty_migration_still_fails(self):
        targets, (markdown, failures) = self.render("update plm.widget set a = 1;")
        self.assertTrue(targets.is_empty())
        self.assertEqual(len(failures), 1)
        self.assertIn("proved nothing", failures[0])

    def test_a_declared_and_checked_no_op_passes_with_its_reason_recorded(self):
        targets, (markdown, failures) = self.render(self.DATA_ONLY)
        self.assertEqual(failures, [])
        self.assertTrue(targets.noop_declaration["accepted"])
        self.assertIn("Declared no-op", markdown)
        self.assertIn("mistyped rows", markdown)

    def test_the_declaration_cannot_excuse_a_privilege_migration(self):
        """The escape hatch is CHECKED, so it is not a bypass flag."""
        sql = (
            "-- catalog-verification: no-op this file changes nothing at all, "
            "honestly\n"
            "alter default privileges for role postgres in schema plm "
            "revoke truncate on tables from service_role;\n"
        )
        targets = targets_for(sql)
        self.assertFalse(targets.noop_declaration["accepted"])
        self.assertFalse(targets.is_empty())
        _, failures = render_report(
            ["20260810140000"], targets, {"relations": []}, None, [], True
        )
        self.assertTrue(any("claim is false" in f for f in failures))

    def test_a_declaration_over_ddl_is_rejected_and_the_run_still_fails(self):
        sql = (
            "-- catalog-verification: no-op nothing to see here at all, move along\n"
            "do $$ begin perform 1; end $$;\n"
        )
        targets, (_, failures) = self.render(sql)
        self.assertTrue(targets.is_empty())
        self.assertFalse(targets.noop_declaration["accepted"])
        self.assertEqual(len(failures), 1)
        self.assertIn("REJECTED", failures[0])

    def test_a_reasonless_declaration_is_rejected(self):
        targets = targets_for(
            "-- catalog-verification: no-op meh\nupdate plm.widget set a = 1;"
        )
        self.assertFalse(targets.noop_declaration["accepted"])

    def test_verify_records_the_reason_in_the_json_payload(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            migrations = root / "supabase" / "migrations"
            migrations.mkdir(parents=True)
            (migrations / "20260810140000_data.sql").write_text(
                self.DATA_ONLY, encoding="utf-8"
            )
            out = root / "out"
            code = verify(
                root,
                "20260810140000",
                out,
                "abc123",
                "token-value",
                enforcing=True,
            )
            payload = json.loads(
                (out / "production-catalog-verification.json").read_text("utf-8")
            )
        self.assertEqual(code, 0)
        self.assertTrue(payload["noop_declaration"]["accepted"])
        self.assertTrue(any("DECLARES itself" in e for e in payload["errors"]))


class BehavioralSidecarTests(unittest.TestCase):
    VERSION = "20260101000000"
    SQL = "do $$ begin update core.property set name = 'x'; end $$;\n"

    def fixture(self, sidecar_changes=None, sql=None):
        temp = tempfile.TemporaryDirectory()
        root = Path(temp.name)
        migrations = root / "supabase" / "migrations"
        sidecars = root / "scripts" / "production-verification-sidecars"
        migrations.mkdir(parents=True)
        sidecars.mkdir(parents=True)
        migration = migrations / f"{self.VERSION}_data.sql"
        migration.write_text(sql or self.SQL, encoding="utf-8")
        import hashlib
        sidecar = {
            "schema_version": 1,
            "migration_version": self.VERSION,
            "migration_sha256": hashlib.sha256(
                migration.read_bytes().replace(b"\r\n", b"\n")
            ).hexdigest(),
            "checks": [{
                "id": "property_has_expected_parent",
                "kind": "exact_row_count",
                "relation": "core.property",
                "filters": [
                    {"column": "id", "type": "uuid",
                     "equals": "5c03fc46-5a02-4da1-bcac-8969e74bbd8f"},
                    {"column": "name", "type": "text", "equals": "O'Reilly"},
                ],
                "expected_count": 1,
            }],
        }
        if sidecar_changes:
            sidecar_changes(sidecar)
        (sidecars / f"{self.VERSION}.json").write_text(
            json.dumps(sidecar), encoding="utf-8"
        )
        return temp, root, migration

    def load(self, root, migration):
        return load_behavior_sidecars(
            root, {self.VERSION: migration}, [self.VERSION]
        )

    def test_positive_sidecar_is_hash_bound_and_builds_select_only(self):
        temp, root, migration = self.fixture()
        with temp:
            checks = self.load(root, migration)
            sql = build_behavior_sql(checks)
        self.assertTrue(sql.lower().startswith("select "))
        self.assertNotIn(";", sql[:-1])
        self.assertIn("from core.property", sql)
        self.assertIn("O''Reilly", sql)
        self.assertNotIn("do $$", sql.lower())

    def test_changed_migration_invalidates_the_sidecar_hash(self):
        temp, root, migration = self.fixture()
        with temp:
            migration.write_text(self.SQL + "-- changed\n", encoding="utf-8")
            with self.assertRaisesRegex(GuardError, "hash mismatch"):
                self.load(root, migration)

    def test_crlf_and_lf_have_the_same_canonical_hash(self):
        temp, root, migration = self.fixture()
        with temp:
            sidecar_path = (
                root / "scripts" / "production-verification-sidecars"
                / f"{self.VERSION}.json"
            )
            expected = json.loads(sidecar_path.read_text("utf-8"))["migration_sha256"]
            migration.write_bytes(migration.read_bytes().replace(b"\r\n", b"\n"))
            checks = self.load(root, migration)
        self.assertEqual(checks[0]["migration_sha256"], expected)

    def test_unknown_sidecar_field_fails_closed(self):
        temp, root, migration = self.fixture(lambda s: s.update({"sql": "select 1"}))
        with temp, self.assertRaisesRegex(GuardError, "unknown=.*sql"):
            self.load(root, migration)

    def test_arbitrary_sql_cannot_be_supplied_as_a_check_kind(self):
        def change(sidecar):
            sidecar["checks"][0]["kind"] = "sql"
        temp, root, migration = self.fixture(change)
        with temp, self.assertRaisesRegex(GuardError, "unsupported check kind"):
            self.load(root, migration)

    def test_catalog_contract_is_named_hash_bound_and_select_only(self):
        def change(sidecar):
            sidecar["checks"] = [{
                "id": "popdam_final_marker",
                "kind": "catalog_contract",
                "contract": "popdam_1427_active_marker_v1",
                "expected_count": 1,
            }]
        temp, root, migration = self.fixture(change)
        with temp:
            checks = self.load(root, migration)
            sql = build_behavior_sql(checks)
        self.assertIn("col_description", sql)
        self.assertIn("final #1427 contract active", sql)
        self.assertNotIn("pg_temp.popdam_1479", sql)
        self.assertTrue(sql.lower().startswith("select "))

    def test_unknown_catalog_contract_and_extra_sql_fail_closed(self):
        def unknown(sidecar):
            sidecar["checks"] = [{
                "id": "unknown_contract",
                "kind": "catalog_contract",
                "contract": "invented_contract",
                "expected_count": 1,
            }]
        temp, root, migration = self.fixture(unknown)
        with temp, self.assertRaisesRegex(GuardError, "unsupported catalog contract"):
            self.load(root, migration)

        def injected(sidecar):
            sidecar["checks"] = [{
                "id": "injected_contract",
                "kind": "catalog_contract",
                "contract": "popdam_1427_active_marker_v1",
                "expected_count": 1,
                "sql": "select true",
            }]
        temp, root, migration = self.fixture(injected)
        with temp, self.assertRaisesRegex(GuardError, "unknown=.*sql"):
            self.load(root, migration)

    def test_pg_temp_objects_are_not_durable_catalog_targets(self):
        sql = (
            "create table pg_temp.popdam_cursor(id uuid);\n"
            "create function pg_temp.popdam_helper() returns void language sql as $$ select $$;\n"
            "create table public.durable_popdam(id uuid);\n"
        )
        temp, root, migration = self.fixture(sql=sql)
        with temp:
            targets = derive_targets({self.VERSION: migration}, [self.VERSION])
        self.assertNotIn("pg_temp.popdam_cursor", targets.tables)
        self.assertNotIn("pg_temp.popdam_helper", targets.functions)
        self.assertIn("public.durable_popdam", targets.tables)
        self.assertTrue(any("session-temporary" in note for note in targets.notes))

    def test_unsafe_relation_and_column_identifiers_fail_closed(self):
        def relation(sidecar):
            sidecar["checks"][0]["relation"] = "core.property; drop table x"
        temp, root, migration = self.fixture(relation)
        with temp, self.assertRaisesRegex(GuardError, "invalid relation"):
            self.load(root, migration)

        def column(sidecar):
            sidecar["checks"][0]["filters"][0]["column"] = "id) or true --"
        temp, root, migration = self.fixture(column)
        with temp, self.assertRaisesRegex(GuardError, "invalid column"):
            self.load(root, migration)

    def test_wrong_value_type_fails_closed(self):
        def change(sidecar):
            sidecar["checks"][0]["filters"][0]["equals"] = "not-a-uuid"
        temp, root, migration = self.fixture(change)
        with temp, self.assertRaisesRegex(GuardError, "invalid UUID"):
            self.load(root, migration)

    def test_missing_and_wrong_behavior_results_fail(self):
        temp, root, migration = self.fixture()
        with temp:
            checks = self.load(root, migration)
            targets = derive_targets({self.VERSION: migration}, [self.VERSION])
            _, missing = render_report(
                [self.VERSION], targets, None, None, [], True,
                behavior_checks=checks, behavior_results=None,
            )
            _, wrong = render_report(
                [self.VERSION], targets, None, None, [], True,
                behavior_checks=checks,
                behavior_results={"behavior_checks": [{
                    "id": checks[0]["id"], "actual_count": 0,
                    "expected_count": 1,
                }]},
            )
        self.assertTrue(any("received None" in f for f in missing))
        self.assertTrue(any("received 0" in f for f in wrong))

    def test_matching_behavior_result_passes_data_only_migration(self):
        temp, root, migration = self.fixture()
        with temp:
            checks = self.load(root, migration)
            targets = derive_targets({self.VERSION: migration}, [self.VERSION])
            markdown, failures = render_report(
                [self.VERSION], targets, None, None, [], True,
                behavior_checks=checks,
                behavior_results={"behavior_checks": [{
                    "id": checks[0]["id"], "actual_count": 1,
                    "expected_count": 1,
                }]},
            )
        self.assertEqual(failures, [])
        self.assertIn("**PASS**", markdown)

    def test_real_b7_sidecar_preserves_every_sibling_catalog_target(self):
        versions = [
            "20260807030000", "20260807170000", "20260807170100",
            "20260807180000", "20260807190000", "20260807200000",
        ]
        migrations = {
            path.name[:14]: path
            for path in (REPO / "supabase" / "migrations").glob("*.sql")
        }
        checks = load_behavior_sidecars(REPO, migrations, versions)
        full = derive_targets(migrations, versions)
        siblings = derive_targets(migrations, versions[1:])
        self.assertEqual(len(checks), 1)
        self.assertEqual(full.as_dict(), siblings.as_dict())
        self.assertFalse(full.is_empty())
        self.assertIn("api.opa_property_reconciliation", full.views)
        self.assertIn("plm.sync_opa_property_character", full.functions)

    def test_real_popdam_sidecar_is_hash_bound_and_excludes_temp_helpers(self):
        version = "20260825082910"
        migration = next((REPO / "supabase" / "migrations").glob(f"{version}_*.sql"))
        checks = load_behavior_sidecars(REPO, {version: migration}, [version])
        targets = derive_targets({version: migration}, [version])
        sql = build_behavior_sql(checks)
        self.assertEqual(len(checks), 5)
        self.assertTrue(all(check["kind"] == "catalog_contract" for check in checks))
        self.assertNotIn("pg_temp.popdam_1479_cursor", targets.tables)
        self.assertFalse(any(name.startswith("pg_temp.") for name in targets.functions))
        self.assertTrue(targets.is_empty())
        self.assertIn("final #1427 contract active", sql)


class NetAclTests(unittest.TestCase):
    """GRANT ALL followed by a later partial REVOKE: the net ACL must be modeled.

    These are the five regression requirements from the task. Each uses TWO
    migration files in version order so cross-migration ordering is exercised
    alongside within-file ordering. The earlier migration grants ALL; the later
    one revokes a subset. Only the NET end state is the expectation.
    """

    GRANT_ALL_SQL = "grant all on plm.widget to service_role;\n"
    REVOKE_PARTIAL_SQL = (
        "revoke truncate, references, trigger, maintain "
        "on plm.widget from service_role;\n"
    )

    def derive_two(self, first_sql, second_sql):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            mig = root / "supabase" / "migrations"
            mig.mkdir(parents=True)
            (mig / "20260101000000_first.sql").write_text(first_sql, encoding="utf-8")
            (mig / "20260102000000_second.sql").write_text(second_sql, encoding="utf-8")
            return derive_targets(
                {
                    "20260101000000": mig / "20260101000000_first.sql",
                    "20260102000000": mig / "20260102000000_second.sql",
                },
                ["20260101000000", "20260102000000"],
            )

    def catalog(self, held, name="plm.widget"):
        return {
            "maintain_probed": True,
            "probe_roles": ["service_role"],
            "relations": [
                {"name": name, "to_regclass": name, "owner": "postgres"}
            ],
            "effective_privileges": [
                {"name": name, "role": "service_role", "privilege": p}
                for p in held
            ],
        }

    DML = ["SELECT", "INSERT", "UPDATE", "DELETE"]
    DDL = ["TRUNCATE", "REFERENCES", "TRIGGER", "MAINTAIN"]

    # 1. The intended final state passes.
    def test_intended_final_state_passes(self):
        t = self.derive_two(self.GRANT_ALL_SQL, self.REVOKE_PARTIAL_SQL)
        _, failures = assert_privileges(t, self.catalog(self.DML))
        self.assertEqual(failures, [])

    # 2. A required retained privilege missing still fails.
    def test_missing_retained_privilege_fails(self):
        t = self.derive_two(self.GRANT_ALL_SQL, self.REVOKE_PARTIAL_SQL)
        # service_role lost INSERT (over-revoke or mis-grant).
        _, failures = assert_privileges(
            t, self.catalog(["SELECT", "UPDATE", "DELETE"])
        )
        self.assertEqual(len(failures), 1)
        self.assertIn("INSERT", failures[0])
        self.assertIn("not held", failures[0])

    # 3. A forbidden revoked privilege retained still fails.
    def test_retained_revoked_privilege_fails(self):
        t = self.derive_two(self.GRANT_ALL_SQL, self.REVOKE_PARTIAL_SQL)
        # TRUNCATE was revoked but service_role still holds it.
        _, failures = assert_privileges(
            t, self.catalog(self.DML + ["TRUNCATE"])
        )
        self.assertEqual(len(failures), 1)
        self.assertIn("TRUNCATE", failures[0])
        self.assertIn("STILL HELD", failures[0])

    # 4. Unrelated object/grantee assertions remain independent.
    def test_unrelated_assertions_are_independent(self):
        sql = (
            "grant all on plm.widget to service_role;\n"
            "revoke truncate, references, trigger, maintain "
            "on plm.widget from service_role;\n"
            "grant select on plm.other to authenticated;\n"
        )
        t = targets_for(sql)
        # service_role has arwd on widget; authenticated has SELECT on other.
        catalog = self.catalog(self.DML)
        catalog["relations"].append(
            {"name": "plm.other", "to_regclass": "plm.other", "owner": "postgres"}
        )
        catalog["effective_privileges"].append(
            {"name": "plm.other", "role": "authenticated", "privilege": "SELECT"}
        )
        catalog["probe_roles"] = ["service_role", "authenticated"]
        _, failures = assert_privileges(t, catalog)
        self.assertEqual(failures, [])
        # If authenticated LOSES select on other, that fails independently.
        catalog2 = self.catalog(self.DML)
        catalog2["relations"].append(
            {"name": "plm.other", "to_regclass": "plm.other", "owner": "postgres"}
        )
        catalog2["probe_roles"] = ["service_role", "authenticated"]
        _, failures2 = assert_privileges(t, catalog2)
        auth_fails = [f for f in failures2 if "authenticated" in f]
        self.assertEqual(len(auth_fails), 1)
        self.assertIn("SELECT", auth_fails[0])

    # 5. Migration ordering determines the final expectation.
    def test_ordering_grant_after_revoke_keeps_all(self):
        """If the GRANT ALL comes AFTER the REVOKE, ALL wins: every privilege
        must be held, including the ones the earlier revoke removed."""
        t = self.derive_two(self.REVOKE_PARTIAL_SQL, self.GRANT_ALL_SQL)
        _, failures = assert_privileges(t, self.catalog(self.DML + self.DDL))
        self.assertEqual(failures, [])
        # And holding only the DML set now FAILS (the later GRANT ALL requires all 8).
        _, failures2 = assert_privileges(t, self.catalog(self.DML))
        self.assertTrue(
            any("MAINTAIN" in f or "TRUNCATE" in f for f in failures2),
            f"later GRANT ALL must require the full set: {failures2}",
        )


class DynamicAclExtractionTests(unittest.TestCase):
    """execute format('grant/revoke ...') inside do-blocks must be visible.

    strip_sql removes dollar-quoted bodies, so a revoke issued dynamically
    through execute format(...) is invisible to the plain pass. The dynamic-ACL
    reader extracts it by resolving the foreach loop variable to its array
    literal, so the net-ACL logic can reduce an earlier GRANT ALL.
    """

    # The B3 shape: named array + foreach + execute format with %s.
    B3_SHAPE = (
        "do $$\n"
        "declare\n"
        "  t text;\n"
        "  v_tables text[] := array[\n"
        "    'plm.coldlion_promotion_audit',\n"
        "    'plm.coldlion_promotion_quarantine'\n"
        "  ];\n"
        "begin\n"
        "  foreach t in array v_tables loop\n"
        "    execute format(\n"
        "      'revoke truncate, references, trigger, maintain on %s "
        "from service_role', t);\n"
        "  end loop;\n"
        "end;\n"
        "$$;\n"
    )

    def test_named_array_foreach_is_resolved(self):
        exps, rels, fns, notes = parse_dynamic_acl(self.B3_SHAPE, "v")
        self.assertEqual(len(notes), 0)
        self.assertEqual(
            sorted(rels),
            ["plm.coldlion_promotion_audit", "plm.coldlion_promotion_quarantine"],
        )
        grantees = {e.grantee for e in exps}
        self.assertEqual(grantees, {"service_role"})
        for e in exps:
            self.assertFalse(e.expect_held)
            self.assertEqual(
                e.privileges,
                ("MAINTAIN", "REFERENCES", "TRIGGER", "TRUNCATE"),
            )

    def test_inline_array_foreach_is_resolved(self):
        sql = (
            "do $$\n"
            "declare t text;\n"
            "begin\n"
            "  foreach t in array array['alpha', 'beta'] loop\n"
            "    execute format('revoke all on plm.%I from public', t);\n"
            "  end loop;\n"
            "end;\n"
            "$$;\n"
        )
        exps, rels, _fns, notes = parse_dynamic_acl(sql, "v")
        self.assertEqual(len(notes), 0)
        self.assertEqual(sorted(rels), ["plm.alpha", "plm.beta"])
        self.assertTrue(all(e.grantee == "PUBLIC" for e in exps))
        self.assertTrue(all("ALL" in e.privileges for e in exps))

    def test_concatenated_arrays_are_resolved(self):
        sql = (
            "do $$\n"
            "declare\n"
            "  t text;\n"
            "  v_a text[] := array['plm.one'];\n"
            "  v_b text[] := array['plm.two'];\n"
            "begin\n"
            "  foreach t in array (v_a || v_b) loop\n"
            "    execute format('revoke truncate on %s from service_role', t);\n"
            "  end loop;\n"
            "end;\n"
            "$$;\n"
        )
        exps, rels, _fns, notes = parse_dynamic_acl(sql, "v")
        self.assertEqual(len(notes), 0)
        self.assertEqual(sorted(rels), ["plm.one", "plm.two"])

    def test_unresolvable_argument_is_recorded_not_guessed(self):
        sql = (
            "do $$\n"
            "declare r record;\n"
            "begin\n"
            "  for r in select * from pg_tables loop\n"
            "    execute format('revoke all on %s from public', r.schemaname);\n"
            "  end loop;\n"
            "end;\n"
            "$$;\n"
        )
        exps, rels, _fns, notes = parse_dynamic_acl(sql, "v")
        self.assertEqual(exps, [])
        self.assertEqual(rels, set())
        self.assertTrue(any("could not be resolved" in n for n in notes))

    def test_non_grant_format_is_ignored(self):
        sql = (
            "do $$\n"
            "begin\n"
            "  execute format('drop table if exists %s', 'plm.temp');\n"
            "end;\n"
            "$$;\n"
        )
        exps, rels, _fns, notes = parse_dynamic_acl(sql, "v")
        self.assertEqual(exps, [])
        self.assertEqual(notes, [])

    def test_full_b3_batch_passes_correct_state(self):
        """The exact scenario from production run 31558201593: GRANT ALL in one
        migration, REVOKE via execute format in a later one. The correct end
        state (arwd only) must pass."""
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            mig = root / "supabase" / "migrations"
            mig.mkdir(parents=True)
            (mig / "20260101000000_grant.sql").write_text(
                "grant all on plm.evidence to service_role;\n", encoding="utf-8"
            )
            (mig / "20260102000000_revoke.sql").write_text(
                "do $$\n"
                "declare t text;\n"
                "begin\n"
                "  foreach t in array array['plm.evidence'] loop\n"
                "    execute format(\n"
                "      'revoke truncate, references, trigger, maintain "
                "on %s from service_role', t);\n"
                "  end loop;\n"
                "end;\n"
                "$$;\n",
                encoding="utf-8",
            )
            t = derive_targets(
                {
                    "20260101000000": mig / "20260101000000_grant.sql",
                    "20260102000000": mig / "20260102000000_revoke.sql",
                },
                ["20260101000000", "20260102000000"],
            )
        dml = ["SELECT", "INSERT", "UPDATE", "DELETE"]
        catalog = {
            "maintain_probed": True,
            "probe_roles": ["service_role"],
            "relations": [
                {"name": "plm.evidence", "to_regclass": "plm.evidence",
                 "owner": "postgres"}
            ],
            "effective_privileges": [
                {"name": "plm.evidence", "role": "service_role", "privilege": p}
                for p in dml
            ],
        }
        _, failures = assert_privileges(t, catalog)
        self.assertEqual(failures, [])

    def test_full_b3_batch_fails_when_revoke_did_not_take(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            mig = root / "supabase" / "migrations"
            mig.mkdir(parents=True)
            (mig / "20260101000000_grant.sql").write_text(
                "grant all on plm.evidence to service_role;\n", encoding="utf-8"
            )
            (mig / "20260102000000_revoke.sql").write_text(
                "do $$\n"
                "declare t text;\n"
                "begin\n"
                "  foreach t in array array['plm.evidence'] loop\n"
                "    execute format(\n"
                "      'revoke truncate, references, trigger, maintain "
                "on %s from service_role', t);\n"
                "  end loop;\n"
                "end;\n"
                "$$;\n",
                encoding="utf-8",
            )
            t = derive_targets(
                {
                    "20260101000000": mig / "20260101000000_grant.sql",
                    "20260102000000": mig / "20260102000000_revoke.sql",
                },
                ["20260101000000", "20260102000000"],
            )
        # Revoke did NOT take: all 8 still held.
        all8 = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE",
                "REFERENCES", "TRIGGER", "MAINTAIN"]
        catalog = {
            "maintain_probed": True,
            "probe_roles": ["service_role"],
            "relations": [
                {"name": "plm.evidence", "to_regclass": "plm.evidence",
                 "owner": "postgres"}
            ],
            "effective_privileges": [
                {"name": "plm.evidence", "role": "service_role", "privilege": p}
                for p in all8
            ],
        }
        _, failures = assert_privileges(t, catalog)
        self.assertTrue(
            any("STILL HELD" in f and "TRUNCATE" in f for f in failures),
            f"expected TRUNCATE still-held failure: {failures}",
        )


if __name__ == "__main__":
    unittest.main()
