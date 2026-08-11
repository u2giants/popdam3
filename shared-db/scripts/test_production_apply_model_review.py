#!/usr/bin/env python3
"""Offline tests for the production apply model review.

No network, no secrets, no database. Every API call is stubbed.

The behaviour under test is the one that was broken: a review that did not
happen must FAIL, and a review that happened must PASS regardless of the
model's opinion.
"""

import json
from pathlib import Path
import re
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))

import production_apply_model_review as review  # noqa: E402


class EnvSandbox(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        temp = Path(self.temp.name)
        (temp / "supabase" / "migrations").mkdir(parents=True)
        (temp / "supabase" / "migrations" / "20260101000000_thing.sql").write_text(
            "create table public.thing();", encoding="utf-8"
        )
        self.summary = temp / "summary.md"
        env = {
            "PRODUCTION_ALLOWLIST": "20260101000000",
            "REQUESTED_SHA": "deadbeef",
            "ANTHROPIC_API_KEY": "test-key",
            "GITHUB_WORKSPACE": str(temp),
            "RUNNER_TEMP": str(temp),
            "GITHUB_STEP_SUMMARY": str(self.summary),
        }
        patcher = patch.dict("os.environ", env, clear=False)
        patcher.start()
        self.addCleanup(patcher.stop)

    def summary_text(self) -> str:
        return (
            self.summary.read_text(encoding="utf-8")
            if self.summary.exists()
            else ""
        )


class TestReviewMustRun(EnvSandbox):
    """The whole point: a review that did not happen is RED, not green."""

    def test_missing_api_key_fails_the_job(self) -> None:
        with patch.dict("os.environ", {"ANTHROPIC_API_KEY": ""}):
            self.assertEqual(review.main(), 1)
        text = self.summary_text()
        self.assertIn("REVIEW DID NOT RUN", text)
        self.assertIn("ANTHROPIC_API_KEY", text)

    def test_whitespace_only_api_key_fails_the_job(self) -> None:
        with patch.dict("os.environ", {"ANTHROPIC_API_KEY": "   "}):
            self.assertEqual(review.main(), 1)

    def test_empty_allowlist_fails_the_job(self) -> None:
        with patch.dict("os.environ", {"PRODUCTION_ALLOWLIST": ""}):
            self.assertEqual(review.main(), 1)
        self.assertIn("allowlist was empty", self.summary_text())

    def test_api_error_fails_the_job_after_retrying(self) -> None:
        calls = []

        def boom(prompt, api_key):
            calls.append(1)
            raise OSError("connection reset")

        with patch.object(review, "call_api", boom), patch.object(
            review.time, "sleep", lambda _s: None
        ):
            self.assertEqual(review.main(), 1)
        self.assertEqual(len(calls), review.ATTEMPTS)
        self.assertIn("REVIEW DID NOT RUN", self.summary_text())

    def test_empty_model_response_fails_the_job(self) -> None:
        with patch.object(review, "call_api", lambda p, k: "  "), patch.object(
            review.time, "sleep", lambda _s: None
        ):
            self.assertEqual(review.main(), 1)

    def test_transient_failure_then_success_passes(self) -> None:
        state = {"n": 0}

        def flaky(prompt, api_key):
            state["n"] += 1
            if state["n"] == 1:
                raise OSError("transient")
            return "Looks fine.\nVERDICT: CLEAR"

        with patch.object(review, "call_api", flaky), patch.object(
            review.time, "sleep", lambda _s: None
        ):
            self.assertEqual(review.main(), 0)
        self.assertEqual(state["n"], 2)

    def _big_batch(self) -> list[str]:
        """Write migrations that together blow past MAX_SQL_CHARS."""
        migrations = Path(self.temp.name) / "supabase" / "migrations"
        versions = []
        for i in range(3):
            version = f"2026010200000{i}"
            (migrations / f"{version}_big.sql").write_text(
                "-- x" * (review.MAX_SQL_CHARS // 4), encoding="utf-8"
            )
            versions.append(version)
        return versions

    def test_a_truncated_batch_cannot_return_clear(self) -> None:
        """THE HIGH FINDING. A batch that does not fit must never pass.

        collect_sql used to `break` at MAX_SQL_CHARS, so migrations after the
        cut were invisible to the model and it could still answer CLEAR.
        """
        versions = self._big_batch()
        called = []

        def should_not_run(prompt, api_key):
            called.append(prompt)
            return "Everything looks great.\nVERDICT: CLEAR"

        with patch.dict(
            "os.environ", {"PRODUCTION_ALLOWLIST": ",".join(versions)}
        ), patch.object(review, "call_api", should_not_run):
            self.assertEqual(review.main(), 1)
        # Not merely "did not return CLEAR" -- the API is never even asked, so no
        # clean-looking verdict about unsent SQL can exist anywhere.
        self.assertEqual(called, [])
        text = self.summary_text()
        self.assertIn("REVIEW DID NOT RUN", text)
        self.assertNotIn("VERDICT: CLEAR", text)

    def test_the_operator_is_told_exactly_what_was_not_sent(self) -> None:
        versions = self._big_batch()
        with patch.dict("os.environ", {"PRODUCTION_ALLOWLIST": ",".join(versions)}):
            self.assertEqual(review.main(), 1)
        text = self.summary_text()
        self.assertIn("were NOT sent", text)
        # The dropped versions are named, not just counted.
        self.assertIn(versions[-1], text)
        self.assertIn("Split the allowlist", text)

    def test_collect_sql_reports_oversize_files_instead_of_breaking(self) -> None:
        versions = self._big_batch()
        sql, unsent = review.collect_sql(Path(self.temp.name), versions)
        # The first file fits; the two after it are reported, not dropped.
        self.assertEqual(len(unsent), 2)
        self.assertIn(versions[0], sql)
        for dropped in versions[1:]:
            self.assertNotIn(dropped, sql)
            self.assertTrue(any(dropped in u for u in unsent))

    def test_collect_sql_reports_a_missing_file_as_unsent(self) -> None:
        sql, unsent = review.collect_sql(Path(self.temp.name), ["20991231000000"])
        self.assertEqual(sql, "")
        self.assertEqual(len(unsent), 1)
        self.assertIn("file not found", unsent[0])

    def test_a_batch_that_fits_is_still_sent_whole(self) -> None:
        """The guard must not turn into a blanket refusal."""
        sql, unsent = review.collect_sql(
            Path(self.temp.name), ["20260101000000"]
        )
        self.assertEqual(unsent, [])
        self.assertIn("create table public.thing();", sql)

    def test_there_is_no_bypass_env_var(self) -> None:
        """A future 'skip the review' flag must not quietly reappear."""
        source = Path(review.__file__).read_text(encoding="utf-8")
        for banned in ("SKIP_MODEL_REVIEW", "MODEL_REVIEW_OPTIONAL", "ALLOW_NO_REVIEW"):
            self.assertNotIn(banned, source)


class TestVerdictStaysAdvisory(EnvSandbox):
    """A model may not block a production apply, nor have its concerns hidden."""

    def test_clear_verdict_passes(self) -> None:
        with patch.object(review, "call_api", lambda p, k: "Nothing.\nVERDICT: CLEAR"):
            self.assertEqual(review.main(), 0)
        self.assertNotIn("RAISED CONCERNS", self.summary_text())

    def test_concerns_verdict_passes_but_shouts(self) -> None:
        with patch.object(
            review, "call_api", lambda p, k: "Drops a column.\nVERDICT: CONCERNS"
        ):
            self.assertEqual(review.main(), 0)
        text = self.summary_text()
        self.assertIn("RAISED CONCERNS", text)
        self.assertIn("Drops a column.", text)

    def test_unreadable_verdict_is_treated_as_concerns(self) -> None:
        with patch.object(review, "call_api", lambda p, k: "I have opinions."):
            self.assertEqual(review.main(), 0)
        text = self.summary_text()
        self.assertIn("RAISED CONCERNS", text)
        self.assertIn("readable", text)

    def test_read_verdict_takes_the_last_line(self) -> None:
        self.assertEqual(
            review.read_verdict("VERDICT: CLEAR\nmore\nVERDICT: CONCERNS"), "CONCERNS"
        )
        self.assertEqual(review.read_verdict("nope"), "UNREADABLE")
        self.assertEqual(review.read_verdict("VERDICT: CLEAR"), "CLEAR")

    def test_prompt_demands_a_machine_readable_verdict(self) -> None:
        self.assertIn("VERDICT: CLEAR", review.PROMPT)
        self.assertIn("VERDICT: CONCERNS", review.PROMPT)


class TestModelIsConfigurable(EnvSandbox):
    """WHAT THIS CAN AND CANNOT CATCH.

    CAN (offline, no network, no key): that the model id is read from
    configuration with a default; that the default is exactly the documented
    constant and is shaped like a real Anthropic id; that the id actually
    reaches the request body; and that an HTTP 404 produces a message naming
    the model and calling it a configuration problem, without retrying.

    CANNOT: whether the default id is a model the live API will serve. Nothing
    offline can know that -- the id that broke this lane
    (`claude-opus-4-5-20260514`) passes every structural check here. Only a live
    call proves an id is real; see the recommendation in the PR body.
    """

    def test_default_is_used_when_the_env_var_is_unset(self) -> None:
        with patch.dict("os.environ", {review.MODEL_ENV_VAR: ""}):
            self.assertEqual(review.resolve_model(), review.DEFAULT_MODEL)

    def test_env_var_overrides_the_default(self) -> None:
        with patch.dict("os.environ", {review.MODEL_ENV_VAR: "claude-sonnet-4-6"}):
            self.assertEqual(review.resolve_model(), "claude-sonnet-4-6")

    def test_whitespace_only_env_var_falls_back_to_the_default(self) -> None:
        with patch.dict("os.environ", {review.MODEL_ENV_VAR: "   "}):
            self.assertEqual(review.resolve_model(), review.DEFAULT_MODEL)

    def test_the_default_matches_the_documented_constant(self) -> None:
        """Pinned so a silent edit of the id is a visible test change.

        This asserts the id we verified against the live API on 2026-08-11. It
        does NOT prove the id still resolves today.
        """
        self.assertEqual(review.DEFAULT_MODEL, "claude-opus-4-5-20251101")
        self.assertRegex(review.DEFAULT_MODEL, r"^claude-[a-z0-9.-]+$")
        self.assertNotIn("20260514", review.DEFAULT_MODEL)

    def test_the_model_id_reaches_the_request_body(self) -> None:
        seen = {}

        class FakeResponse:
            def read(self):
                return b'{"content": [{"type": "text", "text": "ok"}]}'

            def __enter__(self):
                return self

            def __exit__(self, *exc):
                return False

        def fake_urlopen(request, timeout=None):
            seen["body"] = json.loads(request.data.decode("utf-8"))
            return FakeResponse()

        with patch.dict(
            "os.environ", {review.MODEL_ENV_VAR: "claude-configured-model"}
        ), patch.object(review.urllib.request, "urlopen", fake_urlopen):
            review.call_api("prompt", "key")
        self.assertEqual(seen["body"]["model"], "claude-configured-model")

    def test_a_404_names_the_model_and_does_not_retry(self) -> None:
        """The defect this whole change exists for: a wrong id used to read as
        `HTTP Error 404`, i.e. as a network blip rather than a config error."""
        calls = []

        def not_found(request, timeout=None):
            calls.append(1)
            raise review.urllib.error.HTTPError(
                review.API_URL, 404, "Not Found", {}, None
            )

        with patch.dict(
            "os.environ", {review.MODEL_ENV_VAR: "claude-does-not-exist"}
        ), patch.object(
            review.urllib.request, "urlopen", not_found
        ), patch.object(review.time, "sleep", lambda _s: None):
            self.assertEqual(review.main(), 1)
        text = self.summary_text()
        self.assertIn("REVIEW DID NOT RUN", text)
        self.assertIn("claude-does-not-exist", text)
        self.assertIn("does not exist", text)
        self.assertIn("CONFIGURATION problem", text)
        self.assertIn(review.MODEL_ENV_VAR, text)
        # A 404 will never fix itself; burning the retry budget on it only
        # delays the red job.
        self.assertEqual(len(calls), 1)

    def test_a_500_is_still_retried_as_transient(self) -> None:
        calls = []

        def boom(request, timeout=None):
            calls.append(1)
            raise review.urllib.error.HTTPError(
                review.API_URL, 500, "Server Error", {}, None
            )

        with patch.object(
            review.urllib.request, "urlopen", boom
        ), patch.object(review.time, "sleep", lambda _s: None):
            self.assertEqual(review.main(), 1)
        self.assertEqual(len(calls), review.ATTEMPTS)

    def test_the_evidence_records_which_model_reviewed(self) -> None:
        with patch.dict(
            "os.environ", {review.MODEL_ENV_VAR: "claude-recorded-model"}
        ), patch.object(review, "call_api", lambda p, k: "Nothing.\nVERDICT: CLEAR"):
            self.assertEqual(review.main(), 0)
        self.assertIn("claude-recorded-model", self.summary_text())


class TestWorkflowWiring(unittest.TestCase):
    """The script can only fail the job if the step is allowed to fail."""

    def test_the_model_is_wired_as_configuration_not_code(self) -> None:
        """The workflow must pass the model env var through, so the id can be
        changed without a code change (and without a bypass)."""
        workflow = (
            Path(__file__).resolve().parents[1]
            / ".github"
            / "workflows"
            / "shared-supabase-migrations.yml"
        ).read_text(encoding="utf-8")
        self.assertIn("SHARED_DB_REVIEW_MODEL: ${{ vars.SHARED_DB_REVIEW_MODEL }}", workflow)
        # And the dead id never comes back.
        self.assertNotIn("claude-opus-4-5-20260514", workflow)

    def test_model_review_step_has_no_continue_on_error(self) -> None:
        workflow = (
            Path(__file__).resolve().parents[1]
            / ".github"
            / "workflows"
            / "shared-supabase-migrations.yml"
        ).read_text(encoding="utf-8")
        self.assertIn("production_apply_model_review.py", workflow)
        # A real step-level key, not the word inside an explanatory comment.
        offenders = [
            line
            for line in workflow.splitlines()
            if re.match(r"^\s*continue-on-error\s*:", line)
        ]
        self.assertEqual(offenders, [], f"continue-on-error is back: {offenders}")


if __name__ == "__main__":
    unittest.main()
