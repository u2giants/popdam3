

## Plan: Fix Stuck Finalize UI + Broaden Timeout Detection

Two targeted fixes, zero pipeline risk.

---

### Fix 1 — UI: Treat `counts_done` as primaries view trigger

**File:** `src/components/settings/diagnostics/StyleGroupsSection.tsx`

**Line 126** — Change the substage condition that determines which progress to show:

```typescript
// FROM:
const done = sub === "primaries"
  ? (p.primaries_processed as number) || 0
  : (p.counts_processed as number) || 0;
const label = sub === "primaries" ? "Cover images selected" : "Group counts computed";

// TO:
const isPrimaries = sub === "primaries" || sub === "counts_done";
const done = isPrimaries
  ? (p.primaries_processed as number) || 0
  : (p.counts_processed as number) || 0;
const label = isPrimaries ? "Cover images selected" : "Group counts computed";
```

This ensures when the backend returns `sub: "counts_done"`, the UI immediately switches to showing the primaries panel (starting at 0) instead of staying frozen on the completed counts display.

---

### Fix 2 — Backend: Broaden adaptive halving to catch 502/503/timeout errors

**File:** `supabase/functions/_shared/admin-handlers/style-group-handlers.ts`

Four identical pattern changes — expand the timeout detection in both the `if (countErr/primErr)` blocks and the `catch` blocks for both counts and primaries sub-stages in Stage 4 (finalize_stats):

**Counts sub-stage — `if (countErr)` block (line 525):**
```typescript
// FROM: if (msg.includes("57014") && batchIds.length > 1)
// TO:   if ((msg.includes("57014") || msg.includes("timeout") || msg.includes("502") || msg.includes("503")) && batchIds.length > 1)
```

**Counts sub-stage — `catch` block (line 534):**
```typescript
// Same pattern change
```

**Primaries sub-stage — `if (primErr)` block (line 597):**
```typescript
// Same pattern change
```

**Primaries sub-stage — `catch` block (line 606):**
```typescript
// Same pattern change
```

Also apply the same pattern to the **reconcile handler's** counts (line 719) and primaries (line 761) loops — same two blocks each, same change. Total: 8 edits, all identical single-line expansions.

---

### Deployment

- Redeploy `admin-api` edge function (carries the style-group-handlers changes)
- No other functions affected

