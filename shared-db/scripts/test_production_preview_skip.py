"""Production without a shared-preview apply (#2758): classifier and evidence proof."""
import hashlib
import io
import sys
import tempfile
import unittest
import zipfile
from argparse import Namespace
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from production_business_risk_gate import (  # noqa: E402
    EPHEMERAL_ARTIFACT, EPHEMERAL_CHECK_NAME, EPHEMERAL_PRODUCER_PATHS, EPHEMERAL_WORKFLOW, REPOSITORY,
    RiskGateError, assess, git_blob_sha, preview_required_reasons,
    prove_ephemeral_ci_evidence, sql_top_level_statements,
)

VERSION = "20260911000000"
HEAD = "a" * 40
JOB_ID = 555
RUN_ID = 777
ARTIFACT_ID = 999


class Repo:
    def __init__(self, sql: str):
        self._temp = tempfile.TemporaryDirectory()
        self.root = Path(self._temp.name)
        folder = self.root / "supabase" / "migrations"
        folder.mkdir(parents=True)
        self.path = folder / f"{VERSION}_change.sql"
        self.path.write_bytes(sql.encode("utf-8"))

    def close(self):
        self._temp.cleanup()


class PreviewRequiredClassifierTests(unittest.TestCase):
    def reasons(self, sql):
        repo = Repo(sql)
        try:
            return preview_required_reasons(repo.root, [VERSION])
        finally:
            repo.close()

    def assertLowRisk(self, sql):
        self.assertEqual(self.reasons(sql), [], sql)

    def assertHighRisk(self, sql, fragment):
        reasons = self.reasons(sql)
        self.assertTrue(reasons, f"expected high-risk: {sql}")
        self.assertIn(fragment, " ".join(reasons))

    def test_additive_objects_are_low_risk(self):
        self.assertLowRisk("""
            -- create table core.x as select 1;  (a comment is not a statement)
            create schema if not exists reporting;
            create table reporting.item (id bigint primary key, name text not null default 'x');
            create index item_name_idx on reporting.item (name);
            alter table reporting.item add column note text default 'drop table core.item';
            alter table reporting.item enable row level security;
            create policy item_read on reporting.item for select using (true);
            drop policy if exists item_read on reporting.item;
            create or replace function reporting.f() returns int language plpgsql as $fn$
              begin delete from core.item; return 1; end $fn$;
            create or replace view reporting.v as select * from reporting.item;
            grant select on reporting.item to authenticated;
            revoke all on reporting.item from anon;
            comment on table reporting.item is 'x; update core.item set a = 1';
            create index concurrently core_item_idx on core.item (sku);
            alter table core.item add column memo text;
            alter table core.item add constraint memo_len check (length(memo) < 9) not valid;
            notify pgrst, 'reload schema';
        """)

    def test_data_backfills_require_preview(self):
        for sql in ("insert into core.item values (1)", "update core.item set a = 1",
                    "delete from core.item", "truncate core.item",
                    "do $$ begin perform 1; end $$", "select core.backfill()",
                    "with x as (select 1) insert into core.item select * from x",
                    "create table core.copy as select * from core.item"):
            self.assertHighRisk(sql, "data")

    def test_destructive_drops_require_preview(self):
        for sql in ("drop table core.item", "drop column_thing", "drop policy if exists p on core.item",
                    "drop function if exists core.f()", "drop index core.item_idx"):
            self.assertHighRisk(sql, "destructive drop")

    def test_rewrites_and_long_locks_require_preview(self):
        self.assertHighRisk("create index item_idx on core.item (sku)", "index build")
        self.assertHighRisk("create unique index concurrently_is_a_name on core.item (sku)", "index build")
        self.assertHighRisk("alter table core.item alter column sku type bigint", "rewrite")
        self.assertHighRisk("alter table core.item add column a int not null default 0", "rewrite")
        self.assertHighRisk("alter table core.item add column a int generated always as identity", "rewrite")
        self.assertHighRisk("alter table core.item add constraint u unique (sku)", "rewrite")
        self.assertHighRisk("alter table core.item add constraint c check (a > 0)", "rewrite")
        self.assertHighRisk("alter table core.item add column memo text, alter column sku type bigint", "rewrite")
        self.assertHighRisk("lock table core.item", "long lock")
        self.assertHighRisk("vacuum full core.item", "long lock")
        self.assertHighRisk("refresh materialized view core.mv", "long lock")

    def test_unknown_and_unparseable_sql_requires_preview(self):
        self.assertHighRisk("security label on table core.item is 'x'", "not recognised")
        self.assertHighRisk("create table core.x (a text default 'unterminated)", "unparseable")
        self.assertHighRisk("-- only a comment\n", "empty migration")

    def test_new_table_scope_is_by_exact_name(self):
        # An index on an EXISTING table is not excused by a same-named new table elsewhere.
        self.assertHighRisk(
            "create table reporting.item (id bigint); create index i on core.item (id)", "index build")

    def test_hidden_defaults_are_rewrites(self):
        # #2771 review: serial implies NOT NULL DEFAULT nextval(); a domain can carry a default.
        for column in ("serial", "bigserial", "smallserial", "serial8", "d",
                       "core.money_with_default", '"MyDomain"', "int not null", "text collate \"C\" default 'x'"):
            self.assertHighRisk(f"alter table core.item add column x {column}", "rewrite")
        self.assertHighRisk(
            "create domain d as int default random(); alter table core.item add column x d", "rewrite")
        for column in ("text", "bigint", "numeric(12, 2)", "varchar(40)", "timestamp with time zone",
                       "jsonb", "text[]", 'text collate "C"', "uuid null"):
            self.assertLowRisk(f"alter table core.item add column x {column}")

    def test_table_identity_follows_postgres_quoting(self):
        # "Item" and item are different tables; "core.item" is one quoted name, not core.item.
        self.assertHighRisk(
            'create table core."Item" (id bigint); alter table core.item add column a int not null default 0',
            "rewrite")
        self.assertHighRisk(
            'create table "core.item" (id bigint); create index i on core.item (id)', "index build")
        self.assertHighRisk(
            'create table "core.item" (id bigint); alter table core.item alter column id type text', "rewrite")
        self.assertLowRisk(
            'create table core."Item" (id bigint); create index i on core."Item" (id)')
        self.assertLowRisk(
            "create table core.fresh (id bigint); alter table CORE.Fresh add column a int not null default 0")

    def test_unqualified_new_table_not_excused_after_search_path_change(self):
        self.assertHighRisk(
            "create table item (id bigint); set search_path = core; create index i on item (id)", "index build")
        self.assertLowRisk("create table item (id bigint); create index i on item (id)")

    def test_builtin_type_spelling_not_trusted_after_search_path_change(self):
        # #2771 review: a domain named text shadows pg_catalog.text once pg_catalog is later in the path.
        for path in ("set search_path = public, pg_catalog", "set local search_path to public, pg_catalog",
                     "select set_config('search_path', 'public, pg_catalog', true)"):
            self.assertHighRisk(
                f"create domain public.text as int not null default 0; {path};"
                " alter table core.item add column x text", "rewrite")
        self.assertLowRisk("alter table core.item add column x text")

    def test_create_table_if_not_exists_does_not_excuse_later_changes(self):
        # The table may already exist with rows, so it is not a new table.
        self.assertLowRisk("create table if not exists core.item (id bigint)")
        self.assertHighRisk(
            "create table if not exists core.item (id bigint); create index i on core.item (id)", "index build")
        self.assertHighRisk(
            "create table if not exists core.item (id bigint);"
            " alter table core.item add column a int not null default 0", "rewrite")

    def test_recreate_drop_is_bound_to_the_same_table(self):
        self.assertHighRisk(
            "create policy p on reporting.item for select using (true); drop policy if exists p on core.item",
            "destructive drop")
        self.assertHighRisk(
            "create trigger t before insert on reporting.item for each row execute function f();"
            " drop trigger if exists t on core.item", "destructive drop")
        self.assertHighRisk(
            'create policy "P" on core.item for select using (true); drop policy if exists p on core.item',
            "destructive drop")
        self.assertLowRisk(
            "drop policy if exists p on core.item; create policy p on core.item for select using (true)")
        self.assertLowRisk(
            "drop trigger if exists t on core.item;"
            " create or replace trigger t after insert or update of sku on core.item"
            " for each row execute function core.f()")

    def test_tokeniser_neutralises_literals(self):
        self.assertEqual(
            sql_top_level_statements("select 'a;b'; select $x$ ; $x$; -- ; \n select 1"),
            ["select ''", "select $$ $$", "select 1"])


def artifact_zip(applied, failed_pass2):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        if applied is not None:
            archive.writestr("applied-migrations.txt", applied)
        if failed_pass2 is not None:
            archive.writestr("failed-migrations-pass2.txt", failed_pass2)
    return buffer.getvalue()


class EphemeralEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.repo = Repo("create table reporting.item (id bigint);\n")
        self.addCleanup(self.repo.close)
        self.base = self.repo.path.name
        self.job = {"id": JOB_ID, "name": EPHEMERAL_CHECK_NAME, "status": "completed",
                    "conclusion": "success", "head_sha": HEAD, "run_id": RUN_ID}
        self.run = {"id": RUN_ID, "path": EPHEMERAL_WORKFLOW, "event": "pull_request",
                    "status": "completed", "conclusion": "success", "head_sha": HEAD,
                    "repository": {"full_name": REPOSITORY}}
        self.zip_bytes = artifact_zip(self.base + "\n", "")
        self.artifact = {"id": ARTIFACT_ID, "name": EPHEMERAL_ARTIFACT, "expired": False,
                         "workflow_run": {"id": RUN_ID}}
        self.head_blob = git_blob_sha(self.repo.path)
        self.producer_blobs = {}
        for path in EPHEMERAL_PRODUCER_PATHS:
            on_main = self.repo.root / path
            on_main.parent.mkdir(parents=True, exist_ok=True)
            on_main.write_bytes(f"honest {path}\n".encode("utf-8"))
            self.producer_blobs[path] = git_blob_sha(on_main)

    def api(self, endpoint):
        if endpoint == f"repos/{REPOSITORY}/actions/jobs/{JOB_ID}":
            return self.job
        if endpoint == f"repos/{REPOSITORY}/actions/runs/{RUN_ID}":
            return self.run
        if endpoint == f"repos/{REPOSITORY}/actions/runs/{RUN_ID}/artifacts?per_page=100":
            digest = "sha256:" + hashlib.sha256(self.zip_bytes).hexdigest()
            return {"artifacts": [{**self.artifact, "digest": self.artifact.get("digest", digest)}]}
        if endpoint == f"repos/{REPOSITORY}/git/trees/{HEAD}?recursive=1":
            return {"truncated": False, "tree": [
                {"path": f"supabase/migrations/{self.base}", "type": "blob", "sha": self.head_blob},
                *({"path": path, "type": "blob", "sha": sha} for path, sha in self.producer_blobs.items())]}
        raise AssertionError(f"unexpected endpoint {endpoint}")

    def downloader(self, artifact_id, destination):
        self.assertEqual(artifact_id, ARTIFACT_ID)
        destination.write_bytes(self.zip_bytes)

    def prove(self, check_run_id=str(JOB_ID)):
        return prove_ephemeral_ci_evidence(
            check_run_id_text=check_run_id, pr_head=HEAD, allowlist=[VERSION],
            api=self.api, downloader=self.downloader, repo_root=self.repo.root)

    def assertRefused(self, fragment):
        with self.assertRaises(RiskGateError) as caught:
            self.prove()
        self.assertIn(fragment, str(caught.exception))

    def test_exact_head_green_applied_run_is_accepted(self):
        evidence = self.prove()
        self.assertEqual(evidence["checkRunId"], JOB_ID)
        self.assertEqual(evidence["runId"], RUN_ID)
        self.assertEqual(evidence["migrationBlobs"], {VERSION: self.head_blob})

    def test_malformed_job_id_is_refused(self):
        for bad in ("", "0", "12a", "https://github.com/x"):
            with self.assertRaises(RiskGateError):
                self.prove(bad)

    def test_wrong_check_name_is_refused(self):
        self.job["name"] = "SQL migration guards"
        self.assertRefused("wrong name")

    def test_failed_check_is_refused(self):
        self.job["conclusion"] = "failure"
        self.assertRefused("wrong conclusion")

    def test_check_on_another_head_is_refused(self):
        self.job["head_sha"] = "b" * 40
        self.assertRefused("wrong head_sha")

    def test_run_from_another_workflow_or_event_is_refused(self):
        self.run["path"] = ".github/workflows/other.yml"
        self.assertRefused("wrong path")
        self.run["path"] = EPHEMERAL_WORKFLOW
        self.run["event"] = "workflow_dispatch"
        self.assertRefused("wrong event")

    def test_expired_artifact_is_refused(self):
        self.artifact["expired"] = True
        self.assertRefused("expired")

    def test_artifact_bytes_must_match_digest(self):
        self.artifact["digest"] = "sha256:" + "0" * 64
        self.assertRefused("do not match")

    def test_migration_not_positively_applied_is_refused(self):
        self.zip_bytes = artifact_zip("", "")
        self.assertRefused("did not prove")

    def test_migration_still_failing_after_pass_two_is_refused(self):
        self.zip_bytes = artifact_zip(self.base + "\n", self.base + "\n")
        self.assertRefused("did not prove")

    def test_run_predating_applied_record_is_refused(self):
        self.zip_bytes = artifact_zip(None, "")
        self.assertRefused("predates")

    def test_main_bytes_differing_from_tested_head_are_refused(self):
        self.head_blob = "c" * 40
        self.assertRefused("differs")

    def test_doctored_producer_on_tested_head_is_refused(self):
        # #2771 review: a pull_request run executes the PR's own workflow, which
        # could write every basename into the applied record without applying.
        for path in EPHEMERAL_PRODUCER_PATHS:
            with self.subTest(path=path):
                honest = self.producer_blobs[path]
                self.producer_blobs[path] = "d" * 40
                self.assertRefused(f"producer {path}")
                self.producer_blobs[path] = honest

    def test_producer_missing_from_tested_head_is_refused(self):
        del self.producer_blobs[EPHEMERAL_WORKFLOW]
        self.assertRefused("absent")

    def test_producer_list_names_the_record_writers(self):
        self.assertIn(EPHEMERAL_WORKFLOW, EPHEMERAL_PRODUCER_PATHS)
        workflow = (Path(__file__).parent.parent / EPHEMERAL_WORKFLOW).read_text(encoding="utf-8")
        for path in EPHEMERAL_PRODUCER_PATHS[1:]:
            self.assertIn(path, workflow)


class RouteSelectionTests(unittest.TestCase):
    def args(self, **overrides):
        values = dict(repo=Path("."), activation=Path("missing.json"), main_sha=HEAD,
                      allowlist=VERSION, pr=1, review_run_id=1, review_digest="sha256:" + "0" * 64,
                      preview_run_id=None, preview_digest=None, preview_project_ref=None,
                      ephemeral_check_run_id=None, owner_decision_run_id=None, owner_decision_digest=None)
        values.update(overrides)
        return Namespace(**values)

    def refuse(self, args, fragment):
        with self.assertRaises(RiskGateError) as caught:
            assess(args, api=lambda endpoint: self.fail(endpoint), downloader=lambda *_: self.fail("download"))
        self.assertIn(fragment, str(caught.exception))

    def test_both_routes_together_are_refused(self):
        self.refuse(self.args(preview_run_id="1", ephemeral_check_run_id="2"), "not both")

    def test_no_route_is_refused(self):
        self.refuse(self.args(), "promotion needs")
        self.refuse(self.args(preview_run_id="1"), "promotion needs")

    def test_empty_workflow_inputs_count_as_absent(self):
        self.refuse(self.args(preview_run_id="", preview_digest=" ", ephemeral_check_run_id=""), "promotion needs")


if __name__ == "__main__":
    unittest.main()
