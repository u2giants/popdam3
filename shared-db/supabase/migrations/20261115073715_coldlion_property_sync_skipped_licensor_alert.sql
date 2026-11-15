-- Issue popcre/shared-db#6194 follow-up: the nightly plm.sync_core_property_from_coldlion skips
-- ColdLion MG06 values whose licensor it cannot resolve, and only records them in
-- plm.coldlion_property_sync_run.skipped. Nobody was told.
--
-- Owner words, Albert Hazan, 2026-11-13 4:14 PM EST (verbatim): "we can't guess, but nor should
-- we fail silently. this has to be fixed in the future."
--
-- This adds the alert only. It never guesses a licensor and never creates an MG06 value.
-- Every run row with one or more ACTIVE skipped values writes one warning into the existing alert
-- ledger plm.taxonomy_sync_alert (source 'coldlion_core_property_sync'), deduplicated: when an
-- unacknowledged alert from this source already names exactly the same codes, nothing is added.
-- Severity is 'warning' on purpose: a 'critical' alert would trip the ColdLion circuit breaker.
-- Delivery to people is the read-only leg of .github/workflows/coldlion-property-scrape-name-check.yml,
-- which opens one deduplicated GitHub issue naming the codes.

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

  select coalesce(jsonb_agg(s->>'code' order by s->>'code'), '[]'::jsonb)
    into v_codes
    from jsonb_array_elements(coalesce(v_run.skipped, '[]'::jsonb)) s
   where coalesce((s->>'active')::boolean, false);

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
  '#6194: one deduplicated warning in plm.taxonomy_sync_alert per new set of active MG06 codes the property sync skipped for want of a licensor. Returns the new alert id, or null when nothing new.';
revoke all on function plm.alert_coldlion_property_skips(bigint) from public, anon, authenticated;

create or replace function plm.coldlion_property_sync_run_alert()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, plm
as $fn$
begin
  perform plm.alert_coldlion_property_skips(new.id);
  return null;
end;
$fn$;
revoke all on function plm.coldlion_property_sync_run_alert() from public, anon, authenticated;

drop trigger if exists coldlion_property_sync_run_alert on plm.coldlion_property_sync_run;
create trigger coldlion_property_sync_run_alert
  after insert on plm.coldlion_property_sync_run
  for each row
  execute function plm.coldlion_property_sync_run_alert();

-- Raise the alert now for the latest recorded run, so values already skipped are not silent until
-- the next nightly run. No-op where no run exists (preview/CI).
select plm.alert_coldlion_property_skips((select max(id) from plm.coldlion_property_sync_run));
