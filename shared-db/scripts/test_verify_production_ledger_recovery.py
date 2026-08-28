import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))

import verify_production_ledger_recovery as M


class RecoveryProofTests(unittest.TestCase):
    def test_query_is_read_only_and_exact(self):
        sql = M.build_query(["select 1", "select 2"])
        lowered = sql.lower()
        self.assertTrue(lowered.startswith("with ledger as"))
        for verb in ("insert ", "update ", "delete ", "alter ", "create ", "drop "):
            self.assertNotIn(verb, lowered)
        self.assertIn("to_jsonb(statements) = $expected$", sql)

    def test_verify_fails_closed(self):
        good = {key: True for key in ("one_ledger_row", "name_ok", "statements_exact", "rfq_columns_ok", "grid_column_ok", "item_columns_ok")}
        good["statement_count"] = 1
        self.assertEqual(M.verify(good, ["select 1"])["statement_identity"], "exact")
        bad = dict(good, statements_exact=False)
        with self.assertRaisesRegex(RuntimeError, "statements_exact"):
            M.verify(bad, ["select 1"])


if __name__ == "__main__":
    unittest.main()
