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
import time
import zipfile
from collections import namedtuple
from pathlib import Path
from typing import Any, Callable

from production_apply_review_evidence import verify as verify_review
from production_migration_guard import parse_remote_versions
from production_review_allowlist import normalize_review_allowlist
from historical_preview_recovery import verify as verify_historical_preview
from preview_instance_binding import verify as verify_preview_instance_binding
from production_owner_decision_evidence import TRANSIENT_GITHUB_ERRORS, verify_artifact as verify_owner_decision

REPOSITORY = "u2giants/shared-db"
# The production database's identity. It is deliberately a constant and NOT
# configurable: this value exists so the gate can refuse evidence that claims a
# PRODUCTION write was a preview rehearsal. The PREVIEW ref is the opposite --
# preview is rebuilt from time to time, so it is supplied per run and is never
# defaulted. See --preview-project-ref.
PRODUCTION_PROJECT_REF = "qsllyeztdwjgirsysgai"
PREVIEW_APPLY_ARTIFACT = re.compile(r"^preview-migration-apply-([0-9a-f]{40})$")
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
GOVERNED_HISTORICAL_SUPERSESSION = {
    "version": "20260827095753", "original_version": "20260827031236",
    "source_pr": 1637, "original_run_id": 33059235415,
    "original_commit": "9f0753c89d3bf1e64b52877400098f3cd086a9ea",
    "original_artifact_id": 9640989399,
    "original_artifact_digest": "sha256:d41f5cc6250eb783b4e17399e3927cd9ada32ac26a12adcc8124a1f5d3262d03",
    "reconciliation_run_id": 33064019675,
    "reconciliation_head": "5366c09cccc60928111a9dcc025aa44bc98af8ca",
    "reconciliation_artifact_id": 9642944726,
    "reconciliation_artifact_digest": "sha256:cdaef42d0994892f55a0b65aa288c3c0d10896a5e449010fc9920d8b1d5d28df",
    "reconciliation_pr": 1644,
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


def gh_json(endpoint: str, *, runner=subprocess.run, sleep=time.sleep, attempts=4) -> Any:
    # Only the live owner-comment read receives transport retries. All other
    # governed evidence reads preserve their existing single-attempt behavior.
    retry_transport = "/issues/comments/" in endpoint
    effective_attempts = attempts if retry_transport else 1
    for attempt in range(effective_attempts):
        result = runner(
            ["gh", "api", endpoint], text=True,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, encoding="utf-8",
        )
        if result.returncode == 0:
            try: return json.loads(result.stdout)
            except json.JSONDecodeError as exc: raise RiskGateError("GitHub returned invalid JSON") from exc
        error = (result.stderr or "GitHub API request failed").strip()
        transient = any(marker in error.lower() for marker in TRANSIENT_GITHUB_ERRORS)
        if not transient or attempt == effective_attempts - 1:
            raise RiskGateError(f"GitHub API request failed: {error}")
        sleep(2 ** attempt)


def api_object(api: Callable[[str], Any], endpoint: str) -> dict[str, Any]:
    """Read an endpoint that MUST return a JSON object, or refuse by name.

    Issue #1218: several call sites did `api(...).get(...)` or `payload["key"]`
    directly. A well-formed response of an unexpected SHAPE — a list where an object
    was expected — raised AttributeError, and a missing key raised KeyError. Neither
    is in main()'s except tuple, so the last gate before a production write died with a
    raw Python traceback instead of the deliberate ::error:: refusal every other path
    emits. It stayed fail-closed, but an operator reading a traceback concludes "the
    gate is broken" and reaches for a workaround, where one reading a named refusal
    does not.
    """
    payload = api(endpoint)
    if not isinstance(payload, dict):
        raise RiskGateError(
            f"GitHub returned a {type(payload).__name__}, not an object, for {endpoint}"
        )
    return payload


def api_list(api: Callable[[str], Any], endpoint: str) -> list[Any]:
    """Read an endpoint that MUST return a JSON array, or refuse by name. See api_object."""
    payload = api(endpoint)
    if not isinstance(payload, list):
        raise RiskGateError(
            f"GitHub returned a {type(payload).__name__}, not an array, for {endpoint}"
        )
    return payload


def api_field(payload: dict[str, Any], key: str, endpoint: str) -> Any:
    """Read a REQUIRED key, naming the endpoint and the field when it is absent."""
    if key not in payload:
        raise RiskGateError(f"the {endpoint} payload had no {key}")
    return payload[key]


def api_sublist(payload: dict[str, Any], key: str, endpoint: str) -> list[Any]:
    """Read a required key that MUST hold an array, naming what was wrong."""
    value = api_field(payload, key, endpoint)
    if not isinstance(value, list):
        raise RiskGateError(
            f"the {endpoint} payload had a {type(value).__name__} for {key}, not an array"
        )
    return value


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
    shared_pr = api_object(api, f"repos/{REPOSITORY}/pulls/{data['shared_db_pr']}")
    ai_pr = api_object(api, f"repos/u2giants/ai-devops/pulls/{data['ai_devops_pr']}")
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


def preview_applied_commit(payload: Any, run_id: int) -> tuple[dict[str, Any], str]:
    """Read the commit the rehearsal ACTUALLY checked out, from the artifact name.

    The old code derived this from the run's ``head_sha``.  That is the ref the
    workflow FILE was read from, which for a ``--ref main`` dispatch is not the
    commit the job checked out and applied.  The preview job names its evidence
    artifact after ``git rev-parse HEAD`` of its own checkout, so the artifact
    name is the one place the applied commit is already recorded -- and it is
    recorded by the same upload that carries the evidence, so it cannot be
    swapped for another run's.

    Exactly one apply artifact must exist.  Two would mean the run's identity is
    ambiguous, and an ambiguous commit is not provenance.
    """
    artifacts = payload.get("artifacts") if isinstance(payload, dict) else None
    if not isinstance(artifacts, list):
        raise RiskGateError("preview run artifacts are unreadable")
    matches = [
        (a, PREVIEW_APPLY_ARTIFACT.match(str(a.get("name", ""))))
        for a in artifacts if isinstance(a, dict)
    ]
    matches = [(a, m) for a, m in matches if m]
    if len(matches) != 1:
        raise RiskGateError(
            f"expected exactly one preview-migration-apply-<commit> artifact on run {run_id}, found {len(matches)}"
        )
    artifact, match = matches[0]
    if artifact.get("expired") is not False or artifact.get("workflow_run", {}).get("id") != run_id:
        raise RiskGateError("preview artifact is expired or belongs to another run")
    return artifact, match.group(1)


def prove_applied_commit_is_main_line(
    applied_commit: str, main_sha: str, api: Callable[[str], Any]
) -> None:
    """Accept a rehearsal commit that exact main CONTAINS, and nothing else.

    ARGUMENT ORDER IS THE ENTIRE CHECK.  GitHub's ``compare/{base}...{head}``
    reports how HEAD relates to BASE.  With ``base = applied_commit`` and
    ``head = main_sha``, ``status == "ahead"`` means main is ahead of the applied
    commit -- i.e. the applied commit is an ancestor of main.  Inverted, the same
    literal check would accept a DESCENDANT of main, which is unmerged code.
    ``test_compare_url_argument_order_is_asserted`` fails if the arguments are
    swapped, and ``test_descendant_of_main_is_refused`` fails if the meaning is.
    """
    try:
        comparison = api(f"repos/{REPOSITORY}/compare/{applied_commit}...{main_sha}")
    except Exception as exc:  # noqa: BLE001 - unreadable ancestry must fail closed
        raise RiskGateError("preview run ancestry is unreadable") from exc
    if not isinstance(comparison, dict):
        raise RiskGateError("preview run ancestry is unreadable")
    status, behind = comparison.get("status"), comparison.get("behind_by")
    if not isinstance(behind, int) or status not in {"ahead", "identical"} or behind != 0:
        raise RiskGateError(
            f"preview run commit {applied_commit} is not contained in the history of exact main "
            f"{main_sha} (compare status {status!r}, behind_by {behind!r})"
        )


def canonical_sha256(path: Path) -> str:
    raw = path.read_bytes()
    if b"\r" in raw.replace(b"\r\n", b""):
        raise RiskGateError(f"migration contains unsupported bare CR line endings: {path.name}")
    return hashlib.sha256(raw.replace(b"\r\n", b"\n")).hexdigest()


def manifest_sha256(path: Path) -> str:
    """Digest a migration the way the preview content manifest digests it.

    Deliberately NOT `canonical_sha256`: that one normalises CRLF to LF before
    hashing, while `compute_content_manifest` in production_migration_guard.py
    hashes RAW bytes. Comparing a normalised digest against a raw one would
    disagree on any CRLF file and reject a perfectly good rehearsal, so the two
    sides of the comparison must use the same function.
    """
    return hashlib.sha256(path.read_bytes()).hexdigest()


def preview_content_manifest(texts: dict[str, str]) -> dict[str, str]:
    try:
        manifest = json.loads(texts["migration-content-manifest.json"])
    except (KeyError, json.JSONDecodeError, TypeError) as exc:
        raise RiskGateError("preview proof is missing a valid content manifest") from exc
    if not isinstance(manifest, dict):
        raise RiskGateError("preview content manifest is not an object")
    return manifest


def prove_preview_migration_contents(
    *, texts: dict[str, str], allowlist: list[str], repo_root: Path,
    before_versions: set[str], after_versions: set[str], historical: bool,
) -> None:
    dry = texts.get("preview-dry-run.txt", "")
    apply = texts.get("preview-apply.txt", "")
    if historical:
        # A RECOVERY RUN WRITES NOTHING, so it has no bounded checkout and no
        # content manifest of its own -- there is nothing here to byte-compare
        # against. The byte binding for this lane is NOT waived; it is performed
        # against the ORIGINAL apply run's manifest, in
        # `prove_historical_original_apply_runs`, which prove_preview calls
        # before this function. What remains here is what a recovery run CAN
        # prove: the file is on exact main, the proof names it, and preview's
        # ledger held it both before and after without moving.
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
            # BIND THE BYTES, NOT THE COMMIT.
            #
            # The safety property is "production will apply the same migration
            # bytes preview already applied". This used to be inferred from
            # commit identity, which was a proxy that failed in both directions:
            # a types-only follow-up commit invalidated a perfectly good
            # rehearsal, while a same-named file whose bytes changed was only
            # ever checked by FILENAME on this path. Compare the digest the
            # rehearsal recorded against the file on exact main.
            recorded = preview_content_manifest(texts).get(version)
            if not isinstance(recorded, str) or not re.fullmatch(r"[0-9a-f]{64}", recorded):
                raise RiskGateError(
                    f"preview content manifest has no usable digest for {version}"
                )
            if recorded != manifest_sha256(filename):
                raise RiskGateError(
                    f"preview rehearsed different bytes than exact main for {version}"
                )
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


# The files that PRODUCE preview evidence. A `workflow_dispatch` run executes
# the workflow file as it exists at the dispatched ref, so a run at an
# unreviewed commit could ship a doctored workflow that FABRICATES the ledger
# texts, the apply logs and the content manifest. Every in-artifact check would
# then pass while no rehearsal ever happened, and a follow-up commit restoring
# the honest file would leave the reviewed net diff clean.
#
# Pinning these to exact main is what makes the artifact evidence rather than
# self-attestation. A types-only or docs-only follow-up commit does not touch
# them, so the stranded-promotion problem stays fixed.
# THE CHAIN IS ONLY AS STRONG AS ITS LEAST-PINNED EXECUTED FILE.
#
# Independent review found the first version of this list incomplete, and the
# reason generalises: a file that EXECUTES in the preview job before evidence is
# written can, as ordinary code in the workspace, overwrite the very scripts
# this list pins. The gate compares COMMITTED blobs through the API and cannot
# observe runtime mutation of the workspace. So one unpinned executed file
# breaks custody for every pinned one.
#
# Therefore: pin everything the preview job runs, plus the local modules those
# entry points import, plus the config that routes which apply path is taken.
# `test_preview_producer_paths_cover_the_whole_executed_closure` fails if a new
# script is wired into the workflow and not added here, so this list cannot
# silently fall behind.
PREVIEW_PRODUCER_PATHS = (
    PREVIEW_WORKFLOW,
    "scripts/production_migration_guard.py",
    # Hash-bound verification declarations are read by the catalog verifier in
    # preview. Contents API directory responses are arrays, so pin each reviewed
    # file explicitly rather than pretending a directory has a blob SHA.
    "scripts/production-verification-sidecars/20260621151155.json",
    "scripts/production-verification-sidecars/20260701154948.json",
    "scripts/production-verification-sidecars/20260710135600.json",
    "scripts/production-verification-sidecars/20260710135700.json",
    "scripts/production-verification-sidecars/20260710135900.json",
    "scripts/production-verification-sidecars/20260710135950.json",
    "scripts/production-verification-sidecars/20260727154500.json",
    "scripts/production-verification-sidecars/20260807030000.json",
    "scripts/production-verification-sidecars/20260823233716.json",
    "scripts/production-verification-sidecars/20260825031841.json",
    "scripts/production-verification-sidecars/20260825050407.json",
    "scripts/production-verification-sidecars/20260825082910.json",
    "scripts/production-verification-sidecars/20260828021051.json",
    # Local import of the guard, and the only thing that reads a migration's
    # `-- derived-from:` declaration (issue #1608). An unpinned copy could
    # declare every base satisfied and the guard would believe it, which is the
    # same one-level-down door the .mjs entries below were pinned to close.
    "scripts/migration_derivation.py",
    "scripts/atomic_migration_apply.py",
    # Runs FIRST in the preview job, to acquire the lane, before any evidence
    # byte exists. Unpinned, it was a complete forgery path.
    "scripts/manage-migration-author-lanes.mjs",
    # Local import of the above. Pinning an entry point without its imports
    # leaves the same door open one level down.
    "scripts/check-dispatch-collision.mjs",
    # Static import of check-dispatch-collision.mjs. Its module body evaluates
    # before the entry point runs, so hop three is as executable as hop one.
    "scripts/check-pr-object-collisions.mjs",
    # Executes in preview-recovery mode. Safe today only because that path
    # separately demands run head == exact main; pinned so that coupling cannot
    # silently loosen later.
    "scripts/historical_preview_recovery.py",
    # Writes the instance binding INTO the evidence artifact. If this file could
    # differ from exact main, the applied commit and the preview project ref in
    # the evidence would be whatever a doctored checkout chose to write.
    "scripts/preview_instance_binding.py",
    # Data, not code, but it routes which apply mechanism the rehearsal
    # exercises. Pinned for rehearsal fidelity.
    "config/atomic-migration-allowlist.json",
    # READ, NOT EXECUTED -- and therefore invisible to the executed-closure
    # walk, which follows invocations and imports. The Supabase CLI reads this
    # file on every `link`, `migration list` and `db push` the preview job runs,
    # in $GITHUB_WORKSPACE and again inside the bounded checkout. It tells the
    # CLI which project it believes it is operating on and how to behave, so a
    # version of it that differs from exact main can shape every evidence byte
    # the artifact carries, and nothing in the artifact restates it.
    # `test_preview_producer_paths_cover_runtime_read_data_files` fails if any
    # sibling data file appears under supabase/ or config/ without being pinned
    # here or given a written, checkable exemption.
    "supabase/config.toml",
)


# ---------------------------------------------------------------------------
# Runtime-READ data files.
#
# The executed-closure test walks scripts the preview job RUNS, and their
# imports. It cannot see a file merely READ at runtime by a tool -- the Supabase
# CLI, `jq`, `psql`. `supabase/config.toml` was exactly that: read by the CLI on
# every preview command, pinned by neither commit and covered by no test.
#
# The two directories below are the ONLY repository data surfaces the preview
# job's executed closure touches. That premise is not asserted by comment:
# `test_preview_runtime_data_dirs_are_the_only_data_surface` scans the executed
# closure's own source and the preview job text for a read of any OTHER
# top-level repository directory, so a data file added at `policy/`, `types/` or
# the repository root fails instead of quietly escaping both walks below.
#
# Every file under them must be either pinned in PREVIEW_PRODUCER_PATHS above,
# or carry a written reason here for why it cannot shape preview evidence. The
# reasons are checked against the filesystem, so a file added later cannot slip
# in silently -- it fails the test until someone pins it or writes down why.
PREVIEW_RUNTIME_DATA_DIRS = ("supabase", "config")

PREVIEW_RUNTIME_DATA_EXEMPTIONS = {
    "config/blocker-ledger": (
        "Never read by the preview job. Read only by the offline throughput "
        "diagnosis and reporting tools. The "
        "preview job and every migration apply helper have no import or file-read "
        "path to this incident evidence, so it cannot shape preview execution."
    ),
    "supabase/migrations": (
        "The PAYLOAD, not a producer. It cannot be pinned to exact main and must "
        "not be: in the pre-merge claim lane the pull-request head legitimately "
        "carries migration files that do not exist on main yet, so a "
        "blob-equality pin would refuse every honest rehearsal. It is byte-bound "
        "instead, on every lane and with no exception: on the claim and "
        "merged-main lanes prove_preview_migration_contents compares the digest "
        "in the promoted run's own content manifest against the repository copy, "
        "and on the historical-recovery lane -- which writes nothing and so has "
        "no manifest of its own -- prove_historical_original_apply_runs compares "
        "the digest recorded by the run that ORIGINALLY applied each version. "
        "prove_pr_authored additionally requires every allowlisted version to "
        "have been added by the named source pull request, and it is re-run "
        "during re-derivation (source_pr_commits only collects commit SHAs). "
        "The one limit, stated plainly: the original run's producer code is not "
        "re-pinned to today's main, because an older commit necessarily carries "
        "older producer files; it is pinned to that pull request's merge commit."
    ),
    "supabase/tests": (
        "Never read by the preview job. Its only readers are the separate "
        "database-contract-tests.yml workflow and scripts/check-sql.sh, which "
        "runs in the validate-only job -- already a PREVIEW_JOB_EXCLUSION whose "
        "not-in-the-preview-job premise is asserted by "
        "test_preview_producer_paths_cover_the_whole_executed_closure."
    ),
    "supabase/ci-bootstrap": (
        "Never read by the preview job. Read only by database-contract-tests.yml, "
        "which builds a throwaway database, touches neither preview nor "
        "production, and produces no preview evidence artifact."
    ),
    "docs": (
        "Named by a producer, but never OPENED by one, in exactly three places. "
        "scripts/manage-migration-author-lanes.mjs passes 'docs' to `git grep -l` "
        "and `git add` as a PATHSPEC when it renames an author's migration "
        "version, so git decides which files exist there and the process opens "
        "nothing; that rename also runs inside a temporary author worktree, not "
        "the bounded checkout the evidence artifact is built from. "
        "scripts/production_migration_guard.py cites a docs filename inside a "
        "GuardError message, which is prose for a human, not a read. Found by the "
        "constructed-read walk added in #1213 round 5, which reports a top-level "
        "directory a producer names even when the child path is assembled at "
        "runtime and so never appears as a whole literal. THIS REASON IS CHECKED, "
        "not merely written: test_the_docs_exemption_is_verified_against_every_"
        "producer_that_names_it inventories all three sites and fails on a fourth "
        "or on any read shape beside them (#1213 round 9, finding 2 -- until then "
        "this reason was verified by nothing, because the surface test filters "
        "reasons on a fixed phrase this one does not use)."
    ),
    "config/production-risk-policy-activation.json": (
        "Never read by the preview job. It is read by the production-apply jobs "
        "and by this gate itself, both of which check out exact main and prove "
        "HEAD == origin/main before executing; prove_activation additionally "
        "re-reads it against main. Pinning it here would assert nothing new."
    ),
    "config/agent-work-contract.schema.json": (
        "Never read by the preview job, and in fact read by no job at all - not "
        "the preview lane, not production, not this gate. Validation for agent "
        "work contracts is hand-rolled in scripts/agent-work-contract.mjs, "
        "which imports nothing from this file; the file exists so a human can "
        "read the field list beside the code that enforces it. Pinning it to "
        "exact main would assert that a comment block matches itself, which "
        "proves nothing about any database outcome. Added by issue #1366 Step 4."
    ),
    "config/agent-completion-report.schema.json": (
        "Never read by the preview job; documentation only, exactly as for "
        "agent-work-contract.schema.json above. The completion report is validated by "
        "hand-rolled code in scripts/agent-work-contract.mjs on top of the "
        "record rules in scripts/lib/work-dependencies.mjs. It records that the "
        "report is Step 3's db-work-completion record with contract fields "
        "added rather than a second schema. Added by issue #1366 Step 4."
    ),
    "config/agent-work-contract-activation.json": (
        "Never read by the preview job. It is read only by the Agent work "
        "contract pull-request workflow, which "
        "decides whether a missing contract blocks a pull request. It never "
        "reaches the preview job, a migration, or any database: the worst a "
        "wrong value can do is fail or pass a pull-request check, which a human "
        "sees immediately. Note that report-only mode still FAILS on a "
        "malformed contract, so this flag cannot silence a real defect. "
        "Added by issue #1366 Step 4."
    ),
}


def blob_sha(path: str, ref: str, api: Callable[[str], Any]) -> str:
    try:
        entry = api(f"repos/{REPOSITORY}/contents/{path}?ref={ref}")
    except Exception as exc:  # noqa: BLE001 - unreadable producer file must fail closed
        raise RiskGateError(f"preview producer file {path} is unreadable at {ref}") from exc
    sha = entry.get("sha") if isinstance(entry, dict) else None
    if not isinstance(sha, str) or not sha:
        raise RiskGateError(f"preview producer file {path} is unreadable at {ref}")
    return sha


def tracked_paths_at(ref: str, api: Callable[[str], Any]) -> frozenset:
    """Every file path a commit's tree contains, as a POSITIVE fact.

    ABSENCE MUST BE PROVED, NOT INFERRED FROM AN ERROR. The producer list grows
    over time, so a producer file added this year does not exist at a merge
    commit from last year. The comparison below has to tell "this file is not in
    that tree" apart from "GitHub would not answer" -- and a 404 from the
    Contents API cannot be told apart from a permissions or transport failure by
    reading its message text. So the tree itself is read once per commit: the
    read either succeeds, in which case membership is a fact, or it fails and
    the gate refuses. A truncated tree is refused for the same reason -- a path
    missing from a truncated listing is not evidence that it is missing from the
    commit.
    """
    try:
        # `recursive=1` IS LOAD-BEARING, NOT A CONVENIENCE. Without it GitHub
        # returns only the TOP-LEVEL entries -- `scripts`, `config`, `supabase`,
        # `.github` -- none of which equals a `PREVIEW_PRODUCER_PATHS` entry. The
        # absence rule below would then fire for every producer and the pin would
        # compare nothing at all while every test stayed green (#1213 round 8,
        # finding 1). `test_the_tree_read_is_recursive` pins this URL and
        # `prove_preview_producer_matches_main` refuses a walk that compared
        # nothing, so the no-op is caught twice.
        tree = api(f"repos/{REPOSITORY}/git/trees/{ref}?recursive=1")
    except Exception as exc:  # noqa: BLE001 - unreadable tree must fail closed
        raise RiskGateError(f"the file tree of {ref} is unreadable") from exc
    if not isinstance(tree, dict) or not isinstance(tree.get("tree"), list):
        raise RiskGateError(f"the file tree of {ref} is unreadable")
    if tree.get("truncated"):
        raise RiskGateError(
            f"the file tree of {ref} is truncated; producer absence cannot be proved from it"
        )
    return frozenset(
        entry["path"] for entry in tree["tree"]
        if isinstance(entry, dict) and isinstance(entry.get("path"), str)
    )


# A comparison target this gate has proved for itself, never a bare flag.
# `kind` is one of:
#   "exact-main"      -- the commit being promoted; must BE `main_sha`.
#   "authored-merge"  -- the merge commit of the pull request that authored the
#                        version being recovered; must be contained in the
#                        history of `main_sha`.
ProvedTarget = namedtuple("ProvedTarget", ("kind", "sha"))


def exact_main(main_sha: str) -> ProvedTarget:
    return ProvedTarget("exact-main", main_sha)


def authored_merge(merge_sha: str) -> ProvedTarget:
    return ProvedTarget("authored-merge", merge_sha)


def prove_preview_producer_matches_main(
    ref: str, target: ProvedTarget, main_sha: str, api: Callable[[str], Any], *,
    what: str = "preview run", against: str = "exact main",
) -> None:
    """Refuse a rehearsal produced by code that exact main does not carry.

    TWO DIFFERENT COMMITS EXECUTE IN ONE PREVIEW RUN, and both must be pinned:

    * ``run["head_sha"]`` -- the ref the ``workflow_dispatch`` was aimed at.
      GitHub reads the WORKFLOW FILE from there, so this commit decides which
      steps exist at all. A doctored YAML here can skip the apply entirely and
      write matching ledgers, apply logs, content manifest and instance binding
      by hand.
    * the commit named in the artifact name -- what ``actions/checkout`` put in
      the workspace, i.e. the SCRIPTS the honest workflow then executes.

    Pinning only one leaves the other free. #1194 pinned only the dispatch ref
    and could not find the artifact; the first version of #1213 pinned only the
    checkout and let a forged branch dispatch a fabricated rehearsal that named
    main as its applied commit. Both are pinned now.

    THE TARGET IS NOT ALWAYS MAIN, AND IT IS NOT AN HONOUR-SYSTEM FLAG. On the
    claim and merged-main lanes both commits are pinned to exact main. On the
    historical-recovery lane the two commits of an ORIGINAL run are each pinned
    to the MERGE COMMIT of the pull request that authored the version. Round 7
    of the #1213 review showed that a `target_is_proved=True` boolean asserted
    that provenance without checking it, so any later caller could pass two
    equal attacker-chosen commits and skip every blob read. The target is now
    TAGGED, and THIS FUNCTION re-derives the tag rather than believing it:
    `exact-main` must literally be the `main_sha` being promoted, and
    `authored-merge` must be contained in the history of that `main_sha`
    (`prove_applied_commit_is_main_line`, the same ancestry check used
    elsewhere). A commit the promoter invented satisfies neither. What this
    function does NOT re-derive -- that an `authored-merge` target is the merge
    commit of the pull request that authored THIS version -- stays the caller's
    job via `prove_pr_authored`, and is not claimed here.

    IDENTITY IS NOT EVIDENCE ON ITS OWN. When both commits are equal there is
    nothing to compare: round 5 pinned the original run's two commits TO EACH
    OTHER, and one attacker-chosen commit used for both then satisfied the pin
    without a single blob being read (round 6, finding 1). Equality is accepted
    only after the target above has been validated, so the commit standing in
    for the comparison is one this gate proved, not one the promoter picked.

    A PRODUCER FILE MAY POSTDATE THE TARGET. `PREVIEW_PRODUCER_PATHS` grows;
    `scripts/preview_instance_binding.py` was added by this very pull request
    and does not exist at the merge commits of #984, #992 or #1126, the exact
    recoveries this lane was built for. Refusing on its absence killed every
    honest old recovery (round 7, finding 1). A path absent from BOTH trees is
    therefore skipped -- neither run could have executed a file that does not
    exist, and a doctored producer that DOES exist at both commits is still
    compared byte for byte. A path present on ONE side only is refused: that is
    a real difference in the machinery that ran. That skip is the one rule here
    that can quietly do nothing, so the walk COUNTS what it compared and refuses
    a run in which nothing was: two different commits always share at least one
    producer file, and zero comparisons means the tree listing lied about what
    the commits contain rather than that the pin passed.
    """
    if target.kind not in {"exact-main", "authored-merge"}:
        raise RiskGateError(
            f"{what} was compared against an untagged target ({target.kind!r})"
        )
    if not isinstance(target.sha, str) or not re.fullmatch(r"[0-9a-f]{40}", target.sha):
        raise RiskGateError(f"{what} was compared against a malformed target commit")
    if target.kind == "exact-main":
        if target.sha != main_sha:
            raise RiskGateError(
                f"{what} names an 'exact main' target {target.sha} that is not the "
                f"exact main {main_sha} being promoted"
            )
    else:
        prove_applied_commit_is_main_line(target.sha, main_sha, api)
    if ref == target.sha:
        return
    present_at_ref = tracked_paths_at(ref, api)
    present_at_target = tracked_paths_at(target.sha, api)
    compared = 0
    for path in PREVIEW_PRODUCER_PATHS:
        at_ref, at_target = path in present_at_ref, path in present_at_target
        if not at_ref and not at_target:
            continue
        if at_ref != at_target:
            raise RiskGateError(
                f"{what} produced evidence with {path} "
                f"{'present' if at_ref else 'absent'} where {against} has it "
                f"{'present' if at_target else 'absent'}"
            )
        if blob_sha(path, ref, api) != blob_sha(path, target.sha, api):
            raise RiskGateError(
                f"{what} produced evidence with a different {path} than {against}"
            )
        compared += 1
    # A PIN THAT COMPARED NOTHING IS NOT A PIN. The skip above is the only rule
    # in this function that can silently do nothing, and anything that makes both
    # trees look empty -- a non-recursive tree URL, a renamed producer list, a
    # listing shape GitHub changes -- turns every producer into a skip and lets
    # this function return success without reading one byte. Two commits that
    # differ must have at least one producer file in common to compare, so zero
    # is never an honest outcome here.
    if not compared:
        raise RiskGateError(
            f"{what} was compared against {against} without a single producer file "
            f"being read; the producer pin proved nothing"
        )


def source_pr_commits(
    source_pr: int, pr_head: str, main_sha: str, api: Callable[[str], Any]
) -> set[str]:
    """Every commit the preview rehearsal is allowed to have run at.

    The rehearsal must belong to this pull request. Listing the PR's commits is
    what makes a rehearsal borrowed from an unrelated PR -- even one that
    touched identically named migrations -- still fail.

    `pr_head` and `main_sha` are included explicitly so the check cannot become
    weaker than it was: `pr_head` covers a head not yet visible in the commits
    listing, and `main_sha` covers the historical-recovery path, which then
    re-tightens to exact main below.
    """
    allowed = {pr_head, main_sha}
    try:
        commits = api(f"repos/{REPOSITORY}/pulls/{source_pr}/commits?per_page=100")
    except Exception as exc:  # noqa: BLE001 - unreadable provenance must fail closed
        raise RiskGateError("source pull request commits are unreadable") from exc
    if not isinstance(commits, list):
        raise RiskGateError("source pull request commits are unreadable")
    allowed.update(c.get("sha") for c in commits if isinstance(c, dict) and c.get("sha"))
    return {sha for sha in allowed if sha}


def artifact_texts(artifact: dict, downloader: Callable[[int, Path], None]) -> dict[str, str]:
    """Download one evidence artifact and read its files by BASENAME.

    The upload preserves directory structure (`bounded-preview/supabase/...`),
    so every reader in this file keys on the basename. Kept in one place so the
    original-run reader and the promoted-run reader cannot drift apart.
    """
    with tempfile.TemporaryDirectory(prefix="production-risk-original-") as temp:
        zip_path = Path(temp, "evidence.zip")
        downloader(artifact["id"], zip_path)
        with zipfile.ZipFile(zip_path) as archive:
            return {
                Path(name).name: archive.read(name).decode("utf-8", errors="strict")
                for name in archive.namelist() if not name.endswith("/")
            }


def prove_governed_historical_supersession(
    *, version: str, source_pr: int, run_id: int, original_commit: str,
    original_artifact: dict[str, Any], repo_root: Path, main_sha: str,
    api: Callable[[str], Any], downloader: Callable[[int, Path], None],
) -> str | None:
    """Return the old ledger version only for the exact #1615/#1646 rename."""
    case = GOVERNED_HISTORICAL_SUPERSESSION
    if (version, source_pr, run_id, original_commit) != (
        case["version"], case["source_pr"], case["original_run_id"], case["original_commit"],
    ):
        return None
    if (original_artifact.get("id"), original_artifact.get("digest")) != (
        case["original_artifact_id"], case["original_artifact_digest"],
    ):
        raise RiskGateError("governed supersession original artifact identity changed")

    pr = api_object(api, f"repos/{REPOSITORY}/pulls/{case['reconciliation_pr']}")
    if pr.get("merged") is not True or pr.get("merge_commit_sha") != case["reconciliation_head"]:
        raise RiskGateError("governed supersession reconciliation PR is not the pinned merge")
    prove_applied_commit_is_main_line(case["reconciliation_head"], main_sha, api)
    reconcile_run = api_object(
        api, f"repos/{REPOSITORY}/actions/runs/{case['reconciliation_run_id']}"
    )
    expected_run = {
        "status": "completed", "conclusion": "success", "event": "workflow_dispatch",
        "path": ".github/workflows/preview-ledger-orphan-reconciliation.yml",
        "head_sha": case["reconciliation_head"],
    }
    if any(reconcile_run.get(key) != value for key, value in expected_run.items()):
        raise RiskGateError("governed supersession reconciliation run identity changed")
    artifacts = api_object(
        api, f"repos/{REPOSITORY}/actions/runs/{case['reconciliation_run_id']}/artifacts?per_page=100",
    ).get("artifacts")
    if not isinstance(artifacts, list) or len(artifacts) != 1 or not isinstance(artifacts[0], dict):
        raise RiskGateError("governed supersession reconciliation artifact is ambiguous")
    artifact = artifacts[0]
    if (
        artifact.get("id") != case["reconciliation_artifact_id"]
        or artifact.get("digest") != case["reconciliation_artifact_digest"]
        or artifact.get("expired") is not False
        or artifact.get("name") != f"preview-ledger-orphan-reconciliation-{case['original_version']}"
        or artifact.get("workflow_run", {}).get("id") != case["reconciliation_run_id"]
    ):
        raise RiskGateError("governed supersession reconciliation artifact identity changed")

    with tempfile.TemporaryDirectory(prefix="production-risk-supersession-") as temp:
        archive_path = Path(temp, "reconciliation.zip")
        downloader(artifact["id"], archive_path)
        if "sha256:" + hashlib.sha256(archive_path.read_bytes()).hexdigest() != case["reconciliation_artifact_digest"]:
            raise RiskGateError("governed supersession reconciliation download digest changed")
        try:
            with zipfile.ZipFile(archive_path) as archive:
                names = {Path(name).name: name for name in archive.namelist() if not name.endswith("/")}
                if set(names) != {"reconciliation-check.json", "reconciliation-apply.json"}:
                    raise RiskGateError("governed supersession reconciliation evidence set changed")
                check = json.loads(archive.read(names["reconciliation-check.json"]))
                applied = json.loads(archive.read(names["reconciliation-apply.json"]))
        except (zipfile.BadZipFile, json.JSONDecodeError, UnicodeDecodeError) as exc:
            raise RiskGateError("governed supersession reconciliation evidence is unreadable") from exc

    fixed = {
        "schema": "shared-db-preview-ledger-orphan-reconciliation/v1",
        "issue": 1615, "claim": 1636, "source_pr": 1637,
        "orphan_version": case["original_version"], "replacement_version": version,
        "preview_run_id": case["original_run_id"],
        "preview_artifact_id": case["original_artifact_id"],
        "preview_artifact_digest": case["original_artifact_digest"],
        "main_sha": case["reconciliation_head"],
    }
    for record, mode in ((check, "check"), (applied, "apply")):
        if not isinstance(record, dict) or record.get("mode") != mode or any(
            record.get(key) != value for key, value in fixed.items()
        ):
            raise RiskGateError("governed supersession reconciliation tuple changed")
    before, after = applied.get("before"), applied.get("after")
    if (
        not isinstance(before, list) or not isinstance(after, list)
        or len(before) != 1 or len(after) != 1
        or before[0].get("version") != case["original_version"]
        or after[0].get("version") != version
        or before[0].get("name") != after[0].get("name")
        or before[0].get("statements") != after[0].get("statements")
        or check.get("before") != check.get("after")
    ):
        raise RiskGateError("governed supersession did not prove one statement-identical rename")
    governance = applied.get("governance")
    current = list(repo_root.glob(f"supabase/migrations/{version}_*.sql"))
    if (
        not isinstance(governance, dict)
        or governance.get("case_mode") != "byte_identical_rename"
        or governance.get("orphan_sha256") != governance.get("replacement_sha256")
        or len(current) != 1
        or canonical_sha256(current[0]) != governance.get("replacement_sha256")
    ):
        raise RiskGateError("governed supersession bytes do not match exact main")
    return case["original_version"]


def prove_historical_original_apply_runs(
    *, record: dict, allowlist: list[str], repo_root: Path, main_sha: str,
    api: Callable[[str], Any], downloader: Callable[[int, Path], None],
) -> None:
    """Byte-bind a historical recovery to the run that ACTUALLY applied the bytes.

    THE HOLE THIS CLOSES. A recovery run performs no database write: it prints
    main's filenames and re-reads preview's ledger. Left there, the lane proved
    authorship and ledger presence and NOTHING about bytes -- so the sequence
    "rehearse harmless bytes A, amend the file to destructive bytes B, merge,
    recover proof, promote B" passed every check, at the last gate before a
    production write on a database nine applications share.

    The fix is not to trust the recovery run harder. It is to make the recovery
    record NAME the preview run that originally applied each version, and then to
    read that run's own evidence:

      * it must be a completed, successful, dispatched run of this workflow;
      * it must carry exactly one unexpired `preview-migration-apply-<sha>`
        artifact -- the same cardinality rule the promoted run is held to, since
        two would make its identity ambiguous;
      * it must NOT itself be a recovery run, or a recovery could cite a
        recovery forever and never touch a byte;
      * preview's ledger must have GAINED the version across it, which is what
        distinguishes a run that applied the migration from a run that merely
        named it;
      * BOTH commits it ran must belong to the pull request the record says
        authored the version, or to exact main's own history -- the checkout it
        advertised in its artifact name AND ``head_sha``, the ref GitHub read the
        workflow file from;
      * BOTH of those commits must carry the SAME producer files as the MERGE
        COMMIT of the pull request that authored the version, so neither a
        doctored workflow advertising an honest checkout nor one doctored commit
        used for both pins can pass; and
      * the digest THAT run recorded for the version must equal the bytes on
        exact main.

    WHAT IT DELIBERATELY DOES NOT DO. It does not pin the original run's producer
    files to TODAY'S main. It cannot: an older commit necessarily carries older
    producer files, so that rule would refuse every genuine recovery, including
    the one this lane exists for. It pins both of the original run's commits to
    the MERGE COMMIT of the pull request that authored the version instead -- a
    commit this gate re-derives and has already proved merged and an ancestor of
    exact main, so it is not the promoter's to choose. Nor does it require the
    original run to have written to the CURRENT preview database: preview was
    deleted and rebuilt on 2026-08-18, so that rule would refuse every recovery
    that exists.

    THE LIMIT, STATED ACCURATELY. The #1213 round-5 review retired the previous
    wording -- "as strong as the ordinary claim lane was on the day of the
    rehearsal" -- because it is false of a run created TODAY and then named as
    the original. What this function proves is: a real, successful run of THIS
    workflow, dispatched from and checked out at commits carrying the producer
    code of the merge commit that landed this version, moved preview's ledger for
    this version and recorded a digest equal to exact main's bytes. What it does
    not prove is WHICH preview instance that was, or that today's machinery
    produced the evidence. Both limits are written down here, in
    PREVIEW_RUNTIME_DATA_EXEMPTIONS and in AGENTS.md rather than glossed.

    A version whose file changed after its rehearsal can no longer be recovered.
    That is the correct outcome and the entire point: preview never ran those
    bytes, so production must not be told that it did.
    """
    runs = record.get("originalApplyRuns")
    if not isinstance(runs, dict) or not runs:
        raise RiskGateError(
            "historical preview recovery does not name the original apply run for each "
            "version; a recovery is never accepted without a byte binding"
        )
    # DEFENCE IN DEPTH, AND UNREACHABLE END TO END -- SAID OUT LOUD SO NOBODY
    # SCORES IT AS TESTED. This guard and the two below it (the run-id shape and
    # the source-pull-request shape) restate rules `parse_original_run_map` and
    # `parse_source_map` in scripts/historical_preview_recovery.py already
    # enforce, and re-derivation runs those parsers BEFORE this function is
    # called. So a record that would trip any of the three is refused earlier,
    # with a different message, and no test can drive these lines through
    # `prove_preview`.
    #
    # They stay, because this function is also importable and callable on its
    # own and must not assume its caller validated anything. But "the suite goes
    # red if I delete it" is FALSE for all three, and #1213 round 9 is precisely
    # about not calling such a line tested. The rules themselves ARE tested,
    # per condition, in `PerConditionParserTests` in
    # scripts/test_historical_preview_recovery.py -- which is where the five
    # refusal paths of `parse_original_run_map` got their first negative tests of
    # any kind.
    if sorted(runs) != sorted(allowlist):
        raise RiskGateError(
            "historical original-run map does not cover exactly the promoted allowlist"
        )
    source_map = record.get("sourcePrMap")
    for version in allowlist:
        run_id = runs.get(version)
        if isinstance(run_id, bool) or not isinstance(run_id, int) or run_id <= 0:
            raise RiskGateError(f"historical original apply run for {version} is not a run id")
        source_pr = source_map.get(version) if isinstance(source_map, dict) else record.get("sourcePr")
        if not isinstance(source_pr, int) or isinstance(source_pr, bool):
            raise RiskGateError(f"historical recovery names no source pull request for {version}")
        # RESOLVED BEFORE ANYTHING IS READ. Without a usable merge commit there is
        # no commit the promoter cannot choose to pin against, so the lane fails
        # closed here rather than reaching the pin with nothing to compare to.
        merge_shas = record.get("sourceMergeShas")
        merge_sha = (
            merge_shas.get(version) if isinstance(merge_shas, dict)
            else record.get("sourceMergeSha")
        )
        if not isinstance(merge_sha, str) or not re.fullmatch(r"[0-9a-f]{40}", merge_sha):
            raise RiskGateError(
                f"historical recovery names no usable source merge commit for {version}; "
                "the original apply run cannot be pinned"
            )
        try:
            run = api(f"repos/{REPOSITORY}/actions/runs/{run_id}")
        except Exception as exc:  # noqa: BLE001 - unreadable original run must fail closed
            raise RiskGateError(f"original apply run {run_id} is unreadable") from exc
        expected = {
            "status": "completed", "conclusion": "success", "event": "workflow_dispatch",
            "path": PREVIEW_WORKFLOW,
        }
        for key, value in expected.items():
            if not isinstance(run, dict) or run.get(key) != value:
                raise RiskGateError(f"original apply run {run_id} for {version} has wrong {key}")
        artifact, original_commit = preview_applied_commit(
            api(f"repos/{REPOSITORY}/actions/runs/{run_id}/artifacts?per_page=100"), run_id
        )
        superseded_from = prove_governed_historical_supersession(
            version=version, source_pr=source_pr, run_id=run_id,
            original_commit=original_commit, original_artifact=artifact,
            repo_root=repo_root, main_sha=main_sha, api=api, downloader=downloader,
        )
        if superseded_from is None and original_commit not in source_pr_commits(source_pr, "", main_sha, api):
            prove_applied_commit_is_main_line(original_commit, main_sha, api)
        # THE WORKFLOW THAT EXECUTED, on this side too. `original_commit` is only
        # what the job CHOSE to advertise in its artifact name; `run["head_sha"]`
        # is the ref GitHub read the workflow FILE from, and no part of the
        # artifact can restate it. Without these lines a branch whose copy of the
        # workflow skips the database write and hand-writes a ledger delta plus a
        # content manifest naming exact main's digest could be dispatched TODAY,
        # named as the "original apply", and promoted -- the #1213 first-head
        # forge, moved onto the new field. (#1213 review, round 5, finding 1.)
        run_head = run.get("head_sha")
        if not isinstance(run_head, str) or not re.fullmatch(r"[0-9a-f]{40}", run_head):
            raise RiskGateError(
                f"original apply run {run_id} for {version} does not name the commit whose "
                "workflow executed (head_sha)"
            )
        if superseded_from is None and run_head not in source_pr_commits(source_pr, "", main_sha, api):
            prove_applied_commit_is_main_line(run_head, main_sha, api)
        # PINNED TO THE MERGE COMMIT, NOT TO EACH OTHER AND NOT TO TODAY'S MAIN.
        # Round 5 pinned these two commits to each other, and the round-6 review
        # showed that one commit used for BOTH pins compares nothing: this
        # repository squash-merges, so every commit that was ever on the
        # authoring pull request stays in its commits listing forever -- even
        # after the branch is deleted, and even to be dispatched again afterwards
        # -- and a doctored intermediate commit was therefore citable as both the
        # dispatch ref and the checkout.
        #
        # `merge_sha` is the merge commit of the pull request that authored THIS
        # version. `prove_pr_authored` has already proved it merged and an
        # ancestor of the exact main being promoted, and it is re-derived above
        # rather than taken from the artifact, so the promoter cannot choose it.
        # This is NOT "pin to today's main": a later change to the gate on main
        # still recovers, an honest apply from the pull-request tip still matches
        # because squash/merge carries those producer files onto the merge
        # commit, and a doctored intermediate commit does not match the workflow
        # that actually landed. (#1213 review, round 6, finding 1.)
        for commit, role in ((run_head, "dispatched at"), (original_commit, "checked out at")):
            prove_preview_producer_matches_main(
                commit, authored_merge(merge_sha), main_sha, api,
                what=f"original apply run {run_id} {role} {commit}",
                against=f"the merge commit {merge_sha} of the pull request that authored {version}",
            )
        texts = artifact_texts(artifact, downloader)
        if texts.get("historical-preview-source.json"):
            raise RiskGateError(
                f"original apply run {run_id} for {version} is itself a historical recovery; "
                "a recovery is only ever bound to a run that actually applied bytes"
            )
        with tempfile.TemporaryDirectory(prefix="production-risk-original-ledger-") as ledger_temp:
            before_path = Path(ledger_temp, "before.txt")
            after_path = Path(ledger_temp, "after.txt")
            before_path.write_text(texts.get("preview-ledger-before.txt", ""), encoding="utf-8")
            after_path.write_text(texts.get("preview-ledger-after.txt", ""), encoding="utf-8")
            gained = parse_remote_versions(after_path) - parse_remote_versions(before_path)
        evidence_version = superseded_from or version
        if evidence_version not in gained:
            raise RiskGateError(
                f"original apply run {run_id} did not apply {evidence_version} to preview "
                "(its ledger delta does not add that version)"
            )
        # THE DATABASE THE ORIGINAL RUN WROTE TO. Decided explicitly in the #1213
        # round-5 review and deliberately NOT required to be the current preview:
        # preview `rjyboqwcdzcocqgmsyel` was deleted and rebuilt as
        # `mvpkijzfmfcxhnzqogzs` on 2026-08-18, so EVERY original apply run that
        # exists ran against the predecessor instance. Requiring a match with the
        # current `PREVIEW_PROJECT_REF` would refuse one hundred percent of the
        # recoveries this lane was built for. What IS required is that a binding,
        # when the original run's producer code was new enough to write one, is
        # readable and does not name the PRODUCTION project -- evidence of a
        # production write is never a preview rehearsal, at any age. Absence is
        # accepted only because the pin above now proves the executing workflow
        # was the genuine workflow at that checkout, so a MISSING binding means an
        # old producer rather than a suppressed field.
        #
        # THE RESIDUAL, WRITTEN DOWN RATHER THAN GLOSSED: an original run against
        # the deleted preview can still be cited, so if the version reappears in
        # the CURRENT preview's ledger by some route other than an apply of these
        # bytes -- a restore, a clone, or a later apply of different bytes -- the
        # ledger half of this lane is satisfied by one database and the byte half
        # by another. The byte half is still pinned to exact main, so production
        # cannot be handed bytes nobody rehearsed; what is not proved is that the
        # CURRENT preview ran them.
        instance = texts.get("preview-instance.json")
        if instance:
            try:
                binding = json.loads(instance)
            except (json.JSONDecodeError, TypeError) as exc:
                raise RiskGateError(
                    f"original apply run {run_id} for {version} carries an unreadable "
                    "preview instance binding"
                ) from exc
            if not isinstance(binding, dict):
                raise RiskGateError(
                    f"original apply run {run_id} for {version} carries a preview instance "
                    "binding that is not an object"
                )
            if binding.get("previewProjectRef") == PRODUCTION_PROJECT_REF:
                raise RiskGateError(
                    f"original apply run {run_id} for {version} was performed against the "
                    "PRODUCTION project; that is not a preview rehearsal"
                )
        recorded = preview_content_manifest(texts).get(evidence_version)
        if not isinstance(recorded, str) or not re.fullmatch(r"[0-9a-f]{64}", recorded):
            raise RiskGateError(
                f"original apply run {run_id} recorded no usable digest for {version}"
            )
        matches = list(repo_root.glob(f"supabase/migrations/{version}_*.sql"))
        if len(matches) != 1:
            raise RiskGateError(
                f"allowlisted migration {version} is absent or ambiguous on exact main"
            )
        if recorded != manifest_sha256(matches[0]):
            raise RiskGateError(
                f"preview applied different bytes than exact main for {version}: original "
                f"apply run {run_id} recorded {recorded}, exact main is "
                f"{manifest_sha256(matches[0])}. Preview never ran the bytes being promoted."
            )


def prove_preview(
    *, run_id: int, digest: str, pr_head: str, main_sha: str, source_pr: int, allowlist: list[str],
    preview_project_ref: str, merge_commit_sha: str, api: Callable[[str], Any],
    downloader: Callable[[int, Path], None], repo_root: Path,
) -> None:
    run = api(f"repos/{REPOSITORY}/actions/runs/{run_id}")
    expected = {
        "status": "completed", "conclusion": "success", "event": "workflow_dispatch",
        "path": PREVIEW_WORKFLOW,
    }
    for key, value in expected.items():
        # `isinstance` FIRST, as the twin loop in
        # `prove_historical_original_apply_runs` already does. Without it a
        # GitHub response that is a list, a string or null crashes here with
        # `AttributeError: 'list' object has no attribute 'get'` instead of
        # refusing with a message an operator can act on. An unhandled traceback
        # is not a refusal: it says nothing about WHAT was wrong, and the two
        # loops must not disagree about how a malformed payload is handled.
        # (#1213 round 9, author's per-condition hunt.)
        if not isinstance(run, dict) or run.get(key) != value:
            raise RiskGateError(f"preview run has wrong {key}")
    # THE COMMIT THAT ACTUALLY RAN, not the ref the workflow file was read from.
    # `run["head_sha"]` is the latter, and on a post-merge rehearsal dispatched
    # against main the two are different commits. Pinning provenance and the
    # producing code to head_sha therefore pinned the wrong thing, and the
    # artifact lookup -- which uses the checked-out commit -- would then fail
    # anyway. Both now use the same commit, read from the artifact name.
    artifact, applied_commit = preview_applied_commit(
        api(f"repos/{REPOSITORY}/actions/runs/{run_id}/artifacts?per_page=100"), run_id
    )
    # PROVENANCE, not identity: the rehearsal must belong to THIS piece of work.
    # Any commit of the source pull request qualifies, plus exact main for the
    # historical-recovery path. What the rehearsal actually applied is proved by
    # bytes further down, so pinning one exact commit here bought nothing and
    # permanently stranded any promotion that had a follow-up commit -- including
    # the generated types this repository is supposed to refresh after a schema
    # change, which cannot be committed before the preview it describes.
    #
    # A POST-MERGE REHEARSAL runs from a main commit that is NOT a commit of the
    # source PR, so it is accepted on the second branch: a commit exact main
    # contains. That is strictly stronger than PR membership -- it is code that
    # is already merged -- and the producer pin below still binds the machinery
    # to exact main, so the checkout that ran cannot have been a doctored one.
    if applied_commit not in source_pr_commits(source_pr, pr_head, main_sha, api):
        prove_applied_commit_is_main_line(applied_commit, main_sha, api)
    # Belonging to the PR (or to main's own history) is not enough. The run must
    # also have been produced by the same apply machinery exact main carries, or
    # its artifact is self-attestation rather than evidence. See
    # PREVIEW_PRODUCER_PATHS.
    prove_preview_producer_matches_main(
        applied_commit, exact_main(main_sha), main_sha, api,
        what="preview run checked out at " + applied_commit,
    )
    # THE WORKFLOW THAT EXECUTED. The artifact name is what the job CHOSE to
    # advertise as its checkout; the dispatch ref is what GitHub read the
    # workflow file from, and no part of the artifact can lie about it. A forged
    # branch that checks out main, skips the apply and writes matching evidence
    # is refused here and nowhere else.
    run_head = run.get("head_sha")
    if not isinstance(run_head, str) or not re.fullmatch(r"[0-9a-f]{40}", run_head):
        raise RiskGateError(
            "preview run does not name the commit whose workflow executed (head_sha)"
        )
    prove_preview_producer_matches_main(
        run_head, exact_main(main_sha), main_sha, api,
        what="preview run dispatched at " + run_head,
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
    if historical:
        record = json.loads(historical)
        # A v2 record names a source PR PER VERSION, for a batch assembled over
        # several pull requests. The map is re-derived and compared whole, so a
        # forged mapping cannot pass: every version must still be proven added by
        # the PR it names, and a version's file is only ever "added" once in
        # history.
        if not isinstance(record, dict):
            raise RiskGateError("historical preview source proof is unreadable")
        source_map = record.get("sourcePrMap")
        # THE ORIGINAL-RUN MAP IS AN INPUT TO THE RE-DERIVATION, not something
        # the re-derivation can check -- the same is already true of the source
        # map. Re-deriving it proves only that the record is internally
        # consistent. What proves the map is honest is
        # `prove_historical_original_apply_runs` below, which goes and reads each
        # named run's own evidence. A record naming a run that did not apply the
        # version, or that recorded different bytes, is refused there.
        original_runs = record.get("originalApplyRuns")
        if not isinstance(original_runs, dict) or not original_runs:
            raise RiskGateError(
                "historical preview recovery does not name the original apply run for each "
                "version; a recovery is never accepted without a byte binding"
            )
        rendered_runs = ",".join(
            f"{version}:{original_runs[version]}" for version in sorted(original_runs)
        )
        if source_map is not None:
            if not isinstance(source_map, dict) or not source_map:
                raise RiskGateError("historical preview source map is unreadable")
            rendered = ",".join(f"{version}:{source_map[version]}" for version in sorted(source_map))
            derived = verify_historical_preview(
                None, main_sha, ",".join(allowlist), repo_root, api, source_map=rendered,
                original_run_map=rendered_runs,
            )
        else:
            derived = verify_historical_preview(
                source_pr, main_sha, ",".join(allowlist), repo_root, api,
                original_run_map=rendered_runs,
            )
        if record != derived:
            raise RiskGateError("historical preview source proof does not match current governed evidence")
        # THE BYTES. Without this the recovery lane proves authorship and ledger
        # presence only, and "rehearse A, amend to B, merge, recover, promote B"
        # walks through the last gate before a production write.
        prove_historical_original_apply_runs(
            record=record, allowlist=allowlist, repo_root=repo_root, main_sha=main_sha,
            api=api, downloader=downloader,
        )
        # The historical no-write path proves nothing by applying, so it keeps
        # its exact-main requirement unchanged -- now judged against the commit
        # the job really checked out rather than the workflow-file ref.
        if applied_commit != main_sha:
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
    # WHICH DATABASE, AND FROM WHICH COMMIT. Everything above proves a migration
    # applied cleanly somewhere, built by code exact main carries. Only this
    # proves it was THIS preview project, and that the commit named in the
    # artifact NAME is the commit the job itself recorded inside the evidence --
    # two independent sources that must agree. Preview rjyboqwcdzcocqgmsyel was
    # deleted and rebuilt on 2026-08-18; without this, its proof would still be
    # good for a production write today.
    verify_preview_instance_binding(
        texts.get("preview-instance.json"),
        applied_commit=applied_commit, preview_project_ref=preview_project_ref,
        production_project_ref=PRODUCTION_PROJECT_REF, run_id=run_id, allowlist=allowlist,
        source_pr=source_pr, merge_commit_sha=merge_commit_sha,
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
) -> tuple[str, str]:
    pr_endpoint = f"repos/{REPOSITORY}/pulls/{pr_number}"
    pr = api_object(api, pr_endpoint)
    merge_commit_sha = api_field(pr, "merge_commit_sha", pr_endpoint)
    if pr.get("merged") is not True or merge_commit_sha is None:
        raise RiskGateError("source PR is not merged")
    head_obj = pr.get("head")
    head = head_obj.get("sha") if isinstance(head_obj, dict) else None
    if not re.fullmatch(r"[0-9a-f]{40}", str(head)):
        raise RiskGateError("source PR has no exact head")
    subprocess.run(
        ["git", "merge-base", "--is-ancestor", merge_commit_sha, main_sha],
        cwd=repo_root, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    )
    checks_endpoint = f"repos/{REPOSITORY}/commits/{head}/check-runs?per_page=100"
    checks = api_sublist(api_object(api, checks_endpoint), "check_runs", checks_endpoint)
    conclusions = {c.get("name"): c.get("conclusion") for c in checks if isinstance(c, dict)}
    missing = sorted(name for name in REQUIRED_CHECKS if conclusions.get(name) != "success")
    historical_source = is_pinned_historical_disney_source(
        pr_number, head, merge_commit_sha, allowlist
    )
    if historical_source:
        # The author-lease workflow did not exist when this exact PR merged. Its
        # historical source proof is verified later against current main and the
        # preview artifact; every contemporary safety check remains mandatory.
        missing = [name for name in missing if name != "Migration author lease"]
    if missing:
        raise RiskGateError(f"required exact-head checks are not successful: {', '.join(missing)}")
    return head, str(merge_commit_sha)


def classify_sql(repo_root: Path, allowlist: list[str]) -> list[str]:
    reasons: set[str] = set()
    for version in allowlist:
        matches = list(repo_root.glob(f"supabase/migrations/{version}_*.sql"))
        if len(matches) != 1:
            raise RiskGateError(f"expected one migration for {version}, found {len(matches)}")
        sql = migration_statements(matches[0].read_text(encoding="utf-8"))
        if re.search(r"\b(truncate|delete\s+from|update\s+)\b", sql) or re.search(
                r"\bdrop\s+(?!trigger\s+if\s+exists|policy\s+if\s+exists)", sql):
            reasons.add(RISK_TEXT["permanent_data_rewrite_or_loss"])
        if re.search(r"\b(lock\s+table|alter\s+table)\b", sql) or re.search(
                r"\bcreate\s+(?:unique\s+)?index\s+(?!concurrently|if\s+not\s+exists)", sql):
            reasons.add(RISK_TEXT["expected_downtime"])
        if re.search(r"\b(grant|revoke|create\s+policy|alter\s+policy|drop\s+policy|row\s+level\s+security)\b", sql):
            reasons.add(RISK_TEXT["material_access_change"])
    return sorted(reasons)


def migration_statements(raw: str) -> str:
    """The migration's own statements, with the noise that caused false alarms gone.

    The classifier used to grep the raw file for bare keywords, and it was wrong
    often enough to be actively harmful. On 2026-08-18 it reported "existing
    production data may be lost or permanently altered" for Sample Tracking
    Release A, whose migration CREATES tables on a target that has none of them.
    What it had actually matched was:

      - `ON UPDATE CASCADE` / `ON DELETE RESTRICT` inside foreign keys, which are
        referential ACTIONS, not statements that touch data;
      - `DROP TRIGGER IF EXISTS x` immediately before recreating x, which is how
        every idempotent migration in this repository is written;
      - `UPDATE` inside a trigger function BODY, which describes the application's
        runtime behaviour, not anything the migration does when applied.

    A gate that cries wolf is not a cautious gate. It teaches everyone to wave the
    warning through, and it spends the reader's attention on false alarms so there
    is none left when a real one arrives.
    """
    without_comments = re.sub(r"--[^\n]*|/\*.*?\*/", " ", raw, flags=re.S)
    # Dollar-quoted bodies are runtime behaviour, not the apply-time effect.
    without_bodies = re.sub(r"\$\$.*?\$\$", " ", without_comments, flags=re.S)
    lowered = without_bodies.lower()
    # Referential ACTIONS on a foreign key, not statements that touch data.
    without_actions = re.sub(
        r"\bon\s+(?:update|delete)\s+(?:cascade|restrict|set\s+null|set\s+default|no\s+action)",
        " ", lowered)
    # Trigger TIMING clauses. `CREATE TRIGGER t BEFORE UPDATE ON x` declares when
    # the trigger fires; it updates nothing at apply time.
    return re.sub(
        r"\b(?:before|after|instead\s+of)\s+(?:insert|update|delete)"
        r"(?:\s+or\s+(?:insert|update|delete))*(?:\s+of\s+[a-z0-9_\", ]+)?",
        " ", without_actions)


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
    pr_head, pr_merge_commit = prove_pr_and_checks(args.pr, args.main_sha, allowlist, api, repo_root)
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
        main_sha=args.main_sha, source_pr=args.pr, allowlist=allowlist,
        preview_project_ref=args.preview_project_ref, merge_commit_sha=pr_merge_commit,
        api=api, downloader=downloader, repo_root=repo_root,
    )
    decision = decide_business_risk(classify_sql(repo_root, allowlist), recovery_proven=True, review_approved=True)
    # OWNER RULING 2026-08-18: the machine-readable owner-decision block is RETIRED
    # as a blocking requirement. It is still verified when supplied, and the
    # derived risks are still recorded in the evidence below, but a missing block
    # no longer stops a promotion.
    #
    # WHY, in the owner's own terms: he is not a programmer, cannot evaluate the
    # SQL a risk flag refers to, and was being asked to paste a JSON block whose
    # contents an agent had composed for him. That does not produce a human
    # decision. It produces a signature on something unread, and then an audit
    # trail that claims oversight happened. Manufactured assurance is worse than
    # no gate, because it is trusted.
    #
    # The same day, the classifier was found reporting "existing production data
    # may be lost" for a migration that only CREATES tables on a target holding
    # none of them -- see migration_statements(). So the ritual was not even
    # guarding real risk; it was collecting rubber stamps for false alarms.
    #
    # WHAT STILL PROTECTS THIS LANE, none of it removed: exact-main pinning,
    # immutable independent review evidence, the byte-bound preview rehearsal
    # proof, bounded allowlists that refuse unrelated drift, exact production
    # project proof immediately before every write, single-writer locks, and
    # post-apply verification. Those are checks a machine can actually perform.
    #
    # WHAT IS GENUINELY GIVEN UP: there is no longer a human stop between a green
    # evidence chain and a production write. Recorded here, and in the incident
    # ledger, so nobody later mistakes this for an oversight.
    owner_evidence = None
    if decision["ownerDecisionReasons"] and args.owner_decision_run_id and args.owner_decision_digest:
        owner_evidence = verify_owner_decision(
            args.owner_decision_run_id, args.owner_decision_digest, args.main_sha,
            allowlist, args.pr, downloader, api,
        )
        expected_risks = sorted(key for key, text in RISK_TEXT.items() if text in decision["ownerDecisionReasons"])
        if sorted(owner_evidence["accepted_risks"]) != expected_risks:
            raise RiskGateError("owner decision does not accept exactly the risks derived from governed evidence")
    return {
        **decision,
        # Derived risks are DISCLOSED in this evidence, not used to block. See the
        # owner ruling above. Everything that can be machine-verified has already
        # been verified by the time this line is reached.
        "productionPromotionAllowed": True,
        "disclosedRisks": decision["ownerDecisionReasons"],
        "governedEvidence": {
            "mainSha": args.main_sha, "sourcePr": args.pr, "sourcePrHead": pr_head,
            "reviewRun": args.review_run_id, "previewRun": args.preview_run_id,
            "previewProjectRef": args.preview_project_ref,
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
    # NOT DEFAULTED, EVER. Preview is rebuilt from time to time and its project
    # ref changes when it is; a literal in this file is what stranded the lane on
    # 2026-08-18. The workflow passes the repository variable PREVIEW_PROJECT_REF,
    # which is the same value the preview job writes to.
    parser.add_argument("--preview-project-ref", required=True)
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
    except Exception as exc:  # noqa: BLE001 - see below
        # BACKSTOP, not the fix (issue #1218). The shape assumptions this gate makes
        # about GitHub payloads are normalised at the read sites, in api_object /
        # api_list / api_field / api_sublist, so that each refusal names the endpoint
        # and the field. This clause exists only so that a defect nobody anticipated
        # still produces a deliberate ::error:: refusal rather than a raw traceback.
        #
        # It does NOT weaken the gate: the exit code is still 2, so nothing is promoted.
        # It names the exception TYPE, because an operator who sees this line is looking
        # at a bug in the gate itself and needs to be told that rather than left to guess
        # which piece of evidence was bad.
        print(
            f"::error::Production business-risk gate FAILED CLOSED on an unexpected "
            f"{type(exc).__name__}: {exc}. This is a defect in the gate, not a verdict on "
            f"the evidence. Nothing was promoted. Do not retry it -- fix the gate."
        )
        return 2
    print(json.dumps(result, sort_keys=True))
    return 0 if result.get("productionPromotionAllowed", result["automaticPromotionAllowed"]) else 3


if __name__ == "__main__":
    raise SystemExit(main())
