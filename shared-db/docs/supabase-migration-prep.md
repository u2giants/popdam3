# Supabase Migration Preparation

This is the working plan for moving the shared POP backend from the current Directus-owned Postgres database to either Supabase Cloud or a self-hosted Supabase stack.

The first principle is boring on purpose: treat the Directus database as the source of truth, make a reversible Postgres-level copy, and rebuild app/auth/automation behavior explicitly. Do not point production frontends at Supabase until row-level security, auth mapping, file URLs, and scheduled jobs have all been rehearsed on a disposable target.

## Current Source

- Production API/Data Studio: `https://data.designflow.app`
- Source database: Postgres 16 container `directus-db-nzli85mk3luzb6u7cnq5fidu`
- Runtime owner: Coolify service `nzli85mk3luzb6u7cnq5fidu`
- Product images and ClickUp attachments: mostly DigitalOcean Spaces URLs stored in `product.cover_url` and `product_file.stored_url` / `thumbnail_url`
- Directus system metadata: roles, policies, permissions, Flows, presets, users, collections, fields, and relations live in the same database but are not Supabase-native behavior

## Non-Negotiables

- Take a fresh production dump before every rehearsal restore.
- Preserve all `external_id` / `external_source` fields; they are the dedupe spine for ClickUp, Twenty/CRM, workflow backfills, and PLM syncs.
- Keep Entra as the **identity provider** (Microsoft SSO login). Note: the old Directus→Entra **role-group mirror** (`directus-entra-sync`, "Model B") was **retired 2026-06-21** — nothing ever consumed the six `POP PIM ·` groups. Supabase still needs its own app-side role/claim mechanism; do **not** resurrect the Entra group mirror as that mechanism.
- Keep DigitalOcean Spaces as canonical file storage during the first migration unless there is a separate storage-migration test. Moving DB and object storage at the same time increases risk.
- Rebuild Directus Flows, host timers, and Directus extension behavior before cutover.
- Do not use Directus API exports as the main migration path. Use Postgres dumps/restores so SQL-managed additions such as PLM tables and constraints are included.

## Cloud vs Self-Hosted Decision Points

Supabase Cloud is likely the fastest target when:

- The compressed dump and restore duration fit an acceptable maintenance window.
- Required extensions are available on the chosen project tier.
- You are comfortable with managed Postgres access patterns, backups, and network import constraints.
- Supabase Auth/Storage defaults are enough after configuration.

Self-hosted Supabase is likely better when:

- You need full control over restore mechanics, local volumes, extension availability, or network placement near the existing Coolify workloads.
- You want a rehearsal target on the same VPS or private network before buying into Cloud.
- You are willing to own Kong, Auth, REST, Realtime, Storage, SMTP, backups, upgrades, monitoring, and secrets.

Either path needs the same schema/data rehearsal and RLS design.

## Preparation Inventory

Run the read-only audit:

```bash
POPPIM_ENV_FILE=/home/ai/.directus-deploy.env \
DX_URL=https://data.designflow.app \
node pm-system/migration/supabase-readiness-audit.mjs
```

The script writes JSON and Markdown reports under:

```text
pm-system/migration/reports/
```

Those reports are for migration planning. Treat them as operational artifacts rather than source docs because they contain live table names, row counts, metadata ids, role names, and file-storage summaries.

First live audit on 2026-06-19:

- 72 public tables, including 26 application tables and 29 Directus system tables.
- Largest tables: `directus_activity` 546,409 rows, `directus_revisions` 508,141 rows, `checklist_item` 33,325 rows, `directus_sessions` 32,520 rows, `product_file` 20,281 rows, `stage_history` 18,573 rows, `product` 17,859 rows.
- Directus behavior to replace: 6 roles, 8 policies, 706 permissions, 2 Flows, 5 presets, and 3 registered extensions.
- File state: `directus_files` has 1 local file row, `product.cover_url` has 9,107 Spaces URLs and 0 non-Spaces URLs, `product_file` has 20,234 stored objects and 47 unstored source URLs.

## Recommended Dump Shape

For rehearsal restores, start with a custom-format dump:

```bash
npm run supabase:dump
```

Keep the existing SQL backup style as a fallback if desired, but custom-format dumps are easier to restore selectively and inspect with `pg_restore --list`.

## Restore Rehearsal Shape

For a disposable Supabase target:

```bash
pg_restore \
  --dbname "$SUPABASE_DATABASE_URL" \
  --no-owner \
  --no-acl \
  --clean \
  --if-exists \
  pm-system/backups/directus-to-supabase-<stamp>.dump
```

Then run the readiness audit against the target by setting `DATABASE_URL="$SUPABASE_DATABASE_URL"` and compare the generated reports.

## Behavior To Rebuild

Directus objects that do not automatically become Supabase behavior:

- Roles and policies: replace with Supabase Auth user metadata/custom claims plus Postgres RLS.
- Field-level permissions: replace with views, column grants, or API-layer shaping.
- Flows and operations: replace with Postgres triggers, Edge Functions, pg_cron, or frontend/backend app workflows.
- Presets and Data Studio layouts: replace with frontend saved views or admin-only tooling.
- Marketplace/extensions: replace with frontend components, Edge Functions, or separate services.
- Directus users/sessions/tokens: do not assume they transfer to Supabase Auth.

Host-side jobs to account for:

- ~~`directus-entra-sync.timer`: role mirror to Entra.~~ **Retired 2026-06-21** — removed, not migrating (nothing consumed the Entra groups).
- `plm-sync.timer`: Designflow PLM master-data sync.
- CRM timers under `pm-system/systemd/`.

## Initial RLS Sketch

Start restrictive and add access deliberately:

- `Administrator`: full access through service-role tooling and admin UI paths.
- `Sales`: CRM/customer/opportunity/order reads and permitted writes.
- `Licensing`: product/project/licensor/property/submission workflow access.
- `Designer`: product/design/workflow reads without pricing fields; design/workflow writes as needed.
- `Viewer`: read-only business data.
- `Vendor`: no product/order/workflow access until per-vendor row scoping exists.

The current Directus Designer policy hides pricing fields. In Supabase, do not expose base tables directly to that role until pricing columns are protected by views, grants, or an API facade.

## Cutover Rehearsal Checklist

1. Generate a source readiness audit.
2. Take a fresh custom-format dump.
3. Restore to disposable Supabase.
4. Generate a target readiness audit and compare table/row/index/FK counts.
5. Run frontend read-only smoke tests against target APIs or a temporary compatibility API.
6. Implement Supabase Auth + Entra login mapping.
7. Implement RLS and verify each role with real test users.
8. Rebuild scheduled jobs and Flow replacements.
9. Verify Spaces URLs and any `directus_files` references.
10. Run a final delta/import strategy or schedule a write freeze before production cutover.

## Open Questions

- Will Supabase expose tables directly to the PM/CRM/DAM frontends, or will there be a compatibility API layer?
- Should Directus remain available read-only as an admin/reference tool for a short period after cutover?
- Will product and attachment objects stay in DigitalOcean Spaces long-term, or should Supabase Storage mirror them?
- How should Entra group membership become Supabase Auth claims without making the browser trusted for authorization?
- What is the acceptable write-freeze window for final cutover?
