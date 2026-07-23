# Step 11 tranche 1 — PLM import preserves curated customer status

Date: 2026-07-23  
Repo: `u2giants/shared-db`  
Branch: `codex/step11-preserve-plm-customer-status`  
Preview project: `rjyboqwcdzcocqgmsyel` (`shared-db-schema-rehearsal`)  
Production: **not changed** (no promotion, no restart, no write)

## Defect

`plm.import_master_data()` overwrote `core.customer.status` on every matched
re-pull from DesignFlow `customers_status`. Human curation in DB Data Admin
would be undone the next successful PLM master-data sync. Coldlion's importer
already preserves status on match (`20260716140000`); PLM did not.

## Fix

New migration only (never edit applied history):

- `supabase/migrations/20260723140000_plm_import_master_data_preserve_customer_status.sql`

Behavior:

| Path | `core.customer.status` | `plm.customer_import.status` |
|---|---|---|
| **New** customer from PLM | seeded from `customers_status` (ACTIVE→active, else inactive) | mirrors PLM |
| **Matched** re-pull | **unchanged** (app-owned) | updated to PLM value (context only) |
| Licensor / property | unchanged this tranche | n/a |

## In-flight gate

- `gh pr list`: empty before start
- Working tree: only untracked brief logs
- Dry-run listed **only** `20260723140000_...sql`
- No `--include-all`

## Commands and results (preview)

```text
supabase link --project-ref rjyboqwcdzcocqgmsyel
supabase db push --dry-run
  → Would push: 20260723140000_plm_import_master_data_preserve_customer_status.sql

supabase db push
  → Applied 20260723140000_...

supabase db push --dry-run
  → Remote database is up to date.
```

Static: `bash scripts/check-sql.sh` → `Static checks passed.`

Function-body probe (rollback txn via Node `pg` pooler):

```text
NOTICE: function body OK: no status clobber on match
SQL completed OK
```

Contract suite `supabase/tests/plm_import_master_data_preserve_customer_status.sql`:

```text
NOTICE: plm_import_master_data_preserve_customer_status: OK (suffix=924f112c25e6)
SQL completed OK
```

Proved:

1. Existing `inactive` customer stays `inactive` when PLM payload says `ACTIVE`.
2. `plm.customer_import.status` still mirrors PLM `ACTIVE` / `INACTIVE`.
3. Brand-new PLM customer seeds `core.customer.status = active`.
4. Curated `potential` survives a second re-pull with PLM `INACTIVE`.

## Production boundary

- Production head remains pre-this-migration; **do not promote** in Step 11.
- Do not restart the currently-failing PLM master-data sync as part of this change.
- Older pending DB Data Admin write/merge/tree migrations remain unapplied on
  production; never use unbounded `--include-all` from the full migration dir.

## Next Step 11 sub-steps

3. `poppim-web` — replace three `api.customer_list` callers  
4. `popdam3` — reconcile `dam-customer-hub-picker`, vendor → `api.dam_factory_list`  
5. `popcrm-web` — picker/search/promote_ingested_domain  
6. DesignFlow sandbox Customer path + Factory mapping (Uma merges)  
7. Cross-app visibility ledger closeout
