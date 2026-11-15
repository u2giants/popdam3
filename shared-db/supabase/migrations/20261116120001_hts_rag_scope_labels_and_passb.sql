-- Issue #6402 (claim #6403, popcre/designflow-backend#278, plan_hts-4-upgrades.md
-- Phase 2 step 1 and Phase 4 step 2). Two additive stores for the HTS four-upgrades program.
--
-- hts_rag_ruling_scope_labels: Shelf-1 scope/category label per ruling and label_version.
--   Fills blank hts_rag_rulings.category values without touching that column.
-- hts_rag_ruling_passb: Pass B CBP-reasoning extraction per ruling and extract_version;
--   Pass A rows in hts_rag_extractions stay untouched.
--
-- Workers may select, insert and delete only (no UPDATE): a relabel or re-extraction is a
-- new version, or delete+insert of the same version (plan §8a item 12). The "current" row
-- is the newest version the reader asks for; no is_current flag to flip.

create table hts_rag.hts_rag_ruling_scope_labels (
  ruling_number text not null,
  label_version text not null,
  scope_label text not null,
  in_scope boolean not null,
  method text not null,
  model text,
  confidence numeric(4, 3),
  evidence jsonb not null default '{}'::jsonb,
  source_environment text not null,
  created_at timestamptz not null default now(),
  constraint hts_rag_ruling_scope_labels_pkey primary key (ruling_number, label_version, source_environment),
  constraint hts_rag_ruling_scope_labels_ruling_fkey foreign key (ruling_number)
    references hts_rag.hts_rag_rulings(ruling_number) on delete restrict,
  constraint hts_rag_ruling_scope_labels_label_check check (scope_label in (
    'classification', 'marking', 'country_of_origin', 'valuation', 'carriers', 'drawback',
    'entry', 'liquidation', 'tsus', 'other')),
  constraint hts_rag_ruling_scope_labels_method_check check (method in ('source', 'rule', 'model', 'manual')),
  constraint hts_rag_ruling_scope_labels_confidence_check check (confidence is null or (confidence >= 0 and confidence <= 1)),
  constraint hts_rag_ruling_scope_labels_evidence_check check (jsonb_typeof(evidence) = 'object'),
  constraint hts_rag_ruling_scope_labels_source_environment_chk check (source_environment in ('production', 'alsand'))
);
comment on table hts_rag.hts_rag_ruling_scope_labels is
  'Shelf-1 scope label per ruling and label_version; insert/delete only (no worker UPDATE). designflow-backend#278 plan_hts-4-upgrades.md Phase 2.';
create index hts_rag_ruling_scope_labels_version_idx
  on hts_rag.hts_rag_ruling_scope_labels (label_version, in_scope, ruling_number);
alter table hts_rag.hts_rag_ruling_scope_labels enable row level security;
revoke all on hts_rag.hts_rag_ruling_scope_labels
  from public, anon, authenticated, service_role,
       designflow_hts_prod_runtime, designflow_hts_alsand_runtime,
       designflow_hts_prod_worker, designflow_hts_alsand_worker;
grant select, insert, delete on hts_rag.hts_rag_ruling_scope_labels
  to designflow_hts_prod_worker, designflow_hts_alsand_worker;
grant select on hts_rag.hts_rag_ruling_scope_labels
  to designflow_hts_prod_runtime, designflow_hts_alsand_runtime;
create policy hts_rag_prod_worker_access on hts_rag.hts_rag_ruling_scope_labels
  for select to designflow_hts_prod_worker using (true);
create policy hts_rag_prod_worker_insert on hts_rag.hts_rag_ruling_scope_labels
  for insert to designflow_hts_prod_worker with check (source_environment = 'production');
create policy hts_rag_prod_worker_delete on hts_rag.hts_rag_ruling_scope_labels
  for delete to designflow_hts_prod_worker using (source_environment = 'production');
create policy hts_rag_alsand_worker_access on hts_rag.hts_rag_ruling_scope_labels
  for select to designflow_hts_alsand_worker using (true);
create policy hts_rag_alsand_worker_insert on hts_rag.hts_rag_ruling_scope_labels
  for insert to designflow_hts_alsand_worker with check (source_environment = 'alsand');
create policy hts_rag_alsand_worker_delete on hts_rag.hts_rag_ruling_scope_labels
  for delete to designflow_hts_alsand_worker using (source_environment = 'alsand');
create policy hts_rag_prod_runtime_read on hts_rag.hts_rag_ruling_scope_labels
  for select to designflow_hts_prod_runtime using (true);
create policy hts_rag_alsand_runtime_read on hts_rag.hts_rag_ruling_scope_labels
  for select to designflow_hts_alsand_runtime using (true);

create table hts_rag.hts_rag_ruling_passb (
  ruling_number text not null,
  extract_version text not null,
  model text not null,
  prompt_hash text not null,
  text_hash text not null,
  trigger_reasons text[] not null default '{}'::text[],
  raw_output jsonb,
  cost_usd numeric(8, 5),
  source_environment text not null,
  created_at timestamptz not null default now(),
  constraint hts_rag_ruling_passb_pkey primary key (ruling_number, extract_version, source_environment),
  constraint hts_rag_ruling_passb_ruling_fkey foreign key (ruling_number)
    references hts_rag.hts_rag_rulings(ruling_number) on delete restrict,
  constraint hts_rag_ruling_passb_source_environment_chk check (source_environment in ('production', 'alsand'))
);
comment on table hts_rag.hts_rag_ruling_passb is
  'Pass B CBP-reasoning extraction per ruling and extract_version; Pass A rows in hts_rag_extractions untouched; insert/delete only. designflow-backend#278 plan_hts-4-upgrades.md Phase 4.';
create index hts_rag_ruling_passb_version_idx
  on hts_rag.hts_rag_ruling_passb (extract_version, ruling_number);
alter table hts_rag.hts_rag_ruling_passb enable row level security;
revoke all on hts_rag.hts_rag_ruling_passb
  from public, anon, authenticated, service_role,
       designflow_hts_prod_runtime, designflow_hts_alsand_runtime,
       designflow_hts_prod_worker, designflow_hts_alsand_worker;
grant select, insert, delete on hts_rag.hts_rag_ruling_passb
  to designflow_hts_prod_worker, designflow_hts_alsand_worker;
grant select on hts_rag.hts_rag_ruling_passb
  to designflow_hts_prod_runtime, designflow_hts_alsand_runtime;
create policy hts_rag_prod_worker_access on hts_rag.hts_rag_ruling_passb
  for select to designflow_hts_prod_worker using (true);
create policy hts_rag_prod_worker_insert on hts_rag.hts_rag_ruling_passb
  for insert to designflow_hts_prod_worker with check (source_environment = 'production');
create policy hts_rag_prod_worker_delete on hts_rag.hts_rag_ruling_passb
  for delete to designflow_hts_prod_worker using (source_environment = 'production');
create policy hts_rag_alsand_worker_access on hts_rag.hts_rag_ruling_passb
  for select to designflow_hts_alsand_worker using (true);
create policy hts_rag_alsand_worker_insert on hts_rag.hts_rag_ruling_passb
  for insert to designflow_hts_alsand_worker with check (source_environment = 'alsand');
create policy hts_rag_alsand_worker_delete on hts_rag.hts_rag_ruling_passb
  for delete to designflow_hts_alsand_worker using (source_environment = 'alsand');
create policy hts_rag_prod_runtime_read on hts_rag.hts_rag_ruling_passb
  for select to designflow_hts_prod_runtime using (true);
create policy hts_rag_alsand_runtime_read on hts_rag.hts_rag_ruling_passb
  for select to designflow_hts_alsand_runtime using (true);
