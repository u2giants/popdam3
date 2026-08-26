-- Contracts for 20260826002422_sample_inventory_index_backed.sql.

create or replace function pg_temp.explain_sample_inventory(p_query text)
returns setof text language plpgsql as $$
begin
  return query execute 'explain (costs off) ' || p_query;
end $$;

do $contracts$
declare
  v_difference bigint;
  v_plan text;
begin
  with expected as (
    select l.sample_id_fk,l.location_type,l.location_id,
           sum(l.quantity_delta)::bigint as quantity,max(l.occurred_at) as available_since
    from (
      select sample_id_fk,to_location_type as location_type,to_location_id as location_id,
             quantity::bigint as quantity_delta,occurred_at from dflow.sample_movement
      union all
      select sample_id_fk,from_location_type,from_location_id,
             -quantity::bigint,occurred_at from dflow.sample_movement
    ) l group by l.sample_id_fk,l.location_type,l.location_id
  ), difference as (
    (select * from expected except select * from dflow.sample_inventory_balance)
    union all
    (select * from dflow.sample_inventory_balance except select * from expected)
  )
  select count(*) into v_difference from difference;
  if v_difference<>0 then
    raise exception 'sample inventory projection differs from movement truth by % row(s)',v_difference;
  end if;

  if exists (select 1 from dflow.sample_inventory where quantity<=0) then
    raise exception 'sample_inventory exposed a non-positive balance';
  end if;
  if exists (select 1 from dflow.sample_inventory
    where (location_type='in_transit') is distinct from is_in_transit
       or (quantity>0 and location_type<>'in_transit') is distinct from is_eligible
       or (case when quantity<=0 then 'no_balance'
                when location_type='in_transit' then 'in_transit' else null end)
          is distinct from ineligibility_reason) then
    raise exception 'sample_inventory eligibility semantics drifted';
  end if;

  set local enable_seqscan=off;
  select string_agg(p,E'\n') into v_plan
  from pg_temp.explain_sample_inventory(
    $$select sample_id_fk,product_location_type,product_location_id,quantity,
             available_since,is_boxed,is_in_transit,is_eligible
      from dflow.sample_inventory
      where product_location_type='office' and product_location_id='nyc'
        and available_since>=now()-interval '1 month'
      order by available_since desc,sample_id_fk desc limit 100$$
  ) p;
  if position('sample_inventory_balance_screen_idx' in coalesce(v_plan,''))=0 then
    raise exception 'sample inventory query did not use its screen index: %',v_plan;
  end if;
end
$contracts$;
