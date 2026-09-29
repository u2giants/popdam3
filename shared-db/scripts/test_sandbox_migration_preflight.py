"""Offline tests for the DesignFlow sandbox migration route (issue #3428)."""
from __future__ import annotations

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


if __name__ == "__main__":
    unittest.main()
