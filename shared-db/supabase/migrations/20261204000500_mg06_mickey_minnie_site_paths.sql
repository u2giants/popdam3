-- MG06 Mickey/Minnie scheme, owner ruling 6.43 (2026-11-16; docs/owner-rulings-part-4.md).
--   MM  = Mickey alone  -> OPA 373 "Mickey Mouse Family" > character 558 "Mickey Mouse"
--   ME  = Minnie alone  -> OPA 376 "Minnie" > character 551 "Minnie & Me"   (new ColdLion code)
--   MMF = Mickey Group  -> OPA 361 "Standard Characters" > character 563
-- Before this, MM carried the Mickey Group nickname and Standard Characters paths and MMF carried
-- Mickey Mouse 373/558 (pre-ruling scheme). ME was created in ColdLion MG06 (CW001, SP001) on
-- 2026-11-17 but the daily ColdLion -> core.property sync skipped it (skipped_no_licensor): a brand-new
-- code has no existing core.property row and no DesignFlow merchGroup parent to learn its licensor from.
-- This curated step creates it under the same licensor as MM/MMF (Disney); the daily sync then keeps
-- its name and status by code.
-- Idempotent. Site vocabulary names are read from the plm.opa_* scrape at apply time.
do $mg06_mickey_minnie$
declare
  v_lic uuid; v_me uuid; v_mm uuid; v_mmf uuid; v_actor constant text := 'migration 20261204000500 (ruling 6.43)';
  v_bad integer;
begin
  select id, licensor_id into v_mm, v_lic from core.property where code = 'MM' and licensor_id = (select licensor_id from core.property where code = 'MMF' limit 1);
  select id into v_mmf from core.property where code = 'MMF' and licensor_id = v_lic;
  if v_mm is null or v_mmf is null then
    raise notice '6.43: MM/MMF rows not present here; nothing to do';
    return;
  end if;

  -- 1. ME property row (same licensor as MM).
  select id into v_me from core.property where code = 'ME' and licensor_id = v_lic;
  if v_me is null then
    insert into plm.licensing_write_authorization(backend_pid,transaction_id,target_table,write_kind,plan_id,plan_hash,actor,protected_columns,expires_at)
    values (pg_backend_pid(), txid_current(), 'core.property', 'licensing_review_create', gen_random_uuid(),
      encode(extensions.digest('6.43/create/ME','sha256'),'hex'), v_actor,
      array['licensor_id','name','code','status'], clock_timestamp() + interval '1 minute');
    insert into core.property(licensor_id, name, code, status, metadata)
    values (v_lic, 'Minnie & Me', 'ME', 'potential',
      jsonb_build_object('curated', true, 'owner_ruling', '6.43', 'migration', '20261204000500'))
    returning id into v_me;
    insert into plm.licensing_write_authorization(backend_pid,transaction_id,target_table,write_kind,plan_id,plan_hash,actor,protected_columns,expires_at)
    values (pg_backend_pid(), txid_current(), 'core.property', 'coldlion_status', gen_random_uuid(),
      encode(extensions.digest('6.43/status/ME','sha256'),'hex'), v_actor, array['status'], clock_timestamp() + interval '1 minute');
    update core.property set status = 'active' where id = v_me;
  end if;

  -- 2. Submission property and nickname per the ruling (unprotected columns).
  update core.property set nickname = null, submission_source = 'disney_opa', submission_property_id = '373'
   where id = v_mm;
  update core.property set nickname = 'Mickey Group', submission_source = 'disney_opa', submission_property_id = '361',
         metadata = case when metadata ? 'curated_source'
                         then jsonb_set(metadata, '{curated_source,licensed_property_id}', '"361"') else metadata end
   where id = v_mmf;
  update core.property set submission_source = 'disney_opa', submission_property_id = '376'
   where id = v_me;

  -- 3. Site paths: retire every current Disney path for the three codes, then set exactly one each.
  update core.property_site_path set is_current = false
   where property_id in (v_mm, v_mmf, v_me) and licensor_site = 'disney_opa' and is_current;

  insert into core.property_site_path
    (property_id, licensor_site, site_property_name, site_property_id, site_character_name, site_character_id, source_evidence, is_current)
  select t.pid, 'disney_opa', o.property_name, t.pk, c.character_name, t.ck,
         'owner ruling 6.43 (2026-11-16) MG06 ' || t.code || '; plm scrape id ' || t.pk || ' / character ' || t.ck, true
  from (values (v_mm, 'MM', '373', '558'), (v_me, 'ME', '376', '551'), (v_mmf, 'MMF', '361', '563')) t(pid, code, pk, ck)
  join plm.opa_property o on o.licensed_property_id::text = t.pk
  join plm.opa_property_character c on c.licensed_property_id::text = t.pk and c.character_id::text = t.ck
  on conflict (property_id, licensor_site, site_property_name, coalesce(site_character_name, ''))
  do update set is_current = true, site_property_id = excluded.site_property_id,
                site_character_id = excluded.site_character_id, source_evidence = excluded.source_evidence;

  select count(*) into v_bad from (
    select property_id from core.property_site_path
     where property_id in (v_mm, v_mmf, v_me) and licensor_site = 'disney_opa' and is_current
     group by property_id having count(*) <> 1) x;
  if v_bad > 0 then
    raise exception '6.43: % of MM/ME/MMF do not have exactly one current path', v_bad;
  end if;
  raise notice '6.43: MM/ME/MMF site paths set (scrape rows permitting)';
end
$mg06_mickey_minnie$;
