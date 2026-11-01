-- derived-from: 20260814223552
-- Issue popcre/shared-db#5377 (claim #5378): AI tag saves still hit the statement
-- timeout after 20261101153023, because this function inserted one tag per statement
-- and so fired the statement-level search refresh once per tag. Validation and the
-- conflict rules are unchanged; all tags are now one insert, and the trailing refresh
-- is gone because the delete and insert triggers already refresh this asset. When a
-- result repeats a tag, the last entry still wins.

create or replace function public.replace_asset_ai_tag_result(p_asset_id uuid, p_source text, p_model text, p_tags jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_count integer;
  v_source text := btrim(p_source);
  v_model text := btrim(p_model);
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'service_role required' using errcode = '42501';
  end if;

  if p_asset_id is null
     or nullif(v_source, '') is null
     or lower(v_source) = 'manual'
     or nullif(v_model, '') is null
     or jsonb_typeof(p_tags) <> 'array'
     or not exists (select 1 from public.assets where id = p_asset_id) then
    raise exception 'invalid asset AI result';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_tags) as t(r)
    where coalesce(r->>'category', '') not in
            ('file_type', 'view', 'scene', 'color', 'visible_content', 'technique', 'other')
       or coalesce(r->>'status', '') not in ('active', 'candidate', 'rejected')
       or nullif(btrim(r->>'tag'), '') is null
       or (r ? 'confidence' and
           ((r->>'confidence')::numeric < 0 or (r->>'confidence')::numeric > 1))
  ) then
    raise exception 'invalid asset tag';
  end if;

  -- A new result supersedes this source's prior active/candidate output across
  -- model versions, including historical NULL-model legacy rows. Rejected
  -- tombstones and every manually-owned row are durable authority.
  delete from public.asset_tags
  where asset_id = p_asset_id
    and source = v_source
    and status in ('active', 'candidate')
    and created_by is null;

  insert into public.asset_tags(
    asset_id, tag, category, source, status, confidence, model, evidence, rejected_at
  )
  select distinct on (btrim(r->>'tag'))
    p_asset_id,
    btrim(r->>'tag'),
    r->>'category',
    v_source,
    r->>'status',
    (r->>'confidence')::numeric,
    v_model,
    coalesce(r->'evidence', '{}'),
    case when r->>'status' = 'rejected' then now() end
  from jsonb_array_elements(p_tags) with ordinality as t(r, n)
  order by btrim(r->>'tag'), n desc
  on conflict (asset_id, tag) do update
  set category = excluded.category,
      source = excluded.source,
      status = excluded.status,
      confidence = excluded.confidence,
      model = excluded.model,
      evidence = excluded.evidence,
      rejected_at = excluded.rejected_at,
      updated_at = now()
  where public.asset_tags.created_by is null
    and public.asset_tags.source = excluded.source
    and public.asset_tags.status in ('active', 'candidate');

  select count(*) into v_count
  from public.asset_tags
  where asset_id = p_asset_id
    and source = v_source
    and model = v_model;

  return jsonb_build_object('asset_id', p_asset_id, 'tag_count', v_count);
end
$function$;
