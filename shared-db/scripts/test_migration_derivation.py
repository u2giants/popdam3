#!/usr/bin/env python3
"""Tests for the issue #1608 derivation gate.

The suite has two halves and BOTH matter.

  * Ordinary behaviour tests -- the gate refuses what it must refuse and accepts
    what it must accept.
  * A MUTATION test (issue #1223). Thirty-two guards in this promotion-evidence
    chain have no test that fails when they are disabled, which means the suite
    stays green while the guard does nothing. `test_gate_is_load_bearing` below
    disables this gate at each of its two seams and asserts the promotion is then
    ACCEPTED. If someone deletes the call site or neuters the refusal, that test
    fails -- it is the only test here that can tell "the guard works" apart from
    "the guard is absent".
"""

from pathlib import Path
import sys
import tempfile
import types
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))

import migration_derivation  # noqa: E402
import production_migration_guard  # noqa: E402
from migration_derivation import (  # noqa: E402
    DECLARATION_MANDATE_FROM,
    LEGACY_DECLARATIONS,
    DerivationError,
    DerivationRefusal,
    assert_declarations_present,
    assert_derivation_bases,
    declaration_required,
    declared_bases,
    parse_declaration,
    parse_overrides,
    replaced_objects,
    unsatisfied_bases,
)
from production_migration_guard import GuardError, local_migrations  # noqa: E402

REPO = Path(__file__).resolve().parent.parent

# The real episode, reduced to its two versions. `20260824135515` says in its own
# header that it is a full re-derivation of `20260814223552`; it was promoted
# alone to a production database that did not have it.
REAL_DERIVED = "20260824135515"
REAL_BASE = "20260814223552"

# Fixture versions for the behaviour tests. Deliberately NOT the real pair: the
# real one now resolves through LEGACY_DECLARATIONS, and `20260814223552` itself
# declares a base, so a fixture tree built from those numbers would also be
# asserting the transitive chain. That chain gets its own test below, where it
# is the thing under test rather than an accident of the fixture.
DERIVED = "20260901000000"
BASE = "20260831000000"

LOADER_SQL = (
    "-- derived-from: {base}\n"
    "create or replace function plm.load_pmt_capture_chunk(p_x jsonb)\n"
    "returns integer language plpgsql as $$ begin return 0; end $$;\n"
)


def write_tree(directory: Path, files: dict[str, str]) -> dict[str, Path]:
    """Write ``version -> sql`` into a migrations directory and return the map."""
    migrations = directory / "supabase" / "migrations"
    migrations.mkdir(parents=True, exist_ok=True)
    for version, sql in files.items():
        (migrations / f"{version}_fixture.sql").write_text(sql, encoding="utf-8")
    return local_migrations(directory)


class ParseDeclaration(unittest.TestCase):
    def test_reads_a_single_base(self):
        self.assertEqual(parse_declaration("-- derived-from: 20260814223552"), frozenset({REAL_BASE}))

    def test_reads_several_bases_on_one_line_and_across_lines(self):
        raw = "-- derived-from: 20260814193351, 20260814213043\n-- derived-from: 20260814223552\n"
        self.assertEqual(
            parse_declaration(raw),
            frozenset({"20260814193351", "20260814213043", REAL_BASE}),
        )

    def test_silence_and_declared_independence_are_different_answers(self):
        # `None` means the author never said. An empty set means the author said
        # "nothing". The mandate below turns on exactly that difference.
        self.assertIsNone(parse_declaration("create or replace view api.x as select 1;"))
        self.assertEqual(parse_declaration("-- derived-from: none"), frozenset())

    def test_tolerates_indentation_and_spacing(self):
        self.assertEqual(
            parse_declaration("\t--   derived-from:   20260814223552  "), frozenset({REAL_BASE})
        )

    def test_refuses_prose_where_a_version_belongs(self):
        # The whole point of the declaration is that it is machine-readable. A
        # header sentence naming the base is what already existed and failed.
        with self.assertRaises(DerivationError) as ctx:
            parse_declaration("-- derived-from: the current body on main", "20260824135515")
        self.assertIn("14-digit migration version", str(ctx.exception))

    def test_refuses_none_combined_with_a_base(self):
        with self.assertRaises(DerivationError):
            parse_declaration("-- derived-from: none, 20260814223552")

    def test_refuses_an_empty_entry(self):
        with self.assertRaises(DerivationError):
            parse_declaration("-- derived-from: 20260814223552,,20260814213043")

    def test_refuses_self_derivation(self):
        with self.assertRaises(DerivationError):
            parse_declaration(f"-- derived-from: {DERIVED}", DERIVED)

    def test_a_line_that_is_not_a_comment_is_not_a_declaration(self):
        self.assertIsNone(parse_declaration("select 'derived-from: 20260814223552';"))


class LegacyOverlay(unittest.TestCase):
    def test_merged_files_are_declared_without_editing_their_bytes(self):
        # Editing a merged migration file changes its bytes, and an unpromotable
        # byte binding is one of the three failure modes this episode produced.
        # The overlay is how those files get a machine-readable declaration.
        self.assertEqual(declared_bases(REAL_DERIVED), frozenset({REAL_BASE}))

    def test_every_overlay_entry_names_a_real_file_and_gives_a_reason(self):
        versions = set(local_migrations(REPO))
        for version, (bases, why) in LEGACY_DECLARATIONS.items():
            self.assertIn(version, versions, f"{version} has no migration file")
            self.assertTrue(bases, f"{version} declares no base")
            self.assertGreater(len(why), 60, f"{version} has no usable rationale")
            for base in bases:
                self.assertIn(base, versions, f"{version} names a base with no file: {base}")
                self.assertLess(base, version, f"{version} names a LATER version as its base")

    def test_the_overlay_never_silently_overrides_a_files_own_line(self):
        raw = "-- derived-from: 20260101000000\n"
        self.assertEqual(declared_bases(REAL_DERIVED, raw=raw), frozenset({"20260101000000"}))

    def test_the_chain_is_enforced_through_the_overlay_not_just_one_hop(self):
        # 20260824135515 -> 20260814223552 -> 20260814213043. Promoting the first
        # two together still leaves the third rewrite's body missing from the
        # target, and the gate says so rather than stopping at the first link.
        migrations = local_migrations(REPO)
        with self.assertRaises(DerivationRefusal) as ctx:
            assert_derivation_bases([REAL_BASE, REAL_DERIVED], migrations, remote=set())
        self.assertIn("20260814213043", str(ctx.exception))


class TheGate(unittest.TestCase):
    """`assert_derivation_bases` -- the promotion refusal itself."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.migrations = write_tree(
            Path(self.tmp.name),
            {
                BASE: "create or replace function plm.load_pmt_capture_chunk() returns int as $$ begin return 0; end $$ language plpgsql;\n",
                DERIVED: LOADER_SQL.format(base=BASE),
            },
        )

    def test_reproduces_the_2026_08_24_promotion_and_refuses_it(self):
        with self.assertRaises(DerivationRefusal) as ctx:
            assert_derivation_bases([DERIVED], self.migrations, remote={"20260811030000"})
        message = str(ctx.exception)
        self.assertIn(DERIVED, message)
        self.assertIn(BASE, message)
        self.assertIn("lacks its base", message)

    def test_accepts_when_the_base_is_already_in_the_target_ledger(self):
        self.assertEqual(assert_derivation_bases([DERIVED], self.migrations, remote={BASE}), [])

    def test_accepts_when_the_base_is_earlier_in_the_same_allowlist(self):
        # Both versions land in one bounded window, base first. That is the
        # correct fix for the refusal, and it must not be refused itself.
        self.assertEqual(assert_derivation_bases([BASE, DERIVED], self.migrations, remote=set()), [])

    def test_a_migration_that_declares_nothing_is_untouched_by_this_gate(self):
        migrations = write_tree(
            Path(self.tmp.name), {"20260101000000": "create table plm.x(id int);\n"}
        )
        self.assertEqual(assert_derivation_bases(["20260101000000"], migrations, remote=set()), [])

    def test_declared_independence_is_never_refused(self):
        migrations = write_tree(
            Path(self.tmp.name),
            {"20260102000000": "-- derived-from: none\ncreate or replace view api.v as select 1;\n"},
        )
        self.assertEqual(assert_derivation_bases(["20260102000000"], migrations, remote=set()), [])

    def test_a_base_with_no_file_at_all_is_still_a_refusal_and_says_so(self):
        migrations = write_tree(
            Path(self.tmp.name), {"20260103000000": LOADER_SQL.format(base="20250101000000")}
        )
        with self.assertRaises(DerivationRefusal) as ctx:
            assert_derivation_bases(["20260103000000"], migrations, remote=set())
        self.assertIn("no file with that version exists", str(ctx.exception))

    def test_the_gate_reads_the_legacy_overlay_for_a_file_with_no_line(self):
        # The real `20260824135515` on disk carries prose, not a declaration.
        # The overlay supplies it, so the real historical file is gated -- this
        # is the 2026-08-24 promotion itself, refused.
        migrations = local_migrations(REPO)
        with self.assertRaises(DerivationRefusal) as ctx:
            assert_derivation_bases([REAL_DERIVED], migrations, remote=set())
        self.assertIn(REAL_BASE, str(ctx.exception))

    def test_the_real_promotion_is_accepted_once_its_base_is_in_the_ledger(self):
        migrations = local_migrations(REPO)
        self.assertEqual(
            assert_derivation_bases(
                [REAL_DERIVED], migrations, remote={REAL_BASE, "20260814213043"}
            ),
            [],
        )


class Overrides(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.migrations = write_tree(Path(self.tmp.name), {DERIVED: LOADER_SQL.format(base=BASE)})

    def test_an_override_that_names_the_resulting_state_is_accepted_and_recorded(self):
        note = "production keeps the 2026-08-11 loader body; the base is applied next window"
        overrides = parse_overrides([f"{DERIVED}:{BASE}={note}"])
        recorded = assert_derivation_bases([DERIVED], self.migrations, set(), overrides)
        self.assertEqual(len(recorded), 1)
        # Recorded VERBATIM. An override nobody can read afterwards is a hole,
        # not an override.
        self.assertIn(note, recorded[0])

    def test_a_bare_approval_is_not_an_override(self):
        with self.assertRaises(DerivationError) as ctx:
            parse_overrides([f"{DERIVED}:{BASE}=approved"])
        self.assertIn("40 characters", str(ctx.exception))

    def test_an_override_for_a_different_pair_does_not_unlock_this_one(self):
        overrides = parse_overrides(
            ["20260101000000:20260102000000=some other promotion entirely, stated at length here"]
        )
        with self.assertRaises(DerivationRefusal):
            assert_derivation_bases([DERIVED], self.migrations, set(), overrides)

    def test_malformed_override_syntax_is_refused(self):
        for bad in [f"{DERIVED}:{BASE}", f"{DERIVED}={'x' * 50}", "nonsense"]:
            with self.subTest(bad=bad), self.assertRaises(DerivationError):
                parse_overrides([bad])

    def test_override_versions_must_be_exact_versions(self):
        with self.assertRaises(DerivationError):
            parse_overrides([f"pmt-loader:{BASE}={'x' * 50}"])


class TheMandate(unittest.TestCase):
    """Issue #1608 ask 2: who MUST declare a base."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)

    def test_replaced_objects_finds_the_at_risk_population(self):
        raw = (
            "create or replace function plm.load_x() returns int as $$ begin return 0; end $$ language plpgsql;\n"
            "CREATE OR REPLACE VIEW api.source_capture_inventory as select 1;\n"
            "create or replace materialized view plm.mv as select 1;\n"
            "create table plm.not_a_replacement(id int);\n"
        )
        self.assertEqual(
            replaced_objects(raw),
            {"plm.load_x", "api.source_capture_inventory", "plm.mv"},
        )

    def test_a_second_rewrite_of_the_same_object_must_declare_a_base(self):
        first, second = "20260827000000", "20260828000000"
        body = "create or replace function plm.load_x() returns int as $$ begin return 0; end $$ language plpgsql;\n"
        migrations = write_tree(Path(self.tmp.name), {first: body, second: body})
        self.assertEqual(declaration_required(migrations), {second: {"plm.load_x"}})
        with self.assertRaises(DerivationError) as ctx:
            assert_declarations_present(migrations)
        self.assertIn(second, str(ctx.exception))
        self.assertIn("plm.load_x", str(ctx.exception))

    def test_a_pre_mandate_version_is_never_retro_mandated(self):
        body = "create or replace function plm.load_x() returns int as $$ begin return 0; end $$ language plpgsql;\n"
        migrations = write_tree(
            Path(self.tmp.name), {"20260101000000": body, "20260102000000": body}
        )
        self.assertEqual(declaration_required(migrations), {})
        assert_declarations_present(migrations)

    def test_the_first_rewrite_of_an_object_is_not_required_to_declare(self):
        body = "create or replace function plm.load_x() returns int as $$ begin return 0; end $$ language plpgsql;\n"
        migrations = write_tree(Path(self.tmp.name), {"20260827000000": body})
        self.assertEqual(declaration_required(migrations), {})
        assert_declarations_present(migrations)

    def test_declaring_independence_satisfies_the_mandate(self):
        first, second = "20260827000000", "20260828000000"
        body = "create or replace function plm.load_x() returns int as $$ begin return 0; end $$ language plpgsql;\n"
        migrations = write_tree(
            Path(self.tmp.name), {first: body, second: "-- derived-from: none\n" + body}
        )
        assert_declarations_present(migrations)

    def test_the_whole_repository_satisfies_the_mandate(self):
        # THIS is the machine check for ask 2. It runs over the real tree on
        # every pull request (the workflow's `python -m unittest scripts/test_*.py`
        # step), which is the only moment a migration can still gain a header line
        # without breaking a byte binding. Every file today predates the mandate,
        # so it passes with no merged byte changed; the day someone adds a new
        # migration that re-replaces an object and says nothing, it fails here.
        assert_declarations_present(local_migrations(REPO))

    def test_the_mandate_cutoff_covers_all_future_work(self):
        # One second after the newest merged migration. Lowering it would demand
        # edits to merged files (byte bindings); raising it would silently
        # un-gate real new migrations. Both are the failure this gate exists to
        # prevent, arriving through the constant instead of through an allowlist.
        self.assertEqual(DECLARATION_MANDATE_FROM, "20260827000000")
        # Every merged file predates it, so no merged byte has to change; the
        # companion test above proves the tree passes the mandate as it stands.
        self.assertTrue(all(v < DECLARATION_MANDATE_FROM for v in local_migrations(REPO)))


class WiredIntoTheLane(unittest.TestCase):
    """The gate is useless unless every promotion path routes through it."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.repo = Path(self.tmp.name)
        write_tree(
            self.repo,
            {
                BASE: "create or replace function plm.load_pmt_capture_chunk() returns int as $$ begin return 0; end $$ language plpgsql;\n",
                DERIVED: LOADER_SQL.format(base=BASE),
            },
        )
        self.migrations = local_migrations(self.repo)

    def test_validate_candidates_refuses_it_as_a_guard_error(self):
        # `prepare` and `preflight` both go through `validate_candidates`, so a
        # refusal here covers both entry points in the workflow.
        with self.assertRaises(GuardError) as ctx:
            production_migration_guard.validate_candidates(
                self.migrations, [DERIVED], remote={"20260811030000"}
            )
        self.assertIn("lacks its base", str(ctx.exception))

    def test_assert_bounded_re_proves_it_immediately_before_the_push(self):
        ledger = self.repo / "ledger.txt"
        ledger.write_text("  |  20260811030000  |  \n", encoding="utf-8")
        production_migration_guard.write_content_manifest(self.repo)
        with self.assertRaises(GuardError) as ctx:
            production_migration_guard.assert_bounded(self.repo, DERIVED, ledger)
        self.assertIn("lacks its base", str(ctx.exception))

    def test_the_cli_exposes_the_recorded_override_on_every_promoting_subcommand(self):
        import argparse
        import io
        import contextlib

        for command in ("prepare", "preflight", "assert-bounded"):
            with self.subTest(command=command):
                buffer = io.StringIO()
                argv = sys.argv
                sys.argv = ["production_migration_guard.py", command, "--help"]
                try:
                    with contextlib.redirect_stdout(buffer), self.assertRaises(SystemExit):
                        production_migration_guard.main()
                finally:
                    sys.argv = argv
                self.assertIn("--derivation-override", buffer.getvalue())
        self.assertTrue(hasattr(argparse, "ArgumentParser"))


class DriftVisibility(unittest.TestCase):
    """Issue #1608 ask 3 -- the Python half the drift report reads."""

    def test_unsatisfied_bases_names_only_what_the_target_is_missing(self):
        raw = "-- derived-from: 20260814193351, 20260814213043\n"
        self.assertEqual(
            unsatisfied_bases("20260899000000", applied={"20260814193351"}, raw=raw),
            ["20260814213043"],
        )

    def test_a_fully_satisfied_version_reports_nothing(self):
        raw = f"-- derived-from: {BASE}\n"
        self.assertEqual(unsatisfied_bases("20260899000000", applied={BASE}, raw=raw), [])


class MutationCoverage(unittest.TestCase):
    """Issue #1223: a guard with no test that fails when it is DISABLED.

    A mechanical sweep found 41 guards in this chain whose suite stayed green
    with the guard replaced by `if False:`. The tests above would all keep
    passing if the gate still raised but nothing ever called it -- or if the call
    survived but the raise did not. These two mutants close both seams.
    """

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.migrations = write_tree(Path(self.tmp.name), {DERIVED: LOADER_SQL.format(base=BASE)})

    @staticmethod
    def _load(name: str, source: str) -> types.ModuleType:
        module = types.ModuleType(name)
        module.__file__ = str(Path(__file__).resolve().parent / f"{name}.py")
        exec(compile(source, module.__file__, "exec"), module.__dict__)
        return module

    def test_baseline_is_red_before_each_mutant_is_measured(self):
        # Method note from issue #1223: a sweep that never asserts a green
        # baseline reports confident nonsense. Here the baseline is the REFUSAL,
        # so it is asserted first and separately.
        with self.assertRaises(DerivationRefusal):
            assert_derivation_bases([DERIVED], self.migrations, remote=set())

    def test_gate_is_load_bearing_at_the_refusal(self):
        source = Path(migration_derivation.__file__).read_text(encoding="utf-8")
        mutated = source.replace("        raise DerivationRefusal(", "        _ = (", 1)
        self.assertNotEqual(mutated, source, "the refusal moved; update this mutant")
        disabled = self._load("migration_derivation_mutant", mutated)
        # With the refusal disabled the 2026-08-24 promotion is ACCEPTED. That is
        # the whole point: this test fails the day the raise stops firing.
        self.assertEqual(
            disabled.assert_derivation_bases([DERIVED], self.migrations, remote=set()), []
        )

    def test_gate_is_load_bearing_at_the_call_site(self):
        source = Path(production_migration_guard.__file__).read_text(encoding="utf-8")
        call = "    assert_declared_bases_present(migrations, allowlist, remote, derivation_overrides)"
        self.assertIn(call, source, "the validate_candidates call site moved; update this mutant")
        disabled = self._load("production_migration_guard_mutant", source.replace(call, "    pass", 1))
        # The real module refuses this exact call (see WiredIntoTheLane); the
        # module with the call site removed does not.
        disabled.validate_candidates(self.migrations, [DERIVED], remote={"20260811030000"})
        with self.assertRaises(GuardError):
            production_migration_guard.validate_candidates(
                self.migrations, [DERIVED], remote={"20260811030000"}
            )


if __name__ == "__main__":
    unittest.main()
