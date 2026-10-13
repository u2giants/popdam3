#!/usr/bin/env python3
"""Run a synthetic write/readback/rollback against the isolated settled55_test DB."""

from __future__ import annotations

import importlib.util
import json
import tempfile
from pathlib import Path
import subprocess
import sys

from psycopg import sql


ROOT = Path(__file__).resolve().parents[1]
CONTAINER = "codex-po-no-reuse-01a12aec"
DATABASE = "settled55_test"


def load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError("local test module is unavailable")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def psql(program: str) -> str:
    result = subprocess.run(
        ["docker", "exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", DATABASE,
         "-v", "ON_ERROR_STOP=1", "-At"],
        input=program, text=True, capture_output=True, check=False,
    )
    if result.returncode:
        raise RuntimeError("isolated PostgreSQL fixture failed: " + result.stderr[-1200:])
    return result.stdout


def main() -> None:
    executor = load("exception_executor_pg_test", ROOT / "scripts/orderlist-settled-exception-executor.py")
    fixture = load("exception_writer_fixture_pg_test", ROOT / "scripts/test-orderlist-source-disposition-writer.py")
    initial_counts = json.loads(psql(
        "select json_build_object('database',current_database(),'headers',(select count(*) from plm.production_order),"
        "'lines',(select count(*) from plm.production_order_line))::text;"
    ))
    if initial_counts != {"database": DATABASE, "headers": 0, "lines": 0}:
        raise RuntimeError("isolated PostgreSQL fixture is not empty or has the wrong database identity")

    document, source_hashes = fixture.synthetic_plan()
    raw_plan = json.dumps(document, separators=(",", ":")).encode()
    scoped = executor.PREFLIGHT.prepare_exception_scope(
        document, plan_sha256=executor.sha256_bytes(raw_plan), expected_source_hashes=source_hashes,
    )
    for order in scoped["orders"]:
        order["metadata"].update(
            customer_name="Synthetic customer", order_vendor_name="Synthetic vendor",
            ordering_company="Synthetic company",
        )
    for line in scoped["lines"]:
        line["payload"].update(
            quantity_ordered="600.0", order_depth_inches="4.50", case_pack="12", cases_reported="50",
        )
        line["metadata"]["raw_evidence"] = {"numeric_text": "0007", "quantity_text": "600.0"}

    catalog = {
        "schema": executor.CATALOG_SNAPSHOT_SCHEMA, "target": executor.TARGET,
        "requested_pairs": [], "rows": [], "po_reuse_guard_state": {"status": "absent", "objects": {}},
    }
    timestamp = "2026-01-01T00:00:00+00:00"
    seed_header_ids = {
        row["source_id"]: executor.deterministic_uuid("production_order", row["source_id"])
        for row in scoped["orders"][:36]
    }
    seed_lines = [row for index, row in enumerate(scoped["lines"]) if index % 76 < 36][:43]
    if len(seed_header_ids) != 36 or len(seed_lines) != 43 or any(row["order_source_id"] not in seed_header_ids for row in seed_lines):
        raise RuntimeError("synthetic seed shape is invalid")
    preimages = {
        "schema": "orderlist-exception-source-preimages-v1", "target": executor.TARGET,
        "orders": [
            {"id": seed_header_ids[row["source_id"]], "production_order_number": row["payload"]["production_order_number"],
             "status": row["payload"].get("status"), "created_at": timestamp, "updated_at": timestamp}
            for row in scoped["orders"][:36]
        ],
        "order_refs": [
            {"id": executor.deterministic_uuid("production_order_source_ref", row["source_id"]),
             "production_order_id": seed_header_ids[row["source_id"]], "source_system": executor.SOURCE_SYSTEM,
             "source_id": row["source_id"], "is_primary": True, "metadata": {},
             "created_at": timestamp, "updated_at": timestamp}
            for row in scoped["orders"][:36]
        ],
        "lines": [
            {"id": executor.deterministic_uuid("production_order_line", row["source_id"]),
             "production_order_id": seed_header_ids[row["order_source_id"]], "sku": row["payload"].get("sku"),
             "quantity_ordered": row["payload"].get("quantity_ordered"), "item_id": None, "status": None,
             "master_data_match_status": None, "metadata": row["metadata"], "line_number": "0007",
             "created_at": timestamp, "updated_at": timestamp}
            for row in seed_lines
        ],
        "line_refs": [
            {"id": executor.deterministic_uuid("production_order_line_source_ref", row["source_id"]),
             "production_order_line_id": executor.deterministic_uuid("production_order_line", row["source_id"]),
             "source_system": executor.SOURCE_SYSTEM, "source_id": row["source_id"], "is_primary": True,
             "metadata": {}, "created_at": timestamp, "updated_at": timestamp}
            for row in seed_lines
        ],
        "line_refs_by_uuid": [
            {"id": executor.deterministic_uuid("production_order_line_source_ref", row["source_id"]),
             "production_order_line_id": executor.deterministic_uuid("production_order_line", row["source_id"]),
             "source_system": executor.SOURCE_SYSTEM, "source_id": row["source_id"], "is_primary": True,
             "metadata": {}, "created_at": timestamp, "updated_at": timestamp}
            for row in seed_lines
        ],
        "tracking": [], "snapshots": [], "po_collision_candidate_ids": [],
    }
    mapping = executor.PREFLIGHT.validate_source_ref_mappings(scoped, preimages)
    review = {
        "input_plan_sha256": "3" * 64,
        "_exact_review_plan_sha256": "4" * 64,
        "_exact_preimages_file_sha256": "5" * 64,
        "preimages_sha256": executor.PREFLIGHT.digest(preimages),
        "mapping": {k: v for k, v in mapping.items() if k not in {"resolved_header_uuids", "resolved_line_uuids"}},
        "desired_orders": scoped["orders"], "desired_lines": scoped["lines"], "source_hashes": source_hashes,
    }
    postimage = executor.construct_postimage(review, preimages, scoped, catalog)
    inserts = (
        sum(row["action"] == "insert" for row in postimage["orders"]),
        sum(row["action"] == "insert" for row in postimage["lines"]),
    )
    if inserts != (40, 253):
        raise RuntimeError("frozen synthetic insert counts differ")

    # Exercise the same private JSON freeze/reload boundary used by capture/apply.
    with tempfile.TemporaryDirectory() as temp_dir:
        frozen_path = Path(temp_dir) / "exception-postimage.json"
        executor.PREFLIGHT.private_write(frozen_path, postimage)
        frozen_postimage = json.loads(frozen_path.read_text(encoding="utf-8"))
    recomputed = executor.construct_postimage(review, preimages, scoped, catalog)
    if executor.digest(frozen_postimage) != executor.digest(recomputed):
        raise RuntimeError("private JSON freeze/reload changed the recomputed postimage digest")
    if frozen_postimage["lines"][0]["assert_fields"].get("quantity_ordered") != "600.0":
        raise RuntimeError("known numeric fields were not frozen as stable JSON strings")
    if frozen_postimage["lines"][0]["assert_fields"]["metadata"]["raw_evidence"]["numeric_text"] != "0007":
        raise RuntimeError("raw metadata strings were coerced by schema numeric freezing")
    postimage = frozen_postimage

    class Collector:
        def __init__(self):
            self.commands: list[str] = []

        def execute(self, query: str, params=None):
            if params:
                pieces = query.split("%s")
                if len(pieces) != len(params) + 1:
                    raise RuntimeError("synthetic SQL parameter binding mismatch")
                query = "".join(part + sql.Literal(value).as_string() for part, value in zip(pieces, params)) + pieces[-1]
            self.commands.append(query + ";")

    seed_orders = [row for row in postimage["orders"] if row["source_id"] in seed_header_ids]
    seed_line_ids = {executor.deterministic_uuid("production_order_line", row["source_id"]) for row in seed_lines}
    seed_canonical_lines = [row for row in postimage["lines"] if row["id"] in seed_line_ids]
    seed = {
        "orders": [dict(row, action="insert", write_values=row["assert_fields"]) for row in seed_orders],
        "lines": [dict(row, action="insert", write_values=row["assert_fields"]) for row in seed_canonical_lines],
        "order_source_refs_insert": [row for row in postimage["order_source_ref_assertions"].values()
                                     if row["source_id"] in seed_header_ids],
        "line_source_refs_insert": [row for row in postimage["line_source_ref_assertions"].values()
                                    if row["source_id"] in {line["source_id"] for line in seed_lines}],
    }
    collector = Collector()
    gateway = executor.PostgresExecutorGateway(collector, {"local_test": True}, scoped)
    gateway.apply(seed)
    seed_sql = list(collector.commands)
    collector.commands.clear()
    gateway.apply(postimage)
    write_sql = list(collector.commands)

    timestamps = []
    for table, rows in (
        ("plm.production_order", seed_orders), ("plm.production_order_line", seed_canonical_lines),
        ("plm.production_order_source_ref", preimages["order_refs"]),
        ("plm.production_order_line_source_ref", preimages["line_refs"]),
    ):
        ids = [row["id"] for row in rows]
        timestamps.append(
            f"update {table} set created_at='2026-01-01T00:00:00Z', updated_at='2026-01-01T00:00:00Z' "
            f"where id=any(array[{','.join(sql.Literal(value).as_string() for value in ids)}]::uuid[]);"
        )
    timestamps.append(
        "update plm.production_order_line set line_number='0007' where id=any(array["
        + ",".join(sql.Literal(row["id"]).as_string() for row in seed_canonical_lines) + "]::uuid[]);"
    )
    readback_fields = []
    readback_fields.extend((sql.Literal("transaction_timestamp").as_string(), "to_jsonb(transaction_timestamp())"))
    for key, table in (
        ("orders", "plm.production_order"), ("lines", "plm.production_order_line"),
        ("order_refs", "plm.production_order_source_ref"), ("line_refs", "plm.production_order_line_source_ref"),
        ("tracking", "dam.order_tracking_ext"), ("snapshots", "dam.production_order_snapshot"),
    ):
        readback_fields.extend((sql.Literal(key).as_string(), f"(select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from {table} t)"))
    timestamp_trigger_fixture = [
        "create or replace function app.set_updated_at() returns trigger language plpgsql as $$ "
        "begin new.updated_at = now(); return new; end; $$;",
        "drop trigger if exists settled55_test_updated_at on plm.production_order;",
        "create trigger settled55_test_updated_at before update on plm.production_order "
        "for each row execute function app.set_updated_at();",
        "drop trigger if exists settled55_test_updated_at on plm.production_order_line;",
        "create trigger settled55_test_updated_at before update on plm.production_order_line "
        "for each row execute function app.set_updated_at();",
    ]
    updated_header_count = sum(row["action"] == "update" for row in postimage["orders"] if row["id"] in seed_header_ids.values())
    updated_line_count = sum(row["action"] == "update" for row in postimage["lines"] if row["id"] in seed_line_ids)
    if (updated_header_count, updated_line_count) != (36, 43):
        raise RuntimeError("synthetic fixture does not exercise every seeded update trigger")
    program = "begin;\n" + "\n".join(timestamp_trigger_fixture + seed_sql + timestamps + write_sql)
    program += "\nselect jsonb_build_object(" + ",".join(readback_fields) + ");\nrollback;\n"
    result = json.loads(psql(program).splitlines()[-2])
    try:
        executor.validate_readback(postimage, result)
    except executor.ExecutorError:
        for kind in ("orders", "lines"):
            actual_rows = {str(row.get("id")): row for row in result[kind]}
            for expected in postimage[kind]:
                actual_row = actual_rows.get(str(expected["id"]), {})
                for field, value in expected["assert_fields"].items():
                    if executor._comparable_field(field, actual_row.get(field)) != executor._comparable_field(field, value):
                        print("SYNTHETIC_READBACK_MISMATCH", kind, field)
        raise
    if any(row["metadata"].get("customer_name") != "Synthetic customer" for row in result["orders"]):
        raise RuntimeError("header outer metadata did not survive PostgreSQL readback")
    if any(row["metadata"].get("raw_evidence", {}).get("numeric_text") != "0007" for row in result["lines"]):
        raise RuntimeError("line outer metadata did not survive PostgreSQL readback")
    seeded_line_ids = {row["id"] for row in seed_canonical_lines}
    if any(row.get("line_number") != "0007" for row in result["lines"] if row["id"] in seeded_line_ids):
        raise RuntimeError("TEXT line number was not preserved")
    after = json.loads(psql(
        "select json_build_object('headers',(select count(*) from plm.production_order),"
        "'lines',(select count(*) from plm.production_order_line))::text;"
    ))
    if after != {"headers": 0, "lines": 0}:
        raise RuntimeError("rollback left synthetic canonical rows behind")
    print(json.dumps({
        "result": "PASS", "database": DATABASE, "headers_read_back": len(result["orders"]),
        "lines_read_back": len(result["lines"]), "existing_headers": 36, "existing_lines": 43,
        "new_headers": inserts[0], "new_lines": inserts[1], "metadata": "preserved",
        "private_freeze_reload_digest": "passed", "numeric_readback": "passed",
        "line_number_text": "preserved", "updated_at_trigger": "transaction timestamp verified",
        "rollback": "empty fixture",
    }))


if __name__ == "__main__":
    main()
