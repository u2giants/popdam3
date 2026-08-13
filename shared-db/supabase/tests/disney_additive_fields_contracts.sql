\set ON_ERROR_STOP on

begin;

do $$
declare
  v_nullable text;
  v_fk_count integer;
begin
  select is_nullable into v_nullable
  from information_schema.columns
  where table_schema = 'dam'
    and table_name = 'style_guide_file'
    and column_name = 'style_guide_id';

  if v_nullable is distinct from 'YES' then
    raise exception 'dam.style_guide_file.style_guide_id must exist and remain nullable';
  end if;

  select count(*) into v_fk_count
  from pg_constraint c
  where c.conrelid = 'dam.style_guide_file'::regclass
    and c.contype = 'f'
    and pg_get_constraintdef(c.oid) =
      'FOREIGN KEY (style_guide_id) REFERENCES core.style_guide(id) ON DELETE SET NULL';

  if v_fk_count <> 1 then
    raise exception 'style_guide_id must have exactly one FK to core.style_guide with ON DELETE SET NULL';
  end if;
end
$$;

do $$
declare
  v_missing integer;
  v_nonnullable integer;
  v_wrong_type integer;
begin
  select count(*) into v_missing
  from (values ('regionName'), ('templateId'), ('workflowId')) expected(column_name)
  where not exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'plm'
      and c.table_name = 'opa_property_character'
      and c.column_name = expected.column_name
  );

  select count(*) into v_nonnullable
  from information_schema.columns
  where table_schema = 'plm'
    and table_name = 'opa_property_character'
    and column_name in ('regionName', 'templateId', 'workflowId')
    and is_nullable <> 'YES';

  select count(*) into v_wrong_type
  from information_schema.columns
  where table_schema = 'plm'
    and table_name = 'opa_property_character'
    and (
      (column_name = 'regionName' and data_type <> 'text')
      or (column_name in ('templateId', 'workflowId') and data_type <> 'bigint')
    );

  if v_missing <> 0 or v_nonnullable <> 0 or v_wrong_type <> 0 then
    raise exception 'OPA selector columns must exist with nullable text/bigint types';
  end if;
end
$$;

rollback;
