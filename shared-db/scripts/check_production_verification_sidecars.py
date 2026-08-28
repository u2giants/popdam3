#!/usr/bin/env python3
"""Offline, credential-free verification-sidecar integrity checker."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parent))

from production_catalog_verification import (
    BEHAVIOR_SIDECAR_DIR, GuardError, dynamic_execution_marker_lines,
    load_behavior_sidecars,
)


def migrations(repo: Path) -> dict[str, Path]:
    result: dict[str, Path] = {}
    for path in (repo / "supabase/migrations").glob("*.sql"):
        version = path.name.split("_", 1)[0]
        if version in result:
            raise GuardError(f"duplicate migration version {version}")
        result[version] = path
    return result


def check(repo: Path, scan_versions: list[str]) -> dict:
    migration_map = migrations(repo)
    store = repo / BEHAVIOR_SIDECAR_DIR
    sidecar_versions = []
    for path in sorted(store.glob("*.json")):
        version = path.stem
        if version not in migration_map:
            raise GuardError(f"orphan sidecar {path}: migration {version} is missing")
        sidecar_versions.append(version)
    load_behavior_sidecars(repo, migration_map, sidecar_versions)
    rows = []
    for version in sorted(set(scan_versions)):
        migration = migration_map.get(version)
        if migration is None:
            raise GuardError(f"mandatory migration {version} is missing")
        markers = dynamic_execution_marker_lines(migration.read_text(encoding="utf-8"))
        sidecar = store / f"{version}.json"
        if markers and not sidecar.exists():
            raise GuardError(
                f"{migration}: dynamic execution markers {markers} require a sidecar. "
                "Add a hash-bound sidecar; record durable checks by hand or a "
                "reviewed-empty declaration covering every marker line."
            )
        rows.append({"version": version, "markers": markers, "sidecar": sidecar.exists()})
    return {"status": "OK", "sidecars": len(sidecar_versions), "scans": rows}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--scan-version", action="append", default=[])
    args = parser.parse_args()
    try:
        print(json.dumps(check(args.repo.resolve(), args.scan_version), separators=(",", ":")))
        return 0
    except GuardError as exc:
        print(f"UNVERIFIABLE: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
