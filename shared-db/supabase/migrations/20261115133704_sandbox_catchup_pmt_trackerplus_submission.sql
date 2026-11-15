-- #6356 sandbox catch-up batch 1: DesignFlow sandbox (xupnyeifmpsacrqahwwm) ONLY. Never apply to shared preview or production.
-- Ports the Paramount TrackerPlus submission capture tables and loaders from production, additive only.
-- derived-from: none

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION plm.begin_pmt_trackerplus_submission_capture(p_capture_key text, p_source_repository text, p_source_commit_sha text, p_source_manifest_sha256 text, p_source_captured_at timestamp with time zone, p_expected_property_count integer, p_expected_property_manifest_sha256 text, p_created_by text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'plm'
AS $function$
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
$function$
;
revoke all on function plm.begin_pmt_trackerplus_submission_capture(p_capture_key text, p_source_repository text, p_source_commit_sha text, p_source_manifest_sha256 text, p_source_captured_at timestamp with time zone, p_expected_property_count integer, p_expected_property_manifest_sha256 text, p_created_by text) from public, anon, authenticated;
grant execute on function plm.begin_pmt_trackerplus_submission_capture(p_capture_key text, p_source_repository text, p_source_commit_sha text, p_source_manifest_sha256 text, p_source_captured_at timestamp with time zone, p_expected_property_count integer, p_expected_property_manifest_sha256 text, p_created_by text) to service_role;
CREATE OR REPLACE FUNCTION plm.finalize_pmt_trackerplus_submission_capture(p_capture_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'plm'
AS $function$
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
$function$
;
revoke all on function plm.finalize_pmt_trackerplus_submission_capture(p_capture_id uuid) from public, anon, authenticated;
grant execute on function plm.finalize_pmt_trackerplus_submission_capture(p_capture_id uuid) to service_role;
CREATE OR REPLACE FUNCTION plm.load_pmt_trackerplus_submission_capture_chunk(p_capture_id uuid, p_chunk_index integer, p_rows jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'plm'
AS $function$
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
$function$
;
revoke all on function plm.load_pmt_trackerplus_submission_capture_chunk(p_capture_id uuid, p_chunk_index integer, p_rows jsonb) from public, anon, authenticated;
grant execute on function plm.load_pmt_trackerplus_submission_capture_chunk(p_capture_id uuid, p_chunk_index integer, p_rows jsonb) to service_role;
create table if not exists plm.pmt_trackerplus_submission_capture (
  id uuid not null,
  capture_key text not null,
  source_repository text not null,
  source_commit_sha text not null,
  source_manifest_sha256 text not null,
  source_captured_at timestamp with time zone not null,
  load_started_at timestamp with time zone default now() not null,
  load_completed_at timestamp with time zone,
  status text default 'loading'::text not null,
  expected_property_count integer not null,
  expected_property_manifest_sha256 text not null,
  observed_property_count integer default 0 not null,
  observed_property_manifest_sha256 text,
  chunk_ledger jsonb default '{}'::jsonb not null,
  errors jsonb default '[]'::jsonb not null,
  created_by text not null
);
alter table plm.pmt_trackerplus_submission_capture add constraint "pmt_trackerplus_submission_c_expected_property_manifest_s_check" CHECK ((expected_property_manifest_sha256 ~ '^[0-9a-f]{64}$'::text));
alter table plm.pmt_trackerplus_submission_capture add constraint "pmt_trackerplus_submission_c_observed_property_manifest_s_check" CHECK (((observed_property_manifest_sha256 IS NULL) OR (observed_property_manifest_sha256 ~ '^[0-9a-f]{64}$'::text)));
alter table plm.pmt_trackerplus_submission_capture add constraint "pmt_trackerplus_submission_captur_expected_property_count_check" CHECK ((expected_property_count >= 0));
alter table plm.pmt_trackerplus_submission_capture add constraint "pmt_trackerplus_submission_captur_observed_property_count_check" CHECK ((observed_property_count >= 0));
alter table plm.pmt_trackerplus_submission_capture add constraint "pmt_trackerplus_submission_capture_capture_key_check" CHECK ((btrim(capture_key) <> ''::text));
alter table plm.pmt_trackerplus_submission_capture add constraint "pmt_trackerplus_submission_capture_capture_key_key" UNIQUE (capture_key);
alter table plm.pmt_trackerplus_submission_capture add constraint "pmt_trackerplus_submission_capture_chunk_ledger_check" CHECK ((jsonb_typeof(chunk_ledger) = 'object'::text));
alter table plm.pmt_trackerplus_submission_capture add constraint "pmt_trackerplus_submission_capture_complete_requirements_chk" CHECK (((status <> 'complete'::text) OR ((observed_property_count = expected_property_count) AND (observed_property_manifest_sha256 IS NOT NULL) AND (observed_property_manifest_sha256 = expected_property_manifest_sha256) AND (jsonb_array_length(errors) = 0))));
alter table plm.pmt_trackerplus_submission_capture add constraint "pmt_trackerplus_submission_capture_complete_time_chk" CHECK (((status = 'complete'::text) = (load_completed_at IS NOT NULL)));
alter table plm.pmt_trackerplus_submission_capture add constraint "pmt_trackerplus_submission_capture_created_by_check" CHECK ((btrim(created_by) <> ''::text));
alter table plm.pmt_trackerplus_submission_capture add constraint "pmt_trackerplus_submission_capture_errors_check" CHECK ((jsonb_typeof(errors) = 'array'::text));
alter table plm.pmt_trackerplus_submission_capture add constraint "pmt_trackerplus_submission_capture_pkey" PRIMARY KEY (id);
alter table plm.pmt_trackerplus_submission_capture add constraint "pmt_trackerplus_submission_capture_source_commit_sha_check" CHECK ((source_commit_sha ~ '^[0-9a-f]{40}$'::text));
alter table plm.pmt_trackerplus_submission_capture add constraint "pmt_trackerplus_submission_capture_source_manifest_sha256_check" CHECK ((source_manifest_sha256 ~ '^[0-9a-f]{64}$'::text));
alter table plm.pmt_trackerplus_submission_capture add constraint "pmt_trackerplus_submission_capture_source_repository_check" CHECK ((btrim(source_repository) <> ''::text));
alter table plm.pmt_trackerplus_submission_capture add constraint "pmt_trackerplus_submission_capture_status_check" CHECK ((status = ANY (ARRAY['loading'::text, 'complete'::text, 'rejected'::text])));
alter table plm.pmt_trackerplus_submission_capture enable row level security;
create policy "pmt_trackerplus_submission_capture_staff_read" on plm.pmt_trackerplus_submission_capture as permissive for select to authenticated using (app.has_any_role(ARRAY['administrator'::app.app_role, 'sales'::app.app_role, 'licensing'::app.app_role, 'designer'::app.app_role]));
comment on table plm.pmt_trackerplus_submission_capture is 'Append-only Paramount TrackerPlus submission-vocabulary capture root. A capture is complete only when its observed property count and observed exact-label manifest hash match the expected values declared before loading and no error was recorded. Private source commit, manifest hash and capture time stay in this landing schema and are never exposed through api.';
create table if not exists plm.pmt_trackerplus_submission_property (
  capture_id uuid not null,
  property_local_key text not null,
  exact_label text not null,
  identity_method text default 'exact-label-sha256'::text not null,
  ordinal integer not null,
  source_field text not null,
  raw jsonb not null
);
alter table plm.pmt_trackerplus_submission_property add constraint "pmt_trackerplus_submission_property_exact_label_check" CHECK ((btrim(exact_label) <> ''::text));
alter table plm.pmt_trackerplus_submission_property add constraint "pmt_trackerplus_submission_property_identity_method_check" CHECK ((identity_method = 'exact-label-sha256'::text));
alter table plm.pmt_trackerplus_submission_property add constraint "pmt_trackerplus_submission_property_local_key_chk" CHECK ((property_local_key = encode(sha256(convert_to(exact_label, 'UTF8'::name)), 'hex'::text)));
alter table plm.pmt_trackerplus_submission_property add constraint "pmt_trackerplus_submission_property_no_source_id_chk" CHECK (((NOT (raw ? 'property_source_id'::text)) AND (NOT (raw ? 'source_id'::text)) AND (NOT (raw ? 'portal_record_id'::text))));
alter table plm.pmt_trackerplus_submission_property add constraint "pmt_trackerplus_submission_property_ordinal_check" CHECK ((ordinal >= 0));
alter table plm.pmt_trackerplus_submission_property add constraint "pmt_trackerplus_submission_property_ordinal_uq" UNIQUE (capture_id, ordinal);
alter table plm.pmt_trackerplus_submission_property add constraint "pmt_trackerplus_submission_property_pkey" PRIMARY KEY (capture_id, property_local_key);
alter table plm.pmt_trackerplus_submission_property add constraint "pmt_trackerplus_submission_property_property_local_key_check" CHECK ((property_local_key ~ '^[0-9a-f]{64}$'::text));
alter table plm.pmt_trackerplus_submission_property add constraint "pmt_trackerplus_submission_property_raw_check" CHECK ((jsonb_typeof(raw) = 'object'::text));
alter table plm.pmt_trackerplus_submission_property add constraint "pmt_trackerplus_submission_property_source_field_check" CHECK ((btrim(source_field) <> ''::text));
alter table plm.pmt_trackerplus_submission_property enable row level security;
create policy "pmt_trackerplus_submission_property_staff_read" on plm.pmt_trackerplus_submission_property as permissive for select to authenticated using (app.has_any_role(ARRAY['administrator'::app.app_role, 'sales'::app.app_role, 'licensing'::app.app_role, 'designer'::app.app_role]));
-- trigger trackerplus_property_refresh_submission_name is created by 20261113183820-equivalent follow-up batch
comment on table plm.pmt_trackerplus_submission_property is 'Paramount TrackerPlus submission Property vocabulary for one capture. property_local_key is the deterministic SHA-256 of the exact UTF-8 label (identity_method exact-label-sha256) because the authenticated submission picker exposes no stable portal record ID. It is a source-local key only: it is never a Paramount source ID, is never resolved against plm.pmt_property, and no fabricated portal identifier may be stored on these rows.';
alter table plm.pmt_trackerplus_submission_property add constraint "pmt_trackerplus_submission_property_capture_id_fkey" FOREIGN KEY (capture_id) REFERENCES plm.pmt_trackerplus_submission_capture(id);

