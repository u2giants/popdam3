import re
import unittest
from pathlib import Path

ROOT = Path(__file__).parents[1]
MIGRATION = ROOT / "supabase/migrations/20260826002422_sample_inventory_index_backed.sql"
SQL = MIGRATION.read_text(encoding="utf-8")

class SampleInventoryIndexBackedContract(unittest.TestCase):
    def test_single_transaction(self):
        self.assertEqual(len(re.findall(r"(?im)^BEGIN;$", SQL)), 1)
        self.assertEqual(len(re.findall(r"(?im)^COMMIT;$", SQL)), 1)

    def test_projection_is_additive_and_trigger_maintained(self):
        self.assertIn("CREATE TABLE dflow.sample_inventory_balance", SQL)
        self.assertIn("CREATE TRIGGER sample_movement_project_inventory", SQL)
        self.assertIn("AFTER INSERT ON dflow.sample_movement", SQL)
        self.assertEqual(SQL.count("ON CONFLICT (sample_id_fk,location_type,location_id) DO UPDATE"), 2)

    def test_screen_index_matches_filter_and_order(self):
        index = SQL.split("CREATE INDEX sample_inventory_balance_screen_idx", 1)[1].split(";", 1)[0]
        self.assertLess(index.index("location_type"), index.index("location_id"))
        self.assertLess(index.index("location_id"), index.index("available_since DESC"))
        self.assertLess(index.index("available_since DESC"), index.index("sample_id_fk DESC"))
        self.assertIn("WHERE quantity > 0", index)

    def test_backfill_uses_both_ledger_legs(self):
        self.assertIn("UNION ALL", SQL)
        self.assertIn("m.to_location_type AS location_type", SQL)
        self.assertIn("m.from_location_type", SQL)
        self.assertIn("sum(l.quantity_delta)::bigint", SQL)
        self.assertIn("max(l.occurred_at)", SQL)

    def test_preserves_semantics_and_privileges(self):
        self.assertIn("b.quantity>0 AND b.location_type<>'in_transit'", SQL)
        self.assertIn("WHEN b.quantity<=0 THEN 'no_balance'", SQL)
        self.assertIn("FROM PUBLIC,anon,authenticated", SQL)

if __name__ == "__main__":
    unittest.main()
