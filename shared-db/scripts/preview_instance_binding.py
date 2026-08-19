#!/usr/bin/env python3
"""Bind a preview rehearsal to the commit it applied and the database it applied to.

WHY THIS FILE EXISTS
--------------------
A preview rehearsal proves a migration applied cleanly to *a* database, built by
*some* checkout.  Until this file, the production gate could prove neither.

1.  The commit.  The gate pinned provenance and the producing code to the
    workflow run's ``head_sha``.  For a rehearsal dispatched with ``--ref main``
    that is the *workflow file* ref, not the commit the job checked out and
    applied from.  Those differ on exactly the post-merge rehearsals this lane
    exists to make possible.
2.  The database.  Preview ``rjyboqwcdzcocqgmsyel`` was DELETED and rebuilt as a
    new project on 2026-08-18.  With no instance identity in the evidence, an
    unexpired rehearsal performed against the dead database stayed valid proof
    for a production write.  A rebuilt preview must never inherit the proof of
    the one it replaced.

The record written here is produced INSIDE the preview job, from the values that
job actually used, and travels in the same evidence artifact as the ledgers and
apply logs.  ``verify`` is what the production gate calls, and it fails closed on
every missing or mismatched field, naming exactly what was wrong.
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any

SCHEMA = "shared-db-preview-instance-binding/v1"
COMMIT_RE = re.compile(r"^[0-9a-f]{40}$")
PROJECT_REF_RE = re.compile(r"^[a-z]{20}$")
VERSION_RE = re.compile(r"^\d{14}$")
REHEARSAL_MODES = ("claim", "merged-main-rehearsal", "historical-recovery")


class InstanceBindingError(ValueError):
    """The preview rehearsal cannot be bound to a commit and a database."""


def _versions(raw: str) -> list[str]:
    versions = [v.strip() for v in str(raw).split(",") if v.strip()]
    if not versions:
        raise InstanceBindingError("preview instance binding requires a non-empty allowlist")
    bad = [v for v in versions if not VERSION_RE.match(v)]
    if bad:
        raise InstanceBindingError(
            "preview instance binding allowlist is not exact 14-digit versions: " + ", ".join(bad)
        )
    return versions


def build(
    *, applied_commit: str, preview_project_ref: str, production_project_ref: str,
    run_id: str, allowlist: str, rehearsal_mode: str, source_pr: str = "",
    merge_commit_sha: str = "",
) -> dict[str, Any]:
    """Assemble the record from the values the preview job actually used."""
    applied_commit = str(applied_commit).strip().lower()
    preview_project_ref = str(preview_project_ref).strip()
    production_project_ref = str(production_project_ref).strip()
    if not COMMIT_RE.match(applied_commit):
        raise InstanceBindingError(
            f"applied commit {applied_commit!r} is not a full 40-character commit SHA"
        )
    if not PROJECT_REF_RE.match(preview_project_ref):
        raise InstanceBindingError(
            f"preview project ref {preview_project_ref!r} is not a 20-character Supabase project ref"
        )
    if not PROJECT_REF_RE.match(production_project_ref):
        raise InstanceBindingError(
            f"production project ref {production_project_ref!r} is not a 20-character Supabase project ref"
        )
    # Belt and braces. The preview job asserts this before it uses a credential;
    # asserting it again here means the EVIDENCE can never claim a production
    # write was a preview rehearsal.
    if preview_project_ref == production_project_ref:
        raise InstanceBindingError("preview project ref is the PRODUCTION project ref")
    if rehearsal_mode not in REHEARSAL_MODES:
        raise InstanceBindingError(
            f"rehearsal mode {rehearsal_mode!r} is not one of " + ", ".join(REHEARSAL_MODES)
        )
    if not str(run_id).strip().isdigit():
        raise InstanceBindingError("preview instance binding requires the numeric workflow run id")
    record: dict[str, Any] = {
        "schema": SCHEMA,
        "rehearsalMode": rehearsal_mode,
        "appliedCommit": applied_commit,
        "previewProjectRef": preview_project_ref,
        "runId": int(str(run_id).strip()),
        "allowlist": _versions(allowlist),
    }
    if rehearsal_mode == "merged-main-rehearsal":
        if not str(source_pr).strip().isdigit():
            raise InstanceBindingError(
                "a merged-main rehearsal must name its merged source pull request"
            )
        if not COMMIT_RE.match(str(merge_commit_sha).strip().lower()):
            raise InstanceBindingError(
                "a merged-main rehearsal must name the merge commit that put its work on main"
            )
        record["sourcePr"] = int(str(source_pr).strip())
        record["mergeCommitSha"] = str(merge_commit_sha).strip().lower()
    return record


def verify(
    raw: str | None, *, applied_commit: str, preview_project_ref: str,
    production_project_ref: str, run_id: int, allowlist: list[str],
    source_pr: int | None = None, merge_commit_sha: str | None = None,
) -> dict[str, Any]:
    """Re-check a record from a downloaded evidence artifact. Fails closed.

    ``source_pr`` and ``merge_commit_sha`` are the pull request being promoted
    and the merge commit that put it on main. ``build`` has always WRITTEN those
    two fields for a merged-main rehearsal; until independent review caught it,
    nothing ever READ them, so a rehearsal belonging to some other merged pull
    request satisfied the binding. They are mandatory for that mode now, and the
    caller must supply what to match them against.
    """
    if not raw:
        raise InstanceBindingError(
            "preview evidence carries no instance binding; it cannot prove which commit "
            "it applied or which preview database it applied to"
        )
    try:
        record = json.loads(raw)
    except (json.JSONDecodeError, TypeError) as exc:
        raise InstanceBindingError("preview instance binding is not readable JSON") from exc
    if not isinstance(record, dict):
        raise InstanceBindingError("preview instance binding is not an object")
    if record.get("schema") != SCHEMA:
        raise InstanceBindingError(
            f"preview instance binding schema is {record.get('schema')!r}, expected {SCHEMA!r}"
        )
    if record.get("rehearsalMode") not in REHEARSAL_MODES:
        raise InstanceBindingError(
            f"preview instance binding rehearsal mode {record.get('rehearsalMode')!r} is unknown"
        )
    if record.get("appliedCommit") != applied_commit:
        raise InstanceBindingError(
            f"preview instance binding names applied commit {record.get('appliedCommit')!r}, "
            f"but the evidence artifact was produced at {applied_commit!r}"
        )
    if not PROJECT_REF_RE.match(str(preview_project_ref or "")):
        raise InstanceBindingError(
            "the expected preview project ref was not supplied to the production gate; "
            "an unset ref is never treated as a default"
        )
    if preview_project_ref == production_project_ref:
        raise InstanceBindingError("the expected preview project ref is the PRODUCTION project ref")
    if record.get("previewProjectRef") != preview_project_ref:
        raise InstanceBindingError(
            f"preview rehearsal ran against project {record.get('previewProjectRef')!r}, "
            f"not the current preview project {preview_project_ref!r}; a rebuilt preview "
            "never inherits the proof of the database it replaced"
        )
    if record.get("runId") != run_id:
        raise InstanceBindingError(
            f"preview instance binding belongs to run {record.get('runId')!r}, not run {run_id}"
        )
    # COMPARED AS A LIST, and the reason is NOT that this preserves "the sequence
    # preview applied" -- #1213 round 5 judged that claim overstated and it is
    # withdrawn. `parse_allowlist` already refuses any allowlist that is not
    # sorted, historical recovery refuses the same, and the CLI applies files in
    # version order regardless, so list equality and set equality are identical
    # for every allowlist that can reach this line. The list compare stays
    # because it is the simpler, stricter spelling, and it defends nothing extra.
    if record.get("allowlist") != list(allowlist):
        raise InstanceBindingError(
            f"preview instance binding covers versions {record.get('allowlist')!r}, "
            f"not the promoted allowlist {list(allowlist)!r}"
        )
    if record.get("rehearsalMode") == "merged-main-rehearsal":
        if (
            # `isinstance(True, int)` is True in Python, so the bool exclusion is
            # not pedantry: without it `source_pr=True` reaches the equality
            # comparison below and the refusal that fires is "not the pull request
            # being promoted", which says the wrong thing about the wrong guard.
            # `prove_historical_original_apply_runs` in the production gate
            # already spells it this way; these two must not disagree about what
            # counts as a pull-request number. (#1213 round 9, author's hunt.)
            isinstance(source_pr, bool)
            or not isinstance(source_pr, int)
            or not isinstance(merge_commit_sha, str)
            or not COMMIT_RE.match(merge_commit_sha.strip().lower())
        ):
            raise InstanceBindingError(
                "the promotion pull request and its merge commit were not supplied to the "
                "production gate; a merged-main rehearsal is never accepted unbound"
            )
        if record.get("sourcePr") != source_pr:
            raise InstanceBindingError(
                f"preview rehearsal was performed for pull request {record.get('sourcePr')!r}, "
                f"not the pull request being promoted (#{source_pr})"
            )
        if str(record.get("mergeCommitSha") or "").lower() != merge_commit_sha.strip().lower():
            raise InstanceBindingError(
                f"preview rehearsal names merge commit {record.get('mergeCommitSha')!r}, "
                f"not the merge commit {merge_commit_sha!r} of the pull request being promoted"
            )
    return record


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--applied-commit", required=True)
    parser.add_argument("--preview-project-ref", required=True)
    parser.add_argument("--production-project-ref", required=True)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--allowlist", required=True)
    parser.add_argument("--rehearsal-mode", required=True, choices=list(REHEARSAL_MODES))
    parser.add_argument("--source-pr", default="")
    parser.add_argument("--merge-commit-sha", default="")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        record = build(
            applied_commit=args.applied_commit, preview_project_ref=args.preview_project_ref,
            production_project_ref=args.production_project_ref, run_id=args.run_id,
            allowlist=args.allowlist, rehearsal_mode=args.rehearsal_mode,
            source_pr=args.source_pr, merge_commit_sha=args.merge_commit_sha,
        )
    except InstanceBindingError as exc:
        print(f"::error::REFUSED: {exc}")
        return 2
    args.output.write_text(json.dumps(record, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(record, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
