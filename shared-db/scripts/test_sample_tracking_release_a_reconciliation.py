import re
import unittest
from pathlib import Path


ROOT = Path(__file__).parents[1]
MIGRATION = ROOT / "supabase/migrations/20260818024441_sample_tracking_release_a_catalog_reconciliation.sql"
SQL = MIGRATION.read_text(encoding="utf-8")


class ReleaseAReconciliationContract(unittest.TestCase):
    def test_single_transaction_and_fail_closed_before_ddl(self):
        self.assertEqual(len(re.findall(r"(?im)^BEGIN;$", SQL)), 1)
        self.assertEqual(len(re.findall(r"(?im)^COMMIT;$", SQL)), 1)
        first_ddl = SQL.index("CREATE TABLE")
        self.assertLess(SQL.index("requires both approved predecessor"), first_ddl)
        self.assertLess(SQL.index("refused mixed workflow catalog state"), first_ddl)

    def test_exact_authorized_object_scope(self):
        for name in (
            "sample_creation_batch", "sample_workflow", "sample_path_revision",
            "sample_inventory", "validate_sample_path_revision",
            "require_sample_path_revision", "apply_sample_path_revision",
            "reject_sample_path_revision_mutation", "validate_sample_shipment_line_header",
            "sample_path_revision_validate", "sample_workflow_path_revision_required",
            "sample_path_revision_apply", "sample_path_revision_immutable",
            "sample_shipment_line_header_route", "sample_workflow_queue_idx",
            "sample_movement_inventory_idx",
        ):
            self.assertIn(name, SQL)
        self.assertNotRegex(SQL, r"(?i)CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?dflow\.(?:sample_carrier|sample_shipment)\b")

    def test_partial_preview_and_fresh_production_paths(self):
        self.assertEqual(SQL.count("CREATE TABLE IF NOT EXISTS dflow."), 3)
        self.assertIn("v_present NOT IN (0,3)", SQL)
        self.assertIn("CREATE INDEX IF NOT EXISTS sample_workflow_queue_idx", SQL)
        self.assertIn("CREATE INDEX IF NOT EXISTS sample_movement_inventory_idx", SQL)
        self.assertEqual(SQL.count("DROP TRIGGER IF EXISTS"), 5)

    def test_carrier_and_privilege_postconditions(self):
        self.assertIn("exactly the four approved active carrier seeds", SQL)
        for code in ("ups", "fedex", "dhl", "usps"):
            self.assertIn(f"'{code}'", SQL)
        self.assertIn("REVOKE ALL ON dflow.sample_creation_batch", SQL)
        self.assertIn("has_table_privilege('anon'", SQL)
        self.assertIn("has_table_privilege('authenticated'", SQL)

    def test_no_later_release_scope(self):
        for forbidden in ("release_b", "release_d", "release_e"):
            self.assertNotIn(forbidden, SQL.lower())
        self.assertNotRegex(SQL, r"(?im)^\s*(?:INSERT\s+INTO|DELETE\s+FROM)\s+dflow\.")
        self.assertNotIn("INSERT INTO dflow.sample_carrier", SQL)

    def test_database_contract_covers_mismatch_rollback_and_fresh_state(self):
        contract = (ROOT / "supabase/tests/sample_tracking_release_a_reconciliation_contracts.sql").read_text(encoding="utf-8")
        self.assertIn("DROP TABLE dflow.sample_path_revision CASCADE", contract)
        self.assertEqual(contract.count("\\ir ../migrations/20260818024441_sample_tracking_release_a_catalog_reconciliation.sql"), 2)
        self.assertNotIn("P9750", contract)
        self.assertIn("did not restore the dropped trigger", contract)
        self.assertIn("0-of-3 repair did not recreate relations", contract)
        for version in ("20260814130000", "20260814193402", "20260818024441"):
            self.assertIn(version, contract)


if __name__ == "__main__":
    unittest.main()
