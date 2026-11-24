-- #4707 Lane G: DesignFlow Item Master, Tracking and Backend runtimes read the
-- copied plm.* rows they need, by column, and can never write them.
do $test$
declare
  app record;
  tbl text;
  priv text;
begin
  for app in select * from (values
    ('designflow_prod_item_master_runtime', 'designflow_prod_item_master_grants'),
    ('designflow_prod_tracking_runtime', 'designflow_prod_tracking_grants'),
    ('designflow_prod_backend_runtime', 'designflow_prod_backend_grants')) v(runtime_role, grants_role)
  loop
    if not pg_has_role(app.runtime_role, app.grants_role, 'USAGE')
       or not has_schema_privilege(app.runtime_role, 'plm', 'USAGE')
       or has_schema_privilege(app.runtime_role, 'plm', 'CREATE') then
      raise exception '% is not bound to plm read access', app.runtime_role;
    end if;
    foreach tbl in array array['plm.designflow_item', 'plm.licensing_status', 'plm.licensing_feedback',
      'plm.licensing_status_assignee', 'plm.licensing_feedback_mention', 'plm.licensing_attachment',
      'plm.item_merch_group', 'plm.item_custom_value', 'plm.item_price'] loop
      foreach priv in array array['INSERT', 'UPDATE', 'REFERENCES'] loop
        if has_any_column_privilege(app.runtime_role, tbl, priv) then
          raise exception '% has % on %', app.runtime_role, priv, tbl;
        end if;
      end loop;
      foreach priv in array array['SELECT', 'DELETE', 'TRUNCATE', 'TRIGGER'] loop
        if has_table_privilege(app.runtime_role, tbl, priv) then
          raise exception '% has table-wide % on %', app.runtime_role, priv, tbl;
        end if;
      end loop;
    end loop;
    if not has_column_privilege(app.runtime_role, 'plm.designflow_item', 'legacy_item_id', 'SELECT')
       or not has_column_privilege(app.runtime_role, 'plm.licensing_status', 'designflow_status_id', 'SELECT')
       or not has_column_privilege(app.runtime_role, 'plm.licensing_status_assignee', 'designflow_user_id', 'SELECT')
       or not has_column_privilege(app.runtime_role, 'plm.licensing_feedback', 'designflow_feedback_id', 'SELECT')
       or not has_column_privilege(app.runtime_role, 'plm.licensing_feedback_mention', 'designflow_user_id', 'SELECT')
       or not has_column_privilege(app.runtime_role, 'plm.licensing_attachment', 'licensing_status_id', 'SELECT')
       or has_column_privilege(app.runtime_role, 'plm.licensing_status', 'metadata', 'SELECT')
       or has_column_privilege(app.runtime_role, 'plm.licensing_feedback', 'author_name', 'SELECT')
       or has_column_privilege(app.runtime_role, 'plm.licensing_status_assignee', 'profile_id', 'SELECT') then
      raise exception '% column read scope is wrong', app.runtime_role;
    end if;
  end loop;

  if has_any_column_privilege('designflow_prod_tracking_runtime', 'plm.item_merch_group', 'SELECT')
     or has_column_privilege('designflow_prod_tracking_runtime', 'plm.designflow_item', 'item_note', 'SELECT')
     or has_column_privilege('designflow_prod_item_master_runtime', 'plm.licensing_feedback', 'body', 'SELECT')
     or not has_column_privilege('designflow_prod_backend_runtime', 'plm.licensing_feedback', 'body', 'SELECT')
     or not has_column_privilege('designflow_prod_backend_runtime', 'plm.designflow_item', 'hts_product_phrase_at', 'SELECT')
     or not has_column_privilege('designflow_prod_item_master_runtime', 'plm.item_merch_group', 'resolution', 'SELECT') then
    raise exception 'per-app column scope drifted';
  end if;

  -- Data Syncing reconcile reads whole licensing rows for its before-images,
  -- and still has no table-wide write beyond the reconcile migration's.
  foreach tbl in array array['plm.licensing_status', 'plm.licensing_feedback', 'plm.licensing_status_assignee',
    'plm.licensing_feedback_mention', 'plm.licensing_attachment'] loop
    if exists (select from pg_attribute a where a.attrelid = tbl::regclass and a.attnum > 0 and not a.attisdropped
        and not has_column_privilege('designflow_prod_data_sync_runtime', tbl, a.attname, 'SELECT')) then
      raise exception 'Data Syncing cannot read whole % rows for its before-image', tbl;
    end if;
  end loop;
  if has_any_column_privilege('designflow_prod_data_sync_runtime', 'plm.licensing_status_assignee', 'UPDATE')
     or has_any_column_privilege('designflow_prod_data_sync_runtime', 'plm.licensing_feedback_mention', 'UPDATE')
     or has_any_column_privilege('designflow_prod_data_sync_runtime', 'plm.licensing_attachment', 'UPDATE')
     or has_table_privilege('designflow_prod_data_sync_runtime', 'plm.licensing_status', 'DELETE')
     or has_table_privilege('designflow_prod_data_sync_runtime', 'plm.licensing_feedback', 'DELETE')
     or has_table_privilege('designflow_prod_data_sync_runtime', 'plm.designflow_reconcile_before_image', 'DELETE')
     or has_any_column_privilege('designflow_prod_data_sync_runtime', 'plm.designflow_reconcile_before_image', 'UPDATE') then
    raise exception 'Data Syncing gained a write the reconcile must not have';
  end if;

  if (select count(*) from pg_policies where schemaname = 'plm' and cmd = 'SELECT'
      and policyname like '%designflow_runtime_read') <> 7
     or exists (select from pg_policies where schemaname = 'plm' and policyname like '%designflow_runtime_read'
      and cmd <> 'SELECT') then
    raise exception 'runtime read policies missing or not read-only';
  end if;
end
$test$;
