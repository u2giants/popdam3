-- Issue #5566 (claim #5567, designflow-backend#278): a customs broker's opinion on an HTS code.
-- Owner, Albert Hazan, 2026-11-03 10:32 PM EST: "we will probably have to get our broker's
-- opinion. then we need a place in the system to record that at mark it as authoritative".
-- Two subjects: a CBP ruling's held code that was renumbered (ruling_number + held_code), or a
-- classifier answer for a POP product (determination_id, optional rfq_item_id). An authoritative
-- opinion overrides the AI's most-likely and second-most-likely codes wherever DesignFlow reads
-- them. At most one authoritative opinion per subject per environment. Rows are never deleted;
-- superseding an opinion clears its flag.

create table hts_rag.hts_rag_broker_opinions (
  id uuid not null default gen_random_uuid(),
  subject_kind text not null,
  ruling_number text,
  held_code text,
  determination_id uuid,
  rfq_item_id integer,
  broker_code text not null,
  broker_firm text not null,
  broker_person text,
  opinion_date date not null,
  notes text,
  evidence jsonb not null default '[]'::jsonb,
  is_authoritative boolean not null default false,
  recorded_by text not null,
  source_environment text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hts_rag_broker_opinions_pkey primary key (id),
  constraint hts_rag_broker_opinions_ruling_fkey foreign key (ruling_number)
    references hts_rag.hts_rag_rulings(ruling_number) on delete restrict,
  constraint hts_rag_broker_opinions_determination_fkey foreign key (determination_id)
    references hts_rag.hts_rag_determinations(id) on delete restrict,
  constraint hts_rag_broker_opinions_subject_check check (
    (subject_kind = 'ruling_code' and ruling_number is not null and held_code is not null
       and determination_id is null and rfq_item_id is null)
    or (subject_kind = 'product' and determination_id is not null
       and ruling_number is null and held_code is null)),
  constraint hts_rag_broker_opinions_code_check
    check (broker_code ~ '^[0-9]{4}\.[0-9]{2}\.[0-9]{2}\.[0-9]{2}$'),
  constraint hts_rag_broker_opinions_evidence_check check (jsonb_typeof(evidence) = 'array'),
  constraint hts_rag_broker_opinions_source_environment_chk
    check (source_environment in ('production', 'alsand'))
);
comment on table hts_rag.hts_rag_broker_opinions is
  'Customs broker opinion on an HTS code; an authoritative row overrides AI candidates. designflow-backend#278.';
create unique index hts_rag_broker_opinions_ruling_auth_uq
  on hts_rag.hts_rag_broker_opinions (ruling_number, held_code, source_environment)
  where is_authoritative and subject_kind = 'ruling_code';
create unique index hts_rag_broker_opinions_product_auth_uq
  on hts_rag.hts_rag_broker_opinions (determination_id, source_environment)
  where is_authoritative and subject_kind = 'product';
create index hts_rag_broker_opinions_ruling_idx
  on hts_rag.hts_rag_broker_opinions (ruling_number) where ruling_number is not null;
create index hts_rag_broker_opinions_determination_idx
  on hts_rag.hts_rag_broker_opinions (determination_id) where determination_id is not null;
create trigger set_updated_at
before update on hts_rag.hts_rag_broker_opinions
for each row execute function app.set_updated_at();
alter table hts_rag.hts_rag_broker_opinions enable row level security;
revoke all on hts_rag.hts_rag_broker_opinions
  from public, anon, authenticated, service_role,
       designflow_hts_prod_runtime, designflow_hts_alsand_runtime,
       designflow_hts_prod_worker, designflow_hts_alsand_worker;
grant select, insert on hts_rag.hts_rag_broker_opinions
  to designflow_hts_prod_worker, designflow_hts_alsand_worker;
grant update (is_authoritative, notes, evidence)
  on hts_rag.hts_rag_broker_opinions
  to designflow_hts_prod_worker, designflow_hts_alsand_worker;
grant select on hts_rag.hts_rag_broker_opinions
  to designflow_hts_prod_runtime, designflow_hts_alsand_runtime;
create policy hts_rag_prod_worker_access on hts_rag.hts_rag_broker_opinions
  for select to designflow_hts_prod_worker using (source_environment = 'production');
create policy hts_rag_prod_worker_insert on hts_rag.hts_rag_broker_opinions
  for insert to designflow_hts_prod_worker with check (source_environment = 'production');
create policy hts_rag_prod_worker_update on hts_rag.hts_rag_broker_opinions
  for update to designflow_hts_prod_worker
  using (source_environment = 'production') with check (source_environment = 'production');
create policy hts_rag_alsand_worker_access on hts_rag.hts_rag_broker_opinions
  for select to designflow_hts_alsand_worker using (source_environment = 'alsand');
create policy hts_rag_alsand_worker_insert on hts_rag.hts_rag_broker_opinions
  for insert to designflow_hts_alsand_worker with check (source_environment = 'alsand');
create policy hts_rag_alsand_worker_update on hts_rag.hts_rag_broker_opinions
  for update to designflow_hts_alsand_worker
  using (source_environment = 'alsand') with check (source_environment = 'alsand');
create policy hts_rag_prod_runtime_read on hts_rag.hts_rag_broker_opinions
  for select to designflow_hts_prod_runtime using (source_environment = 'production');
create policy hts_rag_alsand_runtime_read on hts_rag.hts_rag_broker_opinions
  for select to designflow_hts_alsand_runtime using (source_environment = 'alsand');
