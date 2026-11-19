"""Sandbox post-apply check must not fail on a schema the sandbox lacks (#6720).

Sandbox run 44378840217 applied 20261204000700 correctly on plm."itemHeader"
but failed because the sandbox has no dflow_prod schema (conditioned out).
On a non-production ledger an absent schema is recorded; production still fails.
No database: pure reporting.
"""

from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))

from production_catalog_verification import build_catalog_sql, render_report  # noqa: E402
from test_production_catalog_verification_alter_column_type import VERSION, real_targets  # noqa: E402

WIDE = "character varying(100)"


def sandbox_catalog(plm_actual: str | None = WIDE) -> dict:
    return {
        "server_version": "17.4",
        "column_types": [
            {"schema": "dflow_prod", "table": "itemHeader", "column": "item_displ_descr_name",
             "expected": WIDE, "schema_exists": False, "actual": None},
            {"schema": "plm", "table": "itemHeader", "column": "item_displ_descr_name",
             "expected": WIDE, "schema_exists": True, "actual": plm_actual},
        ],
    }


def report(cat: dict, tolerate: bool):
    return render_report([VERSION], real_targets(), cat, None, [], True, tolerate_absent_schemas=tolerate)


class AbsentSchemaTest(unittest.TestCase):
    def test_sandbox_records_absent_schema(self):
        markdown, failures = report(sandbox_catalog(), True)
        self.assertEqual(failures, [])
        self.assertIn("schema `dflow_prod` absent on this target", markdown)

    def test_production_still_fails_absent_schema(self):
        _, failures = report(sandbox_catalog(), False)
        self.assertTrue(any("dflow_prod.itemHeader.item_displ_descr_name: column is absent" in f for f in failures))

    def test_sandbox_still_fails_wrong_type_in_present_schema(self):
        _, failures = report(sandbox_catalog("character varying(40)"), True)
        self.assertEqual(len(failures), 1)

    def test_sandbox_still_fails_missing_column_in_present_schema(self):
        cat = sandbox_catalog(None)
        _, failures = report(cat, True)
        self.assertTrue(any("plm.itemHeader.item_displ_descr_name: column is absent" in f for f in failures))

    def test_catalog_query_reports_schema_presence(self):
        self.assertIn("'schema_exists', n.oid is not null", build_catalog_sql(real_targets()))


if __name__ == "__main__":
    unittest.main()
