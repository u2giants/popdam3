# popcrm-web Supabase Migration — Session Handoff (2026-06-21)

> **Superseded for current status.** This note captures the *preview-complete*
> point in time. The schema was later promoted to **production**, Microsoft SSO
> was configured, and Directus CRM data was imported — see
> [`popcrm-web-production-cutover-20260621.md`](popcrm-web-production-cutover-20260621.md).
> The "Data migration / Not performed", "Preview test results / Not run", and
> "Known gaps → Phase 5 identity / Data import" sections below are **stale**;
> treat the cutover note as the source of truth for what is live.

CRM (`u2giants/popcrm-web`) migrated from the Directus backend to the shared
Supabase project, **preview-complete**: schema + frontend + worker are done and
validated locally; nothing touches production. The live `db push` to the preview
branch is the one remaining step (see Known Gaps).

## New migrations (this PR)

| File | Purpose |
|---|---|
| `20260621151239_crm_parity_fields.sql` | Adds the explicit columns the CRM UI/worker use onto `core.company`, `core.contact_company`, and `crm.*` (customer_status, chain_type, routing_aliases/so_patterns, opportunity program/season/division/incoterms/AI fields, email routing fields, meeting/note/task/approval fields, etc.). Additive + nullable. |
| `20260621151254_crm_integrity_triggers.sql` | Department-belongs-to-company enforcement (parity with Directus `enforce-crm-department-scope.sql`) on opportunity/email/meeting/note/task and `core.contact_company`. |
| `20260621151327_crm_api_views.sql` | `security_invoker` browser views, one per screen (see table below). No raw email bodies / transcripts / ingest payloads. |
| `20260621151359_crm_api_rpcs.sql` | `current_user_profile()` identity contract; guarded `crm_update_account` / `crm_update_contact` (core writes) and `crm_set_opportunity_stage`. |
| `20260621151419_crm_rls_realtime.sql` | `profile_select_staff` policy (assignee/owner display); realtime for meeting_note/department/approval; **exposes `api, crm, pim, core` schemas to PostgREST**. |
| `20260622043000_crm_contact_segments.sql` | Preserves `api.crm_contact_list`, adds explicit CRM access gating, and adds `api.crm_contact_segment_list` / `api.crm_contact_segment_counts` so the Contacts page can load Customer, Department, and Triage slices without eager-loading All contacts. |

Validated by applying the full chain (4 baseline + these 5) to a throwaway
Postgres 15 with Supabase auth stubs: all apply cleanly; integrity trigger,
views, and RPC guards verified functionally.

## Tables / views / RPCs per CRM screen

| Screen | Reads | Writes |
|---|---|---|
| Overview | `api.crm_account_overview`, derived from the lists below | — |
| Accounts (triage) | `api.crm_account_list` (all companies) | `api.crm_update_account` RPC |
| Accounts pickers (customers) | `api.crm_account_list` filtered `customer_status in (ACTIVE_CUSTOMER, POTENTIAL_CUSTOMER)` | — |
| Contacts | `api.crm_contact_segment_list`, `api.crm_contact_segment_counts`; `api.crm_contact_list` remains the generic contact contract | `api.crm_update_contact` RPC |
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

## Contacts segmented API contract

The CRM Contacts page should not load all contacts merely to classify rows into
tabs. The database owns that classification through
`api.crm_contact_segment_list.crm_segment`:

| Segment | Definition |
|---|---|
| `customer` | The contact's primary account has `customer_status in (ACTIVE_CUSTOMER, POTENTIAL_CUSTOMER)` and the primary relationship has no `crm_department_id`. |
| `department` | The contact's primary account has `customer_status in (ACTIVE_CUSTOMER, POTENTIAL_CUSTOMER)` and the primary relationship has a `crm_department_id`. |
| `triage` | Every other contact: no customer account, an untriaged account, or a reviewed non-customer account. |
| `all` | Count-only row in `api.crm_contact_segment_counts`; clients can load all rows from `api.crm_contact_segment_list` only after the user opens the All tab. |

`api.crm_contact_segment_list` keeps the same business columns as
`api.crm_contact_list` and appends only `crm_segment`, so frontend adapters can
continue using the same contact mapper. Counts come from
`api.crm_contact_segment_counts` so tab badges do not require a full contact load.

Access is intentionally explicit: both views are `security_invoker = false` and
contain the `app.has_app_access('crm')` gate through `api.crm_contact_list`. This
matches the browser-safe production contract and prevents profile/app-access gaps
from being mistaken for missing data. Realtime consumers must refetch the relevant
view after a short debounce; base-table realtime payloads do not include joined
company/department display fields.

Do not add server-side ordering by derived fields such as contact `name` to these
views or frontend queries. The previous Supabase cutover incident timed out on a
paged browser load when derived-field ordering/filtering was pushed through
PostgREST. Fetch the segment slice and sort/filter within the browser table.

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

Historical path: `/worksp/directus/pm-system/crm-worker-supabase.mjs` was the
first Supabase service-role port. Current runtime path:
`/worksp/popcrm-web/workers/crm-worker-supabase.mjs` — full Supabase service-role
port (outlook-ingest, reroute, fireflies-server, contact-sync, summarize,
apply-ignore-rules); endpoints `/health`, `/s/fireflies-webhook`,
`/s/opportunity-chat` preserved (chat now verifies a Supabase JWT Bearer token).
The original Directus `crm-worker.mjs` is legacy rollback/reference context only.
Worker runtime needs
`npm i @supabase/supabase-js` and `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`.

## Data migration / reconciliation

Not performed (no production Directus dump in scope this session). The preview
branch has no CRM data yet, so smoke tests need either a data load or seed rows.

## Preview test results

Not run: the preview branch DB (`xjcyeuvzkhtzsheknaiu`) is IPv6-only and was
unreachable from the migration environment (`ECONNREFUSED`) via both the Supabase
CLI and the management API, and no preview DB password was available. SQL was
instead validated on a local Postgres 15 (see above).

## Production migration status

These migrations are present in the production Supabase migration ledger:

```text
20260621150714_foundation.sql              (baseline)
20260621150815_app_core.sql                (baseline)
20260621151024_domain_tables.sql           (baseline)
20260621151155_api_rls_realtime.sql        (baseline)
20260621151239_crm_parity_fields.sql
20260621151254_crm_integrity_triggers.sql
20260621151327_crm_api_views.sql
20260621151359_crm_api_rpcs.sql
20260621151419_crm_rls_realtime.sql
20260622043000_crm_contact_segments.sql    (Contacts segmented API)
```

The production project also has older PopDAM migration versions. This repo keeps
no-op marker files for those legacy versions so Supabase CLI can run future
`supabase db push --dry-run` checks normally.

## Known gaps

- **Regenerate `database.types.ts`** from production or the active preview branch after schema changes and update app repos that rely on generated types.
- **Phase 5 identity**: configure the Azure provider in Supabase Auth and seed `app.profile` / `app.user_role` / `app.app_access` for CRM users — without a provisioned profile a signed-in user has no CRM access and lists come back empty.
- **Data import + reconciliation** (Phase 7) and **role-based RLS tests** (Phase 6) still to run against preview.
- `crm.note.opportunity_id` is `on delete cascade` (baseline) and `crm.note` has no `factory`; meeting attendees have no shared table (stored in `meeting_note.metadata`).
- RPC `coalesce` semantics mean passing `null` does not clear a contact field (edge case).
- No CRM screen or worker command still depends on Directus; the Directus worker/backend remain only as read-only rollback.

## Verification checklist for contact segments

Run these on preview before production promotion:

1. Confirm the views exist and PostgREST has reloaded:

```sql
select table_schema, table_name
from information_schema.views
where table_schema = 'api'
  and table_name in (
    'crm_contact_list',
    'crm_contact_segment_list',
    'crm_contact_segment_counts'
  )
order by table_name;
```

2. Confirm segment counts reconcile:

```sql
select sum(contact_count) filter (where crm_segment <> 'all') as segmented_total,
       max(contact_count) filter (where crm_segment = 'all') as all_total
from api.crm_contact_segment_counts;
```

3. Confirm the segmented view preserves the base contact count:

```sql
select
  (select count(*) from api.crm_contact_list) as base_count,
  (select count(*) from api.crm_contact_segment_list) as segmented_count;
```

4. Test with an authenticated CRM user, not service role, because
   `app.profile.auth_user_id` and `app.app_access` are part of the contract.
