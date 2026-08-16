import unittest
from collections import Counter

import pandas as pd

from hierarchical_item_taxonomy import (
    build_associations,
    classify_product_type,
    parse_description,
    product_key,
)


class DescriptionParsingTests(unittest.TestCase):
    def test_five_chunks_exclude_non_product_wording(self):
        parsed = parse_description(
            'Disney Printed Glass Shadowbox Stitch wink "Oh Yeah Whatever" blue 12x12"',
            ["Disney"], ["Stitch"],
        )
        self.assertEqual(parsed.product_type, "Printed Glass Shadowbox")
        self.assertEqual(parsed.size, '12x12"')
        self.assertEqual(parsed.licensor, "Disney")
        self.assertEqual(parsed.property, "Stitch")
        self.assertIn("Oh Yeah Whatever", parsed.artwork_description)

    def test_consolidation_cases(self):
        variants = [
            "Anti Fatigue Pvc Kitchen", "Anti Fatique Kitchen Mat", "Anti Fatique Pvc Kitchen Mat",
        ]
        self.assertEqual({product_key(parse_description(value, [], []).product_type) for value in variants}, {"anti fatigue pvc kitchen mat"})
        diy = parse_description("2Pc Canvas Set Paint Pots Brush 11x14", [], [])
        self.assertEqual(diy.product_type, "Paint-Your-Own Canvas Set")

    def test_door_and_outdoor_mats_remain_separate(self):
        self.assertEqual(parse_description("Crumb Rubber Door Mat_Bows 30x18", [], []).product_type, "Crumb Rubber Door Mat")
        self.assertEqual(parse_description("Crumb Rubber Outdoor Mat_Bows 30x18", [], []).product_type, "Crumb Rubber Outdoor Mat")

    def test_canvas_treatment_is_part_of_physical_product_type(self):
        self.assertEqual(parse_description("Printed Canvas w Holofoil_Mamba 16x20", [], []).product_type, "Foil Canvas")
        self.assertEqual(parse_description("Canvas w High Gloss_Fox 16x20", [], []).product_type, "High-Gloss Canvas")


class HierarchyTests(unittest.TestCase):
    def associations(self):
        rows = [
            ("Printed Canvas", "A", "A2", "01"), ("Printed Canvas", "A", "A2", "11"),
            ("Printed Canvas", "A", "A2", "H1"), ("Wall Clock", "M", "W1", "B1"),
            ("Wall Clock", "M", "W1", "B1"), ("Storage Bin", "N", "B1", "X1"),
            ("Storage Bin", "N", "H1", "N2"),
        ]
        frame = pd.DataFrame(rows, columns=["Product Type", "MG01", "MG02", "MG03"])
        frame["Item Desc"] = frame["Product Type"]
        return build_associations(frame)[1]

    def test_falls_back_from_ambiguous_mg03_to_pair(self):
        result = classify_product_type("Printed Canvas", self.associations())
        self.assertEqual((result["depth"], result["key"]), (2, "A|A2"))

    def test_exact_full_key_wins(self):
        result = classify_product_type("Wall Clock", self.associations())
        self.assertEqual((result["depth"], result["key"]), (3, "M|W1|B1"))

    def test_falls_back_to_mg01_when_pairs_split(self):
        result = classify_product_type("Storage Bin", self.associations())
        self.assertEqual((result["depth"], result["key"]), (1, "N"))

    def test_historical_codes_are_not_an_input(self):
        reverse = {3: {"wall clock": Counter({"M|W1|B1": 2})}, 2: {}, 1: {}}
        result = classify_product_type("Wall Clock", reverse)
        self.assertEqual(result["key"], "M|W1|B1")


if __name__ == "__main__":
    unittest.main()
