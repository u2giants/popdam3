-- Rollback-safe contract tests for
--   20260807170000_opa_property_character_landing.sql
--
-- Run against a disposable DB or preview AFTER the migration is applied.
-- Fixtures roll back. Do not run as a long-lived production session.
--
-- ALL FIXTURE DATA IS INVENTED. Not one Disney row, name or ID appears in this file,
-- in a comment, or anywhere else in this repository. This repo is PUBLIC and the OPA
-- extract is confidential Disney data held in the private repo
-- u2giants/licensor-source-data. Schema in git, data out of git.
--
-- Proves:
--   * every declared object exists, by catalog lookup, not by "the migration applied"
--   * THE NATURAL KEY IS THE ID PAIR: two rows with IDENTICAL property_name and
--     character_name but different IDs BOTH land (the 22-collision regression), and
--     no unique constraint or index exists on the name pair
--   * negative Disney sentinel IDs are accepted (no positive constraint sneaked in)
--   * every CHECK constraint rejects behaviourally, not just exists
--   * the landing RESOLVES NOTHING: resolution_status defaults unresolved, property_id
--     defaults null, core.property_character lands EMPTY, core.character is untouched
--   * FK delete actions are the declared ones
--   * RLS on, exactly the declared policies, anon has nothing
--   * both api views are security_invoker (cannot escalate around base-table RLS)
--   * the axis-1/axis-2 reconciliation invariant holds
--   * the America/New_York date hazard is real and midday-UTC pinning defeats it

begin;

do $$
declare
  v_cols            text;
  v_conname         text;
  v_confdeltype     char;
  v_count           integer;
  v_default         text;
  v_status          text;
  v_propid          uuid;
  v_reloptions      text[];
  v_policies        integer;
  v_anon            integer;
  v_missing         text;
  v_uuids           uuid[];
  v_names           text[];
  v_lic             uuid;
  v_prop            uuid;
  v_err             text;
  v_tz              text;
  v_midnight        timestamptz;
  v_midday          timestamptz;
  v_obj             text;
begin
  -- ==================================================================================
  -- 1. EXISTENCE. Every declared object, by catalog. The ledger can record a migration
  --    whose object does not exist, so "it applied" proves nothing.
  -- ==================================================================================
  foreach v_obj in array array[
    'plm.opa_property_character',
    'core.property_character',
    'api.opa_property_character',
    'api.opa_property_reconciliation'
  ] loop
    if to_regclass(v_obj) is null then
      raise exception 'declared object % does not exist', v_obj;
    end if;
  end loop;

  -- Indexes, by exact name, in the schema they must actually land in (plm/core, not
  -- whatever the unqualified names in the design doc implied).
  foreach v_obj in array array[
    'idx_opa_property_character_property_name',
    'idx_opa_property_character_character_name',
    'idx_opa_property_character_character_id',
    'idx_opa_property_character_licensed_property_id',
    'idx_opa_property_character_property_id',
    'idx_opa_property_character_resolution_status',
    'idx_opa_property_character_base_property_name'
  ] loop
    if not exists (
      select 1 from pg_indexes
      where schemaname = 'plm' and tablename = 'opa_property_character'
        and indexname = v_obj
    ) then
      raise exception 'index plm.% missing from plm.opa_property_character', v_obj;
    end if;
  end loop;

  if not exists (
    select 1 from pg_indexes
    where schemaname = 'core' and tablename = 'property_character'
      and indexname = 'idx_property_character_character_id'
  ) then
    raise exception 'index core.idx_property_character_character_id missing';
  end if;

  -- Constraints, by exact name.
  foreach v_obj in array array[
    'opa_property_character_pkey',
    'opa_property_character_property_name_chk',
    'opa_property_character_character_name_chk',
    'opa_property_character_option_source_chk',
    'opa_property_character_lob_chk',
    'opa_property_character_resolution_status_chk',
    'opa_property_character_property_id_fkey'
  ] loop
    if not exists (
      select 1 from pg_constraint c
      join pg_class rel on rel.oid = c.conrelid
      join pg_namespace n on n.oid = rel.relnamespace
      where n.nspname = 'plm' and rel.relname = 'opa_property_character'
        and c.conname = v_obj
    ) then
      raise exception 'constraint % missing on plm.opa_property_character', v_obj;
    end if;
  end loop;

  foreach v_obj in array array[
    'property_character_pkey',
    'property_character_property_id_fkey',
    'property_character_character_id_fkey',
    'property_character_source_chk'
  ] loop
    if not exists (
      select 1 from pg_constraint c
      join pg_class rel on rel.oid = c.conrelid
      join pg_namespace n on n.oid = rel.relnamespace
      where n.nspname = 'core' and rel.relname = 'property_character'
        and c.conname = v_obj
    ) then
      raise exception 'constraint % missing on core.property_character', v_obj;
    end if;
  end loop;

  -- ==================================================================================
  -- 2. THE NATURAL KEY. The single most important assertion in this file.
  --    The PK must be the ID pair. Keying on the display-name pair would silently drop
  --    22 rows of the real extract (10,240 distinct name pairs over 10,262 rows).
  -- ==================================================================================
  select string_agg(a.attname, ',' order by k.ord)
  into v_cols
  from pg_constraint c
  join pg_class rel on rel.oid = c.conrelid
  join pg_namespace n on n.oid = rel.relnamespace
  cross join lateral unnest(c.conkey) with ordinality as k(attnum, ord)
  join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
  where n.nspname = 'plm' and rel.relname = 'opa_property_character'
    and c.contype = 'p'
  group by c.oid;

  if v_cols is distinct from 'licensed_property_id,character_id' then
    raise exception 'plm.opa_property_character PK is (%), expected '
      '(licensed_property_id,character_id). Keying on the NAME pair silently drops 22 '
      'rows of the real extract.', v_cols;
  end if;

  -- And no unique constraint or unique index may exist on the name pair.
  if exists (
    select 1 from pg_index i
    join pg_class rel on rel.oid = i.indrelid
    join pg_namespace n on n.oid = rel.relnamespace
    where n.nspname = 'plm' and rel.relname = 'opa_property_character'
      and i.indisunique
      and (
        select array_agg(a.attname::text order by a.attname::text)
        from unnest(i.indkey::smallint[]) u(attnum)
        join pg_attribute a on a.attrelid = i.indrelid and a.attnum = u.attnum
      ) = array['character_name','property_name']::text[]
  ) then
    raise exception 'a UNIQUE index exists on (property_name, character_name). That key '
      'is NOT unique in Disney''s data and would drop 22 rows.';
  end if;

  -- ==================================================================================
  -- 3. BEHAVIOUR. Everything below inserts real (invented) rows and observes.
  -- ==================================================================================

  -- 3a. THE 22-COLLISION REGRESSION. Identical names, different IDs. BOTH must land.
  insert into plm.opa_property_character (
    licensed_property_id, character_id, property_name, character_name,
    brand_property_id, option_source_id, captured_at, source_url, raw, source_hash)
  values
    (900000001, 900000101, 'Contract Test Property Alpha', 'Contract Test Character One',
     900000001, 1007, date '2026-08-06', 'https://example.invalid/contract-test',
     '{"fixture":true}'::jsonb, 'fixturehash1'),
    (900000002, 900000102, 'Contract Test Property Alpha', 'Contract Test Character One',
     900000002, 1007, date '2026-08-06', 'https://example.invalid/contract-test',
     '{"fixture":true}'::jsonb, 'fixturehash2');

  select count(*) into v_count from plm.opa_property_character
  where property_name = 'Contract Test Property Alpha';
  if v_count <> 2 then
    raise exception 'name-pair collision regression FAILED: expected 2 rows sharing one '
      'property/character name pair under different IDs, got %', v_count;
  end if;

  -- 3b. Negative Disney sentinel IDs must be accepted. Any unsigned typing or
  --     positive CHECK would reject the real `Special Projects` row.
  insert into plm.opa_property_character (
    licensed_property_id, character_id, property_name, character_name,
    brand_property_id, option_source_id, captured_at, source_url, raw, source_hash)
  values (-9999, -9998, 'Contract Test Sentinel', 'Contract Test Sentinel Character',
          -9999, 1007, date '2026-08-06', 'https://example.invalid/contract-test',
          '{"fixture":true}'::jsonb, 'fixturehash3');

  -- 3c. THE LANDING RESOLVES NOTHING. Defaults must be unresolved/null.
  select resolution_status, property_id
  into v_status, v_propid
  from plm.opa_property_character where licensed_property_id = 900000001;

  if v_status is distinct from 'unresolved' or v_propid is not null then
    raise exception 'landing default is NOT unresolved: status=%, property_id=%. The '
      'landing must resolve nothing -- two owner gates are still open.', v_status, v_propid;
  end if;

  -- 3d. Every CHECK rejects behaviourally. An existing-but-unenforced constraint is
  --     exactly the failure mode this file is for.
  begin
    insert into plm.opa_property_character (
      licensed_property_id, character_id, property_name, character_name,
      brand_property_id, option_source_id, captured_at, source_url, raw, source_hash)
    values (900000003, 900000103, 'X', 'Y', 1, 1008, date '2026-08-06',
            'https://example.invalid/contract-test', '{}'::jsonb, 'h');
    raise exception 'option_source_id = 1008 was ACCEPTED; the 1007 pin does not enforce';
  exception when check_violation then null;
  end;

  begin
    insert into plm.opa_property_character (
      licensed_property_id, character_id, property_name, character_name,
      brand_property_id, option_source_id, captured_at, source_url, raw, source_hash)
    values (900000004, 900000104, '   ', 'Y', 1, 1007, date '2026-08-06',
            'https://example.invalid/contract-test', '{}'::jsonb, 'h');
    raise exception 'blank property_name was ACCEPTED';
  exception when check_violation then null;
  end;

  begin
    insert into plm.opa_property_character (
      licensed_property_id, character_id, property_name, character_name,
      brand_property_id, option_source_id, captured_at, source_url, raw, source_hash)
    values (900000005, 900000105, 'X', '   ', 1, 1007, date '2026-08-06',
            'https://example.invalid/contract-test', '{}'::jsonb, 'h');
    raise exception 'blank character_name was ACCEPTED';
  exception when check_violation then null;
  end;

  begin
    insert into plm.opa_property_character (
      licensed_property_id, character_id, property_name, character_name,
      brand_property_id, option_source_id, captured_at, source_url, line_of_business,
      raw, source_hash)
    values (900000006, 900000106, 'X', 'Y', 1, 1007, date '2026-08-06',
            'https://example.invalid/contract-test', 'Apparel', '{}'::jsonb, 'h');
    raise exception 'line_of_business = Apparel was ACCEPTED; the Home scope pin does not enforce';
  exception when check_violation then null;
  end;

  begin
    insert into plm.opa_property_character (
      licensed_property_id, character_id, property_name, character_name,
      brand_property_id, option_source_id, captured_at, source_url, resolution_status,
      raw, source_hash)
    values (900000007, 900000107, 'X', 'Y', 1, 1007, date '2026-08-06',
            'https://example.invalid/contract-test', 'definitely_not_a_status',
            '{}'::jsonb, 'h');
    raise exception 'resolution_status = definitely_not_a_status was ACCEPTED';
  exception when check_violation then null;
  end;

  -- 3e. FK delete actions, by catalog AND by behaviour.
  select c.confdeltype into v_confdeltype
  from pg_constraint c
  join pg_class rel on rel.oid = c.conrelid
  join pg_namespace n on n.oid = rel.relnamespace
  where n.nspname = 'plm' and rel.relname = 'opa_property_character'
    and c.conname = 'opa_property_character_property_id_fkey';
  if v_confdeltype <> 'r' then
    raise exception 'opa_property_character_property_id_fkey confdeltype=% (expected r=RESTRICT)',
      v_confdeltype;
  end if;

  select c.confdeltype into v_confdeltype
  from pg_constraint c
  join pg_class rel on rel.oid = c.conrelid
  join pg_namespace n on n.oid = rel.relnamespace
  where n.nspname = 'core' and rel.relname = 'property_character'
    and c.conname = 'property_character_property_id_fkey';
  if v_confdeltype <> 'r' then
    raise exception 'property_character_property_id_fkey confdeltype=% (expected r=RESTRICT)',
      v_confdeltype;
  end if;

  select c.confdeltype into v_confdeltype
  from pg_constraint c
  join pg_class rel on rel.oid = c.conrelid
  join pg_namespace n on n.oid = rel.relnamespace
  where n.nspname = 'core' and rel.relname = 'property_character'
    and c.conname = 'property_character_character_id_fkey';
  if v_confdeltype <> 'c' then
    raise exception 'property_character_character_id_fkey confdeltype=% (expected c=CASCADE)',
      v_confdeltype;
  end if;

  -- Behavioural: a resolved OPA row must BLOCK deletion of the core.property it names.
  insert into core.licensor (name, code) values ('Contract Test Licensor OPA', 'ZZTESTOPA')
    returning id into v_lic;
  insert into core.property (licensor_id, name, code)
    values (v_lic, 'Contract Test Property OPA', 'ZZTESTPROPOPA') returning id into v_prop;

  update plm.opa_property_character
    set property_id = v_prop, resolution_status = 'matched'
    where licensed_property_id = 900000001;

  begin
    delete from core.property where id = v_prop;
    raise exception 'delete of a core.property referenced by a resolved OPA row was '
      'ACCEPTED (expected RESTRICT)';
  exception when foreign_key_violation then null;
  end;

  -- ==================================================================================
  -- 4. NOTHING IN core.* WAS POPULATED. The junction lands EMPTY by design; the
  --    landing migration must not have inserted a single core row.
  -- ==================================================================================
  select count(*) into v_count from core.property_character
    where source = 'opa' and created_at < now();
  if v_count <> 0 then
    raise exception 'core.property_character is NOT empty (% rows). The landing migration '
      'must populate nothing -- core.character is 0 rows and resolution is an owner gate.',
      v_count;
  end if;

  -- ==================================================================================
  -- 5. THE AXIS-1 / AXIS-2 RECONCILIATION INVARIANT.
  --    core.style_guide.property_id is the single bridge between the axes, so every
  --    (style_guide.property_id, character_id) pair implied by core.style_guide_character
  --    must also exist in core.property_character. Trivially true while both are empty;
  --    asserted here so it cannot be quietly broken when they are first populated.
  -- ==================================================================================
  select count(*) into v_count
  from core.style_guide_character sgc
  join core.style_guide sg on sg.id = sgc.style_guide_id
  where sg.property_id is not null
    and not exists (
      select 1 from core.property_character pc
      where pc.property_id = sg.property_id
        and pc.character_id = sgc.character_id
    );
  if v_count <> 0 then
    raise exception 'axis reconciliation invariant BROKEN: % style-guide character edges '
      'imply a (property, character) pair absent from core.property_character. The two '
      'axis tables have drifted apart.', v_count;
  end if;

  -- ==================================================================================
  -- 6. RLS, POLICIES AND GRANTS. A policy is not a grant; both are required.
  -- ==================================================================================
  if not exists (
    select 1 from pg_class rel join pg_namespace n on n.oid = rel.relnamespace
    where n.nspname = 'plm' and rel.relname = 'opa_property_character' and rel.relrowsecurity
  ) then
    raise exception 'RLS is NOT enabled on plm.opa_property_character';
  end if;

  if not exists (
    select 1 from pg_class rel join pg_namespace n on n.oid = rel.relnamespace
    where n.nspname = 'core' and rel.relname = 'property_character' and rel.relrowsecurity
  ) then
    raise exception 'RLS is NOT enabled on core.property_character';
  end if;

  select count(*) into v_policies from pg_policies
    where schemaname = 'plm' and tablename = 'opa_property_character';
  if v_policies <> 1 then
    raise exception 'expected exactly 1 policy on plm.opa_property_character, found %',
      v_policies;
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'plm'
      and tablename = 'opa_property_character' and policyname = 'opa_property_character_read'
      and cmd = 'SELECT') then
    raise exception 'policy opa_property_character_read (SELECT) missing';
  end if;

  select count(*) into v_policies from pg_policies
    where schemaname = 'core' and tablename = 'property_character';
  if v_policies <> 2 then
    raise exception 'expected exactly 2 policies on core.property_character '
      '(shared_read, admin_write), found %', v_policies;
  end if;

  -- anon must hold nothing, on every new object.
  select count(*) into v_anon
  from information_schema.role_table_grants
  where grantee = 'anon'
    and (table_schema, table_name) in (
      ('plm','opa_property_character'),
      ('core','property_character'),
      ('api','opa_property_character'),
      ('api','opa_property_reconciliation'));
  if v_anon <> 0 then
    raise exception 'anon holds % privilege(s) on the new OPA objects; expected 0', v_anon;
  end if;

  -- authenticated must be able to read but never mutate the plm mirror.
  select count(*) into v_count
  from information_schema.role_table_grants
  where grantee = 'authenticated' and table_schema = 'plm'
    and table_name = 'opa_property_character'
    and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE');
  if v_count <> 0 then
    raise exception 'authenticated holds % mutation privilege(s) on plm.opa_property_character',
      v_count;
  end if;

  -- ==================================================================================
  -- 6b. THE READ POLICY MUST BE CLOSED — proved by EVALUATING RLS as real principals,
  --     not by reading the DDL. The DDL is exactly what was wrong before migration
  --     20260807190000: it said `using (true)` under a comment claiming it matched
  --     plm.erp_property, so every authenticated account — including vendor and
  --     viewer — could read the entire confidential Disney extract.
  -- ==================================================================================
  foreach v_obj in array array['vendor', 'viewer', 'designer'] loop
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims',
      format('{"app_metadata":{"roles":["%s"]}}', v_obj), true);
    select count(*) into v_count from plm.opa_property_character
      where licensed_property_id = 900000001;
    execute 'reset role';
    if v_count <> 0 then
      raise exception 'DISNEY EXTRACT IS READABLE BY %: it saw % row(s). The read policy '
        'must match the plm.erp_property posture (administrator / plm app access / '
        'sales / licensing) and must NOT be open to every authenticated account.',
        v_obj, v_count;
    end if;
  end loop;

  -- A principal with NO role at all must also see nothing.
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', '{"app_metadata":{"roles":[]}}', true);
  select count(*) into v_count from plm.opa_property_character
    where licensed_property_id = 900000001;
  execute 'reset role';
  if v_count <> 0 then
    raise exception 'a principal with NO app role read % OPA row(s)', v_count;
  end if;

  -- The api view is security_invoker, so it must inherit the restriction rather than
  -- become a way around it.
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', '{"app_metadata":{"roles":["vendor"]}}', true);
  select count(*) into v_count from api.opa_property_character
    where licensed_property_id = 900000001;
  execute 'reset role';
  if v_count <> 0 then
    raise exception 'vendor read % row(s) THROUGH api.opa_property_character — the view '
      'is escalating around the base-table RLS', v_count;
  end if;

  -- And the roles that SHOULD have access must actually have it, or the policy is
  -- merely broken in the other direction.
  foreach v_obj in array array['administrator', 'sales', 'licensing'] loop
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims',
      format('{"app_metadata":{"roles":["%s"]}}', v_obj), true);
    select count(*) into v_count from plm.opa_property_character
      where licensed_property_id = 900000001;
    execute 'reset role';
    if v_count <> 1 then
      raise exception '% could NOT read the OPA mirror (saw % rows, expected 1); the '
        'policy is too restrictive', v_obj, v_count;
    end if;
  end loop;

  -- ==================================================================================
  -- 6c. api.opa_property_reconciliation must be EXACTLY one row per OPA property node.
  --
  --     THE FIXTURE MUST BE ONE NODE WITH SEVERAL CHARACTERS IN DIFFERENT RESOLUTION
  --     STATES. That is the only shape that can tell the two view versions apart:
  --       old (grouped on licensed_property_id AND the per-row resolution columns)
  --           -> 2 rows, opa_character_count 1 and 1
  --       new (grouped on licensed_property_id alone)
  --           -> 1 row, opa_character_count 2, resolution_status 'mixed'
  --     Two DIFFERENT nodes with one character each cannot detect the regression,
  --     because different ids land in different groups under BOTH versions.
  -- ==================================================================================
  insert into plm.opa_property_character (
    licensed_property_id, character_id, property_name, character_name,
    brand_property_id, option_source_id, captured_at, source_url, raw, source_hash)
  values
    (900000010, 900000110, 'Contract Test Node Grain', 'Contract Test Char A',
     900000010, 1007, date '2026-08-06', 'https://example.invalid/contract-test',
     '{"fixture":true}'::jsonb, 'grainhash1'),
    (900000010, 900000111, 'Contract Test Node Grain', 'Contract Test Char B',
     900000010, 1007, date '2026-08-06', 'https://example.invalid/contract-test',
     '{"fixture":true}'::jsonb, 'grainhash2');

  -- Resolve exactly ONE of the two, so the node disagrees with itself.
  update plm.opa_property_character
     set property_id = v_prop,
         resolution_status = 'matched',
         resolution_reason = 'contract test node-grain fixture',
         resolved_at = timestamptz '2026-08-06 12:00:00+00',
         resolved_by = 'contract-test'
   where licensed_property_id = 900000010 and character_id = 900000110;

  select count(*) into v_count from api.opa_property_reconciliation
    where licensed_property_id = 900000010;
  if v_count <> 1 then
    raise exception 'api.opa_property_reconciliation returned % rows for ONE partially '
      'resolved OPA property node (expected exactly 1). It is grouping on the per-row '
      'resolution columns again, which splits a node and divides its character count.',
      v_count;
  end if;

  select opa_character_count, unresolved_character_count, resolution_status,
         matched_core_property_count, matched_core_property_ids, core_property_names
    into v_count, v_missing, v_status, v_policies, v_uuids, v_names
  from api.opa_property_reconciliation
  where licensed_property_id = 900000010;

  if v_count <> 2 then
    raise exception 'node 900000010 reports opa_character_count=% (expected 2); the '
      'character count is being divided across duplicate rows', v_count;
  end if;

  if v_status is distinct from 'mixed' then
    raise exception 'node 900000010 reports resolution_status=%L (expected ''mixed''); a '
      'node whose characters disagree must say so rather than splitting into rows',
      v_status;
  end if;

  if v_missing::integer <> 1 then
    raise exception 'node 900000010 reports unresolved_character_count=% (expected 1)',
      v_missing;
  end if;

  -- The aggregates must actually carry the resolution, not just be present.
  if v_policies <> 1 then
    raise exception 'node 900000010 reports matched_core_property_count=% (expected 1)',
      v_policies;
  end if;
  if v_uuids is null or not (v_prop = any(v_uuids)) then
    raise exception 'matched_core_property_ids does not contain the resolved property';
  end if;
  if v_names is null or not ('Contract Test Property OPA' = any(v_names)) then
    raise exception 'core_property_names does not contain the joined core.property name '
      '(got %). If this is NULL the LEFT JOIN is being suppressed by RLS.',
      coalesce(v_names::text, '<null>');
  end if;

  -- A fully unresolved node must report a concrete status, not 'mixed'.
  select resolution_status into v_status from api.opa_property_reconciliation
    where licensed_property_id = 900000002;
  if v_status is distinct from 'unresolved' then
    raise exception 'a fully unresolved node reports resolution_status=%L (expected '
      '''unresolved'')', v_status;
  end if;

  -- 6c-bis. THE ARRAYS MUST BE EMPTY, NEVER NULL (migration 20260807200000).
  --     array_agg(...) filter (...) over zero matching rows returns NULL, not '{}'.
  --     The view comment promised "empty", so a consumer testing `= '{}'` would have
  --     misread RLS suppression or a no-match as something else. coalesce makes the
  --     promise true; this asserts it stays true.
  select matched_core_property_ids, core_property_names
    into v_uuids, v_names
  from api.opa_property_reconciliation
  where licensed_property_id = 900000002;   -- an unmatched node

  if v_uuids is null then
    raise exception 'matched_core_property_ids is NULL for an unmatched node; it must be '
      'an EMPTY array. The comment promises empty and consumers will test = ''{}''.';
  end if;
  if v_names is null then
    raise exception 'core_property_names is NULL for an unmatched node; it must be an '
      'EMPTY array.';
  end if;
  if array_length(v_uuids, 1) is not null or array_length(v_names, 1) is not null then
    raise exception 'an unmatched node reported non-empty arrays (ids=%, names=%)',
      v_uuids::text, v_names::text;
  end if;

  -- ==================================================================================
  -- 7. BOTH api VIEWS MUST BE security_invoker. A definer view over an RLS table is a
  --    privilege-escalation path around that RLS.
  -- ==================================================================================
  foreach v_obj in array array['opa_property_character', 'opa_property_reconciliation'] loop
    select rel.reloptions into v_reloptions
    from pg_class rel join pg_namespace n on n.oid = rel.relnamespace
    where n.nspname = 'api' and rel.relname = v_obj;

    if v_reloptions is null
       or not ('security_invoker=true' = any(v_reloptions)) then
      raise exception 'api.% is NOT security_invoker (reloptions=%). It can escalate around '
        'the base table RLS.', v_obj, coalesce(v_reloptions::text, '<null>');
    end if;
  end loop;

  -- The view must expose the fixture rows and must NOT expose the raw/resolution internals.
  select count(*) into v_count from api.opa_property_character
    where property_name = 'Contract Test Property Alpha';
  if v_count <> 2 then
    raise exception 'api.opa_property_character does not surface both collision rows (got %)',
      v_count;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'api' and table_name = 'opa_property_character'
      and column_name in ('raw','source_hash','resolution_status','resolved_by')
  ) then
    raise exception 'api.opa_property_character leaks a mirror-internal column';
  end if;

  -- ==================================================================================
  -- 8. THE AMERICA/NEW_YORK DATE HAZARD. Demonstrated, not assumed: a UTC-MIDNIGHT
  --    timestamp reads back through ::date as the PREVIOUS day in server-local time,
  --    while a MIDDAY-UTC timestamp reads the same date in both zones. This is why
  --    captured_at is supplied explicitly and never derived from now().
  -- ==================================================================================
  select current_setting('TimeZone') into v_tz;
  v_midnight := timestamptz '2026-08-06 00:00:00+00';
  v_midday   := timestamptz '2026-08-06 12:00:00+00';

  if v_tz = 'America/New_York' then
    if (v_midnight at time zone 'UTC')::date = (v_midnight at time zone v_tz)::date then
      raise exception 'expected the UTC-midnight date hazard to be present under % but it '
        'was not; the assumption behind the midday pinning needs rechecking', v_tz;
    end if;
  end if;

  if (v_midday at time zone 'UTC')::date <> date '2026-08-06'
     or (v_midday at time zone 'America/New_York')::date <> date '2026-08-06' then
    raise exception 'midday-UTC pinning does NOT read as the same date in UTC and '
      'America/New_York; the captured_at convention is unsafe';
  end if;

  -- captured_at is a plain date and must survive verbatim regardless of server zone.
  if (select captured_at from plm.opa_property_character where licensed_property_id = 900000001)
     <> date '2026-08-06' then
    raise exception 'captured_at did not round-trip as the supplied date';
  end if;

  raise notice 'OPA landing contracts passed (server TimeZone=%).', v_tz;
end $$;

rollback;
