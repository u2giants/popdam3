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
longer than ALERT_AFTER fails this run as a loud advisory alert instead of
skipping silently. It never writes a database.

    automatic_promotion_candidates.py [--dry-run]
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from typing import Any

import review_finding_hold
from production_migration_guard import FOREIGN_TARGET_MIGRATIONS

ACTIVATED_AT = "2026-10-29T23:00:00Z"
WORKFLOW = "shared-supabase-migrations.yml"
MIGRATION_RE = re.compile(r"^supabase/migrations/(\d{14})_[^/]+\.sql$")
MAX_ATTEMPTS = 3
ALERT_AFTER = timedelta(minutes=30)
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
            # A version registered for another database (#5504: the DesignFlow
            # sandbox) never reaches production; promoting it would only fail
            # until MAX_ATTEMPTS parks the lane.
            and m.group(1) not in FOREIGN_TARGET_MIGRATIONS
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
# 2026-10-31: PR #5104, a pure-data load the catalog lexer cannot read). The
# signature is judged PER ATTEMPT and ANY attempt suffices: a re-run must not
# erase the attempt that wrote the versions (2026-11-03: run 41545991868
# attempt 1 applied 20261102202014 and failed only its catalog check; a re-run
# replaced the step signature and the selector retried an already-applied PR
# into ENGINEER ACTION REQUIRED).
APPLY_STEP = "Fresh dry-run, then apply"
CATALOG_STEP = "Post-apply catalog verification"


def applied_despite_catalog_check(jobs: list[dict[str, Any]]) -> bool:
    steps = [s for j in jobs for s in j.get("steps") or []]
    failed = {s.get("name") for s in steps if s.get("conclusion") == "failure"}
    applied = any(s.get("name") == APPLY_STEP and s.get("conclusion") == "success" for s in steps)
    return applied and failed == {CATALOG_STEP}


def run_jobs(repo: str, run_id: int, attempt: int | None = None) -> list[dict[str, Any]]:
    suffix = f"/attempts/{attempt}" if attempt is not None else ""
    return gh(f"repos/{repo}/actions/runs/{run_id}{suffix}/jobs?per_page=100").get("jobs", [])


def attempt_jobs(repo: str, run: dict[str, Any]) -> list[list[dict[str, Any]]]:
    """One job list per attempt. The runs endpoint lists only the LATEST
    attempt, so a re-run hides what earlier attempts did."""
    return [run_jobs(repo, run["id"], a) for a in range(1, int(run.get("run_attempt") or 1) + 1)]


def applied_in_any_attempt(repo: str, run: dict[str, Any]) -> bool:
    return any(applied_despite_catalog_check(jobs) for jobs in attempt_jobs(repo, run))


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


def names_pr(pr: dict[str, Any], title: str) -> bool:
    """True when the run title names every migration version this PR authored.
    Recovery runs title themselves "PR " with no number, so match the versions;
    several versions are one comma-joined word in the title."""
    words = {v for word in title.split() for v in word.split(",")}
    return all(v in words for v in pr["versions"])


def title_versions(title: str) -> set[str]:
    return {v for word in title.split() for v in word.split(",") if re.fullmatch(r"\d{14}", v)}


def decide(prs: list[dict[str, Any]], runs: list[dict[str, Any]], held: callable,
           applied: callable = lambda run: False, main_sha: str = "",
           skipped: list[dict[str, Any]] | None = None,
           refused: callable = lambda run: set()) -> tuple[str, dict[str, Any] | None, str]:
    """Return (action, pr, reason); action is dispatch, wait or idle. Held PRs
    and PRs out of automatic attempts are passed over and appended to `skipped`
    (the latter carry an `exhausted` count instead of `findings`). A PR whose
    versions are all in production is done, whichever run put them there: a
    successful run naming them (a follow-up PR's included) or a production
    preflight that `refused` them as already applied."""
    if any(r.get("status") != "completed" for r in runs):
        return "wait", None, "a migration workflow run is queued or in progress"
    passed_over = 0
    out_of_attempts: list[dict[str, Any]] = []
    for pr in prs:
        tag = f"PR{pr['number']} "
        titles = [(r.get("display_title") or "") + " " for r in runs]
        prod = [r for t, r in zip(titles, runs) if t.startswith("DB production apply") and tag in t]
        if any(r.get("conclusion") == "success" for r in prod):
            continue
        if any(r.get("conclusion") == "failure" and applied(r) for r in prod):
            continue
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
            continue
        findings = held(pr["number"])
        if findings:
            passed_over += 1
            if skipped is not None:
                skipped.append({**pr, "findings": findings if isinstance(findings, list) else []})
            continue
        # Attempts count per main commit: a later merge may be the cure, so it earns fresh tries.
        # The WHOLE automatic cycle counts, not only preview applies (#5532): a failed
        # production apply re-enters through a historical recovery preview that succeeds
        # by design, so counting only preview failures could never bound that loop. A
        # recovery run titles itself "PR " with no number, hence the version match.
        attempts = sum(1 for t, r in zip(titles, runs)
                       if (t.startswith("DB preview apply") or t.startswith("DB production apply"))
                       and (tag in t or names_pr(pr, t))
                       and r.get("created_at", "") > pr["merged_at"]
                       and (not main_sha or f" {main_sha} " in t)
                       and r.get("conclusion") != "success")
        if attempts >= MAX_ATTEMPTS:
            # Out of automatic attempts: passed over like a held PR, with a loud
            # alert in main(), so one dead PR cannot park every later promotion
            # while still refusing to retry it (#5532).
            passed_over += 1
            entry = {**pr, "findings": [], "exhausted": attempts}
            out_of_attempts.append(entry)
            if skipped is not None:
                skipped.append(entry)
            continue
        return "dispatch", pr, f"PR #{pr['number']} versions {','.join(pr['versions'])} not yet in production"
    if passed_over:
        base = "every merged migration PR not held by a review finding or out of automatic attempts is in production"
        if out_of_attempts:
            names = ", ".join(f"PR #{e['number']} ({e['exhausted']} attempts)" for e in out_of_attempts)
            return "idle", None, f"ENGINEER ACTION REQUIRED: {names} out of automatic attempts at this main commit; {base}"
        return "idle", None, base
    return "idle", None, "every merged migration PR since activation is in production"


def earlier_preview_apply(pr: dict[str, Any], runs: list[dict[str, Any]],
                          preview_ok: callable = lambda run: False) -> int | None:
    """The oldest preview apply of this PR whose preview job succeeded, if any."""
    hits = [r for r in runs
            if (r.get("display_title") or "").startswith("DB preview apply") and names_pr(pr, r.get("display_title") or "")
            # A run can fail after preview applied, e.g. at the review-finding hold.
            and (r.get("conclusion") == "success" or preview_ok(r))]
    # A pre-merge rehearsal also leaves the versions on preview, so it is the
    # fallback; the recovery lane refuses an original run whose bytes differ.
    post_merge = [r for r in hits if r.get("created_at", "") > pr["merged_at"]]
    return min(post_merge or hits, key=lambda r: r.get("created_at", ""))["id"] if hits else None


def _time(text: str) -> datetime:
    return datetime.strptime(text, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)


def overdue_holds(skipped: list[dict[str, Any]], now: datetime) -> list[str]:
    """One line per PR held longer than ALERT_AFTER. A PR is held from the later
    of its merge and its oldest blocking finding (unknown findings: the merge).
    PRs out of automatic attempts are not holds and alert on their own."""
    lines = []
    for pr in skipped:
        if pr.get("exhausted"):
            continue
        opened = [_time(f["created_at"]) for f in pr["findings"] if f.get("created_at")]
        since = max(_time(pr["merged_at"]), min(opened)) if opened else _time(pr["merged_at"])
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


def main(now: datetime | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    repo = os.environ["GITHUB_REPOSITORY"]
    main_sha = gh(f"repos/{repo}/commits/main")["sha"]
    skipped: list[dict[str, Any]] = []
    action, pr, reason = decide(merged_migration_prs(repo), workflow_runs(repo), lambda n: is_held(repo, n),
                                lambda run: applied_in_any_attempt(repo, run), main_sha,
                                skipped, lambda run: refused_as_applied(repo, run))
    for entry in skipped:
        if entry.get("exhausted"):
            print(f"exhausted: PR #{entry['number']} out of automatic attempts; later PRs still promote")
            continue
        refs = ", ".join(f"#{f.get('number')}" for f in entry["findings"]) or "an unreadable finding query"
        print(f"held: PR #{entry['number']} by {refs}; later PRs still promote")
    print(f"{action}: {reason}")
    alerts = overdue_holds(skipped, now or datetime.now(timezone.utc))
    if action == "dispatch" and not args.dry_run:
        dispatch(repo, pr, main_sha)
    for line in alerts:
        print(f"::error title=Production release held over 30 minutes::{line}")
    exhausted = [e for e in skipped if e.get("exhausted")]
    for entry in exhausted:
        print(f"::error title=ENGINEER ACTION REQUIRED: automatic attempts exhausted::"
              f"PR #{entry['number']} (versions {','.join(entry['versions'])}) failed {entry['exhausted']} "
              f"automatic attempts at this main commit; later PRs still promote")
    # A failing run is the advisory alert; it blocks nothing.
    return 1 if alerts or exhausted else 0


def dispatch(repo: str, pr: dict[str, Any], main_sha: str) -> None:
    source = [f"merged_preview_source_pr={pr['number']}"]
    original = earlier_preview_apply(pr, workflow_runs(repo), lambda run: preview_job_succeeded_in_any_attempt(repo, run))
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


if __name__ == "__main__":
    raise SystemExit(main())
