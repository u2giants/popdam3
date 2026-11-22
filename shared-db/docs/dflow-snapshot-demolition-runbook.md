---
summary: "Production-only operational demolition of the stale dflow seed schema (#6325): preconditions, ordered SQL, verification, rollback, and standing rules."
kind: ops
status: current
read-when: executing or reviewing the production dflow snapshot demolition; authoring any migration that touches dflow.* objects or shared-table constraints referencing dflow; deciding whether an environment-scoped schema retirement needs a migration
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

## What must move before the drop (audited 2026-11-15, live)

Outside dependents of production `dflow` — the complete list the drop guard
enforces:

1. `public.style_tracker_rows_with_bridge` (view) — repointed byte-identically
   to `dflow_prod."RFQItem"/"RFQGroup"`.
2. `api.resolve_item_mg_category(integer)` — already reads
   `dflow_prod`/`core` only; dropped solely per the owner's "moot" retirement
   ruling (the historical MG reclassification it served will never run).
3. **14 foreign keys on live shared tables** (migration-built by design —
   `dflow.users` is "the one user list" per
   `20261002155633_repoint_user_fks_to_dflow_users.sql`; on production they
   anchored to the seed twin). Each is dropped and re-added byte-identically
   against its `dflow_prod` equivalent, which **repairs live integrity**
   (shared tables stop validating user references against a frozen
   cutover-day copy):

   | Constraint | On table | New reference |
   |---|---|---|
   | `RolePermissions_RoleId_fkey` | `app."RolePermissions"` | `dflow_prod."Roles"("Id")` |
   | `RolePermissions_UserId_fkey` | `app."RolePermissions"` | `dflow_prod.users(id)` |
   | `user_notification_workflow_action_id_fkey` | `app.user_notification` | `dflow_prod.item_workflow_action(id)` — reproduced `NOT VALID` as today |
   | `age_group_created_by_fkey` / `age_group_updated_by_fkey` | `core.age_group` | `dflow_prod.users(id)` |
   | `art_types_created_by_fkey` / `art_types_updated_by_fkey` | `core.art_types` | `dflow_prod.users(id)` |
   | `artist_types_created_by_fkey` / `artist_types_updated_by_fkey` | `core.artist_types` | `dflow_prod.users(id)` |
   | `art_piece_attachment_art_piece_id_fkey` | `plm.art_piece_attachment` | `dflow_prod.art_piece(id)` — added `NOT VALID` (2 legacy rows, attachment ids 1559/1560 → art_piece 790, exist only in the seed; new writes still enforced; cleaning those rows is row-level data work outside this workstream) |
   | `art_piece_attachment_created_by_fkey` / `art_piece_attachment_updated_by_fkey` | `plm.art_piece_attachment` | `dflow_prod.users(id)` |
   | `productUserAssignment_user_id_fk_fkey` | `plm."productUserAssignment"` | `dflow_prod.users(id)` |
   | `sample_comments_user_id_fkey` | `plm.sample_comments` | `dflow_prod.users(id)` |

   Validation against `dflow_prod` was checked live 2026-11-15: all clean
   except the `art_piece_id` case above.

## Scope guard — hard requirements

- Target database: **production shared project `qsllyeztdwjgirsysgai` only**
  (pooler `aws-1-us-east-1.pooler.supabase.com:6543`, user
  `postgres.qsllyeztdwjgirsysgai`). Verify the `pg_namespace` shape below
  before any write.
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
2. Outside-dependent audit returns **exactly the 16 objects above and no new ones** (relation-level, function-level, and constraint-level — the constraint level is what the 2026-11-15 first attempt caught):

   ```sql
   -- relation-level outside readers (views)
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

   -- function-level definition scan
   select distinct n.nspname, p.proname
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname not in ('dflow')
      and position('dflow.' in p.prosrc) > 0;
   -- expected: no rows (helper already reads dflow_prod/core only)

   -- constraint-level outside dependents (FKs on live tables referencing dflow)
   select n.nspname, r.relname, c.conname, pg_get_constraintdef(c.oid)
     from pg_constraint c
     join pg_class r on r.oid = c.conrelid
     join pg_namespace n on n.oid = r.relnamespace
     join pg_class r2 on r2.oid = c.confrelid
     join pg_namespace n2 on n2.oid = r2.relnamespace
    where n2.nspname = 'dflow' and n.nspname <> 'dflow'
    order by 1, 2, 3;
   -- expected: exactly the 14 FK rows in the table above
   ```

3. Target objects for the repoints exist in `dflow_prod`: `users(id)`,
   `"Roles"("Id")`, `art_piece(id)`, `item_workflow_action(id)`,
   `"RFQItem"`, `"RFQGroup"` (RFQ columns
   `rfqItem_date_modified`, `rfqItem_created_date`, `rfqItem_rfq_group`,
   `rfqItem_style_number`; `RFQGroup_id`, `RFQGroup_name`, `data_added`).
4. FK validation counts against `dflow_prod` are zero everywhere except
   `plm.art_piece_attachment.art_piece_id` (known 2 legacy rows, ids 1559/1560).
5. `https://alsand.designflow.app/api/health` returns 200 (baseline).
6. No production migration dispatch is mid-flight (Actions lane quiet).

## Execution (single psql session; steps 1–5 in ONE transaction, all-or-nothing)

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

### Step 2 — retire the moot helper

```sql
drop function if exists api.resolve_item_mg_category(integer);
```

### Step 3 — repoint the 14 shared-table foreign keys to `dflow_prod`

Same name, same column(s), same ON UPDATE/ON DELETE actions — only the
referenced schema changes. `NOT VALID` states are preserved exactly (two
cases). Brief `ACCESS EXCLUSIVE` locks on small tables, same live pattern as
migration `20261002155633`.

```sql
alter table app."RolePermissions" drop constraint "RolePermissions_RoleId_fkey";
alter table app."RolePermissions" add constraint "RolePermissions_RoleId_fkey"
  foreign key ("RoleId") references dflow_prod."Roles"("Id");
alter table app."RolePermissions" drop constraint "RolePermissions_UserId_fkey";
alter table app."RolePermissions" add constraint "RolePermissions_UserId_fkey"
  foreign key ("UserId") references dflow_prod.users(id);

alter table app.user_notification drop constraint user_notification_workflow_action_id_fkey;
alter table app.user_notification add constraint user_notification_workflow_action_id_fkey
  foreign key (workflow_action_id) references dflow_prod.item_workflow_action(id) on delete restrict not valid;

alter table core.age_group drop constraint age_group_created_by_fkey;
alter table core.age_group add constraint age_group_created_by_fkey
  foreign key (created_by) references dflow_prod.users(id);
alter table core.age_group drop constraint age_group_updated_by_fkey;
alter table core.age_group add constraint age_group_updated_by_fkey
  foreign key (updated_by) references dflow_prod.users(id);

alter table core.art_types drop constraint art_types_created_by_fkey;
alter table core.art_types add constraint art_types_created_by_fkey
  foreign key (created_by) references dflow_prod.users(id);
alter table core.art_types drop constraint art_types_updated_by_fkey;
alter table core.art_types add constraint art_types_updated_by_fkey
  foreign key (updated_by) references dflow_prod.users(id);

alter table core.artist_types drop constraint artist_types_created_by_fkey;
alter table core.artist_types add constraint artist_types_created_by_fkey
  foreign key (created_by) references dflow_prod.users(id);
alter table core.artist_types drop constraint artist_types_updated_by_fkey;
alter table core.artist_types add constraint artist_types_updated_by_fkey
  foreign key (updated_by) references dflow_prod.users(id);

alter table plm.art_piece_attachment drop constraint art_piece_attachment_art_piece_id_fkey;
alter table plm.art_piece_attachment add constraint art_piece_attachment_art_piece_id_fkey
  foreign key (art_piece_id) references dflow_prod.art_piece(id) not valid;
alter table plm.art_piece_attachment drop constraint art_piece_attachment_created_by_fkey;
alter table plm.art_piece_attachment add constraint art_piece_attachment_created_by_fkey
  foreign key (created_by) references dflow_prod.users(id);
alter table plm.art_piece_attachment drop constraint art_piece_attachment_updated_by_fkey;
alter table plm.art_piece_attachment add constraint art_piece_attachment_updated_by_fkey
  foreign key (updated_by) references dflow_prod.users(id);

alter table plm."productUserAssignment" drop constraint "productUserAssignment_user_id_fk_fkey";
alter table plm."productUserAssignment" add constraint "productUserAssignment_user_id_fk_fkey"
  foreign key (user_id_fk) references dflow_prod.users(id) on update cascade;

alter table plm.sample_comments drop constraint sample_comments_user_id_fkey;
alter table plm.sample_comments add constraint sample_comments_user_id_fkey
  foreign key (user_id) references dflow_prod.users(id) on update cascade;
```

### Step 4 — classid-correct dependent guard (zero outside dependents required)

> Guard lessons from the 2026-11-15 first attempt: match `pg_depend` by
> **(classid, oid) pairs** — bare-oid matching across catalogs produces false
> positives (auth-schema index rows colliding numerically with dflow
> pg_proc oids) — and resolve `pg_constraint`/`pg_type` dependents to their
> owning schema, or real FK dependents are misfiled as "internal" and missed.

```sql
do $guard$
declare
  v_outside integer;
begin
  with inside as (
    select 'pg_class'::regclass as classid, c.oid
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'dflow'
    union all
    select 'pg_proc'::regclass, p.oid
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'dflow'
    union all
    select 'pg_namespace'::regclass, oid
      from pg_namespace where nspname = 'dflow'
  ), dep as (
    select d.classid, d.objid
      from pg_depend d
      join inside i on i.classid = d.refclassid and i.oid = d.refobjid
     where (d.classid, d.objid) not in (select classid, oid from inside)
  ), named as (
    select dep.classid::regclass::text as kind, dep.objid,
           coalesce(
             (select n.nspname from pg_class c join pg_namespace n on n.oid = c.relnamespace
               where dep.classid = 'pg_class'::regclass and c.oid = dep.objid),
             (select n.nspname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where dep.classid = 'pg_proc'::regclass and p.oid = dep.objid),
             (select n.nspname from pg_type t join pg_namespace n on n.oid = t.typnamespace
               where dep.classid = 'pg_type'::regclass and t.oid = dep.objid),
             (select n.nspname from pg_constraint k join pg_class c on c.oid = k.conrelid
               join pg_namespace n on n.oid = c.relnamespace
               where dep.classid = 'pg_constraint'::regclass and k.oid = dep.objid),
             (select n.nspname from pg_rewrite rw join pg_class c on c.oid = rw.ev_class
               join pg_namespace n on n.oid = c.relnamespace
               where dep.classid = 'pg_rewrite'::regclass and rw.oid = dep.objid),
             (select n.nspname from pg_trigger t join pg_class c on c.oid = t.tgrelid
               join pg_namespace n on n.oid = c.relnamespace
               where dep.classid = 'pg_trigger'::regclass and t.oid = dep.objid),
             'internal') as dep_schema
      from dep
  )
  select count(*) into v_outside from named
   where dep_schema not in ('dflow', 'internal')
     and dep_schema not like 'pg_toast%'
     and dep_schema not like 'pg_temp%';
  if v_outside > 0 then
    raise exception 'dflow has % outside dependent object(s); refusing cascade drop', v_outside;
  end if;
end
$guard$;
```

Must pass with zero outside dependents after steps 1–3. If it raises, STOP and
re-audit; do not widen the exclusions.

### Step 5 — demolish

```sql
drop schema if exists dflow cascade;
```

### Step 6 — post-verification (all must hold before the issue closes)

```sql
select count(*) from pg_namespace where nspname = 'dflow';            -- 0
select count(*) from pg_constraint c
  join pg_class r on r.oid = c.conrelid
  join pg_namespace n on n.oid = r.relnamespace
  join pg_class r2 on r2.oid = c.confrelid
  join pg_namespace n2 on n2.oid = r2.relnamespace
 where n2.nspname = 'dflow';                                          -- 0
select count(*) from public.style_tracker_rows_with_bridge;            -- returns rows
select count(*) from pg_constraint where conname = 'age_group_created_by_fkey'
  and confrelid = 'dflow_prod.users'::regclass;                        -- 1
select count(*) from dflow_prod."itemHeader";                          -- live schema intact
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
3. The reader moves are independently reversible: the view can be recreated
   from step 1 with `dflow_prod` swapped back (only if `dflow` is restored),
   the 14 foreign keys can be re-created against a restored `dflow` from the
   definitions in step 3, and the helper is moot by owner ruling and stays
   dropped.

## Standing rules after execution (also mirrored in docs/development.md)

Production intentionally has **no** `dflow` schema once this runbook executes.
Everywhere else (ephemeral CI replay, preview, DesignFlow non-production
project) keeps it. Therefore:

- Any migration that writes `dflow.*` objects must tolerate the schema's
  absence on production — wrap the DDL in a `do $$ begin if exists (select 1
  from pg_namespace where nspname = 'dflow') then … end if; end $$;` block
  (inert on production, active on every other target).
- Shared-table constraints that reference `dflow.*` in the migration set
  reference their `dflow_prod.*` equivalent on production (the 14 foreign
  keys above). Migrations altering or dropping those constraints must tolerate
  the different referenced schema on production (match on constraint name and
  table, not on the referenced OID).
- Never "fix" either divergence by re-creating `dflow` on production; the
  divergence is the design (issue #6325).
