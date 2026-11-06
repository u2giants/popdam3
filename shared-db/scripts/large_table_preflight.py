#!/usr/bin/env python3
"""Read table sizes for tables a bounded migration batch indexes or rewrites.

Plan step 2.6 (popcre/ai-devops#2367). Production incidents #1427 and #5165
both passed the preview rehearsal and then failed on production-size tables:
a normalization DO block, and GIN index builds over the full corpus. Preview
cannot rehearse that -- its copies of the same tables are small -- so the
apply lane itself must look before it writes.

This preflight is ADVISORY about the SQL: it refuses no migration. It

  1. statically lists the tables the bounded batch creates indexes on or
     rewrites (UPDATE, INSERT..SELECT, ALTER COLUMN ... TYPE, SET NOT NULL,
     ADD COLUMN ... NOT NULL ... DEFAULT), including inside DO blocks, with
     SQL line comments and block comments stripped first;
  2. reads each candidate's total relation size and row estimate from the
     linked target through the same proved pooler identity the atomic apply
     path uses (static-only mode when no --linked-dir is given);
  3. reports every candidate over the size or row threshold with a bounded
     statement-timeout budget the caller may pass to the atomic apply path.

The db push lane inherits the server's statement timeout, so for that lane the
report is the deliverable: a flagged table says the work may need splitting
before it can promote cleanly, in plain words, at apply time rather than as a
rollback afterwards.

Exit codes: 0 with the advisory report (or no candidates); 2 on a refusal --
an unprovable target or unreadable batch is a preflight defect, never a size
verdict. An apply is never blocked on a size verdict.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from atomic_migration_apply import Refusal, linked_connection, psql  # noqa: E402

# The two incidents this step exists for set the thresholds. #5165's corpus is
# ~65k rows of ruling text plus embeddings -- a few hundred MB of relation, so
# a row-count rule alone would wave it through; #1427's assets table is far
# past either bound. Under both bounds, the smallest rule that catches the two
# known failures lets ordinary reference tables and freshly created tables
# through untouched.
LARGE_TABLE_BYTES = 128 * 1024 * 1024
LARGE_TABLE_ROWS = 200_000

STATEMENT_BUDGET_MS = 900_000
STATEMENT_BUDGET_MAX_MS = 3_600_000

_IDENT = r'"?([A-Za-z_][A-Za-z0-9_$]*)"?(?:\s*\.\s*"?([A-Za-z_][A-Za-z0-9_$]*)"?)?'
CREATE_INDEX_RE = re.compile(
    r"(?is)\bcreate\s+(?:unique\s+)?index\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?"
    r"(?:[A-Za-z_][A-Za-z0-9_$.\"]*\s+)?on\s+(?:only\s+)?" + _IDENT
)
UPDATE_RE = re.compile(r"(?is)\bupdate\s+(?:only\s+)?" + _IDENT)
# The gap to the select may not cross a statement boundary, or a values
# insert followed later in the file by any select would match.
INSERT_SELECT_RE = re.compile(r"(?is)\binsert\s+into\s+" + _IDENT + r"[^;]{0,400}?\bselect\b")
ALTER_REWRITE_RE = re.compile(
    r"(?is)\balter\s+table\s+(?:only\s+)?(?:if\s+exists\s+)?" + _IDENT
    + r"\s+[^\n;]*(?:\balter\s+column\b[^\n;]*\btype\b|\bset\s+not\s+null\b"
    r"|\badd\s+column\b[^\n;]*\bnot\s+null\b[^\n;]*\bdefault\b)"
)

LINE_COMMENT_RE = re.compile(r"--[^\n]*")
BLOCK_COMMENT_RE = re.compile(r"/\*[\s\S]*?\*/")

REASON_INDEX = "index build scales with table size"
REASON_REWRITE = "table rewrite or bulk write scales with table size"


def strip_comments(raw: str) -> str:
    return BLOCK_COMMENT_RE.sub(" ", LINE_COMMENT_RE.sub(" ", raw))


def qualified(first: str, second: str | None) -> str:
    """schema.table when both parts matched, else the bare table name."""
    return f"{first}.{second}" if second else first


def candidate_tables(raw: str) -> dict[str, str]:
    """Map each candidate table to the reason it is a candidate."""
    text = strip_comments(raw)
    candidates: dict[str, str] = {}

    def add(match: re.Match[str], reason: str) -> None:
        table = qualified(match.group(1), match.group(2))
        candidates.setdefault(table, reason)

    for match in CREATE_INDEX_RE.finditer(text):
        add(match, REASON_INDEX)
    for regex, reason in (
        (UPDATE_RE, REASON_REWRITE),
        (INSERT_SELECT_RE, REASON_REWRITE),
        (ALTER_REWRITE_RE, REASON_REWRITE),
    ):
        for match in regex.finditer(text):
            add(match, reason)
    return candidates


def statement_budget_ms(candidates: list[dict[str, object]]) -> int:
    """Bounded statement budget for a flagged batch: 15/30/60 minute tiers."""
    largest_bytes = max((int(row.get("bytes") or 0) for row in candidates), default=0)
    if largest_bytes >= 5 * 1024**3:
        return 3_600_000
    if largest_bytes >= 1024**3:
        return 1_800_000
    return STATEMENT_BUDGET_MS


def read_table_size(url: str | None, env: dict[str, str] | None, table: str) -> dict[str, object]:
    """One read-only size probe. No linked target means the row reports absent."""
    if url is None or env is None:
        return {"table": table, "present": False, "bytes": None, "rows": None, "note": "static preflight only (no linked target)"}
    # The candidate name comes from the migration SQL's own identifier grammar
    # ([A-Za-z0-9_$] parts, one optional dot), so inlining it into the probe is
    # injection-safe by construction; anything else refuses rather than quoting.
    if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)?", table):
        raise Refusal(f"candidate table name is not a plain identifier: {table}")
    sql = (
        "select coalesce(pg_catalog.pg_total_relation_size(r), 0) || '|' || "
        "coalesce((select c.reltuples::bigint from pg_catalog.pg_class c where c.oid = r), -1) "
        f"from pg_catalog.to_regclass('{table}') as r"
    )
    try:
        output = psql(url, env, sql)
    except Refusal as exc:
        raise Refusal(f"size read failed for {table}: {exc}") from exc
    line = output.strip().splitlines()[-1] if output.strip() else ""
    if "|" not in line:
        return {"table": table, "present": False, "bytes": None, "rows": None,
                "note": "table not present on the target yet (created by this batch)"}
    bytes_raw, rows_raw = line.split("|", 1)
    return {"table": table, "present": True, "bytes": int(bytes_raw), "rows": int(rows_raw)}


def run_preflight(
    migrations_dir: Path,
    versions: list[str],
    *,
    target: str,
    url: str | None = None,
    env: dict[str, str] | None = None,
) -> dict[str, object]:
    candidates: dict[str, str] = {}
    batch: dict[str, str] = {}
    for version in versions:
        path = migrations_dir / _name_of(migrations_dir, version)
        raw = path.read_text(encoding="utf-8")
        batch[version] = path.name
        for table, reason in candidate_tables(raw).items():
            candidates.setdefault(table, reason)
    rows: list[dict[str, object]] = []
    for table, reason in sorted(candidates.items()):
        row = read_table_size(url, env, table)
        row["reason"] = reason
        row["over_threshold"] = bool(
            row["present"]
            and ((row["bytes"] or 0) >= LARGE_TABLE_BYTES or (row["rows"] or 0) >= LARGE_TABLE_ROWS)
        )
        rows.append(row)
    flagged = [row for row in rows if row["over_threshold"]]
    return {
        "target": target,
        "batch": batch,
        "candidates": rows,
        "flagged": flagged,
        "statement_budget_ms": statement_budget_ms(flagged) if flagged else 0,
        "verdict": "large-table apply" if flagged else ("candidates under threshold" if rows else "no large-table candidates"),
    }


def _name_of(migrations_dir: Path, version: str) -> str:
    matches = sorted(path.name for path in migrations_dir.glob(f"{version}_*.sql"))
    if len(matches) != 1:
        raise Refusal(f"expected exactly one migration file for version {version}, found {len(matches)}")
    return matches[0]


def render(report: dict[str, object]) -> str:
    lines = [
        f"large-table preflight (target={report['target']}): "
        f"{len(report['candidates'])} candidate(s), verdict: {report['verdict']}"
    ]
    for row in report["candidates"]:
        if row["present"]:
            lines.append(
                f"  {row['table']}: {int(row['bytes']) / 1024 / 1024:.0f} MB, ~{row['rows']} rows"
                + (" -- OVER THRESHOLD" if row["over_threshold"] else "")
                + f" ({row['reason']})"
            )
        else:
            lines.append(f"  {row['table']}: {row['note']} ({row['reason']})")
    if report["flagged"]:
        budget = int(report["statement_budget_ms"])
        lines.append(
            f"large-table apply: bounded statement budget {budget // 60000} minutes for the atomic path; "
            "a db push apply keeps the server timeout, so a rollback here means the work needs splitting (plan step 2.6)"
        )
    return "\n".join(lines)


def main() -> int:
    # Tiny helper mode for the apply steps: print one number, the bounded
    # statement budget a flagged batch earned (0 when nothing was flagged or
    # the report could not be read). Kept out of argparse so the shell side
    # stays a single substitution with a fallback.
    if len(sys.argv) == 3 and sys.argv[1] == "--print-budget":
        try:
            print(int(json.loads(Path(sys.argv[2]).read_text(encoding="utf-8"))["statement_budget_ms"]))
        except (OSError, ValueError, KeyError):
            print(0)
        return 0
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--dir", required=True, type=Path, help="bounded migrations checkout (contains supabase/migrations)")
    parser.add_argument("--allowlist", required=True, help="comma-separated bounded versions")
    parser.add_argument("--target", required=True, choices=("preview", "production"))
    parser.add_argument("--linked-dir", type=Path, help="linked project dir; omit for static-only mode")
    parser.add_argument("--expected-project-ref", help="project ref the linked identity must prove")
    parser.add_argument("--json-out", type=Path, help="write the machine-readable report here")
    args = parser.parse_args()

    try:
        versions = [item.strip() for item in args.allowlist.split(",") if item.strip()]
        if not versions:
            raise Refusal("allowlist is empty")
        url: str | None = None
        env: dict[str, str] | None = None
        if args.linked_dir is not None:
            if not args.expected_project_ref:
                raise Refusal("--linked-dir requires --expected-project-ref")
            url, env = linked_connection(args.linked_dir, args.expected_project_ref)
        migrations_dir = args.dir / "supabase" / "migrations"
        report = run_preflight(migrations_dir, versions, target=args.target, url=url, env=env)
    except Refusal as exc:
        print(f"REFUSED: {exc}", file=sys.stderr)
        return 2
    print(render(report))
    if args.json_out:
        args.json_out.write_text(json.dumps(report, indent=2), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
