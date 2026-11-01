import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import automatic_promotion_candidates as m  # noqa: E402

APPLIED = [{"steps": [{"name": m.APPLY_STEP, "conclusion": "success"}, {"name": m.CATALOG_STEP, "conclusion": "failure"}]}]
NOT_APPLIED = [{"steps": [{"name": m.APPLY_STEP, "conclusion": "failure"}, {"name": m.CATALOG_STEP, "conclusion": "failure"}]}]


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
        self.assertIsNone(m.earlier_preview_apply(pr, runs[3:]))
        recovery = {"id": 4, "conclusion": "success", "created_at": "2026-10-31T01:50:00Z", "display_title": "DB preview apply a PR 20261030190639"}
        self.assertEqual(m.earlier_preview_apply(pr, runs + [recovery]), 4)
        held = {**recovery, "id": 2, "conclusion": "failure", "created_at": "2026-10-31T01:45:00Z"}
        self.assertEqual(m.earlier_preview_apply(pr, runs + [held]), 7)
        self.assertEqual(m.earlier_preview_apply(pr, runs + [held], lambda r: r["id"] == 2), 2)


if __name__ == "__main__":
    unittest.main()
