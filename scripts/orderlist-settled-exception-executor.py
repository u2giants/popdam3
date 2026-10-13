#!/usr/bin/env python3
"""Frozen-plan executor for the settled #277 Google OrderList exceptions.

Dry-run is the default. Apply requires an exact preimage bundle, a reviewer
approval bundle for these bytes and this executor, the standard task gate, a
fresh Virginia identity proof, exact guard absence, and unchanged locked
preimages. It never deletes rows or writes historical-PO admissions.
"""

from __future__ import annotations

import argparse
import copy
from datetime import date, datetime
from decimal import Decimal
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import uuid
from typing import Any, Mapping, Sequence


ROOT = Path(__file__).resolve().parents[1]
PREFLIGHT_PATH = ROOT / "scripts" / "orderlist-source-disposition-writer.py"
TARGET = "qsllyeztdwjgirsysgai"
SOURCE_SYSTEM = "google_order_list"
GUARD_MIGRATION = "20261013164735"
EXPECTED_HEADER_COUNT = 76
EXPECTED_LINE_COUNT = 296
ADVISORY_LOCK_KEY = 852_000_727
DATE_FIELDS = {
    "seal_container_date", "sent_po_date", "vendor_delivery_date", "etd", "eta",
    "warehouse_date", "start_ship_date", "cancel_date", "cargo_forecast_date",
}
NUMERIC_FIELDS = {
    "quantity_ordered", "quantity_shipped", "unit_cost", "order_depth_inches",
    "case_pack", "cases_reported",
}
INTEGER_FIELDS = {"assortment_component_ordinal"}
REVIEW_BUNDLE_TYPE = "orderlist_settled_exception_apply_approval_v1"
CATALOG_SNAPSHOT_SCHEMA = "orderlist-exact-master-data-catalog-v1"
MATCH_PROVENANCE_METADATA_KEYS = (
    "master_data_resolution", "item_link_pending_reason", "master_data_candidate_count",
)


class ExecutorError(ValueError):
    """Frozen inputs, preimages, or readback violate the reviewed contract."""


class AdmissionRequired(ExecutorError):
    """The PO reuse guard is present or partially installed; never bypass it."""


class ApplyBlocked(RuntimeError):
    """The independent review or task gate is missing or no longer exact."""


_PREFLIGHT_SPEC = importlib.util.spec_from_file_location("orderlist_exception_preflight", PREFLIGHT_PATH)
if _PREFLIGHT_SPEC is None or _PREFLIGHT_SPEC.loader is None:  # pragma: no cover
    raise RuntimeError("preflight module unavailable")
PREFLIGHT = importlib.util.module_from_spec(_PREFLIGHT_SPEC)
sys.modules[_PREFLIGHT_SPEC.name] = PREFLIGHT
_PREFLIGHT_SPEC.loader.exec_module(PREFLIGHT)
IMPORTER = PREFLIGHT.IMPORTER


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def canonical(value: Any) -> Any:
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return format(value, "f")
    if isinstance(value, uuid.UUID):
        return str(value)
    if isinstance(value, Mapping):
        return {str(key): canonical(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [canonical(item) for item in value]
    return value


def digest(value: Any) -> str:
    return sha256_bytes(json.dumps(canonical(value), sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode())


def deterministic_uuid(entity: str, source_id: str) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"popdam3:issue277:settled55:{entity}:{source_id}"))


def _assert_no_preimage_uuid_collision(generated_ids: Sequence[str], existing_ids: set[str]) -> None:
    if len(set(generated_ids)) != len(generated_ids) or set(generated_ids) & existing_ids:
        raise ExecutorError("deterministic target UUID collides with a frozen preimage UUID")


def _line_source_aliases(lines: Sequence[Mapping[str, Any]]) -> dict[str, list[str]]:
    by_row: dict[int, list[Mapping[str, Any]]] = {}
    for line in lines:
        row = line.get("sheet_row")
        if not isinstance(row, int):
            raise ExecutorError("frozen line lacks a physical source row")
        by_row.setdefault(row, []).append(line)
    result: dict[str, list[str]] = {}
    for row, row_lines in by_row.items():
        candidates = {IMPORTER.line_source_id(row)}
        ordinals = [item.get("ordinal") for item in row_lines if isinstance(item.get("ordinal"), int)]
        snapshot = row_lines[0].get("metadata", {}).get("source_disposition", {}).get("source_row_snapshot_exact", {})
        raw_skus = IMPORTER.split_aligned(snapshot.get("AR")) if isinstance(snapshot, dict) else []
        max_ordinal = max([len(raw_skus), *ordinals, 1])
        candidates.update(IMPORTER.component_source_id(row, ordinal) for ordinal in range(1, max_ordinal + 1))
        candidates.update(str(item["source_id"]) for item in row_lines)
        result[str(row)] = sorted(candidates)
    return result


def _validate_review_plan(
    review_plan: Mapping[str, Any],
    source_preimages: Mapping[str, Any],
    *,
    expected_review_plan_sha256: str,
    expected_preimages_file_sha256: str,
    review_plan_raw: bytes,
    preimages_raw: bytes,
) -> dict[str, Any]:
    if sha256_bytes(review_plan_raw) != expected_review_plan_sha256:
        raise ExecutorError("frozen review-plan digest mismatch")
    if sha256_bytes(preimages_raw) != expected_preimages_file_sha256:
        raise ExecutorError("frozen preimage-file digest mismatch")
    if review_plan.get("schema") != "orderlist-exception-only-review-plan-v1":
        raise ExecutorError("unsupported frozen review-plan schema")
    if review_plan.get("target") not in (None, TARGET) or source_preimages.get("target") != TARGET:
        raise ExecutorError("frozen inputs do not bind the Virginia target")
    if review_plan.get("apply_enabled") is not False:
        raise ExecutorError("frozen review plan must remain dry-run only")
    if source_preimages.get("schema") != "orderlist-exception-source-preimages-v1":
        raise ExecutorError("unsupported frozen preimage schema")
    database_identity = source_preimages.get("database_identity")
    if not isinstance(database_identity, dict):
        raise ExecutorError("frozen database identity is missing")
    PREFLIGHT.validate_database_identity(database_identity)
    if PREFLIGHT.digest(source_preimages) != review_plan.get("preimages_sha256"):
        raise ExecutorError("semantic preimage digest differs from the review plan")
    counts = review_plan.get("counts")
    if not isinstance(counts, dict):
        raise ExecutorError("frozen counts are missing")
    expected_counts = {
        "desired_headers": EXPECTED_HEADER_COUNT,
        "desired_lines": EXPECTED_LINE_COUNT,
        "existing_header_refs": 36,
        "existing_line_refs": 43,
        "historical_po_collision_candidates": 36,
        "held_parent_only_rows": 20,
        "held_parent_only_lines": 20,
        "held_only_headers": 8,
        "skipped_rows": 7,
    }
    if any(counts.get(key) != value for key, value in expected_counts.items()):
        raise ExecutorError("frozen scope counts differ from the reviewed settled-55 disposition")
    if len(review_plan.get("desired_orders", [])) != EXPECTED_HEADER_COUNT:
        raise ExecutorError("frozen desired-header scope is incomplete")
    if len(review_plan.get("desired_lines", [])) != EXPECTED_LINE_COUNT:
        raise ExecutorError("frozen desired-line scope is incomplete")
    if len(source_preimages.get("order_refs", [])) != 36 or len(source_preimages.get("line_refs", [])) != 43:
        raise ExecutorError("frozen source-reference preimages differ from reviewed counts")
    if len(source_preimages.get("tracking", [])) != 36 or source_preimages.get("snapshots"):
        raise ExecutorError("frozen tracking or snapshot preimages differ from reviewed counts")
    source_hashes = review_plan.get("source_hashes")
    if not isinstance(source_hashes, dict) or set(source_hashes) != PREFLIGHT.SOURCE_HASH_KEYS:
        raise ExecutorError("frozen answer/source hash set is incomplete")
    for value in source_hashes.values():
        PREFLIGHT._require_hash(value, "source_hash")
    return {
        "orders": review_plan["desired_orders"],
        "lines": review_plan["desired_lines"],
        "line_source_id_aliases": _line_source_aliases(review_plan["desired_lines"]),
        "source_hashes": source_hashes,
    }


def _merge_metadata(current: Any, desired: Any) -> dict[str, Any]:
    if isinstance(current, str):
        try:
            current = json.loads(current)
        except json.JSONDecodeError:
            raise ExecutorError("existing metadata is not valid JSON") from None
    if not isinstance(current, dict):
        current = {}
    if isinstance(desired, str):
        desired = json.loads(desired)
    if not isinstance(desired, dict):
        desired = {}
    result = copy.deepcopy(current)
    for key, value in desired.items():
        if isinstance(value, dict) and isinstance(result.get(key), dict):
            result[key] = {**result[key], **value}
        else:
            result[key] = copy.deepcopy(value)
    return result


def _merge_existing_line_metadata(current: Any, desired: Any) -> dict[str, Any]:
    """Merge approved source evidence without replacing live matching provenance."""
    preserved = _merge_metadata(current, {})
    incoming = _merge_metadata({}, desired)
    for key in MATCH_PROVENANCE_METADATA_KEYS:
        if key in preserved:
            incoming[key] = copy.deepcopy(preserved[key])
        else:
            incoming.pop(key, None)
    return _merge_metadata(preserved, incoming)


def _entry_metadata(entry: Mapping[str, Any], payload: Mapping[str, Any]) -> dict[str, Any]:
    outer = entry.get("metadata")
    if not isinstance(outer, dict):
        raise ExecutorError("frozen source metadata is missing or invalid")
    if "metadata" in payload and canonical(payload["metadata"]) != canonical(outer):
        raise ExecutorError("payload and outer source metadata conflict")
    return copy.deepcopy(outer)


def _numeric_value(column: str, value: Any) -> Decimal | int | None:
    if value is None:
        return None
    if isinstance(value, bool):
        raise ExecutorError("numeric source field is not a valid scalar")
    try:
        number = Decimal(str(value))
    except Exception:
        raise ExecutorError("numeric source field is not a valid scalar") from None
    if not number.is_finite():
        raise ExecutorError("numeric source field must be finite")
    if column in INTEGER_FIELDS:
        if number != number.to_integral_value():
            raise ExecutorError("integer source field has a fractional value")
        return int(number)
    return number


def _db_value(column: str, value: Any) -> Any:
    if column in NUMERIC_FIELDS | INTEGER_FIELDS:
        return _numeric_value(column, value)
    if column in DATE_FIELDS and value not in (None, ""):
        if isinstance(value, date):
            return value
        if not isinstance(value, str):
            raise ExecutorError("date field is not a reviewed ISO value")
        try:
            parsed = date.fromisoformat(value)
        except ValueError:
            raise ExecutorError("date field is not a reviewed ISO value") from None
        if parsed.isoformat() != value:
            raise ExecutorError("date field is not a canonical reviewed ISO value")
        return parsed
    return value


def _comparable_field(column: str, value: Any) -> Any:
    if column in NUMERIC_FIELDS | INTEGER_FIELDS:
        value = _numeric_value(column, value)
    return _comparable(value)


def _freeze_schema_numeric_columns(row: dict[str, Any]) -> None:
    """Store canonical numeric DB fields as JSON-stable strings outside metadata."""
    for column in NUMERIC_FIELDS:
        if column in row and row[column] is not None:
            row[column] = format(_numeric_value(column, row[column]), "f")
    for column in INTEGER_FIELDS:
        if column in row and row[column] is not None:
            row[column] = _numeric_value(column, row[column])


def _normalized_line_sku(value: Any) -> str | None:
    return IMPORTER.normalize_sku(value)


def construct_postimage(
    review_plan: Mapping[str, Any], source_preimages: Mapping[str, Any], scoped: Mapping[str, Any],
    catalog_snapshot: Mapping[str, Any],
) -> dict[str, Any]:
    mapping = PREFLIGHT.validate_source_ref_mappings(scoped, source_preimages)
    saved_mapping = review_plan.get("mapping", {})
    checked_mapping = {key: value for key, value in mapping.items() if key not in {"resolved_header_uuids", "resolved_line_uuids"}}
    if checked_mapping != saved_mapping:
        raise ExecutorError("current source-reference mapping differs from the frozen review plan")

    existing_orders = {row["id"]: row for row in source_preimages["orders"]}
    existing_lines = {row["id"]: row for row in source_preimages["lines"]}
    order_uuid_by_source = dict(mapping["resolved_header_uuids"])
    line_uuid_by_source = dict(mapping["resolved_line_uuids"])
    for order in scoped["orders"]:
        order_uuid_by_source.setdefault(order["source_id"], deterministic_uuid("production_order", order["source_id"]))
    for line in scoped["lines"]:
        line_uuid_by_source.setdefault(line["source_id"], deterministic_uuid("production_order_line", line["source_id"]))

    all_existing_ids = {
        str(row["id"]) for key in ("orders", "lines", "order_refs", "line_refs", "line_refs_by_uuid", "snapshots")
        for row in source_preimages.get(key, [])
    }
    all_existing_ids.update(str(row["order_id"]) for row in source_preimages.get("tracking", []) if row.get("order_id"))
    new_header_ids = set(order_uuid_by_source.values()) - set(existing_orders)
    new_line_ids = set(line_uuid_by_source.values()) - set(existing_lines)
    _assert_no_preimage_uuid_collision([*new_header_ids, *new_line_ids], all_existing_ids)

    header_source_fields = set(IMPORTER.ORDER_COLUMNS) - {
        "production_order_number", "status", "booking_state", "container_booking_group",
        "mbl", "close_tracking", "metadata",
    }
    line_source_fields = set(IMPORTER.LINE_COLUMNS) - {
        "quantity_ordered", "item_id", "status", "master_data_match_status", "metadata",
        "line_number", "assortment_component_ordinal",
    }
    tracking_by_order = {str(row.get("order_id")): row for row in source_preimages.get("tracking", [])}
    order_actions = []
    for order in scoped["orders"]:
        source_id = order["source_id"]
        row_id = order_uuid_by_source[source_id]
        current = next((row for row in source_preimages["orders"] if row.get("id") == row_id), None)
        payload = order.get("payload")
        if not isinstance(payload, dict) or set(payload) - set(IMPORTER.ORDER_COLUMNS):
            raise ExecutorError("header payload contains unsupported writer fields")
        outer_metadata = _entry_metadata(order, payload)
        values = {
            column: _db_value(column, outer_metadata if column == "metadata" else payload.get(column))
            for column in IMPORTER.ORDER_COLUMNS
        }
        disposition = outer_metadata.get("source_disposition", {})
        source_rows = order.get("sheet_rows")
        if not isinstance(source_rows, list) or not all(isinstance(row, int) and not isinstance(row, bool) for row in source_rows):
            raise ExecutorError("header source row bindings are invalid")
        source_rows = sorted(set(source_rows))
        if current is None:
            post = {"id": row_id, **values}
            action = "insert"
            write_fields = list(IMPORTER.ORDER_COLUMNS)
        else:
            post = copy.deepcopy(current)
            update_fields = set(header_source_fields)
            tracking = tracking_by_order.get(str(row_id), {})
            if tracking.get("crd_override_set") is True:
                update_fields.discard("vendor_delivery_date")
            for field in update_fields:
                post[field] = values[field]
            post["metadata"] = _merge_metadata(current.get("metadata"), values.get("metadata"))
            write_fields = list(dict.fromkeys(
                field for field in (*IMPORTER.ORDER_COLUMNS, "metadata")
                if field in update_fields or field == "metadata"
            ))
            action = "update" if any(post.get(field) != current.get(field) for field in write_fields) else "preserve"
        order_actions.append({
            "source_id": source_id,
            "source_rows": sorted(source_rows),
            "id": row_id,
            "action": action,
            "write_fields": write_fields if action != "preserve" else [],
            "write_values": {field: post.get(field) for field in write_fields} if action != "preserve" else {},
            "assert_fields": post,
            "database_default_fields": ["created_at", "updated_at"] if current is None else [],
            "source_evidence_sha256": digest({"source_id": source_id, "sheet_rows": source_rows, "metadata": outer_metadata}),
        })

    line_actions = []
    catalog = _master_data_catalog(catalog_snapshot, scoped["lines"], source_preimages, line_uuid_by_source)
    catalog_audit = {"matched": 0, "unmatched": 0, "ambiguous": 0, "not_applicable": 0, "existing_link_checks": 0}
    for line in scoped["lines"]:
        source_id = line["source_id"]
        row_id = line_uuid_by_source[source_id]
        current = next((row for row in source_preimages["lines"] if row.get("id") == row_id), None)
        payload = line.get("payload")
        if not isinstance(payload, dict) or set(payload) - set(IMPORTER.LINE_COLUMNS):
            raise ExecutorError("line payload contains unsupported writer fields")
        outer_metadata = _entry_metadata(line, payload)
        values = {
            column: _db_value(column, outer_metadata if column == "metadata" else payload.get(column))
            for column in IMPORTER.LINE_COLUMNS
        }
        header_id = order_uuid_by_source.get(line.get("order_source_id"))
        if not header_id:
            raise ExecutorError("line has no exact planned parent UUID")
        values["metadata"] = _merge_metadata({}, values.get("metadata"))
        source_rows = [line.get("sheet_row")]
        if current is None:
            post = {"id": row_id, "production_order_id": header_id, **values}
            post["sku_normalized"] = _normalized_line_sku(post.get("sku"))
            _apply_master_data_match(post, catalog, catalog_audit)
            action = "insert"
            write_fields = list(IMPORTER.LINE_COLUMNS)
        else:
            post = copy.deepcopy(current)
            old_sku = current.get("sku")
            update_fields = set(line_source_fields)
            for field in update_fields:
                post[field] = values[field]
            post["metadata"] = _merge_existing_line_metadata(current.get("metadata"), values.get("metadata"))
            post["sku_normalized"] = _normalized_line_sku(post.get("sku"))
            if current.get("item_id") and (
                _normalized_line_sku(old_sku) != post["sku_normalized"]
                or current.get("source_style_type") != post.get("source_style_type")
            ):
                catalog_audit["existing_link_checks"] += 1
                match = _resolve_master_data_match(post, catalog)
                if match.item_id != current.get("item_id"):
                    raise ExecutorError("corrected SKU would invalidate a preserved existing Item Master link")
            write_fields = list(dict.fromkeys(
                field for field in IMPORTER.LINE_COLUMNS if field in update_fields or field == "metadata"
            ))
            action = "update" if any(post.get(field) != current.get(field) for field in write_fields) else "preserve"
        if current is not None and current.get("production_order_id") != header_id:
            raise ExecutorError("existing line belongs to a different current header UUID")
        line_actions.append({
            "source_id": source_id,
            "source_row": line.get("sheet_row"),
            "id": row_id,
            "production_order_id": header_id,
            "action": action,
            "write_fields": write_fields if action != "preserve" else [],
            "write_values": {field: post.get(field) for field in write_fields} if action != "preserve" else {},
            "assert_fields": post,
            "database_default_fields": ["created_at", "updated_at"] if current is None else [],
            "source_evidence_sha256": digest({
                "source_id": source_id,
                "sheet_row": line.get("sheet_row"),
                "ordinal": line.get("ordinal"),
                "order_source_id": line.get("order_source_id"),
                "metadata": outer_metadata,
            }),
        })

    existing_header_sources = {ref.get("source_id") for ref in source_preimages["order_refs"] if ref.get("source_system") == SOURCE_SYSTEM}
    existing_line_sources = {ref.get("source_id") for ref in source_preimages["line_refs"] if ref.get("source_system") == SOURCE_SYSTEM}
    evidence_meta = {
        "review_plan_sha256": review_plan["input_plan_sha256"],
        "source_hashes": review_plan["source_hashes"],
    }
    header_ref_actions = [
        {
            "id": deterministic_uuid("production_order_source_ref", row["source_id"]),
            "production_order_id": row["id"],
            "source_system": SOURCE_SYSTEM,
            "source_id": row["source_id"],
            "is_primary": True,
            "metadata": {**evidence_meta, "source_rows": row["source_rows"], "source_evidence_sha256": row["source_evidence_sha256"]},
        }
        for row in order_actions if row["source_id"] not in existing_header_sources
    ]
    line_ref_actions = [
        {
            "id": deterministic_uuid("production_order_line_source_ref", row["source_id"]),
            "production_order_line_id": row["id"],
            "source_system": SOURCE_SYSTEM,
            "source_id": row["source_id"],
            "is_primary": True,
            "metadata": {**evidence_meta, "source_rows": [row["source_row"]], "source_evidence_sha256": row["source_evidence_sha256"]},
        }
        for row in line_actions if row["source_id"] not in existing_line_sources
    ]
    planned_ref_ids = [row["id"] for row in (*header_ref_actions, *line_ref_actions)]
    _assert_no_preimage_uuid_collision(planned_ref_ids, all_existing_ids)

    po_groups: dict[str, list[dict[str, Any]]] = {}
    for order in order_actions:
        norm = IMPORTER.normalize_po_number(order["assert_fields"].get("production_order_number"))
        if norm:
            po_groups.setdefault(norm, []).append(order)
    existing_po_norms = {
        normalized for row in source_preimages.get("orders", [])
        if (normalized := IMPORTER.normalize_po_number(row.get("production_order_number")))
    }
    admissions = [
        {
            "production_order_uuid": row["id"],
            "normalized_production_po": normalized,
            "source_id": row["source_id"],
            "source_rows": row["source_rows"],
        }
        for normalized, group in sorted(po_groups.items())
        for row in group
        if row["action"] == "insert" and (len(group) > 1 or normalized in existing_po_norms)
    ]
    counts = {
        "headers_total": len(order_actions),
        "headers_insert": sum(row["action"] == "insert" for row in order_actions),
        "headers_update": sum(row["action"] == "update" for row in order_actions),
        "headers_preserve": sum(row["action"] == "preserve" for row in order_actions),
        "lines_total": len(line_actions),
        "lines_insert": sum(row["action"] == "insert" for row in line_actions),
        "lines_update": sum(row["action"] == "update" for row in line_actions),
        "lines_preserve": sum(row["action"] == "preserve" for row in line_actions),
        "header_refs_insert": len(header_ref_actions),
        "line_refs_insert": len(line_ref_actions),
        "po_admission_requirements": len(admissions),
    }
    desired_order_sids = {row["source_id"] for row in order_actions}
    desired_line_sids = {row["source_id"] for row in line_actions}
    order_ref_assertions = {
        row["source_id"]: copy.deepcopy(row)
        for row in source_preimages["order_refs"]
        if row.get("source_system") == SOURCE_SYSTEM and row.get("source_id") in desired_order_sids
    }
    order_ref_assertions.update({row["source_id"]: row for row in header_ref_actions})
    line_ref_assertions = {
        row["source_id"]: copy.deepcopy(row)
        for row in source_preimages["line_refs"]
        if row.get("source_system") == SOURCE_SYSTEM and row.get("source_id") in desired_line_sids
    }
    line_ref_assertions.update({row["source_id"]: row for row in line_ref_actions})
    if set(order_ref_assertions) != desired_order_sids or set(line_ref_assertions) != desired_line_sids:
        raise ExecutorError("source-reference assertion set is not one-to-one with the desired rows")
    if counts["headers_insert"] != 40 or counts["lines_insert"] != 253 or counts["header_refs_insert"] != 40 or counts["line_refs_insert"] != 253:
        raise ExecutorError("frozen missing-row and source-reference counts differ from the reviewed preflight")
    for action in (*order_actions, *line_actions):
        for field_name in ("assert_fields", "write_values"):
            fields = action.get(field_name)
            if isinstance(fields, dict):
                _freeze_schema_numeric_columns(fields)
    return {
        "schema": "orderlist-settled-exception-postimage-v1",
        "target": TARGET,
        "review_plan_sha256": review_plan["_exact_review_plan_sha256"],
        "source_preimages_file_sha256": review_plan["_exact_preimages_file_sha256"],
        "source_preimages_semantic_sha256": review_plan["preimages_sha256"],
        "input_plan_sha256": review_plan["input_plan_sha256"],
        "source_hashes": review_plan["source_hashes"],
        "counts": counts,
        "orders": order_actions,
        "lines": line_actions,
        "order_source_refs_insert": header_ref_actions,
        "line_source_refs_insert": line_ref_actions,
        "order_source_ref_assertions": order_ref_assertions,
        "line_source_ref_assertions": line_ref_assertions,
        "tracking_assertions": copy.deepcopy(source_preimages["tracking"]),
        "snapshot_assertions": copy.deepcopy(source_preimages["snapshots"]),
        "admission_requirements_if_guard_present": admissions,
        "catalog_snapshot": catalog_snapshot,
        "catalog_snapshot_sha256": digest(catalog_snapshot),
        "catalog_resolution_counts": catalog_audit,
        "canonical_importer_sha256": sha256_bytes((ROOT / "shared-db" / "scripts" / "import-order-list-xlsx.py").read_bytes()),
        "deletes": 0,
    }


def _catalog_pairs(
    lines: Sequence[Mapping[str, Any]], missing_source_ids: set[str],
    existing_lines_by_source: Mapping[str, Mapping[str, Any]] | None = None,
) -> list[tuple[str, str]]:
    pairs: set[tuple[str, str]] = set()
    for line in lines:
        payload = line.get("payload", {})
        sku = IMPORTER.normalize_sku(payload.get("sku"))
        style_type = payload.get("source_style_type")
        source_id = line.get("source_id")
        current = (existing_lines_by_source or {}).get(source_id)
        needs_candidate_check = source_id in missing_source_ids
        if current and current.get("item_id"):
            needs_candidate_check = needs_candidate_check or (
                IMPORTER.normalize_sku(current.get("sku")) != sku
                or current.get("source_style_type") != style_type
            )
        if not needs_candidate_check:
            continue
        if sku and style_type in {"licensed", "generic"}:
            pairs.add((sku, style_type))
    return sorted(pairs)


def _master_data_catalog(
    snapshot: Mapping[str, Any], lines: Sequence[Mapping[str, Any]], source_preimages: Mapping[str, Any],
    line_uuid_by_source: Mapping[str, str],
) -> Any:
    if snapshot.get("schema") != CATALOG_SNAPSHOT_SCHEMA or snapshot.get("target") != TARGET:
        raise ExecutorError("bounded catalog snapshot schema or target is invalid")
    existing_ids = {str(row.get("id")) for row in source_preimages.get("lines", [])}
    missing_sids = {line["source_id"] for line in lines if line_uuid_by_source[line["source_id"]] not in existing_ids}
    current_by_source = {
        sid: source_preimages_line
        for sid, uuid_value in line_uuid_by_source.items()
        for source_preimages_line in source_preimages.get("lines", [])
        if str(source_preimages_line.get("id")) == str(uuid_value)
    }
    pairs = _catalog_pairs(lines, missing_sids, current_by_source)
    expected_pairs = [{"sku_normalized": sku, "style_type": style_type} for sku, style_type in pairs]
    if snapshot.get("requested_pairs") != expected_pairs:
        raise ExecutorError("catalog snapshot does not bind the exact missing-line SKU/type scope")
    candidate_rows = snapshot.get("rows")
    if not isinstance(candidate_rows, list):
        raise ExecutorError("catalog snapshot rows are invalid")
    rows: dict[tuple[str, str], list[str]] = {}
    item_ids: dict[str, str | None] = {}
    allowed = set(pairs)
    for row in candidate_rows:
        if not isinstance(row, dict) or set(row) != {"id", "sku_normalized", "style_type", "plm_item_id"}:
            raise ExecutorError("catalog snapshot contains unsupported candidate fields")
        row_id, sku, style_type, item_id = row["id"], row["sku_normalized"], row["style_type"], row["plm_item_id"]
        if not isinstance(row_id, str) or not row_id or (sku, style_type) not in allowed:
            raise ExecutorError("catalog candidate is outside the exact requested SKU/type scope")
        if item_id is not None and not isinstance(item_id, str):
            raise ExecutorError("catalog bridge item ID is invalid")
        rows.setdefault((sku, style_type), []).append(row_id)
        item_ids[row_id] = item_id
    return IMPORTER.MasterDataCatalog(rows=rows, item_ids=item_ids)


def _resolve_master_data_match(payload: Mapping[str, Any], catalog: Any) -> Any:
    sku = IMPORTER.normalize_sku(payload.get("sku"))
    return IMPORTER.resolve_match(sku, payload.get("source_style_type"), catalog)


def _apply_master_data_match(post: dict[str, Any], catalog: Any, counts: dict[str, int]) -> None:
    match = _resolve_master_data_match(post, catalog)
    dummy_plan = IMPORTER.ImportPlan()
    match_metadata: dict[str, Any] = {}
    IMPORTER._apply_match(post, match_metadata, match, dummy_plan)
    post["metadata"] = _merge_metadata(post.get("metadata"), match_metadata)
    counts[match.status] += 1


def build_catalog_snapshot(connection: Any, lines: Sequence[Mapping[str, Any]], source_preimages: Mapping[str, Any], line_uuid_by_source: Mapping[str, str]) -> dict[str, Any]:
    existing_ids = {str(row.get("id")) for row in source_preimages.get("lines", [])}
    missing_sids = {line["source_id"] for line in lines if line_uuid_by_source[line["source_id"]] not in existing_ids}
    current_by_source = {
        sid: source_preimages_line
        for sid, uuid_value in line_uuid_by_source.items()
        for source_preimages_line in source_preimages.get("lines", [])
        if str(source_preimages_line.get("id")) == str(uuid_value)
    }
    pairs = _catalog_pairs(lines, missing_sids, current_by_source)
    snapshot_rows: list[dict[str, Any]] = []
    if pairs:
        values_sql = ", ".join(["(%s::text, %s::text)"] * len(pairs))
        params = [value for pair in pairs for value in pair]
        query = f"""
            with requested(sku_normalized, style_type) as (values {values_sql})
            select str.id::text, nullif(btrim(lower(str.sku)), ''),
                   case str.source_sheet when 'License.Style' then 'licensed' when 'Generic.Style' then 'generic' end,
                   bridge.plm_item_id::text
            from public.style_tracker_rows str
            left join plm.style_tracker_item_bridge bridge on bridge.style_tracker_row_id = str.id
            where str.source_sheet in ('License.Style', 'Generic.Style')
              and exists (
                select 1 from requested r
                where r.sku_normalized = nullif(btrim(lower(str.sku)), '')
                  and r.style_type = case str.source_sheet when 'License.Style' then 'licensed' when 'Generic.Style' then 'generic' end
              )
            order by 2, 3, 1, 4
        """
        for row_id, sku, style_type, item_id in connection.execute(query, params).fetchall():
            snapshot_rows.append({"id": str(row_id), "sku_normalized": sku, "style_type": style_type, "plm_item_id": str(item_id) if item_id is not None else None})
    return {
        "schema": CATALOG_SNAPSHOT_SCHEMA,
        "target": TARGET,
        "requested_pairs": [{"sku_normalized": sku, "style_type": style_type} for sku, style_type in pairs],
        "rows": snapshot_rows,
    }


def _resolve_line_uuid_map(source_preimages: Mapping[str, Any], scoped: Mapping[str, Any]) -> dict[str, str]:
    mapping = PREFLIGHT.validate_source_ref_mappings(scoped, source_preimages)
    result = dict(mapping["resolved_line_uuids"])
    for line in scoped["lines"]:
        result.setdefault(line["source_id"], deterministic_uuid("production_order_line", line["source_id"]))
    return result


def build_frozen_postimage(
    review_plan_raw: bytes,
    preimages_raw: bytes,
    catalog_snapshot_raw: bytes,
    *,
    expected_review_plan_sha256: str,
    expected_preimages_file_sha256: str,
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    try:
        review_plan = json.loads(review_plan_raw)
        source_preimages = json.loads(preimages_raw)
        catalog_snapshot = json.loads(catalog_snapshot_raw)
    except (json.JSONDecodeError, UnicodeDecodeError):
        raise ExecutorError("frozen input JSON is invalid") from None
    if not isinstance(review_plan, dict) or not isinstance(source_preimages, dict) or not isinstance(catalog_snapshot, dict):
        raise ExecutorError("frozen inputs must be JSON objects")
    scoped = _validate_review_plan(
        review_plan,
        source_preimages,
        expected_review_plan_sha256=expected_review_plan_sha256,
        expected_preimages_file_sha256=expected_preimages_file_sha256,
        review_plan_raw=review_plan_raw,
        preimages_raw=preimages_raw,
    )
    review_plan["_exact_review_plan_sha256"] = expected_review_plan_sha256
    review_plan["_exact_preimages_file_sha256"] = expected_preimages_file_sha256
    postimage = construct_postimage(review_plan, source_preimages, scoped, catalog_snapshot)
    return review_plan, source_preimages, postimage


def _known_guard_state(connection: Any) -> dict[str, Any]:
    row = connection.execute(
        "select "
        "to_regclass('plm.production_po_reservation') is not null, "
        "to_regclass('plm.production_po_legacy_admission') is not null, "
        "to_regprocedure('plm.normalize_production_po_number(text)') is not null, "
        "to_regprocedure('plm.guard_production_po_number()') is not null, "
        "exists(select 1 from pg_catalog.pg_trigger t "
        "join pg_catalog.pg_class c on c.oid=t.tgrelid "
        "join pg_catalog.pg_namespace n on n.oid=c.relnamespace "
        "where n.nspname='plm' and c.relname='production_order' "
        "and t.tgname='production_po_no_reuse' and not t.tgisinternal), "
        "to_regclass('supabase_migrations.schema_migrations') is not null"
    ).fetchone()
    if row is None or len(row) != 6:
        raise ExecutorError("PO reuse guard catalog state could not be proven")
    has_reservation, has_admission, has_normalizer, has_guard_fn, has_trigger, has_ledger = map(bool, row)
    if not has_ledger:
        raise ExecutorError("migration ledger unavailable; PO reuse guard absence cannot be proven")
    version_row = connection.execute(
        "select exists(select 1 from supabase_migrations.schema_migrations where version=%s)",
        (GUARD_MIGRATION,),
    ).fetchone()
    if version_row is None:
        raise ExecutorError("PO reuse guard migration state could not be proven")
    applied = bool(version_row[0])
    present = any((has_reservation, has_admission, has_normalizer, has_guard_fn, has_trigger, applied))
    return {
        "status": "present_or_partial" if present else "absent",
        "objects": {
            "reservation_table": has_reservation,
            "legacy_admission_table": has_admission,
            "normalizer_function": has_normalizer,
            "guard_function": has_guard_fn,
            "trigger": has_trigger,
            "migration_applied": applied,
        },
    }


def require_guard_absent(state: Mapping[str, Any]) -> None:
    if state.get("status") != "absent" or any(state.get("objects", {}).values()):
        raise AdmissionRequired("PO reuse guard is present or partial; finite reviewed admissions are required")


def require_review_approval(
    bundle: Mapping[str, Any],
    *,
    report_path: Path,
    review_plan_sha256: str,
    preimages_file_sha256: str,
    preimages_semantic_sha256: str,
    postimage_sha256: str,
) -> None:
    expected = {
        "artifact_type": REVIEW_BUNDLE_TYPE,
        "verdict": "APPROVE",
        "target": TARGET,
        "review_plan_sha256": review_plan_sha256,
        "source_preimages_file_sha256": preimages_file_sha256,
        "source_preimages_semantic_sha256": preimages_semantic_sha256,
        "postimage_sha256": postimage_sha256,
        "executor_sha256": sha256_bytes(Path(__file__).read_bytes()),
        "preflight_sha256": sha256_bytes(PREFLIGHT_PATH.read_bytes()),
        "reviewer_report_sha256": sha256_bytes(report_path.read_bytes()),
        "po_reuse_guard_status_at_review": "absent",
    }
    if dict(bundle) != expected:
        raise ApplyBlocked("review approval does not bind these exact frozen inputs and executor")


def check_task_gate(reviewer_report: Path) -> None:
    try:
        result = subprocess.run(
            ["ai-task-gates", "check", "--before", "database", "--reviewer-approval", str(reviewer_report)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
            timeout=30,
        )
    except Exception:
        raise ApplyBlocked("database task gate could not be completed") from None
    if result.returncode != 0:
        raise ApplyBlocked("database task gate refused the frozen executor")


class PostgresExecutorGateway:
    def __init__(self, connection: Any, identity: Mapping[str, Any], scoped: Mapping[str, Any]) -> None:
        self.connection = connection
        self.identity = identity
        self.scoped = scoped

    def lock(self, preimages: Mapping[str, Any]) -> None:
        row = self.connection.execute("select pg_try_advisory_xact_lock(%s)", (ADVISORY_LOCK_KEY,)).fetchone()
        if not row or not row[0]:
            raise ExecutorError("OrderList advisory lock is held")
        self.connection.execute("lock table plm.production_order in share row exclusive mode nowait")
        for table, column, ids in (
            ("plm.production_order", "id", [r["id"] for r in preimages["orders"]]),
            ("plm.production_order_source_ref", "id", [r["id"] for r in preimages["order_refs"]]),
            ("plm.production_order_line", "id", [r["id"] for r in preimages["lines"]]),
            ("plm.production_order_line_source_ref", "id", [r["id"] for r in preimages["line_refs_by_uuid"]]),
            ("dam.order_tracking_ext", "order_id", [r["order_id"] for r in preimages["tracking"]]),
            ("dam.production_order_snapshot", "id", [r["id"] for r in preimages["snapshots"]]),
        ):
            if ids:
                self.connection.execute(f"select {column} from {table} where {column} = any(%s::uuid[]) for update", (ids,)).fetchall()
        self.connection.execute("lock table public.style_tracker_rows in share mode nowait")
        self.connection.execute("lock table plm.style_tracker_item_bridge in share mode nowait")

    def read_preimages(self) -> dict[str, Any]:
        current = PREFLIGHT.capture_preimages(self.connection, self.scoped)
        current["database_identity"] = self.identity
        return current

    def guard_state(self) -> dict[str, Any]:
        return _known_guard_state(self.connection)

    def current_catalog_snapshot(self, postimage: Mapping[str, Any]) -> dict[str, Any]:
        saved = postimage["catalog_snapshot"]
        pairs = [(row["sku_normalized"], row["style_type"]) for row in saved["requested_pairs"]]
        synthetic_lines = [{"source_id": str(i), "payload": {"sku": sku, "source_style_type": style_type}} for i, (sku, style_type) in enumerate(pairs)]
        synthetic_preimages = {"lines": []}
        line_ids = {str(i): f"missing-{i}" for i in range(len(synthetic_lines))}
        snapshot = build_catalog_snapshot(self.connection, synthetic_lines, synthetic_preimages, line_ids)
        snapshot["po_reuse_guard_state"] = _known_guard_state(self.connection)
        return snapshot

    @staticmethod
    def _json_placeholder(column: str) -> str:
        return "%s::jsonb" if column == "metadata" else "%s"

    def _insert_canonical(self, table: str, row_id: str, parent_id: str | None, fields: Sequence[str], values: Mapping[str, Any]) -> None:
        columns = (["id"] if parent_id is None else ["id", "production_order_id"]) + list(fields)
        parameters = [row_id] if parent_id is None else [row_id, parent_id]
        parameters.extend(json.dumps(canonical(values.get(column)), ensure_ascii=False) if column == "metadata" else _db_value(column, values.get(column)) for column in fields)
        placeholders = ["%s::uuid"] + (["%s::uuid"] if parent_id is not None else [])
        placeholders.extend(self._json_placeholder(column) if column == "metadata" else ("%s::date" if column in DATE_FIELDS else "%s") for column in fields)
        self.connection.execute(
            f"insert into {table} ({', '.join(columns)}) values ({', '.join(placeholders)})",
            parameters,
        )

    def _update_canonical(self, table: str, row_id: str, fields: Sequence[str], values: Mapping[str, Any]) -> None:
        if not fields:
            return
        assignments = ", ".join(
            f"{field}={self._json_placeholder(field) if field == 'metadata' else ('%s::date' if field in DATE_FIELDS else '%s')}"
            for field in fields
        )
        parameters = [json.dumps(canonical(values.get(field)), ensure_ascii=False) if field == "metadata" else _db_value(field, values.get(field)) for field in fields]
        parameters.append(row_id)
        self.connection.execute(f"update {table} set {assignments} where id=%s::uuid", parameters)

    def apply(self, postimage: Mapping[str, Any]) -> None:
        for row in postimage["orders"]:
            if row["action"] == "insert":
                self._insert_canonical("plm.production_order", row["id"], None, IMPORTER.ORDER_COLUMNS, row["write_values"])
            elif row["action"] == "update":
                self._update_canonical("plm.production_order", row["id"], row["write_fields"], row["write_values"])
        for row in postimage["lines"]:
            if row["action"] == "insert":
                self._insert_canonical("plm.production_order_line", row["id"], row["production_order_id"], IMPORTER.LINE_COLUMNS, row["write_values"])
            elif row["action"] == "update":
                self._update_canonical("plm.production_order_line", row["id"], row["write_fields"], row["write_values"])
        for rows, table, fk in (
            (postimage["order_source_refs_insert"], "plm.production_order_source_ref", "production_order_id"),
            (postimage["line_source_refs_insert"], "plm.production_order_line_source_ref", "production_order_line_id"),
        ):
            for row in rows:
                self.connection.execute(
                    f"insert into {table} (id, {fk}, source_system, source_id, is_primary, metadata) "
                    "values (%s::uuid, %s::uuid, %s, %s, %s, %s::jsonb)",
                    (row["id"], row[fk], row["source_system"], row["source_id"], row["is_primary"], json.dumps(row["metadata"], ensure_ascii=False)),
                )

    def readback(self, postimage: Mapping[str, Any]) -> dict[str, Any]:
        header_ids = [row["id"] for row in postimage["orders"]]
        line_ids = [row["id"] for row in postimage["lines"]]
        header_sids = [row["source_id"] for row in postimage["orders"]]
        line_sids = [row["source_id"] for row in postimage["lines"]]
        all_order_ids = [row["id"] for row in postimage["orders"]]
        all_line_ids = [row["id"] for row in postimage["lines"]]
        return {
            "orders": [row[0] for row in self.connection.execute("select to_jsonb(t) from plm.production_order t where id=any(%s::uuid[]) order by id", (header_ids,)).fetchall()],
            "lines": [row[0] for row in self.connection.execute("select to_jsonb(t) from plm.production_order_line t where id=any(%s::uuid[]) order by id", (line_ids,)).fetchall()],
            "order_refs": [row[0] for row in self.connection.execute("select to_jsonb(t) from plm.production_order_source_ref t where source_system=%s and source_id=any(%s::text[]) order by source_id", (SOURCE_SYSTEM, header_sids)).fetchall()],
            "line_refs": [row[0] for row in self.connection.execute("select to_jsonb(t) from plm.production_order_line_source_ref t where source_system=%s and source_id=any(%s::text[]) order by source_id", (SOURCE_SYSTEM, line_sids)).fetchall()],
            "tracking": [row[0] for row in self.connection.execute("select to_jsonb(t) from dam.order_tracking_ext t where order_id=any(%s::uuid[]) order by order_id", (all_order_ids,)).fetchall()],
            "snapshots": [row[0] for row in self.connection.execute("select to_jsonb(t) from dam.production_order_snapshot t where production_order_line_id=any(%s::uuid[]) order by id", (all_line_ids,)).fetchall()],
        }


def _comparable(value: Any) -> Any:
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return ("number", value.normalize())
    if isinstance(value, float):
        return ("number", Decimal(str(value)).normalize())
    if isinstance(value, int) and not isinstance(value, bool):
        return ("number", Decimal(value).normalize())
    if isinstance(value, uuid.UUID):
        return str(value)
    if isinstance(value, Mapping):
        return {str(key): _comparable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_comparable(item) for item in value]
    return value


def validate_readback(postimage: Mapping[str, Any], readback: Mapping[str, Any]) -> None:
    if len(readback.get("orders", [])) != EXPECTED_HEADER_COUNT or len(readback.get("lines", [])) != EXPECTED_LINE_COUNT:
        raise ExecutorError("canonical row readback counts differ from the 76/296 scope")
    expected_ref_counts = (EXPECTED_HEADER_COUNT, EXPECTED_LINE_COUNT)
    if (len(readback.get("order_refs", [])), len(readback.get("line_refs", []))) != expected_ref_counts:
        raise ExecutorError("source-reference readback counts differ from the 76/296 scope")
    for kind in ("orders", "lines"):
        expected = {row["id"]: row["assert_fields"] for row in postimage[kind]}
        actual = {str(row.get("id")): row for row in readback[kind]}
        if set(actual) != set(expected):
            raise ExecutorError("canonical UUID readback set differs from the frozen postimage")
        for row_id, expected_fields in expected.items():
            actual_row = actual[row_id]
            for field, expected_value in expected_fields.items():
                if field in {"created_at", "updated_at"} and row_id not in {
                    r["id"] for r in postimage[kind] if r["action"] != "insert"
                }:
                    continue
                if _comparable_field(field, actual_row.get(field)) != _comparable_field(field, expected_value):
                    raise ExecutorError("canonical field readback differs from frozen postimage")
    for key, assertions in (("order_refs", postimage["order_source_ref_assertions"]), ("line_refs", postimage["line_source_ref_assertions"])):
        expected_ids = assertions
        actual_by_source = {row.get("source_id"): row for row in readback[key]}
        if len(actual_by_source) != len(readback[key]):
            raise ExecutorError("duplicate source-reference readback")
        # Existing refs are also in the readback; enforce exact one-to-one count and keys.
        total_sources = EXPECTED_HEADER_COUNT if key == "order_refs" else EXPECTED_LINE_COUNT
        all_source_ids = {row["source_id"] for row in postimage["orders" if key == "order_refs" else "lines"]}
        if len(actual_by_source) != total_sources or set(actual_by_source) != all_source_ids:
            raise ExecutorError("source-reference identities differ from the frozen postimage")
        for source_id, row in expected_ids.items():
            actual = actual_by_source[source_id]
            for field in row:
                if field in row and _comparable(actual.get(field)) != _comparable(row[field]):
                    raise ExecutorError("source-reference readback differs from frozen postimage")
    for key, assertions in (("tracking", postimage["tracking_assertions"]), ("snapshots", postimage["snapshot_assertions"])):
        actual = readback.get(key, [])
        expected_by_id = {
            str(row.get("order_id", row.get("id", row.get("production_order_line_id")))): row
            for row in assertions
        }
        actual_by_id = {
            str(row.get("order_id", row.get("id", row.get("production_order_line_id")))): row
            for row in actual
        }
        if len(actual_by_id) != len(actual) or set(actual_by_id) != set(expected_by_id):
            raise ExecutorError("tracking or snapshot readback differs from frozen preservation evidence")
        for key_id, expected_row in expected_by_id.items():
            actual_row = actual_by_id[key_id]
            if any(_comparable(actual_row.get(field)) != _comparable(value) for field, value in expected_row.items()):
                raise ExecutorError("tracking or snapshot readback differs from frozen preservation evidence")


def apply_transaction(gateway: Any, postimage: Mapping[str, Any], frozen_preimages: Mapping[str, Any]) -> None:
    gateway.connection.execute("set local lock_timeout='2s'")
    gateway.connection.execute("set local statement_timeout='8s'")
    try:
        gateway.lock(frozen_preimages)
        current = gateway.read_preimages()
        if PREFLIGHT.digest(current) != PREFLIGHT.digest(frozen_preimages):
            raise ExecutorError("live source preimages changed after review")
        require_guard_absent(gateway.guard_state())
        current_catalog = gateway.current_catalog_snapshot(postimage)
        if digest(current_catalog) != postimage.get("catalog_snapshot_sha256"):
            raise ExecutorError("bounded Item Master catalog snapshot changed after review")
        gateway.apply(postimage)
        readback = gateway.readback(postimage)
        validate_readback(postimage, readback)
        gateway.connection.commit()
    except Exception:
        gateway.connection.rollback()
        raise


def _safe_read_private(path: Path) -> bytes:
    nofollow = getattr(os, "O_NOFOLLOW", None)
    if nofollow is None:
        raise ExecutorError("filesystem lacks no-follow input support")
    fd = os.open(path, os.O_RDONLY | nofollow)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.geteuid() or stat.S_IMODE(info.st_mode) != 0o600:
            raise ExecutorError("frozen inputs must be owner-only regular files")
        with os.fdopen(fd, "rb") as handle:
            fd = -1
            return handle.read()
    finally:
        if fd >= 0:
            os.close(fd)


def _open_target(*, read_only: bool) -> tuple[Any, dict[str, Any]]:
    database_url = os.environ.get("PRODUCTION_DATABASE_URL")
    if not database_url:
        raise ExecutorError("protected production connection is unavailable")
    import psycopg

    conn = psycopg.connect(database_url, connect_timeout=15)
    try:
        conn.isolation_level = (
            psycopg.IsolationLevel.REPEATABLE_READ if read_only else psycopg.IsolationLevel.SERIALIZABLE
        )
        conn.read_only = read_only
        if read_only:
            conn.execute("set local statement_timeout='8s'")
            conn.execute("set local lock_timeout='2s'")
            identity = PREFLIGHT.proven_database_identity(conn)
        else:
            server_identity = IMPORTER.assert_server_is_target(
                conn, expected_ref=TARGET, mode=IMPORTER.MODE_PRODUCTION
            )
            identity = {
                "project_ref": getattr(server_identity, "project_ref", None),
                "host": getattr(server_identity, "host", None),
                "port": getattr(server_identity, "port", None),
                "database": getattr(server_identity, "database", None),
                "user": getattr(server_identity, "user", None),
                "fingerprint": getattr(server_identity, "fingerprint", None),
            }
            if any(value in (None, "") for value in identity.values()) or identity["project_ref"] != TARGET:
                raise ExecutorError("live target identity is incomplete or mismatched")
            PREFLIGHT.validate_database_identity(identity)
        return conn, identity
    except Exception:
        conn.close()
        raise


def _validate_approval_path(bundle_raw: bytes, report_path: Path, *, review_plan_sha: str, preimages_sha: str, preimages_semantic_sha: str, postimage_sha: str) -> None:
    try:
        bundle = json.loads(bundle_raw)
    except (json.JSONDecodeError, UnicodeDecodeError):
        raise ApplyBlocked("review approval bundle is invalid") from None
    if not isinstance(bundle, dict):
        raise ApplyBlocked("review approval bundle is invalid")
    require_review_approval(
        bundle,
        report_path=report_path,
        review_plan_sha256=review_plan_sha,
        preimages_file_sha256=preimages_sha,
        preimages_semantic_sha256=preimages_semantic_sha,
        postimage_sha256=postimage_sha,
    )


def run(args: argparse.Namespace) -> dict[str, Any]:
    plan_raw = _safe_read_private(args.review_plan)
    preimages_raw = _safe_read_private(args.source_preimages)
    plan_sha = PREFLIGHT._require_hash(args.expected_review_plan_sha256, "review_plan_sha256")
    preimages_sha = PREFLIGHT._require_hash(args.expected_preimages_file_sha256, "preimages_file_sha256")
    try:
        review_plan = json.loads(plan_raw)
        frozen_preimages = json.loads(preimages_raw)
    except (json.JSONDecodeError, UnicodeDecodeError):
        raise ExecutorError("frozen input JSON is invalid") from None
    if not isinstance(review_plan, dict) or not isinstance(frozen_preimages, dict):
        raise ExecutorError("frozen inputs must be JSON objects")
    scoped = _validate_review_plan(
        review_plan, frozen_preimages,
        expected_review_plan_sha256=plan_sha,
        expected_preimages_file_sha256=preimages_sha,
        review_plan_raw=plan_raw,
        preimages_raw=preimages_raw,
    )
    if args.apply:
        if not args.frozen_postimage:
            raise ApplyBlocked("the exact read-only frozen postimage is required")
        frozen_postimage_raw = _safe_read_private(args.frozen_postimage)
        try:
            saved_postimage = json.loads(frozen_postimage_raw)
        except (json.JSONDecodeError, UnicodeDecodeError):
            raise ExecutorError("frozen postimage JSON is invalid") from None
        if not isinstance(saved_postimage, dict):
            raise ExecutorError("frozen postimage must be a JSON object")
        saved_catalog = saved_postimage.get("catalog_snapshot")
        if not isinstance(saved_catalog, dict) or digest(saved_catalog) != saved_postimage.get("catalog_snapshot_sha256"):
            raise ExecutorError("frozen postimage catalog digest is invalid")
        review_plan["_exact_review_plan_sha256"] = plan_sha
        review_plan["_exact_preimages_file_sha256"] = preimages_sha
        recomputed = construct_postimage(review_plan, frozen_preimages, scoped, saved_catalog)
        if digest(recomputed) != digest(saved_postimage):
            raise ExecutorError("frozen postimage differs from the pinned plan and preimages")
        postimage = saved_postimage
    else:
        if args.catalog_snapshot:
            catalog_snapshot_raw = _safe_read_private(args.catalog_snapshot)
            try:
                catalog_snapshot = json.loads(catalog_snapshot_raw)
            except (json.JSONDecodeError, UnicodeDecodeError):
                raise ExecutorError("catalog snapshot JSON is invalid") from None
            if not isinstance(catalog_snapshot, dict):
                raise ExecutorError("catalog snapshot must be an object")
            if args.capture_catalog:
                raise ExecutorError("choose one bounded catalog snapshot source")
        elif args.capture_catalog:
            conn, identity = _open_target(read_only=True)
            try:
                if PREFLIGHT.digest(identity) != PREFLIGHT.digest(frozen_preimages.get("database_identity")):
                    raise ExecutorError("live Virginia database identity differs from the frozen preimage proof")
                current_preimages = PREFLIGHT.capture_preimages(conn, scoped)
                current_preimages["database_identity"] = identity
                if PREFLIGHT.digest(current_preimages) != PREFLIGHT.digest(frozen_preimages):
                    raise ExecutorError("live source preimages changed before bounded catalog capture")
                catalog_snapshot = build_catalog_snapshot(
                    conn, scoped["lines"], frozen_preimages,
                    _resolve_line_uuid_map(frozen_preimages, scoped),
                )
                catalog_snapshot["po_reuse_guard_state"] = _known_guard_state(conn)
            finally:
                conn.close()
        else:
            raise ApplyBlocked("read-only bounded catalog capture or an exact frozen catalog snapshot is required")
        catalog_snapshot_raw = json.dumps(catalog_snapshot, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()
        review_plan, frozen_preimages, postimage = build_frozen_postimage(
            plan_raw,
            preimages_raw,
            catalog_snapshot_raw,
            expected_review_plan_sha256=plan_sha,
            expected_preimages_file_sha256=preimages_sha,
        )
    postimage_sha = digest(postimage)
    output_dir_fd = PREFLIGHT.open_private_directory(args.output_dir)
    os.close(output_dir_fd)
    if args.apply:
        if not args.reviewer_bundle or not args.reviewer_report:
            raise ApplyBlocked("exact independent reviewer evidence is required before database apply")
        bundle_raw = _safe_read_private(args.reviewer_bundle)
        _validate_approval_path(
            bundle_raw,
            args.reviewer_report,
            review_plan_sha=plan_sha,
            preimages_sha=preimages_sha,
            preimages_semantic_sha=review_plan["preimages_sha256"],
            postimage_sha=postimage_sha,
        )
        check_task_gate(args.reviewer_report)
        conn, identity = _open_target(read_only=False)
        try:
            if PREFLIGHT.digest(identity) != PREFLIGHT.digest(frozen_preimages.get("database_identity")):
                raise ExecutorError("live Virginia database identity differs from the frozen preimage proof")
            scoped = {
                "orders": review_plan["desired_orders"],
                "lines": review_plan["desired_lines"],
                "line_source_id_aliases": _line_source_aliases(review_plan["desired_lines"]),
            }
            gateway = PostgresExecutorGateway(conn, identity, scoped)
            apply_transaction(gateway, postimage, frozen_preimages)
        finally:
            conn.close()
        result = {
            "mode": "applied_with_readback",
            "target": TARGET,
            "review_plan_sha256": plan_sha,
            "preimages_file_sha256": preimages_sha,
            "postimage_sha256": postimage_sha,
            "counts": postimage["counts"],
            "apply_enabled": True,
        }
    else:
        PREFLIGHT.private_write(args.output_dir / "exception-postimage.json", postimage)
        result = {
            "mode": "offline-dry-run",
            "target": TARGET,
            "review_plan_sha256": plan_sha,
            "preimages_file_sha256": preimages_sha,
            "postimage_sha256": postimage_sha,
            "counts": postimage["counts"],
            "apply_enabled": False,
            "private_artifacts_written": 1,
            "catalog_resolution_counts": postimage["catalog_resolution_counts"],
        }
    return result


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--review-plan", type=Path, required=True)
    parser.add_argument("--source-preimages", type=Path, required=True)
    parser.add_argument("--expected-review-plan-sha256", required=True)
    parser.add_argument("--expected-preimages-file-sha256", required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--catalog-snapshot", type=Path, help="Previously captured, exact bounded catalog snapshot")
    parser.add_argument("--capture-catalog", action="store_true", help="Read the proven target for exact bounded catalog rows")
    parser.add_argument("--frozen-postimage", type=Path, help="Exact postimage from the reviewed read-only capture")
    parser.add_argument("--reviewer-bundle", type=Path)
    parser.add_argument("--reviewer-report", type=Path)
    parser.add_argument("--apply", action="store_true", help="Apply only after exact independent review and task gate")
    return parser


def _error_code(error: BaseException) -> str:
    if isinstance(error, AdmissionRequired):
        return "historical_po_admission_required"
    if isinstance(error, ApplyBlocked):
        return "review_or_task_gate_required"
    if isinstance(error, ExecutorError):
        return "frozen_executor_precondition_failed"
    if isinstance(error, OSError):
        return "private_io_failed"
    return "settled_exception_executor_failed"


def main() -> int:
    os.umask(0o077)
    args = _parser().parse_args()
    try:
        result = run(args)
    except AdmissionRequired as error:
        print(json.dumps({"error_code": _error_code(error), "apply_enabled": False}), file=sys.stderr)
        return 3
    except Exception as error:
        print(json.dumps({"error_code": _error_code(error), "apply_enabled": False}), file=sys.stderr)
        return 2
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":  # pragma: no cover - CLI wrapper
    raise SystemExit(main())
