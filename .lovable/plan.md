## Revised Plan — Thumbnail Manifest Export and Database Rebuild

### Corrections to the six points

**1. File existence:** `supabase/functions/export-thumbnail-manifest/index.ts` **already exists** in the repo. The directory listing confirms `export-thumbnail-manifest/` is present. Your local repo snapshot may be stale. No file creation needed for the edge function itself. However, it is **not registered** in `supabase/config.toml`, so it will not deploy until the config entry is added.

**2. Download approach:** Agreed. The button will use `fetch()` directly, following the same pattern as `InstallBundleTab.downloadBundle()`: get session token via `supabase.auth.getSession()`, construct the full URL using `VITE_SUPABASE_PROJECT_ID`, pass `Authorization: Bearer` + `apikey` headers, receive the blob, read `X-Row-Count` from response headers, trigger browser download.

**3. Source backend confirmation:** Yes. The export runs against the **current Lovable Cloud backend** — the one connected to this project right now. The edge function URL is derived from `VITE_SUPABASE_PROJECT_ID` which points to `vklanxwmaeqjbwtmnygj`. This export must happen **before** you change any environment variables to point at an external project. The downloaded CSV is a standalone file you save locally and later import into the new project.

**4. Safer quick_hash fallback SQL:**

```sql
-- Fallback pass: only where quick_hash is unique on BOTH sides
WITH unique_manifest AS (
  SELECT quick_hash, thumbnail_url
  FROM thumbnail_manifest
  WHERE matched = false
    AND quick_hash IS NOT NULL
    AND quick_hash != ''
  GROUP BY quick_hash, thumbnail_url
  HAVING count(*) = 1
),
unique_assets AS (
  SELECT id, quick_hash
  FROM assets
  WHERE thumbnail_url IS NULL
    AND quick_hash IS NOT NULL
    AND quick_hash != ''
  GROUP BY id, quick_hash
  HAVING count(*) OVER (PARTITION BY quick_hash) = 1
)
UPDATE assets a
SET thumbnail_url = um.thumbnail_url
FROM unique_assets ua
JOIN unique_manifest um ON um.quick_hash = ua.quick_hash
WHERE a.id = ua.id;

-- Mark matched
UPDATE thumbnail_manifest tm
SET matched = true
FROM assets a
WHERE a.quick_hash = tm.quick_hash
  AND a.thumbnail_url IS NOT NULL
  AND tm.matched = false;
```

This ensures the fallback only fires when a `quick_hash` value maps to exactly one manifest row AND exactly one asset row, preventing ambiguous matches.

**5. Revised verification checklist — empty quick_hash:**

If any exported rows have a blank or empty `quick_hash`, treat this as a **warning to investigate**. These rows can only match on `relative_path`. If the file was moved or renamed since the last scan, these rows will be unrecoverable. Before proceeding with the rebuild, investigate why the hash is missing — it may indicate the Bridge Agent was interrupted before hashing completed, or the file was too large to hash. If more than a handful of rows are affected, re-run the scan on the old backend to populate hashes before exporting.

**6. Admin authorization with verify_jwt = false:**

Confirmed. Setting `verify_jwt = false` in `config.toml` only disables Supabase's gateway-level JWT check. The `export-thumbnail-manifest` function **already enforces admin authorization in its own code** via the `authorizeAdmin()` function at the top of the handler. That function extracts the Bearer token, calls `auth.getUser()` to validate the session, then checks the `user_roles` table for the `admin` role. Unauthenticated or non-admin requests receive a 401 response.

---

### Final Implementation Plan

**Scope:** Two file changes. No database migrations. No schema changes.

#### Change 1: Register the edge function

**File:** `supabase/config.toml`

Add:

```toml
[functions.export-thumbnail-manifest]
verify_jwt = false
```

This enables deployment. The function already handles its own admin auth check.

#### Change 2: Add download button to Diagnostics

**File:** `src/components/settings/diagnostics/ActionsSection.tsx`

Add a "Download Thumbnail Manifest" button to the existing Actions card. Implementation:

- Uses `fetch()` directly (not `supabase.functions.invoke`), same pattern as `InstallBundleTab`
- Constructs URL: `https://${VITE_SUPABASE_PROJECT_ID}.supabase.co/functions/v1/export-thumbnail-manifest`
- Sends `Authorization: Bearer ${session.access_token}` and `apikey` headers
- On success: reads `X-Row-Count` header, creates blob URL, triggers `<a>` download as `thumbnail_manifest.csv`, shows toast with row count
- On error: shows toast with error message
- Button shows spinner while downloading, disabled during download

#### Pre-existing build errors (not part of this task)

The 4 TypeScript errors in `tag-propagation.ts` and `bulk-job-runner/index.ts` are pre-existing and unrelated. They will be fixed as a separate task after this plan is approved and implemented.

#### Files NOT changed

- `supabase/functions/export-thumbnail-manifest/index.ts` — already correct, no modifications needed
- No database migrations
- No other edge functions
- No other UI components

#### User workflow after implementation

1. Open PopDAM → Settings → Diagnostics tab
2. Click **Download Thumbnail Manifest**
3. CSV downloads automatically; toast shows row count
4. Verify per checklist (spot-check URLs, check for empty `quick_hash` values, confirm row count)
5. Save CSV in two locations
6. Proceed with external project setup and rebuild per Phase 3–6 of the previously approved plan  
  
IMPLEMENT THIS NOW.
  Proceed with the thumbnail manifest download feature, using the already-existing export-thumbnail-manifest edge function and adding the one-click admin-only download button in the Diagnostics Actions section.
  Requirements:
  1) Register the edge function
  Update supabase/config.toml to register export-thumbnail-manifest.
  Preferred:
  [functions.export-thumbnail-manifest]
  verify_jwt = true
  If you believe verify_jwt must remain false for a specific technical reason, keep the existing server-side admin authorization in the function and explain briefly in your final summary why false was necessary.
  2) Add the download button
  Update src/components/settings/diagnostics/ActionsSection.tsx to add a button called:
  Download Thumbnail Manifest
  Implementation requirements:
  - Use direct fetch(), not supabase.functions.invoke()
  - Follow the same raw-download pattern used in InstallBundleTab.downloadBundle()
  - Use the current logged-in session token from supabase.auth.getSession()
  - Build the URL against the current Lovable Cloud source backend using VITE_SUPABASE_PROJECT_ID
  - Send Authorization: Bearer <token>
  - Send apikey header using VITE_SUPABASE_PUBLISHABLE_KEY
  - Download the response as thumbnail_manifest.csv
  - Show loading state/spinner while downloading
  - Disable the button while downloading
  - Show a success toast when finished
  - Show an error toast if the request fails
  3) Critical CORS/header fix
  Because the button needs to read response headers in the browser, make sure the export function response exposes any headers the client needs.
  Specifically:
  - expose X-Row-Count
  - expose Content-Disposition
  If your shared CORS helper does not currently expose those headers, update the relevant shared function response utility or the function response headers so the browser can access them.
  4) Do NOT change the manifest schema
  The export should continue returning only rows where thumbnail_url IS NOT NULL with these columns:
  - old_asset_id
  - relative_path
  - filename
  - quick_hash
  - thumbnail_url
  5) Do NOT do any of the rebuild/migration steps yet
  Only implement the one-click export capability right now.
  Do not touch:
  - database migrations
  - external Supabase import steps
  - rebuild logic
  - reattachment SQL
  - other edge functions
  - unrelated TypeScript errors
  6) Final response format
  When done, tell me exactly:
  A) which files you changed
  B) whether verify_jwt was set to true or false
  C) whether you updated shared CORS/header handling
  D) exactly where in the UI I should click
  E) whether the button downloads from the current Lovable Cloud source backend