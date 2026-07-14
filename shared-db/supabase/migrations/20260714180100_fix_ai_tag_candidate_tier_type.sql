-- Keep the public RPC cursor tier as integer while assets stores it as smallint.
-- The initial preview rehearsal caught the strict RETURNS TABLE type mismatch.

create or replace function public.get_ai_tag_candidates(
  p_mode text,
  p_limit integer,
  p_after_tier integer default null,
  p_after_id uuid default null,
  p_group_ids uuid[] default null
)
returns table(
  id uuid,
  thumbnail_url text,
  filename text,
  relative_path text,
  style_group_id uuid,
  primary_sort_tier integer
)
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 200));
  v_has_cursor boolean := p_after_tier is not null and p_after_id is not null;
  v_group_scoped boolean := coalesce(cardinality(p_group_ids), 0) > 0;
begin
  if p_mode is null or p_mode not in ('untagged', 'all') then
    raise exception 'invalid AI tag candidate mode: %', coalesce(p_mode, '<null>')
      using errcode = '22023';
  end if;

  if (p_after_tier is null) <> (p_after_id is null) then
    raise exception 'AI tag candidate cursor requires both tier and asset ID'
      using errcode = '22023';
  end if;

  if p_mode = 'untagged' then
    return query
    select
      candidate.id,
      candidate.thumbnail_url,
      candidate.filename,
      candidate.relative_path,
      candidate.style_group_id,
      candidate.primary_sort_tier::integer
    from public.assets candidate
    where candidate.is_deleted = false
      and candidate.thumbnail_url is not null
      and candidate.primary_sort_tier not in (4, 8)
      and candidate.status <> 'tagged'
      and (not v_group_scoped or candidate.style_group_id = any(p_group_ids))
      and (
        v_group_scoped
        or candidate.style_group_id is null
        or not exists (
          select 1
          from public.assets tagged
          where tagged.style_group_id = candidate.style_group_id
            and tagged.is_deleted = false
            and tagged.status = 'tagged'
            and tagged.ai_tagged_at is not null
        )
      )
      and (
        not v_has_cursor
        or (candidate.primary_sort_tier, candidate.id) > (p_after_tier, p_after_id)
      )
    order by candidate.primary_sort_tier, candidate.id
    limit v_limit;
  else
    return query
    select
      candidate.id,
      candidate.thumbnail_url,
      candidate.filename,
      candidate.relative_path,
      candidate.style_group_id,
      candidate.primary_sort_tier::integer
    from public.assets candidate
    where candidate.is_deleted = false
      and candidate.thumbnail_url is not null
      and candidate.primary_sort_tier not in (4, 8)
      and (not v_group_scoped or candidate.style_group_id = any(p_group_ids))
      and (
        not v_has_cursor
        or (candidate.primary_sort_tier, candidate.id) > (p_after_tier, p_after_id)
      )
    order by candidate.primary_sort_tier, candidate.id
    limit v_limit;
  end if;
end;
$$;

comment on function public.get_ai_tag_candidates(text, integer, integer, uuid, uuid[]) is
  'Returns a bounded AI-tag candidate page ordered by (primary_sort_tier, id). Pass both cursor fields or neither. Untagged, unscoped calls exclude style groups with an AI-tagged representative while retaining null-group assets. The application cursor is opaque and service-role-only.';
