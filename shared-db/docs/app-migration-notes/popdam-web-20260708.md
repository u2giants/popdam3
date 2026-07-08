# PopDAM (DAM) — style-group SKU extractor drift (2026-07-08)

## What changed
- Added migration `supabase/migrations/20260708150000_dam_strict_style_group_sku_regex.sql`.
- The migration replaces `public.rebuild_style_groups_batch(uuid, integer)` so DAM style-group rebuilds extract SKU folders with the same rule as the PopDAM app-side edge-function helper:
  - path segment is purely alphanumeric;
  - length is at least 7;
  - segment contains at least one letter and one digit;
  - segment is not the final filename segment.
- No tables, columns, RLS policies, realtime publications, or storage contracts changed.

## Why
- Live PopDAM production still had an older DB rebuild extractor that matched any path segment starting with `^[A-Za-z]{1,6}[0-9]`.
- That prefix rule matched category folders such as `B3M_3FZ - 3D Lenticular framed`, collapsing unrelated art into one bogus style group.
- The user-visible symptom was: in PopDAM Style Groups, searching `3fz` returned one group with 2,234 files instead of the previously segmented SKU cards.
- Live samples showed valid SKU folders can start with digits and can be shorter than 10 characters, for example `3FZ93DYEC01`, `27W4AV4`, and `3DWC01JK`; the durable invariant is alphanumeric + both letters/digits + length >= 7.

## Affected apps
- **DAM (`popdam-web`)** only.
- The affected surface is style-group rebuild/ingest grouping and the Style Groups library search results.
- Other shared apps (CRM, PM/PIM, Directus/PLM) do not call this DAM RPC.

## Where the implementation lives
- shared-db migration: `supabase/migrations/20260708150000_dam_strict_style_group_sku_regex.sql`.
- PopDAM app repo companion changes:
  - `supabase/functions/_shared/style-grouping.ts` — app/edge-function extractor updated to the same rule.
  - `src/test/style-grouping.test.ts` — regression coverage for the collapsed `B3M_3FZ...` folder and digit-leading/short SKUs.
  - `docs/STYLE_GROUPS.md`, `docs/ONBOARDING.md`, and `AGENTS.md` — durable docs/quirk updates.

## Verified
- Live production diagnosis found the bad group:
  - `style_groups.id = 33664017-187b-4599-872c-957c42e4017e`
  - `sku = 'B3M_3FZ - 3D Lenticular framed'`
  - `asset_count = 2234`
- The corrected SQL extraction expression would split that group into 323 distinct SKU values with 0 ungrouped assets.
- `scripts/check-sql.sh` passed.
- Preview dry-run against `xjcyeuvzkhtzsheknaiu` listed this migration plus already-merged `20260707171500_masterdata_designer_resolution.sql`.
- Preview apply succeeded. The master-data migration emitted its expected skip notice because style-tracker bridge objects are absent in preview; the DAM migration applied cleanly.
- Preview verification confirmed `pg_get_functiondef('public.rebuild_style_groups_batch(uuid,integer)'::regprocedure)` contains `length(seg) >= 7`.
- Production apply succeeded after refreshing Supabase CLI auth with the `Supabase CLI Personal Access Token` from 1Password and relinking `/worksp/shared-db` to project `qsllyeztdwjgirsysgai`.
- Production dry-run after apply reports `Remote database is up to date`.
- Production verification confirmed the function definition contains both `length(seg) >= 7` and `^[A-Za-z0-9]+$`.
- PopDAM `agent-api` was deployed with the companion extractor change.
- PopDAM `rebuild-style-groups` completed successfully with `Created 86827 style groups, assigned 87236 assets`.
- Post-rebuild verification: searching `3fz` at the style-group data layer returns 335 groups, and `sku = 'B3M_3FZ - 3D Lenticular framed'` returns 0 groups.

## Risky / unfinished
- The migration has been applied to production before the shared-db branch was merged to `main`. Keep branch `codex/dam-fix-style-group-sku-regex` and merge it promptly so production history is represented in git.
- Production also had already-applied migration version `20260708143000_crm_customer_logo_overrides.sql` from branch `codex/crm-logo-admin` before it was merged to `main`. This branch includes that file too so local migration history matches production.
- Do not tighten the rule back to "starts with letters" or length >= 10; that drops valid live DAM SKUs. Do not loosen it back to prefix matching; that recreates the category-folder collapse.
