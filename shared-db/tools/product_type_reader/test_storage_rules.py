"""Conservative source-phrase checks for storage type refinement."""

import unittest

from tools.product_type_reader.storage_rules import refine_storage_type


class StorageTypeRulesTest(unittest.TestCase):
    def test_canvas_with_eva_bin_is_bin(self):
        self.assertEqual(refine_storage_type("canvas w eva bin color art", "Canvas"), "Storage Bin")
        self.assertEqual(refine_storage_type("canvas with eva bins", "Canvas"), "Storage Bin")

    def test_greyboard_box_is_not_inferred_hard(self):
        self.assertEqual(refine_storage_type("greyboard lift off lid box", "Storage Box"), "Storage Box")

    def test_canvas_bin_requires_contiguous_binding_not_mixed_products(self):
        for text in (
            "canvas and eva bin",
            "canvas plus eva bin",
            "canvas art eva bin",
            "canvas with eva artwork bin",
        ):
            with self.subTest(text=text):
                self.assertEqual(refine_storage_type(text, "Canvas"), "Canvas")

    def test_other_selected_products_stay_unchanged(self):
        self.assertEqual(refine_storage_type("greyboard lift off lid box", "Jewelry Box"), "Jewelry Box")
        self.assertEqual(refine_storage_type("canvas w eva bin", "Storage Toy Chest"), "Storage Toy Chest")
        self.assertEqual(refine_storage_type("canvas w eva bin", "Storage Bin"), "Storage Bin")


if __name__ == "__main__":
    unittest.main()
