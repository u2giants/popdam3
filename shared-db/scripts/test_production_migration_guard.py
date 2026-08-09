#!/usr/bin/env python3

from pathlib import Path
import itertools
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))

from production_migration_guard import (  # noqa: E402
    HARD_BLOCKED,
    BUNDLE_20260804,
    FR_HELD_20260803,
    FR_REMOVAL_VERSIONS,
    GuardError,
    assert_bounded,
    created_objects,
    local_migrations,
    parse_allowlist,
    parse_remote_versions,
    preflight_batch,
    prepare,
    validate_candidates,
    verify_dry_run,
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
    def test_bad_allowlists_are_blocked(self) -> None:
        values = [
            "",
            "20260727",
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

    def test_the_block_list_is_exactly_these_three(self) -> None:
        # Two kinds, deliberately together. 20260726190000/20260726200000 are the
        # already-applied Master Data pair. 20260729120000 is the third kind:
        # never applied, and applying it would REGRESS a live production security
        # control (see the guard's own comment and
        # docs/verification/production-apply-set-and-rehearsal-20260809.md).
        self.assertEqual(
            HARD_BLOCKED,
            {"20260726190000", "20260726200000", "20260729120000"},
        )

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

    def test_the_fr_held_pair_is_refused_while_no_removal_migration_exists(self) -> None:
        # AGENTS.md 6.5 (OWNER RULING 2026-08-03). This is the live state as of
        # 2026-08-09: FR_REMOVAL_VERSIONS is empty because no removal migration
        # exists, so EVERY allowlist touching either held version must ERROR.
        self.assertEqual(FR_REMOVAL_VERSIONS, set())
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
        self.assertIn("20260802170000", message)
        self.assertIn("20260802171000", message)
        # An allowlist with neither held version still parses, so the rule is
        # targeted and not a blanket refusal.
        parse_allowlist(",".join(BATCH_18))

    def test_the_fr_ship_set_must_be_complete_once_removal_migrations_exist(self) -> None:
        # The future legal event: the two held versions promoted together WITH
        # the FR removal work, in one bounded apply. Simulate registration of
        # two removal versions and prove the co-presence rule both ACCEPTS the
        # complete set and REJECTS every proper subset that still holds one of
        # the two 6.5 versions.
        removal = {"20260810010000", "20260810020000"}
        full = sorted(FR_HELD_20260803 | removal)
        with patch("production_migration_guard.FR_REMOVAL_VERSIONS", removal):
            self.assertEqual(parse_allowlist(",".join(full)), full)
            for size in range(1, len(full)):
                for subset in itertools.combinations(full, size):
                    if not (FR_HELD_20260803 & set(subset)):
                        # Not a 6.5 allowlist at all; nothing to enforce.
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

    def test_general_workflow_has_no_production_apply(self) -> None:
        workflow = (
            Path(__file__).resolve().parents[1]
            / ".github"
            / "workflows"
            / "shared-supabase-migrations.yml"
        ).read_text(encoding="utf-8")
        production = workflow.split("production-dry-run:", 1)[1]
        self.assertIn("Refuse production apply", production)
        self.assertNotIn("supabase db push\n", production)

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
        production = workflow.split("production-dry-run:", 1)[1]

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
        # Nothing whatsoever may run between the re-check and the push.
        self.assertEqual(push, check + 1, commands)

        cds = [i for i, c in enumerate(commands) if c.startswith("cd ")]
        self.assertEqual(cds, [0], commands)
        self.assertEqual(commands[0], 'cd "$RUNNER_TEMP/bounded-production"')

        # Every other job -- including the real `preview` apply -- must never
        # carry the flag at all.
        other_jobs = workflow.split("production-dry-run:", 1)[0]
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


if __name__ == "__main__":
    unittest.main()
