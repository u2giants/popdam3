# CRM contact clear RPC and ingested-domain checks — 2026-06-26

## Contact relationship clear RPC

What changed:
Migration `20260626171000_crm_update_contact_clear_relationship_fields.sql`
was applied to preview project `xjcyeuvzkhtzsheknaiu` and production project
`qsllyeztdwjgirsysgai`.

Why:
POP CRM needed explicit clear flags for relationship-owned contact fields on
`core.contact_company`. Passing `null` alone was previously interpreted as
"leave unchanged".

Verification:
- `scripts/check-sql.sh` passed.
- `git diff --check` passed.
- Preview `supabase db push --dry-run` listed only
  `20260626171000_crm_update_contact_clear_relationship_fields.sql`.
- Preview `supabase db push` applied the migration.
- Production `supabase db push --dry-run` listed only
  `20260626171000_crm_update_contact_clear_relationship_fields.sql`.
- Production `supabase db push` applied the migration using the direct Postgres
  host after the pooler returned a prepared-statement collision.
- Production `pg_proc` showed
  `api.crm_update_contact(uuid,text,text,text,text,text,text,uuid,uuid,text,text,boolean,boolean,boolean,boolean)`.
- A rollback-safe production probe as an authenticated CRM profile accepted
  `p_clear_contact_type`.
- A rollback-safe production probe cleared a real relationship `scope` value and
  observed `<null>` before rollback.

Future sessions should:
Use the direct Postgres host for production migration pushes if the pooler fails
with `prepared statement ... already exists`. Keep frontend calls on the
explicit `p_clear_*` flags; do not rely on `null` to clear relationship fields.

## Ingested-domain triage flow

What changed:
The preview triage/promotion contract was verified for
`crm.record_ingested_domain(...)`, `api.crm_ingested_domain_list`, and
`crm.promote_ingested_domain(...)`.

Why:
POP CRM Accounts Triage must keep random email domains out of shared
`core.customer` until a human promotes them to potential customers.

Verification:
A rollback-safe preview transaction recorded
`codex-preview-ingest.example`, confirmed it appeared as an unpromoted row in
`api.crm_ingested_domain_list`, promoted it, confirmed a
`core.customer` row with `is_potential = true` and
`customer_status = 'POTENTIAL_CUSTOMER'`, and confirmed the unpromoted triage
filter no longer matched.

Future sessions should:
Keep worker-side unknown-domain ingestion on
`crm.record_ingested_domain(...)`. Promotion should be the only path from
triage domain to potential customer.
