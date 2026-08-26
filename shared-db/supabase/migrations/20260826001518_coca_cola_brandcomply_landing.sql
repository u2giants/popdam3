-- Coca-Cola BrandComply private landing schema.
-- Issue #1464; claim #1554; reserved version 20260826001518.
--
-- SCHEMA ONLY. This public migration contains no licensed values or fixtures.
-- Exact strings and raw JSON arrive only at runtime from u2giants/licensor-source-data.
-- Nothing in this landing promotes source labels into canonical core.* Master Data.

create table plm.coke_capture (
  id uuid primary key,
  capture_key text not null unique check (btrim(capture_key) <> ''),
  source_repository text not null check (btrim(source_repository) <> ''),
  source_commit_sha text not null check (source_commit_sha ~ '^[0-9a-f]{40}$'),
  source_manifest_sha256 text not null check (source_manifest_sha256 ~ '^[0-9a-f]{64}$'),
  portal_base_url text not null check (btrim(portal_base_url) <> ''),
  account_scope text not null check (btrim(account_scope) <> ''),
  source_captured_at timestamptz not null,
  load_started_at timestamptz not null default now(),
  load_completed_at timestamptz,
  status text not null default 'loading'
    check (status in ('loading','complete','rejected','abandoned')),
  expected_counts jsonb not null check (jsonb_typeof(expected_counts) = 'object'),
  observed_counts jsonb not null default '{}'::jsonb
    check (jsonb_typeof(observed_counts) = 'object'),
  approval_index_complete boolean not null default false,
  asset_index_complete boolean not null default false,
  asset_details_complete boolean not null default false,
  media_downloaded integer not null default 0 check (media_downloaded = 0),
  raw_summary jsonb not null check (jsonb_typeof(raw_summary) = 'object'),
  errors jsonb not null default '[]'::jsonb check (jsonb_typeof(errors) = 'array'),
  created_by text not null check (btrim(created_by) <> ''),
  constraint coke_capture_complete_time_chk
    check ((status = 'complete') = (load_completed_at is not null)),
  constraint coke_capture_complete_requirements_chk check (
    status <> 'complete' or (
      approval_index_complete and asset_index_complete and media_downloaded = 0
      and jsonb_array_length(errors) = 0
    )
  )
);

create table plm.coke_approval_item (
  capture_id uuid not null references plm.coke_capture(id),
  approval_route_id text not null check (btrim(approval_route_id) <> ''),
  item_id text not null check (btrim(item_id) <> ''),
  item_type text, title text, company_label text, submitted_text text,
  last_action_text text, view_count integer check (view_count is null or view_count >= 0),
  version_count integer check (version_count is null or version_count >= 0),
  status text, current_stage text, source_url text, preview_path text,
  raw jsonb not null check (jsonb_typeof(raw) = 'object'),
  primary key (capture_id, approval_route_id)
);
create index coke_approval_item_item_idx on plm.coke_approval_item(capture_id,item_id);

create table plm.coke_approval_metadata_value (
  capture_id uuid not null,
  approval_route_id text not null,
  ordinal integer not null check (ordinal >= 0),
  field_key text not null check (btrim(field_key) <> ''),
  field_value text, source_href text, value_key text,
  raw jsonb not null check (jsonb_typeof(raw) = 'object'),
  primary key (capture_id,approval_route_id,ordinal),
  foreign key (capture_id,approval_route_id)
    references plm.coke_approval_item(capture_id,approval_route_id)
);
create index coke_approval_metadata_field_idx
  on plm.coke_approval_metadata_value(capture_id,field_key);
create index coke_approval_metadata_value_idx
  on plm.coke_approval_metadata_value(capture_id,value_key);

create table plm.coke_approval_related_item (
  capture_id uuid not null,
  approval_route_id text not null,
  ordinal integer not null check (ordinal >= 0),
  related_label text, related_href text, related_route_id text,
  relationship_truth text not null default 'direct_source'
    check (relationship_truth = 'direct_source'),
  raw jsonb not null check (jsonb_typeof(raw) = 'object'),
  primary key (capture_id,approval_route_id,ordinal),
  foreign key (capture_id,approval_route_id)
    references plm.coke_approval_item(capture_id,approval_route_id)
);

create table plm.coke_approval_stage_snapshot (
  capture_id uuid not null,
  approval_route_id text not null,
  stage_ordinal integer not null check (stage_ordinal >= 0),
  stage_label text, stage_status text, stage_date_text text,
  view_count integer check (view_count is null or view_count >= 0),
  version_count integer check (version_count is null or version_count >= 0),
  raw jsonb not null check (jsonb_typeof(raw) = 'object'),
  primary key (capture_id,approval_route_id,stage_ordinal),
  foreign key (capture_id,approval_route_id)
    references plm.coke_approval_item(capture_id,approval_route_id)
);

create table plm.coke_approval_comment (
  capture_id uuid not null,
  approval_route_id text not null,
  comment_source_key text not null check (btrim(comment_source_key) <> ''),
  author_label text, posted_at_text text, visibility_label text, body text,
  source_sequence integer check (source_sequence is null or source_sequence >= 0),
  identity_method text not null default 'exact-content-sha256'
    check (identity_method = 'exact-content-sha256'),
  raw jsonb not null check (jsonb_typeof(raw) = 'object'),
  primary key (capture_id,approval_route_id,comment_source_key),
  foreign key (capture_id,approval_route_id)
    references plm.coke_approval_item(capture_id,approval_route_id)
);

create table plm.coke_vocabulary_value (
  capture_id uuid not null references plm.coke_capture(id),
  vocabulary_kind text not null check (btrim(vocabulary_kind) <> ''),
  value_key text not null check (btrim(value_key) <> ''),
  source_id text, exact_label text not null,
  parent_value_key text, identity_method text not null,
  source_field text not null,
  canonical_schema text, canonical_table text, canonical_id uuid,
  resolution_status text not null default 'unresolved'
    check (resolution_status in ('unresolved','resolved','ambiguous','not_applicable')),
  raw jsonb not null check (jsonb_typeof(raw) = 'object'),
  primary key (capture_id,vocabulary_kind,value_key),
  foreign key (capture_id,vocabulary_kind,parent_value_key)
    references plm.coke_vocabulary_value(capture_id,vocabulary_kind,value_key)
    deferrable initially deferred,
  constraint coke_vocabulary_resolution_chk check (
    (resolution_status = 'resolved') = (canonical_id is not null)
    and ((canonical_id is null and canonical_schema is null and canonical_table is null)
      or (canonical_id is not null and canonical_schema is not null and canonical_table is not null))
  )
);

create table plm.coke_approval_vocabulary_value (
  capture_id uuid not null,
  approval_route_id text not null,
  field_key text not null,
  ordinal integer not null check (ordinal >= 0),
  vocabulary_kind text not null,
  value_key text not null,
  relationship_truth text not null default 'direct_source'
    check (relationship_truth = 'direct_source'),
  raw jsonb not null check (jsonb_typeof(raw) = 'object'),
  primary key (capture_id,approval_route_id,field_key,ordinal),
  foreign key (capture_id,approval_route_id)
    references plm.coke_approval_item(capture_id,approval_route_id),
  foreign key (capture_id,vocabulary_kind,value_key)
    references plm.coke_vocabulary_value(capture_id,vocabulary_kind,value_key)
);

create table plm.coke_manufacturer_profile (
  capture_id uuid not null,
  approval_route_id text not null,
  legal_name text, address_line_1 text, address_line_2 text, city text,
  region text, postal_code text, country text, contact_name text,
  contact_email text, contact_phone text, website text,
  commencement_text text, expiration_text text, annual_cost_response text,
  subcontractor_response text, licensed_products_text text, comments text,
  raw jsonb not null check (jsonb_typeof(raw) = 'object'),
  primary key (capture_id,approval_route_id),
  foreign key (capture_id,approval_route_id)
    references plm.coke_approval_item(capture_id,approval_route_id)
);

create table plm.coke_asset_property_option (
  capture_id uuid not null references plm.coke_capture(id),
  option_key text not null check (btrim(option_key) <> ''),
  source_value text, exact_label text not null,
  ordinal integer not null check (ordinal >= 0),
  source_field text not null,
  classification text,
  classification_status text not null default 'unreviewed'
    check (classification_status in ('unreviewed','reviewed','ambiguous')),
  raw jsonb not null check (jsonb_typeof(raw) = 'object'),
  primary key (capture_id,option_key)
);

create table plm.coke_asset (
  capture_id uuid not null references plm.coke_capture(id),
  asset_id text not null check (btrim(asset_id) <> ''),
  asset_name text, description text, file_type text, file_size_display text,
  file_size_bytes bigint check (file_size_bytes is null or file_size_bytes >= 0),
  uploaded_at_text text, uploaded_by_label text,
  page_number integer check (page_number is null or page_number > 0),
  thumbnail_path text, preview_path text, details_path text, download_path text,
  raw_tag_string text,
  raw jsonb not null check (jsonb_typeof(raw) = 'object'),
  primary key (capture_id,asset_id)
);

create table plm.coke_asset_detail_value (
  capture_id uuid not null,
  asset_id text not null,
  ordinal integer not null check (ordinal >= 0),
  field_key text not null check (btrim(field_key) <> ''),
  field_value text,
  raw jsonb not null check (jsonb_typeof(raw) = 'object'),
  primary key (capture_id,asset_id,ordinal),
  foreign key (capture_id,asset_id) references plm.coke_asset(capture_id,asset_id)
);

create table plm.coke_tag (
  capture_id uuid not null references plm.coke_capture(id),
  tag_key text not null check (btrim(tag_key) <> ''),
  exact_label text not null,
  identity_method text not null,
  raw jsonb not null check (jsonb_typeof(raw) = 'object'),
  primary key (capture_id,tag_key)
);

create table plm.coke_asset_tag (
  capture_id uuid not null,
  asset_id text not null,
  tag_key text not null,
  relationship_truth text not null default 'direct_source'
    check (relationship_truth = 'direct_source'),
  source_evidence text not null check (source_evidence = 'discrete_detail_field'),
  raw jsonb not null check (jsonb_typeof(raw) = 'object'),
  primary key (capture_id,asset_id,tag_key),
  foreign key (capture_id,asset_id) references plm.coke_asset(capture_id,asset_id),
  foreign key (capture_id,tag_key) references plm.coke_tag(capture_id,tag_key)
);

create table plm.coke_contract (
  capture_id uuid not null references plm.coke_capture(id),
  contract_id text not null check (btrim(contract_id) <> ''),
  start_date date, end_date date, expiration_display text, status text,
  source_path text,
  raw jsonb not null check (jsonb_typeof(raw) = 'object'),
  primary key (capture_id,contract_id)
);

create table plm.coke_sku (
  capture_id uuid not null references plm.coke_capture(id),
  sku_source_id text not null check (btrim(sku_source_id) <> ''),
  sku text, sku_title text, product_label text, primary_property_label text,
  property_list_raw text, approval_item_id text, source_label text,
  deactivation_date date, deactivation_reason text,
  raw jsonb not null check (jsonb_typeof(raw) = 'object'),
  primary key (capture_id,sku_source_id)
);
create index coke_sku_sku_idx on plm.coke_sku(capture_id,sku);
create index coke_sku_approval_item_idx on plm.coke_sku(capture_id,approval_item_id);

create table plm.coke_contract_manufacturer (
  capture_id uuid not null,
  contract_id text not null,
  manufacturer_id text not null check (btrim(manufacturer_id) <> ''),
  exact_name text not null, expiration_display text, status text, source_path text,
  raw jsonb not null check (jsonb_typeof(raw) = 'object'),
  primary key (capture_id,contract_id,manufacturer_id),
  foreign key (capture_id,contract_id) references plm.coke_contract(capture_id,contract_id)
);

create table plm.coke_royalty_report (
  capture_id uuid not null,
  report_source_key text not null check (btrim(report_source_key) <> ''),
  contract_id text not null,
  period_label text, royalty_amount_display text, royalty_amount numeric,
  currency_code text, status text, source_path text,
  raw jsonb not null check (jsonb_typeof(raw) = 'object'),
  primary key (capture_id,report_source_key),
  foreign key (capture_id,contract_id) references plm.coke_contract(capture_id,contract_id)
);

-- Bounded, idempotent loader. Each payload is a JSON array of objects. Capture creation
-- is the only entity that may run before the root exists; all other paths require a
-- loading capture and rely on declared foreign keys to reject orphan source rows.
create function plm.load_coke_capture_chunk(
  p_capture_id uuid,
  p_entity text,
  p_rows jsonb
) returns integer
language plpgsql security definer
set search_path = pg_catalog, plm
as $$
declare
  v_count integer := 0;
  v_rowcount integer := 0;
  r jsonb;
begin
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'load_coke_capture_chunk: rows must be an array';
  end if;
  if jsonb_array_length(p_rows) > 1000 then
    raise exception 'load_coke_capture_chunk: chunk exceeds 1000 rows';
  end if;
  if p_entity not in (
    'capture','approval_item','approval_metadata_value','approval_related_item',
    'approval_stage_snapshot','approval_comment','vocabulary_value',
    'approval_vocabulary_value','manufacturer_profile','asset_property_option',
    'asset','asset_detail_value','tag','asset_tag','contract','sku',
    'contract_manufacturer','royalty_report'
  ) then
    raise exception 'load_coke_capture_chunk: unsupported entity %',p_entity;
  end if;

  if p_entity = 'capture' then
    if jsonb_array_length(p_rows) <> 1 then
      raise exception 'load_coke_capture_chunk: capture requires exactly one row';
    end if;
    r := p_rows->0;
    if r->>'id' is null or (r->>'id')::uuid is distinct from p_capture_id then
      raise exception 'load_coke_capture_chunk: capture id mismatch';
    end if;
    insert into plm.coke_capture(
      id,capture_key,source_repository,source_commit_sha,source_manifest_sha256,
      portal_base_url,account_scope,source_captured_at,expected_counts,
      approval_index_complete,asset_index_complete,asset_details_complete,
      media_downloaded,raw_summary,created_by)
    values (p_capture_id,r->>'capture_key',r->>'source_repository',r->>'source_commit_sha',
      r->>'source_manifest_sha256',r->>'portal_base_url',r->>'account_scope',
      (r->>'source_captured_at')::timestamptz,r->'expected_counts',
      coalesce((r->>'approval_index_complete')::boolean,false),
      coalesce((r->>'asset_index_complete')::boolean,false),
      coalesce((r->>'asset_details_complete')::boolean,false),
      coalesce((r->>'media_downloaded')::integer,0),r->'raw_summary',r->>'created_by')
    on conflict (id) do nothing;
    get diagnostics v_count = row_count;
    if v_count = 0 then
      perform 1 from plm.coke_capture c where c.id=p_capture_id
        and c.capture_key=r->>'capture_key'
        and c.source_repository=r->>'source_repository'
        and c.source_commit_sha=r->>'source_commit_sha'
        and c.source_manifest_sha256=r->>'source_manifest_sha256'
        and c.portal_base_url=r->>'portal_base_url'
        and c.account_scope=r->>'account_scope'
        and c.source_captured_at=(r->>'source_captured_at')::timestamptz
        and c.expected_counts=r->'expected_counts'
        and c.approval_index_complete=coalesce((r->>'approval_index_complete')::boolean,false)
        and c.asset_index_complete=coalesce((r->>'asset_index_complete')::boolean,false)
        and c.asset_details_complete=coalesce((r->>'asset_details_complete')::boolean,false)
        and c.media_downloaded=coalesce((r->>'media_downloaded')::integer,0)
        and c.raw_summary=r->'raw_summary'
        and c.created_by=r->>'created_by';
      if not found then
        raise exception 'load_coke_capture_chunk: capture retry payload differs';
      end if;
    end if;
    return v_count;
  end if;

  -- The shared row lock serializes each loader transaction against finalization's
  -- FOR UPDATE lock. Once finalization starts, no chunk that observed `loading` can
  -- continue inserting behind its counts.
  perform 1 from plm.coke_capture where id=p_capture_id and status='loading' for share;
  if not found then
    raise exception 'load_coke_capture_chunk: capture is missing or not loading';
  end if;

  for r in select value from jsonb_array_elements(p_rows) loop
    if p_entity = 'approval_item' then
      insert into plm.coke_approval_item values (
        p_capture_id,r->>'approval_route_id',r->>'item_id',r->>'item_type',r->>'title',
        r->>'company_label',r->>'submitted_text',r->>'last_action_text',
        (r->>'view_count')::integer,(r->>'version_count')::integer,r->>'status',
        r->>'current_stage',r->>'source_url',r->>'preview_path',r->'raw')
      on conflict do nothing;
    elsif p_entity = 'approval_metadata_value' then
      insert into plm.coke_approval_metadata_value values (
        p_capture_id,r->>'approval_route_id',(r->>'ordinal')::integer,r->>'field_key',
        r->>'field_value',r->>'source_href',r->>'value_key',r->'raw') on conflict do nothing;
    elsif p_entity = 'approval_related_item' then
      insert into plm.coke_approval_related_item values (
        p_capture_id,r->>'approval_route_id',(r->>'ordinal')::integer,r->>'related_label',
        r->>'related_href',r->>'related_route_id','direct_source',r->'raw') on conflict do nothing;
    elsif p_entity = 'approval_stage_snapshot' then
      insert into plm.coke_approval_stage_snapshot values (
        p_capture_id,r->>'approval_route_id',(r->>'stage_ordinal')::integer,r->>'stage_label',
        r->>'stage_status',r->>'stage_date_text',(r->>'view_count')::integer,
        (r->>'version_count')::integer,r->'raw') on conflict do nothing;
    elsif p_entity = 'approval_comment' then
      insert into plm.coke_approval_comment values (
        p_capture_id,r->>'approval_route_id',r->>'comment_source_key',r->>'author_label',
        r->>'posted_at_text',r->>'visibility_label',r->>'body',
        (r->>'source_sequence')::integer,'exact-content-sha256',r->'raw') on conflict do nothing;
    elsif p_entity = 'vocabulary_value' then
      insert into plm.coke_vocabulary_value(
        capture_id,vocabulary_kind,value_key,source_id,exact_label,parent_value_key,
        identity_method,source_field,raw)
      values (p_capture_id,r->>'vocabulary_kind',r->>'value_key',r->>'source_id',
        r->>'exact_label',r->>'parent_value_key',r->>'identity_method',r->>'source_field',r->'raw')
      on conflict do nothing;
    elsif p_entity = 'approval_vocabulary_value' then
      insert into plm.coke_approval_vocabulary_value values (
        p_capture_id,r->>'approval_route_id',r->>'field_key',(r->>'ordinal')::integer,
        r->>'vocabulary_kind',r->>'value_key','direct_source',r->'raw') on conflict do nothing;
    elsif p_entity = 'manufacturer_profile' then
      insert into plm.coke_manufacturer_profile values (
        p_capture_id,r->>'approval_route_id',r->>'legal_name',r->>'address_line_1',
        r->>'address_line_2',r->>'city',r->>'region',r->>'postal_code',r->>'country',
        r->>'contact_name',r->>'contact_email',r->>'contact_phone',r->>'website',
        r->>'commencement_text',r->>'expiration_text',r->>'annual_cost_response',
        r->>'subcontractor_response',r->>'licensed_products_text',r->>'comments',r->'raw')
      on conflict do nothing;
    elsif p_entity = 'asset_property_option' then
      insert into plm.coke_asset_property_option(
        capture_id,option_key,source_value,exact_label,ordinal,source_field,
        classification,classification_status,raw)
      values (p_capture_id,r->>'option_key',r->>'source_value',r->>'exact_label',
        (r->>'ordinal')::integer,r->>'source_field',r->>'classification',
        coalesce(r->>'classification_status','unreviewed'),r->'raw') on conflict do nothing;
    elsif p_entity = 'asset' then
      insert into plm.coke_asset values (
        p_capture_id,r->>'asset_id',r->>'asset_name',r->>'description',r->>'file_type',
        r->>'file_size_display',(r->>'file_size_bytes')::bigint,r->>'uploaded_at_text',
        r->>'uploaded_by_label',(r->>'page_number')::integer,r->>'thumbnail_path',
        r->>'preview_path',r->>'details_path',r->>'download_path',r->>'raw_tag_string',r->'raw')
      on conflict do nothing;
    elsif p_entity = 'asset_detail_value' then
      insert into plm.coke_asset_detail_value values (
        p_capture_id,r->>'asset_id',(r->>'ordinal')::integer,r->>'field_key',
        r->>'field_value',r->'raw') on conflict do nothing;
    elsif p_entity = 'tag' then
      insert into plm.coke_tag values (
        p_capture_id,r->>'tag_key',r->>'exact_label',r->>'identity_method',r->'raw')
      on conflict do nothing;
    elsif p_entity = 'asset_tag' then
      insert into plm.coke_asset_tag values (
        p_capture_id,r->>'asset_id',r->>'tag_key','direct_source',
        'discrete_detail_field',r->'raw') on conflict do nothing;
    elsif p_entity = 'contract' then
      insert into plm.coke_contract values (
        p_capture_id,r->>'contract_id',(r->>'start_date')::date,(r->>'end_date')::date,
        r->>'expiration_display',r->>'status',r->>'source_path',r->'raw') on conflict do nothing;
    elsif p_entity = 'sku' then
      insert into plm.coke_sku values (
        p_capture_id,r->>'sku_source_id',r->>'sku',r->>'sku_title',r->>'product_label',
        r->>'primary_property_label',r->>'property_list_raw',r->>'approval_item_id',
        r->>'source_label',(r->>'deactivation_date')::date,r->>'deactivation_reason',r->'raw')
      on conflict do nothing;
    elsif p_entity = 'contract_manufacturer' then
      insert into plm.coke_contract_manufacturer values (
        p_capture_id,r->>'contract_id',r->>'manufacturer_id',r->>'exact_name',
        r->>'expiration_display',r->>'status',r->>'source_path',r->'raw') on conflict do nothing;
    elsif p_entity = 'royalty_report' then
      insert into plm.coke_royalty_report values (
        p_capture_id,r->>'report_source_key',r->>'contract_id',r->>'period_label',
        r->>'royalty_amount_display',(r->>'royalty_amount')::numeric,r->>'currency_code',
        r->>'status',r->>'source_path',r->'raw') on conflict do nothing;
    end if;
    get diagnostics v_rowcount = row_count;
    v_count := v_count + v_rowcount;
  end loop;
  return v_count;
end;
$$;

create function plm.finalize_coke_capture(p_capture_id uuid) returns jsonb
language plpgsql security definer
set search_path = pg_catalog, plm
as $$
declare
  v_capture plm.coke_capture%rowtype;
  v_counts jsonb;
  v_errors jsonb := '[]'::jsonb;
  v_key text;
  v_value jsonb;
  v_actual bigint;
begin
  select * into v_capture from plm.coke_capture where id=p_capture_id for update;
  if not found then raise exception 'finalize_coke_capture: no capture'; end if;
  if v_capture.status = 'complete' then
    return jsonb_build_object('capture_id',p_capture_id,'status','complete',
      'observed_counts',v_capture.observed_counts,'errors',v_capture.errors);
  end if;
  if v_capture.status <> 'loading' then raise exception 'finalize_coke_capture: not loading'; end if;

  v_counts := jsonb_build_object(
    'approval_items',(select count(*) from plm.coke_approval_item where capture_id=p_capture_id),
    'approval_metadata_values',(select count(*) from plm.coke_approval_metadata_value where capture_id=p_capture_id),
    'approval_related_items',(select count(*) from plm.coke_approval_related_item where capture_id=p_capture_id),
    'resolved_related_items',(select count(*) from plm.coke_approval_related_item r
      where r.capture_id=p_capture_id and r.related_route_id is not null
        and exists (select 1 from plm.coke_approval_item i where i.capture_id=r.capture_id
          and i.approval_route_id=r.related_route_id)),
    'external_related_items',(select count(*) from plm.coke_approval_related_item r
      where r.capture_id=p_capture_id and (r.related_route_id is null
        or not exists (select 1 from plm.coke_approval_item i where i.capture_id=r.capture_id
          and i.approval_route_id=r.related_route_id))),
    'approval_stage_snapshots',(select count(*) from plm.coke_approval_stage_snapshot where capture_id=p_capture_id),
    'approval_comments',(select count(*) from plm.coke_approval_comment where capture_id=p_capture_id),
    'vocabulary_values',(select count(*) from plm.coke_vocabulary_value where capture_id=p_capture_id),
    'approval_vocabulary_values',(select count(*) from plm.coke_approval_vocabulary_value where capture_id=p_capture_id),
    'manufacturer_profiles',(select count(*) from plm.coke_manufacturer_profile where capture_id=p_capture_id),
    'asset_property_options',(select count(*) from plm.coke_asset_property_option where capture_id=p_capture_id),
    'assets',(select count(*) from plm.coke_asset where capture_id=p_capture_id),
    'asset_detail_values',(select count(*) from plm.coke_asset_detail_value where capture_id=p_capture_id),
    'tags',(select count(*) from plm.coke_tag where capture_id=p_capture_id),
    'asset_tags',(select count(*) from plm.coke_asset_tag where capture_id=p_capture_id),
    'contracts',(select count(*) from plm.coke_contract where capture_id=p_capture_id),
    'skus',(select count(*) from plm.coke_sku where capture_id=p_capture_id),
    'contract_manufacturers',(select count(*) from plm.coke_contract_manufacturer where capture_id=p_capture_id),
    'royalty_reports',(select count(*) from plm.coke_royalty_report where capture_id=p_capture_id)
  );

  if not v_capture.expected_counts ?& array[
    'approval_items','approval_metadata_values','approval_related_items',
    'approval_stage_snapshots','approval_comments','vocabulary_values',
    'approval_vocabulary_values','manufacturer_profiles','asset_property_options',
    'assets','asset_detail_values','tags','asset_tags','contracts','skus',
    'contract_manufacturers','royalty_reports'
  ] then
    v_errors := v_errors || jsonb_build_array(jsonb_build_object(
      'code','required_expected_counts_missing'));
  end if;

  for v_key,v_value in select key,value from jsonb_each(v_capture.expected_counts) loop
    if jsonb_typeof(v_value) <> 'number' or (v_value #>> '{}') !~ '^\d+$' then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('code','invalid_expected_count','key',v_key));
    elsif not v_counts ? v_key then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('code','unknown_expected_count','key',v_key));
    else
      v_actual := (v_counts->>v_key)::bigint;
      if v_actual <> (v_value #>> '{}')::bigint then
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'code','count_mismatch','key',v_key,'expected',v_value,'observed',v_actual));
      end if;
    end if;
  end loop;

  -- Related endpoints outside this capture are valid direct-source evidence. They are
  -- counted as external above, never dropped and never forced through an internal FK.
  if not v_capture.approval_index_complete then
    v_errors := v_errors || jsonb_build_array(jsonb_build_object('code','approval_index_incomplete'));
  end if;
  if not v_capture.asset_index_complete then
    v_errors := v_errors || jsonb_build_array(jsonb_build_object('code','asset_index_incomplete'));
  end if;
  if v_capture.media_downloaded <> 0 then
    v_errors := v_errors || jsonb_build_array(jsonb_build_object('code','media_downloaded'));
  end if;

  update plm.coke_capture set
    observed_counts=v_counts,
    errors=v_errors,
    status=case when jsonb_array_length(v_errors)=0 then 'complete' else 'rejected' end,
    load_completed_at=case when jsonb_array_length(v_errors)=0 then now() else null end
  where id=p_capture_id;

  return jsonb_build_object('capture_id',p_capture_id,'status',
    case when jsonb_array_length(v_errors)=0 then 'complete' else 'rejected' end,
    'observed_counts',v_counts,'errors',v_errors);
end;
$$;

-- Current views select only the latest successfully completed capture. Raw payloads
-- remain available only in base tables to approved roles; convenience views expose
-- exact normalized columns and preserve unresolved identity explicitly.
create view api.coke_current_approval_item with (security_invoker=true) as
select i.capture_id,i.approval_route_id,i.item_id,i.item_type,i.title,i.company_label,
  i.submitted_text,i.last_action_text,i.view_count,i.version_count,i.status,
  i.current_stage,i.source_url,i.preview_path
from plm.coke_approval_item i
where i.capture_id=(select c.id from plm.coke_capture c where c.status='complete'
  order by c.source_captured_at desc,c.id desc limit 1);

create view api.coke_current_product_submission with (security_invoker=true) as
select i.*,m.metadata from api.coke_current_approval_item i
left join lateral (select jsonb_object_agg(x.field_key,x.values order by x.field_key) metadata
  from (select v.field_key,jsonb_agg(v.field_value order by v.ordinal) values
    from plm.coke_approval_metadata_value v
    where v.capture_id=i.capture_id and v.approval_route_id=i.approval_route_id
    group by v.field_key) x) m on true
where lower(i.item_type) like '%product%'
  and lower(i.item_type) not like '%packag%'
  and lower(i.item_type) not like '%catalog%';

create view api.coke_current_packaging_submission with (security_invoker=true) as
select i.*,m.metadata from api.coke_current_approval_item i
left join lateral (select jsonb_object_agg(x.field_key,x.values order by x.field_key) metadata
  from (select v.field_key,jsonb_agg(v.field_value order by v.ordinal) values
    from plm.coke_approval_metadata_value v
    where v.capture_id=i.capture_id and v.approval_route_id=i.approval_route_id
    group by v.field_key) x) m on true
where lower(i.item_type) like '%packag%' or lower(i.item_type) like '%catalog%';

create view api.coke_current_manufacturer_submission with (security_invoker=true) as
select i.*,p.legal_name,p.address_line_1,p.address_line_2,p.city,p.region,p.postal_code,
  p.country,p.contact_name,p.contact_email,p.contact_phone,p.website,
  p.commencement_text,p.expiration_text,p.annual_cost_response,
  p.subcontractor_response,p.licensed_products_text,p.comments
from api.coke_current_approval_item i
join plm.coke_manufacturer_profile p using(capture_id,approval_route_id);

create view api.coke_current_asset with (security_invoker=true) as
select a.capture_id,a.asset_id,a.asset_name,a.description,a.file_type,
  a.file_size_display,a.file_size_bytes,a.uploaded_at_text,a.uploaded_by_label,
  a.page_number,a.thumbnail_path,a.preview_path,a.details_path,a.download_path,
  a.raw_tag_string
from plm.coke_asset a
where a.capture_id=(select c.id from plm.coke_capture c where c.status='complete'
  order by c.source_captured_at desc,c.id desc limit 1);
create view api.coke_current_sku with (security_invoker=true) as
select s.capture_id,s.sku_source_id,s.sku,s.sku_title,s.product_label,
  s.primary_property_label,s.property_list_raw,s.approval_item_id,s.source_label,
  s.deactivation_date,s.deactivation_reason,
  case when s.approval_item_id is null then 'unresolved'
       when (select count(*) from plm.coke_approval_item i where i.capture_id=s.capture_id
         and i.item_id=s.approval_item_id)=1 then 'resolved'
       when (select count(*) from plm.coke_approval_item i where i.capture_id=s.capture_id
         and i.item_id=s.approval_item_id)>1 then 'ambiguous' else 'unresolved' end
    approval_item_resolution_status
from plm.coke_sku s
where s.capture_id=(select c.id from plm.coke_capture c where c.status='complete'
  order by c.source_captured_at desc,c.id desc limit 1);
create view api.coke_current_contract_manufacturer with (security_invoker=true) as
select m.capture_id,m.contract_id,m.manufacturer_id,m.exact_name,
  m.expiration_display,m.status,m.source_path
from plm.coke_contract_manufacturer m
where m.capture_id=(select c.id from plm.coke_capture c where c.status='complete'
  order by c.source_captured_at desc,c.id desc limit 1);
create view api.coke_current_royalty_report with (security_invoker=true) as
select r.capture_id,r.report_source_key,r.contract_id,r.period_label,
  r.royalty_amount_display,r.royalty_amount,r.currency_code,r.status,r.source_path
from plm.coke_royalty_report r
where r.capture_id=(select c.id from plm.coke_capture c where c.status='complete'
  order by c.source_captured_at desc,c.id desc limit 1);
create view api.coke_capture_inventory with (security_invoker=true) as
select c.id,c.capture_key,c.source_commit_sha,c.source_manifest_sha256,
  c.source_captured_at,c.load_started_at,c.load_completed_at,c.status,
  c.expected_counts,c.observed_counts,c.approval_index_complete,
  c.asset_index_complete,c.asset_details_complete,c.media_downloaded,c.errors
from plm.coke_capture c;

-- Keep the opt-in exact inventory on the same Coca-Cola latest-complete clock as the
-- bounded view below. Asserted replacements fail closed if an earlier landing changes
-- the inherited function body instead of silently publishing a partial contract.
do $inventory$
declare v_before text; v_after text;
begin
  select pg_get_functiondef('api.source_capture_inventory_exact(text)'::regprocedure)
    into v_before;
  v_after:=replace(v_before,
    $n$      as sesame_capture_id
), catalog as ($n$,
    $r$      as sesame_capture_id,
    (select id from plm.coke_capture
      where status = 'complete'
      order by source_captured_at desc, load_completed_at desc, id desc limit 1)
      as coke_capture_id
), catalog as ($r$);
  if v_after=v_before then raise exception 'exact inventory latest Coca-Cola anchor drifted'; end if;
  v_before:=v_after;
  v_after:=replace(v_before,
    $n$      when c.relname like 'sesame\_%' then 'sesame'
      else 'other'$n$,
    $r$      when c.relname like 'sesame\_%' then 'sesame'
      when c.relname like 'coke\_%' then 'coca-cola'
      else 'other'$r$);
  if v_after=v_before then raise exception 'exact inventory Coca-Cola classification anchor drifted'; end if;
  v_before:=v_after;
  v_after:=replace(v_before,
    $n$      -- DCP path crawl: asset identity is stable, so membership comes through dcp_asset_crawl.$n$,
    $r$      -- Coca-Cola: one latest complete capture; incomplete attempts remain retained only.
      when c.relname = 'coke_capture' then case when l.coke_capture_id is null then null else 1::bigint end
      when c.relname like 'coke\_%' and c.has_capture_id and l.coke_capture_id is not null then
        (xpath('/row/cnt/text()', query_to_xml(format(
          'select count(*) as cnt from plm.%I where capture_id = %L::uuid',
          c.relname, l.coke_capture_id::text), false, true, '')))[1]::text::bigint

      -- DCP path crawl: asset identity is stable, so membership comes through dcp_asset_crawl.$r$);
  if v_after=v_before then raise exception 'exact inventory Coca-Cola count anchor drifted'; end if;
  v_before:=v_after;
  v_after:=replace(v_before,
    $n$    when relname like 'sesame\_%' and (relname = 'sesame_capture' or has_capture_id) then 'latest_complete'$n$,
    $r$    when relname like 'sesame\_%' and (relname = 'sesame_capture' or has_capture_id) then 'latest_complete'
    when relname like 'coke\_%' and (relname = 'coke_capture' or has_capture_id) then 'latest_complete'$r$);
  if v_after=v_before then raise exception 'exact inventory Coca-Cola count-basis anchor drifted'; end if;
  v_before:=v_after;
  v_after:=replace(v_before,
    $n$    when relname like 'sesame\_%' and (relname = 'sesame_capture' or has_capture_id)
      then case when sesame_capture_id is null then null else 'complete' end$n$,
    $r$    when relname like 'sesame\_%' and (relname = 'sesame_capture' or has_capture_id)
      then case when sesame_capture_id is null then null else 'complete' end
    when relname like 'coke\_%' and (relname = 'coke_capture' or has_capture_id)
      then case when coke_capture_id is null then null else 'complete' end$r$);
  if v_after=v_before then raise exception 'exact inventory Coca-Cola status anchor drifted'; end if;
  v_before:=v_after;
  v_after:=replace(v_before,
    $n$    when (relname in ('dcp_crawl','dcp_asset','dcp_crawl_gap')$n$,
    $r$    when relname like 'coke\_%' and (relname = 'coke_capture' or has_capture_id)
         and coke_capture_id is null then
      'No complete Coca-Cola capture exists; latest-complete count is unknown, not zero.'
    when relname like 'coke\_%' and (relname = 'coke_capture' or has_capture_id) then
      'Latest complete Coca-Cola capture; loading and rejected captures excluded.'
    when (relname in ('dcp_crawl','dcp_asset','dcp_crawl_gap')$r$);
  if v_after=v_before or position('coke_capture_id' in v_after)=0 then
    raise exception 'exact inventory Coca-Cola clock incomplete';
  end if;
  execute v_after;
end; $inventory$;

-- Register the new landing in the companywide authoritative inventory. Counts stay
-- intentionally NULL in this bounded view; callers opt into exact counts separately.
-- The latest-complete clock is the newest successfully finalized Coca-Cola capture.
create or replace view api.source_capture_inventory as
with latest as (
  select
    (select capture_id from plm.pmt_capture where status='complete' and capture_kind='full'
      order by completed_at desc nulls last,started_at desc,capture_id desc limit 1) pmt_capture_id,
    (select id from plm.nbcu_capture where status='complete'
      order by source_captured_at desc,load_completed_at desc,id desc limit 1) nbcu_capture_id,
    (select crawl_id from plm.dcp_crawl where status='complete'
      order by captured_on desc,finished_at desc,crawl_id desc limit 1) dcp_crawl_id,
    (select metadata_run_id from plm.dcp_metadata_run where status='complete'
      order by captured_on desc,finished_at desc,metadata_run_id desc limit 1) dcp_metadata_run_id,
    (select id from plm.sega_capture where status='complete'
      order by source_captured_at desc,load_completed_at desc,id desc limit 1) sega_capture_id,
    (select id from plm.sega_submission_capture where status='complete'
      order by source_captured_at desc,load_completed_at desc,id desc limit 1)
      sega_submission_capture_id,
    (select id from plm.peanuts_capture where status='complete'
      order by source_captured_at desc,load_completed_at desc,id desc limit 1) peanuts_capture_id,
    (select id from plm.wildbrain_capture where status='complete'
      order by source_captured_at desc,load_completed_at desc,id desc limit 1) wildbrain_capture_id,
    (select id from plm.sesame_capture where status='complete'
      order by source_captured_at desc,load_completed_at desc,id desc limit 1) sesame_capture_id,
    (select id from plm.coke_capture where status='complete'
      order by source_captured_at desc,load_completed_at desc,id desc limit 1) coke_capture_id
), catalog as (
  select c.oid,c.relname,
    exists(select 1 from pg_attribute a where a.attrelid=c.oid and a.attnum>0
      and not a.attisdropped and a.attname='capture_id') has_capture_id,
    exists(select 1 from pg_attribute a where a.attrelid=c.oid and a.attnum>0
      and not a.attisdropped and a.attname='submission_capture_id') has_submission_capture_id,
    exists(select 1 from pg_attribute a where a.attrelid=c.oid and a.attnum>0
      and not a.attisdropped and a.attname='crawl_id') has_crawl_id,
    exists(select 1 from pg_attribute a where a.attrelid=c.oid and a.attnum>0
      and not a.attisdropped and a.attname='metadata_run_id') has_metadata_run_id,
    exists(select 1 from pg_attribute a where a.attrelid=c.oid and a.attnum>0
      and not a.attisdropped and a.attname in
      ('core_property_id','core_character_id','core_licensor_id','resolved_at','resolution_status'))
      carries_resolution,
    obj_description(c.oid,'pg_class') table_comment
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='plm' and c.relkind='r'
), classified as (
  select c.*,case
    when relname like 'dcp\_%' or relname like 'opa\_%' then 'disney'
    when relname like 'pmt\_%' then 'paramount' when relname like 'nbcu\_%' then 'nbcu'
    when relname like 'wb\_%' then 'warner' when relname like 'erp\_%' then 'coldlion'
    when relname like 'sega\_%' then 'sega' when relname like 'peanuts\_%' then 'peanuts'
    when relname like 'wildbrain\_%' then 'wildbrain'
    when relname like 'sesame\_%' then 'sesame'
    when relname like 'coke\_%' then 'coca-cola' else 'other' end source_system
  from catalog c
), counted as (
  select c.*,l.*,null::bigint retained_count,null::bigint latest_count
  from classified c cross join latest l
)
select source_system,relname table_name,retained_count row_count,carries_resolution,
  table_comment,retained_count retained_row_count,latest_count latest_complete_row_count,
  case
    when relname like 'opa\_%' then 'current_snapshot'
    when relname like 'pmt\_%' and (relname='pmt_capture' or has_capture_id) then 'latest_complete'
    when relname like 'nbcu\_%' and (relname='nbcu_capture' or has_capture_id) then 'latest_complete'
    when relname in ('sega_submission_capture','sega_submission_property') then 'latest_complete'
    when relname like 'sega\_%' and (relname='sega_capture' or has_capture_id) then 'latest_complete'
    when relname like 'peanuts\_%' and (relname='peanuts_capture' or has_capture_id) then 'latest_complete'
    when relname like 'wildbrain\_%' and (relname='wildbrain_capture' or has_capture_id) then 'latest_complete'
    when relname like 'sesame\_%' and (relname='sesame_capture' or has_capture_id) then 'latest_complete'
    when relname like 'coke\_%' and (relname='coke_capture' or has_capture_id) then 'latest_complete'
    when relname in ('dcp_crawl','dcp_asset','dcp_crawl_gap')
      or (relname like 'dcp\_%' and has_crawl_id) then 'latest_complete'
    when relname='dcp_metadata_run' or (relname like 'dcp\_%' and has_metadata_run_id)
      then 'latest_complete' else 'retained_only' end count_basis,
  case
    when relname like 'pmt\_%' and (relname='pmt_capture' or has_capture_id)
      then case when pmt_capture_id is null then null else 'complete' end
    when relname like 'nbcu\_%' and (relname='nbcu_capture' or has_capture_id)
      then case when nbcu_capture_id is null then null else 'complete' end
    when relname in ('sega_submission_capture','sega_submission_property')
      then case when sega_submission_capture_id is null then null else 'complete' end
    when relname like 'sega\_%' and (relname='sega_capture' or has_capture_id)
      then case when sega_capture_id is null then null else 'complete' end
    when relname like 'peanuts\_%' and (relname='peanuts_capture' or has_capture_id)
      then case when peanuts_capture_id is null then null else 'complete' end
    when relname like 'wildbrain\_%' and (relname='wildbrain_capture' or has_capture_id)
      then case when wildbrain_capture_id is null then null else 'complete' end
    when relname like 'sesame\_%' and (relname='sesame_capture' or has_capture_id)
      then case when sesame_capture_id is null then null else 'complete' end
    when relname like 'coke\_%' and (relname='coke_capture' or has_capture_id)
      then case when coke_capture_id is null then null else 'complete' end
    when relname in ('dcp_crawl','dcp_asset','dcp_crawl_gap')
      or (relname like 'dcp\_%' and has_crawl_id)
      then case when dcp_crawl_id is null then null else 'complete' end
    when relname='dcp_metadata_run' or (relname like 'dcp\_%' and has_metadata_run_id)
      then case when dcp_metadata_run_id is null then null else 'complete' end else null end
    latest_complete_status,
  (case
    when relname like 'opa\_%' then
      'Current upserted OPA snapshot; there is no retained-capture clock for this table.'
    when relname like 'pmt\_%' and (relname='pmt_capture' or has_capture_id)
      then case when pmt_capture_id is null
        then 'No complete full Paramount capture exists; latest-complete count is unknown, not zero.'
        else 'Latest complete full Paramount capture; failed, abandoned, targeted and test captures excluded.' end
    when relname like 'nbcu\_%' and (relname='nbcu_capture' or has_capture_id)
      then case when nbcu_capture_id is null
        then 'No complete NBCU capture exists; latest-complete count is unknown, not zero.'
        else 'Latest complete NBCU capture; loading, rejected and abandoned captures excluded.' end
    when relname in ('sega_submission_capture','sega_submission_property')
      then case when sega_submission_capture_id is null
        then 'No complete Sega submission vocabulary capture exists; latest-complete count is unknown, not zero.'
        else 'Latest complete read-only Sega submission vocabulary capture; rejected attempts excluded.' end
    when relname like 'sega\_%' and (relname='sega_capture' or has_capture_id)
      then case when sega_capture_id is null
        then 'No complete Sega capture exists; latest-complete count is unknown, not zero.'
        else 'Latest complete Sega capture; loading, rejected and abandoned captures excluded.' end
    when relname like 'peanuts\_%' and (relname='peanuts_capture' or has_capture_id)
      then case when peanuts_capture_id is null
        then 'No complete Peanuts capture exists; latest-complete count is unknown, not zero.'
        else 'Latest complete Peanuts capture; loading, rejected and abandoned captures excluded.' end
    when relname like 'wildbrain\_%' and (relname='wildbrain_capture' or has_capture_id)
      then case when wildbrain_capture_id is null
        then 'No complete WildBrain capture exists; latest-complete count is unknown, not zero.'
        else 'Latest complete WildBrain capture; loading, rejected and abandoned captures excluded.' end
    when relname like 'sesame\_%' and (relname='sesame_capture' or has_capture_id)
      then case when sesame_capture_id is null
        then 'No complete Sesame capture exists; latest-complete count is unknown, not zero.'
        else 'Latest complete Sesame capture; loading, rejected and abandoned captures excluded.' end
    when relname like 'coke\_%' and (relname='coke_capture' or has_capture_id)
      then case when coke_capture_id is null
        then 'No complete Coca-Cola capture exists; latest-complete count is unknown, not zero.'
        else 'Latest complete Coca-Cola capture; loading, rejected and abandoned captures excluded.' end
    when relname in ('dcp_crawl','dcp_asset','dcp_crawl_gap')
      or (relname like 'dcp\_%' and has_crawl_id) then
      case when dcp_crawl_id is null
        then 'No complete DCP crawl exists; latest-complete membership is unknown, not zero.'
        else 'Latest complete DCP path crawl, using immutable crawl membership where required.' end
    when relname='dcp_metadata_run' or (relname like 'dcp\_%' and has_metadata_run_id) then
      case when dcp_metadata_run_id is null
        then 'No complete DCP metadata run exists; latest-complete count is unknown, not zero.'
        else 'Latest complete DCP metadata run, separate from the path-crawl clock.' end
    when relname='dcp_style_guide' then
      'Retained style-guide identities only. Historical latest-complete membership cannot be derived from mutable last_seen_crawl_id; NULL is intentional.'
    when relname like 'dcp\_%' then
      'Retained DCP rows only; this table has no exact immutable latest-complete membership path.'
    else 'Retained rows only; no source-specific latest-complete contract is defined for this table.'
  end)||' Exact counts are intentionally omitted from ordinary inventory reads; call api.source_capture_inventory_exact(table_name) to opt in.' count_note
from counted;

comment on view api.source_capture_inventory is
  'Bounded metadata inventory for every plm landing table, including Coca-Cola private '
  'capture tables under their latest-complete clock. Historical ten-column contract '
  'preserved: row_count is the retained_row_count compatibility alias, carries_resolution '
  'describes table shape, and ordinary exact counts are intentionally NULL. Exact counts '
  'require api.source_capture_inventory_exact(text). No licensed source row value is exposed here.';
revoke all on api.source_capture_inventory from public,anon;
grant select on api.source_capture_inventory to authenticated,service_role;

-- Licensed rows are private to service_role and approved staff. RLS also protects base
-- tables from direct authenticated access; views use invoker rights and cannot bypass it.
alter table plm.coke_capture enable row level security;
alter table plm.coke_approval_item enable row level security;
alter table plm.coke_approval_metadata_value enable row level security;
alter table plm.coke_approval_related_item enable row level security;
alter table plm.coke_approval_stage_snapshot enable row level security;
alter table plm.coke_approval_comment enable row level security;
alter table plm.coke_vocabulary_value enable row level security;
alter table plm.coke_approval_vocabulary_value enable row level security;
alter table plm.coke_manufacturer_profile enable row level security;
alter table plm.coke_asset_property_option enable row level security;
alter table plm.coke_asset enable row level security;
alter table plm.coke_asset_detail_value enable row level security;
alter table plm.coke_tag enable row level security;
alter table plm.coke_asset_tag enable row level security;
alter table plm.coke_contract enable row level security;
alter table plm.coke_sku enable row level security;
alter table plm.coke_contract_manufacturer enable row level security;
alter table plm.coke_royalty_report enable row level security;

create policy coke_capture_staff_read on plm.coke_capture for select to authenticated
  using (app.has_any_role(array['administrator','licensing']::app.app_role[]));
create policy coke_approval_item_staff_read on plm.coke_approval_item for select to authenticated
  using (app.has_any_role(array['administrator','licensing']::app.app_role[]));
create policy coke_approval_metadata_staff_read on plm.coke_approval_metadata_value for select to authenticated
  using (app.has_any_role(array['administrator','licensing']::app.app_role[]));
create policy coke_approval_related_staff_read on plm.coke_approval_related_item for select to authenticated
  using (app.has_any_role(array['administrator','licensing']::app.app_role[]));
create policy coke_approval_stage_staff_read on plm.coke_approval_stage_snapshot for select to authenticated
  using (app.has_any_role(array['administrator','licensing']::app.app_role[]));
create policy coke_approval_comment_staff_read on plm.coke_approval_comment for select to authenticated
  using (app.has_any_role(array['administrator','licensing']::app.app_role[]));
create policy coke_vocabulary_staff_read on plm.coke_vocabulary_value for select to authenticated
  using (app.has_any_role(array['administrator','licensing']::app.app_role[]));
create policy coke_approval_vocabulary_staff_read on plm.coke_approval_vocabulary_value for select to authenticated
  using (app.has_any_role(array['administrator','licensing']::app.app_role[]));
create policy coke_manufacturer_staff_read on plm.coke_manufacturer_profile for select to authenticated
  using (app.has_any_role(array['administrator','licensing']::app.app_role[]));
create policy coke_asset_property_staff_read on plm.coke_asset_property_option for select to authenticated
  using (app.has_any_role(array['administrator','licensing']::app.app_role[]));
create policy coke_asset_staff_read on plm.coke_asset for select to authenticated
  using (app.has_any_role(array['administrator','licensing']::app.app_role[]));
create policy coke_asset_detail_staff_read on plm.coke_asset_detail_value for select to authenticated
  using (app.has_any_role(array['administrator','licensing']::app.app_role[]));
create policy coke_tag_staff_read on plm.coke_tag for select to authenticated
  using (app.has_any_role(array['administrator','licensing']::app.app_role[]));
create policy coke_asset_tag_staff_read on plm.coke_asset_tag for select to authenticated
  using (app.has_any_role(array['administrator','licensing']::app.app_role[]));
create policy coke_contract_staff_read on plm.coke_contract for select to authenticated
  using (app.has_any_role(array['administrator','licensing']::app.app_role[]));
create policy coke_sku_staff_read on plm.coke_sku for select to authenticated
  using (app.has_any_role(array['administrator','licensing']::app.app_role[]));
create policy coke_contract_manufacturer_staff_read on plm.coke_contract_manufacturer for select to authenticated
  using (app.has_any_role(array['administrator','licensing']::app.app_role[]));
create policy coke_royalty_report_staff_read on plm.coke_royalty_report for select to authenticated
  using (app.has_any_role(array['administrator','licensing']::app.app_role[]));

grant select on plm.coke_capture,plm.coke_approval_item,
  plm.coke_approval_metadata_value,plm.coke_approval_related_item,
  plm.coke_approval_stage_snapshot,plm.coke_approval_comment,
  plm.coke_vocabulary_value,plm.coke_approval_vocabulary_value,
  plm.coke_manufacturer_profile,plm.coke_asset_property_option,plm.coke_asset,
  plm.coke_asset_detail_value,plm.coke_tag,plm.coke_asset_tag,plm.coke_contract,
  plm.coke_sku,plm.coke_contract_manufacturer,plm.coke_royalty_report to service_role;
grant select on plm.coke_capture,plm.coke_approval_item,
  plm.coke_approval_metadata_value,plm.coke_approval_related_item,
  plm.coke_approval_stage_snapshot,plm.coke_approval_comment,
  plm.coke_vocabulary_value,plm.coke_approval_vocabulary_value,
  plm.coke_manufacturer_profile,plm.coke_asset_property_option,plm.coke_asset,
  plm.coke_asset_detail_value,plm.coke_tag,plm.coke_asset_tag,plm.coke_contract,
  plm.coke_sku,plm.coke_contract_manufacturer,plm.coke_royalty_report to authenticated;
revoke all on plm.coke_capture,plm.coke_approval_item,
  plm.coke_approval_metadata_value,plm.coke_approval_related_item,
  plm.coke_approval_stage_snapshot,plm.coke_approval_comment,
  plm.coke_vocabulary_value,plm.coke_approval_vocabulary_value,
  plm.coke_manufacturer_profile,plm.coke_asset_property_option,plm.coke_asset,
  plm.coke_asset_detail_value,plm.coke_tag,plm.coke_asset_tag,plm.coke_contract,
  plm.coke_sku,plm.coke_contract_manufacturer,plm.coke_royalty_report from public,anon;
grant select,insert on plm.coke_capture,plm.coke_approval_item,
  plm.coke_approval_metadata_value,plm.coke_approval_related_item,
  plm.coke_approval_stage_snapshot,plm.coke_approval_comment,
  plm.coke_vocabulary_value,plm.coke_approval_vocabulary_value,
  plm.coke_manufacturer_profile,plm.coke_asset_property_option,plm.coke_asset,
  plm.coke_asset_detail_value,plm.coke_tag,plm.coke_asset_tag,plm.coke_contract,
  plm.coke_sku,plm.coke_contract_manufacturer,plm.coke_royalty_report to service_role;
revoke update,delete,truncate on plm.coke_capture,plm.coke_approval_item,
  plm.coke_approval_metadata_value,plm.coke_approval_related_item,
  plm.coke_approval_stage_snapshot,plm.coke_approval_comment,
  plm.coke_vocabulary_value,plm.coke_approval_vocabulary_value,
  plm.coke_manufacturer_profile,plm.coke_asset_property_option,plm.coke_asset,
  plm.coke_asset_detail_value,plm.coke_tag,plm.coke_asset_tag,plm.coke_contract,
  plm.coke_sku,plm.coke_contract_manufacturer,plm.coke_royalty_report from service_role,authenticated;
revoke insert on plm.coke_capture,plm.coke_approval_item,
  plm.coke_approval_metadata_value,plm.coke_approval_related_item,
  plm.coke_approval_stage_snapshot,plm.coke_approval_comment,
  plm.coke_vocabulary_value,plm.coke_approval_vocabulary_value,
  plm.coke_manufacturer_profile,plm.coke_asset_property_option,plm.coke_asset,
  plm.coke_asset_detail_value,plm.coke_tag,plm.coke_asset_tag,plm.coke_contract,
  plm.coke_sku,plm.coke_contract_manufacturer,plm.coke_royalty_report from service_role,authenticated;
revoke all on function plm.load_coke_capture_chunk(uuid,text,jsonb) from public,anon,authenticated;
revoke all on function plm.finalize_coke_capture(uuid) from public,anon,authenticated;
grant execute on function plm.load_coke_capture_chunk(uuid,text,jsonb) to service_role;
grant execute on function plm.finalize_coke_capture(uuid) to service_role;

revoke all on api.coke_current_approval_item,api.coke_current_product_submission,
  api.coke_current_packaging_submission,api.coke_current_manufacturer_submission,
  api.coke_current_asset,api.coke_current_sku,api.coke_current_contract_manufacturer,
  api.coke_current_royalty_report,api.coke_capture_inventory from public,anon;
grant select on api.coke_current_approval_item,api.coke_current_product_submission,
  api.coke_current_packaging_submission,api.coke_current_manufacturer_submission,
  api.coke_current_asset,api.coke_current_sku,api.coke_current_contract_manufacturer,
  api.coke_current_royalty_report,api.coke_capture_inventory to authenticated,service_role;

-- Fail the migration if default privileges or a later statement left a write bypass.
do $$
declare v_bad integer; v_tables integer;
begin
  select count(*) into v_tables from information_schema.tables
   where table_schema='plm' and table_name like 'coke\_%' and table_type='BASE TABLE';
  if v_tables <> 18 then raise exception 'coke landing: expected 18 tables, found %',v_tables; end if;
  select count(*) into v_bad from information_schema.role_table_grants
   where table_schema='plm' and table_name like 'coke\_%'
     and grantee in ('service_role','authenticated')
     and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE');
  if v_bad <> 0 then raise exception 'coke landing: % direct write grants survive',v_bad; end if;
  select count(*) into v_bad from information_schema.role_table_grants
   where table_schema='plm' and table_name like 'coke\_%'
     and grantee='authenticated' and privilege_type='SELECT';
  if v_bad <> v_tables then
    raise exception 'coke landing: authenticated SELECT exists on % of % tables',v_bad,v_tables;
  end if;
  select count(*) into v_bad from information_schema.role_table_grants
   where table_schema='plm' and table_name like 'coke\_%' and grantee in ('anon','PUBLIC');
  if v_bad <> 0 then raise exception 'coke landing: % public/anon grants survive',v_bad; end if;
  if has_function_privilege('anon','plm.load_coke_capture_chunk(uuid,text,jsonb)','EXECUTE')
    or has_function_privilege('authenticated','plm.load_coke_capture_chunk(uuid,text,jsonb)','EXECUTE')
    or not has_function_privilege('service_role','plm.load_coke_capture_chunk(uuid,text,jsonb)','EXECUTE')
  then raise exception 'coke landing: loader privilege boundary failed'; end if;
  if has_function_privilege('anon','plm.finalize_coke_capture(uuid)','EXECUTE')
    or has_function_privilege('authenticated','plm.finalize_coke_capture(uuid)','EXECUTE')
    or not has_function_privilege('service_role','plm.finalize_coke_capture(uuid)','EXECUTE')
  then raise exception 'coke landing: finalizer privilege boundary failed'; end if;
end;
$$;

comment on table plm.coke_capture is
  'Private licensed-source snapshot root. Schema only in public Git; rows remain private. Not canonical Master Data.';
comment on column plm.coke_capture.asset_details_complete is
  'Independent enrichment flag. A capture may be complete with this false when the asset index is complete.';
comment on column plm.coke_approval_item.approval_route_id is
  'Source route identity. Never substitute the distinct business-facing item_id.';
comment on column plm.coke_asset.raw_tag_string is
  'Raw card text only. It must never be split into coke_asset_tag edges.';
comment on column plm.coke_sku.property_list_raw is
  'Raw evidence only. Commas are not proven relationship delimiters.';
