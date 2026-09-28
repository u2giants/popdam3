# Ledger drift status — issue #2508

**Date:** 2026-09-25 (2:22 AM EDT)
**Scope:** detection/reporting tooling and documentation. No production apply.
**Work type:** repo-maintenance / non-orchestrator.

## What the failed alarm said

The scheduled `Migration Ledger Drift` run failed against production because
migrations are **merged to `main` and not applied** (case 1 of the three the
alarm body names). It is not a tooling failure (that would be exit 2 / "COULD
NOT RUN") and not an orphan-ledger-row case.

Evidence: run
[36102579956](https://github.com/popcre/shared-db/actions/runs/36102579956)
at main `4b74a86965e937917a99d05fd5e427b7ac4388b3`, 2:22 AM EDT on 2026-09-25.

## Current drift state

| metric | count |
|---|---|
| merged on `origin/main` | 706 |
| applied in `supabase_migrations.schema_migrations` | 676 |
| **genuinely-pending (actionable)** | **6** |
| retired / deliberately-held (listed, non-actionable) | 23 |
| foreign-target (listed, non-actionable) | 1 |
| orphan ledger rows | 0 |

### Promotion candidates — 6 genuinely-pending versions

| version | commit reference (PR or issue; unverified) | file |
|---|---|---|
| `20260911212849` | #2746 | `20260911212849_shared_style_group_sku_key.sql` |
| `20260914061331` | #2882 | `20260914061331_classify_dcp_inventory_families.sql` |
| `20260917112129` | #2846 | `20260917112129_shared_style_group_sku_key.sql` |
| `20260920202755` | #3382 | `20260920202755_hts_rag_classification_jobs.sql` |
| `20260923040630` | #3426 | `20260923040630_popdam_definitive_rejection_lease_reset.sql` |
| `20260923173715` | #3301 | `20260923173715_pdf_backfill_indexed_candidates.sql` |

Each version needs a production apply through the bounded Shared Supabase
Migrations workflow. That lane is the orchestrator's single production lane.
**No production action was taken by this session.**
The references above were recovered from historical commit subjects; this
snapshot does not independently prove that each number names a PR. Re-run the
drift check and reporter for current counts and attribution before quoting it.

The 23 retired/deliberately-held versions and 1 foreign-target version are
listed in the check output for visibility but do not make the check fail. The
live catalog is not proof that work was never done (issue #892).

## What this change adds

`scripts/report-ledger-drift-status.mjs` turns a `check-migration-ledger-drift
--json` result into an issue-comment-ready status report with per-version PR
attribution recovered from git first-parent history. It is read-only: no
database write, no workflow dispatch, no production touch.

Usage in Bash (both commands preserve the check's drift exit status):

    set -o pipefail
    node scripts/check-migration-ledger-drift.mjs --target production --json \
      | node scripts/report-ledger-drift-status.mjs --json -

Tests: `node --test scripts/report-ledger-drift-status.test.mjs`.

## Issue #2508 disposition

**Stays OPEN — blocked on production applies.** The six genuinely-pending
versions above must each be promoted through the bounded workflow before the
drift check exits clean. Holder: the orchestrator's production lane (or an
authorized production-capable session). This session's work is detection and
reporting only.

Posted by MiMo chat unknown on edge-dev
