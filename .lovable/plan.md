

## Plan: Migrate all data queries to external Supabase client

Seven targeted edits, no restructuring.

### Changes

1. **`src/integrations/supabase/client.ts`** — Replace entire file with a re-export of `externalSupabase` as `supabase`. This redirects all existing imports app-wide to the external project without touching every consumer file.

2. **`src/hooks/useAssets.ts`** (lines 186-193) — Replace `import.meta.env.VITE_SUPABASE_URL` with `"https://ryltkzzernhwnojzouyb.supabase.co"` and `import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY` with `"sb_publishable_7pDNMn_LIJOkdYmhcI0n7g_IuKABuWK"`.

3. **`src/components/settings/diagnostics/ActionsSection.tsx`** (lines 87-94) — Replace `import.meta.env.VITE_SUPABASE_PROJECT_ID` usage (constructs URL) with hardcoded `"https://ryltkzzernhwnojzouyb.supabase.co/functions/v1/export-thumbnail-manifest"` and `import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY` with the hardcoded key.

4. **`src/components/settings/ApisTab.tsx`** (lines 119, 125, 310, 316) — Replace all `import.meta.env.VITE_SUPABASE_URL` with `"https://ryltkzzernhwnojzouyb.supabase.co"` and all `import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY` with the hardcoded key.

5. **`src/components/settings/InstallBundleTab.tsx`** (lines 25-33) — Replace `import.meta.env.VITE_SUPABASE_PROJECT_ID` URL construction with `"https://ryltkzzernhwnojzouyb.supabase.co/functions/v1/admin-api"` and `import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY` with the hardcoded key.

6. **`src/pages/SetupPage.tsx`** (line 115) — Replace `import.meta.env.VITE_SUPABASE_URL` with `"https://ryltkzzernhwnojzouyb.supabase.co"`.

7. **`src/pages/LoginPage.tsx`** (line 64) — Replace `window.location.origin` with `"https://dam.designflow.app"`.

### Side effect: `useAdminApi.ts`
This hook uses `supabase.functions.invoke("admin-api", ...)` which routes through the Supabase JS client. After change 1, `supabase` will point to the external project, so admin-api calls will automatically go to the correct backend. No edit needed.

### What does NOT change
- `src/lib/external-supabase.ts` — untouched
- `src/hooks/useAuth.tsx` — already uses external client
- Edge functions, types, config.toml — untouched

