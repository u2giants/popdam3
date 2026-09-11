#!/usr/bin/env python3
"""Find later migrations that must be replayed after a pass-2 migration.

TWO WAYS AN OLDER PASS-2 MIGRATION CORRUPTS A REPLAYED SCHEMA
--------------------------------------------------------------
The contract-test lane replays migrations in two passes: pass 1 in filename
order, then pass 2 re-runs (still in filename order) only the files that could
not apply from empty. A pass-2 file therefore runs AFTER every pass-1 success,
including migrations authored months later. Two distinct kinds of damage follow.

1. DEFINITION SUPERSESSION. An older file's `create or replace function` puts
   back a body that a later migration had already superseded. That is what this
   script originally repaired: snapshot the later definitions before applying
   the pass-2 file, restore them after.

2. PRIVILEGE SUPERSESSION. An older file's SCHEMA-WIDE revoke -- for example
   `revoke execute on all functions in schema api from service_role` in
   20260710135985_reconcile_permission_parity.sql -- strips privileges from
   functions that DID NOT EXIST when that migration really ran. In a real
   database the revoke precedes those functions and cannot touch them; in the
   replay it follows them and silently un-grants them. The damage is invisible
   in the replay logs (the migration applies cleanly) and surfaces much later as
   a contract test correctly reporting a function missing its intended grants.

Both repairs are the same shape: snapshot the truth BEFORE the pass-2 file, put
it back AFTER. The privilege repair is deliberately narrow -- it restores only
routines DECLARED BY LATER MIGRATIONS, i.e. exactly the ones the older revoke
could not legitimately have reached. Routines that already existed at the older
migration's own point in history keep whatever it does to them, so the migration
still proves the parity it was written to prove.

PROVENANCE: A LATER FILENAME PROVES NOTHING (issue #2537)
--------------------------------------------------------
The definition repair above assumed that if a later migration DECLARES a
routine, then whatever the catalog holds for that routine is that later
migration's work. In this replay that is false. A later migration can fail in
pass 1 and fail again in pass 2, or not have run yet at all -- and then the
catalog still holds the BASELINE (or otherwise obsolete) body. Snapshotting it
and putting it back after the pass-2 file destroys the very forward repair the
pass-2 file just made, and the damage is invisible: both migrations "applied",
and only a contract test much later reports the old plan shape.

So a routine's snapshot is taken ONLY when some migration later than this one
that declares it is PROVEN to have applied successfully in THIS replay -- pass-1
success or pass-2 success, recorded as it happens and handed to this script in
--applied-migrations. Routines whose later declarations are all failed, not yet
attempted, or otherwise unproven are REFUSED: they are reported and left alone,
so the pass-2 file's own definition stands. Refusing to restore preserves the
newest PROVEN body; restoring on filename alone cannot.

The privilege repair is unaffected. It re-grants EXECUTE on routines that exist
in the catalog right now, exactly as they are; it never writes a body, so it
cannot resurrect an unproven definition.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path


IDENT = r"(?:\"[^\"]+\"|[a-z_][a-z0-9_$]*)"

ROUTINE = re.compile(
    r"(?im)^[ \t]*create[ \t]+(?:or[ \t]+replace[ \t]+)?"
    r"(?:function|procedure)[ \t]+"
    rf"({IDENT}(?:[ \t]*\.[ \t]*{IDENT})?)[ \t]*\("
)

# `revoke ... on all functions|procedures|routines in schema <name>[, <name>] from ...`
BROAD_ROUTINE_REVOKE = re.compile(
    r"(?is)^[ \t]*revoke\b(?![^;]*?--)[^;]*?\ball[ \t]+"
    r"(?:functions|procedures|routines)[ \t]+in[ \t]+schema[ \t]+"
    r"([^;]*?)\bfrom\b",
    re.MULTILINE,
)


def _strip_comments(text: str) -> str:
    text = re.sub(r"/\*.*?\*/", " ", text, flags=re.S)
    return re.sub(r"(?m)--.*$", "", text)


def _norm(name: str) -> str:
    return re.sub(r"\s+", "", name).replace('"', "").lower()


def declared_routines(path: Path) -> set[str]:
    text = path.read_text(encoding="utf-8")
    return {_norm(match) for match in ROUTINE.findall(text)}


def broad_routine_revoke_schemas(path: Path) -> set[str]:
    """Schemas whose whole routine privilege set this migration revokes."""
    text = _strip_comments(path.read_text(encoding="utf-8"))
    schemas: set[str] = set()
    for group in BROAD_ROUTINE_REVOKE.findall(text):
        for part in group.split(","):
            part = part.strip()
            if re.fullmatch(IDENT, part, flags=re.I):
                schemas.add(_norm(part))
    return schemas


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


def read_applied_migrations(path: Path) -> set[str]:
    """Basenames of migrations PROVEN applied so far in this replay.

    The caller appends a line the moment a migration really applies -- pass 1 or
    pass 2. An absent name is not evidence of failure, only of the absence of
    proof, and this repair treats those identically: no proof, no restoration.
    """
    if not path.exists():
        raise FileNotFoundError(path)
    return {
        line.strip()
        for line in path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    }


def classify_collisions(
    collisions: dict[str, list[str]], applied: set[str]
) -> tuple[dict[str, list[str]], dict[str, list[str]]]:
    """Split colliding routines into proven-newer and unproven, one by one.

    Each routine is judged on its OWN later declarations. Two routines redefined
    by the same pass-2 file routinely have different outcomes -- one later
    migration applied, the other rolled back -- and classifying them together
    would either lose a real repair or restore an obsolete body.
    """
    proven: dict[str, list[str]] = {}
    unproven: dict[str, list[str]] = {}
    for routine, files in collisions.items():
        landed = [name for name in files if name in applied]
        if landed:
            proven[routine] = landed
        else:
            unproven[routine] = files
    return proven, unproven


def later_only_routines(migration: Path, migrations_dir: Path, schemas: set[str]) -> set[str]:
    """Routines in `schemas` that only migrations NEWER than `migration` declare.

    A routine also declared at or before `migration` legitimately existed when
    the older file ran, so its privileges are that file's business.
    """
    if not schemas:
        return set()
    earlier: set[str] = set()
    later: set[str] = set()
    for path in sorted(migrations_dir.glob("*.sql")):
        target = later if path.name > migration.name else earlier
        target |= declared_routines(path)
    return {
        name
        for name in later - earlier
        if "." in name and name.split(".", 1)[0] in schemas
    }


def _literals(names: set[str] | dict[str, list[str]]) -> str:
    return ", ".join(
        "'" + name.replace('"', "").replace("'", "''") + "'" for name in sorted(names)
    )


def snapshot_query(
    collisions: dict[str, list[str]],
    privilege_routines: set[str] | None = None,
) -> str:
    """One query whose rows are the SQL statements that restore later truth."""
    parts: list[str] = []
    if collisions:
        parts.append(
            "select x.ord, x.stmt, n.nspname as s, p.proname as f, "
            "pg_get_function_identity_arguments(p.oid) as a "
            "from pg_proc p join pg_namespace n on n.oid = p.pronamespace "
            "cross join lateral (values "
            "(1, format('do $pass2$ begin if to_regprocedure(%L) is not null then execute %L; end if; end $pass2$;', "
            "format('%I.%I(%s)', n.nspname, p.proname, pg_catalog.oidvectortypes(p.proargtypes)), "
            "format('alter %s %I.%I(%s) reset all', case p.prokind when 'p' then 'procedure' else 'function' end, "
            "n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)))), "
            "(2, pg_get_functiondef(p.oid) || E';\\n'), "
            "(3, format('alter %s %I.%I(%s) security %s;', "
            "case p.prokind when 'p' then 'procedure' else 'function' end, "
            "n.nspname, p.proname, pg_get_function_identity_arguments(p.oid), "
            "case when p.prosecdef then 'definer' else 'invoker' end))) x(ord, stmt) "
            f"where lower(n.nspname || '.' || p.proname) in ({_literals(collisions)})"
        )
    if privilege_routines:
        # aclexplode over the CURRENT acl -- captured before the pass-2 file runs,
        # replayed after it, so a schema-wide revoke cannot outlive it. A null
        # proacl means the built-in default (EXECUTE to PUBLIC), which acldefault
        # reproduces exactly rather than being silently treated as "no grants".
        parts.append(
            "select 4 as ord, format('grant execute on function %s to %s;', "
            "p.oid::regprocedure::text, "
            "case when acl.grantee = 0 then 'public' "
            "else acl.grantee::regrole::text end) as stmt, "
            "n.nspname as s, p.proname as f, "
            "pg_get_function_identity_arguments(p.oid) as a "
            "from pg_proc p join pg_namespace n on n.oid = p.pronamespace "
            "cross join lateral aclexplode("
            "coalesce(p.proacl, acldefault('f', p.proowner))) acl "
            f"where lower(n.nspname || '.' || p.proname) in ({_literals(privilege_routines)}) "
            "and acl.privilege_type = 'EXECUTE'"
        )
    if not parts:
        return ""
    return (
        "select stmt from (" + " union all ".join(parts) + ") r order by ord, s, f, a, stmt;"
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("migration", type=Path)
    parser.add_argument("--migrations-dir", type=Path, required=True)
    parser.add_argument(
        "--applied-migrations",
        type=Path,
        required=True,
        help=(
            "File listing the basenames of migrations PROVEN applied so far in "
            "this replay, one per line. Required: without it a later filename "
            "would be mistaken for a later definition (issue #2537)."
        ),
    )
    args = parser.parse_args()

    try:
        applied = read_applied_migrations(args.applied_migrations)
    except FileNotFoundError:
        print(
            f"PASS-2 ORDER REPAIR: refusing -- the applied-migration record "
            f"{args.applied_migrations} does not exist, so no routine in the "
            "catalog can be shown to come from a later migration.",
            file=sys.stderr,
        )
        return 2

    collisions = later_collisions(args.migration, args.migrations_dir)
    proven, unproven = classify_collisions(collisions, applied)
    schemas = broad_routine_revoke_schemas(args.migration)
    privilege_routines = later_only_routines(args.migration, args.migrations_dir, schemas)

    if unproven:
        print(
            f"PASS-2 ORDER REPAIR: {args.migration.name} redeclares routines that "
            "later migrations also declare, but NONE of those later migrations is "
            "proven to have applied in this replay. Their catalog definitions are "
            "not newer truth, so they are NOT snapshotted or restored:",
            file=sys.stderr,
        )
        for routine, files in sorted(unproven.items()):
            print(f"  {routine}: unproven later file(s) {', '.join(files)}", file=sys.stderr)

    if not proven and not privilege_routines:
        return 0

    if proven:
        print(
            f"PASS-2 ORDER REPAIR: {args.migration.name} redeclares routines also "
            "defined by later migrations that DID apply in this replay:",
            file=sys.stderr,
        )
        for routine, files in sorted(proven.items()):
            print(f"  {routine}: {', '.join(files)}", file=sys.stderr)
    if privilege_routines:
        print(
            f"PASS-2 ORDER REPAIR: {args.migration.name} revokes routine privileges "
            f"across schema(s) {', '.join(sorted(schemas))}, which in this replay "
            "reaches functions created only by LATER migrations. Their EXECUTE "
            "grants are snapshotted and restored:",
            file=sys.stderr,
        )
        for routine in sorted(privilege_routines):
            print(f"  {routine}", file=sys.stderr)

    print(snapshot_query(proven, privilege_routines))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
