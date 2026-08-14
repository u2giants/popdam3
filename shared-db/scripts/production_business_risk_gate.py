#!/usr/bin/env python3
"""Derive the production business-risk decision from governed evidence.

This deliberately does not accept caller-written risk booleans or prose.  It
binds immutable review evidence, an exact successful preview apply, required PR
checks, the merged PR, the current main commit, and conservative SQL analysis.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import tempfile
import zipfile
from pathlib import Path
from typing import Any, Callable

from production_apply_review_evidence import verify as verify_review
from production_migration_guard import parse_remote_versions
from production_review_allowlist import normalize_review_allowlist

REPOSITORY = "u2giants/shared-db"
PREVIEW_WORKFLOW = ".github/workflows/shared-supabase-migrations.yml"
ACTIVATION_SCHEMA = "shared-db-production-risk-activation/v1"
ACTIVE_SCHEMA = "shared-db-production-risk-activation/v2"
REQUIRED_CHECKS = {
    "Cross-PR object collision",
    "Migration author lease",
    "SQL migration guards",
    "supabase/tests against an ephemeral database",
}
RISK_TEXT = {
    "permanent_data_rewrite_or_loss": "existing production data may be lost or permanently altered",
    "expected_downtime": "users may be interrupted",
    "material_access_change": "access or permissions materially change",
    "recovery_unproven": "recovery is uncertain",
    "unresolved_material_objection": "the reviewers have an unresolved material disagreement",
}


class RiskGateError(ValueError):
    """Governed evidence is missing, inconsistent, forged, or stale."""


def gh_json(endpoint: str) -> Any:
    result = subprocess.run(
        ["gh", "api", endpoint], check=True, text=True,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, encoding="utf-8",
    )
    return json.loads(result.stdout)


def download_artifact(artifact_id: int, destination: Path) -> None:
    with destination.open("wb") as handle:
        subprocess.run(
            ["gh", "api", f"repos/{REPOSITORY}/actions/artifacts/{artifact_id}/zip"],
            check=True, stdout=handle, stderr=subprocess.PIPE,
        )


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_activation(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise RiskGateError("production-risk policy activation record is unreadable") from exc
    if data == {"active": False, "schema_version": ACTIVATION_SCHEMA}:
        return data
    required = {
        "active", "schema_version", "shared_db_pr", "shared_db_merge_sha",
        "ai_devops_pr", "ai_devops_merge_sha", "canonical_skill_sha256",
        "installed_skill_sha256", "forward_test_sha256",
    }
    if not isinstance(data, dict) or set(data) != required:
        raise RiskGateError("production-risk activation record has a forged or incomplete schema")
    if data["active"] is not True or data["schema_version"] != ACTIVE_SCHEMA:
        raise RiskGateError("production-risk activation record is not active")
    for key in ("shared_db_merge_sha", "ai_devops_merge_sha"):
        if not re.fullmatch(r"[0-9a-f]{40}", str(data[key])):
            raise RiskGateError(f"activation {key} is not an exact commit")
    for key in ("canonical_skill_sha256", "installed_skill_sha256", "forward_test_sha256"):
        if not re.fullmatch(r"[0-9a-f]{64}", str(data[key])):
            raise RiskGateError(f"activation {key} is not a SHA-256 digest")
    if data["canonical_skill_sha256"] != data["installed_skill_sha256"]:
        raise RiskGateError("installed orchestrator skill does not match canonical ai-devops")
    return data


def prove_activation(
    data: dict[str, Any], *, main_sha: str, api: Callable[[str], Any], repo_root: Path
) -> None:
    if data.get("active") is False:
        raise RiskGateError("new production policy is not activated; the old exact owner-approval rule remains mandatory")
    shared_pr = api(f"repos/{REPOSITORY}/pulls/{data['shared_db_pr']}")
    ai_pr = api(f"repos/u2giants/ai-devops/pulls/{data['ai_devops_pr']}")
    if shared_pr.get("merged") is not True or shared_pr.get("merge_commit_sha") != data["shared_db_merge_sha"]:
        raise RiskGateError("shared-db policy PR merge is not proved")
    if ai_pr.get("merged") is not True or ai_pr.get("merge_commit_sha") != data["ai_devops_merge_sha"]:
        raise RiskGateError("ai-devops policy PR merge is not proved")
    if data["shared_db_pr"] != 1021 or data["ai_devops_pr"] != 24:
        raise RiskGateError("activation is not bound to the two reviewed policy PRs")
    subprocess.run(
        ["git", "merge-base", "--is-ancestor", data["shared_db_merge_sha"], main_sha],
        cwd=repo_root, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    )
    forward = repo_root / "docs/verification/issue-1015-dynamic-queue-forward-test.md"
    if sha256_file(forward) != data["forward_test_sha256"]:
        raise RiskGateError("forward-test proof does not match the activated record")


def select_preview_artifact(payload: Any, run_id: int, expected_name: str) -> dict[str, Any]:
    artifacts = payload.get("artifacts") if isinstance(payload, dict) else None
    matches = [a for a in artifacts or [] if isinstance(a, dict) and a.get("name") == expected_name]
    if len(matches) != 1:
        raise RiskGateError(f"expected exactly one preview artifact {expected_name!r}")
    artifact = matches[0]
    if artifact.get("expired") is not False or artifact.get("workflow_run", {}).get("id") != run_id:
        raise RiskGateError("preview artifact is expired or belongs to another run")
    return artifact


def prove_preview(
    *, run_id: int, digest: str, pr_head: str, allowlist: list[str], api: Callable[[str], Any],
    downloader: Callable[[int, Path], None], repo_root: Path,
) -> None:
    run = api(f"repos/{REPOSITORY}/actions/runs/{run_id}")
    expected = {
        "status": "completed", "conclusion": "success", "event": "workflow_dispatch",
        "head_sha": pr_head, "path": PREVIEW_WORKFLOW,
    }
    for key, value in expected.items():
        if run.get(key) != value:
            raise RiskGateError(f"preview run has wrong {key}")
    name = f"preview-migration-apply-{pr_head}"
    artifact = select_preview_artifact(
        api(f"repos/{REPOSITORY}/actions/runs/{run_id}/artifacts?per_page=100"), run_id, name
    )
    if artifact.get("digest") != digest:
        raise RiskGateError("preview artifact digest does not match the pinned digest")
    with tempfile.TemporaryDirectory(prefix="production-risk-preview-") as temp:
        zip_path = Path(temp, "preview.zip")
        downloader(artifact["id"], zip_path)
        actual = "sha256:" + hashlib.sha256(zip_path.read_bytes()).hexdigest()
        if actual != digest:
            raise RiskGateError("downloaded preview artifact bytes do not match the pinned digest")
        with zipfile.ZipFile(zip_path) as archive:
            texts = {Path(n).name: archive.read(n).decode("utf-8", errors="strict") for n in archive.namelist() if not n.endswith("/")}
    dry = texts.get("preview-dry-run.txt", "")
    apply = texts.get("preview-apply.txt", "")
    before = texts.get("preview-ledger-before.txt", "")
    after = texts.get("preview-ledger-after.txt", "")
    with tempfile.TemporaryDirectory(prefix="production-risk-ledger-") as ledger_temp:
        before_path, after_path = Path(ledger_temp, "before.txt"), Path(ledger_temp, "after.txt")
        before_path.write_text(before, encoding="utf-8")
        after_path.write_text(after, encoding="utf-8")
        before_versions, after_versions = parse_remote_versions(before_path), parse_remote_versions(after_path)
    for version in allowlist:
        filename = next(repo_root.glob(f"supabase/migrations/{version}_*.sql"), None)
        if filename is None:
            raise RiskGateError(f"allowlisted migration {version} is absent from exact main")
        if filename.name not in dry or filename.name not in apply:
            raise RiskGateError(f"preview proof does not name exact migration {filename.name}")
        if version in before_versions or version not in after_versions:
            raise RiskGateError(f"preview ledger does not prove exactly-once application of {version}")


def prove_pr_and_checks(pr_number: int, main_sha: str, api: Callable[[str], Any], repo_root: Path) -> str:
    pr = api(f"repos/{REPOSITORY}/pulls/{pr_number}")
    if pr.get("merged") is not True or pr.get("merge_commit_sha") is None:
        raise RiskGateError("source PR is not merged")
    head = pr.get("head", {}).get("sha")
    if not re.fullmatch(r"[0-9a-f]{40}", str(head)):
        raise RiskGateError("source PR has no exact head")
    subprocess.run(
        ["git", "merge-base", "--is-ancestor", pr["merge_commit_sha"], main_sha],
        cwd=repo_root, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    )
    checks = api(f"repos/{REPOSITORY}/commits/{head}/check-runs?per_page=100").get("check_runs", [])
    conclusions = {c.get("name"): c.get("conclusion") for c in checks if isinstance(c, dict)}
    missing = sorted(name for name in REQUIRED_CHECKS if conclusions.get(name) != "success")
    if missing:
        raise RiskGateError(f"required exact-head checks are not successful: {', '.join(missing)}")
    return head


def classify_sql(repo_root: Path, allowlist: list[str]) -> list[str]:
    reasons: set[str] = set()
    for version in allowlist:
        matches = list(repo_root.glob(f"supabase/migrations/{version}_*.sql"))
        if len(matches) != 1:
            raise RiskGateError(f"expected one migration for {version}, found {len(matches)}")
        sql = re.sub(r"--[^\n]*|/\*.*?\*/", " ", matches[0].read_text(encoding="utf-8"), flags=re.S).lower()
        if re.search(r"\b(drop|truncate|delete\s+from|update\s+)\b", sql):
            reasons.add(RISK_TEXT["permanent_data_rewrite_or_loss"])
        if re.search(r"\b(lock\s+table|alter\s+table|create\s+(?:unique\s+)?index\s+(?!concurrently))", sql):
            reasons.add(RISK_TEXT["expected_downtime"])
        if re.search(r"\b(grant|revoke|create\s+policy|alter\s+policy|drop\s+policy|row\s+level\s+security)\b", sql):
            reasons.add(RISK_TEXT["material_access_change"])
    return sorted(reasons)


def assess(args: argparse.Namespace, *, api=gh_json, downloader=download_artifact) -> dict[str, Any]:
    repo_root = args.repo.resolve()
    allowlist = normalize_review_allowlist(args.allowlist)
    activation = load_activation(args.activation)
    prove_activation(activation, main_sha=args.main_sha, api=api, repo_root=repo_root)
    pr_head = prove_pr_and_checks(args.pr, args.main_sha, api, repo_root)
    with tempfile.TemporaryDirectory(prefix="production-risk-review-") as temp:
        review_path = verify_review(
            run_id_text=str(args.review_run_id), expected_digest=args.review_digest,
            sha=args.main_sha, allowlist_raw=args.allowlist, api=api, downloader=downloader,
            output_dir=Path(temp),
        )
        review = json.loads(review_path.read_text(encoding="utf-8"))
    if review.get("verdict") != "APPROVE":
        return {"automaticPromotionAllowed": False, "ownerDecisionReasons": [RISK_TEXT["unresolved_material_objection"]]}
    prove_preview(
        run_id=args.preview_run_id, digest=args.preview_digest, pr_head=pr_head,
        allowlist=allowlist, api=api, downloader=downloader, repo_root=repo_root,
    )
    reasons = classify_sql(repo_root, allowlist)
    return {
        "automaticPromotionAllowed": not reasons,
        "ownerDecisionReasons": reasons,
        "governedEvidence": {
            "mainSha": args.main_sha, "sourcePr": args.pr, "sourcePrHead": pr_head,
            "reviewRun": args.review_run_id, "previewRun": args.preview_run_id,
            "allowlist": allowlist,
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", type=Path, default=Path.cwd())
    parser.add_argument("--activation", type=Path, default=Path("config/production-risk-policy-activation.json"))
    parser.add_argument("--main-sha", required=True)
    parser.add_argument("--allowlist", required=True)
    parser.add_argument("--pr", type=int, required=True)
    parser.add_argument("--review-run-id", type=int, required=True)
    parser.add_argument("--review-digest", required=True)
    parser.add_argument("--preview-run-id", type=int, required=True)
    parser.add_argument("--preview-digest", required=True)
    args = parser.parse_args()
    try:
        result = assess(args)
    except (RiskGateError, OSError, ValueError, subprocess.CalledProcessError, zipfile.BadZipFile) as exc:
        print(f"::error::Production business-risk gate rejected evidence: {exc}")
        return 2
    print(json.dumps(result, sort_keys=True))
    return 0 if result["automaticPromotionAllowed"] else 3


if __name__ == "__main__":
    raise SystemExit(main())
