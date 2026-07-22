# DB Data Admin Step 10 database verification — 2026-07-22

Status: applied and verified on preview only. Production is unchanged.

Migrations `20260722203000_db_data_admin_licensor_property_tree.sql` and corrective
`20260722203100_fix_db_data_admin_licensor_property_cursor_uuid.sql` add the protected,
read-only `api.db_data_admin_licensor_property_tree(text, boolean, text, integer)` contract.
The Licensor → Property edge comes only from `core.property.licensor_id`; PLM codes are shown
only with division/type-qualified source context. Orphans are returned in a separate,
always-complete collection and are never hidden or guessed.

GLM 5.2 authored the implementation. The initial preview execution exposed PostgreSQL's lack
of `max(uuid)`. Because migration `20260722203000` was already applied, it was not edited;
GLM added migration `20260722203100`, which replaces only the cursor aggregate with a
deterministic text-cast UUID expression. A subsequent test-only use of the nonexistent
`jsonb_object_field_exists` helper was corrected to the native JSONB `?` operator.

Preview evidence:

- Project: `rjyboqwcdzcocqgmsyel`.
- Both migrations applied only to preview.
- Final `supabase db push --dry-run`: remote database up to date.
- `scripts/check-sql.sh`: passed.
- All nine rollback-safe DB Data Admin suites passed.
- The Step 10 suite proves the authorization matrix, canonical count reconciliation, every
  Property appearing exactly once, loud orphan handling, pagination/search/inactive behavior,
  source context, and a deliberate PLM code-collision fixture that remains parented by the FK.
- `live_upstream_reconciliation` is always false: feeder recency is observed from
  `ingest.sync_run`, but the RPC does not query the live DesignFlow upstream.

No production link, migration, grant, or data write was performed.
