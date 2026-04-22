---
name: PopSG sister app
description: Sister DAM app for licensor style guides — separate Supabase, separate Lovable project, shared auth via app_access table, shared bridge agent
type: feature
---

# PopSG (sister app to PopDAM)

## Purpose
Separate DAM app for licensor **style guides** (art libraries, no products). Ingests from `/volume1/styleguides/` on the same NAS.

## Hard constraints
- **Separate Supabase project** (not Lovable Cloud, external supabase.com)
- **Same Bridge Agent** (multi-tenant; loops over PopDAM + PopSG roots)
- **Same Google OAuth credentials** (cross-app login via `app_access` table)
- **Light theme** (PopDAM is dark)
- **Different URL** (planned: `sg.designflow.app`)
- **Folder-based grouping**: depth-2 folder = style guide name (filenames have no logic)

## PopSG Supabase coordinates
- Project URL: `https://eeueczxhezfhyrhdmidg.supabase.co`
- Project ref: `eeueczxhezfhyrhdmidg`
- Anon key: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVldWVjenhoZXpmaHlyaGRtaWRnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2NTUyNDQsImV4cCI6MjA5MjIzMTI0NH0.EZuS09HZnHu365I0Kt0Uf0EMt-Q0x0j2IzN9xTbU9WU`
- Google OAuth callback added to popdam Google Cloud client: `https://eeueczxhezfhyrhdmidg.supabase.co/auth/v1/callback`

## PopDAM-side foundation (DONE)
- `app_name` enum (`popdam`, `styleguides`)
- `app_access` table with RLS
- `invitations.apps` column
- `handle_new_user()` grants apps from invitation
- `verify-app-access` edge function (called by PopSG to validate JWTs)
- Admin UI shows per-user app checkboxes

## Cross-app auth model
- PopSG frontend signs users into **PopSG's** Supabase auth (separate user pool from PopDAM).
- For shared identity, the long-term plan is: PopSG calls PopDAM's `verify-app-access` edge function with the user's PopDAM JWT.
- OR (simpler): each user has separate accounts in each Supabase, and `app_access` is replicated per-app. **Decision pending.**

## Repo strategy
Separate repo: `https://github.com/u2giants/popsg`. New Lovable project pushes there.

## Bridge Agent v2 (DONE in this repo)
`apps/bridge-agent/src/tenant-supervisor.ts` already supports `TENANTS=[{name,server_url,agent_key,scan_roots,do_spaces,...}]`. Per-tenant config at `/data/agent-config-<tenant>.json`. See `docs/MULTI_TENANT_AGENTS.md`.

## PopSG project state (as of 2026-04-22)
- Lovable project id: `dff64d7c-76d5-4775-b519-5fde11a819c4`, URL `https://popsg.lovable.app`
- TanStack Start scaffold live with `__root.tsx`, `_authenticated.tsx` guard, placeholder dashboard, login/forgot/reset/oauth-callback routes
- Auth wired to external Supabase via `src/lib/external-supabase.ts` (Lovable Cloud is enabled but bypassed)
- Migrations applied: profiles + user_roles + app_role enum + has_role + handle_new_user trigger; app_name enum + app_access table; signup auto-grants 'styleguides'
- u2giants@gmail.com **not yet** promoted to admin (auth user must exist first)
- Pending RLS hardening on user_roles was proposed but not approved — verify and re-propose
- **Missing for v1:** style_guide_files / style_guide_crawl_runs / agent_registrations / agent_pairings / admin_config / invitations tables; agent-api + admin-api edge functions; /library browse UI; /settings tabs
- Master build brief written to `/mnt/documents/POPSG_SESSION_PROMPT.md` for handoff to PopSG session

## Bridge Agent thumbnail follow-up (TODO in this repo, AFTER PopSG v1 ships)
Extend `apps/bridge-agent/src/style-guide-crawler.ts` to generate thumbnails for style guide files (PDF/AI/JPG) and POST them to PopSG's `report_thumbnail` route. Upload to DO Spaces bucket `popsg` (separate from `popdam`).
