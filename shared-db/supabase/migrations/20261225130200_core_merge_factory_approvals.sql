-- derived-from: 20261116120100
-- Issue #7070. core.merge_factory now carries factory licensor and retailer approvals,
-- approval forms and reminder marks from the loser to the survivor.
-- Body is the 20261116120100 definition plus the #7070 block only.

CREATE OR REPLACE FUNCTION core.merge_factory(p_loser uuid, p_survivor uuid, p_alias_loser_name boolean DEFAULT true)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'core', 'crm', 'pim', 'dam', 'plm', 'app', 'public'
AS $function$
declare
  v_loser_name text;
  v_loser_display text;
  v_loser core.factory%rowtype;
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
-- #7070: licensor and retailer approvals. Survivor keeps its own answer unless the loser was
-- approved and the survivor was not; all forms and reminder marks move over.
update core.factory_approval s
   set is_approved = true, approved_name = l.approved_name,
       facility_number = l.facility_number, issued_on = l.issued_on,
       expires_on = l.expires_on, form_reference = l.form_reference,
       value_source = l.value_source, current_form_id = l.current_form_id
  from core.factory_approval l
 where s.factory_id = p_survivor and l.factory_id = p_loser
   and s.program = l.program and l.is_approved and not s.is_approved;
insert into core.factory_approval (factory_id, program, is_approved, approved_name, facility_number, issued_on, expires_on, form_reference, value_source, current_form_id)
select p_survivor, program, is_approved, approved_name, facility_number, issued_on, expires_on, form_reference, value_source, current_form_id
  from core.factory_approval where factory_id = p_loser
on conflict (factory_id, program) do nothing;
delete from core.factory_approval where factory_id = p_loser;
update core.factory_approval_form set factory_id = p_survivor where factory_id = p_loser;
insert into core.factory_approval_reminder (factory_id, program, expires_on, sent_at)
select p_survivor, program, expires_on, sent_at from core.factory_approval_reminder where factory_id = p_loser
on conflict do nothing;
delete from core.factory_approval_reminder where factory_id = p_loser;

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

  -- #4708: owner-reviewed fields fill survivor gaps; link rows move and dedupe.
  select * into v_loser from core.factory where id = p_loser;
  update core.factory set designflow_vendor_id = null where id = p_loser;
  update core.factory s set
    designflow_vendor_id = coalesce(s.designflow_vendor_id, v_loser.designflow_vendor_id),
    party_type = coalesce(s.party_type, v_loser.party_type),
    trade_name = coalesce(s.trade_name, v_loser.trade_name),
    orders_completed = coalesce(s.orders_completed, v_loser.orders_completed),
    orders_with_problem = coalesce(s.orders_with_problem, v_loser.orders_with_problem)
  where s.id = p_survivor;

  insert into core.factory_rep (factory_id, name)
  select p_survivor, name from core.factory_rep where factory_id = p_loser
  on conflict (factory_id, name) do nothing;
  delete from core.factory_rep where factory_id = p_loser;

  update core.factory_vendor_login set factory_id = p_survivor where factory_id = p_loser;

  delete from core.factory_representation
  where (trading_company_id = p_loser and factory_id = p_survivor)
     or (trading_company_id = p_survivor and factory_id = p_loser);
  insert into core.factory_representation (trading_company_id, factory_id)
  select p_survivor, factory_id from core.factory_representation where trading_company_id = p_loser
  on conflict do nothing;
  insert into core.factory_representation (trading_company_id, factory_id)
  select trading_company_id, p_survivor from core.factory_representation where factory_id = p_loser
  on conflict do nothing;
  delete from core.factory_representation where trading_company_id = p_loser or factory_id = p_loser;

  -- Survivor's categories keep their ranks; the loser's extra ones follow, up to five.
  insert into core.factory_product_category (factory_id, product_category_id, rank)
  select p_survivor, l.product_category_id,
         (select coalesce(max(rank), 0) from core.factory_product_category where factory_id = p_survivor)
           + row_number() over (order by l.rank)
  from core.factory_product_category l
  where l.factory_id = p_loser
    and not exists (select 1 from core.factory_product_category s
                    where s.factory_id = p_survivor and s.product_category_id = l.product_category_id)
  order by l.rank
  limit greatest(0, 5 - (select count(*) from core.factory_product_category where factory_id = p_survivor));
  delete from core.factory_product_category where factory_id = p_loser;

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
$function$
;
revoke all on function core.merge_factory(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function core.merge_factory(uuid, uuid, boolean) to service_role;
