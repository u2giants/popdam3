

# Holistic Codebase Review — Assessment & Staged Plan

---

## Point-by-Point Evaluation

### 1A. admin_config JSON "God Object" — BULK_OPERATIONS
**A) Agree with the problem?** Partially. The lost-update risk is real in theory, but the current code already mitigates it heavily. `bulk-job-runner` does read-modify-write with re-reads before every persist (lines 500-529 and 646-686). The UI and runner are the only two writers, and cron ensures only one runner invocation at a time. ERP Sync and Windows Agent do NOT write to BULK_OPERATIONS — they have their own tables (`erp_sync_runs`, `render_queue`). So the actual collision surface is UI ↔ runner, which the re-read pattern handles adequately.

**C) Agree with the solution?** No — a dedicated `job_queue` table is over-engineering for this use case. The current system has exactly 8 operation keys, one runner, and one UI. A table migration would require rewriting `usePersistentOperation`, `bulk-job-runner`, every section of `DiagnosticsTab`, and the queue manager — massive blast radius for marginal safety gain.

**D) What I'd do instead:** Add a Postgres advisory lock (`pg_advisory_xact_lock`) inside a small RPC that does the read-modify-write atomically. This eliminates the theoretical race window with zero schema migration and zero UI changes. One new DB function, one change in `bulk-job-runner`.

---

### 1B. Unbounded External API Calls in Edge Functions
**A) Agree?** Yes. The `ai-tag` function calls the AI gateway with no timeout. If it hangs, the Supabase 60s hard limit kills the function and no cleanup runs. The `erp-sync` already has `AbortSignal.timeout(120_000)` (line 124), but 120s exceeds the edge function limit itself — so that's also broken.

**C) Agree with the solution?** Yes, `AbortController` with 15-20s timeout is correct.

**D) Refinement:** `ai-tag` needs `AbortSignal.timeout(20_000)` on its AI gateway fetch. `erp-sync` needs its 120s reduced to ~45s. The `admin-api` AI classification calls (line 4893-4928) also need the same treatment.

---

### 1C. Agent Concurrency Collisions
**A) Agree?** No. The bridge-agent scans `.psd`/`.ai` files on the NAS filesystem. The windows-agent does NOT scan — it only claims render jobs from `render_queue` using `FOR UPDATE SKIP LOCKED` (the `claim_render_jobs` RPC). They cannot overlap. The bridge-agent's scan roots are configured per-agent and validated at startup. There is no scenario where both agents duplicate hasher workloads.

**B) Why not?** The architecture explicitly separates concerns: bridge-agent scans + hashes + thumbnails, windows-agent renders. They share no code paths for scanning. The `render_queue` table already implements the lease system you're proposing.

---

### 2A. Database Indexing
**A) Agree?** The concern is valid in general, but the codebase already has comprehensive indexes. From the migrations:
- `idx_assets_status` (B-tree on `status`)
- `idx_assets_style_group_id` (B-tree on `style_group_id`)
- `idx_assets_tags` (GIN on `tags`)
- `idx_assets_filename_trgm`, `idx_assets_relative_path_trgm` (trigram for search)
- `idx_assets_primary_sort_tier` (composite, just added)
- Plus indexes on `file_type`, `workflow_status`, `is_licensed`, `modified_at`, `file_created_at`, `licensor_id`, `property_id`, `quick_hash`, `is_deleted`

**C) Solution needed?** No — this is already well-indexed. No action required.

---

### 2B. Parallel Processing in Local Agents
**A) Agree?** Partially. The windows-agent processes render jobs sequentially, but its concurrency is controlled by `WINDOWS_AGENT_RENDER_CONCURRENCY` config and the `claim_render_jobs` batch size. The bridge-agent similarly processes files sequentially during scan.

**C) Agree with the solution?** Not for this project. The agents run on resource-constrained hardware (Synology NAS / a Windows workstation also doing other work). The PROJECT_BIBLE explicitly says the worker must be "resource-bounded (CPU/memory limits + low concurrency)." Parallelizing thumbnail generation on a Synology would thrash its weak CPU and risk OOM-killing the container. The Windows agent processes AI/PSD files through external processes (Ghostscript, Inkscape, ImageMagick) that are already heavy. This is intentional.

---

### 2C. Switch from Polling to Realtime
**A) Agree with the inefficiency?** Partially. `usePersistentOperation` polls every 3s when active, 30s when idle. The queue manager polls every 5s. The diagnostics page uses `react-query` with its own refetch interval. That's 3 separate polling loops hitting the same `admin_config` row.

**C) Agree with the solution?** No — Supabase Realtime on `admin_config` would fire on every config key change (scan config, agent keys, etc.), not just BULK_OPERATIONS. And Realtime doesn't support filtering by row value. The polling volume is minimal (one lightweight SELECT per interval) and the admin dashboard has 1-2 concurrent users at most. The engineering cost of Realtime subscriptions (connection management, reconnection, cleanup) exceeds the benefit.

**D) What I'd do instead:** Consolidate the 3 polling loops into one. Create a single `useBulkOperationsState()` hook with React Context that polls once and distributes state to all consumers. This eliminates 2/3 of the polling with zero infrastructure changes.

---

### 3A. Component Bloat — DiagnosticsTab.tsx
**A) Agree?** Absolutely. `DiagnosticsTab.tsx` is 1,514 lines. It contains 12+ inner components, queue management logic, conflict dialog state, polling, and API calls all in one file.

**C) Agree with the solution?** Yes. Extract into:
- `QueueManagerDialog.tsx`
- `ConflictDialog.tsx`
- `ActionsSection.tsx`
- `AiTaggingSection.tsx`
- `StyleGroupsSection.tsx`
- `OverviewCards.tsx`
- Keep `DiagnosticsTab.tsx` as the orchestrator (~200 lines)

---

### 3B. Strict Typing for API Contracts
**A) Agree?** Yes. The `as any` audit found 40 matches across edge functions. `bulk-job-runner` uses `OpState` with `status: string` instead of a union type. `admin_config` value parsing is littered with `(wm.value as any)?.value`.

**C) Agree with the solution?** Yes, with scope control. Define shared types in `_shared/types.ts` for: `OpState`, `AdminConfigValue`, `BulkOperationKey`. The frontend equivalents already exist in `usePersistentOperation.ts` — extract and share the shape.

---

### 3C. Shared Utility Duplication
**A) Agree?** Yes. The `json()` and `corsHeaders` pattern is copy-pasted across 7 edge functions. That's the most obvious duplication.

**C) Agree with the solution?** Yes. Move `json()`, `err()`, and `corsHeaders` into `_shared/http.ts`. Import from there in all functions.

---

## Additional Issues I Found

### 4. admin-api is 4,982 lines
This is the most critical structural problem. A single edge function file with ~50 action handlers, each essentially a mini-API. This makes it impossible to test, review, or modify safely. Any syntax error in one handler crashes all admin functionality.

### 5. erp-sync timeout is set to 120s but edge function limit is 60s
Line 124: `AbortSignal.timeout(120_000)` — this timeout can never fire because Supabase will kill the function at 60s first. This is a silent bug.

### 6. Duplicate admin_config value unwrapping
The pattern `(wm.value as any)?.value ?? wm.value` appears in at least 4 places across `erp-sync`, `admin-api`, and `bulk-job-runner`. This should be a shared utility.

---

## Staged Implementation Plan

### Stage 1: Zero-risk cleanup (no behavior changes)
1. Extract shared edge function utilities into `_shared/http.ts` (corsHeaders, json, err)
2. Extract shared `adminConfigValue()` unwrapper into `_shared/config-utils.ts`
3. Add `AbortSignal.timeout(20_000)` to `ai-tag` AI gateway fetch
4. Fix `erp-sync` timeout from 120s → 45s
5. Add timeout to `admin-api` AI classification fetch calls

### Stage 2: DiagnosticsTab decomposition (UI only)
1. Extract `QueueManagerDialog.tsx`, `ConflictDialog.tsx`
2. Extract `ActionsSection.tsx`, `AiTaggingSection.tsx`, `StyleGroupsSection.tsx`
3. Create `useBulkOperationsState()` context to consolidate polling
4. Reduce `DiagnosticsTab.tsx` to orchestrator (~200 lines)

### Stage 3: Type hardening
1. Create `_shared/types.ts` with `OpState`, `BulkOperationKey` union, `AdminConfigValue`
2. Replace `as any` casts in `bulk-job-runner` and `admin-api` with proper types
3. Add `OpState.status` as a string union in the edge function

### Stage 4: Atomic config writes (if Stage 1-3 are stable)
1. Create `update_bulk_operation` RPC with advisory lock for atomic read-modify-write
2. Update `bulk-job-runner` to use the RPC instead of direct upsert
3. Update `usePersistentOperation` to use the RPC

### Stage 5: admin-api decomposition (high-risk, do last)
1. Group related handlers into logical modules within the single file (since Supabase edge functions must be single-file)
2. Extract business logic into `_shared/` helpers where possible
3. This is the highest-risk stage — do only after Stages 1-4 are stable

