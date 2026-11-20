---
summary: "Nov 20 #5747 Step 3 decision: all six candidates KEEP (live readers found); no safe drops; close-out evaluated"
kind: proof
status: done
read-when: closing popcre/shared-db#5747 or reviewing the Nov 20 assets index decision
---

# public.assets Step 3 residual index decision and close-out (popcre/shared-db#5747)

Read-only re-measure on production `qsllyeztdwjgirsysgai` at **11:33 AM EST 2026-11-20**
(database clock `2026-11-20 11:33:35.735152-05`), Supabase Management API
`database/query` with `read_only: true` (token read from 1Password vault `vibe_coding`
via `op read`; value never printed). This reading is the Nov 20 decision the
[Nov 18 close-out](../20261118T1411Z/index-recheck-closeout.md) deferred to. The shared
pair (`idx_assets_tags`, `idx_assets_full_text_search`) remains #5610's single record and
is not duplicated here.

## Gate: PASSED

| Check | Required | Observed | Result |
|---|---|---|---|
| `pg_postmaster_start_time()` | 2026-11-06 11:20:19 AM EST | `2026-11-06 11:20:19.434455-05` | MATCH |
| `stats_reset` | NULL (no reset) | NULL | MATCH |
| Observable window | ≥ 14 days | 14 d 0 h 13 m (to `2026-11-20 11:33:35.735152-05`) | MET |

The window completed at 2026-11-20 11:25:52 AM EST as planned. No restart occurred.
Keep/drop decisions are authorized.

## Totals at the reading

| Measure | Nov 18 (9:11 AM EST) | This reading (11:33 AM EST Nov 20) |
|---|---|---|
| Heap | 408,748,032 B (390 MB) | 408,748,032 B (390 MB) |
| Indexes | 879,763,456 B (839 MB) | 881,713,152 B (841 MB) |
| Rows (`n_live_tup`) | 187,811 | 188,254 |
| Index / constraint / user trigger count | 46 / 8 / 26 | 46 / 8 / 26 |
| Inserts / updates / HOT updates (since Nov 6) | 30,460 / 674,722 / 658 | 30,997 / 714,285 / 716 |

## The six residual candidates: all KEEP

The Nov 18 reading identified six zero-scan residual candidates (38,969,344 B). Today's
reading shows one gained scans; the other five remain zero-scan but each has a confirmed
reader in the refreshed nine-consumer proof. **No candidate qualifies for drop.**

### 1. idx_assets_compat_audit — KEEP (active scans)

- Size: 3,563,520 B; **scans: 260** (was 0 on Nov 18); last scan 2026-11-18 6:35 PM EST
- Definition: `btree (id) WHERE (file_type = 'ai' AND is_deleted = false AND thumbnail_url IS NOT NULL)`
- Any index with scans in the trustworthy interval is KEEP per plan Step 3 rules.
  The ai-sentinel stats reader (`20260702220336_ai_sentinel_stats_exact_match.sql`) is now
  actively exercising this index.

### 2. idx_assets_pdf_not_deleted — KEEP (confirmed reader)

- Size: 12,959,744 B; scans: 0; definition: `btree (file_type, id) WHERE (is_deleted = false)`
- **Reader proof (nine-consumer, refreshed 2026-11-20):**
  - popdam3 `src/hooks/useAssets.ts:193` — `query.in("file_type", filters.fileType)` on
    `from("assets")` with `.eq("is_deleted", false)` (line 171) — exact index predicate
  - popdam3 `apps/worker/src/handlers/ai-tagging-shared.ts:551` —
    `.from("assets")…eq("file_type","pdf").eq("is_deleted",false)`
  - popdam3 `supabase/functions/agent-api/index.ts:4228,4397,4520` — `.eq("file_type","ai")`
  - popdam3 `supabase/functions/admin-api/index.ts:1635` — `.eq("file_type","pdf")`
  - popdam3 `supabase/functions/_shared/admin-handlers/ai-sentinel-handlers.ts:80,153,253,261`
  - shared-db `filter_effective_assets`, `dam_asset_matches_filters`,
    `get_filter_counts_unchecked_1703` — `file_type` filter on non-deleted assets
  - shared-db migrations: `20260702220336` (`file_type='ai' and is_deleted=false`),
    `20261103142609`, `20260923173715` (`file_type='pdf' and is_deleted=false`)
  - Other 8 consumer repos: no app-code readers (generated types only)
- Constraint: none. Vector protection: none. Planned-use: none needed — live reader exists.

### 3. idx_assets_ai_tagged_at — KEEP (confirmed reader)

- Size: 10,584,064 B; scans: 0; definition: `btree (ai_tagged_at) WHERE (ai_tagged_at IS NOT NULL)`
- **Reader proof (nine-consumer, refreshed 2026-11-20):**
  - popdam3 `supabase/functions/_shared/admin-handlers/ai-tagging-handlers.ts:23` —
    `.not("ai_tagged_at", "is", null)` — exact partial-index predicate
  - popdam3 `apps/worker/src/handlers/ai-tagging.ts:230,1005,1186` — skip-logic reads
  - popdam3 `supabase/functions/admin-api/index.ts:1369` — projection
  - shared-db `20260714180000_ai_tagging_keyset_candidates.sql:24,87` — keyset cursor
  - shared-db `20260826144047` — `ORDER BY primary_sort_tier, ai_tagged_at`
  - Other 8 consumer repos: no app-code readers
- Constraint: none. Positive KEEP: none. Reader exists.

### 4. idx_assets_product_material_gin — KEEP (confirmed GIN reader)

- Size: 4,521,984 B; scans: 0; definition: `gin (product_material)`
- **Reader proof (nine-consumer, refreshed 2026-11-20):**
  - popdam3 `src/hooks/useAssets.ts:204` — `query.overlaps("product_material", filters.productMaterial)`
    — PostgREST `overlaps` = `&&`, the GIN overlap operator. **This corrects the Nov 18
    preliminary note ("no @>/&&/? found"): the GIN reader exists.**
  - popdam3 `src/test/effective-asset-filtering.test.ts:256` — asserts the overlaps call
  - shared-db `filter_effective_assets` L122 — `a.product_material && array(...)` (direct table-level GIN operator)
  - shared-db `get_effective_filter_counts_unchecked_1703` — same `&&` pattern
  - shared-db `dam_asset_matches_filters` L15 — `p_product_material && array(...)`
  - shared-db `get_dam_material_facets` — `unnest(a.product_material)` (reads column)
  - ~25 shared-db filter/count functions use `product_material && array(...)`
  - Index creation comment: "Speeds the sidebar's Material filter" (`20260715214500`)
  - Other 8 consumer repos: no app-code readers (2 false positives excluded)
- Constraint: none. Vector protection: none. Reader exists.

### 5. idx_assets_stage — KEEP (confirmed reader)

- Size: 4,014,080 B; scans: 0; definition: `btree (stage)`
- **Reader proof (nine-consumer, refreshed 2026-11-20):**
  - popdam3 `src/hooks/useAssets.ts:182` — `query.in("stage", filters.stage)` on `from("assets")` —
    planner previously chose this index (per Nov 18 delta record)
  - shared-db `filter_effective_assets` — `a.stage in (select jsonb_array_elements_text(...))`
  - shared-db `dam_asset_matches_filters` — `p_stage` parameter
  - shared-db `get_filter_counts_unchecked_1703` — `v_stages` filter
  - shared-db migrations: `20260911045353`, `20260831044913`, `20261105042549`, `ci-bootstrap/010`
  - Other 8 consumer repos: no app-code readers
- Constraint: none. Reader exists.

### 6. idx_assets_workflow_status — KEEP (confirmed reader)

- Size: 3,858,432 B; scans: 0; definition: `btree (workflow_status)`
- **Reader proof (nine-consumer, refreshed 2026-11-20):**
  - popdam3 `src/hooks/useAssets.ts:209-210` — `query.in("workflow_status", filters.workflowStatus)`
  - popdam3 `migration/migration-schema.sql:951-963` — `get_filter_counts` body:
    `SELECT workflow_status FROM assets WHERE is_deleted=false AND workflow_status IS NOT NULL GROUP BY workflow_status`
  - popdam3 `supabase/functions/_shared/admin-handlers/metadata-handlers.ts:126,159-160`
  - popdam3 `supabase/functions/agent-api/index.ts:1195,1277,1329,1577,1645`
  - shared-db `filter_effective_assets`, `dam_asset_matches_filters`,
    `get_filter_counts_unchecked_1703` — `workflow_status` filter
  - shared-db `20260827183011` and ~12 other filter-count migrations — `workflow_status::text = any(...)`
  - Other 8 consumer repos: no app-code readers
- Constraint: none. Reader exists.

## Nine-consumer search method

All nine sync-matrix consumers were searched (popcrm-web, popdam3, poppim-web,
designflow-bff, -frontend, -backend, -item-master, -tracking, -data-syncing). `gh search
code` proved unusable for the three `u2giants/*` repos (not indexed) and hit HTTP 403
rate limits; all nine were instead shallow-cloned and grepped locally with ripgrep for
complete coverage. `shared-db/` mirror folders inside consumer repos were excluded from
per-repo counts. Production functions, views, and RLS policies were queried read-only.
A failed or inaccessible search is missing evidence, never a no-reader result.

## Growth note

Total index bytes: 335 MB (Nov 5) → 658 MB (Nov 8) → 825 MB (Nov 12) → 836 MB (Nov 16) →
839 MB (Nov 18) → **841 MB (now)**. Growth remains plateaued (+2 MB in 2 days). The weekly
health check (`db-bloat-weekly.yml`, #5886) continues to watch heap/live.

## Step 3 disposition tally (46 indexes)

- **38 KEEP** (including 2 constraint-backed, 1 positive decision #6011, 6 now with reader proof)
- **2 out-of-scope** → #5610 shared pair (`idx_assets_tags`, `idx_assets_full_text_search`)
- **0 drop candidates** — the completed audit proves there are no safe drops

This satisfies the plan's Step 3 completion condition: "every `assets` inventory entry has
a recorded keep/drop/out-of-scope disposition" and "a completed audit proves there are no
safe drops." No migration is needed.

## §13 close-out evaluation

| §13 item | Status | Evidence |
|---|---|---|
| heap ≤ 400 MB | MET | 390 MB; byte-identical Nov 12 → Nov 16 → Nov 18 → now |
| heap ≤ 2x live bytes for 7 days | MET | 1.82 (limit 2.0) at every reading since Nov 12 |
| HOT ratio ≥ 70% | RETIRED by recorded evidence | Remaining writes change GIN-indexed `tags`; retired with the daily bloat job (plan Step 6; recorded on #5747) |
| broad-search total < 3 s; Search test set typical < 3 s, unchanged pass count | MET (last scored run) | u2giants/popdam3 run 43355019011 (Nov 12): PopDAM 119/119, p50 1.0 s, p95 2.2 s |
| all PRs merged | MET | PR #6682 (Nov 18 re-check) merged 2026-11-18; this record's PR merges with it |
| migrations promoted; popdam3 writers deployed | MET | Recorded in plan STATUS Steps 1–5 |
| STATUS table updated with artifacts | MET (this PR) | Step 3 row updated with this record |
| handoff updated | MET (this PR) | Handoff updated in the same PR |
| Step 3 complete | MET | Completed audit: 38 KEEP + 2 out-of-scope + 0 drops; every entry has a disposition; no removals needed |

**Close-out verdict: all §13 checks pass. #5747 may close with live proof.**

No production object was changed. All reads used `read_only: true`.
