-- derived-from: none
-- Claim popcre/shared-db#6728; fixes review finding #6880 on PR #6879.
-- 20261225012000 granted table-wide SELECT on dflow_prod.art_piece and
-- dflow_prod.artists (artists.email is personal data) and left the published
-- 2873 grant matrices stale. The merch-group repair in-use scan reads only
-- the id columns below (designflow-data-syncing helpers/merchGroupRepairPlan.js
-- ART_PIECE_ID_COLUMNS, ARTIST_ID_COLUMNS). Replace with column-scoped SELECT,
-- so table-level ACLs match the matrices again, and assert no row security.
-- Rollback: revoke the column grants.
begin;
set local lock_timeout = '5s';
revoke select on table dflow_prod."art_piece" from designflow_prod_data_sync_grants;
revoke select on table dflow_prod."artists" from designflow_prod_data_sync_grants;
grant select (licensor_id, property_id, style_guide_id, big_theme_id, little_theme_id,
              art_type_id, art_source_id, artist_id, age_group_id)
  on table dflow_prod."art_piece" to designflow_prod_data_sync_grants;
grant select (art_source_id, artist_type_id)
  on table dflow_prod."artists" to designflow_prod_data_sync_grants;
do $check$
begin
  if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
             where n.nspname = 'dflow_prod' and c.relname in ('art_piece', 'artists')
               and (c.relrowsecurity or c.relforcerowsecurity)) then
    raise exception 'row security on art_piece/artists: column grant would read zero rows';
  end if;
  if has_table_privilege('designflow_prod_data_sync_runtime', 'dflow_prod.artists', 'select')
     or has_column_privilege('designflow_prod_data_sync_runtime', 'dflow_prod.artists', 'email', 'select') then
    raise exception 'sync runtime can still read artists beyond the id columns';
  end if;
  if not has_column_privilege('designflow_prod_data_sync_runtime', 'dflow_prod.art_piece', 'artist_id', 'select')
     or not has_column_privilege('designflow_prod_data_sync_runtime', 'dflow_prod.artists', 'artist_type_id', 'select') then
    raise exception 'sync runtime cannot read the in-use id columns';
  end if;
end $check$;
commit;
