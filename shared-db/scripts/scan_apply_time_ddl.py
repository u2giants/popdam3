#!/usr/bin/env python3
r"""Which migrations create a relation that `strip_sql()` cannot see?

This is the re-derivable artifact behind section 3.1 of
`plan_orchestrator_throughput_guard_truth.md`. Run it from the repository root:

    python scripts/scan_apply_time_ddl.py

WHY THIS IS NOT A REGEX OVER `$$`
---------------------------------
Three earlier answers to this question were produced with a regex and two of
them were wrong. A dollar quote is `$tag$`, not `$$`; a bare `\$\$` pattern
phantom-pairs a `$$` inside a `--` comment with a later real `do $$`, and is
blind to `$ddl$`, `$migration$` and `$ddl_0$` entirely.

Two further distinctions a flat scan gets wrong, and this scanner does not:

1. APPLY-TIME vs CALL-TIME. `create procedure p() as $guard$ execute $ddl_0$
   CREATE TABLE ... $ddl_0$ $guard$` creates nothing when the migration
   applies -- only when someone calls `p()`. Treating those bodies as creators
   would put objects into `available` that production does not have: a FALSE
   ACCEPT, the failure `created_objects` exists to prevent. Bodies whose
   enclosing context is `create [or replace] function|procedure` are therefore
   excluded, at every nesting depth.
2. TEXT THAT MERELY MENTIONS DDL. `and indexdef = 'CREATE INDEX ...'` is an
   assertion, and `-- the schema default grant that CREATE TABLE just applied`
   is prose. Comments and single-quoted literals are blanked inside each body
   before matching, which is why `20260717163500` and `20260810140000` are
   absent from the output and were false positives in version 1 of section 3.1.

An object already visible after `strip_sql()` is not reported: the lexer can
see it, so it is not a blind spot.
"""
from __future__ import annotations

import glob
import io
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__))))
from production_migration_guard import strip_sql  # noqa: E402

DOLLAR_OPEN = re.compile(r"\$([A-Za-z_][A-Za-z0-9_]*)?\$")
NAME = r'(?:[A-Za-z_]\w*|"[^"]+")(?:\.(?:[A-Za-z_]\w*|"[^"]+"))*'
RELATION = re.compile(
    r"\bcreate\s+(?:unique\s+)?(table|index|materialized\s+view|view)\s+"
    r"(?:if\s+not\s+exists\s+)?(" + NAME + r")",
    re.I,
)
DROPPED = re.compile(
    r"\bdrop\s+(?:table|index|materialized\s+view|view)\s+"
    r"(?:if\s+exists\s+)?(" + NAME + r")",
    re.I,
)
# Captures the routine name so we can ask whether the migration calls it.
ROUTINE = re.compile(
    r"create\s+(?:or\s+replace\s+)?(?:function|procedure)\s+(" + NAME + r")",
    re.I,
)
CONTEXT_CHARS = 260


def declutter(sql: str) -> str:
    """Blank comments and single-quoted literals so mentions are not matches."""
    sql = re.sub(r"--[^\n]*", "", sql)
    sql = re.sub(r"/\*.*?\*/", "", sql, flags=re.S)
    return re.sub(r"'(?:[^']|'')*'", "''", sql)


def dollar_bodies(sql: str):
    """Yield (tag, body, preceding_context) for each dollar-quoted body."""
    index = 0
    while True:
        match = DOLLAR_OPEN.search(sql, index)
        if not match:
            return
        tag = match.group(0)
        end = sql.find(tag, match.end())
        if end == -1:
            index = match.end()
            continue
        yield tag, sql[match.end():end], sql[max(0, match.start() - CONTEXT_CHARS):match.start()]
        index = end + len(tag)


def bare(name):
    return name.replace('"', "")


def scan_file(path):
    raw = io.open(path, encoding="utf-8", errors="replace").read()
    visible = strip_sql(raw)
    flat = declutter(raw)
    # Match on the leaf name: a migration may create `x` unqualified and
    # drop `public.x` qualified. A relation dropped in the same migration
    # is not a durable post-apply target.
    dropped = {bare(m.group(1)).lower().split(".")[-1] for m in DROPPED.finditer(flat)}
    found = {}

    def invoked(routine):
        """True when the migration itself runs the routine it just defined.

        A `create procedure` body is call-time DDL *only* if nobody calls it.
        The three `reconcile_*` migrations end with `call public.reconcile_x();`,
        which makes those bodies apply-time after all. Missing that inverts the
        classification and under-reports the corpus.
        """
        leaf = re.escape(bare(routine).split(".")[-1])
        pattern = r"(?:\bcall\s+|\bperform\s+|\bselect\s+)(?:[\w\"]+\.)?" + leaf + r"\s*\("
        return re.search(pattern, flat, re.I) is not None

    def walk(sql, apply_time):
        for tag, body, context in dollar_bodies(sql):
            routine = ROUTINE.search(context)
            nested_apply_time = apply_time and (
                routine is None or invoked(routine.group(1))
            )
            if nested_apply_time:
                for match in RELATION.finditer(declutter(body)):
                    name = bare(match.group(2))
                    if (
                        name.startswith("pg_temp.")
                        or name in visible
                        or name.lower().split(".")[-1] in dropped
                    ):
                        continue
                    # Keyed on (kind, name) only. A nested body is reported by
                    # its innermost tag; the enclosing `do $migration$` that
                    # carries it is the same creation site, not a second one.
                    found[(match.group(1).lower(), name)] = tag
            walk(body, nested_apply_time)

    walk(raw, True)
    return found


def main() -> int:
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    total = 0
    unique = set()
    for path in sorted(glob.glob(os.path.join(root, "supabase", "migrations", "*.sql"))):
        hits = scan_file(path)
        if not hits:
            continue
        print(f"## {os.path.basename(path)}")
        for (kind, name), tag in sorted(hits.items()):
            print(f"   {kind:<8} {name:<46} inside {tag}")
            total += 1
            unique.add((kind, name))
    print(
        f"\n{total} apply-time creation(s), {len(unique)} unique relation(s), "
        "invisible to strip_sql()"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
