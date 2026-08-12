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

    def test_there_is_no_production_flag(self):
        help_text = importer.build_parser().format_help()
        self.assertNotIn("--production", help_text)
        self.assertIn("--preview", help_text)


if __name__ == "__main__":
    unittest.main()
