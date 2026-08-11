-- =====================================================================================
-- Disney DCP Vault -- PHASE 2 metadata landing schema.
--
-- Migration: 20260811050000_dcp_vault_metadata_landing.sql
-- Issue:     u2giants/shared-db #748 (workstream). Object claim: #749 -- this migration
--            owns eight NEW plm.dcp_* tables and touches NOTHING that already exists.
-- Version:   ALLOCATED BY THE ORCHESTRATOR, not chosen from now(). Two agents dispatched
--            in the same minute pick the same 14-digit number from a clock, and a
--            duplicate version SILENTLY SKIPS a migration. That has happened twice in
--            this repo. 20260811030000 (Paramount) and 20260811040000 (PopDAM OrderList)
--            were allocated elsewhere in the same session; this file is 20260811050000
--            and its loader is 20260811060000.
-- Design:    licensor-source-data-disney/disney-dcpvault/
--            IMPLEMENTATION-PLAN-dcp-vault-full-schema-redesign.md section 8 (PRIVATE).
-- Pattern:   20260810190000 (the Phase-1 DCP landing) is the direct parent. Its section 0
--            privilege predicate, section 6 immutability model, section 7 PostgreSQL 17
--            revoke set and section 8 RLS role gate are REUSED here, not re-invented.
-- Follows:   20260811060000 completes this build with the metadata chunked loader.
--
-- SCHEMA ONLY. THIS MIGRATION LOADS NO DATA.
--
-- -------------------------------------------------------------------------------------
-- CONFIDENTIALITY. u2giants/shared-db is a PUBLIC repository. The DCP Vault extract is
-- licensor-confidential Disney data held in the PRIVATE repository
-- u2giants/licensor-source-data-disney. Not one Disney property name, character name,
-- style-guide folder, DAM path, file name, tile slug or portal URL appears in this file,
-- in any comment, in any CHECK constraint, in any error message, or in any contract test.
-- Only COUNTS and SCHEMA appear.
--     SCHEMA IN GIT. DATA OUT OF GIT.
-- Every error message below reports counts, codes and identifiers -- never source values,
-- because this database's logs are not private either.
--
-- =====================================================================================
-- SECTION -1. WHAT PHASE 2 IS, AND THE FOUR RULES THAT CORRUPT THE DATA IF BROKEN
-- =====================================================================================
--
-- Phase 1 (migration 20260810190000) is the PATH CRAWL: one row per result occurrence,
-- proving the DAM path, the file name, the containing guide and the portal tiles it was
-- listed under. Phase 2 -- this migration -- is the METADATA CRAWL: one response per
-- Phase-1 asset path, exposing scalar metadata plus four independent unordered arrays.
--
-- A metadata run is NOT another path crawl. It hangs off ONE COMPLETED path crawl and may
-- only cover assets that crawl actually observed.
--
-- RULE 1 -- PROPERTIES AND CHARACTERS ARE TWO INDEPENDENT SETS AND MUST NEVER BE JOINED.
--   This is the single most expensive mistake available in this schema, so it is stated
--   first and enforced structurally. The source returns `properties[]` and `character[]`
--   as separate unordered arrays on the same asset. Their co-presence asserts NOTHING
--   about a property-character relationship. One observed asset carries NINE properties
--   and ONE character: a bridge table, a join, or a zip of the two arrays would
--   manufacture NINE relationships Disney never stated, and they would be indistinguishable
--   from real ones forever.
--   THE ENFORCEMENT: plm.dcp_asset_property_observation and
--   plm.dcp_asset_character_observation are separate tables with NO foreign key between
--   them, no shared surrogate, no trigger that reads one while writing the other, and no
--   function anywhere in 20260811060000 that opens both in the same statement.
--   plm.dcp_character DELIBERATELY HAS NO PROPERTY COLUMN. That absence is a locked
--   decision -- do not "finish" it. Disney OPA (plm.opa_*) is the ONLY Disney source that
--   directly asserts property-to-character, and it is a different portal with a different
--   landing schema which must not be folded into this one.
--
-- RULE 2 -- THE PATH IS THE ASSET IDENTITY. File name is NOT unique; collisions are
--   observed in this source in the thousands. The style-guide source id is NULLABLE TEXT
--   in two different observed formats. A NAME IS NEVER AN ID. This migration therefore
--   never keys anything on a name, and reaches assets only through plm.dcp_asset.id,
--   which Phase 1 keyed on (source_system, source_path).
--
-- RULE 3 -- METADATA IS TIME-VARYING OBSERVATION DATA. Every scalar and every link in
--   this migration is keyed by (metadata_run_id, dcp_asset_id) -- NEVER written onto the
--   stable plm.dcp_asset row. The source is a point-in-time portal snapshot with no
--   change feed, so overwriting one "current metadata" row loses the fact that a title,
--   owner, restriction or tag changed. A future view may select the latest complete run;
--   the landing layer keeps them all.
--
-- RULE 4 -- HTTP 200 IS NOT SUCCESS. A signed-out DCP Vault session returns HTTP 200 with
--   a tiny zero-record body. fetch_status is therefore a first-class column with its own
--   'signed_out' value, and 20260811060000 refuses to mark a response successful on
--   status code alone.
--
-- =====================================================================================
-- SECTION -0.5. WHAT THIS MIGRATION DELIBERATELY DOES NOT DO
-- =====================================================================================
--
-- (a) IT DOES NOT TOUCH plm.dcp_asset_row_hash OR ANY PHASE-1 OBJECT. The Phase-1 frozen
--     row hash is a ONE-WAY DOOR: roughly 155,900 rows will carry it, and changing any
--     detail of its serialization invalidates every stored hash and forces a full
--     re-capture of the entire portal. Nothing here redefines it, extends it, wraps it or
--     adds a field to it. The two hashes introduced below are NEW functions under NEW
--     names on NEW columns, exactly as section 1 of 20260810190000 instructs.
--
-- (b) IT DOES NOT EDIT 20260810190000 OR 20260810190100. Those are merged history,
--     reviewed under PR #726. They are currently unapplied on production, which tempts a
--     reader to "just fix them in place". Do not. A correction is always a new forward
--     migration, because the ledger and the files must stay in step on every environment
--     independently.
--
-- (c) NO api.* VIEWS, DELIBERATELY -- the same choice 20260810190000 DECISION 2 recorded,
--     and for the same reason. No application reads DCP Vault data today. An api view is
--     a published read contract that must then be versioned forever, and publishing one
--     before a caller exists fixes a shape nobody has validated.
--
-- (d) NO PROMOTION PATH INTO core.* OR dam.*. The core_property_id / core_character_id
--     columns below are NULL at landing, are never written by any loader, and exist only
--     so a LATER human-reviewed mapping has somewhere to record its decision.
--
-- (e) NO PROPERTY-CHARACTER TABLE. See RULE 1. Its absence is the design.
--
-- =====================================================================================
-- SECTION 0. THE SECOND FROZEN SERIALIZATION -- plm.dcp_metadata_row_hash
--
-- ***** THIS SPECIFICATION BECOMES A ONE-WAY DOOR ON THE FIRST PRODUCTION LOAD. *****
--
-- It is NOT frozen today: zero rows carry it, because no metadata run has ever been
-- loaded anywhere. It freezes the moment the first complete metadata run lands, for
-- exactly the reason section 1 of 20260810190000 gives -- once N rows carry a digest,
-- changing the scheme makes every one of them compare unequal, change detection reports a
-- total rewrite that never happened, and the only correction is a full re-capture.
-- CHANGE IT NOW OR NEVER. After the first load, a new field means a NEW function, a NEW
-- column and an explicit re-hash plan.
--
-- IT IS A DIFFERENT FUNCTION FROM plm.dcp_asset_row_hash AND MUST STAY ONE. They digest
-- different grains: the Phase-1 hash digests a path observation, this digests a metadata
-- response. Merging them would drag the already-frozen Phase-1 door into any future
-- Phase-2 change.
--
-- -------------------------------------------------------------------------------------
-- THE SPECIFICATION, IN FULL
-- -------------------------------------------------------------------------------------
-- normalized_hash = lower(encode(sha256(convert_to(S, 'UTF8')), 'hex'))
--   -- exactly 64 lowercase hexadecimal characters.
--
-- S is the concatenation of EXACTLY TWENTY-TWO slots, in EXACTLY this order, with NO
-- other content before, between or after them. Slots 1-18 are scalars; slots 19-22 are
-- sets.
--
--   slot  1  source_uuid              slot 10  is_exclusive_raw
--   slot  2  collection_dmc_id        slot 11  is_embargoed_raw
--   slot  3  collection_main_title    slot 12  is_locked_raw
--   slot  4  collection_type          slot 13  release_date_raw
--   slot  5  dc_title                 slot 14  modified_at_raw
--   slot  6  design_element           slot 15  file_size_raw
--   slot  7  content_type             slot 16  format_raw
--   slot  8  content_owner            slot 17  num_pages_raw
--   slot  9  source_status            slot 18  dam_sha1
--   slot 19  property source_id SET
--   slot 20  character source_id SET
--   slot 21  art_style term SET
--   slot 22  keyword term SET
--
-- ENCODING IS IDENTICAL TO THE PHASE-1 SCHEME, deliberately, so there is one convention
-- in this schema rather than two. EACH SLOT is emitted as three parts, in order:
--     presence_flag || value_text || U+001F
--   * presence_flag is '+' when the value IS NOT NULL and '-' when it IS NULL.
--   * value_text is '' when NULL, and the value's exact characters otherwise. No
--     trimming, no case folding, no normalisation, no escaping.
--   * U+001F (UNIT SEPARATOR) terminates EVERY slot INCLUDING THE TWENTY-SECOND, so a
--     trailing NULL cannot be confused with an absent slot.
--
-- ONLY THE RAW SOURCE SCALARS ARE HASHED. The *_interpreted companions are OUR parse of
--   the source, not the source, and they are deliberately ABSENT from every slot. If they
--   were hashed, correcting a parsing rule later would change the digest of data the
--   portal never changed -- which is precisely the false "everything changed" report this
--   hash exists to prevent.
--
-- SETS (slots 19-22): the values ACTUALLY LINKED to this asset in THIS metadata run, read
--   back from the link tables AFTER the links are written -- never taken from the input
--   response before they were. Duplicates removed, sorted ASCENDING using COLLATE "C"
--   (raw byte order), joined with a single U+001E between adjacent elements, no leading
--   or trailing separator.
--   * COLLATE "C" IS REQUIRED. The database default collation is locale-dependent and can
--     order the same two strings differently after a libc upgrade or on another server; a
--     locale-sorted set would silently change the digest of unchanged data.
--   * AN EMPTY ARRAY IS NOT NULL. An empty set means "the portal returned this array and
--     it was empty" and serialises to '+' with empty value_text. NULL means "this array
--     was not observed at all". Both occur -- the metadata sample proved assets that omit
--     `character` entirely -- and they MUST hash differently. Collapsing them would make
--     "Disney removed every character" indistinguishable from "we did not look".
--
-- SEPARATOR SAFETY: identical to Phase 1. U+001F and U+001E cannot occur in this source's
--   values; rather than trust that, the function REFUSES any input containing either.
--   Escaping was rejected on purpose -- an escape rule is a second thing a future
--   re-implementation can get subtly different, and a hard refusal cannot be got wrong. A
--   refused row becomes a plm.dcp_load_exception, never a silently different digest.
--
-- WHY 22 NAMED PARAMETERS AND NOT ONE text[] OF SCALARS: an array makes slot ORDER the
--   caller's responsibility, and a caller that reorders two slots produces a valid-looking
--   digest of the wrong serialization with no error anywhere. Named parameters make the
--   order the FUNCTION's responsibility, which is the whole point of computing the digest
--   in the database instead of in a loader.
-- =====================================================================================
create or replace function plm.dcp_metadata_row_hash(
  p_source_uuid           text,
  p_collection_dmc_id     text,
  p_collection_main_title text,
  p_collection_type       text,
  p_dc_title              text,
  p_design_element        text,
  p_content_type          text,
  p_content_owner         text,
  p_source_status         text,
  p_is_exclusive_raw      text,
  p_is_embargoed_raw      text,
  p_is_locked_raw         text,
  p_release_date_raw      text,
  p_modified_at_raw       text,
  p_file_size_raw         text,
  p_format_raw            text,
  p_num_pages_raw         text,
  p_dam_sha1              text,
  p_property_ids          text[],
  p_character_ids         text[],
  p_art_style_terms       text[],
  p_keyword_terms         text[]
)
returns text
language plpgsql
immutable
-- Pinned for the same reason as the Phase-1 hash: not a definer function and builtins
-- only today, but this digest must never become resolution-dependent.
set search_path = pg_catalog
as $$
declare
  v_us   constant text := chr(31);   -- UNIT SEPARATOR, slot terminator
  v_rs   constant text := chr(30);   -- RECORD SEPARATOR, set joiner
  v_scalars text[] := array[
    p_source_uuid, p_collection_dmc_id, p_collection_main_title, p_collection_type,
    p_dc_title, p_design_element, p_content_type, p_content_owner, p_source_status,
    p_is_exclusive_raw, p_is_embargoed_raw, p_is_locked_raw, p_release_date_raw,
    p_modified_at_raw, p_file_size_raw, p_format_raw, p_num_pages_raw, p_dam_sha1
  ];
  v_set   text[];
  v_s     text := '';
  v_join  text;
  v_elem  text;
  v       text;
  i       integer;
  j       integer;
begin
  -- ---------------------------------------------------------------------------------
  -- Slots 1-18. Separator safety is checked BEFORE any concatenation.
  -- array_length is used rather than a literal 18 so that adding a scalar above cannot
  -- leave a slot silently unhashed.
  -- ---------------------------------------------------------------------------------
  for i in 1 .. array_length(v_scalars, 1) loop
    v := v_scalars[i];
    if v is not null and (position(v_us in v) > 0 or position(v_rs in v) > 0) then
      raise exception 'DCP metadata hash refused: scalar slot % contains a reserved '
        'separator (U+001F or U+001E). The canonical serialization does not escape; such '
        'a response must be recorded in plm.dcp_load_exception instead. No value is '
        'echoed here because this database''s logs are not private.', i
        using errcode = 'P0001';
    end if;
    v_s := v_s || (case when v is null then '-' else '+' end) || coalesce(v, '') || v_us;
  end loop;

  -- ---------------------------------------------------------------------------------
  -- Slots 19-22, in the fixed order property, character, art_style, keyword.
  --
  -- THE FOUR SETS ARE SERIALISED IN A LOOP OVER A LIST, AND THE LIST IS THE ONLY PLACE
  -- THE ORDER IS WRITTEN. That matters for RULE 1: the loop reads each set independently
  -- and never has two of them in scope at once, so there is no expression anywhere in
  -- this function in which a property and a character value can meet.
  -- ---------------------------------------------------------------------------------
  for j in 1 .. 4 loop
    v_set := case j
               when 1 then p_property_ids
               when 2 then p_character_ids
               when 3 then p_art_style_terms
               else        p_keyword_terms
             end;

    if v_set is null then
      -- "not observed" -- distinct from an observed empty array. See the specification.
      v_s := v_s || '-' || v_us;
    else
      foreach v_elem in array v_set loop
        if v_elem is null then
          raise exception 'DCP metadata hash refused: set slot % contains a NULL element. '
            'Pass an empty array for "observed and empty", or NULL for "not observed"; a '
            'NULL element is neither and has no defined serialization.', 18 + j
            using errcode = 'P0001';
        end if;
        if position(v_us in v_elem) > 0 or position(v_rs in v_elem) > 0 then
          raise exception 'DCP metadata hash refused: an element of set slot % contains a '
            'reserved separator (U+001F or U+001E).', 18 + j using errcode = 'P0001';
        end if;
      end loop;

      -- DISTINCT, then ORDER BY ... COLLATE "C". Both are load-bearing.
      select coalesce(string_agg(k, v_rs order by k collate "C"), '')
        into v_join
        from (select distinct unnest(v_set) as k) d;

      v_s := v_s || '+' || v_join || v_us;
    end if;
  end loop;

  return lower(encode(sha256(convert_to(v_s, 'UTF8')), 'hex'));
end;
$$;

comment on function plm.dcp_metadata_row_hash(
  text, text, text, text, text, text, text, text, text, text, text,
  text, text, text, text, text, text, text, text[], text[], text[], text[]) is
'Canonical normalized-metadata digest for plm.dcp_metadata_asset.normalized_hash. sha256, '
'lowercase hex, over UTF-8 bytes of TWENTY-TWO slots in a fixed order: 18 RAW source '
'scalars then the property, character, art_style and keyword SETS. Each slot is '
'presence-flag (''+'' present / ''-'' NULL) then the verbatim value then U+001F, '
'terminator included on the last slot. Sets are deduplicated, sorted COLLATE "C" (byte '
'order, locale-proof) and joined with U+001E; an observed EMPTY array and an UNOBSERVED '
'NULL array hash DIFFERENTLY and that distinction is load-bearing. The *_interpreted '
'columns are deliberately NOT hashed -- they are our parse, not the source, and hashing '
'them would make a later parser fix look like the portal changed. No case folding, no '
'trimming, no escaping; a value carrying a reserved separator is REFUSED so it becomes a '
'load exception rather than a silently different digest. THIS IS A SEPARATE FUNCTION FROM '
'plm.dcp_asset_row_hash and must stay separate -- that one is already frozen over ~155,900 '
'Phase-1 rows. This one freezes on the first complete metadata load: change it now or '
'never. Full normative specification in section 0 of migration 20260811050000.';

revoke all on function plm.dcp_metadata_row_hash(
  text, text, text, text, text, text, text, text, text, text, text,
  text, text, text, text, text, text, text, text[], text[], text[], text[]) from public;
grant execute on function plm.dcp_metadata_row_hash(
  text, text, text, text, text, text, text, text, text, text, text,
  text, text, text, text, text, text, text, text[], text[], text[], text[])
  to authenticated, service_role;

-- =====================================================================================
-- SECTION 1. plm.dcp_metadata_run -- one row per attempt to fetch metadata for every
--            asset in ONE COMPLETED path crawl.
-- =====================================================================================
create table plm.dcp_metadata_run (
  metadata_run_id      uuid primary key default gen_random_uuid(),

  -- on delete restrict, NOT cascade: a path crawl that has metadata hanging off it is
  -- evidence a metadata run depended on, and deleting it silently would strand the
  -- interpretation of every response.
  source_crawl_id      uuid not null references plm.dcp_crawl(crawl_id) on delete restrict,

  status               text not null default 'planned',
  captured_on          date not null,
  started_at           timestamptz null,
  finished_at          timestamptz null,

  -- A RELATIVE, NON-SECRET SUFFIX ONLY. Never a full URL with a query string, never a
  -- cookie, session id, bearer token or signed parameter. The CHECK enforces the shape
  -- rather than trusting the caller, because a credential pasted here would be a
  -- credential in a shared database's logs and backups forever.
  endpoint_suffix      text not null,

  crawler_version      text not null,
  captured_by          text not null,
  private_source_commit text not null,

  assets_expected      integer not null,
  fetches_succeeded    integer null,
  fetches_failed       integer null,
  failure_message      text null,

  metadata             jsonb not null default '{}'::jsonb,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  constraint dcp_metadata_run_status_chk
    check (status in ('planned','running','complete','failed')),

  constraint dcp_metadata_run_captured_on_chk
    check (captured_on >= date '2026-01-01'),

  -- No scheme, no host, no query string, no whitespace. A leading '/' is required so the
  -- value cannot accidentally be a bare host name.
  constraint dcp_metadata_run_endpoint_chk check (
    btrim(endpoint_suffix) = endpoint_suffix
    and endpoint_suffix <> ''
    and left(endpoint_suffix, 1) = '/'
    and position('://' in endpoint_suffix) = 0
    and position('?' in endpoint_suffix) = 0
    and endpoint_suffix !~ '\s'
  ),

  constraint dcp_metadata_run_crawler_version_chk check (btrim(crawler_version) <> ''),
  constraint dcp_metadata_run_captured_by_chk check (btrim(captured_by) <> ''),
  -- A 40-char hex sha1 or a 64-char hex sha256. Provenance that cannot be resolved back
  -- to an exact private commit is not provenance.
  constraint dcp_metadata_run_commit_chk
    check (private_source_commit ~ '^[0-9a-f]{40}$'
        or private_source_commit ~ '^[0-9a-f]{64}$'),

  constraint dcp_metadata_run_expected_chk check (assets_expected >= 0),
  constraint dcp_metadata_run_counts_chk check (
    (fetches_succeeded is null or fetches_succeeded >= 0)
    and (fetches_failed is null or fetches_failed >= 0)
  ),

  -- THE COMPLETENESS ARITHMETIC, AS A CONSTRAINT AND NOT AS A HOPE.
  -- A run may only be `complete` when both counts are present and they add up to exactly
  -- what was expected. This is the structural form of "a missing chunk cannot assemble
  -- into a shorter complete run": the count was fixed at begin time from the source
  -- crawl's own membership, so a load that quietly dropped rows cannot balance.
  constraint dcp_metadata_run_complete_chk check (
    status <> 'complete'
    or (fetches_succeeded is not null
        and fetches_failed is not null
        and fetches_succeeded + fetches_failed = assets_expected
        and finished_at is not null)
  ),
  constraint dcp_metadata_run_failed_chk check (
    status <> 'failed' or (failure_message is not null and btrim(failure_message) <> '')
  ),
  constraint dcp_metadata_run_running_chk check (
    status = 'planned' or started_at is not null
  ),
  constraint dcp_metadata_run_finished_order_chk check (
    finished_at is null or started_at is null or finished_at >= started_at
  ),

  -- Supports the composite foreign key on plm.dcp_metadata_asset that pins a metadata row
  -- to the SAME source crawl its run declared. Redundant as a uniqueness statement --
  -- metadata_run_id is already the primary key -- and REQUIRED as a referencable target,
  -- because PostgreSQL will only accept a composite FK against a declared unique key.
  constraint dcp_metadata_run_run_crawl_unique unique (metadata_run_id, source_crawl_id)
);

-- ONE RUNNING RUN PER SOURCE CRAWL. A partial unique index, not a CHECK: the rule is
-- about the relationship BETWEEN rows, which a row constraint cannot see. Two concurrent
-- runs over one crawl would each believe they own the reconciliation and each finalize
-- against the other's rows.
create unique index idx_dcp_metadata_run_one_running
  on plm.dcp_metadata_run (source_crawl_id)
  where status = 'running';

create index idx_dcp_metadata_run_source_crawl on plm.dcp_metadata_run (source_crawl_id);
create index idx_dcp_metadata_run_status on plm.dcp_metadata_run (status);

comment on table plm.dcp_metadata_run is
'One row per attempt to fetch DCP Vault metadata for every asset in ONE COMPLETED path '
'crawl. A metadata run is NOT another path crawl: it hangs off plm.dcp_crawl and may only '
'cover assets that crawl observed. assets_expected is fixed at begin time from the source '
'crawl''s own plm.dcp_asset_crawl membership, which is what makes the completeness '
'arithmetic meaningful -- a load that silently dropped rows cannot make '
'succeeded + failed = expected balance. Only ONE run per source crawl may be `running` at '
'a time (partial unique index). A `complete` run is IMMUTABLE, including against INSERT '
'into its evidence tables.';
comment on column plm.dcp_metadata_run.endpoint_suffix is
'The RELATIVE, NON-SECRET path suffix the metadata fetch used. Never a full URL, never a '
'query string, never a cookie, session id, bearer token or signed parameter -- a CHECK '
'enforces that shape rather than trusting the caller, because a credential written here '
'would live in this shared database''s logs and backups permanently.';
comment on column plm.dcp_metadata_run.assets_expected is
'The exact plm.dcp_asset_crawl row count of the source crawl, captured at begin time by '
'plm.begin_dcp_metadata_run. NEVER a caller-supplied number and never re-derived at '
'finalization -- re-deriving it at the end would let a run that lost rows redefine its own '
'target and report itself complete.';

-- =====================================================================================
-- SECTION 2. plm.dcp_metadata_asset -- one row per expected asset per metadata run.
--
-- This is the fetch-outcome and scalar-metadata table, and it is the join point every
-- link table hangs off.
--
-- THE TWO COMPOSITE FOREIGN KEYS, AND WHY NEITHER IS REDUNDANT.
--   FK-A  (metadata_run_id, source_crawl_id) -> dcp_metadata_run(metadata_run_id, source_crawl_id)
--         pins this row's source_crawl_id to the one its RUN declared. Without it a row
--         could name run R while claiming a different source crawl, and the membership
--         check below would then be performed against the wrong crawl entirely.
--   FK-B  (source_crawl_id, dcp_asset_id) -> dcp_asset_crawl(crawl_id, dcp_asset_id)
--         proves this asset was ACTUALLY OBSERVED BY THAT CRAWL. Without it, metadata
--         could be attached to any asset in the table, including one from a different
--         crawl or a different portal section, and the run's reconciliation would still
--         appear to balance.
--   TOGETHER they make "a metadata row cannot reference an asset outside its source
--   crawl" a structural impossibility rather than a loader convention. A single FK
--   straight to plm.dcp_asset(id) -- the obvious shape -- enforces neither.
-- =====================================================================================
create table plm.dcp_metadata_asset (
  metadata_run_id  uuid not null,
  source_crawl_id  uuid not null,
  dcp_asset_id     uuid not null,

  fetch_status     text not null default 'pending',
  attempt_count    integer not null default 0,
  http_status      integer null,
  response_bytes   bigint null,
  retrieved_at     timestamptz null,
  failure_code     text null,
  failure_reason   text null,

  -- ---------------------------------------------------------------------------------
  -- OBSERVED SOURCE COLUMNS. Every one preserves the EXACT source value as text.
  -- Nothing here is coerced, trimmed, folded or parsed. These are the slots the
  -- normalized hash digests.
  -- ---------------------------------------------------------------------------------
  source_uuid            text null,
  collection_dmc_id      text null,
  collection_main_title  text null,
  collection_type        text null,
  dc_title               text null,
  design_element         text null,
  content_type           text null,
  content_owner          text null,
  source_status          text null,
  is_exclusive_raw       text null,
  is_embargoed_raw       text null,
  is_locked_raw          text null,
  release_date_raw       text null,
  modified_at_raw        text null,
  file_size_raw          text null,
  format_raw             text null,
  num_pages_raw          text null,
  dam_sha1               text null,

  -- ---------------------------------------------------------------------------------
  -- SAFE INTERPRETED COMPANIONS. These sit BESIDE the raw values and never replace them.
  -- The business meanings of isExclusive, isEmbargoed, isLocked and status are UNKNOWN --
  -- they require Disney's licensing contact -- so an unknown value must land raw with
  -- rights_parse_confident = false rather than fail the load or coerce to a guess.
  -- ---------------------------------------------------------------------------------
  is_exclusive_interpreted   boolean null,
  is_embargoed_interpreted   boolean null,
  is_locked_interpreted      boolean null,
  rights_parse_confident     boolean not null default false,
  release_date_interpreted   timestamptz null,
  modified_at_interpreted    timestamptz null,
  file_size_bytes_interpreted bigint null,
  num_pages_interpreted      integer null,

  -- ---------------------------------------------------------------------------------
  -- EVIDENCE
  -- ---------------------------------------------------------------------------------
  raw_metadata     jsonb null,
  source_hash      text null,
  normalized_hash  text null,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint dcp_metadata_asset_pkey primary key (metadata_run_id, dcp_asset_id),

  -- FK-A and FK-B. See the header above; neither replaces the other.
  constraint dcp_metadata_asset_run_fk
    foreign key (metadata_run_id, source_crawl_id)
    references plm.dcp_metadata_run (metadata_run_id, source_crawl_id) on delete cascade,
  constraint dcp_metadata_asset_membership_fk
    foreign key (source_crawl_id, dcp_asset_id)
    references plm.dcp_asset_crawl (crawl_id, dcp_asset_id) on delete restrict,

  constraint dcp_metadata_asset_fetch_status_chk check (
    fetch_status in ('pending','success','not_found','signed_out','rejected','failed')
  ),
  constraint dcp_metadata_asset_attempts_chk check (attempt_count >= 0),
  constraint dcp_metadata_asset_bytes_chk check (response_bytes is null or response_bytes >= 0),
  constraint dcp_metadata_asset_http_chk check (http_status is null or http_status between 100 and 599),

  -- FAILURE-STATE COHERENCE, BOTH WAYS. A terminal failure without a code is an
  -- untriageable row; a code on a success is a contradiction that would make any
  -- "how did this run fail" query lie.
  constraint dcp_metadata_asset_failure_coherence_chk check (
    case
      when fetch_status in ('not_found','signed_out','rejected','failed')
        then failure_code is not null and btrim(failure_code) <> ''
      else failure_code is null and failure_reason is null
    end
  ),

  -- SUCCESS MEANS A VALID METADATA OBJECT WAS STORED -- and nothing more.
  -- raw_metadata must be a JSON OBJECT, not an array, string or scalar: the signed-out
  -- page and the tiny zero-record body both fail this. Note carefully what is NOT
  -- required: no individual Disney field. The sample already proved that some assets omit
  -- `character` entirely, so demanding any optional field would reject honest successes.
  --
  -- normalized_hash IS DELIBERATELY **NOT** IN THIS CHECK, AND THE REASON IS AN ORDERING
  -- FACT, NOT AN OVERSIGHT. Read this before "completing" the constraint.
  --   source_hash CAN be required here because it digests the received response TEXT,
  --   which the loader holds in hand at the moment it writes the row.
  --   normalized_hash CANNOT. Its specification requires digesting the values as STORED
  --   and the link sets as ACTUALLY WRITTEN -- so it cannot exist until after this row is
  --   stored and its property, character and term links are inserted. Requiring it here
  --   makes the very first UPDATE that marks a row successful violate the constraint, and
  --   the only ways out are both wrong: compute the digest from the INPUT row instead
  --   (which is the exact defect that lets a stale stored value hide behind an
  --   unchanged-looking hash forever), or drop the read-back. This was caught by the
  --   loader contract test on its first CI run.
  --   THE GUARANTEE IS NOT LOST, it moves one step later: GATE 5 of
  --   plm.finalize_dcp_metadata_run refuses to complete any run holding a successful row
  --   without BOTH digests. A missing normalized_hash is therefore transient within a
  --   single load statement and impossible in any completed run.
  constraint dcp_metadata_asset_success_evidence_chk check (
    fetch_status <> 'success'
    or (raw_metadata is not null
        and jsonb_typeof(raw_metadata) = 'object'
        and retrieved_at is not null
        and source_hash is not null)
  ),
  -- A signed-out response must NOT retain a body. Storing it would keep a page of portal
  -- chrome in a licensor-confidential table for no diagnostic value.
  constraint dcp_metadata_asset_signed_out_chk check (
    fetch_status <> 'signed_out' or raw_metadata is null
  ),
  -- Hashes exist only where a success produced them, and always in the enforced shape.
  constraint dcp_metadata_asset_source_hash_chk
    check (source_hash is null or source_hash ~ '^[0-9a-f]{64}$'),
  constraint dcp_metadata_asset_normalized_hash_chk
    check (normalized_hash is null or normalized_hash ~ '^[0-9a-f]{64}$'),
  constraint dcp_metadata_asset_hash_only_on_success_chk check (
    fetch_status = 'success' or (source_hash is null and normalized_hash is null)
  ),

  -- Interpreted values may only exist where their raw source value exists. An interpreted
  -- boolean beside a NULL raw string is a value invented by the parser.
  constraint dcp_metadata_asset_interpreted_needs_raw_chk check (
    (is_exclusive_interpreted is null or is_exclusive_raw is not null)
    and (is_embargoed_interpreted is null or is_embargoed_raw is not null)
    and (is_locked_interpreted   is null or is_locked_raw   is not null)
    and (release_date_interpreted is null or release_date_raw is not null)
    and (modified_at_interpreted  is null or modified_at_raw  is not null)
    and (file_size_bytes_interpreted is null or file_size_raw is not null)
    and (num_pages_interpreted    is null or num_pages_raw    is not null)
  ),
  constraint dcp_metadata_asset_size_chk
    check (file_size_bytes_interpreted is null or file_size_bytes_interpreted >= 0),
  constraint dcp_metadata_asset_pages_chk
    check (num_pages_interpreted is null or num_pages_interpreted >= 0),

  -- THE SUCCESS-ONLY LINK TARGET. This unique key exists for ONE reason: the three link
  -- tables carry a fetch_status column pinned to 'success' by CHECK and reference this
  -- key, which makes "a link may only hang off a SUCCESSFUL metadata row" a declarative
  -- guarantee instead of a loader promise. It also blocks the reverse hole: a row cannot
  -- be flipped from 'success' to 'failed' while links still point at it, because the FK
  -- has nothing left to reference.
  constraint dcp_metadata_asset_success_key unique (metadata_run_id, dcp_asset_id, fetch_status)
);

create index idx_dcp_metadata_asset_asset on plm.dcp_metadata_asset (dcp_asset_id);
create index idx_dcp_metadata_asset_status on plm.dcp_metadata_asset (metadata_run_id, fetch_status);
create index idx_dcp_metadata_asset_crawl on plm.dcp_metadata_asset (source_crawl_id);
-- Supports "did this asset's metadata change between runs" without scanning a run.
create index idx_dcp_metadata_asset_normalized_hash
  on plm.dcp_metadata_asset (dcp_asset_id, normalized_hash)
  where normalized_hash is not null;
-- The open-work index: which expected assets have not reached a terminal state yet.
create index idx_dcp_metadata_asset_pending
  on plm.dcp_metadata_asset (metadata_run_id)
  where fetch_status = 'pending';

comment on table plm.dcp_metadata_asset is
'One row per EXPECTED asset per metadata run: the fetch outcome plus every scalar the DCP '
'Vault metadata response exposed, each preserved as the exact source text. Scalars are '
'NEVER written onto the stable plm.dcp_asset row -- metadata is time-varying observation '
'data and overwriting it would lose the fact that a title, owner or restriction changed. '
'Two composite foreign keys, neither redundant: one pins this row to the source crawl its '
'RUN declared, the other proves that crawl actually observed this asset. Together they '
'make "metadata for an asset outside its source crawl" structurally impossible. SUCCESS '
'means a valid metadata OBJECT was stored -- it does NOT mean every Disney field is '
'present, because some assets legitimately omit fields.';
comment on column plm.dcp_metadata_asset.fetch_status is
'pending | success | not_found | signed_out | rejected | failed. HTTP 200 IS NOT SUCCESS: '
'a signed-out DCP Vault session returns 200 with a tiny zero-record body, which is why '
'signed_out is its own terminal value and why a success additionally requires raw_metadata '
'to be a JSON OBJECT. Only a `success` row may carry links.';
comment on column plm.dcp_metadata_asset.raw_metadata is
'The exact metadata response as a JSON object, kept as evidence. It is EVIDENCE, not the '
'query surface -- the normalized columns and link tables exist precisely so consumers do '
'not each write their own JSON parser over licensor data. NULL on a signed_out row by '
'CHECK: a portal sign-out page has no diagnostic value and should not be retained.';
comment on column plm.dcp_metadata_asset.source_hash is
'sha256 of the EXACT UTF-8 bytes of the successful raw response TEXT as received, before '
'any cast to jsonb. Deliberately digests the received text and not the parsed value: jsonb '
'canonicalises key order, whitespace, escaping and number form, so a digest taken after '
'the cast would be of something the portal never sent and the capture could not reproduce. '
'Case and whitespace changes in the response DO change this digest, which is the point -- '
'normalized_hash is the one that ignores them.';
comment on column plm.dcp_metadata_asset.normalized_hash is
'plm.dcp_metadata_row_hash over the 18 raw scalars and the four sorted link SETS. Changes '
'when the meaning changed; ignores array order. The *_interpreted columns are NOT in it. '
'Its serialization freezes on the first complete production load -- see section 0 of '
'migration 20260811050000.';
comment on column plm.dcp_metadata_asset.rights_parse_confident is
'FALSE by default and FALSE whenever any rights value was not a spelling the loader has '
'explicitly been taught. The business meanings of isExclusive, isEmbargoed, isLocked and '
'status are UNKNOWN and require Disney''s licensing contact. An unknown value lands raw '
'with this flag false -- it never fails the load and it never coerces to a guess.';

-- =====================================================================================
-- SECTION 3. SOURCE IDENTITIES -- plm.dcp_property, plm.dcp_character, plm.dcp_term
--
-- These three outlive any single metadata run, exactly as plm.dcp_asset outlives any
-- single path crawl. A later run re-observing the same property is normal and must not be
-- an error, so they are NOT frozen wholesale -- only their SOURCE columns freeze once a
-- COMPLETE run has seen them (section 5.2).
--
-- READ RULE 1 AT THE HEAD OF THIS FILE BEFORE TOUCHING EITHER OF THE FIRST TWO.
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- 3.1 plm.dcp_property -- one identity per distinct exact member of properties[]
-- -------------------------------------------------------------------------------------
create table plm.dcp_property (
  id                  uuid primary key default gen_random_uuid(),
  source_system       text not null default 'disney_dcpvault',
  source_id           text not null,

  -- Populated ONLY if the portal separately exposes a human label. It is NEVER parsed out
  -- of the id, and it is NEVER used as a key -- see RULE 2. A display name derived from an
  -- id would look like source truth and be our invention.
  display_name        text null,

  first_seen_metadata_run_id uuid null
    references plm.dcp_metadata_run(metadata_run_id) on delete set null,
  last_seen_metadata_run_id  uuid null
    references plm.dcp_metadata_run(metadata_run_id) on delete set null,

  -- Reconciliation only. NULL at landing, never written by any loader.
  core_property_id    uuid null,
  resolved_at         timestamptz null,
  resolved_by         text null,
  resolution_note     text null,

  raw                 jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint dcp_property_source_id_chk check (btrim(source_id) <> ''),
  constraint dcp_property_display_name_chk
    check (display_name is null or btrim(display_name) <> ''),
  constraint dcp_property_unique unique (source_system, source_id)
);

create index idx_dcp_property_core on plm.dcp_property (core_property_id)
  where core_property_id is not null;

comment on table plm.dcp_property is
'One SOURCE IDENTITY per distinct exact member of the DCP Vault metadata properties[] '
'array. A landing identity, NOT a canonical property: core_property_id is nullable, is '
'NULL at landing, and is written only by a later human-reviewed mapping -- no loader ever '
'sets it and nothing here creates, renames or deactivates a core.property row. Portal '
'TILES are not properties either; tile observations live in plm.dcp_asset_tile_observation '
'and are a browsing filter, not Disney''s asserted property list.';

-- -------------------------------------------------------------------------------------
-- 3.2 plm.dcp_character -- one identity per distinct exact member of character[]
--
-- IT HAS NO PROPERTY COLUMN AND NO PROPERTY FOREIGN KEY. THAT IS THE DESIGN, NOT AN
-- OMISSION, AND IT IS LOCKED. See RULE 1. DCP Vault never asserts which property a
-- character belongs to; adding the column would create a slot that someone eventually
-- fills by pairing the two arrays on an asset, which fabricates relationships Disney
-- never stated. Disney OPA is the only source that asserts property-to-character, it has
-- its own plm.opa_* landing, and the two must not be folded together.
-- -------------------------------------------------------------------------------------
create table plm.dcp_character (
  id                  uuid primary key default gen_random_uuid(),
  source_system       text not null default 'disney_dcpvault',
  source_id           text not null,
  display_name        text null,

  first_seen_metadata_run_id uuid null
    references plm.dcp_metadata_run(metadata_run_id) on delete set null,
  last_seen_metadata_run_id  uuid null
    references plm.dcp_metadata_run(metadata_run_id) on delete set null,

  core_character_id   uuid null,
  resolved_at         timestamptz null,
  resolved_by         text null,
  resolution_note     text null,

  raw                 jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint dcp_character_source_id_chk check (btrim(source_id) <> ''),
  constraint dcp_character_display_name_chk
    check (display_name is null or btrim(display_name) <> ''),
  constraint dcp_character_unique unique (source_system, source_id)
);

create index idx_dcp_character_core on plm.dcp_character (core_character_id)
  where core_character_id is not null;

comment on table plm.dcp_character is
'One SOURCE IDENTITY per distinct exact member of the DCP Vault metadata character[] '
'array. THIS TABLE HAS NO PROPERTY COLUMN AND NO PROPERTY FOREIGN KEY, DELIBERATELY AND '
'PERMANENTLY. DCP Vault never asserts which property a character belongs to. Adding such a '
'column creates a slot that is eventually filled by pairing properties[] with character[] '
'on the same asset -- one observed asset has NINE properties and ONE character, so that '
'pairing manufactures nine relationships Disney never stated, indistinguishable from real '
'ones forever. Disney OPA (plm.opa_*) is the only Disney source that directly asserts '
'property-to-character and must not be folded into this schema. A character is also NEVER '
'inferred from a folder or file name: assets were observed in character-named folders with '
'no character field at all, and a path is not an identifier assertion.';

-- -------------------------------------------------------------------------------------
-- 3.3 plm.dcp_term -- reusable exact vocabulary for CLASSIFICATION arrays
--
-- artStyle[] and keyword[] are classifications, not business entities, so they share one
-- vocabulary table discriminated by term_kind rather than getting a table each. If a later
-- sample proves another field is an array, widen term_kind IN A NEW MIGRATION. Do NOT
-- overload this table with properties or characters -- those are entities with their own
-- reconciliation columns and their own locked independence rule.
-- -------------------------------------------------------------------------------------
create table plm.dcp_term (
  id                  uuid primary key default gen_random_uuid(),
  source_system       text not null default 'disney_dcpvault',
  term_kind           text not null,
  source_value        text not null,

  first_seen_metadata_run_id uuid null
    references plm.dcp_metadata_run(metadata_run_id) on delete set null,
  last_seen_metadata_run_id  uuid null
    references plm.dcp_metadata_run(metadata_run_id) on delete set null,

  raw                 jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint dcp_term_kind_chk check (term_kind in ('art_style','keyword')),
  constraint dcp_term_source_value_chk check (btrim(source_value) <> ''),
  constraint dcp_term_unique unique (source_system, term_kind, source_value)
);

comment on table plm.dcp_term is
'Reusable EXACT source vocabulary for the DCP Vault classification arrays. term_kind is '
'constrained to art_style | keyword today; widening it is a NEW migration, never an edit '
'of this one. Values are stored verbatim -- no case folding, no trimming, no deduplication '
'across spellings -- because a vocabulary that normalises loses the evidence of what the '
'portal actually said. This table must NEVER be overloaded with properties or characters: '
'those are entities with reconciliation columns and a locked independence rule.';

-- =====================================================================================
-- SECTION 4. THE THREE INDEPENDENT OBSERVATION LINK TABLES
--
-- ***** THE PROPERTY TABLE AND THE CHARACTER TABLE ARE INDEPENDENT SETS. *****
-- ***** THERE IS NO KEY, NO TRIGGER AND NO QUERY THAT JOINS THEM. SEE RULE 1. *****
--
-- Each is keyed by (metadata_run_id, dcp_asset_id, <target>) so that:
--   * a duplicate array member collapses to ONE link (primary key) without rejecting the
--     response -- a repeated value in the source array is a source quirk, not a load
--     failure;
--   * links are per RUN, so yesterday's observation is never overwritten by today's;
--   * an EMPTY array is represented as ZERO link rows beside a SUCCESSFUL metadata row,
--     which is a completely different state from "no successful metadata row exists".
--
-- THE fetch_status COLUMN ON EACH LINK TABLE IS NOT DENORMALISATION. It is pinned to
-- 'success' by CHECK and carried into the composite foreign key against
-- dcp_metadata_asset_success_key, which makes "a link may only hang off a SUCCESSFUL
-- metadata row" a guarantee the database enforces rather than a promise the loader makes.
-- It also closes the reverse hole: a metadata row cannot be flipped away from 'success'
-- while links still reference it.
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- 4.1 asset -> property. INDEPENDENT OF 4.2.
-- -------------------------------------------------------------------------------------
create table plm.dcp_asset_property_observation (
  metadata_run_id uuid not null,
  dcp_asset_id    uuid not null,
  dcp_property_id uuid not null references plm.dcp_property(id) on delete restrict,
  fetch_status    text not null default 'success',
  observed_at     timestamptz not null default now(),

  constraint dcp_asset_property_obs_pkey
    primary key (metadata_run_id, dcp_asset_id, dcp_property_id),
  constraint dcp_asset_property_obs_success_chk check (fetch_status = 'success'),
  constraint dcp_asset_property_obs_asset_fk
    foreign key (metadata_run_id, dcp_asset_id, fetch_status)
    references plm.dcp_metadata_asset (metadata_run_id, dcp_asset_id, fetch_status)
    on delete cascade
);

create index idx_dcp_asset_property_obs_property
  on plm.dcp_asset_property_observation (dcp_property_id);
create index idx_dcp_asset_property_obs_run
  on plm.dcp_asset_property_observation (metadata_run_id);

comment on table plm.dcp_asset_property_observation is
'Asset-to-property links observed in ONE metadata run. INDEPENDENT of '
'plm.dcp_asset_character_observation: the two sets are never joined, zipped or '
'cross-produced, and no foreign key, trigger or loader statement relates them. Disney '
'returns properties[] and character[] as separate unordered arrays and asserts NOTHING by '
'their co-presence. ZERO rows here beside a SUCCESSFUL metadata row means "the portal '
'returned an empty property array" -- which is a real fact, entirely different from "no '
'successful metadata row exists". The composite FK carries fetch_status pinned to '
'''success'', so a link cannot hang off a failed, pending or signed-out fetch.';

-- -------------------------------------------------------------------------------------
-- 4.2 asset -> character. INDEPENDENT OF 4.1.
-- -------------------------------------------------------------------------------------
create table plm.dcp_asset_character_observation (
  metadata_run_id  uuid not null,
  dcp_asset_id     uuid not null,
  dcp_character_id uuid not null references plm.dcp_character(id) on delete restrict,
  fetch_status     text not null default 'success',
  observed_at      timestamptz not null default now(),

  constraint dcp_asset_character_obs_pkey
    primary key (metadata_run_id, dcp_asset_id, dcp_character_id),
  constraint dcp_asset_character_obs_success_chk check (fetch_status = 'success'),
  constraint dcp_asset_character_obs_asset_fk
    foreign key (metadata_run_id, dcp_asset_id, fetch_status)
    references plm.dcp_metadata_asset (metadata_run_id, dcp_asset_id, fetch_status)
    on delete cascade
);

create index idx_dcp_asset_character_obs_character
  on plm.dcp_asset_character_observation (dcp_character_id);
create index idx_dcp_asset_character_obs_run
  on plm.dcp_asset_character_observation (metadata_run_id);

comment on table plm.dcp_asset_character_observation is
'Asset-to-character links observed in ONE metadata run. INDEPENDENT of '
'plm.dcp_asset_property_observation -- see that table''s comment and RULE 1 in migration '
'20260811050000. An asset with many properties and one character creates many rows THERE '
'and one row HERE, and NOTHING relates them. A character is never inferred from a folder '
'or file name. ZERO rows here beside a successful metadata row means the portal returned '
'no character for this asset, which the sample proved is common and legitimate.';

-- -------------------------------------------------------------------------------------
-- 4.3 asset -> classification term
-- -------------------------------------------------------------------------------------
create table plm.dcp_asset_term_observation (
  metadata_run_id uuid not null,
  dcp_asset_id    uuid not null,
  dcp_term_id     uuid not null references plm.dcp_term(id) on delete restrict,
  fetch_status    text not null default 'success',
  observed_at     timestamptz not null default now(),

  constraint dcp_asset_term_obs_pkey
    primary key (metadata_run_id, dcp_asset_id, dcp_term_id),
  constraint dcp_asset_term_obs_success_chk check (fetch_status = 'success'),
  constraint dcp_asset_term_obs_asset_fk
    foreign key (metadata_run_id, dcp_asset_id, fetch_status)
    references plm.dcp_metadata_asset (metadata_run_id, dcp_asset_id, fetch_status)
    on delete cascade
);

create index idx_dcp_asset_term_obs_term on plm.dcp_asset_term_observation (dcp_term_id);
create index idx_dcp_asset_term_obs_run on plm.dcp_asset_term_observation (metadata_run_id);

comment on table plm.dcp_asset_term_observation is
'Asset-to-classification-term links (art_style, keyword) observed in ONE metadata run. The '
'term_kind lives on plm.dcp_term, so one link table covers both arrays without letting a '
'consumer confuse them. Independent of the property and character link tables in exactly '
'the same way they are independent of each other.';

-- =====================================================================================
-- SECTION 5. IMMUTABILITY -- a completed metadata run's evidence is frozen
--
-- Prose in a design document is not immutability. These are row triggers, and they follow
-- the Phase-1 model in 20260810190000 section 6 exactly.
--
-- WHY EVERY RUN-SCOPED TRIGGER COVERS **INSERT** AS WELL AS UPDATE AND DELETE.
-- Read this before "simplifying" any trigger below to `before update or delete`.
-- Section 6 revokes UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER and MAINTAIN from
-- service_role but deliberately KEEPS INSERT -- so INSERT is the ONE mutating operation
-- still available to the loader's role, which makes it the one an UPDATE/DELETE-only
-- trigger would leave completely unguarded. The concrete hole here: metadata run R
-- finalizes with its counts reconciled, and then a plain
--     insert into plm.dcp_asset_character_observation (metadata_run_id, ...) values (R, ...);
-- gives an asset a character Disney never returned, inside a run that has already been
-- declared complete and reconciled. No grant stops it and, without the INSERT branch, no
-- trigger fires either. This is the exact defect adversarial review found in the Phase-1
-- build; it is not repeated here.
--
-- TRUNCATE fires NO row trigger at all, which is why section 6 revokes it. The revokes and
-- these triggers are ONE mechanism; neither is sufficient alone.
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- 5.1 Run-scoped evidence: frozen entirely once its metadata run is complete.
-- -------------------------------------------------------------------------------------
create or replace function plm.dcp_reject_completed_metadata_change()
returns trigger
language plpgsql
as $$
declare
  v_run    uuid;
  v_status text;
begin
  -- NEW is UNASSIGNED in a DELETE trigger; reading new.* there raises "record new is not
  -- assigned yet". The branch therefore comes BEFORE the read, never inside a coalesce
  -- over both. Every table this trigger is attached to carries metadata_run_id directly,
  -- which is checked structurally at the end of this migration rather than assumed.
  if tg_op = 'DELETE' then
    v_run := old.metadata_run_id;
  else
    v_run := new.metadata_run_id;
  end if;

  select r.status into v_status
  from plm.dcp_metadata_run r
  where r.metadata_run_id = v_run;

  if v_status = 'complete' then
    raise exception
      'DCP Vault metadata run % is COMPLETE and its evidence is immutable; % on %.% is '
      'refused. A refresh is a NEW metadata_run_id, never an edit of an old one -- editing '
      'completed evidence destroys the only record of what the portal actually returned.',
      v_run, tg_op, tg_table_schema, tg_table_name
      using errcode = 'P0001';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

comment on function plm.dcp_reject_completed_metadata_change() is
'Row trigger freezing every RUN-SCOPED plm.dcp_* metadata table once its owning '
'plm.dcp_metadata_run reaches status complete. FIRES ON INSERT, UPDATE AND DELETE -- all '
'three, deliberately. INSERT is not an afterthought: section 6 of migration 20260811050000 '
'revokes UPDATE, DELETE and TRUNCATE from service_role but KEEPS INSERT, so INSERT is the '
'only mutating operation still available and therefore the one an unguarded trigger would '
'leave wide open. Without the INSERT branch a plain INSERT could add a property link, a '
'character link or a term link to an already-completed and already-reconciled run, and that '
'run would then claim an observation the portal never returned. TRUNCATE fires no row '
'trigger at all, which is exactly why section 6 revokes it. The revokes and this trigger '
'are ONE mechanism; neither is sufficient alone.';

do $$
declare t text;
begin
  foreach t in array array[
    'dcp_metadata_asset',
    'dcp_asset_property_observation',
    'dcp_asset_character_observation',
    'dcp_asset_term_observation'
  ]
  loop
    execute format(
      'create trigger %I before insert or update or delete on plm.%I '
      'for each row execute function plm.dcp_reject_completed_metadata_change()',
      'trg_' || t || '_immutable', t);
  end loop;
end;
$$;

-- -------------------------------------------------------------------------------------
-- 5.1b plm.dcp_metadata_run itself -- frozen once complete.
--
-- Attached separately because the run row's own key column is metadata_run_id, so the
-- generic function above would work, but the transition INTO 'complete' must still be
-- permitted. A trigger that refused every UPDATE on a complete run would also refuse the
-- UPDATE that MAKES it complete, and finalization could never run.
-- -------------------------------------------------------------------------------------
create or replace function plm.dcp_metadata_run_freeze()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'complete' then
      raise exception 'DCP Vault metadata run % is COMPLETE and may not be deleted. '
        'Deleting a completed run is how the record of what the portal returned stops '
        'existing; never destroy licensed evidence as a correction.', old.metadata_run_id
        using errcode = 'P0001';
    end if;
    return old;
  end if;

  -- OLD.status = 'complete' is the frozen state. The transition running -> complete is
  -- performed while OLD is still 'running', so finalization is unaffected by this guard.
  if old.status = 'complete' then
    raise exception 'DCP Vault metadata run % is COMPLETE and immutable. A re-fetch is a '
      'NEW metadata_run_id, never an edit of a finished one.', old.metadata_run_id
      using errcode = 'P0001';
  end if;

  -- A run may never leave a terminal state for a live one. Without this, a `failed` run
  -- could be quietly reopened and finalized as though it had always succeeded.
  if old.status = 'failed' and new.status <> 'failed' then
    raise exception 'DCP Vault metadata run % is FAILED and may not be reopened. Start a '
      'NEW run; the failed one stays as the record of what happened.', old.metadata_run_id
      using errcode = 'P0001';
  end if;

  -- The source crawl is the run's identity as much as its own id is. Re-pointing a run at
  -- a different crawl mid-flight would invalidate every membership check already passed.
  if new.source_crawl_id is distinct from old.source_crawl_id then
    raise exception 'DCP Vault metadata run %: source_crawl_id is immutable. Re-pointing a '
      'run at a different crawl invalidates every membership check its rows already '
      'passed.', old.metadata_run_id using errcode = 'P0001';
  end if;

  if new.assets_expected is distinct from old.assets_expected then
    raise exception 'DCP Vault metadata run %: assets_expected is fixed at begin time and '
      'is immutable. A run that could restate its own target could always report itself '
      'complete.', old.metadata_run_id using errcode = 'P0001';
  end if;

  return new;
end;
$$;

comment on function plm.dcp_metadata_run_freeze() is
'Freeze for plm.dcp_metadata_run itself. Refuses UPDATE and DELETE once status is '
'complete, refuses reopening a failed run, and pins source_crawl_id and assets_expected '
'for the run''s whole life. It reads OLD.status deliberately, so the running -> complete '
'transition that finalization performs is still allowed -- a guard written against '
'NEW.status would refuse the very UPDATE that completes the run and finalization could '
'never succeed. assets_expected is pinned because a run able to restate its own target '
'could always make succeeded + failed = expected balance.';

create trigger trg_dcp_metadata_run_freeze
  before update or delete on plm.dcp_metadata_run
  for each row execute function plm.dcp_metadata_run_freeze();

-- -------------------------------------------------------------------------------------
-- 5.2 Stable identities: SOURCE columns freeze; OUR columns stay editable.
--
-- plm.dcp_property, plm.dcp_character and plm.dcp_term outlive any single metadata run,
-- so they are NOT frozen wholesale -- a later run re-observing the same identity is normal.
--
-- What freezes: the SOURCE columns, once the row has been observed by any COMPLETE run.
-- What stays editable forever: last_seen_metadata_run_id, updated_at, and the
-- reconciliation columns -- those are OUR decisions, made after the fact, and are the
-- entire reason these tables have them.
-- DELETE is refused outright once a complete run has seen the row.
-- -------------------------------------------------------------------------------------
create or replace function plm.dcp_reject_completed_metadata_identity_change()
returns trigger
language plpgsql
as $$
declare
  v_seen boolean;
begin
  -- "Has any COMPLETE run observed this identity?" is answered per table FROM THE LINK
  -- EVIDENCE, not from a flag on the row. A flag would have to be maintained and could
  -- drift out of agreement with the evidence it claims to summarise.
  --
  -- Note that the property branch reads ONLY the property link table and the character
  -- branch reads ONLY the character link table. They are deliberately separate branches
  -- rather than one query over a union: see RULE 1.
  if tg_table_name = 'dcp_property' then
    select exists (
      select 1 from plm.dcp_asset_property_observation o
      join plm.dcp_metadata_run r on r.metadata_run_id = o.metadata_run_id
      where o.dcp_property_id = old.id and r.status = 'complete'
    ) into v_seen;
  elsif tg_table_name = 'dcp_character' then
    select exists (
      select 1 from plm.dcp_asset_character_observation o
      join plm.dcp_metadata_run r on r.metadata_run_id = o.metadata_run_id
      where o.dcp_character_id = old.id and r.status = 'complete'
    ) into v_seen;
  elsif tg_table_name = 'dcp_term' then
    select exists (
      select 1 from plm.dcp_asset_term_observation o
      join plm.dcp_metadata_run r on r.metadata_run_id = o.metadata_run_id
      where o.dcp_term_id = old.id and r.status = 'complete'
    ) into v_seen;
  else
    -- An unknown table means this trigger was attached somewhere it was not designed for.
    -- FAIL LOUDLY. Returning NEW here would install a guard that silently permits
    -- everything on the new table, which is worse than no guard at all.
    raise exception 'plm.dcp_reject_completed_metadata_identity_change is attached to %.% '
      'which it does not know how to evaluate. Extend the function before attaching it.',
      tg_table_schema, tg_table_name using errcode = 'P0001';
  end if;

  if not v_seen then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    raise exception 'DCP Vault: %.% row % has been observed by a COMPLETE metadata run and '
      'may not be deleted. Other runs reference this identity.',
      tg_table_schema, tg_table_name, old.id using errcode = 'P0001';
  end if;

  -- `id` is compared too. Without it an observed identity could be RE-KEYED -- every other
  -- column identical, a new primary key -- which breaks every link row pointing at it while
  -- looking like nothing changed.
  if tg_table_name = 'dcp_term' then
    if new.id            is distinct from old.id
    or new.source_system is distinct from old.source_system
    or new.term_kind     is distinct from old.term_kind
    or new.source_value  is distinct from old.source_value
    or new.first_seen_metadata_run_id is distinct from old.first_seen_metadata_run_id
    or new.created_at    is distinct from old.created_at then
      raise exception 'DCP Vault: the SOURCE columns of %.% row % are immutable once a '
        'COMPLETE metadata run has observed it. last_seen_metadata_run_id and updated_at '
        'remain editable so a later run can re-observe it.',
        tg_table_schema, tg_table_name, old.id using errcode = 'P0001';
    end if;
  else
    if new.id            is distinct from old.id
    or new.source_system is distinct from old.source_system
    or new.source_id     is distinct from old.source_id
    or new.display_name  is distinct from old.display_name
    or new.first_seen_metadata_run_id is distinct from old.first_seen_metadata_run_id
    or new.created_at    is distinct from old.created_at then
      raise exception 'DCP Vault: the SOURCE columns of %.% row % are immutable once a '
        'COMPLETE metadata run has observed it. last_seen_metadata_run_id, updated_at and '
        'the reconciliation columns remain editable -- those are our decisions, not the '
        'portal''s.', tg_table_schema, tg_table_name, old.id using errcode = 'P0001';
    end if;
  end if;

  return new;
end;
$$;

comment on function plm.dcp_reject_completed_metadata_identity_change() is
'Row trigger for the STABLE metadata identities (plm.dcp_property, plm.dcp_character, '
'plm.dcp_term). These outlive any single run, so they are NOT frozen wholesale -- a later '
'run re-observing the same identity is normal and must not error. Once ANY COMPLETE run '
'has observed the row: DELETE is refused, and the SOURCE columns (including id and '
'first_seen) become immutable, while last_seen_metadata_run_id, updated_at and the '
'reconciliation columns stay editable forever because those are OUR decisions. '
'"Has a complete run observed it" is answered from the link evidence rather than a flag, '
'because a flag can drift out of agreement with the evidence it summarises. The property '
'and character branches read their OWN link table only, deliberately -- see RULE 1.';

do $$
declare t text;
begin
  foreach t in array array['dcp_property','dcp_character','dcp_term']
  loop
    execute format(
      'create trigger %I before update or delete on plm.%I '
      'for each row execute function plm.dcp_reject_completed_metadata_identity_change()',
      'trg_' || t || '_source_immutable', t);
  end loop;
end;
$$;

-- =====================================================================================
-- SECTION 6. PRIVILEGES -- revoke-first, PostgreSQL 17 complete
--
-- THE TRAP, RESTATED BECAUSE IT STILL APPLIES. The plm schema carries a standing
--     alter default privileges in schema plm grant all on tables to service_role
-- (20260710135975_reconcile_service_role_grants.sql:14). It fires at CREATE TABLE time,
-- BEFORE any GRANT in this migration could run, so every table created above was BORN
-- holding all eight table bits for service_role -- INSERT, SELECT, UPDATE, DELETE,
-- TRUNCATE, REFERENCES, TRIGGER and PostgreSQL 17's MAINTAIN.
--
-- 20260810180000 narrows that default, and it is MERGED. It is also STILL UNAPPLIED on
-- production (verified 2026-08-11: the production ledger stops at 20260810140000) and it
-- belongs to no batch in the nine-batch promotion plan, so the date it lands is not
-- knowable from here. THIS MIGRATION THEREFORE DOES NOT RELY ON IT AT ALL. The revokes
-- below are explicit, run immediately after the tables are created, and would be correct
-- even if 20260810180000 were never promoted.
--
-- A NARROWER GRANT DOES NOT REMOVE A BIT. Only REVOKE does.
--
-- WHY IT MATTERS MORE HERE THAN USUAL: TRUNCATE FIRES NO ROW TRIGGERS. One TRUNCATE would
-- erase a completed metadata run's entire evidence without any section 5 trigger running
-- once. Every immutability guarantee in this migration rests on this revoke.
--
-- THE POSTURE, identical to Phase 1: service_role keeps SELECT and INSERT; UPDATE, DELETE,
-- TRUNCATE, REFERENCES, TRIGGER and MAINTAIN are revoked; public and anon get `revoke all`.
-- =====================================================================================
do $$
declare t text;
begin
  foreach t in array array[
    'dcp_metadata_run','dcp_metadata_asset',
    'dcp_property','dcp_character','dcp_term',
    'dcp_asset_property_observation','dcp_asset_character_observation',
    'dcp_asset_term_observation'
  ]
  loop
    execute format(
      'revoke update, delete, truncate, references, trigger, maintain on plm.%I from service_role', t);
    execute format('revoke all on plm.%I from public', t);
    execute format('revoke all on plm.%I from anon', t);
    execute format('grant select, insert on plm.%I to service_role', t);
    execute format('grant select on plm.%I to authenticated', t);
  end loop;
end;
$$;

-- =====================================================================================
-- SECTION 7. ROW LEVEL SECURITY
--
-- AN RLS POLICY IS NOT A GRANT, and a GRANT IS NOT A POLICY. Both are required, so both
-- are set, in loops that cannot skip a table by hand.
--
-- THE PREDICATE IS THE ROLE GATE from 20260807190000:73-81, the same one Warner adopted in
-- 20260810110000 and Phase 1 adopted in 20260810190000 section 8.
-- `using (true)` IS FORBIDDEN HERE. It was a live security defect on the Disney OPA
-- extract -- it made confidential licensor data readable by EVERY signed-in account,
-- including vendor and viewer principals -- and this is the same licensor's data from the
-- same portal as Phase 1. Noted honestly: app.has_app_access checks for a non-revoked
-- app-access row and ignores roles entirely, so plm app access alone is sufficient.
-- Narrowing that is an owner decision affecting every table sharing this pattern and is
-- out of scope here.
-- =====================================================================================
do $$
declare t text;
begin
  foreach t in array array[
    'dcp_metadata_run','dcp_metadata_asset',
    'dcp_property','dcp_character','dcp_term',
    'dcp_asset_property_observation','dcp_asset_character_observation',
    'dcp_asset_term_observation'
  ]
  loop
    execute format('alter table plm.%I enable row level security', t);
    execute format('drop policy if exists %I on plm.%I', t || '_read', t);
    execute format($p$
      create policy %I on plm.%I
        for select to authenticated
        using (
          app.has_role('administrator')
          or app.has_app_access('plm')
          or app.has_any_role(array['sales', 'licensing']::app.app_role[])
        )
    $p$, t || '_read', t);
  end loop;
end;
$$;

-- =====================================================================================
-- SECTION 8. SELF-CHECKS -- assertions that fail the MIGRATION, not a later query
--
-- Each of these guards an assumption made higher up that would otherwise only reveal
-- itself as wrong at runtime, on a write, in production. A migration that applies cleanly
-- while its guards are inert is the failure mode this section exists to prevent -- it is
-- exactly what a GENERATED column did to the Phase-1 immutability triggers.
-- =====================================================================================
do $$
declare
  v_missing text;
  v_count   integer;
begin
  -- 8.1 Every table the run-scoped freeze trigger is attached to MUST carry a
  -- metadata_run_id column, because the function reads new.metadata_run_id directly. A
  -- table without it raises "record new has no field metadata_run_id" at runtime, on every
  -- write, while this migration applied perfectly clean.
  select string_agg(t, ', ') into v_missing
  from unnest(array[
    'dcp_metadata_asset','dcp_asset_property_observation',
    'dcp_asset_character_observation','dcp_asset_term_observation'
  ]) as t
  where not exists (
    select 1 from information_schema.columns c
    where c.table_schema = 'plm' and c.table_name = t
      and c.column_name = 'metadata_run_id'
  );
  if v_missing is not null then
    raise exception 'DCP metadata landing self-check FAILED: table(s) % are attached to '
      'plm.dcp_reject_completed_metadata_change but have no metadata_run_id column. The '
      'trigger would raise on every write.', v_missing;
  end if;

  -- 8.2 THE RULE 1 STRUCTURAL ASSERTION. No table in this schema may reference BOTH a
  -- property and a character. That is the shape a property-character bridge would have,
  -- and it is the one mistake this whole design exists to make impossible. Asserted here
  -- so that a future migration adding such a column has to delete this check on purpose,
  -- in a diff a reviewer will see, rather than slipping past unnoticed.
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
    raise exception 'DCP metadata landing self-check FAILED: % table(s) in plm reference '
      'BOTH a property and a character. Properties and characters are two INDEPENDENT sets '
      'and must never be joined -- one asset carries nine properties and one character, so '
      'a bridge fabricates nine relationships the licensor never asserted. See RULE 1 in '
      'migration 20260811050000.', v_count;
  end if;

  -- 8.3 No DCP property-character table may exist under any name.
  select count(*) into v_count
  from information_schema.tables
  where table_schema = 'plm'
    and table_name ~ '^dcp_.*propert.*character|^dcp_.*character.*propert';
  if v_count > 0 then
    raise exception 'DCP metadata landing self-check FAILED: a plm.dcp_* property-character '
      'table exists. No such table may ever be created -- see RULE 1 in migration '
      '20260811050000.';
  end if;

  -- 8.4 The Phase-1 frozen hash must still exist and must NOT have been redefined into a
  -- different signature by anything in this migration. It is a ONE-WAY DOOR over ~155,900
  -- rows and this migration's contract is that it did not touch it.
  select count(*) into v_count
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'plm' and p.proname = 'dcp_asset_row_hash';
  if v_count <> 1 then
    raise exception 'DCP metadata landing self-check FAILED: expected exactly ONE '
      'plm.dcp_asset_row_hash, found %. The Phase-1 row hash is frozen over roughly '
      '155,900 rows; this migration must not add, replace or overload it.', v_count;
  end if;

  -- 8.5 Every one of the eight new tables must have RLS enabled AND a read policy. A
  -- GRANT is not a POLICY; a table with RLS enabled and no policy is unreadable, and a
  -- table with a policy and no RLS is wide open. Both halves are asserted.
  select string_agg(t, ', ') into v_missing
  from unnest(array[
    'dcp_metadata_run','dcp_metadata_asset','dcp_property','dcp_character','dcp_term',
    'dcp_asset_property_observation','dcp_asset_character_observation',
    'dcp_asset_term_observation'
  ]) as t
  where not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'plm' and c.relname = t and c.relrowsecurity
  )
  or not exists (
    select 1 from pg_policies pol
    where pol.schemaname = 'plm' and pol.tablename = t and pol.policyname = t || '_read'
  );
  if v_missing is not null then
    raise exception 'DCP metadata landing self-check FAILED: table(s) % lack row level '
      'security or their read policy.', v_missing;
  end if;

  -- 8.6 service_role must hold NO mutating bit beyond INSERT on any of the eight tables.
  -- TRUNCATE above all: it fires no row trigger, so one TRUNCATE would erase a completed
  -- run's evidence with every section 5 guard silently standing by.
  select string_agg(distinct t || '/' || priv, ', ') into v_missing
  from unnest(array[
    'dcp_metadata_run','dcp_metadata_asset','dcp_property','dcp_character','dcp_term',
    'dcp_asset_property_observation','dcp_asset_character_observation',
    'dcp_asset_term_observation'
  ]) as t,
  unnest(array['UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) as priv
  where has_table_privilege('service_role', 'plm.' || quote_ident(t), priv);
  if v_missing is not null then
    raise exception 'DCP metadata landing self-check FAILED: service_role still holds '
      'mutating privileges: %. TRUNCATE in particular fires NO row triggers, so every '
      'immutability guarantee in section 5 depends on these revokes.', v_missing;
  end if;

  raise notice 'DCP metadata landing self-checks passed: 8 tables, RLS + policies present, '
    'no property-character bridge, Phase-1 frozen hash untouched, service_role holds no '
    'mutating bit beyond INSERT.';
end;
$$;
