-- Issue #2995, atomic author claim #3377.
-- Background classification turns are idempotent per determination and turn.
-- Operational jobs are environment-isolated even though HTS learning is shared.
-- Provenance is authenticated on INSERT and cannot be rewritten. Within each
-- environment, creator/admin visibility remains enforced by the backend.
-- RFQ identifiers refer to application databases, so no cross-database FK exists.
create table hts_rag.hts_rag_classification_jobs (
  id uuid not null default gen_random_uuid(),
  determination_id uuid not null,
  session_id uuid not null,
  turn_index integer not null,
  kind text not null,
  status text not null default 'queued',
  owner_key text not null,
  created_by jsonb,
  input jsonb not null,
  result jsonb,
  error_code text,
  error_message text,
  rfq_id integer,
  rfq_item_id integer,
  source text not null default 'hts_lookup',
  source_environment text not null,
  claimed_at timestamptz,
  claimed_by text,
  lease_expires_at timestamptz,
  attempt_count integer not null default 0,
  max_attempts integer not null default 3,
  estimated_cost_usd numeric,
  actual_cost_usd numeric,
  notified_at timestamptz,
  applied_at timestamptz,
  applied_by jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hts_rag_classification_jobs_pkey primary key (id),
  constraint hts_rag_classification_jobs_determination_fkey
    foreign key (determination_id) references hts_rag.hts_rag_determinations(id) on delete restrict,
  constraint hts_rag_classification_jobs_determination_turn_uq
    unique (determination_id, turn_index),
  constraint hts_rag_classification_jobs_turn_check check (turn_index >= 0),
  constraint hts_rag_classification_jobs_kind_check check (kind in ('initial', 'answer')),
  constraint hts_rag_classification_jobs_status_check
    check (status in ('queued', 'running', 'needs_answer', 'ready', 'applied', 'failed', 'cancelled')),
  constraint hts_rag_classification_jobs_source_check check (source in ('hts_lookup', 'rfq')),
  constraint hts_rag_classification_jobs_environment_check
    check (source_environment in ('production', 'alsand')),
  constraint hts_rag_classification_jobs_attempt_check check (attempt_count >= 0),
  constraint hts_rag_classification_jobs_max_attempts_check check (max_attempts >= 1)
);

comment on table hts_rag.hts_rag_classification_jobs is
  'Operational classification control data, not reusable HTS learning evidence. Owner/creator identity, input/result payloads and RFQ pointers are permitted only in this environment-isolated job table; never copy its raw operational payloads into shared HTS learning tables. Backend creator/admin authorization is required within each environment.';

create index hts_rag_classification_jobs_status_idx
  on hts_rag.hts_rag_classification_jobs (status, created_at);
create index hts_rag_classification_jobs_owner_idx
  on hts_rag.hts_rag_classification_jobs (owner_key, status);
create index hts_rag_classification_jobs_rfq_idx
  on hts_rag.hts_rag_classification_jobs (rfq_id, rfq_item_id);

alter table hts_rag.hts_rag_classification_jobs enable row level security;
revoke all on hts_rag.hts_rag_classification_jobs
  from public, anon, authenticated, service_role,
       designflow_hts_prod_runtime, designflow_hts_alsand_runtime,
       designflow_hts_prod_worker, designflow_hts_alsand_worker;
grant select, insert on hts_rag.hts_rag_classification_jobs
  to designflow_hts_prod_worker, designflow_hts_alsand_worker;
-- Launch identity, provenance, input and retry ceiling are immutable to workers.
-- Cost estimates may change as the worker discovers the required model turns.
grant update (status, result, error_code, error_message,
  claimed_at, claimed_by, lease_expires_at, attempt_count,
  estimated_cost_usd, actual_cost_usd, notified_at, applied_at, applied_by, updated_at)
  on hts_rag.hts_rag_classification_jobs
  to designflow_hts_prod_worker, designflow_hts_alsand_worker;

create policy hts_rag_prod_worker_access on hts_rag.hts_rag_classification_jobs
  for select to designflow_hts_prod_worker using (source_environment = 'production');
create policy hts_rag_prod_worker_insert on hts_rag.hts_rag_classification_jobs
  for insert to designflow_hts_prod_worker with check (source_environment = 'production');
create policy hts_rag_prod_worker_update on hts_rag.hts_rag_classification_jobs
  for update to designflow_hts_prod_worker
  using (source_environment = 'production') with check (source_environment = 'production');
create policy hts_rag_alsand_worker_access on hts_rag.hts_rag_classification_jobs
  for select to designflow_hts_alsand_worker using (source_environment = 'alsand');
create policy hts_rag_alsand_worker_insert on hts_rag.hts_rag_classification_jobs
  for insert to designflow_hts_alsand_worker with check (source_environment = 'alsand');
create policy hts_rag_alsand_worker_update on hts_rag.hts_rag_classification_jobs
  for update to designflow_hts_alsand_worker
  using (source_environment = 'alsand') with check (source_environment = 'alsand');

-- Fail the apply on a wrong catalog contract, in addition to behavioral CI.
-- LOGIN is provisioned separately for the actual backend connections; this
-- migration neither grants LOGIN nor forbids an already provisioned login.
do $verify$
declare
  v_environment text;
  v_role text;
  v_prefix text;
  v_expression text;
  v_columns text;
begin
  if not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'hts_rag' and c.relname = 'hts_rag_classification_jobs'
        and c.relkind = 'r' and c.relrowsecurity)
     or not exists (select 1 from pg_class where oid = 'hts_rag.hts_rag_determinations'::regclass
        and relkind = 'r') then
    raise exception 'VERIFY FAILED: exact jobs/determination relation contract';
  end if;
  if not exists (select 1 from pg_constraint
      where conrelid = 'hts_rag.hts_rag_classification_jobs'::regclass and contype = 'f'
        and confrelid = 'hts_rag.hts_rag_determinations'::regclass and confdeltype = 'r'
        and pg_get_constraintdef(oid) = 'FOREIGN KEY (determination_id) REFERENCES hts_rag.hts_rag_determinations(id) ON DELETE RESTRICT')
     or not exists (select 1 from pg_constraint
      where conrelid = 'hts_rag.hts_rag_classification_jobs'::regclass and contype = 'u'
        and pg_get_constraintdef(oid) = 'UNIQUE (determination_id, turn_index)')
     or not exists (select 1 from pg_constraint
      where conrelid = 'hts_rag.hts_rag_provider_responses'::regclass and contype = 'u'
        and pg_get_constraintdef(oid) = 'UNIQUE (session_id, turn_role, turn_index)') then
    raise exception 'VERIFY FAILED: exact FK or job/provider idempotency contract';
  end if;
  if (select count(*) from pg_policies where schemaname = 'hts_rag'
      and tablename = 'hts_rag_classification_jobs') <> 6 then
    raise exception 'VERIFY FAILED: jobs must have exactly six policies';
  end if;
  if not exists (select 1 from pg_attribute a
      where a.attrelid = 'hts_rag.hts_rag_classification_jobs'::regclass
        and a.attname = 'source_environment' and a.atttypid = 'text'::regtype and a.attnotnull
        and not exists (select 1 from pg_attrdef d where d.adrelid = a.attrelid and d.adnum = a.attnum))
     or not exists (select 1 from pg_constraint
      where conrelid = 'hts_rag.hts_rag_classification_jobs'::regclass and contype = 'c'
        and pg_get_constraintdef(oid) = 'CHECK ((source_environment = ANY (ARRAY[''production''::text, ''alsand''::text])))') then
    raise exception 'VERIFY FAILED: exact explicit-provenance column/domain contract';
  end if;
  foreach v_environment in array array['production', 'alsand'] loop
    v_role := case v_environment when 'production' then 'designflow_hts_prod_worker'
      else 'designflow_hts_alsand_worker' end;
    v_prefix := case v_environment when 'production' then 'hts_rag_prod_worker'
      else 'hts_rag_alsand_worker' end;
    v_expression := format('(source_environment = %L::text)', v_environment);
    if not exists (select 1 from pg_roles where rolname = v_role
        and not rolsuper and not rolbypassrls and not rolinherit
        and not rolcreaterole and not rolcreatedb and not rolreplication) then
      raise exception 'VERIFY FAILED: worker privilege attributes for %', v_role;
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'hts_rag'
        and tablename = 'hts_rag_classification_jobs' and policyname = v_prefix || '_access'
        and cmd = 'SELECT' and roles = array[v_role]::name[]
        and qual = v_expression and with_check is null)
       or not exists (select 1 from pg_policies where schemaname = 'hts_rag'
        and tablename = 'hts_rag_classification_jobs' and policyname = v_prefix || '_insert'
        and cmd = 'INSERT' and roles = array[v_role]::name[]
        and qual is null and with_check = v_expression)
       or not exists (select 1 from pg_policies where schemaname = 'hts_rag'
        and tablename = 'hts_rag_classification_jobs' and policyname = v_prefix || '_update'
        and cmd = 'UPDATE' and roles = array[v_role]::name[]
        and qual = v_expression and with_check = v_expression) then
      raise exception 'VERIFY FAILED: exact environment policies for %', v_role;
    end if;
    select string_agg(attname, ',' order by attname) into v_columns from pg_attribute
      where attrelid = 'hts_rag.hts_rag_classification_jobs'::regclass and attnum > 0 and not attisdropped
        and has_column_privilege(v_role, attrelid, attnum, 'UPDATE');
    if v_columns is distinct from 'actual_cost_usd,applied_at,applied_by,attempt_count,claimed_at,claimed_by,error_code,error_message,estimated_cost_usd,lease_expires_at,notified_at,result,status,updated_at'
       or has_table_privilege(v_role, 'hts_rag.hts_rag_classification_jobs', 'UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
       or not has_table_privilege(v_role, 'hts_rag.hts_rag_classification_jobs', 'SELECT')
       or not has_table_privilege(v_role, 'hts_rag.hts_rag_classification_jobs', 'INSERT') then
      raise exception 'VERIFY FAILED: exact worker grants for %', v_role;
    end if;
  end loop;
end
$verify$;
