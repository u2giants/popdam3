-- Fix core.merge_customer for CRM department/company consistency triggers.
--
-- core.contact_company.crm_department_id and crm.opportunity.department_id must
-- always reference a crm.department whose company_id equals the row's company_id
-- (enforced by crm.enforce_contact_company_department / enforce_department_company).
-- The first version repointed contact_company/opportunity company_id before the
-- department was repointed, creating an inconsistent intermediate state that tripped
-- those triggers. This version resolves the loser's departments onto the survivor
-- FIRST (moving company_id + department ref together where a UNIQUE(company_id,name)
-- collision forces a swap), then repoints the company_id columns.

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
  if not exists (select 1 from core.customer where id=p_survivor) then
    raise exception 'merge_customer: survivor % does not exist.', p_survivor;
  end if;
  select name, display_name into v_loser_name, v_loser_display from core.customer where id=p_loser;
  if not found then
    raise exception 'merge_customer: loser % does not exist.', p_loser;
  end if;

  -- ================= CRM department/company consistency =================
  -- crm.department is UNIQUE(company_id, name); core.contact_company.crm_department_id
  -- and crm.opportunity.department_id must always reference a department whose
  -- company_id equals the row's company_id (enforced by triggers). So we resolve the
  -- loser's departments onto the survivor BEFORE repointing company_id anywhere, and
  -- update company_id + department ref together where a name collision forces a swap.

  -- A. Dependents of a loser department that collides by name with a survivor department:
  --    move company_id + dept ref together to the survivor's same-named department.
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

  -- B. Delete the now-orphaned colliding loser departments; repoint the rest to survivor.
  delete from crm.department l
  where l.company_id = p_loser
    and exists (select 1 from crm.department s where s.company_id = p_survivor and s.name = l.name);
  update crm.department set company_id = p_survivor where company_id = p_loser;

  -- C. Every remaining loser department now belongs to the survivor, so repointing the
  --    loser's contact_company / opportunity company_id keeps dept refs consistent.
  delete from core.contact_company lc
  where lc.company_id = p_loser
    and exists (select 1 from core.contact_company sc where sc.company_id = p_survivor and sc.contact_id = lc.contact_id);
  update core.contact_company set company_id = p_survivor where company_id = p_loser;
  update crm.opportunity        set company_id = p_survivor where company_id = p_loser;

  -- ================= aliases (composite-unique) =================
  delete from core.customer_alias la where la.customer_id=p_loser
    and exists (select 1 from core.customer_alias sa where sa.customer_id=p_survivor and sa.normalized_alias=la.normalized_alias);
  update core.customer_alias set customer_id=p_survivor where customer_id=p_loser;

  -- ================= source refs (unique on source, not company) =================
  update core.company_source_ref set company_id=p_survivor where company_id=p_loser;

  -- ================= plain FK columns =================
  update core.factory                    set company_id=p_survivor where company_id=p_loser;
  update crm.email_message               set company_id=p_survivor where company_id=p_loser;
  update crm.licensor_approval_thread    set company_id=p_survivor where company_id=p_loser;
  update crm.meeting_note                set company_id=p_survivor where company_id=p_loser;
  update crm.note                        set company_id=p_survivor where company_id=p_loser;
  update crm.task                        set company_id=p_survivor where company_id=p_loser;
  update dam.asset                       set company_id=p_survivor where company_id=p_loser;
  update dam.style_group                 set company_id=p_survivor where company_id=p_loser;
  update dam.style_guide_file            set company_id=p_survivor where company_id=p_loser;
  update pim.customer_order              set company_id=p_survivor where company_id=p_loser;
  update pim.design_collection           set company_id=p_survivor where company_id=p_loser;
  update pim.product                     set company_id=p_survivor where company_id=p_loser;
  update pim.project                     set company_id=p_survivor where company_id=p_loser;
  update plm.customer_import             set company_id=p_survivor where company_id=p_loser;
  update plm.erp_customer                set customer_id=p_survivor where customer_id=p_loser;
  update plm.item                        set company_id=p_survivor where company_id=p_loser;
  update plm.production_order            set company_id=p_survivor where company_id=p_loser;
  update plm.rfq_group                   set company_id=p_survivor where company_id=p_loser;
  update plm.style_tracker_item_bridge   set company_id=p_survivor where company_id=p_loser;

  -- ================= preserve names as aliases, delete loser =================
  if p_alias_loser_name then
    insert into core.customer_alias (customer_id, alias, alias_type, source_system, notes)
    select p_survivor, v_loser_name, 'other', 'merge', 'from merged customer '||p_loser
    on conflict (customer_id, normalized_alias) do nothing;
    if v_loser_display is not null and lower(v_loser_display) <> lower(v_loser_name) then
      insert into core.customer_alias (customer_id, alias, alias_type, source_system, notes)
      select p_survivor, v_loser_display, 'other', 'merge', 'display name from merged customer '||p_loser
      on conflict (customer_id, normalized_alias) do nothing;
    end if;
  end if;

  delete from core.customer where id=p_loser;
end;
$$;

revoke all on function core.merge_customer(uuid,uuid,boolean) from public;
grant execute on function core.merge_customer(uuid,uuid,boolean) to service_role;
