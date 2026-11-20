"""#6658: post-apply catalog verification reports NOT VERIFIABLE instead of
failing correctly applied runs whose lexer read no catalog object.

No database. Pure derivation + reporting on temporary files.
"""
from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from production_catalog_verification import (  # noqa: E402
    derive_targets,
    render_report,
)

VERSION = "20261204000300"


def render(sql: str, catalog=None):
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        migrations = root / "supabase" / "migrations"
        migrations.mkdir(parents=True)
        path = migrations / f"{VERSION}_t.sql"
        path.write_text(sql, encoding="utf-8")
        targets = derive_targets({VERSION: path}, [VERSION])
        if catalog is None:
            catalog = {"relations": []}
        return targets, render_report([VERSION], targets, catalog, None, [], True)


class NotVerifiableInsteadOfFailure(unittest.TestCase):
    def test_dynamic_do_block_reports_not_verifiable_with_no_failures(self):
        sql = (
            "do $$\n"
            "begin\n"
            "  execute format('drop table if exists %I.%I', 'tmp', 'scratch');\n"
            "end $$;\n"
        )
        targets, (markdown, failures) = render(sql)
        self.assertTrue(targets.is_empty())
        self.assertEqual(failures, [])
        self.assertIn("Applied, not verifiable by catalog", markdown)
        self.assertIn("ledger", markdown.lower())

    def test_rejected_noop_claim_still_fails(self):
        sql = "-- catalog-verification: no-op meh\nupdate plm.widget set a = 1;\n"
        targets, (_, failures) = render(sql)
        self.assertTrue(failures)
        self.assertIn("REJECTED", failures[0])

    def test_readable_mismatch_still_fails(self):
        sql = "create table public.no_such_expected (id int);\n"
        targets, (_, failures) = render(
            sql, catalog={"relations": [{"name": "public.no_such_expected", "to_regclass": None}]}
        )
        self.assertFalse(targets.is_empty())
        self.assertTrue(failures)

    def test_absent_catalog_with_real_targets_still_fails(self):
        sql = "create table public.real_target (id int);\n"
        targets, (_, failures) = render(sql, catalog=None if False else {})
        # Empty dict is not None; force the NO-evidence path with a true None
        # via a direct call below.
        self.assertFalse(targets.is_empty())
        markdown, failures = render_report([VERSION], targets, None, None, [], True)
        self.assertTrue(failures)
        self.assertIn("NO evidence", failures[0])


if __name__ == "__main__":
    unittest.main()
