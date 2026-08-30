-- #1645: exact effective tag and grouped-identity filtering for PopDAM.
-- Reissued from permanently blocked version 20260827183011. Every DDL edge
-- below is safe when this exact contract was already installed in full.

begin;

-- F3 (#1664 review): the trigger DDL below takes SHARE ROW EXCLUSIVE on three
-- live tables and holds it through the backfill. Fail fast rather than queue
-- behind a long-running writer and stall every asset write indefinitely.
-- The triggers must be created BEFORE the backfill: creating them afterwards
-- would leave a window in which rows committed after the backfill snapshot
-- fire no trigger and are permanently missing from the projection. Measured
-- corpus at time of authoring: ~138k assets, ~2.2M active asset tags.
set local lock_timeout = '5s';

create table if not exists public.asset_effective_tags (
  asset_id uuid not null references public.assets(id) on delete cascade,
  tag text not null,
  scope text not null,
  constraint asset_effective_tags_tag_check check (tag = btrim(tag) and tag <> ''),
  constraint asset_effective_tags_scope_check check (scope in ('asset', 'style_group'))
);

create unique index if not exists asset_effective_tags_asset_tag_scope_uidx
  on public.asset_effective_tags (asset_id, tag, scope);

create index if not exists asset_effective_tags_tag_asset_idx
  on public.asset_effective_tags (tag, asset_id);

alter table public.asset_effective_tags enable row level security;

drop policy if exists "Authenticated read asset_effective_tags"
  on public.asset_effective_tags;

create policy "Authenticated read asset_effective_tags"
  on public.asset_effective_tags
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.assets a
      where a.id = asset_effective_tags.asset_id
    )
  );

create or replace function public.sync_asset_effective_tags()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_lock_keys text[];
  v_lock_ids bigint[];
  v_lock_id bigint;
begin
  -- F2 (#1664 review): re-derivation reads a snapshot of the *other* source
  -- table, so a concurrent regroup and group-tag write can each omit the same
  -- (asset, tag, style_group) key with no unique conflict to force a retry.
  -- Each branch below serialises every writer touching the same asset or style
  -- group on a transaction-scoped advisory lock, acquired in sorted id order so
  -- two writers holding overlapping sets cannot deadlock against each other.
  if tg_table_name = 'asset_tags' then
    v_lock_keys := array['aet_asset:' || coalesce(new.asset_id, old.asset_id)::text];
  elsif tg_table_name = 'style_group_tags' then
    v_lock_keys := array['aet_group:' || new.style_group_id::text,
                         'aet_group:' || old.style_group_id::text];
  elsif tg_table_name = 'assets' then
    v_lock_keys := array['aet_asset:' || coalesce(new.id, old.id)::text,
                         'aet_group:' || new.style_group_id::text,
                         'aet_group:' || old.style_group_id::text];
  else
    raise exception 'sync_asset_effective_tags called from unsupported table %', tg_table_name;
  end if;

  select coalesce(
           array_agg(distinct hashtextextended(k, 0) order by hashtextextended(k, 0)),
           '{}'::bigint[]
         )
    into v_lock_ids
  from unnest(v_lock_keys) k
  where k is not null;

  foreach v_lock_id in array v_lock_ids loop
    perform pg_advisory_xact_lock(v_lock_id);
  end loop;

  if tg_table_name = 'asset_tags' then
    if tg_op in ('DELETE', 'UPDATE') then
      delete from public.asset_effective_tags e
      where e.asset_id = old.asset_id
        and e.tag = old.tag
        and e.scope = 'asset';
    end if;

    if tg_op in ('INSERT', 'UPDATE') and new.status = 'active' then
      insert into public.asset_effective_tags (asset_id, tag, scope)
      select new.asset_id, new.tag, 'asset'
      from public.assets a
      where a.id = new.asset_id
        and a.is_deleted = false
      on conflict do nothing;
    end if;

    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  if tg_table_name = 'style_group_tags' then
    if tg_op in ('DELETE', 'UPDATE') then
      delete from public.asset_effective_tags e
      using public.assets a
      where a.id = e.asset_id
        and a.style_group_id = old.style_group_id
        and e.tag = old.tag
        and e.scope = 'style_group';
    end if;

    if tg_op in ('INSERT', 'UPDATE') and new.status = 'active' then
      insert into public.asset_effective_tags (asset_id, tag, scope)
      select a.id, new.tag, 'style_group'
      from public.assets a
      where a.style_group_id = new.style_group_id
        and a.is_deleted = false
      on conflict do nothing;
    end if;

    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  if tg_table_name = 'assets' then
    if tg_op in ('DELETE', 'UPDATE') then
      delete from public.asset_effective_tags e
      where e.asset_id = old.id;
    end if;

    if tg_op in ('INSERT', 'UPDATE') and new.is_deleted = false then
      insert into public.asset_effective_tags (asset_id, tag, scope)
      select new.id, t.tag, 'asset'
      from public.asset_tags t
      where t.asset_id = new.id
        and t.status = 'active'
      union all
      select new.id, t.tag, 'style_group'
      from public.style_group_tags t
      where t.style_group_id = new.style_group_id
        and t.status = 'active'
      on conflict do nothing;
    end if;

    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  raise exception 'sync_asset_effective_tags called from unsupported table %', tg_table_name;
end;
$$;

drop trigger if exists asset_tags_effective_tags_sync on public.asset_tags;
create trigger asset_tags_effective_tags_sync
after insert or update or delete on public.asset_tags
for each row execute function public.sync_asset_effective_tags();

drop trigger if exists style_group_tags_effective_tags_sync on public.style_group_tags;
create trigger style_group_tags_effective_tags_sync
after insert or update or delete on public.style_group_tags
for each row execute function public.sync_asset_effective_tags();

drop trigger if exists assets_effective_tags_sync on public.assets;
create trigger assets_effective_tags_sync
after insert or update of style_group_id, is_deleted or delete on public.assets
for each row execute function public.sync_asset_effective_tags();

-- The initial projection backfill writes roughly 2.3M rows across the two arms
-- above. The default per-statement timeout on the migration connection is two
-- minutes, which cancelled this statement on the first preview apply. Raise it
-- for this transaction only; lock_timeout stays at 5s so the migration still
-- fails fast rather than queueing behind a long-running writer.
set local statement_timeout = '30min';

insert into public.asset_effective_tags (asset_id, tag, scope)
select a.id, t.tag, 'asset'
from public.assets a
join public.asset_tags t on t.asset_id = a.id
where a.is_deleted = false
  and t.status = 'active'
union all
select a.id, t.tag, 'style_group'
from public.assets a
join public.style_group_tags t on t.style_group_id = a.style_group_id
where a.is_deleted = false
  and t.status = 'active'
on conflict do nothing;

reset statement_timeout;

-- F1 (#1664 review): the legacy get_filter_counts base restricts to assets that
-- pass the THUMBNAIL_MIN_DATE incident gate. The effective path must apply the
-- same gate or a count taken through one entry point will not match the list
-- taken through the other. The configured value lives in public.admin_config,
-- which has RLS enabled and NO select policy for `authenticated` (only an anon
-- SCAN_REQUEST policy), so an invoker read silently returns no row and falls
-- back to the default. This definer accessor reads exactly that one key.
create or replace function public.assets_thumbnail_min_date()
returns timestamptz
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select (value #>> '{}')::timestamptz from public.admin_config where key = 'THUMBNAIL_MIN_DATE'),
    '2020-01-01'::timestamptz
  );
$$;

revoke all on function public.assets_thumbnail_min_date() from public;
revoke all on function public.assets_thumbnail_min_date() from anon;
grant execute on function public.assets_thumbnail_min_date() to authenticated;

create or replace function public.filter_effective_assets(p_filters jsonb default '{}'::jsonb)
returns setof public.assets
language sql
stable
security invoker
set search_path = public
as $$
  select a.*
  from public.assets a
  left join public.style_groups sg on sg.id = a.style_group_id
  where a.is_deleted = false
    and (
      a.modified_at >= public.assets_thumbnail_min_date()
      or a.file_created_at >= public.assets_thumbnail_min_date()
      or a.thumbnail_url is not null
    )
    and (
      not (p_filters ? 'search')
      or nullif(p_filters ->> 'search', '') is null
      or a.filename ilike '%' || (p_filters ->> 'search') || '%'
    )
    and (
      not (p_filters ? 'licensorId')
      or nullif(p_filters ->> 'licensorId', '') is null
      or case when a.style_group_id is null then a.licensor_id else sg.licensor_id end
           = (p_filters ->> 'licensorId')::uuid
    )
    and (
      not (p_filters ? 'propertyId')
      or nullif(p_filters ->> 'propertyId', '') is null
      or case when a.style_group_id is null then a.property_id else sg.property_id end
           = (p_filters ->> 'propertyId')::uuid
    )
    and (
      not (p_filters ? 'tagFilter')
      or nullif(p_filters ->> 'tagFilter', '') is null
      or exists (
        select 1
        from public.asset_effective_tags e
        where e.asset_id = a.id
          and e.tag = p_filters ->> 'tagFilter'
      )
    )
    and (
      not (p_filters ? 'fileType')
      or jsonb_array_length(p_filters -> 'fileType') = 0
      or a.file_type::text in (select jsonb_array_elements_text(p_filters -> 'fileType'))
    )
    and (
      not (p_filters ? 'status')
      or jsonb_array_length(p_filters -> 'status') = 0
      or a.status::text in (select jsonb_array_elements_text(p_filters -> 'status'))
    )
    and (
      not (p_filters ? 'workflowStatus')
      or jsonb_array_length(p_filters -> 'workflowStatus') = 0
      or a.workflow_status::text in (select jsonb_array_elements_text(p_filters -> 'workflowStatus'))
    )
    and (
      not (p_filters ? 'stage')
      or jsonb_array_length(p_filters -> 'stage') = 0
      or a.stage in (select jsonb_array_elements_text(p_filters -> 'stage'))
    )
    and (
      not (p_filters ? 'isLicensed')
      or (p_filters ->> 'isLicensed') is null
      or a.is_licensed = (p_filters ->> 'isLicensed')::boolean
    )
    and (
      not (p_filters ? 'assetType')
      or jsonb_array_length(p_filters -> 'assetType') = 0
      or a.asset_type::text in (select jsonb_array_elements_text(p_filters -> 'assetType'))
    )
    and (
      not (p_filters ? 'artSource')
      or jsonb_array_length(p_filters -> 'artSource') = 0
      or a.art_source::text in (select jsonb_array_elements_text(p_filters -> 'artSource'))
    )
    and (nullif(p_filters ->> 'customer', '') is null or a.customer = p_filters ->> 'customer')
    and (nullif(p_filters ->> 'program', '') is null or a.program = p_filters ->> 'program');
$$;

create or replace function public.get_effective_filter_counts(p_filters jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_file_types text[];
  v_statuses text[];
  v_workflow_statuses text[];
  v_stages text[];
  v_is_licensed boolean;
  v_result jsonb;
begin
  if p_filters ? 'fileType' and jsonb_array_length(p_filters -> 'fileType') > 0 then
    select array_agg(x) into v_file_types from jsonb_array_elements_text(p_filters -> 'fileType') x;
  end if;
  if p_filters ? 'status' and jsonb_array_length(p_filters -> 'status') > 0 then
    select array_agg(x) into v_statuses from jsonb_array_elements_text(p_filters -> 'status') x;
  end if;
  if p_filters ? 'workflowStatus' and jsonb_array_length(p_filters -> 'workflowStatus') > 0 then
    select array_agg(x) into v_workflow_statuses from jsonb_array_elements_text(p_filters -> 'workflowStatus') x;
  end if;
  if p_filters ? 'stage' and jsonb_array_length(p_filters -> 'stage') > 0 then
    select array_agg(x) into v_stages from jsonb_array_elements_text(p_filters -> 'stage') x;
  end if;
  if p_filters ? 'isLicensed' then
    v_is_licensed := (p_filters ->> 'isLicensed')::boolean;
  end if;

  with base as materialized (
    select a.file_type, a.status, a.workflow_status, a.stage, a.is_licensed
    from public.filter_effective_assets(
      p_filters - array['fileType', 'status', 'workflowStatus', 'stage', 'isLicensed']::text[]
    ) a
  )
  select jsonb_build_object(
    'total', (
      select count(*) from base
      where (v_file_types is null or file_type::text = any(v_file_types))
        and (v_statuses is null or status::text = any(v_statuses))
        and (v_workflow_statuses is null or workflow_status::text = any(v_workflow_statuses))
        and (v_stages is null or stage = any(v_stages))
        and (v_is_licensed is null or is_licensed = v_is_licensed)
    ),
    'fileType', coalesce((
      select jsonb_object_agg(file_type::text, cnt) from (
        select file_type, count(*) cnt from base
        where (v_statuses is null or status::text = any(v_statuses))
          and (v_workflow_statuses is null or workflow_status::text = any(v_workflow_statuses))
          and (v_stages is null or stage = any(v_stages))
          and (v_is_licensed is null or is_licensed = v_is_licensed)
        group by file_type
      ) s
    ), '{}'::jsonb),
    'status', coalesce((
      select jsonb_object_agg(status::text, cnt) from (
        select status, count(*) cnt from base
        where (v_file_types is null or file_type::text = any(v_file_types))
          and (v_workflow_statuses is null or workflow_status::text = any(v_workflow_statuses))
          and (v_stages is null or stage = any(v_stages))
          and (v_is_licensed is null or is_licensed = v_is_licensed)
        group by status
      ) s
    ), '{}'::jsonb),
    'workflowStatus', coalesce((
      select jsonb_object_agg(workflow_status::text, cnt) from (
        select workflow_status, count(*) cnt from base
        where workflow_status is not null
          and (v_file_types is null or file_type::text = any(v_file_types))
          and (v_statuses is null or status::text = any(v_statuses))
          and (v_stages is null or stage = any(v_stages))
          and (v_is_licensed is null or is_licensed = v_is_licensed)
        group by workflow_status
      ) s
    ), '{}'::jsonb),
    'stage', coalesce((
      select jsonb_object_agg(stage, cnt) from (
        select stage, count(*) cnt from base
        where stage is not null
          and (v_file_types is null or file_type::text = any(v_file_types))
          and (v_statuses is null or status::text = any(v_statuses))
          and (v_workflow_statuses is null or workflow_status::text = any(v_workflow_statuses))
          and (v_is_licensed is null or is_licensed = v_is_licensed)
        group by stage
      ) s
    ), '{}'::jsonb),
    'isLicensed', (
      select jsonb_build_object(
        'true', coalesce(sum(case when is_licensed = true then 1 else 0 end), 0),
        'false', coalesce(sum(case when is_licensed = false or is_licensed is null then 1 else 0 end), 0)
      ) from base
      where (v_file_types is null or file_type::text = any(v_file_types))
        and (v_statuses is null or status::text = any(v_statuses))
        and (v_workflow_statuses is null or workflow_status::text = any(v_workflow_statuses))
        and (v_stages is null or stage = any(v_stages))
    )
  ) into v_result;

  return v_result;
end;
$$;

-- Preserve the incident-tested covering-index path unless an effective filter
-- is actually requested. The body below is the existing implementation,
-- transcribed verbatim from the live baseline, plus the delegation prologue.
-- derived-from: none
--
-- F4 (#1664 review): this function stays SECURITY DEFINER. It must, because it
-- reads public.admin_config, which grants no select policy to `authenticated`.
-- Consequence to keep in mind: filter_effective_assets and
-- get_effective_filter_counts are declared security invoker, but when reached
-- THROUGH this entry point they execute in the definer's context, so RLS on
-- public.assets is bypassed. That is safe only because the sole select policy
-- on public.assets is `is_deleted = false`, which both bodies hard-code. Any
-- future tightening of that policy MUST be mirrored into both bodies.
create or replace function public.get_filter_counts(p_filters jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_min_date timestamptz;
  v_search text;
  v_file_types text[];
  v_statuses text[];
  v_workflow_statuses text[];
  v_is_licensed boolean;
  v_licensor_id uuid;
  v_property_id uuid;
  v_asset_types text[];
  v_art_sources text[];
  v_tag_filter text;
  v_stages text[];
  v_customer text;
  v_program text;
  v_result jsonb := '{}'::jsonb;
begin
  if nullif(p_filters ->> 'tagFilter', '') is not null
     or nullif(p_filters ->> 'licensorId', '') is not null
     or nullif(p_filters ->> 'propertyId', '') is not null then
    return public.get_effective_filter_counts(p_filters);
  end if;

  select (value #>> '{}')::timestamptz into v_min_date
  from admin_config where key = 'THUMBNAIL_MIN_DATE';
  if v_min_date is null then
    v_min_date := '2020-01-01'::timestamptz;
  end if;

  v_search := p_filters ->> 'search';
  v_is_licensed := (p_filters ->> 'isLicensed')::boolean;
  v_licensor_id := (p_filters ->> 'licensorId')::uuid;
  v_property_id := (p_filters ->> 'propertyId')::uuid;
  v_tag_filter := p_filters ->> 'tagFilter';
  v_customer := p_filters ->> 'customer';
  v_program := p_filters ->> 'program';

  if p_filters ? 'fileType' and jsonb_array_length(p_filters -> 'fileType') > 0 then
    select array_agg(x::text) into v_file_types from jsonb_array_elements_text(p_filters -> 'fileType') x;
  end if;
  if p_filters ? 'status' and jsonb_array_length(p_filters -> 'status') > 0 then
    select array_agg(x::text) into v_statuses from jsonb_array_elements_text(p_filters -> 'status') x;
  end if;
  if p_filters ? 'workflowStatus' and jsonb_array_length(p_filters -> 'workflowStatus') > 0 then
    select array_agg(x::text) into v_workflow_statuses from jsonb_array_elements_text(p_filters -> 'workflowStatus') x;
  end if;
  if p_filters ? 'assetType' and jsonb_array_length(p_filters -> 'assetType') > 0 then
    select array_agg(x::text) into v_asset_types from jsonb_array_elements_text(p_filters -> 'assetType') x;
  end if;
  if p_filters ? 'artSource' and jsonb_array_length(p_filters -> 'artSource') > 0 then
    select array_agg(x::text) into v_art_sources from jsonb_array_elements_text(p_filters -> 'artSource') x;
  end if;
  if p_filters ? 'stage' and jsonb_array_length(p_filters -> 'stage') > 0 then
    select array_agg(x::text) into v_stages from jsonb_array_elements_text(p_filters -> 'stage') x;
  end if;

  with base as materialized (
    select file_type, status, workflow_status, stage, is_licensed
    from assets
    where is_deleted = false
      and (modified_at >= v_min_date or file_created_at >= v_min_date or thumbnail_url is not null)
      and (v_search is null or filename ilike '%' || v_search || '%')
      and (v_licensor_id is null or licensor_id = v_licensor_id)
      and (v_property_id is null or property_id = v_property_id)
      and (v_asset_types is null or asset_type::text = any(v_asset_types))
      and (v_art_sources is null or art_source::text = any(v_art_sources))
      and (v_tag_filter is null or v_tag_filter = any(tags))
      and (v_customer is null or customer = v_customer)
      and (v_program is null or program = v_program)
  )
  select jsonb_build_object(
    'fileType', coalesce((select jsonb_object_agg(file_type::text, cnt) from (
      select file_type, count(*) cnt from base where (v_statuses is null or status::text = any(v_statuses))
        and (v_workflow_statuses is null or workflow_status::text = any(v_workflow_statuses))
        and (v_stages is null or stage = any(v_stages)) and (v_is_licensed is null or is_licensed = v_is_licensed) group by file_type) s), '{}'::jsonb),
    'status', coalesce((select jsonb_object_agg(status::text, cnt) from (
      select status, count(*) cnt from base where (v_file_types is null or file_type::text = any(v_file_types))
        and (v_workflow_statuses is null or workflow_status::text = any(v_workflow_statuses))
        and (v_stages is null or stage = any(v_stages)) and (v_is_licensed is null or is_licensed = v_is_licensed) group by status) s), '{}'::jsonb),
    'workflowStatus', coalesce((select jsonb_object_agg(workflow_status, cnt) from (
      select workflow_status, count(*) cnt from base where workflow_status is not null
        and (v_file_types is null or file_type::text = any(v_file_types)) and (v_statuses is null or status::text = any(v_statuses))
        and (v_stages is null or stage = any(v_stages)) and (v_is_licensed is null or is_licensed = v_is_licensed) group by workflow_status) s), '{}'::jsonb),
    'stage', coalesce((select jsonb_object_agg(stage, cnt) from (
      select stage, count(*) cnt from base where stage is not null and (v_file_types is null or file_type::text = any(v_file_types))
        and (v_statuses is null or status::text = any(v_statuses)) and (v_workflow_statuses is null or workflow_status::text = any(v_workflow_statuses))
        and (v_is_licensed is null or is_licensed = v_is_licensed) group by stage) s), '{}'::jsonb),
    'isLicensed', (select jsonb_build_object(
      'true', coalesce(sum(case when is_licensed = true then 1 else 0 end), 0),
      'false', coalesce(sum(case when is_licensed = false or is_licensed is null then 1 else 0 end), 0))
      from base where (v_file_types is null or file_type::text = any(v_file_types)) and (v_statuses is null or status::text = any(v_statuses))
        and (v_workflow_statuses is null or workflow_status::text = any(v_workflow_statuses)) and (v_stages is null or stage = any(v_stages)))
  ) into v_result;

  return v_result;
end;
$$;

revoke all on public.asset_effective_tags from public, anon;
grant select on public.asset_effective_tags to authenticated, service_role;

revoke all on function public.sync_asset_effective_tags() from public, anon, authenticated;
revoke all on function public.filter_effective_assets(jsonb) from public, anon;
revoke all on function public.get_effective_filter_counts(jsonb) from public, anon;
grant execute on function public.filter_effective_assets(jsonb) to authenticated, service_role;
grant execute on function public.get_effective_filter_counts(jsonb) to authenticated, service_role;

comment on table public.asset_effective_tags is
  'Maintained active-only effective tag projection. Asset rows stay file-only; style-group rows reach current non-deleted members.';
comment on function public.filter_effective_assets(jsonb) is
  'RLS-compatible PopDAM list filter using active effective tags and group-winning identity without copying metadata to assets.';
comment on function public.get_effective_filter_counts(jsonb) is
  'Facet counts over the same effective base as filter_effective_assets; total is exact list parity.';

commit;
