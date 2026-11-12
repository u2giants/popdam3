#!/usr/bin/env python3
"""Classify a failed migration-lane run's fault for the refund-eligible marker.

Plan: plan_go-live-lane-prevention.md §9 step 2.1 (issue #5782). The
`refund-eligible-fault` workflow step inside the `preview` and `Production apply
(automatic evidence gates)` jobs runs this on its own job's failure evidence.
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
fault.

TRUST MODEL (amended 2026-11-12, issue #6119 residual / PR #6148 note). The
original §9 2.4 pin said this classifier reads "only the failure text of the
job that ran the marker" and never a step name, a run title, or a foreign
workflow. That source is unimplementable in-job: the marker runs INSIDE the
job it inspects, and the job's log blob does not exist until the job completes
(`gh run view --job <id> --log-failed` exits 1 with "still in progress"; the
jobs-logs endpoint answers BlobNotFound). Evidence is now what GitHub does
expose while the job runs, and nothing else:
  1. the jobs API listing of THIS run attempt
     (`gh api repos/{repo}/actions/runs/{id}/attempts/{n}/jobs`) — used only to
     resolve this job by its display name and reach its check run;
  2. that job's own check-run annotations — the `::error::` / `::warning::`
     workflow-command text its steps emitted. The taxonomy phrases are matched
     against that marker text and nothing else. A step name, a run title, a
     foreign workflow, and any plain log line can never buy a refund: only the
     job's own workflow-command markers count, and the both-phrases rule still
     refuses a mixed marker.
Why this is safe: scripts/refund_fault_classification.py is pinned in the
preview executed surface (scripts/production_business_risk_gate.py), so a
doctored copy cannot silently bless a change fault; the marker is a STEP named
exactly `refund-eligible-fault`, never a job (the six-job run-shape invariant
`total_count === 6` at scripts/manage-migration-coordination.mjs must keep
passing). Unreadable or ambiguous evidence stays a change fault — a refund is
never inferred.

    refund_fault_classification.py [log-file]      # classify a saved log (or stdin)
    refund_fault_classification.py --classify-run-job "JOB NAME"
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import time
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

# GitHub publishes check-run annotations with a lag of seconds behind the
# emitting step (run 43303160414: marker fetched ~1s after the step failed and
# read a pre-publication list). Retry briefly before concluding; the marker
# must not hold the job hostage — bounded to ~29 seconds total.
ANNOTATION_PUBLICATION_DELAYS = (2, 4, 8, 15)


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


def classify_run_job(job_name: str, gh: callable = None, sleep: callable = None) -> bool:
    """Classify this run attempt's named job from its own marker annotations.

    The marker step passes its own job's display name; the job is resolved from
    this attempt's job listing so a re-run classifies only its own attempt
    (plan §9 2.2: a re-run must not hide an earlier attempt's classification —
    the selector reads markers per attempt separately). The failure text is the
    job's check-run annotations (the trust-model amendment in the module
    docstring: logs are not readable while the job runs).

    GitHub publishes check-run annotations with a lag of seconds behind the
    emitting step; a fetch immediately after the failure can see a pre-
    publication empty list (run 43303160414). When the annotation fetch returns
    nothing usable (empty list or the check run is not yet present), retry with
    bounded backoff (ANNOTATION_PUBLICATION_DELAYS, ~29 s max) before concluding.
    After the bound, unreadable/ambiguous evidence is still a change fault — a
    refund is never inferred.
    """
    gh = gh or subprocess.run
    sleep = sleep or time.sleep
    repo = os.environ["GITHUB_REPOSITORY"]
    run_id = os.environ["GITHUB_RUN_ID"]
    attempt = os.environ.get("GITHUB_RUN_ATTEMPT", "1")

    def _fetch_listing():
        raw = json.loads(gh(
            ["gh", "api", f"repos/{repo}/actions/runs/{run_id}/attempts/{attempt}/jobs?per_page=100"],
            check=True, stdout=subprocess.PIPE, text=True, encoding="utf-8").stdout)
        return ([job for page in raw for job in page.get("jobs", [])]
                if isinstance(raw, list) else raw.get("jobs", []))

    # Resolve the job once — the marker runs inside it, so it is in the listing.
    matching = [job for job in _fetch_listing() if job.get("name") == job_name]
    if len(matching) != 1:
        print(f"::warning::refund-eligible-fault: could not resolve exactly one job named {job_name!r}; "
              "treating this failure as a change fault")
        return False

    # Bounded retry for GitHub's annotation-publication lag.  The `::error::`
    # workflow-command annotations lag behind the emitting step while generic
    # GitHub annotations (e.g. "Process completed with exit code …") appear
    # immediately — so an early fetch can see a non-empty list that still lacks
    # the taxonomy marker (run 43305244649).  Retry whenever classification
    # cannot yet find an infrastructure/coordination marker.
    for i in range(len(ANNOTATION_PUBLICATION_DELAYS) + 1):
        if i:
            sleep(ANNOTATION_PUBLICATION_DELAYS[i - 1])
            # Re-fetch the listing in case the check run appeared late.
            matching = [job for job in _fetch_listing() if job.get("name") == job_name]
            if len(matching) != 1:
                break
        check_run_url = (matching[0].get("check_run_url") or "").strip()
        if not check_run_url:
            continue  # check run not yet present; retry
        annotations = json.loads(gh(
            ["gh", "api", f"{check_run_url}/annotations", "--paginate"],
            check=True, stdout=subprocess.PIPE, text=True, encoding="utf-8").stdout)
        if isinstance(annotations, dict):
            annotations = annotations.get("annotations", [])
        text = "\n".join(
            f"{annotation.get('title') or ''}\n{annotation.get('message') or ''}"
            for annotation in annotations)
        print(f"::warning::refund-eligible-fault: attempt {i}: {len(annotations)} annotations, "
              f"snippet={text[:120]!r}")
        if classify_failure(text):
            return True
        # No taxonomy marker yet — publication lag; retry within the bound.

    # After the bound: evidence never produced a marker.  Fail-safe: change fault.
    print("::warning::refund-eligible-fault: no infrastructure/coordination marker after bounded retry; "
          "treating this failure as a change fault")
    return False


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("log", nargs="?", help="failed-step log file (default: stdin)")
    parser.add_argument("--classify-run-job", metavar="JOB_NAME",
                        help="classify this run attempt's named job from its own marker annotations")
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
