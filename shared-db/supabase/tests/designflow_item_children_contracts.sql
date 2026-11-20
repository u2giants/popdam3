-- Disposable database contract test for #4707. The test harness rolls back.
do $$
declare
  item_uuid uuid := gen_random_uuid();
  group_uuid uuid := gen_random_uuid();
  child_table regclass;
begin
  insert into plm.item (id, source_system, source_id)
    values (item_uuid, 'contract-fixture', item_uuid::text);
  insert into core.merch_group (id, code, name, level)
    values (group_uuid, group_uuid::text, 'Contract fixture', 1);

  insert into plm.item_merch_group
    (item_id, slot_number, merch_group_id, legacy_merch_group_id, legacy_code, resolution)
  values
    (item_uuid, 1, group_uuid, null, null, 'resolved'),
    (item_uuid, 3, null, 147, null, 'held_ambiguous'),
    (item_uuid, 5, null, null, 'TEST', 'code_only');
  begin
    insert into plm.item_merch_group
      (item_id, slot_number, merch_group_id, legacy_merch_group_id, resolution)
    values (item_uuid, 2, group_uuid, 147, 'held_unmatched');
    raise exception 'a held slot linked to a canonical group';
  exception when check_violation then
    null;
  end;
  begin
    insert into plm.item_merch_group (item_id, slot_number, resolution)
      values (item_uuid, 2, 'resolved');
    raise exception 'a resolved slot had no canonical group';
  exception when check_violation then
    null;
  end;
  begin
    insert into plm.item_merch_group (item_id, slot_number, legacy_code, resolution)
      values (item_uuid, 5, 'DUPLICATE', 'code_only');
    raise exception 'more than one value fit an item and slot';
  exception when unique_violation then
    null;
  end;

  insert into plm.item_custom_value (item_id, slot_kind, slot_number, text_value)
    values (item_uuid, 'freeform', 1, 'example'), (item_uuid, 'number_text', 1, '0001');
  insert into plm.item_custom_value (item_id, slot_kind, slot_number, numeric_value)
    values (item_uuid, 'number', 1, 0);
  insert into plm.item_custom_value (item_id, slot_kind, slot_number, date_value)
    values (item_uuid, 'date', 1, '2026-11-20 12:34:56');
  begin
    insert into plm.item_custom_value (item_id, slot_kind, slot_number, text_value, integer_value)
      values (item_uuid, 'freeform', 2, 'two values', 9);
    raise exception 'a custom slot accepted two values';
  exception when check_violation then
    null;
  end;
  begin
    insert into plm.item_custom_value (item_id, slot_kind, slot_number, text_value)
      values (item_uuid, 'date', 2, 'invalid');
    raise exception 'a date slot accepted a text value';
  exception when check_violation then
    null;
  end;

  insert into plm.item_price (item_id, price_level, amount)
    values (item_uuid, 'A', 0), (item_uuid, 'H', -1.05);
  begin
    insert into plm.item_price (item_id, price_level, amount)
      values (item_uuid, 'I', 15);
    raise exception 'invalid price level accepted';
  exception when check_violation then
    null;
  end;

  foreach child_table in array array[
    'plm.item_merch_group'::regclass,
    'plm.item_custom_value'::regclass,
    'plm.item_price'::regclass
  ]
  loop
    if not (select relrowsecurity from pg_class where oid = child_table)
       or has_table_privilege('anon', child_table, 'SELECT,INSERT,UPDATE,DELETE')
       or has_table_privilege('authenticated', child_table, 'SELECT,INSERT,UPDATE,DELETE') then
      raise exception '% does not have the intended default access boundary', child_table;
    end if;
  end loop;

  delete from plm.item where id = item_uuid;
  if exists (select from plm.item_merch_group where item_id = item_uuid)
     or exists (select from plm.item_custom_value where item_id = item_uuid)
     or exists (select from plm.item_price where item_id = item_uuid) then
    raise exception 'deleting the test item left orphaned child rows';
  end if;
end
$$;
