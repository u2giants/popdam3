# Migration Plan: Lovable Cloud → External Supabase Project

## Status: Step 1 COMPLETE — Ready for execution

---

## What Was Built

### 1. `migration/migration-schema.sql` — Complete schema script
Contains everything needed to recreate the database from scratch:
- 7 enums
- 26 tables with exact column types, defaults, constraints, and foreign keys
- 48 indexes (btree, GIN, trigram)
- 25 database functions (all plpgsql RPCs)
- 13 triggers (including `handle_new_user` on `auth.users`)
- 43 RLS policies
- pg_trgm extension

### 2. `supabase/functions/export-table/` — Paginated CSV export edge function
Solves the Lovable Cloud export limit problem. Downloads any table in 50,000-row pages as CSV.

### 3. `migration/export-all-tables.ps1` — PowerShell export script
One-click script that downloads ALL 24 tables as CSVs to a local `export/` folder.

---

## Table Sizes (actual counts)

| Table | Rows | Export Method |
|-------|------|---------------|
| assets | 96,728 | export-table (2 pages) |
| asset_tags | 726,333 | export-table (15 pages) |
| asset_path_history | 219,838 | export-table (5 pages) |
| render_queue | 231,118 | export-table (5 pages) |
| erp_items_raw | 118,567 | export-table (3 pages) |
| processing_queue | 105,150 | export-table (3 pages) |
| erp_items_current | 31,425 | export-table (1 page) |
| characters | 9,615 | export-table (1 page) |
| product_category_predictions | 9,316 | export-table (1 page) |
| style_groups | 8,333 | Cloud UI or export-table |
| tiff_optimization_queue | 7,953 | Cloud UI or export-table |
| properties | 498 | Cloud UI |
| admin_config | 56 | Cloud UI |
| erp_sync_runs | 25 | Cloud UI |
| agent_pairings | 16 | Cloud UI |
| invitations | 10 | Cloud UI |
| licensors | 8 | Cloud UI |
| agent_registrations | 2 | Cloud UI |
| asset_characters | 94 | Cloud UI |
| product_categories | 0 | skip |
| product_types | 0 | skip |
| product_subtypes | 0 | skip |
| hygiene_findings | 0 | skip |
| erp_enrichment_log | 0 | skip |

---

## Execution Steps (Detailed)

### Step 1: Run Schema on External Supabase ✅ READY

1. Open your **external Supabase project** dashboard at supabase.com
2. Click **SQL Editor** in the left sidebar
3. Click **New query**
4. Open the file `migration/migration-schema.sql` from this repo in a text editor (Notepad, VS Code, etc.)
5. Copy the ENTIRE contents (Ctrl+A, Ctrl+C)
6. Paste into the SQL Editor (Ctrl+V)
7. Click **Run** (or press Ctrl+Enter)
8. You should see "Success" — if you get an error about `pg_trgm`, run this first:
   ```sql
   CREATE EXTENSION IF NOT EXISTS pg_trgm;
   ```
   Then run the full script again.

### Step 2: Export Data from Lovable Cloud

The `export-table` edge function will auto-deploy. Then:

1. Open PowerShell on your Windows PC
2. Navigate to where you want to save files:
   ```powershell
   cd C:\Users\YourName\Desktop
   ```
3. You need the **Service Role Key** from Lovable Cloud. This is tricky — you may need to check if it's accessible via the backend settings. If not, we can use the admin-api approach instead.
4. Edit `migration/export-all-tables.ps1` — replace `PASTE_YOUR_SERVICE_ROLE_KEY_HERE` with the actual key
5. Run:
   ```powershell
   .\export-all-tables.ps1
   ```
6. Wait ~5 minutes. All CSVs will appear in `.\export\`

**Alternative if service role key is not accessible:**
For small tables (<1000 rows), use Cloud UI → Database → Tables → Export.
For large tables, we can add an authenticated admin endpoint that streams CSV.

### Step 3: Import Data to External Supabase

1. In your external Supabase dashboard → **SQL Editor**
2. Run this FIRST to disable triggers during import:
   ```sql
   SET session_replication_role = 'replica';
   ```
3. Go to **Table Editor** → select each table → click **Insert** → **Import from CSV**
4. Import in this EXACT order (foreign keys matter):
   - `admin_config`
   - `licensors`
   - `properties`
   - `characters`
   - `erp_sync_runs`
   - `style_groups`
   - `assets` (largest — may need multiple CSV imports if file is huge)
   - `asset_tags`
   - `asset_characters`
   - `asset_path_history`
   - `processing_queue`
   - `render_queue`
   - `tiff_optimization_queue`
   - `erp_items_current`
   - `erp_items_raw`
   - `product_category_predictions`
   - `invitations`
   - `agent_registrations`
   - `agent_pairings`
5. After ALL imports, re-enable triggers:
   ```sql
   SET session_replication_role = 'origin';
   ```

### Step 4: Secrets

In external Supabase → **Project Settings** → **Edge Functions** → **Secrets**, add:

| Secret | Where to find |
|--------|---------------|
| `BREVO_API_KEY` | Brevo dashboard → SMTP & API → API Keys |
| `DEPLOY_WEBHOOK_KEY` | Wherever you originally created it |
| `LOVABLE_API_KEY` | We need to figure this out — it's the Lovable AI gateway key |

### Step 5: Auth — Create admin user

In external Supabase SQL Editor:
```sql
INSERT INTO invitations (email, role) VALUES ('u2giants@gmail.com', 'admin');
```
Then sign up at the app with that email. The `handle_new_user` trigger will match the invitation.

### Step 6: GitHub Actions Secrets

In GitHub → repo → Settings → Secrets and variables → Actions, add:
- `SUPABASE_ACCESS_TOKEN` — supabase.com → your account → Access Tokens → Generate
- `EXTERNAL_SUPABASE_PROJECT_ID` — from your external project URL (the `ref` part)
- `EXTERNAL_SUPABASE_DB_PASSWORD` — the password you set when creating the project

### Step 7: Switch Frontend (I do this)

Once data is verified, I update the env vars to point at the external project.

### Step 8: Agent Re-pairing

Update Bridge Agent and Windows Agent `.env`:
- `SUPABASE_URL` → new project URL
- Generate new pairing codes in the new dashboard and pair agents

---

## Verification Queries (run on external Supabase after import)

```sql
-- Counts should match the table above
SELECT 'assets' as tbl, count(*) FROM assets
UNION ALL SELECT 'asset_tags', count(*) FROM asset_tags
UNION ALL SELECT 'style_groups', count(*) FROM style_groups
UNION ALL SELECT 'asset_path_history', count(*) FROM asset_path_history
UNION ALL SELECT 'characters', count(*) FROM characters
UNION ALL SELECT 'licensors', count(*) FROM licensors
UNION ALL SELECT 'properties', count(*) FROM properties
ORDER BY 1;
```

---

## Open Questions

1. **Service Role Key access**: Can you see the service role key in Lovable Cloud backend settings? If not, we need an alternative export approach.
2. **LOVABLE_API_KEY**: This key is used by the `ai-tag` edge function to call Lovable's AI gateway. After migration, this key may need to be re-issued or the AI integration reworked.
3. **CSV import size limits**: Supabase Table Editor CSV import may have size limits. For the 726k-row `asset_tags` table, we may need to use `psql` COPY command instead.
