#!/usr/bin/env python3
"""Find later migrations that must be replayed after a pass-2 migration."""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path


ROUTINE = re.compile(
    r"(?im)^[ \t]*create[ \t]+or[ \t]+replace[ \t]+"
    r"(?:function|procedure)[ \t]+"
    r"((?:\"[^\"]+\"|[a-z_][a-z0-9_$]*)(?:[ \t]*\.[ \t]*"
    r"(?:\"[^\"]+\"|[a-z_][a-z0-9_$]*))?)[ \t]*\("
)


def declared_routines(path: Path) -> set[str]:
    text = path.read_text(encoding="utf-8")
    return {re.sub(r"\s+", "", match).lower() for match in ROUTINE.findall(text)}


def later_collisions(migration: Path, migrations_dir: Path) -> dict[str, list[str]]:
    current = declared_routines(migration)
    if not current:
        return {}
    collisions: dict[str, list[str]] = {}
    for later in sorted(migrations_dir.glob("*.sql")):
        if later.name <= migration.name:
            continue
        for routine in sorted(current & declared_routines(later)):
            collisions.setdefault(routine, []).append(later.name)
    return collisions


def snapshot_query(collisions: dict[str, list[str]]) -> str:
    names = sorted(name.replace('"', "") for name in collisions)
    if not names:
        return ""
    literals = ", ".join("'" + name.replace("'", "''") + "'" for name in names)
    return (
        "select pg_get_functiondef(p.oid) || E';\\n' "
        "from pg_proc p join pg_namespace n on n.oid = p.pronamespace "
        f"where lower(n.nspname || '.' || p.proname) in ({literals}) "
        "order by n.nspname, p.proname, pg_get_function_identity_arguments(p.oid);"
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("migration", type=Path)
    parser.add_argument("--migrations-dir", type=Path, required=True)
    args = parser.parse_args()

    collisions = later_collisions(args.migration, args.migrations_dir)
    if not collisions:
        return 0

    print(
        f"PASS-2 ORDER REPAIR: {args.migration.name} redeclares routines also "
        "defined by later migrations:",
        file=sys.stderr,
    )
    for routine, files in collisions.items():
        print(f"  {routine}: {', '.join(files)}", file=sys.stderr)
    print(snapshot_query(collisions))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
