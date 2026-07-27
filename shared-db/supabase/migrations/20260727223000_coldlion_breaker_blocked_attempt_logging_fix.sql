-- Correction to 20260727221500 (which is APPLIED and therefore immutable).
--
-- THE TRAP, found by its own contract test on 2026-07-27
-- ------------------------------------------------------
-- The breaker guard triggers in 20260727221500 tried to log the refusal they were
-- about to raise:
--
--     insert into plm.taxonomy_circuit_breaker_event (... 'blocked_attempt' ...);
--     raise exception 'circuit breaker is TRIPPED ...';
--
-- That can never work. The exception aborts the statement, which rolls back the
-- trigger's own insert. The refusal is correct and total, but the event row
-- silently disappears — code that LOOKS like durable evidence and records nothing.
-- The contract test caught it (`blocked attempts were not recorded append-only
-- (got 0)`), which is the only reason it is not now a permanent blind spot.
--
-- A trigger cannot durably log the exception it raises. Postgres has no autonomous
-- transactions. So:
--   * the triggers now ONLY refuse — pure, total, no misleading write;
--   * the CALLER records the blocked attempt through the new function below, after
--     it catches the refusal, in its own transaction that actually commits.
--
-- The refusal itself was never in doubt: 20260727221500 already blocks every
-- ColdLion source-ref write and every typed mirror link change while tripped. This
-- migration fixes the EVIDENCE path, not the enforcement path.

create or replace function plm.record_taxonomy_circuit_breaker_blocked_attempt(
  p_reason text,
  p_lane text default 'coldlion_licensor_property',
  p_actor text default null,
  p_payload jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = plm, public
as $$
declare
  v_id uuid;
begin
  insert into plm.taxonomy_circuit_breaker_event (
    lane, event, reason, failed_invariant, actor, payload)
  values (
    coalesce(nullif(btrim(p_lane), ''), 'coldlion_licensor_property'),
    'blocked_attempt',
    left(coalesce(nullif(btrim(p_reason), ''),
                  'ColdLion promotion refused by the circuit breaker'), 4000),
    'circuit_breaker_open',
    coalesce(nullif(btrim(p_actor), ''), session_user),
    coalesce(p_payload, '{}'::jsonb) - 'api_key' - 'password' - 'token' - 'secret')
  returning id into v_id;
  return v_id;
end;
$$;

comment on function plm.record_taxonomy_circuit_breaker_blocked_attempt(text, text, text, jsonb) is
  'Append-only record of a promotion attempt the tripped breaker refused. Called by the runner AFTER it catches the refusal — a trigger cannot durably log the exception it raises, because that exception rolls back the trigger''s own write.';

revoke all on function plm.record_taxonomy_circuit_breaker_blocked_attempt(text, text, text, jsonb)
  from public;
grant execute on function plm.record_taxonomy_circuit_breaker_blocked_attempt(text, text, text, jsonb)
  to service_role;

create or replace function public.record_taxonomy_circuit_breaker_blocked_attempt(
  p_reason text,
  p_lane text default 'coldlion_licensor_property',
  p_actor text default null,
  p_payload jsonb default '{}'::jsonb
)
returns uuid
language sql
security definer
set search_path = public, plm
as $$
  select plm.record_taxonomy_circuit_breaker_blocked_attempt(p_reason, p_lane, p_actor, p_payload);
$$;

revoke all on function public.record_taxonomy_circuit_breaker_blocked_attempt(text, text, text, jsonb)
  from public;
revoke all on function public.record_taxonomy_circuit_breaker_blocked_attempt(text, text, text, jsonb)
  from anon, authenticated;
grant execute on function public.record_taxonomy_circuit_breaker_blocked_attempt(text, text, text, jsonb)
  to service_role;

-- ---------------------------------------------------------------------------
-- Triggers now refuse only. No write that the raise would discard.
-- ---------------------------------------------------------------------------

create or replace function plm.guard_coldlion_source_ref_breaker()
returns trigger
language plpgsql
security definer
set search_path = plm, core, public
as $$
begin
  if new.source_system = 'coldlion'
     and plm.taxonomy_circuit_breaker_is_open('coldlion_licensor_property')
  then
    raise exception
      'ColdLion taxonomy circuit breaker is TRIPPED: refusing % of core.taxonomy_source_ref for source_id % — record the blocked attempt with plm.record_taxonomy_circuit_breaker_blocked_attempt(), then reset only with a named authorization and a green readiness evaluation',
      tg_op, new.source_id
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create or replace function plm.guard_coldlion_mirror_link_breaker()
returns trigger
language plpgsql
security definer
set search_path = plm, core, public
as $$
declare
  v_old uuid;
  v_new uuid;
  v_col text;
begin
  if tg_table_name = 'erp_licensor' then
    v_col := 'licensor_id';
    v_old := (to_jsonb(old)->>'licensor_id')::uuid;
    v_new := (to_jsonb(new)->>'licensor_id')::uuid;
  else
    v_col := 'property_id';
    v_old := (to_jsonb(old)->>'property_id')::uuid;
    v_new := (to_jsonb(new)->>'property_id')::uuid;
  end if;

  if v_new is distinct from v_old
     and plm.taxonomy_circuit_breaker_is_open('coldlion_licensor_property')
  then
    raise exception
      'ColdLion taxonomy circuit breaker is TRIPPED: refusing %.% change on plm.% — record the blocked attempt with plm.record_taxonomy_circuit_breaker_blocked_attempt(), then reset only with a named authorization and a green readiness evaluation',
      tg_table_name, v_col, tg_table_name
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;
