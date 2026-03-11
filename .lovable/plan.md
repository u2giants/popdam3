

## Assessment: Your Plan Is Correct

All five points are right. One minor note on point 2:

### Domain Configuration

Per the project memory, the production domain is `dam.designflow.app`. The `popdam.lovable.app` URL is the Lovable preview/published URL. Both should be added to Supabase and Google Cloud config since either could be used for login.

**Supabase Auth → URL Configuration:**
- Site URL: `https://dam.designflow.app`
- Redirect URLs: `https://dam.designflow.app`, `https://dam.designflow.app/**`, `https://popdam.lovable.app`, `https://popdam.lovable.app/**`

**Google Cloud Console → OAuth Client:**
- Authorized JavaScript origins: `https://dam.designflow.app`, `https://popdam.lovable.app`
- Authorized redirect URIs: `https://ryltkzzernhwnojzouyb.supabase.co/auth/v1/callback`
- Remove `/api/auth/callback/google` — no code in this repo references that path after switching to direct Supabase OAuth

### Code Changes

**LoginPage.tsx:**
- Remove `import { lovable }` (line 5)
- Replace `handleGoogleSignIn` to call `supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } })`
- Add `useEffect` to detect OAuth errors in URL hash/params on mount

**Build error fixes** (same deployment):
- `tag-propagation.ts` lines 171, 202, 208: wrap in `Promise.resolve()`
- `bulk-job-runner/index.ts` line 602: add `Number()` cast
- `export-thumbnail-manifest/index.ts` lines 87-91: add type assertion on query result

### What You Must Do Manually (After Code Deploys)

1. Supabase Dashboard → Auth → URL Configuration → set Site URL + Redirect URLs as above
2. Supabase Dashboard → Auth → Providers → Google → enable, enter Client ID + Secret
3. Google Cloud Console → update OAuth client origins/redirect URIs as above
4. Remove old `/api/auth/callback/google` redirect URI from Google Cloud

Your plan is correct. Proceed.

