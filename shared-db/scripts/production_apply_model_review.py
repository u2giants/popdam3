#!/usr/bin/env python3
"""Run a model review of a proposed production apply, and prove that it ran.

Two different things live in this script, and keeping them apart is the whole
design. Read this before changing anything here.

  1. THE REVIEW'S VERDICT IS ADVISORY. A model saying "APPROVE" approves
     nothing; a model saying "REJECT" blocks nothing. The blocking checks are
     the deterministic ones in `production_migration_guard.py`, and the gate
     that actually holds is Albert clicking approve on the `production`
     environment. Never make the verdict itself fail the run: that would create
     a lane where a model can wave a production write through (or hold one
     hostage). A verdict of "concerns found" is therefore reported LOUDLY --
     a `::warning::` annotation and a CONCERNS banner at the top of the job
     summary -- but it is not swallowed and it is not blocking.

  2. THE REVIEW ACTUALLY HAPPENING IS MANDATORY. This is the part that changed
     (issue: "silent no-op on every production apply"). Previously this script
     always exited 0 and the workflow step carried `continue-on-error: true`,
     so a missing `ANTHROPIC_API_KEY` -- which is exactly the state this
     repository was in -- produced a fully GREEN production-apply-review job
     that had reviewed nothing. A green tick that stands in for evidence it
     never gathered is a silent failure, and silent failures are banned.

     So: missing API key, empty allowlist, API/network error after retries, an
     unreadable model response, or a migration too large to send in full now
     EXIT NON-ZERO with a message naming the cause.
     The `production-apply-review` job goes red, and because `production-apply`
     `needs:` it, the approval gate is never even offered.

     There is deliberately NO environment-variable escape hatch. If the review
     cannot run, fix the review (add the secret) -- do not add a bypass, or you
     have rebuilt the hole this script was changed to close.

  3. THE BATCH IS REVIEWED IN CHUNKS, AND EVERY CHUNK IS SENT. Batch B3 is
     336 KB of SQL and B9 is 534 KB. One prompt per batch does not work, and
     the second one does not even fit: the old 400,000-character single-payload
     cap would have refused B9 outright, and B9 is atomic -- it cannot be split
     into smaller allowlists. So the batch is packed into ordered chunks that
     each fit comfortably in one request, every chunk is reviewed, and the
     verdicts are combined: CLEAR only if EVERY chunk came back CLEAR. Nothing
     is ever silently dropped -- a file that cannot be sent is fatal, exactly as
     before.
"""

from __future__ import annotations

import http.client
import json
import os
from pathlib import Path
import re
import sys
import time
import urllib.error
import urllib.request

# ---------------------------------------------------------------------------
# Model selection
# ---------------------------------------------------------------------------
# NOTHING here is a hard-coded model id. That is not a style preference: this
# lane has already been broken once by a pinned id (`claude-opus-4-5-20260514`)
# that did not exist, and every production apply review died with a bare
# `HTTP Error 404` that read like a network blip (PR #783; issue #785 tracks
# that no offline check can prove a pinned id is real).
#
# So the id comes from the live provider listing, `GET /v1/models`, which is the
# only source that knows what this API key can actually call. An operator may
# still pin one explicitly with SHARED_DB_REVIEW_MODEL; with that unset we take
# the newest model whose id starts with MODEL_FAMILY (default `claude-opus`).
# If the listing cannot be fetched, or contains no member of the family, the
# review FAILS with a message naming what was asked for and what came back --
# it never silently falls back to a guess.
MODEL_ENV_VAR = "SHARED_DB_REVIEW_MODEL"
MODEL_FAMILY_ENV_VAR = "SHARED_DB_REVIEW_MODEL_FAMILY"
DEFAULT_MODEL_FAMILY = "claude-opus"

API_URL = "https://api.anthropic.com/v1/messages"
MODELS_URL = "https://api.anthropic.com/v1/models?limit=100"
API_VERSION = "2023-06-01"

# Every outbound request identifies itself. A UA-less `urllib` POST is what
# caused issue #709 and is re-reported for this file as issue #737.
USER_AGENT = "u2giants-shared-db-production-apply-model-review/2 (+https://github.com/u2giants/shared-db)"

ATTEMPTS = 3
BACKOFF_SECONDS = (5, 15)

# `max_tokens` is a ceiling on THINKING PLUS TEXT, not on the answer alone.
# That is the whole bug this file was rewritten for: the request asked for
# 4000, the model spent all 4000 on thinking, the response came back as a
# single `thinking` block with `stop_reason: "max_tokens"` and NO text block at
# all, and the text extraction below produced "". Six attempts across two runs
# behaved identically, because it was never flaky -- it was arithmetic.
#
# The budgets are tried in order for a given chunk: if the first one is
# exhausted before any text is produced, the chunk is retried with the second.
# Escalating rather than starting high keeps the normal case cheap.
TOKEN_BUDGETS = (16_000, 32_000)

# One migration larger than this cannot be reviewed at all, so it is fatal
# rather than truncated. The largest file in the repo today is 161 KB.
MAX_FILE_CHARS = 300_000
# Target size of one review request's SQL payload. B3 (336 KB) becomes 3
# chunks; B9 (534 KB) becomes 5. Files are never split across chunks.
MAX_CHUNK_CHARS = 120_000

REQUEST_TIMEOUT_SECONDS = 900

BANNER = (
    "> **ADVISORY VERDICT.** The verdict below does not gate anything. The "
    "blocking checks are `production_migration_guard.py`; the approval gate is "
    "the `production` environment reviewer. What IS enforced is that this "
    "review ran at all -- if it could not run, this job is red and you are not "
    "reading this.\n\n"
)

PROMPT = """You are reviewing a proposed bounded production database migration \
apply for the shared Supabase project `qsllyeztdwjgirsysgai`.

Commit SHA: {sha}
Allowlist ({count} migrations, applied in this order):
{versions}

This batch is too large for one review, so it has been split into {total} \
parts and you are reviewing PART {index} OF {total}. The SQL below is the \
complete, untruncated text of these migrations and only these:
{chunk_versions}

The other migrations in the allowlist are being reviewed in their own parts. \
Judge the files in front of you; when something depends on an object created \
by an earlier migration you cannot see, say so as an assumption rather than \
reporting it as a missing dependency.

For each file, judge:
1. Is it additive, or does it drop/rename/alter something other apps may read?
2. Does it grant or leave in place a privilege that should be revoked?
3. Does it depend on an object that no earlier file in this batch creates?
4. Is there anything in it that cannot be undone by a forward-only lane?

Answer with a short technical verdict: a one-line summary, then the specific \
concerns, then a bullet list of anything the human approver should check before \
approving. Be concrete. If you see nothing concerning, say so plainly rather \
than inventing risk.

Your LAST line must be exactly one of these two, on its own line, with nothing \
after it:
VERDICT: CLEAR
VERDICT: CONCERNS

Use CONCERNS if there is anything at all the human approver should look at \
before approving. Use CLEAR only if you found nothing.

{sql}
"""

VERDICT_RE = re.compile(r"^VERDICT:\s*(CLEAR|CONCERNS)\s*$", re.MULTILINE)

# Cached so `publish()` can name the model in the evidence without re-querying
# the provider (and without pretending to know it before it was resolved).
_RESOLVED_MODEL: str | None = None


class ReviewNotPerformed(Exception):
    """The review did not happen. This is fatal; it is never advisory."""


class EmptyModelResponse(Exception):
    """The API answered, but no reviewable text came back.

    Carries WHY. "the model returned an empty response" was the entire
    diagnostic the lane produced for batch B3, and it cost a full cycle to work
    out that the response was a `thinking` block truncated at `max_tokens`. The
    message now always names the stop reason, the block types that were
    actually received, and the sizes involved.
    """

    def __init__(
        self,
        stop_reason: str | None,
        block_types: list[str],
        prompt_chars: int,
        max_tokens: int,
        usage: dict,
    ) -> None:
        self.stop_reason = stop_reason
        self.block_types = block_types
        self.max_tokens = max_tokens
        blocks = ", ".join(block_types) if block_types else "(none)"
        out = usage.get("output_tokens")
        details = usage.get("output_tokens_details") or {}
        thinking = details.get("thinking_tokens")
        super().__init__(
            "the API responded but no text block was returned: "
            f"stop_reason={stop_reason!r}, content block types received=[{blocks}], "
            f"prompt was {prompt_chars} characters, max_tokens was {max_tokens}, "
            f"output_tokens={out} (thinking_tokens={thinking}). "
            + (
                "The token budget was exhausted before any answer text was "
                "emitted -- the whole budget went to thinking. Raise "
                "TOKEN_BUDGETS or lower MAX_CHUNK_CHARS."
                if stop_reason == "max_tokens"
                else "This is not a truncation; the model produced no text."
            )
        )


def _request(url: str, api_key: str, data: bytes | None = None) -> dict:
    headers = {
        "anthropic-version": API_VERSION,
        "x-api-key": api_key,
        "user-agent": USER_AGENT,
    }
    if data is not None:
        headers["content-type"] = "application/json"
    request = urllib.request.Request(url, data=data, headers=headers)
    with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
        return json.loads(response.read().decode("utf-8"))


def list_models(api_key: str) -> list[dict]:
    """The provider's own list of models this key may call."""
    body = _request(MODELS_URL, api_key)
    return list(body.get("data") or [])


def resolve_model(api_key: str) -> str:
    """The model id to review with. Explicit pin, else newest of the family.

    Never returns a guess: if the listing cannot be read, or has no member of
    the requested family, this raises and the job goes red with a message that
    names the family it looked for and the ids it actually saw.
    """
    global _RESOLVED_MODEL
    pinned = os.environ.get(MODEL_ENV_VAR, "").strip()
    if pinned:
        _RESOLVED_MODEL = pinned
        return pinned
    family = os.environ.get(MODEL_FAMILY_ENV_VAR, "").strip() or DEFAULT_MODEL_FAMILY
    try:
        models = list_models(api_key)
    except urllib.error.HTTPError as exc:
        raise ReviewNotPerformed(
            f"the model id could not be resolved: GET {MODELS_URL} returned HTTP "
            f"{exc.code} ({exc.reason}); response body: {read_error_body(exc)}. "
            "The review takes its model id from the "
            "live provider listing rather than a hard-coded string, so this is "
            f"fatal. Pin one with {MODEL_ENV_VAR} to proceed without the listing."
        ) from exc
    except (urllib.error.URLError, OSError, ValueError) as exc:
        raise ReviewNotPerformed(
            f"the model id could not be resolved: GET {MODELS_URL} failed with "
            f"{type(exc).__name__}: {exc}. Pin one with {MODEL_ENV_VAR} to "
            "proceed without the listing."
        ) from exc
    matches = [m for m in models if str(m.get("id", "")).startswith(family)]
    if not matches:
        seen = ", ".join(sorted(str(m.get("id")) for m in models)) or "(nothing)"
        raise ReviewNotPerformed(
            f"the model id could not be resolved: the live provider listing has "
            f"no model whose id starts with {family!r}. The listing returned: "
            f"{seen}. Set {MODEL_FAMILY_ENV_VAR} to a family this key can use, "
            f"or {MODEL_ENV_VAR} to an exact id."
        )
    matches.sort(key=lambda m: (str(m.get("created_at") or ""), str(m.get("id"))))
    _RESOLVED_MODEL = str(matches[-1]["id"])
    return _RESOLVED_MODEL


def model_for_evidence() -> str:
    return _RESOLVED_MODEL or "(not resolved)"


def load_migrations(repo: Path, versions: list[str]) -> tuple[list[tuple[str, str, str]], list[str]]:
    """Return (files, unsent). `files` is [(version, filename, sql)] in order.

    The caller MUST treat a non-empty `unsent` as fatal. A review of a file that
    was never read is not a review, and a model that is not told a file was
    withheld can still answer VERDICT: CLEAR about it.
    """
    files: list[tuple[str, str, str]] = []
    unsent: list[str] = []
    for version in versions:
        matches = sorted((repo / "supabase" / "migrations").glob(f"{version}_*.sql"))
        if not matches:
            # Cannot happen after `production_migration_guard.py preflight`,
            # which runs earlier in this job and requires every allowlisted file
            # to exist. Fatal here anyway.
            unsent.append(f"{version} (file not found)")
            continue
        body = matches[0].read_text(encoding="utf-8", errors="replace")
        if len(body) > MAX_FILE_CHARS:
            unsent.append(
                f"{version} ({matches[0].name}, {len(body)} chars, over the "
                f"{MAX_FILE_CHARS}-character single-file limit)"
            )
            continue
        files.append((version, matches[0].name, body))
    return files, unsent


def plan_chunks(files: list[tuple[str, str, str]]) -> list[list[tuple[str, str, str]]]:
    """Pack the batch into ordered chunks, never splitting a single migration.

    Order is preserved so each chunk's SQL still reads in apply order, which is
    what makes the dependency question (#3 in the prompt) answerable at all.
    """
    chunks: list[list[tuple[str, str, str]]] = []
    current: list[tuple[str, str, str]] = []
    total = 0
    for item in files:
        size = len(item[2])
        if current and total + size > MAX_CHUNK_CHARS:
            chunks.append(current)
            current = []
            total = 0
        current.append(item)
        total += size
    if current:
        chunks.append(current)
    return chunks


def read_error_body(exc: urllib.error.HTTPError) -> str:
    """Best-effort decode of an HTTPError body; never raises.

    Second half of issue #737: `production_catalog_verification.py` printed only
    `str(exc)` and never read the body, so a Cloudflare 403 said "403 Forbidden"
    and nothing else -- which is why #709 took a day to find. Mirrors the
    reference implementation merged in PR #715.
    """
    try:
        raw = exc.read()
    except Exception as read_exc:  # noqa: BLE001 -- must not mask the real error
        return f"<response body unreadable: {read_exc!r}>"
    if not raw:
        return "<empty response body>"
    try:
        return raw.decode("utf-8", errors="replace")[:2000]
    except Exception as decode_exc:  # noqa: BLE001
        return f"<response body undecodable: {decode_exc!r}>"


def describe_http_error(exc: urllib.error.HTTPError, model: str) -> str:
    """Turn an HTTP failure into a message an operator can act on.

    A wrong model id surfaces from this endpoint as a bare `HTTP Error 404`,
    which reads like the network is down when in fact the configuration is
    wrong. That mislabelling cost a day, so a 404 is reported as what it is --
    an unknown or unavailable model -- naming the id and where it came from.
    """
    source = (
        f"the {MODEL_ENV_VAR} environment variable"
        if os.environ.get(MODEL_ENV_VAR, "").strip()
        else "the live provider listing (GET /v1/models), newest of family "
        + (os.environ.get(MODEL_FAMILY_ENV_VAR, "").strip() or DEFAULT_MODEL_FAMILY)
    )
    body = read_error_body(exc)
    if exc.code == 404:
        return (
            f"the Anthropic API returned HTTP 404 for model id {model!r} "
            f"(response body: {body}): that "
            "model does not exist or is not available to this API key. This is "
            "a CONFIGURATION problem, not a network problem. The id came from "
            f"{source}. Fix the id (or set {MODEL_ENV_VAR} to a model this key "
            "can use) and dispatch again."
        )
    return (
        f"the Anthropic API returned HTTP {exc.code} for model id {model!r}: "
        f"{exc.reason}. Response body: {body}"
    )


def call_api(prompt: str, api_key: str, model: str, max_tokens: int) -> str:
    payload = json.dumps(
        {
            "model": model,
            "max_tokens": max_tokens,
            "messages": [{"role": "user", "content": prompt}],
        }
    ).encode("utf-8")
    try:
        body = _request(API_URL, api_key, data=payload)
    except urllib.error.HTTPError as exc:
        # A 4xx is a configuration error: retrying it three times only delays a
        # failure that will never fix itself. Raise ReviewNotPerformed, which
        # `ask_model` does not catch, so it goes straight to `fail()` with a
        # message that names the model id.
        if 400 <= exc.code < 500:
            raise ReviewNotPerformed(describe_http_error(exc, model)) from exc
        raise
    blocks = body.get("content") or []
    text = "".join(
        block.get("text", "") for block in blocks if block.get("type") == "text"
    ).strip()
    if not text:
        raise EmptyModelResponse(
            stop_reason=body.get("stop_reason"),
            block_types=[str(b.get("type")) for b in blocks],
            prompt_chars=len(prompt),
            max_tokens=max_tokens,
            usage=body.get("usage") or {},
        )
    return text


def ask_model(prompt: str, api_key: str, model: str, sleep=None) -> str:
    """Call the API, escalating the token budget and retrying transient errors.

    A flaky network must not block a production apply on the first hiccup, but
    it must not be papered over either: after every budget and every attempt
    this raises, and the caller turns that into a red job.

    The budget escalation is not a retry for flakiness -- an empty response
    caused by `stop_reason: "max_tokens"` is deterministic, so retrying at the
    SAME budget would fail identically six times, which is exactly what runs
    31540518181 and 31540953908 did.
    """
    # Resolved at CALL time, not bound as a default: a default argument would
    # capture `time.sleep` at import and quietly ignore any later patch, which
    # is how the offline test suite ended up really sleeping 65 seconds.
    if sleep is None:
        sleep = time.sleep
    last: Exception | None = None
    for budget_index, max_tokens in enumerate(TOKEN_BUDGETS):
        for attempt in range(ATTEMPTS):
            try:
                return call_api(prompt, api_key, model, max_tokens)
            except EmptyModelResponse as exc:
                last = exc
                if exc.stop_reason == "max_tokens":
                    break  # deterministic: escalate the budget, do not retry
                if attempt + 1 < ATTEMPTS:
                    sleep(BACKOFF_SECONDS[min(attempt, len(BACKOFF_SECONDS) - 1)])
            except (
                urllib.error.URLError,
                http.client.HTTPException,
                OSError,
                ValueError,
                KeyError,
            ) as exc:
                last = exc
                if attempt + 1 < ATTEMPTS:
                    sleep(BACKOFF_SECONDS[min(attempt, len(BACKOFF_SECONDS) - 1)])
        if budget_index + 1 < len(TOKEN_BUDGETS) and isinstance(last, EmptyModelResponse):
            continue
        if not isinstance(last, EmptyModelResponse):
            break
    raise ReviewNotPerformed(
        f"the model review could not be completed after {ATTEMPTS} attempts at "
        f"each of the token budgets {list(TOKEN_BUDGETS)}: "
        f"{type(last).__name__}: {last}"
    )


def read_verdict(text: str) -> str:
    """CLEAR, CONCERNS, or UNREADABLE. An unreadable verdict is NOT clear."""
    found = VERDICT_RE.findall(text)
    if not found:
        return "UNREADABLE"
    return found[-1]


def combine_verdicts(verdicts: list[str]) -> str:
    """CLEAR only if every part is CLEAR. Anything else wins."""
    if not verdicts:
        return "UNREADABLE"
    if "CONCERNS" in verdicts:
        return "CONCERNS"
    if "UNREADABLE" in verdicts:
        return "UNREADABLE"
    return "CLEAR"


def safe_print(text: str) -> None:
    """Print text that the console may not be able to encode.

    Never raises: a review that ran must not be destroyed by the encoding of
    the terminal it is being echoed to.
    """
    stream = sys.stdout
    encoding = getattr(stream, "encoding", None) or "utf-8"
    try:
        stream.write(text + "\n")
    except UnicodeEncodeError:
        stream.write(text.encode(encoding, errors="replace").decode(encoding) + "\n")
    stream.flush()


def annotate(level: str, message: str) -> None:
    """Emit a GitHub Actions annotation (harmless plain text off-runner)."""
    safe_print(f"::{level}::{message}")


def publish(text: str, heading: str = "Automatic model review") -> None:
    # Name the model in the evidence. Which model produced a verdict is part of
    # the verdict; it also makes a wrong/changed id visible in the artifact
    # rather than only in a stack trace.
    out = BANNER + text + f"\n\n_Model: `{model_for_evidence()}`_\n"
    # DURABLE EVIDENCE FIRST, console second. A model verdict routinely contains
    # characters (arrows, dashes, box drawing) that a non-UTF-8 console cannot
    # encode; on a cp1252 terminal `print(out)` raises UnicodeEncodeError. That
    # happened on a real run of this file: both B3 and B9 were reviewed
    # successfully and then the process died writing the answer to the screen,
    # losing a completed review. Writing the artifact and the job summary before
    # printing -- and never letting a console encoding kill the process --
    # means a review that HAPPENED can no longer be thrown away by its own
    # output stream.
    temp = os.environ.get("RUNNER_TEMP")
    if temp:
        Path(temp, "production-model-review.md").write_text(out, encoding="utf-8")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write(f"## {heading}\n\n" + out)
    safe_print(out)


def fail(reason: str) -> int:
    """Record why no review exists, then fail the job."""
    body = (
        "**REVIEW DID NOT RUN — THIS JOB IS FAILING ON PURPOSE.**\n\n"
        f"Cause: {reason}\n\n"
        "This production apply has NOT been model-reviewed. The lane refuses to "
        "present a green pre-approval job for a review that never happened. Fix "
        "the cause above and dispatch again; do not add a bypass."
    )
    publish(body, heading="Automatic model review — FAILED TO RUN")
    annotate("error", f"Production apply model review did not run: {reason}")
    sys.stderr.write(f"MODEL REVIEW NOT PERFORMED: {reason}\n")
    return 1


def main() -> int:
    versions = [
        value.strip()
        for value in os.environ.get("PRODUCTION_ALLOWLIST", "").split(",")
        if value.strip()
    ]
    sha = os.environ.get("REQUESTED_SHA", "(unknown)")
    api_key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    if not versions:
        return fail(
            "the allowlist was empty, so there was nothing to review. A "
            "production apply with an empty allowlist is itself a bug."
        )
    if not api_key:
        return fail(
            "`ANTHROPIC_API_KEY` is not configured on this repository, so no "
            "model review could be performed. Add the secret "
            "(Settings -> Secrets and variables -> Actions) and re-dispatch."
        )
    repo = Path(os.environ.get("GITHUB_WORKSPACE", ".")).resolve()
    files, unsent = load_migrations(repo, versions)
    # A PARTIAL REVIEW IS NOT A REVIEW. Refuse BEFORE spending any API call: if
    # any migration could not be put in front of the model, no verdict it
    # returns -- CLEAR included -- describes this batch.
    if unsent:
        return fail(
            "some migrations could not be reviewed, so the model would not have "
            "seen the whole batch. These were NOT sent: "
            + "; ".join(unsent)
            + ". A verdict on a partial batch is worthless, so no verdict was "
            "requested. A missing file is a preflight bug; an oversize file "
            f"must be split (the single-file limit is {MAX_FILE_CHARS} characters)."
        )

    try:
        model = resolve_model(api_key)
    except ReviewNotPerformed as exc:
        return fail(str(exc))

    chunks = plan_chunks(files)
    total = len(chunks)
    version_list = "\n".join(f"- {version}" for version in versions)
    sections: list[str] = []
    verdicts: list[str] = []
    for index, chunk in enumerate(chunks, start=1):
        sql = "".join(f"\n===== {name} =====\n{body}" for _v, name, body in chunk)
        prompt = PROMPT.format(
            sha=sha,
            count=len(versions),
            versions=version_list,
            total=total,
            index=index,
            chunk_versions="\n".join(f"- {name}" for _v, name, _b in chunk),
            sql=sql,
        )
        try:
            text = ask_model(prompt, api_key, model)
        except ReviewNotPerformed as exc:
            return fail(
                f"part {index} of {total} could not be reviewed "
                f"({len(chunk)} migrations, {len(sql)} characters of SQL): {exc}"
            )
        verdict = read_verdict(text)
        verdicts.append(verdict)
        header = (
            f"### Part {index} of {total} — {verdict}\n\n"
            + "".join(f"- `{name}`\n" for _v, name, _b in chunk)
            + "\n"
        )
        sections.append(header + text)

    combined = "\n\n---\n\n".join(sections)
    verdict = combine_verdicts(verdicts)
    if verdict == "CLEAR":
        publish(
            f"All {total} parts of this batch were reviewed and every part came "
            "back CLEAR.\n\n" + combined,
            heading="Automatic model review (advisory) — CLEAR",
        )
        return 0

    # CONCERNS, or a verdict line we could not read. Both are surfaced loudly and
    # neither is blocking: a model may not stop a production apply any more than
    # it may wave one through. An unreadable verdict is treated as CONCERNS
    # because "we could not tell" must never round down to "fine".
    note = (
        ""
        if verdict == "CONCERNS"
        else (
            "\n\n_(At least one part did not end with a readable `VERDICT:` "
            "line, so this is treated as CONCERNS. Read the text above "
            "yourself.)_"
        )
    )
    publish(
        "### :warning: MODEL REVIEW RAISED CONCERNS — READ BEFORE APPROVING\n\n"
        f"Part verdicts: {', '.join(verdicts)}\n\n"
        + combined
        + note,
        heading="Automatic model review (advisory) — CONCERNS",
    )
    annotate(
        "warning",
        "Production apply model review raised CONCERNS (advisory, not blocking) "
        "— read the job summary before approving.",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
