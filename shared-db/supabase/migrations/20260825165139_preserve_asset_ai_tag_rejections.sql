-- #1498: replace prior file-AI results without resurrecting rejected tombstones.
-- Manual/created-by rows remain authoritative, and the public RPC signature is unchanged.

do $$
begin
  if to_regclass('public.asset_tags') is null
     or to_regclass('public.assets') is null
     or to_regprocedure('public.refresh_dam_search_documents_batch(uuid[],uuid[],integer)') is null
     or to_regprocedure('public.replace_asset_ai_tag_result(uuid,text,text,jsonb)') is null then
    raise exception '#1498 prerequisite contract is incomplete';
  end if;
end
$$;

create or replace function public.replace_asset_ai_tag_result(
  p_asset_id uuid,
  p_source text,
  p_model text,
  p_tags jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r jsonb;
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

  -- A new result supersedes this source's prior active/candidate output across
  -- model versions, including historical NULL-model legacy rows. Rejected
  -- tombstones and every manually-owned row are durable authority.
  delete from public.asset_tags
  where asset_id = p_asset_id
    and source = v_source
    and status in ('active', 'candidate')
    and created_by is null;

  for r in select value from jsonb_array_elements(p_tags) loop
    if coalesce(r->>'category', '') not in
         ('file_type', 'view', 'scene', 'color', 'visible_content', 'technique', 'other')
       or coalesce(r->>'status', '') not in ('active', 'candidate', 'rejected')
       or nullif(btrim(r->>'tag'), '') is null
       or (r ? 'confidence' and
           ((r->>'confidence')::numeric < 0 or (r->>'confidence')::numeric > 1)) then
      raise exception 'invalid asset tag';
    end if;

    insert into public.asset_tags(
      asset_id, tag, category, source, status, confidence, model, evidence, rejected_at
    )
    values (
      p_asset_id,
      btrim(r->>'tag'),
      r->>'category',
      v_source,
      r->>'status',
      (r->>'confidence')::numeric,
      v_model,
      coalesce(r->'evidence', '{}'),
      case when r->>'status' = 'rejected' then now() end
    )
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
  end loop;

  perform public.refresh_dam_search_documents_batch(array[p_asset_id], '{}'::uuid[], 2);

  select count(*) into v_count
  from public.asset_tags
  where asset_id = p_asset_id
    and source = v_source
    and model = v_model;

  return jsonb_build_object('asset_id', p_asset_id, 'tag_count', v_count);
end
$$;

revoke all on function public.replace_asset_ai_tag_result(uuid, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.replace_asset_ai_tag_result(uuid, text, text, jsonb)
  to service_role;

comment on function public.replace_asset_ai_tag_result(uuid, text, text, jsonb) is
  'Service-only bounded file-AI tag replacement. Preserves manual rows and durable rejected tombstones while superseding prior active/candidate results across model versions.';
