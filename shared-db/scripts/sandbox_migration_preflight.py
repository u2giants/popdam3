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
import hashlib
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
    assert_content_manifest,
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
    "20261009191951": (
        "issue #3869: this migration moves the sandbox's 2026-09-29 coldlion table copy "
        "aside and must run in ONE transaction with the canonical landing migrations and the "
        "re-execution of 20261009170724; applied alone it leaves the sandbox with no landing "
        "tables. Use tools/coldlion-landing/sandbox-spine-apply.py."
    ),
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
    cond = subs.add_parser("condition")
    cond.add_argument("--repo", type=Path, required=True)
    cond.add_argument("--allowlist", required=True)
    cond.add_argument("--project-ref", required=True)
    cond.add_argument("--evidence-out", type=Path, required=True)
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
        elif args.command == "condition":
            condition(args.repo, args.allowlist, args.project_ref, _token(), args.evidence_out)
        else:
            verify_ledger(args.before, args.after, args.allowlist)
    except (Refusal, GuardError) as exc:
        print(f"REFUSED: {exc}", file=sys.stderr)
        return 2
    return 0

# ---------------------------------------------------------------------------
# THE SCHEMA-CONDITIONED BLOCK (issue #2986).
#
# The sandbox does not carry every schema production has (dflow_prod is absent
# until the structural route creates it), so an allowlisted migration whose
# statements target objects in an ABSENT schema would fail 42P01 mid-batch and
# strand a half-applied file. Instead of blocking the version unconditionally —
# which contradicts the successor route that must eventually apply it — the
# bounded checkout (and ONLY the bounded checkout; the repository file is
# immutable) gets each qualifying statement wrapped in a live schema-existence
# guard:
#
#   do $sandbox_schema_guard_N$ begin
#     if exists (select 1 from pg_namespace where nspname = 'dflow_prod') then
#       <the original statement, byte for byte>
#     end if;
#   end $sandbox_schema_guard_N$;
#
# On the live sandbox the guarded statement runs exactly when its target schema
# exists, in BOTH dry-run and apply, so a green dry-run and a succeeding apply
# stay the same instrument. When every conditioned schema is present the file's
# bytes are untouched. The preview and production lanes never call this code.
# Only alter/comment/do statements may be conditioned; anything else that names
# an absent conditioned schema is refused by name, so no statement is ever
# silently dropped.
# ---------------------------------------------------------------------------

CONDITIONED_SCHEMAS = ("dflow_prod",)
# System schemas (pg_catalog, information_schema, pg_*) never appear in
# `live_schemas` because the read-only probe excludes them, so a qualified
# reference to them inside a conditioned statement (an information_schema
# lookup in a verification do-block, for example) never counts as a second
# live schema and never disqualifies the statement.
WRAPPABLE_HEADS = ("alter", "comment", "do")
CONDITIONING_EVIDENCE_SCHEMA = "shared-db-sandbox-schema-conditioning/v1"


def scan_text(statement: str) -> str:
    """Statement text with comments blanked and everything else kept.

    String literals, dollar-quoted bodies and quoted identifiers are KEPT on
    purpose: a conditioned statement can reach its schema through a literal
    (`'dflow_prod.t'::regclass`) or inside a do block, and the conditioner must
    see those mentions. Only comments are removed, because a comment naming
    another schema (migration header prose) says nothing about what the
    statement touches.
    """
    out: list[str] = []
    unterminated: str | None = None
    i, n = 0, len(statement)
    while i < n:
        ch = statement[i]
        if statement.startswith("--", i):
            end = statement.find("\n", i)
            i = n if end == -1 else end
            out.append(" ")
        elif statement.startswith("/*", i):
            depth, i = 1, i + 2
            while i < n and depth:
                if statement.startswith("/*", i):
                    depth, i = depth + 1, i + 2
                elif statement.startswith("*/", i):
                    depth, i = depth - 1, i + 2
                else:
                    i += 1
            if depth:
                unterminated = "block comment"
            out.append(" ")
        elif ch == "'":
            j = i + 1
            closed = False
            while j < n:
                if statement.startswith("''", j):
                    j += 2
                elif statement[j] == "'":
                    j += 1
                    closed = True
                    break
                else:
                    j += 1
            if not closed:
                unterminated = "single-quoted literal"
            out.append(statement[i:j])
            i = j
        elif ch == '"':
            j = statement.find('"', i + 1)
            if j == -1:
                unterminated = "quoted identifier"
                j = n
            else:
                j += 1
            out.append(statement[i:j])
            i = j
        elif ch == "$":
            m = re.match(r"\$[A-Za-z_][A-Za-z0-9_]*\$|\$\$", statement[i:])
            if m:
                tag = m.group(0)
                k = statement.find(tag, i + len(tag))
                if k == -1:
                    unterminated = "dollar-quoted body"
                    k = n
                else:
                    k += len(tag)
                out.append(statement[i:k])
                i = k
            else:
                out.append(ch)
                i += 1
        else:
            out.append(ch)
            i += 1
    if unterminated:
        # Fail closed exactly like statement_spans: unlexable text is a
        # refusal, never a silent consume-to-EOF that hides a mention.
        raise Refusal(f"the sandbox conditioner cannot lex an unterminated {unterminated}")
    return "".join(out)


def statement_head(statement: str) -> str:
    match = re.match(r"\s*([A-Za-z_][A-Za-z0-9_]*)", scan_text(statement))
    return match.group(1).lower() if match else ""


def statement_spans(raw: str) -> list[tuple[int, int, str]]:
    """(start, end after the semicolon, statement text without the semicolon)."""
    spans: list[tuple[int, int, str]] = []
    start = 0
    i, n = 0, len(raw)
    state = "normal"
    dollar = ""
    while i < n:
        c = raw[i]
        nxt = raw[i + 1] if i + 1 < n else ""
        if state == "normal":
            if c == "'":
                state = "single"
            elif c == '"':
                state = "double"
            elif c == "-" and nxt == "-":
                state = "line"
                i += 1
            elif c == "/" and nxt == "*":
                state = "block"
                i += 1
            elif c == "$":
                m = re.match(r"\$[A-Za-z_][A-Za-z0-9_]*\$|\$\$", raw[i:])
                if m:
                    dollar = m.group(0)
                    state = "dollar"
                    i += len(dollar) - 1
            elif c == ";":
                statement = raw[start:i].strip()
                if statement:
                    # Anchor at the statement's first non-space character so the
                    # whitespace that separates statements is never swallowed.
                    spans.append((start + (len(raw[start:i]) - len(raw[start:i].lstrip())), i + 1, statement))
                start = i + 1
        elif state == "single":
            if c == "'" and nxt == "'":
                i += 1
            elif c == "'":
                state = "normal"
        elif state == "double":
            if c == '"' and nxt == '"':
                i += 1
            elif c == '"':
                state = "normal"
        elif state == "line":
            if c == "\n":
                state = "normal"
        elif state == "block":
            if c == "*" and nxt == "/":
                state = "normal"
                i += 1
        elif state == "dollar" and raw.startswith(dollar, i):
            state = "normal"
            i += len(dollar) - 1
        i += 1
    if state not in {"normal", "line"}:
        raise Refusal("the sandbox conditioner cannot lex the migration text")
    tail = raw[start:].strip()
    if tail:
        spans.append((start + (len(raw[start:]) - len(raw[start:].lstrip())), len(raw), tail))
    return spans


def _mentions(text: str, name: str) -> bool:
    return re.search(rf"\b{re.escape(name)}\b", text, re.I) is not None


def wrap_guard(statement: str, schema: str, tag: str) -> str:
    return (
        f"do {tag} begin\n"
        f"  if exists (select 1 from pg_namespace where nspname = '{schema}') then\n"
        f"{statement};\n"
        f"  end if;\n"
        f"end {tag};"
    )


def condition_plan(raw: str, live_schemas: list[str], absent: list[str], version: str) -> list[tuple[int, int, str, str, str]]:
    """Wrapped statements for one migration, or a named refusal.

    Every statement that names an absent conditioned schema must be exactly one
    of the wrappable heads, must name no other live schema (a mixed-schema
    statement would skip its other target when the guard is false), and must
    carry no dynamic SQL (`execute`), which no text scanner can bound.
    """
    wraps: list[tuple[int, int, str, str]] = []
    for index, (start, end, statement) in enumerate(statement_spans(raw), start=1):
        text = scan_text(statement)
        targeted = [name for name in absent if _mentions(text, name)]
        if not targeted:
            continue
        head = statement_head(statement)
        label = f"{version} statement {index} ({head})"
        others = sorted(name for name in live_schemas if name not in absent and name not in CONDITIONED_SCHEMAS and _mentions(text, name))
        if others:
            raise Refusal(f"{label} names the absent conditioned schema {targeted} and also live schema(s) {others}; mixed-schema statements are never conditioned")
        if len(targeted) > 1:
            raise Refusal(f"{label} names several conditioned schemas {targeted}; refusing rather than guessing the guard")
        if re.search(r"\bexecute\b", text, re.I):
            raise Refusal(f"{label} contains dynamic SQL, which no text scanner can bound; refusing to condition it")
        if head in {"begin", "commit", "rollback", "savepoint", "start"}:
            raise Refusal(f"{label} is transaction control that names an absent conditioned schema; refusing to condition it")
        if head not in WRAPPABLE_HEADS:
            raise Refusal(
                f"{label} names absent schema {targeted[0]} and has head '{head}', which this lane does not condition; "
                "bring the schema first or extend the reviewed wrappable heads"
            )
        tag = f"$sandbox_schema_guard_{index}$"
        if tag in raw:
            raise Refusal(f"{label} already contains the conditioner's dollar-quote tag {tag}")
        wraps.append((start, end, statement, targeted[0], tag))
    return wraps


def apply_conditioning(raw: str, wraps: list[tuple[int, int, str, str, str]]) -> str:
    out = raw
    for start, end, statement, schema, tag in reversed(wraps):
        out = out[:start] + wrap_guard(statement, schema, tag) + out[end:]
    return out


def update_conditioned_manifest_entries(repo: Path, adapted: dict[str, str]) -> None:
    """Re-pin ONLY the conditioned versions, preserving prepare's other pins.

    `prepare` pinned every file's digest; conditioning changes only the wrapped
    files. Rewriting the whole manifest from disk would make the later
    `assert-bounded` tautologically green for EVERY file, so the untouched
    entries must keep the digests `prepare` wrote and only the conditioned
    versions get their adapted digest. `assert_content_manifest` still compares
    every entry afterwards and refuses any other divergence.
    """
    from production_migration_guard import MANIFEST_FILENAME

    path = repo / "supabase" / MANIFEST_FILENAME
    try:
        stored = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise Refusal(f"the bounded checkout's content manifest is unreadable ({exc})") from exc
    if not isinstance(stored, dict):
        raise Refusal("the bounded checkout's content manifest is not a JSON object")
    changed = 0
    for version, digest in adapted.items():
        if version not in stored:
            raise Refusal(f"content manifest has no entry for conditioned version {version}; re-run prepare")
        stored[version] = digest
        changed += 1
    if not changed:
        return
    path.write_text(json.dumps(stored, indent=2, sort_keys=True) + "\n", encoding="utf-8", newline="\n")


def condition(
    repo: Path,
    raw_allowlist: str,
    project_ref: str,
    token: str,
    evidence_out: Path,
    query=run_query,
) -> None:
    """Condition the bounded checkout's allowlisted migrations on live schemas."""
    if project_ref != SANDBOX_PROJECT_REF:
        raise Refusal(f"schema conditioning may touch only the sandbox bounded checkout, not {project_ref}")
    migrations = local_migrations(repo)
    allowlist = parse_sandbox_allowlist(raw_allowlist, migrations)
    rows = query(
        project_ref,
        token,
        "select nspname from pg_namespace where nspname not like 'pg\\_%' "
        "and nspname not in ('pg_catalog','information_schema') order by 1",
    )
    if not isinstance(rows, list) or not rows or any(not isinstance(row, dict) or not isinstance(row.get("nspname"), str) for row in rows):
        raise Refusal("the sandbox schema read did not return a usable namespace list")
    live = sorted({row["nspname"] for row in rows})
    absent = [name for name in CONDITIONED_SCHEMAS if name not in live]
    files: list[dict] = []
    adapted_digests: dict[str, str] = {}
    if absent:
        # Prove the checkout still carries prepare's verified bytes before any edit.
        assert_content_manifest(repo)
    for version in allowlist:
        path = migrations[version]
        raw = path.read_text(encoding="utf-8")
        entry = {
            "version": version,
            "name": path.name,
            "original_sha256": hashlib.sha256(raw.encode("utf-8")).hexdigest(),
        }
        if not absent:
            entry.update({"unchanged": True, "wrapped_statements": []})
            files.append(entry)
            continue
        wraps = condition_plan(raw, live, absent, version)
        if wraps:
            adapted = apply_conditioning(raw, wraps)
            # The wrapped file must lex to exactly as many statements, with the
            # wrapped statement text preserved byte for byte inside its guard.
            respans = statement_spans(adapted)
            if len(respans) != len(statement_spans(raw)):
                raise Refusal(f"{version}: conditioned text did not re-lex to the same statement count")
            for _start, _end, statement, _schema, _tag in wraps:
                if statement not in adapted:
                    raise Refusal(f"{version}: a wrapped statement lost its exact text")
            path.write_text(adapted, encoding="utf-8")
            adapted_digests[version] = hashlib.sha256(path.read_bytes()).hexdigest()
            entry.update({
                "unchanged": False,
                "adapted_sha256": adapted_digests[version],
                "wrapped_statements": [
                    {"head": statement_head(statement), "guard_schema": schema, "text_sha256": hashlib.sha256(statement.encode("utf-8")).hexdigest()}
                    for _start, _end, statement, schema, _tag in wraps
                ],
            })
        else:
            entry.update({"unchanged": True, "wrapped_statements": []})
        files.append(entry)
    if adapted_digests:
        # Re-pin ONLY the conditioned entries; every untouched file keeps the
        # digest prepare wrote, so the later assert-bounded still proves those
        # bytes against prepare (issue #2986 review M3).
        update_conditioned_manifest_entries(repo, adapted_digests)
    evidence_out.write_text(
        json.dumps(
            {
                "schema": CONDITIONING_EVIDENCE_SCHEMA,
                "project_ref": project_ref,
                "conditioned_schemas": list(CONDITIONED_SCHEMAS),
                "absent": absent,
                "live_schemas": live,
                "files": files,
            },
            indent=1,
            sort_keys=True,
        )
        + "\n",
        encoding="utf-8",
    )
    if not absent:
        print(f"SCHEMA CONDITIONING OK: every conditioned schema is present on {project_ref}; no bytes changed.")
    elif not adapted_digests:
        print(f"SCHEMA CONDITIONING OK: absent {absent}; no allowlisted statement targets them; no bytes changed.")
    else:
        wrapped = sum(len(entry["wrapped_statements"]) for entry in files)
        print(f"SCHEMA CONDITIONING OK: absent {absent}; wrapped {wrapped} statement(s) in the bounded checkout only; conditioned manifest entries re-pinned, prepare's other pins preserved.")



if __name__ == "__main__":
    sys.exit(main())
