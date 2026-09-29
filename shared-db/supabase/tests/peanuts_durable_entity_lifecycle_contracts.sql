-- #3684: synthetic, rollback-only Peanuts durable entity state contracts.
-- No licensed value is used; every identity below is invented.

begin;

do $catalog$
declare v_table text;
begin
  foreach v_table in array array['peanuts_entity_lifecycle','peanuts_lifecycle_publication'] loop
    if not (select relrowsecurity from pg_class where oid = format('plm.%I', v_table)::regclass) then
      raise exception 'RLS is disabled for plm.%', v_table;
    end if;
    if has_table_privilege('anon', format('plm.%I', v_table), 'select')
       or not has_table_privilege('authenticated', format('plm.%I', v_table), 'select')
       or has_table_privilege('authenticated', format('plm.%I', v_table), 'insert')
       or has_table_privilege('service_role', format('plm.%I', v_table), 'insert')
       or has_table_privilege('service_role', format('plm.%I', v_table), 'update')
       or has_table_privilege('service_role', format('plm.%I', v_table), 'delete') then
      raise exception 'Peanuts lifecycle grants are incorrect for plm.%', v_table;
    end if;
  end loop;
  if has_function_privilege('anon', 'plm.peanuts_publish_lifecycle(uuid)', 'execute')
     or has_function_privilege('authenticated', 'plm.peanuts_publish_lifecycle(uuid)', 'execute')
     or not has_function_privilege('service_role', 'plm.peanuts_publish_lifecycle(uuid)', 'execute') then
    raise exception 'Peanuts publish function execute grants are incorrect';
  end if;
end
$catalog$;

-- A..D complete zero-failure captures; C uses another customer account; U complete but
-- with one unreachable asset (partial coverage); R rejected (authentication loss);
-- O older than A.
insert into plm.peanuts_capture (id, capture_key, source_repository, source_commit_sha,
  source_manifest_sha256, portal_base_url, api_endpoint, source_customer_id, source_captured_at,
  status, load_completed_at, expected_counts, portal_reported_asset_total, assets_captured,
  assets_unreachable, deep_paging_partitioned, vocabularies_loaded_from_source,
  error_summary, raw_summary, created_by)
select v.id::uuid, 'contract:' || v.id, 'synthetic/repo', repeat('a', 40), repeat('b', 64),
       'https://example.invalid', 'https://example.invalid/api', v.customer, v.at::timestamptz,
       v.status, case when v.status = 'complete' then now() end, '{}'::jsonb,
       v.total, v.captured, v.total - v.captured, true, true,
       case when v.status = 'complete' then '[]' else '[{"code":"synthetic"}]' end::jsonb,
       '{}'::jsonb, 'contract'
  from (values
    ('36840000-0000-4000-8000-00000000000a', '2026-09-01T00:00:00Z', 'complete', 'cust-1', 2, 2),
    ('36840000-0000-4000-8000-00000000000b', '2026-09-02T00:00:00Z', 'complete', 'cust-1', 1, 1),
    ('36840000-0000-4000-8000-00000000000c', '2026-09-03T00:00:00Z', 'complete', 'cust-2', 3, 3),
    ('36840000-0000-4000-8000-00000000000d', '2026-09-04T00:00:00Z', 'complete', 'cust-2', 1, 1),
    ('36840000-0000-4000-8000-0000000000ee', '2026-09-05T00:00:00Z', 'complete', 'cust-2', 2, 1),
    ('36840000-0000-4000-8000-0000000000ff', '2026-09-06T00:00:00Z', 'rejected', 'cust-2', 1, 0),
    ('36840000-0000-4000-8000-000000000001', '2026-08-01T00:00:00Z', 'complete', 'cust-1', 0, 0),
    ('36840000-0000-4000-8000-000000000006', '2026-09-07T00:00:00Z', 'complete', 'cust-2', 3, 3)
  ) v(id, at, status, customer, total, captured);

insert into plm.peanuts_asset (capture_id, source_object_id, file_name, checksum, raw)
select v.cap::uuid, v.obj, 'f', v.sum, '{}'::jsonb
  from (values
    ('36840000-0000-4000-8000-00000000000a', 'obj-1', 's1'),
    ('36840000-0000-4000-8000-00000000000a', 'obj-2', 's1'),
    ('36840000-0000-4000-8000-00000000000b', 'obj-1', 's2'),
    ('36840000-0000-4000-8000-00000000000c', 'obj-2', 's1'),
    ('36840000-0000-4000-8000-00000000000c', 'obj-3', 's1'),
    ('36840000-0000-4000-8000-00000000000c', 'obj-4', 's1'),
    ('36840000-0000-4000-8000-00000000000d', 'obj-5', 's1'),
    ('36840000-0000-4000-8000-0000000000ee', 'obj-5', 's1'),
    ('36840000-0000-4000-8000-000000000006', 'obj-5', 's1'),
    ('36840000-0000-4000-8000-000000000006', 'obj-3', 's1'),
    ('36840000-0000-4000-8000-000000000006', 'obj-4', 's1')
  ) v(cap, obj, sum);

insert into plm.peanuts_art_program (capture_id, value_key, value_label, source_field_name,
  source_field_label, is_multi_select, asset_count, raw)
values ('36840000-0000-4000-8000-00000000000a', 'program-a', 'Program A', 'f', 'F', true, 0, '{}'::jsonb);
insert into plm.peanuts_initiative (capture_id, value_key, value_label, source_field_name,
  source_field_label, is_multi_select, asset_count, raw)
values ('36840000-0000-4000-8000-00000000000a', 'initiative-a', 'Initiative A', 'f', 'F', false, 0, '{}'::jsonb);

set local role service_role;
do $refusals$
declare v_id text;
begin
  foreach v_id in array array['36840000-0000-4000-8000-0000000000ff','36840000-0000-4000-8000-0000000000ee'] loop
    begin
      perform plm.peanuts_publish_lifecycle(v_id::uuid);
      raise exception 'publish accepted an unqualified capture %', v_id;
    exception when sqlstate '22023' then null;
    end;
  end loop;
  begin
    perform plm.peanuts_publish_lifecycle('36840000-0000-4000-8000-00000000abcd');
    raise exception 'publish accepted an unknown capture';
  exception when sqlstate 'P0002' then null;
  end;
end
$refusals$;

select plm.peanuts_publish_lifecycle('36840000-0000-4000-8000-00000000000a');
reset role;

do $bootstrap$
begin
  if (select mode from plm.peanuts_lifecycle_publication where published_capture_id = '36840000-0000-4000-8000-00000000000a') <> 'bootstrap' then
    raise exception 'first publication is not a bootstrap';
  end if;
  if (select count(*) from plm.peanuts_entity_lifecycle) <> 4 then
    raise exception 'bootstrap did not record two assets, one art program and one initiative';
  end if;
  if not exists (select 1 from pg_locks where locktype = 'advisory' and pid = pg_backend_pid() and granted
                 and objsubid = 1
                 and classid::bigint = ((hashtextextended('plm.peanuts_publish_lifecycle', 0) >> 32) & 4294967295)
                 and objid::bigint = (hashtextextended('plm.peanuts_publish_lifecycle', 0) & 4294967295)) then
    raise exception 'publication did not hold its transaction advisory lock';
  end if;
end
$bootstrap$;

set local role service_role;
do $order$
begin
  begin
    perform plm.peanuts_publish_lifecycle('36840000-0000-4000-8000-00000000000a');
    raise exception 'publish accepted a capture twice';
  exception when unique_violation then null;
  end;
  begin
    perform plm.peanuts_publish_lifecycle('36840000-0000-4000-8000-000000000001');
    raise exception 'publish accepted an older capture';
  exception when sqlstate '22023' then null;
  end;
end
$order$;

-- B: comparable. obj-2 and the art program are withdrawn; the initiative is retired.
select plm.peanuts_publish_lifecycle('36840000-0000-4000-8000-00000000000b');
reset role;

do $comparable$
begin
  if (select mode from plm.peanuts_lifecycle_publication where published_capture_id = '36840000-0000-4000-8000-00000000000b') <> 'comparable' then
    raise exception 'same account did not compare';
  end if;
  if not exists (select 1 from plm.peanuts_entity_lifecycle where entity_kind = 'asset' and entity_key = 'obj-2'
                 and status = 'withdrawn' and first_withdrawn_at = '2026-09-02T00:00:00Z') then
    raise exception 'absent baseline asset was not withdrawn';
  end if;
  if not exists (select 1 from plm.peanuts_entity_lifecycle where entity_kind = 'art_program' and status = 'withdrawn') then
    raise exception 'absent art program was not withdrawn';
  end if;
  if not exists (select 1 from plm.peanuts_entity_lifecycle where entity_kind = 'initiative'
                 and status = 'retired' and retired_at is not null and withdrawn_at is null) then
    raise exception 'absent initiative was not retired (owner ruling 6.20)';
  end if;
  if not exists (select 1 from plm.peanuts_entity_lifecycle where entity_key = 'obj-1'
                 and last_changed_capture_id = '36840000-0000-4000-8000-00000000000b'
                 and first_seen_capture_id = '36840000-0000-4000-8000-00000000000a') then
    raise exception 'changed asset lost first sighting or change marker';
  end if;
end
$comparable$;

-- C: another customer account; obj-2 reappears, obj-1 is not withdrawn.
set local role service_role;
select plm.peanuts_publish_lifecycle('36840000-0000-4000-8000-00000000000c');
reset role;

do $rebaseline$
begin
  if (select mode from plm.peanuts_lifecycle_publication where published_capture_id = '36840000-0000-4000-8000-00000000000c') <> 'rebaseline' then
    raise exception 'different account was compared';
  end if;
  if not exists (select 1 from plm.peanuts_entity_lifecycle where entity_key = 'obj-1' and status = 'active') then
    raise exception 'incomparable run withdrew an entity';
  end if;
  if not exists (select 1 from plm.peanuts_entity_lifecycle where entity_key = 'obj-2'
                 and status = 'active' and first_withdrawn_at = '2026-09-02T00:00:00Z') then
    raise exception 'reappearing asset was not reactivated with history kept';
  end if;
end
$rebaseline$;

-- D: comparable with C but drops three of three baseline assets: held.
set local role service_role;
select plm.peanuts_publish_lifecycle('36840000-0000-4000-8000-00000000000d');
reset role;

do $held$
begin
  if (select mode from plm.peanuts_lifecycle_publication where published_capture_id = '36840000-0000-4000-8000-00000000000d') <> 'withdrawal_held' then
    raise exception 'bulk drop was not held';
  end if;
  if exists (select 1 from plm.peanuts_entity_lifecycle where withdrawn_capture_id = '36840000-0000-4000-8000-00000000000d') then
    raise exception 'held publication withdrew an entity';
  end if;
end
$held$;

-- After a held publication, the next comparable run re-evaluates the held drop instead
-- of orphaning it: obj-2 was last seen before the hold and is now withdrawn.
set local role service_role;
select plm.peanuts_publish_lifecycle('36840000-0000-4000-8000-000000000006');
reset role;

do $after_hold$
begin
  if (select mode from plm.peanuts_lifecycle_publication where published_capture_id = '36840000-0000-4000-8000-000000000006') <> 'comparable' then
    raise exception 'run after a held publication did not compare';
  end if;
  if not exists (select 1 from plm.peanuts_entity_lifecycle where entity_key = 'obj-2'
                 and status = 'withdrawn' and withdrawn_capture_id = '36840000-0000-4000-8000-000000000006') then
    raise exception 'drop held earlier was orphaned instead of re-evaluated';
  end if;
  if not exists (select 1 from plm.peanuts_entity_lifecycle where entity_key = 'obj-5' and status = 'active') then
    raise exception 'entity seen after the hold is not active';
  end if;
end
$after_hold$;

-- Exact objects (review of #3730, B1/M2/M3). Every expected string below is the text
-- PostgreSQL itself stores and renders (format_type, pg_get_expr, pg_get_constraintdef,
-- pg_get_indexdef, pg_policies.qual), captured from an ephemeral database with this
-- migration applied -- not a hand-written approximation. Rewriting any check to
-- `check (true)`, dropping a NOT NULL or a default, reordering an index or changing a
-- policy predicate turns this block red and prints what the catalog now holds.
do $exact$
declare
  v_got text;
begin
  -- plm.peanuts_entity_lifecycle: columns (name, type, nullability, default).
  v_got := (select string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod)
                         || case when a.attnotnull then ' not null' else '' end
                         || coalesce(' default ' || pg_get_expr(d.adbin, d.adrelid), ''), E'\n' order by a.attnum)
     from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
    where a.attrelid = 'plm.peanuts_entity_lifecycle'::regclass and a.attnum > 0 and not a.attisdropped);
  if v_got is distinct from
       'entity_kind text not null' || E'\n' ||
       'entity_key text not null' || E'\n' ||
       'first_seen_capture_id uuid not null' || E'\n' ||
       'first_seen_at timestamp with time zone not null' || E'\n' ||
       'last_seen_capture_id uuid not null' || E'\n' ||
       'last_seen_at timestamp with time zone not null' || E'\n' ||
       'last_changed_capture_id uuid not null' || E'\n' ||
       'change_signal text not null' || E'\n' ||
       'status text not null default ''active''::text' || E'\n' ||
       'withdrawn_at timestamp with time zone' || E'\n' ||
       'first_withdrawn_at timestamp with time zone' || E'\n' ||
       'withdrawn_capture_id uuid' || E'\n' ||
       'retired_at timestamp with time zone' then
    raise exception 'plm.peanuts_entity_lifecycle cols differ from the reviewed shape: %', v_got;
  end if;
  -- plm.peanuts_entity_lifecycle: constraints (name and full definition).
  v_got := (select string_agg(conname || '=' || pg_get_constraintdef(oid), E'\n' order by conname)
     from pg_constraint where conrelid = 'plm.peanuts_entity_lifecycle'::regclass);
  if v_got is distinct from
       'peanuts_entity_lifecycle_first_seen_capture_id_fkey=FOREIGN KEY (first_seen_capture_id) REFERENCES plm.peanuts_lifecycle_publication(published_capture_id) ON DELETE RESTRICT' || E'\n' ||
       'peanuts_entity_lifecycle_history_chk=CHECK ((((withdrawn_at IS NULL) OR (first_withdrawn_at IS NOT NULL)) AND ((first_withdrawn_at IS NULL) OR (withdrawn_at IS NULL) OR (first_withdrawn_at <= withdrawn_at)) AND (first_seen_at <= last_seen_at)))' || E'\n' ||
       'peanuts_entity_lifecycle_key_chk=CHECK ((btrim(entity_key) <> ''''::text))' || E'\n' ||
       'peanuts_entity_lifecycle_kind_chk=CHECK ((entity_kind = ANY (ARRAY[''asset''::text, ''art_program''::text, ''character''::text, ''style_guide''::text, ''initiative''::text])))' || E'\n' ||
       'peanuts_entity_lifecycle_last_changed_capture_id_fkey=FOREIGN KEY (last_changed_capture_id) REFERENCES plm.peanuts_lifecycle_publication(published_capture_id) ON DELETE RESTRICT' || E'\n' ||
       'peanuts_entity_lifecycle_last_seen_capture_id_fkey=FOREIGN KEY (last_seen_capture_id) REFERENCES plm.peanuts_lifecycle_publication(published_capture_id) ON DELETE RESTRICT' || E'\n' ||
       'peanuts_entity_lifecycle_pkey=PRIMARY KEY (entity_kind, entity_key)' || E'\n' ||
       'peanuts_entity_lifecycle_status_chk=CHECK (((status = ANY (ARRAY[''active''::text, ''withdrawn''::text, ''retired''::text])) AND ((status <> ''withdrawn''::text) OR (entity_kind <> ''initiative''::text)) AND ((status <> ''retired''::text) OR (entity_kind = ''initiative''::text))))' || E'\n' ||
       'peanuts_entity_lifecycle_withdrawn_at_chk=CHECK ((((status = ''withdrawn''::text) = (withdrawn_at IS NOT NULL)) AND ((status = ''withdrawn''::text) = (withdrawn_capture_id IS NOT NULL)) AND ((status = ''retired''::text) = (retired_at IS NOT NULL))))' || E'\n' ||
       'peanuts_entity_lifecycle_withdrawn_capture_id_fkey=FOREIGN KEY (withdrawn_capture_id) REFERENCES plm.peanuts_lifecycle_publication(published_capture_id) ON DELETE RESTRICT' then
    raise exception 'plm.peanuts_entity_lifecycle cons differ from the reviewed shape: %', v_got;
  end if;
  -- plm.peanuts_lifecycle_publication: columns (name, type, nullability, default).
  v_got := (select string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod)
                         || case when a.attnotnull then ' not null' else '' end
                         || coalesce(' default ' || pg_get_expr(d.adbin, d.adrelid), ''), E'\n' order by a.attnum)
     from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
    where a.attrelid = 'plm.peanuts_lifecycle_publication'::regclass and a.attnum > 0 and not a.attisdropped);
  if v_got is distinct from
       'published_capture_id uuid not null' || E'\n' ||
       'baseline_capture_id uuid' || E'\n' ||
       'mode text not null' || E'\n' ||
       'derivation_contract text not null' || E'\n' ||
       'scope_sha256 text not null' || E'\n' ||
       'source_captured_at timestamp with time zone not null' || E'\n' ||
       'counts jsonb not null default ''{}''::jsonb' || E'\n' ||
       'published_at timestamp with time zone not null default now()' then
    raise exception 'plm.peanuts_lifecycle_publication cols differ from the reviewed shape: %', v_got;
  end if;
  -- plm.peanuts_lifecycle_publication: constraints (name and full definition).
  v_got := (select string_agg(conname || '=' || pg_get_constraintdef(oid), E'\n' order by conname)
     from pg_constraint where conrelid = 'plm.peanuts_lifecycle_publication'::regclass);
  if v_got is distinct from
       'peanuts_lifecycle_publication_baseline_capture_id_fkey=FOREIGN KEY (baseline_capture_id) REFERENCES plm.peanuts_lifecycle_publication(published_capture_id) ON DELETE RESTRICT' || E'\n' ||
       'peanuts_lifecycle_publication_baseline_chk=CHECK ((((mode = ''bootstrap''::text) = (baseline_capture_id IS NULL)) AND ((baseline_capture_id IS NULL) OR (baseline_capture_id <> published_capture_id))))' || E'\n' ||
       'peanuts_lifecycle_publication_contract_chk=CHECK ((btrim(derivation_contract) <> ''''::text))' || E'\n' ||
       'peanuts_lifecycle_publication_counts_chk=CHECK ((jsonb_typeof(counts) = ''object''::text))' || E'\n' ||
       'peanuts_lifecycle_publication_mode_chk=CHECK ((mode = ANY (ARRAY[''bootstrap''::text, ''comparable''::text, ''rebaseline''::text, ''withdrawal_held''::text])))' || E'\n' ||
       'peanuts_lifecycle_publication_pkey=PRIMARY KEY (published_capture_id)' || E'\n' ||
       'peanuts_lifecycle_publication_published_capture_id_fkey=FOREIGN KEY (published_capture_id) REFERENCES plm.peanuts_capture(id) ON DELETE RESTRICT' || E'\n' ||
       'peanuts_lifecycle_publication_scope_chk=CHECK ((scope_sha256 ~ ''^[0-9a-f]{64}$''::text))' then
    raise exception 'plm.peanuts_lifecycle_publication cons differ from the reviewed shape: %', v_got;
  end if;
  -- Every non-primary index, exact definition. The durable-state scan index leads with the
  -- equality columns (entity_kind, status) and ends with the array-probed capture.
  v_got := (select string_agg(indexrelid::regclass::text || '=' || pg_get_indexdef(indexrelid), E'\n'
                              order by indexrelid::regclass::text)
              from pg_index where indrelid in ('plm.peanuts_entity_lifecycle'::regclass,
                                               'plm.peanuts_lifecycle_publication'::regclass)
               and not indisprimary);
  if v_got is distinct from
       'plm.idx_peanuts_entity_lifecycle_first_seen=CREATE INDEX idx_peanuts_entity_lifecycle_first_seen ON plm.peanuts_entity_lifecycle USING btree (first_seen_capture_id)' || E'\n' ||
       'plm.idx_peanuts_entity_lifecycle_last_changed=CREATE INDEX idx_peanuts_entity_lifecycle_last_changed ON plm.peanuts_entity_lifecycle USING btree (last_changed_capture_id)' || E'\n' ||
       'plm.idx_peanuts_entity_lifecycle_last_seen=CREATE INDEX idx_peanuts_entity_lifecycle_last_seen ON plm.peanuts_entity_lifecycle USING btree (entity_kind, status, last_seen_capture_id)' || E'\n' ||
       'plm.idx_peanuts_entity_lifecycle_withdrawn_capture=CREATE INDEX idx_peanuts_entity_lifecycle_withdrawn_capture ON plm.peanuts_entity_lifecycle USING btree (withdrawn_capture_id) WHERE (withdrawn_capture_id IS NOT NULL)' || E'\n' ||
       'plm.idx_peanuts_lifecycle_publication_baseline=CREATE INDEX idx_peanuts_lifecycle_publication_baseline ON plm.peanuts_lifecycle_publication USING btree (baseline_capture_id) WHERE (baseline_capture_id IS NOT NULL)' || E'\n' ||
       'plm.idx_peanuts_lifecycle_publication_latest=CREATE INDEX idx_peanuts_lifecycle_publication_latest ON plm.peanuts_lifecycle_publication USING btree (source_captured_at DESC, published_at DESC, published_capture_id DESC)' then
    raise exception 'durable-state indexes differ from the reviewed shape: %', v_got;
  end if;
  -- Policies: exactly one read policy per table, with the predicate exactly as stored.
  -- app.has_app_access takes app.app_name, so the stored constant is 'plm'::app.app_name.
  v_got := (select string_agg(tablename || '/' || policyname || '/' || cmd || '/' || roles::text || '/'
                              || permissive || '/' || coalesce(qual, '') || '/' || coalesce(with_check, ''),
                              E'\n' order by tablename)
              from pg_policies where schemaname = 'plm'
               and tablename in ('peanuts_entity_lifecycle', 'peanuts_lifecycle_publication'));
  if v_got is distinct from
       'peanuts_entity_lifecycle/peanuts_entity_lifecycle_plm_read/SELECT/{authenticated}/PERMISSIVE/(app.has_app_access(''plm''::app.app_name) OR app.has_role(''administrator''::app.app_role) OR app.has_any_role(ARRAY[''sales''::app.app_role, ''licensing''::app.app_role]))/' || E'\n' ||
       'peanuts_lifecycle_publication/peanuts_lifecycle_publication_plm_read/SELECT/{authenticated}/PERMISSIVE/(app.has_app_access(''plm''::app.app_name) OR app.has_role(''administrator''::app.app_role) OR app.has_any_role(ARRAY[''sales''::app.app_role, ''licensing''::app.app_role]))/' then
    raise exception 'durable-state policies differ from the reviewed shape: %', v_got;
  end if;
  -- Definer function: signature, return type, language, volatility, definer, pinned search_path.
  if not exists (select 1 from pg_proc p where p.oid = 'plm.peanuts_publish_lifecycle(uuid)'::regprocedure
                   and p.prosecdef and p.provolatile = 'v' and p.prorettype = 'jsonb'::regtype
                   and p.prolang = (select oid from pg_language where lanname = 'plpgsql')
                   and p.proconfig = array['search_path=pg_catalog, pg_temp']) then
    raise exception 'publish function attributes differ from the reviewed shape: %',
      (select format('%s %s %s %s', prosecdef, provolatile::text, prorettype::regtype::text, proconfig::text)
         from pg_proc where oid = 'plm.peanuts_publish_lifecycle(uuid)'::regprocedure);
  end if;
end
$exact$;

set local role service_role;
do $direct$
begin
  begin
    delete from plm.peanuts_entity_lifecycle;
    raise exception 'service_role deleted lifecycle rows';
  exception when insufficient_privilege then null;
  end;
end
$direct$;
reset role;

do $constraint$
begin
  begin
    update plm.peanuts_entity_lifecycle set status = 'withdrawn', withdrawn_at = now(),
      first_withdrawn_at = now(), withdrawn_capture_id = '36840000-0000-4000-8000-00000000000d'
     where entity_kind = 'initiative';
    raise exception 'an initiative was allowed to be withdrawn';
  exception when check_violation then null;
  end;
end
$constraint$;

-- Endpoint half of the coverage boundary, and the bulk-drop band and cap.
--   E1: same account (cust-2), different API endpoint -> rebaseline; nothing withdrawn.
--   E2: drops 4 of 200 (limit floor(200*2%)=4) -> comparable, 4 withdrawn.
--   E3: drops 5 of 196 (limit floor(196*2%)=3) -> held.
--   F1: third endpoint, 5100 assets -> rebaseline.
--   F2: drops 101 of 5100 (2% = 102, capped at 100) -> held by the 100-row cap.
insert into plm.peanuts_capture (id, capture_key, source_repository, source_commit_sha,
  source_manifest_sha256, portal_base_url, api_endpoint, source_customer_id, source_captured_at,
  status, load_completed_at, expected_counts, portal_reported_asset_total, assets_captured,
  assets_unreachable, deep_paging_partitioned, vocabularies_loaded_from_source,
  error_summary, raw_summary, created_by)
select v.id::uuid, 'contract:' || v.id, 'synthetic/repo', repeat('a', 40), repeat('b', 64),
       'https://example.invalid', v.endpoint, 'cust-2', v.at::timestamptz,
       'complete', now(), '{}'::jsonb, v.n, v.n, 0, true, true, '[]'::jsonb, '{}'::jsonb, 'contract'
  from (values
    ('36840000-0000-4000-8000-0000000000e1', 'https://example.invalid/api-2', '2026-09-08T00:00:00Z', 200),
    ('36840000-0000-4000-8000-0000000000e2', 'https://example.invalid/api-2', '2026-09-09T00:00:00Z', 196),
    ('36840000-0000-4000-8000-0000000000e3', 'https://example.invalid/api-2', '2026-09-10T00:00:00Z', 191),
    ('36840000-0000-4000-8000-0000000000f1', 'https://example.invalid/api-3', '2026-09-11T00:00:00Z', 5100),
    ('36840000-0000-4000-8000-0000000000f2', 'https://example.invalid/api-3', '2026-09-12T00:00:00Z', 4999)
  ) v(id, endpoint, at, n);

insert into plm.peanuts_asset (capture_id, source_object_id, file_name, checksum, raw)
select v.cap::uuid, v.prefix || g, 'f', 's1', '{}'::jsonb
  from (values
    ('36840000-0000-4000-8000-0000000000e1', 'band-', 200),
    ('36840000-0000-4000-8000-0000000000e2', 'band-', 196),
    ('36840000-0000-4000-8000-0000000000e3', 'band-', 191),
    ('36840000-0000-4000-8000-0000000000f1', 'cap-', 5100),
    ('36840000-0000-4000-8000-0000000000f2', 'cap-', 4999)
  ) v(cap, prefix, n)
  cross join lateral generate_series(1, v.n) g;

set local role service_role;
select plm.peanuts_publish_lifecycle('36840000-0000-4000-8000-0000000000e1');
select plm.peanuts_publish_lifecycle('36840000-0000-4000-8000-0000000000e2');
select plm.peanuts_publish_lifecycle('36840000-0000-4000-8000-0000000000e3');
select plm.peanuts_publish_lifecycle('36840000-0000-4000-8000-0000000000f1');
select plm.peanuts_publish_lifecycle('36840000-0000-4000-8000-0000000000f2');
reset role;

do $scope_and_band$
begin
  if (select mode from plm.peanuts_lifecycle_publication where published_capture_id = '36840000-0000-4000-8000-0000000000e1') <> 'rebaseline' then
    raise exception 'same account on a different API endpoint was compared';
  end if;
  if exists (select 1 from plm.peanuts_entity_lifecycle where withdrawn_capture_id = '36840000-0000-4000-8000-0000000000e1') then
    raise exception 'endpoint rebaseline withdrew an entity';
  end if;
  if (select mode from plm.peanuts_lifecycle_publication where published_capture_id = '36840000-0000-4000-8000-0000000000e2') <> 'comparable'
     or (select count(*) from plm.peanuts_entity_lifecycle where withdrawn_capture_id = '36840000-0000-4000-8000-0000000000e2') <> 4 then
    raise exception 'a drop at the 2%% band limit was not applied';
  end if;
  if (select mode from plm.peanuts_lifecycle_publication where published_capture_id = '36840000-0000-4000-8000-0000000000e3') <> 'withdrawal_held'
     or exists (select 1 from plm.peanuts_entity_lifecycle where withdrawn_capture_id = '36840000-0000-4000-8000-0000000000e3') then
    raise exception 'a drop above the 2%% band limit was not held';
  end if;
  if (select mode from plm.peanuts_lifecycle_publication where published_capture_id = '36840000-0000-4000-8000-0000000000f2') <> 'withdrawal_held'
     or exists (select 1 from plm.peanuts_entity_lifecycle where withdrawn_capture_id = '36840000-0000-4000-8000-0000000000f2') then
    raise exception 'a drop above the 100-row cap (inside 2%%) was not held';
  end if;
end
$scope_and_band$;

rollback;
