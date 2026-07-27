#!/usr/bin/env python3
"""Validate a fail-closed production migration allowlist and dry run."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import subprocess
import sys

VERSION_RE = re.compile(r"^\d{14}$")
REMOTE_TABLE_RE = re.compile(r"^\s*(?:\d{14})?\s*\|\s*(\d{14})\s*\|")
MIGRATION_LINE_RE = re.compile(r"^\s*(?:[•*\-]\s*)?(\d{14})_[^\s]+\.sql\s*$")
HARD_BLOCKED = {
    "20260726030000",
    "20260726031000",
    "20260726032000",
    "20260726180000",
    "20260726190000",
    "20260726200000",
}


class GuardError(ValueError):
    pass


def parse_allowlist(raw: str) -> list[str]:
    values = [item.strip() for item in raw.split(",") if item.strip()]
    if not values:
        raise GuardError("production allowlist is empty")
    if any(not VERSION_RE.fullmatch(value) for value in values):
        raise GuardError("every entry must be an exact 14-digit version")
    if len(values) != len(set(values)):
        raise GuardError("production allowlist contains a duplicate")
    blocked = sorted(set(values) & HARD_BLOCKED)
    if blocked:
        raise GuardError(f"general production lane blocks: {', '.join(blocked)}")
    if values != sorted(values):
        raise GuardError("production allowlist must be in migration order")
    return values


def parse_remote_versions(path: Path) -> set[str]:
    raw = path.read_text(encoding="utf-8")
    try:
        value = json.loads(raw)
    except json.JSONDecodeError:
        versions = {
            match.group(1)
            for line in raw.splitlines()
            if (match := REMOTE_TABLE_RE.match(line))
        }
    else:
        versions: set[str] = set()

        def visit(item: object) -> None:
            if isinstance(item, dict):
                for key, child in item.items():
                    if key in {"version", "remote"} and isinstance(child, str):
                        if VERSION_RE.fullmatch(child):
                            versions.add(child)
                    visit(child)
            elif isinstance(item, list):
                for child in item:
                    visit(child)

        visit(value)
    if not versions:
        raise GuardError("production migration ledger contained no versions")
    return versions


def local_migrations(repo: Path) -> dict[str, Path]:
    migrations: dict[str, Path] = {}
    for path in sorted((repo / "supabase" / "migrations").glob("*.sql")):
        version = path.name[:14]
        if not VERSION_RE.fullmatch(version):
            raise GuardError(f"invalid migration filename: {path.name}")
        if version in migrations:
            raise GuardError(f"duplicate migration version: {version}")
        migrations[version] = path
    return migrations


def validate_candidates(
    migrations: dict[str, Path], allowlist: list[str], remote: set[str]
) -> None:
    unknown = [version for version in allowlist if version not in migrations]
    if unknown:
        raise GuardError(f"unknown migration version: {', '.join(unknown)}")
    applied = [version for version in allowlist if version in remote]
    if applied:
        raise GuardError(f"already applied on production: {', '.join(applied)}")


def prepare(repo: Path, output: Path, commit_sha: str, raw_allowlist: str, ledger: Path) -> None:
    allowlist = parse_allowlist(raw_allowlist)
    remote = parse_remote_versions(ledger)
    migrations = local_migrations(repo)
    validate_candidates(migrations, allowlist, remote)
    if output.exists():
        raise GuardError(f"bounded checkout already exists: {output}")
    subprocess.run(
        ["git", "worktree", "add", "--detach", str(output), commit_sha],
        cwd=repo,
        check=True,
    )
    keep = remote | set(allowlist)
    for version, path in local_migrations(output).items():
        if version not in keep:
            path.unlink()
    remaining = set(local_migrations(output))
    expected = set(migrations) & keep
    if remaining != expected:
        raise GuardError("bounded checkout does not match the approved file set")


def verify_dry_run(path: Path, raw_allowlist: str) -> None:
    allowlist = parse_allowlist(raw_allowlist)
    raw = path.read_text(encoding="utf-8")
    marker = "Would push these migrations:"
    if marker not in raw:
        raise GuardError("dry run did not contain the expected migration list")
    actual = [
        match.group(1)
        for line in raw.split(marker, 1)[1].splitlines()
        if (match := MIGRATION_LINE_RE.match(line))
    ]
    if actual != allowlist:
        raise GuardError(
            f"dry run did not exactly match: expected {allowlist}, got {actual}"
        )


def main() -> int:
    parser = argparse.ArgumentParser()
    subs = parser.add_subparsers(dest="command", required=True)
    prep = subs.add_parser("prepare")
    prep.add_argument("--repo", type=Path, required=True)
    prep.add_argument("--output", type=Path, required=True)
    prep.add_argument("--commit-sha", required=True)
    prep.add_argument("--allowlist", required=True)
    prep.add_argument("--remote-ledger", type=Path, required=True)
    verify = subs.add_parser("verify-dry-run")
    verify.add_argument("--dry-run-output", type=Path, required=True)
    verify.add_argument("--allowlist", required=True)
    args = parser.parse_args()
    try:
        if args.command == "prepare":
            prepare(
                args.repo.resolve(),
                args.output.resolve(),
                args.commit_sha,
                args.allowlist,
                args.remote_ledger,
            )
        else:
            verify_dry_run(args.dry_run_output, args.allowlist)
    except (GuardError, OSError, subprocess.CalledProcessError) as exc:
        print(f"BLOCKED: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
