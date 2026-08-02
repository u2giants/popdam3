-- =====================================================================================
-- Acknowledgement RPC for plm.taxonomy_sync_alert — the missing half of the alert design.
--
-- WHY THIS EXISTS
-- ---------------
-- `plm.taxonomy_sync_alert.acknowledged_at` and `.acknowledged_by` were created by
-- 20260726180000, and the partial index `plm_taxonomy_sync_alert_open_idx` is built on
-- `where acknowledged_at is null`. The columns were designed to be set. NOTHING IN THIS
-- REPOSITORY OR IN THE DATABASE EVER SET THEM. A full sweep (docs/coldlion-preview-alert-
-- diagnosis-20260802.md §5) found only readers. The alert channel was write-only: once an
-- alert fired, the hourly monitor re-found it every ten minutes, forever, and there was no
-- supported, audited way to close it.
--
-- This migration adds that path and ONLY that path. It does not change the alert table's
-- shape, does not delete anything, and does not alter what raises an alert.
--
-- FOUR DESIGN DECISIONS, EACH MADE AGAINST A DEFECT THIS REPO HAS ALREADY SHIPPED
-- ------------------------------------------------------------------------------
-- 1. SECURITY INVOKER, NOT SECURITY DEFINER.
--    The precedent function plm.reset_taxonomy_circuit_breaker is `security definer` and
--    performs no role check at all. The obvious "fix" — bolting on a guard shaped
--    `if not ( ... or auth.role() = 'service_role' ) then raise ...` — is NULL-PERMISSIVE:
--    inside a migration, and on any direct psql/pooler connection, `auth.role()` is NULL,
--    every arm of the OR is NULL, `not (NULL)` is NULL, and the `if` NEVER FIRES. It reads
--    strict and behaves wide open.
--    So authority here is NOT asserted by a hand-written predicate at all. These functions
--    run as the CALLER. UPDATE on plm.taxonomy_sync_alert is granted only to `postgres` and
--    `service_role`, and USAGE on schema `plm` is likewise closed to browser roles, so
--    Postgres's own privilege system is the guard. A privilege check in the executor cannot
--    be NULL and cannot be reasoned wrong.
--    The explicit assertion below is DEFENCE IN DEPTH ON TOP OF THAT, and it is written the
--    safe way round: it demands a NON-NULL effective role AND a POSITIVE match against an
--    allow-list. If it cannot determine a role, it REFUSES. See `assert_ack_authority`.
--
-- 2. THE ACTOR RECORD MUST MAKE AN AUTOMATED ACKNOWLEDGER UNMISTAKABLE.
--    Precedent to avoid: plm.taxonomy_circuit_breaker.reset_by on preview currently reads
--    `shared-db rehearsal sub-agent (preview only)`, because that field is free text
--    documented as "a named human". Anyone auditing "who reset the breaker" reads a name and
--    reasonably concludes a person did it.
--    Here, `acknowledged_by` is NEVER the caller's raw string. The caller must declare
--    `actor_type` as exactly 'human' or 'automation' — there is no default and no third
--    value — and the function CONSTRUCTS the stored value with a mandatory prefix:
--        human:<name>
--        automation:<name> (on behalf of human:<name>)
--    An automated actor cannot produce a bare human record: to reach the `human:` prefix it
--    must positively assert actor_type='human', and an automation-shaped name is rejected on
--    that path (see `looks_automated`). That last check is a heuristic and is stated as one;
--    the non-heuristic guarantees are the mandatory declaration, the mandatory prefix, the
--    mandatory named human behind any automation, and the connection facts in point 4.
--
-- 3. NO `BEFORE` TRIGGER, AND NO DEPENDENCE ON A GENERATED COLUMN.
--    A previous migration in this repo installed perfectly cleanly while doing nothing,
--    because a BEFORE trigger tried to read a `GENERATED ... STORED` column — Postgres
--    populates those AFTER before-triggers, so the value was always NULL and the guard never
--    fired. Every rule here is enforced in the function body, in plain statements whose
--    effect is asserted behaviourally, so there is no such window.
--
-- 4. THE RECORD CARRIES NON-FORGEABLE CONNECTION FACTS ALONGSIDE THE CLAIM.
--    `payload.acknowledgement.connection` records `session_user`, `current_user` and
--    `auth.role()` as observed by the server. The human/automation label is a CLAIM; those
--    three are not. An auditor who distrusts the claim has independent evidence.
--
-- APPEND-ONLY, AND LOUD ON DOUBLE-ACK
-- -----------------------------------
-- The alert row is never deleted and its existing payload keys are never removed — the
-- acknowledgement is merged in under a fresh `acknowledgement` key. Re-acknowledging an
-- already-acknowledged alert RAISES rather than silently overwriting, so the first (real)
-- acknowledgement can never be quietly replaced.
--
-- SCOPE
-- -----
-- This is an ACKNOWLEDGEMENT mechanism, not a residue filter. It can acknowledge any alert,
-- deliberately: an operator must be able to close a genuine alert after handling it, and a
-- function that only accepted alerts it could itself prove were harmless would be a function
-- that cannot close a real incident. The safety property is not "only residue may be closed",
-- it is "nothing may be closed anonymously, silently, or without a stated reason".
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- 1. Authority assertion (defence in depth over the table GRANT)
-- -------------------------------------------------------------------------------------

create or replace function plm.assert_taxonomy_alert_ack_authority()
returns text
language plpgsql
stable
set search_path = plm, public, auth
as $$
declare
  v_jwt_role   text;
  v_effective  text;
  v_allowed    text[] := array['postgres', 'service_role', 'supabase_admin'];
begin
  -- auth.role() may not exist outside hosted Supabase; treat its absence as "unknown",
  -- never as "permitted".
  begin
    v_jwt_role := nullif(btrim(coalesce(auth.role(), '')), '');
  exception when others then
    v_jwt_role := null;
  end;

  -- If a JWT role IS present it must itself be allowed. A PostgREST request arriving as
  -- `anon` or `authenticated` is refused here even though session_user would be
  -- `authenticator`. This arm is a positive match, never a NULL-tolerant negation.
  if v_jwt_role is not null and not (v_jwt_role = any (v_allowed)) then
    raise exception
      'acknowledging a taxonomy sync alert is not permitted for request role %', v_jwt_role
      using errcode = 'P0001';
  end if;

  -- Effective role. session_user is always a concrete role name, so this is never NULL on a
  -- real connection; the explicit NULL branch below exists so that if it somehow were, the
  -- function REFUSES instead of falling through.
  v_effective := coalesce(v_jwt_role, nullif(btrim(session_user::text), ''));

  if v_effective is null then
    raise exception
      'acknowledging a taxonomy sync alert requires a determinable database role; none was resolved'
      using errcode = 'P0001';
  end if;

  if not (v_effective = any (v_allowed)) then
    raise exception
      'acknowledging a taxonomy sync alert is not permitted for role %', v_effective
      using errcode = 'P0001';
  end if;

  return v_effective;
end;
$$;

comment on function plm.assert_taxonomy_alert_ack_authority() is
  'Defence-in-depth role assertion for alert acknowledgement. Requires a NON-NULL effective role AND a positive allow-list match, and refuses when no role can be resolved. Deliberately NOT written as `if not (... or auth.role() = ''service_role'')`, which never fires when auth.role() is NULL. The primary guard remains the UPDATE grant on plm.taxonomy_sync_alert (postgres, service_role only).';

-- -------------------------------------------------------------------------------------
-- 2. Automation-name heuristic (stated as a heuristic, not relied on as the guarantee)
-- -------------------------------------------------------------------------------------

create or replace function plm.taxonomy_alert_actor_looks_automated(p_name text)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select coalesce(p_name, '') ~*
    '(agent|bot\M|\mbot|automation|automated|robot|daemon|worker|runner|workflow|pipeline|cron|scheduler|service[_ -]?role|github[_ -]?actions|\mci\M|\mai\M|claude|codex|gpt|glm|gemini|llm|copilot|script|job\M)';
$$;

comment on function plm.taxonomy_alert_actor_looks_automated(text) is
  'Heuristic only. Used to refuse an obviously-automated name on the actor_type=''human'' path so an agent cannot casually record itself as a person. It is NOT the integrity guarantee — that is the mandatory actor_type declaration, the constructed prefix, the mandatory named human behind any automation, and the recorded connection facts.';

-- -------------------------------------------------------------------------------------
-- 3. The acknowledgement RPC
-- -------------------------------------------------------------------------------------

create or replace function plm.acknowledge_taxonomy_sync_alert(
  p_alert_id uuid,
  p_acknowledgement jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = plm, public, auth
as $$
declare
  v_role         text;
  v_actor_type   text;
  v_actor        text;
  v_on_behalf    text;
  v_reason       text;
  v_evidence     text;
  v_by           text;
  v_now          timestamptz;
  v_alert        plm.taxonomy_sync_alert%rowtype;
  v_ack          jsonb;
begin
  v_role := plm.assert_taxonomy_alert_ack_authority();

  if p_alert_id is null then
    raise exception 'acknowledging a taxonomy sync alert requires p_alert_id'
      using errcode = 'P0001';
  end if;

  if p_acknowledgement is null or jsonb_typeof(p_acknowledgement) <> 'object' then
    raise exception
      'acknowledging a taxonomy sync alert requires an explicit acknowledgement object'
      using errcode = 'P0001';
  end if;

  v_actor_type := nullif(btrim(lower(coalesce(p_acknowledgement->>'actor_type', ''))), '');
  v_actor      := nullif(btrim(coalesce(p_acknowledgement->>'actor', '')), '');
  v_on_behalf  := nullif(btrim(coalesce(p_acknowledgement->>'on_behalf_of', '')), '');
  v_reason     := nullif(btrim(coalesce(p_acknowledgement->>'reason', '')), '');
  v_evidence   := nullif(btrim(coalesce(p_acknowledgement->>'evidence', '')), '');

  -- actor_type is mandatory and closed. There is no default: an acknowledgement that does
  -- not say whether a person or a machine made it is refused outright.
  if v_actor_type is null or v_actor_type not in ('human', 'automation') then
    raise exception
      'acknowledgement.actor_type must be exactly ''human'' or ''automation'' (got %)',
      coalesce(p_acknowledgement->>'actor_type', '<missing>')
      using errcode = 'P0001';
  end if;

  if v_actor is null then
    raise exception 'acknowledgement.actor is required (the name of the acknowledger)'
      using errcode = 'P0001';
  end if;

  if v_reason is null or length(v_reason) < 20 then
    raise exception
      'acknowledgement.reason is required and must be at least 20 characters — an alert may not be closed without a stated reason'
      using errcode = 'P0001';
  end if;

  if v_actor_type = 'automation' then
    -- An automated acknowledger must name the human who authorized it. That human is the
    -- accountable party; the automation is the instrument.
    if v_on_behalf is null then
      raise exception
        'an automation acknowledgement requires acknowledgement.on_behalf_of (the named human who authorized it)'
        using errcode = 'P0001';
    end if;
    if plm.taxonomy_alert_actor_looks_automated(v_on_behalf) then
      raise exception
        'acknowledgement.on_behalf_of must name a human, not another automated actor (got %)', v_on_behalf
        using errcode = 'P0001';
    end if;
    v_by := format('automation:%s (on behalf of human:%s)', v_actor, v_on_behalf);
  else
    if plm.taxonomy_alert_actor_looks_automated(v_actor) then
      raise exception
        'acknowledgement.actor looks like an automated actor (%); record it as actor_type=''automation'' with on_behalf_of naming the responsible human',
        v_actor
        using errcode = 'P0001';
    end if;
    if v_on_behalf is not null then
      raise exception
        'acknowledgement.on_behalf_of is only meaningful for actor_type=''automation'''
        using errcode = 'P0001';
    end if;
    v_by := format('human:%s', v_actor);
  end if;

  select * into v_alert from plm.taxonomy_sync_alert where id = p_alert_id;
  if not found then
    raise exception 'taxonomy sync alert % does not exist', p_alert_id using errcode = 'P0001';
  end if;

  -- Loud on double-ack. The first acknowledgement is the record; it is never overwritten.
  if v_alert.acknowledged_at is not null then
    raise exception
      'taxonomy sync alert % was already acknowledged at % by %',
      p_alert_id, v_alert.acknowledged_at, coalesce(v_alert.acknowledged_by, '<unknown>')
      using errcode = 'P0001';
  end if;

  v_now := now();

  v_ack := jsonb_build_object(
    'acknowledged_at', v_now,
    'acknowledged_by', v_by,
    'actor_type',      v_actor_type,
    'actor',           v_actor,
    'on_behalf_of',    v_on_behalf,
    'reason',          v_reason,
    'evidence',        v_evidence,
    -- Server-observed, caller-uncontrollable. The actor_type label is a claim; these are not.
    'connection', jsonb_build_object(
      'session_user',   session_user::text,
      'current_user',   current_user::text,
      'effective_role', v_role
    )
  );

  update plm.taxonomy_sync_alert
     set acknowledged_at = v_now,
         acknowledged_by = v_by,
         -- Append-only merge: existing payload keys are preserved.
         payload = coalesce(payload, '{}'::jsonb) || jsonb_build_object('acknowledgement', v_ack)
   where id = p_alert_id
     and acknowledged_at is null;

  if not found then
    -- Concurrent acknowledgement lost the race. Never report success for a write that
    -- did not happen.
    raise exception
      'taxonomy sync alert % was acknowledged concurrently; nothing was written', p_alert_id
      using errcode = 'P0001';
  end if;

  return jsonb_build_object(
    'alert_id',        p_alert_id,
    'acknowledged_at', v_now,
    'acknowledged_by', v_by,
    'acknowledgement', v_ack
  );
end;
$$;

comment on function plm.acknowledge_taxonomy_sync_alert(uuid, jsonb) is
  'The ONLY supported way to set plm.taxonomy_sync_alert.acknowledged_at. Requires actor_type (''human''|''automation''), actor, a >=20 character reason, and — for automation — the named human it acts for. Stores a prefixed, function-constructed acknowledged_by (human:… / automation:… (on behalf of human:…)) so an automated acknowledger can never be mistaken for a person. Append-only; refuses to re-acknowledge. SECURITY INVOKER so the UPDATE grant is the real guard.';

-- -------------------------------------------------------------------------------------
-- 4. public wrapper (also SECURITY INVOKER — no privilege escalation path exists here)
-- -------------------------------------------------------------------------------------

create or replace function public.acknowledge_taxonomy_sync_alert(
  p_alert_id uuid,
  p_acknowledgement jsonb
)
returns jsonb
language sql
security invoker
set search_path = public, plm
as $$
  select plm.acknowledge_taxonomy_sync_alert(p_alert_id, p_acknowledgement);
$$;

comment on function public.acknowledge_taxonomy_sync_alert(uuid, jsonb) is
  'service_role-facing wrapper for plm.acknowledge_taxonomy_sync_alert. SECURITY INVOKER: a caller without UPDATE on plm.taxonomy_sync_alert and USAGE on schema plm cannot use it, regardless of EXECUTE.';

-- -------------------------------------------------------------------------------------
-- 5. Grants. Per AGENTS.md §10.2 a new public function is anon-locked by event trigger;
--    the explicit revokes below make that state intentional rather than incidental.
-- -------------------------------------------------------------------------------------

revoke all on function plm.assert_taxonomy_alert_ack_authority() from public;
revoke all on function plm.taxonomy_alert_actor_looks_automated(text) from public;
revoke all on function plm.acknowledge_taxonomy_sync_alert(uuid, jsonb) from public;
revoke all on function public.acknowledge_taxonomy_sync_alert(uuid, jsonb) from public;
revoke all on function public.acknowledge_taxonomy_sync_alert(uuid, jsonb) from anon, authenticated;

grant execute on function plm.assert_taxonomy_alert_ack_authority() to service_role;
grant execute on function plm.taxonomy_alert_actor_looks_automated(text) to service_role;
grant execute on function plm.acknowledge_taxonomy_sync_alert(uuid, jsonb) to service_role;
grant execute on function public.acknowledge_taxonomy_sync_alert(uuid, jsonb) to service_role;
