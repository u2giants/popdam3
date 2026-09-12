"""The production apply review must refuse a missing source_pr BY NAME, before any
credential is used, whenever the automatic risk policy is active (#2789).

Runs the step's real script, extracted from the workflow file, so the test cannot
drift from what CI executes."""
import json
import os
import shutil
import subprocess
import tempfile
import textwrap
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WORKFLOW = ROOT / ".github" / "workflows" / "shared-supabase-migrations.yml"
STEP = "      - name: Refuse a missing automatic-policy source PR before credentials"


def review_job_lines():
    lines = WORKFLOW.read_text(encoding="utf-8").splitlines()
    start = lines.index("  production-apply-review:")
    end = next(
        i for i in range(start + 1, len(lines))
        if lines[i].startswith("  ") and not lines[i].startswith("   ") and lines[i].rstrip().endswith(":")
    )
    return lines[start:end]


def step_script(job):
    at = job.index(STEP)
    run = next(i for i in range(at, len(job)) if job[i].strip() == "run: |")
    body = []
    for line in job[run + 1:]:
        if line.strip() and not line.startswith("          "):
            break
        body.append(line)
    return textwrap.dedent("\n".join(body)) + "\n"


class SourcePrPreflightTest(unittest.TestCase):
    def setUp(self):
        self.job = review_job_lines()
        self.script = step_script(self.job)
        self.bash = shutil.which("bash")
        if not self.bash or not shutil.which("jq"):
            self.fail("bash and jq are required to run the workflow step")

    def run_step(self, activation, source_pr):
        with tempfile.TemporaryDirectory() as temp:
            (Path(temp) / "config").mkdir()
            (Path(temp) / "config" / "production-risk-policy-activation.json").write_text(activation)
            (Path(temp) / "step.sh").write_text(self.script, newline="\n")
            return subprocess.run(
                [self.bash, "step.sh"], cwd=temp, capture_output=True, text=True,
                env={"SOURCE_PR": source_pr, "PATH": os.environ["PATH"]},
            )

    def test_runs_after_exact_commit_check_and_before_any_credential(self):
        at = self.job.index(STEP)
        self.assertLess(self.job.index("      - name: Verify exact main commit"), at)
        credential = next(i for i, line in enumerate(self.job) if "secrets." in line)
        self.assertLess(at, credential)

    def test_active_policy_refuses_missing_or_malformed_source_pr_by_name(self):
        for value in ("", " ", "0", "abc", "12 ", "#2771", "-5"):
            with self.subTest(source_pr=value):
                result = self.run_step(json.dumps({"active": True}), value)
                self.assertEqual(result.returncode, 1, result.stderr)
                self.assertIn("REFUSED", result.stdout)
                self.assertIn("source_pr", result.stdout)

    def test_active_policy_accepts_a_pr_number(self):
        result = self.run_step(json.dumps({"active": True}), "2771")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_inactive_policy_does_not_require_source_pr(self):
        result = self.run_step(json.dumps({"active": False}), "")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_non_boolean_activation_fails_closed(self):
        result = self.run_step('{"active": "yes"}', "2771")
        self.assertNotEqual(result.returncode, 0)


if __name__ == "__main__":
    unittest.main()
