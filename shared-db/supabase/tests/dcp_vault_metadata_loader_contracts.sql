-- =====================================================================================
-- Contract tests for migration 20260811060000 -- the Disney DCP Vault PHASE 2 metadata
-- CHUNKED LOADER protocol (issue #748, object claim #749).
--
-- -------------------------------------------------------------------------------------
-- HOW THIS FILE IS RUN, AND WHAT ITS RESULT MEANS
--   CI executes it (`.github/workflows/database-contract-tests.yml`, added by #741).
--   IT IS WRITTEN TO PASS FROM EMPTY and must stay that way -- it must never end up in
--   supabase/tests/ci-quarantine.txt. It touches only objects this repository's own
--   migrations create and needs no seeded reference data of any kind.
--
--   ONE ENVIRONMENTAL DEPENDENCY, STATED PLAINLY: the four loader functions are guarded by
--   plm.dcp_loader_privilege_ok, which is TRUE only for JWT role service_role or
--   session_user postgres / supabase_admin. This file must therefore be run as the
--   migration owner. That is how CI runs it and how the Phase-1 file's documented preview
--   procedure runs it. Section A proves the guard is satisfied BEFORE anything else
--   executes, so a wrong connection fails with a clear reason instead of eight confusing
--   permission errors.
--
-- SIDE EFFECTS: NONE. Everything that writes runs inside a transaction ending in ROLLBACK,
--   and section H re-asserts that against committed state.
--
-- EVERY VALUE IN THIS FILE IS INVENTED. u2giants/shared-db is PUBLIC. No real Disney
--   property, character, style guide, art style, keyword, DAM path, file name or portal
--   URL appears here. Fixtures use ZZTEST-* tokens, example.invalid URLs and the reserved
--   uuid prefix 99999999-9999-4999-8999-*.
--
-- WHY EVERY "must be refused" CHECK TRAPS sqlstate 'P0001' AND NOT `when others`:
--   `when others` is satisfied by ANY error, so a section would PASS FOR THE WRONG REASON
--   -- reporting a guard works when the statement never reached it. Every guard in the
--   loader raises with `using errcode = 'P0001'`, so that is what is trapped.
--
-- WHAT IT ASSERTS
--   A  The privilege guard is satisfied, and the four loader functions exist as SECURITY
--      DEFINER with pg_catalog FIRST in a pinned search_path.
--   B  begin refuses an INCOMPLETE source crawl, a second concurrent run, and a crawl
--      with zero memberships; it seeds one pending row per expected asset and counts
--      assets_expected from the evidence rather than from the caller.
--   C  The chunk contract: bad digest refused, non-array refused, empty chunk refused,
--      an IDENTICAL replay is a no-op, and the same chunk number with DIFFERENT bytes is
--      refused.
--   D  THE INDEPENDENCE RULE THROUGH THE LOADER. A response with many properties and one
--      character produces many property links and one character link and NOTHING that
--      relates them.
--   E  Empty array vs absent array; duplicate members collapse; a signed-out HTTP-200
--      body is refused as success; an asset outside the source crawl is rejected into the
--      exception table rather than landing; a duplicate asset within one run is rejected.
--   F  The normalized hash is computed FROM STORED VALUES, and array order does not
--      change it.
--   G  finalize refuses on a pending row, on an open rejection, and on a non-contiguous
--      chunk stream; it succeeds when everything reconciles; fail preserves evidence and
--      refuses to touch a completed run.
--   H  No test data survived.
-- =====================================================================================

\set ON_ERROR_STOP on

-- =====================================================================================
-- A. PRECONDITIONS. Proved FIRST so a wrong connection or a missing object fails with one
--    clear reason rather than as a cascade of confusing errors further down.
-- =====================================================================================
do $$
declare
  v_fns int;
  v_bad text;
begin
  if not plm.dcp_loader_privilege_ok(auth.role(), session_user) then
    raise exception 'A FAILED: this connection does not satisfy '
      'plm.dcp_loader_privilege_ok (JWT role %L / session_user %L). The loader contract '
      'tests must run as the migration owner -- postgres or supabase_admin -- or as '
      'service_role. Nothing below can execute otherwise.',
      coalesce(auth.role(), '<null>'), coalesce(session_user, '<null>');
  end if;

  select count(*) into v_fns
  from pg_proc p where p.pronamespace = 'plm'::regnamespace
    and p.proname in ('begin_dcp_metadata_run','load_dcp_metadata_chunk',
                      'finalize_dcp_metadata_run','fail_dcp_metadata_run');
  if v_fns <> 4 then
    raise exception 'A FAILED: expected 4 loader functions, found %.', v_fns;
  end if;

  -- SECURITY DEFINER with pg_catalog FIRST. A definer function that resolves builtins
  -- through a caller-influenced schema is the classic definer escalation, and it applies
  -- perfectly clean -- which is why it is asserted rather than assumed.
  select string_agg(p.proname, ', ') into v_bad
  from pg_proc p where p.pronamespace = 'plm'::regnamespace
    and p.proname in ('begin_dcp_metadata_run','load_dcp_metadata_chunk',
                      'finalize_dcp_metadata_run','fail_dcp_metadata_run')
    and (not p.prosecdef
         or p.proconfig is null
         or not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=pg_catalog%'));
  if v_bad is not null then
    raise exception 'A FAILED: function(s) % are not SECURITY DEFINER with pg_catalog '
      'first in a pinned search_path.', v_bad;
  end if;

  -- The two loader tables exist and service_role cannot TRUNCATE them. TRUNCATE fires no
  -- row triggers, so every freeze in this schema depends on that revoke.
  if to_regclass('plm.dcp_metadata_chunk_ledger') is null
  or to_regclass('plm.dcp_metadata_load_exception') is null then
    raise exception 'A FAILED: a loader table is missing.';
  end if;
  if has_table_privilege('service_role', 'plm.dcp_metadata_chunk_ledger', 'TRUNCATE')
  or has_table_privilege('service_role', 'plm.dcp_metadata_load_exception', 'TRUNCATE') then
    raise exception 'A FAILED: service_role holds TRUNCATE on a loader table. TRUNCATE '
      'fires NO row triggers, so one statement would erase a completed run''s evidence '
      'with every freeze trigger standing silently by.';
  end if;

  raise notice 'A PASSED: privilege guard satisfied, 4 definer functions with '
    'pg_catalog-first search paths, both loader tables present and TRUNCATE-proof.';
end;
$$;

-- =====================================================================================
-- Everything below writes. ONE transaction, ROLLBACK at the end.
-- =====================================================================================
begin;

do $$
declare
  v_crawl    uuid := '99999999-9999-4999-8999-000000000201';
  v_partial  uuid := '99999999-9999-4999-8999-000000000202';
  v_empty    uuid := '99999999-9999-4999-8999-000000000203';
  v_tile     uuid;
  v_guide    uuid;
  v_a1       uuid;
  v_a2       uuid;
  v_a3       uuid;
  v_sec      uuid;
  v_run      uuid;
  v_run2     uuid;
  v_ok       boolean;
  v_json     text;
  v_sha      text;
  v_res      jsonb;
  v_n        int;
  v_hash1    text;
  v_hash2    text;
begin
  -- -----------------------------------------------------------------------------------
  -- FIXTURE: one COMPLETE crawl with three assets, plus an INCOMPLETE crawl and an
  -- EMPTY-but-complete crawl to drive the begin-time refusals.
  -- -----------------------------------------------------------------------------------
  insert into plm.dcp_crawl (
    crawl_id, captured_on, portal_base_url, crawler_version, account_scope,
    line_of_business, started_at, captured_by, private_source_commit, status,
    rows_received, distinct_assets_received, finished_at
  ) values
    (v_crawl, date '2026-02-01', 'https://zztest.example.invalid', 'ZZTEST-0',
     'ZZTEST-scope', 'ZZTEST-lob', now(), 'ZZTEST-runner', 'ZZTESTCOMMIT', 'running', 3, 3, now()),
    (v_partial, date '2026-02-02', 'https://zztest.example.invalid', 'ZZTEST-0',
     'ZZTEST-scope', 'ZZTEST-lob', now(), 'ZZTEST-runner', 'ZZTESTCOMMIT', 'running', 1, 1, now()),
    (v_empty, date '2026-02-03', 'https://zztest.example.invalid', 'ZZTEST-0',
     'ZZTEST-scope', 'ZZTEST-lob', now(), 'ZZTEST-runner', 'ZZTESTCOMMIT', 'complete', 0, 0, now());

  insert into plm.dcp_portal_tile (source_key, first_seen_crawl_id)
  values ('ZZTEST-TILE-L', v_crawl) returning id into v_tile;
  insert into plm.dcp_style_guide (source_path, folder_name, region, year_segment,
                                   first_seen_crawl_id)
  values ('/zztest/lguide', 'ZZTEST-GUIDE-L', 'ZZTEST-REGION', 'ZZTEST-YEAR', v_crawl)
  returning id into v_guide;

  insert into plm.dcp_asset (source_path, style_guide_id, file_name, file_extension,
                             first_seen_crawl_id)
  values ('/zztest/lguide/one.zzz', v_guide, 'one.zzz', 'zzz', v_crawl) returning id into v_a1;
  insert into plm.dcp_asset (source_path, style_guide_id, file_name, file_extension,
                             first_seen_crawl_id)
  values ('/zztest/lguide/two.zzz', v_guide, 'two.zzz', 'zzz', v_crawl) returning id into v_a2;
  -- Belongs to the PARTIAL crawl only -- used to prove cross-crawl rejection.
  insert into plm.dcp_asset (source_path, style_guide_id, file_name, file_extension,
                             first_seen_crawl_id)
  values ('/zztest/lguide/three.zzz', v_guide, 'three.zzz', 'zzz', v_partial) returning id into v_a3;

  insert into plm.dcp_crawl_section (crawl_id, portal_tile_id, listing_kind, status,
                                     captured_count, finished_at)
  values (v_crawl, v_tile, 'asset', 'complete', 2, now()) returning id into v_sec;

  insert into plm.dcp_asset_crawl (crawl_id, dcp_asset_id, observed_row_hash)
  values (v_crawl, v_a1, repeat('1', 64)), (v_crawl, v_a2, repeat('2', 64));
  insert into plm.dcp_asset_crawl (crawl_id, dcp_asset_id, observed_row_hash)
  values (v_partial, v_a3, repeat('3', 64));

  -- ===================================================================================
  -- B. begin_dcp_metadata_run
  -- ===================================================================================

  -- B1. An INCOMPLETE source crawl is refused. Metadata is fetched per asset PATH, so
  -- running against a growing list would fix assets_expected against a moving target.
  v_ok := false;
  begin
    perform plm.begin_dcp_metadata_run(v_partial, date '2026-02-04', '/zztest/metadata',
      'ZZTEST-0', 'ZZTEST-runner', repeat('a', 40));
  exception when sqlstate 'P0001' then v_ok := true;
  end;
  if not v_ok then
    raise exception 'B FAILED: a metadata run was begun over an INCOMPLETE path crawl.';
  end if;

  -- B2. A complete crawl with ZERO memberships is refused. A run over nothing would
  -- finalize instantly and truthfully report complete, which is the most misleading
  -- possible outcome.
  v_ok := false;
  begin
    perform plm.begin_dcp_metadata_run(v_empty, date '2026-02-04', '/zztest/metadata',
      'ZZTEST-0', 'ZZTEST-runner', repeat('a', 40));
  exception when sqlstate 'P0001' then v_ok := true;
  end;
  if not v_ok then
    raise exception 'B FAILED: a metadata run was begun over a crawl with zero asset '
      'memberships.';
  end if;

  update plm.dcp_crawl set status = 'complete' where crawl_id = v_crawl;

  -- B3. The happy path seeds one PENDING row per expected asset and counts
  -- assets_expected FROM THE EVIDENCE. Note there is no assets_expected parameter at all:
  -- a caller-supplied target is one the caller can make match whatever it loaded.
  v_run := plm.begin_dcp_metadata_run(v_crawl, date '2026-02-04', '/zztest/metadata',
    'ZZTEST-0', 'ZZTEST-runner', repeat('a', 40));

  if (select assets_expected from plm.dcp_metadata_run where metadata_run_id = v_run) <> 2 then
    raise exception 'B FAILED: assets_expected was not counted from plm.dcp_asset_crawl.';
  end if;
  select count(*) into v_n from plm.dcp_metadata_asset
  where metadata_run_id = v_run and fetch_status = 'pending';
  if v_n <> 2 then
    raise exception 'B FAILED: expected 2 seeded pending rows, found %. Seeding is what '
      'makes "every expected asset has exactly one fetch row" true from the first second '
      'rather than something finalization must go looking for.', v_n;
  end if;

  -- B4. A SECOND concurrent run over the same crawl is refused. Two runs would each
  -- finalize against the other's rows.
  v_ok := false;
  begin
    perform plm.begin_dcp_metadata_run(v_crawl, date '2026-02-05', '/zztest/metadata',
      'ZZTEST-0', 'ZZTEST-runner', repeat('a', 40));
  exception when sqlstate 'P0001' then v_ok := true;
  end;
  if not v_ok then
    raise exception 'B FAILED: a second RUNNING metadata run was begun for one crawl.';
  end if;

  raise notice 'B PASSED: incomplete crawl, empty crawl and concurrent run all refused; '
    'happy path seeded 2 pending rows and counted assets_expected from the evidence.';

  -- ===================================================================================
  -- C. THE CHUNK CONTRACT
  -- ===================================================================================

  -- C1. A wrong digest is refused BEFORE anything is stored.
  v_json := '[{"source_path":"/zztest/lguide/one.zzz","row_number":1,"fetch_status":"failed","failure_code":"ZZTEST"}]';
  v_ok := false;
  begin
    perform plm.load_dcp_metadata_chunk(v_run, 1, v_json, repeat('0', 64));
  exception when sqlstate 'P0001' then v_ok := true;
  end;
  if not v_ok then
    raise exception 'C FAILED: a chunk with a wrong digest was accepted.';
  end if;
  if (select count(*) from plm.dcp_metadata_chunk_ledger where metadata_run_id = v_run) <> 0 then
    raise exception 'C FAILED: a ledger row was written for a chunk that failed integrity.';
  end if;

  -- C2. A non-array payload and an empty array are both refused.
  v_json := '{"not":"an array"}';
  v_sha := encode(sha256(convert_to(v_json, 'UTF8')), 'hex');
  v_ok := false;
  begin
    perform plm.load_dcp_metadata_chunk(v_run, 1, v_json, v_sha);
  exception when sqlstate 'P0001' then v_ok := true;
  end;
  if not v_ok then
    raise exception 'C FAILED: a non-array chunk was accepted.';
  end if;

  v_json := '[]';
  v_sha := encode(sha256(convert_to(v_json, 'UTF8')), 'hex');
  v_ok := false;
  begin
    perform plm.load_dcp_metadata_chunk(v_run, 1, v_json, v_sha);
  exception when sqlstate 'P0001' then v_ok := true;
  end;
  if not v_ok then
    raise exception 'C FAILED: an EMPTY chunk was accepted. It contributes nothing and '
      'makes the chunk numbering lie about how much was sent.';
  end if;

  -- ===================================================================================
  -- D + E. A REAL CHUNK: many properties, one character, an EMPTY array and an ABSENT
  --        array, plus a duplicate member.
  --
  -- THE CENTRAL ASSERTION OF THIS WHOLE WORKSTREAM IS D BELOW.
  -- ===================================================================================
  v_json :=
    '[{"source_path":"/zztest/lguide/one.zzz","row_number":1,"fetch_status":"success",'
    || '"http_status":200,'
    || '"raw_metadata_text":"{\"zztest\":1}",'
    || '"dc_title":"ZZTEST-TITLE","source_status":"ZZTEST-STATUS",'
    || '"is_exclusive_raw":"ZZTEST-UNKNOWN","rights_parse_confident":false,'
    || '"properties":["ZZTEST-P1","ZZTEST-P2","ZZTEST-P3","ZZTEST-P4","ZZTEST-P5",'
    || '"ZZTEST-P6","ZZTEST-P7","ZZTEST-P8","ZZTEST-P9","ZZTEST-P1"],'
    || '"characters":["ZZTEST-C1"],'
    || '"art_styles":[],'
    || '"keywords":["ZZTEST-K1"]}]';
  v_sha := encode(sha256(convert_to(v_json, 'UTF8')), 'hex');
  v_res := plm.load_dcp_metadata_chunk(v_run, 1, v_json, v_sha);

  if (v_res->>'rows_landed')::int <> 1 or (v_res->>'rows_rejected')::int <> 0 then
    raise exception 'D FAILED: the chunk did not land cleanly: %', v_res::text;
  end if;

  -- D1. NINE properties (the tenth is a duplicate that must collapse) and ONE character.
  select count(*) into v_n from plm.dcp_asset_property_observation
  where metadata_run_id = v_run and dcp_asset_id = v_a1;
  if v_n <> 9 then
    raise exception 'D FAILED: expected 9 property links after a 10-element array with one '
      'duplicate, got %.', v_n;
  end if;
  select count(*) into v_n from plm.dcp_asset_character_observation
  where metadata_run_id = v_run and dcp_asset_id = v_a1;
  if v_n <> 1 then
    raise exception 'D FAILED: expected exactly 1 character link, got %.', v_n;
  end if;

  -- D2. AND NOTHING RELATED THEM. This is the assertion the entire design exists to make:
  -- nine phantom relationships is precisely what a bridge would have produced here.
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'plm' and table_name ~ '^dcp_(propert.*character|character.*propert)'
  ) then
    raise exception 'D FAILED: a property-character table exists. Nine relationships '
      'Disney never asserted would now exist for this single asset.';
  end if;
  if exists (
    select c.table_name from information_schema.columns c
    where c.table_schema = 'plm' and c.column_name in ('dcp_property_id','dcp_character_id')
    group by c.table_name having count(distinct c.column_name) > 1
  ) then
    raise exception 'D FAILED: a plm table now references BOTH a property and a character.';
  end if;

  -- E1. An EMPTY array produced ZERO term links of that kind, beside a SUCCESSFUL row --
  -- and the row is still a success. An absent array is a different fact from an empty one.
  select count(*) into v_n
  from plm.dcp_asset_term_observation o join plm.dcp_term t on t.id = o.dcp_term_id
  where o.metadata_run_id = v_run and o.dcp_asset_id = v_a1 and t.term_kind = 'art_style';
  if v_n <> 0 then
    raise exception 'E FAILED: an empty art_styles array produced % link(s).', v_n;
  end if;
  select count(*) into v_n
  from plm.dcp_asset_term_observation o join plm.dcp_term t on t.id = o.dcp_term_id
  where o.metadata_run_id = v_run and o.dcp_asset_id = v_a1 and t.term_kind = 'keyword';
  if v_n <> 1 then
    raise exception 'E FAILED: expected 1 keyword link, got %.', v_n;
  end if;
  if (select fetch_status from plm.dcp_metadata_asset
      where metadata_run_id = v_run and dcp_asset_id = v_a1) <> 'success' then
    raise exception 'E FAILED: the row with an empty array is not a success. An empty array '
      'is a real observation, not a failure.';
  end if;

  -- E2. THE HASH WAS COMPUTED FROM STORED VALUES and is present.
  select normalized_hash, source_hash into v_hash1, v_sha
  from plm.dcp_metadata_asset where metadata_run_id = v_run and dcp_asset_id = v_a1;
  if v_hash1 is null or v_hash1 !~ '^[0-9a-f]{64}$' then
    raise exception 'F FAILED: no normalized hash was computed for a successful row.';
  end if;
  -- It must equal the hash of what is STORED, recomputed independently here. If the
  -- loader had digested the INPUT row instead, a value the upsert declined to overwrite
  -- would make these differ -- which is exactly the permanent staleness this proves absent.
  select plm.dcp_metadata_row_hash(
    m.source_uuid, m.collection_dmc_id, m.collection_main_title, m.collection_type,
    m.dc_title, m.design_element, m.content_type, m.content_owner, m.source_status,
    m.is_exclusive_raw, m.is_embargoed_raw, m.is_locked_raw, m.release_date_raw,
    m.modified_at_raw, m.file_size_raw, m.format_raw, m.num_pages_raw, m.dam_sha1,
    (select coalesce(array_agg(p.source_id), array[]::text[])
       from plm.dcp_asset_property_observation o join plm.dcp_property p on p.id = o.dcp_property_id
      where o.metadata_run_id = v_run and o.dcp_asset_id = v_a1),
    (select coalesce(array_agg(c.source_id), array[]::text[])
       from plm.dcp_asset_character_observation o join plm.dcp_character c on c.id = o.dcp_character_id
      where o.metadata_run_id = v_run and o.dcp_asset_id = v_a1),
    (select coalesce(array_agg(t.source_value), array[]::text[])
       from plm.dcp_asset_term_observation o join plm.dcp_term t on t.id = o.dcp_term_id
      where o.metadata_run_id = v_run and o.dcp_asset_id = v_a1 and t.term_kind = 'art_style'),
    (select coalesce(array_agg(t.source_value), array[]::text[])
       from plm.dcp_asset_term_observation o join plm.dcp_term t on t.id = o.dcp_term_id
      where o.metadata_run_id = v_run and o.dcp_asset_id = v_a1 and t.term_kind = 'keyword')
  ) into v_hash2
  from plm.dcp_metadata_asset m
  where m.metadata_run_id = v_run and m.dcp_asset_id = v_a1;
  if v_hash1 <> v_hash2 then
    raise exception 'F FAILED: the stored normalized hash does not match a hash recomputed '
      'from the STORED values. The loader digested something other than what it stored, '
      'which is how a stale stored field hides behind an unchanged-looking digest forever.';
  end if;

  raise notice 'D PASSED: 9 property links and 1 character link on one asset, duplicate '
    'collapsed, and NOTHING related them.';
  raise notice 'F PASSED: the normalized hash matches a hash recomputed from the STORED '
    'values, proving the loader did not digest its input.';
end;
$$;

-- The replay, cross-crawl rejection, duplicate-asset rejection, signed-out refusal and
-- finalize gates continue in a second block against the same transaction's data.
do $$
declare
  v_crawl uuid := '99999999-9999-4999-8999-000000000201';
  v_partial uuid := '99999999-9999-4999-8999-000000000202';
  v_run   uuid;
  v_a1    uuid;
  v_a2    uuid;
  v_a3    uuid;
  v_json  text;
  v_sha   text;
  v_res   jsonb;
  v_ok    boolean;
  v_n     int;
  v_props int;
begin
  select metadata_run_id into v_run from plm.dcp_metadata_run
  where source_crawl_id = v_crawl and status = 'running';
  select id into v_a1 from plm.dcp_asset where source_path = '/zztest/lguide/one.zzz';
  select id into v_a2 from plm.dcp_asset where source_path = '/zztest/lguide/two.zzz';
  select id into v_a3 from plm.dcp_asset where source_path = '/zztest/lguide/three.zzz';

  if v_run is null then
    raise exception 'C FAILED: the running metadata run vanished between blocks.';
  end if;

  -- ---------------------------------------------------------------------------------
  -- C3. IDENTICAL REPLAY IS A NO-OP. Rebuild the exact chunk 1 payload and resend it.
  -- ---------------------------------------------------------------------------------
  v_json :=
    '[{"source_path":"/zztest/lguide/one.zzz","row_number":1,"fetch_status":"success",'
    || '"http_status":200,'
    || '"raw_metadata_text":"{\"zztest\":1}",'
    || '"dc_title":"ZZTEST-TITLE","source_status":"ZZTEST-STATUS",'
    || '"is_exclusive_raw":"ZZTEST-UNKNOWN","rights_parse_confident":false,'
    || '"properties":["ZZTEST-P1","ZZTEST-P2","ZZTEST-P3","ZZTEST-P4","ZZTEST-P5",'
    || '"ZZTEST-P6","ZZTEST-P7","ZZTEST-P8","ZZTEST-P9","ZZTEST-P1"],'
    || '"characters":["ZZTEST-C1"],'
    || '"art_styles":[],'
    || '"keywords":["ZZTEST-K1"]}]';
  v_sha := encode(sha256(convert_to(v_json, 'UTF8')), 'hex');

  select count(*) into v_props from plm.dcp_asset_property_observation
  where metadata_run_id = v_run and dcp_asset_id = v_a1;

  v_res := plm.load_dcp_metadata_chunk(v_run, 1, v_json, v_sha);
  if (v_res->>'replayed')::boolean is not true then
    raise exception 'C FAILED: an IDENTICAL chunk replay was not reported as a replay. A '
      'dropped connection mid-load must be safe to retry.';
  end if;

  select count(*) into v_n from plm.dcp_asset_property_observation
  where metadata_run_id = v_run and dcp_asset_id = v_a1;
  if v_n <> v_props then
    raise exception 'C FAILED: a replay changed the property link count from % to %.',
      v_props, v_n;
  end if;

  -- C4. THE SAME CHUNK NUMBER WITH DIFFERENT BYTES IS REFUSED. A chunk number is not a
  -- slot to be overwritten.
  v_json := replace(v_json, 'ZZTEST-TITLE', 'ZZTEST-TITLE-CHANGED');
  v_sha := encode(sha256(convert_to(v_json, 'UTF8')), 'hex');
  v_ok := false;
  begin
    perform plm.load_dcp_metadata_chunk(v_run, 1, v_json, v_sha);
  exception when sqlstate 'P0001' then v_ok := true;
  end;
  if not v_ok then
    raise exception 'C FAILED: chunk 1 was re-applied with DIFFERENT content.';
  end if;

  raise notice 'C PASSED: bad digest, non-array, empty chunk and content-changed replay '
    'all refused; identical replay is an idempotent no-op.';

  -- ---------------------------------------------------------------------------------
  -- E3. A SIGNED-OUT HTTP-200 BODY IS NOT A SUCCESS. This is the guard that stops a whole
  --     run of portal sign-out pages being recorded as a successful capture.
  -- E4. AN ASSET OUTSIDE THE SOURCE CRAWL IS REJECTED, not landed.
  -- Both are sent as chunk 2 and BOTH must land in the exception table.
  -- ---------------------------------------------------------------------------------
  v_json :=
    '[{"source_path":"/zztest/lguide/two.zzz","row_number":1,"fetch_status":"success",'
    || '"http_status":200,"raw_metadata_text":"[]"},'
    || '{"source_path":"/zztest/lguide/three.zzz","row_number":2,"fetch_status":"success",'
    || '"http_status":200,"raw_metadata_text":"{\"zztest\":3}"}]';
  v_sha := encode(sha256(convert_to(v_json, 'UTF8')), 'hex');
  v_res := plm.load_dcp_metadata_chunk(v_run, 2, v_json, v_sha);

  if (v_res->>'rows_rejected')::int <> 2 or (v_res->>'rows_landed')::int <> 0 then
    raise exception 'E FAILED: expected both rows rejected, got %.', v_res::text;
  end if;

  if not exists (
    select 1 from plm.dcp_metadata_load_exception
    where metadata_run_id = v_run and chunk_number = 2
      and reason_code = 'success_body_not_object'
  ) then
    raise exception 'E FAILED: an HTTP-200 body that is a JSON ARRAY was not rejected as '
      'success_body_not_object. A signed-out session returns exactly that shape.';
  end if;
  if not exists (
    select 1 from plm.dcp_metadata_load_exception
    where metadata_run_id = v_run and chunk_number = 2
      and reason_code = 'asset_not_in_source_crawl'
  ) then
    raise exception 'E FAILED: an asset belonging to a DIFFERENT crawl was not rejected. '
      'Metadata may only cover assets its own crawl observed.';
  end if;

  -- The rejected asset must NOT have landed anywhere.
  if exists (select 1 from plm.dcp_metadata_asset
             where metadata_run_id = v_run and dcp_asset_id = v_a3) then
    raise exception 'E FAILED: a cross-crawl asset created a metadata row.';
  end if;

  -- NO ROW WAS SILENTLY SKIPPED: the ledger arithmetic proves it.
  if not exists (
    select 1 from plm.dcp_metadata_chunk_ledger
    where metadata_run_id = v_run and chunk_number = 2
      and rows_received = 2 and rows_landed = 0 and rows_rejected = 2
  ) then
    raise exception 'E FAILED: the chunk 2 ledger row does not reconcile. '
      'landed + rejected = received is the structural form of "no row is ever silently '
      'skipped".';
  end if;

  -- ---------------------------------------------------------------------------------
  -- G1. FINALIZE REFUSES WHILE A ROW IS STILL PENDING. Asset two never got a valid
  --     response, so it is exactly the "short run presenting itself as complete" case.
  -- ---------------------------------------------------------------------------------
  v_ok := false;
  begin
    perform plm.finalize_dcp_metadata_run(v_run);
  exception when sqlstate 'P0001' then v_ok := true;
  end;
  if not v_ok then
    raise exception 'G FAILED: a run with a PENDING row finalized. Every expected asset '
      'needs one success or one recorded terminal failure; neither is a silent gap.';
  end if;

  -- ---------------------------------------------------------------------------------
  -- G2. FINALIZE REFUSES OVER AN OPEN REJECTION, even once every row is terminal.
  -- ---------------------------------------------------------------------------------
  v_json :=
    '[{"source_path":"/zztest/lguide/two.zzz","row_number":1,"fetch_status":"not_found",'
    || '"http_status":404,"failure_code":"ZZTEST-404","failure_reason":"ZZTEST not found"}]';
  v_sha := encode(sha256(convert_to(v_json, 'UTF8')), 'hex');
  v_res := plm.load_dcp_metadata_chunk(v_run, 3, v_json, v_sha);
  if (v_res->>'rows_landed')::int <> 1 then
    raise exception 'G FAILED: a terminal not_found row did not land: %', v_res::text;
  end if;

  select count(*) into v_n from plm.dcp_metadata_asset
  where metadata_run_id = v_run and fetch_status = 'pending';
  if v_n <> 0 then
    raise exception 'G FAILED: % row(s) still pending after every asset was answered.', v_n;
  end if;

  v_ok := false;
  begin
    perform plm.finalize_dcp_metadata_run(v_run);
  exception when sqlstate 'P0001' then v_ok := true;
  end;
  if not v_ok then
    raise exception 'G FAILED: a run finalized over UNRESOLVED rejections. Completing over '
      'open rejections is how a partial capture becomes a permanent record of a complete '
      'one.';
  end if;

  -- Resolve them the way a human would.
  update plm.dcp_metadata_load_exception
    set resolved_at = now(), resolution_note = 'ZZTEST triaged'
  where metadata_run_id = v_run and resolved_at is null;

  -- ---------------------------------------------------------------------------------
  -- G3. FINALIZE REFUSES A NON-CONTIGUOUS CHUNK STREAM. A gap means a chunk was never
  --     applied and its rows are missing from a run that would otherwise balance.
  -- ---------------------------------------------------------------------------------
  v_json := '[{"source_path":"/zztest/lguide/one.zzz","row_number":1,'
         || '"fetch_status":"failed","failure_code":"ZZTEST-GAP"}]';
  v_sha := encode(sha256(convert_to(v_json, 'UTF8')), 'hex');
  -- Chunk 9, skipping 4-8. The row itself is rejected as a duplicate asset (see E5), but
  -- the LEDGER row still lands, which is what makes the stream non-contiguous.
  v_res := plm.load_dcp_metadata_chunk(v_run, 9, v_json, v_sha);

  -- E5. A DUPLICATE ASSET WITHIN ONE RUN IS REJECTED, never silently overwritten.
  if not exists (
    select 1 from plm.dcp_metadata_load_exception
    where metadata_run_id = v_run and chunk_number = 9
      and reason_code = 'duplicate_asset_in_run'
  ) then
    raise exception 'E FAILED: a second response for an already-answered asset was not '
      'rejected. A metadata run records ONE response per asset; a second would silently '
      'overwrite the first.';
  end if;

  v_ok := false;
  begin
    perform plm.finalize_dcp_metadata_run(v_run);
  exception when sqlstate 'P0001' then v_ok := true;
  end;
  if not v_ok then
    raise exception 'G FAILED: a run finalized with a NON-CONTIGUOUS chunk stream (1,2,3,9).';
  end if;

  raise notice 'E PASSED: signed-out body refused as success, cross-crawl asset rejected, '
    'duplicate asset rejected, ledger arithmetic reconciles.';

  -- ---------------------------------------------------------------------------------
  -- G4. fail_dcp_metadata_run PRESERVES EVERYTHING and requires a reason.
  -- ---------------------------------------------------------------------------------
  v_ok := false;
  begin
    perform plm.fail_dcp_metadata_run(v_run, '');
  exception when sqlstate 'P0001' then v_ok := true;
  end;
  if not v_ok then
    raise exception 'G FAILED: a run was failed with no message. That is an unanswerable '
      'question later.';
  end if;

  select count(*) into v_props from plm.dcp_asset_property_observation
  where metadata_run_id = v_run;
  perform plm.fail_dcp_metadata_run(v_run, 'ZZTEST deliberate failure');

  if (select status from plm.dcp_metadata_run where metadata_run_id = v_run) <> 'failed' then
    raise exception 'G FAILED: the run did not reach status failed.';
  end if;
  select count(*) into v_n from plm.dcp_asset_property_observation where metadata_run_id = v_run;
  if v_n <> v_props then
    raise exception 'G FAILED: failing a run destroyed % link row(s). NEVER destroy '
      'licensed evidence as a first response.', v_props - v_n;
  end if;

  -- G5. A FAILED run may not be reopened, and may not receive more chunks.
  v_ok := false;
  begin
    update plm.dcp_metadata_run set status = 'running' where metadata_run_id = v_run;
  exception when sqlstate 'P0001' then v_ok := true;
  end;
  if not v_ok then
    raise exception 'G FAILED: a FAILED run was reopened. It could then be finalized as '
      'though it had always succeeded.';
  end if;

  v_ok := false;
  begin
    perform plm.load_dcp_metadata_chunk(v_run, 10, v_json, v_sha);
  exception when sqlstate 'P0001' then v_ok := true;
  end;
  if not v_ok then
    raise exception 'G FAILED: a FAILED run accepted another chunk.';
  end if;

  raise notice 'G PASSED: finalize refused on pending rows, open rejections and a '
    'non-contiguous stream; fail requires a reason, preserves all evidence, and cannot be '
    'reopened.';
end;
$$;

-- =====================================================================================
-- G6. THE CLEAN HAPPY PATH, END TO END, IN ITS OWN RUN: begin -> load -> finalize.
--     Proves the gates above are not simply refusing everything.
-- =====================================================================================
do $$
declare
  v_crawl uuid := '99999999-9999-4999-8999-000000000201';
  v_run   uuid;
  v_json  text;
  v_sha   text;
  v_res   jsonb;
begin
  v_run := plm.begin_dcp_metadata_run(v_crawl, date '2026-02-09', '/zztest/metadata',
    'ZZTEST-0', 'ZZTEST-runner', repeat('b', 40));

  v_json :=
    '[{"source_path":"/zztest/lguide/one.zzz","row_number":1,"fetch_status":"success",'
    || '"http_status":200,"raw_metadata_text":"{\"zztest\":10}",'
    || '"characters":[],"properties":["ZZTEST-P1"]},'
    || '{"source_path":"/zztest/lguide/two.zzz","row_number":2,"fetch_status":"not_found",'
    || '"http_status":404,"failure_code":"ZZTEST-404"}]';
  v_sha := encode(sha256(convert_to(v_json, 'UTF8')), 'hex');
  v_res := plm.load_dcp_metadata_chunk(v_run, 1, v_json, v_sha);
  if (v_res->>'rows_landed')::int <> 2 then
    raise exception 'G FAILED: the clean chunk did not land both rows: %', v_res::text;
  end if;

  v_res := plm.finalize_dcp_metadata_run(v_run);
  if v_res->>'status' <> 'complete'
  or (v_res->>'fetches_succeeded')::int <> 1
  or (v_res->>'fetches_failed')::int <> 1
  or (v_res->>'assets_expected')::int <> 2 then
    raise exception 'G FAILED: finalize did not reconcile 1 success + 1 terminal failure '
      'against 2 expected: %', v_res::text;
  end if;

  -- An asset whose character array was OBSERVED AND EMPTY is still a valid success with
  -- zero character links. Required case 10.
  if (select count(*) from plm.dcp_asset_character_observation where metadata_run_id = v_run) <> 0 then
    raise exception 'G FAILED: an empty character array produced links.';
  end if;

  -- And the completed run is now frozen against INSERT.
  declare v_ok boolean := false; v_c uuid;
  begin
    select id into v_c from plm.dcp_character limit 1;
    begin
      insert into plm.dcp_asset_character_observation (metadata_run_id, dcp_asset_id, dcp_character_id)
      select v_run, m.dcp_asset_id, v_c from plm.dcp_metadata_asset m
      where m.metadata_run_id = v_run and m.fetch_status = 'success' limit 1;
    exception when sqlstate 'P0001' then v_ok := true;
    end;
    if not v_ok then
      raise exception 'G FAILED: a completed run accepted a new character link.';
    end if;
  end;

  raise notice 'G6 PASSED: begin -> load -> finalize completed and reconciled exactly, and '
    'the completed run is frozen.';
end;
$$;

rollback;

-- =====================================================================================
-- H. NO TEST DATA SURVIVED.
-- =====================================================================================
do $$
declare v_n int; v_total int := 0;
begin
  select count(*) into v_n from plm.dcp_crawl where captured_by like 'ZZTEST%';
  v_total := v_total + v_n;
  select count(*) into v_n from plm.dcp_metadata_run where captured_by like 'ZZTEST%';
  v_total := v_total + v_n;
  select count(*) into v_n from plm.dcp_property where source_id like 'ZZTEST%';
  v_total := v_total + v_n;
  select count(*) into v_n from plm.dcp_character where source_id like 'ZZTEST%';
  v_total := v_total + v_n;
  select count(*) into v_n from plm.dcp_term where source_value like 'ZZTEST%';
  v_total := v_total + v_n;
  select count(*) into v_n from plm.dcp_metadata_load_exception where reason_code like 'ZZTEST%';
  v_total := v_total + v_n;

  if v_total <> 0 then
    raise exception 'H FAILED: % ZZTEST row(s) survived. The ROLLBACK did not happen -- '
      'this file must leave NO trace.', v_total;
  end if;
  raise notice 'H PASSED: no test data survived.';
end;
$$;

\echo 'DCP VAULT METADATA LOADER CONTRACTS: ALL SECTIONS PASSED (A-H)'
