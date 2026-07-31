-- core.licensor_alias — the eight hard-coded PopSG Licensor aliases, moved out of
-- application code and into recorded, auditable data, PLUS the two extra NBC name
-- variants Albert ruled on, and the owner approval of the whole NBC family.
--
-- Plan: fix_popsg_property_taxonomy_reconciliation.md section 22.6 (the "OWNER GATE")
-- and section 7 step 6 / section 13 decision 7.
--
-- WHAT THIS IS, AND WHAT IT IS NOT
-- --------------------------------
-- Until now the eight aliases lived in a single `LICENSOR_ALIASES` array in the
-- PopDAM worker (u2giants/popdam3, apps/worker/src/handlers/popsg-tags.ts), mirrored
-- frozen at scripts/popsg-property-psg1-inventory.cjs lines 8-17. Nobody knows who
-- wrote them, when, or on what authority: there is no memo, contract reference or
-- sign-off anywhere in either repository.
--
-- Albert approved MIGRATING them into a durable recorded rule. He did NOT ratify that
-- each mapping is factually correct. This migration must therefore not launder them
-- into "owner-approved" status, so every row is seeded `inherited_unverified` and the
-- table refuses to call anything owner_approved without a named approver, a timestamp
-- and an approval-evidence reference. Flipping a row to owner_approved is a separate,
-- deliberate act through public.approve_licensor_alias().
--
-- THE ONE EXCEPTION: THE NBC FAMILY  (owner ruling, 2026-07-31)
-- -------------------------------------------------------------
-- On 2026-07-31, in session, Albert ruled, verbatim:
--
--     "NBC Universal really means NBC, really means NBCU, really means NBCUniversal"
--
-- So four observed strings denote the one canonical Licensor `NBC`:
--   `NBC Universal`, `NBC`, `NBCU`, `NBCUniversal`.
--
-- That ruling does two things this migration must implement, and NOTHING else. The
-- other seven inherited aliases (Marvel Style Guide, One Piece, Peanuts, Sesame
-- Workshop, Paramount, Nickelodeon, Viacom) are UNTOUCHED and stay
-- `inherited_unverified` — Albert ruled on the NBC family only.
--
--   (1) TWO VARIANTS WERE MISSING, AND ARE NOT MATCHED BY TODAY'S CODE AT ALL.
--       The normalizer splits camel case only on a lower/digit -> UPPER boundary, so an
--       ALL-CAPS run followed by a capitalised word does not split. Measured against the
--       frozen JS `normalize()` in scripts/popsg-property-psg1-inventory.cjs:
--
--           'NBC Universal'  ->  'nbc universal'    <- the one alias the code array has
--           'NBC'            ->  'nbc'              <- the CANONICAL Licensor's own name
--           'NBCU'           ->  'nbcu'             <- NOT matched by anything today
--           'NBCUniversal'   ->  'nbcuniversal'     <- NOT matched by anything today
--
--       Four strings, four DIFFERENT normalized forms. `NBCU` and `NBCUniversal` do not
--       collapse into `nbc universal`, so before this migration they resolved to nothing.
--       Those two forms are pinned as test fixtures in
--       supabase/tests/core_licensor_alias_contracts.sql section G precisely so that a
--       later "fix" to the normalizer cannot silently change what these rows match.
--
--       `NBC` is deliberately NOT added as an alias row: it is already the canonical
--       Licensor's own name, the resolver tries a direct canonical name/code match
--       BEFORE consulting aliases (frozen script lines 261-263), and the redundancy
--       trigger in section 2 below correctly refuses an alias equal to its own target's
--       name. Albert's ruling is satisfied for `NBC` by the canonical record itself.
--
--   (2) THE NBC FAMILY IS OWNER-APPROVED. This is the FIRST use of the owner-approved
--       path. It is performed in section 7 through public.approve_licensor_alias() —
--       the table's own single sanctioned approval mechanism — not by writing the
--       approval columns directly.
--
-- BLAST RADIUS OF THE TWO NEW VARIANTS: ZERO TODAY, by measurement, not by assumption.
-- The frozen PSG-1 corpus (docs/verification/popsg-property-reconciliation-20260727-psg1/
-- inventory.csv, 372 observation rows) contains exactly 21 distinct normalized
-- folder-level Licensor strings. `nbc universal` appears in 55 rows. `nbcu` and
-- `nbcuniversal` appear in ZERO. (The single 'NBCU' string anywhere in that corpus is a
-- PROPERTY folder, `_NBCU CLEARED EDITORIAL`, sitting under licensor `NBC UNIVERSAL` —
-- already resolved, and not a Licensor-level observation.) So these two rows re-route
-- nothing that exists today; they are recorded insurance against a folder that has not
-- been created yet, and are therefore flagged `is_dormant` with that measurement as
-- evidence, exactly like Nickelodeon and Viacom.
--
-- BLAST RADIUS (frozen PSG-1 production measurement 2026-07-26/27, NOT re-measured;
-- see plan section 22.6 and docs/verification/popsg-property-reconciliation-20260727-psg1/):
--   NBC Universal      -> NBC                25,731 active files
--   Marvel Style Guide -> Marvel             14,636
--   Paramount          -> Viacom Multi        9,052
--   One Piece          -> TOEI - ONE PIECE    8,383
--   Peanuts            -> Peanuts Worldwide   3,509
--   Sesame Workshop    -> Sesame Street       1,630
--   Nickelodeon        -> Viacom Multi            0   (DORMANT)
--   Viacom             -> Viacom Multi            0   (DORMANT)
-- Three of them underpin 26 of the 51 PSG-4-approved rows (15,816 of 44,331 files).
--
-- SHAPE follows the three proven sibling alias tables:
--   core.customer_alias (20260716143231), core.factory_alias (20260717192922),
--   core.property_alias (20260731150000).
-- The normalizer is core.normalize_popsg_property_observation — the SAME function
-- core.property_alias uses, and a SQL restatement of the JS `normalize()` in the frozen
-- inventory script, which is what actually produced the blast-radius numbers above.
-- The simple lower()+whitespace normalizer used by customer_alias/factory_alias is
-- deliberately NOT copied (plan section 6.4 forbids it for PopSG matching).
--
-- THIS MIGRATION CHANGES NO WORKER BEHAVIOUR. The code array in popdam3 stays as-is
-- until the table is proven in production; see the cutover in the plan section 22.8.
--
-- READ THAT SENTENCE AGAIN BEFORE ASSUMING `NBCU` NOW WORKS. It does not, yet. The
-- PopDAM worker still resolves Licensor strings from its OWN hard-coded
-- `LICENSOR_ALIASES` array in u2giants/popdam3 apps/worker/src/handlers/popsg-tags.ts.
-- It does not read core.licensor_alias, and nothing in this repository can make it.
-- Until that worker is changed to call public.resolve_licensor_alias() (plan section
-- 22.8), the two new rows below are a RECORDED DECISION ONLY and have no runtime
-- effect. Adding rows to this table is necessary for `NBCU`/`NBCUniversal` to take
-- effect; it is NOT sufficient. The popdam3 change is a separate PR in a separate
-- repository and is deliberately not made here.
--
-- GRANTS ARE STATED EXPLICITLY ON EVERY `public` FUNCTION BELOW. Since 2026-07-29 an
-- event trigger (`lock_down_new_public_function_execute_trg`, AGENTS.md section 10.2)
-- revokes EXECUTE from PUBLIC and `anon` on every new `public` function, and its own
-- failures are `raise warning` only — so without the explicit grants that follow these
-- functions would be callable by nobody while the migration still looked successful.

-- ---------------------------------------------------------------------------
-- 1. The table
-- ---------------------------------------------------------------------------
create table core.licensor_alias (
  id                  uuid primary key default gen_random_uuid(),

  -- The canonical Licensor this alias resolves TO.
  -- ON DELETE RESTRICT, not CASCADE: core.property_alias uses RESTRICT on its
  -- licensor edge for the same reason, and there is no core.merge_licensor() that
  -- would need to delete a parent. Silently dropping a 25,731-file routing rule
  -- because someone deleted a Licensor row is exactly the kind of silent loss this
  -- repository forbids.
  licensor_id         uuid not null references core.licensor(id) on delete restrict,

  -- The observed string (a PopSG folder-level Licensor name) that should resolve to
  -- licensor_id.
  alias               text not null,
  normalized_alias    text generated always as
                        (core.normalize_popsg_property_observation(alias)) stored,

  -- PROVENANCE. This is the whole point of the table.
  --   inherited_unverified -> came out of the code array, behaviour-preserving,
  --                           correctness NOT verified by the owner.
  --   owner_approved       -> Albert (or a named approver) has affirmed that THIS
  --                           mapping is factually correct, with evidence.
  approval_status     text not null default 'inherited_unverified',
  approved_by         text,
  approved_at         timestamptz,
  approval_evidence   text,   -- memo / contract ref / PR URL / decision record

  -- Dormant = recorded, but carrying zero measured production traffic. Insurance,
  -- not live behaviour. A later reviewer must be able to tell these apart without
  -- re-running a production measurement.
  is_dormant          boolean not null default false,
  dormancy_evidence   text,

  source_system       text,
  evidence_notes      text,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint licensor_alias_alias_not_blank
    check (length(btrim(alias)) > 0),

  -- An alias that normalizes to nothing can never match an observation and would
  -- collide with every other such row on the unique index. Also rejects '---'.
  constraint licensor_alias_normalized_not_blank
    check (length(core.normalize_popsg_property_observation(alias)) > 0),

  constraint licensor_alias_approval_status_check
    check (approval_status in ('inherited_unverified','owner_approved')),

  -- Owner approval is unrepresentable without a named approver, a timestamp AND an
  -- evidence reference. A direct service_role write cannot bypass this, so the
  -- distinction between "we recorded it" and "you approved it" cannot be faked.
  constraint licensor_alias_approval_requires_evidence
    check (
      approval_status <> 'owner_approved'
      or (approved_by is not null and length(btrim(approved_by)) > 0
          and approved_at is not null
          and approval_evidence is not null and length(btrim(approval_evidence)) > 0)
    ),

  -- Conversely, an unverified row must not carry approval fields that would make it
  -- LOOK approved to a careless reader or a `select approved_by ...` report.
  constraint licensor_alias_unverified_has_no_approval
    check (
      approval_status <> 'inherited_unverified'
      or (approved_by is null and approved_at is null and approval_evidence is null)
    ),

  -- Claiming dormancy requires saying on what measurement.
  constraint licensor_alias_dormancy_requires_evidence
    check (
      is_dormant = false
      or (dormancy_evidence is not null and length(btrim(dormancy_evidence)) > 0)
    )
);

-- THE core safety property: two live aliases may never resolve the same normalized
-- string to different Licensors. Unlike core.property_alias — where uniqueness is
-- scoped to the parent because the same Property alias under a different Licensor is
-- legitimate — a Licensor alias IS the top-level lookup key. There is no outer scope
-- to disambiguate it, so uniqueness is GLOBAL on normalized_alias.
create unique index licensor_alias_norm_key
  on core.licensor_alias (normalized_alias);

create index licensor_alias_licensor_idx on core.licensor_alias (licensor_id);
create index licensor_alias_status_idx   on core.licensor_alias (approval_status);
create index licensor_alias_trgm_idx
  on core.licensor_alias using gin (normalized_alias extensions.gin_trgm_ops);

create trigger set_updated_at before update on core.licensor_alias
  for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Shadowing / redundancy guard
-- ---------------------------------------------------------------------------
-- An alias that normalizes to the canonical name or code of ANY Licensor is refused:
--   * if it matches its OWN target, it is redundant (same rule as property_alias);
--   * if it matches a DIFFERENT Licensor, it would shadow a real canonical record and
--     silently re-route that Licensor's files. That is the single most dangerous
--     row this table could hold.
-- A trigger, not a CHECK, because it must read core.licensor.
--
-- NOTE (lesson from 20260731153000): this computes from `new.alias` and never reads
-- the generated `new.normalized_alias`, which is not yet populated in a BEFORE trigger.
create or replace function core.reject_shadowing_licensor_alias()
returns trigger
language plpgsql
security definer
set search_path = core, pg_catalog
as $$
declare
  v_norm    text := core.normalize_popsg_property_observation(new.alias);
  v_hit     record;
begin
  select l.id, l.name, coalesce(l.code, '') as code
    into v_hit
    from core.licensor l
   where core.normalize_popsg_property_observation(l.name) = v_norm
      or core.normalize_popsg_property_observation(coalesce(l.code, '')) = v_norm
   limit 1;

  if found then
    if v_hit.id = new.licensor_id then
      raise exception
        'licensor_alias: alias % is redundant -- it already normalizes to its own target Licensor''s name or code',
        new.alias
        using errcode = 'check_violation';
    else
      raise exception
        'licensor_alias: alias % would shadow the canonical Licensor % (%) and re-route its files',
        new.alias, v_hit.name, v_hit.id
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function core.reject_shadowing_licensor_alias() from public;

create trigger reject_shadowing_licensor_alias
  before insert or update of alias, licensor_id on core.licensor_alias
  for each row execute function core.reject_shadowing_licensor_alias();

-- ---------------------------------------------------------------------------
-- 3. RLS and grants
-- ---------------------------------------------------------------------------
alter table core.licensor_alias enable row level security;

-- Read for the same role set every other core.* table uses. There is deliberately NO
-- write policy for `authenticated` at all — RLS and GRANTs independently enforce
-- read-only for browser roles, exactly as core.property_alias does. Even an
-- administrator cannot hand-edit this table from the browser; approval goes through
-- the guarded RPC below.
create policy shared_read on core.licensor_alias
  for select to authenticated
  using (app.has_any_role(array['administrator','sales','licensing','designer','viewer','vendor']::app.app_role[]));

revoke all on core.licensor_alias from public, anon, authenticated;
grant select on core.licensor_alias to authenticated;
grant all    on core.licensor_alias to service_role;

comment on table core.licensor_alias is
  'Alternate Licensor names observed in PopSG folder structure, resolving to a canonical '
  'core.licensor. Replaces the hard-coded LICENSOR_ALIASES array in the PopDAM worker. '
  'Every row records whether it is merely INHERITED FROM CODE (correctness not verified) '
  'or OWNER-APPROVED. Uniqueness is global on normalized_alias: one normalized string may '
  'never resolve to two Licensors. Browser roles are read-only.';
comment on column core.licensor_alias.approval_status is
  'inherited_unverified = lifted from worker code, behaviour-preserving, NOT owner-verified. '
  'owner_approved = a named person affirmed this mapping is factually correct, with evidence.';
comment on column core.licensor_alias.approval_evidence is
  'Memo, contract reference, decision record or PR URL supporting owner approval. Required '
  'whenever approval_status = owner_approved.';
comment on column core.licensor_alias.is_dormant is
  'True when the frozen production measurement showed zero files using this alias. Recorded '
  'as insurance, not live behaviour. Requires dormancy_evidence.';
comment on column core.licensor_alias.source_system is
  'Where the alias came from: popdam_worker_code | coldlion | designflow_plm | manual. Free text.';

-- ---------------------------------------------------------------------------
-- 4. Read path
-- ---------------------------------------------------------------------------
-- The application (PopDAM worker, service_role) resolves an observed folder-level
-- Licensor string to a canonical Licensor id. Returns NULL when nothing matches --
-- which is the `licensor_unresolved` case the worker already handles.
--
-- STABLE, not IMMUTABLE: it reads a table.
create or replace function public.resolve_licensor_alias(p_observed text)
returns uuid
language sql
stable
security definer
set search_path = public, core, app, pg_catalog
as $$
  select la.licensor_id
    from core.licensor_alias la
   where la.normalized_alias = core.normalize_popsg_property_observation(p_observed)
   limit 1;
$$;

comment on function public.resolve_licensor_alias(text) is
  'Resolves an observed Licensor string to a canonical core.licensor id via '
  'core.licensor_alias, using the popsg-property-observation-v1 normalizer. Returns NULL '
  'when no alias matches. This is the read path that replaces the worker LICENSOR_ALIASES array.';

revoke execute on function public.resolve_licensor_alias(text) from public, anon;
grant  execute on function public.resolve_licensor_alias(text) to authenticated, service_role;

-- Full listing, including provenance, so a reviewer or the worker can see WHY a
-- mapping exists and whether anyone ever approved it.
create or replace function public.list_licensor_aliases()
returns table (
  alias             text,
  normalized_alias  text,
  licensor_id       uuid,
  licensor_name     text,
  licensor_code     text,
  approval_status   text,
  approved_by       text,
  approved_at       timestamptz,
  approval_evidence text,
  is_dormant        boolean,
  source_system     text,
  evidence_notes    text
)
language sql
stable
security definer
set search_path = public, core, app, pg_catalog
as $$
  select la.alias, la.normalized_alias, la.licensor_id, l.name, l.code,
         la.approval_status, la.approved_by, la.approved_at, la.approval_evidence,
         la.is_dormant, la.source_system, la.evidence_notes
    from core.licensor_alias la
    join core.licensor l on l.id = la.licensor_id
   order by la.alias;
$$;

comment on function public.list_licensor_aliases() is
  'Every Licensor alias with its resolved canonical Licensor and full provenance. '
  'Read path for review UIs and for the PopDAM worker''s startup load.';

revoke execute on function public.list_licensor_aliases() from public, anon;
grant  execute on function public.list_licensor_aliases() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. The approval RPC -- the ONLY way a row becomes owner_approved
-- ---------------------------------------------------------------------------
create or replace function public.approve_licensor_alias(
  p_alias             text,
  p_approved_by       text,
  p_approval_evidence text
)
returns uuid
language plpgsql
security definer
set search_path = public, core, app, pg_catalog
as $$
declare
  v_id uuid;
begin
  if not (app.has_role('administrator') or auth.role() = 'service_role') then
    raise exception 'approve_licensor_alias: administrator role required'
      using errcode = 'insufficient_privilege';
  end if;

  if p_approved_by is null or length(btrim(p_approved_by)) = 0
     or p_approval_evidence is null or length(btrim(p_approval_evidence)) = 0 then
    raise exception
      'approve_licensor_alias: an approver identity AND an evidence reference are both required. '
      'Recording an alias is not the same as ratifying it.'
      using errcode = 'null_value_not_allowed';
  end if;

  update core.licensor_alias
     set approval_status   = 'owner_approved',
         approved_by       = btrim(p_approved_by),
         approved_at       = now(),
         approval_evidence = btrim(p_approval_evidence)
   where normalized_alias = core.normalize_popsg_property_observation(p_alias)
  returning id into v_id;

  if v_id is null then
    raise exception 'approve_licensor_alias: no alias matches %', p_alias
      using errcode = 'no_data_found';
  end if;

  return v_id;
end;
$$;

comment on function public.approve_licensor_alias(text,text,text) is
  'Promotes one inherited-from-code alias to owner_approved. Requires an approver identity '
  'and an evidence reference; there is no way to approve anonymously or without a record.';

revoke execute on function public.approve_licensor_alias(text,text,text) from public, anon;
grant  execute on function public.approve_licensor_alias(text,text,text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. Seed the eight FROM CODE -- ALL as inherited_unverified
-- ---------------------------------------------------------------------------
-- Each target is resolved by normalized canonical NAME or CODE, which is exactly how
-- the frozen inventory script resolved them. The insert is written so that a target
-- resolving to zero or to more than one Licensor makes the migration FAIL LOUDLY
-- rather than silently seeding a wrong or missing row.
do $$
declare
  v_seed record;
  v_licensor_id uuid;
  v_matches integer;
begin
  for v_seed in
    select * from (values
      -- alias,                target canonical,     dormant
      ('NBC Universal',        'NBC',                false),
      ('Marvel Style Guide',   'Marvel',             false),
      ('One Piece',            'TOEI - ONE PIECE',   false),
      ('Peanuts',              'Peanuts Worldwide',  false),
      ('Sesame Workshop',      'Sesame Street',      false),
      ('Paramount',            'Viacom Multi',       false),
      ('Nickelodeon',          'Viacom Multi',       true),
      ('Viacom',               'Viacom Multi',       true)
    ) as s(alias, target, dormant)
  loop
    -- min(uuid) does not exist in Postgres, hence the cast round-trip. The count is
    -- what actually gates the insert; the id is only used when the count is exactly 1.
    select count(*), min(l.id::text)::uuid into v_matches, v_licensor_id
      from core.licensor l
     where core.normalize_popsg_property_observation(l.name)
             = core.normalize_popsg_property_observation(v_seed.target)
        or core.normalize_popsg_property_observation(coalesce(l.code, ''))
             = core.normalize_popsg_property_observation(v_seed.target);

    if v_matches <> 1 then
      raise exception
        'core.licensor_alias seed: target Licensor % for alias % resolved to % rows, expected exactly 1. '
        'Refusing to guess. Resolve the Licensor first.',
        v_seed.target, v_seed.alias, v_matches;
    end if;

    insert into core.licensor_alias (
      licensor_id, alias, approval_status, is_dormant, dormancy_evidence,
      source_system, evidence_notes
    ) values (
      v_licensor_id,
      v_seed.alias,
      'inherited_unverified',
      v_seed.dormant,
      case when v_seed.dormant then
        'Frozen PSG-1 production measurement 2026-07-26/27 (licensor-alias-blast-radius.csv): '
        || '0 active files, 0 accepted relationships. Not re-measured live.'
      end,
      'popdam_worker_code',
      'Migrated verbatim from the LICENSOR_ALIASES array in u2giants/popdam3 '
      || 'apps/worker/src/handlers/popsg-tags.ts (frozen mirror: '
      || 'scripts/popsg-property-psg1-inventory.cjs lines 8-17). Albert approved MIGRATING '
      || 'these into a recorded rule; he did NOT ratify that this mapping is factually '
      || 'correct. Origin, author and authority of the original mapping are unknown -- no '
      || 'memo, contract reference or sign-off exists in either repository. '
      || 'Behaviour-preserving only. See plan section 22.6.'
    );
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6b. The two MISSING NBC name variants  (owner ruling, 2026-07-31)
-- ---------------------------------------------------------------------------
-- These two did NOT come from the worker code array -- they came from Albert. Their
-- provenance is therefore `owner_ruling`, not `popdam_worker_code`, so a later reader
-- can tell at a glance which rows are inherited folklore and which ones a human
-- actually decided.
--
-- They are seeded here as `inherited_unverified` and promoted in section 7, rather than
-- being written straight in as `owner_approved`. That is deliberate: it forces the
-- approval to travel through public.approve_licensor_alias(), which is the table's only
-- sanctioned approval path, so this migration exercises the real mechanism instead of
-- quietly reaching around it.
--
-- Both are dormant BY MEASUREMENT (0 observations in the frozen PSG-1 corpus), not by
-- guess. `NBC` itself is intentionally absent -- see the header: it is the canonical
-- Licensor's own name, and the section-2 trigger correctly refuses it as redundant.
do $$
declare
  v_seed        record;
  v_licensor_id uuid;
  v_matches     integer;
begin
  for v_seed in
    select * from (values
      ('NBCU',         'NBC'),
      ('NBCUniversal', 'NBC')
    ) as s(alias, target)
  loop
    select count(*), min(l.id::text)::uuid into v_matches, v_licensor_id
      from core.licensor l
     where core.normalize_popsg_property_observation(l.name)
             = core.normalize_popsg_property_observation(v_seed.target)
        or core.normalize_popsg_property_observation(coalesce(l.code, ''))
             = core.normalize_popsg_property_observation(v_seed.target);

    if v_matches <> 1 then
      raise exception
        'core.licensor_alias NBC-family seed: target Licensor % for alias % resolved to % rows, '
        'expected exactly 1. Refusing to guess.',
        v_seed.target, v_seed.alias, v_matches;
    end if;

    insert into core.licensor_alias (
      licensor_id, alias, approval_status, is_dormant, dormancy_evidence,
      source_system, evidence_notes
    ) values (
      v_licensor_id,
      v_seed.alias,
      'inherited_unverified',   -- promoted to owner_approved in section 7 below
      true,
      'Frozen PSG-1 corpus docs/verification/popsg-property-reconciliation-20260727-psg1/'
      || 'inventory.csv (372 observation rows, 21 distinct normalized folder-level Licensor '
      || 'strings): normalized form of this alias appears in 0 rows. Not re-measured live; '
      || 'production was deliberately not queried. Recorded as insurance against a folder '
      || 'spelling that does not exist yet.',
      'owner_ruling',
      'Added on Albert Hazan''s owner ruling of 2026-07-31, given in session: '
      || '"NBC Universal really means NBC, really means NBCU, really means NBCUniversal". '
      || 'This variant was MISSING from the inherited LICENSOR_ALIASES code array and, '
      || 'because the normalizer splits camel case only on a lower/digit -> UPPER boundary, '
      || 'it does not collapse into "nbc universal" -- so nothing matched it before now.'
    );
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Record the owner approval of the NBC family -- THE FIRST ONE
-- ---------------------------------------------------------------------------
-- Everything above this line is behaviour-preserving bookkeeping. This block is the
-- one place in the migration where a human decision is recorded as ratified.
--
-- WHY THE RPC AND NOT A DIRECT UPDATE. public.approve_licensor_alias() is documented in
-- section 5 as the ONLY way a row becomes owner_approved. Writing the four approval
-- columns directly would have worked -- the table's CHECK constraints would still have
-- demanded approver + timestamp + evidence, so the provenance could not have been faked
-- either way -- but it would have left the sanctioned path unexercised on its very first
-- real use, which is exactly when a latent defect in it would be cheapest to find.
--
-- WHY THE JWT CLAIM IS SET. The RPC guards itself with
--   `if not (app.has_role('administrator') or auth.role() = 'service_role')`.
-- In a migration there is no JWT, so auth.role() returns NULL and that expression
-- evaluates to NULL -- and `if NULL then` does not fire, so the guard would let this
-- call through BY ACCIDENT rather than by right. Relying on that would be building on a
-- null hole. Instead the transaction-local claim below asserts, explicitly and
-- truthfully, that this migration runs with service-level authority. It is reset
-- immediately afterwards. (The null hole itself is not exploitable through PostgREST --
-- anon has no EXECUTE and a real `authenticated` caller always has a role claim -- but it
-- is logged as a backlog item in HANDOFF.md rather than fixed here, because tightening a
-- security guard is not this migration's job.)
do $$
declare
  v_evidence constant text :=
    'OWNER RULING, verbatim, given by Albert Hazan in session on 2026-07-31: '
    || '"NBC Universal really means NBC, really means NBCU, really means NBCUniversal". '
    || 'Albert is the owner of POP Creations and the sole authority on licensor identity '
    || 'for this data set. The ruling establishes that the four observed strings '
    || '"NBC Universal", "NBC", "NBCU" and "NBCUniversal" all denote the one canonical '
    || 'Licensor "NBC". Recorded by migration '
    || '20260731210000_core_licensor_alias.sql (shared-db PR #345). Scope: the NBC family '
    || 'ONLY -- Albert did not rule on any other alias in this table.';
  v_alias text;
  v_id    uuid;
  v_count integer;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  foreach v_alias in array array['NBC Universal', 'NBCU', 'NBCUniversal']
  loop
    v_id := public.approve_licensor_alias(v_alias, 'Albert Hazan', v_evidence);
    if v_id is null then
      raise exception 'NBC family approval: approve_licensor_alias(%) returned no row', v_alias;
    end if;
  end loop;

  perform set_config('request.jwt.claims', '', true);

  -- approved_at is pinned to the DATE OF THE RULING, not to whenever this migration
  -- happens to run. The RPC can only stamp now(), which would make preview say
  -- 2026-07-31 and production say whatever day it was promoted -- two different
  -- "when did Albert decide this" answers for one decision. The ruling has exactly one
  -- date. Giving the RPC an optional approval timestamp is a backlog item in HANDOFF.md.
  --
  -- MIDDAY UTC, NOT MIDNIGHT, AND THIS IS NOT COSMETIC. This database's session
  -- TimeZone is America/New_York (verified on preview 2026-07-31). Storing the ruling
  -- as '2026-07-31 00:00:00+00' makes `approved_at::date` render as 2026-07-30 for any
  -- reader on local time -- i.e. the audit trail would state the wrong day for Albert's
  -- decision, which is precisely the thing an approval record exists to get right. This
  -- was caught by contract test G3 during the preview rehearsal, not in review.
  -- 12:00 UTC reads as 2026-07-31 in every timezone from UTC-11 through UTC+12.
  update core.licensor_alias
     set approved_at = timestamptz '2026-07-31 12:00:00+00'
   where alias in ('NBC Universal', 'NBCU', 'NBCUniversal')
     and approval_status = 'owner_approved';

  -- Fail loudly if this did not land exactly as intended: 3 approved, 7 untouched.
  select count(*) into v_count
    from core.licensor_alias where approval_status = 'owner_approved';
  if v_count <> 3 then
    raise exception 'NBC family approval: expected exactly 3 owner_approved rows, found %', v_count;
  end if;

  select count(*) into v_count
    from core.licensor_alias where approval_status = 'inherited_unverified';
  if v_count <> 7 then
    raise exception
      'NBC family approval: expected exactly 7 rows still inherited_unverified, found %. '
      'Albert ruled on the NBC family ONLY.', v_count;
  end if;
end;
$$;
