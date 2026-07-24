-- Phase 1 — ColdLion licensor/property additive mirror + review schema only.
-- Plan: fix_coldlion_licensor_property_cutover.md (Phase 1).
--
-- What this does
-- --------------
-- Additive groundwork so ColdLion licensed-division licensor/property rows can be
-- mirrored and reconciled without a Phase-1 importer mutating canonical rows:
--
--   0. ENFORCE exact-one parent: core.property.licensor_id NOT NULL + FK
--      ON DELETE RESTRICT (same constraint name property_licensor_id_fkey).
--      Loud preflight aborts if any null parent exists (preview evidence: 256/0).
--   1. Extend existing all-division header dictionary plm.merch_group_header
--      (no second dictionary) + unique semantic key for mirror FKs.
--   2. Typed mirrors plm.erp_licensor / plm.erp_property keyed by composite
--      natural key (company_code, division_code, mg_type_code, mg_code), with
--      FK to header semantic key so type meaning cannot be faked.
--   3. Durable resolution review with typed proposed/resolved FKs and honest
--      canonical-only findings (nullable source keys when finding_scope requires).
--   4. Read-only reconciliation views (identity / status / parent evidence;
--      item co-occurrence is evidence only; raw payloads never exposed).
--   5. SELECT-only for browser roles; no authenticated write policies.
--
-- What this deliberately does NOT do
-- ----------------------------------
-- * No ColdLion fetch, runner, schedule, or public write wrapper.
-- * No canonical promotion/linking importer, no DesignFlow disablement.
-- * No bulk mutation of core.licensor / core.property rows, status, or UUIDs
--   (aside from the enforced NOT NULL parent constraint itself).
-- * No raw payload dumps into api.* views.
-- * No EAV, no many-to-many licensor↔property bridge.
--
-- Authority (neutral cross-app rule — enforced in the database)
-- ------------------------------------------------------------
-- Every Property has exactly one Licensor via scalar
-- core.property.licensor_id NOT NULL → core.licensor(id) ON DELETE RESTRICT.
-- ColdLion owns source identity and descriptions only. Parent edge and
-- lifecycle status are Supabase-curated.

-- =====================================================================================
-- 0. Enforce scalar NOT NULL parent edge on core.property
-- =====================================================================================

do $$
declare
  null_count integer;
begin
  select count(*) into null_count
  from core.property
  where licensor_id is null;

  if null_count > 0 then
    raise exception
      using message = format(
        'Phase 1 preflight FAILED: core.property has %s row(s) with null licensor_id. '
        'Business rule requires every Property to have exactly one Licensor before '
        'enforcing NOT NULL. Fix orphan properties first (DB Data Admin orphan list), '
        'then re-run this migration. Preview baseline expected 256 rows / 0 nulls.',
        null_count
      ),
      errcode = 'P0001';
  end if;

  raise notice
    'Phase 1 preflight OK: core.property has 0 null licensor_id rows; enforcing NOT NULL + RESTRICT.';
end $$;

-- Preserve constraint name property_licensor_id_fkey; replace ON DELETE SET NULL
-- with ON DELETE RESTRICT and enforce NOT NULL.
alter table core.property drop constraint if exists property_licensor_id_fkey;

alter table core.property
  alter column licensor_id set not null;

alter table core.property
  add constraint property_licensor_id_fkey
  foreign key (licensor_id)
  references core.licensor(id)
  on delete restrict;

comment on column core.property.licensor_id is
  'ENFORCED neutral cross-app authority (Phase 1, 20260724030000): every Property has exactly one Licensor via this scalar NOT NULL FK to core.licensor(id) ON DELETE RESTRICT. Never model as a many-to-many bridge or app-code map. ColdLion does not own this edge; DesignFlow is a temporary comparison/curation source. ColdLion mirror importers must never mutate this column.';

comment on column core.licensor.status is
  'Lifecycle status is Supabase-curated. ColdLion has no active/inactive flag and must never update this column on re-pull (prevents NASA/ZAG/FRIDA-style resurrection).';

comment on column core.property.status is
  'Lifecycle status is Supabase-curated. ColdLion presence/absence must never activate, inactivate, or delete canonical property rows.';

-- =====================================================================================
-- 1. Extend existing all-division header dictionary + semantic unique key
-- =====================================================================================

alter table plm.merch_group_header
  add column if not exists source_hash text,
  add column if not exists last_seen_at timestamptz not null default now(),
  add column if not exists last_sync_run_id uuid references ingest.sync_run(id) on delete set null;

-- Semantic key: division/type meaning. Mirror rows FK here so a row cannot claim
-- mg_type_desc='Licensor' when the header for that (division, mg_type_code) is
-- actually 'Big Theme' (or any other meaning).
alter table plm.merch_group_header
  drop constraint if exists plm_merch_group_header_semantic_key_uidx;

alter table plm.merch_group_header
  add constraint plm_merch_group_header_semantic_key_uidx
  unique (company_code, division_code, mg_type_code, mg_type_desc);

create index if not exists plm_merch_group_header_last_seen_idx
  on plm.merch_group_header (last_seen_at desc);
create index if not exists plm_merch_group_header_last_sync_run_idx
  on plm.merch_group_header (last_sync_run_id);

comment on table plm.merch_group_header is
  'Coldlion all-division merch-group header dictionary. Meaning of mg_type_code is always resolved via (company_code, division_code, mg_type_code) → mg_type_desc. Never interpret mg_type_code globally (CW001/SP001 05=Licensor vs EH001 05=Big Theme). Unique semantic key (company_code, division_code, mg_type_code, mg_type_desc) is the FK target for plm.erp_licensor / plm.erp_property. Single dictionary — do not create a parallel header table.';

comment on column plm.merch_group_header.source_hash is
  'Optional content hash of the source header payload for change detection. Filled by a future header sync; existing rows may be null until re-pulled. Null does not mean unchanged.';

comment on column plm.merch_group_header.last_seen_at is
  'Last-seen timestamp for operational refresh bookkeeping. The NOT NULL DEFAULT now() on column add only stamps existing rows at migration apply time so the column can be NOT NULL — it does NOT prove ColdLion source freshness. Only an importer/sync that sets last_seen_at from a real header snapshot establishes freshness. Do not treat migration-time defaults as evidence of a successful pull.';

comment on column plm.merch_group_header.last_sync_run_id is
  'ingest.sync_run that last refreshed this header row from a real ColdLion snapshot. Null until a sync writes it.';

-- =====================================================================================
-- 2. Typed ColdLion licensor mirror
-- =====================================================================================

create table plm.erp_licensor (
  company_code       text not null,
  division_code      text not null,
  mg_type_code       text not null,
  mg_code            text not null,
  mg_type_desc       text not null,
  name               text not null,
  licensor_id        uuid references core.licensor(id) on delete set null,
  resolution_status  text not null default 'unresolved',
  resolution_reason  text,
  resolved_at        timestamptz,
  resolved_by        text,
  erp_created_at     timestamptz,
  erp_updated_at     timestamptz,
  -- No default: importers must supply the source payload explicitly.
  raw                jsonb not null,
  source_hash        text not null,
  first_seen_at      timestamptz not null default now(),
  last_seen_at       timestamptz not null default now(),
  last_sync_run_id   uuid references ingest.sync_run(id) on delete set null,
  imported_at        timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  primary key (company_code, division_code, mg_type_code, mg_code),
  constraint plm_erp_licensor_header_semantic_fkey
    foreign key (company_code, division_code, mg_type_code, mg_type_desc)
    references plm.merch_group_header (company_code, division_code, mg_type_code, mg_type_desc)
    on delete restrict,
  constraint plm_erp_licensor_mg_type_code_ck
    check (mg_type_code ~ '^[0-9]{2}$'),
  constraint plm_erp_licensor_mg_type_desc_ck
    check (lower(btrim(mg_type_desc)) = 'licensor'),
  constraint plm_erp_licensor_name_ck
    check (btrim(name) <> ''),
  constraint plm_erp_licensor_mg_code_ck
    check (btrim(mg_code) <> ''),
  constraint plm_erp_licensor_resolution_status_ck
    check (resolution_status in (
      'unresolved',
      'auto_matched',
      'manually_matched',
      'new_candidate',
      'ambiguous',
      'quarantined',
      'ignored'
    )),
  constraint plm_erp_licensor_resolution_link_ck
    check (
      (
        resolution_status in ('auto_matched', 'manually_matched')
        and licensor_id is not null
      )
      or (
        resolution_status in (
          'unresolved', 'new_candidate', 'ambiguous', 'quarantined', 'ignored'
        )
        and licensor_id is null
      )
    )
);

comment on table plm.erp_licensor is
  'Typed ColdLion mirror of licensed-division Licensor merch-group details. Natural key is (company_code, division_code, mg_type_code, mg_code) — never mg_code alone. Four-column semantic FK to plm.merch_group_header enforces division/type meaning (cannot claim Licensor when header says Big Theme). Holds source identity/description + resolution state only. Does NOT own lifecycle status or parent edges. Phase 1: schema only; no importer yet.';

comment on column plm.erp_licensor.licensor_id is
  'Optional link to stable core.licensor UUID after approved matching. NULL while unresolved/quarantined. Linking never creates or rewrites the canonical row in Phase 1 (no importer).';
comment on column plm.erp_licensor.resolution_status is
  'Durable match state: unresolved (unmatched), auto_matched, manually_matched (approved-link), new_candidate, ambiguous, quarantined, ignored. Ambiguity and conflict quarantine — never partial auto-success.';
comment on column plm.erp_licensor.raw is
  'Source payload retained for audit inside plm only. NOT NULL with no default so importers cannot silently omit it. Never expose via api.* reconciliation views.';
comment on column plm.erp_licensor.source_hash is
  'Hash of source fields used for idempotent re-pull change detection.';
comment on column plm.erp_licensor.erp_created_at is
  'ColdLion source createdTime — not canonical created_at.';
comment on column plm.erp_licensor.erp_updated_at is
  'ColdLion source modTime — not canonical updated_at.';

create index plm_erp_licensor_canonical_idx
  on plm.erp_licensor (licensor_id)
  where licensor_id is not null;
create index plm_erp_licensor_resolution_idx
  on plm.erp_licensor (resolution_status, division_code);
create index plm_erp_licensor_name_norm_idx
  on plm.erp_licensor (lower(btrim(name)));
create index plm_erp_licensor_last_seen_idx
  on plm.erp_licensor (last_seen_at desc);
create index plm_erp_licensor_last_sync_run_idx
  on plm.erp_licensor (last_sync_run_id);
create index plm_erp_licensor_mg_code_idx
  on plm.erp_licensor (mg_code);

create trigger set_updated_at before update on plm.erp_licensor
  for each row execute function app.set_updated_at();

-- =====================================================================================
-- 3. Typed ColdLion property mirror
-- =====================================================================================

create table plm.erp_property (
  company_code       text not null,
  division_code      text not null,
  mg_type_code       text not null,
  mg_code            text not null,
  mg_type_desc       text not null,
  name               text not null,
  property_id        uuid references core.property(id) on delete set null,
  resolution_status  text not null default 'unresolved',
  resolution_reason  text,
  resolved_at        timestamptz,
  resolved_by        text,
  erp_created_at     timestamptz,
  erp_updated_at     timestamptz,
  -- No default: importers must supply the source payload explicitly.
  raw                jsonb not null,
  source_hash        text not null,
  first_seen_at      timestamptz not null default now(),
  last_seen_at       timestamptz not null default now(),
  last_sync_run_id   uuid references ingest.sync_run(id) on delete set null,
  imported_at        timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  primary key (company_code, division_code, mg_type_code, mg_code),
  constraint plm_erp_property_header_semantic_fkey
    foreign key (company_code, division_code, mg_type_code, mg_type_desc)
    references plm.merch_group_header (company_code, division_code, mg_type_code, mg_type_desc)
    on delete restrict,
  constraint plm_erp_property_mg_type_code_ck
    check (mg_type_code ~ '^[0-9]{2}$'),
  constraint plm_erp_property_mg_type_desc_ck
    check (lower(btrim(mg_type_desc)) = 'property'),
  constraint plm_erp_property_name_ck
    check (btrim(name) <> ''),
  constraint plm_erp_property_mg_code_ck
    check (btrim(mg_code) <> ''),
  constraint plm_erp_property_resolution_status_ck
    check (resolution_status in (
      'unresolved',
      'auto_matched',
      'manually_matched',
      'new_candidate',
      'ambiguous',
      'quarantined',
      'ignored'
    )),
  constraint plm_erp_property_resolution_link_ck
    check (
      (
        resolution_status in ('auto_matched', 'manually_matched')
        and property_id is not null
      )
      or (
        resolution_status in (
          'unresolved', 'new_candidate', 'ambiguous', 'quarantined', 'ignored'
        )
        and property_id is null
      )
    )
);

comment on table plm.erp_property is
  'Typed ColdLion mirror of licensed-division Property merch-group details. Natural key is (company_code, division_code, mg_type_code, mg_code) — never mg_code alone. Four-column semantic FK to plm.merch_group_header enforces division/type meaning. ColdLion has no parent edge: core.property.licensor_id remains Supabase-curated and must not be inferred from item co-occurrence or code collisions (e.g. FR). Phase 1: schema only.';

comment on column plm.erp_property.property_id is
  'Optional link to stable core.property UUID after approved matching. NULL while unresolved/quarantined. Never rewrites core.property.licensor_id or status.';
comment on column plm.erp_property.resolution_status is
  'Durable match state: unresolved (unmatched), auto_matched, manually_matched (approved-link), new_candidate, ambiguous, quarantined, ignored.';
comment on column plm.erp_property.raw is
  'Source payload retained for audit inside plm only. NOT NULL with no default so importers cannot silently omit it. Never expose via api.* reconciliation views.';

create index plm_erp_property_canonical_idx
  on plm.erp_property (property_id)
  where property_id is not null;
create index plm_erp_property_resolution_idx
  on plm.erp_property (resolution_status, division_code);
create index plm_erp_property_name_norm_idx
  on plm.erp_property (lower(btrim(name)));
create index plm_erp_property_last_seen_idx
  on plm.erp_property (last_seen_at desc);
create index plm_erp_property_last_sync_run_idx
  on plm.erp_property (last_sync_run_id);
create index plm_erp_property_mg_code_idx
  on plm.erp_property (mg_code);

create trigger set_updated_at before update on plm.erp_property
  for each row execute function app.set_updated_at();

-- =====================================================================================
-- 4. Durable resolution / review queue (typed FKs; honest canonical-only findings)
-- =====================================================================================
-- Source findings carry the real ColdLion composite key.
-- Canonical-only findings leave source keys NULL and point at the core row via
-- the typed proposed_* column for that entity_type — no fake ColdLion keys.

create table plm.taxonomy_resolution_review (
  id                     uuid primary key default gen_random_uuid(),
  entity_type            text not null,
  finding_scope          text not null,
  company_code           text,
  division_code          text,
  mg_type_code           text,
  mg_code                text,
  source_name            text,
  proposed_licensor_id   uuid references core.licensor(id) on delete set null,
  proposed_property_id   uuid references core.property(id) on delete set null,
  match_method           text,
  confidence             text not null,
  reason                 text not null,
  evidence               jsonb not null default '{}'::jsonb,
  status                 text not null default 'open',
  resolution             text,
  resolved_licensor_id   uuid references core.licensor(id) on delete restrict,
  resolved_property_id   uuid references core.property(id) on delete restrict,
  resolved_by            text,
  resolved_at            timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  constraint plm_taxonomy_resolution_review_entity_type_ck
    check (entity_type in ('licensor', 'property')),

  constraint plm_taxonomy_resolution_review_finding_scope_ck
    check (finding_scope in ('source', 'canonical_only')),

  constraint plm_taxonomy_resolution_review_mg_type_code_ck
    check (mg_type_code is null or mg_type_code ~ '^[0-9]{2}$'),

  constraint plm_taxonomy_resolution_review_confidence_ck
    check (confidence in ('high', 'medium', 'low', 'none')),

  constraint plm_taxonomy_resolution_review_status_ck
    check (status in (
      'open',
      'approved_link',
      'quarantined',
      'conflict',
      'ignored',
      'dismissed'
    )),

  -- Universe of resolution labels (pair with status via status_resolution_ck).
  constraint plm_taxonomy_resolution_review_resolution_ck
    check (
      resolution is null
      or resolution in (
        'approved_link',
        'quarantined',
        'conflict',
        'ignored',
        'unmatched',
        'ambiguous',
        'canonical_only',
        'deferred'
      )
    ),

  constraint plm_taxonomy_resolution_review_reason_ck
    check (btrim(reason) <> ''),

  -- Source findings require real ColdLion composite keys. Canonical-only forbids them.
  constraint plm_taxonomy_resolution_review_scope_keys_ck
    check (
      (
        finding_scope = 'source'
        and company_code is not null
        and division_code is not null
        and mg_type_code is not null
        and mg_code is not null
        and source_name is not null
        and btrim(source_name) <> ''
      )
      or (
        finding_scope = 'canonical_only'
        and company_code is null
        and division_code is null
        and mg_type_code is null
        and mg_code is null
        and source_name is null
      )
    ),

  -- Typed columns by entity_type: licensor reviews never touch property IDs and vice versa.
  constraint plm_taxonomy_resolution_review_entity_columns_ck
    check (
      (
        entity_type = 'licensor'
        and proposed_property_id is null
        and resolved_property_id is null
      )
      or (
        entity_type = 'property'
        and proposed_licensor_id is null
        and resolved_licensor_id is null
      )
    ),

  -- Canonical-only findings must identify the core subject via the typed proposed_* column.
  constraint plm_taxonomy_resolution_review_canonical_only_subject_ck
    check (
      finding_scope <> 'canonical_only'
      or (
        entity_type = 'licensor' and proposed_licensor_id is not null
      )
      or (
        entity_type = 'property' and proposed_property_id is not null
      )
    ),

  -- Status / resolution / resolved-* matrix (enforced together):
  --
  --   status          | resolution (allowed)                         | resolved IDs / by / at
  --   ----------------|----------------------------------------------|----------------------
  --   open            | NULL, unmatched, ambiguous,                  | all null
  --                   |   canonical_only, deferred                   |
  --   quarantined     | NULL, quarantined, unmatched, ambiguous      | all null
  --   conflict        | NULL, conflict                               | all null
  --   ignored         | NULL, ignored                                | all null
  --   dismissed       | NULL, deferred, unmatched, ignored,          | all null
  --                   |   canonical_only                             |
  --   approved_link   | approved_link (required)                     | typed resolved ID
  --                   |                                              | + nonblank resolved_by
  --                   |                                              | + nonnull resolved_at
  --
  -- Non-approved statuses must never carry resolution=approved_link.
  -- A conflict row cannot say resolution=ignored; an ignored row cannot say conflict.
  constraint plm_taxonomy_resolution_review_status_resolution_ck
    check (
      (
        status = 'approved_link'
        and resolution = 'approved_link'
      )
      or (
        status = 'open'
        and (
          resolution is null
          or resolution in (
            'unmatched', 'ambiguous', 'canonical_only', 'deferred'
          )
        )
      )
      or (
        status = 'quarantined'
        and (
          resolution is null
          or resolution in ('quarantined', 'unmatched', 'ambiguous')
        )
      )
      or (
        status = 'conflict'
        and (resolution is null or resolution = 'conflict')
      )
      or (
        status = 'ignored'
        and (resolution is null or resolution = 'ignored')
      )
      or (
        status = 'dismissed'
        and (
          resolution is null
          or resolution in (
            'deferred', 'unmatched', 'ignored', 'canonical_only'
          )
        )
      )
    ),

  -- approved_link requires the full resolution package + correct typed resolved ID.
  -- All non-approved statuses forbid resolved IDs, resolved_by, and resolved_at.
  constraint plm_taxonomy_resolution_review_resolved_link_ck
    check (
      (
        status = 'approved_link'
        and resolution = 'approved_link'
        and resolved_by is not null
        and btrim(resolved_by) <> ''
        and resolved_at is not null
        and (
          (entity_type = 'licensor' and resolved_licensor_id is not null)
          or (entity_type = 'property' and resolved_property_id is not null)
        )
      )
      or (
        status in ('open', 'quarantined', 'conflict', 'ignored', 'dismissed')
        and resolved_licensor_id is null
        and resolved_property_id is null
        and resolved_by is null
        and resolved_at is null
      )
    )
);

-- Active source findings: at most one per typed ColdLion composite key.
-- Active statuses = open | quarantined | conflict (work-queue / still actionable).
-- Justification: only these three still require operator or importer attention.
-- Terminal history = approved_link | ignored | dismissed — deliberately excluded
-- from the partial unique predicate so review history is preserved and a later
-- new finding may open after close-out (without deleting prior rows).
-- A non-partial unique index would incorrectly allow only one finding forever.
create unique index plm_taxonomy_resolution_review_source_uidx
  on plm.taxonomy_resolution_review (
    entity_type, company_code, division_code, mg_type_code, mg_code
  )
  where finding_scope = 'source'
    and status in ('open', 'quarantined', 'conflict');

-- Same active-status rule for canonical-only subjects (preserve history).
create unique index plm_taxonomy_resolution_review_canonical_licensor_uidx
  on plm.taxonomy_resolution_review (proposed_licensor_id)
  where finding_scope = 'canonical_only'
    and entity_type = 'licensor'
    and proposed_licensor_id is not null
    and status in ('open', 'quarantined', 'conflict');

create unique index plm_taxonomy_resolution_review_canonical_property_uidx
  on plm.taxonomy_resolution_review (proposed_property_id)
  where finding_scope = 'canonical_only'
    and entity_type = 'property'
    and proposed_property_id is not null
    and status in ('open', 'quarantined', 'conflict');

-- Indexes live in schema plm (same as the table). COMMENT ON INDEX must be
-- schema-qualified: migration search_path does not include plm, so bare names
-- resolve as public.* and fail with SQLSTATE 42P01 (preview apply evidence).
comment on index plm.plm_taxonomy_resolution_review_source_uidx is
  'PARTIAL unique: at most one ACTIVE source finding per (entity_type, company_code, division_code, mg_type_code, mg_code). Predicate status IN (open, quarantined, conflict). Terminal rows (approved_link, ignored, dismissed) are history and do not participate — a later active finding is allowed after close-out.';

comment on index plm.plm_taxonomy_resolution_review_canonical_licensor_uidx is
  'PARTIAL unique: at most one ACTIVE canonical_only licensor finding per proposed_licensor_id. Same active-status predicate as source_uidx.';

comment on index plm.plm_taxonomy_resolution_review_canonical_property_uidx is
  'PARTIAL unique: at most one ACTIVE canonical_only property finding per proposed_property_id. Same active-status predicate as source_uidx.';

comment on table plm.taxonomy_resolution_review is
  'Durable human/automation review queue for ColdLion licensor/property resolution. finding_scope=source uses real ColdLion composite keys; finding_scope=canonical_only leaves source keys NULL and identifies the core subject via typed proposed_* (no fake ColdLion keys). Typed proposed/resolved licensor/property FKs only — no polymorphic entity_id. At most one ACTIVE finding (status open|quarantined|conflict) per source key or canonical subject via partial unique indexes; approved_link|ignored|dismissed are terminal history and do not block a later new finding. Status/resolution/resolved-* matrix is CHECK-enforced (status_resolution_ck + resolved_link_ck). Does not mutate core UUIDs, status, or property.licensor_id.';

comment on column plm.taxonomy_resolution_review.finding_scope is
  'source = finding about a real ColdLion composite key; canonical_only = core row with no ColdLion counterpart (source keys must be null).';
comment on column plm.taxonomy_resolution_review.proposed_licensor_id is
  'Typed proposed core.licensor for licensor findings (or the subject for licensor canonical_only). Always null on property findings.';
comment on column plm.taxonomy_resolution_review.proposed_property_id is
  'Typed proposed core.property for property findings (or the subject for property canonical_only). Always null on licensor findings.';
comment on column plm.taxonomy_resolution_review.resolved_licensor_id is
  'Set only when status=approved_link on a licensor finding (with resolution=approved_link, nonblank resolved_by, nonnull resolved_at). Null for every other status.';
comment on column plm.taxonomy_resolution_review.resolved_property_id is
  'Set only when status=approved_link on a property finding (with resolution=approved_link, nonblank resolved_by, nonnull resolved_at). Null for every other status.';
comment on column plm.taxonomy_resolution_review.resolved_by is
  'Required nonblank actor when status=approved_link. Must be null for open|quarantined|conflict|ignored|dismissed.';
comment on column plm.taxonomy_resolution_review.resolved_at is
  'Required timestamp when status=approved_link. Must be null for open|quarantined|conflict|ignored|dismissed.';
comment on column plm.taxonomy_resolution_review.evidence is
  'Structured evidence only (candidate ids, item co-occurrence counts, DesignFlow refs). Item co-occurrence is evidence, never authority for parent edges. Not an EAV bag for primary identity.';
comment on column plm.taxonomy_resolution_review.status is
  'Review lifecycle: open | quarantined | conflict (ACTIVE work-queue) | approved_link | ignored | dismissed (terminal history). Partial unique indexes enforce at most one ACTIVE finding per source key / canonical subject.';
comment on column plm.taxonomy_resolution_review.resolution is
  'Outcome label constrained by status (see plm_taxonomy_resolution_review_status_resolution_ck). approved_link resolution only with status=approved_link. Conflict cannot carry ignored; ignored cannot carry conflict.';

create index plm_taxonomy_resolution_review_status_idx
  on plm.taxonomy_resolution_review (status, entity_type, finding_scope);
create index plm_taxonomy_resolution_review_open_idx
  on plm.taxonomy_resolution_review (entity_type, finding_scope)
  where status = 'open';
create index plm_taxonomy_resolution_review_proposed_licensor_idx
  on plm.taxonomy_resolution_review (proposed_licensor_id)
  where proposed_licensor_id is not null;
create index plm_taxonomy_resolution_review_proposed_property_idx
  on plm.taxonomy_resolution_review (proposed_property_id)
  where proposed_property_id is not null;
create index plm_taxonomy_resolution_review_resolved_licensor_idx
  on plm.taxonomy_resolution_review (resolved_licensor_id)
  where resolved_licensor_id is not null;
create index plm_taxonomy_resolution_review_resolved_property_idx
  on plm.taxonomy_resolution_review (resolved_property_id)
  where resolved_property_id is not null;

create trigger set_updated_at before update on plm.taxonomy_resolution_review
  for each row execute function app.set_updated_at();

-- =====================================================================================
-- 5. RLS + grants — Phase 1 browser writes forbidden
-- =====================================================================================

alter table plm.erp_licensor enable row level security;
alter table plm.erp_property enable row level security;
alter table plm.taxonomy_resolution_review enable row level security;

-- SELECT-only policies for authenticated. NO write policies for browser roles.
create policy plm_erp_licensor_select on plm.erp_licensor
  for select to authenticated
  using (
    app.has_role('administrator')
    or app.has_app_access('plm')
    or app.has_any_role(array['sales', 'licensing']::app.app_role[])
  );

create policy plm_erp_property_select on plm.erp_property
  for select to authenticated
  using (
    app.has_role('administrator')
    or app.has_app_access('plm')
    or app.has_any_role(array['sales', 'licensing']::app.app_role[])
  );

create policy plm_taxonomy_resolution_review_select on plm.taxonomy_resolution_review
  for select to authenticated
  using (app.has_role('administrator') or app.has_app_access('admin'));

-- Revoke ALL from public + browser roles, then grant SELECT only where policy applies.
revoke all on table plm.erp_licensor from public;
revoke all on table plm.erp_property from public;
revoke all on table plm.taxonomy_resolution_review from public;

revoke all on table plm.erp_licensor from authenticated;
revoke all on table plm.erp_property from authenticated;
revoke all on table plm.taxonomy_resolution_review from authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on table plm.erp_licensor from anon';
    execute 'revoke all on table plm.erp_property from anon';
    execute 'revoke all on table plm.taxonomy_resolution_review from anon';
  end if;
end $$;

grant select on plm.erp_licensor, plm.erp_property, plm.taxonomy_resolution_review
  to authenticated;
grant all on plm.erp_licensor, plm.erp_property, plm.taxonomy_resolution_review
  to service_role;

-- =====================================================================================
-- 6. Read-only reconciliation views (evidence only — no raw payloads)
-- =====================================================================================

create or replace view api.coldlion_licensor_reconciliation
with (security_invoker = true) as
select
  e.company_code,
  e.division_code,
  e.mg_type_code,
  e.mg_code,
  e.mg_type_desc,
  e.name as source_name,
  e.resolution_status,
  e.resolution_reason,
  e.licensor_id as matched_licensor_id,
  cl.code as matched_code,
  cl.name as matched_name,
  cl.status as matched_status,
  (
    select count(*)::integer
    from core.taxonomy_source_ref tsr
    where tsr.entity_table = 'licensor'
      and tsr.entity_id = e.licensor_id
      and tsr.source_system = 'designflow_plm'
  ) as designflow_source_ref_count,
  (
    select count(*)::integer
    from core.taxonomy_source_ref tsr
    where tsr.entity_table = 'licensor'
      and tsr.entity_id = e.licensor_id
      and tsr.source_system = 'coldlion'
  ) as coldlion_source_ref_count,
  case
    when cl.id is null then null
    when lower(btrim(cl.name)) is distinct from lower(btrim(e.name)) then true
    else false
  end as name_differs_from_canonical,
  case
    when cl.id is null then null
    when cl.status is distinct from 'active' then true
    else false
  end as canonical_not_active,
  e.first_seen_at,
  e.last_seen_at,
  e.last_sync_run_id,
  rev.id as open_review_id,
  rev.status as open_review_status,
  rev.reason as open_review_reason,
  rev.confidence as open_review_confidence,
  rev.proposed_licensor_id as open_review_proposed_licensor_id,
  rev.resolved_licensor_id as open_review_resolved_licensor_id,
  coalesce(item_use.item_count, 0) as item_cooccurrence_count
from plm.erp_licensor e
left join core.licensor cl on cl.id = e.licensor_id
left join lateral (
  select r.id, r.status, r.reason, r.confidence,
         r.proposed_licensor_id, r.resolved_licensor_id
  from plm.taxonomy_resolution_review r
  where r.entity_type = 'licensor'
    and r.finding_scope = 'source'
    and r.company_code = e.company_code
    and r.division_code = e.division_code
    and r.mg_type_code = e.mg_type_code
    and r.mg_code = e.mg_code
    and r.status in ('open', 'quarantined', 'conflict')
  order by r.updated_at desc
  limit 1
) rev on true
left join lateral (
  select count(*)::integer as item_count
  from plm.item i
  where e.licensor_id is not null
    and i.licensor_id = e.licensor_id
) item_use on true;

comment on view api.coldlion_licensor_reconciliation is
  'Read-only ColdLion↔canonical licensor reconciliation. Evidence only: composite source key, resolution state, matched UUID/code/name/status, DesignFlow/ColdLion source-ref counts, open review (typed proposed/resolved licensor ids), and item co-occurrence counts. Does not expose raw payloads. Does not mutate anything. Item co-occurrence is evidence, not authority.';

create or replace view api.coldlion_property_reconciliation
with (security_invoker = true) as
select
  e.company_code,
  e.division_code,
  e.mg_type_code,
  e.mg_code,
  e.mg_type_desc,
  e.name as source_name,
  e.resolution_status,
  e.resolution_reason,
  e.property_id as matched_property_id,
  cp.code as matched_code,
  cp.name as matched_name,
  cp.status as matched_status,
  cp.licensor_id as canonical_parent_licensor_id,
  parent.code as canonical_parent_code,
  parent.name as canonical_parent_name,
  parent.status as canonical_parent_status,
  (
    select count(*)::integer
    from core.taxonomy_source_ref tsr
    where tsr.entity_table = 'property'
      and tsr.entity_id = e.property_id
      and tsr.source_system = 'designflow_plm'
  ) as designflow_source_ref_count,
  (
    select count(*)::integer
    from core.taxonomy_source_ref tsr
    where tsr.entity_table = 'property'
      and tsr.entity_id = e.property_id
      and tsr.source_system = 'coldlion'
  ) as coldlion_source_ref_count,
  case
    when cp.id is null then null
    when lower(btrim(cp.name)) is distinct from lower(btrim(e.name)) then true
    else false
  end as name_differs_from_canonical,
  case
    when cp.id is null then null
    when cp.status is distinct from 'active' then true
    else false
  end as canonical_not_active,
  true as coldlion_lacks_parent_edge,
  e.first_seen_at,
  e.last_seen_at,
  e.last_sync_run_id,
  rev.id as open_review_id,
  rev.status as open_review_status,
  rev.reason as open_review_reason,
  rev.confidence as open_review_confidence,
  rev.proposed_property_id as open_review_proposed_property_id,
  rev.resolved_property_id as open_review_resolved_property_id,
  coalesce(item_use.item_count, 0) as item_cooccurrence_count
from plm.erp_property e
left join core.property cp on cp.id = e.property_id
left join core.licensor parent on parent.id = cp.licensor_id
left join lateral (
  select r.id, r.status, r.reason, r.confidence,
         r.proposed_property_id, r.resolved_property_id
  from plm.taxonomy_resolution_review r
  where r.entity_type = 'property'
    and r.finding_scope = 'source'
    and r.company_code = e.company_code
    and r.division_code = e.division_code
    and r.mg_type_code = e.mg_type_code
    and r.mg_code = e.mg_code
    and r.status in ('open', 'quarantined', 'conflict')
  order by r.updated_at desc
  limit 1
) rev on true
left join lateral (
  select count(*)::integer as item_count
  from plm.item i
  where e.property_id is not null
    and i.property_id = e.property_id
) item_use on true;

comment on view api.coldlion_property_reconciliation is
  'Read-only ColdLion↔canonical property reconciliation. Exposes composite source key, resolution, matched UUID/code/name/status, curated parent (core.property.licensor_id NOT NULL), source-ref counts, open review (typed proposed/resolved property ids), and item co-occurrence as evidence only. ColdLion never supplies parent edges. No raw payloads. No mutations.';

create or replace view api.coldlion_taxonomy_cutover_summary
with (security_invoker = true) as
select
  'licensor'::text as entity_type,
  e.resolution_status,
  count(*)::integer as mirror_rows,
  count(*) filter (where e.licensor_id is not null)::integer as linked_rows,
  count(*) filter (where e.licensor_id is null)::integer as unlinked_rows,
  count(distinct e.division_code)::integer as division_count,
  min(e.first_seen_at) as earliest_first_seen_at,
  max(e.last_seen_at) as latest_last_seen_at
from plm.erp_licensor e
group by e.resolution_status
union all
select
  'property'::text as entity_type,
  e.resolution_status,
  count(*)::integer as mirror_rows,
  count(*) filter (where e.property_id is not null)::integer as linked_rows,
  count(*) filter (where e.property_id is null)::integer as unlinked_rows,
  count(distinct e.division_code)::integer as division_count,
  min(e.first_seen_at) as earliest_first_seen_at,
  max(e.last_seen_at) as latest_last_seen_at
from plm.erp_property e
group by e.resolution_status
union all
select
  r.entity_type,
  ('review:' || r.finding_scope || ':' || r.status)::text as resolution_status,
  count(*)::integer as mirror_rows,
  count(*) filter (
    where r.resolved_licensor_id is not null or r.resolved_property_id is not null
  )::integer as linked_rows,
  count(*) filter (
    where r.resolved_licensor_id is null and r.resolved_property_id is null
  )::integer as unlinked_rows,
  count(distinct r.division_code)::integer as division_count,
  min(r.created_at) as earliest_first_seen_at,
  max(r.updated_at) as latest_last_seen_at
from plm.taxonomy_resolution_review r
group by r.entity_type, r.finding_scope, r.status;

comment on view api.coldlion_taxonomy_cutover_summary is
  'Read-only cutover rollup: mirror resolution_status counts plus review-queue finding_scope/status counts for licensor and property. Evidence surface for parallel-run dashboards. No secrets, no raw payloads, no mutations.';

grant select on api.coldlion_licensor_reconciliation to authenticated, service_role;
grant select on api.coldlion_property_reconciliation to authenticated, service_role;
grant select on api.coldlion_taxonomy_cutover_summary to authenticated, service_role;
