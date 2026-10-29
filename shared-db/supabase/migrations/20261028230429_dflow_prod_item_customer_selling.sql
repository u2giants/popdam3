-- Issue #4964: re-key the per-retailer selling signal to DesignFlow ids.
-- 20261028154414 created plm.item_retailer_selling keyed on plm.item /
-- core.customer uuids with no grants. The consumer is DesignFlow, whose item
-- page keys items by dflow_prod."itemHeader".item_id_pk (integer) and
-- retailers by dflow_prod.customers.customers_id (integer). That table held
-- zero rows when this was written (verified live 2026-10-28), so it is
-- dropped and core.merge_customer returns to its pre-#4964 body.
-- derived-from: 20261028154414
-- The new table lives beside the rows it describes. No foreign keys: the
-- DesignFlow data-sync reloads itemHeader/customers, and a cascade would erase
-- owner-entered signals; the item-master service validates ids on write.
-- Access through the existing NOLOGIN grants roles (backend + item-master),
-- matching every dflow_prod table. Rollback: forward migration; preserve rows.

set lock_timeout = '5s';
set statement_timeout = '2min';

do $pre$
begin
  if exists (select 1 from plm.item_retailer_selling) then
    raise exception '#4964: plm.item_retailer_selling holds rows; refusing to drop';
  end if;
  if to_regnamespace('dflow_prod') is null then raise exception '#4964: dflow_prod missing'; end if;
  if not exists (select 1 from pg_roles where rolname = 'designflow_prod_backend_grants' and not rolcanlogin)
     or not exists (select 1 from pg_roles where rolname = 'designflow_prod_item_master_grants' and not rolcanlogin) then
    raise exception '#4964: DesignFlow grants roles missing';
  end if;
end $pre$;

drop table plm.item_retailer_selling;

create table dflow_prod.item_customer_selling (
  id bigint generated always as identity primary key,
  item_id integer not null,
  customer_id integer not null,
  selling_signal text not null
    constraint item_customer_selling_signal_check
    check (selling_signal in ('red', 'yellow', 'green')),
  updated_by_user_id integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint item_customer_selling_item_customer_key unique (item_id, customer_id)
);

comment on table dflow_prod.item_customer_selling is
  'Owner-entered selling signal per item per retailer (issue #4964): item_id = dflow_prod."itemHeader".item_id_pk, customer_id = dflow_prod.customers.customers_id, selling_signal red (poor) / yellow (middling) / green (strong). Never computed from orders.';

revoke all on table dflow_prod.item_customer_selling from public, anon, authenticated, service_role;
grant select, insert, update, delete on table dflow_prod.item_customer_selling
  to designflow_prod_backend_grants, designflow_prod_item_master_grants;

create or replace function core.merge_customer(p_loser uuid, p_survivor uuid, p_alias_loser_name boolean default true)
returns void
language plpgsql
security definer
set search_path to 'core', 'crm', 'pim', 'dam', 'plm', 'app', 'public'
as $function$
declare
  v_loser_name text;
  v_loser_display text;
begin
  if p_loser = p_survivor then
    raise exception 'merge_customer: loser and survivor are the same (%).', p_loser;
  end if;
  if not exists (select 1 from core.customer where id = p_survivor) then
    raise exception 'merge_customer: survivor % does not exist.', p_survivor;
  end if;
  select name, display_name into v_loser_name, v_loser_display
  from core.customer where id = p_loser;
  if not found then
    raise exception 'merge_customer: loser % does not exist.', p_loser;
  end if;

  -- Serialize concurrent attempts for the same pair in a stable order.
  perform pg_advisory_xact_lock(hashtextextended(least(p_loser::text, p_survivor::text), 0));
  perform pg_advisory_xact_lock(hashtextextended(greatest(p_loser::text, p_survivor::text), 0));

  -- Per-app 1:1 rows: move one-sided data, collapse identical rows, and stop
  -- before data loss when business fields differ.
  perform core.reconcile_merge_extension_row('crm.customer_ext', 'customer_id', p_loser, p_survivor);
  perform core.reconcile_merge_extension_row('pim.customer_ext', 'customer_id', p_loser, p_survivor);
  perform core.reconcile_merge_extension_row('dam.customer_ext', 'customer_id', p_loser, p_survivor);

  -- Customer Channels are set membership. Preserve the survivor assignment on
  -- duplicate membership and move every loser-only assignment.
  delete from core.customer_channel lc
  where lc.customer_id = p_loser
    and exists (
      select 1 from core.customer_channel sc
      where sc.customer_id = p_survivor and sc.channel_id = lc.channel_id
    );
  update core.customer_channel set customer_id = p_survivor where customer_id = p_loser;

  -- CRM department/company consistency must be resolved before ordinary FK
  -- repoints because enforcement triggers validate both columns together.
  update core.contact_company cc
  set company_id = p_survivor, crm_department_id = s.id
  from crm.department l
  join crm.department s on s.company_id = p_survivor and s.name = l.name
  where l.company_id = p_loser and cc.crm_department_id = l.id;

  update crm.opportunity o
  set company_id = p_survivor, department_id = s.id
  from crm.department l
  join crm.department s on s.company_id = p_survivor and s.name = l.name
  where l.company_id = p_loser and o.department_id = l.id;

  delete from crm.department l
  where l.company_id = p_loser
    and exists (
      select 1 from crm.department s
      where s.company_id = p_survivor and s.name = l.name
    );
  update crm.department set company_id = p_survivor where company_id = p_loser;

  delete from core.contact_company lc
  where lc.company_id = p_loser
    and exists (
      select 1 from core.contact_company sc
      where sc.company_id = p_survivor and sc.contact_id = lc.contact_id
    );
  update core.contact_company set company_id = p_survivor where company_id = p_loser;
  update crm.opportunity set company_id = p_survivor where company_id = p_loser;

  delete from core.customer_alias la
  where la.customer_id = p_loser
    and exists (
      select 1 from core.customer_alias sa
      where sa.customer_id = p_survivor
        and sa.normalized_alias = la.normalized_alias
    );
  update core.customer_alias set customer_id = p_survivor where customer_id = p_loser;

  update core.company_source_ref set company_id = p_survivor where company_id = p_loser;

  update core.factory set company_id = p_survivor where company_id = p_loser;
  update crm.email_message set company_id = p_survivor where company_id = p_loser;
  update crm.ingested_domain set customer_id = p_survivor where customer_id = p_loser;
  update crm.licensor_approval_thread set company_id = p_survivor where company_id = p_loser;
  update crm.meeting_note set company_id = p_survivor where company_id = p_loser;
  update crm.note set company_id = p_survivor where company_id = p_loser;
  update crm.task set company_id = p_survivor where company_id = p_loser;
  update dam.asset set company_id = p_survivor where company_id = p_loser;
  update dam.style_group set company_id = p_survivor where company_id = p_loser;
  update dam.style_guide_file set company_id = p_survivor where company_id = p_loser;
  update pim.customer_order set company_id = p_survivor where company_id = p_loser;
  update pim.design_collection set company_id = p_survivor where company_id = p_loser;
  update pim.product set company_id = p_survivor where company_id = p_loser;
  update pim.project set company_id = p_survivor where company_id = p_loser;
  update plm.customer_import set company_id = p_survivor where company_id = p_loser;
  update plm.erp_customer set customer_id = p_survivor where customer_id = p_loser;
  update plm.item set company_id = p_survivor where company_id = p_loser;


  update plm.production_order set company_id = p_survivor where company_id = p_loser;
  update plm.rfq_group set company_id = p_survivor where company_id = p_loser;
  update plm.style_tracker_item_bridge set company_id = p_survivor where company_id = p_loser;
  update public.assets set customer_id = p_survivor where customer_id = p_loser;
  update public.style_groups set customer_id = p_survivor where customer_id = p_loser;
  update public.style_tracker_rows set customer_id = p_survivor where customer_id = p_loser;

  if p_alias_loser_name then
    insert into core.customer_alias (customer_id, alias, alias_type, source_system, notes)
    select p_survivor, v_loser_name, 'other', 'merge', 'from merged customer ' || p_loser
    on conflict (customer_id, normalized_alias) do nothing;
    if v_loser_display is not null and lower(v_loser_display) <> lower(v_loser_name) then
      insert into core.customer_alias (customer_id, alias, alias_type, source_system, notes)
      select p_survivor, v_loser_display, 'other', 'merge',
        'display name from merged customer ' || p_loser
      on conflict (customer_id, normalized_alias) do nothing;
    end if;
  end if;

  delete from core.customer where id = p_loser;
end;
$function$;

do $verify$
declare v_oid regclass := 'dflow_prod.item_customer_selling'::regclass;
begin
  if to_regclass('plm.item_retailer_selling') is not null then
    raise exception '#4964: plm.item_retailer_selling still exists';
  end if;
  if (select string_agg(attname || ':' || format_type(atttypid, atttypmod) || ':' || attnotnull, ',' order by attnum)
      from pg_attribute where attrelid = v_oid and attnum > 0 and not attisdropped)
     is distinct from 'id:bigint:true,item_id:integer:true,customer_id:integer:true,selling_signal:text:true,updated_by_user_id:integer:false,created_at:timestamp with time zone:true,updated_at:timestamp with time zone:true' then
    raise exception '#4964: column signature differs';
  end if;
  if exists (select 1 from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
             where has_table_privilege('designflow_prod_backend_runtime', v_oid, p) is distinct from (p in ('SELECT','INSERT','UPDATE','DELETE'))
                or has_table_privilege('designflow_prod_item_master_runtime', v_oid, p) is distinct from (p in ('SELECT','INSERT','UPDATE','DELETE'))) then
    raise exception '#4964: runtime effective ACL differs';
  end if;
  if pg_get_functiondef('core.merge_customer(uuid,uuid,boolean)'::regprocedure) like '%item_retailer_selling%' then
    raise exception '#4964: merge_customer still references the dropped table';
  end if;
end $verify$;
