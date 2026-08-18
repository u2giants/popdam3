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

WHAT THIS PROOF DOES NOT ESTABLISH
----------------------------------
It proves authorship and ledger presence. It does NOT prove that preview's
CATALOG matches its ledger -- and that gap is not hypothetical. Preview once
listed 20260814130000 while missing tables, a view, functions, triggers and
indexes it should have created, because an intermediate version of the file had
been applied and then changed before merge. That is the entire reason the
reconciliation migration exists. Anyone relying on this proof must know it is a
ledger-and-authorship proof, not a catalog proof.
"""

import argparse, json, re, subprocess
from pathlib import Path

REPO = "u2giants/shared-db"
SCHEMA_V1 = "shared-db-historical-preview-source/v1"
SCHEMA_V2 = "shared-db-historical-preview-source/v2"


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


def verify(source_pr, main_sha, allowlist, repo=Path.cwd(), api=gh, source_map=None):
    versions = parse_versions(allowlist)
    if source_map:
        mapping = parse_source_map(source_map, versions)
        merges = {
            version: prove_pr_authored(pr, main_sha, [version], repo, api)
            for version, pr in sorted(mapping.items())
        }
        return {"schema": SCHEMA_V2, "sourcePrMap": {v: mapping[v] for v in sorted(mapping)},
                "sourceMergeShas": merges, "mainSha": main_sha, "allowlist": versions}
    merge_sha = prove_pr_authored(source_pr, main_sha, versions, repo, api)
    return {"schema": SCHEMA_V1, "sourcePr": source_pr,
            "sourceMergeSha": merge_sha, "mainSha": main_sha, "allowlist": versions}


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--source-pr", type=int)
    p.add_argument("--source-map", default="")
    p.add_argument("--main-sha", required=True)
    p.add_argument("--allowlist", required=True)
    p.add_argument("--output", type=Path, required=True)
    a = p.parse_args()
    if not a.source_map and a.source_pr is None:
        print("::error::Historical preview recovery needs --source-pr or --source-map"); raise SystemExit(2)
    if a.source_map and a.source_pr is not None:
        print("::error::Historical preview recovery takes --source-pr or --source-map, not both"); raise SystemExit(2)
    try:
        result = verify(a.source_pr, a.main_sha, a.allowlist, source_map=a.source_map)
    except (ValueError, subprocess.CalledProcessError) as exc:
        print(f"::error::Historical preview recovery rejected: {exc}"); raise SystemExit(2)
    a.output.write_text(json.dumps(result, sort_keys=True) + "\n", encoding="utf-8")
