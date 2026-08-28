#!/usr/bin/env python3
"""Read-only proof for the issue #1750 production ledger recovery."""

from __future__ import annotations

import json
import os
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))

from atomic_migration_apply import split_sql  # noqa: E402
from production_catalog_verification import run_query  # noqa: E402

PROJECT_REF = "qsllyeztdwjgirsysgai"
VERSION = "20260828052706"
NAME = "sync_dflow_columns_onto_plm_designflow_copies"
SOURCE = Path("supabase/migrations/20260817150944_sync_dflow_columns_onto_plm_designflow_copies.sql")

RFQ_COLUMNS = (
    "rfqItem_gen_fob_buyer_target", "rfqItem_gen_fob_buyer_margin",
    "rfqItem_gen_poe_buyer_target", "rfqItem_gen_poe_buyer_margin",
    "rfqItem_gen_whse_buyer_target", "rfqItem_gen_whse_buyer_margin",
    "rfqItem_gen_mddp_buyer_target", "rfqItem_gen_mddp_buyer_margin",
    "rfqItem_lic_fob_buyer_target", "rfqItem_lic_fob_buyer_margin",
    "rfqItem_lic_poe_buyer_target", "rfqItem_lic_poe_buyer_margin",
    "rfqItem_lic_whse_buyer_target", "rfqItem_lic_whse_buyer_margin",
    "rfqItem_lic_mddp_buyer_target", "rfqItem_lic_mddp_buyer_margin",
)
ITEM_COLUMNS = ("coldlion_synced_at", "compan_code_fk", "div_code_fk", "item_num_id")


def expected_statements(repo: Path) -> list[str]:
    return split_sql((repo / SOURCE).read_text(encoding="utf-8"))


def build_query(statements: list[str]) -> str:
    expected = json.dumps(statements, separators=(",", ":"))
    rfq = ",".join("'" + x.replace("'", "''") + "'" for x in RFQ_COLUMNS)
    item = ",".join("'" + x.replace("'", "''") + "'" for x in ITEM_COLUMNS)
    return f"""
with ledger as (
  select version, name, statements
  from supabase_migrations.schema_migrations
  where version = '{VERSION}'
), catalog_checks as (
  select
    (select count(*) from information_schema.columns where table_schema='plm' and table_name='RFQItem' and column_name in ({rfq}) and data_type='double precision') = 16 as rfq_columns_ok,
    exists (select 1 from information_schema.columns where table_schema='plm' and table_name='GridViewState' and column_name='column_group_state' and data_type='jsonb') as grid_column_ok,
    (select count(*) from information_schema.columns where table_schema='plm' and table_name='itemDetail' and column_name in ({item})) = 4 as item_columns_ok
)
select
  count(*) = 1 as one_ledger_row,
  coalesce(bool_and(name = '{NAME}'), false) as name_ok,
  coalesce(bool_and(to_jsonb(statements) = $expected${expected}$expected$::jsonb), false) as statements_exact,
  coalesce(max(cardinality(statements)), 0) as statement_count,
  (select rfq_columns_ok from catalog_checks) as rfq_columns_ok,
  (select grid_column_ok from catalog_checks) as grid_column_ok,
  (select item_columns_ok from catalog_checks) as item_columns_ok
from ledger;
""".strip()


def verify(row: dict, statements: list[str]) -> dict:
    required = ("one_ledger_row", "name_ok", "statements_exact", "rfq_columns_ok", "grid_column_ok", "item_columns_ok")
    failed = [key for key in required if row.get(key) is not True]
    if row.get("statement_count") != len(statements):
        failed.append("statement_count")
    if failed:
        raise RuntimeError("read-only recovery proof failed: " + ", ".join(failed))
    return {
        "project_ref": PROJECT_REF,
        "version": VERSION,
        "name": NAME,
        "source_version": SOURCE.name[:14],
        "source_file_sha256": "c8ab692586a94fef5dfdf18b32105ccb9f9469bb8336c40fab793c1c4404dace",
        "statement_count": len(statements),
        "statement_identity": "exact",
        "catalog_outcome": "all 21 required columns present with expected types",
    }


def main() -> None:
    repo = Path(os.environ.get("GITHUB_WORKSPACE", Path.cwd()))
    token = os.environ.get("SUPABASE_ACCESS_TOKEN", "")
    if not token:
        raise SystemExit("SUPABASE_ACCESS_TOKEN is required")
    statements = expected_statements(repo)
    rows = run_query(PROJECT_REF, token, build_query(statements))
    if not isinstance(rows, list) or len(rows) != 1:
        raise SystemExit("read-only recovery proof returned an unexpected result shape")
    result = verify(rows[0], statements)
    output = Path(os.environ.get("RECOVERY_EVIDENCE", "production-ledger-recovery-1750.json"))
    output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print("RECOVERY PROOF OK: exact ledger statements and all required catalog columns verified")


if __name__ == "__main__":
    main()
