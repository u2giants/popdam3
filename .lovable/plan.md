# Migration Plan: Lovable Cloud → External Supabase Project  
  
Instructions must be very detailed for a non-sysadmin, non-programmer, non-db admin. must be step-by-step slowly - from the very beginning! i installed PGadmin / postgresql on my windows computer but that's it. i did not touch one setting, did not set one thing up as i don't know how. i did set up the project on supabase. 

## Reality Check

This migration has three categories of work:


| Category                                             | Method                                                                  | Effort                                 |
| ---------------------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------- |
| **Schema** (tables, functions, triggers, RLS, enums) | I generate a complete SQL script from what I can see                    | Low — run one SQL file                 |
| **Data** (92k assets, tags, style groups, etc.)      | Table-by-table CSV export from Cloud UI, import via Supabase SQL Editor | Medium — ~20 tables, mostly mechanical |
| **Secrets + Auth**                                   | Manual re-entry from original sources                                   | Manual — you need original API keys    |


Things that **cannot be automated**:

- Lovable Cloud does not expose a Postgres connection string
- Secret values are encrypted and cannot be read back
- Auth user passwords cannot be exported — users must be re-invited or reset passwords - (this is not a problem)

---

## Step 1: Schema Script (I do this)

I will generate a single `.sql` file containing:

- All enums (`file_type`, `asset_status`, `queue_status`, `asset_type`, `art_source`, `workflow_status`, `app_role`)
- All 20+ tables with exact column types, defaults, and constraints
- All indexes (btree, GIN, trigram)
- All database functions (18 functions including `rebuild_style_groups_batch`, `propagate_group_tags_batch`, etc.)
- All triggers (`compute_primary_sort_tier`, `sync_asset_tags_to_array`, `auto_queue_render`, `sync_primary_asset_on_thumbnail`, `sync_designer_to_style_group`, `sync_cover_description_to_style_group`, `update_updated_at_column`)
- All RLS policies
- `handle_new_user()` trigger on `auth.users`

You paste this into your external Supabase project's SQL Editor and run it.

---

## Step 2: Data Export (You do this, from Lovable Cloud UI)

In Cloud View → Database → Tables, export each table as CSV. Priority order:

**Core reference tables (export first):**

1. `licensors`
2. `properties`
3. `characters`
4. `product_categories` → `product_types` → `product_subtypes`

**Main data tables:**
5. `assets` (92k rows — largest table)
6. `asset_tags`
7. `asset_characters`
8. `style_groups` (62k rows)  
9. `asset_path_history  - this is 219,000 records. how do we do this? lovable won't export this many records.`

**Queue/operational tables (can skip or export if needed):**
10. `processing_queue`, `render_queue`, `tiff_optimization_queue`
11. `hygiene_findings`
12. `erp_items_current`, `erp_items_raw`, `erp_sync_runs`, `erp_enrichment_log`
13. `product_category_predictions`

**Config:**
14. `admin_config`
15. `invitations`

**Skip — will be recreated:**

- `profiles` (created by `handle_new_user` trigger on signup)
- `user_roles` (created by `handle_new_user` trigger on signup)

---

## Step 3: Data Import (You do this, in external Supabase)

In your external Supabase dashboard → SQL Editor:

1. Temporarily disable triggers to avoid cascading side effects during import:

```sql
SET session_replication_role = 'replica';
```

2. Import CSVs via Supabase dashboard Table Editor → Import CSV, or use the SQL Editor with `COPY` commands if you prefer.
3. Re-enable triggers:

```sql
SET session_replication_role = 'origin';
```

Import order matters due to foreign key relationships: licensors → properties → characters → assets → asset_tags → asset_characters → style_groups.

---

## Step 4: Secrets (You do this)

In your external Supabase dashboard → Project Settings → Edge Functions → Secrets, add:


| Secret               | Where to find the value                                       |
| -------------------- | ------------------------------------------------------------- |
| `BREVO_API_KEY`      | Brevo dashboard → SMTP & API → API Keys                       |
| `DEPLOY_WEBHOOK_KEY` | Wherever you originally generated this                        |
| `LOVABLE_API_KEY`    | Lovable project settings (this one may need special handling) |


`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `SUPABASE_ANON_KEY` are auto-provided by Supabase in edge functions.

---

## Step 5: Auth / Users

Since auth credentials can't be exported:

1. In external Supabase, insert invitation rows for your users:

```sql
INSERT INTO invitations (email, role) VALUES ('u2giants@gmail.com', 'admin');
-- Add other users as needed
```

2. Users sign up fresh on the new project. The `handle_new_user()` trigger will create their profile and assign roles from the invitation.

---

## Step 6: GitHub Actions Secrets

In your GitHub repo → Settings → Secrets and variables → Actions, add:

- `SUPABASE_ACCESS_TOKEN` — from supabase.com → Account → Access Tokens
- `EXTERNAL_SUPABASE_PROJECT_ID` — your new project's ref ID
- `EXTERNAL_SUPABASE_DB_PASSWORD` — the password you set when creating the Supabase project

---

## Step 7: Switch Frontend Environment

Update the Lovable project's environment to point at the new Supabase:

- `VITE_SUPABASE_URL` → new project URL
- `VITE_SUPABASE_PUBLISHABLE_KEY` → new project anon key
- `VITE_SUPABASE_PROJECT_ID` → new project ref

This is done by updating the `.env` file (though Lovable auto-manages it, so we may need to override via the code).

---

## Step 8: Agent Re-pairing

Bridge Agent and Windows Agent `.env` files need updating:

- `SUPABASE_URL` → new project URL
- `AGENT_KEY` → generate new pairing codes in the new project

---

## What I'll Build (Implementation)

1. **A complete `migration-schema.sql` file** containing every enum, table, function, trigger, index, and RLS policy — ready to paste into Supabase SQL Editor
2. **A checklist document** with the exact export/import order and verification queries
3. **Update `.env` handling** in the frontend to support pointing at the external project

---

## Estimated Effort


| Step                                 | Who  | Time       |
| ------------------------------------ | ---- | ---------- |
| Schema SQL generation                | Me   | Immediate  |
| Data export (20 tables via Cloud UI) | You  | ~30-45 min |
| Data import (Supabase dashboard)     | You  | ~30 min    |
| Secrets re-entry                     | You  | ~10 min    |
| GitHub secrets setup                 | You  | ~5 min     |
| User re-invitation                   | You  | ~5 min     |
| Agent re-pairing                     | You  | ~10 min    |
| Frontend env switch                  | Me   | Immediate  |
| Verification                         | Both | ~15 min    |
