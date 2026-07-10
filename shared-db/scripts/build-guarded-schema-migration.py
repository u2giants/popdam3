#!/usr/bin/env python3
"""Wrap a pg_dump schema snapshot in a schema-existence guard.

The generated migration is intended for reconciliation work: if the target
schema already exists, it is a no-op. Otherwise each pg_dump statement is
executed separately from a temporary procedure so functions, tables,
constraints, indexes, and comments retain their original ordering.
"""

from __future__ import annotations

import argparse
from pathlib import Path
import re

import sqlparse


def statements_from_dump(raw: str) -> list[str]:
    lines = [
        line
        for line in raw.splitlines()
        if not line.startswith("\\restrict") and not line.startswith("\\unrestrict")
    ]
    cleaned = sqlparse.format("\n".join(lines), strip_comments=True)
    statements = []
    for statement in sqlparse.split(cleaned):
        statement = statement.strip()
        if not statement:
            continue
        upper = statement.upper()
        if upper.startswith("SET ") or upper.startswith("SELECT PG_CATALOG.SET_CONFIG"):
            continue
        statements.append(statement.rstrip(";") + ";")
    return statements


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("dump", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--schema", required=True)
    parser.add_argument("--procedure", required=True)
    parser.add_argument(
        "--skip-when",
        help="SQL boolean expression that makes the generated procedure a no-op",
    )
    parser.add_argument(
        "--exclude-pattern",
        action="append",
        default=[],
        help="Regular expression for dump statements to omit (repeatable)",
    )
    args = parser.parse_args()

    statements = statements_from_dump(args.dump.read_text(encoding="utf-8"))
    statements = [
        statement
        for statement in statements
        if not any(re.search(pattern, statement, re.IGNORECASE) for pattern in args.exclude_pattern)
    ]
    skip_when = args.skip_when or f"to_regnamespace('{args.schema}') is not null"
    out = [
        "-- Generated from a read-only production pg_dump schema snapshot.",
        "-- Additive reconciliation: skip the complete baseline when the schema exists.",
        f"create or replace procedure public.{args.procedure}()",
        "language plpgsql",
        "as $guard$",
        "begin",
        f"  if {skip_when} then",
        f"    raise notice 'reconciliation target already exists; baseline skipped';",
        "    return;",
        "  end if;",
    ]
    for index, statement in enumerate(statements):
        delimiter = f"$ddl_{index}$"
        out.extend([f"  execute {delimiter}", statement, f"{delimiter};"])
    out.extend(
        [
            "end;",
            "$guard$;",
            "",
            f"call public.{args.procedure}();",
            f"drop procedure public.{args.procedure}();",
            "",
        ]
    )
    args.output.write_text("\n".join(out), encoding="utf-8", newline="\n")


if __name__ == "__main__":
    main()
