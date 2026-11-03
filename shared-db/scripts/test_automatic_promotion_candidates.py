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

    def test_main_fails_the_run_when_a_hold_is_overdue(self):
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
                self.assertEqual(m.main(now), 1)
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

    def test_main_fails_the_run_with_engineer_action_required(self):
        saved = (m.gh, m.merged_migration_prs, m.workflow_runs, m.is_held, sys.argv, os.environ.get("GITHUB_REPOSITORY"))
        m.gh = lambda *a: {"sha": "abc"}
        m.merged_migration_prs = lambda repo: [self.pr]
        m.workflow_runs = lambda repo: self.fails
        m.is_held = lambda repo, n: []
        sys.argv, os.environ["GITHUB_REPOSITORY"] = ["x", "--dry-run"], "o/r"
        try:
            with contextlib.redirect_stdout(io.StringIO()) as out:
                self.assertEqual(m.main(datetime(2026, 11, 2, 20, 0, tzinfo=timezone.utc)), 1)
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


if __name__ == "__main__":
    unittest.main()
