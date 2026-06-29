# Ingested-Domain Customer Disassociation Verification — 2026-06-29

## What changed

Ingested email domains were fully disassociated from customers in production
project `qsllyeztdwjgirsysgai`.

The live correction and durable migration remove:

- `api.customer_list`
- `crm.promote_ingested_domain(text, text)`
- `crm.ingested_domain.promoted_customer_id`
- `directus` / `ingested_domains` rows from `core.company_source_ref`
- `core.customer` rows whose only source reference was `directus` /
  `ingested_domains`

The durable migration is:

- `supabase/migrations/20260629034500_remove_ingested_domain_customer_association.sql`

## Why

Production `core.customer` had 3,777 rows, but only 55 were linked to
`designflow_plm` / `customers`. Investigation showed 3,741 customer source refs
from `directus` / `ingested_domains`. Those are email triage artifacts, not PLM,
PM, CRM, DAM, or business customers.

The owner clarified the hard product rule: ingested domains must not be
associated with customers anywhere, in any app or database contract.

## Production correction

The production transaction reported:

```text
deleted_ingested_domain_only_customers: 3638
deleted_ingested_domain_source_refs:   3741
cleaned_remaining_customer_metadata:      0
```

Rows with legitimate non-ingested-domain source refs were preserved; their
`directus` / `ingested_domains` source refs were removed.

## Verified

Read-only verification against production returned:

```text
core.customer total:                  139
ingested_domain source refs:            0
api.customer_list exists:                0
promote function exists:                 0
promoted_customer_id column exists:      0
view/function references promoted_customer: 0
```

Remaining customer source refs were:

```text
directus / retailer:        105
designflow_plm / customers:  55
```

`scripts/check-sql.sh` passed after adding the durable migration. `git diff
--check` passed in both `shared-db` and `popdam`.

## Future sessions should

- Treat `crm.ingested_domain` as CRM-private email triage only.
- Never create, promote, source-ref, FK, join, picker-feed, or otherwise
  associate ingested domains with `core.customer`.
- Use app-specific customer contracts instead of resurrecting `api.customer_list`.
- Preserve PLM-linked customers through `core.company_source_ref` rows where
  `source_system = 'designflow_plm'` and `source_table = 'customers'`.
