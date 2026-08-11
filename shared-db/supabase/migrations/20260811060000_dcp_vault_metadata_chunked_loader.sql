-- =====================================================================================
-- Disney DCP Vault -- PHASE 2 metadata chunked loader protocol.
--
-- Migration: 20260811060000_dcp_vault_metadata_chunked_loader.sql
-- Issue:     u2giants/shared-db #748. Object claim: #749.
-- Version:   ALLOCATED BY THE ORCHESTRATOR, not chosen from now(). See the note at the
--            head of 20260811050000.
-- Requires:  20260811050000 (the metadata landing schema) and, through it,
--            20260810190000 / 20260810190100 (the Phase-1 path-crawl landing and loader).
--            This migration may not be promoted without 20260811050000.
--
-- SCHEMA AND FUNCTIONS ONLY. THIS MIGRATION LOADS NO DATA.
--
-- -------------------------------------------------------------------------------------
-- CONFIDENTIALITY. u2giants/shared-db is PUBLIC. No Disney property, character, style
-- guide, DAM path, file name or portal URL appears here, in any comment, in any CHECK, or
-- in any error message. EVERY exception below reports counts, codes, row numbers and
-- identifiers -- never a source value -- because this database's logs are not private.
--
-- =====================================================================================
-- SECTION -1. TWO TABLES THAT LOOK LIKE DUPLICATES AND ARE NOT.
--
-- This migration creates plm.dcp_metadata_chunk_ledger and
-- plm.dcp_metadata_load_exception, which look like copies of plm.dcp_chunk_ledger and
-- plm.dcp_load_exception from the Phase-1 loader. REUSING EITHER PHASE-1 TABLE IS
-- STRUCTURALLY IMPOSSIBLE, and the reason is the same for both. It is worth understanding
-- before anyone "removes the duplication".
--
--   A metadata run may only exist over a path crawl whose status is ALREADY 'complete'
--   (that is the whole precondition -- you cannot fetch metadata for an asset list that
--   is still being discovered). But BOTH Phase-1 tables are guarded by
--   plm.dcp_reject_completed_crawl_change, which refuses INSERT, UPDATE and DELETE once
--   the owning crawl is complete -- INSERT very much included, deliberately.
--
--   So the FIRST metadata chunk ledger row, and the FIRST metadata load exception, would
--   each be refused with P0001 by a Phase-1 guard doing exactly its job. Not a bug to work
--   around: freezing a completed crawl's evidence is correct, and metadata evidence simply
--   is not that crawl's evidence. It belongs to the RUN.
--
--   These two tables are therefore keyed on metadata_run_id and frozen by the RUN's
--   lifecycle instead. Weakening the Phase-1 trigger to make room for them would have
--   unfrozen every completed path crawl in the database to save two tables.
--
-- =====================================================================================
-- SECTION 0. THE ONE-ROW-PER-EXPECTED-ASSET INVARIANT, ESTABLISHED AT BEGIN TIME
--
-- plm.begin_dcp_metadata_run SEEDS one 'pending' plm.dcp_metadata_asset row for every
-- asset in the source crawl, in a single INSERT ... SELECT, before any chunk arrives.
-- Chunks then UPDATE those rows; they never insert new ones.
--
-- WHY, rather than inserting rows as responses arrive: it converts "every expected asset
-- has exactly one fetch row" from something finalization must GO LOOKING FOR into
-- something that is true from the first second and cannot become false. A loader that
-- inserted on arrival could silently cover 155,000 of 155,908 assets and finalization
-- would have to detect the shortfall by counting -- which works only if the expected
-- count is itself trustworthy. With seeding, a missing response is a row still sitting in
-- 'pending', which finalization refuses, and which an operator can list directly.
--
-- It also means a chunk naming an asset OUTSIDE the source crawl matches no seeded row at
-- all, and is rejected into plm.dcp_metadata_load_exception rather than quietly creating
-- a row the composite foreign keys would then have to catch.
-- =====================================================================================

-- =====================================================================================
-- SECTION 1. plm.dcp_metadata_chunk_ledger
-- =====================================================================================
create table plm.dcp_metadata_chunk_ledger (
  metadata_run_id uuid not null
    references plm.dcp_metadata_run(metadata_run_id) on delete cascade,
  chunk_number    integer not null,
  chunk_sha256    text not null,
  rows_received   integer not null,
  rows_landed     integer not null,
  rows_rejected   integer not null,
  applied_at      timestamptz not null default now(),

  constraint dcp_metadata_chunk_ledger_pkey primary key (metadata_run_id, chunk_number),
  constraint dcp_metadata_chunk_ledger_number_chk check (chunk_number >= 1),
  constraint dcp_metadata_chunk_ledger_sha_chk check (chunk_sha256 ~ '^[0-9a-f]{64}$'),
  constraint dcp_metadata_chunk_ledger_counts_chk check (
    rows_received > 0 and rows_landed >= 0 and rows_rejected >= 0
    and rows_landed + rows_rejected = rows_received
  )
);

comment on table plm.dcp_metadata_chunk_ledger is
'One row per APPLIED chunk of a DCP Vault METADATA run. Digests and counts only -- never '
'the payload, which by then already lives in plm.dcp_metadata_asset and would be a second '
'copy of confidential licensor data. Re-sending an IDENTICAL chunk after a dropped '
'connection is an idempotent no-op; re-sending DIFFERENT content under the same chunk '
'number is REFUSED, because a chunk number is not a slot to be overwritten. The constraint '
'landed + rejected = received is the structural form of "no row is ever silently skipped". '
'This is NOT a duplicate of plm.dcp_chunk_ledger: that table is frozen by the completed '
'path crawl it hangs off, and a metadata run REQUIRES a completed crawl, so its first row '
'would be refused -- see section -1 of migration 20260811060000.';
comment on column plm.dcp_metadata_chunk_ledger.chunk_sha256 is
'sha256 of the exact UTF-8 bytes of this chunk''s JSON TEXT as received, recomputed '
'server-side and refused on mismatch. Deliberately digests the RECEIVED TEXT and not the '
'parsed jsonb: jsonb canonicalises key order, whitespace, escaping and number form, so a '
'digest taken after the cast would be of something the caller never produced and could not '
'reproduce -- it would fail on every honest chunk and would then have to be deleted, '
'leaving no integrity check at all.';

revoke all on plm.dcp_metadata_chunk_ledger from public;
revoke all on plm.dcp_metadata_chunk_ledger from anon;
revoke all on plm.dcp_metadata_chunk_ledger from service_role;
grant select on plm.dcp_metadata_chunk_ledger to authenticated;
grant select on plm.dcp_metadata_chunk_ledger to service_role;

alter table plm.dcp_metadata_chunk_ledger enable row level security;
drop policy if exists dcp_metadata_chunk_ledger_read on plm.dcp_metadata_chunk_ledger;
create policy dcp_metadata_chunk_ledger_read on plm.dcp_metadata_chunk_ledger
  for select to authenticated
  using (
    app.has_role('administrator')
    or app.has_app_access('plm')
    or app.has_any_role(array['sales', 'licensing']::app.app_role[])
  );

-- INSERT is covered as well as UPDATE and DELETE, for the reason set out in section 5 of
-- 20260811050000: a ledger row added to a completed run would claim a chunk that run never
-- applied, and would break the reconciliation finalization already performed.
create trigger trg_dcp_metadata_chunk_ledger_immutable
  before insert or update or delete on plm.dcp_metadata_chunk_ledger
  for each row execute function plm.dcp_reject_completed_metadata_change();

-- =====================================================================================
-- SECTION 2. plm.dcp_metadata_load_exception
--
-- A silent skip is the exact failure mode this table exists to make impossible. If the
-- loader cannot land a row, a row lands HERE. There is no third outcome, and the ledger's
-- landed + rejected = received CHECK makes a third outcome arithmetically impossible.
-- =====================================================================================
create table plm.dcp_metadata_load_exception (
  id              uuid primary key default gen_random_uuid(),
  metadata_run_id uuid not null
    references plm.dcp_metadata_run(metadata_run_id) on delete cascade,
  chunk_number    integer null,
  row_number      integer null,

  severity        text not null default 'rejected',
  reason_code     text not null,
  reason          text not null,

  -- DELIBERATELY NO source_path COLUMN AND NO raw_row COLUMN.
  -- The Phase-1 exception table has both, and they earn their place there because a
  -- path-crawl rejection is usually a malformed path that an operator must SEE to fix.
  -- Here the payload is a full licensed metadata response; storing rejected responses
  -- would accumulate exactly the licensor rows this schema works to keep bounded, in the
  -- one table most likely to be read casually during triage. The asset is identified by
  -- id instead, which is resolvable by an authorised reader and meaningless in a log.
  dcp_asset_id    uuid null references plm.dcp_asset(id) on delete set null,

  resolved_at     timestamptz null,
  resolution_note text null,
  created_at      timestamptz not null default now(),

  constraint dcp_metadata_load_exception_severity_chk
    check (severity in ('rejected','warning')),
  constraint dcp_metadata_load_exception_reason_code_chk check (btrim(reason_code) <> ''),
  constraint dcp_metadata_load_exception_reason_chk check (btrim(reason) <> ''),
  constraint dcp_metadata_load_exception_chunk_chk
    check (chunk_number is null or chunk_number >= 1)
);

create index idx_dcp_metadata_load_exception_run
  on plm.dcp_metadata_load_exception (metadata_run_id);
create index idx_dcp_metadata_load_exception_open
  on plm.dcp_metadata_load_exception (metadata_run_id)
  where resolved_at is null;
create index idx_dcp_metadata_load_exception_reason_code
  on plm.dcp_metadata_load_exception (reason_code);

comment on table plm.dcp_metadata_load_exception is
'Rejected and questionable rows from a DCP Vault METADATA chunk load. If the loader cannot '
'land a row, a row lands HERE -- there is no silent skip, and the chunk ledger''s '
'landed + rejected = received CHECK makes a third outcome arithmetically impossible. It '
'stores NO response payload and NO source path, unlike its Phase-1 counterpart: a rejected '
'metadata response is a full licensed record, and accumulating those in the table most '
'likely to be read during casual triage is the opposite of keeping licensor rows bounded. '
'Unresolved `rejected` rows BLOCK finalization; `warning` rows do not.';

revoke all on plm.dcp_metadata_load_exception from public;
revoke all on plm.dcp_metadata_load_exception from anon;
revoke update, delete, truncate, references, trigger, maintain
  on plm.dcp_metadata_load_exception from service_role;
grant select, insert on plm.dcp_metadata_load_exception to service_role;
grant select on plm.dcp_metadata_load_exception to authenticated;

alter table plm.dcp_metadata_load_exception enable row level security;
drop policy if exists dcp_metadata_load_exception_read on plm.dcp_metadata_load_exception;
create policy dcp_metadata_load_exception_read on plm.dcp_metadata_load_exception
  for select to authenticated
  using (
    app.has_role('administrator')
    or app.has_app_access('plm')
    or app.has_any_role(array['sales', 'licensing']::app.app_role[])
  );

-- The narrower freeze, matching plm.dcp_load_exception_freeze in Phase 1 and for the same
-- reason: once the run is complete INSERT and DELETE are refused, but a human must still
-- be able to triage a warning -- and "later" is nearly always after the run finished.
create or replace function plm.dcp_metadata_load_exception_freeze()
returns trigger
language plpgsql
as $$
declare
  v_run    uuid;
  v_status text;
begin
  if tg_op = 'DELETE' then v_run := old.metadata_run_id; else v_run := new.metadata_run_id; end if;
  select r.status into v_status
  from plm.dcp_metadata_run r where r.metadata_run_id = v_run;

  if v_status is distinct from 'complete' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'INSERT' then
    raise exception 'DCP Vault metadata run % is COMPLETE; a load exception it never '
      'produced may not be inserted.', v_run using errcode = 'P0001';
  end if;
  if tg_op = 'DELETE' then
    raise exception 'DCP Vault metadata run % is COMPLETE; its load exceptions may not be '
      'deleted. Deleting a finding is how a finding stops existing.', v_run
      using errcode = 'P0001';
  end if;

  -- `id` is compared too. Without it a completed run's finding could be RE-KEYED -- every
  -- other column identical, a new primary key -- breaking any external reference to that
  -- finding while looking like nothing changed.
  if new.id              is distinct from old.id
  or new.metadata_run_id is distinct from old.metadata_run_id
  or new.chunk_number    is distinct from old.chunk_number
  or new.row_number      is distinct from old.row_number
  or new.severity        is distinct from old.severity
  or new.reason_code     is distinct from old.reason_code
  or new.reason          is distinct from old.reason
  or new.dcp_asset_id    is distinct from old.dcp_asset_id
  or new.created_at      is distinct from old.created_at then
    raise exception 'DCP Vault metadata run % is COMPLETE: the source fields of a load '
      'exception are immutable. Only resolved_at and resolution_note may change, so a '
      'human can still triage a warning after the run finished.', v_run
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

comment on function plm.dcp_metadata_load_exception_freeze() is
'Narrower freeze for plm.dcp_metadata_load_exception, matching Phase 1''s '
'plm.dcp_load_exception_freeze. Once the owning run is complete: INSERT refused, DELETE '
'refused, and UPDATE may change ONLY resolved_at and resolution_note. A DELIBERATE '
'carve-out: warnings are precisely the entries a human triages LATER, and later is nearly '
'always after the run finished, so a wholesale freeze would make those two columns dead '
'weight from the first completed run. Unresolved REJECTED rows still block finalization, '
'so this cannot be used to complete a run over open rejections and tidy them afterwards.';

create trigger trg_dcp_metadata_load_exception_immutable
  before insert or update or delete on plm.dcp_metadata_load_exception
  for each row execute function plm.dcp_metadata_load_exception_freeze();

-- =====================================================================================
-- SECTION 3. plm.begin_dcp_metadata_run
--
-- Opens a metadata run in status `running` and seeds one pending row per expected asset.
-- =====================================================================================
create or replace function plm.begin_dcp_metadata_run(
  p_source_crawl_id       uuid,
  p_captured_on           date,
  p_endpoint_suffix       text,
  p_crawler_version       text,
  p_captured_by           text,
  p_private_source_commit text,
  p_metadata              jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
-- pg_catalog FIRST so builtin resolution is safe BY CONSTRUCTION rather than by whatever
-- grants happen to hold on the day. A definer function that resolves `sha256` or `now`
-- through a caller-influenced schema is the classic definer escalation.
set search_path = pg_catalog, plm, core, app, extensions
as $$
declare
  v_role     text := auth.role();
  v_status   text;
  v_expected integer;
  v_run      uuid;
begin
  if not plm.dcp_loader_privilege_ok(v_role, session_user) then
    raise exception 'DCP Vault metadata run refused: effective JWT role %L / session_user '
      '%L may not begin a metadata run.',
      coalesce(v_role, '<null>'), coalesce(session_user, '<null>')
      using errcode = 'P0001';
  end if;

  select c.status into v_status from plm.dcp_crawl c where c.crawl_id = p_source_crawl_id;
  if v_status is null then
    raise exception 'DCP Vault metadata run refused: source crawl % does not exist.',
      p_source_crawl_id using errcode = 'P0001';
  end if;

  -- THE PRECONDITION. Metadata is fetched per asset PATH, so the asset list must be
  -- final. Running against a crawl still in progress would fix assets_expected against a
  -- moving target and the run could never reconcile honestly.
  if v_status <> 'complete' then
    raise exception 'DCP Vault metadata run refused: source crawl % is %L, not complete. '
      'Metadata is fetched per asset path, so the path crawl must be finished and '
      'reconciled first -- otherwise assets_expected is fixed against a list that is still '
      'growing.', p_source_crawl_id, v_status using errcode = 'P0001';
  end if;

  -- Serialise begins for this crawl. The partial unique index enforces the rule; this
  -- lock turns a concurrent loser's unique violation into a clean, explainable refusal.
  perform pg_advisory_xact_lock(hashtext('plm.dcp_metadata_run'), hashtext(p_source_crawl_id::text));

  if exists (
    select 1 from plm.dcp_metadata_run r
    where r.source_crawl_id = p_source_crawl_id and r.status = 'running'
  ) then
    raise exception 'DCP Vault metadata run refused: a run is already RUNNING for source '
      'crawl %. Two concurrent runs would each finalize against the other''s rows.',
      p_source_crawl_id using errcode = 'P0001';
  end if;

  -- assets_expected is READ FROM THE EVIDENCE, never accepted from the caller. A
  -- caller-supplied target is a target the caller can make match whatever it managed to
  -- load.
  select count(*) into v_expected
  from plm.dcp_asset_crawl ac where ac.crawl_id = p_source_crawl_id;

  if v_expected = 0 then
    raise exception 'DCP Vault metadata run refused: source crawl % has zero asset '
      'memberships. A metadata run over nothing would finalize instantly and truthfully '
      'report complete, which is the most misleading possible outcome.', p_source_crawl_id
      using errcode = 'P0001';
  end if;

  insert into plm.dcp_metadata_run (
    source_crawl_id, status, captured_on, started_at, endpoint_suffix, crawler_version,
    captured_by, private_source_commit, assets_expected, metadata
  ) values (
    p_source_crawl_id, 'running', p_captured_on, now(), p_endpoint_suffix,
    p_crawler_version, p_captured_by, p_private_source_commit, v_expected,
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning metadata_run_id into v_run;

  -- SEED ONE PENDING ROW PER EXPECTED ASSET. See section 0 for why this happens here and
  -- not on arrival.
  insert into plm.dcp_metadata_asset (metadata_run_id, source_crawl_id, dcp_asset_id, fetch_status)
  select v_run, p_source_crawl_id, ac.dcp_asset_id, 'pending'
  from plm.dcp_asset_crawl ac
  where ac.crawl_id = p_source_crawl_id;

  -- Belt and braces on the seed itself: if the seeded count and the recorded expectation
  -- ever disagreed, every later reconciliation would be measured against a wrong number.
  if (select count(*) from plm.dcp_metadata_asset m where m.metadata_run_id = v_run) <> v_expected then
    raise exception 'DCP Vault metadata run refused: seeded row count does not equal '
      'assets_expected (%). Aborting rather than starting a run whose target is already '
      'wrong.', v_expected using errcode = 'P0001';
  end if;

  return v_run;
end;
$$;

comment on function plm.begin_dcp_metadata_run(uuid, date, text, text, text, text, jsonb) is
'Opens a DCP Vault metadata run over ONE COMPLETED path crawl and seeds one `pending` '
'plm.dcp_metadata_asset row per asset that crawl observed. assets_expected is counted from '
'plm.dcp_asset_crawl and is NEVER accepted from the caller -- a caller-supplied target is '
'one the caller can make match whatever it managed to load. Refuses an incomplete source '
'crawl, a second concurrent run, and a crawl with zero memberships. Seeding is what makes '
'"every expected asset has exactly one fetch row" true from the first second rather than '
'something finalization has to go looking for.';

-- =====================================================================================
-- SECTION 4. plm.load_dcp_metadata_chunk -- the bounded streaming entry point
--
-- WHY p_rows_json IS text AND NOT jsonb -- DO NOT "TIDY" THIS INTO jsonb.
-- The integrity check is that the caller's declared digest matches one the SERVER
-- recomputes from the bytes it actually received. jsonb does not preserve bytes: it
-- reorders keys, drops insignificant whitespace and normalises escapes and number forms.
-- sha256(p_rows::jsonb::text) would digest something the caller never produced and could
-- not reproduce, so it would fail on every honest chunk and would then have to be removed.
--
-- EXPECTED SHAPE of each element of the JSON array:
--   source_path            full DAM path, identifies the seeded row      required
--   row_number             1-based input row number                      required
--   fetch_status           success|not_found|signed_out|rejected|failed  required
--   http_status, response_bytes, retrieved_at                            optional
--   failure_code, failure_reason                                         required on failure
--   raw_metadata_text      the EXACT response text                       required on success
--   scalars                the 18 raw source fields, all text            optional
--   interpreted            the 7 parsed companions + rights_confident    optional
--   properties, characters, art_styles, keywords                         optional arrays
--                          ABSENT means "not observed" (NULL);
--                          [] means "observed and empty". They hash differently.
--
-- ***** PROPERTIES AND CHARACTERS ARE READ, VALIDATED, UPSERTED AND LINKED IN FOUR
-- ***** SEPARATE SINGLE-SET LOOPS. There is no statement in this function in which a
-- ***** property value and a character value are both in scope. See RULE 1 in
-- ***** 20260811050000. This is not stylistic: an accidental join here is the one defect
-- ***** that would be invisible in the data and permanent.
--
-- NO ROW IS EVER SILENTLY SKIPPED. Every element either lands or produces a
-- plm.dcp_metadata_load_exception row, and the ledger's landed + rejected = received
-- CHECK makes a third outcome arithmetically impossible.
-- =====================================================================================
create or replace function plm.load_dcp_metadata_chunk(
  p_metadata_run_id uuid,
  p_chunk_number    integer,
  p_rows_json       text,
  p_chunk_sha256    text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, plm, core, app, extensions
as $$
declare
  v_role      text := auth.role();
  v_status    text;
  v_crawl     uuid;
  v_rows      jsonb;
  v_n         integer;
  v_computed  text;
  v_existing  text;
  v_landed    integer := 0;
  v_rejected  integer := 0;
  r           jsonb;
  v_rowno     integer;
  v_path      text;
  v_asset     uuid;
  v_fetch     text;
  v_raw_text  text;
  v_raw       jsonb;
  v_reject    text;
  v_code      text;
  v_kind      text;
  v_id        uuid;
  v_elem      text;
  v_arr       text[];
  j           integer;
  -- Read-back holders. EVERYTHING the normalized hash digests is read BACK from the
  -- database after the update and the link writes. Nothing derived from the input row
  -- reaches plm.dcp_metadata_row_hash. See the note at the end of this function.
  v_s         plm.dcp_metadata_asset%rowtype;
  v_props     text[];
  v_chars     text[];
  v_styles    text[];
  v_keys      text[];
  v_hash      text;
begin
  if not plm.dcp_loader_privilege_ok(v_role, session_user) then
    raise exception 'DCP Vault metadata load refused: effective JWT role %L / session_user '
      '%L may not load chunks.',
      coalesce(v_role, '<null>'), coalesce(session_user, '<null>') using errcode = 'P0001';
  end if;

  select r2.status, r2.source_crawl_id into v_status, v_crawl
  from plm.dcp_metadata_run r2 where r2.metadata_run_id = p_metadata_run_id;

  if v_status is null then
    raise exception 'DCP Vault metadata load refused: run % does not exist.',
      p_metadata_run_id using errcode = 'P0001';
  end if;
  if v_status <> 'running' then
    raise exception 'DCP Vault metadata load refused: run % is %L, not running. A run that '
      'has left the running state may not receive more chunks.', p_metadata_run_id, v_status
      using errcode = 'P0001';
  end if;

  if p_chunk_number is null or p_chunk_number < 1 then
    raise exception 'DCP Vault metadata load refused: chunk_number must be >= 1. Got %.',
      coalesce(p_chunk_number, -1) using errcode = 'P0001';
  end if;
  if p_chunk_sha256 is null or p_chunk_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'DCP Vault metadata load refused: chunk_sha256 must be 64 lowercase '
      'hex characters.' using errcode = 'P0001';
  end if;
  if p_rows_json is null then
    raise exception 'DCP Vault metadata load refused: chunk % carried no payload.',
      p_chunk_number using errcode = 'P0001';
  end if;

  -- INTEGRITY FIRST, ON THE RECEIVED BYTES, before parsing and before storing anything.
  v_computed := encode(sha256(convert_to(p_rows_json, 'UTF8')), 'hex');
  if v_computed <> p_chunk_sha256 then
    raise exception 'DCP Vault metadata load refused: chunk % failed its integrity check. '
      'The digest recomputed from the bytes received does not match the digest declared '
      'for this chunk -- it was altered, truncated or mispaired in transit. No digest and '
      'no row content is echoed here because this database''s logs are not private.',
      p_chunk_number using errcode = 'P0001';
  end if;

  -- Serialise concurrent loads for THIS run. Two chunks updating the same seeded rows
  -- would interleave their read-backs and hash each other's half-written state.
  perform pg_advisory_xact_lock(hashtext('plm.dcp_metadata_load'), hashtext(p_metadata_run_id::text));

  -- IDEMPOTENT RETRY, BUT NOT SILENT REPLACEMENT.
  select l.chunk_sha256 into v_existing
  from plm.dcp_metadata_chunk_ledger l
  where l.metadata_run_id = p_metadata_run_id and l.chunk_number = p_chunk_number;

  if v_existing is not null then
    if v_existing = p_chunk_sha256 then
      return jsonb_build_object('chunk_number', p_chunk_number, 'replayed', true);
    end if;
    raise exception 'DCP Vault metadata load refused: chunk % has already been applied for '
      'this run with DIFFERENT content. A chunk number is not a slot to be overwritten.',
      p_chunk_number using errcode = 'P0001';
  end if;

  begin
    v_rows := p_rows_json::jsonb;
  exception when others then
    raise exception 'DCP Vault metadata load refused: chunk % is not parseable JSON.',
      p_chunk_number using errcode = 'P0001';
  end;

  if jsonb_typeof(v_rows) <> 'array' then
    raise exception 'DCP Vault metadata load refused: chunk % must be a JSON array of row '
      'objects, got %.', p_chunk_number, coalesce(jsonb_typeof(v_rows), 'null')
      using errcode = 'P0001';
  end if;

  v_n := jsonb_array_length(v_rows);
  if v_n = 0 then
    raise exception 'DCP Vault metadata load refused: chunk % is empty. An empty chunk '
      'contributes nothing and would make the chunk numbering lie about how much was sent.',
      p_chunk_number using errcode = 'P0001';
  end if;

  -- THE TWO WORKING BOUNDS. Metadata rows are far larger than Phase-1 path rows -- each
  -- carries a full response object -- so the row cap is an order of magnitude lower than
  -- the path loader's 20000 while the byte cap stays comparable.
  if v_n > 2000 then
    raise exception 'DCP Vault metadata load refused: chunk % carries % rows, over the '
      '2000-row bound. Metadata rows carry a full response object each; split the chunk.',
      p_chunk_number, v_n using errcode = 'P0001';
  end if;
  if octet_length(p_rows_json) > 16 * 1024 * 1024 then
    raise exception 'DCP Vault metadata load refused: chunk % is % bytes, over the 16 MiB '
      'bound. Split the chunk.', p_chunk_number, octet_length(p_rows_json)
      using errcode = 'P0001';
  end if;

  -- ===================================================================================
  -- PER-ROW APPLICATION
  -- ===================================================================================
  for r in select jsonb_array_elements(v_rows) loop
    v_reject := null;
    v_code   := null;
    v_asset  := null;

    v_rowno := nullif(r->>'row_number', '')::integer;
    v_path  := r->>'source_path';
    v_fetch := r->>'fetch_status';

    -- ---- validation, cheapest and most fatal first ---------------------------------
    if v_path is null or btrim(v_path) = '' then
      v_code := 'missing_source_path';
      v_reject := 'The row carried no source_path. The PATH is the asset identity in this '
                  'source -- file name is not unique and a name is never an id.';
    elsif v_fetch is null
       or v_fetch not in ('success','not_found','signed_out','rejected','failed') then
      v_code := 'bad_fetch_status';
      v_reject := 'fetch_status was absent or not one of the six permitted values.';
    else
      -- Resolve the SEEDED row. A path outside this run's source crawl matches nothing,
      -- which is the membership check doing its job -- see section 0.
      select m.dcp_asset_id into v_asset
      from plm.dcp_metadata_asset m
      join plm.dcp_asset a on a.id = m.dcp_asset_id
      where m.metadata_run_id = p_metadata_run_id
        and a.source_path = v_path
        and a.source_system = 'disney_dcpvault';

      if v_asset is null then
        v_code := 'asset_not_in_source_crawl';
        v_reject := 'No seeded row matches this path in this run. Either the path was not '
                    'observed by the source path crawl, or it belongs to a different '
                    'crawl. Metadata may only cover assets its own crawl observed.';
      end if;
    end if;

    -- A TERMINAL FAILURE MUST CARRY A CODE, AND IT IS CHECKED **HERE**, NOT LEFT TO THE
    -- TABLE CONSTRAINT. dcp_metadata_asset_failure_coherence_chk would also catch this,
    -- but as a constraint violation -- which is NOT sqlstate P0001, aborts the whole
    -- statement, and therefore kills the ENTIRE CHUNK instead of rejecting one row. That
    -- would break the guarantee this loader is built on: every row either lands or
    -- produces an exception. Validating first turns a fatal chunk failure into one
    -- rejected row.
    if v_reject is null
       and v_fetch in ('not_found','signed_out','rejected','failed')
       and (r->>'failure_code' is null or btrim(r->>'failure_code') = '') then
      v_code := 'failure_without_code';
      v_reject := 'A terminal failure status was given with no failure_code. An '
                  'untriageable failure row is indistinguishable from a bug in the loader.';
    end if;

    -- HTTP 200 IS NOT SUCCESS. A signed-out DCP Vault session returns 200 with a tiny
    -- zero-record body, so a caller claiming success must also produce a response text
    -- that parses to a JSON OBJECT. This is the guard that stops a whole run of sign-out
    -- pages being recorded as a successful capture.
    if v_reject is null and v_fetch = 'success' then
      v_raw_text := r->>'raw_metadata_text';
      if v_raw_text is null or btrim(v_raw_text) = '' then
        v_code := 'success_without_body';
        v_reject := 'fetch_status was success but no raw_metadata_text was supplied. HTTP '
                    'success alone is not a successful metadata fetch.';
      else
        begin
          v_raw := v_raw_text::jsonb;
        exception when others then
          v_raw := null;
        end;
        if v_raw is null or jsonb_typeof(v_raw) <> 'object' then
          v_code := 'success_body_not_object';
          v_reject := 'fetch_status was success but the response text is not a JSON '
                      'object. A signed-out portal page and a zero-record body both land '
                      'here, which is exactly what this check is for.';
        end if;
      end if;
    end if;

    if v_reject is not null then
      insert into plm.dcp_metadata_load_exception (
        metadata_run_id, chunk_number, row_number, severity, reason_code, reason, dcp_asset_id
      ) values (
        p_metadata_run_id, p_chunk_number, v_rowno, 'rejected', v_code, v_reject, v_asset
      );
      v_rejected := v_rejected + 1;
      continue;
    end if;

    -- ---- apply the scalars to the seeded row ---------------------------------------
    -- An UPDATE, never an INSERT: the row was seeded at begin time. `where fetch_status =
    -- 'pending'` makes a duplicate asset within one run land as a rejection rather than
    -- overwriting an already-applied response.
    update plm.dcp_metadata_asset m set
      fetch_status   = v_fetch,
      -- UNQUALIFIED deliberately. Inside an UPDATE's SET list the target alias is not in
      -- scope on the right-hand side, so `m.attempt_count + 1` raises "missing FROM-clause
      -- entry for table m" -- caught by the loader contract test on CI.
      attempt_count  = attempt_count + 1,
      http_status    = nullif(r->>'http_status','')::integer,
      response_bytes = nullif(r->>'response_bytes','')::bigint,
      retrieved_at   = coalesce(nullif(r->>'retrieved_at','')::timestamptz, now()),
      failure_code   = case when v_fetch = 'success' then null else r->>'failure_code' end,
      failure_reason = case when v_fetch = 'success' then null else r->>'failure_reason' end,

      source_uuid           = r->>'source_uuid',
      collection_dmc_id     = r->>'collection_dmc_id',
      collection_main_title = r->>'collection_main_title',
      collection_type       = r->>'collection_type',
      dc_title              = r->>'dc_title',
      design_element        = r->>'design_element',
      content_type          = r->>'content_type',
      content_owner         = r->>'content_owner',
      source_status         = r->>'source_status',
      is_exclusive_raw      = r->>'is_exclusive_raw',
      is_embargoed_raw      = r->>'is_embargoed_raw',
      is_locked_raw         = r->>'is_locked_raw',
      release_date_raw      = r->>'release_date_raw',
      modified_at_raw       = r->>'modified_at_raw',
      file_size_raw         = r->>'file_size_raw',
      format_raw            = r->>'format_raw',
      num_pages_raw         = r->>'num_pages_raw',
      dam_sha1              = r->>'dam_sha1',

      is_exclusive_interpreted = nullif(r->>'is_exclusive_interpreted','')::boolean,
      is_embargoed_interpreted = nullif(r->>'is_embargoed_interpreted','')::boolean,
      is_locked_interpreted    = nullif(r->>'is_locked_interpreted','')::boolean,
      -- DEFAULTS TO FALSE, ALWAYS. An absent flag means "the loader did not claim
      -- confidence", which is the safe reading. The business meanings of these fields are
      -- unknown and an unknown value must never coerce to a guess.
      rights_parse_confident   = coalesce(nullif(r->>'rights_parse_confident','')::boolean, false),
      release_date_interpreted = nullif(r->>'release_date_interpreted','')::timestamptz,
      modified_at_interpreted  = nullif(r->>'modified_at_interpreted','')::timestamptz,
      file_size_bytes_interpreted = nullif(r->>'file_size_bytes_interpreted','')::bigint,
      num_pages_interpreted    = nullif(r->>'num_pages_interpreted','')::integer,

      raw_metadata = case when v_fetch = 'success' then v_raw else null end,
      -- source_hash digests the EXACT received response TEXT, not the parsed jsonb, for
      -- the same reason the chunk digest does.
      source_hash  = case when v_fetch = 'success'
                          then encode(sha256(convert_to(v_raw_text, 'UTF8')), 'hex')
                          else null end,
      updated_at   = now()
    where m.metadata_run_id = p_metadata_run_id
      and m.dcp_asset_id = v_asset
      and m.fetch_status = 'pending';

    if not found then
      insert into plm.dcp_metadata_load_exception (
        metadata_run_id, chunk_number, row_number, severity, reason_code, reason, dcp_asset_id
      ) values (
        p_metadata_run_id, p_chunk_number, v_rowno, 'rejected', 'duplicate_asset_in_run',
        'This asset already has a non-pending response in this run. A metadata run records '
        'ONE response per asset; a second would silently overwrite the first.', v_asset
      );
      v_rejected := v_rejected + 1;
      continue;
    end if;

    -- ---- links, four INDEPENDENT single-set passes ---------------------------------
    -- READ RULE 1. Each pass handles exactly ONE array. j is the only thing they share
    -- and it carries no value from the source. At no point are a property value and a
    -- character value both in scope.
    if v_fetch = 'success' then
      for j in 1 .. 4 loop
        v_kind := case j when 1 then 'property' when 2 then 'character'
                         when 3 then 'art_style' else 'keyword' end;

        -- ABSENT means "not observed" and stays NULL; [] means "observed and empty" and
        -- becomes an empty array. They hash differently and that difference is the whole
        -- reason this is written out rather than coalesced to '{}'.
        v_arr := case
                   when r -> (case j when 1 then 'properties' when 2 then 'characters'
                                     when 3 then 'art_styles' else 'keywords' end) is null
                     then null
                   else array(
                     select jsonb_array_elements_text(
                       r -> (case j when 1 then 'properties' when 2 then 'characters'
                                    when 3 then 'art_styles' else 'keywords' end))
                   )
                 end;

        if v_arr is not null then
          foreach v_elem in array v_arr loop
            if v_elem is null or btrim(v_elem) = '' then
              continue;  -- a blank member carries no identity; it is not a link
            end if;

            if j = 1 then
              insert into plm.dcp_property (source_system, source_id, first_seen_metadata_run_id,
                                            last_seen_metadata_run_id)
              values ('disney_dcpvault', v_elem, p_metadata_run_id, p_metadata_run_id)
              on conflict (source_system, source_id)
                do update set last_seen_metadata_run_id = p_metadata_run_id,
                              updated_at = now()
              returning id into v_id;

              insert into plm.dcp_asset_property_observation
                (metadata_run_id, dcp_asset_id, dcp_property_id)
              values (p_metadata_run_id, v_asset, v_id)
              on conflict do nothing;      -- a repeated array member is one link

            elsif j = 2 then
              insert into plm.dcp_character (source_system, source_id, first_seen_metadata_run_id,
                                             last_seen_metadata_run_id)
              values ('disney_dcpvault', v_elem, p_metadata_run_id, p_metadata_run_id)
              on conflict (source_system, source_id)
                do update set last_seen_metadata_run_id = p_metadata_run_id,
                              updated_at = now()
              returning id into v_id;

              insert into plm.dcp_asset_character_observation
                (metadata_run_id, dcp_asset_id, dcp_character_id)
              values (p_metadata_run_id, v_asset, v_id)
              on conflict do nothing;

            else
              insert into plm.dcp_term (source_system, term_kind, source_value,
                                        first_seen_metadata_run_id, last_seen_metadata_run_id)
              values ('disney_dcpvault', v_kind, v_elem, p_metadata_run_id, p_metadata_run_id)
              on conflict (source_system, term_kind, source_value)
                do update set last_seen_metadata_run_id = p_metadata_run_id,
                              updated_at = now()
              returning id into v_id;

              insert into plm.dcp_asset_term_observation
                (metadata_run_id, dcp_asset_id, dcp_term_id)
              values (p_metadata_run_id, v_asset, v_id)
              on conflict do nothing;
            end if;
          end loop;
        end if;
      end loop;

      -- ---- THE HASH, FROM STORED VALUES ONLY -------------------------------------
      -- This is the defect adversarial review found in the Phase-1 build, and the reason
      -- it is worth this much ceremony: if the digest were taken from the INPUT row, then
      -- the day the portal renames a field and the upsert declines to overwrite a stored
      -- value, the digest would record the NEW value while the database holds the OLD
      -- one -- and every future run would compare equal and report "no change" while the
      -- stored value stayed permanently stale. The row is read BACK, the link sets are
      -- read BACK from the tables just written, and only those reach the hash.
      select * into v_s from plm.dcp_metadata_asset m
      where m.metadata_run_id = p_metadata_run_id and m.dcp_asset_id = v_asset;

      -- Four separate read-backs. Again: never a join across property and character.
      if r -> 'properties' is null then v_props := null; else
        select coalesce(array_agg(p.source_id), array[]::text[]) into v_props
        from plm.dcp_asset_property_observation o
        join plm.dcp_property p on p.id = o.dcp_property_id
        where o.metadata_run_id = p_metadata_run_id and o.dcp_asset_id = v_asset;
      end if;

      if r -> 'characters' is null then v_chars := null; else
        select coalesce(array_agg(c.source_id), array[]::text[]) into v_chars
        from plm.dcp_asset_character_observation o
        join plm.dcp_character c on c.id = o.dcp_character_id
        where o.metadata_run_id = p_metadata_run_id and o.dcp_asset_id = v_asset;
      end if;

      if r -> 'art_styles' is null then v_styles := null; else
        select coalesce(array_agg(t.source_value), array[]::text[]) into v_styles
        from plm.dcp_asset_term_observation o
        join plm.dcp_term t on t.id = o.dcp_term_id
        where o.metadata_run_id = p_metadata_run_id and o.dcp_asset_id = v_asset
          and t.term_kind = 'art_style';
      end if;

      if r -> 'keywords' is null then v_keys := null; else
        select coalesce(array_agg(t.source_value), array[]::text[]) into v_keys
        from plm.dcp_asset_term_observation o
        join plm.dcp_term t on t.id = o.dcp_term_id
        where o.metadata_run_id = p_metadata_run_id and o.dcp_asset_id = v_asset
          and t.term_kind = 'keyword';
      end if;

      v_hash := plm.dcp_metadata_row_hash(
        v_s.source_uuid, v_s.collection_dmc_id, v_s.collection_main_title,
        v_s.collection_type, v_s.dc_title, v_s.design_element, v_s.content_type,
        v_s.content_owner, v_s.source_status, v_s.is_exclusive_raw, v_s.is_embargoed_raw,
        v_s.is_locked_raw, v_s.release_date_raw, v_s.modified_at_raw, v_s.file_size_raw,
        v_s.format_raw, v_s.num_pages_raw, v_s.dam_sha1,
        v_props, v_chars, v_styles, v_keys
      );

      update plm.dcp_metadata_asset m set normalized_hash = v_hash
      where m.metadata_run_id = p_metadata_run_id and m.dcp_asset_id = v_asset;
    end if;

    v_landed := v_landed + 1;
  end loop;

  insert into plm.dcp_metadata_chunk_ledger (
    metadata_run_id, chunk_number, chunk_sha256, rows_received, rows_landed, rows_rejected
  ) values (
    p_metadata_run_id, p_chunk_number, p_chunk_sha256, v_n, v_landed, v_rejected
  );

  return jsonb_build_object(
    'chunk_number', p_chunk_number,
    'replayed', false,
    'rows_received', v_n,
    'rows_landed', v_landed,
    'rows_rejected', v_rejected
  );
end;
$$;

comment on function plm.load_dcp_metadata_chunk(uuid, integer, text, text) is
'Bounded, resumable, idempotent chunk loader for a DCP Vault metadata run. Takes the chunk '
'as TEXT so the integrity digest is over the bytes actually received -- a cast to jsonb '
'first would digest something the caller never produced. Re-sending an identical chunk is '
'a no-op; the same chunk number with different bytes is refused. Rows UPDATE the pending '
'rows seeded at begin time and never insert, so an asset outside the source crawl matches '
'nothing and is rejected. HTTP 200 is not success: a success claim must carry a response '
'text that parses to a JSON OBJECT, which is what catches a run of sign-out pages. '
'Properties, characters, art styles and keywords are handled in FOUR INDEPENDENT '
'single-set passes -- no statement in this function has a property and a character in '
'scope at once. The normalized hash is computed from values READ BACK from the database '
'after the update and the link writes, never from the input row: hashing the input is how '
'a stale stored value hides behind an unchanged-looking digest forever. Every row either '
'lands or produces a plm.dcp_metadata_load_exception; the ledger arithmetic makes a third '
'outcome impossible.';

-- =====================================================================================
-- SECTION 5. plm.finalize_dcp_metadata_run -- the ONLY path to status complete
-- =====================================================================================
create or replace function plm.finalize_dcp_metadata_run(p_metadata_run_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, plm, core, app, extensions
as $$
declare
  v_role      text := auth.role();
  v_status    text;
  v_expected  integer;
  v_pending   integer;
  v_success   integer;
  v_failed    integer;
  v_total     integer;
  v_open      integer;
  v_maxchunk  integer;
  v_chunks    integer;
  v_badhash   integer;
begin
  if not plm.dcp_loader_privilege_ok(v_role, session_user) then
    raise exception 'DCP Vault metadata finalize refused: effective JWT role %L / '
      'session_user %L may not finalize.',
      coalesce(v_role, '<null>'), coalesce(session_user, '<null>') using errcode = 'P0001';
  end if;

  select r.status, r.assets_expected into v_status, v_expected
  from plm.dcp_metadata_run r where r.metadata_run_id = p_metadata_run_id;

  if v_status is null then
    raise exception 'DCP Vault metadata finalize refused: run % does not exist.',
      p_metadata_run_id using errcode = 'P0001';
  end if;
  if v_status <> 'running' then
    raise exception 'DCP Vault metadata finalize refused: run % is %L, not running.',
      p_metadata_run_id, v_status using errcode = 'P0001';
  end if;

  select
    count(*) filter (where m.fetch_status = 'pending'),
    count(*) filter (where m.fetch_status = 'success'),
    count(*) filter (where m.fetch_status in ('not_found','signed_out','rejected','failed')),
    count(*)
  into v_pending, v_success, v_failed, v_total
  from plm.dcp_metadata_asset m where m.metadata_run_id = p_metadata_run_id;

  -- GATE 1. Every expected asset must have reached a terminal state. A pending row is an
  -- asset nobody ever fetched, and it is the single most likely way a short run would
  -- otherwise present itself as complete.
  if v_pending > 0 then
    raise exception 'DCP Vault metadata finalize refused: run % still has % asset(s) in '
      'pending. Every expected asset needs one success or one recorded terminal failure; '
      'neither is a silent gap.', p_metadata_run_id, v_pending using errcode = 'P0001';
  end if;

  -- GATE 2. The row population must still be exactly what was expected.
  if v_total <> v_expected then
    raise exception 'DCP Vault metadata finalize refused: run % holds % fetch rows but '
      'expected %. The seeded population changed under the run.',
      p_metadata_run_id, v_total, v_expected using errcode = 'P0001';
  end if;
  if v_success + v_failed <> v_expected then
    raise exception 'DCP Vault metadata finalize refused: run % reconciles to % success + '
      '% terminal failure, which is not the expected %.',
      p_metadata_run_id, v_success, v_failed, v_expected using errcode = 'P0001';
  end if;

  -- GATE 3. No unresolved REJECTED exception. Warnings do not block; rejections do.
  select count(*) into v_open
  from plm.dcp_metadata_load_exception e
  where e.metadata_run_id = p_metadata_run_id
    and e.severity = 'rejected' and e.resolved_at is null;
  if v_open > 0 then
    raise exception 'DCP Vault metadata finalize refused: run % has % unresolved REJECTED '
      'load exception(s). Completing over open rejections is how a partial capture becomes '
      'a permanent record of a complete one.', p_metadata_run_id, v_open
      using errcode = 'P0001';
  end if;

  -- GATE 4. The chunk stream must be CONTIGUOUS from 1. A gap means a chunk was never
  -- applied, and the rows it carried are missing from a run that would otherwise balance
  -- only because those assets are sitting in a terminal failure state for another reason.
  select count(*), coalesce(max(l.chunk_number), 0) into v_chunks, v_maxchunk
  from plm.dcp_metadata_chunk_ledger l where l.metadata_run_id = p_metadata_run_id;
  if v_chunks <> v_maxchunk then
    raise exception 'DCP Vault metadata finalize refused: run % applied % chunks but the '
      'highest chunk number is %. The chunk stream is not contiguous from 1, so at least '
      'one chunk was never applied.', p_metadata_run_id, v_chunks, v_maxchunk
      using errcode = 'P0001';
  end if;

  -- GATE 5. Every successful row must carry both digests and a valid response object.
  -- The table CHECK already enforces this per row; asserting it again here catches a
  -- constraint that was ever dropped, and costs one index scan.
  select count(*) into v_badhash
  from plm.dcp_metadata_asset m
  where m.metadata_run_id = p_metadata_run_id
    and m.fetch_status = 'success'
    and (m.source_hash is null or m.normalized_hash is null
         or m.raw_metadata is null or jsonb_typeof(m.raw_metadata) <> 'object');
  if v_badhash > 0 then
    raise exception 'DCP Vault metadata finalize refused: run % has % successful row(s) '
      'without a valid response object or without both digests.',
      p_metadata_run_id, v_badhash using errcode = 'P0001';
  end if;

  update plm.dcp_metadata_run r set
    status = 'complete',
    fetches_succeeded = v_success,
    fetches_failed = v_failed,
    finished_at = now(),
    updated_at = now()
  where r.metadata_run_id = p_metadata_run_id;

  return jsonb_build_object(
    'metadata_run_id', p_metadata_run_id,
    'status', 'complete',
    'assets_expected', v_expected,
    'fetches_succeeded', v_success,
    'fetches_failed', v_failed,
    'chunks_applied', v_chunks
  );
end;
$$;

comment on function plm.finalize_dcp_metadata_run(uuid) is
'The ONLY path to status complete for a DCP Vault metadata run, behind five gates: no row '
'left pending, the row population still equals assets_expected, success + terminal failure '
'equals assets_expected, zero unresolved REJECTED load exceptions, a CONTIGUOUS chunk '
'stream from 1, and every successful row carrying a valid response object and both '
'digests. Each gate closes a specific way a SHORT run could otherwise present itself as a '
'complete one. Completing the run freezes all of its evidence against INSERT, UPDATE and '
'DELETE.';

-- =====================================================================================
-- SECTION 6. plm.fail_dcp_metadata_run
-- =====================================================================================
create or replace function plm.fail_dcp_metadata_run(
  p_metadata_run_id uuid,
  p_failure_message text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, plm, core, app, extensions
as $$
declare
  v_role   text := auth.role();
  v_status text;
begin
  if not plm.dcp_loader_privilege_ok(v_role, session_user) then
    raise exception 'DCP Vault metadata fail refused: effective JWT role %L / session_user '
      '%L may not fail a run.',
      coalesce(v_role, '<null>'), coalesce(session_user, '<null>') using errcode = 'P0001';
  end if;

  if p_failure_message is null or btrim(p_failure_message) = '' then
    raise exception 'DCP Vault metadata fail refused: a failure message is required. A run '
      'marked failed with no reason is an unanswerable question later.'
      using errcode = 'P0001';
  end if;

  select r.status into v_status
  from plm.dcp_metadata_run r where r.metadata_run_id = p_metadata_run_id;

  if v_status is null then
    raise exception 'DCP Vault metadata fail refused: run % does not exist.',
      p_metadata_run_id using errcode = 'P0001';
  end if;
  -- A COMPLETE run may NOT be re-marked failed. Its evidence is frozen and reinterpreting
  -- a finished capture after the fact is how a record of what the portal said gets lost.
  if v_status = 'complete' then
    raise exception 'DCP Vault metadata fail refused: run % is COMPLETE. A completed run is '
      'immutable; record the problem against a NEW run.', p_metadata_run_id
      using errcode = 'P0001';
  end if;
  if v_status = 'failed' then
    return jsonb_build_object('metadata_run_id', p_metadata_run_id, 'status', 'failed',
                              'already', true);
  end if;

  update plm.dcp_metadata_run r set
    status = 'failed',
    failure_message = p_failure_message,
    finished_at = now(),
    updated_at = now()
  where r.metadata_run_id = p_metadata_run_id;

  return jsonb_build_object('metadata_run_id', p_metadata_run_id, 'status', 'failed');
end;
$$;

comment on function plm.fail_dcp_metadata_run(uuid, text) is
'Marks a DCP Vault metadata run failed, preserving everything it loaded. Requires a '
'message -- a run marked failed with no reason is an unanswerable question later. Refuses '
'to touch a COMPLETE run: reinterpreting a finished capture after the fact is how the '
'record of what the portal actually returned gets lost. Idempotent on an already-failed '
'run. NEVER destroys licensed evidence: the failed run stays as the record of what '
'happened and a correction is a NEW run.';

-- =====================================================================================
-- SECTION 7. FUNCTION GRANTS. service_role gets EXECUTE and nothing else; the functions
-- are SECURITY DEFINER and never consume service_role's table grants.
-- =====================================================================================
revoke all on function plm.begin_dcp_metadata_run(uuid, date, text, text, text, text, jsonb) from public;
revoke all on function plm.load_dcp_metadata_chunk(uuid, integer, text, text) from public;
revoke all on function plm.finalize_dcp_metadata_run(uuid) from public;
revoke all on function plm.fail_dcp_metadata_run(uuid, text) from public;
revoke all on function plm.dcp_metadata_load_exception_freeze() from public;

grant execute on function plm.begin_dcp_metadata_run(uuid, date, text, text, text, text, jsonb) to service_role;
grant execute on function plm.load_dcp_metadata_chunk(uuid, integer, text, text) to service_role;
grant execute on function plm.finalize_dcp_metadata_run(uuid) to service_role;
grant execute on function plm.fail_dcp_metadata_run(uuid, text) to service_role;

-- =====================================================================================
-- SECTION 8. SELF-CHECKS
-- =====================================================================================
do $$
declare
  v_missing text;
  v_count   integer;
begin
  -- 8.1 All four loader functions must exist and be SECURITY DEFINER with pg_catalog
  -- FIRST in the pinned search_path. A definer function that resolves builtins through a
  -- caller-influenced schema is the classic definer escalation, and it applies clean.
  select string_agg(p.proname, ', ') into v_missing
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'plm'
    and p.proname in ('begin_dcp_metadata_run','load_dcp_metadata_chunk',
                      'finalize_dcp_metadata_run','fail_dcp_metadata_run')
    and (not p.prosecdef
         or p.proconfig is null
         or not exists (
           select 1 from unnest(p.proconfig) cfg
           where cfg like 'search_path=pg_catalog%'
         ));
  if v_missing is not null then
    raise exception 'DCP metadata loader self-check FAILED: function(s) % are not SECURITY '
      'DEFINER with pg_catalog first in a pinned search_path.', v_missing;
  end if;

  select count(*) into v_count
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'plm'
    and p.proname in ('begin_dcp_metadata_run','load_dcp_metadata_chunk',
                      'finalize_dcp_metadata_run','fail_dcp_metadata_run');
  if v_count <> 4 then
    raise exception 'DCP metadata loader self-check FAILED: expected 4 loader functions, '
      'found %.', v_count;
  end if;

  -- 8.2 service_role must hold no mutating bit beyond INSERT on the two new tables.
  select string_agg(distinct t || '/' || priv, ', ') into v_missing
  from unnest(array['dcp_metadata_chunk_ledger','dcp_metadata_load_exception']) as t,
       unnest(array['UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) as priv
  where has_table_privilege('service_role', 'plm.' || quote_ident(t), priv);
  if v_missing is not null then
    raise exception 'DCP metadata loader self-check FAILED: service_role still holds '
      'mutating privileges: %. TRUNCATE fires no row triggers, so the freeze depends on '
      'these revokes.', v_missing;
  end if;

  -- 8.3 THE RULE 1 ASSERTION, REPEATED HERE. This migration is where the loader lives, so
  -- this is where a future "convenience" bridge would most plausibly be added.
  select count(*) into v_count
  from (
    select c.table_name
    from information_schema.columns c
    where c.table_schema = 'plm'
      and c.column_name in ('dcp_property_id','dcp_character_id')
    group by c.table_name
    having count(distinct c.column_name) > 1
  ) both_sides;
  if v_count > 0 then
    raise exception 'DCP metadata loader self-check FAILED: % plm table(s) reference BOTH a '
      'property and a character. The two sets are INDEPENDENT and must never be joined.',
      v_count;
  end if;

  raise notice 'DCP metadata loader self-checks passed: 4 definer functions with '
    'pg_catalog-first search paths, 2 tables with no mutating service_role bit beyond '
    'INSERT, no property-character bridge.';
end;
$$;
