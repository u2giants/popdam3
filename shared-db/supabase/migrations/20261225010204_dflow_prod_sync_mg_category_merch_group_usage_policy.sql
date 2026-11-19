-- derived-from: none
-- Claim popcre/shared-db#6728; fixes review findings #6731 (PR #6729) and PR #6742.
-- designflow_prod_data_sync_runtime is a direct LOGIN role (not PostgREST) that
-- inherits designflow_prod_data_sync_grants; policies TO the grants role apply to
-- it through membership. core.mg_category_merch_group has row security enabled
-- (20260818203751) with read policy only for authenticated, so a plain grant
-- would return zero rows: schema usage, table select and a read policy are all
-- needed. USAGE on core grants no table access by itself. Select is re-granted
-- here so this file does not depend on 20261218092000 applying first.
-- New policy object, no re-derived body, so derived-from stays none.
-- Rollback: drop policy dflow_prod_data_sync_read; revoke select on the table;
-- revoke usage on schema core (this role had no other core access before).
begin;
set local lock_timeout = '5s';
grant usage on schema core to designflow_prod_data_sync_grants;
grant select on table core.mg_category_merch_group to designflow_prod_data_sync_grants;
drop policy if exists dflow_prod_data_sync_read on core.mg_category_merch_group;
create policy dflow_prod_data_sync_read on core.mg_category_merch_group
  for select to designflow_prod_data_sync_grants
  using (true);
do $check$
begin
  if to_regrole('designflow_prod_data_sync_runtime') is null then
    raise exception 'designflow_prod_data_sync_runtime missing';
  end if;
  if not has_schema_privilege('designflow_prod_data_sync_runtime', 'core', 'usage')
     or not has_table_privilege('designflow_prod_data_sync_runtime', 'core.mg_category_merch_group', 'select') then
    raise exception 'runtime cannot read core.mg_category_merch_group';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'core'
      and tablename = 'mg_category_merch_group' and policyname = 'dflow_prod_data_sync_read') then
    raise exception 'read policy missing';
  end if;
end $check$;
commit;
