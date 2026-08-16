#!/usr/bin/env python3
"""Create or verify immutable evidence of Albert's exact material-risk decision."""

import argparse, hashlib, json, re, subprocess, tempfile, zipfile
from pathlib import Path

REPO="u2giants/shared-db"
SCHEMA="shared-db-production-owner-decision/v1"
TARGET=".github/workflows/shared-supabase-migrations.yml"
ALLOWED_RISKS={"permanent_data_rewrite_or_loss","expected_downtime","material_access_change","recovery_unproven","unresolved_material_objection"}

def validate_allowlist(value):
    if not isinstance(value,list) or not value:
        raise ValueError("owner decision ordered allowlist is missing")
    if any(not isinstance(x,str) or not re.fullmatch(r"\d{14}",x) for x in value):
        raise ValueError("owner decision ordered allowlist contains an invalid migration version")
    if len(value)!=len(set(value)) or value!=sorted(value):
        raise ValueError("owner decision ordered allowlist must be unique and ordered")
    return value

def gh(endpoint):
    return json.loads(subprocess.run(["gh","api",endpoint],check=True,text=True,stdout=subprocess.PIPE,encoding="utf-8").stdout)

def parse_comment(comment):
    if comment.get("user",{}).get("login")!="u2giants" or comment.get("author_association")!="OWNER":
        raise ValueError("decision is not authenticated to repository owner Albert")
    if comment.get("created_at") != comment.get("updated_at"):
        raise ValueError("owner decision comment was edited")
    match=re.fullmatch(r"```production-owner-decision\n(.+)\n```\s*",comment.get("body",""),re.S)
    if not match: raise ValueError("owner decision does not use the exact machine-readable form")
    try: data=json.loads(match.group(1))
    except json.JSONDecodeError as exc: raise ValueError("owner decision JSON is invalid") from exc
    required={"schema","approved","main_sha","ordered_allowlist","accepted_risks","source_pr","source_merge_sha","target_workflow"}
    if set(data)!=required or data["schema"]!=SCHEMA or data["approved"] is not True:
        raise ValueError("owner decision schema is incomplete or not approved")
    validate_allowlist(data["ordered_allowlist"])
    if not data["accepted_risks"] or any(x not in ALLOWED_RISKS for x in data["accepted_risks"]):
        raise ValueError("owner decision risks are missing or unknown")
    if data["target_workflow"]!=TARGET: raise ValueError("owner decision targets another workflow")
    return data

def prove(comment_id, main_sha, allowlist, source_pr, api=gh):
    validate_allowlist(allowlist)
    comment=api(f"repos/{REPO}/issues/comments/{comment_id}"); data=parse_comment(comment)
    if data["main_sha"]!=main_sha or data["ordered_allowlist"]!=allowlist or data["source_pr"]!=source_pr:
        raise ValueError("owner decision does not match exact main, ordered batch, or source PR")
    pr=api(f"repos/{REPO}/pulls/{source_pr}")
    if pr.get("merged") is not True or pr.get("merge_commit_sha")!=data["source_merge_sha"]:
        raise ValueError("owner decision source merge is not proved")
    return {"schema":SCHEMA,"commentId":comment_id,"commentNodeId":comment.get("node_id"),
        "commentCreatedAt":comment.get("created_at"),"commentBodySha256":hashlib.sha256(comment["body"].encode()).hexdigest(),**data}

def artifact_for(run_id,digest,download,api=gh):
    run=api(f"repos/{REPO}/actions/runs/{run_id}")
    if any(run.get(k)!=v for k,v in {"status":"completed","conclusion":"success","event":"workflow_dispatch","path":".github/workflows/production-owner-decision-evidence.yml"}.items()):
        raise ValueError("owner-decision evidence run is not the exact successful workflow")
    arts=api(f"repos/{REPO}/actions/runs/{run_id}/artifacts?per_page=100").get("artifacts",[])
    matches=[a for a in arts if a.get("name")==f"production-owner-decision-{run_id}"]
    if len(matches)!=1 or matches[0].get("digest")!=digest or matches[0].get("expired") is not False:
        raise ValueError("owner-decision artifact is missing, expired, or has the wrong digest")
    with tempfile.TemporaryDirectory() as t:
        z=Path(t,"a.zip"); download(matches[0]["id"],z)
        if "sha256:"+hashlib.sha256(z.read_bytes()).hexdigest()!=digest: raise ValueError("owner-decision artifact bytes changed")
        with zipfile.ZipFile(z) as archive: return json.loads(archive.read("production-owner-decision.json"))

def verify_artifact(run_id,digest,main_sha,allowlist,source_pr,download,api=gh):
    stored=artifact_for(run_id,digest,download,api); live=prove(stored["commentId"],main_sha,allowlist,source_pr,api)
    if stored!=live: raise ValueError("live authenticated owner ruling no longer matches immutable evidence")
    return live

if __name__=="__main__":
    p=argparse.ArgumentParser();p.add_argument("--comment-id",type=int,required=True);p.add_argument("--main-sha",required=True);p.add_argument("--allowlist",required=True);p.add_argument("--source-pr",type=int,required=True);p.add_argument("--output",type=Path,required=True);a=p.parse_args()
    try: result=prove(a.comment_id,a.main_sha,[x.strip() for x in a.allowlist.split(",")],a.source_pr)
    except ValueError as exc: print(f"::error::Owner decision rejected: {exc}");raise SystemExit(2)
    a.output.write_text(json.dumps(result,sort_keys=True)+"\n",encoding="utf-8")
