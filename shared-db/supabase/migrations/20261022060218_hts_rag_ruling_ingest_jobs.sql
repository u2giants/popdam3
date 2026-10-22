-- Issue #4588, atomic author claim #4591 (designflow-backend#217, HTS audit M7).
-- Durable leased queue: cited CBP rulings are ingested by a background worker
-- with bounded retry instead of inline. Operational control data, environment
-- isolated like hts_rag.hts_rag_classification_jobs; at most one open
-- (pending/claimed) job per ruling per environment.
create table hts_rag.hts_rag_ruling_ingest_jobs (
  id uuid not null default gen_random_uuid(),
  ruling_number text not null,
  source_determination_id uuid,
  source_environment text not null,
  status text not null default 'pending',
  attempt_count integer not null default 0,
  max_attempts integer not null default 5,
  claimed_by text,
  claimed_at timestamptz,
  lease_expires_at timestamptz,
  error_code text,
  error_detail text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint hts_rag_ruling_ingest_jobs_pkey primary key (id),
  constraint hts_rag_ruling_ingest_jobs_source_determination_fkey
    foreign key (source_determination_id)
    references hts_rag.hts_rag_determinations(id) on delete set null,
  constraint hts_rag_ruling_ingest_jobs_ruling_number_check check (btrim(ruling_number) <> ''),
  constraint hts_rag_ruling_ingest_jobs_status_check
    check (status in ('pending', 'claimed', 'done', 'dead_letter')),
  constraint hts_rag_ruling_ingest_jobs_source_environment_chk
    check (source_environment in ('production', 'alsand')),
  constraint hts_rag_ruling_ingest_jobs_attempt_check check (attempt_count >= 0),
  constraint hts_rag_ruling_ingest_jobs_max_attempts_check check (max_attempts >= 1),
  constraint hts_rag_ruling_ingest_jobs_terminal_completed_chk
    check (status not in ('done', 'dead_letter') or completed_at is not null)
);

comment on table hts_rag.hts_rag_ruling_ingest_jobs is
  'Operational queue for background ingest of cited CBP rulings (leased, bounded retry, dead-letter). Not HTS learning evidence. Environment isolated; no browser/runtime role access; no DELETE.';

create index hts_rag_ruling_ingest_jobs_claim_idx
  on hts_rag.hts_rag_ruling_ingest_jobs (status, lease_expires_at)
  where status in ('pending', 'claimed');
create index hts_rag_ruling_ingest_jobs_source_determination_idx
  on hts_rag.hts_rag_ruling_ingest_jobs (source_determination_id);
create unique index hts_rag_ruling_ingest_jobs_open_uq
  on hts_rag.hts_rag_ruling_ingest_jobs (source_environment, ruling_number)
  where status in ('pending', 'claimed');

create trigger set_updated_at
before update on hts_rag.hts_rag_ruling_ingest_jobs
for each row execute function app.set_updated_at();

alter table hts_rag.hts_rag_ruling_ingest_jobs enable row level security;
revoke all on hts_rag.hts_rag_ruling_ingest_jobs
  from public, anon, authenticated, service_role,
       designflow_hts_prod_runtime, designflow_hts_alsand_runtime,
       designflow_hts_prod_worker, designflow_hts_alsand_worker;
grant select, insert on hts_rag.hts_rag_ruling_ingest_jobs
  to designflow_hts_prod_worker, designflow_hts_alsand_worker;
-- Ruling, determination link, provenance and retry ceiling are immutable to workers.
grant update (status, attempt_count, claimed_by, claimed_at, lease_expires_at,
  error_code, error_detail, updated_at, completed_at)
  on hts_rag.hts_rag_ruling_ingest_jobs
  to designflow_hts_prod_worker, designflow_hts_alsand_worker;

create policy hts_rag_prod_worker_access on hts_rag.hts_rag_ruling_ingest_jobs
  for select to designflow_hts_prod_worker using (source_environment = 'production');
create policy hts_rag_prod_worker_insert on hts_rag.hts_rag_ruling_ingest_jobs
  for insert to designflow_hts_prod_worker with check (source_environment = 'production');
create policy hts_rag_prod_worker_update on hts_rag.hts_rag_ruling_ingest_jobs
  for update to designflow_hts_prod_worker
  using (source_environment = 'production') with check (source_environment = 'production');
create policy hts_rag_alsand_worker_access on hts_rag.hts_rag_ruling_ingest_jobs
  for select to designflow_hts_alsand_worker using (source_environment = 'alsand');
create policy hts_rag_alsand_worker_insert on hts_rag.hts_rag_ruling_ingest_jobs
  for insert to designflow_hts_alsand_worker with check (source_environment = 'alsand');
create policy hts_rag_alsand_worker_update on hts_rag.hts_rag_ruling_ingest_jobs
  for update to designflow_hts_alsand_worker
  using (source_environment = 'alsand') with check (source_environment = 'alsand');

do $verify$
declare
  v_role text;
  v_env text;
  v_prefix text;
  v_expression text;
  v_columns text;
begin
  if not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'hts_rag' and c.relname = 'hts_rag_ruling_ingest_jobs'
        and c.relkind = 'r' and c.relrowsecurity) then
    raise exception 'VERIFY FAILED: ruling ingest jobs table missing or RLS disabled';
  end if;
  if not exists (select 1 from pg_indexes where schemaname = 'hts_rag' and indexname = 'hts_rag_ruling_ingest_jobs_open_uq'
      and indexdef = 'CREATE UNIQUE INDEX hts_rag_ruling_ingest_jobs_open_uq ON hts_rag.hts_rag_ruling_ingest_jobs USING btree (source_environment, ruling_number) WHERE (status = ANY (ARRAY[''pending''::text, ''claimed''::text]))')
     or not exists (select 1 from pg_indexes where schemaname = 'hts_rag' and indexname = 'hts_rag_ruling_ingest_jobs_claim_idx'
      and indexdef = 'CREATE INDEX hts_rag_ruling_ingest_jobs_claim_idx ON hts_rag.hts_rag_ruling_ingest_jobs USING btree (status, lease_expires_at) WHERE (status = ANY (ARRAY[''pending''::text, ''claimed''::text]))')
     or not exists (select 1 from pg_indexes where schemaname = 'hts_rag' and indexname = 'hts_rag_ruling_ingest_jobs_source_determination_idx'
      and indexdef = 'CREATE INDEX hts_rag_ruling_ingest_jobs_source_determination_idx ON hts_rag.hts_rag_ruling_ingest_jobs USING btree (source_determination_id)') then
    raise exception 'VERIFY FAILED: exact index definitions';
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'hts_rag.hts_rag_ruling_ingest_jobs'::regclass and contype = 'f'
      and pg_get_constraintdef(oid) = 'FOREIGN KEY (source_determination_id) REFERENCES hts_rag.hts_rag_determinations(id) ON DELETE SET NULL')
     or not exists (select 1 from pg_constraint where conrelid = 'hts_rag.hts_rag_ruling_ingest_jobs'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) = 'CHECK ((source_environment = ANY (ARRAY[''production''::text, ''alsand''::text])))')
     or not exists (select 1 from pg_constraint where conrelid = 'hts_rag.hts_rag_ruling_ingest_jobs'::regclass
      and conname = 'hts_rag_ruling_ingest_jobs_terminal_completed_chk')
     or not exists (select 1 from pg_trigger where tgrelid = 'hts_rag.hts_rag_ruling_ingest_jobs'::regclass
      and tgname = 'set_updated_at' and not tgisinternal and tgfoid = 'app.set_updated_at()'::regprocedure) then
    raise exception 'VERIFY FAILED: exact FK, checks or updated_at trigger';
  end if;
  if (select count(*) from pg_policies where schemaname = 'hts_rag'
      and tablename = 'hts_rag_ruling_ingest_jobs') <> 6 then
    raise exception 'VERIFY FAILED: ruling ingest jobs must have exactly six policies';
  end if;
  foreach v_role in array array['designflow_hts_prod_worker', 'designflow_hts_alsand_worker'] loop
    v_env := case v_role when 'designflow_hts_prod_worker' then 'production' else 'alsand' end;
    v_prefix := case v_role when 'designflow_hts_prod_worker' then 'hts_rag_prod_worker' else 'hts_rag_alsand_worker' end;
    v_expression := format('(source_environment = %L::text)', v_env);
    if not exists (select 1 from pg_roles where rolname = v_role and not rolsuper and not rolbypassrls) then
      raise exception 'VERIFY FAILED: worker privilege attributes for %', v_role;
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'hts_rag' and tablename = 'hts_rag_ruling_ingest_jobs'
        and policyname = v_prefix || '_access' and cmd = 'SELECT' and roles = array[v_role]::name[]
        and qual = v_expression and with_check is null)
       or not exists (select 1 from pg_policies where schemaname = 'hts_rag' and tablename = 'hts_rag_ruling_ingest_jobs'
        and policyname = v_prefix || '_insert' and cmd = 'INSERT' and roles = array[v_role]::name[]
        and qual is null and with_check = v_expression)
       or not exists (select 1 from pg_policies where schemaname = 'hts_rag' and tablename = 'hts_rag_ruling_ingest_jobs'
        and policyname = v_prefix || '_update' and cmd = 'UPDATE' and roles = array[v_role]::name[]
        and qual = v_expression and with_check = v_expression) then
      raise exception 'VERIFY FAILED: exact environment policies for %', v_role;
    end if;
    select string_agg(attname, ',' order by attname) into v_columns from pg_attribute
      where attrelid = 'hts_rag.hts_rag_ruling_ingest_jobs'::regclass and attnum > 0 and not attisdropped
        and has_column_privilege(v_role, attrelid, attnum, 'UPDATE');
    if v_columns is distinct from 'attempt_count,claimed_at,claimed_by,completed_at,error_code,error_detail,lease_expires_at,status,updated_at'
       or has_table_privilege(v_role, 'hts_rag.hts_rag_ruling_ingest_jobs', 'UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
       or not has_table_privilege(v_role, 'hts_rag.hts_rag_ruling_ingest_jobs', 'SELECT,INSERT') then
      raise exception 'VERIFY FAILED: exact worker grants for %', v_role;
    end if;
  end loop;
end
$verify$;
