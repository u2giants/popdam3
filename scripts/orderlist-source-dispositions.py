#!/usr/bin/env python3
"""Row-bound planning for the returned #277 OrderList decisions.

Importing this module loads the fixed, bundled canonical OrderList importer source
file. Planning does not read a source workbook, access a database/network, or apply
a plan. Callers must pass the exact protected specification bytes and expected
provenance hashes.
"""

from __future__ import annotations

import hashlib
import importlib.util
import json
import math
import re
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass, field, replace
from datetime import date
from pathlib import Path
from typing import Any, Mapping, Sequence


_IMPORTER_PATH = (
    Path(__file__).resolve().parents[1]
    / "shared-db"
    / "scripts"
    / "import-order-list-xlsx.py"
)
_IMPORTER_SPEC = importlib.util.spec_from_file_location(
    "_popdam_order_list_importer", _IMPORTER_PATH
)
if _IMPORTER_SPEC is None or _IMPORTER_SPEC.loader is None:  # pragma: no cover
    raise RuntimeError("canonical OrderList importer could not be loaded")
IMPORTER = importlib.util.module_from_spec(_IMPORTER_SPEC)
sys.modules[_IMPORTER_SPEC.name] = IMPORTER
_IMPORTER_SPEC.loader.exec_module(IMPORTER)


REQUIRED_SOURCE_HASHES = frozenset(
    {
        "source_answer_resolution_packet_sha256",
        "returned_workbook_sha256",
        "latest_google_capture_sha256",
    }
)
EXPECTED_CASE_COUNTS = {
    ("Conflicting orders", "Use corrected values in notes"): 12,
    ("Rows needing correction", "Corrected per-style list in notes"): 27,
    ("Rows needing correction", "Single product — give Style# in notes"): 3,
    ("Rows needing correction", "Unused row — skip it"): 7,
    ("Rows needing correction", "Assortment — list included styles in notes"): 21,
    ("Other source warnings", "Use corrected value in notes"): 2,
    ("Other source warnings", "Keep original text as written"): 3,
}
IDENTITY_COLUMNS = ("A", "C", "H", "K", "L", "N")
PER_COMPONENT_COLUMNS = frozenset({"AM", "AT", "T", "AF", "AG"})
HEADER_STATUS_COLUMNS = frozenset(IMPORTER.HEADER_IDENTITY_COLUMNS)
_BLANK_MARKERS = frozenset({"", "[blank]", "blank"})


@dataclass
class DispositionImportPlan(IMPORTER.ImportPlan):
    """An ImportPlan plus safe ledgers that the canonical importer lacks."""

    skipped_rows: list[dict[str, Any]] = field(default_factory=list)
    unresolved_fields: list[dict[str, Any]] = field(default_factory=list)
    resolved_source_warnings: list[dict[str, Any]] = field(default_factory=list)
    source_disposition_counts: dict[str, int] = field(default_factory=dict)
    provenance: dict[str, Any] = field(default_factory=dict)


class DispositionError(ValueError):
    """The specification or current source does not match the approved preimage."""


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _json_bytes(value: Any) -> bytes:
    return json.dumps(
        value, ensure_ascii=False, separators=(",", ":"), default=str
    ).encode("utf-8")


def _row_hash(row: Any) -> str:
    values = list(row.values)
    for index, value in enumerate(values):
        if value is None or isinstance(value, (str, bool, int)):
            continue
        if isinstance(value, float) and math.isfinite(value):
            continue
        raise DispositionError(
            f"Google row {row.sheet_row} column {IMPORTER.column_letter(index)} "
            "is not a supported JSON primitive"
        )
    encoded = json.dumps(values, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    return _sha256(encoded.encode("utf-8"))


def _raw_cell(row: Any, column: str) -> Any:
    return row.cell(column)


def _raw_text(row: Any, column: str) -> str | None:
    return IMPORTER.raw_text(_raw_cell(row, column))


def _source_row_snapshot(row: Any) -> dict[str, Any]:
    return {
        IMPORTER.column_letter(i): value
        for i, value in enumerate(row.values[: IMPORTER.EXPECTED_COLUMN_COUNT])
    }


def _replace_cells(row: Any, edits: Mapping[str, Any]) -> Any:
    values = list(row.values)
    for column, value in edits.items():
        if column not in {"D", "E", "P", "AR", *PER_COMPONENT_COLUMNS}:
            raise DispositionError(f"source column {column!r} is outside the override whitelist")
        index = IMPORTER.column_index(column)
        if index >= len(values):
            raise DispositionError(f"source row {row.sheet_row} is shorter than column {column}")
        values[index] = value
    return IMPORTER.SourceRow(sheet_row=row.sheet_row, values=tuple(values))


def _case_id(case: Mapping[str, Any]) -> tuple[str, int]:
    return str(case["workbook_section"]), int(case["workbook_sheet_row"])


def _rows_in_case(case: Mapping[str, Any]) -> list[int]:
    return [int(entry["source"]["sheet_row"]) for entry in case.get("source_rows", [])]


def _group_identity(row: Any) -> tuple[Any, ...]:
    """Business boundary: status/customer/vendor/type/customer PO plus normalized B.

    Google Company I is intentionally excluded for these approved source rows. The
    source's physical column D is a header payload and is not part of this key.
    """
    return (
        *(_raw_text(row, col) for col in IDENTITY_COLUMNS),
        IMPORTER.normalize_po_number(_raw_cell(row, "B")),
    )


def _opaque_group_source_id(original_id: str, identity: tuple[Any, ...]) -> str:
    suffix = _sha256(_json_bytes([original_id, identity]))[:20]
    normalized_po = identity[-1]
    prefix = f"order:po:{normalized_po}" if normalized_po else "order:row"
    return f"{prefix}:group:{suffix}"


def _exact_component_overrides(instruction: Mapping[str, Any], row: Any) -> dict[str, str]:
    target = str(instruction.get("target_column", ""))
    if target not in PER_COMPONENT_COLUMNS:
        raise DispositionError(f"unsupported per-component target column {target!r}")
    components = IMPORTER.split_aligned(_raw_cell(row, "AR"))
    component_skus = [component for component in components if component is not None]
    # A correction may repair an aligned field, but it cannot silently manufacture
    # component identities or change their order.
    if len(component_skus) != len(components) or not component_skus:
        raise DispositionError(f"row {row.sheet_row} has blank or missing AR component identities")
    normalized = [IMPORTER.normalize_sku(sku) for sku in component_skus]
    if len(set(normalized)) != len(normalized):
        raise DispositionError(f"row {row.sheet_row} has duplicate AR component identities")
    mapping: dict[str, Any] = {}
    for entry in instruction.get("component_values_in_exact_note_order", []):
        sku = entry.get("component_sku_exact")
        if not isinstance(sku, str) or not sku.strip():
            raise DispositionError(f"row {row.sheet_row} contains a blank note component key")
        key = IMPORTER.normalize_sku(sku)
        if key in mapping:
            raise DispositionError(f"row {row.sheet_row} repeats a note component key")
        if entry.get("target_column") != target:
            raise DispositionError(f"row {row.sheet_row} contains a cross-column note override")
        value = entry.get("exact_corrected_value")
        if value is None or (isinstance(value, str) and value.strip().casefold() in _BLANK_MARKERS):
            value = None
        if value is not None and ("\n" in str(value) or "\r" in str(value)):
            raise DispositionError(f"row {row.sheet_row} has a multiline value inside one component override")
        mapping[key] = value
    if set(mapping) != set(normalized):
        raise DispositionError(f"row {row.sheet_row} note component keys do not match the exact AR identities")
    ordered_values = [mapping[key] for key in normalized]
    # Empty positions are represented by adjacent separators; the canonical parser
    # turns each blank component value into None without shifting later values.
    return {target: "\n".join("" if value is None else str(value) for value in ordered_values)}


def _validate_spec(
    spec_bytes: bytes,
    expected_spec_sha256: str,
    expected_source_hashes: Mapping[str, str],
) -> tuple[dict[str, Any], str]:
    actual_spec_sha256 = _sha256(spec_bytes)
    if actual_spec_sha256 != expected_spec_sha256:
        raise DispositionError("disposition spec SHA-256 does not match the reviewed expected hash")
    try:
        spec = json.loads(spec_bytes)
    except (json.JSONDecodeError, UnicodeDecodeError) as error:
        raise DispositionError("disposition spec is not valid UTF-8 JSON") from error
    if not isinstance(spec, dict) or spec.get("artifact_type") != "protected_issue277_yuchen_answer_disposition_spec":
        raise DispositionError("unexpected disposition spec type")
    if set(expected_source_hashes) != REQUIRED_SOURCE_HASHES:
        raise DispositionError("all three exact source provenance hashes are required")
    for key in REQUIRED_SOURCE_HASHES:
        if spec.get(key) != expected_source_hashes[key]:
            raise DispositionError(f"source provenance hash mismatch for {key}")
        value = expected_source_hashes[key]
        if not isinstance(value, str) or not re.fullmatch(r"[0-9a-f]{64}", value):
            raise DispositionError(f"source provenance hash is malformed for {key}")
    cases = spec.get("cases")
    if not isinstance(cases, list) or len(cases) != 75:
        raise DispositionError("the exact 75-case answer set is required")
    counts = Counter((str(c.get("workbook_section")), str(c.get("decision_exact"))) for c in cases)
    if dict(counts) != EXPECTED_CASE_COUNTS:
        raise DispositionError("answer case categories do not match the approved 75-case set")
    identities = [_case_id(case) for case in cases]
    if len(set(identities)) != 75:
        raise DispositionError("answer workbook case identities are duplicated")
    if spec.get("issues"):
        raise DispositionError("disposition spec contains unresolved extraction issues")
    return spec, actual_spec_sha256


def _instruction(case: Mapping[str, Any], kind: str) -> Mapping[str, Any]:
    matches = [i for i in case.get("instructions", []) if i.get("kind") == kind]
    if len(matches) != 1:
        raise DispositionError(f"case {_case_id(case)!r} must have exactly one {kind!r} instruction")
    return matches[0]


def _source_refs_by_row(cases: Sequence[Mapping[str, Any]]) -> dict[int, tuple[Mapping[str, Any], Mapping[str, Any]]]:
    result: dict[int, tuple[Mapping[str, Any], Mapping[str, Any]]] = {}
    for case in cases:
        for bound in case.get("source_rows", []):
            source = bound.get("source", {})
            if source.get("spreadsheet_id") != IMPORTER.SOURCE_SPREADSHEET_ID or source.get("tab") != IMPORTER.SOURCE_TAB_NAME or source.get("gid") != IMPORTER.SOURCE_TAB_GID:
                raise DispositionError("source row binding does not identify the canonical Google Order tab")
            rownum = int(source["sheet_row"])
            if rownum in result:
                raise DispositionError(f"Google source row {rownum} is bound to more than one answer case")
            digest = bound.get("current_preimage_sha256")
            if not isinstance(digest, str) or not re.fullmatch(r"[0-9a-f]{64}", digest):
                raise DispositionError(f"Google source row {rownum} has no valid preimage hash")
            result[rownum] = (case, bound)
    return result


def _original_source_metadata(
    row: Any,
    case: Mapping[str, Any],
    original_header_source_id: str,
    group_source_id: str,
    spec_sha256: str,
    edits: Mapping[str, Any],
) -> dict[str, Any]:
    return {
        "spec_sha256": spec_sha256,
        "case_id": f"{case['workbook_section']}:{case['workbook_sheet_row']}",
        "decision_exact": case["decision_exact"],
        "notes_exact": case.get("notes_exact"),
        "source_row": row.sheet_row,
        "source_preimage_sha256": _row_hash(row),
        "source_column_overrides": dict(edits),
        "source_row_snapshot_exact": _source_row_snapshot(row),
        "original_normalized_header_source_id": original_header_source_id,
        "desired_internal_header_source_id": group_source_id,
    }


def _append_line_provenance(
    line: Any,
    original_row: Any,
    case: Mapping[str, Any],
    header_source_id: str,
    spec_sha256: str,
    edits: Mapping[str, Any],
) -> None:
    disposition = _original_source_metadata(
        original_row,
        case,
        IMPORTER.header_source_id(IMPORTER.normalize_po_number(_raw_cell(original_row, "B")), original_row.sheet_row),
        header_source_id,
        spec_sha256,
        edits,
    )
    line.metadata.setdefault("source_disposition", {}).update(disposition)


def _blank_approved_company_column(row: Any) -> Any:
    values = list(row.values)
    values[IMPORTER.column_index("I")] = None
    return IMPORTER.SourceRow(sheet_row=row.sheet_row, values=tuple(values))


def _make_parent_only_line(
    row: Any,
    order_sid: str,
    catalog: Any,
    plan: Any,
    unresolved_fields: list[dict[str, Any]],
) -> Any:
    if _raw_cell(row, "P") not in (None, "") or _raw_cell(row, "AR") not in (None, ""):
        raise DispositionError(f"parent-only row {row.sheet_row} also contains a product/component identifier")
    if IMPORTER.normalize_text(_raw_cell(row, "O")) is None:
        raise DispositionError(f"parent-only row {row.sheet_row} has no exact Assortment ID")
    line = IMPORTER._plan_direct_line(row, order_sid, catalog, plan)
    line.payload["sku"] = None
    line.payload["item_id"] = None
    quantity, quantity_raw = IMPORTER.parse_number(_raw_cell(row, "U"))
    line.payload["quantity_ordered"] = quantity
    if quantity is None:
        unresolved_fields.append(
            {
                "source_row": row.sheet_row,
                "source_column": "U",
                "status": "parent_quantity_missing_or_unparseable_preserved_unknown",
                "raw_value": _raw_cell(row, "U"),
                "parsed_raw_value": quantity_raw,
                "source_preimage_sha256": _row_hash(row),
            }
        )
    line.payload["assortment_component_ordinal"] = None
    line.payload["assortment_id"] = row.text("O")
    line.metadata.setdefault("source_disposition", {}).update(
        {
            "parent_only_assortment": True,
            "child_creation": False,
            "component_quantity": None,
            "parent_quantity_source_column": "U",
            "no_child_quantity_inference": True,
        }
    )
    return line


def _plan_per_style_components(
    original_row: Any,
    amended_row: Any,
    case: Mapping[str, Any],
    order_sid: str,
    catalog: Any,
    plan: Any,
    spec_sha256: str,
    edits: Mapping[str, Any],
) -> list[Any]:
    """Use canonical component parsing while keeping explicit blank edge slots.

    The canonical split helper strips leading/trailing newlines from a cell. For a
    corrected per-style field, parse the other source arrays with that target cleared,
    then apply the exact note values by normalized SKU in the original AR order.
    """
    instruction = _instruction(case, "row_bound_per_component_field_override")
    target = instruction["target_column"]
    parsing_row = _replace_cells(amended_row, {target: None})
    split = IMPORTER.split_assortment(parsing_row)
    if split.rejected:
        raise DispositionError(
            f"approved per-style row {original_row.sheet_row} has misaligned remaining "
            f"component fields after {target} override: counts={dict(split.counts)}"
        )

    values_by_sku: dict[str, str | None] = {}
    for entry in instruction["component_values_in_exact_note_order"]:
        sku = entry.get("component_sku_exact")
        if not isinstance(sku, str) or not sku.strip():
            raise DispositionError(f"row {original_row.sheet_row} contains a blank note component key")
        key = IMPORTER.normalize_sku(sku)
        if not key or key in values_by_sku:
            raise DispositionError(f"row {original_row.sheet_row} contains a blank or duplicate note component key")
        if entry.get("target_column") != target:
            raise DispositionError(f"row {original_row.sheet_row} contains a cross-column note override")
        value = entry.get("exact_corrected_value")
        if value is None or (isinstance(value, str) and value.strip().casefold() in _BLANK_MARKERS):
            values_by_sku[key] = None
        else:
            values_by_sku[key] = str(value)
    component_keys = [IMPORTER.normalize_sku(component.sku) for component in split.components]
    if any(not key for key in component_keys) or len(set(component_keys)) != len(component_keys):
        raise DispositionError(f"row {original_row.sheet_row} has blank or duplicate parsed component identities")
    if set(values_by_sku) != set(component_keys):
        raise DispositionError(f"row {original_row.sheet_row} note component keys do not match parsed component identities")
    planned = []
    for component in split.components:
        key = IMPORTER.normalize_sku(component.sku)
        if key not in values_by_sku:
            raise DispositionError(f"component SKU changed while planning row {original_row.sheet_row}")
        corrected = values_by_sku[key]
        if target == "AM":
            component = replace(component, style_type=IMPORTER.normalize_style_type(corrected))
        elif target == "AT":
            component = replace(component, description=corrected)
        elif target == "T":
            component = replace(component, license_status=corrected)
        elif target == "AF":
            component = replace(component, test_report=corrected)
        elif target == "AG":
            component = replace(component, professional_photos=corrected)
        line = IMPORTER._plan_component_line(parsing_row, component, order_sid, catalog, plan)
        _append_line_provenance(line, original_row, case, order_sid, spec_sha256, edits)
        planned.append(line)
    return planned


def _plan_verified_assortment_components(
    original_row: Any,
    amended_row: Any,
    case: Mapping[str, Any],
    order_sid: str,
    catalog: Any,
    plan: Any,
    spec_sha256: str,
    edits: Mapping[str, Any],
) -> list[Any]:
    """Plan only the explicitly verified SKU list; keep other arrays unassigned."""
    instruction = _instruction(
        case, "assortment_components_from_explicit_note_and_verified_assortment_source"
    )
    verified_source = instruction.get("verified_source", {})
    if verified_source.get("tab") != "Assort.List" or int(verified_source.get("row", -1)) != 1326:
        raise DispositionError(f"verified assortment evidence changed for row {original_row.sheet_row}")
    if instruction.get("assortment_id_column") != "O" or instruction.get("assortment_id_exact") != _raw_text(original_row, "O"):
        raise DispositionError(f"verified assortment identity changed for row {original_row.sheet_row}")
    skus = instruction.get("component_skus_exact")
    if not isinstance(skus, list) or len(skus) != 4 or any(not isinstance(sku, str) or not sku.strip() for sku in skus):
        raise DispositionError(f"verified assortment row {original_row.sheet_row} must bind four exact SKU values")
    if [IMPORTER.normalize_sku(x) for x in IMPORTER.split_aligned(_raw_cell(amended_row, "AR"))] != [IMPORTER.normalize_sku(x) for x in skus]:
        raise DispositionError(f"verified assortment component order changed for row {original_row.sheet_row}")

    # No note authorizes assigning these optional arrays by position. Keep every raw
    # cell in metadata, but clear the parser clone so a mismatched Product Description
    # list cannot block the four independently verified component identities.
    unmapped_columns = ("AM", "AT", "T", "AF", "AG")
    parsing_row = _replace_cells(amended_row, {column: None for column in unmapped_columns})
    split = IMPORTER.split_assortment(parsing_row)
    if split.rejected or len(split.components) != 4:
        raise DispositionError(f"verified assortment row {original_row.sheet_row} failed exact four-SKU parsing")
    planned = []
    for component in split.components:
        line = IMPORTER._plan_component_line(parsing_row, component, order_sid, catalog, plan)
        _append_line_provenance(line, original_row, case, order_sid, spec_sha256, edits)
        line.metadata["source_disposition"].update(
            {
                "verified_assortment_source": dict(verified_source),
                "unmapped_component_source_fields_by_column": {
                    column: _raw_cell(original_row, column) for column in unmapped_columns
                },
                "unmapped_component_source_fields_status": "preserved_raw_unassigned_no_positional_mapping",
                "component_quantity": None,
                "component_quantity_not_inferred": True,
            }
        )
        planned.append(line)
    return planned


def _row_case_actions(case: Mapping[str, Any], row: Any) -> tuple[dict[str, Any], bool, bool]:
    """Return (whitelisted edits, skip, explicit direct-line override)."""
    section, decision = case["workbook_section"], case["decision_exact"]
    if section == "Conflicting orders":
        _instruction(case, "split_internal_source_groups_without_business_field_edits")
        return {}, False, False
    if section == "Rows needing correction" and decision == "Corrected per-style list in notes":
        kind = next((x.get("kind") for x in case.get("instructions", [])), None)
        if kind == "row_bound_per_component_field_override":
            ins = _instruction(case, kind)
            if int(ins.get("source_sheet_row", -1)) != row.sheet_row:
                raise DispositionError(f"case {_case_id(case)!r} override row does not match its source binding")
            return _exact_component_overrides(ins, row), False, False
        if kind == "explicit_style_value_current_compatible":
            ins = _instruction(case, kind)
            exact = ins.get("exact_note_style_value")
            if not isinstance(exact, str) or IMPORTER.normalize_sku(exact) != IMPORTER.normalize_sku(_raw_cell(row, "P")):
                raise DispositionError(f"current-compatible style value changed on row {row.sheet_row}")
            return {}, False, True
        raise DispositionError(f"case {_case_id(case)!r} has unsupported per-style correction instruction")
    if section == "Rows needing correction" and decision == "Single product — give Style# in notes":
        ins = _instruction(case, "direct_style_assignment_from_exact_note")
        if int(ins.get("source_sheet_row", -1)) != row.sheet_row:
            raise DispositionError(f"single-style assignment is bound to a different source row")
        style = ins.get("exact_style_value_current_source")
        if not isinstance(style, str) or IMPORTER.normalize_sku(style) != IMPORTER.normalize_sku(_raw_cell(row, "P")):
            raise DispositionError(f"single-style note is no longer current-compatible on row {row.sheet_row}")
        return {}, False, True
    if section == "Rows needing correction" and decision == "Unused row — skip it":
        _instruction(case, "exclude_source_row_from_import")
        return {}, True, False
    if section == "Rows needing correction" and decision == "Assortment — list included styles in notes":
        ins = next((x for x in case.get("instructions", []) if x.get("kind") in {"assortment_components_from_explicit_note_and_verified_assortment_source", "parent_only_assortment_no_child_creation"}), None)
        if ins is None or int(ins.get("source_sheet_row", -1)) != row.sheet_row:
            raise DispositionError(f"assortment instruction is not bound to row {row.sheet_row}")
        if ins["kind"] == "assortment_components_from_explicit_note_and_verified_assortment_source":
            styles = ins.get("component_skus_exact")
            if not isinstance(styles, list) or len(styles) != 4 or any(not isinstance(x, str) or not x for x in styles):
                raise DispositionError(f"verified four-style row {row.sheet_row} no longer has four exact styles")
            if IMPORTER.normalize_text(_raw_cell(row, "O")) != ins.get("assortment_id_exact"):
                raise DispositionError(f"assortment ID changed on row {row.sheet_row}")
            if ins.get("verified_source", {}).get("tab") != "Assort.List" or int(ins.get("verified_source", {}).get("row", -1)) != 1326:
                raise DispositionError(f"assortment source evidence changed on row {row.sheet_row}")
            return {"AR": "\n".join(styles)}, False, False
        if IMPORTER.normalize_text(_raw_cell(row, "O")) != ins.get("assortment_id_exact"):
            raise DispositionError(f"parent-only assortment ID changed on row {row.sheet_row}")
        if _raw_cell(row, "P") not in (None, "") or _raw_cell(row, "AR") not in (None, ""):
            raise DispositionError(f"parent-only assortment row {row.sheet_row} is no longer parent-only")
        return {}, False, False
    if section == "Other source warnings":
        if decision == "Use corrected value in notes":
            ins = _instruction(case, "use_latest_exact_source_cells_as_decided")
        elif decision == "Keep original text as written":
            ins = _instruction(case, "preserve_latest_source_text_without_normalization")
        else:
            raise DispositionError(f"unsupported warning decision in case {_case_id(case)!r}")
        fields = ins.get("explicit_target_fields", {})
        target_column = str(fields.get("Column", ""))
        allowed_columns = {"D", "E"} if decision == "Use corrected value in notes" else {"D", "E", "AD"}
        bound_rows = sorted(_rows_in_case(case))
        instruction_rows = sorted(int(value) for value in ins.get("source_sheet_rows", []))
        if instruction_rows != bound_rows or target_column not in allowed_columns:
            raise DispositionError(f"warning instruction scope does not match its bound source rows in {_case_id(case)!r}")
        evidence_rows: list[int] = []
        for diff in ins.get("changed_cell_evidence", []):
            if not isinstance(diff, dict):
                raise DispositionError(f"warning evidence is malformed in {_case_id(case)!r}")
            evidence_row = int(diff.get("row", -1))
            if evidence_row not in bound_rows or diff.get("source_column") != target_column:
                raise DispositionError(f"warning evidence falls outside its approved row/column in {_case_id(case)!r}")
            if evidence_row == row.sheet_row and _raw_text(row, target_column) != str(diff.get("current_native_value")):
                raise DispositionError(f"warning current value no longer matches its bound evidence on row {row.sheet_row}")
            evidence_rows.append(evidence_row)
        if evidence_rows and sorted(evidence_rows) != bound_rows:
            raise DispositionError(f"warning evidence does not cover every bound row in {_case_id(case)!r}")
        if decision == "Use corrected value in notes":
            notes = fields.get("Yuchen’s notes / corrected values", "")
            if target_column == "E":
                match = re.match(
                    r"^Order E \(Sent PO Date\): use (\d{4}-\d{2}-\d{2}) for rows ([0-9,]+)\.\n",
                    notes,
                )
                exact_note = (
                    match is not None
                    and [int(x) for x in match.group(2).split(",")] == bound_rows
                    and "representation difference, not a conflicting business date" in notes
                )
            elif target_column == "D":
                match = re.fullmatch(r"(\d{4}-\d{2}-\d{2}) 00:00:00", notes)
                evidence = ins.get("changed_cell_evidence", [])
                exact_note = (
                    match is not None
                    and sorted(int(item.get("row", -1)) for item in evidence) == bound_rows
                    and all(item.get("source_column") == "D" for item in evidence)
                )
            else:
                match = None
                exact_note = False
            if match is None or not exact_note:
                raise DispositionError(f"typed date correction lacks an exact row-bound representation note in {_case_id(case)!r}")
            try:
                corrected_date = date.fromisoformat(match.group(1))
            except ValueError as error:
                raise DispositionError(f"typed date correction is invalid in {_case_id(case)!r}") from error
            return {target_column: corrected_date}, False, False
        # The corrected answers already agree with the latest Google preimage; keep
        # every raw cell as captured and let the canonical parser's typed/raw rules run.
        return {}, False, False
    raise DispositionError(f"unsupported answer case {_case_id(case)!r}")


def _is_expected_custom_parser_rejection(
    rejected: Any,
    row_number: int,
    parent_only_rows: set[int],
    direct_override_rows: set[int],
    per_style_rows: set[int],
    verified_assortment_rows: set[int],
) -> bool:
    """Only suppress the canonical rejection explicitly displaced by an answer."""
    if row_number in parent_only_rows:
        return (
            rejected.shape == IMPORTER.ROW_SHAPE_NEITHER
            and rejected.reason == "no_sku_and_no_assortment"
        ) or (
            rejected.shape == IMPORTER.ROW_SHAPE_ASSORTMENT
            and rejected.reason == "assortment_structurally_invalid:no_component_skus"
        )
    if row_number in direct_override_rows:
        return rejected.shape == IMPORTER.ROW_SHAPE_BOTH and rejected.reason == "both_shapes_pending_review"
    if row_number in per_style_rows:
        return (
            rejected.shape == IMPORTER.ROW_SHAPE_BOTH
            and rejected.reason == "both_shapes_pending_review"
        ) or (
            rejected.shape == IMPORTER.ROW_SHAPE_ASSORTMENT
            and rejected.reason.startswith("assortment_structurally_invalid:")
        )
    if row_number in verified_assortment_rows:
        return (
            rejected.shape == IMPORTER.ROW_SHAPE_ASSORTMENT
            and rejected.reason.startswith("assortment_structurally_invalid:")
        )
    return False


def _derive_actionable_counters(
    plan: DispositionImportPlan,
    rows_by_number: Mapping[int, Any],
) -> dict[str, int]:
    """Count only final plan objects and scoped ledgers, never raw subplan tallies."""
    skipped_rows = {int(item["source_row"]) for item in plan.skipped_rows}
    active_rows = {row_number for row_number in rows_by_number if row_number not in skipped_rows}
    nonblank_po = {
        po
        for row_number in active_rows
        if (po := IMPORTER.normalize_po_number(_raw_cell(rows_by_number[row_number], "B")))
    }
    counters: Counter[str] = Counter(
        {
            "staged_rows": len(active_rows),
            "source_rows_bound": len(rows_by_number),
            "source_rows_skipped": len(skipped_rows),
            "blank_po_rows": sum(
                1 for item in plan.unresolved_fields
                if item.get("source_column") == "B"
                and item.get("status") == "blank_import_PO_no_business_number_invented"
            ),
            "normalized_po_numbers": len(nonblank_po),
            "planned_orders": len(plan.orders),
            "planned_lines": len(plan.lines),
            "desired_orders": len(plan.orders),
            "desired_lines": len(plan.lines),
            "rejected_rows": len(plan.rejected_rows),
            "unresolved_fields": len(plan.unresolved_fields),
            "quarantined_orders": sum(1 for order in plan.orders if order.quarantined),
            "quarantined_rows": sum(len(order.sheet_rows) for order in plan.orders if order.quarantined),
            "header_field_conflicts": sum(
                1 for item in plan.unresolved_fields
                if item.get("status") == "conflicting_header_value_left_unset"
            ),
            "invalid_header_values": sum(
                len(order.metadata.get("invalid_header_values", {})) for order in plan.orders
            ),
            "invalid_header_dates": sum(
                1
                for order in plan.orders
                for column in order.metadata.get("invalid_header_values", {})
                if column in {
                    IMPORTER.COL_SEAL_CONTAINER_DAY,
                    IMPORTER.COL_SENT_PO_DATE,
                    IMPORTER.COL_VENDOR_DELIVERY,
                    IMPORTER.COL_ETD,
                    IMPORTER.COL_ETA,
                    IMPORTER.COL_WAREHOUSE_DAY,
                }
            ),
            "assortment_components": sum(1 for line in plan.lines if line.ordinal is not None),
            "structurally_invalid_assortment_rows": sum(
                1 for item in plan.rejected_rows
                if item.reason.startswith("assortment_structurally_invalid")
            ),
            "rows_direct": len({
                line.sheet_row for line in plan.lines if line.ordinal is None and line.payload.get("sku")
            } | {
                item.sheet_row for item in plan.rejected_rows
                if item.shape == IMPORTER.ROW_SHAPE_DIRECT
            }),
            "rows_assortment": len({
                line.sheet_row for line in plan.lines if line.ordinal is not None
            } | {
                item.sheet_row for item in plan.rejected_rows
                if item.shape == IMPORTER.ROW_SHAPE_ASSORTMENT
            }),
            "rows_both": len({
                item.sheet_row for item in plan.rejected_rows
                if item.shape == IMPORTER.ROW_SHAPE_BOTH
            }),
            "rows_parent_only": len({
                line.sheet_row for line in plan.lines
                if line.metadata.get("source_disposition", {}).get("parent_only_assortment")
            }),
        }
    )
    for line in plan.lines:
        match_status = line.payload.get("master_data_match_status")
        if match_status:
            counters[f"match_{match_status}"] += 1
        resolution = line.metadata.get("master_data_resolution")
        if resolution:
            counters[f"resolution_{resolution}"] += 1
    return dict(counters)


def build_source_disposition_plan(
    source_rows: Sequence[Any],
    spec_bytes: bytes,
    *,
    expected_spec_sha256: str,
    expected_source_hashes: Mapping[str, str],
    catalog: Any | None = None,
) -> DispositionImportPlan:
    """Create an exception-only ImportPlan and skip/unresolved ledgers.

    No database, network, caller source workbook, or Google API is accessed. A mismatch in
    the reviewed spec, any source hash, row binding, or exact row preimage refuses the
    entire plan before any candidate is generated.
    """
    spec, spec_sha = _validate_spec(spec_bytes, expected_spec_sha256, expected_source_hashes)
    cases = spec["cases"]
    bound_rows = _source_refs_by_row(cases)
    plan = DispositionImportPlan()
    plan.skipped_rows.extend(
        {
            "source_row": int(entry["source"]["sheet_row"]),
            "case_id": f"{case['workbook_section']}:{case['workbook_sheet_row']}",
            "reason": "unused row; skip only this incoming source row",
            "existing_order_delete": False,
            "existing_line_delete": False,
            "source_preimage_sha256": entry["current_preimage_sha256"],
        }
        for case in cases
        if case.get("decision_exact") == "Unused row — skip it"
        for entry in case.get("source_rows", [])
    )
    rows_by_number: dict[int, Any] = {}
    for row in source_rows:
        if not isinstance(row, IMPORTER.SourceRow):
            raise DispositionError("source_rows must be canonical importer SourceRow objects")
        if len(row.values) != IMPORTER.EXPECTED_COLUMN_COUNT:
            raise DispositionError(f"source row {row.sheet_row} does not have the exact 48-column width")
        if row.sheet_row in rows_by_number:
            raise DispositionError(f"source row {row.sheet_row} is duplicated")
        rows_by_number[row.sheet_row] = row
    if set(rows_by_number) != set(bound_rows):
        missing = sorted(set(bound_rows) - set(rows_by_number))
        extra = sorted(set(rows_by_number) - set(bound_rows))
        raise DispositionError(f"source row scope mismatch (missing={len(missing)}, extra={len(extra)})")
    for rownum, row in rows_by_number.items():
        expected = bound_rows[rownum][1]["current_preimage_sha256"]
        if _row_hash(row) != expected:
            raise DispositionError(f"exact current source preimage mismatch at Google row {rownum}")

    catalog = catalog or IMPORTER.MasterDataCatalog()
    row_case: dict[int, Mapping[str, Any]] = {}
    actions: dict[int, tuple[dict[str, Any], bool, bool]] = {}
    for case in cases:
        key = _case_id(case)
        for rownum in _rows_in_case(case):
            if rownum not in rows_by_number:
                raise DispositionError(f"case {key!r} binds missing Google row {rownum}")
            row_case[rownum] = case
            row = rows_by_number[rownum]
            actions[rownum] = _row_case_actions(case, row)

    eligible: dict[int, Any] = {}
    edits_by_row: dict[int, dict[str, Any]] = {}
    direct_override_rows: set[int] = set()
    parent_only_rows: set[int] = set()
    per_style_rows: set[int] = set()
    verified_assortment_rows: set[int] = set()
    for rownum, original in rows_by_number.items():
        edits, skip, direct_override = actions[rownum]
        case = row_case[rownum]
        edits_by_row[rownum] = edits
        if skip:
            continue
        if case["decision_exact"] == "Assortment — list included styles in notes" and any(
            i.get("kind") == "parent_only_assortment_no_child_creation" for i in case.get("instructions", [])
        ):
            parent_only_rows.add(rownum)
        if case["decision_exact"] == "Assortment — list included styles in notes" and any(
            i.get("kind") == "assortment_components_from_explicit_note_and_verified_assortment_source"
            for i in case.get("instructions", [])
        ):
            verified_assortment_rows.add(rownum)
        if direct_override:
            direct_override_rows.add(rownum)
        if case["workbook_section"] == "Rows needing correction" and case["decision_exact"] == "Corrected per-style list in notes" and edits:
            per_style_rows.add(rownum)
        amended = _replace_cells(original, edits) if edits else original
        # Google Company I is excluded only in this explicit 75-case scope. Keep it
        # in the untouched snapshot attached below.
        eligible[rownum] = _blank_approved_company_column(amended)

    # Every row participating in one of the 12 approved conflict cases uses the
    # explicit business identity tuple. The normalized Import PO remains a real
    # source D-number; any split suffix is an opaque internal source-ref only.
    conflict_po_numbers: set[str] = set()
    for case in cases:
        if case["workbook_section"] == "Conflicting orders":
            for rownum in _rows_in_case(case):
                normalized = IMPORTER.normalize_po_number(_raw_cell(rows_by_number[rownum], "B"))
                if normalized:
                    conflict_po_numbers.add(normalized)
    grouped: dict[tuple[Any, ...], list[int]] = defaultdict(list)
    for rownum, row in eligible.items():
        po_norm = IMPORTER.normalize_po_number(_raw_cell(rows_by_number[rownum], "B"))
        if po_norm is None:
            plan.unresolved_fields.append(
                {
                    "source_row": rownum,
                    "case_id": f"{row_case[rownum]['workbook_section']}:{row_case[rownum]['workbook_sheet_row']}",
                    "source_column": "B",
                    "status": "blank_import_PO_no_business_number_invented",
                    "raw_value": _raw_cell(rows_by_number[rownum], "B"),
                    "source_preimage_sha256": _row_hash(rows_by_number[rownum]),
                }
            )
            continue
        if po_norm in conflict_po_numbers:
            identity = _group_identity(rows_by_number[rownum])
            key = ("approved-conflict", po_norm, *identity[:-1])
        else:
            key = ("ordinary", po_norm)
        grouped[key].append(rownum)
    plan.provenance = {
        "spec_sha256": spec_sha,
        "canonical_importer_sha256": _sha256(_IMPORTER_PATH.read_bytes()),
        "source_hashes": dict(expected_source_hashes),
        "source_rows_bound": len(bound_rows),
        "approved_case_count": len(cases),
        "production_action": False,
        "database_writer_invoked": False,
    }
    base_plan = IMPORTER.ImportPlan()
    canonical_parser_raw_counters: Counter[str] = Counter()
    canonical_parser_raw_rejected_rows = 0
    custom_expected_rejections_suppressed = 0
    split_by_po: dict[str, set[tuple[Any, ...]]] = defaultdict(set)
    for key, rownums in grouped.items():
        for rownum in rownums:
            po_norm = IMPORTER.normalize_po_number(_raw_cell(rows_by_number[rownum], "B"))
            if key[0] == "approved-conflict" and po_norm:
                split_by_po[po_norm].add(key)
    for key, rownums in grouped.items():
        originals = [rows_by_number[rn] for rn in sorted(rownums)]
        source_rows_for_parser = [eligible[rn] for rn in sorted(rownums)]
        po_norm = IMPORTER.normalize_po_number(_raw_cell(originals[0], "B"))
        original_sid = IMPORTER.header_source_id(po_norm, originals[0].sheet_row)
        if key[0] == "approved-conflict" and po_norm and len(split_by_po[po_norm]) > 1:
            identity = tuple(key[2:])
            desired_sid = _opaque_group_source_id(original_sid, (po_norm, identity))
        else:
            desired_sid = original_sid
        # Parse every row, including parent-only rows, so header disagreements
        # remain visible and cannot be hidden by selecting the first row.
        parsed_rows = source_rows_for_parser
        subplan = IMPORTER.build_plan(parsed_rows, catalog)
        canonical_parser_raw_counters.update(subplan.counters)
        canonical_parser_raw_rejected_rows += len(subplan.rejected_rows)
        if len(subplan.orders) != 1:
            plan.unresolved_fields.append({"source_rows": sorted(rownums), "status": "header_plan_cardinality_not_one", "count": len(subplan.orders)})
            continue
        order = subplan.orders[0]
        order.source_id = desired_sid
        order.sheet_rows = sorted(rownums)
        order.metadata.setdefault("source_disposition", {}).update(
            {
                "spec_sha256": spec_sha,
                "original_normalized_header_source_id": original_sid,
                "desired_internal_header_source_id": desired_sid,
                "raw_import_po_by_source_row": {str(r.sheet_row): _raw_cell(r, "B") for r in originals},
                "source_rows": sorted(rownums),
                "business_identity_group_by_source_row": {
                    str(r.sheet_row): {col: _raw_cell(r, col) for col in (*IDENTITY_COLUMNS, "B")}
                    for r in originals
                },
                "google_company_I_ignored_for_approved_conflicts": True,
                "google_company_I_raw_by_source_row": {str(r.sheet_row): _raw_cell(r, "I") for r in originals},
                # A pure source planner cannot prove canonical existence.
                # The separately reviewed writer must read exact live refs.
                "existing_google_header_refs": None,
                "existing_google_line_refs": None,
            }
        )
        for rn, original in zip(sorted(rownums), originals):
            case = row_case[rn]
            order.metadata.setdefault("source_disposition", {}).setdefault("source_row_evidence", []).append(
                _original_source_metadata(original, case, original_sid, desired_sid, spec_sha, edits_by_row[rn])
            )
        plan.orders.append(order)

        unresolved_cols = order.metadata.get("header_field_conflicts", [])
        invalid_header_values = order.metadata.get("invalid_header_values", {})
        for col in unresolved_cols:
            plan.unresolved_fields.append(
                {
                    "header_source_id": desired_sid,
                    "source_rows": sorted(rownums),
                    "source_column": col,
                    "status": "conflicting_header_value_left_unset",
                    "raw_values_by_source_row": {str(r.sheet_row): _raw_cell(r, col) for r in originals},
                }
            )
        for col, invalid in invalid_header_values.items():
            matching_rows = [r for r in originals if _raw_text(r, col) == invalid]
            keep_approved = bool(matching_rows) and all(
                row_case[r.sheet_row]["decision_exact"] == "Keep original text as written"
                and _instruction(row_case[r.sheet_row], "preserve_latest_source_text_without_normalization")
                .get("explicit_target_fields", {})
                .get("Column") == col
                for r in matching_rows
            )
            evidence = {
                "header_source_id": desired_sid,
                "source_rows": [r.sheet_row for r in matching_rows] or sorted(rownums),
                "source_column": col,
                "raw_value": invalid,
            }
            if keep_approved:
                plan.resolved_source_warnings.append(
                    {
                        **evidence,
                        "status": "business_decision_keep_raw_text; parser_invalid_value_retained_as_evidence",
                    }
                )
            else:
                plan.unresolved_fields.append(
                    {**evidence, "status": "invalid_header_value_preserved_in_parser_evidence"}
                )
        if order.quarantined:
            for reason in order.quarantine_reasons:
                plan.unresolved_fields.append(
                    {
                        "header_source_id": desired_sid,
                        "source_rows": sorted(rownums),
                        "status": "header_identity_conflict_quarantined",
                        "reason": reason,
                        "raw_values_by_column": {
                            col: {str(r.sheet_row): _raw_cell(r, col) for r in originals}
                            for col in HEADER_STATUS_COLUMNS
                        },
                    }
                )

        custom_lines = []
        expected_custom_rejections = set(parent_only_rows | direct_override_rows | per_style_rows | verified_assortment_rows).intersection(rownums)
        for rejected in subplan.rejected_rows:
            if rejected.sheet_row in expected_custom_rejections:
                if not _is_expected_custom_parser_rejection(
                    rejected,
                    rejected.sheet_row,
                    parent_only_rows,
                    direct_override_rows,
                    per_style_rows,
                    verified_assortment_rows,
                ):
                    raise DispositionError(
                        f"approved row {rejected.sheet_row} has an unexpected canonical parser rejection: "
                        f"{rejected.shape}/{rejected.reason}"
                    )
                custom_expected_rejections_suppressed += 1
                continue
            plan.rejected_rows.append(rejected)
        for line in subplan.lines:
            line.order_source_id = desired_sid
            if line.sheet_row in expected_custom_rejections:
                continue
            row_original = rows_by_number[line.sheet_row]
            case = row_case[line.sheet_row]
            _append_line_provenance(line, row_original, case, desired_sid, spec_sha, edits_by_row[line.sheet_row])
            custom_lines.append(line)
        plan.lines.extend(custom_lines)

        for rn in sorted(expected_custom_rejections):
            original = rows_by_number[rn]
            row_for_line = _replace_cells(original, edits_by_row[rn]) if edits_by_row[rn] else original
            row_for_line = _blank_approved_company_column(row_for_line)
            if rn in per_style_rows:
                lines = _plan_per_style_components(
                    original,
                    row_for_line,
                    row_case[rn],
                    desired_sid,
                    catalog,
                    base_plan,
                    spec_sha,
                    edits_by_row[rn],
                )
                plan.lines.extend(lines)
                continue
            elif rn in verified_assortment_rows:
                lines = _plan_verified_assortment_components(
                    original,
                    row_for_line,
                    row_case[rn],
                    desired_sid,
                    catalog,
                    base_plan,
                    spec_sha,
                    edits_by_row[rn],
                )
                plan.lines.extend(lines)
                continue
            elif rn in parent_only_rows:
                line = _make_parent_only_line(
                    row_for_line, desired_sid, catalog, base_plan, plan.unresolved_fields
                )
                line.metadata["source_disposition"].update(
                    _original_source_metadata(original, row_case[rn], original_sid, desired_sid, spec_sha, edits_by_row[rn])
                )
                line.metadata["source_disposition"].update(
                    {
                        "identity_requires_existing_cold_match_disposition": True,
                        "coldlion_candidate_is_not_same_order_authority": True,
                        "business_identity_disposition": "held_unchanged_until_same_real_order_is_confirmed",
                    }
                )
                plan.unresolved_fields.append(
                    {
                        "source_row": rn,
                        "header_source_id": desired_sid,
                        "status": "identity_requires_existingColdmatch_disposition",
                        "coldlion_candidate_count_evidence": 1,
                        "same_real_order_confirmed": False,
                        "write_eligible": False,
                    }
                )
            else:
                line = IMPORTER._plan_direct_line(row_for_line, desired_sid, catalog, base_plan)
                line.metadata.setdefault("source_disposition", {}).update(
                    _original_source_metadata(original, row_case[rn], original_sid, desired_sid, spec_sha, edits_by_row[rn])
                )
                line.metadata["source_disposition"]["row_shape_override"] = "direct_with_latest_assortment_id_retained"
            plan.lines.append(line)
    # Keep raw parser/helper counters in provenance only. The inherited ImportPlan
    # counters are actionable and are recomputed from final desired objects and
    # source-bound ledgers below, never from row-group subplans or shared accumulators.
    plan.provenance["canonical_parser_raw_counters"] = dict(canonical_parser_raw_counters)
    plan.provenance["canonical_parser_raw_rejected_rows_list_count"] = canonical_parser_raw_rejected_rows
    plan.provenance["custom_line_helper_raw_counters"] = dict(base_plan.counters)
    plan.provenance["custom_expected_rejections_suppressed"] = custom_expected_rejections_suppressed
    plan.counters = _derive_actionable_counters(plan, rows_by_number)
    plan.source_disposition_counts = {
        "answer_cases": len(cases),
        "source_rows_bound": len(bound_rows),
        "source_rows_skipped": len(plan.skipped_rows),
        "desired_headers": len(plan.orders),
        "desired_lines": len(plan.lines),
        "rejected_rows": len(plan.rejected_rows),
        "unresolved_fields": len(plan.unresolved_fields),
        "business_identity_groups": len(grouped),
        "conflict_source_ids_split": sum(1 for norm, keys in split_by_po.items() if len(keys) > 1),
    }
    return plan
