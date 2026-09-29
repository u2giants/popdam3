#!/usr/bin/env python3
"""Fail-closed gates for the DesignFlow SANDBOX migration route (issue #3428).

The sandbox is the separate DesignFlow non-production Supabase project
`xupnyeifmpsacrqahwwm`. It is neither shared production (`qsllyeztdwjgirsysgai`)
nor the shared preview branch, and nothing here may ever widen either of those
lanes. `.github/workflows/designflow-sandbox-migrations.yml` is the only caller.

The ordinary bounded-apply machinery (`production_migration_guard.py` preflight /
prepare / assert-bounded / verify-dry-run and `production_catalog_verification.py`)
is REUSED unchanged by that workflow. This file adds only what the sandbox needs
and the shared guard does not provide:

  identity       prove the target ref is the sandbox, is not production or
                 preview, and is the project the Management API returns.
  allowlist      refuse versions this route may never apply to the sandbox.
  collisions     read the sandbox catalog (read-only) and refuse any object the
                 allowlisted migrations would create whose NAME already exists.
                 `create index if not exists` against a same-name index with a
                 DIFFERENT definition silently keeps the wrong one (issue #3428:
                 app.user_notification_unread_user_created_idx), so an existing
                 name is a refusal, never a skip.
  verify-ledger  after an apply, the ledger must equal before + allowlist exactly.

Every refusal exits 2 and names what was refused. Nothing here writes to any
database: the catalog read goes through the Management API with
`read_only: true` (production_catalog_verification.run_query).
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from production_migration_guard import (  # noqa: E402
    GuardError,
    local_migrations,
    parse_remote_versions,
    strip_sql,
)
from production_catalog_verification import (  # noqa: E402
    MANAGEMENT_API,
    USER_AGENT,
    read_error_body,
    run_query,
)

SANDBOX_PROJECT_REF = "xupnyeifmpsacrqahwwm"
PRODUCTION_PROJECT_REF = "qsllyeztdwjgirsysgai"
PROJECT_REF_RE = re.compile(r"^[a-z]{20}$")
VERSION_RE = re.compile(r"^\d{14}$")

# Versions this route refuses outright, with the reason printed on refusal.
SANDBOX_BLOCKED = {
    "20260905072856": (
        "issue #3428: the sandbox already has "
        "app.user_notification_unread_user_created_idx on a DIFFERENT definition "
        "and no app.user_notification.created_at; this migration must not be "
        "applied there unchanged. The forward repair belongs to #2204's author lane."
    ),
}

IDENT = r'"?([a-z_][a-z0-9_]*)"?\s*\.\s*"?([a-z_][a-z0-9_]*)"?'
NAME = r'"?([a-z_][a-z0-9_]*)"?'

# `create or replace` is deliberately NOT matched: replacing is its intent.
# Added columns, policies and triggers are probed too (see below).
CREATE_PATTERNS = (
    ("relation", re.compile(r"\bcreate\s+(?:unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?" + IDENT)),
    ("relation", re.compile(r"\bcreate\s+(?:materialized\s+)?view\s+(?:if\s+not\s+exists\s+)?" + IDENT)),
    ("relation", re.compile(r"\bcreate\s+sequence\s+(?:if\s+not\s+exists\s+)?" + IDENT)),
    ("type", re.compile(r"\bcreate\s+type\s+" + IDENT)),
    ("function", re.compile(r"\bcreate\s+(?:function|procedure)\s+" + IDENT)),
    ("schema", re.compile(r"\bcreate\s+schema\s+(?:if\s+not\s+exists\s+)?" + NAME)),
)
# Groups: index name, table schema, table. An index lives in its table's schema.
INDEX_RE = re.compile(
    r"\bcreate\s+(?:unique\s+)?index\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?"
    + NAME + r"\s+on\s+(?:only\s+)?" + IDENT
)
# Groups: schema, table, column. A column added to an existing table is a
# name collision exactly like a created object (issue #3428's created_at).
ADD_COLUMN_RE = re.compile(
    r"\balter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?" + IDENT
    + r"\s+add\s+(?:column\s+)?(?:if\s+not\s+exists\s+)?" + NAME
)
# Groups: object name, table schema, table.
POLICY_RE = re.compile(r"\bcreate\s+policy\s+" + NAME + r"\s+on\s+" + IDENT)
TRIGGER_RE = re.compile(
    r"\bcreate\s+(?:constraint\s+)?trigger\s+" + NAME + r"\s+.*?\bon\s+" + IDENT, re.S
)
DROP_RE = re.compile(
    r"\bdrop\s+(?:materialized\s+view|view|table|sequence|type|function|procedure|index)\s+"
    r"(?:concurrently\s+)?(?:if\s+exists\s+)?" + IDENT
)


class Refusal(Exception):
    pass


def check_target_ref(project_ref: str, preview_ref: str) -> None:
    if not PROJECT_REF_RE.fullmatch(project_ref or ""):
        raise Refusal(f"target ref {project_ref!r} is not a 20-character Supabase project ref")
    if project_ref == PRODUCTION_PROJECT_REF:
        raise Refusal("target ref is shared PRODUCTION")
    if project_ref != SANDBOX_PROJECT_REF:
        raise Refusal(f"target ref {project_ref} is not the DesignFlow sandbox {SANDBOX_PROJECT_REF}")
    if not PROJECT_REF_RE.fullmatch(preview_ref or ""):
        raise Refusal("the shared preview ref is unknown, so the sandbox cannot be proven distinct from it")
    if project_ref == preview_ref:
        raise Refusal("target ref is the shared PREVIEW branch")


def check_returned_project(project_ref: str, project: object) -> None:
    if not isinstance(project, dict):
        raise Refusal("the Management API did not return a project object")
    returned = project.get("id") or project.get("ref")
    if returned != project_ref:
        raise Refusal(f"the Management API returned project {returned!r}, not {project_ref}")


def fetch_project(project_ref: str, token: str) -> object:
    request = urllib.request.Request(
        f"{MANAGEMENT_API}/v1/projects/{project_ref}",
        headers={"Authorization": f"Bearer {token}", "User-Agent": USER_AGENT},
        method="GET",
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        raise Refusal(f"HTTP {exc.code} reading project {project_ref}: {read_error_body(exc)}") from exc


def parse_sandbox_allowlist(raw: str, migrations: dict[str, Path]) -> list[str]:
    values = [item.strip() for item in (raw or "").split(",")]
    if not values or any(not v for v in values):
        raise Refusal("sandbox allowlist is empty or has an empty entry")
    if any(not VERSION_RE.fullmatch(v) for v in values):
        raise Refusal("every sandbox allowlist entry must be an exact 14-digit version")
    if len(values) != len(set(values)):
        raise Refusal("sandbox allowlist contains a duplicate")
    if values != sorted(values):
        raise Refusal("sandbox allowlist must be in ascending version order")
    blocked = [v for v in values if v in SANDBOX_BLOCKED]
    if blocked:
        raise Refusal("; ".join(f"{v} is blocked on the sandbox route: {SANDBOX_BLOCKED[v]}" for v in blocked))
    unknown = [v for v in values if v not in migrations]
    if unknown:
        raise Refusal(f"not on disk at this commit: {', '.join(unknown)}")
    return values


def created_names(raw: str) -> list[tuple[str, str]]:
    """(kind, qualified name) for every object a migration CREATES, excluding
    `create or replace` and objects dropped earlier in the same file."""
    text = strip_sql(raw, keep_regclass=False)
    events: list[tuple[int, str, str]] = []
    for kind, pattern in CREATE_PATTERNS:
        for m in pattern.finditer(text):
            name = m.group(1) if kind == "schema" else f"{m.group(1)}.{m.group(2)}"
            events.append((m.start(), kind, name))
    for m in INDEX_RE.finditer(text):
        events.append((m.start(), "relation", f"{m.group(2)}.{m.group(1)}"))
    for m in ADD_COLUMN_RE.finditer(text):
        if m.group(3) in {"constraint", "primary", "unique", "check", "foreign", "exclude"}:
            continue
        events.append((m.start(), "column", f"{m.group(1)}.{m.group(2)}.{m.group(3)}"))
    for m in POLICY_RE.finditer(text):
        events.append((m.start(), "policy", f"{m.group(2)}.{m.group(3)}.{m.group(1)}"))
    for m in TRIGGER_RE.finditer(text):
        events.append((m.start(), "trigger", f"{m.group(2)}.{m.group(3)}.{m.group(1)}"))
    drops = [(m.start(), f"{m.group(1)}.{m.group(2)}") for m in DROP_RE.finditer(text)]
    drops += [
        (m.start(), f"{m.group(2)}.{m.group(3)}.{m.group(1)}")
        for m in re.finditer(r"\bdrop\s+(?:policy|trigger)\s+(?:if\s+exists\s+)?" + NAME + r"\s+on\s+" + IDENT, text)
    ]
    out: list[tuple[str, str]] = []
    for pos, kind, name in sorted(events):
        if any(dpos < pos and dname == name for dpos, dname in drops):
            continue
        if (kind, name) not in out:
            out.append((kind, name))
    return out


def _lit(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def build_collision_sql(names: list[tuple[str, str]]) -> str:
    parts = []
    for kind, name in names:
        if kind == "relation":
            probe = f"to_regclass({_lit(name)}) is not null"
        elif kind == "type":
            probe = f"to_regtype({_lit(name)}) is not null"
        elif kind == "schema":
            probe = f"exists (select 1 from pg_namespace where nspname = {_lit(name)})"
        elif kind in {"column", "policy", "trigger"}:
            schema, table, obj = name.split(".", 2)
            rel = f"to_regclass({_lit(schema + '.' + table)})"
            if kind == "column":
                probe = f"exists (select 1 from pg_attribute where attrelid = {rel} and attname = {_lit(obj)} and not attisdropped)"
            elif kind == "policy":
                probe = f"exists (select 1 from pg_policy where polrelid = {rel} and polname = {_lit(obj)})"
            else:
                probe = f"exists (select 1 from pg_trigger where tgrelid = {rel} and tgname = {_lit(obj)} and not tgisinternal)"
        else:
            schema, fn = name.split(".", 1)
            probe = (
                "exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace "
                f"where n.nspname = {_lit(schema)} and p.proname = {_lit(fn)})"
            )
        parts.append(f"select {_lit(kind)} as kind, {_lit(name)} as name, ({probe}) as present")
    return " union all ".join(parts)


def find_collisions(names: list[tuple[str, str]], rows: object) -> list[str]:
    if not isinstance(rows, list) or len(rows) != len(names):
        raise Refusal("the sandbox catalog read did not return exactly one row per probed object")
    seen = {(r.get("kind"), r.get("name")): r.get("present") for r in rows if isinstance(r, dict)}
    hits = []
    for key in names:
        present = seen.get(key)
        if not isinstance(present, bool):
            raise Refusal(f"the sandbox catalog read gave no boolean answer for {key[1]}")
        if present:
            hits.append(f"{key[0]} {key[1]}")
    return hits


def collisions(repo: Path, raw_allowlist: str, project_ref: str, token: str, query=run_query) -> None:
    if project_ref != SANDBOX_PROJECT_REF:
        raise Refusal(f"collision preflight may read only the sandbox, not {project_ref}")
    migrations = local_migrations(repo)
    allowlist = parse_sandbox_allowlist(raw_allowlist, migrations)
    names: list[tuple[str, str]] = []
    for version in allowlist:
        for item in created_names(migrations[version].read_text(encoding="utf-8")):
            if item not in names:
                names.append(item)
    if not names:
        print("COLLISION PREFLIGHT OK: the allowlisted migrations create no named objects.")
        return
    hits = find_collisions(names, query(project_ref, token, build_collision_sql(names)))
    if hits:
        raise Refusal(
            "these objects would be created but a same-name object already exists on the sandbox; "
            "IF NOT EXISTS would silently keep the existing definition: " + ", ".join(hits)
        )
    print(f"COLLISION PREFLIGHT OK: {len(names)} created object name(s) absent from the sandbox catalog.")


def verify_ledger(before: Path, after: Path, raw_allowlist: str) -> None:
    b, a = parse_remote_versions(before), parse_remote_versions(after)
    allow = {v.strip() for v in raw_allowlist.split(",") if v.strip()}
    if not allow:
        raise Refusal("sandbox allowlist is empty")
    if a != b | allow:
        missing = sorted((b | allow) - a)
        extra = sorted(a - (b | allow))
        raise Refusal(f"sandbox ledger after apply is not before + allowlist: missing {missing}, unexpected {extra}")
    print(f"LEDGER OK: {len(allow)} allowlisted version(s) recorded; nothing else changed.")


def _token() -> str:
    token = os.environ.get("SUPABASE_ACCESS_TOKEN", "")
    if not token:
        raise Refusal("SUPABASE_ACCESS_TOKEN is not set")
    return token


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    subs = parser.add_subparsers(dest="command", required=True)
    ident = subs.add_parser("identity")
    ident.add_argument("--project-ref", required=True)
    allow = subs.add_parser("allowlist")
    allow.add_argument("--repo", type=Path, required=True)
    allow.add_argument("--allowlist", required=True)
    coll = subs.add_parser("collisions")
    coll.add_argument("--repo", type=Path, required=True)
    coll.add_argument("--allowlist", required=True)
    coll.add_argument("--project-ref", required=True)
    led = subs.add_parser("verify-ledger")
    led.add_argument("--before", type=Path, required=True)
    led.add_argument("--after", type=Path, required=True)
    led.add_argument("--allowlist", required=True)
    args = parser.parse_args(argv)
    try:
        if args.command == "identity":
            check_target_ref(args.project_ref, os.environ.get("PREVIEW_PROJECT_REF", ""))
            check_returned_project(args.project_ref, fetch_project(args.project_ref, _token()))
            print(f"IDENTITY OK: {args.project_ref} is the DesignFlow sandbox, not production or preview.")
        elif args.command == "allowlist":
            values = parse_sandbox_allowlist(args.allowlist, local_migrations(args.repo))
            print(f"SANDBOX ALLOWLIST OK: {', '.join(values)}")
        elif args.command == "collisions":
            collisions(args.repo, args.allowlist, args.project_ref, _token())
        else:
            verify_ledger(args.before, args.after, args.allowlist)
    except (Refusal, GuardError) as exc:
        print(f"REFUSED: {exc}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
