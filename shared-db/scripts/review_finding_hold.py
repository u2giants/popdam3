#!/usr/bin/env python3
"""Hold a merged change out of production while a review finding blocks it.

Rule 8.6 of popcre/ai-devops plan_skinny-review.md (stage G, #2075): production
promotion is automatic once the change merged, the preview rehearsal passed and
the tests passed, unless a blocking `review-finding` issue references the
change. "References" means an issue labelled `review-finding` whose body
contains the source PR URL (the advisory ai-review workflow writes it).
"Blocking" means open, or closed as not planned within the last 24 hours.

The query runs live, immediately before promotion, never at merge time.

    review_finding_hold.py --pr N          exit 0 clear, 3 held, 2 query error
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Iterable

LABEL = "review-finding"
WINDOW = timedelta(hours=24)


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


def holds(issues: Iterable[dict[str, Any]], repository: str, pr: int, now: datetime) -> list[dict[str, Any]]:
    return [i for i in issues if references(i.get("body"), repository, pr) and blocking(i, now)]


def gh_issues(repository: str) -> list[dict[str, Any]]:
    out = subprocess.run(
        ["gh", "api", "--paginate", "--slurp",
         f"repos/{repository}/issues?labels={LABEL}&state=all&per_page=100"],
        check=True, stdout=subprocess.PIPE, text=True, encoding="utf-8",
    ).stdout
    pages = json.loads(out)
    return [issue for page in pages for issue in page]


def main(argv: list[str] | None = None, fetch: Callable[[str], list[dict[str, Any]]] = gh_issues,
         now: datetime | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pr", required=True, type=int)
    parser.add_argument("--repo", default=os.environ.get("GITHUB_REPOSITORY", ""))
    args = parser.parse_args(argv)
    if not args.repo or args.pr < 1:
        print("::error::review-finding hold: repository and a positive PR number are required", file=sys.stderr)
        return 2
    try:
        issues = fetch(args.repo)
    except (subprocess.CalledProcessError, json.JSONDecodeError, OSError) as exc:
        print(f"::error::review-finding hold: could not query issues ({exc}); treating as held", file=sys.stderr)
        return 2
    found = holds(issues, args.repo, args.pr, now or datetime.now(timezone.utc))
    if found:
        for issue in found:
            why = "open" if issue.get("state") == "open" else "closed as not planned within 24 hours"
            print(f"HELD: review-finding #{issue.get('number')} ({why}) references PR #{args.pr}: {issue.get('html_url')}")
        return 3
    print(f"CLEAR: no blocking review-finding issue references PR #{args.pr}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
