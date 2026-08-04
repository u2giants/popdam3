#!/usr/bin/env python3
"""Validate a fail-closed production migration allowlist and dry run."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import subprocess
import sys

VERSION_RE = re.compile(r"^\d{14}$")
REMOTE_TABLE_RE = re.compile(r"^\s*(?:\d{14})?\s*\|\s*(\d{14})\s*\|")
MIGRATION_LINE_RE = re.compile(r"^\s*(?:[•*\-]\s*)?(\d{14})_[^\s]+\.sql\s*$")
# Versions the general production lane refuses outright.
#
# There are TWO opposite kinds of block here and they must never be confused.
# The rationale for the original blocks was once lost entirely and had to be
# recovered by archaeology (PR #407,
# docs/hard-blocked-migrations-dossier-20260802.md). One line of reason per
# entry, permanently, so that never happens again.
#
# UNBLOCKED 2026-08-04 by owner ruling (Albert Hazan), AGENTS.md section 6.8 --
# all four together, bundled with the negative test below and the whole-batch
# preflight closure check. NEVER unblock a HARD_BLOCKED ColdLion version on its
# own: a lone unblock hands a half-composable batch to a forward-only lane.
#   20260726030000  ColdLion phase 4, approved 542-link machinery.
#                   Blocked 2026-07-27 (PR #259) pending owner sign-off of the
#                   ColdLion cutover -- a process gate, never a defect.
#                   Unblocked 2026-08-04: the owner signed off (AGENTS 6.8).
#   20260726031000  Phase 4 empty-input guard correction. Same gate, meaningless
#                   without 20260726030000. Unblocked 2026-08-04 (AGENTS 6.8).
#   20260726032000  Phase 4 REVOKE of browser-role EXECUTE. A security
#                   improvement; blocked only because it is meaningless before
#                   20260726030000 exists. Unblocked 2026-08-04 (AGENTS 6.8).
#   20260726180000  ColdLion phase 6 parallel-run. Creates plm.taxonomy_sync_alert
#                   and plm.taxonomy_parallel_observation, which 20260727221500
#                   and 20260728134500 need at DDL time (42P01 otherwise). Same
#                   process gate. Unblocked 2026-08-04 (AGENTS 6.8).
#
# STILL BLOCKED, PERMANENTLY -- these two are a different animal. They are
# already applied to production and are listed to stop anyone re-running a known
# mistake. Do not "tidy" them out of this set.
#
# PROVENANCE OF "already applied", stated so nobody launders it into a fact I
# checked. The agent that unblocked the four (2026-08-04) was forbidden to read
# production and did NOT verify this itself. It rests on two independent
# production ledger reads recorded on 2026-08-02:
#   - docs/production-migration-lane-design-20260802.md section 3.2, whose
#     ledger query over all six versions returned only 20260724030000,
#     20260726190000 and 20260726200000; and
#   - docs/hard-blocked-migrations-dossier-20260802.md section 7, "20260726190000
#     and 20260726200000 are applied; the other four are not".
# Re-verify against the live production ledger before any promotion. If either
# ever turns out NOT to be applied, that changes the count in AGENTS.md 6.8 and
# this set must be revisited before anything is promoted.
HARD_BLOCKED = {
    # Master Data lockdown: restricted editing of public.style_tracker_rows to
    # admins. WRONG -- it locked all 33 plain 'user' accounts out of the Styles
    # grid, which is open BY DESIGN (AGENTS.md section 0.4). Applied to
    # production, then reversed by 20260726200000. Never re-apply.
    "20260726190000",
    # The reversal of 20260726190000. Already applied to production, so listing
    # it is inert; kept so the pair stays legible together.
    "20260726200000",
}

# The four unblocked above. This is ENFORCED, not documentary: `parse_allowlist`
# requires an allowlist to contain either ALL FOUR or NONE of them. AGENTS.md
# section 6.8 forbids unblocking them "one at a time, a few at a time, or just
# the safe ones -- there is no size of subset that makes it allowed", because a
# partial set hands a half-composable batch to a forward-only lane and leaves
# production PARTIALLY PROMOTED with no undo.
BUNDLE_20260804 = {
    "20260726030000",
    "20260726031000",
    "20260726032000",
    "20260726180000",
}


class GuardError(ValueError):
    pass


def parse_allowlist(raw: str) -> list[str]:
    values = [item.strip() for item in raw.split(",") if item.strip()]
    if not values:
        raise GuardError("production allowlist is empty")
    if any(not VERSION_RE.fullmatch(value) for value in values):
        raise GuardError("every entry must be an exact 14-digit version")
    if len(values) != len(set(values)):
        raise GuardError("production allowlist contains a duplicate")
    blocked = sorted(set(values) & HARD_BLOCKED)
    if blocked:
        raise GuardError(f"general production lane blocks: {', '.join(blocked)}")
    if values != sorted(values):
        raise GuardError("production allowlist must be in migration order")
    # AGENTS.md section 6.8: all four or none. Enforced here, in the one function
    # every entry point (`prepare`, `preflight`, `verify-dry-run`) must call, so
    # it cannot be bypassed by choosing a different subcommand.
    present = BUNDLE_20260804 & set(values)
    if present and present != BUNDLE_20260804:
        missing = sorted(BUNDLE_20260804 - present)
        raise GuardError(
            "AGENTS.md 6.8 forbids promoting the 2026-08-04 ColdLion bundle in "
            "parts: this allowlist has "
            f"{', '.join(sorted(present))} but is missing {', '.join(missing)}. "
            "Include all four (20260726030000, 20260726031000, 20260726032000, "
            "20260726180000) or none."
        )
    return values


def parse_remote_versions(path: Path) -> set[str]:
    raw = path.read_text(encoding="utf-8")
    try:
        value = json.loads(raw)
    except json.JSONDecodeError:
        versions = {
            match.group(1)
            for line in raw.splitlines()
            if (match := REMOTE_TABLE_RE.match(line))
        }
    else:
        versions: set[str] = set()

        def visit(item: object) -> None:
            if isinstance(item, dict):
                for key, child in item.items():
                    if key in {"version", "remote"} and isinstance(child, str):
                        if VERSION_RE.fullmatch(child):
                            versions.add(child)
                    visit(child)
            elif isinstance(item, list):
                for child in item:
                    visit(child)

        visit(value)
    if not versions:
        raise GuardError("production migration ledger contained no versions")
    return versions


def local_migrations(repo: Path) -> dict[str, Path]:
    migrations: dict[str, Path] = {}
    for path in sorted((repo / "supabase" / "migrations").glob("*.sql")):
        version = path.name[:14]
        if not VERSION_RE.fullmatch(version):
            raise GuardError(f"invalid migration filename: {path.name}")
        if version in migrations:
            raise GuardError(f"duplicate migration version: {version}")
        migrations[version] = path
    return migrations


def validate_candidates(
    migrations: dict[str, Path], allowlist: list[str], remote: set[str]
) -> None:
    unknown = [version for version in allowlist if version not in migrations]
    if unknown:
        raise GuardError(f"unknown migration version: {', '.join(unknown)}")
    applied = [version for version in allowlist if version in remote]
    if applied:
        raise GuardError(f"already applied on production: {', '.join(applied)}")


# ---------------------------------------------------------------------------
# Whole-batch preflight (AGENTS.md section 6.8 requirement 2)
#
# WHAT THIS IS, STATED HONESTLY UP FRONT. It is a whole-BATCH check rather than a
# per-file one: it walks the ordered batch and rejects it when a file would run
# before something it needs. It does NOT "prove the batch can run end to end" --
# no static scanner can, and an earlier version of this header claimed it could,
# which was wrong. It is a fast pre-filter that may REJECT but must never be read
# as APPROVAL. The authoritative gate is the rehearsal of the whole batch against
# a production-shaped scratch database (lane design section 2.3, Change C).
#
# Concretely it knows about the reference positions listed in REFERENCE_RES
# below. Positions it does NOT model -- most obviously anything reached only
# through dynamic `execute format(...)`, and any object whose creator is not a
# local migration file -- pass silently by design. A pass means "nothing known to
# be broken", never "safe".
#
# The failure it exists to catch is real and live: the 14-file ColdLion batch
# aborts at file 3
# (20260727221500) with SQLSTATE 42P01, because that file's
# `create table if not exists plm.taxonomy_circuit_breaker` carries
# `references plm.taxonomy_sync_alert(id)` and the referenced table is created
# by 20260726180000, which was excluded. `if not exists` does not save it: the
# create runs, and the foreign key is resolved immediately. 20260728134500 fails
# the same way on `create trigger ... on plm.taxonomy_sync_alert`.
#
# HONESTY ABOUT WHAT THIS IS. Per the lane design's revised Change C
# (docs/production-migration-lane-design-20260802.md section 2.3), a text scan is
# a fast pre-filter that may REJECT but must never be read as APPROVAL. The
# authoritative gate stays the full rehearsal against a production-shaped
# scratch database. This check therefore only fails when it has POSITIVE
# evidence: the referenced object is created by a local migration file that is
# neither already applied nor earlier in the batch. When no local creator is
# known it stays silent rather than guessing.
# ---------------------------------------------------------------------------

# The tag group must ALWAYS participate (hence `|` rather than `?`): an
# unmatched optional group makes the \1 backreference fail, which silently
# leaves every `$$ ... $$` body in the text and produces false rejections.
DOLLAR_QUOTE_RE = re.compile(r"\$([A-Za-z_]\w*|)\$.*?\$\1\$", re.DOTALL)
LINE_COMMENT_RE = re.compile(r"--[^\n]*")
BLOCK_COMMENT_RE = re.compile(r"/\*.*?\*/", re.DOTALL)

IDENT = r"([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)"

CREATE_RES = (
    re.compile(
        r"\bcreate\s+(?:unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?" + IDENT
    ),
    re.compile(
        r"\bcreate\s+(?:or\s+replace\s+)?(?:materialized\s+|recursive\s+)?view\s+"
        r"(?:if\s+not\s+exists\s+)?" + IDENT
    ),
    re.compile(
        r"\bcreate\s+(?:or\s+replace\s+)?(?:function|procedure)\s+" + IDENT
    ),
    re.compile(r"\bcreate\s+type\s+" + IDENT),
    re.compile(r"\bcreate\s+sequence\s+(?:if\s+not\s+exists\s+)?" + IDENT),
)

# Non-deferrable reference positions: Postgres resolves these at DDL time and
# cannot postpone them to first call.
REFERENCE_RES = (
    ("foreign key", re.compile(r"\breferences\s+" + IDENT)),
    (
        "trigger target",
        re.compile(
            r"\b(?:create|drop)\s+(?:or\s+replace\s+)?(?:constraint\s+)?trigger\b"
            r"[\s\S]{0,400}?\bon\s+" + IDENT
        ),
    ),
    (
        "alter table",
        re.compile(r"\balter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?" + IDENT),
    ),
    (
        # Both the named and the nameless `create index [name] on sch.tab` forms.
        "index target",
        re.compile(
            r"\bcreate\s+(?:unique\s+)?index\s+(?:concurrently\s+)?"
            r"(?:if\s+not\s+exists\s+)?(?:[^\s(]+\s+)?on\s+(?:only\s+)?" + IDENT
        ),
    ),
    (
        # GRANT/REVOKE resolve their target immediately. This is the
        # `20260729120000` trap recorded in AGENTS.md 10.2: it revokes EXECUTE on
        # public.sync_clickup_tasks(jsonb, text), created by the pending
        # 20260728174500, and aborts with undefined_function if promoted first.
        "grant/revoke target",
        re.compile(
            r"\b(?:grant|revoke)\b[\s\S]{0,300}?\bon\s+"
            r"(?:function|procedure|routine|table|sequence|view|type)\s+" + IDENT
        ),
    ),
    (
        "comment target",
        re.compile(r"\bcomment\s+on\s+[a-z ]+?\s+" + IDENT),
    ),
    (
        "policy target",
        re.compile(r"\bcreate\s+policy\b[\s\S]{0,200}?\bon\s+" + IDENT),
    ),
    (
        "partition parent",
        re.compile(r"\bpartition\s+of\s+" + IDENT),
    ),
    (
        # `default nextval('plm.s'::regclass)` and every other regclass literal.
        "regclass literal",
        re.compile(r"'" + IDENT + r"'\s*::\s*regclass"),
    ),
    (
        # A view body is resolved when the view is created, and a top-level
        # INSERT/UPDATE/SELECT is resolved when the migration runs. Function
        # bodies are already stripped, so what is left here is apply-time.
        "query target",
        re.compile(r"\b(?:from|join|into|update)\s+(?:only\s+)?" + IDENT),
    ),
    (
        # A function called inside a CHECK constraint or a GENERATED expression
        # is resolved at DDL time, not at first call.
        "check/generated expression",
        re.compile(
            r"\b(?:check|generated\s+always\s+as)\s*\([^;]{0,400}?\b"
            + IDENT
            + r"\s*\("
        ),
    ),
)


def strip_sql(raw: str) -> str:
    """Lowercase SQL with comments and dollar-quoted bodies removed.

    Function bodies are stripped on purpose: names inside them resolve at CALL
    time, not at apply time, so they are deferrable and must not be treated as
    batch-ordering dependencies.
    """
    text = DOLLAR_QUOTE_RE.sub(" ", raw)
    text = BLOCK_COMMENT_RE.sub(" ", text)
    text = LINE_COMMENT_RE.sub(" ", text)
    return text.lower()


def created_objects(raw: str) -> set[str]:
    text = strip_sql(raw)
    found: set[str] = set()
    for pattern in CREATE_RES:
        for match in pattern.finditer(text):
            found.add(f"{match.group(1)}.{match.group(2)}")
    return found


def hard_references(raw: str) -> list[tuple[str, str]]:
    text = strip_sql(raw)
    found: list[tuple[str, str]] = []
    seen: set[tuple[str, str]] = set()
    for reason, pattern in REFERENCE_RES:
        for match in pattern.finditer(text):
            key = (f"{match.group(1)}.{match.group(2)}", reason)
            if key not in seen:
                seen.add(key)
                found.append(key)
    return found


def preflight_batch(
    migrations: dict[str, Path], allowlist: list[str], remote: set[str]
) -> None:
    """Reject a batch that cannot run end to end. Never an approval."""
    creators: dict[str, list[str]] = {}
    for version, path in migrations.items():
        for obj in created_objects(path.read_text(encoding="utf-8")):
            creators.setdefault(obj, []).append(version)

    available: set[str] = set()
    for version in sorted(remote):
        path = migrations.get(version)
        if path is not None:
            available |= created_objects(path.read_text(encoding="utf-8"))

    problems: list[str] = []
    for version in allowlist:
        path = migrations[version]
        raw = path.read_text(encoding="utf-8")
        available |= created_objects(raw)
        for obj, reason in hard_references(raw):
            if obj in available:
                continue
            known = sorted(creators.get(obj, []))
            if not known:
                # No local file creates it -- it predates the tracked history or
                # is not ours. Stay silent: this check may reject, never approve.
                continue
            problems.append(
                f"{version} references missing {obj} ({reason}); "
                f"created by {', '.join(known)} which is not applied and not "
                f"earlier in the batch -- would abort the batch "
                f"(42P01 undefined_table / 42883 undefined_function)"
            )
    if problems:
        raise GuardError(
            "whole-batch preflight failed; the batch cannot run end to end:\n  "
            + "\n  ".join(problems)
        )


def preflight(repo: Path, raw_allowlist: str, ledger: Path) -> None:
    allowlist = parse_allowlist(raw_allowlist)
    remote = parse_remote_versions(ledger)
    migrations = local_migrations(repo)
    validate_candidates(migrations, allowlist, remote)
    preflight_batch(migrations, allowlist, remote)
    print(
        f"PREFLIGHT OK: {len(allowlist)} migrations, no missing non-deferrable "
        "dependency. This is a pre-filter, NOT an approval -- the rehearsal "
        "against a production-shaped database remains the authoritative gate."
    )


def prepare(repo: Path, output: Path, commit_sha: str, raw_allowlist: str, ledger: Path) -> None:
    allowlist = parse_allowlist(raw_allowlist)
    remote = parse_remote_versions(ledger)
    migrations = local_migrations(repo)
    validate_candidates(migrations, allowlist, remote)
    # AGENTS.md section 6.8: the whole batch must be proven runnable end to end
    # before anything is applied, never one migration at a time.
    preflight_batch(migrations, allowlist, remote)
    if output.exists():
        raise GuardError(f"bounded checkout already exists: {output}")
    subprocess.run(
        ["git", "worktree", "add", "--detach", str(output), commit_sha],
        cwd=repo,
        check=True,
    )
    keep = remote | set(allowlist)
    for version, path in local_migrations(output).items():
        if version not in keep:
            path.unlink()
    remaining = set(local_migrations(output))
    expected = set(migrations) & keep
    if remaining != expected:
        raise GuardError("bounded checkout does not match the approved file set")


def verify_dry_run(path: Path, raw_allowlist: str) -> None:
    allowlist = parse_allowlist(raw_allowlist)
    raw = path.read_text(encoding="utf-8")
    marker = "Would push these migrations:"
    if marker not in raw:
        raise GuardError("dry run did not contain the expected migration list")
    actual = [
        match.group(1)
        for line in raw.split(marker, 1)[1].splitlines()
        if (match := MIGRATION_LINE_RE.match(line))
    ]
    if actual != allowlist:
        raise GuardError(
            f"dry run did not exactly match: expected {allowlist}, got {actual}"
        )


def main() -> int:
    parser = argparse.ArgumentParser()
    subs = parser.add_subparsers(dest="command", required=True)
    prep = subs.add_parser("prepare")
    prep.add_argument("--repo", type=Path, required=True)
    prep.add_argument("--output", type=Path, required=True)
    prep.add_argument("--commit-sha", required=True)
    prep.add_argument("--allowlist", required=True)
    prep.add_argument("--remote-ledger", type=Path, required=True)
    pre = subs.add_parser("preflight")
    pre.add_argument("--repo", type=Path, required=True)
    pre.add_argument("--allowlist", required=True)
    pre.add_argument("--remote-ledger", type=Path, required=True)
    verify = subs.add_parser("verify-dry-run")
    verify.add_argument("--dry-run-output", type=Path, required=True)
    verify.add_argument("--allowlist", required=True)
    args = parser.parse_args()
    try:
        if args.command == "prepare":
            prepare(
                args.repo.resolve(),
                args.output.resolve(),
                args.commit_sha,
                args.allowlist,
                args.remote_ledger,
            )
        elif args.command == "preflight":
            preflight(args.repo.resolve(), args.allowlist, args.remote_ledger)
        else:
            verify_dry_run(args.dry_run_output, args.allowlist)
    except (GuardError, OSError, subprocess.CalledProcessError) as exc:
        print(f"BLOCKED: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
