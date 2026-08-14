-- Issue #970: Paramount calls this source entity a Collection; POP presents it
-- as a Style Guide. That vocabulary mapping is a contract, not row-level data.

drop view api.pmt_style_guides;

create view api.pmt_style_guides
with (security_invoker = true) as
select
  cl.capture_id,
  cl.collection_source_id as style_guide_source_id,
  cl.collection_name      as style_guide_name,
  'Collection'::text      as paramount_term,
  coalesce((select array_agg(p.property_name order by p.property_name)
              from plm.pmt_property_collection pc
              join plm.pmt_property p
                on p.capture_id = pc.capture_id and p.property_source_id = pc.property_source_id
             where pc.capture_id = cl.capture_id
               and pc.collection_source_id = cl.collection_source_id),
           array[]::text[]) as property_names,
  (select count(*) from plm.pmt_asset_collection ac
    where ac.capture_id = cl.capture_id and ac.collection_source_id = cl.collection_source_id)
    as asset_count,
  (select count(distinct ach.character_source_id)
     from plm.pmt_asset_collection ac
     join plm.pmt_asset_character ach
       on ach.capture_id = ac.capture_id and ach.asset_id = ac.asset_id
    where ac.capture_id = cl.capture_id and ac.collection_source_id = cl.collection_source_id)
    as character_count,
  lc.completed_at as captured_at
from plm.pmt_collection cl
join api.pmt_latest_capture lc on lc.capture_id = cl.capture_id;

comment on view api.pmt_style_guides is
'Paramount Collections presented in POP business vocabulary as style guides. paramount_term is '
'the computed vocabulary constant Collection, not captured row-level source data. There is no '
'second source table: this reads plm.pmt_collection directly, so the two vocabularies cannot '
'drift into separate populations. character_count is distinct characters reached through the '
'style guide''s assets, which is why it is a count and not an array.';

-- A recreated view is a new object with default privileges. Re-pin its existing
-- posture without teaching the object-claim parser that the view is also a table.
do $$
begin
  execute 'revoke all on api.pmt_style_guides from public';
  execute 'revoke all on api.pmt_style_guides from anon';
  execute 'grant select on api.pmt_style_guides to authenticated, service_role';
end;
$$;

create or replace function plm.load_pmt_capture_chunk(
  p_capture_id uuid,
  p_target     text,
  p_rows       jsonb
)
returns integer
language plpgsql
security definer
set search_path = plm, core, public, extensions
as $$
declare
  v_role   text := auth.role();
  v_status text;
  v_n      integer;
  v_count  integer;
  c_targets constant text[] := array[
    'pmt_capture_batch','pmt_authorized_title','pmt_property','pmt_franchise',
    'pmt_character','pmt_collection','pmt_brand','pmt_asset',
    'pmt_authorized_title_property','pmt_asset_property','pmt_asset_franchise',
    'pmt_asset_character','pmt_asset_collection','pmt_asset_brand',
    'pmt_property_character','pmt_property_collection','pmt_property_franchise_evidence',
    'pmt_authorized_property_asset','pmt_property_capture_log','pmt_relationship_anomaly',
    'pmt_metadata_element','pmt_asset_metadata_value'
  ];
begin
  if not plm.pmt_loader_privilege_ok(v_role, session_user) then
    raise exception 'Paramount import refused: JWT role % / session_user % may not load capture '
      'chunks.', coalesce(v_role, '<null>'), coalesce(session_user, '<null>')
      using errcode = 'P0001';
  end if;

  if p_target is null or not (p_target = any (c_targets)) then
    raise exception 'Paramount import refused: % is not a loadable target. The target list is '
      'a fixed allow list; core.* and every table outside plm.pmt_* is unreachable from here '
      'by construction, not by convention. This is checked BEFORE the empty-chunk shortcut, '
      'so a typo cannot pass as a successful load of nothing.',
      coalesce(p_target, '<null>') using errcode = 'P0001';
  end if;

  select status into v_status from plm.pmt_capture where capture_id = p_capture_id;
  if v_status is null then
    raise exception 'Paramount import refused: capture % does not exist.', p_capture_id
      using errcode = 'P0001';
  end if;
  if v_status <> 'loading' then
    raise exception 'Paramount import refused: capture % is %, not loading. A capture that has '
      'left the loading state may not receive more rows.', p_capture_id, v_status
      using errcode = 'P0001';
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Paramount import refused: rows must be a jsonb array, got %.',
      coalesce(jsonb_typeof(p_rows), 'null') using errcode = 'P0001';
  end if;

  v_n := jsonb_array_length(p_rows);
  if v_n = 0 then
    return 0;
  end if;
  if v_n > 5000 then
    raise exception 'Paramount import refused: chunk of % rows exceeds the 5000-row bound. '
      'Stream bounded chunks.', v_n using errcode = 'P0001';
  end if;

  if p_target = 'pmt_capture_batch' then
    insert into plm.pmt_capture_batch (
      capture_id, batch_number, expected_asset_count, returned_asset_count,
      first_asset_id, last_asset_id, http_status, content_was_json,
      requested_ids_sha256, returned_ids_sha256, id_sets_matched, complete,
      failure_message, captured_at, source_hash)
    select p_capture_id,
      (r->>'batch_number')::integer, (r->>'expected_asset_count')::integer,
      (r->>'returned_asset_count')::integer, r->>'first_asset_id', r->>'last_asset_id',
      (r->>'http_status')::integer, (r->>'content_was_json')::boolean,
      r->>'requested_ids_sha256', r->>'returned_ids_sha256',
      (r->>'id_sets_matched')::boolean, (r->>'complete')::boolean,
      r->>'failure_message', (r->>'captured_at')::timestamptz, md5(r::text)
    from jsonb_array_elements(p_rows) r;

  elsif p_target = 'pmt_authorized_title' then
    insert into plm.pmt_authorized_title (
      capture_id, authorized_title_key, authorized_title_name, capture_status,
      resolved_property_count, unique_asset_count, full_metadata_count, notes, source_hash)
    select p_capture_id, r->>'authorized_title_key', r->>'authorized_title_name',
      r->>'capture_status', (r->>'resolved_property_count')::integer,
      (r->>'unique_asset_count')::integer, (r->>'full_metadata_count')::integer,
      r->>'notes', md5(r::text)
    from jsonb_array_elements(p_rows) r;

  elsif p_target = 'pmt_property' then
    insert into plm.pmt_property (
      capture_id, property_source_id, property_name, is_licensed_selection, raw, source_hash)
    select p_capture_id, r->>'property_source_id', r->>'property_name',
      coalesce((r->>'is_licensed_selection')::boolean, false),
      coalesce(r->'raw', '{}'::jsonb), md5(r::text)
    from jsonb_array_elements(p_rows) r;

  elsif p_target = 'pmt_franchise' then
    insert into plm.pmt_franchise (capture_id, franchise_source_id, franchise_name, raw, source_hash)
    select p_capture_id, r->>'franchise_source_id', r->>'franchise_name',
      coalesce(r->'raw', '{}'::jsonb), md5(r::text)
    from jsonb_array_elements(p_rows) r;

  elsif p_target = 'pmt_character' then
    insert into plm.pmt_character (capture_id, character_source_id, character_name, raw, source_hash)
    select p_capture_id, r->>'character_source_id', r->>'character_name',
      coalesce(r->'raw', '{}'::jsonb), md5(r::text)
    from jsonb_array_elements(p_rows) r;

  elsif p_target = 'pmt_collection' then
    insert into plm.pmt_collection (
      capture_id, collection_source_id, collection_name, raw, source_hash)
    select p_capture_id, r->>'collection_source_id', r->>'collection_name',
      coalesce(r->'raw', '{}'::jsonb), md5(r::text)
    from jsonb_array_elements(p_rows) r;

  elsif p_target = 'pmt_brand' then
    insert into plm.pmt_brand (capture_id, brand_source_id, brand_name, raw, source_hash)
    select p_capture_id, r->>'brand_source_id', r->>'brand_name',
      coalesce(r->'raw', '{}'::jsonb), md5(r::text)
    from jsonb_array_elements(p_rows) r;

  elsif p_target = 'pmt_asset' then
    insert into plm.pmt_asset (
      capture_id, asset_id, asset_name, date_imported, date_last_updated,
      content_size_bytes, content_type, mime_type, asset_version, raw, source_hash)
    select p_capture_id, r->>'asset_id', r->>'asset_name',
      nullif(r->>'date_imported','')::timestamptz, nullif(r->>'date_last_updated','')::timestamptz,
      (r->>'content_size_bytes')::bigint, r->>'content_type', r->>'mime_type',
      (r->>'asset_version')::integer, coalesce(r->'raw', '{}'::jsonb), md5(r::text)
    from jsonb_array_elements(p_rows) r;

  elsif p_target = 'pmt_authorized_title_property' then
    insert into plm.pmt_authorized_title_property (
      capture_id, authorized_title_key, property_source_id,
      reported_asset_count, mapping_status, notes, source_hash)
    select p_capture_id, r->>'authorized_title_key', r->>'property_source_id',
      coalesce((r->>'reported_asset_count')::integer, 0),
      coalesce(r->>'mapping_status','mapped'), r->>'notes', md5(r::text)
    from jsonb_array_elements(p_rows) r;

  elsif p_target = 'pmt_asset_property' then
    insert into plm.pmt_asset_property (capture_id, asset_id, property_source_id, source_hash)
    select p_capture_id, r->>'asset_id', r->>'property_source_id', md5(r::text)
    from jsonb_array_elements(p_rows) r;

  elsif p_target = 'pmt_asset_franchise' then
    insert into plm.pmt_asset_franchise (capture_id, asset_id, franchise_source_id, source_hash)
    select p_capture_id, r->>'asset_id', r->>'franchise_source_id', md5(r::text)
    from jsonb_array_elements(p_rows) r;

  elsif p_target = 'pmt_asset_character' then
    insert into plm.pmt_asset_character (capture_id, asset_id, character_source_id, source_hash)
    select p_capture_id, r->>'asset_id', r->>'character_source_id', md5(r::text)
    from jsonb_array_elements(p_rows) r;

  elsif p_target = 'pmt_asset_collection' then
    insert into plm.pmt_asset_collection (capture_id, asset_id, collection_source_id, source_hash)
    select p_capture_id, r->>'asset_id', r->>'collection_source_id', md5(r::text)
    from jsonb_array_elements(p_rows) r;

  elsif p_target = 'pmt_asset_brand' then
    insert into plm.pmt_asset_brand (capture_id, asset_id, brand_source_id, source_hash)
    select p_capture_id, r->>'asset_id', r->>'brand_source_id', md5(r::text)
    from jsonb_array_elements(p_rows) r;

  elsif p_target = 'pmt_property_character' then
    insert into plm.pmt_property_character (
      capture_id, property_source_id, character_source_id, evidence_asset_count, source_hash)
    select p_capture_id, r->>'property_source_id', r->>'character_source_id',
      coalesce((r->>'evidence_asset_count')::integer, 0), md5(r::text)
    from jsonb_array_elements(p_rows) r;

  elsif p_target = 'pmt_property_collection' then
    insert into plm.pmt_property_collection (
      capture_id, property_source_id, collection_source_id, evidence_asset_count, source_hash)
    select p_capture_id, r->>'property_source_id', r->>'collection_source_id',
      coalesce((r->>'evidence_asset_count')::integer, 0), md5(r::text)
    from jsonb_array_elements(p_rows) r;

  elsif p_target = 'pmt_property_franchise_evidence' then
    -- evidence_kind and is_direct_source_relationship are STILL NOT accepted from the
    -- caller. They stay pinned by CHECK on the base table. Co-occurrence never becomes a
    -- direct relationship through this loader.
    insert into plm.pmt_property_franchise_evidence (
      capture_id, property_source_id, franchise_source_id, evidence_asset_count, source_hash)
    select p_capture_id, r->>'property_source_id', r->>'franchise_source_id',
      coalesce((r->>'evidence_asset_count')::integer, 0), md5(r::text)
    from jsonb_array_elements(p_rows) r;

  elsif p_target = 'pmt_authorized_property_asset' then
    insert into plm.pmt_authorized_property_asset (
      capture_id, licensed_property_source_id, asset_id, source_hash)
    select p_capture_id, r->>'licensed_property_source_id', r->>'asset_id', md5(r::text)
    from jsonb_array_elements(p_rows) r;

  elsif p_target = 'pmt_property_capture_log' then
    insert into plm.pmt_property_capture_log (
      capture_id, property_source_id, reported_asset_count,
      captured_asset_count, page_count, complete, failure_message, source_hash)
    select p_capture_id, r->>'property_source_id',
      (r->>'reported_asset_count')::integer, (r->>'captured_asset_count')::integer,
      (r->>'page_count')::integer, (r->>'complete')::boolean, r->>'failure_message', md5(r::text)
    from jsonb_array_elements(p_rows) r;

  elsif p_target = 'pmt_relationship_anomaly' then
    insert into plm.pmt_relationship_anomaly (
      capture_id, asset_id, relationship_field, raw_value, action, details, source_hash)
    select p_capture_id, r->>'asset_id', r->>'relationship_field', r->>'raw_value',
      r->>'action', r->>'details', md5(r::text)
    from jsonb_array_elements(p_rows) r;

  elsif p_target = 'pmt_metadata_element' then
    -- Headings once per (capture, element). Hash the descriptor tuple the same
    -- way as the backfill. data_type is a per-value fact and is NOT written here.
    insert into plm.pmt_metadata_element (
      capture_id, metadata_element_id,
      metadata_element_name, metadata_category_id, metadata_category_name,
      domain_id, source_table_name, source_column_name, source_hash)
    select p_capture_id,
      r->>'metadata_element_id',
      r->>'metadata_element_name',
      r->>'metadata_category_id',
      r->>'metadata_category_name',
      r->>'domain_id',
      r->>'source_table_name',
      r->>'source_column_name',
      md5(jsonb_build_object(
        'metadata_element_name',  r->>'metadata_element_name',
        'metadata_category_id',   r->>'metadata_category_id',
        'metadata_category_name', r->>'metadata_category_name',
        'domain_id',              r->>'domain_id',
        'source_table_name',      r->>'source_table_name',
        'source_column_name',     r->>'source_column_name'
      )::text)
    from jsonb_array_elements(p_rows) r;

  elsif p_target = 'pmt_asset_metadata_value' then
    -- NOTE `r->'raw_value'` (arrow, keeps jsonb) not `r->>'raw_value'` (double arrow,
    -- stringifies). The double arrow here would store the TEXT "{...}" inside a jsonb
    -- column as a JSON string and quietly defeat the shape CHECK.
    -- value_ordinal is taken from the payload, never from row order: jsonb_array_elements
    -- ordering is an implementation detail and must not become the source's meaning.
    -- The six heading columns are no longer written here; they live on
    -- plm.pmt_metadata_element. data_type stays: it is the JSON type of this value.
    insert into plm.pmt_asset_metadata_value (
      capture_id, asset_id, metadata_element_id, data_type,
      value_ordinal, source_value, display_value, language, source_path,
      raw_value, source_hash)
    select p_capture_id,
      r->>'asset_id', r->>'metadata_element_id', r->>'data_type',
      (r->>'value_ordinal')::integer, r->>'source_value', r->>'display_value',
      r->>'language', r->>'source_path',
      r->'raw_value', md5(r::text)
    from jsonb_array_elements(p_rows) r;

  else
    raise exception 'Paramount import refused: target % passed the allow list but has no '
      'INSERT branch. A name was added to c_targets without its loader.', p_target
      using errcode = 'P0001';
  end if;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function plm.load_pmt_capture_chunk(uuid, text, jsonb) is
'The only row-loading entry point for a Paramount capture. It validates a fixed target allow '
'list before the empty-chunk shortcut, limits each call to 5000 rows, and refuses captures '
'outside loading status. It preserves source IDs as exact text, writes collection identity and '
'name once, and ignores legacy paramount_term payload keys because Collection is a vocabulary '
'contract computed by api.pmt_style_guides rather than captured row-level data. It also preserves '
'the issue #964 duplicate-name omissions and issue #965 metadata-element normalization.';

revoke all on function plm.load_pmt_capture_chunk(uuid, text, jsonb) from public;
revoke all on function plm.load_pmt_capture_chunk(uuid, text, jsonb) from anon, authenticated;
grant execute on function plm.load_pmt_capture_chunk(uuid, text, jsonb) to service_role;

alter table plm.pmt_collection drop column paramount_term;

comment on table plm.pmt_collection is
'The portal entity Paramount calls a Collection. POP presents the same rows as Style Guides '
'through api.pmt_style_guides. Collection is a vocabulary contract, not stored row-level source '
'data. There is deliberately no second style-guide source table or repeated vocabulary column.';
