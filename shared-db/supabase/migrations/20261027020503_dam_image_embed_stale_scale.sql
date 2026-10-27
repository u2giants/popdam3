-- derived-from: 20261026155459
-- Issue #4814 (author claim #4868): fix-forward for the production-scale
-- performance of public.image_embed_stale_assets introduced in 20261026155459
-- (claim #4818, applied to production 2026-10-26). Semantics are UNCHANGED;
-- this version only makes the enumeration survive cold-cache full-library
-- walks and gives the planner a plain index condition for the cursor.
--
-- MEASURED ON PRODUCTION (read-only, 2026-10-26 ~9:45 PM EDT): the stale set
-- is tiny (55 of ~139.5k raster assets) and scattered across the whole assets
-- id range, so proving exhaustion walks every raster asset. Cold-cache walks
-- measured 51-59 s for the assets side alone and >120 s for the joined query,
-- which blew the function's own 30 s statement budget (live PostgREST calls
-- errored 57014). Two changes:
--   * statement budget 30 s -> 120 s, sized to the measured cold worst case;
--   * the cursor condition `p_after_asset_id is null or a.id > p_after_asset_id`
--     becomes `a.id > coalesce(p_after_asset_id, '0000...0000'::uuid)` so the
--     planner gets a plain, index-order-preserving predicate (uuid zero sorts
--     below every real id, so a NULL cursor still means "from the start").
-- Staleness legs, stamp-window derivation, raster/is_deleted filters, ordering,
-- service_role-only grant posture and the unconfigured-stamp refusal are all
-- byte-for-byte the same behavior as 20261026155459.
--
-- Follow-up (not this change): covering indexes on assets(id) include
-- (is_deleted, thumbnail_url) and dam.dam_asset_image_vectors(asset_id) include
-- (embedding_model, last_embedded_thumbnail_url) would make the walk
-- index-only; tracked as a separate issue because they are new objects.

set statement_timeout = '10min';

create or replace function public.image_embed_stale_assets(
  p_after_asset_id uuid default null,
  p_limit int default 5000
)
returns setof uuid
language plpgsql
stable
security definer
set search_path = public, dam
set statement_timeout = '120s'
as $$
declare
  v_stamps text[];
  v_limit  int := greatest(1, least(coalesce(p_limit, 5000), 5000));
begin
  select array_agg(distinct s) into v_stamps
  from (
    select (select c.value #>> '{}'
              from public.admin_config c
             where c.key = 'IMAGE_SIM_EMBEDDING_MODEL') as s
    union
    select case when coalesce((select c.value #>> '{}'
                                  from public.admin_config c
                                 where c.key = 'IMAGE_SIM_REEMBED_IN_PROGRESS'), 'false') ilike 'true'
                then (select c.value #>> '{}'
                        from public.admin_config c
                       where c.key = 'IMAGE_SIM_EMBEDDING_MODEL_PREVIOUS')
           end
  ) t
  where nullif(btrim(s), '') is not null;

  if v_stamps is null or cardinality(v_stamps) = 0 then
    raise exception using errcode = '22023', message = 'DAM_IMAGE_EMBED_STAMP_UNCONFIGURED';
  end if;

  return query
  select a.id
  from public.assets a
  left join dam.dam_asset_image_vectors v on v.asset_id = a.id
  where a.is_deleted = false
    and a.thumbnail_url is not null
    and a.thumbnail_url ~* '\.(jpe?g|png|webp)([?#].*)?$'
    and a.id > coalesce(p_after_asset_id, '00000000-0000-0000-0000-000000000000'::uuid)
    and (v.asset_id is null
         or v.last_embedded_thumbnail_url is distinct from a.thumbnail_url
         or v.embedding_model <> all (v_stamps))
  order by a.id
  limit v_limit;
end;
$$;

comment on function public.image_embed_stale_assets(uuid, integer) is
  'Service-role entrypoint: cursor-paginated ids of assets whose image vectors are stale (missing, watermark changed, or stamp outside the active window derived from admin_config like search_dam_image_similarity). 120 s budget and coalesce cursor for production-scale walks (20261027020503).';

revoke execute on function public.image_embed_stale_assets(uuid, integer)
  from public, anon, authenticated;

grant execute on function public.image_embed_stale_assets(uuid, integer)
  to service_role;

-- =====================================================================================
-- POST-APPLY VERIFICATION.
-- =====================================================================================
do $verify$
begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'image_embed_stale_assets') then
    raise exception 'VERIFY FAILED: public.image_embed_stale_assets is missing';
  end if;

  if (select p.proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'image_embed_stale_assets')
     is distinct from array['search_path=public, dam', 'statement_timeout=120s'] then
    raise exception 'VERIFY FAILED: image_embed_stale_assets config does not carry the scale budget';
  end if;

  if not has_function_privilege('service_role', 'public.image_embed_stale_assets(uuid,integer)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.image_embed_stale_assets(uuid,integer)', 'EXECUTE')
     or has_function_privilege('anon', 'public.image_embed_stale_assets(uuid,integer)', 'EXECUTE') then
    raise exception 'VERIFY FAILED: image_embed_stale_assets execute is not service_role-only';
  end if;
end
$verify$;
