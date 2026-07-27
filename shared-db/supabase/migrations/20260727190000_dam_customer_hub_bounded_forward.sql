-- Bounded DAM customer-hub forward reconciliation.
--
-- The original customer hub and UUID path-facet migrations are already live
-- through 20260723183000_step11_bounded_production_forward.sql, but their source
-- versions remain below production's migration head. This forward migration:
--   * fixes the resolver's comma guard so comma-separated style codes after a
--     recognized customer prefix (for example Rooms to Go - CODE1, CODE2) link;
--   * preserves genuine comma-separated multi-customer values as unlinked;
--   * backfills only currently-null customer_id values;
--   * asserts the complete customer-hub and UUID path-facet contract.
--
-- It intentionally contains no ColdLion or PopSG taxonomy work.

set local statement_timeout = '10min';

create or replace function public.dam_resolve_customer(p_text text)
returns uuid
language sql
stable
security definer
set search_path = public, pg_catalog
as $function$
  with n as (
    select lower(regexp_replace(trim(coalesce(p_text, '')), '\s+', ' ', 'g')) as t
  ),
  nc as (
    select c.id,
      lower(regexp_replace(trim(c.name), '\s+', ' ', 'g')) as nname,
      lower(regexp_replace(trim(coalesce(c.display_name, '')), '\s+', ' ', 'g')) as dname
    from core.customer c
  ),
  na as (
    select a.customer_id as id,
      lower(regexp_replace(trim(a.alias), '\s+', ' ', 'g')) as aname
    from core.customer_alias a
  ),
  cand as (
    select nc.id, 100 as pri, length(nc.nname) as keylen
    from n, nc where nc.nname = n.t
    union all
    select nc.id, 100, length(nc.dname)
    from n, nc where nc.dname <> '' and nc.dname = n.t
    union all
    select na.id, 100, length(na.aname)
    from n, na where na.aname = n.t
    union all
    select nc.id, 50, length(nc.nname)
    from n, nc
    where length(nc.nname) >= 3
      and (n.t like nc.nname || ' %' or n.t like nc.nname || '-%')
    union all
    select nc.id, 50, length(nc.dname)
    from n, nc
    where nc.dname <> '' and length(nc.dname) >= 3
      and (n.t like nc.dname || ' %' or n.t like nc.dname || '-%')
    union all
    select na.id, 50, length(na.aname)
    from n, na
    where length(na.aname) >= 3
      and (n.t like na.aname || ' %' or n.t like na.aname || '-%')
  )
  select id
  from cand
  where (select t from n) <> ''
  order by pri desc, keylen desc
  limit 1
$function$;

comment on function public.dam_resolve_customer(text) is
  'Best-effort map of a legacy free-text DAM customer string to core.customer.id. Exact name/display/alias match, else longest explicit space-or-hyphen prefix match. Commas after a recognized prefix may separate style codes; comma-separated customer names do not satisfy the prefix boundary. Returns null when no confident match.';

with customer_map as materialized (
  select d.customer, public.dam_resolve_customer(d.customer) as customer_id
  from (
    select distinct customer
    from public.style_groups
    where customer_id is null and nullif(trim(customer), '') is not null
  ) d
)
update public.style_groups s
set customer_id = m.customer_id
from customer_map m
where s.customer_id is null
  and s.customer = m.customer
  and m.customer_id is not null;

with customer_map as materialized (
  select d.customer, public.dam_resolve_customer(d.customer) as customer_id
  from (
    select distinct customer
    from public.assets
    where customer_id is null and nullif(trim(customer), '') is not null
  ) d
)
update public.assets a
set customer_id = m.customer_id
from customer_map m
where a.customer_id is null
  and a.customer = m.customer
  and m.customer_id is not null;

alter table public.style_tracker_rows disable trigger trg_style_tracker_row_audit;
with customer_map as materialized (
  select d.customer, public.dam_resolve_customer(d.customer) as customer_id
  from (
    select distinct customer
    from public.style_tracker_rows
    where customer_id is null and nullif(trim(customer), '') is not null
  ) d
)
update public.style_tracker_rows s
set customer_id = m.customer_id
from customer_map m
where s.customer_id is null
  and s.customer = m.customer
  and m.customer_id is not null;
alter table public.style_tracker_rows enable trigger trg_style_tracker_row_audit;

do $contract$
declare
  v_rooms_to_go uuid;
begin
  if to_regprocedure('public.get_dam_customer_facets()') is null
     or to_regprocedure('public.get_path_facets(uuid)') is null
     or to_regprocedure('public.get_path_facets(text)') is not null then
    raise exception 'DAM customer/path facet function contract is incomplete';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'style_groups'
      and column_name = 'customer_id'
  ) or not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'assets'
      and column_name = 'customer_id'
  ) then
    raise exception 'DAM customer_id columns are incomplete';
  end if;

  if (
    select count(*)
    from core.customer
    where name in ('CVS', 'Costco', 'Meijer')
      and status = 'potential'::app.entity_status
  ) <> 3 then
    raise exception 'CVS/Costco/Meijer potential-customer contract is incomplete';
  end if;

  select id into v_rooms_to_go
  from core.customer
  where coalesce(display_name, name) = 'Rooms to Go'
  order by id
  limit 1;

  if v_rooms_to_go is null
     or public.dam_resolve_customer(
          'Rooms to Go - HGP21DYCR01, HGP21DYCR02, HGP21DYCR03'
        ) is distinct from v_rooms_to_go then
    raise exception 'Rooms to Go comma-separated style-code resolution failed';
  end if;

  if public.dam_resolve_customer('Burlington, Ross') is not null
     or public.dam_resolve_customer('TJX, HomeGoods') is not null then
    raise exception 'multi-customer comma value resolved unexpectedly';
  end if;

  if exists (
    select 1
    from (
      select customer, customer_id from public.style_groups
      union all
      select customer, customer_id from public.assets
      union all
      select customer, customer_id from public.style_tracker_rows
    ) d
    where d.customer like 'Rooms to Go - %'
      and d.customer_id is null
  ) then
    raise exception 'Rooms to Go style-code rows remain unlinked';
  end if;

  if not exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.style_tracker_rows'::regclass
      and tgname = 'trg_style_tracker_row_audit'
      and tgenabled = 'O'
  ) then
    raise exception 'style_tracker audit trigger is not enabled';
  end if;
end
$contract$;

grant execute on function public.dam_resolve_customer(text)
  to authenticated, service_role;

notify pgrst, 'reload schema';
