-- #853/#868 contract: canonical item links are additive and fail loudly.

do $$
declare
  delete_action "char";
  legacy_delete_action "char";
  function_body text;
begin
  select c.confdeltype
  into delete_action
  from pg_constraint c
  where c.conname = 'style_tracker_item_bridge_plm_item_id_fkey'
    and c.conrelid = 'plm.style_tracker_item_bridge'::regclass;

  if delete_action is distinct from 'r' then
    raise exception 'plm_item_id must use ON DELETE RESTRICT; found %', delete_action;
  end if;

  select c.confdeltype
  into legacy_delete_action
  from pg_constraint c
  where c.conname = 'style_tracker_item_bridge_erp_item_id_fkey'
    and c.conrelid = 'plm.style_tracker_item_bridge'::regclass;

  if legacy_delete_action is distinct from 'r' then
    raise exception 'erp_item_id must use ON DELETE RESTRICT; found %', legacy_delete_action;
  end if;

  select pg_get_functiondef('plm.refresh_style_tracker_item_bridge()'::regprocedure)
  into function_body;

  if function_body not like '%CASE WHEN count(*) = 1 THEN min(id::text)::uuid END AS id%'
     or function_body not like '%coalesce(plm.style_tracker_item_bridge.erp_item_id, EXCLUDED.erp_item_id)%'
     or function_body not like '%coalesce(plm.style_tracker_item_bridge.plm_item_id, EXCLUDED.plm_item_id)%' then
    raise exception 'bridge refresh lost its unique-only or preserve-existing safety rule';
  end if;
end;
$$;

begin;

do $$
declare
  test_sku constant text := 'ISSUE853-CONTRACT-ONLY';
  style_row_id uuid;
  legacy_item_id uuid;
  expected_item_id uuid;
  competing_item_id uuid;
  tie_sku constant text := 'ISSUE853-CONTRACT-TIE';
  zero_sku constant text := 'ISSUE853-CONTRACT-ZERO';
  tie_style_row_id uuid;
  zero_style_row_id uuid;
  violation_constraint text;
begin
  insert into public.erp_items_current(
    external_id, style_number, item_description, mg01_code, source_system
  ) values (
    test_sku, test_sku, 'MATCHING CONTRACT DESCRIPTION', 'MATCHING-CODE', 'contract-test'
  ) returning id into legacy_item_id;

  insert into public.style_tracker_rows(source_sheet, tracker_type, sku)
  values ('License.Style', 'licensed', test_sku)
  returning id into style_row_id;

  perform plm.refresh_style_tracker_item_bridge();

  if not exists (
    select 1 from plm.style_tracker_item_bridge
    where style_tracker_row_id = style_row_id and erp_item_id = legacy_item_id
  ) then
    raise exception 'refresh did not create the deterministic legacy fixture link';
  end if;

  insert into plm.item(item_number, description, source_system, source_id, raw)
  values (
    test_sku, 'MATCHING CONTRACT DESCRIPTION', 'contract-test', test_sku || '|winner',
    jsonb_build_object('merchGroup01', 'MATCHING-CODE')
  ) returning id into expected_item_id;

  insert into plm.item(item_number, description, source_system, source_id, raw)
  values (
    test_sku, 'NONMATCHING CONTRACT DESCRIPTION', 'contract-test', test_sku || '|competitor',
    jsonb_build_object('merchGroup01', 'NONMATCHING-CODE')
  ) returning id into competing_item_id;

  perform plm.refresh_style_tracker_item_bridge();

  if not exists (
    select 1 from plm.style_tracker_item_bridge
    where style_tracker_row_id = style_row_id
      and erp_item_id = legacy_item_id
      and plm_item_id = expected_item_id
      and plm_item_id <> competing_item_id
  ) then
    raise exception 'content disambiguation did not select the sole evidence-backed candidate';
  end if;

  update public.style_tracker_rows set sku = test_sku || '-NOW-UNMATCHED' where id = style_row_id;
  perform plm.refresh_style_tracker_item_bridge();

  if not exists (
    select 1 from plm.style_tracker_item_bridge
    where style_tracker_row_id = style_row_id
      and erp_item_id = legacy_item_id
      and plm_item_id = expected_item_id
  ) then
    raise exception 'refresh erased a preserved legacy or canonical link';
  end if;

  insert into public.erp_items_current(external_id, style_number, item_description, mg01_code, source_system)
  values (tie_sku, tie_sku, 'TIED DESCRIPTION', 'TIED-CODE', 'contract-test');
  insert into public.style_tracker_rows(source_sheet, tracker_type, sku)
  values ('License.Style', 'licensed', tie_sku) returning id into tie_style_row_id;
  insert into plm.item(item_number, description, source_system, source_id, raw)
  values
    (tie_sku, 'TIED DESCRIPTION', 'contract-test', tie_sku || '|a', jsonb_build_object('merchGroup01', 'TIED-CODE')),
    (tie_sku, 'TIED DESCRIPTION', 'contract-test', tie_sku || '|b', jsonb_build_object('merchGroup01', 'TIED-CODE'));

  insert into public.erp_items_current(external_id, style_number, item_description, mg01_code, source_system)
  values (zero_sku, zero_sku, 'LEGACY-ONLY DESCRIPTION', 'LEGACY-ONLY-CODE', 'contract-test');
  insert into public.style_tracker_rows(source_sheet, tracker_type, sku)
  values ('License.Style', 'licensed', zero_sku) returning id into zero_style_row_id;
  insert into plm.item(item_number, description, source_system, source_id, raw)
  values
    (zero_sku, 'NO EVIDENCE A', 'contract-test', zero_sku || '|a', jsonb_build_object('merchGroup01', 'NO-EVIDENCE-A')),
    (zero_sku, 'NO EVIDENCE B', 'contract-test', zero_sku || '|b', jsonb_build_object('merchGroup01', 'NO-EVIDENCE-B'));

  perform plm.refresh_style_tracker_item_bridge();

  if exists (
    select 1 from plm.style_tracker_item_bridge
    where style_tracker_row_id in (tie_style_row_id, zero_style_row_id)
      and plm_item_id is not null
  ) or exists (
    select 1 from plm.style_tracker_item_bridge
    where style_tracker_row_id in (tie_style_row_id, zero_style_row_id)
      and match_status <> 'needs_review'
  ) then
    raise exception 'tie or zero-evidence candidates were guessed instead of left for review';
  end if;

  begin
    delete from public.erp_items_current where id = legacy_item_id;
    raise exception 'ON DELETE RESTRICT did not block a linked legacy ERP item deletion';
  exception
    when foreign_key_violation then
      get stacked diagnostics violation_constraint = constraint_name;
      if violation_constraint <> 'style_tracker_item_bridge_erp_item_id_fkey' then
        raise exception 'unexpected legacy deletion constraint: %', violation_constraint;
      end if;
  end;

  begin
    delete from plm.item where id = expected_item_id;
    raise exception 'ON DELETE RESTRICT did not block a linked canonical item deletion';
  exception
    when foreign_key_violation then
      get stacked diagnostics violation_constraint = constraint_name;
      if violation_constraint <> 'style_tracker_item_bridge_plm_item_id_fkey' then
        raise exception 'unexpected canonical deletion constraint: %', violation_constraint;
      end if;
  end;
end;
$$;

rollback;
