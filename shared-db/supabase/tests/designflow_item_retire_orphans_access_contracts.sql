-- #4707: the Data Syncing runtime retires orphaned copied items only through
-- the owner function, never by a direct delete, and restores only exact
-- before-image rows. No other role can call the function.
do $test$
begin
  if to_regclass('plm.designflow_item') is null
     or to_regrole('designflow_prod_data_sync_grants') is null then
    return;
  end if;
  if has_table_privilege('designflow_prod_data_sync_grants', 'plm.designflow_item', 'DELETE') then
    raise exception 'data sync can delete copied items directly';
  end if;
  if not has_function_privilege('designflow_prod_data_sync_grants',
       'plm.designflow_retire_orphan_items(uuid, integer[])', 'EXECUTE')
     or has_function_privilege('authenticated', 'plm.designflow_retire_orphan_items(uuid, integer[])', 'EXECUTE')
     or has_function_privilege('anon', 'plm.designflow_retire_orphan_items(uuid, integer[])', 'EXECUTE') then
    raise exception 'orphan retirement function access is wrong';
  end if;
  if not exists (select from pg_proc where oid = 'plm.designflow_retire_orphan_items(uuid, integer[])'::regprocedure
      and prosecdef and proconfig @> array['search_path=""']) then
    raise exception 'orphan retirement function is not a pinned owner function';
  end if;
  if not exists (select from pg_policies where schemaname = 'plm' and tablename = 'designflow_item'
      and policyname = 'designflow_item_retire_orphan_restore' and cmd = 'INSERT'
      and with_check like '%designflow_reconcile_before_image%' and with_check like '%to_jsonb(designflow_item%') then
    raise exception 'orphan restore policy is missing';
  end if;
  if not exists (select from pg_policies where schemaname = 'plm' and tablename = 'designflow_reconcile_before_image'
      and policyname = 'designflow_reconcile_before_image_insert' and with_check like '%to_jsonb(d%') then
    raise exception 'a copied-item delete before-image is not pinned to the current row';
  end if;
end
$test$;
