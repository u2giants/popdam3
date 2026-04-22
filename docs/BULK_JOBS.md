# Bulk Job System

Bulk operations are orchestrated by a **persistent Node.js worker running on Railway** (`apps/worker/`), not by the `bulk-job-runner` Supabase edge function. The edge function is a deployed no-op stub kept for backward compatibility (see quirk #19 in [docs/KNOWN_QUIRKS.md](KNOWN_QUIRKS.md)).

The worker polls `admin_config.BULK_OPERATIONS` every **5 seconds**. When it finds an operation with `status: "running"`, it claims a batch, processes it, writes progress back, and loops. It has no timeout constraint — it runs until the operation completes, the user stops it, or it errors. The pg_cron schedule that previously called the edge function every minute was removed in migration `20260322000000`.

**Authoritative code locations:**
- Orchestrator: `apps/worker/src/` (Railway)
- Operation definitions: `supabase/functions/_shared/operation-constants.ts`
- Per-operation handlers: `supabase/functions/_shared/admin-handlers/`

---

## Job Inventory

| Key | Lane | Tables written | Trigger |
|-----|------|---------------|---------|
| `ai-tag-untagged` | ai-tagging | assets, asset_tags, asset_characters | manual |
| `ai-tag-all` | ai-tagging | assets, asset_tags, asset_characters | manual |
| `ai-tag-groups` | ai-tagging | assets, asset_tags, asset_characters | manual |
| `propagate-group-tags` | style-groups | assets, asset_tags, asset_characters | manual |
| `rebuild-style-groups` | style-groups | assets (style_group_id), style_groups | manual |
| `reconcile-style-group-stats` | style-groups | style_groups | manual / auto-queued after rebuild |
| `reprocess-metadata` | metadata | assets (licensor_id, property_id, is_licensed, workflow_status, SKU fields) | manual |
| `backfill-sku-names` | metadata | assets, style_groups (licensor/property codes) | manual |
| `erp-enrichment` | erp | assets, style_groups (ERP codes) | manual |
| `erp-classify` | erp | product_category_predictions | manual |

---

## Lane System

Jobs in the **same lane** are automatically serialized — the runner will not promote a queued job until the running job in that lane finishes or is stopped.

Jobs in **different lanes** may run in parallel, subject to the conflict map below.

---

## Cross-Lane Conflict Map — READ THIS BEFORE ADDING JOBS

**Location:** `OP_CONFLICTS` in `supabase/functions/_shared/operation-constants.ts`

Some jobs in *different* lanes write to the same database rows. Running them at the same time causes row-lock contention, which can trigger PostgreSQL `statement timeout` errors (error code 57014) and interrupt both jobs.

**Do not run conflicting jobs simultaneously.** The system enforces this automatically (see "How enforcement works" below), but you need to keep the map up to date if you add new jobs.

### Current conflict pairs

| Jobs | Why they conflict |
|------|------------------|
| `ai-tag-*` ↔ `propagate-group-tags` | Both write `asset_tags`, `asset_characters`, and `assets`. The `UPDATE assets` was fixed with `FOR UPDATE SKIP LOCKED`, but `INSERT INTO asset_tags/asset_characters` still experiences speculative-insert index locks when both jobs try to insert the same `(asset_id, tag)` pair simultaneously — one waits for the other to commit. Across many groups this accumulates past the 120 s statement timeout. **Lock contention risk.** |
| `ai-tag-*` ↔ `rebuild-style-groups` | Rebuild clears `style_group_id` on every asset then reassigns it. AI tagging reads `style_group_id` to scope tag propagation — if rebuild is mid-run, tags propagate to the wrong group or are lost entirely. **Data integrity risk.** |
| `ai-tag-*` ↔ `reprocess-metadata` | Both write `licensor_id`, `property_id`, `is_licensed`, and `workflow_status` on `assets`. Last-writer-wins data races. **Data integrity risk.** |
| `reprocess-metadata` ↔ `erp-enrichment` | Both write overlapping asset metadata columns. **Data integrity risk.** |
| `backfill-sku-names` ↔ `erp-enrichment` | Both write licensor/property code columns on `assets` and `style_groups`. **Data integrity risk.** |

### Incident history: ai-tag-* ↔ propagate-group-tags

**2026-04-01 incident:** Both jobs ran concurrently. `UPDATE assets` in `propagate_group_tags_batch` waited on row locks held by ai-tag → 120 s timeout. Fix: added `FOR UPDATE SKIP LOCKED` via `claimable_for_meta` CTE (migration `20260405000000`). Conflict removed from `OP_CONFLICTS` prematurely.

**2026-04-05 incident:** Jobs ran simultaneously again (6 seconds apart). `FOR UPDATE SKIP LOCKED` protected `UPDATE assets`, but `INSERT INTO asset_tags ON CONFLICT DO NOTHING` still blocks at the B-tree index level when two transactions try to insert the same `(asset_id, tag)` pair — PostgreSQL takes a speculative insertion lock on the index tuple and the second inserter waits for the first to commit. Across many groups these waits accumulated past 120 s. Fix: conflict restored to `OP_CONFLICTS`.

### How enforcement works

The conflict map is checked in **four** places:

1. **UI — `requestOp` function** (`AiTaggingTab.tsx`, `OperationsTab.tsx`): Before starting any job, the UI fetches the current `BULK_OPERATIONS` state and checks both same-lane conflicts and cross-lane `OP_CONFLICTS`. If a conflict is detected (running or queued), a **ConflictDialog** is shown giving the user the option to queue the new job to run automatically after the conflicting one finishes. This prevents the race before it ever reaches the server. The frontend `OP_CONFLICTS` map lives in `src/components/settings/diagnostics/types.ts` — keep it in sync with the backend copy in `operation-constants.ts`.
2. **Railway worker — queue promotion:** A queued job will not be promoted to `running` if a conflicting job is already running. It stays queued and is reconsidered on the next 5-second poll.
3. **Railway worker — auto-resume:** An interrupted job will not be auto-resumed if a conflicting job is running. The cooldown timer still counts down; it will resume once the conflict clears.
4. **`admin-api` — `update-bulk-op` route:** If anything tries to set a job to `running` or `queued` while a conflicting job is running, the API returns HTTP 409 with a message explaining which job is blocking it. This is the last line of defence if the UI check is bypassed.

### How to add a new job

1. Add the new job's key and lane to `OP_LANES` in **both**:
   - `supabase/functions/_shared/operation-constants.ts` (backend)
   - `src/components/settings/diagnostics/types.ts` (frontend)
2. Identify every table the new job writes to. Check the table against the "Tables written" column above.
3. If any existing job writes the same table, add symmetric entries to `OP_CONFLICTS` in **both** files:
   ```typescript
   "new-job-key":    ["existing-job-that-shares-table"],
   "existing-job":   [...existingConflicts, "new-job-key"],
   ```
4. Add the handler to `OP_ACTIONS` and the appropriate admin-handler file.
5. Update the job inventory table above.
6. Update this doc.

---

## Auto-Resume

Interrupted jobs are automatically retried after a 30-second cooldown. The runner tracks `auto_resume_attempts` and gives up after a per-operation maximum:

| Job | Max auto-resume attempts |
|-----|------------------------|
| `erp-classify` | 1000 (long-running, frequent gateway timeouts at scale) |
| `propagate-group-tags` | 50 |
| All others | 5 |

Jobs interrupted with `interruption_reason_code: "user_stop"` are **never** auto-resumed — that respects an explicit operator stop.

---

## State Storage

All job state lives in a single `admin_config` row with `key = 'BULK_OPERATIONS'`. The value is a JSON object keyed by operation name. Each operation's state includes:

```
status          running | queued | interrupted | completed | failed
cursor          numeric offset or UUID cursor string
progress        operation-specific counters
error           last error message
interruption_reason_code  why it was interrupted
run_id          UUID for this run (changes on fresh start)
auto_resume_attempts
started_at / updated_at
```

State is written atomically via the `update_bulk_operation` RPC, which supports an optimistic `p_only_if_status` guard to prevent a stale write from overwriting a user stop.

---

## Time Budget

The Railway worker has no hard invocation timeout — it runs continuously. For safety, each individual batch processes at most **45 seconds** worth of work (`MAX_RUN_MS`). When the budget is exhausted, the cursor is saved and the worker's main loop picks it up on the next 5-second poll. The worker processes one operation per loop iteration (round-robin among running ops, oldest-updated-at first).

---

## RPC-Direct Operations

`propagate-group-tags` and `reconcile-style-group-stats` bypass the `admin-api` HTTP layer entirely and call PostgreSQL functions directly via `db.rpc()`. This eliminates one network hop and avoids Supabase Edge Function rate limits for these high-frequency batch operations.

The PostgreSQL function `propagate_group_tags_batch` runs with `SET statement_timeout = '120s'`. Each call processes up to 200 style groups in a single transaction. If a batch takes longer than 120 s (e.g., due to a very large group or lock contention), PostgreSQL cancels the statement and the runner marks the job interrupted for auto-resume.

### propagate-group-tags progress counter

The `propagated` counter in the progress object counts **groups visited**, not individual tag or character rows inserted. This matters because the UI divides `propagated / total` to show a percentage, and `total` is also a group count. A previous version of `propagate_group_tags_batch` accumulated `(inserted_tags rows) + (inserted_chars rows)` per group — a group with 2 siblings × 10 tags would add 20 to `propagated`, causing it to exceed `total` and display nonsensical progress like "14,775 / 9,751 (100%)". Fixed in migration `20260406000000`.
