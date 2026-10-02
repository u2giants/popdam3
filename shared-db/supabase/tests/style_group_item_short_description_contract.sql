-- #3900: refresh_sku_human_description sources item_description from the
-- ColdLion Item Master (plm.item), falls back to style_tracker_rows, never
-- overwrites a human-entered description, and enqueues the PopDAM worker op.
-- Run inside begin; ... rollback; by database-contract-tests. All values ZZTEST.
do $$
declare
  v_bulk jsonb;
begin
  insert into plm.item (item_number, description, source_system, source_id)
  values ('ZZTEST-A1', 'Peanuts MDF wall plaque Snoopy 14x14"', 'zztest', 'zztest-a1');
  insert into public.style_tracker_rows (sku, description, source_sheet, tracker_type)
  values ('zztest-a1', 'sheet text that must lose', 'zztest', 'licensed'),
         ('ZZTEST-B2', 'sheet only text', 'zztest', 'licensed');
  insert into public.style_groups (sku, folder_path, item_description, item_description_source)
  values ('ZZTEST-A1', '/zztest/a1', null, null),
         ('ZZTEST-B2', '/zztest/b2', null, null),
         ('ZZTEST-C3', '/zztest/c3', 'human text', 'manual');
  insert into plm.item (item_number, description, source_system, source_id)
  values ('ZZTEST-C3', 'coldlion text must not overwrite', 'zztest', 'zztest-c3');

  perform public.refresh_sku_human_description();

  if (select item_description from public.style_groups where sku = 'ZZTEST-A1') is distinct from 'Peanuts MDF wall plaque Snoopy 14x14"'
     or (select item_description_source from public.style_groups where sku = 'ZZTEST-A1') is distinct from 'coldlion' then
    raise exception 'T1: Item Master description was not applied as coldlion';
  end if;
  if (select item_description_source from public.style_groups where sku = 'ZZTEST-B2') is distinct from 'master_data' then
    raise exception 'T2: sheet fallback not applied';
  end if;
  if (select item_description from public.style_groups where sku = 'ZZTEST-C3') is distinct from 'human text' then
    raise exception 'T3: human-entered description was overwritten';
  end if;
  if exists (select 1 from dam.sku_human_description where sku = 'zztest-a1') then
    raise exception 'T4: case-variant sheet row duplicated an Item Master sku';
  end if;
  select value into v_bulk from public.admin_config where key = 'BULK_OPERATIONS';
  if coalesce(v_bulk -> 'shorten-item-descriptions' ->> 'status', '') not in ('queued', 'running') then
    raise exception 'T5: shorten-item-descriptions was not enqueued';
  end if;

  -- T7: a queued/running op is never clobbered by a second refresh.
  perform public.refresh_sku_human_description();
  if (select value -> 'shorten-item-descriptions' ->> 'run_id' from public.admin_config where key = 'BULK_OPERATIONS')
     is distinct from (v_bulk -> 'shorten-item-descriptions' ->> 'run_id') then
    raise exception 'T7: a queued shorten-item-descriptions op was replaced';
  end if;

  -- T8: a manual short description is not stale, so it alone never enqueues.
  -- Only ZZTEST rows may be stale for this check, so mark every other coldlion
  -- group current, mark the one ZZTEST coldlion group manual, and clear the op.
  update public.style_groups set item_short_description_input = item_description
  where item_description_source = 'coldlion' and sku <> 'ZZTEST-A1';
  update public.style_groups set item_short_description = 'Hand label', item_short_description_source = 'manual'
  where sku = 'ZZTEST-A1';
  update public.admin_config set value = value - 'shorten-item-descriptions' where key = 'BULK_OPERATIONS';
  perform public.refresh_sku_human_description();
  if (select value ? 'shorten-item-descriptions' from public.admin_config where key = 'BULK_OPERATIONS') then
    raise exception 'T8: a manual short description was treated as stale and enqueued';
  end if;
  if (select item_short_description from public.style_groups where sku = 'ZZTEST-A1') is distinct from 'Hand label' then
    raise exception 'T8: manual short description was changed';
  end if;

  begin
    update public.style_groups set item_short_description_source = 'bogus' where sku = 'ZZTEST-A1';
    raise exception 'T6: invalid short description source accepted';
  exception when check_violation then null;
  end;
end;
$$;
