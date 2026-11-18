from copy import deepcopy
import unittest

from compare_issue_5610_performance import compare


DELIVERED = "2026-11-20T17:30:00+00:00"
CAPTURE_TIMES = (
    "2026-11-19T17:00:00+00:00", "2026-11-20T17:00:00+00:00",
    "2026-11-20T18:00:00+00:00", "2026-11-21T18:00:01+00:00",
)


def row(queryid, calls, duration, *, since="2026-11-19T10:00:00+00:00"):
    return {
        "userid": "5", "dbid": "6", "toplevel": True, "queryid": queryid,
        "stats_since": since, "query_md5": "9a652648190dae510e596cb689055aa1",
        "features": ["dam_search"], "calls": str(calls), "total_exec_ms": str(duration),
    }


def captures():
    return [
        {
            "format": "5610-search-performance-v1", "started_at": start, "finished_at": start,
            "database_oid": "6", "statement_track": "top",
            "postmaster_started_at": "2026-11-06T16:20:00+00:00", "database_stats_reset": None,
            "statement_stats_reset": "2026-11-06T16:20:00+00:00", "dealloc": "50",
            "capture_stable": True, "unreadable_rows": 0,
            "statements": [
                row("-9223372036854775808", calls, duration),
                row("22", calls, duration * 2),
            ],
        }
        for start, calls, duration in zip(CAPTURE_TIMES, (100, 102, 103, 107), (1000, 1020, 1030, 1110))
    ]


class CompareIssue5610Tests(unittest.TestCase):
    def test_deltas_weighted_mean_and_missing_feature(self):
        data = captures()
        data[-1]["statements"].append(row(
            "23", 1, 80, since="2026-11-20T18:00:00+00:00",
        ))
        result = compare(data, DELIVERED)
        self.assertTrue(result["evidence_only"])
        self.assertNotIn("passed", result)
        self.assertEqual(result["pre"]["dam_search"]["calls"], 4)
        self.assertEqual(result["pre"]["dam_search"]["mean_exec_ms"], "15")
        self.assertEqual(result["post"]["dam_search"]["calls"], 9)
        self.assertEqual(result["post"]["dam_search"]["total_exec_ms"], "320")
        self.assertTrue(result["post"]["dam_search"]["statements"][-1]["new_identity"])
        self.assertIsNone(result["post"]["style_guide_browse"]["mean_exec_ms"])

    def test_refuses_short_window_using_capture_bounds(self):
        data = captures()
        data[2]["finished_at"] = "2026-11-20T18:00:02+00:00"
        with self.assertRaisesRegex(ValueError, "shorter than 24 hours"):
            compare(data, DELIVERED)

    def test_refuses_reset_eviction_and_unreadable_query(self):
        for key, value, message in (
            ("dealloc", "51", "continuity failed"),
            ("statement_track", "none", "statement tracking disabled"),
            ("statement_stats_reset", "2026-11-20T20:00:00+00:00", "continuity failed"),
            ("capture_stable", False, "unstable capture"),
            ("unreadable_rows", 1, "unreadable statement"),
        ):
            with self.subTest(key=key):
                data = captures()
                data[-1][key] = value
                with self.assertRaisesRegex(ValueError, message):
                    compare(data, DELIVERED)

    def test_refuses_disappeared_statement_and_inconsistent_counters(self):
        data = captures()
        data[-1]["statements"].pop()
        with self.assertRaisesRegex(ValueError, "missing at close"):
            compare(data, DELIVERED)
        data = captures()
        data[-1]["statements"][0]["calls"] = "1"
        with self.assertRaisesRegex(ValueError, "counters are inconsistent"):
            compare(data, DELIVERED)

    def test_checks_identity_continuity_across_delivery(self):
        data = captures()
        for snapshot in data[2:]:
            snapshot["statements"][0]["stats_since"] = "2026-11-20T17:59:11+00:00"
        with self.assertRaisesRegex(ValueError, "identity or feature attribution changed"):
            compare(data, DELIVERED)

    def test_refuses_duplicate_and_old_newly_visible_statement(self):
        data = captures()
        data[-1]["statements"].append(deepcopy(data[-1]["statements"][0]))
        with self.assertRaisesRegex(ValueError, "duplicate statement identity"):
            compare(data, DELIVERED)
        data = captures()
        data[-1]["statements"].append(row("23", 1, 2))
        with self.assertRaisesRegex(ValueError, "predates interval opening"):
            compare(data, DELIVERED)


if __name__ == "__main__":
    unittest.main()
