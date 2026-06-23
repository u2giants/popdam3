# Preview Branch Build Verification

Date: 2026-06-21

## Branch

| Field | Value |
|---|---|
| Parent project | `qsllyeztdwjgirsysgai` (`popdam`) |
| Preview branch name | `shared-db-schema-rehearsal` |
| Preview project ref | `xjcyeuvzkhtzsheknaiu` |
| Branch id | `f91b8653-19dc-4f69-b797-298f4ff71081` |
| With data | `true` |
| Persistent | `true` |
| Status after build | `FUNCTIONS_DEPLOYED` |

## Applied Migrations

The local `shared-db` repo was linked to the preview project ref, not the production project ref, before applying migrations.

```text
20260621150714_foundation.sql
20260621150815_app_core.sql
20260621151024_domain_tables.sql
20260621151155_api_rls_realtime.sql
```

`supabase migration list` showed all four migrations present locally and remotely on the preview branch.

## Verification

A schema-only dump of the new logical schemas was generated from the preview branch and inspected locally. The generated dump is intentionally not committed.

| Object type | Count |
|---|---:|
| Schemas | 8 |
| Tables | 85 |
| API views | 6 |
| RLS policies | 153 |

Key objects verified in the branch dump:

- `app.profile`
- `core.company`
- `dam.asset`
- `pim.product`
- `crm.opportunity`
- `plm.item`
- `api.pm_product_board`
- `api.global_search`

## Production Impact

The production/default project ref `qsllyeztdwjgirsysgai` was used only as the parent for branch creation. The schema migrations were applied to preview project ref `xjcyeuvzkhtzsheknaiu`.

No production migration was run.
