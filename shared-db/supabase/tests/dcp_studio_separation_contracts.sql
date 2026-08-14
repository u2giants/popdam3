\set ON_ERROR_STOP on

begin;

do $$
declare
  v_prefix text;
  v_expected_source text;
  v_other_source text;
  v_before bigint;
  v_after bigint;
  v_sql text;
  v_rejected boolean;
  v_table_name text;
  v_before_inventory jsonb;
  v_after_inventory jsonb;
begin
  foreach v_prefix in array array[
    'lucasfilm_dcp', 'marvel_dcp', 'twentieth_century_dcp'
  ] loop
    v_expected_source := case v_prefix
      when 'lucasfilm_dcp' then 'lucasfilm_dcpvault'
      when 'marvel_dcp' then 'marvel_dcpvault'
      else 'twentieth_century_dcpvault'
    end;
    v_other_source := case v_prefix
      when 'lucasfilm_dcp' then 'marvel_dcpvault'
      else 'lucasfilm_dcpvault'
    end;

    v_before_inventory := '{}'::jsonb;
    for v_table_name in
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'plm' and c.relkind = 'r'
        and c.relname like v_prefix || '\_%' escape chr(92)
      order by c.relname
    loop
      execute format('select count(*) from plm.%I', v_table_name) into v_before;
      v_before_inventory := v_before_inventory || jsonb_build_object(v_table_name, v_before);
    end loop;

    v_rejected := false;
    begin
      v_sql := format(
        $sql$select plm.begin_%I_crawl(
          $1, date '2099-01-01', 'https://synthetic.invalid', 'synthetic',
          'synthetic', 'synthetic', 'synthetic', repeat('a', 40), 1, 1, null
        )$sql$,
        v_prefix
      );
      execute v_sql using v_other_source;
    exception when sqlstate 'P0001' then
      v_rejected := position('source_system' in sqlerrm) > 0;
    end;
    if not v_rejected then raise exception 'cross-studio source_system unexpectedly accepted for %', v_prefix; end if;

    v_rejected := false;
    begin
      execute v_sql using null::text;
    exception when sqlstate 'P0001' then
      v_rejected := position('source_system' in sqlerrm) > 0;
    end;
    if not v_rejected then raise exception 'missing source_system unexpectedly accepted for %', v_prefix; end if;

    v_rejected := false;
    begin
      execute v_sql using 'synthetic_unknown_studio';
    exception when sqlstate 'P0001' then
      v_rejected := position('source_system' in sqlerrm) > 0;
    end;
    if not v_rejected then raise exception 'unknown source_system unexpectedly accepted for %', v_prefix; end if;

    v_rejected := false;
    begin
      execute v_sql using 'avatar_dcpvault';
    exception when sqlstate 'P0001' then
      v_rejected := position('source_system' in sqlerrm) > 0;
    end;
    if not v_rejected then raise exception 'unassigned Avatar source unexpectedly accepted for %', v_prefix; end if;

    foreach v_sql in array array[
      format('select plm.load_%I_asset_chunk($1, ''00000000-0000-0000-0000-000000000000''::uuid, 1, ''[]'', repeat(''0'',64))', v_prefix),
      format('select plm.begin_%I_metadata_run($1, ''00000000-0000-0000-0000-000000000000''::uuid, date ''2099-01-01'', ''/synthetic'', ''synthetic'', ''synthetic'', repeat(''a'',40), ''{}''::jsonb)', v_prefix),
      format('select plm.load_%I_metadata_chunk($1, ''00000000-0000-0000-0000-000000000000''::uuid, 1, ''[]'', repeat(''0'',64))', v_prefix)
    ] loop
      v_rejected := false;
      begin
        execute v_sql using v_other_source;
      exception when sqlstate 'P0001' then
        v_rejected := position('source_system' in sqlerrm) > 0;
      end;
      if not v_rejected then
        raise exception 'cross-studio guarded operation unexpectedly accepted for %', v_prefix;
      end if;
    end loop;

    v_after_inventory := '{}'::jsonb;
    for v_table_name in
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'plm' and c.relkind = 'r'
        and c.relname like v_prefix || '\_%' escape chr(92)
      order by c.relname
    loop
      execute format('select count(*) from plm.%I', v_table_name) into v_after;
      v_after_inventory := v_after_inventory || jsonb_build_object(v_table_name, v_after);
    end loop;
    if v_after_inventory <> v_before_inventory then
      raise exception 'studio mismatch guard changed Phase 1 or Phase 2 inventory for %', v_prefix;
    end if;

    if exists (
      select 1
      from pg_constraint c
      join pg_class child on child.oid = c.conrelid
      join pg_namespace child_ns on child_ns.oid = child.relnamespace
      join pg_class parent on parent.oid = c.confrelid
      join pg_namespace parent_ns on parent_ns.oid = parent.relnamespace
      where c.contype = 'f'
        and child_ns.nspname = 'plm'
        and child.relname like v_prefix || '\_%' escape chr(92)
        and not (
          (parent_ns.nspname = 'plm'
            and parent.relname like v_prefix || '\_%' escape chr(92))
          or (parent_ns.nspname = 'core' and (
            (child.relname = v_prefix || '_style_guide' and parent.relname = 'style_guide')
            or (child.relname = v_prefix || '_portal_tile' and parent.relname = 'property')
            or (child.relname = v_prefix || '_property' and parent.relname = 'property')
            or (child.relname = v_prefix || '_character' and parent.relname = 'character')
          ))
        )
    ) then
      raise exception 'family-local foreign-key closure failed for %', v_prefix;
    end if;

    if not exists (
      select 1 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'plm'
        and p.proname = 'begin_' || v_prefix || '_crawl'
        and pg_get_functiondef(p.oid) like '%' || v_expected_source || '%'
    ) then
      raise exception 'expected studio discriminator missing for %', v_prefix;
    end if;
  end loop;
end
$$;

do $$
declare
  v_disney_function_count integer;
  v_table_name text;
  v_constraint_count integer;
begin
  select count(*) into v_disney_function_count
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'plm'
    and p.proname in (
      'begin_dcp_crawl', 'load_dcp_asset_chunk', 'finalize_dcp_crawl',
      'begin_dcp_metadata_run', 'load_dcp_metadata_chunk', 'finalize_dcp_metadata_run'
    );
  if v_disney_function_count <> 6 then
    raise exception 'Disney compatibility function inventory changed';
  end if;

  foreach v_table_name in array array[
    'dcp_crawl', 'dcp_portal_tile', 'dcp_style_guide', 'dcp_asset',
    'dcp_property', 'dcp_character', 'dcp_term'
  ] loop
    select count(*) into v_constraint_count
    from pg_constraint c
    where c.conrelid = format('plm.%I', v_table_name)::regclass
      and c.contype = 'c'
      and c.convalidated
      and pg_get_constraintdef(c.oid) like '%source_system%disney_dcpvault%';
    if v_constraint_count = 0 then
      raise exception 'Disney-only source constraint missing on %', v_table_name;
    end if;
  end loop;

  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'plm' and c.relkind = 'r'
      and (c.relname like 'lucasfilm_dcp\_%' escape chr(92)
        or c.relname like 'marvel_dcp\_%' escape chr(92)
        or c.relname like 'twentieth_century_dcp\_%' escape chr(92))
      and has_table_privilege('service_role', c.oid, 'INSERT')
  ) then
    raise exception 'service_role may not directly insert into studio landing tables';
  end if;
end
$$;

rollback;

select 'DCP_STUDIO_SEPARATION_CONTRACTS_OK' as result;
