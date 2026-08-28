#!/usr/bin/env python3
"""Reconcile one proven preview-only ledger orphan without touching schema DDL."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
from pathlib import Path

from atomic_migration_apply import TX_RE, linked_connection, psql, split_sql
from production_migration_guard import parse_remote_versions


class Refusal(RuntimeError):
    pass


SUPPORTED_CASES = {
    (1090, 1100, 1108): {
        "mode": "replacement_already_applied",
    },
    (1211, 1371, 1372): {
        "mode": "replacement_pending",
        "orphan_version": "20260824002102",
        "replacement_version": "20260824004025",
        "orphan_run_head": "24a39f3f66ff26a8eee825b4acf54531a128f654",
    },
    (1211, 1371, 1372, "20260824004025", "20260824004025"): {
        "mode": "rehearsal_reset",
        "original_run_head": "88ebd0272a163d32aefe748d59c7096c8fe54d0e",
    },
    (1467, 1580, 1585, "20260827183106", "20260827183106"): {
        "mode": "rehearsal_reset",
        "original_run_head": "4355d0567de4bf9168f5701efc7107215ee386f3",
        "preview_run_id": 33106059012,
        "preview_artifact_id": 9660512462,
        "preview_artifact_digest": "sha256:308962bcc35231b9c1d9187761822428ae34d89980c145baff9394d80dde7c7a",
        "issue_state": "open",
        "claim_state": "open",
    },
    (1422, 1423, 1424): {
        "mode": "replacement_pending",
        "orphan_version": "20260824150630",
        "replacement_version": "20260824172136",
        "orphan_run_head": "12f104735379881e6ff90a00b090a65ab9e8d370",
        "preview_run_id": 32746510664,
        "preview_artifact_id": 9527303479,
        "preview_artifact_digest": "sha256:a2b4cf00749dc7ee7d8db10290650612c63fd5d15ed5e9c3ae6f60d7b58c3be2",
        "merged_source": True,
    },
    (1439, 1488, 1495): {
        "mode": "replacement_pending",
        "orphan_version": "20260825102716",
        "replacement_version": "20260825110813",
        "orphan_run_head": "8db5074d814118311269d0d3ac04eb2f3ad40928",
    },
    (1615, 1636, 1637): {
        "mode": "byte_identical_rename",
        "orphan_version": "20260827031236",
        "replacement_version": "20260827095753",
        "orphan_run_head": "9f0753c89d3bf1e64b52877400098f3cd086a9ea",
        "preview_run_id": 33059235415,
        "preview_artifact_id": 9640989399,
        "preview_artifact_digest": "sha256:d41f5cc6250eb783b4e17399e3927cd9ada32ac26a12adcc8124a1f5d3262d03",
        "merged_source": True,
        "issue_state": "open",
        "claim_state": "closed",
    },
    (1658, 1659, 1660): {
        "mode": "replacement_pending",
        "orphan_version": "20260827134155",
        "replacement_version": "20260827214517",
        "orphan_run_head": "b49a5665060fcc9a100f12a096460ea44a30451c",
        # The apply was dispatched from main against the PR commit, so the run head is
        # the workflow definition commit and the applied source is this commit. Older
        # cases dispatched from the branch itself, where the two are the same sha.
        "orphan_commit_sha": "d15a69a825cbf0d365b1ffac825a2db4c22db63b",
        "preview_run_id": 33095556822,
        "preview_artifact_id": 9656250972,
        "preview_artifact_digest": "sha256:ec03dc67ce845c6db231a56555803d1daddd6869fc61019ccd89f3f27f6878ce",
    },
}


def version(value: str) -> str:
    if not re.fullmatch(r"\d{14}", value or ""):
        raise Refusal("migration versions must be exactly 14 digits")
    return value


def read_json(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise Refusal(f"unreadable JSON evidence: {path.name}") from exc


def git(repo: Path, *args: str) -> str:
    result = subprocess.run(["git", "-C", str(repo), *args], text=True, capture_output=True)
    if result.returncode:
        raise Refusal("git evidence check failed")
    return result.stdout.strip()


def load_replacement(directory: Path, replacement: str) -> tuple[Path, list[str]]:
    matches = list(directory.glob(f"{replacement}_*.sql"))
    if len(matches) != 1:
        raise Refusal("replacement version must resolve to exactly one migration file")
    raw = matches[0].read_text(encoding="utf-8")
    statements = split_sql(raw)
    controls = [statement for statement in statements if TX_RE.match(re.sub(r"(?s)^\s*(?:--[^\n]*\n|/\*.*?\*/\s*)*", "", statement))]
    if not statements or controls:
        raise Refusal("replacement migration is empty or contains transaction control")
    return matches[0], statements


def validate_pinned_evidence(case: dict, args) -> None:
    for case_key, arg_name in (
        ("preview_run_id", "preview_run_id"),
        ("preview_artifact_id", "preview_artifact_id"),
        ("preview_artifact_digest", "preview_artifact_digest"),
    ):
        if case_key in case and case[case_key] != getattr(args, arg_name):
            raise Refusal("preview run or artifact is not the pinned supported-case evidence")


def expected_work_states(case: dict) -> tuple[str, str]:
    issue_state = case.get("issue_state", "closed" if case.get("merged_source") else "open")
    claim_state = case.get(
        "claim_state",
        "closed" if case["mode"] == "rehearsal_reset" or case.get("merged_source") else "open",
    )
    return issue_state, claim_state


def assert_case_statement_contract(case: dict, orphan_statements: list[str], replacement_statements: list[str]) -> None:
    if case["mode"] == "byte_identical_rename" and orphan_statements != replacement_statements:
        raise Refusal("byte-identical ledger rename requires exact migration statement identity")


def validate_governance(args, orphan_statements: list[str], replacement_statements: list[str]) -> dict:
    repo = args.repo.resolve()
    if git(repo, "rev-parse", "HEAD") != args.main_sha or git(repo, "rev-parse", "origin/main") != args.main_sha:
        raise Refusal("checkout is not exact current main")
    case = SUPPORTED_CASES.get(
        (args.issue, args.claim, args.source_pr, args.orphan_version, args.replacement_version),
        SUPPORTED_CASES.get((args.issue, args.claim, args.source_pr)),
    )
    if not case:
        raise Refusal("issue, claim, and pull request are not an explicitly supported reconciliation case")
    if list((repo / "supabase/migrations").glob(f"{args.orphan_version}_*.sql")) and case.get("mode") != "rehearsal_reset":
        raise Refusal("orphan version still exists on current main")
    if case.get("orphan_version", args.orphan_version) != args.orphan_version or case.get("replacement_version", args.replacement_version) != args.replacement_version:
        raise Refusal("migration versions do not match the explicitly supported reconciliation case")
    assert_case_statement_contract(case, orphan_statements, replacement_statements)
    issue, claim, pr, pr_files, run, artifact = (read_json(p) for p in (args.issue_json, args.claim_json, args.pr_json, args.pr_files_json, args.run_json, args.artifact_json))
    expected_issue_state, expected_claim_state = expected_work_states(case)
    if issue.get("number") != args.issue or issue.get("state") != expected_issue_state:
        raise Refusal("work issue is not the exact supported-case issue")
    if claim.get("number") != args.claim or claim.get("state") != expected_claim_state or f"#{args.issue}" not in claim.get("title", ""):
        raise Refusal("claim state or identity does not match the supported reconciliation case")
    if not re.search(rf"^version: {re.escape(args.replacement_version)}$", claim.get("body", ""), re.M):
        raise Refusal("claim does not bind the replacement version")
    if pr.get("number") != args.source_pr:
        raise Refusal("source pull request is not the exact pull request")
    if case["mode"] in {"replacement_already_applied", "rehearsal_reset"} or case.get("merged_source"):
        if not pr.get("merged") or not pr.get("merge_commit_sha"):
            raise Refusal("source pull request is not the exact merged PR")
        git(repo, "merge-base", "--is-ancestor", pr["merge_commit_sha"], args.main_sha)
    elif pr.get("state") != "open" or pr.get("merged") or pr.get("head", {}).get("sha") != git(args.source_pr_dir, "rev-parse", "HEAD"):
        raise Refusal("pending replacement must be the exact open pull request head")
    expected_path = f"supabase/migrations/{args.replacement_version}_{args.replacement_migration.name.split('_', 1)[1]}"
    if not isinstance(pr_files, list) or [row.get("filename") for row in pr_files].count(expected_path) != 1:
        raise Refusal("source PR does not uniquely author the replacement migration")
    if case["mode"] != "rehearsal_reset" and any(str(row.get("filename", "")).startswith(f"supabase/migrations/{args.orphan_version}_") for row in pr_files):
        raise Refusal("source PR still exposes the orphan version")
    if run.get("id") != args.preview_run_id or run.get("status") != "completed" or run.get("conclusion") != "success":
        raise Refusal("preview run is not the exact successful run")
    validate_pinned_evidence(case, args)
    if run.get("event") != "workflow_dispatch" or not str(run.get("path", "")).startswith(".github/workflows/shared-supabase-migrations.yml"):
        raise Refusal("preview run is not the governed shared migration workflow")
    if artifact.get("id") != args.preview_artifact_id or artifact.get("workflow_run", {}).get("id") != args.preview_run_id or artifact.get("digest") != args.preview_artifact_digest or artifact.get("expired"):
        raise Refusal("preview artifact identity or digest mismatch")
    orphan_commit = case.get("orphan_commit_sha", run.get("head_sha"))
    if artifact.get("name") != f"preview-migration-apply-{orphan_commit}":
        raise Refusal("preview artifact is not the exact applied-source apply evidence")
    expected_run_head = case.get("original_run_head", case.get("orphan_run_head", run.get("head_sha")))
    if expected_run_head != run.get("head_sha") or orphan_commit != git(args.orphan_source_dir, "rev-parse", "HEAD"):
        raise Refusal("preview run is not the exact orphan source commit")

    before_path = args.preview_evidence_dir / "preview-ledger-before.txt"
    after_path = args.preview_evidence_dir / "preview-ledger-after.txt"
    before = before_path.read_text(encoding="utf-8")
    after = after_path.read_text(encoding="utf-8")
    apply = (args.preview_evidence_dir / "preview-apply.txt").read_text(encoding="utf-8")
    before_versions, after_versions = parse_remote_versions(before_path), parse_remote_versions(after_path)
    evidence_version = args.replacement_version if case["mode"] in {"replacement_already_applied", "rehearsal_reset"} else args.orphan_version
    if evidence_version in before_versions or evidence_version not in after_versions or after_versions - before_versions != {evidence_version}:
        raise Refusal("preview artifact does not prove the exact one-version ledger addition")
    if f"Applying migration {evidence_version}_" not in apply:
        raise Refusal("preview artifact does not prove the exact migration application")
    return {"case_mode": case["mode"], "orphan_statement_count": len(orphan_statements), "replacement_statement_count": len(replacement_statements), "orphan_sha256": hashlib.sha256(args.orphan_migration.read_bytes()).hexdigest(), "replacement_sha256": hashlib.sha256(args.replacement_migration.read_bytes()).hexdigest()}


def ledger_rows(url: str, env: dict[str, str], old: str, replacement: str) -> list[dict]:
    sql = (
        "select coalesce(jsonb_agg(jsonb_build_object('version',version,'name',name,'statements',statements) order by version),'[]'::jsonb)::text "
        "from supabase_migrations.schema_migrations where version in ('" + old + "','" + replacement + "');\n"
    )
    value = json.loads(psql(url, env, sql))
    if not isinstance(value, list):
        raise Refusal("migration ledger returned an invalid shape")
    return value


def reconcile(url: str, env: dict[str, str], args, expected_orphan: list[str], expected_replacement: list[str], case_mode: str) -> tuple[list[dict], list[dict]]:
    before = ledger_rows(url, env, args.orphan_version, args.replacement_version)
    by_version = {str(row.get("version")): row for row in before}
    expected_versions = {args.orphan_version, args.replacement_version} if case_mode == "replacement_already_applied" else {args.orphan_version}
    if len(before) != len(expected_versions) or set(by_version) != expected_versions:
        raise Refusal("ledger rows do not match the supported reconciliation phase")
    if by_version[args.orphan_version].get("statements") != expected_orphan:
        raise Refusal("orphan statements are not exact source migration bytes")
    if case_mode in {"replacement_already_applied", "rehearsal_reset"} and by_version[args.replacement_version].get("statements") != expected_replacement:
        raise Refusal("replacement statements are not exact source migration bytes")
    if args.mode == "check":
        return before, before
    expected_json = json.dumps(expected_orphan, separators=(",", ":"))
    if case_mode == "byte_identical_rename":
        replacement_name = args.replacement_migration.stem.split("_", 1)[1].replace("'", "''")
        sql = rf"""\set ON_ERROR_STOP on
begin;
lock table supabase_migrations.schema_migrations in exclusive mode;
do $reconcile$
declare n integer;
begin
  if (select count(*) from supabase_migrations.schema_migrations where version in ('{args.orphan_version}','{args.replacement_version}')) <> 1
     or not exists (select 1 from supabase_migrations.schema_migrations where version='{args.orphan_version}') then
    raise exception 'ledger ownership changed before reconciliation';
  end if;
  if (select to_jsonb(statements) from supabase_migrations.schema_migrations where version='{args.orphan_version}') is distinct from $expected${expected_json}$expected$::jsonb then
    raise exception 'ledger statements changed before reconciliation';
  end if;
  update supabase_migrations.schema_migrations
  set version='{args.replacement_version}', name='{replacement_name}'
  where version='{args.orphan_version}';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'reconciliation did not rename exactly one row'; end if;
end $reconcile$;
commit;
"""
        psql(url, env, sql)
        after = ledger_rows(url, env, args.orphan_version, args.replacement_version)
        if len(after) != 1 or str(after[0].get("version")) != args.replacement_version or after[0].get("statements") != expected_replacement:
            raise Refusal("post-reconciliation readback is not the exact renamed ledger row")
        return before, after
    sql = rf"""\set ON_ERROR_STOP on
begin;
lock table supabase_migrations.schema_migrations in exclusive mode;
do $reconcile$
declare n integer;
begin
  if (select count(*) from supabase_migrations.schema_migrations where version in ('{args.orphan_version}','{args.replacement_version}')) <> {len(expected_versions)} then
    raise exception 'ledger ownership changed before reconciliation';
  end if;
  if (select to_jsonb(statements) from supabase_migrations.schema_migrations where version='{args.orphan_version}') <> $expected${expected_json}$expected$::jsonb
     or (select to_jsonb(statements) from supabase_migrations.schema_migrations where version='{args.replacement_version}') <> $expected${expected_json}$expected$::jsonb then
    raise exception 'ledger statements changed before reconciliation';
  end if;
  delete from supabase_migrations.schema_migrations where version='{args.orphan_version}';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'reconciliation did not delete exactly one row'; end if;
  if (select count(*) from supabase_migrations.schema_migrations where version='{args.replacement_version}') <> {1 if case_mode == 'replacement_already_applied' else 0} then
    raise exception 'replacement ledger state changed'; end if;
end $reconcile$;
commit;
"""
    psql(url, env, sql)
    after = ledger_rows(url, env, args.orphan_version, args.replacement_version)
    expected_after = [args.replacement_version] if case_mode == "replacement_already_applied" else []
    if [str(row.get("version")) for row in after] != expected_after:
        raise Refusal("post-reconciliation readback is not the exact expected phase")
    return before, after


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--mode", choices=("check", "apply"), required=True)
    p.add_argument("--repo", type=Path, required=True); p.add_argument("--linked-dir", type=Path, required=True)
    p.add_argument("--source-pr-dir", type=Path, required=True); p.add_argument("--orphan-source-dir", type=Path, required=True)
    p.add_argument("--expected-project-ref", required=True); p.add_argument("--main-sha", required=True)
    p.add_argument("--orphan-version", type=version, required=True); p.add_argument("--replacement-version", type=version, required=True)
    p.add_argument("--issue", type=int, required=True); p.add_argument("--claim", type=int, required=True); p.add_argument("--source-pr", type=int, required=True)
    p.add_argument("--preview-run-id", type=int, required=True); p.add_argument("--preview-artifact-id", type=int, required=True); p.add_argument("--preview-artifact-digest", required=True)
    p.add_argument("--issue-json", type=Path, required=True); p.add_argument("--claim-json", type=Path, required=True); p.add_argument("--pr-json", type=Path, required=True); p.add_argument("--pr-files-json", type=Path, required=True)
    p.add_argument("--run-json", type=Path, required=True); p.add_argument("--artifact-json", type=Path, required=True); p.add_argument("--preview-evidence-dir", type=Path, required=True)
    p.add_argument("--evidence-out", type=Path, required=True)
    return p.parse_args()


def main() -> int:
    try:
        args = parse_args()
        case = SUPPORTED_CASES.get(
            (args.issue, args.claim, args.source_pr, args.orphan_version, args.replacement_version),
            SUPPORTED_CASES.get((args.issue, args.claim, args.source_pr)),
        )
        if args.orphan_version == args.replacement_version and (not case or case.get("mode") != "rehearsal_reset"):
            raise Refusal("reconciliation is preview-only and requires two different versions")
        if not re.fullmatch(r"[a-z]{20}", args.expected_project_ref) or args.expected_project_ref == "qsllyeztdwjgirsysgai":
            raise Refusal("reconciliation requires a configured non-production Supabase project ref")
        args.replacement_migration, replacement_statements = load_replacement(args.source_pr_dir / "supabase/migrations", args.replacement_version)
        if case and case["mode"] in {"replacement_already_applied", "rehearsal_reset"}:
            args.orphan_migration, orphan_statements = args.replacement_migration, replacement_statements
        else:
            args.orphan_migration, orphan_statements = load_replacement(args.orphan_source_dir / "supabase/migrations", args.orphan_version)
        governance = validate_governance(args, orphan_statements, replacement_statements)
        url, env = linked_connection(args.linked_dir, args.expected_project_ref)
        before, after = reconcile(url, env, args, orphan_statements, replacement_statements, governance["case_mode"])
        args.evidence_out.write_text(json.dumps({"schema":"shared-db-preview-ledger-orphan-reconciliation/v1","mode":args.mode,"project_ref":args.expected_project_ref,"main_sha":args.main_sha,"issue":args.issue,"claim":args.claim,"source_pr":args.source_pr,"orphan_version":args.orphan_version,"replacement_version":args.replacement_version,"preview_run_id":args.preview_run_id,"preview_artifact_id":args.preview_artifact_id,"preview_artifact_digest":args.preview_artifact_digest,"governance":governance,"before":before,"after":after}, sort_keys=True, separators=(",", ":")) + "\n", encoding="utf-8")
        print(f"PREVIEW LEDGER RECONCILIATION {args.mode.upper()} OK: removed={args.orphan_version if args.mode == 'apply' else 'none'} replacement={args.replacement_version}")
        return 0
    except (Refusal, RuntimeError, OSError, ValueError) as exc:
        print(f"REFUSED: {exc}", file=__import__('sys').stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
