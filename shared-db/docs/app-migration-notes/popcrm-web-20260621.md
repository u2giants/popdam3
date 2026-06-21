# popcrm-web Supabase Migration — Session Handoff (2026-06-21)

CRM (`u2giants/popcrm-web`) migrated from the Directus backend to the shared
Supabase project, **preview-complete**: schema + frontend + worker are done and
validated locally; nothing touches production. The live `db push` to the preview
branch is the one remaining step (see Known Gaps).

## New migrations (this PR)

| File | Purpose |
|---|---|
| `20260621110000_crm_parity_fields.sql` | Adds the explicit columns the CRM UI/worker use onto `core.company`, `core.contact_company`, and `crm.*` (customer_status, chain_type, routing_aliases/so_patterns, opportunity program/season/division/incoterms/AI fields, email routing fields, meeting/note/task/approval fields, etc.). Additive + nullable. |
| `20260621110100_crm_integrity_triggers.sql` | Department-belongs-to-company enforcement (parity with Directus `enforce-crm-department-scope.sql`) on opportunity/email/meeting/note/task and `core.contact_company`. |
| `20260621110200_crm_api_views.sql` | `security_invoker` browser views, one per screen (see table below). No raw email bodies / transcripts / ingest payloads. |
| `20260621110300_crm_api_rpcs.sql` | `current_user_profile()` identity contract; guarded `crm_update_account` / `crm_update_contact` (core writes) and `crm_set_opportunity_stage`. |
| `20260621110400_crm_rls_realtime.sql` | `profile_select_staff` policy (assignee/owner display); realtime for meeting_note/department/approval; **exposes `api, crm, pim, core` schemas to PostgREST**. |

Validated by applying the full chain (4 baseline + these 5) to a throwaway
Postgres 15 with Supabase auth stubs: all apply cleanly; integrity trigger,
views, and RPC guards verified functionally.

## Tables / views / RPCs per CRM screen

| Screen | Reads | Writes |
|---|---|---|
| Overview | `api.crm_account_overview`, derived from the lists below | — |
| Accounts (triage) | `api.crm_account_list` (all companies) | `api.crm_update_account` RPC |
| Accounts pickers (customers) | `api.crm_account_list` filtered `customer_status in (ACTIVE_CUSTOMER, POTENTIAL_CUSTOMER)` | — |
| Contacts | `api.crm_contact_list` | `api.crm_update_contact` RPC |
| Departments | `api.crm_department_list` | `crm.department` (direct) |
| Pipeline / Programs | `api.crm_opportunity_list` | `crm.opportunity` (direct), `api.crm_set_opportunity_stage` |
| Email Routing | `api.crm_email_routing_queue` | `crm.email_message` (direct), `crm.ignore_rule` |
| Meetings | `api.crm_meeting_list` | `crm.meeting_note` |
| Notes | `api.crm_note_list` | `crm.note` |
| Tasks | `api.crm_task_list` | `crm.task` |
| Approvals | `api.crm_approval_queue` | `crm.licensor_approval_thread` |
| Settings | `api.crm_ai_model_config_list`, `api.crm_ignore_rule_list` | `crm.ai_model_config` |
| Auth | `api.current_user_profile()` RPC | Supabase Auth (Azure OAuth + password) |

The "curated customers vs full ingested registry" split (Directus
`retailer`/`buyer` vs `ingested_domains`/`ingested_contact`) is collapsed to one
`core.company`/`core.contact`, filtered by `customer_status` in the frontend.

## RLS changes

- `app.profile`: added `profile_select_staff` (any role can read profiles) so the
  CRM can display assignee/owner/salesperson names under `security_invoker` views.
- Account/contact writes go through `security definer` RPCs guarded by
  `app.has_app_access('crm')`, so baseline `core` admin-only write RLS stays intact.
- `crm.*` writes rely on the existing baseline `crm_write` policy (sales/licensing/admin).

## Realtime

Baseline already publishes `crm.opportunity/task/note/email_message`. Added
`crm.meeting_note`, `crm.department`, `crm.licensor_approval_thread`.

## Frontend (popcrm-web, committed in that repo)

- Removed `@directus/sdk`; added `@supabase/supabase-js`.
- New `src/lib/supabase.ts`; generated `src/lib/database.types.ts` (from the
  validated local schema — regenerate from preview once reachable).
- Rewrote `src/auth/auth.tsx` (Supabase Auth + `current_user_profile`),
  `src/pages/LoginPage.tsx` (Azure OAuth), `src/features/crm/api.ts` (api views +
  adapters + mapped writes), `src/lib/types.ts` (`AppUser`).
- `CrmDataContext` `Promise.allSettled` resilience preserved.
- `npm run build` passes; `npm run lint` 0 errors, 0 new warnings.
- Env: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_LOGODEV_TOKEN`.

## Worker

`/worksp/directus/pm-system/crm-worker-supabase.mjs` — full Supabase service-role
port (outlook-ingest, reroute, fireflies-server, contact-sync, summarize,
apply-ignore-rules); endpoints `/health`, `/s/fireflies-webhook`,
`/s/opportunity-chat` preserved (chat now verifies a Supabase JWT Bearer token).
The original Directus `crm-worker.mjs` is kept for rollback. Worker runtime needs
`npm i @supabase/supabase-js` and `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`.

## Data migration / reconciliation

Not performed (no production Directus dump in scope this session). The preview
branch has no CRM data yet, so smoke tests need either a data load or seed rows.

## Preview test results

Not run: the preview branch DB (`tcscehehgeiijilylezv`) is IPv6-only and was
unreachable from the migration environment (`ECONNREFUSED`) via both the Supabase
CLI and the management API, and no preview DB password was available. SQL was
instead validated on a local Postgres 15 (see above).

## Production promotion checklist (exact migrations)

Apply in this order, preview first then production, via `supabase db push`:

```text
20260621000100_foundation.sql              (baseline — if not already on target)
20260621000200_app_core.sql                (baseline)
20260621000300_domain_tables.sql           (baseline)
20260621000400_api_rls_realtime.sql        (baseline)
20260621110000_crm_parity_fields.sql       (this PR)
20260621110100_crm_integrity_triggers.sql  (this PR)
20260621110200_crm_api_views.sql           (this PR)
20260621110300_crm_api_rpcs.sql            (this PR)
20260621110400_crm_rls_realtime.sql        (this PR)
```

Production (`qsllyeztdwjgirsysgai`) does **not** yet have the baseline migrations,
so a first push there will include them — confirm that is intended or split the rollout.

## Known gaps

- **Apply to preview** (`supabase link --project-ref tcscehehgeiijilylezv && supabase db push`) from a network that can reach the branch DB, then **regenerate `database.types.ts`** from preview and set preview env vars.
- **Phase 5 identity**: configure the Azure provider in Supabase Auth and seed `app.profile` / `app.user_role` / `app.app_access` for CRM users — without a provisioned profile a signed-in user has no CRM access and lists come back empty.
- **Data import + reconciliation** (Phase 7) and **role-based RLS tests** (Phase 6) still to run against preview.
- `crm.note.opportunity_id` is `on delete cascade` (baseline) and `crm.note` has no `factory`; meeting attendees have no shared table (stored in `meeting_note.metadata`).
- RPC `coalesce` semantics mean passing `null` does not clear a contact field (edge case).
- No CRM screen or worker command still depends on Directus; the Directus worker/backend remain only as read-only rollback.
