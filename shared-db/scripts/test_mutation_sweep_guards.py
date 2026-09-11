import tempfile
import unittest
import sys
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).parent))
import mutation_sweep_guards as sweep


class MutationSweepSafetyTests(unittest.TestCase):
    def test_checkpoint_rejects_changed_source_identity(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary, "checkpoint.json")
            expected = sweep.checkpoint_metadata(["guard.py"], ["python", "tests.py"], {"guard.py": "old"}, 2)
            sweep.save_checkpoint(path, expected, {"guard.py:1": {"id": "guard.py:1", "ordinal": 1}})
            changed = sweep.checkpoint_metadata(["guard.py"], ["python", "tests.py"], {"guard.py": "new"}, 2)
            with self.assertRaisesRegex(ValueError, "checkpoint does not match"):
                sweep.load_checkpoint(path, changed)

    def test_checkpoint_rejects_changed_test_suite_identity(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary, "checkpoint.json")
            expected = sweep.checkpoint_metadata(["guard.py"], ["python", "tests.py"],
                                                 {"guard.py": "same"}, 2, {"tests.py": "old"})
            sweep.save_checkpoint(path, expected, {"guard.py:1": {"id": "guard.py:1", "ordinal": 1}})
            changed = sweep.checkpoint_metadata(["guard.py"], ["python", "tests.py"],
                                                {"guard.py": "same"}, 2, {"tests.py": "new"})
            with self.assertRaisesRegex(ValueError, "checkpoint does not match"):
                sweep.load_checkpoint(path, changed)

    def test_checkpoint_rejects_duplicate_results_before_merge(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary, "checkpoint.json")
            metadata = sweep.checkpoint_metadata(["guard.py"], ["test"], {"guard.py": "digest"}, 1)
            sweep.atomic_json(path, {**metadata, "results": [
                {"id": "guard.py:1", "ordinal": 1}, {"id": "guard.py:1", "ordinal": 1}
            ]})
            with self.assertRaisesRegex(ValueError, "duplicate"):
                sweep.load_checkpoint(path, metadata)

    def test_worker_uses_isolated_copy_and_restores_mutation(self):
        with tempfile.TemporaryDirectory() as temporary:
            repo = Path(temporary, "source")
            repo.mkdir()
            source = repo / "guard.py"
            source.write_text("if enabled:\n    raise RuntimeError()\n", encoding="utf-8")
            _text, found = sweep.guards(source)
            guard = {"id": "guard.py:1", "ordinal": 1, "file": "guard.py", "position": 1, **found[0]}
            checkpoint = Path(temporary, "worker.json")
            metadata = sweep.checkpoint_metadata(["guard.py"], ["fake-test"], {"guard.py": sweep.digest(source)}, 1)
            calls = []
            def fake_suite(_command, isolated, _timeout):
                calls.append(isolated)
                self.assertNotEqual(isolated.resolve(), repo.resolve())
                expected = "if enabled:" if len(calls) == 1 else "if False:"
                self.assertIn(expected, (isolated / "guard.py").read_text(encoding="utf-8"))
                return True, ""
            with mock.patch.object(sweep, "run_suite", side_effect=fake_suite):
                results = sweep.worker_run({"repo": str(repo), "worker": 0, "guards": [guard],
                    "checkpoint": str(checkpoint), "metadata": metadata, "deadline": float("inf")})
            self.assertTrue(results[0]["survived"])
            self.assertEqual(len(calls), 2)
            self.assertEqual(source.read_text(encoding="utf-8"), "if enabled:\n    raise RuntimeError()\n")

    def test_worker_resumes_without_repeating_completed_guard(self):
        with tempfile.TemporaryDirectory() as temporary:
            repo = Path(temporary, "source")
            repo.mkdir()
            source = repo / "guard.py"
            source.write_text("if one:\n    raise RuntimeError()\nif two:\n    raise RuntimeError()\n", encoding="utf-8")
            _text, found = sweep.guards(source)
            guards = [{"id": f"guard.py:{index}", "ordinal": index, "file": "guard.py", "position": index, **row}
                      for index, row in enumerate(found, start=1)]
            metadata = sweep.checkpoint_metadata(["guard.py"], ["fake-test"], {"guard.py": sweep.digest(source)}, 1)
            checkpoint = Path(temporary, "worker.json")
            prior = {"id": guards[0]["id"], "ordinal": 1, "file": "guard.py", "line": 1,
                     "test": "one", "survived": False, "seconds": 0.1, "failure_tail": "caught"}
            sweep.save_checkpoint(checkpoint, metadata, {prior["id"]: prior})
            with mock.patch.object(sweep, "run_suite", side_effect=[(True, ""), (False, "caught")]) as run:
                results = sweep.worker_run({"repo": str(repo), "worker": 0, "guards": guards,
                    "checkpoint": str(checkpoint), "metadata": metadata, "deadline": float("inf")})
            self.assertEqual(run.call_count, 2)
            self.assertEqual({row["id"] for row in results}, {row["id"] for row in guards})

    def test_final_red_baseline_writes_no_report(self):
        with tempfile.TemporaryDirectory() as temporary:
            repo = Path(temporary)
            scripts = repo / "scripts"
            scripts.mkdir()
            target = scripts / "guard.py"
            target.write_text("if enabled:\n    raise RuntimeError()\n", encoding="utf-8")
            fake_script = scripts / "mutation_sweep_guards.py"
            fake_script.write_text("", encoding="utf-8")
            args = ["--file", "scripts/guard.py", "--command", "fake-test", "--out", "report.json",
                    "--workers", "1", "--max-seconds", "1"]
            result = {"id": "scripts/guard.py:1", "ordinal": 1, "file": "scripts/guard.py", "line": 1,
                      "test": "enabled", "survived": True, "seconds": 0.1, "failure_tail": ""}
            with mock.patch.object(sweep, "__file__", str(fake_script)), \
                 mock.patch.object(sweep, "run_suite", side_effect=[(True, ""), (False, "final red")]), \
                 mock.patch.object(sweep.concurrent.futures, "ProcessPoolExecutor") as pool:
                future = mock.Mock()
                future.result.return_value = [result]
                pool.return_value.__enter__.return_value.submit.return_value = future
                with mock.patch.object(sweep.concurrent.futures, "as_completed", return_value=[future]):
                    self.assertEqual(sweep.main(args), 2)
            self.assertFalse((repo / "report.json").exists())

    def test_incomplete_run_removes_stale_report(self):
        with tempfile.TemporaryDirectory() as temporary:
            repo = Path(temporary)
            scripts = repo / "scripts"
            scripts.mkdir()
            (scripts / "guard.py").write_text("if enabled:\n    raise RuntimeError()\n", encoding="utf-8")
            fake_script = scripts / "mutation_sweep_guards.py"
            fake_script.write_text("", encoding="utf-8")
            output = repo / "report.json"
            output.write_text("stale", encoding="utf-8")
            args = ["--file", "scripts/guard.py", "--command", "fake-test", "--out", "report.json",
                    "--workers", "1", "--max-seconds", "1"]
            with mock.patch.object(sweep, "__file__", str(fake_script)), \
                 mock.patch.object(sweep, "run_suite", return_value=(True, "")), \
                 mock.patch.object(sweep.concurrent.futures, "ProcessPoolExecutor") as pool:
                future = mock.Mock()
                future.result.return_value = []
                pool.return_value.__enter__.return_value.submit.return_value = future
                with mock.patch.object(sweep.concurrent.futures, "as_completed", return_value=[future]):
                    self.assertEqual(sweep.main(args), 3)
            self.assertFalse(output.exists())

    def test_crlf_later_line_mutation_replaces_the_guard_and_stays_valid(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary, "guard.py")
            path.write_bytes(b"value = 'keep'\r\nif enabled:\r\n    raise RuntimeError()\r\n")
            text, found = sweep.guards(path)
            guard = {"id": "guard.py:1", **found[0]}
            mutated = sweep.mutate(text, guard)
            self.assertIn("\r\nif False:\r\n", mutated)
            self.assertIn("value = 'keep'", mutated)

    def test_non_ascii_before_guard_end_uses_ast_byte_columns_safely(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary, "guard.py")
            path.write_bytes("if label == 'café':\n    raise RuntimeError()\n".encode("utf-8"))
            text, found = sweep.guards(path)
            mutated = sweep.mutate(text, {"id": "guard.py:1", **found[0]})
            self.assertEqual(mutated, "if False:\n    raise RuntimeError()\n")

    def test_run_suite_enforces_timeout_and_replaces_bad_output_bytes(self):
        completed = mock.Mock(returncode=0, stdout="ok", stderr="")
        with mock.patch.object(sweep.subprocess, "run", return_value=completed) as run:
            self.assertEqual(sweep.run_suite(["test"], Path("."), 12.5), (True, "ok"))
        self.assertEqual(run.call_args.kwargs["timeout"], 12.5)
        self.assertEqual(run.call_args.kwargs["encoding"], "utf-8")
        self.assertEqual(run.call_args.kwargs["errors"], "replace")

    def test_run_suite_timeout_is_not_classified_as_a_caught_guard(self):
        with mock.patch.object(sweep.subprocess, "run", side_effect=sweep.subprocess.TimeoutExpired("test", 1)):
            with self.assertRaisesRegex(TimeoutError, "exceeded"):
                sweep.run_suite(["test"], Path("."), 1)

    def test_entry_point_raise_is_not_a_refusal_guard(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary, "guard.py")
            path.write_text("if __name__ == '__main__':\n    raise SystemExit(main())\n", encoding="utf-8")
            _text, found = sweep.guards(path)
            self.assertEqual(found, [])


if __name__ == "__main__":
    unittest.main()
