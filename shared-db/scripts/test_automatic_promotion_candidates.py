import contextlib
import io
import os
import re
import sys
import unittest
from datetime import datetime, timezone
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import automatic_promotion_candidates as m  # noqa: E402

APPLIED = [{"steps": [{"name": m.APPLY_STEP, "conclusion": "success"}, {"name": m.CATALOG_STEP, "conclusion": "failure"}]}]
NOT_APPLIED = [{"steps": [{"name": m.APPLY_STEP, "conclusion": "failure"}, {"name": m.CATALOG_STEP, "conclusion": "failure"}]}]


class AttemptsPerMainCommit(unittest.TestCase):
    def test_a_new_main_commit_earns_fresh_attempts(self):
        pr = {"number": 7, "merged_at": "2026-01-01", "versions": ["1"]}
        runs = [{"display_title": "DB preview apply old PR7 1", "status": "completed", "conclusion": "failure", "created_at": "2026-01-02"}] * 3
        held = lambda n: False
        self.assertEqual(m.decide([pr], runs, held, main_sha="old")[0], "idle")
        self.assertEqual(m.decide([pr], runs, held, main_sha="new")[0], "dispatch")

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


class ForeignTargetVersions(unittest.TestCase):
    def prs(self, *versions):
        files = [[{"status": "added", "filename": f"supabase/migrations/{v}_x.sql"} for v in versions]]
        pulls = [{"number": 5503, "merged_at": "2026-11-02T22:31:03Z"}]
        with mock.patch.object(m, "gh", side_effect=[pulls, files]):
            return m.merged_migration_prs("o/r")

    def test_retired_character_originals_never_reenter_the_automatic_queue(self):
        self.assertEqual(self.prs("20261104214842", "20261105035926"), [])
        self.assertEqual(self.prs("20261104214842", "20261105074028")[0]["versions"], ["20261105074028"])

    def test_sandbox_only_pr_is_never_a_production_candidate(self):
        self.assertEqual(self.prs("20261102215524"), [])

    def test_mixed_pr_promotes_only_its_shared_versions(self):
        self.assertEqual(self.prs("20261102215524", "20261102224413")[0]["versions"], ["20261102224413"])


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
        m.workflow_runs = lambda repo: []
        m.is_held = lambda repo, n: self.pr["findings"]
        sys.argv, os.environ["GITHUB_REPOSITORY"] = ["x", "--dry-run"], "o/r"
        try:
            with contextlib.redirect_stdout(io.StringIO()) as out:
                now = datetime(2026, 11, 2, 20, 0, tzinfo=timezone.utc)
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
    fails = [{"display_title": "DB preview apply abc PR5460 20261102171000", "status": "completed",
              "conclusion": "failure", "created_at": "2026-11-02T18:00:00Z"}] * 3

    def test_main_reports_engineer_action_required_without_failing_the_run(self):
        saved = (m.gh, m.merged_migration_prs, m.workflow_runs, m.is_held, sys.argv, os.environ.get("GITHUB_REPOSITORY"))
        m.gh = lambda *a: {"sha": "abc"}
        m.merged_migration_prs = lambda repo: [self.pr]
        m.workflow_runs = lambda repo: self.fails
        m.is_held = lambda repo, n: []
        sys.argv, os.environ["GITHUB_REPOSITORY"] = ["x", "--dry-run"], "o/r"
        try:
            with contextlib.redirect_stdout(io.StringIO()) as out:
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
    def test_only_catalog_failure_counts_as_applied(self):
        self.assertTrue(m.applied_despite_catalog_check(APPLIED))
        self.assertFalse(m.applied_despite_catalog_check(NOT_APPLIED))
        self.assertFalse(m.applied_despite_catalog_check([]))

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
        m.workflow_runs = lambda repo: [self.rerun]
        m.is_held = lambda repo, n: []
        m.applied_in_any_attempt = lambda repo, run: False
        sys.argv, os.environ["GITHUB_REPOSITORY"] = ["x", "--dry-run"], "o/r"
        try:
            with contextlib.redirect_stdout(io.StringIO()) as out:
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
             mock.patch.object(m, "workflow_runs", lambda repo: [busy]), \
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
        self.assertEqual(m.earlier_preview_apply(pr, [runs[2]]), 3)  # pre-merge is the fallback
        self.assertIsNone(m.earlier_preview_apply(pr, runs[3:]))
        recovery = {"id": 4, "conclusion": "success", "created_at": "2026-10-31T01:50:00Z", "display_title": "DB preview apply a PR 20261030190639"}
        self.assertEqual(m.earlier_preview_apply(pr, runs + [recovery]), 4)
        held = {**recovery, "id": 2, "conclusion": "failure", "created_at": "2026-10-31T01:45:00Z"}
        self.assertEqual(m.earlier_preview_apply(pr, runs + [held]), 7)
        self.assertEqual(m.earlier_preview_apply(pr, runs + [held], lambda r: r["id"] == 2), 2)


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
            with mock.patch.object(m, "HERE", str(scripts)), mock.patch.object(m, "gh", side_effect=[pulls, *pages]):
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
        files = [[[{"status": "added", "filename": str(next((root / "supabase/migrations").glob(v + "_*.sql")).relative_to(root))}]] for v in versions]
        with mock.patch.object(m, "gh", side_effect=[pulls, *files]):
            return m.merged_migration_prs("o/r")

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
        with mock.patch.object(m, "HARD_BLOCKED", m.HARD_BLOCKED - {version}):
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


class AdversarialUnmergedSource(unittest.TestCase):
    """Adversarial table (plan section 9): wording removed from conditions must
    not let an unmerged source through.  merged_migration_prs must refuse it."""

    def test_unmerged_source_refused(self):
        files = [[{"status": "added", "filename": "supabase/migrations/20261105120000_x.sql"}]]
        pulls = [{"number": 5600, "merged_at": None}]
        with mock.patch.object(m, "gh", side_effect=[pulls, files]):
            self.assertEqual(m.merged_migration_prs("o/r"), [])

    def test_closed_but_unmerged_source_refused(self):
        files = [[{"status": "added", "filename": "supabase/migrations/20261105120000_x.sql"}]]
        pulls = [{"number": 5601, "merged_at": ""}]
        with mock.patch.object(m, "gh", side_effect=[pulls, files]):
            self.assertEqual(m.merged_migration_prs("o/r"), [])


if __name__ == "__main__":
    unittest.main()
