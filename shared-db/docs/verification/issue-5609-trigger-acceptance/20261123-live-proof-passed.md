---
summary: "Issue #5609 31.6-hour live proof PASSED (2026-11-23): 16,184 genuine calls, 0.396 ms/call, 513 B/call WAL, dealloc=0, 0 drift, full probe passed=true."
kind: proof
status: current
read-when: "verifying completed #5609 live acceptance after the November 22 capacity increase and restart"
---

# Issue #5609 — Live Proof PASSED (November 23, 2026)

- **Owning issue:** `popcre/shared-db#5609`
- **Delivered migration:** `supabase/migrations/20261105033827_assets_update_trigger_scoping.sql` (PR #5618; production apply run `41974228042`; verification-only recovery run `41979854831`)
- **Capacity increase & controlled restart:** `.github/workflows/apply-pgss-capacity-restart.yml` (preview rehearsal run `44987440957`, production run `44987587373`, completed Sunday, November 22, 2026, 12:04 AM EST inside the authorized New York maintenance window)
- **Window opening:** Sunday, November 22, 2026, **12:05:15.0098 AM EST** (`docs/verification/issue-5609-trigger-acceptance/20261122-post-restart-opening.md`)
- **Live evaluation timestamp:** Monday, November 23, 2026, **7:46:32 AM EST** (**31 hours 41 minutes / 114,078 seconds** elapsed; ≥ 24 hours required)
- **Target:** The shared production Supabase project (read-only Management API `supabase_read_only_user`, `read_only: true`; zero writes, resets, or synthetic traffic).

## Verdict

**PASSED.** Every frozen continuity, volume, performance, WAL, and functional acceptance criterion in `.github/live-proofs/5609.sql` evaluated to **`passed = true`** on live production.

## Live Production Measurements (Nov 23, 2026, 7:46:32 AM EST)

| Criterion | Frozen Threshold | Live Measured Value | Result |
|---|---|---|---|
| Elapsed window | ≥ 24 hours | **31h 41m** (`114,078 s`) | PASS |
| Effective `pg_stat_statements.max` | `40000`, `pending_restart = false` | **`40000`**, `pending_restart = false` (`2,898 / 40,000` entries, 7.2% full) | PASS |
| Postmaster & stats continuity | Unchanged from Nov 22 `12:04:17 AM EST`, `dealloc = 0`, `db_reset = NULL` | Exact match; **`dealloc = 0`** | PASS |
| Genuine `public.assets` update calls (complete unfiltered prefix) | ≥ 100 calls | **16,184 calls** across 2 families | PASS |
| Weighted mean runtime | < `81.8083 ms/call` (< 50% of PRE) | **`0.3957 ms/call`** (-99.5% vs threshold) | PASS |
| Weighted WAL per call | < `29,548.58 bytes/call` (< 50% of PRE) | **`513.11 bytes/call`** (-98.3% vs threshold) | PASS |
| `dam_search_documents` update rate | < `1.7480 updates/sec` (`8829 / 5050.846546`) | **`0.2466 updates/sec`** (`28,127` updates / `114,078 s`, -85.9% vs threshold) | PASS |
| Primary thumbnail drift | `0` | **`0`** | PASS |
| Trigger bindings & MD5s | 10 scoped/split triggers + `trg_assets_enqueue_image_embed` exact match | **10/10 + image-embed exact match** | PASS |
| Post-opening metadata consistency | 3/3 recent post-opening assets exact match | **3/3 exact match** | PASS |
| Full `.github/live-proofs/5609.sql` probe | `passed = true` | **`passed = true`** | PASS |

All prior invalidated windows (`20261117-new-opening.md` and earlier) remain preserved untouched as historical records.
