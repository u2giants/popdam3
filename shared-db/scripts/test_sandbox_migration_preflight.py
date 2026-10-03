"""Offline tests for the DesignFlow sandbox migration route (issue #3428)."""
from __future__ import annotations

import json
import re
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import sandbox_migration_preflight as sp  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = (ROOT / ".github" / "workflows" / "designflow-sandbox-migrations.yml").read_text(encoding="utf-8")
PREVIEW = "abcdefghijklmnopqrst"


class IdentityTests(unittest.TestCase):
    def test_accepts_only_the_sandbox(self) -> None:
        sp.check_target_ref(sp.SANDBOX_PROJECT_REF, PREVIEW)
        sp.check_returned_project(sp.SANDBOX_PROJECT_REF, {"id": sp.SANDBOX_PROJECT_REF})

    def test_refuses_production_preview_other_and_unknown_preview(self) -> None:
        for ref, preview in (
            (sp.PRODUCTION_PROJECT_REF, PREVIEW),
            ("zzzzzzzzzzzzzzzzzzzz", PREVIEW),
            ("", PREVIEW),
            (sp.SANDBOX_PROJECT_REF, ""),
            (sp.SANDBOX_PROJECT_REF, sp.SANDBOX_PROJECT_REF),
        ):
            with self.assertRaises(sp.Refusal):
                sp.check_target_ref(ref, preview)

    def test_refuses_a_different_returned_project(self) -> None:
        for project in (None, {}, {"id": sp.PRODUCTION_PROJECT_REF}):
            with self.assertRaises(sp.Refusal):
                sp.check_returned_project(sp.SANDBOX_PROJECT_REF, project)


class AllowlistTests(unittest.TestCase):
    migrations = {"20260101000000": Path("a"), "20260102000000": Path("b"), "20260905072856": Path("c")}

    def test_accepts_ordered_known_versions(self) -> None:
        self.assertEqual(
            sp.parse_sandbox_allowlist("20260101000000, 20260102000000", self.migrations),
            ["20260101000000", "20260102000000"],
        )

    def test_refusals(self) -> None:
        for raw in ("", "2026", "20260101000000,20260101000000", "20260102000000,20260101000000",
                    "20260905072856", "20260103000000", "20260101000000,"):
            with self.assertRaises(sp.Refusal, msg=raw):
                sp.parse_sandbox_allowlist(raw, self.migrations)

    def test_issue_2204_migration_is_blocked_on_the_real_repo(self) -> None:
        from production_migration_guard import local_migrations
        with self.assertRaisesRegex(sp.Refusal, "blocked on the sandbox route"):
            sp.parse_sandbox_allowlist("20260905072856", local_migrations(ROOT))


class CollisionTests(unittest.TestCase):
    def test_names_created_objects_including_unqualified_indexes(self) -> None:
        sql = (
            "-- create table fake.comment\n"
            "create table if not exists app.t (id int);\n"
            "create index if not exists t_idx on app.t (id);\n"
            "create or replace function app.f() returns int language sql as $$ select 1 $$;\n"
            "create function app.g() returns int language sql as $$ create table x.y() $$;\n"
            "drop view if exists api.v; create view api.v as select 1;\n"
            "create type app.kind as enum ('a');\n"
        )
        self.assertEqual(
            sp.created_names(sql),
            [("relation", "app.t"), ("relation", "app.t_idx"), ("function", "app.g"), ("type", "app.kind")],
        )

    def test_added_columns_policies_and_triggers_are_probed(self) -> None:
        sql = (
            "alter table app.user_notification add column if not exists created_at timestamptz;\n"
            "alter table only app.t add constraint t_ck check (true);\n"
            "alter table app.t add x int;\n"
            "create policy p_read on app.t for select using (true);\n"
            "drop trigger if exists trg on app.t; create trigger trg after insert on app.t for each row execute function app.f();\n"
            "create trigger trg2 before update on app.t for each row execute function app.f();\n"
        )
        self.assertEqual(
            sp.created_names(sql),
            [("column", "app.user_notification.created_at"), ("column", "app.t.x"),
             ("policy", "app.t.p_read"), ("trigger", "app.t.trg2")],
        )
        probe = sp.build_collision_sql(sp.created_names(sql))
        for needle in ("pg_attribute", "pg_policy", "pg_trigger", "not attisdropped", "not tgisinternal"):
            self.assertIn(needle, probe)

    def test_real_issue_2204_index_would_be_probed(self) -> None:
        path = next((ROOT / "supabase" / "migrations").glob("20260905072856_*.sql"))
        names = sp.created_names(path.read_text(encoding="utf-8"))
        self.assertIn(("relation", "app.user_notification_unread_user_created_idx"), names)

    def _repo(self, sql: str) -> Path:
        tmp = Path(tempfile.mkdtemp())
        (tmp / "supabase" / "migrations").mkdir(parents=True)
        (tmp / "supabase" / "migrations" / "20260101000000_x.sql").write_text(sql, encoding="utf-8")
        return tmp

    def test_existing_name_is_refused_and_absent_name_passes(self) -> None:
        repo = self._repo("create index if not exists i on app.t (id);")
        present = lambda ref, token, sql: [{"kind": "relation", "name": "app.i", "present": True}]  # noqa: E731
        absent = lambda ref, token, sql: [{"kind": "relation", "name": "app.i", "present": False}]  # noqa: E731
        with self.assertRaisesRegex(sp.Refusal, "relation app.i"):
            sp.collisions(repo, "20260101000000", sp.SANDBOX_PROJECT_REF, "t", query=present)
        sp.collisions(repo, "20260101000000", sp.SANDBOX_PROJECT_REF, "t", query=absent)

    def test_malformed_catalog_answer_and_wrong_target_refuse(self) -> None:
        repo = self._repo("create table app.t (id int);")
        for rows in (None, [], [{"kind": "relation", "name": "app.t", "present": None}]):
            with self.assertRaises(sp.Refusal):
                sp.collisions(repo, "20260101000000", sp.SANDBOX_PROJECT_REF, "t", query=lambda *a, r=rows: r)
        with self.assertRaises(sp.Refusal):
            sp.collisions(repo, "20260101000000", sp.PRODUCTION_PROJECT_REF, "t", query=lambda *a: [])

    def test_probe_sql_is_select_only(self) -> None:
        sql = sp.build_collision_sql([("relation", "app.t"), ("type", "app.k"), ("function", "app.f"), ("schema", "s")])
        self.assertTrue(sql.startswith("select "))
        self.assertNotRegex(sql.lower(), r"\b(insert|update|delete|create|drop|alter)\b")


class LedgerTests(unittest.TestCase):
    def _write(self, versions: list[str]) -> Path:
        tmp = Path(tempfile.mkdtemp()) / "ledger.txt"
        tmp.write_text("\n".join(f"   {v} | {v} | 2026" for v in versions), encoding="utf-8")
        return tmp

    def test_exact_delta(self) -> None:
        before = self._write(["20260101000000"])
        sp.verify_ledger(before, self._write(["20260101000000", "20260102000000"]), "20260102000000")
        with self.assertRaises(sp.Refusal):
            sp.verify_ledger(before, self._write(["20260101000000"]), "20260102000000")
        with self.assertRaises(sp.Refusal):
            sp.verify_ledger(before, self._write(["20260101000000", "20260102000000", "20260103000000"]), "20260102000000")


class WorkflowInvariantTests(unittest.TestCase):
    def test_dispatch_only_and_serial_lock(self) -> None:
        on_block = WORKFLOW.split("\non:\n", 1)[1].split("\npermissions:", 1)[0]
        self.assertIn("workflow_dispatch:", on_block)
        self.assertNotIn("pull_request", on_block)
        self.assertNotIn("merge_group", on_block)
        self.assertRegex(WORKFLOW, r"concurrency:\n  group: designflow-sandbox-migrations\n  cancel-in-progress: false")

    def test_only_sandbox_ref_and_sandbox_secret(self) -> None:
        self.assertIn("SANDBOX_PROJECT_REF: xupnyeifmpsacrqahwwm", WORKFLOW)
        self.assertNotRegex(WORKFLOW, r"--project-ref \"\$(PRODUCTION|PREVIEW)")
        self.assertNotRegex(WORKFLOW, r"SUPABASE_DB_PASSWORD_(PRODUCTION|PREVIEW)")
        self.assertIn("environment: designflow-sandbox", WORKFLOW)

    def test_include_all_only_in_bounded_checkout_after_assert_bounded(self) -> None:
        step = WORKFLOW.split("- name: Bounded dry-run, then apply in apply mode", 1)[1].split("\n      - name:", 1)[0]
        self.assertIn('cd "$RUNNER_TEMP/bounded-sandbox"', step)
        self.assertEqual(WORKFLOW.count("--include-all"), step.count("--include-all"))
        lines = [l.strip() for l in step.splitlines() if l.strip() and not l.strip().startswith("#")]
        for i, line in enumerate(lines):
            if line.startswith("supabase db push --include-all"):
                back = [l for l in lines[:i] if "assert-bounded" in l or "verify-dry-run" in l]
                self.assertTrue(back, "push without a preceding bound proof")
        self.assertIn('if [ "$MODE" = apply ]; then', step)
        self.assertLess(step.index("origin/main moved after dispatch"), step.index("# THE WRITE."))

    def test_allowlist_gate_runs_before_any_github_or_database_read(self) -> None:
        self.assertLess(WORKFLOW.index("- name: Sandbox allowlist gate"), WORKFLOW.index("- name: Bind the source PR"))

    def test_apply_requires_prior_dry_run_and_post_apply_proofs(self) -> None:
        for needle in ("dry_run_run_id", "check-exact-head-approval.mjs", "sandbox-migration-binding.mjs --source-pr", "sandbox-migration-binding.mjs --dry-run-run", "sandbox_migration_preflight.py collisions",
                       "sandbox_migration_preflight.py identity", "verify-ledger", "production_catalog_verification.py",
                       "--ledger-name sandbox"):
            self.assertIn(needle, WORKFLOW)
        self.assertLess(WORKFLOW.index("Refuse a missing sandbox credential"), WORKFLOW.index("supabase link"))

    def test_conditioning_step_sits_between_prepare_and_push_in_both_modes(self) -> None:
        # Issue #2986. The absent-schema conditioning must run inside the bounded
        # checkout only, before the dry-run, so the dry-run proves the exact bytes
        # the apply will run. It is mode-independent by construction: the step is
        # not guarded by an `if:` on inputs.mode.
        self.assertLess(WORKFLOW.index("Build bounded checkout"), WORKFLOW.index("sandbox_migration_preflight.py condition"))
        self.assertLess(WORKFLOW.index("sandbox_migration_preflight.py condition"), WORKFLOW.index("Bounded dry-run, then apply in apply mode"))
        step = WORKFLOW.split("- name: Condition absent-schema statements", 1)[1].split("\n      - name:", 1)[0]
        self.assertNotIn("if: inputs.mode", step)
        self.assertIn('--evidence-out "$RUNNER_TEMP/sandbox-schema-conditioning.json"', step)
        self.assertIn("sandbox-schema-conditioning.json", WORKFLOW.split("path: |", 1)[1])

    def test_the_only_route_prose_names_both_sandbox_writers(self) -> None:
        # The predecessor's manual-repair divergence is closed: the workflow no
        # longer claims to be the only writer, and both writers share the serial
        # group (issue #2986, reviewer M4).
        self.assertNotIn("is the only route in this repository that can write to the sandbox", WORKFLOW)
        self.assertIn("sandbox-ledger-orphan-reconciliation.yml", WORKFLOW)

    def test_apply_binds_the_conditioning_evidence_digest(self) -> None:
        step = WORKFLOW.split("- name: Apply only on the exact successful dry-run evidence", 1)[1].split("\n      - name:", 1)[0]
        self.assertIn("sandbox-schema-conditioning.json", step)
        self.assertIn("PRIOR_DIGEST", step)
        self.assertIn("dispatch a fresh dry-run", step)
        self.assertLess(WORKFLOW.index("sandbox_migration_preflight.py condition"), WORKFLOW.index("- name: Apply only on the exact successful dry-run evidence"))

    def test_sandbox_reconciliation_workflow_is_serial_fail_closed_and_dispatch_only(self) -> None:
        reconcile = (ROOT / ".github" / "workflows" / "sandbox-ledger-orphan-reconciliation.yml").read_text(encoding="utf-8")
        on_block = reconcile.split("\non:\n", 1)[1].split("\npermissions:", 1)[0]
        self.assertIn("workflow_dispatch:", on_block)
        self.assertNotIn("pull_request", on_block)
        self.assertNotIn("merge_group", on_block)
        self.assertRegex(reconcile, r"concurrency:\n  group: designflow-sandbox-migrations\n  cancel-in-progress: false")
        self.assertIn("environment: designflow-sandbox", reconcile)
        self.assertIn("SANDBOX_PROJECT_REF: xupnyeifmpsacrqahwwm", reconcile)
        self.assertNotIn("SUPABASE_DB_PASSWORD_PREVIEW", reconcile)
        self.assertIn("preview_ledger_orphan_reconcile.py --mode check", reconcile)
        self.assertIn("preview_ledger_orphan_reconcile.py --mode apply", reconcile)
        self.assertIn("--reconciliation sandbox", reconcile)
        self.assertIn("config/preview-ledger-orphan-reconciliations.json", reconcile)
        self.assertIn("sandbox_orphan_no_replacement", reconcile)
        self.assertIn("RECONCILE SANDBOX ORPHAN $ORPHAN", reconcile)
        # The target ref is proven at the pooler URL before any psql write.
        self.assertIn('! grep -F "$PRODUCTION_PROJECT_REF_NEVER_WRITE_HERE" supabase/.temp/pooler-url', reconcile)
        self.assertIn('! grep -F "$PREVIEW_PROJECT_REF" supabase/.temp/pooler-url', reconcile)
        # A no-replacement orphan must have no local file on the dispatch commit.
        self.assertIn("sandbox no-replacement orphan must have no local migration file", reconcile)


class ConditioningTests(unittest.TestCase):
    LIVE_WITHOUT_DFLOW_PROD = [
        "api", "app", "auth", "dflow", "extensions", "plm", "public", "storage",
        "supabase_migrations",
    ]

    def _repo(self, name: str, sql: str) -> tuple[Path, Path]:
        tmp = Path(tempfile.mkdtemp())
        migrations = tmp / "supabase" / "migrations"
        migrations.mkdir(parents=True)
        path = migrations / name
        path.write_text(sql, encoding="utf-8")
        return tmp, path

    def test_scan_text_fails_closed_on_unterminated_lexical_state(self) -> None:
        for bad, why in (
            ("select 'unterminated", "single-quoted literal"),
            ('select "unterminated', "quoted identifier"),
            ("do $tag$ begin select 1", "dollar-quoted body"),
            ("/* never closed", "block comment"),
        ):
            with self.assertRaisesRegex(sp.Refusal, why):
                sp.scan_text(bad)

    def test_scan_text_blanks_comments_but_keeps_strings_and_dollar_bodies(self) -> None:
        statement = (
            "-- dflow_prod and plm in a comment only\n"
            "do $v$ begin\n"
            "  if to_regnamespace('dflow_prod') is null then raise exception 'plm'; end if;\n"
            "end $v$"
        )
        text = sp.scan_text(statement)
        self.assertNotIn("in a comment only", text)
        self.assertIn("to_regnamespace('dflow_prod')", text)
        self.assertIn("'plm'", text)

    def test_statement_head_ignores_leading_comments(self) -> None:
        self.assertEqual(sp.statement_head("-- prose\nalter table dflow_prod.t add column x int"), "alter")
        self.assertEqual(sp.statement_head("DO $x$ begin perform 1; end $x$;"), "do")

    def test_statement_spans_split_the_real_phrase_migration(self) -> None:
        path = next((ROOT / "supabase" / "migrations").glob("20260928182014_*.sql"))
        spans = sp.statement_spans(path.read_text(encoding="utf-8"))
        self.assertEqual(len(spans), 4)
        self.assertTrue(all(sp.statement_head(statement) == "alter" for _s, _e, statement in spans))
        self.assertIn('dflow_prod."itemHeader"', spans[2][2])
        self.assertIn('dflow_prod."RFQItem"', spans[3][2])

    def test_phrase_migration_wraps_exactly_its_two_dflow_prod_statements(self) -> None:
        path = next((ROOT / "supabase" / "migrations").glob("20260928182014_*.sql"))
        raw = path.read_text(encoding="utf-8")
        wraps = sp.condition_plan(raw, self.LIVE_WITHOUT_DFLOW_PROD, ["dflow_prod"], "20260928182014")
        self.assertEqual([sp.statement_head(statement) for _s, _e, statement, _g, _t in wraps], ["alter", "alter"])
        adapted = sp.apply_conditioning(raw, wraps)
        self.assertIn("if exists (select 1 from pg_namespace where nspname = 'dflow_prod')", adapted)
        for _s, _e, statement, _g, _t in wraps:
            self.assertIn(statement, adapted)
        # The plm statements are byte-untouched, and the file re-lexes to the same count.
        self.assertIn('alter table plm."itemHeader"', adapted)
        self.assertEqual(len(sp.statement_spans(adapted)), 4)
        self.assertNotIn("plm", [guard for _s, _e, _st, guard, _t in wraps])

    def test_cutover_migration_conditions_alters_comments_and_its_do_block(self) -> None:
        # 20260917013422 carries explicit begin/commit plus a verification do
        # block; the pass-through controls stay untouched while everything that
        # names dflow_prod is guarded, so this rehearsal lane reopens on a
        # sandbox without dflow_prod instead of failing 42P01.
        path = next((ROOT / "supabase" / "migrations").glob("20260917013422_*.sql"))
        raw = path.read_text(encoding="utf-8")
        wraps = sp.condition_plan(raw, self.LIVE_WITHOUT_DFLOW_PROD, ["dflow_prod"], "20260917013422")
        heads = sorted(sp.statement_head(statement) for _s, _e, statement, _g, _t in wraps)
        self.assertEqual(heads, ["alter", "alter", "comment", "comment", "do"])
        adapted = sp.apply_conditioning(raw, wraps)
        self.assertEqual(len(sp.statement_spans(adapted)), len(sp.statement_spans(raw)))
        self.assertIn("begin;\n", adapted)
        self.assertIn("\ncommit;", adapted)

    def test_conditioning_refusals_are_named_and_fail_closed(self) -> None:
        live = self.LIVE_WITHOUT_DFLOW_PROD
        # A statement set whose second statement names BOTH dflow_prod (absent)
        # and plm (live) must never be conditioned.
        with self.assertRaisesRegex(sp.Refusal, "mixed-schema"):
            sp.condition_plan(
                "alter table dflow_prod.t add column if not exists x int;\n"
                "update plm.y set z = 1 where to_regclass('dflow_prod.t') is not null;",
                live, ["dflow_prod"], "20260928000000",
            )
        with self.assertRaisesRegex(sp.Refusal, "dynamic SQL"):
            sp.condition_plan("do $d$ begin execute 'alter table dflow_prod.t add column x int'; end $d$;", live, ["dflow_prod"], "20260928000000")
        with self.assertRaisesRegex(sp.Refusal, "does not condition"):
            sp.condition_plan("create table dflow_prod.t (id int);", live, ["dflow_prod"], "20260928000000")
        with self.assertRaisesRegex(sp.Refusal, "does not condition"):
            sp.condition_plan("insert into dflow_prod.t (id) values (1);", live, ["dflow_prod"], "20260928000000")
        # Transaction control that names the absent schema is refused, not wrapped.
        with self.assertRaisesRegex(sp.Refusal, "transaction control"):
            sp.condition_plan("begin 'dflow_prod';", live, ["dflow_prod"], "20260928000000")
        # A comment-only mention never wraps anything.
        self.assertEqual(sp.condition_plan("-- dflow_prod targets\nalter table plm.t add column x int;", live, ["dflow_prod"], "20260928000000"), [])

    def test_condition_end_to_end_touches_only_the_bounded_checkout(self) -> None:
        import production_migration_guard as guard

        repo, path = self._repo("20260101000000_x.sql", "alter table dflow_prod.t add column x int;\n")
        # A second, untouched bounded file proves the manifest stays pinned to
        # prepare's digest for everything the conditioner did not rewrite.
        untouched = repo / "supabase" / "migrations" / "20260102000000_keep.sql"
        untouched.write_text("alter table plm.t add column y int;\n", encoding="utf-8")
        guard.write_content_manifest(repo)
        manifest = json.loads((repo / "supabase" / "migration-content-manifest.json").read_text(encoding="utf-8"))
        prepare_digest_of_untouched = manifest["20260102000000"]
        evidence = Path(tempfile.mkdtemp()) / "conditioning.json"
        absent_query = lambda ref, token, sql: [{"nspname": name} for name in self.LIVE_WITHOUT_DFLOW_PROD]  # noqa: E731
        present_query = lambda ref, token, sql: [{"nspname": name} for name in self.LIVE_WITHOUT_DFLOW_PROD + ["dflow_prod"]]  # noqa: E731
        sp.condition(repo, "20260101000000", sp.SANDBOX_PROJECT_REF, "t", evidence, query=absent_query)
        adapted = path.read_text(encoding="utf-8")
        self.assertIn("pg_namespace", adapted)
        self.assertIn("alter table dflow_prod.t add column x int", adapted)
        data = json.loads(evidence.read_text(encoding="utf-8"))
        self.assertEqual(data["absent"], ["dflow_prod"])
        self.assertEqual(len(data["files"]), 1)
        self.assertFalse(data["files"][0]["unchanged"])
        self.assertNotEqual(data["files"][0]["original_sha256"], data["files"][0]["adapted_sha256"])
        # The manifest verifies clean, and ONLY the conditioned entry moved:
        # the untouched file still carries prepare's digest (review M3).
        guard.assert_content_manifest(repo)
        manifest = json.loads((repo / "supabase" / "migration-content-manifest.json").read_text(encoding="utf-8"))
        self.assertEqual(manifest["20260102000000"], prepare_digest_of_untouched)
        self.assertEqual(manifest["20260101000000"], data["files"][0]["adapted_sha256"])
        # When the schema exists, the bytes stay identical.
        path.write_text("alter table dflow_prod.t add column x int;\n", encoding="utf-8")
        guard.write_content_manifest(repo)
        before = path.read_bytes()
        sp.condition(repo, "20260101000000", sp.SANDBOX_PROJECT_REF, "t", evidence, query=present_query)
        self.assertEqual(path.read_bytes(), before)
        data = json.loads(evidence.read_text(encoding="utf-8"))
        self.assertEqual(data["absent"], [])
        self.assertTrue(data["files"][0]["unchanged"])
        # Refuses anything but the sandbox ref.
        with self.assertRaises(sp.Refusal):
            sp.condition(repo, "20260101000000", sp.PRODUCTION_PROJECT_REF, "t", evidence, query=absent_query)

    def test_condition_refuses_when_the_manifest_does_not_match_the_bytes(self) -> None:
        import production_migration_guard as guard

        repo, path = self._repo("20260101000000_x.sql", "alter table dflow_prod.t add column x int;\n")
        guard.write_content_manifest(repo)
        path.write_text("alter table dflow_prod.t add column y int;\n", encoding="utf-8")
        evidence = Path(tempfile.mkdtemp()) / "conditioning.json"
        query = lambda ref, token, sql: [{"nspname": name} for name in self.LIVE_WITHOUT_DFLOW_PROD]  # noqa: E731
        from production_migration_guard import GuardError

        with self.assertRaises((sp.Refusal, GuardError)):
            sp.condition(repo, "20260101000000", sp.SANDBOX_PROJECT_REF, "t", evidence, query=query)


if __name__ == "__main__":

    unittest.main()
