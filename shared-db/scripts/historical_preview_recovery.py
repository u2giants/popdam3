#!/usr/bin/env python3
"""Prove already-merged PRs authored an exact historical preview batch.

WHY A PER-VERSION SOURCE MAP EXISTS
-----------------------------------
The original proof took ONE source PR and required it to have authored EVERY
allowlisted migration. That holds for a batch written in a single pull request
and fails for any batch assembled over time.

Sample Tracking Release A is the latter, and it is not unusual: its three
approved versions were authored by three different merged PRs -- 20260814130000
by #984, 20260814193402 by #992, and the owner-authorized reconciliation
20260818024441 by #1126. With a single-PR proof there was no way to promote a
batch that preview had genuinely already rehearsed, and no way to re-rehearse it
either, because an applied version can never be re-applied to preview.

So a batch may now name a source PR PER VERSION. Every version still has to be
proven individually, to the same standard as before:

  - its PR is merged,
  - that PR's merge commit is an ancestor of the exact main being promoted,
  - and that PR ADDED that exact migration file.

The map is therefore not a weakening. It is the same proof, applied per version
instead of assumed to be shared. A caller cannot invent a mapping: a version's
file is only ever "added" once in history, so naming the wrong PR fails.

WHY THE ORIGINAL APPLY RUN MUST BE NAMED
---------------------------------------
Authorship and ledger presence together still do not say WHICH BYTES preview
executed. Preview once listed 20260814130000 while missing tables, a view,
functions, triggers and indexes it should have created, because an intermediate
version of the file had been applied and then changed before merge. That is the
entire reason the reconciliation migration exists, and it is also the shape of a
deliberate attack: rehearse harmless bytes A, amend the file to destructive
bytes B, merge, then recover "proof" and promote B.

So a recovery record must ALSO name, per version, the preview run that
originally applied it. `--original-run-map` carries that, and
`prove_historical_original_apply_runs` in production_business_risk_gate.py
downloads each named run's own evidence and byte-compares the digest IT recorded
for that version against the file on exact main. A version whose bytes changed
after its rehearsal can no longer be recovered, which is the correct outcome:
preview never ran those bytes.

WHAT THIS PROOF STILL DOES NOT ESTABLISH
----------------------------------------
It does not prove preview's CATALOG matches its ledger -- a half-applied or
manually repaired preview still looks the same from here. And the original run's
own machinery was whatever main carried on the day it ran; it is not re-pinned
to today's main, because an old commit necessarily carries older producer files.

STATED AS THE GATE ENFORCES IT, not as a strength comparison. The earlier
sentence here -- "as strong as the ordinary claim lane was on the day of the
rehearsal, and no stronger" -- was withdrawn as FALSE (#1213 review, rounds 5
and 6) and must not come back. The claim lane pins both of a run's commits to
exact main, so a doctored intermediate commit can never be the promoted
rehearsal; this lane pins them to the authoring pull request's merge commit
instead, which is weaker in a specific, named way.

PROVED by prove_historical_original_apply_runs in
production_business_risk_gate.py: a real, successful, dispatched run of the
preview workflow, whose dispatch ref and checkout both carry the producer code of
the merge commit that landed the version, moved preview's ledger for that version
and recorded a digest equal to the bytes on exact main.

NOT PROVED: which preview INSTANCE that run wrote to (preview was deleted and
rebuilt on 2026-08-18, so requiring today's instance would refuse every recovery
that exists), and that TODAY'S machinery produced the evidence.
"""

import argparse, json, re, subprocess
from pathlib import Path

REPO = "u2giants/shared-db"
# v3/v4 supersede v1/v2, which carried no originalApplyRuns. A stale v1/v2
# artifact is refused by the gate rather than silently accepted, because the
# record it re-derives now always carries the field.
SCHEMA_V3 = "shared-db-historical-preview-source/v3"
SCHEMA_V4 = "shared-db-historical-preview-source/v4"


def gh(endpoint):
    return json.loads(subprocess.run(["gh", "api", endpoint], check=True, text=True,
        stdout=subprocess.PIPE, encoding="utf-8").stdout)


def parse_versions(allowlist):
    versions = [v.strip() for v in allowlist.split(",") if v.strip()]
    if not versions or versions != sorted(set(versions)) or any(not re.fullmatch(r"\d{14}", v) for v in versions):
        raise ValueError("historical preview allowlist must be unique, ordered 14-digit versions")
    return versions


def parse_source_map(raw, versions):
    """Parse `version:pr,version:pr` and require it to cover the batch EXACTLY.

    Exactly, not loosely: a map missing a version would silently fall back to
    proving nothing for it, and a map naming an extra version would let an
    unrelated PR be dragged into the evidence.
    """
    mapping = {}
    for entry in [e.strip() for e in raw.split(",") if e.strip()]:
        if not re.fullmatch(r"\d{14}:\d+", entry):
            raise ValueError("historical source map entries must be version:pull-request")
        version, pr = entry.split(":")
        if version in mapping:
            raise ValueError(f"historical source map names {version} more than once")
        mapping[version] = int(pr)
    if sorted(mapping) != sorted(versions):
        raise ValueError("historical source map must name exactly the allowlisted versions")
    return mapping


def parse_original_run_map(raw, versions):
    """Parse `version:runId,...` and require it to cover the batch EXACTLY.

    Exactly, for the same reason the source map is exact: a missing version
    would silently waive the byte comparison for it, which is the whole point of
    the field.
    """
    mapping = {}
    for entry in [e.strip() for e in (raw or "").split(",") if e.strip()]:
        if not re.fullmatch(r"\d{14}:\d+", entry):
            raise ValueError("historical original-run map entries must be version:run-id")
        version, run = entry.split(":")
        if version in mapping:
            raise ValueError(f"historical original-run map names {version} more than once")
        if int(run) <= 0:
            raise ValueError(f"historical original-run map has a non-positive run id for {version}")
        mapping[version] = int(run)
    if sorted(mapping) != sorted(versions):
        raise ValueError("historical original-run map must name exactly the allowlisted versions")
    return mapping


def prove_pr_authored(source_pr, main_sha, versions, repo, api):
    """One PR, merged, an ancestor of exact main, and the author of `versions`."""
    pr = api(f"repos/{REPO}/pulls/{source_pr}")
    if pr.get("merged") is not True or not re.fullmatch(r"[0-9a-f]{40}", str(pr.get("merge_commit_sha"))):
        raise ValueError(f"historical source PR {source_pr} is not merged")
    subprocess.run(["git", "merge-base", "--is-ancestor", pr["merge_commit_sha"], main_sha], cwd=repo, check=True)
    files = {}
    page = 1
    while True:
        batch = api(f"repos/{REPO}/pulls/{source_pr}/files?per_page=100&page={page}")
        for item in batch:
            files[item.get("filename", "")] = item.get("status")
        if len(batch) < 100:
            break
        page += 1
    for version in versions:
        matches = list(repo.glob(f"supabase/migrations/{version}_*.sql"))
        relative = matches[0].relative_to(repo).as_posix() if len(matches) == 1 else ""
        if len(matches) != 1 or files.get(relative) != "added":
            raise ValueError(f"source PR {source_pr} did not author the exact migration {version}")
    return pr["merge_commit_sha"]


def verify(source_pr, main_sha, allowlist, repo=Path.cwd(), api=gh, source_map=None,
           original_run_map=None):
    versions = parse_versions(allowlist)
    # NOT OPTIONAL. Without it the recovery lane waives byte equality entirely,
    # which is exactly the hole this field closes.
    runs = parse_original_run_map(original_run_map, versions)
    if source_map:
        mapping = parse_source_map(source_map, versions)
        merges = {
            version: prove_pr_authored(pr, main_sha, [version], repo, api)
            for version, pr in sorted(mapping.items())
        }
        return {"schema": SCHEMA_V4, "sourcePrMap": {v: mapping[v] for v in sorted(mapping)},
                "sourceMergeShas": merges, "mainSha": main_sha, "allowlist": versions,
                "originalApplyRuns": {v: runs[v] for v in sorted(runs)}}
    merge_sha = prove_pr_authored(source_pr, main_sha, versions, repo, api)
    return {"schema": SCHEMA_V3, "sourcePr": source_pr,
            "sourceMergeSha": merge_sha, "mainSha": main_sha, "allowlist": versions,
            "originalApplyRuns": {v: runs[v] for v in sorted(runs)}}


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--source-pr", type=int)
    p.add_argument("--source-map", default="")
    p.add_argument("--original-run-map", required=True,
                   help="version:runId,... naming the preview run that ORIGINALLY applied each "
                        "version. The production gate byte-compares each run's recorded manifest "
                        "against exact main, so this is not a label -- it is the proof.")
    p.add_argument("--main-sha", required=True)
    p.add_argument("--allowlist", required=True)
    p.add_argument("--output", type=Path, required=True)
    a = p.parse_args()
    if not a.source_map and a.source_pr is None:
        print("::error::Historical preview recovery needs --source-pr or --source-map"); raise SystemExit(2)
    if a.source_map and a.source_pr is not None:
        print("::error::Historical preview recovery takes --source-pr or --source-map, not both"); raise SystemExit(2)
    try:
        result = verify(a.source_pr, a.main_sha, a.allowlist, source_map=a.source_map,
                        original_run_map=a.original_run_map)
    except (ValueError, subprocess.CalledProcessError) as exc:
        print(f"::error::Historical preview recovery rejected: {exc}"); raise SystemExit(2)
    a.output.write_text(json.dumps(result, sort_keys=True) + "\n", encoding="utf-8")
