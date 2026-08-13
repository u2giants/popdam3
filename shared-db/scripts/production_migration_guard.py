#!/usr/bin/env python3
"""Validate a fail-closed production migration allowlist and dry run."""

from __future__ import annotations

import argparse
import hashlib
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
# ****** ONE-DIRECTIONAL IS NOT THE SAME AS "SILENT ONCE THE CREATE LANDS". ******
#
# Issue #672 item 1. The rule fires when the create is in the ALLOWLIST **or**
# already in the LEDGER. What stays one-directional is which versions it
# DEMANDS: it demands the outstanding fixes, never the create. So a recovery run
# after a mid-batch abort is still legal -- it just has to carry EVERY fix that
# is not yet applied, instead of an arbitrary subset. `20260810110000` ALONE
# with `20260810030000` already applied is REFUSED, because it leaves
# `20260810120000` unapplied and production holding the wrong read claim with
# `service_role` still able to INSERT. `20260810110000` + `20260810120000`
# together is ACCEPTED in that same state. See `parse_allowlist`.
#
# NOT LISTED HERE, ON PURPOSE: `20260810110000` also alters `api.dam_order_list`,
# which `20260810010000` creates. That is a DEPENDENCY, not a policy, and it is
# already enforced by `preflight_batch` -- which reads the real production ledger
# and therefore stays silent when `20260810010000` is already applied. Encoding
# it here would be ledger-blind and would break exactly the recovery case above.
# Dependencies belong in the preflight; policy belongs here.
#
# ALSO NOT LISTED, ON PURPOSE: `20260810030000` (Warner) does NOT require
# `20260810180000`. 20260810180000 touches only the 23 plm.pmt_* and 16
# plm.nbcu_* tables; Warner's `20260810110000` already revokes the full
# PostgreSQL 17 set (update, delete, truncate, references, trigger, maintain) and
# is the pattern 20260810180000 brings the other two up to. Adding it to the
# Warner rule would couple three landing schemas that do not depend on each
# other and would enlarge every Warner recovery allowlist for no security gain.
# A co-presence rule is a claim that promoting X without Y leaves production
# insecure; that claim is not true here, and a rule that is not true is a rule
# the next operator learns to route around.
#
# WHY `20260810180000` IS SAFE AS A REQUIRED FIX ON BOTH RULES. It is a FIX in
# two rules and a CREATE in none, so `test_no_rule_is_symmetric` still holds and
# `20260810180000` ALONE remains a legal allowlist. That matters more here than
# usual: every one of its 39 table references goes through `execute format(...)`,
# which `preflight_batch` explicitly does not model, so the migration itself
# handles a missing family all-or-nothing from a catalog read instead of
# aborting mid-batch. The rules below stop the lane producing that state; the
# migration copes if anything else does.
CO_PRESENCE_RULES: tuple[tuple[str, frozenset[str], str], ...] = (
    (
        # Paramount
        "20260810020000",
        frozenset({"20260810090000", "20260810180000"}),
        "20260810020000 creates the Paramount Creative Library landing schema and "
        "leaves `service_role` holding TRUNCATE on 23 tables. TRUNCATE does not "
        "fire the row-level triggers those tables rely on, so between these two "
        "migrations production is one statement away from silently bypassing "
        "every one of them. 20260810090000 is the loader target guard and the "
        "TRUNCATE revoke. 20260810180000 COMPLETES that fix and is required with "
        "it: 20260810090000 was written against the pre-PostgreSQL-17 privilege "
        "list and revokes only TRUNCATE and TRIGGER, leaving REFERENCES and "
        "MAINTAIN on all 23 tables (issue #664). 20260810180000 also narrows the "
        "plm schema default privilege that hands every new table all eight bits "
        "at CREATE TABLE, before any GRANT in the creating migration runs (issue "
        "#649); promoting the create without it re-opens that hole on 23 more "
        "tables and loses the one chance to prevent rather than repair it.",
    ),
    (
        # NBCU
        "20260810070000",
        frozenset({"20260810080000", "20260810180000"}),
        "20260810070000 creates the NBCU creative-asset landing schema with "
        "default-granted write privileges still in place. 20260810080000 revokes "
        "them. Promoting the create without the revoke leaves production writable "
        "by roles that must not write there. 20260810180000 is required for the "
        "same reason it is required alongside Paramount: 20260810080000 revokes "
        "only UPDATE, DELETE and TRUNCATE and leaves REFERENCES, TRIGGER and "
        "MAINTAIN on all 16 tables (issue #664), and only 20260810180000 closes "
        "the plm schema default-privilege hole behind them (issue #649).",
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
    (
        # Disney DCP Vault (issue #665)
        "20260810190000",
        frozenset({"20260810190100"}),
        "20260810190000 creates the nine plm.dcp_* Disney DCP Vault landing tables, the "
        "frozen row-hash function and the immutability triggers, but NO loader. The only "
        "path to plm.dcp_crawl.status = 'complete' is plm.finalize_dcp_crawl, and the only "
        "way to put a row in any of the nine tables is the chunked loader -- both live in "
        "20260810190100. Promoting the create alone therefore leaves production holding "
        "nine permanently empty tables that cannot be loaded, cannot be finalized, and "
        "whose immutability triggers can never arm because no crawl can ever reach "
        "'complete'. That is a half-build, not a shippable state, and the two were "
        "authored as one bounded change. "
        "DIRECTION, DELIBERATE, READ THE HEADER COMMENT BEFORE 'FIXING' IT: the create "
        "requires the loader, NOT the reverse. Stating it the other way round -- "
        "'20260810190100 requires 20260810190000' -- would be the obvious reading of the "
        "dependency and would be WRONG here, because validate_candidates refuses any "
        "allowlist naming an already-applied version. A batch that died between the two "
        "can only be recovered by an allowlist of 20260810190100 ALONE, and the reversed "
        "rule would refuse exactly that recovery and force an edit of this safety guard "
        "while production sat half-built. The genuine 'the loader needs its tables' "
        "dependency is ledger-aware and belongs to preflight_batch, which reads the real "
        "production ledger and stays silent once 20260810190000 is applied.",
    ),
)


# ---------------------------------------------------------------------------
# ATOMIC BATCHES (added 2026-08-11)
#
# ****** TWO PROVENANCES, ONE MECHANISM (issue #784, added 2026-08-12). ******
#
# Read this before deciding an entry is mislabelled. Every entry below states
# the same enforced property -- PRODUCTION MUST NOT COME TO REST INSIDE THIS SET
# -- but it is derived from the contract in one of two ways, and the `basis`
# field says which:
#
#   "ATOMIC"     the contract's section 5 table declares the batch atomic in so
#                many words. B1, B3, B7, B9 (and B10a, B10c in section 5A.4).
#
#   "NEVER-REST" the contract does NOT use the word atomic, but its section 6
#                never-rest list names EVERY member of the batch except the
#                last, and section 6's legal-resting-point list names that last
#                member. The set of legal resting states is therefore exactly
#                {none of it, all of it} -- mechanically identical to atomic,
#                derived rather than declared. B2, B4, B5, B6, B8.
#
# WHY ONE MECHANISM AND NOT TWO. Issue #784 asked for the shape to be decided
# first, and warned that the non-atomic batches "are not all-or-nothing like the
# atomic four". They were checked one by one against section 6 and they ARE: for
# each of B2, B4, B5, B6 and B8 the contract forbids resting on every member but
# the terminal one, so "an allowlist may not stop at a version section 6 forbids
# resting on" and "all members or none" describe the same set of accepted
# allowlists. Inventing a second checker to express an identical rule would give
# the lane two places to look and two places to drift. If a future batch ever
# gains a genuine INTERNAL legal resting point, that is when a second shape is
# warranted -- and it must be added with the contract text quoted beside it,
# never by weakening this one.
#
# B4 IS INCLUDED THOUGH #784 DID NOT NAME IT. #784 listed B2, B5, B6 and B8.
# Section 6 names `20260731210000` (B4's first of two) as a never-rest state and
# `20260731220000` as its legal resting point, so B4 is the same gap by the same
# derivation. Leaving it out because an issue body did not list it would rebuild
# the exact defect -- a rule that exists only in prose -- for one batch, and
# AGENTS.md 4.3 is explicit that the CONTRACT is the authority for batch
# membership, never an issue body. B4 is already applied to production, so the
# entry is inert today; it is here so the mechanism has no hole in it.
#
# THE COVERAGE IS PINNED BY A TEST, NOT BY THIS COMMENT. `test_every_section_6
# _never_rest_version_is_enforced` parses the contract's own section 6 list and
# asserts every version in it belongs to a registered batch and is not that
# batch's terminal member. That is what stops the next never-rest state from
# being added to the contract and enforced by nothing.
#
# docs/production-promotion-app-tolerance-contract.md declares FOUR of its nine
# promotion batches ATOMIC -- B1, B3, B7 and B9 (contract section 5 table, and
# section 10: "B1, B3, B7 and B9 are atomic. Do not split them, whatever a
# description implies"). Until today that was PROSE ONLY. The guard encoded
# fragments of it -- BUNDLE_20260804 covers four of B1's eleven files, and the
# CO_PRESENCE_RULES cover four of B9's fourteen -- and nothing at all for B3 or
# B7.
#
# The hole was not theoretical. `20260810050000` sits inside atomic B9 and
# appeared in NO HARD_BLOCKED entry, NO bundle and NO co-presence rule, so a
# single-file allowlist of `20260810050000` alone PASSED this guard while
# violating the contract. That is the exact shortcut that would let issue #729
# ship early and leave production at rest inside the Warner window (contract
# section 6: eight tables of confidential STARLABS data readable by every
# authenticated account). A guard that reads as strict and behaves as permissive
# is worse than no guard, because people trust it.
#
# WHY A NEW CONSTANT RATHER THAN AN EXISTING MECHANISM. The shape needed here is
# ALL-OR-NONE over a named set -- exactly BUNDLE_20260804's shape, and NOT
# CO_PRESENCE_RULES' shape (which is one-directional create-implies-fix, and must
# stay that way; see its header). So this generalises the BUNDLE mechanism to N
# named sets instead of inventing a parallel system. BUNDLE_20260804 is kept
# where it is: it is a SUBSET of B1 with its own independent provenance
# (AGENTS.md section 6.8, an owner ruling about unblocking, not about batching),
# it is enforced ledger-blind in `parse_allowlist` so no subcommand can route
# around it, and deleting it would lose that ruling. The two checks agree; the
# stricter one wins, which is the safe direction.
#
# ****** THE CHECK IS LEDGER-AWARE, AND THAT IS DELIBERATE. ******
#
# Read this before you "simplify" it into a plain all-or-none set check.
#
# `validate_candidates()` REFUSES any allowlist containing a version that is
# already applied on production. So consider the scenario this lane must survive:
# a bounded apply of atomic B9 dies at file 13 of 14. Thirteen versions are now
# in the production ledger. The ONLY legal recovery allowlist is the fourteenth
# ALONE -- the thirteen cannot be re-listed.
#
# A ledger-blind all-or-none rule would REFUSE that recovery. The operator's only
# way out would be to EDIT THIS SAFETY GUARD, at 2am, while production sat in one
# of the three exposed states in contract section 6. That is precisely the shape
# of change that gets made carelessly, and it is the same reasoning that made
# AGENTS.md 6.5 a co-presence rule instead of a HARD_BLOCKED entry.
#
# So the requirement is stated the way the contract actually means it: PRODUCTION
# MUST NOT COME TO REST INSIDE AN ATOMIC BATCH. Required membership is therefore
# `members - already_applied`. Completing a batch is always legal; stopping short
# of finishing one never is. There are explicit tests for the resume case; if you
# make this ledger-blind and they still pass, you have broken the tests, not
# proved the change.
#
# MEMBERSHIP IS TRANSCRIBED FROM THE CONTRACT, NOT INFERRED. Each set below is
# the batch's never-rest versions from contract section 6 plus that batch's one
# legal resting point from the same section, and each count reconciles exactly
# with the section 5 table -- EXCEPT B3, which carries one SECURITY appendage the
# contract predates: 20260812020000 (issue #822, the service_role TRUNCATE revoke
# on three append-only tables plus core.property_alias). So the guard counts are (11, 11, 6, 14) while
# the contract's functional section-5 counts stay (11, 10, 6, 14). The divergence
# is deliberate and is documented in the B3 entry below; the contract's ten are a
# strict subset of the guard's eleven.
#
# B3/B4 OVERLAP, RESOLVED: `20260731150000` and `20260731153000` (PopSG) are
# recorded on issues #773 and #710 as appearing in both batch definitions. The
# contract as it stands today does NOT carry that defect -- its section 5
# correction note ("The two PopSG files therefore belong INSIDE B3, making B3 ten
# files and B4 two") and its section 6 lists are consistent. The two versions are
# encoded here as B3 members and B4 is not an atomic batch, so the overlap is not
# reproduced in the guard.
ATOMIC_BATCHES: tuple[tuple[str, str, str, frozenset[str]], ...] = (
    (
        "B1",
        "ATOMIC",
        "the ColdLion circuit-breaker batch. It carries the BUNDLE_20260804 "
        "four AND the sync_coldlion_licensors_properties 2-arg -> 3-arg "
        "signature change at 20260726030000, whose 2-arg predecessor is created "
        "by 20260724060000/061000. The breaker is only fully armed and "
        "gap-closed by 20260728134500.",
        frozenset(
            {
                "20260724060000",
                "20260724061000",
                "20260726030000",
                "20260726031000",
                "20260726032000",
                "20260726180000",
                "20260727221500",
                "20260727223000",
                "20260727224500",
                "20260727230000",
                "20260728134500",
            }
        ),
    ),
    (
        "B2",
        "NEVER-REST",
        "the ClickUp importer batch. Contract section 6 forbids resting after "
        "20260728171500 and after 20260728174500, and lists 20260728181500 as "
        "the batch's only legal resting point -- so the legal states are none of "
        "it or all of it. 20260728174500 creates the ClickUp incremental "
        "importer and 20260728181500 corrects it: resting between them ships a "
        "KNOWN-DEFECTIVE importer to production. (Contract section 7.3 also "
        "records this batch as the one most likely to abort, so a partial "
        "landing here is not a hypothetical.)",
        frozenset(
            {
                "20260728171500",
                "20260728174500",
                "20260728181500",
            }
        ),
    ),
    (
        "B3",
        "ATOMIC",
        "the plm.promote_coldlion_source_owned chain. Eight successive bodies of "
        "the same function, of which only the eighth (20260731200000) is safe to "
        "rest on functionally. Earlier bodies leave a known ambiguous-column "
        "runtime error, broken absence detection, no serialization lock, or "
        "INCOMPLETE PROVENANCE, which is UNRECOVERABLE after the fact. The two "
        "PopSG files (20260731150000, 20260731153000) sort inside this span, and "
        "`supabase db push` applies in version order, so they cannot be "
        "leapfrogged into a later batch. 20260812020000 is the SECURITY appendage "
        "added by issue #822: the creates in this span `grant all` (including "
        "TRUNCATE) to service_role on three append-only evidence/decision tables "
        "plus core.property_alias (controlled shared alias truth whose writes go "
        "through public.promote_property_alias_batch()). For the three append-only "
        "tables, TRUNCATE does not fire the BEFORE UPDATE OR DELETE row triggers "
        "that enforce their append-only semantics -- so service_role is one "
        "statement away from silently wiping them; core.property_alias is revoked "
        "alongside as defense in depth. 20260812020000 revokes truncate plus the "
        "DDL-adjacent bits and keeps the DML, so production must not rest at "
        "20260731200000 without it. It sorts after every other member, so the "
        "revoke runs once the over-grant exists; the recovery allowlist of "
        "20260812020000 ALONE remains legal once the rest of B3 has landed "
        "(validate_candidates refuses to re-list applied versions).",
        frozenset(
            {
                "20260729230000",
                "20260729234500",
                "20260729235500",
                "20260730000500",
                "20260731150000",
                "20260731153000",
                "20260731163000",
                "20260731180000",
                "20260731190000",
                "20260731200000",
                "20260812020000",
            }
        ),
    ),
    (
        "B4",
        "NEVER-REST",
        "the core.licensor alias batch. Contract section 6 forbids resting after "
        "20260731210000 and lists 20260731220000 as the legal resting point, so "
        "the alias table must not land without the owner-approved remaining five "
        "aliases that fill it. NOT NAMED BY #784 -- derived from section 6 by "
        "the same rule as B2/B5/B6/B8; see the header. Already applied to "
        "production, so this entry is inert today and exists so the mechanism "
        "has no hole.",
        frozenset(
            {
                "20260731210000",
                "20260731220000",
            }
        ),
    ),
    (
        "B5",
        "NEVER-REST",
        "the taxonomy alert acknowledgement RPC and its three corrections. "
        "Contract section 6 forbids resting after 20260802140000, 20260802141000 "
        "and 20260802150000, and lists 20260802160000 as the legal resting "
        "point. 20260802160000 fixes the EFFECTIVE-ROLE CHECK, so every earlier "
        "resting state leaves the acknowledgement RPC judging the wrong "
        "principal. NOTE: the two AGENTS.md 6.5 held versions (20260802170000, "
        "20260802171000) sort just above 20260802160000 and are deliberately NOT "
        "members -- FR_HELD_20260803 refuses them by a separate, stricter rule.",
        frozenset(
            {
                "20260802140000",
                "20260802141000",
                "20260802150000",
                "20260802160000",
            }
        ),
    ),
    (
        "B6",
        "NEVER-REST",
        "the item identity/UPC contract, temp status watch and taxonomy baseline "
        "pins. Contract section 6 forbids resting after 20260803150000, "
        "20260803200000, 20260803201000 and 20260804120000, and lists "
        "20260804120100 as the legal resting point. 20260804120100 drops the "
        "8-arg trip_taxonomy_circuit_breaker and re-creates it, so resting "
        "before it leaves the pin table without its environment/provenance "
        "columns.",
        frozenset(
            {
                "20260803150000",
                "20260803200000",
                "20260803201000",
                "20260804120000",
                "20260804120100",
            }
        ),
    ),
    (
        "B7",
        "ATOMIC",
        "the Disney OPA batch. 20260807190000 does `drop view if exists "
        "api.opa_property_reconciliation` followed by a `create view` -- a "
        "genuine column-set change that `create or replace view` cannot do, so "
        "there is a window with NO VIEW AT ALL. It is also a security fix, not "
        "optional polish, and it is the third link of the "
        "plm.sync_opa_property_character chain (170100 -> 180000 -> 190000). "
        "Rest only after 20260807200000.",
        frozenset(
            {
                "20260807030000",
                "20260807170000",
                "20260807170100",
                "20260807180000",
                "20260807190000",
                "20260807200000",
            }
        ),
    ),
    (
        "B8",
        "NEVER-REST",
        "the core.product_size / core.product_depth foundation, both seeds, the "
        "guarded importer, the api pickers and the DB Data Admin mutations. "
        "Contract section 6 forbids resting after 20260809170000, 20260809170100, "
        "20260809170200, 20260809170300 and 20260809170400, and lists "
        "20260809170500 as the legal resting point. A HALF-SEEDED "
        "core.product_size is the single failure PopDAM swallows SILENTLY -- it "
        "falls back to style_groups.size_name, which looks plausible and is "
        "wrong (contract section 3.2). There is no monitoring that would catch "
        "it, so this batch's partial state is discovered by a user or not at all.",
        frozenset(
            {
                "20260809170000",
                "20260809170100",
                "20260809170200",
                "20260809170300",
                "20260809170400",
                "20260809170500",
            }
        ),
    ),
    (
        "B9",
        "ATOMIC",
        "the licensor landing batch. It carries all three security co-presence "
        "pairs (Paramount TRUNCATE, Warner `using (true)`, NBCU direct write -- "
        "the three worst resting states in the whole backlog), the "
        "api.dam_order_list security_invoker fix that 20260810010000 needs, and "
        "both DAM function chains. The contract states there is NO safe internal "
        "boundary anywhere in it. Resting between 20260810030000 and "
        "20260810110000 leaves eight tables of confidential Warner STARLABS data "
        "readable by EVERY authenticated account in the shared project.",
        frozenset(
            {
                "20260810010000",
                "20260810020000",
                "20260810030000",
                "20260810050000",
                "20260810060000",
                "20260810070000",
                "20260810080000",
                "20260810090000",
                "20260810100000",
                "20260810110000",
                "20260810120000",
                "20260810130000",
                "20260810160000",
                "20260810170000",
            }
        ),
    ),
    (
        # Issue #819, contract section 5A.4 and 5A.8.
        "B10a",
        "ATOMIC",
        "the Disney DCP Vault source landing plus its chunked loader. "
        "20260810190000 creates nine plm.dcp_* tables, the frozen row-hash "
        "function and the immutability triggers but NO loader; 20260810190100 "
        "supplies the chunked loader, plm.dcp_chunk_ledger and "
        "plm.finalize_dcp_crawl -- the only CHECKED path to "
        "dcp_crawl.status = 'complete'. State the exposure accurately, because "
        "the loose version of it was wrong: 20260810190000 grants service_role "
        "select AND insert and installs no header INSERT trigger, so a caller "
        "CAN write rows directly and can insert a dcp_crawl row already marked "
        "'complete', arming the immutability triggers over data nothing ever "
        "validated. That is worse than 'nothing can happen', not better. What "
        "is missing between the pair is the supported, checked, finalizable "
        "path -- not the ability to write. "
        "WHY THIS ENTRY EXISTS ALONGSIDE THE CO-PRESENCE RULE, which already "
        "covers the pair one-directionally (issue #665): the co-presence rule "
        "fires on the CREATE, so it is the right tool for 'the create must "
        "carry its fix'. This entry states the batch property the contract "
        "actually declares -- B10a is ATOMIC (section 5A.4) -- and section 5A.8 "
        "names registering B10a and B10c in ATOMIC_BATCHES as the correct fix. "
        "The two checks agree and the stricter one wins, which is the safe "
        "direction; neither is redundant, because deleting either would leave a "
        "claim the contract makes with nothing behind it.",
        frozenset(
            {
                "20260810190000",
                "20260810190100",
            }
        ),
    ),
    (
        # Issue #819. THE GAP THIS ISSUE WAS FILED ABOUT.
        "B10c",
        "ATOMIC",
        "the DCP Vault metadata landing plus its chunked loader. Declared ATOMIC "
        "by contract section 5A.4 and enforced by NOTHING until now -- not by "
        "ATOMIC_BATCHES, and (unlike B10a) not by any co-presence rule either, "
        "so the guard accepted an allowlist of 20260811050000 ALONE and only the "
        "operator stood between the contract and that state. 20260811050000 "
        "creates plm.dcp_metadata_*, dcp_property, dcp_character, dcp_term and "
        "three observation tables with no loader; 20260811060000 supplies "
        "begin_dcp_metadata_run / load_dcp_metadata_chunk / "
        "finalize_dcp_metadata_run plus plm.dcp_metadata_chunk_ledger and "
        "plm.dcp_metadata_load_exception. Identical shape to B10a, including the "
        "precision: 20260811050000 DOES grant service_role select and insert, so "
        "the gap is the supported loader and finalizer, not raw writability. "
        "Rest only after 20260811060000 (contract section 6). "
        "B10b (20260811030000) and B10d (20260811070000) are single files and "
        "therefore trivially atomic -- there is no internal boundary to stop at, "
        "so they get no entry.",
        frozenset(
            {
                "20260811050000",
                "20260811060000",
            }
        ),
    ),
)


class GuardError(ValueError):
    pass


def assert_atomic_batches(allowlist: list[str], remote: set[str]) -> None:
    """Refuse an allowlist that would leave production resting inside a batch.

    LEDGER-AWARE ON PURPOSE -- see the ATOMIC_BATCHES header. `remote` is the
    real production ledger, and members already in it are excluded from the
    requirement, because `validate_candidates` forbids re-listing them and a
    resume after a mid-batch abort would otherwise be impossible without editing
    this guard under time pressure.
    """
    chosen = set(allowlist)
    for name, basis, why, members in ATOMIC_BATCHES:
        present = chosen & members
        if not present:
            continue
        already = members & remote
        missing = sorted((members - already) - chosen)
        if not missing:
            continue
        resume = (
            f" (Excluded because production already has them: "
            f"{', '.join(sorted(already))}.)"
            if already
            else ""
        )
        citation = (
            f"section 5 declares {name} atomic"
            if basis == "ATOMIC"
            else f"section 6 forbids resting on every member of {name} but the last"
        )
        raise GuardError(
            f"batch {name} is {basis} and this allowlist would split it. "
            f"docs/production-promotion-app-tolerance-contract.md "
            f"{citation}: {why}\n"
            f"  batch {name} has {len(members)} members\n"
            f"  supplied ({len(present)}): {', '.join(sorted(present))}\n"
            f"  MISSING ({len(missing)}): {', '.join(missing)}{resume}\n"
            f"Add every missing version to the allowlist, or remove all "
            f"{len(present)} {name} version(s) from it. There is no size of "
            f"subset that makes a partial atomic batch legal -- stopping short "
            f"leaves production in a state the contract says must never be "
            f"rested on, and this lane is forward-only with no undo."
        )


def parse_allowlist(raw: str, remote: set[str] | frozenset[str] = frozenset()) -> list[str]:
    """Parse and policy-check a production allowlist.

    ``remote`` is the real production ledger when the caller has one. It is
    used by exactly ONE rule -- the co-presence check at the bottom of this
    function -- and it is optional so that callers with no ledger in hand
    (``verify-dry-run`` without ``--remote-ledger``, and
    ``production_catalog_verification``) keep the STRICTER ledger-blind
    behaviour. Defaulting to "no ledger" fails closed, never open.
    """
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
    #
    # LEDGER-AWARE ON PURPOSE (added 2026-08-11) -- a required FIX that is
    # ALREADY APPLIED ON PRODUCTION satisfies the rule. See the header block
    # above CO_PRESENCE_RULES. This is the SAME reasoning that made
    # `assert_atomic_batches` ledger-aware: `validate_candidates` REFUSES any
    # allowlist naming an already-applied version, so a ledger-blind
    # requirement for an applied fix is not "strict", it is UNSATISFIABLE by
    # any string, and the only escape is editing this guard under pressure.
    #
    # THE DEADLOCK THIS FIXES, CONCRETELY. `20260810180000` was promoted early
    # and alone on 2026-08-11 (it sorts ABOVE B9's own end version
    # `20260810170000`). It is a required fix on both the Paramount
    # (`20260810020000`) and NBCU (`20260810070000`) rules. So B9's 14 versions
    # were refused for missing it, and B9's 14 PLUS it were refused for naming
    # an applied version. B9 -- the licensor landing batch -- became impossible
    # to apply by ANY allowlist string.
    #
    # THIS DOES NOT WEAKEN THE RULE, AND THE DIFFERENCE MATTERS. An APPLIED fix
    # satisfies the rule because the property the rule protects -- production
    # must never hold the create without the fix -- is already true and stays
    # true. A MISSING fix (neither applied nor in the allowlist) still REFUSES,
    # because that is exactly the exposed state. Do not collapse those two
    # cases; there are tests for both, plus one for the missing-and-unapplied
    # case, and they are what tells you what you broke.
    #
    # THE RULE ALSO FIRES WHEN THE CREATE IS ALREADY APPLIED (issue #672 item 1,
    # deliberately deferred by PR #747 because it turns a PASS into a FAIL).
    #
    # `create in remote` is the state the rule exists to end, not a state that
    # excuses it. Before this, the rule was gated on `create in chosen` alone, so
    # once the CREATE had landed the guard stopped compelling anything: with
    # Warner's `20260810030000` applied, an allowlist of `20260810110000` ALONE
    # passed, leaving `20260810120000` unapplied -- production holding the wrong
    # read claim with `service_role` still able to INSERT. The rule's whole claim
    # is "production must never hold the create without the fixes", and that
    # claim is violated exactly as hard by a half-finished repair as by a
    # half-finished first promotion.
    #
    # THIS DOES NOT BREAK RECOVERY, AND THE DISTINCTION IS THE WHOLE DESIGN.
    # Required membership stays `fixes - already_applied`, so completing the
    # repair is always legal and re-listing an applied version (which
    # `validate_candidates` refuses outright) is never required. What is now
    # refused is stopping short: a repair allowlist that names SOME outstanding
    # fixes and not all of them. That is the same "you may finish, you may not
    # rest inside" shape `assert_atomic_batches` already uses, and for the same
    # reason -- this lane is forward-only with no undo.
    #
    # Paramount and NBCU each have two fixes and Warner two, so every rule can
    # surface this; Warner is where it was found. A rule whose fixes are all
    # applied is silent, so a fully repaired production stays promotable.
    chosen = set(values)
    for create, fixes, why in CO_PRESENCE_RULES:
        create_applied = create in remote
        if create not in chosen and not create_applied:
            continue
        already = fixes & set(remote)
        missing = sorted((fixes - already) - chosen)
        if missing:
            satisfied = (
                f" (Already applied on production, so not required here: "
                f"{', '.join(sorted(already))}.)"
                if already
                else ""
            )
            if create_applied:
                raise GuardError(
                    f"co-presence rule: {create} is ALREADY APPLIED on production "
                    f"and its fix(es) {', '.join(missing)} are neither applied nor "
                    f"in this allowlist.{satisfied} Production is sitting in the "
                    f"exposed state right now, so an allowlist that repairs only "
                    f"part of it is refused. {why} Add every missing version to "
                    f"the allowlist. (Do NOT add {create} back -- "
                    "`validate_candidates` refuses any allowlist naming an "
                    "already-applied version, and it does not need re-applying.)"
                )
            raise GuardError(
                f"co-presence rule: {create} may not be promoted without "
                f"{', '.join(missing)}.{satisfied} {why} Add the missing version(s) to the "
                "allowlist. (This rule is one-directional on purpose: promoting "
                f"{', '.join(sorted(fixes))} WITHOUT {create} is allowed, because "
                "that is the only legal way to recover a run that died between "
                "them -- but the recovery must carry EVERY outstanding fix, not "
                "just some of them.)"
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


# ---------------------------------------------------------------------------
# FILE-CONTENT DIGEST PINNING (issue #617)
#
# `prepare` prunes a bounded checkout down to exactly `remote-ledger | allowlist`
# and `assert_bounded` re-proves that set immediately before the push. That
# proves the SET of files but not their BYTES: nothing here watched whether a
# file's contents drifted between `prepare` and the push (an editor, a line-
# ending rewrite, a partial write), or whether the record of what was prepared
# was hand-edited. A bounded checkout whose membership is correct but whose
# contents have moved is still untrustworthy, so `prepare` now pins the byte
# content of every file that survived pruning and `assert_bounded` re-proves it.
#
# The manifest is a JSON object mapping version -> sha256 hex digest of the
# migration file's raw bytes, keys sorted for determinism. It lives INSIDE the
# bounded checkout (a sibling of `migrations/`, never inside it), so the two
# functions stay self-contained: `prepare` writes `<output>/supabase/<name>`
# and `assert_bounded` reads `<directory>/supabase/<name>` with no extra state.
#
# WHAT THE PIN IS AND IS NOT. It is a byte-for-byte tamper seal between two
# steps of the same job. It is not a defence against an actor who can write
# both the migration files and the manifest at once -- such an actor could
# re-pin whatever they liked. It defends against the realistic failure for this
# lane: a process or person changes a file (or the manifest) AFTER `prepare`
# committed the bounded set and BEFORE the push, where the change is invisible
# to the membership check. Every divergence fails CLOSED.
#
# NO VERSION/TABLE SPECIAL CASES. Every file on disk is hashed unconditionally;
# nothing here keys on a particular version or object. The pin is generic.
# ---------------------------------------------------------------------------

MANIFEST_FILENAME = "migration-content-manifest.json"


def manifest_path(directory: Path) -> Path:
    """Where ``prepare`` writes the content manifest inside a bounded checkout.

    A sibling of ``migrations/`` rather than inside it, so the Supabase CLI's
    ``supabase/migrations/*.sql`` glob (and every member check here) never sees
    it and it cannot be mistaken for a migration.
    """
    return directory / "supabase" / MANIFEST_FILENAME


def compute_content_manifest(directory: Path) -> dict[str, str]:
    """SHA-256 digest of every migration file on disk, keyed by version.

    Keyed by the 14-digit version because that is the identity the ledger, the
    allowlist and every file-set check already use; the digest pins the bytes.
    Reads raw bytes so a line-ending or encoding change registers as drift.
    """
    return {
        version: hashlib.sha256(path.read_bytes()).hexdigest()
        for version, path in local_migrations(directory).items()
    }


def write_content_manifest(directory: Path) -> Path:
    """Pin the current byte content of every migration file in ``directory``.

    Called by ``prepare`` once the bounded set is final, so the manifest records
    exactly the files that survived pruning. Deterministic output (sorted keys)
    so a byte-identical re-pin is text-identical too.
    """
    path = manifest_path(directory)
    path.write_text(
        json.dumps(compute_content_manifest(directory), indent=2, sort_keys=True)
        + "\n",
        encoding="utf-8",
    )
    return path


def assert_content_manifest(directory: Path) -> None:
    """Fail closed unless the on-disk bytes still match what ``prepare`` pinned.

    Every branch refuses: a missing manifest (never prepared, or deleted), a
    corrupt/unreadable manifest, a shape that is not the expected object, a file
    added or removed since the pin, and any byte drift -- which is also exactly
    what a hand-edited manifest digest looks like, so manifest tampering and
    content drift are the same comparison and both fail the same way.
    """
    path = manifest_path(directory)
    if not path.is_file():
        raise GuardError(
            f"content manifest missing: {path}. `prepare` must write one before "
            "the checkout is pushed; a missing manifest means the byte content "
            "of the bounded files was never pinned and cannot be trusted."
        )
    try:
        stored = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise GuardError(
            f"content manifest at {path} is unreadable/corrupt ({exc}); treat "
            "the bounded checkout as untrusted."
        )
    if not isinstance(stored, dict):
        raise GuardError(f"content manifest at {path} is not a JSON object")
    recomputed = compute_content_manifest(directory)
    if recomputed == stored:
        return
    missing = sorted(set(stored) - set(recomputed))
    added = sorted(set(recomputed) - set(stored))
    drifted = sorted(
        version
        for version in (set(stored) & set(recomputed))
        if stored[version] != recomputed[version]
    )
    details: list[str] = []
    if missing:
        details.append(f"removed from disk: {missing}")
    if added:
        details.append(f"added to disk: {added}")
    if drifted:
        details.append(f"byte drift / manifest tamper: {drifted}")
    raise GuardError(
        "bounded checkout content manifest mismatch -- the files on disk no "
        f"longer match what `prepare` pinned ({'; '.join(details)}). Refusing "
        "to push. Re-run `prepare` to re-pin, or investigate the drift."
    )


def validate_candidates(
    migrations: dict[str, Path], allowlist: list[str], remote: set[str]
) -> None:
    unknown = [version for version in allowlist if version not in migrations]
    if unknown:
        raise GuardError(f"unknown migration version: {', '.join(unknown)}")
    applied = [version for version in allowlist if version in remote]
    if applied:
        raise GuardError(f"already applied on production: {', '.join(applied)}")
    # Contract section 5 / section 10: B1, B3, B7 and B9 are ATOMIC. Enforced
    # here rather than in `parse_allowlist` because the check needs the real
    # production ledger to stay resumable (see the ATOMIC_BATCHES header).
    # `validate_candidates` is called by both `prepare` and `preflight`, and
    # `assert_bounded` calls `assert_atomic_batches` directly, so no subcommand
    # that can reach production routes around it.
    assert_atomic_batches(allowlist, remote)


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

# #672 item 2. The SAME blind spot reached by a different route. A DO block's
# body may be a plain string literal instead of a dollar-quoted one:
#
#   do 'begin ... end';
#   do language plpgsql 'begin ... end';
#
# Neither matches ARCHAIC_BODY_AS_RE (there is no `as`) nor CREATE_ROUTINE_RE
# (there is no create/alter function header), so such a body was blanked by
# `strip_sql` and became invisible to preflight with nothing raised -- exactly
# the silent condition `assert_no_archaic_function_body` exists to prevent.
#
# Latent, not live: a sweep of supabase/migrations/ for `do '` returns ZERO
# occurrences, so no existing file's result changes.
BARE_DO_LITERAL_RE = re.compile(r"\bdo\s+(?:language\s+\w+\s+)?'")


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

    # #672 item 2. A bare `do '...'` reaches the same blind spot without an `as`
    # and without a routine header, so the loop above cannot see it.
    #
    # ⚠️ Scoped to STATEMENT START, and that scoping is load-bearing. This scan
    # runs on keep_literals=True text, so English prose inside a kept
    # `comment on ... is '...'` is visible to it -- and a comment reading
    # `'we do ''this'''` contains the byte sequence `do '`. An unscoped search
    # would HARD-REFUSE a blameless migration over its own prose. A real DO is a
    # top-level statement, so nothing but whitespace may precede it since the
    # last terminator.
    for match in BARE_DO_LITERAL_RE.finditer(text):
        if text[: match.start()].rsplit(";", 1)[-1].strip():
            continue
        raise GuardError(
            f"{version} contains a DO block whose body is a single-quoted string "
            f"(`do '...'`). The preflight scanner blanks string literals, so it "
            f"cannot read that body and cannot judge what the migration depends "
            f"on. Rewrite it as `do $$ ... $$` before promoting it. Do not delete "
            f"this check to get past it."
        )


def strip_sql(
    raw: str,
    keep_literals: bool = False,
    keep_dollar: bool = False,
    keep_regclass: bool = True,
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
            if keep_literals or (keep_regclass and REGCLASS_AHEAD_RE.match(raw, j)):
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
        elif (
            ch == "$"
            and (m := DOLLAR_OPEN_RE.match(raw, i))
            # #609 F1. A dollar quote opens only at a TOKEN BOUNDARY. Without this
            # guard, the `$$` inside an unquoted identifier such as `my$$col`
            # matched, latched onto the next genuine `$$`, and BLANKED EVERYTHING
            # BETWEEN -- so a real hard reference silently disappeared and the
            # preflight reported no dependency. That is the false-ACCEPT direction.
            #
            #   baseline (mycol):  created={plm.t, plm.f}  refs=[(plm.missing_dep, ...)]
            #   with    (my$$col): created={plm.t}         refs=[]   <- ref lost
            #
            # Measured exposure when filed: the pattern `[A-Za-z0-9_]\$\$` matched
            # 0 of 411 migration files, so this changes no existing file's result.
            and not (i > 0 and (raw[i - 1].isalnum() or raw[i - 1] == "_"))
        ):
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
    # #609 F2 / #672 item 3 -- THE PHANTOM CREATE.
    #
    # `strip_sql` keeps a literal that is cast to `::regclass`, because there the
    # text really is an apply-time object reference. But the kept text was then
    # scanned by CREATE_RES as well as REFERENCE_RES, so a literal whose contents
    # read like `create table a.b` registered an object that IS NEVER CREATED. A
    # phantom in `available` can satisfy a later file's dependency that production
    # cannot actually meet -- the false-ACCEPT direction.
    #
    # The regclass exception exists for REFERENCES, so only `hard_references`
    # needs it. Blanking it for the CREATE scan removes the phantom without
    # touching the dependency the exception was added to find; `hard_references`
    # below still calls `strip_sql` with the exception intact.
    #
    # Measured exposure when filed: 2 of 411 files contain a `'create ...'`
    # literal, both `command_tag` strings with no `schema.object`, so 0 phantom
    # objects are produced today and no existing file's result changes.
    text = strip_sql(raw, keep_regclass=False)
    found: set[str] = set()
    for pattern in CREATE_RES:
        for match in pattern.finditer(text):
            found.add(f"{match.group(1)}.{match.group(2)}")
    return found


# ---------------------------------------------------------------------------
# #609 F5 -- `available` NEVER SHRANK.
#
# The preflight modelled object CREATION only. `drop table plm.old` in file N
# produced `created_objects == {}` and removed nothing, so a later
# `alter table plm.old` was still satisfied from the remote ledger and the batch
# passed -- the false-ACCEPT direction. The issue records this as an
# ARCHITECTURAL limit rather than a regex bug, and it is: closing it means the
# preflight has to model removal as well as creation. That is what this does.
#
# LAST EVENT WINS, AND THAT IS THE WHOLE MODEL. Within one file the events are
# read in TEXT ORDER and only the final one for an object counts, because that
# is the file's end state -- which is the only thing a later file can observe.
# So the near-universal `drop view if exists api.x; create view api.x ...`
# (contract section 5, B7 and B10b both do it) leaves api.x AVAILABLE, and the
# reverse order leaves it gone. Getting this backwards would turn a
# false-ACCEPT into a wave of false REJECTs across the whole backlog.
#
# `created_objects` IS DELIBERATELY UNCHANGED. It still reports every object the
# file creates anywhere. `preflight_batch` applies `available |= created` and
# then `available -= dropped_objects(raw)`, and because `dropped_objects` only
# reports objects whose LAST event is a removal, the order of those two lines
# gives the correct end state either way. Leaving `created_objects` alone keeps
# every existing caller and test meaning exactly what it meant before.
#
# WHAT IS AND IS NOT MODELLED. Removals reached only through
# `execute format(...)` are invisible here for the same reason creations are
# (module header). A drop this scanner cannot see leaves `available` too large,
# which is the pre-existing behaviour, not a new hole. This check may REJECT;
# it is still never an APPROVAL.
#
# MEASURED EXPOSURE. Across every file in supabase/migrations/, walked in
# version order, no object that a migration drops-and-does-not-recreate is
# hard-referenced by any later migration -- so no existing batch's verdict
# changes. See test_f5_no_existing_migration_becomes_a_new_rejection.
# ---------------------------------------------------------------------------

# Object kinds whose removal this models. Deliberately the same five kinds
# `CREATE_RES` recognises: modelling the removal of something whose creation is
# invisible would produce refusals nothing could ever satisfy.
DROP_RES = (
    re.compile(r"\bdrop\s+(?:unlogged\s+)?table\s+(?:if\s+exists\s+)?"),
    re.compile(r"\bdrop\s+(?:materialized\s+)?view\s+(?:if\s+exists\s+)?"),
    re.compile(r"\bdrop\s+type\s+(?:if\s+exists\s+)?"),
    re.compile(r"\bdrop\s+sequence\s+(?:if\s+exists\s+)?"),
)
DROP_ROUTINE_RE = re.compile(
    r"\bdrop\s+(?:function|procedure)\s+(?:if\s+exists\s+)?"
)
# Where a `drop` object list ends. `cascade`/`restrict` are not object names and
# a `;` ends the statement outright.
DROP_LIST_END_RE = re.compile(r"\(|;|\bcascade\b|\brestrict\b")
# `alter <kind> [if exists] [only] sch.obj rename to newname` -- the old name
# STOPS EXISTING and a new one appears in the same schema. `rename column`,
# `rename constraint` and friends do not match, because they carry the noun
# between `rename` and `to`.
RENAME_RE = re.compile(
    r"\balter\s+(?:table|view|materialized\s+view|sequence|type|function|procedure)\s+"
    r"(?:if\s+exists\s+)?(?:only\s+)?" + IDENT + r"\s+rename\s+to\s+([a-z_][a-z0-9_]*)"
)
# `alter <kind> sch.obj set schema other` -- same object, different qualified
# name, so the old qualified name stops resolving.
SET_SCHEMA_RE = re.compile(
    r"\balter\s+(?:table|view|materialized\s+view|sequence|type|function|procedure)\s+"
    r"(?:if\s+exists\s+)?(?:only\s+)?" + IDENT + r"\s+set\s+schema\s+([a-z_][a-z0-9_]*)"
)


def object_events(raw: str) -> list[tuple[int, str, bool]]:
    """Every creation and removal in the file, as ``(position, object, created)``.

    Positions come from the SAME stripped text `created_objects` scans
    (``keep_regclass=False``), so a `create table a.b` sitting inside a kept
    ``::regclass`` literal cannot register here either -- the #609 F2 phantom.
    """
    text = strip_sql(raw, keep_regclass=False)
    events: list[tuple[int, str, bool]] = []
    for pattern in CREATE_RES:
        for match in pattern.finditer(text):
            events.append(
                (match.start(), f"{match.group(1)}.{match.group(2)}", True)
            )
    for pattern in DROP_RES:
        for match in pattern.finditer(text):
            end = DROP_LIST_END_RE.search(text, match.end())
            segment = text[match.end() : end.start() if end else len(text)]
            # `drop table a.b, c.d` removes both.
            for obj in re.finditer(IDENT, segment):
                events.append(
                    (match.start() + obj.start(), f"{obj.group(1)}.{obj.group(2)}", False)
                )
    for match in DROP_ROUTINE_RE.finditer(text):
        # A routine list is different from every other DROP list: commas inside
        # argument signatures are not item separators. Walk balanced
        # parentheses so `drop function plm.f(integer), plm.g(text)` records
        # both routines, while qualified argument types never become objects.
        item_start = match.end()
        depth = 0
        cursor = item_start
        while cursor <= len(text):
            at_end = cursor == len(text)
            char = "" if at_end else text[cursor]
            item_so_far = text[item_start:cursor].rstrip()
            trailing_modifier = bool(
                item_so_far.endswith(")")
                and re.match(r"(?:cascade|restrict)\b", text[cursor:])
            )
            terminal = depth == 0 and (
                at_end
                or char == ";"
                or trailing_modifier
            )
            separator = depth == 0 and char == ","
            if terminal or separator:
                item = text[item_start:cursor]
                obj = re.search(IDENT, item)
                if obj:
                    events.append(
                        (
                            item_start + obj.start(),
                            f"{obj.group(1)}.{obj.group(2)}",
                            False,
                        )
                    )
                if terminal:
                    break
                item_start = cursor + 1
            elif char == "(":
                depth += 1
            elif char == ")" and depth:
                depth -= 1
            cursor += 1
    for match in RENAME_RE.finditer(text):
        schema, old, new = match.group(1), match.group(2), match.group(3)
        events.append((match.start(), f"{schema}.{old}", False))
        events.append((match.start() + 1, f"{schema}.{new}", True))
    for match in SET_SCHEMA_RE.finditer(text):
        schema, obj, new_schema = match.group(1), match.group(2), match.group(3)
        events.append((match.start(), f"{schema}.{obj}", False))
        events.append((match.start() + 1, f"{new_schema}.{obj}", True))
    events.sort(key=lambda item: item[0])
    return events


def dropped_objects(raw: str) -> set[str]:
    """Objects this file removes and does NOT put back. Last event wins.

    The complement of `created_objects` for `preflight_batch`'s `available` set.
    An object dropped and then re-created in the same file is NOT here -- the
    drop-and-recreate is the normal way to change a view's column set, and
    treating it as a removal would reject most of B7 and all of B10b.
    """
    final: dict[str, bool] = {}
    for _position, obj, created in object_events(raw):
        final[obj] = created
    return {obj for obj, created in final.items() if not created}


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

    # #609 F5. `available` now SHRINKS on a drop/rename, so the ledger prefix has
    # to be walked in version order -- an unordered union would let a create in a
    # later applied file be cancelled by a drop in an earlier one, or vice versa.
    # `removed_by` remembers WHICH version removed an object, so the refusal can
    # say "dropped by X" instead of the misleading "created by X, which is not
    # applied" the creation-only model would have printed.
    available: set[str] = set()
    removed_by: dict[str, str] = {}
    for version in sorted(remote):
        path = migrations.get(version)
        if path is None:
            continue
        raw = path.read_text(encoding="utf-8")
        created = created_objects(raw)
        dropped = dropped_objects(raw)
        available |= created
        available -= dropped
        for obj in created:
            removed_by.pop(obj, None)
        for obj in dropped:
            removed_by[obj] = version

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
        created = created_objects(raw)
        dropped = dropped_objects(raw)
        available |= created
        available -= dropped
        for obj in created:
            removed_by.pop(obj, None)
        for obj in dropped:
            removed_by[obj] = version
        for obj, reason in hard_references(raw):
            if obj in available:
                continue
            # #609 F5. A POSITIVE, RECORDED REMOVAL. This is the one case the
            # creation-only model could not see at all, and it is reported
            # separately because the advice is the opposite: the object is not
            # "coming later", it is GONE, and no amount of adding versions to the
            # allowlist will bring it back.
            if obj in removed_by:
                problems.append(
                    f"{version} references missing {obj} ({reason}); it was "
                    f"DROPPED (or renamed away) by {removed_by[obj]} and not "
                    f"re-created -- would abort the batch (42P01 undefined_table "
                    f"/ 42883 undefined_function). Adding versions to the "
                    f"allowlist cannot fix this: either {version} is referencing "
                    f"the wrong name, or {removed_by[obj]} should not be in this "
                    f"batch."
                )
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
    remote = parse_remote_versions(ledger)
    allowlist = parse_allowlist(raw_allowlist, remote)
    migrations = local_migrations(repo)
    validate_candidates(migrations, allowlist, remote)
    preflight_batch(migrations, allowlist, remote)
    print(
        f"PREFLIGHT OK: {len(allowlist)} migrations, no missing non-deferrable "
        "dependency. This is a pre-filter, NOT an approval -- the rehearsal "
        "against a production-shaped database remains the authoritative gate."
    )


def prepare(repo: Path, output: Path, commit_sha: str, raw_allowlist: str, ledger: Path) -> None:
    remote = parse_remote_versions(ledger)
    allowlist = parse_allowlist(raw_allowlist, remote)
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
    # Pin the exact byte content of every file that survived pruning, so the
    # later `assert_bounded` can refuse any drift between this step and the
    # push. Written last, after the file-set check, so it reflects the final
    # bounded state and nothing after it mutates the checkout.
    write_content_manifest(output)


def assert_bounded(directory: Path, raw_allowlist: str, ledger: Path) -> None:
    """Re-prove that a checkout is still bounded, immediately before it is pushed.

    ``prepare`` prunes the checkout to exactly ``remote | allowlist`` and that
    pruning is the ONLY thing that makes ``--include-all`` safe: the bound is the
    filesystem, not the flag. ``prepare`` and the push happen in separate steps,
    so this re-checks the invariant at the point of use rather than trusting a
    result computed earlier in the job.
    """
    remote = parse_remote_versions(ledger)
    allowlist = parse_allowlist(raw_allowlist, remote)
    # Re-prove atomicity at the point of use too, for the same reason this
    # function re-proves boundedness: `prepare` and the push are separate steps.
    assert_atomic_batches(allowlist, remote)
    keep = remote | set(allowlist)
    on_disk = set(local_migrations(directory))
    if not on_disk:
        raise GuardError(f"no migrations found in bounded checkout: {directory}")
    extra = sorted(on_disk - keep)
    if extra:
        raise GuardError(
            "bounded checkout is NOT bounded -- --include-all would sweep "
            f"unapproved migrations: {extra}"
        )
    # Re-prove the BYTE CONTENT too, not just the file set. The membership check
    # above cannot see a file whose contents drifted (or whose pinned digest was
    # hand-edited) between `prepare` and this push; this comparison can, and it
    # fails closed on every form of divergence. Run AFTER the file-set checks so
    # an added file still produces the existing, named-membership message.
    assert_content_manifest(directory)
    print(
        f"BOUNDED OK: {len(on_disk)} migration files on disk, all within "
        f"remote-ledger | allowlist ({len(allowlist)} allowlisted), content "
        "manifest verified."
    )


def verify_dry_run(path: Path, raw_allowlist: str, ledger: Path | None = None) -> None:
    # `ledger` is OPTIONAL and only feeds the ledger-aware co-presence rule.
    # Omitting it keeps the stricter ledger-blind behaviour, which fails closed.
    # The lane workflow passes it so an already-applied required fix does not
    # deadlock this step after `prepare` and `preflight` have already accepted
    # the same allowlist.
    remote = parse_remote_versions(ledger) if ledger is not None else frozenset()
    allowlist = parse_allowlist(raw_allowlist, remote)
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
    # REQUIRED on the CLI even though the Python function's `ledger` is
    # optional. The function stays optional for `production_catalog_verification`
    # and other direct callers; the LANE must never be able to omit it, because
    # an omitted ledger silently restores the exact B9 deadlock this flag exists
    # to remove (a loud refusal, but at the last gate, after everything else has
    # already passed). All four workflow call sites pass it; there is a test
    # asserting they always will.
    verify.add_argument("--remote-ledger", type=Path, required=True)
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
            verify_dry_run(args.dry_run_output, args.allowlist, args.remote_ledger)
    except (GuardError, OSError, subprocess.CalledProcessError) as exc:
        print(f"BLOCKED: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
