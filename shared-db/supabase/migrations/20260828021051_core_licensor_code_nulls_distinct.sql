-- #1720 / claim #1726: an unknown Licensor code is not a canonical identity.
-- Keep known codes unique while allowing more than one row whose code is NULL.
-- This migration changes only the existing constraint; it does not change rows.

begin;

do $$
declare
  v_constraint_count integer;
  v_constraint_name text;
  v_nulls_not_distinct boolean;
begin
  select count(*), min(c.conname), bool_or(i.indnullsnotdistinct)
    into v_constraint_count, v_constraint_name, v_nulls_not_distinct
  from pg_constraint c
  join pg_index i on i.indexrelid = c.conindid
  where c.conrelid = 'core.licensor'::regclass
    and c.contype = 'u'
    and (
      select array_agg(a.attname::text order by key_column.ordinality)
      from unnest(c.conkey) with ordinality as key_column(attnum, ordinality)
      join pg_attribute a
        on a.attrelid = c.conrelid
       and a.attnum = key_column.attnum
    ) = array['code']::text[];

  if v_constraint_count <> 1 then
    raise exception
      'expected exactly one unique constraint on core.licensor(code), found %',
      v_constraint_count;
  end if;

  if v_constraint_name <> 'licensor_code_key' then
    raise exception
      'expected core.licensor(code) constraint licensor_code_key, found %',
      v_constraint_name;
  end if;

  if v_nulls_not_distinct then
    alter table core.licensor drop constraint licensor_code_key;
    alter table core.licensor
      add constraint licensor_code_key unique nulls distinct (code);
  end if;
end;
$$;

comment on constraint licensor_code_key on core.licensor is
  'NULL means the canonical Licensor code is unknown, so multiple NULL codes may coexist. Every known non-NULL code remains unique.';

commit;
