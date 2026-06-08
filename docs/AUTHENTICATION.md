# Authentication

PopDAM uses Supabase Auth for session management. Login is available through Microsoft/Azure, Google, and email/password. A legacy Authentik path still exists in code but is hidden from the login page. All paths produce the same kind of Supabase JWT that the rest of the app uses without modification.

---

## Path 1 — Microsoft OAuth / Azure AD

**As of 2026-06-08, this is the active company SSO path for internal users.**

Users sign in with their Microsoft / Azure AD account via Supabase's built-in Azure provider. New Azure users bypass invitation rows in `handle_new_user()` and are auto-provisioned with the `user` role and `popdam` app access. Google and email/password still require invitations.

### Relevant files

| File | Purpose |
|------|---------|
| `src/pages/LoginPage.tsx` | Renders the "Continue with Microsoft" button |
| `supabase/migrations/20260608100936_allow_azure_company_sso_signup.sql` | Trigger change — bypasses invitation check for Azure users |

---

## Path 2 — Authentik SSO (legacy company AD accounts)

**Added 2026-05-09. Hidden from the login page on 2026-06-08, but not removed.**

The legacy "Sign in with company account" button is hidden behind `SHOW_AUTHENTIK_SSO = false` in `src/pages/LoginPage.tsx` while Microsoft/Azure is the primary company SSO path. The backend Authentik flow remains in place for compatibility and can be re-enabled by toggling that constant.

When this legacy path is re-enabled, users with a company Active Directory account log in via the "Sign in with company account" button on the login page. They are redirected to `auth.designflow.app`, authenticate with their AD credentials there, and are redirected back.

### How it works

1. **PKCE redirect** — the frontend generates a code verifier + challenge, stores the verifier in `sessionStorage`, and redirects the browser to Authentik's authorization endpoint.
2. **Authentik login** — user authenticates at `auth.designflow.app` with AD credentials.
3. **Code callback** — Authentik redirects to `https://dam.designflow.app/auth/callback` with an authorization code.
4. **Token exchange** — the `AuthCallbackPage` component exchanges the code at Authentik's token endpoint directly from the browser (public OIDC client, no secret needed).
5. **Session creation** — the `id_token` is sent to the `authenticate-with-authentik` Supabase edge function, which:
   - validates the token against Authentik's JWKS (`https://auth.designflow.app/application/o/popdam/jwks/`)
   - creates the Supabase user if this is their first login (with `app_metadata.provider = 'authentik'`)
   - returns a `token_hash`
6. **Supabase session** — the frontend calls `supabase.auth.verifyOtp({ token_hash, type: 'email' })` to exchange the hash for a live session.

### Relevant files

| File | Purpose |
|------|---------|
| `src/lib/authentik.ts` | PKCE helpers — redirect, code exchange |
| `src/pages/AuthCallbackPage.tsx` | Handles `/auth/callback`, runs steps 4–6 |
| `src/pages/LoginPage.tsx` | Contains the hidden "Sign in with company account" button |
| `supabase/functions/authenticate-with-authentik/` | Edge function — JWKS validation, user provisioning, token_hash |
| `supabase/migrations/20260509000000_authentik_invitation_bypass.sql` | Trigger change — bypasses invitation check for Authentik users |

### New user provisioning

The `handle_new_user` DB trigger normally blocks sign-ups that lack a pending invitation. When the edge function creates a new user it sets `app_metadata.provider = 'authentik'`, which the trigger detects and skips the invitation check for, auto-assigning the `user` role instead.

Existing users (anyone who already has a Supabase account) are looked up by email and linked to the same account — no duplicate is created.

### Authentik provider details

| Setting | Value |
|---------|-------|
| Authentik app slug | `popdam` |
| Client ID | `q779goioDDC4P9QzTZM9GiO7SGUraIwPlMvFPb6j` |
| Client type | public (PKCE, no client secret) |
| Redirect URI | `https://dam.designflow.app/auth/callback` |
| OIDC discovery | `https://auth.designflow.app/application/o/popdam/.well-known/openid-configuration` |

---

## Path 3 — Google OAuth

Users can sign in with a Google account via Supabase's built-in Google OAuth provider. Requires a pending invitation matching the Google account's email.

---

## Path 4 — Email / password

Users can sign up or sign in with email + password. Sign-up requires a pending invitation for that email address. Password reset is handled by Supabase's magic-link flow.

---

## Session storage

All paths produce a Supabase JWT. Sessions are stored in `localStorage` under the key `sb-popdam-auth-token` and auto-refreshed by the Supabase client. The `AuthProvider` in `src/hooks/useAuth.tsx` listens to `onAuthStateChange` and provides the session to the rest of the app.

## Backend enforcement

- **admin-api**: validates the Supabase JWT and checks the `user_roles` table for `admin` role
- **agent-api**: uses a separate `x-agent-key` — not tied to user auth
- **authenticate-with-authentik**: `verify_jwt = false` — it handles its own token validation via JWKS before creating the Supabase session
