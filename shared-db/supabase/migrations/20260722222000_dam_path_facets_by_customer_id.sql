-- Scope DAM Library "program" facets by the canonical customer_id FK.
--
-- The Library customer filter now selects a core.customer id (from
-- api.dam_customer_list) instead of a free-text customer string, and the customer
-- option list comes from get_dam_customer_facets (20260722210000). get_path_facets
-- therefore no longer needs to emit customers or key off free text — it only
-- scopes the program list to the selected customer via style_groups.customer_id.
--
-- Replaces the legacy get_path_facets(p_customer text) signature.

drop function if exists public.get_path_facets(text);

create or replace function public.get_path_facets(p_customer_id uuid default null)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $function$
  select jsonb_build_object(
    'programs', coalesce((
      select jsonb_agg(jsonb_build_object('name', program, 'count', cnt) order by program)
      from (
        select program, count(*) as cnt
        from style_groups
        where program is not null
          and (p_customer_id is null or customer_id = p_customer_id)
        group by program
      ) p
    ), '[]'::jsonb)
  );
$function$;

comment on function public.get_path_facets(uuid) is
  'DAM Library program facets, optionally scoped to a core.customer id via style_groups.customer_id. Customer options come from get_dam_customer_facets, not this function.';

grant execute on function public.get_path_facets(uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
