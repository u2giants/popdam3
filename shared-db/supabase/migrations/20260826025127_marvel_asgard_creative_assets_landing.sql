-- Marvel ASGARD Creative Assets private landing schema.
-- Issue #1567; claim #1573. Schema only: no licensed values or source rows.
-- ASGARD labels remain source vocabulary. Nothing here fuzzy-matches or promotes them
-- into Disney OPA identities. The prior mixed DCP guide is not an accepted source.

create table plm.marvel_asgard_capture (
  capture_key uuid primary key,
  source_system text not null default 'marvel_asgard'
    check (source_system = 'marvel_asgard'),
  source_url text not null check (btrim(source_url) <> ''),
  account_scope_descriptor text not null check (btrim(account_scope_descriptor) <> ''),
  scraper_version text not null check (btrim(scraper_version) <> ''),
  source_snapshot_sha256 text not null check (source_snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  source_captured_at timestamptz not null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  status text not null default 'loading'
    check (status in ('loading','complete','rejected','aborted')),
  expected_counts jsonb not null check (jsonb_typeof(expected_counts) = 'object'),
  observed_counts jsonb not null default '{}'::jsonb check (jsonb_typeof(observed_counts) = 'object'),
  is_complete boolean not null default false,
  is_current boolean not null default false,
  error_summary jsonb not null default '[]'::jsonb check (jsonb_typeof(error_summary) = 'array'),
  raw_summary jsonb not null default '{}'::jsonb check (jsonb_typeof(raw_summary) = 'object'),
  constraint marvel_asgard_capture_completion_chk check (
    (status = 'complete' and is_complete and completed_at is not null)
    or (status <> 'complete' and not is_complete and not is_current)
  )
);

create unique index marvel_asgard_one_current_capture_idx
  on plm.marvel_asgard_capture (source_system) where is_current;

create table plm.marvel_asgard_guide_category (
  id uuid primary key default gen_random_uuid(),
  source_identity_key text not null unique check (btrim(source_identity_key) <> ''),
  source_category_key text,
  exact_label text not null check (btrim(exact_label) <> ''),
  display_order integer not null check (display_order >= 0),
  observed_meaning text,
  first_seen_capture_key uuid not null references plm.marvel_asgard_capture(capture_key),
  last_seen_capture_key uuid not null references plm.marvel_asgard_capture(capture_key),
  is_actively_observed boolean not null default false,
  raw_source jsonb not null check (jsonb_typeof(raw_source) = 'object')
);
create unique index marvel_asgard_category_source_key_uidx
  on plm.marvel_asgard_guide_category (source_category_key)
  where source_category_key is not null;

create table plm.marvel_asgard_style_guide (
  id uuid primary key default gen_random_uuid(),
  source_identity_key text not null unique check (btrim(source_identity_key) <> ''),
  source_guide_key text,
  category_id uuid not null references plm.marvel_asgard_guide_category(id),
  exact_label text not null check (btrim(exact_label) <> ''),
  display_order integer not null check (display_order >= 0),
  first_seen_capture_key uuid not null references plm.marvel_asgard_capture(capture_key),
  last_seen_capture_key uuid not null references plm.marvel_asgard_capture(capture_key),
  is_actively_observed boolean not null default false,
  raw_source jsonb not null check (jsonb_typeof(raw_source) = 'object')
);
create unique index marvel_asgard_guide_source_key_uidx
  on plm.marvel_asgard_style_guide (source_guide_key)
  where source_guide_key is not null;

create table plm.marvel_asgard_guide_node (
  id uuid primary key default gen_random_uuid(),
  source_identity_key text not null unique check (btrim(source_identity_key) <> ''),
  source_node_key text,
  style_guide_id uuid not null references plm.marvel_asgard_style_guide(id),
  parent_node_id uuid,
  depth smallint not null check (depth between 1 and 12),
  exact_label text not null check (btrim(exact_label) <> ''),
  display_order integer not null check (display_order >= 0),
  materialized_source_path text not null check (btrim(materialized_source_path) <> ''),
  first_seen_capture_key uuid not null references plm.marvel_asgard_capture(capture_key),
  last_seen_capture_key uuid not null references plm.marvel_asgard_capture(capture_key),
  is_actively_observed boolean not null default false,
  raw_source jsonb not null check (jsonb_typeof(raw_source) = 'object'),
  unique (id, style_guide_id),
  foreign key (parent_node_id, style_guide_id)
    references plm.marvel_asgard_guide_node(id, style_guide_id)
    deferrable initially deferred
);
create unique index marvel_asgard_node_source_key_uidx
  on plm.marvel_asgard_guide_node (style_guide_id, source_node_key)
  where source_node_key is not null;

create table plm.marvel_asgard_asset (
  id uuid primary key default gen_random_uuid(),
  source_identity_key text not null unique check (btrim(source_identity_key) <> ''),
  style_guide_asset_id text,
  asset_id text,
  original_file_id text,
  exact_filename text not null check (btrim(exact_filename) <> ''),
  file_extension text,
  file_size_bytes bigint check (file_size_bytes is null or file_size_bytes >= 0),
  display_order integer check (display_order is null or display_order >= 0),
  first_seen_capture_key uuid not null references plm.marvel_asgard_capture(capture_key),
  last_seen_capture_key uuid not null references plm.marvel_asgard_capture(capture_key),
  is_actively_observed boolean not null default false,
  raw_source jsonb not null check (jsonb_typeof(raw_source) = 'object'),
  constraint marvel_asgard_asset_has_source_id_chk check (
    num_nonnulls(style_guide_asset_id, asset_id, original_file_id) >= 1)
);
create unique index marvel_asgard_asset_style_guide_asset_uidx
  on plm.marvel_asgard_asset (style_guide_asset_id) where style_guide_asset_id is not null;
create unique index marvel_asgard_asset_asset_id_uidx
  on plm.marvel_asgard_asset (asset_id) where asset_id is not null;
create unique index marvel_asgard_asset_original_file_uidx
  on plm.marvel_asgard_asset (original_file_id) where original_file_id is not null;

create table plm.marvel_asgard_character (
  id uuid primary key default gen_random_uuid(),
  source_identity_key text not null unique check (btrim(source_identity_key) <> ''),
  source_character_key text,
  exact_label text not null check (btrim(exact_label) <> ''),
  normalized_search_label text not null check (btrim(normalized_search_label) <> ''),
  first_seen_capture_key uuid not null references plm.marvel_asgard_capture(capture_key),
  last_seen_capture_key uuid not null references plm.marvel_asgard_capture(capture_key),
  is_actively_observed boolean not null default false,
  raw_source jsonb not null check (jsonb_typeof(raw_source) = 'object')
);
create unique index marvel_asgard_character_source_key_uidx
  on plm.marvel_asgard_character (source_character_key)
  where source_character_key is not null;

create table plm.marvel_asgard_term (
  id uuid primary key default gen_random_uuid(),
  source_identity_key text not null unique check (btrim(source_identity_key) <> ''),
  term_kind text not null check (term_kind in (
    'character_action','artwork_type','image_coloration','descriptive_keyword','iteration'
  )),
  source_term_key text,
  exact_value text not null check (btrim(exact_value) <> ''),
  normalized_search_value text not null check (btrim(normalized_search_value) <> ''),
  first_seen_capture_key uuid not null references plm.marvel_asgard_capture(capture_key),
  last_seen_capture_key uuid not null references plm.marvel_asgard_capture(capture_key),
  is_actively_observed boolean not null default false,
  raw_source jsonb not null check (jsonb_typeof(raw_source) = 'object'),
  unique (id, term_kind)
);
create unique index marvel_asgard_term_source_key_uidx
  on plm.marvel_asgard_term (term_kind, source_term_key)
  where source_term_key is not null;

create table plm.marvel_asgard_capture_checkpoint (
  capture_key uuid not null references plm.marvel_asgard_capture(capture_key),
  style_guide_id uuid not null references plm.marvel_asgard_style_guide(id),
  guide_node_id uuid not null references plm.marvel_asgard_guide_node(id),
  page_number integer not null check (page_number >= 1),
  page_size integer not null check (page_size >= 1),
  expected_page_count integer not null check (expected_page_count >= 1 and page_number <= expected_page_count),
  expected_asset_count integer not null check (expected_asset_count >= 0 and expected_asset_count <= page_size),
  observed_asset_count integer not null default 0 check (observed_asset_count >= 0),
  request_sha256 text not null check (request_sha256 ~ '^[0-9a-f]{64}$'),
  result_sha256 text check (result_sha256 is null or result_sha256 ~ '^[0-9a-f]{64}$'),
  status text not null check (status in ('pending','complete','failed')),
  first_attempted_at timestamptz not null default now(),
  last_attempted_at timestamptz not null default now(),
  error_class text,
  primary key (capture_key, guide_node_id, page_number),
  foreign key (guide_node_id, style_guide_id)
    references plm.marvel_asgard_guide_node(id, style_guide_id)
);

create table plm.marvel_asgard_capture_gap (
  id bigint generated always as identity primary key,
  capture_key uuid not null references plm.marvel_asgard_capture(capture_key),
  object_class text not null check (btrim(object_class) <> ''),
  source_key_or_path text not null check (btrim(source_key_or_path) <> ''),
  gap_reason text not null check (btrim(gap_reason) <> ''),
  is_blocking boolean not null default true,
  first_observed_at timestamptz not null default now(),
  last_observed_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique (capture_key, object_class, source_key_or_path, gap_reason)
);

create table plm.marvel_asgard_node_asset_observation (
  capture_key uuid not null,
  guide_node_id uuid not null,
  page_number integer not null,
  asset_id uuid not null references plm.marvel_asgard_asset(id),
  source_display_order integer check (source_display_order is null or source_display_order >= 0),
  raw_observation_sha256 text not null check (raw_observation_sha256 ~ '^[0-9a-f]{64}$'),
  primary key (capture_key, guide_node_id, asset_id),
  foreign key (capture_key, guide_node_id, page_number)
    references plm.marvel_asgard_capture_checkpoint(capture_key, guide_node_id, page_number)
);

create table plm.marvel_asgard_asset_character_observation (
  capture_key uuid not null references plm.marvel_asgard_capture(capture_key),
  asset_id uuid not null references plm.marvel_asgard_asset(id),
  character_id uuid not null references plm.marvel_asgard_character(id),
  raw_observation jsonb not null check (jsonb_typeof(raw_observation) = 'object'),
  primary key (capture_key, asset_id, character_id)
);

create table plm.marvel_asgard_asset_term_observation (
  capture_key uuid not null references plm.marvel_asgard_capture(capture_key),
  asset_id uuid not null references plm.marvel_asgard_asset(id),
  term_id uuid not null,
  term_kind text not null,
  raw_combined_value text,
  raw_observation jsonb not null check (jsonb_typeof(raw_observation) = 'object'),
  primary key (capture_key, asset_id, term_id),
  foreign key (term_id, term_kind) references plm.marvel_asgard_term(id, term_kind),
  constraint marvel_asgard_combined_keyword_only_chk check (
    raw_combined_value is null or term_kind = 'descriptive_keyword'
  )
);

create table plm.marvel_asgard_asset_likeness_observation (
  capture_key uuid not null references plm.marvel_asgard_capture(capture_key),
  asset_id uuid not null references plm.marvel_asgard_asset(id),
  source_value text,
  likeness_state text not null check (likeness_state in ('yes','no','unknown')),
  raw_observation jsonb not null check (jsonb_typeof(raw_observation) = 'object'),
  primary key (capture_key, asset_id)
);

create table plm.marvel_asgard_character_opa_resolution (
  id uuid primary key default gen_random_uuid(),
  asgard_character_id uuid not null references plm.marvel_asgard_character(id),
  opa_character_id bigint references plm.opa_character(character_id),
  status text not null check (status in ('unresolved','confirmed','rejected','superseded')),
  decision_authority text,
  decision_evidence text,
  decided_at timestamptz,
  supersedes_resolution_id uuid references plm.marvel_asgard_character_opa_resolution(id),
  constraint marvel_asgard_character_resolution_decision_chk check (
    (status = 'unresolved' and opa_character_id is null and decision_authority is null
      and decision_evidence is null and decided_at is null)
    or (status <> 'unresolved' and decision_authority is not null
      and btrim(decision_authority) <> '' and decision_evidence is not null
      and btrim(decision_evidence) <> '' and decided_at is not null)
  ),
  constraint marvel_asgard_character_confirmed_target_chk
    check (status <> 'confirmed' or opa_character_id is not null)
);
create unique index marvel_asgard_character_one_confirmed_opa_idx
  on plm.marvel_asgard_character_opa_resolution(asgard_character_id)
  where status = 'confirmed';

create table plm.marvel_asgard_guide_opa_property_resolution (
  id uuid primary key default gen_random_uuid(),
  asgard_style_guide_id uuid not null references plm.marvel_asgard_style_guide(id),
  opa_property_id bigint references plm.opa_property(licensed_property_id),
  status text not null check (status in ('unresolved','confirmed','rejected','superseded')),
  decision_authority text,
  decision_evidence text,
  decided_at timestamptz,
  supersedes_resolution_id uuid references plm.marvel_asgard_guide_opa_property_resolution(id),
  constraint marvel_asgard_guide_resolution_decision_chk check (
    (status = 'unresolved' and opa_property_id is null and decision_authority is null
      and decision_evidence is null and decided_at is null)
    or (status <> 'unresolved' and decision_authority is not null
      and btrim(decision_authority) <> '' and decision_evidence is not null
      and btrim(decision_evidence) <> '' and decided_at is not null)
  ),
  constraint marvel_asgard_guide_confirmed_target_chk
    check (status <> 'confirmed' or opa_property_id is not null)
);
create unique index marvel_asgard_guide_one_confirmed_opa_idx
  on plm.marvel_asgard_guide_opa_property_resolution(asgard_style_guide_id)
  where status = 'confirmed';

create or replace function plm.begin_marvel_asgard_capture(
  p_capture_key uuid,
  p_expected_source_system text,
  p_source_url text,
  p_account_scope_descriptor text,
  p_scraper_version text,
  p_source_snapshot_sha256 text,
  p_source_captured_at timestamptz,
  p_expected_counts jsonb,
  p_raw_summary jsonb default '{}'::jsonb
) returns uuid
language plpgsql security definer set search_path = plm, pg_temp
as $$
declare v_existing plm.marvel_asgard_capture%rowtype;
begin
  if p_capture_key is null then raise exception 'begin_marvel_asgard_capture: capture_key is required'; end if;
  if p_expected_source_system is distinct from 'marvel_asgard' then
    raise exception 'begin_marvel_asgard_capture: expected source must be marvel_asgard';
  end if;
  if p_source_url is null or btrim(p_source_url) = '' then raise exception 'begin_marvel_asgard_capture: source_url is required'; end if;
  if p_account_scope_descriptor is null or btrim(p_account_scope_descriptor) = '' then raise exception 'begin_marvel_asgard_capture: account scope is required'; end if;
  if p_scraper_version is null or btrim(p_scraper_version) = '' then raise exception 'begin_marvel_asgard_capture: scraper_version is required'; end if;
  if p_source_snapshot_sha256 is null or p_source_snapshot_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'begin_marvel_asgard_capture: invalid source snapshot hash'; end if;
  if p_source_captured_at is null then raise exception 'begin_marvel_asgard_capture: source_captured_at is required'; end if;
  if p_expected_counts is null or jsonb_typeof(p_expected_counts) <> 'object' or p_expected_counts = '{}'::jsonb then raise exception 'begin_marvel_asgard_capture: expected_counts must be a non-empty object'; end if;
  if exists (select 1 from jsonb_each(p_expected_counts) e where jsonb_typeof(e.value) <> 'number') then raise exception 'begin_marvel_asgard_capture: expected counts must be numeric'; end if;
  if exists (select 1 from jsonb_each(p_expected_counts) e where (e.value #>> '{}')::numeric < 0 or (e.value #>> '{}')::numeric <> trunc((e.value #>> '{}')::numeric)) then raise exception 'begin_marvel_asgard_capture: expected counts must be non-negative integers'; end if;
  if p_raw_summary is null or jsonb_typeof(p_raw_summary) <> 'object' then raise exception 'begin_marvel_asgard_capture: raw_summary must be an object'; end if;
  perform pg_advisory_xact_lock(hashtextextended('plm.marvel_asgard_capture:' || p_capture_key::text, 0));
  select * into v_existing from plm.marvel_asgard_capture where capture_key = p_capture_key;
  if found then
    if v_existing.source_system <> p_expected_source_system
       or v_existing.source_snapshot_sha256 <> p_source_snapshot_sha256
       or v_existing.source_captured_at <> p_source_captured_at
       or v_existing.account_scope_descriptor <> p_account_scope_descriptor then
      raise exception 'begin_marvel_asgard_capture: capture identity conflict for %', p_capture_key;
    end if;
    if v_existing.status in ('loading','complete') then return p_capture_key; end if;
    raise exception 'begin_marvel_asgard_capture: terminal capture key % may not be reused', p_capture_key;
  end if;
  insert into plm.marvel_asgard_capture(capture_key,source_system,source_url,account_scope_descriptor,scraper_version,source_snapshot_sha256,source_captured_at,expected_counts,raw_summary)
  values(p_capture_key,p_expected_source_system,p_source_url,p_account_scope_descriptor,p_scraper_version,p_source_snapshot_sha256,p_source_captured_at,p_expected_counts,p_raw_summary);
  return p_capture_key;
end $$;

create or replace function plm.load_marvel_asgard_chunk(
  p_capture_key uuid,
  p_expected_source_system text,
  p_chunk_key text,
  p_payload jsonb
) returns jsonb
language plpgsql security definer set search_path = plm, pg_temp
as $$
declare v_cap plm.marvel_asgard_capture%rowtype; v_result jsonb := '{}'::jsonb;
begin
  if p_expected_source_system is distinct from 'marvel_asgard' then raise exception 'load_marvel_asgard_chunk: expected source must be marvel_asgard'; end if;
  if p_chunk_key is null or btrim(p_chunk_key) = '' then raise exception 'load_marvel_asgard_chunk: chunk_key is required'; end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then raise exception 'load_marvel_asgard_chunk: payload must be an object'; end if;
  select * into v_cap from plm.marvel_asgard_capture where capture_key=p_capture_key for update;
  if not found or v_cap.source_system <> p_expected_source_system then raise exception 'load_marvel_asgard_chunk: capture/source mismatch'; end if;
  if v_cap.status <> 'loading' then raise exception 'load_marvel_asgard_chunk: capture % is not loading', p_capture_key; end if;
  -- Reject payload fields that could retain media access or user identity. Source URL is
  -- capture-level evidence and is deliberately not accepted inside a chunk.
  if jsonb_path_exists(p_payload, 'lax $.** ? (@.type() == "object").keyvalue() ? (@.key like_regex "^(preview(_?url)?|download(_?url)?|signed_?url|thumbnail_?url|url|href|token|access_?token|refresh_?token|account_?id|user_?id|email)$" flag "i")') then
    raise exception 'load_marvel_asgard_chunk: forbidden media-access or account-identity field';
  end if;

  insert into plm.marvel_asgard_guide_category(source_identity_key,source_category_key,exact_label,display_order,observed_meaning,first_seen_capture_key,last_seen_capture_key,raw_source)
  select x.source_identity_key,x.source_category_key,x.exact_label,x.display_order,x.observed_meaning,p_capture_key,p_capture_key,coalesce(x.raw_source,'{}')
  from jsonb_to_recordset(coalesce(p_payload->'categories','[]')) as x(source_identity_key text,source_category_key text,exact_label text,display_order integer,observed_meaning text,raw_source jsonb)
  on conflict(source_identity_key) do update set last_seen_capture_key=p_capture_key,exact_label=excluded.exact_label,display_order=excluded.display_order,observed_meaning=excluded.observed_meaning,raw_source=excluded.raw_source
  where plm.marvel_asgard_guide_category.source_category_key is not distinct from excluded.source_category_key;
  if exists (select 1 from jsonb_to_recordset(coalesce(p_payload->'categories','[]')) x(source_identity_key text,source_category_key text) join plm.marvel_asgard_guide_category t using(source_identity_key) where t.source_category_key is distinct from x.source_category_key) then raise exception 'load_marvel_asgard_chunk: category identifier conflict'; end if;

  if exists (
    select 1
    from jsonb_to_recordset(coalesce(p_payload->'style_guides','[]'))
      x(category_identity_key text)
    left join plm.marvel_asgard_guide_category c
      on c.source_identity_key=x.category_identity_key
    where c.id is null
  ) then raise exception 'load_marvel_asgard_chunk: unresolved style-guide category key'; end if;

  insert into plm.marvel_asgard_style_guide(source_identity_key,source_guide_key,category_id,exact_label,display_order,first_seen_capture_key,last_seen_capture_key,raw_source)
  select x.source_identity_key,x.source_guide_key,c.id,x.exact_label,x.display_order,p_capture_key,p_capture_key,coalesce(x.raw_source,'{}')
  from jsonb_to_recordset(coalesce(p_payload->'style_guides','[]')) x(source_identity_key text,source_guide_key text,category_identity_key text,exact_label text,display_order integer,raw_source jsonb)
  join plm.marvel_asgard_guide_category c on c.source_identity_key=x.category_identity_key
  on conflict(source_identity_key) do update set last_seen_capture_key=p_capture_key,category_id=excluded.category_id,exact_label=excluded.exact_label,display_order=excluded.display_order,raw_source=excluded.raw_source
  where plm.marvel_asgard_style_guide.source_guide_key is not distinct from excluded.source_guide_key;
  if exists (select 1 from jsonb_to_recordset(coalesce(p_payload->'style_guides','[]')) x(source_identity_key text,source_guide_key text) join plm.marvel_asgard_style_guide t using(source_identity_key) where t.source_guide_key is distinct from x.source_guide_key) then raise exception 'load_marvel_asgard_chunk: guide identifier conflict'; end if;

  if exists (
    select 1
    from jsonb_to_recordset(coalesce(p_payload->'guide_nodes','[]'))
      x(style_guide_identity_key text)
    left join plm.marvel_asgard_style_guide g
      on g.source_identity_key=x.style_guide_identity_key
    where g.id is null
  ) then raise exception 'load_marvel_asgard_chunk: unresolved node style-guide key'; end if;

  -- Pass 1 creates every node identity without guessing a missing parent to be a root.
  -- Pass 2 below links parents after same-chunk parent rows are visible.
  insert into plm.marvel_asgard_guide_node(source_identity_key,source_node_key,style_guide_id,parent_node_id,depth,exact_label,display_order,materialized_source_path,first_seen_capture_key,last_seen_capture_key,raw_source)
  select x.source_identity_key,x.source_node_key,g.id,null,x.depth,x.exact_label,x.display_order,x.materialized_source_path,p_capture_key,p_capture_key,coalesce(x.raw_source,'{}')
  from jsonb_to_recordset(coalesce(p_payload->'guide_nodes','[]')) x(source_identity_key text,source_node_key text,style_guide_identity_key text,parent_node_identity_key text,depth smallint,exact_label text,display_order integer,materialized_source_path text,raw_source jsonb)
  join plm.marvel_asgard_style_guide g on g.source_identity_key=x.style_guide_identity_key
  on conflict(source_identity_key) do update set last_seen_capture_key=p_capture_key,depth=excluded.depth,exact_label=excluded.exact_label,display_order=excluded.display_order,materialized_source_path=excluded.materialized_source_path,raw_source=excluded.raw_source
  where plm.marvel_asgard_guide_node.source_node_key is not distinct from excluded.source_node_key and plm.marvel_asgard_guide_node.style_guide_id=excluded.style_guide_id;
  if exists (
    select 1
    from jsonb_to_recordset(coalesce(p_payload->'guide_nodes','[]'))
      x(source_identity_key text,source_node_key text,style_guide_identity_key text)
    join plm.marvel_asgard_guide_node t using(source_identity_key)
    join plm.marvel_asgard_style_guide g
      on g.source_identity_key=x.style_guide_identity_key
    where t.source_node_key is distinct from x.source_node_key
       or t.style_guide_id<>g.id
  ) then raise exception 'load_marvel_asgard_chunk: node identifier conflict'; end if;
  if exists (
    select 1
    from jsonb_to_recordset(coalesce(p_payload->'guide_nodes','[]'))
      x(style_guide_identity_key text,parent_node_identity_key text)
    join plm.marvel_asgard_style_guide g
      on g.source_identity_key=x.style_guide_identity_key
    left join plm.marvel_asgard_guide_node p
      on p.source_identity_key=x.parent_node_identity_key
     and p.style_guide_id=g.id
    where x.parent_node_identity_key is not null and p.id is null
  ) then raise exception 'load_marvel_asgard_chunk: unresolved or cross-guide parent node key'; end if;
  with incoming as (
    select x.source_identity_key,p.id parent_node_id
    from jsonb_to_recordset(coalesce(p_payload->'guide_nodes','[]'))
      x(source_identity_key text,style_guide_identity_key text,parent_node_identity_key text)
    join plm.marvel_asgard_style_guide g
      on g.source_identity_key=x.style_guide_identity_key
    left join plm.marvel_asgard_guide_node p
      on p.source_identity_key=x.parent_node_identity_key
     and p.style_guide_id=g.id
  )
  update plm.marvel_asgard_guide_node n
     set parent_node_id=incoming.parent_node_id
    from incoming
   where n.source_identity_key=incoming.source_identity_key;

  insert into plm.marvel_asgard_asset(source_identity_key,style_guide_asset_id,asset_id,original_file_id,exact_filename,file_extension,file_size_bytes,display_order,first_seen_capture_key,last_seen_capture_key,raw_source)
  select x.source_identity_key,x.style_guide_asset_id,x.asset_id,x.original_file_id,x.exact_filename,x.file_extension,x.file_size_bytes,x.display_order,p_capture_key,p_capture_key,coalesce(x.raw_source,'{}')
  from jsonb_to_recordset(coalesce(p_payload->'assets','[]')) x(source_identity_key text,style_guide_asset_id text,asset_id text,original_file_id text,exact_filename text,file_extension text,file_size_bytes bigint,display_order integer,raw_source jsonb)
  on conflict(source_identity_key) do update set last_seen_capture_key=p_capture_key,exact_filename=excluded.exact_filename,file_extension=excluded.file_extension,file_size_bytes=excluded.file_size_bytes,display_order=excluded.display_order,raw_source=excluded.raw_source
  where plm.marvel_asgard_asset.style_guide_asset_id is not distinct from excluded.style_guide_asset_id and plm.marvel_asgard_asset.asset_id is not distinct from excluded.asset_id and plm.marvel_asgard_asset.original_file_id is not distinct from excluded.original_file_id;
  if exists (select 1 from jsonb_to_recordset(coalesce(p_payload->'assets','[]')) x(source_identity_key text,style_guide_asset_id text,asset_id text,original_file_id text) join plm.marvel_asgard_asset t using(source_identity_key) where t.style_guide_asset_id is distinct from x.style_guide_asset_id or t.asset_id is distinct from x.asset_id or t.original_file_id is distinct from x.original_file_id) then raise exception 'load_marvel_asgard_chunk: asset identifier conflict'; end if;

  insert into plm.marvel_asgard_character(source_identity_key,source_character_key,exact_label,normalized_search_label,first_seen_capture_key,last_seen_capture_key,raw_source)
  select x.source_identity_key,x.source_character_key,x.exact_label,x.normalized_search_label,p_capture_key,p_capture_key,coalesce(x.raw_source,'{}')
  from jsonb_to_recordset(coalesce(p_payload->'characters','[]')) x(source_identity_key text,source_character_key text,exact_label text,normalized_search_label text,raw_source jsonb)
  on conflict(source_identity_key) do update set last_seen_capture_key=p_capture_key,exact_label=excluded.exact_label,normalized_search_label=excluded.normalized_search_label,raw_source=excluded.raw_source
  where plm.marvel_asgard_character.source_character_key is not distinct from excluded.source_character_key;
  if exists (select 1 from jsonb_to_recordset(coalesce(p_payload->'characters','[]')) x(source_identity_key text,source_character_key text) join plm.marvel_asgard_character t using(source_identity_key) where t.source_character_key is distinct from x.source_character_key) then raise exception 'load_marvel_asgard_chunk: character identifier conflict'; end if;

  insert into plm.marvel_asgard_term(source_identity_key,term_kind,source_term_key,exact_value,normalized_search_value,first_seen_capture_key,last_seen_capture_key,raw_source)
  select x.source_identity_key,x.term_kind,x.source_term_key,x.exact_value,x.normalized_search_value,p_capture_key,p_capture_key,coalesce(x.raw_source,'{}')
  from jsonb_to_recordset(coalesce(p_payload->'terms','[]')) x(source_identity_key text,term_kind text,source_term_key text,exact_value text,normalized_search_value text,raw_source jsonb)
  on conflict(source_identity_key) do update set last_seen_capture_key=p_capture_key,exact_value=excluded.exact_value,normalized_search_value=excluded.normalized_search_value,raw_source=excluded.raw_source
  where plm.marvel_asgard_term.term_kind=excluded.term_kind and plm.marvel_asgard_term.source_term_key is not distinct from excluded.source_term_key;
  if exists (select 1 from jsonb_to_recordset(coalesce(p_payload->'terms','[]')) x(source_identity_key text,term_kind text,source_term_key text) join plm.marvel_asgard_term t using(source_identity_key) where t.term_kind<>x.term_kind or t.source_term_key is distinct from x.source_term_key) then raise exception 'load_marvel_asgard_chunk: term identifier conflict'; end if;

  if exists (
    select 1
    from jsonb_to_recordset(coalesce(p_payload->'checkpoints','[]'))
      x(style_guide_identity_key text,guide_node_identity_key text)
    left join plm.marvel_asgard_style_guide g
      on g.source_identity_key=x.style_guide_identity_key
    left join plm.marvel_asgard_guide_node n
      on n.source_identity_key=x.guide_node_identity_key
     and n.style_guide_id=g.id
    where g.id is null or n.id is null
  ) then raise exception 'load_marvel_asgard_chunk: unresolved checkpoint guide or node key'; end if;

  insert into plm.marvel_asgard_capture_checkpoint(capture_key,style_guide_id,guide_node_id,page_number,page_size,expected_page_count,expected_asset_count,observed_asset_count,request_sha256,result_sha256,status,first_attempted_at,last_attempted_at,error_class)
  select p_capture_key,g.id,n.id,x.page_number,x.page_size,x.expected_page_count,x.expected_asset_count,x.observed_asset_count,x.request_sha256,x.result_sha256,x.status,coalesce(x.first_attempted_at,now()),coalesce(x.last_attempted_at,now()),x.error_class
  from jsonb_to_recordset(coalesce(p_payload->'checkpoints','[]')) x(style_guide_identity_key text,guide_node_identity_key text,page_number integer,page_size integer,expected_page_count integer,expected_asset_count integer,observed_asset_count integer,request_sha256 text,result_sha256 text,status text,first_attempted_at timestamptz,last_attempted_at timestamptz,error_class text)
  join plm.marvel_asgard_style_guide g on g.source_identity_key=x.style_guide_identity_key
  join plm.marvel_asgard_guide_node n on n.source_identity_key=x.guide_node_identity_key and n.style_guide_id=g.id
  on conflict(capture_key,guide_node_id,page_number) do update set page_size=excluded.page_size,expected_page_count=excluded.expected_page_count,expected_asset_count=excluded.expected_asset_count,observed_asset_count=excluded.observed_asset_count,request_sha256=excluded.request_sha256,result_sha256=excluded.result_sha256,status=excluded.status,last_attempted_at=excluded.last_attempted_at,error_class=excluded.error_class;

  insert into plm.marvel_asgard_capture_gap(capture_key,object_class,source_key_or_path,gap_reason,is_blocking,first_observed_at,last_observed_at,resolved_at)
  select p_capture_key,x.object_class,x.source_key_or_path,x.gap_reason,coalesce(x.is_blocking,true),coalesce(x.first_observed_at,now()),coalesce(x.last_observed_at,now()),x.resolved_at
  from jsonb_to_recordset(coalesce(p_payload->'gaps','[]')) x(object_class text,source_key_or_path text,gap_reason text,is_blocking boolean,first_observed_at timestamptz,last_observed_at timestamptz,resolved_at timestamptz)
  on conflict(capture_key,object_class,source_key_or_path,gap_reason) do update set is_blocking=excluded.is_blocking,last_observed_at=excluded.last_observed_at,resolved_at=excluded.resolved_at;

  if exists (
    select 1
    from jsonb_to_recordset(coalesce(p_payload->'node_assets','[]'))
      x(guide_node_identity_key text,page_number integer,asset_identity_key text)
    left join plm.marvel_asgard_guide_node n
      on n.source_identity_key=x.guide_node_identity_key
    left join plm.marvel_asgard_asset a
      on a.source_identity_key=x.asset_identity_key
    left join plm.marvel_asgard_capture_checkpoint c
      on c.capture_key=p_capture_key and c.guide_node_id=n.id
     and c.page_number=x.page_number
    where n.id is null or a.id is null or c.capture_key is null
  ) then raise exception 'load_marvel_asgard_chunk: unresolved node-asset key or checkpoint'; end if;

  insert into plm.marvel_asgard_node_asset_observation(capture_key,guide_node_id,page_number,asset_id,source_display_order,raw_observation_sha256)
  select p_capture_key,n.id,x.page_number,a.id,x.source_display_order,x.raw_observation_sha256
  from jsonb_to_recordset(coalesce(p_payload->'node_assets','[]')) x(guide_node_identity_key text,page_number integer,asset_identity_key text,source_display_order integer,raw_observation_sha256 text)
  join plm.marvel_asgard_guide_node n on n.source_identity_key=x.guide_node_identity_key
  join plm.marvel_asgard_asset a on a.source_identity_key=x.asset_identity_key
  on conflict(capture_key,guide_node_id,asset_id) do nothing;
  if exists (
    select 1
    from jsonb_to_recordset(coalesce(p_payload->'node_assets','[]'))
      x(guide_node_identity_key text,page_number integer,asset_identity_key text,source_display_order integer,raw_observation_sha256 text)
    join plm.marvel_asgard_guide_node n on n.source_identity_key=x.guide_node_identity_key
    join plm.marvel_asgard_asset a on a.source_identity_key=x.asset_identity_key
    join plm.marvel_asgard_node_asset_observation o
      on o.capture_key=p_capture_key and o.guide_node_id=n.id and o.asset_id=a.id
    where o.page_number is distinct from x.page_number
       or o.source_display_order is distinct from x.source_display_order
       or o.raw_observation_sha256 is distinct from x.raw_observation_sha256
  ) then raise exception 'load_marvel_asgard_chunk: node-asset replay conflict'; end if;

  if exists (
    select 1
    from jsonb_to_recordset(coalesce(p_payload->'asset_characters','[]'))
      x(asset_identity_key text,character_identity_key text)
    left join plm.marvel_asgard_asset a on a.source_identity_key=x.asset_identity_key
    left join plm.marvel_asgard_character c on c.source_identity_key=x.character_identity_key
    where a.id is null or c.id is null
  ) then raise exception 'load_marvel_asgard_chunk: unresolved asset-character key'; end if;

  insert into plm.marvel_asgard_asset_character_observation(capture_key,asset_id,character_id,raw_observation)
  select p_capture_key,a.id,c.id,coalesce(x.raw_observation,'{}')
  from jsonb_to_recordset(coalesce(p_payload->'asset_characters','[]')) x(asset_identity_key text,character_identity_key text,raw_observation jsonb)
  join plm.marvel_asgard_asset a on a.source_identity_key=x.asset_identity_key
  join plm.marvel_asgard_character c on c.source_identity_key=x.character_identity_key
  on conflict(capture_key,asset_id,character_id) do nothing;
  if exists (
    select 1
    from jsonb_to_recordset(coalesce(p_payload->'asset_characters','[]'))
      x(asset_identity_key text,character_identity_key text,raw_observation jsonb)
    join plm.marvel_asgard_asset a on a.source_identity_key=x.asset_identity_key
    join plm.marvel_asgard_character c on c.source_identity_key=x.character_identity_key
    join plm.marvel_asgard_asset_character_observation o
      on o.capture_key=p_capture_key and o.asset_id=a.id and o.character_id=c.id
    where o.raw_observation is distinct from coalesce(x.raw_observation,'{}')
  ) then raise exception 'load_marvel_asgard_chunk: asset-character replay conflict'; end if;

  if exists (
    select 1
    from jsonb_to_recordset(coalesce(p_payload->'asset_terms','[]'))
      x(asset_identity_key text,term_identity_key text)
    left join plm.marvel_asgard_asset a on a.source_identity_key=x.asset_identity_key
    left join plm.marvel_asgard_term t on t.source_identity_key=x.term_identity_key
    where a.id is null or t.id is null
  ) then raise exception 'load_marvel_asgard_chunk: unresolved asset-term key'; end if;

  insert into plm.marvel_asgard_asset_term_observation(capture_key,asset_id,term_id,term_kind,raw_combined_value,raw_observation)
  select p_capture_key,a.id,t.id,t.term_kind,x.raw_combined_value,coalesce(x.raw_observation,'{}')
  from jsonb_to_recordset(coalesce(p_payload->'asset_terms','[]')) x(asset_identity_key text,term_identity_key text,raw_combined_value text,raw_observation jsonb)
  join plm.marvel_asgard_asset a on a.source_identity_key=x.asset_identity_key
  join plm.marvel_asgard_term t on t.source_identity_key=x.term_identity_key
  on conflict(capture_key,asset_id,term_id) do nothing;
  if exists (
    select 1
    from jsonb_to_recordset(coalesce(p_payload->'asset_terms','[]'))
      x(asset_identity_key text,term_identity_key text,raw_combined_value text,raw_observation jsonb)
    join plm.marvel_asgard_asset a on a.source_identity_key=x.asset_identity_key
    join plm.marvel_asgard_term t on t.source_identity_key=x.term_identity_key
    join plm.marvel_asgard_asset_term_observation o
      on o.capture_key=p_capture_key and o.asset_id=a.id and o.term_id=t.id
    where o.raw_combined_value is distinct from x.raw_combined_value
       or o.raw_observation is distinct from coalesce(x.raw_observation,'{}')
  ) then raise exception 'load_marvel_asgard_chunk: asset-term replay conflict'; end if;

  if exists (
    select 1
    from jsonb_to_recordset(coalesce(p_payload->'asset_likeness','[]'))
      x(asset_identity_key text)
    left join plm.marvel_asgard_asset a on a.source_identity_key=x.asset_identity_key
    where a.id is null
  ) then raise exception 'load_marvel_asgard_chunk: unresolved asset-likeness key'; end if;

  insert into plm.marvel_asgard_asset_likeness_observation(capture_key,asset_id,source_value,likeness_state,raw_observation)
  select p_capture_key,a.id,x.source_value,x.likeness_state,coalesce(x.raw_observation,'{}')
  from jsonb_to_recordset(coalesce(p_payload->'asset_likeness','[]')) x(asset_identity_key text,source_value text,likeness_state text,raw_observation jsonb)
  join plm.marvel_asgard_asset a on a.source_identity_key=x.asset_identity_key
  on conflict(capture_key,asset_id) do nothing;
  if exists (
    select 1
    from jsonb_to_recordset(coalesce(p_payload->'asset_likeness','[]'))
      x(asset_identity_key text,source_value text,likeness_state text,raw_observation jsonb)
    join plm.marvel_asgard_asset a on a.source_identity_key=x.asset_identity_key
    join plm.marvel_asgard_asset_likeness_observation o
      on o.capture_key=p_capture_key and o.asset_id=a.id
    where o.source_value is distinct from x.source_value
       or o.likeness_state is distinct from x.likeness_state
       or o.raw_observation is distinct from coalesce(x.raw_observation,'{}')
  ) then raise exception 'load_marvel_asgard_chunk: asset-likeness replay conflict'; end if;

  v_result := jsonb_build_object('capture_key',p_capture_key,'chunk_key',p_chunk_key,'accepted',true);
  return v_result;
end $$;

create or replace function plm.finalize_marvel_asgard_capture(
  p_capture_key uuid,
  p_expected_source_system text
) returns jsonb
language plpgsql security definer set search_path = plm, pg_temp
as $$
declare v_cap plm.marvel_asgard_capture%rowtype; v_obs jsonb; v_errors jsonb := '[]'::jsonb; v_k text; v_n bigint; v_expected numeric;
begin
  if p_expected_source_system is distinct from 'marvel_asgard' then raise exception 'finalize_marvel_asgard_capture: expected source must be marvel_asgard'; end if;
  select * into v_cap from plm.marvel_asgard_capture where capture_key=p_capture_key for update;
  if not found or v_cap.source_system<>p_expected_source_system then raise exception 'finalize_marvel_asgard_capture: capture/source mismatch'; end if;
  if v_cap.status='complete' then return jsonb_build_object('capture_key',p_capture_key,'status','complete','idempotent',true); end if;
  if v_cap.status<>'loading' then raise exception 'finalize_marvel_asgard_capture: capture is terminal (%)',v_cap.status; end if;
  v_obs := jsonb_build_object(
    'categories',(select count(*) from plm.marvel_asgard_guide_category where last_seen_capture_key=p_capture_key),
    'guides',(select count(*) from plm.marvel_asgard_style_guide where last_seen_capture_key=p_capture_key),
    'nodes',(select count(*) from plm.marvel_asgard_guide_node where last_seen_capture_key=p_capture_key),
    'pages',(select count(*) from plm.marvel_asgard_capture_checkpoint where capture_key=p_capture_key),
    'assets',(select count(*) from plm.marvel_asgard_asset where last_seen_capture_key=p_capture_key),
    'node_assets',(select count(*) from plm.marvel_asgard_node_asset_observation where capture_key=p_capture_key),
    'characters',(select count(*) from plm.marvel_asgard_character where last_seen_capture_key=p_capture_key),
    'asset_characters',(select count(*) from plm.marvel_asgard_asset_character_observation where capture_key=p_capture_key),
    'terms',(select count(*) from plm.marvel_asgard_term where last_seen_capture_key=p_capture_key),
    'asset_terms',(select count(*) from plm.marvel_asgard_asset_term_observation where capture_key=p_capture_key),
    'asset_likeness',(select count(*) from plm.marvel_asgard_asset_likeness_observation where capture_key=p_capture_key)
  );
  foreach v_k in array array['categories','guides','nodes','pages','assets','node_assets','characters','asset_characters','terms','asset_terms','asset_likeness'] loop
    if not (v_cap.expected_counts ? v_k) or jsonb_typeof(v_cap.expected_counts->v_k)<>'number' then
      v_errors:=v_errors||jsonb_build_object('code','expected_count_missing_or_invalid','entity',v_k);
    else v_expected:=(v_cap.expected_counts->>v_k)::numeric; if v_expected<>(v_obs->>v_k)::numeric then v_errors:=v_errors||jsonb_build_object('code','count_mismatch','entity',v_k,'expected',v_expected,'observed',(v_obs->>v_k)::bigint); end if; end if;
  end loop;
  select count(*) into v_n from plm.marvel_asgard_capture_checkpoint where capture_key=p_capture_key and (status<>'complete' or result_sha256 is null or observed_asset_count<>expected_asset_count);
  if v_n>0 then v_errors:=v_errors||jsonb_build_object('code','checkpoint_incomplete_or_mismatched','count',v_n); end if;
  select count(*) into v_n from (
    select guide_node_id from plm.marvel_asgard_capture_checkpoint where capture_key=p_capture_key
    group by guide_node_id having min(page_number)<>1 or max(page_number)<>count(*) or min(expected_page_count)<>max(expected_page_count) or max(expected_page_count)<>count(*)
  ) q;
  if v_n>0 then v_errors:=v_errors||jsonb_build_object('code','page_sequence_gap','node_count',v_n); end if;
  select count(*) into v_n from plm.marvel_asgard_capture_gap where capture_key=p_capture_key and is_blocking and resolved_at is null;
  if v_n>0 then v_errors:=v_errors||jsonb_build_object('code','blocking_gaps','count',v_n); end if;
  select count(*) into v_n from plm.marvel_asgard_capture_checkpoint c where c.capture_key=p_capture_key and c.observed_asset_count<>(select count(*) from plm.marvel_asgard_node_asset_observation o where o.capture_key=c.capture_key and o.guide_node_id=c.guide_node_id and o.page_number=c.page_number);
  if v_n>0 then v_errors:=v_errors||jsonb_build_object('code','page_asset_reconciliation_failed','count',v_n); end if;
  select count(*) into v_n
  from plm.marvel_asgard_asset_term_observation o
  cross join lateral regexp_split_to_table(o.raw_combined_value, E'\\|') component
  where o.capture_key=p_capture_key and o.term_kind='descriptive_keyword'
    and o.raw_combined_value is not null
    and not exists (
      select 1 from plm.marvel_asgard_asset_term_observation sibling
      join plm.marvel_asgard_term term on term.id=sibling.term_id
      where sibling.capture_key=o.capture_key and sibling.asset_id=o.asset_id
        and sibling.term_kind='descriptive_keyword'
        and term.exact_value=btrim(component)
    );
  if v_n>0 then v_errors:=v_errors||jsonb_build_object('code','descriptive_keyword_component_missing','count',v_n); end if;
  with recursive tree as (
    select n.id,n.parent_node_id,n.depth,1 actual_depth,array[n.id] path,false cycle from plm.marvel_asgard_guide_node n where n.last_seen_capture_key=p_capture_key and n.parent_node_id is null
    union all select n.id,n.parent_node_id,n.depth,t.actual_depth+1,t.path||n.id,n.id=any(t.path) from plm.marvel_asgard_guide_node n join tree t on n.parent_node_id=t.id where n.last_seen_capture_key=p_capture_key and not t.cycle
  ) select count(*) into v_n from plm.marvel_asgard_guide_node n left join tree t on t.id=n.id where n.last_seen_capture_key=p_capture_key and (t.id is null or t.cycle or t.actual_depth<>n.depth or t.actual_depth>12);
  if v_n>0 then v_errors:=v_errors||jsonb_build_object('code','guide_hierarchy_invalid','count',v_n); end if;
  if jsonb_array_length(v_errors)>0 then
    update plm.marvel_asgard_capture set status='rejected',completed_at=now(),observed_counts=v_obs,error_summary=v_errors,is_complete=false,is_current=false where capture_key=p_capture_key;
    return jsonb_build_object('capture_key',p_capture_key,'status','rejected','errors',v_errors);
  end if;
  update plm.marvel_asgard_capture set is_current=false where source_system='marvel_asgard' and is_current;
  update plm.marvel_asgard_capture set status='complete',completed_at=now(),observed_counts=v_obs,error_summary='[]',is_complete=true,is_current=true where capture_key=p_capture_key;
  update plm.marvel_asgard_guide_category set is_actively_observed=(last_seen_capture_key=p_capture_key);
  update plm.marvel_asgard_style_guide set is_actively_observed=(last_seen_capture_key=p_capture_key);
  update plm.marvel_asgard_guide_node set is_actively_observed=(last_seen_capture_key=p_capture_key);
  update plm.marvel_asgard_asset set is_actively_observed=(last_seen_capture_key=p_capture_key);
  update plm.marvel_asgard_character set is_actively_observed=(last_seen_capture_key=p_capture_key);
  update plm.marvel_asgard_term set is_actively_observed=(last_seen_capture_key=p_capture_key);
  return jsonb_build_object('capture_key',p_capture_key,'status','complete','observed_counts',v_obs);
end $$;

create or replace function plm.abort_marvel_asgard_capture(
  p_capture_key uuid,
  p_expected_source_system text,
  p_error_summary jsonb
) returns void
language plpgsql security definer set search_path = plm, pg_temp
as $$
declare v_status text;
begin
  if p_expected_source_system is distinct from 'marvel_asgard' then raise exception 'abort_marvel_asgard_capture: expected source must be marvel_asgard'; end if;
  if p_error_summary is null or jsonb_typeof(p_error_summary)<>'array' or jsonb_array_length(p_error_summary)=0 then raise exception 'abort_marvel_asgard_capture: non-empty error summary required'; end if;
  select status into v_status from plm.marvel_asgard_capture where capture_key=p_capture_key for update;
  if not found then raise exception 'abort_marvel_asgard_capture: capture not found'; end if;
  if v_status='aborted' then return; end if;
  if v_status<>'loading' then raise exception 'abort_marvel_asgard_capture: capture is terminal (%)',v_status; end if;
  update plm.marvel_asgard_capture set status='aborted',completed_at=now(),error_summary=p_error_summary,is_complete=false,is_current=false where capture_key=p_capture_key;
end $$;

alter table plm.marvel_asgard_capture enable row level security;
alter table plm.marvel_asgard_capture_checkpoint enable row level security;
alter table plm.marvel_asgard_capture_gap enable row level security;
alter table plm.marvel_asgard_guide_category enable row level security;
alter table plm.marvel_asgard_style_guide enable row level security;
alter table plm.marvel_asgard_guide_node enable row level security;
alter table plm.marvel_asgard_asset enable row level security;
alter table plm.marvel_asgard_node_asset_observation enable row level security;
alter table plm.marvel_asgard_character enable row level security;
alter table plm.marvel_asgard_asset_character_observation enable row level security;
alter table plm.marvel_asgard_term enable row level security;
alter table plm.marvel_asgard_asset_term_observation enable row level security;
alter table plm.marvel_asgard_asset_likeness_observation enable row level security;
alter table plm.marvel_asgard_character_opa_resolution enable row level security;
alter table plm.marvel_asgard_guide_opa_property_resolution enable row level security;

revoke all on plm.marvel_asgard_capture,plm.marvel_asgard_capture_checkpoint,plm.marvel_asgard_capture_gap,plm.marvel_asgard_guide_category,plm.marvel_asgard_style_guide,plm.marvel_asgard_guide_node,plm.marvel_asgard_asset,plm.marvel_asgard_node_asset_observation,plm.marvel_asgard_character,plm.marvel_asgard_asset_character_observation,plm.marvel_asgard_term,plm.marvel_asgard_asset_term_observation,plm.marvel_asgard_asset_likeness_observation,plm.marvel_asgard_character_opa_resolution,plm.marvel_asgard_guide_opa_property_resolution from public,anon,authenticated,service_role;
grant select on plm.marvel_asgard_capture,plm.marvel_asgard_capture_checkpoint,plm.marvel_asgard_capture_gap,plm.marvel_asgard_guide_category,plm.marvel_asgard_style_guide,plm.marvel_asgard_guide_node,plm.marvel_asgard_asset,plm.marvel_asgard_node_asset_observation,plm.marvel_asgard_character,plm.marvel_asgard_asset_character_observation,plm.marvel_asgard_term,plm.marvel_asgard_asset_term_observation,plm.marvel_asgard_asset_likeness_observation,plm.marvel_asgard_character_opa_resolution,plm.marvel_asgard_guide_opa_property_resolution to service_role;
grant usage,select on sequence plm.marvel_asgard_capture_gap_id_seq to service_role;

revoke all on function plm.begin_marvel_asgard_capture(uuid,text,text,text,text,text,timestamptz,jsonb,jsonb) from public,anon,authenticated;
revoke all on function plm.load_marvel_asgard_chunk(uuid,text,text,jsonb) from public,anon,authenticated;
revoke all on function plm.finalize_marvel_asgard_capture(uuid,text) from public,anon,authenticated;
revoke all on function plm.abort_marvel_asgard_capture(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function plm.begin_marvel_asgard_capture(uuid,text,text,text,text,text,timestamptz,jsonb,jsonb) to service_role;
grant execute on function plm.load_marvel_asgard_chunk(uuid,text,text,jsonb) to service_role;
grant execute on function plm.finalize_marvel_asgard_capture(uuid,text) to service_role;
grant execute on function plm.abort_marvel_asgard_capture(uuid,text,jsonb) to service_role;

comment on table plm.marvel_asgard_asset is 'Private ASGARD Creative Asset identity. Filenames are evidence, never identity; no media bytes or access URLs are stored.';
comment on table plm.marvel_asgard_character_opa_resolution is 'Explicit human-reviewed ASGARD-to-OPA Character decisions. Labels never populate this table automatically.';
comment on table plm.marvel_asgard_guide_opa_property_resolution is 'Explicit human-reviewed ASGARD-guide-to-OPA Property decisions. Absence is normal and no asset relationship is implied.';
