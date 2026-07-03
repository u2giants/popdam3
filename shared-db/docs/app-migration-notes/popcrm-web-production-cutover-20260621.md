# popcrm-web — Production Cutover (2026-06-21)

This records the **production** cutover of POP CRM (`u2giants/popcrm-web`) from
Directus to the shared Supabase backend. It supersedes the "preview-complete /
nothing touches production" framing in
[`popcrm-web-20260621.md`](popcrm-web-20260621.md): the schema is now applied to
production, Microsoft SSO is live, Directus CRM data is imported, and
`crm.designflow.app` serves Supabase. Directus (`data.designflow.app`) remains
running as the import source and rollback-only — no CRM screen or worker talks to
it anymore.

Production project ref: **`qsllyeztdwjgirsysgai`**.

## What changed

### Schema promoted to production
The 9 CRM migrations (4 baseline + 5 CRM) plus follow-ups were applied to
`qsllyeztdwjgirsysgai` via the Supabase Management API (`apply_migration`). The
baseline three (`foundation`, `app_core`, `domain_tables`) were applied with
`IF NOT EXISTS` / `DO $$ ... duplicate_object` guards so they coexist with the
pre-existing PopDAM objects on the shared project. Production ledger entries:

```text
20260621150714_foundation                 20260621151359_crm_api_rpcs
20260621150815_app_core                   20260621151419_crm_rls_realtime
20260621151024_domain_tables              20260621162220_crm_auth_provision
20260621151155_api_rls_realtime           20260621164759_service_role_grants
20260621151239_crm_parity_fields          20260621165140_clear_partial_migration_data
20260621151254_crm_integrity_triggers     20260622043000_crm_contact_segments
20260621151327_crm_api_views
```

All of these now exist as files here (PR "Align migrations with production
history" reconciled them). Do not edit applied migrations.

### Microsoft (Azure) SSO — configured on production
- Azure app registration: **"POP CRM — Supabase Auth"**
  - client (app) id: `2dcdf25f-5995-4459-a09b-69a0eff51ae0`
  - tenant id: `1caeb1c0-a087-4cb9-b046-a5e22404f971`
  - redirect URI: `https://qsllyeztdwjgirsysgai.supabase.co/auth/v1/callback`
  - A dedicated registration (not the shared "Authentik SSO" app) so its redirect
    list and secret are isolated.
- Enabled on Supabase via Management API
  (`PATCH /v1/projects/{ref}/config/auth`, `external_azure_*`), issuer
  `https://login.microsoftonline.com/{tenant}/v2.0`.
- **The client secret is stored only in the Supabase Auth config and Azure.** It
  is not in any repo and is not reproduced here.

### Auto-provision trigger (identity)
`20260621162220_crm_auth_provision.sql` — `app.handle_new_auth_user()` on
`auth.users` INSERT (trigger `on_auth_user_created`):
- upserts `app.profile` (by `auth_user_id`) on first SSO login,
- grants `app.app_access('crm')` to every new user (single-app context; admins can
  revoke),
- grants the `administrator` role to the owner email `u2giants@gmail.com`.

Effect: staff can sign in with Microsoft and immediately have CRM access; no manual
profile seeding. This closes the "Phase 5 identity" gap from the preview note.

2026-07-03 follow-up:
`20260703172500_fix_crm_auth_profile_email_link.sql` updates
`app.handle_new_auth_user()` so first SSO login links a pre-seeded
`app.profile` by matching email before inserting a new row. Without this, imported
staff profiles with `email` set and `auth_user_id` null can make Supabase Auth
abort with `Database error saving new user` because `app.profile.email` is
unique. The migration was applied to preview and production; verification is in
`docs/verification/crm-auth-profile-link-20260703.md`.

2026-07-03 follow-up 2:
`20260703220000_fix_crm_auth_profile_mismatched_email_relink.sql` extends the
same trigger to relink a matching CRM profile when its existing `auth_user_id`
points at an Auth user with a different email. This fixed `adweck@popcre.com`,
whose CRM profile was linked to an older Google Auth user with a different
email. Production inspection found this was the only mismatched-email CRM
profile at the time of the fix.

### service_role grants
`20260621164759_service_role_grants.sql` — usage + ALL on tables/sequences for
`app, core, crm, pim, plm, ingest, api`, plus default privileges on
`app/core/crm`. Needed because the data-import script and any server-side worker
use the service-role key, which otherwise has no rights on non-`public` schemas.

### PostgREST schema exposure
Set to `public,graphql_public,api,crm,pim,core` via
`PATCH /v1/projects/qsllyeztdwjgirsysgai/postgrest`. The SQL in
`crm_rls_realtime` that tries to set `pgrst.db_schemas` does **not** work on hosted
Supabase — see AGENTS.md §9. This must be re-confirmed after any restore.

### Frontend cutover (popcrm-web `main`)
- `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` added as GitHub Actions secrets and
  wired as Docker **build-args** (baked into the static bundle); `Dockerfile` and
  `.github/workflows/deploy.yml` updated. One image serves both
  `crm.designflow.app` and `crm-dev.designflow.app`.
- `src/lib/database.types.ts` regenerated from production with
  `--schema public,api,crm,core,app` (without the extra `--schema` flags the
  generator emits `public` only and the CRM `api.*`/`crm.*` calls fail to typecheck).
- Deployed via the normal CI/CD path; `crm.designflow.app` is live on Supabase.

## Data import (Directus → Supabase, one-time)

Imported with a one-off Node script using the service-role key (reads Directus REST
with an admin token, upserts into Supabase). Counts loaded:

| Directus collection | Supabase target | Rows |
|---|---|---|
| `retailer` | `core.company` (`company_type='customer'`, CRM parity fields) | 105 |
| `buyer` | `core.contact` + `core.contact_company` | 747 / 743 rels |
| `crm_department` | `crm.department` (+ `primary_contact_id` backfill) | 38 |
| `crm_meeting_note` | `crm.meeting_note` | 27 |
| `crm_email_message` | `crm.email_message` (batched 500) | 11266 |

`crm_opportunity`, `crm_note`, `crm_task`, `crm_ai_model_config`,
`crm_ignore_rule`, `crm_licensor_approval_thread` were empty in Directus → nothing
to import.

Import gotchas (also in AGENTS.md §9):
- Directus row UUIDs were reused as Supabase PKs so department/contact/meeting/email
  FKs resolve without a remap table.
- `unique nulls not distinct (external_source, external_id)` forced setting
  `external_source='directus'` + `external_id=<directus id>` on each row; leaving
  both NULL collides after the first row.
- A few `crm_meeting_note` / `crm_email_message` rows referenced **deleted**
  retailers; those `company_id`/`department_id`/`contact_id` were set to NULL rather
  than importing dangling FKs.

## Affected apps
CRM only. The `service_role` grants and PostgREST/Management-API exposure steps are
shared infrastructure that PM/PIM will also depend on when it exposes `pim`.

## Verified
- All 12 migrations present in the production ledger; `core`/`crm`/`api` objects
  exist.
- `crm.department`: FK `department_company_id_fkey → core.company(id) ON DELETE
  CASCADE`, column `NOT NULL`, **0 orphan rows** out of 38 (checked via
  `pg_constraint` + a left-join count — PostgREST embed reports no relationship for
  cross-schema FKs, which is a cache quirk, not a missing constraint).
- Azure app registration exists with the correct callback (re-confirmed
  2026-06-25).
- `crm.designflow.app` serves the Supabase build (login shows "Continue with
  Microsoft").

## Risks / still open
- **RLS role tests** with real per-role SSO users (sales / licensing / designer /
  viewer / vendor) not yet run end-to-end against production.
- **CRM worker**: the Supabase service-role port
  (`crm-worker-supabase.mjs`) and its `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`
  runtime config — confirm it is the deployed worker, not the Directus original.
- The auto-provision trigger grants `crm` access to **any** successful SSO user.
  Acceptable for a single internal app today; tighten if the shared project starts
  hosting externally-authenticated users.
- CRM SSO provisioning now depends on `app.profile.email` being a stable
  case-insensitive staff identifier when linking pre-seeded profiles. If identity
  imports ever allow duplicate or placeholder emails, revisit the trigger before
  changing profile uniqueness.
- Directus stays up as rollback/import source; do not delete it until the cutover
  has soaked.
