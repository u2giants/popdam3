-- Set-based PopSG folder consensus. Repeated filename/document evidence may be
-- inherited by siblings only when the documented support thresholds pass.

create or replace function public.refresh_style_guide_folder_consensus_batch(
  p_after_key text default null,
  p_limit_folders integer default 100,
  p_rule_version text default 'folder-consensus-v1'
)
returns table (
  next_cursor text,
  folders_processed integer,
  relationships_written integer,
  done boolean
)
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit_folders, 100), 1), 500);
  v_folders integer;
  v_written integer := 0;
  v_last_key text;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;

  create temporary table tmp_popsg_consensus_folders
  on commit drop
  as
  select
    f.root_label,
    f.directory_path,
    f.root_label || chr(31) || f.directory_path as folder_key,
    count(*)::integer as file_count
  from public.style_guide_files f
  where f.is_active
    and (
      p_after_key is null
      or f.root_label || chr(31) || f.directory_path > p_after_key
    )
  group by f.root_label, f.directory_path
  having count(*) between 2 and 500
  order by f.root_label || chr(31) || f.directory_path
  limit v_limit;

  select count(*), max(folder_key)
  into v_folders, v_last_key
  from tmp_popsg_consensus_folders;

  if v_folders = 0 then
    return query select null::text, 0, 0, true;
    return;
  end if;

  delete from public.style_guide_file_tags ft
  using public.style_guide_files f, tmp_popsg_consensus_folders sf
  where ft.style_guide_file_id = f.id
    and f.root_label = sf.root_label
    and f.directory_path = sf.directory_path
    and ft.source = 'folder_consensus'
    and ft.status <> 'rejected';

  with support as (
    select
      sf.root_label,
      sf.directory_path,
      sf.folder_key,
      sf.file_count,
      ft.tag_id,
      max(ft.facet) as facet,
      count(distinct ft.style_guide_file_id)::integer as support_count
    from tmp_popsg_consensus_folders sf
    join public.style_guide_files f
      on f.root_label = sf.root_label
     and f.directory_path = sf.directory_path
     and f.is_active
    join public.style_guide_file_tags ft
      on ft.style_guide_file_id = f.id
     and ft.status = 'accepted'
     and ft.source in ('filename', 'embedded_metadata', 'document_text')
     and ft.facet in (
       'property', 'character', 'collection', 'season', 'occasion', 'product',
       'application', 'asset_type', 'theme', 'style', 'material_finish', 'audience'
     )
    group by
      sf.root_label,
      sf.directory_path,
      sf.folder_key,
      sf.file_count,
      ft.tag_id
  ),
  eligible as (
    select *
    from support s
    where
      (s.file_count between 2 and 4 and s.support_count = s.file_count)
      or (
        s.file_count between 5 and 19
        and s.support_count >= 3
        and s.support_count::numeric / s.file_count >= 0.70
      )
      or (
        s.file_count >= 20
        and s.support_count >= 5
        and s.support_count::numeric / s.file_count >= 0.60
      )
  )
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
  select
    f.id,
    e.tag_id,
    'folder_consensus',
    e.facet,
    0.85,
    'accepted',
    jsonb_build_object(
      'root_label', e.root_label,
      'directory_path', e.directory_path,
      'support_count', e.support_count,
      'file_count', e.file_count
    ),
    true,
    p_rule_version
  from eligible e
  join public.style_guide_files f
    on f.root_label = e.root_label
   and f.directory_path = e.directory_path
   and f.is_active
  where not exists (
    select 1
    from public.style_guide_file_tags own
    where own.style_guide_file_id = f.id
      and own.tag_id = e.tag_id
      and own.source <> 'folder_consensus'
      and own.status = 'accepted'
  )
  on conflict (style_guide_file_id, tag_id, source, rule_version) do update
  set facet = excluded.facet,
      confidence = excluded.confidence,
      evidence = excluded.evidence,
      inherited = true,
      updated_at = now();

  get diagnostics v_written = row_count;

  return query
  select
    case when v_folders < v_limit then null else v_last_key end,
    v_folders,
    v_written,
    v_folders < v_limit;
end;
$$;

revoke all on function public.refresh_style_guide_folder_consensus_batch(text, integer, text)
  from public;
grant execute on function public.refresh_style_guide_folder_consensus_batch(text, integer, text)
  to service_role;

comment on function public.refresh_style_guide_folder_consensus_batch(text, integer, text) is
  'Propagates strongly supported filename/document tags within bounded PopSG folders. Consensus tags never count as support and rejected decisions are preserved.';
