import unittest
from collections import Counter

import pandas as pd

from hierarchical_item_taxonomy import (
    TaxonomyValidity, build_associations, choose_at_level, classify_axes,
    classify_product_type, code_validity, parse_description, usable_description,
)
from product_type_dictionary import SemanticSignature, classify_semantic_signature, validate_signature


class DescriptionParsingTests(unittest.TestCase):
    def test_five_chunks(self):
        parsed = parse_description('Disney Printed Glass Shadowbox Stitch wink blue 12x12"', ["Disney"], ["Stitch"])
        self.assertEqual((parsed.product_type, parsed.construction_shape), ("Framed Glass Shadowbox", "Glass Shadowbox"))
        self.assertEqual((parsed.size, parsed.licensor, parsed.property), ('12x12"', "Disney", "Stitch"))

    def test_canvas_treatments_are_separate(self):
        foil = parse_description("Printed Canvas w Holofoil_Mamba 16x20", [], [])
        gloss = parse_description("Canvas w High Gloss_Fox 16x20", [], [])
        self.assertEqual((foil.product_type, foil.treatment), ("Canvas", "Foil"))
        self.assertEqual((gloss.product_type, gloss.treatment), ("Canvas", "High Gloss"))

    def test_consolidation_aliases(self):
        values = ["Anti Fatigue Pvc Kitchen", "Anti Fatique Kitchen Mat", "Anti Fatique Pvc Kitchen Mat"]
        signatures = [classify_semantic_signature(value) for value in values]
        self.assertEqual({x.physical_product for x in signatures}, {"Kitchen Mat"})
        self.assertEqual({x.construction_shape for x in signatures}, {"Anti-Fatigue PVC"})

    def test_door_and_outdoor_mats_remain_separate(self):
        door = classify_semantic_signature("Crumb Rubber Door Mat_Bows 30x18")
        outdoor = classify_semantic_signature("Crumb Rubber Outdoor Mat_Bows 30x18")
        self.assertNotEqual(door.construction_shape, outdoor.construction_shape)

    def test_placeholder_and_unknown_are_not_accepted(self):
        self.assertEqual(classify_semantic_signature("Created for Testing").status, "placeholder")
        self.assertFalse(usable_description("Created for Testing"))
        self.assertEqual(classify_semantic_signature("Marvel Thor Blue").status, "needs_review")

    def test_generic_noun_is_rejected(self):
        self.assertTrue(validate_signature(SemanticSignature("Wall Decor", "", "", "Art", "accepted")))

    def test_paint_your_own(self):
        self.assertEqual(classify_semantic_signature("2Pc Canvas Set Paint Pots Brush 11x14").physical_product, "Paint-Your-Own Canvas Set")


class HierarchyTests(unittest.TestCase):
    def associations(self):
        rows = [
            ("Canvas", "Stretched", "Foil", "A", "A2", "01"), ("Canvas", "Stretched", "Foil", "A", "A2", "01"),
            ("Canvas", "Stretched", "High Gloss", "A", "A2", "11"), ("Canvas", "Stretched", "High Gloss", "A", "A2", "11"),
            ("Wall Clock", "Clock", "", "M", "W1", "B1"), ("Wall Clock", "Clock", "", "M", "W1", "B1"),
            ("Storage Bin", "Fabric", "", "N", "B1", "X1"), ("Storage Bin", "Fabric", "", "N", "H1", "N2"),
        ]
        frame = pd.DataFrame(rows, columns=["Product Type", "Construction Shape", "Treatment", "MG01", "MG02", "MG03"])
        frame["Item Desc"] = frame["Product Type"]
        frame["Dictionary Status"] = "alias"
        frame["Description Usable for Product Matching"] = "Yes"
        return build_associations(frame)[1]

    def test_exact_treatment_reaches_full_key(self):
        result = classify_product_type("Canvas", self.associations(), "Stretched", "Foil")
        self.assertEqual((result["depth"], result["key"]), (3, "A|A2|01"))

    def test_missing_treatment_falls_back_to_pair(self):
        result = classify_product_type("Canvas", self.associations(), "Stretched", "")
        self.assertEqual((result["depth"], result["key"]), (2, "A|A2"))

    def test_ambiguous_pair_falls_back_to_mg01(self):
        result = classify_product_type("Storage Bin", self.associations(), "Fabric", "")
        self.assertEqual((result["depth"], result["key"]), (1, "N"))

    def test_historical_codes_are_not_an_input(self):
        reverse = {3: {}, 2: {"clocks|clock": Counter({"M|W1": 2})}, 1: {}}
        self.assertEqual(classify_product_type("Wall Clock", reverse, "Clock", "")["key"], "M|W1")

    def test_singleton_falls_back_to_taxonomy_mg01(self):
        reverse = {3: {"wall clock|clock|": Counter({"M|W1|B1": 1})}, 2: {}, 1: {}}
        self.assertEqual(classify_product_type("Wall Clock", reverse, "Clock", "")["depth"], 1)

    def test_runner_up_gate_falls_back_to_taxonomy_mg01(self):
        reverse = {3: {}, 2: {}, 1: {"stretched or box": Counter({"A": 4, "B": 3})}}
        self.assertEqual(classify_product_type("Canvas", reverse)["key"], "A")

    def test_review_rows_are_excluded(self):
        frame = pd.DataFrame([{"Product Type": "Canvas", "Construction Shape": "Stretched", "Treatment": "", "MG01": "A", "MG02": "A2", "MG03": "01", "Item Desc": "Canvas", "Dictionary Status": "needs_review", "Description Usable for Product Matching": "Yes"}])
        self.assertEqual(build_associations(frame)[1][1], {})


class ThreeAxisRepairTests(unittest.TestCase):
    def signature(self, text):
        return classify_semantic_signature(text)

    def axis_frame(self, rows):
        columns = ["Form", "Taxonomy Subtype", "Embellishment", "Embellishment State", "MG01", "MG02", "MG03"]
        frame = pd.DataFrame(rows, columns=columns)
        frame["Product Type"] = frame["Form"]
        frame["Item Desc"] = frame["Form"]
        frame["Dictionary Status"] = "alias"
        frame["Description Usable for Product Matching"] = "Yes"
        return frame

    def test_01_canvas_storage_bin_form_beats_material(self):
        value = self.signature("Canvas Storage Bin")
        self.assertEqual((value.form, value.subtype, value.material), ("Soft Storage", "Bin", "Canvas"))

    def test_02_canvas_storage_forms(self):
        values = [self.signature(value).form for value in ("Canvas Hamper", "Canvas Storage Tote", "Canvas Toy Chest")]
        self.assertEqual(values, ["Soft Storage"] * 3)

    def test_03_canvas_variants_share_form_and_subtype(self):
        values = [self.signature(value) for value in ("Glitter Canvas", "Foil Canvas", "Printed Canvas")]
        self.assertEqual({(value.form, value.subtype) for value in values}, {("Stretched or Box", "Canvas")})
        self.assertEqual(values[2].embellishment_state, "unreadable")

    def test_04_form_beats_material_regardless_of_order(self):
        left = self.signature("Canvas Storage Bin")
        right = self.signature("Storage Bin Canvas")
        self.assertEqual((left.form, left.subtype), (right.form, right.subtype))

    def test_05_canvas_default_is_named(self):
        value = self.signature("Canvas 16x20")
        self.assertEqual(value.default_rule_applied, "bare_canvas_means_stretched_wall_art")
        self.assertEqual(self.signature("Canvas Storage Bin").default_rule_applied, "")

    def test_06_storage_rows_do_not_enter_wall_form(self):
        self.assertNotEqual(self.signature("Canvas Storage Bin").form, "Stretched or Box")

    def test_07_canvas_storage_vote_stays_out_of_canvas_pool(self):
        frame = self.axis_frame([
            ("Soft Storage", "Bin", "", "unreadable", "N", "B1", "X1"),
            ("Stretched or Box", "Canvas", "Foil", "stated", "A", "A2", "11"),
        ])
        reverse = build_associations(frame)[1]
        self.assertNotIn("N|B1", reverse[2].get("stretched or box|canvas", {}))

    def test_08_zero_weight_words_do_not_change_axes(self):
        base = self.signature("Printed Canvas")
        decorated = self.signature("Disney Stitch blue Printed Canvas 16x20")
        self.assertEqual((base.form, base.subtype, base.embellishment_state), (decorated.form, decorated.subtype, decorated.embellishment_state))

    def test_09_explicit_plain_with_two_later_rows_reaches_zero(self):
        frame = self.axis_frame([
            ("Stretched or Box", "Canvas", "None", "none", "A", "A2", "01"),
            ("Stretched or Box", "Canvas", "None", "none", "A", "A2", "01"),
        ])
        reverse = build_associations(frame)[1]
        result = classify_axes("Stretched or Box", "Canvas", "None", "none", reverse)
        self.assertEqual((result["depth"], result["key"]), (3, "A|A2|01"))

    def test_10_placeholder_is_unreadable(self):
        value = self.signature("Created for Testing")
        self.assertEqual((value.status, value.embellishment_state), ("placeholder", "unreadable"))

    def test_11_none_never_maps_where_zero_is_undefined(self):
        reverse = {3: {}, 2: {"plaque|plain": Counter({"C|A1": 2})}, 1: {}}
        result = classify_axes("Plaque", "Plain", "None", "none", reverse)
        self.assertNotEqual(result.get("key"), "C|A1|01")

    def test_12_states_are_distinct(self):
        self.assertEqual(self.signature("Plain Canvas").embellishment_state, "none")
        self.assertEqual(self.signature("Printed Canvas").embellishment_state, "unreadable")

    def test_13_token_absence_is_unreadable(self):
        value = self.signature("Canvas 16x20")
        self.assertEqual((value.embellishment, value.embellishment_state), ("", "unreadable"))

    def test_14_definition_without_two_rows_is_withheld(self):
        frame = self.axis_frame([("Stretched or Box", "Canvas", "None", "none", "A", "A2", "01")])
        reverse = build_associations(frame)[1]
        result = classify_axes("Stretched or Box", "Canvas", "None", "none", reverse)
        self.assertLess(result["depth"], 3)
        self.assertEqual(result.get("mg03_reason"), "definition_exists_but_no_observed_support")

    def test_15_invalid_mg03_keeps_valid_parents(self):
        frame = self.axis_frame([("Stretched or Box", "Canvas", "None", "none", "A", "A2", "A2")])
        frame[["Valid MG01", "Valid MG01+MG02", "Valid MG01+MG02+MG03"]] = ["Yes", "Yes", "No"]
        reverse = build_associations(frame, TaxonomyValidity(frozenset({"A"}), frozenset({("A", "A")}), frozenset({("A", "A", "0")})))[1]
        self.assertTrue(reverse[1] and reverse[2])
        self.assertFalse(reverse[3])

    def test_16_a_canvas_code_is_excluded_only_at_depth_three(self):
        validity = TaxonomyValidity(frozenset({"A"}), frozenset({("A", "A")}), frozenset({("A", "A", "0")}))
        self.assertEqual(code_validity(pd.Series({"MG01": "A", "MG02": "A2", "MG03": "A2"}), validity), (True, True, False))

    def test_17_validity_uses_first_character(self):
        validity = TaxonomyValidity(frozenset({"A"}), frozenset({("A", "A")}), frozenset({("A", "A", "0")}))
        self.assertEqual(code_validity(pd.Series({"MG01": "A", "MG02": "A2", "MG03": "01"}), validity), (True, True, True))

    def test_18_invalid_pair_retains_independent_mg01(self):
        validity = TaxonomyValidity(frozenset({"A"}), frozenset({("A", "A")}), frozenset())
        self.assertEqual(code_validity(pd.Series({"MG01": "A", "MG02": "Z9", "MG03": "01"}), validity), (True, False, False))

    def test_19_date_boundary_is_exhaustive(self):
        dates = pd.to_datetime(["2025-05-13", "2025-05-14"])
        self.assertEqual(int((dates < pd.Timestamp("2025-05-14")).sum() + (dates >= pd.Timestamp("2025-05-14")).sum()), 2)

    def test_20_historical_codes_are_not_function_inputs(self):
        reverse = {3: {}, 2: {"stretched or box|canvas": Counter({"A|A2": 2})}, 1: {}}
        self.assertEqual(classify_axes("Stretched or Box", "Canvas", "", "unreadable", reverse)["key"], "A|A2")

    def test_21_only_reviewed_status_teaches(self):
        frame = self.axis_frame([("Stretched or Box", "Canvas", "Foil", "stated", "A", "A2", "11")])
        frame["Dictionary Status"] = "needs_review"
        self.assertFalse(build_associations(frame)[1][1])

    def test_22_full_failure_falls_back_to_pair(self):
        reverse = {3: {}, 2: {"stretched or box|canvas": Counter({"A|A2": 2})}, 1: {}}
        self.assertEqual(classify_axes("Stretched or Box", "Canvas", "Foil", "stated", reverse)["depth"], 2)

    def test_23_thresholds_are_unchanged(self):
        self.assertIsNone(choose_at_level("x", 3, {"x": Counter({"A|A2|11": 3, "A|A2|21": 1})}))
        self.assertIsNotNone(choose_at_level("x", 3, {"x": Counter({"A|A2|11": 4, "A|A2|21": 1})}))


if __name__ == "__main__":
    unittest.main()
