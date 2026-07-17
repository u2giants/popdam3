-- core.merge_customer(loser, survivor, alias_loser_name) — collapse a duplicate
-- customer into another, safely.
--
-- Motivation: 24 FK columns across core/crm/pim/dam/plm reference core.customer(id).
-- Deduping customers (Dollarama/Dollarama L.P., Burlington/Modecraft, the TJX Canada
-- banners, etc.) means repointing every one of those to the survivor before deleting
-- the loser. Three carry company-scoped uniqueness (core.customer_alias,
-- core.contact_company, crm.department) and need conflict-safe repoint; the rest are
-- plain repoints. The loser's source refs move to the survivor and its name +
-- display_name are preserved as core.customer_alias rows so nothing becomes
-- unsearchable. Rehearsed in a rolled-back transaction before first use.
--
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

  -- 1. Composite-unique tables: drop loser rows that would collide, repoint the rest.
  delete from core.customer_alias la where la.customer_id=p_loser
    and exists (select 1 from core.customer_alias sa where sa.customer_id=p_survivor and sa.normalized_alias=la.normalized_alias);
  update core.customer_alias set customer_id=p_survivor where customer_id=p_loser;

  delete from core.contact_company lc where lc.company_id=p_loser
    and exists (select 1 from core.contact_company sc where sc.company_id=p_survivor and sc.contact_id=lc.contact_id);
  update core.contact_company set company_id=p_survivor where company_id=p_loser;

  update crm.department d set company_id=p_survivor where company_id=p_loser
    and not exists (select 1 from crm.department s where s.company_id=p_survivor and s.name=d.name);
  delete from crm.department where company_id=p_loser;

  -- 2. company_source_ref: unique is on (source_system,source_table,source_id), not
  --    company_id, so repointing never collides. Carries the loser's ERP/Directus
  --    codes onto the survivor (exactly what we want).
  update core.company_source_ref set company_id=p_survivor where company_id=p_loser;

  -- 3. Plain FK columns (no company-scoped unique): repoint straight across.
  update core.factory                    set company_id=p_survivor where company_id=p_loser;
  update crm.email_message               set company_id=p_survivor where company_id=p_loser;
  update crm.licensor_approval_thread    set company_id=p_survivor where company_id=p_loser;
  update crm.meeting_note                set company_id=p_survivor where company_id=p_loser;
  update crm.note                        set company_id=p_survivor where company_id=p_loser;
  update crm.opportunity                 set company_id=p_survivor where company_id=p_loser;
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

  -- 4. Preserve the loser's name (and display name) as searchable aliases on survivor.
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

  -- 5. Delete the loser.
  delete from core.customer where id=p_loser;
end;
$$;

revoke all on function core.merge_customer(uuid,uuid,boolean) from public;
grant execute on function core.merge_customer(uuid,uuid,boolean) to service_role;
comment on function core.merge_customer(uuid,uuid,boolean) is
  'Merge duplicate customers: repoints all 24 FK references from p_loser to p_survivor (conflict-safe on customer_alias, contact_company, crm.department), carries the loser source refs onto the survivor, preserves the loser name/display_name as aliases, then deletes the loser. security definer, service_role only.';
