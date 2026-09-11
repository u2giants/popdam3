-- Rolled-back structural contracts for issue #2173: the ColdLion stage/page completion
-- ledger. Everything here is synthetic; no customer identifiers and no licensed data.
--
-- WHAT THIS PROVES, and why each one is here rather than assumed:
--   1. A window is stage- and division-scoped, under NULLS NOT DISTINCT, so replaying an
--      unscoped pull cannot duplicate a window or a page.
--   2. /prodHistory cannot be recorded without a stage (a stage-less request silently
--      returned only ISS rows for a window that also held INTRAN rows).
--   3. A window CANNOT reach state=loaded on one page when the vendor said there were
--      two - the forced 201st row case that objection U6 is about.
--   4. Pages must be contiguous from 0, all loaded, exactly one flagged last, and must
--      sum to both the window row count and the vendor's reported total.
begin;

do $$
begin
  if to_regclass('coldlion.history_page_ledger') is null then
    raise exception 'missing coldlion.history_page_ledger';
  end if;

  -- Identity, exactly as the plan and issue specify it.
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'coldlion.history_page_ledger'::regclass and contype = 'u'
      and pg_get_constraintdef(oid) like '%NULLS NOT DISTINCT%'
      and pg_get_constraintdef(oid) like '%endpoint%company_code%division_code%stage_code%window_from%page_number%'
  ) then
    raise exception 'history_page_ledger identity is not the NULLS NOT DISTINCT stage/division/page key';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'coldlion.window_ledger'::regclass and contype = 'u'
      and pg_get_constraintdef(oid) like '%NULLS NOT DISTINCT%'
      and pg_get_constraintdef(oid) like '%endpoint%company_code%division_code%stage_code%window_from%'
  ) then
    raise exception 'window_ledger identity was not repaired to carry stage and division scope';
  end if;

  -- The three columns whose absence made a stage-scoped multi-page window inexpressible.
  if (select count(*) from information_schema.columns
      where table_schema = 'coldlion' and table_name = 'window_ledger'
        and column_name in ('stage_code','division_code','last_page_number')) <> 3 then
    raise exception 'window_ledger still cannot express a stage-scoped, multi-page window';
  end if;

  -- The requested/returned page-size pair IS the evidence of the silent 200-row cap.
  if (select count(*) from information_schema.columns
      where table_schema = 'coldlion' and table_name = 'history_page_ledger'
        and column_name in ('requested_page_size','returned_page_size')) <> 2 then
    raise exception 'the silent page-size substitution is not recorded as evidence';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'coldlion.window_ledger'::regclass
      and tgname = 'window_ledger_completion_guard' and not tgisinternal
  ) then
    raise exception 'no completion guard: a window could be loaded without page evidence';
  end if;

  -- Landing posture: this table is never readable by an application role.
  if not (select relrowsecurity from pg_class where oid = 'coldlion.history_page_ledger'::regclass) then
    raise exception 'history_page_ledger has no row security';
  end if;
  if exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'coldlion' and table_name = 'history_page_ledger'
      and grantee in ('anon','authenticated','PUBLIC')
  ) then
    raise exception 'an application role can reach the landing page ledger';
  end if;
end $$;

do $$
declare
  v_run uuid;
  v_window uuid;
  v_unscoped uuid;
  v_source_window uuid;
begin
  insert into coldlion.sync_run(endpoint, company_code, requested_by, started_at)
  values ('/orderHistory', 'TESTCO', 'contract-test', now())
  returning id into v_run;

  -- /prodHistory without a stage is the silent-omission shape. It must be refused.
  begin
    insert into coldlion.window_ledger(endpoint, company_code, window_from, window_to)
    values ('/prodHistory', 'TESTCO', date '2026-06-02', date '2026-06-08');
    raise exception 'a stage-less production-history window was accepted';
  exception when check_violation then null;
  end;

  -- /orderHistory has no stage dimension; inventing one must be refused.
  begin
    insert into coldlion.window_ledger(endpoint, company_code, stage_code, window_from, window_to)
    values ('/orderHistory', 'TESTCO', 'ISS', date '2026-06-02', date '2026-06-08');
    raise exception 'a stage was invented for sales history';
  exception when check_violation then null;
  end;

  insert into coldlion.window_ledger(endpoint, company_code, window_from, window_to)
  values ('/orderHistory', 'TESTCO', date '2026-06-02', date '2026-06-08')
  returning id into v_unscoped;

  -- NULLS NOT DISTINCT: the unscoped replay is the SAME window, not a second one.
  begin
    insert into coldlion.window_ledger(endpoint, company_code, window_from, window_to)
    values ('/orderHistory', 'TESTCO', date '2026-06-02', date '2026-06-08');
    raise exception 'an unscoped window replay duplicated the window';
  exception when unique_violation then null;
  end;

  -- A division-scoped pull of the same dates is a DIFFERENT window, and must survive.
  insert into coldlion.window_ledger(endpoint, company_code, division_code, window_from, window_to)
  values ('/orderHistory', 'TESTCO', 'DIV1', date '2026-06-02', date '2026-06-08')
  returning id into v_window;

  if v_window = v_unscoped then
    raise exception 'division scope collapsed into the unscoped window';
  end if;

  -- Stage scope separates production windows the same way.
  insert into coldlion.window_ledger(endpoint, company_code, stage_code, window_from, window_to)
  values ('/prodHistory', 'TESTCO', 'ISS',    date '2026-06-02', date '2026-06-08'),
         ('/prodHistory', 'TESTCO', 'INTRAN', date '2026-06-02', date '2026-06-08');
  if (select count(*) from coldlion.window_ledger
      where endpoint = '/prodHistory' and company_code = 'TESTCO'
        and window_from = date '2026-06-02') <> 2 then
    raise exception 'stage scope collapsed two production windows into one';
  end if;

  -- A page must describe the window it points at.
  begin
    insert into coldlion.history_page_ledger(
      window_id, endpoint, company_code, division_code, window_from, page_number,
      requested_page_size, returned_page_size, page_row_count, is_last_page,
      reported_total_elements, reported_total_pages, state, run_id, loaded_at)
    values (v_unscoped, '/orderHistory', 'TESTCO', 'DIV1', date '2026-06-02', 0,
            2000, 200, 200, false, 201, 2, 'loaded', v_run, now());
    raise exception 'a page was recorded against a window of a different scope';
  exception when raise_exception then
    if sqlerrm like 'a page was recorded%' then raise; end if;
  end;

  -- THE FORCED 201st ROW. The vendor was asked for size=2000 and answered size=200 with
  -- totalElements=201 over two pages. Page 0 alone must not complete the window.
  insert into coldlion.history_page_ledger(
    window_id, endpoint, company_code, division_code, window_from, page_number,
    requested_page_size, returned_page_size, page_row_count, is_last_page,
    reported_total_elements, reported_total_pages, state, run_id, loaded_at)
  values (v_window, '/orderHistory', 'TESTCO', 'DIV1', date '2026-06-02', 0,
          2000, 200, 200, false, 201, 2, 'loaded', v_run, now());

  begin
    update coldlion.window_ledger
       set state = 'loaded', row_count = 200, last_page_number = 1,
           reported_total_elements = 201, loaded_at = now(), last_run_id = v_run
     where id = v_window;
    raise exception 'a window completed on page 0 while page 1 was never fetched';
  exception when raise_exception then
    if sqlerrm like 'a window completed%' then raise; end if;
  end;

  -- Claiming page 0 was the last page does not help: the vendor said otherwise, and the
  -- summed rows still do not reach the reported total.
  begin
    update coldlion.window_ledger
       set state = 'loaded', row_count = 200, last_page_number = 0,
           reported_total_elements = 201, loaded_at = now(), last_run_id = v_run
     where id = v_window;
    raise exception 'a window completed with rows short of the vendor total';
  exception when raise_exception then
    if sqlerrm like 'a window completed%' then raise; end if;
  end;

  -- A gap must be refused even when the count looks right: pages 0 and 2, no page 1.
  insert into coldlion.history_page_ledger(
    window_id, endpoint, company_code, division_code, window_from, page_number,
    requested_page_size, returned_page_size, page_row_count, is_last_page,
    reported_total_elements, reported_total_pages, state, run_id, loaded_at)
  values (v_window, '/orderHistory', 'TESTCO', 'DIV1', date '2026-06-02', 2,
          2000, 200, 1, true, 201, 2, 'loaded', v_run, now());

  begin
    update coldlion.window_ledger
       set state = 'loaded', row_count = 201, last_page_number = 2,
           reported_total_elements = 201, loaded_at = now(), last_run_id = v_run
     where id = v_window;
    raise exception 'a window completed across a page gap';
  exception when raise_exception then
    if sqlerrm like 'a window completed%' then raise; end if;
  end;

  delete from coldlion.history_page_ledger
   where window_id = v_window and page_number = 2;

  -- An unfinished page cannot be counted as evidence either.
  insert into coldlion.history_page_ledger(
    window_id, endpoint, company_code, division_code, window_from, page_number,
    requested_page_size, returned_page_size, state)
  values (v_window, '/orderHistory', 'TESTCO', 'DIV1', date '2026-06-02', 1, 2000, 200, 'running');

  begin
    update coldlion.window_ledger
       set state = 'loaded', row_count = 201, last_page_number = 1,
           reported_total_elements = 201, loaded_at = now(), last_run_id = v_run
     where id = v_window;
    raise exception 'a window completed with a page still running';
  exception when raise_exception then
    if sqlerrm like 'a window completed%' then raise; end if;
  end;

  -- Page 1 replayed is the same page, not a second one.
  begin
    insert into coldlion.history_page_ledger(
      window_id, endpoint, company_code, division_code, window_from, page_number,
      requested_page_size, returned_page_size, state)
    values (v_window, '/orderHistory', 'TESTCO', 'DIV1', date '2026-06-02', 1, 2000, 200, 'running');
    raise exception 'a page replay duplicated the page';
  exception when unique_violation then null;
  end;

  update coldlion.history_page_ledger
     set page_row_count = 1, is_last_page = true, state = 'loaded',
         run_id = v_run, loaded_at = now()
   where window_id = v_window and page_number = 1;

  -- The vendor's totalElements is mandatory completion evidence, not optional
  -- metadata that a loader may omit while still declaring success.
  begin
    update coldlion.window_ledger
       set state = 'loaded', row_count = 201, last_page_number = 1,
           reported_total_elements = null, loaded_at = now(), last_run_id = v_run
     where id = v_window;
    raise exception 'a window completed without vendor totalElements';
  exception when raise_exception then
    if sqlerrm like 'a window completed%' then raise; end if;
  end;

  -- Now, and only now, the window is complete: pages 0..1, both loaded, one flagged
  -- last, 200 + 1 = 201 = the vendor's totalElements.
  update coldlion.window_ledger
     set state = 'loaded', row_count = 201, last_page_number = 1,
         reported_total_elements = 201, loaded_at = now(), last_run_id = v_run
   where id = v_window;

  if (select state from coldlion.window_ledger where id = v_window) <> 'loaded' then
    raise exception 'a fully evidenced window was refused';
  end if;

  -- A loaded parent's scope is sealed independently of its page rows.
  begin
    update coldlion.window_ledger
       set window_to = date '2026-06-09'
     where id = v_window;
    raise exception 'a loaded window scope was changed';
  exception when raise_exception then
    if sqlerrm not like 'window % scope cannot change after page evidence exists or the window is loaded' then
      raise;
    end if;
  when others then raise;
  end;

  -- Build a pending source page, then prove it cannot be re-parented into the
  -- loaded destination even when all copied scope columns are changed to match.
  insert into coldlion.window_ledger(
    endpoint, company_code, division_code, window_from, window_to)
  values ('/orderHistory', 'TESTCO', 'DIV1', date '2026-06-09', date '2026-06-15')
  returning id into v_source_window;

  insert into coldlion.history_page_ledger(
    window_id, endpoint, company_code, division_code, window_from, page_number,
    requested_page_size, returned_page_size, state)
  values (v_source_window, '/orderHistory', 'TESTCO', 'DIV1', date '2026-06-09',
          0, 2000, 200, 'running');

  begin
    update coldlion.history_page_ledger
       set window_id = v_window, window_from = date '2026-06-02'
     where window_id = v_source_window and page_number = 0;
    raise exception 'a page was re-parented into a loaded window';
  exception when raise_exception then
    if sqlerrm not like 'page evidence for window % cannot be added, changed or removed while that window is loaded' then
      raise;
    end if;
  when others then raise;
  end;

  -- Pending does not mean mutable once page evidence exists: changing the parent
  -- scope would immediately diverge from the copied scope on that page.
  begin
    update coldlion.window_ledger
       set window_to = date '2026-06-16'
     where id = v_source_window;
    raise exception 'a pending window with page evidence changed scope';
  exception when raise_exception then
    if sqlerrm not like 'window % scope cannot change after page evidence exists or the window is loaded' then
      raise;
    end if;
  when others then raise;
  end;

  -- Completion evidence is sealed in both directions. A late page would make the
  -- already-loaded parent false after its completion trigger had succeeded.
  begin
    insert into coldlion.history_page_ledger(
      window_id, endpoint, company_code, division_code, window_from, page_number,
      requested_page_size, returned_page_size, page_row_count, is_last_page,
      reported_total_elements, reported_total_pages, state, run_id, loaded_at)
    values (v_window, '/orderHistory', 'TESTCO', 'DIV1', date '2026-06-02', 2,
            2000, 200, 1, true, 202, 3, 'loaded', v_run, now());
    raise exception 'a late page was added after its window was loaded';
  exception when raise_exception then
    if sqlerrm not like 'page evidence for window % cannot be added, changed or removed while that window is loaded' then
      raise;
    end if;
  when others then raise;
  end;

  -- The evidence behind a loaded window is not erasable.
  begin
    delete from coldlion.history_page_ledger where window_id = v_window and page_number = 1;
    raise exception 'page evidence of a loaded window was deleted';
  exception when raise_exception then
    if sqlerrm like 'page evidence of a loaded%' then raise; end if;
  end;
end $$;

rollback;
