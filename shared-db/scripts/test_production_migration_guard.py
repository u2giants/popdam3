#!/usr/bin/env python3

from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))

from production_migration_guard import (  # noqa: E402
    GuardError,
    parse_allowlist,
    parse_remote_versions,
    prepare,
    validate_candidates,
    verify_dry_run,
)


class GuardTests(unittest.TestCase):
    def test_bad_allowlists_are_blocked(self) -> None:
        values = [
            "",
            "20260727",
            "20260727010000,20260727010000",
            "20260727020000,20260727010000",
            "20260726030000",
            "20260726031000",
            "20260726032000",
            "20260726180000",
            "20260726190000",
            "20260726200000",
        ]
        for value in values:
            with self.subTest(value=value), self.assertRaises(GuardError):
                parse_allowlist(value)

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
        self.assertNotIn("--include-all", production)

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


if __name__ == "__main__":
    unittest.main()
