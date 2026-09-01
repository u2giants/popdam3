-- Durable, pilot-bounded HTS precedent and shadow-comparison contract (#2004).
-- No embeddings: retrieval shape remains intentionally undecided pending a benchmark.

create table public.hts_rag_precedents (
  id uuid primary key default gen_random_uuid(),
  product_family text not null check (btrim(product_family) <> ''),
  fixture_version text not null check (btrim(fixture_version) <> ''),
  prompt_version text not null check (btrim(prompt_version) <> ''),
  classifier_model text not null check (btrim(classifier_model) <> ''),
  verifier_model text not null check (btrim(verifier_model) <> ''),
  extraction_version text not null check (btrim(extraction_version) <> ''),
  fixture_hash text not null check (fixture_hash ~ '^[0-9a-f]{64}$'),
  input_hash text not null check (input_hash ~ '^[0-9a-f]{64}$'),
  raw_result_hash text not null check (raw_result_hash ~ '^[0-9a-f]{64}$'),
  normalized_facts jsonb not null default '{}'::jsonb check (jsonb_typeof(normalized_facts) = 'object'),
  positive_attributes jsonb not null default '[]'::jsonb check (jsonb_typeof(positive_attributes) = 'array'),
  negative_attributes jsonb not null default '[]'::jsonb check (jsonb_typeof(negative_attributes) = 'array'),
  exclusions_checked jsonb not null default '[]'::jsonb check (jsonb_typeof(exclusions_checked) = 'array'),
  missing_critical_facts jsonb not null default '[]'::jsonb check (jsonb_typeof(missing_critical_facts) = 'array'),
  conflicts jsonb not null default '[]'::jsonb check (jsonb_typeof(conflicts) = 'array'),
  plausible_headings jsonb not null default '[]'::jsonb check (jsonb_typeof(plausible_headings) = 'array'),
  proposed_hts text check (proposed_hts is null or proposed_hts ~ '^[0-9]{4}([.][0-9]{1,6})?$'),
  classification_state text not null check (classification_state in ('needs_more_facts','provisional_complete')),
  reasoning_summary text,
  confidence_components jsonb not null default '{}'::jsonb check (jsonb_typeof(confidence_components) = 'object'),
  decision_card_candidate boolean not null default false,
  operative_eligible boolean not null default false,
  review_state text not null default 'unreviewed' check (review_state in ('unreviewed','accepted','rejected','needs_revision')),
  created_at timestamptz not null default now(),
  constraint hts_rag_precedents_operability_chk check (not operative_eligible or classification_state = 'provisional_complete')
);

create unique index hts_rag_precedents_extraction_idempotency_idx
  on public.hts_rag_precedents (fixture_version, prompt_version, classifier_model, verifier_model, extraction_version, fixture_hash, input_hash, raw_result_hash);
create index hts_rag_precedents_family_review_idx
  on public.hts_rag_precedents (product_family, review_state, created_at desc);

create table public.hts_rag_precedent_rulings (
  id uuid primary key default gen_random_uuid(),
  precedent_id uuid not null references public.hts_rag_precedents(id) on delete restrict,
  ruling_id uuid not null references public.hts_rag_rulings(id) on delete restrict,
  provisional_claim text,
  verifier_relevance text not null default 'unverified' check (verifier_relevance in ('unverified','relevant','unrelated','conflicting')),
  source_status text not null default 'unknown' check (source_status in ('unknown','active','modified','revoked')),
  final_relationship text check (final_relationship is null or final_relationship in ('relied_on','supporting','contrasting','background')),
  verifier_result_hash text check (verifier_result_hash is null or verifier_result_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  unique (precedent_id, ruling_id)
);
create index hts_rag_precedent_rulings_ruling_idx on public.hts_rag_precedent_rulings (ruling_id);
create index hts_rag_precedent_rulings_relationship_idx on public.hts_rag_precedent_rulings (final_relationship, verifier_relevance);

create table public.hts_rag_product_examples (
  id uuid primary key default gen_random_uuid(),
  product_family text not null check (btrim(product_family) <> ''),
  fixture_version text not null check (btrim(fixture_version) <> ''),
  fixture_hash text not null check (fixture_hash ~ '^[0-9a-f]{64}$'),
  input_hash text not null check (input_hash ~ '^[0-9a-f]{64}$'),
  facts jsonb not null default '{}'::jsonb check (jsonb_typeof(facts) = 'object'),
  created_at timestamptz not null default now(),
  unique (fixture_version, fixture_hash, input_hash)
);
create index hts_rag_product_examples_family_idx on public.hts_rag_product_examples (product_family, created_at desc);

create table public.hts_rag_determinations (
  id uuid primary key default gen_random_uuid(),
  product_example_id uuid not null references public.hts_rag_product_examples(id) on delete restrict,
  precedent_id uuid references public.hts_rag_precedents(id) on delete restrict,
  method text not null check (method in ('legacy_ai_cross','rag_shadow')),
  proposed_hts text check (proposed_hts is null or proposed_hts ~ '^[0-9]{4}([.][0-9]{1,6})?$'),
  classification_state text not null check (classification_state in ('needs_more_facts','provisional_complete')),
  operative_eligible boolean not null default false,
  result_hash text not null check (result_hash ~ '^[0-9a-f]{64}$'),
  comparison_key uuid not null,
  comparison_review_state text not null default 'unreviewed' check (comparison_review_state in ('unreviewed','accepted','rejected','needs_revision')),
  created_at timestamptz not null default now(),
  constraint hts_rag_determinations_operability_chk check (not operative_eligible or classification_state = 'provisional_complete'),
  unique (method, product_example_id, result_hash)
);
create index hts_rag_determinations_family_created_idx on public.hts_rag_determinations (product_example_id, created_at desc);
create index hts_rag_determinations_comparison_review_idx on public.hts_rag_determinations (comparison_key, comparison_review_state, created_at desc);

create table public.hts_rag_extraction_jobs (
  id uuid primary key default gen_random_uuid(),
  product_example_id uuid not null references public.hts_rag_product_examples(id) on delete restrict,
  prompt_version text not null check (btrim(prompt_version) <> ''),
  model_version text not null check (btrim(model_version) <> ''),
  extraction_version text not null check (btrim(extraction_version) <> ''),
  input_hash text not null check (input_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'pending' check (status in ('pending','running','succeeded','failed','cancelled')),
  available_at timestamptz not null default now(),
  claimed_at timestamptz,
  claimed_by text,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  result_hash text check (result_hash is null or result_hash ~ '^[0-9a-f]{64}$'),
  error_code text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint hts_rag_extraction_jobs_claim_chk check ((claimed_at is null) = (claimed_by is null)),
  constraint hts_rag_extraction_jobs_completion_chk check ((status in ('succeeded','failed','cancelled')) = (completed_at is not null))
);
create index hts_rag_extraction_jobs_pending_claim_idx on public.hts_rag_extraction_jobs (available_at, created_at) where status = 'pending';
create unique index hts_rag_extraction_jobs_idempotency_idx on public.hts_rag_extraction_jobs (product_example_id, prompt_version, model_version, extraction_version, input_hash);

create table public.hts_rag_review_events (
  id uuid primary key default gen_random_uuid(),
  subject_type text not null check (subject_type in ('precedent','determination','precedent_ruling')),
  subject_id uuid not null,
  action text not null check (btrim(action) <> ''),
  prior_state text,
  new_state text,
  notes text,
  reviewed_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index hts_rag_review_events_subject_created_idx on public.hts_rag_review_events (subject_type, subject_id, created_at desc);

create table public.hts_rag_product_family_allowlist (
  product_family text primary key check (btrim(product_family) <> ''),
  enabled boolean not null default false,
  enabled_at timestamptz,
  enabled_by uuid,
  reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hts_rag_product_family_allowlist_enabled_chk check ((not enabled and enabled_at is null and enabled_by is null) or (enabled and enabled_at is not null and enabled_by is not null and btrim(coalesce(reason,'')) <> ''))
);
create index hts_rag_product_family_allowlist_enabled_idx on public.hts_rag_product_family_allowlist (product_family) where enabled;

alter table public.hts_rag_precedents enable row level security;
alter table public.hts_rag_precedent_rulings enable row level security;
alter table public.hts_rag_product_examples enable row level security;
alter table public.hts_rag_determinations enable row level security;
alter table public.hts_rag_extraction_jobs enable row level security;
alter table public.hts_rag_review_events enable row level security;
alter table public.hts_rag_product_family_allowlist enable row level security;

revoke all on public.hts_rag_precedents, public.hts_rag_precedent_rulings, public.hts_rag_product_examples,
  public.hts_rag_determinations, public.hts_rag_extraction_jobs, public.hts_rag_review_events,
  public.hts_rag_product_family_allowlist from anon, authenticated, service_role;
grant select on public.hts_rag_precedents, public.hts_rag_precedent_rulings, public.hts_rag_product_examples,
  public.hts_rag_determinations, public.hts_rag_review_events to authenticated;
grant all on public.hts_rag_precedents, public.hts_rag_precedent_rulings, public.hts_rag_product_examples,
  public.hts_rag_extraction_jobs, public.hts_rag_product_family_allowlist to service_role;
grant select, insert on public.hts_rag_determinations, public.hts_rag_review_events to service_role;

create policy hts_rag_precedents_backend_all on public.hts_rag_precedents for all to service_role using (true) with check (true);
create policy hts_rag_precedents_admin_read on public.hts_rag_precedents for select to authenticated using ((select app.has_role('administrator')));
create policy hts_rag_precedent_rulings_backend_all on public.hts_rag_precedent_rulings for all to service_role using (true) with check (true);
create policy hts_rag_precedent_rulings_admin_read on public.hts_rag_precedent_rulings for select to authenticated using ((select app.has_role('administrator')));
create policy hts_rag_product_examples_backend_all on public.hts_rag_product_examples for all to service_role using (true) with check (true);
create policy hts_rag_product_examples_admin_read on public.hts_rag_product_examples for select to authenticated using ((select app.has_role('administrator')));
create policy hts_rag_determinations_backend_all on public.hts_rag_determinations for all to service_role using (true) with check (true);
create policy hts_rag_determinations_admin_read on public.hts_rag_determinations for select to authenticated using ((select app.has_role('administrator')));
create policy hts_rag_extraction_jobs_backend_all on public.hts_rag_extraction_jobs for all to service_role using (true) with check (true);
create policy hts_rag_extraction_jobs_admin_read on public.hts_rag_extraction_jobs for select to authenticated using ((select app.has_role('administrator')));
create policy hts_rag_review_events_backend_insert on public.hts_rag_review_events for insert to service_role with check (true);
create policy hts_rag_review_events_admin_read on public.hts_rag_review_events for select to authenticated using ((select app.has_role('administrator')));
create policy hts_rag_product_family_allowlist_backend_all on public.hts_rag_product_family_allowlist for all to service_role using (true) with check (true);
create policy hts_rag_product_family_allowlist_admin_read on public.hts_rag_product_family_allowlist for select to authenticated using ((select app.has_role('administrator')));

comment on table public.hts_rag_determinations is 'Immutable RAG-shadow and legacy AI/CROSS comparison outcomes. Backend may append but cannot update or delete history.';
comment on table public.hts_rag_review_events is 'Append-only human review history. Corrections are new events; UPDATE and DELETE are not granted.';
comment on table public.hts_rag_product_family_allowlist is 'Product families eligible for later RAG activation. Every row is disabled unless explicitly enabled with actor, time, and reason.';
