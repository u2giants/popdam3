-- #3683: synthetic, rollback-only NBCU durable entity state contracts.
-- No licensed value is used; every identity below is invented.

begin;

do $catalog$
declare v_table text;
begin
  foreach v_table in array array['nbcu_entity_lifecycle','nbcu_lifecycle_publication'] loop
    if not (select relrowsecurity from pg_class where oid = format('plm.%I', v_table)::regclass) then
      raise exception 'RLS is disabled for plm.%', v_table;
    end if;
    if has_table_privilege('anon', format('plm.%I', v_table), 'select')
       or not has_table_privilege('authenticated', format('plm.%I', v_table), 'select')
       or has_table_privilege('authenticated', format('plm.%I', v_table), 'insert')
       or has_table_privilege('service_role', format('plm.%I', v_table), 'insert')
       or has_table_privilege('service_role', format('plm.%I', v_table), 'update')
       or has_table_privilege('service_role', format('plm.%I', v_table), 'delete') then
      raise exception 'NBCU lifecycle grants are incorrect for plm.%', v_table;
    end if;
  end loop;
  if has_function_privilege('anon', 'plm.nbcu_publish_lifecycle(uuid)', 'execute')
     or has_function_privilege('authenticated', 'plm.nbcu_publish_lifecycle(uuid)', 'execute')
     or not has_function_privilege('service_role', 'plm.nbcu_publish_lifecycle(uuid)', 'execute') then
    raise exception 'NBCU publish function execute grants are incorrect';
  end if;
end
$catalog$;

-- Synthetic captures. A..D are complete; R is rejected (authentication loss shows up
-- as a rejected finalize); E is complete but carries an error summary.
insert into plm.nbcu_capture (id, capture_key, source_repository, source_commit_sha,
  source_manifest_sha256, portal_base_url, source_captured_at, status, load_completed_at,
  expected_counts, observed_counts, error_summary, raw_summary, created_by)
select v.id::uuid, 'contract:' || v.id, 'synthetic/repo', repeat('a', 40), repeat('b', 64),
       'https://example.invalid', v.at::timestamptz, v.status,
       case when v.status = 'complete' then now() end,
       '{}'::jsonb, '{}'::jsonb, v.err::jsonb, '{}'::jsonb, 'contract'
  from (values
    ('36830000-0000-4000-8000-00000000000a', '2026-09-01T00:00:00Z', 'complete', '[]'),
    ('36830000-0000-4000-8000-00000000000b', '2026-09-02T00:00:00Z', 'complete', '[]'),
    ('36830000-0000-4000-8000-00000000000c', '2026-09-03T00:00:00Z', 'complete', '[]'),
    ('36830000-0000-4000-8000-00000000000d', '2026-09-04T00:00:00Z', 'complete', '[]'),
    ('36830000-0000-4000-8000-00000000000e', '2026-09-05T00:00:00Z', 'complete', '[{"code":"synthetic"}]'),
    ('36830000-0000-4000-8000-0000000000ff', '2026-09-06T00:00:00Z', 'rejected', '[{"code":"synthetic"}]'),
    ('36830000-0000-4000-8000-000000000001', '2026-08-01T00:00:00Z', 'complete', '[]'),
    ('36830000-0000-4000-8000-000000000006', '2026-09-07T00:00:00Z', 'complete', '[]'),
    ('36830000-0000-4000-8000-000000000007', '2026-09-07T00:00:00Z', 'complete', '[]'),
    ('36830000-0000-4000-8000-000000000008', '2026-09-08T00:00:00Z', 'complete', '[]')
  ) v(id, at, status, err);

insert into plm.nbcu_scope (capture_id, scope_key, scope_label, scope_href, page_count,
  indexed_rows, unique_assets, terminal, missing_offsets, source_files, raw)
select v.cap::uuid, 'href-sha256:' || repeat(v.k, 64), 'scope ' || v.k, 'https://example.invalid/' || v.k,
       1, 1, 1, true, '{}', '[]'::jsonb, '{}'::jsonb
  from (values
    ('36830000-0000-4000-8000-00000000000a','1'), ('36830000-0000-4000-8000-00000000000a','2'),
    ('36830000-0000-4000-8000-00000000000b','1'), ('36830000-0000-4000-8000-00000000000b','2'),
    ('36830000-0000-4000-8000-00000000000c','1'),
    ('36830000-0000-4000-8000-00000000000d','1'),
    ('36830000-0000-4000-8000-00000000000e','1'),
    ('36830000-0000-4000-8000-0000000000ff','1'),
    ('36830000-0000-4000-8000-000000000001','1'),
    ('36830000-0000-4000-8000-000000000006','1'),
    ('36830000-0000-4000-8000-000000000007','1'),
    ('36830000-0000-4000-8000-000000000008','1')
  ) v(cap, k);

insert into plm.nbcu_asset (capture_id, asset_source_key, asset_path, file_name, display_size,
  display_modified, studio_labels, ip_family_labels, property_labels, character_labels,
  restriction_labels, style_guide_natural_keys, scope_paths, source_captured_at, source_url, raw, source_hash)
select v.cap::uuid, v.path, v.path, 'f', '1 KB', v.modified, '[]', '[]', '[]', '[]', '[]', '[]', '[]',
       now(), 'https://example.invalid', '{}'::jsonb, repeat('c', 64)
  from (values
    ('36830000-0000-4000-8000-00000000000a', '/content/asset-share-commons/en/details/image.html/content/dam/synthetic/one.png', 'm1'),
    ('36830000-0000-4000-8000-00000000000a', '/content/dam/synthetic/two.png', 'm1'),
    ('36830000-0000-4000-8000-00000000000b', '/content/dam/synthetic/one.png', 'm2'),
    ('36830000-0000-4000-8000-00000000000c', '/content/dam/synthetic/two.png', 'm1'),
    ('36830000-0000-4000-8000-00000000000c', '/content/dam/synthetic/three.png', 'm1'),
    ('36830000-0000-4000-8000-00000000000c', '/content/dam/synthetic/four.png', 'm1'),
    ('36830000-0000-4000-8000-00000000000d', '/content/dam/synthetic/five.png', 'm1'),
    ('36830000-0000-4000-8000-00000000000e', '/content/dam/synthetic/five.png', 'm1'),
    ('36830000-0000-4000-8000-000000000006', '/content/asset-share-commons/en/details/stream.html/content/dam/synthetic/five.png', 'm1'),
    -- Same capture, same DAM object through two viewer forms (#3695 M2): one identity.
    ('36830000-0000-4000-8000-000000000006', '/content/dam/synthetic/five.png', 'm9'),
    ('36830000-0000-4000-8000-000000000006', '/content/dam/synthetic/three.png', 'm1'),
    ('36830000-0000-4000-8000-000000000006', '/content/dam/synthetic/four.png', 'm1'),
    ('36830000-0000-4000-8000-000000000008', '/content/dam/synthetic/three.png', 'm1'),
    ('36830000-0000-4000-8000-000000000008', '/content/dam/synthetic/four.png', 'm1'),
    ('36830000-0000-4000-8000-000000000008', '/content/dam/synthetic/five.png', 'm1'),
    -- A viewer form the rule does not name is kept verbatim, never guessed into a DAM path.
    ('36830000-0000-4000-8000-000000000008', '/content/asset-share-commons/en/details/image.html/content/other/six.png', 'm1')
  ) v(cap, path, modified);

insert into plm.nbcu_property (capture_id, property_key, property_source_id, property_label,
  source_kind, source_url, source_captured_at, raw)
values ('36830000-0000-4000-8000-00000000000a', 'source-id:synthetic-p1', 'synthetic-p1', 'P1',
        'property', 'https://example.invalid', now(), '{}'::jsonb);

-- Refusals: not complete, complete with errors, unknown capture.
set local role service_role;
do $refusals$
declare v_id text;
begin
  foreach v_id in array array['36830000-0000-4000-8000-0000000000ff','36830000-0000-4000-8000-00000000000e'] loop
    begin
      perform plm.nbcu_publish_lifecycle(v_id::uuid);
      raise exception 'publish accepted an unqualified capture %', v_id;
    exception when sqlstate '22023' then null;
    end;
  end loop;
  begin
    perform plm.nbcu_publish_lifecycle('36830000-0000-4000-8000-00000000abcd');
    raise exception 'publish accepted an unknown capture';
  exception when sqlstate 'P0002' then null;
  end;
end
$refusals$;

-- A: bootstrap.
select plm.nbcu_publish_lifecycle('36830000-0000-4000-8000-00000000000a');
reset role;

do $bootstrap$
begin
  if (select mode from plm.nbcu_lifecycle_publication where published_capture_id = '36830000-0000-4000-8000-00000000000a') <> 'bootstrap' then
    raise exception 'first publication is not a bootstrap';
  end if;
  if not exists (select 1 from plm.nbcu_entity_lifecycle where entity_kind = 'asset'
                 and entity_key = '/content/dam/synthetic/one.png' and identity_basis = 'dam_path' and status = 'active') then
    raise exception 'details-viewer asset path was not normalized to its DAM path';
  end if;
  if (select count(*) from plm.nbcu_entity_lifecycle) <> 3 then
    raise exception 'bootstrap did not record exactly two assets and one property';
  end if;
  if not exists (select 1 from pg_locks where locktype = 'advisory' and pid = pg_backend_pid() and granted
                 and objsubid = 1
                 and ((classid::bigint << 32) | objid::bigint) = hashtextextended('plm.nbcu_publish_lifecycle', 0)) then
    raise exception 'publication did not hold its transaction advisory lock';
  end if;
end
$bootstrap$;

set local role service_role;
do $order$
begin
  begin
    perform plm.nbcu_publish_lifecycle('36830000-0000-4000-8000-00000000000a');
    raise exception 'publish accepted a capture twice';
  exception when unique_violation then null;
  end;
  begin
    perform plm.nbcu_publish_lifecycle('36830000-0000-4000-8000-000000000001');
    raise exception 'publish accepted an older capture';
  exception when sqlstate '22023' then null;
  end;
end
$order$;

-- B: comparable; two.png and P1 are withdrawn, one.png changes signal.
select plm.nbcu_publish_lifecycle('36830000-0000-4000-8000-00000000000b');
reset role;

do $comparable$
begin
  if (select mode from plm.nbcu_lifecycle_publication where published_capture_id = '36830000-0000-4000-8000-00000000000b') <> 'comparable' then
    raise exception 'same scope set did not compare';
  end if;
  if not exists (select 1 from plm.nbcu_entity_lifecycle where entity_key = '/content/dam/synthetic/two.png'
                 and status = 'withdrawn' and withdrawn_capture_id = '36830000-0000-4000-8000-00000000000b'
                 and first_withdrawn_at = '2026-09-02T00:00:00Z') then
    raise exception 'absent baseline asset was not withdrawn';
  end if;
  if not exists (select 1 from plm.nbcu_entity_lifecycle where entity_kind = 'property' and status = 'withdrawn') then
    raise exception 'absent baseline property was not withdrawn';
  end if;
  if not exists (select 1 from plm.nbcu_entity_lifecycle where entity_key = '/content/dam/synthetic/one.png'
                 and status = 'active' and last_changed_capture_id = '36830000-0000-4000-8000-00000000000b'
                 and first_seen_capture_id = '36830000-0000-4000-8000-00000000000a') then
    raise exception 'changed asset lost first sighting or change marker';
  end if;
end
$comparable$;

-- C: incompatible scope set; two.png reappears (reactivated), one.png is not withdrawn.
set local role service_role;
select plm.nbcu_publish_lifecycle('36830000-0000-4000-8000-00000000000c');
reset role;

do $rebaseline$
begin
  if (select mode from plm.nbcu_lifecycle_publication where published_capture_id = '36830000-0000-4000-8000-00000000000c') <> 'rebaseline' then
    raise exception 'different scope set was compared';
  end if;
  if not exists (select 1 from plm.nbcu_entity_lifecycle where entity_key = '/content/dam/synthetic/one.png' and status = 'active') then
    raise exception 'incomparable run withdrew an entity';
  end if;
  if not exists (select 1 from plm.nbcu_entity_lifecycle where entity_key = '/content/dam/synthetic/two.png'
                 and status = 'active' and withdrawn_at is null and first_withdrawn_at = '2026-09-02T00:00:00Z') then
    raise exception 'reappearing asset was not reactivated with its withdrawal history kept';
  end if;
end
$rebaseline$;

-- D: comparable with C but drops three of three baseline assets: held, nothing withdrawn.
set local role service_role;
select plm.nbcu_publish_lifecycle('36830000-0000-4000-8000-00000000000d');
reset role;

do $held$
begin
  if (select mode from plm.nbcu_lifecycle_publication where published_capture_id = '36830000-0000-4000-8000-00000000000d') <> 'withdrawal_held' then
    raise exception 'bulk drop was not held';
  end if;
  if exists (select 1 from plm.nbcu_entity_lifecycle where withdrawn_capture_id = '36830000-0000-4000-8000-00000000000d') then
    raise exception 'held publication withdrew an entity';
  end if;
  -- The held publication keeps the magnitude of what it held (three baseline assets).
  if (select counts #> '{asset}' from plm.nbcu_lifecycle_publication
       where published_capture_id = '36830000-0000-4000-8000-00000000000d')
     is distinct from '{"seen": 1, "added": 1, "changed": 0, "reactivated": 0, "withdrawn": 0, "withdrawal_held": 3}'::jsonb then
    raise exception 'held publication did not record the size of the held drop';
  end if;
  if not exists (select 1 from plm.nbcu_entity_lifecycle where entity_key = '/content/dam/synthetic/five.png' and status = 'active') then
    raise exception 'held publication did not record sightings';
  end if;
end
$held$;

-- Direct writes are refused for the loader role; withdrawal state is constrained.
-- After a held publication, the next comparable run re-evaluates the held drop instead
-- of orphaning it: /content/dam/synthetic/two.png was last seen before the hold and is now withdrawn.
set local role service_role;
select plm.nbcu_publish_lifecycle('36830000-0000-4000-8000-000000000006');
reset role;

-- An equal source_captured_at cannot be ordered and is refused, never merged.
set local role service_role;
do $tie$
begin
  begin
    perform plm.nbcu_publish_lifecycle('36830000-0000-4000-8000-000000000007');
    raise exception 'publish accepted a capture with an equal source_captured_at';
  exception when sqlstate '22023' then null;
  end;
end
$tie$;
reset role;

do $after_hold$
begin
  if (select mode from plm.nbcu_lifecycle_publication where published_capture_id = '36830000-0000-4000-8000-000000000006') <> 'comparable' then
    raise exception 'run after a held publication did not compare';
  end if;
  if not exists (select 1 from plm.nbcu_entity_lifecycle where entity_key = '/content/dam/synthetic/two.png'
                 and status = 'withdrawn' and withdrawn_capture_id = '36830000-0000-4000-8000-000000000006') then
    raise exception 'drop held earlier was orphaned instead of re-evaluated';
  end if;
  if (select count(*) from plm.nbcu_entity_lifecycle where entity_kind = 'asset'
       and entity_key like '%synthetic/five.png') <> 1 then
    raise exception 'two viewer forms of one DAM object in one capture were not collapsed';
  end if;
  if not exists (select 1 from plm.nbcu_entity_lifecycle where entity_key = '/content/dam/synthetic/five.png' and status = 'active') then
    raise exception 'entity seen after the hold is not active';
  end if;
end
$after_hold$;

-- Exact objects (#3695 review): column type, nullability and default; every CHECK body
-- as the catalog renders it; FK mappings; index definitions; the full policy USING
-- expression; and the function's shape.
do $exact$
declare
  c_audience constant text := '(app.has_app_access(''plm''::app.app_name) OR app.has_role(''administrator''::app.app_role) OR app.has_any_role(ARRAY[''sales''::app.app_role, ''licensing''::app.app_role]))';
begin
  if (select string_agg(format('%s %s %s %s', a.attname, format_type(a.atttypid, a.atttypmod),
            case when a.attnotnull then 'not null' else 'null' end, coalesce(pg_get_expr(d.adbin, d.adrelid), '-')), ', ' order by a.attnum)
        from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
       where a.attrelid = 'plm.nbcu_entity_lifecycle'::regclass and a.attnum > 0 and not a.attisdropped)
     is distinct from
       'entity_kind text not null -, entity_key text not null -, identity_basis text not null -, '
       'first_seen_capture_id uuid not null -, first_seen_at timestamp with time zone not null -, '
       'last_seen_capture_id uuid not null -, last_seen_at timestamp with time zone not null -, '
       'last_changed_capture_id uuid not null -, change_signal text not null -, '
       'status text not null ''active''::text, withdrawn_at timestamp with time zone null -, '
       'first_withdrawn_at timestamp with time zone null -, withdrawn_capture_id uuid null -' then
    raise exception 'plm.nbcu_entity_lifecycle columns differ from the reviewed shape';
  end if;
  if (select string_agg(format('%s %s %s %s', a.attname, format_type(a.atttypid, a.atttypmod),
            case when a.attnotnull then 'not null' else 'null' end, coalesce(pg_get_expr(d.adbin, d.adrelid), '-')), ', ' order by a.attnum)
        from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
       where a.attrelid = 'plm.nbcu_lifecycle_publication'::regclass and a.attnum > 0 and not a.attisdropped)
     is distinct from
       'published_capture_id uuid not null -, baseline_capture_id uuid null -, mode text not null -, '
       'derivation_contract text not null -, scope_sha256 text not null -, '
       'source_captured_at timestamp with time zone not null -, counts jsonb not null ''{}''::jsonb, '
       'published_at timestamp with time zone not null now()' then
    raise exception 'plm.nbcu_lifecycle_publication columns differ from the reviewed shape';
  end if;
  -- Every primary key and CHECK on both tables, by name AND body: no missing, no extra.
  if (select string_agg(conname || ' ' || pg_get_constraintdef(oid), E'\n' order by conname) from pg_constraint
       where conrelid in ('plm.nbcu_entity_lifecycle'::regclass, 'plm.nbcu_lifecycle_publication'::regclass)
         and contype in ('p','c'))
     is distinct from concat_ws(E'\n',
       'nbcu_entity_lifecycle_basis_chk CHECK ((identity_basis = ANY (ARRAY[''dam_path''::text, ''source_id''::text, ''label_sha256''::text, ''id_fallback''::text, ''folder_path''::text])))',
       'nbcu_entity_lifecycle_history_chk CHECK ((((withdrawn_at IS NULL) OR (first_withdrawn_at IS NOT NULL)) AND ((first_withdrawn_at IS NULL) OR (withdrawn_at IS NULL) OR (first_withdrawn_at <= withdrawn_at)) AND (first_seen_at <= last_seen_at)))',
       'nbcu_entity_lifecycle_key_chk CHECK ((btrim(entity_key) <> ''''::text))',
       'nbcu_entity_lifecycle_kind_chk CHECK ((entity_kind = ANY (ARRAY[''asset''::text, ''property''::text, ''character''::text, ''style_guide''::text, ''ip_family''::text])))',
       'nbcu_entity_lifecycle_pkey PRIMARY KEY (entity_kind, entity_key)',
       'nbcu_entity_lifecycle_status_chk CHECK ((status = ANY (ARRAY[''active''::text, ''withdrawn''::text])))',
       'nbcu_entity_lifecycle_withdrawn_at_chk CHECK ((((status = ''withdrawn''::text) = (withdrawn_at IS NOT NULL)) AND ((status = ''withdrawn''::text) = (withdrawn_capture_id IS NOT NULL))))',
       'nbcu_lifecycle_publication_baseline_chk CHECK ((((mode = ''bootstrap''::text) = (baseline_capture_id IS NULL)) AND ((baseline_capture_id IS NULL) OR (baseline_capture_id <> published_capture_id))))',
       'nbcu_lifecycle_publication_contract_chk CHECK ((btrim(derivation_contract) <> ''''::text))',
       'nbcu_lifecycle_publication_counts_chk CHECK ((jsonb_typeof(counts) = ''object''::text))',
       'nbcu_lifecycle_publication_mode_chk CHECK ((mode = ANY (ARRAY[''bootstrap''::text, ''comparable''::text, ''rebaseline''::text, ''withdrawal_held''::text])))',
       'nbcu_lifecycle_publication_pkey PRIMARY KEY (published_capture_id)',
       'nbcu_lifecycle_publication_scope_chk CHECK ((scope_sha256 ~ ''^[0-9a-f]{64}$''::text))') then
    raise exception 'durable-state primary keys or CHECK bodies differ from the reviewed shape';
  end if;
  -- Foreign keys by exact column mapping, restrict on delete.
  if (select string_agg(pg_get_constraintdef(oid), ' | ' order by pg_get_constraintdef(oid)) from pg_constraint
       where conrelid = 'plm.nbcu_entity_lifecycle'::regclass and contype = 'f')
     is distinct from
       'FOREIGN KEY (first_seen_capture_id) REFERENCES plm.nbcu_lifecycle_publication(published_capture_id) ON DELETE RESTRICT | '
       'FOREIGN KEY (last_changed_capture_id) REFERENCES plm.nbcu_lifecycle_publication(published_capture_id) ON DELETE RESTRICT | '
       'FOREIGN KEY (last_seen_capture_id) REFERENCES plm.nbcu_lifecycle_publication(published_capture_id) ON DELETE RESTRICT | '
       'FOREIGN KEY (withdrawn_capture_id) REFERENCES plm.nbcu_lifecycle_publication(published_capture_id) ON DELETE RESTRICT'
     or (select string_agg(pg_get_constraintdef(oid), ' | ' order by pg_get_constraintdef(oid)) from pg_constraint
       where conrelid = 'plm.nbcu_lifecycle_publication'::regclass and contype = 'f')
     is distinct from
       'FOREIGN KEY (baseline_capture_id) REFERENCES plm.nbcu_lifecycle_publication(published_capture_id) ON DELETE RESTRICT | '
       'FOREIGN KEY (published_capture_id) REFERENCES plm.nbcu_capture(id) ON DELETE RESTRICT' then
    raise exception 'durable-state foreign keys differ from the reviewed column mapping';
  end if;
  -- Indexes: the withdrawal index leads with last_seen_capture_id (#3695 review, H2/H3).
  if (select string_agg(pg_get_indexdef(indexrelid), ' | ' order by pg_get_indexdef(indexrelid)) from pg_index
       where indrelid in ('plm.nbcu_entity_lifecycle'::regclass, 'plm.nbcu_lifecycle_publication'::regclass)
         and not indisprimary)
     is distinct from
       'CREATE INDEX nbcu_entity_lifecycle_first_seen_idx ON plm.nbcu_entity_lifecycle USING btree (first_seen_capture_id) | '
       'CREATE INDEX nbcu_entity_lifecycle_kind_last_seen_idx ON plm.nbcu_entity_lifecycle USING btree (last_seen_capture_id, entity_kind, status) | '
       'CREATE INDEX nbcu_entity_lifecycle_last_changed_idx ON plm.nbcu_entity_lifecycle USING btree (last_changed_capture_id) | '
       'CREATE INDEX nbcu_entity_lifecycle_withdrawn_capture_idx ON plm.nbcu_entity_lifecycle USING btree (withdrawn_capture_id) WHERE (withdrawn_capture_id IS NOT NULL) | '
       'CREATE INDEX nbcu_lifecycle_publication_baseline_idx ON plm.nbcu_lifecycle_publication USING btree (baseline_capture_id) WHERE (baseline_capture_id IS NOT NULL) | '
       'CREATE INDEX nbcu_lifecycle_publication_latest_idx ON plm.nbcu_lifecycle_publication USING btree (source_captured_at DESC, published_at DESC)' then
    raise exception 'durable-state indexes differ from the reviewed set';
  end if;
  -- Policies: exactly one permissive SELECT policy per table, for authenticated, whose
  -- full USING expression is the catalog rendering of the PLM / administrator /
  -- sales-licensing audience (typed casts included).
  if (select string_agg(format('%s %s %s %s %s %s', tablename, policyname, permissive, cmd, roles, coalesce(with_check, '-')), ' | ' order by tablename)
        from pg_policies where schemaname = 'plm' and tablename in ('nbcu_entity_lifecycle','nbcu_lifecycle_publication'))
     is distinct from
       'nbcu_entity_lifecycle nbcu_entity_lifecycle_plm_read PERMISSIVE SELECT {authenticated} - | '
       'nbcu_lifecycle_publication nbcu_lifecycle_publication_plm_read PERMISSIVE SELECT {authenticated} -'
     or exists (select 1 from pg_policies where schemaname = 'plm'
                  and tablename in ('nbcu_entity_lifecycle','nbcu_lifecycle_publication')
                  and qual is distinct from c_audience) then
    raise exception 'durable-state read policies differ from the reviewed audience';
  end if;
  if (select format('%s %s %s %s %s', provolatile, prosecdef, l.lanname, pg_get_function_result(p.oid), proconfig)
        from pg_proc p join pg_language l on l.oid = p.prolang
       where p.oid = 'plm.nbcu_publish_lifecycle(uuid)'::regprocedure)
     is distinct from 'v t plpgsql jsonb {"search_path=pg_catalog, pg_temp"}' then
    raise exception 'publish function volatility, security, language, result or search_path differs from the reviewed shape';
  end if;
end
$exact$;

-- Two-session contention (#3695 review): this transaction has published, so it holds the
-- publication lock until it ends. A second session that calls the publish function must
-- wait on that lock (it times out with lock_not_available before it can even look up
-- its capture) instead of running concurrently. Runs through dblink when the extension
-- can be created inside this rolled-back transaction and a second connection opens (the
-- connection string may be supplied as the nbcu.contention_dsn setting); otherwise it
-- SKIPS loudly, as coldlion_promotion_serialization_lock.sql does.
do $contention$
declare
  v_ok boolean := false;
  v_state text;
begin
  begin
    create extension if not exists dblink with schema extensions;
    perform extensions.dblink_connect('nbcu_lock',
      coalesce(nullif(current_setting('nbcu.contention_dsn', true), ''), 'dbname=' || current_database()));
    v_ok := true;
  exception when others then
    raise notice 'contention SKIP: no second session through dblink (%)', sqlerrm;
  end;
  if not v_ok then return; end if;
  perform extensions.dblink_exec('nbcu_lock', 'set lock_timeout = ''500ms''');
  begin
    perform 1 from extensions.dblink('nbcu_lock',
      'select 1 from (select plm.nbcu_publish_lifecycle(''36830000-0000-4000-8000-00000000abcd'')) s') as t(c int);
    raise exception 'a second session ran the publish function while this one held the lock';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    if sqlerrm not like '%lock timeout%' then
      raise exception 'second session failed for a reason other than waiting on the lock: % %', v_state, sqlerrm;
    end if;
  end;
  perform extensions.dblink_disconnect('nbcu_lock');
  raise notice 'contention PASS: second session waited on the publication lock';
exception when others then
  begin perform extensions.dblink_disconnect('nbcu_lock'); exception when others then null; end;
  raise;
end
$contention$;

-- H: a later capture publishes; an unnamed viewer form stays verbatim.
set local role service_role;
select plm.nbcu_publish_lifecycle('36830000-0000-4000-8000-000000000008');
reset role;

do $viewer_boundary$
begin
  if not exists (select 1 from plm.nbcu_lifecycle_publication where published_capture_id = '36830000-0000-4000-8000-000000000008') then
    raise exception 'later capture did not publish';
  end if;
  if not exists (select 1 from plm.nbcu_entity_lifecycle where entity_kind = 'asset'
                 and entity_key = '/content/asset-share-commons/en/details/image.html/content/other/six.png') then
    raise exception 'a non-DAM viewer path was rewritten instead of kept verbatim';
  end if;
end
$viewer_boundary$;

set local role service_role;
do $direct$
begin
  begin
    delete from plm.nbcu_entity_lifecycle;
    raise exception 'service_role deleted lifecycle rows';
  exception when insufficient_privilege then null;
  end;
end
$direct$;
reset role;

do $constraint$
begin
  begin
    update plm.nbcu_entity_lifecycle set status = 'withdrawn' where entity_key = '/content/dam/synthetic/five.png';
    raise exception 'withdrawn status without a withdrawal time was accepted';
  exception when check_violation then null;
  end;
end
$constraint$;

rollback;
