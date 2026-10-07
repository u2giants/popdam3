#!/usr/bin/env python3
"""Bind a verification-only recovery to an immutable, catalog-only failed apply."""
import hashlib
import json
import os
from pathlib import Path
import re
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from production_migration_guard import parse_remote_versions

PROJECT = "qsllyeztdwjgirsysgai"


def validate_jobs(jobs):
    rows = jobs.get("jobs", [])
    failed = [j for j in rows if j.get("conclusion") == "failure"]
    if len(failed) != 1 or failed[0].get("name") != "Production apply (automatic evidence gates)":
        raise ValueError("original failure is not exclusively the automatic apply job")
    if any(j.get("conclusion") not in ("success", "skipped", "failure") for j in rows):
        raise ValueError("original jobs are not terminal")
    for name in ("SQL migration guards", "Production apply review (immutable evidence + hard guards)"):
        if len([j for j in rows if j.get("name") == name and j.get("conclusion") == "success"]) != 1:
            raise ValueError("original prerequisite job did not succeed")
    steps = failed[0].get("steps", [])
    if any(s.get("conclusion") not in ("success", "skipped", "failure") for s in steps):
        raise ValueError("original apply contains an incomplete or abnormal step")
    failures = [s.get("name") for s in steps if s.get("conclusion") == "failure"]
    if failures != ["Post-apply catalog verification"]:
        raise ValueError("original failure is not exclusively catalog verification")
    for name in ("Build bounded checkout", "Fresh dry-run, then apply", "Capture production migration record (after)", "Save apply evidence", "Release the exclusive production lane with ownership proof"):
        matching = [s for s in steps if s.get("name") == name]
        if len(matching) != 1 or matching[0].get("conclusion") != "success":
            raise ValueError("original apply or evidence step did not succeed: " + name)


def build_binding(repo, evidence, live_ledger, catalog, jobs, inputs):
    validate_jobs(jobs)
    wanted = inputs["allowlist"]
    if not wanted or wanted != sorted(set(wanted)) or any(not re.fullmatch(r"\d{14}", v) for v in wanted):
        raise ValueError("invalid exact ordered allowlist")
    before = parse_remote_versions(evidence / "production-ledger-before.txt")
    after = parse_remote_versions(evidence / "production-ledger-after.txt")
    live = parse_remote_versions(live_ledger)
    if set(after) - set(before) != set(wanted) or set(before) - set(after) or not set(after).issubset(set(live)):
        raise ValueError("original ledger delta or current production ledger is not exact")
    if not (evidence / "production-apply.txt").read_text().strip():
        raise ValueError("missing original apply output")
    manifests = list(evidence.rglob("migration-content-manifest.json"))
    if len(manifests) != 1:
        raise ValueError("ambiguous original content manifest")
    manifest = json.loads(manifests[0].read_text())
    hashes = {}
    for version in wanted:
        migrations = list((repo / "supabase/migrations").glob(version + "_*.sql"))
        if len(migrations) != 1:
            raise ValueError("ambiguous current migration")
        digest = hashlib.sha256(migrations[0].read_bytes().replace(b"\r\n", b"\n")).hexdigest()
        if manifest.get(version) != digest:
            raise ValueError("original SQL bytes changed")
        hashes[version] = digest
    if catalog.get("enforcing") is not True or catalog.get("errors") != [] or catalog.get("allowlist") != wanted:
        raise ValueError("catalog recovery did not enforce the exact allowlist")
    # For opaque DDL recovery, require a hash-bound named assertion for every version.
    checks = catalog.get("behavior_checks", [])
    results = catalog.get("behavior_results", {}).get("behavior_checks", [])
    for version in wanted:
        matched = [c for c in checks if c.get("migration_version") == version and c.get("kind") == "catalog_contract" and c.get("migration_sha256") == hashes[version] and isinstance(c.get("contract"), str) and c["contract"] and isinstance(c.get("id"), str) and c["id"]]
        if not matched:
            raise ValueError("missing hash-bound named catalog contract")
        for check in matched:
            result = [r for r in results if r.get("id") == check.get("id")]
            if len(result) != 1 or type(check.get("expected_count")) is not int or check["expected_count"] <= 0 or type(result[0].get("actual_count")) is not int or type(result[0].get("expected_count")) is not int or result[0].get("actual_count") != check["expected_count"] or result[0].get("expected_count") != check["expected_count"]:
                raise ValueError("catalog contract did not pass")
    return {"schema_version": 1, "project_ref": PROJECT, **inputs, "migration_hashes": hashes,
            "ledger_added": wanted, "ledger_removed": [], "catalog_enforced": True,
            "original_failure": "Post-apply catalog verification", "verification_only": True}


if __name__ == "__main__":
    temp = Path(os.environ["RUNNER_TEMP"])
    inputs = {"main_sha": os.environ["MAIN_SHA"], "apply_main_sha": os.environ["APPLY_MAIN_SHA"],
              "apply_run_id": int(os.environ["APPLY_RUN_ID"]), "apply_artifact_id": int(os.environ["APPLY_ARTIFACT_ID"]),
              "apply_artifact_digest": os.environ["APPLY_ARTIFACT_DIGEST"],
              "allowlist": os.environ["ALLOWLIST"].split(",")}
    binding = build_binding(Path.cwd(), temp / "apply-evidence", temp / "production-ledger-recovery.txt",
                            json.loads((temp / "catalog-verification/production-catalog-verification.json").read_text()),
                            json.loads((temp / "apply-jobs.json").read_text()), inputs)
    (temp / "production-catalog-recovery-binding.json").write_text(json.dumps(binding, indent=2) + "\n")
    print("RECOVERY BINDING OK: catalog-only failure, exact SQL and ledger delta, verification-only production proof")
