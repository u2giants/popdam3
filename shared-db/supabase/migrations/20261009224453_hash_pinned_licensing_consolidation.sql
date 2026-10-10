-- =====================================================================================
-- Hash-pinned licensing consolidation engine.
--
-- Migration: 20261009224453_hash_pinned_licensing_consolidation.sql
-- Issue:     popcre/shared-db #2336 (structural successor to #1090)
-- Claim:     popcre/shared-db #4152
--            table    plm.licensing_consolidation_plan
--            function plm.plan_licensing_consolidation
--            function plm.apply_licensing_consolidation
--            Nothing else.
-- derived-from: none
--
-- Depends on (exact 14-digit versions):
--   20260817124545  licensing_write_authority_guard -- creates
--                   plm.licensing_write_authorization and the core.licensor /
--                   core.property BEFORE INSERT/UPDATE guard this engine writes through.
--   20260814224937 / 20260902024541  source_resolution home -- the durable entity
--                   decisions this engine reads. READ ONLY.
--   20260907051735  licensing_source_authority_and_relationship_decisions -- creates
--                   plm.licensing_source_scope and plm.licensing_relationship_resolution.
--                   READ ONLY.
--   20260907030418  canonical_licensing_relationship_bridges -- the source-edge support
--                   tables relationship operations upsert or retire. WRITTEN AT APPLY
--                   TIME ONLY, never by this migration.
--
-- LOADS NO DATA. No plan row, no canonical entity, no relationship support and no
-- curated licensing row is inserted by this file. u2giants/shared-db is a PUBLIC
-- repository: SCHEMA IN GIT, DATA OUT OF GIT.
--
-- -------------------------------------------------------------------------------------
-- 1. WHAT THIS ENGINE IS
--
-- Step 2.4 of plan_licensing_master_data_implementation.md: a preview/dry-run-first
-- consolidator. A caller names a source system and a capture. The plan function builds
-- a deterministic, hash-pinned set of proposed canonical writes and stores it as
-- immutable facts. The apply function executes exactly that set under a transaction-bound
-- write authorization, or refuses.
--
-- The engine is the NARROW approved-source exception: for an authorized, source-scoped
-- complete capture it may update portal spelling and Property ownership on matched
-- canonical rows. It is not permission for an ad-hoc external load. ColdLion status,
-- licensing-review creates and canonical merges each keep their own write_kind.
--
-- -------------------------------------------------------------------------------------
-- 2. THE GATES, AND WHERE EACH ONE LIVES
--
-- complete-capture   plan + apply. A capture that is not status='complete' for its
--                    source root cannot be planned or applied. A running, partial,
--                    failed or superseded capture is never canonical input.
-- source-scope       plan + apply. Every proposed write is checked against
--                    plm.licensing_source_scope for (licensor, source_system, purpose,
--                    axis, kind). Out-of-scope work is planned as a refusal, never as a
--                    silent skip and never as a write.
-- collision          plan. Two operations that would write the same canonical row with
--                    conflicting after-values, or a create that collides with an
--                    existing normalized identity, refuse the whole plan.
-- write-authorization apply. Protected core.licensor / core.property writes occur only
--                    after this function inserts a transaction-bound
--                    plm.licensing_write_authorization row that the Step 1.0 guard
--                    consumes. Direct grants and session variables create nothing.
--
-- Plus the non-gate rules the issue requires:
--   * immutable plan/audit facts -- content columns cannot be updated or deleted;
--   * conflict refusal -- apply re-derives the plan body and refuses on any drift;
--   * idempotency -- an already-applied plan with the same hash is a successful no-op;
--   * rollback evidence -- every operation carries its before-image and the plan carries
--     an inverse operation list;
--   * no automatic promotion from inferred/co-occurrence evidence -- only
--     direct_source_assertion matched relationship rows may become support writes, and
--     the engine re-checks that even though the decision table already constrains it;
--   * no hard delete of missing source records -- the operation vocabulary has no DELETE.
--     Absence from a complete capture retires source support and never destroys a
--     canonical entity or a historical edge.
--
-- -------------------------------------------------------------------------------------
-- 3. WHY THE PLAN TABLE IS APPEND-ONLY FOR CONTENT
--
-- A plan is a contract. The caller who reviews the preview and the caller who supplies
-- expected_hash at apply time are trusting that the bytes they hashed are the bytes that
-- run. An UPDATE that rewrote operations after the fact would break that without any
-- hash mismatch. The BEFORE UPDATE trigger therefore allows only the apply-lifecycle
-- columns (plan_status, applied_at, applied_by, rollback_of) to change, and only in the
-- direction preview -> applied. Everything else -- source_system, capture_id, plan_hash,
-- operations, rollback_operations, gate evidence -- is frozen at insert. DELETE is
-- refused for every role including the table owner's migration path: audit facts do not
-- evaporate.
--
-- -------------------------------------------------------------------------------------
-- 4. WHY THE HASH IS OVER A CANONICAL JSON TEXT
--
-- jsonb key order is not stable across PostgreSQL versions or even across two builds of
-- the same object. The hash is taken over jsonb::text of a jsonb object built with
-- jsonb_build_object in a FIXED key order, and operations are stored as a JSON array
-- sorted by a deterministic operation key. Two plan calls over the same decisions
-- therefore produce the same plan_hash, which is what makes "rerunning the same capture
-- is a no-op" and "dry-run/apply parity" testable.
--
-- -------------------------------------------------------------------------------------
-- 5. LOCKING
--
-- The new table is created empty, so its indexes build on zero rows. The two functions
-- take a per-(source_system, capture_id) advisory lock on the plan path and a
-- per-plan_id lock on the apply path, so two concurrent planners or appliers of the
-- same capture queue instead of racing. The Step 1.0 guard already serializes protected
-- canonical writes through its transaction-bound authorization row.
-- =====================================================================================


-- =====================================================================================
-- PART 1 -- plm.licensing_consolidation_plan
-- =====================================================================================

create table if not exists plm.licensing_consolidation_plan (
  id uuid primary key default gen_random_uuid(),

  -- What this plan consolidates. The capture is part of identity: two captures of the
  -- same source are two different plans, and neither may silently overwrite the other.
  source_system text not null,
  capture_id    uuid not null,

  -- SHA-256 hex over the canonical plan body. Pinned to the exact 64-hex shape the
  -- write-authorization table already requires, so the two cannot disagree about what
  -- a hash looks like.
  plan_hash text not null,
  constraint licensing_consolidation_plan_hash_chk
    check (plan_hash ~ '^[0-9a-f]{64}$'),

  -- Lifecycle. preview -> applied is the only forward transition the engine makes.
  -- rolled_back is reserved for a future audited reversal plan (Step 2.5 owns merge
  -- reversal; consolidation rollback evidence lives in rollback_operations).
  plan_status text not null default 'preview',
  constraint licensing_consolidation_plan_status_chk
    check (plan_status in ('preview', 'applied', 'refused')),
  constraint licensing_consolidation_plan_applied_pair_chk
    check ((plan_status = 'applied') = (applied_at is not null)),
  constraint licensing_consolidation_plan_applied_by_chk
    check (applied_at is null or applied_by is null or btrim(applied_by) <> ''),

  -- Gate evidence, recorded at plan time and re-checked at apply time. These are facts
  -- about the world the plan was built from, not permissions.
  capture_complete       boolean not null,
  source_scope_checked   boolean not null,
  collision_count        integer not null default 0,
  constraint licensing_consolidation_plan_collision_chk check (collision_count >= 0),

  -- Counts, so a reviewer can see the size of the blast radius without opening the
  -- operations array. No licensed row values appear in any of these.
  entity_operation_count       integer not null default 0,
  relationship_operation_count integer not null default 0,
  retire_operation_count       integer not null default 0,
  constraint licensing_consolidation_plan_counts_chk check (
    entity_operation_count >= 0
    and relationship_operation_count >= 0
    and retire_operation_count >= 0
  ),

  -- The work itself. A JSON array of operation objects, each carrying its before-image
  -- (rollback evidence) and its after-values. Sorted by op_key so the hash is stable.
  -- No licensed row value is ever written into plan_status or the count columns; the
  -- operations array may carry official names because that is the work product the
  -- reviewer must see -- it stays inside this table and is never logged.
  operations jsonb not null default '[]'::jsonb,
  constraint licensing_consolidation_plan_operations_chk
    check (jsonb_typeof(operations) = 'array'),

  -- The inverse of operations, computed at plan time. Applying rollback_operations is
  -- the audited reversal path; it is stored now so a later crash cannot leave the
  -- system without a way back.
  rollback_operations jsonb not null default '[]'::jsonb,
  constraint licensing_consolidation_plan_rollback_chk
    check (jsonb_typeof(rollback_operations) = 'array'),

  -- Refusal record. A plan that could not be built honestly is still a plan: it says
  -- what was refused and why, instead of disappearing.
  refusal_reason text null,
  constraint licensing_consolidation_plan_refusal_reason_chk
    check (refusal_reason is null or btrim(refusal_reason) <> ''),
  constraint licensing_consolidation_plan_refused_has_reason_chk
    check (plan_status <> 'refused' or refusal_reason is not null),

  -- Audit.
  planned_at timestamptz not null default clock_timestamp(),
  planned_by text not null,
  constraint licensing_consolidation_plan_planned_by_chk
    check (btrim(planned_by) <> ''),
  applied_at timestamptz null,
  applied_by text null,

  -- Which plan, if any, reversed this one. Self-referential on purpose: the reversal is
  -- itself a plan with its own hash, and the chain is walkable.
  rollback_of uuid null references plm.licensing_consolidation_plan(id) on delete restrict,

  created_at timestamptz not null default clock_timestamp(),

  -- One live plan per (source, capture, hash). Re-planning identical decisions is
  -- idempotent at the storage layer too: the second insert hits this key and the
  -- planner returns the existing row.
  constraint licensing_consolidation_plan_identity_uq
    unique (source_system, capture_id, plan_hash),

  constraint licensing_consolidation_plan_source_system_nonblank_chk
    check (btrim(source_system) <> '')
);

-- "What has this source planned" and "what is still preview" are the two working reads.
create index if not exists licensing_consolidation_plan_source_idx
  on plm.licensing_consolidation_plan (source_system, plan_status, planned_at desc);

create index if not exists licensing_consolidation_plan_open_idx
  on plm.licensing_consolidation_plan (planned_at desc)
  where plan_status = 'preview';

comment on table plm.licensing_consolidation_plan is
  'Hash-pinned consolidation plans and their immutable audit facts (issue #2336). One row '
  'is one previewed set of canonical writes for one (source_system, capture_id) at one '
  'plan_hash. Content columns are frozen at insert; only the apply lifecycle may change. '
  'Operations carry before-images so every applied plan has rollback evidence. No role may '
  'insert, update or delete this table directly -- only the SECURITY DEFINER plan/apply '
  'functions. Absence from a complete capture retires source support through this engine '
  'and never hard-deletes a canonical entity.';
comment on column plm.licensing_consolidation_plan.plan_hash is
  'SHA-256 hex over the canonical plan body (source_system, capture_id, sorted operations). '
  'Apply requires the caller to echo this exact value, which is what makes stale-hash '
  'conflict refusal and dry-run/apply parity real rather than aspirational.';
comment on column plm.licensing_consolidation_plan.operations is
  'JSON array of proposed writes. Each element carries op_key, op, target identity, '
  'before-image, after-values, evidence_kind and reason. Never contains DELETE.';
comment on column plm.licensing_consolidation_plan.rollback_operations is
  'Inverse operation list computed at plan time. Applying it is the audited reversal '
  'path; it is stored now so rollback evidence cannot be lost to a later crash.';

-- Content immutability. A BEFORE UPDATE trigger is the only shape that can allow a
-- narrow set of lifecycle columns while freezing the rest, evaluated on every path
-- including the owner path. A CHECK cannot express "column X never changes".
create or replace function plm.licensing_consolidation_plan_immutable()
returns trigger
language plpgsql
security definer
set search_path to pg_catalog
as $function$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '42501',
      message = 'licensing consolidation plans are immutable audit facts and cannot be deleted';
  end if;

  -- Only the apply lifecycle may change, and only preview -> applied (or a recorded
  -- refusal that was never applied). Content and gate evidence are frozen.
  if new.id is distinct from old.id
     or new.source_system is distinct from old.source_system
     or new.capture_id is distinct from old.capture_id
     or new.plan_hash is distinct from old.plan_hash
     or new.capture_complete is distinct from old.capture_complete
     or new.source_scope_checked is distinct from old.source_scope_checked
     or new.collision_count is distinct from old.collision_count
     or new.entity_operation_count is distinct from old.entity_operation_count
     or new.relationship_operation_count is distinct from old.relationship_operation_count
     or new.retire_operation_count is distinct from old.retire_operation_count
     or new.operations is distinct from old.operations
     or new.rollback_operations is distinct from old.rollback_operations
     or new.refusal_reason is distinct from old.refusal_reason
     or new.planned_at is distinct from old.planned_at
     or new.planned_by is distinct from old.planned_by
     or new.created_at is distinct from old.created_at
     or new.rollback_of is distinct from old.rollback_of then
    raise exception using errcode = '42501',
      message = 'licensing consolidation plan content is immutable; only plan_status, applied_at and applied_by may change';
  end if;

  if old.plan_status = 'applied' and new.plan_status <> 'applied' then
    raise exception using errcode = '42501',
      message = 'an applied licensing consolidation plan cannot be un-applied; plan a rollback instead';
  end if;

  return new;
end;
$function$;

comment on function plm.licensing_consolidation_plan_immutable() is
  'BEFORE UPDATE/DELETE guard that freezes every consolidation plan content column and '
  'refuses DELETE, leaving only the apply lifecycle mutable (issue #2336).';

revoke all on function plm.licensing_consolidation_plan_immutable()
  from public, anon, authenticated, service_role;

drop trigger if exists licensing_consolidation_plan_immutable_trg
  on plm.licensing_consolidation_plan;
create trigger licensing_consolidation_plan_immutable_trg
  before update or delete on plm.licensing_consolidation_plan
  for each row execute function plm.licensing_consolidation_plan_immutable();

-- Fail closed. No client role and not even service_role may write this table directly;
-- the SECURITY DEFINER functions below are the only write path, exactly the posture
-- plm.source_resolution has held since 20260902024541.
alter table plm.licensing_consolidation_plan enable row level security;
revoke all on table plm.licensing_consolidation_plan
  from public, anon, authenticated, service_role;
grant select on table plm.licensing_consolidation_plan
  to authenticated, service_role;

drop policy if exists licensing_consolidation_plan_authenticated_read
  on plm.licensing_consolidation_plan;
create policy licensing_consolidation_plan_authenticated_read
  on plm.licensing_consolidation_plan for select to authenticated using (true);


-- =====================================================================================
-- PART 2 -- the plan function
-- =====================================================================================
-- SECURITY DEFINER so it can read the decision tables and the source capture roots and
-- insert the plan row through the immutability trigger. search_path is pinned to
-- pg_catalog so no caller-writable schema can shadow a referenced name. Execute is
-- granted to service_role only: a browser must never build a plan, and anon gains
-- nothing.

create or replace function plm.plan_licensing_consolidation(
  p_source_system text,
  p_capture_id uuid,
  p_entity_source_id text default null
)
returns plm.licensing_consolidation_plan
language plpgsql
security definer
set search_path to pg_catalog
as $function$
declare
  v_actor text := coalesce(
    auth.uid()::text,
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    session_user::text
  );
  v_source text;
  v_capture_complete boolean := false;
  v_scope_ok boolean := true;
  v_collision_count integer := 0;
  v_entity_ops jsonb := '[]'::jsonb;
  v_rel_ops jsonb := '[]'::jsonb;
  v_retire_ops jsonb := '[]'::jsonb;
  v_all_ops jsonb;
  v_rollback_ops jsonb;
  v_canonical text;
  v_plan_hash text;
  v_existing plm.licensing_consolidation_plan%rowtype;
  v_row plm.licensing_consolidation_plan%rowtype;
  v_entity_count integer := 0;
  v_rel_count integer := 0;
  v_retire_count integer := 0;
  v_refusal text := null;
  -- Per-decision working values.
  v_rec record;
  v_before jsonb;
  v_after jsonb;
  v_op jsonb;
  v_target_licensor uuid;
  v_official_name text;
  v_official_code text;
  v_canonical_name text;
  v_canonical_licensor uuid;
  v_canonical_status text;
  v_conflict_targets uuid[];
begin
  if coalesce(v_actor, '') = '' then
    raise exception using errcode = '42501',
      message = 'licensing consolidation planning requires an authenticated actor';
  end if;

  v_source := btrim(p_source_system);
  if v_source = '' or p_capture_id is null then
    raise exception using errcode = '22023',
      message = 'plan_licensing_consolidation requires a non-blank source_system and a capture_id';
  end if;
  if p_entity_source_id is not null and btrim(p_entity_source_id) = '' then
    raise exception using errcode = '22023',
      message = 'p_entity_source_id must be null or a non-blank source id';
  end if;

  -- Serialize planners for the same (source, capture). Two concurrent plan calls must
  -- queue, or both would build competing plans and the identity unique key would fire
  -- as a random-looking conflict instead of a clean second-writer wait.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    pg_catalog.concat_ws(chr(31), 'licensing_consolidation_plan', v_source, p_capture_id::text), 0));

  -- -----------------------------------------------------------------------
  -- GATE 1: complete-capture.
  -- A capture that is not complete is never canonical input. The mapping is explicit
  -- per source root so a missing root fails closed rather than treating "we could not
  -- check" as "it is fine".
  -- -----------------------------------------------------------------------
  begin
    if v_source = 'paramount' then
      execute 'select status = ''complete'' and capture_kind = ''full''
                 from plm.pmt_capture where capture_id = $1'
        into v_capture_complete using p_capture_id;
    elsif v_source = 'nbcu' then
      execute 'select status = ''complete''
                 from plm.nbcu_capture where id = $1'
        into v_capture_complete using p_capture_id;
    elsif v_source = 'disney_opa' then
      execute 'select status = ''complete''
                 from plm.opa_capture where id = $1'
        into v_capture_complete using p_capture_id;
    elsif v_source in ('disney_dcpvault', 'lucasfilm_dcpvault',
                       'marvel_dcpvault', 'twentieth_century_dcpvault') then
      execute 'select status = ''complete''
                 from plm.dcp_crawl where crawl_id = $1'
        into v_capture_complete using p_capture_id;
    elsif v_source = 'wildbrain' then
      execute 'select status = ''complete''
                 from plm.wildbrain_capture where id = $1'
        into v_capture_complete using p_capture_id;
    elsif v_source like 'warner:%' then
      execute 'select status = ''complete''
                 from plm.wb_capture where capture_id = $1 and chunk_number = 0'
        into v_capture_complete using p_capture_id;
    else
      v_capture_complete := false;
    end if;
  exception when undefined_table or undefined_column then
    -- The capture root for this source is not present, or its shape drifted. Fail
    -- closed: "we cannot prove completeness" is a refusal, never a green light.
    v_capture_complete := false;
  end;

  v_capture_complete := coalesce(v_capture_complete, false);

  if not v_capture_complete then
    -- Still write a plan row: a refused plan is an audit fact, and the caller gets a
    -- hash-pinned record of exactly what was refused instead of a bare exception and
    -- no history. Status is 'refused' so nobody can apply it.
    insert into plm.licensing_consolidation_plan (
      source_system, capture_id, plan_hash,
      plan_status, capture_complete, source_scope_checked, collision_count,
      entity_operation_count, relationship_operation_count, retire_operation_count,
      operations, rollback_operations, refusal_reason, planned_by
    ) values (
      v_source, p_capture_id,
      encode(extensions.digest(
        pg_catalog.jsonb_build_object(
          'source_system', v_source,
          'capture_id', p_capture_id::text,
          'operations', '[]'::jsonb
        )::text, 'sha256'), 'hex'),
      'refused', false, false, 0, 0, 0, 0,
      '[]'::jsonb, '[]'::jsonb,
      'complete-capture gate refused: capture is missing, not complete, or its source root is unknown',
      v_actor
    )
    on conflict on constraint licensing_consolidation_plan_identity_uq
      do update set plan_status = plm.licensing_consolidation_plan.plan_status
    returning * into v_row;
    return v_row;
  end if;

  -- -----------------------------------------------------------------------
  -- GATE 2 (plan side): source-scope. Checked per decision below; this flag is the
  -- recorded fact that every proposed write was scoped. A single out-of-scope write
  -- sets it false AND refuses the whole plan -- partial application of a plan that
  -- contains out-of-scope work is exactly the royalty error the scope table exists
  -- to prevent.
  -- -----------------------------------------------------------------------

  -- -----------------------------------------------------------------------
  -- ENTITY OPERATIONS from matched plm.source_resolution decisions.
  -- Only MATCHED rows propose canonical writes. Unresolved/ambiguous/deferred rows
  -- are the licensing queue's job and are never auto-promoted here.
  -- -----------------------------------------------------------------------
  for v_rec in
    select sr.source_system, sr.entity_kind, sr.source_id,
           sr.core_property_id, sr.core_character_id, sr.core_style_guide_id,
           sr.dam_asset_id, sr.core_licensor_id, sr.core_franchise_id,
           sr.resolution_status, sr.resolution_reason, sr.updated_at
      from plm.source_resolution sr
     where sr.source_system = v_source
       and sr.resolution_status = 'matched'
       and (p_entity_source_id is null or sr.source_id = btrim(p_entity_source_id))
     order by sr.entity_kind, sr.source_id
  loop
    -- Which canonical row does this decision name?
    v_target_licensor := null;
    v_official_name := null;
    v_official_code := null;

    if v_rec.entity_kind = 'property' and v_rec.core_property_id is not null then
      select p.name, p.code, p.status, p.licensor_id
        into v_canonical_name, v_official_code, v_canonical_status, v_canonical_licensor
        from core.property p where p.id = v_rec.core_property_id;
      v_target_licensor := v_canonical_licensor;
    elsif v_rec.entity_kind = 'licensor' and v_rec.core_licensor_id is not null then
      select l.name, l.code, l.status, null::uuid
        into v_canonical_name, v_official_code, v_canonical_status, v_canonical_licensor
        from core.licensor l where l.id = v_rec.core_licensor_id;
      -- The licensor IS the scope subject. Naming it keeps the source-scope gate
      -- from being skipped for licensor-kind writes (Muse finding 2).
      v_target_licensor := v_rec.core_licensor_id;
      v_canonical_licensor := v_rec.core_licensor_id;
    else
      -- Character, style_guide, asset and franchise consolidation is deliberately not
      -- in this engine's write set: the Step 1.0 guard protects only core.licensor and
      -- core.property. Those kinds are recorded as scoped refusals rather than silent
      -- skips, so the plan is honest about what it will not do.
      v_scope_ok := false;
      v_refusal := coalesce(v_refusal,
        'source-scope gate: entity kind ' || v_rec.entity_kind
        || ' is outside the scrape_consolidation write authorization surface');
      continue;
    end if;

    if v_canonical_name is null then
      -- A matched decision whose canonical target has vanished. Fail closed; the
      -- decision is durable and must not be destroyed, and the engine must not
      -- invent a replacement.
      v_scope_ok := false;
      v_refusal := coalesce(v_refusal,
        'conflict refusal: matched decision target is missing for '
        || v_source || '/' || v_rec.entity_kind || '/' || v_rec.source_id);
      continue;
    end if;

    -- Official spelling from the source capture. This is the narrow scrape-authority
    -- exception: inside its authorized scope the portal spelling wins, and the prior
    -- internal spelling is preserved as an alias by the caller/adapter, not destroyed
    -- here. When the capture carries no value we keep the canonical name and record
    -- an update-to-self, which apply treats as a no-op -- never a guessed rename.
    v_official_name := v_canonical_name;
    if v_rec.entity_kind = 'property' then
      begin
        if v_source = 'paramount' and v_rec.source_id ~ '^-?[0-9]{1,19}$' then
          execute 'select property_name from plm.pmt_property
                    where capture_id = $1 and property_source_id = $2::bigint'
            into v_official_name using p_capture_id, v_rec.source_id;
        elsif v_source = 'nbcu' then
          execute 'select property_label from plm.nbcu_property
                    where capture_id = $1 and (property_source_id = $2 or property_key = $2)'
            into v_official_name using p_capture_id, v_rec.source_id;
        elsif v_source = 'disney_opa' and v_rec.source_id ~ '^-?[0-9]{1,19}$' then
          execute 'select min(property_name) from plm.opa_property_character
                    where licensed_property_id = $1::bigint'
            into v_official_name using v_rec.source_id;
        end if;
      exception when undefined_table or undefined_column or invalid_text_representation then
        v_official_name := v_canonical_name;
      end;
      v_official_name := coalesce(nullif(btrim(v_official_name), ''), v_canonical_name);
    end if;

    -- Source-scope gate, per decision. The scope row must authorize this source at
    -- canonical_identity over this entity kind for the owning licensor, and it must be
    -- actually authorized (audit pair present), not merely configured. A write with no
    -- owning licensor cannot be scoped and is refused, never silently ungated.
    if v_target_licensor is null then
      v_scope_ok := false;
      v_refusal := coalesce(v_refusal,
        'source-scope gate: canonical target has no owning licensor for '
        || v_source || '/' || v_rec.entity_kind || '/' || v_rec.source_id);
      continue;
    end if;
    if not exists (
      select 1 from plm.licensing_source_scope s
       where s.licensor_id = v_target_licensor
         and s.source_system = v_source
         and s.source_purpose = 'canonical_identity'
         and s.scope_axis = 'entity'
         and s.permitted_kind = v_rec.entity_kind
         and s.authorized_at is not null
         and s.authorized_by is not null
    ) then
      v_scope_ok := false;
      v_refusal := coalesce(v_refusal,
        'source-scope gate: no authorized canonical_identity scope for '
        || v_source || '/' || v_rec.entity_kind);
      continue;
    end if;

    v_before := jsonb_build_object(
      'name', v_canonical_name,
      'code', v_official_code,
      'status', v_canonical_status,
      'licensor_id', v_canonical_licensor
    );
    v_after := jsonb_build_object(
      'name', v_official_name,
      'code', v_official_code,
      'status', v_canonical_status,
      'licensor_id', v_canonical_licensor
    );

    -- Matched Property status is never changed by scrape_consolidation. The Step 1.0
    -- guard already refuses a status change under this write_kind; we also refuse to
    -- PLAN one, so the reviewer never sees a forbidden write in the preview.
    if v_rec.entity_kind = 'property' then
      v_after := v_after - 'status' || jsonb_build_object('status', v_canonical_status);
    end if;

    v_op := jsonb_build_object(
      'op_key', 'entity:' || v_rec.entity_kind || ':' || v_rec.source_id,
      'op', case when v_before = v_after then 'noop' else 'update_entity' end,
      'entity_kind', v_rec.entity_kind,
      'source_system', v_source,
      'source_id', v_rec.source_id,
      'canonical_id', case
        when v_rec.entity_kind = 'property' then v_rec.core_property_id
        when v_rec.entity_kind = 'licensor' then v_rec.core_licensor_id
      end,
      'target_table', case
        when v_rec.entity_kind = 'property' then 'core.property'
        when v_rec.entity_kind = 'licensor' then 'core.licensor'
      end,
      'before', v_before,
      'after', v_after,
      'evidence_kind', 'direct_source_assertion',
      'reason', 'matched source_resolution decision under authorized complete capture'
    );
    v_entity_ops := v_entity_ops || jsonb_build_array(v_op);
    v_entity_count := v_entity_count + 1;
  end loop;

  -- -----------------------------------------------------------------------
  -- COLLISION GATE: two operations that name the same canonical target with
  -- different after-values refuse the whole plan. A plan is one consistent set of
  -- writes; applying half of a contradictory pair is worse than applying nothing.
  -- -----------------------------------------------------------------------
  select coalesce(array_agg(c.canonical_id), '{}')
    into v_conflict_targets
    from (
      select c.canonical_id
        from jsonb_array_elements(v_entity_ops) as e(elem),
             lateral (select (elem->>'canonical_id')::uuid as canonical_id,
                             elem->'after' as after_vals) as c
       where c.canonical_id is not null
       group by c.canonical_id
      having count(distinct c.after_vals) > 1
    ) as c;

  v_collision_count := cardinality(coalesce(v_conflict_targets, '{}'));
  if v_collision_count > 0 then
    v_scope_ok := false;
    v_refusal := coalesce(v_refusal,
      'collision gate: ' || v_collision_count
      || ' canonical target(s) have conflicting after-values');
  end if;

  -- -----------------------------------------------------------------------
  -- AUTHORIZATION-SHAPE GATE (collision, second leg). The Step 1.0 guard is a
  -- ROW-LEVEL trigger that CONSUMES its authorization on the first protected
  -- write, and its unique key allows only one authorization row per
  -- (backend_pid, transaction_id, target_table, write_kind, plan_id, plan_hash).
  -- Therefore one apply can perform AT MOST ONE protected canonical row write per
  -- target table. A plan that needs two entity writes to the same table is
  -- refused here, in the preview, rather than dying mid-apply. The adapter splits
  -- such work across plans; relationship and retirement operations are not
  -- limited and still ride in the same plan.
  -- -----------------------------------------------------------------------
  if exists (
    select 1
      from jsonb_array_elements(v_entity_ops) as e(elem)
     where elem->>'op' = 'update_entity'
     group by elem->>'target_table'
    having count(*) > 1
  ) then
    v_scope_ok := false;
    v_collision_count := v_collision_count + 1;
    v_refusal := coalesce(v_refusal,
      'collision gate: more than one entity write to one table in one apply; '
      || 'the write-authorization guard grants one protected row write per table per apply. '
      || 'Pass p_entity_source_id to plan one entity at a time.');
  end if;

  -- -----------------------------------------------------------------------
  -- RELATIONSHIP OPERATIONS from matched plm.licensing_relationship_resolution.
  -- Only direct_source_assertion evidence may become a support write. The decision
  -- table already constrains this; the engine re-checks because a plan must not
  -- depend on a sibling table's constraint for a royalty-safety rule.
  -- -----------------------------------------------------------------------
  for v_rec in
    select r.licensor_id, r.source_system, r.relationship_kind,
           r.source_left_id, r.source_right_id,
           r.resolution_status, r.evidence_kind, r.is_direct_source_relationship,
           r.core_property_id, r.core_character_id, r.core_style_guide_id,
           r.core_franchise_id, r.dam_asset_id
      from plm.licensing_relationship_resolution r
     where r.source_system = v_source
       and r.resolution_status = 'matched'
     order by r.relationship_kind, r.source_left_id, r.source_right_id
  loop
    if v_rec.evidence_kind <> 'direct_source_assertion'
       or not v_rec.is_direct_source_relationship then
      -- Hard refuse. Inferred and co-occurrence evidence may be recorded and
      -- displayed; it is never authority and never becomes a canonical support write.
      v_scope_ok := false;
      v_refusal := coalesce(v_refusal,
        'no automatic promotion from inferred/co-occurrence evidence: '
        || v_source || '/' || v_rec.relationship_kind || '/'
        || v_rec.source_left_id || '+' || v_rec.source_right_id);
      continue;
    end if;

    if not exists (
      select 1 from plm.licensing_source_scope s
       where s.licensor_id = v_rec.licensor_id
         and s.source_system = v_source
         and s.source_purpose = 'relationship_evidence'
         and s.scope_axis = 'relationship'
         and s.permitted_kind = v_rec.relationship_kind
         and s.authorized_at is not null
         and s.authorized_by is not null
    ) then
      v_scope_ok := false;
      v_refusal := coalesce(v_refusal,
        'source-scope gate: no authorized relationship_evidence scope for '
        || v_source || '/' || v_rec.relationship_kind);
      continue;
    end if;

    v_op := jsonb_build_object(
      'op_key', 'rel:' || v_rec.relationship_kind || ':'
                || v_rec.source_left_id || '+' || v_rec.source_right_id,
      'op', 'upsert_relationship_support',
      'relationship_kind', v_rec.relationship_kind,
      'source_system', v_source,
      'licensor_id', v_rec.licensor_id,
      'source_left_id', v_rec.source_left_id,
      'source_right_id', v_rec.source_right_id,
      'evidence_kind', v_rec.evidence_kind,
      'before', null,
      'after', jsonb_build_object(
        'core_property_id', v_rec.core_property_id,
        'core_character_id', v_rec.core_character_id,
        'core_style_guide_id', v_rec.core_style_guide_id,
        'core_franchise_id', v_rec.core_franchise_id,
        'dam_asset_id', v_rec.dam_asset_id,
        'is_current', true
      ),
      'reason', 'matched direct_source_assertion relationship decision under authorized complete capture'
    );
    v_rel_ops := v_rel_ops || jsonb_build_array(v_op);
    v_rel_count := v_rel_count + 1;
  end loop;

  -- -----------------------------------------------------------------------
  -- RETIREMENT OPERATIONS. Absence from a complete capture retires ONLY that
  -- source's support. The operation vocabulary has no DELETE: a canonical entity is
  -- never hard-deleted because a source stopped listing it, and a historical edge is
  -- never destroyed. This is the "no hard delete of missing source records" rule,
  -- enforced by construction rather than by review.
  --
  -- A retirement is planned when a matched decision names a source identity that the
  -- capture membership no longer contains. Membership is source-specific and is
  -- probed the same fail-closed way as completeness: if we cannot see the landing
  -- rows we do not invent retirements.
  -- -----------------------------------------------------------------------
  for v_rec in
    select sr.entity_kind, sr.source_id,
           sr.core_property_id, sr.core_licensor_id
      from plm.source_resolution sr
     where sr.source_system = v_source
       and sr.resolution_status = 'matched'
       and sr.entity_kind in ('property', 'licensor')
     order by sr.entity_kind, sr.source_id
  loop
    declare
      v_present boolean := true;
    begin
      begin
        if v_rec.entity_kind = 'property' and v_source = 'paramount'
           and v_rec.source_id ~ '^-?[0-9]{1,19}$' then
          execute 'select exists(select 1 from plm.pmt_property
                                 where capture_id = $1
                                   and property_source_id = $2::bigint)'
            into v_present using p_capture_id, v_rec.source_id;
        elsif v_rec.entity_kind = 'property' and v_source = 'nbcu' then
          execute 'select exists(select 1 from plm.nbcu_property
                                 where capture_id = $1
                                   and (property_source_id = $2 or property_key = $2))'
            into v_present using p_capture_id, v_rec.source_id;
        end if;
      exception when undefined_table or undefined_column or invalid_text_representation then
        v_present := true; -- cannot prove absence; do not invent a retirement
      end;

      if not coalesce(v_present, true) then
        v_op := jsonb_build_object(
          'op_key', 'retire:' || v_rec.entity_kind || ':' || v_rec.source_id,
          'op', 'retire_entity_support',
          'entity_kind', v_rec.entity_kind,
          'source_system', v_source,
          'source_id', v_rec.source_id,
          'canonical_id', case
            when v_rec.entity_kind = 'property' then v_rec.core_property_id
            when v_rec.entity_kind = 'licensor' then v_rec.core_licensor_id
          end,
          'before', jsonb_build_object('source_support', 'current'),
          'after', jsonb_build_object('source_support', 'retired'),
          'evidence_kind', 'direct_source_assertion',
          'reason', 'absent from complete capture; retire this source support only, never hard-delete'
        );
        v_retire_ops := v_retire_ops || jsonb_build_array(v_op);
        v_retire_count := v_retire_count + 1;
      end if;
    end;
  end loop;

  -- -----------------------------------------------------------------------
  -- Assemble, sort deterministically, hash.
  -- -----------------------------------------------------------------------
  v_all_ops := v_entity_ops || v_rel_ops || v_retire_ops;
  -- Sort by op_key so the hash does not depend on discovery order.
  select coalesce(jsonb_agg(elem order by elem->>'op_key'), '[]'::jsonb)
    into v_all_ops
    from jsonb_array_elements(v_all_ops) as elem;

  -- Rollback is the inverse, computed now so rollback evidence cannot be lost.
  select coalesce(jsonb_agg(
           jsonb_build_object(
             'op_key', 'rollback:' || (elem->>'op_key'),
             'op', case (elem->>'op')
                      when 'update_entity' then 'update_entity'
                      when 'upsert_relationship_support' then 'retire_relationship_support'
                      when 'retire_entity_support' then 'update_entity'
                      else elem->>'op'
                    end,
             'entity_kind', elem->'entity_kind',
             'relationship_kind', elem->'relationship_kind',
             'source_system', elem->'source_system',
             'source_id', elem->'source_id',
             'canonical_id', elem->'canonical_id',
             'target_table', elem->'target_table',
             'before', elem->'after',
             'after', elem->'before',
             'evidence_kind', elem->'evidence_kind',
             'reason', 'rollback of ' || (elem->>'op_key')
           ) order by elem->>'op_key'), '[]'::jsonb)
    into v_rollback_ops
    from jsonb_array_elements(v_all_ops) as elem
   where (elem->>'op') <> 'noop';

  v_canonical := pg_catalog.jsonb_build_object(
    'source_system', v_source,
    'capture_id', p_capture_id::text,
    'operations', v_all_ops
  )::text;
  v_plan_hash := encode(extensions.digest(v_canonical, 'sha256'), 'hex');

  -- Idempotent re-plan: identical decisions produce an identical hash, and the unique
  -- key returns the existing row instead of a duplicate.
  select * into v_existing
    from plm.licensing_consolidation_plan
   where source_system = v_source
     and capture_id = p_capture_id
     and plan_hash = v_plan_hash;
  if found then
    return v_existing;
  end if;

  insert into plm.licensing_consolidation_plan (
    source_system, capture_id, plan_hash,
    plan_status, capture_complete, source_scope_checked, collision_count,
    entity_operation_count, relationship_operation_count, retire_operation_count,
    operations, rollback_operations, refusal_reason, planned_by
  ) values (
    v_source, p_capture_id, v_plan_hash,
    case when v_scope_ok and v_collision_count = 0 then 'preview' else 'refused' end,
    true,
    v_scope_ok,
    v_collision_count,
    v_entity_count, v_rel_count, v_retire_count,
    v_all_ops, v_rollback_ops,
    v_refusal,
    v_actor
  )
  returning * into v_row;
  return v_row;
end;
$function$;

comment on function plm.plan_licensing_consolidation(text, uuid, text) is
  'Hash-pinned consolidation preview (issue #2336). Builds a deterministic plan of '
  'canonical writes from matched plm.source_resolution and '
  'plm.licensing_relationship_resolution decisions under a complete capture and '
  'authorized source scope. Gates: complete-capture, source-scope, collision. Refuses '
  'any inferred/co-occurrence promotion. Plans retirement of source support for missing '
  'records and never plans a hard delete. Re-planning identical decisions returns the '
  'same plan row (idempotent). Service-role only.';

revoke all on function plm.plan_licensing_consolidation(text, uuid, text)
  from public, anon, authenticated;
grant execute on function plm.plan_licensing_consolidation(text, uuid, text)
  to service_role;


-- =====================================================================================
-- PART 3 -- the apply function
-- =====================================================================================
-- Applies exactly one hash-pinned plan. Every gate is re-checked against the live
-- world before any write; drift since planning is conflict refusal, not a reason to
-- apply a plan that no longer describes reality.

create or replace function plm.apply_licensing_consolidation(
  p_plan_id uuid,
  p_expected_hash text
)
returns plm.licensing_consolidation_plan
language plpgsql
security definer
set search_path to pg_catalog
as $function$
declare
  v_actor text := coalesce(
    auth.uid()::text,
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    session_user::text
  );
  v_plan plm.licensing_consolidation_plan%rowtype;
  v_recomputed text;
  v_op record;
  v_target_licensor uuid;
  v_auth_id uuid;
  v_changed text[];
  v_before_status text;
  v_noop_count integer := 0;
  v_write_count integer := 0;
begin
  if coalesce(v_actor, '') = '' then
    raise exception using errcode = '42501',
      message = 'licensing consolidation apply requires an authenticated actor';
  end if;
  if p_plan_id is null or btrim(coalesce(p_expected_hash, '')) = '' then
    raise exception using errcode = '22023',
      message = 'apply_licensing_consolidation requires a plan_id and an expected_hash';
  end if;
  if p_expected_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023',
      message = 'expected_hash must be 64 lowercase hex characters';
  end if;

  -- Serialize appliers of the same plan.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    pg_catalog.concat_ws(chr(31), 'licensing_consolidation_apply', p_plan_id::text), 0));

  select * into v_plan
    from plm.licensing_consolidation_plan
   where id = p_plan_id
   for update;

  if not found then
    raise exception using errcode = 'P0002',
      message = 'licensing consolidation plan does not exist';
  end if;

  -- CONFLICT REFUSAL: the caller must echo the exact hash they reviewed.
  if v_plan.plan_hash <> p_expected_hash then
    raise exception using errcode = '40001',
      message = 'licensing consolidation plan hash mismatch; reload the plan and re-review',
      detail = format('stored %s, expected %s', v_plan.plan_hash, p_expected_hash);
  end if;

  -- CONFLICT REFUSAL: the stored content must still hash to the pinned value. The
  -- immutability trigger makes this unreachable by ordinary writes; this check is the
  -- second leg, and it is what proves dry-run/apply parity to a reviewer.
  v_recomputed := encode(extensions.digest(
    pg_catalog.jsonb_build_object(
      'source_system', v_plan.source_system,
      'capture_id', v_plan.capture_id::text,
      'operations', v_plan.operations
    )::text, 'sha256'), 'hex');
  if v_recomputed <> v_plan.plan_hash then
    raise exception using errcode = '40001',
      message = 'licensing consolidation plan content does not match its pinned hash; refusing to apply';
  end if;

  -- IDEMPOTENCY: an already-applied plan with the same hash is a successful no-op.
  if v_plan.plan_status = 'applied' then
    return v_plan;
  end if;

  if v_plan.plan_status = 'refused' then
    raise exception using errcode = '40001',
      message = 'licensing consolidation plan was refused at planning and cannot be applied',
      detail = coalesce(v_plan.refusal_reason, 'no reason recorded');
  end if;

  if not v_plan.capture_complete then
    raise exception using errcode = '40001',
      message = 'licensing consolidation apply refused: plan was not built from a complete capture';
  end if;

  -- Re-check complete-capture against the live world. A capture that was complete at
  -- plan time and is not now is drift; applying anyway would consolidate from a
  -- superseded picture.
  if v_plan.source_system = 'paramount' then
    perform 1 from plm.pmt_capture
     where capture_id = v_plan.capture_id
       and status = 'complete' and capture_kind = 'full';
  elsif v_plan.source_system = 'nbcu' then
    perform 1 from plm.nbcu_capture
     where id = v_plan.capture_id and status = 'complete';
  elsif v_plan.source_system = 'disney_opa' then
    perform 1 from plm.opa_capture
     where id = v_plan.capture_id and status = 'complete';
  elsif v_plan.source_system in ('disney_dcpvault', 'lucasfilm_dcpvault',
                                 'marvel_dcpvault', 'twentieth_century_dcpvault') then
    perform 1 from plm.dcp_crawl
     where crawl_id = v_plan.capture_id and status = 'complete';
  elsif v_plan.source_system = 'wildbrain' then
    perform 1 from plm.wildbrain_capture
     where id = v_plan.capture_id and status = 'complete';
  elsif v_plan.source_system like 'warner:%' then
    perform 1 from plm.wb_capture
     where capture_id = v_plan.capture_id and chunk_number = 0 and status = 'complete';
  else
    -- Fail closed (Muse finding 8). An unlisted source has no capture root we can
    -- re-check; "we did not look" must never read as "it is still complete".
    raise exception using errcode = '40001',
      message = 'licensing consolidation apply refused: unknown source_system cannot re-prove complete capture';
  end if;
  if not found then
    raise exception using errcode = '40001',
      message = 'licensing consolidation apply refused: capture is no longer complete';
  end if;

  -- -----------------------------------------------------------------------
  -- WRITE-AUTHORIZATION GATE. The Step 1.0 guard is a ROW-LEVEL trigger that
  -- consumes its authorization on the first protected write, and its unique key
  -- allows one authorization row per (backend_pid, transaction_id, target_table,
  -- write_kind, plan_id, plan_hash). This apply therefore obtains exactly ONE
  -- scrape_consolidation grant per target table. The plan-time
  -- authorization-shape gate already refused any plan carrying more than one
  -- entity write to a table, so each grant covers exactly one protected row
  -- write and the consumption semantics are satisfied.
  -- -----------------------------------------------------------------------
  declare
    v_auth_tables text[] := '{}'::text[];
    v_auth_table text;
    v_auth_cols text[];
  begin
    -- Re-check the one-write-per-table shape against the STORED plan, not just the
    -- plan-time gate. A preview row that somehow carries two same-table entity
    -- writes would still 23505 on the grant insert; refuse before touching the
    -- guard table (DeepSeek finding 3).
    if exists (
      select 1 from jsonb_array_elements(v_plan.operations) as e(elem)
       where elem->>'op' = 'update_entity'
       group by elem->>'target_table'
      having count(*) > 1
    ) then
      raise exception using errcode = '40001',
        message = 'licensing consolidation apply refused: plan carries more than one entity write to one table';
    end if;

    for v_auth_table, v_auth_cols in
      select s.tgt,
             array_remove(array[s.c_name, s.c_code, s.c_licensor, s.c_status], null)
        from jsonb_array_elements(v_plan.operations) as e(elem),
             lateral (select elem->>'target_table' as tgt,
                             case when elem->'before'->>'name' is distinct from elem->'after'->>'name'
                                  then 'name' end as c_name,
                             case when elem->'before'->>'code' is distinct from elem->'after'->>'code'
                                  then 'code' end as c_code,
                             case when elem->'before'->>'licensor_id' is distinct from elem->'after'->>'licensor_id'
                                  then 'licensor_id' end as c_licensor,
                             case when elem->'before'->>'status' is distinct from elem->'after'->>'status'
                                  then 'status' end as c_status
                     ) as s
       where elem->>'op' = 'update_entity'
         and elem->'before' is distinct from elem->'after'
       group by s.tgt, s.c_name, s.c_code, s.c_licensor, s.c_status
    loop
      if cardinality(coalesce(v_auth_cols, '{}')) = 0 then
        continue;
      end if;
      insert into plm.licensing_write_authorization (
        backend_pid, transaction_id, target_table, write_kind,
        plan_id, plan_hash, actor, protected_columns, expires_at
      ) values (
        pg_backend_pid(), txid_current(),
        v_auth_table::regclass,
        'scrape_consolidation',
        v_plan.id, v_plan.plan_hash, v_actor, v_auth_cols,
        clock_timestamp() + interval '5 minutes'
      );
      v_auth_tables := array_append(v_auth_tables, v_auth_table);
    end loop;
  end;

  -- -----------------------------------------------------------------------
  -- Execute operations. The operation vocabulary has no DELETE, by construction.
  -- Protected core.licensor / core.property writes go through a transaction-bound
  -- scrape_consolidation authorization that the Step 1.0 guard consumes.
  -- -----------------------------------------------------------------------
  for v_op in
    select elem
      from jsonb_array_elements(v_plan.operations) as elem
     order by elem->>'op_key'
  loop
    if v_op.elem->>'op' = 'noop' then
      v_noop_count := v_noop_count + 1;
      continue;
    end if;

    if v_op.elem->>'op' = 'update_entity' then
      v_target_licensor := nullif(v_op.elem->'after'->>'licensor_id', '')::uuid;

      -- Source-scope gate, re-checked live.
      if v_op.elem->>'target_table' = 'core.property' then
        if v_target_licensor is null then
          select p.licensor_id into v_target_licensor
            from core.property p
           where p.id = (v_op.elem->>'canonical_id')::uuid;
        end if;
      elsif v_op.elem->>'target_table' = 'core.licensor' then
        -- The licensor row IS the scope subject (Muse finding 2).
        v_target_licensor := (v_op.elem->>'canonical_id')::uuid;
      end if;

      if v_target_licensor is not null and not exists (
        select 1 from plm.licensing_source_scope s
         where s.licensor_id = v_target_licensor
           and s.source_system = v_plan.source_system
           and s.source_purpose = 'canonical_identity'
           and s.scope_axis = 'entity'
           and s.permitted_kind = (v_op.elem->>'entity_kind')
           and s.authorized_at is not null
           and s.authorized_by is not null
      ) then
        raise exception using errcode = '40001',
          message = 'licensing consolidation apply refused: source scope no longer authorizes '
                    || v_plan.source_system || '/' || (v_op.elem->>'entity_kind');
      end if;

      -- Only write when the after-values actually differ. An update-to-self must not
      -- consume an authorization row or rewrite an audit stamp -- that is what makes
      -- a second identical apply a true no-op even before the applied short-circuit.
      if v_op.elem->'before' = v_op.elem->'after' then
        v_noop_count := v_noop_count + 1;
        continue;
      end if;

      v_changed := '{}'::text[];
      if v_op.elem->'before'->>'name' is distinct from v_op.elem->'after'->>'name' then
        v_changed := array_append(v_changed, 'name');
      end if;
      if v_op.elem->'before'->>'code' is distinct from v_op.elem->'after'->>'code' then
        v_changed := array_append(v_changed, 'code');
      end if;
      if v_op.elem->'before'->>'licensor_id' is distinct from v_op.elem->'after'->>'licensor_id' then
        v_changed := array_append(v_changed, 'licensor_id');
      end if;
      if v_op.elem->'before'->>'status' is distinct from v_op.elem->'after'->>'status' then
        v_changed := array_append(v_changed, 'status');
      end if;

      if cardinality(v_changed) = 0 then
        v_noop_count := v_noop_count + 1;
        continue;
      end if;

      -- The per-table scrape_consolidation authorization was obtained above. The
      -- Step 1.0 trigger consumes it on the first protected write; the plan-time
      -- authorization-shape gate guarantees every write on this table in this
      -- apply changes exactly the column set that grant carries.
      if v_op.elem->>'target_table' = 'core.property' then
        update core.property
           set name = coalesce(v_op.elem->'after'->>'name', name),
               code = nullif(v_op.elem->'after'->>'code', ''),
               licensor_id = coalesce(nullif(v_op.elem->'after'->>'licensor_id', '')::uuid, licensor_id),
               updated_at = clock_timestamp()
         where id = (v_op.elem->>'canonical_id')::uuid;
      elsif v_op.elem->>'target_table' = 'core.licensor' then
        update core.licensor
           set name = coalesce(v_op.elem->'after'->>'name', name),
               code = nullif(v_op.elem->'after'->>'code', ''),
               updated_at = clock_timestamp()
         where id = (v_op.elem->>'canonical_id')::uuid;
      else
        raise exception using errcode = '40001',
          message = 'licensing consolidation apply refused: unknown target_table '
                    || coalesce(v_op.elem->>'target_table', '(null)');
      end if;

      v_write_count := v_write_count + 1;

    elsif v_op.elem->>'op' = 'retire_entity_support' then
      -- Retirement is support-only. There is no DELETE in this branch and none in the
      -- operation vocabulary. The canonical row keeps its identity and last-seen
      -- history; only this source's claim of current support is retired, recorded on
      -- the plan as the audit fact. (A future adapter may also flip a source-edge
      -- is_current flag; that is a source-edge write and is deliberately not invented
      -- here without the exact bridge object in scope.)
      v_write_count := v_write_count + 1;

    elsif v_op.elem->>'op' = 'upsert_relationship_support'
          or v_op.elem->>'op' = 'retire_relationship_support' then
      -- Relationship support writes target the #2334 source-edge tables, which are
      -- outside this engine's write authorization surface (the Step 1.0 guard covers
      -- core.licensor and core.property only). The operation is planned and recorded
      -- so the adapter that owns the bridge can execute it under its own claim; the
      -- engine refuses to write a bridge table it is not authorized for.
      -- Re-check the non-promotion rule one more time at the point of execution.
      if v_op.elem->>'op' = 'upsert_relationship_support'
         and coalesce(v_op.elem->>'evidence_kind', '') <> 'direct_source_assertion' then
        raise exception using errcode = '40001',
          message = 'licensing consolidation apply refused: inferred/co-occurrence evidence can never be promoted';
      end if;
      v_noop_count := v_noop_count + 1;

    else
      raise exception using errcode = '40001',
        message = 'licensing consolidation apply refused: unknown operation '
                  || coalesce(v_op.elem->>'op', '(null)');
    end if;
  end loop;

  -- Mark applied. The immutability trigger permits exactly this lifecycle change.
  update plm.licensing_consolidation_plan
     set plan_status = 'applied',
         applied_at = clock_timestamp(),
         applied_by = v_actor
   where id = v_plan.id
   returning * into v_plan;

  return v_plan;
end;
$function$;

comment on function plm.apply_licensing_consolidation(uuid, text) is
  'Hash-pinned consolidation apply (issue #2336). Requires the caller to echo the exact '
  'plan hash; re-derives the hash from stored content and refuses on mismatch; re-checks '
  'complete-capture and source-scope live and refuses on drift; writes protected '
  'core.licensor / core.property columns only through a transaction-bound '
  'scrape_consolidation authorization consumed by the Step 1.0 guard. Idempotent: an '
  'already-applied plan is a successful no-op. Never hard-deletes. Never promotes '
  'inferred or co-occurrence evidence. Service-role only.';

revoke all on function plm.apply_licensing_consolidation(uuid, text)
  from public, anon, authenticated;
grant execute on function plm.apply_licensing_consolidation(uuid, text)
  to service_role;


-- =====================================================================================
-- POST-APPLY VERIFICATION
-- =====================================================================================
-- Catalogue-only. Asserts the SHAPE that landed -- the three claimed objects, their
-- privileges, the hash constraint, the immutability trigger -- and never reads or
-- writes plan rows, so apply cost does not grow with data.
do $verify$
declare
  v_count integer;
begin
  if to_regclass('plm.licensing_consolidation_plan') is null then
    raise exception 'plm.licensing_consolidation_plan was not created';
  end if;

  if to_regprocedure('plm.plan_licensing_consolidation(text,uuid,text)') is null then
    raise exception 'plm.plan_licensing_consolidation(text,uuid,text) was not created';
  end if;
  if to_regprocedure('plm.apply_licensing_consolidation(uuid,text)') is null then
    raise exception 'plm.apply_licensing_consolidation(uuid,text) was not created';
  end if;

  -- Both are pinned SECURITY DEFINER, or they are a privilege escalation.
  select count(*) into v_count
    from pg_catalog.pg_proc p
   where p.oid in (
           to_regprocedure('plm.plan_licensing_consolidation(text,uuid,text)'),
           to_regprocedure('plm.apply_licensing_consolidation(uuid,text)'))
     and p.prosecdef
     and p.proconfig @> array['search_path=pg_catalog'];
  if v_count <> 2 then
    raise exception 'both consolidation functions must be security definer with pinned search_path (found %)', v_count;
  end if;

  -- Service-role only. anon and authenticated must not plan or apply.
  if has_function_privilege('anon',
       to_regprocedure('plm.plan_licensing_consolidation(text,uuid,text)'), 'execute')
     or has_function_privilege('authenticated',
       to_regprocedure('plm.plan_licensing_consolidation(text,uuid,text)'), 'execute')
     or has_function_privilege('anon',
       to_regprocedure('plm.apply_licensing_consolidation(uuid,text)'), 'execute')
     or has_function_privilege('authenticated',
       to_regprocedure('plm.apply_licensing_consolidation(uuid,text)'), 'execute') then
    raise exception 'anon and authenticated must not execute the consolidation functions';
  end if;
  if not has_function_privilege('service_role',
       to_regprocedure('plm.plan_licensing_consolidation(text,uuid,text)'), 'execute')
     or not has_function_privilege('service_role',
       to_regprocedure('plm.apply_licensing_consolidation(uuid,text)'), 'execute') then
    raise exception 'service_role must be able to execute the consolidation functions';
  end if;

  -- The plan table is fail-closed: readable, not writable, by any client role.
  if has_table_privilege('authenticated', to_regclass('plm.licensing_consolidation_plan'), 'insert')
     or has_table_privilege('service_role', to_regclass('plm.licensing_consolidation_plan'), 'insert')
     or has_table_privilege('authenticated', to_regclass('plm.licensing_consolidation_plan'), 'update')
     or has_table_privilege('service_role', to_regclass('plm.licensing_consolidation_plan'), 'delete') then
    raise exception 'plm.licensing_consolidation_plan must have no client write grant';
  end if;
  if not has_table_privilege('authenticated', to_regclass('plm.licensing_consolidation_plan'), 'select') then
    raise exception 'authenticated must be able to read plm.licensing_consolidation_plan';
  end if;
  if has_table_privilege('anon', to_regclass('plm.licensing_consolidation_plan'), 'select') then
    raise exception 'anon must not read plm.licensing_consolidation_plan';
  end if;

  -- RLS on.
  select count(*) into v_count
    from pg_catalog.pg_class c
   where c.oid = to_regclass('plm.licensing_consolidation_plan')
     and c.relrowsecurity;
  if v_count <> 1 then
    raise exception 'plm.licensing_consolidation_plan must have row level security enabled';
  end if;

  -- The immutability trigger is installed.
  select count(*) into v_count
    from pg_catalog.pg_trigger t
   where t.tgrelid = to_regclass('plm.licensing_consolidation_plan')
     and t.tgname = 'licensing_consolidation_plan_immutable_trg'
     and not t.tgisinternal;
  if v_count <> 1 then
    raise exception 'the plan immutability trigger was not installed';
  end if;

  -- The hash shape is pinned to the same 64-hex the write-authorization table requires.
  select count(*) into v_count
    from pg_catalog.pg_constraint
   where conrelid = to_regclass('plm.licensing_consolidation_plan')
     and conname = 'licensing_consolidation_plan_hash_chk';
  if v_count <> 1 then
    raise exception 'the plan hash constraint was not created';
  end if;

  raise notice 'hash-pinned licensing consolidation verified: plan table, two service-role functions, immutability trigger';
end;
$verify$;
