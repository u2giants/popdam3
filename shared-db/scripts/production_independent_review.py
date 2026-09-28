#!/usr/bin/env python3
"""Authenticate a separate production reviewer and pin the exact proposed action.

The roster is intentionally empty until the owner approves a reviewer-held GitHub
identity. A local report, descriptive label, or operator-authored ref is never a
reviewer credential.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path
from typing import Any, Callable

try:
    from production_apply_review_evidence import (
        EvidenceError, REPOSITORY, SHA_RE, DIGEST_RE, RUN_ID_RE,
        canonical_json, gh_json, download_artifact_zip, read_evidence,
        select_artifact,
    )
    from production_review_allowlist import normalize_review_allowlist
except ImportError:  # imported as scripts.production_independent_review
    from .production_apply_review_evidence import (
        EvidenceError, REPOSITORY, SHA_RE, DIGEST_RE, RUN_ID_RE,
        canonical_json, gh_json, download_artifact_zip, read_evidence,
        select_artifact,
    )
    from .production_review_allowlist import normalize_review_allowlist

REVIEW_WORKFLOW = ".github/workflows/production-independent-review.yml"
RECORD_WORKFLOW = ".github/workflows/production-apply-review-evidence.yml"
REVIEW_ARTIFACT = "independent-production-review"
REVIEW_FILE = "independent-production-review.json"
RECORD_ARTIFACT = "production-apply-review-evidence"
RECORD_FILE = "production-apply-review-evidence.json"
REVIEW_SCHEMA = "shared-db-independent-production-review/v1"
RECORD_SCHEMA = "shared-db-production-apply-review/v3"
PRODUCTION_PROJECT_REF = "qsllyeztdwjgirsysgai"
APPLY_WORKFLOW = ".github/workflows/shared-supabase-migrations.yml"
DRY_RUN_FILE = "production-risk-vector.json"
DRY_RUN_SCHEMA = "shared-db-production-sql-risk-vector/v1"
ROSTER_PATH = Path(__file__).resolve().parents[1] / "config/production-independent-reviewers.json"
PACKET_FIELDS = {
    "schema_version", "repository", "workflow_file", "workflow_run_id",
    "workflow_run_attempt", "reviewed_main_sha", "target_project_ref", "action",
    "ordered_allowlist", "source_pr", "source_pr_head", "work_issue",
    "preview_run_id", "preview_artifact_digest", "dry_run_run_id",
    "dry_run_artifact_digest", "sql_risk_reasons", "verdict", "reviewer_actor",
}
RECORD_FIELDS = PACKET_FIELDS | {
    "review_run_id", "review_artifact_digest", "operator_actor",
}


def authorized_reviewers(path: Path = ROSTER_PATH) -> set[str]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise EvidenceError("independent reviewer roster is unavailable") from exc
    if not isinstance(data, dict) or set(data) != {"schema_version", "authorized_github_reviewers"} or data["schema_version"] != 1:
        raise EvidenceError("independent reviewer roster has wrong schema")
    names = data["authorized_github_reviewers"]
    if not isinstance(names, list) or any(not isinstance(n, str) or not re.fullmatch(r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?", n) for n in names):
        raise EvidenceError("independent reviewer roster contains an invalid GitHub login")
    if len(set(n.casefold() for n in names)) != len(names):
        raise EvidenceError("independent reviewer roster contains duplicates")
    return {n.casefold() for n in names}


def assert_run(run: Any, *, run_id: int, sha: str, path: str) -> tuple[str, int]:
    if not isinstance(run, dict):
        raise EvidenceError("review run metadata is missing")
    expected = {"id": run_id, "status": "completed", "conclusion": "success", "event": "workflow_dispatch", "head_sha": sha, "head_branch": "main", "path": path}
    for key, value in expected.items():
        if run.get(key) != value:
            raise EvidenceError(f"review run has wrong {key}")
    if not isinstance(run.get("repository"), dict) or run["repository"].get("full_name") != REPOSITORY:
        raise EvidenceError("review run belongs to another repository")
    actor = run.get("actor")
    login = actor.get("login") if isinstance(actor, dict) else None
    attempt = run.get("run_attempt")
    if not isinstance(login, str) or not login or type(attempt) is not int or attempt < 1:
        raise EvidenceError("review run lacks authenticated actor or attempt")
    trigger = run.get("triggering_actor")
    if (path in {REVIEW_WORKFLOW, RECORD_WORKFLOW}
            and (attempt != 1 or not isinstance(trigger, dict)
                 or str(trigger.get("login", "")).casefold() != login.casefold())):
        raise EvidenceError("review or recorder rerun has ambiguous authenticated actor")
    return login, attempt


def verify_source_pr(*, source_pr: int, source_head: str,
                     api: Callable = gh_json) -> None:
    if type(source_pr) is not int or source_pr < 1 or not SHA_RE.fullmatch(source_head):
        raise EvidenceError("source PR identity is malformed")
    row = api(f"repos/{REPOSITORY}/pulls/{source_pr}")
    if (not isinstance(row, dict) or row.get("state") != "closed"
            or not row.get("merged_at") or not isinstance(row.get("head"), dict)
            or row["head"].get("sha") != source_head):
        raise EvidenceError("source PR is not merged at approved exact head")


def verify_current_main(*, sha: str, api: Callable = gh_json) -> None:
    row = api(f"repos/{REPOSITORY}/git/ref/heads/main")
    obj = row.get("object") if isinstance(row, dict) else None
    if not isinstance(obj, dict) or obj.get("sha") != sha:
        raise EvidenceError("independent review is stale: current main differs from approved SHA")


def fetch_artifact(*, run_id: int, sha: str, workflow: str, artifact_name: str,
                   filename: str, digest: str, api: Callable = gh_json,
                   downloader: Callable = download_artifact_zip) -> tuple[dict, str, int]:
    if not RUN_ID_RE.fullmatch(str(run_id)) or not SHA_RE.fullmatch(sha) or not DIGEST_RE.fullmatch(digest):
        raise EvidenceError("review run, main SHA, or artifact digest is malformed")
    run = api(f"repos/{REPOSITORY}/actions/runs/{run_id}")
    actor, attempt = assert_run(run, run_id=run_id, sha=sha, path=workflow)
    artifact = select_artifact(api(f"repos/{REPOSITORY}/actions/runs/{run_id}/artifacts?per_page=100"), run_id, artifact_name)
    if artifact.get("digest") != digest:
        raise EvidenceError("review artifact digest differs from pinned digest")
    with tempfile.TemporaryDirectory(prefix="independent-production-review-") as temp:
        archive = Path(temp, "artifact.zip")
        downloader(artifact["id"], archive)
        if "sha256:" + hashlib.sha256(archive.read_bytes()).hexdigest() != digest:
            raise EvidenceError("downloaded review artifact bytes differ from pinned digest")
        data = read_evidence(archive, filename)
    return data, actor, attempt


def validate_packet(data: dict, *, sha: str, allowlist: list[str], source_pr: int,
                    source_pr_head: str, work_issue: int, preview_run_id: int,
                    preview_digest: str, dry_run_id: int, dry_run_digest: str,
                    sql_risk_reasons: list[str],
                    reviewer_actor: str, run_id: int, attempt: int,
                    roster: set[str]) -> None:
    if set(data) != PACKET_FIELDS:
        raise EvidenceError("independent reviewer packet has wrong fields")
    if reviewer_actor.casefold() not in roster:
        raise EvidenceError("authenticated reviewer is not on owner-approved roster")
    if (not SHA_RE.fullmatch(sha) or not SHA_RE.fullmatch(source_pr_head)
            or not DIGEST_RE.fullmatch(preview_digest)
            or not DIGEST_RE.fullmatch(dry_run_digest)
            or any(type(v) is not int or v < 1 for v in
                   (source_pr, work_issue, preview_run_id, dry_run_id, run_id, attempt))):
        raise EvidenceError("independent review source or action identity is malformed")
    expected = {
        "schema_version": REVIEW_SCHEMA, "repository": REPOSITORY,
        "workflow_file": REVIEW_WORKFLOW, "workflow_run_id": run_id,
        "workflow_run_attempt": attempt, "reviewed_main_sha": sha,
        "target_project_ref": PRODUCTION_PROJECT_REF, "action": "production-apply",
        "ordered_allowlist": allowlist, "source_pr": source_pr,
        "source_pr_head": source_pr_head, "work_issue": work_issue,
        "preview_run_id": preview_run_id, "preview_artifact_digest": preview_digest,
        "dry_run_run_id": dry_run_id, "dry_run_artifact_digest": dry_run_digest,
        "sql_risk_reasons": sql_risk_reasons,
        "verdict": "APPROVE", "reviewer_actor": reviewer_actor,
    }
    for key, value in expected.items():
        if type(data.get(key)) is not type(value) or data.get(key) != value:
            raise EvidenceError(f"independent reviewer packet has wrong {key}")


def verify_review(*, run_id: int, digest: str, sha: str, allowlist: list[str],
                  source_pr: int, source_pr_head: str, work_issue: int,
                  preview_run_id: int, preview_digest: str, dry_run_id: int,
                  dry_run_digest: str, roster: set[str] | None = None,
                  api: Callable = gh_json, downloader: Callable = download_artifact_zip) -> tuple[dict, str]:
    data, actor, attempt = fetch_artifact(
        run_id=run_id, sha=sha, workflow=REVIEW_WORKFLOW,
        artifact_name=REVIEW_ARTIFACT, filename=REVIEW_FILE,
        digest=digest, api=api, downloader=downloader,
    )
    verify_current_main(sha=sha, api=api)
    vector = verify_dry_run(
        run_id=dry_run_id, digest=dry_run_digest, sha=sha,
        allowlist=allowlist, repo_root=Path(__file__).resolve().parents[1],
        api=api, downloader=downloader,
    )
    validate_packet(data, sha=sha, allowlist=allowlist, source_pr=source_pr,
                    source_pr_head=source_pr_head, work_issue=work_issue,
                    preview_run_id=preview_run_id, preview_digest=preview_digest,
                    dry_run_id=dry_run_id, dry_run_digest=dry_run_digest,
                    sql_risk_reasons=vector["sql_risk_reasons"],
                    reviewer_actor=actor, run_id=run_id, attempt=attempt,
                    roster=authorized_reviewers() if roster is None else roster)
    verify_source_pr(source_pr=source_pr, source_head=source_pr_head, api=api)
    return data, actor


def risk_vector(*, sha: str, allowlist: list[str], repo_root: Path) -> dict:
    # production_business_risk_gate imports its siblings by bare name, so it is
    # only importable with this directory on sys.path, including when this module
    # is loaded as ``scripts.production_independent_review`` from a workflow.
    scripts_dir = str(Path(__file__).resolve().parent)
    if scripts_dir not in sys.path:
        sys.path.insert(0, scripts_dir)
    from production_business_risk_gate import classify_sql, RISK_TEXT
    reasons = classify_sql(repo_root, allowlist)
    # classify_sql returns RISK_TEXT values (the human wording), never its keys.
    expected_sql_risks = {
        RISK_TEXT[key]
        for key in ("permanent_data_rewrite_or_loss", "expected_downtime", "material_access_change")
    }
    if (not isinstance(reasons, list) or len(reasons) != len(set(reasons))
            or any(reason not in expected_sql_risks for reason in reasons)):
        raise EvidenceError("SQL risk classifier returned an unrecognized or ambiguous conclusion")
    return {
        "schema_version": DRY_RUN_SCHEMA,
        "repository": REPOSITORY,
        "reviewed_main_sha": sha,
        "target_project_ref": PRODUCTION_PROJECT_REF,
        "action": "production-apply",
        "ordered_allowlist": allowlist,
        "sql_risk_reasons": reasons,
    }


def verify_dry_run(*, run_id: int, digest: str, sha: str, allowlist: list[str],
                   repo_root: Path, api: Callable = gh_json,
                   downloader: Callable = download_artifact_zip) -> dict:
    """Re-fetch the successful read-only run and recompute its SQL risk vector."""
    if not RUN_ID_RE.fullmatch(str(run_id)) or not SHA_RE.fullmatch(sha) or not DIGEST_RE.fullmatch(digest):
        raise EvidenceError("production dry-run identity is malformed")
    run = api(f"repos/{REPOSITORY}/actions/runs/{run_id}")
    assert_run(run, run_id=run_id, sha=sha, path=APPLY_WORKFLOW)
    artifact = select_artifact(
        api(f"repos/{REPOSITORY}/actions/runs/{run_id}/artifacts?per_page=100"),
        run_id, f"production-migration-dry-run-{sha}",
    )
    if artifact.get("digest") != digest:
        raise EvidenceError("dry-run artifact digest differs from pinned digest")
    with tempfile.TemporaryDirectory(prefix="production-dry-run-review-") as temp:
        archive = Path(temp, "dry-run.zip")
        downloader(artifact["id"], archive)
        if "sha256:" + hashlib.sha256(archive.read_bytes()).hexdigest() != digest:
            raise EvidenceError("downloaded dry-run bytes differ from pinned digest")
        with zipfile.ZipFile(archive) as zipped:
            names = [Path(name).name for name in zipped.namelist() if not name.endswith("/")]
            expected = {"production-ledger-before.txt", "production-dry-run.txt",
                        "migration-content-manifest.json", DRY_RUN_FILE}
            if set(names) != expected or len(names) != len(expected):
                raise EvidenceError("dry-run artifact lacks exact ledger, SQL, manifest, and risk files")
            risk_entry = next(name for name in zipped.namelist() if Path(name).name == DRY_RUN_FILE)
            raw = zipped.read(risk_entry).decode("utf-8")
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise EvidenceError("dry-run risk vector is not JSON") from exc
    if not isinstance(data, dict) or raw != canonical_json(data):
        raise EvidenceError("dry-run risk vector is not strict canonical JSON")
    if data != risk_vector(sha=sha, allowlist=allowlist, repo_root=repo_root):
        raise EvidenceError("dry-run SQL risk vector differs from exact current source")
    return data


def record_operator(*, packet: dict, reviewer_actor: str, operator_actor: str,
                    review_run_id: int, review_digest: str, run_id: int,
                    attempt: int) -> dict:
    if not operator_actor or operator_actor.casefold() == reviewer_actor.casefold():
        raise EvidenceError("reviewer and evidence operator must be independent actors")
    if not DIGEST_RE.fullmatch(review_digest):
        raise EvidenceError("review artifact digest is malformed")
    return {
        **packet, "schema_version": RECORD_SCHEMA,
        "workflow_file": RECORD_WORKFLOW, "workflow_run_id": run_id,
        "workflow_run_attempt": attempt, "review_run_id": review_run_id,
        "review_artifact_digest": review_digest, "operator_actor": operator_actor,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--review-run-id", type=int, required=True)
    parser.add_argument("--review-digest", required=True)
    parser.add_argument("--main-sha", required=True)
    parser.add_argument("--allowlist", required=True)
    parser.add_argument("--source-pr", type=int, required=True)
    parser.add_argument("--source-pr-head", required=True)
    parser.add_argument("--work-issue", type=int, required=True)
    parser.add_argument("--preview-run-id", type=int, required=True)
    parser.add_argument("--preview-digest", required=True)
    parser.add_argument("--dry-run-run-id", type=int, required=True)
    parser.add_argument("--dry-run-digest", required=True)
    parser.add_argument("--operator-actor", required=True)
    parser.add_argument("--operator-run-id", type=int, required=True)
    parser.add_argument("--operator-run-attempt", type=int, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        allowlist = normalize_review_allowlist(args.allowlist)
        packet, reviewer = verify_review(
            run_id=args.review_run_id, digest=args.review_digest, sha=args.main_sha,
            allowlist=allowlist, source_pr=args.source_pr,
            source_pr_head=args.source_pr_head, work_issue=args.work_issue,
            preview_run_id=args.preview_run_id, preview_digest=args.preview_digest,
            dry_run_id=args.dry_run_run_id, dry_run_digest=args.dry_run_digest,
        )
        verify_dry_run(
            run_id=args.dry_run_run_id, digest=args.dry_run_digest,
            sha=args.main_sha, allowlist=allowlist,
            repo_root=Path(__file__).resolve().parents[1],
        )
        verify_source_pr(source_pr=args.source_pr, source_head=args.source_pr_head)
        record = record_operator(
            packet=packet, reviewer_actor=reviewer, operator_actor=args.operator_actor,
            review_run_id=args.review_run_id, review_digest=args.review_digest,
            run_id=args.operator_run_id, attempt=args.operator_run_attempt,
        )
        args.output.write_text(canonical_json(record), encoding="utf-8")
    except (EvidenceError, ValueError, OSError, subprocess.CalledProcessError, zipfile.BadZipFile) as exc:
        print(f"::error::Independent production review refused: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
