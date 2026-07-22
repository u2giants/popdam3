# DB Data Admin merge-engine and FK-coverage verification — 2026-07-22

## Scope

Delivery Step 5 of `DB_Data_Admin.md`, applied to preview project
`rjyboqwcdzcocqgmsyel` only. Production was not changed.

The live `pg_constraint` inventory found 29 foreign keys to `core.customer` and 13 foreign
keys to `core.factory`. The canonical merge engines now cover all 42 relationships.

Newly repaired Customer relationships:

- `crm.customer_ext`, `pim.customer_ext`, and `dam.customer_ext`;
- `core.customer_channel`;
- `public.style_tracker_rows.customer_id`.

Newly repaired Vendor relationships:

- `crm.factory_ext`, `pim.factory_ext`, and `dam.factory_ext`.

## Conflict and concurrency behavior

- One-sided extension rows move to the survivor.
- Extension rows with identical business values collapse to one survivor row.
- Differing extension values raise an integrity error before the merge can commit. The later
  protected preview/apply wrapper must collect explicit field resolutions; the core engine
  never silently chooses one value.
- Customer Channel assignments are unioned and duplicates collapse safely.
- Transaction-scoped advisory locks serialize concurrent attempts for the same pair.
- Browser-authenticated users still cannot execute either merge engine or its private helper;
  the existing `service_role` execution boundary is preserved.

## Verification evidence

1. No shared-db pull request was open before the migration was authored.
2. `bash scripts/check-sql.sh` passed.
3. Preview dry-run listed only `20260722004500_db_data_admin_merge_fk_coverage.sql`.
4. The migration applied successfully to preview.
5. `supabase/tests/db_data_admin_merge_coverage.sql` passed and rolled back all fixtures.
6. The test compares the live FK graph to a complete manifest and also verifies that each
   relation is named in the appropriate merge function. A new or removed FK fails the test.
7. Customer and Vendor fixtures proved one-sided movement, identical-row collapse, conflict
   refusal, alias preservation, source-reference preservation, Customer Channel unioning,
   and `style_tracker_rows.customer_id` repointing.
8. The earlier foundation and extension fixtures still pass.
9. A final preview dry-run must report the remote database up to date before merge.

## Production gate

The migration is not applied to production. Production remains subject to an approved
window and the later delivery gates in `DB_Data_Admin.md`.

