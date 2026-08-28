-- Contracts for 20260827232631_orderlist_count_indexes.sql.

begin;

create or replace function pg_temp.explain_order_list_count()
returns setof text language plpgsql as $$
begin
  return query execute 'explain (costs off) select count(*) from api.dam_order_list';
end $$;

do $contracts$
declare
  v_valid boolean;
  v_ready boolean;
  v_method text;
  v_predicate text;
  v_keys text[];
  v_plan text;
begin
  select i.indisvalid,
         i.indisready,
         am.amname,
         pg_get_expr(i.indpred, i.indrelid),
         array_agg(a.attname order by key_position.ordinality)
    into v_valid, v_ready, v_method, v_predicate, v_keys
  from pg_index i
  join pg_class index_relation on index_relation.oid = i.indexrelid
  join pg_am am on am.oid = index_relation.relam
  cross join lateral unnest(i.indkey::smallint[]) with ordinality as key_position(attnum, ordinality)
  join pg_attribute a
    on a.attrelid = i.indrelid
   and a.attnum = key_position.attnum
  where i.indexrelid = 'plm.style_tracker_item_bridge_plm_item_idx'::regclass
  group by i.indisvalid, i.indisready, am.amname, i.indpred, i.indrelid;

  if v_valid is distinct from true
     or v_ready is distinct from true
     or v_method is distinct from 'btree'
     or v_predicate is not null
     or v_keys is distinct from array['plm_item_id']::text[] then
    raise exception 'style tracker bridge index contract is wrong: valid=%, ready=%, method=%, predicate=%, keys=%',
      v_valid, v_ready, v_method, v_predicate, v_keys;
  end if;

  select i.indisvalid,
         i.indisready,
         am.amname,
         pg_get_expr(i.indpred, i.indrelid),
         array_agg(a.attname order by key_position.ordinality)
    into v_valid, v_ready, v_method, v_predicate, v_keys
  from pg_index i
  join pg_class index_relation on index_relation.oid = i.indexrelid
  join pg_am am on am.oid = index_relation.relam
  cross join lateral unnest(i.indkey::smallint[]) with ordinality as key_position(attnum, ordinality)
  join pg_attribute a
    on a.attrelid = i.indrelid
   and a.attnum = key_position.attnum
  where i.indexrelid = 'plm.production_order_line_count_cover_idx'::regclass
  group by i.indisvalid, i.indisready, am.amname, i.indpred, i.indrelid;

  if v_valid is distinct from true
     or v_ready is distinct from true
     or v_method is distinct from 'btree'
     or v_predicate is not null
     or v_keys is distinct from array['production_order_id', 'item_id', 'id']::text[] then
    raise exception 'production order line index contract is wrong: valid=%, ready=%, method=%, predicate=%, keys=%',
      v_valid, v_ready, v_method, v_predicate, v_keys;
  end if;

  perform set_config('enable_seqscan', 'off', true);
  select string_agg(plan_line, E'\n') into v_plan
  from pg_temp.explain_order_list_count() plan_line;

  if position('style_tracker_item_bridge_plm_item_idx' in coalesce(v_plan, '')) = 0
     or position('production_order_line_count_cover_idx' in coalesce(v_plan, '')) = 0 then
    raise exception 'OrderList count did not plan through both required indexes: %', v_plan;
  end if;

  if v_plan ~ 'Seq Scan on (plm\.)?style_tracker_item_bridge'
     or v_plan ~ 'Seq Scan on (plm\.)?production_order_line' then
    raise exception 'OrderList count retained a target sequential scan: %', v_plan;
  end if;
end
$contracts$;

rollback;
