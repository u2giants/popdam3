#!/usr/bin/env python3
"""Offline tests for automatic production promotion (popcre/ai-devops #2075).

Covers rule 8.6: a blocking review-finding issue holds a change out of
production (open, or closed as not planned within 24 hours), a fixed close
releases it, the preview rehearsal job runs for every promoted change and
cannot be skipped, and no owner-override path remains.
"""
from __future__ import annotations

import re
import json
import hashlib
import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import review_finding_hold as hold  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
WORKFLOW = ROOT / ".github/workflows/shared-supabase-migrations.yml"
TRIGGER = ROOT / ".github/workflows/automatic-production-trigger.yml"
REPO = "popcre/shared-db"
NOW = datetime(2026, 10, 30, 12, 0, 0, tzinfo=timezone.utc)


def issue(number, state="open", reason=None, closed=None, pr=5100):
    return {
        "number": number, "state": state, "state_reason": reason, "closed_at": closed,
        "html_url": f"https://github.com/{REPO}/issues/{number}",
        "body": f"PR: https://github.com/{REPO}/pull/{pr}\nHead SHA: `abc`\n",
    }


def run(issues, pr=5100):
    return hold.main(["--pr", str(pr), "--repo", REPO], fetch=lambda _repo, _pr: issues, now=NOW)


def job_block(text: str, job: str) -> str:
    match = re.search(rf"^  {re.escape(job)}:\n(.*?)(?=^  [a-z][a-z0-9-]*:\n|\Z)", text, re.S | re.M)
    if not match:
        raise AssertionError(f"job {job} not found")
    return match.group(1)


class HoldRule(unittest.TestCase):
    def test_open_finding_holds(self):
        self.assertEqual(run([issue(1)]), 3)

    def test_closed_not_planned_within_24_hours_holds(self):
        self.assertEqual(run([issue(2, "closed", "not_planned", "2026-10-29T13:00:00Z")]), 3)

    def test_closed_not_planned_after_24_hours_releases(self):
        self.assertEqual(run([issue(3, "closed", "not_planned", "2026-10-29T11:59:00Z")]), 0)

    def test_fixed_close_releases(self):
        self.assertEqual(run([issue(4, "closed", "completed", "2026-10-30T11:00:00Z")]), 0)

    def test_other_pr_does_not_hold(self):
        self.assertEqual(run([issue(5, pr=51000), issue(6, pr=510)]), 0)

    def test_query_failure_is_not_clear(self):
        def broken(_repo, _pr):
            raise OSError("network")
        self.assertEqual(hold.main(["--pr", "1", "--repo", REPO], fetch=broken, now=NOW), 2)


class ListingLag(unittest.TestCase):
    def test_finding_missing_from_label_listing_is_found_on_the_pr_timeline(self):
        open_issue = issue(9)
        open_issue["labels"] = [{"name": "review-finding"}]
        timeline = [{"event": "cross-referenced", "source": {"issue": open_issue}},
                     {"event": "cross-referenced", "source": {"issue": {**issue(10), "labels": []}}}]
        def api(endpoint):
            return timeline if "/timeline" in endpoint else []
        sources = (lambda r, p: hold.labelled_issues(r, p, api), lambda r, p: hold.cross_referenced_issues(r, p, api))
        found = hold.gh_issues(REPO, 5100, sources=sources, sleep=lambda _s: None)
        self.assertEqual(hold.holds(found, REPO, 5100, NOW)[0]["number"], 9)
        self.assertNotIn(10, [i["number"] for i in hold.holds(found, REPO, 5100, NOW)])

    def test_second_read_after_settle_catches_a_late_finding(self):
        calls = []
        def late(_r, _p):
            calls.append(1)
            return [issue(11)] if len(calls) > 1 else []
        slept = []
        found = hold.gh_issues(REPO, 5100, sources=(late,), settle=20, sleep=slept.append)
        self.assertEqual(slept, [20])
        self.assertEqual(hold.holds(found, REPO, 5100, NOW)[0]["number"], 11)

    def test_a_blocking_read_wins_over_a_later_clear_read(self):
        stale_open, closed = issue(12), issue(12, "closed", "completed", "2026-10-30T11:00:00Z")
        self.assertTrue(hold.holds([closed, stale_open], REPO, 5100, NOW))


class InvalidEvidence(unittest.TestCase):
    def setUp(self):
        self.item = issue(20, "closed", "not_planned", "2026-10-30T11:00:00Z")
        self.item["labels"] = [{"name": "review-finding"}, {"name": "fixer-invalid"}]
        self.item["body"] = f"PR: https://github.com/{REPO}/pull/5100\nHead SHA: `{'a' * 40}`\n"
        self.proof = {"repository": REPO, "issue": 20, "source_pr": 5100, "reviewed_head": "a" * 40,
                      "target_branch": "owner-work", "target_head": "a" * 40, "owner": "u2giants",
                      "evidence": "The guard already rejects this input; focused test passed.",
                      "run_id": "123", "run_attempt": "1", "run_url": f"https://github.com/{REPO}/actions/runs/123",
                      "job_name": "review-fixer-" + hashlib.sha256(b"owner-work").hexdigest()}
        self.comment = {"user": {"login": "github-actions[bot]", "type": "Bot"},
                        "created_at": "2026-10-30T10:59:00Z", "updated_at": "2026-10-30T10:59:00Z"}
        self.detail = {"id": 123, "run_attempt": 1, "html_url": self.proof["run_url"], "repository": {"full_name": REPO},
                       "path": ".github/workflows/review-fixer.yml", "status": "completed", "conclusion": "success",
                       "run_started_at": "2026-10-30T10:50:00Z", "updated_at": "2026-10-30T11:01:00Z"}
        self.job = {"name": "fix / " + self.proof["job_name"], "run_id": 123, "run_attempt": 1,
                    "status": "completed", "conclusion": "success", "started_at": "2026-10-30T10:50:00Z",
                    "completed_at": "2026-10-30T11:01:00Z"}
        self.jobs = [self.job]
        self.calls = []

    def verify(self):
        self.comment["body"] = "<!-- review-fixer-invalid:v1 " + json.dumps(self.proof) + " -->"
        def comments(endpoint):
            self.calls.append(endpoint)
            return [self.comment]
        def run_detail(endpoint):
            self.calls.append(endpoint)
            return self.detail
        def jobs(endpoint):
            self.calls.append(endpoint)
            return self.jobs
        return hold.verified_invalid(self.item, REPO, 5100, comments, run_detail, jobs)

    def test_evidenced_invalid_has_no_24_hour_hold(self):
        self.assertTrue(self.verify())
        self.assertFalse(hold.holds([self.item], REPO, 5100, NOW, lambda _i: self.verify()))

    def test_label_alone_never_exempts(self):
        self.assertFalse(hold.verified_invalid(self.item, REPO, 5100, lambda _e: [], lambda _e: self.fail("unexpected run read")))

    def test_open_or_unlabelled_invalid_is_never_exempt(self):
        for changes in ({"state": "open"}, {"state_reason": "completed"}, {"labels": []}):
            with self.subTest(changes=changes):
                saved = self.item.copy()
                self.item.update(changes)
                self.assertFalse(self.verify())
                self.assertFalse(self.calls)
                self.item = saved

    def test_wrong_source_issue_repo_head_and_empty_evidence_are_refused(self):
        for key, value in (("repository", "other/repo"), ("issue", 21), ("source_pr", 5101),
                           ("reviewed_head", "b" * 40), ("evidence", " "), ("target_head", "bad"),
                           ("run_id", "../bad"), ("run_url", "https://example.com/123")):
            with self.subTest(key=key):
                old = self.proof[key]
                self.proof[key] = value
                self.assertFalse(self.verify())
                self.proof[key] = old

    def test_nonbot_comment_cannot_create_an_exemption(self):
        self.comment["user"] = {"login": "u2giants", "type": "User"}
        self.assertFalse(self.verify())

    def test_wrong_attempt_or_other_workflow_run_is_refused(self):
        for changes in ({"id": 124}, {"repository": {"full_name": "other/repo"}},
                        {"path": ".github/workflows/other.yml"}, {"run_attempt": 2},
                        {"html_url": "https://example.com/123"}):
            with self.subTest(changes=changes):
                old = self.detail.copy()
                self.detail.update(changes)
                self.assertFalse(self.verify())
                self.detail = old

    def test_successful_target_job_exempts_despite_unrelated_branch_failure(self):
        self.detail.update(status="completed", conclusion="failure")
        self.jobs.append({**self.job, "name": "fix / review-fixer-other", "conclusion": "failure"})
        self.assertTrue(self.verify())
        self.detail.update(status="in_progress", conclusion=None)
        self.assertTrue(self.verify())

    def test_only_exact_completed_successful_target_job_exempts(self):
        for changes in ({"status": "in_progress"}, {"conclusion": "failure"}, {"conclusion": "cancelled"},
                        {"run_attempt": 2}, {"run_id": 124}, {"completed_at": None},
                        {"name": "x" + self.proof["job_name"]}, {"name": self.proof["job_name"] + "-other"}):
            with self.subTest(changes=changes):
                old = self.job.copy()
                self.job.update(changes)
                self.assertFalse(self.verify())
                self.job.clear()
                self.job.update(old)
        self.jobs.append(self.job.copy())
        self.assertFalse(self.verify())
        self.jobs.clear()
        self.assertFalse(self.verify())

    def test_bare_job_name_is_valid_and_marker_job_cannot_target_another_branch(self):
        self.job["name"] = self.proof["job_name"]
        self.assertTrue(self.verify())
        self.proof["job_name"] = "review-fixer-other"
        self.assertFalse(self.verify())

    def test_late_replayed_or_missing_time_is_refused(self):
        for changes in ({"created_at": "2026-10-30T10:49:00Z"},
                        {"updated_at": "2026-10-30T11:02:00Z"}, {"created_at": None}):
            with self.subTest(changes=changes):
                old = self.comment.copy()
                self.comment.update(changes)
                self.assertFalse(self.verify())
                self.comment = old

    def test_unreadable_proof_retains_hold(self):
        def broken(_e):
            raise OSError("network")
        self.assertFalse(hold.verified_invalid(self.item, REPO, 5100, broken))

    def test_duplicate_snapshots_reuse_candidate_proof(self):
        calls = []
        def verify(*_args):
            calls.append(1)
            return True
        self.assertEqual(hold.main(["--pr", "5100", "--repo", REPO],
                                  fetch=lambda _r, _p: [self.item, self.item.copy()], now=NOW, verify_invalid=verify), 0)
        self.assertEqual(calls, [1])

    def test_referenced_run_and_candidate_comments_are_cached(self):
        self.comment["body"] = "<!-- review-fixer-invalid:v1 " + json.dumps(self.proof) + " -->"
        comments, runs, jobs = [], [], []
        def read_comments(endpoint):
            comments.append(endpoint)
            return [self.comment]
        def read_run(endpoint):
            runs.append(endpoint)
            return self.detail
        def read_jobs(endpoint):
            jobs.append(endpoint)
            return self.jobs
        verify = hold.invalid_verifier(read_comments, read_run, read_jobs)
        self.assertTrue(verify(self.item, REPO, 5100))
        self.assertTrue(verify(self.item.copy(), REPO, 5100))
        self.assertEqual(len(comments), 1)
        self.assertEqual(len(runs), 1)
        self.assertEqual(len(jobs), 1)
        self.assertIn('/attempts/1/jobs?', jobs[0])

    def test_stale_open_snapshot_still_holds_even_with_valid_closed_snapshot(self):
        self.assertEqual(hold.main(["--pr", "5100", "--repo", REPO],
                                  fetch=lambda _r, _p: [self.item, {**self.item, "state": "open"}],
                                  now=NOW, verify_invalid=lambda *_a: True), 3)

    def test_no_evidence_calls_for_unlabelled_findings(self):
        self.assertEqual(hold.main(["--pr", "5100", "--repo", REPO], fetch=lambda _r, _p: [issue(1)],
                                  now=NOW, verify_invalid=lambda *_a: self.fail("unexpected evidence read")), 3)


class WorkflowShape(unittest.TestCase):
    text = WORKFLOW.read_text(encoding="utf-8")

    def test_no_owner_override_path(self):
        self.assertNotIn("OWNER-OVERRIDE", self.text)
        self.assertNotIn("OWNER OVERRIDE", self.text)

    def test_promotion_needs_preview_and_cannot_skip_it(self):
        block = job_block(self.text, "automatic-production-promotion")
        self.assertRegex(block, r"needs: \[validate, preview\]")
        # always()/failure() would let the job run after a skipped or failed preview.
        self.assertNotRegex(block.split("steps:")[0], r"always\(\)|failure\(\)|cancelled\(\)")
        self.assertIn("inputs.mode == 'apply'", block.split("steps:")[0])
        self.assertIn("preview-migration-apply-", block)

    def test_promotion_checks_hold_before_dispatch(self):
        block = job_block(self.text, "automatic-production-promotion")
        self.assertLess(block.index("review_finding_hold.py"), block.index("/dispatches"))

    def test_apply_checks_hold_immediately_before_apply(self):
        block = job_block(self.text, "production-apply")
        self.assertLess(block.index("review_finding_hold.py"), block.index("- name: Fresh dry-run, then apply"))
        self.assertGreater(block.index("review_finding_hold.py"), block.index("- name: Build bounded checkout"))

    def test_trigger_runs_on_push_and_hourly_and_dispatches_preview_apply(self):
        text = TRIGGER.read_text(encoding="utf-8")
        self.assertIn("push:", text)
        self.assertIn("supabase/migrations/**", text)
        self.assertRegex(text, r"cron: '\d+ \* \* \* \*'")
        self.assertIn("automatic_promotion_candidates.py", text)


if __name__ == "__main__":
    unittest.main()


class TriggerDecision(unittest.TestCase):
    import automatic_promotion_candidates as cand  # noqa: E402

    pr = {"number": 5100, "merged_at": "2026-10-30T01:00:00Z", "versions": ["20261030010000"]}

    def run_(self, runs, held=False):
        return self.cand.decide([self.pr], runs, lambda _n: held)

    def test_dispatches_unpromoted_pr(self):
        self.assertEqual(self.run_([])[0], "dispatch")

    def test_held_pr_is_not_dispatched(self):
        action, _pr, reason = self.run_([], held=True)
        self.assertEqual(action, "wait")
        self.assertIn("review finding", reason)

    def test_promoted_pr_is_skipped(self):
        runs = [{"status": "completed", "conclusion": "success",
                 "display_title": "DB production apply abc PR5100 20261030010000"}]
        self.assertEqual(self.run_(runs)[0], "idle")

    def test_waits_while_a_run_is_in_flight(self):
        self.assertEqual(self.run_([{"status": "in_progress"}])[0], "wait")

    def test_stops_after_three_failed_attempts(self):
        runs = [{"status": "completed", "conclusion": "failure", "created_at": "2026-10-30T02:00:00Z",
                 "display_title": "DB preview apply abc PR5100 20261030010000"}] * 3
        self.assertIn("ENGINEER ACTION REQUIRED", self.run_(runs)[2])
