-- PopSG tag hardening:
-- 1. include root_label in the deterministic worker batch contract so folder
--    consensus can never cross scan roots;
-- 2. add a source-scoped consensus replacement RPC; and
-- 3. restrict rejection of shared automatic tags to administrators.

create or replace function public.get_style_guide_deterministic_tag_batch_v2(
  p_after_id uuid default null,
  p_limit integer default 200,
  p_rebuild boolean default false
)
returns table (
  id uuid,
  root_label text,
  relative_path text,
  filename text,
  file_extension text,
  licensor_name text,
  property_folder text,
  style_guide_folder text,
  directory_path text,
  input_fingerprint text
)
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;

  return query
  select
    f.id,
    f.root_label,
    f.relative_path,
    f.filename,
    f.file_extension,
    f.licensor_name,
    f.property_folder,
    f.style_guide_folder,
    f.directory_path,
    s.input_fingerprint
  from public.style_guide_files f
  join public.style_guide_tagging_state s
    on s.style_guide_file_id = f.id
   and s.pipeline = 'deterministic'
  where f.is_active
    and (p_after_id is null or f.id > p_after_id)
    and (
      p_rebuild
      or s.status = 'pending'
      or (s.status = 'failed' and s.attempt_count < 3)
    )
  order by f.id
  limit least(greatest(coalesce(p_limit, 200), 1), 1000);
end;
$$;

revoke all on function public.get_style_guide_deterministic_tag_batch_v2(uuid, integer, boolean)
  from public;
grant execute on function public.get_style_guide_deterministic_tag_batch_v2(uuid, integer, boolean)
  to service_role;

create or replace function public.replace_style_guide_folder_consensus_tags(
  p_file_id uuid,
  p_tags jsonb,
  p_rule_version text
)
returns integer
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_item jsonb;
  v_normalized text;
  v_display text;
  v_tag_id uuid;
  v_facet text;
  v_count integer := 0;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;

  if not jsonb_typeof(coalesce(p_tags, '[]'::jsonb)) = 'array' then
    raise exception 'p_tags must be a JSON array' using errcode = '22023';
  end if;

  delete from public.style_guide_file_tags
  where style_guide_file_id = p_file_id
    and source = 'folder_consensus'
    and status <> 'rejected';

  for v_item in select value from jsonb_array_elements(coalesce(p_tags, '[]'::jsonb))
  loop
    v_normalized := public.normalize_style_guide_tag(v_item->>'tag');
    if v_normalized = '' then
      continue;
    end if;

    v_facet := case
      when v_item->>'facet' in (
        'licensor', 'property', 'character', 'collection', 'season', 'year',
        'occasion', 'product', 'application', 'asset_type', 'theme', 'style',
        'color', 'material_finish', 'audience', 'language', 'workflow', 'other'
      ) then v_item->>'facet'
      else 'other'
    end;
    v_display := coalesce(nullif(btrim(v_item->>'display_name'), ''), initcap(v_normalized));

    insert into public.style_guide_tags (
      tag,
      normalized_tag,
      facet,
      display_name,
      is_system
    )
    values (v_normalized, v_normalized, v_facet, v_display, true)
    on conflict (normalized_tag) do update
    set updated_at = now()
    returning id into v_tag_id;

    insert into public.style_guide_file_tags (
      style_guide_file_id,
      tag_id,
      source,
      facet,
      confidence,
      status,
      evidence,
      inherited,
      rule_version
    )
    values (
      p_file_id,
      v_tag_id,
      'folder_consensus',
      v_facet,
      least(greatest(coalesce((v_item->>'confidence')::numeric, 0.85), 0), 1),
      'accepted',
      coalesce(v_item->'evidence', '{}'::jsonb),
      true,
      p_rule_version
    )
    on conflict (style_guide_file_id, tag_id, source, rule_version) do update
    set facet = excluded.facet,
        confidence = excluded.confidence,
        evidence = excluded.evidence,
        inherited = true,
        updated_at = now();

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.replace_style_guide_folder_consensus_tags(uuid, jsonb, text)
  from public;
grant execute on function public.replace_style_guide_folder_consensus_tags(uuid, jsonb, text)
  to service_role;

create or replace function public.reject_style_guide_auto_tag(
  p_file_id uuid,
  p_tag_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_user_id uuid := auth.uid();
  v_count integer;
begin
  if v_user_id is null
     or not public.has_app_access(_user_id => v_user_id, _app => 'styleguides')
     or not public.has_role(_user_id => v_user_id, _role => 'admin') then
    raise exception 'PopSG administrator access required' using errcode = '42501';
  end if;

  update public.style_guide_file_tags
  set status = 'rejected',
      confirmed_by = v_user_id,
      confirmed_at = now(),
      updated_at = now()
  where style_guide_file_id = p_file_id
    and tag_id = p_tag_id
    and source <> 'manual'
    and status <> 'rejected';

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.reject_style_guide_auto_tag(uuid, uuid) from public;
grant execute on function public.reject_style_guide_auto_tag(uuid, uuid)
  to authenticated, service_role;

comment on function public.replace_style_guide_folder_consensus_tags(uuid, jsonb, text) is
  'Replaces accepted folder-consensus evidence for one PopSG file while preserving manual and rejected decisions.';
