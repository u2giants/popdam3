# Instructions For The `poppim-web` Supabase Migration Session

Read this before rewriting `u2giants/poppim-web` from Directus to Supabase.

For the full phased execution plan (audit, parity queries, read/write migration
order, RLS hardening, data load, rollback), see the standalone companion:
[poppim-web-supabase-migration-plan.md](poppim-web-supabase-migration-plan.md).

Also read:

- `docs/ai-session-instructions/shared-supabase-branch-workflow.md`
- `docs/unified-supabase-schema-map.md`
- `docs/unified-supabase-relationships.md`
- `docs/unified-supabase-migration-gaps.md`

## Target

Rewrite PM/PIM to use the shared Supabase project through the preview branch first:

```text
Preview Supabase URL: https://tcscehehgeiijilylezv.supabase.co
Production Supabase URL: https://qsllyeztdwjgirsysgai.supabase.co
```

Do not connect the rewritten PM frontend to production until the preview branch flow passes.

The target is one shared enterprise database for DAM, CRM, PM/PIM, and PLM, not a PM-specific Supabase backend.

## Database Source Of Truth

All PM database changes go in:

```text
/worksp/shared-db/supabase/migrations/
```

Do not create production SQL by hand in the Supabase dashboard. Do not keep permanent DDL only in the PM app repo.

## Existing PM Directus Collections And Target Owners

| Current Directus collection | Target |
|---|---|
| `product` | `pim.product` |
| `project` | `pim.project` |
| `design` | `pim.design` |
| `design_collection` | `pim.design_collection` |
| `stage` | `pim.stage` |
| `stage_history` | `pim.stage_history` |
| `retailer` | `core.company` |
| `buyer` | `core.contact` and `core.contact_company` |
| `licensor` | `core.licensor` |
| `property` | `core.property` |
| `factory` | `core.factory` |
| `product_type` | `core.product_type` |
| `season` | `pim.design_collection.season` or a future `core.reference_value` if shared |
| `order` | `pim.customer_order`, linked to `plm.production_order` when known |
| `product_submission` | `pim.product_submission` |
| `product_sample` | `pim.product_sample` |
| `revision_request` | `pim.revision_request` |
| `checklist_item` | `pim.checklist_item` |
| `subtask` | `pim.checklist_item` or a future child table if needed |
| `product_assignee` | `pim.product_assignee` |
| `product_file` | `pim.product_file`, linked to `app.file_object` or `dam.asset` |
| `product_update` | `pim.product_update` or `app.activity` |
| `product_tag` | `pim.product_tag` |
| `product_field` | `pim.product_field` |
| `product_activity` | `app.activity` or preserved ingest/parity rows |
| `product_link` | `pim.product_link` |
| `product_time_entry` | `pim.product_time_entry` |
| `pm_saved_view` | `pim.saved_view` |
| `pm_view_pref` | `pim.view_pref` |
| `directus_users` | `app.profile` |
| `directus_roles` | `app.role` and `app.user_role` |
| `directus_files` | `app.file_object` for generic files; `dam.asset` for DAM-managed assets |
| `directus_comments` | `app.comment` |

Do not duplicate customers, buyers, licensors, properties, product types, factories, DAM assets, or PLM items inside `pim`.

## Preferred Frontend Contracts

Existing useful views:

```text
api.pm_product_board
api.pm_product_assets
api.plm_item_status
api.global_search
```

Add PM-specific API contracts as needed, for example:

```text
api.pm_project_board
api.pm_workflow_queue
api.pm_product_detail
api.pm_order_status
api.pm_saved_view_options
```

Use API views/RPCs for joined board/detail data instead of making the frontend perform fragile multi-table stitching everywhere.

## DAM And PLM Linking

PM should link to DAM and PLM records, not copy them.

Use:

```text
pim.product.plm_item_id -> plm.item.id
pim.product_style_group -> dam.style_group
pim.design.primary_asset_id -> dam.asset.id
pim.design_asset -> dam.asset
pim.customer_order.production_order_id -> plm.production_order.id
```

When matching SKU/style/item records, preserve confidence and source refs. Do not auto-merge uncertain SKU matches.

## Realtime

PM should subscribe to user-facing workflow movement:

```text
pim.product
pim.stage_history
pim.product_submission
pim.product_sample
pim.revision_request
pim.customer_order
pim.product_assignee
app.comment
app.notification
app.activity
```

If a PM action should update CRM immediately, do not dual-write from browser code. Add a migration with a trigger or service-side function that writes:

```text
crm.opportunity
crm.task
app.activity
```

## RLS Requirements

Before exposing PM screens:

- Verify designers cannot see pricing/cost fields.
- Verify vendors still cannot see products/orders until vendor row scoping exists.
- Verify sales/licensing/designer write permissions match the intended workflow.
- Verify PLM/RFQ/cost tables are not exposed directly through broad views.
- Verify saved views are scoped by owner or role.

The baseline RLS is a scaffold. Tighten it before production if a screen exposes sensitive product/order/PLM fields.

## PM Preview-Branch Procedure

From `/worksp/shared-db`:

```bash
supabase link --project-ref tcscehehgeiijilylezv
scripts/check-sql.sh
supabase db push --dry-run
supabase db push
```

Then configure `poppim-web` to use:

```text
Supabase URL: https://tcscehehgeiijilylezv.supabase.co
Supabase anon key: get from the preview branch dashboard or approved secret store
```

Do not commit Supabase anon keys, service-role keys, or `.env` files.

## PM Production Promotion

After preview testing passes:

1. Commit PM migrations to `u2giants/shared-db`.
2. Commit PM frontend changes to `u2giants/poppim-web`.
3. In `shared-db`, link production:

   ```bash
   supabase link --project-ref qsllyeztdwjgirsysgai
   ```

4. Run:

   ```bash
   supabase db push --dry-run
   ```

5. Confirm the dry-run lists only approved baseline and PM migrations.
6. Apply during the approved production window:

   ```bash
   supabase db push
   ```

7. Switch PM production environment variables to:

   ```text
   https://qsllyeztdwjgirsysgai.supabase.co
   ```

8. Smoke test boards, product detail, project detail, submissions, samples, revisions, order/status surfaces, saved views, assignments, comments, and file/asset surfaces.

## Required PM Handoff

Leave a note under:

```text
docs/app-migration-notes/poppim-web-YYYYMMDD.md
```

Include:

- Supabase tables/views/RPCs used by each PM screen.
- New migrations added.
- RLS policies changed.
- Realtime subscriptions used.
- Preview branch test results.
- Exact production migrations to apply.
- Known gaps or screens still using Directus.
