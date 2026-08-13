-- =====================================================================================
-- Issue #861 -- four live SECURITY DEFINER functions use the NULL-PERMISSIVE guard
-- and admit the call.
--
-- THE DEFECT
-- ----------
-- All four carried this shape:
--
--     if not (app.has_role('administrator') or auth.role() = 'service_role') then
--       raise exception '...';
--     end if;
--
-- When `auth.role()` is NULL:
--     NULL = 'service_role'   -> NULL
--     false or NULL           -> NULL
--     not NULL                -> NULL
--     IF NULL                 -> not true, so the branch is NOT taken
--
-- The raise is SKIPPED and the function proceeds. The guard READS strict and
-- BEHAVES open. Confirmed on the live production database (read-only, 2026-08-13):
-- in a direct/pooler session `auth.role()` is NULL, `app.has_role('administrator')`
-- is false, and the whole legacy expression evaluates to NULL.
--
-- Honest bound on exploitability (from #861): a normal PostgREST call carries a
-- `role` claim, so `auth.role()` returns 'authenticated' and the guard DOES fire.
-- The NULL path is a session with no JWT claims -- direct/pooler connections,
-- migration context, and any JWT that reaches PostgREST without a `role` claim.
-- `anon` has no EXECUTE on these four, which is what keeps this HIGH, not CRITICAL.
--
-- THE FIX
-- -------
-- The correct pattern already exists in this repo -- see
-- `plm.assert_taxonomy_alert_ack_authority()` (20260802140000) and
-- `ingest.assert_coldlion_product_size_authority()`. Resolve the request role into
-- a local, then require a NON-NULL role AND a POSITIVE match. Every operand of the
-- new condition is strictly boolean and never NULL, so an unresolvable role is
-- DENIED instead of admitted.
--
-- WHY THIS IS A FORWARD MIGRATION
-- -------------------------------
-- 20260731150000_popsg_property_resolution_contracts.sql and
-- 20260731210000_core_licensor_alias.sql are already recorded in
-- `supabase_migrations.schema_migrations`. The CLI keys on the VERSION alone, so it
-- will never re-run them: editing those files would change nothing in any database
-- and would desynchronise file from ledger. They are left exactly as they are.
--
-- SCOPE -- NOTHING ELSE CHANGES
-- -----------------------------
-- Each function below is re-emitted from its CURRENT LIVE `pg_proc.prosrc`
-- (read out of production read-only before this file was written; the live bodies
-- matched the two source migrations byte-for-byte, so there was no drift to
-- reconcile). Signature, return type, LANGUAGE, VOLATILITY, SECURITY DEFINER,
-- owner and `search_path` are all preserved verbatim. The ONLY edit is the guard
-- block at the top of each body. The grants are re-emitted unchanged
-- (authenticated, service_role -- matching the live ACL
-- `{postgres=X/postgres,service_role=X/postgres,authenticated=X/postgres}`) so this
-- migration is safe to apply to a database where the earlier ones already ran.
--
-- Tests: supabase/tests/null_permissive_security_definer_guard.sql
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- 1. public.propose_popsg_property_resolution
-- -------------------------------------------------------------------------------------

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
  v_id       uuid;
  v_jwt_role text;
begin
  -- Authority check. A viewer or designer must not be able to propose (plan test 14).
  -- service_role is allowed so the PopDAM worker/importer can stage proposals.
  --
  -- #861: resolve the request role into a NON-NULL local and require a POSITIVE
  -- match. auth.role() may be NULL (no JWT claims) or absent outside hosted
  -- Supabase; treat both as "unknown", never as "permitted".
  begin
    v_jwt_role := nullif(btrim(coalesce(auth.role(), '')), '');
  exception when others then
    v_jwt_role := null;
  end;

  if not (coalesce(app.has_role('administrator'), false)
          or (v_jwt_role is not null and v_jwt_role = 'service_role')) then
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
  'Cannot make anything effective -- see activate_popsg_property_decision_batch(). '
  'Authority guard requires a NON-NULL role AND a positive match (#861): the earlier '
  '`if not (has_role or auth.role() = ...)` form evaluated to NULL under a NULL role and '
  'silently admitted the call.';

revoke execute on function public.propose_popsg_property_resolution(uuid,text,text,uuid,integer,text,text,text,text)
  from public, anon;
grant  execute on function public.propose_popsg_property_resolution(uuid,text,text,uuid,integer,text,text,text,text)
  to authenticated, service_role;

-- -------------------------------------------------------------------------------------
-- 2. public.activate_popsg_property_decision_batch
-- -------------------------------------------------------------------------------------

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
  v_jwt_role     text;
begin
  -- #861: non-null role AND positive match. See the header of this migration.
  begin
    v_jwt_role := nullif(btrim(coalesce(auth.role(), '')), '');
  exception when others then
    v_jwt_role := null;
  end;

  if not (coalesce(app.has_role('administrator'), false)
          or (v_jwt_role is not null and v_jwt_role = 'service_role')) then
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
  'overwrites the previous active decision for each tuple. '
  'Authority guard requires a NON-NULL role AND a positive match (#861).';

revoke execute on function public.activate_popsg_property_decision_batch(text,text,integer)
  from public, anon;
grant  execute on function public.activate_popsg_property_decision_batch(text,text,integer)
  to authenticated, service_role;

-- -------------------------------------------------------------------------------------
-- 3. public.promote_property_alias_batch
-- -------------------------------------------------------------------------------------

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
  v_jwt_role    text;
begin
  -- #861: non-null role AND positive match. See the header of this migration.
  begin
    v_jwt_role := nullif(btrim(coalesce(auth.role(), '')), '');
  exception when others then
    v_jwt_role := null;
  end;

  if not (coalesce(app.has_role('administrator'), false)
          or (v_jwt_role is not null and v_jwt_role = 'service_role')) then
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
  'Licensor parent from the Property so the caller cannot assert a wrong one. '
  'Authority guard requires a NON-NULL role AND a positive match (#861).';

revoke execute on function public.promote_property_alias_batch(uuid,text,text,boolean,text,text,text)
  from public, anon;
grant  execute on function public.promote_property_alias_batch(uuid,text,text,boolean,text,text,text)
  to authenticated, service_role;

-- -------------------------------------------------------------------------------------
-- 4. public.approve_licensor_alias
-- -------------------------------------------------------------------------------------

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
  v_id       uuid;
  v_jwt_role text;
begin
  -- #861: non-null role AND positive match. See the header of this migration.
  begin
    v_jwt_role := nullif(btrim(coalesce(auth.role(), '')), '');
  exception when others then
    v_jwt_role := null;
  end;

  if not (coalesce(app.has_role('administrator'), false)
          or (v_jwt_role is not null and v_jwt_role = 'service_role')) then
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
  'and an evidence reference; there is no way to approve anonymously or without a record. '
  'Authority guard requires a NON-NULL role AND a positive match (#861).';

revoke execute on function public.approve_licensor_alias(text,text,text) from public, anon;
grant  execute on function public.approve_licensor_alias(text,text,text) to authenticated, service_role;
