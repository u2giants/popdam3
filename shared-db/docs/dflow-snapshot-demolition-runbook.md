---
summary: "Production-only operational demolition of the stale dflow seed schema (issue #6325): why it is not a migration, preconditions, ordered SQL with TOAST-aware guard, verification, rollback, and the standing rule for future dflow migrations."
kind: ops
status: current
read-when: executing or reviewing the production dflow snapshot demolition; authoring any migration that touches dflow.* objects; deciding whether an environment-scoped schema retirement needs a migration
---

# Production-only demolition of the stale `dflow` seed schema (issue #6325)

## Why this is a runbook, not a migration

The migration set deliberately builds and contract-tests `dflow` as the
**non-production DesignFlow app schema** (identity bridges, permissions,
sample workflow, notifications — see `dflow_*_contracts.sql` and
`designflow_*_contracts.sql` in `supabase/tests/`), per the adopted plan
`docs/designflow-cloudsql-to-supabase-plan.md`: Develop/staging/sandbox run
`SCHEMA=dflow` with `dflow` first in `search_path`, and "these stay in `dflow`
on purpose" (`users`, `Roles`, `comments`, `Factory`, `artists`, `customers`,
sample-import tables). PR #6327 proved a demolition migration breaks the
ephemeral contract suite, and it would also replay onto the sandbox project's
**live** app schema (`xupnyeifmpsacrqahwwm`, served by
`.github/workflows/designflow-sandbox-migrations.yml`) and the preview
fixtures. The design decision (option (a), 2026-11-15) is recorded on
issue #6325.

Production (`qsllyeztdwjgirsysgai`) is the only environment where `dflow` is
a stale pre-cutover seed twin rather than the app schema: ~523 MB, 130 tables,
frozen rows ("historical/staging copy … treat its rows as untrusted" —
`docs/designflow-cloudsql-to-supabase-plan.md`). The live app runs
single-schema `dflow_prod` and its roles are denied on `dflow`.

This runbook is the sanctioned narrow exception to "never ad-hoc SQL against
production" (AGENTS.md task-to-file row): a **production-only environment
retirement** may be executed per this merged runbook, inside an open
claim-scoped work issue, with the pre-captured backup below and evidence
posted to that issue. Nothing in `supabase/migrations/` changes.

## Scope guard — hard requirements

- Target database: **production shared project `qsllyeztdwjgirsysgai` only**
  (pooler `aws-1-us-east-1.pooler.supabase.com:6543`, user
  `postgres.qsllyeztdwjgirsysgai`). Verify with `select current_user` and the
  `pg_namespace` shape below before any write.
- **Never** run this against the preview project (`PREVIEW_PROJECT_REF`) or the
  DesignFlow non-production project (`xupnyeifmpsacrqahwwm`) — there `dflow`
  is a live/fixture app schema. A shape check is built into step 0.
- Work issue open (currently #6325); owner authorization already ruled
  (Albert Hazan 2026-11-13/2026-11-14: "drop empty shelf" / "approved" /
  "moot" — see #6325).
- Full-schema backup already captured and verified:
  `gs://designflow-storage/backups/dflow-stale-cleanup-2026-11-12/prod_dflow_full_schema.dump`
  (53 MB compressed, 1140 TOC entries, `pg_restore --list` verified). Re-verify
  it exists before executing (`gcloud storage ls`).

## Preconditions (re-check all on the day of execution)

1. `gcloud storage ls gs://designflow-storage/backups/dflow-stale-cleanup-2026-11-12/prod_dflow_full_schema.dump` succeeds.
2. Reader audit returns **exactly one** outside reader and no new ones (re-verified 2026-11-15: the view is the sole remaining `dflow` reader — `api.resolve_item_mg_category` already reads only `dflow_prod`/`core` and is dropped in step 2 solely per the owner's "moot" retirement ruling):

   ```sql
   -- relation-level outside readers of dflow
   select distinct n.nspname, c.relname
     from pg_depend d
     join pg_rewrite r on r.oid = d.objid
     join pg_class c on c.oid = r.ev_class
     join pg_namespace n on n.oid = c.relnamespace
    where d.refobjid in (
        select c2.oid from pg_class c2 join pg_namespace n2 on n2.oid = c2.relnamespace
         where n2.nspname = 'dflow')
      and n.nspname <> 'dflow';
   -- expected: public | style_tracker_rows_with_bridge

   -- definition-scan for qualified dflow references outside the schema
   select distinct n.nspname, p.proname
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname not in ('dflow')
      and position('dflow.' in p.prosrc) > 0;
   select distinct n.nspname, c.relname
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind = 'v' and n.nspname <> 'dflow'
      and position('dflow.' in pg_get_viewdef(c.oid)) > 0;
   -- expected: no function rows; the single view row above
   ```

3. Target columns for the view repoint exist in `dflow_prod`:

   ```sql
   select column_name from information_schema.columns
    where table_schema = 'dflow_prod' and table_name = 'RFQItem'
      and column_name in ('rfqItem_date_modified','rfqItem_created_date','rfqItem_rfq_group','rfqItem_style_number');
   -- expected: 4 rows
   select column_name from information_schema.columns
    where table_schema = 'dflow_prod' and table_name = 'RFQGroup'
      and column_name in ('RFQGroup_id','RFQGroup_name','data_added');
   -- expected: 3 rows
   ```

4. `https://alsand.designflow.app/api/health` returns 200 (baseline).
5. No production migration dispatch is mid-flight (Actions lane quiet).

## Execution (single psql session, in order)

### Step 0 — capture pre-state and confirm the production shape

```sql
select nspname from pg_namespace
 where nspname in ('dflow','dflow_prod','dflow_prod_old') order by 1;
-- MUST return exactly two rows: dflow, dflow_prod. If dflow_prod is absent
-- or dflow_prod_old is present, STOP — wrong database or drifted shape.

select count(*) as seed_itemheader_rows from dflow."itemHeader";
select count(*) as live_itemheader_rows from dflow_prod."itemHeader";
select pg_get_viewdef('public.style_tracker_rows_with_bridge'::regclass, true);
```

Record outputs to the work issue.

### Step 1 — repoint the style-tracker bridge view (byte-identical body, RFQ join moved to the live schema)

```sql
create or replace view public.style_tracker_rows_with_bridge as
 SELECT r.id,
    r.source_workbook_id,
    r.source_sheet,
    r.source_row_number,
    r.tracker_type,
    r.sku,
    r.group_id,
    r.description,
    r.customer,
    r.designer,
    r.commissioned,
    r.upc,
    r.customer_sku,
    r.licensor,
    r.license_status,
    r.royalty,
    r.concept_status,
    r.pre_production_status,
    r.production_status,
    r.default_vendor,
    r.discontinued,
    r.notes,
    r.row_data,
    r.imported_at,
    r.created_at,
    r.updated_at,
    r.updated_by,
    b.id AS bridge_id,
    b.erp_item_id,
    b.style_group_id,
    b.company_id,
    b.public_licensor_id,
    b.core_licensor_id,
    b.factory_id,
    b.plm_item_id,
    b.match_status,
    b.match_confidence,
    b.match_notes,
    b.last_matched_at,
    erp.item_description AS canonical_description,
    COALESCE(selected_customer.display_name, selected_customer.name, bridge_customer.display_name, bridge_customer.name) AS canonical_customer_name,
    COALESCE(core_lic.name, public_lic.name) AS canonical_licensor_name,
    factory.name AS canonical_factory_name,
    sg.sku AS style_group_sku,
    erp.style_number AS erp_style_number,
    b.creative_designer_id,
    creative.name AS canonical_designer_name,
    r.customer_id,
    COALESCE(rfq.rfq_groups, '[]'::jsonb) AS rfq_groups
   FROM style_tracker_rows r
     LEFT JOIN plm.style_tracker_item_bridge b ON b.style_tracker_row_id = r.id
     LEFT JOIN LATERAL ( SELECT i.description AS item_description,
            i.item_number AS style_number
           FROM plm.item i
          WHERE i.id = b.erp_item_id AND i.source_system = 'coldlion'::text AND NOT ((EXISTS ( SELECT 1
                   FROM plm.legacy_erp_item_identity l
                  WHERE l.external_id = i.item_number)) AND i.id = (( SELECT p.id
                 FROM plm.item p
                     LEFT JOIN plm.legacy_erp_item_identity lp ON lp.external_id = p.item_number
                  WHERE p.source_system = 'coldlion'::text AND upper(TRIM(BOTH FROM p.item_number)) = upper(TRIM(BOTH FROM i.item_number)) AND p.item_number = i.item_number
                  ORDER BY (
                        CASE
                            WHEN lp.division_code IS NOT NULL AND lp.division_code = (p.raw ->> 'divisionCode'::text) THEN 0
                            ELSE 1
                        END), p.source_id, p.id
                 LIMIT 1)))
        UNION ALL
         SELECT r1.description,
            r1.item_number
           FROM plm.legacy_erp_item_identity l2
             JOIN LATERAL ( SELECT p2.id,
                    p2.description,
                    p2.item_number
                   FROM plm.item p2
                  WHERE p2.source_system = 'coldlion'::text AND upper(TRIM(BOTH FROM p2.item_number)) = upper(TRIM(BOTH FROM l2.external_id)) AND p2.item_number = l2.external_id
                  ORDER BY (
                        CASE
                            WHEN l2.division_code IS NOT NULL AND l2.division_code = (p2.raw ->> 'divisionCode'::text) THEN 0
                            ELSE 1
                        END), p2.source_id, p2.id
                 LIMIT 1) r1 ON true
          WHERE l2.id = b.erp_item_id
   LIMIT 1) erp ON true
     LEFT JOIN style_groups sg ON sg.id = b.style_group_id
     LEFT JOIN core.customer bridge_customer ON bridge_customer.id = b.company_id
     LEFT JOIN core.customer selected_customer ON selected_customer.id = r.customer_id
     LEFT JOIN licensors public_lic ON public_lic.id = b.public_licensor_id
     LEFT JOIN core.licensor core_lic ON core_lic.id = b.core_licensor_id
     LEFT JOIN core.creative_designer creative ON creative.id = b.creative_designer_id
     LEFT JOIN core.factory factory ON factory.id = b.factory_id
     LEFT JOIN LATERAL ( SELECT jsonb_agg(jsonb_build_object('id', per_group.id, 'name', per_group.name, 'linked_at', to_char(timezone('UTC'::text, per_group.linked_at), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'::text)) ORDER BY per_group.linked_at DESC NULLS LAST, per_group.id DESC) AS rfq_groups
           FROM ( SELECT g."RFQGroup_id" AS id,
                    COALESCE(NULLIF(TRIM(BOTH FROM g."RFQGroup_name"), ''::text), 'RFQ Group #'::text || g."RFQGroup_id"::text) AS name,
                    max(COALESCE(i."rfqItem_date_modified"::timestamp with time zone, i."rfqItem_created_date", g.data_added::timestamp with time zone)) AS linked_at
                   FROM dflow_prod."RFQItem" i
                     JOIN dflow_prod."RFQGroup" g ON g."RFQGroup_id" = i."rfqItem_rfq_group"
                  WHERE upper(TRIM(BOTH FROM i."rfqItem_style_number")) = upper(TRIM(BOTH FROM r.row_data ->> 'rfq_code'::text)) AND NULLIF(TRIM(BOTH FROM r.row_data ->> 'rfq_code'::text), ''::text) IS NOT NULL AND i."rfqItem_rfq_group" IS NOT NULL
                  GROUP BY g."RFQGroup_id", g."RFQGroup_name") per_group) rfq ON true;
```

Verify immediately:

```sql
select position('dflow."' in viewdef) as legacy_refs,
       position('dflow_prod."' in viewdef) as live_refs
  from (select pg_get_viewdef('public.style_tracker_rows_with_bridge'::regclass, true) as viewdef) v;
-- expected: legacy_refs = 0, live_refs > 0
select count(*) from public.style_tracker_rows_with_bridge;
-- expected: same order of magnitude as pre-change (view still returns rows)
```

### Step 2 — retire the moot helper

```sql
drop function if exists api.resolve_item_mg_category(integer);
```

### Step 3 — TOAST-aware live dependent guard (shape proven by shelf-drop version 20261114022200)

```sql
do $guard$
declare
  v_outside integer;
begin
  with inside as (
    select oid from pg_namespace where nspname = 'dflow'
    union all
    select c.oid from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'dflow'
    union all
    select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'dflow'
  ), dependents as (
    select d.objid,
           coalesce(
             (select n.nspname from pg_class c join pg_namespace n on n.oid = c.relnamespace
               where c.oid = d.objid and d.classid = 'pg_class'::regclass),
             (select n.nspname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where p.oid = d.objid and d.classid = 'pg_proc'::regclass),
             (select n.nspname from pg_rewrite rw join pg_class c on c.oid = rw.ev_class
               join pg_namespace n on n.oid = c.relnamespace
               where rw.oid = d.objid and d.classid = 'pg_rewrite'::regclass),
             (select n.nspname from pg_trigger t join pg_class c on c.oid = t.tgrelid
               join pg_namespace n on n.oid = c.relnamespace
               where t.oid = d.objid and d.classid = 'pg_trigger'::regclass),
             'internal') as dep_schema
      from pg_depend d
     where d.refobjid in (select oid from inside)
  )
  select count(*) into v_outside from dependents
   where dep_schema not in ('dflow', 'internal')
     and dep_schema not like 'pg_toast%'
     and dep_schema not like 'pg_temp%';
  if v_outside > 0 then
    raise exception 'dflow has % outside dependent object(s); refusing cascade drop', v_outside;
  end if;
end
$guard$;
```

Must pass with zero outside dependents after steps 1–2. If it raises, STOP and
re-audit readers; do not widen the exclusions.

### Step 4 — demolish

```sql
drop schema if exists dflow cascade;
```

### Step 5 — post-verification (all must hold before the issue closes)

```sql
select count(*) from pg_namespace where nspname = 'dflow';          -- 0
select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'api' and p.proname = 'resolve_item_mg_category'; -- 0
select count(*) from public.style_tracker_rows_with_bridge;          -- returns rows
select count(*) from dflow_prod."itemHeader";                        -- live schema intact
```

Plus `https://alsand.designflow.app/api/health` → 200. Post all outputs to
the work issue.

## Rollback

Structural rollback is not automatic — that is the point of the backup. To
recover any seed object or data:

1. `gcloud storage cp gs://designflow-storage/backups/dflow-stale-cleanup-2026-11-12/prod_dflow_full_schema.dump <local>`
2. Restore selectively into a scratch schema (e.g. `pg_restore --list` to pick
   TOC entries, restore into a temp database or schema) and copy back only
   what is actually missed. Do **not** restore the whole schema back under the
   name `dflow` without a fresh owner decision.
3. The two reader moves are independently reversible: the view can be
   recreated from step 1 with `dflow_prod` swapped back (only if `dflow` is
   restored), and the helper is moot by owner ruling and stays dropped.

## Standing rule after execution (also mirrored in docs/development.md)

Production intentionally has **no** `dflow` schema once this runbook executes.
Everywhere else (ephemeral CI replay, preview, DesignFlow non-production
project) keeps it. Therefore:

- Any migration that writes `dflow.*` objects must tolerate the schema's
  absence on production — wrap the DDL in a `do $$ begin if exists (select 1
  from pg_namespace where nspname = 'dflow') then … end if; end $$;` block
  (inert on production, active on every other target).
- Never "fix" production divergence by re-creating `dflow` there; the
  divergence is the design (issue #6325).
