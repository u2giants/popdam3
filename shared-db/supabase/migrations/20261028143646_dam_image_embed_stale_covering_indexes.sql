-- derived-from: none
-- New objects (not a re-derivation): the follow-up named by 20261027020503,
-- on tables created by 20261025163955; covering-index precedent 20260830013942.
-- Issue #4870 (author claim #4900; app u2giants/popdam3 #486, workstream #4814):
-- covering indexes so public.image_embed_stale_assets enumeration is
-- index-driven instead of heap-fetch bound.
--
-- MEASURED ON PRODUCTION (read-only, 2026-10-26 ~9:45 PM EDT, issue #4870):
-- the stale set is sparse (55 of ~139.5k raster assets) and scattered across
-- the whole assets.id range, so proving exhaustion walks every raster asset
-- and pays per-row heap fetches on both sides. Cold-cache: assets side 51-59 s,
-- joined walk >120 s before the 20261027020503 budget fix. Warm is 10.2 s over
-- PostgREST (2026-10-27 ~9:32 AM EDT, popdam3 #486). These two indexes remove
-- the per-row heap fetches:
--   * public.idx_assets_embed_stale_cover (id) include (is_deleted, thumbnail_url)
--     — the assets side becomes an index-only scan; the wrapper only reads
--       id, is_deleted, thumbnail_url from public.assets.
--   * dam.dam_asset_image_vectors_stale_cover (asset_id) include
--     (embedding_model, last_embedded_thumbnail_url) — the merge join reads
--     staleness metadata from the index instead of fetching rows that carry
--     two halfvec(768) legs (~3 KB each).
--
-- WHY TRANSACTIONAL, NOT CONCURRENTLY. The repository's atomic migration
-- runner cannot execute CREATE/DROP INDEX CONCURRENTLY (20260830013942
-- precedent). Following that precedent: keep the build transactional, bound
-- lock_timeout so the apply fails fast instead of queueing behind live
-- traffic, and give the build a generous statement budget (~139.5k rows per
-- side; issue #4870 estimates 30-90 s per build at current size). A failed
-- apply rolls back cleanly and can be retried in a quieter window.
--
-- ROLL-OUT SAFETY. Purely additive: two new indexes, no table, column,
-- function, trigger, grant, or data change; nothing references these names,
-- and existing plans are unaffected until the planner chooses them. Index
-- builds take SHARE locks on public.assets and dam.dam_asset_image_vectors
-- (writes queue for the build's duration, reads are unaffected).

set lock_timeout = '5s';
set statement_timeout = '10min';

create index if not exists idx_assets_embed_stale_cover
  on public.assets using btree (id)
  include (is_deleted, thumbnail_url);

create index if not exists dam_asset_image_vectors_stale_cover
  on dam.dam_asset_image_vectors using btree (asset_id)
  include (embedding_model, last_embedded_thumbnail_url);

-- =====================================================================================
-- POST-APPLY VERIFICATION. Both indexes exist on the right table, are
-- valid/ready, and carry exactly the expected key + INCLUDE column list
-- (pg_index.indkey lists key attributes first, then INCLUDE columns).
-- =====================================================================================
do $verify$
declare
  v_owner  oid;
  v_atts   name[];
  v_keys   int;
  v_valid  boolean;
begin
  select i.indrelid, i.indnkeyatts, i.indisvalid and i.indisready
    into v_owner, v_keys, v_valid
    from pg_index i
   where i.indexrelid = 'public.idx_assets_embed_stale_cover'::regclass;

  if v_owner is null then
    raise exception 'VERIFY FAILED: public.idx_assets_embed_stale_cover is missing';
  end if;
  if v_owner <> 'public.assets'::regclass then
    raise exception 'VERIFY FAILED: idx_assets_embed_stale_cover is not on public.assets';
  end if;
  if not v_valid then
    raise exception 'VERIFY FAILED: idx_assets_embed_stale_cover is not valid/ready';
  end if;
  if v_keys <> 1 then
    raise exception 'VERIFY FAILED: idx_assets_embed_stale_cover keyatts %, expected 1 (id)', v_keys;
  end if;

  select array_agg(a.attname order by u.n)
    into v_atts
    from pg_index i
    cross join unnest(i.indkey) with ordinality as u(attnum, n)
    join pg_attribute a on a.attrelid = i.indrelid and a.attnum = u.attnum
   where i.indexrelid = 'public.idx_assets_embed_stale_cover'::regclass;

  if v_atts is distinct from array['id', 'is_deleted', 'thumbnail_url']::name[] then
    raise exception 'VERIFY FAILED: idx_assets_embed_stale_cover columns %, expected (id) include (is_deleted, thumbnail_url)', v_atts;
  end if;

  select i.indrelid, i.indnkeyatts, i.indisvalid and i.indisready
    into v_owner, v_keys, v_valid
    from pg_index i
   where i.indexrelid = 'dam.dam_asset_image_vectors_stale_cover'::regclass;

  if v_owner is null then
    raise exception 'VERIFY FAILED: dam.dam_asset_image_vectors_stale_cover is missing';
  end if;
  if v_owner <> 'dam.dam_asset_image_vectors'::regclass then
    raise exception 'VERIFY FAILED: dam_asset_image_vectors_stale_cover is not on dam.dam_asset_image_vectors';
  end if;
  if not v_valid then
    raise exception 'VERIFY FAILED: dam_asset_image_vectors_stale_cover is not valid/ready';
  end if;
  if v_keys <> 1 then
    raise exception 'VERIFY FAILED: dam_asset_image_vectors_stale_cover keyatts %, expected 1 (asset_id)', v_keys;
  end if;

  select array_agg(a.attname order by u.n)
    into v_atts
    from pg_index i
    cross join unnest(i.indkey) with ordinality as u(attnum, n)
    join pg_attribute a on a.attrelid = i.indrelid and a.attnum = u.attnum
   where i.indexrelid = 'dam.dam_asset_image_vectors_stale_cover'::regclass;

  if v_atts is distinct from array['asset_id', 'embedding_model', 'last_embedded_thumbnail_url']::name[] then
    raise exception 'VERIFY FAILED: dam_asset_image_vectors_stale_cover columns %, expected (asset_id) include (embedding_model, last_embedded_thumbnail_url)', v_atts;
  end if;
end
$verify$;
