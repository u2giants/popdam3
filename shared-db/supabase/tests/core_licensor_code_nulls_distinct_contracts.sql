-- #1720: synthetic, rollback-only contract for core.licensor code uniqueness.

begin;

do $$
declare
  v_duplicate_rejected boolean := false;
  v_null_count integer;
begin
  if not exists (
    select 1
    from pg_constraint c
    join pg_index i on i.indexrelid = c.conindid
    where c.conrelid = 'core.licensor'::regclass
      and c.conname = 'licensor_code_key'
      and c.contype = 'u'
      and c.convalidated
      and not i.indnullsnotdistinct
      and (
        select array_agg(a.attname::text order by key_column.ordinality)
        from unnest(c.conkey) with ordinality as key_column(attnum, ordinality)
        join pg_attribute a
          on a.attrelid = c.conrelid
         and a.attnum = key_column.attnum
      ) = array['code']::text[]
  ) then
    raise exception 'licensor_code_key is not a validated NULLS DISTINCT unique constraint on code only';
  end if;

  if (
    select count(*)
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
      ) = array['code']::text[]
  ) <> 1 then
    raise exception 'expected exactly one unique constraint on core.licensor(code)';
  end if;

  insert into plm.licensing_write_authorization (
    backend_pid, transaction_id, target_table, write_kind, plan_id, plan_hash,
    actor, protected_columns, expires_at
  ) values (
    pg_backend_pid(), txid_current(), 'core.licensor', 'licensing_review_create',
    '17200000-0000-4000-8000-000000000001', repeat('1', 64),
    'issue-1720 synthetic contract', array['name','code','status'],
    clock_timestamp() + interval '1 minute'
  );
  insert into core.licensor (name, code, status)
  values ('ISSUE 1720 SYNTHETIC NULL A', null, 'potential');

  insert into plm.licensing_write_authorization (
    backend_pid, transaction_id, target_table, write_kind, plan_id, plan_hash,
    actor, protected_columns, expires_at
  ) values (
    pg_backend_pid(), txid_current(), 'core.licensor', 'licensing_review_create',
    '17200000-0000-4000-8000-000000000002', repeat('2', 64),
    'issue-1720 synthetic contract', array['name','code','status'],
    clock_timestamp() + interval '1 minute'
  );
  insert into core.licensor (name, code, status)
  values ('ISSUE 1720 SYNTHETIC NULL B', null, 'potential');

  select count(*) into v_null_count
  from core.licensor
  where name in ('ISSUE 1720 SYNTHETIC NULL A', 'ISSUE 1720 SYNTHETIC NULL B')
    and code is null;
  if v_null_count <> 2 then
    raise exception 'expected two synthetic NULL-coded Licensors, found %', v_null_count;
  end if;

  insert into plm.licensing_write_authorization (
    backend_pid, transaction_id, target_table, write_kind, plan_id, plan_hash,
    actor, protected_columns, expires_at
  ) values (
    pg_backend_pid(), txid_current(), 'core.licensor', 'licensing_review_create',
    '17200000-0000-4000-8000-000000000003', repeat('3', 64),
    'issue-1720 synthetic contract', array['name','code','status'],
    clock_timestamp() + interval '1 minute'
  );
  insert into core.licensor (name, code, status)
  values ('ISSUE 1720 SYNTHETIC KNOWN A', 'ISSUE1720KNOWN', 'potential');

  insert into plm.licensing_write_authorization (
    backend_pid, transaction_id, target_table, write_kind, plan_id, plan_hash,
    actor, protected_columns, expires_at
  ) values (
    pg_backend_pid(), txid_current(), 'core.licensor', 'licensing_review_create',
    '17200000-0000-4000-8000-000000000004', repeat('4', 64),
    'issue-1720 synthetic contract', array['name','code','status'],
    clock_timestamp() + interval '1 minute'
  );
  begin
    insert into core.licensor (name, code, status)
    values ('ISSUE 1720 SYNTHETIC KNOWN B', 'ISSUE1720KNOWN', 'potential');
  exception when unique_violation then
    v_duplicate_rejected := true;
  end;

  if not v_duplicate_rejected then
    raise exception 'duplicate non-NULL Licensor code was accepted';
  end if;
end;
$$;

rollback;

do $$
begin
  if exists (
    select 1 from core.licensor
    where name like 'ISSUE 1720 SYNTHETIC %'
  ) then
    raise exception 'rollback left a synthetic core.licensor fixture behind';
  end if;

  if exists (
    select 1 from plm.licensing_write_authorization
    where plan_id in (
      '17200000-0000-4000-8000-000000000001',
      '17200000-0000-4000-8000-000000000002',
      '17200000-0000-4000-8000-000000000003',
      '17200000-0000-4000-8000-000000000004'
    )
  ) then
    raise exception 'rollback left a synthetic licensing authorization behind';
  end if;
end;
$$;
