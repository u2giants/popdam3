-- #1883: synthetic, rollback-only Disney OPA lifecycle contracts on the real tables.
begin;

do $contract$
declare
  v_property_id bigint := 188300000001;
  v_character_id bigint := 188300000002;
  v_property_first_seen timestamptz := '2026-01-01 00:00:00+00';
  v_character_first_seen timestamptz := '2026-01-02 00:00:00+00';
  v_first_withdrawal timestamptz := '2026-02-01 00:00:00+00';
  v_invalid_rejected boolean := false;
  v_history_rejected boolean := false;
begin
  insert into plm.opa_property (
    licensed_property_id, property_name, first_seen_at, last_seen_at
  ) values (
    v_property_id, 'ZZTEST Synthetic Property', v_property_first_seen, v_property_first_seen
  );
  insert into plm.opa_character (
    character_id, character_name, first_seen_at, last_seen_at
  ) values (
    v_character_id, 'ZZTEST Synthetic Character', v_character_first_seen, v_character_first_seen
  );

  update plm.opa_property
  set status = 'withdrawn', withdrawn_at = v_first_withdrawal
  where licensed_property_id = v_property_id;
  update plm.opa_character
  set status = 'withdrawn', withdrawn_at = v_first_withdrawal
  where character_id = v_character_id;

  if (select first_withdrawn_at from plm.opa_property where licensed_property_id = v_property_id)
       is distinct from v_first_withdrawal
     or (select first_withdrawn_at from plm.opa_character where character_id = v_character_id)
       is distinct from v_first_withdrawal then
    raise exception 'OPA lifecycle FAILED: first withdrawal was not captured.';
  end if;

  -- Existing guarded sync updates last_seen_at on every source sighting, including an
  -- unchanged row. The lifecycle trigger wires that legal writer to reactivation.
  update plm.opa_property set last_seen_at = '2026-03-01 00:00:00+00'
  where licensed_property_id = v_property_id;
  update plm.opa_character set last_seen_at = '2026-03-01 00:00:00+00'
  where character_id = v_character_id;

  if not exists (
    select 1 from plm.opa_property
    where licensed_property_id = v_property_id
      and status = 'active' and withdrawn_at is null
      and first_withdrawn_at = v_first_withdrawal
      and first_seen_at = v_property_first_seen
  ) or not exists (
    select 1 from plm.opa_character
    where character_id = v_character_id
      and status = 'active' and withdrawn_at is null
      and first_withdrawn_at = v_first_withdrawal
      and first_seen_at = v_character_first_seen
  ) then
    raise exception 'OPA lifecycle FAILED: source reappearance did not reactivate while preserving history.';
  end if;

  begin
    update plm.opa_property
    set first_withdrawn_at = v_first_withdrawal + interval '1 day'
    where licensed_property_id = v_property_id;
  exception when sqlstate 'P0001' then v_history_rejected := true;
  end;
  if not v_history_rejected then
    raise exception 'OPA lifecycle FAILED: first withdrawal history was replaceable.';
  end if;

  begin
    update plm.opa_character
    set status = 'withdrawn', withdrawn_at = null
    where character_id = v_character_id;
  exception when check_violation then v_invalid_rejected := true;
  end;
  if not v_invalid_rejected then
    raise exception 'OPA lifecycle FAILED: withdrawn status without time was accepted.';
  end if;

  raise notice 'OPA lifecycle PASSED: withdrawal, immutable first history, and source reactivation are coherent.';
end
$contract$;

rollback;
