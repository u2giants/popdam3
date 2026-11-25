-- Issue #7041 follow-up (designflow-item-master#194 step 5.1 proof):
-- dflow.item_description_parts.item_fk, SANDBOX HALF ONLY (schema dflow on the
-- DesignFlow non-production project). 20261225091506 pointed item_fk at
-- dflow."itemHeader", but the sandbox item service writes items to
-- plm."itemHeader" (designflow-item-master config/table-schema-map.js:
-- itemHeader -> plm). Read live 2026-11-25 4:10 AM EST: dflow."itemHeader"
-- is a stale copy (max item_id_pk 20260), plm."itemHeader" is the live table
-- (max 102277). The first sandbox create with parts failed with
-- item_description_parts_item_fk_fkey. This re-points the key at
-- plm."itemHeader"(item_id_pk), still ON DELETE CASCADE (the no-delete guard
-- allows the cascade by trigger depth). Production (dflow_prod) is unchanged:
-- there the item service runs single-schema and dflow_prod."itemHeader" is
-- its item table.
-- Refuses to run if any parts row exists (the table is empty in sandbox; the
-- create path is behind ASSEMBLED_DESC_ENABLED, off). Where plm."itemHeader"
-- does not exist (a from-empty replay) it does nothing.
-- Idempotent. Rollback: re-add the constraint referencing dflow."itemHeader".

set lock_timeout = '5s';
set statement_timeout = '2min';

do $$
begin
  if to_regnamespace('dflow_prod') is not null then
    raise exception '#7041/20261225130904 self-check: schema dflow_prod exists here — this is the production project; this sandbox-only migration never applies there'
      using errcode = 'feature_not_supported';
  end if;
end $$;

do $$
begin
  if to_regclass('dflow.item_description_parts') is null then
    raise exception '#7041/20261225130904 self-check: dflow.item_description_parts is missing — 20261225091506 has not been applied here'
      using errcode = 'feature_not_supported';
  end if;
  if to_regclass('plm."itemHeader"') is null then
    raise notice '#7041/20261225130904: plm."itemHeader" is absent (from-empty replay); nothing to do';
    return;
  end if;
  if exists (
    select 1 from pg_constraint
     where conrelid = 'dflow.item_description_parts'::regclass
       and conname = 'item_description_parts_item_fk_fkey'
       and confrelid = 'plm."itemHeader"'::regclass
  ) then
    return; -- already re-pointed
  end if;
  if exists (select 1 from dflow.item_description_parts) then
    raise exception '#7041/20261225130904 self-check: dflow.item_description_parts has rows; re-check their item_fk against plm."itemHeader" before re-pointing the key'
      using errcode = 'feature_not_supported';
  end if;
  alter table dflow.item_description_parts drop constraint if exists item_description_parts_item_fk_fkey;
  alter table dflow.item_description_parts
    add constraint item_description_parts_item_fk_fkey
    foreign key (item_fk) references plm."itemHeader"(item_id_pk) on delete cascade;
end $$;
