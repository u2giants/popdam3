import unittest
from collections import Counter

import pandas as pd

from hierarchical_item_taxonomy import build_associations, classify_product_type, parse_description, usable_description
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
        reverse = {3: {"wall clock|clock|": Counter({"M|W1|B1": 2})}, 2: {}, 1: {}}
        self.assertEqual(classify_product_type("Wall Clock", reverse, "Clock", "")["key"], "M|W1|B1")

    def test_singleton_falls_back_to_taxonomy_mg01(self):
        reverse = {3: {"wall clock|clock|": Counter({"M|W1|B1": 1})}, 2: {}, 1: {}}
        self.assertEqual(classify_product_type("Wall Clock", reverse, "Clock", "")["depth"], 1)

    def test_runner_up_gate_falls_back_to_taxonomy_mg01(self):
        reverse = {3: {}, 2: {}, 1: {"stretched or box": Counter({"A": 4, "B": 3})}}
        self.assertEqual(classify_product_type("Canvas", reverse)["key"], "A")

    def test_review_rows_are_excluded(self):
        frame = pd.DataFrame([{"Product Type": "Canvas", "Construction Shape": "Stretched", "Treatment": "", "MG01": "A", "MG02": "A2", "MG03": "01", "Item Desc": "Canvas", "Dictionary Status": "needs_review", "Description Usable for Product Matching": "Yes"}])
        self.assertEqual(build_associations(frame)[1][1], {})


if __name__ == "__main__":
    unittest.main()
