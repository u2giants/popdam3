import unittest
from requalified_preview_runs import requalified_preview_run, run_attempt_admitted

HEAD = "fe3931607f952029ce6174073f7320d580a188b7"


class RequalifiedPreviewRunTests(unittest.TestCase):
    def test_attempt_one_is_admitted(self):
        self.assertTrue(run_attempt_admitted({"id": 5, "run_attempt": 1, "head_sha": HEAD}))

    def test_pinned_attempt_two_is_admitted(self):
        self.assertTrue(run_attempt_admitted({"id": 39173012894, "run_attempt": 2, "head_sha": HEAD}))

    def test_other_reruns_are_refused(self):
        for run in ({"id": 5, "run_attempt": 2, "head_sha": HEAD},
                    {"id": 39173012894, "run_attempt": 3, "head_sha": HEAD},
                    {"id": 39173012894, "run_attempt": 2, "head_sha": "f" * 40},
                    {"id": "39173012894", "run_attempt": 2, "head_sha": HEAD}, None):
            self.assertFalse(run_attempt_admitted(run))
            self.assertIsNone(requalified_preview_run(run))


if __name__ == "__main__":
    unittest.main()
