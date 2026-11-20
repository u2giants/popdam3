"""Issue #5932: pure-data migrations must be NOTED, and their no-op header
honored -- never refused as "proved nothing".

THE PROBLEM. `20261113160920` (the Disney characters restore) applied fine and
then failed post-apply catalog verification in enforcing mode: it creates no
catalog object, so the lexer correctly derived nothing, and the "a run that
verified nothing must not report itself green" refusal (#697) flagged it. That
refusal exists for files whose catalog DDL the lexer CANNOT read -- not for
files that genuinely have none.

TWO BEHAVIORS, BOTH PINNED HERE.

  (a) An explicit `-- catalog-verification: no-op <reason>` header is honored:
      the claim is CHECKED (every statement data-shaped; a `do` body scanned for
      catalog DDL and dynamic SQL) and the run passes with the reason recorded.
      The #5932 widening: a `do` block carrying only data work is a TRUE claim.
  (b) WITHOUT the header, a genuinely pure-data migration -- only DML (INSERT/
      UPDATE/DELETE/COPY and the statements around them); no CREATE/ALTER/DROP
      of catalog objects anywhere, including `do` bodies -- records a NOTE
      instead of failing.

FAIL-CLOSED EDGES PINNED TOO. Anything the lexer merely cannot read still
lands in the "proved nothing" refusal: catalog DDL, a comment statement beside
data, a `do` body hiding `execute 'create ...'`, a rejected (short-reason)
claim.

WHY THIS IS A SEPARATE FILE. Same reason as
`test_production_catalog_verification_noop_narrowing.py`: the main suite is
edited concurrently by other sessions; a self-contained module that imports the
same code is a copy to merge later, not a rewrite.

NO DATABASE. Everything drives the pure derivation and reporting logic on
temporary files, plus one real migration read from the repo.
"""

from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))

from production_catalog_verification import (  # noqa: E402
    derive_targets,
    pure_data_offenders,
    read_noop_declaration,
    render_report,
)

REPO = Path(__file__).resolve().parents[1]
VERSION = "20260810140000"
EXAMPLE = (
    REPO
    / "supabase"
    / "migrations"
    / "20261113160920_curated_licensor_scrape_characters_restore.sql"
)
HEADER = (
    "-- catalog-verification: no-op restores curated rows only, "
    "touches no catalog object\n"
)

DATA_ONLY = "update plm.widget set name = 'x' where id = 1;\n"
DATA_DO = (
    "do $load$\n"
    "declare v_n integer;\n"
    "begin\n"
    "  insert into plm.widget (id) select g from generate_series(1, 3) g;\n"
    "  perform plm.touch_widget(1);\n"
    "  if v_n = 0 then raise exception 'empty source; refusing a vacuous pass'; end if;\n"
    "end\n"
    "$load$;\n"
)
HIDDEN_DDL_DO = "do $$ begin execute 'create table plm.x(id int)'; end $$;\n"


def targets_for(sql: str):
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        migrations = root / "supabase" / "migrations"
        migrations.mkdir(parents=True)
        path = migrations / f"{VERSION}_test.sql"
        path.write_text(sql, encoding="utf-8")
        return derive_targets({VERSION: path}, [VERSION])


def render(targets, catalog=None):
    return render_report([VERSION], targets, catalog, None, [], True)


class ExplicitNoopHeaderIsHonored(unittest.TestCase):
    """Behavior (a): the named remedy from the #5932 findings must work."""

    def test_pure_dml_with_the_header_passes_and_records_the_reason(self):
        targets = targets_for(HEADER + DATA_ONLY)
        self.assertIsNotNone(targets.noop_declaration)
        self.assertTrue(targets.noop_declaration["accepted"], targets.noop_declaration)
        markdown, failures = render(targets, {"relations": []})
        self.assertEqual(failures, [])
        self.assertIn("Declared no-op", markdown)
        self.assertIn("restores curated rows only", markdown)

    def test_a_data_only_do_block_with_the_header_is_honored(self):
        """#5932 WIDENING: the header is the named remedy for data migrations
        that wrap their statements in `do` (20261113160920 is this shape), so
        the claim check must recognize a data-only DO body as a true claim."""
        targets = targets_for(HEADER + DATA_DO)
        self.assertTrue(
            targets.noop_declaration["accepted"], targets.noop_declaration
        )
        markdown, failures = render(targets, {"relations": []})
        self.assertEqual(failures, [])
        self.assertIn("Declared no-op", markdown)

    def test_a_do_body_hiding_ddl_still_refutes_the_header(self):
        """The claim is CHECKED, not taken on trust: dynamic SQL inside a `do`
        body is exactly what the body scan exists to refuse."""
        targets = targets_for(HEADER + HIDDEN_DDL_DO)
        self.assertFalse(targets.noop_declaration["accepted"])
        markdown, failures = render(targets, {"relations": []})
        self.assertTrue(failures)
        self.assertIn("REJECTED", failures[0])

    def test_the_real_20261113160920_shape_would_pass_with_the_header(self):
        # The named example, with the named remedy applied: the claim must hold.
        raw = EXAMPLE.read_text(encoding="utf-8")
        header_at_top = raw.replace(
            "-- Version: 20261113160920",
            "-- Version: 20261113160920\n"
            "-- catalog-verification: no-op restores Disney character rows "
            "only, creates no catalog object",
            1,
        )
        declaration = read_noop_declaration(header_at_top, "20261113160920")
        self.assertIsNotNone(declaration)
        self.assertTrue(declaration["accepted"], declaration)


class UndeclaredPureDataIsNotedNotRefused(unittest.TestCase):
    """Behavior (b): no header needed -- the lexer gap must not flag pure data."""

    def test_pure_dml_without_the_header_records_a_note(self):
        targets = targets_for(DATA_ONLY)
        self.assertTrue(targets.is_empty())
        self.assertTrue(targets.pure_data_ok)
        markdown, failures = render(targets, {"relations": []})
        self.assertEqual(failures, [])
        self.assertIn("Pure-data migration", markdown)
        self.assertIn("nothing to verify", markdown)

    def test_a_data_only_do_block_without_the_header_records_a_note(self):
        targets = targets_for(DATA_DO)
        self.assertTrue(targets.is_empty())
        self.assertTrue(targets.pure_data_ok)
        markdown, failures = render(targets, {"relations": []})
        self.assertEqual(failures, [])
        self.assertIn("Pure-data migration", markdown)

    def test_the_real_20261113160920_is_pure_data_and_no_longer_refused(self):
        """THE NAMED EXAMPLE (issue #5932): applied fine, verification red.
        It must now derive a pure-data note, not a failure."""
        raw = EXAMPLE.read_text(encoding="utf-8")
        self.assertEqual(pure_data_offenders(raw), [])
        with tempfile.TemporaryDirectory() as tmp:
            migrations = Path(tmp) / "supabase" / "migrations"
            migrations.mkdir(parents=True)
            path = migrations / "20261113160920_example.sql"
            path.write_text(raw, encoding="utf-8")
            targets = derive_targets({v: p for v, p in [("20261113160920", path)]},
                                     ["20261113160920"])
        self.assertTrue(targets.is_empty())
        self.assertTrue(targets.pure_data_ok)
        markdown, failures = render(targets, {"relations": []})
        self.assertEqual(failures, [])
        self.assertIn("Pure-data migration", markdown)
        self.assertIn("20261113160920", markdown)

    def test_copy_counts_as_data(self):
        self.assertEqual(pure_data_offenders("copy plm.widget from '/tmp/x';\n"), [])


class TheRefusalSurvivesEverythingThatIsNotPureData(unittest.TestCase):
    """#6658: empty-target non-pure data is NOT VERIFIABLE, not a hard failure.
    Pre-merge (#6588) refuses new opaque migrations; this leg only classifies
    what already applied. A false no-op claim remains a failure."""

    def test_a_do_body_hiding_ddl_is_not_verifiable(self):
        targets = targets_for(HIDDEN_DDL_DO)
        self.assertTrue(targets.is_empty())
        self.assertFalse(targets.pure_data_ok)
        markdown, failures = render(targets, {"relations": []})
        self.assertEqual(failures, [])
        self.assertIn("not verifiable", markdown.lower())

    def test_a_comment_beside_data_is_not_verifiable(self):
        targets = targets_for(
            "comment on schema core is 'x';\nupdate plm.widget set a = 1;"
        )
        self.assertTrue(targets.is_empty())
        markdown, failures = render(targets, {"schemas": [], "relations": []})
        self.assertEqual(failures, [])
        self.assertIn("not verifiable", markdown.lower())

    def test_a_principal_change_is_not_pure_data(self):
        self.assertTrue(pure_data_offenders("set role service_role;\n"))
        targets = targets_for("set role service_role;\n")
        markdown, failures = render(targets, {"relations": []})
        self.assertEqual(failures, [])
        self.assertIn("not verifiable", markdown.lower())

    def test_a_system_catalog_write_is_not_pure_data(self):
        self.assertTrue(pure_data_offenders("update pg_class set relacl = null;\n"))

    def test_a_dblink_call_is_not_pure_data(self):
        self.assertTrue(
            pure_data_offenders("select dblink_exec('revoke all on t from public');\n")
        )

    def test_dynamic_sql_inside_a_do_body_names_the_keyword_it_found(self):
        offenders = pure_data_offenders(HIDDEN_DDL_DO)
        self.assertEqual(len(offenders), 1)
        self.assertIn("execute", offenders[0])

    def test_a_rejected_short_reason_header_still_fails(self):
        # The header is present but defective: the claim path governs, and a
        # rejected claim is a defect in its own right (not laundered by not-verifiable).
        targets = targets_for(
            "-- catalog-verification: no-op meh\nupdate plm.widget set a = 1;"
        )
        self.assertFalse(targets.noop_declaration["accepted"])
        markdown, failures = render(targets, {"relations": []})
        self.assertTrue(failures)
        self.assertIn("REJECTED", failures[0])


if __name__ == "__main__":
    unittest.main()
