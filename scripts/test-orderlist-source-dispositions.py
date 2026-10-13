#!/usr/bin/env python3
"""Synthetic safety tests for the pure #277 source-disposition planner."""

from __future__ import annotations

import hashlib
import importlib.util
import json
import sys
import unittest
from copy import deepcopy
from pathlib import Path
from unittest.mock import patch


MODULE_PATH = Path(__file__).with_name("orderlist-source-dispositions.py")
MODULE_SPEC = importlib.util.spec_from_file_location("orderlist_source_dispositions", MODULE_PATH)
if MODULE_SPEC is None or MODULE_SPEC.loader is None:  # pragma: no cover
    raise RuntimeError("could not load source disposition helper")
dispositions = importlib.util.module_from_spec(MODULE_SPEC)
sys.modules[MODULE_SPEC.name] = dispositions
MODULE_SPEC.loader.exec_module(dispositions)
imp = dispositions.IMPORTER


def _digest(value: object) -> str:
    return hashlib.sha256(
        json.dumps(value, ensure_ascii=False, separators=(",", ":"), default=str).encode()
    ).hexdigest()


def _row(number: int, cells: dict[str, object] | None = None) -> object:
    values = [None] * imp.EXPECTED_COLUMN_COUNT
    for column, value in (cells or {}).items():
        values[imp.column_index(column)] = value
    return imp.SourceRow(sheet_row=number, values=tuple(values))


def _case(section: str, decision: str, workbook_row: int, rows: list[object], instructions: list[dict]) -> dict:
    return {
        "workbook_section": section,
        "workbook_sheet_row": workbook_row,
        "decision_exact": decision,
        "status_from_prior_packet": "complete",
        "source_rows": [
            {
                "source": {
                    "spreadsheet_id": imp.SOURCE_SPREADSHEET_ID,
                    "tab": imp.SOURCE_TAB_NAME,
                    "gid": imp.SOURCE_TAB_GID,
                    "sheet_row": row.sheet_row,
                },
                "current_preimage_sha256": dispositions._row_hash(row),
            }
            for row in rows
        ],
        "notes_exact": "synthetic explicit instruction",
        "instructions": instructions,
    }


def _build_fixture() -> tuple[list[object], bytes, dict[str, str], dict[str, int]]:
    rows: list[object] = []
    cases: list[dict] = []
    case_number = 1
    row_number = 200
    conflict_po_rows: list[list[object]] = []

    def order_row(number: int, po: str, **extra: object) -> object:
        cells: dict[str, object] = {
            "A": "Open",
            "B": po,
            "C": "Factory A",
            "D": "2026-10-01",
            "H": "V-1",
            "I": "Company one",
            "K": "Stock",
            "L": "",
            "N": "",
            "P": f"SKU{number}",
            "AR": f"SKU{number}",
            "U": "1",
        }
        cells.update(extra)
        return _row(number, cells)

    # Twelve answer cases: one PO split across customer/vendor/status, ten single
    # groups, and one company-only conflict that must retain its legacy source ID.
    split_rows = [
        order_row(201, "D0001", P="SPLIT-A", AR="SPLIT-A", L=None),
        order_row(202, "D0001", P="SPLIT-B", AR="SPLIT-B", L=None, I="Company two"),
        order_row(203, "D0001", P="SPLIT-C", AR="SPLIT-C", L="Customer B", C="Factory B", H="V-2", A="Closed", K="C Stock", N="PO-C"),
    ]
    for i, row in enumerate(split_rows):
        cells = list(row.values)
        cells[imp.column_index("P")] = f"SPLIT{i}"
        cells[imp.column_index("AR")] = f"SPLIT{i}"
        split_rows[i] = imp.SourceRow(row.sheet_row, tuple(cells))
    cases.append(_case("Conflicting orders", "Use corrected values in notes", case_number, split_rows, [{"kind": "split_internal_source_groups_without_business_field_edits"}]))
    rows.extend(split_rows)
    case_number += 1
    for i in range(10):
        number = 210 + i
        row = order_row(number, None if i == 0 else f"D{i + 2:04d}", P=f"CONFLICT{i}", AR=f"CONFLICT{i}")
        cases.append(_case("Conflicting orders", "Use corrected values in notes", case_number, [row], [{"kind": "split_internal_source_groups_without_business_field_edits"}]))
        rows.append(row)
        case_number += 1
    company_only = [
        order_row(220, "D0012", P="COMPANY-A", AR="COMPANY-A", I="Company one"),
        order_row(221, "D0012", P="COMPANY-B", AR="COMPANY-B", I="Company two"),
    ]
    cases.append(_case("Conflicting orders", "Use corrected values in notes", case_number, company_only, [{"kind": "split_internal_source_groups_without_business_field_edits"}]))
    rows.extend(company_only)
    case_number += 1

    # Twenty-six exact per-component lists. First case deliberately stores its note
    # mappings in reverse SKU order; output must follow the source AR order.
    for i in range(26):
        number = 300 + i
        if i == 0:
            styles = ["COMP-B", "COMP-A"]
            mappings = [
                {"component_sku_exact": "COMP-A", "target_column": "AG", "exact_corrected_value": "A-value"},
                {"component_sku_exact": "COMP-B", "target_column": "AG", "exact_corrected_value": "B-value"},
            ]
        else:
            styles = [f"COMP{i:02d}"]
            mappings = [{"component_sku_exact": styles[0], "target_column": "AM", "exact_corrected_value": "Generic"}]
        row = order_row(number, f"P{i:04d}", P=None, AR="\n".join(styles), O=None, U="3")
        ins = {"kind": "row_bound_per_component_field_override", "source_sheet_row": number, "target_column": mappings[0]["target_column"], "component_order_column": "AR", "component_values_in_exact_note_order": mappings}
        cases.append(_case("Rows needing correction", "Corrected per-style list in notes", case_number, [row], [ins]))
        rows.append(row)
        case_number += 1

    # One current-compatible P+O row tests the explicit direct-line override while
    # retaining the newest source assortment ID.
    row168 = order_row(168, "D0168", P="STYLE168", AR=None, O="LATEST-ASSORTMENT-168")
    cases.append(_case("Rows needing correction", "Corrected per-style list in notes", case_number, [row168], [{"kind": "explicit_style_value_current_compatible", "source_sheet_row": 168, "target_column": "P", "exact_note_style_value": "STYLE168", "current_P_assertion": "casefold_equal", "preserve_latest_O_assortment_id": True, "do_not_apply_prior_snapshot_O": True}]))
    rows.append(row168)
    case_number += 1

    for i in range(3):
        number = 400 + i
        row = order_row(number, f"SINGLE{i}", P=f"SINGLE{i}", AR=f"OLD-SUBSKU-{i}", O=f"OLD-ASSORTMENT-{i}")
        ins = {"kind": "direct_style_assignment_from_exact_note", "source_sheet_row": number, "target_column": "P", "exact_style_value_current_source": f"SINGLE{i}", "note_contains_casefold_equal_style_token": True, "source_value_already_current": True, "source_mutation_required": False}
        cases.append(_case("Rows needing correction", "Single product — give Style# in notes", case_number, [row], [ins]))
        rows.append(row)
        case_number += 1

    for i in range(7):
        number = 500 + i
        row = _row(number)
        ins = {"kind": "exclude_source_row_from_import", "source_sheet_rows": [number], "reason_from_owner_decision": "unused row", "business_values_to_mutate": []}
        cases.append(_case("Rows needing correction", "Unused row — skip it", case_number, [row], [ins]))
        rows.append(row)
        case_number += 1

    four_styles = ["FOUR-A", "FOUR-B", "FOUR-C", "FOUR-D"]
    row = order_row(600, "ASSORT-4", P=None, AR=None, O="ASSORT-ID-4", U="4", AM="Generic", AT="old description one\nold description two", T="Licensed\nLicensed\nLicensed\nLicensed", AF="test-a\ntest-b", AG="photos-a\nphotos-b\nphotos-c\nphotos-d")
    ins = {"kind": "assortment_components_from_explicit_note_and_verified_assortment_source", "source_sheet_row": 600, "assortment_id_column": "O", "assortment_id_exact": "ASSORT-ID-4", "component_skus_exact": four_styles, "verified_source": {"tab": "Assort.List", "row": 1326, "evidence": "four exact SKU entries; quantity 1 each"}, "component_quantity": "unassigned_no_guess"}
    cases.append(_case("Rows needing correction", "Assortment — list included styles in notes", case_number, [row], [ins]))
    rows.append(row)
    case_number += 1
    for i in range(20):
        number = 610 + i
        row = order_row(number, f"PARENT{i:02d}", P=None, AR=None, O=f"PARENT-ID-{i:02d}", U="2")
        ins = {"kind": "parent_only_assortment_no_child_creation", "source_sheet_row": number, "assortment_id_column": "O", "assortment_id_exact": f"PARENT-ID-{i:02d}", "component_skus": [], "quantity": "2", "no_child_creation": True, "source_row_only_no_assortment_id_invention": True}
        cases.append(_case("Rows needing correction", "Assortment — list included styles in notes", case_number, [row], [ins]))
        rows.append(row)
        case_number += 1

    # Two corrected warnings preserve current source values and three raw-text
    # warnings exercise date overflow/malformed text retention.
    for i in range(2):
        number = 700 + i
        column = "D" if i == 0 else "E"
        row = order_row(number, f"WARN-C{i}", **{column: "2026-01-12"})
        diff = {"source_column": column, "row": number, "current_native_value": "2026-01-12", "snapshot_value": None, "field": "Date"}
        note = (
            "2026-01-12 00:00:00"
            if column == "D"
            else f"Order E (Sent PO Date): use 2026-01-12 for rows {number}.\nThis is a representation difference, not a conflicting business date."
        )
        ins = {"kind": "use_latest_exact_source_cells_as_decided", "source_sheet_rows": [number], "decision_exact": "Use corrected value in notes", "changed_cell_evidence": [diff], "explicit_target_fields": {"Column": column, "Yuchen’s notes / corrected values": note}, "latest_raw_source_preimage_bound": True, "no_source_date_reformatting": True}
        case = _case("Other source warnings", "Use corrected value in notes", case_number, [row], [ins])
        case["notes_exact"] = note
        cases.append(case)
        rows.append(row)
        case_number += 1
    warning_values = [("D", "1//12/2022"), ("AD", "6693547"), ("E", "No data")]
    for i, (column, value) in enumerate(warning_values):
        number = 710 + i
        row = order_row(number, f"WARN-K{i}", **{column: value})
        ins = {"kind": "preserve_latest_source_text_without_normalization", "source_sheet_rows": [number], "decision_exact": "Keep original text as written", "changed_cell_evidence": [], "explicit_target_fields": {"Column": column}, "latest_raw_source_preimage_bound": True, "no_source_date_reformatting": True}
        cases.append(_case("Other source warnings", "Keep original text as written", case_number, [row], [ins]))
        rows.append(row)
        case_number += 1

    hashes = {
        "source_answer_resolution_packet_sha256": "1" * 64,
        "returned_workbook_sha256": "2" * 64,
        "latest_google_capture_sha256": "3" * 64,
    }
    spec = {
        "artifact_type": "protected_issue277_yuchen_answer_disposition_spec",
        **hashes,
        "issues": [],
        "cases": cases,
    }
    spec_bytes = (json.dumps(spec, ensure_ascii=False, indent=2) + "\n").encode()
    return rows, spec_bytes, hashes, {"parent_start": 610, "parent_end": 629, "skip_start": 500, "skip_end": 506}


class SourceDispositionPlannerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.rows, cls.spec_bytes, cls.hashes, cls.ranges = _build_fixture()
        cls.spec_sha = hashlib.sha256(cls.spec_bytes).hexdigest()

    def _plan(self, rows=None, spec_bytes=None, hashes=None, spec_sha=None):
        spec_bytes = self.spec_bytes if spec_bytes is None else spec_bytes
        hashes = self.hashes if hashes is None else hashes
        spec_sha = self.spec_sha if spec_sha is None else spec_sha
        return dispositions.build_source_disposition_plan(
            self.rows if rows is None else rows,
            spec_bytes,
            expected_spec_sha256=spec_sha,
            expected_source_hashes=hashes,
        )

    def test_conflict_groups_preserve_customer_vendor_status_and_ignore_only_i(self) -> None:
        plan = self._plan()
        split_orders = [o for o in plan.orders if o.po_normalized == "d0001"]
        self.assertEqual(len(split_orders), 2)
        self.assertEqual(len({o.source_id for o in split_orders}), 2)
        self.assertTrue(all(o.payload["production_order_number"] == "D0001" for o in split_orders))
        same_business_identity = next(o for o in split_orders if set(o.sheet_rows) == {201, 202})
        self.assertEqual(same_business_identity.metadata["ordering_company"], None)
        self.assertEqual(same_business_identity.sheet_rows, [201, 202])
        company_only = next(o for o in plan.orders if o.po_normalized == "d0012")
        self.assertEqual(company_only.sheet_rows, [220, 221])
        self.assertEqual(company_only.source_id, "order:po:d0012")
        self.assertEqual(company_only.metadata["source_disposition"]["google_company_I_raw_by_source_row"], {"220": "Company one", "221": "Company two"})

    def test_blank_customer_is_not_aliased_to_a_real_customer(self) -> None:
        plan = self._plan()
        split_orders = [o for o in plan.orders if o.po_normalized == "d0001"]
        self.assertEqual({tuple(o.sheet_rows) for o in split_orders}, {(201, 202), (203,)})
        self.assertEqual({o.metadata["customer_name"] for o in split_orders}, {None, "Customer B"})

    def test_per_style_mapping_uses_ar_order_and_rejects_misalignment(self) -> None:
        plan = self._plan()
        per_style_lines = [line for line in plan.lines if 300 <= line.sheet_row <= 325]
        self.assertEqual(len(per_style_lines), 27)
        self.assertEqual(
            sum(line.sheet_row == 300 for line in per_style_lines),
            2,
            "component rows should be planned once each, without also retaining parser output",
        )
        first = next(line for line in plan.lines if line.sheet_row == 300 and line.ordinal == 1)
        self.assertEqual(first.payload["professional_photos"], "B-value")
        second = next(line for line in plan.lines if line.sheet_row == 300 and line.ordinal == 2)
        self.assertEqual(second.payload["professional_photos"], "A-value")
        row = _row(998, {"AR": "COMP-A\nCOMP-B"})
        instruction = {"target_column": "AG", "component_order_column": "AR", "component_values_in_exact_note_order": [{"component_sku_exact": "COMP-C", "target_column": "AG", "exact_corrected_value": "x"}]}
        with self.assertRaises(dispositions.DispositionError):
            dispositions._exact_component_overrides(instruction, row)

    def test_per_style_planner_rejects_blank_or_duplicate_note_keys_itself(self) -> None:
        spec = json.loads(self.spec_bytes)
        case = next(
            deepcopy(item)
            for item in spec["cases"]
            if item["instructions"][0].get("kind") == "row_bound_per_component_field_override"
            and item["instructions"][0].get("source_sheet_row") == 300
        )
        row = next(row for row in self.rows if row.sheet_row == 300)
        for mutate in (
            lambda entries: entries[0].update(component_sku_exact="  "),
            lambda entries: entries[1].update(component_sku_exact=entries[0]["component_sku_exact"]),
        ):
            invalid_case = deepcopy(case)
            entries = invalid_case["instructions"][0]["component_values_in_exact_note_order"]
            mutate(entries)
            edits = dispositions._exact_component_overrides(case["instructions"][0], row)
            amended = dispositions._replace_cells(row, edits)
            with self.assertRaises(dispositions.DispositionError):
                dispositions._plan_per_style_components(
                    row,
                    amended,
                    invalid_case,
                    "order:po:per-style-300",
                    imp.MasterDataCatalog(),
                    imp.ImportPlan(),
                    self.spec_sha,
                    edits,
                )

    def test_blank_business_po_is_ledgered_without_a_generated_order_or_fake_po(self) -> None:
        plan = self._plan()
        evidence = next(x for x in plan.unresolved_fields if x.get("source_row") == 210)
        self.assertEqual(evidence["source_column"], "B")
        self.assertEqual(evidence["status"], "blank_import_PO_no_business_number_invented")
        self.assertFalse(any(210 in order.sheet_rows for order in plan.orders))
        self.assertFalse(any(line.sheet_row == 210 for line in plan.lines))
        self.assertFalse(any(order.payload.get("production_order_number") == "GOOGLE-ROW-210" for order in plan.orders))

    def test_parent_only_rows_keep_parent_values_without_child_identity_or_quantity(self) -> None:
        plan = self._plan()
        parents = [line for line in plan.lines if self.ranges["parent_start"] <= line.sheet_row <= self.ranges["parent_end"]]
        self.assertEqual(len(parents), 20)
        for line in parents:
            self.assertIsNone(line.payload["sku"])
            self.assertIsNone(line.payload["item_id"])
            self.assertIsNone(line.payload["assortment_component_ordinal"])
            self.assertEqual(line.payload["assortment_id"], f"PARENT-ID-{line.sheet_row - self.ranges['parent_start']:02d}")
            self.assertEqual(line.payload["quantity_ordered"], 2)
            self.assertTrue(line.metadata["source_disposition"]["parent_only_assortment"])
            self.assertTrue(line.metadata["source_disposition"]["identity_requires_existing_cold_match_disposition"])
        identity_holds = [x for x in plan.unresolved_fields if x["status"] == "identity_requires_existingColdmatch_disposition"]
        self.assertEqual(len(identity_holds), 20)
        four = [line for line in plan.lines if line.sheet_row == 600]
        self.assertEqual(len(four), 4)
        self.assertTrue(all(line.payload["quantity_ordered"] is None for line in four))

    def test_parent_only_missing_or_unparseable_quantity_is_ledgered_unknown(self) -> None:
        for raw_quantity in (None, "quantity pending"):
            with self.subTest(raw_quantity=raw_quantity):
                unresolved: list[dict] = []
                row = _row(990, {"O": "PARENT-990", "U": raw_quantity})
                line = dispositions._make_parent_only_line(
                    row,
                    "order:po:parent-990",
                    imp.MasterDataCatalog(),
                    imp.ImportPlan(),
                    unresolved,
                )
                self.assertIsNone(line.payload["quantity_ordered"])
                self.assertEqual(len(unresolved), 1)
                self.assertEqual(unresolved[0]["source_column"], "U")
                self.assertEqual(unresolved[0]["status"], "parent_quantity_missing_or_unparseable_preserved_unknown")
                self.assertEqual(unresolved[0]["raw_value"], raw_quantity)

    def test_row_168_uses_direct_shape_but_retains_latest_assortment_id(self) -> None:
        plan = self._plan()
        line = next(line for line in plan.lines if line.sheet_row == 168)
        self.assertEqual(line.payload["sku"], "STYLE168")
        self.assertEqual(line.payload["assortment_id"], "LATEST-ASSORTMENT-168")
        self.assertEqual(line.payload["assortment_component_ordinal"], None)
        self.assertEqual(line.metadata["source_disposition"]["row_shape_override"], "direct_with_latest_assortment_id_retained")

    def test_single_product_answers_use_direct_lines_and_preserve_raw_assortment_cells(self) -> None:
        plan = self._plan()
        for row_number in (400, 401, 402):
            line = next(line for line in plan.lines if line.sheet_row == row_number)
            index = row_number - 400
            self.assertIsNone(line.ordinal)
            self.assertEqual(line.payload["sku"], f"SINGLE{index}")
            self.assertEqual(line.payload["assortment_id"], f"OLD-ASSORTMENT-{index}")
            self.assertEqual(line.metadata["order_list_snapshot"]["sub_sku_raw"], f"OLD-SUBSKU-{index}")
            self.assertEqual(line.metadata["source_disposition"]["source_row_snapshot_exact"]["AR"], f"OLD-SUBSKU-{index}")
        self.assertFalse(any(x.sheet_row in {400, 401, 402} for x in plan.rejected_rows))

    def test_verified_four_style_assortment_keeps_helper_cells_unassigned(self) -> None:
        plan = self._plan()
        lines = [line for line in plan.lines if line.sheet_row == 600]
        self.assertEqual([line.payload["sku"] for line in lines], ["FOUR-A", "FOUR-B", "FOUR-C", "FOUR-D"])
        for line in lines:
            self.assertNotIn("description", line.payload)
            self.assertIsNone(line.payload["source_style_type"])
            self.assertIsNone(line.payload["test_report"])
            self.assertIsNone(line.payload["professional_photos"])
            metadata = line.metadata["source_disposition"]
            self.assertEqual(metadata["unmapped_component_source_fields_status"], "preserved_raw_unassigned_no_positional_mapping")
            self.assertEqual(metadata["unmapped_component_source_fields_by_column"]["AT"], "old description one\nold description two")
            self.assertEqual(metadata["unmapped_component_source_fields_by_column"]["AF"], "test-a\ntest-b")
        self.assertFalse(any(x.sheet_row == 600 for x in plan.rejected_rows))

    def test_skip_is_only_a_source_row_ledger_and_never_a_delete(self) -> None:
        plan = self._plan()
        self.assertEqual(len(plan.skipped_rows), 7)
        skipped = {item["source_row"] for item in plan.skipped_rows}
        self.assertEqual(skipped, set(range(self.ranges["skip_start"], self.ranges["skip_end"] + 1)))
        self.assertTrue(all(not item["existing_order_delete"] and not item["existing_line_delete"] for item in plan.skipped_rows))
        self.assertFalse(any(line.sheet_row in skipped for line in plan.lines))
        self.assertFalse(any(any(row in skipped for row in order.sheet_rows) for order in plan.orders))

    def test_keep_raw_date_overflow_is_not_normalized(self) -> None:
        plan = self._plan()
        order = next(order for order in plan.orders if order.po_normalized == "warn-k1")
        self.assertIsNone(order.payload["etd"])
        self.assertEqual(order.metadata["invalid_header_values"]["AD"], "6693547")
        evidence = next(x for x in plan.resolved_source_warnings if x.get("source_column") == "AD")
        self.assertEqual(evidence["raw_value"], "6693547")

    def test_exact_representation_note_resolves_typed_date_conflict_without_losing_raw_cells(self) -> None:
        plan = self._plan()
        order = next(order for order in plan.orders if order.po_normalized == "warn-c0")
        self.assertEqual(str(order.payload["seal_container_date"]), "2026-01-12")
        evidence = order.metadata["source_disposition"]["source_row_evidence"][0]
        self.assertEqual(evidence["source_row_snapshot_exact"]["D"], "2026-01-12")
        order = next(order for order in plan.orders if order.po_normalized == "warn-c1")
        self.assertEqual(str(order.payload["sent_po_date"]), "2026-01-12")
        self.assertFalse(any(x.get("source_column") in {"D", "E"} for x in plan.unresolved_fields))

    def test_spec_hash_source_hash_and_row_preimage_mismatch_fail_closed(self) -> None:
        with self.assertRaises(dispositions.DispositionError):
            self._plan(spec_sha="f" * 64)
        bad_hashes = dict(self.hashes)
        bad_hashes["latest_google_capture_sha256"] = "4" * 64
        with self.assertRaises(dispositions.DispositionError):
            self._plan(hashes=bad_hashes)
        changed = list(self.rows)
        changed[0] = _row(changed[0].sheet_row, {"B": "wrong"})
        with self.assertRaises(dispositions.DispositionError):
            self._plan(rows=changed)

    def test_override_instruction_cannot_target_a_row_outside_its_bound_case(self) -> None:
        spec = json.loads(self.spec_bytes)
        case = next(c for c in spec["cases"] if c["workbook_section"] == "Rows needing correction" and c["instructions"][0].get("kind") == "row_bound_per_component_field_override")
        case["instructions"][0]["source_sheet_row"] = 9998
        altered = (json.dumps(spec, ensure_ascii=False, indent=2) + "\n").encode()
        altered_sha = hashlib.sha256(altered).hexdigest()
        with self.assertRaises(dispositions.DispositionError):
            self._plan(spec_bytes=altered, spec_sha=altered_sha)

    def test_genuine_non_overridden_rejection_is_counted_once_and_matches_plan_list(self) -> None:
        spec = json.loads(self.spec_bytes)
        changed_rows = list(self.rows)
        index = next(i for i, row in enumerate(changed_rows) if row.sheet_row == 203)
        original = changed_rows[index]
        values = list(original.values)
        values[imp.column_index("AR")] = "CHILD-A\nCHILD-B"
        values[imp.column_index("O")] = "ASSORT-203"
        changed = imp.SourceRow(sheet_row=203, values=tuple(values))
        changed_rows[index] = changed
        binding = next(
            bound
            for case in spec["cases"]
            for bound in case["source_rows"]
            if bound["source"]["sheet_row"] == 203
        )
        binding["current_preimage_sha256"] = dispositions._row_hash(changed)
        altered = (json.dumps(spec, ensure_ascii=False, indent=2) + "\n").encode()
        plan = self._plan(spec_bytes=altered, rows=changed_rows, spec_sha=hashlib.sha256(altered).hexdigest())
        rejected = [item for item in plan.rejected_rows if item.sheet_row == 203]
        self.assertEqual(len(rejected), 1)
        self.assertEqual(plan.counters["rejected_rows"], len(plan.rejected_rows))
        self.assertEqual(plan.counters["rejected_rows"], 1)
        self.assertGreater(plan.provenance["canonical_parser_raw_rejected_rows_list_count"], 1)

    def test_unexpected_rejection_for_an_answered_custom_row_fails_closed(self) -> None:
        canonical_build_plan = imp.build_plan

        def inject_unexpected_rejection(rows, catalog):
            subplan = canonical_build_plan(rows, catalog)
            if any(row.sheet_row == 400 for row in rows):
                subplan.rejected_rows.append(
                    imp.RejectedRow(400, imp.ROW_SHAPE_DIRECT, "unexpected injected parser rejection", {})
                )
            return subplan

        with patch.object(imp, "build_plan", side_effect=inject_unexpected_rejection):
            with self.assertRaisesRegex(dispositions.DispositionError, "unexpected canonical parser rejection"):
                self._plan()

    def test_actionable_counters_are_recomputed_from_final_objects_only(self) -> None:
        canonical_apply_match = imp._apply_match

        def add_raw_probe_counter(payload, metadata, match, counter_plan):
            canonical_apply_match(payload, metadata, match, counter_plan)
            counter_plan.bump("raw_counter_namespace_probe")

        with patch.object(imp, "_apply_match", side_effect=add_raw_probe_counter):
            plan = self._plan()
        self.assertEqual(plan.counters["planned_orders"], len(plan.orders))
        self.assertEqual(plan.counters["planned_lines"], len(plan.lines))
        self.assertEqual(plan.counters["rejected_rows"], len(plan.rejected_rows))
        self.assertEqual(plan.counters["unresolved_fields"], len(plan.unresolved_fields))
        self.assertEqual(
            plan.counters["match_not_applicable"],
            sum(line.payload.get("master_data_match_status") == "not_applicable" for line in plan.lines),
        )
        self.assertEqual(
            plan.counters["resolution_no_type"],
            sum(line.metadata.get("master_data_resolution") == "no_type" for line in plan.lines),
        )
        self.assertNotIn("raw_counter_namespace_probe", plan.counters)
        self.assertGreater(plan.provenance["canonical_parser_raw_counters"]["raw_counter_namespace_probe"], 0)
        self.assertGreater(plan.provenance["custom_line_helper_raw_counters"]["raw_counter_namespace_probe"], 0)
        self.assertGreater(
            plan.provenance["canonical_parser_raw_rejected_rows_list_count"],
            plan.counters["rejected_rows"],
        )

    def test_all_75_case_categories_and_source_snapshot_provenance_are_retained(self) -> None:
        plan = self._plan()
        self.assertEqual(plan.provenance["approved_case_count"], 75)
        self.assertEqual(plan.provenance["source_rows_bound"], len(self.rows))
        self.assertFalse(plan.provenance["database_writer_invoked"])
        self.assertEqual(len(plan.rejected_rows), 0)
        self.assertEqual(plan.counters["rejected_rows"], len(plan.rejected_rows))
        self.assertGreater(plan.provenance["canonical_parser_raw_rejected_rows_list_count"], 0)
        self.assertIn("canonical_parser_raw_counters", plan.provenance)
        self.assertEqual(len(plan.unresolved_fields), 21)
        self.assertEqual(len(plan.resolved_source_warnings), 3)
        for line in plan.lines:
            self.assertEqual(len(line.metadata["source_disposition"]["source_row_snapshot_exact"]), 48)
            self.assertEqual(len(line.metadata["source_disposition"]["source_preimage_sha256"]), 64)


if __name__ == "__main__":
    unittest.main(verbosity=2)
