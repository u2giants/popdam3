"""Exact pinned re-qualified preview apply runs (#4464).

Python twin of scripts/db-flow/requalified-preview-runs.mjs; a parity test keeps
them identical. Run 39173012894 applied 20261018191107 to preview once (attempt
1); only its downstream qualification job was re-run, making it attempt 2. Only
that exact run, attempt and head may pass an attempt-1 check.
"""
from typing import Any

REQUALIFIED_PREVIEW_RUNS = {
    39173012894: {
        "version": "20261018191107",
        "source_pr": 4476,
        "head_sha": "fe3931607f952029ce6174073f7320d580a188b7",
        "run_attempt": 2,
        "preview_artifact_id": 12153700170,
        "preview_artifact_digest": "sha256:5b965d6cd686681ec0734c630b92fb602ae0ab8cfd277961a128d03d6461d479",
        "review_artifact_ids": (12153008946, 12153114783),
    },
}


def requalified_preview_run(run: Any) -> dict | None:
    if not isinstance(run, dict) or type(run.get("id")) is not int:
        return None
    record = REQUALIFIED_PREVIEW_RUNS.get(run["id"])
    if record is None or type(run.get("run_attempt")) is not int or run.get("run_attempt") != record["run_attempt"] or run.get("head_sha") != record["head_sha"]:
        return None
    return record


def run_attempt_admitted(run: Any) -> bool:
    """True for attempt 1, or exactly a pinned re-qualified run."""
    return (isinstance(run, dict) and type(run.get("run_attempt")) is int and run.get("run_attempt") == 1) \
        or requalified_preview_run(run) is not None
