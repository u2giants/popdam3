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

It stops at the first PR it cannot move (held, in flight, or out of retries),
so migrations are never promoted out of order. It never writes a database.

    automatic_promotion_candidates.py [--dry-run]
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from typing import Any

ACTIVATED_AT = "2026-10-29T23:00:00Z"
WORKFLOW = "shared-supabase-migrations.yml"
MIGRATION_RE = re.compile(r"^supabase/migrations/(\d{14})_[^/]+\.sql$")
MAX_ATTEMPTS = 3
HERE = os.path.dirname(os.path.abspath(__file__))


def gh(*args: str) -> Any:
    out = subprocess.run(["gh", "api", *args], check=True, stdout=subprocess.PIPE, text=True, encoding="utf-8").stdout
    return json.loads(out) if out.strip() else None


def registered_orphan_versions() -> set[str]:
    """Orphan versions pinned by the reviewed preview-ledger reconciliation manifest."""
    path = os.path.join(os.path.dirname(HERE), "config", "preview-ledger-orphan-reconciliations.json")
    try:
        with open(path, encoding="utf-8") as fh:
            cases = json.load(fh).get("cases", [])
        return {c.get("orphan_version") for c in cases if c.get("orphan_version")}
    except (OSError, ValueError):
        return set()


def merged_migration_prs(repo: str) -> list[dict[str, Any]]:
    pulls = gh(f"repos/{repo}/pulls?state=closed&base=main&sort=updated&direction=desc&per_page=100")
    manifest_orphans = registered_orphan_versions()
    found = []
    for pr in pulls:
        merged = pr.get("merged_at")
        if not merged or merged <= ACTIVATED_AT:
            continue
        files = gh("--paginate", "--slurp", f"repos/{repo}/pulls/{pr['number']}/files?per_page=100")
        versions = sorted(
            m.group(1)
            for page in files for f in page
            if f.get("status") == "added" and (m := MIGRATION_RE.match(f.get("filename", "")))
        )
        # Superseded-by-manifest (#5128/#5213): a merged PR whose every added
        # version is a registered preview-ledger orphan (a governed replacement
        # version carries the change in config/preview-ledger-orphan-reconciliations.json)
        # can never be promoted -- its attempt counter would otherwise park the
        # lane forever once MAX_ATTEMPTS failed preview applies accumulate
        # (observed 2026-10-31: PR #5129 vs stranded 20261030125352).
        if versions and not all(v in manifest_orphans for v in versions):
            found.append({"number": pr["number"], "merged_at": merged, "versions": versions})
    return sorted(found, key=lambda p: p["merged_at"])


def workflow_runs(repo: str) -> list[dict[str, Any]]:
    # Every page: a PR's old production success must not age out of the window,
    # or the lane re-promotes it and parks on it (observed 2026-11-01: PR #5045).
    pages = gh("--paginate", "--slurp", f"repos/{repo}/actions/workflows/{WORKFLOW}/runs?event=workflow_dispatch&per_page=100&created=>={ACTIVATED_AT[:10]}")
    return [run for page in pages for run in page.get("workflow_runs", [])]


# A production apply whose atomic apply step succeeded but whose only failed
# step is the post-apply catalog check has written its versions (observed
# 2026-10-31: PR #5104, a pure-data load the catalog lexer cannot read).
APPLY_STEP = "Fresh dry-run, then apply"
CATALOG_STEP = "Post-apply catalog verification"


def applied_despite_catalog_check(jobs: list[dict[str, Any]]) -> bool:
    steps = [s for j in jobs for s in j.get("steps") or []]
    failed = {s.get("name") for s in steps if s.get("conclusion") == "failure"}
    applied = any(s.get("name") == APPLY_STEP and s.get("conclusion") == "success" for s in steps)
    return applied and failed == {CATALOG_STEP}


def run_jobs(repo: str, run_id: int) -> list[dict[str, Any]]:
    return gh(f"repos/{repo}/actions/runs/{run_id}/jobs?per_page=100").get("jobs", [])


def decide(prs: list[dict[str, Any]], runs: list[dict[str, Any]], held: callable,
           applied: callable = lambda run: False, main_sha: str = "") -> tuple[str, dict[str, Any] | None, str]:
    """Return (action, pr, reason); action is dispatch, wait or idle."""
    if any(r.get("status") != "completed" for r in runs):
        return "wait", None, "a migration workflow run is queued or in progress"
    for pr in prs:
        tag = f"PR{pr['number']} "
        titles = [(r.get("display_title") or "") + " " for r in runs]
        prod = [r for t, r in zip(titles, runs) if t.startswith("DB production apply") and tag in t]
        if any(r.get("conclusion") == "success" for r in prod):
            continue
        if any(r.get("conclusion") == "failure" and applied(r) for r in prod):
            continue
        if held(pr["number"]):
            return "wait", pr, f"PR #{pr['number']} is held by a blocking review finding"
        # Attempts count per main commit: a later merge may be the cure, so it earns fresh tries.
        attempts = sum(1 for t, r in zip(titles, runs)
                       if t.startswith("DB preview apply") and tag in t and r.get("created_at", "") > pr["merged_at"]
                       and (not main_sha or f" {main_sha} " in t)
                       and r.get("conclusion") != "success")
        if attempts >= MAX_ATTEMPTS:
            return "wait", pr, f"ENGINEER ACTION REQUIRED: PR #{pr['number']} failed {attempts} automatic attempts"
        return "dispatch", pr, f"PR #{pr['number']} versions {','.join(pr['versions'])} not yet in production"
    return "idle", None, "every merged migration PR since activation is in production"


def earlier_preview_apply(pr: dict[str, Any], runs: list[dict[str, Any]],
                          preview_ok: callable = lambda run: False) -> int | None:
    """The oldest post-merge preview apply of this PR whose preview job succeeded, if any."""
    # Recovery runs title themselves "PR " with no number, so match the versions.
    def names_pr(title: str) -> bool:
        # Several versions are one comma-joined word in the title.
        words = {v for word in title.split() for v in word.split(",")}
        return all(v in words for v in pr["versions"])
    hits = [r for r in runs
            if (r.get("display_title") or "").startswith("DB preview apply") and names_pr(r.get("display_title") or "")
            and r.get("created_at", "") > pr["merged_at"]
            # A run can fail after preview applied, e.g. at the review-finding hold.
            and (r.get("conclusion") == "success" or preview_ok(r))]
    return min(hits, key=lambda r: r.get("created_at", ""))["id"] if hits else None


def is_held(pr: int) -> bool:
    rc = subprocess.run([sys.executable, os.path.join(HERE, "review_finding_hold.py"), "--pr", str(pr)]).returncode
    return rc != 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    repo = os.environ["GITHUB_REPOSITORY"]
    main_sha = gh(f"repos/{repo}/commits/main")["sha"]
    action, pr, reason = decide(merged_migration_prs(repo), workflow_runs(repo), is_held,
                                lambda run: applied_despite_catalog_check(run_jobs(repo, run["id"])), main_sha)
    print(f"{action}: {reason}")
    if action != "dispatch" or args.dry_run:
        return 0
    source = [f"merged_preview_source_pr={pr['number']}"]
    original = earlier_preview_apply(pr, workflow_runs(repo), lambda run: any(
        j.get("name") == "preview" and j.get("conclusion") == "success" for j in run_jobs(repo, run["id"])))
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
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
