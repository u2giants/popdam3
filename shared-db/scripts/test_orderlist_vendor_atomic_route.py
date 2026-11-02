"""The immutable OrderList migration must never fall through the CLI splitter."""
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import atomic_migration_apply as atomic

VERSION = "20261102003158"
MIGRATIONS = ROOT / "supabase/migrations"


class OrderListVendorAtomicRouteTests(unittest.TestCase):
    def test_actual_immutable_migration_routes_atomically_in_both_environments(self):
        for target in ("preview", "production"):
            with self.subTest(target=target):
                self.assertEqual(atomic.classify_allowlist(VERSION, target), VERSION)
                path, name, raw, statements = atomic.load_candidate(MIGRATIONS, VERSION, target)
                self.assertEqual(path.name, VERSION + "_orderlist_vendor_ids_and_workflow.sql")
                workflow = [s for s in statements if "create or replace function dam.orderlist_product_facts" in s.lower()]
                self.assertEqual(len(workflow), 1)
                self.assertIn("begin atomic", workflow[0].lower())
                self.assertTrue(workflow[0].lower().rstrip().endswith("end"))
                wrapper = atomic.build_wrapper(VERSION, name, raw, statements)
                self.assertLess(wrapper.index("BEGIN;"), wrapper.index("create or replace function"))
                self.assertLess(wrapper.index("INSERT INTO supabase_migrations.schema_migrations"), wrapper.index("COMMIT;"))

    def test_actual_atomic_version_cannot_be_batched_with_another_migration(self):
        for target in ("preview", "production"):
            with self.subTest(target=target), self.assertRaises(atomic.Refusal):
                atomic.classify_allowlist(VERSION + ",29990101000000", target)


if __name__ == "__main__":
    unittest.main()
