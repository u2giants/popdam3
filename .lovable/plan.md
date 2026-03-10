# Plan: Move Bulk Operations to Database Functions + Supabase Migration

## Part 1: Database Functions for Bulk Operations

### ✅ 1A. `propagate_group_tags_batch` — DONE

Created plpgsql function that replaces `tag-propagation.ts` + `tag-propagation-handlers.ts`:
- Keyset pagination on `style_groups.id` with `p_cursor uuid, p_batch_size int`
- Finds source asset (primary if tagged, else first tagged by `primary_sort_tier`)
- Set-based tag propagation via `INSERT ... ON CONFLICT DO NOTHING`
- Character propagation via same pattern
- Metadata fill-nulls via single UPDATE with COALESCE
- FILE_SPECIFIC_TAGS exclusion hardcoded in temp table
- `statement_timeout = 120s`
- Handler simplified to thin `db.rpc()` wrapper
- `bulk-job-runner` calls `db.rpc()` directly (bypasses admin-api HTTP entirely)
- Inter-call delay reduced to 100ms (was 500ms)
- **Lane fix**: Moved from `ai-tagging` lane to `style-groups` lane to prevent lock conflicts with rebuild

Expected: 200 groups/batch, ~2-5s per call, 8,342 groups in ~2-4 minutes total.

### ✅ 1B. `rebuild_style_groups_batch` — DONE

Successfully ran full pipeline:
- Stage 1: Cleared 65,065 asset assignments
- Stage 2: Deleted 8,360 old groups
- Stage 3: Rebuilt using `rebuild_style_groups_batch` RPC — 92,721 assets → 65,626 assignments, 62,199 groups
- Stage 4: Finalized stats (counts + primaries)

### ✅ 1C. `reconcile_style_group_stats_batch` — DONE

Created plpgsql wrapper function that handles keyset pagination over style_groups:
- Accepts `p_cursor uuid, p_batch_size int, p_sub text` ('counts' or 'primaries')
- Calls existing `refresh_style_group_counts_batch` and `refresh_style_group_primaries` internally
- Returns `(next_cursor, processed, sub, done)` with automatic sub-stage transitions
- Handler simplified to thin `db.rpc()` wrapper
- `bulk-job-runner` calls `db.rpc()` directly (bypasses admin-api HTTP entirely)
- Inter-call delay reduced to 100ms (was 1000ms)
- Successfully reconciled 8,335 groups in ~6 minutes

### ✅ 1D. Simplify `bulk-job-runner` — DONE (all three operations now use direct RPC)

---

## Part 2: Migration to Own Supabase Project

### Goal
Move from Lovable Cloud Supabase to a user-managed Supabase project at supabase.com.
- **Full dashboard access**: tables, logs, auth, realtime inspector
- **Independent DB scaling**: larger Postgres compute for heavy plpgsql workloads
- **GitHub Actions auto-deploy**: edge functions + migrations deploy on push to main
- **Lovable stays as frontend editor**: no change to daily workflow

### Architecture After Migration

```
┌─────────────────────────────────────────────────────┐
│  Lovable Editor                                     │
│  ├── Edits: frontend code, edge functions, SQL      │
│  ├── Pushes to: GitHub (auto-sync)                  │
│  └── Hosts: frontend web app (popdam.lovable.app)   │
├─────────────────────────────────────────────────────┤
│  GitHub Actions (on push to main)                   │
│  ├── supabase db push (migrations)                  │
│  ├── supabase functions deploy (edge functions)     │
│  └── supabase gen types (auto-commit types back)    │
├─────────────────────────────────────────────────────┤
│  Your Supabase Project (supabase.com)               │
│  ├── Database (scalable compute)                    │
│  ├── Edge Functions (Deno Deploy)                   │
│  ├── Auth (users, sessions)                         │
│  └── Dashboard (full access)                        │
├─────────────────────────────────────────────────────┤
│  Lovable Cloud Supabase (unused, can't be removed)  │
│  └── Still wired in but zero traffic hits it        │
└─────────────────────────────────────────────────────┘
```

### Step-by-step

#### 2A. GitHub Actions Workflow — READY (code committed)
Created `.github/workflows/deploy-supabase.yml`:
- Triggers on push to `main` when `supabase/` files change
- Deploys all edge functions via `supabase functions deploy`
- Runs migrations via `supabase db push`
- Auto-generates TypeScript types and commits back to repo
- Uses GitHub secrets: `SUPABASE_ACCESS_TOKEN`, `EXTERNAL_SUPABASE_PROJECT_ID`, `EXTERNAL_SUPABASE_DB_PASSWORD`

#### 2B. Schema Migration (manual, one-time)
1. Export schema from Lovable Cloud:
   ```bash
   supabase db dump --project-ref vklanxwmaeqjbwtmnygj > schema.sql
   ```
2. Restore to external project:
   ```bash
   psql $EXTERNAL_DB_URL < schema.sql
   ```
3. Verify all functions, triggers, RLS policies, enums exist

#### 2C. Data Migration (manual, one-time)
1. Export data from Lovable Cloud using `pg_dump --data-only`:
   ```bash
   pg_dump --data-only --no-owner --no-privileges \
     -t admin_config -t assets -t asset_tags -t asset_characters \
     -t asset_path_history -t style_groups -t licensors -t properties \
     -t characters -t invitations -t profiles -t user_roles \
     -t agent_registrations -t agent_pairings -t processing_queue \
     -t render_queue -t hygiene_findings -t tiff_optimization_queue \
     -t erp_items_current -t erp_items_raw -t erp_sync_runs \
     -t erp_enrichment_log -t product_categories -t product_types \
     -t product_subtypes -t product_category_predictions \
     $LOVABLE_DB_URL > data.sql
   ```
2. Restore to external: `psql $EXTERNAL_DB_URL < data.sql`
3. Users must reset passwords (Supabase Auth credentials can't be exported)

#### 2D. Configure Secrets on External Supabase
Transfer all edge function secrets to the external project:
- `BREVO_API_KEY`
- `DEPLOY_WEBHOOK_KEY`
- Any other secrets used by edge functions
- `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_URL` are auto-provided by Supabase

#### 2E. Switch Frontend Environment
Update Lovable project env vars (or use GitHub secrets + build-time injection):
- `VITE_SUPABASE_URL` → external project URL
- `VITE_SUPABASE_PUBLISHABLE_KEY` → external project anon key
- `VITE_SUPABASE_PROJECT_ID` → external project ID

#### 2F. Update Agent Configs
Bridge Agent + Windows Agent `.env` files:
- `SUPABASE_URL` → external project URL
- `AGENT_KEY` → re-pair agents with external project

#### 2G. Verify & Cutover
1. Test frontend login + asset browsing
2. Test agent heartbeat + scan
3. Test bulk operations (rebuild, reconcile, propagate)
4. Test edge function endpoints (admin-api, agent-api, ai-tag)
5. Monitor for 24h before decommissioning Cloud usage

### Notes
- Lovable Cloud can't be disconnected — it stays dormant
- The `supabase/config.toml` file's `project_id` will be updated to the external project
- Lovable will still try to auto-deploy to Cloud — GitHub Actions is the authoritative deploy target
- Types file (`src/integrations/supabase/types.ts`) will be auto-generated by CI and committed back
