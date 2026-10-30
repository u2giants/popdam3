#!/usr/bin/env python3
"""Hold a merged change out of production while a review finding blocks it.

Rule 8.6 of popcre/ai-devops plan_skinny-review.md (stage G, #2075): production
promotion is automatic once the change merged, the preview rehearsal passed and
the tests passed, unless a blocking `review-finding` issue references the
change. "References" means an issue labelled `review-finding` whose body
contains the source PR URL (the advisory ai-review workflow writes it).
"Blocking" means open, or closed as not planned within the last 24 hours,
except a false finding evidenced by a successful trusted fixer target job.

The query runs live, immediately before promotion, never at merge time.

    review_finding_hold.py --pr N          exit 0 clear, 3 held, 2 query error
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Iterable

LABEL = "review-finding"
WINDOW = timedelta(hours=24)
INVALID_LABEL = "fixer-invalid"
INVALID_MARKER = re.compile(r"<!-- review-fixer-invalid:v1 (\{[^\n]*\}) -->")


def references(body: str | None, repository: str, pr: int) -> bool:
    url = re.escape(f"https://github.com/{repository}/pull/{pr}")
    return re.search(url + r"(?![0-9])", body or "") is not None


def _time(text: str | None) -> datetime | None:
    if not text:
        return None
    return datetime.strptime(text, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)


def blocking(issue: dict[str, Any], now: datetime) -> bool:
    if issue.get("pull_request"):
        return False
    if issue.get("state") == "open":
        return True
    if issue.get("state_reason") == "not_planned":
        closed = _time(issue.get("closed_at"))
        return closed is None or now - closed < WINDOW
    return False


def holds(issues: Iterable[dict[str, Any]], repository: str, pr: int, now: datetime,
          invalid: Callable[[dict[str, Any]], bool] | None = None) -> list[dict[str, Any]]:
    return [i for i in issues if references(i.get("body"), repository, pr) and blocking(i, now)
            and not (invalid is not None and invalid(i))]


def _gh(endpoint: str) -> list[Any]:
    out = subprocess.run(
        ["gh", "api", "--paginate", "--slurp", endpoint],
        check=True, stdout=subprocess.PIPE, text=True, encoding="utf-8",
    ).stdout
    return [item for page in json.loads(out) for item in page]


def _gh_object(endpoint: str) -> dict[str, Any]:
    out = subprocess.run(["gh", "api", endpoint], check=True, stdout=subprocess.PIPE,
                         text=True, encoding="utf-8").stdout
    return json.loads(out)


def _gh_jobs(endpoint: str) -> list[Any]:
    out = subprocess.run(["gh", "api", "--paginate", "--slurp", endpoint], check=True,
                         stdout=subprocess.PIPE, text=True, encoding="utf-8").stdout
    pages = json.loads(out)
    if not isinstance(pages, list) or any(not isinstance(page, dict) or not isinstance(page.get("jobs"), list) for page in pages):
        raise ValueError("unreadable attempt job listing")
    return [job for page in pages for job in page["jobs"]]


def invalid_candidate(issue: dict[str, Any]) -> bool:
    labels = {label.get("name") if isinstance(label, dict) else label for label in issue.get("labels", [])}
    return issue.get("state") == "closed" and issue.get("state_reason") == "not_planned" and INVALID_LABEL in labels


def verified_invalid(issue: dict[str, Any], repository: str, pr: int,
                     comments: Callable[[str], list[Any]] = _gh,
                     run: Callable[[str], dict[str, Any]] = _gh_object,
                     jobs: Callable[[str], list[Any]] = _gh_jobs) -> bool:
    """A label is a candidate, never evidence. Read only that candidate's comments
    and referenced run. Missing, malformed, edited or unreadable proof keeps the
    normal hold; this never grants permission to dispatch or write production."""
    if not invalid_candidate(issue):
        return False
    try:
        reviewed = re.search(r"^Head SHA:\s*`([0-9a-f]{40})`\s*$", issue.get("body", ""), re.M)
        closed = _time(issue.get("closed_at"))
        if not reviewed or not closed:
            return False
        for comment in comments(f"repos/{repository}/issues/{int(issue['number'])}/comments?per_page=100"):
            if comment.get("user", {}).get("login") != "github-actions[bot]" or comment.get("user", {}).get("type") != "Bot":
                continue
            match = INVALID_MARKER.search(comment.get("body", ""))
            if not match:
                continue
            proof = json.loads(match.group(1))
            if not isinstance(proof, dict):
                continue
            run_id = str(proof.get("run_id", ""))
            attempt = str(proof.get("run_attempt", ""))
            run_url = f"https://github.com/{repository}/actions/runs/{run_id}"
            if not (proof.get("repository") == repository and proof.get("issue") == issue["number"]
                    and proof.get("source_pr") == pr and proof.get("reviewed_head") == reviewed.group(1)
                    and isinstance(proof.get("evidence"), str) and proof["evidence"].strip()
                    and re.fullmatch(r"[1-9][0-9]*", run_id) and proof.get("run_url") == run_url
                    and re.fullmatch(r"[1-9][0-9]*", attempt)
                    and isinstance(proof.get("target_branch"), str) and proof["target_branch"].strip()
                    and re.fullmatch(r"[0-9a-f]{40}", str(proof.get("target_head", "")))):
                continue
            job_name = "review-fixer-" + hashlib.sha256(proof["target_branch"].encode("utf-8")).hexdigest()
            if proof.get("job_name") != job_name:
                continue
            detail = run(f"repos/{repository}/actions/runs/{run_id}/attempts/{attempt}")
            if not (detail.get("id") == int(run_id) and detail.get("run_attempt") == int(attempt)
                    and detail.get("html_url") == run_url
                    and detail.get("repository", {}).get("full_name") == repository
                    and detail.get("path") == ".github/workflows/review-fixer.yml"):
                continue
            matching = [job for job in jobs(f"repos/{repository}/actions/runs/{run_id}/attempts/{attempt}/jobs?per_page=100")
                        if isinstance(job.get("name"), str)
                        and (job["name"] == job_name or job["name"].endswith(" / " + job_name))]
            if len(matching) != 1:
                continue
            job = matching[0]
            created = _time(comment.get("created_at"))
            edited = _time(comment.get("updated_at"))
            started = _time(job.get("started_at"))
            finished = _time(job.get("completed_at"))
            if (job.get("run_id") == int(run_id) and job.get("run_attempt") == int(attempt)
                    and job.get("status") == "completed" and job.get("conclusion") == "success"
                    and all((created, edited, started, finished))
                    and started <= created <= closed <= finished and created <= edited <= finished):
                return True
    except (subprocess.CalledProcessError, json.JSONDecodeError, OSError, TypeError, ValueError, KeyError, AttributeError):
        return False
    return False


def invalid_verifier(comments: Callable[[str], list[Any]] = _gh,
                     run: Callable[[str], dict[str, Any]] = _gh_object,
                     jobs: Callable[[str], list[Any]] = _gh_jobs) -> Callable[..., bool]:
    """One candidate-comment read per issue and one run read per referenced run,
    shared across the two listing snapshots and every candidate in this check."""
    comment_cache: dict[str, list[Any]] = {}
    run_cache: dict[str, dict[str, Any]] = {}
    jobs_cache: dict[str, list[Any]] = {}
    def cached(reader, cache, endpoint):
        if endpoint not in cache:
            cache[endpoint] = reader(endpoint)
        return cache[endpoint]
    return lambda issue, repository, pr: verified_invalid(
        issue, repository, pr,
        lambda endpoint: cached(comments, comment_cache, endpoint),
        lambda endpoint: cached(run, run_cache, endpoint),
        lambda endpoint: cached(jobs, jobs_cache, endpoint))


def labelled_issues(repository: str, pr: int, api: Callable[[str], list[Any]] = _gh) -> list[dict[str, Any]]:
    return api(f"repos/{repository}/issues?labels={LABEL}&state=all&per_page=100")


def cross_referenced_issues(repository: str, pr: int, api: Callable[[str], list[Any]] = _gh) -> list[dict[str, Any]]:
    """Issues that mention the PR, from the PR's own timeline. This index is
    separate from the label listing, so one lagging does not hide a finding."""
    found = []
    for event in api(f"repos/{repository}/issues/{pr}/timeline?per_page=100"):
        source = (event.get("source") or {}).get("issue") if event.get("event") == "cross-referenced" else None
        if source and not source.get("pull_request") and any(
            (label.get("name") if isinstance(label, dict) else label) == LABEL for label in source.get("labels", [])
        ):
            found.append(source)
    return found


SOURCES = (labelled_issues, cross_referenced_issues)
SETTLE_SECONDS = 20


def gh_issues(repository: str, pr: int, sources=SOURCES, settle: float = SETTLE_SECONDS,
              sleep: Callable[[float], None] = time.sleep) -> list[dict[str, Any]]:
    """Union of both indexes, read twice with a settle between, newest state wins
    per issue except that any blocking read is kept (fail toward holding)."""
    reads: list[dict[str, Any]] = []
    for attempt in range(2):
        if attempt:
            sleep(settle)
        for source in sources:
            reads.extend(source(repository, pr))
    return reads


def main(argv: list[str] | None = None, fetch: Callable[[str, int], list[dict[str, Any]]] = gh_issues,
         now: datetime | None = None, verify_invalid: Callable[..., bool] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pr", required=True, type=int)
    parser.add_argument("--repo", default=os.environ.get("GITHUB_REPOSITORY", ""))
    args = parser.parse_args(argv)
    if not args.repo or args.pr < 1:
        print("::error::review-finding hold: repository and a positive PR number are required", file=sys.stderr)
        return 2
    try:
        issues = fetch(args.repo, args.pr)
    except (subprocess.CalledProcessError, json.JSONDecodeError, OSError) as exc:
        print(f"::error::review-finding hold: could not query issues ({exc}); treating as held", file=sys.stderr)
        return 2
    verify_invalid = verify_invalid or invalid_verifier()
    invalid_cache: dict[str, bool] = {}
    def invalid(issue):
        # Preserve the existing "any blocking read wins" policy when snapshots
        # disagree; only identical closed candidates share a proof lookup.
        if not invalid_candidate(issue):
            return False
        key = json.dumps(issue, sort_keys=True)
        if key not in invalid_cache:
            invalid_cache[key] = verify_invalid(issue, args.repo, args.pr)
        return invalid_cache[key]
    found = holds(issues, args.repo, args.pr, now or datetime.now(timezone.utc), invalid)
    if found:
        for issue in found:
            why = "open" if issue.get("state") == "open" else "closed as not planned within 24 hours"
            print(f"HELD: review-finding #{issue.get('number')} ({why}) references PR #{args.pr}: {issue.get('html_url')}")
        return 3
    print(f"CLEAR: no blocking review-finding issue references PR #{args.pr}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
