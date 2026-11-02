-- Issue #5454 (designflow-backend#278): today's HTS code beside each ruling's held code.
-- The held code stays exactly as CBP wrote it (hts_rag_rulings.tariffs); this table stores
-- its current equivalent with a state, so old rulings stop teaching retired codes.
-- Renumbering rows gain provenance (official USITC Section 1205 correlation tables and
-- Census code-change files). Workers write; runtime logins read for the classifier.

alter table hts_rag.hts_rag_hts_renumbering add column source_url text;
alter table hts_rag.hts_rag_hts_renumbering add column is_partial boolean not null default false;
comment on column hts_rag.hts_rag_hts_renumbering.source_url is
  'Official document or file the row was parsed from (USITC 1205 report appendix, Census change file).';
comment on column hts_rag.hts_rag_hts_renumbering.is_partial is
  'True for "(pt.)" rows: only part of the old number moved to new_code.';

create table hts_rag.hts_rag_ruling_current_codes (
  id uuid not null default gen_random_uuid(),
  ruling_number text not null,
  held_code text not null,
  state text not null,
  current_code text,
  candidate_codes text[] not null default '{}',
  confidence text,
  reason text,
  method text not null,
  mapping_path text[] not null default '{}',
  hts_revision text not null,
  decided_by text not null,
  decided_at timestamptz not null default now(),
  source_environment text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hts_rag_ruling_current_codes_pkey primary key (id),
  constraint hts_rag_ruling_current_codes_ruling_fkey foreign key (ruling_number)
    references hts_rag.hts_rag_rulings(ruling_number) on delete restrict,
  constraint hts_rag_ruling_current_codes_uq unique (ruling_number, held_code, source_environment),
  constraint hts_rag_ruling_current_codes_state_check
    check (state in ('current', 'mapped', 'split', 'unmapped')),
  constraint hts_rag_ruling_current_codes_method_check
    check (method in ('exact', 'concordance', 'model', 'none')),
  constraint hts_rag_ruling_current_codes_confidence_check
    check (confidence is null or confidence in ('high', 'medium', 'low')),
  constraint hts_rag_ruling_current_codes_code_check
    check (current_code is null or current_code ~ '^[0-9]{4}\.[0-9]{2}\.[0-9]{2}\.[0-9]{2}$'),
  constraint hts_rag_ruling_current_codes_shape_check check (
    (state in ('current', 'mapped') and current_code is not null)
    or (state = 'split' and current_code is null and cardinality(candidate_codes) > 1)
    or (state = 'unmapped' and current_code is null)),
  constraint hts_rag_ruling_current_codes_source_environment_chk
    check (source_environment in ('production', 'alsand'))
);
comment on table hts_rag.hts_rag_ruling_current_codes is
  'Current HTS equivalent of each ruling''s held code; held_code is never rewritten. Design: designflow-backend#278.';
create index hts_rag_ruling_current_codes_state_idx
  on hts_rag.hts_rag_ruling_current_codes (state);
create trigger set_updated_at
before update on hts_rag.hts_rag_ruling_current_codes
for each row execute function app.set_updated_at();
alter table hts_rag.hts_rag_ruling_current_codes enable row level security;
revoke all on hts_rag.hts_rag_ruling_current_codes
  from public, anon, authenticated, service_role,
       designflow_hts_prod_runtime, designflow_hts_alsand_runtime,
       designflow_hts_prod_worker, designflow_hts_alsand_worker;
grant select, insert on hts_rag.hts_rag_ruling_current_codes
  to designflow_hts_prod_worker, designflow_hts_alsand_worker;
grant update (state, current_code, candidate_codes, confidence, reason, method, mapping_path,
              hts_revision, decided_by, decided_at)
  on hts_rag.hts_rag_ruling_current_codes
  to designflow_hts_prod_worker, designflow_hts_alsand_worker;
grant select on hts_rag.hts_rag_ruling_current_codes
  to designflow_hts_prod_runtime, designflow_hts_alsand_runtime;
create policy hts_rag_prod_worker_access on hts_rag.hts_rag_ruling_current_codes
  for select to designflow_hts_prod_worker using (true);
create policy hts_rag_prod_worker_insert on hts_rag.hts_rag_ruling_current_codes
  for insert to designflow_hts_prod_worker with check (source_environment = 'production');
create policy hts_rag_prod_worker_update on hts_rag.hts_rag_ruling_current_codes
  for update to designflow_hts_prod_worker
  using (source_environment = 'production') with check (source_environment = 'production');
create policy hts_rag_alsand_worker_access on hts_rag.hts_rag_ruling_current_codes
  for select to designflow_hts_alsand_worker using (true);
create policy hts_rag_alsand_worker_insert on hts_rag.hts_rag_ruling_current_codes
  for insert to designflow_hts_alsand_worker with check (source_environment = 'alsand');
create policy hts_rag_alsand_worker_update on hts_rag.hts_rag_ruling_current_codes
  for update to designflow_hts_alsand_worker
  using (source_environment = 'alsand') with check (source_environment = 'alsand');
create policy hts_rag_prod_runtime_read on hts_rag.hts_rag_ruling_current_codes
  for select to designflow_hts_prod_runtime using (source_environment = 'production');
create policy hts_rag_alsand_runtime_read on hts_rag.hts_rag_ruling_current_codes
  for select to designflow_hts_alsand_runtime using (true);
