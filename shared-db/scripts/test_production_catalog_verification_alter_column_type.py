"""`alter column ... type` applies must be VERIFIED, not refused (#6603).

Production run 44152176840 applied 20261204000700 (widen
`item_displ_descr_name` to varchar(100) on two quoted mixed-case tables) but
the post-apply step found no catalog object and failed. The statement now
names a column whose live `format_type()` must equal the new type.
No database: pure derivation and reporting.
"""

from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))

from production_catalog_verification import (  # noqa: E402
    build_catalog_sql,
    derive_targets,
    normalize_column_type,
    render_report,
)

VERSION = "20261204000700"
REAL = Path(__file__).resolve().parents[1] / "supabase" / "migrations" / f"{VERSION}_widen_item_displ_descr_name.sql"
EXPECTED = [
    ("dflow_prod", "itemHeader", "item_displ_descr_name", "character varying(100)"),
    ("plm", "itemHeader", "item_displ_descr_name", "character varying(100)"),
]


def real_targets():
    return derive_targets({VERSION: REAL}, [VERSION])


def targets_for(sql: str):
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / f"{VERSION}_test.sql"
        path.write_text(sql, encoding="utf-8")
        return derive_targets({VERSION: path}, [VERSION])


def catalog(actual: str | None) -> dict:
    return {
        "server_version": "17.4",
        "column_types": [
            {"schema": s, "table": t, "column": c, "expected": ty, "actual": actual}
            for s, t, c, ty in EXPECTED
        ],
    }


class AlterColumnTypeTest(unittest.TestCase):
    def test_real_migration_is_derived_with_case_kept(self):
        targets = real_targets()
        self.assertEqual(targets.column_types, EXPECTED)
        self.assertFalse(targets.is_empty())
        self.assertIn("alter column type", targets.change_types)

    def test_widened_columns_pass(self):
        markdown, failures = render_report(
            [VERSION], real_targets(), catalog("character varying(100)"), None, [], True
        )
        self.assertEqual(failures, [])
        self.assertIn("## Column types", markdown)

    def test_old_length_fails(self):
        _, failures = render_report(
            [VERSION], real_targets(), catalog("character varying(40)"), None, [], True
        )
        self.assertEqual(len(failures), 2)
        self.assertTrue(all("expected 'character varying(100)'" in f for f in failures))

    def test_missing_column_fails(self):
        _, failures = render_report([VERSION], real_targets(), catalog(None), None, [], True)
        self.assertTrue(any("column is absent" in f for f in failures))

    def test_no_evidence_row_fails(self):
        _, failures = render_report(
            [VERSION], real_targets(), {"server_version": "17.4", "column_types": []}, None, [], True
        )
        self.assertTrue(any("no column evidence row" in f for f in failures))

    def test_catalog_query_reads_quoted_names(self):
        sql = build_catalog_sql(real_targets())
        self.assertIn("('dflow_prod', 'itemHeader', 'item_displ_descr_name', 'character varying(100)')", sql)
        self.assertIn("format_type(a.atttypid, a.atttypmod)", sql)

    def test_spellings(self):
        for sql, want in (
            ("alter table public.t alter column c type varchar(10);", "character varying(10)"),
            ("ALTER TABLE public.t ALTER c SET DATA TYPE numeric( 12 , 2 );", "numeric(12,2)"),
            ("alter table only public.t alter column c type timestamptz;", "timestamp with time zone"),
            ("alter table public.t alter column c type text[];", "text[]"),
        ):
            with self.subTest(sql=sql):
                self.assertEqual(targets_for(sql).column_types, [("public", "t", "c", want)])

    def test_using_clause_is_not_claimed(self):
        targets = targets_for("alter table public.t alter column c type integer using c::integer;")
        self.assertEqual(targets.column_types, [])

    def test_normalize(self):
        self.assertEqual(normalize_column_type("CHARACTER VARYING (100)"), "character varying(100)")
        self.assertEqual(normalize_column_type("int8"), "bigint")


if __name__ == "__main__":
    unittest.main()
