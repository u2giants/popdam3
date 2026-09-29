-- #3685: synthetic, rollback-only WildBrain durable entity state contracts.
-- No licensed value is used; every identity below is invented.

begin;

do $catalog$
declare v_table text;
begin
  foreach v_table in array array['wildbrain_entity_lifecycle','wildbrain_lifecycle_publication'] loop
    if not (select relrowsecurity from pg_class where oid = format('plm.%I', v_table)::regclass) then
      raise exception 'RLS is disabled for plm.%', v_table;
    end if;
    if has_table_privilege('anon', format('plm.%I', v_table), 'select')
       or not has_table_privilege('authenticated', format('plm.%I', v_table), 'select')
       or has_table_privilege('authenticated', format('plm.%I', v_table), 'insert')
       or has_table_privilege('service_role', format('plm.%I', v_table), 'insert')
       or has_table_privilege('service_role', format('plm.%I', v_table), 'update')
       or has_table_privilege('service_role', format('plm.%I', v_table), 'delete')
       or has_table_privilege('service_role', format('plm.%I', v_table), 'truncate')
       or has_table_privilege('authenticated', format('plm.%I', v_table), 'update')
       or has_table_privilege('authenticated', format('plm.%I', v_table), 'delete')
       or has_table_privilege('authenticated', format('plm.%I', v_table), 'truncate') then
      raise exception 'WildBrain lifecycle grants are incorrect for plm.%', v_table;
    end if;
  end loop;
  if has_function_privilege('anon', 'plm.wildbrain_publish_lifecycle(uuid)', 'execute')
     or has_function_privilege('authenticated', 'plm.wildbrain_publish_lifecycle(uuid)', 'execute')
     or not has_function_privilege('service_role', 'plm.wildbrain_publish_lifecycle(uuid)', 'execute') then
    raise exception 'WildBrain publish function execute grants are incorrect';
  end if;
end
$catalog$;

-- A..D complete; C uses another portal; E complete but short of its reported total
-- (partial coverage); R rejected (authentication loss); O older than A.
insert into plm.wildbrain_capture (id, capture_key, source_repository, source_commit_sha,
  source_manifest_sha256, portal_base_url, source_captured_at, status, load_completed_at,
  pagination_verified, reported_total, expected_counts, error_summary, raw_summary, created_by)
select v.id::uuid, 'contract:' || v.id, 'synthetic/repo', repeat('a', 40), repeat('b', 64),
       v.portal, v.at::timestamptz, v.status, case when v.status = 'complete' then now() end,
       v.status = 'complete', v.total, '{}'::jsonb,
       case when v.status = 'complete' then '[]' else '[{"code":"synthetic"}]' end::jsonb,
       '{}'::jsonb, 'contract'
  from (values
    ('36850000-0000-4000-8000-00000000000a', '2026-09-01T00:00:00Z', 'complete', 'https://p1.invalid', 2),
    ('36850000-0000-4000-8000-00000000000b', '2026-09-02T00:00:00Z', 'complete', 'https://p1.invalid', 1),
    ('36850000-0000-4000-8000-00000000000c', '2026-09-03T00:00:00Z', 'complete', 'https://p2.invalid', 3),
    ('36850000-0000-4000-8000-00000000000d', '2026-09-04T00:00:00Z', 'complete', 'https://p2.invalid', 1),
    ('36850000-0000-4000-8000-0000000000ee', '2026-09-05T00:00:00Z', 'complete', 'https://p2.invalid', 5),
    ('36850000-0000-4000-8000-0000000000ff', '2026-09-06T00:00:00Z', 'rejected', 'https://p2.invalid', 1),
    ('36850000-0000-4000-8000-000000000001', '2026-08-01T00:00:00Z', 'complete', 'https://p1.invalid', 0),
    ('36850000-0000-4000-8000-000000000006', '2026-09-07T00:00:00Z', 'complete', 'https://p2.invalid', 3)
  ) v(id, at, status, portal, total);

insert into plm.wildbrain_era (capture_id, era_source_id, era_label, normalized_era_label, is_root, raw)
select c::uuid, 'era-1', 'Era One', 'era one', true, '{}'::jsonb
  from unnest(array['36850000-0000-4000-8000-00000000000a','36850000-0000-4000-8000-00000000000b',
                    '36850000-0000-4000-8000-00000000000c','36850000-0000-4000-8000-00000000000d',
                    '36850000-0000-4000-8000-0000000000ee','36850000-0000-4000-8000-000000000006']) c;

insert into plm.wildbrain_asset (capture_id, asset_source_id, asset_uuid, asset_name, era_source_id,
  universe_label, source_hash, raw)
select v.cap::uuid, v.id, 'uuid-' || v.id, 'n', 'era-1', 'u', v.hash, '{}'::jsonb
  from (values
    ('36850000-0000-4000-8000-00000000000a', 'a-1', 'h1'),
    ('36850000-0000-4000-8000-00000000000a', 'a-2', 'h1'),
    ('36850000-0000-4000-8000-00000000000b', 'a-1', 'h2'),
    ('36850000-0000-4000-8000-00000000000c', 'a-2', 'h1'),
    ('36850000-0000-4000-8000-00000000000c', 'a-3', 'h1'),
    ('36850000-0000-4000-8000-00000000000c', 'a-4', 'h1'),
    ('36850000-0000-4000-8000-00000000000d', 'a-5', 'h1'),
    ('36850000-0000-4000-8000-0000000000ee', 'a-5', 'h1'),
    ('36850000-0000-4000-8000-000000000006', 'a-5', 'h1'),
    ('36850000-0000-4000-8000-000000000006', 'a-3', 'h1'),
    ('36850000-0000-4000-8000-000000000006', 'a-4', 'h1')
  ) v(cap, id, hash);

-- Inferred guides: A and B use different rule versions, so B must not withdraw A's guide.
insert into plm.wildbrain_guide (capture_id, guide_key, guide_label, normalized_guide_label, rule_version, raw)
values ('36850000-0000-4000-8000-00000000000a', 'guide a', 'Guide A', 'Guide A', 'rule@1', '{}'::jsonb),
       ('36850000-0000-4000-8000-00000000000b', 'guide b', 'Guide B', 'Guide B', 'rule@2', '{}'::jsonb);

set local role service_role;
do $refusals$
declare v_id text;
begin
  foreach v_id in array array['36850000-0000-4000-8000-0000000000ff','36850000-0000-4000-8000-0000000000ee'] loop
    begin
      perform plm.wildbrain_publish_lifecycle(v_id::uuid);
      raise exception 'publish accepted an unqualified capture %', v_id;
    exception when sqlstate '22023' then null;
    end;
  end loop;
  begin
    perform plm.wildbrain_publish_lifecycle('36850000-0000-4000-8000-00000000abcd');
    raise exception 'publish accepted an unknown capture';
  exception when sqlstate 'P0002' then null;
  end;
end
$refusals$;

select plm.wildbrain_publish_lifecycle('36850000-0000-4000-8000-00000000000a');
reset role;

do $bootstrap$
begin
  if (select mode from plm.wildbrain_lifecycle_publication where capture_id = '36850000-0000-4000-8000-00000000000a') <> 'bootstrap' then
    raise exception 'first publication is not a bootstrap';
  end if;
  if (select count(*) from plm.wildbrain_entity_lifecycle) <> 4 then
    raise exception 'bootstrap did not record two assets, one era and one guide';
  end if;
  if not exists (select 1 from pg_locks where locktype = 'advisory' and pid = pg_backend_pid() and granted
                 and objsubid = 1
                 and ((classid::bigint << 32) | objid::bigint) = hashtextextended('plm.wildbrain_publish_lifecycle', 0)) then
    raise exception 'publication did not hold its transaction advisory lock';
  end if;
end
$bootstrap$;

set local role service_role;
do $order$
begin
  begin
    perform plm.wildbrain_publish_lifecycle('36850000-0000-4000-8000-00000000000a');
    raise exception 'publish accepted a capture twice';
  exception when unique_violation then null;
  end;
  begin
    perform plm.wildbrain_publish_lifecycle('36850000-0000-4000-8000-000000000001');
    raise exception 'publish accepted an older capture';
  exception when sqlstate '22023' then null;
  end;
end
$order$;

-- B: comparable portal. a-2 is withdrawn; guide a is NOT (rule version changed).
select plm.wildbrain_publish_lifecycle('36850000-0000-4000-8000-00000000000b');
reset role;

do $comparable$
begin
  if (select mode from plm.wildbrain_lifecycle_publication where capture_id = '36850000-0000-4000-8000-00000000000b') <> 'comparable' then
    raise exception 'same portal did not compare';
  end if;
  if not exists (select 1 from plm.wildbrain_entity_lifecycle where entity_kind = 'asset' and entity_key = 'a-2'
                 and status = 'withdrawn' and first_withdrawn_at = '2026-09-02T00:00:00Z') then
    raise exception 'absent baseline asset was not withdrawn';
  end if;
  if not exists (select 1 from plm.wildbrain_entity_lifecycle where entity_kind = 'guide' and entity_key = 'guide a' and status = 'active') then
    raise exception 'an inferred guide was withdrawn across a rule-version change';
  end if;
  if not exists (select 1 from plm.wildbrain_entity_lifecycle where entity_key = 'a-1'
                 and last_changed_capture_id = '36850000-0000-4000-8000-00000000000b'
                 and first_seen_capture_id = '36850000-0000-4000-8000-00000000000a') then
    raise exception 'changed asset lost first sighting or change marker';
  end if;
end
$comparable$;

set local role service_role;
select plm.wildbrain_publish_lifecycle('36850000-0000-4000-8000-00000000000c');
reset role;

do $rebaseline$
begin
  if (select mode from plm.wildbrain_lifecycle_publication where capture_id = '36850000-0000-4000-8000-00000000000c') <> 'rebaseline' then
    raise exception 'different portal was compared';
  end if;
  if not exists (select 1 from plm.wildbrain_entity_lifecycle where entity_key = 'a-1' and status = 'active') then
    raise exception 'incomparable run withdrew an entity';
  end if;
  if not exists (select 1 from plm.wildbrain_entity_lifecycle where entity_key = 'a-2'
                 and status = 'active' and first_withdrawn_at = '2026-09-02T00:00:00Z') then
    raise exception 'reappearing asset was not reactivated with history kept';
  end if;
end
$rebaseline$;

set local role service_role;
select plm.wildbrain_publish_lifecycle('36850000-0000-4000-8000-00000000000d');
reset role;

do $held$
begin
  if (select mode from plm.wildbrain_lifecycle_publication where capture_id = '36850000-0000-4000-8000-00000000000d') <> 'withdrawal_held' then
    raise exception 'bulk drop was not held';
  end if;
  if exists (select 1 from plm.wildbrain_entity_lifecycle where withdrawn_capture_id = '36850000-0000-4000-8000-00000000000d') then
    raise exception 'held publication withdrew an entity';
  end if;
end
$held$;

-- After a held publication, the next comparable run re-evaluates the held drop instead
-- of orphaning it: a-2 was last seen before the hold and is now withdrawn.
set local role service_role;
select plm.wildbrain_publish_lifecycle('36850000-0000-4000-8000-000000000006');
reset role;

do $after_hold$
begin
  if (select mode from plm.wildbrain_lifecycle_publication where capture_id = '36850000-0000-4000-8000-000000000006') <> 'comparable' then
    raise exception 'run after a held publication did not compare';
  end if;
  if not exists (select 1 from plm.wildbrain_entity_lifecycle where entity_key = 'a-2'
                 and status = 'withdrawn' and withdrawn_capture_id = '36850000-0000-4000-8000-000000000006') then
    raise exception 'drop held earlier was orphaned instead of re-evaluated';
  end if;
  if not exists (select 1 from plm.wildbrain_entity_lifecycle where entity_key = 'a-5' and status = 'active') then
    raise exception 'entity seen after the hold is not active';
  end if;
end
$after_hold$;

-- Exact objects: column order, types and nullability, and named constraints, not just names that resolve.
do $exact$
begin
  if (select string_agg(attname || ':' || format_type(atttypid, atttypmod) || case when attnotnull then '!' else '' end, ',' order by attnum) from pg_attribute
       where attrelid = 'plm.wildbrain_entity_lifecycle'::regclass and attnum > 0 and not attisdropped)
     <> 'entity_kind:text!,entity_key:text!,first_seen_capture_id:uuid!,first_seen_at:timestamp with time zone!,last_seen_capture_id:uuid!,last_seen_at:timestamp with time zone!,last_changed_capture_id:uuid!,change_signal:text!,status:text!,withdrawn_at:timestamp with time zone,first_withdrawn_at:timestamp with time zone,withdrawn_capture_id:uuid' then
    raise exception 'plm.wildbrain_entity_lifecycle columns differ from the reviewed shape';
  end if;
  if (select string_agg(attname || ':' || format_type(atttypid, atttypmod) || case when attnotnull then '!' else '' end, ',' order by attnum) from pg_attribute
       where attrelid = 'plm.wildbrain_lifecycle_publication'::regclass and attnum > 0 and not attisdropped)
     <> 'capture_id:uuid!,baseline_capture_id:uuid,mode:text!,derivation_contract:text!,guide_rule_versions:text!,scope_sha256:text!,source_captured_at:timestamp with time zone!,counts:jsonb!,published_at:timestamp with time zone!' then
    raise exception 'plm.wildbrain_lifecycle_publication columns differ from the reviewed shape';
  end if;
  if (select count(*) from pg_constraint where conrelid = 'plm.wildbrain_entity_lifecycle'::regclass
       and conname in ('wildbrain_entity_lifecycle_pkey','wildbrain_entity_lifecycle_kind_chk','wildbrain_entity_lifecycle_status_chk',
                       'wildbrain_entity_lifecycle_withdrawn_at_chk','wildbrain_entity_lifecycle_history_chk')) <> 5
     or (select count(*) from pg_constraint where conrelid = 'plm.wildbrain_entity_lifecycle'::regclass
          and contype = 'f' and confrelid = 'plm.wildbrain_lifecycle_publication'::regclass) <> 4
     or (select count(*) from pg_constraint where conrelid = 'plm.wildbrain_lifecycle_publication'::regclass
          and conname in ('wildbrain_lifecycle_publication_pkey','wildbrain_lifecycle_publication_mode_chk',
                          'wildbrain_lifecycle_publication_baseline_chk','wildbrain_lifecycle_publication_scope_chk')) <> 4 then
    raise exception 'durable-state constraints differ from the reviewed shape';
  end if;
  if not (select prosecdef from pg_proc where oid = 'plm.wildbrain_publish_lifecycle(uuid)'::regprocedure) then
    raise exception 'publish function is not SECURITY DEFINER';
  end if;
  -- The pinned search_path is the security boundary of a SECURITY DEFINER function, and a
  -- body that writes tables must stay VOLATILE.
  if (select proconfig from pg_proc where oid = 'plm.wildbrain_publish_lifecycle(uuid)'::regprocedure)
       is distinct from array['search_path=pg_catalog, pg_temp']
     or (select provolatile from pg_proc where oid = 'plm.wildbrain_publish_lifecycle(uuid)'::regprocedure) <> 'v' then
    raise exception 'publish function search_path pin or volatility differs from the reviewed shape';
  end if;
  -- The upstream columns the publish function reads, pinned by exact type (review of PR
  -- #3731): a rename fails the fixture inserts, but a type change would not.
  if (select string_agg(table_name || '.' || column_name || '=' || data_type, ',' order by table_name, column_name)
        from information_schema.columns
       where table_schema = 'plm'
         and (table_name, column_name) in (
               ('wildbrain_capture','status'), ('wildbrain_capture','load_completed_at'),
               ('wildbrain_capture','error_summary'), ('wildbrain_capture','media_downloaded'),
               ('wildbrain_capture','pagination_verified'), ('wildbrain_capture','truncated_child_lists'),
               ('wildbrain_capture','reported_total'), ('wildbrain_capture','source_captured_at'),
               ('wildbrain_capture','portal_base_url'), ('wildbrain_guide','rule_version')))
     is distinct from (select string_agg(x, ',' order by x) from unnest(array[
       'wildbrain_capture.error_summary=jsonb', 'wildbrain_capture.load_completed_at=timestamp with time zone',
       'wildbrain_capture.media_downloaded=integer', 'wildbrain_capture.pagination_verified=boolean',
       'wildbrain_capture.portal_base_url=text', 'wildbrain_capture.reported_total=integer',
       'wildbrain_capture.source_captured_at=timestamp with time zone', 'wildbrain_capture.status=text',
       'wildbrain_capture.truncated_child_lists=integer', 'wildbrain_guide.rule_version=text']) x) then
    raise exception 'upstream columns read by the publish function differ from the reviewed types';
  end if;
  -- Return type and argument name, not just a signature that resolves (review of #3731).
  if (select prorettype::regtype::text || '|' || array_to_string(proargnames, ',') from pg_proc
       where oid = 'plm.wildbrain_publish_lifecycle(uuid)'::regprocedure)
     is distinct from 'jsonb|p_capture_id' then
    raise exception 'publish function return type or argument name differs from the reviewed shape';
  end if;
  -- Every named CHECK, by exact name and table, and nothing else.
  if (select string_agg(conname, ',' order by conname) from pg_constraint
       where conrelid = 'plm.wildbrain_entity_lifecycle'::regclass and contype = 'c')
     <> 'wildbrain_entity_lifecycle_history_chk,wildbrain_entity_lifecycle_key_chk,wildbrain_entity_lifecycle_kind_chk,wildbrain_entity_lifecycle_status_chk,wildbrain_entity_lifecycle_withdrawn_at_chk'
     or (select string_agg(conname, ',' order by conname) from pg_constraint
          where conrelid = 'plm.wildbrain_lifecycle_publication'::regclass and contype = 'c')
     <> 'wildbrain_lifecycle_publication_baseline_chk,wildbrain_lifecycle_publication_contract_chk,wildbrain_lifecycle_publication_counts_chk,wildbrain_lifecycle_publication_mode_chk,wildbrain_lifecycle_publication_scope_chk' then
    raise exception 'durable-state CHECK constraints differ from the reviewed shape';
  end if;
  -- Foreign keys by child column and parent, not just a count.
  if (select string_agg(format('%s:%s->%s', c.conrelid::regclass, a.attname, c.confrelid::regclass), ',' order by c.conrelid::regclass::text, a.attname)
        from pg_constraint c
        join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
       where c.contype = 'f' and cardinality(c.conkey) = 1
         and c.conrelid in ('plm.wildbrain_entity_lifecycle'::regclass, 'plm.wildbrain_lifecycle_publication'::regclass))
     <> 'plm.wildbrain_entity_lifecycle:first_seen_capture_id->plm.wildbrain_lifecycle_publication,'
        'plm.wildbrain_entity_lifecycle:last_changed_capture_id->plm.wildbrain_lifecycle_publication,'
        'plm.wildbrain_entity_lifecycle:last_seen_capture_id->plm.wildbrain_lifecycle_publication,'
        'plm.wildbrain_entity_lifecycle:withdrawn_capture_id->plm.wildbrain_lifecycle_publication,'
        'plm.wildbrain_lifecycle_publication:baseline_capture_id->plm.wildbrain_lifecycle_publication,'
        'plm.wildbrain_lifecycle_publication:capture_id->plm.wildbrain_capture' then
    raise exception 'durable-state foreign keys differ from the reviewed shape';
  end if;
  -- Serving indexes, by exact definition.
  if (select string_agg(indexname || '=' || regexp_replace(indexdef, '^.* USING ', ''), ';' order by indexname)
        from pg_indexes where schemaname = 'plm'
         and tablename in ('wildbrain_entity_lifecycle', 'wildbrain_lifecycle_publication'))
     <> 'wildbrain_entity_lifecycle_first_seen_idx=btree (first_seen_capture_id);'
        'wildbrain_entity_lifecycle_last_changed_idx=btree (last_changed_capture_id);'
        'wildbrain_entity_lifecycle_last_seen_idx=btree (last_seen_capture_id, entity_kind);'
        'wildbrain_entity_lifecycle_pkey=btree (entity_kind, entity_key);'
        'wildbrain_entity_lifecycle_withdrawn_idx=btree (withdrawn_capture_id) WHERE (withdrawn_capture_id IS NOT NULL);'
        'wildbrain_lifecycle_publication_baseline_idx=btree (baseline_capture_id) WHERE (baseline_capture_id IS NOT NULL);'
        'wildbrain_lifecycle_publication_latest_idx=btree (source_captured_at DESC, published_at DESC);'
        'wildbrain_lifecycle_publication_pkey=btree (capture_id)' then
    raise exception 'durable-state indexes differ from the reviewed shape';
  end if;
  -- Read policies: exactly one SELECT policy per table, for authenticated, with the house
  -- PLM / administrator / sales-licensing audience.
  if (select count(*) from pg_policies where schemaname = 'plm'
       and tablename in ('wildbrain_entity_lifecycle', 'wildbrain_lifecycle_publication')) <> 2
     or (select count(*) from pg_policies where schemaname = 'plm'
          and (tablename, policyname) in (('wildbrain_entity_lifecycle', 'wildbrain_entity_lifecycle_plm_read'),
                                          ('wildbrain_lifecycle_publication', 'wildbrain_lifecycle_publication_plm_read'))
          and cmd = 'SELECT' and permissive = 'PERMISSIVE' and roles = array['authenticated']::name[]
          and with_check is null
          and qual like '%has_app_access(''plm''%'
          and qual like '%has_role(''administrator''%'
          and qual like '%has_any_role(ARRAY[''sales''%''licensing''%') <> 2 then
    raise exception 'durable-state read policies differ from the reviewed shape';
  end if;
end
$exact$;

set local role service_role;
do $direct$
begin
  begin
    delete from plm.wildbrain_entity_lifecycle;
    raise exception 'service_role deleted lifecycle rows';
  exception when insufficient_privilege then null;
  end;
end
$direct$;
reset role;

do $constraint$
begin
  begin
    update plm.wildbrain_entity_lifecycle set status = 'withdrawn' where entity_key = 'a-5';
    raise exception 'withdrawn status without a withdrawal time was accepted';
  exception when check_violation then null;
  end;
end
$constraint$;

rollback;
