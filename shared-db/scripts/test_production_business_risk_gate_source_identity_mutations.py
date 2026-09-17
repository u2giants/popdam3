"""Falsification tests for business-risk source identity utilities (issue #2363).

PR #2354's guard mutation sweep found these refusal guards could be replaced
with ``False`` while the offline suite stayed green. Each test pairs an accepted
input with the malformed one the guard exists to refuse.
"""
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from production_business_risk_gate import (
    RiskGateError, blob_sha_from_tree, canonical_sha256, preview_applied_commit, source_pr_commits,
)


class SourceIdentityGuardTests(unittest.TestCase):
    def test_preview_artifacts_that_are_not_a_list_are_unreadable(self):
        commit = "a" * 40
        artifact = {"name": f"preview-migration-apply-{commit}", "expired": False, "workflow_run": {"id": 7}}
        self.assertEqual(preview_applied_commit({"artifacts": [artifact]}, 7), (artifact, commit))
        for payload in ({}, {"artifacts": None}, {"artifacts": {"0": artifact}}, [artifact], None):
            with self.subTest(payload=payload), self.assertRaisesRegex(RiskGateError, "preview run artifacts are unreadable"):
                preview_applied_commit(payload, 7)

    def test_bare_carriage_return_is_refused_while_crlf_is_normalised(self):
        with tempfile.TemporaryDirectory() as temp:
            crlf = Path(temp, "20260101000000_crlf.sql")
            lf = Path(temp, "20260101000000_lf.sql")
            crlf.write_bytes(b"select 1;\r\nselect 2;\r\n")
            lf.write_bytes(b"select 1;\nselect 2;\n")
            self.assertEqual(canonical_sha256(crlf), canonical_sha256(lf))
            for raw in (b"select 1;\rselect 2;\n", b"select 1;\r\n\r"):
                bare = Path(temp, "20260101000000_bare.sql")
                bare.write_bytes(raw)
                with self.subTest(raw=raw), self.assertRaisesRegex(RiskGateError, "bare CR line endings"):
                    canonical_sha256(bare)

    def test_tree_entry_that_is_not_an_object_is_unreadable(self):
        path = "scripts/x.py"
        self.assertEqual(blob_sha_from_tree(path, "r", {path: {"type": "blob", "sha": "abc"}}), "abc")
        for entries in ({}, {path: None}, {path: "abc"}, {path: ["blob", "abc"]}):
            with self.subTest(entries=entries), self.assertRaisesRegex(RiskGateError, f"preview producer file {path} is unreadable at r"):
                blob_sha_from_tree(path, "r", entries)

    def test_source_pr_commits_that_are_not_a_list_are_unreadable(self):
        self.assertEqual(
            source_pr_commits(9, "h" * 40, "m" * 40, lambda _: [{"sha": "c" * 40}]),
            {"h" * 40, "m" * 40, "c" * 40},
        )
        for payload in ({"sha": "c" * 40}, {"commits": [{"sha": "c" * 40}]}, None, "c" * 40):
            with self.subTest(payload=payload), self.assertRaisesRegex(RiskGateError, "source pull request commits are unreadable"):
                source_pr_commits(9, "h" * 40, "m" * 40, lambda _, value=payload: value)


if __name__ == "__main__":
    unittest.main()
