#!/usr/bin/env python3
"""Post an ADVISORY model verdict on a proposed production apply.

****** THIS IS NEVER A GATE. ******

Read this before changing anything here. The value of this script is entirely in
what it writes for a human to read, and it has exactly zero authority:

  * It always exits 0. A model saying "APPROVE" does not approve anything, and a
    model saying "REJECT" does not block anything. The blocking checks are the
    deterministic ones in `production_migration_guard.py`, and the gate that
    actually holds is Albert clicking approve on the `production` environment.
  * If `ANTHROPIC_API_KEY` is absent, or the API errors, or the network is down,
    it says so plainly in the summary and still exits 0. A missing model review
    must never be able to *stop* an approved production change, and it must never
    be able to *hide* that it did not run.

The one thing it must not do is produce a verdict that looks authoritative. Every
line it writes is labelled advisory, on purpose.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
import sys
import urllib.error
import urllib.request

MODEL = "claude-opus-4-5-20260514"
API_URL = "https://api.anthropic.com/v1/messages"

BANNER = (
    "> **ADVISORY ONLY.** This verdict does not gate anything. The blocking "
    "checks are `production_migration_guard.py`; the approval gate is the "
    "`production` environment reviewer.\n\n"
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

{sql}
"""

MAX_SQL_CHARS = 400_000


def collect_sql(repo: Path, versions: list[str]) -> str:
    chunks: list[str] = []
    total = 0
    for version in versions:
        matches = sorted((repo / "supabase" / "migrations").glob(f"{version}_*.sql"))
        if not matches:
            chunks.append(f"\n===== {version} — FILE NOT FOUND =====\n")
            continue
        body = matches[0].read_text(encoding="utf-8", errors="replace")
        if total + len(body) > MAX_SQL_CHARS:
            chunks.append(
                f"\n===== {matches[0].name} — TRUNCATED, batch exceeds "
                f"{MAX_SQL_CHARS} characters =====\n"
            )
            break
        total += len(body)
        chunks.append(f"\n===== {matches[0].name} =====\n{body}")
    return "".join(chunks)


def ask_model(prompt: str, api_key: str) -> str:
    payload = json.dumps(
        {
            "model": MODEL,
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
    with urllib.request.urlopen(request, timeout=300) as response:
        body = json.loads(response.read().decode("utf-8"))
    return "".join(
        block.get("text", "")
        for block in body.get("content", [])
        if block.get("type") == "text"
    ).strip()


def publish(text: str) -> None:
    out = BANNER + text + "\n"
    print(out)
    temp = os.environ.get("RUNNER_TEMP")
    if temp:
        Path(temp, "production-model-review.md").write_text(out, encoding="utf-8")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write("## Automatic model review (advisory)\n\n" + out)


def main() -> int:
    versions = [
        value.strip()
        for value in os.environ.get("PRODUCTION_ALLOWLIST", "").split(",")
        if value.strip()
    ]
    sha = os.environ.get("REQUESTED_SHA", "(unknown)")
    api_key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    if not versions:
        publish("**NOT RUN** — the allowlist was empty.")
        return 0
    if not api_key:
        publish(
            "**NOT RUN** — `ANTHROPIC_API_KEY` is not configured on this "
            "repository, so no model review was performed. This is stated "
            "explicitly rather than silently skipped: approve on the strength "
            "of the deterministic guard output and your own reading, not on the "
            "absence of a complaint here."
        )
        return 0
    repo = Path(os.environ.get("GITHUB_WORKSPACE", ".")).resolve()
    prompt = PROMPT.format(
        sha=sha,
        count=len(versions),
        versions="\n".join(f"- {version}" for version in versions),
        sql=collect_sql(repo, versions),
    )
    try:
        publish(ask_model(prompt, api_key))
    except (urllib.error.URLError, OSError, ValueError, KeyError) as exc:
        publish(
            f"**NOT RUN** — the model review failed: `{type(exc).__name__}: "
            f"{exc}`. It is advisory, so this does not block the run, but no "
            "technical opinion was produced. Do not read its absence as approval."
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
