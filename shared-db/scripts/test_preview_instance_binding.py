#!/usr/bin/env python3
"""Tests for the preview rehearsal instance binding (#1208)."""

from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from preview_instance_binding import (  # noqa: E402
    SCHEMA,
    InstanceBindingError,
    build,
    verify,
)

COMMIT = "a" * 40
MERGE = "b" * 40
PREVIEW = "mvpkijzfmfcxhnzqogzs"
DEAD_PREVIEW = "rjyboqwcdzcocqgmsyel"
PRODUCTION = "qsllyeztdwjgirsysgai"


def record(**overrides):
    base = dict(
        applied_commit=COMMIT, preview_project_ref=PREVIEW,
        production_project_ref=PRODUCTION, run_id="7",
        allowlist="20260818232639", rehearsal_mode="merged-main-rehearsal",
        source_pr="1193", merge_commit_sha=MERGE,
    )
    base.update(overrides)
    return build(**base)


class BuildTests(unittest.TestCase):
    def test_merged_main_rehearsal_record_carries_commit_instance_and_merge(self):
        self.assertEqual(record(), {
            "schema": SCHEMA,
            "rehearsalMode": "merged-main-rehearsal",
            "appliedCommit": COMMIT,
            "previewProjectRef": PREVIEW,
            "runId": 7,
            "allowlist": ["20260818232639"],
            "sourcePr": 1193,
            "mergeCommitSha": MERGE,
        })

    def test_claim_mode_record_omits_merge_fields(self):
        built = record(rehearsal_mode="claim", source_pr="", merge_commit_sha="")
        self.assertNotIn("sourcePr", built)
        self.assertNotIn("mergeCommitSha", built)

    def test_build_fails_closed(self):
        cases = [
            ("short commit", {"applied_commit": "abc"}, "not a full 40-character commit SHA"),
            ("bad preview ref", {"preview_project_ref": "nope"}, "not a 20-character"),
            ("preview is production", {"preview_project_ref": PRODUCTION}, "is the PRODUCTION project ref"),
            ("bad production ref", {"production_project_ref": "nope"}, "not a 20-character"),
            ("unknown mode", {"rehearsal_mode": "whatever"}, "is not one of"),
            ("no run id", {"run_id": ""}, "numeric workflow run id"),
            ("empty allowlist", {"allowlist": " , "}, "non-empty allowlist"),
            ("bad version", {"allowlist": "2026"}, "exact 14-digit versions"),
            ("merged rehearsal without pr", {"source_pr": ""}, "must name its merged source pull request"),
            ("merged rehearsal without merge commit", {"merge_commit_sha": ""}, "must name the merge commit"),
        ]
        for label, override, message in cases:
            with self.subTest(label), self.assertRaisesRegex(InstanceBindingError, message):
                record(**override)


class VerifyTests(unittest.TestCase):
    def raw(self, **overrides):
        return json.dumps(record(**overrides))

    def check(self, raw, **overrides):
        args = dict(
            applied_commit=COMMIT, preview_project_ref=PREVIEW,
            production_project_ref=PRODUCTION, run_id=7,
            allowlist=["20260818232639"], source_pr=1193, merge_commit_sha=MERGE,
        )
        args.update(overrides)
        return verify(raw, **args)

    def test_honest_record_verifies(self):
        self.assertEqual(self.check(self.raw())["appliedCommit"], COMMIT)

    def test_merged_main_binding_must_belong_to_the_promoted_pull_request(self):
        """#1213 review, finding 2. `sourcePr`/`mergeCommitSha` were write-only."""
        with self.assertRaisesRegex(InstanceBindingError, "not the pull request being promoted"):
            self.check(self.raw(), source_pr=1194)
        with self.assertRaisesRegex(InstanceBindingError, "not the merge commit"):
            self.check(self.raw(), merge_commit_sha="c" * 40)

    def test_merged_main_binding_is_never_accepted_unbound(self):
        """Each of the three operands, with its OWN message asserted.

        #1213 round 9, the author's per-condition hunt. This test used to accept
        EITHER "never accepted unbound" OR "not the pull request being promoted",
        and that alternation made the `not isinstance(source_pr, int)` operand
        deletable with the whole suite green: with it gone, `source_pr=None` and
        `source_pr="1193"` simply fall through to the value comparison below,
        which raises the second message. A loose regex is the same defect as a
        helper that cannot express a condition -- the assertion cannot tell the
        guard under test from the one after it.

        The type check must fire FIRST and say so, because the value comparison
        it would otherwise fall through to is an equality against whatever the
        record happens to hold, not a statement that the gate was given a usable
        pull-request number at all.
        """
        for override in (
            {"source_pr": None}, {"source_pr": "1193"},
            {"source_pr": True}, {"source_pr": 1193.0},
        ):
            with self.subTest(**override), self.assertRaisesRegex(
                InstanceBindingError, "never accepted unbound"
            ):
                self.check(self.raw(), **override)
        for override in ({"merge_commit_sha": None}, {"merge_commit_sha": 12345}):
            with self.subTest(**override), self.assertRaisesRegex(
                InstanceBindingError, "never accepted unbound"
            ):
                self.check(self.raw(), **override)
        for override in ({"merge_commit_sha": "not-a-sha"}, {"merge_commit_sha": "abc123"}):
            with self.subTest(**override), self.assertRaisesRegex(
                InstanceBindingError, "never accepted unbound"
            ):
                self.check(self.raw(), **override)

    def test_missing_binding_is_refused_not_ignored(self):
        for raw in (None, ""):
            with self.subTest(raw=raw), self.assertRaisesRegex(
                InstanceBindingError, "carries no instance binding"
            ):
                self.check(raw)

    def test_rebuilt_preview_cannot_inherit_the_deleted_previews_proof(self):
        """THE 2026-08-18 FAILURE. Evidence from the deleted preview must not pass."""
        with self.assertRaisesRegex(InstanceBindingError, "never inherits the proof"):
            self.check(json.dumps(record(preview_project_ref=DEAD_PREVIEW)))

    def test_unset_expected_preview_ref_is_never_treated_as_a_default(self):
        with self.assertRaisesRegex(InstanceBindingError, "never treated as a default"):
            self.check(self.raw(), preview_project_ref="")

    def test_expected_preview_ref_may_never_be_production(self):
        with self.assertRaisesRegex(InstanceBindingError, "is the PRODUCTION project ref"):
            self.check(
                json.dumps({**record(), "previewProjectRef": PRODUCTION}),
                preview_project_ref=PRODUCTION,
            )

    def test_binding_from_another_commit_run_or_allowlist_is_refused(self):
        cases = [
            ({"appliedCommit": "c" * 40}, {}, "names applied commit"),
            ({"runId": 9}, {}, "belongs to run 9"),
            ({"allowlist": ["20260101000000"]}, {}, "covers versions"),
            ({"schema": "something/v9"}, {}, "schema is"),
            ({"rehearsalMode": "improvised"}, {}, "rehearsal mode"),
        ]
        for mutation, kwargs, message in cases:
            with self.subTest(mutation), self.assertRaisesRegex(InstanceBindingError, message):
                self.check(json.dumps({**record(), **mutation}), **kwargs)

    def test_unreadable_binding_fails_closed(self):
        for raw, message in (("{not json", "not readable JSON"), ("[1,2]", "not an object")):
            with self.subTest(raw), self.assertRaisesRegex(InstanceBindingError, message):
                self.check(raw)


if __name__ == "__main__":
    unittest.main()
