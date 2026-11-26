-- designflow-tracking#130: DesignFlow Item Master reads Stage Catalog licensing
-- durations (plm.stage_list, plm.stage, plm.stage_duration) by column and can
-- never write to any Stage Catalog table or read tracker/option tables.
do $test$
declare
  tbl text;
  priv text;
begin
  if not pg_has_role('designflow_prod_item_master_runtime', 'designflow_prod_item_master_grants', 'USAGE')
     or not has_schema_privilege('designflow_prod_item_master_runtime', 'plm', 'USAGE')
     or has_schema_privilege('designflow_prod_item_master_runtime', 'plm', 'CREATE') then
    raise exception 'designflow_prod_item_master_runtime is not bound to plm USAGE-only access';
  end if;

  foreach tbl in array array[
    'plm.stage_list', 'plm.stage', 'plm.stage_duration',
    'plm.stage_dependency', 'plm.licensor_stage_option',
    'plm.prod_stage_progress', 'plm.prod_stage_option'
  ] loop
    foreach priv in array array['INSERT', 'UPDATE', 'REFERENCES'] loop
      if has_any_column_privilege('designflow_prod_item_master_runtime', tbl, priv) then
        raise exception 'designflow_prod_item_master_runtime has % on %', priv, tbl;
      end if;
    end loop;
    foreach priv in array array['SELECT', 'DELETE', 'TRUNCATE', 'TRIGGER'] loop
      if has_table_privilege('designflow_prod_item_master_runtime', tbl, priv) then
        raise exception 'designflow_prod_item_master_runtime has table-wide % on %', priv, tbl;
      end if;
    end loop;
  end loop;

  if not has_column_privilege('designflow_prod_item_master_runtime', 'plm.stage_list', 'key', 'SELECT')
     or not has_column_privilege('designflow_prod_item_master_runtime', 'plm.stage', 'done_signal', 'SELECT')
     or not has_column_privilege('designflow_prod_item_master_runtime', 'plm.stage', 'active', 'SELECT')
     or not has_column_privilege('designflow_prod_item_master_runtime', 'plm.stage_duration', 'scope_kind', 'SELECT')
     or not has_column_privilege('designflow_prod_item_master_runtime', 'plm.stage_duration', 'duration', 'SELECT') then
    raise exception 'item_master missing required Stage Catalog column SELECT privileges';
  end if;

  foreach tbl in array array['plm.stage_dependency', 'plm.licensor_stage_option', 'plm.prod_stage_progress', 'plm.prod_stage_option'] loop
    if has_any_column_privilege('designflow_prod_item_master_runtime', tbl, 'SELECT') then
      raise exception 'item_master must not read %', tbl;
    end if;
  end loop;

  if (select count(*) from pg_policies
      where schemaname = 'plm'
        and cmd = 'SELECT'
        and policyname in (
          'stage_list_dflow_prod_item_master_read',
          'stage_dflow_prod_item_master_read',
          'stage_duration_dflow_prod_item_master_read'
        )
        and roles = array['designflow_prod_item_master_grants'::name]) <> 3 then
    raise exception 'expected 3 SELECT-only Stage Catalog RLS policies for designflow_prod_item_master_grants';
  end if;
end
$test$;
