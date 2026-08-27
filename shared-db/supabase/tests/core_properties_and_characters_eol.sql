-- Issue #1684 Phase 1: reads remain available while every write verb fails closed.
begin;

do $contracts$
declare
  v_comment text;
  v_count bigint;
begin
  if to_regclass('core.properties_and_characters') is null then
    raise exception 'EOL staging removed the table before consumer cutover';
  end if;

  select obj_description('core.properties_and_characters'::regclass, 'pg_class')
  into v_comment;
  if v_comment not like 'EOL under issue #1684.%' then
    raise exception 'EOL catalog comment is absent or changed: %', v_comment;
  end if;

  if to_regprocedure('core.reject_properties_and_characters_write()') is null then
    raise exception 'EOL write-guard function is absent';
  end if;

  if not exists (
    select 1
    from pg_trigger
    where tgrelid = 'core.properties_and_characters'::regclass
      and tgname = 'properties_and_characters_eol_write_guard'
      and not tgisinternal
      and tgenabled = 'O'
      and (tgtype::integer & 62) = 62
      and (tgtype::integer & 1) = 0
  ) then
    raise exception 'enabled statement guard for all four write verbs is absent';
  end if;

  -- A read must still execute successfully even when the fixture is empty.
  select count(*) into v_count from core.properties_and_characters;

  begin
    insert into core.properties_and_characters default values;
    raise exception 'INSERT was not rejected';
  exception when sqlstate '55000' then null;
  end;

  begin
    update core.properties_and_characters set name = name where false;
    raise exception 'UPDATE was not rejected';
  exception when sqlstate '55000' then null;
  end;

  begin
    delete from core.properties_and_characters where false;
    raise exception 'DELETE was not rejected';
  exception when sqlstate '55000' then null;
  end;

  begin
    truncate table core.properties_and_characters cascade;
    raise exception 'TRUNCATE was not rejected';
  exception when sqlstate '55000' then null;
  end;
end
$contracts$;

rollback;
