-- Issue #2622: ColdLion merchandise-group details are category-scoped.
-- The source currently contains distinct rows that share the former
-- (company, division, type, code) key and differ by category. Preserve those
-- rows by making category part of the durable identity. The existing header
-- relationship remains the three-column company/division/type foreign key.

do $$
declare
  v_primary_key text;
  v_incoming_foreign_keys text;
begin
  if to_regclass('coldlion.merch_group_detail') is null then
    raise exception 'coldlion.merch_group_detail must exist before its identity can be repaired';
  end if;

  select pg_get_constraintdef(oid)
    into v_primary_key
  from pg_constraint
  where conrelid = 'coldlion.merch_group_detail'::regclass
    and contype = 'p';

  if v_primary_key is distinct from
       'PRIMARY KEY (company_code, division_code, mg_type_code, mg_code)' then
    raise exception 'unexpected coldlion.merch_group_detail primary key: %',
      coalesce(v_primary_key, '<none>');
  end if;

  if exists (
    select 1
    from coldlion.merch_group_detail
    where mg_category is null
  ) then
    raise exception 'cannot repair merchandise-group detail identity: existing mg_category is null';
  end if;

  if exists (
    select 1
    from coldlion.merch_group_detail
    group by company_code, division_code, mg_type_code, mg_category, mg_code
    having count(*) > 1
  ) then
    raise exception 'cannot repair merchandise-group detail identity: duplicate five-part identity exists';
  end if;

  select string_agg(format('%I.%I constraint %I', n.nspname, c.relname, con.conname), ', ')
    into v_incoming_foreign_keys
  from pg_constraint con
  join pg_class c on c.oid = con.conrelid
  join pg_namespace n on n.oid = c.relnamespace
  where con.contype = 'f'
    and con.confrelid = 'coldlion.merch_group_detail'::regclass;

  if v_incoming_foreign_keys is not null then
    raise exception 'obsolete four-part identity still has dependent foreign keys: %',
      v_incoming_foreign_keys;
  end if;
end
$$;

alter table coldlion.merch_group_detail
  alter column mg_category set not null;

alter table coldlion.merch_group_detail
  drop constraint merch_group_detail_pkey,
  add constraint merch_group_detail_pkey
    primary key (company_code, division_code, mg_type_code, mg_category, mg_code);

comment on table coldlion.merch_group_detail is
  'Current ColdLion merchandise-group details. Identity is company, division, merchandise-group type, category, and code; category is required because the source reuses codes within a type.';
