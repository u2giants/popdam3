"""Quoted mixed-case relations must be read with their quotes and case.

Issue popcre/shared-db#6716: sandbox run 44170024290 (PR #6602) applied
`core."merchGroupRepairJournal"` correctly, but the post-apply check read the
lowercased text, could not parse the table or its index, and failed a good
apply. No database: pure derivation and SQL-shape checks.
"""

from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))

from production_catalog_verification import build_catalog_sql, derive_targets  # noqa: E402

SQL = '''
create table if not exists core."merchGroupRepairJournal" (
  journal_id bigint primary key,
  constraint "merchGroupRepairJournal_action_check" check (journal_id > 0)
);
create index if not exists "merchGroupRepairJournal_run_id_idx"
  on core."merchGroupRepairJournal" (journal_id);
revoke all on table core."merchGroupRepairJournal" from anon, authenticated;
create table "core"."plain_lower" (id int);
'''


class QuotedIdentifierTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        path = Path(self.tmp.name) / "20991231000000_mixed_case.sql"
        path.write_text(SQL, encoding="utf-8")
        self.t = derive_targets({"20991231000000": path}, ["20991231000000"])

    def tearDown(self):
        self.tmp.cleanup()

    def test_mixed_case_table_keeps_quotes_and_case(self):
        self.assertIn('core."merchGroupRepairJournal"', self.t.tables)

    def test_needlessly_quoted_lowercase_reads_bare(self):
        self.assertIn("core.plain_lower", self.t.tables)

    def test_index_and_revoke_parse_without_notes(self):
        self.assertEqual(self.t.notes, [])
        self.assertIn(
            ('core."merchGroupRepairJournal_run_id_idx"', 'core."merchGroupRepairJournal"'),
            self.t.indexes,
        )
        targets = {e.target for e in self.t.privileges}
        self.assertEqual(targets, {'core."merchGroupRepairJournal"'})

    def test_index_lookup_uses_to_regclass(self):
        sql = build_catalog_sql(self.t)
        self.assertIn("c.oid = to_regclass(t.index_name)", sql)
        self.assertNotIn("split_part(t.index_name", sql)


if __name__ == "__main__":
    unittest.main()
