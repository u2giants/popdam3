-- Issue #963: landing snapshots cannot carry or change curated decisions.
do $$
declare
  v_capture uuid;
begin
  insert into plm.nbcu_capture (
    capture_key, source_repository, source_commit_sha, source_manifest_sha256,
    portal_base_url, source_captured_at, expected_counts, raw_summary, created_by
  ) values (
    'zztest-guard-' || gen_random_uuid(), 'zztest/repository', repeat('a',40), repeat('b',64),
    'https://example.invalid', now(), '{}'::jsonb, '{}'::jsonb, 'zztest'
  ) returning id into v_capture;

  insert into plm.nbcu_property (
    capture_id, property_key, property_source_id, property_label, source_kind,
    source_url, source_captured_at, raw
  ) values (
    v_capture, 'source-id:zztest-guard', 'zztest-guard', 'ZZTEST GUARD', 'property',
    'https://example.invalid/property', now(), '{}'::jsonb
  );

  begin
    update plm.nbcu_property set resolution_status = 'no_match'
    where capture_id = v_capture and property_key = 'source-id:zztest-guard';
    raise exception 'legacy resolution update was accepted';
  exception when check_violation then
    if sqlerrm not like '%plm.set_source_resolution()%' then raise; end if;
  end;

  begin
    insert into plm.nbcu_property (
      capture_id, property_key, property_source_id, property_label, source_kind,
      source_url, source_captured_at, raw, resolution_status
    ) values (
      v_capture, 'source-id:zztest-bad', 'zztest-bad', 'ZZTEST BAD', 'property',
      'https://example.invalid/property', now(), '{}'::jsonb, 'no_match'
    );
    raise exception 'resolved landing insert was accepted';
  exception when check_violation then null;
  end;

  delete from plm.nbcu_property where capture_id = v_capture;
  delete from plm.nbcu_capture where id = v_capture;
end;
$$;
