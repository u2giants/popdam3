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
from historical_preview_recovery import verify as verify_historical_preview
from production_owner_decision_evidence import verify_artifact as verify_owner_decision

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
HISTORICAL_DISNEY_SOURCE = {
    "pr": 924,
    "head": "5135b668d87c1639281c506ae75fde75211b7019",
    "merge": "96bf385aa5c0f703ec98f5730249f586964f5142",
    "allowlist": ["20260813210000", "20260813220000"],
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
        "ai_devops_pr", "ai_devops_merge_sha", "skill_hashes",
        "forward_test_path", "forward_test_sha256",
    }
    if not isinstance(data, dict) or set(data) != required:
        raise RiskGateError("production-risk activation record has a forged or incomplete schema")
    if data["active"] is not True or data["schema_version"] != ACTIVE_SCHEMA:
        raise RiskGateError("production-risk activation record is not active")
    for key in ("shared_db_merge_sha", "ai_devops_merge_sha"):
        if not re.fullmatch(r"[0-9a-f]{40}", str(data[key])):
            raise RiskGateError(f"activation {key} is not an exact commit")
    if not re.fullmatch(r"[0-9a-f]{64}", str(data["forward_test_sha256"])):
        raise RiskGateError("activation forward_test_sha256 is not a SHA-256 digest")
    expected_files = {"SKILL.md", "references/operating-manual.md", "agents/openai.yaml"}
    hashes = data["skill_hashes"]
    if not isinstance(hashes, dict) or set(hashes) != expected_files:
        raise RiskGateError("activation skill_hashes must pin all three orchestrator files")
    for filename, record in hashes.items():
        if not isinstance(record, dict) or set(record) != {"canonical", "codex_installed", "claude_installed"}:
            raise RiskGateError(f"activation hash record is incomplete for {filename}")
        values = list(record.values())
        if any(not re.fullmatch(r"[0-9a-f]{64}", str(value)) for value in values):
            raise RiskGateError(f"activation hash is not SHA-256 for {filename}")
        if len(set(values)) != 1:
            raise RiskGateError(f"installed orchestrator file does not match canonical ai-devops: {filename}")
    if data["forward_test_path"] != "docs/verification/issue-1039-production-risk-activation-forward-proof.md":
        raise RiskGateError("activation forward-test path is not the governed issue #1039 proof")
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
    forward = repo_root / data["forward_test_path"]
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


def canonical_sha256(path: Path) -> str:
    raw = path.read_bytes()
    if b"\r" in raw.replace(b"\r\n", b""):
        raise RiskGateError(f"migration contains unsupported bare CR line endings: {path.name}")
    return hashlib.sha256(raw.replace(b"\r\n", b"\n")).hexdigest()


def prove_preview_migration_contents(
    *, texts: dict[str, str], allowlist: list[str], repo_root: Path,
    before_versions: set[str], after_versions: set[str], historical: bool,
) -> None:
    dry = texts.get("preview-dry-run.txt", "")
    apply = texts.get("preview-apply.txt", "")
    if historical:
        for version in allowlist:
            matches = list(repo_root.glob(f"supabase/migrations/{version}_*.sql"))
            if len(matches) != 1:
                raise RiskGateError(
                    f"allowlisted migration {version} is absent or ambiguous on exact main"
                )
            if matches[0].name not in dry or matches[0].name not in apply:
                raise RiskGateError(
                    f"preview proof does not name exact migration {matches[0].name}"
                )
            if version not in before_versions or version not in after_versions:
                raise RiskGateError(
                    f"historical preview ledger does not prove stable prior application of {version}"
                )
        if before_versions != after_versions:
            raise RiskGateError("historical preview ledger changed during a no-write proof")
        return

    added = after_versions - before_versions
    removed = before_versions - after_versions
    if added != set(allowlist) or removed:
        raise RiskGateError(
            "preview ledger delta must add exactly the allowlist once and remove nothing"
        )

    try:
        policy = json.loads(
            (repo_root / "config/atomic-migration-allowlist.json").read_text(encoding="utf-8")
        ).get("migrations", {})
    except (OSError, json.JSONDecodeError, AttributeError) as exc:
        raise RiskGateError("atomic migration policy is missing or unreadable") from exc

    atomic_versions = [version for version in allowlist if version in policy]
    if atomic_versions and (len(allowlist) != 1 or len(atomic_versions) != 1):
        raise RiskGateError("atomic preview proof must contain exactly one allowlisted migration")

    for version in allowlist:
        matches = list(repo_root.glob(f"supabase/migrations/{version}_*.sql"))
        if len(matches) != 1:
            raise RiskGateError(f"allowlisted migration {version} is absent or ambiguous on exact main")
        filename = matches[0]
        entry = policy.get(version)
        if entry is None:
            if filename.name not in dry or filename.name not in apply:
                raise RiskGateError(f"preview proof does not name exact migration {filename.name}")
            continue

        if not isinstance(entry, dict) or "preview" not in entry.get("targets", []):
            raise RiskGateError(f"atomic policy does not authorize preview for {version}")
        expected_hash = entry.get("sha256")
        if not re.fullmatch(r"[0-9a-f]{64}", str(expected_hash)):
            raise RiskGateError(f"atomic policy SHA-256 is invalid for {version}")
        if canonical_sha256(filename) != expected_hash:
            raise RiskGateError(f"atomic policy does not match exact migration content for {version}")

        try:
            manifest = json.loads(texts["migration-content-manifest.json"])
        except (KeyError, json.JSONDecodeError, TypeError) as exc:
            raise RiskGateError("atomic preview proof is missing a valid content manifest") from exc
        if not isinstance(manifest, dict) or manifest.get(version) != expected_hash:
            raise RiskGateError(f"preview content manifest does not match atomic policy for {version}")

        preflight = (
            f"ATOMIC PREFLIGHT OK: target=preview version={version} "
            f"sha256={expected_hash} statements="
        )
        dry_lines = dry.splitlines()
        apply_lines = apply.splitlines()
        if len(dry_lines) != 1 or not dry_lines[0].startswith(preflight):
            raise RiskGateError(f"atomic preview dry-run proof is incomplete or forged for {version}")
        if len(apply_lines) != 2 or apply_lines[0] != dry_lines[0]:
            raise RiskGateError(f"atomic preview apply preflight does not match dry-run for {version}")
        count = dry_lines[0][len(preflight):]
        if not re.fullmatch(r"[1-9][0-9]*", count):
            raise RiskGateError(f"atomic preview statement count is invalid for {version}")
        expected_apply = (
            f"ATOMIC APPLY OK: target=preview version={version} ledger_row=1 statements={count}"
        )
        if apply_lines[1] != expected_apply:
            raise RiskGateError(f"atomic preview apply proof is incomplete or forged for {version}")


def prove_preview(
    *, run_id: int, digest: str, pr_head: str, main_sha: str, source_pr: int, allowlist: list[str], api: Callable[[str], Any],
    downloader: Callable[[int, Path], None], repo_root: Path,
) -> None:
    run = api(f"repos/{REPOSITORY}/actions/runs/{run_id}")
    expected = {
        "status": "completed", "conclusion": "success", "event": "workflow_dispatch",
        "path": PREVIEW_WORKFLOW,
    }
    for key, value in expected.items():
        if run.get(key) != value:
            raise RiskGateError(f"preview run has wrong {key}")
    if run.get("head_sha") not in {pr_head, main_sha}:
        raise RiskGateError("preview run has wrong head_sha")
    name = f"preview-migration-apply-{run['head_sha']}"
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
    before = texts.get("preview-ledger-before.txt", "")
    after = texts.get("preview-ledger-after.txt", "")
    historical = texts.get("historical-preview-source.json")
    expected_head = pr_head
    if historical:
        record = json.loads(historical)
        if record != verify_historical_preview(source_pr, main_sha, ",".join(allowlist), repo_root, api):
            raise RiskGateError("historical preview source proof does not match current governed evidence")
        expected_head = main_sha
    if run.get("head_sha") != expected_head:
        raise RiskGateError("preview run has wrong head_sha")
    with tempfile.TemporaryDirectory(prefix="production-risk-ledger-") as ledger_temp:
        before_path, after_path = Path(ledger_temp, "before.txt"), Path(ledger_temp, "after.txt")
        before_path.write_text(before, encoding="utf-8")
        after_path.write_text(after, encoding="utf-8")
        before_versions, after_versions = parse_remote_versions(before_path), parse_remote_versions(after_path)
    prove_preview_migration_contents(
        texts=texts, allowlist=allowlist, repo_root=repo_root,
        before_versions=before_versions, after_versions=after_versions,
        historical=bool(historical),
    )


def is_pinned_historical_disney_source(
    pr_number: int, head: str, merge_sha: str, allowlist: list[str]
) -> bool:
    return (
        pr_number == HISTORICAL_DISNEY_SOURCE["pr"]
        and head == HISTORICAL_DISNEY_SOURCE["head"]
        and merge_sha == HISTORICAL_DISNEY_SOURCE["merge"]
        and allowlist == HISTORICAL_DISNEY_SOURCE["allowlist"]
    )


def prove_pr_and_checks(
    pr_number: int, main_sha: str, allowlist: list[str], api: Callable[[str], Any], repo_root: Path
) -> str:
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
    historical_source = is_pinned_historical_disney_source(
        pr_number, head, pr.get("merge_commit_sha"), allowlist
    )
    if historical_source:
        # The author-lease workflow did not exist when this exact PR merged. Its
        # historical source proof is verified later against current main and the
        # preview artifact; every contemporary safety check remains mandatory.
        missing = [name for name in missing if name != "Migration author lease"]
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


def decide_business_risk(
    sql_reasons: list[str], *, recovery_proven: bool, review_approved: bool
) -> dict[str, Any]:
    """Decide only from facts already established by governed verifiers."""
    reasons = set(sql_reasons)
    if not recovery_proven:
        reasons.add(RISK_TEXT["recovery_unproven"])
    if not review_approved:
        reasons.add(RISK_TEXT["unresolved_material_objection"])
    ordered = sorted(reasons)
    return {"automaticPromotionAllowed": not ordered, "ownerDecisionReasons": ordered}


def assess(args: argparse.Namespace, *, api=gh_json, downloader=download_artifact) -> dict[str, Any]:
    repo_root = args.repo.resolve()
    allowlist = normalize_review_allowlist(args.allowlist)
    activation = load_activation(args.activation)
    prove_activation(activation, main_sha=args.main_sha, api=api, repo_root=repo_root)
    pr_head = prove_pr_and_checks(args.pr, args.main_sha, allowlist, api, repo_root)
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
        main_sha=args.main_sha, source_pr=args.pr, allowlist=allowlist, api=api, downloader=downloader, repo_root=repo_root,
    )
    decision = decide_business_risk(classify_sql(repo_root, allowlist), recovery_proven=True, review_approved=True)
    owner_evidence = None
    if decision["ownerDecisionReasons"]:
        if not args.owner_decision_run_id or not args.owner_decision_digest:
            return {**decision, "productionPromotionAllowed": False}
        owner_evidence = verify_owner_decision(
            args.owner_decision_run_id, args.owner_decision_digest, args.main_sha,
            allowlist, args.pr, downloader, api,
        )
        expected_risks = sorted(key for key, text in RISK_TEXT.items() if text in decision["ownerDecisionReasons"])
        if sorted(owner_evidence["accepted_risks"]) != expected_risks:
            raise RiskGateError("owner decision does not accept exactly the risks derived from governed evidence")
    return {
        **decision,
        "productionPromotionAllowed": not decision["ownerDecisionReasons"] or owner_evidence is not None,
        "governedEvidence": {
            "mainSha": args.main_sha, "sourcePr": args.pr, "sourcePrHead": pr_head,
            "reviewRun": args.review_run_id, "previewRun": args.preview_run_id,
            "allowlist": allowlist,
            "ownerDecision": owner_evidence,
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
    # GitHub Actions supplies an omitted optional workflow input as an empty
    # string.  Keep it as text so the established no-risk automatic path can
    # reach assess(); a material-risk path still rejects the missing value.
    parser.add_argument("--owner-decision-run-id")
    parser.add_argument("--owner-decision-digest")
    args = parser.parse_args()
    try:
        result = assess(args)
    except (RiskGateError, OSError, ValueError, subprocess.CalledProcessError, zipfile.BadZipFile) as exc:
        print(f"::error::Production business-risk gate rejected evidence: {exc}")
        return 2
    print(json.dumps(result, sort_keys=True))
    return 0 if result.get("productionPromotionAllowed", result["automaticPromotionAllowed"]) else 3


if __name__ == "__main__":
    raise SystemExit(main())
