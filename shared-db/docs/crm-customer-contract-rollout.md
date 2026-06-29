# CRM Customer Contract Rollout

Date: 2026-06-28

## Plain-English Summary

CRM used to expose customer data through names containing `account`, such as
`api.crm_account_list`. That confused future work because the real shared model
is now `core.customer`.

The safe rollout is:

1. Add customer-named CRM contracts.
2. Move CRM app code to those names.
3. Verify PM/PIM and DAM/PopSG do not call the old names.
4. Only then drop/revoke the legacy account-named compatibility objects.

## Current Shared-DB Work

Branch: `codex/crm-customer-contracts`

PR: `https://github.com/u2giants/shared-db/pull/19`

Migration:

- `supabase/migrations/20260628165000_crm_customer_contracts.sql`
- `supabase/migrations/20260629031500_crm_timeout_fixes.sql`
- `supabase/migrations/20260629033000_crm_customer_segment_timeout_fixes.sql`

Production status:

- Applied on 2026-06-28 with `supabase db push` against linked project
  `qsllyeztdwjgirsysgai`.
- Verification returned:
  - `api.crm_customer_list`: 3,777 rows
  - `api.crm_account_list`: 3,777 rows
  - `api.crm_customer_overview`: 3,777 rows
  - `api.crm_account_overview`: 3,777 rows
  - `api.crm_update_customer`: exists

Adds:

- `api.crm_customer_list`
- `api.crm_customer_overview`
- `api.crm_update_customer(p_customer_id uuid, ...)`
- `api.crm_email_routing_recent(p_limit integer default 500)`
- `api.crm_email_routing_segment_counts()`
- `api.crm_customer_segment_list(p_segment text default 'active', p_limit integer default null)`
- `api.crm_customer_segment_counts()`

Keeps, for compatibility:

- `api.crm_account_list`
- `api.crm_account_overview`
- `api.crm_update_account`

The migration is additive. It should not break existing deployed clients because
the old names stay alive.

## Timeout-Safe CRM Contracts

Browser pages must not page the entire joined `api.crm_email_routing_queue` view
to compute counts or load the Email Routing table. Production has enough email
rows that broad joined view reads can hit PostgREST statement timeouts and make
the UI show stale or empty data.

Use these contracts instead:

| Need | Contract |
|---|---|
| Recent Email Routing table rows | `api.crm_email_routing_recent(p_limit)` |
| Full Email Routing segment badges/counts | `api.crm_email_routing_segment_counts()` |
| Search a few matching historical email rows | `api.crm_email_routing_queue` with a small explicit `limit` |
| Customers table/pickers by segment | `api.crm_customer_segment_list(p_segment, p_limit)` |
| Customers tab badges/counts | `api.crm_customer_segment_counts()` |

`api.crm_email_routing_recent` deliberately caps `p_limit` to 1,000 rows and
orders/limits `crm.email_message` before joining customer, department, and
opportunity labels. This is the supported browser feed for Email Routing.

`api.crm_email_routing_segment_counts` returns full-dataset counts without
forcing the browser to page all historical emails.

The timeout migration also grants `authenticated` `SELECT` on `app.profile`.
RLS policies still control visible profile rows; the grant is needed because
`api.crm_task_list` is a `security_invoker` view that left-joins assignee
profiles.

Browser pages must also avoid broad `api.crm_customer_list?select=*` reads and
exact counts through that view. Use `api.crm_customer_segment_list` and
`api.crm_customer_segment_counts` for CRM customer page tabs and active-customer
pickers. Keep `api.crm_customer_list` available for small explicit-limit searches
or compatibility reads, not as a full browser paging contract.

## Owner Approval Needed

The owner does not need to review SQL. The approval needed is operational:

1. "Apply the additive migration to preview."
2. After preview checks pass: "Apply the additive migration to production."
3. After production has the new contracts: "Deploy CRM app commit."
4. Later, after app scans are clean: "Remove the old account compatibility
   objects."

Step 4 is the only destructive/contract-removal step.

## Naming Rules Going Forward

Use these names:

| Need | Contract |
|---|---|
| CRM customer list with CRM-owned fields | `api.crm_customer_list` |
| CRM customer overview/stats | `api.crm_customer_overview` |
| CRM guarded customer update | `api.crm_update_customer` |
| CRM recent email routing feed | `api.crm_email_routing_recent` |
| CRM email routing tab counts | `api.crm_email_routing_segment_counts` |
| CRM customer segment feed | `api.crm_customer_segment_list` |
| CRM customer segment counts | `api.crm_customer_segment_counts` |
| Shared plain customer picker/basic read | `api.customer_list` |

Do not add new callers of:

- `api.crm_account_list`
- `api.crm_account_overview`
- `api.crm_update_account`

## What Stays Named Company/Account For Now

Some names intentionally remain for compatibility and lower-risk migration:

- `core.company_source_ref`
- `company_id` foreign-key columns
- historical migration filenames and historical migration notes
- real columns such as `account_owner_profile_id`

Do not rename those as part of the CRM customer contract rollout unless a new,
explicit cross-app migration plan is written.

## App Repo Status

CRM:

- Repo: `/worksp/popcrm-web`
- Tracking file: `/worksp/popcrm-web/fix_remove_account.md`
- App commit exists locally and should be pushed only after this migration is
  applied to the target schema.

PM/PIM:

- Repo: `/worksp/poppim-web`
- Tracking file: `/worksp/poppim-web/fix_remove_account.md`
- No active `crm_account_*` callers found. PM's own `AccountsPage` is a product
  UI name, not automatically part of this CRM API cleanup.

DAM/PopSG:

- Current repo: `/worksp/popdam3`
- Tracking file: `/worksp/popdam3/fix_remove_account.md`
- Alternate/legacy checkout: `/worksp/popdam`
- Tracking file: `/worksp/popdam/fix_remove_account.md`
- No active `crm_account_*` callers found in either checkout.

PLM:

- There is shared-db PLM schema/import state, including `plm.customer_import`,
  but no separate PLM frontend app repo in this workspace that needs a code
  rename for this CRM contract change.
- PLM-related documentation should mention that `plm.customer_import.logo_url`
  feeds `api.crm_customer_list.logo_url` for CRM full-width customer logos.
- Do not invent a PLM app migration unless/until a real PLM app is migrated to
  this Supabase project.

## Verification Before CRM App Deploy

After applying the migration to preview or production:

```sql
select count(*) from api.crm_customer_list;
select count(*) from api.crm_account_list;
select count(*) from api.crm_customer_overview;
select count(*) from api.crm_account_overview;
```

Verify authenticated REST access to `api.crm_customer_list`.

Verify `api.crm_update_customer` on a safe test row, restoring the original value
in the same session.

Verify the timeout-safe email contracts under an authenticated CRM user's JWT
claims:

```sql
select count(*), max(received_at) from api.crm_email_routing_recent(500);
select * from api.crm_email_routing_segment_counts();
select count(*) from api.crm_task_list;
select count(*) from api.crm_customer_segment_list('active', -1);
select * from api.crm_customer_segment_counts();
```

Expected production behavior after `20260629031500_crm_timeout_fixes.sql`:

- `api.crm_email_routing_recent(500)` returns the newest 500 browser-safe rows
  quickly, including current emails.
- `api.crm_email_routing_segment_counts()` returns full segment counts quickly.
- `api.crm_task_list` no longer fails for browser users with
  `permission denied for table profile`.
- `api.crm_customer_segment_list('active', -1)` returns the active CRM customer
  rows quickly.
- `api.crm_customer_segment_counts()` returns active/dismissed/triage/all counts
  quickly.

## Final Removal Checklist

Only after CRM production is verified on the new names:

```bash
rg "crm_account|crm_update_account|accountSegment|AccountSegment|AccountDrawer|AccountLogo|AccountRelationLogo|AccountsPage" /worksp/popcrm-web/src
rg "crm_account|crm_update_account|accountSegment|AccountSegment" /worksp/poppim-web/src
rg "crm_account|crm_update_account|accountSegment|AccountSegment" /worksp/popdam3/src /worksp/popdam3/apps /worksp/popdam3/supabase
rg "crm_account|crm_update_account|accountSegment|AccountSegment" /worksp/popdam/src /worksp/popdam/apps /worksp/popdam/supabase
```

Expected:

- CRM: only the intentional `/accounts` redirect may mention account in active
  source. The exact banned grep should return no active hits.
- PM/PIM: no active CRM legacy callers.
- DAM/PopSG: no active CRM legacy callers.

Then create a second migration that drops or revokes:

- `api.crm_account_list`
- `api.crm_account_overview`
- `api.crm_update_account`

Regenerate app database types after the final removal.
