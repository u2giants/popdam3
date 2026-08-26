-- Preserve PopDAM's legacy group-tag propagation capability after #1427 made
-- public.asset_tags.category and status required.
-- GitHub: u2giants/shared-db#1597; u2giants/shared-db#1427; u2giants/popdam3#96.

do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'asset_tags'
      and column_name = 'category'
      and is_nullable = 'NO'
  ) or not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'asset_tags'
      and column_name = 'status'
      and is_nullable = 'NO'
  ) then
    raise exception 'propagate_group_tags_batch repair requires #1427 asset_tags category/status contract';
  end if;
end;
$$;

create or replace function public.propagate_group_tags_batch(
  p_cursor uuid default null,
  p_batch_size integer default 100
)
returns table(
  next_cursor uuid,
  propagated integer,
  skipped integer,
  done boolean
)
language plpgsql
security definer
set search_path = public
set statement_timeout = '120s'
set lock_timeout = '0'
as $$
declare
  v_next_cursor uuid;
  v_total_propagated integer := 0;
  v_group_count integer := 0;
  v_batch_propagated integer;
  v_file_specific_tags text[] := array[
    'art_piece','art piece','product','product shot','product photo',
    'packaging','package','tech_pack','tech pack','technical pack',
    'photography','photo','mockup','mock up','mock-up',
    'front view','back view','side view','flat lay','flatlay',
    'render','3d render'
  ];
begin
  for v_next_cursor in
    select sg.id
    from public.style_groups sg
    where (p_cursor is null or sg.id > p_cursor)
    order by sg.id
    limit p_batch_size
  loop
    v_group_count := v_group_count + 1;

    with source_asset as (
      select a.id, a.licensor_id, a.property_id, a.is_licensed,
             a.big_theme, a.little_theme, a.design_style, a.cover_description
      from public.assets a
      where a.style_group_id = v_next_cursor
        and a.is_deleted = false
        and a.ai_tagged_at is not null
      order by a.primary_sort_tier asc, a.ai_tagged_at asc
      limit 1
    ),
    source_tags as (
      select at2.tag
      from public.asset_tags at2
      join source_asset sa on sa.id = at2.asset_id
      where at2.source = 'ai'
        and at2.category = 'legacy_unscoped'
        and at2.status = 'active'
        and lower(trim(at2.tag)) != all(v_file_specific_tags)
    ),
    source_chars as (
      select ac.character_id
      from public.asset_characters ac
      join source_asset sa on sa.id = ac.asset_id
    ),
    siblings as (
      select a.id, a.licensor_id, a.property_id, a.is_licensed,
             a.big_theme, a.little_theme, a.design_style, a.cover_description
      from public.assets a
      cross join source_asset sa
      where a.style_group_id = v_next_cursor
        and a.is_deleted = false
        and a.id != sa.id
    ),
    inserted_tags as (
      insert into public.asset_tags (asset_id, tag, source, category, status)
      select s.id, st.tag, 'ai', 'legacy_unscoped', 'active'
      from siblings s
      cross join source_tags st
      on conflict (asset_id, tag) do nothing
      returning 1
    ),
    inserted_chars as (
      insert into public.asset_characters (asset_id, character_id)
      select s.id, sc.character_id
      from siblings s
      cross join source_chars sc
      on conflict (asset_id, character_id) do nothing
      returning 1
    ),
    meta_updates as (
      update public.assets a
      set
        licensor_id = coalesce(a.licensor_id, sa.licensor_id),
        property_id = coalesce(a.property_id, sa.property_id),
        is_licensed = case when a.is_licensed = true then true else coalesce(sa.is_licensed, a.is_licensed) end,
        big_theme = coalesce(a.big_theme, sa.big_theme),
        little_theme = coalesce(a.little_theme, sa.little_theme),
        design_style = coalesce(a.design_style, sa.design_style),
        cover_description = coalesce(a.cover_description, sa.cover_description)
      from source_asset sa, siblings s
      where a.id = s.id
        and (
          (a.licensor_id is null and sa.licensor_id is not null) or
          (a.property_id is null and sa.property_id is not null) or
          (a.is_licensed is not true and sa.is_licensed = true) or
          (a.big_theme is null and sa.big_theme is not null) or
          (a.little_theme is null and sa.little_theme is not null) or
          (a.design_style is null and sa.design_style is not null) or
          (a.cover_description is null and sa.cover_description is not null)
        )
      returning 1
    )
    select
      (select count(*)::integer from inserted_tags)
      + (select count(*)::integer from inserted_chars)
    into v_batch_propagated;

    v_total_propagated := v_total_propagated + coalesce(v_batch_propagated, 0);
  end loop;

  return query select
    v_next_cursor,
    v_total_propagated,
    0::integer,
    (v_group_count < p_batch_size);
end;
$$;
