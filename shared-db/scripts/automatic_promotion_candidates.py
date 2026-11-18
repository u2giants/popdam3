#!/usr/bin/env python3
"""Start automatic production promotion for merged migration PRs (#2075).

popcre/ai-devops plan_skinny-review.md rule 8.6: no session or person starts
production promotion. This runs on every push to main that touches migrations
and hourly as a backstop. For the oldest merged PR (merged after ACTIVATED_AT)
whose migrations have no successful production apply yet, it dispatches the
existing post-merge preview rehearsal (`merged_preview_source_pr`, mode apply).
That run's `automatic-production-promotion` job then qualifies and dispatches
the production apply, which re-checks the review-finding hold immediately
before applying.

A PR held by a blocking review finding holds back only its own migrations:
the selector moves past it to the next merged PR, still oldest first (#5457
froze every release for hours on one finding). It waits while a migration
workflow run is in flight (one dispatch at a time). A PR out of automatic
attempts is passed over the same way, with a loud ENGINEER ACTION REQUIRED
alert, so one dead PR cannot park every later promotion (#5532). A PR held
longer than ALERT_AFTER is reported as a loud advisory annotation instead of
skipping silently. Advisory findings (holds, exhausted attempts, re-runs) are
annotations, never exit status: this step starts the next promotion and a red
run must mean the selector itself broke, not that findings exist (queue-hygiene
idiom; #5558: an unactionable red hides real alerts). It never writes a
database.

Known cross-PR derivation bases wait for production evidence before a child
consumes attempts (#5608/#5651). Canonical declared_bases resolves historical
exceptions exactly as the production guard does. Unknown bases remain that
guard's responsibility; independent releases continue past waiting children.
Dependency evidence is memoized only within one decide call; the final fresh
recheck reads it again. Unreadable receipts remain unproved.

    automatic_promotion_candidates.py [--dry-run]
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import review_finding_hold
from migration_derivation import declared_bases
from production_migration_guard import FOREIGN_TARGET_MIGRATIONS, HARD_BLOCKED

ACTIVATED_AT = "2026-10-29T23:00:00Z"
WORKFLOW = "shared-supabase-migrations.yml"
# The runs API stamps every run with its workflow path; a run of someone else's
# experiment is never evidence for this lane (plan §9 2.4 trust boundary).
WORKFLOW_PATH = f".github/workflows/{WORKFLOW}"
MIGRATION_RE = re.compile(r"^supabase/migrations/(\d{14})_[^/]+\.sql$")
MAX_ATTEMPTS = 3
# Refund cap (plan §9 2.3, default from §8): a change is never parked by other
# people's breakage, but persistently broken infrastructure must surface as
# ENGINEER ACTION REQUIRED — at most MAX_REFUNDS classified failures per change
# since merge are refunded, and the refund that finds the cap exhausted parks
# the change with "3 refunds used, now parked" (unbounded is not acceptable).
MAX_REFUNDS = 3
# The workflow's fault-classification marker step (plan §9 2.1). A succeeded
# step of exactly this name in any attempt marks the run refund-eligible.
REFUND_STEP = "refund-eligible-fault"
ALERT_AFTER = timedelta(minutes=30)
# #5937 deadline ordering: a migration may declare `-- promote-by: <UTC ISO
# timestamp>` (e.g. `-- promote-by: 2026-11-07T03:00:00Z`) in its file. Eligible
# candidates promote earliest deadline first, then merge order.
PROMOTE_BY_RE = re.compile(r"^--\s*promote-by:\s*(\S+)\s*$", re.MULTILINE | re.IGNORECASE)
# #5937 backstop: after this many consecutive main-moved refusals of the SAME
# change, the selector freezes merges for BACKSTOP_FREEZE_TTL_MINUTES before
# re-dispatching, so the rehearsal can finish against an unmoving main.
BACKSTOP_AFTER_STALE = 2
BACKSTOP_FREEZE_TTL_MINUTES = 15
BACKSTOP_FREEZE_OWNER = "automatic-promotion-backstop"
HERE = os.path.dirname(os.path.abspath(__file__))


def gh(*args: str) -> Any:
    # Read-only GitHub API calls. One transient API error used to abort the whole
    # selector and stall the promotion queue (2026-11-12, runs 43313401779 and
    # 43315145424), so retry a bounded number of times before failing closed.
    for attempt in range(3):
        try:
            out = subprocess.run(["gh", "api", *args], check=True, stdout=subprocess.PIPE, text=True, encoding="utf-8").stdout
            return json.loads(out) if out.strip() else None
        except subprocess.CalledProcessError:
            if attempt == 2:
                raise
            time.sleep(5 * (attempt + 1))


def registered_orphan_versions() -> set[str]:
    """Orphan versions pinned by the reviewed preview-ledger reconciliation manifest."""
    path = os.path.join(os.path.dirname(HERE), "config", "preview-ledger-orphan-reconciliations.json")
    try:
        with open(path, encoding="utf-8") as fh:
            cases = json.load(fh).get("cases", [])
        return {c.get("orphan_version") for c in cases if c.get("orphan_version")}
    except (OSError, ValueError):
        return set()


def promote_by(path: str) -> str | None:
    """The file's `-- promote-by:` deadline as a canonical UTC string, or None.
    A malformed header is warned about and ignored (never blocks promotion)."""
    try:
        with open(path, encoding="utf-8") as fh:
            match = PROMOTE_BY_RE.search(fh.read())
    except OSError:
        return None
    if not match:
        return None
    try:
        at = datetime.fromisoformat(match.group(1).replace("Z", "+00:00"))
    except ValueError:
        at = None
    if at is None or at.tzinfo is None:
        print(f"::warning::{os.path.basename(path)}: ignoring malformed promote-by {match.group(1)!r} (need UTC ISO timestamp)")
        return None
    return at.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def candidate_order(pr: dict[str, Any]) -> tuple[int, str, str]:
    """Earliest declared deadline first, then merge order (#5937)."""
    deadline = pr.get("promote_by")
    return (0 if deadline else 1, deadline or "", pr["merged_at"])


# #6493 Step 1b: the per-PR files reads (one API call for each of ~650 merged
# PRs) were most of the selector's 7-12 minutes. A merged PR's merged_at and
# files never change, so those API facts are cached in actions/cache and only
# PRs merged since the cache's watermark (minus an overlap window) are listed.
# DISCOVERY ONLY: versions, dependencies, deadlines, holds, attempts and the
# ledger are recomputed or re-read on every run; nothing safety-relevant is
# taken from the cache. A missing, corrupt or old-schema cache is a full scan.
PR_CACHE_SCHEMA = 1
PR_CACHE_OVERLAP = timedelta(hours=1)


def load_pr_cache(path: str | None) -> dict[str, dict[str, Any]] | None:
    if not path or not os.path.exists(path):
        return None
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
        if (not isinstance(data, dict) or data.get("schema_version") != PR_CACHE_SCHEMA
                or data.get("activated_at") != ACTIVATED_AT or not isinstance(data.get("prs"), dict)
                or not data["prs"]):
            raise ValueError("schema mismatch")
        for number, row in data["prs"].items():
            if (not number.isdigit() or not isinstance(row, dict) or not isinstance(row.get("merged_at"), str)
                    or not isinstance(row.get("files"), list)
                    or not all(isinstance(f, dict) and isinstance(f.get("filename"), str)
                               and isinstance(f.get("status"), str) for f in row["files"])):
                raise ValueError(f"malformed row for PR {number}")
        return data["prs"]
    except (OSError, ValueError) as exc:
        print(f"::warning::selector PR cache unusable ({exc}); doing a full scan")
        return None


def save_pr_cache(path: str | None, prs: dict[str, dict[str, Any]]) -> None:
    if not path:
        return
    try:
        tmp = f"{path}.tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump({"schema_version": PR_CACHE_SCHEMA, "activated_at": ACTIVATED_AT, "prs": prs}, fh)
        os.replace(tmp, path)
    except OSError as exc:
        print(f"::warning::could not write the selector PR cache ({exc}); next run is a full scan")


def closed_pull_pages(repo: str, since: str | None) -> list[Any]:
    """Closed PR pages, newest update first. With `since`, stop after the page
    that reaches PRs last updated before it: a PR merged later was updated no
    earlier than its merge, so it sits on an earlier page."""
    url = f"repos/{repo}/pulls?state=closed&base=main&sort=updated&direction=desc&per_page=100"
    if since is None:
        return gh("--paginate", "--slurp", url)
    pages, page = [], 1
    while True:
        batch = gh(f"{url}&page={page}")
        pages.append(batch)
        if not isinstance(batch, list) or len(batch) < 100 or any(
                isinstance(pr, dict) and (pr.get("updated_at") or "") < since for pr in batch):
            return pages
        page += 1


def merged_migration_prs(repo: str) -> list[dict[str, Any]]:
    # Old unpromoted sources must survive unrelated PR activity (#5608).
    # gh fails the whole request on a failed later page; validate every page
    # before inspecting files, so incomplete discovery cannot dispatch a child.
    cache_path = os.environ.get("PROMOTION_PR_CACHE_FILE")
    cached = load_pr_cache(cache_path)
    since = None
    if cached:
        watermark = _time(max(row["merged_at"] for row in cached.values()))
        since = (watermark - PR_CACHE_OVERLAP).strftime("%Y-%m-%dT%H:%M:%SZ")
    pages = closed_pull_pages(repo, since)
    if not isinstance(pages, list) or not pages:
        raise ValueError("incomplete pull request discovery")
    unique = {}
    for page in pages:
        if not isinstance(page, list):
            raise ValueError("malformed pull request discovery page")
        for pr in page:
            if (not isinstance(pr, dict) or type(pr.get("number")) is not int
                    or pr["number"] <= 0 or "merged_at" not in pr
                    or pr["merged_at"] is not None and not isinstance(pr["merged_at"], str)):
                raise ValueError("malformed pull request discovery row")
            previous = unique.get(pr["number"])
            if previous is not None and previous["merged_at"] != pr["merged_at"]:
                raise ValueError("conflicting duplicate pull request discovery")
            unique[pr["number"]] = pr
    # Cached merged PRs older than the incremental window; a live row always wins.
    for number, row in (cached or {}).items():
        unique.setdefault(int(number), {"number": int(number), "merged_at": row["merged_at"]})
    pulls = unique.values()
    manifest_orphans = registered_orphan_versions()
    found = []
    fresh_cache: dict[str, dict[str, Any]] = {}
    for pr in pulls:
        merged = pr.get("merged_at")
        if not merged or merged <= ACTIVATED_AT:
            continue
        row = (cached or {}).get(str(pr["number"]))
        if row is not None and row["merged_at"] == merged:
            files = [row["files"]]
        else:
            files = gh("--paginate", "--slurp", f"repos/{repo}/pulls/{pr['number']}/files?per_page=100")
        fresh_cache[str(pr["number"])] = {"merged_at": merged, "files": [
            {"filename": f.get("filename", ""), "status": f.get("status", "")}
            for page in files for f in page if (f.get("filename") or "").startswith("supabase/migrations/")]}
        versions = sorted(
            m.group(1)
            for page in files for f in page
            # "renamed" matters as much as "added": a pure version rename (the
            # documented cure when a change exhausts its automatic attempts)
            # shows up on the files API as a rename, and the version to promote
            # is the NEW filename's. Observed 2026-11-06: PR #5830's byte-identical
            # renames were invisible to the lane, which idled claiming every PR
            # was in production while the renamed versions sat unpromoted.
            if f.get("status") in ("added", "renamed") and (m := MIGRATION_RE.match(f.get("filename", "")))
            # A version registered for another database (#5504: the DesignFlow
            # sandbox) never reaches production; promoting it would only fail
            # until MAX_ATTEMPTS parks the lane.
            and m.group(1) not in FOREIGN_TARGET_MIGRATIONS
            # A preserved retired original must never be re-dispatched by the
            # automatic queue after its review finding is resolved.
            and m.group(1) not in HARD_BLOCKED
            # A version later deleted from main can never apply: the workflow
            # refuses it as unknown until MAX_ATTEMPTS alerts, again on every
            # new main commit (#5558: PR #5548, replaced by PR #5552).
            and version_on_main(m.group(1))
        )
        # Superseded-by-manifest (#5128/#5213): a merged PR whose every added
        # version is a registered preview-ledger orphan (a governed replacement
        # version carries the change in config/preview-ledger-orphan-reconciliations.json)
        # can never be promoted -- its attempt counter would otherwise park the
        # lane forever once MAX_ATTEMPTS failed preview applies accumulate
        # (observed 2026-10-31: PR #5129 vs stranded 20261030125352).
        if versions and not all(v in manifest_orphans for v in versions):
            found.append({"number": pr["number"], "merged_at": merged, "versions": versions})
    owners = {v: pr["number"] for pr in found for v in pr["versions"]}
    for pr in found:
        bases = set()
        deadlines = []
        for version in pr["versions"]:
            paths = glob.glob(os.path.join(os.path.dirname(HERE), "supabase", "migrations", f"{version}_*.sql"))
            if len(paths) != 1:
                raise ValueError(f"ambiguous migration source for {version}")
            bases.update(declared_bases(version, path=Path(paths[0])) or ())
            if deadline := promote_by(paths[0]):
                deadlines.append(deadline)
        if deadlines:
            pr["promote_by"] = min(deadlines)
        # Retain ownership on the candidate itself: the final fresh recheck only
        # receives this PR, not the complete earlier candidate list.
        pr["production_dependencies"] = {v: owners[v] for v in sorted(bases)
                                         if v in owners and owners[v] != pr["number"]}
    if fresh_cache:
        save_pr_cache(cache_path, fresh_cache)
    return sorted(found, key=candidate_order)


# #6493 Step 1c: workflow-run cache. One full paginated read cost ~18-25 s and
# ran three times per dispatching cycle plus once in index maintenance. A run
# snapshot (this process's last read, else PROMOTION_RUN_CACHE_FILE restored
# by actions/cache, within RUN_CACHE_TTL) is refreshed instead of re-read:
#   - every run created since the snapshot (minus an overlap) is re-read;
#   - every run the snapshot holds as not completed is re-read by id;
#   - every run GitHub reports in flight right now is re-read (a re-run of an
#     old completed run turns queued/in_progress again).
# Only completed runs older than the overlap come from the snapshot, and only
# for discovery: the pre-dispatch recheck passes `fresh_since` (the candidate's
# and its dependencies' merge time), so every run that can count an attempt or
# prove dependency evidence for the chosen PR is re-read at dispatch time.
# Any refresh failure, or a missing/corrupt/expired cache, is a full read.
RUN_CACHE_SCHEMA = 1
RUN_CACHE_TTL = timedelta(hours=6)
RUN_CACHE_OVERLAP = timedelta(minutes=10)
IN_FLIGHT = ("queued", "in_progress", "waiting", "requested", "pending")
_RUN_SNAPSHOT: dict[str, Any] | None = None


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _runs_url(repo: str, extra: str = "") -> str:
    return f"repos/{repo}/actions/workflows/{WORKFLOW}/runs?event=workflow_dispatch&per_page=100{extra}"


def _paged_runs(repo: str, extra: str) -> list[dict[str, Any]]:
    pages = gh("--paginate", "--slurp", _runs_url(repo, extra))
    return [run for page in pages for run in page.get("workflow_runs", [])]


def _valid_run(run: Any) -> bool:
    return (isinstance(run, dict) and type(run.get("id")) is int and isinstance(run.get("status"), str)
            and isinstance(run.get("created_at"), str))


def load_run_cache(path: str | None, now: datetime) -> dict[str, Any] | None:
    if not path or not os.path.exists(path):
        return None
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
        if (not isinstance(data, dict) or data.get("schema_version") != RUN_CACHE_SCHEMA
                or data.get("activated_at") != ACTIVATED_AT or not isinstance(data.get("read_at"), str)
                or not isinstance(data.get("runs"), list) or not all(_valid_run(r) for r in data["runs"])):
            raise ValueError("schema mismatch")
        age = now - _time(data["read_at"])
        if age > RUN_CACHE_TTL or age < -RUN_CACHE_OVERLAP:
            print(f"selector run cache expired ({int(age.total_seconds() // 60)} min old); doing a full read")
            return None
        return data
    except (OSError, ValueError) as exc:
        print(f"::warning::selector run cache unusable ({exc}); doing a full read")
        return None


def save_run_cache(path: str | None, snapshot: dict[str, Any]) -> None:
    if not path:
        return
    try:
        tmp = f"{path}.tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump({"schema_version": RUN_CACHE_SCHEMA, "activated_at": ACTIVATED_AT, **snapshot}, fh)
        os.replace(tmp, path)
    except OSError as exc:
        print(f"::warning::could not write the selector run cache ({exc}); next run is a full read")


def refresh_runs(repo: str, base: dict[str, Any], fresh_since: str | None) -> list[dict[str, Any]]:
    floor = (_time(base["read_at"]) - RUN_CACHE_OVERLAP).strftime("%Y-%m-%dT%H:%M:%SZ")
    if fresh_since and fresh_since < floor:
        floor = fresh_since
    merged = {r["id"]: r for r in base["runs"]}
    stale_ids = [r["id"] for r in base["runs"] if r["status"] != "completed"]
    reads = [lambda: _paged_runs(repo, f"&created=>={floor}")]
    reads += [lambda s=s: _paged_runs(repo, f"&status={s}") for s in IN_FLIGHT]
    reads += [lambda i=i: [gh(f"repos/{repo}/actions/runs/{i}")] for i in stale_ids]
    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(lambda read: read(), reads))
    for batch in results:
        for run in batch:
            if not _valid_run(run):
                raise ValueError("malformed refreshed workflow run")
            merged[run["id"]] = run
    print(f"workflow runs: refreshed {len(results[0])} since {floor}, {len(stale_ids)} non-terminal by id, "
          f"{sum(len(b) for b in results[1:1 + len(IN_FLIGHT)])} in flight; {len(merged)} total")
    return list(merged.values())


def workflow_runs(repo: str, fresh_since: str | None = None) -> list[dict[str, Any]]:
    # Every page: a PR's old production success must not age out of the window,
    # or the lane re-promotes it and parks on it (observed 2026-11-01: PR #5045).
    global _RUN_SNAPSHOT
    now = _utcnow()
    path = os.environ.get("PROMOTION_RUN_CACHE_FILE")
    base = _RUN_SNAPSHOT or load_run_cache(path, now)
    runs = None
    if base is not None:
        try:
            runs = refresh_runs(repo, base, fresh_since)
        except (subprocess.CalledProcessError, ValueError, TypeError, KeyError, AttributeError) as exc:
            print(f"::warning::workflow run refresh failed ({exc}); doing a full read")
    if runs is None:
        runs = _paged_runs(repo, f"&created=>={ACTIVATED_AT[:10]}")
    if all(_valid_run(r) for r in runs):
        runs.sort(key=lambda r: (r["created_at"], r["id"]), reverse=True)
        _RUN_SNAPSHOT = {"read_at": now.strftime("%Y-%m-%dT%H:%M:%SZ"), "runs": runs}
        save_run_cache(path, _RUN_SNAPSHOT)
    else:
        # Rows the cache cannot key or age are never cached; the next read is full.
        print("::warning::workflow run rows lack id/status/created_at; not caching this read")
        _RUN_SNAPSHOT = None
    return drop_ghost_runs(runs, lambda run: len(run_jobs(repo, run["id"])))


# A ghost run (docs/ghost-run-escape.md, #6426) is a run record GitHub created
# but never dispatched: queued past the dispatch grace with no job ever
# created; cancel and delete are refused. It can never run, so counting it as
# "queued" parked the whole production lane (2026-11-16: run 43938147152 held
# PR #6490). Same definition and 30-minute floor as the lane watchdog sweep.
GHOST_MIN_AGE = timedelta(minutes=30)


def drop_ghost_runs(runs: list[dict[str, Any]], jobs_count: callable,
                    now: datetime | None = None) -> list[dict[str, Any]]:
    now = now or datetime.now(timezone.utc)
    kept = []
    for run in runs:
        created = run.get("created_at") or ""
        if run.get("status") == "queued" and created:
            age = now - datetime.fromisoformat(created.replace("Z", "+00:00"))
            if age >= GHOST_MIN_AGE and jobs_count(run) == 0:
                print(f"ghost: ignoring run {run.get('id')} (queued {int(age.total_seconds() // 60)}m, no jobs)")
                continue
        kept.append(run)
    return kept


# A production apply whose atomic apply step succeeded has written its
# versions to the ledger; whatever fails afterwards cannot un-write them.
# The post-apply catalog check verifies what was written — when it alone
# fails the versions are still there (observed 2026-10-31: PR #5104, a
# pure-data load the catalog lexer cannot read) — and the same holds for any
# later evidence step (observed 2026-11-11: run 43094471144 applied
# 20261111183827 with a clean catalog check, then failed only `Save apply
# evidence` on the GitHub artifact-upload outage, and the selector reported
# the live version "not live" and exhausted its attempts, refiring the
# stuck-change alarm (#6119)). The signature is judged PER ATTEMPT and ANY
# attempt suffices: a re-run must not erase the attempt that wrote the
# versions (2026-11-03: run 41545991868 attempt 1 applied 20261102202014 and
# failed only its catalog check; a re-run replaced the step signature and the
# selector retried an already-applied PR into ENGINEER ACTION REQUIRED).
APPLY_STEP = "Fresh dry-run, then apply"
CATALOG_STEP = "Post-apply catalog verification"


def applied_in_attempt(jobs: list[dict[str, Any]]) -> bool:
    """True when this attempt's apply step succeeded — the versions are in
    production however the rest of the run ended (the catalog check, the
    evidence upload, the refund classifier)."""
    steps = [s for j in jobs for s in j.get("steps") or []]
    return any(s.get("name") == APPLY_STEP and s.get("conclusion") == "success" for s in steps)


def run_jobs(repo: str, run_id: int, attempt: int | None = None) -> list[dict[str, Any]]:
    suffix = f"/attempts/{attempt}" if attempt is not None else ""
    return gh(f"repos/{repo}/actions/runs/{run_id}{suffix}/jobs?per_page=100").get("jobs", [])


def attempt_jobs(repo: str, run: dict[str, Any]) -> list[list[dict[str, Any]]]:
    """One job list per attempt. The runs endpoint lists only the LATEST
    attempt, so a re-run hides what earlier attempts did."""
    return [run_jobs(repo, run["id"], a) for a in range(1, int(run.get("run_attempt") or 1) + 1)]


def applied_in_any_attempt(repo: str, run: dict[str, Any]) -> bool:
    return any(applied_in_attempt(jobs) for jobs in attempt_jobs(repo, run))


def preview_job_succeeded_in_any_attempt(repo: str, run: dict[str, Any]) -> bool:
    return any(any(j.get("name") == "preview" and j.get("conclusion") == "success" for j in jobs)
               for jobs in attempt_jobs(repo, run))


# The production guard reads the real ledger and prints this when a version is
# already there. It is the only ledger evidence the selector can see: this job
# holds no database credential (observed 2026-11-03: PR #5494 reached production
# under no run titled with its version, and was re-picked on every new main commit).
PREFLIGHT_STEP = "Hard guard preflight"
REFUSED_RE = re.compile(r"(?:^|\t)\S+ BLOCKED: already applied on production: (\d{14}(?:, \d{14})*)\r?$", re.M)


def refused_versions(log: str) -> set[str]:
    return {v for m in REFUSED_RE.finditer(log) for v in m.group(1).split(", ")}


def refused_as_applied(repo: str, run: dict[str, Any]) -> set[str]:
    """Versions this run's production preflight refused as already applied. An
    unreadable log proves nothing: the PR is retried and the guard refuses again."""
    found: set[str] = set()
    try:
        for job in (j for jobs in attempt_jobs(repo, run) for j in jobs):
            if any(s.get("name") == PREFLIGHT_STEP and s.get("conclusion") == "failure" for s in job.get("steps") or []):
                found |= refused_versions(subprocess.run(
                    ["gh", "run", "view", "--repo", repo, "--job", str(job["id"]), "--log-failed"],
                    check=True, stdout=subprocess.PIPE, text=True, encoding="utf-8", errors="replace").stdout)
    except (subprocess.CalledProcessError, ValueError, OSError) as exc:
        print(f"::warning::reading production run {run['id']} failed ({exc}); treating its versions as not applied")
    return found


# Coordination steps that prove the dispatched commit against the live main tip
# BEFORE any database work. A run failing only here was refused for main-SHA
# staleness and never touched a database (#5856); ordinary merge traffic moves
# main every few minutes and re-dispatch against the new tip is the cure, so
# counting such runs consumed MAX_ATTEMPTS until healthy changes were parked
# and forced into a re-version.
COORDINATION_STEPS = {
    "Prove the post-merge rehearsal source",
    "Prove historical preview recovery source",
    "Acquire the exclusive GitHub-backed preview lane",
    "Re-prove current main and the merged source PR",
    "Acquire the exclusive production lane and freeze merges",
    "Verify exact main commit while holding the production lane",
    # production-dry-run and production-apply-review re-prove the tip under
    # this shorter name before any credential or psql step (#6237).
    "Verify exact main commit",
    # Another PR's qualification already holds the promotion freeze (#6258:
    # PR #6245 parked on three such refusals); retrying later is the cure.
    "Acquire the promotion merge freeze for this source PR",
    # #6340 exit-path cleanup of the freeze. With continue-on-error their red
    # conclusion can join the failing set of the run they clean up after (a
    # refused acquire, whose freeze wording is the staleness proof).
    "Release the promotion merge freeze when nothing was dispatched",
    "Release the promotion merge freeze when this production run ends",
}
# Runtime wording of a staleness refusal. None of these phrases appears in the
# workflow's echoed shell source (tests enforce it), so a match is the refusal
# itself and not a guard's quoted error text. "##[error]" is the rendered
# annotation; the echoed source always spells it "::error::".
STALE_MAIN_RE = re.compile(
    r"has moved past the dispatched commit"
    r"|has advanced past the dispatched commit"
    r"|does not contain the dispatched commit"
    r"|requires the exact current main SHA"
    r"|a promotion merge freeze is already set"
    r"|##\[error\]ENGINEER ACTION REQUIRED: main moved after preview")
ANSI_RE = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")
# #6574: a refusal that no retry can cure. The preview evidence was made by a
# different apply-shaping producer than the gate pins to, and the change is
# high-risk, so no evidence route exists. Retrying burns the lane (PR #6433:
# 7 runs, 2026-11-17 13:07-14:07 UTC).
PERMANENT_REFUSAL_RE = re.compile(
    r"ENGINEER ACTION REQUIRED: automatic qualification found no evidence route"
    r".*produced evidence with (?:a different \S+ than|\S+ (?:present|absent) where)"
    r".*high-risk to live data")


def stale_main_refusal_only(repo: str, run: dict[str, Any]) -> bool:
    """True when every failure in this run is a main-SHA staleness refusal at a
    coordination step (#5856). An apply or guard failure, any other refusal
    wording, or unreadable evidence still counts as an attempt."""
    failed: set[str] = set()
    refused_jobs: list[dict[str, Any]] = []
    try:
        for jobs in attempt_jobs(repo, run):
            for job in jobs:
                # The `if: failure()` fault marker only reacts to the real
                # failure; its own red conclusion (change fault or annotation
                # lag) must not hide a staleness refusal (#6237).
                bad = [s for s in job.get("steps") or []
                       if s.get("conclusion") == "failure" and s.get("name") != REFUND_STEP]
                if bad:
                    refused_jobs.append(job)
                    failed.update(s.get("name") for s in bad)
    except (subprocess.CalledProcessError, ValueError, OSError):
        return False
    if not failed or not failed <= COORDINATION_STEPS:
        return False
    try:
        logs = "".join(subprocess.run(
            ["gh", "run", "view", "--repo", repo, "--job", str(job["id"]), "--log-failed"],
            check=True, stdout=subprocess.PIPE, text=True, encoding="utf-8", errors="replace").stdout
            for job in refused_jobs)
    except (subprocess.CalledProcessError, ValueError, OSError):
        return False
    return bool(STALE_MAIN_RE.search(ANSI_RE.sub("", logs)))


def permanent_refusal(repo: str, run: dict[str, Any]) -> bool:
    """True when a failed job of this run logged a permanent producer-mismatch
    refusal on a high-risk change (#6574). Any read error returns False, so the
    run counts as an ordinary attempt (fail safe)."""
    try:
        refused_jobs = [job for jobs in attempt_jobs(repo, run) for job in jobs
                        if any(s.get("conclusion") == "failure" for s in job.get("steps") or [])]
        logs = "".join(subprocess.run(
            ["gh", "run", "view", "--repo", repo, "--job", str(job["id"]), "--log-failed"],
            check=True, stdout=subprocess.PIPE, text=True, encoding="utf-8", errors="replace").stdout
            for job in refused_jobs)
    except (subprocess.CalledProcessError, ValueError, OSError, KeyError, TypeError):
        return False
    return any(PERMANENT_REFUSAL_RE.search(line) for line in ANSI_RE.sub("", logs).splitlines())


def our_workflow(run: dict[str, Any]) -> bool:
    """A run is ours only when the API says so (or is silent about it). Titles are
    forgeable by anyone who can dispatch a workflow (plan §9 2.4: a run titled
    `DB preview apply …` from someone else's experiment must never count)."""
    path = run.get("path")
    return not path or path == WORKFLOW_PATH


def refund_eligible_in_any_attempt(repo: str, run: dict[str, Any]) -> bool:
    """True when any attempt carries a succeeded `refund-eligible-fault` marker
    step (plan §9 2.1/2.2). Judged PER ATTEMPT and ANY attempt suffices: a re-run
    must not hide an earlier attempt's classification (the same rule as
    `applied_in_any_attempt`). The marker step is emitted only by our own
    workflow, so this is forgable only by compromising the workflow itself."""
    try:
        return any(
            any(s.get("name") == REFUND_STEP and s.get("conclusion") == "success"
                for job in jobs for s in (job.get("steps") or []))
            for jobs in attempt_jobs(repo, run))
    except (subprocess.CalledProcessError, ValueError, OSError) as exc:
        # Fail safe: an unreadable marker never refunds (the status quo keeps
        # counting the run) and the reason is named for the log reader.
        print(f"::warning::reading refund marker of run {run.get('id')} failed ({exc}); treating as a change fault")
        return False


def names_pr(pr: dict[str, Any], title: str) -> bool:
    """True when the run title names every migration version this PR authored.
    Recovery runs title themselves "PR " with no number, so match the versions;
    several versions are one comma-joined word in the title."""
    words = {v for word in title.split() for v in word.split(",")}
    return all(v in words for v in pr["versions"])


def title_versions(title: str) -> set[str]:
    return {v for word in title.split() for v in word.split(",") if re.fullmatch(r"\d{14}", v)}


def memoised_evidence(fn: callable) -> callable:
    """Wrap one run-evidence callable (applied, refused, stale, refunded) so a
    selector pass reads each run's evidence once, keyed by (run id, run attempt)
    (plan_promotion_stranding_watch.md R3). Exceptions are not cached: the next
    caller reads again and handles the failure as it always has."""
    cache: dict[tuple[Any, Any], Any] = {}

    def wrapped(run):
        key = (run.get("id", id(run)), run.get("run_attempt", 1))
        if key not in cache:
            cache[key] = fn(run)
        return cache[key]
    return wrapped


def dependency_evidence_reader(applied: callable, refused: callable) -> callable:
    """Per-pass reader of a failed production run's dependency receipt:
    (actually applied, versions refused as already applied). Unreadable evidence
    is unproved, never fatal (#5651)."""
    receipts: dict[tuple[Any, Any], tuple[bool, set[str]]] = {}

    def read(run):
        key = (run.get("id", id(run)), run.get("run_attempt", 1))
        if key not in receipts:
            actual_apply, already_applied = False, set()
            try:
                actual_apply = applied(run)
            except (OSError, ValueError, subprocess.CalledProcessError):
                print("::warning::dependency apply evidence unreadable; treating this receipt as unproved")
            try:
                already_applied = set(refused(run))
            except (OSError, ValueError, subprocess.CalledProcessError):
                print("::warning::dependency ledger refusal evidence unreadable; treating this receipt as unproved")
            receipts[key] = (actual_apply, already_applied)
        return receipts[key]
    return read


def classify_pr(pr: dict[str, Any], runs: list[dict[str, Any]], held: callable,
                applied: callable, refused: callable, stale: callable,
                refunded: callable, live: set[str] | None,
                dependency_evidence: callable,
                permanent: callable = lambda run: False) -> tuple[str, dict[str, Any]]:
    """Classify one candidate PR against this pass's evidence; the single source
    of per-PR status shared by decide() and the stranded-PR reconciler
    (plan_promotion_stranding_watch.md R3). `runs` must already be filtered to
    our workflow. Returns (kind, detail):

    - ("delivered", {})                            versions already in production
    - ("held", {"findings": [...]})                blocking review findings
    - ("unknown-hold", {"findings": []})           finding read failed; held, findings unknown
    - ("waiting-on-dependency", {"pending_dependencies": {...}})
    - ("parked", {"exhausted": n, "refunds": n, "permanent": bool})
                                                   out of attempts or refunds, or a
                                                   permanent refusal (#6574)
    - ("dispatchable", {"stale_streak": n})
    """
    # #6352: the production ledger is the final word. Versions already applied
    # (by any route) are delivered; retrying them only burns attempts and
    # fails "already applied on preview", parking every later change.
    if live and pr.get("versions") and set(pr["versions"]) <= live:
        print(f"skip: PR #{pr['number']} versions {','.join(pr['versions'])} already in the production ledger")
        return "delivered", {}
    tag = f"PR{pr['number']} "
    titles = [(r.get("display_title") or "") + " " for r in runs]
    prod = [r for t, r in zip(titles, runs) if t.startswith("DB production apply") and tag in t]
    if any(r.get("conclusion") == "success" for r in prod):
        print(f"skip: PR #{pr['number']} has a successful production apply")
        return "delivered", {}
    if any(r.get("conclusion") == "failure" and applied(r) for r in prod):
        print(f"skip: PR #{pr['number']} applied; a later post-apply step failed")
        return "delivered", {}
    wanted = set(pr["versions"])
    in_production: set[str] = set()
    for t, r in zip(titles, runs):
        if not t.startswith("DB production apply") or not (named := title_versions(t)) & wanted:
            continue
        if r.get("conclusion") == "success":
            in_production |= named
        elif r.get("conclusion") == "failure":
            in_production |= refused(r)
        if wanted <= in_production:
            break
    if wanted <= in_production:
        print(f"skip: PR #{pr['number']} versions {','.join(pr['versions'])} already in production via another run")
        return "delivered", {}
    findings = held(pr["number"])
    if findings:
        if isinstance(findings, list):
            return "held", {"findings": findings}
        return "unknown-hold", {"findings": []}
    dependencies = pr.get("production_dependencies", {})
    proven_bases = set()
    for title, run in zip(titles, runs):
        if not title.startswith("DB production apply") or not (named := title_versions(title)) & dependencies.keys():
            continue
        if run.get("conclusion") == "success":
            proven_bases |= named
        elif run.get("conclusion") == "failure":
            actual_apply, already_applied = dependency_evidence(run)
            if actual_apply:
                proven_bases |= named
            proven_bases |= already_applied
    missing_bases = {v: owner for v, owner in dependencies.items() if v not in proven_bases}
    if missing_bases:
        return "waiting-on-dependency", {"pending_dependencies": missing_bases}
    # Attempts count per change since its merge, NOT per main commit (#5683/#5686,
    # Nov 5 2026): resetting on every main advance let one stuck change be retried
    # after each unrelated merge and starve every later promotion. A cure for a stuck
    # change is a new governed version, which is a new candidate. The WHOLE automatic cycle counts, not only preview applies (#5532): a failed
    # production apply re-enters through a historical recovery preview that succeeds
    # by design, so counting only preview failures could never bound that loop. A
    # recovery run titles itself "PR " with no number, hence the version match.
    # CLASSIFIED failures (plan §9 2.1–2.3): a pure main-SHA staleness refusal
    # never touched a database (#5856) and a run marked refund-eligible-fault
    # is an infrastructure/coordination fault, not the change's — neither burns
    # an attempt while this change's refund budget (MAX_REFUNDS) lasts. The
    # classified failure that finds the budget empty parks the change, and so
    # does the MAX_ATTEMPTS-th ordinary (unclassified) failure, exactly as
    # before. Per-attempt evidence (applied / refused / preview) is unaffected.
    failures = [r for t, r in zip(titles, runs)
                if (t.startswith("DB preview apply") or t.startswith("DB production apply"))
                and (tag in t or names_pr(pr, t))
                and r.get("created_at", "") > pr["merged_at"]
                and r.get("conclusion") != "success"]
    attempts, refunds, refund_parked, stale_streak = 0, 0, False, 0
    permanent_hit = False
    for failure in sorted(failures, key=lambda r: r.get("created_at", "")):
        # #6574: a permanent refusal cannot be cured by a retry; park on this
        # first run instead of spending the remaining attempts.
        if permanent(failure):
            attempts, permanent_hit = MAX_ATTEMPTS, True
            break
        # #5937: a main-moved refusal never touched a database and is caused
        # by other people's merges -- it counts neither attempt nor refund.
        if stale(failure):
            stale_streak += 1
            continue
        stale_streak = 0
        if refunded(failure):
            if refunds >= MAX_REFUNDS:
                refund_parked = True
                break
            refunds += 1
        else:
            attempts += 1
            if attempts >= MAX_ATTEMPTS:
                break
    if attempts >= MAX_ATTEMPTS or refund_parked:
        return "parked", {"exhausted": attempts, "refunds": refunds, "permanent": permanent_hit}
    return "dispatchable", {"stale_streak": stale_streak}


def decide(prs: list[dict[str, Any]], runs: list[dict[str, Any]], held: callable,
           applied: callable = lambda run: False, main_sha: str = "",
           skipped: list[dict[str, Any]] | None = None,
           refused: callable = lambda run: set(),
           stale: callable = lambda run: False,
           refunded: callable = lambda run: False,
           live: set[str] | None = None,
           permanent: callable = lambda run: False) -> tuple[str, dict[str, Any] | None, str]:
    """Return (action, pr, reason); action is dispatch, wait or idle. Held PRs
    and PRs out of automatic attempts are passed over and appended to `skipped`
    (the latter carry an `exhausted` count instead of `findings`). A PR whose
    versions are all in production is done, whichever run put them there: a
    successful run naming them (a follow-up PR's included) or a production
    preflight that `refused` them as already applied. Known cross-PR bases
    (#5608/#5651) require the same trustworthy production evidence before a
    child consumes attempts; dependency waits preserve independent progress.
    Dependency receipts are cached only for this call, never the fresh recheck.
    A run `stale` reports as a pure main-SHA staleness refusal never touched a
    database and consumes no attempt (#5856). A run `refunded` carries the
    workflow's refund-eligible marker (plan §9 2.1/2.2). A `stale` run costs
    nothing at all (#5937: other people's merges say nothing about the change);
    a `refunded` run draws from one per-change refund budget (MAX_REFUNDS) since
    the merge — refunds keep a good change alive through other people's
    breakage, and the classified failure that finds the budget empty parks the
    change ("3 refunds used, now parked", plan §9 2.3)."""
    runs = [r for r in runs if our_workflow(r)]
    # #5937: deadline first, then merge order (stable for callers' own order).
    prs = sorted(prs, key=candidate_order)
    if any(r.get("status") != "completed" for r in runs):
        return "wait", None, "a migration workflow run is queued or in progress"
    passed_over = 0
    out_of_attempts: list[dict[str, Any]] = []
    # #5651: only dependency receipts share reads within this decision pass.
    # The fresh recheck invokes decide again and must read new evidence.
    dependency_evidence = dependency_evidence_reader(applied, refused)
    for pr in prs:
        kind, detail = classify_pr(pr, runs, held, applied, refused, stale, refunded,
                                   live, dependency_evidence, permanent)
        if kind == "delivered":
            continue
        if kind in ("held", "unknown-hold"):
            passed_over += 1
            if skipped is not None:
                skipped.append({**pr, "findings": detail["findings"]})
            continue
        if kind == "waiting-on-dependency":
            passed_over += 1
            if skipped is not None:
                skipped.append({**pr, "pending_dependencies": detail["pending_dependencies"]})
            continue
        if kind == "parked":
            # Out of automatic attempts or out of refunds: passed over like a held
            # PR, with a loud alert in main(), so one dead PR cannot park every
            # later promotion while still refusing to retry it (#5532).
            passed_over += 1
            entry = {**pr, "findings": [], "exhausted": detail["exhausted"], "refunds": detail["refunds"],
                     "permanent": detail["permanent"]}
            out_of_attempts.append(entry)
            if skipped is not None:
                skipped.append(entry)
            continue
        if detail["stale_streak"] >= BACKSTOP_AFTER_STALE:
            pr = {**pr, "stale_streak": detail["stale_streak"]}
        return "dispatch", pr, f"PR #{pr['number']} versions {','.join(pr['versions'])} not yet in production"
    if passed_over:
        base = "every merged migration PR not held by a review finding, production dependency or exhausted automatic attempts is in production"
        if out_of_attempts:
            names = ", ".join(
                f"PR #{e['number']} (permanent refusal: producer mismatch on a high-risk change -- reissue under a new version)"
                if e.get("permanent") else
                f"PR #{e['number']} ({e['exhausted']} attempts"
                + (f", {e['refunds']} refunds used" if e.get("refunds") else "") + ")"
                for e in out_of_attempts)
            return "idle", None, f"ENGINEER ACTION REQUIRED: {names} out of automatic attempts at this main commit; {base}"
        return "idle", None, base
    return "idle", None, "every merged migration PR since activation is in production"


def _preview_apply_hits(pr: dict[str, Any], runs: list[dict[str, Any]],
                        preview_ok: callable) -> list[dict[str, Any]]:
    return [r for r in runs
            if (r.get("display_title") or "").startswith("DB preview apply") and names_pr(pr, r.get("display_title") or "")
            # A run can fail after preview applied, e.g. at the review-finding hold.
            and (r.get("conclusion") == "success" or preview_ok(r))]


def earlier_preview_apply(pr: dict[str, Any], runs: list[dict[str, Any]],
                          preview_ok: callable = lambda run: False) -> int | None:
    """The oldest POST-MERGE preview apply of this PR whose preview job succeeded.

    #6574: a preview apply made before the PR merged is never recovery evidence.
    Its bytes are not the merged bytes the gate binds to, so production
    qualification refuses it permanently (20261116013153, run 43789639543).
    Without a post-merge apply the lane always does a fresh rehearsal."""
    post_merge = [r for r in _preview_apply_hits(pr, runs, preview_ok)
                  if r.get("created_at", "") > pr["merged_at"]]
    return min(post_merge, key=lambda r: r.get("created_at", ""))["id"] if post_merge else None


def pre_merge_preview_apply(pr: dict[str, Any], runs: list[dict[str, Any]],
                            preview_ok: callable = lambda run: False) -> int | None:
    """The oldest successful preview apply of this PR made BEFORE it merged, if
    any. Such an apply leaves the versions in preview's ledger, so the fresh
    post-merge rehearsal cannot prove them and the gate refuses the stale one:
    only reissuing the migration under a new version clears it (#6574)."""
    pre = [r for r in _preview_apply_hits(pr, runs, preview_ok)
           if r.get("created_at", "") <= pr["merged_at"]]
    return min(pre, key=lambda r: r.get("created_at", ""))["id"] if pre else None


def stale_pre_merge_alert(pr: dict[str, Any], run_id: int) -> str:
    return (f"::error title=ENGINEER ACTION REQUIRED: pre-merge preview apply::"
            f"PR #{pr['number']} versions {','.join(pr['versions'])} were applied to preview by "
            f"pre-merge run {run_id}, before the PR merged. That apply is never used as recovery "
            f"evidence and production qualification refuses it permanently. Cure: REISSUE the "
            f"migration(s) under new version(s) in a new PR and retire the originals. "
            f"A fresh post-merge rehearsal is dispatched anyway.")


def _time(text: str) -> datetime:
    return datetime.strptime(text, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)


def hold_since(entry: dict[str, Any]) -> datetime:
    """When this PR's review hold began: the later of its merge and its oldest
    blocking finding (the merge alone when no finding carries a date)."""
    opened = [_time(f["created_at"]) for f in entry.get("findings") or [] if f.get("created_at")]
    merged = _time(entry["merged_at"])
    return max(merged, min(opened)) if opened else merged


def overdue_holds(skipped: list[dict[str, Any]], now: datetime) -> list[str]:
    """One line per PR held longer than ALERT_AFTER. A PR is held from the later
    of its merge and its oldest blocking finding (unknown findings: the merge).
    Dependency waits are not review holds; exhausted attempts alert on their own."""
    lines = []
    for pr in skipped:
        if pr.get("exhausted") or pr.get("refunds") or pr.get("pending_dependencies"):
            continue
        since = hold_since(pr)
        if now - since > ALERT_AFTER:
            refs = ", ".join(f"#{f.get('number')}" for f in pr["findings"]) or "an unreadable finding query"
            minutes = int((now - since).total_seconds() // 60)
            lines.append(f"PR #{pr['number']} (versions {','.join(pr['versions'])}) held {minutes} min by {refs}")
    return lines


def is_held(repo: str, pr: int) -> list[dict[str, Any]] | bool:
    """The blocking findings for this PR; True (held, findings unknown) when the
    query fails, so an unreadable hold never promotes."""
    try:
        found = review_finding_hold.blocking_findings(review_finding_hold.gh_issues(repo, pr), repo, pr)
    except (subprocess.CalledProcessError, ValueError, OSError) as exc:
        print(f"::warning::review-finding hold query for PR #{pr} failed ({exc}); treating as held")
        return True
    # The two index reads repeat an issue; report each finding once.
    return list({f.get("number"): f for f in found}.values())


def prefetch_holds(repo: str, prs: list[int]) -> callable:
    """Hold lookup for this decision pass, read in one batch with one settle
    (#6493 Step 1c). Fresh every run, never cached across runs; a failed batch
    read falls back to the per-PR is_held, which fails toward holding. The
    pre-dispatch recheck still calls is_held directly."""
    try:
        issues = review_finding_hold.gh_issues_many(repo, prs) if prs else {}
    except (subprocess.CalledProcessError, ValueError, OSError) as exc:
        print(f"::warning::batched review-finding hold read failed ({exc}); reading per PR")
        issues = {}
    found: dict[int, list[dict[str, Any]]] = {}

    def held(number: int) -> list[dict[str, Any]] | bool:
        if number not in issues:
            return is_held(repo, number)
        if number not in found:
            try:
                rows = review_finding_hold.blocking_findings(issues[number], repo, number)
            except (subprocess.CalledProcessError, ValueError, OSError) as exc:
                print(f"::warning::review-finding hold check for PR #{number} failed ({exc}); treating as held")
                return True
            found[number] = list({f.get("number"): f for f in rows}.values())
        return found[number]
    return held


def version_on_main(version: str) -> bool:
    """True when this checkout of main still holds the migration file."""
    return bool(glob.glob(os.path.join(os.path.dirname(HERE), "supabase", "migrations", f"{version}_*.sql")))


# Run id -> highest attempt an engineer has recorded a disposition for (#5558).
# A listed attempt stops failing this trigger; an unlisted run or a higher attempt
# still fails it. The workflow's refusal steps do not read this.
ACKNOWLEDGED_RE_RUNS = {
    41545991868: 2,  # PR 5494, before the refusal existed; attempt 1 applied 20261102202014
    41661658015: 2,  # PR 5539, before the refusal existed; attempt 2 succeeded
}


def recent_re_runs(runs: list[dict[str, Any]], now: datetime,
                   acknowledged: dict[int, int] = {}) -> list[dict[str, Any]]:
    """Production apply runs that were RE-RUN within the last day. A re-run is
    never the retry path -- the queue dispatches a fresh run with fresh
    evidence -- and it hides what earlier attempts did (2026-11-03: run
    41545991868 attempt 1 applied 20261102202014 and failed only its catalog
    check; the re-run blinded the selector until #5537). Tracked here on every
    queue run, so a repeat is never silent again. An attempt already recorded in
    `acknowledged` stops alerting (#5558: an unactionable red hides real alerts);
    a further re-run of the same run alerts again."""
    return [r for r in runs
            if (r.get("display_title") or "").startswith("DB production apply")
            and int(r.get("run_attempt") or 1) > max(1, acknowledged.get(r.get("id"), 1))
            and now - _time(r.get("updated_at") or r.get("created_at") or "1970-01-01T00:00:00Z") < timedelta(hours=24)]


def _pct(values: list[float], q: float) -> float:
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, int(round(q * (len(ordered) - 1))))]


def slo_samples(prs: list[dict[str, Any]], runs: list[dict[str, Any]], prefix: str,
                limit: int = 20) -> list[tuple[int, float]]:
    """(PR, seconds) from merge to the FIRST post-merge run titled `prefix`
    naming the PR, newest `limit` PRs. SLO A uses the preview rehearsal the
    selector dispatches; SLO B the production apply's start (#6493 Step 3)."""
    out = []
    for pr in prs:
        tag = f"PR{pr['number']} "
        hits = [r for r in runs if (r.get("display_title") or "").startswith(prefix)
                and tag in (r.get("display_title") or "") + " " and (r.get("created_at") or "") > pr["merged_at"]]
        if hits:
            first = min(hits, key=lambda r: r["created_at"])
            start = first.get("run_started_at") or first["created_at"]
            out.append((pr["merged_at"], pr["number"], (_time(start) - _time(pr["merged_at"])).total_seconds()))
    return [(n, s) for _, n, s in sorted(out)[-limit:]]


def report_slos(prs: list[dict[str, Any]], runs: list[dict[str, Any]]) -> None:
    for name, prefix in (("SLO_A merge-to-dispatch", "DB preview apply"),
                         ("SLO_B merge-to-apply-start", "DB production apply")):
        samples = slo_samples(prs, [r for r in runs if our_workflow(r)], prefix)
        if not samples:
            continue
        values = [sec for _, sec in samples]
        last_pr, last = samples[-1]
        print(f"::notice title={name.split()[0]}::{name}: {int(last)}s (PR #{last_pr}); "
              f"p50={int(_pct(values, 0.5))}s p95={int(_pct(values, 0.95))}s over last {len(values)} PRs")


def production_ledger(path: str | None = None) -> set[str] | None:
    """Applied production versions written by scripts/write-production-ledger.mjs,
    or None when absent or unreadable (selector then relies on run evidence)."""
    path = path or os.environ.get("PRODUCTION_LEDGER_FILE")
    if not path or not os.path.exists(path):
        return None
    try:
        with open(path, encoding="utf-8") as fh:
            versions = json.load(fh)
    except (OSError, ValueError):
        return None
    if not isinstance(versions, list) or not versions:
        return None
    return {str(v) for v in versions}


def needs_recheck(action: str, skipped: list[dict[str, Any]], claimed_elsewhere: set[int] = frozenset()) -> bool:
    """#6493 Step 4b: True when this pass dispatched nothing but a candidate is
    waiting on a TRANSIENT condition that clears without any event this
    workflow hears (a run in flight, an unreadable ledger, a production
    dependency, another selector's claim). Review-finding holds are excluded
    (their close/unlabel re-arms the trigger directly) and parked PRs are
    excluded (they need an engineer), so a long hold never spins the backstop."""
    if action == "dispatch":
        return False
    if action == "wait" or claimed_elsewhere:
        return True
    return any(e.get("pending_dependencies") for e in skipped)


def write_recheck_output(recheck: bool) -> None:
    path = os.environ.get("GITHUB_OUTPUT")
    if path:
        with open(path, "a", encoding="utf-8") as fh:
            fh.write(f"recheck={'true' if recheck else 'false'}\n")
    print(f"recheck: {'scheduled' if recheck else 'not needed'}")


def main(now: datetime | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    repo = os.environ["GITHUB_REPOSITORY"]
    now = now or datetime.now(timezone.utc)
    main_sha = gh(f"repos/{repo}/commits/main")["sha"]
    live = production_ledger()
    # #6493 Step 2: fail closed. The ledger writer only warns and exits 0 when it
    # cannot read production; deciding on run evidence alone is how already-live
    # versions burned attempts (#6352). Hold this cycle loudly instead. Only when
    # the workflow configured a ledger file (local/test runs set none).
    if live is None and os.environ.get("PRODUCTION_LEDGER_FILE"):
        print("::error title=Production ledger unreadable::holding this promotion cycle; "
              "the next trigger retries once the ledger reads")
        print("wait: production ledger unreadable")
        write_recheck_output(True)
        return 0
    started = time.monotonic()
    phase = lambda name: print(f"timing: {name} at {time.monotonic() - started:.1f}s", flush=True)
    runs = workflow_runs(repo)
    phase("workflow runs read")
    skipped: list[dict[str, Any]] = []
    candidates = merged_migration_prs(repo)
    phase("merged PRs discovered")
    try:
        report_slos(candidates, runs)
    except (KeyError, ValueError, TypeError) as exc:
        print(f"::warning::SLO report skipped ({exc})")
    held = prefetch_holds(repo, [c["number"] for c in candidates
                                 if not (live and c.get("versions") and set(c["versions"]) <= live)])
    phase("review-finding holds read")
    # Plan R3 (#6561): one read of each run's evidence per pass, shared by the
    # first decision and the stranded-PR reconciler. The fresh recheck below
    # keeps reading new evidence.
    pass_applied = memoised_evidence(lambda run: applied_in_any_attempt(repo, run))
    pass_refused = memoised_evidence(lambda run: refused_as_applied(repo, run))
    pass_stale = memoised_evidence(lambda run: stale_main_refusal_only(repo, run))
    pass_permanent = memoised_evidence(lambda run: permanent_refusal(repo, run))
    pass_refunded = memoised_evidence(lambda run: refund_eligible_in_any_attempt(repo, run))
    action, pr, reason = decide(candidates, runs, held, pass_applied, main_sha,
                                skipped, pass_refused, stale=pass_stale,
                                refunded=pass_refunded, live=live, permanent=pass_permanent)
    for entry in skipped:
        if entry.get("pending_dependencies"):
            refs = ", ".join(f"{v} (PR #{owner})" for v, owner in entry["pending_dependencies"].items())
            print(f"dependency: PR #{entry['number']} waiting on production evidence for {refs}; later independent PRs still promote")
            continue
        if entry.get("exhausted") or entry.get("refunds"):
            what = ("out of automatic attempts" if entry.get("exhausted")
                    else f"out of refunds (cap {MAX_REFUNDS} per change)")
            print(f"exhausted: PR #{entry['number']} {what}; later PRs still promote")
            continue
        refs = ", ".join(f"#{f.get('number')}" for f in entry["findings"]) or "an unreadable finding query"
        print(f"held: PR #{entry['number']} by {refs}; later PRs still promote")
    phase("decision made")
    print(f"{action}: {reason}")
    alerts = overdue_holds(skipped, now)
    claimed_elsewhere: set[int] = set()
    reconcile_runs = runs
    while action == "dispatch":
        # Selecting takes minutes; a run started meanwhile must count (#5558:
        # a re-run began after the snapshot and PR #5539 was dispatched again).
        # #6493 Step 1c: re-read every run created since the candidate (or a
        # production dependency) merged, plus everything in flight, so attempt
        # caps, dependency evidence and the wait never come from the cache.
        merged_at = {c["number"]: c["merged_at"] for c in candidates}
        fresh_since = min([pr["merged_at"]] + [merged_at[n] for n in pr.get("production_dependencies", {}).values()
                                               if n in merged_at])
        fresh_runs = workflow_runs(repo, fresh_since=fresh_since)
        reconcile_runs = fresh_runs
        action, pr, reason = decide([pr], fresh_runs, lambda n: is_held(repo, n),
                                    lambda run: applied_in_any_attempt(repo, run), main_sha,
                                    None, lambda run: refused_as_applied(repo, run),
                                    stale=lambda run: stale_main_refusal_only(repo, run),
                                    permanent=lambda run: permanent_refusal(repo, run),
                                    refunded=lambda run: refund_eligible_in_any_attempt(repo, run),
                                    live=live)
        phase("fresh recheck done")
        if action != "dispatch":
            print(f"dispatch withdrawn on the fresh recheck: {action}: {reason}")
            break
        if args.dry_run:
            break
        if pr.get("stale_streak", 0) >= BACKSTOP_AFTER_STALE:
            backstop_freeze(pr)
        # Selection takes minutes and main can move meanwhile; dispatching the
        # SHA read at start makes the preview refuse ("requires the exact current
        # main SHA"), re-arming the backstop freeze forever. Re-read main now,
        # after the freeze (when set) stops further movement.
        main_sha = gh(f"repos/{repo}/commits/main")["sha"]
        prune_claims(repo, live)
        if claim_dispatch(repo, pr, fresh_runs, live, now):
            try:
                dispatch(repo, pr, main_sha, fresh_runs)
            except Exception:
                release_claim(repo, pr["number"])
                raise
            break
        # #6493 Step 4: a PR another selector holds a live claim on is passed
        # over like a held PR -- later PRs still promote. Ending the cycle here
        # parked the whole queue behind PR #6370's claim (2026-11-17, two
        # selector runs chose it, were refused, and dispatched nothing).
        claimed_elsewhere.add(pr["number"])
        if len(claimed_elsewhere) >= MAX_CLAIM_PASSES:
            action, reason = "idle", f"{len(claimed_elsewhere)} candidates are claimed by other selector runs"
            print(f"{action}: {reason}")
            break
        action, pr, reason = decide([c for c in candidates if c["number"] not in claimed_elsewhere],
                                    fresh_runs, held,
                                    lambda run: applied_in_any_attempt(repo, run), main_sha,
                                    None, lambda run: refused_as_applied(repo, run),
                                    stale=lambda run: stale_main_refusal_only(repo, run),
                                    permanent=lambda run: permanent_refusal(repo, run),
                                    refunded=lambda run: refund_eligible_in_any_attempt(repo, run),
                                    live=live)
        print(f"{action}: {reason} (after passing over claimed PR(s) "
              f"{', '.join(f'#{n}' for n in sorted(claimed_elsewhere))})")
    for line in alerts:
        print(f"::error title=Production release held over 30 minutes::{line}")
    # Plan R1/R7 (#6561): mark stranded PRs on the PRs themselves, over every
    # candidate. Contained: a reconciler defect never changes the exit code.
    # merged_migration_prs raises on incomplete discovery, so reaching here
    # means discovery this pass was complete (discovery_ok, card decision 1).
    try:
        marks = reconcile_stranded_marks(repo, candidates, reconcile_runs, live, now, held,
                                         pass_applied, pass_refused, pass_stale, pass_refunded,
                                         discovery_ok=True, dry_run=args.dry_run,
                                         permanent=pass_permanent)
    except Exception as exc:
        print(f"::warning title=Stranded-PR reconciler defect::{type(exc).__name__}: {exc}; "
              "labels and notices were not reconciled this pass")
        marks = []
    notice_failures = [r for r in marks if r["outcome"] == "FAILED"]
    if notice_failures and not args.dry_run:
        report_notice_failures(repo, notice_failures)
    parked_notice = {r["number"]: r["outcome"] for r in marks if r["label"] == PARKED_LABEL}
    exhausted = [{**e, "notice": parked_notice[e["number"]]} if e["number"] in parked_notice else e
                 for e in skipped if e.get("exhausted") or e.get("refunds")]
    for entry in exhausted:
        cap_note = (f" {entry['refunds']} refunds used, now parked (refund cap {MAX_REFUNDS} per change)"
                    if entry.get("refunds") else "")
        print(f"::error title=ENGINEER ACTION REQUIRED: automatic attempts exhausted::"
              f"PR #{entry['number']} (versions {','.join(entry['versions'])}) failed {entry['exhausted']} "
              f"automatic attempts at this main commit{cap_note}; later PRs still promote")
    # Step 2.3: open or update ONE tracking issue for exhausted PRs.
    if exhausted and not args.dry_run:
        report_stuck_change(repo, exhausted, now)
    phase("dispatch step done")
    write_recheck_output(not args.dry_run and needs_recheck(action, skipped, claimed_elsewhere))
    reruns = recent_re_runs(runs, now, ACKNOWLEDGED_RE_RUNS)
    for r in reruns:
        print(f"::error title=ENGINEER ACTION REQUIRED: production apply re-run::"
              f"run {r['id']} ({r.get('display_title')}) was re-run (attempt {r.get('run_attempt')}); "
              f"a re-run is never the retry path -- the queue dispatches a fresh run with fresh evidence -- "
              f"and it hides what earlier attempts did")
    # Step 2.2 (plan_ci-process-repair): holds, waits, used-up attempts and
    # acknowledged history are expected states. Exit success with the reason in
    # the summary; exit failure only when the trigger itself broke.
    #
    # Advisory findings above are annotations, not exit status. A failing run
    # used to be the alert channel, but these findings are long-lived PR states
    # evaluated only on runs that reach queue selection -- runs that early-return
    # "wait" (a migration workflow run in flight) never see them -- so the step
    # flapped red/green on unrelated timing while the hold gate itself (checked
    # at decide, again before dispatch, again before the apply) kept working.
    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary_path:
        with open(summary_path, "a", encoding="utf-8") as fh:
            fh.write(f"## Automatic promotion trigger\n\n**Action:** {action} — {reason}\n\n")
            for entry in skipped:
                if entry.get("pending_dependencies"):
                    refs = ", ".join(f"{v} (PR #{owner})" for v, owner in entry["pending_dependencies"].items())
                    fh.write(f"- Dependency wait: PR #{entry['number']} waiting on {refs}\n")
                elif entry.get("exhausted") or entry.get("refunds"):
                    fh.write(f"- Used-up attempts: PR #{entry['number']} ({entry['exhausted']} attempts"
                             + (f", {entry['refunds']} refunds used" if entry.get("refunds") else "") + ")\n")
                else:
                    refs = ", ".join(f"#{f.get('number')}" for f in entry["findings"]) or "unreadable"
                    fh.write(f"- Held: PR #{entry['number']} by {refs}\n")
            if alerts:
                fh.write(f"- Overdue holds: {len(alerts)}\n")
            if reruns:
                fh.write(f"- Acknowledged re-runs: {len(reruns)}\n")
            for r in notice_failures:
                fh.write(f"- Stranded-PR notice not delivered: PR #{r['number']} {r['label']}: {r['detail']}\n")
            touched = [r for r in marks if r["outcome"] not in ("already", "unknown")]
            if touched:
                fh.write("- Stranded-PR marks: " + ", ".join(
                    f"PR #{r['number']} {r['label']} {r['outcome']}" for r in touched) + "\n")
    return 0


def backstop_freeze(pr: dict[str, Any]) -> bool:
    """#5937 backstop: freeze merges for BACKSTOP_FREEZE_TTL_MINUTES before
    re-dispatching a change main movement refused BACKSTOP_AFTER_STALE times in
    a row. The merge-queue gate refuses non-tolerant groups while it is live;
    production qualification takes it over for this PR and the production
    job's always() cleanup releases it, else the TTL does. Failure to freeze
    (e.g. another PR's freeze is live) is a warning: dispatch still proceeds."""
    print(f"backstop: PR #{pr['number']} refused for main movement {pr['stale_streak']} times in a row; "
          f"freezing merges for {BACKSTOP_FREEZE_TTL_MINUTES} minutes")
    result = subprocess.run(
        ["node", os.path.join(HERE, "manage-migration-coordination.mjs"), "--acquire-promotion-freeze",
         "--pr", str(pr["number"]), "--owner", BACKSTOP_FREEZE_OWNER,
         "--ttl-minutes", str(BACKSTOP_FREEZE_TTL_MINUTES)],
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace")
    print(result.stdout.strip())
    if result.returncode != 0:
        print(f"::warning::backstop merge freeze for PR #{pr['number']} not set (exit {result.returncode}); dispatching anyway")
        return False
    return True


def dispatch(repo: str, pr: dict[str, Any], main_sha: str, runs: list[dict[str, Any]] | None = None) -> None:
    # `runs` is the pre-dispatch recheck's fresh read (seconds old); re-reading
    # the whole history here cost another ~20 s per dispatch (#6493 Step 1c).
    source = [f"merged_preview_source_pr={pr['number']}"]
    runs = runs if runs is not None else workflow_runs(repo)
    preview_ok = lambda run: preview_job_succeeded_in_any_attempt(repo, run)  # noqa: E731
    original = earlier_preview_apply(pr, runs, preview_ok)
    if not original:
        stale = pre_merge_preview_apply(pr, runs, preview_ok)
        if stale:
            print(stale_pre_merge_alert(pr, stale))
    if original:
        # A retry after a failed production apply: preview already holds the
        # versions, so only the historical-recovery lane can re-prove them.
        source = [f"historical_preview_source_pr={pr['number']}",
                  "historical_preview_original_run_map=" + ",".join(f"{v}:{original}" for v in pr["versions"])]
    subprocess.run(
        ["gh", "workflow", "run", WORKFLOW, "--repo", repo, "--ref", "main",
         "-f", "target=preview", "-f", "mode=apply", "-f", f"commit_sha={main_sha}",
         "-f", f"preview_allowlist={','.join(pr['versions'])}",
         *[a for kv in source for a in ("-f", kv)]],
        check=True,
    )
    print(f"Dispatched the post-merge preview rehearsal for PR #{pr['number']} at {main_sha}.")


# #6493 Step 2: duplicate-dispatch guard. One claim ref per PR, created
# atomically (the create fails when it exists) just before dispatch. The ref
# points at a parentless commit whose message is the claim record. A claim is a
# liveness lease, never permanent: it stays live while any associated run is
# queued/in progress, or completed without failure before the ledger shows the
# versions. It is reclaimable once the claiming selector failed before any
# associated run exists, every associated run failed, or (last resort) nothing
# associated has moved for CLAIM_IDLE_LIMIT. The trigger's concurrency group
# already serializes selector runs; this is defense in depth.
CLAIM_PREFIX = "refs/dispatch-claims/pr-"
CLAIM_IDLE_LIMIT = timedelta(hours=4)
# Candidates one selector run may pass over because another run holds their claim.
MAX_CLAIM_PASSES = 3


def claim_runs(claim: dict[str, Any], runs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    tag = f"PR{claim['pr']} "
    versions = set(claim.get("versions") or [])
    since = claim.get("claimed_at", "")
    return [r for r in runs if our_workflow(r) and (r.get("created_at") or "") >= since
            and (tag in (r.get("display_title") or "") + " "
                 or title_versions(r.get("display_title") or "") & versions)]


def claim_is_stale(claim: dict[str, Any], runs: list[dict[str, Any]], live: set[str] | None,
                   now: datetime, claimer_failed: callable = lambda run_id: False) -> bool:
    if live and set(claim.get("versions") or []) <= live:
        return True
    associated = claim_runs(claim, runs)
    if any(r.get("status") != "completed" for r in associated):
        return False
    last = max([claim.get("claimed_at", "")] + [r.get("updated_at") or r.get("created_at") or "" for r in associated])
    if now - _time(last) > CLAIM_IDLE_LIMIT:
        return True
    if associated:
        # #6493 Step 4: the pipeline is over once its NEWEST run ended without
        # success. Requiring every run to have failed kept the claim live for
        # 4 h after preview passed and the production apply failed (PR #6370,
        # 2026-11-17: 97 min with the whole queue parked behind it). Retries
        # stay bounded by the attempt caps in decide().
        newest = max(associated, key=lambda r: r.get("created_at") or "")
        return newest.get("conclusion") != "success"
    return bool(claimer_failed(claim.get("run_id")))


def read_claim(repo: str, pr: int) -> dict[str, Any] | None:
    try:
        ref = gh(f"repos/{repo}/git/ref/{CLAIM_PREFIX[5:]}{pr}")
    except subprocess.CalledProcessError:
        return None
    commit = gh(f"repos/{repo}/git/commits/{ref['object']['sha']}")
    return json.loads(commit["message"])


def claim_dispatch(repo: str, pr: dict[str, Any], runs: list[dict[str, Any]], live: set[str] | None,
                   now: datetime) -> bool:
    record = {"pr": pr["number"], "versions": pr["versions"], "run_id": os.environ.get("GITHUB_RUN_ID"),
              "claimed_at": now.strftime("%Y-%m-%dT%H:%M:%SZ")}
    tree = gh(f"repos/{repo}/commits/main")["commit"]["tree"]["sha"]
    sha = gh("-X", "POST", f"repos/{repo}/git/commits", "-f", f"message={json.dumps(record)}", "-f", f"tree={tree}")["sha"]
    ref = f"{CLAIM_PREFIX}{pr['number']}"
    try:
        subprocess.run(["gh", "api", "-X", "POST", f"repos/{repo}/git/refs", "-f", f"ref={ref}", "-f", f"sha={sha}"],
                       check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        return True
    except subprocess.CalledProcessError:
        pass
    existing = read_claim(repo, pr["number"])
    if existing is not None and not claim_is_stale(existing, runs, live, now, lambda rid: claimer_failed(repo, rid)):
        print(f"skip: PR #{pr['number']} already claimed by selector run {existing.get('run_id')} at {existing.get('claimed_at')}")
        return False
    print(f"reclaiming stale dispatch claim for PR #{pr['number']} ({existing})")
    gh("-X", "PATCH", f"repos/{repo}/git/{ref}", "-f", f"sha={sha}", "-F", "force=true")
    return True


def claimer_failed(repo: str, run_id: Any) -> bool:
    if not run_id:
        return True
    try:
        run = gh(f"repos/{repo}/actions/runs/{run_id}")
    except subprocess.CalledProcessError:
        return False
    return run.get("status") == "completed" and run.get("conclusion") != "success"


def release_claim(repo: str, pr: int) -> None:
    try:
        subprocess.run(["gh", "api", "-X", "DELETE", f"repos/{repo}/git/{CLAIM_PREFIX}{pr}"],
                       check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    except subprocess.CalledProcessError as exc:
        print(f"::warning::could not release the dispatch claim for PR #{pr} ({exc}); it expires as a stale lease")


def prune_claims(repo: str, live: set[str] | None) -> None:
    """Drop claims whose versions are all in the production ledger."""
    if not live:
        return
    try:
        refs = gh(f"repos/{repo}/git/matching-refs/{CLAIM_PREFIX[5:-4]}") or []
        for ref in refs:
            pr = int(ref["ref"].rsplit("-", 1)[1])
            claim = read_claim(repo, pr)
            if claim and set(claim.get("versions") or []) <= live:
                release_claim(repo, pr)
    except (subprocess.CalledProcessError, ValueError, KeyError, OSError) as exc:
        print(f"::warning::dispatch-claim pruning skipped ({exc})")


STUCK_ISSUE_TITLE = "Automatic promotion: stuck migrations need repair"


def find_stuck_issue(repo: str) -> dict[str, Any] | None:
    """Locate the open tracking issue anywhere in the open-issue list.

    A parked change can leave the tracking issue past the first 100 open
    issues; a single-page lookup would then open a duplicate."""
    page = 1
    while True:
        batch = gh(f"repos/{repo}/issues?state=open&per_page=100&page={page}") or []
        match = next(
            (i for i in batch if i.get("title") == STUCK_ISSUE_TITLE and not i.get("pull_request")),
            None,
        )
        if match:
            return match
        if len(batch) < 100:
            return None
        page += 1


def report_stuck_change(repo: str, entries: list[dict[str, Any]], now: datetime) -> None:
    """Step 2.3: open or update ONE tracking issue for exhausted PRs, with
    delivery wording, failure text, and merged-not-live duration."""
    if not entries:
        return
    lines = []
    for e in entries:
        merged_at = _time(e.get("merged_at", "1970-01-01T00:00:00Z"))
        hours = max(0, int((now - merged_at).total_seconds() / 3600))
        lines.append(
            f"- PR #{e['number']} (versions {','.join(e.get('versions', []))}): "
            f"failed {e['exhausted']} automatic attempts"
            + (f" and used its {e['refunds']} refunds (refund cap {MAX_REFUNDS} per change)" if e.get("refunds") else "")
            + f"; merged {hours}h ago and not live"
            + (f" — PR notice: {e['notice']}" if e.get("notice") else "")
        )
    body = (
        "## Delivery needed\n\n"
        "The following merged migrations have exhausted their automatic promotion attempts "
        "and need a repair session to deliver them to production:\n\n"
        + "\n".join(lines)
        + "\n\n**Action:** investigate the failure, fix the migration or its dependencies, "
        "and re-dispatch through the normal promotion path.\n"
    )
    try:
        existing = find_stuck_issue(repo)
        if existing:
            number = existing["number"]
            subprocess.run(
                ["gh", "issue", "comment", str(number), "--repo", repo, "--body", body],
                check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            )
            print(f"Updated tracking issue #{number} for {len(entries)} stuck migration(s).")
        else:
            result = subprocess.run(
                ["gh", "issue", "create", "--repo", repo, "--title", STUCK_ISSUE_TITLE, "--body", body],
                check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
            )
            print(f"Opened tracking issue for {len(entries)} stuck migration(s): {result.stdout.strip()}")
    except (subprocess.CalledProcessError, ValueError, OSError) as exc:
        stderr = getattr(exc, "stderr", None)
        if isinstance(stderr, bytes):
            stderr = stderr.decode("utf-8", "replace")
        print(
            f"::warning::could not open/update the stuck-change tracking issue ({exc})"
            + (f" stderr={stderr.strip()}" if stderr else "")
            + "; the alert above is still the signal"
        )


PARKED_LABEL = "promotion-parked"
HELD_LABEL = "promotion-held"
HELD_ESCALATE_AFTER = timedelta(hours=8)
LABEL_COLOURS = {PARKED_LABEL: "B60205", HELD_LABEL: "FBCA04"}
LABEL_DESCRIPTIONS = {
    PARKED_LABEL: "Merged migration out of automatic promotion attempts; not in production",
    HELD_LABEL: "Merged migration held over 8h by open review findings; not in production",
}


def marker(label: str) -> str:
    """Hidden marker in the notice comment that proves a label was announced."""
    return f"<!-- promotion-stranded:{label} -->"


def gh_write(method: str, path: str, fields: dict[str, str | list[str]] | None = None) -> tuple[bool, str]:
    """One GitHub write through `gh api`. A refused call returns (False, text)
    rather than raising; the caller decides what the failure means."""
    cmd = ["gh", "api", "-X", method, path]
    for key, value in (fields or {}).items():
        if isinstance(value, list):
            cmd += [arg for item in value for arg in ("-f", f"{key}[]={item}")]
        else:
            cmd += ["-f", f"{key}={value}"]
    try:
        done = subprocess.run(cmd, check=False, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    except OSError as exc:
        return False, str(exc)
    if done.returncode == 0:
        return True, (done.stdout or "").strip()[:200] or "ok"
    return False, (done.stderr or "").strip() or (done.stdout or "").strip()


def ensure_label(repo: str, name: str, description: str) -> bool:
    """True when the label exists or was just created. A 422 on create means
    another run created it first (race), which also counts as success."""
    colour = LABEL_COLOURS.get(name)
    if colour is None:
        print(f"::warning::no colour defined for label {name}")
        return False
    try:
        found = subprocess.run(["gh", "api", f"repos/{repo}/labels/{name}"], check=False,
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    except OSError as exc:
        print(f"::warning::could not read label {name} ({exc})")
        return False
    if found.returncode == 0:
        return True
    text = f"{found.stderr or ''}{found.stdout or ''}"
    if "Not Found" not in text and "HTTP 404" not in text:
        print(f"::warning::could not read label {name} ({text.strip()})")
        return False
    ok, msg = gh_write("POST", f"repos/{repo}/labels",
                       {"name": name, "color": colour, "description": description})
    if ok or "422" in msg or "already_exists" in msg:
        return True
    print(f"::warning::could not create label {name} ({msg})")
    return False


def labelled_prs(repo: str, label: str) -> list[int]:
    """Numbers of pull requests (plain issues dropped) carrying the label, any
    state. Exceptions propagate; the caller guards."""
    pages = gh("--paginate", "--slurp", f"repos/{repo}/issues?labels={label}&state=all&per_page=100") or []
    items = [item for page in pages for item in page]
    return [item["number"] for item in items if "pull_request" in item]


def cleared_marker(label: str) -> str:
    """Hidden marker in the clear comment; it closes the episode the notice opened."""
    return f"<!-- promotion-stranded-cleared:{label} -->"


def has_marker(repo: str, n: int, label: str) -> bool:
    """True when the PR's latest episode for this label was announced: the last
    comment carrying this label's notice or clear marker is a notice. A cleared
    episode does not count, so a PR stranded again gets a fresh notice (R4)."""
    pages = gh("--paginate", "--slurp", f"repos/{repo}/issues/{n}/comments?per_page=100") or []
    notice, cleared = marker(label), cleared_marker(label)
    last = None
    for page in pages:
        for comment in page:
            body = comment.get("body") or ""
            if notice in body:
                last = True
            elif cleared in body:
                last = False
    return bool(last)


OUTCOMES = ("posted", "repaired", "relabelled", "already", "cleared", "FAILED", "unknown")
PLAN_URL = "https://github.com/popcre/shared-db/blob/main/plan_promotion_stranding_watch.md"
CLEAR_TEXT = {
    "delivered": "Delivered: every version of this PR is in production.",
    "released": "No longer held by review findings.",
    "untracked": "No longer tracked by the automatic lane (versions retired, removed from main, or superseded).",
}


def _footer() -> str:
    server = os.environ.get("GITHUB_SERVER_URL")
    repository = os.environ.get("GITHUB_REPOSITORY")
    run_id = os.environ.get("GITHUB_RUN_ID")
    run = f" (run {server}/{repository}/actions/runs/{run_id})" if server and repository and run_id else ""
    return f"_Posted automatically by the automatic production trigger{run}._"


def notice_body(label: str, entry: dict[str, Any], now: datetime) -> str:
    """The notice comment for one PR. Public-safe: versions, counts, ages and
    links to this repository only (plan R8)."""
    versions = ",".join(entry.get("versions") or [])
    if label == PARKED_LABEL:
        refunds = f", {entry['refunds']} refunds used" if entry.get("refunds") else ""
        hours = int((now - _time(entry["merged_at"])).total_seconds() // 3600)
        status = (
            "**This merged migration is parked and is not in production.** "
            + ("The automatic promotion lane stopped on a permanent refusal (producer mismatch on a "
               "high-risk change); only a reissue under a new version can deliver it. "
               if entry.get("permanent") else
               f"The automatic promotion lane stopped after {entry.get('exhausted', 0)} failed automatic attempts{refunds}. ")
            + f"Versions: {versions}. Merged {hours}h ago."
        )
    else:
        findings = entry.get("findings") or []
        refs = ", ".join(f"#{f.get('number')}" for f in findings)
        verb = "has" if len(findings) == 1 else "have"
        hours = int((now - hold_since(entry)).total_seconds() // 3600)
        status = (
            "**This merged migration is held and is not in production.** "
            f"Open review finding{'' if len(findings) == 1 else 's'} {refs} {verb} blocked it for {hours}h."
        )
    repair = (
        "Repair by fix-forward (a new governed version) or retire-and-reissue. "
        "Never re-run a failed run; there is no manual production command. "
        "Attempts may resume on their own; this label is removed automatically when the versions reach production."
    )
    listing = f"Open stranded changes: PRs labelled `{PARKED_LABEL}` or `{HELD_LABEL}`. Plan: {PLAN_URL}"
    return "\n\n".join([marker(label), status, repair, listing, _footer()])


def clear_body(label: str, reason: str) -> str:
    """The comment posted when a stranded label is removed."""
    return f"{cleared_marker(label)}\n`{label}` removed. {CLEAR_TEXT[reason]}\n\n{_footer()}"


def reconcile_stranded_marks(repo: str, candidates: list[dict[str, Any]], runs: list[dict[str, Any]],
                             live: set[str] | None, now: datetime, held: callable,
                             applied: callable, refused: callable, stale: callable, refunded: callable,
                             discovery_ok: bool, dry_run: bool = False,
                             fresh_held: callable | None = None,
                             permanent: callable = lambda run: False) -> list[dict[str, Any]]:
    """Plan R1-R6: make the stranded-PR labels and notices match the shared
    classifier, once per selector pass. Returns one dict per (PR, label) touched.
    A per-PR problem is recorded and the pass goes on; nothing here raises."""
    results: list[dict[str, Any]] = []

    def record(number: int, label: str, outcome: str, detail: str = "") -> None:
        results.append({"number": number, "label": label, "outcome": outcome, "detail": detail})

    def attempt(number: int, label: str, action: str, method: str, path: str,
                fields: dict[str, Any] | None = None, gone_ok: bool = False) -> tuple[bool, str]:
        ok, msg = gh_write(method, path, fields)
        if not ok and gone_ok and ("Not Found" in msg or "HTTP 404" in msg):
            ok = True
        print(f"reconcile: PR #{number} {label} {action}: " + ("ok" if ok else f"refused: {msg}"))
        return ok, msg

    def fail(number: int, label: str, action: str, msg: str) -> None:
        print(f"::error title=Stranded-PR notice not delivered::PR #{number} {label} {action}: {msg}")
        record(number, label, "FAILED", f"{action}: {msg}")

    runs = [r for r in runs if our_workflow(r)]
    in_flight = [r for r in runs if r.get("status") != "completed"]
    wait = bool(in_flight)
    if wait:
        print(f"reconcile: wait pass (run {in_flight[0].get('id')} in flight); parked labels neither added nor cleared")

    applied_m, refused_m = memoised_evidence(applied), memoised_evidence(refused)
    stale_m, refunded_m = memoised_evidence(stale), memoised_evidence(refunded)
    permanent_m = memoised_evidence(permanent)
    dependency_evidence = dependency_evidence_reader(applied_m, refused_m)

    def delivered_live(pr: dict[str, Any]) -> bool:
        return bool(live) and bool(pr.get("versions")) and set(pr["versions"]) <= live

    by_number = {pr["number"]: pr for pr in candidates}
    desired: dict[str, dict[int, dict[str, Any]]] = {PARKED_LABEL: {}, HELD_LABEL: {}}
    unclassified: dict[int, str] = {}
    for pr in candidates:
        number = pr["number"]
        if delivered_live(pr):
            continue
        try:
            kind, detail = classify_pr(pr, runs, held, applied_m, refused_m, stale_m, refunded_m,
                                       live, dependency_evidence, permanent_m)
            entry = {**pr, **detail}
            if kind == "held" and now - hold_since(entry) > HELD_ESCALATE_AFTER:
                desired[HELD_LABEL][number] = entry
            elif kind == "unknown-hold":
                unclassified[number] = "review finding read failed"
            elif kind == "parked" and not wait:
                desired[PARKED_LABEL][number] = entry
        except Exception as exc:
            print(f"::warning::reconcile: PR #{number} could not be classified ({exc}); its labels are left unchanged")
            unclassified[number] = f"classification failed: {exc}"

    current: dict[str, set[int]] = {}
    for label in (PARKED_LABEL, HELD_LABEL):
        try:
            current[label] = set(labelled_prs(repo, label))
        except Exception as exc:
            print(f"::warning::reconcile: could not list {label} PRs ({exc}); that label is left alone this pass")

    label_ready: dict[str, bool] = {}
    for label in (PARKED_LABEL, HELD_LABEL):
        if label not in current:
            continue
        for number, entry in sorted(desired[label].items()):
            try:
                if dry_run:
                    print(f"dry-run: would mark PR #{number} {label}")
                    record(number, label, "unknown", "dry-run")
                    continue
                labelled = number in current[label]
                marked = has_marker(repo, number, label)
                if labelled and marked:
                    record(number, label, "already")
                elif labelled:
                    ok, msg = attempt(number, label, "notice post", "POST",
                                      f"repos/{repo}/issues/{number}/comments",
                                      {"body": notice_body(label, entry, now)})
                    if ok:
                        record(number, label, "repaired")
                    else:
                        fail(number, label, "notice post", msg)
                else:
                    if label not in label_ready:
                        label_ready[label] = ensure_label(repo, label, LABEL_DESCRIPTIONS[label])
                    if not label_ready[label]:
                        fail(number, label, "label create", "the label could not be created")
                        continue
                    ok, msg = attempt(number, label, "label add", "POST",
                                      f"repos/{repo}/issues/{number}/labels", {"labels": [label]})
                    if not ok:
                        fail(number, label, "label add", msg)
                    elif marked:
                        record(number, label, "relabelled")
                    else:
                        ok, msg = attempt(number, label, "notice post", "POST",
                                          f"repos/{repo}/issues/{number}/comments",
                                          {"body": notice_body(label, entry, now)})
                        if ok:
                            record(number, label, "posted")
                        else:
                            attempt(number, label, "label remove", "DELETE",
                                    f"repos/{repo}/issues/{number}/labels/{label}", gone_ok=True)
                            fail(number, label, "notice post", msg)
            except Exception as exc:
                print(f"::warning::reconcile: PR #{number} {label} not reconciled ({type(exc).__name__}: {exc})")
                record(number, label, "unknown", f"reconcile error: {exc}")

    for label in (PARKED_LABEL, HELD_LABEL):
        if label not in current or (label == PARKED_LABEL and wait):
            continue
        for number in sorted(current[label]):
            if number in desired[label]:
                continue
            try:
                pr = by_number.get(number)
                if pr is None:
                    if not discovery_ok:
                        continue
                    reason = "untracked"
                elif delivered_live(pr):
                    reason = "delivered"
                elif label == PARKED_LABEL:
                    continue
                elif number in unclassified:
                    record(number, label, "unknown", unclassified[number])
                    continue
                else:
                    fresh = (fresh_held or (lambda n: is_held(repo, n)))(number)
                    if not (isinstance(fresh, list) and not fresh):
                        continue
                    reason = "released"
                if dry_run:
                    print(f"dry-run: would clear PR #{number} {label} ({reason})")
                    record(number, label, "unknown", "dry-run")
                    continue
                ok, msg = attempt(number, label, "label remove", "DELETE",
                                  f"repos/{repo}/issues/{number}/labels/{label}", gone_ok=True)
                if not ok:
                    fail(number, label, "label remove", msg)
                    continue
                ok, msg = attempt(number, label, "clear notice post", "POST",
                                  f"repos/{repo}/issues/{number}/comments",
                                  {"body": clear_body(label, reason)})
                if ok:
                    record(number, label, "cleared", reason)
                else:
                    fail(number, label, "clear notice post", msg)
            except Exception as exc:
                print(f"::warning::reconcile: PR #{number} {label} not reconciled ({type(exc).__name__}: {exc})")
                record(number, label, "unknown", f"reconcile error: {exc}")

    counts = {name: sum(1 for r in results if r["outcome"] == name) for name in OUTCOMES}
    print("reconcile: " + ", ".join(f"{name}={counts[name]}" for name in OUTCOMES))
    return results


def report_notice_failures(repo: str, failures: list[dict[str, Any]]) -> None:
    """R7: every FAILED stranded-PR write is also written to the roll-up issue.
    Never fatal: the run's exit code does not depend on this comment."""
    failed = [f for f in failures if f.get("outcome") == "FAILED"]
    if not failed:
        return
    lines = [f"- PR #{f['number']} {f['label']}: {f.get('detail') or 'no detail'}" for f in failed]
    body = (
        "## Stranded-PR notices or labels not delivered\n\n"
        "The automatic promotion trigger could not add, repair or remove a stranded-PR label or "
        "notice on this run. Each line names the PR, the label and the refused step.\n\n"
        + "\n".join(lines) + "\n\n" + _footer() + "\n"
    )
    try:
        existing = find_stuck_issue(repo)
        if existing:
            subprocess.run(["gh", "issue", "comment", str(existing["number"]), "--repo", repo, "--body", body],
                           check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        else:
            subprocess.run(["gh", "issue", "create", "--repo", repo, "--title", STUCK_ISSUE_TITLE, "--body", body],
                           check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    except Exception as exc:
        print(f"::warning::could not write the stranded-PR failures to the roll-up issue ({exc})")


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except SystemExit:
        raise
    except Exception as exc:
        # Step 2.2: exit failure only when the trigger itself broke.
        print(f"::error title=Trigger defect::automatic-promotion-candidates raised {type(exc).__name__}: {exc}")
        raise SystemExit(1)
