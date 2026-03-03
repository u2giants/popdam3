# ERP Enrichment Pipeline — Implementation Plan

## Overview

Add an ERP-driven enrichment pipeline to PopDAM that:
1. Ingests product data from the DesignFlow ERP API
2. Maps SKU/MG codes to product attributes using deterministic rules
3. Classifies legacy items (missing `mgCategory`) into 7 product categories using AI
4. Applies enrichment to existing `assets` and `style_groups` records
5. Provides admin UI for configuration, monitoring, and review

---

## Phase 1: Schema — ERP Staging & Mapping Tables

### New Tables (via migration)

#### `erp_items_raw`
Immutable audit snapshots of every ERP API response row.
```
id              uuid PK DEFAULT gen_random_uuid()
external_id     text NOT NULL          -- ERP item identity (e.g. styleNumber or itemCode)
raw_payload     jsonb NOT NULL         -- full ERP row as-is
sync_run_id     uuid FK erp_sync_runs(id)
fetched_at      timestamptz DEFAULT now()
```
Index: `btree(external_id)`, `btree(sync_run_id)`

#### `erp_items_current`
Latest normalized row per ERP item. Upserted on each sync.
```
id                  uuid PK DEFAULT gen_random_uuid()
external_id         text UNIQUE NOT NULL
style_number        text                -- parsed/normalized SKU
item_description    text
mg_category         text                -- from ERP (null for legacy items)
mg01_code           text
mg02_code           text
mg03_code           text
size_code           text
licensor_code       text
property_code       text
division_code       text
erp_updated_at      timestamptz         -- ERP's own last-modified
synced_at           timestamptz DEFAULT now()
sync_run_id         uuid FK erp_sync_runs(id)
source_system       text DEFAULT 'designflow'
created_at          timestamptz DEFAULT now()
updated_at          timestamptz DEFAULT now()
```
Indexes: `btree(style_number)`, `btree(mg_category)`, `btree(synced_at)`

#### `erp_sync_runs`
Job metadata for each sync execution.
```
id              uuid PK DEFAULT gen_random_uuid()
status          text NOT NULL DEFAULT 'running'   -- running, completed, failed
started_at      timestamptz DEFAULT now()
ended_at        timestamptz
total_fetched   int DEFAULT 0
total_upserted  int DEFAULT 0
total_errors    int DEFAULT 0
error_samples   jsonb DEFAULT '[]'
run_metadata    jsonb DEFAULT '{}'       -- watermark, mode, etc.
created_by      text                     -- 'admin-ui', 'cron', 'bulk-job-runner'
```

#### `product_category_predictions`
AI classification results for legacy items missing `mgCategory`.
```
id                  uuid PK DEFAULT gen_random_uuid()
erp_item_id         uuid FK erp_items_current(id) ON DELETE CASCADE
external_id         text NOT NULL
predicted_category  text NOT NULL        -- one of 7 categories
confidence          real NOT NULL        -- 0.0–1.0
rationale           text                 -- short AI explanation
classification_source text NOT NULL      -- 'erp', 'rule', 'ai'
ai_model            text                 -- e.g. 'google/gemini-3-flash-preview'
ai_prompt_version   text                 -- e.g. 'v1'
status              text DEFAULT 'pending' -- pending, approved, rejected, auto_applied
reviewed_by         uuid                 -- admin who approved/rejected
reviewed_at         timestamptz
input_context       jsonb                -- what was sent to AI
created_at          timestamptz DEFAULT now()
```
Index: `btree(status)`, `btree(erp_item_id)`

#### `erp_enrichment_log`
Per-field provenance tracking for applied enrichments.
```
id              uuid PK DEFAULT gen_random_uuid()
target_type     text NOT NULL           -- 'asset' or 'style_group'
target_id       uuid NOT NULL
field_name      text NOT NULL
old_value       text
new_value       text
source          text NOT NULL           -- 'erp', 'rule', 'ai', 'manual'
confidence      real
run_id          uuid
applied_at      timestamptz DEFAULT now()
```
Index: `btree(target_id)`, `btree(run_id)`

### RLS Policies
- All new tables: admin-only write, authenticated read
- `erp_items_raw`: admin read-only (no browser exposure of full payloads)

---

## Phase 2: ERP Sync Edge Function (`erp-sync`)

### Endpoint
`POST /functions/v1/erp-sync` (called by admin-api or bulk-job-runner)

### Logic
1. Create `erp_sync_runs` row with status='running'
2. Fetch `https://api.item.designflow.app/lib/getApiAllItems`
   - No auth required
   - Full dataset returned in single response (no pagination from API)
   - Response is a JSON array of items
3. Validate response shape with Zod
4. For each item:
   - Insert into `erp_items_raw` (immutable snapshot)
   - Upsert into `erp_items_current` (keyed on `external_id`)
5. Update `erp_sync_runs` with counts
6. Support batched processing (100 items per DB upsert)

### Retry/Safety
- 30s fetch timeout
- Run locking: check for existing `running` sync run before starting
- Idempotent: re-running overwrites `erp_items_current` safely

### Integration with bulk-job-runner
- Add `erp-sync` to `OP_ACTIONS` map
- Single-batch operation (fetch all → process → done)
- Or cursor-based if ERP response is very large

### Config
Store in `admin_config`:
- `ERP_SYNC_CONFIG`: `{ endpoint, enabled, last_sync_at }`

---

## Phase 3: Mapping Engine

### Location
`supabase/functions/_shared/erp-mapper.ts`

### Pipeline (precedence order)
1. **ERP direct fields** — if `mg_category` is populated, use it
2. **SKU deterministic rules** — existing `sku-parser.ts` logic (MG01→category mapping)
3. **Spreadsheet overrides** — stored in `admin_config` as `SKU_MAPPING_OVERRIDES`
4. **AI fallback** — only when above methods fail

### Output
For each ERP item, produce:
```typescript
interface ResolvedAttributes {
  product_category: string;       // one of 7 categories
  mg01_code: string; mg01_name: string;
  mg02_code: string; mg02_name: string;
  mg03_code: string; mg03_name: string;
  size_code: string; size_name: string;
  licensor_code: string; licensor_name: string | null;
  property_code: string; property_name: string | null;
  division_code: string; division_name: string;
  is_licensed: boolean;
  classification_source: 'erp' | 'rule' | 'ai';
  confidence: number;
}
```

### Confidence hierarchy
- ERP direct: confidence = 1.0
- SKU rule match: confidence = 0.95
- AI: confidence from model response (0.0–1.0)

### Existing value preservation
- Only overwrite if new confidence > existing confidence
- Unless `force_overwrite` flag is set in the enrichment job params

---

## Phase 4: AI Classification for Legacy Items

### Trigger
Items in `erp_items_current` where `mg_category IS NULL` AND deterministic rules cannot resolve.

### Implementation
- New admin-api action: `classify-erp-categories`
- Calls Lovable AI gateway (`google/gemini-3-flash-preview`) via tool calling
- Batch: process 10 items per invocation

### AI Input
```json
{
  "item_description": "...",
  "style_number": "...",
  "known_mg_fields": { "mg01": "...", "mg02": "..." },
  "existing_tags": ["..."]
}
```

### AI Output (via tool calling)
```json
{
  "category": "Wall",
  "confidence": 0.87,
  "rationale": "Product description mentions 'canvas wall art' and MG01=A maps to stretched/box category"
}
```

### Guardrails
- Confidence < 0.65 → `needs_review` (not auto-applied)
- Confidence ≥ 0.65 → `auto_applied` (written to `product_category_predictions`)
- All predictions saved regardless of confidence

### Admin-api action integration
- `classify-erp-categories`: cursor-based, processes batch of unclassified items
- Integrates with bulk-job-runner pattern

---

## Phase 5: Apply Enrichment to DAM Records

### Admin-api action: `apply-erp-enrichment`
Modes:
- `dry-run`: returns counts of what would change (no writes)
- `apply`: upsert only when confidence > existing
- `apply-force`: overwrite regardless of confidence

### Logic
1. Join `erp_items_current` + `product_category_predictions` → resolved attributes
2. Match to `assets` by normalized SKU
3. Match to `style_groups` by SKU
4. Batch update (50 per batch)
5. For each field changed, write to `erp_enrichment_log`
6. After asset updates, refresh style_group summary fields

### Cursor-based, resumable
- Uses same `usePersistentOperation` + `bulk-job-runner` pattern
- Cursor = offset into matched items
- Progress: `{ matched, updated, skipped, total }`

### Safety
- Never deletes assets or groups
- Preserves existing values when new confidence is lower
- All changes logged in `erp_enrichment_log`

---

## Phase 6: Admin UI

### New Settings Tab: "ERP Enrichment"

#### Section 1: ERP Sync Configuration
- Endpoint URL (read-only, from config)
- Last sync: timestamp, status, counts
- "Run Sync Now" button (triggers erp-sync via persistent operation)
- Sync history (last 5 runs from `erp_sync_runs`)

#### Section 2: Enrichment Controls
- "Dry Run" button → shows preview of changes
- "Apply Enrichment" button → runs apply-erp-enrichment
- "Apply (Force Overwrite)" button → with confirmation dialog
- Progress bar during operation

#### Section 3: Quality Dashboard
Cards showing:
- Total ERP items synced
- Matched by deterministic rules (count)
- AI-classified (count, with confidence breakdown)
- Low-confidence pending review (count)
- Unmatched SKUs (count)

#### Section 4: Review Queue
Table of `product_category_predictions` where `status = 'pending'` and confidence < threshold:
- Columns: style_number, description, predicted_category, confidence, rationale
- Actions: Approve / Override (select different category) / Reject
- Bulk approve button

### Diagnostics Integration
Add cards to existing Diagnostics tab:
- Last ERP sync status + duration + counts
- Last enrichment run status + changed assets/groups
- Error samples with retry button

---

## Phase 7: Testing

### Unit Tests (vitest)
1. SKU parsing edge cases (old vs new MG structure)
2. Category enum validation (only 7 valid values)
3. Confidence threshold behavior (auto-apply vs needs_review)
4. Mapping precedence (ERP > rule > AI)

### Integration Tests (edge function tests)
1. ERP sync: fetch → stage → normalize
2. Enrichment: staged data → asset/group updates
3. Interrupted run resume
4. Dry-run returns correct counts without writes

### Fixtures
- Sample old-format items (no mgCategory)
- Sample new-format items (with mgCategory)
- Edge cases: unknown MG codes, missing fields

---

## Phase 8: Rollout

### Feature Flag
Store in `admin_config`: `ERP_ENRICHMENT_ENABLED` (default: false)

### Rollout Steps
1. Deploy schema migrations
2. Enable sync (set flag, run first sync)
3. Review synced data in admin UI
4. Run dry-run enrichment, review changes
5. Run AI classification on legacy items
6. Review low-confidence predictions
7. Apply enrichment

### Operator Runbook (in docs/)
- How to run first sync
- How to review low-confidence categories
- How to retry failed runs
- How to force-overwrite specific items

---

## Implementation Order

| Step | What | Files |
|------|------|-------|
| 1 | Schema migration (all new tables) | `supabase/migrations/` |
| 2 | `erp-sync` edge function | `supabase/functions/erp-sync/index.ts` |
| 3 | `_shared/erp-mapper.ts` | `supabase/functions/_shared/erp-mapper.ts` |
| 4 | Admin-api actions: `erp-sync-status`, `classify-erp-categories`, `apply-erp-enrichment` | `supabase/functions/admin-api/index.ts` |
| 5 | Bulk-job-runner: add ERP operations | `supabase/functions/bulk-job-runner/index.ts` |
| 6 | AI classification edge function integration | `supabase/functions/ai-tag/index.ts` or new |
| 7 | Admin UI: ErpEnrichmentTab | `src/components/settings/ErpEnrichmentTab.tsx` |
| 8 | Review queue UI | `src/components/settings/ErpReviewQueue.tsx` |
| 9 | Diagnostics cards | `src/components/settings/DiagnosticsTab.tsx` |
| 10 | Tests + fixtures | `src/test/`, edge function tests |
| 11 | Documentation | `docs/ERP_ENRICHMENT.md` |

---

## Open Questions (Need Your Input Before Implementation)

1. **ERP API response shape**: I need to inspect the actual JSON structure. Can you share a sample item from the API response? Key fields I need to identify:
   - What is the unique item identifier field? (`styleNumber`? `itemCode`? `id`?)
   - What field contains `mgCategory`?
   - What fields contain MG01/02/03 codes?
   - What field has the product description for AI classification?

2. **Spreadsheet mapping**: You mentioned a spreadsheet that defines MG code relationships. Can you upload it so I can build the deterministic rules?

3. **ERP item count**: Roughly how many items does the API return? This affects whether we need cursor-based processing or can handle it in a single batch.

4. **Incremental sync**: Does the ERP API support filtering by last-modified date, or is it always a full dump?
