-- Issue #5015 (claim #5016, designflow-backend#254): the CBP ruling database ("CBP's brain").
-- Design: popcre/designflow-backend docs/design_cbp-ruling-database.md (Muse
-- critique SOUND WITH CHANGES, adopted). First build per design section 10.
-- Layers: law (links, HTS codes, renumbering), products, attributes, heading
-- decisions, vocabulary, and the computed type_heading_stats view.
-- All CBP/USITC evidence: shared SELECT for both workers, INSERT bound to the
-- writer's environment, bounded column UPDATE. Extraction-derived rows may be
-- deleted by workers so a new extract_version can replace them (they are
-- recomputable from hts_rag_rulings.raw_json). No runtime or Data API access.

-- Source columns on the existing ruling table.
alter table hts_rag.hts_rag_rulings add column category text;
alter table hts_rag.hts_rag_rulings add column raw_json jsonb;
alter table hts_rag.hts_rag_rulings add column hs_era text;
alter table hts_rag.hts_rag_rulings add column effective_status text not null default 'active';
alter table hts_rag.hts_rag_rulings add column extract_version text;
alter table hts_rag.hts_rag_rulings add column extracted_at timestamptz;
alter table hts_rag.hts_rag_rulings add column pdf_url text;
alter table hts_rag.hts_rag_rulings
  add constraint hts_rag_rulings_effective_status_check
  check (effective_status in ('active', 'modified', 'revoked'));
create index hts_rag_rulings_category_status_idx
  on hts_rag.hts_rag_rulings (category, effective_status);
grant update (category, raw_json, hs_era, effective_status, extract_version, extracted_at, pdf_url)
  on hts_rag.hts_rag_rulings to designflow_hts_prod_worker, designflow_hts_alsand_worker;

create table hts_rag.hts_rag_hts_codes (
  id uuid not null default gen_random_uuid(),
  code text not null,
  revision text not null,
  description text not null,
  indent smallint not null default 0,
  parent_code text,
  valid_from date,
  valid_to date,
  source_environment text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hts_rag_hts_codes_pkey primary key (id),
  constraint hts_rag_hts_codes_code_revision_key unique (code, revision),
  constraint hts_rag_hts_codes_code_check check (code ~ '^[0-9]{4}(\.[0-9]{2}){0,3}$'),
  constraint hts_rag_hts_codes_source_environment_chk check (source_environment in ('production', 'alsand'))
);
comment on table hts_rag.hts_rag_hts_codes is
  'Official USITC HTS lines per revision (USITC data only, never hand-typed). Design: designflow-backend#254.';
create trigger set_updated_at
before update on hts_rag.hts_rag_hts_codes
for each row execute function app.set_updated_at();
alter table hts_rag.hts_rag_hts_codes enable row level security;
revoke all on hts_rag.hts_rag_hts_codes
  from public, anon, authenticated, service_role,
       designflow_hts_prod_runtime, designflow_hts_alsand_runtime,
       designflow_hts_prod_worker, designflow_hts_alsand_worker;
grant select, insert on hts_rag.hts_rag_hts_codes
  to designflow_hts_prod_worker, designflow_hts_alsand_worker;
grant update (description, indent, parent_code, valid_from, valid_to)
  on hts_rag.hts_rag_hts_codes
  to designflow_hts_prod_worker, designflow_hts_alsand_worker;
create policy hts_rag_prod_worker_access on hts_rag.hts_rag_hts_codes
  for select to designflow_hts_prod_worker using (true);
create policy hts_rag_prod_worker_insert on hts_rag.hts_rag_hts_codes
  for insert to designflow_hts_prod_worker with check (source_environment = 'production');
create policy hts_rag_prod_worker_update on hts_rag.hts_rag_hts_codes
  for update to designflow_hts_prod_worker using (true) with check (true);
create policy hts_rag_alsand_worker_access on hts_rag.hts_rag_hts_codes
  for select to designflow_hts_alsand_worker using (true);
create policy hts_rag_alsand_worker_insert on hts_rag.hts_rag_hts_codes
  for insert to designflow_hts_alsand_worker with check (source_environment = 'alsand');
create policy hts_rag_alsand_worker_update on hts_rag.hts_rag_hts_codes
  for update to designflow_hts_alsand_worker using (true) with check (true);

create table hts_rag.hts_rag_hts_renumbering (
  id uuid not null default gen_random_uuid(),
  old_code text not null,
  new_code text,
  revision text not null,
  source_environment text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hts_rag_hts_renumbering_pkey primary key (id),
  constraint hts_rag_hts_renumbering_uq unique nulls not distinct (old_code, new_code, revision),
  constraint hts_rag_hts_renumbering_source_environment_chk check (source_environment in ('production', 'alsand'))
);
comment on table hts_rag.hts_rag_hts_renumbering is
  'Many-to-many USITC renumbering map; new_code null means no current equivalent (flagged, never guessed).';
create trigger set_updated_at
before update on hts_rag.hts_rag_hts_renumbering
for each row execute function app.set_updated_at();
alter table hts_rag.hts_rag_hts_renumbering enable row level security;
revoke all on hts_rag.hts_rag_hts_renumbering
  from public, anon, authenticated, service_role,
       designflow_hts_prod_runtime, designflow_hts_alsand_runtime,
       designflow_hts_prod_worker, designflow_hts_alsand_worker;
grant select, insert on hts_rag.hts_rag_hts_renumbering
  to designflow_hts_prod_worker, designflow_hts_alsand_worker;
create policy hts_rag_prod_worker_access on hts_rag.hts_rag_hts_renumbering
  for select to designflow_hts_prod_worker using (true);
create policy hts_rag_prod_worker_insert on hts_rag.hts_rag_hts_renumbering
  for insert to designflow_hts_prod_worker with check (source_environment = 'production');
create policy hts_rag_alsand_worker_access on hts_rag.hts_rag_hts_renumbering
  for select to designflow_hts_alsand_worker using (true);
create policy hts_rag_alsand_worker_insert on hts_rag.hts_rag_hts_renumbering
  for insert to designflow_hts_alsand_worker with check (source_environment = 'alsand');

create table hts_rag.hts_rag_ruling_links (
  from_ruling text not null,
  to_ruling text not null,
  kind text not null,
  link_source text not null,
  product_label text,
  source_environment text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hts_rag_ruling_links_pkey primary key (from_ruling, to_ruling, kind),
  constraint hts_rag_ruling_links_from_fkey foreign key (from_ruling)
    references hts_rag.hts_rag_rulings(ruling_number) on delete restrict,
  constraint hts_rag_ruling_links_kind_check
    check (kind in ('revokes', 'modifies', 'cites', 'follows', 'distinguishes')),
  constraint hts_rag_ruling_links_source_check check (link_source in ('cbp_field', 'text')),
  constraint hts_rag_ruling_links_source_environment_chk check (source_environment in ('production', 'alsand'))
);
comment on table hts_rag.hts_rag_ruling_links is
  'Ruling precedent graph (revokes/modifies/cites/follows/distinguishes); drives effective_status. to_ruling may not be harvested yet, so it has no FK.';
create trigger set_updated_at
before update on hts_rag.hts_rag_ruling_links
for each row execute function app.set_updated_at();
alter table hts_rag.hts_rag_ruling_links enable row level security;
revoke all on hts_rag.hts_rag_ruling_links
  from public, anon, authenticated, service_role,
       designflow_hts_prod_runtime, designflow_hts_alsand_runtime,
       designflow_hts_prod_worker, designflow_hts_alsand_worker;
grant select, insert, delete on hts_rag.hts_rag_ruling_links
  to designflow_hts_prod_worker, designflow_hts_alsand_worker;
grant update (link_source, product_label)
  on hts_rag.hts_rag_ruling_links
  to designflow_hts_prod_worker, designflow_hts_alsand_worker;
create policy hts_rag_prod_worker_access on hts_rag.hts_rag_ruling_links
  for select to designflow_hts_prod_worker using (true);
create policy hts_rag_prod_worker_insert on hts_rag.hts_rag_ruling_links
  for insert to designflow_hts_prod_worker with check (source_environment = 'production');
create policy hts_rag_prod_worker_update on hts_rag.hts_rag_ruling_links
  for update to designflow_hts_prod_worker using (true) with check (true);
create policy hts_rag_prod_worker_delete on hts_rag.hts_rag_ruling_links
  for delete to designflow_hts_prod_worker using (true);
create policy hts_rag_alsand_worker_access on hts_rag.hts_rag_ruling_links
  for select to designflow_hts_alsand_worker using (true);
create policy hts_rag_alsand_worker_insert on hts_rag.hts_rag_ruling_links
  for insert to designflow_hts_alsand_worker with check (source_environment = 'alsand');
create policy hts_rag_alsand_worker_update on hts_rag.hts_rag_ruling_links
  for update to designflow_hts_alsand_worker using (true) with check (true);
create policy hts_rag_alsand_worker_delete on hts_rag.hts_rag_ruling_links
  for delete to designflow_hts_alsand_worker using (true);

create table hts_rag.hts_rag_ruling_codes (
  id uuid not null default gen_random_uuid(),
  ruling_number text not null,
  code text not null,
  role text not null,
  source_span int4range,
  extract_version text not null,
  source_environment text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hts_rag_ruling_codes_pkey primary key (id),
  constraint hts_rag_ruling_codes_ruling_fkey foreign key (ruling_number)
    references hts_rag.hts_rag_rulings(ruling_number) on delete restrict,
  constraint hts_rag_ruling_codes_role_check
    check (role in ('held', 'rejected', 'mentioned', 'cited_from_other_ruling')),
  constraint hts_rag_ruling_codes_uq unique (ruling_number, code, role, extract_version),
  constraint hts_rag_ruling_codes_source_environment_chk check (source_environment in ('production', 'alsand'))
);
comment on table hts_rag.hts_rag_ruling_codes is
  'Every HTS code in a ruling with its role; held comes from the holding sentence first (fixes counting rejected codes as agreement).';
create trigger set_updated_at
before update on hts_rag.hts_rag_ruling_codes
for each row execute function app.set_updated_at();
alter table hts_rag.hts_rag_ruling_codes enable row level security;
revoke all on hts_rag.hts_rag_ruling_codes
  from public, anon, authenticated, service_role,
       designflow_hts_prod_runtime, designflow_hts_alsand_runtime,
       designflow_hts_prod_worker, designflow_hts_alsand_worker;
grant select, insert, delete on hts_rag.hts_rag_ruling_codes
  to designflow_hts_prod_worker, designflow_hts_alsand_worker;
create policy hts_rag_prod_worker_access on hts_rag.hts_rag_ruling_codes
  for select to designflow_hts_prod_worker using (true);
create policy hts_rag_prod_worker_insert on hts_rag.hts_rag_ruling_codes
  for insert to designflow_hts_prod_worker with check (source_environment = 'production');
create policy hts_rag_prod_worker_delete on hts_rag.hts_rag_ruling_codes
  for delete to designflow_hts_prod_worker using (true);
create policy hts_rag_alsand_worker_access on hts_rag.hts_rag_ruling_codes
  for select to designflow_hts_alsand_worker using (true);
create policy hts_rag_alsand_worker_insert on hts_rag.hts_rag_ruling_codes
  for insert to designflow_hts_alsand_worker with check (source_environment = 'alsand');
create policy hts_rag_alsand_worker_delete on hts_rag.hts_rag_ruling_codes
  for delete to designflow_hts_alsand_worker using (true);

create table hts_rag.hts_rag_article_types (
  id uuid not null default gen_random_uuid(),
  name text not null,
  synonyms text[] not null default '{}',
  vocab_version text not null,
  name_embedding extensions.halfvec(768),
  source_environment text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hts_rag_article_types_pkey primary key (id),
  constraint hts_rag_article_types_name_key unique (name),
  constraint hts_rag_article_types_name_check check (btrim(name) <> ''),
  constraint hts_rag_article_types_source_environment_chk check (source_environment in ('production', 'alsand'))
);
comment on table hts_rag.hts_rag_article_types is
  'Canonical article types vocabulary with synonyms, built by clustering ruling phrases (flat in v1).';
create trigger set_updated_at
before update on hts_rag.hts_rag_article_types
for each row execute function app.set_updated_at();
alter table hts_rag.hts_rag_article_types enable row level security;
revoke all on hts_rag.hts_rag_article_types
  from public, anon, authenticated, service_role,
       designflow_hts_prod_runtime, designflow_hts_alsand_runtime,
       designflow_hts_prod_worker, designflow_hts_alsand_worker;
grant select, insert on hts_rag.hts_rag_article_types
  to designflow_hts_prod_worker, designflow_hts_alsand_worker;
grant update (synonyms, vocab_version, name_embedding, updated_at)
  on hts_rag.hts_rag_article_types
  to designflow_hts_prod_worker, designflow_hts_alsand_worker;
create policy hts_rag_prod_worker_access on hts_rag.hts_rag_article_types
  for select to designflow_hts_prod_worker using (true);
create policy hts_rag_prod_worker_insert on hts_rag.hts_rag_article_types
  for insert to designflow_hts_prod_worker with check (source_environment = 'production');
create policy hts_rag_prod_worker_update on hts_rag.hts_rag_article_types
  for update to designflow_hts_prod_worker using (true) with check (true);
create policy hts_rag_alsand_worker_access on hts_rag.hts_rag_article_types
  for select to designflow_hts_alsand_worker using (true);
create policy hts_rag_alsand_worker_insert on hts_rag.hts_rag_article_types
  for insert to designflow_hts_alsand_worker with check (source_environment = 'alsand');
create policy hts_rag_alsand_worker_update on hts_rag.hts_rag_article_types
  for update to designflow_hts_alsand_worker using (true) with check (true);

create table hts_rag.hts_rag_materials (
  id uuid not null default gen_random_uuid(),
  name text not null,
  synonyms text[] not null default '{}',
  vocab_version text not null,
  name_embedding extensions.halfvec(768),
  source_environment text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hts_rag_materials_pkey primary key (id),
  constraint hts_rag_materials_name_key unique (name),
  constraint hts_rag_materials_name_check check (btrim(name) <> ''),
  constraint hts_rag_materials_source_environment_chk check (source_environment in ('production', 'alsand'))
);
comment on table hts_rag.hts_rag_materials is
  'Canonical materials vocabulary with synonyms, built by clustering ruling phrases (flat in v1).';
create trigger set_updated_at
before update on hts_rag.hts_rag_materials
for each row execute function app.set_updated_at();
alter table hts_rag.hts_rag_materials enable row level security;
revoke all on hts_rag.hts_rag_materials
  from public, anon, authenticated, service_role,
       designflow_hts_prod_runtime, designflow_hts_alsand_runtime,
       designflow_hts_prod_worker, designflow_hts_alsand_worker;
grant select, insert on hts_rag.hts_rag_materials
  to designflow_hts_prod_worker, designflow_hts_alsand_worker;
grant update (synonyms, vocab_version, name_embedding, updated_at)
  on hts_rag.hts_rag_materials
  to designflow_hts_prod_worker, designflow_hts_alsand_worker;
create policy hts_rag_prod_worker_access on hts_rag.hts_rag_materials
  for select to designflow_hts_prod_worker using (true);
create policy hts_rag_prod_worker_insert on hts_rag.hts_rag_materials
  for insert to designflow_hts_prod_worker with check (source_environment = 'production');
create policy hts_rag_prod_worker_update on hts_rag.hts_rag_materials
  for update to designflow_hts_prod_worker using (true) with check (true);
create policy hts_rag_alsand_worker_access on hts_rag.hts_rag_materials
  for select to designflow_hts_alsand_worker using (true);
create policy hts_rag_alsand_worker_insert on hts_rag.hts_rag_materials
  for insert to designflow_hts_alsand_worker with check (source_environment = 'alsand');
create policy hts_rag_alsand_worker_update on hts_rag.hts_rag_materials
  for update to designflow_hts_alsand_worker using (true) with check (true);

create table hts_rag.hts_rag_attribute_keys (
  key text not null,
  kind text not null,
  unit text,
  vocab_version text not null,
  source_environment text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hts_rag_attribute_keys_pkey primary key (key),
  constraint hts_rag_attribute_keys_kind_check check (kind in ('text', 'number', 'boolean', 'range')),
  constraint hts_rag_attribute_keys_source_environment_chk check (source_environment in ('production', 'alsand'))
);
comment on table hts_rag.hts_rag_attribute_keys is
  'Vocabulary of fact kinds CBP decides on (material_pct, function, user_age, illuminated, ...).';
create trigger set_updated_at
before update on hts_rag.hts_rag_attribute_keys
for each row execute function app.set_updated_at();
alter table hts_rag.hts_rag_attribute_keys enable row level security;
revoke all on hts_rag.hts_rag_attribute_keys
  from public, anon, authenticated, service_role,
       designflow_hts_prod_runtime, designflow_hts_alsand_runtime,
       designflow_hts_prod_worker, designflow_hts_alsand_worker;
grant select, insert on hts_rag.hts_rag_attribute_keys
  to designflow_hts_prod_worker, designflow_hts_alsand_worker;
grant update (unit, vocab_version, updated_at)
  on hts_rag.hts_rag_attribute_keys
  to designflow_hts_prod_worker, designflow_hts_alsand_worker;
create policy hts_rag_prod_worker_access on hts_rag.hts_rag_attribute_keys
  for select to designflow_hts_prod_worker using (true);
create policy hts_rag_prod_worker_insert on hts_rag.hts_rag_attribute_keys
  for insert to designflow_hts_prod_worker with check (source_environment = 'production');
create policy hts_rag_prod_worker_update on hts_rag.hts_rag_attribute_keys
  for update to designflow_hts_prod_worker using (true) with check (true);
create policy hts_rag_alsand_worker_access on hts_rag.hts_rag_attribute_keys
  for select to designflow_hts_alsand_worker using (true);
create policy hts_rag_alsand_worker_insert on hts_rag.hts_rag_attribute_keys
  for insert to designflow_hts_alsand_worker with check (source_environment = 'alsand');
create policy hts_rag_alsand_worker_update on hts_rag.hts_rag_attribute_keys
  for update to designflow_hts_alsand_worker using (true) with check (true);

create table hts_rag.hts_rag_ruling_products (
  id uuid not null default gen_random_uuid(),
  ruling_number text not null,
  item_label text not null,
  plain_phrase text not null,
  article_type_id uuid,
  primary_material_id uuid,
  description_text text,
  held_code text,
  held_code_current text[] not null default '{}',
  held_heading text,
  held_chapter text,
  is_set boolean not null default false,
  is_composite boolean not null default false,
  source_span int4range,
  effective_status text not null default 'active',
  phrase_embedding extensions.halfvec(768),
  confidence_checks jsonb not null default '{}'::jsonb,
  review_state text not null default 'pending',
  extract_version text not null,
  source_environment text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hts_rag_ruling_products_pkey primary key (id),
  constraint hts_rag_ruling_products_ruling_fkey foreign key (ruling_number)
    references hts_rag.hts_rag_rulings(ruling_number) on delete restrict,
  constraint hts_rag_ruling_products_article_type_fkey foreign key (article_type_id)
    references hts_rag.hts_rag_article_types(id) on delete set null,
  constraint hts_rag_ruling_products_material_fkey foreign key (primary_material_id)
    references hts_rag.hts_rag_materials(id) on delete set null,
  constraint hts_rag_ruling_products_status_check
    check (effective_status in ('active', 'modified', 'revoked')),
  constraint hts_rag_ruling_products_review_check
    check (review_state in ('pending', 'trusted', 'review_queue', 'rejected')),
  constraint hts_rag_ruling_products_heading_check check (held_heading is null or held_heading ~ '^[0-9]{4}$'),
  constraint hts_rag_ruling_products_chapter_check check (held_chapter is null or held_chapter ~ '^[0-9]{2}$'),
  constraint hts_rag_ruling_products_checks_object check (jsonb_typeof(confidence_checks) = 'object'),
  constraint hts_rag_ruling_products_source_environment_chk check (source_environment in ('production', 'alsand'))
);
comment on table hts_rag.hts_rag_ruling_products is
  'One row per product a CBP ruling classifies (search target). effective_status is per product: a modification may revoke one product only.';
create trigger set_updated_at
before update on hts_rag.hts_rag_ruling_products
for each row execute function app.set_updated_at();
alter table hts_rag.hts_rag_ruling_products enable row level security;
revoke all on hts_rag.hts_rag_ruling_products
  from public, anon, authenticated, service_role,
       designflow_hts_prod_runtime, designflow_hts_alsand_runtime,
       designflow_hts_prod_worker, designflow_hts_alsand_worker;
grant select, insert, delete on hts_rag.hts_rag_ruling_products
  to designflow_hts_prod_worker, designflow_hts_alsand_worker;
grant update (article_type_id, primary_material_id, held_code_current, effective_status, phrase_embedding, confidence_checks, review_state, updated_at)
  on hts_rag.hts_rag_ruling_products
  to designflow_hts_prod_worker, designflow_hts_alsand_worker;
create policy hts_rag_prod_worker_access on hts_rag.hts_rag_ruling_products
  for select to designflow_hts_prod_worker using (true);
create policy hts_rag_prod_worker_insert on hts_rag.hts_rag_ruling_products
  for insert to designflow_hts_prod_worker with check (source_environment = 'production');
create policy hts_rag_prod_worker_update on hts_rag.hts_rag_ruling_products
  for update to designflow_hts_prod_worker using (true) with check (true);
create policy hts_rag_prod_worker_delete on hts_rag.hts_rag_ruling_products
  for delete to designflow_hts_prod_worker using (true);
create policy hts_rag_alsand_worker_access on hts_rag.hts_rag_ruling_products
  for select to designflow_hts_alsand_worker using (true);
create policy hts_rag_alsand_worker_insert on hts_rag.hts_rag_ruling_products
  for insert to designflow_hts_alsand_worker with check (source_environment = 'alsand');
create policy hts_rag_alsand_worker_update on hts_rag.hts_rag_ruling_products
  for update to designflow_hts_alsand_worker using (true) with check (true);
create policy hts_rag_alsand_worker_delete on hts_rag.hts_rag_ruling_products
  for delete to designflow_hts_alsand_worker using (true);

create table hts_rag.hts_rag_product_components (
  id uuid not null default gen_random_uuid(),
  product_id uuid not null,
  component text not null,
  material text,
  own_code_if_stated text,
  is_essential_character boolean not null default false,
  source_environment text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hts_rag_product_components_pkey primary key (id),
  constraint hts_rag_product_components_product_fkey foreign key (product_id)
    references hts_rag.hts_rag_ruling_products(id) on delete cascade,
  constraint hts_rag_product_components_source_environment_chk check (source_environment in ('production', 'alsand'))
);
comment on table hts_rag.hts_rag_product_components is
  'Components of sets and composite goods (GRI 3).';
create trigger set_updated_at
before update on hts_rag.hts_rag_product_components
for each row execute function app.set_updated_at();
alter table hts_rag.hts_rag_product_components enable row level security;
revoke all on hts_rag.hts_rag_product_components
  from public, anon, authenticated, service_role,
       designflow_hts_prod_runtime, designflow_hts_alsand_runtime,
       designflow_hts_prod_worker, designflow_hts_alsand_worker;
grant select, insert, delete on hts_rag.hts_rag_product_components
  to designflow_hts_prod_worker, designflow_hts_alsand_worker;
create policy hts_rag_prod_worker_access on hts_rag.hts_rag_product_components
  for select to designflow_hts_prod_worker using (true);
create policy hts_rag_prod_worker_insert on hts_rag.hts_rag_product_components
  for insert to designflow_hts_prod_worker with check (source_environment = 'production');
create policy hts_rag_prod_worker_delete on hts_rag.hts_rag_product_components
  for delete to designflow_hts_prod_worker using (true);
create policy hts_rag_alsand_worker_access on hts_rag.hts_rag_product_components
  for select to designflow_hts_alsand_worker using (true);
create policy hts_rag_alsand_worker_insert on hts_rag.hts_rag_product_components
  for insert to designflow_hts_alsand_worker with check (source_environment = 'alsand');
create policy hts_rag_alsand_worker_delete on hts_rag.hts_rag_product_components
  for delete to designflow_hts_alsand_worker using (true);

create table hts_rag.hts_rag_product_attributes (
  id uuid not null default gen_random_uuid(),
  product_id uuid not null,
  key text not null,
  value_text text,
  value_num numeric,
  unit text,
  basis text,
  is_decisive boolean not null default false,
  source_span int4range not null,
  source_environment text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hts_rag_product_attributes_pkey primary key (id),
  constraint hts_rag_product_attributes_product_fkey foreign key (product_id)
    references hts_rag.hts_rag_ruling_products(id) on delete cascade,
  constraint hts_rag_product_attributes_key_fkey foreign key (key)
    references hts_rag.hts_rag_attribute_keys(key) on delete restrict,
  constraint hts_rag_product_attributes_value_check check (value_text is not null or value_num is not null),
  constraint hts_rag_product_attributes_basis_check check (basis is null or basis in ('weight', 'value', 'surface', 'volume', 'count')),
  constraint hts_rag_product_attributes_source_environment_chk check (source_environment in ('production', 'alsand'))
);
comment on table hts_rag.hts_rag_product_attributes is
  'Normalized product facts, each tied to the ruling sentence that states it; is_decisive = CBP named it as a reason.';
create trigger set_updated_at
before update on hts_rag.hts_rag_product_attributes
for each row execute function app.set_updated_at();
alter table hts_rag.hts_rag_product_attributes enable row level security;
revoke all on hts_rag.hts_rag_product_attributes
  from public, anon, authenticated, service_role,
       designflow_hts_prod_runtime, designflow_hts_alsand_runtime,
       designflow_hts_prod_worker, designflow_hts_alsand_worker;
grant select, insert, delete on hts_rag.hts_rag_product_attributes
  to designflow_hts_prod_worker, designflow_hts_alsand_worker;
create policy hts_rag_prod_worker_access on hts_rag.hts_rag_product_attributes
  for select to designflow_hts_prod_worker using (true);
create policy hts_rag_prod_worker_insert on hts_rag.hts_rag_product_attributes
  for insert to designflow_hts_prod_worker with check (source_environment = 'production');
create policy hts_rag_prod_worker_delete on hts_rag.hts_rag_product_attributes
  for delete to designflow_hts_prod_worker using (true);
create policy hts_rag_alsand_worker_access on hts_rag.hts_rag_product_attributes
  for select to designflow_hts_alsand_worker using (true);
create policy hts_rag_alsand_worker_insert on hts_rag.hts_rag_product_attributes
  for insert to designflow_hts_alsand_worker with check (source_environment = 'alsand');
create policy hts_rag_alsand_worker_delete on hts_rag.hts_rag_product_attributes
  for delete to designflow_hts_alsand_worker using (true);

create table hts_rag.hts_rag_heading_decisions (
  id uuid not null default gen_random_uuid(),
  product_id uuid not null,
  heading text not null,
  outcome text not null,
  rule_used text[] not null default '{}',
  legal_note_refs text[] not null default '{}',
  reason_text text,
  decisive_keys text[] not null default '{}',
  source_span int4range,
  source_environment text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hts_rag_heading_decisions_pkey primary key (id),
  constraint hts_rag_heading_decisions_product_fkey foreign key (product_id)
    references hts_rag.hts_rag_ruling_products(id) on delete cascade,
  constraint hts_rag_heading_decisions_heading_check check (heading ~ '^[0-9]{4}$'),
  constraint hts_rag_heading_decisions_outcome_check
    check (outcome in ('held', 'rejected', 'alternative_mentioned')),
  constraint hts_rag_heading_decisions_source_environment_chk check (source_environment in ('production', 'alsand'))
);
comment on table hts_rag.hts_rag_heading_decisions is
  'Every heading CBP weighed for a product, winners and losers, with rule, notes and CBPs verbatim reason.';
create trigger set_updated_at
before update on hts_rag.hts_rag_heading_decisions
for each row execute function app.set_updated_at();
alter table hts_rag.hts_rag_heading_decisions enable row level security;
revoke all on hts_rag.hts_rag_heading_decisions
  from public, anon, authenticated, service_role,
       designflow_hts_prod_runtime, designflow_hts_alsand_runtime,
       designflow_hts_prod_worker, designflow_hts_alsand_worker;
grant select, insert, delete on hts_rag.hts_rag_heading_decisions
  to designflow_hts_prod_worker, designflow_hts_alsand_worker;
create policy hts_rag_prod_worker_access on hts_rag.hts_rag_heading_decisions
  for select to designflow_hts_prod_worker using (true);
create policy hts_rag_prod_worker_insert on hts_rag.hts_rag_heading_decisions
  for insert to designflow_hts_prod_worker with check (source_environment = 'production');
create policy hts_rag_prod_worker_delete on hts_rag.hts_rag_heading_decisions
  for delete to designflow_hts_prod_worker using (true);
create policy hts_rag_alsand_worker_access on hts_rag.hts_rag_heading_decisions
  for select to designflow_hts_alsand_worker using (true);
create policy hts_rag_alsand_worker_insert on hts_rag.hts_rag_heading_decisions
  for insert to designflow_hts_alsand_worker with check (source_environment = 'alsand');
create policy hts_rag_alsand_worker_delete on hts_rag.hts_rag_heading_decisions
  for delete to designflow_hts_alsand_worker using (true);

-- Search and grouping indexes (search indexes cover active, trusted products only).
create index hts_rag_ruling_links_to_idx
  on hts_rag.hts_rag_ruling_links (to_ruling, kind);
create index hts_rag_ruling_codes_code_role_idx
  on hts_rag.hts_rag_ruling_codes (code, role);
create index hts_rag_hts_renumbering_old_idx
  on hts_rag.hts_rag_hts_renumbering (old_code);
create index hts_rag_ruling_products_ruling_idx
  on hts_rag.hts_rag_ruling_products (ruling_number);
create index hts_rag_ruling_products_article_type_idx
  on hts_rag.hts_rag_ruling_products (article_type_id);
create index hts_rag_ruling_products_material_idx
  on hts_rag.hts_rag_ruling_products (primary_material_id);
create index hts_rag_ruling_products_active_chapter_idx
  on hts_rag.hts_rag_ruling_products (held_chapter, held_heading) where effective_status = 'active' and review_state = 'trusted';
create index hts_rag_ruling_products_phrase_trgm_idx
  on hts_rag.hts_rag_ruling_products using gin (plain_phrase extensions.gin_trgm_ops) where effective_status = 'active' and review_state = 'trusted';
create index hts_rag_ruling_products_fts_idx
  on hts_rag.hts_rag_ruling_products using gin (to_tsvector('english'::regconfig, plain_phrase || ' ' || coalesce(description_text, ''))) where effective_status = 'active' and review_state = 'trusted';
create index hts_rag_ruling_products_phrase_hnsw_idx
  on hts_rag.hts_rag_ruling_products using hnsw (phrase_embedding extensions.halfvec_cosine_ops) where effective_status = 'active' and review_state = 'trusted';
create index hts_rag_product_components_product_idx
  on hts_rag.hts_rag_product_components (product_id);
create index hts_rag_product_attributes_product_idx
  on hts_rag.hts_rag_product_attributes (product_id);
create index hts_rag_product_attributes_key_idx
  on hts_rag.hts_rag_product_attributes (key, is_decisive);
create index hts_rag_heading_decisions_product_idx
  on hts_rag.hts_rag_heading_decisions (product_id);
create index hts_rag_heading_decisions_heading_idx
  on hts_rag.hts_rag_heading_decisions (heading, outcome);
create index hts_rag_article_types_synonyms_idx
  on hts_rag.hts_rag_article_types using gin (synonyms);
create index hts_rag_materials_synonyms_idx
  on hts_rag.hts_rag_materials using gin (synonyms);

-- Computed knowledge: where each article type (and type x material) lands and
-- where CBP rejected it. Refreshed after each harvest batch, never at query time.
create materialized view hts_rag.hts_rag_type_heading_stats as
select p.article_type_id,
       (grouping(p.primary_material_id) = 1) as all_materials,
       p.primary_material_id,
       d.heading,
       left(d.heading, 2) as chapter,
       d.outcome,
       count(distinct p.id) as product_count,
       count(distinct p.ruling_number) as ruling_count,
       max(r.ruling_date) as newest_ruling_date
  from hts_rag.hts_rag_heading_decisions d
  join hts_rag.hts_rag_ruling_products p on p.id = d.product_id
  join hts_rag.hts_rag_rulings r on r.ruling_number = p.ruling_number
 where p.effective_status = 'active'
   and p.review_state = 'trusted'
   and p.article_type_id is not null
 group by grouping sets (
   (p.article_type_id, d.heading, d.outcome),
   (p.article_type_id, p.primary_material_id, d.heading, d.outcome))
with no data;

create unique index hts_rag_type_heading_stats_uq
  on hts_rag.hts_rag_type_heading_stats
  (article_type_id, all_materials, primary_material_id, heading, outcome) nulls not distinct;
create index hts_rag_type_heading_stats_chapter_idx
  on hts_rag.hts_rag_type_heading_stats (article_type_id, chapter);

comment on materialized view hts_rag.hts_rag_type_heading_stats is
  'designflow-backend#254. Per article type (all_materials = true) and per type x material (all_materials = false; material may be unknown): held/rejected counts per heading and chapter. Candidate chapters are computed from it, never hand-typed.';

revoke all on hts_rag.hts_rag_type_heading_stats
  from public, anon, authenticated, service_role,
       designflow_hts_prod_runtime, designflow_hts_alsand_runtime;
grant select on hts_rag.hts_rag_type_heading_stats
  to designflow_hts_prod_worker, designflow_hts_alsand_worker;

create function hts_rag.hts_rag_refresh_type_heading_stats()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from pg_matviews
              where schemaname = 'hts_rag' and matviewname = 'hts_rag_type_heading_stats' and ispopulated) then
    refresh materialized view concurrently hts_rag.hts_rag_type_heading_stats;
  else
    refresh materialized view hts_rag.hts_rag_type_heading_stats;
  end if;
end;
$$;

comment on function hts_rag.hts_rag_refresh_type_heading_stats() is
  'designflow-backend#254. Refreshes hts_rag_type_heading_stats after a harvest or extraction batch.';
revoke all on function hts_rag.hts_rag_refresh_type_heading_stats() from public, anon, authenticated, service_role;
grant execute on function hts_rag.hts_rag_refresh_type_heading_stats()
  to designflow_hts_prod_worker, designflow_hts_alsand_worker;
