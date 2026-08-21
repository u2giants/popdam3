-- Issue #963: the decision survives a later source capture and identical repeats are no-ops.
do $$
declare
  v_licensor uuid;
  v_property uuid;
  v_capture uuid;
  v_first plm.source_resolution;
  v_repeat plm.source_resolution;
  v_changed plm.source_resolution;
begin
  insert into core.licensor (name, code)
  values ('ZZTEST Source Resolution', 'ZZSR-' || substr(gen_random_uuid()::text,1,8))
  returning id into v_licensor;
  insert into core.property (licensor_id, name, code)
  values (v_licensor, 'ZZTEST Durable Property', 'ZZDP-' || substr(gen_random_uuid()::text,1,8))
  returning id into v_property;

  v_first := plm.set_source_resolution(
    'nbcu', 'property', 'source-id:zztest-durable', 'matched', v_property,
    null, null, null, 'ZZTEST approved', null
  );
  v_repeat := plm.set_source_resolution(
    'nbcu', 'property', 'source-id:zztest-durable', 'matched', v_property,
    null, null, null, 'ZZTEST approved', null
  );
  if v_repeat.updated_at is distinct from v_first.updated_at then
    raise exception 'identical decision changed updated_at';
  end if;

  insert into plm.nbcu_capture (
    capture_key, source_repository, source_commit_sha, source_manifest_sha256,
    portal_base_url, source_captured_at, expected_counts, raw_summary, created_by
  ) values (
    'zztest-durable-' || gen_random_uuid(), 'zztest/repository', repeat('c',40), repeat('d',64),
    'https://example.invalid', now(), '{}'::jsonb, '{}'::jsonb, 'zztest'
  ) returning id into v_capture;
  insert into plm.nbcu_property (
    capture_id, property_key, property_source_id, property_label, source_kind,
    source_url, source_captured_at, raw
  ) values (
    v_capture, 'source-id:zztest-durable', 'zztest-durable', 'ZZTEST DURABLE', 'property',
    'https://example.invalid/property', now(), '{}'::jsonb
  );

  select core_property_id, resolution_status
  into v_changed.core_property_id, v_changed.resolution_status
  from api.source_resolution
  where source_system = 'nbcu' and entity_kind = 'property'
    and source_id = 'source-id:zztest-durable';
  if v_changed.core_property_id is distinct from v_property
     or v_changed.resolution_status <> 'matched' then
    raise exception 'new capture bypassed the durable decision';
  end if;

  if not exists (
    select 1 from plm.nbcu_property p
    join api.source_resolution r
      on r.source_system = 'nbcu' and r.entity_kind = 'property'
     and r.source_id = p.property_key
    where p.capture_id = v_capture and r.resolution_status = 'matched'
  ) then
    raise exception 'current source read path did not return the durable decision';
  end if;

  begin
    perform plm.set_source_resolution(
      'nbcu', 'property', 'source-id:zztest-durable', 'no_match',
      null, null, null, null, 'ZZTEST changed', null
    );
    raise exception 'conflicting decision without current token was accepted';
  exception when serialization_failure then null;
  end;

  perform plm.set_source_resolution(
    'nbcu', 'property', 'source-id:zztest-durable', 'no_match',
    null, null, null, null, 'ZZTEST changed', v_first.updated_at
  );

  delete from plm.nbcu_property where capture_id = v_capture;
  delete from plm.nbcu_capture where id = v_capture;
  delete from plm.source_resolution
    where source_system = 'nbcu' and entity_kind = 'property'
      and source_id = 'source-id:zztest-durable';
  -- The canonical Property and Licensor rows are NOT deleted here any more (#1339). Migration
  -- 20260820183334 extended the licensing write guard to cover DELETE on
  -- BOTH core.licensor and core.property, and the only two deletes it will ever
  -- authorize are the erasure of FR "FRIENDS TV" and of the FRIDA KAHLO
  -- property spuriously parented to it. There is deliberately no authorization
  -- shape that lets a test remove an arbitrary Licensor or Property, so these
  -- cleanup lines cannot be "fixed" by issuing one -- that would be a hole, not
  -- a repair.
  --
  -- Nothing leaks: the contract-test runner wraps every file in its own
  -- `begin; ... rollback;`, so the ZZTEST fixture rows above never outlive the
  -- transaction whether or not these lines exist.
end;
$$;
