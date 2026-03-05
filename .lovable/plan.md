

# Plan: Tag Provenance — Distinguish AI vs Human Tags

## Problem
All tags live in a single `text[]` column with no origin metadata. AI tagging overwrites everything. Manual edits are indistinguishable from AI output. This creates three issues:
- Re-running AI tagging silently destroys human curation
- No audit trail for tag origin
- Cannot implement "keep human tags, re-tag AI ones" workflows

## Approach

### Database Changes

**New table: `asset_tags`** (replaces the flat `tags` array as the source of truth)

```text
asset_tags
├── id          uuid PK
├── asset_id    uuid FK → assets.id
├── tag         text
├── source      text ('ai' | 'manual' | 'bulk')
├── created_at  timestamptz
├── created_by  uuid (null for AI)
└── UNIQUE(asset_id, tag)
```

RLS: authenticated SELECT, admin ALL.

**Migration strategy**: Populate `asset_tags` from existing `tags` arrays. For assets where `ai_tagged_at IS NOT NULL`, mark source = `'ai'`. For others, mark `'manual'`. Keep the `tags` array column as a denormalized cache (updated via trigger) so existing queries/filters don't break.

**Trigger**: On `asset_tags` INSERT/DELETE, rebuild the parent asset's `tags` array. This keeps the flat array in sync without changing every consumer.

### Edge Function Changes

**`ai-tag/index.ts`**: Instead of setting `updates.tags = tagData.tags`, upsert into `asset_tags` with `source = 'ai'`. Optionally delete old AI tags before inserting new ones (preserving manual tags).

**`agent-api/index.ts`**: No change needed — agents don't set tags.

### UI Changes

**`AssetDetailPanel.tsx`**: Show tag pills with a subtle indicator (e.g., small icon or color tint) for AI vs manual origin. When a user adds a tag manually, insert with `source = 'manual'`.

**Bulk re-tag behavior**: "Re-tag" button can now mean "replace only AI tags" — human-curated tags survive.

### Filter function update

**`get_filter_counts`**: The `v_tag_filter` clause currently checks `v_tag_filter = ANY(tags)`. This continues to work since the denormalized `tags` array stays in sync. No change needed unless we want to filter by tag source.

## Files Changed

| File | Purpose |
|------|---------|
| Migration SQL | Create `asset_tags` table, backfill, add sync trigger |
| `supabase/functions/ai-tag/index.ts` | Write to `asset_tags` instead of flat array |
| `src/components/library/AssetDetailPanel.tsx` | Show tag provenance, manual tag add writes to `asset_tags` |
| `src/hooks/useAssets.ts` | Join `asset_tags` if detail view needs source info |

## What Does NOT Change
- The `tags` text[] column stays as a denormalized cache for fast filtering
- `get_filter_counts` DB function — unchanged
- Scanner/agent code — unchanged
- Style grouping — unchanged

