-- popcre/shared-db#6997 (N1 of u2giants/popdam3#1298; claim on #6997)
-- Style groups carry licensor/property/customer ids plus copied names/codes.
-- The copies drifted (2,547 property names, 155 licensor codes in production
-- 2026-11-23). The names cannot be dropped (~114 functions read them), so
-- they become derived: the shared record is the only source.
--
--   1. BEFORE trigger on public.style_groups: whenever an id or a copied
--      name/code column is written, the name/code is reset from the linked
--      core.licensor / core.property / core.customer row. A writer can no
--      longer put a different name next to an id. Rows without an id keep
--      what they have (no shared record to derive from).
--   2. AFTER UPDATE statement triggers on core.licensor / core.property /
--      core.customer: a rename or recode updates the linked style groups in
--      one set-based statement (all style groups are ~11.5k rows, below the
--      20k batch ceiling).
--   3. One-time backfill of the current drift.
--
-- Division and merchandise-group names are NOT derived: style groups hold
-- only codes for them, with no id, and those codes are not the ColdLion
-- merch_group_detail codes, so no shared record exists to derive from.
-- Customer text is derived only when customer_id is set (0 rows today).

create or replace function public.style_groups_derive_shared_names()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_code text;
begin
  if new.licensor_id is not null then
    select l.name, l.code into v_name, v_code
      from core.licensor l where l.id = new.licensor_id;
    if found then
      new.licensor_name := v_name;
      new.licensor_code := v_code;
    end if;
  end if;

  if new.property_id is not null then
    select p.name, p.code into v_name, v_code
      from core.property p where p.id = new.property_id;
    if found then
      new.property_name := v_name;
      new.property_code := v_code;
    end if;
  end if;

  if new.customer_id is not null then
    select coalesce(c.display_name, c.name) into v_name
      from core.customer c where c.id = new.customer_id;
    if found then
      new.customer := v_name;
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.style_groups_derive_shared_names() from public, anon, authenticated;

-- Name sorts after redirect_retired_wb_licensor (which may swap licensor_id
-- first) and before style_groups_style_group_change_clock.
drop trigger if exists style_groups_derive_shared_names on public.style_groups;
create trigger style_groups_derive_shared_names
  before insert or update of licensor_id, licensor_name, licensor_code,
                             property_id, property_name, property_code,
                             customer_id, customer
  on public.style_groups
  for each row execute function public.style_groups_derive_shared_names();

create or replace function public.propagate_style_group_shared_names()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_schema = 'core' and tg_table_name = 'licensor' then
    update public.style_groups sg
       set licensor_name = n.name, licensor_code = n.code
      from new_rows n
      join old_rows o on o.id = n.id
     where sg.licensor_id = n.id
       and (n.name is distinct from o.name or n.code is distinct from o.code)
       and (sg.licensor_name is distinct from n.name
            or sg.licensor_code is distinct from n.code);
  elsif tg_table_schema = 'core' and tg_table_name = 'property' then
    update public.style_groups sg
       set property_name = n.name, property_code = n.code
      from new_rows n
      join old_rows o on o.id = n.id
     where sg.property_id = n.id
       and (n.name is distinct from o.name or n.code is distinct from o.code)
       and (sg.property_name is distinct from n.name
            or sg.property_code is distinct from n.code);
  elsif tg_table_schema = 'core' and tg_table_name = 'customer' then
    update public.style_groups sg
       set customer = coalesce(n.display_name, n.name)
      from new_rows n
      join old_rows o on o.id = n.id
     where sg.customer_id = n.id
       and coalesce(n.display_name, n.name) is distinct from coalesce(o.display_name, o.name)
       and sg.customer is distinct from coalesce(n.display_name, n.name);
  end if;
  return null;
end;
$$;

revoke all on function public.propagate_style_group_shared_names() from public, anon, authenticated;

drop trigger if exists propagate_style_group_names on core.licensor;
create trigger propagate_style_group_names
  after update on core.licensor
  referencing old table as old_rows new table as new_rows
  for each statement execute function public.propagate_style_group_shared_names();

drop trigger if exists propagate_style_group_names on core.property;
create trigger propagate_style_group_names
  after update on core.property
  referencing old table as old_rows new table as new_rows
  for each statement execute function public.propagate_style_group_shared_names();

drop trigger if exists propagate_style_group_names on core.customer;
create trigger propagate_style_group_names
  after update on core.customer
  referencing old table as old_rows new table as new_rows
  for each statement execute function public.propagate_style_group_shared_names();

-- One-time backfill (set-based; touches only drifted rows).
update public.style_groups sg
   set licensor_name = l.name, licensor_code = l.code
  from core.licensor l
 where l.id = sg.licensor_id
   and (sg.licensor_name is distinct from l.name or sg.licensor_code is distinct from l.code);

update public.style_groups sg
   set property_name = p.name, property_code = p.code
  from core.property p
 where p.id = sg.property_id
   and (sg.property_name is distinct from p.name or sg.property_code is distinct from p.code);

update public.style_groups sg
   set customer = coalesce(c.display_name, c.name)
  from core.customer c
 where c.id = sg.customer_id
   and sg.customer is distinct from coalesce(c.display_name, c.name);
