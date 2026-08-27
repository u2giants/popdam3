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

## Why it exists

The owner reviewed the recorded Claude sessions for this repository on 2026-08-27
and asked why issues take so long to clear, citing the #1645 case where a safety
scanner reported a table as missing and blamed a hard-blocked migration, when
production had held that table since 25 August — the `CREATE TABLE` was inside a
dollar-quoted block the scanner removes by design.

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
