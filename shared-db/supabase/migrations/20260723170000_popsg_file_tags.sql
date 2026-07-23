-- PopSG file tags: canonical vocabulary, provenance-aware relationships,
-- deterministic pipeline state, browser-safe manual mutations, and fast
-- file-level tag search/filter caches.

create table if not exists public.style_guide_tags (
  id uuid primary key default gen_random_uuid(),
  tag text not null,
  normalized_tag text not null,
  facet text not null default 'other'
    check (facet in (
      'licensor', 'property', 'character', 'collection', 'season', 'year',
      'occasion', 'product', 'application', 'asset_type', 'theme', 'style',
      'color', 'material_finish', 'audience', 'language', 'workflow', 'other'
    )),
  display_name text not null,
  is_active boolean not null default true,
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint style_guide_tags_tag_not_blank check (btrim(tag) <> ''),
  constraint style_guide_tags_normalized_not_blank check (btrim(normalized_tag) <> ''),
  constraint style_guide_tags_display_not_blank check (btrim(display_name) <> ''),
  constraint style_guide_tags_tag_unique unique (tag),
  constraint style_guide_tags_normalized_unique unique (normalized_tag)
);

create table if not exists public.style_guide_tag_aliases (
  id uuid primary key default gen_random_uuid(),
  tag_id uuid not null references public.style_guide_tags(id) on delete cascade,
  alias text not null,
  normalized_alias text not null,
  scope jsonb,
  created_by text not null default 'seed',
  created_at timestamptz not null default now(),
  constraint style_guide_tag_aliases_alias_not_blank check (btrim(alias) <> ''),
  constraint style_guide_tag_aliases_normalized_not_blank check (btrim(normalized_alias) <> ''),
  constraint style_guide_tag_aliases_normalized_unique unique (normalized_alias)
);

create table if not exists public.style_guide_file_tags (
  id uuid primary key default gen_random_uuid(),
  style_guide_file_id uuid not null
    references public.style_guide_files(id) on delete cascade,
  tag_id uuid not null references public.style_guide_tags(id) on delete cascade,
  source text not null
    check (source in (
      'manual', 'path', 'filename', 'folder_consensus', 'embedded_metadata',
      'document_text', 'ocr', 'image_measurement', 'duplicate',
      'cross_reference', 'vision_ai'
    )),
  facet text not null default 'other'
    check (facet in (
      'licensor', 'property', 'character', 'collection', 'season', 'year',
      'occasion', 'product', 'application', 'asset_type', 'theme', 'style',
      'color', 'material_finish', 'audience', 'language', 'workflow', 'other'
    )),
  confidence numeric(4, 3) not null default 1
    check (confidence >= 0 and confidence <= 1),
  status text not null default 'accepted'
    check (status in ('accepted', 'suggested', 'rejected')),
  evidence jsonb not null default '{}'::jsonb,
  inherited boolean not null default false,
  source_file_id uuid references public.style_guide_files(id) on delete set null,
  rule_version text not null default 'manual-v1',
  created_by uuid references auth.users(id) on delete set null,
  confirmed_by uuid references auth.users(id) on delete set null,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint style_guide_file_tags_unique_source
    unique (style_guide_file_id, tag_id, source, rule_version)
);

create table if not exists public.style_guide_tagging_state (
  style_guide_file_id uuid not null
    references public.style_guide_files(id) on delete cascade,
  pipeline text not null
    check (pipeline in ('deterministic', 'document', 'measurement', 'vision')),
  status text not null default 'pending'
    check (status in ('pending', 'running', 'completed', 'failed')),
  input_fingerprint text,
  rule_version text,
  candidate_count integer not null default 0 check (candidate_count >= 0),
  accepted_count integer not null default 0 check (accepted_count >= 0),
  error_code text,
  error_detail text,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (style_guide_file_id, pipeline)
);

alter table public.style_guide_files
  add column if not exists tag_names text[] not null default '{}'::text[],
  add column if not exists tag_search_text text not null default '';

create index if not exists idx_style_guide_tags_facet_active
  on public.style_guide_tags (facet, is_active, tag);

create index if not exists idx_style_guide_tags_display_trgm
  on public.style_guide_tags
  using gin (display_name extensions.gin_trgm_ops);

create index if not exists idx_style_guide_tag_aliases_tag_id
  on public.style_guide_tag_aliases (tag_id);

create index if not exists idx_style_guide_file_tags_file_status
  on public.style_guide_file_tags (style_guide_file_id, status);

create index if not exists idx_style_guide_file_tags_tag_status
  on public.style_guide_file_tags (tag_id, status, style_guide_file_id);

create index if not exists idx_style_guide_file_tags_source
  on public.style_guide_file_tags (source, status);

create index if not exists idx_style_guide_tagging_state_work
  on public.style_guide_tagging_state (pipeline, status, style_guide_file_id);

create index if not exists idx_style_guide_files_tag_names
  on public.style_guide_files using gin (tag_names);

create index if not exists idx_style_guide_files_tag_search_trgm
  on public.style_guide_files
  using gin (tag_search_text extensions.gin_trgm_ops);

create or replace function public.normalize_style_guide_tag(p_value text)
returns text
language sql
immutable
parallel safe
as $$
  select trim(
    both ' ' from regexp_replace(
      regexp_replace(
        lower(coalesce(p_value, '')),
        '[_/\\-]+',
        ' ',
        'g'
      ),
      '[^a-z0-9]+',
      ' ',
      'g'
    )
  );
$$;

comment on function public.normalize_style_guide_tag(text) is
  'PopSG canonical tag lookup normalization. Phrase aliases, not stemming, control semantic normalization.';

create or replace function public.refresh_style_guide_file_tag_cache(p_file_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_tags text[];
  v_search text;
begin
  select
    coalesce(array_agg(distinct t.tag order by t.tag), '{}'::text[]),
    coalesce(string_agg(distinct t.tag, ' ' order by t.tag), '')
  into v_tags, v_search
  from public.style_guide_file_tags ft
  join public.style_guide_tags t on t.id = ft.tag_id
  where ft.style_guide_file_id = p_file_id
    and ft.status = 'accepted'
    and t.is_active;

  update public.style_guide_files
  set tag_names = v_tags,
      tag_search_text = v_search
  where id = p_file_id
    and (tag_names is distinct from v_tags or tag_search_text is distinct from v_search);
end;
$$;

revoke all on function public.refresh_style_guide_file_tag_cache(uuid) from public;
grant execute on function public.refresh_style_guide_file_tag_cache(uuid) to service_role;

create or replace function public.trg_refresh_style_guide_file_tag_cache()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform public.refresh_style_guide_file_tag_cache(
    coalesce(new.style_guide_file_id, old.style_guide_file_id)
  );
  if tg_op = 'UPDATE' and old.style_guide_file_id is distinct from new.style_guide_file_id then
    perform public.refresh_style_guide_file_tag_cache(old.style_guide_file_id);
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_refresh_style_guide_file_tag_cache
  on public.style_guide_file_tags;
create trigger trg_refresh_style_guide_file_tag_cache
after insert or update or delete on public.style_guide_file_tags
for each row execute function public.trg_refresh_style_guide_file_tag_cache();

create or replace function public.style_guide_tag_input_fingerprint(
  p_relative_path text,
  p_filename text,
  p_file_extension text,
  p_size_bytes bigint,
  p_modified_at timestamptz
)
returns text
language sql
immutable
parallel safe
as $$
  select md5(concat_ws(
    E'\x1f',
    coalesce(p_relative_path, ''),
    coalesce(p_filename, ''),
    coalesce(p_file_extension, ''),
    coalesce(p_size_bytes::text, ''),
    coalesce(p_modified_at::text, '')
  ));
$$;

create or replace function public.trg_queue_style_guide_deterministic_tags()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_fingerprint text;
begin
  v_fingerprint := public.style_guide_tag_input_fingerprint(
    new.relative_path,
    new.filename,
    new.file_extension,
    new.size_bytes,
    new.modified_at
  );

  insert into public.style_guide_tagging_state (
    style_guide_file_id,
    pipeline,
    status,
    input_fingerprint,
    updated_at
  )
  values (
    new.id,
    'deterministic',
    case when new.is_active then 'pending' else 'completed' end,
    v_fingerprint,
    now()
  )
  on conflict (style_guide_file_id, pipeline) do update
  set status = case
        when excluded.input_fingerprint is distinct from public.style_guide_tagging_state.input_fingerprint
          and new.is_active then 'pending'
        when not new.is_active then 'completed'
        else public.style_guide_tagging_state.status
      end,
      input_fingerprint = excluded.input_fingerprint,
      error_code = case
        when excluded.input_fingerprint is distinct from public.style_guide_tagging_state.input_fingerprint
          then null
        else public.style_guide_tagging_state.error_code
      end,
      error_detail = case
        when excluded.input_fingerprint is distinct from public.style_guide_tagging_state.input_fingerprint
          then null
        else public.style_guide_tagging_state.error_detail
      end,
      attempt_count = case
        when excluded.input_fingerprint is distinct from public.style_guide_tagging_state.input_fingerprint
          then 0
        else public.style_guide_tagging_state.attempt_count
      end,
      completed_at = case
        when excluded.input_fingerprint is distinct from public.style_guide_tagging_state.input_fingerprint
          then null
        else public.style_guide_tagging_state.completed_at
      end,
      updated_at = now();

  return new;
end;
$$;

drop trigger if exists trg_queue_style_guide_deterministic_tags
  on public.style_guide_files;
create trigger trg_queue_style_guide_deterministic_tags
after insert or update of relative_path, filename, file_extension, size_bytes, modified_at, is_active
on public.style_guide_files
for each row execute function public.trg_queue_style_guide_deterministic_tags();

insert into public.style_guide_tagging_state (
  style_guide_file_id,
  pipeline,
  status,
  input_fingerprint
)
select
  f.id,
  'deterministic',
  case when f.is_active then 'pending' else 'completed' end,
  public.style_guide_tag_input_fingerprint(
    f.relative_path,
    f.filename,
    f.file_extension,
    f.size_bytes,
    f.modified_at
  )
from public.style_guide_files f
on conflict (style_guide_file_id, pipeline) do nothing;

create or replace view public.style_guide_file_tags_display
with (security_invoker = true)
as
select
  ft.style_guide_file_id,
  t.id as tag_id,
  t.tag,
  t.display_name,
  t.facet,
  max(ft.confidence) filter (where ft.status = 'accepted') as confidence,
  bool_or(ft.source = 'manual' and ft.status = 'accepted') as manual,
  bool_or(ft.confirmed_at is not null and ft.status = 'accepted') as confirmed,
  jsonb_agg(
    jsonb_build_object(
      'id', ft.id,
      'source', ft.source,
      'inherited', ft.inherited,
      'status', ft.status,
      'confidence', ft.confidence,
      'evidence', ft.evidence,
      'rule_version', ft.rule_version,
      'created_by', ft.created_by
    )
    order by ft.confidence desc, ft.source
  ) as sources
from public.style_guide_file_tags ft
join public.style_guide_tags t on t.id = ft.tag_id
where t.is_active
group by ft.style_guide_file_id, t.id, t.tag, t.display_name, t.facet
having bool_or(ft.status = 'accepted');

create or replace function public.add_style_guide_manual_tag(
  p_file_id uuid,
  p_tag text,
  p_facet text default 'other'
)
returns table (
  tag_id uuid,
  tag text,
  display_name text,
  facet text
)
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_user_id uuid := auth.uid();
  v_normalized text;
  v_tag_id uuid;
  v_display text;
  v_facet text;
begin
  if v_user_id is null
     or not public.has_app_access(_user_id => v_user_id, _app => 'styleguides') then
    raise exception 'PopSG access required' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.style_guide_files f
    where f.id = p_file_id and f.is_active
  ) then
    raise exception 'Active style guide file not found' using errcode = 'P0002';
  end if;

  v_normalized := public.normalize_style_guide_tag(p_tag);
  if v_normalized = '' then
    raise exception 'Tag cannot be blank' using errcode = '22023';
  end if;

  v_facet := case
    when p_facet in (
      'licensor', 'property', 'character', 'collection', 'season', 'year',
      'occasion', 'product', 'application', 'asset_type', 'theme', 'style',
      'color', 'material_finish', 'audience', 'language', 'workflow', 'other'
    ) then p_facet
    else 'other'
  end;
  v_display := initcap(v_normalized);

  insert into public.style_guide_tags (
    tag,
    normalized_tag,
    facet,
    display_name,
    is_system
  )
  values (v_normalized, v_normalized, v_facet, v_display, false)
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
    rule_version,
    created_by,
    confirmed_by,
    confirmed_at
  )
  values (
    p_file_id,
    v_tag_id,
    'manual',
    v_facet,
    1,
    'accepted',
    jsonb_build_object('entered_tag', p_tag),
    false,
    'manual-v1',
    v_user_id,
    v_user_id,
    now()
  )
  on conflict (style_guide_file_id, tag_id, source, rule_version) do update
  set status = 'accepted',
      facet = excluded.facet,
      evidence = excluded.evidence,
      confirmed_by = excluded.confirmed_by,
      confirmed_at = excluded.confirmed_at,
      updated_at = now();

  return query
  select t.id, t.tag, t.display_name, t.facet
  from public.style_guide_tags t
  where t.id = v_tag_id;
end;
$$;

create or replace function public.remove_style_guide_manual_tag(
  p_file_id uuid,
  p_tag_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_user_id uuid := auth.uid();
  v_deleted_count integer;
begin
  if v_user_id is null
     or not public.has_app_access(_user_id => v_user_id, _app => 'styleguides') then
    raise exception 'PopSG access required' using errcode = '42501';
  end if;

  delete from public.style_guide_file_tags
  where style_guide_file_id = p_file_id
    and tag_id = p_tag_id
    and source = 'manual'
    and created_by = v_user_id;

  get diagnostics v_deleted_count = row_count;
  return v_deleted_count > 0;
end;
$$;

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
     or not public.has_app_access(_user_id => v_user_id, _app => 'styleguides') then
    raise exception 'PopSG access required' using errcode = '42501';
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

create or replace function public.get_style_guide_deterministic_tag_batch(
  p_after_id uuid default null,
  p_limit integer default 200,
  p_rebuild boolean default false
)
returns table (
  id uuid,
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

create or replace function public.replace_style_guide_deterministic_tags(
  p_file_id uuid,
  p_tags jsonb,
  p_input_fingerprint text,
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
  v_source text;
  v_facet text;
  v_count integer := 0;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;

  if not jsonb_typeof(coalesce(p_tags, '[]'::jsonb)) = 'array' then
    raise exception 'p_tags must be a JSON array' using errcode = '22023';
  end if;

  update public.style_guide_tagging_state
  set status = 'running',
      attempt_count = attempt_count + 1,
      started_at = now(),
      error_code = null,
      error_detail = null,
      updated_at = now()
  where style_guide_file_id = p_file_id
    and pipeline = 'deterministic';

  delete from public.style_guide_file_tags
  where style_guide_file_id = p_file_id
    and source in ('path', 'filename', 'folder_consensus')
    and status <> 'rejected';

  for v_item in select value from jsonb_array_elements(coalesce(p_tags, '[]'::jsonb))
  loop
    v_normalized := public.normalize_style_guide_tag(v_item->>'tag');
    if v_normalized = '' then
      continue;
    end if;

    v_source := case
      when v_item->>'source' in ('path', 'filename', 'folder_consensus')
        then v_item->>'source'
      else 'path'
    end;
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
      v_source,
      v_facet,
      least(greatest(coalesce((v_item->>'confidence')::numeric, 0.8), 0), 1),
      'accepted',
      coalesce(v_item->'evidence', '{}'::jsonb),
      coalesce((v_item->>'inherited')::boolean, false),
      p_rule_version
    )
    on conflict (style_guide_file_id, tag_id, source, rule_version) do update
    set facet = excluded.facet,
        confidence = excluded.confidence,
        evidence = excluded.evidence,
        inherited = excluded.inherited,
        updated_at = now();

    v_count := v_count + 1;
  end loop;

  insert into public.style_guide_tagging_state (
    style_guide_file_id,
    pipeline,
    status,
    input_fingerprint,
    rule_version,
    candidate_count,
    accepted_count,
    attempt_count,
    completed_at,
    updated_at
  )
  values (
    p_file_id,
    'deterministic',
    'completed',
    p_input_fingerprint,
    p_rule_version,
    jsonb_array_length(coalesce(p_tags, '[]'::jsonb)),
    v_count,
    1,
    now(),
    now()
  )
  on conflict (style_guide_file_id, pipeline) do update
  set status = 'completed',
      input_fingerprint = excluded.input_fingerprint,
      rule_version = excluded.rule_version,
      candidate_count = excluded.candidate_count,
      accepted_count = excluded.accepted_count,
      completed_at = now(),
      error_code = null,
      error_detail = null,
      updated_at = now();

  return v_count;
exception
  when others then
    update public.style_guide_tagging_state
    set status = 'failed',
        attempt_count = attempt_count + 1,
        error_code = sqlstate,
        error_detail = left(sqlerrm, 1000),
        updated_at = now()
    where style_guide_file_id = p_file_id
      and pipeline = 'deterministic';
    raise;
end;
$$;

create or replace function public.get_style_guide_tagging_stats()
returns jsonb
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_user_id uuid := auth.uid();
  v_result jsonb;
begin
  if v_user_id is null
     or not public.has_app_access(_user_id => v_user_id, _app => 'styleguides') then
    raise exception 'PopSG access required' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'active_files', count(*) filter (where f.is_active),
    'pending', count(*) filter (where f.is_active and s.status = 'pending'),
    'running', count(*) filter (where f.is_active and s.status = 'running'),
    'completed', count(*) filter (where f.is_active and s.status = 'completed'),
    'failed', count(*) filter (where f.is_active and s.status = 'failed'),
    'with_tags', count(*) filter (where f.is_active and cardinality(f.tag_names) > 0),
    'without_tags', count(*) filter (
      where f.is_active and s.status = 'completed' and cardinality(f.tag_names) = 0
    ),
    'rule_version', max(s.rule_version),
    'last_completed_at', max(s.completed_at)
  )
  into v_result
  from public.style_guide_files f
  left join public.style_guide_tagging_state s
    on s.style_guide_file_id = f.id
   and s.pipeline = 'deterministic';

  return v_result;
end;
$$;

alter table public.style_guide_tags enable row level security;
alter table public.style_guide_tag_aliases enable row level security;
alter table public.style_guide_file_tags enable row level security;
alter table public.style_guide_tagging_state enable row level security;

drop policy if exists style_guide_tags_read on public.style_guide_tags;
create policy style_guide_tags_read
on public.style_guide_tags for select to authenticated
using (public.has_app_access(_user_id => auth.uid(), _app => 'styleguides'));

drop policy if exists style_guide_tag_aliases_read on public.style_guide_tag_aliases;
create policy style_guide_tag_aliases_read
on public.style_guide_tag_aliases for select to authenticated
using (public.has_app_access(_user_id => auth.uid(), _app => 'styleguides'));

drop policy if exists style_guide_file_tags_read on public.style_guide_file_tags;
create policy style_guide_file_tags_read
on public.style_guide_file_tags for select to authenticated
using (public.has_app_access(_user_id => auth.uid(), _app => 'styleguides'));

drop policy if exists style_guide_tagging_state_read on public.style_guide_tagging_state;
create policy style_guide_tagging_state_read
on public.style_guide_tagging_state for select to authenticated
using (public.has_app_access(_user_id => auth.uid(), _app => 'styleguides'));

revoke all on public.style_guide_tags from anon, authenticated;
revoke all on public.style_guide_tag_aliases from anon, authenticated;
revoke all on public.style_guide_file_tags from anon, authenticated;
revoke all on public.style_guide_tagging_state from anon, authenticated;

grant select on public.style_guide_tags to authenticated, service_role;
grant select on public.style_guide_tag_aliases to authenticated, service_role;
grant select on public.style_guide_file_tags to authenticated, service_role;
grant select on public.style_guide_tagging_state to authenticated, service_role;
grant all on public.style_guide_tags to service_role;
grant all on public.style_guide_tag_aliases to service_role;
grant all on public.style_guide_file_tags to service_role;
grant all on public.style_guide_tagging_state to service_role;

revoke all on function public.add_style_guide_manual_tag(uuid, text, text) from public;
revoke all on function public.remove_style_guide_manual_tag(uuid, uuid) from public;
revoke all on function public.reject_style_guide_auto_tag(uuid, uuid) from public;
revoke all on function public.get_style_guide_deterministic_tag_batch(uuid, integer, boolean) from public;
revoke all on function public.replace_style_guide_deterministic_tags(uuid, jsonb, text, text) from public;
revoke all on function public.get_style_guide_tagging_stats() from public;

grant execute on function public.add_style_guide_manual_tag(uuid, text, text)
  to authenticated, service_role;
grant execute on function public.remove_style_guide_manual_tag(uuid, uuid)
  to authenticated, service_role;
grant execute on function public.reject_style_guide_auto_tag(uuid, uuid)
  to authenticated, service_role;
grant execute on function public.get_style_guide_deterministic_tag_batch(uuid, integer, boolean)
  to service_role;
grant execute on function public.replace_style_guide_deterministic_tags(uuid, jsonb, text, text)
  to service_role;
grant execute on function public.get_style_guide_tagging_stats()
  to authenticated, service_role;

grant select on public.style_guide_file_tags_display to authenticated, service_role;

comment on table public.style_guide_file_tags is
  'Provenance-aware PopSG file tags. Automatic rebuilds preserve manual and rejected relationships.';
comment on column public.style_guide_files.tag_names is
  'Database-maintained cache of accepted canonical PopSG tags. Do not write from application code.';
comment on column public.style_guide_files.tag_search_text is
  'Database-maintained accepted-tag search text used by PopSG PostgREST ILIKE queries.';
