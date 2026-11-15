-- #6356 sandbox catch-up batch 7: DesignFlow sandbox (xupnyeifmpsacrqahwwm) ONLY. Never apply to shared preview or production.
-- Ports core franchise, canonical edge and factory tables, current-state views and guard functions from production.
-- derived-from: none

set check_function_bodies = off;

-- core.property_character_associations and core.style_guide_character already exist on the sandbox without the lifecycle columns production has.
-- The two enforcement triggers (lock_relationship_pair, require_direct_support) are deferred: the sandbox has no
-- support-edge rows yet, so require_direct_support would reject sandbox writes. Tracked on #6356.
alter table core.property_character_associations add column if not exists is_current boolean default true not null;
alter table core.property_character_associations add column if not exists retired_at timestamp with time zone;
alter table core.property_character_associations add column if not exists retired_reason text;
alter table core.property_character_associations add constraint property_character_associations_lifecycle_chk CHECK (((is_current AND (retired_at IS NULL) AND (retired_reason IS NULL)) OR ((NOT is_current) AND (retired_at IS NOT NULL) AND (NULLIF(btrim(retired_reason), ''::text) IS NOT NULL))));
alter table core.style_guide_character add column if not exists is_current boolean default true not null;
alter table core.style_guide_character add column if not exists retired_at timestamp with time zone;
alter table core.style_guide_character add column if not exists retired_reason text;
alter table core.style_guide_character add constraint style_guide_character_lifecycle_chk CHECK (((is_current AND (retired_at IS NULL) AND (retired_reason IS NULL)) OR ((NOT is_current) AND (retired_at IS NOT NULL) AND (NULLIF(btrim(retired_reason), ''::text) IS NOT NULL))));

create table if not exists core.franchise (
  "id" uuid default gen_random_uuid() not null,
  "licensor_id" uuid not null,
  "name" text not null,
  "code" text,
  "source_system" text not null,
  "source_id" text,
  "source_evidence" text,
  "status" app.entity_status default 'active'::app.entity_status not null,
  "metadata" jsonb default '{}'::jsonb not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "created_by" text,
  "updated_by" text
);
alter table core.franchise add constraint "franchise_code_not_blank" CHECK (((code IS NULL) OR (length(btrim(code)) > 0)));
alter table core.franchise add constraint "franchise_name_normalizes_not_blank" CHECK ((length(core.normalize_popsg_property_observation(name)) > 0));
alter table core.franchise add constraint "franchise_name_not_blank" CHECK ((length(btrim(name)) > 0));
alter table core.franchise add constraint "franchise_pkey" PRIMARY KEY (id);
alter table core.franchise add constraint "franchise_source_id_not_blank" CHECK (((source_id IS NULL) OR (length(btrim(source_id)) > 0)));
alter table core.franchise add constraint "franchise_source_system_not_blank" CHECK ((length(btrim(source_system)) > 0));
CREATE UNIQUE INDEX IF NOT EXISTS franchise_id_licensor_key ON core.franchise USING btree (id, licensor_id);
CREATE UNIQUE INDEX IF NOT EXISTS franchise_licensor_code_key ON core.franchise USING btree (licensor_id, code) WHERE (code IS NOT NULL);
CREATE INDEX IF NOT EXISTS franchise_licensor_idx ON core.franchise USING btree (licensor_id);
CREATE UNIQUE INDEX IF NOT EXISTS franchise_licensor_source_key ON core.franchise USING btree (licensor_id, source_system, source_id) NULLS NOT DISTINCT;
CREATE INDEX IF NOT EXISTS franchise_status_idx ON core.franchise USING btree (status);
alter table core.franchise enable row level security;
create policy "shared_read" on core.franchise as permissive for select to authenticated using (app.has_any_role(ARRAY['administrator'::app.app_role, 'sales'::app.app_role, 'licensing'::app.app_role, 'designer'::app.app_role, 'viewer'::app.app_role, 'vendor'::app.app_role]));
comment on table core.franchise is 'Canonical Franchise entity (issue #2333, successor to #1090). Identity is source-scoped: (licensor_id, source_system, source_id). Licensor is part of the key because integer source ids collide across licensors. Names are descriptive, never identity. Source-specific landing evidence such as plm.pmt_franchise remains the raw record; this table is the cross-application canonical entity. Browser roles are read-only. No curated rows are seeded by the creating migration.';
create table if not exists core.franchise_alias (
  "id" uuid default gen_random_uuid() not null,
  "franchise_id" uuid not null,
  "licensor_id" uuid not null,
  "alias" text not null,
  "normalized_alias" text generated always as (core.normalize_popsg_property_observation(alias)) stored,
  "source_system" text,
  "evidence_notes" text,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "created_by" text,
  "updated_by" text
);
alter table core.franchise_alias add constraint "franchise_alias_alias_not_blank" CHECK ((length(btrim(alias)) > 0));
alter table core.franchise_alias add constraint "franchise_alias_normalized_not_blank" CHECK ((length(core.normalize_popsg_property_observation(alias)) > 0));
alter table core.franchise_alias add constraint "franchise_alias_pkey" PRIMARY KEY (id);
CREATE INDEX IF NOT EXISTS franchise_alias_franchise_idx ON core.franchise_alias USING btree (franchise_id);
CREATE UNIQUE INDEX IF NOT EXISTS franchise_alias_licensor_norm_key ON core.franchise_alias USING btree (licensor_id, normalized_alias);
alter table core.franchise_alias enable row level security;
create policy "shared_read" on core.franchise_alias as permissive for select to authenticated using (app.has_any_role(ARRAY['administrator'::app.app_role, 'sales'::app.app_role, 'licensing'::app.app_role, 'designer'::app.app_role, 'viewer'::app.app_role, 'vendor'::app.app_role]));
comment on table core.franchise_alias is 'Observed strings resolving to a canonical core.franchise. Normalization is source-neutral: it reuses core.normalize_popsg_property_observation (contract popsg-property-observation-v1) rather than adding a second normalizer. Uniqueness is scoped to the licensor, and the composite foreign key (franchise_id, licensor_id) makes a cross-licensor alias unrepresentable. Browser roles are read-only.';
create table if not exists core.property_franchise (
  "property_id" uuid not null,
  "franchise_id" uuid not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "is_current" boolean default true not null,
  "retired_at" timestamp with time zone,
  "retired_reason" text
);
alter table core.property_franchise add constraint "property_franchise_lifecycle_chk" CHECK (((is_current AND (retired_at IS NULL) AND (retired_reason IS NULL)) OR ((NOT is_current) AND (retired_at IS NOT NULL) AND (NULLIF(btrim(retired_reason), ''::text) IS NOT NULL))));
alter table core.property_franchise add constraint "property_franchise_pkey" PRIMARY KEY (property_id, franchise_id);
CREATE INDEX IF NOT EXISTS property_franchise_franchise_id_idx ON core.property_franchise USING btree (franchise_id);
alter table core.property_franchise enable row level security;
create policy "shared_read" on core.property_franchise as permissive for select to authenticated using (app.has_any_role(ARRAY['administrator'::app.app_role, 'sales'::app.app_role, 'licensing'::app.app_role, 'designer'::app.app_role, 'viewer'::app.app_role, 'vendor'::app.app_role]));
comment on table core.property_franchise is 'Canonical direct property <-> franchise relationship (issue #2334). Which franchise a property sits under. This is exactly the edge that plm.pmt_property_franchise_evidence refuses to assert, because Paramount only ever exposed it as asset co-occurrence. A row may exist only while core.property_franchise_source_edge holds a CURRENT direct source assertion for the same pair; inferred and co-occurrence evidence never reach this table. Endpoint deletion is RESTRICT, so a property or franchise cannot be deleted out from under a stated relationship. No role may write here -- canonical edges are written only by a governed migration. Seeded empty: #2334 authorizes no relationship rows.';
create table if not exists core.property_franchise_source_edge (
  "id" uuid default gen_random_uuid() not null,
  "property_id" uuid not null,
  "franchise_id" uuid not null,
  "licensor_id" uuid not null,
  "source_system" text not null,
  "source_id" text,
  "source_evidence" text,
  "evidence_kind" core.relationship_evidence_kind not null,
  "is_direct_source_relationship" boolean generated always as ((evidence_kind = 'direct_source_assertion'::core.relationship_evidence_kind)) stored,
  "observation_count" integer default 0 not null,
  "confidence" numeric(5,4),
  "is_current" boolean default true not null,
  "superseded_at" timestamp with time zone,
  "superseded_reason" text,
  "metadata" jsonb default '{}'::jsonb not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "created_by" text,
  "updated_by" text
);
alter table core.property_franchise_source_edge add constraint "property_franchise_source_edge_confidence_range" CHECK (((confidence IS NULL) OR ((confidence >= (0)::numeric) AND (confidence <= (1)::numeric))));
alter table core.property_franchise_source_edge add constraint "property_franchise_source_edge_direct_has_no_confidence" CHECK (((evidence_kind <> 'direct_source_assertion'::core.relationship_evidence_kind) OR ((confidence IS NULL) AND (observation_count = 0))));
alter table core.property_franchise_source_edge add constraint "property_franchise_source_edge_observation_count_non_negative" CHECK ((observation_count >= 0));
alter table core.property_franchise_source_edge add constraint "property_franchise_source_edge_pkey" PRIMARY KEY (id);
alter table core.property_franchise_source_edge add constraint "property_franchise_source_edge_source_id_not_blank" CHECK (((source_id IS NULL) OR (length(btrim(source_id)) > 0)));
alter table core.property_franchise_source_edge add constraint "property_franchise_source_edge_source_system_not_blank" CHECK ((length(btrim(source_system)) > 0));
alter table core.property_franchise_source_edge add constraint "property_franchise_source_edge_superseded_reason_only_when_supe" CHECK (((superseded_reason IS NULL) OR (superseded_at IS NOT NULL)));
alter table core.property_franchise_source_edge add constraint "property_franchise_source_edge_supersession_consistent" CHECK ((is_current = (superseded_at IS NULL)));
CREATE UNIQUE INDEX IF NOT EXISTS property_franchise_source_edge_current_claim_key ON core.property_franchise_source_edge USING btree (property_id, franchise_id, licensor_id, source_system, evidence_kind) WHERE is_current;
CREATE INDEX IF NOT EXISTS property_franchise_source_edge_direct_current_idx ON core.property_franchise_source_edge USING btree (property_id, franchise_id) WHERE (is_current AND (evidence_kind = 'direct_source_assertion'::core.relationship_evidence_kind));
CREATE INDEX IF NOT EXISTS property_franchise_source_edge_franchise_id_idx ON core.property_franchise_source_edge USING btree (franchise_id);
CREATE INDEX IF NOT EXISTS property_franchise_source_edge_licensor_idx ON core.property_franchise_source_edge USING btree (licensor_id);
CREATE INDEX IF NOT EXISTS property_franchise_source_edge_property_id_idx ON core.property_franchise_source_edge USING btree (property_id);
CREATE INDEX IF NOT EXISTS property_franchise_source_edge_source_retirement_idx ON core.property_franchise_source_edge USING btree (source_system, id) WHERE (is_current AND (evidence_kind = 'direct_source_assertion'::core.relationship_evidence_kind));
alter table core.property_franchise_source_edge enable row level security;
create policy "shared_read" on core.property_franchise_source_edge as permissive for select to authenticated using (app.has_any_role(ARRAY['administrator'::app.app_role, 'sales'::app.app_role, 'licensing'::app.app_role, 'designer'::app.app_role, 'viewer'::app.app_role, 'vendor'::app.app_role]));
comment on table core.property_franchise_source_edge is 'Per-source support evidence for the property <-> franchise relationship (issue #2334). Supports the canonical bridge core.property_franchise, created alongside it. One row is one source system''s claim about one pair under one licensor. evidence_kind keeps direct, inferred and co-occurrence claims as DISTINCT facts that are never merged; only a current direct_source_assertion may support a canonical edge. Withdrawing a claim is supersession, never deletion, and deleting current support -- directly or by cascade -- is refused. Seeded empty: #2334 authorizes no licensed evidence.';
create table if not exists core.property_character_source_edge (
  "id" uuid default gen_random_uuid() not null,
  "property_id" uuid not null,
  "character_id" uuid not null,
  "licensor_id" uuid not null,
  "source_system" text not null,
  "source_id" text,
  "source_evidence" text,
  "evidence_kind" core.relationship_evidence_kind not null,
  "is_direct_source_relationship" boolean generated always as ((evidence_kind = 'direct_source_assertion'::core.relationship_evidence_kind)) stored,
  "observation_count" integer default 0 not null,
  "confidence" numeric(5,4),
  "is_current" boolean default true not null,
  "superseded_at" timestamp with time zone,
  "superseded_reason" text,
  "metadata" jsonb default '{}'::jsonb not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "created_by" text,
  "updated_by" text
);
alter table core.property_character_source_edge add constraint "property_character_source_edge_confidence_range" CHECK (((confidence IS NULL) OR ((confidence >= (0)::numeric) AND (confidence <= (1)::numeric))));
alter table core.property_character_source_edge add constraint "property_character_source_edge_direct_has_no_confidence" CHECK (((evidence_kind <> 'direct_source_assertion'::core.relationship_evidence_kind) OR ((confidence IS NULL) AND (observation_count = 0))));
alter table core.property_character_source_edge add constraint "property_character_source_edge_observation_count_non_negative" CHECK ((observation_count >= 0));
alter table core.property_character_source_edge add constraint "property_character_source_edge_pkey" PRIMARY KEY (id);
alter table core.property_character_source_edge add constraint "property_character_source_edge_source_id_not_blank" CHECK (((source_id IS NULL) OR (length(btrim(source_id)) > 0)));
alter table core.property_character_source_edge add constraint "property_character_source_edge_source_system_not_blank" CHECK ((length(btrim(source_system)) > 0));
alter table core.property_character_source_edge add constraint "property_character_source_edge_superseded_reason_only_when_supe" CHECK (((superseded_reason IS NULL) OR (superseded_at IS NOT NULL)));
alter table core.property_character_source_edge add constraint "property_character_source_edge_supersession_consistent" CHECK ((is_current = (superseded_at IS NULL)));
CREATE INDEX IF NOT EXISTS property_character_source_edge_character_id_idx ON core.property_character_source_edge USING btree (character_id);
CREATE UNIQUE INDEX IF NOT EXISTS property_character_source_edge_current_claim_key ON core.property_character_source_edge USING btree (property_id, character_id, licensor_id, source_system, evidence_kind) WHERE is_current;
CREATE INDEX IF NOT EXISTS property_character_source_edge_direct_current_idx ON core.property_character_source_edge USING btree (property_id, character_id) WHERE (is_current AND (evidence_kind = 'direct_source_assertion'::core.relationship_evidence_kind));
CREATE INDEX IF NOT EXISTS property_character_source_edge_licensor_idx ON core.property_character_source_edge USING btree (licensor_id);
CREATE INDEX IF NOT EXISTS property_character_source_edge_property_id_idx ON core.property_character_source_edge USING btree (property_id);
CREATE INDEX IF NOT EXISTS property_character_source_edge_source_retirement_idx ON core.property_character_source_edge USING btree (source_system, id) WHERE (is_current AND (evidence_kind = 'direct_source_assertion'::core.relationship_evidence_kind));
alter table core.property_character_source_edge enable row level security;
create policy "shared_read" on core.property_character_source_edge as permissive for select to authenticated using (app.has_any_role(ARRAY['administrator'::app.app_role, 'sales'::app.app_role, 'licensing'::app.app_role, 'designer'::app.app_role, 'viewer'::app.app_role, 'vendor'::app.app_role]));
comment on table core.property_character_source_edge is 'Per-source support evidence for the property <-> character relationship (issue #2334). Supports core.property_character_associations, which already existed on main and is deliberately left unaltered. One row is one source system''s claim about one pair under one licensor. evidence_kind keeps direct, inferred and co-occurrence claims as DISTINCT facts that are never merged; only a current direct_source_assertion may support a canonical edge. Withdrawing a claim is supersession, never deletion, and deleting current support -- directly or by cascade -- is refused. Seeded empty: #2334 authorizes no licensed evidence.';
create table if not exists core.property_site_path (
  "id" uuid default gen_random_uuid() not null,
  "property_id" uuid not null,
  "licensor_site" text not null,
  "site_property_name" text not null,
  "site_property_id" text,
  "site_character_name" text,
  "site_character_id" text,
  "ordinal" integer default 1 not null,
  "source_evidence" text not null,
  "is_current" boolean default true not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);
alter table core.property_site_path add constraint "property_site_path_licensor_site_check" CHECK ((licensor_site = ANY (ARRAY['disney_opa'::text, 'wb'::text, 'nbcu'::text, 'sega'::text, 'pmt_trackerplus'::text])));
alter table core.property_site_path add constraint "property_site_path_ordinal_check" CHECK ((ordinal >= 1));
alter table core.property_site_path add constraint "property_site_path_pkey" PRIMARY KEY (id);
alter table core.property_site_path add constraint "property_site_path_site_character_name_check" CHECK (((site_character_name IS NULL) OR (btrim(site_character_name) <> ''::text)));
alter table core.property_site_path add constraint "property_site_path_site_property_name_check" CHECK ((btrim(site_property_name) <> ''::text));
alter table core.property_site_path add constraint "property_site_path_source_evidence_check" CHECK ((btrim(source_evidence) <> ''::text));
CREATE UNIQUE INDEX IF NOT EXISTS property_site_path_path_key ON core.property_site_path USING btree (property_id, licensor_site, site_property_name, COALESCE(site_character_name, ''::text));
CREATE INDEX IF NOT EXISTS property_site_path_lookup_idx ON core.property_site_path USING btree (property_id, licensor_site) WHERE is_current;
alter table core.property_site_path enable row level security;
create policy "shared_read" on core.property_site_path as permissive for select to authenticated using (app.has_any_role(ARRAY['administrator'::app.app_role, 'sales'::app.app_role, 'licensing'::app.app_role, 'designer'::app.app_role, 'viewer'::app.app_role, 'vendor'::app.app_role]));
comment on table core.property_site_path is 'Exact licensor-site path (site property, optional character) per Property/MG06 value, for AI-filled licensor submissions (shared-db#6150).';
create table if not exists core.property_style_guide (
  "property_id" uuid not null,
  "style_guide_id" uuid not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "is_current" boolean default true not null,
  "retired_at" timestamp with time zone,
  "retired_reason" text
);
alter table core.property_style_guide add constraint "property_style_guide_lifecycle_chk" CHECK (((is_current AND (retired_at IS NULL) AND (retired_reason IS NULL)) OR ((NOT is_current) AND (retired_at IS NOT NULL) AND (NULLIF(btrim(retired_reason), ''::text) IS NOT NULL))));
alter table core.property_style_guide add constraint "property_style_guide_pkey" PRIMARY KEY (property_id, style_guide_id);
CREATE INDEX IF NOT EXISTS property_style_guide_style_guide_id_idx ON core.property_style_guide USING btree (style_guide_id);
alter table core.property_style_guide enable row level security;
create policy "shared_read" on core.property_style_guide as permissive for select to authenticated using (app.has_any_role(ARRAY['administrator'::app.app_role, 'sales'::app.app_role, 'licensing'::app.app_role, 'designer'::app.app_role, 'viewer'::app.app_role, 'vendor'::app.app_role]));
comment on table core.property_style_guide is 'Canonical direct property <-> style guide relationship (issue #2334). Which style guides a licensor publishes for a property. Royalty and approval decisions cite the style guide, so this edge must be licensor-asserted, never guessed. A row may exist only while core.property_style_guide_source_edge holds a CURRENT direct source assertion for the same pair; inferred and co-occurrence evidence never reach this table. Endpoint deletion is RESTRICT, so a property or style_guide cannot be deleted out from under a stated relationship. No role may write here -- canonical edges are written only by a governed migration. Seeded empty: #2334 authorizes no relationship rows.';
create table if not exists core.property_style_guide_source_edge (
  "id" uuid default gen_random_uuid() not null,
  "property_id" uuid not null,
  "style_guide_id" uuid not null,
  "licensor_id" uuid not null,
  "source_system" text not null,
  "source_id" text,
  "source_evidence" text,
  "evidence_kind" core.relationship_evidence_kind not null,
  "is_direct_source_relationship" boolean generated always as ((evidence_kind = 'direct_source_assertion'::core.relationship_evidence_kind)) stored,
  "observation_count" integer default 0 not null,
  "confidence" numeric(5,4),
  "is_current" boolean default true not null,
  "superseded_at" timestamp with time zone,
  "superseded_reason" text,
  "metadata" jsonb default '{}'::jsonb not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "created_by" text,
  "updated_by" text
);
alter table core.property_style_guide_source_edge add constraint "property_style_guide_source_edge_confidence_range" CHECK (((confidence IS NULL) OR ((confidence >= (0)::numeric) AND (confidence <= (1)::numeric))));
alter table core.property_style_guide_source_edge add constraint "property_style_guide_source_edge_direct_has_no_confidence" CHECK (((evidence_kind <> 'direct_source_assertion'::core.relationship_evidence_kind) OR ((confidence IS NULL) AND (observation_count = 0))));
alter table core.property_style_guide_source_edge add constraint "property_style_guide_source_edge_observation_count_non_negative" CHECK ((observation_count >= 0));
alter table core.property_style_guide_source_edge add constraint "property_style_guide_source_edge_pkey" PRIMARY KEY (id);
alter table core.property_style_guide_source_edge add constraint "property_style_guide_source_edge_source_id_not_blank" CHECK (((source_id IS NULL) OR (length(btrim(source_id)) > 0)));
alter table core.property_style_guide_source_edge add constraint "property_style_guide_source_edge_source_system_not_blank" CHECK ((length(btrim(source_system)) > 0));
alter table core.property_style_guide_source_edge add constraint "property_style_guide_source_edge_superseded_reason_only_when_su" CHECK (((superseded_reason IS NULL) OR (superseded_at IS NOT NULL)));
alter table core.property_style_guide_source_edge add constraint "property_style_guide_source_edge_supersession_consistent" CHECK ((is_current = (superseded_at IS NULL)));
CREATE UNIQUE INDEX IF NOT EXISTS property_style_guide_source_edge_current_claim_key ON core.property_style_guide_source_edge USING btree (property_id, style_guide_id, licensor_id, source_system, evidence_kind) WHERE is_current;
CREATE INDEX IF NOT EXISTS property_style_guide_source_edge_direct_current_idx ON core.property_style_guide_source_edge USING btree (property_id, style_guide_id) WHERE (is_current AND (evidence_kind = 'direct_source_assertion'::core.relationship_evidence_kind));
CREATE INDEX IF NOT EXISTS property_style_guide_source_edge_licensor_idx ON core.property_style_guide_source_edge USING btree (licensor_id);
CREATE INDEX IF NOT EXISTS property_style_guide_source_edge_property_id_idx ON core.property_style_guide_source_edge USING btree (property_id);
CREATE INDEX IF NOT EXISTS property_style_guide_source_edge_source_retirement_idx ON core.property_style_guide_source_edge USING btree (source_system, id) WHERE (is_current AND (evidence_kind = 'direct_source_assertion'::core.relationship_evidence_kind));
CREATE INDEX IF NOT EXISTS property_style_guide_source_edge_style_guide_id_idx ON core.property_style_guide_source_edge USING btree (style_guide_id);
alter table core.property_style_guide_source_edge enable row level security;
create policy "shared_read" on core.property_style_guide_source_edge as permissive for select to authenticated using (app.has_any_role(ARRAY['administrator'::app.app_role, 'sales'::app.app_role, 'licensing'::app.app_role, 'designer'::app.app_role, 'viewer'::app.app_role, 'vendor'::app.app_role]));
comment on table core.property_style_guide_source_edge is 'Per-source support evidence for the property <-> style guide relationship (issue #2334). Supports the canonical bridge core.property_style_guide, created alongside it. One row is one source system''s claim about one pair under one licensor. evidence_kind keeps direct, inferred and co-occurrence claims as DISTINCT facts that are never merged; only a current direct_source_assertion may support a canonical edge. Withdrawing a claim is supersession, never deletion, and deleting current support -- directly or by cascade -- is refused. Seeded empty: #2334 authorizes no licensed evidence.';
create table if not exists core.style_guide_character_source_edge (
  "id" uuid default gen_random_uuid() not null,
  "style_guide_id" uuid not null,
  "character_id" uuid not null,
  "licensor_id" uuid not null,
  "source_system" text not null,
  "source_id" text,
  "source_evidence" text,
  "evidence_kind" core.relationship_evidence_kind not null,
  "is_direct_source_relationship" boolean generated always as ((evidence_kind = 'direct_source_assertion'::core.relationship_evidence_kind)) stored,
  "observation_count" integer default 0 not null,
  "confidence" numeric(5,4),
  "is_current" boolean default true not null,
  "superseded_at" timestamp with time zone,
  "superseded_reason" text,
  "metadata" jsonb default '{}'::jsonb not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "created_by" text,
  "updated_by" text
);
alter table core.style_guide_character_source_edge add constraint "style_guide_character_source_edge_confidence_range" CHECK (((confidence IS NULL) OR ((confidence >= (0)::numeric) AND (confidence <= (1)::numeric))));
alter table core.style_guide_character_source_edge add constraint "style_guide_character_source_edge_direct_has_no_confidence" CHECK (((evidence_kind <> 'direct_source_assertion'::core.relationship_evidence_kind) OR ((confidence IS NULL) AND (observation_count = 0))));
alter table core.style_guide_character_source_edge add constraint "style_guide_character_source_edge_observation_count_non_negativ" CHECK ((observation_count >= 0));
alter table core.style_guide_character_source_edge add constraint "style_guide_character_source_edge_pkey" PRIMARY KEY (id);
alter table core.style_guide_character_source_edge add constraint "style_guide_character_source_edge_source_id_not_blank" CHECK (((source_id IS NULL) OR (length(btrim(source_id)) > 0)));
alter table core.style_guide_character_source_edge add constraint "style_guide_character_source_edge_source_system_not_blank" CHECK ((length(btrim(source_system)) > 0));
alter table core.style_guide_character_source_edge add constraint "style_guide_character_source_edge_superseded_reason_only_when_s" CHECK (((superseded_reason IS NULL) OR (superseded_at IS NOT NULL)));
alter table core.style_guide_character_source_edge add constraint "style_guide_character_source_edge_supersession_consistent" CHECK ((is_current = (superseded_at IS NULL)));
CREATE INDEX IF NOT EXISTS style_guide_character_source_edge_character_id_idx ON core.style_guide_character_source_edge USING btree (character_id);
CREATE UNIQUE INDEX IF NOT EXISTS style_guide_character_source_edge_current_claim_key ON core.style_guide_character_source_edge USING btree (style_guide_id, character_id, licensor_id, source_system, evidence_kind) WHERE is_current;
CREATE INDEX IF NOT EXISTS style_guide_character_source_edge_direct_current_idx ON core.style_guide_character_source_edge USING btree (style_guide_id, character_id) WHERE (is_current AND (evidence_kind = 'direct_source_assertion'::core.relationship_evidence_kind));
CREATE INDEX IF NOT EXISTS style_guide_character_source_edge_licensor_idx ON core.style_guide_character_source_edge USING btree (licensor_id);
CREATE INDEX IF NOT EXISTS style_guide_character_source_edge_source_retirement_idx ON core.style_guide_character_source_edge USING btree (source_system, id) WHERE (is_current AND (evidence_kind = 'direct_source_assertion'::core.relationship_evidence_kind));
CREATE INDEX IF NOT EXISTS style_guide_character_source_edge_style_guide_id_idx ON core.style_guide_character_source_edge USING btree (style_guide_id);
alter table core.style_guide_character_source_edge enable row level security;
create policy "shared_read" on core.style_guide_character_source_edge as permissive for select to authenticated using (app.has_any_role(ARRAY['administrator'::app.app_role, 'sales'::app.app_role, 'licensing'::app.app_role, 'designer'::app.app_role, 'viewer'::app.app_role, 'vendor'::app.app_role]));
comment on table core.style_guide_character_source_edge is 'Per-source support evidence for the style guide <-> character relationship (issue #2334). Supports core.style_guide_character, which already existed on main and is deliberately left unaltered. One row is one source system''s claim about one pair under one licensor. evidence_kind keeps direct, inferred and co-occurrence claims as DISTINCT facts that are never merged; only a current direct_source_assertion may support a canonical edge. Withdrawing a claim is supersession, never deletion, and deleting current support -- directly or by cascade -- is refused. Seeded empty: #2334 authorizes no licensed evidence.';
create table if not exists core.factory_product_category (
  "factory_id" uuid not null,
  "product_category_id" uuid not null,
  "rank" smallint not null,
  "created_at" timestamp with time zone default now() not null
);
alter table core.factory_product_category add constraint "factory_product_category_factory_id_rank_key" UNIQUE (factory_id, rank);
alter table core.factory_product_category add constraint "factory_product_category_pkey" PRIMARY KEY (factory_id, product_category_id);
alter table core.factory_product_category add constraint "factory_product_category_rank_check" CHECK (((rank >= 1) AND (rank <= 5)));
alter table core.factory_product_category enable row level security;
create policy "admin_write" on core.factory_product_category as permissive for all to authenticated using (app.has_role('administrator'::app.app_role)) with check (app.has_role('administrator'::app.app_role));
create policy "shared_read" on core.factory_product_category as permissive for select to authenticated using (app.has_any_role(ARRAY['administrator'::app.app_role, 'sales'::app.app_role, 'licensing'::app.app_role, 'designer'::app.app_role, 'viewer'::app.app_role, 'vendor'::app.app_role]));
comment on table core.factory_product_category is 'Up to five product categories per factory, in the owner''s order.';
create table if not exists core.factory_rep (
  "id" uuid default gen_random_uuid() not null,
  "factory_id" uuid not null,
  "name" text not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);
alter table core.factory_rep add constraint "factory_rep_factory_id_name_key" UNIQUE (factory_id, name);
alter table core.factory_rep add constraint "factory_rep_pkey" PRIMARY KEY (id);
alter table core.factory_rep enable row level security;
create policy "admin_write" on core.factory_rep as permissive for all to authenticated using (app.has_role('administrator'::app.app_role)) with check (app.has_role('administrator'::app.app_role));
create policy "shared_read" on core.factory_rep as permissive for select to authenticated using (app.has_any_role(ARRAY['administrator'::app.app_role, 'sales'::app.app_role, 'licensing'::app.app_role, 'designer'::app.app_role, 'viewer'::app.app_role, 'vendor'::app.app_role]));
comment on table core.factory_rep is 'Named sales reps POP deals with at a factory.';
create table if not exists core.factory_representation (
  "trading_company_id" uuid not null,
  "factory_id" uuid not null,
  "created_at" timestamp with time zone default now() not null
);
alter table core.factory_representation add constraint "factory_representation_check" CHECK ((trading_company_id <> factory_id));
alter table core.factory_representation add constraint "factory_representation_pkey" PRIMARY KEY (trading_company_id, factory_id);
CREATE INDEX IF NOT EXISTS factory_representation_factory_idx ON core.factory_representation USING btree (factory_id);
alter table core.factory_representation enable row level security;
create policy "admin_write" on core.factory_representation as permissive for all to authenticated using (app.has_role('administrator'::app.app_role)) with check (app.has_role('administrator'::app.app_role));
create policy "shared_read" on core.factory_representation as permissive for select to authenticated using (app.has_any_role(ARRAY['administrator'::app.app_role, 'sales'::app.app_role, 'licensing'::app.app_role, 'designer'::app.app_role, 'viewer'::app.app_role, 'vendor'::app.app_role]));
comment on table core.factory_representation is 'Trading company -> factory it represents. No row = POP deals with the factory directly.';
create table if not exists core.factory_vendor_login (
  "designflow_login_id" integer not null,
  "factory_id" uuid not null,
  "person" text,
  "email" text,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);
alter table core.factory_vendor_login add constraint "factory_vendor_login_pkey" PRIMARY KEY (designflow_login_id);
CREATE INDEX IF NOT EXISTS factory_vendor_login_factory_idx ON core.factory_vendor_login USING btree (factory_id);
alter table core.factory_vendor_login enable row level security;
create policy "admin_write" on core.factory_vendor_login as permissive for all to authenticated using (app.has_role('administrator'::app.app_role)) with check (app.has_role('administrator'::app.app_role));
comment on table core.factory_vendor_login is 'DesignFlow vendor logins the owner kept (2026-10-27), and the factory each belongs to. Emails: administrators only.';
alter table core.franchise add constraint "franchise_licensor_id_fkey" FOREIGN KEY (licensor_id) REFERENCES core.licensor(id) ON DELETE RESTRICT;
alter table core.franchise_alias add constraint "franchise_alias_franchise_fkey" FOREIGN KEY (franchise_id, licensor_id) REFERENCES core.franchise(id, licensor_id) ON DELETE RESTRICT;
alter table core.property_franchise add constraint "property_franchise_franchise_id_fkey" FOREIGN KEY (franchise_id) REFERENCES core.franchise(id) ON UPDATE CASCADE ON DELETE RESTRICT;
alter table core.property_franchise add constraint "property_franchise_property_id_fkey" FOREIGN KEY (property_id) REFERENCES core.property(id) ON UPDATE CASCADE ON DELETE RESTRICT;
alter table core.property_franchise_source_edge add constraint "property_franchise_source_edge_franchise_id_fkey" FOREIGN KEY (franchise_id) REFERENCES core.franchise(id) ON UPDATE CASCADE ON DELETE CASCADE;
alter table core.property_franchise_source_edge add constraint "property_franchise_source_edge_licensor_id_fkey" FOREIGN KEY (licensor_id) REFERENCES core.licensor(id) ON DELETE RESTRICT;
alter table core.property_franchise_source_edge add constraint "property_franchise_source_edge_property_id_fkey" FOREIGN KEY (property_id) REFERENCES core.property(id) ON UPDATE CASCADE ON DELETE CASCADE;
alter table core.property_character_source_edge add constraint "property_character_source_edge_character_id_fkey" FOREIGN KEY (character_id) REFERENCES core.character(id) ON UPDATE CASCADE ON DELETE CASCADE;
alter table core.property_character_source_edge add constraint "property_character_source_edge_licensor_id_fkey" FOREIGN KEY (licensor_id) REFERENCES core.licensor(id) ON DELETE RESTRICT;
alter table core.property_character_source_edge add constraint "property_character_source_edge_property_id_fkey" FOREIGN KEY (property_id) REFERENCES core.property(id) ON UPDATE CASCADE ON DELETE CASCADE;
alter table core.property_site_path add constraint "property_site_path_property_id_fkey" FOREIGN KEY (property_id) REFERENCES core.property(id) ON DELETE CASCADE;
alter table core.property_style_guide add constraint "property_style_guide_property_id_fkey" FOREIGN KEY (property_id) REFERENCES core.property(id) ON UPDATE CASCADE ON DELETE RESTRICT;
alter table core.property_style_guide add constraint "property_style_guide_style_guide_id_fkey" FOREIGN KEY (style_guide_id) REFERENCES core.style_guide(id) ON UPDATE CASCADE ON DELETE RESTRICT;
alter table core.property_style_guide_source_edge add constraint "property_style_guide_source_edge_licensor_id_fkey" FOREIGN KEY (licensor_id) REFERENCES core.licensor(id) ON DELETE RESTRICT;
alter table core.property_style_guide_source_edge add constraint "property_style_guide_source_edge_property_id_fkey" FOREIGN KEY (property_id) REFERENCES core.property(id) ON UPDATE CASCADE ON DELETE CASCADE;
alter table core.property_style_guide_source_edge add constraint "property_style_guide_source_edge_style_guide_id_fkey" FOREIGN KEY (style_guide_id) REFERENCES core.style_guide(id) ON UPDATE CASCADE ON DELETE CASCADE;
alter table core.style_guide_character_source_edge add constraint "style_guide_character_source_edge_character_id_fkey" FOREIGN KEY (character_id) REFERENCES core.character(id) ON UPDATE CASCADE ON DELETE CASCADE;
alter table core.style_guide_character_source_edge add constraint "style_guide_character_source_edge_licensor_id_fkey" FOREIGN KEY (licensor_id) REFERENCES core.licensor(id) ON DELETE RESTRICT;
alter table core.style_guide_character_source_edge add constraint "style_guide_character_source_edge_style_guide_id_fkey" FOREIGN KEY (style_guide_id) REFERENCES core.style_guide(id) ON UPDATE CASCADE ON DELETE CASCADE;
alter table core.factory_product_category add constraint "factory_product_category_factory_id_fkey" FOREIGN KEY (factory_id) REFERENCES core.factory(id) ON DELETE CASCADE;
alter table core.factory_product_category add constraint "factory_product_category_product_category_id_fkey" FOREIGN KEY (product_category_id) REFERENCES core.product_category(id) ON DELETE RESTRICT;
alter table core.factory_rep add constraint "factory_rep_factory_id_fkey" FOREIGN KEY (factory_id) REFERENCES core.factory(id) ON DELETE CASCADE;
alter table core.factory_representation add constraint "factory_representation_factory_id_fkey" FOREIGN KEY (factory_id) REFERENCES core.factory(id) ON DELETE CASCADE;
alter table core.factory_representation add constraint "factory_representation_trading_company_id_fkey" FOREIGN KEY (trading_company_id) REFERENCES core.factory(id) ON DELETE CASCADE;
alter table core.factory_vendor_login add constraint "factory_vendor_login_factory_id_fkey" FOREIGN KEY (factory_id) REFERENCES core.factory(id) ON DELETE CASCADE;
-- view core.property_character_associations_current options={security_invoker=true} acl={postgres=arwdDxtm/postgres,authenticated=r/postgres,service_role=r/postgres}
create or replace view core.property_character_associations_current with (security_invoker=true) as
 SELECT property_id,
    character_id,
    created_at,
    updated_at,
    is_current,
    retired_at,
    retired_reason
   FROM core.property_character_associations
  WHERE is_current;;
revoke all on core.property_character_associations_current from public, anon;
grant select on core.property_character_associations_current to authenticated;
grant select on core.property_character_associations_current to service_role;
-- view core.property_franchise_current options={security_invoker=true} acl={postgres=arwdDxtm/postgres,authenticated=r/postgres,service_role=r/postgres}
create or replace view core.property_franchise_current with (security_invoker=true) as
 SELECT property_id,
    franchise_id,
    created_at,
    updated_at,
    is_current,
    retired_at,
    retired_reason
   FROM core.property_franchise
  WHERE is_current;;
revoke all on core.property_franchise_current from public, anon;
grant select on core.property_franchise_current to authenticated;
grant select on core.property_franchise_current to service_role;
-- view core.property_style_guide_current options={security_invoker=true} acl={postgres=arwdDxtm/postgres,authenticated=r/postgres,service_role=r/postgres}
create or replace view core.property_style_guide_current with (security_invoker=true) as
 SELECT property_id,
    style_guide_id,
    created_at,
    updated_at,
    is_current,
    retired_at,
    retired_reason
   FROM core.property_style_guide
  WHERE is_current;;
revoke all on core.property_style_guide_current from public, anon;
grant select on core.property_style_guide_current to authenticated;
grant select on core.property_style_guide_current to service_role;
-- view core.style_guide_character_current options={security_invoker=true} acl={postgres=arwdDxtm/postgres,authenticated=r/postgres,service_role=r/postgres}
create or replace view core.style_guide_character_current with (security_invoker=true) as
 SELECT style_guide_id,
    character_id,
    metadata,
    created_at,
    is_current,
    retired_at,
    retired_reason
   FROM core.style_guide_character
  WHERE is_current;;
revoke all on core.style_guide_character_current from public, anon;
grant select on core.style_guide_character_current to authenticated;
grant select on core.style_guide_character_current to service_role;

CREATE OR REPLACE FUNCTION core.assert_canonical_edge_still_supported()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
declare
  v_bridge    text := tg_argv[0];   -- fully qualified canonical bridge table
  v_left_col  text := tg_argv[1];
  v_right_col text := tg_argv[2];
  v_left      uuid;
  v_right     uuid;
  v_bridged   boolean;
  v_supported boolean;
begin
  -- Only the loss of a current direct assertion can orphan anything.
  if not (old.is_current and old.evidence_kind = 'direct_source_assertion') then
    return null;
  end if;

  if tg_op = 'UPDATE'
     and new.is_current
     and new.evidence_kind = 'direct_source_assertion'
     and (to_jsonb(new) ->> v_left_col) is not distinct from (to_jsonb(old) ->> v_left_col)
     and (to_jsonb(new) ->> v_right_col) is not distinct from (to_jsonb(old) ->> v_right_col) then
    return null;
  end if;

  v_left  := (to_jsonb(old) ->> v_left_col)::uuid;
  v_right := (to_jsonb(old) ->> v_right_col)::uuid;

  execute format(
    'select exists (select 1 from %s b where b.%I = $1 and b.%I = $2 and b.is_current)',
    v_bridge, v_left_col, v_right_col)
  into v_bridged
  using v_left, v_right;

  if not v_bridged then
    return null;
  end if;

  -- At COMMIT the whole transaction is visible, so this sees the true end state: any
  -- replacement recorded anywhere in the transaction counts, and every withdrawal in it
  -- has already been applied.
  execute format(
    'select exists (select 1 from %I.%I s where s.%I = $1 and s.%I = $2 '
    'and s.is_current '
    'and s.evidence_kind = ''direct_source_assertion''::core.relationship_evidence_kind)',
    tg_table_schema, tg_table_name, v_left_col, v_right_col)
  into v_supported
  using v_left, v_right;

  if v_supported then
    return null;
  end if;

  raise exception
    'Refused at commit: the canonical edge in % (% = %, % = %) would be left with no current '
    'direct source assertion in %.%. Every direct assertion behind it was withdrawn or removed '
    'in this transaction. Record the replacing direct assertion in the same transaction, or '
    'retire the retained canonical summary in the same transaction.',
    v_bridge, v_left_col, v_left, v_right_col, v_right,
    tg_table_schema, tg_table_name
    using errcode = 'P0001';
end;
$function$
;
revoke all on function core.assert_canonical_edge_still_supported() from public, anon, authenticated;
CREATE OR REPLACE FUNCTION core.bump_taxonomy_source_ref_last_seen()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'core', 'pg_catalog'
AS $function$
begin
  if new.missing_since is null
     and (
       -- The ordinary case: the caller named no last_seen_at of its own.
       new.last_seen_at is not distinct from old.last_seen_at
       -- THE LEGACY ROW. A pre-#2355 row carries last_seen_at NULL, and the identity
       -- guard -- which runs first -- has just back-filled it from old.created_at.
       -- Compared against the OLD null that looks exactly like "the caller supplied a
       -- value", so without this branch the FIRST re-assertion on every grandfathered
       -- row (the production path for all of them) would record created_at, often years
       -- old, and a freshness job would read live evidence as "the source dropped this".
       -- Only the guard's own back-fill is recognised here -- it always leaves
       -- last_seen_at equal to first_seen_at -- so a caller that genuinely names a
       -- last_seen_at is still respected, and greatest() can never move the column back.
       or (old.last_seen_at is null
           and new.last_seen_at is not distinct from new.first_seen_at)
     ) then
    new.last_seen_at := greatest(new.last_seen_at, now());
  end if;
  return new;
end
$function$
;
revoke all on function core.bump_taxonomy_source_ref_last_seen() from public, anon, authenticated;
CREATE OR REPLACE FUNCTION core.contact_attach_customer_by_email()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_customer uuid;
begin
  if new.email is null or position('@' in new.email) = 0 then
    return null;
  end if;
  if exists (select 1 from core.contact_company cc where cc.contact_id = new.id) then
    return null;
  end if;
  v_customer := crm.match_ingested_domain_customer(split_part(lower(btrim(new.email)), '@', 2));
  if v_customer is not null then
    insert into core.contact_company (contact_id, company_id, metadata)
    values (new.id, v_customer, jsonb_build_object('source', 'email_domain_auto'))
    on conflict do nothing;
  end if;
  return null;
end;
$function$
;
revoke all on function core.contact_attach_customer_by_email() from public, anon, authenticated;
CREATE OR REPLACE FUNCTION core.customer_attach_contacts_by_domain()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_cd text;
begin
  -- Same normalisation as crm.match_ingested_domain_customer.
  v_cd := lower(trim(both '.' from regexp_replace(btrim(coalesce(new.domain, '')), '^(https?://)?(www\.)?([^/:?#]*).*$', '\3', 'i')));
  if nullif(v_cd, '') is null then
    return null;
  end if;
  -- Prefilter to contacts whose email domain is this domain or a subdomain of
  -- it, so the matcher (uniqueness check) runs only on real candidates.
  insert into core.contact_company (contact_id, company_id, metadata)
  select c.id, new.id, jsonb_build_object('source', 'email_domain_auto')
  from (
    select ct.id, split_part(lower(btrim(ct.email)), '@', 2) as d
    from core.contact ct
    where position('@' in coalesce(ct.email, '')) > 0
      and not exists (select 1 from core.contact_company cc where cc.contact_id = ct.id)
  ) c
  where (c.d = v_cd or c.d like '%.' || v_cd)
    and crm.match_ingested_domain_customer(c.d) = new.id
  on conflict do nothing;
  return null;
end;
$function$
;
revoke all on function core.customer_attach_contacts_by_domain() from public, anon, authenticated;
CREATE OR REPLACE FUNCTION core.guard_taxonomy_source_ref_identity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'core', 'pg_catalog'
AS $function$
declare
  v_target_regclass regclass;
  v_target_exists   boolean;
  v_derived         uuid;
  v_old_derived     uuid;
  v_target_changed  boolean;
  v_source_changed  boolean;
  v_licensor_changed boolean;
  v_licensor_scoped constant text[] := array['licensor', 'property', 'character', 'franchise'];
begin
  -- WHAT THIS WRITE ACTUALLY TOUCHES. Every rule below is scoped to the part of the row
  -- it governs. An UPDATE that only records freshness (last_seen_at, missing_since) must
  -- stay possible on a pre-#2355 row, including one whose source key or target was never
  -- filled in properly -- otherwise the very writes this migration exists to make would
  -- be refused on exactly the legacy rows that need them.
  v_target_changed := tg_op = 'INSERT'
    or (old.entity_schema, old.entity_table, old.entity_id)
         is distinct from (new.entity_schema, new.entity_table, new.entity_id);

  v_source_changed := tg_op = 'INSERT'
    or (old.source_system, old.source_table, old.source_id)
         is distinct from (new.source_system, new.source_table, new.source_id);

  v_licensor_changed := tg_op = 'INSERT'
    or old.source_licensor_id is distinct from new.source_licensor_id;

  -- Blank strings are not identifiers. A blank source_id in particular is the classic
  -- way a whole feed collapses onto one provenance row. Checked on INSERT and on any
  -- write that actually SETS these columns -- never on a freshness-only update, which
  -- would otherwise freeze every legacy row that already carries a blank key.
  if v_target_changed then
    if new.entity_schema is null or length(btrim(new.entity_schema)) = 0 then
      raise exception 'core.taxonomy_source_ref refused: entity_schema must be a real schema name'
        using errcode = 'P0001';
    end if;
    if new.entity_table is null or length(btrim(new.entity_table)) = 0 then
      raise exception 'core.taxonomy_source_ref refused: entity_table must be a real table name'
        using errcode = 'P0001';
    end if;
  end if;

  if v_source_changed then
    if new.source_system is null or length(btrim(new.source_system)) = 0
       or new.source_table is null or length(btrim(new.source_table)) = 0
       or new.source_id is null or length(btrim(new.source_id)) = 0 then
      raise exception
        'core.taxonomy_source_ref refused: source_system, source_table and source_id must all be non-blank -- provenance without a named source is not provenance'
        using errcode = 'P0001';
    end if;
  end if;

  -- TARGET SHAPE, FOR EVERY KIND. entity_id is an untyped uuid, so for an arbitrary
  -- schema/table the most that can be checked here is that the TABLE is real and the uuid
  -- is present. Whether a ROW with that uuid exists is checked further down, and only for
  -- the four licensor-scoped core kinds -- see ROW-EXISTENCE IS SCOPED in the header.
  -- Checked only when the target actually changes, so pre-existing rows whose target has
  -- since been retired remain editable for their freshness fields.
  if v_target_changed then
    v_target_regclass := to_regclass(
      quote_ident(btrim(new.entity_schema)) || '.' || quote_ident(btrim(new.entity_table)));
    if v_target_regclass is null then
      raise exception
        'core.taxonomy_source_ref refused: entity_schema/entity_table %.% is not a real table',
        new.entity_schema, new.entity_table
        using errcode = 'P0001';
    end if;
    if new.entity_id is null then
      raise exception 'core.taxonomy_source_ref refused: entity_id must name a row'
        using errcode = 'P0001';
    end if;
  end if;

  -- COLLISION-PROOF SOURCE IDENTITY. Derive the licensor the provenance actually belongs
  -- to, from the entity it points at. A supplied value is checked, never trusted.
  -- Scoped exactly like the target-integrity check above. Re-deriving on EVERY write
  -- would mean a target that has since been re-licensed (or orphaned) makes every later
  -- write to its provenance row fail -- including the missing_since / last_seen_at writes
  -- this change exists to make -- because the derived licensor no longer matches the
  -- licensor already stamped on the row, which the immutability rule below forbids
  -- changing. So it runs only when the write actually touches the target or the licensor.
  if (v_target_changed or v_licensor_changed)
     and btrim(new.entity_schema) = 'core' and btrim(new.entity_table) = any (v_licensor_scoped) then
    -- Static, one branch per licensor-scoped kind. No dynamic SQL: the set of kinds
    -- that carry a licensor is a settled business fact, not a runtime lookup, and a
    -- statically written branch is the only form a reviewer can verify by reading it.
    case btrim(new.entity_table)
      when 'licensor' then
        select l.id into v_derived from core.licensor l where l.id = new.entity_id;
      when 'property' then
        select p.licensor_id into v_derived from core.property p where p.id = new.entity_id;
      when 'character' then
        select c.licensor_id into v_derived from core.character c where c.id = new.entity_id;
      when 'franchise' then
        select f.licensor_id into v_derived from core.franchise f where f.id = new.entity_id;
    end case;
    v_target_exists := found;

    -- ROW EXISTENCE, FOR THESE FOUR KINDS ONLY. The derivation select above already had
    -- to visit the target row, so FOUND answers "does it exist?" for free. This is the
    -- ONLY place row existence is checked: a provenance row pointing at a nonexistent
    -- uuid in any other table is accepted, by the decision recorded in the header.
    -- Checked only when the target actually changes, so pre-existing rows whose target
    -- has since been retired stay editable for their freshness fields.
    if v_target_changed and not v_target_exists then
      raise exception
        'core.taxonomy_source_ref refused: no row % in %.% -- provenance may not point at a non-existent entity',
        new.entity_id, new.entity_schema, new.entity_table
        using errcode = 'P0001';
    end if;

    -- A NULL DERIVED LICENSOR IS A FACT, NOT A FAULT. core.property.licensor_id is
    -- nullable and orphan properties exist by design, so refusing here would convert
    -- writes this table accepts today into hard failures. The derived value -- null
    -- included -- is what gets recorded. A caller-supplied value is still never trusted:
    -- it must equal the derived one, and when the entity has no licensor at all the only
    -- honest supplied value is none.
    if new.source_licensor_id is distinct from v_derived then
      if new.source_licensor_id is null then
        new.source_licensor_id := v_derived;
      elsif v_derived is null then
        raise exception
          'core.taxonomy_source_ref refused: source_licensor_id % was supplied, but %.% row % has no licensor of its own -- provenance may not be attributed to a licensor the entity does not belong to',
          new.source_licensor_id, new.entity_schema, new.entity_table, new.entity_id
          using errcode = 'P0001';
      else
        raise exception
          'core.taxonomy_source_ref refused: source_licensor_id % disagrees with the licensor % of the entity it points at',
          new.source_licensor_id, v_derived
          using errcode = 'P0001';
      end if;
    end if;
  end if;

  -- THE ANTI-COLLISION RULE. The pre-existing unique key
  -- (source_system, source_table, source_id) is global, and every importer upserts into
  -- it with `do update set entity_id = excluded.entity_id`. Left alone, a second licensor
  -- reusing the same small integer id would quietly capture the first licensor's
  -- provenance row. Once a row's licensor is known it is immutable: the second licensor
  -- gets an error instead of the first licensor's evidence.
  if tg_op = 'UPDATE'
     and old.source_licensor_id is not null
     and new.source_licensor_id is distinct from old.source_licensor_id then
    raise exception
      'core.taxonomy_source_ref refused: (%, %, %) is already licensor %''s provenance; repointing it to licensor % would attribute one licensor''s entity to another. Source ids collide across licensors -- record a separate row.',
      new.source_system, new.source_table, new.source_id,
      old.source_licensor_id, new.source_licensor_id
      using errcode = 'P0001';
  end if;

  -- THE SAME RULE FOR THE ROWS WE GRANDFATHERED. Every pre-#2355 row carries
  -- source_licensor_id null, so the rule above -- which keys off the OLD licensor --
  -- has nothing to compare against on the FIRST conflicting upsert, and the block
  -- higher up would simply stamp the incoming licensor onto the stolen row. Those
  -- legacy rows are precisely the ones a colliding importer reaches first, so the
  -- owner is re-derived from the OLD target instead. Deliberately silent when the old
  -- target is gone or was never licensor-scoped: a row whose old entity has since been
  -- retired stays editable for its freshness fields, exactly as before.
  if tg_op = 'UPDATE'
     and old.source_licensor_id is null
     and new.source_licensor_id is not null
     and v_target_changed
     and btrim(old.entity_schema) = 'core'
     and btrim(old.entity_table) = any (v_licensor_scoped) then
    case btrim(old.entity_table)
      when 'licensor' then
        select l.id into v_old_derived from core.licensor l where l.id = old.entity_id;
      when 'property' then
        select p.licensor_id into v_old_derived from core.property p where p.id = old.entity_id;
      when 'character' then
        select c.licensor_id into v_old_derived from core.character c where c.id = old.entity_id;
      when 'franchise' then
        select f.licensor_id into v_old_derived from core.franchise f where f.id = old.entity_id;
    end case;

    if v_old_derived is not null and v_old_derived <> new.source_licensor_id then
      raise exception
        'core.taxonomy_source_ref refused: (%, %, %) is licensor %''s provenance by the entity it already points at; repointing it to licensor % would attribute one licensor''s entity to another. Source ids collide across licensors -- record a separate row.',
        new.source_system, new.source_table, new.source_id,
        v_old_derived, new.source_licensor_id
        using errcode = 'P0001';
    end if;
  end if;

  -- FRESHNESS. Filled here rather than by column defaults so that an explicit null from
  -- an importer still produces a usable row, and so first_seen_at can never be moved
  -- forward by a later sighting.
  if tg_op = 'INSERT' then
    new.first_seen_at := coalesce(new.first_seen_at, now());
    new.last_seen_at  := coalesce(new.last_seen_at, new.first_seen_at);
  else
    new.first_seen_at := coalesce(new.first_seen_at, old.first_seen_at, old.created_at);
    new.last_seen_at  := coalesce(new.last_seen_at, old.last_seen_at, new.first_seen_at);
    if old.first_seen_at is not null and new.first_seen_at > old.first_seen_at then
      -- "First seen" is a fact about the past. A later observation updates last_seen_at.
      new.first_seen_at := old.first_seen_at;
    end if;
    -- last_seen_at is NOT advanced here. Advancing it on every update would log a
    -- metadata-only correction as a fresh source sighting. The advance lives in
    -- core.bump_taxonomy_source_ref_last_seen, whose trigger fires only when the
    -- source-facing columns are actually re-supplied.
  end if;

  return new;
end
$function$
;
revoke all on function core.guard_taxonomy_source_ref_identity() from public, anon, authenticated;
CREATE OR REPLACE FUNCTION core.lock_canonical_relationship_pair()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
declare v_keys text[] := array[]::text[]; v_key text;
begin
 if tg_op <> 'INSERT' then v_keys := array_append(v_keys,tg_argv[0]||':'||(to_jsonb(old)->>tg_argv[1])||':'||(to_jsonb(old)->>tg_argv[2])); end if;
 if tg_op <> 'DELETE' then v_keys := array_append(v_keys,tg_argv[0]||':'||(to_jsonb(new)->>tg_argv[1])||':'||(to_jsonb(new)->>tg_argv[2])); end if;
 for v_key in select distinct k from unnest(v_keys) k order by k loop
  if v_key is null then raise exception 'relationship pair lock requires nonnull exact endpoints'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_key,0));
 end loop;
 if tg_op='DELETE' then return old; end if; return new;
end $function$
;
revoke all on function core.lock_canonical_relationship_pair() from public, anon, authenticated;
CREATE OR REPLACE FUNCTION core.refuse_delete_of_current_support_edge()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
begin
  -- Deliberately blind to WHY the delete is happening. It fires the same for a direct
  -- DELETE and for a cascade arriving from a deleted bridge row or a deleted endpoint
  -- entity, which is what makes endpoint deletion fail closed on the three pre-existing
  -- bridges whose own foreign keys this migration must not alter.
  if old.is_current then
    raise exception
      'Refused: %.% still holds CURRENT % support for this relationship (support edge %). '
      'Deleting it -- or deleting an endpoint or canonical edge that cascades to it -- would '
      'silently discard licensing evidence a royalty or approval decision may rest on. '
      'Supersede the support edge first (set is_current = false and superseded_at), then '
      'delete.',
      tg_table_schema, tg_table_name, old.evidence_kind, old.id
      using errcode = 'P0001';
  end if;
  return old;
end;
$function$
;
revoke all on function core.refuse_delete_of_current_support_edge() from public, anon, authenticated;
CREATE OR REPLACE FUNCTION core.require_direct_support_for_canonical_edge()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
declare
  v_support   text := tg_argv[0];   -- fully qualified support-edge table
  v_left_col  text := tg_argv[1];
  v_right_col text := tg_argv[2];
  v_left      uuid;
  v_right     uuid;
  v_supported boolean;
begin
  if not new.is_current then return new; end if;
  -- to_jsonb rather than a composite parameter: a plpgsql trigger cannot reliably project
  -- a dynamically named column out of NEW, and this keeps one function serving all five
  -- bridges instead of five near-identical copies.
  v_left  := (to_jsonb(new) ->> v_left_col)::uuid;
  v_right := (to_jsonb(new) ->> v_right_col)::uuid;

  execute format(
    'select exists (select 1 from %s s where s.%I = $1 and s.%I = $2 '
    'and s.is_current '
    'and s.evidence_kind = ''direct_source_assertion''::core.relationship_evidence_kind)',
    v_support, v_left_col, v_right_col)
  into v_supported
  using v_left, v_right;

  if not v_supported then
    raise exception
      'Refused: canonical edge %.% (% = %, % = %) has no CURRENT direct source assertion in %. '
      'Inferred and co-occurrence evidence are never promoted to a canonical relationship -- '
      'record the licensor''s own assertion in the support-edge table first.',
      tg_table_schema, tg_table_name, v_left_col, v_left, v_right_col, v_right, v_support
      using errcode = 'P0001';
  end if;

  return new;
end;
$function$
;
revoke all on function core.require_direct_support_for_canonical_edge() from public, anon, authenticated;
CREATE OR REPLACE FUNCTION core.require_support_edge_licensor_matches_endpoints()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
declare
  v_left_table  text := tg_argv[0];   -- fully qualified left endpoint entity table
  v_left_col    text := tg_argv[1];
  v_right_table text := tg_argv[2];   -- fully qualified right endpoint entity table
  v_right_col   text := tg_argv[3];
  v_table       text;
  v_col         text;
  v_endpoint    uuid;
  v_licensor    uuid;
  v_new         jsonb;
  v_old         jsonb;
  i             integer;
begin
  -- Round-5 review finding: serialize the row ONCE, not once per endpoint.
  v_new := to_jsonb(new);

  -- Round-6 review finding (High). This check is scoped to writes that actually SET the
  -- columns it governs -- the two endpoint references and licensor_id -- exactly as
  -- core.guard_taxonomy_source_ref_identity() scopes its own rules, and for the same
  -- reason. Endpoint re-licensing is routine and permitted: an endpoint entity may move to
  -- a different licensor_id long after this support row was recorded. An unscoped guard
  -- re-derives both endpoints' CURRENT licensors on every UPDATE, so once an endpoint
  -- moves, every later write to the historical support row is refused -- including the
  -- documented withdrawal path (is_current = false, superseded_at = ...), supersession and
  -- ordinary metadata corrections. The row could then never record its own withdrawal, the
  -- stale assertion would stay current forever, its canonical bridge could never be
  -- retired, and where the two endpoints end up under different licensors NO value of
  -- licensor_id could satisfy the guard at all -- leaving the rewriting of licensor_id on a
  -- historical row as the only escape, which falsifies exactly the attribution this guard
  -- exists to protect. So: enforced on INSERT, and on any UPDATE that changes an endpoint
  -- or the licensor; never on a write that leaves all three alone.
  if tg_op = 'UPDATE' then
    v_old := to_jsonb(old);
    if (v_new ->> v_left_col) is not distinct from (v_old ->> v_left_col)
       and (v_new ->> v_right_col) is not distinct from (v_old ->> v_right_col)
       and new.licensor_id is not distinct from old.licensor_id then
      return new;
    end if;
  end if;

  for i in 0..1 loop
    if i = 0 then
      v_table := v_left_table;
      v_col   := v_left_col;
    else
      v_table := v_right_table;
      v_col   := v_right_col;
    end if;

    -- A jsonb projection for the same reason as the guards above: one function serves all
    -- eight support-edge tables instead of eight near-identical copies.
    v_endpoint := (v_new ->> v_col)::uuid;

    execute format('select e.licensor_id from %s e where e.id = $1', v_table)
      into v_licensor
      using v_endpoint;

    if v_licensor is not null and v_licensor <> new.licensor_id then
      raise exception
        'Refused: this %.% row is filed under licensor %, but its endpoint % = % in % belongs '
        'to licensor %. Filing one licensor''s relationship under another licensor''s id '
        'misattributes royalties and approvals -- record the claim under the licensor that '
        'actually owns the endpoints.',
        tg_table_schema, tg_table_name, new.licensor_id, v_col, v_endpoint, v_table, v_licensor
        using errcode = 'P0001';
    end if;
  end loop;

  return new;
end;
$function$
;
revoke all on function core.require_support_edge_licensor_matches_endpoints() from public, anon, authenticated;

CREATE TRIGGER set_updated_at BEFORE UPDATE ON core.franchise FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON core.franchise_alias FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER lock_relationship_pair BEFORE INSERT OR DELETE OR UPDATE ON core.property_franchise FOR EACH ROW EXECUTE FUNCTION core.lock_canonical_relationship_pair('core.property_franchise', 'property_id', 'franchise_id');
CREATE TRIGGER require_direct_support BEFORE INSERT OR UPDATE ON core.property_franchise FOR EACH ROW EXECUTE FUNCTION core.require_direct_support_for_canonical_edge('core.property_franchise_source_edge', 'property_id', 'franchise_id');
CREATE TRIGGER set_updated_at BEFORE UPDATE ON core.property_franchise FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER lock_relationship_pair BEFORE INSERT OR DELETE OR UPDATE ON core.property_franchise_source_edge FOR EACH ROW EXECUTE FUNCTION core.lock_canonical_relationship_pair('core.property_franchise', 'property_id', 'franchise_id');
CREATE TRIGGER refuse_delete_of_current_support BEFORE DELETE ON core.property_franchise_source_edge FOR EACH ROW EXECUTE FUNCTION core.refuse_delete_of_current_support_edge();
CREATE TRIGGER require_matching_licensor BEFORE INSERT OR UPDATE ON core.property_franchise_source_edge FOR EACH ROW EXECUTE FUNCTION core.require_support_edge_licensor_matches_endpoints('core.property', 'property_id', 'core.franchise', 'franchise_id');
CREATE TRIGGER set_updated_at BEFORE UPDATE ON core.property_franchise_source_edge FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER lock_relationship_pair BEFORE INSERT OR DELETE OR UPDATE ON core.property_character_source_edge FOR EACH ROW EXECUTE FUNCTION core.lock_canonical_relationship_pair('core.property_character_associations', 'property_id', 'character_id');
CREATE TRIGGER refuse_delete_of_current_support BEFORE DELETE ON core.property_character_source_edge FOR EACH ROW EXECUTE FUNCTION core.refuse_delete_of_current_support_edge();
CREATE TRIGGER require_matching_licensor BEFORE INSERT OR UPDATE ON core.property_character_source_edge FOR EACH ROW EXECUTE FUNCTION core.require_support_edge_licensor_matches_endpoints('core.property', 'property_id', 'core.character', 'character_id');
CREATE TRIGGER set_updated_at BEFORE UPDATE ON core.property_character_source_edge FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON core.property_site_path FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER lock_relationship_pair BEFORE INSERT OR DELETE OR UPDATE ON core.property_style_guide FOR EACH ROW EXECUTE FUNCTION core.lock_canonical_relationship_pair('core.property_style_guide', 'property_id', 'style_guide_id');
CREATE TRIGGER require_direct_support BEFORE INSERT OR UPDATE ON core.property_style_guide FOR EACH ROW EXECUTE FUNCTION core.require_direct_support_for_canonical_edge('core.property_style_guide_source_edge', 'property_id', 'style_guide_id');
CREATE TRIGGER set_updated_at BEFORE UPDATE ON core.property_style_guide FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER lock_relationship_pair BEFORE INSERT OR DELETE OR UPDATE ON core.property_style_guide_source_edge FOR EACH ROW EXECUTE FUNCTION core.lock_canonical_relationship_pair('core.property_style_guide', 'property_id', 'style_guide_id');
CREATE TRIGGER refuse_delete_of_current_support BEFORE DELETE ON core.property_style_guide_source_edge FOR EACH ROW EXECUTE FUNCTION core.refuse_delete_of_current_support_edge();
CREATE TRIGGER require_matching_licensor BEFORE INSERT OR UPDATE ON core.property_style_guide_source_edge FOR EACH ROW EXECUTE FUNCTION core.require_support_edge_licensor_matches_endpoints('core.property', 'property_id', 'core.style_guide', 'style_guide_id');
CREATE TRIGGER set_updated_at BEFORE UPDATE ON core.property_style_guide_source_edge FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER lock_relationship_pair BEFORE INSERT OR DELETE OR UPDATE ON core.style_guide_character_source_edge FOR EACH ROW EXECUTE FUNCTION core.lock_canonical_relationship_pair('core.style_guide_character', 'style_guide_id', 'character_id');
CREATE TRIGGER refuse_delete_of_current_support BEFORE DELETE ON core.style_guide_character_source_edge FOR EACH ROW EXECUTE FUNCTION core.refuse_delete_of_current_support_edge();
CREATE TRIGGER require_matching_licensor BEFORE INSERT OR UPDATE ON core.style_guide_character_source_edge FOR EACH ROW EXECUTE FUNCTION core.require_support_edge_licensor_matches_endpoints('core.style_guide', 'style_guide_id', 'core.character', 'character_id');
CREATE TRIGGER set_updated_at BEFORE UPDATE ON core.style_guide_character_source_edge FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON core.factory_rep FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON core.factory_vendor_login FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE CONSTRAINT TRIGGER assert_canonical_edge_still_supported AFTER DELETE OR UPDATE ON core.property_franchise_source_edge DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION core.assert_canonical_edge_still_supported('core.property_franchise', 'property_id', 'franchise_id');
CREATE CONSTRAINT TRIGGER assert_canonical_edge_still_supported AFTER DELETE OR UPDATE ON core.property_character_source_edge DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION core.assert_canonical_edge_still_supported('core.property_character_associations', 'property_id', 'character_id');
CREATE CONSTRAINT TRIGGER assert_canonical_edge_still_supported AFTER DELETE OR UPDATE ON core.property_style_guide_source_edge DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION core.assert_canonical_edge_still_supported('core.property_style_guide', 'property_id', 'style_guide_id');
CREATE CONSTRAINT TRIGGER assert_canonical_edge_still_supported AFTER DELETE OR UPDATE ON core.style_guide_character_source_edge DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION core.assert_canonical_edge_still_supported('core.style_guide_character', 'style_guide_id', 'character_id');
