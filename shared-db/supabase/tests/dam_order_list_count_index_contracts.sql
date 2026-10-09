-- Contracts for 20260827232631_orderlist_count_indexes.sql.

begin;

create or replace function pg_temp.explain_order_list_count()
returns setof text language plpgsql as $$
begin
  return query execute 'explain (costs off) select count(*) from api.dam_order_list';
end $$;

create or replace function pg_temp.explain_order_list_rows()
returns setof text language plpgsql as $$
begin
  return query execute 'explain (costs off) select order_line_id, master_data_license_status, test_report, professional_photos from api.dam_order_list order by sent_po_date desc nulls last,order_id,order_line_id limit 100';
end $$;

do $contracts$
declare
  v_valid boolean;
  v_ready boolean;
  v_method text;
  v_predicate text;
  v_keys text[];
  v_key_count integer;
  v_plan text;
begin
  select i.indisvalid,
         i.indisready,
         am.amname,
         pg_get_expr(i.indpred, i.indrelid),
         array_agg(a.attname order by key_position.ordinality),
         i.indnkeyatts
    into v_valid, v_ready, v_method, v_predicate, v_keys, v_key_count
  from pg_index i
  join pg_class index_relation on index_relation.oid = i.indexrelid
  join pg_am am on am.oid = index_relation.relam
  cross join lateral unnest(i.indkey::smallint[]) with ordinality as key_position(attnum, ordinality)
  join pg_attribute a
    on a.attrelid = i.indrelid
   and a.attnum = key_position.attnum
  where i.indexrelid = 'plm.style_tracker_item_bridge_plm_item_cover_idx'::regclass
  group by i.indisvalid, i.indisready, am.amname, i.indpred, i.indrelid, i.indnkeyatts;

  if v_valid is distinct from true
     or v_ready is distinct from true
     or v_method is distinct from 'btree'
     or v_predicate is not null
     or v_key_count is distinct from 1
     or v_keys is distinct from array['plm_item_id', 'id', 'style_tracker_row_id', 'tracker_type']::text[] then
    raise exception 'style tracker bridge covering index contract is wrong: valid=%, ready=%, method=%, predicate=%, key_count=%, columns=%',
      v_valid, v_ready, v_method, v_predicate, v_key_count, v_keys;
  end if;

  if to_regclass('plm.style_tracker_item_bridge_plm_item_idx') is not null then
    raise exception 'redundant narrow style tracker bridge index still exists';
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

  -- Aggregated product facts are cardinality-preserving and can now be pruned
  -- entirely from a count. If PostgreSQL retains a bridge lookup, it must keep
  -- using the covering index; eliminating that lookup is also valid.
  -- A retained one-row lateral Result can make the primary-key path cheaper.
  -- Keep both index shape assertions above and require an indexed count path.
  if v_plan !~ 'Index (Only )?Scan using production_order_line_(count_cover_idx|pkey)' then
    raise exception 'OrderList count did not use an available line index: %', v_plan;
  end if;

  if v_plan ~ 'Seq Scan on (plm\.)?style_tracker_item_bridge( |$)'
     or v_plan ~ 'Seq Scan on (plm\.)?production_order_line( |$)'
     or v_plan ~ 'Seq Scan on (public\.)?style_tracker_rows( |$)' then
    raise exception 'OrderList count retained a target sequential scan: %', v_plan;
  end if;

  if v_plan ~ 'on style_tracker_item_bridge( |$)' and v_plan !~ 'Index Only Scan using style_tracker_item_bridge_plm_item_cover_idx' then
    raise exception 'OrderList count bridge lookup is not index-only: %', v_plan;
  end if;
  -- Tiny fixtures otherwise choose bitmap heap scans; pin the available direct path.
  perform set_config('enable_bitmapscan', 'off', true);
  select string_agg(plan_line,E'\n') into v_plan from pg_temp.explain_order_list_rows() plan_line;
  if v_plan !~ 'Index Only Scan using style_tracker_item_bridge_plm_item_cover_idx'
    or v_plan ~ 'Seq Scan on (plm\.)?style_tracker_item_bridge( |$)'
    or v_plan ~ 'Seq Scan on (plm\.)?production_order_line( |$)'
    or v_plan ~ 'Seq Scan on (public\.)?style_tracker_rows( |$)' then
    raise exception 'Bounded OrderList product row path lost indexed lookups: %',v_plan;
  end if;
  if v_plan ~ 'Function Scan on orderlist_product_facts' then
    raise exception 'Product facts stopped inlining into the bounded row plan: %',v_plan;
  end if;
end
$contracts$;

rollback;
