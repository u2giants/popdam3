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
    # A THIRD KIND. Read this before assuming it matches either pair above.
    #
    # NEVER APPLIED, and must NEVER be applied: promoting it would REGRESS a
    # security control that is live on production right now. It rewrites
    # public.lock_down_new_public_function_execute back to a narrower body
    # (`command_tag = 'CREATE FUNCTION'`, `revoke execute on function`) than the
    # one production runs today (`command_tag in ('CREATE FUNCTION',
    # 'CREATE PROCEDURE')`, `revoke execute on routine`), so newly created public
    # PROCEDURES would stop being locked down. Its `create or replace` and
    # `drop event trigger`/`create event trigger` overwrite unconditionally, and
    # it sorts BELOW the already-applied 20260729180000, which will therefore
    # never re-run to repair the damage.
    #
    # Its whole end state is already on production, from two migrations that ARE
    # in the ledger: 20260729130000 (the identical `alter default privileges`)
    # and 20260729180000 (the live event-trigger body, md5 735985606362e032...
    # matched bit-exactly after CRLF normalisation).
    #
    # Do NOT reach for the old argument that it would abort anyway on a missing
    # public/pim.sync_clickup_tasks. That is true only for a lone promotion. In
    # the full 50-file backlog 20260728174500 creates those functions FIRST, so
    # the file would succeed and regress production silently.
    # Evidence: docs/verification/production-apply-set-and-rehearsal-20260809.md
    "20260729120000",
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

# AGENTS.md section 6.5 -- OWNER RULING (Albert Hazan, 2026-08-03), "hold it and
# ship it together with the removal work".
#
# NEITHER of these two may reach production by ANY route until the `FR`
# "FRIENDS TV" REMOVAL work is ready to ship with them, as ONE bounded apply in
# dependency order. Not alone, not as a pair, not inside a wider backlog sweep,
# not via `--include-all`, not re-issued under a fresh timestamp.
#
# WHY the block is here and not in HARD_BLOCKED. HARD_BLOCKED means "never, by
# any route, full stop". Section 6.5 is NOT that: it names a legal future event.
# Putting these in HARD_BLOCKED would force a GUARD EDIT to perform a promotion
# the owner has already authorised -- the wrong shape, and the kind of edit that
# gets made carelessly under deadline. So this is a CO-PRESENCE rule instead,
# the same shape as the 6.8 all-four-or-none rule above: the two held versions
# are legal in an allowlist if and only if the whole FR ship set is in it too.
#
# Unblocking is therefore a DATA change, not a policy change: when the removal
# migrations exist, list their versions in FR_REMOVAL_VERSIONS below and the
# combined promotion parses. Until then FR_REMOVAL_VERSIONS is empty, so any
# allowlist containing either held version is refused -- which is exactly right,
# because the one legal event cannot yet be assembled.
FR_HELD_20260803 = {
    # plm.import_master_data preserves curated licensor/property status.
    "20260802170000",
    # The FRIENDS TV / FRIDA KAHLO ruling. Sets core.licensor `FR` to
    # status = 'inactive' -- a remedy the REMOVAL ruling supersedes. Promoting
    # it alone leaves production at rest in `inactive`, the state the owner
    # rejected, with no undo.
    "20260802171000",
}

# The `FR` removal migrations. EMPTY ON PURPOSE -- as of 2026-08-09 no removal
# migration exists anywhere in supabase/migrations/. Add the version strings
# here in the same change that adds the files. Do NOT add a placeholder, and do
# NOT delete the co-presence check to "unblock" a promotion.
FR_REMOVAL_VERSIONS: set[str] = set()


# ---------------------------------------------------------------------------
# SECURITY CO-PRESENCE RULES (added 2026-08-10, issue #660)
#
# Each entry is: "if the CREATE migration is in the allowlist, the FIX migration
# must be too". Between the create and its fix, production sits in a state the
# owner would not accept, so the two must land in one bounded apply.
#
# ****** THE RULE IS ONE-DIRECTIONAL, AND THAT IS DELIBERATE. ******
#
# Read this before you "make it symmetric for consistency". It is the single
# most important property of this block.
#
# `validate_candidates()` REFUSES any allowlist containing a version that is
# already applied on production. So consider the exact scenario these rules
# exist for: a bounded apply dies after the CREATE migration has landed and
# before the FIX migration runs. Production is now in the insecure state. The
# only legal recovery allowlist is the FIX ALONE -- the create cannot be
# re-listed, because it is applied.
#
# A symmetric rule ("the fix requires the create") would REFUSE that recovery.
# The operator's only way out would be to EDIT THIS SAFETY GUARD, under
# time pressure, while production sits exposed. That is precisely the shape of
# change that gets made carelessly, and it is why AGENTS.md 6.5 was written as a
# co-presence rule rather than a HARD_BLOCKED entry in the first place.
#
# So: `20260810090000` ALONE is legal. `20260810080000` ALONE is legal.
# `20260810110000` + `20260810120000` without `20260810030000` is legal.
# There are explicit tests for each of those recovery cases; if you change this
# structure and they still pass, you have broken the tests, not proved the change.
#
# NOT LISTED HERE, ON PURPOSE: `20260810110000` also alters `api.dam_order_list`,
# which `20260810010000` creates. That is a DEPENDENCY, not a policy, and it is
# already enforced by `preflight_batch` -- which reads the real production ledger
# and therefore stays silent when `20260810010000` is already applied. Encoding
# it here would be ledger-blind and would break exactly the recovery case above.
# Dependencies belong in the preflight; policy belongs here.
CO_PRESENCE_RULES: tuple[tuple[str, frozenset[str], str], ...] = (
    (
        # Paramount
        "20260810020000",
        frozenset({"20260810090000"}),
        "20260810020000 creates the Paramount Creative Library landing schema and "
        "leaves `service_role` holding TRUNCATE on 23 tables. TRUNCATE does not "
        "fire the row-level triggers those tables rely on, so between these two "
        "migrations production is one statement away from silently bypassing "
        "every one of them. 20260810090000 is the loader target guard and the "
        "TRUNCATE revoke.",
    ),
    (
        # NBCU
        "20260810070000",
        frozenset({"20260810080000"}),
        "20260810070000 creates the NBCU creative-asset landing schema with "
        "default-granted write privileges still in place. 20260810080000 revokes "
        "them. Promoting the create without the revoke leaves production writable "
        "by roles that must not write there.",
    ),
    (
        # Warner
        "20260810030000",
        frozenset({"20260810110000", "20260810120000"}),
        "20260810030000 creates the Warner STARLABS landing schema before its "
        "grants, RLS and read-claim corrections exist. 20260810110000 applies the "
        "grants/RLS (and makes api.dam_order_list security-invoker); "
        "20260810120000 corrects the read claim and revokes the service_role "
        "INSERT. All three land together or not at all.",
    ),
)


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
    # AGENTS.md section 6.5: the two held versions ship WITH the FR removal work
    # or not at all. Enforced in the same single choke point as 6.8, so no
    # subcommand can route around it.
    held = FR_HELD_20260803 & set(values)
    if held:
        required = FR_HELD_20260803 | FR_REMOVAL_VERSIONS
        missing = sorted(required - set(values))
        if not FR_REMOVAL_VERSIONS:
            raise GuardError(
                "AGENTS.md 6.5 (OWNER RULING, 2026-08-03) holds "
                f"{', '.join(sorted(held))}: neither 20260802170000 nor "
                "20260802171000 may reach production by any route until the FR "
                "'FRIENDS TV' removal work ships with them, as ONE bounded "
                "apply in dependency order. No FR removal migration exists yet, "
                "so that combined change cannot be assembled and this allowlist "
                "is refused. Drop both versions from the allowlist. Do NOT edit "
                "this guard to unblock them -- author the removal migrations "
                "and register their versions in FR_REMOVAL_VERSIONS."
            )
        if missing:
            raise GuardError(
                "AGENTS.md 6.5 (OWNER RULING, 2026-08-03) forbids promoting the "
                "FR ship set in parts: this allowlist has "
                f"{', '.join(sorted(held & set(values)))} but is missing "
                f"{', '.join(missing)}. The permitted event is exactly one -- a "
                "single bounded apply carrying 20260802170000, 20260802171000 "
                "and the FR removal migrations together, in dependency order. "
                "Include the full set or none of it."
            )
    # Security co-presence (issue #660). ONE-DIRECTIONAL by design -- see the
    # long comment on CO_PRESENCE_RULES. Never add the reverse implication.
    chosen = set(values)
    for create, fixes, why in CO_PRESENCE_RULES:
        if create not in chosen:
            continue
        missing = sorted(fixes - chosen)
        if missing:
            raise GuardError(
                f"co-presence rule: {create} may not be promoted without "
                f"{', '.join(missing)}. {why} Add the missing version(s) to the "
                "allowlist. (This rule is one-directional on purpose: promoting "
                f"{', '.join(sorted(fixes))} WITHOUT {create} is allowed, because "
                "that is the only legal way to recover a run that died between "
                "them.)"
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

# DELIBERATELY REMOVED: DOLLAR_QUOTE_RE, LINE_COMMENT_RE, BLOCK_COMMENT_RE.
# They were the three-pass stripper that `strip_sql` replaced, and they are gone
# rather than left unused on purpose -- a dead regex named DOLLAR_QUOTE_RE is an
# invitation to reintroduce the exact defect (see the `strip_sql` docstring).

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


DOLLAR_OPEN_RE = re.compile(r"\$([A-Za-z_]\w*)?\$")

# A literal is KEPT only when it is immediately cast to `regclass` -- that is the
# one position where the text inside a literal is a real, apply-time resolved
# object reference (`default nextval('plm.s'::regclass)`). Every other literal is
# blanked; see `strip_sql`.
REGCLASS_AHEAD_RE = re.compile(r"\s*::\s*regclass\b", re.IGNORECASE)

# The archaic, pre-dollar-quote function body: `... as 'select 1';`. Postgres
# still accepts it, and this lexer CANNOT see inside it (the body is a string
# literal, and blanking it is exactly what makes prose safe). Rather than leave a
# silent blind spot, `assert_no_archaic_function_body` REFUSES any migration that
# uses the form. A repo sweep on 2026-08-10 found exactly one, 20260729120000
# (`language sql security definer as 'select 1';`), which is RETIRED and
# permanently HARD_BLOCKED -- so no promotable file is affected today.
ARCHAIC_BODY_AS_RE = re.compile(r"\bas\s+'")
CREATE_ROUTINE_RE = re.compile(
    r"\b(?:create|alter)\s+(?:or\s+replace\s+)?(?:function|procedure)\b"
)


def assert_no_archaic_function_body(version: str, raw: str) -> None:
    """Refuse a migration whose function body is an old-style string literal.

    `strip_sql` blanks single-quoted literals so English prose inside a
    `comment on ... is '...'` stops being parsed as SQL. That is correct, but it
    means a routine body written as `as 'select 1'` becomes invisible to the
    preflight scanner. Invisible is the one outcome this lane must never have:
    the whole point of the check is that a REJECT is trustworthy and a PASS is
    merely "nothing known to be broken". A body we cannot read is neither.

    So this turns the residual blind spot into a LOUD REFUSAL. If a future
    migration legitimately needs this form, rewrite it with dollar quoting --
    do not delete this check.
    """
    # keep_dollar=True as well: the one real instance in this repo
    # (20260729120000) writes `as 'select 1'` INSIDE a `do $$ ... $$` block, so a
    # scan that stripped dollar bodies would have found nothing and reported a
    # clean sweep. Comments are still stripped, so prose cannot trip this.
    text = strip_sql(raw, keep_literals=True, keep_dollar=True)
    for match in ARCHAIC_BODY_AS_RE.finditer(text):
        # Only inside a CREATE/ALTER FUNCTION|PROCEDURE statement: take the text
        # back to the previous statement terminator and look for the header.
        statement = text[: match.start()].rsplit(";", 1)[-1]
        if CREATE_ROUTINE_RE.search(statement):
            raise GuardError(
                f"{version} defines a routine with an archaic single-quoted body "
                f"(`as '...'`). The preflight scanner blanks string literals, so "
                f"it cannot read that body and cannot judge what the migration "
                f"depends on. Rewrite the body with dollar quoting ($$ ... $$) "
                f"before promoting it. Do not delete this check to get past it."
            )


def strip_sql(
    raw: str, keep_literals: bool = False, keep_dollar: bool = False
) -> str:
    """Lowercase SQL with comments and dollar-quoted bodies removed.

    Function bodies are stripped on purpose: names inside them resolve at CALL
    time, not at apply time, so they are deferrable and must not be treated as
    batch-ordering dependencies.

    THIS IS A SINGLE LEFT-TO-RIGHT LEXER, AND IT MUST STAY ONE. The previous
    implementation ran three independent regex passes -- dollar bodies first,
    then block comments, then line comments. That is wrong, and it silently
    destroyed real DDL in 8 of the 411 migrations in this repo:

        -- `create index if not exists`, `create or replace function`, guarded
        -- `do $$` block)          <-- a $$ inside a COMMENT

    Postgres never sees that `$$`, but a dollar-first regex pass does. It became
    the OPENING half of a pair, matched the next genuine `$$` hundreds of lines
    later, and deleted every statement in between. For
    20260728174500 that meant `created_objects` returned an EMPTY SET for a file
    that creates `pim.sync_clickup_tasks`, `public.sync_clickup_tasks` and
    `api.clickup_task_sync_run_list` -- so `preflight_batch` reported the file as
    depending on a function that the very same file creates, and refused a batch
    that is in fact correctly ordered. The same defect hid all 17 objects created
    by 20260727154500, which is ALREADY APPLIED, so it also corrupted the
    `available` set that every later file is judged against.

    A false REJECT is the safe direction, but it is still a fault: it blocks
    `prepare`, so the production lane could not be exercised at all.

    Lexing order below is Postgres's own: at any point the next token decides.

    SINGLE-QUOTED LITERALS ARE BLANKED (fixed 2026-08-10). They used to be kept,
    and that was the SAME CLASS OF DEFECT as the `$$`-inside-a-comment bug above:
    ordinary English prose inside a `comment on ... is '...'` literal was parsed
    as SQL. The live example is 20260807170000, whose documentation reads

        'character can appear in multiple properties. Distinct from
         core.style_guide_character, '

    -- and `from core.style_guide_character` matched the "query target" pattern,
    so `preflight_batch` reported the file as depending on a table created by an
    unapplied migration and REFUSED it. A repo-wide sweep found 30 such phantom
    references across 23 migration files.

    It fires hardest on exactly the allowlists this lane is built for: a large
    batch usually contains the phantom's real creator anyway, so nobody notices,
    while a SMALL BOUNDED allowlist -- bounded promotion, the whole point -- gets
    rejected. False rejects are the safe direction, but a lane that cannot run is
    still a broken lane.

    THE ONE EXCEPTION, and why it is narrow: `'plm.seq'::regclass` really is an
    apply-time object reference. So a literal is kept only when the very next
    non-space tokens are `::regclass`. Nothing else about a literal's contents is
    a dependency -- text inside `execute format(...)` resolves at CALL time and
    was never modelled (see the module header's honesty note).

    `keep_literals=True` returns the pre-blanking text. It exists ONLY for
    `assert_no_archaic_function_body`, which must see the `as '...'` form that
    blanking would otherwise hide.
    """
    out: list[str] = []
    i, n = 0, len(raw)
    while i < n:
        ch = raw[i]
        if raw.startswith("--", i):
            end = raw.find("\n", i)
            i = n if end == -1 else end
            out.append(" ")
        elif raw.startswith("/*", i):
            # Postgres block comments nest.
            depth, i = 1, i + 2
            while i < n and depth:
                if raw.startswith("/*", i):
                    depth, i = depth + 1, i + 2
                elif raw.startswith("*/", i):
                    depth, i = depth - 1, i + 2
                else:
                    i += 1
            out.append(" ")
        elif ch == "'" or (
            ch in "eE" and raw.startswith("'", i + 1)
        ):
            # `E'...'` uses BACKSLASH escapes, so `E'it\'s'` does not end at the
            # second quote. A plain `'...'` string does not honour backslashes;
            # only `''` ends it. Getting this wrong mis-terminates the literal
            # and desynchronises everything after it. (Kimi K3, 2026-08-09.)
            escaped = ch in "eE"
            start = i
            j = i + (2 if escaped else 1)
            while j < n:
                if escaped and raw[j] == "\\" and j + 1 < n:
                    j += 2
                    continue
                if raw[j] == "'":
                    if j + 1 < n and raw[j + 1] == "'":
                        j += 2
                        continue
                    j += 1
                    break
                j += 1
            if keep_literals or REGCLASS_AHEAD_RE.match(raw, j):
                out.append(raw[start:j])
            else:
                # Blank the body but keep the quotes, so an adjacent token cannot
                # be glued to its neighbour (`is'x'from` must not become `isfrom`).
                out.append("''")
            i = j
        elif ch == '"':
            # A double-quoted identifier is opaque: `"weird--name"` contains no
            # comment and `"a$$b"` opens no dollar quote.
            j = i + 1
            while j < n:
                if raw[j] == '"':
                    if j + 1 < n and raw[j + 1] == '"':
                        j += 2
                        continue
                    j += 1
                    break
                j += 1
            out.append(raw[i:j])
            i = j
        elif ch == "$" and (m := DOLLAR_OPEN_RE.match(raw, i)):
            close = raw.find(m.group(0), m.end())
            if close == -1:
                # Unterminated: not a dollar quote at all (e.g. `$1`-adjacent
                # text). Emit the character and carry on rather than eating the
                # rest of the file.
                out.append(ch)
                i += 1
            elif keep_dollar:
                out.append(raw[i : close + len(m.group(0))])
                i = close + len(m.group(0))
            else:
                out.append(" ")
                i = close + len(m.group(0))
        else:
            out.append(ch)
            i += 1
    return "".join(out).lower()


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
        # Refuse a body this scanner cannot read, rather than passing it
        # silently. Collected rather than raised so a file with BOTH an archaic
        # body and a real missing dependency reports both at once.
        try:
            assert_no_archaic_function_body(version, raw)
        except GuardError as exc:
            problems.append(str(exc))
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


def assert_bounded(directory: Path, raw_allowlist: str, ledger: Path) -> None:
    """Re-prove that a checkout is still bounded, immediately before it is pushed.

    ``prepare`` prunes the checkout to exactly ``remote | allowlist`` and that
    pruning is the ONLY thing that makes ``--include-all`` safe: the bound is the
    filesystem, not the flag. ``prepare`` and the push happen in separate steps,
    so this re-checks the invariant at the point of use rather than trusting a
    result computed earlier in the job.
    """
    allowlist = parse_allowlist(raw_allowlist)
    keep = parse_remote_versions(ledger) | set(allowlist)
    on_disk = set(local_migrations(directory))
    if not on_disk:
        raise GuardError(f"no migrations found in bounded checkout: {directory}")
    extra = sorted(on_disk - keep)
    if extra:
        raise GuardError(
            "bounded checkout is NOT bounded -- --include-all would sweep "
            f"unapproved migrations: {extra}"
        )
    print(
        f"BOUNDED OK: {len(on_disk)} migration files on disk, all within "
        f"remote-ledger | allowlist ({len(allowlist)} allowlisted)."
    )


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
    bounded = subs.add_parser("assert-bounded")
    bounded.add_argument("--dir", dest="directory", type=Path, required=True)
    bounded.add_argument("--allowlist", required=True)
    bounded.add_argument("--remote-ledger", type=Path, required=True)
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
        elif args.command == "assert-bounded":
            assert_bounded(
                args.directory.resolve(), args.allowlist, args.remote_ledger
            )
        else:
            verify_dry_run(args.dry_run_output, args.allowlist)
    except (GuardError, OSError, subprocess.CalledProcessError) as exc:
        print(f"BLOCKED: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
