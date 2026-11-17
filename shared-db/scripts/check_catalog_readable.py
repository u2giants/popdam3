#!/usr/bin/env python3
"""#6574 Fix C: refuse a NEW migration that the post-apply catalog check cannot read.

The production post-apply catalog verification fails (correctly, by design) when a
migration names no catalog object its lexer can read, e.g. revokes written as
dynamic SQL (`execute format(...)` in a DO block). Nothing at merge time forced the
author to supply a behavior sidecar, so the failure surfaced only AFTER the
production apply (run 44106460484, 2026-11-17). This check runs at PR time and
asks for the sidecar or a valid no-op line BEFORE merge.

It only inspects migrations ADDED relative to the base, and never re-implements the
lexer: it calls production_catalog_verification.derive_targets exactly as verify().
"""
from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

import production_catalog_verification as pcv


def added_versions(repo: Path, base: str) -> list[str]:
    out = subprocess.run(
        ["git", "-C", str(repo), "diff", "--name-only", "--diff-filter=A",
         f"{base}...HEAD", "--", "supabase/migrations/"],
        check=True, capture_output=True, text=True, encoding="utf-8").stdout
    return [Path(p).name.split("_", 1)[0] for p in out.split() if p.endswith(".sql")]


def unreadable_versions(repo: Path, versions: list[str]) -> list[str]:
    """Problem lines for added migrations the catalog check cannot read."""
    migrations = pcv.local_migrations(repo)
    problems: list[str] = []
    for version in versions:
        if version not in migrations:
            problems.append(f"{version}: added in this change but no migration file was found")
            continue
        targets = pcv.derive_targets(migrations, [version])
        if not targets.is_empty():
            continue
        declaration = targets.noop_declaration
        if declaration and declaration.get("accepted"):
            continue
        if targets.pure_data_ok:
            continue
        if (repo / pcv.BEHAVIOR_SIDECAR_DIR / f"{version}.json").exists():
            continue
        problems.append(
            f"{version}: the post-apply catalog check cannot read this migration (dynamic SQL). "
            f"Add a behavior sidecar scripts/production-verification-sidecars/{version}.json with a "
            "catalog_contract or catalog_absence check, or a valid no-op line. Without it the "
            "production apply will report failure after applying (#6574, run 44106460484).")
    return problems


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(prog="check_catalog_readable.py")
    parser.add_argument("--repo", type=Path, default=Path.cwd())
    parser.add_argument("--base", default="origin/main")
    args = parser.parse_args(argv)
    repo = args.repo.resolve()
    versions = added_versions(repo, args.base)
    problems = unreadable_versions(repo, versions)
    for line in problems:
        print(f"::error::{line}", file=sys.stderr)
    if problems:
        return 1
    print(f"Catalog check can read every added migration ({len(versions)} checked).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
