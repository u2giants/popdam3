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


def validate_governance(args, orphan_statements: list[str], replacement_statements: list[str]) -> dict:
    repo = args.repo.resolve()
    if git(repo, "rev-parse", "HEAD") != args.main_sha or git(repo, "rev-parse", "origin/main") != args.main_sha:
        raise Refusal("checkout is not exact current main")
    if list((repo / "supabase/migrations").glob(f"{args.orphan_version}_*.sql")):
        raise Refusal("orphan version still exists on current main")

    case = SUPPORTED_CASES.get((args.issue, args.claim, args.source_pr))
    if not case:
        raise Refusal("issue, claim, and pull request are not an explicitly supported reconciliation case")
    if case.get("orphan_version", args.orphan_version) != args.orphan_version or case.get("replacement_version", args.replacement_version) != args.replacement_version:
        raise Refusal("migration versions do not match the explicitly supported reconciliation case")
    issue, claim, pr, pr_files, run, artifact = (read_json(p) for p in (args.issue_json, args.claim_json, args.pr_json, args.pr_files_json, args.run_json, args.artifact_json))
    if issue.get("number") != args.issue or issue.get("state") != "open":
        raise Refusal("work issue is not the exact open issue")
    if claim.get("number") != args.claim or claim.get("state") != "open" or f"#{args.issue}" not in claim.get("title", ""):
        raise Refusal("claim is not the exact open issue claim")
    if not re.search(rf"^version: {re.escape(args.replacement_version)}$", claim.get("body", ""), re.M):
        raise Refusal("claim does not bind the replacement version")
    if pr.get("number") != args.source_pr:
        raise Refusal("source pull request is not the exact pull request")
    if case["mode"] == "replacement_already_applied":
        if not pr.get("merged") or not pr.get("merge_commit_sha"):
            raise Refusal("source pull request is not the exact merged PR")
        git(repo, "merge-base", "--is-ancestor", pr["merge_commit_sha"], args.main_sha)
    elif pr.get("state") != "open" or pr.get("merged") or pr.get("head", {}).get("sha") != git(args.source_pr_dir, "rev-parse", "HEAD"):
        raise Refusal("pending replacement must be the exact open pull request head")
    expected_path = f"supabase/migrations/{args.replacement_version}_{args.replacement_migration.name.split('_', 1)[1]}"
    if not isinstance(pr_files, list) or [row.get("filename") for row in pr_files].count(expected_path) != 1:
        raise Refusal("source PR does not uniquely author the replacement migration")
    if any(str(row.get("filename", "")).startswith(f"supabase/migrations/{args.orphan_version}_") for row in pr_files):
        raise Refusal("source PR still exposes the orphan version")
    if run.get("id") != args.preview_run_id or run.get("status") != "completed" or run.get("conclusion") != "success":
        raise Refusal("preview run is not the exact successful run")
    if run.get("event") != "workflow_dispatch" or not str(run.get("path", "")).startswith(".github/workflows/shared-supabase-migrations.yml"):
        raise Refusal("preview run is not the governed shared migration workflow")
    if artifact.get("id") != args.preview_artifact_id or artifact.get("workflow_run", {}).get("id") != args.preview_run_id or artifact.get("digest") != args.preview_artifact_digest or artifact.get("expired"):
        raise Refusal("preview artifact identity or digest mismatch")
    if artifact.get("name") != f"preview-migration-apply-{run.get('head_sha')}":
        raise Refusal("preview artifact is not the exact run-head apply evidence")
    if case.get("orphan_run_head", run.get("head_sha")) != run.get("head_sha") or run.get("head_sha") != git(args.orphan_source_dir, "rev-parse", "HEAD"):
        raise Refusal("preview run is not the exact orphan source commit")

    before_path = args.preview_evidence_dir / "preview-ledger-before.txt"
    after_path = args.preview_evidence_dir / "preview-ledger-after.txt"
    before = before_path.read_text(encoding="utf-8")
    after = after_path.read_text(encoding="utf-8")
    apply = (args.preview_evidence_dir / "preview-apply.txt").read_text(encoding="utf-8")
    before_versions, after_versions = parse_remote_versions(before_path), parse_remote_versions(after_path)
    evidence_version = args.replacement_version if case["mode"] == "replacement_already_applied" else args.orphan_version
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
    if case_mode == "replacement_already_applied" and by_version[args.replacement_version].get("statements") != expected_replacement:
        raise Refusal("replacement statements are not exact source migration bytes")
    if args.mode == "check":
        return before, before
    expected_json = json.dumps(expected_orphan, separators=(",", ":"))
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
        if args.orphan_version == args.replacement_version:
            raise Refusal("reconciliation is preview-only and requires two different versions")
        if not re.fullmatch(r"[a-z]{20}", args.expected_project_ref) or args.expected_project_ref == "qsllyeztdwjgirsysgai":
            raise Refusal("reconciliation requires a configured non-production Supabase project ref")
        case = SUPPORTED_CASES.get((args.issue, args.claim, args.source_pr))
        args.replacement_migration, replacement_statements = load_replacement(args.source_pr_dir / "supabase/migrations", args.replacement_version)
        if case and case["mode"] == "replacement_already_applied":
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
