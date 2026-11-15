-- #6356 sandbox catch-up batch 6: DesignFlow sandbox (xupnyeifmpsacrqahwwm) ONLY. Never apply to shared preview or production.
-- Ports NBCU, Peanuts and WildBrain lifecycle tables, Sesame property options and their publish functions from production.
-- derived-from: none

set check_function_bodies = off;

create table if not exists plm.nbcu_entity_lifecycle (
  "entity_kind" text not null,
  "entity_key" text not null,
  "identity_basis" text not null,
  "first_seen_capture_id" uuid not null,
  "first_seen_at" timestamp with time zone not null,
  "last_seen_capture_id" uuid not null,
  "last_seen_at" timestamp with time zone not null,
  "last_changed_capture_id" uuid not null,
  "change_signal" text not null,
  "status" text default 'active'::text not null,
  "withdrawn_at" timestamp with time zone,
  "first_withdrawn_at" timestamp with time zone,
  "withdrawn_capture_id" uuid
);
alter table plm.nbcu_entity_lifecycle add constraint "nbcu_entity_lifecycle_basis_chk" CHECK ((identity_basis = ANY (ARRAY['dam_path'::text, 'source_id'::text, 'label_sha256'::text, 'id_fallback'::text, 'folder_path'::text])));
alter table plm.nbcu_entity_lifecycle add constraint "nbcu_entity_lifecycle_history_chk" CHECK ((((withdrawn_at IS NULL) OR (first_withdrawn_at IS NOT NULL)) AND ((first_withdrawn_at IS NULL) OR (withdrawn_at IS NULL) OR (first_withdrawn_at <= withdrawn_at)) AND (first_seen_at <= last_seen_at)));
alter table plm.nbcu_entity_lifecycle add constraint "nbcu_entity_lifecycle_key_chk" CHECK ((btrim(entity_key) <> ''::text));
alter table plm.nbcu_entity_lifecycle add constraint "nbcu_entity_lifecycle_kind_chk" CHECK ((entity_kind = ANY (ARRAY['asset'::text, 'property'::text, 'character'::text, 'style_guide'::text, 'ip_family'::text])));
alter table plm.nbcu_entity_lifecycle add constraint "nbcu_entity_lifecycle_pkey" PRIMARY KEY (entity_kind, entity_key);
alter table plm.nbcu_entity_lifecycle add constraint "nbcu_entity_lifecycle_status_chk" CHECK ((status = ANY (ARRAY['active'::text, 'withdrawn'::text])));
alter table plm.nbcu_entity_lifecycle add constraint "nbcu_entity_lifecycle_withdrawn_at_chk" CHECK ((((status = 'withdrawn'::text) = (withdrawn_at IS NOT NULL)) AND ((status = 'withdrawn'::text) = (withdrawn_capture_id IS NOT NULL))));
CREATE INDEX IF NOT EXISTS nbcu_entity_lifecycle_first_seen_idx ON plm.nbcu_entity_lifecycle USING btree (first_seen_capture_id);
CREATE INDEX IF NOT EXISTS nbcu_entity_lifecycle_kind_last_seen_idx ON plm.nbcu_entity_lifecycle USING btree (last_seen_capture_id, entity_kind, status);
CREATE INDEX IF NOT EXISTS nbcu_entity_lifecycle_last_changed_idx ON plm.nbcu_entity_lifecycle USING btree (last_changed_capture_id);
CREATE INDEX IF NOT EXISTS nbcu_entity_lifecycle_withdrawn_capture_idx ON plm.nbcu_entity_lifecycle USING btree (withdrawn_capture_id) WHERE (withdrawn_capture_id IS NOT NULL);
alter table plm.nbcu_entity_lifecycle enable row level security;
create policy "nbcu_entity_lifecycle_plm_read" on plm.nbcu_entity_lifecycle as permissive for select to authenticated using ((app.has_app_access('plm'::app.app_name) OR app.has_role('administrator'::app.app_role) OR app.has_any_role(ARRAY['sales'::app.app_role, 'licensing'::app.app_role])));
comment on table plm.nbcu_entity_lifecycle is 'Durable NBCU entity state across captures (#3683). The capture snapshot tables stay the evidence; this table records first/last sighting, the opaque change signal and withdrawal. Rows are written only by plm.nbcu_publish_lifecycle. change_signal is opaque: an asset hashes the portal display_modified and display_size; every other kind hashes its retained raw source record.';
create table if not exists plm.nbcu_lifecycle_publication (
  "published_capture_id" uuid not null,
  "baseline_capture_id" uuid,
  "mode" text not null,
  "derivation_contract" text not null,
  "scope_sha256" text not null,
  "source_captured_at" timestamp with time zone not null,
  "counts" jsonb default '{}'::jsonb not null,
  "published_at" timestamp with time zone default now() not null
);
alter table plm.nbcu_lifecycle_publication add constraint "nbcu_lifecycle_publication_baseline_chk" CHECK ((((mode = 'bootstrap'::text) = (baseline_capture_id IS NULL)) AND ((baseline_capture_id IS NULL) OR (baseline_capture_id <> published_capture_id))));
alter table plm.nbcu_lifecycle_publication add constraint "nbcu_lifecycle_publication_contract_chk" CHECK ((btrim(derivation_contract) <> ''::text));
alter table plm.nbcu_lifecycle_publication add constraint "nbcu_lifecycle_publication_counts_chk" CHECK ((jsonb_typeof(counts) = 'object'::text));
alter table plm.nbcu_lifecycle_publication add constraint "nbcu_lifecycle_publication_mode_chk" CHECK ((mode = ANY (ARRAY['bootstrap'::text, 'comparable'::text, 'rebaseline'::text, 'withdrawal_held'::text])));
alter table plm.nbcu_lifecycle_publication add constraint "nbcu_lifecycle_publication_pkey" PRIMARY KEY (published_capture_id);
alter table plm.nbcu_lifecycle_publication add constraint "nbcu_lifecycle_publication_scope_chk" CHECK ((scope_sha256 ~ '^[0-9a-f]{64}$'::text));
CREATE INDEX IF NOT EXISTS nbcu_lifecycle_publication_baseline_idx ON plm.nbcu_lifecycle_publication USING btree (baseline_capture_id) WHERE (baseline_capture_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS nbcu_lifecycle_publication_latest_idx ON plm.nbcu_lifecycle_publication USING btree (source_captured_at DESC, published_at DESC);
alter table plm.nbcu_lifecycle_publication enable row level security;
create policy "nbcu_lifecycle_publication_plm_read" on plm.nbcu_lifecycle_publication as permissive for select to authenticated using ((app.has_app_access('plm'::app.app_name) OR app.has_role('administrator'::app.app_role) OR app.has_any_role(ARRAY['sales'::app.app_role, 'licensing'::app.app_role])));
comment on table plm.nbcu_lifecycle_publication is 'One row per NBCU capture published into durable entity state (#3683). Its key is published_capture_id, deliberately not capture_id: api.source_capture_inventory treats an nbcu_ table with a capture_id column as a latest-complete capture snapshot, and this mutable ledger must be reported as retained rows only. mode records whether withdrawals were compared (comparable), skipped because the licensed scope set or derivation contract differed (rebaseline), or held by the bulk-drop guard.';
create table if not exists plm.peanuts_entity_lifecycle (
  "entity_kind" text not null,
  "entity_key" text not null,
  "first_seen_capture_id" uuid not null,
  "first_seen_at" timestamp with time zone not null,
  "last_seen_capture_id" uuid not null,
  "last_seen_at" timestamp with time zone not null,
  "last_changed_capture_id" uuid not null,
  "change_signal" text not null,
  "status" text default 'active'::text not null,
  "withdrawn_at" timestamp with time zone,
  "first_withdrawn_at" timestamp with time zone,
  "withdrawn_capture_id" uuid,
  "retired_at" timestamp with time zone
);
alter table plm.peanuts_entity_lifecycle add constraint "peanuts_entity_lifecycle_history_chk" CHECK ((((withdrawn_at IS NULL) OR (first_withdrawn_at IS NOT NULL)) AND ((first_withdrawn_at IS NULL) OR (withdrawn_at IS NULL) OR (first_withdrawn_at <= withdrawn_at)) AND (first_seen_at <= last_seen_at)));
alter table plm.peanuts_entity_lifecycle add constraint "peanuts_entity_lifecycle_key_chk" CHECK ((btrim(entity_key) <> ''::text));
alter table plm.peanuts_entity_lifecycle add constraint "peanuts_entity_lifecycle_kind_chk" CHECK ((entity_kind = ANY (ARRAY['asset'::text, 'art_program'::text, 'character'::text, 'style_guide'::text, 'initiative'::text])));
alter table plm.peanuts_entity_lifecycle add constraint "peanuts_entity_lifecycle_pkey" PRIMARY KEY (entity_kind, entity_key);
alter table plm.peanuts_entity_lifecycle add constraint "peanuts_entity_lifecycle_status_chk" CHECK (((status = ANY (ARRAY['active'::text, 'withdrawn'::text, 'retired'::text])) AND ((status <> 'withdrawn'::text) OR (entity_kind <> 'initiative'::text)) AND ((status <> 'retired'::text) OR (entity_kind = 'initiative'::text))));
alter table plm.peanuts_entity_lifecycle add constraint "peanuts_entity_lifecycle_withdrawn_at_chk" CHECK ((((status = 'withdrawn'::text) = (withdrawn_at IS NOT NULL)) AND ((status = 'withdrawn'::text) = (withdrawn_capture_id IS NOT NULL)) AND ((status = 'retired'::text) = (retired_at IS NOT NULL))));
CREATE INDEX IF NOT EXISTS idx_peanuts_entity_lifecycle_first_seen ON plm.peanuts_entity_lifecycle USING btree (first_seen_capture_id);
CREATE INDEX IF NOT EXISTS idx_peanuts_entity_lifecycle_last_changed ON plm.peanuts_entity_lifecycle USING btree (last_changed_capture_id);
CREATE INDEX IF NOT EXISTS idx_peanuts_entity_lifecycle_last_seen ON plm.peanuts_entity_lifecycle USING btree (entity_kind, status, last_seen_capture_id);
CREATE INDEX IF NOT EXISTS idx_peanuts_entity_lifecycle_withdrawn_capture ON plm.peanuts_entity_lifecycle USING btree (withdrawn_capture_id) WHERE (withdrawn_capture_id IS NOT NULL);
alter table plm.peanuts_entity_lifecycle enable row level security;
create policy "peanuts_entity_lifecycle_plm_read" on plm.peanuts_entity_lifecycle as permissive for select to authenticated using ((app.has_app_access('plm'::app.app_name) OR app.has_role('administrator'::app.app_role) OR app.has_any_role(ARRAY['sales'::app.app_role, 'licensing'::app.app_role])));
comment on table plm.peanuts_entity_lifecycle is 'Durable Peanuts entity state across captures (#3684). The capture snapshot tables stay the evidence; this table records first/last sighting, the opaque change signal, withdrawal, and initiative retirement (owner ruling 6.20: an initiative that stops appearing is retired, not withdrawn). Rows are written only by plm.peanuts_publish_lifecycle. change_signal is opaque: an asset hashes the portal update time, checksum, size and version; a vocabulary value hashes its label and raw record.';
create table if not exists plm.peanuts_lifecycle_publication (
  "published_capture_id" uuid not null,
  "baseline_capture_id" uuid,
  "mode" text not null,
  "derivation_contract" text not null,
  "scope_sha256" text not null,
  "source_captured_at" timestamp with time zone not null,
  "counts" jsonb default '{}'::jsonb not null,
  "published_at" timestamp with time zone default now() not null
);
alter table plm.peanuts_lifecycle_publication add constraint "peanuts_lifecycle_publication_baseline_chk" CHECK ((((mode = 'bootstrap'::text) = (baseline_capture_id IS NULL)) AND ((baseline_capture_id IS NULL) OR (baseline_capture_id <> published_capture_id))));
alter table plm.peanuts_lifecycle_publication add constraint "peanuts_lifecycle_publication_contract_chk" CHECK ((btrim(derivation_contract) <> ''::text));
alter table plm.peanuts_lifecycle_publication add constraint "peanuts_lifecycle_publication_counts_chk" CHECK ((jsonb_typeof(counts) = 'object'::text));
alter table plm.peanuts_lifecycle_publication add constraint "peanuts_lifecycle_publication_mode_chk" CHECK ((mode = ANY (ARRAY['bootstrap'::text, 'comparable'::text, 'rebaseline'::text, 'withdrawal_held'::text])));
alter table plm.peanuts_lifecycle_publication add constraint "peanuts_lifecycle_publication_pkey" PRIMARY KEY (published_capture_id);
alter table plm.peanuts_lifecycle_publication add constraint "peanuts_lifecycle_publication_scope_chk" CHECK ((scope_sha256 ~ '^[0-9a-f]{64}$'::text));
CREATE INDEX IF NOT EXISTS idx_peanuts_lifecycle_publication_baseline ON plm.peanuts_lifecycle_publication USING btree (baseline_capture_id) WHERE (baseline_capture_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_peanuts_lifecycle_publication_latest ON plm.peanuts_lifecycle_publication USING btree (source_captured_at DESC, published_at DESC, published_capture_id DESC);
alter table plm.peanuts_lifecycle_publication enable row level security;
create policy "peanuts_lifecycle_publication_plm_read" on plm.peanuts_lifecycle_publication as permissive for select to authenticated using ((app.has_app_access('plm'::app.app_name) OR app.has_role('administrator'::app.app_role) OR app.has_any_role(ARRAY['sales'::app.app_role, 'licensing'::app.app_role])));
comment on table plm.peanuts_lifecycle_publication is 'One row per Peanuts capture published into durable entity state (#3684). mode records whether withdrawals were compared (comparable), skipped because the account/endpoint or key contract differed (rebaseline), or held by the bulk-drop guard. The key is published_capture_id, deliberately not capture_id: api.source_capture_inventory treats a peanuts_ table with a capture_id column as a latest-complete capture snapshot, and this mutable ledger must be reported as retained rows only.';
create table if not exists plm.peanuts_submission_property_option (
  "option_key" text not null,
  "exact_label" text not null,
  "ordinal" integer not null,
  "source_field" text not null,
  "source_captured_at" timestamp with time zone not null,
  "raw" jsonb default '{}'::jsonb not null,
  "loaded_at" timestamp with time zone default now() not null
);
alter table plm.peanuts_submission_property_option add constraint "peanuts_submission_property_option_field_nonblank_chk" CHECK ((btrim(source_field) <> ''::text));
alter table plm.peanuts_submission_property_option add constraint "peanuts_submission_property_option_label_nonblank_chk" CHECK ((btrim(exact_label) <> ''::text));
alter table plm.peanuts_submission_property_option add constraint "peanuts_submission_property_option_ordinal_chk" CHECK ((ordinal >= 0));
alter table plm.peanuts_submission_property_option add constraint "peanuts_submission_property_option_owner_scope_chk" CHECK ((option_key = ANY (ARRAY['owner-manual:peanuts-classic'::text, 'owner-manual:charlie-brown-tv-special'::text])));
alter table plm.peanuts_submission_property_option add constraint "peanuts_submission_property_option_pkey" PRIMARY KEY (option_key);
alter table plm.peanuts_submission_property_option add constraint "peanuts_submission_property_option_raw_obj_chk" CHECK ((jsonb_typeof(raw) = 'object'::text));
alter table plm.peanuts_submission_property_option enable row level security;
create policy "peanuts_submission_property_option_plm_read" on plm.peanuts_submission_property_option as permissive for select to authenticated using ((app.has_app_access('plm'::app.app_name) OR app.has_role('administrator'::app.app_role) OR app.has_any_role(ARRAY['sales'::app.app_role, 'licensing'::app.app_role])));
create policy "peanuts_submission_property_option_service_read" on plm.peanuts_submission_property_option as permissive for select to service_role using (true);
comment on table plm.peanuts_submission_property_option is 'PEANUTS SUBMISSIONS PROPERTY OPTIONS, NOT CANONICAL MASTER DATA. The POP Peanuts Submissions Properties entered manually by the owner on 2026-10-02 (#3897; u2giants/licensor-source-data#100). Not scraped: option_key is an owner-manual key, never a portal source id. Resolves nothing to core.*.';
create table if not exists plm.wildbrain_entity_lifecycle (
  "entity_kind" text not null,
  "entity_key" text not null,
  "first_seen_capture_id" uuid not null,
  "first_seen_at" timestamp with time zone not null,
  "last_seen_capture_id" uuid not null,
  "last_seen_at" timestamp with time zone not null,
  "last_changed_capture_id" uuid not null,
  "change_signal" text not null,
  "status" text default 'active'::text not null,
  "withdrawn_at" timestamp with time zone,
  "first_withdrawn_at" timestamp with time zone,
  "withdrawn_capture_id" uuid
);
alter table plm.wildbrain_entity_lifecycle add constraint "wildbrain_entity_lifecycle_history_chk" CHECK ((((withdrawn_at IS NULL) OR (first_withdrawn_at IS NOT NULL)) AND ((first_withdrawn_at IS NULL) OR (withdrawn_at IS NULL) OR (first_withdrawn_at <= withdrawn_at)) AND (first_seen_at <= last_seen_at)));
alter table plm.wildbrain_entity_lifecycle add constraint "wildbrain_entity_lifecycle_key_chk" CHECK ((btrim(entity_key) <> ''::text));
alter table plm.wildbrain_entity_lifecycle add constraint "wildbrain_entity_lifecycle_kind_chk" CHECK ((entity_kind = ANY (ARRAY['asset'::text, 'era'::text, 'creative_group'::text, 'character'::text, 'guide'::text])));
alter table plm.wildbrain_entity_lifecycle add constraint "wildbrain_entity_lifecycle_pkey" PRIMARY KEY (entity_kind, entity_key);
alter table plm.wildbrain_entity_lifecycle add constraint "wildbrain_entity_lifecycle_status_chk" CHECK ((status = ANY (ARRAY['active'::text, 'withdrawn'::text])));
alter table plm.wildbrain_entity_lifecycle add constraint "wildbrain_entity_lifecycle_withdrawn_at_chk" CHECK ((((status = 'withdrawn'::text) = (withdrawn_at IS NOT NULL)) AND ((status = 'withdrawn'::text) = (withdrawn_capture_id IS NOT NULL))));
CREATE INDEX IF NOT EXISTS wildbrain_entity_lifecycle_first_seen_idx ON plm.wildbrain_entity_lifecycle USING btree (first_seen_capture_id);
CREATE INDEX IF NOT EXISTS wildbrain_entity_lifecycle_last_changed_idx ON plm.wildbrain_entity_lifecycle USING btree (last_changed_capture_id);
CREATE INDEX IF NOT EXISTS wildbrain_entity_lifecycle_last_seen_idx ON plm.wildbrain_entity_lifecycle USING btree (last_seen_capture_id, entity_kind);
CREATE INDEX IF NOT EXISTS wildbrain_entity_lifecycle_withdrawn_idx ON plm.wildbrain_entity_lifecycle USING btree (withdrawn_capture_id) WHERE (withdrawn_capture_id IS NOT NULL);
alter table plm.wildbrain_entity_lifecycle enable row level security;
create policy "wildbrain_entity_lifecycle_plm_read" on plm.wildbrain_entity_lifecycle as permissive for select to authenticated using ((app.has_app_access('plm'::app.app_name) OR app.has_role('administrator'::app.app_role) OR app.has_any_role(ARRAY['sales'::app.app_role, 'licensing'::app.app_role])));
comment on table plm.wildbrain_entity_lifecycle is 'Durable WildBrain entity state across captures (#3685). The capture snapshot tables stay the evidence; this table records first/last sighting, the opaque change signal and withdrawal. Rows are written only by plm.wildbrain_publish_lifecycle. change_signal is opaque: an asset uses its retained source hash; every other kind hashes its label (and, for an inferred guide, its derivation fields) with its raw record.';
create table if not exists plm.wildbrain_lifecycle_publication (
  "capture_id" uuid not null,
  "baseline_capture_id" uuid,
  "mode" text not null,
  "derivation_contract" text not null,
  "guide_rule_versions" text not null,
  "scope_sha256" text not null,
  "source_captured_at" timestamp with time zone not null,
  "counts" jsonb default '{}'::jsonb not null,
  "published_at" timestamp with time zone default now() not null
);
alter table plm.wildbrain_lifecycle_publication add constraint "wildbrain_lifecycle_publication_baseline_chk" CHECK ((((mode = 'bootstrap'::text) = (baseline_capture_id IS NULL)) AND ((baseline_capture_id IS NULL) OR (baseline_capture_id <> capture_id))));
alter table plm.wildbrain_lifecycle_publication add constraint "wildbrain_lifecycle_publication_contract_chk" CHECK ((btrim(derivation_contract) <> ''::text));
alter table plm.wildbrain_lifecycle_publication add constraint "wildbrain_lifecycle_publication_counts_chk" CHECK ((jsonb_typeof(counts) = 'object'::text));
alter table plm.wildbrain_lifecycle_publication add constraint "wildbrain_lifecycle_publication_mode_chk" CHECK ((mode = ANY (ARRAY['bootstrap'::text, 'comparable'::text, 'rebaseline'::text, 'withdrawal_held'::text])));
alter table plm.wildbrain_lifecycle_publication add constraint "wildbrain_lifecycle_publication_pkey" PRIMARY KEY (capture_id);
alter table plm.wildbrain_lifecycle_publication add constraint "wildbrain_lifecycle_publication_scope_chk" CHECK ((scope_sha256 ~ '^[0-9a-f]{64}$'::text));
CREATE INDEX IF NOT EXISTS wildbrain_lifecycle_publication_baseline_idx ON plm.wildbrain_lifecycle_publication USING btree (baseline_capture_id) WHERE (baseline_capture_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS wildbrain_lifecycle_publication_latest_idx ON plm.wildbrain_lifecycle_publication USING btree (source_captured_at DESC, published_at DESC);
alter table plm.wildbrain_lifecycle_publication enable row level security;
create policy "wildbrain_lifecycle_publication_plm_read" on plm.wildbrain_lifecycle_publication as permissive for select to authenticated using ((app.has_app_access('plm'::app.app_name) OR app.has_role('administrator'::app.app_role) OR app.has_any_role(ARRAY['sales'::app.app_role, 'licensing'::app.app_role])));
comment on table plm.wildbrain_lifecycle_publication is 'One row per WildBrain capture published into durable entity state (#3685). mode records whether withdrawals were compared (comparable), skipped because the portal or key contract differed (rebaseline), or held by the bulk-drop guard. guide_rule_versions is the inferred-guide rule-version set; guides compare only when it matches the baseline.';
create table if not exists plm.wildbrain_submission_property_option (
  "option_key" text not null,
  "exact_label" text not null,
  "ordinal" integer not null,
  "source_field" text not null,
  "source_captured_at" timestamp with time zone not null,
  "raw" jsonb default '{}'::jsonb not null,
  "loaded_at" timestamp with time zone default now() not null
);
alter table plm.wildbrain_submission_property_option add constraint "wildbrain_submission_property_option_field_nonblank_chk" CHECK ((btrim(source_field) <> ''::text));
alter table plm.wildbrain_submission_property_option add constraint "wildbrain_submission_property_option_label_nonblank_chk" CHECK ((btrim(exact_label) <> ''::text));
alter table plm.wildbrain_submission_property_option add constraint "wildbrain_submission_property_option_ordinal_chk" CHECK ((ordinal >= 0));
alter table plm.wildbrain_submission_property_option add constraint "wildbrain_submission_property_option_owner_scope_chk" CHECK ((option_key = 'e608bfe3-a3e2-439a-899d-dc88a59e9b58'::text));
alter table plm.wildbrain_submission_property_option add constraint "wildbrain_submission_property_option_pkey" PRIMARY KEY (option_key);
alter table plm.wildbrain_submission_property_option add constraint "wildbrain_submission_property_option_raw_obj_chk" CHECK ((jsonb_typeof(raw) = 'object'::text));
alter table plm.wildbrain_submission_property_option enable row level security;
create policy "wildbrain_submission_property_option_plm_read" on plm.wildbrain_submission_property_option as permissive for select to authenticated using ((app.has_app_access('plm'::app.app_name) OR app.has_role('administrator'::app.app_role) OR app.has_any_role(ARRAY['sales'::app.app_role, 'licensing'::app.app_role])));
create policy "wildbrain_submission_property_option_service_read" on plm.wildbrain_submission_property_option as permissive for select to service_role using (true);
comment on table plm.wildbrain_submission_property_option is 'LICENSED WILDBRAIN SOURCE EVIDENCE, NOT CANONICAL MASTER DATA. The Property choices offered by WildBrain CPLG MediaBox Product Approvals (Submissions), restricted by owner ruling (2026-09-25, #3545) to the one POP-authorized option, Strawberry Shortcake Classic. Resolves nothing to core.*.';
create table if not exists plm.sesame_submission_property_option (
  "option_key" text not null,
  "exact_label" text not null,
  "ordinal" integer not null,
  "source_field" text not null,
  "source_captured_at" timestamp with time zone not null,
  "raw" jsonb default '{}'::jsonb not null,
  "loaded_at" timestamp with time zone default now() not null
);
alter table plm.sesame_submission_property_option add constraint "sesame_submission_property_option_field_nonblank_chk" CHECK ((btrim(source_field) <> ''::text));
alter table plm.sesame_submission_property_option add constraint "sesame_submission_property_option_key_nonblank_chk" CHECK ((btrim(option_key) <> ''::text));
alter table plm.sesame_submission_property_option add constraint "sesame_submission_property_option_label_nonblank_chk" CHECK ((btrim(exact_label) <> ''::text));
alter table plm.sesame_submission_property_option add constraint "sesame_submission_property_option_ordinal_chk" CHECK ((ordinal >= 0));
alter table plm.sesame_submission_property_option add constraint "sesame_submission_property_option_pkey" PRIMARY KEY (option_key);
alter table plm.sesame_submission_property_option add constraint "sesame_submission_property_option_raw_obj_chk" CHECK ((jsonb_typeof(raw) = 'object'::text));
alter table plm.sesame_submission_property_option enable row level security;
comment on table plm.sesame_submission_property_option is 'LICENSED SESAME WORKSHOP SOURCE EVIDENCE, NOT CANONICAL MASTER DATA. The Property choices offered by the Sesame Workshop Submissions (MediaBox) portal, verbatim. Resolves nothing to core.*.';
alter table plm.nbcu_entity_lifecycle add constraint "nbcu_entity_lifecycle_first_seen_capture_id_fkey" FOREIGN KEY (first_seen_capture_id) REFERENCES plm.nbcu_lifecycle_publication(published_capture_id) ON DELETE RESTRICT;
alter table plm.nbcu_entity_lifecycle add constraint "nbcu_entity_lifecycle_last_changed_capture_id_fkey" FOREIGN KEY (last_changed_capture_id) REFERENCES plm.nbcu_lifecycle_publication(published_capture_id) ON DELETE RESTRICT;
alter table plm.nbcu_entity_lifecycle add constraint "nbcu_entity_lifecycle_last_seen_capture_id_fkey" FOREIGN KEY (last_seen_capture_id) REFERENCES plm.nbcu_lifecycle_publication(published_capture_id) ON DELETE RESTRICT;
alter table plm.nbcu_entity_lifecycle add constraint "nbcu_entity_lifecycle_withdrawn_capture_id_fkey" FOREIGN KEY (withdrawn_capture_id) REFERENCES plm.nbcu_lifecycle_publication(published_capture_id) ON DELETE RESTRICT;
alter table plm.nbcu_lifecycle_publication add constraint "nbcu_lifecycle_publication_baseline_capture_id_fkey" FOREIGN KEY (baseline_capture_id) REFERENCES plm.nbcu_lifecycle_publication(published_capture_id) ON DELETE RESTRICT;
alter table plm.nbcu_lifecycle_publication add constraint "nbcu_lifecycle_publication_published_capture_id_fkey" FOREIGN KEY (published_capture_id) REFERENCES plm.nbcu_capture(id) ON DELETE RESTRICT;
alter table plm.peanuts_entity_lifecycle add constraint "peanuts_entity_lifecycle_first_seen_capture_id_fkey" FOREIGN KEY (first_seen_capture_id) REFERENCES plm.peanuts_lifecycle_publication(published_capture_id) ON DELETE RESTRICT;
alter table plm.peanuts_entity_lifecycle add constraint "peanuts_entity_lifecycle_last_changed_capture_id_fkey" FOREIGN KEY (last_changed_capture_id) REFERENCES plm.peanuts_lifecycle_publication(published_capture_id) ON DELETE RESTRICT;
alter table plm.peanuts_entity_lifecycle add constraint "peanuts_entity_lifecycle_last_seen_capture_id_fkey" FOREIGN KEY (last_seen_capture_id) REFERENCES plm.peanuts_lifecycle_publication(published_capture_id) ON DELETE RESTRICT;
alter table plm.peanuts_entity_lifecycle add constraint "peanuts_entity_lifecycle_withdrawn_capture_id_fkey" FOREIGN KEY (withdrawn_capture_id) REFERENCES plm.peanuts_lifecycle_publication(published_capture_id) ON DELETE RESTRICT;
alter table plm.peanuts_lifecycle_publication add constraint "peanuts_lifecycle_publication_baseline_capture_id_fkey" FOREIGN KEY (baseline_capture_id) REFERENCES plm.peanuts_lifecycle_publication(published_capture_id) ON DELETE RESTRICT;
alter table plm.peanuts_lifecycle_publication add constraint "peanuts_lifecycle_publication_published_capture_id_fkey" FOREIGN KEY (published_capture_id) REFERENCES plm.peanuts_capture(id) ON DELETE RESTRICT;
alter table plm.wildbrain_entity_lifecycle add constraint "wildbrain_entity_lifecycle_first_seen_capture_id_fkey" FOREIGN KEY (first_seen_capture_id) REFERENCES plm.wildbrain_lifecycle_publication(capture_id) ON DELETE RESTRICT;
alter table plm.wildbrain_entity_lifecycle add constraint "wildbrain_entity_lifecycle_last_changed_capture_id_fkey" FOREIGN KEY (last_changed_capture_id) REFERENCES plm.wildbrain_lifecycle_publication(capture_id) ON DELETE RESTRICT;
alter table plm.wildbrain_entity_lifecycle add constraint "wildbrain_entity_lifecycle_last_seen_capture_id_fkey" FOREIGN KEY (last_seen_capture_id) REFERENCES plm.wildbrain_lifecycle_publication(capture_id) ON DELETE RESTRICT;
alter table plm.wildbrain_entity_lifecycle add constraint "wildbrain_entity_lifecycle_withdrawn_capture_id_fkey" FOREIGN KEY (withdrawn_capture_id) REFERENCES plm.wildbrain_lifecycle_publication(capture_id) ON DELETE RESTRICT;
alter table plm.wildbrain_lifecycle_publication add constraint "wildbrain_lifecycle_publication_baseline_capture_id_fkey" FOREIGN KEY (baseline_capture_id) REFERENCES plm.wildbrain_lifecycle_publication(capture_id) ON DELETE RESTRICT;
alter table plm.wildbrain_lifecycle_publication add constraint "wildbrain_lifecycle_publication_capture_id_fkey" FOREIGN KEY (capture_id) REFERENCES plm.wildbrain_capture(id) ON DELETE RESTRICT;

CREATE OR REPLACE FUNCTION plm.nbcu_publish_lifecycle(p_capture_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
declare
  c_contract constant text := 'nbcu-entity-keys-v1';
  v_cap        plm.nbcu_capture%rowtype;
  v_prev       plm.nbcu_lifecycle_publication%rowtype;
  v_scope      text;
  v_mode       text;
  v_now        timestamptz := now();
  v_counts     jsonb := '{}'::jsonb;
  v_kind       text;
  v_seen       bigint;
  v_added      bigint;
  v_changed    bigint;
  v_back       bigint;
  v_base       bigint;
  v_drop       bigint;
  v_limit      bigint;
  v_held       boolean := false;
  v_eligible   uuid[] := '{}';
begin
  -- Concurrent publication locking: every publication for this licensor is serial.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('plm.nbcu_publish_lifecycle', 0));

  select * into v_cap from plm.nbcu_capture where id = p_capture_id for share;
  if not found then
    raise exception 'nbcu_publish_lifecycle: no capture %', p_capture_id using errcode = 'P0002';
  end if;
  -- NULL-safe by construction: every arm is IS DISTINCT FROM / IS NULL, so a NULL can
  -- never make the refusal condition NULL and let a capture through.
  if v_cap.status is distinct from 'complete' or v_cap.load_completed_at is null
     or v_cap.error_summary is distinct from '[]'::jsonb or v_cap.media_downloaded is distinct from 0 then
    raise exception 'nbcu_publish_lifecycle: capture % is not a complete zero-failure capture', p_capture_id
      using errcode = '22023';
  end if;
  if exists (select 1 from plm.nbcu_scope s where s.capture_id = p_capture_id
             and (s.terminal is not true or pg_catalog.cardinality(s.missing_offsets) is distinct from 0))
     or not exists (select 1 from plm.nbcu_scope s where s.capture_id = p_capture_id) then
    raise exception 'nbcu_publish_lifecycle: capture % has no complete licensed scope coverage', p_capture_id
      using errcode = '22023';
  end if;
  if exists (select 1 from plm.nbcu_lifecycle_publication where published_capture_id = p_capture_id) then
    raise exception 'nbcu_publish_lifecycle: capture % is already published', p_capture_id
      using errcode = '23505';
  end if;

  select * into v_prev from plm.nbcu_lifecycle_publication
   order by source_captured_at desc, published_at desc limit 1;
  if found and v_prev.source_captured_at >= v_cap.source_captured_at then
    raise exception 'nbcu_publish_lifecycle: capture % is not newer than published capture %',
      p_capture_id, v_prev.published_capture_id using errcode = '22023';
  end if;

  select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
           pg_catalog.string_agg(s.scope_key, E'\n' order by s.scope_key), 'UTF8')), 'hex')
    into v_scope from plm.nbcu_scope s where s.capture_id = p_capture_id;

  if v_prev.published_capture_id is null then
    v_mode := 'bootstrap';
  elsif v_prev.scope_sha256 = v_scope and v_prev.derivation_contract = c_contract then
    v_mode := 'comparable';
  else
    v_mode := 'rebaseline';
  end if;

  -- Withdrawal-eligible sightings: the baseline itself, plus -- across a run of held
  -- publications -- each held publication's own baseline. A held drop is therefore
  -- re-evaluated by the next comparable run instead of being orphaned.
  if v_prev.published_capture_id is not null then
    with recursive chain as (
      select p.published_capture_id, p.baseline_capture_id, p.mode
        from plm.nbcu_lifecycle_publication p where p.published_capture_id = v_prev.published_capture_id
      union all
      select p.published_capture_id, p.baseline_capture_id, p.mode
        from chain c join plm.nbcu_lifecycle_publication p on p.published_capture_id = c.baseline_capture_id
       where c.mode = 'withdrawal_held'
    )
    select pg_catalog.array_agg(chain.published_capture_id) into v_eligible from chain;
  end if;

  insert into plm.nbcu_lifecycle_publication
    (published_capture_id, baseline_capture_id, mode, derivation_contract, scope_sha256, source_captured_at)
  values (p_capture_id, v_prev.published_capture_id, v_mode, c_contract, v_scope, v_cap.source_captured_at);

  drop table if exists pg_temp.nbcu_lifecycle_seen;
  create temporary table pg_temp.nbcu_lifecycle_seen (
    entity_kind text not null, entity_key text not null, identity_basis text not null,
    change_signal text not null, primary key (entity_kind, entity_key)
  ) on commit drop;

  -- One DAM object reached through two viewer URLs in one capture is one identity; the
  -- lexically first path supplies the signal so the choice is deterministic.
  insert into pg_temp.nbcu_lifecycle_seen
  select distinct on (k.dam_path) 'asset', k.dam_path, 'dam_path',
         pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.jsonb_build_array(k.display_modified, k.display_size)::text, 'UTF8')), 'hex')
    from (select pg_catalog.regexp_replace(a.asset_path, '^/content/asset-share-commons/en/details/[^/]+[.]html(?=/content/dam/)', '') as dam_path,
                 a.asset_path, a.display_modified, a.display_size
            from plm.nbcu_asset a where a.capture_id = p_capture_id) k
   order by k.dam_path, k.asset_path;
  insert into pg_temp.nbcu_lifecycle_seen
  select 'property', p.property_key,
         case when p.property_source_id is not null then 'source_id' else 'label_sha256' end,
         pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.raw::text, 'UTF8')), 'hex')
    from plm.nbcu_property p where p.capture_id = p_capture_id;
  insert into pg_temp.nbcu_lifecycle_seen
  select 'character', c.character_key,
         case when c.character_source_id is not null then 'source_id' else 'id_fallback' end,
         pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(c.raw::text, 'UTF8')), 'hex')
    from plm.nbcu_character c where c.capture_id = p_capture_id;
  insert into pg_temp.nbcu_lifecycle_seen
  select 'style_guide', g.style_guide_key,
         case when g.style_guide_source_id is not null then 'source_id' else 'folder_path' end,
         pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(g.raw::text, 'UTF8')), 'hex')
    from plm.nbcu_style_guide g where g.capture_id = p_capture_id;
  insert into pg_temp.nbcu_lifecycle_seen
  select 'ip_family', f.ip_family_key, 'label_sha256',
         pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(f.raw::text, 'UTF8')), 'hex')
    from plm.nbcu_ip_family f where f.capture_id = p_capture_id;

  -- Bulk-drop guard, evaluated before any write. Denominator: entities of the kind whose
  -- last sighting is withdrawal-eligible (see above). A persistent mass drop keeps being
  -- held and recorded; applying it needs a separately reviewed change. Held when drops exceed the smaller of 100 rows or 2%
  -- of that denominator (never below one row).
  if v_mode = 'comparable' then
    foreach v_kind in array array['asset','property','character','style_guide','ip_family'] loop
      select pg_catalog.count(*) into v_base from plm.nbcu_entity_lifecycle l
       where l.entity_kind = v_kind and l.last_seen_capture_id = any(v_eligible);
      select pg_catalog.count(*) into v_drop from plm.nbcu_entity_lifecycle l
       where l.entity_kind = v_kind and l.status = 'active' and l.last_seen_capture_id = any(v_eligible)
         and not exists (select 1 from pg_temp.nbcu_lifecycle_seen s where s.entity_kind = l.entity_kind and s.entity_key = l.entity_key);
      v_limit := greatest(1, least(100, pg_catalog.floor(v_base * 0.02)::bigint));
      if v_drop > v_limit then
        v_held := true;
      end if;
    end loop;
    if v_held then
      v_mode := 'withdrawal_held';
      update plm.nbcu_lifecycle_publication set mode = v_mode where published_capture_id = p_capture_id;
    end if;
  end if;

  foreach v_kind in array array['asset','property','character','style_guide','ip_family'] loop
    select pg_catalog.count(*) into v_seen from pg_temp.nbcu_lifecycle_seen s where s.entity_kind = v_kind;
    select pg_catalog.count(*) into v_added from pg_temp.nbcu_lifecycle_seen s where s.entity_kind = v_kind
       and not exists (select 1 from plm.nbcu_entity_lifecycle l where l.entity_kind = s.entity_kind and l.entity_key = s.entity_key);
    select pg_catalog.count(*) into v_changed from pg_temp.nbcu_lifecycle_seen s join plm.nbcu_entity_lifecycle l
        on l.entity_kind = s.entity_kind and l.entity_key = s.entity_key
     where s.entity_kind = v_kind and l.change_signal <> s.change_signal;
    select pg_catalog.count(*) into v_back from pg_temp.nbcu_lifecycle_seen s join plm.nbcu_entity_lifecycle l
        on l.entity_kind = s.entity_kind and l.entity_key = s.entity_key
     where s.entity_kind = v_kind and l.status = 'withdrawn';
    v_drop := 0;
    if v_mode in ('comparable', 'withdrawal_held') then
      select pg_catalog.count(*) into v_drop from plm.nbcu_entity_lifecycle l
       where l.entity_kind = v_kind and l.status = 'active' and l.last_seen_capture_id = any(v_eligible)
         and not exists (select 1 from pg_temp.nbcu_lifecycle_seen s where s.entity_kind = l.entity_kind and s.entity_key = l.entity_key);
    end if;
    v_counts := v_counts || pg_catalog.jsonb_build_object(v_kind, pg_catalog.jsonb_build_object(
      'seen', v_seen, 'added', v_added, 'changed', v_changed, 'reactivated', v_back,
      'withdrawn', case when v_mode = 'comparable' then v_drop else 0 end,
      'withdrawal_held', case when v_mode = 'withdrawal_held' then v_drop else 0 end));
  end loop;

  if v_mode = 'comparable' then
    update plm.nbcu_entity_lifecycle l
       set status = 'withdrawn', withdrawn_at = v_cap.source_captured_at,
           first_withdrawn_at = coalesce(l.first_withdrawn_at, v_cap.source_captured_at),
           withdrawn_capture_id = p_capture_id
     where l.status = 'active' and l.last_seen_capture_id = any(v_eligible)
       and not exists (select 1 from pg_temp.nbcu_lifecycle_seen s where s.entity_kind = l.entity_kind and s.entity_key = l.entity_key);
  end if;

  insert into plm.nbcu_entity_lifecycle as l
    (entity_kind, entity_key, identity_basis, first_seen_capture_id, first_seen_at,
     last_seen_capture_id, last_seen_at, last_changed_capture_id, change_signal)
  select s.entity_kind, s.entity_key, s.identity_basis, p_capture_id, v_cap.source_captured_at,
         p_capture_id, v_cap.source_captured_at, p_capture_id, s.change_signal
    from pg_temp.nbcu_lifecycle_seen s
  on conflict (entity_kind, entity_key) do update
     set identity_basis = excluded.identity_basis,
         last_seen_capture_id = excluded.last_seen_capture_id,
         last_seen_at = excluded.last_seen_at,
         last_changed_capture_id = case when l.change_signal <> excluded.change_signal
                                        then excluded.last_changed_capture_id else l.last_changed_capture_id end,
         change_signal = excluded.change_signal,
         status = 'active', withdrawn_at = null, withdrawn_capture_id = null;

  update plm.nbcu_lifecycle_publication
     set counts = v_counts, published_at = v_now
   where published_capture_id = p_capture_id;

  return pg_catalog.jsonb_build_object('capture_id', p_capture_id, 'mode', v_mode,
    'baseline_capture_id', v_prev.published_capture_id, 'counts', v_counts);
end
$function$
;
revoke all on function plm.nbcu_publish_lifecycle(p_capture_id uuid) from public, anon, authenticated;
grant execute on function plm.nbcu_publish_lifecycle(p_capture_id uuid) to service_role;
CREATE OR REPLACE FUNCTION plm.peanuts_publish_lifecycle(p_capture_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
declare
  c_contract constant text := 'peanuts-entity-keys-v1';
  v_cap        plm.peanuts_capture%rowtype;
  v_prev       plm.peanuts_lifecycle_publication%rowtype;
  v_scope      text;
  v_mode       text;
  v_counts     jsonb := '{}'::jsonb;
  v_kind       text;
  v_seen       bigint;
  v_added      bigint;
  v_changed    bigint;
  v_back       bigint;
  v_base       bigint;
  v_drop       bigint;
  v_limit      bigint;
  v_held       boolean := false;
  v_eligible   uuid[] := '{}';
begin
  -- Concurrent publication locking: every publication for this licensor is serial.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('plm.peanuts_publish_lifecycle', 0));

  select * into v_cap from plm.peanuts_capture where id = p_capture_id for share;
  if not found then
    raise exception 'peanuts_publish_lifecycle: no capture %', p_capture_id using errcode = 'P0002';
  end if;
  if v_cap.status <> 'complete' or v_cap.load_completed_at is null
     or v_cap.error_summary <> '[]'::jsonb or v_cap.media_downloaded <> 0
     or v_cap.deep_paging_partitioned is not true or v_cap.vocabularies_loaded_from_source is not true
     or v_cap.assets_unreachable <> 0
     or v_cap.assets_captured <> v_cap.portal_reported_asset_total then
    raise exception 'peanuts_publish_lifecycle: capture % is not a complete zero-failure capture', p_capture_id
      using errcode = '22023';
  end if;
  if (select pg_catalog.count(*) from plm.peanuts_asset a where a.capture_id = p_capture_id)
     <> v_cap.assets_captured then
    raise exception 'peanuts_publish_lifecycle: capture % asset rows do not equal its captured total', p_capture_id
      using errcode = '22023';
  end if;
  if exists (select 1 from plm.peanuts_lifecycle_publication where published_capture_id = p_capture_id) then
    raise exception 'peanuts_publish_lifecycle: capture % is already published', p_capture_id
      using errcode = '23505';
  end if;

  select * into v_prev from plm.peanuts_lifecycle_publication
   order by source_captured_at desc, published_at desc, published_capture_id desc limit 1;
  if found and v_prev.source_captured_at >= v_cap.source_captured_at then
    raise exception 'peanuts_publish_lifecycle: capture % is not newer than published capture %',
      p_capture_id, v_prev.published_capture_id using errcode = '22023';
  end if;

  v_scope := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
               pg_catalog.jsonb_build_array(v_cap.api_endpoint, v_cap.source_customer_id)::text, 'UTF8')), 'hex');

  if v_prev.published_capture_id is null then
    v_mode := 'bootstrap';
  elsif v_prev.scope_sha256 = v_scope and v_prev.derivation_contract = c_contract then
    v_mode := 'comparable';
  else
    v_mode := 'rebaseline';
  end if;

  -- Withdrawal-eligible sightings: the baseline itself, plus -- across a run of held
  -- publications -- each held publication's own baseline. A held drop is therefore
  -- re-evaluated by the next comparable run instead of being orphaned.
  if v_prev.published_capture_id is not null then
    with recursive chain as (
      select p.published_capture_id, p.baseline_capture_id, p.mode
        from plm.peanuts_lifecycle_publication p where p.published_capture_id = v_prev.published_capture_id
      union all
      select p.published_capture_id, p.baseline_capture_id, p.mode
        from chain c join plm.peanuts_lifecycle_publication p on p.published_capture_id = c.baseline_capture_id
       where c.mode = 'withdrawal_held'
    )
    select pg_catalog.array_agg(chain.published_capture_id) into v_eligible from chain;
  end if;

  insert into plm.peanuts_lifecycle_publication
    (published_capture_id, baseline_capture_id, mode, derivation_contract, scope_sha256, source_captured_at)
  values (p_capture_id, v_prev.published_capture_id, v_mode, c_contract, v_scope, v_cap.source_captured_at);

  drop table if exists pg_temp.peanuts_lifecycle_seen;
  create temporary table pg_temp.peanuts_lifecycle_seen (
    entity_kind text not null, entity_key text not null, change_signal text not null,
    primary key (entity_kind, entity_key)
  ) on commit drop;

  insert into peanuts_lifecycle_seen
  select 'asset', a.source_object_id,
         pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.jsonb_build_array(
           a.source_updated_at, a.checksum, a.file_size_bytes, a.version_number)::text, 'UTF8')), 'hex')
    from plm.peanuts_asset a where a.capture_id = p_capture_id;
  insert into peanuts_lifecycle_seen
  select 'art_program', v.value_key,
         pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.jsonb_build_array(v.value_label, v.raw)::text, 'UTF8')), 'hex')
    from plm.peanuts_art_program v where v.capture_id = p_capture_id;
  insert into peanuts_lifecycle_seen
  select 'character', v.value_key,
         pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.jsonb_build_array(v.value_label, v.raw)::text, 'UTF8')), 'hex')
    from plm.peanuts_character v where v.capture_id = p_capture_id;
  insert into peanuts_lifecycle_seen
  select 'style_guide', v.value_key,
         pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.jsonb_build_array(v.value_label, v.raw)::text, 'UTF8')), 'hex')
    from plm.peanuts_style_guide v where v.capture_id = p_capture_id;
  insert into peanuts_lifecycle_seen
  select 'initiative', v.value_key,
         pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.jsonb_build_array(v.value_label, v.raw)::text, 'UTF8')), 'hex')
    from plm.peanuts_initiative v where v.capture_id = p_capture_id;

  -- Bulk-drop guard, evaluated before any write. Denominator: entities of the kind whose
  -- last sighting is withdrawal-eligible (see above). A persistent mass drop keeps being
  -- held and recorded; applying it needs a separately reviewed change. Held when drops exceed the smaller of 100 rows or 2%
  -- of that denominator (never below one row). Initiative retirement is exempt.
  if v_mode = 'comparable' then
    foreach v_kind in array array['asset','art_program','character','style_guide'] loop
      select pg_catalog.count(*) into v_base from plm.peanuts_entity_lifecycle l
       where l.entity_kind = v_kind and l.last_seen_capture_id = any(v_eligible);
      select pg_catalog.count(*) into v_drop from plm.peanuts_entity_lifecycle l
       where l.entity_kind = v_kind and l.status = 'active' and l.last_seen_capture_id = any(v_eligible)
         and not exists (select 1 from peanuts_lifecycle_seen s where s.entity_kind = l.entity_kind and s.entity_key = l.entity_key);
      v_limit := greatest(1, least(100, pg_catalog.floor(v_base * 0.02)::bigint));
      if v_drop > v_limit then
        v_held := true;
      end if;
    end loop;
    if v_held then
      v_mode := 'withdrawal_held';
      update plm.peanuts_lifecycle_publication set mode = v_mode where published_capture_id = p_capture_id;
    end if;
  end if;

  foreach v_kind in array array['asset','art_program','character','style_guide','initiative'] loop
    select pg_catalog.count(*) into v_seen from peanuts_lifecycle_seen s where s.entity_kind = v_kind;
    select pg_catalog.count(*) into v_added from peanuts_lifecycle_seen s where s.entity_kind = v_kind
       and not exists (select 1 from plm.peanuts_entity_lifecycle l where l.entity_kind = s.entity_kind and l.entity_key = s.entity_key);
    select pg_catalog.count(*) into v_changed from peanuts_lifecycle_seen s join plm.peanuts_entity_lifecycle l
        on l.entity_kind = s.entity_kind and l.entity_key = s.entity_key
     where s.entity_kind = v_kind and l.change_signal <> s.change_signal;
    select pg_catalog.count(*) into v_back from peanuts_lifecycle_seen s join plm.peanuts_entity_lifecycle l
        on l.entity_kind = s.entity_kind and l.entity_key = s.entity_key
     where s.entity_kind = v_kind and l.status <> 'active';
    v_drop := 0;
    if v_mode in ('comparable', 'withdrawal_held') and (v_mode = 'comparable' or v_kind = 'initiative') then
      select pg_catalog.count(*) into v_drop from plm.peanuts_entity_lifecycle l
       where l.entity_kind = v_kind and l.status = 'active' and l.last_seen_capture_id = any(v_eligible)
         and not exists (select 1 from peanuts_lifecycle_seen s where s.entity_kind = l.entity_kind and s.entity_key = l.entity_key);
    end if;
    v_counts := v_counts || pg_catalog.jsonb_build_object(v_kind, pg_catalog.jsonb_build_object(
      'seen', v_seen, 'added', v_added, 'changed', v_changed, 'reactivated', v_back,
      case when v_kind = 'initiative' then 'retired' else 'withdrawn' end, v_drop));
  end loop;

  -- Initiative retirement is ordinary seasonal behaviour and is never held.
  if v_mode in ('comparable', 'withdrawal_held') then
    update plm.peanuts_entity_lifecycle l
       set status = 'retired', retired_at = v_cap.source_captured_at
     where l.entity_kind = 'initiative' and l.status = 'active' and l.last_seen_capture_id = any(v_eligible)
       and not exists (select 1 from peanuts_lifecycle_seen s where s.entity_kind = l.entity_kind and s.entity_key = l.entity_key);
  end if;
  if v_mode = 'comparable' then
    update plm.peanuts_entity_lifecycle l
       set status = 'withdrawn', withdrawn_at = v_cap.source_captured_at,
           first_withdrawn_at = coalesce(l.first_withdrawn_at, v_cap.source_captured_at),
           withdrawn_capture_id = p_capture_id
     where l.entity_kind <> 'initiative' and l.status = 'active' and l.last_seen_capture_id = any(v_eligible)
       and not exists (select 1 from peanuts_lifecycle_seen s where s.entity_kind = l.entity_kind and s.entity_key = l.entity_key);
  end if;

  insert into plm.peanuts_entity_lifecycle as l
    (entity_kind, entity_key, first_seen_capture_id, first_seen_at,
     last_seen_capture_id, last_seen_at, last_changed_capture_id, change_signal)
  select s.entity_kind, s.entity_key, p_capture_id, v_cap.source_captured_at,
         p_capture_id, v_cap.source_captured_at, p_capture_id, s.change_signal
    from peanuts_lifecycle_seen s
  on conflict (entity_kind, entity_key) do update
     set last_seen_capture_id = excluded.last_seen_capture_id,
         last_seen_at = excluded.last_seen_at,
         last_changed_capture_id = case when l.change_signal <> excluded.change_signal
                                        then excluded.last_changed_capture_id else l.last_changed_capture_id end,
         change_signal = excluded.change_signal,
         status = 'active', withdrawn_at = null, withdrawn_capture_id = null, retired_at = null;

  update plm.peanuts_lifecycle_publication
     set counts = v_counts, published_at = now()
   where published_capture_id = p_capture_id;

  return pg_catalog.jsonb_build_object('capture_id', p_capture_id, 'mode', v_mode,
    'baseline_capture_id', v_prev.published_capture_id, 'counts', v_counts);
end
$function$
;
revoke all on function plm.peanuts_publish_lifecycle(p_capture_id uuid) from public, anon, authenticated;
grant execute on function plm.peanuts_publish_lifecycle(p_capture_id uuid) to service_role;
CREATE OR REPLACE FUNCTION plm.wildbrain_publish_lifecycle(p_capture_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
declare
  c_contract constant text := 'wildbrain-entity-keys-v1';
  v_cap        plm.wildbrain_capture%rowtype;
  v_prev       plm.wildbrain_lifecycle_publication%rowtype;
  v_scope      text;
  v_rules      text;
  v_mode       text;
  v_guides     boolean;
  v_counts     jsonb := '{}'::jsonb;
  v_kind       text;
  v_seen       bigint;
  v_added      bigint;
  v_changed    bigint;
  v_back       bigint;
  v_base       bigint;
  v_drop       bigint;
  v_limit      bigint;
  v_held       boolean := false;
  v_eligible   uuid[] := '{}';
begin
  -- Concurrent publication locking: every publication for this licensor is serial.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('plm.wildbrain_publish_lifecycle', 0));

  select * into v_cap from plm.wildbrain_capture where id = p_capture_id for share;
  if not found then
    raise exception 'wildbrain_publish_lifecycle: no capture %', p_capture_id using errcode = 'P0002';
  end if;
  if v_cap.status <> 'complete' or v_cap.load_completed_at is null
     or v_cap.error_summary <> '[]'::jsonb or v_cap.media_downloaded <> 0
     or v_cap.pagination_verified is not true or v_cap.truncated_child_lists <> 0
     or v_cap.reported_total is null
     or (select pg_catalog.count(*) from plm.wildbrain_asset a where a.capture_id = p_capture_id)
        <> v_cap.reported_total then
    raise exception 'wildbrain_publish_lifecycle: capture % is not a complete zero-failure capture', p_capture_id
      using errcode = '22023';
  end if;
  if exists (select 1 from plm.wildbrain_lifecycle_publication where capture_id = p_capture_id) then
    raise exception 'wildbrain_publish_lifecycle: capture % is already published', p_capture_id
      using errcode = '23505';
  end if;

  select * into v_prev from plm.wildbrain_lifecycle_publication
   order by source_captured_at desc, published_at desc limit 1;
  if found and v_prev.source_captured_at >= v_cap.source_captured_at then
    raise exception 'wildbrain_publish_lifecycle: capture % is not newer than published capture %',
      p_capture_id, v_prev.capture_id using errcode = '22023';
  end if;

  v_scope := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_cap.portal_base_url, 'UTF8')), 'hex');
  select coalesce(pg_catalog.string_agg(distinct g.rule_version, ',' order by g.rule_version), '')
    into v_rules from plm.wildbrain_guide g where g.capture_id = p_capture_id;

  if v_prev.capture_id is null then
    v_mode := 'bootstrap';
  elsif v_prev.scope_sha256 = v_scope and v_prev.derivation_contract = c_contract then
    v_mode := 'comparable';
  else
    v_mode := 'rebaseline';
  end if;
  -- Inferred guides compare only against a baseline derived by the same rule versions.
  v_guides := v_mode = 'comparable' and v_prev.guide_rule_versions = v_rules;

  -- Withdrawal-eligible sightings: the baseline itself, plus -- across a run of held
  -- publications -- each held publication's own baseline. A held drop is therefore
  -- re-evaluated by the next comparable run instead of being orphaned.
  if v_prev.capture_id is not null then
    with recursive chain as (
      select p.capture_id, p.baseline_capture_id, p.mode
        from plm.wildbrain_lifecycle_publication p where p.capture_id = v_prev.capture_id
      union all
      select p.capture_id, p.baseline_capture_id, p.mode
        from chain c join plm.wildbrain_lifecycle_publication p on p.capture_id = c.baseline_capture_id
       where c.mode = 'withdrawal_held'
    )
    select pg_catalog.array_agg(chain.capture_id) into v_eligible from chain;
  end if;

  insert into plm.wildbrain_lifecycle_publication
    (capture_id, baseline_capture_id, mode, derivation_contract, guide_rule_versions, scope_sha256, source_captured_at)
  values (p_capture_id, v_prev.capture_id, v_mode, c_contract, v_rules, v_scope, v_cap.source_captured_at);

  drop table if exists pg_temp.wildbrain_lifecycle_seen;
  create temporary table pg_temp.wildbrain_lifecycle_seen (
    entity_kind text not null, entity_key text not null, change_signal text not null,
    primary key (entity_kind, entity_key)
  ) on commit drop;

  insert into pg_temp.wildbrain_lifecycle_seen
  select 'asset', a.asset_source_id, a.source_hash
    from plm.wildbrain_asset a where a.capture_id = p_capture_id;
  insert into pg_temp.wildbrain_lifecycle_seen
  select 'era', v.era_source_id,
         pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.jsonb_build_array(v.era_label, v.parent_era_source_id, v.raw)::text, 'UTF8')), 'hex')
    from plm.wildbrain_era v where v.capture_id = p_capture_id;
  insert into pg_temp.wildbrain_lifecycle_seen
  select 'creative_group', v.creative_group_source_id,
         pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.jsonb_build_array(v.creative_group_label, v.raw)::text, 'UTF8')), 'hex')
    from plm.wildbrain_creative_group v where v.capture_id = p_capture_id;
  insert into pg_temp.wildbrain_lifecycle_seen
  select 'character', v.character_source_id,
         pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.jsonb_build_array(v.character_label, v.raw)::text, 'UTF8')), 'hex')
    from plm.wildbrain_character v where v.capture_id = p_capture_id;
  insert into pg_temp.wildbrain_lifecycle_seen
  select 'guide', v.guide_key,
         pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.jsonb_build_array(
           v.guide_label, v.derivation_method, v.rule_version, v.relationship_truth, v.raw)::text, 'UTF8')), 'hex')
    from plm.wildbrain_guide v where v.capture_id = p_capture_id;

  -- Bulk-drop guard, evaluated before any write. Denominator: entities of the kind whose
  -- last sighting is withdrawal-eligible (see above). A persistent mass drop keeps being
  -- held and recorded; applying it needs a separately reviewed change. Held when drops exceed the smaller of 100 rows or 2%
  -- of that denominator (never below one row).
  if v_mode = 'comparable' then
    foreach v_kind in array array['asset','era','creative_group','character','guide'] loop
      continue when v_kind = 'guide' and not v_guides;
      select pg_catalog.count(*) into v_base from plm.wildbrain_entity_lifecycle l
       where l.entity_kind = v_kind and ((l.entity_kind <> 'guide' and l.last_seen_capture_id = any(v_eligible)) or (l.entity_kind = 'guide' and l.last_seen_capture_id = v_prev.capture_id));
      select pg_catalog.count(*) into v_drop from plm.wildbrain_entity_lifecycle l
       where l.entity_kind = v_kind and l.status = 'active' and ((l.entity_kind <> 'guide' and l.last_seen_capture_id = any(v_eligible)) or (l.entity_kind = 'guide' and l.last_seen_capture_id = v_prev.capture_id))
         and not exists (select 1 from pg_temp.wildbrain_lifecycle_seen s where s.entity_kind = l.entity_kind and s.entity_key = l.entity_key);
      v_limit := greatest(1, least(100, pg_catalog.floor(v_base * 0.02)::bigint));
      if v_drop > v_limit then
        v_held := true;
      end if;
    end loop;
    if v_held then
      v_mode := 'withdrawal_held';
      update plm.wildbrain_lifecycle_publication set mode = v_mode where capture_id = p_capture_id;
    end if;
  end if;

  foreach v_kind in array array['asset','era','creative_group','character','guide'] loop
    select pg_catalog.count(*) into v_seen from pg_temp.wildbrain_lifecycle_seen s where s.entity_kind = v_kind;
    select pg_catalog.count(*) into v_added from pg_temp.wildbrain_lifecycle_seen s where s.entity_kind = v_kind
       and not exists (select 1 from plm.wildbrain_entity_lifecycle l where l.entity_kind = s.entity_kind and l.entity_key = s.entity_key);
    select pg_catalog.count(*) into v_changed from pg_temp.wildbrain_lifecycle_seen s join plm.wildbrain_entity_lifecycle l
        on l.entity_kind = s.entity_kind and l.entity_key = s.entity_key
     where s.entity_kind = v_kind and l.change_signal <> s.change_signal;
    select pg_catalog.count(*) into v_back from pg_temp.wildbrain_lifecycle_seen s join plm.wildbrain_entity_lifecycle l
        on l.entity_kind = s.entity_kind and l.entity_key = s.entity_key
     where s.entity_kind = v_kind and l.status = 'withdrawn';
    v_drop := 0;
    if v_mode = 'comparable' and (v_kind <> 'guide' or v_guides) then
      select pg_catalog.count(*) into v_drop from plm.wildbrain_entity_lifecycle l
       where l.entity_kind = v_kind and l.status = 'active' and ((l.entity_kind <> 'guide' and l.last_seen_capture_id = any(v_eligible)) or (l.entity_kind = 'guide' and l.last_seen_capture_id = v_prev.capture_id))
         and not exists (select 1 from pg_temp.wildbrain_lifecycle_seen s where s.entity_kind = l.entity_kind and s.entity_key = l.entity_key);
    end if;
    v_counts := v_counts || pg_catalog.jsonb_build_object(v_kind, pg_catalog.jsonb_build_object(
      'seen', v_seen, 'added', v_added, 'changed', v_changed, 'reactivated', v_back, 'withdrawn', v_drop));
  end loop;

  if v_mode = 'comparable' then
    update plm.wildbrain_entity_lifecycle l
       set status = 'withdrawn', withdrawn_at = v_cap.source_captured_at,
           first_withdrawn_at = coalesce(l.first_withdrawn_at, v_cap.source_captured_at),
           withdrawn_capture_id = p_capture_id
     where (l.entity_kind <> 'guide' or v_guides)
       and l.status = 'active' and ((l.entity_kind <> 'guide' and l.last_seen_capture_id = any(v_eligible)) or (l.entity_kind = 'guide' and l.last_seen_capture_id = v_prev.capture_id))
       and not exists (select 1 from pg_temp.wildbrain_lifecycle_seen s where s.entity_kind = l.entity_kind and s.entity_key = l.entity_key);
  end if;

  insert into plm.wildbrain_entity_lifecycle as l
    (entity_kind, entity_key, first_seen_capture_id, first_seen_at,
     last_seen_capture_id, last_seen_at, last_changed_capture_id, change_signal)
  select s.entity_kind, s.entity_key, p_capture_id, v_cap.source_captured_at,
         p_capture_id, v_cap.source_captured_at, p_capture_id, s.change_signal
    from pg_temp.wildbrain_lifecycle_seen s
  on conflict (entity_kind, entity_key) do update
     set last_seen_capture_id = excluded.last_seen_capture_id,
         last_seen_at = excluded.last_seen_at,
         last_changed_capture_id = case when l.change_signal <> excluded.change_signal
                                        then excluded.last_changed_capture_id else l.last_changed_capture_id end,
         change_signal = excluded.change_signal,
         status = 'active', withdrawn_at = null, withdrawn_capture_id = null;

  update plm.wildbrain_lifecycle_publication
     set counts = v_counts, published_at = now()
   where capture_id = p_capture_id;

  return pg_catalog.jsonb_build_object('capture_id', p_capture_id, 'mode', v_mode,
    'guides_compared', v_guides, 'baseline_capture_id', v_prev.capture_id, 'counts', v_counts);
end
$function$
;
revoke all on function plm.wildbrain_publish_lifecycle(p_capture_id uuid) from public, anon, authenticated;
grant execute on function plm.wildbrain_publish_lifecycle(p_capture_id uuid) to service_role;
CREATE OR REPLACE FUNCTION plm.redirect_retired_wb_licensor()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'core'
AS $function$
begin
  if new.licensor_id is not null
     and exists (select 1 from core.licensor l where l.id = new.licensor_id and l.code in ('DC', 'HP')) then
    select l.id into new.licensor_id from core.licensor l where l.code = 'WB';
  end if;
  return new;
end $function$
;
revoke all on function plm.redirect_retired_wb_licensor() from public, anon, authenticated;
CREATE OR REPLACE FUNCTION plm.sync_core_property_from_coldlion(p_apply boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
declare
  v_actor constant text := 'plm.sync_core_property_from_coldlion (#6194)';
  r record;
  v_id uuid; v_n integer;
  v_created integer := 0; v_coded integer := 0; v_renamed integer := 0; v_status integer := 0; v_seen integer := 0;
  v_skipped jsonb := '[]'::jsonb;
  v_has_app boolean := to_regclass('dflow_prod."merchGroup"') is not null;
  v_counts jsonb;
  v_cur record;
begin
  if to_regclass('coldlion.merch_group_detail') is null then
    return jsonb_build_object('note','coldlion landing absent; nothing to do');
  end if;
  if (select count(*) from coldlion.merch_group_detail where mg_type_code = '06') = 0 then
    return jsonb_build_object('note','no ColdLion MG06 rows landed; nothing to do');
  end if;
  if (select count(*) from coldlion.merch_group_detail where mg_type_code = '06'
        and last_seen_at > now() - interval '3 days') = 0 then
    raise exception '#6194: ColdLion MG06 landing is older than 3 days; refusing to sync from a stale copy';
  end if;

  create temp table if not exists _cl_prop (
    code text primary key, name text, active boolean, licensor_id uuid, how text
  ) on commit drop;
  truncate _cl_prop;

  insert into _cl_prop(code, name, active)
  select mg_code, (array_agg(mg_desc order by (active = 'Y') desc, mod_time desc nulls last))[1], bool_or(active = 'Y')
    from coldlion.merch_group_detail
   where mg_type_code = '06' and nullif(btrim(mg_code), '') is not null and nullif(btrim(mg_desc), '') is not null
   group by mg_code;

  -- Licensor 1: the one licensor that already owns this code in core.property.
  update _cl_prop c set licensor_id = x.lid, how = 'existing_code'
    from (select code, min(licensor_id::text)::uuid lid from core.property where code is not null
           group by code having count(distinct licensor_id) = 1) x
   where x.code = c.code;

  -- Licensor 2: the MG05 parent the app list gives this MG06 code (production only).
  if v_has_app then
    -- static SQL: plpgsql plans it only when this branch runs, so it is safe where dflow_prod is absent.
      update _cl_prop c set licensor_id = l.id, how = 'app_parent'
        from (select m.mg_code c, min(p.mg_code) lic
                from dflow_prod."merchGroup" m join dflow_prod."merchGroup" p on p.mg_id = m.parent_id
               where m."mgTypeCode" = '06' group by m.mg_code having count(distinct p.mg_code) = 1) a
        join core.licensor l on l.code = a.lic
       where a.c = c.code and c.licensor_id is null;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('code', code, 'name', name, 'active', active) order by code), '[]'::jsonb)
    into v_skipped from _cl_prop where licensor_id is null;

  for r in select * from _cl_prop where licensor_id is not null order by code loop
    v_seen := v_seen + 1;
    v_id := null;
    select id into v_id from core.property where licensor_id = r.licensor_id and code = r.code;
    if v_id is null then
      select count(*), min(id::text)::uuid into v_n, v_id from core.property
       where licensor_id = r.licensor_id and code is null and lower(name) = lower(r.name);
      if v_n <> 1 then v_id := null; end if;
      if v_id is not null then
        v_coded := v_coded + 1;
        if p_apply then
          insert into plm.licensing_write_authorization(backend_pid,transaction_id,target_table,write_kind,plan_id,plan_hash,actor,protected_columns,expires_at)
          values (pg_backend_pid(), txid_current(), 'core.property', 'scrape_consolidation', gen_random_uuid(),
            encode(extensions.digest('6194/code/'||r.code,'sha256'),'hex'), v_actor,
            case when (select name from core.property where id = v_id) = r.name then array['code'] else array['name','code'] end,
            clock_timestamp() + interval '1 minute');
          update core.property
             set code = r.code, name = r.name, updated_at = now(),
                 metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object('coldlion_sync', jsonb_build_object(
                   'issue', 6194, 'coded_at', now(), 'previous_name', name))
           where id = v_id;
        end if;
      end if;
    end if;

    if v_id is null then
      v_created := v_created + 1;
      if p_apply then
        insert into plm.licensing_write_authorization(backend_pid,transaction_id,target_table,write_kind,plan_id,plan_hash,actor,protected_columns,expires_at)
        values (pg_backend_pid(), txid_current(), 'core.property', 'licensing_review_create', gen_random_uuid(),
          encode(extensions.digest('6194/create/'||r.code,'sha256'),'hex'), v_actor,
          array['licensor_id','name','code','status'], clock_timestamp() + interval '1 minute');
        insert into core.property(licensor_id, name, code, status, metadata)
        values (r.licensor_id, r.name, r.code, 'potential',
                jsonb_build_object('coldlion_sync', jsonb_build_object('issue', 6194, 'created_at', now(), 'licensor_from', r.how)))
        returning id into v_id;
      end if;
    end if;

    if not p_apply and v_id is null then continue; end if;

    select name, status::text st into v_cur from core.property where id = v_id;
    if v_cur.name is distinct from r.name and not (not p_apply and v_coded > 0 and (select code from core.property where id = v_id) is null) then
      v_renamed := v_renamed + 1;
      if p_apply then
        insert into plm.licensing_write_authorization(backend_pid,transaction_id,target_table,write_kind,plan_id,plan_hash,actor,protected_columns,expires_at)
        values (pg_backend_pid(), txid_current(), 'core.property', 'scrape_consolidation', gen_random_uuid(),
          encode(extensions.digest('6194/name/'||r.code,'sha256'),'hex'), v_actor, array['name'], clock_timestamp() + interval '1 minute');
        update core.property
           set name = r.name, updated_at = now(),
               metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object('coldlion_sync',
                 coalesce(metadata->'coldlion_sync','{}'::jsonb) || jsonb_build_object('issue', 6194, 'renamed_at', now(), 'previous_name', name))
         where id = v_id;
      end if;
    end if;
    if v_cur.st is distinct from (case when r.active then 'active' else 'inactive' end) then
      v_status := v_status + 1;
      if p_apply then
        insert into plm.licensing_write_authorization(backend_pid,transaction_id,target_table,write_kind,plan_id,plan_hash,actor,protected_columns,expires_at)
        values (pg_backend_pid(), txid_current(), 'core.property', 'coldlion_status', gen_random_uuid(),
          encode(extensions.digest('6194/status/'||r.code,'sha256'),'hex'), v_actor, array['status'], clock_timestamp() + interval '1 minute');
        update core.property set status = case when r.active then 'active' else 'inactive' end::app.entity_status, updated_at = now()
         where id = v_id;
      end if;
    end if;
  end loop;

  v_counts := jsonb_build_object('coldlion_values', (select count(*) from _cl_prop), 'placed', v_seen,
    'created', v_created, 'coded', v_coded, 'renamed', v_renamed, 'status_changed', v_status,
    'skipped_no_licensor', jsonb_array_length(v_skipped));
  insert into plm.coldlion_property_sync_run(applied, counts, skipped) values (p_apply, v_counts, v_skipped);
  return v_counts || jsonb_build_object('applied', p_apply);
end;
$function$
;
revoke all on function plm.sync_core_property_from_coldlion(p_apply boolean) from public, anon, authenticated;
CREATE OR REPLACE FUNCTION plm.set_source_resolution(p_source_system text, p_entity_kind text, p_source_id text, p_resolution_status text, p_core_property_id uuid DEFAULT NULL::uuid, p_core_character_id uuid DEFAULT NULL::uuid, p_core_style_guide_id uuid DEFAULT NULL::uuid, p_dam_asset_id uuid DEFAULT NULL::uuid, p_resolution_reason text DEFAULT NULL::text, p_expected_updated_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS plm.source_resolution
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  v_existing plm.source_resolution%rowtype;
  v_result plm.source_resolution%rowtype;
  v_target_found boolean := false;
  v_actor text := coalesce(
    auth.uid()::text,
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    session_user::text
  );
begin
  p_source_system := btrim(p_source_system);
  p_entity_kind := btrim(p_entity_kind);
  p_source_id := btrim(p_source_id);
  p_resolution_status := btrim(p_resolution_status);
  p_resolution_reason := nullif(btrim(p_resolution_reason), '');

  if coalesce(v_actor, '') = '' then
    raise exception using errcode = '42501', message = 'source resolution requires an authenticated actor';
  end if;

  -- Validate and lock the chosen target exactly as an FK would, but branch-by-branch.
  -- A future target-table retirement can disable only its own kind, never all decisions.
  if p_resolution_status = 'matched' then
    case p_entity_kind
      when 'property' then
        if to_regclass('core.property') is not null then
          execute 'select true from core.property where id = $1 for key share'
            into v_target_found using p_core_property_id;
        end if;
      when 'character' then
        if to_regclass('core.character') is not null then
          execute 'select true from core.character where id = $1 for key share'
            into v_target_found using p_core_character_id;
        end if;
      when 'style_guide' then
        if to_regclass('core.style_guide') is not null then
          execute 'select true from core.style_guide where id = $1 for key share'
            into v_target_found using p_core_style_guide_id;
        end if;
      when 'asset' then
        if to_regclass('dam.asset') is not null then
          execute 'select true from dam.asset where id = $1 for key share'
            into v_target_found using p_dam_asset_id;
        end if;
      else
        v_target_found := false;
    end case;
    if not coalesce(v_target_found, false) then
      raise exception using errcode = '23503',
        message = format('source resolution target is missing for kind %s', p_entity_kind),
        detail = format('target UUID: %s', coalesce(
          p_core_property_id, p_core_character_id, p_core_style_guide_id, p_dam_asset_id)::text);
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    concat_ws(E'\x1f', p_source_system, p_entity_kind, p_source_id), 0));
  select * into v_existing from plm.source_resolution
   where source_system = p_source_system and entity_kind = p_entity_kind and source_id = p_source_id
   for update;

  if found then
    if v_existing.resolution_status is not distinct from p_resolution_status
       and v_existing.core_property_id is not distinct from p_core_property_id
       and v_existing.core_character_id is not distinct from p_core_character_id
       and v_existing.core_style_guide_id is not distinct from p_core_style_guide_id
       and v_existing.dam_asset_id is not distinct from p_dam_asset_id
       and v_existing.resolution_reason is not distinct from p_resolution_reason then
      return v_existing;
    end if;
    if p_expected_updated_at is null or p_expected_updated_at is distinct from v_existing.updated_at then
      raise exception using errcode = '40001',
        message = format('source resolution changed for %s/%s/%s; reload before replacing it',
          p_source_system, p_entity_kind, p_source_id);
    end if;
    update plm.source_resolution
       set resolution_status=p_resolution_status, core_property_id=p_core_property_id,
           core_character_id=p_core_character_id, core_style_guide_id=p_core_style_guide_id,
           dam_asset_id=p_dam_asset_id, resolution_reason=p_resolution_reason,
           resolved_at=clock_timestamp(), resolved_by=v_actor, updated_at=clock_timestamp()
     where source_system=p_source_system and entity_kind=p_entity_kind and source_id=p_source_id
     returning * into v_result;
  else
    if p_expected_updated_at is not null then
      raise exception using errcode = '40001',
        message = format('source resolution does not exist for %s/%s/%s; reload before writing',
          p_source_system, p_entity_kind, p_source_id);
    end if;
    insert into plm.source_resolution (
      source_system,entity_kind,source_id,resolution_status,
      core_property_id,core_character_id,core_style_guide_id,dam_asset_id,
      resolution_reason,resolved_at,resolved_by)
    values (p_source_system,p_entity_kind,p_source_id,p_resolution_status,
      p_core_property_id,p_core_character_id,p_core_style_guide_id,p_dam_asset_id,
      p_resolution_reason,clock_timestamp(),v_actor)
    returning * into v_result;
  end if;
  return v_result;
end;
$function$
;
revoke all on function plm.set_source_resolution(p_source_system text, p_entity_kind text, p_source_id text, p_resolution_status text, p_core_property_id uuid, p_core_character_id uuid, p_core_style_guide_id uuid, p_dam_asset_id uuid, p_resolution_reason text, p_expected_updated_at timestamp with time zone) from public, anon, authenticated;
grant execute on function plm.set_source_resolution(p_source_system text, p_entity_kind text, p_source_id text, p_resolution_status text, p_core_property_id uuid, p_core_character_id uuid, p_core_style_guide_id uuid, p_dam_asset_id uuid, p_resolution_reason text, p_expected_updated_at timestamp with time zone) to authenticated;
grant execute on function plm.set_source_resolution(p_source_system text, p_entity_kind text, p_source_id text, p_resolution_status text, p_core_property_id uuid, p_core_character_id uuid, p_core_style_guide_id uuid, p_dam_asset_id uuid, p_resolution_reason text, p_expected_updated_at timestamp with time zone) to service_role;
CREATE OR REPLACE FUNCTION plm.set_source_resolution(p_source_system text, p_entity_kind text, p_source_id text, p_resolution_status text, p_core_property_id uuid, p_core_character_id uuid, p_core_style_guide_id uuid, p_dam_asset_id uuid, p_resolution_reason text, p_expected_updated_at timestamp with time zone, p_core_licensor_id uuid, p_core_franchise_id uuid)
 RETURNS plm.source_resolution
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  v_existing plm.source_resolution%rowtype;
  v_result plm.source_resolution%rowtype;
  v_target_found boolean := false;
  v_actor text := coalesce(
    auth.uid()::text,
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    session_user::text
  );
begin
  p_source_system := btrim(p_source_system);
  p_entity_kind := btrim(p_entity_kind);
  p_source_id := btrim(p_source_id);
  p_resolution_status := btrim(p_resolution_status);
  p_resolution_reason := nullif(btrim(p_resolution_reason), '');

  if coalesce(v_actor, '') = '' then
    raise exception using errcode = '42501',
      message = 'source resolution requires an authenticated actor';
  end if;

  -- Validate and lock the chosen target the way a foreign key would, but branch by
  -- branch, so a future retirement of one target table can disable only its own kind and
  -- never every decision at once. The lookup is dynamic for the same reason the
  -- ten-argument body uses dynamic lookups: this function must still create cleanly on a
  -- database where a target table does not exist yet.
  if p_resolution_status = 'matched' then
    case p_entity_kind
      when 'property' then
        if to_regclass('core.property') is not null then
          execute 'select true from core.property where id = $1 for key share'
            into v_target_found using p_core_property_id;
        end if;
      when 'character' then
        if to_regclass('core.character') is not null then
          execute 'select true from core.character where id = $1 for key share'
            into v_target_found using p_core_character_id;
        end if;
      when 'style_guide' then
        if to_regclass('core.style_guide') is not null then
          execute 'select true from core.style_guide where id = $1 for key share'
            into v_target_found using p_core_style_guide_id;
        end if;
      when 'asset' then
        if to_regclass('dam.asset') is not null then
          execute 'select true from dam.asset where id = $1 for key share'
            into v_target_found using p_dam_asset_id;
        end if;
      when 'licensor' then
        if to_regclass('core.licensor') is not null then
          execute 'select true from core.licensor where id = $1 for key share'
            into v_target_found using p_core_licensor_id;
        end if;
      when 'franchise' then
        if to_regclass('core.franchise') is not null then
          execute 'select true from core.franchise where id = $1 for key share'
            into v_target_found using p_core_franchise_id;
        end if;
      else
        v_target_found := false;
    end case;

    if not coalesce(v_target_found, false) then
      raise exception using errcode = '23503',
        message = format('source resolution target is missing for kind %s', p_entity_kind),
        detail = format('target UUID: %s', coalesce(
          p_core_property_id, p_core_character_id, p_core_style_guide_id, p_dam_asset_id,
          p_core_licensor_id, p_core_franchise_id)::text);
    end if;
  end if;

  -- First-writer serialization on the decision key, so two analysts deciding the same
  -- source key at the same instant queue instead of racing.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    pg_catalog.concat_ws(chr(31), p_source_system, p_entity_kind, p_source_id), 0));

  select * into v_existing
    from plm.source_resolution
   where source_system = p_source_system
     and entity_kind = p_entity_kind
     and source_id = p_source_id
   for update;

  if found then
    -- An identical repeat is not a change and must not consume the caller token or
    -- rewrite the audit stamp. This is what makes the setter safely retryable.
    if v_existing.resolution_status is not distinct from p_resolution_status
       and v_existing.core_property_id is not distinct from p_core_property_id
       and v_existing.core_character_id is not distinct from p_core_character_id
       and v_existing.core_style_guide_id is not distinct from p_core_style_guide_id
       and v_existing.dam_asset_id is not distinct from p_dam_asset_id
       and v_existing.core_licensor_id is not distinct from p_core_licensor_id
       and v_existing.core_franchise_id is not distinct from p_core_franchise_id
       and v_existing.resolution_reason is not distinct from p_resolution_reason then
      return v_existing;
    end if;

    -- Optimistic concurrency: replacing someone else decision requires having read it.
    if p_expected_updated_at is null
       or p_expected_updated_at is distinct from v_existing.updated_at then
      raise exception using errcode = '40001',
        message = format(
          'source resolution changed for %s/%s/%s; reload it before replacing it',
          p_source_system, p_entity_kind, p_source_id);
    end if;

    update plm.source_resolution
       set resolution_status = p_resolution_status,
           core_property_id = p_core_property_id,
           core_character_id = p_core_character_id,
           core_style_guide_id = p_core_style_guide_id,
           dam_asset_id = p_dam_asset_id,
           core_licensor_id = p_core_licensor_id,
           core_franchise_id = p_core_franchise_id,
           resolution_reason = p_resolution_reason,
           resolved_at = clock_timestamp(),
           resolved_by = v_actor,
           updated_at = clock_timestamp()
     where source_system = p_source_system
       and entity_kind = p_entity_kind
       and source_id = p_source_id
    returning * into v_result;
  else
    -- A token supplied for a row that does not exist means the caller read something that
    -- has since been deleted. Refusing is the only safe answer.
    if p_expected_updated_at is not null then
      raise exception using errcode = '40001',
        message = format(
          'source resolution does not exist for %s/%s/%s; reload it before writing',
          p_source_system, p_entity_kind, p_source_id);
    end if;

    insert into plm.source_resolution (
      source_system, entity_kind, source_id, resolution_status,
      core_property_id, core_character_id, core_style_guide_id, dam_asset_id,
      core_licensor_id, core_franchise_id,
      resolution_reason, resolved_at, resolved_by)
    values (
      p_source_system, p_entity_kind, p_source_id, p_resolution_status,
      p_core_property_id, p_core_character_id, p_core_style_guide_id, p_dam_asset_id,
      p_core_licensor_id, p_core_franchise_id,
      p_resolution_reason, clock_timestamp(), v_actor)
    returning * into v_result;
  end if;

  return v_result;
end;
$function$
;
revoke all on function plm.set_source_resolution(p_source_system text, p_entity_kind text, p_source_id text, p_resolution_status text, p_core_property_id uuid, p_core_character_id uuid, p_core_style_guide_id uuid, p_dam_asset_id uuid, p_resolution_reason text, p_expected_updated_at timestamp with time zone, p_core_licensor_id uuid, p_core_franchise_id uuid) from public, anon, authenticated;
grant execute on function plm.set_source_resolution(p_source_system text, p_entity_kind text, p_source_id text, p_resolution_status text, p_core_property_id uuid, p_core_character_id uuid, p_core_style_guide_id uuid, p_dam_asset_id uuid, p_resolution_reason text, p_expected_updated_at timestamp with time zone, p_core_licensor_id uuid, p_core_franchise_id uuid) to authenticated;
grant execute on function plm.set_source_resolution(p_source_system text, p_entity_kind text, p_source_id text, p_resolution_status text, p_core_property_id uuid, p_core_character_id uuid, p_core_style_guide_id uuid, p_dam_asset_id uuid, p_resolution_reason text, p_expected_updated_at timestamp with time zone, p_core_licensor_id uuid, p_core_franchise_id uuid) to service_role;
CREATE OR REPLACE FUNCTION plm.source_resolution_target_missing(p_entity_kind text, p_core_property_id uuid, p_core_character_id uuid, p_core_style_guide_id uuid, p_dam_asset_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  v_found boolean := false;
begin
  case p_entity_kind
    when 'property' then
      if to_regclass('core.property') is null then return true; end if;
      execute 'select true from core.property where id = $1' into v_found using p_core_property_id;
    when 'character' then
      if to_regclass('core.character') is null then return true; end if;
      execute 'select true from core.character where id = $1' into v_found using p_core_character_id;
    when 'style_guide' then
      if to_regclass('core.style_guide') is null then return true; end if;
      execute 'select true from core.style_guide where id = $1' into v_found using p_core_style_guide_id;
    when 'asset' then
      if to_regclass('dam.asset') is null then return true; end if;
      execute 'select true from dam.asset where id = $1' into v_found using p_dam_asset_id;
    else
      return true;
  end case;
  return not coalesce(v_found, false);
end;
$function$
;
revoke all on function plm.source_resolution_target_missing(p_entity_kind text, p_core_property_id uuid, p_core_character_id uuid, p_core_style_guide_id uuid, p_dam_asset_id uuid) from public, anon, authenticated;
grant execute on function plm.source_resolution_target_missing(p_entity_kind text, p_core_property_id uuid, p_core_character_id uuid, p_core_style_guide_id uuid, p_dam_asset_id uuid) to authenticated;
grant execute on function plm.source_resolution_target_missing(p_entity_kind text, p_core_property_id uuid, p_core_character_id uuid, p_core_style_guide_id uuid, p_dam_asset_id uuid) to service_role;
CREATE OR REPLACE FUNCTION plm.source_resolution_target_missing(p_entity_kind text, p_core_property_id uuid, p_core_character_id uuid, p_core_style_guide_id uuid, p_dam_asset_id uuid, p_core_licensor_id uuid, p_core_franchise_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  v_found boolean := false;
begin
  case p_entity_kind
    when 'property' then
      if to_regclass('core.property') is null then return true; end if;
      execute 'select true from core.property where id = $1'
        into v_found using p_core_property_id;
    when 'character' then
      if to_regclass('core.character') is null then return true; end if;
      execute 'select true from core.character where id = $1'
        into v_found using p_core_character_id;
    when 'style_guide' then
      if to_regclass('core.style_guide') is null then return true; end if;
      execute 'select true from core.style_guide where id = $1'
        into v_found using p_core_style_guide_id;
    when 'asset' then
      if to_regclass('dam.asset') is null then return true; end if;
      execute 'select true from dam.asset where id = $1'
        into v_found using p_dam_asset_id;
    when 'licensor' then
      if to_regclass('core.licensor') is null then return true; end if;
      execute 'select true from core.licensor where id = $1'
        into v_found using p_core_licensor_id;
    when 'franchise' then
      if to_regclass('core.franchise') is null then return true; end if;
      execute 'select true from core.franchise where id = $1'
        into v_found using p_core_franchise_id;
    else
      return true;
  end case;

  return not coalesce(v_found, false);
end;
$function$
;
revoke all on function plm.source_resolution_target_missing(p_entity_kind text, p_core_property_id uuid, p_core_character_id uuid, p_core_style_guide_id uuid, p_dam_asset_id uuid, p_core_licensor_id uuid, p_core_franchise_id uuid) from public, anon, authenticated;
grant execute on function plm.source_resolution_target_missing(p_entity_kind text, p_core_property_id uuid, p_core_character_id uuid, p_core_style_guide_id uuid, p_dam_asset_id uuid, p_core_licensor_id uuid, p_core_franchise_id uuid) to authenticated;
grant execute on function plm.source_resolution_target_missing(p_entity_kind text, p_core_property_id uuid, p_core_character_id uuid, p_core_style_guide_id uuid, p_dam_asset_id uuid, p_core_licensor_id uuid, p_core_franchise_id uuid) to service_role;
CREATE OR REPLACE FUNCTION plm.prepack_role(p_item_no text, p_company_code text, p_division_code text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  -- 'head' wins over 'member': the two sets are disjoint in practice, but a
  -- head that also carried a member code is still an orderable carton.
  select case
    when exists (
      select 1
      from coldlion.prod_history_component component
      where btrim(component.prepack_item_no) = btrim(p_item_no)
        and nullif(btrim(component.prepack_item_no), '') is not null
    ) then 'head'
    when exists (
      select 1
      from coldlion.item_detail detail
      where detail.company_code = p_company_code
        and detail.division_code = p_division_code
        and btrim(detail.item_no) = btrim(p_item_no)
        and nullif(btrim(detail.pre_pack_code), '') is not null
    ) then 'member'
    else null
  end;
$function$
;
revoke all on function plm.prepack_role(p_item_no text, p_company_code text, p_division_code text) from public, anon, authenticated;
grant execute on function plm.prepack_role(p_item_no text, p_company_code text, p_division_code text) to authenticated;
grant execute on function plm.prepack_role(p_item_no text, p_company_code text, p_division_code text) to service_role;
grant execute on function plm.prepack_role(p_item_no text, p_company_code text, p_division_code text) to supabase_read_only_user;
CREATE OR REPLACE FUNCTION plm.dam_order_tracking_allowed_header_keys()
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
  select array['sent_po_date','vendor_delivery_date','booking_state','etd','eta','container_booking_group','mbl','close_tracking']::text[];
$function$
;
revoke all on function plm.dam_order_tracking_allowed_header_keys() from public, anon, authenticated;
grant execute on function plm.dam_order_tracking_allowed_header_keys() to authenticated;
grant execute on function plm.dam_order_tracking_allowed_header_keys() to service_role;


