-- Issue #4964: rudimentary per-retailer selling signal (red/yellow/green) on
-- items. One row per (item, retailer); a retailer is a core.customer row (the
-- CRM/PM retailer master). The signal is an owner-entered judgment, never
-- computed from orders.
-- derived-from: 20261027223520

begin;

create table plm.item_retailer_selling (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references plm.item(id) on delete restrict,
  retailer_id uuid not null references core.customer(id) on delete restrict,
  selling_signal text not null
    constraint item_retailer_selling_signal_check
    check (selling_signal in ('red', 'yellow', 'green')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint item_retailer_selling_item_retailer_key unique (item_id, retailer_id)
);

create index item_retailer_selling_retailer_id_idx
  on plm.item_retailer_selling (retailer_id);

comment on table plm.item_retailer_selling is
  'Rudimentary selling signal per item per retailer (issue #4964). A retailer is a core.customer row (retailer_id). selling_signal is an owner-entered traffic light (red poor / yellow middling / green strong), never computed from orders.';

-- Deny-by-default until consuming apps explicitly grant their roles,
-- matching the other item-master tables.
alter table plm.item_retailer_selling enable row level security;
revoke all on table plm.item_retailer_selling from public, anon, authenticated, service_role;

-- A canonical Customer merge must carry selling-signal rows to the survivor,
-- collapsing a pair that both retailers share. Body is the live 20261027223520
-- definition plus the plm.item_retailer_selling repoint.
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

  -- Selling signals are per (item, retailer). Collapse a pair both retailers
  -- share (the survivor's signal wins) and move every loser-only row.
  delete from plm.item_retailer_selling ls
  where ls.retailer_id = p_loser
    and exists (
      select 1 from plm.item_retailer_selling ss
      where ss.retailer_id = p_survivor and ss.item_id = ls.item_id
    );
  update plm.item_retailer_selling set retailer_id = p_survivor where retailer_id = p_loser;

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

-- Catalogue-only verification of the claimed shape and deny-by-default access.
do $verify$
declare
  actual_columns integer;
begin
  select count(*) into actual_columns
    from pg_catalog.pg_attribute
   where attrelid = pg_catalog.to_regclass('plm.item_retailer_selling')
     and attnum > 0 and not attisdropped;

  if actual_columns <> 6 then
    raise exception 'plm.item_retailer_selling: expected 6 columns, found %', actual_columns;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_class
     where oid = pg_catalog.to_regclass('plm.item_retailer_selling')
       and relkind = 'r' and relrowsecurity
  ) then
    raise exception 'plm.item_retailer_selling: ordinary table with RLS required';
  end if;

  if exists (
    select 1 from pg_catalog.pg_policies
     where schemaname = 'plm' and tablename = 'item_retailer_selling'
  ) then
    raise exception 'plm.item_retailer_selling: unexpected RLS policy';
  end if;
end
$verify$;

commit;
