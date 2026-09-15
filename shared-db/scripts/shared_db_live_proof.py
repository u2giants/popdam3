#!/usr/bin/env python3
"""Produce the durable live-proof file `--complete-outcome` re-derives (issue #2906).

WHY THIS EXISTS
---------------
`--complete-outcome` refuses to publish an outcome's completion record until it
can re-derive live proof from a successful Actions run in the outcome's
`application_return_to` repository, at `application_commit_sha`, carrying an
unexpired artifact named `shared-db-live-proof-<issue>-<sha>` that holds
`db-live-proof.json`. No workflow produced that artifact, so an outcome whose
application is shared-db itself (first live case: #2848) could never complete.

WHAT IT PROVES, AND WHAT IT REFUSES
----------------------------------
The live assertion is read verbatim from the issue's own `db-work-scope` block,
never from a workflow input, so a caller cannot restate it. The committed probe
`.github/live-proofs/<issue>.sql` is sent to production through the Management
API with `read_only: true`, so the server forbids a write. The proof is written
ONLY when the probe returns exactly one row whose `passed` is true. Any other
shape, an issue that does not return to shared-db, or an absent assertion is a
hard failure and no file is written.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

SHARED_DB = "u2giants/shared-db"
PROJECT_REF = "qsllyeztdwjgirsysgai"
SHA = re.compile(r"^[0-9a-f]{40}$")
SCOPE_FENCE = re.compile(r"```db-work-scope\s*\n(.*?)```", re.S)


class LiveProofError(Exception):
    pass


def scope_field(body: str, name: str) -> str | None:
    blocks = SCOPE_FENCE.findall(body or "")
    if len(blocks) != 1:
        raise LiveProofError("issue must carry exactly one db-work-scope block")
    values = [line.split(":", 1)[1].strip() for line in blocks[0].splitlines()
              if line.startswith(f"{name}:")]
    if len(values) > 1:
        raise LiveProofError(f"db-work-scope repeats {name}")
    return values[0] if values and values[0] else None


def build_proof(*, issue: dict, work_issue: int, probe_sql: str, commit_sha: str,
                query, now=None) -> dict:
    if not isinstance(work_issue, int) or work_issue <= 0:
        raise LiveProofError("work_issue must be a positive integer")
    if int(issue.get("number", 0)) != work_issue:
        raise LiveProofError(f"issue payload is not #{work_issue}")
    if not SHA.match(commit_sha or ""):
        raise LiveProofError("commit sha must be an exact lowercase 40-character SHA")
    body = issue.get("body") or ""
    if scope_field(body, "work_type") != "structural":
        raise LiveProofError("only a structural outcome has a live proof")
    if scope_field(body, "application_return_to") != SHARED_DB:
        raise LiveProofError(f"application_return_to is not {SHARED_DB}; the owning application must prove it")
    assertion = scope_field(body, "live_assertion")
    if not assertion:
        raise LiveProofError("issue scope has no live_assertion")
    if not (probe_sql or "").strip():
        raise LiveProofError("probe SQL is empty")
    rows = query(probe_sql)
    if not (isinstance(rows, list) and len(rows) == 1 and isinstance(rows[0], dict)
            and set(rows[0]) == {"passed"} and rows[0]["passed"] is True):
        raise LiveProofError(f"probe did not return exactly one row with passed = true: {json.dumps(rows)[:500]}")
    observed = (now or datetime.now(timezone.utc)).strftime("%Y-%m-%dT%H:%M:%SZ")
    return {
        "schema_version": 1,
        "work_issue": work_issue,
        "application_commit_sha": commit_sha,
        "live_assertion": assertion,
        "environment": "production",
        "result": "passed",
        "observed_at": observed,
    }


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--work-issue", type=int, required=True)
    parser.add_argument("--issue-json", type=Path, required=True)
    parser.add_argument("--probe", type=Path, required=True)
    parser.add_argument("--commit-sha", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(argv)
    import os
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from production_catalog_verification import run_query

    token = os.environ.get("SUPABASE_ACCESS_TOKEN") or ""
    if not token:
        raise LiveProofError("SUPABASE_ACCESS_TOKEN is not set")
    if not args.probe.is_file():
        raise LiveProofError(f"no committed probe at {args.probe}")
    proof = build_proof(
        issue=json.loads(args.issue_json.read_text(encoding="utf-8")),
        work_issue=args.work_issue,
        probe_sql=args.probe.read_text(encoding="utf-8"),
        commit_sha=args.commit_sha,
        query=lambda sql: run_query(PROJECT_REF, token, sql),
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(proof, indent=2) + "\n", encoding="utf-8")
    print(f"LIVE PROOF PASSED: #{proof['work_issue']} at {proof['application_commit_sha']} observed_at {proof['observed_at']}")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except LiveProofError as exc:
        print(f"REFUSED: {exc}", file=sys.stderr)
        sys.exit(1)
