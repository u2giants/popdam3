#!/usr/bin/env python3

from pathlib import Path
import itertools
import json
import re
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))

import production_migration_guard  # noqa: E402
from production_migration_guard import (  # noqa: E402
    HARD_BLOCKED,
    PREVIEW_ONLY_HISTORICAL_RESTORATIONS,
    BUNDLE_20260804,
    FR_HELD_20260803,
    FR_COMPATIBILITY_VERSIONS,
    FR_REMOVAL_VERSIONS,
    FR_SHIP_SET_HOLD,
    MANIFEST_FILENAME,
    VERSION_RE,
    GuardError,
    assert_bounded,
    compute_content_manifest,
    created_objects,
    local_migrations,
    manifest_path,
    CO_PRESENCE_RULES,
    dropped_objects,
    object_events,
    ATOMIC_BATCHES,
    assert_atomic_batches,
    assert_content_manifest,
    assert_no_archaic_function_body,
    hard_references,
    parse_allowlist,
    parse_remote_versions,
    strip_sql,
    preflight_batch,
    prepare,
    validate_candidates,
    verify_dry_run,
    write_content_manifest,
)

REPO = Path(__file__).resolve().parents[1]

# The exact ordered ColdLion promotion batch, named by 14-digit version.
# 14-file ordering: the one that ABORTS at file 3 (20260727221500) with 42P01.
BATCH_14 = [
    "20260724060000",
    "20260724061000",
    "20260727221500",
    "20260727223000",
    "20260727224500",
    "20260728134500",
    "20260729230000",
    "20260729234500",
    "20260729235500",
    "20260730000500",
    "20260731163000",
    "20260731180000",
    "20260731190000",
    "20260731200000",
]
# 18-file ordering: the four unblocked 2026-08-04 inserted at positions 3-6,
# ahead of 20260727221500 (position 7) and 20260728134500 (position 10).
BATCH_18 = sorted(BATCH_14 + sorted(BUNDLE_20260804))

# !! HAND-ENTERED OFFLINE RECONSTRUCTION -- NOT READ FROM PRODUCTION !!
# PRODUCTION_LEDGER_HEAD, PRODUCTION_LEDGER_ROWS and PENDING_9_UNRELATED below
# were copied from docs/production-migration-lane-design-20260802.md, which
# recorded them from a read of production on 2026-08-02. Nothing in this test
# file has ever contacted the production database, and the agent that wrote
# these tests was forbidden from doing so. Production moves independently of
# this repo, so these constants go stale silently.
# THEY MUST BE RE-VERIFIED AGAINST THE LIVE PRODUCTION LEDGER IMMEDIATELY BEFORE
# ANY PROMOTION. A green test here is evidence that the SCANNER works, never
# evidence about production's current state.
#
# The 27 versions pending on production at the 2026-08-02 lane design
# (docs/production-migration-lane-design-20260802.md sections 1.1 and 4):
# the 18 ColdLion above plus 9 unrelated. Used to reconstruct production's
# ledger offline; the reconstruction is self-checked against the recorded
# production row count of 359, so a stale constant fails loudly.
PENDING_9_UNRELATED = [
    "20260727230000",
    "20260728171500",
    "20260728174500",
    "20260728181500",
    "20260729120000",
    "20260731150000",
    "20260731153000",
    "20260731210000",
    "20260731220000",
]
PRODUCTION_LEDGER_HEAD = "20260731230000"
PRODUCTION_LEDGER_ROWS = 359


def production_ledger_versions() -> set[str]:
    pending = set(BATCH_18) | set(PENDING_9_UNRELATED)
    versions = {
        version
        for version in local_migrations(REPO)
        if version <= PRODUCTION_LEDGER_HEAD and version not in pending
    }
    if len(versions) != PRODUCTION_LEDGER_ROWS:
        raise AssertionError(
            f"reconstructed production ledger has {len(versions)} rows, "
            f"expected {PRODUCTION_LEDGER_ROWS}"
        )
    return versions



def recorded_apply_set() -> list[str]:
    """The 50-row production apply set, read from the document that recorded it.

    docs/verification/production-apply-set-and-rehearsal-20260809.md section 3
    is the authority for this list. Reading it here rather than re-deriving it
    from a version range matters: a range guess returns 49/51 (it sweeps files
    the document deliberately excludes), and it would drift silently every time
    a migration lands. If the document is edited, this test fails loudly, which
    is the intended coupling.
    """
    path = (
        REPO
        / "docs"
        / "verification"
        / "production-apply-set-and-rehearsal-20260809.md"
    )
    rows: list[tuple[int, str]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        match = re.match(r"\|\s*(\d+)\s*\|\s*`(\d{14})`", line)
        if match:
            rows.append((int(match.group(1)), match.group(2)))
    versions = [version for _, version in sorted(rows)]
    if len(versions) != 47:
        raise AssertionError(
            f"expected 47 parseable APPLY rows in the apply-set document, "
            f"found {len(versions)}"
        )
    return versions


def write_migrations(root: Path, files: dict[str, str]) -> Path:
    directory = root / "supabase" / "migrations"
    directory.mkdir(parents=True, exist_ok=True)
    for name, body in files.items():
        (directory / name).write_text(body, encoding="utf-8")
    return root


STEP_START = "      - "


def _steps(job: str) -> list[str]:
    """Split a job body into its individual `steps:` entries.

    Deliberately not PyYAML: this runs on the CI runner's default interpreter
    and an ImportError must never be able to downgrade a production guard into
    a skipped test. Steps in this workflow start at a fixed six-space indent.
    """
    steps: list[list[str]] = []
    for line in job.splitlines():
        if line.startswith(STEP_START):
            steps.append([line])
        elif steps:
            steps[-1].append(line)
    return ["\n".join(step) for step in steps]


def _run_block_commands(step: str) -> list[str]:
    """Return one step's `run:` script as a list of logical shell commands.

    Blank lines and comments are dropped, and backslash continuations are
    joined, so "the next command" means the next thing the shell actually
    executes rather than the next line of text.
    """
    if "run: |" not in step:
        return []
    body = step.split("run: |", 1)[1]
    commands: list[str] = []
    pending = ""
    for raw in body.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.endswith("\\"):
            pending += line[:-1].strip() + " "
            continue
        commands.append((pending + line).strip())
        pending = ""
    if pending:
        commands.append(pending.strip())
    return commands


class GuardTests(unittest.TestCase):
    def test_preview_only_historical_restoration_is_never_production_allowlisted(self):
        self.assertEqual(
            PREVIEW_ONLY_HISTORICAL_RESTORATIONS,
            {"20260817150944", "20260824150630"},
        )
        with self.assertRaisesRegex(GuardError, "preview-only historical restoration"):
            parse_allowlist("20260817150944")
        with self.assertRaisesRegex(GuardError, "preview-only historical restoration"):
            parse_allowlist("20260824150630")

    def test_bad_allowlists_are_blocked(self) -> None:
        values = [
            "",
            "20260727",
            "20260727010000,",
            ",20260727010000",
            "20260727010000,20260727010000",
            "20260727020000,20260727010000",
            # The Master Data pair stays HARD_BLOCKED permanently: already
            # applied to production, listed so the known lockdown mistake
            # (AGENTS.md section 0.4) can never be re-run.
            "20260726190000",
            "20260726200000",
        ]
        for value in values:
            with self.subTest(value=value), self.assertRaises(GuardError):
                parse_allowlist(value)

    def test_the_block_list_matches_the_governed_retirements(self) -> None:
        # Three kinds, deliberately together. 20260726190000/20260726200000 are the
        # already-applied Master Data pair. 20260729120000 is the third kind:
        # never applied, and applying it would REGRESS a live production security
        # control. 20260816045130 is the retired non-atomic OrderList migration.
        # See the guard's own comments and
        # docs/verification/production-apply-set-and-rehearsal-20260809.md).
        self.assertEqual(
            HARD_BLOCKED,
            {
                "20260814170749",
                "20260726190000",
                "20260726200000",
                "20260729120000",
                "20260816045130",
                "20260819011639",
                "20260819151536",
                "20260824181600",
                "20260814224937",
                "20260814233342",
                "20260814233423",
                "20260802171000",
                "20260825010603",
                "20260825025154",
                "20260825031841",
                "20260814223552",
                "20260825094455",
            },
        )

    def test_stranded_warner_original_is_blocked_but_reissue_is_allowed(self) -> None:
        with self.assertRaisesRegex(GuardError, "20260814170749"):
            parse_allowlist("20260814170749")
        with self.assertRaisesRegex(GuardError, "20260814170749"):
            parse_allowlist("20260814170749,20260825201330")
        self.assertEqual(parse_allowlist("20260825201330"), ["20260825201330"])

    def test_the_superseded_1427_paths_cannot_enter_an_allowlist(self) -> None:
        for version in ("20260825010603", "20260825025154", "20260825031841"):
            with self.subTest(version=version), self.assertRaises(GuardError):
                parse_allowlist(version)

    def test_the_superseded_universe_b_original_cannot_enter_an_allowlist(self) -> None:
        with self.assertRaises(GuardError):
            parse_allowlist("20260824181600")

    def test_the_unsafe_issue_853_migration_cannot_enter_an_allowlist(self) -> None:
        with self.assertRaises(GuardError):
            parse_allowlist("20260816045130")

    def test_the_retired_source_resolution_migration_cannot_enter_an_allowlist(self) -> None:
        with self.assertRaises(GuardError):
            parse_allowlist("20260814224937")

    def test_the_source_resolution_companion_cannot_enter_an_allowlist(self) -> None:
        """20260814233423 needs the retired 20260814224937's table to exist."""
        with self.assertRaises(GuardError):
            parse_allowlist("20260814233423")

    def test_the_superseded_capture_inventory_view_cannot_enter_an_allowlist(self) -> None:
        """It would replace the live view with a body that drops three licensors."""
        with self.assertRaises(GuardError):
            parse_allowlist("20260814233342")

    def test_the_retired_lockdown_migration_cannot_enter_an_allowlist(self) -> None:
        """A2's RETIRE verdict must be mechanical, not prose. (Kimi K3.)"""
        with self.assertRaises(GuardError):
            parse_allowlist("20260728174500,20260729120000,20260729230000")

    def test_the_four_coldlion_versions_are_unblocked(self) -> None:
        # Owner ruling 2026-08-04, AGENTS.md section 6.8: unblocked as ONE
        # bundle, never individually.
        self.assertEqual(
            BUNDLE_20260804,
            {
                "20260726030000",
                "20260726031000",
                "20260726032000",
                "20260726180000",
            },
        )
        self.assertFalse(BUNDLE_20260804 & HARD_BLOCKED)
        self.assertEqual(
            parse_allowlist(",".join(sorted(BUNDLE_20260804))),
            sorted(BUNDLE_20260804),
        )

    def test_local_migration_versions_are_unique(self) -> None:
        # A duplicate 14-digit version silently SKIPS a migration: the ledger
        # keys on the version alone.
        versions = [path.name[:14] for path in (REPO / "supabase" / "migrations").glob("*.sql")]
        self.assertGreater(len(versions), 300)
        duplicates = sorted({v for v in versions if versions.count(v) > 1})
        self.assertEqual(duplicates, [], f"duplicate migration versions: {duplicates}")
        # And the loader must refuse them rather than silently keeping one.
        with tempfile.TemporaryDirectory() as directory:
            repo = write_migrations(
                Path(directory),
                {
                    "20260101000000_one.sql": "select 1;",
                    "20260101000000_two.sql": "select 2;",
                },
            )
            with self.assertRaises(GuardError):
                local_migrations(repo)

    def test_the_bundle_cannot_be_promoted_in_parts(self) -> None:
        # AGENTS.md 6.8: all four or none. Every proper non-empty subset must be
        # rejected, including the single-version case a future session would
        # most plausibly try (20260726180000, the one that creates the two
        # missing tables).
        ordered = sorted(BUNDLE_20260804)
        for size in range(1, len(ordered)):
            for subset in itertools.combinations(ordered, size):
                with self.subTest(subset=subset), self.assertRaises(GuardError) as caught:
                    parse_allowlist(",".join(subset))
                self.assertIn("6.8", str(caught.exception))
        # The complete bundle is accepted, and so is an allowlist with none of it.
        parse_allowlist(",".join(ordered))
        parse_allowlist("20260731163000,20260731180000")

    def test_a_partial_bundle_inside_the_real_batch_is_rejected(self) -> None:
        # The exact composition the reviewer proved slipped through: the 14-file
        # batch plus 20260726180000 only. It fixes the 42P01 abort while leaving
        # phase 4 behind, which is the half-composable batch 6.8 forbids.
        partial = sorted(BATCH_14 + ["20260726180000"])
        with self.assertRaises(GuardError) as caught:
            parse_allowlist(",".join(partial))
        message = str(caught.exception)
        self.assertIn("20260726030000", message)
        self.assertIn("20260726031000", message)
        self.assertIn("20260726032000", message)

    def test_the_fr_held_pair_is_refused_unless_the_whole_ship_set_travels(self) -> None:
        # AGENTS.md 6.5 (OWNER RULING 2026-08-03). This is the live state as of
        # 2026-08-20 (#1339): FR_REMOVAL_VERSIONS is now POPULATED, so a held
        # version alone is refused for being a SUBSET of the ship set rather than
        # for the set being unassemblable. Either way it must ERROR, and the
        # message must cite 6.5 -- that is the property this test protects, and
        # it must keep holding whether or not the removal work exists.
        self.assertTrue(FR_REMOVAL_VERSIONS)
        for version in sorted(FR_HELD_20260803):
            with self.subTest(version=version), self.assertRaises(GuardError) as caught:
                parse_allowlist(version)
            self.assertIn("6.5", str(caught.exception))
        # The pair together is just as forbidden as either one alone.
        with self.assertRaises(GuardError) as caught:
            parse_allowlist(",".join(sorted(FR_HELD_20260803)))
        self.assertIn("6.5", str(caught.exception))
        # And inside a realistic batch, which is how it would actually arrive:
        # the rehearsal document listed both as APPLY inside the 49.
        batch = sorted(BATCH_18 + sorted(FR_HELD_20260803))
        with self.assertRaises(GuardError) as caught:
            parse_allowlist(",".join(batch))
        message = str(caught.exception)
        self.assertIn("6.5", message)
        for version in sorted(FR_SHIP_SET_HOLD):
            self.assertIn(version, message)
        # An allowlist with no held version still parses, so the rule is
        # targeted and not a blanket refusal.
        parse_allowlist(",".join(BATCH_18))

    def test_the_real_guarded_forward_version_is_refused_by_name(self) -> None:
        """Issue #1182, the regression this test exists for.

        On 2026-08-18 the guarded forward migration was re-reserved from
        20260817232425 to 20260818174350. The guard kept the OLD string, which
        named no file, and the file that really existed was in no hold set at
        all. An allowlist of exactly this one version parsed clean and would
        have left `core.licensor` FR inactive on production indefinitely --
        the state AGENTS.md 6.5 forbids.

        This asserts the LITERAL version, on purpose. Deriving it from the set
        would pass no matter what the set contained, which is precisely how the
        hole stayed open.
        """
        self.assertIn("20260818174350", FR_HELD_20260803)
        self.assertNotIn("20260817232425", FR_HELD_20260803)
        with self.assertRaises(GuardError) as caught:
            parse_allowlist("20260818174350")
        self.assertIn("6.5", str(caught.exception))

    def test_the_compatibility_prerequisite_is_refused_alone(self) -> None:
        """AGENTS.md 6.5 holds 20260817225127 by name: "Not alone."

        Until 2026-08-18 the 6.5 refusal triggered only when an FR_HELD member
        was already in the allowlist, so the compatibility prerequisite on its
        own parsed clean -- the code was narrower than the owner ruling it
        claims to enforce. The prose is authoritative.
        """
        for version in sorted(FR_COMPATIBILITY_VERSIONS):
            with self.subTest(version=version), self.assertRaises(GuardError) as caught:
                parse_allowlist(version)
            self.assertIn("6.5", str(caught.exception))

    def test_every_member_of_the_fr_hold_set_is_refused_alone(self) -> None:
        """No member of the 6.5 hold set may ever be promotable on its own."""
        self.assertEqual(FR_SHIP_SET_HOLD, FR_HELD_20260803 | FR_COMPATIBILITY_VERSIONS)
        for version in sorted(FR_SHIP_SET_HOLD):
            with self.subTest(version=version), self.assertRaises(GuardError) as caught:
                parse_allowlist(version)
            self.assertIn("6.5", str(caught.exception))

    def test_the_fr_ship_set_must_be_complete_once_removal_migrations_exist(self) -> None:
        # The future legal event: the two held versions promoted together WITH
        # the FR removal work, in one bounded apply. Simulate registration of
        # two removal versions and prove the co-presence rule both ACCEPTS the
        # complete set and REJECTS every proper subset that still holds one of
        # the two 6.5 versions.
        removal = {"20260810010000", "20260810050000"}
        full = sorted(FR_HELD_20260803 | FR_COMPATIBILITY_VERSIONS | removal)
        with patch("production_migration_guard.FR_REMOVAL_VERSIONS", removal):
            self.assertEqual(parse_allowlist(",".join(full)), full)
            for size in range(1, len(full)):
                for subset in itertools.combinations(full, size):
                    if not (FR_SHIP_SET_HOLD & set(subset)):
                        # Not a 6.5 allowlist at all; nothing to enforce.
                        continue
                    with self.subTest(subset=subset), self.assertRaises(GuardError) as caught:
                        parse_allowlist(",".join(subset))
                    self.assertIn("6.5", str(caught.exception))

    def test_the_real_fr_removal_version_is_registered_by_name(self) -> None:
        """Issue #1339: the hold releases by DATA, and this is that data.

        The literal is asserted on purpose, exactly as
        `test_the_real_guarded_forward_version_is_refused_by_name` asserts the
        guarded forward version. Deriving it from the set would pass no matter
        what the set contained, and an FR_REMOVAL_VERSIONS holding the WRONG
        string is the #1182 failure repeated: it reads as an assembled ship set
        and gates nothing.
        """
        self.assertIn("20260820183334", FR_REMOVAL_VERSIONS)
        # It is removal work, never a hold trigger. If it ever appeared in a
        # hold set as well, `required - values` could never be satisfied.
        self.assertNotIn("20260820183334", FR_SHIP_SET_HOLD)

    def test_the_real_fr_ship_set_parses_only_when_complete(self) -> None:
        """The one legal event, expressed against the REAL sets, not a fixture.

        The sibling above rehearses this with a patched, invented removal set.
        That proves the RULE. This proves the LIVE CONFIGURATION -- that the
        versions actually registered today assemble into an allowlist the guard
        accepts, and that nothing smaller does.
        """
        full = sorted(FR_SHIP_SET_HOLD | FR_REMOVAL_VERSIONS)
        self.assertEqual(parse_allowlist(",".join(full)), full)
        for size in range(1, len(full)):
            for subset in itertools.combinations(full, size):
                if not (FR_SHIP_SET_HOLD & set(subset)):
                    continue
                with self.subTest(subset=subset), self.assertRaises(GuardError) as caught:
                    parse_allowlist(",".join(subset))
                self.assertIn("6.5", str(caught.exception))

    def test_remote_parser_uses_remote_column(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "ledger.txt"
            path.write_text(
                " Local          | Remote         | Time\n"
                " 20260727010000 | 20260726010000 | x\n"
                " 20260727020000 |                | x\n",
                encoding="utf-8",
            )
            self.assertEqual(parse_remote_versions(path), {"20260726010000"})

    def test_empty_remote_ledger_is_blocked(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "ledger.txt"
            path.write_text("Local | Remote | Time\n", encoding="utf-8")
            with self.assertRaises(GuardError):
                parse_remote_versions(path)

    def test_unknown_and_applied_versions_are_blocked(self) -> None:
        migrations = {"20260727010000": Path("one.sql")}
        with self.assertRaises(GuardError):
            validate_candidates(migrations, ["20260727020000"], set())
        with self.assertRaises(GuardError):
            validate_candidates(
                migrations, ["20260727010000"], {"20260727010000"}
            )

    def test_dry_run_requires_exact_list(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "dry.txt"
            path.write_text(
                "Would push these migrations:\n"
                " • 20260727010000_one.sql\n"
                " • 20260727020000_two.sql\n",
                encoding="utf-8",
            )
            with self.assertRaises(GuardError):
                verify_dry_run(path, "20260727010000")
            verify_dry_run(path, "20260727010000,20260727020000")

    def test_dry_run_without_marker_is_blocked(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "dry.txt"
            path.write_text("20260727010000_one.sql\n", encoding="utf-8")
            with self.assertRaises(GuardError):
                verify_dry_run(path, "20260727010000")

    def test_the_production_apply_is_gated_not_forbidden(self) -> None:
        """SUPERSEDES `test_general_workflow_has_no_production_apply` (issue #617).

        Until 2026-08-10 this workflow could never apply to production: the job
        opened with a `Refuse production apply` step. That was the right shape
        while no approval gate existed, but it also meant the lane was never
        runnable, and four licensor features queued behind it.

        The refusal is now replaced by GATES, and this test pins them. If a
        future edit removes any one of them, production becomes writable by a
        workflow_dispatch alone.
        """
        workflow = (
            Path(__file__).resolve().parents[1]
            / ".github"
            / "workflows"
            / "shared-supabase-migrations.yml"
        ).read_text(encoding="utf-8")
        # Gate 1: the dry-run job cannot apply, whatever mode is requested.
        self.assertIn(
            "inputs.target == 'production' && inputs.mode == 'dry-run'", workflow
        )
        # Gate 2: the only writing job sits behind the `production` environment.
        self.assertIn("environment: production", workflow)
        # Gate 3: a typed confirmation, and a deterministic guard preflight that
        # is independent of the recorded review reference.
        self.assertIn('= "APPLY $REQUESTED_SHA"', workflow)
        self.assertIn("production_migration_guard.py preflight", workflow)

    def test_include_all_is_bounded_and_dry_run_only(self) -> None:
        """--include-all is licensed ONLY against the pruned bounded checkout.

        AGENTS.md 5.1(4). The bound is the FILESYSTEM, not the flag, so the
        invariant that matters is not "these words appear somewhere earlier in
        the job" -- it is that within the SAME `run:` block, the shell enters
        the bounded checkout, then `assert-bounded` succeeds, and then the very
        next command is the push. Anything weaker still passes if a later edit
        splits the push into its own step, where the `cd` no longer applies and
        the shell is back in $GITHUB_WORKSPACE.

        Parsed without PyYAML on purpose: this test runs on the CI runner's
        default interpreter, and a missing optional dependency must not be able
        to turn a production guard into a silent skip.
        """
        workflow = (
            Path(__file__).resolve().parents[1]
            / ".github"
            / "workflows"
            / "shared-supabase-migrations.yml"
        ).read_text(encoding="utf-8")
        # Scope to THIS job only. Slicing to end-of-file used to be
        # equivalent; it stopped being so when the apply jobs were added
        # below, and an unscoped slice would silently start asserting about
        # a different job's push. The apply job has its own equivalent test.
        production = workflow.split("production-dry-run:", 1)[1].split(
            "\n  production-apply-review:", 1
        )[0]

        blocks = [
            commands
            for commands in (
                _run_block_commands(step) for step in _steps(production)
            )
            if any("--include-all" in command for command in commands)
        ]
        self.assertEqual(len(blocks), 1, "exactly one step may use --include-all")
        commands = blocks[0]

        pushes = [i for i, c in enumerate(commands) if "--include-all" in c]
        self.assertEqual(len(pushes), 1, commands)
        push = pushes[0]
        self.assertIn("supabase db push", commands[push])
        self.assertIn("--dry-run", commands[push])

        checks = [i for i, c in enumerate(commands) if "assert-bounded" in c]
        self.assertEqual(len(checks), 1, commands)
        check = checks[0]
        # A real invocation, not a comment or a bare mention.
        self.assertIn("production_migration_guard.py", commands[check])
        self.assertIn('--dir "$RUNNER_TEMP/bounded-production"', commands[check])
        # The only permitted branch between the bound proof and the normal CLI
        # push is the exact-hash atomic policy path. Its own preflight never
        # falls through into the CLI push.
        self.assertLess(check, push, commands)
        between = "\n".join(commands[check + 1 : push])
        self.assertIn("--classify-allowlist", between)
        self.assertIn("atomic_migration_apply.py", between)

        cds = [i for i, c in enumerate(commands) if c.startswith("cd ")]
        self.assertEqual(cds, [0], commands)
        self.assertEqual(commands[0], 'cd "$RUNNER_TEMP/bounded-production"')

        # WIDENED 2026-08-11 (issue #739). This used to read
        #     other_jobs = workflow.split("production-dry-run:", 1)[0]
        # with the comment "every other job -- including the real `preview`
        # apply -- must never carry the flag at all".
        #
        # That was TRUE when it was written and is FALSE now, which is the only
        # reason it moved. It was written when `preview` ran a BARE
        # `supabase db push` in $GITHUB_WORKSPACE, where `--include-all` really
        # would have meant "sweep every pending migration" -- the exact danger
        # this suite exists to prevent. Since #739 the preview job builds the
        # SAME pruned checkout via `production_migration_guard.py prepare` and
        # re-proves it with `assert-bounded` at the point of use, so the flag
        # there is bounded by the filesystem exactly as it is in production.
        #
        # The rule is therefore now stated by what it actually protects rather
        # than by which job it happens to be in: `--include-all` is banned
        # everywhere EXCEPT a checkout that `prepare` has pruned to
        # `remote-ledger | allowlist`. The workflow header and the `validate`
        # job -- everything above `preview:` -- may never carry it, and
        # `test_include_all_never_runs_in_the_github_workspace` below enforces
        # the bounded-checkout requirement on all three jobs that may.
        #
        # Do NOT narrow this back to a job-name list. If a fourth job ever
        # wants the flag, it earns it by building a bounded checkout, not by
        # being added to an allowlist here.
        other_jobs = workflow.split("\n  preview:", 1)[0]
        self.assertNotIn("--include-all", other_jobs)

    def test_run_blocks_do_not_embed_dispatch_inputs(self) -> None:
        workflow = (
            Path(__file__).resolve().parents[1]
            / ".github"
            / "workflows"
            / "shared-supabase-migrations.yml"
        ).read_text(encoding="utf-8")
        in_run = False
        run_indent = 0
        for line in workflow.splitlines():
            indent = len(line) - len(line.lstrip())
            if line.lstrip().startswith("run:"):
                in_run = True
                run_indent = indent
            elif in_run and line.strip() and indent <= run_indent:
                in_run = False
            if in_run:
                self.assertNotIn("${{ inputs.", line)

    def test_prepare_removes_every_unapproved_pending_file(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repo = root / "repo"
            output = root / "bounded"
            migrations = repo / "supabase" / "migrations"
            migrations.mkdir(parents=True)
            for name in (
                "20260727010000_applied.sql",
                "20260727020000_approved.sql",
                "20260727030000_unapproved.sql",
            ):
                (migrations / name).write_text("select 1;\n", encoding="utf-8")
            ledger = root / "ledger.txt"
            ledger.write_text(
                "Local | Remote | Time\n"
                "20260727010000 | 20260727010000 | x\n",
                encoding="utf-8",
            )

            def fake_worktree(*_args, **_kwargs):
                import shutil
                shutil.copytree(repo, output)

            with patch(
                "production_migration_guard.subprocess.run",
                side_effect=fake_worktree,
            ):
                prepare(
                    repo,
                    output,
                    "a" * 40,
                    "20260727020000",
                    ledger,
                )
            names = sorted(path.name for path in (output / "supabase" / "migrations").glob("*.sql"))
            self.assertEqual(
                names,
                [
                    "20260727010000_applied.sql",
                    "20260727020000_approved.sql",
                ],
            )


class AssertBoundedTests(unittest.TestCase):
    """The re-check that licenses --include-all at the point of use."""

    def _fixture(self, root: Path, names: tuple[str, ...]) -> tuple[Path, Path]:
        migrations = root / "supabase" / "migrations"
        migrations.mkdir(parents=True)
        for name in names:
            (migrations / name).write_text("select 1;\n", encoding="utf-8")
        ledger = root / "ledger.txt"
        ledger.write_text(
            "Local | Remote | Time\n20260727010000 | 20260727010000 | x\n",
            encoding="utf-8",
        )
        # `prepare` pins byte content, so a realistic fixture does too. Tests
        # that want to simulate drift/tamper mutate the files or the manifest
        # AFTER this point.
        write_content_manifest(root)
        return root, ledger

    def test_accepts_a_checkout_of_exactly_remote_union_allowlist(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root, ledger = self._fixture(
                Path(directory),
                ("20260727010000_applied.sql", "20260727020000_approved.sql"),
            )
            assert_bounded(root, "20260727020000", ledger)

    def test_blocks_an_unpruned_checkout(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root, ledger = self._fixture(
                Path(directory),
                (
                    "20260727010000_applied.sql",
                    "20260727020000_approved.sql",
                    "20260727030000_unapproved.sql",
                ),
            )
            with self.assertRaises(GuardError) as caught:
                assert_bounded(root, "20260727020000", ledger)
            self.assertIn("20260727030000", str(caught.exception))

    def test_blocks_an_empty_checkout(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root, ledger = self._fixture(Path(directory), ())
            with self.assertRaises(GuardError):
                assert_bounded(root, "20260727020000", ledger)


# ===========================================================================
# FILE-CONTENT DIGEST PINNING (issue #617)
#
# `prepare` now writes a SHA-256 manifest of the bounded files and
# `assert_bounded` re-proves it. The membership checks above (and in `prepare`)
# still gate the SET of files; these tests gate the BYTES. Every divergence --
# content drift, a hand-edited manifest digest, a file added or removed after
# the pin, or no manifest at all -- must fail CLOSED. No test here special-cases
# a version or table: the pin is generic.
# ===========================================================================
class ContentManifestTests(unittest.TestCase):
    def _prepared(
        self, root: Path, names: tuple[str, ...], body: str = "select 1;\n"
    ) -> Path:
        """A bounded checkout exactly as `prepare` leaves it: files + manifest."""
        migrations = root / "supabase" / "migrations"
        migrations.mkdir(parents=True)
        for name in names:
            (migrations / name).write_text(body, encoding="utf-8")
        write_content_manifest(root)
        return root

    def _ledger(self, root: Path) -> Path:
        ledger = root / "ledger.txt"
        ledger.write_text(
            "Local | Remote | Time\n20260727010000 | 20260727010000 | x\n",
            encoding="utf-8",
        )
        return ledger

    def test_a_stable_pinned_checkout_passes(self) -> None:
        """The happy path: nothing changed between prepare and the push."""
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self._prepared(
                root,
                ("20260727010000_applied.sql", "20260727020000_approved.sql"),
            )
            ledger = self._ledger(root)
            assert_bounded(root, "20260727020000", ledger)

    def test_prepare_writes_a_manifest_for_the_bounded_set(self) -> None:
        # `prepare` is the producer of the pin. It must leave a manifest whose
        # entries are exactly the bounded file versions, each a real sha256.
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repo = root / "repo"
            output = root / "bounded"
            mig = repo / "supabase" / "migrations"
            mig.mkdir(parents=True)
            for name in (
                "20260727010000_applied.sql",
                "20260727020000_approved.sql",
                "20260727030000_unapproved.sql",
            ):
                (mig / name).write_text("select 1;\n", encoding="utf-8")
            ledger = self._ledger(root)

            def fake_worktree(*_args, **_kwargs):
                import shutil

                shutil.copytree(repo, output)

            with patch(
                "production_migration_guard.subprocess.run",
                side_effect=fake_worktree,
            ):
                prepare(repo, output, "a" * 40, "20260727020000", ledger)

            mpath = manifest_path(output)
            self.assertTrue(mpath.is_file(), "prepare must write the manifest")
            import hashlib

            stored = json.loads(mpath.read_text(encoding="utf-8"))
            # The pruned set is the applied + the one allowlisted file.
            self.assertEqual(
                set(stored),
                {"20260727010000", "20260727020000"},
            )
            for version, digest in stored.items():
                self.assertEqual(len(digest), 64)
                fname = (
                    "20260727010000_applied.sql"
                    if version == "20260727010000"
                    else "20260727020000_approved.sql"
                )
                self.assertEqual(
                    digest,
                    hashlib.sha256(
                        (output / "supabase" / "migrations" / fname).read_bytes()
                    ).hexdigest(),
                )
            # The manifest is a sibling of migrations/, never inside it, so it
            # cannot be mistaken for a migration by the CLI or by local_migrations.
            self.assertEqual(mpath.name, MANIFEST_FILENAME)
            self.assertEqual(mpath.parent.name, "supabase")

    def test_byte_drift_after_prepare_is_refused(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self._prepared(
                root,
                ("20260727010000_applied.sql", "20260727020000_approved.sql"),
            )
            ledger = self._ledger(root)
            # Mutate ONE file's bytes after the pin. The membership set is
            # unchanged, so only the content pin can catch this.
            (root / "supabase" / "migrations" / "20260727020000_approved.sql").write_text(
                "select 2;\n", encoding="utf-8"
            )
            with self.assertRaises(GuardError) as caught:
                assert_bounded(root, "20260727020000", ledger)
            message = str(caught.exception)
            self.assertIn("manifest mismatch", message)
            self.assertIn("byte drift", message)
            self.assertIn("20260727020000", message)

    def test_a_tampered_manifest_digest_is_refused(self) -> None:
        # Hand-editing a pinned digest is indistinguishable from content drift
        # to the recompute-and-compare check, and must fail the same way.
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self._prepared(
                root,
                ("20260727010000_applied.sql", "20260727020000_approved.sql"),
            )
            ledger = self._ledger(root)
            mpath = manifest_path(root)
            tampered = json.loads(mpath.read_text(encoding="utf-8"))
            tampered["20260727020000"] = "0" * 64
            mpath.write_text(json.dumps(tampered), encoding="utf-8")
            with self.assertRaises(GuardError) as caught:
                assert_bounded(root, "20260727020000", ledger)
            message = str(caught.exception)
            self.assertIn("manifest mismatch", message)
            self.assertIn("20260727020000", message)

    def test_a_file_removed_after_prepare_is_refused(self) -> None:
        # The old membership check only flagged EXTRA files; a removed
        # allowlisted file slipped through it. The manifest pin catches it.
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self._prepared(
                root,
                ("20260727010000_applied.sql", "20260727020000_approved.sql"),
            )
            ledger = self._ledger(root)
            (root / "supabase" / "migrations" / "20260727020000_approved.sql").unlink()
            with self.assertRaises(GuardError) as caught:
                assert_bounded(root, "20260727020000", ledger)
            message = str(caught.exception)
            self.assertIn("manifest mismatch", message)
            self.assertIn("removed from disk", message)
            self.assertIn("20260727020000", message)

    def test_a_file_added_after_prepare_is_refused_by_membership_first(self) -> None:
        # An added file is caught by BOTH the membership check and the manifest.
        # Membership fires first, preserving the existing named failure message.
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self._prepared(
                root,
                ("20260727010000_applied.sql", "20260727020000_approved.sql"),
            )
            ledger = self._ledger(root)
            (root / "supabase" / "migrations" / "20260727030000_sneaky.sql").write_text(
                "select 3;\n", encoding="utf-8"
            )
            with self.assertRaises(GuardError) as caught:
                assert_bounded(root, "20260727020000", ledger)
            message = str(caught.exception)
            self.assertIn("NOT bounded", message)
            self.assertIn("20260727030000", message)

    def test_a_missing_manifest_fails_closed(self) -> None:
        # No pin at all -- prepare never ran, or the manifest was deleted.
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self._prepared(
                root,
                ("20260727010000_applied.sql", "20260727020000_approved.sql"),
            )
            ledger = self._ledger(root)
            manifest_path(root).unlink()
            with self.assertRaises(GuardError) as caught:
                assert_bounded(root, "20260727020000", ledger)
            self.assertIn("content manifest missing", str(caught.exception))

    def test_a_corrupt_manifest_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self._prepared(
                root,
                ("20260727010000_applied.sql", "20260727020000_approved.sql"),
            )
            ledger = self._ledger(root)
            manifest_path(root).write_text("{not json", encoding="utf-8")
            with self.assertRaises(GuardError) as caught:
                assert_bounded(root, "20260727020000", ledger)
            self.assertIn("unreadable/corrupt", str(caught.exception))

    def test_compute_content_manifest_is_byte_precise(self) -> None:
        # A line-ending change is real byte drift and must register as one.
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self._prepared(root, ("20260727010000_applied.sql",), body="select 1;\n")
            before = compute_content_manifest(root)
            (root / "supabase" / "migrations" / "20260727010000_applied.sql").write_text(
                "select 1;\r\n", encoding="utf-8"
            )
            after = compute_content_manifest(root)
            self.assertNotEqual(
                before["20260727010000"],
                after["20260727010000"],
            )

    def test_assert_content_manifest_unit_passes_and_fails(self) -> None:
        # The content check in isolation: a freshly pinned checkout passes, and
        # any post-pin drift fails closed -- the same contract `assert_bounded`
        # relies on, exercised at the unit boundary.
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self._prepared(
                root,
                ("20260727010000_applied.sql", "20260727020000_approved.sql"),
            )
            assert_content_manifest(root)  # pinned -> OK
            (root / "supabase" / "migrations" / "20260727020000_approved.sql").write_text(
                "select 9;\n", encoding="utf-8"
            )
            with self.assertRaises(GuardError):
                assert_content_manifest(root)


class PreflightNegativeTests(unittest.TestCase):
    """The guard must FIRE. Every test here points it at a bad input."""

    def test_real_14_file_batch_is_rejected_at_file_3_and_file_10(self) -> None:
        migrations = local_migrations(REPO)
        remote = production_ledger_versions()
        with self.assertRaises(GuardError) as caught:
            preflight_batch(migrations, BATCH_14, remote)
        message = str(caught.exception)
        # File 3 of 14: the foreign key in create table if not exists.
        self.assertIn("20260727221500", message)
        self.assertIn("plm.taxonomy_sync_alert", message)
        self.assertIn("foreign key", message)
        # File 6 of 14 / file 10 of 18: the trigger on a missing table.
        self.assertIn("20260728134500", message)
        self.assertIn("trigger target", message)
        self.assertIn("plm.taxonomy_parallel_observation", message)
        # And it names the excluded creator.
        self.assertIn("20260726180000", message)

    def test_lone_clickup_grant_migration_is_rejected(self) -> None:
        # AGENTS.md 10.2: 20260729120000 revokes/grants EXECUTE on
        # public.sync_clickup_tasks(jsonb, text), which is created by the pending
        # 20260728174500 / 20260728181500. Promoted alone it aborts with
        # undefined_function 42883.
        migrations = local_migrations(REPO)
        remote = production_ledger_versions()
        with self.assertRaises(GuardError) as caught:
            preflight_batch(migrations, ["20260729120000"], remote)
        message = str(caught.exception)
        self.assertIn("public.sync_clickup_tasks", message)
        self.assertIn("grant/revoke target", message)

    def test_real_18_file_batch_passes(self) -> None:
        migrations = local_migrations(REPO)
        remote = production_ledger_versions()
        preflight_batch(migrations, BATCH_18, remote)

    def test_prepare_refuses_a_batch_that_cannot_run_end_to_end(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repo = write_migrations(
                root / "repo",
                {
                    "20260101000000_base.sql": "create table plm.base (id uuid);",
                    "20260102000000_maker.sql": "create table plm.parent (id uuid primary key);",
                    "20260103000000_user.sql": (
                        "create table if not exists plm.child (\n"
                        "  id uuid primary key,\n"
                        "  parent_id uuid references plm.parent(id)\n"
                        ");"
                    ),
                },
            )
            ledger = root / "ledger.txt"
            ledger.write_text(
                "Local | Remote | Time\n20260101000000 | 20260101000000 | x\n",
                encoding="utf-8",
            )
            with patch("production_migration_guard.subprocess.run") as run:
                with self.assertRaises(GuardError):
                    prepare(repo, root / "out", "a" * 40, "20260103000000", ledger)
            # It must fail BEFORE any worktree is created.
            run.assert_not_called()

    def test_if_not_exists_does_not_save_a_missing_foreign_key_target(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            repo = write_migrations(
                Path(directory),
                {
                    "20260101000000_base.sql": "create table plm.base (id uuid);",
                    "20260102000000_maker.sql": "create table plm.parent (id uuid primary key);",
                    "20260103000000_user.sql": (
                        "create table if not exists plm.child ("
                        "id uuid, p uuid references plm.parent(id));"
                    ),
                },
            )
            with self.assertRaises(GuardError):
                preflight_batch(
                    local_migrations(repo), ["20260103000000"], {"20260101000000"}
                )

    def test_applied_dynamic_ddl_creation_contradicts_the_refusal(self) -> None:
        """#1645. An APPLIED file creates the object inside a dollar-quoted body.

        The plain-text creator (20260101000000) is NOT applied, so the
        creation-only model refused the batch. Production has held the object
        since the applied 20260102000000 executed it as dynamic DDL, so the
        positive evidence for that refusal is false and the check stays silent.
        """
        with tempfile.TemporaryDirectory() as directory:
            repo = write_migrations(
                Path(directory),
                {
                    "20260101000000_original.sql": (
                        "create table plm.alert (id uuid primary key);"
                    ),
                    "20260102000000_forward.sql": (
                        "select plm.run($ddl$create table if not exists "
                        "plm.alert (id uuid primary key)$ddl$);"
                    ),
                    "20260103000000_user.sql": (
                        "create trigger t after insert on plm.alert "
                        "for each row execute function plm.f();"
                    ),
                },
            )
            preflight_batch(
                local_migrations(repo), ["20260103000000"], {"20260102000000"}
            )

    def test_unapplied_dynamic_ddl_creation_does_not_rescue_a_batch(self) -> None:
        """The rescue reads the APPLIED prefix only -- never a pending file."""
        with tempfile.TemporaryDirectory() as directory:
            repo = write_migrations(
                Path(directory),
                {
                    "20260101000000_base.sql": "create table plm.base (id uuid);",
                    "20260102000000_forward.sql": (
                        "select plm.run($ddl$create table if not exists "
                        "plm.alert (id uuid primary key)$ddl$);"
                    ),
                    "20260103000000_maker.sql": "create table plm.alert (id uuid);",
                    "20260104000000_user.sql": (
                        "create trigger t after insert on plm.alert "
                        "for each row execute function plm.f();"
                    ),
                },
            )
            with self.assertRaises(GuardError):
                preflight_batch(
                    local_migrations(repo), ["20260104000000"], {"20260101000000"}
                )

    def test_drop_trigger_if_exists_does_not_save_a_missing_table(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            repo = write_migrations(
                Path(directory),
                {
                    "20260101000000_base.sql": "create table plm.base (id uuid);",
                    "20260102000000_maker.sql": "create table plm.alert (id uuid);",
                    "20260103000000_user.sql": (
                        "drop trigger if exists t on plm.alert;\n"
                        "create trigger t after insert on plm.alert "
                        "for each row execute function plm.f();"
                    ),
                },
            )
            with self.assertRaises(GuardError):
                preflight_batch(
                    local_migrations(repo), ["20260103000000"], {"20260101000000"}
                )

    def test_creator_later_in_the_batch_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            repo = write_migrations(
                Path(directory),
                {
                    "20260101000000_base.sql": "create table plm.base (id uuid);",
                    "20260102000000_user.sql": (
                        "alter table plm.late add column x int;"
                    ),
                    "20260103000000_maker.sql": "create table plm.late (id uuid);",
                },
            )
            with self.assertRaises(GuardError):
                preflight_batch(
                    local_migrations(repo),
                    ["20260102000000", "20260103000000"],
                    {"20260101000000"},
                )


class PreflightPositiveTests(unittest.TestCase):
    def test_creator_earlier_in_the_batch_is_accepted(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            repo = write_migrations(
                Path(directory),
                {
                    "20260101000000_base.sql": "create table plm.base (id uuid);",
                    "20260102000000_maker.sql": "create table plm.parent (id uuid primary key);",
                    "20260103000000_user.sql": (
                        "create table plm.child (id uuid, p uuid references plm.parent(id));"
                    ),
                },
            )
            preflight_batch(
                local_migrations(repo),
                ["20260102000000", "20260103000000"],
                {"20260101000000"},
            )

    def test_unknown_creator_is_silent_reject_never_approve(self) -> None:
        # No local migration creates public.ancient, so the check has no
        # positive evidence and must stay quiet rather than guess.
        with tempfile.TemporaryDirectory() as directory:
            repo = write_migrations(
                Path(directory),
                {
                    "20260101000000_base.sql": "create table plm.base (id uuid);",
                    "20260102000000_user.sql": "alter table public.ancient add column x int;",
                },
            )
            preflight_batch(
                local_migrations(repo), ["20260102000000"], {"20260101000000"}
            )

    def test_function_bodies_are_deferrable_and_ignored(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            repo = write_migrations(
                Path(directory),
                {
                    "20260101000000_base.sql": "create table plm.base (id uuid);",
                    "20260102000000_fn.sql": (
                        "create or replace function plm.f() returns void as $$\n"
                        "begin\n"
                        "  alter table plm.made_much_later add column x int;\n"
                        "end;\n"
                        "$$ language plpgsql;"
                    ),
                    "20260103000000_maker.sql": "create table plm.made_much_later (id uuid);",
                },
            )
            preflight_batch(
                local_migrations(repo), ["20260102000000"], {"20260101000000"}
            )

class StripSqlLexingTests(unittest.TestCase):
    """Regression tests for the `strip_sql` single-pass lexer.

    The three-regex predecessor stripped dollar-quoted bodies BEFORE comments, so
    a `$$` written inside a comment became the opening half of a pair and deleted
    every statement up to the next real `$$`. It made `production-dry-run` run
    31327934569 fail at "Build bounded checkout" on a correctly ordered batch.
    """

    def test_dollar_sign_inside_a_line_comment_does_not_eat_the_file(self) -> None:
        sql = (
            "-- guarded `do $$` block, mentioned only in prose\n"
            "create or replace function pim.sync_clickup_tasks() returns void as $fn$\n"
            "begin\n  return;\nend;\n$fn$ language plpgsql;\n"
        )
        self.assertEqual(created_objects(sql), {"pim.sync_clickup_tasks"})

    def test_dollar_sign_inside_a_block_comment_does_not_eat_the_file(self) -> None:
        sql = (
            "/* a $$ inside a block comment */\n"
            "create table plm.kept (id uuid);\n"
        )
        self.assertEqual(created_objects(sql), {"plm.kept"})

    def test_the_real_migration_that_broke_the_lane_is_parsed(self) -> None:
        path = (
            REPO
            / "supabase"
            / "migrations"
            / "20260728174500_clickup_incremental_task_import_reissue.sql"
        )
        created = created_objects(path.read_text(encoding="utf-8"))
        # This file creates the very function the old scanner claimed it needed
        # from a LATER migration.
        self.assertIn("pim.sync_clickup_tasks", created)
        self.assertIn("public.sync_clickup_tasks", created)
        self.assertIn("api.clickup_task_sync_run_list", created)

    def test_clickup_pair_in_version_order_is_accepted(self) -> None:
        """The exact false rejection that failed run 31327934569."""
        migrations = local_migrations(REPO)
        preflight_batch(
            migrations,
            ["20260728174500", "20260728181500"],
            set(migrations) - {"20260728174500", "20260728181500"},
        )

    def test_function_bodies_are_still_stripped(self) -> None:
        sql = (
            "create or replace function plm.f() returns void as $$\n"
            "begin\n  create table plm.not_really (id uuid);\nend;\n$$ language plpgsql;"
        )
        self.assertEqual(created_objects(sql), {"plm.f"})

    def test_string_literals_survive_for_the_regclass_probe(self) -> None:
        from production_migration_guard import hard_references

        sql = "alter table plm.t alter column id set default nextval('plm.t_id_seq'::regclass);"
        self.assertIn(("plm.t_id_seq", "regclass literal"), hard_references(sql))

    def test_apostrophe_in_a_comment_does_not_swallow_following_sql(self) -> None:
        sql = "-- the loser's row is kept\ncreate table plm.after_comment (id uuid);\n"
        self.assertEqual(created_objects(sql), {"plm.after_comment"})

    def test_unterminated_dollar_tag_does_not_eat_the_rest_of_the_file(self) -> None:
        sql = "select $1 $ from x;\ncreate table plm.still_seen (id uuid);\n"
        self.assertEqual(created_objects(sql), {"plm.still_seen"})

    def test_e_string_backslash_escape_does_not_mis_terminate(self) -> None:
        """`E'it\\'s'` does not end at the second quote. (Kimi K3.)"""
        sql = "select E'it\\'s -- not a comment';\ncreate table plm.after_estring (id uuid);\n"
        self.assertEqual(created_objects(sql), {"plm.after_estring"})

    def test_double_quoted_identifier_is_opaque(self) -> None:
        sql = 'create table plm."weird--name$$x" (id uuid);\ncreate table plm.after_ident (id uuid);\n'
        self.assertIn("plm.after_ident", created_objects(sql))


# ===========================================================================
# THE STRING-LITERAL LEXER DEFECT (issue #660, fixed 2026-08-10)
#
# Same CLASS as the `$$`-inside-a-comment bug: text that Postgres treats as
# opaque was being parsed as SQL. Here it was ordinary English prose inside a
# `comment on ... is '...'` literal.
#
# THE DIRECTION OF THESE TESTS MATTERS. A fix that merely makes the guard more
# permissive is WORSE than the bug -- the bug produced false REJECTS, which are
# safe; a permissive guard produces false ACCEPTS, which are not. So every test
# that proves a phantom is gone is paired with one proving a genuine reference
# is still caught.
# ===========================================================================
class StringLiteralLexerTests(unittest.TestCase):
    def test_prose_inside_a_comment_literal_is_not_a_reference(self) -> None:
        """The Disney/Paramount shape, verbatim from 20260807170000."""
        sql = (
            "comment on table core.character is\n"
            "  'character can appear in multiple properties. Distinct from "
            "core.style_guide_character, which is AXIS 2.';\n"
        )
        self.assertNotIn(
            ("core.style_guide_character", "query target"), hard_references(sql)
        )

    def test_the_live_migration_no_longer_yields_a_phantom(self) -> None:
        path = local_migrations(REPO)["20260807170000"]
        raw = path.read_text(encoding="utf-8")
        self.assertNotIn(
            ("core.style_guide_character", "query target"), hard_references(raw)
        )

    def test_no_migration_in_the_repo_yields_a_phantom_from_a_literal(self) -> None:
        """The whole-repo sweep. Before the fix this found 30 across 23 files."""
        import re as _re

        literal = _re.compile(r"'(?:[^']|'')*'")
        phantoms: list[str] = []
        for version, path in local_migrations(REPO).items():
            text = strip_sql(path.read_text(encoding="utf-8"))
            for match in literal.finditer(text):
                # After the fix every surviving literal is either blanked ('') or
                # immediately cast to regclass, so none can carry a phantom name.
                body = match.group(0)
                if body == "''":
                    continue
                after = text[match.end() : match.end() + 20]
                if "::" in after and "regclass" in after:
                    continue
                phantoms.append(version + ": " + body[:60])
        self.assertEqual(phantoms, [])

    # ---------------- the positive controls ----------------
    def test_a_genuine_from_clause_is_still_caught(self) -> None:
        sql = "create view a.b as select * from core.style_guide_character;"
        self.assertIn(
            ("core.style_guide_character", "query target"), hard_references(sql)
        )

    def test_a_regclass_literal_is_still_caught(self) -> None:
        sql = "alter table a.b alter column id set default nextval('plm.s'::regclass);"
        self.assertIn(("plm.s", "regclass literal"), hard_references(sql))

    def test_a_blanked_literal_does_not_glue_neighbouring_tokens(self) -> None:
        sql = "comment on table a.b is 'x'; select * from core.real_one;"
        self.assertIn(("core.real_one", "query target"), hard_references(sql))

    def test_a_deliberately_incomplete_allowlist_is_still_rejected(self) -> None:
        """THE test that guards against a permissive fix.

        20260810070000 has a REAL foreign key onto core.style_guide, created by
        the unapplied 20260727230000. If the lexer fix ever makes this pass, the
        fix has gone too far and the guard has become permissive -- which is
        worse than the bug it replaced.
        """
        remote = production_ledger_versions()
        migrations = local_migrations(REPO)
        with self.assertRaises(GuardError) as caught:
            preflight_batch(migrations, ["20260810070000", "20260810080000"], remote)
        self.assertIn("core.style_guide", str(caught.exception))

    def test_the_47_list_still_passes_preflight(self) -> None:
        remote = production_ledger_versions()
        migrations = local_migrations(REPO)
        allowlist = recorded_apply_set()
        self.assertEqual(len(allowlist), 47)
        self.assertFalse(set(allowlist) & HARD_BLOCKED)
        self.assertFalse(set(allowlist) & FR_HELD_20260803)
        self.assertFalse(set(allowlist) & remote)
        preflight_batch(migrations, allowlist, remote)

    def test_the_illegal_49_list_is_still_rejected_by_the_6_5_rule(self) -> None:
        remote = production_ledger_versions()
        migrations = local_migrations(REPO)
        # The 47 APPLY rows PLUS the two 6.5-held versions -- the exact
        # string the apply-set document flags as policy-illegal.
        illegal = sorted(set(recorded_apply_set()) | FR_HELD_20260803)
        self.assertEqual(len(illegal), 49)
        with self.assertRaises(GuardError) as caught:
            parse_allowlist(",".join(illegal))
        self.assertIn("6.5", str(caught.exception))


class ArchaicFunctionBodyTests(unittest.TestCase):
    """The residual blind spot, turned into a loud refusal rather than silence."""

    def test_an_archaic_body_is_refused(self) -> None:
        sql = "create function a.b() returns int language sql as 'select 1';"
        with self.assertRaises(GuardError):
            assert_no_archaic_function_body("29990101000000", sql)

    def test_an_archaic_body_inside_a_do_block_is_refused(self) -> None:
        """The ONLY real instance in this repo is inside a `do $$ ... $$` block.

        A check that stripped dollar bodies would have found nothing and
        reported a clean sweep, which is exactly the silence this exists to end.
        """
        sql = (
            "do $$ begin\n"
            "  create function a.b() returns int language sql "
            "security definer as 'select 1';\n"
            "end $$;"
        )
        with self.assertRaises(GuardError):
            assert_no_archaic_function_body("29990101000000", sql)

    def test_a_dollar_quoted_body_is_fine(self) -> None:
        sql = "create function a.b() returns int language sql as $$ select 1 $$;"
        assert_no_archaic_function_body("29990101000000", sql)

    def test_an_unrelated_literal_is_not_a_routine_body(self) -> None:
        sql = "comment on table a.b is 'x'; create table c.d (id int);"
        assert_no_archaic_function_body("29990101000000", sql)

    def test_exactly_one_migration_in_the_repo_uses_the_archaic_form(self) -> None:
        """A sweep, so a NEW archaic body cannot slip in unnoticed.

        20260729120000 is RETIRED and permanently HARD_BLOCKED, so no promotable
        file is affected today. If this ever fails naming a second version, that
        version must be rewritten with dollar quoting before it can be promoted.
        """
        offenders = []
        for version, path in local_migrations(REPO).items():
            try:
                assert_no_archaic_function_body(
                    version, path.read_text(encoding="utf-8")
                )
            except GuardError:
                offenders.append(version)
        self.assertEqual(offenders, ["20260729120000"])
        self.assertIn("20260729120000", HARD_BLOCKED)


# ===========================================================================
# CO-PRESENCE, AND THE ONE-DIRECTIONALITY THAT MAKES RECOVERY POSSIBLE
#
# Read the comment on CO_PRESENCE_RULES before touching these. The recovery
# tests below are not decoration: `validate_candidates` refuses an allowlist
# containing an already-applied version, so after a run dies between a create
# and its fix, the fix ALONE is the only allowlist that can legally exist. A
# symmetric rule would refuse it and force an operator to edit this guard under
# pressure while production sits in the insecure state.
# ===========================================================================
class CoPresenceTests(unittest.TestCase):
    CREATE_WITHOUT_FIX = [
        ("20260810020000", "20260810090000"),
        ("20260810020000", "20260810180000"),
        ("20260810070000", "20260810080000"),
        ("20260810070000", "20260810180000"),
        ("20260810030000", "20260810110000"),
        ("20260810190000", "20260810190100"),
    ]

    def test_a_create_without_its_fix_is_refused(self) -> None:
        for create, fix in self.CREATE_WITHOUT_FIX:
            with self.subTest(create=create), self.assertRaises(GuardError) as caught:
                parse_allowlist(create)
            self.assertIn(fix, str(caught.exception))

    def test_warner_needs_both_fixes_not_one(self) -> None:
        with self.assertRaises(GuardError) as caught:
            parse_allowlist("20260810030000,20260810110000")
        self.assertIn("20260810120000", str(caught.exception))

    def test_the_complete_sets_are_accepted(self) -> None:
        for value in (
            "20260810020000,20260810090000,20260810180000",
            "20260810070000,20260810080000,20260810180000",
            "20260810030000,20260810110000,20260810120000",
            "20260810190000,20260810190100",
        ):
            with self.subTest(value=value):
                self.assertEqual(parse_allowlist(value), value.split(","))

    # ---------------- issue #665: the Disney DCP Vault landing pair ----------------
    def test_dcp_landing_without_its_loader_is_refused(self) -> None:
        """20260810190000 alone is a half-build, not a shippable state.

        The nine plm.dcp_* tables have no loader and no finalizer without
        20260810190100: nothing can put a row in them, no crawl can ever reach
        status 'complete', and the immutability triggers can therefore never
        arm. The two were authored as one bounded change.
        """
        with self.assertRaises(GuardError) as caught:
            parse_allowlist("20260810190000")
        self.assertIn("20260810190100", str(caught.exception))

    def test_recovery_dcp_loader_alone_is_ALLOWED(self) -> None:
        """THE reason the DCP rule is stated create-requires-loader and not the reverse.

        The obvious reading of the dependency is "20260810190100 needs
        20260810190000". Encoded that way it would refuse THIS allowlist -- and
        this allowlist is the ONLY legal recovery from a batch that died after
        20260810190000 applied, because validate_candidates refuses any
        allowlist naming an already-applied version. The operator's only way out
        would then be to edit this guard while production sat half-built. If
        someone "fixes the direction for consistency", this test is what tells
        them what they broke.
        """
        self.assertEqual(parse_allowlist("20260810190100"), ["20260810190100"])

    def test_the_real_dcp_dependency_is_left_to_the_preflight(self) -> None:
        """The loader's need for its tables is ledger-aware, so preflight owns it.

        20260810190100 creates functions over plm.dcp_crawl and friends and a
        table with a foreign key onto plm.dcp_crawl. Promoting it against a
        production that lacks them aborts the batch. That is a DEPENDENCY, not a
        policy: preflight_batch reads the real ledger and stays silent once
        20260810190000 is applied, which is exactly what the recovery case
        above requires.
        """
        remote = production_ledger_versions()
        migrations = local_migrations(REPO)
        with self.assertRaises(GuardError) as caught:
            preflight_batch(migrations, ["20260810190100"], remote)
        self.assertIn("20260810190000", str(caught.exception))

        # The ordered pair still needs core.style_guide, which 20260810190000
        # takes a REAL foreign key onto for its reconciliation pointer. That
        # table is created by the not-yet-applied 20260727230000, exactly as it
        # is for NBCU's 20260810070000 (see
        # test_a_deliberately_incomplete_allowlist_is_still_rejected). The pair
        # alone must therefore still be REFUSED -- if this ever starts passing,
        # the preflight has become permissive.
        with self.assertRaises(GuardError) as caught:
            preflight_batch(migrations, ["20260810190000", "20260810190100"], remote)
        self.assertIn("core.style_guide", str(caught.exception))

        # With the creator of core.style_guide in the batch, it runs end to end.
        preflight_batch(
            migrations,
            ["20260727230000", "20260810190000", "20260810190100"],
            remote,
        )

    # ---------------- issues #664 / #649: the MAINTAIN completion ----------------
    def test_paramount_with_its_own_fix_but_without_180000_is_refused(self) -> None:
        """The exact B9 mistake: the old complete set is no longer complete.

        Before this rule, `020000,090000` parsed. It must not any more:
        20260810090000 predates PostgreSQL 17 and leaves REFERENCES and MAINTAIN
        on all 23 tables, and nothing else closes the plm schema default.
        """
        with self.assertRaises(GuardError) as caught:
            parse_allowlist("20260810020000,20260810090000")
        self.assertIn("20260810180000", str(caught.exception))

    def test_nbcu_with_its_own_fix_but_without_180000_is_refused(self) -> None:
        with self.assertRaises(GuardError) as caught:
            parse_allowlist("20260810070000,20260810080000")
        self.assertIn("20260810180000", str(caught.exception))

    def test_the_literal_b9_allowlist_without_180000_is_refused(self) -> None:
        """The concrete regression this rule exists for.

        B9 dispatched as 020000,070000,080000,090000 passed every gate, created
        the 39 tables as `service_role=arwdDxtm`, and left the schema default
        open. Both co-presence rules must fire on it.
        """
        with self.assertRaises(GuardError) as caught:
            parse_allowlist(
                "20260810020000,20260810070000,20260810080000,20260810090000"
            )
        self.assertIn("20260810180000", str(caught.exception))

    def test_the_full_b9_allowlist_with_180000_is_accepted(self) -> None:
        value = (
            "20260810020000,20260810070000,20260810080000,"
            "20260810090000,20260810180000"
        )
        self.assertEqual(parse_allowlist(value), value.split(","))

    def test_recovery_180000_alone_is_ALLOWED(self) -> None:
        """One-directionality, for the fix that spans two rules.

        20260810180000 is a FIX in two rules and a CREATE in none, so it must
        stay legal on its own. The migration is written to tolerate the tables
        not existing (all-or-nothing per family, from a catalog read), so this
        allowlist is genuinely runnable and not merely parseable.
        """
        self.assertEqual(parse_allowlist("20260810180000"), ["20260810180000"])

    def test_warner_is_deliberately_not_coupled_to_180000(self) -> None:
        """20260810110000 already revokes the full PG17 set on the wb_* tables.

        Coupling them would enlarge every Warner recovery allowlist for no
        security gain. If someone adds that coupling, this test tells them why
        it was left out rather than letting them assume it was an oversight.
        """
        for create, fixes, _ in CO_PRESENCE_RULES:
            if create == "20260810030000":
                self.assertNotIn("20260810180000", fixes)
                break
        else:
            self.fail("the Warner co-presence rule disappeared")
        value = "20260810030000,20260810110000,20260810120000"
        self.assertEqual(parse_allowlist(value), value.split(","))

    # ---------------- the recovery cases ----------------
    def test_recovery_paramount_fix_alone_is_ALLOWED(self) -> None:
        self.assertEqual(parse_allowlist("20260810090000"), ["20260810090000"])

    def test_recovery_nbcu_fix_alone_is_ALLOWED(self) -> None:
        self.assertEqual(parse_allowlist("20260810080000"), ["20260810080000"])

    def test_recovery_warner_fixes_without_the_create_are_ALLOWED(self) -> None:
        self.assertEqual(
            parse_allowlist("20260810110000,20260810120000"),
            ["20260810110000", "20260810120000"],
        )

    def test_no_rule_is_symmetric(self) -> None:
        """Structural, so a later edit cannot quietly add the reverse implication."""
        creates = {create for create, _, _ in CO_PRESENCE_RULES}
        for _, fixes, _ in CO_PRESENCE_RULES:
            for fix in fixes:
                with self.subTest(fix=fix):
                    self.assertNotIn(
                        fix,
                        creates,
                        fix + " is a FIX in one rule and a CREATE in another. "
                        "That makes recovery impossible -- see CO_PRESENCE_RULES.",
                    )
                    parse_allowlist(fix)

    def test_the_ledger_aware_dependency_is_left_to_the_preflight(self) -> None:
        """20260810110000 needs api.dam_order_list from 20260810010000.

        That is a DEPENDENCY, not a policy, so it must NOT be a co-presence rule
        (which is ledger-blind and would break the recovery case). It is caught
        by preflight_batch instead, which reads the real production ledger and
        therefore stays silent once 20260810010000 is applied.
        """
        for _, fixes, _ in CO_PRESENCE_RULES:
            self.assertNotIn("20260810010000", fixes)
        remote = production_ledger_versions()
        migrations = local_migrations(REPO)
        with self.assertRaises(GuardError):
            preflight_batch(migrations, ["20260810110000", "20260810120000"], remote)
        preflight_batch(
            migrations,
            [
                "20260810010000",
                "20260810030000",
                "20260810110000",
                "20260810120000",
            ],
            remote,
        )



B9_FOURTEEN = [
    "20260810010000",
    "20260810020000",
    "20260810030000",
    "20260810050000",
    "20260810060000",
    "20260810070000",
    "20260810080000",
    "20260810090000",
    "20260810100000",
    "20260810110000",
    "20260810120000",
    "20260810130000",
    "20260810160000",
    "20260810170000",
]
# Read from the LIVE production ledger on 2026-08-11 (project qsllyeztdwjgirsysgai,
# read-only `list_migrations`): 20260810180000 IS applied, and none of B9's
# fourteen are. It was promoted early and ALONE, and it sorts ABOVE B9's own end
# version 20260810170000, which is how the deadlock below came to exist.
B9_APPLIED_FIX = "20260810180000"


class CoPresenceIsLedgerAwareTest(unittest.TestCase):
    """The B9 deadlock (2026-08-11) and the property that must survive its fix.

    CO_PRESENCE_RULES require 20260810180000 alongside both 20260810020000
    (Paramount) and 20260810070000 (NBCU). 20260810180000 is already applied on
    production. `validate_candidates` refuses any allowlist naming an applied
    version. Ledger-blind, that made B9 -- the licensor landing batch --
    impossible to apply by ANY allowlist string:

      B9's 14                  -> "may not be promoted without 20260810180000"
      B9's 14 + 20260810180000 -> "already applied on production"

    The fix is the one `assert_atomic_batches` already uses: subtract the real
    production ledger from the required-fix set. The tests below pin the cases
    that must stay distinct. If you make this ledger-blind again and they still
    pass, you have broken the tests, not proved the change.
    """

    def test_b9_deadlocks_when_the_check_is_ledger_blind(self) -> None:
        """The regression test proper: with NO ledger, B9 is still refused.

        Ledger-blind is the fail-closed default and stays correct on its own
        terms; this test keeps the deadlock reproducible so nobody has to
        rediscover it.
        """
        with self.assertRaises(GuardError) as caught:
            parse_allowlist(",".join(B9_FOURTEEN))
        self.assertIn(B9_APPLIED_FIX, str(caught.exception))

    def test_b9_is_ACCEPTED_once_the_applied_fix_is_in_the_ledger(self) -> None:
        """An ALREADY-APPLIED required fix satisfies the rule."""
        self.assertEqual(
            parse_allowlist(",".join(B9_FOURTEEN), {B9_APPLIED_FIX}),
            B9_FOURTEEN,
        )

    def test_naming_the_applied_fix_as_well_is_still_refused_downstream(self) -> None:
        """The other half of the deadlock, so the whole shape stays proven.

        Adding 20260810180000 gets past co-presence but `validate_candidates`
        refuses it for being applied. Both halves must be true for the deadlock
        to be real; if either stops being true, this class needs re-reading.
        """
        remote = {B9_APPLIED_FIX}
        allowlist = parse_allowlist(",".join(B9_FOURTEEN + [B9_APPLIED_FIX]), remote)
        with self.assertRaises(GuardError) as caught:
            validate_candidates(local_migrations(REPO), allowlist, remote)
        self.assertIn("already applied on production", str(caught.exception))

    def test_a_MISSING_fix_is_still_REFUSED_even_with_a_ledger(self) -> None:
        """The property the rule exists to protect. APPLIED is not MISSING.

        A ledger that does NOT contain the fix must not satisfy the rule --
        neither an unrelated ledger nor an EMPTY one. This is the case someone
        removes by accident when they "simplify" the subtraction into an
        unconditional pass.
        """
        for ledger in (frozenset(), {"20260810140000"}):
            for create, fix in (
                ("20260810020000", "20260810090000"),
                ("20260810070000", "20260810080000"),
                ("20260810030000", "20260810110000"),
                ("20260810190000", "20260810190100"),
            ):
                with self.subTest(create=create, ledger=sorted(ledger)):
                    with self.assertRaises(GuardError) as caught:
                        parse_allowlist(create, ledger)
                    self.assertIn(fix, str(caught.exception))

    def test_the_create_without_its_UNAPPLIED_fix_is_refused_paramount(self) -> None:
        """20260810180000 applied does NOT excuse a missing 20260810090000."""
        with self.assertRaises(GuardError) as caught:
            parse_allowlist("20260810020000", {B9_APPLIED_FIX})
        message = str(caught.exception)
        self.assertIn("20260810090000", message)
        self.assertIn(
            "may not be promoted without 20260810090000.",
            message,
            "the applied fix must drop OUT of the missing list, not stay in it",
        )

    def test_the_rule_stays_ONE_DIRECTIONAL_with_a_ledger(self) -> None:
        """A fix ALONE stays legal -- the only recovery path -- ledger or not."""
        for fix in ("20260810090000", "20260810080000", "20260810190100"):
            for ledger in (frozenset(), {B9_APPLIED_FIX}, {"20260810140000"}):
                with self.subTest(fix=fix, ledger=sorted(ledger)):
                    self.assertEqual(parse_allowlist(fix, ledger), [fix])

    def test_an_applied_CREATE_STILL_COMPELS_every_outstanding_fix(self) -> None:
        """ISSUE #672 ITEM 1 -- A DELIBERATE BEHAVIOUR CHANGE. THIS USED TO PASS.

        Before this change the rule was gated on `create in chosen` alone, so an
        applied create silenced it completely and this exact allowlist was
        ACCEPTED -- leaving `20260810180000` unapplied while production already
        held the 23 Paramount tables. The rule's claim is "production must never
        hold the create without the fixes"; a half-finished repair violates it
        just as hard as a half-finished first promotion.

        If you are here because this test failed after an edit: you have
        reinstated the hole, not simplified the guard.
        """
        with self.assertRaises(GuardError) as caught:
            parse_allowlist("20260810090000", {"20260810020000"})
        message = str(caught.exception)
        self.assertIn("20260810020000 is ALREADY APPLIED", message)
        self.assertIn("20260810180000", message)
        # It must tell the operator NOT to re-list the applied create, because
        # `validate_candidates` refuses that outright -- otherwise the obvious
        # next move produces a second, more confusing refusal.
        self.assertIn("Do NOT add 20260810020000 back", message)

    def test_the_warner_half_repair_from_issue_672_is_REFUSED(self) -> None:
        """The concrete case issue #672 item 1 names.

        Warner's create `20260810030000` is applied; the operator lists only
        `20260810110000`. That leaves `20260810120000` unapplied, so production
        keeps the wrong read claim and `service_role` keeps INSERT. Refused.
        """
        with self.assertRaises(GuardError) as caught:
            parse_allowlist("20260810110000", {"20260810030000"})
        message = str(caught.exception)
        self.assertIn("20260810030000 is ALREADY APPLIED", message)
        self.assertIn("20260810120000", message)

    def test_the_COMPLETE_warner_repair_is_ACCEPTED(self) -> None:
        """Finishing the repair is always legal -- that is what keeps the
        one-directional recovery design intact. Only stopping short is refused."""
        self.assertEqual(
            parse_allowlist("20260810110000,20260810120000", {"20260810030000"}),
            ["20260810110000", "20260810120000"],
        )

    def test_an_applied_CREATE_whose_fixes_are_all_applied_is_SILENT(self) -> None:
        """A fully repaired production must not block unrelated promotions."""
        applied = {"20260810030000", "20260810110000", "20260810120000"}
        self.assertEqual(parse_allowlist("20260810140000", applied), ["20260810140000"])

    def test_the_rule_never_demands_the_APPLIED_CREATE_itself(self) -> None:
        """One-directional still holds: the rule demands fixes, never the create.

        Proven by construction -- for every rule, the allowlist of ALL its
        outstanding fixes is accepted with the create applied and nothing else
        in the ledger, so no refusal can be escaped only by naming the create.
        """
        for create, fixes, _why in CO_PRESENCE_RULES:
            with self.subTest(create=create):
                allowlist = ",".join(sorted(fixes))
                self.assertEqual(
                    parse_allowlist(allowlist, {create}), sorted(fixes)
                )

    def test_the_error_message_names_what_the_ledger_already_covers(self) -> None:
        """An operator reading the refusal must see which fix was excused."""
        with self.assertRaises(GuardError) as caught:
            parse_allowlist("20260810020000", {B9_APPLIED_FIX})
        self.assertIn("Already applied on production", str(caught.exception))
        self.assertIn(B9_APPLIED_FIX, str(caught.exception))

    def test_verify_dry_run_accepts_b9_when_given_the_ledger(self) -> None:
        """The lane's last gate must not re-introduce the deadlock.

        `verify-dry-run` used to be ledger-blind with no way to pass a ledger,
        so B9 would have been refused there even after `prepare` and
        `preflight` accepted it. The optional --remote-ledger closes that.
        """
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            dry = root / "dry-run.txt"
            dry.write_text(
                "Would push these migrations:\n"
                + "\n".join(f" • {v}_x.sql" for v in B9_FOURTEEN)
                + "\n",
                encoding="utf-8",
            )
            ledger = root / "ledger.txt"
            ledger.write_text(
                json.dumps([{"version": B9_APPLIED_FIX}]), encoding="utf-8"
            )
            # Without the ledger it deadlocks exactly as the lane did.
            with self.assertRaises(GuardError) as caught:
                verify_dry_run(dry, ",".join(B9_FOURTEEN))
            self.assertIn(B9_APPLIED_FIX, str(caught.exception))
            # With it, the step passes.
            verify_dry_run(dry, ",".join(B9_FOURTEEN), ledger)


# ===========================================================================
# THE APPLY LANE (issue #617) and the dry-run environment move (issue #646)
# ===========================================================================
WORKFLOW_TEXT = (
    REPO / ".github" / "workflows" / "shared-supabase-migrations.yml"
).read_text(encoding="utf-8")


def _job(name: str) -> str:
    """Return one job's body. Jobs start at a fixed two-space indent."""
    body = WORKFLOW_TEXT.split("\n  " + name + ":\n", 1)[1]
    lines: list[str] = []
    for line in body.splitlines():
        stripped = line.rstrip()
        if (
            stripped
            and stripped.startswith("  ")
            and not stripped.startswith("   ")
            and stripped.endswith(":")
        ):
            break
        lines.append(line)
    return "\n".join(lines)


class ApplyLaneTests(unittest.TestCase):
    def test_issue_646_dry_run_is_off_the_production_environment(self) -> None:
        job = _job("production-dry-run")
        self.assertNotIn("environment: production", job)
        self.assertIn("inputs.mode == 'dry-run'", job)

    def test_the_apply_job_is_ON_the_production_environment(self) -> None:
        self.assertIn("environment: production", _job("production-apply"))

    def test_the_apply_job_needs_the_review_job(self) -> None:
        self.assertIn(
            "needs: [validate, production-apply-review]", _job("production-apply")
        )

    def test_the_typed_confirmation_is_APPLY_plus_sha(self) -> None:
        for name in ("production-apply-review", "production-apply"):
            with self.subTest(job=name):
                self.assertIn('= "APPLY $REQUESTED_SHA"', _job(name))

    def test_the_confirmation_check_is_the_first_step_of_the_review_job(self) -> None:
        """A wrong string must fail before any credential is used."""
        steps = _steps(_job("production-apply-review"))
        self.assertIn("Check exact confirmation", steps[0])

    def test_immutable_review_evidence_cannot_be_shrugged_off(
        self,
    ) -> None:
        """The pointer-only gate is replaced by pinned, verified evidence."""
        job = _job("production-apply-review")
        # A real step-level key, not the word inside the explanatory comment.
        offenders = [
            line
            for line in job.splitlines()
            if re.match(r"^\s*continue-on-error\s*:", line)
        ]
        self.assertEqual(offenders, [], f"continue-on-error is back: {offenders}")
        self.assertIn("production_apply_review_evidence.py", job)
        self.assertIn("--review-run-id", job)
        self.assertIn("--expected-artifact-digest", job)
        self.assertNotIn("production_apply_model_review.py", job)
        self.assertNotIn("ANTHROPIC_API_KEY", job)
        script = (REPO / "scripts" / "production_apply_review_evidence.py").read_text(
            encoding="utf-8"
        )
        self.assertIn("return 1", script)

    def test_the_recorded_review_is_not_the_only_gate(self) -> None:
        """Belt and braces: the environment and deterministic gates remain."""
        self.assertIn("environment: production", _job("production-apply"))
        self.assertIn(
            "production_migration_guard.py preflight", _job("production-apply-review")
        )

    def test_a_fresh_dry_run_immediately_precedes_the_real_push(self) -> None:
        step = [s for s in _steps(_job("production-apply")) if "Fresh dry-run" in s][0]
        commands = _run_block_commands(step)
        bounded = [i for i, c in enumerate(commands) if "assert-bounded" in c][-1]
        dry = [
            i
            for i, c in enumerate(commands)
            if "db push" in c and "--dry-run" in c
        ][-1]
        verify = [i for i, c in enumerate(commands) if "verify-dry-run" in c][-1]
        push = [
            i for i, c in enumerate(commands) if "db push" in c and "--dry-run" not in c
        ][-1]
        self.assertLess(bounded, dry)
        self.assertLess(dry, verify)
        self.assertLess(verify, push)
        self.assertEqual(commands[push + 1 :], ["fi"], "only the branch terminator may follow the push")

    def test_atomic_apply_is_exact_policy_gated_and_replaces_not_supplements_cli(self) -> None:
        step = [s for s in _steps(_job("production-apply")) if "Fresh dry-run" in s][0]
        commands = _run_block_commands(step)
        joined = "\n".join(commands)
        self.assertIn("--classify-allowlist", joined)
        self.assertIn('if [ -n "$ATOMIC_VERSION" ]', joined)
        self.assertNotIn("jq -e", joined)
        self.assertIn("--mode check", joined)
        self.assertIn("--mode apply", joined)
        self.assertIn("--target production", joined)
        self.assertIn("else", commands)

    def test_all_four_apply_call_sites_use_the_fail_closed_classifier(self) -> None:
        self.assertEqual(WORKFLOW_TEXT.count("--classify-allowlist"), 4)
        self.assertEqual(WORKFLOW_TEXT.count('if [ -n "$ATOMIC_VERSION" ]'), 4)
        self.assertNotIn("jq -e", WORKFLOW_TEXT)

    def test_every_apply_job_proves_a_working_psql_before_touching_a_database(self) -> None:
        """No apply job may reach a database without a PROVED PostgreSQL client.

        This test used to pin the literal `apt-get install -y postgresql-client`
        -- the MECHANISM -- and so it broke the moment #1261 replaced that
        mechanism with one that skips apt when the runner image already carries
        the client. What the assertion was actually protecting is the GUARANTEE
        underneath it: every apply lane proves a working client, by executing it,
        before it links to preview or production, and the job dies if it cannot.

        So this asserts the guarantee and says nothing about how the client is
        obtained. Swap apt for a container image, a cache, or a tarball and this
        still passes. Delete the `psql --version` proof gate, let any success
        path out of the step skip it, drop the exit-1, lose the named
        infrastructure annotation, or move the step after the database link, and
        it still FAILS.
        """
        for job_name in (
            "preview",
            "production-dry-run",
            "production-apply-review",
            "production-apply",
        ):
            with self.subTest(job=job_name):
                steps = _steps(_job(job_name))
                # The gate is the FIRST step that executes the client. Later
                # steps run psql too; what matters is that the job cannot get
                # past this one without a client that actually works.
                client_steps = [
                    (k, s) for k, s in enumerate(steps) if "psql --version" in s
                ]
                self.assertTrue(
                    client_steps, "no step in this job ever executes the client"
                )
                index, step = client_steps[0]

                # (1) The gate is unconditional and cannot be waved through.
                self.assertNotIn("continue-on-error", step)
                self.assertNotIn("if:", step)

                # (2) EVERY success path out of the step is preceded by an actual
                #     execution of the client since the previous success -- a
                #     present binary is never accepted as a working one.
                commands = _run_block_commands(step)
                proofs = [k for k, c in enumerate(commands) if "psql --version" in c]
                successes = [k for k, c in enumerate(commands) if c == "exit 0"]
                self.assertTrue(successes, "the step must have a success path")
                self.assertGreaterEqual(
                    len(proofs),
                    2,
                    "the skip path and the install path must each prove the client",
                )
                previous = -1
                for success in successes:
                    self.assertTrue(
                        [p for p in proofs if previous < p < success],
                        f"success at command {success} is not gated on proving the client",
                    )
                    previous = success

                # (3) Exhausting every route to a client FAILS the job, loudly and
                #     by name, so an infrastructure stall is never read as a
                #     verdict on the change under review (issue #1261).
                self.assertEqual(
                    commands[-1], "exit 1", "the step must end by failing the job"
                )
                annotation = commands[-2]
                self.assertIn("::error::CI INFRASTRUCTURE:", annotation)
                self.assertIn("PostgreSQL client unavailable", annotation)
                self.assertIn("NO MIGRATION WAS APPLIED", annotation)

                # (4) The proof happens BEFORE any database is linked.
                links = [k for k, s in enumerate(steps) if "supabase link" in s]
                self.assertTrue(links, "expected a database link step in this job")
                self.assertLess(index, min(links))

    def test_retired_orderlist_migration_is_hard_blocked(self) -> None:
        self.assertIn("20260816045130", HARD_BLOCKED)
        with self.assertRaisesRegex(GuardError, "general production lane blocks"):
            parse_allowlist("20260816045130")

    def test_every_verify_dry_run_call_passes_a_remote_ledger(self) -> None:
        """The lane must never re-create the B9 deadlock at its last gate.

        `verify-dry-run`'s co-presence check is ledger-aware; without a ledger
        it reverts to the ledger-blind behaviour that made B9 unshippable, and
        it would do so at the step immediately before the write, after every
        other gate had already passed. `--remote-ledger` is `required=True` on
        the CLI, so a dropped flag is an argparse error rather than a mystery
        refusal -- and this test says so at the call sites too.
        """
        calls = [
            WORKFLOW_TEXT[match.end() : match.end() + 400]
            for match in re.finditer(r"verify-dry-run", WORKFLOW_TEXT)
        ]
        self.assertEqual(len(calls), 4, "expected four verify-dry-run call sites")
        for index, call in enumerate(calls):
            with self.subTest(call=index):
                head = call.split("- name:")[0]
                self.assertIn("--remote-ledger", head)
                self.assertIn("ledger-before.txt", head)

    def test_the_apply_job_uploads_before_dryrun_and_after_evidence(self) -> None:
        job = _job("production-apply")
        for artifact in (
            "production-ledger-before.txt",
            "production-dry-run.txt",
            "production-apply.txt",
            "production-ledger-after.txt",
        ):
            with self.subTest(artifact=artifact):
                self.assertIn(artifact, job)

    def test_the_content_manifest_is_in_every_pushing_jobs_evidence(self) -> None:
        """`prepare` pins byte content; the evidence of a push must carry the pin.

        The manifest lives inside the bounded checkout, so each job that runs
        `prepare` -> `assert-bounded` -> push must upload
        `<bounded>/supabase/migration-content-manifest.json` alongside its other
        evidence. Without it, a post-hoc reviewer cannot tell whether the bytes
        that were pushed were the bytes that were pinned. The dry-run, preview
        and apply jobs all qualify.
        """
        manifest = "supabase/migration-content-manifest.json"
        for name in ("preview", "production-dry-run", "production-apply"):
            with self.subTest(job=name):
                self.assertIn(manifest, _job(name))

    def test_include_all_never_runs_in_the_github_workspace(self) -> None:
        """The bound is the filesystem, not the flag (AGENTS.md 5.1).

        `preview` joined this list in #739, when it stopped running a bare
        `db push` in $GITHUB_WORKSPACE and started building the same pruned
        checkout the production jobs use. This test is now the one that carries
        the real invariant for every job allowed to use the flag, which is why
        the blanket job-name ban in
        `test_include_all_is_bounded_and_dry_run_only` could be widened.
        """
        for name, bounded_dir in (
            ("production-dry-run", "bounded-production"),
            ("production-apply", "bounded-production"),
            ("preview", "bounded-preview"),
        ):
            for step in _steps(_job(name)):
                if "--include-all" not in step:
                    continue
                commands = _run_block_commands(step)
                self.assertIn(
                    f'cd "$RUNNER_TEMP/{bounded_dir}"',
                    commands,
                    name + ": --include-all must run only in the bounded checkout",
                )

    # ---------------- negative paths the lane must refuse ----------------
    def test_a_held_version_is_refused_before_the_lane_can_run(self) -> None:
        with self.assertRaises(GuardError):
            parse_allowlist("20260802170000")

    def test_a_one_sided_co_presence_allowlist_is_refused(self) -> None:
        with self.assertRaises(GuardError):
            parse_allowlist("20260810020000")

    def test_a_wrong_confirmation_string_cannot_match(self) -> None:
        """The shell test is `= "APPLY $REQUESTED_SHA"` -- exact, not a prefix."""
        job = _job("production-apply")
        self.assertNotIn("APPLY*", job)
        self.assertNotIn("grep", job)


class CanaryTests(unittest.TestCase):
    """Customer #1 for the apply lane -- deliberately NOT a licensor feature."""

    VERSION = "20260810140000"

    def test_the_canary_exists_and_is_additive_only(self) -> None:
        raw = local_migrations(REPO)[self.VERSION].read_text(encoding="utf-8")
        lowered = strip_sql(raw)
        for forbidden in ("drop table", "drop schema", "drop column", "truncate"):
            with self.subTest(forbidden=forbidden):
                self.assertNotIn(forbidden, lowered)
        self.assertIn("create table if not exists", lowered)

    def test_the_canary_revokes_the_schema_default_grant(self) -> None:
        """RLS ALONE IS NOT ENOUGH IN `plm`, and this test exists to say so.

        `20260710135975_reconcile_service_role_grants.sql` line 14 runs
        `alter default privileges in schema plm grant all on tables to
        service_role`. That fires at CREATE TABLE, silently, with nothing in the
        creating migration to hint at it -- so every new `plm.*` table is born
        with ALL privileges held by `service_role`, and `service_role` BYPASSES
        RLS in Supabase.

        An earlier draft of this canary claimed "no role is granted anything"
        and relied on RLS with no policies. That was false. The blast radius was
        nil (an empty table nothing reads); the danger was the comment, because
        a header that states a safety property the file does not have is what
        the next author copies.
        """
        raw = local_migrations(REPO)[self.VERSION].read_text(encoding="utf-8")
        lowered = strip_sql(raw)
        self.assertIn("enable row level security", lowered)
        self.assertNotIn("create policy", lowered)
        for role in ("public", "anon", "authenticated", "service_role"):
            with self.subTest(role=role):
                self.assertIn(
                    "revoke all on plm.production_lane_canary from " + role,
                    lowered,
                )

    def test_the_canary_revokes_with_ALL_not_an_enumerated_list(self) -> None:
        """A hand-enumerated list misses MAINTAIN on PG 17.6 and goes stale."""
        raw = local_migrations(REPO)[self.VERSION].read_text(encoding="utf-8")
        lowered = strip_sql(raw)
        for line in lowered.splitlines():
            stripped = line.strip()
            if stripped.startswith("revoke "):
                with self.subTest(line=stripped):
                    self.assertTrue(
                        stripped.startswith("revoke all "),
                        "revoke bits individually and the next privilege "
                        "Postgres adds is silently left granted",
                    )

    def test_the_canary_asserts_the_RESULTING_privileges_at_apply_time(self) -> None:
        """The assertion must be about the RESULT, not that the statements ran.

        A revoke that silently did nothing looks identical in a migration log to
        one that worked. This canary's entire job is to be trustworthy evidence
        that the lane works, so it self-checks in the database it just wrote to
        and raises if any privilege survived. That is stronger than anything
        this offline suite could assert, because it runs against the real
        production catalog.
        """
        raw = local_migrations(REPO)[self.VERSION].read_text(encoding="utf-8").lower()
        # Version-proof check: catches MAINTAIN without naming it.
        self.assertIn("aclexplode", raw)
        # Named bits, so a failure says WHICH privilege survived.
        self.assertIn("has_table_privilege", raw)
        for privilege in (
            "select",
            "insert",
            "update",
            "delete",
            "truncate",
            "references",
            "trigger",
        ):
            with self.subTest(privilege=privilege):
                self.assertIn("'" + privilege + "'", raw)
        for role in ("anon", "authenticated", "service_role"):
            with self.subTest(role=role):
                self.assertIn("'" + role + "'", raw)
        self.assertIn("raise exception", raw)

    def test_the_canary_header_no_longer_claims_it_grants_nothing(self) -> None:
        """Guard against the false claim reappearing by copy-paste."""
        raw = local_migrations(REPO)[self.VERSION].read_text(encoding="utf-8")
        self.assertNotIn("no role is granted anything", raw)
        # And it must explain WHY the revoke is needed, not just do it.
        self.assertIn("20260710135975", raw)
        self.assertIn("default privileges", raw)

    def test_the_canary_passes_the_guard_on_its_own(self) -> None:
        remote = production_ledger_versions()
        migrations = local_migrations(REPO)
        self.assertEqual(parse_allowlist(self.VERSION), [self.VERSION])
        preflight_batch(migrations, [self.VERSION], remote)

class LexerFalseAcceptDefects(unittest.TestCase):
    """#609 (F1, F2) and #672 (items 2, 3).

    Every defect below failed in the FALSE-ACCEPT direction: the guard let
    something through it should have questioned. All had ZERO live exposure when
    filed, and a differential run of the old and new guard over all 429 files in
    supabase/migrations/ produced 0 differences in created_objects,
    hard_references and assert_no_archaic_function_body. These tests exist so the
    defects cannot silently return.
    """

    # --- #609 F1: `$$` inside an unquoted identifier ------------------------

    def test_f1_dollars_inside_an_identifier_do_not_open_a_dollar_quote(self) -> None:
        """A dollar quote opens only at a token boundary.

        `my$$col` used to latch onto the next genuine `$$` and blank everything
        between, so a real hard reference silently disappeared.
        """
        sql = (
            "create table plm.t (my$$col uuid);\n"
            "alter table plm.missing_dep add column x uuid;\n"
            "create function plm.f() returns void as $$ begin end $$ language plpgsql;\n"
        )
        self.assertIn("plm.t", created_objects(sql))
        self.assertIn("plm.f", created_objects(sql))
        refs = [obj for obj, _reason in hard_references(sql)]
        self.assertIn("plm.missing_dep", refs)

    def test_f1_a_genuine_dollar_quote_is_still_stripped(self) -> None:
        """The boundary rule must not stop real dollar bodies being blanked.

        Names inside a function body resolve at CALL time, so they are deferrable
        and must NOT become batch-ordering dependencies.
        """
        sql = (
            "create function plm.f() returns void as $$ "
            "select * from plm.inside_body_only; $$ language sql;\n"
        )
        refs = [obj for obj, _reason in hard_references(sql)]
        self.assertNotIn("plm.inside_body_only", refs)

    def test_f1_a_dollar_quote_at_the_very_start_of_a_file_still_opens(self) -> None:
        """The i > 0 term must not make position 0 a non-boundary."""
        self.assertNotIn("plm.hidden", strip_sql("$$ select plm.hidden $$"))

    # --- #609 F2 / #672 item 3: the phantom CREATE --------------------------

    def test_f2_create_text_inside_a_regclass_literal_is_not_a_created_object(self) -> None:
        """A phantom in `available` can satisfy a dependency production cannot meet."""
        sql = "alter table plm.t alter column id set default nextval('create table plm.ghost'::regclass);\n"
        self.assertNotIn("plm.ghost", created_objects(sql))

    def test_f2_the_regclass_reference_itself_is_still_found(self) -> None:
        """Blanking for the CREATE scan must not cost the dependency the exception exists for."""
        sql = "alter table plm.t alter column id set default nextval('plm.t_id_seq'::regclass);\n"
        refs = [obj for obj, _reason in hard_references(sql)]
        self.assertIn("plm.t_id_seq", refs)

    def test_f2_a_real_create_beside_a_regclass_literal_is_still_seen(self) -> None:
        sql = (
            "create table plm.real (id uuid);\n"
            "alter table plm.t alter column id set default nextval('plm.s'::regclass);\n"
        )
        self.assertIn("plm.real", created_objects(sql))

    # --- #609 F5: `available` never shrank on DROP/RENAME --------------------

    def test_f5_a_dropped_object_is_reported_as_dropped(self) -> None:
        """The defect, exactly as #609 states it: `drop table plm.old` yielded
        `created_objects == {}` and removed nothing, so a later
        `alter table plm.old` was still satisfied from the ledger."""
        self.assertEqual(dropped_objects("drop table plm.old;\n"), {"plm.old"})

    def test_f5_drop_then_recreate_in_one_file_leaves_the_object_AVAILABLE(self) -> None:
        """The normal way to change a view's column set. Contract section 5's B7
        (`api.opa_property_reconciliation`) and B10b both do it. Treating it as a
        removal would turn one false-ACCEPT into a wave of false REJECTs."""
        sql = (
            "drop view if exists api.x;\n"
            "create view api.x as select 1 as a;\n"
        )
        self.assertEqual(dropped_objects(sql), set())
        self.assertIn("api.x", created_objects(sql))

    def test_f5_create_then_drop_in_one_file_leaves_the_object_GONE(self) -> None:
        """Last event wins in both directions, not just the convenient one."""
        sql = "create table plm.tmp (id uuid);\ndrop table plm.tmp;\n"
        self.assertEqual(dropped_objects(sql), {"plm.tmp"})

    def test_f5_a_multi_object_drop_removes_every_name(self) -> None:
        self.assertEqual(
            dropped_objects("drop table plm.a, plm.b cascade;\n"),
            {"plm.a", "plm.b"},
        )

    def test_f5_function_argument_types_are_not_recorded_as_dropped_objects(self) -> None:
        """Issue #881: the object list ends when the signature starts."""
        self.assertEqual(
            dropped_objects("drop function plm.f(plm.mytype);\n"),
            {"plm.f"},
        )

    def test_f5_procedure_signature_with_qualified_types_stays_bounded(self) -> None:
        self.assertEqual(
            dropped_objects("drop procedure if exists plm.p(core.a, core.b);\n"),
            {"plm.p"},
        )

    def test_f5_multi_function_drop_reads_past_each_balanced_signature(self) -> None:
        self.assertEqual(
            dropped_objects(
                "drop function plm.f(integer), plm.g(core.kind, numeric(10, 2));\n"
            ),
            {"plm.f", "plm.g"},
        )

    def test_f5_multi_procedure_drop_reads_past_each_balanced_signature(self) -> None:
        self.assertEqual(
            dropped_objects(
                "drop procedure if exists plm.p(core.a), plm.q(text, core.b) cascade;\n"
            ),
            {"plm.p", "plm.q"},
        )

    def test_f5_routine_names_may_start_with_drop_modifier_words(self) -> None:
        self.assertEqual(
            dropped_objects(
                "drop function plm.cascade_worker(integer), "
                "plm.restrict_worker(text);\n"
            ),
            {"plm.cascade_worker", "plm.restrict_worker"},
        )

    def test_f5_true_trailing_drop_modifiers_end_routine_lists(self) -> None:
        self.assertEqual(
            dropped_objects("drop function plm.f(integer) cascade;\n"),
            {"plm.f"},
        )
        self.assertEqual(
            dropped_objects("drop procedure plm.p(text) restrict;\n"),
            {"plm.p"},
        )

    def test_f5_a_rename_removes_the_OLD_name_and_adds_the_NEW_one(self) -> None:
        events = dict(
            (obj, created) for _pos, obj, created in
            object_events("alter table plm.old rename to fresh;\n")
        )
        self.assertEqual(events, {"plm.old": False, "plm.fresh": True})

    def test_f5_rename_COLUMN_is_not_a_rename_of_the_table(self) -> None:
        """`rename column y to z` carries a noun between `rename` and `to`. If
        this ever matched, every column rename in the backlog would delete its
        own table from `available` and reject the batch."""
        self.assertEqual(
            dropped_objects("alter table plm.t rename column a to b;\n"), set()
        )

    def test_f5_rename_CONSTRAINT_is_not_a_rename_of_the_table(self) -> None:
        self.assertEqual(
            dropped_objects("alter table plm.t rename constraint a to b;\n"), set()
        )

    def test_f5_set_schema_moves_the_qualified_name(self) -> None:
        events = dict(
            (obj, created) for _pos, obj, created in
            object_events("alter table plm.t set schema core;\n")
        )
        self.assertEqual(events, {"plm.t": False, "core.t": True})

    def test_f5_drop_TRIGGER_on_a_table_does_not_drop_the_table(self) -> None:
        """`drop trigger x on plm.t` names a table it does not remove. The
        reference regexes already read this position; the drop regexes must not."""
        self.assertEqual(
            dropped_objects("drop trigger x on plm.t;\n"), set()
        )

    def test_f5_drop_POLICY_and_INDEX_do_not_drop_their_target(self) -> None:
        self.assertEqual(dropped_objects("drop policy p on plm.t;\n"), set())
        self.assertEqual(dropped_objects("drop index plm.idx;\n"), set())

    def test_f5_a_batch_referencing_a_DROPPED_object_is_REFUSED(self) -> None:
        """End to end. Before this, the ledger still 'provided' plm.old and the
        batch passed."""
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "supabase" / "migrations"
            root.mkdir(parents=True)
            (root / "20260101000000_a.sql").write_text(
                "create table plm.old (id uuid);\n", encoding="utf-8"
            )
            (root / "20260102000000_b.sql").write_text(
                "drop table plm.old;\n", encoding="utf-8"
            )
            (root / "20260103000000_c.sql").write_text(
                "alter table plm.old add column x uuid;\n", encoding="utf-8"
            )
            migrations = local_migrations(Path(tmp))
            with self.assertRaises(GuardError) as ctx:
                preflight_batch(
                    migrations,
                    ["20260102000000", "20260103000000"],
                    {"20260101000000"},
                )
            message = str(ctx.exception)
            self.assertIn("plm.old", message)
            self.assertIn("DROPPED (or renamed away) by 20260102000000", message)
            # The advice must be the OPPOSITE of the "created by X" case: no
            # allowlist can bring a dropped object back.
            self.assertIn("Adding versions to the allowlist cannot fix this", message)

    def test_f5_a_drop_in_the_APPLIED_LEDGER_is_honoured_too(self) -> None:
        """The removal need not be in the batch. If production already dropped
        it, the batch still aborts."""
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "supabase" / "migrations"
            root.mkdir(parents=True)
            (root / "20260101000000_a.sql").write_text(
                "create table plm.old (id uuid);\n", encoding="utf-8"
            )
            (root / "20260102000000_b.sql").write_text(
                "drop table plm.old;\n", encoding="utf-8"
            )
            (root / "20260103000000_c.sql").write_text(
                "alter table plm.old add column x uuid;\n", encoding="utf-8"
            )
            migrations = local_migrations(Path(tmp))
            with self.assertRaises(GuardError) as ctx:
                preflight_batch(
                    migrations,
                    ["20260103000000"],
                    {"20260101000000", "20260102000000"},
                )
            self.assertIn("DROPPED (or renamed away) by 20260102000000", str(ctx.exception))

    def test_f5_a_recreated_object_is_available_again(self) -> None:
        """Dropping then re-creating across FILES must not leave a permanent
        hole -- otherwise every drop-and-recreate split over two migrations
        becomes an unsatisfiable refusal."""
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "supabase" / "migrations"
            root.mkdir(parents=True)
            (root / "20260101000000_a.sql").write_text(
                "create table plm.old (id uuid);\n", encoding="utf-8"
            )
            (root / "20260102000000_b.sql").write_text(
                "drop table plm.old;\n", encoding="utf-8"
            )
            (root / "20260103000000_c.sql").write_text(
                "create table plm.old (id uuid);\n", encoding="utf-8"
            )
            (root / "20260104000000_d.sql").write_text(
                "alter table plm.old add column x uuid;\n", encoding="utf-8"
            )
            migrations = local_migrations(Path(tmp))
            preflight_batch(
                migrations,
                ["20260102000000", "20260103000000", "20260104000000"],
                {"20260101000000"},
            )

    def test_f5_no_existing_migration_becomes_a_new_rejection(self) -> None:
        """MEASURED EXPOSURE, re-measured on every run rather than quoted.

        Walk every migration in version order, applying creates and net drops,
        and assert that no file hard-references an object an earlier file
        removed. When this was written it held across all 437 files with 8 net
        drop events. If a future migration breaks it, that is a REAL finding --
        do not delete this test to get past it, and do not assume the lexer is
        at fault before checking the migration.
        """
        migrations = local_migrations(REPO)
        available: set[str] = set()
        removed: dict[str, str] = {}
        offenders: list[str] = []
        for version in sorted(migrations):
            raw = migrations[version].read_text(encoding="utf-8")
            for obj, reason in hard_references(raw):
                if obj in removed:
                    offenders.append(f"{version} -> {obj} ({reason}), dropped by {removed[obj]}")
            created, dropped = created_objects(raw), dropped_objects(raw)
            available |= created
            available -= dropped
            for obj in created:
                removed.pop(obj, None)
            for obj in dropped:
                removed[obj] = version
        self.assertEqual(offenders, [])

    # --- #672 item 2: the bare `do '...'` blind spot -------------------------

    def test_bare_do_with_a_string_body_is_refused(self) -> None:
        """It matches neither `as '...'` nor a routine header, so it was invisible."""
        with self.assertRaises(GuardError):
            assert_no_archaic_function_body("20260811000000", "do 'begin perform 1; end';\n")

    def test_bare_do_with_an_explicit_language_is_refused(self) -> None:
        with self.assertRaises(GuardError):
            assert_no_archaic_function_body(
                "20260811000000", "do language plpgsql 'begin perform 1; end';\n"
            )

    def test_a_dollar_quoted_do_block_is_accepted(self) -> None:
        assert_no_archaic_function_body(
            "20260811000000", "do $$ begin perform 1; end $$;\n"
        )

    def test_prose_containing_the_words_do_and_a_quote_is_NOT_refused(self) -> None:
        """The statement-start scoping is load-bearing.

        This scan runs on keep_literals=True text, so a comment's own English is
        visible to it. An unscoped search would hard-refuse a blameless migration
        over its prose -- the failure this scoping prevents.
        """
        assert_no_archaic_function_body(
            "20260811000000",
            "comment on table plm.t is 'we do ''this'' on purpose';\n",
        )

    def test_no_file_in_the_repo_is_NEWLY_refused(self) -> None:
        """The whole corpus must be unaffected by all four fixes.

        Exactly ONE file is refused, and it was refused before these fixes too:
        20260729120000 (`language sql security definer as 'select 1';`), which is
        RETIRED and permanently HARD_BLOCKED, so no promotable file is affected.
        Asserting the exact set -- rather than "nothing is refused" -- is what
        makes this test able to catch a NEW refusal appearing.
        """
        refused = set()
        for version, path in local_migrations(REPO).items():
            try:
                assert_no_archaic_function_body(
                    version, path.read_text(encoding="utf-8", errors="replace")
                )
            except GuardError:
                refused.add(version)
        self.assertEqual(refused, {"20260729120000"})
        self.assertIn("20260729120000", HARD_BLOCKED)


BATCHES = {name: members for name, _basis, _why, members in ATOMIC_BATCHES}
BASES = {name: basis for name, basis, _why, _members in ATOMIC_BATCHES}

# The guard's EXACT membership, version by version. Issue #784 item 2: this used
# to assert COUNTS only, and the exact membership had been reconciled BY HAND
# during the #781 review with nothing pinning it afterwards -- so a future edit
# could swap one version for another and every test would still pass. Batch
# membership drift is not hypothetical in this repo: on 2026-08-11 the lists
# carried in issue text (#710, #773) were found to contain a B3/B4 overlap the
# contract did not have.
#
# TRANSCRIBED FROM docs/production-promotion-app-tolerance-contract.md, section 5
# (and 5A.4 for B10), NOT from any issue body. AGENTS.md 4.3: the contract is the
# authority for batch membership, never an issue.
#
# B3 is 11, NOT the contract section-5 functional count of 10: the guard carries
# one SECURITY appendage the contract predates -- 20260812020000 (issue #822,
# service_role TRUNCATE revoke on three append-only tables plus
# core.property_alias). The contract's ten are a strict subset of the guard's
# eleven. See the B3 entry in production_migration_guard.py and
# B3TruncateFixCoPresenceTest below.
CONTRACT_MEMBERSHIP = {
    "B1": frozenset({
        "20260724060000", "20260724061000", "20260726030000", "20260726031000",
        "20260726032000", "20260726180000", "20260727221500", "20260727223000",
        "20260727224500", "20260727230000", "20260728134500",
    }),
    "B2": frozenset({
        "20260728171500", "20260728174500", "20260728181500",
    }),
    "B3": frozenset({
        "20260729230000", "20260729234500", "20260729235500", "20260730000500",
        "20260731150000", "20260731153000", "20260731163000", "20260731180000",
        "20260731190000", "20260731200000",
        "20260812020000",  # the post-contract #822 security appendage
    }),
    "B4": frozenset({
        "20260731210000", "20260731220000",
    }),
    "B5": frozenset({
        "20260802140000", "20260802141000", "20260802150000", "20260802160000",
    }),
    "B6": frozenset({
        "20260803150000", "20260803200000", "20260803201000", "20260804120000",
        "20260804120100",
    }),
    "B7": frozenset({
        "20260807030000", "20260807170000", "20260807170100", "20260807180000",
        "20260807190000", "20260807200000",
    }),
    "B8": frozenset({
        "20260809170000", "20260809170100", "20260809170200", "20260809170300",
        "20260809170400", "20260809170500",
    }),
    "B9": frozenset({
        "20260810010000", "20260810020000", "20260810030000", "20260810050000",
        "20260810060000", "20260810070000", "20260810080000", "20260810090000",
        "20260810100000", "20260810110000", "20260810120000", "20260810130000",
        "20260810160000", "20260810170000",
    }),
    # Contract section 5A.4. B10b (20260811030000) and B10d (20260811070000) are
    # single files -- trivially atomic, nothing to stop halfway through -- so
    # they have no entry and must not gain one.
    "B10a": frozenset({
        "20260810190000", "20260810190100",
    }),
    "B10c": frozenset({
        "20260811050000", "20260811060000",
    }),
}
CONTRACT_COUNTS = {name: len(members) for name, members in CONTRACT_MEMBERSHIP.items()}

# Which entries the contract DECLARES atomic (section 5 / 5A.4) versus which are
# DERIVED from its section 6 never-rest list. The guard states this in each
# entry's `basis` field and the refusal message quotes the right section, so a
# mislabelled entry would cite a contract sentence that does not exist.
CONTRACT_BASES = {
    "B1": "ATOMIC",
    "B2": "NEVER-REST",
    "B3": "ATOMIC",
    "B4": "NEVER-REST",
    "B5": "NEVER-REST",
    "B6": "NEVER-REST",
    "B7": "ATOMIC",
    "B8": "NEVER-REST",
    "B9": "ATOMIC",
    "B10a": "ATOMIC",
    "B10c": "ATOMIC",
}

CONTRACT_PATH = REPO / "docs" / "production-promotion-app-tolerance-contract.md"


class AtomicBatchTests(unittest.TestCase):
    """The contract's four atomic batches, mechanically enforced.

    THE REFUSAL CASES ARE THE POINT. Before this check existed, a lone
    `20260810050000` -- squarely inside atomic B9, and in no HARD_BLOCKED entry,
    no bundle and no co-presence rule -- passed the whole guard. Every
    `_is_REFUSED` test below fails against the pre-change guard; the
    `_is_ACCEPTED` ones pass both before and after, and prove only that the new
    check did not over-reach.
    """

    def test_membership_matches_the_contract_EXACTLY(self) -> None:
        """#784 item 2. EXACT frozensets, not counts.

        The count-only version of this test would pass while a member was
        swapped for an entirely different version. It is what let the B3/B4
        overlap in #710/#773 go unnoticed for as long as it did.
        """
        self.assertEqual(set(BATCHES), set(CONTRACT_MEMBERSHIP))
        for name, expected in CONTRACT_MEMBERSHIP.items():
            self.assertEqual(BATCHES[name], expected, name)

    def test_membership_counts_still_reconcile_with_the_contract(self) -> None:
        for name, expected in CONTRACT_COUNTS.items():
            self.assertEqual(len(BATCHES[name]), expected, name)

    def test_every_entry_declares_the_right_basis(self) -> None:
        """ATOMIC entries cite contract section 5; NEVER-REST entries cite
        section 6. A mislabelled entry would quote a sentence that is not
        there."""
        self.assertEqual(BASES, CONTRACT_BASES)
        for basis in BASES.values():
            self.assertIn(basis, {"ATOMIC", "NEVER-REST"})

    # -- #784: the prose in contract section 6 is now enforced --------------

    def _section_6_never_rest_versions(self) -> set[str]:
        """The contract's OWN never-rest list, parsed from the file.

        Deliberately read from the contract rather than transcribed, so a
        never-rest state added to the document and enforced by nothing fails
        here. That is the exact defect #784 was filed about.
        """
        text = CONTRACT_PATH.read_text(encoding="utf-8")
        body = text.split("## 6. States that must NEVER be rested on", 1)[1]
        body = body.split("**The two B10 never-rest states", 1)[0]
        block = body.split("```", 2)[1]
        return set(re.findall(r"\b\d{14}\b", block))

    def test_the_section_6_list_is_parseable_and_not_empty(self) -> None:
        """If the contract's heading or fence shape changes, the coverage test
        below would silently pass over an empty set. Fail loudly instead."""
        versions = self._section_6_never_rest_versions()
        self.assertGreaterEqual(len(versions), 50, sorted(versions))

    def test_every_section_6_never_rest_version_is_ENFORCED(self) -> None:
        """THE POINT OF #784.

        Every version the contract forbids resting on must belong to a
        registered batch, and must not be that batch's terminal member -- so
        an allowlist that stops at it is refused by `assert_atomic_batches`.
        Before this change, B2/B4/B5/B6/B8's 15 never-rest versions belonged to
        no entry at all and the guard accepted resting on any of them.
        """
        unenforced: list[str] = []
        for version in sorted(self._section_6_never_rest_versions()):
            owner = [n for n, m in BATCHES.items() if version in m]
            if not owner:
                unenforced.append(f"{version}: in no registered batch")
                continue
            name = owner[0]
            if version == max(BATCHES[name]):
                unenforced.append(
                    f"{version}: is {name}'s terminal member, so resting on it "
                    "is accepted"
                )
        self.assertEqual(unenforced, [])

    def test_resting_on_any_section_6_version_is_REFUSED(self) -> None:
        """End to end, one allowlist per never-rest version: an allowlist whose
        highest version is a forbidden resting state must be refused."""
        for version in sorted(self._section_6_never_rest_versions()):
            name = next(n for n, m in BATCHES.items() if version in m)
            stopping_here = sorted(v for v in BATCHES[name] if v <= version)
            with self.subTest(version=version, batch=name):
                with self.assertRaises(GuardError) as ctx:
                    assert_atomic_batches(stopping_here, set())
                self.assertIn(f"batch {name} is", str(ctx.exception))

    def test_batches_do_not_overlap_each_other(self) -> None:
        """The #773 / #710 B3/B4 defect must not be reproduced here.

        `20260731150000` and `20260731153000` belong to B3 alone. B4 is not
        atomic, so it has no entry -- but if a future edit adds one carrying
        those two versions, the overlap becomes a guard that refuses both
        batches forever. Catch it here.
        """
        for left, right in itertools.combinations(sorted(BATCHES), 2):
            self.assertEqual(
                BATCHES[left] & BATCHES[right], set(), f"{left}/{right} overlap"
            )
        self.assertIn("20260731150000", BATCHES["B3"])
        self.assertIn("20260731153000", BATCHES["B3"])

    def test_every_member_is_a_real_migration_file(self) -> None:
        known = set(local_migrations(REPO))
        for name, members in BATCHES.items():
            self.assertEqual(members - known, set(), name)

    def test_every_hold_set_member_is_a_real_migration_file(self) -> None:
        """THE TEST THAT WOULD HAVE CAUGHT ISSUE #1182 OUTRIGHT.

        Every decision-making version set in the guard is discovered by
        introspection, not listed here, so a set added tomorrow is covered
        without anybody remembering to extend this test. That matters more than
        it looks: the sibling above covered only ATOMIC_BATCHES, so when the
        2026-08-18 supersession left `20260817232425` in FR_HELD_20260803 while
        renaming the file to `20260818174350`, nothing failed. The stale string
        gated nothing and the real file was in no hold set at all.

        A version string in any of these sets is a SAFETY CONTROL. A phantom
        entry is worse than an absent one: it reads as protection and enforces
        nothing.
        """
        known = set(local_migrations(REPO))
        checked: list[str] = []

        for name, value in sorted(vars(production_migration_guard).items()):
            if name.startswith("_") or not name.isupper():
                continue
            if not isinstance(value, (set, frozenset)):
                continue
            if not value or not all(
                isinstance(item, str) and VERSION_RE.fullmatch(item) for item in value
            ):
                continue
            checked.append(name)
            self.assertEqual(
                set(value) - known,
                set(),
                f"{name} names version(s) with no migration file. If a migration "
                "was renamed or re-reserved, update this set in the SAME commit "
                "(AGENTS.md 6.5, issue #1182).",
            )

        # The discovery itself must not silently stop finding anything -- an
        # empty sweep would make this test permanently green and useless.
        # FR_REMOVAL_VERSIONS is named explicitly (issue #1339). It was empty for
        # eleven days, and an empty set is skipped by the sweep above -- so the
        # day it was populated was the first day it was covered at all. Naming it
        # here means emptying it again, or renaming its migration, fails loudly
        # instead of silently dropping out of the sweep.
        for required in (
            "HARD_BLOCKED",
            "FR_HELD_20260803",
            "FR_COMPATIBILITY_VERSIONS",
            "FR_REMOVAL_VERSIONS",
        ):
            self.assertIn(required, checked)

        # The structured rule tables are not plain sets, so they are swept
        # explicitly rather than left to the introspection above.
        for create, fixes, _why in CO_PRESENCE_RULES:
            self.assertIn(create, known, f"co-presence create {create}")
            self.assertEqual(set(fixes) - known, set(), f"co-presence fixes of {create}")
        for name, _basis, _why, members in ATOMIC_BATCHES:
            self.assertEqual(set(members) - known, set(), f"atomic batch {name}")

    def test_no_retired_version_string_is_still_gating(self) -> None:
        """`20260817232425` was re-reserved away on 2026-08-18 (issue #1182).

        It must never again appear in a guard set. Comments explaining the
        history are fine and deliberate; a SET MEMBER is not.
        """
        retired = "20260817232425"
        for name, value in sorted(vars(production_migration_guard).items()):
            if not name.isupper() or not isinstance(value, (set, frozenset)):
                continue
            self.assertNotIn(retired, value, name)
        for create, fixes, _why in CO_PRESENCE_RULES:
            self.assertNotEqual(create, retired)
            self.assertNotIn(retired, fixes)
        for name, _basis, _why, members in ATOMIC_BATCHES:
            self.assertNotIn(retired, members, name)

    def test_no_atomic_member_is_hard_blocked_or_FR_held(self) -> None:
        """A batch that can never be completed would be a permanent refusal."""
        for name, members in BATCHES.items():
            self.assertEqual(members & HARD_BLOCKED, set(), name)
            self.assertEqual(members & FR_HELD_20260803, set(), name)

    # -- the defect this change exists to close ----------------------------

    def test_the_lone_20260810050000_shortcut_is_REFUSED(self) -> None:
        """The exact allowlist that used to pass. Issue #729's tempting shortcut."""
        with self.assertRaises(GuardError) as ctx:
            assert_atomic_batches(["20260810050000"], set())
        message = str(ctx.exception)
        self.assertIn("batch B9 is ATOMIC", message)
        self.assertIn("supplied (1): 20260810050000", message)
        self.assertIn("MISSING (13):", message)
        # The message must NAME the missing members, not merely count them.
        for version in sorted(BATCHES["B9"] - {"20260810050000"}):
            self.assertIn(version, message)

    def test_a_partial_B9_allowlist_is_REFUSED(self) -> None:
        partial = sorted(BATCHES["B9"])[:-1]
        with self.assertRaises(GuardError) as ctx:
            assert_atomic_batches(partial, set())
        self.assertIn("batch B9 is ATOMIC", str(ctx.exception))
        self.assertIn("MISSING (1): 20260810170000", str(ctx.exception))

    def test_a_complete_B9_allowlist_is_ACCEPTED(self) -> None:
        assert_atomic_batches(sorted(BATCHES["B9"]), set())

    def test_a_partial_B1_allowlist_is_REFUSED(self) -> None:
        with self.assertRaises(GuardError) as ctx:
            assert_atomic_batches(["20260724060000"], set())
        self.assertIn("batch B1 is ATOMIC", str(ctx.exception))

    def test_a_complete_B1_allowlist_is_ACCEPTED(self) -> None:
        assert_atomic_batches(sorted(BATCHES["B1"]), set())

    def test_a_partial_B3_allowlist_is_REFUSED(self) -> None:
        """Stopping before 20260731200000 leaves INCOMPLETE PROVENANCE, which the
        contract records as unrecoverable after the fact."""
        partial = sorted(BATCHES["B3"] - {"20260731200000"})
        with self.assertRaises(GuardError) as ctx:
            assert_atomic_batches(partial, set())
        self.assertIn("batch B3 is ATOMIC", str(ctx.exception))
        self.assertIn("MISSING (1): 20260731200000", str(ctx.exception))

    def test_a_complete_B3_allowlist_is_ACCEPTED(self) -> None:
        assert_atomic_batches(sorted(BATCHES["B3"]), set())

    def test_a_partial_B7_allowlist_is_REFUSED(self) -> None:
        """20260807190000 without 20260807200000: the drop-and-recreate window."""
        with self.assertRaises(GuardError) as ctx:
            assert_atomic_batches(["20260807190000"], set())
        self.assertIn("batch B7 is ATOMIC", str(ctx.exception))

    def test_a_complete_B7_allowlist_is_ACCEPTED(self) -> None:
        assert_atomic_batches(sorted(BATCHES["B7"]), set())

    def test_every_single_member_alone_is_REFUSED_for_every_atomic_batch(self) -> None:
        """No size-one subset of any atomic batch is legal. Exhaustive on purpose:
        `20260810050000` was found by hand, and the next hole should not be."""
        for name, members in BATCHES.items():
            for version in sorted(members):
                with self.subTest(batch=name, version=version):
                    with self.assertRaises(GuardError) as ctx:
                        assert_atomic_batches([version], set())
                    self.assertIn(
                        f"batch {name} is {BASES[name]}", str(ctx.exception)
                    )

    def test_every_proper_subset_missing_one_member_is_REFUSED(self) -> None:
        for name, members in BATCHES.items():
            for dropped in sorted(members):
                with self.subTest(batch=name, dropped=dropped):
                    with self.assertRaises(GuardError):
                        assert_atomic_batches(sorted(members - {dropped}), set())

    # -- the batches the contract does NOT declare atomic -------------------

    def test_the_NEVER_REST_batches_are_now_ENFORCED(self) -> None:
        """ISSUE #784 -- A DELIBERATE BEHAVIOUR CHANGE. EVERY ONE OF THESE
        PARTIAL ALLOWLISTS USED TO PASS.

        The predecessor of this test asserted the OPPOSITE: that a partial
        B5/B6/B8 allowlist was "unaffected" by the check. It was faithful to the
        guard as it stood, and the guard was wrong -- contract section 6 forbids
        resting inside these batches and nothing enforced it. A partial B2
        allowlist would have shipped the known-defective ClickUp importer.
        """
        for name in ("B2", "B4", "B5", "B6", "B8"):
            members = sorted(BATCHES[name])
            for size in range(1, len(members)):
                with self.subTest(batch=name, members=members[:size]):
                    with self.assertRaises(GuardError) as ctx:
                        assert_atomic_batches(members[:size], set())
                    self.assertIn(f"batch {name} is NEVER-REST", str(ctx.exception))

    def test_a_complete_NEVER_REST_batch_is_ACCEPTED(self) -> None:
        """The check must compel completion, never forbid it."""
        for name in ("B2", "B4", "B5", "B6", "B8"):
            with self.subTest(batch=name):
                assert_atomic_batches(sorted(BATCHES[name]), set())

    def test_a_NEVER_REST_refusal_cites_contract_section_6(self) -> None:
        """An ATOMIC refusal cites section 5; these must cite section 6, because
        that is the sentence the operator has to go and read."""
        with self.assertRaises(GuardError) as ctx:
            assert_atomic_batches(["20260728174500"], set())
        message = str(ctx.exception)
        self.assertIn("batch B2 is NEVER-REST", message)
        self.assertIn("section 6 forbids resting on every member of B2", message)
        self.assertIn("20260728181500", message)

    def test_a_NEVER_REST_batch_resumes_after_a_mid_batch_abort(self) -> None:
        """Ledger-awareness applies to these entries exactly as it does to the
        atomic ones: the remainder ALONE is the only legal recovery."""
        applied = BATCHES["B8"] - {"20260809170500"}
        assert_atomic_batches(["20260809170500"], set(applied))

    def test_the_canary_alone_is_unaffected(self) -> None:
        """B0, `20260810140000`, goes first and ALONE by contract section 5. It is
        deliberately NOT a B9 member; if it were, the canary could never run."""
        assert_atomic_batches(["20260810140000"], set())
        self.assertNotIn("20260810140000", BATCHES["B9"])

    # -- resumability: the reason the check reads the ledger -----------------

    def test_a_resume_after_a_mid_batch_abort_is_ACCEPTED(self) -> None:
        """B9 died at file 14 of 14. The only legal recovery allowlist is the
        fourteenth ALONE, because `validate_candidates` refuses to re-list an
        applied version. A ledger-blind rule would refuse it and force an edit of
        this safety guard while production sat exposed."""
        applied = BATCHES["B9"] - {"20260810170000"}
        assert_atomic_batches(["20260810170000"], set(applied))

    def test_a_resume_that_is_STILL_partial_is_REFUSED(self) -> None:
        """Resumability is not an escape hatch: the remainder must be complete."""
        applied = set(sorted(BATCHES["B9"])[:5])
        remainder = sorted(BATCHES["B9"] - applied)
        with self.assertRaises(GuardError) as ctx:
            assert_atomic_batches(remainder[:-1], set(applied))
        message = str(ctx.exception)
        self.assertIn("batch B9 is ATOMIC", message)
        self.assertIn("Excluded because production already has them", message)

    def test_a_fully_applied_batch_does_not_block_anything(self) -> None:
        assert_atomic_batches(sorted(BATCHES["B5"]), set(BATCHES["B9"]))

    # -- the choke points --------------------------------------------------

    def test_validate_candidates_enforces_atomicity(self) -> None:
        """`prepare` and `preflight` both funnel through this."""
        migrations = {v: Path(f"{v}_x.sql") for v in BATCHES["B9"]}
        with self.assertRaises(GuardError) as ctx:
            validate_candidates(migrations, ["20260810050000"], set())
        self.assertIn("batch B9 is ATOMIC", str(ctx.exception))

    def test_assert_bounded_enforces_atomicity(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "supabase" / "migrations").mkdir(parents=True)
            (root / "supabase" / "migrations" / "20260810050000_x.sql").write_text(
                "select 1;\n", encoding="utf-8"
            )
            ledger = root / "ledger.json"
            ledger.write_text('[{"version": "20260101000000"}]', encoding="utf-8")
            with self.assertRaises(GuardError) as ctx:
                assert_bounded(root, "20260810050000", ledger)
            self.assertIn("batch B9 is ATOMIC", str(ctx.exception))

    # -- #819: B10a and B10c -----------------------------------------------

    def test_the_lone_20260811050000_shortcut_is_REFUSED(self) -> None:
        """ISSUE #819 -- A DELIBERATE BEHAVIOUR CHANGE. THIS USED TO PASS.

        B10c is declared ATOMIC by contract section 5A.4 and was enforced by
        nothing: not by ATOMIC_BATCHES and, unlike B10a, not by any co-presence
        rule either. `20260811050000` alone leaves plm.dcp_metadata_* created,
        service_role-insertable, with no supported loader or finalizer.
        """
        with self.assertRaises(GuardError) as ctx:
            assert_atomic_batches(["20260811050000"], set())
        message = str(ctx.exception)
        self.assertIn("batch B10c is ATOMIC", message)
        self.assertIn("MISSING (1): 20260811060000", message)

    def test_a_complete_B10c_allowlist_is_ACCEPTED(self) -> None:
        assert_atomic_batches(sorted(BATCHES["B10c"]), set())

    def test_B10c_resumes_with_the_loader_alone_once_the_landing_is_applied(
        self,
    ) -> None:
        """The recovery case. A run that died between the two is repaired by
        20260811060000 ALONE -- validate_candidates refuses to re-list the
        applied 20260811050000."""
        assert_atomic_batches(["20260811060000"], {"20260811050000"})

    def test_B10a_is_enforced_by_BOTH_mechanisms_and_they_agree(self) -> None:
        """B10a already had a one-directional co-presence rule (#665). The new
        atomic entry must not contradict it: the create alone is refused by
        both, and the loader alone is accepted by both once the create is
        applied."""
        with self.assertRaises(GuardError):
            assert_atomic_batches(["20260810190000"], set())
        with self.assertRaises(GuardError):
            parse_allowlist("20260810190000", frozenset())
        assert_atomic_batches(["20260810190100"], {"20260810190000"})
        self.assertEqual(
            parse_allowlist("20260810190100", {"20260810190000"}),
            ["20260810190100"],
        )

    def test_the_single_file_B10_parts_have_no_entry(self) -> None:
        """B10b and B10d are one file each, so there is no internal boundary to
        stop at. Registering them would add a batch that can never be split and
        a message that can never fire -- and would invite someone to 'complete'
        it by adding neighbours that are not members."""
        registered = set().union(*BATCHES.values())
        self.assertNotIn("20260811030000", registered)
        self.assertNotIn("20260811070000", registered)

    def test_the_refusal_message_says_what_to_do(self) -> None:
        with self.assertRaises(GuardError) as ctx:
            assert_atomic_batches(["20260810030000"], set())
        message = str(ctx.exception)
        self.assertIn("production-promotion-app-tolerance-contract.md", message)
        self.assertIn("Add every missing version to the allowlist", message)
        self.assertIn("no size of subset", message)


class B3TruncateFixCoPresenceTest(unittest.TestCase):
    """Issue #822: the service_role TRUNCATE revoke (20260812020000) is a B3 member.

    B3's creates `grant all` (including TRUNCATE) to service_role on three
    append-only evidence/decision tables plus core.property_alias (controlled
    shared alias truth whose writes go through public.promote_property_alias_batch()).
    For the three append-only tables, TRUNCATE does not fire the BEFORE UPDATE OR
    DELETE row triggers that enforce append-only semantics, so B3 without the fix
    leaves service_role one statement away from silently wiping them; for
    core.property_alias the revoke is defense in depth. The guard therefore lists
    20260812020000 in the B3 ATOMIC_BATCHES set,
    so it cannot be omitted from a B3 promotion. These tests pin that property
    and the ledger-aware recovery shape (the fix ALONE is legal once B3 lands).
    The exhaustive AtomicBatchTests already prove the basic cases (every member
    alone is refused; every proper subset is refused); this class adds the
    intent, the recovery direction, the end-to-end choke point, and a tie
    between the guard's membership and the migration's actual contents.
    """

    FIX = "20260812020000"
    FOUR_TABLES = (
        "plm.coldlion_promotion_audit",
        "plm.coldlion_promotion_quarantine",
        "core.property_alias",
        "dam.popsg_property_resolution",
    )

    def setUp(self) -> None:
        self.assertIn(self.FIX, BATCHES["B3"])
        self.functional = BATCHES["B3"] - {self.FIX}  # the contract's ten

    def test_the_fix_is_a_real_migration_file(self) -> None:
        self.assertIn(self.FIX, local_migrations(REPO))

    def test_b3_without_the_fix_is_refused_and_names_it(self) -> None:
        with self.assertRaises(GuardError) as ctx:
            assert_atomic_batches(sorted(self.functional), set())
        message = str(ctx.exception)
        self.assertIn("batch B3 is ATOMIC", message)
        self.assertIn(f"MISSING (1): {self.FIX}", message)

    def test_b3_with_the_fix_is_accepted(self) -> None:
        assert_atomic_batches(sorted(BATCHES["B3"]), set())

    def test_the_fix_alone_is_refused_before_b3_lands(self) -> None:
        """The revoke depends on tables B3 creates, so it cannot run first."""
        with self.assertRaises(GuardError) as ctx:
            assert_atomic_batches([self.FIX], set())
        self.assertIn("batch B3 is ATOMIC", str(ctx.exception))

    def test_the_fix_alone_is_ALLOWED_once_b3_has_landed(self) -> None:
        """Ledger-aware recovery: a run that died before the fix resumes with the
        fix ALONE, because validate_candidates refuses to re-list applied
        versions. This is the property that makes the rule an atomic member
        rather than a HARD_BLOCKED entry -- a symmetric rule would refuse this
        recovery and force an edit of the safety guard under pressure."""
        applied = set(self.functional)  # the other ten already in production
        assert_atomic_batches([self.FIX], applied)

    def test_validate_candidates_refuses_b3_without_the_fix(self) -> None:
        """The choke point `prepare`/`preflight` both funnel through."""
        migrations = {v: Path(f"{v}_x.sql") for v in BATCHES["B3"]}
        with self.assertRaises(GuardError) as ctx:
            validate_candidates(migrations, sorted(self.functional), set())
        message = str(ctx.exception)
        self.assertIn("batch B3 is ATOMIC", message)
        self.assertIn(self.FIX, message)

    def test_the_migration_actually_revokes_truncate_on_the_four_tables(self) -> None:
        """The guard points B3 at a file that does what the comment claims. If the
        migration stopped revoking TRUNCATE on any of the four tables, the guard's
        co-presence rule would be enforcing nothing, so tie the two together."""
        raw = local_migrations(REPO)[self.FIX].read_text(encoding="utf-8")
        lowered = raw.lower()
        for table in self.FOUR_TABLES:
            self.assertIn(table, lowered)
        # revokes the TRUNCATE bypass + DDL-adjacent bits from service_role...
        self.assertIn("revoke truncate, references, trigger, maintain", lowered)
        # ...and asserts the outcome via has_table_privilege (the behaviour probe).
        self.assertIn("has_table_privilege", lowered)


if __name__ == "__main__":
    unittest.main()
