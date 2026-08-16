#!/usr/bin/env python3
"""Prove an already-merged PR authored an exact historical preview batch."""

import argparse, json, re, subprocess
from pathlib import Path

REPO = "u2giants/shared-db"

def gh(endpoint):
    return json.loads(subprocess.run(["gh", "api", endpoint], check=True, text=True,
        stdout=subprocess.PIPE, encoding="utf-8").stdout)

def verify(source_pr, main_sha, allowlist, repo=Path.cwd(), api=gh):
    versions = [v.strip() for v in allowlist.split(",") if v.strip()]
    if not versions or versions != sorted(set(versions)) or any(not re.fullmatch(r"\d{14}", v) for v in versions):
        raise ValueError("historical preview allowlist must be unique, ordered 14-digit versions")
    pr = api(f"repos/{REPO}/pulls/{source_pr}")
    if pr.get("merged") is not True or not re.fullmatch(r"[0-9a-f]{40}", str(pr.get("merge_commit_sha"))):
        raise ValueError("historical source PR is not merged")
    subprocess.run(["git", "merge-base", "--is-ancestor", pr["merge_commit_sha"], main_sha], cwd=repo, check=True)
    files = {}
    page = 1
    while True:
        batch = api(f"repos/{REPO}/pulls/{source_pr}/files?per_page=100&page={page}")
        for item in batch:
            files[item.get("filename", "")] = item.get("status")
        if len(batch) < 100: break
        page += 1
    for version in versions:
        matches = list(repo.glob(f"supabase/migrations/{version}_*.sql"))
        relative = matches[0].relative_to(repo).as_posix() if len(matches) == 1 else ""
        if len(matches) != 1 or files.get(relative) != "added":
            raise ValueError(f"source PR did not author the exact migration {version}")
    return {"schema":"shared-db-historical-preview-source/v1", "sourcePr":source_pr,
            "sourceMergeSha":pr["merge_commit_sha"], "mainSha":main_sha, "allowlist":versions}

if __name__ == "__main__":
    p=argparse.ArgumentParser(); p.add_argument("--source-pr",type=int,required=True); p.add_argument("--main-sha",required=True); p.add_argument("--allowlist",required=True); p.add_argument("--output",type=Path,required=True)
    a=p.parse_args()
    try: result=verify(a.source_pr,a.main_sha,a.allowlist)
    except (ValueError, subprocess.CalledProcessError) as exc:
        print(f"::error::Historical preview recovery rejected: {exc}"); raise SystemExit(2)
    a.output.write_text(json.dumps(result,sort_keys=True)+"\n",encoding="utf-8")
