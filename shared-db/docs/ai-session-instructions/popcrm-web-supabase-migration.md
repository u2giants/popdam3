# Instructions For The `popcrm-web` Supabase Migration Session

Read this before rewriting `u2giants/popcrm-web` from Directus to Supabase.

Also read:

- `docs/ai-session-instructions/shared-supabase-branch-workflow.md`
- `docs/unified-supabase-schema-map.md`
- `docs/unified-supabase-relationships.md`
- `docs/unified-supabase-migration-gaps.md`

## Target

Rewrite CRM to use the shared Supabase project through the preview branch first:

```text
Preview Supabase URL: https://tcscehehgeiijilylezv.supabase.co
Production Supabase URL: https://qsllyeztdwjgirsysgai.supabase.co
```

Do not connect the rewritten CRM frontend to production until the preview branch flow passes.

The target is one shared enterprise database for DAM, CRM, PM/PIM, and PLM, not a CRM-specific Supabase backend.

## Database Source Of Truth

All CRM database changes go in:

```text
/worksp/shared-db/supabase/migrations/
```

Do not create production SQL by hand in the Supabase dashboard. Do not keep permanent DDL only in the CRM app repo.

## Existing CRM Directus Collections And Target Owners

| Current Directus collection | Target |
|---|---|
| `retailer` | `core.company` |
| `ingested_domains` | `core.company_source_ref` or `ingest.raw_record` |
| `buyer` | `core.contact` and `core.contact_company` |
| `ingested_contact` | `core.contact_source_ref` or `ingest.raw_record` |
| `factory` | `core.factory` |
| `project` | `pim.project` |
| `crm_department` | `crm.department` |
| `crm_opportunity` | `crm.opportunity` |
| `crm_email_message` | `crm.email_message` |
| `crm_meeting_note` | `crm.meeting_note` |
| `crm_ignore_rule` | `crm.ignore_rule` |
| `crm_ai_model_config` | `crm.ai_model_config` |
| `crm_note` | `crm.note` or `app.comment` if it becomes cross-domain |
| `crm_task` | `crm.task` |
| `crm_licensor_approval_thread` | `crm.licensor_approval_thread` |
| `directus_users` | `app.profile` |

If a missing CRM field is needed, add it to the appropriate canonical table with a migration. Do not create a second customer, buyer, project, or factory table in `crm`.

## Preferred Frontend Contracts

Use browser-facing views/RPCs in `api` when a screen needs joined data.

Existing useful views:

```text
api.crm_account_overview
api.global_search
```

Add CRM-specific API contracts as needed, for example:

```text
api.crm_opportunity_board
api.crm_department_contacts
api.crm_account_timeline
api.crm_approval_queue
```

Keep raw email bodies and ingest details out of broad browser views. Store raw/sensitive payload references in `crm.email_message.body_storage_ref`, `ingest.raw_record`, or a service-only table.

## Realtime

CRM should subscribe to user-facing tables or API-backed contracts around:

```text
crm.opportunity
crm.task
crm.note
crm.email_message
app.comment
app.notification
app.activity
```

If a CRM opportunity action should move PM work immediately, do not dual-write from browser code. Add a migration with a trigger or service-side function that writes the canonical PM table, such as:

```text
pim.project
pim.product
pim.stage_history
```

## RLS Requirements

Before exposing a CRM screen:

- Verify authenticated users can read only the intended rows.
- Verify raw email/meeting content is not exposed through generic views.
- Verify sales/licensing roles can write only expected CRM records.
- Verify vendor users have no CRM account/order leakage unless explicitly scoped.

The current baseline RLS is a scaffold. If the frontend requires broader access, update RLS intentionally in `shared-db`, with comments explaining why.

## CRM Preview-Branch Procedure

From `/worksp/shared-db`:

```bash
supabase link --project-ref tcscehehgeiijilylezv
scripts/check-sql.sh
supabase db push --dry-run
supabase db push
```

Then configure `popcrm-web` to use:

```text
Supabase URL: https://tcscehehgeiijilylezv.supabase.co
Supabase anon key: get from the preview branch dashboard or approved secret store
```

Do not commit Supabase anon keys, service-role keys, or `.env` files.

## CRM Production Promotion

After preview testing passes:

1. Commit CRM migrations to `u2giants/shared-db`.
2. Commit CRM frontend changes to `u2giants/popcrm-web`.
3. In `shared-db`, link production:

   ```bash
   supabase link --project-ref qsllyeztdwjgirsysgai
   ```

4. Run:

   ```bash
   supabase db push --dry-run
   ```

5. Confirm the dry-run lists only approved baseline and CRM migrations.
6. Apply during the approved production window:

   ```bash
   supabase db push
   ```

7. Switch CRM production environment variables to:

   ```text
   https://qsllyeztdwjgirsysgai.supabase.co
   ```

8. Smoke test account overview, opportunity board, contacts, departments, tasks, notes, email/meeting surfaces, and approval threads.

## Required CRM Handoff

Leave a note under:

```text
docs/app-migration-notes/popcrm-web-YYYYMMDD.md
```

Include:

- Supabase tables/views/RPCs used by each CRM screen.
- New migrations added.
- RLS policies changed.
- Realtime subscriptions used.
- Preview branch test results.
- Exact production migrations to apply.
- Known gaps or screens still using Directus.
