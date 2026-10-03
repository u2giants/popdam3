#!/usr/bin/env python3
"""Reconcile one proven preview-only ledger orphan without touching schema DDL."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
from pathlib import Path

from atomic_migration_apply import TX_RE, dollar_quote, linked_connection, psql, split_sql
from production_migration_guard import parse_remote_versions


class Refusal(RuntimeError):
    pass


def load_supported_cases() -> dict:
    manifest = Path(__file__).resolve().parents[1] / "config" / "preview-ledger-orphan-reconciliations.json"
    data = read_json(manifest)
    if data.get("schema") != "shared-db-preview-ledger-orphan-reconciliations/v1" or not isinstance(data.get("cases"), list):
        raise Refusal("preview ledger reconciliation manifest has an unsupported schema")
    result = {}
    for raw in data["cases"]:
        case = dict(raw)
        try:
            issue = int(case.pop("issue"))
        except (KeyError, TypeError, ValueError) as exc:
            raise Refusal("preview ledger reconciliation manifest has a malformed identity") from exc
        if case.get("mode") == "sandbox_orphan_no_replacement":
            # A sandbox orphan has no replacement file, no claim, and no source PR:
            # its identity is the issue plus the exact orphan version, and the case
            # pins the expected live ledger row (name + statements) plus the full
            # expected remainder of the ledger, so the delete can be proven
            # metadata-only against pinned content rather than a version list.
            try:
                key = (issue, case["mode"], case["orphan_version"])
            except (KeyError, TypeError) as exc:
                raise Refusal("sandbox ledger reconciliation manifest has a malformed identity") from exc
            for field in ("project_ref", "expected_name", "expected_statements", "expected_other_versions"):
                if field not in case:
                    raise Refusal(f"sandbox reconciliation case does not carry the pinned field {field}")
            if case["project_ref"] == "qsllyeztdwjgirsysgai" or not re.fullmatch(r"[a-z]{20}", case["project_ref"]):
                raise Refusal("sandbox reconciliation case pins an invalid target ref")
            if not isinstance(case["expected_statements"], list) or not case["expected_statements"]:
                raise Refusal("sandbox reconciliation case must pin a non-empty statements array")
            if not isinstance(case["expected_other_versions"], list) or not all(re.fullmatch(r"\d{14}", v) for v in case["expected_other_versions"]):
                raise Refusal("sandbox reconciliation case must pin the expected remaining ledger versions")
            if not re.fullmatch(r"[A-Za-z0-9_.-]+", case["expected_name"]):
                raise Refusal("sandbox reconciliation case pins an expected_name outside the closed migration-name charset")
            if key in result:
                raise Refusal("preview ledger reconciliation manifest contains a duplicate identity")
            result[key] = case
            continue
        try:
            key = (issue, int(case.pop("claim")), int(case.pop("source_pr")))
        except (KeyError, TypeError, ValueError) as exc:
            raise Refusal("preview ledger reconciliation manifest has a malformed identity") from exc
        if "orphan_version" in case and "replacement_version" in case and case.get("mode") == "rehearsal_reset":
            key += (case.pop("orphan_version"), case.pop("replacement_version"))
        if key in result:
            raise Refusal("preview ledger reconciliation manifest contains a duplicate identity")
        result[key] = case
    return result


def version(value: str) -> str:
    if not re.fullmatch(r"\d{14}", value or ""):
        raise Refusal("migration versions must be exactly 14 digits")
    return value


def read_json(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise Refusal(f"unreadable JSON evidence: {path.name}") from exc


SUPPORTED_CASES = load_supported_cases()


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


SANDBOX_ORPHAN_NO_REPLACEMENT = "sandbox_orphan_no_replacement"


def sandbox_case(args) -> dict:
    case = SUPPORTED_CASES.get((args.issue, SANDBOX_ORPHAN_NO_REPLACEMENT, args.orphan_version))
    if not case:
        raise Refusal("issue and orphan version are not an explicitly supported sandbox reconciliation case")
    return case


def validate_governance_sandbox(args, case: dict) -> dict:
    """Prove a sandbox no-replacement reconciliation against its pinned case.

    A sandbox orphan never had a migration file on any branch, so there is no
    replacement file, no source pull request, and no preview run to bind. The
    reviewed manifest pins the exact expected live ledger row (name and
    statements) and the exact expected remainder of the ledger; every check
    below refuses on any drift from those pins.
    """
    repo = args.repo.resolve()
    if git(repo, "rev-parse", "HEAD") != args.main_sha or git(repo, "rev-parse", "origin/main") != args.main_sha:
        raise Refusal("checkout is not exact current main")
    if args.expected_project_ref != case["project_ref"]:
        raise Refusal("target ref is not the pinned sandbox reconciliation case ref")
    if args.orphan_version in {str(row) for row in case["expected_other_versions"]}:
        raise Refusal("orphan version is also pinned as an expected surviving row")
    if list((repo / "supabase/migrations").glob(f"{args.orphan_version}_*.sql")):
        raise Refusal("sandbox reconciliation requires a version with no local migration file on current main")
    issue = read_json(args.issue_json)
    if issue.get("number") != args.issue or issue.get("state") != "open":
        raise Refusal("work issue is not the exact open supported-case issue")
    remote = parse_remote_versions(args.remote_ledger)
    expected = set(case["expected_other_versions"]) | {args.orphan_version}
    if remote != expected:
        unexpected = sorted(remote - expected)
        absent = sorted(expected - remote)
        raise Refusal(f"remote ledger is not the pinned sandbox baseline; extra {unexpected}, absent {absent}")
    return {
        "case_mode": SANDBOX_ORPHAN_NO_REPLACEMENT,
        "pinned_other_versions": case["expected_other_versions"],
        "orphan_statement_count": len(case["expected_statements"]),
    }


def sandbox_restore_sql(case: dict, orphan_version: str) -> str:
    """The exact statement that restores the deleted row, for the evidence record."""
    values = ",\n  ".join(dollar_quote(statement, f"s{index}") for index, statement in enumerate(case["expected_statements"]))
    name = case["expected_name"].replace("'", "''")
    return (
        "insert into supabase_migrations.schema_migrations (version, name, statements)\n"
        f"values ('{orphan_version}', '{name}', array[\n  {values}\n]::text[]);"
    )


def reconcile_sandbox(url: str, env: dict[str, str], args, case: dict) -> tuple[list[dict], list[dict]]:
    """Delete one pinned sandbox orphan row with the preview lane's DELETE semantics."""
    before = ledger_rows(url, env, args.orphan_version, args.orphan_version)
    if len(before) != 1 or str(before[0].get("version")) != args.orphan_version:
        raise Refusal("sandbox ledger does not hold the orphan exactly once")
    if before[0].get("name") != case["expected_name"] or before[0].get("statements") != case["expected_statements"]:
        raise Refusal("orphan ledger row is not the pinned reviewed content")
    if args.mode == "check":
        return before, before
    expected_json = json.dumps(case["expected_statements"], separators=(",", ":"))
    for tag in ("$expected$", "$reconcile$"):
        if tag in expected_json:
            raise Refusal(f"pinned statements collide with the guard's dollar-quote tag {tag}; refuse rather than rebind")
    expected_name = case["expected_name"].replace("'", "''")
    survivors = len(case["expected_other_versions"])
    sql = rf"""\set ON_ERROR_STOP on
begin;
lock table supabase_migrations.schema_migrations in exclusive mode;
do $reconcile$
declare n integer;
begin
  if (select count(*) from supabase_migrations.schema_migrations) <> {survivors + 1} then
    raise exception 'ledger ownership changed before reconciliation';
  end if;
  if (select count(*) from supabase_migrations.schema_migrations where version='{args.orphan_version}') <> 1 then
    raise exception 'ledger orphan is not present exactly once';
  end if;
  if (select name from supabase_migrations.schema_migrations where version='{args.orphan_version}') is distinct from '{expected_name}'::text
     or (select to_jsonb(statements) from supabase_migrations.schema_migrations where version='{args.orphan_version}') is distinct from $expected${expected_json}$expected$::jsonb then
    raise exception 'ledger row changed before reconciliation';
  end if;
  delete from supabase_migrations.schema_migrations where version='{args.orphan_version}';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'reconciliation did not delete exactly one row'; end if;
  if (select count(*) from supabase_migrations.schema_migrations where version='{args.orphan_version}') <> 0 then
    raise exception 'orphan still present after reconciliation';
  end if;
  if (select count(*) from supabase_migrations.schema_migrations) <> {survivors} then
    raise exception 'ledger row count after delete is not the pinned baseline';
  end if;
end $reconcile$;
commit;
"""
    psql(url, env, sql)
    after = ledger_rows(url, env, args.orphan_version, args.orphan_version)
    if after:
        raise Refusal("post-reconciliation readback still shows the orphan row")
    return before, after


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
    p.add_argument("--reconciliation", choices=("preview", "sandbox"), default="preview",
                   help="preview: the shared preview branch, bound to a replacement migration; "
                        "sandbox: one pinned DesignFlow-sandbox orphan with no replacement file")
    p.add_argument("--repo", type=Path, required=True); p.add_argument("--linked-dir", type=Path, required=True)
    p.add_argument("--source-pr-dir", type=Path); p.add_argument("--orphan-source-dir", type=Path)
    p.add_argument("--expected-project-ref", required=True); p.add_argument("--main-sha", required=True)
    p.add_argument("--orphan-version", type=version, required=True); p.add_argument("--replacement-version", type=version)
    p.add_argument("--issue", type=int, required=True); p.add_argument("--claim", type=int); p.add_argument("--source-pr", type=int)
    p.add_argument("--preview-run-id", type=int); p.add_argument("--preview-artifact-id", type=int); p.add_argument("--preview-artifact-digest")
    p.add_argument("--issue-json", type=Path); p.add_argument("--claim-json", type=Path); p.add_argument("--pr-json", type=Path); p.add_argument("--pr-files-json", type=Path)
    p.add_argument("--run-json", type=Path); p.add_argument("--artifact-json", type=Path); p.add_argument("--preview-evidence-dir", type=Path)
    p.add_argument("--remote-ledger", type=Path)
    p.add_argument("--evidence-out", type=Path, required=True)
    args = p.parse_args()
    if args.reconciliation == "preview":
        for name in ("source_pr_dir", "orphan_source_dir", "replacement_version", "claim", "source_pr",
                     "preview_run_id", "preview_artifact_id", "preview_artifact_digest", "issue_json",
                     "claim_json", "pr_json", "pr_files_json", "run_json", "artifact_json", "preview_evidence_dir"):
            if getattr(args, name) is None:
                raise Refusal(f"preview reconciliation requires --{name.replace('_', '-')}")
    else:
        for name in ("issue_json", "remote_ledger"):
            if getattr(args, name) is None:
                raise Refusal(f"sandbox reconciliation requires --{name.replace('_', '-')}")
        for name in ("source_pr_dir", "orphan_source_dir", "replacement_version", "claim", "source_pr",
                     "preview_run_id", "preview_artifact_id", "preview_artifact_digest",
                     "claim_json", "pr_json", "pr_files_json", "run_json", "artifact_json", "preview_evidence_dir"):
            if getattr(args, name) is not None:
                raise Refusal(f"sandbox reconciliation refuses the preview-only argument --{name.replace('_', '-')}")
    return args


def main() -> int:
    try:
        args = parse_args()
        if args.reconciliation == "sandbox":
            if not re.fullmatch(r"[a-z]{20}", args.expected_project_ref) or args.expected_project_ref == "qsllyeztdwjgirsysgai":
                raise Refusal("reconciliation requires a configured non-production Supabase project ref")
            case = sandbox_case(args)
            # The restore statement is derived and refused BEFORE any write, so
            # a dollar-quote collision in the pinned statements can never leave
            # the row deleted with no executable evidence.
            restore_sql = sandbox_restore_sql(case, args.orphan_version)
            governance = validate_governance_sandbox(args, case)
            url, env = linked_connection(args.linked_dir, args.expected_project_ref)
            before, after = reconcile_sandbox(url, env, args, case)
            args.evidence_out.write_text(json.dumps({
                "schema": "shared-db-sandbox-ledger-orphan-reconciliation/v1",
                "mode": args.mode, "project_ref": args.expected_project_ref, "main_sha": args.main_sha,
                "issue": args.issue, "orphan_version": args.orphan_version,
                "governance": governance, "before": before, "after": after,
                "restore_sql": restore_sql,
            }, sort_keys=True, separators=(",", ":")) + "\n", encoding="utf-8")
            print(f"SANDBOX LEDGER RECONCILIATION {args.mode.upper()} OK: removed={args.orphan_version if args.mode == 'apply' else 'none'}")
            return 0
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
