-- derived-from: 20261115073715
-- Review finding popcre/shared-db#6322 on #6320 (issue #6194 skipped-licensor alert).
--
-- 1. A malformed `active` value in a skipped entry made `(s->>'active')::boolean` throw, and the
--    AFTER INSERT trigger had no guard, so a bad entry could abort the whole property sync. Parsing
--    is now a plain jsonb comparison that never throws, and the trigger catches any error and
--    raises a WARNING instead: the alert can never break the sync it reports on.
-- 2. Each run's skipped list is the complete current state, so the newest open alert carries every
--    code still skipped; an older open set never hides a code. Delivery (the reporter) files the
--    newest set. Older rows stay open until acknowledged through plm.acknowledge_taxonomy_sync_alert,
--    the only audited acknowledgement path; this migration never writes acknowledged_at.
-- Never guesses a licensor; never creates an MG06 value.

create or replace function plm.alert_coldlion_property_skips(p_run_id bigint)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, plm
as $fn$
declare
  v_run plm.coldlion_property_sync_run;
  v_codes jsonb;
  v_id uuid;
begin
  select * into v_run from plm.coldlion_property_sync_run where id = p_run_id;
  if v_run.id is null then
    return null;
  end if;

  select coalesce(jsonb_agg(code order by code), '[]'::jsonb)
    into v_codes
    from (select distinct s->>'code' as code
            from jsonb_array_elements(case when jsonb_typeof(v_run.skipped) = 'array'
                                           then v_run.skipped else '[]'::jsonb end) s
           where jsonb_typeof(s) = 'object'
             and s->'active' in ('true'::jsonb, '"true"'::jsonb, '"Y"'::jsonb)
             and nullif(s->>'code', '') is not null) d;

  if jsonb_array_length(v_codes) = 0 then
    return null;
  end if;

  if exists (select 1 from plm.taxonomy_sync_alert a
              where a.source_name = 'coldlion_core_property_sync'
                and a.acknowledged_at is null
                and a.payload->'codes' = v_codes) then
    return null;
  end if;

  insert into plm.taxonomy_sync_alert(severity, source_name, reason, payload)
  values ('warning', 'coldlion_core_property_sync',
          'unresolved_licensor: ' || jsonb_array_length(v_codes)
            || ' active ColdLion MG06 value(s) skipped because no licensor owns the code and the app list gives no MG05 parent: '
            || (select string_agg(c, ', ' order by c) from jsonb_array_elements_text(v_codes) c),
          jsonb_build_object('codes', v_codes, 'reason', 'unresolved_licensor',
                             'sync_run_id', v_run.id, 'applied', v_run.applied,
                             'human_response_owner', 'Albert Hazan',
                             'first_response', 'Match each code to its licensor in ColdLion (MG05 parent) or core.property; never guess.'))
  returning id into v_id;
  return v_id;
end;
$fn$;

comment on function plm.alert_coldlion_property_skips(bigint) is
  '#6194/#6322: one deduplicated warning in plm.taxonomy_sync_alert per new set of active MG06 codes the property sync skipped for want of a licensor. Never throws on malformed entries. Returns the new alert id, or null when nothing new.';
revoke all on function plm.alert_coldlion_property_skips(bigint) from public, anon, authenticated;

create or replace function plm.coldlion_property_sync_run_alert()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, plm
as $fn$
begin
  begin
    perform plm.alert_coldlion_property_skips(new.id);
  exception when others then
    raise warning 'coldlion property skip alert failed for run %: %', new.id, sqlerrm;
  end;
  return null;
end;
$fn$;
revoke all on function plm.coldlion_property_sync_run_alert() from public, anon, authenticated;
