-- Fix post-rename leftovers after core.company was hard-renamed to core.customer.
--
-- The customer rename migrations landed, but a few live objects/rows could still
-- resolve or persist the old table name. Reassert the current contract without
-- creating a core.company compatibility shim.

do $$
declare
  fn text;
begin
  select pg_get_functiondef(p.oid)
  into fn
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'plm'
    and p.proname = 'import_master_data'
    and p.prokind = 'f';

  if fn is not null then
    fn := replace(fn, 'from core.company c', 'from core.customer c');
    fn := replace(fn, 'insert into core.company (', 'insert into core.customer (');
    fn := replace(fn, 'update core.company', 'update core.customer');
    execute fn;
  end if;

  select pg_get_functiondef(p.oid)
  into fn
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'plm'
    and p.proname = 'refresh_style_tracker_item_bridge'
    and p.prokind = 'f';

  if fn is not null then
    fn := replace(fn, 'FROM core.company', 'FROM core.customer');
    fn := replace(fn, 'from core.company', 'from core.customer');
    fn := replace(fn, 'target_table = ''company''', 'target_table = ''customer''');
    execute fn;
  end if;
end $$;

create or replace view api.global_search
with (security_invoker = true)
as
select 'customer'::text as entity_type, id, name as title, domain as subtitle, 'core.customer'::text as source_table, updated_at
from core.customer
union all
select 'contact', id, coalesce(full_name, concat_ws(' ', first_name, last_name), email::text), email::text, 'core.contact', updated_at
from core.contact
union all
select 'product', id, name, code, 'pim.product', updated_at
from pim.product
union all
select 'project', id, title, status, 'pim.project', updated_at
from pim.project
union all
select 'opportunity', id, name, stage, 'crm.opportunity', updated_at
from crm.opportunity
union all
select 'asset', id, coalesce(title, filename), sku, 'dam.asset', updated_at
from dam.asset
union all
select 'plm_item', id, coalesce(name, item_number), style_number, 'plm.item', updated_at
from plm.item;

do $$
begin
  if to_regclass('plm.style_tracker_value_resolution') is not null then
    update plm.style_tracker_value_resolution
    set target_table = 'customer'
    where target_schema = 'core'
      and target_table = 'company';
  end if;

  if to_regclass('plm.style_tracker_item_bridge') is not null then
    update plm.style_tracker_item_bridge
    set match_notes = jsonb_set(match_notes, '{manual_resolution,target_table}', '"customer"', false)
    where match_notes #>> '{manual_resolution,target_schema}' = 'core'
      and match_notes #>> '{manual_resolution,target_table}' = 'company';
  end if;
end $$;
