# Plan: Move Bulk Operations to Database Functions + Supabase Migration

## Part 1: Database Functions for Bulk Operations

### ✅ 1A. `propagate_group_tags_batch` — DONE

Created plpgsql function that replaces `tag-propagation.ts` + `tag-propagation-handlers.ts`:
- Keyset pagination on `style_groups.id` with `p_cursor uuid, p_batch_size int`
- Finds source asset (primary if tagged, else first tagged by `primary_sort_tier`)
- Set-based tag propagation via `INSERT ... ON CONFLICT DO NOTHING`
- Character propagation via same pattern
- Metadata fill-nulls via single UPDATE with COALESCE
- FILE_SPECIFIC_TAGS exclusion hardcoded in temp table
- `statement_timeout = 120s`
- Handler simplified to thin `db.rpc()` wrapper
- `bulk-job-runner` calls `db.rpc()` directly (bypasses admin-api HTTP entirely)
- Inter-call delay reduced to 100ms (was 500ms)

Expected: 200 groups/batch, ~2-5s per call, 8,342 groups in ~2-4 minutes total.

### ✅ 1B. `rebuild_style_groups_batch` — DONE

### ✅ 1C. `reconcile_style_group_stats_batch` — DONE

Created plpgsql wrapper function that handles keyset pagination over style_groups:
- Accepts `p_cursor uuid, p_batch_size int, p_sub text` ('counts' or 'primaries')
- Calls existing `refresh_style_group_counts_batch` and `refresh_style_group_primaries` internally
- Returns `(next_cursor, processed, sub, done)` with automatic sub-stage transitions
- Handler simplified to thin `db.rpc()` wrapper
- `bulk-job-runner` calls `db.rpc()` directly (bypasses admin-api HTTP entirely)
- Inter-call delay reduced to 100ms (was 1000ms)

### ✅ 1D. Simplify `bulk-job-runner` — DONE (all three operations now use direct RPC)

---

## Part 2: Migration to Own Supabase — DEFERRED (waiting for Part 1 to stabilize)
