-- =====================================================================================
-- Licensing source authority and relationship decisions.
--
-- Migration: 20260907051735_licensing_source_authority_and_relationship_decisions.sql
-- Issue:     u2giants/shared-db #2335 (structural successor to #1090)
-- Claim:     table    plm.source_resolution
--            function plm.set_source_resolution
--            function api.set_source_resolution
--            table    plm.licensing_source_scope
--            table    plm.licensing_relationship_resolution
--            Nothing else. Reads only: core.licensor, core.property, core.character,
--            core.style_guide, core.franchise, dam.asset.
-- derived-from: none
--
-- Depends on (exact 14-digit versions):
--   20260902024541  source_resolution_supported_home -- creates plm.source_resolution,
--                   plm.set_source_resolution and the three constraints widened below.
--   20260902031743  api_set_source_resolution -- creates the browser-reachable wrapper.
--   20260903015023  source_resolution_wildbrain_vocabulary -- the source_system
--                   vocabulary, which this file does NOT touch. Its temporary-probe
--                   verification technique is reused below.
--   20260905104420  source_resolution_warner_namespace_required -- same, unchanged here.
--   20260905083426  core_franchise_canonical_entity (#2333) -- creates core.franchise,
--                   one of the two entity kinds this file adds to the resolution
--                   vocabulary. READ ONLY.
--   20260907030418  canonical_licensing_relationship_bridges (#2334) -- creates
--                   core.relationship_evidence_kind and the eight canonical relationship
--                   bridges whose names are the relationship vocabulary used below. The
--                   enum type is REFERENCED, never altered.
--
-- LOADS NO DATA. No resolution decision, no scope row, no relationship decision and no
-- curated licensing row is inserted by this file. u2giants/shared-db is a PUBLIC
-- repository: SCHEMA IN GIT, DATA OUT OF GIT.
--
-- -------------------------------------------------------------------------------------
-- 1. WHY LICENSOR AND FRANCHISE ARE MISSING FROM THE DURABLE DECISION HOME
--
-- plm.source_resolution is the durable, capture-independent home for "this source key IS
-- that canonical thing". It understands four entity kinds: property, character,
-- style_guide, asset. #2333 created core.franchise, and core.licensor has existed since
-- the foundation, so two of the six things a licensing analyst actually resolves have
-- nowhere durable to record a decision. Every such decision therefore lives in a
-- per-capture landing column and is lost on the next capture.
--
-- This file adds the two missing kinds, and the two target columns they need, to the
-- existing table. It changes NOTHING about the four kinds already there: their target
-- rules are re-asserted verbatim below and proved unchanged by real inserts.
--
-- -------------------------------------------------------------------------------------
-- 2. WHY A TWELVE-ARGUMENT OVERLOAD AND NOT A WIDER SETTER
--
-- The obvious change is to add two parameters to plm.set_source_resolution. That is
-- REFUSED here, and not for taste:
--
--   * scripts/production_catalog_verification.py pins the EXACT signature
--     plm.set_source_resolution(text,text,text,text,uuid,uuid,uuid,uuid,text,
--     timestamp with time zone) inside SOURCE_RESOLUTION_SUPPORTED_HOME_CONTRACT, and
--     separately requires the literal text "for key share" to be present in THAT
--     routine's definition. Replacing the ten-argument function with a delegator would
--     leave the production contract asserting a routine whose body no longer contains
--     the needle it checks -- the promotion would go red on a database that is exactly
--     right. That file is not in this claim and must not be edited from here.
--   * supabase/tests/source_resolution_coherence_contracts.sql and
--     supabase/tests/api_set_source_resolution_contracts.sql resolve the same
--     ten-argument signatures with ::regprocedure.
--
-- So the ten-argument functions are LEFT EXACTLY AS THEY ARE -- this file does not
-- contain them -- and a twelve-argument overload is added beside each.
--
-- EVERY PARAMETER OF THE NEW OVERLOAD IS MANDATORY. That is what keeps the two functions
-- from ever competing for the same call, and it is forced rather than chosen: PostgreSQL
-- requires that once a parameter has a default, every parameter after it has one too, so
-- the two new arguments cannot simply be appended without defaults to a signature whose
-- fifth parameter already defaults. Giving them defaults instead would make a
-- ten-argument call match BOTH functions and fail with 42725 -- exactly the breakage
-- this design exists to avoid. With no defaults anywhere on the new overload:
--
--   * a call with four to ten arguments can only reach the old function;
--   * a call with twelve arguments can only reach the new one;
--   * there is no argument count both can accept, so no call is ambiguous.
--
-- This is proved rather than asserted: the contract test executes the old call shapes
-- and requires them to still resolve to the ten-argument routine.
--
-- The cost is that two bodies now implement the same rules. That duplication is real and
-- is stated here rather than hidden: the ten-argument body is FROZEN legacy surface, it
-- must not be extended, and it refuses "licensor" and "franchise" with SQLSTATE 23503
-- because its target-validation CASE has no branch for them. What makes the duplication
-- safe is that neither function is the enforcement of record -- the table CHECK
-- constraints are, and both functions write the same table through them. A divergence in
-- the functions cannot put a row into plm.source_resolution that the constraints below
-- would not have accepted from either path.
--
-- -------------------------------------------------------------------------------------
-- 3. A KNOWN, DELIBERATELY CONSERVATIVE READ-SIDE LIMITATION
--
-- api.source_resolution computes target_missing by calling
-- plm.source_resolution_target_missing(text,uuid,uuid,uuid,uuid). Neither that function
-- nor that view is in this claim, and neither can be widened from here. Its CASE returns
-- TRUE for any entity kind it does not know, so a MATCHED licensor or franchise decision
-- reads through that view as target_missing = true.
--
-- That is the fail-safe direction, not a false statement: the view comment already tells
-- consumers that target_missing keeps possibly-dangling decisions VISIBLE and that a
-- missing target must never be read as an absent decision. The signal errs toward "look
-- at this", never toward "this is sound". The new target columns are also not selected by
-- that view, so no consumer can silently mistake a licensor decision for a property one.
-- The issue itself scopes the browser candidate and review APIs to a separate successor;
-- widening the helper and the view belongs there. The behaviour is PINNED by
-- supabase/tests/licensing_source_authority_and_relationship_decisions.sql so it cannot
-- change unnoticed and so the successor has a failing-if-forgotten reminder.
--
-- -------------------------------------------------------------------------------------
-- 4. SOURCE IDS COLLIDE ACROSS LICENSORS
--
-- Disney and Sega both number from small integers. Every key, unique constraint and index
-- introduced below therefore carries licensor_id as part of the identity, never a bare
-- (source_system, source_id) pair. A bare key would attribute one licensor scope grant or
-- relationship decision to another licensor, which is a royalty error. Both new tables
-- are proved by the contract test to hold two rows that differ ONLY by licensor.
--
-- plm.source_resolution itself is the one place this does NOT change: its identity is
-- (source_system, entity_kind, source_id), and source_system already carries the licensor
-- dimension by construction -- paramount, disney_opa, warner:<namespace> and so on are
-- per-licensor tokens, which is exactly why that vocabulary is a pinned CHECK. Adding a
-- licensor column to its key would create a SECOND, unpoliced way to say the same thing.
-- Its vocabulary is untouched by this file.
--
-- -------------------------------------------------------------------------------------
-- 5. NO WRITE PATH IS OPENED FOR THE TWO NEW TABLES, AND NO TRIGGER IS CREATED
--
-- Neither new table gets an INSERT/UPDATE/DELETE grant, for any role, including
-- service_role -- exactly the posture plm.source_resolution has held since
-- 20260902024541, where the only write path is a SECURITY DEFINER setter. This issue
-- claims no setter for the two new tables and authorizes no rows, so they land
-- fail-closed: readable by authenticated under RLS, writable by nobody but the migration
-- owner, until a governed successor adds an audited setter. A table that cannot be
-- written cannot be written WRONGLY in the meantime.
--
-- That is also why this file creates NO trigger and NO trigger function. A BEFORE UPDATE
-- guard would be a new object outside the claim, and it would guard a table no role may
-- update. Every invariant below is therefore a CHECK constraint, which is evaluated on
-- every write from every path including the owner path, cannot be skipped, and -- unlike
-- an unscoped BEFORE UPDATE guard of the kind 20260907030418 had to repair -- cannot
-- freeze a row because some other table changed.
--
-- -------------------------------------------------------------------------------------
-- 6. LOCKING
--
-- The two new tables are created empty in this transaction, so their indexes are built on
-- zero rows and CREATE INDEX CONCURRENTLY is neither possible (it cannot run inside a
-- transaction block) nor needed. The only pre-existing object touched is
-- plm.source_resolution: ADD COLUMN with no default and no NOT NULL is metadata-only, and
-- the three CHECK constraints are dropped and re-added, which takes an ACCESS EXCLUSIVE
-- lock on that table for one validating scan. plm.source_resolution is written only by an
-- interactive analyst decision through the audited setter, so that scan is bounded by a
-- very small table. The re-add is VALIDATING on purpose: if a row exists that the widened
-- rules would reject, the apply must stop rather than strand it.
-- =====================================================================================


-- =====================================================================================
-- PART 1 -- the Licensor and Franchise entity vocabulary
-- =====================================================================================

-- Two new decision targets. Nullable and without foreign keys, exactly like the four that
-- came before: the owner ruling on this table is that a durable human decision must not
-- be destroyed, invalidated or blocked by the lifecycle of the row it points at. Every FK
-- action available does one of those.
alter table plm.source_resolution
  add column if not exists core_licensor_id  uuid null,
  add column if not exists core_franchise_id uuid null;

comment on column plm.source_resolution.core_licensor_id is
  'Canonical core.licensor the source key resolves to, for entity_kind = licensor. '
  'Deliberately has no foreign key, like every other target column on this table.';
comment on column plm.source_resolution.core_franchise_id is
  'Canonical core.franchise the source key resolves to, for entity_kind = franchise. '
  'Deliberately has no foreign key, like every other target column on this table.';

-- A CHECK expression cannot be edited in place. All three are dropped and re-added under
-- their canonical names -- the names are pinned by
-- SOURCE_RESOLUTION_SUPPORTED_HOME_CONTRACT and by
-- supabase/tests/source_resolution_backfill_contracts.sql, so they are preserved exactly
-- and no new constraint name is introduced on this table.
alter table plm.source_resolution
  drop constraint if exists source_resolution_entity_kind_chk,
  drop constraint if exists source_resolution_target_kind_chk,
  drop constraint if exists source_resolution_matched_target_chk;

alter table plm.source_resolution
  add constraint source_resolution_entity_kind_chk
    check (entity_kind in ('property','character','style_guide','asset','licensor','franchise')),
  -- Exactly one target column may be populated, and WHICH one is decided by the kind.
  -- The four pre-existing branches keep their original meaning and additionally exclude
  -- the two new columns, so a property decision can never smuggle a franchise target.
  add constraint source_resolution_target_kind_chk check (
    case entity_kind
      when 'property' then core_character_id is null and core_style_guide_id is null
        and dam_asset_id is null and core_licensor_id is null and core_franchise_id is null
      when 'character' then core_property_id is null and core_style_guide_id is null
        and dam_asset_id is null and core_licensor_id is null and core_franchise_id is null
      when 'style_guide' then core_property_id is null and core_character_id is null
        and dam_asset_id is null and core_licensor_id is null and core_franchise_id is null
      when 'asset' then core_property_id is null and core_character_id is null
        and core_style_guide_id is null and core_licensor_id is null and core_franchise_id is null
      when 'licensor' then core_property_id is null and core_character_id is null
        and core_style_guide_id is null and dam_asset_id is null and core_franchise_id is null
      when 'franchise' then core_property_id is null and core_character_id is null
        and core_style_guide_id is null and dam_asset_id is null and core_licensor_id is null
      else false
    end
  ),
  add constraint source_resolution_matched_target_chk check (
    (resolution_status = 'matched') =
    (num_nonnulls(core_property_id, core_character_id, core_style_guide_id, dam_asset_id,
                  core_licensor_id, core_franchise_id) = 1)
  );

comment on column plm.source_resolution.entity_kind is
  'What the source key names: property, character, style_guide, asset, licensor or '
  'franchise. Pinned by source_resolution_entity_kind_chk. Which target column may be '
  'populated is decided by this value in source_resolution_target_kind_chk.';


-- =====================================================================================
-- PART 2 -- the audited setter, widened by overload
-- =====================================================================================
-- Read part 2 of the header before changing anything here. The ten-argument functions are
-- NOT in this file and must not be replaced; these are additional overloads, and every
-- parameter is mandatory so that no call can be ambiguous between them.

create or replace function plm.set_source_resolution(
  p_source_system text,
  p_entity_kind text,
  p_source_id text,
  p_resolution_status text,
  p_core_property_id uuid,
  p_core_character_id uuid,
  p_core_style_guide_id uuid,
  p_dam_asset_id uuid,
  p_resolution_reason text,
  p_expected_updated_at timestamptz,
  p_core_licensor_id uuid,
  p_core_franchise_id uuid
)
returns plm.source_resolution
language plpgsql
security definer
set search_path to pg_catalog
as $function$
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
$function$;

comment on function plm.set_source_resolution(
  text,text,text,text,uuid,uuid,uuid,uuid,text,timestamptz,uuid,uuid) is
  'Six-kind write path for durable source resolution (issue #2335). Identical in every '
  'rule to the ten-argument overload beside it -- authenticated actor, validated and '
  'locked matched target, first-writer serialization, identical-repeat short circuit, '
  'optimistic updated_at token -- and additionally understands entity_kind licensor and '
  'franchise. Every parameter is mandatory so no call is ambiguous between the two '
  'overloads. The ten-argument overload is frozen legacy surface pinned by the production '
  'catalog contract; new callers use this one.';

revoke all on function plm.set_source_resolution(
  text,text,text,text,uuid,uuid,uuid,uuid,text,timestamptz,uuid,uuid) from public, anon;
grant execute on function plm.set_source_resolution(
  text,text,text,text,uuid,uuid,uuid,uuid,text,timestamptz,uuid,uuid)
  to authenticated, service_role;

-- The browser-reachable wrapper. Thin delegation on purpose: any validation copied here
-- would be a second, silently diverging rule set. It adds NO privilege of its own, and
-- anon is granted nothing.
create or replace function api.set_source_resolution(
  p_source_system text,
  p_entity_kind text,
  p_source_id text,
  p_resolution_status text,
  p_core_property_id uuid,
  p_core_character_id uuid,
  p_core_style_guide_id uuid,
  p_dam_asset_id uuid,
  p_resolution_reason text,
  p_expected_updated_at timestamptz,
  p_core_licensor_id uuid,
  p_core_franchise_id uuid
)
returns plm.source_resolution
language plpgsql
security definer
set search_path to pg_catalog
as $function$
begin
  return plm.set_source_resolution(
    p_source_system,
    p_entity_kind,
    p_source_id,
    p_resolution_status,
    p_core_property_id,
    p_core_character_id,
    p_core_style_guide_id,
    p_dam_asset_id,
    p_resolution_reason,
    p_expected_updated_at,
    p_core_licensor_id,
    p_core_franchise_id
  );
end;
$function$;

comment on function api.set_source_resolution(
  text,text,text,text,uuid,uuid,uuid,uuid,text,timestamptz,uuid,uuid) is
  'Browser-reachable wrapper over the six-kind plm.set_source_resolution overload (issue '
  '#2335). Delegates without relaxing anything; the raised codes are the setter own -- '
  '42501, 23503, 40001, plus the table check violations.';

revoke all on function api.set_source_resolution(
  text,text,text,text,uuid,uuid,uuid,uuid,text,timestamptz,uuid,uuid) from public, anon;
grant execute on function api.set_source_resolution(
  text,text,text,text,uuid,uuid,uuid,uuid,text,timestamptz,uuid,uuid)
  to authenticated, service_role;


-- =====================================================================================
-- PART 3 -- plm.licensing_source_scope: what a source is authorized to be authority for
-- =====================================================================================
-- One row is one statement: for licensor L, source system S is authorized, at authority
-- level P, over kind K. Nothing here is a decision about a particular entity -- that is
-- the job of plm.source_resolution. This table is the configuration that says whether
-- such a decision is even admissible from that source.
--
-- WHY licensor_id IS IN THE KEY AND IS A REAL FOREIGN KEY. This is configuration, not a
-- durable human decision, so the owner ruling that keeps plm.source_resolution FK-free
-- does not apply: a scope row that outlives its licensor is not a preserved decision, it
-- is a dangling grant. ON DELETE RESTRICT, matching core.franchise and every #2334
-- support edge.
--
-- WHY TWO AXES INSTEAD OF TWO TABLES. A source is authorized over ENTITY kinds and over
-- RELATIONSHIP kinds, and the issue requires both to be explicit. Splitting them into two
-- tables would double every grant, index and future setter for one column of difference.
-- scope_axis names which vocabulary permitted_kind is drawn from, and a CHECK holds
-- permitted_kind to that vocabulary -- so property_character cannot be filed as an entity
-- kind, and franchise cannot be filed as a relationship kind.
create table if not exists plm.licensing_source_scope (
  -- Whose scope this is. FIRST in the key on purpose: every real query is "what may this
  -- licensor sources do", and source ids collide across licensors.
  licensor_id     uuid not null references core.licensor(id) on delete restrict,

  -- The same vocabulary plm.source_resolution.source_system uses. Deliberately NOT
  -- constrained to that table CHECK: this table also has to express that a source is
  -- authorized for nothing at all, including a source that has no durable decisions yet,
  -- and copying the vocabulary here would create a second place to maintain it.
  source_system   text not null,

  -- The authority level, which is what makes this scope source-purpose-aware:
  --   canonical_identity    -- this source may back a MATCHED plm.source_resolution
  --                            decision for this entity kind. The strongest level.
  --   relationship_evidence -- this source may contribute support evidence and
  --                            relationship decisions for this relationship kind.
  --   reference_only        -- captured for display and reconciliation. NEVER authority.
  source_purpose  text not null,

  scope_axis      text not null,
  permitted_kind  text not null,

  -- Audit. Who authorized this scope and why, paired so neither can stand alone.
  authorized_at      timestamptz null,
  authorized_by      text null,
  authorization_note text null,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  -- Identity carries the licensor. A bare (source_system, permitted_kind) key would let
  -- one licensor grant answer another licensor question.
  constraint licensing_source_scope_pkey
    primary key (licensor_id, source_system, source_purpose, scope_axis, permitted_kind),

  constraint licensing_source_scope_source_system_nonblank_chk
    check (btrim(source_system) <> ''),

  constraint licensing_source_scope_purpose_chk
    check (source_purpose in ('canonical_identity','relationship_evidence','reference_only')),

  constraint licensing_source_scope_axis_chk
    check (scope_axis in ('entity','relationship')),

  -- permitted_kind is drawn from the vocabulary its axis names, and from no other. The
  -- entity list is exactly the six plm.source_resolution kinds; the relationship list is
  -- exactly the eight canonical bridges created by #2334.
  constraint licensing_source_scope_permitted_kind_chk check (
    case scope_axis
      when 'entity' then permitted_kind in
        ('property','character','style_guide','asset','licensor','franchise')
      when 'relationship' then permitted_kind in
        ('property_character','property_style_guide','property_franchise',
         'style_guide_character','asset_property','asset_character',
         'asset_style_guide','asset_franchise')
      else false
    end
  ),

  -- The two axes do not share authority levels, and conflating them is the mistake this
  -- constraint exists to stop. canonical_identity is a statement about an ENTITY being
  -- the same thing; relationship_evidence is a statement about a PAIR. Only
  -- reference_only is meaningful on both sides.
  constraint licensing_source_scope_purpose_axis_chk check (
    case scope_axis
      when 'entity' then source_purpose in ('canonical_identity','reference_only')
      when 'relationship' then source_purpose in ('relationship_evidence','reference_only')
      else false
    end
  ),

  constraint licensing_source_scope_audit_pair_chk
    check ((authorized_at is null) = (authorized_by is null)),
  constraint licensing_source_scope_actor_nonblank_chk
    check (authorized_by is null or btrim(authorized_by) <> ''),
  constraint licensing_source_scope_note_nonblank_chk
    check (authorization_note is null or btrim(authorization_note) <> '')
);

-- "Which licensors trust this source" and "what is the whole scope of this source" are
-- the two reads that do not lead with licensor_id, so they need their own index.
create index if not exists licensing_source_scope_source_system_idx
  on plm.licensing_source_scope (source_system, scope_axis, permitted_kind);

comment on table plm.licensing_source_scope is
  'Per-licensor, purpose-aware authorization: which source system may be authority over '
  'which entity kind or relationship kind, and at what level (issue #2335). Configuration, '
  'not a decision -- plm.source_resolution holds the decisions. Identity carries '
  'licensor_id because source ids collide across licensors. No role may write this table; '
  'a governed setter arrives with the successor that authorizes scope rows.';
comment on column plm.licensing_source_scope.source_purpose is
  'canonical_identity: may back a matched entity resolution. relationship_evidence: may '
  'back a relationship decision. reference_only: captured for display and reconciliation, '
  'never authority. Pinned by licensing_source_scope_purpose_chk and held to its axis by '
  'licensing_source_scope_purpose_axis_chk.';
comment on column plm.licensing_source_scope.permitted_kind is
  'An entity kind (the six plm.source_resolution kinds) when scope_axis is entity, or one '
  'of the eight canonical #2334 relationship kinds when scope_axis is relationship. '
  'Pinned by licensing_source_scope_permitted_kind_chk.';

alter table plm.licensing_source_scope enable row level security;
revoke all on table plm.licensing_source_scope from public, anon, authenticated;
revoke insert, update, delete, truncate on table plm.licensing_source_scope from service_role;
grant select on table plm.licensing_source_scope to authenticated, service_role;
drop policy if exists licensing_source_scope_authenticated_read on plm.licensing_source_scope;
create policy licensing_source_scope_authenticated_read
  on plm.licensing_source_scope for select to authenticated using (true);


-- =====================================================================================
-- PART 4 -- plm.licensing_relationship_resolution: durable decisions about PAIRS
-- =====================================================================================
-- plm.source_resolution answers "which canonical thing is this source key". This table
-- answers the other half: "which canonical PAIR is this stated relationship" -- and, just
-- as importantly, records when the answer is genuinely ambiguous instead of forcing a
-- match.
--
-- WHY IT IS NOT plm.source_resolution WITH A SEVENTH KIND. A relationship has TWO source
-- keys and TWO canonical endpoints. Folding it in would make every target constraint on
-- that table conditional on a second key that is null for four fifths of its rows, and
-- would put a pair decision under a primary key that can only name one source id.
--
-- PROVENANCE IS PART OF THE ROW, NOT AN ANNOTATION. evidence_kind reuses the #2334 enum
-- core.relationship_evidence_kind, and is_direct_source_relationship is GENERATED from
-- it, so a loader can neither supply nor contradict it. The #2334 rule holds here too and
-- is enforced by CHECK: inferred and co-occurrence evidence may be RECORDED, but may
-- never carry a matched canonical pair. Promoting a guess to a canonical relationship is
-- the royalty error this whole family of tables exists to prevent.
create table if not exists plm.licensing_relationship_resolution (
  -- Whose relationship this is. In the key, first: source ids collide across licensors.
  licensor_id       uuid not null references core.licensor(id) on delete restrict,
  source_system     text not null,

  -- Which of the eight canonical relationships is being decided.
  relationship_kind text not null,

  -- The two source-side keys, text so integer, GUID and slug keys all land without a
  -- lossy cast -- the same choice core.franchise.source_id makes.
  source_left_id    text not null,
  source_right_id   text not null,

  resolution_status text not null default 'unresolved',

  -- The canonical endpoints. Which TWO of the five may be populated is decided by
  -- relationship_kind, so a matched pair is fully typed and a swapped endpoint cannot
  -- type-check its way past the constraint. No foreign keys, for the same owner-ruling
  -- reason plm.source_resolution has none: a durable decision must not be destroyed or
  -- blocked by the lifecycle of what it points at.
  core_property_id    uuid null,
  core_character_id   uuid null,
  core_style_guide_id uuid null,
  core_franchise_id   uuid null,
  dam_asset_id        uuid null,

  -- Provenance.
  evidence_kind     core.relationship_evidence_kind not null,
  is_direct_source_relationship boolean generated always as
                      (evidence_kind = 'direct_source_assertion') stored,
  source_evidence   text null,

  -- Audit, in the same shape plm.source_resolution uses.
  resolution_reason text null,
  resolved_at       timestamptz null,
  resolved_by       text null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint licensing_relationship_resolution_pkey
    primary key (licensor_id, source_system, relationship_kind, source_left_id, source_right_id),

  constraint licensing_relationship_resolution_source_system_nonblank_chk
    check (btrim(source_system) <> ''),
  constraint licensing_relationship_resolution_left_id_nonblank_chk
    check (btrim(source_left_id) <> ''),
  constraint licensing_relationship_resolution_right_id_nonblank_chk
    check (btrim(source_right_id) <> ''),

  constraint licensing_relationship_resolution_kind_chk
    check (relationship_kind in
      ('property_character','property_style_guide','property_franchise',
       'style_guide_character','asset_property','asset_character',
       'asset_style_guide','asset_franchise')),

  constraint licensing_relationship_resolution_status_chk
    check (resolution_status in
      ('unresolved','matched','ambiguous','no_match','rejected','deferred')),

  -- A matched row names EXACTLY the two endpoints its relationship kind is made of, and
  -- nothing else. Anything not matched names no endpoint at all -- an undecided or
  -- ambiguous row must not leave a half answer behind that a reader could mistake for a
  -- decision.
  constraint licensing_relationship_resolution_endpoint_kind_chk check (
    case when resolution_status = 'matched' then
      case relationship_kind
        when 'property_character' then core_property_id is not null and core_character_id is not null
          and core_style_guide_id is null and core_franchise_id is null and dam_asset_id is null
        when 'property_style_guide' then core_property_id is not null and core_style_guide_id is not null
          and core_character_id is null and core_franchise_id is null and dam_asset_id is null
        when 'property_franchise' then core_property_id is not null and core_franchise_id is not null
          and core_character_id is null and core_style_guide_id is null and dam_asset_id is null
        when 'style_guide_character' then core_style_guide_id is not null and core_character_id is not null
          and core_property_id is null and core_franchise_id is null and dam_asset_id is null
        when 'asset_property' then dam_asset_id is not null and core_property_id is not null
          and core_character_id is null and core_style_guide_id is null and core_franchise_id is null
        when 'asset_character' then dam_asset_id is not null and core_character_id is not null
          and core_property_id is null and core_style_guide_id is null and core_franchise_id is null
        when 'asset_style_guide' then dam_asset_id is not null and core_style_guide_id is not null
          and core_property_id is null and core_character_id is null and core_franchise_id is null
        when 'asset_franchise' then dam_asset_id is not null and core_franchise_id is not null
          and core_property_id is null and core_character_id is null and core_style_guide_id is null
        else false
      end
    else
      num_nonnulls(core_property_id, core_character_id, core_style_guide_id,
                   core_franchise_id, dam_asset_id) = 0
    end
  ),

  -- The #2334 rule, restated where the decision is made. Inferred and co-occurrence
  -- evidence is worth recording and is never authority.
  constraint licensing_relationship_resolution_matched_is_direct_chk
    check (resolution_status <> 'matched'
           or evidence_kind = 'direct_source_assertion'),

  -- Ambiguity is preserved, not silently swallowed: a row that says "this could be more
  -- than one pair" must say WHICH ambiguity, or it is indistinguishable from neglect.
  constraint licensing_relationship_resolution_ambiguous_reason_chk
    check (resolution_status <> 'ambiguous' or resolution_reason is not null),

  constraint licensing_relationship_resolution_audit_pair_chk
    check ((resolved_at is null) = (resolved_by is null)),
  constraint licensing_relationship_resolution_actor_nonblank_chk
    check (resolved_by is null or btrim(resolved_by) <> ''),
  constraint licensing_relationship_resolution_reason_nonblank_chk
    check (resolution_reason is null or btrim(resolution_reason) <> ''),
  constraint licensing_relationship_resolution_evidence_nonblank_chk
    check (source_evidence is null or btrim(source_evidence) <> '')
);

-- "What still needs deciding for this licensor" is the working queue, and it does not
-- lead with source_system.
create index if not exists licensing_relationship_resolution_status_idx
  on plm.licensing_relationship_resolution (licensor_id, relationship_kind, resolution_status);

-- "What did we decide about this canonical property or asset" -- the reverse lookups a
-- reconciliation makes. Partial, because only matched rows carry endpoints at all.
create index if not exists licensing_relationship_resolution_property_idx
  on plm.licensing_relationship_resolution (core_property_id)
  where core_property_id is not null;
create index if not exists licensing_relationship_resolution_asset_idx
  on plm.licensing_relationship_resolution (dam_asset_id)
  where dam_asset_id is not null;

comment on table plm.licensing_relationship_resolution is
  'Durable, audited decisions about a source system stated RELATIONSHIP between two of '
  'its keys, and which canonical pair it resolves to (issue #2335). Identity carries '
  'licensor_id because source ids collide across licensors. Ambiguity is a recorded '
  'outcome, not a missing row. Only direct_source_assertion evidence may carry a matched '
  'pair; inferred and co-occurrence evidence is recorded and is never authority. Endpoint '
  'UUIDs deliberately have no foreign keys, exactly like plm.source_resolution. No role '
  'may write this table; a governed setter arrives with the successor that authorizes '
  'decisions.';
comment on column plm.licensing_relationship_resolution.is_direct_source_relationship is
  'Generated from evidence_kind and therefore unwritable: evidence cannot lie about '
  'itself.';
comment on column plm.licensing_relationship_resolution.resolution_reason is
  'Required when resolution_status is ambiguous, so a preserved ambiguity always says '
  'what the ambiguity was.';

alter table plm.licensing_relationship_resolution enable row level security;
revoke all on table plm.licensing_relationship_resolution from public, anon, authenticated;
revoke insert, update, delete, truncate
  on table plm.licensing_relationship_resolution from service_role;
grant select on table plm.licensing_relationship_resolution to authenticated, service_role;
drop policy if exists licensing_relationship_resolution_authenticated_read
  on plm.licensing_relationship_resolution;
create policy licensing_relationship_resolution_authenticated_read
  on plm.licensing_relationship_resolution for select to authenticated using (true);


-- =====================================================================================
-- POST-APPLY VERIFICATION
-- =====================================================================================
-- Catalogue-only, on purpose. It asserts the SHAPE that landed -- it never reads or
-- writes rows in the tables above, and it never calls a plm routine, so the apply cost
-- does not grow with the data.
do $verify$
declare
  v_missing text;
  v_count integer;
begin
  -- The two new decision targets exist on the durable home.
  select string_agg(c.expected, ', ' order by c.expected) into v_missing
    from (values ('core_licensor_id'), ('core_franchise_id')) as c(expected)
   where not exists (
     select 1 from pg_catalog.pg_attribute a
      where a.attrelid = to_regclass('plm.source_resolution')
        and a.attname = c.expected
        and a.attnum > 0
        and not a.attisdropped);
  if v_missing is not null then
    raise exception 'source_resolution is missing target column(s): %', v_missing;
  end if;

  -- The three widened constraints kept their canonical names, so nothing that pins them
  -- by name -- the production catalog contract, the backfill contract test -- can drift.
  select count(*) into v_count
    from pg_catalog.pg_constraint
   where conrelid = to_regclass('plm.source_resolution')
     and contype = 'c'
     and conname in ('source_resolution_entity_kind_chk',
                     'source_resolution_target_kind_chk',
                     'source_resolution_matched_target_chk');
  if v_count <> 3 then
    raise exception 'expected 3 widened source_resolution check constraints, found %', v_count;
  end if;

  -- The vocabulary really widened. A textual check on the constraint definition, because
  -- the alternative is inserting a row into a table this file is not authorized to load.
  if position('licensor' in pg_catalog.pg_get_constraintdef(
       (select oid from pg_catalog.pg_constraint
         where conrelid = to_regclass('plm.source_resolution')
           and conname = 'source_resolution_entity_kind_chk'))) = 0
     or position('franchise' in pg_catalog.pg_get_constraintdef(
       (select oid from pg_catalog.pg_constraint
         where conrelid = to_regclass('plm.source_resolution')
           and conname = 'source_resolution_entity_kind_chk'))) = 0 then
    raise exception 'source_resolution_entity_kind_chk did not gain licensor and franchise';
  end if;

  -- Both setter overloads exist side by side. If the ten-argument routine were gone, the
  -- production catalog contract would fail on a database that is otherwise correct.
  if to_regprocedure(
       'plm.set_source_resolution(text,text,text,text,uuid,uuid,uuid,uuid,text,timestamp with time zone)'
     ) is null then
    raise exception 'the frozen ten-argument plm.set_source_resolution was lost';
  end if;
  if to_regprocedure(
       'plm.set_source_resolution(text,text,text,text,uuid,uuid,uuid,uuid,text,timestamp with time zone,uuid,uuid)'
     ) is null then
    raise exception 'the six-kind plm.set_source_resolution overload was not created';
  end if;
  if to_regprocedure(
       'api.set_source_resolution(text,text,text,text,uuid,uuid,uuid,uuid,text,timestamp with time zone,uuid,uuid)'
     ) is null then
    raise exception 'the six-kind api.set_source_resolution overload was not created';
  end if;

  -- The new overload is a pinned SECURITY DEFINER, or it is a privilege escalation.
  select count(*) into v_count
    from pg_catalog.pg_proc p
   where p.oid in (
           to_regprocedure('plm.set_source_resolution(text,text,text,text,uuid,uuid,uuid,uuid,text,timestamp with time zone,uuid,uuid)'),
           to_regprocedure('api.set_source_resolution(text,text,text,text,uuid,uuid,uuid,uuid,text,timestamp with time zone,uuid,uuid)'))
     and p.prosecdef
     and p.proconfig @> array['search_path=pg_catalog'];
  if v_count <> 2 then
    raise exception 'both six-kind setters must be security definer with a pinned search_path (found %)', v_count;
  end if;

  -- No new argument may be optional, or the two overloads compete and every existing
  -- ten-argument call starts failing with 42725.
  select count(*) into v_count
    from pg_catalog.pg_proc p
   where p.oid in (
           to_regprocedure('plm.set_source_resolution(text,text,text,text,uuid,uuid,uuid,uuid,text,timestamp with time zone,uuid,uuid)'),
           to_regprocedure('api.set_source_resolution(text,text,text,text,uuid,uuid,uuid,uuid,text,timestamp with time zone,uuid,uuid)'))
     and p.pronargdefaults = 0;
  if v_count <> 2 then
    raise exception 'the six-kind setters must have no default arguments (found % without defaults)', v_count;
  end if;

  -- anon gains nothing anywhere.
  if has_function_privilege('anon',
       to_regprocedure('api.set_source_resolution(text,text,text,text,uuid,uuid,uuid,uuid,text,timestamp with time zone,uuid,uuid)'),
       'execute')
     or has_function_privilege('anon',
       to_regprocedure('plm.set_source_resolution(text,text,text,text,uuid,uuid,uuid,uuid,text,timestamp with time zone,uuid,uuid)'),
       'execute') then
    raise exception 'anon must not be able to execute the six-kind setters';
  end if;

  -- Both new tables landed, with RLS on and no write grant for anyone.
  if to_regclass('plm.licensing_source_scope') is null
     or to_regclass('plm.licensing_relationship_resolution') is null then
    raise exception 'the licensing scope and relationship decision tables were not created';
  end if;

  select count(*) into v_count
    from pg_catalog.pg_class c
   where c.oid in (to_regclass('plm.licensing_source_scope'),
                   to_regclass('plm.licensing_relationship_resolution'))
     and c.relrowsecurity;
  if v_count <> 2 then
    raise exception 'both new tables must have row level security enabled (found %)', v_count;
  end if;

  if has_table_privilege('authenticated', to_regclass('plm.licensing_source_scope'), 'insert')
     or has_table_privilege('service_role', to_regclass('plm.licensing_source_scope'), 'insert')
     or has_table_privilege('authenticated', to_regclass('plm.licensing_relationship_resolution'), 'insert')
     or has_table_privilege('service_role', to_regclass('plm.licensing_relationship_resolution'), 'insert') then
    raise exception 'the new tables must be fail-closed: no role may insert into them yet';
  end if;

  if not has_table_privilege('authenticated', to_regclass('plm.licensing_source_scope'), 'select')
     or not has_table_privilege('authenticated', to_regclass('plm.licensing_relationship_resolution'), 'select') then
    raise exception 'authenticated must be able to read the new tables';
  end if;

  -- Licensor is part of both identities. This is the collision guard, checked in the
  -- catalogue so it cannot be quietly dropped by a later edit.
  select count(*) into v_count
    from pg_catalog.pg_constraint con
    join pg_catalog.pg_attribute a
      on a.attrelid = con.conrelid and a.attnum = any(con.conkey)
   where con.conname in ('licensing_source_scope_pkey',
                         'licensing_relationship_resolution_pkey')
     and a.attname = 'licensor_id';
  if v_count <> 2 then
    raise exception 'licensor_id must be part of both new primary keys (found % of 2)', v_count;
  end if;

  raise notice 'source authority and relationship decisions verified: six entity kinds, two overloads, two fail-closed tables';
end;
$verify$;
