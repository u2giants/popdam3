-- Paramount: describe each metadata-element heading once per capture.
--
-- ISSUE #965. Plan: plan_pmt-metadata-element-normalization.md
-- Orchestrator marker: #960
--
-- Migration version 20260814213043 is reserved by the authoritative open
-- db-claim issue #998 for this branch and exact object set.
--
-- Starts from the #964 / PR #981 body in 20260814193351 (the first
-- load_pmt_capture_chunk rewrite). This is the SECOND rewrite.
--
-- STAGED. This file does NOT drop the six heading columns (plan Step 8 /
-- Migration E). That drop waits for a real preview capture to reach
-- status = complete after the foreign key exists.
--
-- What this file does, in order:
--   A. Create plm.pmt_metadata_element with the full Paramount security
--      contract, both completed-capture freeze triggers (including the
--      missing one on plm.pmt_asset_metadata_value), NULL-aware disagreement
--      refusal, then backfill hashed on the descriptor tuple.
--   B. Replace plm.load_pmt_capture_chunk from the 20260814193351 body:
--      add pmt_metadata_element to the allow list and an INSERT branch;
--      stop writing the six heading columns onto value rows; keep writing
--      data_type onto value rows. Preserve the #964 omission of both
--      duplicated property-name writes.
--   C. Add pmt_amv_element_fkey AFTER the loader writes the parent.
--   D. COMMENT DEPRECATED on the six heading columns. data_type is not
--      deprecated and is not dropped.
--
-- Locked refusals:
--   * no data_type column on the element table
--   * no api view
--   * no last-write-wins entity-ensuring trigger
--   * plm.validate_pmt_capture is not touched
--   * pmt_amv_raw_value_shape_chk and pmt_amv_data_type_chk stay on the
--     value table
--
-- Schema plus a backfill of already-landed heading copies. Seeds no source
-- value. CONFIDENTIAL LICENSOR DATA must never appear in this file.

-- =====================================================================================
-- SECTION A. plm.pmt_metadata_element + security + freeze + NULL-aware backfill
-- =====================================================================================

create table plm.pmt_metadata_element (
  capture_id             uuid not null
    references plm.pmt_capture(capture_id) on delete restrict,
  metadata_element_id    text not null,
  metadata_element_name  text null,
  metadata_category_id   text null,
  metadata_category_name text null,
  domain_id              text null,
  source_table_name      text null,
  source_column_name     text null,
  source_hash            text not null,
  imported_at            timestamptz not null default now(),
  constraint pmt_metadata_element_pkey
    primary key (capture_id, metadata_element_id),
  constraint pmt_me_element_id_chk check (btrim(metadata_element_id) <> ''),
  constraint pmt_me_source_hash_chk check (btrim(source_hash) <> '')
);

comment on table plm.pmt_metadata_element is
'One row per Paramount metadata ELEMENT per capture. The six field headings '
'(metadata_element_name, metadata_category_id, metadata_category_name, domain_id, '
'source_table_name, source_column_name) live here and nowhere else. data_type stays '
'on each plm.pmt_asset_metadata_value row because it is the JSON type of THAT value, '
'and two values under one element can legitimately differ. Value rows reference this '
'table on (capture_id, metadata_element_id). A new metadata element is a new ROW here '
'and never a schema change. CONFIDENTIAL LICENSOR DATA -- never commit a row to this '
'PUBLIC repository.';

-- ENABLE, not FORCE. FORCE would silently drop SECURITY DEFINER loader inserts.
alter table plm.pmt_metadata_element enable row level security;

create policy pmt_metadata_element_read on plm.pmt_metadata_element
  for select to authenticated
  using (app.has_any_role(
    array['administrator','sales','licensing','designer']::app.app_role[]));

create policy pmt_metadata_element_service on plm.pmt_metadata_element
  for all to service_role using (true) with check (true);

revoke all on plm.pmt_metadata_element from public;
revoke all on plm.pmt_metadata_element from anon;
grant select on plm.pmt_metadata_element to authenticated;
grant select, insert, update, delete on plm.pmt_metadata_element to service_role;
revoke truncate, references, trigger, maintain
  on plm.pmt_metadata_element from service_role;

-- Proof, not intention. Same shape as 20260811030000:448-485.
do $$
declare
  p    text;
  v_bad text := '';
begin
  foreach p in array array['TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] loop
    if has_table_privilege('service_role', 'plm.pmt_metadata_element', p) then
      v_bad := v_bad || p || ' ';
    end if;
  end loop;
  if v_bad <> '' then
    raise exception 'pmt_metadata_element SECURITY FAILED: service_role still holds: %. '
      'These bits allow bypassing the guarded loader and its capture-freeze triggers.', v_bad
      using errcode = 'P0001';
  end if;

  foreach p in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] loop
    if has_table_privilege('anon', 'plm.pmt_metadata_element', p) then
      raise exception 'pmt_metadata_element SECURITY FAILED: anon holds % on a '
        'confidential licensor table.', p using errcode = 'P0001';
    end if;
  end loop;

  foreach p in array array['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] loop
    if has_table_privilege('authenticated', 'plm.pmt_metadata_element', p) then
      raise exception 'pmt_metadata_element SECURITY FAILED: authenticated holds write '
        'privilege %.', p using errcode = 'P0001';
    end if;
  end loop;
  if not has_table_privilege('authenticated', 'plm.pmt_metadata_element', 'SELECT') then
    raise exception 'pmt_metadata_element SECURITY FAILED: authenticated lost SELECT, so '
      'the approved app roles cannot read it at all.' using errcode = 'P0001';
  end if;

  raise notice 'pmt_metadata_element privilege posture verified.';
end;
$$;

create trigger trg_pmt_metadata_element_immutable
  before update or delete on plm.pmt_metadata_element
  for each row execute function plm.pmt_reject_completed_capture_change();

-- Existing gap: the value table was created after 20260810020000's hard-coded list.
create trigger trg_pmt_asset_metadata_value_immutable
  before update or delete on plm.pmt_asset_metadata_value
  for each row execute function plm.pmt_reject_completed_capture_change();

-- NULL-aware disagreement check. count(distinct x) ignores NULLs, so
-- 'Color' vs NULL would pass a bare distinct. Name the pair and the COLUMN,
-- never the heading text.
do $$
declare
  v_cap uuid;
  v_el  text;
  v_heading text;
begin
  select capture_id, metadata_element_id, heading
    into v_cap, v_el, v_heading
  from (
    select capture_id, metadata_element_id, 'metadata_element_name' as heading,
           count(*) filter (where metadata_element_name is not null) as n_nonnull,
           count(*) filter (where metadata_element_name is null)     as n_null,
           count(distinct metadata_element_name)                     as n_distinct
    from plm.pmt_asset_metadata_value group by 1, 2
    union all
    select capture_id, metadata_element_id, 'metadata_category_id',
           count(*) filter (where metadata_category_id is not null),
           count(*) filter (where metadata_category_id is null),
           count(distinct metadata_category_id)
    from plm.pmt_asset_metadata_value group by 1, 2
    union all
    select capture_id, metadata_element_id, 'metadata_category_name',
           count(*) filter (where metadata_category_name is not null),
           count(*) filter (where metadata_category_name is null),
           count(distinct metadata_category_name)
    from plm.pmt_asset_metadata_value group by 1, 2
    union all
    select capture_id, metadata_element_id, 'domain_id',
           count(*) filter (where domain_id is not null),
           count(*) filter (where domain_id is null),
           count(distinct domain_id)
    from plm.pmt_asset_metadata_value group by 1, 2
    union all
    select capture_id, metadata_element_id, 'source_table_name',
           count(*) filter (where source_table_name is not null),
           count(*) filter (where source_table_name is null),
           count(distinct source_table_name)
    from plm.pmt_asset_metadata_value group by 1, 2
    union all
    select capture_id, metadata_element_id, 'source_column_name',
           count(*) filter (where source_column_name is not null),
           count(*) filter (where source_column_name is null),
           count(distinct source_column_name)
    from plm.pmt_asset_metadata_value group by 1, 2
  ) x
  where n_distinct > 1
     or (n_nonnull > 0 and n_null > 0)
  limit 1;

  if found then
    raise exception
      'pmt_metadata_element backfill refused: headings disagree for capture % element % heading %',
      v_cap, v_el, v_heading
      using errcode = 'P0001';
  end if;
end;
$$;

insert into plm.pmt_metadata_element (
  capture_id, metadata_element_id,
  metadata_element_name, metadata_category_id, metadata_category_name,
  domain_id, source_table_name, source_column_name, source_hash)
select
  v.capture_id,
  v.metadata_element_id,
  v.metadata_element_name,
  v.metadata_category_id,
  v.metadata_category_name,
  v.domain_id,
  v.source_table_name,
  v.source_column_name,
  md5(jsonb_build_object(
    'metadata_element_name',  v.metadata_element_name,
    'metadata_category_id',   v.metadata_category_id,
    'metadata_category_name', v.metadata_category_name,
    'domain_id',              v.domain_id,
    'source_table_name',      v.source_table_name,
    'source_column_name',     v.source_column_name
  )::text)
from (
  select distinct on (capture_id, metadata_element_id)
    capture_id, metadata_element_id,
    metadata_element_name, metadata_category_id, metadata_category_name,
    domain_id, source_table_name, source_column_name
  from plm.pmt_asset_metadata_value
  order by capture_id, metadata_element_id
) v;

-- element rows == distinct value-table pairs, per capture. min(uuid)/max(uuid)
-- do not exist; do not max() a heading.
do $$
declare
  v_missing bigint;
  v_extra   bigint;
  v_count_mismatch bigint;
begin
  select count(*) into v_missing
  from (
    select distinct capture_id, metadata_element_id
    from plm.pmt_asset_metadata_value
  ) v
  where not exists (
    select 1 from plm.pmt_metadata_element e
    where e.capture_id = v.capture_id
      and e.metadata_element_id = v.metadata_element_id
  );

  select count(*) into v_extra
  from plm.pmt_metadata_element e
  where not exists (
    select 1
    from plm.pmt_asset_metadata_value v
    where v.capture_id = e.capture_id
      and v.metadata_element_id = e.metadata_element_id
  );

  select count(*) into v_count_mismatch
  from (
    select capture_id, count(distinct metadata_element_id) as n
    from plm.pmt_asset_metadata_value
    group by capture_id
  ) v
  full join (
    select capture_id, count(*) as n
    from plm.pmt_metadata_element
    group by capture_id
  ) e using (capture_id)
  where v.n is distinct from e.n;

  if v_missing > 0 or v_extra > 0 or v_count_mismatch > 0 then
    raise exception
      'pmt_metadata_element backfill assertion failed: % value-pairs missing, '
      '% extra element rows, % per-capture count mismatches',
      v_missing, v_extra, v_count_mismatch
      using errcode = 'P0001';
  end if;

  raise notice 'pmt_metadata_element backfill asserted.';
end;
$$;

-- =====================================================================================
-- SECTION B. plm.load_pmt_capture_chunk -- second rewrite, from 20260814193351
--
-- Changes against that body, and NOTHING else:
--   1. 'pmt_metadata_element' joins the FIXED allow list.
--   2. Explicit INSERT branch for pmt_metadata_element. Hash is the descriptor
--      tuple (jsonb_build_object of the six headings). No data_type write.
--   3. The pmt_asset_metadata_value branch no longer names or selects the six
--      heading columns. It still writes data_type.
--   4. The #964 omissions stay: no paramount_property_name, no capture-log
--      property_name. The pmt_property entity branch still writes property_name.
-- =====================================================================================
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
      capture_id, collection_source_id, collection_name, paramount_term, raw, source_hash)
    select p_capture_id, r->>'collection_source_id', r->>'collection_name',
      coalesce(r->>'paramount_term', 'Collection'), coalesce(r->'raw', '{}'::jsonb), md5(r::text)
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
'The ONLY row-loading entry point for a Paramount capture. Validates the target against a '
'FIXED ALLOW LIST *before* the empty-chunk shortcut, so a misspelled target is refused even '
'with zero rows behind it. Bounded to 5000 rows per call and refuses any capture not in '
'status loading. There is no dynamic table name, so no caller can reach core.* or any other '
'schema through it. Relationship rows are rejected by the capture-scoped composite foreign '
'keys when an endpoint is missing from the same capture. As of 20260811030000 it inserts '
'Paramount source IDs as EXACT TEXT -- every ::bigint cast is gone, because casting an '
'identifier to a number is how a leading zero or a >2^53 value gets destroyed without an '
'error -- and it loads plm.pmt_asset_metadata_value, the lossless repeated-metadata store. '
'As of 20260814193351 it no longer writes the duplicated property-name copies on '
'plm.pmt_authorized_title_property and plm.pmt_property_capture_log: the property name is '
'written once, to plm.pmt_property, and both tables reach it by their capture-scoped '
'foreign keys. Rows still carrying those keys in the JSON are accepted; the keys are not '
'read. As of issue #965 it also loads plm.pmt_metadata_element (one row per element per '
'capture for the six headings) and no longer writes those headings onto value rows. '
'data_type stays on each value row. Load pmt_metadata_element before '
'pmt_asset_metadata_value.';

revoke all on function plm.load_pmt_capture_chunk(uuid, text, jsonb) from public;
revoke all on function plm.load_pmt_capture_chunk(uuid, text, jsonb) from anon, authenticated;
grant execute on function plm.load_pmt_capture_chunk(uuid, text, jsonb) to service_role;

-- =====================================================================================
-- SECTION C. Foreign key -- AFTER the loader writes the parent, AFTER the backfill.
-- Adding this before the writer is the 2026-08-14 OPA shape. Do not copy that trigger.
-- =====================================================================================
alter table plm.pmt_asset_metadata_value
  add constraint pmt_amv_element_fkey
  foreign key (capture_id, metadata_element_id)
  references plm.pmt_metadata_element (capture_id, metadata_element_id)
  on delete restrict;

-- =====================================================================================
-- SECTION D. Deprecate the six heading columns on the value table.
-- data_type is NOT deprecated. The columns are already nullable. They are NOT dropped
-- here -- Migration E waits for a proven preview capture after this FK exists.
-- =====================================================================================
comment on column plm.pmt_asset_metadata_value.metadata_element_name is
  'DEPRECATED 2026-08-14 -- moved to plm.pmt_metadata_element. Join on '
  '(capture_id, metadata_element_id). data_type stays on this value row. See '
  'plan_pmt-metadata-element-normalization.md.';

comment on column plm.pmt_asset_metadata_value.metadata_category_id is
  'DEPRECATED 2026-08-14 -- moved to plm.pmt_metadata_element. Join on '
  '(capture_id, metadata_element_id). data_type stays on this value row. See '
  'plan_pmt-metadata-element-normalization.md.';

comment on column plm.pmt_asset_metadata_value.metadata_category_name is
  'DEPRECATED 2026-08-14 -- moved to plm.pmt_metadata_element. Join on '
  '(capture_id, metadata_element_id). data_type stays on this value row. See '
  'plan_pmt-metadata-element-normalization.md.';

comment on column plm.pmt_asset_metadata_value.domain_id is
  'DEPRECATED 2026-08-14 -- moved to plm.pmt_metadata_element. Join on '
  '(capture_id, metadata_element_id). data_type stays on this value row. See '
  'plan_pmt-metadata-element-normalization.md.';

comment on column plm.pmt_asset_metadata_value.source_table_name is
  'DEPRECATED 2026-08-14 -- moved to plm.pmt_metadata_element. Join on '
  '(capture_id, metadata_element_id). data_type stays on this value row. See '
  'plan_pmt-metadata-element-normalization.md.';

comment on column plm.pmt_asset_metadata_value.source_column_name is
  'DEPRECATED 2026-08-14 -- moved to plm.pmt_metadata_element. Join on '
  '(capture_id, metadata_element_id). data_type stays on this value row. See '
  'plan_pmt-metadata-element-normalization.md.';
