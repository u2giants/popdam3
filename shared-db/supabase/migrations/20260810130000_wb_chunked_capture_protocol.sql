-- =====================================================================================
-- Warner Bros. STARLABS -- CHUNKED CAPTURE PROTOCOL for the eight plm.wb_* mirrors.
--
-- Migration: 20260810130000_wb_chunked_capture_protocol.sql
-- Claim:     #666 -- this migration owns plm.wb_capture and the four capture functions
--            and NOTHING else.
-- Issue:     #588 (load the Warner extract). Follows 20260810030000 (the eight mirrors
--            and their eight guarded loaders), 20260810110000 and 20260810120000
--            (the grant/RLS hardening on those mirrors).
-- Model:     20260810020000_pmt_creative_library_landing.sql sections 26.1-26.6 -- the
--            Paramount begin/load/validate/finalize/fail protocol. This is deliberately
--            the SAME protocol, not a third invention. Where it differs from Paramount,
--            the difference is called out in-line and justified.
--
-- SCHEMA ONLY. THIS MIGRATION LOADS NO DATA.
-- The STARLABS extract is business-confidential Warner Bros. data and this repository is
-- PUBLIC: SCHEMA IN GIT, DATA OUT OF GIT. No Warner value appears in this file, and every
-- error message below deliberately reports COUNTS and never a source value, because the
-- database logs are not private either.
--
-- -------------------------------------------------------------------------------------
-- WHY THIS EXISTS
-- -------------------------------------------------------------------------------------
-- The eight shipped loaders plm.sync_wb_<entity>(jsonb, text, numeric) each take the WHOLE
-- snapshot as ONE jsonb argument, and guard G8 asserts an exact pinned row total for the
-- 2026-08-07 capture. Chunking through those functions is therefore structurally
-- impossible: a half-snapshot fails G8 by construction, which is exactly what G8 is for.
--
-- Two of the source files are large -- warner-bros/assets.csv is 62,573,505 bytes and
-- warner-bros/links-asset-franchise-property.csv is 60,614,793 bytes at the pinned commit.
-- A caller must therefore be able to STREAM a snapshot in bounded pieces and have it
-- assembled server-side into the single whole-snapshot argument the shipped loaders
-- require. That is the whole job of this protocol.
--
-- -------------------------------------------------------------------------------------
-- WHAT WAS MEASURED, AND THE CORRECTION IT FORCED -- READ BEFORE "OPTIMISING" THIS
-- -------------------------------------------------------------------------------------
-- The dispatch that authorised this migration asserted that "a single request that large
-- will not go through". THAT ASSERTION IS FALSE ON THIS PROJECT, and it was measured
-- rather than assumed, on preview rjyboqwcdzcocqgmsyel on 2026-08-10:
--
--   * Direct Postgres wire (node-pg through the transaction pooler
--     aws-0-us-east-1.pooler.supabase.com:6543), one jsonb bind parameter:
--         1 MB ok 99ms | 16 MB ok 541ms | 32 MB ok 1.1s | 64 MB ok 3.4s
--        96 MB ok 16.3s | 128 MB ok 24.3s        -- no refusal at any size tried
--   * PostgREST HTTP POST /rest/v1/rpc/<name>, service_role:
--         0.5 MB .. 64 MB all routed (HTTP 404 PGRST202 from a deliberately
--         non-existent probe function -- i.e. the BODY was accepted every time).
--         No 413 was ever produced.
--
-- So there is no hard body ceiling to size chunks against. The real cost is SUPERLINEAR
-- TIME: 64 MB in one bind took 3.4s, 96 MB took 16.3s, 128 MB took 24.3s. A single-shot
-- 60 MB load is therefore not impossible -- it is merely a single all-or-nothing
-- transaction that gets slower the bigger it is, retries from zero, holds an advisory
-- lock for its whole duration, and gives no diagnosis of WHERE it went wrong.
--
-- Chunking is kept, and is still the right design, for the reasons that survive the
-- measurement: bounded per-call transactions, resumability after a dropped connection,
-- per-chunk integrity that names the failing chunk, and a fixed ceiling on peak memory.
-- It is NOT kept because a large request is refused. Do not write that claim into this
-- file or into any doc: it was tested and it is not true.
--
-- The chunk bound below is therefore a WORKING bound, not a protocol limit.
--
-- -------------------------------------------------------------------------------------
-- WHY THE EIGHT SHIPPED LOADERS ARE NOT TOUCHED
-- -------------------------------------------------------------------------------------
-- 20260810030000 is already applied to preview. AGENTS.md section 4 rule 4: never edit an
-- applied migration; fix forward. An earlier idea -- adding a p_is_chunk flag to all eight
-- sync_wb_* functions -- was rejected for exactly that reason, and also because it would
-- have put a bypass switch on G8 inside the very functions G8 protects. This migration
-- adds a layer IN FRONT of them and changes nothing behind them: finalize calls the
-- shipped loaders with a complete snapshot, so G1-G9 all run, unmodified, exactly once.
--
-- -------------------------------------------------------------------------------------
-- WHY ONE TABLE HOLDS BOTH THE HEADER AND THE CHUNKS
-- -------------------------------------------------------------------------------------
-- plm.wb_capture is keyed (capture_id, chunk_number). chunk_number = 0 is the CAPTURE
-- HEADER; chunk_number >= 1 is a PAYLOAD CHUNK. Two CHECK constraints enforce that each
-- shape carries exactly its own columns and none of the other's.
--
-- The alternative -- accumulating the snapshot into a single jsonb column with repeated
-- UPDATE ... || chunk -- was rejected on performance grounds and is worth recording so
-- nobody re-proposes it: appending to one large jsonb value rewrites the WHOLE value on
-- every append, so streaming 60 MB in N pieces costs O(N^2) bytes of rewrite and TOAST
-- churn. Chunks as ROWS make every append a plain O(1) INSERT.
--
-- =====================================================================================
-- Objects created (the whole of claim #666, and nothing outside it):
--   1 table      plm.wb_capture
--   4 functions  plm.begin_wb_capture, plm.load_wb_chunk,
--                plm.finalize_wb_capture, plm.fail_wb_capture
--
-- NOTHING else is created, altered or dropped. In particular: none of the eight
-- plm.sync_wb_* functions, none of the eight plm.wb_* tables, nothing in core.*,
-- nothing in api.*, and no public.* wrapper. The capture protocol is a service_role
-- server-side path and is deliberately NOT exposed through the public schema.
--
-- There is deliberately NO plm.validate_wb_capture. Paramount has a separate
-- SECURITY INVOKER validator because its twenty-odd capture-scoped tables need a
-- readable per-population report. Warner's validation is a different shape: the
-- authoritative checks (G1-G9, including the pinned baseline G8 and the shrink band G9)
-- already live INSIDE the eight shipped loaders, and finalize's own job is only to prove
-- the STREAM was complete and unaltered before handing it over. Splitting that into a
-- separately-granted reporter would publish a second, weaker opinion about a capture's
-- validity next to the loaders' authoritative one. Claim #666 lists four functions; this
-- is the reason it lists four and not five.
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- 1. plm.wb_capture
-- -------------------------------------------------------------------------------------
create table plm.wb_capture (
  capture_id            uuid        not null default gen_random_uuid(),

  -- 0 = capture header. >= 1 = payload chunk, in the caller's chunk order.
  chunk_number          integer     not null,

  -- ---- HEADER COLUMNS (chunk_number = 0 only) -------------------------------------
  -- Which of the eight mirrors this capture is destined for. One capture feeds exactly
  -- ONE mirror: the shipped loaders are per-entity and each has its own pinned G8 total,
  -- so a multi-target capture could not be validated as a unit.
  target                text        null,
  status                text        null,
  -- The SNAPSHOT date, explicit. Passed straight through to snapshot.captured_at, which
  -- the shipped loaders require and refuse to derive from now(): the server runs
  -- America/New_York, so a UTC-midnight timestamp read back through ::date lands on the
  -- previous day and would silently misdate the capture.
  captured_at           date        null,
  -- The pinned commit of the PRIVATE source repo the CSVs were read from. Recorded as
  -- provenance; the loader program is what enforces that HEAD actually equals it.
  private_source_commit text        null,
  -- The caller's manifest digest for the WHOLE stream. See section 3 for exactly what it
  -- digests and why it is verifiable rather than merely declared.
  snapshot_sha256       text        null,
  -- How many rows the caller says it is going to send, declared UP FRONT. finalize
  -- refuses if the assembled stream does not carry exactly this many. Declaring it
  -- afterwards would let a truncated stream define its own expectation.
  expected_row_count    integer     null,
  captured_by           text        null,
  source_url            text        null,
  started_at            timestamptz null,
  completed_at          timestamptz null,
  failure_message       text        null,
  notes                 text        null,
  -- The shipped loader's own return row, stored verbatim on success. "It finalized" is
  -- never a claim without the loader's counts behind it.
  loader_report         jsonb       null,

  -- ---- CHUNK COLUMNS (chunk_number >= 1 only) -------------------------------------
  -- The chunk's rows. NULLed out once the capture reaches a terminal state -- see the
  -- retention note on the table comment.
  payload               jsonb       null,
  payload_row_count     integer     null,
  -- sha256 of the EXACT UTF-8 bytes the caller sent for this chunk, recomputed
  -- server-side from those same bytes and refused on mismatch. Survives the payload
  -- being cleared, because it is the diagnosis.
  chunk_sha256          text        null,
  payload_cleared_at    timestamptz null,

  created_at            timestamptz not null default now(),

  constraint wb_capture_pkey primary key (capture_id, chunk_number),

  constraint wb_capture_chunk_number_chk check (chunk_number >= 0),

  -- The eight mirrors, by name. A fixed allow-list in the schema as well as in the
  -- functions: there is no target string a caller can smuggle past both.
  constraint wb_capture_target_chk check (
    target is null or target in (
      'wb_franchise_property', 'wb_style_guide', 'wb_character', 'wb_asset',
      'wb_asset_style_guide', 'wb_asset_franchise_property', 'wb_asset_character',
      'wb_property_character'
    )
  ),

  constraint wb_capture_status_chk check (
    status is null or status in ('loading', 'validating', 'complete', 'failed')
  ),

  constraint wb_capture_sha_chk check (
    snapshot_sha256 is null or snapshot_sha256 ~ '^[0-9a-f]{64}$'
  ),
  constraint wb_capture_chunk_sha_chk check (
    chunk_sha256 is null or chunk_sha256 ~ '^[0-9a-f]{64}$'
  ),
  constraint wb_capture_expected_rows_chk check (
    expected_row_count is null or expected_row_count > 0
  ),
  constraint wb_capture_payload_rows_chk check (
    payload_row_count is null or payload_row_count > 0
  ),

  -- SHAPE 1 -- the header row carries every header field and NO chunk field.
  constraint wb_capture_header_shape_chk check (
    chunk_number <> 0 or (
      target is not null
      and status is not null
      and captured_at is not null
      and btrim(coalesce(private_source_commit, '')) <> ''
      and snapshot_sha256 is not null
      and expected_row_count is not null
      and btrim(coalesce(captured_by, '')) <> ''
      and btrim(coalesce(source_url, '')) <> ''
      and started_at is not null
      and payload is null
      and payload_row_count is null
      and chunk_sha256 is null
    )
  ),

  -- SHAPE 2 -- a chunk row carries chunk fields and NO header field.
  constraint wb_capture_chunk_shape_chk check (
    chunk_number = 0 or (
      payload_row_count is not null
      and chunk_sha256 is not null
      and target is null
      and status is null
      and captured_at is null
      and private_source_commit is null
      and snapshot_sha256 is null
      and expected_row_count is null
      and captured_by is null
      and source_url is null
      and started_at is null
      and completed_at is null
      and failure_message is null
      and notes is null
      and loader_report is null
    )
  ),

  -- A terminal state must say WHY it is terminal, or be a success.
  constraint wb_capture_failed_requires_message_chk check (
    status is distinct from 'failed' or btrim(coalesce(failure_message, '')) <> ''
  ),
  constraint wb_capture_complete_requires_report_chk check (
    status is distinct from 'complete' or (completed_at is not null and loader_report is not null)
  )
);

-- One in-flight capture per target, enforced by the database and not only by the
-- function that checks it. Two concurrent streams into the same mirror would interleave
-- chunk numbers from different snapshots and assemble a chimera.
create unique index uq_wb_capture_one_in_flight_per_target
  on plm.wb_capture (target)
  where chunk_number = 0 and status in ('loading', 'validating');

create index idx_wb_capture_header_status
  on plm.wb_capture (status, target, started_at desc)
  where chunk_number = 0;

comment on table plm.wb_capture is
  'Chunked capture protocol for the eight plm.wb_* Warner STARLABS mirrors. Keyed '
  '(capture_id, chunk_number): chunk_number 0 is the capture HEADER, chunk_number >= 1 is '
  'a PAYLOAD CHUNK, and two CHECK constraints keep the two shapes from mixing. A caller '
  'streams bounded chunks through plm.load_wb_chunk and plm.finalize_wb_capture assembles '
  'them into the single whole-snapshot jsonb argument that the shipped '
  'plm.sync_wb_<entity> loaders require -- so guards G1 to G9, including the pinned '
  'baseline G8, run unmodified on the COMPLETE snapshot exactly once. '
  'RETENTION: payload chunks hold raw Warner rows, so they are a SECOND copy of '
  'confidential licensor data. The payload column is therefore cleared when a capture '
  'reaches a terminal state -- on complete because the rows have landed in the mirror, on '
  'fail because a duplicate copy of confidential data is not a diagnosis. What survives '
  'IS the diagnosis: per-chunk row counts and sha256 digests, which name the failing '
  'chunk without reproducing its contents. '
  'READ GATE: the same policy predicate as the eight mirrors -- administrator, the sales '
  'or licensing roles, or ANY principal holding plm app access. As corrected by '
  '20260810120000: plm app access is NOT a role, so a vendor or viewer whose profile has '
  'plm app access CAN read this table. Only anon and unauthenticated readers are '
  'excluded. service_role holds SELECT only; all writes go through the four SECURITY '
  'DEFINER capture functions. Business-confidential licensor data.';

comment on column plm.wb_capture.chunk_number is
  '0 = the capture header row. >= 1 = a payload chunk, in the caller''s send order. '
  'finalize requires the chunk numbers to be exactly 1..N with no gap and no duplicate, '
  'so a dropped chunk cannot assemble into a shorter snapshot that still looks whole.';
comment on column plm.wb_capture.target is
  'Which ONE of the eight plm.wb_* mirrors this capture feeds. One capture never feeds '
  'two: the shipped loaders are per-entity and each pins its own G8 row total, so a '
  'multi-target capture could not be validated as a unit.';
comment on column plm.wb_capture.expected_row_count is
  'Declared UP FRONT at begin, never afterwards. finalize refuses unless the assembled '
  'stream carries exactly this many rows. Deriving it at finalize would let a truncated '
  'stream define its own expectation and certify itself.';
comment on column plm.wb_capture.snapshot_sha256 is
  'The caller''s digest for the WHOLE stream: sha256 over the newline-joined, '
  'chunk-ordered list of per-chunk sha256 hex digests. Each per-chunk digest is '
  'RECOMPUTED server-side from the exact bytes received, so this chain is verified rather '
  'than merely declared -- see the comment on plm.load_wb_chunk.';
comment on column plm.wb_capture.chunk_sha256 is
  'sha256 of the exact UTF-8 bytes of this chunk''s JSON text as received. Recomputed '
  'server-side and refused on mismatch. Deliberately digests the RECEIVED TEXT and not '
  'the parsed jsonb: jsonb canonicalises (key order, escaping, number form), so a digest '
  'over jsonb::text could not be reproduced by the caller and would compare nothing.';
comment on column plm.wb_capture.payload is
  'The chunk''s rows. Cleared (set NULL, with payload_cleared_at stamped) as soon as the '
  'capture reaches complete or failed, because it is a second copy of confidential Warner '
  'data. The row count and the digest survive; those are what a diagnosis needs.';
comment on column plm.wb_capture.loader_report is
  'The shipped plm.sync_wb_<entity> return row, stored verbatim on success -- rows_seen, '
  'rows_landed, inserted/updated/unchanged/collapsed/missing and the snapshot hash. '
  'Finalizing is never reported as done without the loader''s own counts behind it.';

-- -------------------------------------------------------------------------------------
-- GRANTS. Deliberately explicit and REVOKE-first.
--
-- The plm schema carries a standing
--   `alter default privileges in schema plm grant all on tables to service_role`
-- (20260710135975_reconcile_service_role_grants.sql:14). It fires at CREATE TABLE, so
-- plm.wb_capture was granted EVERYTHING to service_role the moment the statement above
-- ran. A NARROWER GRANT DOES NOT REMOVE A BIT -- only REVOKE does. This is the exact trap
-- 20260810110000 and 20260810120000 had to fix on the eight mirrors after the fact.
--
-- The server is PostgreSQL 17.6 (server_version_num 170006, read from preview on
-- 2026-08-10), so `all` on a table includes MAINTAIN, which did not exist before 17.
-- `revoke all` covers it; do not hand-enumerate the privilege list here and risk missing
-- whichever privilege the next major version adds.
--
-- Posture, matching the eight mirrors after 20260810120000: service_role holds SELECT and
-- NOTHING ELSE. It does not need more. The four capture functions are SECURITY DEFINER
-- owned by postgres, so they write with the OWNER's privileges and never consume
-- service_role's table grants; service_role needs only EXECUTE on the four functions.
-- An INSERT grant here would be a second, unguarded write path into the same table.
-- -------------------------------------------------------------------------------------
revoke all on plm.wb_capture from public;
revoke all on plm.wb_capture from anon;
revoke all on plm.wb_capture from authenticated;
revoke all on plm.wb_capture from service_role;

grant select on plm.wb_capture to authenticated;
grant select on plm.wb_capture to service_role;

alter table plm.wb_capture enable row level security;

-- The same predicate the eight mirrors use (installed by 20260810110000, copied there
-- from 20260807190000_opa_security_and_view_corrections.sql:73-81). Reused verbatim
-- ON PURPOSE: this table transiently holds the same rows as those mirrors, so giving it
-- a DIFFERENT read gate would mean the copy is reachable by a different set of people
-- than the original. Note honestly what that predicate does -- app.has_app_access checks
-- only for a non-revoked app.app_access row and ignores roles entirely, so plm app
-- access alone is sufficient. Narrowing it is an owner decision affecting every table
-- that shares the pattern, and is out of scope for this migration.
drop policy if exists wb_capture_read on plm.wb_capture;
create policy wb_capture_read on plm.wb_capture
  for select to authenticated
  using (
    app.has_role('administrator')
    or app.has_app_access('plm')
    or app.has_any_role(array['sales','licensing']::app.app_role[])
  );

-- -------------------------------------------------------------------------------------
-- 2. plm.begin_wb_capture
--
-- Mirrors plm.begin_pmt_capture: resumable on an identical manifest, refuses a different
-- manifest while one is in flight, refuses re-opening a completed one, serialized by an
-- advisory lock.
-- -------------------------------------------------------------------------------------
create or replace function plm.begin_wb_capture(
  p_target                text,
  p_captured_at           date,
  p_private_source_commit text,
  p_snapshot_sha256       text,
  p_expected_row_count    integer,
  p_captured_by           text,
  p_source_url            text,
  p_notes                 text default null
)
returns uuid
language plpgsql
security definer
set search_path = plm, core, app, public, extensions
as $$
declare
  v_role    text := auth.role();
  v_capture uuid;
begin
  -- Same predicate as all eight shipped loaders. It takes SESSION_USER, not
  -- current_user: SECURITY DEFINER rewrites current_user to the function owner, so a
  -- current_user check inside a definer function always passes and guards nothing.
  if not plm.wb_loader_privilege_ok(v_role, session_user) then
    raise exception 'Warner capture refused: effective JWT role %L / session_user %L may '
      'not begin a capture. Run as service_role or through the shared-db apply workflow.',
      coalesce(v_role, '<null>'), coalesce(session_user, '<null>')
      using errcode = 'P0001';
  end if;

  -- One Warner capture at a time, for the whole life of the transaction.
  perform pg_advisory_xact_lock(hashtext('plm.wb_capture_import')::bigint);

  if p_target is null or p_target not in (
    'wb_franchise_property', 'wb_style_guide', 'wb_character', 'wb_asset',
    'wb_asset_style_guide', 'wb_asset_franchise_property', 'wb_asset_character',
    'wb_property_character'
  ) then
    raise exception 'Warner capture refused: target %L is not one of the eight plm.wb_* '
      'mirrors.', coalesce(p_target, '<null>') using errcode = 'P0001';
  end if;

  if p_snapshot_sha256 is null or p_snapshot_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'Warner capture refused: snapshot_sha256 must be 64 lowercase hex '
      'characters. Compute the chunk-digest chain before connecting.'
      using errcode = 'P0001';
  end if;

  if p_captured_at is null then
    raise exception 'Warner capture refused: captured_at is required and must be supplied '
      'explicitly. It is the SNAPSHOT date and is never derived from now() -- the server '
      'runs America/New_York, so a UTC-midnight value read through ::date lands on the '
      'previous day and would silently misdate the capture.' using errcode = 'P0001';
  end if;

  if p_expected_row_count is null or p_expected_row_count <= 0 then
    raise exception 'Warner capture refused: expected_row_count must be a positive '
      'integer declared up front. An empty or self-declared expectation is how a '
      'truncated extract certifies itself.' using errcode = 'P0001';
  end if;

  if btrim(coalesce(p_private_source_commit, '')) = '' then
    raise exception 'Warner capture refused: private_source_commit is required. A capture '
      'with no pinned source commit cannot be re-derived or audited.'
      using errcode = 'P0001';
  end if;

  if btrim(coalesce(p_captured_by, '')) = '' then
    raise exception 'Warner capture refused: captured_by is required.'
      using errcode = 'P0001';
  end if;

  if btrim(coalesce(p_source_url, '')) = '' then
    raise exception 'Warner capture refused: source_url is required.'
      using errcode = 'P0001';
  end if;
  -- An ORIGIN, never a full URL. A query string or fragment is how a session token or a
  -- signed portal URL ends up permanently stored in the database.
  if p_source_url ~ '[?#]' then
    raise exception 'Warner capture refused: source_url must be an ORIGIN only. It '
      'carries a query string or fragment, which is how a session token or a signed URL '
      'ends up stored in the database.' using errcode = 'P0001';
  end if;

  -- RESUME: the same manifest, same commit, same target, still in flight -> reuse it
  -- rather than forking a duplicate half-load.
  select h.capture_id into v_capture
  from plm.wb_capture h
  where h.chunk_number = 0
    and h.status in ('loading', 'validating')
    and h.target = p_target
    and h.snapshot_sha256 = p_snapshot_sha256
    and h.private_source_commit = p_private_source_commit
  order by h.started_at desc
  limit 1;

  if v_capture is not null then
    update plm.wb_capture set status = 'loading'
     where capture_id = v_capture and chunk_number = 0;
    raise notice 'Resuming in-flight Warner capture % for target %.', v_capture, p_target;
    return v_capture;
  end if;

  -- A DIFFERENT manifest while one is in flight for this target is a conflict, not a
  -- second capture. (The partial unique index enforces this too; this raises the
  -- readable error instead of a constraint violation.)
  if exists (
    select 1 from plm.wb_capture h
    where h.chunk_number = 0 and h.status in ('loading', 'validating') and h.target = p_target
  ) then
    raise exception 'Warner capture refused: another capture for target %L is already in '
      'flight with a different manifest. Finish it, or fail it with '
      'plm.fail_wb_capture, before starting a new one.', p_target
      using errcode = 'P0001';
  end if;

  -- A COMPLETED capture may never be re-opened or re-pointed.
  if exists (
    select 1 from plm.wb_capture h
    where h.chunk_number = 0 and h.status = 'complete'
      and h.target = p_target and h.snapshot_sha256 = p_snapshot_sha256
  ) then
    raise exception 'Warner capture refused: a COMPLETE capture already exists for target '
      '%L with this exact manifest. Completed captures are permanent evidence; re-loading '
      'the identical source would either duplicate the run or overwrite it.', p_target
      using errcode = 'P0001';
  end if;

  insert into plm.wb_capture (
    chunk_number, target, status, captured_at, private_source_commit, snapshot_sha256,
    expected_row_count, captured_by, source_url, started_at, notes
  ) values (
    0, p_target, 'loading', p_captured_at, p_private_source_commit, p_snapshot_sha256,
    p_expected_row_count, p_captured_by, p_source_url, now(), p_notes
  )
  returning capture_id into v_capture;

  return v_capture;
end;
$$;

comment on function plm.begin_wb_capture(text, date, text, text, integer, text, text, text) is
'Opens a chunked Warner STARLABS capture for ONE of the eight plm.wb_* mirrors, in status '
'loading. RESUMABLE: the same target, manifest digest and source commit returns the SAME '
'in-flight capture rather than forking a duplicate half-load. A different manifest while '
'one is in flight for that target is refused, and a manifest already loaded by a COMPLETE '
'capture is refused. expected_row_count is declared UP FRONT so a truncated stream cannot '
'define its own expectation. captured_at is required explicitly and is never derived from '
'now(). source_url must be an origin, so a signed URL or session token cannot be stored. '
'Serialized by advisory lock hashtext(''plm.wb_capture_import''). service_role only.';

-- -------------------------------------------------------------------------------------
-- 3. plm.load_wb_chunk -- the bounded streaming entry point
--
-- WHY p_rows_json IS text AND NOT jsonb -- DO NOT "TIDY" THIS INTO jsonb
--
-- The integrity check here is that the caller's declared per-chunk digest matches a
-- digest the SERVER recomputes from the bytes it actually received. That only works if
-- both sides digest the SAME bytes.
--
-- jsonb does not preserve bytes. It canonicalises: object keys are reordered, insignificant
-- whitespace is dropped, string escapes and numeric forms are normalised. So
-- sha256(p_rows::jsonb::text) is a digest of something the caller never produced and
-- cannot reproduce, and comparing it to the caller's digest would compare nothing --
-- it would fail on every honest chunk and therefore have to be deleted, leaving no check
-- at all.
--
-- Taking the chunk as TEXT keeps the received bytes intact long enough to digest them.
-- The cast to jsonb happens immediately afterwards, and a malformed chunk fails on that
-- cast, so nothing is stored untyped.
-- -------------------------------------------------------------------------------------
create or replace function plm.load_wb_chunk(
  p_capture_id   uuid,
  p_chunk_number integer,
  p_rows_json    text,
  p_chunk_sha256 text
)
returns integer
language plpgsql
security definer
set search_path = plm, core, app, public, extensions
as $$
declare
  v_role     text := auth.role();
  v_status   text;
  v_rows     jsonb;
  v_n        integer;
  v_computed text;
  v_existing text;
begin
  if not plm.wb_loader_privilege_ok(v_role, session_user) then
    raise exception 'Warner capture refused: effective JWT role %L / session_user %L may '
      'not load capture chunks.', coalesce(v_role, '<null>'), coalesce(session_user, '<null>')
      using errcode = 'P0001';
  end if;

  select h.status into v_status
  from plm.wb_capture h
  where h.capture_id = p_capture_id and h.chunk_number = 0;

  if v_status is null then
    raise exception 'Warner capture refused: capture % does not exist.', p_capture_id
      using errcode = 'P0001';
  end if;
  if v_status <> 'loading' then
    raise exception 'Warner capture refused: capture % is %L, not loading. A capture that '
      'has left the loading state may not receive more chunks.', p_capture_id, v_status
      using errcode = 'P0001';
  end if;

  if p_chunk_number is null or p_chunk_number < 1 then
    raise exception 'Warner capture refused: chunk_number must be >= 1 (0 is the capture '
      'header). Got %.', coalesce(p_chunk_number, -1) using errcode = 'P0001';
  end if;

  if p_chunk_sha256 is null or p_chunk_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'Warner capture refused: chunk_sha256 must be 64 lowercase hex '
      'characters.' using errcode = 'P0001';
  end if;

  if p_rows_json is null then
    raise exception 'Warner capture refused: chunk % carried no payload.', p_chunk_number
      using errcode = 'P0001';
  end if;

  -- INTEGRITY, FIRST, ON THE RECEIVED BYTES. Before parsing, before storing.
  v_computed := encode(sha256(convert_to(p_rows_json, 'UTF8')), 'hex');
  if v_computed <> p_chunk_sha256 then
    raise exception 'Warner capture refused: chunk % failed its integrity check. The '
      'digest recomputed from the bytes received does not match the digest declared for '
      'this chunk. The chunk was altered, truncated or mispaired in transit. No digest '
      'and no row content is echoed here because this database''s logs are not private.',
      p_chunk_number using errcode = 'P0001';
  end if;

  begin
    v_rows := p_rows_json::jsonb;
  exception when others then
    raise exception 'Warner capture refused: chunk % is not parseable JSON.', p_chunk_number
      using errcode = 'P0001';
  end;

  if jsonb_typeof(v_rows) <> 'array' then
    raise exception 'Warner capture refused: chunk % must be a JSON array of row objects, '
      'got %.', p_chunk_number, coalesce(jsonb_typeof(v_rows), 'null')
      using errcode = 'P0001';
  end if;

  v_n := jsonb_array_length(v_rows);
  if v_n = 0 then
    raise exception 'Warner capture refused: chunk % is empty. An empty chunk contributes '
      'nothing and would make the chunk numbering lie about how much was sent.',
      p_chunk_number using errcode = 'P0001';
  end if;

  -- BOUNDED. A working bound, not a transport limit -- see the measurement note at the
  -- head of this migration: 64 MB in a single bind was accepted on both the Postgres wire
  -- and the PostgREST path. The bound exists so one chunk is one small transaction with a
  -- bounded retry cost and a bounded peak memory footprint.
  if v_n > 25000 then
    raise exception 'Warner capture refused: chunk % carries % rows, over the 25000-row '
      'working bound. Send smaller chunks.', p_chunk_number, v_n using errcode = 'P0001';
  end if;

  -- IDEMPOTENT RETRY, BUT NOT SILENT REPLACEMENT. Re-sending the identical chunk after a
  -- dropped connection is a no-op. Re-sending DIFFERENT content under the same chunk
  -- number is refused: silently overwriting it would let a stream be edited mid-flight
  -- while its manifest still claimed to describe the original.
  select c.chunk_sha256 into v_existing
  from plm.wb_capture c
  where c.capture_id = p_capture_id and c.chunk_number = p_chunk_number;

  if v_existing is not null then
    if v_existing = p_chunk_sha256 then
      return v_n;
    end if;
    raise exception 'Warner capture refused: chunk % has already been loaded for this '
      'capture with DIFFERENT content. A chunk number is not a slot to be overwritten.',
      p_chunk_number using errcode = 'P0001';
  end if;

  insert into plm.wb_capture (capture_id, chunk_number, payload, payload_row_count, chunk_sha256)
  values (p_capture_id, p_chunk_number, v_rows, v_n, p_chunk_sha256);

  return v_n;
end;
$$;

comment on function plm.load_wb_chunk(uuid, integer, text, text) is
'Streams ONE bounded chunk of a Warner capture. Takes the chunk as TEXT, not jsonb, so '
'the server can recompute sha256 over the EXACT bytes received and compare it to the '
'caller''s declared digest -- jsonb canonicalises key order, whitespace, escaping and '
'number form, so a digest taken after the cast would be of something the caller never '
'produced and could not reproduce. A chunk whose digest does not match is REFUSED before '
'it is parsed or stored. Also refuses: a capture that is not loading, chunk_number < 1, '
'a non-array or empty chunk, more than 25000 rows, and re-use of a chunk number for '
'different content. Re-sending an IDENTICAL chunk is an idempotent no-op so a dropped '
'connection can be resumed. Returns the row count so the caller can assert it rather than '
'assume it. service_role only.';

-- -------------------------------------------------------------------------------------
-- 4. plm.finalize_wb_capture -- the only path to complete
--
-- Assembles the chunks into the ONE whole-snapshot jsonb the shipped loader requires and
-- calls it. Every one of that loader's guards G1-G9 then runs, unmodified, on the
-- COMPLETE snapshot -- including the pinned-baseline assertion G8, which is the guard
-- chunking would otherwise have defeated.
-- -------------------------------------------------------------------------------------
create or replace function plm.finalize_wb_capture(
  p_capture_id          uuid,
  p_snapshot_sha256     text,
  p_max_shrink_fraction numeric default 0.10
)
returns table (
  mode                 text,
  snapshot_captured_at date,
  rows_seen            integer,
  rows_landed          integer,
  rows_inserted        integer,
  rows_updated         integer,
  rows_unchanged       integer,
  rows_collapsed       integer,
  rows_missing         integer,
  rows_orphan_identity integer,
  snapshot_hash        text
)
language plpgsql
security definer
set search_path = plm, core, app, public, extensions
as $$
declare
  v_role      text := auth.role();
  h           plm.wb_capture%rowtype;
  v_chunks    integer;
  v_maxchunk  integer;
  v_total     integer;
  v_chain     text;
  v_snapshot  jsonb;
  v_rows      jsonb;
  v_report    jsonb;
  r           record;
begin
  if not plm.wb_loader_privilege_ok(v_role, session_user) then
    raise exception 'Warner finalize refused: effective JWT role %L / session_user %L may '
      'not finalize a capture.', coalesce(v_role, '<null>'), coalesce(session_user, '<null>')
      using errcode = 'P0001';
  end if;

  -- Two Warner captures must never finalize together.
  perform pg_advisory_xact_lock(hashtext('plm.wb_capture_import')::bigint);

  select * into h from plm.wb_capture
   where capture_id = p_capture_id and chunk_number = 0
   for update;

  if h.capture_id is null then
    raise exception 'Warner finalize refused: capture % does not exist.', p_capture_id
      using errcode = 'P0001';
  end if;
  if h.status = 'complete' then
    raise exception 'Warner finalize refused: capture % is already complete and immutable.',
      p_capture_id using errcode = 'P0001';
  end if;
  if h.status not in ('loading', 'validating') then
    raise exception 'Warner finalize refused: capture % is %L and cannot be completed.',
      p_capture_id, h.status using errcode = 'P0001';
  end if;

  -- MANIFEST IDENTITY. The manifest presented at finalize must be the one the capture
  -- began with. Otherwise a capture could be streamed from one source set and certified
  -- against another.
  if p_snapshot_sha256 is distinct from h.snapshot_sha256 then
    raise exception 'Warner finalize refused: the manifest digest presented does not match '
      'the digest this capture began with. A capture may not be certified against a '
      'different source set.' using errcode = 'P0001';
  end if;

  update plm.wb_capture set status = 'validating'
   where capture_id = p_capture_id and chunk_number = 0;

  select count(*), coalesce(max(c.chunk_number), 0), coalesce(sum(c.payload_row_count), 0)
    into v_chunks, v_maxchunk, v_total
  from plm.wb_capture c
  where c.capture_id = p_capture_id and c.chunk_number >= 1;

  if v_chunks = 0 then
    raise exception 'Warner finalize refused: capture % received no chunks. An empty '
      'stream is a failed extract, not an empty snapshot.', p_capture_id
      using errcode = 'P0001';
  end if;

  -- CONTIGUITY. Chunk numbers must be exactly 1..N. A dropped chunk would otherwise
  -- assemble into a shorter snapshot that still looked internally consistent.
  if v_maxchunk <> v_chunks then
    raise exception 'Warner finalize refused: capture % holds % chunk(s) but the highest '
      'chunk number is %. The chunk sequence has a gap, so at least one chunk never '
      'arrived.', p_capture_id, v_chunks, v_maxchunk using errcode = 'P0001';
  end if;

  -- COMPLETENESS against the count declared at begin, before any chunk was sent.
  if v_total <> h.expected_row_count then
    raise exception 'Warner finalize refused: capture % assembled % row(s) but declared % '
      'at begin. A stream that does not carry what it promised is a truncated extract.',
      p_capture_id, v_total, h.expected_row_count using errcode = 'P0001';
  end if;

  -- DIGEST CHAIN. Each per-chunk digest was already verified against the bytes received
  -- in plm.load_wb_chunk; this proves the SET and ORDER of those verified chunks is the
  -- one the manifest describes.
  select encode(sha256(convert_to(
           string_agg(c.chunk_sha256, E'\n' order by c.chunk_number), 'UTF8')), 'hex')
    into v_chain
  from plm.wb_capture c
  where c.capture_id = p_capture_id and c.chunk_number >= 1;

  if v_chain is distinct from h.snapshot_sha256 then
    raise exception 'Warner finalize refused: the chunk-digest chain for capture % does '
      'not reproduce the manifest digest declared at begin. The chunks that arrived are '
      'not the chunks the manifest describes.', p_capture_id using errcode = 'P0001';
  end if;

  -- ASSEMBLE. Chunk order first, then row order within the chunk.
  select jsonb_agg(e.value order by c.chunk_number, e.ord)
    into v_rows
  from plm.wb_capture c
  cross join lateral jsonb_array_elements(c.payload) with ordinality as e(value, ord)
  where c.capture_id = p_capture_id and c.chunk_number >= 1;

  v_snapshot := jsonb_build_object(
    'captured_at', to_char(h.captured_at, 'YYYY-MM-DD'),
    'rows', v_rows
  );

  -- DISPATCH. A fixed if/elsif over the eight shipped loaders, deliberately NOT dynamic
  -- SQL over a table name: there is no target string a caller can smuggle into an
  -- EXECUTE here, and each call site is greppable.
  --
  -- p_mode is pinned to 'mirror_only' -- the only mode the loaders support. Promotion to
  -- core.* is an open owner decision with no code path, and this protocol does not
  -- become the place one appears.
  if    h.target = 'wb_franchise_property' then
    select * into r from plm.sync_wb_franchise_property(v_snapshot, 'mirror_only', p_max_shrink_fraction);
  elsif h.target = 'wb_style_guide' then
    select * into r from plm.sync_wb_style_guide(v_snapshot, 'mirror_only', p_max_shrink_fraction);
  elsif h.target = 'wb_character' then
    select * into r from plm.sync_wb_character(v_snapshot, 'mirror_only', p_max_shrink_fraction);
  elsif h.target = 'wb_asset' then
    select * into r from plm.sync_wb_asset(v_snapshot, 'mirror_only', p_max_shrink_fraction);
  elsif h.target = 'wb_asset_style_guide' then
    select * into r from plm.sync_wb_asset_style_guide(v_snapshot, 'mirror_only', p_max_shrink_fraction);
  elsif h.target = 'wb_asset_franchise_property' then
    select * into r from plm.sync_wb_asset_franchise_property(v_snapshot, 'mirror_only', p_max_shrink_fraction);
  elsif h.target = 'wb_asset_character' then
    select * into r from plm.sync_wb_asset_character(v_snapshot, 'mirror_only', p_max_shrink_fraction);
  elsif h.target = 'wb_property_character' then
    select * into r from plm.sync_wb_property_character(v_snapshot, 'mirror_only', p_max_shrink_fraction);
  else
    -- Unreachable while the CHECK constraint and begin's allow-list agree. Kept so that
    -- if a ninth mirror is ever added to one and not the other, it fails loudly here
    -- rather than finalizing a capture that loaded nothing.
    raise exception 'Warner finalize refused: capture % has target %L, which has no '
      'loader. The target allow-list and the dispatch list have diverged.',
      p_capture_id, h.target using errcode = 'P0001';
  end if;

  v_report := to_jsonb(r);

  update plm.wb_capture
     set status = 'complete',
         completed_at = now(),
         loader_report = v_report,
         failure_message = null
   where capture_id = p_capture_id and chunk_number = 0;

  -- RETENTION. The rows have landed in the mirror; the chunk payloads are now a second
  -- copy of confidential Warner data with no remaining purpose. Clear them and keep the
  -- per-chunk counts and digests, which are what any later diagnosis actually needs.
  update plm.wb_capture
     set payload = null, payload_cleared_at = now()
   where capture_id = p_capture_id and chunk_number >= 1 and payload is not null;

  return query
  select (v_report->>'mode')::text,
         (v_report->>'snapshot_captured_at')::date,
         (v_report->>'rows_seen')::integer,
         (v_report->>'rows_landed')::integer,
         (v_report->>'rows_inserted')::integer,
         (v_report->>'rows_updated')::integer,
         (v_report->>'rows_unchanged')::integer,
         (v_report->>'rows_collapsed')::integer,
         (v_report->>'rows_missing')::integer,
         (v_report->>'rows_orphan_identity')::integer,
         (v_report->>'snapshot_hash')::text;
end;
$$;

comment on function plm.finalize_wb_capture(uuid, text, numeric) is
'The ONLY path to status complete. Verifies that the chunk sequence is exactly 1..N with '
'no gap, that the assembled row total equals the count declared at begin, and that the '
'chunk-digest chain reproduces the manifest digest presented at begin -- then assembles '
'the chunks into the single whole-snapshot jsonb argument the shipped '
'plm.sync_wb_<entity> loader requires and calls it. Every loader guard G1-G9, INCLUDING '
'the pinned-baseline assertion G8, therefore runs unmodified on the COMPLETE snapshot '
'exactly once; this protocol streams the snapshot, it does not weaken the loader. '
'Dispatch is a fixed if/elsif over the eight loaders, never dynamic SQL over a table '
'name. Mode is pinned to mirror_only. On success the loader''s own return row is stored '
'in loader_report and the chunk payloads are cleared, because a landed row does not need '
'a second confidential copy. Takes the same advisory lock as begin. service_role only.';

-- -------------------------------------------------------------------------------------
-- 5. plm.fail_wb_capture
--
-- Differs DELIBERATELY from plm.fail_pmt_capture in one respect. Paramount leaves a
-- failed capture''s rows in place, because those rows ARE its evidence -- they sit in
-- capture-scoped tables and are the only record of what the scrape returned. Warner
-- chunks are not evidence: they are a transient second copy of rows that either landed
-- in the mirror or never will. Keeping 60 MB of confidential licensor data around to
-- document a failure is a cost with no benefit, so the payload is cleared and the
-- per-chunk row counts and digests -- which name the failing chunk without reproducing
-- its contents -- are what is kept.
-- -------------------------------------------------------------------------------------
create or replace function plm.fail_wb_capture(
  p_capture_id uuid,
  p_reason     text
)
returns void
language plpgsql
security definer
set search_path = plm, core, app, public, extensions
as $$
declare
  v_role   text := auth.role();
  v_status text;
begin
  if not plm.wb_loader_privilege_ok(v_role, session_user) then
    raise exception 'Warner fail refused: effective JWT role %L / session_user %L may not '
      'fail a capture.', coalesce(v_role, '<null>'), coalesce(session_user, '<null>')
      using errcode = 'P0001';
  end if;

  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'Warner fail refused: a reason is required. An unexplained failure is '
      'indistinguishable from an abandoned run.' using errcode = 'P0001';
  end if;

  select h.status into v_status
  from plm.wb_capture h
  where h.capture_id = p_capture_id and h.chunk_number = 0;

  if v_status is null then
    raise exception 'Warner fail refused: capture % does not exist.', p_capture_id
      using errcode = 'P0001';
  end if;

  -- A COMPLETE capture is permanent. Marking it failed afterwards would rewrite the
  -- record of a load that actually happened and whose rows are in the mirror.
  if v_status = 'complete' then
    raise exception 'Warner fail refused: capture % is complete. A completed capture is '
      'permanent evidence of a load that really happened and may not be re-labelled.',
      p_capture_id using errcode = 'P0001';
  end if;

  update plm.wb_capture
     set status = 'failed',
         failure_message = left(p_reason, 2000),
         completed_at = coalesce(completed_at, now())
   where capture_id = p_capture_id and chunk_number = 0;

  -- CLEAN. Drop the transient confidential payload, keep the diagnosis.
  update plm.wb_capture
     set payload = null, payload_cleared_at = now()
   where capture_id = p_capture_id and chunk_number >= 1 and payload is not null;
end;
$$;

comment on function plm.fail_wb_capture(uuid, text) is
'Marks an in-flight or abandoned Warner capture FAILED with a mandatory reason, and '
'CLEANS it: the chunk payloads are cleared while the per-chunk row counts and sha256 '
'digests are kept. This deliberately differs from plm.fail_pmt_capture, which leaves rows '
'in place -- Paramount''s rows ARE its evidence, whereas a Warner chunk is a transient '
'second copy of confidential licensor data, and retaining 60 MB of it to document a '
'failure is a cost with no benefit. Refuses a blank reason, an unknown capture, and a '
'COMPLETE capture, which is permanent. service_role only.';

-- -------------------------------------------------------------------------------------
-- 6. FUNCTION GRANTS. REVOKE-first, exactly as the shipped loaders do.
--
-- All four are import functions: service_role only. Unlike Paramount there is no
-- read-only reporter to grant to authenticated, because there is no separate validator
-- (see the header note). Reading a capture''s progress is done by SELECTing
-- plm.wb_capture, which RLS already gates.
-- -------------------------------------------------------------------------------------
revoke all on function plm.begin_wb_capture(text, date, text, text, integer, text, text, text) from public;
revoke all on function plm.load_wb_chunk(uuid, integer, text, text) from public;
revoke all on function plm.finalize_wb_capture(uuid, text, numeric) from public;
revoke all on function plm.fail_wb_capture(uuid, text) from public;

revoke all on function plm.begin_wb_capture(text, date, text, text, integer, text, text, text) from anon, authenticated;
revoke all on function plm.load_wb_chunk(uuid, integer, text, text) from anon, authenticated;
revoke all on function plm.finalize_wb_capture(uuid, text, numeric) from anon, authenticated;
revoke all on function plm.fail_wb_capture(uuid, text) from anon, authenticated;

grant execute on function plm.begin_wb_capture(text, date, text, text, integer, text, text, text) to service_role;
grant execute on function plm.load_wb_chunk(uuid, integer, text, text) to service_role;
grant execute on function plm.finalize_wb_capture(uuid, text, numeric) to service_role;
grant execute on function plm.fail_wb_capture(uuid, text) to service_role;
