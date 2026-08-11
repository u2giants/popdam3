#!/usr/bin/env python3
"""Offline tests for the production apply model review.

No network, no secrets, no database. Every API call is stubbed.

Two behaviours are under test, and they pull in opposite directions:

  * a review that did not happen must FAIL (the lane's whole point), and
  * a review that happened must PASS regardless of the model's opinion.

Plus the defect that stopped batch B3: a response whose entire token budget
went to thinking, leaving no text block, must escalate the budget rather than
retry the same doomed request six times -- and if it still cannot be reviewed,
the error must say WHY.
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


def fake_body(text=None, stop_reason="end_turn", blocks=None, usage=None):
    """A minimal /v1/messages response body."""
    if blocks is None:
        blocks = [{"type": "text", "text": text}] if text is not None else []
    return {
        "content": blocks,
        "stop_reason": stop_reason,
        "usage": usage or {"output_tokens": 10},
    }


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
            # Pin the model so the default path (a live /v1/models call) is not
            # exercised by tests that are about something else.
            review.MODEL_ENV_VAR: "claude-test-model",
        }
        patcher = patch.dict("os.environ", env, clear=False)
        patcher.start()
        self.addCleanup(patcher.stop)
        review._RESOLVED_MODEL = None

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

        def boom(prompt, api_key, model, max_tokens):
            calls.append(1)
            raise OSError("connection reset")

        with patch.object(review, "call_api", boom), patch.object(
            review.time, "sleep", lambda _s: None
        ):
            self.assertEqual(review.main(), 1)
        self.assertEqual(len(calls), review.ATTEMPTS)
        self.assertIn("REVIEW DID NOT RUN", self.summary_text())

    def test_transient_failure_then_success_passes(self) -> None:
        state = {"n": 0}

        def flaky(prompt, api_key, model, max_tokens):
            state["n"] += 1
            if state["n"] == 1:
                raise OSError("transient")
            return "Looks fine.\nVERDICT: CLEAR"

        with patch.object(review, "call_api", flaky), patch.object(
            review.time, "sleep", lambda _s: None
        ):
            self.assertEqual(review.main(), 0)
        self.assertEqual(state["n"], 2)

    def test_there_is_no_bypass_env_var(self) -> None:
        """A future 'skip the review' flag must not quietly reappear."""
        source = Path(review.__file__).read_text(encoding="utf-8")
        for banned in ("SKIP_MODEL_REVIEW", "MODEL_REVIEW_OPTIONAL", "ALLOW_NO_REVIEW"):
            self.assertNotIn(banned, source)


class TestEmptyResponseDiagnostics(EnvSandbox):
    """THE B3 DEFECT.

    `max_tokens` bounds thinking PLUS text. With the old 4000-token budget the
    model spent the whole thing thinking, returned a lone `thinking` block with
    `stop_reason: "max_tokens"`, and text extraction produced "". The lane then
    retried the identical request twice more, and the operator was told only
    "the model returned an empty response".
    """

    def _thinking_only(self):
        return fake_body(
            blocks=[{"type": "thinking", "thinking": ""}],
            stop_reason="max_tokens",
            usage={
                "output_tokens": 4000,
                "output_tokens_details": {"thinking_tokens": 4000},
            },
        )

    def test_thinking_only_response_raises_with_the_details(self) -> None:
        def urlopen(request, timeout=None):
            return FakeResponse(self._thinking_only())

        with patch.object(review.urllib.request, "urlopen", urlopen):
            with self.assertRaises(review.EmptyModelResponse) as caught:
                review.call_api("prompt", "key", "claude-test-model", 4000)
        message = str(caught.exception)
        self.assertIn("max_tokens", message)
        self.assertIn("thinking", message)
        self.assertIn("4000", message)

    def test_a_max_tokens_empty_response_escalates_instead_of_retrying(self) -> None:
        """It is deterministic, so retrying the same budget is pure delay."""
        seen: list[int] = []

        def call(prompt, api_key, model, max_tokens):
            seen.append(max_tokens)
            if max_tokens < review.TOKEN_BUDGETS[-1]:
                raise review.EmptyModelResponse(
                    "max_tokens", ["thinking"], len(prompt), max_tokens, {}
                )
            return "Fine.\nVERDICT: CLEAR"

        with patch.object(review, "call_api", call), patch.object(
            review.time, "sleep", lambda _s: None
        ):
            self.assertEqual(review.main(), 0)
        # One shot per budget -- no wasted retries at a budget already proven
        # too small.
        self.assertEqual(seen, list(review.TOKEN_BUDGETS))

    def test_exhausting_every_budget_fails_and_names_the_cause(self) -> None:
        def call(prompt, api_key, model, max_tokens):
            raise review.EmptyModelResponse(
                "max_tokens", ["thinking"], len(prompt), max_tokens, {}
            )

        with patch.object(review, "call_api", call), patch.object(
            review.time, "sleep", lambda _s: None
        ):
            self.assertEqual(review.main(), 1)
        text = self.summary_text()
        self.assertIn("REVIEW DID NOT RUN", text)
        self.assertIn("stop_reason", text)
        self.assertIn("thinking", text)
        self.assertIn(str(review.TOKEN_BUDGETS[-1]), text)
        self.assertNotIn("VERDICT: CLEAR", text)

    def test_a_genuinely_empty_response_says_it_is_not_truncation(self) -> None:
        exc = review.EmptyModelResponse("end_turn", [], 100, 16000, {})
        self.assertIn("no text", str(exc))
        self.assertNotIn("budget was exhausted", str(exc))


class TestBatchChunking(EnvSandbox):
    """B3 is 336KB and B9 is 534KB. Both must be reviewed, in full."""

    def _batch(self, count: int, size: int) -> list[str]:
        migrations = Path(self.temp.name) / "supabase" / "migrations"
        versions = []
        for i in range(count):
            version = f"202601020000{i:02d}"
            (migrations / f"{version}_big.sql").write_text("-" * size, encoding="utf-8")
            versions.append(version)
        return versions

    def test_a_batch_larger_than_one_request_is_split_and_all_of_it_is_sent(self) -> None:
        versions = self._batch(6, review.MAX_CHUNK_CHARS // 2)
        prompts: list[str] = []

        def call(prompt, api_key, model, max_tokens):
            prompts.append(prompt)
            return "Nothing.\nVERDICT: CLEAR"

        with patch.dict("os.environ", {"PRODUCTION_ALLOWLIST": ",".join(versions)}), \
                patch.object(review, "call_api", call):
            self.assertEqual(review.main(), 0)
        self.assertGreater(len(prompts), 1, "batch should have been chunked")
        joined = "".join(prompts)
        for version in versions:
            self.assertIn(f"{version}_big.sql", joined)

    def test_every_migration_appears_in_exactly_one_chunk(self) -> None:
        files, unsent = review.load_migrations(
            Path(self.temp.name), self._batch(7, review.MAX_CHUNK_CHARS // 3)
        )
        self.assertEqual(unsent, [])
        chunks = review.plan_chunks(files)
        self.assertGreater(len(chunks), 1)
        flat = [item[0] for chunk in chunks for item in chunk]
        self.assertEqual(flat, [f[0] for f in files])
        self.assertEqual(len(set(flat)), len(flat))

    def test_chunks_respect_the_size_target(self) -> None:
        files, _ = review.load_migrations(
            Path(self.temp.name), self._batch(5, review.MAX_CHUNK_CHARS // 2)
        )
        for chunk in review.plan_chunks(files):
            if len(chunk) > 1:
                self.assertLessEqual(
                    sum(len(item[2]) for item in chunk), review.MAX_CHUNK_CHARS
                )

    def test_one_concerns_chunk_makes_the_whole_batch_concerns(self) -> None:
        versions = self._batch(4, review.MAX_CHUNK_CHARS)
        state = {"n": 0}

        def call(prompt, api_key, model, max_tokens):
            state["n"] += 1
            if state["n"] == 2:
                return "Drops a column.\nVERDICT: CONCERNS"
            return "Nothing.\nVERDICT: CLEAR"

        with patch.dict("os.environ", {"PRODUCTION_ALLOWLIST": ",".join(versions)}), \
                patch.object(review, "call_api", call):
            self.assertEqual(review.main(), 0)
        text = self.summary_text()
        self.assertIn("RAISED CONCERNS", text)
        self.assertIn("Drops a column.", text)

    def test_a_failed_chunk_fails_the_whole_review(self) -> None:
        versions = self._batch(4, review.MAX_CHUNK_CHARS)
        state = {"n": 0}

        def call(prompt, api_key, model, max_tokens):
            state["n"] += 1
            if state["n"] > 1:
                raise OSError("connection reset")
            return "Nothing.\nVERDICT: CLEAR"

        with patch.dict("os.environ", {"PRODUCTION_ALLOWLIST": ",".join(versions)}), \
                patch.object(review, "call_api", call), \
                patch.object(review.time, "sleep", lambda _s: None):
            self.assertEqual(review.main(), 1)
        text = self.summary_text()
        self.assertIn("REVIEW DID NOT RUN", text)
        self.assertIn("part 2", text)
        # No partial CLEAR may survive as evidence.
        self.assertNotIn("VERDICT: CLEAR", text)

    def test_a_single_oversize_file_is_fatal_and_no_call_is_made(self) -> None:
        """A file too large to review must never produce a verdict."""
        versions = self._batch(1, review.MAX_FILE_CHARS + 1)
        called = []

        with patch.dict("os.environ", {"PRODUCTION_ALLOWLIST": ",".join(versions)}), \
                patch.object(review, "call_api", lambda *a, **k: called.append(1)):
            self.assertEqual(review.main(), 1)
        self.assertEqual(called, [])
        text = self.summary_text()
        self.assertIn("were NOT sent", text)
        self.assertIn(versions[0], text)
        self.assertNotIn("VERDICT: CLEAR", text)

    def test_a_missing_file_is_reported_as_unsent(self) -> None:
        files, unsent = review.load_migrations(Path(self.temp.name), ["20991231000000"])
        self.assertEqual(files, [])
        self.assertEqual(len(unsent), 1)
        self.assertIn("file not found", unsent[0])

    def test_a_batch_that_fits_is_still_one_request(self) -> None:
        """The chunker must not turn every batch into N calls."""
        prompts = []

        def call(prompt, api_key, model, max_tokens):
            prompts.append(prompt)
            return "Nothing.\nVERDICT: CLEAR"

        with patch.object(review, "call_api", call):
            self.assertEqual(review.main(), 0)
        self.assertEqual(len(prompts), 1)
        self.assertIn("create table public.thing();", prompts[0])


class TestVerdictStaysAdvisory(EnvSandbox):
    """A model may not block a production apply, nor have its concerns hidden."""

    def _clear(self, text):
        return lambda prompt, api_key, model, max_tokens: text

    def test_clear_verdict_passes(self) -> None:
        with patch.object(review, "call_api", self._clear("Nothing.\nVERDICT: CLEAR")):
            self.assertEqual(review.main(), 0)
        self.assertNotIn("RAISED CONCERNS", self.summary_text())

    def test_concerns_verdict_passes_but_shouts(self) -> None:
        with patch.object(
            review, "call_api", self._clear("Drops a column.\nVERDICT: CONCERNS")
        ):
            self.assertEqual(review.main(), 0)
        text = self.summary_text()
        self.assertIn("RAISED CONCERNS", text)
        self.assertIn("Drops a column.", text)

    def test_unreadable_verdict_is_treated_as_concerns(self) -> None:
        with patch.object(review, "call_api", self._clear("I have opinions.")):
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

    def test_combine_verdicts_only_clears_when_every_part_clears(self) -> None:
        self.assertEqual(review.combine_verdicts(["CLEAR", "CLEAR"]), "CLEAR")
        self.assertEqual(review.combine_verdicts(["CLEAR", "CONCERNS"]), "CONCERNS")
        self.assertEqual(review.combine_verdicts(["CLEAR", "UNREADABLE"]), "UNREADABLE")
        self.assertEqual(review.combine_verdicts([]), "UNREADABLE")

    def test_a_console_that_cannot_encode_the_verdict_does_not_lose_it(self) -> None:
        """A real run of this file died here: both B3 and B9 were reviewed and
        then the process crashed writing the answer to a cp1252 terminal."""

        class Cp1252Stdout:
            encoding = "cp1252"

            def __init__(self):
                self.written = []

            def write(self, text):
                text.encode("cp1252")  # raises on characters cp1252 lacks
                self.written.append(text)

            def flush(self):
                pass

        fake = Cp1252Stdout()
        with patch.object(
            review, "call_api", self._clear("Renames a → b.\nVERDICT: CLEAR")
        ), patch.object(review.sys, "stdout", fake):
            self.assertEqual(review.main(), 0)
        # The durable evidence keeps the real characters...
        artifact = Path(self.temp.name, "production-model-review.md").read_text(
            encoding="utf-8"
        )
        self.assertIn("→", artifact)
        self.assertIn("VERDICT: CLEAR", self.summary_text())
        # ...and the console got a degraded copy rather than an exception.
        self.assertTrue(any("VERDICT: CLEAR" in w for w in fake.written))

    def test_prompt_demands_a_machine_readable_verdict(self) -> None:
        self.assertIn("VERDICT: CLEAR", review.PROMPT)
        self.assertIn("VERDICT: CONCERNS", review.PROMPT)

    def test_prompt_tells_the_model_it_is_seeing_one_part(self) -> None:
        """A model that thinks it saw everything judges dependencies wrongly."""
        self.assertIn("PART {index} OF {total}", review.PROMPT)


class FakeResponse:
    def __init__(self, body):
        self._body = json.dumps(body).encode("utf-8")

    def read(self):
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class TestModelComesFromTheLiveListing(EnvSandbox):
    """WHAT THIS CAN AND CANNOT CATCH.

    CAN (offline, no network, no key): that no model id is hard-coded; that an
    explicit pin wins; that with no pin the id is taken from the newest member
    of the family in the live `/v1/models` listing; that the id reaches the
    request body; that a listing failure or an empty family is FATAL rather
    than a silent guess; and that an HTTP 404 names the model and calls it a
    configuration problem without retrying.

    CANNOT: that the live listing is reachable from the runner. Only a real run
    proves that -- which is why the failure path is loud and specific.
    """

    def test_no_model_id_is_hard_coded(self) -> None:
        source = Path(review.__file__).read_text(encoding="utf-8")
        code = "\n".join(
            line for line in source.splitlines() if not line.lstrip().startswith("#")
        )
        # Model ids look like `claude-<something>`; the only bare string allowed
        # is the family prefix used to filter the live listing.
        found = set(re.findall(r"[\"'](claude-[a-z0-9.\-]+)[\"']", code))
        self.assertEqual(found - {review.DEFAULT_MODEL_FAMILY}, set())

    def test_an_explicit_pin_wins_and_no_listing_is_fetched(self) -> None:
        def urlopen(request, timeout=None):
            raise AssertionError("the listing must not be queried when pinned")

        with patch.dict("os.environ", {review.MODEL_ENV_VAR: "claude-pinned"}), \
                patch.object(review.urllib.request, "urlopen", urlopen):
            self.assertEqual(review.resolve_model("key"), "claude-pinned")

    def test_unpinned_takes_the_newest_of_the_family_from_the_listing(self) -> None:
        listing = {
            "data": [
                {"id": "claude-opus-4-8", "created_at": "2026-05-28T00:00:00Z"},
                {"id": "claude-opus-9", "created_at": "2026-09-01T00:00:00Z"},
                {"id": "claude-sonnet-5", "created_at": "2026-12-01T00:00:00Z"},
            ]
        }
        with patch.dict("os.environ", {review.MODEL_ENV_VAR: ""}), patch.object(
            review.urllib.request, "urlopen", lambda r, timeout=None: FakeResponse(listing)
        ):
            # Newest *opus*, not newest overall.
            self.assertEqual(review.resolve_model("key"), "claude-opus-9")

    def test_the_family_is_configurable(self) -> None:
        listing = {"data": [{"id": "claude-sonnet-5", "created_at": "2026-06-01T00:00:00Z"}]}
        with patch.dict(
            "os.environ",
            {review.MODEL_ENV_VAR: "", review.MODEL_FAMILY_ENV_VAR: "claude-sonnet"},
        ), patch.object(
            review.urllib.request, "urlopen", lambda r, timeout=None: FakeResponse(listing)
        ):
            self.assertEqual(review.resolve_model("key"), "claude-sonnet-5")

    def test_an_unreachable_listing_is_fatal_not_a_guess(self) -> None:
        def boom(request, timeout=None):
            raise review.urllib.error.URLError("no route to host")

        with patch.dict("os.environ", {review.MODEL_ENV_VAR: ""}), patch.object(
            review.urllib.request, "urlopen", boom
        ):
            self.assertEqual(review.main(), 1)
        text = self.summary_text()
        self.assertIn("REVIEW DID NOT RUN", text)
        self.assertIn("model id could not be resolved", text)
        self.assertIn(review.MODEL_ENV_VAR, text)

    def test_a_listing_without_the_family_is_fatal_and_names_what_it_saw(self) -> None:
        listing = {"data": [{"id": "claude-haiku-9", "created_at": "2026-01-01T00:00:00Z"}]}
        with patch.dict("os.environ", {review.MODEL_ENV_VAR: ""}), patch.object(
            review.urllib.request, "urlopen", lambda r, timeout=None: FakeResponse(listing)
        ):
            self.assertEqual(review.main(), 1)
        text = self.summary_text()
        self.assertIn("claude-haiku-9", text)
        self.assertIn(review.DEFAULT_MODEL_FAMILY, text)

    def test_the_model_id_and_user_agent_reach_the_request(self) -> None:
        seen = {}

        def fake_urlopen(request, timeout=None):
            seen["body"] = json.loads(request.data.decode("utf-8"))
            seen["headers"] = dict(request.headers)
            return FakeResponse(fake_body("ok"))

        with patch.object(review.urllib.request, "urlopen", fake_urlopen):
            review.call_api("prompt", "key", "claude-configured-model", 16000)
        self.assertEqual(seen["body"]["model"], "claude-configured-model")
        self.assertEqual(seen["body"]["max_tokens"], 16000)
        # Issue #737 / #709: a UA-less urllib POST.
        self.assertIn("shared-db", seen["headers"]["User-agent"])

    def test_a_404_names_the_model_and_does_not_retry(self) -> None:
        calls = []

        def not_found(request, timeout=None):
            calls.append(1)
            raise review.urllib.error.HTTPError(review.API_URL, 404, "Not Found", {}, None)

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
        self.assertEqual(len(calls), 1)

    def test_http_errors_carry_the_response_body(self) -> None:
        """Issue #737, second half: `403 Forbidden` and nothing else cost a day."""

        class Body:
            def read(self):
                return b'{"error":{"message":"blocked at the edge"}}'

        exc = review.urllib.error.HTTPError(
            review.API_URL, 403, "Forbidden", {}, Body()
        )
        message = review.describe_http_error(exc, "claude-x")
        self.assertIn("403", message)
        self.assertIn("blocked at the edge", message)

    def test_an_unreadable_error_body_does_not_mask_the_error(self) -> None:
        class Angry:
            def read(self):
                raise OSError("socket already closed")

        exc = review.urllib.error.HTTPError(review.API_URL, 500, "Boom", {}, Angry())
        self.assertIn("unreadable", review.read_error_body(exc))

    def test_a_500_is_still_retried_as_transient(self) -> None:
        calls = []

        def boom(request, timeout=None):
            calls.append(1)
            raise review.urllib.error.HTTPError(review.API_URL, 500, "Server Error", {}, None)

        with patch.object(review.urllib.request, "urlopen", boom), patch.object(
            review.time, "sleep", lambda _s: None
        ):
            self.assertEqual(review.main(), 1)
        # Retried at every budget, because a 500 might be transient.
        self.assertEqual(len(calls), review.ATTEMPTS)

    def test_the_evidence_records_which_model_reviewed(self) -> None:
        with patch.dict(
            "os.environ", {review.MODEL_ENV_VAR: "claude-recorded-model"}
        ), patch.object(
            review, "call_api", lambda p, k, m, t: "Nothing.\nVERDICT: CLEAR"
        ):
            self.assertEqual(review.main(), 0)
        self.assertIn("claude-recorded-model", self.summary_text())


class TestWorkflowWiring(unittest.TestCase):
    """The script can only fail the job if the step is allowed to fail."""

    def workflow(self) -> str:
        return (
            Path(__file__).resolve().parents[1]
            / ".github"
            / "workflows"
            / "shared-supabase-migrations.yml"
        ).read_text(encoding="utf-8")

    def test_the_model_is_wired_as_configuration_not_code(self) -> None:
        workflow = self.workflow()
        self.assertIn("SHARED_DB_REVIEW_MODEL: ${{ vars.SHARED_DB_REVIEW_MODEL }}", workflow)
        # And the dead id never comes back.
        self.assertNotIn("claude-opus-4-5-20260514", workflow)

    def test_model_review_step_has_no_continue_on_error(self) -> None:
        workflow = self.workflow()
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
