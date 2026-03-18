# Speed up AI tagging: from 12 days to ~1 day

## The real bottleneck

The speed issue isn't batch size or database performance — it's that each `ai-tag` call takes **8-20 seconds** (fetch thumbnail + Gemini inference + DB writes), and the runner processes them **one at a time**. At 5/min, 81K assets = 12 days.

## Two-pronged strategy

### Strategy A: Tag smarter (reduce 81K → ~7K)

You already have **style groups** — groups of assets that share the same SKU/design. Instead of AI-tagging every single file in a group, tag **one representative per group**, then use the existing `propagate_group_tags_batch` DB function to copy tags to all siblings.  
Give 'tech pack' files priority when deciding which one from the group is used for tagging. maybe mockup would be next, but i've seen some back mockups. and 'art' files won't tell you what product it is. definitely skip 'packaging' files. Is there some way to tell if none of the images are good and wait for a user to pull in a sibling jpg/png and use that?

With ~7,000 style groups averaging ~13 assets each:

- **Before:** 81,000 AI calls
- **After:** ~7,000 AI calls + fast DB propagation
- **Time:** ~1 day instead of 12

This means running the operations in order:

1. AI-tag untagged (but skip assets whose style group already has a tagged representative)
2. Propagate group tags (already implemented, runs in seconds via plpgsql)

### Strategy B: Parallel AI calls (3x throughput)

Currently the runner fires one `ai-tag` call, waits for it to finish, then fires the next. Since each call is an independent HTTP request to a separate edge function, we can safely fire **3 concurrent calls** per iteration.

- **Before:** 1 asset per ~12s cycle = 5/min
- **After:** 3 assets per ~12s cycle = 15/min

## Implementation

### 1. Add "smart skip" to the ai-tag asset query in `bulk-job-runner`

When fetching the next asset to tag, add a filter: skip assets whose `style_group_id` already has at least one asset with `status = 'tagged'`. This means the runner naturally tags one representative per group, then moves on.

```sql
-- Pseudocode for the query addition
AND NOT EXISTS (
  SELECT 1 FROM assets sibling
  WHERE sibling.style_group_id = assets.style_group_id
    AND sibling.status = 'tagged'
    AND sibling.id != assets.id
    AND assets.style_group_id IS NOT NULL
)
```

### 2. Parallelize ai-tag calls in `bulk-job-runner`

Instead of fetching 1 asset and calling ai-tag once per loop iteration, fetch 3 assets and fire 3 concurrent `ai-tag` calls via `Promise.allSettled`. Accumulate results, advance cursor by the count processed.

### 3. Add a "Tag + Propagate" combo button (optional, UX improvement)

In the Operations tab, add a single button that queues two operations in sequence:

1. `ai-tag-untagged` (with smart skip)
2. `propagate-group-tags`

This gives the user a one-click "tag everything intelligently" workflow.

## Files to modify

1. `**supabase/functions/bulk-job-runner/index.ts**` — parallel ai-tag calls (fetch 3, fire concurrently), smart-skip query for grouped assets
2. `**supabase/functions/_shared/admin-handlers/ai-tagging-handlers.ts**` — update `handleBulkAiTag` query to match the smart-skip logic (backward compat)

## Expected results


| Scenario                 | AI calls needed | Time estimate |
| ------------------------ | --------------- | ------------- |
| Current                  | 81,000          | ~12 days      |
| Smart skip only          | ~7,000          | ~1 day        |
| Smart skip + 3x parallel | ~7,000          | ~8 hours      |
| After propagation        | 0 remaining     | minutes       |
