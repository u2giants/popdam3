#!/usr/bin/env python3
"""Verify immutable production-apply review evidence from a GitHub Actions run."""

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

from production_review_allowlist import ReviewAllowlistError, normalize_review_allowlist

REPOSITORY = "u2giants/shared-db"
WORKFLOW_PATH = ".github/workflows/production-apply-review-evidence.yml"
ARTIFACT_NAME = "production-apply-review-evidence"
EVIDENCE_FILE = "production-apply-review-evidence.json"
SCHEMA_VERSION = "shared-db-production-apply-review/v1"
FIELDS = {
    "schema_version",
    "repository",
    "workflow_file",
    "workflow_run_id",
    "workflow_run_attempt",
    "reviewed_main_sha",
    "ordered_allowlist",
    "verdict",
    "reviewer_actor",
    "reviewer_label",
    "created_at",
}
SHA_RE = re.compile(r"[0-9a-f]{40}")
DIGEST_RE = re.compile(r"sha256:([0-9a-f]{64})")
RUN_ID_RE = re.compile(r"[1-9][0-9]*")
CREATED_AT_RE = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z")


class EvidenceError(ValueError):
    """Evidence is absent, mutable, malformed, or bound to another apply."""


def canonical_json(data: dict[str, Any]) -> str:
    return json.dumps(data, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n"


def gh_json(endpoint: str) -> Any:
    completed = subprocess.run(
        ["gh", "api", endpoint],
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
    )
    return json.loads(completed.stdout)


def download_artifact_zip(artifact_id: int, destination: Path) -> None:
    with destination.open("wb") as handle:
        subprocess.run(
            ["gh", "api", f"repos/{REPOSITORY}/actions/artifacts/{artifact_id}/zip"],
            check=True,
            stdout=handle,
            stderr=subprocess.PIPE,
        )


def validate_request(run_id: str, digest: str, sha: str, allowlist: str) -> list[str]:
    if not RUN_ID_RE.fullmatch(run_id):
        raise EvidenceError("review run ID must be a positive decimal integer, not a URL or path")
    if not DIGEST_RE.fullmatch(digest):
        raise EvidenceError("artifact digest must be canonical sha256:<64 lowercase hex>")
    if not SHA_RE.fullmatch(sha):
        raise EvidenceError("requested main SHA must be exactly 40 lowercase hex characters")
    try:
        return normalize_review_allowlist(allowlist)
    except ReviewAllowlistError as exc:
        raise EvidenceError(f"invalid production allowlist: {exc}") from exc


def validate_run(run: Any, run_id: int, sha: str) -> tuple[str, int]:
    if not isinstance(run, dict):
        raise EvidenceError("GitHub run response is not an object")
    expected = {
        "id": run_id,
        "status": "completed",
        "conclusion": "success",
        "event": "workflow_dispatch",
        "head_sha": sha,
        "path": WORKFLOW_PATH,
    }
    for field, value in expected.items():
        if run.get(field) != value:
            raise EvidenceError(f"review run has wrong {field}: expected {value!r}")
    repository = run.get("repository")
    if not isinstance(repository, dict) or repository.get("full_name") != REPOSITORY:
        raise EvidenceError("review run belongs to the wrong repository")
    actor = run.get("actor")
    reviewer_actor = actor.get("login") if isinstance(actor, dict) else None
    if not isinstance(reviewer_actor, str) or not reviewer_actor.strip():
        raise EvidenceError("review run has no authenticated actor identity")
    run_attempt = run.get("run_attempt")
    if type(run_attempt) is not int or run_attempt < 1:
        raise EvidenceError("review run has no valid run attempt")
    return reviewer_actor, run_attempt


def select_artifact(payload: Any, run_id: int) -> dict[str, Any]:
    artifacts = payload.get("artifacts") if isinstance(payload, dict) else None
    if not isinstance(artifacts, list):
        raise EvidenceError("GitHub artifacts response is malformed")
    matches = [item for item in artifacts if isinstance(item, dict) and item.get("name") == ARTIFACT_NAME]
    if len(matches) != 1:
        raise EvidenceError(f"expected exactly one {ARTIFACT_NAME!r} artifact, found {len(matches)}")
    artifact = matches[0]
    if artifact.get("expired") is not False:
        raise EvidenceError("review evidence artifact is expired or has unknown expiry state")
    if not isinstance(artifact.get("id"), int):
        raise EvidenceError("review evidence artifact has no numeric ID")
    workflow_run = artifact.get("workflow_run")
    if not isinstance(workflow_run, dict) or workflow_run.get("id") != run_id:
        raise EvidenceError("review evidence artifact is not bound to the requested run")
    return artifact


def read_evidence(zip_path: Path) -> dict[str, Any]:
    with zipfile.ZipFile(zip_path) as archive:
        files = [name for name in archive.namelist() if not name.endswith("/")]
        if files != [EVIDENCE_FILE]:
            raise EvidenceError(f"artifact must contain only {EVIDENCE_FILE!r}")
        raw = archive.read(EVIDENCE_FILE)
    try:
        text = raw.decode("utf-8")
        def no_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
            result: dict[str, Any] = {}
            for key, value in pairs:
                if key in result:
                    raise EvidenceError(f"review evidence has duplicate JSON key {key!r}")
                result[key] = value
            return result
        data = json.loads(text, object_pairs_hook=no_duplicate_keys)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise EvidenceError("review evidence is not valid UTF-8 JSON") from exc
    if not isinstance(data, dict):
        raise EvidenceError("review evidence JSON must be an object")
    if text != canonical_json(data):
        raise EvidenceError("review evidence JSON is not in strict canonical form")
    return data


def validate_evidence(
    data: dict[str, Any], *, run_id: int, run_attempt: int, sha: str,
    allowlist: list[str], reviewer_actor: str
) -> None:
    if set(data) != FIELDS:
        missing = sorted(FIELDS - set(data))
        unknown = sorted(set(data) - FIELDS)
        raise EvidenceError(f"strict evidence schema mismatch; missing={missing}, unknown={unknown}")
    if type(data.get("workflow_run_id")) is not int or type(data.get("workflow_run_attempt")) is not int:
        raise EvidenceError("workflow run ID and attempt must be integers")
    expected = {
        "schema_version": SCHEMA_VERSION,
        "repository": REPOSITORY,
        "workflow_file": WORKFLOW_PATH,
        "workflow_run_id": run_id,
        "workflow_run_attempt": run_attempt,
        "reviewed_main_sha": sha,
        "ordered_allowlist": allowlist,
        "verdict": "APPROVE",
        "reviewer_actor": reviewer_actor,
    }
    for field, value in expected.items():
        if data.get(field) != value:
            raise EvidenceError(f"review evidence has wrong {field}: expected {value!r}")
    label = data.get("reviewer_label")
    if not isinstance(label, str) or "\n" in label or "\r" in label or len(label) > 200:
        raise EvidenceError("reviewer_label must be a single string of at most 200 characters")
    created_at = data.get("created_at")
    if not isinstance(created_at, str) or not CREATED_AT_RE.fullmatch(created_at):
        raise EvidenceError("created_at must be canonical UTC YYYY-MM-DDTHH:MM:SSZ")


def verify(
    *, run_id_text: str, expected_digest: str, sha: str, allowlist_raw: str,
    api: Callable[[str], Any] = gh_json,
    downloader: Callable[[int, Path], None] = download_artifact_zip,
    output_dir: Path,
) -> Path:
    allowlist = validate_request(run_id_text, expected_digest, sha, allowlist_raw)
    run_id = int(run_id_text)
    run = api(f"repos/{REPOSITORY}/actions/runs/{run_id}")
    reviewer_actor, run_attempt = validate_run(run, run_id, sha)
    artifact = select_artifact(api(f"repos/{REPOSITORY}/actions/runs/{run_id}/artifacts?per_page=100"), run_id)
    if artifact.get("digest") != expected_digest:
        raise EvidenceError("GitHub artifact digest does not match the pinned expected digest")
    with tempfile.TemporaryDirectory(prefix="production-review-") as temp:
        zip_path = Path(temp, "artifact.zip")
        downloader(artifact["id"], zip_path)
        actual_digest = "sha256:" + hashlib.sha256(zip_path.read_bytes()).hexdigest()
        if actual_digest != expected_digest:
            raise EvidenceError("downloaded artifact bytes do not match the pinned digest")
        data = read_evidence(zip_path)
    validate_evidence(
        data, run_id=run_id, run_attempt=run_attempt, sha=sha,
        allowlist=allowlist, reviewer_actor=reviewer_actor,
    )
    output_dir.mkdir(parents=True, exist_ok=True)
    output = output_dir / EVIDENCE_FILE
    output.write_text(canonical_json(data), encoding="utf-8", newline="\n")
    return output


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--review-run-id", required=True)
    parser.add_argument("--expected-artifact-digest", required=True)
    parser.add_argument("--commit-sha", required=True)
    parser.add_argument("--allowlist", required=True)
    parser.add_argument("--output-dir", type=Path, default=Path(os.environ.get("RUNNER_TEMP", ".")))
    args = parser.parse_args()
    try:
        output = verify(
            run_id_text=args.review_run_id,
            expected_digest=args.expected_artifact_digest,
            sha=args.commit_sha,
            allowlist_raw=args.allowlist,
            output_dir=args.output_dir,
        )
    except (EvidenceError, OSError, subprocess.CalledProcessError, zipfile.BadZipFile) as exc:
        print(f"::error::Production apply review evidence rejected: {exc}", file=sys.stderr)
        return 1
    print(f"Verified immutable production review evidence: {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
