-- Production-safe bounded DAM customer-hub forward.
--
-- 20260727190000 proved the resolver and backfill on preview, but its SET LOCAL
-- statement was outside an explicit transaction and therefore did not activate
-- the intended timeout. This new immutable forward is the production promotion
-- target. It repeats the preview-proven fix idempotently with a real session
-- timeout, resets that timeout, and asserts the completed contract.

set statement_timeout = '10min';

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

update public.style_groups s
set customer_id = public.dam_resolve_customer(s.customer)
where s.customer_id is null
  and nullif(trim(s.customer), '') is not null
  and public.dam_resolve_customer(s.customer) is not null;

update public.assets a
set customer_id = public.dam_resolve_customer(a.customer)
where a.customer_id is null
  and nullif(trim(a.customer), '') is not null
  and public.dam_resolve_customer(a.customer) is not null;

alter table public.style_tracker_rows disable trigger trg_style_tracker_row_audit;
update public.style_tracker_rows s
set customer_id = public.dam_resolve_customer(s.customer)
where s.customer_id is null
  and nullif(trim(s.customer), '') is not null
  and public.dam_resolve_customer(s.customer) is not null;
alter table public.style_tracker_rows enable trigger trg_style_tracker_row_audit;

reset statement_timeout;

do $contract$
declare
  v_rooms_to_go uuid;
begin
  if to_regprocedure('public.get_dam_customer_facets()') is null
     or to_regprocedure('public.get_path_facets(uuid)') is null
     or to_regprocedure('public.get_path_facets(text)') is not null then
    raise exception 'DAM customer/path facet function contract is incomplete';
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
