-- Issue #1451: Sega Product Approval submission vocabulary and inferred guide/character
-- Property evidence. No licensed names or rows ship in this public migration.

create table plm.sega_submission_capture (
  id                          uuid primary key default gen_random_uuid(),
  capture_key                 text not null unique,
  source_repository           text not null,
  source_commit_sha           text not null,
  source_hash                 text not null,
  source_url                  text not null,
  source_captured_at          timestamptz not null,
  load_started_at             timestamptz not null default now(),
  load_completed_at           timestamptz null,
  status                      text not null default 'loading',
  selected_contract_source_id text not null,
  expected_counts             jsonb not null,
  observed_counts             jsonb not null default '{}'::jsonb,
  save_clicked                boolean not null,
  submission_list_before_hash text not null,
  submission_list_after_hash  text not null,
  no_submission_created       boolean not null,
  error_summary               jsonb not null default '[]'::jsonb,
  raw_summary                 jsonb not null,
  created_by                  text not null,

  constraint sega_submission_capture_status_chk
    check (status in ('loading','complete','rejected','abandoned')),
  constraint sega_submission_capture_key_nonblank_chk check (btrim(capture_key) <> ''),
  constraint sega_submission_capture_repository_nonblank_chk
    check (btrim(source_repository) <> ''),
  constraint sega_submission_capture_commit_sha_chk
    check (source_commit_sha ~ '^[0-9a-f]{40}$'),
  constraint sega_submission_capture_source_hash_chk
    check (source_hash ~ '^[0-9a-f]{64}$'),
  constraint sega_submission_capture_url_nonblank_chk check (btrim(source_url) <> ''),
  constraint sega_submission_capture_contract_nonblank_chk
    check (btrim(selected_contract_source_id) <> ''),
  constraint sega_submission_capture_before_hash_chk
    check (submission_list_before_hash ~ '^[0-9a-f]{64}$'),
  constraint sega_submission_capture_after_hash_chk
    check (submission_list_after_hash ~ '^[0-9a-f]{64}$'),
  constraint sega_submission_capture_created_by_nonblank_chk check (btrim(created_by) <> ''),
  constraint sega_submission_capture_expected_obj_chk
    check (jsonb_typeof(expected_counts) = 'object'),
  constraint sega_submission_capture_observed_obj_chk
    check (jsonb_typeof(observed_counts) = 'object'),
  constraint sega_submission_capture_errors_arr_chk
    check (jsonb_typeof(error_summary) = 'array'),
  constraint sega_submission_capture_raw_obj_chk check (jsonb_typeof(raw_summary) = 'object'),
  constraint sega_submission_capture_complete_time_chk
    check ((status = 'complete') = (load_completed_at is not null)),
  constraint sega_submission_capture_complete_read_only_chk
    check (
      status <> 'complete' or (
        save_clicked = false
        and no_submission_created = true
        and submission_list_before_hash = submission_list_after_hash
        and jsonb_array_length(error_summary) = 0
      )
    )
);

comment on table plm.sega_submission_capture is
  'LICENSED SEGA SOURCE EVIDENCE, NOT CANONICAL MASTER DATA. Append-only read-only '
  'Product Approval vocabulary captures. A complete row proves Save was never clicked, '
  'no submission was created, and the submission list hash was unchanged. service_role '
  'may read only; begin/finalize are the sole root writers.';

create table plm.sega_submission_property (
  submission_capture_id uuid not null,
  property_source_id    text not null,
  property_label        text not null,
  source_url            text not null,
  source_hash           text not null,
  raw                   jsonb not null,

  constraint sega_submission_property_pkey
    primary key (submission_capture_id,property_source_id),
  constraint sega_submission_property_capture_fkey
    foreign key (submission_capture_id) references plm.sega_submission_capture(id)
    on delete restrict,
  constraint sega_submission_property_id_nonblank_chk check (btrim(property_source_id) <> ''),
  constraint sega_submission_property_label_nonblank_chk check (btrim(property_label) <> ''),
  constraint sega_submission_property_url_nonblank_chk check (btrim(source_url) <> ''),
  constraint sega_submission_property_hash_nonblank_chk check (btrim(source_hash) <> ''),
  constraint sega_submission_property_raw_obj_chk check (jsonb_typeof(raw) = 'object')
);

comment on table plm.sega_submission_property is
  'LICENSED SEGA SOURCE EVIDENCE, NOT CANONICAL MASTER DATA. Exact source IDs and labels '
  'offered by the selected contract Product Approval Property picker for one read-only '
  'submission capture. Absence never deletes or deactivates a registry Property.';

create table plm.sega_style_guide_property_inferred (
  capture_id                 uuid not null,
  catalog_source_id          text not null,
  property_source_id         text not null,
  evidence_key               text not null,
  evidence_catalog_source_id text not null,
  match_method               text not null,
  rule_version               text not null,
  confidence                 numeric(4,3) not null,
  relationship_truth         text not null default 'inferred',
  raw                        jsonb not null,

  constraint sega_style_guide_property_inferred_pkey
    primary key (capture_id,catalog_source_id,property_source_id,evidence_key),
  constraint sega_style_guide_property_inferred_candidate_fkey
    foreign key (capture_id,catalog_source_id)
    references plm.sega_style_guide_candidate(capture_id,catalog_source_id) on delete restrict,
  constraint sega_style_guide_property_inferred_property_fkey
    foreign key (capture_id,property_source_id)
    references plm.sega_property(capture_id,property_source_id) on delete restrict,
  constraint sega_style_guide_property_inferred_catalog_fkey
    foreign key (capture_id,evidence_catalog_source_id)
    references plm.sega_catalog(capture_id,catalog_source_id) on delete restrict,
  constraint sega_style_guide_property_inferred_method_chk
    check (match_method in ('exact_label','normalized_label','subtree_of_match')),
  constraint sega_style_guide_property_inferred_truth_chk
    check (relationship_truth = 'inferred'),
  constraint sega_style_guide_property_inferred_confidence_chk
    check (confidence between 0 and 1),
  constraint sega_style_guide_property_inferred_candidate_nonblank_chk
    check (btrim(catalog_source_id) <> ''),
  constraint sega_style_guide_property_inferred_property_nonblank_chk
    check (btrim(property_source_id) <> ''),
  constraint sega_style_guide_property_inferred_evidence_nonblank_chk
    check (btrim(evidence_key) <> ''),
  constraint sega_style_guide_property_inferred_evidence_catalog_nonblank_chk
    check (btrim(evidence_catalog_source_id) <> ''),
  constraint sega_style_guide_property_inferred_rule_nonblank_chk
    check (btrim(rule_version) <> ''),
  constraint sega_style_guide_property_inferred_raw_obj_chk check (jsonb_typeof(raw)='object')
);

comment on table plm.sega_style_guide_property_inferred is
  'NON-AUTHORITATIVE INFERRED EVIDENCE. Folder-path-supported relationships between '
  'capture-scoped Sega guide candidates and registry Properties. relationship_truth is '
  'pinned to inferred; one candidate may retain multiple Properties and evidence paths.';

create table plm.sega_character_property_inferred (
  capture_id              uuid not null,
  character_candidate_key text not null,
  property_source_id      text not null,
  evidence_key            text not null,
  match_method            text not null,
  rule_version            text not null,
  confidence              numeric(4,3) not null,
  relationship_truth      text not null default 'inferred',
  raw                     jsonb not null,

  constraint sega_character_property_inferred_pkey
    primary key (capture_id,character_candidate_key,property_source_id,evidence_key),
  constraint sega_character_property_inferred_candidate_fkey
    foreign key (capture_id,character_candidate_key)
    references plm.sega_character_candidate(capture_id,character_candidate_key)
    on delete restrict,
  constraint sega_character_property_inferred_property_fkey
    foreign key (capture_id,property_source_id)
    references plm.sega_property(capture_id,property_source_id) on delete restrict,
  constraint sega_character_property_inferred_evidence_fkey
    foreign key (capture_id,character_candidate_key,evidence_key)
    references plm.sega_character_evidence(capture_id,character_candidate_key,evidence_key)
    on delete restrict,
  constraint sega_character_property_inferred_method_chk
    check (match_method in ('exact_label','normalized_label','subtree_of_match')),
  constraint sega_character_property_inferred_truth_chk check (relationship_truth='inferred'),
  constraint sega_character_property_inferred_confidence_chk check (confidence between 0 and 1),
  constraint sega_character_property_inferred_candidate_nonblank_chk
    check (btrim(character_candidate_key) <> ''),
  constraint sega_character_property_inferred_property_nonblank_chk
    check (btrim(property_source_id) <> ''),
  constraint sega_character_property_inferred_evidence_nonblank_chk
    check (btrim(evidence_key) <> ''),
  constraint sega_character_property_inferred_rule_nonblank_chk
    check (btrim(rule_version) <> ''),
  constraint sega_character_property_inferred_raw_obj_chk check (jsonb_typeof(raw)='object')
);

comment on table plm.sega_character_property_inferred is
  'NON-AUTHORITATIVE INFERRED EVIDENCE. Character-evidence-path-supported relationships '
  'between capture-scoped Sega character candidates and registry Properties. Every row '
  'references the supporting evidence row and is pinned to inferred.';

create index idx_sega_submission_capture_status_captured
  on plm.sega_submission_capture(status,source_captured_at desc,load_completed_at desc,id);
create index idx_sega_style_guide_property_inferred_property
  on plm.sega_style_guide_property_inferred(capture_id,property_source_id);
create index idx_sega_style_guide_property_inferred_evidence_catalog
  on plm.sega_style_guide_property_inferred(capture_id,evidence_catalog_source_id);
create index idx_sega_character_property_inferred_property
  on plm.sega_character_property_inferred(capture_id,property_source_id);
create index idx_sega_character_property_inferred_evidence
  on plm.sega_character_property_inferred(capture_id,character_candidate_key,evidence_key);

-- Explicit append-only privileges and RLS. Root inserts/updates remain function-only.
alter table plm.sega_submission_capture enable row level security;
revoke all on plm.sega_submission_capture from public,anon,authenticated,service_role;
grant select on plm.sega_submission_capture to service_role,authenticated;
create policy sega_submission_capture_service_read on plm.sega_submission_capture
  for select to service_role using (true);
create policy sega_submission_capture_plm_read on plm.sega_submission_capture
  for select to authenticated using (app.has_app_access('plm') or app.has_role('administrator')
    or app.has_any_role(array['sales','licensing']::app.app_role[]));

alter table plm.sega_submission_property enable row level security;
revoke all on plm.sega_submission_property from public,anon,authenticated,service_role;
grant select,insert on plm.sega_submission_property to service_role;
grant select on plm.sega_submission_property to authenticated;
create policy sega_submission_property_service_read on plm.sega_submission_property
  for select to service_role using (true);
create policy sega_submission_property_plm_read on plm.sega_submission_property
  for select to authenticated using (app.has_app_access('plm') or app.has_role('administrator')
    or app.has_any_role(array['sales','licensing']::app.app_role[]));

alter table plm.sega_style_guide_property_inferred enable row level security;
revoke all on plm.sega_style_guide_property_inferred from public,anon,authenticated,service_role;
grant select,insert on plm.sega_style_guide_property_inferred to service_role;
grant select on plm.sega_style_guide_property_inferred to authenticated;
create policy sega_style_guide_property_inferred_service_read
  on plm.sega_style_guide_property_inferred for select to service_role using (true);
create policy sega_style_guide_property_inferred_plm_read
  on plm.sega_style_guide_property_inferred for select to authenticated
  using (app.has_app_access('plm') or app.has_role('administrator')
    or app.has_any_role(array['sales','licensing']::app.app_role[]));

alter table plm.sega_character_property_inferred enable row level security;
revoke all on plm.sega_character_property_inferred from public,anon,authenticated,service_role;
grant select,insert on plm.sega_character_property_inferred to service_role;
grant select on plm.sega_character_property_inferred to authenticated;
create policy sega_character_property_inferred_service_read
  on plm.sega_character_property_inferred for select to service_role using (true);
create policy sega_character_property_inferred_plm_read
  on plm.sega_character_property_inferred for select to authenticated
  using (app.has_app_access('plm') or app.has_role('administrator')
    or app.has_any_role(array['sales','licensing']::app.app_role[]));

create or replace function plm.begin_sega_submission_capture(
  p_capture_key text,p_source_repository text,p_source_commit_sha text,p_source_hash text,
  p_source_url text,p_source_captured_at timestamptz,p_selected_contract_source_id text,
  p_expected_counts jsonb,p_save_clicked boolean,p_submission_list_before_hash text,
  p_submission_list_after_hash text,p_no_submission_created boolean,p_raw_summary jsonb,
  p_created_by text
) returns uuid
language plpgsql security definer set search_path=plm,pg_temp
as $$
declare v_existing plm.sega_submission_capture%rowtype; v_id uuid; v_count numeric;
begin
  if p_capture_key is null or btrim(p_capture_key)='' or p_source_repository is null
     or btrim(p_source_repository)='' or p_source_url is null or btrim(p_source_url)=''
     or p_selected_contract_source_id is null or btrim(p_selected_contract_source_id)=''
     or p_created_by is null or btrim(p_created_by)='' then
    raise exception 'begin_sega_submission_capture: required text value is blank';
  end if;
  if p_source_commit_sha is null or p_source_commit_sha !~ '^[0-9a-f]{40}$'
     or p_source_hash is null or p_source_hash !~ '^[0-9a-f]{64}$'
     or p_submission_list_before_hash is null
        or p_submission_list_before_hash !~ '^[0-9a-f]{64}$'
     or p_submission_list_after_hash is null
        or p_submission_list_after_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'begin_sega_submission_capture: commit and evidence hashes are malformed';
  end if;
  if p_source_captured_at is null or p_save_clicked is null
     or p_no_submission_created is null then
    raise exception 'begin_sega_submission_capture: required capture facts are null';
  end if;
  if p_expected_counts is null or jsonb_typeof(p_expected_counts)<>'object'
     or not (p_expected_counts ? 'submission_properties')
     or jsonb_typeof(p_expected_counts->'submission_properties')<>'number' then
    raise exception 'begin_sega_submission_capture: submission_properties count is required';
  end if;
  v_count := (p_expected_counts->>'submission_properties')::numeric;
  if v_count<0 or v_count<>trunc(v_count) or v_count>9223372036854775807::numeric then
    raise exception 'begin_sega_submission_capture: submission_properties count is invalid';
  end if;
  if p_raw_summary is null or jsonb_typeof(p_raw_summary)<>'object' then
    raise exception 'begin_sega_submission_capture: raw_summary must be an object';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('plm.sega_submission_capture:'||p_capture_key,0));
  select * into v_existing from plm.sega_submission_capture where capture_key=p_capture_key;
  if found then
    if v_existing.source_commit_sha<>p_source_commit_sha
       or v_existing.source_hash<>p_source_hash
       or v_existing.selected_contract_source_id<>p_selected_contract_source_id
       or v_existing.expected_counts<>p_expected_counts
       or v_existing.save_clicked<>p_save_clicked
       or v_existing.submission_list_before_hash<>p_submission_list_before_hash
       or v_existing.submission_list_after_hash<>p_submission_list_after_hash
       or v_existing.no_submission_created<>p_no_submission_created then
      raise exception 'begin_sega_submission_capture: capture key already has different evidence';
    end if;
    if v_existing.status in ('loading','complete') then return v_existing.id; end if;
    raise exception 'begin_sega_submission_capture: capture key is %, not resumable',v_existing.status;
  end if;
  insert into plm.sega_submission_capture(
    capture_key,source_repository,source_commit_sha,source_hash,source_url,
    source_captured_at,selected_contract_source_id,expected_counts,save_clicked,
    submission_list_before_hash,submission_list_after_hash,no_submission_created,
    raw_summary,created_by)
  values(p_capture_key,p_source_repository,p_source_commit_sha,p_source_hash,p_source_url,
    p_source_captured_at,p_selected_contract_source_id,p_expected_counts,p_save_clicked,
    p_submission_list_before_hash,p_submission_list_after_hash,p_no_submission_created,
    p_raw_summary,p_created_by) returning id into v_id;
  return v_id;
end; $$;

create or replace function plm.finalize_sega_submission_capture(
  p_capture_id uuid,p_observed_counts jsonb,p_error_summary jsonb
) returns void
language plpgsql security definer set search_path=plm,pg_temp
as $$
declare v_cap plm.sega_submission_capture%rowtype; v_err jsonb:='[]';
  v_actual bigint; v_expected numeric; v_reported numeric;
begin
  if p_observed_counts is null or jsonb_typeof(p_observed_counts)<>'object'
     or p_error_summary is null or jsonb_typeof(p_error_summary)<>'array' then
    raise exception 'finalize_sega_submission_capture: counts object and errors array required';
  end if;
  select * into v_cap from plm.sega_submission_capture where id=p_capture_id for update;
  if not found then raise exception 'finalize_sega_submission_capture: no capture %',p_capture_id; end if;
  if v_cap.status='complete' then return; end if;
  if v_cap.status<>'loading' then
    raise exception 'finalize_sega_submission_capture: capture is %, not loading',v_cap.status;
  end if;
  if v_cap.save_clicked then v_err:=v_err||jsonb_build_object('code','save_clicked'); end if;
  if not v_cap.no_submission_created then
    v_err:=v_err||jsonb_build_object('code','submission_created_or_unknown');
  end if;
  if v_cap.submission_list_before_hash<>v_cap.submission_list_after_hash then
    v_err:=v_err||jsonb_build_object('code','submission_list_changed');
  end if;
  if jsonb_array_length(p_error_summary)>0 then
    v_err:=v_err||jsonb_build_object('code','loader_reported_errors',
      'count',jsonb_array_length(p_error_summary));
  end if;
  select count(*) into v_actual from plm.sega_submission_property
    where submission_capture_id=p_capture_id;
  if jsonb_typeof(v_cap.expected_counts->'submission_properties')<>'number' then
    v_err:=v_err||jsonb_build_object('code','expected_count_invalid');
  else
    v_expected:=(v_cap.expected_counts->>'submission_properties')::numeric;
    if v_expected<0 or v_expected<>trunc(v_expected) or v_expected>9223372036854775807::numeric
       or v_expected::bigint<>v_actual then
      v_err:=v_err||jsonb_build_object('code','count_mismatch','entity','submission_properties',
        'expected',v_cap.expected_counts->'submission_properties','observed',v_actual);
    end if;
  end if;
  if jsonb_typeof(p_observed_counts->'submission_properties')<>'number' then
    v_err:=v_err||jsonb_build_object('code','reported_count_invalid');
  else
    v_reported:=(p_observed_counts->>'submission_properties')::numeric;
    if v_reported<0 or v_reported<>trunc(v_reported)
       or v_reported>9223372036854775807::numeric or v_reported::bigint<>v_actual then
      v_err:=v_err||jsonb_build_object('code','reported_count_mismatch',
        'entity','submission_properties','reported',p_observed_counts->'submission_properties',
        'observed',v_actual);
    end if;
  end if;
  if jsonb_array_length(v_err)>0 then
    update plm.sega_submission_capture set status='rejected',observed_counts=
      jsonb_build_object('submission_properties',v_actual),error_summary=v_err,
      load_completed_at=null where id=p_capture_id;
    raise warning 'finalize_sega_submission_capture: capture % rejected: %',p_capture_id,v_err;
    return;
  end if;
  update plm.sega_submission_capture set status='complete',observed_counts=
    jsonb_build_object('submission_properties',v_actual),error_summary='[]',
    load_completed_at=now() where id=p_capture_id;
end; $$;

revoke all on function plm.begin_sega_submission_capture(text,text,text,text,text,timestamptz,text,jsonb,boolean,text,text,boolean,jsonb,text) from public,anon,authenticated;
grant execute on function plm.begin_sega_submission_capture(text,text,text,text,text,timestamptz,text,jsonb,boolean,text,text,boolean,jsonb,text) to service_role;
revoke all on function plm.finalize_sega_submission_capture(uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function plm.finalize_sega_submission_capture(uuid,jsonb,jsonb) to service_role;

-- Extend the asset-side publication gate with the two inferred relationship grains.
do $migration$
declare v_before text; v_after text;
begin
  select pg_get_functiondef('plm.finalize_sega_capture(uuid,jsonb,jsonb)'::regprocedure)
    into v_before;
  v_after:=replace(v_before,
    $n$['asset_properties_inferred', 'sega_asset_property_inferred']$n$,
    $r$['asset_properties_inferred',          'sega_asset_property_inferred'],
    ['style_guide_properties_inferred', 'sega_style_guide_property_inferred'],
    ['character_properties_inferred',   'sega_character_property_inferred']$r$);
  if v_after=v_before then raise exception 'finalize Sega pair anchor drifted'; end if;
  v_before:=v_after;
  v_after:=replace(v_before,
    $n$  select count(*) into v_n
    from plm.sega_property_licensor l$n$,
    $r$  select count(*) into v_n
    from plm.sega_style_guide_property_inferred l
   where l.capture_id=p_capture_id
     and (not exists(select 1 from plm.sega_style_guide_candidate c
                      where c.capture_id=l.capture_id and c.catalog_source_id=l.catalog_source_id)
       or not exists(select 1 from plm.sega_property p
                      where p.capture_id=l.capture_id and p.property_source_id=l.property_source_id)
       or not exists(select 1 from plm.sega_catalog c
                      where c.capture_id=l.capture_id
                        and c.catalog_source_id=l.evidence_catalog_source_id));
  if v_n<>0 then v_err:=v_err||jsonb_build_object(
    'code','orphan_style_guide_property_inferred_link','count',v_n); end if;

  select count(*) into v_n from plm.sega_character_property_inferred l
   where l.capture_id=p_capture_id
     and (not exists(select 1 from plm.sega_character_candidate c
                      where c.capture_id=l.capture_id
                        and c.character_candidate_key=l.character_candidate_key)
       or not exists(select 1 from plm.sega_property p
                      where p.capture_id=l.capture_id and p.property_source_id=l.property_source_id)
       or not exists(select 1 from plm.sega_character_evidence e
                      where e.capture_id=l.capture_id
                        and e.character_candidate_key=l.character_candidate_key
                        and e.evidence_key=l.evidence_key));
  if v_n<>0 then v_err:=v_err||jsonb_build_object(
    'code','orphan_character_property_inferred_link','count',v_n); end if;

  select count(*) into v_n
    from plm.sega_property_licensor l$r$);
  if v_after=v_before then raise exception 'finalize Sega orphan anchor drifted'; end if;
  v_after:=replace(v_after,'twelve entity keys','fourteen entity keys');
  v_after:=replace(v_after,'outside the twelve is','outside the fourteen is');
  if position('style_guide_properties_inferred' in v_after)=0
     or position('character_properties_inferred' in v_after)=0 then
    raise exception 'finalize Sega inferred gates incomplete';
  end if;
  execute v_after;
end; $migration$;

comment on function plm.finalize_sega_capture(uuid,jsonb,jsonb) is
  'Sega asset-side publication gate. It validates fourteen expected/reported/table count '
  'pairs, including inferred asset, guide and character Property evidence, and rejects '
  'orphaned endpoints. Rejections persist; callers read back capture status. service_role only.';
revoke all on function plm.finalize_sega_capture(uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function plm.finalize_sega_capture(uuid,jsonb,jsonb) to service_role;

-- Give submission vocabulary its own latest-complete clock in the opt-in exact inventory.
-- Bounded asserted edits preserve every other source's current definition byte-for-byte.
do $inventory$
declare v_before text; v_after text;
begin
  select pg_get_functiondef('api.source_capture_inventory_exact(text)'::regprocedure)
    into v_before;
  v_after:=replace(v_before,
    $n$    (select id from plm.sega_capture
      where status = 'complete'
      order by source_captured_at desc, load_completed_at desc, id desc limit 1)
      as sega_capture_id,$n$,
    $r$    (select id from plm.sega_capture
      where status = 'complete'
      order by source_captured_at desc, load_completed_at desc, id desc limit 1)
      as sega_capture_id,
    (select id from plm.sega_submission_capture
      where status = 'complete'
      order by source_captured_at desc, load_completed_at desc, id desc limit 1)
      as sega_submission_capture_id,$r$);
  if v_after=v_before then raise exception 'exact inventory latest Sega anchor drifted'; end if;
  v_before:=v_after;
  v_after:=replace(v_before,
    $n$    exists (select 1 from pg_attribute a where a.attrelid = c.oid
      and a.attnum > 0 and not a.attisdropped and a.attname = 'capture_id') as has_capture_id,$n$,
    $r$    exists (select 1 from pg_attribute a where a.attrelid = c.oid
      and a.attnum > 0 and not a.attisdropped and a.attname = 'capture_id') as has_capture_id,
    exists (select 1 from pg_attribute a where a.attrelid = c.oid
      and a.attnum > 0 and not a.attisdropped
      and a.attname = 'submission_capture_id') as has_submission_capture_id,$r$);
  if v_after=v_before then raise exception 'exact inventory catalogue anchor drifted'; end if;
  v_before:=v_after;
  v_after:=replace(v_before,
    $n$      -- Sega: identical contract to NBCU -- one latest complete capture, and loading,
      -- rejected and abandoned attempts stay retained only.
      when c.relname = 'sega_capture' then$n$,
    $r$      -- Sega submission vocabulary has its own complete-capture clock.
      when c.relname = 'sega_submission_capture' then
        case when l.sega_submission_capture_id is null then null else 1::bigint end
      when c.relname = 'sega_submission_property' and c.has_submission_capture_id
           and l.sega_submission_capture_id is not null then
        (xpath('/row/cnt/text()', query_to_xml(format(
          'select count(*) as cnt from plm.%I where submission_capture_id = %L::uuid',
          c.relname, l.sega_submission_capture_id::text), false, true, '')))[1]::text::bigint

      -- Sega asset evidence: one latest complete capture.
      when c.relname = 'sega_capture' then$r$);
  if v_after=v_before then raise exception 'exact inventory Sega count anchor drifted'; end if;
  v_before:=v_after;
  v_after:=replace(v_before,
    $n$    when relname like 'sega\_%' and (relname = 'sega_capture' or has_capture_id) then 'latest_complete'$n$,
    $r$    when relname in ('sega_submission_capture','sega_submission_property') then 'latest_complete'
    when relname like 'sega\_%' and (relname = 'sega_capture' or has_capture_id) then 'latest_complete'$r$);
  if v_after=v_before then raise exception 'exact inventory count-basis anchor drifted'; end if;
  v_before:=v_after;
  v_after:=replace(v_before,
    $n$    when relname like 'sega\_%' and (relname = 'sega_capture' or has_capture_id)
      then case when sega_capture_id is null then null else 'complete' end$n$,
    $r$    when relname in ('sega_submission_capture','sega_submission_property')
      then case when sega_submission_capture_id is null then null else 'complete' end
    when relname like 'sega\_%' and (relname = 'sega_capture' or has_capture_id)
      then case when sega_capture_id is null then null else 'complete' end$r$);
  if v_after=v_before then raise exception 'exact inventory status anchor drifted'; end if;
  v_before:=v_after;
  v_after:=replace(v_before,
    $n$    when relname like 'sega\_%' and (relname = 'sega_capture' or has_capture_id)
         and sega_capture_id is null then$n$,
    $r$    when relname in ('sega_submission_capture','sega_submission_property')
         and sega_submission_capture_id is null then
      'No complete Sega submission vocabulary capture exists; latest-complete count is unknown, not zero.'
    when relname in ('sega_submission_capture','sega_submission_property') then
      'Latest complete read-only Sega submission vocabulary capture; rejected attempts excluded.'
    when relname like 'sega\_%' and (relname = 'sega_capture' or has_capture_id)
         and sega_capture_id is null then$r$);
  if v_after=v_before or position('sega_submission_capture_id' in v_after)=0 then
    raise exception 'exact inventory submission clock incomplete';
  end if;
  execute v_after;
end; $inventory$;

-- Re-derive the bounded view with the same historical ten columns and all existing source
-- classifications. Counts remain truthful NULLs; only the new submission clock is added.
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
      order by source_captured_at desc,load_completed_at desc,id desc limit 1) sesame_capture_id
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
    when relname like 'sesame\_%' then 'sesame' else 'other' end source_system
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
  'Bounded metadata inventory for every plm landing table. Sega asset evidence and Sega '
  'submission vocabulary use separate latest-complete clocks while preserving the historical '
  'ten-column contract. row_count, retained_row_count and latest_complete_row_count are '
  'intentionally NULL (unknown, never zero); exact callers opt into '
  'api.source_capture_inventory_exact(text). carries_resolution describes table shape and '
  'never proves that a scrape ran. No licensed source row value is exposed here.';
revoke all on api.source_capture_inventory from public,anon;
grant select on api.source_capture_inventory to authenticated,service_role;

revoke all on function api.source_capture_inventory_exact(text) from public,anon;
grant execute on function api.source_capture_inventory_exact(text) to authenticated,service_role;
