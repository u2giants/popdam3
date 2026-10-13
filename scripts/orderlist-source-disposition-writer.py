#!/usr/bin/env python3
"""Read-only preflight for the reviewed #277 OrderList exception plan.

The input is the exact protected output of the pure source-disposition planner.
This command captures scoped production preimages by stable source IDs. Production
apply is deliberately unavailable until the coordinator supplies the reviewed,
finite historical-PO UUID admission manifest and an apply implementation.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import stat
import sys
from typing import Any, Mapping, Sequence


ROOT = Path(__file__).resolve().parents[1]
TARGET = "qsllyeztdwjgirsysgai"
TARGET_HOST = "aws-1-us-east-1.pooler.supabase.com"
TARGET_PORT = 5432
TARGET_DATABASE = "postgres"
TARGET_USER = f"postgres.{TARGET}"
SOURCE_SYSTEM = "google_order_list"
READ_ONLY_MODE = "read-only preflight"
PLAN_ARTIFACT = "protected_issue277_source_disposition_plan_preview"
EXPECTED_COUNTS = {
    "input_cases": 75,
    "input_rows": 150,
    "held_parent_only_rows": 20,
    "held_parent_only_lines": 20,
    "held_only_headers": 8,
    "desired_headers": 76,
    "desired_lines": 296,
    "skipped_rows": 7,
}
SOURCE_HASH_KEYS = {
    "source_answer_resolution_packet_sha256",
    "returned_workbook_sha256",
    "latest_google_capture_sha256",
}
MAX_HEADERS_TO_SCAN = 10_000


class PreflightError(ValueError):
    """Input plan or current preimage does not meet its exact contract."""


class ApplyBlocked(RuntimeError):
    """Production apply is held until the coordinator-reviewed admission exists."""


SPEC = importlib.util.spec_from_file_location(
    "orderlist_source_importer",
    ROOT / "shared-db" / "scripts" / "import-order-list-xlsx.py",
)
if SPEC is None or SPEC.loader is None:  # pragma: no cover
    raise RuntimeError("canonical OrderList importer could not be loaded")
IMPORTER = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = IMPORTER
SPEC.loader.exec_module(IMPORTER)


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def digest(value: Any) -> str:
    encoded = json.dumps(
        value, sort_keys=True, ensure_ascii=False, separators=(",", ":"), default=str
    ).encode("utf-8")
    return sha256(encoded)


def _json_read(path: Path) -> tuple[dict[str, Any], bytes]:
    raw = path.read_bytes()
    try:
        value = json.loads(raw)
    except (json.JSONDecodeError, UnicodeDecodeError) as error:
        raise PreflightError(f"invalid JSON input: {path.name}") from error
    if not isinstance(value, dict):
        raise PreflightError(f"input must be a JSON object: {path.name}")
    return value, raw


def _require_hash(value: Any, label: str) -> str:
    if not isinstance(value, str) or len(value) != 64 or any(c not in "0123456789abcdef" for c in value):
        raise PreflightError(f"{label} must be a lowercase SHA-256 value")
    return value


def verify_exact_plan_bytes(raw: bytes, expected_sha256: str) -> str:
    expected = _require_hash(expected_sha256, "expected_plan_sha256")
    actual = sha256(raw)
    if actual != expected:
        raise PreflightError("exact source-disposition plan SHA-256 mismatch")
    return actual


def prepare_exception_scope(
    plan_document: Mapping[str, Any],
    *,
    plan_sha256: str,
    expected_source_hashes: Mapping[str, str],
) -> dict[str, Any]:
    """Validate and filter the exact 75-case planner output to the 55 settled cases."""
    if plan_document.get("artifact_type") != PLAN_ARTIFACT:
        raise PreflightError("unexpected source-disposition plan artifact")
    if set(expected_source_hashes) != SOURCE_HASH_KEYS:
        raise PreflightError("all three exact answer/source hashes are required")
    source_hashes = plan_document.get("source_hashes")
    if not isinstance(source_hashes, dict) or set(source_hashes) != SOURCE_HASH_KEYS:
        raise PreflightError("source hash set in planner output is incomplete")
    for key in SOURCE_HASH_KEYS:
        expected = _require_hash(expected_source_hashes.get(key), key)
        actual = _require_hash(source_hashes.get(key), key)
        if actual != expected:
            raise PreflightError(f"planner source hash mismatch: {key}")
    plan_sha256 = _require_hash(plan_sha256, "plan_sha256")
    provenance = plan_document.get("provenance")
    counts = plan_document.get("source_disposition_counts")
    if not isinstance(provenance, dict) or not isinstance(counts, dict):
        raise PreflightError("planner provenance or counts are missing")
    expected_importer_sha = _require_hash(
        provenance.get("canonical_importer_sha256"), "canonical_importer_sha256"
    )
    actual_importer_sha = sha256((ROOT / "shared-db" / "scripts" / "import-order-list-xlsx.py").read_bytes())
    if actual_importer_sha != expected_importer_sha:
        raise PreflightError("canonical OrderList importer SHA-256 differs from the planner-bound version")
    if provenance.get("approved_case_count") != EXPECTED_COUNTS["input_cases"]:
        raise PreflightError("planner output does not bind exactly 75 answer cases")
    if provenance.get("source_rows_bound") != EXPECTED_COUNTS["input_rows"]:
        raise PreflightError("planner output does not bind exactly 150 source rows")
    if counts.get("answer_cases") != EXPECTED_COUNTS["input_cases"] or counts.get("source_rows_bound") != EXPECTED_COUNTS["input_rows"]:
        raise PreflightError("planner source-disposition counts do not match the reviewed scope")
    if plan_document.get("capture_source_sha256") != source_hashes["latest_google_capture_sha256"]:
        raise PreflightError("Google capture digest differs from the bound answer/source hash")

    orders = plan_document.get("orders")
    lines = plan_document.get("lines")
    skips = plan_document.get("skipped_rows")
    rejected = plan_document.get("rejected_rows")
    unresolved = plan_document.get("unresolved_fields")
    if not all(isinstance(x, list) for x in (orders, lines, skips, rejected, unresolved)):
        raise PreflightError("planner order, line, or ledger lists are missing")
    if counts.get("desired_headers") != 84 or len(orders) != 84:
        raise PreflightError("planner does not contain the reviewed 84-header source plan")
    if counts.get("desired_lines") != 316 or len(lines) != 316:
        raise PreflightError("planner does not contain the reviewed 316-line source plan")
    if rejected or counts.get("rejected_rows") != 0:
        raise PreflightError("planner contains rejected rows")
    if len(skips) != EXPECTED_COUNTS["skipped_rows"] or counts.get("source_rows_skipped") != EXPECTED_COUNTS["skipped_rows"]:
        raise PreflightError("planner skip ledger differs from the seven approved source rows")

    held_rows: set[int] = set()
    held_lines: list[dict[str, Any]] = []
    desired_lines: list[dict[str, Any]] = []
    for line in lines:
        if not isinstance(line, dict):
            raise PreflightError("planner line entry is malformed")
        metadata = line.get("metadata")
        disposition = metadata.get("source_disposition") if isinstance(metadata, dict) else None
        if not isinstance(disposition, dict):
            raise PreflightError("planned line has no source-disposition provenance")
        row = line.get("sheet_row")
        if not isinstance(row, int):
            raise PreflightError("planned line lacks its physical source row")
        if disposition.get("parent_only_assortment") is True:
            held_rows.add(row)
            held_lines.append(line)
        else:
            desired_lines.append(line)
    if len(held_rows) != EXPECTED_COUNTS["held_parent_only_rows"] or len(held_lines) != EXPECTED_COUNTS["held_parent_only_lines"]:
        raise PreflightError("exactly 20 parent-only identity-held rows/lines are required")

    allowed_unresolved_rows = {
        int(item["source_row"])
        for item in unresolved
        if isinstance(item, dict)
        and item.get("status") == "identity_requires_existingColdmatch_disposition"
        and isinstance(item.get("source_row"), int)
        and item.get("write_eligible") is False
    }
    if allowed_unresolved_rows != held_rows or len(unresolved) != len(held_rows):
        raise PreflightError("unresolved ledger contains a business hold outside the 20 parent-only rows")

    all_orders: dict[str, dict[str, Any]] = {}
    for order in orders:
        if not isinstance(order, dict) or not isinstance(order.get("source_id"), str):
            raise PreflightError("planned header is malformed")
        sid = order["source_id"]
        if sid in all_orders:
            raise PreflightError("planner has duplicate internal header source IDs")
        if order.get("quarantined") is True:
            raise PreflightError("planner contains a quarantined header")
        all_orders[sid] = order

    lines_by_header: dict[str, list[dict[str, Any]]] = {}
    seen_line_sids: set[str] = set()
    for line in desired_lines:
        sid = line.get("source_id")
        header_sid = line.get("order_source_id")
        if not isinstance(sid, str) or sid in seen_line_sids:
            raise PreflightError("desired line source IDs are blank or duplicated")
        if not isinstance(header_sid, str) or header_sid not in all_orders:
            raise PreflightError("desired line has no unique planned parent header")
        seen_line_sids.add(sid)
        lines_by_header.setdefault(header_sid, []).append(line)
    if len(desired_lines) != EXPECTED_COUNTS["desired_lines"]:
        raise PreflightError("exception-only line count must be 296")
    desired_orders = [all_orders[sid] for sid in lines_by_header]
    held_only_headers = [
        order for order in orders
        if order.get("sheet_rows") and set(order["sheet_rows"]).issubset(held_rows)
    ]
    if len(held_only_headers) != EXPECTED_COUNTS["held_only_headers"]:
        raise PreflightError("exactly eight headers must contain held parent-only rows only")
    if len(desired_orders) != EXPECTED_COUNTS["desired_headers"]:
        raise PreflightError("exception-only header count must be 76")
    if len(skips) != EXPECTED_COUNTS["skipped_rows"]:
        raise PreflightError("exception-only skip count must be seven")

    by_po: dict[str, list[dict[str, Any]]] = {}
    for order in desired_orders:
        po = IMPORTER.normalize_po_number(order.get("payload", {}).get("production_order_number"))
        if po:
            by_po.setdefault(po, []).append(order)
    for po, group in by_po.items():
        if len(group) < 2:
            continue
        for order in group:
            disposition = order.get("metadata", {}).get("source_disposition", {})
            source_rows = disposition.get("source_row_evidence", [])
            if (
                disposition.get("desired_internal_header_source_id") != order.get("source_id")
                or disposition.get("google_company_I_ignored_for_approved_conflicts") is not True
                or not source_rows
                or any(not str(row.get("case_id", "")).startswith("Conflicting orders:") for row in source_rows)
            ):
                raise PreflightError("duplicate production PO is not bound to an approved row-level conflict split")

    line_source_id_aliases: dict[str, list[str]] = {}
    desired_by_row: dict[int, list[dict[str, Any]]] = {}
    for line in desired_lines:
        desired_by_row.setdefault(line["sheet_row"], []).append(line)
    for row, row_lines in desired_by_row.items():
        candidates = {IMPORTER.line_source_id(row)}
        ordinals = [line.get("ordinal") for line in row_lines if isinstance(line.get("ordinal"), int)]
        raw_snapshot = row_lines[0].get("metadata", {}).get("source_disposition", {}).get("source_row_snapshot_exact", {})
        aligned_source_skus = IMPORTER.split_aligned(raw_snapshot.get("AR")) if isinstance(raw_snapshot, dict) else []
        max_ordinal = max([len(aligned_source_skus), *ordinals, 1])
        candidates.update(IMPORTER.component_source_id(row, ordinal) for ordinal in range(1, max_ordinal + 1))
        candidates.update(line["source_id"] for line in row_lines)
        line_source_id_aliases[str(row)] = sorted(candidates)

    return {
        "schema": "orderlist-exception-only-plan-v1",
        "target": TARGET,
        "source_system": SOURCE_SYSTEM,
        "input_plan_sha256": plan_sha256,
        "source_hashes": dict(source_hashes),
        "expected_counts": dict(EXPECTED_COUNTS),
        "orders": desired_orders,
        "lines": desired_lines,
        "line_source_id_aliases": line_source_id_aliases,
        "skipped_rows": skips,
        "held_parent_only_rows": sorted(held_rows),
        "held_parent_only_headers": sorted(order["source_id"] for order in held_only_headers),
        "unresolved_fields": [],
        "historical_po_admission_required": True,
        "apply_enabled": False,
    }


def _groups_by(rows: Sequence[Mapping[str, Any]], key: str) -> dict[str, list[Mapping[str, Any]]]:
    result: dict[str, list[Mapping[str, Any]]] = {}
    for row in rows:
        value = row.get(key)
        if not isinstance(value, str):
            raise PreflightError(f"preimage row lacks {key}")
        result.setdefault(value, []).append(row)
    return result


def validate_source_ref_mappings(
    scoped_plan: Mapping[str, Any], preimages: Mapping[str, Any]
) -> dict[str, Any]:
    """Refuse duplicate refs, missing targets, and desired-header collapse."""
    order_ids = {row["source_id"] for row in scoped_plan["orders"]}
    line_ids = {row["source_id"] for row in scoped_plan["lines"]}
    all_line_aliases = {
        sid for values in scoped_plan.get("line_source_id_aliases", {}).values() for sid in values
    }
    order_refs = preimages.get("order_refs", [])
    line_refs = preimages.get("line_refs", [])
    line_refs_by_uuid = preimages.get("line_refs_by_uuid", [])
    orders = preimages.get("orders", [])
    lines = preimages.get("lines", [])
    if not all(isinstance(value, list) for value in (order_refs, line_refs, line_refs_by_uuid, orders, lines)):
        raise PreflightError("current parent/line source-reference preimages are incomplete")
    order_by_id = {row.get("id"): row for row in orders if isinstance(row, dict)}
    line_by_id = {row.get("id"): row for row in lines if isinstance(row, dict)}
    if len(order_by_id) != len(orders) or len(line_by_id) != len(lines):
        raise PreflightError("current parent or line UUID preimages are duplicated")

    def exact_google_map(rows: Sequence[Mapping[str, Any]], wanted: set[str], label: str) -> dict[str, Mapping[str, Any]]:
        result: dict[str, Mapping[str, Any]] = {}
        for ref in rows:
            if ref.get("source_system") != SOURCE_SYSTEM or ref.get("source_id") not in wanted:
                continue
            sid = ref["source_id"]
            if sid in result:
                raise PreflightError(f"duplicate current {label} references for a desired source ID")
            result[sid] = ref
        return result

    order_ref_by_sid = exact_google_map(order_refs, order_ids, "header")
    line_ref_by_sid = exact_google_map(line_refs, line_ids, "line")
    desired_order_aliases = {
        order.get("metadata", {}).get("source_disposition", {}).get("original_normalized_header_source_id")
        for order in scoped_plan["orders"]
        if order.get("source_id") != order.get("metadata", {}).get("source_disposition", {}).get("original_normalized_header_source_id")
    }
    if any(
        ref.get("source_system") == SOURCE_SYSTEM and ref.get("source_id") in desired_order_aliases
        for ref in order_refs
    ):
        raise PreflightError("a legacy unsplit Google header reference exists for an approved split PO")
    if any(
        ref.get("source_system") != SOURCE_SYSTEM and ref.get("source_id") in order_ids
        for ref in order_refs
    ):
        raise PreflightError("a desired header source ID is owned by another source system")
    if any(
        ref.get("source_system") != SOURCE_SYSTEM and ref.get("source_id") in all_line_aliases
        for ref in line_refs
    ):
        raise PreflightError("a desired or legacy line source ID is owned by another source system")
    desired_line_by_row: dict[int, set[str]] = {}
    for line in scoped_plan["lines"]:
        desired_line_by_row.setdefault(line["sheet_row"], set()).add(line["source_id"])
    for row_string, aliases in scoped_plan.get("line_source_id_aliases", {}).items():
        row = int(row_string)
        allowed = desired_line_by_row.get(row, set())
        if any(
            ref.get("source_system") == SOURCE_SYSTEM
            and ref.get("source_id") in set(aliases) - allowed
            for ref in line_refs
        ):
            raise PreflightError("a legacy line source reference exists for a different row shape")
    order_uuid_by_sid: dict[str, str] = {}
    for sid, ref in order_ref_by_sid.items():
        order_uuid = ref.get("production_order_id")
        if order_uuid not in order_by_id:
            raise PreflightError("a desired header reference points to a missing canonical header")
        desired_order = next(order for order in scoped_plan["orders"] if order["source_id"] == sid)
        current_po = IMPORTER.normalize_po_number(order_by_id[order_uuid].get("production_order_number"))
        desired_po = IMPORTER.normalize_po_number(desired_order.get("payload", {}).get("production_order_number"))
        if current_po != desired_po:
            raise PreflightError("existing header source ID now identifies a different production PO")
        order_uuid_by_sid[sid] = order_uuid
    if len(set(order_uuid_by_sid.values())) != len(order_uuid_by_sid):
        raise PreflightError("distinct desired header source IDs collapse onto one current UUID")

    line_uuid_by_sid: dict[str, str] = {}
    for sid, ref in line_ref_by_sid.items():
        line_uuid = ref.get("production_order_line_id")
        if line_uuid not in line_by_id:
            raise PreflightError("a desired line reference points to a missing canonical line")
        line_uuid_by_sid[sid] = line_uuid
    if len(set(line_uuid_by_sid.values())) != len(line_uuid_by_sid):
        raise PreflightError("distinct desired line source IDs collapse onto one current UUID")
    refs_by_line_uuid: dict[str, list[Mapping[str, Any]]] = {}
    for ref in line_refs_by_uuid:
        line_uuid = ref.get("production_order_line_id")
        if isinstance(line_uuid, str):
            refs_by_line_uuid.setdefault(line_uuid, []).append(ref)

    for line in scoped_plan["lines"]:
        sid = line["source_id"]
        header_sid = line["order_source_id"]
        line_uuid = line_uuid_by_sid.get(sid)
        header_uuid = order_uuid_by_sid.get(header_sid)
        if line_uuid and not header_uuid:
            raise PreflightError("existing line reference has no existing bound parent header")
        if line_uuid:
            current = line_by_id[line_uuid]
            current_sku = IMPORTER.normalize_sku(current.get("sku"))
            desired_sku = IMPORTER.normalize_sku(line.get("payload", {}).get("sku"))
            if current_sku != desired_sku:
                raise PreflightError("existing line source ID now identifies a different SKU")
            if current.get("production_order_id") != header_uuid:
                raise PreflightError("existing line source ID belongs to a different parent UUID")
            uuid_refs = refs_by_line_uuid.get(line_uuid, [])
            if len(uuid_refs) != 1 or uuid_refs[0].get("source_system") != SOURCE_SYSTEM or uuid_refs[0].get("source_id") != sid:
                raise PreflightError("existing line UUID has a second source owner; exception apply requires coordinator disposition")

    return {
        "existing_header_ref_count": len(order_ref_by_sid),
        "existing_line_ref_count": len(line_ref_by_sid),
        "cross_source_owned_lines": 0,
        "headers_missing_refs": len(order_ids) - len(order_ref_by_sid),
        "lines_missing_refs": len(line_ids) - len(line_ref_by_sid),
        "resolved_header_uuids": order_uuid_by_sid,
        "resolved_line_uuids": line_uuid_by_sid,
        "status": "unambiguous_exact_source_references",
    }


def assert_preimage_unchanged(saved: Mapping[str, Any], current: Mapping[str, Any]) -> None:
    if digest(saved) != digest(current):
        raise PreflightError("current parent, line, or source-reference preimage changed")


def preserved_existing_line(
    desired: Mapping[str, Any], current: Mapping[str, Any]
) -> dict[str, Any]:
    """Return a preview merge preserving UUID, parent, accounting, links and history."""
    merged = dict(desired)
    protected = (
        "id", "production_order_id", "source_system", "source_id", "line_number",
        "quantity_ordered", "quantity_shipped", "unit_cost", "status", "item_id",
        "master_data_match_status", "created_at", "updated_at",
    )
    for key in protected:
        if key in current:
            merged[key] = current[key]
    current_metadata = current.get("metadata")
    desired_metadata = desired.get("metadata")
    if isinstance(current_metadata, dict) and isinstance(desired_metadata, dict):
        merged["metadata"] = {**current_metadata, **desired_metadata}
    return merged


def preserved_existing_order(
    desired: Mapping[str, Any], current: Mapping[str, Any]
) -> dict[str, Any]:
    """Preview merge preserving existing parent UUID, manual links and metadata."""
    merged = dict(desired)
    for key in ("id", "created_at", "updated_at", "company_id", "factory_id"):
        if key in current:
            merged[key] = current[key]
    current_metadata = current.get("metadata")
    desired_metadata = desired.get("metadata")
    if isinstance(current_metadata, dict) and isinstance(desired_metadata, dict):
        merged["metadata"] = {**current_metadata, **desired_metadata}
    return merged


def _bounded_rows(conn: Any, query: str, params: Sequence[Any], *, limit: int) -> list[dict[str, Any]]:
    rows = [row[0] for row in conn.execute(query, params).fetchall()]
    if len(rows) > limit:
        raise PreflightError("scoped preimage exceeded its bounded row limit")
    return rows


def capture_preimages(conn: Any, scoped_plan: Mapping[str, Any]) -> dict[str, Any]:
    """Read exact refs/rows for the desired IDs and normalized PO collision set."""
    order_sids = sorted({row["source_id"] for row in scoped_plan["orders"]})
    line_sids = sorted({
        sid for values in scoped_plan["line_source_id_aliases"].values() for sid in values
    })
    po_numbers = {
        IMPORTER.normalize_po_number(row.get("payload", {}).get("production_order_number"))
        for row in scoped_plan["orders"]
    }
    po_numbers.discard(None)
    aliases = {
        row.get("metadata", {}).get("source_disposition", {}).get("original_normalized_header_source_id")
        for row in scoped_plan["orders"]
    }
    aliases.discard(None)
    all_order_source_ids = sorted(set(order_sids) | aliases)

    # The bounded identity scan applies the canonical importer's trim + case-fold
    # rule in Python, avoiding a second SQL normalization definition.
    order_identity = conn.execute(
        "select id, production_order_number from plm.production_order order by id limit %s",
        (MAX_HEADERS_TO_SCAN + 1,),
    ).fetchall()
    if len(order_identity) > MAX_HEADERS_TO_SCAN:
        raise PreflightError("production header identity scan exceeded 10,000 rows")
    po_collision_ids = sorted({
        str(order_id) for order_id, raw_po in order_identity
        if IMPORTER.normalize_po_number(raw_po) in po_numbers
    })
    order_refs = _bounded_rows(
        conn,
        "select to_jsonb(t) from plm.production_order_source_ref t "
        "where source_id = any(%s) or production_order_id = any(%s) order by id",
        (all_order_source_ids, po_collision_ids),
        limit=MAX_HEADERS_TO_SCAN,
    )
    order_ref_ids = sorted({str(row["production_order_id"]) for row in order_refs})
    order_ids = sorted(set(po_collision_ids) | set(order_ref_ids))
    orders = _bounded_rows(
        conn,
        "select to_jsonb(t) from plm.production_order t where id = any(%s) order by id",
        (order_ids,),
        limit=MAX_HEADERS_TO_SCAN,
    )
    line_refs = _bounded_rows(
        conn,
        "select to_jsonb(t) from plm.production_order_line_source_ref t "
        "where source_id = any(%s) order by id",
        (line_sids,),
        limit=MAX_HEADERS_TO_SCAN,
    )
    line_ref_ids = sorted({str(row["production_order_line_id"]) for row in line_refs})
    lines = _bounded_rows(
        conn,
        "select to_jsonb(t) from plm.production_order_line t where id = any(%s) order by id",
        (line_ref_ids,),
        limit=MAX_HEADERS_TO_SCAN,
    )
    line_refs_by_uuid = _bounded_rows(
        conn,
        "select to_jsonb(t) from plm.production_order_line_source_ref t "
        "where production_order_line_id = any(%s) order by id",
        (line_ref_ids,),
        limit=MAX_HEADERS_TO_SCAN,
    )
    tracking = _bounded_rows(
        conn,
        "select to_jsonb(t) from dam.order_tracking_ext t where order_id = any(%s) order by order_id",
        (order_ids,),
        limit=MAX_HEADERS_TO_SCAN,
    )
    snapshots = _bounded_rows(
        conn,
        "select to_jsonb(t) from dam.production_order_snapshot t "
        "where production_order_line_id = any(%s) order by id",
        (line_ref_ids,),
        limit=MAX_HEADERS_TO_SCAN,
    )
    return {
        "schema": "orderlist-exception-source-preimages-v1",
        "target": TARGET,
        "order_refs": order_refs,
        "orders": orders,
        "line_refs": line_refs,
        "lines": lines,
        "line_refs_by_uuid": line_refs_by_uuid,
        "tracking": tracking,
        "snapshots": snapshots,
        "po_collision_candidate_ids": po_collision_ids,
    }


def private_write(path: Path, value: Any) -> None:
    directory_fd = open_private_directory(path.parent)
    payload = (json.dumps(value, sort_keys=True, ensure_ascii=False, indent=2, default=str) + "\n").encode()
    nofollow = getattr(os, "O_NOFOLLOW", None)
    if nofollow is None:
        os.close(directory_fd)
        raise PreflightError("filesystem does not support no-follow private file creation")
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | nofollow
    fd = -1
    created = False
    try:
        fd = os.open(path.name, flags, 0o600, dir_fd=directory_fd)
        created = True
        file_stat = os.fstat(fd)
        if not stat.S_ISREG(file_stat.st_mode) or file_stat.st_uid != os.geteuid() or stat.S_IMODE(file_stat.st_mode) != 0o600:
            raise PreflightError("unsafe private output file")
        with os.fdopen(fd, "wb") as handle:
            fd = -1
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.fsync(directory_fd)
    except Exception:
        if fd >= 0:
            os.close(fd)
        if created:
            try:
                os.unlink(path.name, dir_fd=directory_fd)
            except FileNotFoundError:
                pass
        raise
    finally:
        os.close(directory_fd)


def open_private_directory(path: Path) -> int:
    """Create/check an owned 0700 destination and return its no-follow fd."""
    absolute = Path(os.path.abspath(path))
    cursor = Path(absolute.anchor)
    for component in absolute.parts[1:]:
        cursor = cursor / component
        try:
            component_stat = os.lstat(cursor)
        except FileNotFoundError:
            continue
        if stat.S_ISLNK(component_stat.st_mode):
            raise PreflightError("private output path cannot contain symlinks")
    absolute.mkdir(parents=True, exist_ok=True, mode=0o700)
    nofollow = getattr(os, "O_NOFOLLOW", None)
    directory = getattr(os, "O_DIRECTORY", None)
    if nofollow is None or directory is None:
        raise PreflightError("filesystem does not support no-follow private directory access")
    flags = os.O_RDONLY | directory | nofollow
    try:
        fd = os.open(absolute, flags)
    except OSError as error:
        raise PreflightError("private output directory is unavailable or is a symlink") from error
    metadata = os.fstat(fd)
    if (
        not stat.S_ISDIR(metadata.st_mode)
        or metadata.st_uid != os.geteuid()
        or stat.S_IMODE(metadata.st_mode) != 0o700
    ):
        os.close(fd)
        raise PreflightError("private output directory must be owned by this user and mode 0700")
    return fd


def require_apply_admission() -> None:
    raise ApplyBlocked(
        "apply stopped before database connection: this tool only captures read-only preimages; "
        "a coordinator-reviewed finite historical-PO UUID admission manifest and exact reviewed "
        "apply executor are not available"
    )


def cli_error_code(error: BaseException) -> str:
    """Return only a static allowlisted code; exception details can contain source data."""
    if isinstance(error, ApplyBlocked):
        return "apply_not_enabled"
    if isinstance(error, PreflightError):
        return "preflight_refused"
    if isinstance(error, OSError):
        return "private_io_failed"
    return "read_only_preflight_failed"


def cli_error_payload(error: BaseException) -> dict[str, Any]:
    return {"error_code": cli_error_code(error), "apply_enabled": False}


def proven_database_identity(connection: Any) -> dict[str, Any]:
    """Prove the live Supabase target from connection/server identity only."""
    identity = IMPORTER.assert_server_is_target(
        connection, expected_ref=TARGET, mode=READ_ONLY_MODE
    )
    values = {
        "project_ref": getattr(identity, "project_ref", None),
        "host": getattr(identity, "host", None),
        "port": getattr(identity, "port", None),
        "database": getattr(identity, "database", None),
        "user": getattr(identity, "user", None),
        "fingerprint": getattr(identity, "fingerprint", None),
    }
    if any(value in (None, "") for value in values.values()):
        raise PreflightError("live target identity is incomplete")
    if values["project_ref"] != TARGET:
        raise PreflightError("live target identity does not match the approved project")
    validate_database_identity(values)
    return values


def validate_database_identity(values: Mapping[str, Any]) -> None:
    """Bind the project proof to the one verified Virginia production endpoint."""
    if (
        values.get("host") != TARGET_HOST
        or values.get("port") != TARGET_PORT
        or values.get("database") != TARGET_DATABASE
        or values.get("user") != TARGET_USER
    ):
        raise PreflightError("live database endpoint does not match the approved Virginia target")
    fingerprint = values.get("fingerprint")
    if not isinstance(fingerprint, (list, tuple)) or not fingerprint or not all(isinstance(item, str) for item in fingerprint):
        raise PreflightError("live database server fingerprint is incomplete")


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plan", type=Path, required=True, help="Exact protected disposition-plan JSON")
    parser.add_argument("--expected-plan-sha256", required=True)
    parser.add_argument("--expected-answer-packet-sha256", required=True)
    parser.add_argument("--expected-returned-workbook-sha256", required=True)
    parser.add_argument("--expected-google-capture-sha256", required=True)
    parser.add_argument("--recovery-dir", type=Path, required=True, help="Private directory outside this checkout")
    parser.add_argument("--apply", action="store_true", help="Always held until coordinator-reviewed PO admissions exist")
    return parser


def _connect_read_only() -> Any:
    database_url = os.environ.get("PRODUCTION_DATABASE_URL")
    if not database_url:
        raise PreflightError("PRODUCTION_DATABASE_URL is required for the read-only production preflight")
    import psycopg

    conn = psycopg.connect(database_url, connect_timeout=15)
    try:
        conn.isolation_level = psycopg.IsolationLevel.REPEATABLE_READ
        conn.read_only = True
        conn.execute("set local statement_timeout='8s'")
        conn.execute("set local lock_timeout='2s'")
        identity = proven_database_identity(conn)
        return conn, identity
    except Exception:
        conn.close()
        raise


def run(args: argparse.Namespace) -> dict[str, Any]:
    if args.apply:
        require_apply_admission()

    doc, raw = _json_read(args.plan)
    exact_plan_sha = verify_exact_plan_bytes(raw, args.expected_plan_sha256)
    source_hashes = {
        "source_answer_resolution_packet_sha256": args.expected_answer_packet_sha256,
        "returned_workbook_sha256": args.expected_returned_workbook_sha256,
        "latest_google_capture_sha256": args.expected_google_capture_sha256,
    }
    scoped = prepare_exception_scope(doc, plan_sha256=exact_plan_sha, expected_source_hashes=source_hashes)
    recovery = Path(os.path.abspath(args.recovery_dir))
    if recovery == ROOT or ROOT in recovery.parents:
        raise PreflightError("recovery directory must be outside the repository")
    directory_fd = open_private_directory(recovery)
    os.close(directory_fd)
    if any(recovery.iterdir()):
        raise PreflightError("recovery directory must be empty")

    conn, database_identity = _connect_read_only()
    try:
        preimages = capture_preimages(conn, scoped)
        preimages["database_identity"] = database_identity
        mapping = validate_source_ref_mappings(scoped, preimages)
        if conn.info.transaction_status:
            conn.rollback()
    finally:
        conn.close()
    preimages_digest = digest(preimages)
    saved_plan = {
        "schema": "orderlist-exception-only-review-plan-v1",
        "input_plan_sha256": scoped["input_plan_sha256"],
        "source_hashes": source_hashes,
        "preimages_sha256": preimages_digest,
        "mapping": {
            key: value for key, value in mapping.items()
            if key not in {"resolved_header_uuids", "resolved_line_uuids"}
        },
        "counts": {
            **EXPECTED_COUNTS,
            "existing_header_refs": mapping["existing_header_ref_count"],
            "existing_line_refs": mapping["existing_line_ref_count"],
            "historical_po_collision_candidates": len(preimages["po_collision_candidate_ids"]),
        },
        "historical_po_admission_required": True,
        "apply_enabled": False,
        "desired_orders": scoped["orders"],
        "desired_lines": scoped["lines"],
        "skipped_rows": scoped["skipped_rows"],
    }
    private_write(recovery / "source-preimages.json", preimages)
    private_write(recovery / "review-plan.json", saved_plan)
    return {
        "mode": "read-only-dry-run",
        "target": TARGET,
        "input_plan_sha256": scoped["input_plan_sha256"],
        "preimages_sha256": preimages_digest,
        "counts": saved_plan["counts"],
        "apply_enabled": False,
        "recovery_artifacts_written": 2,
    }


def main() -> int:
    os.umask(0o077)
    args = _parser().parse_args()
    try:
        result = run(args)
    except Exception as error:
        print(json.dumps(cli_error_payload(error)), file=sys.stderr)
        return 2
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":  # pragma: no cover - CLI wrapper
    raise SystemExit(main())
