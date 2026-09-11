-- Issue #2543: coherent, complete Disney OPA capture evidence.
-- Schema only. Licensed OPA rows are supplied later by the private capture workflow.
-- derived-from: 20260826001518

create table plm.opa_capture (
  id uuid primary key default gen_random_uuid(),
  capture_key text not null unique,
  source_repository text not null,
  source_commit_sha text not null,
  source_manifest_sha256 text not null,
  source_captured_at timestamptz not null,
  load_started_at timestamptz not null default clock_timestamp(),
  load_completed_at timestamptz,
  status text not null default 'loading',
  expected_scope_count integer not null,
  expected_unique_property_count bigint not null,
  expected_unique_character_count bigint not null,
  expected_scope_membership_count bigint not null,
  expected_cross_scope_property_count bigint not null,
  expected_relationship_count bigint not null,
  expected_duplicate_pair_count bigint not null default 0,
  observed_unique_property_count bigint,
  observed_unique_character_count bigint,
  observed_scope_membership_count bigint,
  observed_cross_scope_property_count bigint,
  observed_relationship_count bigint,
  observed_duplicate_pair_count bigint,
  observed_relationship_sha256 text,
  errors jsonb not null default '[]'::jsonb,
  created_by text not null,
  constraint opa_capture_text_ck check (
    btrim(capture_key) <> '' and btrim(source_repository) <> '' and btrim(created_by) <> ''
  ),
  constraint opa_capture_commit_ck check (source_commit_sha ~ '^[0-9a-f]{40}$'),
  constraint opa_capture_manifest_ck check (source_manifest_sha256 ~ '^[0-9a-f]{64}$'),
  constraint opa_capture_status_ck check (status in ('loading','complete','rejected')),
  constraint opa_capture_expected_ck check (
    expected_scope_count = 2
    and expected_unique_property_count > 0
    and expected_unique_character_count > 0
    and expected_scope_membership_count >= expected_unique_property_count
    and expected_cross_scope_property_count between 0 and expected_unique_property_count
    and expected_relationship_count > 0
    and expected_duplicate_pair_count = 0
  ),
  constraint opa_capture_terminal_ck check (
    (status = 'loading' and load_completed_at is null)
    or (status in ('complete','rejected') and load_completed_at is not null)
  ),
  constraint opa_capture_errors_ck check (jsonb_typeof(errors) = 'array')
);

create table plm.opa_capture_scope (
  capture_id uuid not null references plm.opa_capture(id) on delete restrict,
  scope_key text not null,
  region text not null,
  branch text not null,
  lob text not null,
  submission_type text not null,
  template_id text not null,
  workflow_id text not null,
  source_sha256 text not null,
  expected_property_count bigint not null,
  expected_character_count bigint not null,
  expected_relationship_count bigint not null,
  expected_relationship_sha256 text not null,
  expected_duplicate_pair_count bigint not null default 0,
  authentication_evidence_sha256 text,
  authenticated_at timestamptz,
  observed_property_count bigint,
  observed_character_count bigint,
  observed_relationship_count bigint,
  observed_duplicate_pair_count bigint,
  observed_relationship_sha256 text,
  status text not null default 'pending',
  finished_at timestamptz,
  failure jsonb,
  primary key (capture_id, scope_key),
  constraint opa_capture_scope_key_ck check (
    (scope_key='disney_home_standard' and region='North America' and branch='Disney'
      and lob='200' and submission_type='Standard' and template_id='21' and workflow_id='49')
    or
    (scope_key='lucas_home_standard' and region='North America' and branch='Lucas'
      and lob='200' and submission_type='Standard' and template_id='462' and workflow_id='50')
  ),
  constraint opa_capture_scope_source_ck check (source_sha256 ~ '^[0-9a-f]{64}$'),
  constraint opa_capture_scope_relationship_hash_ck check (expected_relationship_sha256 ~ '^[0-9a-f]{64}$'),
  constraint opa_capture_scope_expected_ck check (
    expected_property_count > 0 and expected_character_count > 0
    and expected_relationship_count > 0 and expected_duplicate_pair_count = 0
  ),
  constraint opa_capture_scope_auth_ck check (
    (authentication_evidence_sha256 is null and authenticated_at is null)
    or (authentication_evidence_sha256 ~ '^[0-9a-f]{64}$' and authenticated_at is not null)
  ),
  constraint opa_capture_scope_status_ck check (status in ('pending','complete','rejected')),
  constraint opa_capture_scope_terminal_ck check (
    (status='pending' and finished_at is null and failure is null)
    or (status='complete' and finished_at is not null and failure is null)
    or (status='rejected' and finished_at is not null and jsonb_typeof(failure)='object')
  )
);

create table plm.opa_property_character_capture (
  observation_id uuid primary key default gen_random_uuid(),
  capture_id uuid not null,
  scope_key text not null,
  chunk_key text not null,
  chunk_sha256 text not null,
  licensed_property_id bigint not null,
  property_name text not null,
  option_source_id bigint not null,
  character_id bigint,
  character_name text,
  brand_property_id bigint,
  source_row_sha256 text not null,
  observed_at timestamptz not null default clock_timestamp(),
  foreign key (capture_id,scope_key)
    references plm.opa_capture_scope(capture_id,scope_key) on delete restrict,
  constraint opa_property_character_capture_text_ck check (
    btrim(chunk_key)<>'' and btrim(property_name)<>''
  ),
  constraint opa_property_character_capture_hash_ck check (
    chunk_sha256 ~ '^[0-9a-f]{64}$' and source_row_sha256 ~ '^[0-9a-f]{64}$'
  ),
  constraint opa_property_character_capture_character_ck check (
    (character_id is null and character_name is null and brand_property_id is null)
    or (character_id is not null and character_name is not null
      and btrim(character_name)<>'' and brand_property_id is not null)
  ),
  constraint opa_property_character_capture_scope_row_key
    unique nulls not distinct (capture_id,scope_key,licensed_property_id,character_id)
);

comment on table plm.opa_capture is
  'Sanitized root evidence for one private Disney OPA capture. Complete means both approved Home/Standard routes reconciled under one manifest; partial and rejected attempts never become authoritative.';
comment on table plm.opa_capture_scope is
  'Predeclared Disney and Lucas OPA route evidence. Authentication is represented only by a one-way evidence hash; no credential or licensed row is exposed.';
comment on table plm.opa_property_character_capture is
  'Append-only licensed OPA Property/Character observations tied to one capture root and route. Absence never deletes a retained source entity or relationship.';

alter table plm.opa_capture enable row level security;
alter table plm.opa_capture_scope enable row level security;
alter table plm.opa_property_character_capture enable row level security;
revoke all on plm.opa_capture,plm.opa_capture_scope,plm.opa_property_character_capture
  from public,anon,authenticated,service_role;
grant select on plm.opa_capture,plm.opa_capture_scope,plm.opa_property_character_capture
  to service_role;

create or replace function plm.begin_opa_capture(
  p_capture_key text,
  p_source_repository text,
  p_source_commit_sha text,
  p_source_manifest_sha256 text,
  p_source_captured_at timestamptz,
  p_scopes jsonb,
  p_totals jsonb,
  p_created_by text
) returns uuid
language plpgsql security definer
set search_path=pg_catalog,plm,public
as $$
declare
  v_id uuid;
  v_existing plm.opa_capture%rowtype;
  v_scope_key text;
  v_scope jsonb;
  v_latest plm.opa_capture_scope%rowtype;
  v_relationship_total bigint := 0;
begin
  if p_capture_key is null or btrim(p_capture_key)=''
     or p_source_repository is null or btrim(p_source_repository)=''
     or p_created_by is null or btrim(p_created_by)='' then
    raise exception 'begin_opa_capture: required text value is blank';
  end if;
  if p_source_commit_sha !~ '^[0-9a-f]{40}$'
     or p_source_manifest_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'begin_opa_capture: source commit or manifest hash is malformed';
  end if;
  if p_source_captured_at is null or jsonb_typeof(p_scopes)<>'object'
     or (select count(*) from jsonb_object_keys(p_scopes))<>2
     or not (p_scopes ? 'disney_home_standard' and p_scopes ? 'lucas_home_standard')
     or jsonb_typeof(p_totals)<>'object' then
    raise exception 'begin_opa_capture: one coherent two-scope manifest is required';
  end if;

  select * into v_existing from plm.opa_capture where capture_key=p_capture_key;
  if found then
    if v_existing.source_commit_sha=p_source_commit_sha
       and v_existing.source_manifest_sha256=p_source_manifest_sha256
       and v_existing.source_captured_at=p_source_captured_at
       and v_existing.status='loading' then
      return v_existing.id;
    end if;
    raise exception 'begin_opa_capture: capture key already exists with different or terminal evidence';
  end if;

  for v_scope_key,v_scope in select key,value from jsonb_each(p_scopes) loop
    if jsonb_typeof(v_scope)<>'object'
       or v_scope->>'region' is distinct from 'North America'
       or v_scope->>'lob' is distinct from '200'
       or v_scope->>'submission_type' is distinct from 'Standard'
       or (v_scope_key='disney_home_standard' and
           (v_scope->>'branch' is distinct from 'Disney' or v_scope->>'template_id' is distinct from '21'
            or v_scope->>'workflow_id' is distinct from '49'))
       or (v_scope_key='lucas_home_standard' and
           (v_scope->>'branch' is distinct from 'Lucas' or v_scope->>'template_id' is distinct from '462'
            or v_scope->>'workflow_id' is distinct from '50'))
       or coalesce(v_scope->>'source_sha256','') !~ '^[0-9a-f]{64}$'
       or coalesce(v_scope->>'relationship_sha256','') !~ '^[0-9a-f]{64}$'
       or coalesce(v_scope->>'property_count','') !~ '^[1-9][0-9]*$'
       or coalesce(v_scope->>'character_count','') !~ '^[1-9][0-9]*$'
       or coalesce(v_scope->>'relationship_count','') !~ '^[1-9][0-9]*$' then
      raise exception 'begin_opa_capture: scope % is missing or mis-scoped',v_scope_key;
    end if;
    v_relationship_total:=v_relationship_total+(v_scope->>'relationship_count')::bigint;
    select s.* into v_latest
      from plm.opa_capture_scope s join plm.opa_capture c on c.id=s.capture_id
      where s.scope_key=v_scope_key and c.status='complete'
      order by c.source_captured_at desc,c.load_completed_at desc,c.id desc limit 1;
    if found and ((v_scope->>'property_count')::bigint<v_latest.observed_property_count
      or (v_scope->>'character_count')::bigint<v_latest.observed_character_count
      or (v_scope->>'relationship_count')::bigint<v_latest.observed_relationship_count) then
      raise exception 'begin_opa_capture: scope % shrank below the latest complete capture',v_scope_key;
    end if;
  end loop;

  if coalesce(p_totals->>'unique_property_count','') !~ '^[1-9][0-9]*$'
     or coalesce(p_totals->>'unique_character_count','') !~ '^[1-9][0-9]*$'
     or coalesce(p_totals->>'scope_membership_count','') !~ '^[1-9][0-9]*$'
     or coalesce(p_totals->>'cross_scope_property_count','') !~ '^[0-9]+$'
     or (p_totals->>'scope_membership_count')::bigint < (p_totals->>'unique_property_count')::bigint
     or v_relationship_total<=0 then
    raise exception 'begin_opa_capture: aggregate counts are missing or invalid';
  end if;

  insert into plm.opa_capture(
    capture_key,source_repository,source_commit_sha,source_manifest_sha256,source_captured_at,
    expected_scope_count,expected_unique_property_count,expected_unique_character_count,
    expected_scope_membership_count,expected_cross_scope_property_count,
    expected_relationship_count,expected_duplicate_pair_count,created_by)
  values(p_capture_key,p_source_repository,p_source_commit_sha,p_source_manifest_sha256,p_source_captured_at,
    2,(p_totals->>'unique_property_count')::bigint,(p_totals->>'unique_character_count')::bigint,
    (p_totals->>'scope_membership_count')::bigint,(p_totals->>'cross_scope_property_count')::bigint,
    v_relationship_total,0,p_created_by)
  returning id into v_id;

  insert into plm.opa_capture_scope(
    capture_id,scope_key,region,branch,lob,submission_type,template_id,workflow_id,source_sha256,
    expected_property_count,expected_character_count,expected_relationship_count,
    expected_relationship_sha256,expected_duplicate_pair_count)
  select v_id,e.key,e.value->>'region',e.value->>'branch',e.value->>'lob',
    e.value->>'submission_type',e.value->>'template_id',e.value->>'workflow_id',
    e.value->>'source_sha256',(e.value->>'property_count')::bigint,
    (e.value->>'character_count')::bigint,(e.value->>'relationship_count')::bigint,
    e.value->>'relationship_sha256',0
  from jsonb_each(p_scopes)e;
  return v_id;
end;
$$;

create or replace function plm.load_opa_capture_chunk(
  p_capture_id uuid,
  p_scope_key text,
  p_chunk_key text,
  p_chunk_sha256 text,
  p_authentication_evidence_sha256 text,
  p_rows jsonb,
  p_finish_scope boolean default false
) returns jsonb
language plpgsql security definer
set search_path=pg_catalog,plm,public
as $$
declare
  v_capture plm.opa_capture%rowtype;
  v_scope plm.opa_capture_scope%rowtype;
  v_row_count integer;
  v_computed_chunk text;
  v_existing_count integer;
  v_existing_chunk text;
  v_property_count bigint;
  v_character_count bigint;
  v_relationship_count bigint;
  v_relationship_hash text;
  v_identical_retry boolean := false;
  v_failure jsonb;
begin
  select * into v_capture from plm.opa_capture where id=p_capture_id for update;
  select * into v_scope from plm.opa_capture_scope
    where capture_id=p_capture_id and scope_key=p_scope_key for update;
  if v_capture.id is null or v_scope.capture_id is null or v_capture.status<>'loading'
     or v_scope.status not in ('pending','complete') then
    raise exception 'load_opa_capture_chunk: capture/scope is missing or not loading';
  end if;
  if p_authentication_evidence_sha256 is null
     or p_authentication_evidence_sha256 !~ '^[0-9a-f]{64}$' then
    v_failure:=jsonb_build_object('code','authentication_failed','scope_key',p_scope_key);
  elsif v_scope.authentication_evidence_sha256 is not null
     and v_scope.authentication_evidence_sha256<>p_authentication_evidence_sha256 then
    v_failure:=jsonb_build_object('code','authentication_changed','scope_key',p_scope_key);
  elsif p_chunk_key is null or btrim(p_chunk_key)='' or p_chunk_sha256 !~ '^[0-9a-f]{64}$'
     or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)=0 then
    v_failure:=jsonb_build_object('code','empty_or_invalid_chunk','scope_key',p_scope_key);
  elsif jsonb_array_length(p_rows)>1000 then
    v_failure:=jsonb_build_object('code','chunk_too_large','scope_key',p_scope_key);
  elsif exists (
    select 1 from jsonb_array_elements(p_rows) r
    where coalesce(r->>'licensed_property_id','') !~ '^-?[0-9]+$'
       or nullif(btrim(r->>'property_name'),'') is null
       or coalesce(r->>'option_source_id','') !~ '^-?[0-9]+$'
       or ((r ? 'character_id' or r ? 'character_name' or r ? 'brand_property_id') and
           (coalesce(r->>'character_id','') !~ '^-?[0-9]+$'
            or nullif(btrim(r->>'character_name'),'') is null
            or coalesce(r->>'brand_property_id','') !~ '^-?[0-9]+$'))
  ) then
    v_failure:=jsonb_build_object('code','invalid_row_shape','scope_key',p_scope_key);
  end if;

  if v_failure is null then
    select count(*),encode(extensions.digest(
      decode(string_agg(encode(canonical_bytes,'hex'),'0a' order by canonical_order),'hex'),
      'sha256'),'hex')
      into v_row_count,v_computed_chunk
    from (
      select concat(r->>'licensed_property_id',chr(1),r->>'property_name',chr(1),
          r->>'option_source_id',chr(1),coalesce(r->>'character_id',''),chr(1),
          coalesce(r->>'character_name',''),chr(1),coalesce(r->>'brand_property_id','')) canonical_order,
        convert_to(r->>'licensed_property_id','UTF8')||decode('00','hex')||
        convert_to(r->>'property_name','UTF8')||decode('00','hex')||
        convert_to(r->>'option_source_id','UTF8')||decode('00','hex')||
        convert_to(coalesce(r->>'character_id',''),'UTF8')||decode('00','hex')||
        convert_to(coalesce(r->>'character_name',''),'UTF8')||decode('00','hex')||
        convert_to(coalesce(r->>'brand_property_id',''),'UTF8') canonical_bytes
      from jsonb_array_elements(p_rows)r
    )q;
    if v_computed_chunk<>p_chunk_sha256 then
      v_failure:=jsonb_build_object('code','chunk_hash_mismatch','scope_key',p_scope_key);
    elsif exists (
      select 1 from (
        select (r->>'licensed_property_id')::bigint property_id,
          nullif(r->>'character_id','')::bigint character_id,count(*) n
        from jsonb_array_elements(p_rows)r
        group by 1,2 having count(*)>1
      )d
    ) then
      v_failure:=jsonb_build_object('code','duplicate_pair','scope_key',p_scope_key);
    end if;
  end if;

  if v_failure is null then
    select count(*),encode(extensions.digest(decode(string_agg(encode(
      convert_to(licensed_property_id::text,'UTF8')||decode('00','hex')||
      convert_to(property_name,'UTF8')||decode('00','hex')||
      convert_to(option_source_id::text,'UTF8')||decode('00','hex')||
      convert_to(coalesce(character_id::text,''),'UTF8')||decode('00','hex')||
      convert_to(coalesce(character_name,''),'UTF8')||decode('00','hex')||
      convert_to(coalesce(brand_property_id::text,''),'UTF8'),'hex'),'0a' order by
      concat(licensed_property_id::text,chr(1),property_name,chr(1),option_source_id::text,chr(1),
        coalesce(character_id::text,''),chr(1),coalesce(character_name,''),chr(1),
        coalesce(brand_property_id::text,''))),'hex'),'sha256'),'hex')
      into v_existing_count,v_existing_chunk
    from plm.opa_property_character_capture
    where capture_id=p_capture_id and scope_key=p_scope_key and chunk_key=p_chunk_key;
    if v_existing_count>0 then
      if v_existing_count=v_row_count and v_existing_chunk=p_chunk_sha256 then
        if v_scope.status='complete' then
          return jsonb_build_object('status',case when p_finish_scope then 'scope_complete' else 'identical_retry' end,
            'row_count',v_existing_count);
        elsif not p_finish_scope then
          return jsonb_build_object('status','identical_retry','row_count',v_existing_count);
        end if;
        v_identical_retry:=true;
      else
        v_failure:=jsonb_build_object('code','changed_chunk_retry','scope_key',p_scope_key);
      end if;
    elsif v_scope.status='complete' then
      v_failure:=jsonb_build_object('code','scope_already_complete','scope_key',p_scope_key);
    elsif exists (
      select 1 from jsonb_array_elements(p_rows)r
      join plm.opa_property_character_capture o
        on o.capture_id=p_capture_id
       and o.scope_key=p_scope_key
       and o.licensed_property_id=(r->>'licensed_property_id')::bigint
       and o.character_id is not distinct from nullif(r->>'character_id','')::bigint
    ) then
      v_failure:=jsonb_build_object('code','pair_collision','scope_key',p_scope_key);
    end if;
  end if;

  if v_failure is not null then
    update plm.opa_capture_scope set status='rejected',finished_at=clock_timestamp(),failure=v_failure
      where capture_id=p_capture_id and scope_key=p_scope_key;
    update plm.opa_capture set status='rejected',load_completed_at=clock_timestamp(),
      errors=errors||jsonb_build_array(v_failure)
      where id=p_capture_id;
    return jsonb_build_object('status','rejected','failure',v_failure);
  end if;

  update plm.opa_capture_scope set
    authentication_evidence_sha256=coalesce(authentication_evidence_sha256,p_authentication_evidence_sha256),
    authenticated_at=coalesce(authenticated_at,clock_timestamp())
  where capture_id=p_capture_id and scope_key=p_scope_key;

  if not v_identical_retry then
    insert into plm.opa_property_character_capture(
      capture_id,scope_key,chunk_key,chunk_sha256,licensed_property_id,property_name,
      option_source_id,character_id,character_name,brand_property_id,source_row_sha256)
    select p_capture_id,p_scope_key,p_chunk_key,p_chunk_sha256,
      (r->>'licensed_property_id')::bigint,r->>'property_name',(r->>'option_source_id')::bigint,
      nullif(r->>'character_id','')::bigint,nullif(r->>'character_name',''),
      nullif(r->>'brand_property_id','')::bigint,
      encode(extensions.digest(
        convert_to(r->>'licensed_property_id','UTF8')||decode('00','hex')||
        convert_to(r->>'property_name','UTF8')||decode('00','hex')||
        convert_to(r->>'option_source_id','UTF8')||decode('00','hex')||
        convert_to(coalesce(r->>'character_id',''),'UTF8')||decode('00','hex')||
        convert_to(coalesce(r->>'character_name',''),'UTF8')||decode('00','hex')||
        convert_to(coalesce(r->>'brand_property_id',''),'UTF8'),'sha256'),'hex')
    from jsonb_array_elements(p_rows)r;
  end if;

  if p_finish_scope then
    select count(distinct licensed_property_id),count(distinct character_id),
      count(*) filter(where character_id is not null),
      encode(extensions.digest(decode(string_agg(encode(
        convert_to(licensed_property_id::text,'UTF8')||decode('00','hex')||
        convert_to(property_name,'UTF8')||decode('00','hex')||
        convert_to(option_source_id::text,'UTF8')||decode('00','hex')||
        convert_to(character_id::text,'UTF8')||decode('00','hex')||
        convert_to(character_name,'UTF8')||decode('00','hex')||
        convert_to(brand_property_id::text,'UTF8'),'hex'),'0a' order by
        concat(licensed_property_id::text,chr(1),property_name,chr(1),option_source_id::text,chr(1),
          character_id::text,chr(1),character_name,chr(1),brand_property_id::text))
        filter(where character_id is not null),'hex'),'sha256'),'hex')
      into v_property_count,v_character_count,v_relationship_count,v_relationship_hash
    from plm.opa_property_character_capture where capture_id=p_capture_id and scope_key=p_scope_key;
    if v_property_count<>v_scope.expected_property_count
       or v_character_count<>v_scope.expected_character_count
       or v_relationship_count<>v_scope.expected_relationship_count
       or v_relationship_hash<>v_scope.expected_relationship_sha256 then
      v_failure:=jsonb_build_object('code','scope_count_or_hash_mismatch','scope_key',p_scope_key);
      update plm.opa_capture_scope set status='rejected',finished_at=clock_timestamp(),failure=v_failure,
        observed_property_count=v_property_count,observed_character_count=v_character_count,
        observed_relationship_count=v_relationship_count,observed_duplicate_pair_count=0
        where capture_id=p_capture_id and scope_key=p_scope_key;
      update plm.opa_capture set status='rejected',load_completed_at=clock_timestamp(),
        errors=errors||jsonb_build_array(v_failure) where id=p_capture_id;
      return jsonb_build_object('status','rejected','failure',v_failure);
    end if;
    update plm.opa_capture_scope set status='complete',finished_at=clock_timestamp(),
      observed_property_count=v_property_count,observed_character_count=v_character_count,
      observed_relationship_count=v_relationship_count,observed_duplicate_pair_count=0,
      observed_relationship_sha256=v_relationship_hash
      where capture_id=p_capture_id and scope_key=p_scope_key;
  end if;
  return jsonb_build_object('status',case when p_finish_scope then 'scope_complete' else 'loaded' end,
    'row_count',v_row_count);
end;
$$;

create or replace function plm.finalize_opa_capture(p_capture_id uuid)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,plm,public
as $$
declare
  v_capture plm.opa_capture%rowtype;
  v_scope_count integer;
  v_auth_count integer;
  v_property_count bigint;
  v_character_count bigint;
  v_membership_count bigint;
  v_cross_scope_count bigint;
  v_relationship_count bigint;
  v_relationship_hash text;
  v_failure jsonb;
begin
  select * into v_capture from plm.opa_capture where id=p_capture_id for update;
  if not found then raise exception 'finalize_opa_capture: no capture %',p_capture_id; end if;
  if v_capture.status='complete' then
    return jsonb_build_object('status','complete','capture_id',p_capture_id);
  end if;
  if v_capture.status<>'loading' then
    raise exception 'finalize_opa_capture: capture is %, not loading',v_capture.status;
  end if;
  select count(*) filter(where status='complete'),
    count(*) filter(where status='complete' and authentication_evidence_sha256 is not null)
    into v_scope_count,v_auth_count from plm.opa_capture_scope where capture_id=p_capture_id;
  if v_scope_count<>2 or v_auth_count<>2 then
    v_failure:=jsonb_build_object('code','incomplete_scope_coverage','complete_scopes',v_scope_count,
      'authenticated_scopes',v_auth_count);
  else
    select count(distinct licensed_property_id),count(distinct character_id),
      count(*) filter(where character_id is not null),
      encode(extensions.digest(convert_to(string_agg(source_row_sha256,e'\n' order by source_row_sha256)
        filter(where character_id is not null),'UTF8'),'sha256'),'hex')
      into v_property_count,v_character_count,v_relationship_count,v_relationship_hash
    from plm.opa_property_character_capture where capture_id=p_capture_id;
    select coalesce(sum(n),0),count(*) filter(where scope_n=2) into v_membership_count,v_cross_scope_count
    from (
      select licensed_property_id,count(distinct scope_key)scope_n,
        count(distinct scope_key)n
      from plm.opa_property_character_capture where capture_id=p_capture_id
      group by licensed_property_id
    )q;
    if v_property_count<>v_capture.expected_unique_property_count
       or v_character_count<>v_capture.expected_unique_character_count
       or v_membership_count<>v_capture.expected_scope_membership_count
       or v_cross_scope_count<>v_capture.expected_cross_scope_property_count
       or v_relationship_count<>v_capture.expected_relationship_count then
      v_failure:=jsonb_build_object('code','aggregate_count_mismatch');
    end if;
  end if;
  if v_failure is not null then
    update plm.opa_capture set status='rejected',load_completed_at=clock_timestamp(),
      observed_unique_property_count=v_property_count,observed_unique_character_count=v_character_count,
      observed_scope_membership_count=v_membership_count,observed_cross_scope_property_count=v_cross_scope_count,
      observed_relationship_count=v_relationship_count,observed_duplicate_pair_count=0,
      observed_relationship_sha256=v_relationship_hash,errors=errors||jsonb_build_array(v_failure)
      where id=p_capture_id;
    return jsonb_build_object('status','rejected','failure',v_failure);
  end if;
  update plm.opa_capture set status='complete',load_completed_at=clock_timestamp(),
    observed_unique_property_count=v_property_count,observed_unique_character_count=v_character_count,
    observed_scope_membership_count=v_membership_count,observed_cross_scope_property_count=v_cross_scope_count,
    observed_relationship_count=v_relationship_count,observed_duplicate_pair_count=0,
    observed_relationship_sha256=v_relationship_hash where id=p_capture_id;
  return jsonb_build_object('status','complete','capture_id',p_capture_id);
end;
$$;

revoke all on function plm.begin_opa_capture(text,text,text,text,timestamptz,jsonb,jsonb,text) from public,anon,authenticated;
revoke all on function plm.load_opa_capture_chunk(uuid,text,text,text,text,jsonb,boolean) from public,anon,authenticated;
revoke all on function plm.finalize_opa_capture(uuid) from public,anon,authenticated;
grant execute on function plm.begin_opa_capture(text,text,text,text,timestamptz,jsonb,jsonb,text) to service_role;
grant execute on function plm.load_opa_capture_chunk(uuid,text,text,text,text,jsonb,boolean) to service_role;
grant execute on function plm.finalize_opa_capture(uuid) to service_role;

-- Direct replacement of the accumulated exact-count function. Its ten-column contract and every pre-existing source clock are preserved; only the coherent OPA clock is added.
CREATE OR REPLACE FUNCTION api.source_capture_inventory_exact(p_table_name text DEFAULT NULL::text)
 RETURNS TABLE(source_system text, table_name name, row_count bigint, carries_resolution boolean, table_comment text, retained_row_count bigint, latest_complete_row_count bigint, count_basis text, latest_complete_status text, count_note text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'api', 'plm'
AS $function$
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
    (select id from plm.opa_capture where status='complete'
      order by source_captured_at desc,load_completed_at desc,id desc limit 1) as opa_capture_id
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
      else 'other'
    end as source_system
  from catalog c
), counted as (
  select c.*, l.*,
    (xpath('/row/cnt/text()', query_to_xml(
      format('select count(*) as cnt from plm.%I', c.relname), false, true, ''
    )))[1]::text::bigint as retained_count,
    case
      -- The three append-only capture tables must use one completed root. Keep these
      -- specific arms ahead of the broader mutable OPA current-snapshot family.
      when c.relname = 'opa_capture' then
        case when l.opa_capture_id is null then null else 1::bigint end
      when c.relname in ('opa_capture_scope', 'opa_property_character_capture') then
        case when l.opa_capture_id is null then null else
          (xpath('/row/cnt/text()', query_to_xml(format(
            'select count(*) as cnt from plm.%I where capture_id = %L::uuid',
            c.relname, l.opa_capture_id::text), false, true, '')))[1]::text::bigint
        end

      -- OPA tables are deliberately upserted current state, not retained captures.
      when c.relname like 'opa\_%' then
        (xpath('/row/cnt/text()', query_to_xml(
          format('select count(*) as cnt from plm.%I', c.relname), false, true, ''
        )))[1]::text::bigint

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
    when relname in ('opa_capture','opa_capture_scope','opa_property_character_capture') then 'latest_complete'
    when relname like 'opa\_%' then 'current_snapshot'
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
$function$;

-- The bounded view stays metadata-only. This is the current accumulated ten-column
-- definition with only the OPA capture clock added.
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
      order by source_captured_at desc,load_completed_at desc,id desc limit 1) coke_capture_id,
    (select id from plm.opa_capture where status='complete'
      order by source_captured_at desc,load_completed_at desc,id desc limit 1) opa_capture_id
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
    when relname in ('opa_capture','opa_capture_scope','opa_property_character_capture') then 'latest_complete'
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
    when relname in ('opa_capture','opa_capture_scope','opa_property_character_capture')
      then case when opa_capture_id is null then null else 'complete' end
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
    when relname in ('opa_capture','opa_capture_scope','opa_property_character_capture')
      then case when opa_capture_id is null
        then 'No complete coherent OPA capture exists; latest-complete count is unknown, not zero.'
        else 'Latest complete coherent OPA capture; loading and rejected roots are excluded and no licensed row value is exposed.' end
    when relname like 'opa\_%' then
      'Current upserted OPA snapshot; coherent capture evidence is available only on the three capture tables.'
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
        else 'Latest complete Coca-Cola capture; loading and rejected captures excluded.' end
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
  'Bounded metadata inventory for every plm landing table. The ten-column contract is preserved; counts are intentionally NULL and exact counts require api.source_capture_inventory_exact(text). carries_resolution describes table shape, not capture success. OPA capture evidence names only one latest complete root and exposes no licensed row value, authentication evidence, source hash, path, or credential.';
revoke all on api.source_capture_inventory from public,anon;
grant select on api.source_capture_inventory to authenticated,service_role;
revoke all on function api.source_capture_inventory_exact(text) from public,anon;
grant execute on function api.source_capture_inventory_exact(text) to authenticated,service_role;

do $$
begin
  if has_table_privilege('service_role','plm.opa_capture','INSERT,UPDATE,DELETE,TRUNCATE')
     or has_table_privilege('service_role','plm.opa_capture_scope','INSERT,UPDATE,DELETE,TRUNCATE')
     or has_table_privilege('service_role','plm.opa_property_character_capture','INSERT,UPDATE,DELETE,TRUNCATE')
     or has_function_privilege('authenticated','plm.begin_opa_capture(text,text,text,text,timestamptz,jsonb,jsonb,text)','EXECUTE')
     or has_function_privilege('authenticated','plm.load_opa_capture_chunk(uuid,text,text,text,text,jsonb,boolean)','EXECUTE')
     or has_function_privilege('authenticated','plm.finalize_opa_capture(uuid)','EXECUTE') then
    raise exception 'OPA capture privilege boundary failed';
  end if;
end;
$$;
