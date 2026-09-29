"""Bounded GitHub primary-rate-limit wait (issue #3735), shared by the
business-risk gate's gh_json (which keeps its own transport retries) and the
historical preview recovery proof, both through wait_for_reset_once.

A primary quota exhaustion ("API rate limit exceeded", HTTP 403/429) is waited
out ONCE, only when the reset read from the free `rate_limit` endpoint is within
the caller's budget (capped at 15 minutes). Everything else fails closed.
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
import time


RATE_LIMIT_WAIT_CAP_SECONDS = 15 * 60


def rate_limit_exhausted(error: str) -> bool:
    """A PRIMARY quota exhaustion: "rate limit exceeded" with HTTP 403 or 429.

    A secondary (abuse) limit, "Resource not accessible", or any other 403 is not
    this, and is never waited on.
    """
    lowered = error.lower()
    return "rate limit exceeded" in lowered and "secondary rate limit" not in lowered and bool(
        re.search(r"http (?:403|429)\b", lowered)
    )


def rate_limit_reset_seconds(runner, now: float) -> float | None:
    """Seconds until the REST quota resets, from the free `rate_limit` endpoint.

    None when the answer cannot be read: an unknown reset is never guessed.
    """
    probe = runner(
        ["gh", "api", "rate_limit"], text=True,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, encoding="utf-8",
    )
    if probe.returncode != 0:
        return None
    try:
        core = json.loads(probe.stdout)["resources"]["core"]
        remaining, reset = core["remaining"], core["reset"]
    except (json.JSONDecodeError, KeyError, TypeError):
        return None
    if not isinstance(remaining, int) or not isinstance(reset, (int, float)):
        return None
    return 0.0 if remaining > 0 else max(0.0, reset - now)


def wait_for_reset_once(error: str, *, runner, sleep, clock, budget: float) -> bool:
    """The ONE wait both readers use. True when `error` is a primary exhaustion
    whose readable reset is within `budget` (itself capped at 15 minutes) and
    the reset has been slept out; the sleep never exceeds the budget."""
    budget = max(0.0, min(float(budget or 0), RATE_LIMIT_WAIT_CAP_SECONDS))
    if budget <= 0 or not rate_limit_exhausted(error):
        return False
    delay = rate_limit_reset_seconds(runner, clock())
    if delay is None or delay > budget:
        return False
    seconds = min(delay + 1, budget)
    print(f"GitHub API quota exhausted; waiting {seconds:.0f}s for its reset, then re-reading once.", file=sys.stderr)
    sleep(seconds)
    return True


def gh_api_json_waiting_for_reset(
    endpoint: str, *, runner=subprocess.run, sleep=time.sleep, clock=time.time,
    rate_limit_wait_seconds: float = 0,
):
    """One `gh api` read. Returns the parsed JSON; raises ValueError on failure.
    The wait is opt-in, as in the gate: the default 0 never waits."""
    waited = False
    while True:
        result = runner(
            ["gh", "api", endpoint], text=True,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, encoding="utf-8",
        )
        if result.returncode == 0:
            try:
                return json.loads(result.stdout)
            except json.JSONDecodeError as exc:
                raise ValueError("GitHub returned invalid JSON") from exc
        error = (result.stderr or "GitHub API request failed").strip()
        if not waited and wait_for_reset_once(
            error, runner=runner, sleep=sleep, clock=clock, budget=rate_limit_wait_seconds,
        ):
            waited = True
            continue
        raise ValueError(f"GitHub API request failed: {error}")
