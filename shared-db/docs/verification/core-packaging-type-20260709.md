# Core Packaging Type Verification — 2026-07-09

## What changed

Migration `supabase/migrations/20260709144500_core_packaging_type.sql` added
`core.packaging_type`, a shared packaging-type lookup table for DAM and future
cross-app pickers.

The table includes:

- `id`, `name`, generated `normalized_name`, optional `code`, `status`,
  `metadata`, `created_at`, and `updated_at`.
- Unique indexes for normalized names and non-null codes.
- `app.set_updated_at()` trigger.
- RLS read policy for authenticated shared app roles plus
  `apinilla@popcre.com`.
- RLS write policy for administrators plus `apinilla@popcre.com`.
- `select, insert, update, delete` grants to `authenticated` so the browser
  editor can save through Supabase RLS, and `all` to `service_role`.

## Why

Packaging type is expected to be reused by more than one application, so it
belongs in `core` rather than in a DAM-only table. The first editor is in PopDAM
because the immediate user need was for `apinilla@popcre.com` to populate the
lookup from `dam.designflow.app`.

## Affected apps

- DAM (`u2giants/popdam3`) exposes the editor at
  Settings -> Reference Data -> Packaging Types.
- Future PM/PIM, PLM/Directus, and DAM workflows can read the same table for
  packaging pickers.

## Implementation locations

- Shared DB migration:
  `supabase/migrations/20260709144500_core_packaging_type.sql`.
- Shared DB docs:
  `docs/unified-supabase-schema-map.md`.
- PopDAM app commit:
  `fe9eccc8b7a9ecbb519c608c7b836be623475ca3`.
- PopDAM app files:
  `src/pages/SettingsPage.tsx`,
  `src/components/settings/PackagingTypesTab.tsx`,
  `src/lib/packaging-types.ts`,
  `src/test/packaging-types.test.ts`.

## Verification

- `bash scripts/check-sql.sh` passed.
- `supabase db push --dry-run --linked` against preview project
  `xjcyeuvzkhtzsheknaiu` listed `20260709144500_core_packaging_type.sql`.
- `supabase db push --linked` applied the migration to preview project
  `xjcyeuvzkhtzsheknaiu`.
- `supabase migration list --linked` for preview showed
  `20260709144500 | 20260709144500`.
- Shared-db PR #45 passed validation and merged to `main` as
  `ebf5cfa51cc49e40d71c0ec7521c63e64a009b32`.
- Production `supabase db push --linked` applied
  `20260709144500_core_packaging_type.sql`.
- Production `supabase migration list --linked` showed
  `20260709144500 | 20260709144500`.
- PopDAM local checks passed:
  `npm run test -- packaging-types.test.ts`, `npm run build`, and
  `npm run lint`.
- PopDAM GitHub workflows for `fe9eccc8b7a9ecbb519c608c7b836be623475ca3`
  passed: CI, Forbid Shared DB Bypass, and Publish Frontend Image.
- Live `https://dam.designflow.app/settings?tab=reference-data` was visually
  verified in Chrome with an authenticated session. The page showed build
  `fe9eccc`, Reference Data, Packaging Types, the add form, active toggle, and
  empty-state text.

## Risks / watchouts

- The production push also applied two earlier already-merged migrations that
  production had not yet recorded:
  `20260708183000_masterdata_audit_log.sql` and
  `20260708201000_core_product_material.sql`. This session did not author those
  migrations, but they were applied before `20260709144500` because Supabase
  migration history is ordered.
- No seed rows were added. The table starts empty by design; Apinilla or an
  administrator populates it through DAM Settings.
- Do not move this lookup into a DAM-only schema. Its intended ownership is
  `core` because more than one app will consume it.
