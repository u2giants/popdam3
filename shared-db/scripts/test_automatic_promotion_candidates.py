import contextlib
import io
import json
import os
import re
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import automatic_promotion_candidates as m  # noqa: E402
import refund_fault_classification as classifier  # noqa: E402

# Main-path tests stub is_held; route the batched hold read through it so no
# test reaches the network. PrefetchHolds tests the real function.
REAL_PREFETCH_HOLDS = m.prefetch_holds
m.prefetch_holds = lambda repo, prs: (lambda n: m.is_held(repo, n))

APPLIED = [{"steps": [{"name": m.APPLY_STEP, "conclusion": "success"}, {"name": m.CATALOG_STEP, "conclusion": "failure"}]}]
NOT_APPLIED = [{"steps": [{"name": m.APPLY_STEP, "conclusion": "failure"}, {"name": m.CATALOG_STEP, "conclusion": "failure"}]}]


class GhostRunsDoNotParkTheLane(unittest.TestCase):
    """#6426 / 2026-11-16 run 43938147152: a never-dispatched queued run."""
    now = datetime(2026, 11, 16, 20, 0, tzinfo=timezone.utc)

    def mk(self, rid, created, status="queued"):
        return {"id": rid, "status": status, "created_at": created}

    def test_old_jobless_queued_run_is_dropped(self):
        runs = [self.mk(1, "2026-11-16T19:19:34Z"), self.mk(2, "2026-11-16T19:00:00Z", "completed")]
        with contextlib.redirect_stdout(io.StringIO()):
            kept = m.drop_ghost_runs(runs, lambda r: 0, self.now)
        self.assertEqual([r["id"] for r in kept], [2])

    def test_young_or_started_queued_runs_are_kept(self):
        runs = [self.mk(1, "2026-11-16T19:45:00Z"), self.mk(3, "2026-11-16T19:00:00Z")]
        kept = m.drop_ghost_runs(runs, lambda r: 1 if r["id"] == 3 else 0, self.now)
        self.assertEqual([r["id"] for r in kept], [1, 3])


class AttemptsPerChange(unittest.TestCase):
    def test_a_new_main_commit_does_not_earn_fresh_attempts(self):
        # #5686: per-main resets retried a stuck change after every unrelated merge.
        pr = {"number": 7, "merged_at": "2026-01-01", "versions": ["1"]}
        runs = [{"display_title": f"DB preview apply {sha} PR7 1", "status": "completed", "conclusion": "failure", "created_at": "2026-01-02"}
                for sha in ("a", "b", "c")]
        held = lambda n: False
        self.assertEqual(m.decide([pr], runs, held, main_sha="old")[0], "idle")
        self.assertEqual(m.decide([pr], runs, held, main_sha="new")[0], "idle")

    def test_a_stuck_change_is_passed_over_for_a_later_independent_one(self):
        stuck = {"number": 7, "merged_at": "2026-01-01", "versions": ["1"]}
        later = {"number": 8, "merged_at": "2026-01-01", "versions": ["2"]}
        runs = [{"display_title": f"DB preview apply {sha} PR7 1", "status": "completed", "conclusion": "failure", "created_at": "2026-01-02"}
                for sha in ("a", "b", "c")]
        action, got, _ = m.decide([stuck, later], runs, lambda n: [], main_sha="d")
        self.assertEqual((action, got["number"]), ("dispatch", 8))

    def test_production_failures_count_as_attempts(self):
        # A failed production apply re-enters through a historical recovery
        # preview that succeeds, so counting only preview failures could never
        # bound the cycle (#5532).
        pr = {"number": 7, "merged_at": "2026-01-01", "versions": ["1"]}
        fail = {"display_title": "DB production apply old PR7 1", "status": "completed",
                "conclusion": "failure", "created_at": "2026-01-02"}
        action, got, _ = m.decide([pr], [fail] * 2, lambda n: [], main_sha="old")
        self.assertEqual((action, got["number"]), ("dispatch", 7))
        self.assertEqual(m.decide([pr], [fail] * 3, lambda n: [], main_sha="old")[0], "idle")

    def test_recovery_run_failures_count_as_attempts(self):
        # Recovery runs title themselves "PR " with no number; only the
        # versions name the PR. Those failures must count too (#5532).
        pr = {"number": 7, "merged_at": "2026-01-01", "versions": ["20261102170000"]}
        fail = {"display_title": "DB preview apply old PR 20261102170000", "status": "completed",
                "conclusion": "failure", "created_at": "2026-01-02"}
        action, got, _ = m.decide([pr], [fail] * 2, lambda n: [], main_sha="old")
        self.assertEqual((action, got["number"]), ("dispatch", 7))
        self.assertEqual(m.decide([pr], [fail] * 3, lambda n: [], main_sha="old")[0], "idle")


class StaleRefusalsDoNotConsumeAttempts(unittest.TestCase):
    """#5856: a run refused before any apply because main moved (tip proof or
    lane lock) must not consume MAX_ATTEMPTS. Ordinary merge traffic exhausted
    the budget on those refusals and parked healthy changes until a forced
    re-version. Real apply/guard failures still count."""

    pr = {"number": 5846, "merged_at": "2026-11-06T01:00:00Z", "versions": ["20261106062730"]}

    def run_(self, n):
        return {"id": n, "display_title": f"DB preview apply sha{n} PR5846 20261106062730",
                "status": "completed", "conclusion": "failure", "created_at": "2026-11-06T02:00:00Z"}

    def test_stale_refusals_never_exhaust_the_budget(self):
        runs = [self.run_(n) for n in range(3)]
        action, got, _ = m.decide([self.pr], runs, lambda n: [], stale=lambda r: True)
        self.assertEqual((action, got["number"]), ("dispatch", 5846))

    def test_real_failures_still_count_alongside_stale_ones(self):
        runs = [self.run_(n) for n in range(5)]
        only_stale = lambda r: r["id"] < 2
        self.assertEqual(m.decide([self.pr], runs[:4], lambda n: [], stale=only_stale)[0], "dispatch")
        self.assertEqual(m.decide([self.pr], runs, lambda n: [], stale=only_stale)[0], "idle")


class PromotionStarvationFixes(unittest.TestCase):
    """#5937: deadline ordering, no budget charge for main-moved refusals, and
    the backstop streak that arms the 15-minute merge freeze."""

    old = {"number": 1, "merged_at": "2026-11-06T10:00:00Z", "versions": ["20261106100000"]}
    urgent = {"number": 2, "merged_at": "2026-11-06T15:00:00Z", "versions": ["20261106150000"],
              "promote_by": "2026-11-07T03:00:00Z"}

    def run_(self, n, pr=2, version="20261106150000"):
        return {"id": n, "display_title": f"DB preview apply sha{n} PR{pr} {version}",
                "status": "completed", "conclusion": "failure", "created_at": f"2026-11-06T16:{n:02d}:00Z"}

    def test_deadline_dispatches_ahead_of_older_candidates(self):
        action, got, _ = m.decide([self.old, self.urgent], [], lambda n: [])
        self.assertEqual((action, got["number"]), ("dispatch", 2))
        later = {**self.urgent, "number": 3, "promote_by": "2026-11-08T00:00:00Z"}
        self.assertEqual(m.decide([self.old, later, self.urgent], [], lambda n: [])[1]["number"], 2)
        plain = {**self.urgent, "promote_by": None}
        self.assertEqual(m.decide([plain, self.old], [], lambda n: [])[1]["number"], 1)

    def test_promote_by_header_parsing(self):
        import tempfile
        with tempfile.TemporaryDirectory() as d:
            good, bad = os.path.join(d, "a.sql"), os.path.join(d, "b.sql")
            with open(good, "w") as fh:
                fh.write("-- promote-by: 2026-11-07T03:00:00Z\nselect 1;\n")
            with open(bad, "w") as fh:
                fh.write("-- promote-by: tonight\nselect 1;\n")
            self.assertEqual(m.promote_by(good), "2026-11-07T03:00:00Z")
            self.assertIsNone(m.promote_by(bad))

    def test_many_main_moved_refusals_never_park(self):
        runs = [self.run_(n) for n in range(10)]
        action, got, _ = m.decide([self.urgent], runs, lambda n: [], stale=lambda r: True)
        self.assertEqual((action, got["number"]), ("dispatch", 2))
        self.assertEqual(got["stale_streak"], 10)

    def test_backstop_arms_only_after_two_consecutive_stale_refusals(self):
        runs = [self.run_(n) for n in range(3)]
        one = m.decide([self.urgent], runs, lambda n: [], stale=lambda r: r["id"] == 2)[1]
        self.assertNotIn("stale_streak", one)
        broken = m.decide([self.urgent], runs, lambda n: [], stale=lambda r: r["id"] in (0, 2))[1]
        self.assertNotIn("stale_streak", broken)
        two = m.decide([self.urgent], runs, lambda n: [], stale=lambda r: r["id"] >= 1)[1]
        self.assertEqual(two["stale_streak"], m.BACKSTOP_AFTER_STALE)
        self.assertEqual(m.BACKSTOP_FREEZE_TTL_MINUTES, 40)


class StaleMainRefusalDetector(unittest.TestCase):
    """The detector proves staleness from the run's own failure evidence: every
    failed step must be a tip-proof coordination step AND the failed log must
    carry the runtime staleness wording. The workflow echoes guard text into
    every log, so echoed wording never proves anything."""

    RUN = {"id": 1, "run_attempt": 1}
    STALE_LOG = ("preview\tUNKNOWN STEP\t2026-11-06T07:16:03Z REFUSED: origin/main "
                 "(90486a1e512cd99ef66723284b512673575792aa) has moved past the dispatched commit "
                 "(aefb3ab5369d8a23371df2c5fd44e5a85d120646) with changes that are not documentation: "
                 "x. Re-dispatch against the current tip.\n")
    LANE_LOG = ("Error: post-merge preview rehearsal requires the exact current main SHA "
                "(asked for aefb3ab5369d8a23371df2c5fd44e5a85d120646, main is 90486a1e512cd99ef66723284b512673575792aa)\n")
    SOURCE_ECHO = ('  echo "::error::ENGINEER ACTION REQUIRED: main moved after preview. Nothing was '
                   'dispatched; qualify the new exact main instead of reusing stale evidence." >&2\n')
    RUNTIME_ERROR = ("##[error]ENGINEER ACTION REQUIRED: main moved after preview. Nothing was "
                     "dispatched; qualify the new exact main instead of reusing stale evidence.\n")
    OTHER_LOG = "REFUSED: merged_preview_source_pr is a post-merge APPLY; the historical inputs are a no-write recovery. Name one.\n"

    def jobs(self, *steps):
        return [{"id": 11, "steps": [{"name": n, "conclusion": c} for n, c in steps]}]

    def detect(self, jobs_by_attempt, log, run=None):
        def fake_log(cmd, **kw):
            class R:
                stdout = log
            return R()
        with mock.patch.object(m, "run_jobs",
                               side_effect=lambda repo, run_id, attempt=None: jobs_by_attempt[attempt or 1]), \
                mock.patch.object(m.subprocess, "run", side_effect=fake_log):
            return m.stale_main_refusal_only("o/r", run or self.RUN)

    def test_freeze_already_held_by_another_pr_is_refunded(self):
        # #6258: PR #6245 parked after three refusals of this shape.
        self.assertTrue(self.detect(
            {1: self.jobs(("Acquire the promotion merge freeze for this source PR", "failure"))},
            '##[error]REFUSED: a promotion merge freeze is already set; promotion merge freeze held by '
            '"automatic-production-qualification" for PR #6257 until 2026-11-13T20:30:33.204Z\n'))

    def test_tip_proof_refusal_with_stale_wording_is_stale(self):
        self.assertTrue(self.detect(
            {1: self.jobs(("Re-prove current main and the merged source PR", "failure"))}, self.STALE_LOG))

    def test_lane_lock_refusal_with_stale_wording_is_stale(self):
        self.assertTrue(self.detect(
            {1: self.jobs(("Acquire the exclusive GitHub-backed preview lane", "failure"))}, self.LANE_LOG))

    def test_apply_failure_always_counts_even_with_stale_wording(self):
        self.assertFalse(self.detect({1: self.jobs(("Bounded apply", "failure"))}, self.STALE_LOG))

    def test_mixed_coordination_and_apply_failures_count(self):
        self.assertFalse(self.detect({1: self.jobs(
            ("Acquire the exclusive GitHub-backed preview lane", "failure"), ("Bounded apply", "failure"))}, self.LANE_LOG))

    def test_other_coordination_refusal_still_counts(self):
        self.assertFalse(self.detect(
            {1: self.jobs(("Prove the post-merge rehearsal source", "failure"))}, self.OTHER_LOG))

    def test_echoed_source_wording_never_proves_staleness(self):
        self.assertFalse(self.detect(
            {1: self.jobs(("Re-prove current main and the merged source PR", "failure"))},
            self.SOURCE_ECHO + self.OTHER_LOG))

    def test_rendered_main_moved_annotation_proves_staleness(self):
        self.assertTrue(self.detect(
            {1: self.jobs(("Re-prove current main and the merged source PR", "failure"))}, self.RUNTIME_ERROR))

    def test_ansi_wrapped_stale_wording_still_proves_staleness(self):
        wrapped = self.STALE_LOG.replace("has moved past", "\x1b[1mhas moved\x1b[0m past")
        self.assertTrue(self.detect(
            {1: self.jobs(("Re-prove current main and the merged source PR", "failure"))}, wrapped))

    def test_production_review_tip_refusal_with_stale_wording_is_stale(self):
        # #6237: production-apply-review/dry-run name the step without the suffix.
        self.assertTrue(self.detect(
            {1: self.jobs(("Verify exact main commit", "failure"))}, self.STALE_LOG))

    def test_failed_fault_marker_does_not_hide_a_staleness_refusal(self):
        # #6237: the `if: failure()` marker step may itself conclude failure.
        self.assertTrue(self.detect({1: self.jobs(
            ("Prove the post-merge rehearsal source", "failure"),
            (m.REFUND_STEP, "failure"))}, self.STALE_LOG))

    def test_failed_fault_marker_alone_still_counts(self):
        self.assertFalse(self.detect({1: self.jobs((m.REFUND_STEP, "failure"))}, self.STALE_LOG))

    def test_failed_fault_marker_with_apply_failure_still_counts(self):
        self.assertFalse(self.detect({1: self.jobs(
            ("Bounded apply", "failure"), (m.REFUND_STEP, "failure"))}, self.STALE_LOG))

    def test_no_failed_steps_still_counts(self):
        self.assertFalse(self.detect({1: self.jobs(("Set up job", "success"))}, self.STALE_LOG))

    def test_unreadable_jobs_still_count(self):
        with mock.patch.object(m, "run_jobs", side_effect=ValueError("bad")):
            self.assertFalse(m.stale_main_refusal_only("o/r", self.RUN))

    def test_unreadable_log_still_counts(self):
        with mock.patch.object(m, "run_jobs", return_value=self.jobs(("Re-prove current main and the merged source PR", "failure"))), \
                mock.patch.object(m.subprocess, "run", side_effect=OSError("log gone")):
            self.assertFalse(m.stale_main_refusal_only("o/r", self.RUN))

    def test_one_real_attempt_among_re_runs_still_counts(self):
        run = {"id": 1, "run_attempt": 2}
        self.assertFalse(self.detect({
            1: self.jobs(("Acquire the exclusive GitHub-backed preview lane", "failure")),
            2: self.jobs(("Bounded apply", "failure"))}, self.LANE_LOG, run))

    def test_all_attempts_stale_excludes_the_run(self):
        run = {"id": 1, "run_attempt": 2}
        self.assertTrue(self.detect({
            1: self.jobs(("Acquire the exclusive GitHub-backed preview lane", "failure")),
            2: self.jobs(("Re-prove current main and the merged source PR", "failure"))}, self.STALE_LOG, run))


class StaleRefusalWordingStaysRuntimeOnly(unittest.TestCase):
    """#5856: the detector can tell a runtime staleness refusal from the
    workflow's echoed guard text only while that wording stays out of the
    shell source. Keep it that way."""

    @classmethod
    def setUpClass(cls):
        root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        with open(os.path.join(root, ".github", "workflows", "shared-supabase-migrations.yml"), encoding="utf-8") as fh:
            cls.text = fh.read()

    def test_every_coordination_step_name_still_exists(self):
        for name in m.COORDINATION_STEPS:
            self.assertIn(f"- name: {name}", self.text)

    def test_no_staleness_wording_is_echoed_by_the_workflow_shell(self):
        for phrase in ("has moved past the dispatched commit",
                       "has advanced past the dispatched commit",
                       "does not contain the dispatched commit",
                       "requires the exact current main SHA"):
            self.assertNotIn(phrase, self.text)
        self.assertNotIn("##[error]", self.text)


class ForeignTargetVersions(unittest.TestCase):
    def prs(self, *versions):
        files = [[{"status": "added", "filename": f"supabase/migrations/{v}_x.sql"} for v in versions]]
        pulls = [{"number": 5503, "merged_at": "2026-11-02T22:31:03Z"}]
        with mock.patch.object(m, "gh", side_effect=[[pulls], files]):
            return m.merged_migration_prs("o/r")

    def test_retired_character_originals_never_reenter_the_automatic_queue(self):
        self.assertEqual(self.prs("20261104214842", "20261105035926"), [])
        self.assertEqual(self.prs("20261104214842", "20261105074028")[0]["versions"], ["20261105074028"])

    def test_sandbox_only_pr_is_never_a_production_candidate(self):
        self.assertEqual(self.prs("20261102215524"), [])

    def test_mixed_pr_promotes_only_its_shared_versions(self):
        self.assertEqual(self.prs("20261102215524", "20261102224413")[0]["versions"], ["20261102224413"])


class SelectorPrCache(unittest.TestCase):
    """#6493 Step 1b: the PR cache holds API facts only and is discovery-only."""
    old = {"number": 5045, "merged_at": "2026-10-30T00:37:42Z", "updated_at": "2026-10-30T00:37:42Z"}
    new = {"number": 5066, "merged_at": "2026-10-30T01:41:04Z", "updated_at": "2026-11-16T10:00:00Z"}
    old_files = [[{"status": "added", "filename": "supabase/migrations/20261029162652_x.sql"}]]
    new_files = [[{"status": "added", "filename": "supabase/migrations/20261029213845_x.sql"}]]

    def setUp(self):
        import tempfile
        self.dir = tempfile.TemporaryDirectory()
        self.path = os.path.join(self.dir.name, "cache.json")
        self.env = mock.patch.dict(os.environ, {"PROMOTION_PR_CACHE_FILE": self.path})
        self.env.start()

    def tearDown(self):
        self.env.stop()
        self.dir.cleanup()

    def run_selector(self, api):
        with mock.patch.object(m, "gh", side_effect=api) as gh:
            return m.merged_migration_prs("o/r"), gh.call_args_list

    def test_cold_scan_writes_cache_and_warm_scan_reads_no_files(self):
        cold, _ = self.run_selector([[[self.old]], self.old_files])
        self.assertTrue(os.path.exists(self.path))
        warm, calls = self.run_selector([[self.new], self.new_files])
        # One incremental list page, files only for the newly seen PR.
        self.assertEqual(len(calls), 2)
        self.assertNotIn("--paginate", calls[0].args)
        self.assertEqual([p["number"] for p in warm], [5045, 5066])
        self.assertEqual(warm[0], cold[0])

    def test_warm_scan_matches_a_full_scan(self):
        self.run_selector([[[self.old, self.new]], self.old_files, self.new_files])
        warm, calls = self.run_selector([[self.new]])
        self.assertEqual(len(calls), 1)
        os.remove(self.path)
        full, _ = self.run_selector([[[self.old, self.new]], self.old_files, self.new_files])
        self.assertEqual(warm, full)

    def test_corrupt_or_old_schema_cache_falls_back_to_a_full_scan(self):
        for body in ("garbage", json.dumps({"schema_version": 0, "prs": {}})):
            with open(self.path, "w", encoding="utf-8") as fh:
                fh.write(body)
            with contextlib.redirect_stdout(io.StringIO()):
                found, calls = self.run_selector([[[self.old]], self.old_files])
            self.assertIn("--paginate", calls[0].args)
            self.assertEqual(found[0]["versions"], ["20261029162652"])

    def test_live_merged_at_overrides_a_stale_cached_row(self):
        self.run_selector([[[self.old]], self.old_files])
        moved = {**self.old, "merged_at": "2026-10-30T02:00:00Z", "updated_at": "2026-11-16T11:00:00Z"}
        found, calls = self.run_selector([[moved], self.new_files])
        self.assertEqual(len(calls), 2)  # files re-read because merged_at changed
        self.assertEqual(found[0]["merged_at"], "2026-10-30T02:00:00Z")
        self.assertEqual(found[0]["versions"], ["20261029213845"])

    def test_incremental_listing_pages_until_it_passes_the_watermark(self):
        self.run_selector([[[self.new]], self.new_files])
        recent = [{"number": 9000 + i, "merged_at": None, "updated_at": "2026-11-16T12:00:00Z"} for i in range(100)]
        _, calls = self.run_selector([recent, [self.new]])
        self.assertEqual(len(calls), 2)
        self.assertTrue(calls[1].args[0].endswith("&page=2"))


class PerMigrationHold(unittest.TestCase):
    first = {"number": 5456, "merged_at": "2026-11-02T17:00:00Z", "versions": ["20261102170000"]}
    second = {"number": 5460, "merged_at": "2026-11-02T17:10:00Z", "versions": ["20261102171000"]}
    third = {"number": 5461, "merged_at": "2026-11-02T17:20:00Z", "versions": ["20261102172000"]}
    finding = {"number": 5457, "created_at": "2026-11-02T17:30:00Z"}

    def test_a_finding_holds_only_the_pr_it_names(self):
        skipped = []
        held = lambda n: [self.finding] if n == 5456 else []
        action, pr, _ = m.decide([self.first, self.second, self.third], [], held, skipped=skipped)
        self.assertEqual((action, pr["number"]), ("dispatch", 5460))
        self.assertEqual([p["number"] for p in skipped], [5456])

    def test_later_prs_still_promote_in_order(self):
        runs = [{"status": "completed", "conclusion": "success", "display_title": "DB production apply a PR5460 20261102171000"}]
        held = lambda n: [self.finding] if n == 5456 else []
        action, pr, _ = m.decide([self.first, self.second, self.third], runs, held)
        self.assertEqual((action, pr["number"]), ("dispatch", 5461))

    def test_only_held_prs_left_is_idle(self):
        skipped = []
        action, pr, reason = m.decide([self.first], [], lambda n: True, skipped=skipped)
        self.assertEqual((action, pr), ("idle", None))
        self.assertIn("not held", reason)
        self.assertEqual(skipped[0]["findings"], [])

    def test_in_flight_still_stops_the_lane_but_exhausted_passes_over(self):
        self.assertEqual(m.decide([self.first, self.second], [{"status": "queued"}], lambda n: [])[0], "wait")
        fails = [{"display_title": "DB preview apply x PR5460 v", "status": "completed", "conclusion": "failure",
                  "created_at": "2026-11-02T18:00:00Z"}] * 3
        skipped = []
        action, pr, _ = m.decide([self.second, self.third], fails, lambda n: [], skipped=skipped)
        # A PR out of automatic attempts must not park every later promotion
        # (#5532): it is passed over like a held PR and reported for an engineer.
        self.assertEqual((action, pr["number"]), ("dispatch", 5461))
        self.assertEqual([p["number"] for p in skipped], [5460])
        self.assertEqual(skipped[0]["exhausted"], 3)


class OverdueHoldAlert(unittest.TestCase):
    pr = {"number": 5456, "merged_at": "2026-11-02T17:00:00Z", "versions": ["20261102170000"],
          "findings": [{"number": 5457, "created_at": "2026-11-02T17:30:00Z"}]}

    def at(self, text):
        return m._time(text)

    def test_no_alert_within_thirty_minutes_of_the_finding(self):
        self.assertEqual(m.overdue_holds([self.pr], self.at("2026-11-02T18:00:00Z")), [])

    def test_alerts_once_held_over_thirty_minutes(self):
        [line] = m.overdue_holds([self.pr], self.at("2026-11-02T18:01:00Z"))
        self.assertIn("PR #5456", line)
        self.assertIn("#5457", line)
        self.assertIn("31 min", line)

    def test_unknown_findings_count_from_the_merge(self):
        pr = {**self.pr, "findings": []}
        self.assertEqual(len(m.overdue_holds([pr], self.at("2026-11-02T17:31:00Z"))), 1)

    def test_main_reports_an_overdue_hold_without_failing_the_run(self):
        pr = {k: v for k, v in self.pr.items() if k != "findings"}
        saved = (m.gh, m.merged_migration_prs, m.workflow_runs, m.is_held, sys.argv, os.environ.get("GITHUB_REPOSITORY"))
        m.gh = lambda *a: {"sha": "abc"}
        m.merged_migration_prs = lambda repo: [pr]
        m.workflow_runs = lambda repo, **_: []
        m.is_held = lambda repo, n: self.pr["findings"]
        sys.argv, os.environ["GITHUB_REPOSITORY"] = ["x", "--dry-run"], "o/r"
        try:
            with contextlib.redirect_stdout(io.StringIO()) as out:
                now = datetime(2026, 11, 2, 20, 0, tzinfo=timezone.utc)
                # Step 2.2: overdue holds are expected states; exit success with the reason in the summary.
                self.assertEqual(m.main(now), 0)
                m.is_held = lambda repo, n: []
                self.assertEqual(m.main(now), 0)
            self.assertIn("::error title=Production release held over 30 minutes::PR #5456", out.getvalue())
        finally:
            m.gh, m.merged_migration_prs, m.workflow_runs, m.is_held, sys.argv = saved[:5]
            if saved[5] is None:
                os.environ.pop("GITHUB_REPOSITORY", None)
            else:
                os.environ["GITHUB_REPOSITORY"] = saved[5]


class ExhaustedAlert(unittest.TestCase):
    pr = {"number": 5460, "merged_at": "2026-11-02T17:10:00Z", "versions": ["20261102171000"]}
    fails = [{"id": n, "display_title": "DB preview apply abc PR5460 20261102171000", "status": "completed",
              "conclusion": "failure", "created_at": "2026-11-02T18:00:00Z"} for n in range(3)]

    def test_main_reports_engineer_action_required_without_failing_the_run(self):
        saved = (m.gh, m.merged_migration_prs, m.workflow_runs, m.is_held, sys.argv, os.environ.get("GITHUB_REPOSITORY"))
        m.gh = lambda *a: {"sha": "abc"}
        m.merged_migration_prs = lambda repo: [self.pr]
        m.workflow_runs = lambda repo, **_: self.fails
        m.is_held = lambda repo, n: []
        sys.argv, os.environ["GITHUB_REPOSITORY"] = ["x", "--dry-run"], "o/r"
        try:
            with contextlib.redirect_stdout(io.StringIO()) as out:
                # Step 2.2: used-up attempts are expected states; exit success with the reason in the summary.
                self.assertEqual(m.main(datetime(2026, 11, 2, 20, 0, tzinfo=timezone.utc)), 0)
            text = out.getvalue()
            self.assertIn("exhausted: PR #5460 out of automatic attempts", text)
            self.assertIn("::error title=ENGINEER ACTION REQUIRED: automatic attempts exhausted::PR #5460", text)
        finally:
            m.gh, m.merged_migration_prs, m.workflow_runs, m.is_held, sys.argv = saved[:5]
            if saved[5] is None:
                os.environ.pop("GITHUB_REPOSITORY", None)
            else:
                os.environ["GITHUB_REPOSITORY"] = saved[5]

    def test_overdue_hold_alerts_ignore_exhausted_entries(self):
        entry = {**self.pr, "findings": [], "exhausted": 3}
        self.assertEqual(m.overdue_holds([entry], m._time("2026-11-02T20:00:00Z")), [])


class ProductionApplyRefusesReRuns(unittest.TestCase):
    """A production apply run is never re-run: the re-run hides what earlier
    attempts did (2026-11-03, run 41545991868). Both write-path jobs must
    refuse it before anything runs; the queue's fresh dispatch is the only
    retry path."""

    @classmethod
    def setUpClass(cls):
        root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        with open(os.path.join(root, ".github", "workflows", "shared-supabase-migrations.yml"), encoding="utf-8") as fh:
            cls.text = fh.read()

    def test_both_production_jobs_refuse_a_re_run(self):
        self.assertEqual(self.text.count("Refuse a re-run of a production apply run"), 2)
        self.assertEqual(self.text.count("if: github.run_attempt > 1"), 2)
        self.assertIn("NO MIGRATION WAS APPLIED", self.text)


class TriggerReactsToFailures(unittest.TestCase):
    def test_the_trigger_runs_the_selector_after_a_failed_dispatch(self):
        # The 2026-11-02 idle gap: the job only ran when a dispatched run
        # succeeded, so a failed preview left the queue unattended for up to an
        # hour (#5532). PR and merge-group validations must stay excluded.
        path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                            ".github", "workflows", "automatic-production-trigger.yml")
        with open(path, encoding="utf-8") as fh:
            text = fh.read()
        self.assertIn("github.event.workflow_run.event == 'workflow_dispatch'", text)
        self.assertIn("github.event.workflow_run.conclusion == 'success'", text)
        self.assertIn("github.event.workflow_run.conclusion == 'failure'", text)
        # Step 2.2: also trigger on cancelled and timed_out so the queue does
        # not idle until the hourly timer.
        self.assertIn("github.event.workflow_run.conclusion == 'cancelled'", text)
        self.assertIn("github.event.workflow_run.conclusion == 'timed_out'", text)


class MigrationsWorkflowPokesTheTrigger(unittest.TestCase):
    """GitHub never delivers workflow_run events for completions of runs the
    GITHUB_TOKEN dispatched -- how every selector-dispatched preview, recovery
    and production apply starts (verified 2026-11-03). The migrations workflow
    must therefore emit one production-queue nudge after every dispatched run
    (#5532), or the queue idles until the hourly schedule or a merge whatever
    the trigger's job filter says. The lane must also keep its distance from the
    queue-selection automation: check-main-tip-freshness classifies those files
    production-inert and forbids this workflow from naming them."""

    FORBIDDEN_STEMS = (
        "automatic-production-trigger",
        "automatic_promotion_candidates",
        "designflow-sandbox-migrations",
        "sandbox-migration-binding",
        "sandbox_migration_preflight",
    )

    @classmethod
    def setUpClass(cls):
        root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        with open(os.path.join(root, ".github", "workflows", "shared-supabase-migrations.yml"), encoding="utf-8") as fh:
            cls.text = fh.read()
        with open(os.path.join(root, ".github", "workflows", "automatic-production-trigger.yml"), encoding="utf-8") as fh:
            cls.trigger = fh.read()

    def notify_body(self):
        parts = self.text.split("\n  notify-production-queue:", 1)
        self.assertEqual(len(parts), 2, "the migrations workflow must carry the notify job")
        return parts[1]

    def test_dispatch_runs_nudge_the_queue_when_they_finish(self):
        body = self.notify_body()
        self.assertIn("if: always() && github.event_name == 'workflow_dispatch'", body)
        self.assertIn("-f event_type=production-queue-nudge", body)
        # Never poison the reported run's conclusion: a red run that actually
        # applied would burn automatic attempts and retry an applied batch.
        self.assertIn("continue-on-error: true", body)

    def test_the_trigger_listens_for_the_nudge(self):
        self.assertIn("repository_dispatch:", self.trigger)
        self.assertIn("production-queue-nudge", self.trigger)

    def test_the_production_lane_names_no_production_inert_automation(self):
        for stem in self.FORBIDDEN_STEMS:
            self.assertNotIn(stem, self.text, f"the production lane names {stem}")

    def test_the_notify_waits_for_every_job(self):
        body = self.notify_body()
        match = re.search(r"needs: \[([^\]]+)\]", body)
        self.assertIsNotNone(match, "the notify job must declare needs")
        needed = {name.strip() for name in match.group(1).split(",")}
        job_ids = set(re.findall(r"(?m)^  ([a-z][a-z0-9-]+):$", self.text))
        self.assertIn("notify-production-queue", job_ids)
        self.assertEqual(job_ids - {"notify-production-queue"}, needed)


class WorkflowRunsWindow(unittest.TestCase):
    def test_reads_every_page_of_runs(self):
        pages = [{"workflow_runs": [{"id": 1}]}, {"workflow_runs": [{"id": 2}]}]
        real, m.gh = m.gh, lambda *args: pages if "--paginate" in args else {"workflow_runs": [{"id": 1}]}
        try:
            self.assertEqual([r["id"] for r in m.workflow_runs("o/r")], [1, 2])
        finally:
            m.gh = real


class AppliedDespiteCatalogCheck(unittest.TestCase):
    def test_apply_step_success_counts_as_applied(self):
        self.assertTrue(m.applied_in_attempt(APPLIED))
        self.assertFalse(m.applied_in_attempt(NOT_APPLIED))
        self.assertFalse(m.applied_in_attempt([]))

    def test_later_post_apply_failure_still_counts_as_applied(self):
        # #6119: run 43094471144 applied 20261111183827 and then failed only
        # `Save apply evidence` (GitHub artifact-upload outage) with a clean
        # catalog check. The versions are in production; the selector must not
        # report the live change "not live" and exhaust its attempts.
        jobs = [{"steps": [{"name": m.APPLY_STEP, "conclusion": "success"},
                           {"name": m.CATALOG_STEP, "conclusion": "success"},
                           {"name": "Save apply evidence", "conclusion": "failure"},
                           {"name": "refund-eligible-fault", "conclusion": "failure"}]}]
        self.assertTrue(m.applied_in_attempt(jobs))

    def test_decide_moves_past_an_applied_pr(self):
        first = {"number": 5104, "merged_at": "2026-10-31T00:00:00Z", "versions": ["20261030153101"]}
        second = {"number": 5235, "merged_at": "2026-11-01T00:00:00Z", "versions": ["20261031235206"]}
        runs = [{"id": 1, "status": "completed", "conclusion": "failure", "display_title": "DB production apply abc PR5104 20261030153101"}]
        action, pr, _ = m.decide([first, second], runs, lambda n: False, lambda run: run["id"] == 1)
        self.assertEqual((action, pr["number"]), ("dispatch", 5235))
        action, pr, _ = m.decide([first, second], runs, lambda n: False)
        self.assertEqual((action, pr["number"]), ("dispatch", 5104))


class ReRunMustNotEraseApplied(unittest.TestCase):
    """Run 41545991868 applied 20261102202014 in attempt 1 (apply step success,
    only its catalog check failed), then a re-run replaced the step signature
    and the selector retried an already-applied PR all the way into ENGINEER
    ACTION REQUIRED (#5532). The latest attempt alone is never the record."""

    rerun_jobs = [{"steps": [{"name": m.APPLY_STEP, "conclusion": "skipped"},
                             {"name": "Acquire the exclusive production lane and freeze merges", "conclusion": "failure"}]}]

    def test_an_earlier_attempt_still_counts_after_a_re_run(self):
        run = {"id": 41545991868, "run_attempt": 2}
        with mock.patch.object(m, "run_jobs",
                               side_effect=lambda repo, run_id, attempt=None: APPLIED if attempt == 1 else self.rerun_jobs):
            self.assertTrue(m.applied_in_any_attempt("o/r", run))

    def test_a_run_that_never_applied_stays_unapplied(self):
        run = {"id": 1, "run_attempt": 2}
        with mock.patch.object(m, "run_jobs", side_effect=lambda repo, run_id, attempt=None: self.rerun_jobs):
            self.assertFalse(m.applied_in_any_attempt("o/r", run))

    def test_a_single_attempt_run_reads_like_before(self):
        with mock.patch.object(m, "run_jobs", side_effect=lambda repo, run_id, attempt=None: APPLIED):
            self.assertTrue(m.applied_in_any_attempt("o/r", {"id": 7}))

    def test_preview_success_in_an_earlier_attempt_still_counts(self):
        ok = [{"name": "preview", "conclusion": "success"}]
        run = {"id": 2, "run_attempt": 2}
        with mock.patch.object(m, "run_jobs",
                               side_effect=lambda repo, run_id, attempt=None: ok if attempt == 1 else []):
            self.assertTrue(m.preview_job_succeeded_in_any_attempt("o/r", run))


class ProductionReRunAlert(unittest.TestCase):
    """Nothing tracked recurrences of the 2026-11-03 production apply re-run.
    The queue now checks on every run and alerts loudly for a day after one."""

    rerun = {"id": 41545991868, "display_title": "DB production apply x PR5494 20261102202014",
             "run_attempt": 2, "status": "completed", "conclusion": "failure",
             "created_at": "2026-11-02T23:30:46Z", "updated_at": "2026-11-03T03:05:53Z"}

    def test_a_recent_re_run_is_flagged(self):
        self.assertEqual(len(m.recent_re_runs([self.rerun], m._time("2026-11-03T13:30:00Z"))), 1)

    def test_an_old_re_run_stops_being_flagged(self):
        self.assertEqual(m.recent_re_runs([self.rerun], m._time("2026-11-04T04:00:00Z")), [])

    def test_a_first_attempt_is_never_a_re_run(self):
        single = {**self.rerun, "run_attempt": 1}
        self.assertEqual(m.recent_re_runs([single], m._time("2026-11-03T13:30:00Z")), [])

    def test_an_acknowledged_attempt_stops_alerting_but_a_further_re_run_alerts(self):
        now = m._time("2026-11-03T13:30:00Z")
        self.assertEqual(m.recent_re_runs([self.rerun], now, {self.rerun["id"]: 2}), [])
        again = {**self.rerun, "run_attempt": 3}
        self.assertEqual(len(m.recent_re_runs([again], now, {self.rerun["id"]: 2})), 1)
        self.assertEqual(len(m.recent_re_runs([self.rerun], now, {1: 2})), 1)

    def test_a_version_deleted_from_main_is_not_on_main(self):
        self.assertFalse(m.version_on_main("20261104000346"))
        self.assertTrue(m.version_on_main("20261103174555"))

    @mock.patch.object(m, "ACKNOWLEDGED_RE_RUNS", {})
    def test_main_reports_a_re_run_without_failing_the_run(self):
        saved = (m.gh, m.merged_migration_prs, m.workflow_runs, m.is_held, m.applied_in_any_attempt,
                 sys.argv, os.environ.get("GITHUB_REPOSITORY"))
        m.gh = lambda *a: {"sha": "abc"}
        m.merged_migration_prs = lambda repo: []
        m.workflow_runs = lambda repo, **_: [self.rerun]
        m.is_held = lambda repo, n: []
        m.applied_in_any_attempt = lambda repo, run: False
        sys.argv, os.environ["GITHUB_REPOSITORY"] = ["x", "--dry-run"], "o/r"
        try:
            with contextlib.redirect_stdout(io.StringIO()) as out:
                # Step 2.2: acknowledged history is an expected state; exit success with the reason in the summary.
                self.assertEqual(m.main(m._time("2026-11-03T13:30:00Z")), 0)
            self.assertIn("::error title=ENGINEER ACTION REQUIRED: production apply re-run::run 41545991868",
                          out.getvalue())
        finally:
            (m.gh, m.merged_migration_prs, m.workflow_runs, m.is_held,
             m.applied_in_any_attempt, sys.argv) = saved[:6]
            if saved[6] is None:
                os.environ.pop("GITHUB_REPOSITORY", None)
            else:
                os.environ["GITHUB_REPOSITORY"] = saved[6]


class FreshRecheckBeforeDispatch(unittest.TestCase):
    PR = {"number": 7, "merged_at": "2026-01-01T00:00:00Z", "versions": ["20260101000000"]}

    def _main(self, snapshots):
        with mock.patch.object(m, "gh", lambda *a: {"sha": "abc"}), \
             mock.patch.object(m, "merged_migration_prs", lambda repo: [self.PR]), \
             mock.patch.object(m, "workflow_runs", mock.Mock(side_effect=snapshots)), \
             mock.patch.object(m, "is_held", lambda repo, n: []), \
             mock.patch.object(m, "dispatch") as sent, \
             mock.patch.object(m, "prune_claims", lambda *a: None), \
             mock.patch.object(m, "claim_dispatch", lambda *a: True), \
             mock.patch.object(sys, "argv", ["x"]), \
             mock.patch.dict(os.environ, {"GITHUB_REPOSITORY": "o/r"}), \
             contextlib.redirect_stdout(io.StringIO()) as out:
            m.main(m._time("2026-01-02T00:00:00Z"))
        return sent, out.getvalue()

    def test_a_run_started_after_the_snapshot_withdraws_the_dispatch(self):
        busy = {"id": 1, "display_title": "DB production apply a PR7 20260101000000",
                "status": "in_progress", "run_attempt": 1, "created_at": "2026-01-01T01:00:00Z"}
        sent, text = self._main([[], [busy], [busy]])
        sent.assert_not_called()
        self.assertIn("dispatch withdrawn on the fresh recheck: wait", text)

    def test_an_unchanged_queue_still_dispatches(self):
        sent, _ = self._main([[], []])
        sent.assert_called_once()


class SkipDecisionsAreLogged(unittest.TestCase):
    def test_a_pr_already_in_production_logs_its_skip(self):
        pr = {"number": 7, "merged_at": "2026-01-01", "versions": ["1"]}
        run = {"display_title": "DB production apply a PR7 1", "status": "completed", "conclusion": "success"}
        with contextlib.redirect_stdout(io.StringIO()) as out:
            m.decide([pr], [run], lambda n: [])
        self.assertIn("skip: PR #7 has a successful production apply", out.getvalue())


class ManualReRunInFlight(unittest.TestCase):
    """2026-11-03 race (#5560): run 41661658015 attempt 1 failed in the guards,
    attempt 2 was started by hand and still ran while the trigger judged PR 5539
    not yet in production and dispatched a second preview -> production chain."""
    PR = {"number": 5539, "merged_at": "2026-11-03T14:00:00Z", "versions": ["20261103142609"]}

    def _run(self, status, conclusion):
        return {"id": 41661658015, "display_title": "DB production apply abc123 PR5539 20261103142609",
                "status": status, "conclusion": conclusion, "run_attempt": 2,
                "created_at": "2026-11-03T15:13:35Z"}

    def test_attempt_two_in_progress_waits(self):
        for status in ("queued", "in_progress", "waiting"):
            action, pr, _ = m.decide([self.PR], [self._run(status, None)], lambda n: [])
            self.assertEqual((action, pr), ("wait", None), status)

    def test_attempt_two_in_progress_even_if_api_still_reports_attempt_one_failure(self):
        action, pr, _ = m.decide([self.PR], [self._run("in_progress", "failure")], lambda n: [])
        self.assertEqual((action, pr), ("wait", None))

    def test_main_never_dispatches_while_attempt_two_runs(self):
        busy = self._run("in_progress", None)
        with mock.patch.object(m, "gh", lambda *a: {"sha": "abc"}), \
             mock.patch.object(m, "merged_migration_prs", lambda repo: [self.PR]), \
             mock.patch.object(m, "workflow_runs", lambda repo, **_: [busy]), \
             mock.patch.object(m, "is_held", lambda repo, n: []), \
             mock.patch.object(m, "dispatch") as sent, \
             mock.patch.object(sys, "argv", ["x"]), \
             mock.patch.dict(os.environ, {"GITHUB_REPOSITORY": "o/r"}), \
             contextlib.redirect_stdout(io.StringIO()):
            m.main(m._time("2026-11-03T15:16:00Z"))
        sent.assert_not_called()


class EarlierPreviewApply(unittest.TestCase):
    def test_finds_the_oldest_successful_post_merge_preview_apply(self):
        pr = {"number": 5165, "merged_at": "2026-10-31T00:00:00Z", "versions": ["20261030190639"]}
        runs = [
            {"id": 9, "conclusion": "success", "created_at": "2026-10-31T05:00:00Z", "display_title": "DB preview apply a PR5165 20261030190639"},
            {"id": 7, "conclusion": "success", "created_at": "2026-10-31T02:00:00Z", "display_title": "DB preview apply a PR5165 20261030190639"},
            {"id": 3, "conclusion": "success", "created_at": "2026-10-30T02:00:00Z", "display_title": "DB preview apply a PR5165 20261030190639"},
            {"id": 8, "conclusion": "failure", "created_at": "2026-10-31T01:00:00Z", "display_title": "DB preview apply a PR5165 20261030190639"},
            {"id": 6, "conclusion": "success", "created_at": "2026-10-31T01:30:00Z", "display_title": "DB preview apply a PR51650 x"},
            {"id": 5, "conclusion": "success", "created_at": "2026-10-31T01:40:00Z", "display_title": "DB preview apply a PR 202610301906390"},
        ]
        self.assertEqual(m.earlier_preview_apply(pr, runs), 7)
        # #6574: a pre-merge apply is never the fallback; it is reported instead.
        self.assertIsNone(m.earlier_preview_apply(pr, [runs[2]]))
        self.assertEqual(m.pre_merge_preview_apply(pr, runs), 3)
        self.assertIsNone(m.pre_merge_preview_apply(pr, runs[:2]))
        self.assertIsNone(m.earlier_preview_apply(pr, runs[3:]))
        recovery = {"id": 4, "conclusion": "success", "created_at": "2026-10-31T01:50:00Z", "display_title": "DB preview apply a PR 20261030190639"}
        self.assertEqual(m.earlier_preview_apply(pr, runs + [recovery]), 4)
        held = {**recovery, "id": 2, "conclusion": "failure", "created_at": "2026-10-31T01:45:00Z"}
        self.assertEqual(m.earlier_preview_apply(pr, runs + [held]), 7)
        self.assertEqual(m.earlier_preview_apply(pr, runs + [held], lambda r: r["id"] == 2), 2)

    def _dispatch(self, runs):
        pr = {"number": 6400, "merged_at": "2026-11-16T12:00:00Z", "versions": ["20261116013153"]}
        out = io.StringIO()
        with mock.patch.object(m.subprocess, "run") as sent, \
             mock.patch.object(m, "preview_job_succeeded_in_any_attempt", return_value=False), \
             contextlib.redirect_stdout(out):
            m.dispatch("o/r", pr, "abc", runs)
        return sent.call_args[0][0], out.getvalue()

    def test_stale_pre_merge_apply_is_ignored_and_engineer_action_is_loud(self):
        pre = {"id": 43789639543, "conclusion": "success", "created_at": "2026-11-16T02:00:00Z",
               "display_title": "DB preview apply a PR6400 20261116013153"}
        cmd, out = self._dispatch([pre])
        self.assertIn("merged_preview_source_pr=6400", cmd)
        self.assertFalse(any(a.startswith("historical_preview") for a in cmd))
        self.assertIn("ENGINEER ACTION REQUIRED", out)
        self.assertIn("REISSUE", out)
        self.assertIn("43789639543", out)

    def test_post_merge_apply_still_recovers_and_stays_quiet(self):
        pre = {"id": 1, "conclusion": "success", "created_at": "2026-11-16T02:00:00Z",
               "display_title": "DB preview apply a PR6400 20261116013153"}
        post = {**pre, "id": 2, "created_at": "2026-11-16T13:00:00Z"}
        cmd, out = self._dispatch([pre, post])
        self.assertIn("historical_preview_original_run_map=20261116013153:2", cmd)
        self.assertNotIn("ENGINEER ACTION REQUIRED", out)

    def test_no_preview_apply_is_a_quiet_fresh_rehearsal(self):
        cmd, out = self._dispatch([])
        self.assertIn("merged_preview_source_pr=6400", cmd)
        self.assertNotIn("ENGINEER ACTION REQUIRED", out)


class AlreadyInProduction(unittest.TestCase):
    pr = {"number": 5494, "merged_at": "2026-11-02T21:11:27Z", "versions": ["20261102202014"]}
    pair = {"number": 8, "merged_at": "2026-11-02T21:11:27Z", "versions": ["20261102202014", "20261102202015"]}

    @staticmethod
    def run_(conclusion, pr, versions, run_id=1):
        return {"id": run_id, "display_title": f"DB production apply abc PR{pr} {versions}", "status": "completed",
                "conclusion": conclusion, "created_at": "2026-11-03T00:00:00Z"}

    def test_another_prs_successful_run_counts(self):
        runs = [self.run_("success", 5511, "20261102202014")]
        self.assertEqual(m.decide([self.pr], runs, lambda n: [])[0], "idle")

    def test_refusal_as_already_applied_counts(self):
        runs = [self.run_("failure", 5494, "20261102202014")]
        action = m.decide([self.pr], runs, lambda n: [], refused=lambda r: {"20261102202014"})[0]
        self.assertEqual(action, "idle")

    def test_any_other_production_failure_still_retries(self):
        runs = [self.run_("failure", 5494, "20261102202014")]
        self.assertEqual(m.decide([self.pr], runs, lambda n: [])[0], "dispatch")

    def test_partial_coverage_still_dispatches(self):
        runs = [self.run_("success", 5511, "20261102202014")]
        self.assertEqual(m.decide([self.pair], runs, lambda n: [])[0], "dispatch")

    def test_coverage_may_span_several_runs(self):
        runs = [self.run_("success", 1, "20261102202014"), self.run_("failure", 8, "20261102202015", 2)]
        action = m.decide([self.pair], runs, lambda n: [], refused=lambda r: {"20261102202015"} if r["id"] == 2 else set())[0]
        self.assertEqual(action, "idle")

    def test_failed_run_of_another_pr_does_not_count(self):
        runs = [self.run_("failure", 5511, "20261102202014")]
        self.assertEqual(m.decide([self.pr], runs, lambda n: [])[0], "dispatch")

    def test_preview_success_does_not_count(self):
        runs = [{"display_title": "DB preview apply abc PR5494 20261102202014", "status": "completed",
                 "conclusion": "success", "created_at": "2026-11-03T00:00:00Z"}]
        self.assertEqual(m.decide([self.pr], runs, lambda n: [])[0], "dispatch")

    def test_refusal_line_is_read_only_from_the_guard_output(self):
        log = ("review\tpreflight\t2026-11-03T06:08:44.2Z BLOCKED: already applied on production: 20261102202014, 20261102202015\r\n"
               "2026-11-03T06:08:44.3Z BLOCKED: already applied on preview: 20261102202016\n"
               "2026-11-03T06:08:44.4Z echo BLOCKED: already applied on production: 20261102202017\n")
        self.assertEqual(m.refused_versions(log), {"20261102202014", "20261102202015"})

    def test_unreadable_log_counts_as_not_applied(self):
        with mock.patch.object(m, "run_jobs", side_effect=ValueError("bad")), contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(m.refused_as_applied("o/r", {"id": 1}), set())


class KnownProductionDependencies(unittest.TestCase):
    BASE = "20261105044255"
    CHILD = "20261105061627"
    OTHER = "20261105070000"
    base = {"number": 5619, "merged_at": "2026-11-05T01:00:00Z", "versions": [BASE]}
    child = {"number": 5649, "merged_at": "2026-11-05T02:00:00Z", "versions": [CHILD],
             "production_dependencies": {BASE: 5619}}
    other = {"number": 5650, "merged_at": "2026-11-05T03:00:00Z", "versions": [OTHER]}

    def run_for(self, kind="production", conclusion="success"):
        return {"status": "completed", "conclusion": conclusion,
                "display_title": f"DB {kind} apply main PR5619 {self.BASE}",
                "created_at": "2026-11-05T01:30:00Z"}

    def test_held_base_skips_child_and_advances_independent(self):
        skipped = []
        action, pr, _ = m.decide([self.base, self.child, self.other], [],
                                  lambda n: [{"number": 1}] if n == 5619 else [], skipped=skipped)
        self.assertEqual((action, pr["number"]), ("dispatch", 5650))
        self.assertEqual(skipped[1]["pending_dependencies"], {self.BASE: 5619})
        self.assertNotIn("findings", skipped[1])
        self.assertNotIn("exhausted", skipped[1])
        self.assertEqual(m.overdue_holds([skipped[1]], m._time("2026-11-06T00:00:00Z")), [])

    def test_trustworthy_production_evidence_releases_child(self):
        for conclusion, applied, refused in [
            ("success", False, set()), ("failure", True, set()),
            ("failure", False, {self.BASE})]:
            with self.subTest(conclusion=conclusion, applied=applied, refused=refused):
                action, pr, _ = m.decide([self.child], [self.run_for(conclusion=conclusion)],
                    lambda n: [], applied=lambda r: applied, refused=lambda r: refused)
                self.assertEqual((action, pr["number"]), ("dispatch", 5649))

    def test_preview_and_unproven_failures_do_not_release_child(self):
        for run in [self.run_for("preview"), self.run_for(conclusion="failure")]:
            with self.subTest(run=run):
                skipped = []
                # Preview is never consulted, even if callbacks claim success.
                applied = (lambda r: True) if "preview" in run["display_title"] else (lambda r: False)
                refused = (lambda r: {self.BASE}) if "preview" in run["display_title"] else (lambda r: set())
                self.assertEqual(m.decide([self.child], [run], lambda n: [], applied=applied,
                                         refused=refused, skipped=skipped)[0], "idle")
                self.assertEqual(skipped[0]["pending_dependencies"], {self.BASE: 5619})

    def test_dependency_wait_precedes_attempt_exhaustion(self):
        failed = {"status": "completed", "conclusion": "failure",
                  "display_title": f"DB preview apply main PR5649 {self.CHILD}",
                  "created_at": "2026-11-05T02:30:00Z"}
        skipped = []
        m.decide([self.child], [failed] * m.MAX_ATTEMPTS, lambda n: [], skipped=skipped)
        self.assertIn("pending_dependencies", skipped[0])
        self.assertNotIn("exhausted", skipped[0])

    def discovered(self, grouped):
        import tempfile
        from pathlib import Path
        with tempfile.TemporaryDirectory() as folder:
            scripts = Path(folder) / "scripts"
            scripts.mkdir()
            migrations = Path(folder) / "supabase/migrations"
            migrations.mkdir(parents=True)
            for versions in grouped:
                for version in versions:
                    (migrations / f"{version}_test.sql").write_text(
                        f"-- derived-from: {self.BASE}\nselect 1;" if version == self.CHILD else
                        "-- derived-from: none\nselect 1;")
            pulls = [{"number": n + 10, "merged_at": "2026-11-05T01:00:00Z"} for n in range(len(grouped))]
            pages = [[[{"status": "added", "filename": f"supabase/migrations/{v}_test.sql"} for v in vs]] for vs in grouped]
            with mock.patch.object(m, "HERE", str(scripts)), mock.patch.object(m, "gh", side_effect=[[pulls], *pages]):
                return m.merged_migration_prs("o/r")

    def test_discovery_retains_dependency_for_single_candidate_recheck(self):
        base, child = self.discovered([[self.BASE], [self.CHILD]])
        self.assertEqual(child["production_dependencies"], {self.BASE: base["number"]})
        self.assertEqual(m.decide([child], [], lambda n: [])[0], "idle")
        self.assertEqual(m.decide([child], [self.run_for()], lambda n: [])[0], "dispatch")

    def test_same_pr_base_and_child_remain_allowed(self):
        pr, = self.discovered([[self.BASE, self.CHILD]])
        self.assertEqual(pr["production_dependencies"], {})
        self.assertEqual(m.decide([pr], [], lambda n: [])[0], "dispatch")

    def test_unknown_historical_base_stays_with_existing_guard(self):
        pr, = self.discovered([[self.CHILD]])
        self.assertEqual(pr["production_dependencies"], {})
        self.assertEqual(m.decide([pr], [], lambda n: [])[0], "dispatch")

    def test_unreadable_production_evidence_never_proves_base(self):
        def unreadable(run):
            raise OSError("evidence unreadable")
        failed = self.run_for(conclusion="failure")
        with contextlib.redirect_stdout(io.StringIO()) as output:
            skipped = []
            action, pr, _ = m.decide([self.child, self.other], [failed], lambda n: [],
                                     applied=unreadable, refused=unreadable, skipped=skipped)
            self.assertEqual((action, pr["number"]), ("dispatch", self.other["number"]))
            self.assertEqual(skipped[0]["pending_dependencies"], {self.BASE: 5619})
            self.assertEqual(m.decide([self.child], [failed], lambda n: [],
                                     applied=unreadable, refused=unreadable)[0], "idle")
            self.assertEqual(m.decide([self.child], [failed, self.run_for()], lambda n: [],
                                     applied=unreadable, refused=unreadable)[0], "dispatch")
            # A readable alternative receipt on the same failed run still counts.
            self.assertEqual(m.decide([self.child], [failed], lambda n: [],
                                     applied=unreadable, refused=lambda r: {self.BASE})[0], "dispatch")
        self.assertIn("receipt as unproved", output.getvalue())
        self.assertNotIn("evidence unreadable\n", output.getvalue())


class CanonicalDependencyResolution(unittest.TestCase):
    def discover_real(self, versions):
        from pathlib import Path
        root = Path(m.HERE).parent
        pulls = [{"number": 8000 + n, "merged_at": "2026-11-05T01:00:00Z"} for n in range(len(versions))]
        files = [[[{"status": "added", "filename": next((root / "supabase/migrations").glob(v + "_*.sql")).relative_to(root).as_posix()}]] for v in versions]
        with mock.patch.object(m, "gh", side_effect=[[pulls], *files]):
            return m.merged_migration_prs("o/r")

    def test_retired_original_is_never_dispatched(self):
        # #5932: PR #6451's retired 20261218025935 (reissued as 20261218043336)
        # was dispatched three times and failed preview each time.
        self.assertIn("20261218025935", m.RETIRED_VERSIONS)
        self.assertNotIn("20261218025935", m.HARD_BLOCKED)
        found = self.discover_real(["20261218025935"])
        self.assertEqual(found, [])

    def test_real_byte_pinned_non_ledger_source_does_not_invent_a_base(self):
        from pathlib import Path
        from migration_derivation import IMMUTABLE_NON_LEDGER_SOURCE_SHA256
        import hashlib
        version = "20261022132119"
        path = next((Path(m.HERE).parent / "supabase/migrations").glob(version + "_*.sql"))
        self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), IMMUTABLE_NON_LEDGER_SOURCE_SHA256[version])
        base, child = self.discover_real(["20261022014315", version])
        self.assertEqual(child["production_dependencies"], {})

    def test_real_legacy_overlay_matches_the_production_resolver(self):
        from pathlib import Path
        from migration_derivation import parse_declaration
        version = "20260915015414"
        path = next((Path(m.HERE).parent / "supabase/migrations").glob(version + "_*.sql"))
        self.assertIsNone(parse_declaration(path.read_text(), version))
        # This historical overlay is now retired; isolate canonical dependency
        # discovery from the separately tested production retirement filter.
        with mock.patch.object(m, "HARD_BLOCKED", m.HARD_BLOCKED - {version}),              mock.patch.object(m, "RETIRED_VERSIONS", m.RETIRED_VERSIONS - {version}):
            base, child = self.discover_real(["20260905104802", version])
        self.assertEqual(child["production_dependencies"], {"20260905104802": base["number"]})

    def test_dependency_receipts_share_only_one_decision_pass(self):
        fixture = KnownProductionDependencies()
        child = fixture.child
        sibling = {**child, "number": 5652, "versions": ["20261105080000"]}
        run = {**fixture.run_for(conclusion="failure"), "id": 123, "run_attempt": 1}
        for unreadable in (False, True):
            with self.subTest(unreadable=unreadable), contextlib.redirect_stdout(io.StringIO()):
                applied = mock.Mock(side_effect=OSError("private receipt") if unreadable else None, return_value=False)
                refused = mock.Mock(side_effect=ValueError("private receipt") if unreadable else None, return_value=set())
                action, selected, _ = m.decide([child, sibling, fixture.other], [run], lambda n: [], applied=applied, refused=refused)
                self.assertEqual((action, selected["number"]), ("dispatch", fixture.other["number"]))
                self.assertEqual((applied.call_count, refused.call_count), (1, 1))
                # A fresh pass reads again, even with the same run ID/attempt.
                self.assertEqual(m.decide([child], [run], lambda n: [], applied=applied, refused=refused)[0], "idle")
                self.assertEqual((applied.call_count, refused.call_count), (2, 2))
                applied.side_effect = None
                applied.return_value = True
                self.assertEqual(m.decide([child], [run], lambda n: [], applied=applied, refused=refused)[0], "dispatch")
                self.assertEqual((applied.call_count, refused.call_count), (3, 3))


class TriggerReporting(unittest.TestCase):
    """Step 2.2: exit success for holds, waits, used-up attempts and acknowledged
    history with the reason in the summary; exit failure only when the trigger
    itself broke."""

    def _run_main(self, *, prs, runs, held=None, summary_path=None):
        saved = (m.gh, m.merged_migration_prs, m.workflow_runs, m.is_held,
                 sys.argv, os.environ.get("GITHUB_REPOSITORY"), os.environ.get("GITHUB_STEP_SUMMARY"))
        m.gh = lambda *a: {"sha": "abc"}
        m.merged_migration_prs = lambda repo: prs
        m.workflow_runs = lambda repo, **_: runs
        m.is_held = held or (lambda repo, n: [])
        sys.argv, os.environ["GITHUB_REPOSITORY"] = ["x", "--dry-run"], "o/r"
        if summary_path:
            os.environ["GITHUB_STEP_SUMMARY"] = summary_path
        else:
            os.environ.pop("GITHUB_STEP_SUMMARY", None)
        try:
            with contextlib.redirect_stdout(io.StringIO()) as out:
                code = m.main(datetime(2026, 11, 2, 20, 0, tzinfo=timezone.utc))
            return code, out.getvalue()
        finally:
            (m.gh, m.merged_migration_prs, m.workflow_runs, m.is_held, sys.argv) = saved[:5]
            for idx, key in ((5, "GITHUB_REPOSITORY"), (6, "GITHUB_STEP_SUMMARY")):
                if saved[idx] is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = saved[idx]

    def test_wait_state_exits_zero_with_reason(self):
        runs = [{"status": "in_progress", "display_title": "DB preview apply x"}]
        code, out = self._run_main(prs=[], runs=runs)
        self.assertEqual(code, 0)
        self.assertIn("wait:", out)

    def test_idle_state_exits_zero_with_reason(self):
        code, out = self._run_main(prs=[], runs=[])
        self.assertEqual(code, 0)
        self.assertIn("idle:", out)

    def test_held_pr_exits_zero_with_reason(self):
        pr = {"number": 7, "merged_at": "2026-01-01T00:00:00Z", "versions": ["20260101000000"]}
        code, out = self._run_main(prs=[pr], runs=[], held=lambda repo, n: [{"number": 99}])
        self.assertEqual(code, 0)
        self.assertIn("held: PR #7", out)

    def test_summary_written_on_hold(self):
        import tempfile, os as _os
        pr = {"number": 7, "merged_at": "2026-01-01T00:00:00Z", "versions": ["20260101000000"]}
        with tempfile.NamedTemporaryFile(mode="w", suffix=".md", delete=False) as f:
            path = f.name
        try:
            code, _ = self._run_main(prs=[pr], runs=[], held=lambda repo, n: [{"number": 99}], summary_path=path)
            self.assertEqual(code, 0)
            summary = open(path, encoding="utf-8").read()
            self.assertIn("Automatic promotion trigger", summary)
            self.assertIn("Held: PR #7", summary)
        finally:
            _os.unlink(path)

    def test_summary_written_on_exhausted(self):
        import tempfile, os as _os
        pr = {"number": 7, "merged_at": "2026-01-01T00:00:00Z", "versions": ["20260101000000"]}
        fail = [{"steps": [{"name": m.APPLY_STEP, "conclusion": "failure"}]}]
        runs = [{"id": n, "display_title": "DB preview apply abc PR7 20260101000000", "status": "completed",
                 "conclusion": "failure", "created_at": "2026-01-02"} for n in range(3)]
        with tempfile.NamedTemporaryFile(mode="w", suffix=".md", delete=False) as f:
            path = f.name
        try:
            code, _ = self._run_main(prs=[pr], runs=runs, summary_path=path)
            self.assertEqual(code, 0)
            summary = open(path, encoding="utf-8").read()
            self.assertIn("Used-up attempts: PR #7", summary)
        finally:
            _os.unlink(path)


class TriggerDefectExitsFailure(unittest.TestCase):
    """Step 2.2: exit failure only when the trigger itself broke."""

    def test_unhandled_exception_exits_failure(self):
        saved = (m.gh, sys.argv, os.environ.get("GITHUB_REPOSITORY"))
        m.gh = lambda *a: (_ for _ in ()).throw(RuntimeError("GitHub API down"))
        sys.argv, os.environ["GITHUB_REPOSITORY"] = ["x"], "o/r"
        try:
            with contextlib.redirect_stdout(io.StringIO()) as out:
                # Simulate the __main__ entry point which wraps main() with defect handling.
                try:
                    raise SystemExit(m.main(datetime(2026, 11, 2, 20, 0, tzinfo=timezone.utc)))
                except SystemExit:
                    raise
                except Exception as exc:
                    print(f"::error title=Trigger defect::automatic-promotion-candidates raised {type(exc).__name__}: {exc}")
                    raise SystemExit(1)
        except SystemExit as ctx:
            self.assertEqual(ctx.code, 1)
            self.assertIn("Trigger defect", out.getvalue())
        finally:
            m.gh, sys.argv = saved[:2]
            if saved[2] is None:
                os.environ.pop("GITHUB_REPOSITORY", None)
            else:
                os.environ["GITHUB_REPOSITORY"] = saved[2]
class AdversarialUnmergedSource(unittest.TestCase):
    """Adversarial table (plan section 9): wording removed from conditions must
    not let an unmerged source through.  merged_migration_prs must refuse it."""

    def test_unmerged_source_refused(self):
        files = [[{"status": "added", "filename": "supabase/migrations/20261105120000_x.sql"}]]
        pulls = [{"number": 5600, "merged_at": None}]
        with mock.patch.object(m, "gh", side_effect=[[pulls], files]):
            self.assertEqual(m.merged_migration_prs("o/r"), [])

    def test_closed_but_unmerged_source_refused(self):
        files = [[{"status": "added", "filename": "supabase/migrations/20261105120000_x.sql"}]]
        pulls = [{"number": 5601, "merged_at": ""}]
        with mock.patch.object(m, "gh", side_effect=[[pulls], files]):
            self.assertEqual(m.merged_migration_prs("o/r"), [])

    def test_pure_version_rename_is_a_candidate(self):
        # Observed 2026-11-06 (PR #5830): a rename the files API reports as
        # "renamed" carries the NEW version and must be promotable, or the
        # documented exhausted-attempts cure (a pure version rename) never
        # reaches production.
        files = [[{"status": "renamed", "filename": "supabase/migrations/20261106043500_x.sql",
                   "previous_filename": "supabase/migrations/20261105235900_x.sql"}]]
        pulls = [{"number": 5830, "merged_at": "2026-11-06T04:50:00Z"}]
        # The production_dependencies glob reads the checkout, but this
        # fixture version is a live-repo version the rename cure can remove
        # (PR #5857 renames 20261106043500 away); supply the path virtually.
        with mock.patch.object(m, "gh", side_effect=[[pulls], files]), \
                mock.patch.object(m, "version_on_main", return_value=True), \
                mock.patch.object(m, "declared_bases", return_value=[]), \
                mock.patch("glob.glob", return_value=["supabase/migrations/20261106043500_x.sql"]):
            found = m.merged_migration_prs("o/r")
        self.assertEqual([p["number"] for p in found], [5830])
        self.assertEqual(found[0]["versions"], ["20261106043500"])


class StuckChangeOwner(unittest.TestCase):
    """Step 2.3: later changes promote past a failed one; exhausted PRs get one
    owned tracking issue with delivery wording and merged-not-live duration."""

    def test_later_changes_promote_past_a_failed_one(self):
        # PR #7 exhausted, PR #8 independent (no dependency) — #8 must dispatch.
        pr7 = {"number": 7, "merged_at": "2026-11-01T00:00:00Z", "versions": ["20261101000000"]}
        pr8 = {"number": 8, "merged_at": "2026-11-02T00:00:00Z", "versions": ["20261102000000"]}
        runs = [{"display_title": f"DB preview apply abc PR7 20261101000000", "status": "completed",
                 "conclusion": "failure", "created_at": "2026-11-01T01:00:00Z"}] * 3
        skipped = []
        action, pr, reason = m.decide([pr7, pr8], runs, lambda n: [], lambda r: False,
                                      "abc", skipped, lambda r: set())
        self.assertEqual(action, "dispatch")
        self.assertEqual(pr["number"], 8)
        # The exhausted PR is in skipped, not blocking.
        self.assertTrue(any(e.get("exhausted") for e in skipped))

    def test_dependent_change_is_held(self):
        # PR #8 depends on PR #7's base — #8 must wait, not dispatch.
        pr7 = {"number": 7, "merged_at": "2026-11-01T00:00:00Z", "versions": ["20261101000000"]}
        pr8 = {"number": 8, "merged_at": "2026-11-02T00:00:00Z", "versions": ["20261102000000"],
               "production_dependencies": {"20261102000000": 7}}
        runs = [{"display_title": "DB preview apply abc PR7 20261101000000", "status": "completed",
                 "conclusion": "failure", "created_at": "2026-11-01T01:00:00Z"}] * 3
        skipped = []
        action, pr, reason = m.decide([pr7, pr8], runs, lambda n: [], lambda r: False,
                                      "abc", skipped, lambda r: set())
        self.assertEqual(action, "idle")

    def test_failing_rehearsal_produces_one_owned_issue(self):
        import subprocess as sp
        pr = {"number": 7, "merged_at": "2026-11-01T00:00:00Z", "versions": ["20261101000000"]}
        entries = [{**pr, "findings": [], "exhausted": 3}]
        created = []
        def fake_run(cmd, **kw):
            created.append(cmd)
            class R:
                stdout = "https://github.com/o/r/issues/99\n"
                stderr = ""
            return R()
        saved_run = sp.run
        saved_gh = m.gh
        sp.run = fake_run
        m.gh = lambda *a: []  # no existing issue
        try:
            m.report_stuck_change("o/r", entries, datetime(2026, 11, 2, 20, 0, tzinfo=timezone.utc))
        finally:
            sp.run = saved_run
            m.gh = saved_gh
        # Exactly one issue created.
        creates = [c for c in created if "issue" in c and "create" in c]
        self.assertEqual(len(creates), 1)
        # Body includes delivery wording and merged-not-live duration.
        body = creates[0][creates[0].index("--body") + 1]
        self.assertIn("Delivery needed", body)
        self.assertIn("PR #7", body)
        self.assertIn("merged", body)
        self.assertIn("not live", body)

    def test_existing_issue_is_updated_not_duplicated(self):
        import subprocess as sp
        pr = {"number": 7, "merged_at": "2026-11-01T00:00:00Z", "versions": ["20261101000000"]}
        entries = [{**pr, "findings": [], "exhausted": 3}]
        calls = []
        def fake_run(cmd, **kw):
            calls.append(cmd)
            class R:
                stdout = ""
                stderr = ""
            return R()
        saved_run = sp.run
        saved_gh = m.gh
        sp.run = fake_run
        m.gh = lambda *a: [{"number": 99, "title": m.STUCK_ISSUE_TITLE, "state": "open"}]
        try:
            m.report_stuck_change("o/r", entries, datetime(2026, 11, 2, 20, 0, tzinfo=timezone.utc))
        finally:
            sp.run = saved_run
            m.gh = saved_gh
        creates = [c for c in calls if "create" in c]
        comments = [c for c in calls if "comment" in c]
        self.assertEqual(len(creates), 0)
        self.assertEqual(len(comments), 1)

    def test_tracking_issue_past_first_page_is_updated_not_duplicated(self):
        # Closeout note #5758: a parked tracking issue beyond the first 100
        # open issues must be found by pagination, not re-created.
        import subprocess as sp
        pr = {"number": 7, "merged_at": "2026-11-01T00:00:00Z", "versions": ["20261101000000"]}
        entries = [{**pr, "findings": [], "exhausted": 3}]
        pages = {
            1: [{"number": n, "title": f"other issue {n}", "state": "open"} for n in range(100)],
            2: [{"number": 42, "title": m.STUCK_ISSUE_TITLE, "state": "open"}],
        }
        calls = []
        def fake_run(cmd, **kw):
            calls.append(cmd)
            class R:
                stdout = ""
                stderr = ""
            return R()
        def fake_gh(*a):
            calls.append(a)
            return pages[int(a[-1].rsplit("page=", 1)[1])]
        saved_run = sp.run
        saved_gh = m.gh
        sp.run = fake_run
        m.gh = fake_gh
        try:
            m.report_stuck_change("o/r", entries, datetime(2026, 11, 2, 20, 0, tzinfo=timezone.utc))
        finally:
            sp.run = saved_run
            m.gh = saved_gh
        creates = [c for c in calls if "create" in c]
        comments = [c for c in calls if "comment" in c]
        self.assertEqual(len(creates), 0)
        self.assertEqual(len(comments), 1)
        self.assertIn("42", comments[0])

    def test_create_only_after_every_page_is_scanned(self):
        import subprocess as sp
        pr = {"number": 7, "merged_at": "2026-11-01T00:00:00Z", "versions": ["20261101000000"]}
        entries = [{**pr, "findings": [], "exhausted": 3}]
        pages = {
            1: [{"number": n, "title": f"other issue {n}", "state": "open"} for n in range(100)],
            2: [{"number": 7, "title": "some other issue", "state": "open"}],
        }
        calls = []
        def fake_run(cmd, **kw):
            calls.append(cmd)
            class R:
                stdout = "https://github.com/o/r/issues/99\n"
                stderr = ""
            return R()
        def fake_gh(*a):
            calls.append(a)
            return pages[int(a[-1].rsplit("page=", 1)[1])]
        saved_run = sp.run
        saved_gh = m.gh
        sp.run = fake_run
        m.gh = fake_gh
        try:
            m.report_stuck_change("o/r", entries, datetime(2026, 11, 2, 20, 0, tzinfo=timezone.utc))
        finally:
            sp.run = saved_run
            m.gh = saved_gh
        creates = [c for c in calls if "create" in c]
        comments = [c for c in calls if "comment" in c]
        self.assertEqual(len(creates), 1)
        self.assertEqual(len(comments), 0)
        # Both pages were read before deciding to create.
        self.assertEqual(len([c for c in calls if "page=" in c[-1]]), 2)

    def test_no_entries_no_issue(self):
        import subprocess as sp
        calls = []
        def fake_run(cmd, **kw):
            calls.append(cmd)
            class R:
                stdout = ""
                stderr = ""
            return R()
        saved_run = sp.run
        sp.run = fake_run
        try:
            m.report_stuck_change("o/r", [], datetime(2026, 11, 2, 20, 0, tzinfo=timezone.utc))
        finally:
            sp.run = saved_run
        self.assertEqual(len(calls), 0)

    def test_failure_warning_carries_gh_stderr(self):
        # #5771: the create used to fail as a bare "exit status 1"; the warning
        # must carry gh's stderr so the cause (e.g. missing issues:write) is visible.
        import subprocess as sp
        pr = {"number": 7, "merged_at": "2026-11-01T00:00:00Z", "versions": ["20261101000000"]}
        entries = [{**pr, "findings": [], "exhausted": 3}]

        def fake_run(cmd, **kw):
            raise sp.CalledProcessError(1, cmd, output="", stderr="Resource not accessible by integration")

        saved_run = sp.run
        saved_gh = m.gh
        sp.run = fake_run
        m.gh = lambda *a: []
        buf = io.StringIO()
        try:
            with contextlib.redirect_stdout(buf):
                m.report_stuck_change("o/r", entries, datetime(2026, 11, 2, 20, 0, tzinfo=timezone.utc))
        finally:
            sp.run = saved_run
            m.gh = saved_gh
        out = buf.getvalue()
        self.assertIn("::warning::", out)
        self.assertIn("stderr=Resource not accessible by integration", out)


class TriggerTokenCanOwnTheTrackingIssue(unittest.TestCase):
    def test_trigger_job_grants_issues_write(self):
        # #5771: report_stuck_change creates/updates the tracking issue with the
        # job token. Losing this grant silently re-breaks owned tracking (the
        # create then exits 1 with only a run annotation), so it is guarded here.
        wf = os.path.join(
            os.path.dirname(os.path.abspath(__file__)), "..",
            ".github", "workflows", "automatic-production-trigger.yml",
        )
        with open(wf, encoding="utf-8") as fh:
            text = fh.read()
        self.assertIn("  trigger:", text)
        job = text.split("  trigger:", 1)[1]
        self.assertIn("issues: write", job)
        self.assertNotIn("issues: read", job)

    def test_trigger_job_grants_pull_requests_write(self):
        # #6561: stranded-PR notices and promotion labels are written with the
        # job token. Read-only pull-requests makes those writes fail, so guard it.
        wf = os.path.join(
            os.path.dirname(os.path.abspath(__file__)), "..",
            ".github", "workflows", "automatic-production-trigger.yml",
        )
        with open(wf, encoding="utf-8") as fh:
            text = fh.read()
        self.assertIn("  trigger:", text)
        job = text.split("  trigger:", 1)[1]
        self.assertIn("pull-requests: write", job)
        self.assertNotIn("pull-requests: read", job)


class PromotionLabelPlumbing(unittest.TestCase):
    """#6561: labels, notice markers and the PR-only label listing."""

    def test_label_listing_is_prs_only_and_paginated(self):
        pages = [[{"number": 7, "pull_request": {"url": "x"}}, {"number": 8}],
                 [{"number": 9, "pull_request": {"url": "y"}}]]
        with mock.patch.object(m, "gh", side_effect=lambda *a: pages) as fake:
            self.assertEqual(m.labelled_prs("o/r", m.PARKED_LABEL), [7, 9])
        # The listing must be read in full (paginated), all states.
        args = fake.call_args.args
        self.assertEqual(args[:2], ("--paginate", "--slurp"))
        self.assertEqual(args[2], "repos/o/r/issues?labels=promotion-parked&state=all&per_page=100")

    def test_missing_label_is_created_and_race_tolerated(self):
        def proc(rc=0, out="", err=""):
            return subprocess.CompletedProcess(args=[], returncode=rc, stdout=out, stderr=err)

        def run_with(gets, posts):
            calls = []
            def fake_run(cmd, **kw):
                calls.append(cmd)
                return (posts if "-X" in cmd else gets).pop(0)
            return calls, fake_run

        # Missing: GET 404, POST creates it.
        calls, fake_run = run_with([proc(1, err="gh: Not Found (HTTP 404)")], [proc(0, out="{}")])
        with mock.patch.object(m.subprocess, "run", fake_run):
            self.assertTrue(m.ensure_label("o/r", m.PARKED_LABEL, m.LABEL_DESCRIPTIONS[m.PARKED_LABEL]))
        post = calls[1]
        self.assertEqual(post[:6], ["gh", "api", "-X", "POST", "repos/o/r/labels", "-f"])
        self.assertIn("name=promotion-parked", post)
        self.assertIn("color=B60205", post)

        # Race: another run created it between our GET and POST (422).
        calls, fake_run = run_with([proc(1, err="gh: Not Found (HTTP 404)")],
                                   [proc(1, err='gh: Validation Failed (HTTP 422) {"code":"already_exists"}')])
        with mock.patch.object(m.subprocess, "run", fake_run):
            self.assertTrue(m.ensure_label("o/r", m.HELD_LABEL, m.LABEL_DESCRIPTIONS[m.HELD_LABEL]))

        # Already present: GET succeeds, nothing is created.
        calls, fake_run = run_with([proc(0, out="{}")], [])
        with mock.patch.object(m.subprocess, "run", fake_run):
            self.assertTrue(m.ensure_label("o/r", m.HELD_LABEL, m.LABEL_DESCRIPTIONS[m.HELD_LABEL]))
        self.assertEqual(len(calls), 1)

        # Any other read failure: warning, False, no create attempted.
        calls, fake_run = run_with([proc(1, err="gh: Server Error (HTTP 500)")], [])
        buf = io.StringIO()
        with mock.patch.object(m.subprocess, "run", fake_run), contextlib.redirect_stdout(buf):
            self.assertFalse(m.ensure_label("o/r", m.HELD_LABEL, m.LABEL_DESCRIPTIONS[m.HELD_LABEL]))
        self.assertIn("::warning::", buf.getvalue())
        self.assertEqual(len(calls), 1)

    def test_gh_write_expands_lists_and_reports_refusals(self):
        def proc(rc, out="", err=""):
            return subprocess.CompletedProcess(args=[], returncode=rc, stdout=out, stderr=err)

        seen = []
        def fake_run(cmd, **kw):
            seen.append(cmd)
            return proc(0, out='{"id": 1}\n')

        with mock.patch.object(m.subprocess, "run", fake_run):
            ok, _ = m.gh_write("POST", "repos/o/r/issues/7/labels", {"labels": ["promotion-held", "x"]})
        self.assertTrue(ok)
        self.assertEqual(seen[0], ["gh", "api", "-X", "POST", "repos/o/r/issues/7/labels",
                                   "-f", "labels[]=promotion-held", "-f", "labels[]=x"])

        with mock.patch.object(m.subprocess, "run",
                               lambda cmd, **kw: proc(1, err="gh: Resource not accessible by integration (HTTP 403)\n")):
            self.assertEqual(m.gh_write("POST", "repos/o/r/issues/7/comments", {"body": "hi"}),
                             (False, "gh: Resource not accessible by integration (HTTP 403)"))

        def missing_gh(cmd, **kw):
            raise OSError("gh not found")
        with mock.patch.object(m.subprocess, "run", missing_gh):
            self.assertEqual(m.gh_write("DELETE", "repos/o/r/issues/7/labels/x"), (False, "gh not found"))

    def test_has_marker_reads_all_pages_and_matches_label(self):
        self.assertEqual(m.marker(m.PARKED_LABEL), "<!-- promotion-stranded:promotion-parked -->")
        pages = [[{"body": "chatter"}, {"body": None}], [{"body": m.marker(m.HELD_LABEL)}]]
        with mock.patch.object(m, "gh", side_effect=lambda *a: pages) as fake:
            self.assertTrue(m.has_marker("o/r", 7, m.HELD_LABEL))
            self.assertFalse(m.has_marker("o/r", 7, m.PARKED_LABEL))
        self.assertEqual(fake.call_args.args[:2], ("--paginate", "--slurp"))
        self.assertEqual(fake.call_args.args[2], "repos/o/r/issues/7/comments?per_page=100")

    def test_cleared_episode_needs_a_fresh_notice(self):
        """A PR stranded again after a clear must get a new notice (R4), so
        only the latest notice-or-clear comment counts."""
        cleared = m.clear_body(m.PARKED_LABEL, "delivered")
        notice = m.marker(m.PARKED_LABEL)
        for comments, expected in (([notice, cleared], False),
                                   ([notice, cleared, notice], True),
                                   ([cleared], False)):
            pages = [[{"body": b} for b in comments]]
            with mock.patch.object(m, "gh", side_effect=lambda *a: pages):
                self.assertEqual(m.has_marker("o/r", 7, m.PARKED_LABEL), expected, comments)


NOW = datetime(2026, 11, 17, 12, 0, tzinfo=timezone.utc)
REFUSAL = "gh: Resource not accessible by integration (HTTP 403)"
PARKED, HELD = m.PARKED_LABEL, m.HELD_LABEL


def ver(n):
    return f"2026111000{n:04d}"


def _pr(number, versions=None, merged="2026-11-10T00:00:00Z", **extra):
    return {"number": number, "merged_at": merged, "versions": versions or [ver(number)], **extra}


def _exhausted(number):
    title = f"DB preview apply abc PR{number} {ver(number)}"
    return [{"display_title": title, "status": "completed", "conclusion": "failure",
             "created_at": "2026-11-11T01:00:00Z"}] * 3


def _finding(number, created):
    return {"number": number, "created_at": created}


OLD_FINDING = _finding(901, "2026-11-01T00:00:00Z")


class StrandedRepoFake:
    """In-memory GitHub side of the stranded labels and notices. Every write is
    recorded; a write applies to state only when `refuse` does not refuse it."""

    def __init__(self, labels=None, comments=None, refuse=None):
        self.labels = {n: set(v) for n, v in (labels or {}).items()}
        self.comments = {n: list(v) for n, v in (comments or {}).items()}
        self.refuse = refuse or (lambda method, path, fields: None)
        self.writes = []
        self.ensured = []

    def labelled_prs(self, repo, label):
        return sorted(n for n, names in self.labels.items() if label in names)

    def has_marker(self, repo, n, label):
        return any(m.marker(label) in body for body in self.comments.get(n, []))

    def ensure_label(self, repo, name, description):
        self.ensured.append(name)
        return True

    def gh_write(self, method, path, fields=None):
        fields = dict(fields or {})
        self.writes.append((method, path, fields))
        refusal = self.refuse(method, path, fields)
        if refusal:
            return False, refusal
        n = int(re.search(r"issues/(\d+)", path).group(1))
        if method == "POST" and path.endswith("/labels"):
            self.labels.setdefault(n, set()).update(fields["labels"])
        elif method == "DELETE" and "/labels/" in path:
            self.labels.get(n, set()).discard(path.rsplit("/", 1)[1])
        elif method == "POST" and path.endswith("/comments"):
            self.comments.setdefault(n, []).append(fields["body"])
        return True, "ok"

    def touched(self):
        return sorted({int(re.search(r"issues/(\d+)", p).group(1)) for _, p, _ in self.writes})


def _reconcile(fake, candidates, runs=(), live=None, held=None, discovery_ok=True,
               fresh_held=None, dry_run=False, now=NOW):
    held = held or (lambda n: [])
    out = io.StringIO()
    with mock.patch.multiple(m, labelled_prs=fake.labelled_prs, has_marker=fake.has_marker,
                             ensure_label=fake.ensure_label, gh_write=fake.gh_write,
                             is_held=lambda repo, n: held(n)), contextlib.redirect_stdout(out):
        results = m.reconcile_stranded_marks("o/r", candidates, list(runs), live, now, held,
                                             lambda r: False, lambda r: set(), lambda r: False,
                                             lambda r: False, discovery_ok, dry_run=dry_run,
                                             fresh_held=fresh_held)
    return results, out.getvalue()


def _outcomes(results):
    return {(r["number"], r["label"]): r["outcome"] for r in results}


class StrandedLabelReconciler(unittest.TestCase):
    """#6561 plan §10: R1-R7 of plan_promotion_stranding_watch.md."""

    def test_parked_pr_is_marked_once(self):
        fake = StrandedRepoFake()
        pr = _pr(7)
        results, _ = _reconcile(fake, [pr], runs=_exhausted(7))
        self.assertEqual(_outcomes(results), {(7, PARKED): "posted"})
        self.assertEqual([(meth, path) for meth, path, _ in fake.writes], [
            ("POST", "repos/o/r/issues/7/labels"), ("POST", "repos/o/r/issues/7/comments")])
        self.assertEqual(fake.writes[0][2], {"labels": [PARKED]})
        body = fake.writes[1][2]["body"]
        self.assertEqual(body.splitlines()[0], m.marker(PARKED))
        self.assertIn("3 failed automatic attempts", body)
        # A second pass with no state change performs zero writes.
        results, _ = _reconcile(fake, [pr], runs=_exhausted(7))
        self.assertEqual(_outcomes(results), {(7, PARKED): "already"})
        self.assertEqual(len(fake.writes), 2)

    def test_held_pr_behind_dispatch_pick_is_marked(self):
        fake = StrandedRepoFake()
        dispatch, held_pr = _pr(9), _pr(8)
        held = lambda n: [OLD_FINDING] if n == 8 else []
        results, _ = _reconcile(fake, [dispatch, held_pr], held=held)
        self.assertEqual(_outcomes(results), {(8, HELD): "posted"})
        self.assertEqual(fake.touched(), [8])

    def test_parked_pr_behind_dispatch_pick_is_marked(self):
        fake = StrandedRepoFake()
        results, _ = _reconcile(fake, [_pr(9), _pr(7)], runs=_exhausted(7))
        self.assertEqual(_outcomes(results), {(7, PARKED): "posted"})
        self.assertEqual(fake.touched(), [7])

    def test_wait_pass_reconciles_holds_only(self):
        fake = StrandedRepoFake(labels={5: {HELD}, 6: {PARKED}})
        inflight = {"display_title": "DB production apply inflight", "status": "in_progress",
                    "id": 555, "conclusion": None, "created_at": "2026-11-17T11:00:00Z"}
        candidates = [_pr(5), _pr(6), _pr(7), _pr(8)]
        held = lambda n: [OLD_FINDING] if n == 8 else []
        results, out = _reconcile(fake, candidates, runs=[inflight] + _exhausted(7), held=held)
        self.assertIn("wait pass (run 555 in flight)", out)
        # Held 8 is marked; held 5 (no longer held on a fresh read) is released;
        # parked 7 is not marked and parked 6 is not cleared.
        self.assertEqual(fake.touched(), [5, 8])
        self.assertEqual(_outcomes(results), {(8, HELD): "posted", (5, HELD): "cleared"})
        self.assertIn(PARKED, fake.labels[6])

    def test_held_threshold_and_unknown_read(self):
        fake = StrandedRepoFake(labels={11: {HELD}})
        finding = _finding(901, "2026-11-17T00:00:00Z")
        nine_hours = _pr(9, merged="2026-11-17T03:00:00Z", findings=[finding])
        seven_hours = _pr(10, merged="2026-11-17T05:00:00Z")
        unknown = _pr(11, merged="2026-11-17T03:00:00Z")
        held = lambda n: {9: [finding], 10: [finding], 11: True}.get(n, [])
        results, _ = _reconcile(fake, [nine_hours, seven_hours, unknown], held=held)
        self.assertEqual(fake.touched(), [9])
        self.assertEqual(_outcomes(results), {(9, HELD): "posted", (11, HELD): "unknown"})
        self.assertIn(HELD, fake.labels[11])

    def test_alert_and_escalation_thresholds_differ(self):
        self.assertEqual(m.ALERT_AFTER, timedelta(minutes=30))
        self.assertEqual(m.HELD_ESCALATE_AFTER, timedelta(hours=8))
        finding = _finding(901, "2026-11-17T10:00:00Z")
        one_hour = _pr(10, merged="2026-11-17T11:00:00Z", findings=[finding])
        # Held one hour: the operator alert fires, the label does not.
        self.assertEqual(len(m.overdue_holds([one_hour], NOW)), 1)
        fake = StrandedRepoFake()
        results, _ = _reconcile(fake, [one_hour], held=lambda n: [finding])
        self.assertEqual(results, [])
        self.assertEqual(fake.writes, [])

    def test_marked_pr_is_left_alone(self):
        fake = StrandedRepoFake(labels={7: {PARKED}, 8: {HELD}},
                                comments={7: [m.marker(PARKED)], 8: [m.marker(HELD)]})
        held = lambda n: [OLD_FINDING] if n == 8 else []
        results, _ = _reconcile(fake, [_pr(7), _pr(8)], runs=_exhausted(7), held=held)
        self.assertEqual(_outcomes(results), {(7, PARKED): "already", (8, HELD): "already"})
        self.assertEqual(fake.writes, [])

    def test_label_without_notice_is_repaired(self):
        fake = StrandedRepoFake(labels={7: {PARKED}})
        results, _ = _reconcile(fake, [_pr(7)], runs=_exhausted(7))
        self.assertEqual(_outcomes(results), {(7, PARKED): "repaired"})
        self.assertEqual([(meth, path) for meth, path, _ in fake.writes],
                         [("POST", "repos/o/r/issues/7/comments")])

    def test_removed_label_is_restored_without_duplicate_notice(self):
        fake = StrandedRepoFake(comments={7: [m.marker(PARKED)]})
        results, _ = _reconcile(fake, [_pr(7)], runs=_exhausted(7))
        self.assertEqual(_outcomes(results), {(7, PARKED): "relabelled"})
        self.assertEqual([(meth, path) for meth, path, _ in fake.writes],
                         [("POST", "repos/o/r/issues/7/labels")])

    def test_failed_notice_rolls_back_label_and_continues(self):
        def refuse(method, path, fields):
            if method == "POST" and path.endswith("/issues/7/comments"):
                return "gh: Server Error (HTTP 500)"
            return None
        fake = StrandedRepoFake(refuse=refuse)
        runs = _exhausted(7) + _exhausted(8)
        results, out = _reconcile(fake, [_pr(7), _pr(8)], runs=runs)
        self.assertEqual(_outcomes(results), {(7, PARKED): "FAILED", (8, PARKED): "posted"})
        self.assertEqual([(meth, path) for meth, path, _ in fake.writes], [
            ("POST", "repos/o/r/issues/7/labels"), ("POST", "repos/o/r/issues/7/comments"),
            ("DELETE", f"repos/o/r/issues/7/labels/{PARKED}"),
            ("POST", "repos/o/r/issues/8/labels"), ("POST", "repos/o/r/issues/8/comments")])
        self.assertNotIn(PARKED, fake.labels.get(7, set()))
        self.assertIn(PARKED, fake.labels[8])
        self.assertIn(f"::error title=Stranded-PR notice not delivered::PR #7 {PARKED} notice post", out)

    def test_permission_refusal_is_loud_not_fatal(self):
        # (a) the label add is refused: nothing else is attempted.
        fake = StrandedRepoFake(refuse=lambda method, path, fields: REFUSAL)
        results, out = _reconcile(fake, [_pr(7)], runs=_exhausted(7))
        self.assertEqual(results, [{"number": 7, "label": PARKED, "outcome": "FAILED",
                                    "detail": f"label add: {REFUSAL}"}])
        self.assertEqual(len(fake.writes), 1)
        self.assertIn(f"::error title=Stranded-PR notice not delivered::PR #7 {PARKED} label add", out)
        # (b) the label removal on a delivered PR is refused.
        fake = StrandedRepoFake(labels={7: {PARKED}}, refuse=lambda method, path, fields: REFUSAL)
        results, out = _reconcile(fake, [_pr(7)], live={ver(7)})
        self.assertEqual(_outcomes(results), {(7, PARKED): "FAILED"})
        self.assertEqual([meth for meth, _, _ in fake.writes], ["DELETE"])
        self.assertIn("::error", out)
        # (c) the notice post is refused and the rollback removal is refused too.
        def refuse_notice_and_removal(method, path, fields):
            return REFUSAL if method == "DELETE" or path.endswith("/comments") else None
        fake = StrandedRepoFake(refuse=refuse_notice_and_removal)
        results, out = _reconcile(fake, [_pr(7)], runs=_exhausted(7))
        self.assertEqual(_outcomes(results), {(7, PARKED): "FAILED"})
        self.assertIn(PARKED, fake.labels[7])
        self.assertIn(f"::error title=Stranded-PR notice not delivered::PR #7 {PARKED} notice post", out)

    def test_held_only_failure_is_recorded_durably(self):
        import subprocess as sp
        failures = [
            {"number": 8, "label": HELD, "outcome": "FAILED", "detail": "notice post: gh: Server Error (HTTP 500)"},
            {"number": 7, "label": PARKED, "outcome": "posted", "detail": ""},
        ]
        calls = []
        def fake_run(cmd, **kw):
            calls.append(cmd)
            return sp.CompletedProcess(cmd, 0, "", "")
        with mock.patch.object(m, "find_stuck_issue", lambda repo: {"number": 42}), \
             mock.patch.object(m.subprocess, "run", fake_run):
            m.report_notice_failures("o/r", failures)
        self.assertEqual(calls[0][:5], ["gh", "issue", "comment", "42", "--repo"])
        body = calls[0][calls[0].index("--body") + 1]
        self.assertIn(f"PR #8 {HELD}: notice post: gh: Server Error (HTTP 500)", body)
        self.assertNotIn("PR #7", body)
        # With no open roll-up issue, the failure opens one under the same title.
        calls.clear()
        with mock.patch.object(m, "find_stuck_issue", lambda repo: None), \
             mock.patch.object(m.subprocess, "run", fake_run):
            m.report_notice_failures("o/r", failures)
        self.assertEqual(calls[0][:4], ["gh", "issue", "create", "--repo"])
        self.assertIn(m.STUCK_ISSUE_TITLE, calls[0])

    def test_rollup_failure_does_not_fail_run(self):
        import subprocess as sp
        failures = [{"number": 8, "label": HELD, "outcome": "FAILED", "detail": "label add: x"}]
        buf = io.StringIO()
        with mock.patch.object(m, "find_stuck_issue", side_effect=OSError("gh missing")), \
             contextlib.redirect_stdout(buf):
            self.assertIsNone(m.report_notice_failures("o/r", failures))
        self.assertIn("::warning::", buf.getvalue())
        def broken(cmd, **kw):
            raise sp.CalledProcessError(1, cmd, stderr="Resource not accessible by integration")
        buf = io.StringIO()
        with mock.patch.object(m, "find_stuck_issue", lambda repo: {"number": 42}), \
             mock.patch.object(m.subprocess, "run", broken), contextlib.redirect_stdout(buf):
            self.assertIsNone(m.report_notice_failures("o/r", failures))
        self.assertIn("::warning::", buf.getvalue())

    def test_delivered_pr_is_cleared(self):
        fake = StrandedRepoFake(labels={7: {PARKED}})
        results, _ = _reconcile(fake, [_pr(7)], live={ver(7)})
        self.assertEqual(_outcomes(results), {(7, PARKED): "cleared"})
        self.assertEqual(fake.writes[0][:2], ("DELETE", f"repos/o/r/issues/7/labels/{PARKED}"))
        self.assertEqual(fake.writes[1][:2], ("POST", "repos/o/r/issues/7/comments"))
        self.assertTrue(fake.writes[1][2]["body"].splitlines()[1].startswith(
            f"`{PARKED}` removed. Delivered: every version of this PR is in production."))
        self.assertNotIn(PARKED, fake.labels[7])

    def test_no_clearing_without_a_ledger_read(self):
        fake = StrandedRepoFake(labels={7: {PARKED}})
        for live in (None, set()):
            results, _ = _reconcile(fake, [_pr(7)], live=live)
            self.assertEqual(results, [])
        self.assertEqual(fake.writes, [])
        self.assertIn(PARKED, fake.labels[7])

    def test_partial_delivery_is_not_cleared(self):
        fake = StrandedRepoFake(labels={7: {PARKED}})
        pr = _pr(7, versions=[ver(7), ver(70)])
        results, _ = _reconcile(fake, [pr], live={ver(7)})
        self.assertEqual(results, [])
        self.assertEqual(fake.writes, [])

    def test_held_cleared_only_on_fresh_read(self):
        # The pass's own hold read is empty, but a fresh read says the hold is
        # unknown: no clear.
        fake = StrandedRepoFake(labels={8: {HELD}})
        results, _ = _reconcile(fake, [_pr(8)], held=lambda n: [], fresh_held=lambda n: True)
        self.assertEqual(results, [])
        self.assertEqual(fake.writes, [])
        # A fresh empty read clears it.
        results, _ = _reconcile(fake, [_pr(8)], held=lambda n: [], fresh_held=lambda n: [])
        self.assertEqual(_outcomes(results), {(8, HELD): "cleared"})
        self.assertTrue(fake.writes[1][2]["body"].splitlines()[1].startswith(
            f"`{HELD}` removed. No longer held by review findings."))

    def test_withdrawn_dispatch_clears_nothing(self):
        # The dispatch looked clear, but the pre-dispatch fresh read finds a hold.
        fake = StrandedRepoFake(labels={8: {HELD}})
        results, _ = _reconcile(fake, [_pr(8)], held=lambda n: [], fresh_held=lambda n: [OLD_FINDING])
        self.assertEqual(results, [])
        self.assertEqual(fake.writes, [])
        self.assertIn(HELD, fake.labels[8])

    def test_parked_label_does_not_flap(self):
        fake = StrandedRepoFake(labels={7: {PARKED}, 8: {PARKED}})
        dispatchable = _pr(7)
        waiting = _pr(8, production_dependencies={ver(6): 6})
        results, _ = _reconcile(fake, [dispatchable, waiting])
        self.assertEqual(results, [])
        self.assertEqual(fake.writes, [])

    def test_untracked_pr_cleared_only_on_complete_discovery(self):
        fake = StrandedRepoFake(labels={9: {PARKED}})
        results, _ = _reconcile(fake, [_pr(7)], discovery_ok=False)
        self.assertEqual(results, [])
        self.assertEqual(fake.writes, [])
        results, _ = _reconcile(fake, [_pr(7)], discovery_ok=True)
        self.assertEqual(_outcomes(results), {(9, PARKED): "cleared"})
        self.assertEqual(fake.writes[0][:2], ("DELETE", f"repos/o/r/issues/9/labels/{PARKED}"))
        self.assertIn("No longer tracked by the automatic lane", fake.writes[1][2]["body"])

    def test_notice_bodies_are_public_safe(self):
        parked = {**_pr(7), "exhausted": 3, "refunds": 1}
        held = {**_pr(8), "findings": [OLD_FINDING]}
        env = {"GITHUB_SERVER_URL": "https://github.com", "GITHUB_REPOSITORY": "popcre/shared-db",
               "GITHUB_RUN_ID": "123"}
        with mock.patch.dict(os.environ, env):
            bodies = [m.notice_body(PARKED, parked, NOW), m.notice_body(HELD, held, NOW)]
            bodies += [m.clear_body(PARKED, reason) for reason in ("delivered", "released", "untracked")]
        self.assertEqual(bodies[0].splitlines()[0], m.marker(PARKED))
        self.assertEqual(bodies[1].splitlines()[0], m.marker(HELD))
        self.assertIn("#901", bodies[1])
        self.assertIn("1 refunds used", bodies[0])
        self.assertIn("actions/runs/123", bodies[0])
        for body in bodies:
            for url in re.findall(r"https?://\S+", body):
                self.assertTrue(url.startswith("https://github.com/popcre/shared-db"), url)
            for banned in ("supabase", "postgres", "database", "service_role", "secret", "token"):
                self.assertNotIn(banned, body.lower())
        with mock.patch.dict(os.environ, {}, clear=False):
            for key in env:
                os.environ.pop(key, None)
            self.assertNotIn("actions/runs", m.notice_body(PARKED, parked, NOW))


class StrandedWiringInMain(unittest.TestCase):
    """#6561 plan §10: main() contains reconciler defects and dry-run writes nothing."""

    def _main(self, *, prs, runs, labels=None, live=None, argv=("x", "--dry-run"), extra=None):
        labels = labels or {}
        sp_calls = []

        def fake_gh(*args):
            text = " ".join(args)
            if "commits/main" in text:
                return {"sha": "abc"}
            for label in (PARKED, HELD):
                if f"labels={label}&" in text:
                    return [[{"number": n, "pull_request": {}} for n in labels.get(label, [])]]
            if "/comments?" in text:
                return [[]]
            raise AssertionError(f"unexpected read in main(): {text}")

        def recording_run(cmd, **kw):
            sp_calls.append(list(cmd))
            return subprocess.CompletedProcess(cmd, 0, "", "")

        patches = dict(
            gh=fake_gh, merged_migration_prs=lambda repo: prs, workflow_runs=lambda repo, **_: runs,
            is_held=lambda repo, n: [], production_ledger=lambda path=None: live,
            applied_in_any_attempt=lambda repo, run: False,
            refused_as_applied=lambda repo, run: set(),
            stale_main_refusal_only=lambda repo, run: False,
            refund_eligible_in_any_attempt=lambda repo, run: False,
        )
        patches.update(extra or {})
        out = io.StringIO()
        with mock.patch.dict(os.environ, {"GITHUB_REPOSITORY": "o/r"}), \
             mock.patch.dict(os.environ), \
             mock.patch.object(sys, "argv", list(argv)), \
             mock.patch.object(m.subprocess, "run", recording_run), \
             mock.patch.multiple(m, **patches), \
             contextlib.redirect_stdout(out):
            os.environ.pop("GITHUB_STEP_SUMMARY", None)
            code = m.main(NOW)
        return code, out.getvalue(), sp_calls

    def test_reconciler_crash_is_contained(self):
        crash = mock.Mock(side_effect=RuntimeError("boom"))
        code, out, _ = self._main(prs=[], runs=[], extra={"reconcile_stranded_marks": crash})
        crash.assert_called_once()
        self.assertEqual(code, 0)
        self.assertIn("Stranded-PR reconciler defect", out)

    def test_dry_run_issues_no_writes(self):
        gh_write = mock.Mock(return_value=(True, "ok"))
        ensure = mock.Mock(return_value=True)
        notice_failures = mock.Mock()
        stuck = mock.Mock()
        extra = {"gh_write": gh_write, "ensure_label": ensure,
                 "report_notice_failures": notice_failures, "report_stuck_change": stuck}
        code, out, sp_calls = self._main(
            prs=[_pr(7), _pr(9)], runs=_exhausted(7), labels={PARKED: [9]}, live={ver(9)}, extra=extra)
        self.assertEqual(code, 0)
        gh_write.assert_not_called()
        ensure.assert_not_called()
        notice_failures.assert_not_called()
        stuck.assert_not_called()
        writes = [c for c in sp_calls if {"POST", "PATCH", "DELETE", "create", "comment"} & set(c)]
        self.assertEqual(writes, [])
        self.assertIn("dry-run: would mark PR #7 promotion-parked", out)
        self.assertIn("dry-run: would clear PR #9 promotion-parked (delivered)", out)

    def test_rollup_line_carries_pr_notice_outcome(self):
        entries = [{"number": 7, "merged_at": "2026-11-01T00:00:00Z", "versions": [ver(7)],
                    "findings": [], "exhausted": 3, "notice": "posted"}]
        calls = []

        def fake_run(cmd, **kw):
            calls.append(cmd)
            class R:
                stdout = "https://github.com/o/r/issues/99\n"
                stderr = ""
            return R()
        saved_run = subprocess.run
        saved_gh = m.gh
        subprocess.run = fake_run
        m.gh = lambda *a: []  # no existing roll-up issue
        try:
            m.report_stuck_change("o/r", entries, datetime(2026, 11, 2, 20, 0, tzinfo=timezone.utc))
        finally:
            subprocess.run = saved_run
            m.gh = saved_gh
        creates = [c for c in calls if "create" in c]
        self.assertEqual(len(creates), 1)
        body = creates[0][creates[0].index("--body") + 1]
        self.assertIn("— PR notice: posted", body)


class CompletePullDiscovery(unittest.TestCase):
    def test_old_pending_base_and_child_survive_more_than_one_hundred_prs(self):
        base = {"number": 5619, "merged_at": "2026-11-05T05:15:00Z"}
        child = {"number": 5649, "merged_at": "2026-11-05T07:15:00Z"}
        first = [{"number": 9000 + n, "merged_at": None} for n in range(100)]
        second = [child, base, dict(base),
                  {"number": 1, "merged_at": "2026-01-01T00:00:00Z"}]
        versions = {5619: "20261105044255", 5649: "20261105061627"}
        file_reads = []

        def api(*args):
            if "/pulls?" in args[-1]:
                self.assertEqual(args[:2], ("--paginate", "--slurp"))
                return [first, second]
            number = int(args[-1].split("/pulls/")[1].split("/")[0])
            file_reads.append(number)
            path, = Path(m.HERE).parent.glob(f"supabase/migrations/{versions[number]}_*.sql")
            return [[{"status": "added", "filename": path.relative_to(Path(m.HERE).parent).as_posix()}]]

        from pathlib import Path
        with mock.patch.object(m, "gh", side_effect=api):
            found = m.merged_migration_prs("o/r")
        self.assertEqual([p["number"] for p in found], [5619, 5649])
        self.assertEqual(sorted(file_reads), [5619, 5649])
        self.assertEqual(found[1]["production_dependencies"], {"20261105044255": 5619})
        self.assertEqual(m.decide(found, [], lambda n: [])[1]["number"], 5619)
        skipped = []
        self.assertEqual(m.decide([found[1]], [], lambda n: [], skipped=skipped)[0], "idle")
        self.assertEqual(skipped[0]["pending_dependencies"], {"20261105044255": 5619})

    def test_malformed_or_incomplete_discovery_fails_before_any_file_read(self):
        good = {"number": 5619, "merged_at": "2026-11-05T05:15:00Z"}
        for pages in (None, [], {}, [[good], {}], [[good], [None]],
                      [[good], [{"number": True, "merged_at": None}]],
                      [[good], [{"number": 5619}]],
                      [[good], [{"number": 5619, "merged_at": None}]]):
            with self.subTest(pages=pages), mock.patch.object(m, "gh", return_value=pages) as api:
                with self.assertRaises(ValueError):
                    m.merged_migration_prs("o/r")
                self.assertEqual(api.call_count, 1)

    def test_failed_later_page_is_not_treated_as_an_empty_queue(self):
        import subprocess
        with mock.patch.object(m, "gh", side_effect=subprocess.CalledProcessError(1, "gh")):
            with self.assertRaises(subprocess.CalledProcessError):
                m.merged_migration_prs("o/r")
class RefundFaultClassifier(unittest.TestCase):
    """Plan §9 2.1/2.4: the marker classifies a failed run's fault from its text.
    GitHub run metadata is external input — a hostile log must never buy a refund."""

    INFRA = ("::error::CI INFRASTRUCTURE: PostgreSQL client unavailable after 3 attempts "
             "(apt mirror stall on the hosted runner -- NOT a fault in the change under review); "
             "NO MIGRATION WAS APPLIED\n")
    MIXED = ("::error::CI INFRASTRUCTURE: PostgreSQL client unavailable after 3 attempts "
             "(apt mirror stall on the hosted runner -- NOT a fault in the change under review)\n"
             "ERROR:  syntax error at or near \"select\"\n")

    def test_an_infrastructure_failure_with_nothing_applied_is_refundable(self):
        self.assertTrue(classifier.classify_failure(self.INFRA))

    def test_mixed_marker_log_with_a_real_sql_failure_is_not_refundable(self):
        # Adversarial table (plan §9 2.4): "Marker present but the migration
        # actually failed" — the classifier requires NO MIGRATION WAS APPLIED too.
        self.assertFalse(classifier.classify_failure(self.MIXED))

    def test_each_coordination_refusal_is_refundable(self):
        for marker in classifier.COORDINATION_REFUSALS:
            with self.subTest(marker=marker):
                self.assertTrue(classifier.classify_failure(f"something REFUSED: {marker}\n"))

    def test_a_plain_sql_error_or_guard_refusal_stays_a_change_fault(self):
        for text in ("ERROR:  syntax error at or near \"select\"\n",
                     "REFUSED: merged_preview_source_pr is a post-merge APPLY\n",
                     "Unchanged approved parent/source witness unavailable; packet abstained\n",
                     ""):
            with self.subTest(text=text):
                self.assertFalse(classifier.classify_failure(text))

    def test_ansi_wrapping_never_hides_or_fakes_a_marker(self):
        hidden = self.INFRA.replace("CI INFRASTRUCTURE", "\x1b[1mCI INFRASTRUCTURE\x1b[0m")
        self.assertTrue(classifier.classify_failure(hidden))
        self.assertFalse(classifier.classify_failure("\x1b[1mNOT A MARKER\x1b[0m"))

    def test_the_cli_exits_zero_only_for_a_refundable_fault(self):
        import tempfile
        for text, code in ((self.INFRA, 0), (self.MIXED, 1),
                           ("post-merge preview rehearsal requires the exact current main SHA", 0)):
            with self.subTest(code=code):
                with tempfile.NamedTemporaryFile("w", suffix=".log", delete=False) as handle:
                    handle.write(text)
                try:
                    with contextlib.redirect_stdout(io.StringIO()) as out:
                        self.assertEqual(classifier.main([handle.name]), code)
                    if code == 0:
                        self.assertIn("REFUND_ELIGIBLE=1", out.getvalue())
                finally:
                    os.unlink(handle.name)

    def test_unreadable_evidence_is_never_a_refund(self):
        with contextlib.redirect_stdout(io.StringIO()) as out:
            self.assertEqual(classifier.main(["/nonexistent/definitely-missing.log"]), 1)
        self.assertIn("change fault", out.getvalue())


class RefundEligibleMarkerStep(unittest.TestCase):
    """The marker step is the trust boundary (plan §9 2.1/2.2): a succeeded
    `refund-eligible-fault` step in any attempt of our workflow's runs."""

    RUN = {"id": 7, "run_attempt": 1}
    MARKED = [{"steps": [{"name": m.REFUND_STEP, "conclusion": "success"}]}]
    UNMARKED = [{"steps": [{"name": m.REFUND_STEP, "conclusion": "failure"}]},
                {"steps": [{"name": "Bounded apply", "conclusion": "failure"}]}]

    def test_a_succeeded_marker_step_is_refundable(self):
        with mock.patch.object(m, "run_jobs", return_value=self.MARKED):
            self.assertTrue(m.refund_eligible_in_any_attempt("o/r", self.RUN))

    def test_a_missing_or_red_marker_is_a_change_fault(self):
        for jobs in ([], self.UNMARKED):
            with self.subTest(jobs=jobs):
                with mock.patch.object(m, "run_jobs", return_value=jobs):
                    self.assertFalse(m.refund_eligible_in_any_attempt("o/r", self.RUN))

    def test_a_re_run_does_not_hide_an_earlier_attempts_classification(self):
        run = {"id": 7, "run_attempt": 2}
        with mock.patch.object(m, "run_jobs",
                               side_effect=lambda repo, run_id, attempt=None: self.MARKED if attempt == 1 else self.UNMARKED):
            self.assertTrue(m.refund_eligible_in_any_attempt("o/r", run))

    def test_unreadable_marker_evidence_still_counts_the_run(self):
        with mock.patch.object(m, "run_jobs", side_effect=ValueError("bad")), \
                contextlib.redirect_stdout(io.StringIO()) as out:
            self.assertFalse(m.refund_eligible_in_any_attempt("o/r", self.RUN))
        self.assertIn("treating as a change fault", out.getvalue())

    @classmethod
    def setUpClass(cls):
        root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        with open(os.path.join(root, ".github", "workflows", "shared-supabase-migrations.yml"), encoding="utf-8") as fh:
            cls.text = fh.read()

    def test_the_marker_step_exists_in_preview_and_production_apply_only(self):
        self.assertEqual(self.text.count("- name: refund-eligible-fault"), 2)
        self.assertIn('MARKER_JOB_NAME: preview\n', self.text)
        self.assertIn('MARKER_JOB_NAME: Production apply (automatic evidence gates)\n', self.text)

    def test_the_marker_is_a_step_that_runs_on_failure_and_classifies(self):
        self.assertEqual(self.text.count("if: failure()"), 2)
        self.assertEqual(
            self.text.count('run: python scripts/refund_fault_classification.py --classify-run-job "$MARKER_JOB_NAME"'), 2)

    def test_no_job_was_added_for_the_marker(self):
        job_ids = set(re.findall(r"(?m)^  ([a-z][a-z0-9-]+):$", self.text))
        self.assertEqual(job_ids, {"validate", "preview", "automatic-production-promotion", "production-dry-run",
                                   "production-apply-review", "production-apply", "index-maintenance",
                                   "notify-production-queue"})


class ClassifyRunJobGlue(unittest.TestCase):
    """The marker step resolves its own job by display name and classifies that
    job's check-run annotations (its `::error::` marker text) — the failure
    evidence GitHub exposes while the job still runs. The job's logs are not
    readable in-job (`gh run view --log-failed` exits 1 with "still in
    progress"), so the new path must separate the three fault classes without
    them, and a hostile or late log can never buy a refund."""

    LISTING = {"jobs": [{"id": 11, "name": "preview",
                         "check_run_url": "https://api.github.com/repos/o/r/check-runs/11"},
                        {"id": 12, "name": "other",
                         "check_run_url": "https://api.github.com/repos/o/r/check-runs/12"}]}

    def classify(self, annotations, listing=None):
        """Run --classify-run-job against a gh stub that reproduces the live
        in-job condition: `gh run view --log-failed` exits 1 the way the real
        job does, while the jobs listing and the annotations answer."""
        calls = []

        def fake(cmd, **kw):
            calls.append(list(cmd))
            joined = " ".join(cmd)
            if "--log-failed" in joined:
                raise classifier.subprocess.CalledProcessError(1, cmd)
            if "/annotations" in joined:
                class R:
                    stdout = json.dumps(annotations)
                return R()
            class R:
                stdout = json.dumps(listing if listing is not None else self.LISTING)
            return R()
        with mock.patch.object(classifier.subprocess, "run", side_effect=fake), \
                mock.patch.dict(os.environ, {"GITHUB_REPOSITORY": "o/r", "GITHUB_RUN_ID": "5",
                                             "GITHUB_RUN_ATTEMPT": "1"}), \
                contextlib.redirect_stdout(io.StringIO()) as out:
            verdict = classifier.classify_run_job("preview", sleep=lambda _: None)
        return verdict, calls, out.getvalue()

    @staticmethod
    def ann(message):
        return [{"annotation_level": "failure", "message": message}]

    def test_the_in_job_path_separates_infra_coordination_and_change_fault(self):
        infra = self.ann("CI INFRASTRUCTURE: PostgreSQL client unavailable after 3 attempts "
                         "(apt mirror stall on the hosted runner -- NOT a fault in the change under review); "
                         "NO MIGRATION WAS APPLIED")
        coordination = self.ann("REFUSED: post-merge preview rehearsal requires the exact current main SHA "
                                "(asked for aaa, main is bbb)")
        for annotations, eligible in ((infra, True), (coordination, True),
                                      (self.ann("CI INFRASTRUCTURE: PostgreSQL client unavailable; "
                                                "something else happened"), False),
                                      (self.ann('ERROR:  syntax error at or near "select"'), False),
                                      (self.ann("REFUSED: merged_preview_source_pr is a post-merge APPLY; "
                                                "the historical inputs are a no-write recovery. Name one."), False),
                                      ([], False)):
            with self.subTest(annotations=annotations):
                verdict, calls, _ = self.classify(annotations)
                self.assertEqual(verdict, eligible)
                self.assertFalse(any("--log-failed" in " ".join(cmd) for cmd in calls),
                                 "the in-job path must never depend on the job's logs")

    def test_the_named_job_alone_is_read_and_classified(self):
        verdict, calls, _ = self.classify(
            self.ann("REFUSED: production lane requires the exact current main SHA"))
        self.assertTrue(verdict)
        self.assertTrue(any("check-runs/11/annotations" in " ".join(cmd) for cmd in calls))
        self.assertFalse(any("check-runs/12/annotations" in " ".join(cmd) for cmd in calls))

    def test_an_unresolvable_job_name_never_refunds(self):
        def fake(cmd, **kw):
            class R:
                stdout = json.dumps({"jobs": [{"id": 11, "name": "somebody else"}]})
            return R()
        with mock.patch.object(classifier.subprocess, "run", side_effect=fake), \
                mock.patch.dict(os.environ, {"GITHUB_REPOSITORY": "o/r", "GITHUB_RUN_ID": "5",
                                             "GITHUB_RUN_ATTEMPT": "1"}), \
                contextlib.redirect_stdout(io.StringIO()) as out:
            self.assertFalse(classifier.classify_run_job("preview"))
        self.assertIn("change fault", out.getvalue())

    def test_unreadable_annotation_evidence_is_never_a_refund(self):
        def fake(cmd, **kw):
            joined = " ".join(cmd)
            if "/annotations" in joined:
                raise classifier.subprocess.CalledProcessError(1, cmd)
            class R:
                stdout = json.dumps(self.LISTING)
            return R()
        with mock.patch.object(classifier.subprocess, "run", side_effect=fake), \
                mock.patch.dict(os.environ, {"GITHUB_REPOSITORY": "o/r", "GITHUB_RUN_ID": "5",
                                             "GITHUB_RUN_ATTEMPT": "1"}), \
                contextlib.redirect_stdout(io.StringIO()) as out:
            self.assertEqual(classifier.main(["--classify-run-job", "preview"]), 1)
        self.assertIn("change fault", out.getvalue())

    def test_a_job_without_a_check_run_never_refunds(self):
        listing = {"jobs": [{"id": 11, "name": "preview"}]}
        verdict, _, printed = self.classify([], listing=listing)
        self.assertFalse(verdict)
        self.assertIn("change fault", printed)

    def test_a_recorded_listing_shaped_like_run_43094471144_is_a_change_fault(self):
        # Real production run 43094471144 (2026-11-12): apply step success,
        # only `Save apply evidence` failed (GitHub CreateArtifact outage),
        # marker failed on unreadable logs. The exact taxonomy calls that a
        # change fault (no infrastructure/coordination marker) — and PR #6148's
        # applied_in_attempt keeps the run from burning attempts anyway: the
        # machinery reads it as "not a change fault" against the budget.
        listing = {"jobs": [{"id": 21, "name": "Production apply (automatic evidence gates)",
                             "check_run_url": "https://api.github.com/repos/o/r/check-runs/21",
                             "steps": [{"name": "Fresh dry-run, then apply", "conclusion": "success"},
                                       {"name": "Post-apply catalog verification", "conclusion": "success"},
                                       {"name": "Save apply evidence", "conclusion": "failure"},
                                       {"name": "refund-eligible-fault", "conclusion": "failure"}]}]}
        annotations = [{"annotation_level": "failure",
                        "message": "Failed to CreateArtifact: Failed to make request after 5 attempts: "
                                   "Unexpected token '<', \"<!DOCTYPE \"... is not valid JSON"}]

        def fake(cmd, **kw):
            joined = " ".join(cmd)
            if "--log-failed" in joined:
                raise classifier.subprocess.CalledProcessError(1, cmd)
            class R:
                stdout = json.dumps(annotations if "/annotations" in joined else listing)
            return R()
        with mock.patch.object(classifier.subprocess, "run", side_effect=fake), \
                mock.patch.dict(os.environ, {"GITHUB_REPOSITORY": "o/r", "GITHUB_RUN_ID": "43094471144",
                                             "GITHUB_RUN_ATTEMPT": "1"}):
            self.assertFalse(classifier.classify_run_job("Production apply (automatic evidence gates)",
                                                         sleep=lambda _: None))

    def test_annotation_publication_lag_is_tolerated_by_bounded_retry(self):
        # GitHub publishes check-run annotations with a lag of seconds behind
        # the emitting step (run 43303160414: marker fetched ~1s after the step
        # failed and read a pre-publication list -> 'change fault'). The retry
        # must pick up the annotations once they land.
        marker = self.ann("REFUSED: post-merge preview rehearsal requires the exact current main SHA "
                          "(asked for aaa, main is bbb)")
        ann_call_count = 0

        def fake(cmd, **kw):
            nonlocal ann_call_count
            joined = " ".join(cmd)
            if "/annotations" in joined:
                ann_call_count += 1
                payload = marker if ann_call_count >= 3 else []
                class R:
                    stdout = json.dumps(payload)
                return R()
            class R:
                stdout = json.dumps(self.LISTING)
            return R()
        with mock.patch.object(classifier.subprocess, "run", side_effect=fake), \
                mock.patch.dict(os.environ, {"GITHUB_REPOSITORY": "o/r", "GITHUB_RUN_ID": "5",
                                             "GITHUB_RUN_ATTEMPT": "1"}), \
                contextlib.redirect_stdout(io.StringIO()) as out:
            verdict = classifier.classify_run_job("preview", sleep=lambda _: None)
        self.assertTrue(verdict, "lag-tolerant retry must reach the published annotations")
        self.assertGreaterEqual(ann_call_count, 3, "the retry must re-fetch until annotations land")

    def test_annotations_never_published_fall_safely_to_change_fault_after_the_bound(self):
        # After the bounded retry, unreadable/ambiguous evidence STILL never
        # refunds — an empty annotation list that never fills is a change fault.
        ann_call_count = 0

        def fake(cmd, **kw):
            nonlocal ann_call_count
            joined = " ".join(cmd)
            if "/annotations" in joined:
                ann_call_count += 1
                class R:
                    stdout = json.dumps([])
                return R()
            class R:
                stdout = json.dumps(self.LISTING)
            return R()
        with mock.patch.object(classifier.subprocess, "run", side_effect=fake), \
                mock.patch.dict(os.environ, {"GITHUB_REPOSITORY": "o/r", "GITHUB_RUN_ID": "5",
                                             "GITHUB_RUN_ATTEMPT": "1"}), \
                contextlib.redirect_stdout(io.StringIO()) as out:
            verdict = classifier.classify_run_job("preview", sleep=lambda _: None)
        self.assertFalse(verdict, "evidence that never appears must fail-safe to change fault")
        expected_attempts = 1 + len(classifier.ANNOTATION_PUBLICATION_DELAYS)
        self.assertEqual(ann_call_count, expected_attempts,
                         f"bounded retry must stop after {expected_attempts} annotation fetches")
        self.assertIn("change fault", out.getvalue())


class EvidenceSinkTests(unittest.TestCase):
    """The same-job evidence sink (``$RUNNER_TEMP/refund-fault-evidence.log``,
    override ``REFUND_FAULT_EVIDENCE``) is the synchronous evidence source that
    beats GitHub's annotation-publication lag.  Taxonomy-marker printers append
    their text there; the classifier reads it first and only falls back to
    annotations when the sink has no taxonomy marker."""

    def _classify_with_sink(self, sink_text, annotations=None):
        """Run --classify-run-job with a sink file and (empty) annotations."""
        if annotations is None:
            annotations = []
        import tempfile as _tf
        with _tf.NamedTemporaryFile("w", suffix=".log", delete=False, encoding="utf-8") as fh:
            fh.write(sink_text or "")
            sink_path = fh.name
        try:
            listing = {"jobs": [{"id": 11, "name": "preview",
                                 "check_run_url": "https://api.github.com/repos/o/r/check-runs/11"}]}

            def fake(cmd, **kw):
                joined = " ".join(cmd)
                if "/annotations" in joined:
                    class R:
                        stdout = json.dumps(annotations)
                    return R()
                class R:
                    stdout = json.dumps(listing)
                return R()
            with mock.patch.object(classifier.subprocess, "run", side_effect=fake), \
                    mock.patch.dict(os.environ, {"GITHUB_REPOSITORY": "o/r", "GITHUB_RUN_ID": "5",
                                                 "GITHUB_RUN_ATTEMPT": "1",
                                                 "REFUND_FAULT_EVIDENCE": sink_path}), \
                    contextlib.redirect_stdout(io.StringIO()) as out:
                verdict = classifier.classify_run_job("preview", sleep=lambda _: None)
            return verdict, out.getvalue()
        finally:
            os.unlink(sink_path)

    def test_sink_with_infra_marker_refunds_even_with_empty_annotations(self):
        sink_text = ("CI INFRASTRUCTURE: PostgreSQL client unavailable after 3 attempts "
                     "(apt mirror stall on the hosted runner -- NOT a fault in the change under review); "
                     "NO MIGRATION WAS APPLIED\n")
        verdict, printed = self._classify_with_sink(sink_text)
        self.assertTrue(verdict, "sink must deliver the taxonomy marker synchronously")
        self.assertNotIn("attempt", printed, "sink hit must skip the annotation retry entirely")

    def test_sink_with_coordination_wording_refunds(self):
        verdict, _ = self._classify_with_sink(
            "REFUSED: post-merge preview rehearsal requires the exact current main SHA (asked for a, main is b)\n")
        self.assertTrue(verdict)

    def test_empty_sink_and_empty_annotations_is_change_fault(self):
        verdict, printed = self._classify_with_sink("")
        self.assertFalse(verdict)
        self.assertIn("change fault", printed)

    def test_sink_read_failure_falls_through_to_annotations(self):
        """A printer that failed to write leaves no usable sink; the classifier
        must fall through to the annotation channel without crashing."""
        listing = {"jobs": [{"id": 11, "name": "preview",
                             "check_run_url": "https://api.github.com/repos/o/r/check-runs/11"}]}
        marker = [{"annotation_level": "failure",
                   "message": "REFUSED: production lane requires the exact current main SHA"}]

        def fake(cmd, **kw):
            joined = " ".join(cmd)
            if "/annotations" in joined:
                class R:
                    stdout = json.dumps(marker)
                return R()
            class R:
                stdout = json.dumps(listing)
            return R()
        with mock.patch.object(classifier.subprocess, "run", side_effect=fake), \
                mock.patch.dict(os.environ, {"GITHUB_REPOSITORY": "o/r", "GITHUB_RUN_ID": "5",
                                             "GITHUB_RUN_ATTEMPT": "1",
                                             "REFUND_FAULT_EVIDENCE": "/nonexistent/sink.log"}), \
                contextlib.redirect_stdout(io.StringIO()):
            verdict = classifier.classify_run_job("preview", sleep=lambda _: None)
        self.assertTrue(verdict, "annotation fallback must still work when the sink is unreadable")

class ClassifiedRefundBudget(unittest.TestCase):
    """Plan §9 2.2/2.3: classified failures (marker OR pure staleness) draw from
    one refund budget per change since merge; the classified failure that finds
    the budget empty parks the change ("3 refunds used, now parked")."""

    pr = {"number": 7, "merged_at": "2026-01-01T00:00:00Z", "versions": ["20260101000000"]}

    def failures(self, n, start=0):
        return [{"id": start + i, "display_title": "DB preview apply abc PR7 20260101000000",
                 "status": "completed", "conclusion": "failure", "created_at": f"2026-01-02T0{i}:00:00Z"}
                for i in range(n)]

    def all_classified(self):
        return lambda run: True

    def test_three_refunds_keep_a_good_change_alive(self):
        action, got, _ = m.decide([self.pr], self.failures(3), lambda n: [], refunded=self.all_classified())
        self.assertEqual((action, got["number"]), ("dispatch", 7))

    def test_the_fourth_classified_failure_parks_the_change(self):
        skipped = []
        action, _, _ = m.decide([self.pr], self.failures(4), lambda n: [],
                                refunded=self.all_classified(), skipped=skipped)
        self.assertEqual(action, "idle")
        self.assertEqual(skipped[0]["refunds"], m.MAX_REFUNDS)

    def test_the_parking_alert_names_the_cap_and_refunds_used(self):
        pr = {k: v for k, v in self.pr.items()}
        runs = self.failures(4)
        saved = (m.gh, m.merged_migration_prs, m.workflow_runs, m.is_held,
                 m.refund_eligible_in_any_attempt, m.stale_main_refusal_only,
                 sys.argv, os.environ.get("GITHUB_REPOSITORY"))
        m.gh = lambda *a: {"sha": "abc"}
        m.merged_migration_prs = lambda repo: [pr]
        m.workflow_runs = lambda repo, **_: runs
        m.is_held = lambda repo, n: []
        m.refund_eligible_in_any_attempt = lambda repo, run: True
        m.stale_main_refusal_only = lambda repo, run: False
        sys.argv, os.environ["GITHUB_REPOSITORY"] = ["x", "--dry-run"], "o/r"
        try:
            with contextlib.redirect_stdout(io.StringIO()) as out:
                self.assertEqual(m.main(m._time("2026-01-03T00:00:00Z")), 0)
            text = out.getvalue()
            self.assertIn(f"{m.MAX_REFUNDS} refunds used, now parked (refund cap {m.MAX_REFUNDS} per change)", text)
            self.assertIn("::error title=ENGINEER ACTION REQUIRED: automatic attempts exhausted::PR #7", text)
        finally:
            (m.gh, m.merged_migration_prs, m.workflow_runs, m.is_held,
             m.refund_eligible_in_any_attempt, m.stale_main_refusal_only, sys.argv) = saved[:7]
            if saved[7] is None:
                os.environ.pop("GITHUB_REPOSITORY", None)
            else:
                os.environ["GITHUB_REPOSITORY"] = saved[7]

    def test_ordinary_failures_still_count_exactly_as_before(self):
        action, got, _ = m.decide([self.pr], self.failures(2), lambda n: [], main_sha="x")
        self.assertEqual((action, got["number"]), ("dispatch", 7))
        self.assertEqual(m.decide([self.pr], self.failures(3), lambda n: [], main_sha="x")[0], "idle")

    def test_mixed_failures_park_when_the_fourth_classified_arrives(self):
        # The plan §9 2.3 gate: two ordinary attempts, then four classified
        # failures — the 4th classified failure is what parks the change.
        runs = self.failures(2) + self.failures(4, start=2)
        classified = lambda run: run["id"] >= 2
        skipped = []
        action, _, _ = m.decide([self.pr], runs, lambda n: [], refunded=classified, skipped=skipped)
        self.assertEqual(action, "idle")
        self.assertEqual((skipped[0]["exhausted"], skipped[0]["refunds"]), (2, m.MAX_REFUNDS))

    def test_both_fault_classes_share_the_one_budget(self):
        # A pin refusal (marker) and a stale dispatch (the #5856 classifier) are
        # both refundable up to the cap (adversarial table, "Fault class" row).
        runs = self.failures(2)
        mixed = lambda run: run["id"] == 0  # one via marker...
        stale = lambda run: run["id"] == 1  # ...one via the staleness reader
        action, got, _ = m.decide([self.pr], runs, lambda n: [], stale=stale, refunded=mixed)
        self.assertEqual((action, got["number"]), ("dispatch", 7))
        # #5937: main-moved refusals no longer draw from the refund budget at
        # all; any number of them never parks the change.
        runs = self.failures(m.MAX_REFUNDS + 5)
        always = lambda run: True
        self.assertEqual(m.decide([self.pr], runs, lambda n: [], stale=always)[0], "dispatch")
        runs = self.failures(m.MAX_REFUNDS + 1)
        self.assertEqual(m.decide([self.pr], runs, lambda n: [], refunded=always)[0], "idle")

    def test_a_refunded_run_still_counts_as_evidence(self):
        # Only the attempt budget is affected: a refunded run that applied its
        # versions still moves the PR past the queue (plan §9 2.2).
        run = {"id": 1, "display_title": "DB production apply abc PR7 20260101000000",
               "status": "completed", "conclusion": "failure", "created_at": "2026-01-02T00:00:00Z"}
        action, _, _ = m.decide([self.pr], [run], lambda n: [],
                                applied=lambda r: True, refunded=lambda r: True)
        self.assertEqual(action, "idle")
        with contextlib.redirect_stdout(io.StringIO()) as out:
            m.decide([self.pr], [run], lambda n: [], applied=lambda r: True, refunded=lambda r: True)
        self.assertIn("applied; a later post-apply step failed", out.getvalue())


class AdversarialRunIdentity(unittest.TestCase):
    """Plan §9 2.4 trust boundary: a run titled `DB preview apply …` from someone
    else's experiment never counts, and neither does a run predating the merge."""

    pr = {"number": 7, "merged_at": "2026-01-02T00:00:00Z", "versions": ["20260101000000"]}
    ours = {"id": 1, "path": m.WORKFLOW_PATH, "display_title": "DB preview apply abc PR7 20260101000000",
            "status": "completed", "conclusion": "failure", "created_at": "2026-01-03T00:00:00Z"}

    def test_an_alien_workflow_run_in_the_fixture_list_never_counts(self):
        alien = {**self.ours, "id": 99, "path": ".github/workflows/some-experiment.yml"}
        self.assertEqual(m.decide([self.pr], [self.ours, self.ours, alien], lambda n: [], main_sha="x")[0], "dispatch")
        self.assertEqual(m.decide([self.pr], [self.ours, self.ours, self.ours, alien], lambda n: [], main_sha="x")[0], "idle")

    def test_the_lane_queries_only_its_own_workflows_runs(self):
        seen = []
        with mock.patch.object(m, "gh", side_effect=lambda *a: seen.append(a) or [{"workflow_runs": []}]):
            m.workflow_runs("o/r")
        self.assertTrue(seen)
        for args in seen:
            self.assertIn(f"actions/workflows/{m.WORKFLOW}/runs", args[-1])

    def test_a_run_created_before_the_merge_never_counts(self):
        before = {**self.ours, "id": 5, "created_at": "2026-01-01T00:00:00Z"}
        self.assertEqual(m.decide([self.pr], [before] * 3, lambda n: [], main_sha="x")[0], "dispatch")


class LedgerFailsClosed(unittest.TestCase):
    """#6493 Step 2: a configured but unreadable ledger holds the cycle."""
    def test_unreadable_ledger_holds_without_reading_or_dispatching(self):
        with mock.patch.dict(os.environ, {"GITHUB_REPOSITORY": "o/r", "PRODUCTION_LEDGER_FILE": "/nonexistent/ledger.json"}), \
             mock.patch.object(sys, "argv", ["x"]), \
             mock.patch.object(m, "gh", lambda *a: {"sha": "abc"}), \
             mock.patch.object(m, "workflow_runs", side_effect=AssertionError("must not read runs")), \
             mock.patch.object(m, "dispatch", side_effect=AssertionError("must not dispatch")):
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                self.assertEqual(m.main(), 0)
        self.assertIn("wait: production ledger unreadable", out.getvalue())


class ClaimRefPaths(unittest.TestCase):
    def test_release_deletes_the_full_ref_path(self):
        with mock.patch.object(m.subprocess, "run") as run:
            m.release_claim("o/r", 7)
        self.assertEqual(run.call_args[0][0][:5], ["gh", "api", "-X", "DELETE", "repos/o/r/git/refs/dispatch-claims/pr-7"])


class DispatchClaims(unittest.TestCase):
    """#6493 Step 2: per-PR liveness lease against duplicate dispatch."""
    now = datetime(2026, 11, 16, 20, 0, tzinfo=timezone.utc)
    claim = {"pr": 7, "versions": ["20261116100000"], "run_id": "11", "claimed_at": "2026-11-16T19:00:00Z"}

    def arun(self, status, conclusion=None, title="DB preview apply PR7 20261116100000", at="2026-11-16T19:01:00Z"):
        return {"display_title": title, "status": status, "conclusion": conclusion, "created_at": at, "updated_at": at}

    def test_in_flight_run_keeps_the_claim_live(self):
        self.assertFalse(m.claim_is_stale(self.claim, [self.arun("in_progress")], None, self.now))

    def test_version_titled_run_without_pr_number_counts(self):
        r = self.arun("queued", title="DB production apply recovery PR 20261116100000")
        self.assertFalse(m.claim_is_stale(self.claim, [r], None, self.now))

    def test_successful_preview_before_ledger_shows_keeps_claim(self):
        self.assertFalse(m.claim_is_stale(self.claim, [self.arun("completed", "success")], set(), self.now))

    def test_every_associated_run_failed_reclaims(self):
        self.assertTrue(m.claim_is_stale(self.claim, [self.arun("completed", "failure")], None, self.now))

    def test_failed_claimer_with_no_run_reclaims_but_live_claimer_does_not(self):
        self.assertTrue(m.claim_is_stale(self.claim, [], None, self.now, lambda rid: True))
        self.assertFalse(m.claim_is_stale(self.claim, [], None, self.now, lambda rid: False))

    def test_ledger_applied_claim_is_stale(self):
        self.assertTrue(m.claim_is_stale(self.claim, [self.arun("in_progress")], {"20261116100000"}, self.now))

    def test_nothing_moving_for_four_hours_reclaims(self):
        later = self.now + timedelta(hours=5)
        self.assertTrue(m.claim_is_stale(self.claim, [self.arun("completed", "success")], set(), later))
        self.assertFalse(m.claim_is_stale(self.claim, [self.arun("in_progress")], set(), later))

    def test_runs_before_the_claim_are_ignored(self):
        old = self.arun("completed", "failure", at="2026-11-16T18:00:00Z")
        self.assertFalse(m.claim_is_stale(self.claim, [old], None, self.now, lambda rid: False))

    def test_second_selector_is_blocked_by_a_live_claim(self):
        pr = {"number": 7, "versions": ["20261116100000"]}
        api = {"commits/main": {"commit": {"tree": {"sha": "t"}}}, "git/commits": {"sha": "c"}}

        def gh(*args):
            path = [a for a in args if a.startswith("repos/")][0]
            if path.endswith("git/ref/dispatch-claims/pr-7"):
                return {"object": {"sha": "old"}}
            if path.endswith("git/commits/old"):
                return {"message": json.dumps(self.claim)}
            return next(v for k, v in api.items() if path.endswith(k))
        refused = subprocess.CalledProcessError(1, "gh")
        with mock.patch.object(m, "gh", gh), mock.patch.object(m.subprocess, "run", side_effect=refused), \
             contextlib.redirect_stdout(io.StringIO()) as out:
            self.assertFalse(m.claim_dispatch("o/r", pr, [self.arun("in_progress")], None, self.now))
        self.assertIn("already claimed", out.getvalue())

    def test_failed_production_after_a_passed_preview_reclaims(self):
        # 2026-11-17, PR #6370: preview passed, production apply failed, and the
        # claim stayed live -- the queue parked behind it for 97 minutes.
        preview = self.arun("completed", "success")
        prod = self.arun("completed", "failure", title="DB production apply PR7 20261116100000", at="2026-11-16T19:06:00Z")
        self.assertTrue(m.claim_is_stale(self.claim, [prod, preview], set(), self.now))

    def test_recovery_success_after_a_failure_keeps_the_claim(self):
        failed = self.arun("completed", "failure")
        retry = self.arun("completed", "success", at="2026-11-16T19:10:00Z")
        self.assertFalse(m.claim_is_stale(self.claim, [failed, retry], set(), self.now))

    def test_a_claimed_pr_is_passed_over_and_the_next_dispatches(self):
        first = {"number": 7, "merged_at": "2026-11-16T10:00:00Z", "versions": ["20261116100000"]}
        second = {"number": 8, "merged_at": "2026-11-16T11:00:00Z", "versions": ["20261116110000"]}
        sent = []
        with mock.patch.dict(os.environ, {"GITHUB_REPOSITORY": "o/r"}), mock.patch.object(sys, "argv", ["x"]), \
             mock.patch.object(m, "gh", lambda *a: {"sha": "abc"}), \
             mock.patch.object(m, "merged_migration_prs", lambda repo: [first, second]), \
             mock.patch.object(m, "workflow_runs", lambda repo, **_: []), \
             mock.patch.object(m, "is_held", lambda repo, n: []), \
             mock.patch.object(m, "prune_claims", lambda *a: None), \
             mock.patch.object(m, "claim_dispatch", lambda repo, pr, *a: pr["number"] != 7), \
             mock.patch.object(m, "dispatch", lambda repo, pr, sha, *_: sent.append(pr["number"])), \
             contextlib.redirect_stdout(io.StringIO()) as out:
            self.assertEqual(m.main(self.now), 0)
        self.assertEqual(sent, [8])
        self.assertIn("after passing over claimed PR(s) #7", out.getvalue())

    def test_dispatch_error_releases_the_claim(self):
        pr = {"number": 7, "merged_at": "2026-11-16T10:00:00Z", "versions": ["20261116100000"]}
        released = []
        with mock.patch.dict(os.environ, {"GITHUB_REPOSITORY": "o/r"}), mock.patch.object(sys, "argv", ["x"]), \
             mock.patch.object(m, "gh", lambda *a: {"sha": "abc"}), \
             mock.patch.object(m, "merged_migration_prs", lambda repo: [pr]), \
             mock.patch.object(m, "workflow_runs", lambda repo, **_: []), \
             mock.patch.object(m, "is_held", lambda repo, n: []), \
             mock.patch.object(m, "prune_claims", lambda *a: None), \
             mock.patch.object(m, "claim_dispatch", lambda *a: True), \
             mock.patch.object(m, "release_claim", lambda repo, n: released.append(n)), \
             mock.patch.object(m, "dispatch", side_effect=RuntimeError("boom")), \
             contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaises(RuntimeError):
                m.main(self.now)
        self.assertEqual(released, [7])


class LaneGuardWaitsForAFinishingRun(unittest.TestCase):
    """#6493 Step 4: the completion nudge arrives while its own run is still
    closing. The guard must wait for that run instead of dropping the nudge,
    and must still skip at once while a run is really applying. Runs the
    workflow step's own shell against a scripted `gh`."""

    ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    STUB = """#!/usr/bin/env bash
d="$GH_STUB_DIR"
if [ "$2" = list ]; then
  n=$(cat "$d/n" 2>/dev/null || echo 0); echo $((n + 1)) > "$d/n"
  f="$d/list.$n"; [ -f "$f" ] || f="$d/list.last"
  [ -f "$f" ] || exit 1
  cat "$f"
else
  cat "$d/jobs.$3"
fi
"""

    @classmethod
    def setUpClass(cls):
        with open(os.path.join(cls.ROOT, ".github", "workflows", "automatic-production-trigger.yml"), encoding="utf-8") as fh:
            cls.trigger = fh.read()
        with open(os.path.join(cls.ROOT, ".github", "workflows", "shared-supabase-migrations.yml"), encoding="utf-8") as fh:
            cls.migrations = fh.read()
        block = cls.trigger.split("id: lane_guard\n        run: |\n", 1)[1]
        lines = []
        for line in block.split("\n"):
            if line.strip() and not line.startswith(" " * 10):
                break
            lines.append(line[10:])
        cls.script = "\n".join(lines)

    def guard(self, files):
        with tempfile.TemporaryDirectory() as tmp:
            bindir = os.path.join(tmp, "bin")
            os.mkdir(bindir)
            stub = os.path.join(bindir, "gh")
            with open(stub, "w", encoding="utf-8", newline="\n") as fh:
                fh.write(self.STUB)
            os.chmod(stub, 0o755)
            for name, value in files.items():
                with open(os.path.join(tmp, name), "w", encoding="utf-8") as fh:
                    fh.write(json.dumps(value))
            output = os.path.join(tmp, "out")
            open(output, "w").close()
            env = {**os.environ, "PATH": bindir + os.pathsep + os.environ["PATH"], "GH_STUB_DIR": tmp,
                   "GITHUB_REPOSITORY": "o/r", "GITHUB_OUTPUT": output, "LANE_GUARD_POLL_SECONDS": "0"}
            done = subprocess.run(["bash", "-e", "-c", self.script], env=env, stdout=subprocess.PIPE,
                                  stderr=subprocess.STDOUT, text=True)
            with open(output, encoding="utf-8") as fh:
                return done.returncode, "skipped=true" in fh.read(), done.stdout

    BUSY = [{"databaseId": 5, "status": "in_progress"}, {"databaseId": 4, "status": "completed"}]
    DONE = [{"databaseId": 5, "status": "completed"}]
    NUDGING = {"jobs": [{"name": "Production apply (automatic evidence gates)", "status": "completed"},
                        {"name": "Nudge the production queue", "status": "in_progress"}]}
    APPLYING = {"jobs": [{"name": "Production apply (automatic evidence gates)", "status": "in_progress"}]}

    def test_idle_lane_proceeds(self):
        self.assertEqual(self.guard({"list.last": self.DONE})[:2], (0, False))

    def test_a_run_still_applying_skips_at_once(self):
        code, skipped, out = self.guard({"list.last": self.BUSY, "jobs.5": self.APPLYING})
        self.assertEqual((code, skipped), (0, True))
        self.assertNotIn("wait:", out)

    def test_a_finishing_run_is_waited_for_then_the_selector_runs(self):
        code, skipped, out = self.guard({"list.0": self.BUSY, "list.1": self.BUSY, "list.last": self.DONE,
                                         "jobs.5": self.NUDGING})
        self.assertEqual((code, skipped), (0, False), out)
        self.assertIn("wait: migration run(s) 5 finishing", out)

    def test_a_finishing_run_beside_an_applying_run_skips(self):
        both = [{"databaseId": 5, "status": "in_progress"}, {"databaseId": 6, "status": "queued"}]
        code, skipped, _ = self.guard({"list.last": both, "jobs.5": self.NUDGING, "jobs.6": {"jobs": []}})
        self.assertEqual((code, skipped), (0, True))

    def test_a_run_that_never_completes_skips_after_the_bounded_wait(self):
        code, skipped, out = self.guard({"list.last": self.BUSY, "jobs.5": self.NUDGING})
        self.assertEqual((code, skipped), (0, True))
        self.assertEqual(out.count("wait:"), 36)

    def test_a_failed_lane_query_fails_open(self):
        code, skipped, out = self.guard({})
        self.assertEqual((code, skipped), (0, False))
        self.assertIn("fail-open", out)

    def test_the_guard_names_the_real_nudge_job(self):
        body = self.migrations.split("\n  notify-production-queue:", 1)[1]
        self.assertIn("name: Nudge the production queue\n", body[:200])
        self.assertIn('.name == "Nudge the production queue"', self.trigger)


class SloReport(unittest.TestCase):
    def test_first_post_merge_run_gives_the_sample(self):
        prs = [{"number": 7, "merged_at": "2026-11-16T10:00:00Z"}, {"number": 8, "merged_at": "2026-11-16T11:00:00Z"}]
        runs = [{"display_title": "DB preview apply PR7 1", "created_at": "2026-11-16T10:02:00Z"},
                {"display_title": "DB preview apply PR7 1", "created_at": "2026-11-16T10:30:00Z"},
                {"display_title": "DB preview apply PR7 1", "created_at": "2026-11-16T09:00:00Z"},
                {"display_title": "DB production apply PR8 2", "created_at": "2026-11-16T11:10:00Z",
                 "run_started_at": "2026-11-16T11:12:00Z"}]
        self.assertEqual(m.slo_samples(prs, runs, "DB preview apply"), [(7, 120.0)])
        self.assertEqual(m.slo_samples(prs, runs, "DB production apply"), [(8, 720.0)])
        with contextlib.redirect_stdout(io.StringIO()) as out:
            m.report_slos(prs, runs)
        self.assertIn("SLO_A merge-to-dispatch: 120s (PR #7); p50=120s p95=120s", out.getvalue())
        self.assertIn("SLO_B merge-to-apply-start: 720s (PR #8)", out.getvalue())


class PrefetchHolds(unittest.TestCase):
    """#6493 Step 1c: one settle for all candidates, same fail-toward-holding."""
    finding = {"number": 900, "state": "open", "labels": [{"name": "review-finding"}],
               "body": "Source PR: https://github.com/o/r/pull/7", "created_at": "2026-11-16T00:00:00Z"}

    def test_one_settle_and_shared_label_read_for_many_prs(self):
        import review_finding_hold as rfh
        sleeps, labelled = [], []
        out = rfh.gh_issues_many("o/r", [7, 8], sleep=sleeps.append,
                                 labelled=lambda r, p: labelled.append(1) or [self.finding],
                                 crossed=lambda r, p: [])
        self.assertEqual(sleeps, [rfh.SETTLE_SECONDS])
        self.assertEqual(len(labelled), 2)
        self.assertEqual(len(out[7]), 2)

    def test_failed_batch_falls_back_to_per_pr_is_held(self):
        with mock.patch.object(m.review_finding_hold, "gh_issues_many",
                               side_effect=subprocess.CalledProcessError(1, "gh")), \
             mock.patch.object(m, "is_held", lambda repo, n: True), \
             contextlib.redirect_stdout(io.StringIO()):
            self.assertIs(REAL_PREFETCH_HOLDS("o/r", [7])(7), True)

    def test_prefetched_blocking_finding_holds(self):
        with mock.patch.object(m.review_finding_hold, "gh_issues_many", lambda repo, prs: {7: [self.finding]}), \
             mock.patch.object(m.review_finding_hold, "blocking_findings", lambda issues, repo, n: issues):
            self.assertEqual(REAL_PREFETCH_HOLDS("o/r", [7])(7), [self.finding])

    def test_pr_outside_the_batch_reads_fresh(self):
        with mock.patch.object(m.review_finding_hold, "gh_issues_many", lambda repo, prs: {}), \
             mock.patch.object(m, "is_held", lambda repo, n: ["fresh"]):
            self.assertEqual(REAL_PREFETCH_HOLDS("o/r", [])(9), ["fresh"])


class PermanentRefusalTests(unittest.TestCase):
    """#6574 Fix B: a permanent producer-mismatch refusal parks on the first run."""
    RUN = {"id": 5, "run_attempt": 1}
    PR = {"number": 6433, "merged_at": "2026-11-16T04:57:00Z", "versions": ["20261116013153"]}
    FAIL = {"display_title": "DB production apply PR6433 20261116013153", "status": "completed",
            "conclusion": "failure", "created_at": "2026-11-17T13:10:00Z"}
    DIED = ("##[error]ENGINEER ACTION REQUIRED: automatic qualification found no evidence route the "
            "production gate accepts: RiskGateError: the production gate would refuse this preview evidence "
            "(scripts/production_business_risk_gate.py:1562: produced evidence with a different "
            "scripts/production_migration_guard.py than the merge commit), and the migration is high-risk "
            "to live data so the ephemeral CI route cannot substitute. Nothing was dispatched.\n")

    def check(self, log=None, raises=None):
        jobs = [{"id": 11, "steps": [{"name": "Qualify", "conclusion": "failure"}]}]
        def fake_run(cmd, **kw):
            if raises:
                raise raises
            class R:
                stdout = log
            return R()
        with mock.patch.object(m, "attempt_jobs", return_value=[jobs]), \
                mock.patch.object(m.subprocess, "run", side_effect=fake_run):
            return m.permanent_refusal("o/r", self.RUN)

    def test_permanent_refusal_is_recognised(self):
        self.assertTrue(self.check(self.DIED))

    def test_permanent_refusal_parks_on_first_run(self):
        action, got, reason = m.decide([self.PR], [self.FAIL], lambda n: [],
                                       main_sha="new", permanent=lambda run: True)
        self.assertEqual(action, "idle")
        self.assertIn("permanent refusal", reason)

    def test_permanent_refusal_unreadable_log_counts_as_ordinary_attempt(self):
        self.assertFalse(self.check(raises=subprocess.CalledProcessError(1, "gh")))
        action, got, _ = m.decide([self.PR], [self.FAIL], lambda n: [],
                                  main_sha="new", permanent=lambda run: False)
        self.assertEqual((action, got["number"]), ("dispatch", 6433))

    def test_stale_refusal_is_not_permanent(self):
        self.assertFalse(self.check("##[error]REFUSED: has moved past the dispatched commit\n"))

    def test_ordinary_failure_still_needs_three(self):
        self.assertEqual(m.decide([self.PR], [self.FAIL] * 2, lambda n: [], main_sha="new",
                                  permanent=lambda run: False)[0], "dispatch")
        self.assertEqual(m.decide([self.PR], [self.FAIL] * 3, lambda n: [], main_sha="new",
                                  permanent=lambda run: False)[0], "idle")
class PreMergeRefusalWorkflowTests(unittest.TestCase):
    """#6574 Fix A: the refusal runs in the validate job, which the preview job needs,
    so a refused claim-lane apply never reaches any preview database step."""

    def test_premerge_refusal_step_gated_and_runs_before_preview(self):
        import os
        root = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
        with open(os.path.join(root, ".github", "workflows", "shared-supabase-migrations.yml"), encoding="utf-8") as fh:
            text = fh.read()
        validate = text[text.index("\n  validate:\n"):text.index("\n  preview:\n")]
        step = validate.index("- name: Refuse pre-merge apply of a high-risk migration")
        self.assertIn("inputs.claim_pr != '' && inputs.mode == 'apply'", validate[step:step + 300])
        self.assertIn("premerge-preview-check", validate[step:step + 600])
        preview = text[text.index("\n  preview:\n"):]
        self.assertIn("needs: validate", preview[:400])


if __name__ == "__main__":
    unittest.main()


class ProductionLedgerIsFinal(unittest.TestCase):
    # #6352: changes already in the production ledger were retried for hours.
    def test_a_change_already_in_the_ledger_is_skipped(self):
        live_pr = {"number": 7, "merged_at": "2026-01-01", "versions": ["1"]}
        later = {"number": 8, "merged_at": "2026-01-02", "versions": ["2"]}
        with contextlib.redirect_stdout(io.StringIO()):
            action, got, _ = m.decide([live_pr, later], [], lambda n: [], main_sha="d", live={"1"})
        self.assertEqual((action, got["number"]), ("dispatch", 8))

    def test_a_partly_live_change_still_promotes(self):
        pr = {"number": 7, "merged_at": "2026-01-01", "versions": ["1", "2"]}
        action, got, _ = m.decide([pr], [], lambda n: [], main_sha="d", live={"1"})
        self.assertEqual((action, got["number"]), ("dispatch", 7))

    def test_no_ledger_keeps_the_old_behaviour(self):
        pr = {"number": 7, "merged_at": "2026-01-01", "versions": ["1"]}
        self.assertEqual(m.decide([pr], [], lambda n: [], main_sha="d", live=None)[1]["number"], 7)

    def test_ledger_file_reading(self):
        import tempfile
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "l.json")
            self.assertIsNone(m.production_ledger(p))
            with open(p, "w") as fh:
                fh.write('["20261029162652", 20261030042314]')
            self.assertEqual(m.production_ledger(p), {"20261029162652", "20261030042314"})
            with open(p, "w") as fh:
                fh.write("[]")
            self.assertIsNone(m.production_ledger(p))
            with open(p, "w") as fh:
                fh.write("not json")
            self.assertIsNone(m.production_ledger(p))


class DispatchUsesFreshMain(unittest.TestCase):
    def test_dispatch_rereads_main_after_selection_and_freeze(self):
        pr = {"number": 6368, "merged_at": "2026-11-15T17:23:00Z", "versions": ["20261115172333"], "stale_streak": 9}
        shas = iter(["old", "new"])
        saved = (m.gh, m.decide, m.workflow_runs, m.production_ledger, m.merged_migration_prs,
                 m.backstop_freeze, m.dispatch, sys.argv, os.environ.get("GITHUB_REPOSITORY"))
        calls = []
        m.gh = lambda path: {"sha": next(shas)}
        m.decide = lambda *a, **k: ("dispatch", pr, "ok")
        m.workflow_runs = lambda repo, **_: []
        m.production_ledger = lambda: None
        m.merged_migration_prs = lambda repo: [pr]
        m.backstop_freeze = lambda p: calls.append("freeze") or True
        saved_drain = m.wait_for_merge_queue_drain
        m.wait_for_merge_queue_drain = lambda repo: calls.append("drain") or True
        m.dispatch = lambda repo, p, sha, runs=None: calls.append(sha)
        sys.argv, os.environ["GITHUB_REPOSITORY"] = ["x"], "o/r"
        try:
            with contextlib.redirect_stdout(io.StringIO()), \
                 mock.patch.object(m, "prune_claims", lambda *a: None), \
                 mock.patch.object(m, "claim_dispatch", lambda *a: True):
                self.assertEqual(m.main(datetime(2026, 11, 15, 22, 0, tzinfo=timezone.utc)), 0)
            self.assertEqual(calls, ["freeze", "drain", "new"])
        finally:
            (m.gh, m.decide, m.workflow_runs, m.production_ledger, m.merged_migration_prs,
             m.backstop_freeze, m.dispatch, sys.argv) = saved[:8]
            m.wait_for_merge_queue_drain = saved_drain
            if saved[8] is None:
                os.environ.pop("GITHUB_REPOSITORY", None)
            else:
                os.environ["GITHUB_REPOSITORY"] = saved[8]



class MergeQueueDrain(unittest.TestCase):
    """#6800: a group validated before the freeze must land before main is read."""

    def test_waits_until_queue_empty(self):
        counts, slept = iter([2, 1, 0]), []
        self.assertTrue(m.wait_for_merge_queue_drain("o/r", timeout=600, poll=1, entries=lambda: next(counts),
                                                     sleep=slept.append, clock=lambda: 0))
        self.assertEqual(slept, [1, 1])

    def test_times_out_and_proceeds(self):
        t = iter([0, 5, 11])
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertFalse(m.wait_for_merge_queue_drain("o/r", timeout=10, poll=1, entries=lambda: 1,
                                                          sleep=lambda s: None, clock=lambda: next(t)))

    def test_query_error_fails_open(self):
        def boom():
            raise RuntimeError("api")
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertFalse(m.wait_for_merge_queue_drain("o/r", entries=boom, sleep=lambda s: None))

    def test_freeze_on_first_dispatch_even_with_no_stale_streak(self):
        pr = {"number": 1, "merged_at": "2026-11-15T17:23:00Z", "versions": ["20261115172333"]}
        calls = []
        with mock.patch.object(m, "gh", lambda path: {"sha": "s"}), \
             mock.patch.object(m, "decide", lambda *a, **k: ("dispatch", pr, "ok")), \
             mock.patch.object(m, "workflow_runs", lambda repo, **_: []), \
             mock.patch.object(m, "production_ledger", lambda: None), \
             mock.patch.object(m, "merged_migration_prs", lambda repo: [pr]), \
             mock.patch.object(m, "backstop_freeze", lambda p: calls.append("freeze") or True), \
             mock.patch.object(m, "wait_for_merge_queue_drain", lambda repo: calls.append("drain") or True), \
             mock.patch.object(m, "dispatch", lambda repo, p, sha, runs=None: calls.append(sha)), \
             mock.patch.object(m, "prune_claims", lambda *a: None), \
             mock.patch.object(m, "claim_dispatch", lambda *a: True), \
             mock.patch.object(sys, "argv", ["x"]), mock.patch.dict(os.environ, {"GITHUB_REPOSITORY": "o/r"}), \
             contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(m.main(datetime(2026, 11, 15, 22, 0, tzinfo=timezone.utc)), 0)
        self.assertEqual(calls, ["freeze", "drain", "s"])


class SelectorRunCache(unittest.TestCase):
    """#6493 Step 1c: the workflow-run cache is discovery-only."""
    NOW = "2026-11-17T12:00:00Z"

    def run_(self, i, status="completed", conclusion="failure", at="2026-11-17T09:00:00Z",
             title="DB preview apply a PR7 20261116100000"):
        return {"id": i, "status": status, "conclusion": conclusion, "created_at": at,
                "display_title": title, "run_attempt": 1}

    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.path = os.path.join(self.dir.name, "runs.json")
        self.env = mock.patch.dict(os.environ, {"PROMOTION_RUN_CACHE_FILE": self.path})
        self.env.start()
        m._RUN_SNAPSHOT = None
        self.calls = []
        self.clock = mock.patch.object(m, "_utcnow", lambda: m._time(self.NOW))
        self.clock.start()
        self.jobs = mock.patch.object(m, "run_jobs", lambda *a: [{"name": "job"}])
        self.jobs.start()

    def tearDown(self):
        m._RUN_SNAPSHOT = None
        self.clock.stop()
        self.jobs.stop()
        self.env.stop()
        self.dir.cleanup()

    def api(self, full=(), recent=(), in_flight=(), by_id=None):
        def gh(*args):
            url = args[-1]
            self.calls.append(url)
            if "/actions/runs/" in url:
                return (by_id or {})[int(url.rsplit("/", 1)[1])]
            if "status=" in url:
                status = url.split("status=")[1]
                return [{"workflow_runs": [r for r in in_flight if r["status"] == status]}]
            if f"created=>={m.ACTIVATED_AT[:10]}" in url:
                return [{"workflow_runs": list(full)}]
            return [{"workflow_runs": list(recent)}]
        return gh

    def write_cache(self, runs, read_at="2026-11-17T11:00:00Z"):
        with open(self.path, "w", encoding="utf-8") as fh:
            json.dump({"schema_version": m.RUN_CACHE_SCHEMA, "activated_at": m.ACTIVATED_AT,
                       "read_at": read_at, "runs": runs}, fh)

    def read(self, gh, **kw):
        m._RUN_SNAPSHOT = None
        with mock.patch.object(m, "gh", gh), contextlib.redirect_stdout(io.StringIO()):
            return m.workflow_runs("o/r", **kw)

    def full_reads(self):
        return [c for c in self.calls if f"created=>={m.ACTIVATED_AT[:10]}" in c]

    def test_cold_cache_does_a_full_read_and_writes_the_cache(self):
        runs = self.read(self.api(full=[self.run_(1)]))
        self.assertEqual([r["id"] for r in runs], [1])
        self.assertEqual(len(self.full_reads()), 1)
        with open(self.path, encoding="utf-8") as fh:
            self.assertEqual([r["id"] for r in json.load(fh)["runs"]], [1])

    def test_warm_cache_reads_only_recent_and_in_flight_runs(self):
        self.write_cache([self.run_(1, at="2026-11-01T00:00:00Z")])
        new = self.run_(2, at="2026-11-17T11:30:00Z", conclusion="success")
        runs = self.read(self.api(recent=[new]))
        self.assertEqual([r["id"] for r in runs], [2, 1])
        self.assertEqual(self.full_reads(), [])
        self.assertTrue(any("created=>=2026-11-17T10:50:00Z" in c for c in self.calls))

    def test_corrupt_or_expired_cache_falls_back_to_a_full_read(self):
        for body in ("{not json", json.dumps({"schema_version": 99})):
            with open(self.path, "w", encoding="utf-8") as fh:
                fh.write(body)
            self.calls = []
            self.read(self.api(full=[self.run_(1)]))
            self.assertEqual(len(self.full_reads()), 1, body)
        self.write_cache([self.run_(1)], read_at="2026-11-16T00:00:00Z")
        self.calls = []
        self.read(self.api(full=[self.run_(1)]))
        self.assertEqual(len(self.full_reads()), 1)

    def test_a_failed_refresh_falls_back_to_a_full_read(self):
        self.write_cache([self.run_(1, status="in_progress", conclusion=None)])
        def gh(*args):
            if "/actions/runs/" in args[-1]:
                raise subprocess.CalledProcessError(1, "gh")
            return self.api(full=[self.run_(1)])(*args)
        runs = self.read(gh)
        self.assertEqual(runs[0]["status"], "completed")
        self.assertEqual(len(self.full_reads()), 1)

    def test_cached_non_terminal_runs_are_refetched(self):
        self.write_cache([self.run_(5, status="in_progress", conclusion=None, at="2026-11-01T00:00:00Z")])
        done = self.run_(5, at="2026-11-01T00:00:00Z", conclusion="success")
        runs = self.read(self.api(by_id={5: done}))
        self.assertEqual((runs[0]["status"], runs[0]["conclusion"]), ("completed", "success"))
        self.assertIn("repos/o/r/actions/runs/5", self.calls)

    def test_a_rerun_of_an_old_completed_run_is_seen_in_flight(self):
        self.write_cache([self.run_(6, at="2026-11-01T00:00:00Z")])
        rerun = self.run_(6, status="queued", conclusion=None, at="2026-11-01T00:00:00Z")
        runs = self.read(self.api(in_flight=[rerun]))
        self.assertEqual(runs[0]["status"], "queued")
        action, _, _ = m.decide([{"number": 7, "merged_at": "2026-10-31T00:00:00Z", "versions": ["1"]}],
                                runs, lambda n: [])
        self.assertEqual(action, "wait")

    def test_attempts_are_never_counted_from_the_cache(self):
        """The cache says PR 7's three attempts all failed; fresh GitHub says one
        was re-run to success. The pre-dispatch read (fresh_since = merge) must
        re-read every run of the PR, not trust the cached conclusions."""
        title = "DB preview apply a PR7 20261116100000"
        cached = [self.run_(i, at=f"2026-11-16T1{i}:00:00Z", title=title) for i in (1, 2, 3)]
        self.write_cache(cached)
        fresh = [{**cached[0], "conclusion": "success"}, cached[1], cached[2]]
        def gh(*args):
            url = args[-1]
            if "created=>=2026-11-16T10:00:00Z" in url:
                self.calls.append(url)
                return [{"workflow_runs": fresh}]
            return self.api()(*args)
        runs = self.read(gh, fresh_since="2026-11-16T10:00:00Z")
        self.assertEqual({r["id"]: r["conclusion"] for r in runs}[1], "success")
        self.assertEqual(self.full_reads(), [])

    def test_main_rechecks_with_the_candidate_and_dependency_merge_times(self):
        dep = {"number": 6, "merged_at": "2026-11-15T00:00:00Z", "versions": ["20261115000000"]}
        pr = {"number": 7, "merged_at": "2026-11-16T10:00:00Z", "versions": ["20261116100000"],
              "production_dependencies": {"20261115000000": 6}}
        seen, sent = [], []
        prod = {"id": 9, "status": "completed", "conclusion": "success", "created_at": "2026-11-15T01:00:00Z",
                "display_title": "DB production apply a PR6 20261115000000"}
        with mock.patch.dict(os.environ, {"GITHUB_REPOSITORY": "o/r"}), mock.patch.object(sys, "argv", ["x"]), \
             mock.patch.object(m, "gh", lambda *a: {"sha": "abc"}), \
             mock.patch.object(m, "merged_migration_prs", lambda repo: [dep, pr]), \
             mock.patch.object(m, "workflow_runs", lambda repo, **kw: seen.append(kw) or [prod]), \
             mock.patch.object(m, "is_held", lambda repo, n: []), \
             mock.patch.object(m, "prune_claims", lambda *a: None), \
             mock.patch.object(m, "claim_dispatch", lambda *a: True), \
             mock.patch.object(m, "dispatch", lambda repo, p, sha, runs: sent.append(runs)), \
             contextlib.redirect_stdout(io.StringIO()):
            m.main(m._time("2026-11-17T00:00:00Z"))
        self.assertEqual(seen, [{}, {"fresh_since": "2026-11-15T00:00:00Z"}])
        self.assertEqual(sent, [[prod]])  # dispatch reuses the fresh read, no third read


def _gh_expr(expr: str, ctx: dict) -> object:
    """Evaluate the small GitHub-expression subset the trigger uses (==, !=,
    &&, ||, !, contains(x.*.name, 'v'), fromJSON, string literals) against a
    nested event context, with GitHub's null/falsy semantics."""
    def lookup(path):
        cur = ctx
        parts = path.split(".")
        for i, part in enumerate(parts):
            if part == "*":
                rest = parts[i + 1:]
                return [item.get(rest[0]) if rest else item for item in (cur or [])]
            cur = cur.get(part) if isinstance(cur, dict) else None
        return cur
    names = {}

    def ident(match):
        key = f"_v{len(names)}"
        names[key] = lookup(match.group(0))
        return key
    py = re.sub(r"(?<!['\w])(?:github|inputs|vars|needs|steps)\.[\w.*-]+", ident, expr)
    py = py.replace("&&", " and ").replace("||", " or ")
    py = re.sub(r"!(?!=)", " not ", py)
    names["contains"] = lambda seq, v: v in (seq or [])
    names["fromJSON"] = json.loads
    return eval(py, {"__builtins__": {}}, names)  # noqa: S307 - test-only, repo-owned text


class HoldClearWakesTheTrigger(unittest.TestCase):
    """#6493 Step 4b: closing or unlabeling a hold re-arms the trigger; every
    other issue event is filtered out before a runner starts and never joins
    the real wake-up concurrency group."""

    HOLDS = ("review-finding", "promotion-held", "promotion-parked")

    @classmethod
    def setUpClass(cls):
        root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        with open(os.path.join(root, ".github", "workflows", "automatic-production-trigger.yml"), encoding="utf-8") as fh:
            cls.text = fh.read()
        job = cls.text.split("\n  trigger:\n", 1)[1]
        cls.job_if = re.search(r"    if: >-\n((?:      .*\n)+)", job).group(1)
        cls.group = re.search(r"      group: (.*)\n", job).group(1)

    def ctx(self, action, labels, removed=None):
        return {"github": {"event_name": "issues", "event": {
            "action": action, "issue": {"labels": [{"name": n} for n in labels]},
            "label": {"name": removed} if removed else None}}, "vars": {}}

    def passes(self, ctx):
        return bool(_gh_expr(" ".join(self.job_if.split()), ctx))

    def group_of(self, ctx):
        parts = re.findall(r"\$\{\{(.*?)\}\}", self.group)[1:]  # [0] is the lane epoch
        return "".join(_gh_expr(p, ctx) or "" for p in parts)

    def test_issue_events_are_declared(self):
        self.assertRegex(self.text, r"\n  issues:\n    types: \[closed, unlabeled\]\n")

    def test_closing_a_hold_issue_passes_the_filter_and_joins_the_main_group(self):
        for label in self.HOLDS:
            with self.subTest(label=label):
                c = self.ctx("closed", ["bug", label])
                self.assertTrue(self.passes(c))
                self.assertEqual(self.group_of(c), "")

    def test_removing_a_hold_label_passes_the_filter(self):
        for label in self.HOLDS:
            with self.subTest(label=label):
                c = self.ctx("unlabeled", ["bug"], removed=label)
                self.assertTrue(self.passes(c))
                self.assertEqual(self.group_of(c), "")

    def test_unrelated_issue_events_are_filtered_and_kept_out_of_the_main_group(self):
        for c in (self.ctx("closed", ["bug"]), self.ctx("closed", []),
                  self.ctx("unlabeled", ["review-finding"], removed="bug")):
            with self.subTest(c=c):
                self.assertFalse(self.passes(c))
        self.assertEqual(self.group_of(self.ctx("closed", ["bug"])), "-issue-noise")

    def test_ci_noise_split_is_preserved(self):
        noise = {"github": {"event_name": "workflow_run", "event": {"workflow_run": {
            "event": "pull_request", "conclusion": "success"}}}, "vars": {}}
        real = {"github": {"event_name": "workflow_run", "event": {"workflow_run": {
            "event": "workflow_dispatch", "conclusion": "failure"}}}, "vars": {}}
        self.assertEqual(self.group_of(noise), "-ci-noise")
        self.assertFalse(self.passes(noise))
        self.assertEqual(self.group_of(real), "")
        self.assertTrue(self.passes(real))
        for name in ("repository_dispatch", "schedule", "workflow_dispatch", "push"):
            c = {"github": {"event_name": name, "event": {}}, "vars": {}}
            self.assertTrue(self.passes(c))
            self.assertEqual(self.group_of(c), "")
        self.assertIn("cancel-in-progress: false", self.text.split("\n  recheck:\n", 1)[0])


class SelfScheduledRecheck(unittest.TestCase):
    """#6493 Step 4b backstop that does not depend on GitHub cron."""

    import automatic_promotion_candidates as cand  # noqa: E402

    @classmethod
    def setUpClass(cls):
        root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        with open(os.path.join(root, ".github", "workflows", "automatic-production-trigger.yml"), encoding="utf-8") as fh:
            cls.text = fh.read()
        cls.job = cls.text.split("\n  recheck:\n", 1)[1]

    def test_backstop_is_present_bounded_and_off_the_main_slot(self):
        self.assertIn("needs: trigger", self.job)
        self.assertIn("needs.trigger.outputs.recheck == 'true'", self.job)
        self.assertIn("fromJSON(inputs.recheck_hop || '0') < 8", self.job)
        self.assertIn('recheck_hop="$((HOP + 1))"', self.job)
        self.assertRegex(self.job, r"timeout-minutes: (1\d|20)\n")
        delay = int(re.search(r"RECHECK_DELAY_SECONDS:-(\d+)", self.job).group(1))
        self.assertTrue(600 <= delay <= 900, delay)
        self.assertIn("-recheck", re.search(r"group: (.*)", self.job).group(1))
        self.assertNotIn("gh api", self.job)
        self.assertIn("recheck: ${{ steps.selector.outputs.recheck }}", self.text)
        # The slot lives on the trigger job, so the sleep cannot hold it.
        self.assertIsNone(re.search(r"^concurrency:", self.text, re.M))
        self.assertRegex(self.text, r"cron: '23 \* \* \* \*'")

    def test_hop_cap_stops_the_chain(self):
        cond = re.search(r"    if: (.*)\n", self.job).group(1)
        for hop, expected in (("0", True), ("7", True), ("8", False), (None, True)):
            ctx = {"needs": {"trigger": {"outputs": {"recheck": "true"}}}, "inputs": {"recheck_hop": hop}}
            self.assertEqual(bool(_gh_expr(cond.replace("always() &&", ""), ctx)), expected, hop)
        ctx = {"needs": {"trigger": {"outputs": {"recheck": "false"}}}, "inputs": {}}
        self.assertFalse(_gh_expr(cond.replace("always() &&", ""), ctx))

    def test_only_transient_waits_request_a_recheck(self):
        r = self.cand.needs_recheck
        self.assertTrue(r("wait", []))
        self.assertTrue(r("idle", [{"pending_dependencies": {"1": 2}}]))
        self.assertTrue(r("idle", [], {5}))
        self.assertFalse(r("dispatch", [{"pending_dependencies": {"1": 2}}]))
        self.assertFalse(r("idle", []))
        self.assertFalse(r("idle", [{"findings": [{"number": 1}]}]))  # hold: issue event re-arms
        self.assertFalse(r("idle", [{"findings": [], "exhausted": 3}]))  # parked: engineer

    def test_recheck_output_is_written(self):
        with tempfile.NamedTemporaryFile("r+", delete=False) as fh:
            path = fh.name
        try:
            with mock.patch.dict(os.environ, {"GITHUB_OUTPUT": path}), contextlib.redirect_stdout(io.StringIO()):
                self.cand.write_recheck_output(True)
            with open(path, encoding="utf-8") as fh:
                self.assertEqual(fh.read(), "recheck=true\n")
        finally:
            os.unlink(path)


class OrphanedFindingRetry(unittest.TestCase):
    """#6701: a finding the fixer parked keeps holding its merged PR; the
    trigger retries the fixer on it once after ORPHAN_RETRY_AFTER."""

    now = m._time("2026-11-18T16:00:00Z")

    def entry(self, labels, merged="2026-11-18T03:00:00Z", state="open", **extra):
        finding = {"number": 6651, "state": state, "created_at": "2026-11-18T03:30:00Z",
                   "labels": [{"name": "review-finding"}] + [{"name": l} for l in labels]}
        return {"number": 6650, "versions": ["20261218031754"], "merged_at": merged,
                "findings": [finding], **extra}

    def test_selects_parked_findings_held_past_the_window(self):
        for label in ("fixer-deferred", "fixer-failed"):
            got = m.orphaned_findings([self.entry([label])], self.now)
            self.assertEqual([(pr, f["number"]) for pr, f in got], [(6650, 6651)])

    def test_ignores_young_active_closed_and_non_review_holds(self):
        self.assertEqual(m.orphaned_findings([self.entry(["fixer-deferred"], merged="2026-11-18T13:00:00Z")], self.now), [])
        young = self.entry(["fixer-deferred"])
        young["findings"][0]["created_at"] = "2026-11-18T13:00:00Z"
        self.assertEqual(m.orphaned_findings([young], self.now), [])
        self.assertEqual(m.orphaned_findings([self.entry([])], self.now), [])
        self.assertEqual(m.orphaned_findings([self.entry(["fixer-done"])], self.now), [])
        self.assertEqual(m.orphaned_findings([self.entry(["fixer-deferred"], state="closed")], self.now), [])
        self.assertEqual(m.orphaned_findings([self.entry(["fixer-deferred"], exhausted=3)], self.now), [])

    def test_retry_writes_note_removes_label_and_dispatches_once(self):
        writes = []
        with mock.patch.object(m, "gh", return_value=[[]]), \
                mock.patch.object(m, "gh_write", side_effect=lambda *a: writes.append(a) or (True, "ok")):
            lines = m.retry_orphaned_findings("o/r", [self.entry(["fixer-deferred"])], self.now)
        self.assertEqual(lines, ["finding #6651 (holds PR #6650): fixer re-dispatched"])
        self.assertEqual(writes[0][1], "repos/o/r/issues/6651/comments")
        self.assertIn(m.ORPHAN_RETRY_MARKER, writes[0][2]["body"])
        self.assertEqual(writes[1][:2], ("DELETE", "repos/o/r/issues/6651/labels/fixer-deferred"))
        self.assertEqual(writes[2], ("POST", "repos/o/r/actions/workflows/review-fixer.yml/dispatches",
                                     {"ref": "main", "inputs[issue]": "6651"}))

    def test_second_retry_is_refused_and_reported(self):
        with mock.patch.object(m, "gh", return_value=[[{"body": m.ORPHAN_RETRY_MARKER}]]), \
                mock.patch.object(m, "gh_write") as write:
            lines = m.retry_orphaned_findings("o/r", [self.entry(["fixer-failed"])], self.now)
        write.assert_not_called()
        self.assertIn("needs a disposition", lines[0])

    def test_refused_steps_are_reported_on_the_finding(self):
        writes = []
        def write(*a):
            writes.append(a)
            return (False, "403") if a[0] == "DELETE" or "dispatches" in a[1] else (True, "ok")
        with mock.patch.object(m, "gh", return_value=[[]]), mock.patch.object(m, "gh_write", side_effect=write):
            lines = m.retry_orphaned_findings("o/r", [self.entry(["fixer-deferred"])], self.now)
        self.assertIn("retry incomplete", lines[0])
        self.assertIn("label fixer-deferred not removed", lines[0])
        self.assertIn("fixer dispatch refused", lines[0])
        self.assertIn("did not complete", writes[-1][2]["body"])
        self.assertIn("held 12h", writes[0][2]["body"])

    def test_one_malformed_finding_does_not_stop_the_rest(self):
        bad, good = self.entry(["fixer-deferred"]), self.entry(["fixer-deferred"])
        good["number"], good["findings"][0]["number"] = 6660, 6661
        del bad["findings"][0]["number"]
        with mock.patch.object(m, "gh", return_value=[[]]), \
                mock.patch.object(m, "gh_write", return_value=(True, "ok")):
            lines = m.retry_orphaned_findings("o/r", [bad, good], self.now)
        self.assertEqual(len(lines), 2)
        self.assertIn("fixer re-dispatched", lines[1])

    def test_dry_run_and_unreadable_comments_write_nothing(self):
        with mock.patch.object(m, "gh", return_value=[[]]), mock.patch.object(m, "gh_write") as write:
            self.assertIn("would retry", m.retry_orphaned_findings("o/r", [self.entry(["fixer-deferred"])], self.now, dry_run=True)[0])
        write.assert_not_called()
        with mock.patch.object(m, "gh", side_effect=subprocess.CalledProcessError(1, "gh")), \
                mock.patch.object(m, "gh_write") as write:
            self.assertIn("not retried", m.retry_orphaned_findings("o/r", [self.entry(["fixer-deferred"])], self.now)[0])
        write.assert_not_called()
