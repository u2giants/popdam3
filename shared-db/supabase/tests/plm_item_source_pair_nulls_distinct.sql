-- Contract for issue #652. Runs inside a transaction and leaves no rows behind.

begin;

do $$
declare
  v_constraint_count integer;
  v_nulls_not_distinct boolean;
  v_source_id text := 'issue-652-' || gen_random_uuid()::text;
begin
  select count(*), bool_or(i.indnullsnotdistinct)
    into v_constraint_count, v_nulls_not_distinct
  from pg_constraint c
  join pg_index i on i.indexrelid = c.conindid
  where c.conrelid = 'plm.item'::regclass
    and c.contype = 'u'
    and (
      select array_agg(a.attname::text order by a.attname)
      from unnest(c.conkey) key_column
      join pg_attribute a
        on a.attrelid = c.conrelid
       and a.attnum = key_column
    ) = array['source_id', 'source_system'];

  if v_constraint_count <> 1 or v_nulls_not_distinct is distinct from false then
    raise exception
      'expected exactly one NULLS DISTINCT unique constraint on plm.item(source_system, source_id)';
  end if;

  insert into plm.item (item_number) values ('issue-652-source-less-a');
  insert into plm.item (item_number) values ('issue-652-source-less-b');

  insert into plm.item (item_number, source_system, source_id)
  values ('issue-652-sourced-a', 'issue-652-contract', v_source_id);

  begin
    insert into plm.item (item_number, source_system, source_id)
    values ('issue-652-sourced-duplicate', 'issue-652-contract', v_source_id);
    raise exception 'duplicate external source identity was accepted';
  exception
    when unique_violation then
      null;
  end;
end;
$$;

rollback;
