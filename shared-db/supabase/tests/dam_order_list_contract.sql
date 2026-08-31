-- =====================================================================================
-- PopDAM OrderList — Step 1 contract tests (issue #613, object claim #624)
--
-- Covers migrations 20260810010000_popdam_order_list_contract.sql and
--   20260810060000_popdam_order_list_source_pair_nulls_distinct.sql and
--   20260810100000_link_dam_order_line_cross_item_ambiguity.sql and
--   20260818141220_popdam_bulk_order_line_relink.sql and
--   20260831045020_popdam_orderlist_input_only_write_contract.sql (issue #1772), which
--   narrowed the write whitelists and is why the payloads below use input fields only.
--
-- HOW TO RUN
--   Against PREVIEW rjyboqwcdzcocqgmsyel ONLY, as the migration owner role:
--       psql "$PREVIEW_URL" -f supabase/tests/dam_order_list_contract.sql
--
--   RUN PART 1 AND PART 2 AS SEPARATE STATEMENTS. Submitting the whole file as one
--   multi-statement batch through the transaction pooler (port 6543) wraps everything
--   in one implicit transaction and stalls -- observed 2026-08-09 on the product
--   size/depth tests. psql's -f does the right thing; a programmatic runner must split
--   on the PART 1 / PART 2 banners below, and must repeat the temp-table statement at
--   the top of each half.
--
-- WHAT IT ASSERTS, AND WHY IT IS SHAPED THIS WAY
--   Part 1 asserts OBJECTS exist, using to_regclass / pg_proc / pg_policy /
--   pg_get_viewdef. It never reads supabase_migrations.schema_migrations. This repo has
--   shipped a migration that recorded a clean ledger row while its object did nothing,
--   so "it applied" is not accepted here as evidence of anything.
--
--   Part 2 asserts BEHAVIOUR: every guard is made to FIRE, not merely to exist, and
--   each negative case catches its SPECIFIC condition (insufficient_privilege /
--   check_violation / no_data_found / unique_violation) rather than `when others`, so a
--   typo or a permission error cannot score as a passing guard.
--
--   The cases that matter most are the four link refusals executed here: wrong TYPE,
--   wrong SKU, an item the SKU does not resolve to, and a CROSS-ITEM ambiguous SKU
--   offered as an automatic match. A link guard that silently admits everything is the
--   one failure this feature cannot survive, because it attaches a real order to the
--   wrong product.
--
--   The UNAUTHENTICATED refusal is NOT executed in Part 2. Raising inside this
--   transaction would abort it and skip the rollback that keeps preview clean, so it is
--   proved from the catalog instead: Part 1 section H asserts that anon holds no EXECUTE
--   on any of the three RPCs and no SELECT on the serving view. The commented recipe at
--   the bottom of this file runs it by hand if you want the runtime proof too.
--
-- SIDE EFFECTS
--   Part 1: none, read-only.
--   Part 2: runs inside an explicit transaction that ENDS IN `rollback`. It creates
--   throwaway fixture rows in core.customer, plm.item, public.style_tracker_rows,
--   plm.style_tracker_item_bridge, plm.production_order[_line] and their source refs,
--   and rolls every one of them back. Preview carries a production data clone, so this
--   file must never be converted to `commit`.
--   Part 3: no new rows. It re-reads Part 2's two saved-view fixtures under two
--   different authenticated identities, inside the SAME transaction, and is rolled
--   back with it. It switches role and always switches back.
--
--   On raising: a raised exception ABORTS the transaction, and an aborted transaction
--   is rolled back by the server -- preview stays clean either way. Parts 1, 2 and 3
--   all raise on failure by design. The commented anon checks at the bottom are left
--   commented for a different reason: they would abort the run before the later parts
--   had a chance to report, not because aborting is unsafe.
--
-- LAST RUN: preview rjyboqwcdzcocqgmsyel, see docs/app-migration-notes/popdam-order-list.md.
-- =====================================================================================

-- ======================= PART 1 -- OBJECT EXISTENCE (read-only) ======================
-- Results land in a temp table and are SELECTed at the end of each part, so a runner
-- that does not surface `raise notice` (the Supabase CLI does not) still shows the
-- score. The blocks also raise on any failure, so a silent pass is impossible.
create temp table if not exists dam_order_list_contract_result (
  part text, passed integer, failed integer, ran_at timestamptz default now()
);

do $$
declare
  v_pass integer := 0;
  v_fail integer := 0;
  v_name text;
  v_col  text;
  v_def  text;
begin
  raise notice '=== A. TABLES AND VIEW (to_regclass, not the migration ledger) ===';
  foreach v_name in array array[
    'plm.production_order',
    'plm.production_order_line',
    'plm.production_order_source_ref',
    'plm.production_order_line_source_ref',
    'public.order_list_user_views',
    'api.dam_order_list'
  ] loop
    if to_regclass(v_name) is null then
      v_fail := v_fail + 1; raise notice 'FAIL relation missing: %', v_name;
    else
      v_pass := v_pass + 1;
    end if;
  end loop;

  v_name := 'public.relink_dam_order_lines_bulk(integer)';
  if has_function_privilege('anon', v_name, 'execute')
     or has_function_privilege('authenticated', v_name, 'execute') then
    v_fail := v_fail + 1; raise notice 'FAIL bulk relink is executable outside service_role';
  elsif not has_function_privilege('service_role', v_name, 'execute') then
    v_fail := v_fail + 1; raise notice 'FAIL service_role cannot execute bulk relink';
  else
    v_pass := v_pass + 1;
  end if;

  raise notice '=== B. HEADER COLUMNS ON plm.production_order ===';
  foreach v_col in array array[
    'seal_container_date','sent_po_date','vendor_delivery_date','etd','eta',
    'warehouse_date','booking_state','container_booking_group','mbl','close_tracking',
    'voided_at','voided_by','void_reason'
  ] loop
    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'plm' and table_name = 'production_order' and column_name = v_col
    ) then
      v_fail := v_fail + 1; raise notice 'FAIL header column missing: %', v_col;
    else
      v_pass := v_pass + 1;
    end if;
  end loop;

  raise notice '=== C. LINE COLUMNS ON plm.production_order_line ===';
  foreach v_col in array array[
    'order_person','order_type','customer_suffix','customer_po_number','assortment_id',
    'assortment_component_ordinal','order_depth_inches','case_pack','cases_reported',
    'ship_to','start_ship_date','start_ship_raw','cancel_date','cancel_raw',
    'cargo_forecast_date','cargo_forecast_raw','test_report','professional_photos',
    'contractual_sample_reorder','source_style_type','master_data_match_status',
    'sku_normalized','voided_at','voided_by','void_reason'
  ] loop
    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'plm' and table_name = 'production_order_line' and column_name = v_col
    ) then
      v_fail := v_fail + 1; raise notice 'FAIL line column missing: %', v_col;
    else
      v_pass := v_pass + 1;
    end if;
  end loop;

  -- sku_normalized must be GENERATED. If it were a plain column the importer could
  -- write a hand-normalized value that disagrees with sku, and matching would drift.
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'plm' and table_name = 'production_order_line'
      and column_name = 'sku_normalized' and is_generated = 'ALWAYS'
  ) then
    v_pass := v_pass + 1;
  else
    v_fail := v_fail + 1; raise notice 'FAIL sku_normalized is not a generated column';
  end if;

  raise notice '=== D. CONSTRAINTS ===';
  foreach v_name in array array[
    'production_order_line_master_data_match_status_check',
    'production_order_line_source_style_type_check',
    'production_order_line_matched_requires_item_check'
  ] loop
    if not exists (
      select 1 from pg_constraint
      where conrelid = 'plm.production_order_line'::regclass and conname = v_name and convalidated
    ) then
      v_fail := v_fail + 1; raise notice 'FAIL missing or unvalidated constraint: %', v_name;
    else
      v_pass := v_pass + 1;
    end if;
  end loop;

  -- 20260810060000: the legacy source pair on BOTH canonical tables must be NULLS
  -- DISTINCT. Under the original NULLS NOT DISTINCT the whole table could hold only one
  -- row without a source pair, so a second natively created order line was impossible.
  foreach v_name in array array['plm.production_order', 'plm.production_order_line']
  loop
    if exists (
      select 1
      from pg_constraint c
      join pg_index i on i.indexrelid = c.conindid
      where c.conrelid = v_name::regclass
        and c.contype = 'u'
        and (
          select array_agg(a.attname::text order by a.attname)
          from unnest(c.conkey) k
          join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k
        ) = array['source_id', 'source_system']
        and i.indnullsnotdistinct
    ) then
      v_fail := v_fail + 1;
      raise notice 'FAIL %.(source_system, source_id) is still NULLS NOT DISTINCT; a second source-less row is impossible', v_name;
    else
      v_pass := v_pass + 1;
    end if;
  end loop;

  if exists (
    select 1 from pg_constraint
    where conrelid = 'plm.production_order_source_ref'::regclass
      and conname = 'production_order_source_ref_unique' and contype = 'u'
  ) then v_pass := v_pass + 1;
  else v_fail := v_fail + 1; raise notice 'FAIL order source ref uniqueness missing'; end if;

  if exists (
    select 1 from pg_constraint
    where conrelid = 'plm.production_order_line_source_ref'::regclass
      and conname = 'production_order_line_source_ref_unique' and contype = 'u'
  ) then v_pass := v_pass + 1;
  else v_fail := v_fail + 1; raise notice 'FAIL line source ref uniqueness missing'; end if;

  raise notice '=== E. INDEXES ===';
  foreach v_name in array array[
    'production_order_number_idx','production_order_default_sort_idx',
    'production_order_line_sku_normalized_idx','production_order_line_item_idx',
    'production_order_line_match_status_idx',
    'production_order_source_ref_order_idx','production_order_line_source_ref_line_idx'
  ] loop
    if not exists (select 1 from pg_indexes where indexname = v_name) then
      v_fail := v_fail + 1; raise notice 'FAIL index missing: %', v_name;
    else
      v_pass := v_pass + 1;
    end if;
  end loop;

  raise notice '=== F. RLS POLICIES ===';
  foreach v_name in array array[
    'production_order_popdam_read','production_order_line_popdam_read',
    'production_order_source_ref_read','production_order_line_source_ref_read',
    'order_list_user_views_owner_select','order_list_user_views_owner_insert',
    'order_list_user_views_owner_update','order_list_user_views_owner_delete'
  ] loop
    if not exists (select 1 from pg_policies where policyname = v_name) then
      v_fail := v_fail + 1; raise notice 'FAIL policy missing: %', v_name;
    else
      v_pass := v_pass + 1;
    end if;
  end loop;

  if (select relrowsecurity from pg_class where oid = 'public.order_list_user_views'::regclass)
  then v_pass := v_pass + 1;
  else v_fail := v_fail + 1; raise notice 'FAIL RLS not enabled on public.order_list_user_views'; end if;

  raise notice '=== G. FUNCTIONS, AND NO DELETE PATH ===';
  foreach v_name in array array[
    'public.create_dam_order','public.update_dam_order','public.link_dam_order_line',
    'public.relink_dam_order_lines_bulk'
  ] loop
    if not exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname || '.' || p.proname = v_name and p.prosecdef
    ) then
      v_fail := v_fail + 1; raise notice 'FAIL SECURITY DEFINER function missing: %', v_name;
    else
      v_pass := v_pass + 1;
    end if;
  end loop;

  -- Version 1 has no hard delete. If someone adds one later this must fail loudly.
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname ilike '%dam_order%'
      and (p.proname ilike '%delete%' or p.proname ilike '%remove%' or p.proname ilike '%purge%')
  ) then
    v_fail := v_fail + 1; raise notice 'FAIL a dam order delete/remove/purge function exists; version 1 forbids hard delete';
  else
    v_pass := v_pass + 1;
  end if;

  -- Every SECURITY DEFINER RPC must pin search_path (20260729 lockdown rule).
  for v_name in
    select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('create_dam_order','update_dam_order','link_dam_order_line','relink_dam_order_lines_bulk')
  loop
    if exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = v_name
        and (p.proconfig is null or not exists (
              select 1 from unnest(p.proconfig) c where c like 'search_path=%'))
    ) then
      v_fail := v_fail + 1; raise notice 'FAIL % does not pin search_path', v_name;
    else
      v_pass := v_pass + 1;
    end if;
  end loop;

  raise notice '=== H. THE SERVING VIEW IS SECURITY INVOKER AND NOT ANON-READABLE ===';
  -- security_invoker absent from reloptions means invoker (the default). An explicit
  -- security_invoker=false would silently bypass every policy above.
  if exists (
    select 1 from pg_class
    where oid = 'api.dam_order_list'::regclass
      and coalesce(array_to_string(reloptions, ','), '') ilike '%security_invoker=false%'
  ) then
    v_fail := v_fail + 1; raise notice 'FAIL api.dam_order_list is SECURITY DEFINER';
  else
    v_pass := v_pass + 1;
  end if;

  if has_table_privilege('anon', 'api.dam_order_list', 'select') then
    v_fail := v_fail + 1; raise notice 'FAIL anon can select api.dam_order_list';
  else
    v_pass := v_pass + 1;
  end if;

  if has_table_privilege('authenticated', 'api.dam_order_list', 'select') then
    v_pass := v_pass + 1;
  else
    v_fail := v_fail + 1; raise notice 'FAIL authenticated cannot select api.dam_order_list';
  end if;

  foreach v_name in array array[
    'public.create_dam_order(jsonb, jsonb)',
    'public.update_dam_order(uuid, jsonb, jsonb)',
    'public.link_dam_order_line(uuid, uuid, text)'
  ] loop
    if has_function_privilege('anon', v_name, 'execute') then
      v_fail := v_fail + 1; raise notice 'FAIL anon can execute %', v_name;
    else
      v_pass := v_pass + 1;
    end if;
    if has_function_privilege('authenticated', v_name, 'execute') then
      v_pass := v_pass + 1;
    else
      v_fail := v_fail + 1; raise notice 'FAIL authenticated cannot execute %', v_name;
    end if;
  end loop;

  -- The view must reach Master Data through the bridge, never through a direct FK to
  -- style_tracker_rows on the order line (owner decision 3).
  v_def := pg_get_viewdef('api.dam_order_list'::regclass, true);
  if v_def like '%style_tracker_item_bridge%' then v_pass := v_pass + 1;
  else v_fail := v_fail + 1; raise notice 'FAIL view does not join the style bridge'; end if;

  if exists (
    select 1 from pg_constraint
    where conrelid = 'plm.production_order_line'::regclass
      and contype = 'f'
      and confrelid = 'public.style_tracker_rows'::regclass
  ) then
    v_fail := v_fail + 1; raise notice 'FAIL a competing FK to style_tracker_rows exists on the order line';
  else
    v_pass := v_pass + 1;
  end if;

  insert into dam_order_list_contract_result (part, passed, failed) values ('part1', v_pass, v_fail);
  raise notice 'PART 1: % passed / % failed', v_pass, v_fail;
  if v_fail > 0 then
    raise exception 'PART 1 FAILED: % assertion(s)', v_fail;
  end if;
end;
$$;

select * from dam_order_list_contract_result where part = 'part1';

-- ============= PART 2 -- BEHAVIOUR. ENDS IN ROLLBACK. NEVER COMMIT THIS. =============
begin;

do $$
declare
  v_pass integer := 0;
  v_fail integer := 0;
  v_user_a  uuid := '11111111-1111-4111-8111-111111111111';
  v_user_b  uuid := '22222222-2222-4222-8222-222222222222';
  v_wb      text := 'TEST-WORKBOOK-dam-order-list-contract';
  v_cust    uuid;
  v_item_l  uuid;
  v_item_g  uuid;
  v_item_d  uuid;
  v_row_l   uuid;
  v_row_g   uuid;
  v_row_d1  uuid;
  v_row_d2  uuid;
  v_item_x1 uuid;
  v_item_x2 uuid;
  v_row_x1  uuid;
  v_row_x2  uuid;
  v_line_x  uuid;
  v_order   uuid;
  v_line_l  uuid;
  v_line_g  uuid;
  v_line_d  uuid;
  v_line_u  uuid;
  v_line_m  uuid;
  v_line_na uuid;
  v_bulk_l  uuid := '00000000-0000-0000-0000-000000000001';
  v_bulk_g  uuid := '00000000-0000-0000-0000-000000000002';
  v_bulk_d  uuid := '00000000-0000-0000-0000-000000000003';
  v_bulk_u  uuid := '00000000-0000-0000-0000-000000000004';
  v_bulk_x  uuid := '00000000-0000-0000-0000-000000000005';
  v_txt     text;
  v_got     uuid;
  v_n       integer;
  v_bool    boolean;
  v_result  jsonb;
  v_snapshot text;
begin
  -- ------------------------------------------------------------------ fixtures ------
  insert into core.customer (name) values ('OrderList Contract Test Customer')
    returning id into v_cust;

  -- Each fixture item needs its OWN legacy source pair. plm.item still carries
  -- `unique nulls not distinct (source_system, source_id)`, so two source-less items
  -- collide. That trap is real and is reported separately -- plm.item is outside this
  -- workstream's object claim and is coordinated with fix_schema_for_api.md, so it is
  -- worked around here rather than fixed here.
  insert into plm.item (item_number, style_number, name, description, source_system, source_id)
    values ('TEST-NCV3SP1', 'NCV3SP1', 'Licensed test item', 'Licensed description v1',
            'dam_order_list_contract_test', 'ct-item-licensed')
    returning id into v_item_l;
  insert into plm.item (item_number, style_number, name, description, source_system, source_id)
    values ('TEST-BFC02GABB', 'BFC02GABB', 'Generic test item', 'Generic description v1',
            'dam_order_list_contract_test', 'ct-item-generic')
    returning id into v_item_g;
  insert into plm.item (item_number, style_number, name, description, source_system, source_id)
    values ('TEST-DUPSKU', 'DUPSKU1', 'Ambiguous test item', 'Ambiguous description',
            'dam_order_list_contract_test', 'ct-item-ambiguous')
    returning id into v_item_d;
  -- The CROSS-ITEM tie: one SKU, one catalog, TWO different products. This is the shape
  -- the original narrow candidate count could not see (PR #635 review, finding 1).
  insert into plm.item (item_number, style_number, name, description, source_system, source_id)
    values ('TEST-CROSS-A', 'CROSSSKU1', 'Cross-item A', 'Cross A',
            'dam_order_list_contract_test', 'ct-item-cross-a')
    returning id into v_item_x1;
  insert into plm.item (item_number, style_number, name, description, source_system, source_id)
    values ('TEST-CROSS-B', 'CROSSSKU1', 'Cross-item B', 'Cross B',
            'dam_order_list_contract_test', 'ct-item-cross-b')
    returning id into v_item_x2;

  insert into public.style_tracker_rows
    (source_workbook_id, source_sheet, source_row_number, tracker_type, sku, description, license_status)
    values (v_wb, 'License.Style', 9001, 'licensed', ' ncv3sp1 ', 'Licensed MD description v1', 'Approved')
    returning id into v_row_l;
  insert into public.style_tracker_rows
    (source_workbook_id, source_sheet, source_row_number, tracker_type, sku, description, license_status)
    values (v_wb, 'Generic.Style', 9002, 'generic', 'BFC02GABB', 'Generic MD description v1', null)
    returning id into v_row_g;
  -- Two Master Data rows with the SAME normalized SKU and type. This is the real
  -- 449-case ambiguity from the historical profile, reproduced.
  insert into public.style_tracker_rows
    (source_workbook_id, source_sheet, source_row_number, tracker_type, sku, description)
    values (v_wb, 'License.Style', 9003, 'licensed', 'DUPSKU1', 'Duplicate A')
    returning id into v_row_d1;
  insert into public.style_tracker_rows
    (source_workbook_id, source_sheet, source_row_number, tracker_type, sku, description)
    values (v_wb, 'License.Style', 9004, 'licensed', 'dupsku1', 'Duplicate B')
    returning id into v_row_d2;
  insert into public.style_tracker_rows
    (source_workbook_id, source_sheet, source_row_number, tracker_type, sku, description)
    values (v_wb, 'License.Style', 9005, 'licensed', 'CROSSSKU1', 'Cross tie A')
    returning id into v_row_x1;
  insert into public.style_tracker_rows
    (source_workbook_id, source_sheet, source_row_number, tracker_type, sku, description)
    values (v_wb, 'License.Style', 9006, 'licensed', ' crosssku1 ', 'Cross tie B')
    returning id into v_row_x2;

  insert into plm.style_tracker_item_bridge
    (style_tracker_row_id, source_workbook_id, source_sheet, tracker_type, sku, plm_item_id)
  values
    (v_row_l,  v_wb, 'License.Style', 'licensed', 'NCV3SP1',   v_item_l),
    (v_row_g,  v_wb, 'Generic.Style', 'generic',  'BFC02GABB', v_item_g),
    (v_row_d1, v_wb, 'License.Style', 'licensed', 'DUPSKU1',   v_item_d),
    (v_row_d2, v_wb, 'License.Style', 'licensed', 'dupsku1',   v_item_d),
    (v_row_x1, v_wb, 'License.Style', 'licensed', 'CROSSSKU1', v_item_x1),
    (v_row_x2, v_wb, 'License.Style', 'licensed', 'CROSSSKU1', v_item_x2);

  -- Act as a signed-in PopDAM user for every RPC call below.
  perform set_config('request.jwt.claims',
                     json_build_object('sub', v_user_a, 'role', 'authenticated')::text, true);

  -- ------------------------------------------------- 1. create, and what it refuses --
  select public.create_dam_order(
    jsonb_build_object(
      -- status / sent_po_date / close_tracking are AUTOMATIC columns and stopped being
      -- writable through this RPC in 20260831045020 (issue #1772). Passing one here now
      -- raises 42501, which is the contract, not a regression.
      'production_order_number', 'TEST-PO-0001',
      'company_id', v_cust,
      'metadata', jsonb_build_object('ordering_company', 'POP')
    ),
    jsonb_build_array(
      -- line_number is DERIVED from position since 20260831045020; these four lines
      -- still land as '1'..'4' because they are given in that order.
      jsonb_build_object('sku',' NCV3SP1 ','quantity_ordered',10,
                         'source_style_type','licensed','customer_po_number','CPO-1',
                         'metadata', jsonb_build_object('order_list_snapshot',
                            jsonb_build_object('sku','NCV3SP1','description','Snapshot description',
                                               'license_status','Approved','style_type','licensed',
                                               'source_row','65'))),
      jsonb_build_object('sku','BFC02GABB','quantity_ordered',5,
                         'source_style_type','generic'),
      jsonb_build_object('sku','DUPSKU1','quantity_ordered',7,
                         'source_style_type','licensed'),
      jsonb_build_object('sku','NOSUCHSKU','quantity_ordered',1,
                         'source_style_type','licensed')
    )
  ) into v_order;

  if v_order is not null then v_pass := v_pass + 1;
  else v_fail := v_fail + 1; raise notice 'FAIL create_dam_order returned null'; end if;

  select id into v_line_l from plm.production_order_line where production_order_id = v_order and line_number = '1';
  select id into v_line_g from plm.production_order_line where production_order_id = v_order and line_number = '2';
  select id into v_line_d from plm.production_order_line where production_order_id = v_order and line_number = '3';
  select id into v_line_u from plm.production_order_line where production_order_id = v_order and line_number = '4';

  -- sku_normalized trims and case-folds, and nothing else.
  select sku_normalized into v_txt from plm.production_order_line where id = v_line_l;
  if v_txt = 'ncv3sp1' then v_pass := v_pass + 1;
  else v_fail := v_fail + 1; raise notice 'FAIL sku_normalized = % (expected ncv3sp1)', v_txt; end if;

  insert into plm.production_order_line
    (production_order_id, line_number, sku, quantity_ordered, source_style_type, source_system, source_id)
  values
    (v_order, '5', 'CROSSSKU1', 3, 'licensed', 'dam_order_list_contract_test', 'ct-line-cross')
  returning id into v_line_x;

  insert into plm.production_order_line
    (production_order_id, line_number, sku, quantity_ordered, source_style_type,
     source_system, source_id, item_id, master_data_match_status)
  values
    (v_order, '6', 'NCV3SP1', 1, 'licensed', 'dam_order_list_contract_test', 'ct-line-manual', v_item_l, 'manual')
  returning id into v_line_m;

  insert into plm.production_order_line
    (production_order_id, line_number, sku, quantity_ordered, source_style_type,
     source_system, source_id, master_data_match_status)
  values
    (v_order, '7', 'NCV3SP1', 1, 'licensed', 'dam_order_list_contract_test', 'ct-line-na', 'not_applicable')
  returning id into v_line_na;

  -- Fixed near-zero UUIDs make p_limit=5 select only these fixtures even on shared
  -- preview. The test must never lock or relink unrelated preview order lines.
  insert into plm.production_order_line
    (id, production_order_id, line_number, sku, quantity_ordered, source_style_type,
     source_system, source_id, master_data_match_status)
  values
    (v_bulk_l, v_order, 'B1', 'NCV3SP1', 1, 'licensed', 'dam_order_list_contract_test', 'ct-bulk-l', 'unmatched'),
    (v_bulk_g, v_order, 'B2', 'BFC02GABB', 1, 'generic', 'dam_order_list_contract_test', 'ct-bulk-g', 'ambiguous'),
    (v_bulk_d, v_order, 'B3', 'DUPSKU1', 1, 'licensed', 'dam_order_list_contract_test', 'ct-bulk-d', 'unmatched'),
    (v_bulk_u, v_order, 'B4', 'NOSUCHSKU', 1, 'licensed', 'dam_order_list_contract_test', 'ct-bulk-u', 'unmatched'),
    (v_bulk_x, v_order, 'B5', 'CROSSSKU1', 1, 'licensed', 'dam_order_list_contract_test', 'ct-bulk-x', 'ambiguous');

  -- All four RPC-created lines exist. This is the regression guard for the NULLS NOT DISTINCT bug:
  -- before 20260810060000 the second line raised 23505 and no order survived at all.
  select count(*) into v_n from plm.production_order_line
   where production_order_id = v_order and source_system = 'popdam_order_list';
  if v_n = 4 then v_pass := v_pass + 1;
  else v_fail := v_fail + 1; raise notice 'FAIL expected 4 created lines, got %', v_n; end if;

  -- A natively created order carries its own identity rather than relying on NULLs, and
  -- it is a DIFFERENT source system from the imported feeds so reconciliation cannot
  -- confuse it with a spreadsheet row.
  select count(*) into v_n from plm.production_order_line
   where production_order_id = v_order and source_system = 'popdam_order_list';
  if v_n = 4 then v_pass := v_pass + 1;
  else v_fail := v_fail + 1; raise notice 'FAIL expected 4 natively stamped lines, got %', v_n; end if;

  select count(distinct source_id) into v_n from plm.production_order_line
   where production_order_id = v_order and source_system = 'popdam_order_list';
  if v_n = 4 then v_pass := v_pass + 1;
  else v_fail := v_fail + 1; raise notice 'FAIL native line source ids are not distinct (% of 4)', v_n; end if;

  if exists (select 1 from plm.production_order
              where id = v_order and source_system = 'popdam_order_list' and source_id is not null)
  then v_pass := v_pass + 1;
  else v_fail := v_fail + 1; raise notice 'FAIL the created order carries no native source pair'; end if;

  if exists (select 1 from plm.production_order_source_ref
              where production_order_id = v_order
                and source_system = 'popdam_order_list' and is_primary)
  then v_pass := v_pass + 1;
  else v_fail := v_fail + 1; raise notice 'FAIL the created order has no primary source ref row'; end if;

  -- A new RPC-created line starts with no product and says so.
  select count(*) into v_n from plm.production_order_line
   where production_order_id = v_order and item_id is null
     and master_data_match_status = 'not_applicable'
     and source_system = 'popdam_order_list';
  if v_n = 4 then v_pass := v_pass + 1;
  else v_fail := v_fail + 1; raise notice 'FAIL expected 4 unlinked new lines, got %', v_n; end if;

  -- ------------------------------------------------------ 1b. bulk exact relink ------
  v_result := public.relink_dam_order_lines_bulk(5);
  if (v_result ->> 'linked')::integer = 3
     and (v_result ->> 'ties_left')::integer = 1
     and (v_result ->> 'no_candidate')::integer = 1
     and (v_result -> 'before' ->> 'ambiguous')::integer = 2
     and (v_result -> 'before' ->> 'unmatched')::integer = 3
     and (v_result -> 'after' ->> 'matched')::integer = 3
     and (v_result -> 'after' ->> 'ambiguous')::integer = 1
     and (v_result -> 'after' ->> 'unmatched')::integer = 1 then
    v_pass := v_pass + 1;
  else
    v_fail := v_fail + 1; raise notice 'FAIL bulk relink returned wrong counts: %', v_result;
  end if;

  if (select count(*) from plm.production_order_line
      where (id = v_bulk_l and item_id = v_item_l and master_data_match_status = 'matched')
         or (id = v_bulk_g and item_id = v_item_g and master_data_match_status = 'matched'
             and metadata ->> 'pre_bulk_relink_match_status' = 'ambiguous')
         or (id = v_bulk_d and item_id = v_item_d and master_data_match_status = 'matched')) = 3 then
    v_pass := v_pass + 1;
  else
    v_fail := v_fail + 1; raise notice 'FAIL bulk relink did not link the three exact unique rows';
  end if;

  if exists (select 1 from plm.production_order_line where id = v_bulk_x and item_id is null and master_data_match_status = 'ambiguous')
     and exists (select 1 from plm.production_order_line where id = v_bulk_u and item_id is null and master_data_match_status = 'unmatched')
     and exists (select 1 from plm.production_order_line where id = v_line_m and item_id = v_item_l and master_data_match_status = 'manual')
     and exists (select 1 from plm.production_order_line where id = v_line_na and item_id is null and master_data_match_status = 'not_applicable') then
    v_pass := v_pass + 1;
  else
    v_fail := v_fail + 1; raise notice 'FAIL bulk relink changed a tie, no-candidate, manual, or not-applicable row';
  end if;

  select md5(jsonb_agg(to_jsonb(x) order by x.id)::text) into v_snapshot
  from (select id, item_id, master_data_match_status, metadata, updated_at
        from plm.production_order_line where id in (v_bulk_u, v_bulk_x)) x;
  v_result := public.relink_dam_order_lines_bulk(2);
  select md5(jsonb_agg(to_jsonb(x) order by x.id)::text) into v_txt
  from (select id, item_id, master_data_match_status, metadata, updated_at
        from plm.production_order_line where id in (v_bulk_u, v_bulk_x)) x;
  if (v_result ->> 'linked')::integer = 0 and v_snapshot = v_txt then v_pass := v_pass + 1;
  else v_fail := v_fail + 1; raise notice 'FAIL second bulk run was not idempotent: %', v_result; end if;

  begin
    perform public.relink_dam_order_lines_bulk(-1);
    v_fail := v_fail + 1; raise notice 'FAIL bulk relink accepted negative limit';
  exception when invalid_parameter_value then v_pass := v_pass + 1;
  end;

  -- item_id is not in the whitelist, so create_dam_order must refuse it outright.
  begin
    perform public.create_dam_order(
      jsonb_build_object('production_order_number','TEST-PO-REJECT'),
      jsonb_build_array(jsonb_build_object('sku','X','item_id', v_item_l)));
    v_fail := v_fail + 1; raise notice 'FAIL create_dam_order accepted a non-whitelisted field (item_id)';
  exception when insufficient_privilege then
    v_pass := v_pass + 1;
  end;

  begin
    perform public.create_dam_order(jsonb_build_object('production_order_number','TEST-PO-X','nonsense_field','y'));
    v_fail := v_fail + 1; raise notice 'FAIL create_dam_order accepted an unknown header field';
  exception when insufficient_privilege then
    v_pass := v_pass + 1;
  end;

  begin
    -- company_id is writable, so the refusal below can only be the missing
    -- production_order_number -- not a whitelist rejection of the other key.
    perform public.create_dam_order(jsonb_build_object('company_id', v_cust));
    v_fail := v_fail + 1; raise notice 'FAIL create_dam_order accepted a missing production_order_number';
  exception when check_violation then
    v_pass := v_pass + 1;
  end;

  -- ------------------------------------------------------------- 2. linking guards --
  -- Licensed exact match.
  perform public.link_dam_order_line(v_line_l, v_item_l, 'matched');
  select item_id, master_data_match_status into v_got, v_txt
    from plm.production_order_line where id = v_line_l;
  if v_got = v_item_l and v_txt = 'matched' then v_pass := v_pass + 1;
  else v_fail := v_fail + 1; raise notice 'FAIL licensed exact link did not stick'; end if;

  -- Generic exact match.
  perform public.link_dam_order_line(v_line_g, v_item_g, 'manual');
  if exists (select 1 from plm.production_order_line where id = v_line_g and item_id = v_item_g)
  then v_pass := v_pass + 1;
  else v_fail := v_fail + 1; raise notice 'FAIL generic exact link did not stick'; end if;

  -- Wrong type: the licensed line may not take the generic item.
  begin
    perform public.link_dam_order_line(v_line_l, v_item_g, 'manual');
    v_fail := v_fail + 1; raise notice 'FAIL wrong-type link was accepted';
  exception when check_violation then v_pass := v_pass + 1;
  end;

  -- Wrong SKU: the item exists and the type is right, but it is not this line's SKU.
  begin
    perform public.link_dam_order_line(v_line_u, v_item_l, 'manual');
    v_fail := v_fail + 1; raise notice 'FAIL wrong-SKU link was accepted';
  exception when check_violation then v_pass := v_pass + 1;
  end;

  -- Duplicate Master Data rows that bridge to the SAME item are NOT an item-level tie:
  -- the SKU still resolves to exactly one product, which is what item_id records. This
  -- link is therefore allowed, and deliberately so. Before 20260810100000 the guard
  -- counted bridge ROWS and refused this while admitting the genuinely dangerous
  -- cross-item case below -- exactly backwards.
  perform public.link_dam_order_line(v_line_d, v_item_d, 'matched');
  select item_id, master_data_match_status into v_got, v_txt
    from plm.production_order_line where id = v_line_d;
  if v_got = v_item_d and v_txt = 'matched' then v_pass := v_pass + 1;
  else v_fail := v_fail + 1; raise notice 'FAIL same-item duplicate rows blocked a unique item resolution'; end if;

  -- CROSS-ITEM AMBIGUITY (PR #635 review, finding 1). One SKU, one catalog, two
  -- different products. An AUTOMATIC match must refuse: there is no unique answer and
  -- picking one would stamp a real order against an arbitrary product.
  begin
    perform public.link_dam_order_line(v_line_x, v_item_x1, 'matched');
    v_fail := v_fail + 1; raise notice 'FAIL a cross-item ambiguous SKU was auto-matched to an arbitrary product';
  exception when check_violation then v_pass := v_pass + 1;
  end;

  -- A HUMAN may break that tie, but only to an item the SKU genuinely resolves to.
  perform public.link_dam_order_line(v_line_x, v_item_x2, 'manual');
  select item_id, master_data_match_status into v_got, v_txt
    from plm.production_order_line where id = v_line_x;
  if v_got = v_item_x2 and v_txt = 'manual' then v_pass := v_pass + 1;
  else v_fail := v_fail + 1; raise notice 'FAIL a human tie-break was refused'; end if;

  -- ...and the tie is recorded, so a manual tie-break never looks like a clean link.
  select (metadata ->> 'link_candidate_item_count')::integer into v_n
    from plm.production_order_line where id = v_line_x;
  if v_n = 2 then v_pass := v_pass + 1;
  else v_fail := v_fail + 1; raise notice 'FAIL the tie was not recorded (link_candidate_item_count = %)', v_n; end if;

  -- An item the SKU does NOT resolve to is refused even for a human.
  begin
    perform public.link_dam_order_line(v_line_x, v_item_l, 'manual');
    v_fail := v_fail + 1; raise notice 'FAIL a human linked an item the SKU does not resolve to';
  exception when check_violation then v_pass := v_pass + 1;
  end;

  -- An unambiguous link records a candidate count of exactly 1.
  select (metadata ->> 'link_candidate_item_count')::integer into v_n
    from plm.production_order_line where id = v_line_l;
  if v_n = 1 then v_pass := v_pass + 1;
  else v_fail := v_fail + 1; raise notice 'FAIL unambiguous link recorded candidate count %', v_n; end if;

  -- Honesty: an item link may not be recorded as unmatched, and clearing the item may
  -- not be recorded as matched.
  begin
    perform public.link_dam_order_line(v_line_g, v_item_g, 'unmatched');
    v_fail := v_fail + 1; raise notice 'FAIL item link accepted status unmatched';
  exception when check_violation then v_pass := v_pass + 1;
  end;
  begin
    perform public.link_dam_order_line(v_line_g, null, 'matched');
    v_fail := v_fail + 1; raise notice 'FAIL clearing the item accepted status matched';
  exception when check_violation then v_pass := v_pass + 1;
  end;

  -- The ambiguous and unmatched lines must still be recordable and readable.
  -- Put the line back into the ambiguous state a reviewer would see.
  perform public.link_dam_order_line(v_line_d, null, 'ambiguous');
  update plm.production_order_line set master_data_match_status = 'unmatched' where id = v_line_u;
  select count(*) into v_n from api.dam_order_list
   where order_id = v_order
     and order_line_id in (v_line_d, v_line_u)
     and master_data_match_status in ('ambiguous','unmatched');
  if v_n = 2 then v_pass := v_pass + 1;
  else v_fail := v_fail + 1; raise notice 'FAIL ambiguous/unmatched rows not readable through the view (got %)', v_n; end if;

  -- The matched-requires-item constraint must fire.
  begin
    update plm.production_order_line set master_data_match_status = 'matched' where id = v_line_u;
    v_fail := v_fail + 1; raise notice 'FAIL a line claimed matched with no item_id';
  exception when check_violation then v_pass := v_pass + 1;
  end;

  -- ------------------------------------------ 3. live Master Data vs the snapshot ----
  select master_data_description into v_txt from api.dam_order_list where order_line_id = v_line_l;
  if v_txt = 'Licensed MD description v1' then v_pass := v_pass + 1;
  else v_fail := v_fail + 1; raise notice 'FAIL view did not project live Master Data description (got %)', v_txt; end if;

  -- style_tracker_rows stamps updated_by = auth.uid() and FKs it to auth.users, so the
  -- synthetic test uid has to be out of scope for this one statement.
  perform set_config('request.jwt.claims', '', true);
  update public.style_tracker_rows set description = 'Licensed MD description v2' where id = v_row_l;
  perform set_config('request.jwt.claims',
                     json_build_object('sub', v_user_a, 'role', 'authenticated')::text, true);

  select master_data_description into v_txt from api.dam_order_list where order_line_id = v_line_l;
  if v_txt = 'Licensed MD description v2' then v_pass := v_pass + 1;
  else v_fail := v_fail + 1; raise notice 'FAIL a Master Data edit did not appear through the view (got %)', v_txt; end if;

  select snapshot_description into v_txt from api.dam_order_list where order_line_id = v_line_l;
  if v_txt = 'Snapshot description' then v_pass := v_pass + 1;
  else v_fail := v_fail + 1; raise notice 'FAIL the immutable snapshot changed with Master Data (got %)', v_txt; end if;

  -- An unlinked line still shows its snapshot as the fallback and flags the gap.
  select item_link_missing into v_bool from api.dam_order_list where order_line_id = v_line_u;
  if v_bool then v_pass := v_pass + 1;
  else v_fail := v_fail + 1; raise notice 'FAIL item_link_missing not set on an unlinked line'; end if;

  -- ------------------------------------------------- 4. void keeps the history -------
  perform public.update_dam_order(v_order,
    jsonb_build_object('voided', true, 'void_reason', 'contract test'),
    '[]'::jsonb);
  if exists (select 1 from plm.production_order
              where id = v_order and voided_at is not null
                and voided_by = v_user_a and void_reason = 'contract test')
  then v_pass := v_pass + 1;
  else v_fail := v_fail + 1; raise notice 'FAIL void did not record actor/reason'; end if;

  select count(*) into v_n from plm.production_order_line where production_order_id = v_order;
  if v_n = 12 then v_pass := v_pass + 1;
  else v_fail := v_fail + 1; raise notice 'FAIL voiding destroyed lines (% of 12 remain)', v_n; end if;

  -- A partial patch must not blank fields it did not mention. `mbl` was used here until
  -- 20260831045020 made it non-writable; void_reason is the writable field now, and the
  -- unmentioned fields it must not disturb are company_id and voided_at.
  perform public.update_dam_order(v_order, jsonb_build_object('void_reason','contract test 2'), '[]'::jsonb);
  if exists (select 1 from plm.production_order
              where id = v_order and void_reason = 'contract test 2'
                and company_id = v_cust and voided_at is not null)
  then v_pass := v_pass + 1;
  else v_fail := v_fail + 1; raise notice 'FAIL a partial patch blanked an unmentioned field'; end if;

  -- And an automatic header field is refused outright (issue #1772).
  begin
    perform public.update_dam_order(v_order, jsonb_build_object('mbl','MBL-123'), '[]'::jsonb);
    v_fail := v_fail + 1; raise notice 'FAIL update_dam_order accepted the automatic field mbl';
  exception when insufficient_privilege then v_pass := v_pass + 1;
  end;

  -- The Import PO # is creation-only.
  begin
    perform public.update_dam_order(v_order, jsonb_build_object('production_order_number','TEST-PO-9999'), '[]'::jsonb);
    v_fail := v_fail + 1; raise notice 'FAIL update_dam_order accepted production_order_number';
  exception when insufficient_privilege then v_pass := v_pass + 1;
  end;

  -- A line patch must belong to the order it names.
  begin
    perform public.update_dam_order(v_order, '{}'::jsonb,
      jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'ship_to','X')));
    v_fail := v_fail + 1; raise notice 'FAIL update_dam_order patched a line outside the order';
  exception when no_data_found then v_pass := v_pass + 1;
  end;

  -- ------------------------------------------------- 5. source-ref identity rules ----
  insert into plm.production_order_source_ref (production_order_id, source_system, source_id, is_primary)
    values (v_order, 'google_order_list', 'order:po:test-po-0001', true);
  insert into plm.production_order_line_source_ref (production_order_line_id, source_system, source_id, is_primary)
    values (v_line_l, 'google_order_list', 'order:row:65', true);

  -- Idempotency: the same Google id cannot be attached twice.
  begin
    insert into plm.production_order_line_source_ref (production_order_line_id, source_system, source_id)
      values (v_line_g, 'google_order_list', 'order:row:65');
    v_fail := v_fail + 1; raise notice 'FAIL a duplicate Google source id was accepted';
  exception when unique_violation then v_pass := v_pass + 1;
  end;

  -- Coldlion CLAIMS the same canonical line rather than creating a parallel one, and
  -- the Google evidence survives beside it.
  insert into plm.production_order_line_source_ref (production_order_line_id, source_system, source_id, is_primary)
    values (v_line_l, 'coldlion', 'coldlion:line:987654', true);

  select count(*) into v_n from plm.production_order_line_source_ref where production_order_line_id = v_line_l;
  if v_n = 2 then v_pass := v_pass + 1;
  else v_fail := v_fail + 1; raise notice 'FAIL expected 2 source refs on one line, got %', v_n; end if;

  select count(*) into v_n from api.dam_order_list
   where order_line_id = v_line_l and google_source_id is not null and coldlion_source_id is not null;
  if v_n = 1 then v_pass := v_pass + 1;
  else v_fail := v_fail + 1; raise notice 'FAIL the view does not show both source identities'; end if;

  -- One primary per source system per row.
  begin
    insert into plm.production_order_line_source_ref (production_order_line_id, source_system, source_id, is_primary)
      values (v_line_l, 'coldlion', 'coldlion:line:987655', true);
    v_fail := v_fail + 1; raise notice 'FAIL a second primary coldlion ref was accepted on one line';
  exception when unique_violation then v_pass := v_pass + 1;
  end;

  -- ---------------------------------------------- 6. saved views are per user --------
  insert into public.order_list_user_views (user_id, view_name, column_state)
    values (v_user_a, 'mine', '[{"colId":"sku"}]'::jsonb);
  insert into public.order_list_user_views (user_id, view_name, column_state)
    values (v_user_b, 'mine', '[{"colId":"eta"}]'::jsonb);

  begin
    insert into public.order_list_user_views (user_id, view_name) values (v_user_a, 'mine');
    v_fail := v_fail + 1; raise notice 'FAIL duplicate saved view name accepted for one user';
  exception when unique_violation then v_pass := v_pass + 1;
  end;

  insert into dam_order_list_contract_result (part, passed, failed) values ('part2', v_pass, v_fail);
  raise notice 'PART 2: % passed / % failed', v_pass, v_fail;
  if v_fail > 0 then
    raise exception 'PART 2 FAILED: % assertion(s)', v_fail;
  end if;
end;
$$;

-- =========== PART 3 -- SAVED-VIEW RLS ISOLATION. ROLE-SCOPED, AND IT RAISES ==========
--
-- ISSUE #655. This was two bare `select case when ... 'FAIL ...' end` statements.
-- psql prints a result row either way, so a REAL LEAK BETWEEN USERS PRINTED `FAIL`
-- AND THE SCRIPT STILL EXITED 0. A green run did not prove isolation -- it proved
-- only that two queries ran. That is the one thing an RLS test exists to prove, so
-- it was the worst possible place in this file for a silent failure.
--
-- The old comment claimed a real role switch "cannot happen inside the do block".
-- That is not true, and it is the assumption that produced the defect:
--   * `set local role` runs inside PL/pgSQL via EXECUTE, used below;
--   * `set_config('request.jwt.claims', ..., true)` already runs inside the PART 2
--     do block at the `create_dam_order` and `void` checks above;
--   * scripts/poppim-audit-remediation/verify-saved-view-crud.sql has done exactly
--     this -- role switch inside a do block -- since 2026-07-27.
--
-- So the checks move inside a do block that RAISES, matching PART 1 and PART 2.
-- A raised exception aborts the transaction, and an aborted transaction is rolled
-- back by the server, so preview stays clean exactly as the `rollback` below intends.
-- ---------------------------------------------------------------------------------
do $$
declare
  v_user_a  uuid := '11111111-1111-4111-8111-111111111111';
  v_user_b  uuid := '22222222-2222-4222-8222-222222222222';
  v_n       integer;
  v_leaked  integer;
  v_pass    integer := 0;
  v_fail    integer := 0;
begin
  raise notice '=== I. SAVED-VIEW RLS ISOLATION (role-scoped) ===';

  -- PART 2 seeded exactly one saved view for A and one for B. Assert that from the
  -- owner role FIRST: if the seed is not two rows, a later count of 1 per user would
  -- be "isolated" for the wrong reason and the test would pass while proving nothing.
  select count(*) into v_n from public.order_list_user_views
   where user_id in (v_user_a, v_user_b);
  if v_n = 2 then v_pass := v_pass + 1;
  else
    v_fail := v_fail + 1;
    raise notice 'FAIL precondition: expected 2 seeded saved views, found %', v_n;
  end if;

  -- ---- User A ----
  perform set_config('request.jwt.claims',
                     json_build_object('sub', v_user_a, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  select count(*) into v_n from public.order_list_user_views;
  select count(*) into v_leaked from public.order_list_user_views where user_id <> v_user_a;

  execute 'reset role';

  if v_n = 1 and v_leaked = 0 then v_pass := v_pass + 1;
  else
    v_fail := v_fail + 1;
    raise notice 'FAIL saved views leaked to user A: sees % row(s), % belonging to someone else',
      v_n, v_leaked;
  end if;

  -- ---- User B ----
  perform set_config('request.jwt.claims',
                     json_build_object('sub', v_user_b, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  select count(*) into v_n from public.order_list_user_views;
  select count(*) into v_leaked from public.order_list_user_views where user_id <> v_user_b;

  execute 'reset role';

  if v_n = 1 and v_leaked = 0 then v_pass := v_pass + 1;
  else
    v_fail := v_fail + 1;
    raise notice 'FAIL saved views leaked to user B: sees % row(s), % belonging to someone else',
      v_n, v_leaked;
  end if;

  -- A `using (user_id = auth.uid())` policy that is never actually consulted -- RLS
  -- disabled, or the role BYPASSRLS -- would make both counts above 2, not 1, so the
  -- checks already catch it. This asserts the mechanism directly rather than by
  -- inference, because "the policy was bypassed" and "the policy is wrong" need
  -- different fixes and the counts alone cannot tell them apart.
  if (select relrowsecurity from pg_class where oid = 'public.order_list_user_views'::regclass)
     and not (select rolbypassrls from pg_roles where rolname = 'authenticated')
  then v_pass := v_pass + 1;
  else
    v_fail := v_fail + 1;
    raise notice 'FAIL isolation above is not attributable to RLS: relrowsecurity or authenticated BYPASSRLS is wrong';
  end if;

  insert into dam_order_list_contract_result (part, passed, failed) values ('part3', v_pass, v_fail);
  raise notice 'PART 3: % passed / % failed', v_pass, v_fail;
  if v_fail > 0 then
    raise exception 'PART 3 FAILED: % assertion(s)', v_fail;
  end if;
end;
$$;

-- Anon must be refused by grants alone. Each of these must raise permission denied;
-- run them one at a time and confirm the error.
--   set local role anon; select * from api.dam_order_list limit 1;              -- expect 42501
--   set local role anon; select public.create_dam_order('{}'::jsonb);           -- expect 42501
--   set local role anon; select public.link_dam_order_line(null, null);         -- expect 42501
-- They are left commented because a raised error aborts this transaction and would
-- skip the rollback below. Part 1 section H proves the same thing from the catalog.

-- ISSUE #655. Deleting PART 3, or having it silently not run, must not read as a
-- clean run. Assert it recorded a result before printing the scoreboard.
do $$
declare
  v_n integer;
begin
  select count(*) into v_n from dam_order_list_contract_result where part = 'part3';
  if v_n <> 1 then
    raise exception 'PART 3 did not run: expected 1 result row, found %. The saved-view RLS isolation checks are the point of this file -- a run without them is not a pass.', v_n;
  end if;
end;
$$;

select * from dam_order_list_contract_result where part in ('part2', 'part3') order by part;

rollback;
