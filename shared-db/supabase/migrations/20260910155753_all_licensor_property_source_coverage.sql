-- Issue #2579: expose the complete all-licensor Property-source coverage in DB Data Admin.
-- Claim #2679; reserved version 20260910155753.
-- derived-from: 20260909115140
--
-- SCHEMA ONLY. This public migration contains no licensed values, labels, URLs,
-- contracts, raw evidence or fixtures. Exact source strings arrive only at runtime
-- from the private u2giants/licensor-source-data loader. Nothing here promotes a
-- source label into canonical core.* Master Data, and nothing here merges the
-- Paramount TrackerPlus submission vocabulary into plm.pmt_property.

-- ---------------------------------------------------------------------------
-- 1. Paramount TrackerPlus submission capture root (append-only, fail closed).
-- ---------------------------------------------------------------------------
create table plm.pmt_trackerplus_submission_capture (
  id uuid primary key,
  capture_key text not null unique check (btrim(capture_key) <> ''),
  source_repository text not null check (btrim(source_repository) <> ''),
  source_commit_sha text not null check (source_commit_sha ~ '^[0-9a-f]{40}$'),
  source_manifest_sha256 text not null check (source_manifest_sha256 ~ '^[0-9a-f]{64}$'),
  source_captured_at timestamptz not null,
  load_started_at timestamptz not null default now(),
  load_completed_at timestamptz,
  -- loading -> complete | rejected, and nothing else. Sibling landing tables
  -- also permit 'abandoned', which no function has ever written; this table does
  -- not repeat that, so the CHECK names exactly the states the loaders produce
  -- and the terminal refusal on re-begin is about states that really occur.
  status text not null default 'loading'
    check (status in ('loading','complete','rejected')),
  expected_property_count integer not null check (expected_property_count >= 0),
  expected_property_manifest_sha256 text not null
    check (expected_property_manifest_sha256 ~ '^[0-9a-f]{64}$'),
  observed_property_count integer not null default 0
    check (observed_property_count >= 0),
  observed_property_manifest_sha256 text
    check (observed_property_manifest_sha256 is null
           or observed_property_manifest_sha256 ~ '^[0-9a-f]{64}$'),
  chunk_ledger jsonb not null default '{}'::jsonb
    check (jsonb_typeof(chunk_ledger) = 'object'),
  errors jsonb not null default '[]'::jsonb check (jsonb_typeof(errors) = 'array'),
  created_by text not null check (btrim(created_by) <> ''),
  constraint pmt_trackerplus_submission_capture_complete_time_chk
    check ((status = 'complete') = (load_completed_at is not null)),
  constraint pmt_trackerplus_submission_capture_complete_requirements_chk check (
    status <> 'complete' or (
      observed_property_count = expected_property_count
      and observed_property_manifest_sha256 is not null
      and observed_property_manifest_sha256 = expected_property_manifest_sha256
      and jsonb_array_length(errors) = 0
    )
  )
);

comment on table plm.pmt_trackerplus_submission_capture is
  'Append-only Paramount TrackerPlus submission-vocabulary capture root. A capture is complete only when its observed property count and observed exact-label manifest hash match the expected values declared before loading and no error was recorded. Private source commit, manifest hash and capture time stay in this landing schema and are never exposed through api.';

-- ---------------------------------------------------------------------------
-- 2. TrackerPlus submission Property vocabulary.
--    The durable source-local key is SHA-256 of the exact UTF-8 label. It is a
--    local identity marked exact-label-sha256, NOT a Paramount source record ID,
--    and it must never be merged into plm.pmt_property.
-- ---------------------------------------------------------------------------
create table plm.pmt_trackerplus_submission_property (
  capture_id uuid not null references plm.pmt_trackerplus_submission_capture(id),
  property_local_key text not null check (property_local_key ~ '^[0-9a-f]{64}$'),
  exact_label text not null check (btrim(exact_label) <> ''),
  identity_method text not null default 'exact-label-sha256'
    check (identity_method = 'exact-label-sha256'),
  ordinal integer not null check (ordinal >= 0),
  source_field text not null check (btrim(source_field) <> ''),
  raw jsonb not null check (jsonb_typeof(raw) = 'object'),
  primary key (capture_id, property_local_key),
  constraint pmt_trackerplus_submission_property_ordinal_uq
    unique (capture_id, ordinal),
  constraint pmt_trackerplus_submission_property_local_key_chk
    check (property_local_key = encode(sha256(convert_to(exact_label, 'UTF8')), 'hex')),
  constraint pmt_trackerplus_submission_property_no_source_id_chk
    check (not (raw ? 'property_source_id')
       and not (raw ? 'source_id')
       and not (raw ? 'portal_record_id'))
);

comment on table plm.pmt_trackerplus_submission_property is
  'Paramount TrackerPlus submission Property vocabulary for one capture. property_local_key is the deterministic SHA-256 of the exact UTF-8 label (identity_method exact-label-sha256) because the authenticated submission picker exposes no stable portal record ID. It is a source-local key only: it is never a Paramount source ID, is never resolved against plm.pmt_property, and no fabricated portal identifier may be stored on these rows.';

-- ---------------------------------------------------------------------------
-- 3. Guarded begin / chunk / finalize loaders.
--    Repeated identical chunks are idempotent. A changed chunk, a duplicate
--    local key, a count or manifest-hash mismatch, an incomplete capture and a
--    fabricated source ID are all refused fail-closed.
-- ---------------------------------------------------------------------------
create function plm.begin_pmt_trackerplus_submission_capture(
  p_capture_key text,
  p_source_repository text,
  p_source_commit_sha text,
  p_source_manifest_sha256 text,
  p_source_captured_at timestamptz,
  p_expected_property_count integer,
  p_expected_property_manifest_sha256 text,
  p_created_by text
) returns uuid
language plpgsql security definer
set search_path = pg_catalog, plm
as $begin_capture$
declare
  v_existing plm.pmt_trackerplus_submission_capture%rowtype;
  v_id uuid;
begin
  select * into v_existing from plm.pmt_trackerplus_submission_capture
   where capture_key = p_capture_key for update;

  if found then
    -- Re-declaring the SAME capture is idempotent; re-declaring it with any
    -- different source evidence is refused rather than silently reopened.
    if v_existing.source_repository is distinct from p_source_repository
       or v_existing.source_commit_sha is distinct from p_source_commit_sha
       or v_existing.source_manifest_sha256 is distinct from p_source_manifest_sha256
       or v_existing.source_captured_at is distinct from p_source_captured_at
       or v_existing.expected_property_count is distinct from p_expected_property_count
       or v_existing.expected_property_manifest_sha256
          is distinct from p_expected_property_manifest_sha256 then
      raise exception using errcode = 'P0001',
        message = 'begin_pmt_trackerplus_submission_capture: capture_key already declared with different source evidence';
    end if;
    if v_existing.status not in ('loading','complete') then
      raise exception using errcode = 'P0001',
        message = 'begin_pmt_trackerplus_submission_capture: capture_key is already terminal and cannot be reopened';
    end if;
    return v_existing.id;
  end if;

  v_id := gen_random_uuid();
  insert into plm.pmt_trackerplus_submission_capture (
    id, capture_key, source_repository, source_commit_sha, source_manifest_sha256,
    source_captured_at, status, expected_property_count,
    expected_property_manifest_sha256, created_by)
  values (
    v_id, p_capture_key, p_source_repository, p_source_commit_sha,
    p_source_manifest_sha256, p_source_captured_at, 'loading',
    p_expected_property_count, p_expected_property_manifest_sha256, p_created_by);
  return v_id;
end;
$begin_capture$;

comment on function plm.begin_pmt_trackerplus_submission_capture(
  text,text,text,text,timestamptz,integer,text,text) is
  'Declares one TrackerPlus submission capture and its expected completeness evidence before any row is loaded. Re-declaring the same capture_key with identical source evidence is idempotent; different evidence, or a terminal capture, is refused.';

create function plm.load_pmt_trackerplus_submission_capture_chunk(
  p_capture_id uuid,
  p_chunk_index integer,
  p_rows jsonb
) returns integer
language plpgsql security definer
set search_path = pg_catalog, plm
as $load_chunk$
declare
  v_capture plm.pmt_trackerplus_submission_capture%rowtype;
  v_chunk_key text := p_chunk_index::text;
  v_chunk_sha text;
  v_row jsonb;
  v_label text;
  v_local_key text;
  v_inserted integer := 0;
  v_rowcount integer;
begin
  if p_chunk_index is null or p_chunk_index < 0 then
    raise exception using errcode = 'P0001',
      message = 'load_pmt_trackerplus_submission_capture_chunk: chunk index must be a non-negative integer';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception using errcode = 'P0001',
      message = 'load_pmt_trackerplus_submission_capture_chunk: chunk payload must be a JSON array';
  end if;

  select * into v_capture from plm.pmt_trackerplus_submission_capture
   where id = p_capture_id for update;
  if not found then
    raise exception using errcode = 'P0001',
      message = 'load_pmt_trackerplus_submission_capture_chunk: no such capture';
  end if;
  if v_capture.status <> 'loading' then
    raise exception using errcode = 'P0001',
      message = 'load_pmt_trackerplus_submission_capture_chunk: capture is not loading';
  end if;

  v_chunk_sha := encode(sha256(convert_to(p_rows::text, 'UTF8')), 'hex');

  if v_capture.chunk_ledger ? v_chunk_key then
    if v_capture.chunk_ledger ->> v_chunk_key = v_chunk_sha then
      -- Identical repeated chunk: idempotent no-op.
      return 0;
    end if;
    raise exception using errcode = 'P0001',
      message = 'load_pmt_trackerplus_submission_capture_chunk: chunk content changed for an already loaded chunk index';
  end if;

  for v_row in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(v_row) <> 'object' then
      raise exception using errcode = 'P0001',
        message = 'load_pmt_trackerplus_submission_capture_chunk: every chunk element must be a JSON object';
    end if;
    if v_row ? 'property_source_id' or v_row ? 'source_id' or v_row ? 'portal_record_id'
       or coalesce(v_row -> 'raw', '{}'::jsonb) ? 'property_source_id'
       or coalesce(v_row -> 'raw', '{}'::jsonb) ? 'source_id'
       or coalesce(v_row -> 'raw', '{}'::jsonb) ? 'portal_record_id' then
      raise exception using errcode = 'P0001',
        message = 'load_pmt_trackerplus_submission_capture_chunk: TrackerPlus exposes no stable portal record ID; a fabricated source ID is refused';
    end if;

    v_label := v_row ->> 'exact_label';
    if v_label is null or btrim(v_label) = '' then
      raise exception using errcode = 'P0001',
        message = 'load_pmt_trackerplus_submission_capture_chunk: every row must carry a non-empty exact_label';
    end if;
    v_local_key := encode(sha256(convert_to(v_label, 'UTF8')), 'hex');

    if (v_row ? 'property_local_key')
       and (v_row ->> 'property_local_key') is distinct from v_local_key then
      raise exception using errcode = 'P0001',
        message = 'load_pmt_trackerplus_submission_capture_chunk: supplied local key is not the exact-label SHA-256 of its own label';
    end if;

    insert into plm.pmt_trackerplus_submission_property (
      capture_id, property_local_key, exact_label, identity_method,
      ordinal, source_field, raw)
    values (
      p_capture_id, v_local_key, v_label, 'exact-label-sha256',
      (v_row ->> 'ordinal')::integer,
      coalesce(v_row ->> 'source_field', 'submission_property_picker'),
      coalesce(v_row -> 'raw', '{}'::jsonb));
    get diagnostics v_rowcount = row_count;
    v_inserted := v_inserted + v_rowcount;
  end loop;

  update plm.pmt_trackerplus_submission_capture
     set chunk_ledger = chunk_ledger || jsonb_build_object(v_chunk_key, v_chunk_sha),
         observed_property_count = observed_property_count + v_inserted
   where id = p_capture_id;

  return v_inserted;
exception
  when unique_violation then
    raise exception using errcode = 'P0001',
      message = 'load_pmt_trackerplus_submission_capture_chunk: duplicate local key or ordinal within this capture';
end;
$load_chunk$;

comment on function plm.load_pmt_trackerplus_submission_capture_chunk(uuid,integer,jsonb) is
  'Loads one chunk of the TrackerPlus submission Property vocabulary. A repeated identical chunk is an idempotent no-op; a changed chunk for an already loaded index, a duplicate exact-label local key or ordinal, a row without an exact label, and any attempt to store a fabricated portal source ID are all refused.';

create function plm.finalize_pmt_trackerplus_submission_capture(p_capture_id uuid)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, plm
as $finalize_capture$
declare
  v_capture plm.pmt_trackerplus_submission_capture%rowtype;
  v_count integer;
  v_manifest text;
begin
  select * into v_capture from plm.pmt_trackerplus_submission_capture
   where id = p_capture_id for update;
  if not found then
    raise exception using errcode = 'P0001',
      message = 'finalize_pmt_trackerplus_submission_capture: no such capture';
  end if;
  if v_capture.status = 'complete' then
    return jsonb_build_object(
      'capture_id', p_capture_id, 'status', 'complete',
      'observed_property_count', v_capture.observed_property_count,
      'observed_property_manifest_sha256', v_capture.observed_property_manifest_sha256);
  end if;
  if v_capture.status <> 'loading' then
    raise exception using errcode = 'P0001',
      message = 'finalize_pmt_trackerplus_submission_capture: capture is not loading';
  end if;

  select count(*)::integer,
         encode(sha256(convert_to(
           coalesce(string_agg(p.property_local_key, chr(10) order by p.property_local_key), ''),
           'UTF8')), 'hex')
    into v_count, v_manifest
    from plm.pmt_trackerplus_submission_property p
   where p.capture_id = p_capture_id;

  if v_count <> v_capture.expected_property_count
     or v_manifest <> v_capture.expected_property_manifest_sha256 then
    update plm.pmt_trackerplus_submission_capture
       set status = 'rejected',
           observed_property_count = v_count,
           observed_property_manifest_sha256 = v_manifest,
           errors = errors || jsonb_build_array(jsonb_build_object(
             'kind', 'completeness_mismatch',
             'expected_property_count', v_capture.expected_property_count,
             'observed_property_count', v_count))
     where id = p_capture_id;
    -- Recorded, not raised. A raise would roll back the rejection record itself and
    -- leave the capture sitting in 'loading', which reads as "still in progress"
    -- rather than "refused". The capture is terminal and can never be exposed:
    -- every consumer reads status = 'complete' only.
    return jsonb_build_object(
      'capture_id', p_capture_id, 'status', 'rejected',
      'reason', 'completeness_mismatch',
      'expected_property_count', v_capture.expected_property_count,
      'observed_property_count', v_count);
  end if;

  update plm.pmt_trackerplus_submission_capture
     set status = 'complete',
         load_completed_at = now(),
         observed_property_count = v_count,
         observed_property_manifest_sha256 = v_manifest
   where id = p_capture_id;

  return jsonb_build_object(
    'capture_id', p_capture_id, 'status', 'complete',
    'observed_property_count', v_count,
    'observed_property_manifest_sha256', v_manifest);
end;
$finalize_capture$;

comment on function plm.finalize_pmt_trackerplus_submission_capture(uuid) is
  'Completes a TrackerPlus submission capture only when the observed row count and the observed exact-label manifest hash both match the expectation declared at begin time. Any mismatch rejects the capture instead of publishing an incomplete vocabulary. Finalizing an already complete capture is idempotent.';

alter table plm.pmt_trackerplus_submission_capture enable row level security;
alter table plm.pmt_trackerplus_submission_property enable row level security;

create policy pmt_trackerplus_submission_capture_staff_read
  on plm.pmt_trackerplus_submission_capture for select to authenticated
  using (app.has_any_role(
    array['administrator','sales','licensing','designer']::app.app_role[]));
create policy pmt_trackerplus_submission_property_staff_read
  on plm.pmt_trackerplus_submission_property for select to authenticated
  using (app.has_any_role(
    array['administrator','sales','licensing','designer']::app.app_role[]));

revoke all on plm.pmt_trackerplus_submission_capture,
  plm.pmt_trackerplus_submission_property from public, anon;
grant select on plm.pmt_trackerplus_submission_capture,
  plm.pmt_trackerplus_submission_property to authenticated;
grant select, insert on plm.pmt_trackerplus_submission_capture,
  plm.pmt_trackerplus_submission_property to service_role;
revoke update, delete, truncate on plm.pmt_trackerplus_submission_capture,
  plm.pmt_trackerplus_submission_property from service_role, authenticated;
revoke insert on plm.pmt_trackerplus_submission_capture,
  plm.pmt_trackerplus_submission_property from authenticated;

revoke all on function plm.begin_pmt_trackerplus_submission_capture(
  text,text,text,text,timestamptz,integer,text,text) from public, anon, authenticated;
revoke all on function plm.load_pmt_trackerplus_submission_capture_chunk(uuid,integer,jsonb)
  from public, anon, authenticated;
revoke all on function plm.finalize_pmt_trackerplus_submission_capture(uuid)
  from public, anon, authenticated;
grant execute on function plm.begin_pmt_trackerplus_submission_capture(
  text,text,text,text,timestamptz,integer,text,text) to service_role;
grant execute on function plm.load_pmt_trackerplus_submission_capture_chunk(uuid,integer,jsonb)
  to service_role;
grant execute on function plm.finalize_pmt_trackerplus_submission_capture(uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- 4. Source-capture inventory: classify the post-inventory Marvel and WWE
--    families and the new TrackerPlus family, and give TrackerPlus its own
--    latest-complete clock. Metadata only -- no licensed value can appear here.
-- ---------------------------------------------------------------------------
create or replace function api.source_capture_inventory_exact(p_table_name text default null)
returns table(
  source_system text, table_name name, row_count bigint, carries_resolution boolean,
  table_comment text, retained_row_count bigint, latest_complete_row_count bigint,
  count_basis text, latest_complete_status text, count_note text)
language sql
security definer
set search_path = pg_catalog, api, plm
as $inventory_exact$
with latest as (
  select
    (select capture_id from plm.pmt_capture
      where status = 'complete' and capture_kind = 'full'
      order by completed_at desc nulls last, started_at desc, capture_id desc limit 1)
      as pmt_capture_id,
    (select id from plm.nbcu_capture
      where status = 'complete'
      order by source_captured_at desc, load_completed_at desc, id desc limit 1)
      as nbcu_capture_id,
    (select crawl_id from plm.dcp_crawl
      where status = 'complete'
      order by captured_on desc, finished_at desc, crawl_id desc limit 1)
      as dcp_crawl_id,
    (select metadata_run_id from plm.dcp_metadata_run
      where status = 'complete'
      order by captured_on desc, finished_at desc, metadata_run_id desc limit 1)
      as dcp_metadata_run_id,
    (select id from plm.sega_capture
      where status = 'complete'
      order by source_captured_at desc, load_completed_at desc, id desc limit 1)
      as sega_capture_id,
    (select id from plm.sega_submission_capture
      where status = 'complete'
      order by source_captured_at desc, load_completed_at desc, id desc limit 1)
      as sega_submission_capture_id,
    (select id from plm.peanuts_capture
      where status = 'complete'
      order by source_captured_at desc, load_completed_at desc, id desc limit 1)
      as peanuts_capture_id,
    (select id from plm.wildbrain_capture
      where status = 'complete'
      order by source_captured_at desc, load_completed_at desc, id desc limit 1)
      as wildbrain_capture_id,
    (select id from plm.sesame_capture
      where status = 'complete'
      order by source_captured_at desc, load_completed_at desc, id desc limit 1)
      as sesame_capture_id,
    (select id from plm.coke_capture
      where status = 'complete'
      order by source_captured_at desc, load_completed_at desc, id desc limit 1)
      as coke_capture_id,
    (select id from plm.pmt_trackerplus_submission_capture
      where status = 'complete'
      order by source_captured_at desc, load_completed_at desc, id desc limit 1)
      as pmt_trackerplus_capture_id,
    -- Restored from 20260909115140: the coherent OPA capture root. Dropping it here
    -- would silently revert the three append-only OPA tables to a snapshot count.
    (select id from plm.opa_capture where status = 'complete'
      order by source_captured_at desc, load_completed_at desc, id desc limit 1)
      as opa_capture_id
), catalog as (
  select
    c.oid,
    c.relname,
    exists (select 1 from pg_attribute a where a.attrelid = c.oid
      and a.attnum > 0 and not a.attisdropped and a.attname = 'capture_id') as has_capture_id,
    exists (select 1 from pg_attribute a where a.attrelid = c.oid
      and a.attnum > 0 and not a.attisdropped
      and a.attname = 'submission_capture_id') as has_submission_capture_id,
    exists (select 1 from pg_attribute a where a.attrelid = c.oid
      and a.attnum > 0 and not a.attisdropped and a.attname = 'crawl_id') as has_crawl_id,
    exists (select 1 from pg_attribute a where a.attrelid = c.oid
      and a.attnum > 0 and not a.attisdropped and a.attname = 'metadata_run_id') as has_metadata_run_id,
    exists (
      select 1 from pg_attribute a
      where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
        and a.attname in ('core_property_id','core_character_id','core_licensor_id',
                          'resolved_at','resolution_status')
    ) as carries_resolution,
    obj_description(c.oid, 'pg_class') as table_comment
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'plm' and c.relkind = 'r'
    and (p_table_name is null or c.relname = p_table_name)
), classified as (
  select c.*,
    case
      when c.relname like 'dcp\_%' or c.relname like 'opa\_%' then 'disney'
      when c.relname like 'pmt\_%' then 'paramount'
      when c.relname like 'nbcu\_%' then 'nbcu'
      when c.relname like 'wb\_%' then 'warner'
      when c.relname like 'erp\_%' then 'coldlion'
      when c.relname like 'sega\_%' then 'sega'
      when c.relname like 'peanuts\_%' then 'peanuts'
      -- Appended BELOW every pre-existing arm, so nothing above can change meaning. It
      -- cannot be shadowed by the `wb\_%` -> warner arm either: `wildbrain_` does not
      -- start with `wb_`.
      when c.relname like 'wildbrain\_%' then 'wildbrain'
      -- Appended below every pre-existing arm; no earlier classification changes.
      when c.relname like 'sesame\_%' then 'sesame'
      when c.relname like 'coke\_%' then 'coca-cola'
      -- Appended below every pre-existing arm. These two families landed AFTER the
      -- inventory was written and were reported as 'other'. Neither can shadow an
      -- earlier arm: no earlier prefix is a prefix of 'marvel_' or 'wwe_'.
      when c.relname like 'marvel\_%' then 'marvel'
      when c.relname like 'wwe\_%' then 'wwe'
      else 'other'
    end as source_system
  from catalog c
), counted as (
  select c.*, l.*,
    (xpath('/row/cnt/text()', query_to_xml(
      format('select count(*) as cnt from plm.%I', c.relname), false, true, ''
    )))[1]::text::bigint as retained_count,
    case
      -- The three append-only OPA capture tables must use one completed root. These
      -- arms come from 20260909115140 and must stay AHEAD of the broader mutable OPA
      -- current-snapshot family below.
      when c.relname = 'opa_capture' then
        case when l.opa_capture_id is null then null else 1::bigint end
      when c.relname in ('opa_capture_scope', 'opa_property_character_capture') then
        case when l.opa_capture_id is null then null else
          (xpath('/row/cnt/text()', query_to_xml(format(
            'select count(*) as cnt from plm.%I where capture_id = %L::uuid',
            c.relname, l.opa_capture_id::text), false, true, '')))[1]::text::bigint
        end

      -- Other OPA tables are deliberately upserted current state, not retained captures.
      when c.relname like 'opa\_%' then
        (xpath('/row/cnt/text()', query_to_xml(
          format('select count(*) as cnt from plm.%I', c.relname), false, true, ''
        )))[1]::text::bigint

      -- Paramount TrackerPlus submissions have their own complete-capture clock and are
      -- tested BEFORE the pmt_ arms below, which would otherwise pin them to the
      -- Creative Library capture. The inner null test keeps them off that clock even
      -- when no complete TrackerPlus capture exists yet.
      when c.relname = 'pmt_trackerplus_submission_capture' then
        case when l.pmt_trackerplus_capture_id is null then null else 1::bigint end
      when c.relname like 'pmt\_trackerplus\_%' and c.has_capture_id then
        case when l.pmt_trackerplus_capture_id is null then null else
          (xpath('/row/cnt/text()', query_to_xml(format(
            'select count(*) as cnt from plm.%I where capture_id = %L::uuid',
            c.relname, l.pmt_trackerplus_capture_id::text), false, true, '')))[1]::text::bigint
        end

      -- Paramount: one latest complete FULL capture, matching api.pmt_latest_complete_capture.
      when c.relname = 'pmt_capture' then case when l.pmt_capture_id is null then null else 1::bigint end
      when c.relname like 'pmt\_%' and c.has_capture_id and l.pmt_capture_id is not null then
        (xpath('/row/cnt/text()', query_to_xml(format(
          'select count(*) as cnt from plm.%I where capture_id = %L::uuid',
          c.relname, l.pmt_capture_id::text), false, true, '')))[1]::text::bigint

      -- NBCU: one latest complete capture; rejected and abandoned attempts stay retained only.
      when c.relname = 'nbcu_capture' then case when l.nbcu_capture_id is null then null else 1::bigint end
      when c.relname like 'nbcu\_%' and c.has_capture_id and l.nbcu_capture_id is not null then
        (xpath('/row/cnt/text()', query_to_xml(format(
          'select count(*) as cnt from plm.%I where capture_id = %L::uuid',
          c.relname, l.nbcu_capture_id::text), false, true, '')))[1]::text::bigint

      -- Sega submission vocabulary has its own complete-capture clock.
      when c.relname = 'sega_submission_capture' then
        case when l.sega_submission_capture_id is null then null else 1::bigint end
      when c.relname = 'sega_submission_property' and c.has_submission_capture_id
           and l.sega_submission_capture_id is not null then
        (xpath('/row/cnt/text()', query_to_xml(format(
          'select count(*) as cnt from plm.%I where submission_capture_id = %L::uuid',
          c.relname, l.sega_submission_capture_id::text), false, true, '')))[1]::text::bigint

      -- Sega asset evidence: one latest complete capture.
      when c.relname = 'sega_capture' then case when l.sega_capture_id is null then null else 1::bigint end
      when c.relname like 'sega\_%' and c.has_capture_id and l.sega_capture_id is not null then
        (xpath('/row/cnt/text()', query_to_xml(format(
          'select count(*) as cnt from plm.%I where capture_id = %L::uuid',
          c.relname, l.sega_capture_id::text), false, true, '')))[1]::text::bigint

      -- Peanuts: identical contract to NBCU and Sega -- one latest complete capture, and
      -- loading, rejected and abandoned attempts stay retained only.
      when c.relname = 'peanuts_capture' then case when l.peanuts_capture_id is null then null else 1::bigint end
      when c.relname like 'peanuts\_%' and c.has_capture_id and l.peanuts_capture_id is not null then
        (xpath('/row/cnt/text()', query_to_xml(format(
          'select count(*) as cnt from plm.%I where capture_id = %L::uuid',
          c.relname, l.peanuts_capture_id::text), false, true, '')))[1]::text::bigint

      -- WildBrain: identical contract to NBCU, Sega and Peanuts -- one latest complete
      -- capture, and loading, rejected and abandoned attempts stay retained only.
      when c.relname = 'wildbrain_capture' then case when l.wildbrain_capture_id is null then null else 1::bigint end
      when c.relname like 'wildbrain\_%' and c.has_capture_id and l.wildbrain_capture_id is not null then
        (xpath('/row/cnt/text()', query_to_xml(format(
          'select count(*) as cnt from plm.%I where capture_id = %L::uuid',
          c.relname, l.wildbrain_capture_id::text), false, true, '')))[1]::text::bigint

      -- Sesame: identical complete-capture contract to NBCU, Sega, Peanuts and WildBrain.
      when c.relname = 'sesame_capture' then case when l.sesame_capture_id is null then null else 1::bigint end
      when c.relname like 'sesame\_%' and c.has_capture_id and l.sesame_capture_id is not null then
        (xpath('/row/cnt/text()', query_to_xml(format(
          'select count(*) as cnt from plm.%I where capture_id = %L::uuid',
          c.relname, l.sesame_capture_id::text), false, true, '')))[1]::text::bigint

      -- Coca-Cola: one latest complete capture; incomplete attempts remain retained only.
      when c.relname = 'coke_capture' then case when l.coke_capture_id is null then null else 1::bigint end
      when c.relname like 'coke\_%' and c.has_capture_id and l.coke_capture_id is not null then
        (xpath('/row/cnt/text()', query_to_xml(format(
          'select count(*) as cnt from plm.%I where capture_id = %L::uuid',
          c.relname, l.coke_capture_id::text), false, true, '')))[1]::text::bigint

      -- DCP path crawl: asset identity is stable, so membership comes through dcp_asset_crawl.
      when c.relname = 'dcp_crawl' then case when l.dcp_crawl_id is null then null else 1::bigint end
      when c.relname = 'dcp_asset' and l.dcp_crawl_id is not null then
        (select count(*) from plm.dcp_asset_crawl ac where ac.crawl_id = l.dcp_crawl_id)
      when c.relname like 'dcp\_%' and c.has_crawl_id and l.dcp_crawl_id is not null then
        (xpath('/row/cnt/text()', query_to_xml(format(
          'select count(*) as cnt from plm.%I where crawl_id = %L::uuid',
          c.relname, l.dcp_crawl_id::text), false, true, '')))[1]::text::bigint
      when c.relname = 'dcp_crawl_gap' and l.dcp_crawl_id is not null then
        (select count(*) from plm.dcp_crawl_gap g
          join plm.dcp_crawl_section s on s.id = g.crawl_section_id
          where s.crawl_id = l.dcp_crawl_id)

      -- DCP metadata has its own complete-run clock, separate from path crawls.
      when c.relname = 'dcp_metadata_run' then
        case when l.dcp_metadata_run_id is null then null else 1::bigint end
      when c.relname like 'dcp\_%' and c.has_metadata_run_id
           and l.dcp_metadata_run_id is not null then
        (xpath('/row/cnt/text()', query_to_xml(format(
          'select count(*) as cnt from plm.%I where metadata_run_id = %L::uuid',
          c.relname, l.dcp_metadata_run_id::text), false, true, '')))[1]::text::bigint
      else null
    end as latest_count
  from classified c cross join latest l
)
select
  source_system,
  relname as table_name,
  retained_count as row_count,
  carries_resolution,
  table_comment,
  retained_count as retained_row_count,
  latest_count as latest_complete_row_count,
  case
    when relname in ('opa_capture','opa_capture_scope','opa_property_character_capture')
      then 'latest_complete'
    when relname like 'opa\_%' then 'current_snapshot'
    when relname like 'pmt\_trackerplus\_%'
         and (relname = 'pmt_trackerplus_submission_capture' or has_capture_id)
      then 'latest_complete'
    when relname like 'pmt\_%' and (relname = 'pmt_capture' or has_capture_id) then 'latest_complete'
    when relname like 'nbcu\_%' and (relname = 'nbcu_capture' or has_capture_id) then 'latest_complete'
    when relname in ('sega_submission_capture','sega_submission_property') then 'latest_complete'
    when relname like 'sega\_%' and (relname = 'sega_capture' or has_capture_id) then 'latest_complete'
    when relname like 'peanuts\_%' and (relname = 'peanuts_capture' or has_capture_id) then 'latest_complete'
    when relname like 'wildbrain\_%' and (relname = 'wildbrain_capture' or has_capture_id) then 'latest_complete'
    when relname like 'sesame\_%' and (relname = 'sesame_capture' or has_capture_id) then 'latest_complete'
    when relname like 'coke\_%' and (relname = 'coke_capture' or has_capture_id) then 'latest_complete'
    when relname in ('dcp_crawl','dcp_asset','dcp_crawl_gap')
         or (relname like 'dcp\_%' and has_crawl_id) then 'latest_complete'
    when relname = 'dcp_metadata_run' or (relname like 'dcp\_%' and has_metadata_run_id)
      then 'latest_complete'
    else 'retained_only'
  end as count_basis,
  case
    when relname in ('opa_capture','opa_capture_scope','opa_property_character_capture')
      then case when opa_capture_id is null then null else 'complete' end
    when relname like 'pmt\_trackerplus\_%'
         and (relname = 'pmt_trackerplus_submission_capture' or has_capture_id)
      then case when pmt_trackerplus_capture_id is null then null else 'complete' end
    when relname like 'pmt\_%' and (relname = 'pmt_capture' or has_capture_id)
      then case when pmt_capture_id is null then null else 'complete' end
    when relname like 'nbcu\_%' and (relname = 'nbcu_capture' or has_capture_id)
      then case when nbcu_capture_id is null then null else 'complete' end
    when relname in ('sega_submission_capture','sega_submission_property')
      then case when sega_submission_capture_id is null then null else 'complete' end
    when relname like 'sega\_%' and (relname = 'sega_capture' or has_capture_id)
      then case when sega_capture_id is null then null else 'complete' end
    when relname like 'peanuts\_%' and (relname = 'peanuts_capture' or has_capture_id)
      then case when peanuts_capture_id is null then null else 'complete' end
    when relname like 'wildbrain\_%' and (relname = 'wildbrain_capture' or has_capture_id)
      then case when wildbrain_capture_id is null then null else 'complete' end
    when relname like 'sesame\_%' and (relname = 'sesame_capture' or has_capture_id)
      then case when sesame_capture_id is null then null else 'complete' end
    when relname like 'coke\_%' and (relname = 'coke_capture' or has_capture_id)
      then case when coke_capture_id is null then null else 'complete' end
    when relname in ('dcp_crawl','dcp_asset','dcp_crawl_gap')
         or (relname like 'dcp\_%' and has_crawl_id)
      then case when dcp_crawl_id is null then null else 'complete' end
    when relname = 'dcp_metadata_run' or (relname like 'dcp\_%' and has_metadata_run_id)
      then case when dcp_metadata_run_id is null then null else 'complete' end
    else null
  end as latest_complete_status,
  case
    when relname in ('opa_capture','opa_capture_scope','opa_property_character_capture') then
      case when opa_capture_id is null
        then 'No complete coherent OPA capture exists; latest-complete count is unknown, not zero.'
        else 'Latest complete coherent OPA capture; loading and rejected roots are excluded and no licensed row value is exposed.' end
    when relname like 'opa\_%' then
      'Current upserted OPA snapshot; coherent capture evidence is available only on the three capture tables.'
    when relname like 'pmt\_trackerplus\_%'
         and (relname = 'pmt_trackerplus_submission_capture' or has_capture_id)
         and pmt_trackerplus_capture_id is null then
      'No complete Paramount TrackerPlus submission capture exists; latest-complete count is unknown, not zero.'
    when relname like 'pmt\_trackerplus\_%'
         and (relname = 'pmt_trackerplus_submission_capture' or has_capture_id) then
      'Latest complete Paramount TrackerPlus submission capture; loading and rejected captures excluded.'
    when relname like 'pmt\_%' and (relname = 'pmt_capture' or has_capture_id)
         and pmt_capture_id is null then
      'No complete full Paramount capture exists; latest-complete count is unknown, not zero.'
    when relname like 'pmt\_%' and (relname = 'pmt_capture' or has_capture_id) then
      'Latest complete full Paramount capture; failed, abandoned, targeted and test captures excluded.'
    when relname like 'nbcu\_%' and (relname = 'nbcu_capture' or has_capture_id)
         and nbcu_capture_id is null then
      'No complete NBCU capture exists; latest-complete count is unknown, not zero.'
    when relname like 'nbcu\_%' and (relname = 'nbcu_capture' or has_capture_id) then
      'Latest complete NBCU capture; loading, rejected and abandoned captures excluded.'
    when relname in ('sega_submission_capture','sega_submission_property')
         and sega_submission_capture_id is null then
      'No complete Sega submission vocabulary capture exists; latest-complete count is unknown, not zero.'
    when relname in ('sega_submission_capture','sega_submission_property') then
      'Latest complete read-only Sega submission vocabulary capture; rejected attempts excluded.'
    when relname like 'sega\_%' and (relname = 'sega_capture' or has_capture_id)
         and sega_capture_id is null then
      'No complete Sega capture exists; latest-complete count is unknown, not zero.'
    when relname like 'sega\_%' and (relname = 'sega_capture' or has_capture_id) then
      'Latest complete Sega capture; loading, rejected and abandoned captures excluded.'
    when relname like 'peanuts\_%' and (relname = 'peanuts_capture' or has_capture_id)
         and peanuts_capture_id is null then
      'No complete Peanuts capture exists; latest-complete count is unknown, not zero.'
    when relname like 'peanuts\_%' and (relname = 'peanuts_capture' or has_capture_id) then
      'Latest complete Peanuts capture; loading, rejected and abandoned captures excluded.'
    when relname like 'wildbrain\_%' and (relname = 'wildbrain_capture' or has_capture_id)
         and wildbrain_capture_id is null then
      'No complete WildBrain capture exists; latest-complete count is unknown, not zero.'
    when relname like 'wildbrain\_%' and (relname = 'wildbrain_capture' or has_capture_id) then
      'Latest complete WildBrain capture; loading, rejected and abandoned captures excluded.'
    when relname like 'sesame\_%' and (relname = 'sesame_capture' or has_capture_id)
         and sesame_capture_id is null then
      'No complete Sesame capture exists; latest-complete count is unknown, not zero.'
    when relname like 'sesame\_%' and (relname = 'sesame_capture' or has_capture_id) then
      'Latest complete Sesame capture; loading, rejected and abandoned captures excluded.'
    when relname like 'coke\_%' and (relname = 'coke_capture' or has_capture_id)
         and coke_capture_id is null then
      'No complete Coca-Cola capture exists; latest-complete count is unknown, not zero.'
    when relname like 'coke\_%' and (relname = 'coke_capture' or has_capture_id) then
      'Latest complete Coca-Cola capture; loading and rejected captures excluded.'
    when (relname in ('dcp_crawl','dcp_asset','dcp_crawl_gap')
          or (relname like 'dcp\_%' and has_crawl_id)) and dcp_crawl_id is null then
      'No complete DCP crawl exists; latest-complete membership is unknown, not zero.'
    when relname in ('dcp_crawl','dcp_asset','dcp_crawl_gap')
         or (relname like 'dcp\_%' and has_crawl_id) then
      'Latest complete DCP path crawl, using immutable crawl membership where required.'
    when (relname = 'dcp_metadata_run' or (relname like 'dcp\_%' and has_metadata_run_id))
         and dcp_metadata_run_id is null then
      'No complete DCP metadata run exists; latest-complete count is unknown, not zero.'
    when relname = 'dcp_metadata_run' or (relname like 'dcp\_%' and has_metadata_run_id) then
      'Latest complete DCP metadata run, separate from the path-crawl clock.'
    when relname = 'dcp_style_guide' then
      'Retained style-guide identities only. Historical latest-complete membership cannot be derived from mutable last_seen_crawl_id; NULL is intentional.'
    when relname like 'dcp\_%' then
      'Retained DCP rows only; this table has no exact immutable latest-complete membership path.'
    else
      'Retained rows only; no source-specific latest-complete contract is defined for this table.'
  end as count_note
from counted;
$inventory_exact$;

comment on function api.source_capture_inventory_exact(text) is
  'Opt-in exact source-capture inventory. Counts are scanned per table, scoped early by p_table_name. Latest-complete counts follow each source''s own complete-capture clock, including the Paramount TrackerPlus submission clock, which is deliberately separate from the Paramount Creative Library clock. A NULL latest-complete count means unknown, never zero.';

revoke all on function api.source_capture_inventory_exact(text) from public, anon;
grant execute on function api.source_capture_inventory_exact(text) to authenticated, service_role;

create or replace view api.source_capture_inventory as
with latest as (
  select
    (select capture_id from plm.pmt_capture
      where status = 'complete' and capture_kind = 'full'
      order by completed_at desc nulls last, started_at desc, capture_id desc limit 1)
      as pmt_capture_id,
    (select id from plm.nbcu_capture
      where status = 'complete'
      order by source_captured_at desc, load_completed_at desc, id desc limit 1)
      as nbcu_capture_id,
    (select crawl_id from plm.dcp_crawl
      where status = 'complete'
      order by captured_on desc, finished_at desc, crawl_id desc limit 1)
      as dcp_crawl_id,
    (select metadata_run_id from plm.dcp_metadata_run
      where status = 'complete'
      order by captured_on desc, finished_at desc, metadata_run_id desc limit 1)
      as dcp_metadata_run_id,
    (select id from plm.sega_capture
      where status = 'complete'
      order by source_captured_at desc, load_completed_at desc, id desc limit 1)
      as sega_capture_id,
    (select id from plm.sega_submission_capture
      where status = 'complete'
      order by source_captured_at desc, load_completed_at desc, id desc limit 1)
      as sega_submission_capture_id,
    (select id from plm.peanuts_capture
      where status = 'complete'
      order by source_captured_at desc, load_completed_at desc, id desc limit 1)
      as peanuts_capture_id,
    (select id from plm.wildbrain_capture
      where status = 'complete'
      order by source_captured_at desc, load_completed_at desc, id desc limit 1)
      as wildbrain_capture_id,
    (select id from plm.sesame_capture
      where status = 'complete'
      order by source_captured_at desc, load_completed_at desc, id desc limit 1)
      as sesame_capture_id,
    (select id from plm.coke_capture
      where status = 'complete'
      order by source_captured_at desc, load_completed_at desc, id desc limit 1)
      as coke_capture_id,
    (select id from plm.pmt_trackerplus_submission_capture
      where status = 'complete'
      order by source_captured_at desc, load_completed_at desc, id desc limit 1)
      as pmt_trackerplus_capture_id,
    -- Restored from 20260909115140: the coherent OPA capture root. Dropping it here
    -- would silently revert the three append-only OPA tables to a snapshot count.
    (select id from plm.opa_capture where status = 'complete'
      order by source_captured_at desc, load_completed_at desc, id desc limit 1)
      as opa_capture_id
), catalog as (
  select
    c.oid,
    c.relname,
    exists (select 1 from pg_attribute a where a.attrelid = c.oid
      and a.attnum > 0 and not a.attisdropped and a.attname = 'capture_id') as has_capture_id,
    exists (select 1 from pg_attribute a where a.attrelid = c.oid
      and a.attnum > 0 and not a.attisdropped
      and a.attname = 'submission_capture_id') as has_submission_capture_id,
    exists (select 1 from pg_attribute a where a.attrelid = c.oid
      and a.attnum > 0 and not a.attisdropped and a.attname = 'crawl_id') as has_crawl_id,
    exists (select 1 from pg_attribute a where a.attrelid = c.oid
      and a.attnum > 0 and not a.attisdropped and a.attname = 'metadata_run_id') as has_metadata_run_id,
    exists (
      select 1 from pg_attribute a
      where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
        and a.attname in ('core_property_id','core_character_id','core_licensor_id',
                          'resolved_at','resolution_status')
    ) as carries_resolution,
    obj_description(c.oid, 'pg_class') as table_comment
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'plm' and c.relkind = 'r'
), classified as (
  select c.*,
    case
      when c.relname like 'dcp\_%' or c.relname like 'opa\_%' then 'disney'
      when c.relname like 'pmt\_%' then 'paramount'
      when c.relname like 'nbcu\_%' then 'nbcu'
      when c.relname like 'wb\_%' then 'warner'
      when c.relname like 'erp\_%' then 'coldlion'
      when c.relname like 'sega\_%' then 'sega'
      when c.relname like 'peanuts\_%' then 'peanuts'
      -- Appended BELOW every pre-existing arm, so nothing above can change meaning. It
      -- cannot be shadowed by the `wb\_%` -> warner arm either: `wildbrain_` does not
      -- start with `wb_`.
      when c.relname like 'wildbrain\_%' then 'wildbrain'
      -- Appended below every pre-existing arm; no earlier classification changes.
      when c.relname like 'sesame\_%' then 'sesame'
      when c.relname like 'coke\_%' then 'coca-cola'
      -- Appended below every pre-existing arm. These two families landed AFTER the
      -- inventory was written and were reported as 'other'. Neither can shadow an
      -- earlier arm: no earlier prefix is a prefix of 'marvel_' or 'wwe_'.
      when c.relname like 'marvel\_%' then 'marvel'
      when c.relname like 'wwe\_%' then 'wwe'
      else 'other'
    end as source_system
  from catalog c
), counted as (
  select c.*, l.*,
    null::bigint as retained_count,
    null::bigint as latest_count
  from classified c cross join latest l
)
select
  source_system,
  relname as table_name,
  retained_count as row_count,
  carries_resolution,
  table_comment,
  retained_count as retained_row_count,
  latest_count as latest_complete_row_count,
  case
    when relname in ('opa_capture','opa_capture_scope','opa_property_character_capture')
      then 'latest_complete'
    when relname like 'opa\_%' then 'current_snapshot'
    when relname like 'pmt\_trackerplus\_%'
         and (relname = 'pmt_trackerplus_submission_capture' or has_capture_id)
      then 'latest_complete'
    when relname like 'pmt\_%' and (relname = 'pmt_capture' or has_capture_id) then 'latest_complete'
    when relname like 'nbcu\_%' and (relname = 'nbcu_capture' or has_capture_id) then 'latest_complete'
    when relname in ('sega_submission_capture','sega_submission_property') then 'latest_complete'
    when relname like 'sega\_%' and (relname = 'sega_capture' or has_capture_id) then 'latest_complete'
    when relname like 'peanuts\_%' and (relname = 'peanuts_capture' or has_capture_id) then 'latest_complete'
    when relname like 'wildbrain\_%' and (relname = 'wildbrain_capture' or has_capture_id) then 'latest_complete'
    when relname like 'sesame\_%' and (relname = 'sesame_capture' or has_capture_id) then 'latest_complete'
    when relname like 'coke\_%' and (relname = 'coke_capture' or has_capture_id) then 'latest_complete'
    when relname in ('dcp_crawl','dcp_asset','dcp_crawl_gap')
         or (relname like 'dcp\_%' and has_crawl_id) then 'latest_complete'
    when relname = 'dcp_metadata_run' or (relname like 'dcp\_%' and has_metadata_run_id)
      then 'latest_complete'
    else 'retained_only'
  end as count_basis,
  case
    when relname in ('opa_capture','opa_capture_scope','opa_property_character_capture')
      then case when opa_capture_id is null then null else 'complete' end
    when relname like 'pmt\_trackerplus\_%'
         and (relname = 'pmt_trackerplus_submission_capture' or has_capture_id)
      then case when pmt_trackerplus_capture_id is null then null else 'complete' end
    when relname like 'pmt\_%' and (relname = 'pmt_capture' or has_capture_id)
      then case when pmt_capture_id is null then null else 'complete' end
    when relname like 'nbcu\_%' and (relname = 'nbcu_capture' or has_capture_id)
      then case when nbcu_capture_id is null then null else 'complete' end
    when relname in ('sega_submission_capture','sega_submission_property')
      then case when sega_submission_capture_id is null then null else 'complete' end
    when relname like 'sega\_%' and (relname = 'sega_capture' or has_capture_id)
      then case when sega_capture_id is null then null else 'complete' end
    when relname like 'peanuts\_%' and (relname = 'peanuts_capture' or has_capture_id)
      then case when peanuts_capture_id is null then null else 'complete' end
    when relname like 'wildbrain\_%' and (relname = 'wildbrain_capture' or has_capture_id)
      then case when wildbrain_capture_id is null then null else 'complete' end
    when relname like 'sesame\_%' and (relname = 'sesame_capture' or has_capture_id)
      then case when sesame_capture_id is null then null else 'complete' end
    when relname like 'coke\_%' and (relname = 'coke_capture' or has_capture_id)
      then case when coke_capture_id is null then null else 'complete' end
    when relname in ('dcp_crawl','dcp_asset','dcp_crawl_gap')
         or (relname like 'dcp\_%' and has_crawl_id)
      then case when dcp_crawl_id is null then null else 'complete' end
    when relname = 'dcp_metadata_run' or (relname like 'dcp\_%' and has_metadata_run_id)
      then case when dcp_metadata_run_id is null then null else 'complete' end
    else null
  end as latest_complete_status,
  case
    when relname in ('opa_capture','opa_capture_scope','opa_property_character_capture') then
      case when opa_capture_id is null
        then 'No complete coherent OPA capture exists; latest-complete count is unknown, not zero.'
        else 'Latest complete coherent OPA capture; loading and rejected roots are excluded and no licensed row value is exposed.' end
    when relname like 'opa\_%' then
      'Current upserted OPA snapshot; coherent capture evidence is available only on the three capture tables.'
    when relname like 'pmt\_trackerplus\_%'
         and (relname = 'pmt_trackerplus_submission_capture' or has_capture_id)
         and pmt_trackerplus_capture_id is null then
      'No complete Paramount TrackerPlus submission capture exists; latest-complete count is unknown, not zero.'
    when relname like 'pmt\_trackerplus\_%'
         and (relname = 'pmt_trackerplus_submission_capture' or has_capture_id) then
      'Latest complete Paramount TrackerPlus submission capture; loading and rejected captures excluded.'
    when relname like 'pmt\_%' and (relname = 'pmt_capture' or has_capture_id)
         and pmt_capture_id is null then
      'No complete full Paramount capture exists; latest-complete count is unknown, not zero.'
    when relname like 'pmt\_%' and (relname = 'pmt_capture' or has_capture_id) then
      'Latest complete full Paramount capture; failed, abandoned, targeted and test captures excluded.'
    when relname like 'nbcu\_%' and (relname = 'nbcu_capture' or has_capture_id)
         and nbcu_capture_id is null then
      'No complete NBCU capture exists; latest-complete count is unknown, not zero.'
    when relname like 'nbcu\_%' and (relname = 'nbcu_capture' or has_capture_id) then
      'Latest complete NBCU capture; loading, rejected and abandoned captures excluded.'
    when relname in ('sega_submission_capture','sega_submission_property')
         and sega_submission_capture_id is null then
      'No complete Sega submission vocabulary capture exists; latest-complete count is unknown, not zero.'
    when relname in ('sega_submission_capture','sega_submission_property') then
      'Latest complete read-only Sega submission vocabulary capture; rejected attempts excluded.'
    when relname like 'sega\_%' and (relname = 'sega_capture' or has_capture_id)
         and sega_capture_id is null then
      'No complete Sega capture exists; latest-complete count is unknown, not zero.'
    when relname like 'sega\_%' and (relname = 'sega_capture' or has_capture_id) then
      'Latest complete Sega capture; loading, rejected and abandoned captures excluded.'
    when relname like 'peanuts\_%' and (relname = 'peanuts_capture' or has_capture_id)
         and peanuts_capture_id is null then
      'No complete Peanuts capture exists; latest-complete count is unknown, not zero.'
    when relname like 'peanuts\_%' and (relname = 'peanuts_capture' or has_capture_id) then
      'Latest complete Peanuts capture; loading, rejected and abandoned captures excluded.'
    when relname like 'wildbrain\_%' and (relname = 'wildbrain_capture' or has_capture_id)
         and wildbrain_capture_id is null then
      'No complete WildBrain capture exists; latest-complete count is unknown, not zero.'
    when relname like 'wildbrain\_%' and (relname = 'wildbrain_capture' or has_capture_id) then
      'Latest complete WildBrain capture; loading, rejected and abandoned captures excluded.'
    when relname like 'sesame\_%' and (relname = 'sesame_capture' or has_capture_id)
         and sesame_capture_id is null then
      'No complete Sesame capture exists; latest-complete count is unknown, not zero.'
    when relname like 'sesame\_%' and (relname = 'sesame_capture' or has_capture_id) then
      'Latest complete Sesame capture; loading, rejected and abandoned captures excluded.'
    when relname like 'coke\_%' and (relname = 'coke_capture' or has_capture_id)
         and coke_capture_id is null then
      'No complete Coca-Cola capture exists; latest-complete count is unknown, not zero.'
    when relname like 'coke\_%' and (relname = 'coke_capture' or has_capture_id) then
      'Latest complete Coca-Cola capture; loading and rejected captures excluded.'
    when (relname in ('dcp_crawl','dcp_asset','dcp_crawl_gap')
          or (relname like 'dcp\_%' and has_crawl_id)) and dcp_crawl_id is null then
      'No complete DCP crawl exists; latest-complete membership is unknown, not zero.'
    when relname in ('dcp_crawl','dcp_asset','dcp_crawl_gap')
         or (relname like 'dcp\_%' and has_crawl_id) then
      'Latest complete DCP path crawl, using immutable crawl membership where required.'
    when (relname = 'dcp_metadata_run' or (relname like 'dcp\_%' and has_metadata_run_id))
         and dcp_metadata_run_id is null then
      'No complete DCP metadata run exists; latest-complete count is unknown, not zero.'
    when relname = 'dcp_metadata_run' or (relname like 'dcp\_%' and has_metadata_run_id) then
      'Latest complete DCP metadata run, separate from the path-crawl clock.'
    when relname = 'dcp_style_guide' then
      'Retained style-guide identities only. Historical latest-complete membership cannot be derived from mutable last_seen_crawl_id; NULL is intentional.'
    when relname like 'dcp\_%' then
      'Retained DCP rows only; this table has no exact immutable latest-complete membership path.'
    else
      'Retained rows only; no source-specific latest-complete contract is defined for this table.'
  end as count_note
from counted;;

comment on view api.source_capture_inventory is
  'Browser-safe source-capture inventory metadata: source_system, table_name, carries_resolution and the table comment, with row counts intentionally NULL. Use api.source_capture_inventory_exact(table_name) for exact retained and latest-complete counts. No capture identity, source hash, source path, authentication evidence or licensed row value appears here.';

revoke all on api.source_capture_inventory from public, anon;
grant select on api.source_capture_inventory to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. DB Data Admin RPC: add exactly three new source-purpose groups.
--      Paramount Submissions  <- latest complete TrackerPlus capture
--      Coca-Cola Creative     <- latest complete plm.coke_capture options
--      WWE Submissions        <- latest complete plm.wwe_submission_capture
--    Paramount Creative stays a separate group. No Coca-Cola Submissions and no
--    WWE Creative vocabulary is manufactured from inferred, folder, tag, guide,
--    free-text or asset evidence. The licensing-manager gate, privacy-safe
--    envelope, source identity/provenance, mapping and contract status, cursor
--    pagination and unresolved-Creative highlighting are untouched: this patch
--    only inserts new CTEs, new union arms and new source_purpose cases into the
--    reviewed definition, which no migration restates in full.
-- ---------------------------------------------------------------------------
do $migration$
declare
  v_definition text;
  v_updated text;
  v_anchor text;
  v_hits integer;
  v_ranked_old text := $patch$  ), sega_ranked as (
    select p.*,
      row_number() over (
        partition by p.property_source_id
        order by c.source_captured_at desc, p.capture_id::text desc
      ) as capture_rank
    from plm.sega_property p
    join plm.sega_capture c on c.id = p.capture_id
    where c.status = 'complete'
  ), source_rows as not materialized ($patch$;
  v_ranked_new text := $patch$  ), sega_ranked as (
    select p.*,
      row_number() over (
        partition by p.property_source_id
        order by c.source_captured_at desc, p.capture_id::text desc
      ) as capture_rank
    from plm.sega_property p
    join plm.sega_capture c on c.id = p.capture_id
    where c.status = 'complete'
  ), pmt_trackerplus_latest as (
    select c.id
    from plm.pmt_trackerplus_submission_capture c
    where c.status = 'complete'
    order by c.source_captured_at desc, c.load_completed_at desc, c.id desc
    limit 1
  ), coke_property_latest as (
    select c.id
    from plm.coke_capture c
    where c.status = 'complete'
    order by c.source_captured_at desc, c.load_completed_at desc, c.id desc
    limit 1
  ), wwe_submission_latest as (
    select c.id
    from plm.wwe_submission_capture c
    where c.status = 'complete'
    order by c.source_captured_at desc, c.load_completed_at desc, c.id desc
    limit 1
  ), source_rows as not materialized ($patch$;
  v_arms_old text := $patch$    union all
    select 'sega-creative', 'Sega - Creative',
           'sega_dsi', 'plm.sega_property', p.property_source_id,
           p.property_label, p.source_status, 'portal_ip_registry',
           null::timestamptz, p.capture_id::text
    from sega_ranked p
    where p.capture_rank = 1
  ), keyed as ($patch$;
  v_arms_new text := $patch$    union all
    select 'sega-creative', 'Sega - Creative',
           'sega_dsi', 'plm.sega_property', p.property_source_id,
           p.property_label, p.source_status, 'portal_ip_registry',
           null::timestamptz, p.capture_id::text
    from sega_ranked p
    where p.capture_rank = 1

    union all
    select 'paramount-submissions', 'Paramount - Submissions (TrackerPlus)',
           'paramount_trackerplus', 'plm.pmt_trackerplus_submission_property',
           p.property_local_key, p.exact_label, 'complete',
           'trackerplus_submission_property_picker',
           null::timestamptz, p.capture_id::text
    from plm.pmt_trackerplus_submission_property p
    join pmt_trackerplus_latest c on c.id = p.capture_id

    union all
    select 'coca-cola-creative', 'Coca-Cola - Creative (Asset Library Property choices)',
           'coke_brandcomply', 'plm.coke_asset_property_option', o.option_key,
           o.exact_label, o.classification_status, 'asset_library_property_choice',
           null::timestamptz, o.capture_id::text
    from (
      select distinct on (opt.option_key)
             opt.option_key, opt.exact_label, opt.classification_status, opt.capture_id
      from plm.coke_asset_property_option opt
      join coke_property_latest c on c.id = opt.capture_id
      order by opt.option_key, opt.ordinal, opt.exact_label
    ) o

    union all
    select 'wwe-submissions', 'WWE - Submissions', 'wwe_submissions',
           'plm.wwe_property', p.property_source_id, p.property_label,
           case when p.parent_property_source_id is null then 'root' else 'descendant' end,
           'submission_property_picker', null::timestamptz, p.capture_id::text
    from plm.wwe_property p
    join wwe_submission_latest c on c.id = p.capture_id
  ), keyed as ($patch$;
  v_purpose_old text := $patch$        when s.source_table = 'plm.sega_submission_property' then 'Submissions'
        when s.source_table = 'plm.sega_property' then 'Creative'
        else 'Creative' end::text as source_purpose,$patch$;
  v_purpose_new text := $patch$        when s.source_table = 'plm.sega_submission_property' then 'Submissions'
        when s.source_table = 'plm.sega_property' then 'Creative'
        when s.source_table = 'plm.pmt_trackerplus_submission_property'
          then 'Submissions (TrackerPlus)'
        when s.source_table = 'plm.coke_asset_property_option'
          then 'Creative (Asset Library Property choices)'
        when s.source_table = 'plm.wwe_property' then 'Submissions'
        else 'Creative' end::text as source_purpose,$patch$;
begin
  select pg_get_functiondef(
    'api.db_data_admin_scraped_properties(text,text,integer)'::regprocedure
  ) into v_definition;

  if position(v_ranked_new in v_definition) <> 0
     and position(v_arms_new in v_definition) <> 0
     and position(v_purpose_new in v_definition) <> 0 then
    return;
  end if;

  if position(v_ranked_old in v_definition) = 0
     or position(v_arms_old in v_definition) = 0
     or position(v_purpose_old in v_definition) = 0 then
    raise exception using
      errcode = 'P0001',
      message = 'db_data_admin_scraped_properties differs from the reviewed #2579 definition';
  end if;

  -- replace() rewrites EVERY copy. A missing anchor is already refused above, but
  -- a DUPLICATE anchor would be rewritten in both places and still satisfy the
  -- "new text present" checks below, while the production-verification sidecar
  -- asserts each anchor is unique. Count them, and refuse anything but exactly one.
  foreach v_anchor in array array[v_ranked_old, v_arms_old, v_purpose_old] loop
    v_hits := (length(v_definition) - length(replace(v_definition, v_anchor, '')))
              / length(v_anchor);
    if v_hits <> 1 then
      raise exception using
        errcode = 'P0001',
        message = format(
          'db_data_admin_scraped_properties #2579 anchor is not unique: %s occurrence(s), expected exactly 1',
          v_hits);
    end if;
  end loop;

  v_updated := replace(v_definition, v_ranked_old, v_ranked_new);
  v_updated := replace(v_updated, v_arms_old, v_arms_new);
  v_updated := replace(v_updated, v_purpose_old, v_purpose_new);

  if v_updated = v_definition
     or position(v_ranked_new in v_updated) = 0
     or position(v_arms_new in v_updated) = 0
     or position(v_purpose_new in v_updated) = 0
     or position('plm.pmt_property' in v_updated) = 0
     or position('plm.sega_submission_property' in v_updated) = 0 then
    raise exception using
      errcode = 'P0001',
      message = 'db_data_admin_scraped_properties #2579 replacement was not exact';
  end if;

  execute v_updated;
end;
$migration$;

comment on function api.db_data_admin_scraped_properties(text,text,integer) is
  'Licensing-manager-gated source Property vocabulary across every licensor source family. Each licensor keeps separate Creative and Submissions identities: Paramount Creative (Creative Library) and Paramount Submissions (TrackerPlus) are distinct groups, Coca-Cola is exposed only as a Creative asset-library Property choice vocabulary, and WWE is exposed only as Submissions. Each new group reads exactly one latest complete capture, so separate captures are never combined and retained duplicates are never counted as current vocabulary. Disney/Marvel/Lucasfilm/Pixar OPA authority, ASGARD Marvel Creative authority, signed-contract conflict handling, cursor pagination, unresolved-Creative highlighting and the restricted privacy-safe response envelope are unchanged.';

revoke all on function api.db_data_admin_scraped_properties(text,text,integer)
  from public, anon, service_role;
grant execute on function api.db_data_admin_scraped_properties(text,text,integer)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Fail-closed verification of this migration's own structural claims.
-- ---------------------------------------------------------------------------
do $verify$
declare
  v_def text;
  v_bad integer;
begin
  v_def := pg_get_functiondef(
    'api.db_data_admin_scraped_properties(text,text,integer)'::regprocedure);
  if position('plm.pmt_trackerplus_submission_property' in v_def) = 0
     or position('plm.coke_asset_property_option' in v_def) = 0
     or position('plm.wwe_property' in v_def) = 0
     or position('plm.pmt_property' in v_def) = 0 then
    raise exception '#2579: the RPC does not expose all four Property vocabularies';
  end if;
  if position('plm.wwe_asset_property_inferred' in v_def) <> 0
     or position('plm.wwe_style_guide_property_inferred' in v_def) <> 0
     or position('plm.wwe_character_property_inferred' in v_def) <> 0
     or position('plm.coke_approval_vocabulary_value' in v_def) <> 0 then
    raise exception '#2579: the RPC manufactures an inferred WWE Creative or Coca-Cola Submissions vocabulary';
  end if;

  -- Catalogue metadata only. This block must not read api.source_capture_inventory
  -- or any plm.* rows (scripts/check-sql.sh), so the classification is proved from
  -- the definition text the apply just installed. The LIVE classification is proved
  -- after apply by catalog contract all_licensor_property_source_coverage_v1, which
  -- refuses any marvel_, wwe_ or pmt_trackerplus_ table still reported as 'other'.
  v_def := pg_get_functiondef('api.source_capture_inventory_exact(text)'::regprocedure);
  if position('pmt_trackerplus_capture_id' in v_def) = 0
     or position('marvel' in v_def) = 0
     or position('wwe' in v_def) = 0 then
    raise exception '#2579: the inventory still leaves a named family unclassified';
  end if;
  if position('pmt_trackerplus_submission_capture' in v_def) = 0
     or position('latest_complete' in v_def) = 0 then
    raise exception '#2579: the TrackerPlus family has no latest-complete clock';
  end if;
  if position('query_to_xml' in pg_get_viewdef('api.source_capture_inventory'::regclass)) <> 0 then
    raise exception '#2579: the browser-safe inventory view scans rows';
  end if;

  select count(*) into v_bad from information_schema.role_table_grants
   where table_schema = 'plm'
     and table_name like 'pmt\_trackerplus\_%'
     and grantee in ('service_role','authenticated','anon','PUBLIC')
     and privilege_type in ('UPDATE','DELETE','TRUNCATE');
  if v_bad <> 0 then
    raise exception '#2579: % mutating grants survive on the TrackerPlus landing', v_bad;
  end if;
  select count(*) into v_bad from information_schema.role_table_grants
   where table_schema = 'plm'
     and table_name like 'pmt\_trackerplus\_%'
     and grantee in ('anon','PUBLIC');
  if v_bad <> 0 then
    raise exception '#2579: % public/anon grants survive on the TrackerPlus landing', v_bad;
  end if;
  if not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                  where n.nspname = 'plm'
                    and c.relname = 'pmt_trackerplus_submission_property'
                    and c.relrowsecurity) then
    raise exception '#2579: row level security is not enabled on the TrackerPlus vocabulary';
  end if;
end;
$verify$;
