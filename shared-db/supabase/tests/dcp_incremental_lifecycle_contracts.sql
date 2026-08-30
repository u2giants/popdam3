-- Synthetic structural contracts for issue #1880. No licensed values are used or emitted.
begin;

do $$
declare
  v_complete uuid := gen_random_uuid();
  v_partial uuid := gen_random_uuid();
  v_failed uuid := gen_random_uuid();
  v_incremental uuid := gen_random_uuid();
  v_unreferenced uuid := gen_random_uuid();
  v_guide uuid := gen_random_uuid();
  v_asset uuid := gen_random_uuid();
  v_first_seen uuid;
  v_first_withdrawal timestamptz := timestamptz '2026-08-30 12:00:00+00';
  v_ok boolean;
begin
  insert into plm.dcp_crawl (
    crawl_id, status, captured_on, portal_base_url, crawler_version, account_scope,
    line_of_business, started_at, finished_at, rows_received,
    distinct_assets_received, captured_by, private_source_commit
  ) values (
    v_complete, 'complete', date '2026-08-30', 'https://example.invalid', 'ZZTEST',
    'ZZTEST synthetic', 'ZZTEST', now(), now(), 0, 0, 'ZZTEST', 'ZZTEST'
  );

  insert into plm.dcp_crawl (
    crawl_id, status, captured_on, portal_base_url, crawler_version, account_scope,
    line_of_business, started_at, finished_at, rows_received,
    distinct_assets_received, captured_by, private_source_commit
  ) values (
    v_unreferenced, 'running', date '2026-08-30', 'https://example.invalid', 'ZZTEST',
    'ZZTEST synthetic', 'ZZTEST', now(), now(), 0, 0, 'ZZTEST', 'ZZTEST'
  );

  v_ok := false;
  begin
    insert into plm.dcp_crawl (
      status, run_kind, baseline_crawl_id, captured_on, portal_base_url,
      crawler_version, account_scope, line_of_business, started_at, captured_by,
      private_source_commit
    ) values (
      'planned', 'full', v_complete, date '2026-08-30',
      'https://example.invalid', 'ZZTEST', 'ZZTEST synthetic', 'ZZTEST', now(),
      'ZZTEST', 'ZZTEST'
    );
  exception when sqlstate 'P0001' or check_violation then v_ok := true;
  end;
  if not v_ok then
    raise exception 'DCP lifecycle FAILED: a full crawl accepted a baseline.';
  end if;

  v_ok := false;
  begin
    insert into plm.dcp_crawl (
      status, run_kind, baseline_crawl_id, captured_on, portal_base_url,
      crawler_version, account_scope, line_of_business, started_at, captured_by,
      private_source_commit
    ) values (
      'planned', 'incremental', null, date '2026-08-30',
      'https://example.invalid', 'ZZTEST', 'ZZTEST synthetic', 'ZZTEST', now(),
      'ZZTEST', 'ZZTEST'
    );
  exception when sqlstate 'P0001' or check_violation then v_ok := true;
  end;
  if not v_ok then
    raise exception 'DCP lifecycle FAILED: an incremental crawl accepted no baseline.';
  end if;

  v_ok := false;
  begin
    insert into plm.dcp_crawl (
      crawl_id, status, run_kind, baseline_crawl_id, captured_on, portal_base_url,
      crawler_version, account_scope, line_of_business, started_at, captured_by,
      private_source_commit
    ) values (
      gen_random_uuid(), 'planned', 'incremental', gen_random_uuid(), date '2026-08-30',
      'https://example.invalid', 'ZZTEST', 'ZZTEST synthetic', 'ZZTEST', now(),
      'ZZTEST', 'ZZTEST'
    );
  exception when foreign_key_violation or sqlstate 'P0001' then v_ok := true;
  end;
  if not v_ok then
    raise exception 'DCP lifecycle FAILED: an incremental crawl accepted a missing baseline.';
  end if;

  v_ok := false;
  begin
    insert into plm.dcp_crawl (
      crawl_id, status, run_kind, baseline_crawl_id, captured_on, portal_base_url,
      crawler_version, account_scope, line_of_business, started_at, captured_by,
      private_source_commit
    ) values (
      v_incremental, 'planned', 'incremental', v_incremental, date '2026-08-30',
      'https://example.invalid', 'ZZTEST', 'ZZTEST synthetic', 'ZZTEST', now(),
      'ZZTEST', 'ZZTEST'
    );
  exception when sqlstate 'P0001' or foreign_key_violation then v_ok := true;
  end;
  if not v_ok then
    raise exception 'DCP lifecycle FAILED: a crawl accepted itself as baseline.';
  end if;

  insert into plm.dcp_crawl (
    crawl_id, status, captured_on, portal_base_url, crawler_version, account_scope,
    line_of_business, started_at, finished_at, captured_by, private_source_commit,
    failure_message
  ) values
    (v_partial, 'partial', date '2026-08-30', 'https://example.invalid', 'ZZTEST',
     'ZZTEST synthetic', 'ZZTEST', now(), null, 'ZZTEST', 'ZZTEST', null),
    (v_failed, 'failed', date '2026-08-30', 'https://example.invalid', 'ZZTEST',
     'ZZTEST synthetic', 'ZZTEST', now(), now(), 'ZZTEST', 'ZZTEST', 'ZZTEST failure');

  v_ok := false;
  begin
    insert into plm.dcp_crawl (
      status, run_kind, baseline_crawl_id, captured_on, portal_base_url,
      crawler_version, account_scope, line_of_business, started_at, captured_by,
      private_source_commit
    ) values (
      'planned', 'incremental', v_partial, date '2026-08-30',
      'https://example.invalid', 'ZZTEST', 'ZZTEST synthetic', 'ZZTEST', now(),
      'ZZTEST', 'ZZTEST'
    );
  exception when sqlstate 'P0001' then v_ok := true;
  end;
  if not v_ok then
    raise exception 'DCP lifecycle FAILED: a partial crawl was accepted as a baseline.';
  end if;

  v_ok := false;
  begin
    insert into plm.dcp_crawl (
      status, run_kind, baseline_crawl_id, captured_on, portal_base_url,
      crawler_version, account_scope, line_of_business, started_at, captured_by,
      private_source_commit
    ) values (
      'planned', 'incremental', v_failed, date '2026-08-30',
      'https://example.invalid', 'ZZTEST', 'ZZTEST synthetic', 'ZZTEST', now(),
      'ZZTEST', 'ZZTEST'
    );
  exception when sqlstate 'P0001' then v_ok := true;
  end;
  if not v_ok then
    raise exception 'DCP lifecycle FAILED: a failed crawl was accepted as a baseline.';
  end if;

  insert into plm.dcp_crawl (
    crawl_id, status, run_kind, baseline_crawl_id, captured_on, portal_base_url,
    crawler_version, account_scope, line_of_business, started_at, captured_by,
    private_source_commit
  ) values (
    v_incremental, 'planned', 'incremental', v_complete, date '2026-08-30',
    'https://example.invalid', 'ZZTEST', 'ZZTEST synthetic', 'ZZTEST', now(),
    'ZZTEST', 'ZZTEST'
  );

  v_ok := false;
  begin
    update plm.dcp_crawl
    set status = 'partial'
    where crawl_id = v_complete;
  exception when sqlstate 'P0001' then v_ok := true;
  end;
  if not v_ok then
    raise exception 'DCP lifecycle FAILED: a referenced complete baseline was downgraded.';
  end if;

  update plm.dcp_crawl
  set status = 'partial'
  where crawl_id = v_unreferenced;
  if (select status from plm.dcp_crawl where crawl_id = v_unreferenced) <> 'partial' then
    raise exception 'DCP lifecycle FAILED: an unreferenced crawl could not change status.';
  end if;

  insert into plm.dcp_style_guide (
    id, source_path, folder_name, region, year_segment,
    first_seen_crawl_id, last_seen_crawl_id
  ) values (
    v_guide, '/ZZTEST/guide', 'ZZTEST guide', 'ZZTEST', 'ZZTEST',
    v_complete, v_complete
  );

  insert into plm.dcp_asset (
    id, source_path, style_guide_id, file_name,
    first_seen_crawl_id, last_seen_crawl_id
  ) values (
    v_asset, '/ZZTEST/asset', v_guide, 'zztest.asset', v_complete, v_complete
  );

  update plm.dcp_style_guide
  set lifecycle_status = 'withdrawn', first_withdrawn_at = v_first_withdrawal,
      withdrawn_at = v_first_withdrawal
  where id = v_guide;
  update plm.dcp_asset
  set lifecycle_status = 'withdrawn', first_withdrawn_at = v_first_withdrawal,
      withdrawn_at = v_first_withdrawal
  where id = v_asset;

  update plm.dcp_style_guide
  set lifecycle_status = 'active', withdrawn_at = null,
      last_seen_crawl_id = v_incremental
  where id = v_guide;
  update plm.dcp_asset
  set lifecycle_status = 'active', withdrawn_at = null,
      last_seen_crawl_id = v_incremental
  where id = v_asset;

  select first_seen_crawl_id into v_first_seen from plm.dcp_asset where id = v_asset;
  if v_first_seen <> v_complete then
    raise exception 'DCP lifecycle FAILED: asset reappearance changed first-seen history.';
  end if;
  if (select first_withdrawn_at from plm.dcp_asset where id = v_asset) <> v_first_withdrawal
     or (select lifecycle_status from plm.dcp_asset where id = v_asset) <> 'active'
     or (select withdrawn_at from plm.dcp_asset where id = v_asset) is not null then
    raise exception 'DCP lifecycle FAILED: asset reactivation lost first withdrawal or remained withdrawn.';
  end if;
  if (select first_withdrawn_at from plm.dcp_style_guide where id = v_guide) <> v_first_withdrawal
     or (select lifecycle_status from plm.dcp_style_guide where id = v_guide) <> 'active'
     or (select withdrawn_at from plm.dcp_style_guide where id = v_guide) is not null then
    raise exception 'DCP lifecycle FAILED: style-guide reactivation is inconsistent.';
  end if;

  v_ok := false;
  begin
    update plm.dcp_asset
    set first_withdrawn_at = v_first_withdrawal + interval '1 day'
    where id = v_asset;
  exception when sqlstate 'P0001' then v_ok := true;
  end;
  if not v_ok then
    raise exception 'DCP lifecycle FAILED: first withdrawal history was replaceable.';
  end if;

  v_ok := false;
  begin
    update plm.dcp_asset set lifecycle_status = 'withdrawn' where id = v_asset;
  exception when check_violation then v_ok := true;
  end;
  if not v_ok then
    raise exception 'DCP lifecycle FAILED: withdrawn status without a withdrawal time was accepted.';
  end if;

  raise notice 'DCP lifecycle PASSED: complete baseline required; partial/failed refused; withdrawal and reappearance are coherent.';
end;
$$;

rollback;
