# DB Data Admin bounded production forward

Date: 2026-07-27  
Production project: `qsllyeztdwjgirsysgai`  
Approved by: Albert Hazan, “Proceed with Claude’s safe cleanup steps 1 through 3.”

## Result

The production migration backlog fell from 18 files to 9. No DAM customer-hub,
DAM path-facet, PopSG licensor-status, or ColdLion migration was promoted.

## Applied package

PR #260 added and merged
`20260727154500_db_data_admin_bounded_production_forward.sql`.

The package is a guarded forward copy of these preview-proven migrations:

- `20260722170000`
- `20260722194000`
- `20260722194100`
- `20260722203000`
- `20260722203100`
- `20260722210000`

Claude compared all 56 statements with the source migrations and returned
`PASS`. The preview rehearsal applied the new ledger version and emitted
`reconciliation target already exists; baseline skipped`. The bounded production
dry-run listed only `20260727154500`; the exact-list guard passed; production
then applied it successfully.

Post-apply object verification confirmed:

- `app.db_data_admin_feature_gate` exists.
- `api.db_data_admin_update_customer(...)` exists.
- `api.db_data_admin_preview_customer_merge(uuid, uuid)` exists.
- `api.db_data_admin_licensor_property_tree(text, boolean, text, integer)` exists.
- `single_record_write = false`.
- `merge_execute = false`.

After object verification, the six old source versions were marked applied in
the production migration ledger so they cannot remain as duplicate pending work.
Their SQL was not rerun.

## Neutralized and reconciled versions

`20260726190000` was the known-bad Master Data write restriction. Production
never received its SQL. `20260726200000` only reverted that restriction.
Both versions were marked applied in the production ledger without executing
either file.

Before and after reconciliation, production policies remained:

- authenticated INSERT: `with check (true)`;
- authenticated UPDATE: `using (true) with check (true)`.

`20260723140000` was already live through the earlier bounded Step 11 forward.
Production verification confirmed the installed `plm.import_master_data(jsonb,
jsonb)` body preserves curated customer status. Its old source version was marked
applied without rerunning the function.

## Important failed attempt

A bounded runner containing the six old timestamps still caused Supabase CLI to
request `--include-all` because those versions sit below production's latest
version. The command stopped at dry-run and nothing was applied. `--include-all`
was not used. The permanent fix was the new guarded timestamp above production.

Preview initially reported 17 remote Poppim migrations absent from `main`.
Those files belong to `origin/codex/poppim-audit-remediation`, are already
applied to preview, and remain unfinished and unauthorized for production.
Exact copies were added only to the disposable preview runner so no preview
history was repaired or overwritten. That Poppim branch was not merged.

## Remaining production backlog

Exactly these 9 versions remain pending:

- `20260722210100` DAM customer hub wiring
- `20260722222000` DAM path facets by customer ID
- `20260724050000` PopSG licensor potential-status backfill
- `20260724060000` ColdLion Phase 2A importer
- `20260724061000` ColdLion Phase 2A corrections
- `20260726030000` ColdLion Phase 4 approved links
- `20260726031000` ColdLion Phase 4 null-shape guard
- `20260726032000` ColdLion Phase 4 browser revoke
- `20260726180000` ColdLion Phase 6 parallel run

The DAM pair requires its app rollout gate. The PopSG status change requires a
coordinated taxonomy window. All six ColdLion versions remain prohibited from
production until the accelerated cutover plan's readiness and approval gates
pass.
