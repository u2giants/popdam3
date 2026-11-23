begin;

do $test$
declare
  chosen_depth uuid := gen_random_uuid();
  retired_depth uuid := gen_random_uuid();
  tracker_row uuid;
  sheet_type text;
begin
  insert into core.product_depth (id, code, label, status)
  values
    (chosen_depth, chosen_depth::text, 'Depth contract test', 'active'),
    (retired_depth, retired_depth::text, 'Retired Depth contract test', 'inactive');

  foreach sheet_type in array array['licensed', 'generic'] loop
    insert into public.style_tracker_rows (source_sheet, tracker_type, staged_product_depth_id)
    values ('Depth contract test', sheet_type, chosen_depth)
    returning id into tracker_row;

    if not exists (
      select 1 from api.style_tracker_staged_product_depth
      where tracker_row_id = tracker_row and product_depth_id = chosen_depth
        and label = 'Depth contract test' and selectable
    ) then
      raise exception 'The staged Depth cannot be read for the % sheet.', sheet_type;
    end if;

    begin
      update public.style_tracker_rows
      set staged_product_depth_id = retired_depth where id = tracker_row;
      raise exception 'An inactive Depth was accepted on the % sheet.', sheet_type;
    exception when check_violation then
      null;
    end;

    update core.product_depth set status = 'inactive' where id = chosen_depth;
    update public.style_tracker_rows
    set staged_product_depth_id = chosen_depth where id = tracker_row;
    if not exists (
      select 1 from api.style_tracker_staged_product_depth
      where tracker_row_id = tracker_row and product_depth_id = chosen_depth and not selectable
    ) then
      raise exception 'An existing retired Depth was not retained for the % sheet.', sheet_type;
    end if;

    update public.style_tracker_rows
    set staged_product_depth_id = null where id = tracker_row;
    if exists (select 1 from api.style_tracker_staged_product_depth where tracker_row_id = tracker_row) then
      raise exception 'The cleared Depth was still visible for the % sheet.', sheet_type;
    end if;
    update core.product_depth set status = 'active' where id = chosen_depth;
  end loop;

  if not has_table_privilege('authenticated', 'api.style_tracker_staged_product_depth', 'SELECT')
    or has_table_privilege('anon', 'api.style_tracker_staged_product_depth', 'SELECT') then
    raise exception 'The staged Depth view has unexpected permissions.';
  end if;
end;
$test$;

rollback;
