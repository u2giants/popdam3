#!/usr/bin/env python3
"""Offline tests for the post-batch application verification (issue #711, D7).

NO DATABASE, NO NETWORK. Every test drives the pure SQL-building and pass/fail
logic on literal strings and hand-built payloads. `run_query` is never called;
where a driver-level test needs a transport it injects a fake one. This is
deliberate: #695 records that `supabase/tests/` exists and nothing runs it, and
this module must not join that pile. These run alongside the existing
production-guard and catalog-verification tests in the `validate` job.

The load-bearing tests, the ones a future edit must not be allowed to delete:

  * `NoEvidenceIsAFailureTests` -- an empty catalog result, a NULL aggregate and
    an empty manifest each produce a FAILURE. This is the exact bug class the
    repo keeps being burned by.
  * `NullPermissiveTests` -- NULL is never a pass, for a privilege, a relation,
    a column, an FK or a batch extra.
  * `ClockTests` -- the midday-UTC pin, in both zones.
  * `PostgrestExposureTests` -- `plm` absent from `pgrst.db_schemas` is CORRECT
    and must not be reported as a break.
"""

from __future__ import annotations

import contextlib
import io
import json
import re
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from post_batch_app_verification import (  # noqa: E402
    APP_MANIFEST,
    BATCH_EXTRAS,
    BASELINE_GAP_POLICY,
    BATCH_RESTING_POINTS,
    MANIFEST_DRIFT,
    NEVER_REST_BY_BATCH,
    MANUAL_ONLY_BATCHES,
    POSTGREST_ADDRESSED_BUT_UNEXPOSED,
    PRODUCT_DEPTH_EXPECTED_TOTAL,
    PRODUCT_SIZE_EXPECTED_ACTIVE,
    PRODUCT_SIZE_EXPECTED_INACTIVE,
    PRODUCT_SIZE_EXPECTED_TOTAL,
    PROJECT_REF,
    WARNER_TABLES,
    CLOCK_PIN_UTC,
    HELD_VERSIONS,
    NEVER_REST_VERSIONS,
    OUT_OF_SCOPE,
    POSTGREST_UNEXPOSED_SCHEMAS,
    PRODUCTION_PROJECT_REF,
    REQUIRED_POSTGREST_SCHEMAS,
    RETIRED_VERSIONS,
    USER_AGENT,
    AppSpec,
    BatchResolution,
    ForeignKey,
    Relation,
    Routine,
    VerificationError,
    build_batch_extra_sql,
    build_batch_extras_sql,
    build_column_sql,
    build_environment_sql,
    build_foreign_key_sql,
    build_relation_sql,
    build_routine_sql,
    batch_index,
    build_pgrst_schemas_expr,
    clock_expressions,
    cumulative_extras,
    build_ledger_sql,
    judge_ledger,
    run_query,
    extract_report,
    is_explicit_true,
    judge_app,
    judge_environment,
    main,
    render_report,
    resolve_batch,
    verify,
)

REL = Relation("pim", "product", "table", ("authenticated",), ("SELECT",), ("stage_id",), "why")
FN = Routine("api", "pm_pipeline_page", ("authenticated",), "why")
FK = ForeignKey("core", "contact_company", "contact_id", "why")
SPEC = AppSpec((REL,), (FN,), (FK,))


def ok_relation(**over):
    row = {
        "relation": "pim.product",
        "expected_kind": "table",
        "exists": True,
        "relkind": "r",
        "kind_ok": True,
        "privileges": [{"role": "authenticated", "privilege": "SELECT", "held": True}],
    }
    row.update(over)
    return row


def ok_routine(**over):
    row = {
        "routine": "api.pm_pipeline_page",
        "overloads": 1,
        "exists": True,
        "privileges": [{"role": "authenticated", "privilege": "EXECUTE", "held": True}],
    }
    row.update(over)
    return row


def ok_column(**over):
    row = {"relation": "pim.product", "column": "stage_id", "present": True}
    row.update(over)
    return row


def ok_fk(**over):
    row = {"relation": "core.contact_company", "column": "contact_id", "present": True}
    row.update(over)
    return row


def judge(rel=None, fn=None, col=None, fk=None, spec=SPEC):
    return judge_app(
        "TestApp",
        spec,
        [ok_relation()] if rel is None else rel,
        [ok_routine()] if fn is None else fn,
        [ok_column()] if col is None else col,
        [ok_fk()] if fk is None else fk,
    )


# ---------------------------------------------------------------------------


class ExplicitTrueTests(unittest.TestCase):
    """Trap 2. A pass requires a non-null value AND a positive match."""

    def test_true_is_true(self):
        for v in (True, "true", "TRUE", " t ", "yes", "y", "1", 1):
            self.assertTrue(is_explicit_true(v), v)

    def test_none_is_not_true(self):
        self.assertFalse(is_explicit_true(None))

    def test_false_and_falsey_strings_are_not_true(self):
        for v in (False, "false", "f", "no", "0", 0, "", "null", "unknown", "NULL"):
            self.assertFalse(is_explicit_true(v), v)

    def test_unrecognised_types_are_not_true(self):
        for v in ({}, [], object(), 2.5, ["true"]):
            self.assertFalse(is_explicit_true(v), v)

    def test_negation_of_a_null_never_reads_as_a_pass(self):
        """The precise shape of the bug: `not is_false(x)` must never be used.

        With NULL, both `is_explicit_true(x)` and any hypothetical
        `is_explicit_false(x)` are False. Only the positive form is safe, and
        this asserts the positive form rejects NULL.
        """
        self.assertFalse(is_explicit_true(None))
        self.assertTrue(not is_explicit_true(None))  # i.e. NULL routes to FAIL


class NullPermissiveTests(unittest.TestCase):
    """NULL must fail everywhere a verdict is read, not just for privileges."""

    def test_null_privilege_fails(self):
        f = judge(rel=[ok_relation(privileges=[{"role": "authenticated", "privilege": "SELECT", "held": None}])])
        self.assertTrue(any("does NOT hold SELECT" in x for x in f), f)

    def test_null_exists_fails(self):
        f = judge(rel=[ok_relation(exists=None)])
        self.assertTrue(any("DOES NOT EXIST" in x for x in f), f)

    def test_null_kind_ok_fails(self):
        f = judge(rel=[ok_relation(kind_ok=None, relkind=None)])
        self.assertTrue(any("not the table" in x for x in f), f)

    def test_null_routine_exists_fails(self):
        f = judge(fn=[ok_routine(exists=None)])
        self.assertTrue(any("ZERO overloads" in x for x in f), f)

    def test_null_execute_fails(self):
        f = judge(fn=[ok_routine(privileges=[{"role": "authenticated", "privilege": "EXECUTE", "held": None}])])
        self.assertTrue(any("does NOT hold EXECUTE" in x for x in f), f)

    def test_null_column_presence_fails(self):
        f = judge(col=[ok_column(present=None)])
        self.assertTrue(any("is MISSING" in x for x in f), f)

    def test_null_foreign_key_presence_fails(self):
        f = judge(fk=[ok_fk(present=None)])
        self.assertTrue(any("foreign key" in x and "MISSING" in x for x in f), f)

    def test_null_batch_extra_fails(self):
        spec = BATCH_EXTRAS["B8"]
        md, failures = render_report(
            BatchResolution("B8", BATCH_RESTING_POINTS["B8"], ["20260809170500"]),
            PRODUCTION_PROJECT_REF,
            {},
            [],
            [{"key": e.key, "passed": None} for e in spec],
            spec,
            [],
        )
        self.assertEqual(len(failures), len(spec))
        self.assertIn("FAILED", " ".join(failures))


class NoEvidenceIsAFailureTests(unittest.TestCase):
    """The rule the whole module exists to enforce."""

    def test_empty_relation_result_is_a_failure(self):
        f = judge(rel=[])
        self.assertTrue(any("NO EVIDENCE for pim.product" in x for x in f), f)

    def test_null_aggregate_is_a_failure_not_a_pass(self):
        """`jsonb_agg` over zero rows returns SQL NULL. That must not pass."""
        f = judge_app("TestApp", SPEC, None, None, None, None)
        self.assertTrue(f)
        self.assertTrue(any("NO EVIDENCE" in x for x in f), f)

    def test_empty_manifest_is_a_failure(self):
        f = judge_app("Empty", AppSpec((), ()), [], [], [], [])
        self.assertEqual(len(f), 1)
        self.assertIn("manifest is EMPTY", f[0])
        self.assertIn("must never", f[0])

    def test_missing_routine_evidence_is_a_failure(self):
        f = judge(fn=[])
        self.assertTrue(any("NO EVIDENCE for routine api.pm_pipeline_page" in x for x in f), f)

    def test_missing_column_evidence_is_a_failure(self):
        f = judge(col=[])
        self.assertTrue(any("NO EVIDENCE for column pim.product.stage_id" in x for x in f), f)

    def test_missing_batch_extra_evidence_is_a_failure(self):
        spec = BATCH_EXTRAS["B7"]
        _, failures = render_report(
            BatchResolution("B7", BATCH_RESTING_POINTS["B7"], ["20260807200000"]),
            PRODUCTION_PROJECT_REF,
            {},
            [],
            [],  # the query came back with nothing at all
            spec,
            [],
        )
        self.assertEqual(len(failures), len(spec))
        self.assertIn("NO EVIDENCE", " ".join(failures))

    def test_a_query_error_is_a_failure(self):
        _, failures = render_report(
            BatchResolution("B2", BATCH_RESTING_POINTS["B2"], ["20260728181500"]),
            PRODUCTION_PROJECT_REF,
            {"PopPIM": []},
            [],
            None,
            (),
            ["the relation query FAILED (boom)."],
        )
        self.assertTrue(any("boom" in f for f in failures))

    def test_everything_present_is_a_pass(self):
        self.assertEqual(judge(), [])


class VerifyDriverTests(unittest.TestCase):
    """End-to-end through `verify()` with a fake transport. Still no network."""

    def _run(self, responder):
        # The driver prints the whole report to stdout and every failure to
        # stderr, by design. Swallow both here so the test log stays readable;
        # the assertions read the written artifact, which is the real output.
        with tempfile.TemporaryDirectory() as tmp, io.StringIO() as o, io.StringIO() as e, \
                contextlib.redirect_stdout(o), contextlib.redirect_stderr(e):
            out = Path(tmp)
            code = verify(
                BatchResolution("B0", BATCH_RESTING_POINTS["B0"], ["20260810140000"]),
                out,
                PRODUCTION_PROJECT_REF,
                "not-a-real-token",
                query=responder,
            )
            payload = json.loads(
                (out / "post-batch-app-verification.json").read_text(encoding="utf-8")
            )
            markdown = (out / "post-batch-app-verification.md").read_text(encoding="utf-8")
        return code, payload, markdown

    def test_a_database_that_has_nothing_fails_loudly(self):
        """The headline case: every query returns SQL NULL. Must exit non-zero."""

        def responder(ref, token, sql, api=None):
            return [{"report": None}]

        code, payload, markdown = self._run(responder)
        self.assertEqual(code, 1)
        self.assertIn("NO EVIDENCE", markdown)
        for app in APP_MANIFEST:
            self.assertTrue(payload["per_app"][app], app)

    def test_a_transport_error_fails_rather_than_passing(self):
        def responder(ref, token, sql, api=None):
            raise OSError("connection reset")

        code, _, markdown = self._run(responder)
        self.assertEqual(code, 1)
        self.assertIn("connection reset", markdown)
        self.assertIn("was not verified", markdown)

    def test_an_unparseable_payload_fails(self):
        def responder(ref, token, sql, api=None):
            return {"unexpected": "shape"}

        code, _, _ = self._run(responder)
        self.assertEqual(code, 1)

    def test_a_fully_healthy_database_passes(self):
        """Synthesise a catalog that satisfies the whole manifest -> exit 0."""

        def responder(ref, token, sql, api=None):
            if "schema_migrations" in sql:
                # M6: only B0's resting point has landed, which is what the
                # BatchResolution below claims.
                return [{"report": {
                    "resting_points": [
                        {"batch": b, "version": v, "applied": b == "B0"}
                        for b, v in BATCH_RESTING_POINTS.items()],
                    "never_rest_applied": []}}]
            if "jsonb_build_object('key'" in sql:
                # Each batch extra is now its own query; answer each one TRUE.
                key = sql.split("'key', '", 1)[1].split("'", 1)[0]
                return [{"report": {"key": key, "passed": True}}]
            if "'pgrst_db_schemas'" in sql:
                return [
                    {
                        "report": {
                            "pgrst_db_schemas": ", ".join(
                                list(REQUIRED_POSTGREST_SCHEMAS) + ["graphql_public"]
                            ),
                            "server_timezone": "America/New_York",
                            "pinned_date_utc": "2026-08-10",
                            "pinned_date_server": "2026-08-10",
                            "observed_at_utc": "2026-08-10 12:00:00",
                        }
                    }
                ]
            if "'relation'," in sql and "'expected_kind'" in sql:
                rows = []
                for spec in APP_MANIFEST.values():
                    for rel in spec.relations:
                        rows.append(
                            {
                                "relation": rel.qualified,
                                "exists": True,
                                "relkind": "r" if rel.kind == "table" else "v",
                                "kind_ok": True,
                                "privileges": [
                                    {"role": r, "privilege": p, "held": True}
                                    for r in rel.roles
                                    for p in rel.privileges
                                ],
                            }
                        )
                return [{"report": rows}]
            if "'routine'," in sql:
                rows = []
                for spec in APP_MANIFEST.values():
                    for fn in spec.routines:
                        rows.append(
                            {
                                "routine": fn.qualified,
                                "overloads": 1,
                                "exists": True,
                                "privileges": [
                                    {"role": r, "privilege": "EXECUTE", "held": True}
                                    for r in fn.roles
                                ],
                            }
                        )
                return [{"report": rows}]
            if "information_schema.columns" in sql:
                rows = [
                    {"relation": rel.qualified, "column": c, "present": True}
                    for spec in APP_MANIFEST.values()
                    for rel in spec.relations
                    for c in rel.columns
                ]
                return [{"report": rows}]
            if "pg_constraint" in sql:
                rows = [
                    {
                        "relation": f"{fk.schema}.{fk.table}",
                        "column": fk.column,
                        "present": True,
                    }
                    for spec in APP_MANIFEST.values()
                    for fk in spec.foreign_keys
                ]
                return [{"report": rows}]
            return [{"report": None}]

        code, payload, markdown = self._run(responder)
        self.assertEqual(code, 0, markdown)
        for app in APP_MANIFEST:
            self.assertEqual(payload["per_app"][app], [], app)
        self.assertIn("PASS", markdown)

    def test_one_missing_grant_fails_only_that_app_but_exits_non_zero(self):
        """A single lost EXECUTE must sink the run, not be averaged away."""
        failures = judge_app(
            "PopPIM",
            APP_MANIFEST["PopPIM"],
            [],
            [ok_routine(routine="api.pm_pipeline_page", privileges=[{"role": "authenticated", "privilege": "EXECUTE", "held": False}])],
            [],
            [],
        )
        self.assertTrue(any("does NOT hold EXECUTE" in f for f in failures))


class ArrivesInTests(unittest.TestCase):
    """An object a LATER batch creates is not yet a failure -- but only then."""

    LATE = Relation(
        "core", "product_size", "table", ("authenticated",), ("SELECT",), ("status",),
        "why", arrives_in="B8",
    )
    SPEC_LATE = AppSpec((LATE,), (FN,))

    def _judge(self, batch, exists):
        notes = []
        fails = judge_app(
            "TestApp",
            self.SPEC_LATE,
            [ok_relation(relation="core.product_size", exists=exists, kind_ok=exists,
                         privileges=[{"role": "authenticated", "privilege": "SELECT", "held": True}])],
            [ok_routine()],
            [{"relation": "core.product_size", "column": "status", "present": exists}],
            [],
            batch=batch,
            notes=notes,
        )
        return fails, notes

    def test_absent_before_its_batch_is_a_note_not_a_failure(self):
        fails, notes = self._judge("B1", False)
        self.assertEqual(fails, [])
        self.assertTrue(any("does not exist yet" in n for n in notes), notes)

    def test_absent_at_its_own_batch_is_a_hard_failure(self):
        fails, _ = self._judge("B8", False)
        self.assertTrue(any("DOES NOT EXIST" in f for f in fails), fails)

    def test_absent_after_its_batch_is_a_hard_failure(self):
        fails, _ = self._judge("B9", False)
        self.assertTrue(any("DOES NOT EXIST" in f for f in fails), fails)

    def test_present_at_its_batch_passes(self):
        fails, notes = self._judge("B8", True)
        self.assertEqual(fails, [])
        self.assertEqual(notes, [])

    def test_arriving_early_is_noted(self):
        fails, notes = self._judge("B1", True)
        self.assertEqual(fails, [])
        self.assertTrue(any("already exists" in n for n in notes), notes)

    def test_an_unknown_batch_sorts_last_so_nothing_is_excused(self):
        fails, _ = self._judge("UNKNOWN", False)
        self.assertTrue(any("DOES NOT EXIST" in f for f in fails), fails)

    def test_every_arrives_in_names_a_real_batch(self):
        for app, spec in APP_MANIFEST.items():
            for rel in spec.relations:
                if rel.arrives_in is not None:
                    self.assertIn(rel.arrives_in, BATCH_RESTING_POINTS, f"{app} {rel.qualified}")


class BaselineGapTests(unittest.TestCase):
    """A recorded pre-existing gap is reported, never silently swallowed."""

    GAP = Relation(
        "pim", "checklist_item", "table", ("authenticated",), ("SELECT", "INSERT"), (),
        "why", baseline_missing=("INSERT",),
    )
    SPEC_GAP = AppSpec((GAP,), (FN,))

    def _judge(self, insert_held):
        notes = []
        fails = judge_app(
            "TestApp",
            self.SPEC_GAP,
            [ok_relation(relation="pim.checklist_item", privileges=[
                {"role": "authenticated", "privilege": "SELECT", "held": True},
                {"role": "authenticated", "privilege": "INSERT", "held": insert_held},
            ])],
            [ok_routine()],
            [],
            [],
            batch="B1",
            notes=notes,
        )
        return fails, notes

    def test_a_recorded_gap_is_noted_not_failed(self):
        fails, notes = self._judge(False)
        self.assertEqual(fails, [])
        self.assertTrue(any("RECORDED BASELINE GAP" in n for n in notes), notes)

    def test_a_closed_gap_is_reported_so_the_list_cannot_go_stale(self):
        fails, notes = self._judge(True)
        self.assertEqual(fails, [])
        self.assertTrue(any("BASELINE GAP CLOSED" in n for n in notes), notes)

    def test_a_gap_not_on_the_recorded_list_is_a_hard_failure(self):
        """The escape hatch is exactly one privilege wide, and no wider."""
        notes = []
        fails = judge_app(
            "TestApp",
            self.SPEC_GAP,
            [ok_relation(relation="pim.checklist_item", privileges=[
                {"role": "authenticated", "privilege": "SELECT", "held": False},
                {"role": "authenticated", "privilege": "INSERT", "held": False},
            ])],
            [ok_routine()],
            [],
            [],
            batch="B1",
            notes=notes,
        )
        self.assertEqual(len(fails), 1)
        self.assertIn("does NOT hold SELECT", fails[0])

    def test_a_null_privilege_on_a_gap_relation_is_still_only_the_gap(self):
        fails, notes = self._judge(None)
        self.assertEqual(fails, [])
        self.assertTrue(any("RECORDED BASELINE GAP" in n for n in notes), notes)

    def test_baseline_missing_is_always_a_subset_of_the_declared_privileges(self):
        for app, spec in APP_MANIFEST.items():
            for rel in spec.relations:
                for p in rel.baseline_missing:
                    self.assertIn(p, rel.privileges, f"{app} {rel.qualified} {p}")

    def test_the_manifest_records_the_known_poppim_write_gaps(self):
        """The live 2026-08-10 finding must not quietly disappear."""
        gapped = {
            r.qualified: set(r.baseline_missing)
            for r in APP_MANIFEST["PopPIM"].relations
            if r.baseline_missing
        }
        self.assertEqual(
            set(gapped),
            {
                "pim.checklist_item",
                "pim.product_assignee",
                "pim.product_sample",
                "pim.product_submission",
                "pim.revision_request",
            },
        )
        self.assertNotIn("SELECT", set().union(*gapped.values()))


class CrossAppRelationCollisionTests(unittest.TestCase):
    """C1 REGRESSION. Built from the REAL collision, not a synthetic one.

    Three relations appear in two applications each, with different roles and
    privileges. The original code flattened all three apps into one query and
    keyed the result by relation NAME, so one app's row silently replaced
    another's and each app could be judged against the wrong evidence.

    The reviewer's reproduction is `test_the_reviewers_reproduction`: a batch
    that revokes SELECT from `authenticated` on `core.contact_company` and
    `core.customer` kills PopPIM's board collab pane and PopDAM's customer
    picker, and the old code printed all three PASS and exited 0.
    """

    COLLIDING = {
        "core.licensor": {"PopPIM", "PopDAM"},
        "core.contact_company": {"PopPIM", "PopCRM"},
        "core.customer": {"PopDAM", "PopCRM"},
    }

    def test_the_collision_this_guards_still_exists_in_the_manifest(self):
        """If this fails, the manifest changed -- re-derive, do not delete."""
        seen: dict[str, set[str]] = {}
        for app, spec in APP_MANIFEST.items():
            for rel in spec.relations:
                seen.setdefault(rel.qualified, set()).add(app)
        shared = {k: v for k, v in seen.items() if len(v) > 1}
        self.assertEqual(shared, self.COLLIDING)

    def test_the_colliding_relations_really_do_differ_between_apps(self):
        """A collision only matters because the rows are NOT interchangeable."""
        for qualified, apps in self.COLLIDING.items():
            shapes = set()
            for app in apps:
                rel = next(
                    r for r in APP_MANIFEST[app].relations if r.qualified == qualified
                )
                shapes.add((rel.roles, rel.privileges))
            self.assertEqual(len(shapes), len(apps), f"{qualified} shapes: {shapes}")

    def test_the_reviewers_reproduction_now_fails_loudly(self):
        """Revoke authenticated SELECT on two shared relations -> both apps FAIL.

        Per-app evidence is passed to per-app judges, exactly as `verify()` does
        it. PopCRM's service_role rows can no longer overwrite PopPIM's and
        PopDAM's authenticated rows, because they are never in the same dict.
        """

        def evidence_for(app):
            rows = []
            for rel in APP_MANIFEST[app].relations:
                revoked = rel.qualified in ("core.contact_company", "core.customer")
                rows.append(
                    {
                        "relation": rel.qualified,
                        "exists": True,
                        "relkind": "r" if rel.kind == "table" else "v",
                        "kind_ok": True,
                        "privileges": [
                            {
                                "role": role,
                                "privilege": priv,
                                # the batch revoked SELECT from `authenticated` only
                                "held": not (
                                    revoked and role == "authenticated" and priv == "SELECT"
                                ),
                            }
                            for role in rel.roles
                            for priv in rel.privileges
                        ],
                    }
                )
            return rows

        verdicts = {}
        for app, spec in APP_MANIFEST.items():
            verdicts[app] = judge_app(
                app,
                spec,
                evidence_for(app),
                [
                    {"routine": fn.qualified, "overloads": 1, "exists": True,
                     "privileges": [{"role": r, "privilege": "EXECUTE", "held": True}
                                    for r in fn.roles]}
                    for fn in spec.routines
                ],
                [{"relation": r.qualified, "column": c, "present": True}
                 for r in spec.relations for c in r.columns],
                [{"relation": f"{f.schema}.{f.table}", "column": f.column, "present": True}
                 for f in spec.foreign_keys],
                batch="B1",
                notes=[],
            )

        # PopPIM loses core.contact_company -> the board collab pane is dead.
        self.assertTrue(
            any("core.contact_company" in f and "does NOT hold SELECT" in f
                for f in verdicts["PopPIM"]),
            verdicts["PopPIM"],
        )
        # PopDAM loses core.customer -> the customer picker is dead.
        self.assertTrue(
            any("core.customer" in f and "does NOT hold SELECT" in f
                for f in verdicts["PopDAM"]),
            verdicts["PopDAM"],
        )
        # PopCRM reaches both as service_role, which was NOT revoked. It passes,
        # and that is correct -- the bug was PopCRM's pass being COPIED onto the
        # other two, not PopCRM passing.
        self.assertEqual(verdicts["PopCRM"], [])

    def test_verify_asks_a_separate_question_per_application(self):
        """Structural proof: `verify()` issues per-app relation queries."""
        seen: list[str] = []

        def responder(ref, token, sql, api=None):
            seen.append(sql)
            return [{"report": None}]

        with tempfile.TemporaryDirectory() as tmp, io.StringIO() as o, io.StringIO() as e, \
                contextlib.redirect_stdout(o), contextlib.redirect_stderr(e):
            verify(
                BatchResolution("B0", BATCH_RESTING_POINTS["B0"], ["20260810140000"]),
                Path(tmp),
                PRODUCTION_PROJECT_REF,
                "not-a-real-token",
                query=responder,
            )
        relation_queries = [s for s in seen if "expected_kind" in s]
        self.assertEqual(len(relation_queries), len(APP_MANIFEST))
        # No single relation query may carry another app's exclusive relation.
        pim_only = "pim.saved_view"
        crm_only = "crm.email_message"
        for sql in relation_queries:
            self.assertFalse(pim_only in sql and crm_only in sql)


class BatchResolutionTests(unittest.TestCase):
    def test_the_ten_legal_resting_points_are_exactly_the_contract_list(self):
        self.assertEqual(
            sorted(BATCH_RESTING_POINTS),
            ["B0", "B1", "B2", "B3", "B4", "B5", "B6", "B7", "B8", "B9"],
        )
        self.assertEqual(len(set(BATCH_RESTING_POINTS.values())), 10)

    def test_no_resting_point_is_also_a_never_rest_version(self):
        """The two contract lists must not contradict each other."""
        overlap = set(BATCH_RESTING_POINTS.values()) & NEVER_REST_VERSIONS
        self.assertEqual(overlap, set())

    def test_batch_id_resolves(self):
        r = resolve_batch("B8", None)
        self.assertEqual(r.batch, "B8")
        self.assertEqual(r.last_version, "20260809170500")
        self.assertEqual(r.problems, [])

    def test_lowercase_batch_id_resolves(self):
        self.assertEqual(resolve_batch("b3", None).batch, "B3")

    def test_versions_resolve_to_the_batch_whose_resting_point_they_end_on(self):
        r = resolve_batch(None, "20260809170300, 20260809170500,20260809170400")
        self.assertEqual(r.batch, "B8")
        self.assertEqual(r.last_version, "20260809170500")
        self.assertEqual(r.problems, [])

    def test_resting_on_an_exposed_version_is_a_problem(self):
        r = resolve_batch(None, "20260810030000")
        self.assertTrue(any("EXPOSED STATE" in p for p in r.problems))

    def test_an_unrecognised_resting_point_is_a_problem(self):
        r = resolve_batch(None, "20260101000000")
        self.assertEqual(r.batch, "UNKNOWN")
        self.assertTrue(any("UNRECOGNISED RESTING POINT" in p for p in r.problems))

    def test_a_retired_migration_in_the_set_is_a_problem(self):
        r = resolve_batch(None, "20260729120000,20260728181500")
        self.assertTrue(any("RETIRED MIGRATION" in p for p in r.problems))

    def test_a_held_migration_in_the_set_is_a_problem(self):
        r = resolve_batch(None, "20260802170000,20260802160000")
        self.assertTrue(any("HELD MIGRATION" in p for p in r.problems))

    def test_the_retired_and_held_versions_match_the_contract(self):
        self.assertEqual(
            RETIRED_VERSIONS,
            {
                "20260729120000",
                "20260814224937",
                "20260814233342",
                "20260814233423",
                "20260816045130",
                "20260819011639",
                "20260819151536",
                "20260825010603",
                "20260825025154",
                "20260825031841",
                "20260814223552",
                "20260825094455",
            },
        )
        self.assertEqual(HELD_VERSIONS, {"20260802170000", "20260802171000"})

    def test_bad_input_is_refused(self):
        for batch, versions in [
            (None, None),
            ("B1", "20260728134500"),
            ("B99", None),
            (None, "not-a-version"),
            (None, "   "),
        ]:
            with self.assertRaises(VerificationError):
                resolve_batch(batch, versions)

    def test_batch_problems_reach_the_failure_list(self):
        r = resolve_batch(None, "20260810030000")
        _, failures = render_report(r, PRODUCTION_PROJECT_REF, {}, [], None, (), [])
        self.assertTrue(any("EXPOSED STATE" in f for f in failures))


class ClockTests(unittest.TestCase):
    """Trap 3. America/New_York, and the midnight-UTC off-by-one day."""

    def test_the_pin_is_midday_not_midnight(self):
        self.assertEqual(CLOCK_PIN_UTC, "12:00:00")
        self.assertNotIn("00:00:00", CLOCK_PIN_UTC)

    def test_the_environment_sql_pins_to_midday_and_asks_both_zones(self):
        sql = build_environment_sql()
        self.assertIn("12:00:00", sql)
        self.assertIn("pinned_date_utc", sql)
        self.assertIn("pinned_date_server", sql)
        self.assertIn("at time zone 'UTC'", sql)
        self.assertIn("current_setting('TimeZone')", sql)

    def test_the_two_legs_are_not_the_same_computation(self):
        """H2 REGRESSION. The old UTC leg WAS the server leg, spelled twice.

        `<naive ts> at time zone 'UTC'` is a timestamptz, and `timestamptz::date`
        already converts through TimeZone -- so the old expression computed the
        server date and the `utc != server` branch was unreachable. Verified
        against production 2026-08-10: at a midnight pin the old UTC leg and the
        server leg both returned 2026-08-09, while the corrected legs return
        2026-08-10 and 2026-08-09.
        """
        utc, server = clock_expressions()
        self.assertNotEqual(utc, server)
        # The UTC leg must convert BACK to a naive timestamp before ::date,
        # which is what the second `at time zone 'UTC'` does. Exactly two.
        self.assertEqual(utc.count("at time zone 'UTC'"), 2)
        # The server leg converts to the session zone, once, after the same
        # single UTC anchoring.
        self.assertEqual(server.count("at time zone 'UTC'"), 1)
        self.assertIn("at time zone current_setting('TimeZone')", server)
        self.assertNotIn("current_setting('TimeZone')", utc)

    def test_the_pin_is_evaluated_not_just_pattern_matched(self):
        """Evaluate the SEMANTICS the SQL encodes, with a real tz database.

        `zoneinfo` models exactly what Postgres does here: anchor the naive
        wall time in UTC, then read the calendar date in each zone. This is the
        test that would have caught H2 -- the old expression collapses both legs
        onto the server zone, so `midnight` would have shown agreement where the
        truth is disagreement.
        """
        from datetime import datetime
        from zoneinfo import ZoneInfo

        def legs(pin):
            h, m, s = (int(x) for x in pin.split(":"))
            anchored = datetime(2026, 8, 10, h, m, s, tzinfo=ZoneInfo("UTC"))
            return (
                anchored.astimezone(ZoneInfo("UTC")).date(),
                anchored.astimezone(ZoneInfo("America/New_York")).date(),
            )

        # The pin this module actually uses: the two zones must AGREE.
        utc, server = legs(CLOCK_PIN_UTC)
        self.assertEqual(utc, server)

        # Midnight UTC: they must DISAGREE. If a future edit moved the pin to
        # midnight, `judge_environment` would start failing every run -- which
        # is why the pin is midday and why this asserts the trap is real.
        utc_mid, server_mid = legs("00:00:00")
        self.assertNotEqual(utc_mid, server_mid)
        self.assertEqual((utc_mid - server_mid).days, 1)

    def test_agreeing_dates_pass(self):
        self.assertEqual(
            judge_environment(
                {
                    "pgrst_db_schemas": ",".join(REQUIRED_POSTGREST_SCHEMAS),
                    "server_timezone": "America/New_York",
                    "pinned_date_utc": "2026-08-10",
                    "pinned_date_server": "2026-08-10",
                }
            ),
            [],
        )

    def test_disagreeing_dates_fail(self):
        f = judge_environment(
            {
                "pgrst_db_schemas": ",".join(REQUIRED_POSTGREST_SCHEMAS),
                "server_timezone": "America/New_York",
                "pinned_date_utc": "2026-08-10",
                "pinned_date_server": "2026-08-09",  # the midnight-UTC symptom
            }
        )
        self.assertTrue(any("suspect" in x for x in f), f)

    def test_a_missing_date_fails(self):
        f = judge_environment(
            {
                "pgrst_db_schemas": ",".join(REQUIRED_POSTGREST_SCHEMAS),
                "pinned_date_utc": None,
                "pinned_date_server": None,
            }
        )
        self.assertTrue(any("could not be verified" in x for x in f), f)


class PostgrestExposureTests(unittest.TestCase):
    """Trap 4. `plm` is deliberately not exposed; that is not a break."""

    def test_plm_is_not_required_to_be_exposed(self):
        self.assertIn("plm", POSTGREST_UNEXPOSED_SCHEMAS)
        self.assertNotIn("plm", REQUIRED_POSTGREST_SCHEMAS)

    def test_the_documented_production_list_passes(self):
        self.assertEqual(
            judge_environment(
                {
                    "pgrst_db_schemas": "public, graphql_public, api, crm, pim, core, app",
                    "server_timezone": "America/New_York",
                    "pinned_date_utc": "2026-08-10",
                    "pinned_date_server": "2026-08-10",
                }
            ),
            [],
        )

    def test_a_missing_required_schema_fails(self):
        f = judge_environment(
            {
                "pgrst_db_schemas": "public, graphql_public, api, crm, pim, core",
                "server_timezone": "America/New_York",
                "pinned_date_utc": "2026-08-10",
                "pinned_date_server": "2026-08-10",
            }
        )
        self.assertTrue(any("'app'" in x for x in f), f)

    def test_plm_becoming_exposed_is_reported(self):
        f = judge_environment(
            {
                "pgrst_db_schemas": "public, graphql_public, api, crm, pim, core, app, plm",
                "server_timezone": "America/New_York",
                "pinned_date_utc": "2026-08-10",
                "pinned_date_server": "2026-08-10",
            }
        )
        self.assertTrue(any("plm" in x and "IS exposed" in x for x in f), f)

    def test_a_null_pgrst_setting_fails(self):
        f = judge_environment(
            {
                "pgrst_db_schemas": None,
                "pinned_date_utc": "2026-08-10",
                "pinned_date_server": "2026-08-10",
            }
        )
        self.assertTrue(any("NULL or empty" in x for x in f), f)

    def test_no_environment_evidence_at_all_fails(self):
        f = judge_environment(None)
        self.assertTrue(any("no evidence at all" in x for x in f), f)

    def test_no_manifest_object_lives_in_an_unexposed_schema_via_postgrest(self):
        """A manifest entry in `plm` would fail for a config reason, not a break."""
        for app, spec in APP_MANIFEST.items():
            for rel in spec.relations:
                self.assertNotIn(rel.schema, POSTGREST_UNEXPOSED_SCHEMAS, f"{app} {rel.qualified}")
            for fn in spec.routines:
                self.assertNotIn(fn.schema, POSTGREST_UNEXPOSED_SCHEMAS, f"{app} {fn.qualified}")


class SqlConstructionTests(unittest.TestCase):
    def test_relation_sql_asserts_the_object_not_the_ledger(self):
        sql = build_relation_sql([REL])
        self.assertIn("to_regclass('pim.product')", sql)
        self.assertIn("has_table_privilege('authenticated'", sql)
        self.assertIn("'SELECT'", sql)
        self.assertIn("c.relkind", sql)
        self.assertNotIn("schema_migrations", sql)

    def test_relation_sql_privilege_is_null_when_the_relation_is_absent(self):
        """A privilege on a non-existent relation must read NULL, not FALSE.

        `has_table_privilege(role, NULL, 'SELECT')` returns NULL rather than
        raising, but the explicit CASE makes the intent unmissable and keeps the
        NULL flowing to `is_explicit_true`, which fails it.
        """
        sql = build_relation_sql([REL])
        self.assertIn("case when to_regclass('pim.product') is null then null", sql)

    def test_view_and_table_expect_different_relkinds(self):
        view = build_relation_sql([Relation("api", "v", "view", ("authenticated",), ("SELECT",))])
        table = build_relation_sql([Relation("api", "t", "table", ("authenticated",), ("SELECT",))])
        self.assertIn("'v', 'm'", view)
        self.assertIn("'r', 'p', 'f'", table)

    def test_routine_sql_counts_overloads_in_pg_proc(self):
        sql = build_routine_sql([FN])
        self.assertIn("pg_proc", sql)
        self.assertIn("n.nspname = 'api'", sql)
        self.assertIn("p.proname = 'pm_pipeline_page'", sql)
        self.assertIn("has_function_privilege('authenticated'", sql)

    def test_column_sql_uses_information_schema(self):
        sql = build_column_sql([REL])
        self.assertIn("information_schema.columns", sql)
        self.assertIn("column_name = 'stage_id'", sql)

    def test_column_sql_is_empty_when_no_columns_are_contractual(self):
        self.assertEqual(build_column_sql([Relation("a", "b", "table", ("x",), ("SELECT",))]), "")

    def test_foreign_key_sql_checks_pg_constraint(self):
        sql = build_foreign_key_sql([FK])
        self.assertIn("pg_constraint", sql)
        self.assertIn("con.contype = 'f'", sql)
        self.assertIn("a.attname = 'contact_id'", sql)

    def test_empty_inputs_are_refused_rather_than_producing_empty_sql(self):
        with self.assertRaises(VerificationError):
            build_relation_sql([])
        with self.assertRaises(VerificationError):
            build_routine_sql([])

    def test_a_non_identifier_is_refused(self):
        for bad in ["pim; drop table x", "PIM", "pim.product", "1abc", ""]:
            with self.assertRaises(VerificationError):
                build_relation_sql([Relation(bad, "product", "table", ("authenticated",), ("SELECT",))])
            with self.assertRaises(VerificationError):
                build_routine_sql([Routine(bad, "f", ("authenticated",))])

    def test_a_non_privilege_is_refused(self):
        with self.assertRaises(VerificationError):
            build_relation_sql([Relation("pim", "product", "table", ("authenticated",), ("select; --",))])

    def test_every_manifest_entry_builds_valid_sql(self):
        rels = [r for s in APP_MANIFEST.values() for r in s.relations]
        fns = [f for s in APP_MANIFEST.values() for f in s.routines]
        fks = [f for s in APP_MANIFEST.values() for f in s.foreign_keys]
        for sql in (
            build_relation_sql(rels),
            build_routine_sql(fns),
            build_column_sql(rels),
            build_foreign_key_sql(fks),
            build_environment_sql(),
        ):
            self.assertTrue(sql.strip().lower().startswith("select"))

    def test_no_generated_sql_mutates_anything(self):
        """No mutating verb survives OUTSIDE a string literal.

        String literals are stripped first, because legitimate checks quote
        mutating words as DATA -- B9 asserts service_role does not hold the
        privilege named `'TRUNCATE'`, and a naive substring scan would flag that
        as a write. Stripping literals is what makes the difference between a
        test that means something and a test that has to be weakened later.
        """
        rels = [r for s in APP_MANIFEST.values() for r in s.relations]
        fns = [f for s in APP_MANIFEST.values() for f in s.routines]
        fks = [f for s in APP_MANIFEST.values() for f in s.foreign_keys]
        sql = " ".join(
            [
                build_relation_sql(rels),
                build_routine_sql(fns),
                build_column_sql(rels),
                build_foreign_key_sql(fks),
                build_environment_sql(),
            ]
            + [build_batch_extras_sql(e) for e in BATCH_EXTRAS.values()]
        ).lower()
        sql = re.sub(r"'(?:[^']|'')*'", " ", sql)
        for word in (
            "insert into",
            "update ",
            "delete from",
            "alter ",
            "create ",
            "drop ",
            "truncate",
            "grant ",
            "revoke ",
        ):
            self.assertNotIn(word, sql, word)


class BatchExtrasTests(unittest.TestCase):
    def test_every_extras_batch_is_a_real_batch(self):
        for batch in BATCH_EXTRAS:
            self.assertIn(batch, BATCH_RESTING_POINTS)

    def test_b8_guards_the_silently_swallowed_object(self):
        keys = {e.key for e in BATCH_EXTRAS["B8"]}
        self.assertIn("core_product_size_row_count_matches_the_seed", keys)
        self.assertIn("core_product_size_active_count_matches_the_seed", keys)
        self.assertIn("core_product_size_inactive_count_matches_the_seed", keys)
        self.assertIn("core_product_depth_row_count_matches_the_seed", keys)
        self.assertIn("core_product_depth_exists", keys)

    def test_b7_asserts_the_view_survived_its_drop_and_recreate(self):
        sql = build_batch_extras_sql(BATCH_EXTRAS["B7"])
        self.assertIn("to_regclass('api.opa_property_reconciliation')", sql)
        self.assertIn("pg_get_viewdef", sql)

    def test_b9_asserts_security_invoker_and_the_three_windows(self):
        keys = {e.key for e in BATCH_EXTRAS["B9"]}
        self.assertIn("dam_order_list_is_security_invoker", keys)
        self.assertIn("warner_read_gate_is_the_role_gate_on_all_eight_tables", keys)
        self.assertIn("paramount_service_role_has_no_truncate", keys)

    def test_b1_and_b6_assert_the_old_signatures_are_gone(self):
        sql = build_batch_extras_sql(BATCH_EXTRAS["B1"] + BATCH_EXTRAS["B6"])
        self.assertIn("p.pronargs = 3", sql)
        self.assertIn("p.pronargs = 2", sql)
        self.assertIn("p.pronargs = 8", sql)

    def test_batch_extras_sql_is_empty_for_a_batch_with_none(self):
        self.assertEqual(build_batch_extras_sql(()), "")

    def test_each_extra_is_its_own_standalone_query(self):
        """One bad extra must not blind the others -- proven on B8 pre-apply.

        Running `--batch B8` before B8 lands made the combined statement 400 at
        parse time (`core.product_size` does not exist), which reported NO
        EVIDENCE for all three B8 checks instead of one.
        """
        for extra in BATCH_EXTRAS["B8"]:
            sql = build_batch_extra_sql(extra)
            self.assertTrue(sql.startswith("select jsonb_build_object("))
            self.assertNotIn("union all", sql)
            self.assertIn(extra.key, sql)
            self.assertTrue(sql.rstrip().endswith("as report"))

    def test_a_single_failing_extra_only_removes_itself(self):
        spec = BATCH_EXTRAS["B8"]
        rows = [{"key": e.key, "passed": True} for e in spec[1:]]  # first one never ran
        _, failures = render_report(
            BatchResolution("B8", BATCH_RESTING_POINTS["B8"], ["20260809170500"]),
            PRODUCTION_PROJECT_REF,
            {},
            [],
            rows,
            spec,
            [],
        )
        self.assertEqual(len(failures), 1)
        self.assertIn("NO EVIDENCE", failures[0])
        self.assertIn(spec[0].key, failures[0])

    def test_a_failing_extra_produces_a_failure(self):
        spec = BATCH_EXTRAS["B9"]
        _, failures = render_report(
            BatchResolution("B9", BATCH_RESTING_POINTS["B9"], ["20260810170000"]),
            PRODUCTION_PROJECT_REF,
            {},
            [],
            [{"key": e.key, "passed": e.key != "dam_order_list_is_security_invoker"} for e in spec],
            spec,
            [],
        )
        self.assertEqual(len(failures), 1)
        self.assertIn("dam_order_list_is_security_invoker", failures[0])


class ReviewFixTests(unittest.TestCase):
    """H3, M4, M5, M6, M7, L8, L9, L10, L11 -- one or more assertions each."""

    def test_h3_no_check_uses_role_table_grants(self):
        """It reports nothing for service_role from this connection.

        Verified against production 2026-08-10: `information_schema.
        role_table_grants` returns ZERO rows for `service_role` in `plm` when
        `current_user` is `supabase_read_only_user`, so `not exists (...)` on it
        is unconditionally TRUE and can never fail.
        """
        blob = " ".join(build_batch_extra_sql(e) for e in cumulative_extras("B9"))
        self.assertNotIn("role_table_grants", blob)
        self.assertIn("has_table_privilege('service_role'", blob)

    def test_h3_truncate_check_cannot_be_satisfied_by_an_empty_schema(self):
        keys = {e.key for e in BATCH_EXTRAS["B9"]}
        self.assertIn("paramount_service_role_has_no_truncate", keys)
        self.assertIn("paramount_tables_are_actually_present", keys)

    def test_m4_every_batch_has_an_automated_check_or_a_named_manual_one(self):
        for batch in BATCH_RESTING_POINTS:
            has_auto = bool(BATCH_EXTRAS.get(batch))
            has_manual = bool(MANUAL_ONLY_BATCHES.get(batch))
            self.assertTrue(has_auto or has_manual, batch)
            self.assertTrue(has_manual, f"{batch} has no manual checklist recorded")

    def test_m4_b3_manual_step_names_the_unrecoverable_risk(self):
        text = " ".join(MANUAL_ONLY_BATCHES["B3"])
        self.assertIn("UNRECOVERABLE", text.upper())
        self.assertIn("provenance", text)

    def test_m4_the_report_never_claims_there_is_nothing_to_check(self):
        md, _ = render_report(
            BatchResolution("B3", BATCH_RESTING_POINTS["B3"], ["20260731200000"]),
            PRODUCTION_PROJECT_REF,
            {app: [] for app in APP_MANIFEST},
            [], None, (), [],
        )
        self.assertNotIn("defines no batch-specific database check", md)
        self.assertIn("Still required by hand", md)
        self.assertIn("UNRECOVERABLE", md.upper())

    def test_m5_b8_asserts_exact_seed_counts_not_merely_nonzero(self):
        blob = " ".join(build_batch_extra_sql(e) for e in BATCH_EXTRAS["B8"])
        self.assertIn(str(PRODUCT_SIZE_EXPECTED_TOTAL), blob)
        self.assertIn(str(PRODUCT_SIZE_EXPECTED_ACTIVE), blob)
        self.assertIn(str(PRODUCT_SIZE_EXPECTED_INACTIVE), blob)
        self.assertIn(str(PRODUCT_DEPTH_EXPECTED_TOTAL), blob)
        self.assertNotIn("> 0", blob)

    def test_m5_the_expected_counts_are_internally_consistent(self):
        self.assertEqual(
            PRODUCT_SIZE_EXPECTED_ACTIVE + PRODUCT_SIZE_EXPECTED_INACTIVE,
            PRODUCT_SIZE_EXPECTED_TOTAL,
        )

    @staticmethod
    def _ledger(*applied_batches, never_rest=()):
        return {
            "resting_points": [
                {"batch": b, "version": v, "applied": b in applied_batches}
                for b, v in BATCH_RESTING_POINTS.items()
            ],
            "never_rest_applied": list(never_rest),
        }

    def test_every_never_rest_version_maps_to_a_backlog_batch(self):
        mapped = {v for versions in NEVER_REST_BY_BATCH.values() for v in versions}
        self.assertEqual(mapped, set(NEVER_REST_VERSIONS))
        self.assertNotIn("B0", NEVER_REST_BY_BATCH)

    def test_the_backlog_resting_points_are_strictly_increasing(self):
        """The premise the version->batch mapping depends on."""
        backlog = [v for b, v in BATCH_RESTING_POINTS.items() if b != "B0"]
        self.assertEqual(backlog, sorted(backlog))
        self.assertEqual(len(backlog), len(set(backlog)))

    def test_a_half_applied_later_batch_is_caught(self):
        """THE REPRODUCED HOLE: claim B8, B8 landed, B9 HALF applied.

        B8's resting point is present and B9's is absent, so nothing is 'ahead'
        and a resting-point-only check goes green -- while production sits
        between 20260810030000 and 20260810110000, where the eight Warner tables
        are readable by every authenticated account in the shared project.
        """
        fails = judge_ledger(
            BatchResolution("B8", BATCH_RESTING_POINTS["B8"], ["20260809170500"]),
            self._ledger(
                "B0", "B1", "B2", "B3", "B4", "B5", "B6", "B7", "B8",
                # B9 started: the Warner create landed, its grants fix did not.
                never_rest=["20260810010000", "20260810020000", "20260810030000"],
            ),
        )
        self.assertEqual(len(fails), 1, fails)
        self.assertIn("HALF-APPLIED BATCH: B9", fails[0])
        self.assertIn("20260810030000", fails[0])
        self.assertIn("EXPOSED STATE", fails[0])
        self.assertIn("COMPLETE the batch", fails[0])

    def test_a_half_applied_batch_makes_the_whole_run_fail(self):
        """It must reach the exit code, not just the report body."""
        _, failures = render_report(
            BatchResolution("B8", BATCH_RESTING_POINTS["B8"], ["20260809170500"]),
            PRODUCTION_PROJECT_REF,
            {app: [] for app in APP_MANIFEST},
            judge_ledger(
                BatchResolution("B8", BATCH_RESTING_POINTS["B8"], ["20260809170500"]),
                self._ledger(
                    "B0", "B1", "B2", "B3", "B4", "B5", "B6", "B7", "B8",
                    never_rest=["20260810030000"],
                ),
            ),
            [], (), [],
        )
        self.assertTrue(any("HALF-APPLIED" in f for f in failures), failures)

    def test_a_finished_batchs_interior_versions_are_not_a_half_apply(self):
        """B1 landed completely: its own never-rest versions are history."""
        self.assertEqual(
            judge_ledger(
                BatchResolution("B1", BATCH_RESTING_POINTS["B1"], ["20260728134500"]),
                self._ledger(
                    "B0", "B1",
                    never_rest=sorted(NEVER_REST_BY_BATCH["B1"]),
                ),
            ),
            [],
        )

    def test_a_half_applied_EARLIER_batch_is_also_caught(self):
        """B3 never finished but B4 landed on top of it -- still exposed."""
        fails = judge_ledger(
            BatchResolution("B4", BATCH_RESTING_POINTS["B4"], ["20260731220000"]),
            self._ledger(
                "B0", "B1", "B2", "B4",
                never_rest=[NEVER_REST_BY_BATCH["B3"][0]],
            ),
        )
        self.assertTrue(any("HALF-APPLIED BATCH: B3" in f for f in fails), fails)

    def test_the_ledger_sql_asks_about_every_never_rest_version(self):
        sql = build_ledger_sql()
        self.assertIn("never_rest_applied", sql)
        for version in NEVER_REST_VERSIONS:
            self.assertIn(version, sql)

    def test_m6_batches_are_not_applied_in_version_order(self):
        """Why `max(version)` is the WRONG primitive, proven from the contract.

        B0 is the canary 20260810140000, which sorts numerically ABOVE every
        version in B1 through B8. A live run against production reported
        "highest version applied is 20260810140000 - B0" on a database where B1
        was genuinely the applied batch. Presence-per-resting-point is the only
        formulation that survives this.
        """
        versions = list(BATCH_RESTING_POINTS.values())
        self.assertNotEqual(versions, sorted(versions))
        self.assertGreater(BATCH_RESTING_POINTS["B0"], BATCH_RESTING_POINTS["B8"])

    def test_m6_the_canary_being_applied_does_not_break_a_b1_verification(self):
        """The exact false positive the first implementation produced."""
        self.assertEqual(
            judge_ledger(
                BatchResolution("B1", BATCH_RESTING_POINTS["B1"], ["20260728134500"]),
                self._ledger("B0", "B1"),
            ),
            [],
        )

    def test_m6_a_later_batch_having_landed_is_fatal(self):
        fails = judge_ledger(
            BatchResolution("B5", BATCH_RESTING_POINTS["B5"], ["20260802160000"]),
            self._ledger("B0", "B1", "B2", "B3", "B4", "B5", "B9"),
        )
        self.assertEqual(len(fails), 1)
        self.assertIn("LEDGER MISMATCH", fails[0])
        self.assertIn("B9", fails[0])
        self.assertIn("--batch B9", fails[0])

    def test_m6_the_claimed_batch_not_having_landed_is_fatal(self):
        fails = judge_ledger(
            BatchResolution("B5", BATCH_RESTING_POINTS["B5"], ["20260802160000"]),
            self._ledger("B0", "B1"),
        )
        self.assertTrue(any("is NOT in the migration ledger" in f for f in fails), fails)

    def test_m6_an_unreadable_or_empty_ledger_is_fatal(self):
        for payload in (None, [], {}):
            self.assertTrue(judge_ledger(
                BatchResolution("B1", BATCH_RESTING_POINTS["B1"], ["20260728134500"]),
                payload,
            ), payload)

    def test_m6_a_null_applied_flag_is_not_a_pass(self):
        payload = self._ledger("B0", "B1")
        for r in payload["resting_points"]:
            if r["batch"] == "B1":
                r["applied"] = None
        fails = judge_ledger(
            BatchResolution("B1", BATCH_RESTING_POINTS["B1"], ["20260728134500"]), payload
        )
        self.assertTrue(any("is NOT in the migration ledger" in f for f in fails), fails)

    def test_m6_extras_are_cumulative(self):
        b1 = {e.key for e in cumulative_extras("B1")}
        b9 = {e.key for e in cumulative_extras("B9")}
        self.assertTrue(b1 < b9)
        # A B1 invariant is still re-checked at B9.
        self.assertIn("coldlion_sync_two_arg_is_gone", b9)
        # And B9's own assertions are not present at B1.
        self.assertNotIn("dam_order_list_is_security_invoker", b1)

    def test_m6_cumulative_keys_are_unique(self):
        keys = [e.key for e in cumulative_extras("B9")]
        self.assertEqual(len(keys), len(set(keys)))

    def test_m7_warner_gate_asserts_the_role_gate_not_the_literal_true(self):
        extra = next(
            e for e in BATCH_EXTRAS["B9"]
            if e.key == "warner_read_gate_is_the_role_gate_on_all_eight_tables"
        )
        self.assertNotIn("qual = 'true'", extra.expression)
        self.assertIn("qual is not null", extra.expression)
        self.assertIn("has_any_role", extra.expression)
        self.assertIn(str(len(WARNER_TABLES)), extra.expression)
        self.assertEqual(len(WARNER_TABLES), 11)
        for table in WARNER_TABLES:
            self.assertIn(table, extra.expression)

    def test_l8_a_malformed_project_ref_is_refused_before_any_request(self):
        for bad in ["", "x", "../../admin", "qsllyeztdwjgirsysga1", "QSLLYEZTDWJGIRSYSGAI",
                    "qsllyeztdwjgirsysgai/x"]:
            with self.assertRaises(VerificationError, msg=bad):
                run_query(bad, "token", "select 1")

    def test_l8_the_real_production_ref_is_accepted_by_the_pattern(self):
        self.assertTrue(PROJECT_REF.fullmatch(PRODUCTION_PROJECT_REF))
        self.assertTrue(PROJECT_REF.fullmatch("rjyboqwcdzcocqgmsyel"))  # preview

    def test_l9_the_pgrst_lookup_is_deterministic(self):
        expr = build_pgrst_schemas_expr()
        self.assertNotIn("limit 1", expr)
        self.assertIn("min(", expr)
        self.assertIn("pgrst_setting_count", build_environment_sql())

    def test_l10_dam_is_recorded_as_addressed_but_unexposed(self):
        self.assertIn("dam", POSTGREST_ADDRESSED_BUT_UNEXPOSED)
        self.assertNotIn("dam", REQUIRED_POSTGREST_SCHEMAS)
        used = {r.schema for s in APP_MANIFEST.values() for r in s.relations}
        self.assertIn("dam", used)

    def test_l10_an_addressed_but_unexposed_schema_is_reported_every_run(self):
        notes = []
        fails = judge_environment(
            {
                "pgrst_db_schemas": "public, graphql_public, api, crm, pim, core, app",
                "server_timezone": "America/New_York",
                "pinned_date_utc": "2026-08-10",
                "pinned_date_server": "2026-08-10",
            },
            notes=notes,
        )
        self.assertEqual(fails, [])
        self.assertTrue(any("'dam'" in n and "404" in n for n in notes), notes)

    def test_l11_the_query_actually_used_is_the_one_swept_for_mutations(self):
        """`verify()` calls build_batch_extra_sql, not build_batch_extras_sql."""
        blob = " ".join(
            build_batch_extra_sql(e)
            for batch in BATCH_RESTING_POINTS
            for e in BATCH_EXTRAS.get(batch, ())
        ).lower()
        blob = re.sub(r"'(?:[^']|'')*'", " ", blob)
        for word in ("insert into", "update ", "delete from", "alter ", "create ",
                     "drop ", "truncate", "grant ", "revoke "):
            self.assertNotIn(word, blob, word)

    def test_the_product_material_correction_is_recorded(self):
        text = " ".join(MANIFEST_DRIFT)
        self.assertIn("ALREADY EXISTS on production", text)
        self.assertIn("#721", text)
        self.assertIn("#720", text)


class ManifestTests(unittest.TestCase):
    def test_the_three_exposed_apps_and_only_those(self):
        self.assertEqual(sorted(APP_MANIFEST), ["PopCRM", "PopDAM", "PopPIM"])

    def test_designflow_and_monitor_are_explicitly_out_of_scope_with_reasons(self):
        self.assertIn("DesignFlow PLM", OUT_OF_SCOPE)
        self.assertIn("Cloud SQL", OUT_OF_SCOPE["DesignFlow PLM"])
        self.assertIn("monitor", OUT_OF_SCOPE)
        self.assertNotIn("DesignFlow PLM", APP_MANIFEST)

    def test_no_app_manifest_is_empty(self):
        for app, spec in APP_MANIFEST.items():
            self.assertTrue(spec.relations, app)
            self.assertTrue(spec.routines, app)

    def test_poppim_carries_the_nineteen_pm_rpcs_and_current_user_profile(self):
        names = {r.name for r in APP_MANIFEST["PopPIM"].routines}
        self.assertEqual(len([n for n in names if n.startswith("pm_")]), 19)
        self.assertIn("current_user_profile", names)

    def test_the_highest_fan_out_object_is_covered_in_both_apps(self):
        """`api.current_user_profile` is called by PopPIM and PopCRM (§3.1)."""
        for app in ("PopPIM", "PopCRM"):
            self.assertIn(
                "api.current_user_profile",
                {r.qualified for r in APP_MANIFEST[app].routines},
                app,
            )

    def test_poppim_covers_the_unenforced_cross_schema_reference(self):
        rels = {r.qualified: r for r in APP_MANIFEST["PopPIM"].relations}
        self.assertIn("pim.product", rels)
        for name in ("app.activity", "app.notification", "app.comment"):
            self.assertIn(name, rels)
            for col in ("target_schema", "target_table", "target_id"):
                self.assertIn(col, rels[name].columns, f"{name}.{col}")

    def test_poppim_covers_the_postgrest_embed_foreign_key(self):
        fks = APP_MANIFEST["PopPIM"].foreign_keys
        self.assertTrue(any(f.table == "contact_company" and f.column == "contact_id" for f in fks))

    def test_popdam_treats_status_as_contractual_on_product_size(self):
        rel = next(
            r for r in APP_MANIFEST["PopDAM"].relations if r.qualified == "core.product_size"
        )
        self.assertIn("status", rel.columns)

    def test_popdam_covers_the_realtime_bound_relations(self):
        names = {r.qualified for r in APP_MANIFEST["PopDAM"].relations}
        for n in (
            "public.style_groups",
            "public.admin_config",
            "public.render_queue",
            "public.agent_registrations",
        ):
            self.assertIn(n, names)

    def test_popcrm_covers_the_service_role_worker_surface(self):
        worker = [
            r
            for r in APP_MANIFEST["PopCRM"].relations
            if "service_role" in r.roles
        ]
        schemas = {r.schema for r in worker}
        self.assertEqual(schemas, {"crm", "core"})
        self.assertTrue(all("INSERT" in r.privileges for r in worker))

    def test_crm_segment_is_a_column_not_a_relation(self):
        """A naive grep would have added it as a view that does not exist."""
        names = {r.qualified for r in APP_MANIFEST["PopCRM"].relations}
        self.assertNotIn("api.crm_segment", names)
        rel = next(r for r in APP_MANIFEST["PopCRM"].relations if r.name == "crm_contact_segment_list")
        self.assertIn("crm_segment", rel.columns)

    def test_every_relation_names_at_least_one_role_and_privilege(self):
        for app, spec in APP_MANIFEST.items():
            for rel in spec.relations:
                self.assertTrue(rel.roles, f"{app} {rel.qualified}")
                self.assertTrue(rel.privileges, f"{app} {rel.qualified}")
                self.assertTrue(rel.why, f"{app} {rel.qualified} has no provenance")
            for fn in spec.routines:
                self.assertTrue(fn.roles, f"{app} {fn.qualified}")

    def test_no_duplicate_relations_within_an_app(self):
        for app, spec in APP_MANIFEST.items():
            names = [r.qualified for r in spec.relations]
            self.assertEqual(len(names), len(set(names)), app)


class TransportTests(unittest.TestCase):
    def test_the_user_agent_is_set_and_is_not_the_urllib_default(self):
        """Cloudflare answers 403/1010 to `Python-urllib`. Load-bearing."""
        self.assertTrue(USER_AGENT.strip())
        self.assertNotIn("Python-urllib", USER_AGENT)

    def test_extract_report_handles_the_shapes_the_api_returns(self):
        self.assertEqual(extract_report([{"report": 1}]), 1)
        self.assertEqual(extract_report({"result": [{"report": 2}]}), 2)
        self.assertEqual(extract_report({"data": [{"report": 3}]}), 3)

    def test_extract_report_refuses_an_empty_or_wrong_shape(self):
        for payload in ([], {}, [{"nope": 1}], None, "text"):
            with self.assertRaises(VerificationError):
                extract_report(payload)


class CliTests(unittest.TestCase):
    def test_a_missing_token_blocks_rather_than_passing(self):
        import os

        os.environ.pop("SHARED_DB_TEST_TOKEN", None)
        code = main(
            [
                "--batch",
                "B1",
                "--output-dir",
                tempfile.gettempdir(),
                "--project-ref",
                PRODUCTION_PROJECT_REF,
                "--token-env",
                "SHARED_DB_TEST_TOKEN",
            ]
        )
        self.assertEqual(code, 1)

    def test_a_bad_batch_blocks_before_any_network_call(self):
        import os

        os.environ["SHARED_DB_TEST_TOKEN"] = "x"
        try:
            code = main(
                [
                    "--batch",
                    "B42",
                    "--output-dir",
                    tempfile.gettempdir(),
                    "--project-ref",
                    PRODUCTION_PROJECT_REF,
                    "--token-env",
                    "SHARED_DB_TEST_TOKEN",
                ]
            )
        finally:
            os.environ.pop("SHARED_DB_TEST_TOKEN", None)
        self.assertEqual(code, 1)


class ReportTests(unittest.TestCase):
    def test_the_report_states_what_it_did_not_prove(self):
        md, _ = render_report(
            BatchResolution("B1", BATCH_RESTING_POINTS["B1"], ["20260728134500"]),
            PRODUCTION_PROJECT_REF,
            {app: [] for app in APP_MANIFEST},
            [],
            None,
            (),
            [],
        )
        self.assertIn("did **not open the applications**", md)
        self.assertIn("worker journal", md)
        self.assertIn("ARGUMENT NAME", md)
        self.assertIn("DesignFlow", md)

    def test_a_non_production_project_ref_is_flagged_in_the_report(self):
        md, _ = render_report(
            BatchResolution("B1", BATCH_RESTING_POINTS["B1"], ["20260728134500"]),
            "rjyboqwcdzcocqgmsyel",
            {app: [] for app in APP_MANIFEST},
            [],
            None,
            (),
            [],
        )
        self.assertIn("NOT the production ref", md)

    def test_per_app_failures_all_reach_the_failure_list(self):
        md, failures = render_report(
            BatchResolution("B1", BATCH_RESTING_POINTS["B1"], ["20260728134500"]),
            PRODUCTION_PROJECT_REF,
            {"PopPIM": ["a"], "PopDAM": ["b", "c"], "PopCRM": []},
            [],
            None,
            (),
            [],
        )
        self.assertEqual(len(failures), 3)
        self.assertIn("**FAIL**", md)


if __name__ == "__main__":
    unittest.main(verbosity=2)
