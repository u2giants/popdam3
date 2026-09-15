import re
import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from shared_db_live_proof import LiveProofError, build_proof  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
SHA = "c" * 40
ASSERTION = "a Data API request as anon is refused"


def issue(number=2848, return_to="u2giants/shared-db", assertion=ASSERTION, work_type="structural"):
    lines = ["```db-work-scope", f"work_type: {work_type}", f"application_return_to: {return_to}"]
    if assertion is not None:
        lines.append(f"live_assertion: {assertion}")
    lines.append("```")
    return {"number": number, "body": "\n".join(lines)}


def run(**overrides):
    args = dict(issue=issue(), work_issue=2848, probe_sql="select true as passed", commit_sha=SHA,
                query=lambda sql: [{"passed": True}], now=datetime(2026, 9, 14, 18, 0, 0, tzinfo=timezone.utc))
    args.update(overrides)
    return build_proof(**args)


class BuildProofTests(unittest.TestCase):
    def test_passing_probe_produces_the_exact_proof_shape(self):
        self.assertEqual(run(), {
            "schema_version": 1, "work_issue": 2848, "application_commit_sha": SHA,
            "live_assertion": ASSERTION, "environment": "production", "result": "passed",
            "observed_at": "2026-09-14T18:00:00Z",
        })

    def test_refusals(self):
        cases = {
            "false probe": dict(query=lambda sql: [{"passed": False}]),
            "no rows": dict(query=lambda sql: []),
            "two rows": dict(query=lambda sql: [{"passed": True}, {"passed": True}]),
            "string true": dict(query=lambda sql: [{"passed": "true"}]),
            "extra column": dict(query=lambda sql: [{"passed": True, "x": 1}]),
            "other application": dict(issue=issue(return_to="u2giants/popdam3")),
            "no assertion": dict(issue=issue(assertion=None)),
            "not structural": dict(issue=issue(work_type="repo-maintenance")),
            "wrong issue payload": dict(issue=issue(number=1)),
            "bad sha": dict(commit_sha="C" * 40),
            "empty probe": dict(probe_sql="  "),
            "two scope blocks": dict(issue={"number": 2848, "body": issue()["body"] * 2}),
        }
        for name, override in cases.items():
            with self.subTest(name), self.assertRaises(LiveProofError):
                run(**override)

    def test_refusal_never_queries_before_scope_checks(self):
        calls = []
        with self.assertRaises(LiveProofError):
            run(issue=issue(return_to="u2giants/popdam3"), query=lambda sql: calls.append(sql))
        self.assertEqual(calls, [])


class WorkflowShapeTests(unittest.TestCase):
    def setUp(self):
        self.text = (ROOT / ".github/workflows/shared-db-live-proof.yml").read_text(encoding="utf-8")

    def test_artifact_name_matches_what_complete_outcome_re_derives(self):
        self.assertIn("name: shared-db-live-proof-${{ inputs.work_issue }}-${{ github.sha }}", self.text)
        self.assertIn("db-live-proof.json", self.text)
        lane = (ROOT / "scripts/manage-migration-author-lanes.mjs").read_text(encoding="utf-8")
        self.assertIn("shared-db-live-proof-${evidence.work_issue}-", lane)
        self.assertIn("'db-live-proof.json'", lane)

    def test_dispatch_only_read_only_and_main_only(self):
        self.assertRegex(self.text, r"on:\s*\n\s*workflow_dispatch:")
        self.assertNotRegex(self.text, r"\b(push|pull_request|schedule):")
        self.assertIn("contents: read", self.text)
        self.assertNotRegex(self.text, r":\s*write\b")
        self.assertIn('test "$GITHUB_REF" = refs/heads/main', self.text)
        self.assertIsNone(re.search(r"\bgh api\b", self.text))

    def test_every_committed_probe_is_a_single_statement(self):
        for probe in (ROOT / ".github/live-proofs").glob("*.sql"):
            body = "\n".join(l for l in probe.read_text(encoding="utf-8").splitlines() if not l.strip().startswith("--"))
            with self.subTest(probe.name):
                self.assertEqual(body.strip().rstrip(";").count(";"), 0)
                self.assertRegex(body, r"\bas passed\b")


if __name__ == "__main__":
    unittest.main()
