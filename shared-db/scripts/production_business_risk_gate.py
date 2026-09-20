#!/usr/bin/env python3
"""Derive the production business-risk decision from governed evidence.

This deliberately does not accept caller-written risk booleans or prose.  It
binds immutable review evidence, an exact successful preview apply, required PR
checks, the merged PR, the current main commit, and conservative SQL analysis.
"""

from __future__ import annotations

import argparse
import hashlib
import functools
import json
import re
import subprocess
import sys
try:  # run as scripts/<name>.py or imported as scripts.<name>
    from repository_identity import current_repository
except ImportError:  # pragma: no cover
    from scripts.repository_identity import current_repository
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
from historical_preview_recovery import prove_pr_authored
from preview_instance_binding import verify as verify_preview_instance_binding
from production_owner_decision_evidence import TRANSIENT_GITHUB_ERRORS, verify_artifact as verify_owner_decision

REPOSITORY = current_repository()  # never hard-coded (#2530)
# The production database's identity. It is deliberately a constant and NOT
# configurable: this value exists so the gate can refuse evidence that claims a
# PRODUCTION write was a preview rehearsal. The PREVIEW ref is the opposite --
# preview is rebuilt from time to time, so it is supplied per run and is never
# defaulted. See --preview-project-ref.
PRODUCTION_PROJECT_REF = "qsllyeztdwjgirsysgai"
PREVIEW_APPLY_ARTIFACT = re.compile(r"^preview-migration-apply-([0-9a-f]{40})$")
PREVIEW_HISTORICAL_REBIND_ARTIFACT = re.compile(r"^preview-migration-dry-run-([0-9a-f]{40})$")
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
GOVERNED_ORIGINAL_RECONCILIATION = {
    "version": "20260830013942", "original_version": "20260828113920",
    "issue": 1722, "claim": 1747, "source_pr": 1748,
    "run_id": 33307904277, "run_head": "75a6e35e46a79af7c059836a64a5b621ac79404a",
    "artifact_id": 9731064265,
    "artifact_digest": "sha256:ebbca330da54c8de7e448c74f67b0ce3a4d230ff0528dd077c85285128a81e87",
    "preview_run_id": 33189683651, "preview_run_head": "4f1e2adb4d964f8f431efdaa0055fcdd96e71638",
    "preview_artifact_id": 9693229856,
    "preview_artifact_digest": "sha256:2a466d1a0163a276a937e28f9af5eff710096e62ec9e7ddf7dda38fac41ef49a",
    "project_ref": "mvpkijzfmfcxhnzqogzs",
}

PREVIEW_FAILURE_JOB_CONCLUSIONS = {
    "SQL migration guards": "success",
    "preview": "success",
    "Automatic production qualification and dispatch": "failure",
    "Production apply review (immutable evidence + hard guards)": "skipped",
    "Production apply (automatic evidence gates)": "skipped",
    "production-dry-run": "skipped",
}


def preview_run_has_immutable_apply(run: Any, jobs: Any = None) -> bool:
    """Accept success, or the exact graph where only downstream promotion failed."""
    if not isinstance(run, dict) or run.get("status") != "completed":
        return False
    if run.get("conclusion") == "success":
        return True
    if run.get("conclusion") != "failure" or not isinstance(jobs, dict):
        return False
    rows = jobs.get("jobs")
    if jobs.get("total_count") != 6 or not isinstance(rows, list) or len(rows) != 6:
        return False
    return all(
        sum(
            1 for job in rows
            if isinstance(job, dict) and job.get("name") == name
            and job.get("status") == "completed" and job.get("conclusion") == conclusion
        ) == 1
        for name, conclusion in PREVIEW_FAILURE_JOB_CONCLUSIONS.items()
    )
RISK_TEXT = {
    "permanent_data_rewrite_or_loss": "existing production data may be lost or permanently altered",
    "expected_downtime": "users may be interrupted",
    "material_access_change": "access or permissions materially change",
    "recovery_unproven": "recovery is uncertain",
    "unresolved_material_objection": "the reviewers have an unresolved material disagreement",
}


# Column types whose ADD COLUMN (nullable, no default) is catalog-only. A type
# outside this list may be a domain carrying a DEFAULT or NOT NULL, or a
# serial pseudo-type that implies NOT NULL DEFAULT nextval(), which rewrites or
# scans the table, so it is refused (#2771).
_BUILTIN_COLUMN_TYPE = (
    r"(?:text|citext|uuid|jsonb?|bytea|boolean|bool|date|interval|inet|cidr|macaddr|money|xml|tsvector"
    r"|smallint|integer|int|int2|int4|int8|bigint|real|float4|float8|double precision"
    r"|(?:numeric|decimal)(?: ?\( ?\d+ ?(?:, ?\d+ ?)?\))?"
    r"|(?:varchar|character varying|char|character|bit|bit varying|varbit)(?: ?\( ?\d+ ?\))?"
    r"|(?:timestamp|time)(?: ?\( ?\d ?\))?(?: with(?:out)? time zone)?|timestamptz|timetz)"
    r"(?: ?\[ ?\])*"
)


# The ONLY statements that report no business risk (#2969, PR #2970). The design
# is allowlist-only: every top-level statement must fullmatch one entry, with no
# trailing clause, or the migration reports all three risks. Anything else --
# WITH, EXPLAIN, DO, SELECT, INSERT, SET, BEGIN, GRANT, an unparsed file -- is
# never modelled and never excused. Patterns run on sql_top_level_statements
# output: comments removed, whitespace folded, unquoted text lower-cased, every
# string literal emptied to '' and every dollar-quoted body emptied to $$ $$.
_ALLOW_IDENT = r'(?:"[^"]+"|[a-z_][a-z0-9_]*)'
_ALLOW_QUALIFIED = rf"{_ALLOW_IDENT}\.{_ALLOW_IDENT}"  # schema-qualified only
_ALLOW_ARGS = r"\((?![^)]*\bdefault\b)(?:[a-z0-9_ ,\[\]]*)\)"  # argument types only: no DEFAULT
_ALLOW_ROUTINE_OPTION = r"(?:language (?:sql|plpgsql)|immutable|stable|volatile|strict|security invoker)"
ALLOWLIST = {
    # Defines a routine; its body is not executed by CREATE. Only SQL and
    # PL/pgSQL, only a quoted body, no SECURITY DEFINER, SET, or argument default.
    "create_function": re.compile(
        rf"create (?:or replace )?function {_ALLOW_QUALIFIED} ?{_ALLOW_ARGS} "
        rf"returns (?:setof )?(?:trigger|{_BUILTIN_COLUMN_TYPE}|void) "
        rf"(?:{_ALLOW_ROUTINE_OPTION} )*as (?:\$\$ \$\$|'')(?: {_ALLOW_ROUTINE_OPTION})*"),
    # Without CASCADE, Postgres refuses the drop while anything depends on it.
    "drop_function_if_exists": re.compile(
        rf"drop function if exists {_ALLOW_QUALIFIED} ?{_ALLOW_ARGS}"
        rf"(?: ?, ?{_ALLOW_QUALIFIED} ?{_ALLOW_ARGS})*"),
    # One nullable column of a built-in type, no default, constraint, reference,
    # collation, or generated/identity clause: a catalog-only change.
    "add_nullable_column": re.compile(
        rf"alter table (?:only )?{_ALLOW_QUALIFIED} add column (?:if not exists )?"
        rf"{_ALLOW_IDENT} {_BUILTIN_COLUMN_TYPE}(?: null)?"),
    # A brand-new table: no IF NOT EXISTS, AS SELECT/EXECUTE/VALUES, LIKE, OF,
    # INHERITS, PARTITION, WITH, TABLESPACE, or REFERENCES (a foreign key locks
    # the referenced existing table).
    "create_table": re.compile(
        rf"create table ({_ALLOW_QUALIFIED}) ?\("
        r"(?!.*\b(?:references|like|of|inherits|partition|with|tablespace|using|select|execute|values)\b)"
        r"[^;]*\)"),
    # An index on a table created by an EARLIER statement of this migration.
    "create_index_on_new_table": re.compile(
        rf"create (?:unique )?index (?:(?!concurrently )(?!if )(?!on ){_ALLOW_IDENT} )?on ({_ALLOW_QUALIFIED}) ?(?:using [a-z]+ ?)?\([^;]*\)"),
    "comment_on": re.compile(r"comment on [a-z ]+ [^;]+ is (?:''|null)"),
}


class RiskGateError(ValueError):
    """Governed evidence is missing, inconsistent, forged, or stale."""


class PreviewProducerMismatch(RiskGateError):
    """Two readable, proved commits carry different preview-producer bytes."""


RATE_LIMIT_WAIT_CAP_SECONDS = 15 * 60


def rate_limit_exhausted(error: str) -> bool:
    """A PRIMARY quota exhaustion: "rate limit exceeded" with HTTP 403 or 429.

    A secondary (abuse) limit, "Resource not accessible", or any other 403 is not
    this, and is never waited on.
    """
    lowered = error.lower()
    return "rate limit exceeded" in lowered and "secondary rate limit" not in lowered and bool(
        re.search(r"http (?:403|429)\b", lowered)
    )


def rate_limit_reset_seconds(runner, now: float) -> float | None:
    """Seconds until the REST quota resets, from the free `rate_limit` endpoint.

    None when the answer cannot be read: an unknown reset is never guessed.
    """
    probe = runner(
        ["gh", "api", "rate_limit"], text=True,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, encoding="utf-8",
    )
    if probe.returncode != 0:
        return None
    try:
        core = json.loads(probe.stdout)["resources"]["core"]
        remaining, reset = core["remaining"], core["reset"]
    except (json.JSONDecodeError, KeyError, TypeError):
        return None
    if not isinstance(remaining, int) or not isinstance(reset, (int, float)):
        return None
    return 0.0 if remaining > 0 else max(0.0, reset - now)


def gh_json(
    endpoint: str, *, runner=subprocess.run, sleep=time.sleep, attempts=4,
    rate_limit_wait_seconds: float = 0, clock=time.time,
) -> Any:
    # RATE LIMIT (bounded, opt-in). With `rate_limit_wait_seconds` > 0 a primary
    # quota exhaustion ("rate limit exceeded", HTTP 403/429) waits ONCE for the
    # stated reset when that reset is within the budget (capped at 15 minutes),
    # then re-reads. A reset further away, an unreadable reset, a second
    # exhaustion, or any other 403 fails closed exactly as before. Only the
    # pre-lane invocation passes a budget; the invocation that already holds the
    # production lane keeps the default 0 and fails fast. The wait never changes
    # what is read or how it is judged.
    budget = max(0.0, min(float(rate_limit_wait_seconds or 0), RATE_LIMIT_WAIT_CAP_SECONDS))
    rate_limit_waited = False
    # The live owner-comment read and the recursive tree read receive transport
    # retries. The tree read carries the producer pin for a whole promotion
    # (issue #2191), so one spurious 500/504 there would stop production for a
    # reason that has nothing to do with the evidence. Retries are granted ONLY
    # for transient transport markers and the read still fails closed once the
    # attempts are spent -- nothing the gate verifies is relaxed. All other
    # governed evidence reads preserve their existing single-attempt behavior.
    retry_transport = "/issues/comments/" in endpoint or "/git/trees/" in endpoint
    effective_attempts = attempts if retry_transport else 1
    attempt = 0
    while True:
        result = runner(
            ["gh", "api", endpoint], text=True,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, encoding="utf-8",
        )
        if result.returncode == 0:
            try: return json.loads(result.stdout)
            except json.JSONDecodeError as exc: raise RiskGateError("GitHub returned invalid JSON") from exc
        error = (result.stderr or "GitHub API request failed").strip()
        if budget > 0 and not rate_limit_waited and rate_limit_exhausted(error):
            delay = rate_limit_reset_seconds(runner, clock())
            if delay is not None and delay <= budget:
                rate_limit_waited = True
                print(f"GitHub API quota exhausted; waiting {int(delay) + 1}s for its reset, then re-reading once.", file=sys.stderr)
                sleep(delay + 1)
                continue  # the wait does not spend a transport attempt
        transient = any(marker in error.lower() for marker in TRANSIENT_GITHUB_ERRORS)
        if not transient or attempt >= effective_attempts - 1:
            raise RiskGateError(f"GitHub API request failed: {error}")
        sleep(2 ** attempt)
        attempt += 1


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


def preview_applied_commit(
    payload: Any, run_id: int, *, allow_historical_rebind: bool = False,
) -> tuple[dict[str, Any], str]:
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
    patterns = (PREVIEW_APPLY_ARTIFACT, PREVIEW_HISTORICAL_REBIND_ARTIFACT) if allow_historical_rebind else (PREVIEW_APPLY_ARTIFACT,)
    matches = [(a, next((match for pattern in patterns if (match := pattern.match(str(a.get("name", ""))))), None)) for a in artifacts if isinstance(a, dict)]
    matches = [(a, m) for a, m in matches if m]
    if len(matches) != 1:
        expected_name = (
            "governed preview apply or historical-rebind"
            if allow_historical_rebind else "preview-migration-apply-<commit>"
        )
        raise RiskGateError(
            f"expected exactly one {expected_name} artifact on run {run_id}, found {len(matches)}"
        )
    artifact, match = matches[0]
    workflow_run = artifact.get("workflow_run")
    if (
        artifact.get("expired") is not False
        or not isinstance(workflow_run, dict)
        or workflow_run.get("id") != run_id
    ):
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
    # Local import of the guard, and the only thing that reads a migration's
    # `-- derived-from:` declaration (issue #1608). An unpinned copy could
    # declare every base satisfied and the guard would believe it, which is the
    # same one-level-down door the .mjs entries below were pinned to close.
    "scripts/migration_derivation.py",
    "scripts/atomic_migration_apply.py",
    # Runs FIRST in the preview job, to acquire the lane, before any evidence
    # byte exists. Unpinned, it was a complete forgery path.
    "scripts/manage-migration-author-lanes.mjs",
    # Decides whether the dispatched main tip is still current (#2047). It runs
    # before any evidence byte is written, and its answer is what permits the
    # rehearsal to proceed at all. Unpinned, a doctored copy could accept ANY
    # tip -- which is the whole gate.
    "scripts/check-main-tip-freshness.mjs",
    # Static import of both the manager and the freshness check (#2758). It
    # decides tip acceptance and whether two heads carry the same pull request
    # diff, so an unpinned copy could wave any tip or any refresh through.
    "scripts/lib/pr-content-equivalence.mjs",
    # Repository identity helpers (#2530). Imported by the manager and by the
    # preview-job Python entry points; they decide which repository every API
    # call reads, so an unpinned copy could point evidence reads elsewhere.
    "scripts/lib/repository-identity.mjs",
    "scripts/repository_identity.py",
    # Invoked by the manager before preview preparation to prove the live sole
    # orchestrator identity. Its result gates whether preparation may proceed.
    "scripts/check-orchestrator-marker.mjs",
    # Imported by the manager for append-only capacity and issue-flow events.
    # A different event vocabulary could forge or suppress the coordination
    # evidence that preview-stage authorization consumes.
    "scripts/db-coordination-events.mjs",
    # Local import of the above. Pinning an entry point without its imports
    # leaves the same door open one level down.
    "scripts/check-dispatch-collision.mjs",
    # Static import of check-dispatch-collision.mjs. Its module body evaluates
    # before the entry point runs, so hop three is as executable as hop one.
    "scripts/check-pr-object-collisions.mjs",
    # Static import of check-pr-object-collisions.mjs: supplies the open pull
    # request file lists that check judges, so it is as executable as its importer.
    "scripts/lib/open-pr-files.mjs",
    # Executes in preview-recovery mode. Safe today only because that path
    # separately demands run head == exact main; pinned so that coupling cannot
    # silently loosen later.
    "scripts/historical_preview_recovery.py",
    # Writes the instance binding INTO the evidence artifact. If this file could
    # differ from exact main, the applied commit and the preview project ref in
    # the evidence would be whatever a doctored checkout chose to write.
    "scripts/preview_instance_binding.py",
    # Issue #2342. The preview job's `gh api` evidence reads now go through this
    # thin CLI, and it and the transport beneath it decide what may be retried,
    # what may never be replayed, and when a read fails closed. A doctored copy
    # could turn a failed evidence read into a silent empty success, so both are
    # pinned exactly like the entry points above.
    "scripts/gh-read.mjs",
    "scripts/lib/github-transport.mjs",
    # Imported by the pinned collision and lane tools. It is the only permitted
    # reader of file CONTENT at a ref, so an unpinned copy could hand a gate
    # different SQL than the commit actually holds -- the same one-level-down
    # door the .mjs entries above were pinned to close.
    "scripts/lib/github-tree.mjs",
    # Data, not code, but it routes which apply mechanism the rehearsal
    # exercises. Pinned for rehearsal fidelity.
    "config/atomic-migration-allowlist.json",
    # Phase 2 review identity and invalidation policy. These are read-only
    # policy inputs, but changing either changes whether prior evidence may be
    # reused, so preview proof must bind their exact bytes.
    "config/orchestrator-evidence-schema-v1.json",
    "config/orchestrator-global-invalidators-v1.json",
    # Issue #2728. Read from main by the pinned pr-content-equivalence.mjs to
    # decide which stored script-hash re-pins may carry an approval forward, so
    # its bytes change whether a prior review is reused for preview.
    "config/review-carry-forward-stored-hashes-v1.json",
    # Governed preview-ledger reconciliation reads this reviewed manifest to
    # select the exact issue/claim/source/orphan/replacement tuple. Bind those
    # bytes to the same exact-main producer proof as the workflow and tool.
    "config/preview-ledger-orphan-reconciliations.json",
    # Loaded by the outcome lifecycle imported by the lane manager. Bind the
    # exact incident authorization to the same producer identity as its reader.
    "config/outcome-timestamp-recovery.json",
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
    "supabase/.temp": (
        "Created locally by the Supabase CLI and excluded by the repository's "
        "gitignore rules. These machine-specific link and tool-version files "
        "cannot be reviewed or pinned to a repository commit, and the governed "
        "workflow establishes and proves its project link independently before "
        "any preview write. Treating a developer's local CLI state as repository "
        "source would make the production-risk test depend on which commands had "
        "previously run on that machine without protecting committed evidence."
    ),
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
    "config/db-data-admin-property-source-coverage.json": (
        "Never read by the preview job. Its only reader is "
        "scripts/check-db-data-admin-property-source-coverage.mjs, run by the "
        "validate job of shared-supabase-migrations.yml, which is a pull-request "
        "check, not the preview rehearsal. No migration, apply helper, catalog "
        "verifier or sidecar reads it, so its bytes cannot shape preview "
        "evidence. It was pinned by #2579; that pin refused #2870's production "
        "promotion (run 35176603519) and #2866's (run 35178225764) only "
        "because unrelated PR #3110 edited the "
        "manifest after the preview ran. If a preview-job tool ever reads it, the "
        "phrase check on this reason fails and it must be pinned again."
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


def blob_sha_from_tree(path: str, ref: str, entries: dict[str, dict[str, Any]]) -> str:
    """Resolve a producer file's blob SHA from the ALREADY-READ tree of `ref`.

    ONE ATOMIC READ, NOT FORTY RACING ONES. This used to issue a Contents API
    call per producer file -- roughly forty rapid sequential requests per
    comparison -- and `gh_json` grants transport retries only to the live
    owner-comment read, so each of those got exactly one attempt. A single
    spurious 500/504/404 anywhere in that sequence failed the whole promotion,
    naming a DIFFERENT file each run (issue #2191: runs 33920952504,
    33921168245 and 33921406952 each rejected a different, genuinely present
    sidecar at f462a411). The recursive tree of the same ref is already read by
    `tracked_paths_at` for the membership proof, and every entry in it carries
    that blob's SHA -- the identical bytes the Contents API reports. Resolving
    from it is STRICTLY STRONGER: same ref, same data, one read, and both the
    membership fact and the content fact now come from a single consistent
    snapshot rather than forty independently-racing ones.

    NOTHING IS RELAXED. A path with no tree entry, an entry that is not a blob
    (a directory can never be a producer file), or an entry carrying no SHA
    string still refuses by name -- the same conditions the per-file Contents
    read refused on, plus the blob-type check it could not make. The caller has already proved the path is
    present in this tree, so reaching any of these means the listing contradicts
    itself and the gate must fail closed.
    """
    entry = entries.get(path)
    if not isinstance(entry, dict):
        raise RiskGateError(f"preview producer file {path} is unreadable at {ref}")
    if entry.get("type") != "blob":
        raise RiskGateError(
            f"preview producer file {path} is not a file at {ref}"
        )
    sha = entry.get("sha")
    if not isinstance(sha, str) or not sha:
        raise RiskGateError(f"preview producer file {path} is unreadable at {ref}")
    return sha


def tracked_tree_at(ref: str, api: Callable[[str], Any]) -> dict[str, dict[str, Any]]:
    """Every entry a commit's tree contains, keyed by path, as a POSITIVE fact.

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
    return {
        entry["path"]: entry for entry in tree["tree"]
        if isinstance(entry, dict) and isinstance(entry.get("path"), str)
    }


def tracked_paths_at(ref: str, api: Callable[[str], Any]) -> frozenset:
    """Every file path a commit's tree contains. See `tracked_tree_at`."""
    return frozenset(tracked_tree_at(ref, api))


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


SIDECAR_PATH = re.compile(r"^scripts/production-verification-sidecars/(\d{14})\.json$")
# Each part is a quoted identifier (any characters, "" escaping a quote) or a
# bare one. Quoted names are case-folded with the rest of the text, which can
# only merge two names into one overlap, never hide one.
_IDENT = r'(?:"((?:[^"]|"")+)"|([a-z_][a-z0-9_$]*))'
_QUALIFIED_OBJECT = re.compile(_IDENT + r'\s*\.\s*' + _IDENT)
_SYSTEM_SCHEMAS = {"pg_catalog", "information_schema"}


def migration_objects(sql: str) -> set[str]:
    """Schema-qualified names a migration mentions, comments removed.

    Deliberately over-inclusive: any shared name counts as an overlap, so the
    only error it can make is a refusal, never a pass.
    """
    text = re.sub(r"/\*.*?\*/", " ", sql, flags=re.S)
    text = re.sub(r"--[^\n]*", " ", text).lower()
    names = set()
    for quoted_schema, bare_schema, quoted_name, bare_name in _QUALIFIED_OBJECT.findall(text):
        schema = quoted_schema.replace('""', '"') if quoted_schema else bare_schema
        name = quoted_name.replace('""', '"') if quoted_name else bare_name
        if schema not in _SYSTEM_SCHEMAS:
            names.add(f"{schema}.{name}")
    return names


def independent_sidecar_paths(
    promoted_versions: list[str] | None, repo_root: Path | None
) -> frozenset:
    """Sidecars of OTHER versions whose migrations share no object with this promotion.

    Such a sidecar may be added or changed on main after the preview ran without
    making the preview proof stale (#2758). A sidecar of a promoted version, one
    whose migration cannot be read exactly once, or one whose migration names
    any object a promoted migration names, is not independent and stays pinned
    byte for byte. With no promotion context nothing is independent.
    """
    if not promoted_versions or repo_root is None:
        return frozenset()
    promoted = set(promoted_versions)
    promoted_objects: set[str] = set()
    for version in promoted:
        matches = list(repo_root.glob(f"supabase/migrations/{version}_*.sql"))
        if len(matches) != 1:
            return frozenset()
        promoted_objects |= migration_objects(matches[0].read_text(encoding="utf-8"))
    if not promoted_objects:
        return frozenset()
    independent = set()
    for path in PREVIEW_PRODUCER_PATHS:
        match = SIDECAR_PATH.fullmatch(path)
        if not match or match.group(1) in promoted:
            continue
        matches = list(repo_root.glob(f"supabase/migrations/{match.group(1)}_*.sql"))
        if len(matches) != 1:
            continue
        if migration_objects(matches[0].read_text(encoding="utf-8")) & promoted_objects:
            continue
        independent.add(path)
    return frozenset(independent)


# CUSTODY-ONLY PRODUCERS (#3168). These files run in the preview job BEFORE or
# AROUND the apply -- lane acquisition, tip freshness, orchestrator identity,
# collision and capacity bookkeeping, evidence-reuse policy -- but none of them
# executes, derives or writes the migration SQL, the ledgers, the content
# manifest or the instance binding. They are pinned so a FORGED ref cannot run a
# doctored copy. A preview dispatched at a commit that exact main CONTAINS ran
# reviewed main-line copies of them, so a later main commit changing one of them
# does not change what the rehearsal proved. #2870 and #2866 were refused for
# exactly that: both previews ran at main-line 426cca7c, and main later changed
# the freshness check, the lane manager and the repository identity helpers.
# The tolerance applies ONLY to an exact-main target and ONLY after the ref is
# proved an ancestor of exact main. Everything that shapes the apply --
# guard, derivation, atomic apply, instance binding, allowlist, supabase
# config, orphan reconciliations, every sidecar of an overlapping version --
# stays compared byte for byte, and a tolerated path is never counted as a
# comparison, so the zero-comparison refusal still holds.
PREVIEW_CUSTODY_ONLY_PATHS = frozenset((
    "scripts/manage-migration-author-lanes.mjs",
    "scripts/check-main-tip-freshness.mjs",
    "scripts/lib/pr-content-equivalence.mjs",
    "scripts/lib/repository-identity.mjs",
    "scripts/repository_identity.py",
    "scripts/check-orchestrator-marker.mjs",
    "scripts/db-coordination-events.mjs",
    "scripts/check-dispatch-collision.mjs",
    "scripts/check-pr-object-collisions.mjs",
    "scripts/lib/open-pr-files.mjs",
    "config/orchestrator-evidence-schema-v1.json",
    "config/orchestrator-global-invalidators-v1.json",
    "config/review-carry-forward-stored-hashes-v1.json",
))

# Executes in the preview job's historical-recovery mode, so it is NOT
# custody-only. Tolerated only when the two versions are identical after the
# repository identity move (#2530): the resolver import lines and the one REPO
# assignment, spelled as the resolved slug or through the resolver.
HISTORICAL_RECOVERY_PRODUCER = "scripts/historical_preview_recovery.py"
_RECOVERY_IDENTITY_DROPPED_LINES = frozenset((
    "try:  # run as scripts/<name>.py or imported as scripts.<name>",
    "from repository_identity import current_repository",
    "except ImportError:  # pragma: no cover",
    "from scripts.repository_identity import current_repository",
))


def _recovery_identity_normal_form(text: str) -> list[str]:
    lines = []
    for raw in text.splitlines():
        line = raw.strip()
        if line in _RECOVERY_IDENTITY_DROPPED_LINES:
            continue
        if line in {f'REPO = "{REPOSITORY}"', "REPO = current_repository()  # never hard-coded (#2530)"}:
            line = "REPO = <repository>"
        lines.append(line)
    return lines

# The workflow decides which steps exist, so it is NOT custody-only as a whole.
# It is tolerated only when the two versions are identical after these exact,
# custody-only rewrites; any other changed line -- a step, a condition, an
# apply command, an environment value -- still refuses.
_WORKFLOW_CUSTODY_REWRITES = (
    # Same repository, spelled literally (the resolved identity) or through the
    # runner variable.
    (re.compile(r"""['"]?repos/(?:""" + re.escape(REPOSITORY)
                + r"""|\$\{GITHUB_REPOSITORY\})/([^'"\s]*)['"]?"""),
     r"repos/<repository>/\1"),
    # The freshness rule is the freshness script's own business.
    (re.compile(r"(scripts/check-main-tip-freshness\.mjs) --production\b"), r"\1"),
)
_WORKFLOW_CUSTODY_DROPPED_LINES = frozenset((
    # The production job's exact-tip equality, replaced by the freshness rule.
    'test "$(git rev-parse origin/main)" = "$REQUESTED_SHA"',
))


def _workflow_custody_normal_form(text: str) -> list[str]:
    lines = []
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or line in _WORKFLOW_CUSTODY_DROPPED_LINES:
            continue
        for pattern, replacement in _WORKFLOW_CUSTODY_REWRITES:
            line = pattern.sub(replacement, line)
        lines.append(line)
    return lines


def _blob_text(sha: str, api: Callable[[str], Any]) -> str:
    try:
        blob = api(f"repos/{REPOSITORY}/git/blobs/{sha}")
    except Exception as exc:  # noqa: BLE001 - unreadable content must fail closed
        raise RiskGateError(f"preview producer blob {sha} is unreadable") from exc
    if not isinstance(blob, dict) or blob.get("encoding") != "base64" \
            or not isinstance(blob.get("content"), str):
        raise RiskGateError(f"preview producer blob {sha} is unreadable")
    import base64
    try:
        return base64.b64decode(blob["content"]).decode("utf-8")
    except Exception as exc:  # noqa: BLE001
        raise RiskGateError(f"preview producer blob {sha} is unreadable") from exc


def _custody_only_difference(
    path: str, ref_blob: str, target_blob: str, api: Callable[[str], Any]
) -> bool:
    if path in PREVIEW_CUSTODY_ONLY_PATHS:
        return True
    if path == PREVIEW_WORKFLOW:
        return _workflow_custody_normal_form(_blob_text(ref_blob, api)) \
            == _workflow_custody_normal_form(_blob_text(target_blob, api))
    if path == HISTORICAL_RECOVERY_PRODUCER:
        return _recovery_identity_normal_form(_blob_text(ref_blob, api)) \
            == _recovery_identity_normal_form(_blob_text(target_blob, api))
    return False


def prove_preview_producer_matches_main(
    ref: str, target: ProvedTarget, main_sha: str, api: Callable[[str], Any], *,
    what: str = "preview run", against: str = "exact main",
    promoted_versions: list[str] | None = None, repo_root: Path | None = None,
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
    independent = independent_sidecar_paths(promoted_versions, repo_root)
    entries_at_ref = tracked_tree_at(ref, api)
    entries_at_target = tracked_tree_at(target.sha, api)
    present_at_ref, present_at_target = entries_at_ref.keys(), entries_at_target.keys()
    compared = 0
    main_line_proved = False
    for path in PREVIEW_PRODUCER_PATHS:
        at_ref, at_target = path in present_at_ref, path in present_at_target
        if not at_ref and not at_target:
            continue
        if path in independent and (
            at_ref != at_target
            or blob_sha_from_tree(path, ref, entries_at_ref)
            != blob_sha_from_tree(path, target.sha, entries_at_target)
        ):
            # A LATER MAIN COMMIT ADDED OR CHANGED ANOTHER VERSION'S SIDECAR
            # (#2758). #2703 was refused twice because #2748 merged its own
            # sidecar between the preview and the promotion. That sidecar
            # verifies a different migration touching different objects, so the
            # preview proof is still valid. Not counted as a comparison.
            continue
        if at_ref != at_target:
            mismatch = PreviewProducerMismatch(
                f"{what} produced evidence with {path} "
                f"{'present' if at_ref else 'absent'} where {against} has it "
                f"{'present' if at_target else 'absent'}"
            )
            # A custody-only helper added or removed on main after a main-line
            # preview (#3168: repository identity helpers arrived after 426cca7c).
            if target.kind != "exact-main" or path not in PREVIEW_CUSTODY_ONLY_PATHS:
                raise mismatch
            if not main_line_proved:
                try:
                    prove_applied_commit_is_main_line(ref, main_sha, api)
                except RiskGateError as exc:
                    raise mismatch from exc
                main_line_proved = True
            continue
        ref_blob = blob_sha_from_tree(path, ref, entries_at_ref)
        target_blob = blob_sha_from_tree(path, target.sha, entries_at_target)
        if ref_blob != target_blob:
            mismatch = PreviewProducerMismatch(
                f"{what} produced evidence with a different {path} than {against}"
            )
            if target.kind != "exact-main" or (
                path not in PREVIEW_CUSTODY_ONLY_PATHS
                and path not in {PREVIEW_WORKFLOW, HISTORICAL_RECOVERY_PRODUCER}
            ):
                raise mismatch
            # Custody-only drift is tolerated only for a main-line ref (#3168).
            if not main_line_proved:
                try:
                    prove_applied_commit_is_main_line(ref, main_sha, api)
                except RiskGateError as exc:
                    raise mismatch from exc
                main_line_proved = True
            try:
                tolerated = _custody_only_difference(path, ref_blob, target_blob, api)
            except RiskGateError as exc:
                raise mismatch from exc
            if not tolerated:
                raise mismatch
            continue
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


def prove_governed_original_reconciliation(
    *, version: str, source_pr: int, run_id: int, run: dict[str, Any],
    repo_root: Path, main_sha: str, api: Callable[[str], Any], downloader: Callable[[int, Path], None],
) -> bool:
    """Accept only the exact #1722 statement-identical governed ledger rename."""
    case = GOVERNED_ORIGINAL_RECONCILIATION
    if (version, source_pr, run_id) != (case["version"], case["source_pr"], case["run_id"]):
        return False
    expected_run = {"status": "completed", "conclusion": "success", "event": "workflow_dispatch", "path": ".github/workflows/preview-ledger-orphan-reconciliation.yml", "head_sha": case["run_head"], "run_attempt": 1}
    if any(run.get(key) != value for key, value in expected_run.items()):
        raise RiskGateError("governed original reconciliation run identity changed")
    prove_applied_commit_is_main_line(case["run_head"], main_sha, api)
    artifacts = api_object(api, f"repos/{REPOSITORY}/actions/runs/{run_id}/artifacts?per_page=100").get("artifacts")
    if not isinstance(artifacts, list) or len(artifacts) != 1 or not isinstance(artifacts[0], dict):
        raise RiskGateError("governed original reconciliation artifact is ambiguous")
    artifact = artifacts[0]
    if (artifact.get("id") != case["artifact_id"] or artifact.get("digest") != case["artifact_digest"] or artifact.get("expired") is not False or artifact.get("name") != f"preview-ledger-orphan-reconciliation-{case['original_version']}" or artifact.get("workflow_run", {}).get("id") != run_id or artifact.get("workflow_run", {}).get("head_sha") != case["run_head"]):
        raise RiskGateError("governed original reconciliation artifact identity changed")
    with tempfile.TemporaryDirectory(prefix="production-risk-original-reconciliation-") as temp:
        archive_path = Path(temp, "reconciliation.zip")
        downloader(artifact["id"], archive_path)
        if "sha256:" + hashlib.sha256(archive_path.read_bytes()).hexdigest() != case["artifact_digest"]:
            raise RiskGateError("governed original reconciliation download digest changed")
        try:
            with zipfile.ZipFile(archive_path) as archive:
                names = {Path(name).name: name for name in archive.namelist() if not name.endswith("/")}
                if set(names) != {"reconciliation-check.json", "reconciliation-apply.json"}:
                    raise RiskGateError("governed original reconciliation evidence set changed")
                check = json.loads(archive.read(names["reconciliation-check.json"]))
                applied = json.loads(archive.read(names["reconciliation-apply.json"]))
        except (zipfile.BadZipFile, json.JSONDecodeError, UnicodeDecodeError) as exc:
            raise RiskGateError("governed original reconciliation evidence is unreadable") from exc
    fixed = {"schema": "shared-db-preview-ledger-orphan-reconciliation/v1", "issue": case["issue"], "claim": case["claim"], "source_pr": source_pr, "orphan_version": case["original_version"], "replacement_version": version, "preview_run_id": case["preview_run_id"], "preview_artifact_id": case["preview_artifact_id"], "preview_artifact_digest": case["preview_artifact_digest"], "project_ref": case["project_ref"], "main_sha": case["run_head"]}
    for record, mode in ((check, "check"), (applied, "apply")):
        if not isinstance(record, dict) or record.get("mode") != mode or any(record.get(k) != v for k, v in fixed.items()):
            raise RiskGateError("governed original reconciliation tuple changed")
    before, after, governance = applied.get("before"), applied.get("after"), applied.get("governance")
    current = list(repo_root.glob(f"supabase/migrations/{version}_*.sql"))
    if (not isinstance(before, list) or not isinstance(after, list) or len(before) != 1 or len(after) != 1 or before[0].get("version") != case["original_version"] or after[0].get("version") != version or before[0].get("name") != after[0].get("name") or before[0].get("statements") != after[0].get("statements") or check.get("before") != check.get("after") or not isinstance(governance, dict) or governance.get("case_mode") != "byte_identical_rename" or governance.get("orphan_sha256") != governance.get("replacement_sha256") or len(current) != 1 or canonical_sha256(current[0]) != governance.get("replacement_sha256")):
        raise RiskGateError("governed original reconciliation did not prove the exact statement-identical rename")
    original_run = api_object(api, f"repos/{REPOSITORY}/actions/runs/{case['preview_run_id']}")
    if any(original_run.get(k) != v for k, v in {"status": "completed", "conclusion": "success", "event": "workflow_dispatch", "path": PREVIEW_WORKFLOW, "head_sha": case["preview_run_head"], "run_attempt": 1}.items()):
        raise RiskGateError("governed reconciliation source preview run identity changed")
    source_artifacts = api_object(api, f"repos/{REPOSITORY}/actions/runs/{case['preview_run_id']}/artifacts?per_page=100").get("artifacts")
    if not isinstance(source_artifacts, list) or len(source_artifacts) != 1:
        raise RiskGateError("governed reconciliation source preview artifact is ambiguous")
    source_artifact = source_artifacts[0]
    if (source_artifact.get("id") != case["preview_artifact_id"] or source_artifact.get("digest") != case["preview_artifact_digest"] or source_artifact.get("expired") is not False or source_artifact.get("name") != f"preview-migration-apply-{case['preview_run_head']}" or source_artifact.get("workflow_run", {}).get("id") != case["preview_run_id"] or source_artifact.get("workflow_run", {}).get("head_sha") != case["preview_run_head"]):
        raise RiskGateError("governed reconciliation source preview artifact identity changed")
    return True


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


def prove_bound_mainline_post_merge_original(
    *, texts: dict[str, str], run: dict, run_id: int, run_head: str,
    original_commit: str, run_versions: list[str], source_pr: int,
    merge_sha: str, main_sha: str, api: Callable[[str], Any], producer_error: Exception,
) -> None:
    """Permit producer drift only for a fully bound post-merge run on main.

    A post-merge rehearsal can legitimately run after unrelated commits changed
    preview-producer files. Pinning it to the authoring PR's earlier squash commit
    makes that governed order impossible. The narrow fallback below keeps the
    producer mismatch as the default refusal and accepts it only when the run's
    immutable instance binding names the exact source PR, merge commit, run,
    applied commit and complete per-run allowlist, both execution commits are the
    same main-line commit, and the source merge is its ancestor.
    """
    # ONE BINDING PER AUTHORING PULL REQUEST (#2140). A batch rehearsed from a
    # merged_preview_source_pr_map files `preview-instance.json` under the map's
    # LAST pull request only, while this proof compares the binding against the
    # pull request that authored THIS version. Those disagree for every version
    # in the batch except the last, so per-version historical recovery could
    # never pass. The rehearsal now also writes `preview-instance-<pr>.json` for
    # every proven pull request in the map. Prefer this version's own file; the
    # comparison below is unchanged and still strict, so a file naming the wrong
    # pull request, run, commit or allowlist is refused exactly as before.
    raw = preview_instance_text(texts, source_pr)
    try:
        binding = json.loads(raw) if raw else None
    except (json.JSONDecodeError, TypeError) as exc:
        raise producer_error from exc
    expected = {
        "schema": "shared-db-preview-instance-binding/v1",
        "rehearsalMode": "merged-main-rehearsal",
        "appliedCommit": original_commit,
        "runId": run_id,
        "allowlist": sorted(run_versions),
        "sourcePr": source_pr,
        "mergeCommitSha": merge_sha,
    }
    if (
        not isinstance(binding, dict)
        or any(binding.get(key) != value for key, value in expected.items())
        or not re.fullmatch(r"[a-z]{20}", str(binding.get("previewProjectRef") or ""))
        or binding.get("previewProjectRef") == PRODUCTION_PROJECT_REF
        or type(run.get("run_attempt")) is not int
        or run.get("run_attempt") != 1
        or run_head != original_commit
    ):
        raise producer_error
    # Source-PR membership is not main-line membership: a branch can merge main
    # into itself and thereby descend from the source merge without ever being
    # merged back. Re-derive containment unconditionally for this exception.
    prove_applied_commit_is_main_line(run_head, main_sha, api)
    ancestry = api_object(api, f"repos/{REPOSITORY}/compare/{merge_sha}...{run_head}")
    if ancestry.get("status") not in {"ahead", "identical"} or ancestry.get("behind_by") != 0:
        raise producer_error


def preview_instance_text(texts: dict, source_pr) -> str | None:
    """The binding this pull request filed, else the shared last-PR file.

    ONE BINDING PER AUTHORING PULL REQUEST (#2140). A batch rehearsed from a
    `merged_preview_source_pr_map` used to file `preview-instance.json` under the
    map's LAST pull request only, so every earlier pull request in the batch had
    no recoverable binding of its own. The rehearsal now also writes
    `preview-instance-<pr>.json` for every proven pull request.

    Every reader must resolve the binding the SAME way, or a promotion of a
    non-last pull request reads the stale shared file at one gate and its own
    file at another. That is why this is one function and not three call sites.
    The shared file remains the fallback so an old artifact, written before the
    per-pull-request files existed, still recovers. Nothing here relaxes a check:
    the caller still verifies the body names the right pull request, run, commit
    and allowlist, so a file naming the wrong one is refused exactly as before.
    """
    if isinstance(source_pr, int) and not isinstance(source_pr, bool):
        own = texts.get(f"preview-instance-{source_pr}.json")
        if own:
            return own
    return texts.get("preview-instance.json")


def prove_registered_historical_restoration_provenance(
    *, version: str, run_id: int, run_head: str, original_commit: str, source_pr: int,
    merge_sha: str, texts: dict[str, str], repo_root: Path,
    runner: Callable[..., Any] = subprocess.run,
) -> None:
    """Accept producer drift only for one exact, byte-pinned restoration record.

    The JavaScript registry remains the single authority used by the migration
    guards.  This adapter asks it to validate the current migration bytes and
    binds that answer to the original artifact digest, run, commit, source PR,
    and source merge.  Any absent or mismatched field refuses here, leaving the
    caller's ordinary producer-mismatch path unchanged.
    """
    matches = list(repo_root.glob(f"supabase/migrations/{version}_*.sql"))
    if len(matches) != 1:
        raise RiskGateError(
            f"registered historical restoration {version} is absent or ambiguous on exact main"
        )
    recorded = preview_content_manifest(texts).get(version)
    evidence = {
        "version": version,
        "previewApplyRun": str(run_id),
        "previewDispatchCommit": run_head,
        "previewAppliedCommit": original_commit,
        "sourcePr": source_pr,
        "sourceMergeCommit": merge_sha,
        "artifactFileSha256": recorded,
    }
    relative = matches[0].relative_to(repo_root).as_posix()
    try:
        result = runner(
            [
                "node", "scripts/historical-migration-restorations.mjs",
                "--production-provenance", relative,
                json.dumps(evidence, separators=(",", ":"), sort_keys=True),
            ],
            cwd=repo_root, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            encoding="utf-8",
        )
    except OSError as exc:
        raise RiskGateError("historical restoration registry could not be executed") from exc
    if result.returncode != 0:
        detail = (result.stderr or "historical restoration registry refused the evidence").strip()
        raise RiskGateError(detail)
    try:
        answer = json.loads(result.stdout)
    except (json.JSONDecodeError, TypeError) as exc:
        raise RiskGateError("historical restoration registry returned unreadable evidence") from exc
    if answer != {"version": version, "fileSha256": recorded}:
        raise RiskGateError("historical restoration registry returned mismatched evidence")


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
    # DEFENCE IN DEPTH, AND UNREACHABLE END TO END. This guard and the two below it (the run-id shape and
    # the source-pull-request shape) restate rules `parse_original_run_map` and
    # `parse_source_map` in scripts/historical_preview_recovery.py already
    # enforce, and re-derivation runs those parsers BEFORE this function is
    # called. So a record that would trip any of the three is refused earlier,
    # with a different message, and no test can drive these lines through
    # `prove_preview`.
    #
    # They stay, because this function is also importable and callable on its
    # own and must not assume its caller validated anything. Because they cannot
    # be reached through `prove_preview`, they are driven by calling this function
    # directly in `DirectRecordShapeGuardTests` in
    # scripts/test_production_business_risk_gate_historical_original_runs_mutations.py
    # (#2367), which goes red if any of them is removed. The rules are also tested,
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
        if isinstance(run, dict) and prove_governed_original_reconciliation(
            version=version, source_pr=source_pr, run_id=run_id, run=run,
            repo_root=repo_root, main_sha=main_sha, api=api, downloader=downloader,
        ):
            continue
        jobs = None
        if isinstance(run, dict) and run.get("conclusion") == "failure":
            try:
                jobs = api(f"repos/{REPOSITORY}/actions/runs/{run_id}/jobs?per_page=100")
            except Exception as exc:  # noqa: BLE001 - unreadable job proof fails closed
                raise RiskGateError(f"original apply run {run_id} jobs are unreadable") from exc
        expected = {"status": "completed", "event": "workflow_dispatch", "path": PREVIEW_WORKFLOW}
        for key, value in expected.items():
            if not isinstance(run, dict) or run.get(key) != value:
                raise RiskGateError(f"original apply run {run_id} for {version} has wrong {key}")
        if not preview_run_has_immutable_apply(run, jobs):
            raise RiskGateError(f"original apply run {run_id} for {version} has wrong conclusion")
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
        texts = None
        for commit, role in ((run_head, "dispatched at"), (original_commit, "checked out at")):
            try:
                prove_preview_producer_matches_main(
                    commit, authored_merge(merge_sha), main_sha, api,
                    what=f"original apply run {run_id} {role} {commit}",
                    against=f"the merge commit {merge_sha} of the pull request that authored {version}",
                )
            except PreviewProducerMismatch as producer_error:
                texts = texts or artifact_texts(artifact, downloader)
                try:
                    prove_registered_historical_restoration_provenance(
                        version=version, run_id=run_id, run_head=run_head,
                        original_commit=original_commit,
                        source_pr=source_pr, merge_sha=merge_sha, texts=texts,
                        repo_root=repo_root,
                    )
                except RiskGateError:
                    prove_bound_mainline_post_merge_original(
                        texts=texts, run=run, run_id=run_id, run_head=run_head,
                        original_commit=original_commit,
                        run_versions=sorted(v for v in allowlist if runs.get(v) == run_id),
                        source_pr=source_pr, merge_sha=merge_sha, main_sha=main_sha, api=api,
                        producer_error=producer_error,
                    )
        texts = texts or artifact_texts(artifact, downloader)
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
        instance = preview_instance_text(texts, source_pr)
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
    jobs = None
    if isinstance(run, dict) and run.get("conclusion") == "failure":
        try:
            jobs = api(f"repos/{REPOSITORY}/actions/runs/{run_id}/jobs?per_page=100")
        except Exception as exc:  # noqa: BLE001 - unreadable job proof fails closed
            raise RiskGateError("preview run jobs are unreadable") from exc
    expected = {"status": "completed", "event": "workflow_dispatch", "path": PREVIEW_WORKFLOW}
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
    if not preview_run_has_immutable_apply(run, jobs):
        raise RiskGateError("preview run has wrong conclusion")
    # THE COMMIT THAT ACTUALLY RAN, not the ref the workflow file was read from.
    # `run["head_sha"]` is the latter, and on a post-merge rehearsal dispatched
    # against main the two are different commits. Pinning provenance and the
    # producing code to head_sha therefore pinned the wrong thing, and the
    # artifact lookup -- which uses the checked-out commit -- would then fail
    # anyway. Both now use the same commit, read from the artifact name.
    artifact, applied_commit = preview_applied_commit(
        api(f"repos/{REPOSITORY}/actions/runs/{run_id}/artifacts?per_page=100"), run_id,
        allow_historical_rebind=True,
    )
    historical_rebind_artifact = bool(
        PREVIEW_HISTORICAL_REBIND_ARTIFACT.fullmatch(str(artifact.get("name", "")))
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
        promoted_versions=allowlist, repo_root=repo_root,
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
        promoted_versions=allowlist, repo_root=repo_root,
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
    if historical_rebind_artifact and not historical:
        raise RiskGateError(
            "ordinary preview dry-run artifact is insufficient; only a governed historical "
            "preview rebind record can use the dry-run artifact namespace"
        )
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
        preview_instance_text(texts, source_pr),
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


def select_newest_check_runs(checks: list[Any]) -> dict[str, dict[str, Any]]:
    """The newest row per check name, independent of the API's row order (issue #2730).

    One head can carry several same-name check runs -- a cancelled run beside its
    re-run. The dict comprehension this replaces kept whichever row the API
    happened to list last, so an older cancelled run listed after the newer
    successful one was silently selected and refused a healthy promotion (PR
    #2527: run 34563999011 succeeded, 34563998795 was cancelled, the gate chose
    the cancellation). The newest row is the one with the greatest check-run id:
    ids are unique and assigned at creation, so every re-run gets a larger one.
    A name with one row needs no ordering; two or more rows must each carry a
    unique integer id, or the newest cannot be known and the gate refuses rather
    than guess -- which also keeps a NEWER failure or pending run refusing over
    an OLDER success, never the reverse.
    """
    rows_by_name: dict[str, list[dict[str, Any]]] = {}
    for row in checks:
        if not isinstance(row, dict) or not isinstance(row.get("name"), str) or not row["name"]:
            raise RiskGateError(f"check-run row {row!r} is malformed: no check name")
        rows_by_name.setdefault(row["name"], []).append(row)
    newest: dict[str, dict[str, Any]] = {}
    for name, rows in rows_by_name.items():
        if len(rows) == 1:
            newest[name] = rows[0]
            continue
        by_id: dict[int, dict[str, Any]] = {}
        for row in rows:
            check_run_id = row.get("id")
            if type(check_run_id) is not int or isinstance(check_run_id, bool) or check_run_id <= 0:
                raise RiskGateError(
                    f"check '{name}' has {len(rows)} rows but row {row!r} carries no "
                    "positive integer id, so the newest cannot be selected"
                )
            seen = by_id.get(check_run_id)
            if seen is not None and seen.get("conclusion") != row.get("conclusion"):
                raise RiskGateError(
                    f"check '{name}' repeats id {check_run_id} with different conclusions"
                )
            by_id[check_run_id] = row
        newest[name] = by_id[max(by_id)]
    return newest


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
    conclusions = {
        name: row.get("conclusion") for name, row in select_newest_check_runs(checks).items()
    }
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
    status_endpoint = f"repos/{REPOSITORY}/commits/{head}/status"
    statuses = api_sublist(api_object(api, status_endpoint), "statuses", status_endpoint)
    guarded = next(
        (
            row for row in statuses
            if isinstance(row, dict)
            and row.get("context") == "Migration guarded merge authorization"
        ),
        None,
    )
    if not isinstance(guarded, dict) or guarded.get("state") != "success":
        raise RiskGateError(
            "the latest Migration guarded merge authorization is not successful at the exact PR head"
        )
    return head, str(merge_commit_sha)


TRAIN_VERSION_RE = re.compile(r"\d{14}")
TRAIN_DIGEST_RE = re.compile(r"[0-9a-f]{64}")
TRAIN_SHA_RE = re.compile(r"[0-9a-f]{40}")


def load_migration_train_record(path: Path) -> dict[str, Any]:
    """The dispatched train record, as the workflow re-read it from its immutable ref."""
    try:
        record = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise RiskGateError(f"migration train record is unreadable: {exc}") from exc
    if not isinstance(record, dict) or not isinstance(record.get("entries"), list) or not record["entries"]:
        raise RiskGateError("migration train record has no exact entry list")
    return record


def prove_migration_train(
    record: dict[str, Any], *, main_sha: str, allowlist: list[str],
    api: Callable[[str], Any], repo_root: Path,
) -> dict[int, tuple[str, str]]:
    """Issue #3027 Step 6: prove EVERY train entry against its OWN authoring PR.

    Each entry gets the full single-PR proof it would get alone: merged, merge
    commit an ancestor of exact main, required checks green at that PR's exact
    head, the latest guarded-merge authorization successful there, the merge
    commit equal to the one the train recorded, the PR ADDED that exact migration
    file, and the file on exact main hashing to the train's recorded sha256.
    Returns {source_pr: (head, merge_commit)} for the preview and review bindings.
    """
    if record.get("state") != "dispatched":
        raise RiskGateError(f"migration train {record.get('train_id')} is {record.get('state')}, not dispatched")
    if record.get("target") != "production":
        raise RiskGateError(f"migration train targets {record.get('target')}, not production")
    if str(record.get("base_main_sha", "")).lower() != main_sha.lower():
        raise RiskGateError("migration train was built on a different main commit than the promoted exact main")
    entries = record["entries"]
    versions = [str(entry.get("version")) if isinstance(entry, dict) else "" for entry in entries]
    if versions != allowlist:
        raise RiskGateError(
            f"migration train versions {','.join(versions)} are not exactly the allowlist {','.join(allowlist)}"
        )
    proven: dict[int, tuple[str, str]] = {}
    for entry in entries:
        version = entry["version"]
        source_pr, merge_sha, file_sha = entry.get("source_pr"), entry.get("merge_sha"), entry.get("file_sha256")
        if (
            not TRAIN_VERSION_RE.fullmatch(version)
            or type(source_pr) is not int or source_pr < 1
            or not TRAIN_SHA_RE.fullmatch(str(merge_sha))
            or not TRAIN_DIGEST_RE.fullmatch(str(file_sha))
        ):
            raise RiskGateError(f"train entry {version}: missing exact source PR, merge commit or file hash")
        try:
            head, merge_commit = prove_pr_and_checks(source_pr, main_sha, [version], api, repo_root)
        except RiskGateError as exc:
            raise RiskGateError(f"train entry {version}: source PR {source_pr}: {exc}") from exc
        if merge_commit != merge_sha:
            raise RiskGateError(
                f"train entry {version}: source PR {source_pr} merged as {merge_commit}, not the train's {merge_sha}"
            )
        try:
            authored_merge = prove_pr_authored(source_pr, main_sha, [version], repo_root, api)
        except ValueError as exc:
            raise RiskGateError(f"train entry {version}: {exc}") from exc
        if authored_merge != merge_sha:
            raise RiskGateError(f"train entry {version}: source PR {source_pr} authorship names another merge commit")
        matches = list(repo_root.glob(f"supabase/migrations/{version}_*.sql"))
        if len(matches) != 1:
            raise RiskGateError(f"train entry {version}: exact main has {len(matches)} migration files, not 1")
        actual = sha256_file(matches[0])
        if actual != file_sha:
            raise RiskGateError(f"train entry {version}: file hashes to {actual}, not the train's {file_sha}")
        if source_pr in proven and proven[source_pr] != (head, merge_commit):
            raise RiskGateError(f"train entry {version}: source PR {source_pr} changed identity mid-proof")
        proven[source_pr] = (head, merge_commit)
    return proven


def classify_sql(repo_root: Path, allowlist: list[str]) -> list[str]:
    reasons: set[str] = set()
    for version in allowlist:
        matches = list(repo_root.glob(f"supabase/migrations/{version}_*.sql"))
        if len(matches) != 1:
            raise RiskGateError(f"expected one migration for {version}, found {len(matches)}")
        raw = matches[0].read_text(encoding="utf-8")
        reasons.update(_classify_statements(
            sql_top_level_statements(raw), prior=_PriorMigrations(repo_root, version, raw)))
    return sorted(reasons)


# ROUTINE FUNCTION RE-ESTABLISHMENT AND NARROWING REVOKES (#3159). #3104 (PR
# #3131) and #2866 were forced onto the manual route because every CREATE OR
# REPLACE FUNCTION outside the narrow create_function shape, and every GRANT or
# REVOKE, reported all three risks. Two shapes are now recognised, and both stay
# fail-closed on anything that could widen access or lose data:
#
#   1. REVOKE on named functions or tables. Removing a privilege can only
#      narrow access; it never rewrites data or holds a long lock.
#   2. A function RE-ESTABLISHED exactly as the latest earlier migration that
#      touched it left it. Every statement of this migration naming the function
#      must be a CREATE OR REPLACE FUNCTION, COMMENT, GRANT or REVOKE on it, and the whole
#      ordered list must equal, byte for byte after normalisation, the list of
#      statements naming it in the most recent earlier migration. Bodies are
#      emptied by the tokeniser, so the comparison covers the full header
#      (arguments, defaults, return type, SECURITY DEFINER, SET search_path) with
#      every string literal compared exactly, and every grant, but never the body; the body is what the required
#      independent review reads. Because the latest earlier migration is the one
#      compared, any later migration that changed the function's privileges
#      breaks the match, and any schema-wide grant or revoke, default-privilege
#      change, rename or ownership move since then (or now) excuses nothing. A new function, a changed header, a new role, or a
#      different grant order all still report every risk.
_ROLE_LIST = rf"{_ALLOW_IDENT}(?: ?, ?{_ALLOW_IDENT})*"
_FUNCTION_REF = rf"{_ALLOW_QUALIFIED} ?{_ALLOW_ARGS}"
NARROWING_REVOKE = re.compile(
    rf"revoke (?:grant option for )?[a-z ,]+ on (?:function {_FUNCTION_REF}(?: ?, ?{_FUNCTION_REF})*"
    rf"|(?:table )?{_ALLOW_QUALIFIED}(?: ?, ?{_ALLOW_QUALIFIED})*) from {_ROLE_LIST}(?: (?:cascade|restrict))?")
_REPLACE_FUNCTION = re.compile(rf"create or replace function ({_ALLOW_QUALIFIED}) ?\(.*")
_FUNCTION_PRIVILEGE = re.compile(
    rf"(?:grant|revoke) [a-z ,]+ on function ({_ALLOW_QUALIFIED}) ?{_ALLOW_ARGS} (?:to|from) {_ROLE_LIST}")

_FUNCTION_COMMENT = re.compile(rf"comment on function ({_ALLOW_QUALIFIED}) ?{_ALLOW_ARGS} is (?:''|null)")


def _names_object(statement: str, name: str) -> bool:
    return re.search(rf'(?<![a-z0-9_$."]){re.escape(name)}(?![a-z0-9_$"])', statement) is not None


# A statement that can change a function's privileges or identity WITHOUT
# naming it (#3159 review): schema-wide grants/revokes, default privileges,
# renames and ownership moves. Seen between the latest named match and now, the
# earlier state can no longer be trusted, so nothing is excused.
_UNNAMED_FUNCTION_ACL_OR_IDENTITY = re.compile(
    r"\bin schema\b|\balter default privileges\b|\brename to\b|\bowner to\b"
    r"|\bset schema\b|\bon schema\b|\bdrop (?:schema|owned|role)\b")


def _comparison_form(neutral: str, exact: str) -> str:
    """Exact literals everywhere except a COMMENT's text, which grants nothing."""
    return neutral if _FUNCTION_COMMENT.fullmatch(neutral) else exact


class _PriorMigrations:
    """Statements of every migration on this tree older than ``version``, newest first."""

    def __init__(self, repo_root: Path, version: str, current_raw: str | None = None):
        self.current_exact = (None if current_raw is None
                              else sql_top_level_statements(current_raw, keep_literals=True))
        self.files = sorted(
            (path for path in (Path(repo_root) / "supabase/migrations").glob("*.sql")
             if re.fullmatch(r"\d{14}", path.name[:14]) and path.name[:14] < version),
            key=lambda path: path.name, reverse=True)
        self._cache: dict[Path, tuple[list[str], list[str]] | None] = {}

    def latest_touching(self, name: str) -> list[str] | None:
        """The ordered statements naming ``name`` in the newest earlier migration that names it.

        None when no earlier migration names it, or when a newer one cannot be
        parsed (it might name it, so nothing older can be trusted).
        """
        for path in self.files:
            if path not in self._cache:
                text = path.read_text(encoding="utf-8")
                neutral = sql_top_level_statements(text)
                exact = sql_top_level_statements(text, keep_literals=True)
                self._cache[path] = (None if neutral is None or exact is None
                                     or len(neutral) != len(exact) else (neutral, exact))
            parsed = self._cache[path]
            if parsed is None:
                return None
            neutral, exact = parsed
            if any(_UNNAMED_FUNCTION_ACL_OR_IDENTITY.search(s) for s in neutral):
                return None
            touching = [_comparison_form(s, exact[i]) for i, s in enumerate(neutral) if _names_object(s, name)]
            if touching:
                return touching
        return None


def _reestablished_functions(statements: list[str], prior: "_PriorMigrations | None") -> set[int]:
    """Indexes of statements that re-establish a function exactly as before (#3159)."""
    if prior is None or prior.current_exact is None or len(prior.current_exact) != len(statements):
        return set()
    if any(_UNNAMED_FUNCTION_ACL_OR_IDENTITY.search(s) for s in statements):
        return set()
    exact = prior.current_exact
    excused: set[int] = set()
    names = {m.group(1) for s in statements if (m := _REPLACE_FUNCTION.fullmatch(s))}
    for name in names:
        touching = [(i, s) for i, s in enumerate(statements) if _names_object(s, name)]
        if not all(
            (m := _REPLACE_FUNCTION.fullmatch(s) or _FUNCTION_PRIVILEGE.fullmatch(s)
             or _FUNCTION_COMMENT.fullmatch(s)) and m.group(1) == name
            for _, s in touching
        ):
            continue
        if prior.latest_touching(name) == [_comparison_form(s, exact[i]) for i, s in touching]:
            excused.update(i for i, _ in touching)
    return excused


def allowlist_entry(statement: str, new_tables: set[str]) -> str | None:
    """The ALLOWLIST entry this statement fullmatches, or None."""
    for name, pattern in ALLOWLIST.items():
        m = pattern.fullmatch(statement)
        if m and (name != "create_index_on_new_table" or m.group(1) in new_tables):
            return name
    return None


# ADD COLUMN ... CHECK on the column being added (#3119, run 35163423338). The
# new column is NULL in every existing row and a CHECK passes on NULL, so no
# data can be lost and no grant changes. It is NOT catalog-only: Postgres scans
# the whole table under ACCESS EXCLUSIVE to validate the constraint, so this
# shape still reports expected downtime. The CHECK body may only compare the
# added column itself against literal values; anything else is unrecognised.
_NEW_COLUMN_ACTION = re.compile(
    rf"add column (?:if not exists )?({_ALLOW_IDENT}) {_BUILTIN_COLUMN_TYPE}(?: null)?"
    rf"(?: (?:constraint {_ALLOW_IDENT} )?check ?\( ?({_ALLOW_IDENT}) (?:not )?in ?\( ?''(?: ?, ?'')* ?\) ?\))?")
NEW_COLUMN_CHECK_RISKS = frozenset({RISK_TEXT["expected_downtime"]})


def new_column_check_risks(statement: str) -> frozenset | None:
    """Risks of an ADD COLUMN list whose CHECKs bind only their own new column, or None."""
    m = re.fullmatch(rf"alter table (?:only )?{_ALLOW_QUALIFIED} (.+)", statement)
    if not m:
        return None
    checked = False
    for action in _split_top_level_commas(m.group(1)):
        column = _NEW_COLUMN_ACTION.fullmatch(action)
        if not column:
            return None
        if column.group(2) is not None:
            if column.group(2) != column.group(1):
                return None
            checked = True
    return NEW_COLUMN_CHECK_RISKS if checked else None


def _classify_statements(statements: list[str] | None, prior: "_PriorMigrations | None" = None) -> set[str]:
    """All three risks unless EVERY statement is recognised. Unparsed is all."""
    every = {RISK_TEXT["permanent_data_rewrite_or_loss"],
             RISK_TEXT["expected_downtime"], RISK_TEXT["material_access_change"]}
    if statements is None:
        return every
    new_tables: set[str] = set()
    reasons: set[str] = set()
    reestablished = _reestablished_functions(statements, prior)
    for index, s in enumerate(statements):
        if index in reestablished or NARROWING_REVOKE.fullmatch(s):
            continue
        entry = allowlist_entry(s, new_tables)
        if entry is None:
            partial = new_column_check_risks(s)
            if partial is None:
                return every
            reasons.update(partial)
            continue
        if entry == "create_table":
            new_tables.add(ALLOWLIST["create_table"].fullmatch(s).group(1))
    return reasons


def diagnose_risk_coverage(repo_root: Path, allowlist: list[str]) -> dict[str, Any]:
    """Read-only Phase 2 qualification entrypoint; assess() remains authoritative."""
    findings = classify_sql(repo_root, allowlist)
    return {"status": "covered", "finding_count": len(findings), "findings": findings}


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


# ---------------------------------------------------------------------------
# PRODUCTION WITHOUT A SHARED-PREVIEW APPLY (orchestrator marker #2758).
#
# OWNER REQUEST: a merged migration may go to production without a preview
# rehearsal when the exact merged SQL already passed the ephemeral database CI
# run on the source PR head -- a throwaway Postgres that applies every
# migration and then runs the contract tests. Preview stays MANDATORY for SQL
# that is high-risk to live data: table rewrites, long locks on existing
# tables, destructive drops, and data backfills.
#
# The classifier below is an ALLOWLIST, not a denylist. A statement skips
# preview only if it matches a shape known to be metadata-only or confined to a
# table created in the same migration. Anything unrecognised, unparseable, or
# ambiguous requires preview. A false "high-risk" costs one preview rehearsal;
# a false "low-risk" costs production data, so every doubt resolves to preview.
#
# NOTHING ELSE IS RELAXED ON THIS ROUTE: exact-main pinning, the merged PR and
# its required exact-head checks, immutable independent review evidence, the
# production project-ref proof, the production lane lock and post-apply
# verification are all unchanged -- they live outside this function.
# ---------------------------------------------------------------------------
EPHEMERAL_CHECK_NAME = "supabase/tests against an ephemeral database"
EPHEMERAL_WORKFLOW = ".github/workflows/database-contract-tests.yml"
EPHEMERAL_ARTIFACT = "supabase-contract-test-logs"
EPHEMERAL_APPLIED_RECORD = "applied-migrations.txt"
EPHEMERAL_FAILED_RECORD = "failed-migrations-pass2.txt"
# The machinery that writes the applied/failed records. A pull_request run
# executes the SOURCE PR's copy of these, so a PR could keep the job title and
# write every basename by hand; each must be byte-identical to exact main.
EPHEMERAL_PRODUCER_PATHS = (
    EPHEMERAL_WORKFLOW,
    "scripts/check_pass2_routine_supersession.py",
)

_IDENT = r'(?:"[^"]+"|[a-z_][a-z0-9_$]*)'
_NAME = rf"{_IDENT}(?:\.{_IDENT})?"


def sql_top_level_statements(raw: str, keep_literals: bool = False, spans: list | None = None, keep_dollar_quoted: bool = False) -> list[str] | None:
    """Split SQL into top-level statements with literal CONTENTS neutralised.

    Comments are removed, string literals become '', and dollar-quoted bodies
    become $$ $$, so a keyword or semicolon inside a function body or a string
    can neither hide a statement nor invent one. Returns None when the text
    cannot be tokenised (an unterminated quote or comment): the caller treats
    that as high-risk rather than guessing.

    Two additional output modes for the self-service additive lane (#3199),
    neither of which changes the tokenisation itself:

    * ``spans``: when a list is passed, the RAW character offsets of every
      RETURNED statement are appended to it (aligned with the return value, so
      empty statements dropped by the final filter drop their spans too). A
      caller can then slice the original text for the exact statement it just
      matched, without a second tokenizer.
    * ``keep_dollar_quoted``: dollar-quoted bodies are kept VERBATIM instead of
      being emptied to ``$$ $$`` (comments and '...' literals are still
      neutralised). This is the reference-scanning view: the lane classifier
      must see every schema-qualified name a function or view body mentions,
      while the ALLOWLIST shapes keep consuming the default ``$$ $$`` view so
      they cannot be fooled by body content.
    """
    out: list[str] = []
    raw_spans: list[tuple[int, int]] = []
    start = 0
    current: list[str] = []
    literals: list[str] = []  # keep_literals: exact literal text, restored after folding
    i, n = 0, len(raw)
    while i < n:
        ch = raw[i]
        if raw.startswith("--", i):
            end = raw.find("\n", i)
            i = n if end == -1 else end
            current.append(" ")
            continue
        if raw.startswith("/*", i):
            depth, j = 1, i + 2
            while j < n and depth:
                if raw.startswith("/*", j):
                    depth, j = depth + 1, j + 2
                elif raw.startswith("*/", j):
                    depth, j = depth - 1, j + 2
                else:
                    j += 1
            if depth:
                return None
            i = j
            current.append(" ")
            continue
        if ch == "'":
            escape = i > 0 and raw[i - 1] in "eE" and (i < 2 or not (raw[i - 2].isalnum() or raw[i - 2] in "_$" or ord(raw[i - 2]) >= 0x80))
            j = i + 1
            while True:
                if j >= n:
                    return None
                if escape and raw[j] == "\\":
                    j += 2
                    continue
                if raw[j] == "'":
                    if j + 1 < n and raw[j + 1] == "'":
                        j += 2
                        continue
                    break
                j += 1
            if keep_literals:
                literals.append(raw[i:j + 1])
                current.append(f"'#{len(literals) - 1}'")
            else:
                current.append("''")
            i = j + 1
            continue
        if ch == '"':
            end = raw.find('"', i + 1)
            if end == -1:
                return None
            current.append(raw[i:end + 1])
            i = end + 1
            continue
        if ch == "$":
            tag = re.match(r"\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$", raw[i:])
            # PostgreSQL ident_cont is [A-Za-z\200-\377_0-9$]: a "$" glued to an
            # identifier (including after another "$", as in a$$$) never opens a quote.
            prev = raw[i - 1] if i > 0 else ""
            if tag and not (prev and (prev.isalnum() or prev in "_$" or ord(prev) >= 0x80)):
                end = raw.find(tag.group(0), i + len(tag.group(0)))
                if end == -1:
                    return None
                if keep_dollar_quoted:
                    current.append(raw[i:end + len(tag.group(0))])
                else:
                    current.append(" $$ $$ ")
                i = end + len(tag.group(0))
                continue
        if ch == ";":
            out.append("".join(current))
            raw_spans.append((start, i))
            current = []
            start = i + 1
            i += 1
            continue
        current.append(ch)
        i += 1
    out.append("".join(current))
    raw_spans.append((start, n))
    normalised = [_normalise_outside_identifiers(s) for s in out]
    if keep_literals:
        normalised = [re.sub(r"'#(\d+)'", lambda m: literals[int(m.group(1))], s) for s in normalised]
    kept = [(s, raw_spans[index]) for index, s in enumerate(normalised) if s]
    if spans is not None:
        spans.extend(span for _, span in kept)
    return [s for s, _ in kept]


def _normalise_outside_identifiers(statement: str) -> str:
    """Lower-case and collapse whitespace, leaving "quoted identifiers" byte-exact.

    PostgreSQL folds unquoted names to lower case but keeps a quoted name's
    case (and any dot inside it) as part of the name, so "Item" and item are
    different tables; lower-casing the quoted form would merge them (#2771).
    """
    parts = re.split(r'("[^"]*")', statement)
    folded = "".join(part if index % 2 else re.sub(r"\s+", " ", part.lower())
                     for index, part in enumerate(parts))
    return folded.strip()


def _canonical_name(name: str) -> tuple[str, ...]:
    """PostgreSQL identity of a (possibly schema-qualified) name.

    Unquoted parts are already folded to lower case; quoted parts keep their
    exact text, so "core.item" is ONE part and never equals core.item.
    """
    return tuple(m.group(1) if m.group(1) is not None else m.group(2)
                 for m in re.finditer(r'"([^"]*)"|([^."]+)', name))


def _binds_on(statement: str, pattern: str) -> tuple[tuple[str, ...], tuple[str, ...]] | None:
    m = re.match(pattern, statement)
    return (_canonical_name(m.group(1)), _canonical_name(m.group(2))) if m else None


def _split_top_level_commas(text: str) -> list[str]:
    parts, depth, start = [], 0, 0
    for index, ch in enumerate(text):
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        elif ch == "," and depth == 0:
            parts.append(text[start:index].strip())
            start = index + 1
    parts.append(text[start:].strip())
    return parts


def _alter_table_action_is_low_risk(action: str, types_trusted: bool = True) -> bool:
    """One ALTER TABLE action on an EXISTING table, metadata-only or refused.

    ``types_trusted`` is False after a search_path change: ``set search_path =
    public, pg_catalog`` lets a user domain named ``text`` shadow the built-in,
    so an unqualified type spelling no longer proves there is no hidden default.
    """
    if re.fullmatch(r"(?:enable|force) row level security", action):
        return True
    if re.fullmatch(rf"owner to {_IDENT}", action):
        return True
    if re.fullmatch(rf"alter (?:column )?{_IDENT} (?:set default .+|drop default)", action):
        return True
    if action.startswith("add constraint "):
        # NOT VALID skips the scan of existing rows; anything else validates
        # (a long lock) or builds an index (unique / primary key / exclude).
        return action.endswith(" not valid") and not re.search(
            r"\b(?:unique|primary key|exclude)\b", action)
    column = re.fullmatch(rf"add (?:column )?(?:if not exists )?{_IDENT} (.+)", action)
    if column and not action.startswith("add constraint"):
        # Only a nullable column of a built-in type with no default is a
        # catalog-only change. A default, NOT NULL, generated/identity, inline
        # constraint, serial pseudo-type, or domain/user type (which can carry
        # a hidden default or NOT NULL) can rewrite or scan the table.
        return types_trusted and bool(re.fullmatch(
            rf"{_BUILTIN_COLUMN_TYPE}(?: collate {_NAME})?(?: null)?", column.group(1)))
    return False


LOW_RISK_STATEMENT = re.compile(
    r"^(?:"
    r"create (?:or replace )?(?:function|procedure|view|trigger|constraint trigger|type|domain"
    r"|schema|sequence|policy|aggregate|cast|operator)\b"
    r"|comment on\b|grant\b|revoke\b|alter default privileges\b"
    rf"|alter (?:function|procedure|policy|view|sequence|schema) "
    rf"|alter type {_NAME} (?:add value|owner to|rename value)\b"
    r"|set\b|reset\b|begin\b|start transaction\b|commit\b|notify\b"
    r")"
)


def preview_required_reasons(repo_root: Path, allowlist: list[str]) -> list[str]:
    """Why preview CANNOT be skipped for this allowlist. Empty means it can.

    Each reason names the migration version, the risk class, and the statement
    prefix that triggered it, so a refusal is actionable without reading SQL.
    """
    reasons: list[str] = []
    for version in allowlist:
        matches = list(repo_root.glob(f"supabase/migrations/{version}_*.sql"))
        if len(matches) != 1:
            raise RiskGateError(f"expected one migration for {version}, found {len(matches)}")
        statements = sql_top_level_statements(matches[0].read_text(encoding="utf-8"))
        if statements is None:
            reasons.append(f"{version}: unparseable SQL (unterminated quote or comment)")
            continue
        if not statements:
            reasons.append(f"{version}: empty migration")
            continue
        # A search_path change makes an unqualified name resolve differently
        # from one statement to the next, so only qualified names are excused.
        path_changes = any(re.match(r"^(?:set|reset)\b", s) and "search_path" in s
                           or "set_config" in s for s in statements)
        new_tables = {
            name for s in statements
            if (m := re.match(rf"^create (?:unlogged )?table ({_NAME}) ?\(", s))
            and (len(name := _canonical_name(m.group(1))) == 2 or not path_changes)
        }
        # Recreate drops are excused only for the SAME (name, table) pair.
        created_triggers = {
            pair for s in statements
            if (pair := _binds_on(s, rf"^create (?:or replace )?(?:constraint )?trigger ({_IDENT}) .*? on ({_NAME})(?: |$)"))
        }
        created_policies = {
            pair for s in statements
            if (pair := _binds_on(s, rf"^create policy ({_IDENT}) on ({_NAME})(?: |$)"))
        }
        for statement in statements:
            risk = _statement_preview_risk(
                statement, new_tables, created_triggers, created_policies, path_changes)
            if risk:
                reasons.append(f"{version}: {risk}: {statement[:80]}")
    return reasons


def _statement_preview_risk(
    s: str, new_tables: set, created_triggers: set, created_policies: set,
    path_changes: bool = False,
) -> str | None:
    if re.match(r"^(?:insert|update|delete|truncate|copy|merge|with)\b", s):
        return "data backfill or rewrite"
    if re.match(r"^drop\b", s):
        recreate = re.fullmatch(rf"drop (trigger|policy) if exists ({_IDENT}) on ({_NAME})", s)
        if recreate and (_canonical_name(recreate.group(2)), _canonical_name(recreate.group(3))) in (
                created_triggers if recreate.group(1) == "trigger" else created_policies):
            return None
        return "destructive drop"
    if re.match(r"^(?:lock|cluster|vacuum|reindex|refresh materialized view)\b", s):
        return "table rewrite or long lock"
    if re.match(r"^create materialized view\b", s) or re.match(
            rf"^create (?:temp |temporary |unlogged )?table (?:if not exists )?{_NAME} as\b", s):
        return "data backfill"
    index = re.match(rf"^create (?:unique )?index (concurrently )?(?:if not exists )?(?:{_IDENT} )?on (?:only )?({_NAME})(?=[ (]|$)", s)
    if index:
        if index.group(1) or _canonical_name(index.group(2)) in new_tables:
            return None
        return "index build locks an existing table"
    if re.match(r"^create (?:unique )?index\b", s):
        return "index build locks an existing table"
    if re.match(rf"^create (?:unlogged )?table (?:if not exists )?{_NAME} ?\(", s):
        return None
    alter = re.fullmatch(rf"alter table (?:if exists )?(?:only )?({_NAME}) (.+)", s)
    if alter:
        if _canonical_name(alter.group(1)) in new_tables:
            return None
        if all(_alter_table_action_is_low_risk(a, types_trusted=not path_changes)
               for a in _split_top_level_commas(alter.group(2))):
            return None
        return "table rewrite or long lock on an existing table"
    if re.match(r"^(?:do|select|call|perform|execute)\b", s):
        return "code with an unclassifiable data effect"
    if LOW_RISK_STATEMENT.match(s):
        return None
    return "statement not recognised as low-risk"


def git_blob_sha(path: Path) -> str:
    data = path.read_bytes()
    return hashlib.sha1(b"blob %d\0" % len(data) + data).hexdigest()


def prove_ephemeral_ci_evidence(
    *, check_run_id_text: str, pr_head: str, allowlist: list[str],
    api: Callable[[str], Any], downloader: Callable[[int, Path], None], repo_root: Path,
) -> dict[str, Any]:
    """Prove the exact bytes being promoted applied cleanly in ephemeral CI.

    Binds, in order: the named check job is the successful ephemeral contract
    job ON THE SOURCE PR HEAD; its run is the contract-test workflow's
    pull_request run for that head and succeeded; that run's single unexpired
    log artifact downloads to its recorded digest; every allowlisted migration
    is POSITIVELY on the run's applied record and not on its still-failing
    record (the job tolerates non-replaying migrations, so a green check alone
    proves nothing about one file); and each migration's blob at the PR head
    equals the blob being promoted from exact main.
    """
    if not re.fullmatch(r"[1-9][0-9]*", check_run_id_text or ""):
        raise RiskGateError("ephemeral check run ID must be a positive decimal integer")
    job_id = int(check_run_id_text)
    job_endpoint = f"repos/{REPOSITORY}/actions/jobs/{job_id}"
    job = api_object(api, job_endpoint)
    expected_job = {"id": job_id, "name": EPHEMERAL_CHECK_NAME, "status": "completed",
                    "conclusion": "success", "head_sha": pr_head}
    for key, value in expected_job.items():
        if job.get(key) != value:
            raise RiskGateError(f"ephemeral CI job has wrong {key}: expected {value!r}")
    run_id = job.get("run_id")
    if type(run_id) is not int or run_id < 1:
        raise RiskGateError("ephemeral CI job names no workflow run")
    run = api_object(api, f"repos/{REPOSITORY}/actions/runs/{run_id}")
    expected_run = {"id": run_id, "path": EPHEMERAL_WORKFLOW, "event": "pull_request",
                    "status": "completed", "conclusion": "success", "head_sha": pr_head}
    for key, value in expected_run.items():
        if run.get(key) != value:
            raise RiskGateError(f"ephemeral CI run has wrong {key}: expected {value!r}")
    repository = run.get("repository")
    if not isinstance(repository, dict) or repository.get("full_name") != REPOSITORY:
        raise RiskGateError("ephemeral CI run belongs to the wrong repository")
    artifacts_endpoint = f"repos/{REPOSITORY}/actions/runs/{run_id}/artifacts?per_page=100"
    artifacts = api_sublist(api_object(api, artifacts_endpoint), "artifacts", artifacts_endpoint)
    named = [a for a in artifacts if isinstance(a, dict) and a.get("name") == EPHEMERAL_ARTIFACT]
    if len(named) != 1:
        raise RiskGateError(f"expected exactly one {EPHEMERAL_ARTIFACT} artifact, found {len(named)}")
    artifact = named[0]
    digest = artifact.get("digest")
    if (artifact.get("expired") is not False or not isinstance(artifact.get("id"), int)
            or not isinstance(digest, str) or not re.fullmatch(r"sha256:[0-9a-f]{64}", digest)
            or not isinstance(artifact.get("workflow_run"), dict)
            or artifact["workflow_run"].get("id") != run_id):
        raise RiskGateError("ephemeral CI artifact is expired, unpinned, or belongs to another run")
    with tempfile.TemporaryDirectory(prefix="production-risk-ephemeral-") as temp:
        zip_path = Path(temp, "ephemeral.zip")
        downloader(artifact["id"], zip_path)
        if "sha256:" + sha256_file(zip_path) != digest:
            raise RiskGateError("downloaded ephemeral CI artifact bytes do not match its digest")
        with zipfile.ZipFile(zip_path) as archive:
            names = set(archive.namelist())
            if EPHEMERAL_APPLIED_RECORD not in names:
                raise RiskGateError(
                    f"ephemeral CI artifact has no {EPHEMERAL_APPLIED_RECORD}; this run predates "
                    "the positive applied record, so preview is still required")
            applied = set(archive.read(EPHEMERAL_APPLIED_RECORD).decode("utf-8").split())
            failed = (set(archive.read(EPHEMERAL_FAILED_RECORD).decode("utf-8").split())
                      if EPHEMERAL_FAILED_RECORD in names else None)
    if failed is None:
        raise RiskGateError(f"ephemeral CI artifact has no {EPHEMERAL_FAILED_RECORD}")
    head_tree = tracked_tree_at(pr_head, api)
    # PIN THE PRODUCER. repo_root is the exact-main checkout; the tested head
    # must carry the same bytes for every file that writes the records above,
    # or the records prove only what a doctored workflow chose to write.
    for path in EPHEMERAL_PRODUCER_PATHS:
        on_main = repo_root / path
        entry = head_tree.get(path)
        if not on_main.is_file() or not isinstance(entry, dict) or entry.get("type") != "blob":
            raise RiskGateError(
                f"ephemeral CI producer {path} is absent from exact main or the source PR head {pr_head}")
        if entry.get("sha") != git_blob_sha(on_main):
            raise RiskGateError(
                f"ephemeral CI producer {path} at {pr_head} differs from exact main, so its "
                "applied record is not evidence")
    bound: dict[str, str] = {}
    for version in allowlist:
        matches = list(repo_root.glob(f"supabase/migrations/{version}_*.sql"))
        if len(matches) != 1:
            raise RiskGateError(f"expected one migration for {version}, found {len(matches)}")
        base = matches[0].name
        if base not in applied or base in failed:
            raise RiskGateError(f"ephemeral CI did not prove {base} applied cleanly")
        path = f"supabase/migrations/{base}"
        entry = head_tree.get(path)
        if not isinstance(entry, dict) or entry.get("type") != "blob":
            raise RiskGateError(f"{path} is absent from the source PR head {pr_head}")
        main_blob = git_blob_sha(matches[0])
        if entry.get("sha") != main_blob:
            raise RiskGateError(
                f"{path} at exact main differs from the bytes ephemeral CI tested at {pr_head}")
        bound[version] = main_blob
    return {"checkRunId": job_id, "runId": run_id, "artifactId": artifact["id"],
            "artifactDigest": digest, "migrationBlobs": bound}


def optional_text(value: Any) -> str | None:
    """GitHub Actions passes an omitted optional input as an empty string."""
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def enforce_automatic_risk_decision(review: dict[str, Any], decision: dict[str, Any]) -> None:
    """An automatic v2 verdict may proceed only when every risk class is clear."""
    if (
        review.get("schema_version") == "shared-db-production-apply-review/v2"
        and decision.get("automaticPromotionAllowed") is not True
    ):
        reasons = decision.get("ownerDecisionReasons") or ["business-risk decision is not clear"]
        raise RiskGateError(
            "ENGINEER ACTION REQUIRED: automatic production promotion is not fully "
            f"machine-qualified: {'; '.join(str(reason) for reason in reasons)}"
        )


def assess(args: argparse.Namespace, *, api=gh_json, downloader=download_artifact) -> dict[str, Any]:
    repo_root = args.repo.resolve()
    allowlist = normalize_review_allowlist(args.allowlist)
    preview_run_text = optional_text(getattr(args, "preview_run_id", None))
    preview_digest = optional_text(getattr(args, "preview_digest", None))
    ephemeral_text = optional_text(getattr(args, "ephemeral_check_run_id", None))
    if ephemeral_text and (preview_run_text or preview_digest):
        raise RiskGateError("choose ONE promotion route: preview evidence or ephemeral CI evidence, not both")
    if not ephemeral_text and not (preview_run_text and preview_digest):
        raise RiskGateError("promotion needs preview run + digest, or an ephemeral CI check run ID")
    activation = load_activation(args.activation)
    prove_activation(activation, main_sha=args.main_sha, api=api, repo_root=repo_root)
    train_path = getattr(args, "migration_train_record", None)
    train = load_migration_train_record(train_path) if train_path else None
    train_prs: dict[int, tuple[str, str]] = {}
    if train is None:
        pr_head, pr_merge_commit = prove_pr_and_checks(args.pr, args.main_sha, allowlist, api, repo_root)
    else:
        if ephemeral_text:
            raise RiskGateError(
                "a migration train promotes only on preview evidence; one ephemeral CI check "
                "cannot prove several authoring pull request heads"
            )
        train_prs = prove_migration_train(
            train, main_sha=args.main_sha, allowlist=allowlist, api=api, repo_root=repo_root,
        )
        if args.pr not in train_prs:
            raise RiskGateError(f"source PR {args.pr} authored no entry of the migration train")
        pr_head, pr_merge_commit = train_prs[args.pr]
    with tempfile.TemporaryDirectory(prefix="production-risk-review-") as temp:
        review_path = verify_review(
            run_id_text=str(args.review_run_id), expected_digest=args.review_digest,
            sha=args.main_sha, allowlist_raw=args.allowlist, api=api, downloader=downloader,
            output_dir=Path(temp),
        )
        review = json.loads(review_path.read_text(encoding="utf-8"))
    if review.get("verdict") != "APPROVE":
        return {"automaticPromotionAllowed": False, "ownerDecisionReasons": [RISK_TEXT["unresolved_material_objection"]]}
    if review.get("schema_version") == "shared-db-production-apply-review/v2":
        if train is None:
            if review.get("source_pr") != args.pr or review.get("source_pr_head") != pr_head:
                raise RiskGateError(
                    "automatic review evidence is not bound to the promoted source PR and exact head"
                )
        else:
            reviewed = review.get("source_pr")
            if (
                type(reviewed) is not int or reviewed not in train_prs
                or review.get("source_pr_head") != train_prs[reviewed][0]
            ):
                raise RiskGateError(
                    "automatic review evidence is not bound to an authoring PR of the migration "
                    "train and its exact head"
                )
        if review.get("work_issue") != args.work_issue:
            raise RiskGateError("automatic review evidence names a different admitted structural work issue")
        if not ephemeral_text:
            if review.get("preview_run_id") != int(preview_run_text):
                raise RiskGateError("automatic review evidence names a different preview run")
            if review.get("preview_artifact_digest") != preview_digest:
                raise RiskGateError("automatic review evidence names a different preview artifact digest")
    ephemeral_evidence = None
    if ephemeral_text:
        high_risk = preview_required_reasons(repo_root, allowlist)
        if high_risk:
            raise RiskGateError(
                "preview required: this migration is high-risk to live data, so the ephemeral CI "
                "route cannot promote it -- " + "; ".join(high_risk))
        ephemeral_evidence = prove_ephemeral_ci_evidence(
            check_run_id_text=ephemeral_text, pr_head=pr_head, allowlist=allowlist,
            api=api, downloader=downloader, repo_root=repo_root,
        )
    else:
        if not optional_text(getattr(args, "preview_project_ref", None)):
            raise RiskGateError("the preview route needs --preview-project-ref")
        if train is None:
            prove_preview(
                run_id=int(preview_run_text), digest=preview_digest, pr_head=pr_head,
                main_sha=args.main_sha, source_pr=args.pr, allowlist=allowlist,
                preview_project_ref=args.preview_project_ref, merge_commit_sha=pr_merge_commit,
                api=api, downloader=downloader, repo_root=repo_root,
            )
        else:
            # ONE PROOF PER AUTHORING PR against the one rehearsal of the whole
            # train. A merged_preview_source_pr_map rehearsal files
            # preview-instance-<pr>.json naming each PR and its own merge commit
            # over the complete allowlist (#2140); each is checked strictly.
            for train_pr, (train_head, train_merge) in train_prs.items():
                try:
                    prove_preview(
                        run_id=int(preview_run_text), digest=preview_digest, pr_head=train_head,
                        main_sha=args.main_sha, source_pr=train_pr, allowlist=allowlist,
                        preview_project_ref=args.preview_project_ref, merge_commit_sha=train_merge,
                        api=api, downloader=downloader, repo_root=repo_root,
                    )
                except (RiskGateError, ValueError) as exc:
                    raise RiskGateError(f"migration train preview proof for source PR {train_pr}: {exc}") from exc
    decision = decide_business_risk(classify_sql(repo_root, allowlist), recovery_proven=True, review_approved=True)
    enforce_automatic_risk_decision(review, decision)
    # OWNER RULING 2026-08-18: the machine-readable owner-decision block remains
    # retired as a mandatory technical rubber stamp. The five independently
    # derived risks are still recorded in the evidence below, but a missing block
    # no longer stops the legacy/manual recovery path. The automatic v2 path has no
    # human dispatch boundary, so it instead fails to an engineer whenever any
    # one of the five derived risk conclusions is not clear.
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
    # #2716 therefore removes transcription, not judgement: only an exact v2
    # evidence chain whose machine-derived risk decision is fully clear can pass.
    owner_evidence = None
    if decision["ownerDecisionReasons"] and args.owner_decision_run_id and args.owner_decision_digest:
        owner_evidence = verify_owner_decision(
            args.owner_decision_run_id, args.owner_decision_digest, args.main_sha,
            allowlist, args.pr, downloader, api,
        )
        expected_risks = sorted(key for key, text in RISK_TEXT.items() if text in decision["ownerDecisionReasons"])
        if sorted(owner_evidence["accepted_risks"]) != expected_risks:
            raise RiskGateError("owner decision does not accept exactly the risks derived from governed evidence")
    result = {
        **decision,
        # Legacy/manual evidence preserves the earlier disclosure path. Automatic
        # v2 evidence reached this line only after every derived risk class cleared.
        "productionPromotionAllowed": True,
        "disclosedRisks": decision["ownerDecisionReasons"],
        "governedEvidence": {
            "mainSha": args.main_sha, "sourcePr": args.pr, "sourcePrHead": pr_head,
            "workIssue": args.work_issue,
            "reviewRun": args.review_run_id,
            "promotionRoute": "ephemeral-ci" if ephemeral_evidence else "preview",
            "previewRun": None if ephemeral_evidence else int(preview_run_text),
            "previewProjectRef": None if ephemeral_evidence else args.preview_project_ref,
            "ephemeralCi": ephemeral_evidence,
            "allowlist": allowlist,
            "ownerDecision": owner_evidence,
        },
    }
    if train is not None:
        result["governedEvidence"]["migrationTrain"] = {
            "trainId": train.get("train_id"), "generation": train.get("generation"),
            "entries": [
                {"version": e["version"], "sourcePr": e["source_pr"],
                 "sourcePrHead": train_prs[e["source_pr"]][0], "mergeSha": e["merge_sha"],
                 "fileSha256": e["file_sha256"]}
                for e in train["entries"]
            ],
        }
    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", type=Path, default=Path.cwd())
    parser.add_argument("--activation", type=Path, default=Path("config/production-risk-policy-activation.json"))
    parser.add_argument("--main-sha", required=True)
    parser.add_argument("--allowlist", required=True)
    parser.add_argument("--pr", type=int, required=True)
    parser.add_argument("--work-issue", type=int, required=True)
    parser.add_argument("--review-run-id", type=int, required=True)
    parser.add_argument("--review-digest", required=True)
    # EXACTLY ONE ROUTE (#2758): preview evidence (--preview-run-id, --preview-digest,
    # --preview-project-ref) OR --ephemeral-check-run-id, the Actions job ID of the
    # required "supabase/tests against an ephemeral database" check on the source
    # PR head. The ephemeral route is refused for any high-risk migration.
    parser.add_argument("--preview-run-id")
    parser.add_argument("--preview-digest")
    parser.add_argument("--ephemeral-check-run-id")
    # NOT DEFAULTED, EVER. Preview is rebuilt from time to time and its project
    # ref changes when it is; a literal in this file is what stranded the lane on
    # 2026-08-18. The workflow passes the repository variable PREVIEW_PROJECT_REF,
    # which is the same value the preview job writes to.
    parser.add_argument("--preview-project-ref")
    # GitHub Actions supplies an omitted optional workflow input as an empty
    # string.  Keep it as text so the established no-risk automatic path can
    # reach assess(); a material-risk path still rejects the missing value.
    parser.add_argument("--owner-decision-run-id")
    parser.add_argument("--owner-decision-digest")
    # Default 0: fail fast on a GitHub quota exhaustion. Only the pre-lane
    # invocation passes a budget (capped at 900s inside gh_json); the invocation
    # that holds the production lane must never sit on it waiting.
    parser.add_argument("--rate-limit-wait-seconds", type=float, default=0)
    # #3027 Step 6: the dispatched migration-train record, re-read from its
    # immutable ref by the workflow. Absent, the single source-PR rule is unchanged.
    parser.add_argument("--migration-train-record", type=Path)
    args = parser.parse_args()
    api = functools.partial(gh_json, rate_limit_wait_seconds=args.rate_limit_wait_seconds) if args.rate_limit_wait_seconds > 0 else gh_json
    try:
        result = assess(args, api=api)
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

PREVIEW_PRODUCER_PATHS += (
    # config/db-data-admin-property-source-coverage.json was pinned here by
    # #2579 and is now EXEMPTED instead (see PREVIEW_RUNTIME_DATA_EXEMPTIONS):
    # no step of the preview job reads it, so pinning it refused #2870's
    # promotion when unrelated PR #3110 edited it after the preview ran.
    # Invoked by check-sql.sh during preview; pin the reviewed parser so the
    # protected static check cannot be changed independently of the PR head.
    "scripts/check-expected-count-patterns.mjs",
    "scripts/check-migration-verify-cost.mjs",
)

# THE SINGLE SIDECAR DECLARATION REGISTRY (#3028, popcre/ai-devops#401 Step 5).
#
# Hash-bound verification sidecars are read by the catalog verifier in preview,
# so each one is a producer file and must be pinned byte for byte. Contents API
# directory responses are arrays, so each reviewed file is pinned explicitly
# rather than pretending a directory has a blob SHA. They used to be hand-listed
# in the tuples above, and a sidecar merged without its line (#2627) needed a
# second repair PR. Now the ONLY declaration is one entry in
# SIDECAR_REGISTRY_PATH. This is not discovery: a sidecar file that is not
# declared is refused by check_production_verification_sidecars.py in CI before
# review and by the test suite, and a declaration without its file is refused
# the same way, so trust never widens silently. The registry itself is pinned.
SIDECAR_REGISTRY_PATH = "config/production-verification-sidecar-registry.json"
SIDECAR_DIR = "scripts/production-verification-sidecars"


def load_sidecar_registry(repo_root: Path | None = None) -> tuple[str, ...]:
    """Return the declared sidecar versions, refusing any malformed registry."""
    root = repo_root or Path(__file__).resolve().parents[1]
    try:
        data = json.loads((root / SIDECAR_REGISTRY_PATH).read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise RiskGateError(f"sidecar registry {SIDECAR_REGISTRY_PATH} is unreadable: {exc}") from exc
    if not isinstance(data, dict) or set(data) != {"schema_version", "sidecars"} or data["schema_version"] != 1:
        raise RiskGateError(f"sidecar registry {SIDECAR_REGISTRY_PATH} must be schema_version 1 with exactly schema_version and sidecars")
    entries = data["sidecars"]
    if not isinstance(entries, list):
        raise RiskGateError("sidecar registry must declare a sidecars list")
    versions = []
    for entry in entries:
        if not isinstance(entry, dict) or set(entry) != {"version", "issue"}:
            raise RiskGateError(f"sidecar registry entry {entry!r} must contain exactly version and issue")
        version, issue = entry["version"], entry["issue"]
        if not isinstance(version, str) or not re.fullmatch(r"\d{14}", version):
            raise RiskGateError(f"sidecar registry version {version!r} is not a 14-digit migration version")
        if issue is not None and (not isinstance(issue, int) or isinstance(issue, bool) or issue <= 0):
            raise RiskGateError(f"sidecar registry issue for {version} must be a positive integer or null")
        versions.append(version)
    if len(set(versions)) != len(versions):
        raise RiskGateError("sidecar registry declares a version more than once")
    return tuple(versions)


def sidecar_registry_paths(repo_root: Path | None = None) -> tuple[str, ...]:
    return tuple(f"{SIDECAR_DIR}/{version}.json" for version in load_sidecar_registry(repo_root))


PREVIEW_PRODUCER_PATHS += (SIDECAR_REGISTRY_PATH,) + sidecar_registry_paths()



def successful_ephemeral_job_id(pr_head: str, api: Callable[[str], Any]) -> int:
    """The one successful ephemeral-database check on the source PR head."""
    endpoint = f"repos/{REPOSITORY}/commits/{pr_head}/check-runs?per_page=100"
    checks = api_sublist(api_object(api, endpoint), "check_runs", endpoint)
    ids = sorted({
        c.get("id") for c in checks
        if isinstance(c, dict) and c.get("name") == EPHEMERAL_CHECK_NAME
        and c.get("status") == "completed" and c.get("conclusion") == "success"
        and type(c.get("id")) is int and c.get("id") > 0
    })
    if len(ids) != 1:
        raise RiskGateError(
            f"expected exactly one successful '{EPHEMERAL_CHECK_NAME}' check on source PR "
            f"head {pr_head}, found {len(ids)}"
        )
    return ids[0]


def qualify_automatic_route(
    *, main_sha: str, allowlist: list[str], source_pr: int, recovery_record: dict | None,
    repo_root: Path, api: Callable[[str], Any], downloader: Callable[[int, Path], None],
) -> dict[str, Any]:
    """Choose, BEFORE dispatch, the evidence route the production gate will accept (#3039).

    Automatic qualification used to dispatch every historical rebind on its preview
    evidence without asking the gate's question. When the rebind names an ORIGINAL
    apply run made on an older commit, `prove_historical_original_apply_runs` pins
    that run's commits to the authoring merge commit and refuses the drift -- so the
    dispatch was doomed (runs 35052182196, 35061726161). Qualification now runs that
    SAME proof, unchanged. On refusal it never dispatches the stale evidence: a
    migration that is not high-risk to live data takes the gate's own ephemeral-CI
    route, bound to the exact source PR head and proved here with the gate's own
    `prove_ephemeral_ci_evidence`; a high-risk migration refuses outright.
    """
    pr_endpoint = f"repos/{REPOSITORY}/pulls/{source_pr}"
    pr = api_object(api, pr_endpoint)
    head_obj = pr.get("head")
    pr_head = head_obj.get("sha") if isinstance(head_obj, dict) else None
    if pr.get("merged") is not True or not re.fullmatch(r"[0-9a-f]{40}", str(pr_head)):
        raise RiskGateError("source PR is not merged or has no exact head")
    if recovery_record is None:
        return {"route": "preview"}
    try:
        prove_historical_original_apply_runs(
            record=recovery_record, allowlist=allowlist, repo_root=repo_root,
            main_sha=main_sha, api=api, downloader=downloader,
        )
        return {"route": "preview"}
    except RiskGateError as preview_refusal:
        high_risk = preview_required_reasons(repo_root, allowlist)
        if high_risk:
            raise RiskGateError(
                f"the production gate would refuse this preview evidence ({preview_refusal}), "
                "and the migration is high-risk to live data so the ephemeral CI route cannot "
                "substitute -- " + "; ".join(high_risk)
            ) from preview_refusal
        job_id = successful_ephemeral_job_id(pr_head, api)
        prove_ephemeral_ci_evidence(
            check_run_id_text=str(job_id), pr_head=pr_head, allowlist=allowlist,
            api=api, downloader=downloader, repo_root=repo_root,
        )
        return {"route": "ephemeral", "ephemeral_check_run_id": job_id,
                "preview_refusal": str(preview_refusal)}


def qualify_route_main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(prog="production_business_risk_gate.py qualify-route")
    parser.add_argument("--repo", type=Path, default=Path.cwd())
    parser.add_argument("--main-sha", required=True)
    parser.add_argument("--allowlist", required=True)
    parser.add_argument("--pr", type=int, required=True)
    parser.add_argument("--recovery-record", type=Path)
    args = parser.parse_args(argv)
    try:
        record = None
        if args.recovery_record is not None:
            record = json.loads(args.recovery_record.read_text(encoding="utf-8"))
            if not isinstance(record, dict):
                raise RiskGateError("historical recovery record is unreadable")
        result = qualify_automatic_route(
            main_sha=args.main_sha, allowlist=normalize_review_allowlist(args.allowlist),
            source_pr=args.pr, recovery_record=record, repo_root=args.repo.resolve(),
            api=gh_json, downloader=download_artifact,
        )
    except Exception as exc:  # noqa: BLE001 - any failure refuses dispatch
        print(f"::error::ENGINEER ACTION REQUIRED: automatic qualification found no evidence route "
              f"the production gate accepts: {type(exc).__name__}: {exc}. Nothing was dispatched.", file=sys.stderr)
        return 2
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "qualify-route":
        raise SystemExit(qualify_route_main(sys.argv[2:]))
    raise SystemExit(main())
