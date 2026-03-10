# Plan: Move Bulk Operations to Database Functions + Supabase Migration

This is a two-part plan: (1) move the three heaviest bulk operations into plpgsql database functions, and (2) migrate from Lovable Cloud to your own managed Supabase project.

---

## Part 1: Database Functions for Bulk Operations

### 1A. `propagate_group_tags_batch` — New Database Function

A single plpgsql function that replaces `tag-propagation.ts` + `tag-propagation-handlers.ts`. It will:

- Accept `p_cursor uuid DEFAULT NULL, p_batch_size int DEFAULT 100`
- Use keyset pagination on `style_groups.id` (consistent with existing patterns)
- For each group in the batch: find the source asset (primary if tagged, else first tagged by `primary_sort_tier`), fetch its product-level tags and characters
- Use set-based operations to compute missing tags/characters across all siblings in the batch simultaneously
- Bulk INSERT into `asset_tags` with `ON CONFLICT DO NOTHING`
- Bulk INSERT into `asset_characters` with `ON CONFLICT DO NOTHING`
- Bulk UPDATE metadata fields (licensor_id, property_id, is_licensed, big_theme, little_theme, design_style, cover_description) only where the sibling value is NULL
- Return `(next_cursor uuid, propagated int, skipped int, done boolean)`
- Set `statement_timeout` to 120s (same pattern as `clear_style_group_batch`)
- FILE_SPECIFIC_TAGS exclusion list will be hardcoded in the function

Expected throughput: 100+ groups per call, each call ~2-5 seconds. 8,342 groups = ~1-2 minutes total.

### 1B. `rebuild_style_groups_batch` — New Database Function

Replaces the rebuild logic in `style-group-handlers.ts` stages 1-3. The clear + delete stages are already partially in DB functions. The main new work is stage 3 (rebuild_assets):

- Accept `p_last_asset_id uuid DEFAULT NULL, p_batch_size int DEFAULT 500`
- Extract SKU folders using a SQL regex equivalent of `extractSkuFolder` (pattern: `^[A-Za-z]{1,6}\d` with length >= 10)
- Upsert into `style_groups` with `ON CONFLICT (sku)`
- Bulk update `assets.style_group_id` for matched assets
- Return `(next_cursor uuid, groups_created int, assets_assigned int, done boolean)`

This eliminates the current pattern of fetching assets → computing groups in TypeScript → writing back, replacing ~10 network round-trips per batch with zero.

### 1C. `reconcile_style_group_stats_batch` — Enhanced Existing Functions

The existing `refresh_style_group_counts_batch` and `refresh_style_group_primaries_batch` already run in-DB. The only change needed is a wrapper function that handles cursor pagination internally:

- Accept `p_cursor uuid DEFAULT NULL, p_batch_size int DEFAULT 200, p_sub text DEFAULT 'counts'`
- Call the existing count/primaries functions internally
- Return `(next_cursor uuid, processed int, sub text, done boolean)`

### 1D. Simplify `bulk-job-runner`

The runner currently makes HTTP calls to `admin-api` which then runs the logic. After this change:

- For `propagate-group-tags`: call `db.rpc('propagate_group_tags_batch', { p_cursor, p_batch_size: 200 })` directly
- For `rebuild-style-groups` (stage 3): call `db.rpc('rebuild_style_groups_batch', ...)` directly
- For `reconcile-style-group-stats`: call `db.rpc('reconcile_style_group_stats_batch', ...)` directly
- Remove the HTTP fetch to `admin-api` for these three operations
- Keep the HTTP fetch pattern for operations that genuinely need Edge Function logic (AI tagging, ERP classify — these call external APIs)

The `admin-api` handlers for these operations become thin `rpc()` wrappers for manual single-batch triggers from the UI.

### 1E. What Stays the Same

- `usePersistentOperation` hook — unchanged (still polls `BULK_OPERATIONS` config)
- `bulk-job-runner` structure — same loop, same progress tracking, same auto-resume. Just calls `rpc()` instead of `fetch(admin-api)`
- AI tagging operations — unchanged (legitimately need Edge Functions for external API calls)
- ERP classification — unchanged (calls external AI API)
- All frontend components — unchanged
- All agent code — unchanged

---

## Part 2: Migration to Your Own Supabase Project - don't implement this one yet. please give me concrete examples of how this will affect me on a day-to-day basis. what will i have to start doing on my own and how often?

### Migration Steps

**Step 1: Create your Supabase project** on supabase.com. Choose a region close to your NAS/users.

**Step 2: Export schema from Lovable Cloud.** I will generate a consolidated SQL migration file containing:

- All enum types
- All tables with columns, constraints, indexes
- All database functions and triggers
- All RLS policies
- All pg_cron jobs (if any)

You run this SQL in your new project's SQL Editor.

**Step 3: Export data.** Use the Lovable Cloud database export feature (Cloud tab → Database → Tables → Export) for each table. Import into your new project. Critical tables: `assets` (92k rows), `style_groups` (8k), `asset_tags`, `asset_characters`, `admin_config`, `agent_registrations`, `invitations`, `profiles`, `user_roles`, `licensors`, `properties`, `characters`, and the ERP/taxonomy tables. - This will not work. Lovable's interface does not allow for export of huge tables like one which has 250,000 records. How will this be done?

**Step 4: Copy secrets.** In your new Supabase project dashboard, add all the same secrets:

- `BREVO_API_KEY` — same value
- `DEPLOY_WEBHOOK_KEY` — same value  
- `LOVABLE_API_KEY` — same value (for AI tagging)
- The `SUPABASE_*` secrets are auto-populated by Supabase

**Step 5: Deploy Edge Functions.** Push the `supabase/functions/` directory to your new project using the Supabase CLI:

```
supabase link --project-ref YOUR_NEW_PROJECT_ID
supabase functions deploy
```

**Step 6: Update the frontend.** In Lovable, you disconnect from Cloud and update environment variables:

- `VITE_SUPABASE_URL` → your new project URL
- `VITE_SUPABASE_PUBLISHABLE_KEY` → your new anon key

**Step 7: Update agents.** Change the `POPDAM_SERVER_URL` (or `SUPABASE_URL`) in the Bridge Agent and Windows Agent `.env` files to point to your new Supabase project URL.

**Step 8: DigitalOcean Spaces.** Spaces is completely independent of Supabase — it's configured via the `SPACES_CONFIG` key in `admin_config`. As long as that config row is migrated (Step 3), Spaces keeps working with zero changes. The thumbnail URLs stored in `assets.thumbnail_url` are full public URLs pointing directly at DO Spaces, not at Supabase.

### What You Lose by Leaving Lovable Cloud - [Can you tell me in more detail what this will mean to me? what will i have to do nand how often]

- Auto-deployment of Edge Functions from Lovable editor (you'll deploy via CLI instead)
- Auto-generated `types.ts` (you'll run `supabase gen types` via CLI)
- Database migrations from Lovable editor (you'll use Supabase dashboard or CLI)
- You keep: Lovable for frontend editing, GitHub sync, publishing the web app

### User Authentication Note

User passwords cannot be exported from Supabase auth. You have a small user base (invitation-only), so the simplest path is to have existing users reset their passwords after migration.

---

## Implementation Order

1. **Part 1 first** (database functions) — this can be done entirely within Lovable Cloud, fixes the immediate pain, and the functions will migrate cleanly to your own project
2. **Part 2 second** (migration) — once the DB functions are proven stable, migrate everything to your own Supabase project

Total implementation: ~4-5 messages for Part 1 (one per DB function + runner update), then Part 2 is mostly a guided manual process with me generating the migration SQL.