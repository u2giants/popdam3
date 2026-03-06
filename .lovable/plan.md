

## Plan: Improve Progress Verbosity for All Bulk Operations

Yes, this proposal is solid and will significantly improve operational visibility. The assessment is accurate — the backend already returns most of the data needed, and the changes are additive/display-only. Here's the implementation plan organized by file.

---

### Summary of Changes

| File | Change Type |
|------|------------|
| `supabase/functions/_shared/types.ts` | Add `stage_started_at` to `OpState` |
| `supabase/functions/_shared/admin-handlers/style-group-handlers.ts` | Add `total_groups` to `ReconcileState`, fetch once, include in returns; add `total_groups_before_delete` + `stage_started_at` to rebuild transitions |
| `supabase/functions/bulk-job-runner/index.ts` | Update `buildProgress` for `reconcile-style-group-stats` (add `total_groups`) and `reprocess-metadata` (add `grand_total`, `assets_checked`); add `stage_started_at` passthrough for rebuild |
| `supabase/functions/admin-api/index.ts` | Add one-time `COUNT(*)` at offset=0 in `handleReprocessAssetMetadata`; add `grand_total` + `assets_checked` to return |
| `src/components/settings/diagnostics/StyleGroupsSection.tsx` | Full rewrite of `RebuildStatusDetail` with stage pipeline, per-stage progress bars, rate/ETA; full rewrite of reconcile detail with sub-stage pipeline |
| `src/components/settings/diagnostics/AiTaggingSection.tsx` | Replace progress block with rate/ETA/elapsed/breakdown version |
| `src/components/settings/diagnostics/ActionsSection.tsx` | Replace reprocess and backfill progress blocks with verbose versions |

---

### Technical Details

**Backend changes are strictly additive:**
- New optional fields on return payloads (`total_groups`, `grand_total`, `assets_checked`, `stage_started_at`, `total_groups_before_delete`)
- One-time `COUNT(*)` queries wrapped in `try/catch` (non-fatal)
- No changes to batch sizes, retry logic, stage transitions, or RPC calls

**Frontend adds shared utilities:**
- `formatDuration(ms)` — human-readable elapsed time
- `formatEta(remaining, rate)` — estimated time remaining  
- `ProgressRow` — reusable component with label, count/total/%, progress bar, rate, ETA

**Each operation gets:**
- Elapsed time display
- Progress bar with percentage
- Rate calculation (items/min) after 10s warmup
- ETA based on current rate
- Operation-specific breakdowns (tagged/skipped/failed, updated/checked, etc.)

**Rebuild Style Groups additionally gets:**
- Visual stage pipeline strip (1→2→3→4) with current stage highlighted
- Per-stage elapsed time vs overall elapsed
- Stage-specific denominators (total assets for clear/rebuild, total groups for finalize)

**Backfill SKU Names:** No backend changes possible (single-pass operation), so UI shows elapsed time + "results appear when complete" note + final breakdown.

---

### Deployment

Three edge functions need redeployment: `admin-api`, `bulk-job-runner` (code changes), and potentially clear `deno.lock` if deployment fails.

