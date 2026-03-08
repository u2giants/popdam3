

# PopDAM Codebase Audit — Findings and Recommendations

## Executive Summary
The codebase is architecturally sound and follows the PROJECT_BIBLE conventions well. The separation of agent-api/admin-api, the path canonicalization, and the invitation-only auth are all correctly implemented. However, there are several artifacts from iterative development, duplicated code patterns, and opportunities for meaningful improvement.

---

## 1. Code Duplication (Most Impactful)

### A. `deriveMetadataFromPath` is duplicated between `agent-api` and `admin-api`
Both `agent-api/index.ts` (line 141) and `admin-api/index.ts` (line 407) contain nearly identical implementations. The agent-api version is slightly more complete (returns `licensor_name`/`property_name`). This should be extracted to `_shared/metadata-derivation.ts`.

### B. `DEFAULT_WORKFLOW_FOLDER_MAP` duplicated
Identical constant in both `agent-api/index.ts` (line 121) and `admin-api/index.ts` (line 396).

### C. `requireString`, `optionalString`, `requireNumber`, `optionalNumber` duplicated
Both edge functions define these inline. Should be in `_shared/validators.ts`. The agent-api also has `requireCanonicalRelativePath` which admin-api doesn't — inconsistency.

### D. `serviceClient()` factory duplicated
Three edge functions (`agent-api`, `admin-api`, `ai-tag`, `bulk-job-runner`) each create their own `serviceClient()`. Should be a shared utility.

**Impact**: Any schema or logic change must be applied in multiple places, violating the "docs-as-contracts" rule.

---

## 2. Artifacts from Previous Revisions

### A. `useAgentStatus` — dead `scanRunning` field
Line 137: `const scanRunning = false;` with a comment "Kept as false here for backward compat; consumers should use useScanProgress." The `scanRunning` field on `AgentStatusInfo` and the associated `scanRequested`/`scanAbort` fields on `AgentRecord` are vestigial — all scan status is now driven by `useScanProgress`. This dead code adds confusion.

### B. `emptyCounters` in `useAgentStatus` — never used
Line 55-63: The `emptyCounters` object is defined but never referenced.

### C. `BulkActionBar` — stale invalidation side-effect in render
Lines 69-71: `if (isDone || isFailed) { queryClient.invalidateQueries(...) }` executes during render, not in an effect. This triggers on every re-render while the status is "completed" or "failed", causing repeated cache invalidation. Should be wrapped in a `useEffect` with a transition guard.

### D. `useStyleGroups` — FK join that may not exist
Line 65: The query joins `assets!style_groups_primary_asset_id_fkey` — this assumes a foreign key constraint exists on `style_groups.primary_asset_id → assets.id`. If this FK doesn't exist in the migration, this query silently fails or returns incomplete data. The style_groups table already has denormalized `primary_thumbnail_url` / `primary_thumbnail_error`, so the join is redundant.

### E. `searchTimer` stored in useState (Index.tsx)
Line 99: `const [searchTimer, setSearchTimer] = useState<...>(null)` — storing a timer ID in React state causes unnecessary re-renders. Should be a `useRef`.

### F. `processing_queue` table — appears unused
The `processing_queue` table and `claim_jobs`/`reset_stale_jobs` RPCs appear to be legacy from before the `render_queue` + `bulk-job-runner` pattern was established. The agent-api still inserts `ai-tag` and `thumbnail` jobs into `processing_queue` (lines 968-1031), but nothing claims them. The AI tagging is now handled by `bulk-job-runner`. This is dead infrastructure.

---

## 3. Efficiency Improvements

### A. `handleListHygieneFindings` — N+1 summary query
Lines 3062-3076 in admin-api: Fetches all hygiene findings to count statuses client-side using `.select("status")` then iterating. Should use `count: "exact", head: true` with status filters, or a single SQL GROUP BY.

### B. `handleErpReviewQueue` — serial count queries
Lines 2498-2507: Runs 6 sequential `SELECT count(*)` queries for status tabs. Should be a single `GROUP BY status` query or a DB function.

### C. `handleReprocessAssetMetadata` — sequential asset updates
Lines 532-589: Updates each asset individually in a loop. Could batch updates by grouping assets with the same derived changes.

### D. Agent-api `handleIngest` — multiple serial DB calls per ingest
Each ingest call hits the DB ~5-8 times: subfolder config check, metadata derivation (workflow map lookup), SKU parse, hash lookup, path lookup, insert/update, style group upsert, asset count, processing queue insert. For bulk ingestion this is significant. Consider:
- Batched ingest endpoint (accept array of files, single DB round-trip per batch)
- More aggressive caching of lookup data

### E. `useVisibilityDate` and `useScanProgress` — both poll `admin_config` independently
Multiple hooks poll admin_config on separate intervals. Could consolidate into a single admin-config polling hook that distributes values.

---

## 4. Robustness Concerns

### A. Missing `AbortSignal.timeout` on some admin-api fetch calls
The invite email fire-and-forget call (line 338-348) has no timeout. Per the memory rules, all external calls must have `AbortSignal.timeout`.

### B. `handleClassifyErpCategories` uses `execute_readonly_query` with string interpolation
Lines 2842-2857: While the SQL is constructed server-side (not user input), the pattern of building SQL via template literals inside an RPC is fragile. If `fetchSize` or `offset` were ever derived from user input without validation, this would be an injection vector. The offset IS from user input (body.offset). This should use parameterized queries or at minimum validate types strictly.

### C. `selectPrimaryAsset` sorts in-place
Line 113: `assets.sort(...)` mutates the input array. Should use `[...assets].sort(...)`.

### D. No retry logic on AI gateway calls in `ai-tag`
The ai-tag function has no retry on transient 429/5xx errors from the AI gateway, unlike the admin-api which has `withRetry`. A single timeout or rate limit kills the entire tag operation.

---

## 5. Elegance / Structural Improvements

### A. Admin-api is 3,122 lines
Despite the handler extraction to `_shared/admin-handlers/`, the main router file is still enormous. The ERP handlers (`handleErpStats`, `handleErpReviewQueue`, `handleErpReviewAction`, `handleApplyErpEnrichment`, `handleClassifyErpCategories`) and hygiene handlers should be extracted to their own modules, following the pattern established with `agent-handlers.ts` and `style-group-handlers.ts`.

### B. Agent-api is 2,558 lines
Same issue. The ingest, heartbeat, render, TIFF, and hygiene handlers should be modularized.

### C. `useAdminApi` retry logic retries "Bad Request" (400)
Line 60: 400 errors are client errors (bad payload) and should NOT be retried — they'll fail every time. This was likely added to handle a transient misclassification but creates wasted retries.

### D. QueryClient created without options
Line 16 of App.tsx: `new QueryClient()` with no default options. Consider setting `defaultOptions.queries.retry: 1` and `staleTime: 5000` globally to reduce unnecessary refetches.

---

## 6. Recommended Priority Order

1. **Extract shared utilities** (deriveMetadataFromPath, validators, serviceClient) — eliminates the highest drift risk
2. **Remove dead code** (emptyCounters, processing_queue inserts, scanRunning on agent status)
3. **Fix render-time side effect** in BulkActionBar (query invalidation in render)
4. **Fix searchTimer useState → useRef** in Index.tsx
5. **Extract ERP/hygiene handlers** from admin-api to reduce file size
6. **Add batched ingest endpoint** to agent-api for performance
7. **Consolidate admin_config polling** into a single hook
8. **Add retry logic to ai-tag** edge function
9. **Fix SQL injection surface** in handleClassifyErpCategories

Each change is a small, isolated diff consistent with the "No Fix-on-Fix" rule.

