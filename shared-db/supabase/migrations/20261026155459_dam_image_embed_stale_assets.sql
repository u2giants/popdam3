-- Issue #4814 (author claim #4818): PopDAM image-similarity Step 4b —
-- public.image_embed_stale_assets(...) service_role wrapper so the Railway
-- rebuild-image-vectors op can enumerate stale assets over PostgREST.
-- Design: u2giants/popdam3 plan_image_similarity_upload_search.md Step 4b
-- (backfill = enqueue/status only; embedding stays with the GPU poller).
-- derived-from: none
--
-- WHY THIS WRAPPER EXISTS. service_role cannot read dam.* (the Step-2 home
-- migration revokes every table grant and dam is not in pgrst.db_schemas —
-- quirk #64), so the backfill op has no way to find which assets are stale.
-- One additive public SECURITY DEFINER function closes that, exactly like
-- public.image_embed_enqueue_index / image_embed_status before it.
--
-- WHAT THIS CREATES.
--   * public.image_embed_stale_assets(p_after_asset_id uuid, p_limit int)
--     returns setof uuid — cursor-paginated by assets.id. An asset is stale
--     when it has no dam.dam_asset_image_vectors row, OR its
--     last_embedded_thumbnail_url watermark is DISTINCT FROM
--     assets.thumbnail_url, OR its embedding_model stamp is outside the
--     active window. The stamp window is derived exactly the way
--     public.search_dam_image_similarity derives it: admin_config
--     IMAGE_SIM_EMBEDDING_MODEL, plus IMAGE_SIM_EMBEDDING_MODEL_PREVIOUS
--     while IMAGE_SIM_REEMBED_IN_PROGRESS is true. Deleted assets and
--     non-raster thumbnails never count (the enqueue trigger's raster rule,
--     L-7), so the op cannot mass-enqueue work the poller must refuse.
--     An unconfigured stamp RAISES instead of returning a silent empty set —
--     a backfill that "found nothing" because no model is configured is an
--     operator error the op must surface, not a success.
--
-- ROLL-OUT SAFETY. Additive single function; no table, trigger, data or
-- cron change; the caller (popdam3 op handler) is not deployed yet, so
-- nothing calls this at apply time.

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
set statement_timeout = '30s'
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
    and (p_after_asset_id is null or a.id > p_after_asset_id)
    and (v.asset_id is null
         or v.last_embedded_thumbnail_url is distinct from a.thumbnail_url
         or v.embedding_model <> all (v_stamps))
  order by a.id
  limit v_limit;
end;
$$;

comment on function public.image_embed_stale_assets(uuid, integer) is
  'Service-role entrypoint: cursor-paginated ids of assets whose image vectors are stale (missing, watermark changed, or stamp outside the active window derived from admin_config like search_dam_image_similarity).';

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

  if not has_function_privilege('service_role', 'public.image_embed_stale_assets(uuid,integer)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.image_embed_stale_assets(uuid,integer)', 'EXECUTE')
     or has_function_privilege('anon', 'public.image_embed_stale_assets(uuid,integer)', 'EXECUTE') then
    raise exception 'VERIFY FAILED: image_embed_stale_assets execute is not service_role-only';
  end if;
end
$verify$;
