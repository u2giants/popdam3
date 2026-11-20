"""#6701 remaining gaps: HARD_BLOCKED logging, honest idle claim, hold
timeout, superseded-head holds, and adopt-on-merged-PR findings.

No network, no database. Discovery and classify/decide are driven with
mocked gh; review_finding_hold is exercised through main() with injected
head readers.
"""
from __future__ import annotations

import contextlib
import io
import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))

import automatic_promotion_candidates as m  # noqa: E402
import review_finding_hold as hold  # noqa: E402

REPO = "popcre/shared-db"
NOW = datetime(2026, 11, 20, 12, 0, 0, tzinfo=timezone.utc)


class HardBlockedSkipIsLogged(unittest.TestCase):
    def test_hard_blocked_version_is_logged_and_marked_never_promote(self):
        files = [[{"status": "added", "filename": "supabase/migrations/20261218025935_x.sql"}]]
        pulls = [{"number": 9001, "merged_at": "2026-11-05T01:00:00Z"}]
        with mock.patch.object(m, "gh", side_effect=[[pulls], files]), \
                mock.patch.object(m, "HARD_BLOCKED", m.HARD_BLOCKED | {"20261218025935"}), \
                contextlib.redirect_stdout(io.StringIO()) as out:
            found = m.merged_migration_prs("o/r")
        self.assertIn("never promote", out.getvalue())
        self.assertIn("20261218025935", out.getvalue())
        self.assertEqual(found[0]["versions"], [])
        self.assertIn("20261218025935", found[0]["never_promote"])

    def test_idle_claim_excludes_never_promote_originals(self):
        entry = {
            "number": 9001, "merged_at": "2026-11-05T01:00:00Z", "versions": [],
            "never_promote": ["20261218025935"], "never_promote_reason": "retired original",
        }
        action, pr, reason = m.decide([entry], [], lambda n: [], now=NOW)
        self.assertEqual(action, "idle")
        self.assertIsNone(pr)
        self.assertIn("NOT in production via this lane", reason)
        self.assertIn("20261218025935", reason)
        self.assertNotIn(
            "every merged migration PR since activation is in production",
            reason,
        )

    def test_never_promote_is_not_dispatched(self):
        entry = {
            "number": 9001, "merged_at": "2026-11-05T01:00:00Z", "versions": [],
            "never_promote": ["20261218025935"], "never_promote_reason": "retired original",
        }
        action, _, _ = m.decide([entry], [], lambda n: [], now=NOW)
        self.assertEqual(action, "idle")


class HoldTimeout(unittest.TestCase):
    pr = {"number": 5456, "merged_at": "2026-11-02T17:00:00Z", "versions": ["20261102170000"]}
    finding = {"number": 5457, "created_at": "2026-11-02T17:30:00Z", "state": "open"}

    def test_hold_still_blocks_within_timeout(self):
        held = lambda n: [self.finding]  # noqa: E731
        near = m._time("2026-11-02T17:45:00Z")
        skipped = []
        action, pr, reason = m.decide([self.pr], [], held, now=near, skipped=skipped)
        self.assertEqual(action, "idle")
        self.assertIn("not held", reason)
        self.assertEqual(skipped[0]["findings"], [self.finding])
        self.assertFalse(skipped[0].get("hold_timed_out"))

    def test_hold_times_out_and_no_longer_blocks(self):
        held = lambda n: [self.finding]  # noqa: E731
        skipped = []
        action, pr, reason = m.decide([self.pr], [], held, now=NOW, skipped=skipped)
        self.assertEqual(action, "dispatch")
        self.assertEqual(pr["number"], 5456)
        self.assertTrue(skipped[0].get("hold_timed_out"))
        self.assertEqual(skipped[0]["findings"], [self.finding])


class SupersededHeadHold(unittest.TestCase):
    def test_superseded_head_does_not_hold(self):
        item = {
            "number": 1, "state": "open",
            "body": f"PR: https://github.com/{REPO}/pull/5100\nHead SHA: `{'a' * 40}`\n",
        }
        code = hold.main(
            ["--pr", "5100", "--repo", REPO],
            fetch=lambda _r, _p: [item],
            now=NOW,
            verify_invalid=lambda *_a: False,
            head_reader=lambda _r, _n: "b" * 40,
        )
        self.assertEqual(code, 0)

    def test_matching_head_holds(self):
        item = {
            "number": 1, "state": "open",
            "body": f"PR: https://github.com/{REPO}/pull/5100\nHead SHA: `{'a' * 40}`\n",
        }
        code = hold.main(
            ["--pr", "5100", "--repo", REPO],
            fetch=lambda _r, _p: [item],
            now=NOW,
            verify_invalid=lambda *_a: False,
            head_reader=lambda _r, _n: "a" * 40,
        )
        self.assertEqual(code, 3)


class AdoptMergedFindings(unittest.TestCase):
    def test_adopt_posts_marker_and_closes_timed_out_finding(self):
        entry = {
            "number": 5456, "merged_at": "2026-11-02T17:00:00Z", "versions": ["20261102170000"],
            "findings": [{"number": 5457, "created_at": "2026-11-02T17:30:00Z", "state": "open"}],
            "hold_timed_out": True,
        }
        writes = []

        def gh_write(method, path, fields=None):
            writes.append((method, path, fields))
            return True, ""

        with mock.patch.object(m, "review_finding_hold") as rf, \
                mock.patch.object(m, "gh", return_value=[[]]), \
                mock.patch.object(m, "gh_write", side_effect=gh_write):
            rf.pull_head_sha.return_value = "b" * 40
            rf.finding_head_sha.return_value = "a" * 40
            lines = m.adopt_merged_findings("o/r", [entry], NOW, dry_run=False)
        self.assertEqual(len(lines), 1)
        self.assertIn("adopted and closed", lines[0])
        methods = [w[0] for w in writes]
        self.assertIn("POST", methods)
        self.assertIn("PATCH", methods)
        comment = next(f for meth, path, f in writes if meth == "POST" and "comments" in path)
        self.assertIn(m.ADOPT_MARKER, comment["body"])

    def test_adopt_is_skipped_when_finding_still_current_and_fresh(self):
        entry = {
            "number": 5456, "merged_at": NOW.strftime("%Y-%m-%dT%H:%M:%SZ"), "versions": ["v"],
            "findings": [{"number": 5457, "created_at": NOW.strftime("%Y-%m-%dT%H:%M:%SZ"),
                          "state": "open", "body": f"Head SHA: `{'a' * 40}`"}],
        }
        with mock.patch.object(m, "review_finding_hold") as rf:
            rf.pull_head_sha.return_value = "a" * 40
            rf.finding_head_sha.return_value = "a" * 40
            lines = m.adopt_merged_findings("o/r", [entry], NOW, dry_run=False)
        self.assertEqual(lines, [])


if __name__ == "__main__":
    unittest.main()
