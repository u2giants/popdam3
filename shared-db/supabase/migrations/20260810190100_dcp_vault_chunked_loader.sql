-- =====================================================================================
-- Disney DCP Vault -- CHUNKED LOADER PROTOCOL for the plm.dcp_* landing schema.
--
-- Migration: 20260810190100_dcp_vault_chunked_loader.sql
-- Issue:     u2giants/shared-db #665. Object claim: #725.
-- Requires:  20260810190000 (the nine plm.dcp_* tables, the privilege predicate, the
--            FROZEN row-hash function and the immutability triggers). This migration
--            creates NO table that migration created and alters NONE of them.
-- Pattern:   20260810130000 (the Warner chunked capture protocol) and 20260810020000
--            sections 26.1-26.6 (the Paramount begin/load/finalize/fail protocol). This
--            is deliberately the SAME protocol, not a third invention; where it differs,
--            the difference is stated in-line and justified.
--
-- CO-PRESENCE. scripts/production_migration_guard.py refuses any production allowlist
-- that contains this version without 20260810190000. Promoting this alone would create
-- functions whose every table reference does not exist.
--
-- SCHEMA ONLY. THIS MIGRATION LOADS NO DATA. Rows arrive at runtime, from a loader
-- program reading the PRIVATE repository u2giants/licensor-source-data-disney.
--
-- CONFIDENTIALITY. This repository is PUBLIC. No Disney tile slug, path, file name,
-- guide folder, region or portal URL appears here, and every error message below reports
-- COUNTS, ROW NUMBERS and IDENTIFIERS -- never a source value -- because this database's
-- logs are not private either.
--
-- -------------------------------------------------------------------------------------
-- WHY A CHUNKED PROTOCOL EXISTS AT ALL
-- -------------------------------------------------------------------------------------
-- The extract carries roughly 155,991 input rows resolving to 155,908 distinct DAM paths.
-- That cannot be one statement, and it should not be one transaction.
--
-- WHAT WAS MEASURED -- READ THIS BEFORE "OPTIMISING" THE CHUNK SIZE. Measured on preview
-- rjyboqwcdzcocqgmsyel on 2026-08-10 and recorded in 20260810130000: a single jsonb bind
-- over the Postgres wire was ACCEPTED at every size tried --
--     1 MB 99ms | 16 MB 541ms | 32 MB 1.1s | 64 MB 3.4s | 96 MB 16.3s | 128 MB 24.3s
-- and PostgREST never produced a 413. So there is NO hard body ceiling to size chunks
-- against, and it is FALSE to write that a large request would be refused. What the
-- numbers actually show is SUPERLINEAR TIME: 64 MB costs 3.4s, but double it and the cost
-- is seven times higher, not twice.
--
-- THE CHUNK BOUNDS ARE SIZED FROM THAT EVIDENCE, not from a guess:
--   * 20,000 rows per chunk. At this extract's row shape (twelve short text fields) a
--     20,000-row JSON array is on the order of 10 MB -- comfortably inside the flat part
--     of the curve, well below the 32 MB / 1.1s point, and it puts the whole extract in
--     about eight chunks. Small enough that a retry is cheap; large enough that the
--     per-call overhead is irrelevant.
--   * 48 MB of received chunk text, checked on the actual bytes. A byte bound as well as
--     a row bound, because "20,000 rows" says nothing about size if a future extract adds
--     a large field. 48 MB sits between the measured 32 MB (1.1s) and 64 MB (3.4s) points
--     and below the knee at 96 MB.
-- These are WORKING bounds chosen from measurement, NOT protocol limits. If they are ever
-- changed, re-measure first and update these numbers with the new evidence.
--
-- CHUNKS ARE APPLIED DIRECTLY, NOT STAGED. This is the one deliberate divergence from
-- Warner. Warner stages chunks in plm.wb_capture because its shipped per-entity loaders
-- take the WHOLE snapshot as one argument and pin an exact row total, so the stream must
-- be reassembled before it can be validated. DCP Vault has no such loader: this protocol
-- IS the loader, its landing tables are keyed on natural source identity so every chunk
-- is independently idempotent, and its completeness gate is section reconciliation rather
-- than a whole-snapshot digest. Staging would therefore buy nothing and would cost a
-- SECOND full copy of ~155,900 rows of confidential licensor data sitting in a jsonb
-- column. Per-chunk integrity is still proved -- see plm.dcp_chunk_ledger.
--
-- =====================================================================================
-- Objects created (the whole of the claim, and nothing outside it):
--   1 table      plm.dcp_chunk_ledger
--   8 functions  plm.begin_dcp_crawl, plm.open_dcp_crawl_section,
--                plm.close_dcp_crawl_section, plm.load_dcp_asset_chunk,
--                plm.record_dcp_crawl_gap, plm.close_dcp_crawl_gap,
--                plm.finalize_dcp_crawl, plm.fail_dcp_crawl
-- NOTHING else is created, altered or dropped. In particular: none of the nine plm.dcp_*
-- tables, nothing in core.*, nothing in dam.*, nothing in api.*, and no public.* wrapper.
-- The loader is a service_role server-side path and is deliberately NOT exposed through
-- the public schema.
-- =====================================================================================

-- =====================================================================================
-- SECTION 1. plm.dcp_chunk_ledger -- per-chunk integrity and idempotent resume
--
-- Holds DIGESTS AND COUNTS ONLY. It deliberately does NOT hold the chunk payload: the
-- rows have already been applied to the landing tables by the time a ledger row is
-- written, so keeping the payload would be a second copy of confidential data whose only
-- use is a diagnosis the digest and counts already provide.
-- =====================================================================================
create table plm.dcp_chunk_ledger (
  crawl_id        uuid not null references plm.dcp_crawl(crawl_id) on delete cascade,
  chunk_number    integer not null,
  chunk_sha256    text not null,
  rows_received   integer not null,
  rows_landed     integer not null,
  rows_rejected   integer not null,
  applied_at      timestamptz not null default now(),

  constraint dcp_chunk_ledger_pkey primary key (crawl_id, chunk_number),
  constraint dcp_chunk_ledger_number_chk check (chunk_number >= 1),
  constraint dcp_chunk_ledger_sha_chk check (chunk_sha256 ~ '^[0-9a-f]{64}$'),
  constraint dcp_chunk_ledger_counts_chk check (
    rows_received > 0 and rows_landed >= 0 and rows_rejected >= 0
    and rows_landed + rows_rejected = rows_received
  )
);

comment on table plm.dcp_chunk_ledger is
'One row per APPLIED chunk of a DCP Vault crawl load. Digests and counts only -- never the '
'payload, which by then already lives in the landing tables and would be a second copy of '
'confidential licensor data. Re-sending an IDENTICAL chunk after a dropped connection is an '
'idempotent no-op; re-sending DIFFERENT content under the same chunk number is REFUSED, '
'because a chunk number is not a slot to be overwritten. The counts constraint '
'landed + rejected = received is the structural form of "no row is ever silently skipped": '
'every input row either landed or produced a plm.dcp_load_exception, and the arithmetic '
'cannot balance if one went missing.';
comment on column plm.dcp_chunk_ledger.chunk_sha256 is
'sha256 of the exact UTF-8 bytes of this chunk''s JSON TEXT as received, recomputed '
'server-side and refused on mismatch. Deliberately digests the RECEIVED TEXT and not the '
'parsed jsonb: jsonb canonicalises key order, whitespace, escaping and number form, so a '
'digest taken after the cast would be of something the caller never produced and could not '
'reproduce -- it would fail on every honest chunk and would then have to be deleted, '
'leaving no integrity check at all.';

revoke all on plm.dcp_chunk_ledger from public;
revoke all on plm.dcp_chunk_ledger from anon;
revoke all on plm.dcp_chunk_ledger from service_role;
grant select on plm.dcp_chunk_ledger to authenticated;
grant select on plm.dcp_chunk_ledger to service_role;

alter table plm.dcp_chunk_ledger enable row level security;
drop policy if exists dcp_chunk_ledger_read on plm.dcp_chunk_ledger;
create policy dcp_chunk_ledger_read on plm.dcp_chunk_ledger
  for select to authenticated
  using (
    app.has_role('administrator')
    or app.has_app_access('plm')
    or app.has_any_role(array['sales', 'licensing']::app.app_role[])
  );

-- INSERT is covered as well as UPDATE and DELETE, for the reason set out at the head of
-- section 6 in 20260810190000: service_role keeps INSERT and loses everything else, so an
-- UPDATE/DELETE-only trigger would leave the only available mutating operation unguarded.
-- A ledger row added to a completed crawl would claim a chunk that crawl never applied,
-- and would break the reconciliation finalize already performed.
create trigger trg_dcp_chunk_ledger_immutable
  before insert or update or delete on plm.dcp_chunk_ledger
  for each row execute function plm.dcp_reject_completed_crawl_change();

-- =====================================================================================
-- SECTION 2. plm.begin_dcp_crawl -- opens a crawl in status planned
--
-- RESUMABLE: the same source commit and captured_on returns the SAME in-flight crawl
-- rather than forking a duplicate half-load. Serialized by an advisory lock.
-- =====================================================================================
create or replace function plm.begin_dcp_crawl(
  p_captured_on           date,
  p_portal_base_url       text,
  p_crawler_version       text,
  p_account_scope         text,
  p_line_of_business      text,
  p_captured_by           text,
  p_private_source_commit text,
  p_rows_received         integer,
  p_distinct_assets_received integer,
  p_notes                 text default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, plm, core, app, extensions
as $$
declare
  v_role  text := auth.role();
  v_crawl uuid;
begin
  -- The NULL-permissive trap: this is a POSITIVE match on a NON-NULL identity, evaluated
  -- by a callable function so the NULL case can be proved rejected by a test. It takes
  -- SESSION_USER, not current_user -- SECURITY DEFINER rewrites current_user to the
  -- function owner, so a current_user check inside a definer function guards nothing.
  if not plm.dcp_loader_privilege_ok(v_role, session_user) then
    raise exception 'DCP Vault load refused: effective JWT role %L / session_user %L may '
      'not begin a crawl. Run as service_role or through the shared-db apply workflow.',
      coalesce(v_role, '<null>'), coalesce(session_user, '<null>') using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtext('plm.dcp_crawl_import')::bigint);

  if p_captured_on is null then
    raise exception 'DCP Vault load refused: captured_on is required and must be supplied '
      'EXPLICITLY. It is the SNAPSHOT date and is never derived from now() -- this server '
      'runs America/New_York, so a UTC-midnight value read back through ::date lands on '
      'the previous day and would silently misdate the crawl.' using errcode = 'P0001';
  end if;

  if p_rows_received is null or p_rows_received <= 0
     or p_distinct_assets_received is null or p_distinct_assets_received <= 0 then
    raise exception 'DCP Vault load refused: rows_received and distinct_assets_received '
      'must both be positive integers declared UP FRONT from the extract manifest. '
      'Deriving them at the end would let a truncated extract define its own expectation '
      'and certify itself.' using errcode = 'P0001';
  end if;

  if p_distinct_assets_received > p_rows_received then
    raise exception 'DCP Vault load refused: distinct_assets_received (%) exceeds '
      'rows_received (%). Distinct DAM paths cannot outnumber the input rows they came '
      'from.', p_distinct_assets_received, p_rows_received using errcode = 'P0001';
  end if;

  if btrim(coalesce(p_private_source_commit, '')) = '' then
    raise exception 'DCP Vault load refused: private_source_commit is required. Without it '
      'a landed row cannot be traced back to the exact source it came from.'
      using errcode = 'P0001';
  end if;

  if p_portal_base_url is null or p_portal_base_url ~ '[?#]' then
    raise exception 'DCP Vault load refused: portal_base_url must be an ORIGIN with no '
      'query string or fragment, so a signed URL or a session token can never be stored.'
      using errcode = 'P0001';
  end if;

  -- RESUME rather than fork. An identical manifest already in flight IS this crawl.
  select c.crawl_id into v_crawl
  from plm.dcp_crawl c
  where c.status in ('planned', 'running')
    and c.captured_on = p_captured_on
    and c.private_source_commit = p_private_source_commit;

  if v_crawl is not null then
    return v_crawl;
  end if;

  if exists (
    select 1 from plm.dcp_crawl c
    where c.status = 'complete'
      and c.captured_on = p_captured_on
      and c.private_source_commit = p_private_source_commit
  ) then
    raise exception 'DCP Vault load refused: a COMPLETE crawl already exists for this '
      'snapshot date and source commit. Completed crawls are permanent evidence; '
      're-loading the identical source would either duplicate the run or overwrite it.'
      using errcode = 'P0001';
  end if;

  insert into plm.dcp_crawl (
    captured_on, portal_base_url, crawler_version, account_scope, line_of_business,
    started_at, rows_received, distinct_assets_received, captured_by,
    private_source_commit, notes, status
  ) values (
    p_captured_on, p_portal_base_url, p_crawler_version, p_account_scope,
    p_line_of_business, now(), p_rows_received, p_distinct_assets_received, p_captured_by,
    p_private_source_commit, p_notes, 'planned'
  )
  returning crawl_id into v_crawl;

  return v_crawl;
end;
$$;

comment on function plm.begin_dcp_crawl(date, text, text, text, text, text, text, integer, integer, text) is
'Opens a Disney DCP Vault crawl in status planned. RESUMABLE: the same snapshot date and '
'private source commit returns the SAME in-flight crawl rather than forking a duplicate '
'half-load, and a manifest already loaded by a COMPLETE crawl is refused. rows_received '
'and distinct_assets_received are declared UP FRONT so a truncated extract cannot define '
'its own expectation. captured_on is required explicitly and never derived from now(). '
'portal_base_url must be an origin, so a signed or session-bearing URL cannot be stored. '
'Serialized by advisory lock hashtext(''plm.dcp_crawl_import''). service_role only.';

-- =====================================================================================
-- SECTION 3. plm.open_dcp_crawl_section -- register ONE PLANNED tile+listing section
--
-- CALLED FROM THE CRAWLER'S PLAN, BEFORE ANY ROW IS FETCHED. That ordering is the whole
-- completeness mechanism: sections derived from what arrived would make a crawl that
-- reached only half its planned tiles look 100 percent complete. See the long note on
-- plm.dcp_crawl_section in 20260810190000 for the 22-planned versus 11-observed
-- reconciliation this implements.
--
-- Also upserts the portal tile identity, because a planned section names a tile that may
-- never have been seen before.
-- =====================================================================================
create or replace function plm.open_dcp_crawl_section(
  p_crawl_id        uuid,
  p_tile_source_key text,
  p_listing_kind    text,
  p_expected_count  integer default null,
  p_tile_label      text default null,
  p_tile_source_url text default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, plm, core, app, extensions
as $$
declare
  v_role    text := auth.role();
  v_status  text;
  v_tile    uuid;
  v_section uuid;
begin
  if not plm.dcp_loader_privilege_ok(v_role, session_user) then
    raise exception 'DCP Vault load refused: effective JWT role %L / session_user %L may '
      'not open a crawl section.', coalesce(v_role, '<null>'), coalesce(session_user, '<null>')
      using errcode = 'P0001';
  end if;

  select c.status into v_status from plm.dcp_crawl c where c.crawl_id = p_crawl_id;
  if v_status is null then
    raise exception 'DCP Vault load refused: crawl % does not exist.', p_crawl_id
      using errcode = 'P0001';
  end if;
  if v_status not in ('planned', 'running') then
    raise exception 'DCP Vault load refused: crawl % is %L. Sections may only be added to '
      'a crawl that is still planned or running -- adding one afterwards would rewrite '
      'what the crawl claimed to attempt.', p_crawl_id, v_status using errcode = 'P0001';
  end if;

  if p_listing_kind is null or p_listing_kind not in ('asset', 'style_guide') then
    raise exception 'DCP Vault load refused: listing_kind must be asset or style_guide, '
      'got %L.', coalesce(p_listing_kind, '<null>') using errcode = 'P0001';
  end if;

  if btrim(coalesce(p_tile_source_key, '')) = '' then
    raise exception 'DCP Vault load refused: a section must name a tile source key.'
      using errcode = 'P0001';
  end if;

  insert into plm.dcp_portal_tile (source_key, display_label, source_url,
                                   first_seen_crawl_id, last_seen_crawl_id)
  values (p_tile_source_key, p_tile_label, p_tile_source_url, p_crawl_id, p_crawl_id)
  on conflict (source_system, source_key) do update
    set last_seen_crawl_id = excluded.last_seen_crawl_id
  returning id into v_tile;

  -- The conflict path can return NULL when a concurrent transaction owns the row, and the
  -- immutability trigger can also make the DO UPDATE a no-op. Re-read rather than assume.
  if v_tile is null then
    select t.id into v_tile from plm.dcp_portal_tile t
    where t.source_system = 'disney_dcpvault' and t.source_key = p_tile_source_key;
  end if;

  -- One PLANNED section per (crawl, tile, listing kind). A repair or resume job is a GAP
  -- resolution on this existing section, NEVER a second section (design section 6 rule 1).
  insert into plm.dcp_crawl_section (crawl_id, portal_tile_id, listing_kind,
                                     expected_count, status)
  values (p_crawl_id, v_tile, p_listing_kind, p_expected_count, 'planned')
  on conflict (crawl_id, portal_tile_id, listing_kind) do nothing
  returning id into v_section;

  if v_section is null then
    select s.id into v_section from plm.dcp_crawl_section s
    where s.crawl_id = p_crawl_id and s.portal_tile_id = v_tile
      and s.listing_kind = p_listing_kind;
  end if;

  update plm.dcp_crawl set status = 'running'
  where crawl_id = p_crawl_id and status = 'planned';

  return v_section;
end;
$$;

comment on function plm.open_dcp_crawl_section(uuid, text, text, integer, text, text) is
'Registers ONE PLANNED tile + listing-kind section of a crawl, and upserts the portal tile '
'identity it names. MUST be called from the crawler''s PLAN before any row is fetched: that '
'ordering is the entire completeness mechanism, because sections derived from what arrived '
'would make a crawl that reached only some of its planned tiles look fully complete. '
'Idempotent -- re-registering the same section returns the existing one. A repair or resume '
'job is recorded as a GAP on the existing section, never as a second section. service_role '
'only.';

-- =====================================================================================
-- SECTION 4. plm.load_dcp_asset_chunk -- the bounded streaming entry point
--
-- WHY p_rows_json IS text AND NOT jsonb -- DO NOT "TIDY" THIS INTO jsonb.
-- The integrity check is that the caller's declared digest matches one the SERVER
-- recomputes from the bytes it actually received. jsonb does not preserve bytes: it
-- reorders keys, drops insignificant whitespace and normalises escapes and number forms.
-- sha256(p_rows::jsonb::text) would digest something the caller never produced and could
-- not reproduce, so it would fail on every honest chunk and would then have to be removed.
-- Taking the chunk as TEXT keeps the received bytes intact long enough to digest them; the
-- cast to jsonb happens immediately afterwards and a malformed chunk fails there.
--
-- EXPECTED SHAPE of each element of the JSON array (all values are strings or null):
--   source_path              full DAM path                     required
--   file_name                                                  required
--   file_extension           lowercase, no dot                 optional
--   relative_folder_path     may be blank -> stored as NULL    optional
--   style_guide_source_path  full guide folder path            required
--   style_guide_folder_name                                    required
--   style_guide_region                                         required
--   style_guide_year_segment text, may be a "no year" marker   required
--   style_guide_source_id    Disney id when present            optional
--   tile_keys                JSON array of tile source keys    required (may be empty)
--   listed_in_assets         boolean                           required
--   listed_in_style_guides   boolean                           required
--   row_number               1-based input row number          required
--
-- NO ROW IS EVER SILENTLY SKIPPED. Every element either lands or produces a
-- plm.dcp_load_exception row, and the ledger's landed + rejected = received CHECK makes
-- a third outcome arithmetically impossible.
-- =====================================================================================
create or replace function plm.load_dcp_asset_chunk(
  p_crawl_id     uuid,
  p_chunk_number integer,
  p_rows_json    text,
  p_chunk_sha256 text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, plm, core, app, extensions
as $$
declare
  v_role       text := auth.role();
  v_status     text;
  v_rows       jsonb;
  v_n          integer;
  v_bytes      integer;
  v_computed   text;
  v_existing   text;
  v_landed     integer := 0;
  v_rejected   integer := 0;
  r            jsonb;
  v_rowno      integer;
  v_guide      uuid;
  v_asset      uuid;
  v_tile       uuid;
  v_tile_keys  text[];   -- from the INPUT row; drives which links to write
  -- EVERY variable below is read BACK from the database after the upserts and is what the
  -- frozen hash digests. Nothing derived from the input row reaches plm.dcp_asset_row_hash.
  v_hash_tiles text[];   -- slot 8, from the links actually written
  v_stored_system text;  -- slot 1
  v_stored_path   text;  -- slot 2
  v_stored_name   text;  -- slot 3
  v_stored_ext    text;  -- slot 4
  v_stored_folder text;  -- slot 5
  v_stored_guide_path text; -- slot 6
  v_key        text;
  v_hash       text;
  v_folder     text;
  v_ext        text;
  v_guide_id   text;
  v_listed_a   boolean;
  v_listed_sg  boolean;
  v_kind       text;
  v_reject     text;
  v_code       text;
  v_existing_guide_id text;
begin
  if not plm.dcp_loader_privilege_ok(v_role, session_user) then
    raise exception 'DCP Vault load refused: effective JWT role %L / session_user %L may '
      'not load chunks.', coalesce(v_role, '<null>'), coalesce(session_user, '<null>')
      using errcode = 'P0001';
  end if;

  select c.status into v_status from plm.dcp_crawl c where c.crawl_id = p_crawl_id;
  if v_status is null then
    raise exception 'DCP Vault load refused: crawl % does not exist.', p_crawl_id
      using errcode = 'P0001';
  end if;
  if v_status <> 'running' then
    raise exception 'DCP Vault load refused: crawl % is %L, not running. A crawl that has '
      'left the running state may not receive more chunks. Register at least one section '
      'first.', p_crawl_id, v_status using errcode = 'P0001';
  end if;

  if p_chunk_number is null or p_chunk_number < 1 then
    raise exception 'DCP Vault load refused: chunk_number must be >= 1. Got %.',
      coalesce(p_chunk_number, -1) using errcode = 'P0001';
  end if;
  if p_chunk_sha256 is null or p_chunk_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'DCP Vault load refused: chunk_sha256 must be 64 lowercase hex '
      'characters.' using errcode = 'P0001';
  end if;
  if p_rows_json is null then
    raise exception 'DCP Vault load refused: chunk % carried no payload.', p_chunk_number
      using errcode = 'P0001';
  end if;

  -- INTEGRITY FIRST, ON THE RECEIVED BYTES, before parsing and before storing anything.
  v_computed := encode(sha256(convert_to(p_rows_json, 'UTF8')), 'hex');
  if v_computed <> p_chunk_sha256 then
    raise exception 'DCP Vault load refused: chunk % failed its integrity check. The digest '
      'recomputed from the bytes received does not match the digest declared for this '
      'chunk -- it was altered, truncated or mispaired in transit. No digest and no row '
      'content is echoed here because this database''s logs are not private.',
      p_chunk_number using errcode = 'P0001';
  end if;

  -- IDEMPOTENT RETRY, BUT NOT SILENT REPLACEMENT.
  select l.chunk_sha256 into v_existing
  from plm.dcp_chunk_ledger l
  where l.crawl_id = p_crawl_id and l.chunk_number = p_chunk_number;

  if v_existing is not null then
    if v_existing = p_chunk_sha256 then
      return jsonb_build_object('chunk_number', p_chunk_number, 'replayed', true);
    end if;
    raise exception 'DCP Vault load refused: chunk % has already been applied for this '
      'crawl with DIFFERENT content. A chunk number is not a slot to be overwritten.',
      p_chunk_number using errcode = 'P0001';
  end if;

  begin
    v_rows := p_rows_json::jsonb;
  exception when others then
    raise exception 'DCP Vault load refused: chunk % is not parseable JSON.', p_chunk_number
      using errcode = 'P0001';
  end;

  if jsonb_typeof(v_rows) <> 'array' then
    raise exception 'DCP Vault load refused: chunk % must be a JSON array of row objects, '
      'got %.', p_chunk_number, coalesce(jsonb_typeof(v_rows), 'null') using errcode = 'P0001';
  end if;

  v_n := jsonb_array_length(v_rows);
  if v_n = 0 then
    raise exception 'DCP Vault load refused: chunk % is empty. An empty chunk contributes '
      'nothing and would make the chunk numbering lie about how much was sent.',
      p_chunk_number using errcode = 'P0001';
  end if;

  -- THE TWO WORKING BOUNDS, sized from the measurement at the head of this file.
  if v_n > 20000 then
    raise exception 'DCP Vault load refused: chunk % carries % rows, over the 20000-row '
      'working bound. Send smaller chunks.', p_chunk_number, v_n using errcode = 'P0001';
  end if;
  v_bytes := octet_length(convert_to(p_rows_json, 'UTF8'));
  if v_bytes > 48 * 1024 * 1024 then
    raise exception 'DCP Vault load refused: chunk % is % bytes, over the 48 MB working '
      'bound. The bound is below the measured cost knee, not a transport limit.',
      p_chunk_number, v_bytes using errcode = 'P0001';
  end if;

  -- -----------------------------------------------------------------------------------
  -- Apply the chunk, row by row. A row that cannot be trusted becomes an EXCEPTION, never
  -- a skip and never a guess.
  -- -----------------------------------------------------------------------------------
  for r in select value from jsonb_array_elements(v_rows) loop
    v_reject := null;
    v_code   := null;
    v_rowno  := nullif(r ->> 'row_number', '')::integer;

    -- ---- validate -------------------------------------------------------------------
    if btrim(coalesce(r ->> 'source_path', '')) = '' then
      v_code := 'missing_source_path';
      v_reject := 'The row carries no DAM path. The DAM path is the file identity; without '
                  'it the row cannot be stored or deduplicated.';
    elsif btrim(coalesce(r ->> 'file_name', '')) = '' then
      v_code := 'missing_file_name';
      v_reject := 'The row carries no file name.';
    elsif btrim(coalesce(r ->> 'style_guide_source_path', '')) = '' then
      v_code := 'missing_guide_path';
      v_reject := 'The row carries no style-guide source path. The full guide path is the '
                  'guide identity and is never reconstructed from the folder name, which '
                  'repeats across region and year contexts.';
    elsif btrim(coalesce(r ->> 'style_guide_folder_name', '')) = ''
       or btrim(coalesce(r ->> 'style_guide_region', '')) = ''
       or btrim(coalesce(r ->> 'style_guide_year_segment', '')) = '' then
      v_code := 'incomplete_guide_context';
      v_reject := 'The row is missing part of its guide context (folder name, region or '
                  'year segment).';
    elsif jsonb_typeof(coalesce(r -> 'tile_keys', 'null'::jsonb)) <> 'array' then
      v_code := 'malformed_tile_list';
      v_reject := 'tile_keys is absent or is not a JSON array. An empty array means "no '
                  'tiles"; an absent one is a malformed row.';
    elsif jsonb_typeof(coalesce(r -> 'listed_in_assets', 'null'::jsonb)) <> 'boolean'
       or jsonb_typeof(coalesce(r -> 'listed_in_style_guides', 'null'::jsonb)) <> 'boolean' then
      v_code := 'malformed_boolean';
      v_reject := 'One or both listing flags is absent or is not a JSON boolean.';
    end if;

    if v_reject is null then
      v_listed_a  := (r -> 'listed_in_assets')::boolean;
      v_listed_sg := (r -> 'listed_in_style_guides')::boolean;

      -- Design section 4.8: the current extract's flags are mutually exclusive, so
      -- true/false maps to 'asset' and false/true to 'style_guide'. NEITHER FLAG SET is
      -- an unknown listing state and is REJECTED, exactly as the design requires -- it
      -- must never be quietly defaulted to 'asset'.
      if v_listed_a and not v_listed_sg then
        v_kind := 'asset';
      elsif v_listed_sg and not v_listed_a then
        v_kind := 'style_guide';
      elsif v_listed_a and v_listed_sg then
        -- BOTH TRUE on an ALREADY-AGGREGATED row. The design forbids manufacturing a
        -- cross-product from such a row: two observation rows may be created ONLY when
        -- the crawler can prove BOTH queries returned the file, and an aggregated row
        -- proves neither. Recorded as a warning for a human, not silently halved and not
        -- silently doubled.
        v_kind := null;
        v_code := 'both_listing_flags_set';
        v_reject := 'Both listing flags are set on an aggregated row. Two observations are '
                    'created only when the crawler proves both queries returned the file; '
                    'this row proves neither, so no tile observation is recorded for it.';
      else
        v_kind := null;
        v_code := 'unknown_listing_state';
        v_reject := 'Neither listing flag is set. The listing state is unknown and is never '
                    'defaulted.';
      end if;
    end if;

    -- A both-flags row is a WARNING: the asset identity is still trustworthy and is
    -- loaded; only its tile observations are withheld. Everything else above is a hard
    -- rejection of the whole row.
    if v_reject is not null and v_code <> 'both_listing_flags_set' then
      insert into plm.dcp_load_exception (crawl_id, chunk_number, row_number, severity,
                                          reason_code, reason, source_path, raw_row)
      values (p_crawl_id, p_chunk_number, v_rowno, 'rejected', v_code, v_reject,
              r ->> 'source_path', r);
      v_rejected := v_rejected + 1;
      continue;
    end if;

    -- ---- guide identity, keyed on the FULL SOURCE PATH ------------------------------
    v_guide_id := nullif(btrim(coalesce(r ->> 'style_guide_source_id', '')), '');

    insert into plm.dcp_style_guide (
      source_path, source_guide_id, folder_name, region, year_segment,
      parent_source_path, first_seen_crawl_id, last_seen_crawl_id
    ) values (
      r ->> 'style_guide_source_path', v_guide_id, r ->> 'style_guide_folder_name',
      r ->> 'style_guide_region', r ->> 'style_guide_year_segment',
      nullif(btrim(coalesce(r ->> 'style_guide_parent_source_path', '')), ''),
      p_crawl_id, p_crawl_id
    )
    on conflict (source_system, source_path) do update
      set last_seen_crawl_id = excluded.last_seen_crawl_id
    returning id, source_guide_id, source_path
      into v_guide, v_existing_guide_id, v_stored_guide_path;

    if v_guide is null then
      select g.id, g.source_guide_id, g.source_path
        into v_guide, v_existing_guide_id, v_stored_guide_path
      from plm.dcp_style_guide g
      where g.source_system = 'disney_dcpvault'
        and g.source_path = r ->> 'style_guide_source_path';
    end if;

    -- A guide whose stored Disney id disagrees with this row's is an exception a human
    -- must see. It is a WARNING, not a rejection: the row itself is still loadable and
    -- discarding it would lose evidence of the very conflict being reported. The stored
    -- id is NOT overwritten -- an overwrite would destroy the disagreement.
    if v_guide_id is not null and v_existing_guide_id is not null
       and v_guide_id <> v_existing_guide_id then
      insert into plm.dcp_load_exception (crawl_id, chunk_number, row_number, severity,
                                          reason_code, reason, source_path, raw_row)
      values (p_crawl_id, p_chunk_number, v_rowno, 'warning', 'conflicting_guide_source_id',
              'This row carries a Disney guide id that differs from the one already stored '
              'for the same full guide path. The stored id was NOT overwritten: an '
              'overwrite would destroy the evidence of the disagreement.',
              r ->> 'source_path', r);
    end if;

    -- ---- asset identity, keyed on (source_system, full DAM path) ---------------------
    v_folder := nullif(btrim(coalesce(r ->> 'relative_folder_path', '')), '');
    v_ext    := nullif(lower(btrim(coalesce(r ->> 'file_extension', ''))), '');

    insert into plm.dcp_asset (
      source_path, style_guide_id, file_name, file_extension, relative_folder_path,
      source_asset_id, first_seen_crawl_id, last_seen_crawl_id
    ) values (
      r ->> 'source_path', v_guide, r ->> 'file_name', v_ext, v_folder,
      nullif(btrim(coalesce(r ->> 'source_asset_id', '')), ''), p_crawl_id, p_crawl_id
    )
    -- RETURNING EVERY COLUMN THE HASH CONSUMES -- NOT JUST THE id.
    --
    -- This upsert deliberately refreshes only last_seen_crawl_id: file_name,
    -- file_extension and relative_folder_path are SOURCE columns and are never
    -- overwritten from a later crawl (and after any complete crawl the 6.2 trigger
    -- forbids it outright). So on a re-observed asset whose portal display name has
    -- changed, the row still holds the ORIGINAL values while the input row carries the
    -- new ones. Hashing the input would then store a digest of data the database does not
    -- hold, and -- worse -- a third crawl reading the same new source would hash the same
    -- new values, compare EQUAL, and report "no change" for a row that never matched the
    -- source in the first place. The divergence would also be permanent, because the
    -- stored columns can no longer be corrected once frozen.
    --
    -- Reading them back costs four words and removes the whole class of bug. See the
    -- slot-by-slot note at the hash call below: EVERY slot reads STORED, none reads input.
    on conflict (source_system, source_path) do update
      set last_seen_crawl_id = excluded.last_seen_crawl_id
    returning id, source_system, source_path, file_name, file_extension,
              relative_folder_path
      into v_asset, v_stored_system, v_stored_path, v_stored_name, v_stored_ext,
           v_stored_folder;

    -- The concurrent-race fallback must read back the SAME columns, or the race path
    -- would quietly reintroduce exactly the defect the RETURNING above removes.
    if v_asset is null then
      select a.id, a.source_system, a.source_path, a.file_name, a.file_extension,
             a.relative_folder_path
        into v_asset, v_stored_system, v_stored_path, v_stored_name, v_stored_ext,
             v_stored_folder
      from plm.dcp_asset a
      where a.source_system = 'disney_dcpvault' and a.source_path = r ->> 'source_path';
    end if;

    -- ---- tiles, and the crawl's observed tile set for this asset --------------------
    select array_agg(distinct btrim(t)) into v_tile_keys
    from jsonb_array_elements_text(r -> 'tile_keys') as e(t)
    where btrim(t) <> '';
    v_tile_keys := coalesce(v_tile_keys, array[]::text[]);

    if v_kind is not null then
      foreach v_key in array v_tile_keys loop
        insert into plm.dcp_portal_tile (source_key, first_seen_crawl_id, last_seen_crawl_id)
        values (v_key, p_crawl_id, p_crawl_id)
        on conflict (source_system, source_key) do update
          set last_seen_crawl_id = excluded.last_seen_crawl_id
        returning id into v_tile;

        if v_tile is null then
          select t.id into v_tile from plm.dcp_portal_tile t
          where t.source_system = 'disney_dcpvault' and t.source_key = v_key;
        end if;

        -- link_evidence = 'aggregated_row' with a NULL crawl_section_id. THE HONEST
        -- SIGNAL: this extract is already aggregated, so the specific portal query that
        -- returned this tile/file pair was not preserved and cannot be reconstructed.
        -- Writing a section id here would manufacture precisely the false precision the
        -- design forbids. A future section-aware crawler writes 'section_query' with the
        -- real section id, and the CHECK on the table keeps the two grades apart.
        insert into plm.dcp_asset_tile_observation (
          crawl_id, dcp_asset_id, portal_tile_id, listing_kind, crawl_section_id,
          link_evidence
        ) values (p_crawl_id, v_asset, v_tile, v_kind, null, 'aggregated_row')
        on conflict (crawl_id, dcp_asset_id, portal_tile_id, listing_kind) do nothing;
      end loop;
    end if;

    -- ---- snapshot membership + THE FROZEN ROW HASH -----------------------------------
    -- Computed by plm.dcp_asset_row_hash, the single implementation of the frozen
    -- specification in section 1 of 20260810190000. It is deliberately NOT computed here
    -- and NOT computed by the loader program: two implementations of a frozen scheme is
    -- how a frozen scheme stops being frozen.
    --
    -- EVERY ARGUMENT IS THE **STORED** VALUE, NOT THE INPUT VALUE. The spec says "as
    -- stored" and it means it, because the hash exists to detect a change in what the
    -- DATABASE holds between two crawls. Two places where those genuinely differ, and both
    -- were wrong in the first draft of this loader:
    --
    --   SLOT 7, the guide id. On a conflicting_guide_source_id row this loader
    --   deliberately does NOT overwrite the stored id (see above). Hashing the INPUT id
    --   would therefore digest a value that is not in the database, and the next crawl --
    --   reading the same stored row and the same source -- could compute a different hash
    --   for data that never changed. v_existing_guide_id is the value the upsert actually
    --   left in the row, so that is what is hashed.
    --
    --   SLOT 8, the tile set. The spec says "the SET of tile source_key values LINKED to
    --   this asset in THIS crawl". That is read back from
    --   plm.dcp_asset_tile_observation AFTER the link loop above, not taken from the input
    --   row before it. The difference is real for a both-flags row, whose links are
    --   deliberately withheld: hashing the input list would claim tiles the crawl did not
    --   link, and the row would then compare unequal against a later crawl that linked
    --   exactly the same nothing. An asset with no links yields an EMPTY array, which the
    --   spec defines as "no tiles" and hashes differently from NULL ("not observed").
    --
    -- On the trimming point the spec is unchanged and needs no exception: values are
    -- hashed exactly as STORED, and any normalisation this loader performs (trimming a
    -- tile key, lowercasing an extension, folding a blank folder path to NULL) happens
    -- BEFORE storage. The serialization itself still trims nothing.
    select array_agg(pt.source_key) into v_hash_tiles
    from plm.dcp_asset_tile_observation o
    join plm.dcp_portal_tile pt on pt.id = o.portal_tile_id
    where o.crawl_id = p_crawl_id and o.dcp_asset_id = v_asset;
    v_hash_tiles := coalesce(v_hash_tiles, array[]::text[]);

    -- ---------------------------------------------------------------------------------
    -- THE SLOT-BY-SLOT AUDIT. EVERY ONE OF THE EIGHT READS **STORED**, NOT INPUT.
    -- Keep this list correct if the hash call ever changes. Three of these were input-
    -- derived in an earlier draft and were the same defect as slots 7 and 8, just on
    -- columns that happen not to diverge on a FIRST load.
    --
    --   slot 1 source_system           v_stored_system      <- RETURNING (was a literal)
    --   slot 2 source_path             v_stored_path        <- RETURNING (was input)
    --   slot 3 file_name               v_stored_name        <- RETURNING (was input) *
    --   slot 4 file_extension          v_stored_ext         <- RETURNING (was input) *
    --   slot 5 relative_folder_path    v_stored_folder      <- RETURNING (was input) *
    --   slot 6 guide source_path       v_stored_guide_path  <- RETURNING (was input)
    --   slot 7 guide source_guide_id   v_existing_guide_id  <- RETURNING
    --   slot 8 tile key set            v_hash_tiles         <- re-read from the links
    --
    -- * THE THREE THAT CAN ACTUALLY DIVERGE. Slots 2 and 6 are natural keys and slot 1 is
    --   effectively constant, so for those, stored and input are equal by construction --
    --   they are read back for uniformity and to make this audit trivially checkable, not
    --   because they were wrong. Slots 3, 4 and 5 are the ONLY non-key plm.dcp_asset
    --   columns in the hash, they are never refreshed by the upsert, and they are frozen
    --   by the 6.2 trigger after any complete crawl -- so those three were the real bug.
    --
    -- NOTE ON WHY THIS ROUND IS NOT A ONE-WAY-DOOR PROBLEM: on a first load every asset
    -- is a fresh INSERT, so stored equals input on all eight slots and no hash computed
    -- before this fix would have been wrong. The divergence only appears from the SECOND
    -- crawl onward, which is why this had to land before one ever runs.
    -- ---------------------------------------------------------------------------------
    v_hash := plm.dcp_asset_row_hash(
      v_stored_system,
      v_stored_path,
      v_stored_name,
      v_stored_ext,
      v_stored_folder,
      v_stored_guide_path,
      v_existing_guide_id,
      v_hash_tiles
    );

    -- The 83 exact duplicate input rows collapse HERE, on the primary key. A duplicate
    -- that is NOT exact -- same DAM path, different content, therefore a different hash --
    -- is NOT collapsed silently: it is recorded as an exception, because two different
    -- descriptions of one file is a finding, not noise.
    --
    -- KNOWN, ACCEPTED, AND WRITTEN DOWN SO THE NEXT READER DOES NOT HAVE TO REDISCOVER IT:
    -- the tile links above are written BEFORE this conflict is detected. So if a
    -- non-exact duplicate IS rejected here, any tile links its row contributed have
    -- already landed, and the stored hash (computed from the FIRST row's link set) can
    -- describe fewer tiles than the link set now holds. Not fixed, deliberately:
    --   * It cannot occur on the measured extract -- all 83 duplicate DAM-path groups are
    --     EXACT duplicates, which produce an identical hash and collapse cleanly.
    --   * Avoiding it means deferring link writes until after the conflict check, which
    --     would break slot 8's definition -- the hash is specified over the links ACTUALLY
    --     WRITTEN, and there would be none to read yet.
    --   * The rejection is recorded either way, so the condition is never silent: a
    --     conflicting_duplicate_dam_path exception is an unresolved REJECTED row, and
    --     finalize gate 3 refuses to complete the crawl until a human has dealt with it.
    -- If a future extract starts producing non-exact duplicates in volume, revisit this
    -- by rejecting the whole DAM path up front rather than by reordering the writes.
    insert into plm.dcp_asset_crawl (crawl_id, dcp_asset_id, observed_row_hash)
    values (p_crawl_id, v_asset, v_hash)
    on conflict (crawl_id, dcp_asset_id) do nothing;

    if not found then
      if exists (
        select 1 from plm.dcp_asset_crawl ac
        where ac.crawl_id = p_crawl_id and ac.dcp_asset_id = v_asset
          and ac.observed_row_hash <> v_hash
      ) then
        insert into plm.dcp_load_exception (crawl_id, chunk_number, row_number, severity,
                                            reason_code, reason, source_path, raw_row)
        values (p_crawl_id, p_chunk_number, v_rowno, 'rejected',
                'conflicting_duplicate_dam_path',
                'Two NON-IDENTICAL rows share one DAM path in this crawl: their canonical '
                'row hashes differ. Exact duplicates are collapsed silently and correctly; '
                'this is not one, and merging it would pick a winner arbitrarily.',
                r ->> 'source_path', r);
        v_rejected := v_rejected + 1;
        continue;
      end if;
    end if;

    -- A both-flags row reaches here having loaded its identity and membership, with its
    -- tile observations deliberately withheld. Record the warning now that it has landed.
    if v_reject is not null then
      insert into plm.dcp_load_exception (crawl_id, chunk_number, row_number, severity,
                                          reason_code, reason, source_path, raw_row)
      values (p_crawl_id, p_chunk_number, v_rowno, 'warning', v_code, v_reject,
              r ->> 'source_path', r);
    end if;

    v_landed := v_landed + 1;
  end loop;

  insert into plm.dcp_chunk_ledger (crawl_id, chunk_number, chunk_sha256,
                                    rows_received, rows_landed, rows_rejected)
  values (p_crawl_id, p_chunk_number, p_chunk_sha256, v_n, v_landed, v_rejected);

  return jsonb_build_object(
    'chunk_number', p_chunk_number,
    'replayed',     false,
    'rows_received', v_n,
    'rows_landed',   v_landed,
    'rows_rejected', v_rejected,
    'bytes',         v_bytes
  );
end;
$$;

comment on function plm.load_dcp_asset_chunk(uuid, integer, text, text) is
'Applies ONE bounded chunk of the DCP Vault extract directly into the plm.dcp_* landing '
'tables. Takes the chunk as TEXT, not jsonb, so the server can recompute sha256 over the '
'EXACT bytes received -- jsonb canonicalises key order, whitespace, escaping and number '
'form, so a digest taken after the cast would be of something the caller never produced. '
'A chunk whose digest does not match is refused before it is parsed. Working bounds, sized '
'from the 2026-08-10 preview measurement and NOT transport limits: 20000 rows and 48 MB. '
'Re-sending an IDENTICAL chunk is an idempotent no-op; re-using a chunk number for '
'different content is refused. NO ROW IS EVER SILENTLY SKIPPED: every element either lands '
'or writes a plm.dcp_load_exception, and the ledger CHECK landed + rejected = received '
'makes a third outcome arithmetically impossible. Exact duplicate DAM paths collapse on the '
'membership primary key; NON-identical ones are rejected as a finding rather than merged by '
'picking a winner. Tile observations are written as link_evidence = aggregated_row with a '
'NULL section, because this extract is already aggregated and the proving query was not '
'preserved. service_role only.';

-- =====================================================================================
-- SECTION 5. Gap recording and closure
-- =====================================================================================
create or replace function plm.record_dcp_crawl_gap(
  p_crawl_section_id uuid,
  p_offset_from      integer,
  p_offset_to        integer,
  p_reason           text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, plm, core, app, extensions
as $$
declare
  v_role text := auth.role();
  v_gap  uuid;
begin
  if not plm.dcp_loader_privilege_ok(v_role, session_user) then
    raise exception 'DCP Vault load refused: effective JWT role %L / session_user %L may '
      'not record a crawl gap.', coalesce(v_role, '<null>'), coalesce(session_user, '<null>')
      using errcode = 'P0001';
  end if;

  if not exists (select 1 from plm.dcp_crawl_section s where s.id = p_crawl_section_id) then
    raise exception 'DCP Vault load refused: crawl section % does not exist.',
      p_crawl_section_id using errcode = 'P0001';
  end if;

  insert into plm.dcp_crawl_gap (crawl_section_id, offset_from, offset_to, reason,
                                 attempt_count)
  values (p_crawl_section_id, p_offset_from, p_offset_to, p_reason, 1)
  returning id into v_gap;

  update plm.dcp_crawl_section set status = 'gapped', updated_at = now()
  where id = p_crawl_section_id and status <> 'failed';

  return v_gap;
end;
$$;

comment on function plm.record_dcp_crawl_gap(uuid, integer, integer, text) is
'Records one missing offset range or request failure against an EXISTING crawl section and '
'marks that section gapped. This is where a repair or resume job belongs -- never as a '
'second section (design section 6 rule 1). An open gap blocks finalization. service_role '
'only.';

-- -------------------------------------------------------------------------------------
-- plm.close_dcp_crawl_section -- report a section's outcome.
--
-- WITHOUT THIS FUNCTION NO CRAWL COULD EVER FINALIZE: sections are created 'planned' and
-- finalize gate 1 requires every one of them 'complete'. It is a separate call from
-- chunk loading on purpose -- the loader streams rows for MANY sections at once and
-- cannot know when any single portal query is finished; only the crawler knows that.
--
-- captured_count is reported by the crawler and compared, by the table's own CHECK,
-- against expected_count where the portal exposed one. A zero-row section is legitimate
-- but may only be complete against an expected count of zero, so "we captured nothing"
-- can never pass for "there was nothing".
-- -------------------------------------------------------------------------------------
create or replace function plm.close_dcp_crawl_section(
  p_section_id     uuid,
  p_status         text,
  p_captured_count integer,
  p_expected_count integer default null,
  p_last_offset    integer default null,
  p_notes          text default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, plm, core, app, extensions
as $$
declare
  v_role text := auth.role();
begin
  if not plm.dcp_loader_privilege_ok(v_role, session_user) then
    raise exception 'DCP Vault refused: effective JWT role %L / session_user %L may not '
      'close a crawl section.', coalesce(v_role, '<null>'), coalesce(session_user, '<null>')
      using errcode = 'P0001';
  end if;

  if p_status not in ('running', 'complete', 'gapped', 'failed') then
    raise exception 'DCP Vault refused: section status must be running, complete, gapped '
      'or failed, got %L. A section is never returned to planned -- that would erase the '
      'evidence that it was attempted.', coalesce(p_status, '<null>')
      using errcode = 'P0001';
  end if;
  if p_captured_count is null or p_captured_count < 0 then
    raise exception 'DCP Vault refused: captured_count is required and must be >= 0. A '
      'section that does not report what it captured cannot be reconciled.'
      using errcode = 'P0001';
  end if;

  -- A section with an OPEN gap may not be reported complete. The table CHECK cannot see
  -- this (it is a set-level fact about another table), so it is enforced here.
  if p_status = 'complete' and exists (
    select 1 from plm.dcp_crawl_gap g
    where g.crawl_section_id = p_section_id
      and g.resolved_at is null and g.waived_at is null
  ) then
    raise exception 'DCP Vault refused: section % still has an unresolved, unwaived gap and '
      'may not be reported complete. Re-fetch the range, or have a named human waive it.',
      p_section_id using errcode = 'P0001';
  end if;

  update plm.dcp_crawl_section
     set status         = p_status,
         captured_count = p_captured_count,
         expected_count = coalesce(p_expected_count, expected_count),
         last_offset    = coalesce(p_last_offset, last_offset),
         notes          = coalesce(p_notes, notes),
         started_at     = coalesce(started_at, now()),
         finished_at    = case when p_status = 'running' then null else now() end,
         updated_at     = now()
   where id = p_section_id;

  if not found then
    raise exception 'DCP Vault refused: crawl section % does not exist.', p_section_id
      using errcode = 'P0001';
  end if;
end;
$$;

comment on function plm.close_dcp_crawl_section(uuid, text, integer, integer, integer, text) is
'Reports one crawl section''s outcome and captured count. REQUIRED for any crawl to '
'finalize: sections are created planned and finalize demands every one of them complete. '
'Kept separate from chunk loading because the loader streams rows for many sections at once '
'and cannot know when a single portal query has finished -- only the crawler knows. A '
'section with an unresolved, unwaived gap may NOT be reported complete, and a section is '
'never returned to planned, which would erase the evidence that it was attempted. '
'service_role only.';

create or replace function plm.close_dcp_crawl_gap(
  p_gap_id        uuid,
  p_mode          text,                    -- 'resolved' or 'waived'
  p_note          text,
  p_waived_by     text default null,
  p_waived_at     timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, plm, core, app, extensions
as $$
declare
  v_role text := auth.role();
  v_when timestamptz;
begin
  if not plm.dcp_loader_privilege_ok(v_role, session_user) then
    raise exception 'DCP Vault refused: effective JWT role %L / session_user %L may not '
      'close a crawl gap.', coalesce(v_role, '<null>'), coalesce(session_user, '<null>')
      using errcode = 'P0001';
  end if;

  if p_mode not in ('resolved', 'waived') then
    raise exception 'DCP Vault refused: gap closure mode must be resolved or waived, got %L. '
      'A gap that was re-fetched is RESOLVED; a gap a human accepted the loss of is WAIVED. '
      'Recording one as the other misstates whether the data exists.', p_mode
      using errcode = 'P0001';
  end if;
  if btrim(coalesce(p_note, '')) = '' then
    raise exception 'DCP Vault refused: closing a gap requires a note saying what happened.'
      using errcode = 'P0001';
  end if;

  if p_mode = 'resolved' then
    update plm.dcp_crawl_gap
      set resolved_at = now(), resolution_note = p_note
      where id = p_gap_id and resolved_at is null and waived_at is null;
  else
    if btrim(coalesce(p_waived_by, '')) = '' then
      raise exception 'DCP Vault refused: a waiver must be SIGNED. An unsigned waiver is '
        'how a gap gets closed by nobody.' using errcode = 'P0001';
    end if;

    -- THE APPROVAL TIMESTAMP IS PINNED TO MIDDAY UTC. This server runs America/New_York.
    -- A midnight-UTC approval read back through ::date -- which any "waived on or before
    -- date D" report does -- returns the PREVIOUS day, so two reports would disagree
    -- about when the loss was accepted. Midday UTC is 07:00 or 08:00 local, so the date
    -- is the same in BOTH zones, on both sides of every daylight-saving transition.
    --
    -- THE CONVERSION IS EXPLICIT IN BOTH DIRECTIONS, AND THAT IS THE WHOLE FIX.
    --   `ts at time zone 'UTC'`      timestamptz -> NAIVE timestamp, read in UTC
    --   `date_trunc('day', ...)`     midnight of that UTC day, still naive
    --   `... at time zone 'UTC'`     NAIVE -> timestamptz, INTERPRETED as UTC
    --   `+ interval '12 hours'`      midday UTC
    -- The second `at time zone 'UTC'` is not redundant with the first: the operator means
    -- opposite things depending on whether its input carries a zone. Omitting it leaves a
    -- naive value that the timestamptz assignment then interprets in the SERVER's zone
    -- (America/New_York), which lands the "midday" at 20:00Z -- 4 hours from the UTC day
    -- boundary instead of 12, and not the value every comment here claims. That was the
    -- original bug, verified stored as 16:00-04 on preview.
    v_when := (date_trunc('day', coalesce(p_waived_at, now()) at time zone 'UTC')
               at time zone 'UTC') + interval '12 hours';

    update plm.dcp_crawl_gap
      set waived_at = v_when,
          waived_by = p_waived_by,
          waiver_reason = p_note
      where id = p_gap_id and resolved_at is null and waived_at is null;
  end if;

  if not found then
    raise exception 'DCP Vault refused: gap % does not exist or is already closed. A closed '
      'gap is not re-closed -- that would overwrite who accepted the loss and when.',
      p_gap_id using errcode = 'P0001';
  end if;
end;
$$;

comment on function plm.close_dcp_crawl_gap(uuid, text, text, text, timestamptz) is
'Closes ONE crawl gap as either RESOLVED (the range was actually re-fetched) or WAIVED (a '
'named human accepted the loss, with a reason). The two are never interchangeable: '
'recording one as the other misstates whether the data exists. THE WAIVER TIMESTAMP IS '
'PINNED TO MIDDAY UTC, deliberately -- this server runs America/New_York, so a midnight-UTC '
'approval read back through ::date reports the previous day and two reports would disagree '
'about when the loss was accepted. Midday UTC lands on the same calendar date in both zones '
'on both sides of every daylight-saving transition. An already-closed gap is never '
're-closed. service_role only.';

-- =====================================================================================
-- SECTION 6. plm.finalize_dcp_crawl -- the ONLY path to status complete
--
-- Design section 7 turned into gates. Each one FAILS LOUDLY with the numbers behind it.
-- Every count check is written so that an EMPTY set FAILS: a gate that passes when it
-- measured nothing is a gate that is not there.
-- =====================================================================================
create or replace function plm.finalize_dcp_crawl(p_crawl_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, plm, core, app, extensions
as $$
declare
  v_role        text := auth.role();
  c             plm.dcp_crawl%rowtype;
  v_sections    integer;
  v_incomplete  integer;
  v_open_gaps   integer;
  v_open_excs   integer;
  v_assets      integer;
  v_chunk_rows  integer;
  v_chunks      integer;
  v_maxchunk    integer;
  v_tiles       integer;
  v_guides      integer;
  v_obs         integer;
begin
  if not plm.dcp_loader_privilege_ok(v_role, session_user) then
    raise exception 'DCP Vault refused: effective JWT role %L / session_user %L may not '
      'finalize a crawl.', coalesce(v_role, '<null>'), coalesce(session_user, '<null>')
      using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtext('plm.dcp_crawl_import')::bigint);

  select * into c from plm.dcp_crawl where crawl_id = p_crawl_id;
  if c.crawl_id is null then
    raise exception 'DCP Vault refused: crawl % does not exist.', p_crawl_id
      using errcode = 'P0001';
  end if;
  if c.status <> 'running' then
    raise exception 'DCP Vault refused: crawl % is %L, not running. Only a running crawl '
      'can be finalized.', p_crawl_id, c.status using errcode = 'P0001';
  end if;

  -- GATE 1. There must BE sections. An empty plan is not a completed crawl, and a gate
  -- that passes on an empty set is not a gate.
  select count(*), count(*) filter (where status <> 'complete')
    into v_sections, v_incomplete
  from plm.dcp_crawl_section where crawl_id = p_crawl_id;

  if v_sections = 0 then
    raise exception 'DCP Vault refused: crawl % has ZERO registered sections. A crawl with '
      'no plan cannot be proved complete -- every completeness check below would pass '
      'vacuously.', p_crawl_id using errcode = 'P0001';
  end if;
  if v_incomplete > 0 then
    raise exception 'DCP Vault refused: crawl % has % of % sections not complete. An '
      'incomplete section prevents completion -- that is what the section table is for.',
      p_crawl_id, v_incomplete, v_sections using errcode = 'P0001';
  end if;

  -- GATE 2. No gap may be left neither resolved nor waived.
  select count(*) into v_open_gaps
  from plm.dcp_crawl_gap g
  join plm.dcp_crawl_section s on s.id = g.crawl_section_id
  where s.crawl_id = p_crawl_id and g.resolved_at is null and g.waived_at is null;

  if v_open_gaps > 0 then
    raise exception 'DCP Vault refused: crawl % has % unresolved, unwaived gap(s). Resolve '
      'them by re-fetching, or have a named human waive them with a reason.',
      p_crawl_id, v_open_gaps using errcode = 'P0001';
  end if;

  -- GATE 3. No unresolved hard rejection.
  select count(*) into v_open_excs
  from plm.dcp_load_exception
  where crawl_id = p_crawl_id and severity = 'rejected' and resolved_at is null;

  if v_open_excs > 0 then
    raise exception 'DCP Vault refused: crawl % has % unresolved REJECTED row(s) in '
      'plm.dcp_load_exception. Every rejection is a row that did not load; completing the '
      'crawl over them would certify a load that is knowingly short.',
      p_crawl_id, v_open_excs using errcode = 'P0001';
  end if;

  -- GATE 4. The chunk stream must be 1..N with no gap and no duplicate, and its row
  -- arithmetic must reconcile to the count declared UP FRONT at begin.
  select count(*), coalesce(max(chunk_number), 0), coalesce(sum(rows_received), 0)
    into v_chunks, v_maxchunk, v_chunk_rows
  from plm.dcp_chunk_ledger where crawl_id = p_crawl_id;

  if v_chunks = 0 then
    raise exception 'DCP Vault refused: crawl % applied ZERO chunks.', p_crawl_id
      using errcode = 'P0001';
  end if;
  if v_chunks <> v_maxchunk then
    raise exception 'DCP Vault refused: crawl % applied % chunks but the highest chunk '
      'number is %. The stream has a gap or a duplicate, so a dropped chunk could '
      'assemble into a shorter load that still looked whole.',
      p_crawl_id, v_chunks, v_maxchunk using errcode = 'P0001';
  end if;
  if v_chunk_rows <> c.rows_received then
    raise exception 'DCP Vault refused: crawl % received % input rows across its chunks but '
      'declared % up front. A stream may not redefine its own expectation.',
      p_crawl_id, v_chunk_rows, c.rows_received using errcode = 'P0001';
  end if;

  -- GATE 5. Distinct assets landed must equal the count declared UP FRONT.
  select count(*) into v_assets from plm.dcp_asset_crawl where crawl_id = p_crawl_id;
  if v_assets <> c.distinct_assets_received then
    raise exception 'DCP Vault refused: crawl % landed % distinct assets but declared % up '
      'front.', p_crawl_id, v_assets, c.distinct_assets_received using errcode = 'P0001';
  end if;

  select count(*) into v_tiles  from plm.dcp_portal_tile;
  select count(*) into v_guides from plm.dcp_style_guide;
  select count(*) into v_obs    from plm.dcp_asset_tile_observation where crawl_id = p_crawl_id;

  update plm.dcp_crawl
     set status = 'complete', finished_at = now()
   where crawl_id = p_crawl_id;

  return jsonb_build_object(
    'crawl_id', p_crawl_id,
    'sections', v_sections,
    'chunks', v_chunks,
    'rows_received', v_chunk_rows,
    'distinct_assets', v_assets,
    'tile_observations', v_obs,
    'portal_tiles_total', v_tiles,
    'style_guides_total', v_guides
  );
end;
$$;

comment on function plm.finalize_dcp_crawl(uuid) is
'The ONLY path to plm.dcp_crawl.status = complete, and therefore the only thing that arms '
'the immutability triggers. Five gates, each of which FAILS LOUDLY with its numbers: every '
'registered section complete (and there must BE sections -- an empty plan fails rather than '
'passing vacuously); no gap left unresolved and unwaived; no unresolved REJECTED load '
'exception; the chunk stream exactly 1..N with its input-row total equal to the count '
'declared at begin; and distinct assets landed equal to the count declared at begin. '
'Returns the counts it verified, so "it finalized" is never a claim without evidence '
'behind it. service_role only.';

-- =====================================================================================
-- SECTION 7. plm.fail_dcp_crawl
-- =====================================================================================
create or replace function plm.fail_dcp_crawl(p_crawl_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, plm, core, app, extensions
as $$
declare
  v_role text := auth.role();
begin
  if not plm.dcp_loader_privilege_ok(v_role, session_user) then
    raise exception 'DCP Vault refused: effective JWT role %L / session_user %L may not '
      'fail a crawl.', coalesce(v_role, '<null>'), coalesce(session_user, '<null>')
      using errcode = 'P0001';
  end if;

  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'DCP Vault refused: a failed crawl must say why. Silence is not an '
      'acceptable failure record.' using errcode = 'P0001';
  end if;

  update plm.dcp_crawl
     set status = 'failed', failure_message = p_reason, finished_at = now()
   where crawl_id = p_crawl_id and status in ('planned', 'running');

  if not found then
    raise exception 'DCP Vault refused: crawl % does not exist or has already reached a '
      'terminal state.', p_crawl_id using errcode = 'P0001';
  end if;
end;
$$;

comment on function plm.fail_dcp_crawl(uuid, text) is
'Marks an in-flight DCP Vault crawl failed with a mandatory reason. A completed crawl is '
'never failed afterwards -- it is frozen. Whatever partial evidence landed is KEPT: it is '
'the record of how far the crawl got, and deleting it would leave no diagnosis. '
'service_role only.';

-- =====================================================================================
-- SECTION 8. Function grants. service_role gets EXECUTE and nothing else; the functions
-- are SECURITY DEFINER owned by postgres, so they never consume service_role's table
-- grants. public is revoked on every one.
-- =====================================================================================
revoke all on function plm.begin_dcp_crawl(date, text, text, text, text, text, text, integer, integer, text) from public;
revoke all on function plm.open_dcp_crawl_section(uuid, text, text, integer, text, text) from public;
revoke all on function plm.load_dcp_asset_chunk(uuid, integer, text, text) from public;
revoke all on function plm.record_dcp_crawl_gap(uuid, integer, integer, text) from public;
revoke all on function plm.close_dcp_crawl_section(uuid, text, integer, integer, integer, text) from public;
revoke all on function plm.close_dcp_crawl_gap(uuid, text, text, text, timestamptz) from public;
revoke all on function plm.finalize_dcp_crawl(uuid) from public;
revoke all on function plm.fail_dcp_crawl(uuid, text) from public;

grant execute on function plm.begin_dcp_crawl(date, text, text, text, text, text, text, integer, integer, text) to service_role;
grant execute on function plm.open_dcp_crawl_section(uuid, text, text, integer, text, text) to service_role;
grant execute on function plm.load_dcp_asset_chunk(uuid, integer, text, text) to service_role;
grant execute on function plm.record_dcp_crawl_gap(uuid, integer, integer, text) to service_role;
grant execute on function plm.close_dcp_crawl_section(uuid, text, integer, integer, integer, text) to service_role;
grant execute on function plm.close_dcp_crawl_gap(uuid, text, text, text, timestamptz) to service_role;
grant execute on function plm.finalize_dcp_crawl(uuid) to service_role;
grant execute on function plm.fail_dcp_crawl(uuid, text) to service_role;
