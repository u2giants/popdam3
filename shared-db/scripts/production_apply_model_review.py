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
     empty model response, or a batch too large to send in full now EXIT
     NON-ZERO with a message naming the cause.
     The `production-apply-review` job goes red, and because `production-apply`
     `needs:` it, the approval gate is never even offered.

     There is deliberately NO environment-variable escape hatch. If the review
     cannot run, fix the review (add the secret) -- do not add a bypass, or you
     have rebuilt the hole this script was changed to close.
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

# The model id used for the review. NOTHING here should be hard-coded that an
# operator may need to change without a code change (Albert's standing rule
# calls out AI model choices by name), so this is read from the environment with
# a working default. `DEFAULT_MODEL` is the documented constant the tests pin.
#
# It is also the exact value that broke this lane once already: the file used to
# pin `claude-opus-4-5-20260514`, which is not a real model id, so every
# production apply review died with a bare `HTTP Error 404` that read like a
# network blip. See `describe_http_error` below -- a 404 from the messages
# endpoint now names the model it asked for and says the id is wrong.
#
# The default is the newest, most capable Opus id that the live `/v1/models`
# listing returns (verified against the API on 2026-08-11: `claude-opus-5` is
# the newest; `claude-opus-4-5-20251101` is the previous generation). When a
# newer generation ships, bump this constant -- or set SHARED_DB_REVIEW_MODEL
# without touching code.
DEFAULT_MODEL = "claude-opus-5"
MODEL_ENV_VAR = "SHARED_DB_REVIEW_MODEL"
API_URL = "https://api.anthropic.com/v1/messages"

ATTEMPTS = 3
BACKOFF_SECONDS = (5, 15)

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
Allowlist ({count} migrations, in order):
{versions}

Migration SQL follows. For each file, judge:
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

MAX_SQL_CHARS = 400_000

VERDICT_RE = re.compile(r"^VERDICT:\s*(CLEAR|CONCERNS)\s*$", re.MULTILINE)


class ReviewNotPerformed(Exception):
    """The review did not happen. This is fatal; it is never advisory."""


def collect_sql(repo: Path, versions: list[str]) -> tuple[str, list[str]]:
    """Return (payload, unsent) where `unsent` names every version the model
    will NOT see.

    The caller MUST treat a non-empty `unsent` as fatal. This used to `break`
    silently at MAX_SQL_CHARS: everything after the cut vanished from the
    prompt, and the model -- which has no way to know a file was withheld --
    could still answer VERDICT: CLEAR. That is a clean pass on SQL nobody
    reviewed, i.e. the exact defect this script was rewritten to remove, and it
    is not hypothetical: single migrations in this repo are already 161KB,
    136KB and 123KB, so one batch of landing files crosses the cap on its own.
    """
    chunks: list[str] = []
    unsent: list[str] = []
    total = 0
    for version in versions:
        matches = sorted((repo / "supabase" / "migrations").glob(f"{version}_*.sql"))
        if not matches:
            # Cannot happen after `production_migration_guard.py preflight`,
            # which runs earlier in this job and requires every allowlisted file
            # to exist. Fatal here anyway: a review of a file that was never read
            # is not a review.
            unsent.append(f"{version} (file not found)")
            continue
        body = matches[0].read_text(encoding="utf-8", errors="replace")
        if total + len(body) > MAX_SQL_CHARS:
            unsent.append(f"{version} ({matches[0].name}, {len(body)} chars)")
            continue
        total += len(body)
        chunks.append(f"\n===== {matches[0].name} =====\n{body}")
    return "".join(chunks), unsent


def resolve_model() -> str:
    """The model id to review with: `SHARED_DB_REVIEW_MODEL`, else the default.

    Read at CALL time, not import time, so the workflow (or an operator running
    this locally) can change the model without editing this file, and so tests
    can exercise both paths.
    """
    return os.environ.get(MODEL_ENV_VAR, "").strip() or DEFAULT_MODEL


def describe_http_error(exc: urllib.error.HTTPError, model: str) -> str:
    """Turn an HTTP failure into a message an operator can act on.

    A wrong model id surfaces from this endpoint as a bare `HTTP Error 404`,
    which reads like the network is down when in fact the configuration is
    wrong. That mislabelling cost a day: the id `claude-opus-4-5-20260514` was
    pinned in this file, did not exist, and the lane just said 404. So a 404 is
    reported as what it is -- an unknown or unavailable model -- and it names
    the id that was asked for and where that id came from.
    """
    source = (
        f"the {MODEL_ENV_VAR} environment variable"
        if os.environ.get(MODEL_ENV_VAR, "").strip()
        else f"the built-in default (DEFAULT_MODEL in {Path(__file__).name})"
    )
    if exc.code == 404:
        return (
            f"the Anthropic API returned HTTP 404 for model id {model!r}: that "
            "model does not exist or is not available to this API key. This is "
            "a CONFIGURATION problem, not a network problem. The id came from "
            f"{source}. Fix the id (or set {MODEL_ENV_VAR} to a model this key "
            "can use) and dispatch again."
        )
    return f"the Anthropic API returned HTTP {exc.code} for model id {model!r}: {exc.reason}"


def call_api(prompt: str, api_key: str) -> str:
    model = resolve_model()
    payload = json.dumps(
        {
            "model": model,
            "max_tokens": 4000,
            "messages": [{"role": "user", "content": prompt}],
        }
    ).encode("utf-8")
    request = urllib.request.Request(
        API_URL,
        data=payload,
        headers={
            "content-type": "application/json",
            "anthropic-version": "2023-06-01",
            "x-api-key": api_key,
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=300) as response:
            body = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        # A 4xx is a configuration error: retrying it three times only delays a
        # failure that will never fix itself. Raise ReviewNotPerformed, which
        # `ask_model` does not catch, so it goes straight to `fail()` with a
        # message that names the model id.
        if 400 <= exc.code < 500:
            raise ReviewNotPerformed(describe_http_error(exc, model)) from exc
        raise
    return "".join(
        block.get("text", "")
        for block in body.get("content", [])
        if block.get("type") == "text"
    ).strip()


def ask_model(prompt: str, api_key: str, sleep=time.sleep) -> str:
    """Call the API, retrying transient failures, then give up LOUDLY.

    A flaky network must not block a production apply on the first hiccup, but
    it must not be papered over either: after ATTEMPTS tries this raises, and
    the caller turns that into a red job.
    """
    last: Exception | None = None
    for attempt in range(ATTEMPTS):
        try:
            text = (call_api(prompt, api_key) or "").strip()
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
            continue
        if not text:
            last = ValueError("the model returned an empty response")
            if attempt + 1 < ATTEMPTS:
                sleep(BACKOFF_SECONDS[min(attempt, len(BACKOFF_SECONDS) - 1)])
            continue
        return text
    raise ReviewNotPerformed(
        f"the model review could not be completed after {ATTEMPTS} attempts: "
        f"{type(last).__name__}: {last}"
    )


def read_verdict(text: str) -> str:
    """CLEAR, CONCERNS, or UNREADABLE. An unreadable verdict is NOT clear."""
    found = VERDICT_RE.findall(text)
    if not found:
        return "UNREADABLE"
    return found[-1]


def annotate(level: str, message: str) -> None:
    """Emit a GitHub Actions annotation (harmless plain text off-runner)."""
    print(f"::{level}::{message}")


def publish(text: str, heading: str = "Automatic model review") -> None:
    # Name the model in the evidence. Which model produced a verdict is part of
    # the verdict; it also makes a wrong/changed id visible in the artifact
    # rather than only in a stack trace.
    out = BANNER + text + f"\n\n_Model: `{resolve_model()}`_\n"
    print(out)
    temp = os.environ.get("RUNNER_TEMP")
    if temp:
        Path(temp, "production-model-review.md").write_text(out, encoding="utf-8")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write(f"## {heading}\n\n" + out)


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
    print(f"MODEL REVIEW NOT PERFORMED: {reason}", file=sys.stderr)
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
    sql, unsent = collect_sql(repo, versions)
    # A PARTIAL REVIEW IS NOT A REVIEW. Refuse BEFORE spending the API call: if
    # any migration could not be put in front of the model, no verdict it
    # returns -- CLEAR included -- describes this batch. Fail here rather than
    # let a clean-looking answer be produced about SQL that was never sent.
    if unsent:
        return fail(
            "the batch does not fit in one review, so the model would not have "
            "seen all of it. These migrations were NOT sent: "
            + "; ".join(unsent)
            + f". The payload cap is {MAX_SQL_CHARS} characters. A verdict on a "
            "partial batch is worthless, so no verdict was requested. Split the "
            "allowlist into smaller batches and dispatch them one at a time."
        )
    prompt = PROMPT.format(
        sha=sha,
        count=len(versions),
        versions="\n".join(f"- {version}" for version in versions),
        sql=sql,
    )
    try:
        text = ask_model(prompt, api_key)
    except ReviewNotPerformed as exc:
        return fail(str(exc))

    verdict = read_verdict(text)
    if verdict == "CLEAR":
        publish(text, heading="Automatic model review (advisory) — CLEAR")
        return 0

    # CONCERNS, or a verdict line we could not read. Both are surfaced loudly and
    # neither is blocking: a model may not stop a production apply any more than
    # it may wave one through. An unreadable verdict is treated as CONCERNS
    # because "we could not tell" must never round down to "fine".
    note = (
        ""
        if verdict == "CONCERNS"
        else (
            "\n\n_(The model did not end with a readable `VERDICT:` line, so "
            "this is treated as CONCERNS. Read the text above yourself.)_"
        )
    )
    publish(
        "### :warning: MODEL REVIEW RAISED CONCERNS — READ BEFORE APPROVING\n\n"
        + text
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
