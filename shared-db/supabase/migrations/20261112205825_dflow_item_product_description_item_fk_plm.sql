-- derived-from: none
-- Issue #5994 (claim #6199). Work issue popcre/designflow-item-master#150.
-- DesignFlow NON-PRODUCTION ONLY: project xupnyeifmpsacrqahwwm. Never applied to
-- shared preview or shared production; the self-check refuses wherever
-- dflow_prod exists. Production (dflow_prod) is correct and has no counterpart.
--
-- Why: the sandbox site keeps items in plm."itemHeader", but
-- dflow.item_product_description.item_fk references dflow."itemHeader", so new
-- sandbox items can never get a Core Product Type row and some stored rows
-- belong to ids that do not exist in plm.
--
-- What:
--   1. Item rows whose item_fk is absent from plm."itemHeader" are deleted (the
--      audit trigger copies each into _history). A human override among them
--      stops the migration (none when authored).
--   2. item_product_description_item_fk_fkey is repointed to
--      plm."itemHeader"(item_id_pk) on delete cascade: new key NOT VALID,
--      VALIDATE, old key dropped, new key renamed to the old name.
-- The _history table has no item key and is left as is.
-- Idempotent: a re-run deletes nothing and skips a key already on plm.
-- Rollback: repoint the key back to dflow."itemHeader" the same way (rows
-- whose id is absent there would first need removal).

begin;
set local lock_timeout = '5s';
set local statement_timeout = '5min';

do $check$
begin
  if to_regnamespace('dflow_prod') is not null then
    raise exception '#5994/20261112205825 self-check: schema dflow_prod exists here; this migration is DesignFlow non-production only'
      using errcode = 'feature_not_supported';
  end if;
end
$check$;

do $check2$
begin
  if to_regclass('plm."itemHeader"') is null or to_regclass('dflow.item_product_description') is null then
    raise exception '#5994/20261112205825 self-check: plm."itemHeader" or dflow.item_product_description is missing'
      using errcode = 'feature_not_supported';
  end if;
end
$check2$;

lock table dflow.item_product_description in exclusive mode;

do $orphans$
begin
  if exists (
    select 1 from dflow.item_product_description i
    where i.is_human_override
      and not exists (select 1 from plm."itemHeader" p where p.item_id_pk = i.item_fk)
  ) then
    raise exception '#5994/20261112205825: a human override belongs to an item absent from plm."itemHeader"; stopping'
      using errcode = 'check_violation';
  end if;
end
$orphans$;

delete from dflow.item_product_description i
where not i.is_human_override
  and not exists (select 1 from plm."itemHeader" p where p.item_id_pk = i.item_fk);

do $repoint$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'item_product_description_item_fk_fkey'
      and conrelid = 'dflow.item_product_description'::regclass
      and confrelid = 'plm."itemHeader"'::regclass
  ) then
    return;
  end if;
  execute format('alter table %I.%I add constraint %I foreign key (item_fk) references %I.%I(item_id_pk) on delete cascade not valid',
    'dflow', 'item_product_description', 'item_product_description_item_fk_plm_fkey', 'plm', 'itemHeader');
  execute format('alter table %I.%I validate constraint %I',
    'dflow', 'item_product_description', 'item_product_description_item_fk_plm_fkey');
  execute format('alter table %I.%I drop constraint %I',
    'dflow', 'item_product_description', 'item_product_description_item_fk_fkey');
  execute format('alter table %I.%I rename constraint %I to %I',
    'dflow', 'item_product_description', 'item_product_description_item_fk_plm_fkey', 'item_product_description_item_fk_fkey');
end
$repoint$;

commit;
