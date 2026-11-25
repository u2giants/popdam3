-- #4707: the Data Syncing runtime changes a copy's canonical link only through
-- the owner relink functions; the relink log is private; the product-type
-- rule maps MG01 to the licensed division (2026-08-19 ruling).
do $test$
declare
  fn text;
begin
  if to_regclass('plm.designflow_item') is null
     or to_regrole('designflow_prod_data_sync_grants') is null then
    return;
  end if;
  foreach fn in array array['plm.designflow_relink_items(uuid, jsonb)',
      'plm.designflow_relink_items_rollback(uuid)', 'plm.designflow_product_type_division(text)'] loop
    if not has_function_privilege('designflow_prod_data_sync_grants', fn, 'EXECUTE')
       or has_function_privilege('authenticated', fn, 'EXECUTE')
       or has_function_privilege('anon', fn, 'EXECUTE') then
      raise exception 'relink function access wrong: %', fn;
    end if;
  end loop;
  if exists (select from pg_proc where oid in ('plm.designflow_relink_items(uuid, jsonb)'::regprocedure,
      'plm.designflow_relink_items_rollback(uuid)'::regprocedure)
      and not (prosecdef and proconfig @> array['search_path=""'])) then
    raise exception 'relink functions are not pinned owner functions';
  end if;
  if has_table_privilege('designflow_prod_data_sync_grants', 'plm.designflow_relink_log', 'SELECT')
     or has_table_privilege('designflow_prod_data_sync_grants', 'plm.designflow_relink_log', 'INSERT')
     or has_table_privilege('authenticated', 'plm.designflow_relink_log', 'SELECT') then
    raise exception 'relink log is not private';
  end if;
  if plm.designflow_product_type_division('v') <> 'SP001' or plm.designflow_product_type_division('P') <> 'SP001'
     or plm.designflow_product_type_division('A') <> 'CW001' or plm.designflow_product_type_division('M') <> 'CW001'
     or plm.designflow_product_type_division('Z') is not null then
    raise exception 'product type division mapping wrong';
  end if;
  begin
    perform plm.designflow_relink_items(gen_random_uuid(), '[]'::jsonb);
    raise exception 'empty relink list accepted';
  exception when raise_exception then
    if sqlerrm = 'empty relink list accepted' then raise; end if;
  end;
end
$test$;
