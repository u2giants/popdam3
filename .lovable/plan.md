# Speed up AI tagging: from 12 days to ~8 hours

## Status: IMPLEMENTED ✅

## Changes Made

### 1. Smart-skip logic (bulk-job-runner + ai-tagging-handlers)
- When tagging "untagged" assets, first queries for style_group_ids that already have a tagged representative
- Excludes those groups from the asset fetch, so only one asset per group gets AI-tagged
- Reduces ~81K AI calls to ~7K (one per style group + ungrouped assets)
- Falls back to ungrouped assets when all grouped assets are handled

### 2. Packaging-only groups skip ("waiting for siblings")
- Assets with `primary_sort_tier` IN (4, 8) — i.e. packaging files — are excluded from AI tagging queries
- Style groups that ONLY contain packaging files are never tagged; they wait for a non-packaging sibling
- UI shows count of packaging-only groups as "waiting for siblings" in the AI Tagging section
- Saves money by not wasting AI calls on packaging-only groups with poor representative images

### 3. 3x parallel AI calls (bulk-job-runner)
- Fetches 3 assets per iteration instead of 1
- Fires all 3 `ai-tag` calls concurrently via `Promise.allSettled`
- Accumulates results and advances cursor by batch size
- Rate-limit handling still works (retries on 429)

### 4. Representative priority ordering
- Assets ordered by `primary_sort_tier` (ascending) so best representatives are tagged first
- Tier order: mockup-with-thumb(1) > art-with-thumb(2) > generic-with-thumb(3) > packaging-with-thumb(4, SKIPPED)

### 5. Tag + Propagate combo button (UI)
- New primary button in AI Tagging section
- Starts "Tag All Untagged" (with smart-skip), then auto-queues "Propagate Group Tags"
- One-click workflow for the complete tagging pipeline

## Expected Results

| Scenario | AI calls | Time |
|----------|----------|------|
| Before | 81,000 | ~12 days |
| After (smart-skip + 3x parallel) | ~7,000 | ~8 hours |
| After propagation | 0 remaining | minutes |
| Packaging-only groups | 0 (skipped) | waiting for siblings |
