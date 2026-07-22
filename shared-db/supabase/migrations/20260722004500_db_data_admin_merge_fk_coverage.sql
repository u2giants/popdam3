-- DB Data Admin merge-engine coverage repair.
--
-- Extends the canonical Customer and Vendor merge engines for every FK found
-- in the 2026-07-22 preview pg_constraint inventory. Extension conflicts fail
-- closed so the later protected preview/apply wrapper must resolve them
-- explicitly; no non-null business value is silently discarded.

create or replace function core.reconcile_merge_extension_row(
  p_table regclass,
  p_key_column text,
  p_loser uuid,
  p_survivor uuid
) returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_loser jsonb;
  v_survivor jsonb;
begin
  execute format(
    'select to_jsonb(t) - %L - ''created_at'' - ''updated_at'' from %s t where %I = $1',
    p_key_column,
    p_table,
    p_key_column
  ) into v_loser using p_loser;

  execute format(
    'select to_jsonb(t) - %L - ''created_at'' - ''updated_at'' from %s t where %I = $1',
    p_key_column,
    p_table,
    p_key_column
  ) into v_survivor using p_survivor;

  if v_loser is null then
    return;
  end if;

  if v_survivor is not null and v_loser is distinct from v_survivor then
    raise exception 'merge extension conflict in % for loser % and survivor %',
      p_table, p_loser, p_survivor
      using errcode = 'integrity_constraint_violation',
            detail = 'Resolve every differing non-null extension field before calling the canonical merge engine.';
  end if;

  if v_survivor is not null then
    execute format('delete from %s where %I = $1', p_table, p_key_column)
      using p_loser;
  else
    execute format('update %s set %I = $2 where %I = $1', p_table, p_key_column, p_key_column)
      using p_loser, p_survivor;
  end if;
end;
$$;

revoke all on function core.reconcile_merge_extension_row(regclass,text,uuid,uuid) from public;
comment on function core.reconcile_merge_extension_row(regclass,text,uuid,uuid) is
  'Private merge-engine helper. Moves one-sided extension rows, collapses identical duplicates, and fails closed on business-field conflicts.';

create or replace function core.merge_customer(
  p_loser uuid,
  p_survivor uuid,
  p_alias_loser_name boolean default true
) returns void
language plpgsql
security definer
set search_path = core, crm, pim, dam, plm, app, public
as $$
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
$$;

revoke all on function core.merge_customer(uuid,uuid,boolean) from public;
grant execute on function core.merge_customer(uuid,uuid,boolean) to service_role;
comment on function core.merge_customer(uuid,uuid,boolean) is
  'Canonical Customer merge. Call with named loser/survivor arguments. Covers the complete 2026-07-22 FK inventory and fails closed on extension conflicts.';

create or replace function core.merge_factory(
  p_loser uuid,
  p_survivor uuid,
  p_alias_loser_name boolean default true
) returns void
language plpgsql
security definer
set search_path = core, crm, pim, dam, plm, app, public
as $$
declare
  v_loser_name text;
  v_loser_display text;
begin
  if p_loser = p_survivor then
    raise exception 'merge_factory: loser and survivor are the same (%).', p_loser;
  end if;
  if not exists (select 1 from core.factory where id = p_survivor) then
    raise exception 'merge_factory: survivor % does not exist.', p_survivor;
  end if;
  select name, display_name into v_loser_name, v_loser_display
  from core.factory where id = p_loser;
  if not found then
    raise exception 'merge_factory: loser % does not exist.', p_loser;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(least(p_loser::text, p_survivor::text), 1));
  perform pg_advisory_xact_lock(hashtextextended(greatest(p_loser::text, p_survivor::text), 1));

  perform core.reconcile_merge_extension_row('crm.factory_ext', 'factory_id', p_loser, p_survivor);
  perform core.reconcile_merge_extension_row('pim.factory_ext', 'factory_id', p_loser, p_survivor);
  perform core.reconcile_merge_extension_row('dam.factory_ext', 'factory_id', p_loser, p_survivor);

  delete from core.vendor_contact lc
  where lc.factory_id = p_loser
    and exists (
      select 1 from core.vendor_contact sc
      where sc.factory_id = p_survivor
        and sc.contact_id is not distinct from lc.contact_id
        and sc.role is not distinct from lc.role
    );
  update core.vendor_contact set factory_id = p_survivor where factory_id = p_loser;

  delete from core.factory_alias la
  where la.factory_id = p_loser
    and exists (
      select 1 from core.factory_alias sa
      where sa.factory_id = p_survivor
        and sa.normalized_alias = la.normalized_alias
    );
  update core.factory_alias set factory_id = p_survivor where factory_id = p_loser;

  update core.factory_source_ref set factory_id = p_survivor where factory_id = p_loser;

  update crm.opportunity set factory_id = p_survivor where factory_id = p_loser;
  update pim.product set factory_id = p_survivor where factory_id = p_loser;
  update pim.product_sample set factory_id = p_survivor where factory_id = p_loser;
  update plm.erp_vendor set factory_id = p_survivor where factory_id = p_loser;
  update plm.production_order set factory_id = p_survivor where factory_id = p_loser;
  update plm.rfq_vendor set factory_id = p_survivor where factory_id = p_loser;
  update plm.style_tracker_item_bridge set factory_id = p_survivor where factory_id = p_loser;

  if p_alias_loser_name then
    insert into core.factory_alias (factory_id, alias, alias_type, source_system, notes)
    select p_survivor, v_loser_name, 'other', 'merge', 'from merged factory ' || p_loser
    on conflict (factory_id, normalized_alias) do nothing;
    if v_loser_display is not null and lower(v_loser_display) <> lower(v_loser_name) then
      insert into core.factory_alias (factory_id, alias, alias_type, source_system, notes)
      select p_survivor, v_loser_display, 'other', 'merge',
        'display name from merged factory ' || p_loser
      on conflict (factory_id, normalized_alias) do nothing;
    end if;
  end if;

  delete from core.factory where id = p_loser;
end;
$$;

revoke all on function core.merge_factory(uuid,uuid,boolean) from public;
grant execute on function core.merge_factory(uuid,uuid,boolean) to service_role;
comment on function core.merge_factory(uuid,uuid,boolean) is
  'Canonical Vendor merge. Call with named loser/survivor arguments. Covers the complete 2026-07-22 FK inventory and fails closed on extension conflicts.';

