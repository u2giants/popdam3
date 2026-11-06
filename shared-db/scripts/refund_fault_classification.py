#!/usr/bin/env python3
"""Classify a failed migration-lane run's fault for the refund-eligible marker.

Plan: plan_go-live-lane-prevention.md §9 step 2.1 (issue #5782). The
`refund-eligible-fault` workflow step inside the `preview` and `Production apply
(automatic evidence gates)` jobs runs this on its own job's failed-step logs.
Exit 0 IS the machine-readable marker: the promotion selector refunds a run
whose attempt carries a succeeded `refund-eligible-fault` step
(scripts/automatic_promotion_candidates.py `refund_eligible_in_any_attempt`).
Any other exit means the failure is a change fault and keeps the status quo.

Classification (plan §6 "both classes", §9 2.1):
  - infrastructure: the workflow's own marker `CI INFRASTRUCTURE:` accompanied
    by `NO MIGRATION WAS APPLIED` (both phrases; a mixed log that claims
    infrastructure without "NO MIGRATION WAS APPLIED" is NOT refundable),
  - a coordination refusal: a pin/lane refusal whose wording identifies it
    (the §9 strings plus the #5856 main-staleness wordings).
Everything else (SQL errors, guard refusals, witness rejections) is a change
fault. GitHub run metadata is external input (plan §9 2.4): this classifier
never trusts a step name, a run title, or a foreign workflow — only the failure
text of the job that ran the marker.

    refund_fault_classification.py [log-file]      # classify a saved log (or stdin)
    refund_fault_classification.py --classify-run-job "JOB NAME"
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys

INFRA_MARKER = "CI INFRASTRUCTURE:"
NOTHING_APPLIED = "NO MIGRATION WAS APPLIED"

# Coordination refusals: the run was refused by the coordination machinery
# (pin checks, lane locks, guarded-merge wait) before it could fault the change.
COORDINATION_REFUSALS = (
    "production lane requires the exact current main SHA",
    "post-merge preview rehearsal requires the exact current main SHA",
    "historical preview recovery requires the exact current main SHA",
    "a guarded merge is active; production promotion must wait",
    # #5856 staleness wordings (check-main-tip-freshness / lane re-dispatch):
    "has moved past the dispatched commit",
    "has advanced past the dispatched commit",
    "does not contain the dispatched commit",
    "ENGINEER ACTION REQUIRED: main moved after preview",
)

ANSI_RE = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")


def classify_failure(text: str) -> bool:
    """True only for a refund-eligible infrastructure or coordination failure.

    The mixed-marker adversarial case (plan §9 2.4): a log carrying
    `CI INFRASTRUCTURE:` alongside a real SQL `ERROR:` failure but without
    `NO MIGRATION WAS APPLIED` must NOT refund — the second phrase is required
    exactly so a run whose migration actually failed is never excused.
    """
    clean = ANSI_RE.sub("", text or "")
    if INFRA_MARKER in clean and NOTHING_APPLIED in clean:
        return True
    return any(marker in clean for marker in COORDINATION_REFUSALS)


def classify_run_job(job_name: str, gh: callable = None) -> bool:
    """Classify this run attempt's named job from its failed-step logs.

    The marker step passes its own job's display name; the job id is resolved
    from this attempt's job listing so a re-run classifies only its own attempt
    (plan §9 2.2: a re-run must not hide an earlier attempt's classification —
    the selector reads markers per attempt separately).
    """
    gh = gh or subprocess.run
    repo = os.environ["GITHUB_REPOSITORY"]
    run_id = os.environ["GITHUB_RUN_ID"]
    attempt = os.environ.get("GITHUB_RUN_ATTEMPT", "1")
    listing = json.loads(gh(
        ["gh", "api", f"repos/{repo}/actions/runs/{run_id}/attempts/{attempt}/jobs?per_page=100"],
        check=True, stdout=subprocess.PIPE, text=True, encoding="utf-8").stdout)
    jobs = [job for page in listing for job in page.get("jobs", [])] if isinstance(listing, list) else listing.get("jobs", [])
    matching = [job for job in jobs if job.get("name") == job_name]
    if len(matching) != 1:
        print(f"::warning::refund-eligible-fault: could not resolve exactly one job named {job_name!r}; "
              "treating this failure as a change fault")
        return False
    log = gh(["gh", "run", "view", "--repo", repo, "--job", str(matching[0]["id"]), "--log-failed"],
             check=True, stdout=subprocess.PIPE, text=True, encoding="utf-8", errors="replace").stdout
    return classify_failure(log)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("log", nargs="?", help="failed-step log file (default: stdin)")
    parser.add_argument("--classify-run-job", metavar="JOB_NAME",
                        help="classify this run attempt's named job from its failed-step logs")
    args = parser.parse_args(argv)
    try:
        if args.classify_run_job:
            eligible = classify_run_job(args.classify_run_job)
        else:
            if args.log:
                with open(args.log, encoding="utf-8", errors="replace") as handle:
                    text = handle.read()
            else:
                text = sys.stdin.read()
            eligible = classify_failure(text)
    except (subprocess.CalledProcessError, OSError, ValueError, KeyError) as exc:
        # Fail safe: unreadable evidence is never a refund (the status quo keeps
        # counting the run), and the reason is named for the log reader.
        print(f"::warning::refund-eligible-fault: failure evidence unreadable ({exc}); "
              "treating this failure as a change fault")
        return 1
    if eligible:
        print("::notice title=refund-eligible-fault::classified as an infrastructure or coordination "
              "failure (not a fault in the change under review); REFUND_ELIGIBLE=1")
        output = os.environ.get("GITHUB_OUTPUT")
        if output:
            with open(output, "a", encoding="utf-8") as handle:
                handle.write("REFUND_ELIGIBLE=1\n")
        return 0
    print("refund-eligible-fault: change fault (no infrastructure/coordination marker); no refund")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
