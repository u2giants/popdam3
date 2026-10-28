-- PopDAM image-embed stale-enumeration covering-index contracts (#4870 /
-- claim #4900, popdam3 #486 Step 4b headroom). Disposable-database
-- transaction only; harness owns BEGIN/ROLLBACK. Covers: both indexes exist
-- on the right table, are valid/ready, and carry exactly the expected key +
-- INCLUDE column lists that make public.image_embed_stale_assets index-only
-- on both sides. Break-the-suite check: dropping either index name or
-- changing a key/INCLUDE column in the migration must fail a phase here.

-- =====================================================================================
-- Phase 1 — public.idx_assets_embed_stale_cover on public.assets:
-- key (id), include (is_deleted, thumbnail_url), valid.
-- =====================================================================================
do $phase1$
declare
  v_owner oid;
  v_atts  name[];
  v_keys  int;
  v_valid boolean;
begin
  select i.indrelid, i.indnkeyatts, i.indisvalid and i.indisready
    into v_owner, v_keys, v_valid
    from pg_index i
   where i.indexrelid = 'public.idx_assets_embed_stale_cover'::regclass;

  if v_owner is null then
    raise exception 'phase1: public.idx_assets_embed_stale_cover is missing';
  end if;
  if v_owner <> 'public.assets'::regclass then
    raise exception 'phase1: idx_assets_embed_stale_cover is not on public.assets';
  end if;
  if not v_valid then
    raise exception 'phase1: idx_assets_embed_stale_cover is not valid/ready';
  end if;
  if v_keys <> 1 then
    raise exception 'phase1: idx_assets_embed_stale_cover keyatts %, expected 1 (id)', v_keys;
  end if;

  select array_agg(a.attname order by u.n)
    into v_atts
    from pg_index i
    cross join unnest(i.indkey) with ordinality as u(attnum, n)
    join pg_attribute a on a.attrelid = i.indrelid and a.attnum = u.attnum
   where i.indexrelid = 'public.idx_assets_embed_stale_cover'::regclass;

  if v_atts is distinct from array['id', 'is_deleted', 'thumbnail_url']::name[] then
    raise exception 'phase1: idx_assets_embed_stale_cover columns %, expected (id) include (is_deleted, thumbnail_url)', v_atts;
  end if;
end
$phase1$;

-- =====================================================================================
-- Phase 2 — dam.dam_asset_image_vectors_stale_cover on
-- dam.dam_asset_image_vectors: key (asset_id), include (embedding_model,
-- last_embedded_thumbnail_url), valid.
-- =====================================================================================
do $phase2$
declare
  v_owner oid;
  v_atts  name[];
  v_keys  int;
  v_valid boolean;
begin
  select i.indrelid, i.indnkeyatts, i.indisvalid and i.indisready
    into v_owner, v_keys, v_valid
    from pg_index i
   where i.indexrelid = 'dam.dam_asset_image_vectors_stale_cover'::regclass;

  if v_owner is null then
    raise exception 'phase2: dam.dam_asset_image_vectors_stale_cover is missing';
  end if;
  if v_owner <> 'dam.dam_asset_image_vectors'::regclass then
    raise exception 'phase2: dam_asset_image_vectors_stale_cover is not on dam.dam_asset_image_vectors';
  end if;
  if not v_valid then
    raise exception 'phase2: dam_asset_image_vectors_stale_cover is not valid/ready';
  end if;
  if v_keys <> 1 then
    raise exception 'phase2: dam_asset_image_vectors_stale_cover keyatts %, expected 1 (asset_id)', v_keys;
  end if;

  select array_agg(a.attname order by u.n)
    into v_atts
    from pg_index i
    cross join unnest(i.indkey) with ordinality as u(attnum, n)
    join pg_attribute a on a.attrelid = i.indrelid and a.attnum = u.attnum
   where i.indexrelid = 'dam.dam_asset_image_vectors_stale_cover'::regclass;

  if v_atts is distinct from array['asset_id', 'embedding_model', 'last_embedded_thumbnail_url']::name[] then
    raise exception 'phase2: dam_asset_image_vectors_stale_cover columns %, expected (asset_id) include (embedding_model, last_embedded_thumbnail_url)', v_atts;
  end if;
end
$phase2$;

-- =====================================================================================
-- Phase 3 — the covering columns are exactly what the wrapper reads, so the
-- scans can be index-only: the wrapper's SELECT list over public.assets is
-- a.id (+ filters on is_deleted and thumbnail_url) and over
-- dam.dam_asset_image_vectors the join reads asset_id,
-- last_embedded_thumbnail_url and embedding_model (20261027020503 body).
-- Contract: every column named in those reads appears in the matching
-- covering index (key or INCLUDE).
-- =====================================================================================
do $phase3$
declare
  v_asset_cols  text[];
  v_vector_cols text[];
begin
  select array_agg(a.attname order by a.attname)
    into v_asset_cols
    from pg_index i
    cross join unnest(i.indkey) with ordinality as u(attnum, n)
    join pg_attribute a on a.attrelid = i.indrelid and a.attnum = u.attnum
   where i.indexrelid = 'public.idx_assets_embed_stale_cover'::regclass;

  select array_agg(a.attname order by a.attname)
    into v_vector_cols
    from pg_index i
    cross join unnest(i.indkey) with ordinality as u(attnum, n)
    join pg_attribute a on a.attrelid = i.indrelid and a.attnum = u.attnum
   where i.indexrelid = 'dam.dam_asset_image_vectors_stale_cover'::regclass;

  if not ('id' = any (v_asset_cols) and 'is_deleted' = any (v_asset_cols) and 'thumbnail_url' = any (v_asset_cols)) then
    raise exception 'phase3: assets covering index no longer covers the wrapper read set id/is_deleted/thumbnail_url: %', v_asset_cols;
  end if;
  if not ('asset_id' = any (v_vector_cols) and 'embedding_model' = any (v_vector_cols) and 'last_embedded_thumbnail_url' = any (v_vector_cols)) then
    raise exception 'phase3: vectors covering index no longer covers the wrapper read set asset_id/embedding_model/last_embedded_thumbnail_url: %', v_vector_cols;
  end if;
end
$phase3$;
