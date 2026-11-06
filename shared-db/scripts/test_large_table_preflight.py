#!/usr/bin/env python3
"""Offline tests for the large-table preflight (plan step 2.6, #2367).

NO DATABASE. Nothing here connects to anything: the live size probe is
exercised through a fake reader, and the static candidate analysis runs on
literal SQL shaped like the two production incidents this step exists for
(#1427's normalization DO block, #5165's corpus-scale GIN indexes). These run
in the `validate` job of .github/workflows/shared-supabase-migrations.yml
under the scripts/test_*.py glob.
"""

from pathlib import Path
import tempfile
import unittest

import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))

import large_table_preflight as preflight  # noqa: E402


# The #1427 failure shape: a normalization pass over an existing large table,
# inside a DO block, so statement-splitting alone would never see it.
INCIDENT_1427_SQL = """-- normalize asset metadata
do $normalize$
declare
  batch_count integer := 0;
begin
  loop
    update dam.asset_metadata m
       set normalized_value = lower(trim(m.raw_value))
      from dam.assets a
     where a.id = m.asset_id
       and m.normalized_value is distinct from lower(trim(m.raw_value))
     limit 5000;
    exit when not found;
    batch_count := batch_count + 1;
  end loop;
end
$normalize$;
"""

# The #5165 failure shape: GIN and trigram indexes over the full ruling
# corpus, plus a held-chapter index, exactly as that migration built them.
INCIDENT_5165_SQL = """create index hts_rag_rulings_fts_active_idx
    on hts_rag.hts_rag_rulings
    using gin (to_tsvector('english', ruling_search_text))
    where is_active;
create index hts_rag_rulings_subject_trgm_idx
    on hts_rag.hts_rag_rulings using gin (subject gin_trgm_ops);
create index hts_rag_ruling_codes_chapter_idx
    on hts_rag.hts_rag_ruling_codes (held_chapter);
"""

SMALL_MIGRATION_SQL = """create table crm.contact_note_tag (
  note_id uuid not null,
  tag text not null
);
alter table crm.contact_note_tag add constraint contact_note_tag_pkey primary key (note_id, tag);
insert into crm.contact_note_tag (note_id, tag) values ('00000000-0000-0000-0000-000000000001', 'intro');
"""


def fake_reader(sizes: dict[str, tuple[int, int] | None]):
    """Return a read_table_size stand-in keyed by table name; None = absent."""

    def reader(url, env, table):
        if table not in sizes or sizes[table] is None:
            return {"table": table, "present": False, "bytes": None, "rows": None,
                    "note": "table not present on the target yet (created by this batch)"}
        bytes_value, rows = sizes[table]
        return {"table": table, "present": True, "bytes": bytes_value, "rows": rows}

    return reader


class CandidateTableTests(unittest.TestCase):
    def test_1427_normalization_do_block_flags_the_rewritten_table(self):
        candidates = preflight.candidate_tables(INCIDENT_1427_SQL)
        self.assertIn("dam.asset_metadata", candidates)
        self.assertEqual(candidates["dam.asset_metadata"], preflight.REASON_REWRITE)

    def test_5165_corpus_indexes_flag_every_indexed_table(self):
        candidates = preflight.candidate_tables(INCIDENT_5165_SQL)
        self.assertIn("hts_rag.hts_rag_rulings", candidates)
        self.assertIn("hts_rag.hts_rag_ruling_codes", candidates)
        self.assertEqual(candidates["hts_rag.hts_rag_rulings"], preflight.REASON_INDEX)

    def test_small_migration_flags_no_existing_large_table(self):
        candidates = preflight.candidate_tables(SMALL_MIGRATION_SQL)
        # A create-table-plus-values migration names no pre-existing table to
        # index or rewrite, so there is nothing to size at all.
        self.assertEqual(candidates, {})

    def test_commented_out_statements_are_not_candidates(self):
        candidates = preflight.candidate_tables(
            "-- update dam.assets set x = 1;\n/* update dam.assets set y = 2; */\nselect 1;\n"
        )
        self.assertEqual(candidates, {})

    def test_rewrite_shaped_alters_are_candidates_but_plain_adds_are_not(self):
        candidates = preflight.candidate_tables(
            "alter table dam.assets alter column title type text;"
            "alter table dam.assets add column note text;"
            "alter table dam.assets add column stamp timestamptz not null default now();"
        )
        self.assertEqual(set(candidates), {"dam.assets"})

    def test_insert_select_is_a_candidate_but_plain_insert_is_not(self):
        candidates = preflight.candidate_tables(
            "insert into core.licensor (id, code) values ('a', 'b');\n"
            "insert into core.property select id, code from staging.properties;\n"
        )
        self.assertEqual(set(candidates), {"core.property"})


class PreflightVerdictTests(unittest.TestCase):
    def run_batch(self, sql: str, sizes: dict[str, tuple[int, int] | None]):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            migrations = root / "supabase" / "migrations"
            migrations.mkdir(parents=True)
            (migrations / "20261106000000_fixture.sql").write_text(sql, encoding="utf-8")
            original = preflight.read_table_size
            preflight.read_table_size = fake_reader(sizes)
            try:
                return preflight.run_preflight(migrations, ["20261106000000"], target="production")
            finally:
                preflight.read_table_size = original

    def test_5165_shaped_batch_over_threshold_is_flagged_with_budget(self):
        report = self.run_batch(
            INCIDENT_5165_SQL,
            {"hts_rag.hts_rag_rulings": (412_000_000, 64_931), "hts_rag.hts_rag_ruling_codes": (20_000_000, 64_931)},
        )
        flagged = [row["table"] for row in report["flagged"]]
        self.assertIn("hts_rag.hts_rag_rulings", flagged)
        self.assertEqual(report["verdict"], "large-table apply")
        self.assertEqual(report["statement_budget_ms"], preflight.STATEMENT_BUDGET_MS)
        text = preflight.render(report)
        self.assertIn("OVER THRESHOLD", text)
        self.assertIn("hts_rag.hts_rag_rulings", text)

    def test_1427_shaped_batch_over_threshold_gets_the_scaled_budget(self):
        report = self.run_batch(INCIDENT_1427_SQL, {"dam.asset_metadata": (6 * 1024**3, 3_000_000)})
        self.assertEqual(report["verdict"], "large-table apply")
        self.assertEqual(report["statement_budget_ms"], 3_600_000)
        self.assertEqual(preflight.statement_budget_ms([{"bytes": 2 * 1024**3}]), 1_800_000)

    def test_small_migration_is_not_flagged(self):
        report = self.run_batch(SMALL_MIGRATION_SQL, {"crm.contact_note_tag": None})
        self.assertEqual(report["flagged"], [])
        self.assertEqual(report["verdict"], "no large-table candidates")
        self.assertEqual(report["statement_budget_ms"], 0)
        self.assertNotIn("OVER THRESHOLD", preflight.render(report))

    def test_rows_alone_can_flag_a_table(self):
        report = self.run_batch(INCIDENT_5165_SQL, {"hts_rag.hts_rag_rulings": (1024, 900_000), "hts_rag.hts_rag_ruling_codes": (512, 900_000)})
        self.assertEqual(report["verdict"], "large-table apply")


if __name__ == "__main__":
    unittest.main()
