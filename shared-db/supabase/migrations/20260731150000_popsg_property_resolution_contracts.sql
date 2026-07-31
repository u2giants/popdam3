-- PSG-5 — PopSG Property reconciliation preview contracts
--
-- Plan: fix_popsg_property_taxonomy_reconciliation.md sections 6.1, 6.2, 6.3, 6.4
-- Entry record and findings: same plan, section 21
--
-- Creates, and NOTHING more:
--   1. core.normalize_popsg_property_observation(text)
--      The one canonical normalizer. SQL implementation of the frozen contract
--      `popsg-property-observation-v1`
--      (docs/verification/popsg-property-reconciliation-20260726/normalization-contract-v1.md).
--   2. core.property_alias        -- shared, cross-app-certified alias truth (section 6.1)
--   3. dam.popsg_property_resolution -- app-owned PopSG decisions, append-only (section 6.2)
--   4. Guarded RPCs in `public` for propose / activate / promote (section 6.3)
--
-- Creates NO canonical Property, activates NO mapping, removes NO tag, and seeds
-- NO decision row. Activation is a separate, hash-verified RPC call. Only Albert's
-- approved batch `batch-01-exact-existing`
-- (51 rows / 44,331 files, SHA-256 f59118aa0eac1772473ec21b427b6b79ad923c16328d5e8318015fd53a46643e)
-- may ever be activated through it; batch 02, canonical creates, the 6,961 at-risk
-- removals, ambiguous rows and deferred rows are NOT approved.
--
-- GRANTS ARE STATED EXPLICITLY ON EVERY `public` FUNCTION BELOW. Since 2026-07-29 an
-- event trigger (`lock_down_new_public_function_execute_trg`, AGENTS.md section 10.2)
-- revokes EXECUTE from PUBLIC and `anon` on every new `public` function, and its own
-- failures are `raise warning` only. Without the explicit grants that follow, these
-- RPCs would be callable by nobody and it would look like the migration succeeded.

-- ---------------------------------------------------------------------------
-- 1. The one normalization contract  (plan section 6.4)
-- ---------------------------------------------------------------------------
-- Steps, in the exact order the frozen contract specifies:
--   1. Unicode NFKC.
--   2. Insert one ASCII space between [a-z0-9] and a following [A-Z].
--   3. Lowercase.
--   4. Remove straight and curly apostrophes WITHOUT inserting a space.
--   5. Underscore / slash / backslash / en dash / em dash / ASCII hyphen runs -> one space.
--   6. Every remaining run outside [a-z0-9] -> one space (so `&` separates).
--   7. Trim.
--   8. Collapse remaining whitespace runs to one space.
--
-- Steps 5 and 6 are deliberately kept as separate statements even though 6 subsumes
-- 5, so this function can be read line-by-line against the frozen contract text.
-- Step 4 must run BEFORE them: that is what makes `Gabby's` -> `gabbys` and not
-- `gabby s`.
--
-- IMMUTABLE is required because a generated column depends on it. Do not add any
-- collation-, locale-, or search_path-dependent behaviour here.
create or replace function core.normalize_popsg_property_observation(p_input text)
returns text
language sql
immutable
parallel safe
returns null on null input
set search_path = pg_catalog
as $$
  select btrim(                                                    -- 7 + 8
    regexp_replace(
      regexp_replace(                                              -- 6
        regexp_replace(                                            -- 5
          regexp_replace(                                          -- 4
            lower(                                                 -- 3
              regexp_replace(                                      -- 2
                normalize(p_input, NFKC),                          -- 1
                '([a-z0-9])([A-Z])', '\1 \2', 'g'
              )
            ),
            '[' || chr(39) || chr(8216) || chr(8217) || ']', '', 'g'
          ),
          '[_/\\' || chr(8211) || chr(8212) || '-]+', ' ', 'g'
        ),
        '[^a-z0-9]+', ' ', 'g'
      ),
      '\s+', ' ', 'g'
    )
  );
$$;

comment on function core.normalize_popsg_property_observation(text) is
  'Canonical PopSG Property observation normalizer, contract popsg-property-observation-v1. '
  'Frozen spec and fixture corpus: docs/verification/popsg-property-reconciliation-20260726/. '
  'The PopDAM worker normalizePopSGTag must stay byte-identical to this; '
  'supabase/tests/popsg_property_resolution_contracts.sql asserts the whole frozen corpus. '
  'Never change this body without re-freezing the contract and rebaselining every '
  'generated normalized_alias / normalized_observed_value column that depends on it.';

revoke execute on function core.normalize_popsg_property_observation(text) from public;
grant  execute on function core.normalize_popsg_property_observation(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. core.property_alias  -- shared alias truth  (plan section 6.1)
-- ---------------------------------------------------------------------------
-- Table shape follows core.customer_alias (20260716143231). The NORMALIZER IS
-- DELIBERATELY DIFFERENT: customer_alias uses a simple lower()+whitespace collapse,
-- which plan section 6.4 explicitly forbids copying here.
--
-- Only cross-app-certified business aliases belong here. A PopSG folder artifact
-- goes in dam.popsg_property_resolution instead (see section 2 of this file).
create table core.property_alias (
  id                    uuid primary key default gen_random_uuid(),
  property_id           uuid not null references core.property(id) on delete cascade,
  licensor_id           uuid not null references core.licensor(id) on delete restrict,
  alias                 text not null,
  normalized_alias      text generated always as
                          (core.normalize_popsg_property_observation(alias)) stored,
  source_system         text,
  evidence_notes        text,
  cross_app_certified   boolean not null default false,
  approved_by           text,
  approved_at           timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  -- Blank aliases are forbidden (section 6.1). Checked on the RAW text; the
  -- normalized-empty case is caught by property_alias_normalized_not_blank below,
  -- which also rejects punctuation-only input such as '---'.
  constraint property_alias_alias_not_blank
    check (length(btrim(alias)) > 0),

  -- An alias that normalizes to nothing can never match an observation, and would
  -- collide with every other such row on the unique index.
  constraint property_alias_normalized_not_blank
    check (length(core.normalize_popsg_property_observation(alias)) > 0),

  -- Promotion into shared truth requires certification AND an approver (section 6.1).
  constraint property_alias_certification_requires_approval
    check (
      cross_app_certified = false
      or (approved_by is not null and approved_at is not null)
    )
);

-- The alias row's licensor_id MUST equal the linked Property's canonical parent
-- (section 6.1). A CHECK cannot read another table, so this is enforced structurally:
-- a composite FK against a matching composite unique key on core.property makes a
-- mismatched pair unrepresentable, and it stays enforced under concurrency and on
-- any later re-parent of the Property.
create unique index if not exists property_id_licensor_id_key
  on core.property (id, licensor_id);

alter table core.property_alias
  add constraint property_alias_parent_matches_property
  foreign key (property_id, licensor_id)
  references core.property (id, licensor_id)
  on update cascade
  on delete cascade;

-- Uniqueness is scoped to (licensor_id, normalized_alias) -- section 6.1. The same
-- alias text under a DIFFERENT Licensor is legitimate and must remain insertable;
-- that is the whole point of parent-scoped matching.
create unique index property_alias_licensor_norm_key
  on core.property_alias (licensor_id, normalized_alias);

create index property_alias_property_idx on core.property_alias (property_id);
create index property_alias_norm_idx     on core.property_alias (normalized_alias);

create trigger set_updated_at before update on core.property_alias
  for each row execute function app.set_updated_at();

-- An alias identical to the canonical name or code of its OWN target Property is
-- redundant (section 6.1) and is rejected. This is a trigger rather than a CHECK
-- because it must read core.property.
create or replace function core.reject_redundant_property_alias()
returns trigger
language plpgsql
security definer
set search_path = core, pg_catalog
as $$
declare
  v_norm_name text;
  v_norm_code text;
begin
  select core.normalize_popsg_property_observation(p.name),
         core.normalize_popsg_property_observation(coalesce(p.code, ''))
    into v_norm_name, v_norm_code
    from core.property p
   where p.id = new.property_id;

  if new.normalized_alias in (v_norm_name, v_norm_code) then
    raise exception
      'property_alias %: alias % is redundant -- it already normalizes to the target Property''s own name or code',
      new.id, new.alias
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

revoke execute on function core.reject_redundant_property_alias() from public;

create trigger reject_redundant_property_alias
  before insert or update of alias, property_id on core.property_alias
  for each row execute function core.reject_redundant_property_alias();

comment on table core.property_alias is
  'Cross-app-certified Property aliases, scoped to the canonical Licensor parent. '
  'PopSG-only folder artifacts do NOT belong here -- use dam.popsg_property_resolution. '
  'Browser roles are read-only; writes go through public.promote_property_alias_batch().';

alter table core.property_alias enable row level security;

-- Read for the same role set every other core.* table uses. NO write policy for
-- `authenticated` at all: section 6.1 requires that RLS and GRANTs INDEPENDENTLY
-- enforce read-only access for normal browser roles. Even an administrator cannot
-- write this table directly -- shared alias truth changes only through the guarded,
-- owner-hash-verified RPC below.
create policy shared_read on core.property_alias
  for select to authenticated
  using (app.has_any_role(array['administrator','sales','licensing','designer','viewer','vendor']::app.app_role[]));

revoke all on core.property_alias from public, anon, authenticated;
grant select on core.property_alias to authenticated;
grant all    on core.property_alias to service_role;

-- ---------------------------------------------------------------------------
-- 3. dam.popsg_property_resolution  -- app-owned decisions  (plan section 6.2)
-- ---------------------------------------------------------------------------
-- Append-only revisions plus a current-row pointer (section 6.3). A decision is
-- never overwritten or deleted: a new revision supersedes the previous one and the
-- history stays queryable.
--
-- `dam` is deliberately NOT exposed through PostgREST (AGENTS.md section 8.1), so
-- every caller reaches this table through the public SECURITY DEFINER RPCs below.
-- Do not add `dam` to pgrst.db_schemas to "fix" that.
create table dam.popsg_property_resolution (
  id                      uuid primary key default gen_random_uuid(),

  -- The observation tuple. licensor_id is the RESOLVED canonical parent; a row may
  -- only exist once its parent Licensor is known, which is why it is NOT NULL.
  -- `licensor_unresolved` observations are out of scope for this table by design
  -- (plan section 4: they are routed to a separate Licensor queue).
  licensor_id             uuid not null references core.licensor(id) on delete restrict,
  raw_observed_value      text not null,
  normalized_observed_value text generated always as
                            (core.normalize_popsg_property_observation(raw_observed_value)) stored,

  disposition             text not null,
  property_id             uuid references core.property(id) on delete restrict,

  occurrence_count        integer not null default 0 check (occurrence_count >= 0),
  evidence_run_id         text,
  evidence_batch_id       text,
  evidence_batch_sha256   text,
  review_notes            text,

  -- Lifecycle. A row is created `pending` and can only become `active` through the
  -- owner-hash activation RPC (section 6.3).
  decision_state          text not null default 'pending',
  proposed_by             text not null,
  proposed_at             timestamptz not null default now(),
  activated_by            text,
  activated_at            timestamptz,
  superseded_by           uuid references dam.popsg_property_resolution(id) on delete set null,
  superseded_at           timestamptz,

  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  constraint popsg_property_resolution_disposition_check
    check (disposition in (
      'exact_existing','alias_existing','classics_cp','non_property',
      'licensed_no_code','canonical_create_candidate','ambiguous','deferred'
    )),

  constraint popsg_property_resolution_state_check
    check (decision_state in ('pending','active','superseded','rejected')),

  -- Only these three dispositions may carry a Property target, and they MUST carry
  -- one. Every other disposition must have property_id IS NULL -- that is what makes
  -- "intentionally untagged" structurally impossible to turn into a tag by accident.
  constraint popsg_property_resolution_target_matches_disposition
    check (
      case
        when disposition in ('exact_existing','alias_existing','classics_cp')
          then property_id is not null
        else property_id is null
      end
    ),

  constraint popsg_property_resolution_activation_fields
    check (
      (decision_state <> 'active')
      or (activated_by is not null and activated_at is not null)
    ),

  constraint popsg_property_resolution_raw_not_blank
    check (length(btrim(raw_observed_value)) > 0)
);

-- Same structural cross-parent guard as the alias table: a decision can never point
-- at a Property belonging to a different Licensor. Plan rule 3 -- a Property decision
-- may never cross the canonical parent edge -- is enforced by the database, not by
-- application code. NULL property_id rows are exempt (MATCH SIMPLE with a NULL column
-- skips the check), which is exactly right for the non-tagging dispositions.
alter table dam.popsg_property_resolution
  add constraint popsg_property_resolution_parent_matches_property
  foreign key (property_id, licensor_id)
  references core.property (id, licensor_id)
  on update cascade
  on delete restrict;

-- At most ONE active decision per observation tuple. Superseded and pending
-- revisions are unconstrained, so history accumulates freely.
create unique index popsg_property_resolution_active_tuple_key
  on dam.popsg_property_resolution (licensor_id, normalized_observed_value)
  where decision_state = 'active';

create index popsg_property_resolution_tuple_idx
  on dam.popsg_property_resolution (licensor_id, normalized_observed_value);
create index popsg_property_resolution_state_idx
  on dam.popsg_property_resolution (decision_state);
create index popsg_property_resolution_batch_idx
  on dam.popsg_property_resolution (evidence_batch_id);

create trigger set_updated_at before update on dam.popsg_property_resolution
  for each row execute function app.set_updated_at();

-- Append-only enforcement: once a row is `active` or `superseded`, its decision
-- content is frozen. Only the supersede pointer and lifecycle columns may still move.
-- This is what makes the audit history trustworthy (section 6.3).
create or replace function dam.enforce_popsg_resolution_append_only()
returns trigger
language plpgsql
security definer
set search_path = dam, pg_catalog
as $$
begin
  if tg_op = 'DELETE' then
    raise exception
      'dam.popsg_property_resolution is append-only: delete of row % is refused. Supersede it instead.',
      old.id
      using errcode = 'restrict_violation';
  end if;

  if old.decision_state in ('active','superseded') then
    if new.raw_observed_value is distinct from old.raw_observed_value
       or new.licensor_id      is distinct from old.licensor_id
       or new.disposition      is distinct from old.disposition
       or new.property_id      is distinct from old.property_id
       or new.evidence_batch_sha256 is distinct from old.evidence_batch_sha256
    then
      raise exception
        'dam.popsg_property_resolution row % is % and its decision content is immutable. Insert a new revision and supersede this one.',
        old.id, old.decision_state
        using errcode = 'restrict_violation';
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function dam.enforce_popsg_resolution_append_only() from public;

create trigger enforce_popsg_resolution_append_only
  before update or delete on dam.popsg_property_resolution
  for each row execute function dam.enforce_popsg_resolution_append_only();

comment on table dam.popsg_property_resolution is
  'Append-only PopSG Property reconciliation decisions (plan section 6.2). One active row per '
  '(licensor_id, normalized_observed_value). Created pending; only '
  'public.activate_popsg_property_decision_batch() with the exact owner-approved '
  'SHA-256 can make a row active. Reached through public RPCs because dam is not '
  'exposed via PostgREST.';

alter table dam.popsg_property_resolution enable row level security;

-- Read follows the established dam pattern. NO write policy for `authenticated`:
-- all writes go through the SECURITY DEFINER RPCs, which run as owner and are
-- therefore unaffected by the absence of a write policy.
create policy dam_read on dam.popsg_property_resolution
  for select to authenticated
  using (app.has_app_access('dam') or app.has_role('administrator'));

revoke all on dam.popsg_property_resolution from public, anon, authenticated;
grant select on dam.popsg_property_resolution to authenticated;
grant all    on dam.popsg_property_resolution to service_role;

-- ---------------------------------------------------------------------------
-- 4. Guarded RPCs  (plan sections 6.1 and 6.3)
-- ---------------------------------------------------------------------------
-- Three separately named RPCs at three different authority levels. Plan section 6.1
-- forbids overloading one RPC across them.
--
--   propose_popsg_property_resolution     -- administrator may create PENDING rows
--   activate_popsg_property_decision_batch-- owner hash only; makes rows effective
--   promote_property_alias_batch          -- owner hash + cross-app certification
--
-- EVERY ONE ends with an explicit revoke/grant pair. See the header note about the
-- 2026-07-29 public-schema lockdown.

-- 4a. Administrator creates a PENDING proposal. Never effective (section 6.3).
create or replace function public.propose_popsg_property_resolution(
  p_licensor_id           uuid,
  p_raw_observed_value    text,
  p_disposition           text,
  p_property_id           uuid    default null,
  p_occurrence_count      integer default 0,
  p_evidence_batch_id     text    default null,
  p_evidence_batch_sha256 text    default null,
  p_evidence_run_id       text    default null,
  p_review_notes          text    default null
)
returns uuid
language plpgsql
security definer
set search_path = public, core, dam, app, pg_catalog
as $$
declare
  v_id uuid;
begin
  -- Authority check. A viewer or designer must not be able to propose (plan test 14).
  -- service_role is allowed so the PopDAM worker/importer can stage proposals.
  if not (app.has_role('administrator') or auth.role() = 'service_role') then
    raise exception 'propose_popsg_property_resolution: administrator role required'
      using errcode = 'insufficient_privilege';
  end if;

  -- Fail closed if the observation normalizes away entirely.
  if core.normalize_popsg_property_observation(coalesce(p_raw_observed_value, '')) = '' then
    raise exception 'propose_popsg_property_resolution: observation % normalizes to the empty string',
      p_raw_observed_value
      using errcode = 'check_violation';
  end if;

  -- The remaining invariants (disposition vocabulary, target-matches-disposition,
  -- and above all the cross-parent edge) are enforced by the table constraints, so
  -- they cannot be bypassed by any other write path either.
  insert into dam.popsg_property_resolution (
    licensor_id, raw_observed_value, disposition, property_id,
    occurrence_count, evidence_batch_id, evidence_batch_sha256, evidence_run_id,
    review_notes, decision_state, proposed_by
  ) values (
    p_licensor_id, p_raw_observed_value, p_disposition, p_property_id,
    coalesce(p_occurrence_count, 0), p_evidence_batch_id, p_evidence_batch_sha256,
    p_evidence_run_id, p_review_notes, 'pending', coalesce(auth.uid()::text, 'service_role')
  )
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.propose_popsg_property_resolution(uuid,text,text,uuid,integer,text,text,text,text) is
  'Creates a PENDING PopSG Property resolution proposal. Administrator or service_role only. '
  'Cannot make anything effective -- see activate_popsg_property_decision_batch().';

revoke execute on function public.propose_popsg_property_resolution(uuid,text,text,uuid,integer,text,text,text,text)
  from public, anon;
grant  execute on function public.propose_popsg_property_resolution(uuid,text,text,uuid,integer,text,text,text,text)
  to authenticated, service_role;

-- 4b. Owner activation, bound to an exact unchanged hash (section 6.3).
--
-- The caller must supply BOTH the batch id and the SHA-256 Albert approved. Every
-- pending row in the batch must already carry that same hash, so editing a proposal
-- after approval (which changes what the batch contains) cannot be activated under
-- the old hash without the caller lying about the hash on every row -- and the rows
-- are what the worker reads.
--
-- Activation supersedes any previously active decision for the same tuple rather
-- than overwriting it, preserving the audit chain.
create or replace function public.activate_popsg_property_decision_batch(
  p_evidence_batch_id     text,
  p_evidence_batch_sha256 text,
  p_expected_row_count    integer
)
returns integer
language plpgsql
security definer
set search_path = public, core, dam, app, pg_catalog
as $$
declare
  v_actual_count integer;
  v_activated    integer := 0;
  v_actor        text;
begin
  if not (app.has_role('administrator') or auth.role() = 'service_role') then
    raise exception 'activate_popsg_property_decision_batch: administrator role required'
      using errcode = 'insufficient_privilege';
  end if;

  if p_evidence_batch_id is null or p_evidence_batch_sha256 is null then
    raise exception 'activate_popsg_property_decision_batch: batch id and SHA-256 are both required'
      using errcode = 'null_value_not_allowed';
  end if;

  v_actor := coalesce(auth.uid()::text, 'service_role');

  -- Serialize activation of a batch so two concurrent callers cannot both pass the
  -- count check and double-activate.
  perform pg_advisory_xact_lock(hashtext('popsg_property_decision_batch'), hashtext(p_evidence_batch_id));

  select count(*) into v_actual_count
    from dam.popsg_property_resolution r
   where r.evidence_batch_id = p_evidence_batch_id
     and r.evidence_batch_sha256 = p_evidence_batch_sha256
     and r.decision_state = 'pending';

  -- The expected row count is the second half of the owner's approval: batch 01 is
  -- "51 rows", and a batch that no longer has exactly 51 pending rows is not the
  -- batch that was approved.
  if v_actual_count <> p_expected_row_count then
    raise exception
      'activate_popsg_property_decision_batch: batch % under hash % has % pending rows, owner approved %. Refusing to activate.',
      p_evidence_batch_id, p_evidence_batch_sha256, v_actual_count, p_expected_row_count
      using errcode = 'check_violation';
  end if;

  -- Supersede whatever is currently active for these tuples.
  update dam.popsg_property_resolution old_row
     set decision_state = 'superseded',
         superseded_at  = now()
   where old_row.decision_state = 'active'
     and exists (
       select 1 from dam.popsg_property_resolution new_row
        where new_row.evidence_batch_id = p_evidence_batch_id
          and new_row.evidence_batch_sha256 = p_evidence_batch_sha256
          and new_row.decision_state = 'pending'
          and new_row.licensor_id = old_row.licensor_id
          and new_row.normalized_observed_value = old_row.normalized_observed_value
     );

  update dam.popsg_property_resolution
     set decision_state = 'active',
         activated_by   = v_actor,
         activated_at   = now()
   where evidence_batch_id = p_evidence_batch_id
     and evidence_batch_sha256 = p_evidence_batch_sha256
     and decision_state = 'pending';

  get diagnostics v_activated = row_count;
  return v_activated;
end;
$$;

comment on function public.activate_popsg_property_decision_batch(text,text,integer) is
  'Makes a frozen PopSG decision batch effective. Requires the exact owner-approved '
  'batch id, SHA-256, and row count; refuses otherwise. Supersedes rather than '
  'overwrites the previous active decision for each tuple.';

revoke execute on function public.activate_popsg_property_decision_batch(text,text,integer)
  from public, anon;
grant  execute on function public.activate_popsg_property_decision_batch(text,text,integer)
  to authenticated, service_role;

-- 4c. Shared-alias promotion -- the highest authority level (section 6.1).
-- Requires the owner hash AND an explicit cross-app certification flag. A PopSG-only
-- folder artifact must never reach core.property_alias, so the caller has to assert
-- certification per call; it is not inferable from the decision row.
create or replace function public.promote_property_alias_batch(
  p_property_id           uuid,
  p_alias                 text,
  p_evidence_batch_sha256 text,
  p_cross_app_certified   boolean,
  p_approved_by           text,
  p_evidence_notes        text default null,
  p_source_system         text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, core, dam, app, pg_catalog
as $$
declare
  v_id          uuid;
  v_licensor_id uuid;
begin
  if not (app.has_role('administrator') or auth.role() = 'service_role') then
    raise exception 'promote_property_alias_batch: administrator role required'
      using errcode = 'insufficient_privilege';
  end if;

  if p_cross_app_certified is not true then
    raise exception
      'promote_property_alias_batch: refusing to write shared alias truth without explicit cross-app certification. '
      'PopSG-only folder artifacts belong in dam.popsg_property_resolution.'
      using errcode = 'check_violation';
  end if;

  if p_approved_by is null or length(btrim(p_approved_by)) = 0
     or p_evidence_batch_sha256 is null or length(btrim(p_evidence_batch_sha256)) = 0 then
    raise exception 'promote_property_alias_batch: approver identity and owner-approved SHA-256 are both required'
      using errcode = 'null_value_not_allowed';
  end if;

  -- Derive the parent from the Property itself. The caller does not get to supply it,
  -- so a caller cannot assert a wrong parent; the composite FK then re-proves it.
  select p.licensor_id into v_licensor_id
    from core.property p
   where p.id = p_property_id;

  if v_licensor_id is null then
    raise exception 'promote_property_alias_batch: property % does not exist', p_property_id
      using errcode = 'foreign_key_violation';
  end if;

  insert into core.property_alias (
    property_id, licensor_id, alias, source_system, evidence_notes,
    cross_app_certified, approved_by, approved_at
  ) values (
    p_property_id, v_licensor_id, p_alias, p_source_system, p_evidence_notes,
    true, p_approved_by, now()
  )
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.promote_property_alias_batch(uuid,text,text,boolean,text,text,text) is
  'Promotes one certified alias into shared core.property_alias truth. Requires explicit '
  'cross-app certification, an approver, and the owner-approved SHA-256. Derives the '
  'Licensor parent from the Property so the caller cannot assert a wrong one.';

revoke execute on function public.promote_property_alias_batch(uuid,text,text,boolean,text,text,text)
  from public, anon;
grant  execute on function public.promote_property_alias_batch(uuid,text,text,boolean,text,text,text)
  to authenticated, service_role;
