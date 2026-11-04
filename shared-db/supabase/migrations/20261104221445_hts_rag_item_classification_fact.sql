-- derived-from: none
-- Issue #5596 (claim #5597, designflow-backend#278 plan step P2): classification facts a person
-- gives for a product at item setup. Owner, Albert Hazan, 2026-11-04 ~4:55 PM EST (plan approved in
-- designflow-backend PR #338): "P2: facts are collected at item setup from the requester, per
-- family, never inferred." The HTS classifier reads these before its first question and never
-- asks for a stored fact again; answers given in the question loop are written back here.
-- One value per (item_ref, fact_key) per environment. Rows are never deleted; a newer answer
-- replaces the value.

create table hts_rag.item_classification_fact (
  id uuid not null default gen_random_uuid(),
  item_ref text not null,
  family text not null,
  fact_key text not null,
  fact_value text not null,
  source text not null,
  answered_by text not null,
  answered_at timestamptz not null default now(),
  source_environment text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint item_classification_fact_pkey primary key (id),
  constraint item_classification_fact_source_check
    check (source in ('requester', 'designer', 'import')),
  constraint item_classification_fact_item_ref_check
    check (length(btrim(item_ref)) between 1 and 200),
  constraint item_classification_fact_fact_key_check
    check (fact_key ~ '^[a-z][a-z0-9_]{0,63}$'),
  constraint item_classification_fact_family_check
    check (family ~ '^[a-z][a-z0-9_]{0,63}$'),
  constraint item_classification_fact_value_check
    check (length(btrim(fact_value)) between 1 and 1500),
  constraint item_classification_fact_source_environment_chk
    check (source_environment in ('production', 'alsand'))
);
comment on table hts_rag.item_classification_fact is
  'Person-supplied classification fact for a product (never AI-inferred); read by the HTS classifier before it asks. designflow-backend#278.';
comment on column hts_rag.item_classification_fact.item_ref is
  'DesignFlow item reference: item:<itemHeader id>, rfqItem:<RFQ item id>, or a draft reference.';
create unique index item_classification_fact_item_fact_uq
  on hts_rag.item_classification_fact (source_environment, item_ref, fact_key);
create trigger set_updated_at
before update on hts_rag.item_classification_fact
for each row execute function app.set_updated_at();
alter table hts_rag.item_classification_fact enable row level security;
revoke all on hts_rag.item_classification_fact
  from public, anon, authenticated, service_role,
       designflow_hts_prod_runtime, designflow_hts_alsand_runtime,
       designflow_hts_prod_worker, designflow_hts_alsand_worker;
grant select, insert on hts_rag.item_classification_fact
  to designflow_hts_prod_worker, designflow_hts_alsand_worker;
grant update (family, fact_value, source, answered_by, answered_at)
  on hts_rag.item_classification_fact
  to designflow_hts_prod_worker, designflow_hts_alsand_worker;
grant select on hts_rag.item_classification_fact
  to designflow_hts_prod_runtime, designflow_hts_alsand_runtime;
create policy hts_rag_prod_worker_access on hts_rag.item_classification_fact
  for select to designflow_hts_prod_worker using (source_environment = 'production');
create policy hts_rag_prod_worker_insert on hts_rag.item_classification_fact
  for insert to designflow_hts_prod_worker with check (source_environment = 'production');
create policy hts_rag_prod_worker_update on hts_rag.item_classification_fact
  for update to designflow_hts_prod_worker
  using (source_environment = 'production') with check (source_environment = 'production');
create policy hts_rag_alsand_worker_access on hts_rag.item_classification_fact
  for select to designflow_hts_alsand_worker using (source_environment = 'alsand');
create policy hts_rag_alsand_worker_insert on hts_rag.item_classification_fact
  for insert to designflow_hts_alsand_worker with check (source_environment = 'alsand');
create policy hts_rag_alsand_worker_update on hts_rag.item_classification_fact
  for update to designflow_hts_alsand_worker
  using (source_environment = 'alsand') with check (source_environment = 'alsand');
create policy hts_rag_prod_runtime_read on hts_rag.item_classification_fact
  for select to designflow_hts_prod_runtime using (source_environment = 'production');
create policy hts_rag_alsand_runtime_read on hts_rag.item_classification_fact
  for select to designflow_hts_alsand_runtime using (source_environment = 'alsand');
