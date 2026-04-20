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
Separate repo: `u2giants/popsg`. New Lovable project pushes there.

## Bridge Agent v2 (TODO in this repo)
Refactor `apps/bridge-agent/` to support `TENANTS=[{name,server_url,agent_key,scan_roots},...]`:
- Loop scanner per tenant
- Per-tenant agent-config.json: `/data/agent-config-<tenant>.json`
- Heartbeat to each tenant's `agent-api`
- One Docker container, multiple cloud backends
