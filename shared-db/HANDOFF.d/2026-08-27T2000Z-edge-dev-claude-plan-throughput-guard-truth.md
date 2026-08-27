---
issue: 1680
status: OPEN
owner: claude/plan-throughput-guard-truth
---

# Handoff — plan written to cut `shared-db` issue lead time (guard truth, false-alarm corpus, blocker ledger)

**UTC:** 2026-08-27T20:00Z · **Machine:** edge-dev · **Agent:** Claude (Opus 5) · **Branch:** `claude/plan-throughput-guard-truth` (from `origin/main` @ `42f0b77`)

## What this session produced

A single deliverable: [`plan_orchestrator_throughput_guard_truth.md`](../plan_orchestrator_throughput_guard_truth.md).
**Read its STATUS table first. Do not re-derive the analysis or re-plan the steps.**

No code was changed. No database was touched. No migration was written.

## Independent review, 2026-08-27 — read this before the plan

GLM-5.3 reviewed the plan (session `shared-db-throughput-plan-review`, report
`.ai/reviews/glm-shared-db-throughput-plan-review-20260827T194444Z.md`) and returned
**APPROVE WITH CHANGES**, with Steps 1–3 rejected as originally written.

**Its finding about the three named files was correct** — they are phantoms of a bare
`$$` regex that paired a `$$` inside a `--` comment with a later real `do $$`.
**But the replacement claim written in response — "the count is zero" — was ALSO wrong,
and wrong the same way.** The re-check used a bare `$$` pattern too, which is structurally
incapable of seeing a tagged dollar quote. A peer session caught it within the hour. It
never reached `main`.

**The third answer — "one migration, four objects" — was also wrong**, as a corpus
count. A second independent review (**Grok 4.6**, 2026-08-27, report
`.ai/reviews/grok-shared-db-throughput-plan-grok-20260827T200630Z-2068325.md`,
verdict **REJECT**) found that the scan behind it used a tag pattern with no digits and
was only ever run against one file. Every finding below was re-verified by hand before
being accepted.

**The verified answer is now a command, not a sentence:** `python scripts/scan_apply_time_ddl.py`
returns **4 migrations, 14 relations**. It uses `strip_sql` itself, walks nested dollar
bodies, blanks comments and literals, and — the distinction all three earlier attempts
missed — excludes routine bodies, whose DDL runs at **call** time, not apply time.
Admitting those would be a false ACCEPT, strictly worse than the false refusal being fixed.

**§6.1's mechanism is confirmed and is stronger than first written.** `public.style_group_tags`
has **three** creators: two invisible dollar-quoted ones (`20260825031841`, `20260825082910`)
and one plain-text one (`20260825010603`) that is permanently `HARD_BLOCKED`. That is exactly
the trap the owner described. It is also **not** a `do $$` block — it is a DDL string passed
to a `pg_temp` helper that executes it, so any implementation special-casing `DO` misses it.

**The most important thing Grok found:** `production_migration_guard.py:1832`
(`_created_by_applied_dynamic_ddl`, called at `:1953`, test at
`test_production_migration_guard.py:1083`) **already rescues the #1645 case** for applied
migrations. Two drafts of Step 1 were written without knowing it existed, and the second
would have replaced its silent `continue` with a refusal — rebuilding the outage.

Consequences already applied to the plan: `scripts/scan_apply_time_ddl.py` added as the
re-derivable artifact; §3.1 rewritten with all three wrong answers and the call-time
exclusion; §6.1 corrected on blast radius, on the `do $$` mischaracterisation, and to name
the existing rescue as load-bearing; Step 1 rebuilt around an operational apply-time
definition, returning **statements** not bodies, with six verification gates including a
must-not-fire test on the three `reconcile_*` procedure files and a requirement that the
existing rescue test pass unmodified; Step 2 given multi-creator semantics and a
project-ref redaction rule; Step 3 given a text-only rule so enrichment can never change an
exit code, and its wrong line reference corrected (1947 → 2473); Step 5 wired into a
workflow and stripped of generated Markdown; Step 8 keeps **two** reviewers for anything
touching `supabase/migrations/`; corpus fixture 16 added for the call-time/digit-tag shape;
`docs/verification/issue-lead-time-baseline-20260827.md` added so the success target has an
artifact; Open Question 1 corrected — #1645 is `20260825010603`, **not** the Paramount
`20260814223552` / `20260825094455` pair, which is a real bookkeeping trap for a different
object.

**If only one step is ever built, build Step 2 (`catalog-truth`).** Both reviewers said so
independently. Grok went further and said Step 1 as previously written should be deleted
outright; that decision is open with the owner.

## Why it exists

The owner reviewed the recorded Claude sessions for this repository on 2026-08-27
and asked why issues take so long to clear, citing the #1645 case where a safety
scanner reported a table as missing and blamed a hard-blocked migration, when
production had held that table since 25 August. **That explanation — a `CREATE TABLE`
hidden inside a dollar-quoted block — is correct and is confirmed by the repository's own
code (`production_migration_guard.py:1932-1940`).** What did not survive review was the
plan's *list of affected files*, three times over; see above and §3.1 of the plan. Do not
read this section as saying the mechanism was wrong.

Analysis of 38 archived sessions (8 of them orchestrator sessions) between
2026-08-18 and 2026-08-27 found four repeating shapes, all written up with
verbatim evidence in §6 of the plan:

1. guards judge SQL **text** and treat "I did not see it" as "it does not exist";
2. guards fire on honest input, and each repair costs a whole session;
3. a diagnosis is announced before it is proven, then reversed;
4. waits on external reviewers are unbounded, and the reviewers misreport their own state.

Measured baseline, 400 closed issues: median 4.0h, mean 21.1h, p90 60.3h;
18% over a day, 10% over three days. The long tail is the target.

## What is NOT done

Every step in the plan. Step 0 (open the tracking issue, confirm registration)
is where a fresh session starts.

## Things a successor must not do

- Do **not** flip `strip_sql`'s `keep_dollar` default to fix the headline bug.
  It would create false apply-time dependencies across 546 migrations. §7.2.
- Do **not** characterise the lexer's blind spot with a regex. It has been done three
  times in this plan and produced three different wrong answers. Run
  `python scripts/scan_apply_time_ddl.py`, or extend it. A dollar quote is `$tag$`, not
  `$$`, and a tag may contain digits (`$ddl_0$`).
- Do **not** implement `apply_time_ddl_statements()` with a `$$`-only or digit-less
  matcher, and do **not** admit DDL inside a `create function` / `create procedure` body.
  The first misses the files that matter; the second admits call-time DDL as if it were
  applied, which is a **false ACCEPT** and strictly worse than the bug being fixed. There
  is a required test for each.
- Do **not** touch `_created_by_applied_dynamic_ddl` (`production_migration_guard.py:1832`)
  or its test (`test_production_migration_guard.py:1083`). It already rescues the #1645
  case for applied migrations. Turning its silent `continue` into any kind of refusal
  rebuilds the outage this work exists to prevent.
- Do **not** loosen any guard to reduce false alarms. §7.1, and it is the owner's
  standing rule.
- Do **not** route this to the structure/schema orchestrator. It is repository
  maintenance and authorizes no database change.

## Evidence sources

- Transcript archive: `u2giants/ai-devops-transcripts`,
  `collection-2026-08-27/claude_chats/edge-dev/projects/C--repos-shared-db*`.
- In-repo: `scripts/production_migration_guard.py` (`strip_sql`),
  `scripts/production_catalog_verification.py` (`derive_targets`),
  `scripts/check-pr-object-collisions.mjs`, `scripts/check-cancelled-work.mjs`,
  `scripts/check-migration-ledger-drift.mjs`.
