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


def merged_migration_prs(repo: str) -> list[dict[str, Any]]:
    pulls = gh(f"repos/{repo}/pulls?state=closed&base=main&sort=updated&direction=desc&per_page=100")
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
        if versions:
            found.append({"number": pr["number"], "merged_at": merged, "versions": versions})
    return sorted(found, key=lambda p: p["merged_at"])


def workflow_runs(repo: str) -> list[dict[str, Any]]:
    data = gh(f"repos/{repo}/actions/workflows/{WORKFLOW}/runs?event=workflow_dispatch&per_page=100&created=>={ACTIVATED_AT[:10]}")
    return data.get("workflow_runs", [])


def decide(prs: list[dict[str, Any]], runs: list[dict[str, Any]], held: callable) -> tuple[str, dict[str, Any] | None, str]:
    """Return (action, pr, reason); action is dispatch, wait or idle."""
    if any(r.get("status") != "completed" for r in runs):
        return "wait", None, "a migration workflow run is queued or in progress"
    for pr in prs:
        tag = f"PR{pr['number']} "
        titles = [(r.get("display_title") or "") + " " for r in runs]
        if any(t.startswith("DB production apply") and tag in t and r.get("conclusion") == "success"
               for t, r in zip(titles, runs)):
            continue
        if held(pr["number"]):
            return "wait", pr, f"PR #{pr['number']} is held by a blocking review finding"
        attempts = sum(1 for t, r in zip(titles, runs)
                       if t.startswith("DB preview apply") and tag in t and r.get("created_at", "") > pr["merged_at"]
                       and r.get("conclusion") != "success")
        if attempts >= MAX_ATTEMPTS:
            return "wait", pr, f"ENGINEER ACTION REQUIRED: PR #{pr['number']} failed {attempts} automatic attempts"
        return "dispatch", pr, f"PR #{pr['number']} versions {','.join(pr['versions'])} not yet in production"
    return "idle", None, "every merged migration PR since activation is in production"


def is_held(pr: int) -> bool:
    rc = subprocess.run([sys.executable, os.path.join(HERE, "review_finding_hold.py"), "--pr", str(pr)]).returncode
    return rc != 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    repo = os.environ["GITHUB_REPOSITORY"]
    action, pr, reason = decide(merged_migration_prs(repo), workflow_runs(repo), is_held)
    print(f"{action}: {reason}")
    if action != "dispatch" or args.dry_run:
        return 0
    main_sha = gh(f"repos/{repo}/commits/main")["sha"]
    subprocess.run(
        ["gh", "workflow", "run", WORKFLOW, "--repo", repo, "--ref", "main",
         "-f", "target=preview", "-f", "mode=apply", "-f", f"commit_sha={main_sha}",
         "-f", f"preview_allowlist={','.join(pr['versions'])}",
         "-f", f"merged_preview_source_pr={pr['number']}"],
        check=True,
    )
    print(f"Dispatched the post-merge preview rehearsal for PR #{pr['number']} at {main_sha}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
