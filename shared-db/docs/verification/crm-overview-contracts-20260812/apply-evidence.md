# Preview apply evidence — CRM overview contracts (Phase 7A)

The already-applied baseline remains byte-for-byte unchanged. Exact-parity
corrections are in the later migration
`20260812211000_crm_overview_exact_parity_corrections.sql`.

GitHub Actions run `31641099199`, at exact commit
`c2c0f4cb1692fe92d343193aa5a15ff2d79ccbc1`, applied only that correction to
preview. The hard guard, bounded checkout, apply, ledger delta, and evidence
upload all passed. An earlier attempt correctly refused to reapply the already
present baseline migration.

**Target:** preview branch `rjyboqwcdzcocqgmsyel` ONLY (Supabase branch
`shared-db-schema-rehearsal`). Production `qsllyeztdwjgirsysgai` was never
contacted. Verified with the pinned Supabase CLI **2.105.0**.

## How the migration was applied (bounded, §5.1 recipe)

Preview was **behind** `main`: a plain `supabase db push` demanded
`--include-all` because seven unrelated workstream migrations were also pending
on the branch. Applying all of them would have been scope creep on a shared,
mutable preview branch, so the §5.1 bounded-temp-checkout recipe was used to
apply **only** this migration:

1. `git worktree add --detach _preview-apply codex/crm-overview-server-contracts-7a`
   (inside the working dir; removed afterward).
2. Deleted the **seven other preview-pending** files from that bounded checkout
   only (repo copy untouched):
   - `20260810140000_production_lane_canary.sql`
   - `20260810180000_plm_default_privilege_hole_and_pg17_maintain_revokes.sql`
   - `20260810190000_dcp_vault_source_landing.sql`
   - `20260810190100_dcp_vault_chunked_loader.sql`
   - `20260811050000_dcp_vault_metadata_landing.sql`
   - `20260811060000_dcp_vault_metadata_chunked_loader.sql`
   - `20260811070000_nbcu_asset_ip_family_relationship.sql`
3. `supabase link --project-ref rjyboqwcdzcocqgmsyel`; proved
   `supabase/.temp/project-ref = rjyboqwcdzcocqgmsyel` (§4.2) immediately before
   the push.
4. `supabase db push --include-all --dry-run` reported exactly:
   `Would push these migrations: • 20260812130000_crm_overview_server_contracts.sql`
5. `supabase db push --include-all` applied it:
   `Applying migration 20260812130000_crm_overview_server_contracts.sql... Finished supabase db push.`

## Post-apply verification (read-only, `preview-verify-raw.txt`)

- **Ledger:** `supabase_migrations.schema_migrations` holds version
  `20260812130000`. (Per §4 rule 5, the OBJECTS were also confirmed present, not
  just the ledger row.)
- **Objects:** all 7 functions exist in `api`, each `security_definer` + `stable`
  (`vol='s'`): `crm_overview_counts`, `crm_overview_email_counts`,
  `crm_overview_email_volume`, `crm_overview_pending_approvals`,
  `crm_overview_pipeline_stages`, `crm_overview_recent_meetings`,
  `crm_overview_recent_unrouted`.
- **Grants:** `EXECUTE` granted to `authenticated` on all 7 (and to `postgres`
  as owner); revoked from `public`.

## Correction applied during rehearsal (core.company → core.customer)

The first apply surfaced that the canonical table is **`core.customer`** (864
rows), NOT `core.company`: `core.company` returns `42P01 undefined_table`, and
the **live** `api.crm_contact_list` / `api.crm_meeting_list` view definitions and
the `crm.opportunity.company_id` FK all target `core.customer`. The migration
files in `supabase/migrations/` still carry the pre-rename `core.company` name
(they are stale text superseded by later renames — the §10.1 live-schema-vs-file
trap). The migration was corrected (`core.company` → `core.customer` in the two
places it appeared: the contacts lateral and `recent_meetings`) and re-applied to
preview via idempotent `CREATE OR REPLACE`. This is exactly the "two
authoritative files were invisible to the sandbox" failure the task warned about;
it is resolved by inspecting the live schema, not by trusting the migration text.
