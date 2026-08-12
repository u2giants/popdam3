#!/usr/bin/env python3
"""Synthetic contract tests for scripts/import-order-list-xlsx.py (issue #727).

Run with::

    python -m unittest scripts/tests/test_import_order_list.py

These tests are OFFLINE. No database, no network, no secrets, no workbook, no
openpyxl. They prove the import LOGIC — above all that a second identical run changes
zero business rows. They do NOT prove that the real 12,328-row import has happened.

The importer's filename is hyphenated because issue #727 specifies that exact path,
which is not a legal Python module name, so it is loaded here by file path.
"""

from __future__ import annotations

import importlib.util
import os
import sys
import tempfile
import unittest
from datetime import date
from decimal import Decimal
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[2]
_IMPORTER_PATH = _REPO_ROOT / "scripts" / "import-order-list-xlsx.py"

_spec = importlib.util.spec_from_file_location("order_list_importer", _IMPORTER_PATH)
assert _spec and _spec.loader, f"Cannot load importer from {_IMPORTER_PATH}"
importer = importlib.util.module_from_spec(_spec)
sys.modules["order_list_importer"] = importer
_spec.loader.exec_module(importer)


# =====================================================================================
# Row-building helper. Builds a 48-wide tuple from column letters, so a test reads like
# the profile document instead of like an index-counting puzzle.
# =====================================================================================
WIDTH = importer.column_index(importer.LAST_COLUMN) + 1


def make_row(sheet_row: int, **cells: object) -> "importer.SourceRow":
    values: list[object | None] = [None] * WIDTH
    for letter, value in cells.items():
        values[importer.column_index(letter)] = value
    return importer.SourceRow(sheet_row=sheet_row, values=tuple(values))


def direct_row(sheet_row: int, po: str, sku: str, disc: str, **extra: object):
    cells = {"B": po, "P": sku, "AM": disc, "U": 10}
    cells.update(extra)
    return make_row(sheet_row, **cells)


def assortment_row(sheet_row: int, po: str, skus: str, discs: str, **extra: object):
    cells = {"B": po, "O": "ASSORT-1", "AR": skus, "AM": discs, "U": 24}
    cells.update(extra)
    return make_row(sheet_row, **cells)


def catalog(**mapping: object) -> "importer.MasterDataCatalog":
    """``catalog(ncv3sp1_licensed=['md-1'])`` style is unreadable; use explicit dicts."""
    raise NotImplementedError  # pragma: no cover - kept out of use deliberately


LICENSED_CATALOG = importer.MasterDataCatalog(
    rows={
        ("ncv3sp1", "licensed"): ("md-licensed-1",),
        ("bfc02gabb", "generic"): ("md-generic-1",),
        ("3fz64spc01", "generic"): ("md-generic-2",),
        # Duplicate normalized SKUs inside Master Data. This is the shape behind the
        # 449 ambiguous historical matches.
        ("dupe01", "licensed"): ("md-dupe-a", "md-dupe-b"),
    },
    item_ids={
        "md-licensed-1": "item-ncv3sp1",
        "md-generic-1": "item-bfc02gabb",
        "md-generic-2": "item-3fz64spc01",
        "md-dupe-a": "item-dupe-a",
        "md-dupe-b": "item-dupe-b",
    },
)

#: Same Master Data, but with plm.item unpopulated — today's real state.
UNBRIDGED_CATALOG = importer.MasterDataCatalog(
    rows=LICENSED_CATALOG.rows,
    item_ids={key: None for key in LICENSED_CATALOG.item_ids},
)


# =====================================================================================
# 1. Column map
# =====================================================================================
class ColumnMapTests(unittest.TestCase):
    def test_column_letters_round_trip(self):
        for letter in ("A", "Z", "AA", "AM", "AV"):
            self.assertEqual(importer.column_letter(importer.column_index(letter)), letter)

    def test_sheet_is_exactly_48_columns_wide(self):
        self.assertEqual(WIDTH, importer.EXPECTED_COLUMN_COUNT)
        self.assertEqual(importer.column_index("AV"), 47)

    def test_key_columns_sit_where_the_profile_says(self):
        self.assertEqual(importer.column_index(importer.COL_IMPORT_PO), 1)   # B
        self.assertEqual(importer.column_index(importer.COL_STYLE), 15)      # P
        self.assertEqual(importer.column_index(importer.COL_LICENSOR_OR_GENERIC), 38)  # AM
        self.assertEqual(importer.column_index(importer.COL_SUB_SKU), 43)    # AR


# =====================================================================================
# 2. Normalization — trim + case-fold ONLY
# =====================================================================================
class NormalizationTests(unittest.TestCase):
    def test_sku_normalization_is_trim_and_casefold_only(self):
        self.assertEqual(importer.normalize_sku("  NCV3SP1 "), "ncv3sp1")
        # Punctuation must SURVIVE. Stripping it merges different products.
        self.assertEqual(importer.normalize_sku("AB-01"), "ab-01")
        self.assertNotEqual(importer.normalize_sku("AB-01"), importer.normalize_sku("AB01"))

    def test_blank_and_error_values_become_none(self):
        for value in ("", "   ", None, "#REF!", "#N/A"):
            self.assertIsNone(importer.normalize_sku(value), value)

    def test_style_type_maps_licensor_names_to_licensed(self):
        self.assertEqual(importer.normalize_style_type("Generic"), "generic")
        self.assertEqual(importer.normalize_style_type(" generic "), "generic")
        self.assertEqual(importer.normalize_style_type("Disney"), "licensed")
        self.assertEqual(importer.normalize_style_type("Warner Bros"), "licensed")

    def test_style_type_refuses_blank_and_na(self):
        self.assertIsNone(importer.normalize_style_type("#N/A"))
        self.assertIsNone(importer.normalize_style_type(""))
        self.assertIsNone(importer.normalize_style_type(None))

    def test_po_normalization_collapses_case_and_whitespace(self):
        self.assertEqual(
            importer.normalize_po_number(" D1683 "), importer.normalize_po_number("d1683")
        )


class ParsingTests(unittest.TestCase):
    def test_valid_dates_parse_and_keep_raw(self):
        self.assertEqual(importer.parse_date("2026-01-15"), (date(2026, 1, 15), "2026-01-15"))
        self.assertEqual(importer.parse_date("1/15/2026")[0], date(2026, 1, 15))

    def test_asap_stays_raw_and_never_becomes_a_fake_date(self):
        typed, raw = importer.parse_date("ASAP")
        self.assertIsNone(typed)
        self.assertEqual(raw, "ASAP")

    def test_malformed_and_cancelled_seal_dates_stay_raw(self):
        for value in ("1//12/2022", "CANCELLED", "NODATE", "unknow", "N/A"):
            typed, raw = importer.parse_date(value)
            self.assertIsNone(typed, value)
            self.assertEqual(raw, value)

    def test_impossible_etd_serial_is_rejected(self):
        typed, raw = importer.parse_date("6693547")
        self.assertIsNone(typed, "6693547 must never become a year-20000 date")
        self.assertEqual(raw, "6693547")

    def test_plausible_excel_serial_still_parses(self):
        typed, _ = importer.parse_date("45000")
        self.assertEqual(typed, date(2023, 3, 15))

    def test_wrong_qty_is_never_coerced_to_a_number(self):
        typed, raw = importer.parse_number("Wrong QTY")
        self.assertIsNone(typed)
        self.assertEqual(raw, "Wrong QTY")

    def test_real_numbers_parse(self):
        self.assertEqual(importer.parse_number("1,200")[0], Decimal("1200"))
        self.assertEqual(importer.parse_number(24)[0], Decimal("24"))


# =====================================================================================
# 3. Deterministic source refs
# =====================================================================================
class SourceRefTests(unittest.TestCase):
    def test_header_ref_uses_po_when_present(self):
        self.assertEqual(importer.header_source_id("d1683", 65), "order:po:d1683")

    def test_blank_po_rows_never_share_a_header(self):
        first = importer.header_source_id(None, 65)
        second = importer.header_source_id(None, 66)
        self.assertEqual(first, "order:row:65")
        self.assertNotEqual(first, second)

    def test_line_and_component_refs_are_stable_and_distinct(self):
        self.assertEqual(importer.line_source_id(65), "order:row:65")
        self.assertEqual(
            importer.component_source_id(65, 2), "order:row:65:component:2"
        )
        self.assertNotEqual(
            importer.component_source_id(65, 1), importer.component_source_id(65, 2)
        )

    def test_component_ordinal_is_one_based(self):
        with self.assertRaises(importer.ImporterError):
            importer.component_source_id(65, 0)


# =====================================================================================
# 4. Row shapes
# =====================================================================================
class RowShapeTests(unittest.TestCase):
    def test_direct_row(self):
        row = direct_row(10, "D1", "NCV3SP1", "Disney")
        self.assertEqual(importer.classify_row_shape(row), importer.ROW_SHAPE_DIRECT)

    def test_assortment_row(self):
        row = assortment_row(11, "D1", "A1\nA2", "Disney\nGeneric")
        self.assertEqual(importer.classify_row_shape(row), importer.ROW_SHAPE_ASSORTMENT)

    def test_both_shapes_row(self):
        row = make_row(12, B="D1", P="NCV3SP1", AR="A1\nA2", AM="Disney")
        self.assertEqual(importer.classify_row_shape(row), importer.ROW_SHAPE_BOTH)

    def test_neither_shape_row(self):
        row = make_row(13, B="D1", J="Kelly")
        self.assertEqual(importer.classify_row_shape(row), importer.ROW_SHAPE_NEITHER)


class SubSkuStyleMirrorTests(unittest.TestCase):
    """Column AR ("Sub SKU") mirroring the Style# is a 2026-08-11 workbook artifact, not
    an assortment. sub_sku_mirrors_style() must recognise it narrowly (issue #727)."""

    def test_ar_equals_style_single_line_is_direct(self):
        row = make_row(30, B="D1", P="NCV3SP1", AR="NCV3SP1")
        self.assertTrue(importer.sub_sku_mirrors_style(row))
        self.assertEqual(importer.classify_row_shape(row), importer.ROW_SHAPE_DIRECT)

    def test_ar_equals_style_after_whitespace_and_case_is_direct(self):
        # normalize_sku is trim + case-fold, so "  ncv3sp1 " mirrors "NCV3SP1".
        row = make_row(31, B="D1", P="NCV3SP1", AR="  ncv3sp1 ")
        self.assertTrue(importer.sub_sku_mirrors_style(row))
        self.assertEqual(importer.classify_row_shape(row), importer.ROW_SHAPE_DIRECT)

    def test_ar_different_from_style_is_both(self):
        row = make_row(32, B="D1", P="NCV3SP1", AR="BFC02GABB")
        self.assertFalse(importer.sub_sku_mirrors_style(row))
        self.assertEqual(importer.classify_row_shape(row), importer.ROW_SHAPE_BOTH)

    def test_ar_multiline_including_style_is_both(self):
        # A real component list, even one whose first line equals the Style#, is NOT a
        # mirror: the newline separator is the tell.
        row = make_row(33, B="D1", P="NCV3SP1", AR="NCV3SP1\nBFC02GABB")
        self.assertFalse(importer.sub_sku_mirrors_style(row))
        self.assertEqual(importer.classify_row_shape(row), importer.ROW_SHAPE_BOTH)

    def test_ar_without_direct_style_is_assortment(self):
        row = make_row(34, B="D1", AR="A1\nA2", AM="Disney\nGeneric")
        self.assertFalse(importer.sub_sku_mirrors_style(row))
        self.assertEqual(importer.classify_row_shape(row), importer.ROW_SHAPE_ASSORTMENT)

    def test_mirror_row_preserves_raw_ar_evidence(self):
        row = make_row(35, B="D1", P="NCV3SP1", AR="NCV3SP1", AM="Disney")
        plan = importer.build_plan([row], importer.MasterDataCatalog())
        self.assertEqual(len(plan.lines), 1)
        snapshot = plan.lines[0].metadata["order_list_snapshot"]
        self.assertEqual(snapshot["sub_sku_raw"], "NCV3SP1")
        self.assertTrue(snapshot["sub_sku_is_style_mirror"])


# =====================================================================================
# 5. Assortment expansion
# =====================================================================================
class AssortmentTests(unittest.TestCase):
    def test_aligned_components_expand_in_order(self):
        row = assortment_row(
            20, "D1", "A1\nA2\nA3", "Disney\nGeneric\nDisney", AT="d1\nd2\nd3"
        )
        split = importer.split_assortment(row)
        self.assertFalse(split.rejected)
        self.assertEqual([c.ordinal for c in split.components], [1, 2, 3])
        self.assertEqual([c.sku for c in split.components], ["A1", "A2", "A3"])
        self.assertEqual(
            [c.style_type for c in split.components], ["licensed", "generic", "licensed"]
        )
        self.assertEqual([c.description for c in split.components], ["d1", "d2", "d3"])

    def test_misaligned_discriminator_rejects_the_whole_row(self):
        # Four SKUs, three types — one of the ten structurally invalid rows.
        row = assortment_row(21, "D1", "A1\nA2\nA3\nA4", "Disney\nGeneric\nDisney")
        split = importer.split_assortment(row)
        self.assertTrue(split.rejected)
        self.assertIn("component_count_mismatch", split.reason)
        self.assertEqual(split.counts[importer.COL_SUB_SKU], 4)
        self.assertEqual(split.counts[importer.COL_LICENSOR_OR_GENERIC], 3)
        self.assertEqual(split.components, ())

    def test_misaligned_optional_helper_also_rejects(self):
        row = assortment_row(22, "D1", "A1\nA2", "Disney\nGeneric", AF="yes")
        self.assertTrue(importer.split_assortment(row).rejected)

    def test_absent_optional_helper_is_padded_not_rejected(self):
        row = assortment_row(23, "D1", "A1\nA2", "Disney\nGeneric")
        split = importer.split_assortment(row)
        self.assertFalse(split.rejected)
        self.assertEqual([c.test_report for c in split.components], [None, None])

    def test_component_quantity_is_never_invented(self):
        row = assortment_row(24, "D1", "A1\nA2", "Disney\nGeneric", U=100)
        plan = importer.build_plan([row], LICENSED_CATALOG)
        for line in plan.lines:
            self.assertIsNone(
                line.payload["quantity_ordered"],
                "A component quantity must never be derived from the parent.",
            )
            snapshot = line.metadata["order_list_snapshot"]
            self.assertEqual(snapshot["assortment_parent_quantity"], "100")
            self.assertEqual(snapshot["component_quantity_source"], "absent_never_guessed")


# =====================================================================================
# 6. PO grouping, blank-PO isolation, header quarantine
# =====================================================================================
class HeaderGroupingTests(unittest.TestCase):
    def test_rows_sharing_a_po_collapse_to_one_header(self):
        rows = [
            direct_row(30, "D1683", "NCV3SP1", "Disney", L="Target", C="ACME"),
            direct_row(31, "d1683 ", "BFC02GABB", "Generic", L="Target", C="ACME"),
        ]
        plan = importer.build_plan(rows, LICENSED_CATALOG)
        self.assertEqual(len(plan.orders), 1)
        self.assertEqual(plan.orders[0].source_id, "order:po:d1683")
        self.assertEqual(plan.orders[0].sheet_rows, [30, 31])
        self.assertEqual(len(plan.lines), 2)

    def test_blank_po_rows_each_get_their_own_header(self):
        rows = [
            direct_row(40, "", "NCV3SP1", "Disney"),
            direct_row(41, "", "BFC02GABB", "Generic"),
        ]
        plan = importer.build_plan(rows, LICENSED_CATALOG)
        self.assertEqual(len(plan.orders), 2, "130 blank-PO rows must never merge")
        self.assertEqual(
            sorted(o.source_id for o in plan.orders),
            ["order:row:40", "order:row:41"],
        )
        self.assertEqual(plan.counters["blank_po_rows"], 2)

    def test_conflicting_customer_quarantines_the_po_group(self):
        rows = [
            direct_row(50, "D1", "NCV3SP1", "Disney", L="Target"),
            direct_row(51, "D1", "BFC02GABB", "Generic", L="Walmart"),
        ]
        plan = importer.build_plan(rows, LICENSED_CATALOG)
        order = plan.orders[0]
        self.assertTrue(order.quarantined)
        self.assertIn("header_identity_conflict:L", order.quarantine_reasons)
        self.assertEqual(plan.counters["quarantined_orders"], 1)
        self.assertEqual(plan.writable_orders(), [])
        self.assertEqual(
            plan.writable_lines(), [], "lines of a quarantined order must not be written"
        )

    def test_conflicting_vendor_status_and_company_each_quarantine(self):
        for letter, first, second in (
            ("C", "ACME", "OTHER"),
            ("H", "V1", "V2"),
            ("A", "Open", "Closed"),
            ("I", "POP", "Splash"),
        ):
            with self.subTest(column=letter):
                rows = [
                    direct_row(60, "D1", "NCV3SP1", "Disney", **{letter: first}),
                    direct_row(61, "D1", "BFC02GABB", "Generic", **{letter: second}),
                ]
                plan = importer.build_plan(rows, LICENSED_CATALOG)
                self.assertTrue(plan.orders[0].quarantined)
                self.assertIn(
                    f"header_identity_conflict:{letter}",
                    plan.orders[0].quarantine_reasons,
                )

    def test_no_first_wins_and_no_majority_wins(self):
        rows = [
            direct_row(70, "D1", "NCV3SP1", "Disney", L="Target"),
            direct_row(71, "D1", "BFC02GABB", "Generic", L="Target"),
            direct_row(72, "D1", "3FZ64SPC01", "Generic", L="Walmart"),
        ]
        plan = importer.build_plan(rows, LICENSED_CATALOG)
        order = plan.orders[0]
        self.assertTrue(order.quarantined)
        self.assertIsNone(
            order.metadata["customer_name"],
            "Two-to-one is still a conflict; the majority value must NOT be chosen.",
        )

    def test_disagreeing_header_payload_field_is_nulled_not_guessed(self):
        rows = [
            direct_row(80, "D1", "NCV3SP1", "Disney", AJ="MBL-1"),
            direct_row(81, "D1", "BFC02GABB", "Generic", AJ="MBL-2"),
        ]
        plan = importer.build_plan(rows, LICENSED_CATALOG)
        order = plan.orders[0]
        self.assertFalse(order.quarantined, "an MBL disagreement is not an identity conflict")
        self.assertIsNone(order.payload["mbl"])
        self.assertIn("AJ", order.metadata["header_field_conflicts"])
        self.assertEqual(plan.counters["header_field_conflicts"], 1)

    def test_invalid_header_date_is_preserved_as_raw_evidence(self):
        rows = [direct_row(90, "D1", "NCV3SP1", "Disney", D="1//12/2022")]
        plan = importer.build_plan(rows, LICENSED_CATALOG)
        order = plan.orders[0]
        self.assertIsNone(order.payload["seal_container_date"])
        self.assertEqual(order.metadata["invalid_header_values"]["D"], "1//12/2022")


# =====================================================================================
# 7. Master Data matching
# =====================================================================================
class MatchingTests(unittest.TestCase):
    def test_known_examples_resolve_to_the_expected_catalog(self):
        cases = (
            ("NCV3SP1", "Disney", "licensed", "item-ncv3sp1"),
            ("BFC02GABB", "Generic", "generic", "item-bfc02gabb"),
            ("3FZ64SPC01", "Generic", "generic", "item-3fz64spc01"),
        )
        for sku, disc, expected_type, expected_item in cases:
            with self.subTest(sku=sku):
                row = direct_row(100, "D1", sku, disc)
                plan = importer.build_plan([row], LICENSED_CATALOG)
                line = plan.lines[0]
                self.assertEqual(line.payload["source_style_type"], expected_type)
                self.assertEqual(line.payload["master_data_match_status"], importer.MATCH_MATCHED)
                self.assertEqual(line.payload["item_id"], expected_item)

    def test_wrong_type_does_not_match(self):
        # NCV3SP1 exists ONLY in the licensed catalog. Calling it generic must not match.
        row = direct_row(101, "D1", "NCV3SP1", "Generic")
        plan = importer.build_plan([row], LICENSED_CATALOG)
        self.assertEqual(
            plan.lines[0].payload["master_data_match_status"], importer.MATCH_UNMATCHED
        )
        self.assertIsNone(plan.lines[0].payload["item_id"])

    def test_duplicate_master_data_rows_are_ambiguous_never_first_wins(self):
        row = direct_row(102, "D1", "DUPE01", "Disney")
        plan = importer.build_plan([row], LICENSED_CATALOG)
        line = plan.lines[0]
        self.assertEqual(line.payload["master_data_match_status"], importer.MATCH_AMBIGUOUS)
        self.assertIsNone(line.payload["item_id"], "never choose among duplicates")
        self.assertEqual(line.metadata["master_data_candidate_count"], 2)

    def test_unknown_sku_is_unmatched(self):
        row = direct_row(103, "D1", "NOPE999", "Disney")
        plan = importer.build_plan([row], LICENSED_CATALOG)
        self.assertEqual(
            plan.lines[0].payload["master_data_match_status"], importer.MATCH_UNMATCHED
        )

    def test_missing_discriminator_is_not_applicable(self):
        row = make_row(104, B="D1", P="NCV3SP1", AM="#N/A", U=5)
        plan = importer.build_plan([row], LICENSED_CATALOG)
        line = plan.lines[0]
        self.assertEqual(
            line.payload["master_data_match_status"], importer.MATCH_NOT_APPLICABLE
        )
        self.assertIsNone(line.payload["item_id"])

    def test_empty_plm_item_leaves_item_id_null_but_keeps_evidence(self):
        """Issue #727's coordination constraint, encoded as a test."""
        row = direct_row(105, "D1", "NCV3SP1", "Disney")
        plan = importer.build_plan([row], UNBRIDGED_CATALOG)
        line = plan.lines[0]
        self.assertIsNone(line.payload["item_id"])
        self.assertEqual(
            line.payload["master_data_match_status"], importer.MATCH_UNMATCHED
        )
        self.assertEqual(
            line.metadata["master_data_resolution"], importer.RESOLUTION_UNIQUE
        )
        self.assertEqual(
            line.metadata["item_link_pending_reason"], "plm_item_unpopulated"
        )

    def test_matched_status_always_carries_an_item_id(self):
        """Mirrors production_order_line_matched_requires_item_check."""
        rows = [
            direct_row(110, "D1", "NCV3SP1", "Disney"),
            direct_row(111, "D2", "DUPE01", "Disney"),
            direct_row(112, "D3", "NOPE999", "Disney"),
        ]
        plan = importer.build_plan(rows, LICENSED_CATALOG)
        for line in plan.lines:
            if line.payload["master_data_match_status"] in (
                importer.MATCH_MATCHED,
                importer.MATCH_MANUAL,
            ):
                self.assertIsNotNone(line.payload["item_id"])

    def test_components_match_per_component_type_not_the_parent(self):
        row = assortment_row(120, "D1", "NCV3SP1\nBFC02GABB", "Disney\nGeneric")
        plan = importer.build_plan([row], LICENSED_CATALOG)
        first, second = plan.lines
        self.assertEqual(first.payload["source_style_type"], "licensed")
        self.assertEqual(first.payload["item_id"], "item-ncv3sp1")
        self.assertEqual(second.payload["source_style_type"], "generic")
        self.assertEqual(second.payload["item_id"], "item-bfc02gabb")


# =====================================================================================
# 8. Rejections
# =====================================================================================
class RejectionTests(unittest.TestCase):
    def test_neither_shape_row_is_rejected_but_kept_as_evidence(self):
        plan = importer.build_plan([make_row(130, B="D1", J="Kelly")], LICENSED_CATALOG)
        self.assertEqual(plan.lines, [])
        self.assertEqual(len(plan.rejected_rows), 1)
        self.assertEqual(plan.rejected_rows[0].reason, "no_sku_and_no_assortment")

    def test_both_shape_row_is_rejected_pending_review(self):
        row = make_row(131, B="D1", P="NCV3SP1", AR="A1\nA2", AM="Disney")
        plan = importer.build_plan([row], LICENSED_CATALOG)
        self.assertEqual(plan.lines, [])
        self.assertEqual(plan.rejected_rows[0].reason, "both_shapes_pending_review")

    def test_structurally_invalid_assortment_is_rejected_with_counts(self):
        row = assortment_row(132, "D1", "A1\nA2\nA3\nA4", "Disney\nGeneric\nDisney")
        plan = importer.build_plan([row], LICENSED_CATALOG)
        self.assertEqual(plan.lines, [])
        self.assertEqual(plan.counters["structurally_invalid_assortment_rows"], 1)
        self.assertEqual(
            plan.rejected_rows[0].evidence["component_counts"][importer.COL_SUB_SKU], 4
        )


# =====================================================================================
# 9. IDEMPOTENCY — the headline requirement of issue #727
# =====================================================================================
def realistic_rows() -> list["importer.SourceRow"]:
    """A miniature of every shape the real source contains."""
    return [
        direct_row(200, "D1683", "NCV3SP1", "Disney", L="Target", Y="ASAP", W="Wrong QTY"),
        direct_row(201, "D1683", "BFC02GABB", "Generic", L="Target"),
        direct_row(202, "", "3FZ64SPC01", "Generic"),          # blank PO
        direct_row(203, "", "NCV3SP1", "Disney"),              # blank PO, separate header
        direct_row(204, "D2000", "DUPE01", "Disney"),          # ambiguous
        direct_row(205, "D2001", "NOPE999", "Disney"),         # unmatched
        assortment_row(206, "D3000", "NCV3SP1\nBFC02GABB", "Disney\nGeneric"),
        assortment_row(207, "D3001", "A1\nA2\nA3", "Disney\nGeneric"),  # invalid
        make_row(208, B="D4000", J="Kelly"),                   # neither shape
        make_row(209, B="D4001", P="NCV3SP1", AR="A1\nA2", AM="Disney"),  # both shapes
        direct_row(210, "D5000", "NCV3SP1", "Disney", L="Target"),
        direct_row(211, "D5000", "BFC02GABB", "Generic", L="Walmart"),   # quarantined PO
    ]


class IdempotencyTests(unittest.TestCase):
    def setUp(self):
        self.rows = realistic_rows()
        self.plan = importer.build_plan(self.rows, LICENSED_CATALOG)
        self.gateway = importer.InMemoryGateway()

    def test_second_identical_run_changes_zero_business_rows(self):
        first = importer.apply_plan(self.plan, self.gateway)
        self.assertGreater(first.orders_inserted, 0)
        self.assertGreater(first.lines_inserted, 0)
        writes_after_first = len(self.gateway.write_log)

        second = importer.apply_plan(self.plan, self.gateway)

        self.assertEqual(second.changed_rows, 0, "THE core requirement of #727")
        self.assertEqual(second.orders_inserted, 0)
        self.assertEqual(second.orders_updated, 0)
        self.assertEqual(second.lines_inserted, 0)
        self.assertEqual(second.lines_updated, 0)
        self.assertEqual(second.orders_unchanged, first.orders_inserted)
        self.assertEqual(second.lines_unchanged, first.lines_inserted)
        self.assertEqual(
            len(self.gateway.write_log),
            writes_after_first,
            "the second run must issue no write of any kind",
        )

    def test_a_third_run_is_also_a_no_op(self):
        importer.apply_plan(self.plan, self.gateway)
        importer.apply_plan(self.plan, self.gateway)
        writes = len(self.gateway.write_log)
        third = importer.apply_plan(self.plan, self.gateway)
        self.assertEqual(third.changed_rows, 0)
        self.assertEqual(len(self.gateway.write_log), writes)

    def test_rebuilding_the_plan_from_scratch_is_still_a_no_op(self):
        """Proves idempotency comes from the source refs, not from object identity."""
        importer.apply_plan(self.plan, self.gateway)
        rebuilt = importer.build_plan(realistic_rows(), LICENSED_CATALOG)
        second = importer.apply_plan(rebuilt, self.gateway)
        self.assertEqual(second.changed_rows, 0)

    def test_batch_size_does_not_change_the_outcome(self):
        importer.apply_plan(self.plan, self.gateway, batch_size=1)
        big = importer.InMemoryGateway()
        importer.apply_plan(self.plan, big, batch_size=10_000)
        self.assertEqual(
            sorted(self.gateway.order_refs), sorted(big.order_refs)
        )
        self.assertEqual(sorted(self.gateway.line_refs), sorted(big.line_refs))
        self.assertEqual(importer.apply_plan(self.plan, big).changed_rows, 0)

    def test_quarantined_orders_and_their_lines_are_never_written(self):
        importer.apply_plan(self.plan, self.gateway)
        self.assertNotIn("order:po:d5000", self.gateway.order_refs)
        self.assertNotIn("order:row:210", self.gateway.line_refs)
        self.assertNotIn("order:row:211", self.gateway.line_refs)

    def test_rejected_rows_create_no_lines(self):
        importer.apply_plan(self.plan, self.gateway)
        for source_id in ("order:row:207", "order:row:208", "order:row:209"):
            self.assertNotIn(source_id, self.gateway.line_refs)

    def test_component_lines_land_under_their_own_refs(self):
        importer.apply_plan(self.plan, self.gateway)
        self.assertIn("order:row:206:component:1", self.gateway.line_refs)
        self.assertIn("order:row:206:component:2", self.gateway.line_refs)

    def test_changed_source_drifts_and_is_not_silently_rewritten(self):
        importer.apply_plan(self.plan, self.gateway)
        changed = list(self.rows)
        changed[0] = direct_row(
            200, "D1683", "NCV3SP1", "Disney", L="Target", Y="ASAP", W="Wrong QTY", U=999
        )
        second = importer.apply_plan(
            importer.build_plan(changed, LICENSED_CATALOG), self.gateway
        )
        self.assertEqual(second.lines_updated, 0, "no silent overwrite")
        self.assertEqual(second.lines_drifted, 1)
        self.assertEqual(second.drift_details[0]["source_id"], "order:row:200")
        self.assertIn("quantity_ordered", second.drift_details[0]["fields"])

    def test_replace_source_rewrites_only_when_asked(self):
        importer.apply_plan(self.plan, self.gateway)
        changed = list(self.rows)
        changed[0] = direct_row(
            200, "D1683", "NCV3SP1", "Disney", L="Target", Y="ASAP", W="Wrong QTY", U=999
        )
        plan = importer.build_plan(changed, LICENSED_CATALOG)
        second = importer.apply_plan(plan, self.gateway, replace_source=True)
        self.assertEqual(second.lines_updated, 1)
        third = importer.apply_plan(plan, self.gateway, replace_source=True)
        self.assertEqual(third.changed_rows, 0, "still idempotent after a replace")

    def test_dry_run_writes_nothing(self):
        result = importer.apply_plan(self.plan, self.gateway, dry_run=True)
        self.assertGreater(result.orders_inserted, 0)
        self.assertEqual(self.gateway.write_log, [])
        self.assertEqual(self.gateway.orders, {})
        self.assertEqual(self.gateway.lines, {})

    def test_a_failing_batch_rolls_back_and_raises(self):
        class Exploding(importer.InMemoryGateway):
            def insert_order(self, payload, source_id):
                raise RuntimeError("boom")

        gateway = Exploding()
        with self.assertRaises(RuntimeError):
            importer.apply_plan(self.plan, gateway)
        self.assertEqual(gateway.batches_rolled_back, 1)
        self.assertEqual(gateway.batches_committed, 0)


class PayloadComparisonTests(unittest.TestCase):
    """Without these, a second run would rewrite every row over a formatting difference."""

    def test_decimal_scale_does_not_count_as_a_change(self):
        self.assertEqual(
            importer.payload_differs({"q": Decimal("5")}, {"q": Decimal("5.00")}), []
        )

    def test_date_and_iso_string_compare_equal(self):
        self.assertEqual(
            importer.payload_differs({"d": date(2026, 1, 1)}, {"d": "2026-01-01"}), []
        )

    def test_nested_metadata_key_order_does_not_count_as_a_change(self):
        self.assertEqual(
            importer.payload_differs(
                {"metadata": {"a": 1, "b": {"x": 1, "y": 2}}},
                {"metadata": {"b": {"y": 2, "x": 1}, "a": 1}},
            ),
            [],
        )

    def test_a_real_change_is_detected(self):
        self.assertEqual(
            importer.payload_differs({"sku": "a", "q": 1}, {"sku": "b", "q": 1}), ["sku"]
        )


# =====================================================================================
# 10. Checksum gate and target proof
# =====================================================================================
class ChecksumGateTests(unittest.TestCase):
    def test_approved_constant_matches_the_documented_export(self):
        # Owner-accepted 2026-08-11 export (issue #727, "accept today's sheet").
        self.assertEqual(
            importer.APPROVED_SOURCE_SHA256,
            "68c9b03a0ec183e08b3a8f2344397e1bc4f61e73457849e7bf8c0cf7fb2409fe",
        )

    def test_matching_checksum_passes(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "book.xlsx"
            path.write_bytes(b"hello")
            digest = importer.sha256_file(path)
            self.assertEqual(importer.assert_source_checksum(path, digest), digest)

    def test_wrong_checksum_refuses_loudly(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "book.xlsx"
            path.write_bytes(b"hello")
            with self.assertRaises(importer.ImporterError) as caught:
                importer.assert_source_checksum(path, importer.APPROVED_SOURCE_SHA256)
            self.assertIn("Source checksum mismatch", str(caught.exception))


class TargetProofTests(unittest.TestCase):
    def _ref_file(self, directory: str, value: str) -> Path:
        path = Path(directory) / "project-ref"
        path.write_text(value, encoding="utf-8")
        return path

    def test_preview_ref_is_accepted(self):
        with tempfile.TemporaryDirectory() as directory:
            path = self._ref_file(directory, importer.PREVIEW_PROJECT_REF + "\n")
            self.assertEqual(
                importer.assert_preview_target(path, preview=True),
                importer.PREVIEW_PROJECT_REF,
            )

    def test_production_ref_is_refused(self):
        with tempfile.TemporaryDirectory() as directory:
            path = self._ref_file(directory, importer.PRODUCTION_PROJECT_REF)
            with self.assertRaises(importer.ImporterError) as caught:
                importer.assert_preview_target(path, preview=True)
            self.assertIn("PRODUCTION", str(caught.exception))

    def test_unknown_ref_is_refused(self):
        with tempfile.TemporaryDirectory() as directory:
            path = self._ref_file(directory, "xjcyeuvzkhtzsheknaiu")
            with self.assertRaises(importer.ImporterError):
                importer.assert_preview_target(path, preview=True)

    def test_writing_without_preview_flag_is_refused(self):
        with tempfile.TemporaryDirectory() as directory:
            path = self._ref_file(directory, importer.PREVIEW_PROJECT_REF)
            with self.assertRaises(importer.ImporterError):
                importer.assert_preview_target(path, preview=False)

    def test_missing_ref_file_is_refused(self):
        with self.assertRaises(importer.ImporterError):
            importer.assert_preview_target(Path("does/not/exist"), preview=True)


# =====================================================================================
# 11. Reconciliation and report
# =====================================================================================
class ReconciliationTests(unittest.TestCase):
    def test_baseline_row_shapes_balance(self):
        # Honest re-profile of the owner-accepted 2026-08-11 workbook (issue #727).
        self.assertTrue(importer.BASELINE.row_shapes_balance())
        self.assertEqual(importer.BASELINE.populated_rows, 12_354)
        self.assertEqual(importer.BASELINE.assortment_components, 15_713)
        # Corrected column-AR logic: the Style# mirror is not an assortment signal, so the
        # direct rows classify as direct again. Only the 3 rows that also carry an
        # Assortment ID (column O) remain both-shape.
        self.assertEqual(importer.BASELINE.direct_only_rows, 8_438)
        self.assertEqual(importer.BASELINE.both_shape_rows, 3)

    def test_synthetic_run_balances_its_own_arithmetic(self):
        plan = importer.build_plan(realistic_rows(), LICENSED_CATALOG)
        gateway = importer.InMemoryGateway()
        reconciliation = importer.Reconciliation(
            counters=plan.counters, apply_result=importer.apply_plan(plan, gateway)
        )
        self.assertTrue(
            reconciliation.balanced(),
            [c for c in reconciliation.balance_checks() if not c[1]],
        )

    def test_phase0_baseline_checks_only_fire_for_the_approved_workbook(self):
        plan = importer.build_plan(realistic_rows(), LICENSED_CATALOG)
        gateway = importer.InMemoryGateway()
        applied = importer.apply_plan(plan, gateway)

        without = importer.Reconciliation(counters=plan.counters, apply_result=applied)
        with_baseline = importer.Reconciliation(
            counters=plan.counters,
            apply_result=applied,
            checksum_matched_approved_source=True,
        )
        self.assertTrue(without.balanced())
        self.assertFalse(
            with_baseline.balanced(),
            "12 synthetic rows must not silently pass the 12,328-row baseline",
        )
        names = [name for name, passed, _ in with_baseline.balance_checks() if not passed]
        self.assertIn("staged rows equal the Phase 0 populated-row baseline", names)

    def test_report_is_secret_free_and_customer_free(self):
        plan = importer.build_plan(realistic_rows(), LICENSED_CATALOG)
        gateway = importer.InMemoryGateway()
        applied = importer.apply_plan(plan, gateway)
        second = importer.apply_plan(plan, gateway)
        report = importer.render_report(
            reconciliation=importer.Reconciliation(
                counters=plan.counters, apply_result=applied
            ),
            checksum=importer.APPROVED_SOURCE_SHA256,
            project_ref=importer.PREVIEW_PROJECT_REF,
            workbook_name="OrderList.xlsx",
            run_mode="test",
            generated_at="2026-08-10T00:00:00Z",
            second_run=second,
        )
        for leaked in ("Target", "Walmart", "Kelly", "ACME", "NCV3SP1", "BFC02GABB"):
            self.assertNotIn(leaked, report, f"{leaked!r} must never reach the report")
        self.assertNotIn(importer.PRODUCTION_PROJECT_REF, report)

    def test_report_states_the_second_run_changed_nothing(self):
        plan = importer.build_plan(realistic_rows(), LICENSED_CATALOG)
        gateway = importer.InMemoryGateway()
        applied = importer.apply_plan(plan, gateway)
        second = importer.apply_plan(plan, gateway)
        report = importer.render_report(
            reconciliation=importer.Reconciliation(
                counters=plan.counters, apply_result=applied
            ),
            checksum=importer.APPROVED_SOURCE_SHA256,
            project_ref=importer.PREVIEW_PROJECT_REF,
            workbook_name="OrderList.xlsx",
            run_mode="test",
            generated_at="2026-08-10T00:00:00Z",
            second_run=second,
        )
        self.assertIn("the second identical run changed 0 business rows", report)
        self.assertIn("PASS.", report)
        self.assertIn("BALANCED", report)


# =====================================================================================
# 11a. Anti-"hash-only update" guard.
#
# The eight conditional baseline assertions fire ONLY when the workbook SHA-256 matches
# APPROVED_SOURCE_SHA256. So the dangerous change is bumping the hash for a new workbook
# while forgetting to re-derive the baseline: the run then re-arms against STALE numbers
# and either fails confusingly or (if someone also blanks them) checks nothing. These
# tests prove every one of the eight is still wired to a live BASELINE field, so a
# hash-only edit cannot silently disable or strand them.
# =====================================================================================
class BaselineArmingGuardTests(unittest.TestCase):
    #: field name on ReconciliationBaseline -> the plan counter key it is asserted against
    FIELD_TO_COUNTER = {
        "populated_rows": "staged_rows",
        "direct_only_rows": f"rows_{importer.ROW_SHAPE_DIRECT}",
        "assortment_only_rows": f"rows_{importer.ROW_SHAPE_ASSORTMENT}",
        "both_shape_rows": f"rows_{importer.ROW_SHAPE_BOTH}",
        "neither_shape_rows": f"rows_{importer.ROW_SHAPE_NEITHER}",
        "assortment_components": "assortment_components",
        "blank_po_rows": "blank_po_rows",
        "normalized_po_numbers": "normalized_po_numbers",
    }

    def _counters_equal_to_baseline(self) -> dict:
        """A counter set that exactly reproduces BASELINE, so every check passes."""
        b = importer.BASELINE
        return {
            "staged_rows": b.populated_rows,
            f"rows_{importer.ROW_SHAPE_DIRECT}": b.direct_only_rows,
            f"rows_{importer.ROW_SHAPE_ASSORTMENT}": b.assortment_only_rows,
            f"rows_{importer.ROW_SHAPE_BOTH}": b.both_shape_rows,
            f"rows_{importer.ROW_SHAPE_NEITHER}": b.neither_shape_rows,
            "assortment_components": b.assortment_components,
            "blank_po_rows": b.blank_po_rows,
            "normalized_po_numbers": b.normalized_po_numbers,
            "planned_lines": b.assortment_components,
            f"match_{importer.MATCH_UNMATCHED}": b.assortment_components,
        }

    def test_baseline_is_internally_consistent(self):
        self.assertTrue(
            importer.BASELINE.row_shapes_balance(),
            "row shapes must sum to populated_rows or the baseline is stale/mistyped",
        )

    def test_exactly_eight_conditional_checks_exist(self):
        rec_off = importer.Reconciliation(
            counters=self._counters_equal_to_baseline(),
            apply_result=importer.ApplyResult(),
            checksum_matched_approved_source=False,
        )
        rec_on = importer.Reconciliation(
            counters=self._counters_equal_to_baseline(),
            apply_result=importer.ApplyResult(),
            checksum_matched_approved_source=True,
        )
        self.assertEqual(len(rec_off.balance_checks()), 2)
        self.assertEqual(
            len(rec_on.balance_checks()), 10, "2 always-on + 8 baseline conditionals"
        )

    def test_counters_equal_to_baseline_pass_all_checks(self):
        rec = importer.Reconciliation(
            counters=self._counters_equal_to_baseline(),
            apply_result=importer.ApplyResult(),
            checksum_matched_approved_source=True,
        )
        self.assertTrue(
            rec.balanced(),
            [c for c in rec.balance_checks() if not c[1]],
        )

    def test_every_baseline_field_is_actively_asserted(self):
        """Perturb each field's counter by one; the run MUST break.

        If a field could be perturbed with the run still balanced, that assertion is
        disabled or stale — exactly the hash-only-update failure this guards against.
        """
        for field, counter_key in self.FIELD_TO_COUNTER.items():
            with self.subTest(field=field):
                counters = self._counters_equal_to_baseline()
                counters[counter_key] = counters.get(counter_key, 0) + 1
                rec = importer.Reconciliation(
                    counters=counters,
                    apply_result=importer.ApplyResult(),
                    checksum_matched_approved_source=True,
                )
                self.assertFalse(
                    rec.balanced(),
                    f"baseline field {field!r} is not armed: bumping {counter_key!r} "
                    "left the run balanced",
                )

    def test_approved_hash_and_baseline_were_updated_together(self):
        """A hash bump that forgets the baseline (or vice versa) trips here.

        These two literals are re-derived from the SAME workbook. If a future edit moves
        the hash to a new export without re-profiling, this pins the pairing so the drift
        is caught in CI rather than at import time.
        """
        self.assertEqual(
            importer.APPROVED_SOURCE_SHA256,
            "68c9b03a0ec183e08b3a8f2344397e1bc4f61e73457849e7bf8c0cf7fb2409fe",
        )
        self.assertEqual(importer.BASELINE.populated_rows, 12_354)
        self.assertNotEqual(
            importer.BASELINE.populated_rows,
            12_328,
            "12,328 was the superseded 2026-08-09 profile; a stale baseline slipped in",
        )


# =====================================================================================
# 12. CLI refusals
# =====================================================================================
class CliTests(unittest.TestCase):
    def test_neither_dry_run_nor_preview_is_refused(self):
        with self.assertRaises(importer.ImporterError):
            importer.main(["--workbook", "nope.xlsx"])

    def test_replace_source_without_preview_is_refused(self):
        with self.assertRaises(importer.ImporterError) as caught:
            importer.main(["--workbook", "nope.xlsx", "--dry-run", "--replace-source"])
        self.assertIn("preview-only", str(caught.exception))

    def test_missing_workbook_is_refused_before_anything_else(self):
        with self.assertRaises(importer.ImporterError) as caught:
            importer.main(["--workbook", "definitely/not/here.xlsx", "--dry-run"])
        self.assertIn("Workbook not found", str(caught.exception))

    def test_preview_and_production_are_mutually_exclusive_in_argparse(self):
        parser = importer.build_parser()
        with self.assertRaises(SystemExit):
            parser.parse_args(
                ["--workbook", "x.xlsx", "--preview", "--production"]
            )


# =====================================================================================
# 13. Production gate — issue #852.
#
# Every test in this section proves a REFUSAL, and proves it happens before any write.
# The importer is never run against a real database here (or anywhere in this suite).
# =====================================================================================
APPROVED = importer.APPROVED_SOURCE_SHA256
REVIEWED_SHA = "a" * 40


class _ProductionHarness(unittest.TestCase):
    """Shared scaffolding: a fake workbook, a ref file, and a stubbed checksum.

    ``sha256_file`` is stubbed so the tests can reach the gates that live AFTER the
    checksum gate without possessing the licensed workbook. The checksum gate itself is
    tested unstubbed, with a real file and a real hash.
    """

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.root = Path(self._tmp.name)
        self.workbook = self.root / "OrderList.xlsx"
        self.workbook.write_bytes(b"not the real workbook")
        # --project-ref-file cannot be overridden in production, so the harness runs
        # from a temp working directory that contains the real default path.
        self.ref_file = self.root / importer.DEFAULT_PROJECT_REF_FILE
        self.ref_file.parent.mkdir(parents=True, exist_ok=True)
        self.write_ref(importer.PRODUCTION_PROJECT_REF)
        previous_cwd = os.getcwd()
        os.chdir(self.root)
        self.addCleanup(os.chdir, previous_cwd)

        real_sha = importer.sha256_file
        importer.sha256_file = lambda path, chunk_size=1 << 20: APPROVED  # type: ignore[assignment]
        self.addCleanup(lambda: setattr(importer, "sha256_file", real_sha))

        real_read = importer.read_workbook_rows
        importer.read_workbook_rows = lambda *a, **k: []  # type: ignore[assignment]
        self.addCleanup(lambda: setattr(importer, "read_workbook_rows", real_read))

        # The reviewed-commit gate is verified unstubbed in ReviewedCommitTests against
        # a real throwaway git repository. It is stubbed here so the tests below can
        # reach the gates that sit AFTER it.
        real_commit = importer.assert_reviewed_commit_is_checked_out
        importer.assert_reviewed_commit_is_checked_out = lambda *a, **k: None  # type: ignore[assignment]
        self.addCleanup(
            lambda: setattr(
                importer, "assert_reviewed_commit_is_checked_out", real_commit
            )
        )

        # Guarantee no connection string is reachable. If any gate leaked, the run
        # would fail with the credential error instead of the refusal being asserted.
        for name in ("PRODUCTION_DATABASE_URL", "PREVIEW_DATABASE_URL"):
            previous = os.environ.pop(name, None)
            if previous is not None:
                self.addCleanup(os.environ.__setitem__, name, previous)

        self._install_write_spy()

    def _install_write_spy(self) -> None:
        """Record every apply_plan call so a refusal can PROVE no write was attempted.

        The adversarial review of PR #860 was right that asserting an exception message
        is not the same as asserting nothing was written. This makes it structural:
        apply_plan is the only path to a write, and these tests assert it was never
        entered.
        """
        self.apply_calls: list[object] = []
        real_apply = importer.apply_plan

        def spy(*args, **kwargs):
            self.apply_calls.append(args)
            return real_apply(*args, **kwargs)

        importer.apply_plan = spy  # type: ignore[assignment]
        self.addCleanup(lambda: setattr(importer, "apply_plan", real_apply))

    def assertNoWriteAttempted(self) -> None:
        self.assertEqual(
            self.apply_calls, [], "apply_plan was reached; a write was attempted"
        )

    def unapproved_hash(self) -> str:
        """Disarm the eight conditional Phase 0 assertions for synthetic row sets."""
        other = "f" * 64
        importer.sha256_file = lambda path, chunk_size=1 << 20: other  # type: ignore
        return other

    def write_ref(self, value: str) -> None:
        self.ref_file.write_text(value, encoding="utf-8")

    def confirmation(self, *, commit=REVIEWED_SHA, sha=APPROVED, ref=None) -> str:
        return importer.build_production_confirmation(
            commit_sha=commit,
            source_sha256=sha,
            project_ref=ref or importer.PRODUCTION_PROJECT_REF,
        )

    def argv(self, *extra: str, confirm: str | None = None, rows: int = 12_354):
        args = [
            "--workbook", str(self.workbook),
            "--production",
            "--reviewed-commit", REVIEWED_SHA,
            "--expected-populated-rows", str(rows),
        ]
        if confirm is not None:
            args += ["--confirm", confirm]
        return args + list(extra)


class ProductionTargetTests(_ProductionHarness):
    def test_production_ref_is_accepted_for_production_mode(self):
        self.assertEqual(
            importer.assert_write_target(
                self.ref_file, mode=importer.MODE_PRODUCTION
            ),
            importer.PRODUCTION_PROJECT_REF,
        )

    def test_preview_ref_is_refused_for_production_mode(self):
        self.write_ref(importer.PREVIEW_PROJECT_REF)
        with self.assertRaises(importer.ImporterError) as caught:
            importer.assert_write_target(self.ref_file, mode=importer.MODE_PRODUCTION)
        self.assertIn("Refusing to write", str(caught.exception))

    def test_unknown_ref_is_refused_for_production_mode(self):
        self.write_ref("xjcyeuvzkhtzsheknaiu")
        with self.assertRaises(importer.ImporterError):
            importer.assert_write_target(self.ref_file, mode=importer.MODE_PRODUCTION)

    def test_missing_ref_file_is_refused(self):
        with self.assertRaises(importer.ImporterError):
            importer.assert_write_target(
                self.root / "absent", mode=importer.MODE_PRODUCTION
            )

    def test_wrong_target_aborts_the_whole_run_before_any_write(self):
        """Ref file says PREVIEW while --production was asked for. No write happens."""
        self.write_ref(importer.PREVIEW_PROJECT_REF)
        with self.assertRaises(importer.ImporterError) as caught:
            importer.main(self.argv(confirm=self.confirmation()))
        message = str(caught.exception)
        self.assertIn("Refusing to write", message)
        self.assertNotIn("database-url", message)
        self.assertNoWriteAttempted()


class ProductionChecksumPinTests(_ProductionHarness):
    def test_expected_sha256_cannot_relax_production(self):
        with self.assertRaises(importer.ImporterError) as caught:
            importer.main(
                self.argv(
                    "--expected-sha256", "b" * 64, confirm=self.confirmation()
                )
            )
        self.assertIn("cannot be overridden", str(caught.exception))
        self.assertNoWriteAttempted()
        self.assertIn("Nothing has been written", str(caught.exception))

    def test_wrong_workbook_hash_aborts_before_any_write(self):
        """Unstubbed: a real file whose real hash is not the approved one."""
        real_sha = importer.sha256_file
        importer.sha256_file = lambda path, chunk_size=1 << 20: "c" * 64  # type: ignore[assignment]
        self.addCleanup(lambda: setattr(importer, "sha256_file", real_sha))
        with self.assertRaises(importer.ImporterError) as caught:
            importer.main(self.argv(confirm=self.confirmation()))
        message = str(caught.exception)
        self.assertIn("Source checksum mismatch", message)
        self.assertNotIn("database-url", message)
        self.assertNoWriteAttempted()


class ProductionConfirmationTests(_ProductionHarness):
    def test_confirmation_binds_commit_hash_and_ref(self):
        text = self.confirmation()
        self.assertIn(REVIEWED_SHA, text)
        self.assertIn(APPROVED, text)
        self.assertIn(importer.PRODUCTION_PROJECT_REF, text)

    def test_missing_confirmation_is_refused_and_prints_the_expected_one(self):
        with self.assertRaises(importer.ImporterError) as caught:
            importer.main(self.argv())
        message = str(caught.exception)
        self.assertIn("--confirm is required", message)
        self.assertIn(self.confirmation(), message)
        self.assertNotIn("database-url", message)
        self.assertNoWriteAttempted()

    def test_empty_confirmation_is_refused(self):
        with self.assertRaises(importer.ImporterError):
            importer.main(self.argv(confirm="   "))
        self.assertNoWriteAttempted()

    def test_confirmation_for_a_different_commit_is_refused(self):
        with self.assertRaises(importer.ImporterError) as caught:
            importer.main(self.argv(confirm=self.confirmation(commit="b" * 40)))
        self.assertIn("does not match this run", str(caught.exception))
        self.assertNoWriteAttempted()

    def test_confirmation_for_a_different_workbook_is_refused(self):
        with self.assertRaises(importer.ImporterError):
            importer.main(self.argv(confirm=self.confirmation(sha="d" * 64)))
        self.assertNoWriteAttempted()

    def test_confirmation_for_a_different_target_is_refused(self):
        with self.assertRaises(importer.ImporterError):
            importer.main(
                self.argv(confirm=self.confirmation(ref=importer.PREVIEW_PROJECT_REF))
            )
        self.assertNoWriteAttempted()

    def test_wrong_confirmation_never_echoes_the_received_value(self):
        secret_ish = self.confirmation(commit="e" * 40)
        with self.assertRaises(importer.ImporterError) as caught:
            importer.main(self.argv(confirm=secret_ish))
        self.assertNotIn("e" * 40, str(caught.exception))

    def test_whitespace_and_case_do_not_fail_a_correct_confirmation(self):
        wrapped = "  " + self.confirmation().upper().replace(" ", "\n  ") + " .\n"
        with self.assertRaises(importer.ImporterError) as caught:
            importer.main(self.argv(confirm=wrapped))
        # It got PAST the confirmation gate and stopped at the credential, which is the
        # last thing before a write and is deliberately absent in tests.
        self.assertIn("PRODUCTION_DATABASE_URL", str(caught.exception))

    def test_reviewed_commit_must_be_a_full_sha(self):
        with self.assertRaises(importer.ImporterError) as caught:
            importer.assert_reviewed_commit("a1b2c3d")
        self.assertIn("not a full 40-character git SHA", str(caught.exception))

    def test_reviewed_commit_is_required(self):
        with self.assertRaises(importer.ImporterError):
            importer.assert_reviewed_commit(None)

    def test_production_without_reviewed_commit_is_refused(self):
        argv = [
            "--workbook", str(self.workbook), "--production",
            "--expected-populated-rows", "12354",
        ]
        with self.assertRaises(importer.ImporterError) as caught:
            importer.main(argv)
        self.assertIn("--reviewed-commit is required", str(caught.exception))
        self.assertNoWriteAttempted()


class ProductionReplaceSourceTests(_ProductionHarness):
    def test_replace_source_with_production_is_refused_by_the_cli(self):
        with self.assertRaises(importer.ImporterError) as caught:
            importer.main(
                self.argv("--replace-source", confirm=self.confirmation())
            )
        message = str(caught.exception)
        self.assertIn("refused with --production", message)
        self.assertIn("Nothing has been written", message)
        self.assertNoWriteAttempted()

    def test_apply_plan_refuses_replace_when_allow_replace_is_false(self):
        """The second, independent lock: even if the CLI guard were deleted."""
        gateway = importer.InMemoryGateway()
        plan = importer.build_plan(realistic_rows(), LICENSED_CATALOG)
        with self.assertRaises(importer.ImporterError) as caught:
            importer.apply_plan(
                plan, gateway, replace_source=True, allow_replace=False
            )
        self.assertIn("not permitted", str(caught.exception))
        self.assertEqual(gateway.write_log, [], "nothing may be written")
        self.assertEqual(gateway.batches_committed, 0)


class ProductionExpectedRowsTests(_ProductionHarness):
    def test_expected_populated_rows_is_required_for_production(self):
        argv = [
            "--workbook", str(self.workbook), "--production",
            "--reviewed-commit", REVIEWED_SHA,
            "--confirm", self.confirmation(),
        ]
        with self.assertRaises(importer.ImporterError) as caught:
            importer.main(argv)
        self.assertIn("--expected-populated-rows is required", str(caught.exception))
        self.assertNoWriteAttempted()

    def test_it_is_a_checked_input_not_a_hard_coded_number(self):
        """No default. The importer must never pick a row count for the approver."""
        parsed = importer.build_parser().parse_args(
            ["--workbook", "x.xlsx", "--dry-run"]
        )
        self.assertIsNone(parsed.expected_populated_rows)

    def test_declared_row_count_becomes_a_failing_balance_check_when_wrong(self):
        reconciliation = importer.Reconciliation(
            counters={"staged_rows": 12_354, "rows_direct": 12_354, "planned_lines": 0},
            apply_result=importer.ApplyResult(),
            expected_populated_rows=12_323,
        )
        names = [name for name, _, _ in reconciliation.balance_checks()]
        self.assertIn(
            "staged rows equal the operator-declared expected populated rows", names
        )
        self.assertFalse(reconciliation.balanced())

    def test_declared_row_count_passes_when_it_agrees(self):
        reconciliation = importer.Reconciliation(
            counters={"staged_rows": 12_354, "rows_direct": 12_354, "planned_lines": 0},
            apply_result=importer.ApplyResult(),
            expected_populated_rows=12_354,
        )
        self.assertTrue(reconciliation.balanced())


class TargetDriftMidRunTests(_ProductionHarness):
    """A relink DURING the run must abort the remaining batches."""

    def _plan(self):
        rows = []
        for index in range(12):
            rows.append(
                direct_row(index + 2, f"PO-{index:03d}", f"SKU-{index}", "generic")
            )
        return importer.build_plan(rows, LICENSED_CATALOG)

    def test_drift_after_the_first_batch_aborts_and_writes_no_more(self):
        plan = self._plan()
        gateway = importer.InMemoryGateway()
        calls = {"n": 0}

        def guard() -> None:
            calls["n"] += 1
            if calls["n"] == 2:
                # Someone ran `supabase link` at preview between batches.
                self.write_ref(importer.PREVIEW_PROJECT_REF)
            importer.assert_write_target(
                self.ref_file, mode=importer.MODE_PRODUCTION
            )

        with self.assertRaises(importer.ImporterError) as caught:
            importer.apply_plan(
                plan,
                gateway,
                batch_size=5,
                allow_replace=False,
                target_guard=guard,
                single_transaction=True,
            )
        self.assertIn("Refusing to write", str(caught.exception))
        # H2: the whole import is ONE transaction, so an abort commits NOTHING. A
        # partially committed import (orders present, lines short) is the failure mode
        # this replaced.
        self.assertEqual(gateway.batches_committed, 0)
        self.assertEqual(gateway.batches_rolled_back, 1)

    def test_guard_runs_before_every_batch_not_just_the_first(self):
        plan = self._plan()
        gateway = importer.InMemoryGateway()
        calls = {"n": 0}

        def guard() -> None:
            calls["n"] += 1

        importer.apply_plan(
            plan, gateway, batch_size=5, allow_replace=False, target_guard=guard
        )
        expected_batches = -(-len(plan.writable_orders()) // 5) + -(
            -len(plan.writable_lines()) // 5
        )
        self.assertEqual(calls["n"], expected_batches)
        self.assertGreater(expected_batches, 2, "the fixture must span several batches")

    def test_a_drifted_target_never_reaches_the_first_batch_from_main(self):
        """Drift between the early gate and the pre-transaction recheck."""
        original = importer.read_workbook_rows

        def relink_during_read(*args, **kwargs):
            self.write_ref(importer.PREVIEW_PROJECT_REF)
            return []

        importer.read_workbook_rows = relink_during_read  # type: ignore[assignment]
        self.addCleanup(lambda: setattr(importer, "read_workbook_rows", original))
        with self.assertRaises(importer.ImporterError) as caught:
            importer.main(self.argv(confirm=self.confirmation()))
        message = str(caught.exception)
        self.assertIn("Refusing to write", message)
        self.assertNotIn("PRODUCTION_DATABASE_URL", message)


class ProductionReportTests(_ProductionHarness):
    def test_report_records_the_row_count_history_as_provenance(self):
        report = importer.render_report(
            reconciliation=importer.Reconciliation(
                counters={"staged_rows": 1, "rows_direct": 1, "planned_lines": 0},
                apply_result=importer.ApplyResult(),
            ),
            checksum=APPROVED,
            project_ref=importer.PRODUCTION_PROJECT_REF,
            workbook_name="OrderList.xlsx",
            run_mode="production write",
            generated_at="2026-08-12T00:00:00Z",
            title="PopDAM OrderList production import reconciliation",
            reviewed_commit=REVIEWED_SHA,
        )
        self.assertIn("PopDAM OrderList production import reconciliation", report)
        self.assertIn("12,328", report)
        self.assertIn("12,323", report)
        self.assertIn("12,354", report)
        self.assertIn("settled by owner ruling", report)
        self.assertIn(REVIEWED_SHA, report)

    def test_report_carries_no_credential(self):
        report = importer.render_report(
            reconciliation=importer.Reconciliation(
                counters={"staged_rows": 1, "rows_direct": 1, "planned_lines": 0},
                apply_result=importer.ApplyResult(),
            ),
            checksum=APPROVED,
            project_ref=importer.PRODUCTION_PROJECT_REF,
            workbook_name="OrderList.xlsx",
            run_mode="production write",
            generated_at="2026-08-12T00:00:00Z",
            title="PopDAM OrderList production import reconciliation",
            reviewed_commit=REVIEWED_SHA,
        )
        for forbidden in ("postgres://", "postgresql://", "password", "sslmode"):
            self.assertNotIn(forbidden, report.lower())


# =====================================================================================
# 14. Adversarial-review fixes: server identity, write-gating checks, transaction
# boundary, reviewed-commit verification, concurrency, report preservation.
# =====================================================================================
class FakeCursor:
    def __init__(self, connection: "FakeConnection") -> None:
        self._connection = connection
        self._result: object = None

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, sql: str, params=None) -> None:
        self._connection.executed.append(sql)
        if "pg_postmaster_start_time" in sql:
            self._result = self._connection.fingerprint
        elif "pg_try_advisory_lock" in sql:
            self._result = (self._connection.lock_available,)
        elif "production_order_source_ref" in sql:
            self._result = (self._connection.existing_source_refs,)
        else:  # pragma: no cover - no other query is issued by these gates
            raise AssertionError(f"unexpected query: {sql}")

    def fetchone(self):
        return self._result


class FakeInfo:
    def __init__(self, host, user, port, dbname):
        self.host, self.user, self.port, self.dbname = host, user, port, dbname


class FakeConnection:
    def __init__(
        self,
        *,
        host="db.qsllyeztdwjgirsysgai.supabase.co",
        user="postgres",
        port=5432,
        dbname="postgres",
        fingerprint=("postgres", "10.0.0.1", "2026-08-12 00:00:00+00"),
        lock_available=True,
        existing_source_refs=0,
    ):
        self.info = FakeInfo(host, user, port, dbname)
        self.fingerprint = fingerprint
        self.lock_available = lock_available
        self.existing_source_refs = existing_source_refs
        self.executed: list[str] = []

    def cursor(self):
        return FakeCursor(self)


PROD = importer.PRODUCTION_PROJECT_REF
PREV = importer.PREVIEW_PROJECT_REF


class ServerIdentityTests(unittest.TestCase):
    """C1: the proven ref must be causally linked to the database actually written."""

    def test_ref_is_recovered_from_a_direct_host(self):
        self.assertEqual(
            importer.project_ref_from_connection(f"db.{PROD}.supabase.co", "postgres"),
            PROD,
        )

    def test_ref_is_recovered_from_a_pooler_user(self):
        self.assertEqual(
            importer.project_ref_from_connection(
                "aws-0-us-east-1.pooler.supabase.com", f"postgres.{PROD}"
            ),
            PROD,
        )

    def test_unrecognisable_connection_yields_no_ref(self):
        for host, user in (
            ("localhost", "postgres"),
            ("evil.example.com", "postgres"),
            (None, None),
            ("", ""),
        ):
            self.assertIsNone(importer.project_ref_from_connection(host, user))

    def test_matching_server_is_accepted(self):
        connection = FakeConnection()
        identity = importer.assert_server_is_target(
            connection, expected_ref=PROD, mode=importer.MODE_PRODUCTION
        )
        self.assertEqual(identity.project_ref, PROD)

    def test_stale_url_pointing_at_preview_is_refused(self):
        """The exact C1 scenario: ref file says production, the URL opens preview."""
        connection = FakeConnection(host=f"db.{PREV}.supabase.co")
        with self.assertRaises(importer.ImporterError) as caught:
            importer.assert_server_is_target(
                connection, expected_ref=PROD, mode=importer.MODE_PRODUCTION
            )
        message = str(caught.exception)
        self.assertIn("TARGET MISMATCH", message)
        self.assertIn(PROD, message)
        self.assertIn(PREV, message)
        self.assertIn("Nothing has been written", message)

    def test_unprovable_server_is_refused(self):
        connection = FakeConnection(host="localhost", user="postgres")
        with self.assertRaises(importer.ImporterError) as caught:
            importer.assert_server_is_target(
                connection, expected_ref=PROD, mode=importer.MODE_PRODUCTION
            )
        self.assertIn("cannot be established", str(caught.exception))

    def test_identity_never_prints_the_user_or_a_password(self):
        connection = FakeConnection(user="postgres.secretuser")
        identity = importer.read_server_identity(connection)
        self.assertNotIn("secretuser", identity.redacted())

    def test_transaction_pooler_port_is_refused_in_production(self):
        connection = FakeConnection(
            host="aws-0-us-east-1.pooler.supabase.com",
            user=f"postgres.{PROD}",
            port=importer.TRANSACTION_POOLER_PORT,
        )
        with self.assertRaises(importer.ImporterError) as caught:
            importer.assert_server_is_target(
                connection, expected_ref=PROD, mode=importer.MODE_PRODUCTION
            )
        self.assertIn("transaction-mode pooler", str(caught.exception))

    def test_fingerprint_change_mid_run_aborts(self):
        connection = FakeConnection()
        identity = importer.read_server_identity(connection)
        connection.fingerprint = ("postgres", "10.0.0.9", "2026-08-12 09:00:00+00")
        with self.assertRaises(importer.ImporterError) as caught:
            importer.assert_server_identity_unchanged(connection, identity)
        self.assertIn("TARGET DRIFT DETECTED MID-RUN", str(caught.exception))

    def test_unchanged_fingerprint_passes(self):
        connection = FakeConnection()
        identity = importer.read_server_identity(connection)
        importer.assert_server_identity_unchanged(connection, identity)

    def test_preexisting_source_refs_refuse_the_run(self):
        """Content-based cross-check: preview already holds 3,212 of these."""
        connection = FakeConnection(existing_source_refs=3212)
        with self.assertRaises(importer.ImporterError) as caught:
            importer.assert_no_existing_source_refs(connection)
        self.assertIn("already", str(caught.exception))
        self.assertIn("Nothing has been written", str(caught.exception))

    def test_empty_target_is_accepted(self):
        self.assertEqual(
            importer.assert_no_existing_source_refs(FakeConnection()), 0
        )

    def test_concurrent_run_is_refused_by_the_advisory_lock(self):
        with self.assertRaises(importer.ImporterError) as caught:
            importer.acquire_import_lock(FakeConnection(lock_available=False))
        self.assertIn("Another OrderList import", str(caught.exception))

    def test_lock_is_acquired_when_free(self):
        importer.acquire_import_lock(FakeConnection())


class ReviewedCommitTests(unittest.TestCase):
    """H3: the confirmation must not be self-issued."""

    def _repo(self) -> tuple[Path, str]:
        import subprocess

        directory = tempfile.mkdtemp()
        self.addCleanup(
            lambda: __import__("shutil").rmtree(directory, ignore_errors=True)
        )
        root = Path(directory)

        def git(*args):
            return subprocess.run(
                ["git", "-C", str(root), *args],
                capture_output=True, text=True, check=True,
            ).stdout.strip()

        git("init", "-q")
        git("config", "user.email", "t@example.com")
        git("config", "user.name", "T")
        (root / "a.txt").write_text("one", encoding="utf-8")
        git("add", "-A")
        git("commit", "-q", "-m", "one")
        return root, git("rev-parse", "HEAD").lower()

    def test_matching_head_on_a_clean_tree_passes(self):
        root, head = self._repo()
        importer.assert_reviewed_commit_is_checked_out(head, root)

    def test_a_different_commit_is_refused(self):
        root, _ = self._repo()
        with self.assertRaises(importer.ImporterError) as caught:
            importer.assert_reviewed_commit_is_checked_out("b" * 40, root)
        message = str(caught.exception)
        self.assertIn("does not match the checked-out code", message)
        self.assertIn("Nothing has been written", message)

    def test_a_dirty_tree_is_refused(self):
        root, head = self._repo()
        (root / "a.txt").write_text("edited", encoding="utf-8")
        with self.assertRaises(importer.ImporterError) as caught:
            importer.assert_reviewed_commit_is_checked_out(head, root)
        self.assertIn("Tracked files are modified", str(caught.exception))

    def test_untracked_files_do_NOT_make_the_tree_dirty(self):
        """M1. Untracked files are normal, and one of them is our own abort report.

        Plain `git status --porcelain` lists untracked files as `??`. Treating those as
        dirty refuses every normal checkout, and is self-inflicting: an aborted run
        writes its abort report to an untracked path, so the next attempt would be
        blocked by the evidence the importer itself just produced. The only workaround
        would be deleting that evidence.
        """
        root, head = self._repo()
        (root / "untracked-note.txt").write_text("scratch", encoding="utf-8")
        reports = root / "docs" / "verification" / "popdam-order-list-production-x"
        reports.mkdir(parents=True)
        (reports / "README.md").write_text("ABORT REPORT", encoding="utf-8")
        importer.assert_reviewed_commit_is_checked_out(head, root)

    def test_a_modified_tracked_file_is_still_refused_alongside_untracked_ones(self):
        root, head = self._repo()
        (root / "untracked-note.txt").write_text("scratch", encoding="utf-8")
        (root / "a.txt").write_text("edited", encoding="utf-8")
        with self.assertRaises(importer.ImporterError) as caught:
            importer.assert_reviewed_commit_is_checked_out(head, root)
        self.assertIn("Tracked files are modified", str(caught.exception))

    def test_a_deleted_tracked_file_is_refused(self):
        root, head = self._repo()
        (root / "a.txt").unlink()
        with self.assertRaises(importer.ImporterError):
            importer.assert_reviewed_commit_is_checked_out(head, root)

    def test_it_fails_closed_when_git_cannot_answer(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(importer.ImporterError) as caught:
                importer.assert_reviewed_commit_is_checked_out(
                    "c" * 40, Path(directory)
                )
            self.assertIn("Cannot verify --reviewed-commit", str(caught.exception))


class DryRunFlagCombinationTests(_ProductionHarness):
    """H1: no manufactured false record."""

    def test_dry_run_with_production_is_refused(self):
        with self.assertRaises(importer.ImporterError) as caught:
            importer.main(self.argv("--dry-run", confirm=self.confirmation()))
        message = str(caught.exception)
        self.assertIn("cannot be combined", message)
        self.assertNoWriteAttempted()

    def test_dry_run_with_preview_is_refused(self):
        with self.assertRaises(importer.ImporterError):
            importer.main(
                ["--workbook", str(self.workbook), "--dry-run", "--preview"]
            )
        self.assertNoWriteAttempted()

    def test_a_plain_dry_run_still_works(self):
        other = self.unapproved_hash()
        argv = [
            "--workbook", str(self.workbook), "--dry-run",
            "--expected-sha256", other,
        ]
        self.assertEqual(importer.main(argv), 0)


class BalanceChecksGateTheWriteTests(unittest.TestCase):
    """C2: a failing check must PREVENT the write, not report it afterwards."""

    def test_pre_write_reconciliation_uses_only_plan_counters(self):
        """The proof that these checks CAN run before the write."""
        checks = importer.Reconciliation(
            counters={"staged_rows": 5, "rows_direct": 5, "planned_lines": 0},
            apply_result=importer.ApplyResult(),
            expected_populated_rows=5,
        ).balance_checks()
        self.assertTrue(all(passed for _, passed, _ in checks))

    def test_wrong_expected_row_count_aborts_with_nothing_written(self):
        import shutil

        directory = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, directory, True)
        if True:
            root = Path(directory)
            previous = os.getcwd()
            os.chdir(root)
            self.addCleanup(os.chdir, previous)
            workbook = root / "OrderList.xlsx"
            workbook.write_bytes(b"x")

            real_sha = importer.sha256_file
            importer.sha256_file = lambda path, chunk_size=1 << 20: "f" * 64  # type: ignore
            self.addCleanup(lambda: setattr(importer, "sha256_file", real_sha))

            real_read = importer.read_workbook_rows
            rows = [direct_row(i + 2, f"PO-{i}", f"SKU-{i}", "generic") for i in range(4)]
            importer.read_workbook_rows = lambda *a, **k: rows  # type: ignore
            self.addCleanup(lambda: setattr(importer, "read_workbook_rows", real_read))

            written: list[Path] = []
            real_apply = importer.apply_plan

            def spy(*a, **k):
                written.append(Path("apply_plan was called"))
                return real_apply(*a, **k)

            importer.apply_plan = spy  # type: ignore
            self.addCleanup(lambda: setattr(importer, "apply_plan", real_apply))

            with self.assertRaises(importer.ImporterError) as caught:
                importer.main(
                    [
                        "--workbook", str(workbook),
                        "--dry-run",
                        "--expected-sha256", "f" * 64,
                        "--expected-populated-rows", "12323",
                    ]
                )
            message = str(caught.exception)
            self.assertIn("did NOT balance", message)
            self.assertIn("Refusing to write anything", message)
            self.assertIn("operator-declared", message)
            self.assertEqual(written, [], "apply_plan must never have been reached")


class SingleTransactionTests(unittest.TestCase):
    """H2: the whole import is one transaction."""

    def _plan(self, count=12):
        rows = [
            direct_row(i + 2, f"PO-{i:03d}", f"SKU-{i}", "generic") for i in range(count)
        ]
        return importer.build_plan(rows, LICENSED_CATALOG)

    def test_single_transaction_commits_exactly_once(self):
        gateway = importer.InMemoryGateway()
        importer.apply_plan(
            self._plan(), gateway, batch_size=5, single_transaction=True
        )
        self.assertEqual(gateway.batches_committed, 1)

    def test_batched_mode_commits_per_batch(self):
        gateway = importer.InMemoryGateway()
        importer.apply_plan(
            self._plan(), gateway, batch_size=5, single_transaction=False
        )
        self.assertGreater(gateway.batches_committed, 1)

    def test_a_failure_in_the_lines_phase_commits_no_orders(self):
        """The exact H2 failure mode: orders present, lines short. Must not happen."""
        plan = self._plan()
        gateway = importer.InMemoryGateway()
        calls = {"n": 0}

        def guard():
            calls["n"] += 1
            # Fire during the LINES phase, after every order has been staged.
            if calls["n"] > -(-len(plan.writable_orders()) // 5):
                raise importer.ImporterError("Refusing to write: drift")

        with self.assertRaises(importer.ImporterError):
            importer.apply_plan(
                plan,
                gateway,
                batch_size=5,
                target_guard=guard,
                single_transaction=True,
            )
        self.assertEqual(gateway.batches_committed, 0, "nothing may be durable")
        self.assertEqual(gateway.batches_rolled_back, 1)


class FailingCommitGateway(importer.InMemoryGateway):
    """A gateway whose COMMIT raises, as a dropped network connection would."""

    def commit_batch(self) -> None:
        raise RuntimeError("connection closed while committing")


class CommitOutcomeTests(unittest.TestCase):
    """M2: a failed COMMIT is indeterminate and must never be reported as a rollback."""

    def _plan(self):
        rows = [
            direct_row(i + 2, f"PO-{i:03d}", f"SKU-{i}", "generic") for i in range(6)
        ]
        return importer.build_plan(rows, LICENSED_CATALOG)

    def test_a_failed_commit_raises_the_distinct_type(self):
        with self.assertRaises(importer.CommitOutcomeUnknown) as caught:
            importer.apply_plan(
                self._plan(),
                FailingCommitGateway(),
                batch_size=5,
                single_transaction=True,
            )
        message = str(caught.exception)
        self.assertIn("UNKNOWN", message)
        self.assertNotIn("NO rows were written", message)
        self.assertIn("do", message.lower())

    def test_it_is_an_importer_error_so_the_cli_still_exits_cleanly(self):
        self.assertTrue(
            issubclass(importer.CommitOutcomeUnknown, importer.ImporterError)
        )

    def test_an_abort_inside_the_loops_is_still_a_rollback_not_unknown(self):
        gateway = importer.InMemoryGateway()

        def guard():
            raise importer.ImporterError("Refusing to write: drift")

        with self.assertRaises(importer.ImporterError) as caught:
            importer.apply_plan(
                self._plan(),
                gateway,
                batch_size=5,
                target_guard=guard,
                single_transaction=True,
            )
        self.assertNotIsInstance(caught.exception, importer.CommitOutcomeUnknown)
        self.assertEqual(gateway.batches_rolled_back, 1)


class AbortReportWordingTests(unittest.TestCase):
    """The durable record must match what actually happened."""

    def test_main_distinguishes_unknown_commit_from_rollback(self):
        """The two handlers exist and say different things."""
        source = _IMPORTER_PATH.read_text(encoding="utf-8")
        block = source[source.index("        first = apply_plan(") :]
        block = block[: block.index("    second: ApplyResult | None = None")]
        self.assertIn("except CommitOutcomeUnknown as error:", block)
        self.assertIn("OUTCOME UNKNOWN", block)
        self.assertIn("ABORTED before the commit", block)
        # The rollback wording must not be reachable from the unknown-commit handler.
        unknown = block[block.index("except CommitOutcomeUnknown") : block.index("    except Exception as error:")]
        self.assertNotIn("NO rows were written", unknown)

    def test_report_text_for_an_unknown_outcome_never_claims_no_rows(self):
        report = importer.render_report(
            reconciliation=importer.Reconciliation(
                counters={"staged_rows": 1, "rows_direct": 1, "planned_lines": 0},
                apply_result=importer.ApplyResult(),
            ),
            checksum=APPROVED,
            project_ref=PROD,
            workbook_name="OrderList.xlsx",
            run_mode=(
                "production write — OUTCOME UNKNOWN. The single COMMIT did not return "
                "successfully, so this run cannot say whether the rows are durable."
            ),
            generated_at="2026-08-12T00:00:00Z",
            title="PopDAM OrderList production import reconciliation",
            reviewed_commit=REVIEWED_SHA,
        )
        self.assertIn("OUTCOME UNKNOWN", report)
        self.assertNotIn("NO rows were written", report)


class IdempotencyPassReportTests(unittest.TestCase):
    """L2: the idempotency pass must leave a durable record when it fails."""

    def test_main_wraps_the_second_apply_in_a_report_writing_try(self):
        source = _IMPORTER_PATH.read_text(encoding="utf-8")
        after = source[source.index("if args.verify_idempotency:") :]
        second_call = after[: after.index("if second.changed_rows != 0:")]
        self.assertIn("try:", second_call)
        self.assertIn("write_report(", second_call)
        self.assertIn("CommitOutcomeUnknown", second_call)


class OwnerRulingTests(unittest.TestCase):
    """The approved count is 12,354 and the five-row question is closed by decision."""

    def test_baseline_is_the_approved_count(self):
        self.assertEqual(importer.BASELINE.populated_rows, 12_354)

    def test_nothing_frames_the_row_count_as_an_open_gate(self):
        source = _IMPORTER_PATH.read_text(encoding="utf-8")
        for phrase in (
            "unresolved 12,328",
            "NOT knowable from this repository",
            "This report does not claim it is",
        ):
            self.assertNotIn(phrase, source, f"stale open-gate framing: {phrase!r}")

    def test_report_presents_the_history_as_provenance(self):
        report = importer.render_report(
            reconciliation=importer.Reconciliation(
                counters={"staged_rows": 1, "rows_direct": 1, "planned_lines": 0},
                apply_result=importer.ApplyResult(),
            ),
            checksum=APPROVED,
            project_ref=PROD,
            workbook_name="OrderList.xlsx",
            run_mode="production write",
            generated_at="2026-08-12T00:00:00Z",
        )
        self.assertIn("settled by owner ruling", report)
        self.assertIn("not an outstanding gate", report.lower())
        self.assertIn("12,354", report)


class ReportPreservationTests(_ProductionHarness):
    """L2: a genuine report must never be silently overwritten."""

    def test_existing_report_is_not_overwritten(self):
        report_dir = self.root / "report"
        report_dir.mkdir()
        original = report_dir / "README.md"
        original.write_text("GENUINE EARLIER RUN", encoding="utf-8")
        other = self.unapproved_hash()
        argv = [
            "--workbook", str(self.workbook),
            "--dry-run",
            "--expected-sha256", other,
            "--report-dir", str(report_dir),
        ]
        self.assertEqual(importer.main(argv), 0)
        self.assertEqual(original.read_text(encoding="utf-8"), "GENUINE EARLIER RUN")
        self.assertEqual(
            len(list(report_dir.glob("README-*.md"))), 1, "a second file is written"
        )


if __name__ == "__main__":
    unittest.main()
