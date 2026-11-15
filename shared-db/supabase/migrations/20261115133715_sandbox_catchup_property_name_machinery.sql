-- #6356 sandbox catch-up batch 2: DesignFlow sandbox (xupnyeifmpsacrqahwwm) ONLY. Never apply to shared preview or production.
-- Ports the property submission-name machinery of 20261113183820 (functions and triggers) that
-- 20261113233345 could not carry because the TrackerPlus tables were missing (added by batch 1).
-- Columns and api.property_names already exist from 20261113233345; the one-off data backfill is not ported.
-- derived-from: none

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION core.submission_property_label(p_source text, p_id text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
  select case p_source
    when 'disney_opa' then
      (select o.property_name from plm.opa_property o
        where p_id ~ '^-?[0-9]{1,18}$' and o.licensed_property_id = p_id::bigint)
    when 'paramount_trackerplus' then
      (select s.exact_label from plm.pmt_trackerplus_submission_property s
        where s.property_local_key = p_id order by s.exact_label limit 1)
  end
$function$;
revoke all on function core.submission_property_label(p_source text, p_id text) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION core.property_submission_name_fill()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare v_sc jsonb := new.metadata->'submission_canonical';
begin
  -- A late writer of the retired metadata key (e.g. a repaired older migration) is moved into
  -- the columns; any shape that cannot be moved is left for property_no_submission_canonical_ck.
  if v_sc is not null and jsonb_typeof(v_sc) = 'object' then
    if v_sc->>'source_system' = 'disney_opa' and v_sc ? 'licensed_property_id' then
      new.submission_source := 'disney_opa';
      new.submission_property_id := v_sc->>'licensed_property_id';
      new.metadata := new.metadata - 'submission_canonical';
    elsif coalesce(v_sc->>'source_system', 'paramount_trackerplus') = 'paramount_trackerplus'
          and v_sc ? 'property_local_key' then
      new.submission_source := 'paramount_trackerplus';
      new.submission_property_id := v_sc->>'property_local_key';
      new.metadata := new.metadata - 'submission_canonical';
    end if;
  end if;
  new.submission_property_name := core.submission_property_label(new.submission_source, new.submission_property_id);
  return new;
end
$function$;
revoke all on function core.property_submission_name_fill() from public, anon, authenticated;

CREATE OR REPLACE FUNCTION core.refresh_property_submission_name()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare v_n integer;
begin
  update core.property p
     set submission_property_name = core.submission_property_label(p.submission_source, p.submission_property_id)
   where p.submission_source is not null
     and p.submission_property_name is distinct from
         core.submission_property_label(p.submission_source, p.submission_property_id);
  get diagnostics v_n = row_count;
  return v_n;
end
$function$;
revoke all on function core.refresh_property_submission_name() from public, anon, authenticated;

CREATE OR REPLACE FUNCTION core.refresh_property_submission_name_trg()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
begin
  perform core.refresh_property_submission_name();
  return null;
end
$function$;
revoke all on function core.refresh_property_submission_name_trg() from public, anon, authenticated;

drop trigger if exists property_submission_name_fill on core.property;
CREATE TRIGGER property_submission_name_fill BEFORE INSERT OR UPDATE OF submission_source, submission_property_id, submission_property_name, metadata ON core.property FOR EACH ROW EXECUTE FUNCTION core.property_submission_name_fill();
drop trigger if exists opa_property_refresh_submission_name on plm.opa_property;
CREATE TRIGGER opa_property_refresh_submission_name AFTER INSERT OR DELETE OR UPDATE ON plm.opa_property FOR EACH STATEMENT EXECUTE FUNCTION core.refresh_property_submission_name_trg();
drop trigger if exists trackerplus_property_refresh_submission_name on plm.pmt_trackerplus_submission_property;
CREATE TRIGGER trackerplus_property_refresh_submission_name AFTER INSERT OR DELETE OR UPDATE ON plm.pmt_trackerplus_submission_property FOR EACH STATEMENT EXECUTE FUNCTION core.refresh_property_submission_name_trg();

comment on view api.property_names is
  'Each property''s four names (Coldlion name, licensor-submission name, nickname, short name) with display_name = nickname else name and description_name = short name else nickname else name (shared-db#6269).';

-- Deliberately not ported here: check constraint property_no_submission_canonical_ck (a guarded ALTER TABLE needs a verification sidecar); tracked on #6356.
