begin;

-- Physically separate DCP Vault landing families
-- Existing plm.dcp_* objects remain the Disney-only compatibility family.

-- The existing family already contains Disney-only evidence. Prove that structural fact
-- without exposing row values, then lock it in while preserving every row and function signature.
do $$
declare
  v_mismatch_count bigint;
  v_table text;
begin
  foreach v_table in array array[
    'dcp_crawl', 'dcp_portal_tile', 'dcp_style_guide', 'dcp_asset',
    'dcp_property', 'dcp_character', 'dcp_term'
  ] loop
    execute format(
      'select count(*) from plm.%I where source_system is distinct from %L',
      v_table, 'disney_dcpvault'
    ) into v_mismatch_count;
    if v_mismatch_count <> 0 then
      raise exception 'Disney DCP compatibility constraint refused: % rows in % have a non-Disney source discriminator.',
        v_mismatch_count, v_table using errcode = 'P0001';
    end if;
  end loop;
end
$$;

alter table plm.dcp_crawl add constraint dcp_crawl_disney_source_chk
  check (source_system = 'disney_dcpvault') not valid;
alter table plm.dcp_portal_tile add constraint dcp_portal_tile_disney_source_chk
  check (source_system = 'disney_dcpvault') not valid;
alter table plm.dcp_style_guide add constraint dcp_style_guide_disney_source_chk
  check (source_system = 'disney_dcpvault') not valid;
alter table plm.dcp_asset add constraint dcp_asset_disney_source_chk
  check (source_system = 'disney_dcpvault') not valid;
alter table plm.dcp_property add constraint dcp_property_disney_source_chk
  check (source_system = 'disney_dcpvault') not valid;
alter table plm.dcp_character add constraint dcp_character_disney_source_chk
  check (source_system = 'disney_dcpvault') not valid;
alter table plm.dcp_term add constraint dcp_term_disney_source_chk
  check (source_system = 'disney_dcpvault') not valid;

alter table plm.dcp_crawl validate constraint dcp_crawl_disney_source_chk;
alter table plm.dcp_portal_tile validate constraint dcp_portal_tile_disney_source_chk;
alter table plm.dcp_style_guide validate constraint dcp_style_guide_disney_source_chk;
alter table plm.dcp_asset validate constraint dcp_asset_disney_source_chk;
alter table plm.dcp_property validate constraint dcp_property_disney_source_chk;
alter table plm.dcp_character validate constraint dcp_character_disney_source_chk;
alter table plm.dcp_term validate constraint dcp_term_disney_source_chk;

-- Lucasfilm DCP Vault
-- =====================================================================================
-- Disney Lucasfilm DCP Vault -- source-observation landing schema.
--
-- Migration: 20260810190000_lucasfilm_dcp_vault_source_landing.sql
-- Issue:     u2giants/shared-db #665. Object claim: #725 -- this migration owns the
--            plm.lucasfilm_dcp_* namespace and touches NOTHING else.
-- Design:    licensor-source-data-disney/disney-dcpvault/
--            NORMALIZED-database-schema-design-20260810.md (PRIVATE repo).
-- Pattern:   20260810020000 (Paramount landing: privilege predicate, immutability
--            triggers, capture freeze), 20260810110000 (Warner: the PostgreSQL 17
--            revoke set and the RLS read gate), 20260807190000 (the read gate's origin).
-- Follows:   20260810190100 completes this build with the chunked loader protocol.
--            The two are bound by a co-presence rule in
--            scripts/production_migration_guard.py: 20260810190100 may not be promoted
--            without this migration.
--
-- SCHEMA ONLY. THIS MIGRATION LOADS NO DATA.
--
-- -------------------------------------------------------------------------------------
-- CONFIDENTIALITY. u2giants/shared-db is a PUBLIC repository. The Lucasfilm DCP Vault extract is
-- licensor-confidential Disney data held in the PRIVATE repository
-- u2giants/licensor-source-data-disney. Not one Disney tile slug, property name,
-- franchise, style-guide folder, region, DAM path, file name or portal URL appears in
-- this file, in any comment, in any CHECK constraint, in any error message, or in the
-- contract test. Only COUNTS and SCHEMA appear, which design section 9 permits.
--     SCHEMA IN GIT. DATA OUT OF GIT.
-- Error messages below report counts and identifiers, never source values, because this
-- database's logs are not private either.
--
-- =====================================================================================
-- SECTION -1. THE FIVE DECISIONS THAT DIVERGE FROM THE DESIGN DOCUMENT, AND WHY
-- =====================================================================================
--
-- DECISION 1 -- SCHEMA AND NAMING: plm.lucasfilm_dcp_*, NOT ingest.portal_*.
--   The design places these tables in an `ingest` schema under licensor-generic names
--   (portal_asset, portal_tile, ...). Overruled by owner ruling, for three reasons that
--   are recorded here so a future reader does not "restore" the design:
--
--   (a) PRECEDENT. Every prior licensor lands in plm.<prefix>_*: plm.pmt_* (Paramount,
--       20260810020000), plm.wb_* (Warner, 20260810030000), plm.nbcu_* (20260810070000),
--       plm.opa_* (Disney OPA, 20260807170000). A fifth licensor in a different schema
--       under a different naming convention would be the only one, and every generic
--       tool in this repo that enumerates landing tables keys on plm.
--
--   (b) THE DEFAULT-PRIVILEGE HOLE (issue #649). VERIFIED LIVE on 2026-08-10 by a
--       read-only Management API SELECT against pg_default_acl on BOTH projects
--       (production qsllyeztdwjgirsysgai and preview rjyboqwcdzcocqgmsyel, both
--       PostgreSQL 17.6). BOTH schemas currently read:
--           schema ingest, objtype r, acl {service_role=arwdDxtm/postgres}
--           schema plm,    objtype r, acl {service_role=arwdDxtm/postgres}
--       `arwdDxtm` is all eight table bits -- INSERT, SELECT, UPDATE, DELETE, TRUNCATE,
--       REFERENCES, TRIGGER and (PG17) MAINTAIN. A table created in EITHER schema is
--       BORN holding TRUNCATE for service_role, and TRUNCATE DOES NOT FIRE ROW TRIGGERS,
--       which would void every immutability guarantee in section 6 below with one
--       statement.
--
--       CORRECTION TO THE DISPATCH, RECORDED HONESTLY. The ruling that authorised this
--       migration stated that 20260810180000 has already narrowed `plm`, so plm tables
--       inherit the fix while ingest tables do not. The live read above shows
--       20260810180000 IS NOT YET APPLIED to production or to preview -- `plm` still
--       carries the full arwdDxtm default today. So the inheritance argument is a FUTURE
--       property, not a present one, and this migration DOES NOT RELY ON IT. Section 7
--       revokes the complete PostgreSQL 17 set explicitly on every table it creates,
--       immediately after creating it, and would be correct even if 20260810180000 were
--       never promoted. Reason (b) still favours plm over ingest -- plm is the schema
--       the fix is coming to and ingest is not -- but it is a tie-breaker here, not the
--       load-bearing protection. The load-bearing protection is section 7.
--
--   (c) NAMESPACE. `ingest.portal_asset` squats a licensor-generic name in a shared
--       schema. The next portal to land would have to either share these tables or pick
--       a worse name. #665's own direction is per-licensor landing.
--
-- DECISION 2 -- NO api.* VIEWS, DELIBERATELY.
--   Paramount ships 8 api.pmt_* views; this build ships ZERO, and that is a CHOICE, not
--   an omission. No application reads Lucasfilm DCP Vault data today: there is no PopDAM screen, no
--   dflow screen and no report behind it. An api view is a published read contract that
--   must then be versioned and kept stable forever, and publishing one before a caller
--   exists fixes a shape nobody has validated. When the first reader appears, it brings
--   its required columns with it and the view is authored then, in its own migration.
--   Until then plm.lucasfilm_dcp_* is reachable directly by the approved roles under section 8's
--   RLS gate. THIS SENTENCE EXISTS SO NOBODY LATER READS THE ABSENCE AS AN OVERSIGHT.
--
-- DECISION 3 -- crawl_section_id IS NULLABLE, AND THAT IS THE HONEST SIGNAL.
--   Design section 4.8 makes crawl_section_id the "exact query that proved the link" and
--   also warns against manufacturing a cross-product from an already-aggregated row.
--   Those two requirements collide on the CSV that exists today: that file is ALREADY
--   AGGREGATED -- one row per DAM path carrying a pipe-joined tile list and two boolean
--   listing flags -- so the specific portal query that returned each tile/file pair was
--   not preserved and CANNOT be reconstructed. Writing a section id anyway would
--   manufacture exactly the false precision 4.8 forbids; making the column NOT NULL would
--   make the backfill unloadable.
--   RESOLUTION: crawl_section_id is NULLABLE, paired with a NOT NULL `link_evidence`
--   column and a CHECK that binds the two (section 5.6). 'section_query' REQUIRES a
--   section id; 'aggregated_row' REQUIRES the id to be NULL. The first load therefore
--   records, in the data itself, that it holds lower-fidelity truth than a future
--   section-aware crawl, and a consumer that needs proven provenance filters on
--   link_evidence = 'section_query'. The alternative -- a NOT NULL column filled with a
--   synthetic "CSV backfill" section -- would have made the two grades indistinguishable
--   forever.
--
-- DECISION 4 -- file_extension IS A PLAIN LOADER-COMPUTED COLUMN, NOT GENERATED.
--   A `GENERATED ... STORED` column is populated by PostgreSQL AFTER all BEFORE-row
--   triggers have run. Every immutability trigger in section 6 is a BEFORE trigger, so it
--   would read NULL for a generated file_extension on every row, compare NULL to NULL,
--   never fire -- and the migration would apply perfectly clean while the guard did
--   nothing. The column is therefore plain, computed by the loader, and constrained by
--   CHECK to the lowercase, dot-free shape the design requires.
--
-- DECISION 5 -- NO CHANGE TO dam.style_guide_file.
--   Design section 5 and change 7 ask for a nullable dam.style_guide_file.style_guide_id
--   before promotion. Confirmed live on both projects that the column does not exist
--   today. It is OUT OF SCOPE here by owner ruling: it alters a SHARED table PopDAM
--   reads, it is on a different review track, and nothing in this landing schema needs
--   it. THIS MIGRATION CREATES NO PROMOTION PATH AT ALL -- see the reconciliation
--   boundary below.
--
-- -------------------------------------------------------------------------------------
-- RECONCILIATION BOUNDARY. Nothing here creates, renames, merges, reparents, deactivates
-- or deletes a canonical core.* or dam.* record. The nullable core_property_id and
-- core_style_guide_id pointers are READ-ONLY reconciliation columns, NULL at landing,
-- always, and set only by a later reviewed decision. Specifically, per design section 3:
--   * A portal tile is NOT a property. Nothing here may write tile text into
--     core.property, and there is no function in this migration that could.
--   * This extract captured NO file-to-character relationship. No character table, no
--     character link table, and no character column is created. Do not add one from this
--     source.
-- =====================================================================================

-- =====================================================================================
-- SECTION 0. The privilege predicate.
--
-- THE NULL-PERMISSIVE TRAP THIS AVOIDS. This shape is FORBIDDEN:
--     if not ( ... or auth.role() = 'service_role' ) then raise ...
-- Inside a migration auth.role() is NULL. `NULL = 'service_role'` is NULL, `false or NULL`
-- is NULL, and `if not NULL then` NEVER RUNS THE BODY. The guard reads strict and behaves
-- wide open. Contract: TRUE only on a NON-NULL, NON-EMPTY, POSITIVELY MATCHED identity.
--
-- It is a FUNCTION and not a DO block precisely so a contract test can CALL it and prove
-- the NULL case is rejected; an anonymous block never lands in pg_proc and cannot be
-- tested. It takes SESSION_USER, not CURRENT_USER: SECURITY DEFINER rewrites current_user
-- to the function owner, so a current_user check inside a definer function always passes
-- and guards nothing.
-- =====================================================================================
create or replace function plm.lucasfilm_dcp_loader_privilege_ok(
  p_role         text,
  p_session_user text
)
returns boolean
language sql
immutable
-- Pinned even though this is NOT a SECURITY DEFINER function and calls only builtins.
-- An IMMUTABLE function with an unpinned search_path is the shape that becomes a problem
-- the day someone adds a schema-qualified callee to it, and pinning costs nothing today.
set search_path = pg_catalog
as $$
  select
    (p_role is not null and btrim(p_role) = 'service_role')
    or
    (p_session_user is not null
     and btrim(p_session_user) in ('postgres', 'supabase_admin'));
$$;

comment on function plm.lucasfilm_dcp_loader_privilege_ok(text, text) is
'Privilege predicate for the Disney Lucasfilm DCP Vault loader. TRUE only for a NON-NULL, '
'positively matched identity: JWT role service_role, or session_user postgres/'
'supabase_admin. NULL or empty on BOTH arguments returns FALSE -- which is the case that '
'holds inside a migration, where auth.role() is NULL. Written as a callable function '
'rather than a DO block so a contract test can prove the NULL case is rejected.';

revoke all on function plm.lucasfilm_dcp_loader_privilege_ok(text, text) from public;
grant execute on function plm.lucasfilm_dcp_loader_privilege_ok(text, text) to authenticated, service_role;

-- =====================================================================================
-- SECTION 1. THE FROZEN CANONICAL ROW-HASH SERIALIZATION
--
-- ***** THIS SPECIFICATION IS FROZEN. IT IS A ONE-WAY DOOR. *****
--
-- plm.lucasfilm_dcp_asset_crawl.observed_row_hash is the ONLY mechanism that detects a changed row
-- between crawls. Once roughly 155,900 rows carry a hash, changing ANY detail of this
-- serialization -- the field list, their order, the separators, the null encoding, the
-- sort collation, the text encoding, the case handling -- invalidates every stored hash
-- at once. Every asset then compares unequal on the next crawl, change detection reports
-- a total rewrite that never happened, and the only correction is a FULL RE-CAPTURE of
-- the entire portal. The design mandated "a documented canonical serialization" and never
-- documented one; this section is that document, and it is normative.
--
-- DO NOT "optimise", "tidy", "simplify" or "modernise" plm.lucasfilm_dcp_asset_row_hash. If a new
-- field must enter the hash, that is a NEW function under a NEW name and a NEW column,
-- with an explicit re-hash plan. Never a redefinition of this one.
--
-- -------------------------------------------------------------------------------------
-- THE SPECIFICATION, IN FULL
-- -------------------------------------------------------------------------------------
-- observed_row_hash = lower(encode(sha256(convert_to(S, 'UTF8')), 'hex'))
--   -- exactly 64 lowercase hexadecimal characters.
--
-- S is the concatenation of EXACTLY EIGHT slots, in EXACTLY this order, with NO other
-- content before, between or after them:
--
--   slot 1  source_system            -- as stored on plm.lucasfilm_dcp_asset
--   slot 2  source_path              -- the full DAM path, verbatim as stored
--   slot 3  file_name                -- verbatim as stored
--   slot 4  file_extension           -- as STORED, i.e. already lowercased, no dot
--   slot 5  relative_folder_path     -- as stored; NULL is a real and expected value
--   slot 6  style_guide_source_path  -- the owning guide's full source path, as stored
--   slot 7  style_guide_source_id    -- the Disney guide id, as stored; NULL is expected
--   slot 8  tile_key_list            -- see TILE LIST below
--
-- EACH SLOT is emitted as three parts, in order:
--     presence_flag || value_text || U+001F
--   * presence_flag is the single ASCII character '+' when the value IS NOT NULL, and
--     '-' when the value IS NULL.
--   * value_text is the empty string when the value is NULL, and the value's exact
--     characters otherwise. No trimming, no case folding, no normalisation, no escaping.
--   * U+001F (ASCII 31, UNIT SEPARATOR) terminates EVERY slot INCLUDING THE EIGHTH.
--     A terminator on the last slot is deliberate: without it a trailing NULL or empty
--     value would be indistinguishable from an absent slot.
--
--   The presence flag is what makes NULL and the empty string DIFFERENT inputs. A scheme
--   that renders NULL as '' collides the two, and both occur in this data (design section
--   2 records one row with a blank folder subpath, and 88,125 files with no guide id).
--
-- CASE, AND WHERE NORMALISATION IS ALLOWED TO LIVE: every slot is hashed exactly AS
--   STORED. There is NO case folding and NO trimming anywhere in the serialization.
--   Loaders may of course normalise a value BEFORE storing it -- lowercasing an extension,
--   trimming a tile key, folding a blank folder path to NULL -- and the hash then digests
--   that stored result. file_extension is lowercase in the hash ONLY because the loader
--   stores it lowercase (a CHECK constraint enforces that), not because the hash
--   lowercases it. THE RULE THAT MATTERS: the hash never sees an input value that differs
--   from what the database holds. A caller that passes a row's raw input instead of the
--   value the upsert actually left behind has violated this specification even though the
--   function will happily hash it -- the two diverge exactly where the loader declined to
--   overwrite a stored value, which is precisely the case worth detecting.
--
-- TILE LIST (slot 8): the SET of plm.lucasfilm_dcp_portal_tile.source_key values ACTUALLY LINKED to
--   this asset in THIS crawl -- that is, read back from plm.lucasfilm_dcp_asset_tile_observation
--   after the links have been written, never taken from an input row's tile list before
--   they were. Duplicates removed, sorted ASCENDING using the `C` COLLATION (raw byte
--   order), and joined with a single U+001E (ASCII 30, RECORD SEPARATOR) between adjacent
--   elements, with NO leading or trailing U+001E. The distinction is not academic: a row
--   whose links are deliberately withheld (both listing flags set on an aggregated row)
--   must hash with NO tiles, because no tiles were linked.
--   * The `C` collation is REQUIRED and is not incidental. The database's default
--     collation is locale-dependent and can order the same two strings differently on a
--     different server or after a libc upgrade; a locale-sorted list would silently
--     change the hash of unchanged data. Byte order is stable forever.
--   * An asset with NO tiles in the crawl passes an EMPTY ARRAY, which serialises to
--     presence flag '+' and an empty value_text. It is NOT NULL. Passing NULL here means
--     "the tile set was not observed", which is a different fact and hashes differently.
--
-- SEPARATOR SAFETY: U+001F and U+001E are C0 control characters that cannot occur in a
--   DAM path, file name or tile slug. Rather than trust that, the function REFUSES any
--   input containing either character. Escaping was rejected on purpose: an escape rule
--   is a second thing that can be implemented differently by a future re-implementation,
--   and a hard refusal cannot be got wrong. A refused row is a load exception, not a
--   silently different hash.
--
-- WHY THE HASH IS COMPUTED IN THE DATABASE AND NOT BY THE LOADER: so there is exactly ONE
--   implementation of this specification, in one place, callable and testable. A loader
--   that computed it in JavaScript would be a second implementation, and two
--   implementations of a frozen scheme is how a frozen scheme stops being frozen.
-- =====================================================================================
create or replace function plm.lucasfilm_dcp_asset_row_hash(
  p_source_system           text,
  p_source_path             text,
  p_file_name               text,
  p_file_extension          text,
  p_relative_folder_path    text,
  p_style_guide_source_path text,
  p_style_guide_source_id   text,
  p_tile_keys               text[]
)
returns text
language plpgsql
immutable
-- Pinned for the same reason as plm.lucasfilm_dcp_loader_privilege_ok above: not definer, builtins
-- only today, but this is the FROZEN hash and it must never become resolution-dependent.
set search_path = pg_catalog
as $$
declare
  v_us   constant text := chr(31);   -- UNIT SEPARATOR, slot terminator
  v_rs   constant text := chr(30);   -- RECORD SEPARATOR, tile-list joiner
  v_slots text[] := array[
    p_source_system, p_source_path, p_file_name, p_file_extension,
    p_relative_folder_path, p_style_guide_source_path, p_style_guide_source_id
  ];
  v_s    text := '';
  v_tile text;
  v_join text;
  v      text;
  i      integer;
begin
  -- Separator safety, checked BEFORE any concatenation, on every slot and every tile key.
  for i in 1 .. array_length(v_slots, 1) loop
    v := v_slots[i];
    if v is not null and (position(v_us in v) > 0 or position(v_rs in v) > 0) then
      raise exception 'DCP row hash refused: field % contains a reserved separator '
        '(U+001F or U+001E). The canonical serialization does not escape; such a row must '
        'be recorded in plm.lucasfilm_dcp_load_exception instead. No value is echoed here because '
        'this database''s logs are not private.', i using errcode = 'P0001';
    end if;
    v_s := v_s || (case when v is null then '-' else '+' end) || coalesce(v, '') || v_us;
  end loop;

  -- Slot 8. NULL array means "tile set not observed" and is NOT the same as an empty set.
  if p_tile_keys is null then
    v_s := v_s || '-' || v_us;
  else
    foreach v_tile in array p_tile_keys loop
      if v_tile is null then
        raise exception 'DCP row hash refused: the tile key array contains a NULL element. '
          'Pass an empty array for "no tiles", or NULL for "not observed"; a NULL element '
          'is neither and has no defined serialization.' using errcode = 'P0001';
      end if;
      if position(v_us in v_tile) > 0 or position(v_rs in v_tile) > 0 then
        raise exception 'DCP row hash refused: a tile key contains a reserved separator '
          '(U+001F or U+001E).' using errcode = 'P0001';
      end if;
    end loop;

    -- DISTINCT, then ORDER BY ... COLLATE "C". Both are load-bearing; see the spec above.
    select coalesce(string_agg(k, v_rs order by k collate "C"), '')
      into v_join
      from (select distinct unnest(p_tile_keys) as k) d;

    v_s := v_s || '+' || v_join || v_us;
  end if;

  return lower(encode(sha256(convert_to(v_s, 'UTF8')), 'hex'));
end;
$$;

comment on function plm.lucasfilm_dcp_asset_row_hash(text, text, text, text, text, text, text, text[]) is
'THE FROZEN canonical row-hash serialization for plm.lucasfilm_dcp_asset_crawl.observed_row_hash. '
'sha256, lowercase hex, over UTF-8 bytes of eight slots in a fixed order, each emitted as '
'presence-flag (''+'' present / ''-'' NULL) then the verbatim value then U+001F -- '
'terminator included on the last slot. Slot 8 is the crawl''s tile-key SET: deduplicated, '
'sorted with COLLATE "C" (byte order, locale-proof), joined with U+001E; an empty array is '
'"no tiles" and NULL is "not observed", and they hash differently. No case folding, no '
'trimming, no escaping -- a value containing a reserved separator is REFUSED so it becomes '
'a load exception rather than a silently different hash. THIS IS A ONE-WAY DOOR: about '
'155,900 rows will carry these hashes, and changing any detail invalidates all of them and '
'forces a full re-capture. Never redefine this function. A new field means a NEW function, '
'a NEW column and an explicit re-hash plan. The full normative specification is in '
'section 1 of migration 20260810190000.';

revoke all on function plm.lucasfilm_dcp_asset_row_hash(text, text, text, text, text, text, text, text[]) from public;
grant execute on function plm.lucasfilm_dcp_asset_row_hash(text, text, text, text, text, text, text, text[])
  to authenticated, service_role;

-- =====================================================================================
-- SECTION 2. plm.lucasfilm_dcp_crawl -- one row per scrape run (design 4.1)
--
-- PROVENANCE ONLY. No asset data lives on this row.
-- =====================================================================================
create table plm.lucasfilm_dcp_crawl (
  crawl_id                uuid primary key default gen_random_uuid(),

  source_system           text not null default 'lucasfilm_dcpvault' check (source_system = 'lucasfilm_dcpvault'),
  status                  text not null default 'planned',

  -- The SNAPSHOT date, supplied EXPLICITLY by the caller and never derived from now().
  -- This server runs America/New_York: a midnight-UTC timestamptz read back through
  -- ::date lands on the PREVIOUS day and would silently misdate the capture. Any
  -- timestamptz on these tables that is later compared as a date must be pinned to
  -- midday UTC by its writer for the same reason.
  captured_on             date not null,

  portal_base_url         text not null,          -- ORIGIN ONLY. Never a signed URL.
  crawler_version         text not null,
  account_scope           text not null,          -- non-secret entitlement description
  line_of_business        text not null,

  started_at              timestamptz not null,
  finished_at             timestamptz null,

  -- Declared UP FRONT by the loader from the extract manifest. finalize refuses unless
  -- the landed counts match. Deriving them at the end would let a truncated extract
  -- define its own expectation and certify itself.
  rows_received           integer null,
  distinct_assets_received integer null,

  captured_by             text not null,
  private_source_commit   text not null,
  failure_message         text null,
  notes                   text null,
  metadata                jsonb not null default '{}'::jsonb,

  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  constraint lucasfilm_dcp_crawl_status_chk
    check (status in ('planned','running','partial','complete','failed')),
  constraint lucasfilm_dcp_crawl_source_system_chk check (source_system = 'lucasfilm_dcpvault'),
  constraint lucasfilm_dcp_crawl_base_url_chk       check (btrim(portal_base_url) <> ''),
  constraint lucasfilm_dcp_crawl_crawler_version_chk check (btrim(crawler_version) <> ''),
  constraint lucasfilm_dcp_crawl_account_scope_chk  check (btrim(account_scope) <> ''),
  constraint lucasfilm_dcp_crawl_lob_chk            check (btrim(line_of_business) <> ''),
  constraint lucasfilm_dcp_crawl_captured_by_chk    check (btrim(captured_by) <> ''),
  constraint lucasfilm_dcp_crawl_commit_chk         check (btrim(private_source_commit) <> ''),
  constraint lucasfilm_dcp_crawl_counts_chk check (
    (rows_received is null or rows_received >= 0)
    and (distinct_assets_received is null or distinct_assets_received >= 0)
  ),

  -- COMPLETE is the strongest claim this schema can make, so each part of it is a CHECK
  -- and not a convention. Section completeness and gap closure are enforced by
  -- plm.finalize_lucasfilm_dcp_crawl (20260810190100) because they are set-level facts a row CHECK
  -- cannot see; what a row CHECK CAN prove is asserted here so finalize cannot fake it.
  constraint lucasfilm_dcp_crawl_complete_requires_evidence_chk check (
    status <> 'complete'
    or (
      finished_at is not null
      and rows_received is not null
      and distinct_assets_received is not null
      and failure_message is null
    )
  ),
  constraint lucasfilm_dcp_crawl_failed_requires_message_chk check (
    status <> 'failed' or btrim(coalesce(failure_message, '')) <> ''
  )
);

create index idx_lucasfilm_dcp_crawl_status on plm.lucasfilm_dcp_crawl (status, started_at desc);
create index idx_lucasfilm_dcp_crawl_latest_complete
  on plm.lucasfilm_dcp_crawl (captured_on desc, crawl_id desc) where status = 'complete';

comment on table plm.lucasfilm_dcp_crawl is
'One row per Disney Lucasfilm DCP Vault scrape run. PROVENANCE ONLY -- no asset data lives here. '
'CRAWL-VERSIONED: every completed crawl is retained permanently and a refresh is a NEW '
'crawl_id, never an edit of an old one. SCOPE: POP Creations'' licensed Lucasfilm DCP Vault account '
'and the portal''s CURRENT view. PRESENCE IS EVIDENCE; ABSENCE IS NOT A DELETE INSTRUCTION '
'AND NOT PROOF OF NONEXISTENCE. A crawl reaches status = complete only through '
'plm.finalize_lucasfilm_dcp_crawl, which additionally requires every section complete and every gap '
'resolved or waived -- set-level facts no row CHECK can see. Licensor-confidential data: '
'never publish a row and NEVER commit one to this PUBLIC repository.';
comment on column plm.lucasfilm_dcp_crawl.captured_on is
'The SNAPSHOT date, supplied explicitly and NEVER derived from now(). The server runs '
'America/New_York, so a midnight-UTC timestamp read through ::date lands on the previous '
'day and would misdate the crawl by one day, silently.';
comment on column plm.lucasfilm_dcp_crawl.portal_base_url is
'ORIGIN ONLY (scheme + host). Never a signed download URL, never a session-bearing URL, '
'never a query string carrying a token.';
comment on column plm.lucasfilm_dcp_crawl.rows_received is
'INPUT rows the extract claims to carry, declared UP FRONT from its manifest. Legitimately '
'EXCEEDS distinct_assets_received: the extract contains exact duplicate rows for the same '
'DAM path, which are collapsed on load. The difference is not loss.';
comment on column plm.lucasfilm_dcp_crawl.distinct_assets_received is
'DISTINCT DAM paths the extract claims to carry, declared UP FRONT. finalize compares it '
'to what actually landed and refuses on a mismatch.';

-- =====================================================================================
-- SECTION 3. plm.lucasfilm_dcp_portal_tile -- the portal browsing tiles (design 4.4)
--
-- Called a PORTAL TILE, never a property or a franchise. The extract proves a browse
-- category and nothing more (design section 3). There is deliberately NO allow-list
-- CHECK on source_key: see the completeness note on plm.lucasfilm_dcp_crawl_section.
--
-- STABLE IDENTITY table: rows outlive any one crawl. first/last_seen_crawl_id are
-- convenience pointers and are ON DELETE SET NULL, so deleting an unpromoted crawl leaves
-- the identity standing (design section 7).
-- =====================================================================================
create table plm.lucasfilm_dcp_portal_tile (
  id                  uuid primary key default gen_random_uuid(),
  source_system       text not null default 'lucasfilm_dcpvault' check (source_system = 'lucasfilm_dcpvault'),
  source_key          text not null,
  display_label       text null,
  source_url          text null,

  first_seen_crawl_id uuid null references plm.lucasfilm_dcp_crawl(crawl_id) on delete set null,
  last_seen_crawl_id  uuid null references plm.lucasfilm_dcp_crawl(crawl_id) on delete set null,

  -- READ-ONLY reconciliation pointer. NULL at landing, ALWAYS. A tile is NOT proven to be
  -- a canonical property; only an explicit reviewed mapping may ever set this.
  core_property_id    uuid null references core.property(id) on delete restrict,
  resolution_status   text not null default 'unresolved',
  resolution_reason   text null,
  resolved_at         timestamptz null,
  resolved_by         text null,

  raw                 jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint lucasfilm_dcp_portal_tile_source_key_chk check (btrim(source_key) <> ''),
  constraint lucasfilm_dcp_portal_tile_unique unique (source_system, source_key),
  constraint lucasfilm_dcp_portal_tile_resolution_status_chk check (
    resolution_status in ('unresolved','matched','ambiguous','no_match','rejected')
  ),
  -- A resolved pointer without a status, or a matched status without a pointer, is a
  -- half-finished decision. Neither may sit in the table looking settled.
  constraint lucasfilm_dcp_portal_tile_resolution_coherent_chk check (
    (resolution_status = 'matched') = (core_property_id is not null)
  )
);

comment on table plm.lucasfilm_dcp_portal_tile is
'One row per Disney Lucasfilm DCP Vault portal BROWSING TILE. A TILE IS NOT A PROPERTY AND NOT A '
'FRANCHISE -- the extract proves only that the portal listed a file under a browse '
'category. Nothing may write tile text into core.property, and core_property_id is a '
'read-only pointer that stays NULL until an explicit reviewed mapping sets it. '
'Deliberately carries NO allow-list of tile keys: the portal exposes more tiles than any '
'one partial crawl observes, and a CHECK pinned to what one checkpoint saw would reject '
'the rest of the portal on the next crawl.';

-- =====================================================================================
-- SECTION 4. plm.lucasfilm_dcp_style_guide -- one row per guide path (design 4.5)
--
-- Identity is the FULL SOURCE PATH, never coalesce(source_guide_id, folder_name): folder
-- names repeat across region/year contexts, and a later id backfill would change the
-- value of such an expression and re-key existing rows.
-- =====================================================================================
create table plm.lucasfilm_dcp_style_guide (
  id                  uuid primary key default gen_random_uuid(),
  source_system       text not null default 'lucasfilm_dcpvault' check (source_system = 'lucasfilm_dcpvault'),
  source_path         text not null,
  source_guide_id     text null,
  folder_name         text not null,
  region              text not null,
  year_segment        text not null,
  parent_source_path  text null,

  first_seen_crawl_id uuid null references plm.lucasfilm_dcp_crawl(crawl_id) on delete set null,
  last_seen_crawl_id  uuid null references plm.lucasfilm_dcp_crawl(crawl_id) on delete set null,

  -- READ-ONLY reconciliation pointer into the canonical taxonomy. NULL at landing, always.
  -- ON DELETE RESTRICT, never CASCADE: a canonical guide disappearing must not silently
  -- delete the source observation that a promotion was traced through.
  core_style_guide_id uuid null references core.style_guide(id) on delete restrict,
  resolution_status   text not null default 'unresolved',
  resolution_reason   text null,
  resolved_at         timestamptz null,
  resolved_by         text null,

  raw                 jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint lucasfilm_dcp_style_guide_source_path_chk check (btrim(source_path) <> ''),
  constraint lucasfilm_dcp_style_guide_folder_name_chk check (btrim(folder_name) <> ''),
  constraint lucasfilm_dcp_style_guide_region_chk      check (btrim(region) <> ''),
  -- year_segment is TEXT and stays text: a non-numeric "no year" marker is a valid value
  -- in this source and an integer column could not hold it.
  constraint lucasfilm_dcp_style_guide_year_chk        check (btrim(year_segment) <> ''),
  -- A blank guide id is not an id. Store NULL, so the partial unique index below means
  -- what it says.
  constraint lucasfilm_dcp_style_guide_guide_id_chk
    check (source_guide_id is null or btrim(source_guide_id) <> ''),
  constraint lucasfilm_dcp_style_guide_unique unique (source_system, source_path),
  constraint lucasfilm_dcp_style_guide_resolution_status_chk check (
    resolution_status in ('unresolved','matched','ambiguous','no_match','rejected')
  ),
  constraint lucasfilm_dcp_style_guide_resolution_coherent_chk check (
    (resolution_status = 'matched') = (core_style_guide_id is not null)
  )
);

-- Partial unique on the real Disney id. Measured safe for this extract: zero source ids
-- map to more than one guide context. It is PARTIAL because most files carry no id at
-- all, and a plain unique would collapse every id-less guide into one row.
create unique index uq_lucasfilm_dcp_style_guide_source_guide_id
  on plm.lucasfilm_dcp_style_guide (source_system, source_guide_id)
  where source_guide_id is not null;

create index idx_lucasfilm_dcp_style_guide_folder_name on plm.lucasfilm_dcp_style_guide (folder_name);
create index idx_lucasfilm_dcp_style_guide_region_year on plm.lucasfilm_dcp_style_guide (region, year_segment);

comment on table plm.lucasfilm_dcp_style_guide is
'One row per Disney Lucasfilm DCP Vault guide FOLDER PATH. IDENTITY IS THE FULL SOURCE PATH. Never '
're-key this on coalesce(source_guide_id, folder_name): folder names are reused across '
'region/year contexts, and a later id backfill would change that expression''s value and '
'silently re-identify existing rows. The Disney guide id, when present, is enforced unique '
'by a PARTIAL index -- most guides have no id, and a plain unique would collapse them all. '
'year_segment is TEXT because a non-numeric "no year" marker is a legitimate value. '
'core_style_guide_id is a read-only reconciliation pointer, NULL at landing; tile '
'membership may NEVER be used to infer it.';
comment on column plm.lucasfilm_dcp_style_guide.parent_source_path is
'Populated ONLY where the portal actually proves nesting. Never inferred by trimming a '
'path segment: a guessed hierarchy is indistinguishable from an observed one once stored.';

-- =====================================================================================
-- SECTION 5. The file identity, its crawl membership, its tile links, and the exceptions
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- 5.1 plm.lucasfilm_dcp_asset -- one row per Disney file identity (design 4.6)
-- -------------------------------------------------------------------------------------
create table plm.lucasfilm_dcp_asset (
  id                    uuid primary key default gen_random_uuid(),
  source_system         text not null default 'lucasfilm_dcpvault' check (source_system = 'lucasfilm_dcpvault'),
  source_path           text not null,

  style_guide_id        uuid not null references plm.lucasfilm_dcp_style_guide(id) on delete restrict,

  file_name             text not null,

  -- PLAIN COLUMN, COMPUTED BY THE LOADER. NOT `GENERATED ... STORED` -- see DECISION 4 in
  -- the header. PostgreSQL populates a generated column AFTER every BEFORE-row trigger
  -- runs, so the section 6 immutability triggers would read NULL here on every row, never
  -- fire, and leave a guard that applies cleanly and protects nothing.
  file_extension        text null,

  relative_folder_path  text null,
  source_asset_id       text null,
  file_size_bytes       bigint null,
  content_type          text null,
  checksum              text null,

  first_seen_crawl_id   uuid null references plm.lucasfilm_dcp_crawl(crawl_id) on delete set null,
  last_seen_crawl_id    uuid null references plm.lucasfilm_dcp_crawl(crawl_id) on delete set null,

  raw                   jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint lucasfilm_dcp_asset_source_path_chk check (btrim(source_path) <> ''),
  constraint lucasfilm_dcp_asset_file_name_chk   check (btrim(file_name) <> ''),
  -- Lowercase, no dot, non-blank when present. This is the shape the frozen hash slot 4
  -- assumes, so it is enforced rather than trusted.
  constraint lucasfilm_dcp_asset_file_extension_chk check (
    file_extension is null
    or (file_extension = lower(file_extension)
        and btrim(file_extension) = file_extension
        and file_extension <> ''
        and position('.' in file_extension) = 0)
  ),
  -- A blank relative folder path is a real observed value in this source; it is stored as
  -- NULL so "no subpath" has exactly one representation and cannot hash two ways.
  constraint lucasfilm_dcp_asset_relative_folder_chk
    check (relative_folder_path is null or btrim(relative_folder_path) <> ''),
  constraint lucasfilm_dcp_asset_size_chk check (file_size_bytes is null or file_size_bytes >= 0),
  constraint lucasfilm_dcp_asset_unique unique (source_system, source_path)
);

-- Design 4.6: index the guide link, the lowercased file name and the extension.
-- NEVER add a unique rule to file_name -- thousands of distinct DAM paths share one name.
create index idx_lucasfilm_dcp_asset_style_guide on plm.lucasfilm_dcp_asset (style_guide_id);
create index idx_lucasfilm_dcp_asset_file_name_lower on plm.lucasfilm_dcp_asset (lower(file_name));
create index idx_lucasfilm_dcp_asset_file_extension on plm.lucasfilm_dcp_asset (file_extension);

comment on table plm.lucasfilm_dcp_asset is
'One row per Disney Lucasfilm DCP Vault FILE IDENTITY, keyed on the full DAM path. FILE NAME IS NOT '
'AN IDENTITY: thousands of distinct paths share a name in this source, so file_name is '
'indexed and deliberately NOT unique -- never add a unique constraint to it. '
'file_extension is a PLAIN loader-computed column and must never be converted to '
'GENERATED ... STORED: a generated column is populated after BEFORE-row triggers run, '
'which would make every immutability trigger on this table read NULL and never fire. '
'THIS TABLE RECORDS NAMES AND PATHS ONLY. No file bytes, preview, PDF or image is stored '
'here or anywhere in this schema, and the presence of a row is NOT a claim that the '
'content exists locally.';
comment on column plm.lucasfilm_dcp_asset.checksum is
'NULL unless the portal exposed one or it was computed from authorized content. Never '
'invented, and never back-filled from the row hash -- plm.lucasfilm_dcp_asset_crawl.observed_row_hash '
'digests METADATA, not file bytes, and confusing the two would assert content integrity '
'this scrape never verified.';

-- -------------------------------------------------------------------------------------
-- 5.2 plm.lucasfilm_dcp_crawl_section -- one row per planned tile+listing query (design 4.2)
--
-- THE COMPLETENESS GATE, and the resolution of the design's 22-versus-11 discrepancy.
--
-- Design section 6 rule 1 says the saved crawler plan has 44 base jobs from 22 portal
-- tiles plus one repair job; design section 2 measures 11 distinct tiles in the extract.
-- RECONCILED, from the crawler's own saved queue in the private source repo: the queue
-- holds 45 jobs across 22 distinct tile pages -- 22 tiles x 2 listing kinds = 44 base
-- jobs, plus exactly ONE resume job for a tile whose Assets listing was interrupted
-- mid-offset. So 44 + 1 = 45, exactly as the design says.
--
-- The 11 is not a contradiction of the 22; it is the CONSEQUENCE of the crawl being
-- PARTIAL. 22 tiles were PLANNED; the checkpoint had finished only a minority of those
-- sections, so only 11 tiles had produced any rows yet. Both numbers are true and they
-- measure different things: 22 = planned sections, 11 = tiles observed so far.
--
-- THE SCHEMA CONSEQUENCE, which is why this matters: one row per PLANNED section is
-- inserted at the START of a crawl, not at the end. A crawl that captured 11 tiles while
-- 22 were planned therefore has 11 complete sections and 11 incomplete ones ON THE
-- RECORD, cannot be finalized, and is honestly reported as partial. Had sections been
-- derived from what arrived, the same crawl would have looked 100% complete. NOTHING in
-- this schema hard-codes 11 or 22: the next crawl brings its own plan.
--
-- The repair job is recorded as a gap resolution against its existing section, NEVER as a
-- second section -- hence the unique constraint below (design section 6 rule 1).
-- -------------------------------------------------------------------------------------
create table plm.lucasfilm_dcp_crawl_section (
  id             uuid primary key default gen_random_uuid(),
  crawl_id       uuid not null references plm.lucasfilm_dcp_crawl(crawl_id) on delete cascade,
  portal_tile_id uuid not null references plm.lucasfilm_dcp_portal_tile(id) on delete restrict,
  listing_kind   text not null,
  status         text not null default 'planned',
  expected_count integer null,
  captured_count integer not null default 0,
  last_offset    integer null,
  started_at     timestamptz null,
  finished_at    timestamptz null,
  notes          text null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint lucasfilm_dcp_crawl_section_listing_kind_chk check (listing_kind in ('asset','style_guide')),
  constraint lucasfilm_dcp_crawl_section_status_chk
    check (status in ('planned','running','complete','gapped','failed')),
  constraint lucasfilm_dcp_crawl_section_counts_chk check (
    captured_count >= 0
    and (expected_count is null or expected_count >= 0)
    and (last_offset is null or last_offset >= 0)
  ),
  -- A section may only claim complete when it finished and, where the portal exposed a
  -- total, actually captured that total. A ZERO-row section is legitimate (a tile really
  -- can be empty) and is allowed -- but only against an expected_count of 0, so "we got
  -- nothing" can never pass as "there was nothing".
  constraint lucasfilm_dcp_crawl_section_complete_requires_evidence_chk check (
    status <> 'complete'
    or (finished_at is not null
        and (expected_count is null or captured_count = expected_count))
  ),
  constraint lucasfilm_dcp_crawl_section_unique unique (crawl_id, portal_tile_id, listing_kind)
);

create index idx_lucasfilm_dcp_crawl_section_crawl on plm.lucasfilm_dcp_crawl_section (crawl_id, status);
create index idx_lucasfilm_dcp_crawl_section_incomplete
  on plm.lucasfilm_dcp_crawl_section (crawl_id) where status <> 'complete';

comment on table plm.lucasfilm_dcp_crawl_section is
'One row per PLANNED portal tile + listing kind in a crawl. Rows are inserted from the '
'crawler''s plan when the crawl OPENS, never derived from what arrived -- that is the whole '
'point. A partial crawl that reached only some of its planned tiles then carries its '
'unfinished sections on the record and CANNOT be finalized; derived sections would have '
'made the same crawl look 100 percent complete. A zero-row section is legitimate (a tile '
'can genuinely be empty) but may only be complete against an expected count of zero, so '
'"we captured nothing" can never pass as "there was nothing". A resume or repair job is '
'recorded as a gap resolution on the EXISTING section, never as a second section -- '
'enforced by the unique constraint on (crawl_id, portal_tile_id, listing_kind).';

-- -------------------------------------------------------------------------------------
-- 5.3 plm.lucasfilm_dcp_crawl_gap -- unresolved missing ranges and request failures (design 4.3)
-- -------------------------------------------------------------------------------------
create table plm.lucasfilm_dcp_crawl_gap (
  id               uuid primary key default gen_random_uuid(),
  crawl_section_id uuid not null references plm.lucasfilm_dcp_crawl_section(id) on delete cascade,
  offset_from      integer not null,
  offset_to        integer not null,
  reason           text not null,
  attempt_count    integer not null default 0,
  resolved_at      timestamptz null,
  resolution_note  text null,

  -- APPROVAL TIMESTAMP. Writers MUST pin this to MIDDAY UTC (12:00:00Z), never midnight.
  -- The server runs America/New_York, so a midnight-UTC value read back through ::date --
  -- which any "was this waived on or before date D" report does -- returns the PREVIOUS
  -- day. Midday UTC is 08:00 or 07:00 local, so the date is the same in both zones and no
  -- report can disagree with another about when the waiver happened.
  waived_at        timestamptz null,
  waived_by        text null,
  waiver_reason    text null,

  created_at       timestamptz not null default now(),

  constraint lucasfilm_dcp_crawl_gap_offsets_chk check (offset_from >= 0 and offset_to >= offset_from),
  constraint lucasfilm_dcp_crawl_gap_reason_chk  check (btrim(reason) <> ''),
  constraint lucasfilm_dcp_crawl_gap_attempts_chk check (attempt_count >= 0),
  -- A resolution must say what it did; a silent resolved_at is not a resolution.
  constraint lucasfilm_dcp_crawl_gap_resolution_chk check (
    resolved_at is null or btrim(coalesce(resolution_note, '')) <> ''
  ),
  -- A WAIVER IS A DECISION AND MUST BE SIGNED. All three parts or none: who, when, why.
  -- An unsigned waiver is how a gap gets closed by nobody.
  constraint lucasfilm_dcp_crawl_gap_waiver_chk check (
    (waived_at is null and waived_by is null and waiver_reason is null)
    or (waived_at is not null
        and btrim(coalesce(waived_by, '')) <> ''
        and btrim(coalesce(waiver_reason, '')) <> '')
  ),
  -- A gap is either resolved (it was actually re-fetched) or waived (a human accepted the
  -- loss). It may not be both: that hides which of the two actually happened.
  constraint lucasfilm_dcp_crawl_gap_not_both_chk check (resolved_at is null or waived_at is null)
);

create index idx_lucasfilm_dcp_crawl_gap_section on plm.lucasfilm_dcp_crawl_gap (crawl_section_id);
create index idx_lucasfilm_dcp_crawl_gap_open
  on plm.lucasfilm_dcp_crawl_gap (crawl_section_id)
  where resolved_at is null and waived_at is null;

comment on table plm.lucasfilm_dcp_crawl_gap is
'One row per unresolved missing offset range or request failure within a crawl section. A '
'crawl CANNOT be finalized while any gap is neither resolved nor waived -- enforced by '
'plm.finalize_lucasfilm_dcp_crawl. A waiver is a signed human decision: who, when and why, all three '
'or none. WAIVED_AT MUST BE PINNED TO MIDDAY UTC by its writer: this server runs '
'America/New_York, so a midnight-UTC approval timestamp read back through ::date reports '
'the PREVIOUS day, and two reports would then disagree about when a loss was accepted.';

-- -------------------------------------------------------------------------------------
-- 5.4 plm.lucasfilm_dcp_asset_crawl -- snapshot membership + the frozen row hash (design 4.7)
-- -------------------------------------------------------------------------------------
create table plm.lucasfilm_dcp_asset_crawl (
  crawl_id          uuid not null references plm.lucasfilm_dcp_crawl(crawl_id) on delete cascade,
  lucasfilm_dcp_asset_id      uuid not null references plm.lucasfilm_dcp_asset(id) on delete restrict,
  observed_row_hash text not null,
  observed_at       timestamptz not null default now(),

  constraint lucasfilm_dcp_asset_crawl_pkey primary key (crawl_id, lucasfilm_dcp_asset_id),
  -- 64 lowercase hex. The shape is enforced so a truncated, uppercased or
  -- differently-encoded digest cannot enter the column and quietly compare unequal
  -- against every honest hash forever.
  constraint lucasfilm_dcp_asset_crawl_hash_chk check (observed_row_hash ~ '^[0-9a-f]{64}$')
);

create index idx_lucasfilm_dcp_asset_crawl_asset on plm.lucasfilm_dcp_asset_crawl (lucasfilm_dcp_asset_id);

comment on table plm.lucasfilm_dcp_asset_crawl is
'Snapshot membership: this stable asset was present in this crawl. Carries the frozen '
'canonical row hash and NOTHING ELSE about the asset -- the asset''s fields live once, on '
'plm.lucasfilm_dcp_asset, and are not copied per crawl. Comparing observed_row_hash across two crawls '
'is the ONLY change-detection mechanism in this schema. The hash comes from '
'plm.lucasfilm_dcp_asset_row_hash and its serialization is FROZEN (see section 1 of migration '
'20260810190000): about 155,900 rows will carry it, and redefining the scheme invalidates '
'every stored hash and forces a full re-capture. It digests METADATA and is NOT a content '
'checksum.';

-- -------------------------------------------------------------------------------------
-- 5.5 plm.lucasfilm_dcp_load_exception -- rejected and questionable rows (owner ruling 6)
--
-- The design requires that malformed rows are REJECTED INTO AN ERROR TABLE rather than
-- silently skipped, and requires an exception report, but never defines the table. This
-- is it, and it is deliberately wider than the minimum: without crawl_section_id and
-- chunk_number an operator cannot tell WHICH query or WHICH chunk produced a bad row, and
-- without severity every advisory finding looks like a hard rejection.
--
-- A silent skip is the exact failure mode this table exists to make impossible. If the
-- loader cannot land a row, a row lands HERE. There is no third outcome.
-- -------------------------------------------------------------------------------------
create table plm.lucasfilm_dcp_load_exception (
  id               uuid primary key default gen_random_uuid(),
  crawl_id         uuid not null references plm.lucasfilm_dcp_crawl(crawl_id) on delete cascade,
  crawl_section_id uuid null references plm.lucasfilm_dcp_crawl_section(id) on delete set null,
  chunk_number     integer null,
  row_number       integer null,

  severity         text not null default 'rejected',
  reason_code      text not null,
  reason           text not null,
  source_path      text null,
  raw_row          jsonb not null default '{}'::jsonb,

  resolved_at      timestamptz null,
  resolution_note  text null,
  created_at       timestamptz not null default now(),

  constraint lucasfilm_dcp_load_exception_severity_chk check (severity in ('rejected','warning')),
  constraint lucasfilm_dcp_load_exception_reason_code_chk check (btrim(reason_code) <> ''),
  constraint lucasfilm_dcp_load_exception_reason_chk      check (btrim(reason) <> ''),
  constraint lucasfilm_dcp_load_exception_row_number_chk  check (row_number is null or row_number >= 1),
  constraint lucasfilm_dcp_load_exception_chunk_chk       check (chunk_number is null or chunk_number >= 1),
  constraint lucasfilm_dcp_load_exception_resolution_chk check (
    resolved_at is null or btrim(coalesce(resolution_note, '')) <> ''
  )
);

create index idx_lucasfilm_dcp_load_exception_crawl on plm.lucasfilm_dcp_load_exception (crawl_id, severity);
create index idx_lucasfilm_dcp_load_exception_open
  on plm.lucasfilm_dcp_load_exception (crawl_id) where resolved_at is null and severity = 'rejected';
create index idx_lucasfilm_dcp_load_exception_reason_code on plm.lucasfilm_dcp_load_exception (reason_code);

comment on table plm.lucasfilm_dcp_load_exception is
'Every input row the loader could not land, and every advisory finding it raised. THE '
'DESIGN''S RULE, MADE STRUCTURAL: a malformed row is REJECTED INTO THIS TABLE, never '
'silently skipped -- if it does not land in the landing tables it lands here, and there is '
'no third outcome. severity = rejected means the row was not loaded; warning means it was '
'loaded but something about it is worth a human''s attention. reason_code is the stable '
'machine-readable classification the exception report groups on; reason is the human '
'sentence. raw_row holds the offending input verbatim and is therefore licensor-'
'confidential like every other table here. Unresolved rejections block finalization.';
comment on column plm.lucasfilm_dcp_load_exception.reason_code is
'Stable machine-readable classification. The loader in 20260810190100 emits, among others: '
'blank folder path, conflicting guide source id, malformed boolean, unknown listing state, '
'a reserved separator in a hashed field, and two NON-IDENTICAL rows sharing one DAM path -- '
'the last being the case the duplicate collapse must never quietly merge.';

-- -------------------------------------------------------------------------------------
-- 5.6 plm.lucasfilm_dcp_asset_tile_observation -- the many-to-many evidence table (design 4.8)
--
-- Replaces the pipe-separated tile list and the two listing booleans that the flat
-- extract carries on each file row. One row per proven (crawl, asset, tile, listing kind).
--
-- crawl_section_id IS NULLABLE BY DESIGN -- see DECISION 3 in the header. link_evidence
-- names the fidelity and the CHECK below binds the two so they can never disagree.
-- -------------------------------------------------------------------------------------
create table plm.lucasfilm_dcp_asset_tile_observation (
  crawl_id         uuid not null references plm.lucasfilm_dcp_crawl(crawl_id) on delete cascade,
  lucasfilm_dcp_asset_id     uuid not null references plm.lucasfilm_dcp_asset(id) on delete restrict,
  portal_tile_id   uuid not null references plm.lucasfilm_dcp_portal_tile(id) on delete restrict,
  listing_kind     text not null,
  crawl_section_id uuid null references plm.lucasfilm_dcp_crawl_section(id) on delete restrict,
  link_evidence    text not null,
  observed_at      timestamptz not null default now(),

  constraint lucasfilm_dcp_asset_tile_observation_pkey
    primary key (crawl_id, lucasfilm_dcp_asset_id, portal_tile_id, listing_kind),
  constraint lucasfilm_dcp_asset_tile_observation_listing_kind_chk
    check (listing_kind in ('asset','style_guide')),
  constraint lucasfilm_dcp_asset_tile_observation_link_evidence_chk
    check (link_evidence in ('section_query','aggregated_row')),
  -- THE BINDING. 'section_query' asserts a specific portal query proved this link, so the
  -- section id is REQUIRED. 'aggregated_row' asserts the link came from an already-
  -- aggregated extract row whose originating query was not preserved, so the section id
  -- MUST be NULL. Neither grade can borrow the other's appearance.
  constraint lucasfilm_dcp_asset_tile_observation_evidence_binding_chk check (
    (link_evidence = 'section_query'  and crawl_section_id is not null)
    or
    (link_evidence = 'aggregated_row' and crawl_section_id is null)
  )
);

create index idx_lucasfilm_dcp_asset_tile_obs_asset on plm.lucasfilm_dcp_asset_tile_observation (lucasfilm_dcp_asset_id);
create index idx_lucasfilm_dcp_asset_tile_obs_tile
  on plm.lucasfilm_dcp_asset_tile_observation (portal_tile_id, listing_kind);
create index idx_lucasfilm_dcp_asset_tile_obs_section
  on plm.lucasfilm_dcp_asset_tile_observation (crawl_section_id) where crawl_section_id is not null;

comment on table plm.lucasfilm_dcp_asset_tile_observation is
'The many-to-many evidence table for file-to-portal-tile links, replacing the pipe-joined '
'tile list and the two listing booleans the flat extract carries per file row. One row per '
'proven (crawl, asset, tile, listing kind); an asset listed under eight tiles produces '
'EIGHT rows here and still exactly ONE row in plm.lucasfilm_dcp_asset. '
'FIDELITY IS RECORDED IN THE DATA, not assumed: link_evidence = section_query means a '
'specific portal query proved the link and crawl_section_id names it; '
'link_evidence = aggregated_row means the link came from an already-aggregated extract row '
'whose originating query was NOT preserved and cannot be reconstructed, so crawl_section_id '
'is NULL. The CSV backfill is entirely aggregated_row. A consumer that needs proven '
'provenance filters on section_query. Inventing a synthetic section for the aggregated case '
'would have manufactured exactly the false precision the design forbids.';
comment on column plm.lucasfilm_dcp_asset_tile_observation.listing_kind is
'Which portal result list showed this file under this tile. It is an OBSERVATION, not part '
'of file identity. Two rows for one (crawl, asset, tile) are created only when BOTH '
'listings were genuinely queried and both returned the file -- never by expanding one '
'aggregated row into a cross-product.';

-- =====================================================================================
-- SECTION 6. IMMUTABILITY -- a completed crawl's evidence is frozen
--
-- Prose in a design document is not immutability. These are row triggers.
--
-- WHY BEFORE-ROW TRIGGERS AND WHAT DEFEATS THEM: TRUNCATE does not fire row triggers at
-- all, so every guarantee below depends on section 7 having revoked TRUNCATE from
-- service_role. The two sections are one mechanism; do not weaken either alone.
--
-- AND WHY EVERY CRAWL-SCOPED TRIGGER COVERS **INSERT** AS WELL AS UPDATE AND DELETE.
-- Read this before "simplifying" any trigger below back to `before update or delete`.
-- Section 7 revokes UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER and MAINTAIN from
-- service_role. Guarded SECURITY DEFINER functions are therefore the only writing
-- operation still available to the loader's role -- which makes it the one an
-- UPDATE/DELETE-only trigger would leave completely unguarded. The concrete hole: crawl X
-- finalizes, then a plain
--     insert into plm.lucasfilm_dcp_asset_tile_observation (crawl_id, ...) values (X, ...);
-- adds a portal link that crawl never observed. No grant stops it and, without the INSERT
-- branch, no trigger fires either -- and the claim "a completed crawl's evidence is frozen"
-- would be false for the only operation anyone could still perform. The same hole exists
-- on lucasfilm_dcp_asset_crawl, lucasfilm_dcp_crawl_section, lucasfilm_dcp_crawl_gap, lucasfilm_dcp_load_exception and
-- lucasfilm_dcp_chunk_ledger, so all six are covered.
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- 6.1 Crawl-scoped evidence: frozen entirely once its crawl is complete.
-- -------------------------------------------------------------------------------------
create or replace function plm.lucasfilm_dcp_reject_completed_crawl_change()
returns trigger
language plpgsql
as $$
declare
  v_crawl  uuid;
  v_status text;
begin
  -- NEW is UNASSIGNED in a DELETE trigger; reading new.* there raises "record new is not
  -- assigned yet". The branch therefore comes BEFORE the read, never inside a coalesce
  -- over both.
  --
  -- plm.lucasfilm_dcp_crawl_gap is the one attached table that has NO crawl_id column -- it hangs
  -- off a section, not off the crawl -- so reading new.crawl_id there would raise "record
  -- new has no field crawl_id" at runtime, on every write, while the migration itself
  -- applied perfectly clean. It is resolved through its section instead. A generic
  -- `record.crawl_id` read would have been a guard that only fails when it is used.
  if tg_table_name = 'lucasfilm_dcp_crawl_gap' then
    select s.crawl_id into v_crawl
    from plm.lucasfilm_dcp_crawl_section s
    where s.id = (case when tg_op = 'DELETE' then old.crawl_section_id
                       else new.crawl_section_id end);
  elsif tg_op = 'DELETE' then
    v_crawl := old.crawl_id;
  else
    v_crawl := new.crawl_id;
  end if;

  select c.status into v_status from plm.lucasfilm_dcp_crawl c where c.crawl_id = v_crawl;

  if v_status = 'complete' then
    raise exception
      'Lucasfilm DCP Vault crawl % is COMPLETE and its evidence is immutable; % on %.% is refused. A '
      'refresh is a NEW crawl_id, never an edit of an old one -- editing completed evidence '
      'destroys the only record of what the portal actually said.',
      v_crawl, tg_op, tg_table_schema, tg_table_name
      using errcode = 'P0001';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

comment on function plm.lucasfilm_dcp_reject_completed_crawl_change() is
'Row trigger freezing every CRAWL-SCOPED plm.lucasfilm_dcp_* table once its owning crawl reaches '
'status complete. FIRES ON INSERT, UPDATE AND DELETE -- all three, deliberately. INSERT is '
'not an afterthought here: section 7 revokes UPDATE, DELETE and TRUNCATE from service_role '
'but KEEPS INSERT, so INSERT is the only mutating operation still available and is '
'therefore the one an unguarded trigger would leave wide open. Without the INSERT branch a '
'plain INSERT could add a tile observation, a section, a gap or a membership row to an '
'already-completed crawl, and that crawl would then claim evidence it never observed. '
'TRUNCATE fires no row trigger at all, which is exactly why section 7 revokes it. The '
'revokes and this trigger are ONE mechanism; neither is sufficient alone.';

do $$
declare t text;
begin
  -- plm.lucasfilm_dcp_load_exception is deliberately NOT in this list. It gets the narrower
  -- plm.lucasfilm_dcp_load_exception_freeze below, because its resolution columns must stay
  -- writable after completion -- see the note there.
  foreach t in array array[
    'lucasfilm_dcp_crawl_section','lucasfilm_dcp_crawl_gap','lucasfilm_dcp_asset_crawl',
    'lucasfilm_dcp_asset_tile_observation'
  ]
  loop
    execute format(
      'create trigger %I before insert or update or delete on plm.%I '
      'for each row execute function plm.lucasfilm_dcp_reject_completed_crawl_change()',
      'trg_' || t || '_immutable', t);
  end loop;
end;
$$;

-- -------------------------------------------------------------------------------------
-- 6.1b plm.lucasfilm_dcp_load_exception -- frozen against INSERT and DELETE, but a human may still
--      RESOLVE an entry after the crawl completes.
--
-- THE DECISION, STATED SO NOBODY HAS TO GUESS WHETHER IT WAS INTENTIONAL. Freezing this
-- table wholesale (the 6.1 treatment) would mean that the moment a crawl completes, a
-- `warning` row can never be annotated, triaged or marked resolved -- which is the entire
-- purpose of its resolved_at and resolution_note columns, and those columns would be dead
-- weight from the first completed crawl onward. Warnings are, by definition, the entries
-- that DID load and that a human is expected to look at LATER; "later" is almost always
-- after the crawl finished.
--
-- So the carve-out is the same principle used for the stable-identity tables in 6.2:
-- SOURCE facts freeze, OUR later decisions do not.
--   * INSERT into a completed crawl: REFUSED. A new exception after the fact would be a
--     finding the crawl never actually produced.
--   * DELETE from a completed crawl: REFUSED. Deleting a finding is how a finding stops
--     existing.
--   * UPDATE of a completed crawl's row: only resolved_at and resolution_note may change.
--     Everything else -- severity, reason_code, reason, raw_row, the row/chunk pointers --
--     is source evidence and stays frozen.
-- Note that unresolved REJECTED rows still block finalization (finalize gate 3), so this
-- carve-out cannot be used to complete a crawl over open rejections and tidy them up
-- afterwards.
-- -------------------------------------------------------------------------------------
create or replace function plm.lucasfilm_dcp_load_exception_freeze()
returns trigger
language plpgsql
as $$
declare
  v_crawl  uuid;
  v_status text;
begin
  -- NEW is unassigned in a DELETE trigger, so the branch precedes the read.
  if tg_op = 'DELETE' then
    v_crawl := old.crawl_id;
  else
    v_crawl := new.crawl_id;
  end if;

  select c.status into v_status from plm.lucasfilm_dcp_crawl c where c.crawl_id = v_crawl;

  if v_status is distinct from 'complete' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'INSERT' then
    raise exception 'Lucasfilm DCP Vault crawl % is COMPLETE; a new load exception may not be added '
      'to it. An exception recorded after the fact is a finding the crawl never produced.',
      v_crawl using errcode = 'P0001';
  end if;

  if tg_op = 'DELETE' then
    raise exception 'Lucasfilm DCP Vault crawl % is COMPLETE; its load exceptions may not be deleted. '
      'Deleting a finding is how a finding stops existing.', v_crawl using errcode = 'P0001';
  end if;

  -- `id` is compared too. Without it a completed crawl's finding could be RE-KEYED --
  -- every other column identical, a new primary key -- which breaks any external
  -- reference to that finding while looking like nothing changed.
  if new.id               is distinct from old.id
  or new.crawl_id         is distinct from old.crawl_id
  or new.crawl_section_id is distinct from old.crawl_section_id
  or new.chunk_number     is distinct from old.chunk_number
  or new.row_number       is distinct from old.row_number
  or new.severity         is distinct from old.severity
  or new.reason_code      is distinct from old.reason_code
  or new.reason           is distinct from old.reason
  or new.source_path      is distinct from old.source_path
  or new.raw_row          is distinct from old.raw_row
  or new.created_at       is distinct from old.created_at then
    raise exception 'Lucasfilm DCP Vault crawl % is COMPLETE: the source fields of a load exception '
      'are immutable. Only resolved_at and resolution_note may change, so a human can still '
      'triage a warning after the crawl finished.', v_crawl using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create trigger trg_lucasfilm_dcp_load_exception_immutable
  before insert or update or delete on plm.lucasfilm_dcp_load_exception
  for each row execute function plm.lucasfilm_dcp_load_exception_freeze();

comment on function plm.lucasfilm_dcp_load_exception_freeze() is
'Narrower freeze for plm.lucasfilm_dcp_load_exception. Once the owning crawl is complete: INSERT is '
'refused (a finding the crawl never produced), DELETE is refused (deleting a finding is how '
'it stops existing), and UPDATE may change ONLY resolved_at and resolution_note. This is a '
'DELIBERATE carve-out, not an oversight: warnings are precisely the entries a human is '
'expected to triage LATER, and "later" is nearly always after the crawl finished, so the '
'wholesale 6.1 freeze would have made those two columns dead weight from the first '
'completed crawl. Unresolved REJECTED rows still block finalization, so this cannot be used '
'to complete a crawl over open rejections and tidy them afterwards.';

-- -------------------------------------------------------------------------------------
-- 6.2 Stable identities: SOURCE columns freeze; OUR columns stay editable.
--
-- plm.lucasfilm_dcp_portal_tile, plm.lucasfilm_dcp_style_guide and plm.lucasfilm_dcp_asset outlive any single crawl.
-- Design section 7: deleting an unpromoted crawl must remove its observations but NOT the
-- stable identities other crawls use. So these three are NOT frozen wholesale.
--
-- What freezes: the SOURCE columns, once the row has been observed by any COMPLETE crawl.
-- What stays editable, forever: last_seen_crawl_id (a later crawl re-observing the same
-- row is normal), updated_at, and the reconciliation columns -- those are OUR decisions,
-- made after the fact, and are the entire reason these tables have them.
-- DELETE is refused outright once a complete crawl has seen the row.
-- -------------------------------------------------------------------------------------
create or replace function plm.lucasfilm_dcp_reject_completed_source_field_change()
returns trigger
language plpgsql
as $$
declare
  v_seen boolean;
begin
  -- "Has any COMPLETE crawl observed this row?" is answered per table, from the evidence
  -- tables, not from a flag on the row -- a flag would have to be maintained and could
  -- drift out of agreement with the evidence it claims to summarise.
  if tg_table_name = 'lucasfilm_dcp_asset' then
    select exists (
      select 1 from plm.lucasfilm_dcp_asset_crawl ac
      join plm.lucasfilm_dcp_crawl c on c.crawl_id = ac.crawl_id
      where ac.lucasfilm_dcp_asset_id = old.id and c.status = 'complete'
    ) into v_seen;
  elsif tg_table_name = 'lucasfilm_dcp_style_guide' then
    select exists (
      select 1 from plm.lucasfilm_dcp_asset a
      join plm.lucasfilm_dcp_asset_crawl ac on ac.lucasfilm_dcp_asset_id = a.id
      join plm.lucasfilm_dcp_crawl c on c.crawl_id = ac.crawl_id
      where a.style_guide_id = old.id and c.status = 'complete'
    ) into v_seen;
  elsif tg_table_name = 'lucasfilm_dcp_portal_tile' then
    select exists (
      select 1 from plm.lucasfilm_dcp_asset_tile_observation o
      join plm.lucasfilm_dcp_crawl c on c.crawl_id = o.crawl_id
      where o.portal_tile_id = old.id and c.status = 'complete'
    ) into v_seen;
  else
    -- An unknown table means this trigger was attached somewhere it was not designed for.
    -- FAIL LOUDLY. Returning NEW here would install a guard that silently permits
    -- everything on the new table, which is worse than no guard at all.
    raise exception 'plm.lucasfilm_dcp_reject_completed_source_field_change is attached to %.% which '
      'it does not know how to evaluate. Extend the function before attaching it.',
      tg_table_schema, tg_table_name using errcode = 'P0001';
  end if;

  if not v_seen then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    raise exception 'Lucasfilm DCP Vault: %.% row % has been observed by a COMPLETE crawl and may not '
      'be deleted. Stable source identities are permanent evidence.',
      tg_table_schema, tg_table_name, old.id using errcode = 'P0001';
  end if;

  if tg_table_name = 'lucasfilm_dcp_asset' then
    if new.source_system        is distinct from old.source_system
    or new.source_path          is distinct from old.source_path
    or new.style_guide_id       is distinct from old.style_guide_id
    or new.file_name            is distinct from old.file_name
    or new.file_extension       is distinct from old.file_extension
    or new.relative_folder_path is distinct from old.relative_folder_path
    or new.source_asset_id      is distinct from old.source_asset_id
    or new.file_size_bytes      is distinct from old.file_size_bytes
    or new.content_type         is distinct from old.content_type
    or new.checksum             is distinct from old.checksum
    or new.first_seen_crawl_id  is distinct from old.first_seen_crawl_id
    or new.raw                  is distinct from old.raw then
      raise exception 'Lucasfilm DCP Vault: source fields of plm.lucasfilm_dcp_asset row % are immutable once a '
        'COMPLETE crawl has observed it. Every stored row hash was computed from these '
        'exact values; changing one silently invalidates its change detection. Only '
        'last_seen_crawl_id and updated_at may change.', old.id using errcode = 'P0001';
    end if;

  elsif tg_table_name = 'lucasfilm_dcp_style_guide' then
    if new.source_system       is distinct from old.source_system
    or new.source_path         is distinct from old.source_path
    or new.source_guide_id     is distinct from old.source_guide_id
    or new.folder_name         is distinct from old.folder_name
    or new.region              is distinct from old.region
    or new.year_segment        is distinct from old.year_segment
    or new.parent_source_path  is distinct from old.parent_source_path
    or new.first_seen_crawl_id is distinct from old.first_seen_crawl_id
    or new.raw                 is distinct from old.raw then
      raise exception 'Lucasfilm DCP Vault: source fields of plm.lucasfilm_dcp_style_guide row % are immutable '
        'once a COMPLETE crawl has observed it. Only last_seen_crawl_id, updated_at and the '
        'reconciliation columns may change.', old.id using errcode = 'P0001';
    end if;

  elsif tg_table_name = 'lucasfilm_dcp_portal_tile' then
    if new.source_system       is distinct from old.source_system
    or new.source_key          is distinct from old.source_key
    or new.display_label       is distinct from old.display_label
    or new.source_url          is distinct from old.source_url
    or new.first_seen_crawl_id is distinct from old.first_seen_crawl_id
    or new.raw                 is distinct from old.raw then
      raise exception 'Lucasfilm DCP Vault: source fields of plm.lucasfilm_dcp_portal_tile row % are immutable '
        'once a COMPLETE crawl has observed it. Only last_seen_crawl_id, updated_at and the '
        'reconciliation columns may change.', old.id using errcode = 'P0001';
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

comment on function plm.lucasfilm_dcp_reject_completed_source_field_change() is
'Narrower immutability trigger for the three STABLE IDENTITY tables, which outlive any one '
'crawl and therefore must not freeze wholesale. Once a COMPLETE crawl has observed a row -- '
'a fact read from the evidence tables, never from a maintainable flag that could drift -- '
'its SOURCE columns freeze and DELETE is refused, while last_seen_crawl_id, updated_at and '
'the reconciliation columns (core_property_id / core_style_guide_id and resolution_*) stay '
'editable, because reconciliation is OUR later decision and not source data. Attached to an '
'unknown table it RAISES rather than returning NEW: a guard that silently permits '
'everything is worse than no guard.';

create trigger trg_lucasfilm_dcp_asset_source_immutable
  before update or delete on plm.lucasfilm_dcp_asset
  for each row execute function plm.lucasfilm_dcp_reject_completed_source_field_change();
create trigger trg_lucasfilm_dcp_style_guide_source_immutable
  before update or delete on plm.lucasfilm_dcp_style_guide
  for each row execute function plm.lucasfilm_dcp_reject_completed_source_field_change();
create trigger trg_lucasfilm_dcp_portal_tile_source_immutable
  before update or delete on plm.lucasfilm_dcp_portal_tile
  for each row execute function plm.lucasfilm_dcp_reject_completed_source_field_change();

-- -------------------------------------------------------------------------------------
-- 6.3 The crawl header itself.
--
-- Adapted from plm.pmt_capture_freeze. finalize's own UPDATE runs while the row is still
-- 'running', so it passes; once complete, nothing may change and the row may not be
-- deleted. Blocking the DELETE here also stops the ON DELETE CASCADE from ever reaching a
-- completed crawl's evidence.
-- -------------------------------------------------------------------------------------
create or replace function plm.lucasfilm_dcp_crawl_freeze()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'complete' then
      raise exception 'Lucasfilm DCP Vault crawl % is COMPLETE and may not be deleted. Completed '
        'crawls are retained permanently, and deleting one would cascade away the evidence '
        'of what the portal said.', old.crawl_id using errcode = 'P0001';
    end if;
    return old;
  end if;

  if old.status = 'complete' then
    raise exception 'Lucasfilm DCP Vault crawl % is COMPLETE and immutable. A refresh is a NEW crawl, '
      'never an edit of a completed one.', old.crawl_id using errcode = 'P0001';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create trigger trg_lucasfilm_dcp_crawl_freeze
  before update or delete on plm.lucasfilm_dcp_crawl
  for each row execute function plm.lucasfilm_dcp_crawl_freeze();

comment on function plm.lucasfilm_dcp_crawl_freeze() is
'Freezes a COMPLETE plm.lucasfilm_dcp_crawl row against UPDATE and DELETE, and maintains updated_at '
'while the crawl is still in flight. Refusing the DELETE also stops ON DELETE CASCADE from '
'ever reaching a completed crawl''s sections, gaps, memberships, tile observations and '
'exceptions. plm.finalize_lucasfilm_dcp_crawl''s own UPDATE runs while the row is still running, so '
'it is unaffected.';

-- =====================================================================================
-- SECTION 7. PRIVILEGES -- revoke-first, PostgreSQL 17 complete
--
-- THE TRAP, STATED PLAINLY. The plm schema carries a standing
--     alter default privileges in schema plm grant all on tables to service_role
-- (20260710135975_reconcile_service_role_grants.sql:14). It fires at CREATE TABLE time,
-- BEFORE any GRANT in this migration could run. VERIFIED LIVE on 2026-08-10 against both
-- projects: pg_default_acl for schema plm reads {service_role=arwdDxtm/postgres} -- all
-- eight bits, INCLUDING TRUNCATE and PostgreSQL 17's MAINTAIN. So every table created
-- above was BORN holding TRUNCATE for service_role.
--
-- A NARROWER GRANT DOES NOT REMOVE A BIT. Only REVOKE does. This is exactly what
-- 20260810110000 had to repair on the Warner tables after the fact, and what #664 (the
-- missed MAINTAIN) and #649 (the default-privilege hole itself) are about.
--
-- WHY IT MATTERS HERE MORE THAN USUAL: TRUNCATE FIRES NO ROW TRIGGERS. One TRUNCATE would
-- erase a completed crawl's entire evidence without any section 6 trigger running once.
-- Every immutability guarantee in this migration rests on this revoke.
--
-- THE POSTURE, copied from 20260810110000 (Warner) verbatim as the pattern:
--   service_role keeps SELECT only; INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
--   and MAINTAIN are revoked. public and anon get `revoke all`.
--   INSERT is kept deliberately: the 20260810190100 loader functions are SECURITY DEFINER
--   and never consume service_role's table grants; the loader's security-definer path and
--   the exception table are exercised by service_role in the apply lane, and Warner's
--   shipped posture is the pattern this ruling names. It is the MUTATING bits -- above all
--   TRUNCATE -- that the immutability design cannot survive.
-- =====================================================================================
do $$
declare t text;
begin
  foreach t in array array[
    'lucasfilm_dcp_crawl','lucasfilm_dcp_portal_tile','lucasfilm_dcp_style_guide','lucasfilm_dcp_asset',
    'lucasfilm_dcp_crawl_section','lucasfilm_dcp_crawl_gap','lucasfilm_dcp_asset_crawl',
    'lucasfilm_dcp_asset_tile_observation','lucasfilm_dcp_load_exception'
  ]
  loop
    execute format(
      'revoke insert, update, delete, truncate, references, trigger, maintain on plm.%I from service_role', t);
    execute format('revoke all on plm.%I from public', t);
    execute format('revoke all on plm.%I from anon', t);
    execute format('grant select on plm.%I to service_role', t);
    execute format('grant select on plm.%I to authenticated', t);
  end loop;
end;
$$;

-- =====================================================================================
-- SECTION 8. ROW LEVEL SECURITY
--
-- AN RLS POLICY IS NOT A GRANT, and a GRANT IS NOT A POLICY. Both are required, so both
-- are set, in loops that cannot skip a table by hand.
--
-- THE PREDICATE IS THE ROLE GATE from 20260807190000:73-81, the one Warner adopted in
-- 20260810110000. `using (true)` IS FORBIDDEN HERE. It was a live security defect on the
-- Disney OPA extract -- it made confidential licensor data readable by EVERY signed-in
-- account, including vendor and viewer principals -- and this is the same licensor's data
-- from a second portal. Note honestly what the predicate does: app.has_app_access checks
-- for a non-revoked app-access row and ignores roles entirely, so plm app access alone is
-- sufficient. Narrowing that is an owner decision affecting every table sharing this
-- pattern and is out of scope here.
-- =====================================================================================
do $$
declare t text;
begin
  foreach t in array array[
    'lucasfilm_dcp_crawl','lucasfilm_dcp_portal_tile','lucasfilm_dcp_style_guide','lucasfilm_dcp_asset',
    'lucasfilm_dcp_crawl_section','lucasfilm_dcp_crawl_gap','lucasfilm_dcp_asset_crawl',
    'lucasfilm_dcp_asset_tile_observation','lucasfilm_dcp_load_exception'
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
-- Disney Lucasfilm DCP Vault -- PHASE 2 metadata landing schema.
--
-- Migration: 20260811050000_lucasfilm_dcp_vault_metadata_landing.sql
-- Issue:     u2giants/shared-db #748 (workstream). Object claim: #749 -- this migration
--            owns eight NEW plm.lucasfilm_dcp_* tables and touches NOTHING that already exists.
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
-- CONFIDENTIALITY. u2giants/shared-db is a PUBLIC repository. The Lucasfilm DCP Vault extract is
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
--   THE ENFORCEMENT: plm.lucasfilm_dcp_asset_property_observation and
--   plm.lucasfilm_dcp_asset_character_observation are separate tables with NO foreign key between
--   them, no shared surrogate, no trigger that reads one while writing the other, and no
--   function anywhere in 20260811060000 that opens both in the same statement.
--   plm.lucasfilm_dcp_character DELIBERATELY HAS NO PROPERTY COLUMN. That absence is a locked
--   decision -- do not "finish" it. Disney OPA (plm.opa_*) is the ONLY Disney source that
--   directly asserts property-to-character, and it is a different portal with a different
--   landing schema which must not be folded into this one.
--
-- RULE 2 -- THE PATH IS THE ASSET IDENTITY. File name is NOT unique; collisions are
--   observed in this source in the thousands. The style-guide source id is NULLABLE TEXT
--   in two different observed formats. A NAME IS NEVER AN ID. This migration therefore
--   never keys anything on a name, and reaches assets only through plm.lucasfilm_dcp_asset.id,
--   which Phase 1 keyed on (source_system, source_path).
--
-- RULE 3 -- METADATA IS TIME-VARYING OBSERVATION DATA. Every scalar and every link in
--   this migration is keyed by (metadata_run_id, lucasfilm_dcp_asset_id) -- NEVER written onto the
--   stable plm.lucasfilm_dcp_asset row. The source is a point-in-time portal snapshot with no
--   change feed, so overwriting one "current metadata" row loses the fact that a title,
--   owner, restriction or tag changed. A future view may select the latest complete run;
--   the landing layer keeps them all.
--
-- RULE 4 -- HTTP 200 IS NOT SUCCESS. A signed-out Lucasfilm DCP Vault session returns HTTP 200 with
--   a tiny zero-record body. fetch_status is therefore a first-class column with its own
--   'signed_out' value, and 20260811060000 refuses to mark a response successful on
--   status code alone.
--
-- =====================================================================================
-- SECTION -0.5. WHAT THIS MIGRATION DELIBERATELY DOES NOT DO
-- =====================================================================================
--
-- (a) IT DOES NOT TOUCH plm.lucasfilm_dcp_asset_row_hash OR ANY PHASE-1 OBJECT. The Phase-1 frozen
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
--     and for the same reason. No application reads Lucasfilm DCP Vault data today. An api view is
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
-- SECTION 0. THE SECOND FROZEN SERIALIZATION -- plm.lucasfilm_dcp_metadata_row_hash
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
-- IT IS A DIFFERENT FUNCTION FROM plm.lucasfilm_dcp_asset_row_hash AND MUST STAY ONE. They digest
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
--   refused row becomes a plm.lucasfilm_dcp_load_exception, never a silently different digest.
--
-- WHY 22 NAMED PARAMETERS AND NOT ONE text[] OF SCALARS: an array makes slot ORDER the
--   caller's responsibility, and a caller that reorders two slots produces a valid-looking
--   digest of the wrong serialization with no error anywhere. Named parameters make the
--   order the FUNCTION's responsibility, which is the whole point of computing the digest
--   in the database instead of in a loader.
-- =====================================================================================
create or replace function plm.lucasfilm_dcp_metadata_row_hash(
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
        'a response must be recorded in plm.lucasfilm_dcp_load_exception instead. No value is '
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

comment on function plm.lucasfilm_dcp_metadata_row_hash(
  text, text, text, text, text, text, text, text, text, text, text,
  text, text, text, text, text, text, text, text[], text[], text[], text[]) is
'Canonical normalized-metadata digest for plm.lucasfilm_dcp_metadata_asset.normalized_hash. sha256, '
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
'plm.lucasfilm_dcp_asset_row_hash and must stay separate -- that one is already frozen over ~155,900 '
'Phase-1 rows. This one freezes on the first complete metadata load: change it now or '
'never. Full normative specification in section 0 of migration 20260811050000.';

revoke all on function plm.lucasfilm_dcp_metadata_row_hash(
  text, text, text, text, text, text, text, text, text, text, text,
  text, text, text, text, text, text, text, text[], text[], text[], text[]) from public;
grant execute on function plm.lucasfilm_dcp_metadata_row_hash(
  text, text, text, text, text, text, text, text, text, text, text,
  text, text, text, text, text, text, text, text[], text[], text[], text[])
  to authenticated, service_role;

-- =====================================================================================
-- SECTION 1. plm.lucasfilm_dcp_metadata_run -- one row per attempt to fetch metadata for every
--            asset in ONE COMPLETED path crawl.
-- =====================================================================================
create table plm.lucasfilm_dcp_metadata_run (
  metadata_run_id      uuid primary key default gen_random_uuid(),

  -- on delete restrict, NOT cascade: a path crawl that has metadata hanging off it is
  -- evidence a metadata run depended on, and deleting it silently would strand the
  -- interpretation of every response.
  source_crawl_id      uuid not null references plm.lucasfilm_dcp_crawl(crawl_id) on delete restrict,

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

  constraint lucasfilm_dcp_metadata_run_status_chk
    check (status in ('planned','running','complete','failed')),

  constraint lucasfilm_dcp_metadata_run_captured_on_chk
    check (captured_on >= date '2026-01-01'),

  -- No scheme, no host, no query string, no whitespace. A leading '/' is required so the
  -- value cannot accidentally be a bare host name.
  constraint lucasfilm_dcp_metadata_run_endpoint_chk check (
    btrim(endpoint_suffix) = endpoint_suffix
    and endpoint_suffix <> ''
    and left(endpoint_suffix, 1) = '/'
    and position('://' in endpoint_suffix) = 0
    and position('?' in endpoint_suffix) = 0
    and endpoint_suffix !~ '\s'
  ),

  constraint lucasfilm_dcp_metadata_run_crawler_version_chk check (btrim(crawler_version) <> ''),
  constraint lucasfilm_dcp_metadata_run_captured_by_chk check (btrim(captured_by) <> ''),
  -- A 40-char hex sha1 or a 64-char hex sha256. Provenance that cannot be resolved back
  -- to an exact private commit is not provenance.
  constraint lucasfilm_dcp_metadata_run_commit_chk
    check (private_source_commit ~ '^[0-9a-f]{40}$'
        or private_source_commit ~ '^[0-9a-f]{64}$'),

  constraint lucasfilm_dcp_metadata_run_expected_chk check (assets_expected >= 0),
  constraint lucasfilm_dcp_metadata_run_counts_chk check (
    (fetches_succeeded is null or fetches_succeeded >= 0)
    and (fetches_failed is null or fetches_failed >= 0)
  ),

  -- THE COMPLETENESS ARITHMETIC, AS A CONSTRAINT AND NOT AS A HOPE.
  -- A run may only be `complete` when both counts are present and they add up to exactly
  -- what was expected. This is the structural form of "a missing chunk cannot assemble
  -- into a shorter complete run": the count was fixed at begin time from the source
  -- crawl's own membership, so a load that quietly dropped rows cannot balance.
  constraint lucasfilm_dcp_metadata_run_complete_chk check (
    status <> 'complete'
    or (fetches_succeeded is not null
        and fetches_failed is not null
        and fetches_succeeded + fetches_failed = assets_expected
        and finished_at is not null)
  ),
  constraint lucasfilm_dcp_metadata_run_failed_chk check (
    status <> 'failed' or (failure_message is not null and btrim(failure_message) <> '')
  ),
  constraint lucasfilm_dcp_metadata_run_running_chk check (
    status = 'planned' or started_at is not null
  ),
  constraint lucasfilm_dcp_metadata_run_finished_order_chk check (
    finished_at is null or started_at is null or finished_at >= started_at
  ),

  -- Supports the composite foreign key on plm.lucasfilm_dcp_metadata_asset that pins a metadata row
  -- to the SAME source crawl its run declared. Redundant as a uniqueness statement --
  -- metadata_run_id is already the primary key -- and REQUIRED as a referencable target,
  -- because PostgreSQL will only accept a composite FK against a declared unique key.
  constraint lucasfilm_dcp_metadata_run_run_crawl_unique unique (metadata_run_id, source_crawl_id)
);

-- ONE RUNNING RUN PER SOURCE CRAWL. A partial unique index, not a CHECK: the rule is
-- about the relationship BETWEEN rows, which a row constraint cannot see. Two concurrent
-- runs over one crawl would each believe they own the reconciliation and each finalize
-- against the other's rows.
create unique index idx_lucasfilm_dcp_metadata_run_one_running
  on plm.lucasfilm_dcp_metadata_run (source_crawl_id)
  where status = 'running';

create index idx_lucasfilm_dcp_metadata_run_source_crawl on plm.lucasfilm_dcp_metadata_run (source_crawl_id);
create index idx_lucasfilm_dcp_metadata_run_status on plm.lucasfilm_dcp_metadata_run (status);

comment on table plm.lucasfilm_dcp_metadata_run is
'One row per attempt to fetch Lucasfilm DCP Vault metadata for every asset in ONE COMPLETED path '
'crawl. A metadata run is NOT another path crawl: it hangs off plm.lucasfilm_dcp_crawl and may only '
'cover assets that crawl observed. assets_expected is fixed at begin time from the source '
'crawl''s own plm.lucasfilm_dcp_asset_crawl membership, which is what makes the completeness '
'arithmetic meaningful -- a load that silently dropped rows cannot make '
'succeeded + failed = expected balance. Only ONE run per source crawl may be `running` at '
'a time (partial unique index). A `complete` run is IMMUTABLE, including against INSERT '
'into its evidence tables.';
comment on column plm.lucasfilm_dcp_metadata_run.endpoint_suffix is
'The RELATIVE, NON-SECRET path suffix the metadata fetch used. Never a full URL, never a '
'query string, never a cookie, session id, bearer token or signed parameter -- a CHECK '
'enforces that shape rather than trusting the caller, because a credential written here '
'would live in this shared database''s logs and backups permanently.';
comment on column plm.lucasfilm_dcp_metadata_run.assets_expected is
'The exact plm.lucasfilm_dcp_asset_crawl row count of the source crawl, captured at begin time by '
'plm.begin_lucasfilm_dcp_metadata_run. NEVER a caller-supplied number and never re-derived at '
'finalization -- re-deriving it at the end would let a run that lost rows redefine its own '
'target and report itself complete.';

-- =====================================================================================
-- SECTION 2. plm.lucasfilm_dcp_metadata_asset -- one row per expected asset per metadata run.
--
-- This is the fetch-outcome and scalar-metadata table, and it is the join point every
-- link table hangs off.
--
-- THE TWO COMPOSITE FOREIGN KEYS, AND WHY NEITHER IS REDUNDANT.
--   FK-A  (metadata_run_id, source_crawl_id) -> lucasfilm_dcp_metadata_run(metadata_run_id, source_crawl_id)
--         pins this row's source_crawl_id to the one its RUN declared. Without it a row
--         could name run R while claiming a different source crawl, and the membership
--         check below would then be performed against the wrong crawl entirely.
--   FK-B  (source_crawl_id, lucasfilm_dcp_asset_id) -> lucasfilm_dcp_asset_crawl(crawl_id, lucasfilm_dcp_asset_id)
--         proves this asset was ACTUALLY OBSERVED BY THAT CRAWL. Without it, metadata
--         could be attached to any asset in the table, including one from a different
--         crawl or a different portal section, and the run's reconciliation would still
--         appear to balance.
--   TOGETHER they make "a metadata row cannot reference an asset outside its source
--   crawl" a structural impossibility rather than a loader convention. A single FK
--   straight to plm.lucasfilm_dcp_asset(id) -- the obvious shape -- enforces neither.
-- =====================================================================================
create table plm.lucasfilm_dcp_metadata_asset (
  metadata_run_id  uuid not null,
  source_crawl_id  uuid not null,
  lucasfilm_dcp_asset_id     uuid not null,

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

  constraint lucasfilm_dcp_metadata_asset_pkey primary key (metadata_run_id, lucasfilm_dcp_asset_id),

  -- FK-A and FK-B. See the header above; neither replaces the other.
  constraint lucasfilm_dcp_metadata_asset_run_fk
    foreign key (metadata_run_id, source_crawl_id)
    references plm.lucasfilm_dcp_metadata_run (metadata_run_id, source_crawl_id) on delete cascade,
  constraint lucasfilm_dcp_metadata_asset_membership_fk
    foreign key (source_crawl_id, lucasfilm_dcp_asset_id)
    references plm.lucasfilm_dcp_asset_crawl (crawl_id, lucasfilm_dcp_asset_id) on delete restrict,

  constraint lucasfilm_dcp_metadata_asset_fetch_status_chk check (
    fetch_status in ('pending','success','not_found','signed_out','rejected','failed')
  ),
  constraint lucasfilm_dcp_metadata_asset_attempts_chk check (attempt_count >= 0),
  constraint lucasfilm_dcp_metadata_asset_bytes_chk check (response_bytes is null or response_bytes >= 0),
  constraint lucasfilm_dcp_metadata_asset_http_chk check (http_status is null or http_status between 100 and 599),

  -- FAILURE-STATE COHERENCE, BOTH WAYS. A terminal failure without a code is an
  -- untriageable row; a code on a success is a contradiction that would make any
  -- "how did this run fail" query lie.
  constraint lucasfilm_dcp_metadata_asset_failure_coherence_chk check (
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
  --   plm.finalize_lucasfilm_dcp_metadata_run refuses to complete any run holding a successful row
  --   without BOTH digests. A missing normalized_hash is therefore transient within a
  --   single load statement and impossible in any completed run.
  constraint lucasfilm_dcp_metadata_asset_success_evidence_chk check (
    fetch_status <> 'success'
    or (raw_metadata is not null
        and jsonb_typeof(raw_metadata) = 'object'
        and retrieved_at is not null
        and source_hash is not null)
  ),
  -- A signed-out response must NOT retain a body. Storing it would keep a page of portal
  -- chrome in a licensor-confidential table for no diagnostic value.
  constraint lucasfilm_dcp_metadata_asset_signed_out_chk check (
    fetch_status <> 'signed_out' or raw_metadata is null
  ),
  -- Hashes exist only where a success produced them, and always in the enforced shape.
  constraint lucasfilm_dcp_metadata_asset_source_hash_chk
    check (source_hash is null or source_hash ~ '^[0-9a-f]{64}$'),
  constraint lucasfilm_dcp_metadata_asset_normalized_hash_chk
    check (normalized_hash is null or normalized_hash ~ '^[0-9a-f]{64}$'),
  constraint lucasfilm_dcp_metadata_asset_hash_only_on_success_chk check (
    fetch_status = 'success' or (source_hash is null and normalized_hash is null)
  ),

  -- Interpreted values may only exist where their raw source value exists. An interpreted
  -- boolean beside a NULL raw string is a value invented by the parser.
  constraint lucasfilm_dcp_metadata_asset_interpreted_needs_raw_chk check (
    (is_exclusive_interpreted is null or is_exclusive_raw is not null)
    and (is_embargoed_interpreted is null or is_embargoed_raw is not null)
    and (is_locked_interpreted   is null or is_locked_raw   is not null)
    and (release_date_interpreted is null or release_date_raw is not null)
    and (modified_at_interpreted  is null or modified_at_raw  is not null)
    and (file_size_bytes_interpreted is null or file_size_raw is not null)
    and (num_pages_interpreted    is null or num_pages_raw    is not null)
  ),
  constraint lucasfilm_dcp_metadata_asset_size_chk
    check (file_size_bytes_interpreted is null or file_size_bytes_interpreted >= 0),
  constraint lucasfilm_dcp_metadata_asset_pages_chk
    check (num_pages_interpreted is null or num_pages_interpreted >= 0),

  -- THE SUCCESS-ONLY LINK TARGET. This unique key exists for ONE reason: the three link
  -- tables carry a fetch_status column pinned to 'success' by CHECK and reference this
  -- key, which makes "a link may only hang off a SUCCESSFUL metadata row" a declarative
  -- guarantee instead of a loader promise. It also blocks the reverse hole: a row cannot
  -- be flipped from 'success' to 'failed' while links still point at it, because the FK
  -- has nothing left to reference.
  constraint lucasfilm_dcp_metadata_asset_success_key unique (metadata_run_id, lucasfilm_dcp_asset_id, fetch_status)
);

create index idx_lucasfilm_dcp_metadata_asset_asset on plm.lucasfilm_dcp_metadata_asset (lucasfilm_dcp_asset_id);
create index idx_lucasfilm_dcp_metadata_asset_status on plm.lucasfilm_dcp_metadata_asset (metadata_run_id, fetch_status);
create index idx_lucasfilm_dcp_metadata_asset_crawl on plm.lucasfilm_dcp_metadata_asset (source_crawl_id);
-- Supports "did this asset's metadata change between runs" without scanning a run.
create index idx_lucasfilm_dcp_metadata_asset_normalized_hash
  on plm.lucasfilm_dcp_metadata_asset (lucasfilm_dcp_asset_id, normalized_hash)
  where normalized_hash is not null;
-- The open-work index: which expected assets have not reached a terminal state yet.
create index idx_lucasfilm_dcp_metadata_asset_pending
  on plm.lucasfilm_dcp_metadata_asset (metadata_run_id)
  where fetch_status = 'pending';

comment on table plm.lucasfilm_dcp_metadata_asset is
'One row per EXPECTED asset per metadata run: the fetch outcome plus every scalar the DCP '
'Vault metadata response exposed, each preserved as the exact source text. Scalars are '
'NEVER written onto the stable plm.lucasfilm_dcp_asset row -- metadata is time-varying observation '
'data and overwriting it would lose the fact that a title, owner or restriction changed. '
'Two composite foreign keys, neither redundant: one pins this row to the source crawl its '
'RUN declared, the other proves that crawl actually observed this asset. Together they '
'make "metadata for an asset outside its source crawl" structurally impossible. SUCCESS '
'means a valid metadata OBJECT was stored -- it does NOT mean every Disney field is '
'present, because some assets legitimately omit fields.';
comment on column plm.lucasfilm_dcp_metadata_asset.fetch_status is
'pending | success | not_found | signed_out | rejected | failed. HTTP 200 IS NOT SUCCESS: '
'a signed-out Lucasfilm DCP Vault session returns 200 with a tiny zero-record body, which is why '
'signed_out is its own terminal value and why a success additionally requires raw_metadata '
'to be a JSON OBJECT. Only a `success` row may carry links.';
comment on column plm.lucasfilm_dcp_metadata_asset.raw_metadata is
'The exact metadata response as a JSON object, kept as evidence. It is EVIDENCE, not the '
'query surface -- the normalized columns and link tables exist precisely so consumers do '
'not each write their own JSON parser over licensor data. NULL on a signed_out row by '
'CHECK: a portal sign-out page has no diagnostic value and should not be retained.';
comment on column plm.lucasfilm_dcp_metadata_asset.source_hash is
'sha256 of the EXACT UTF-8 bytes of the successful raw response TEXT as received, before '
'any cast to jsonb. Deliberately digests the received text and not the parsed value: jsonb '
'canonicalises key order, whitespace, escaping and number form, so a digest taken after '
'the cast would be of something the portal never sent and the capture could not reproduce. '
'Case and whitespace changes in the response DO change this digest, which is the point -- '
'normalized_hash is the one that ignores them.';
comment on column plm.lucasfilm_dcp_metadata_asset.normalized_hash is
'plm.lucasfilm_dcp_metadata_row_hash over the 18 raw scalars and the four sorted link SETS. Changes '
'when the meaning changed; ignores array order. The *_interpreted columns are NOT in it. '
'Its serialization freezes on the first complete production load -- see section 0 of '
'migration 20260811050000.';
comment on column plm.lucasfilm_dcp_metadata_asset.rights_parse_confident is
'FALSE by default and FALSE whenever any rights value was not a spelling the loader has '
'explicitly been taught. The business meanings of isExclusive, isEmbargoed, isLocked and '
'status are UNKNOWN and require Disney''s licensing contact. An unknown value lands raw '
'with this flag false -- it never fails the load and it never coerces to a guess.';

-- =====================================================================================
-- SECTION 3. SOURCE IDENTITIES -- plm.lucasfilm_dcp_property, plm.lucasfilm_dcp_character, plm.lucasfilm_dcp_term
--
-- These three outlive any single metadata run, exactly as plm.lucasfilm_dcp_asset outlives any
-- single path crawl. A later run re-observing the same property is normal and must not be
-- an error, so they are NOT frozen wholesale -- only their SOURCE columns freeze once a
-- COMPLETE run has seen them (section 5.2).
--
-- READ RULE 1 AT THE HEAD OF THIS FILE BEFORE TOUCHING EITHER OF THE FIRST TWO.
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- 3.1 plm.lucasfilm_dcp_property -- one identity per distinct exact member of properties[]
-- -------------------------------------------------------------------------------------
create table plm.lucasfilm_dcp_property (
  id                  uuid primary key default gen_random_uuid(),
  source_system       text not null default 'lucasfilm_dcpvault' check (source_system = 'lucasfilm_dcpvault'),
  source_id           text not null,

  -- Populated ONLY if the portal separately exposes a human label. It is NEVER parsed out
  -- of the id, and it is NEVER used as a key -- see RULE 2. A display name derived from an
  -- id would look like source truth and be our invention.
  display_name        text null,

  first_seen_metadata_run_id uuid null
    references plm.lucasfilm_dcp_metadata_run(metadata_run_id) on delete set null,
  last_seen_metadata_run_id  uuid null
    references plm.lucasfilm_dcp_metadata_run(metadata_run_id) on delete set null,

  -- Reconciliation only. NULL at landing, never written by any loader.
  core_property_id    uuid null,
  resolved_at         timestamptz null,
  resolved_by         text null,
  resolution_note     text null,

  raw                 jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint lucasfilm_dcp_property_source_id_chk check (btrim(source_id) <> ''),
  constraint lucasfilm_dcp_property_display_name_chk
    check (display_name is null or btrim(display_name) <> ''),
  constraint lucasfilm_dcp_property_unique unique (source_system, source_id)
);

create index idx_lucasfilm_dcp_property_core on plm.lucasfilm_dcp_property (core_property_id)
  where core_property_id is not null;

comment on table plm.lucasfilm_dcp_property is
'One SOURCE IDENTITY per distinct exact member of the Lucasfilm DCP Vault metadata properties[] '
'array. A landing identity, NOT a canonical property: core_property_id is nullable, is '
'NULL at landing, and is written only by a later human-reviewed mapping -- no loader ever '
'sets it and nothing here creates, renames or deactivates a core.property row. Portal '
'TILES are not properties either; tile observations live in plm.lucasfilm_dcp_asset_tile_observation '
'and are a browsing filter, not Disney''s asserted property list.';

-- -------------------------------------------------------------------------------------
-- 3.2 plm.lucasfilm_dcp_character -- one identity per distinct exact member of character[]
--
-- IT HAS NO PROPERTY COLUMN AND NO PROPERTY FOREIGN KEY. THAT IS THE DESIGN, NOT AN
-- OMISSION, AND IT IS LOCKED. See RULE 1. Lucasfilm DCP Vault never asserts which property a
-- character belongs to; adding the column would create a slot that someone eventually
-- fills by pairing the two arrays on an asset, which fabricates relationships Disney
-- never stated. Disney OPA is the only source that asserts property-to-character, it has
-- its own plm.opa_* landing, and the two must not be folded together.
-- -------------------------------------------------------------------------------------
create table plm.lucasfilm_dcp_character (
  id                  uuid primary key default gen_random_uuid(),
  source_system       text not null default 'lucasfilm_dcpvault' check (source_system = 'lucasfilm_dcpvault'),
  source_id           text not null,
  display_name        text null,

  first_seen_metadata_run_id uuid null
    references plm.lucasfilm_dcp_metadata_run(metadata_run_id) on delete set null,
  last_seen_metadata_run_id  uuid null
    references plm.lucasfilm_dcp_metadata_run(metadata_run_id) on delete set null,

  core_character_id   uuid null,
  resolved_at         timestamptz null,
  resolved_by         text null,
  resolution_note     text null,

  raw                 jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint lucasfilm_dcp_character_source_id_chk check (btrim(source_id) <> ''),
  constraint lucasfilm_dcp_character_display_name_chk
    check (display_name is null or btrim(display_name) <> ''),
  constraint lucasfilm_dcp_character_unique unique (source_system, source_id)
);

create index idx_lucasfilm_dcp_character_core on plm.lucasfilm_dcp_character (core_character_id)
  where core_character_id is not null;

comment on table plm.lucasfilm_dcp_character is
'One SOURCE IDENTITY per distinct exact member of the Lucasfilm DCP Vault metadata character[] '
'array. THIS TABLE HAS NO PROPERTY COLUMN AND NO PROPERTY FOREIGN KEY, DELIBERATELY AND '
'PERMANENTLY. Lucasfilm DCP Vault never asserts which property a character belongs to. Adding such a '
'column creates a slot that is eventually filled by pairing properties[] with character[] '
'on the same asset -- one observed asset has NINE properties and ONE character, so that '
'pairing manufactures nine relationships Disney never stated, indistinguishable from real '
'ones forever. Disney OPA (plm.opa_*) is the only Disney source that directly asserts '
'property-to-character and must not be folded into this schema. A character is also NEVER '
'inferred from a folder or file name: assets were observed in character-named folders with '
'no character field at all, and a path is not an identifier assertion.';

-- -------------------------------------------------------------------------------------
-- 3.3 plm.lucasfilm_dcp_term -- reusable exact vocabulary for CLASSIFICATION arrays
--
-- artStyle[] and keyword[] are classifications, not business entities, so they share one
-- vocabulary table discriminated by term_kind rather than getting a table each. If a later
-- sample proves another field is an array, widen term_kind IN A NEW MIGRATION. Do NOT
-- overload this table with properties or characters -- those are entities with their own
-- reconciliation columns and their own locked independence rule.
-- -------------------------------------------------------------------------------------
create table plm.lucasfilm_dcp_term (
  id                  uuid primary key default gen_random_uuid(),
  source_system       text not null default 'lucasfilm_dcpvault' check (source_system = 'lucasfilm_dcpvault'),
  term_kind           text not null,
  source_value        text not null,

  first_seen_metadata_run_id uuid null
    references plm.lucasfilm_dcp_metadata_run(metadata_run_id) on delete set null,
  last_seen_metadata_run_id  uuid null
    references plm.lucasfilm_dcp_metadata_run(metadata_run_id) on delete set null,

  raw                 jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint lucasfilm_dcp_term_kind_chk check (term_kind in ('art_style','keyword')),
  constraint lucasfilm_dcp_term_source_value_chk check (btrim(source_value) <> ''),
  constraint lucasfilm_dcp_term_unique unique (source_system, term_kind, source_value)
);

comment on table plm.lucasfilm_dcp_term is
'Reusable EXACT source vocabulary for the Lucasfilm DCP Vault classification arrays. term_kind is '
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
-- Each is keyed by (metadata_run_id, lucasfilm_dcp_asset_id, <target>) so that:
--   * a duplicate array member collapses to ONE link (primary key) without rejecting the
--     response -- a repeated value in the source array is a source quirk, not a load
--     failure;
--   * links are per RUN, so yesterday's observation is never overwritten by today's;
--   * an EMPTY array is represented as ZERO link rows beside a SUCCESSFUL metadata row,
--     which is a completely different state from "no successful metadata row exists".
--
-- THE fetch_status COLUMN ON EACH LINK TABLE IS NOT DENORMALISATION. It is pinned to
-- 'success' by CHECK and carried into the composite foreign key against
-- lucasfilm_dcp_metadata_asset_success_key, which makes "a link may only hang off a SUCCESSFUL
-- metadata row" a guarantee the database enforces rather than a promise the loader makes.
-- It also closes the reverse hole: a metadata row cannot be flipped away from 'success'
-- while links still reference it.
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- 4.1 asset -> property. INDEPENDENT OF 4.2.
-- -------------------------------------------------------------------------------------
create table plm.lucasfilm_dcp_asset_property_observation (
  metadata_run_id uuid not null,
  lucasfilm_dcp_asset_id    uuid not null,
  lucasfilm_dcp_property_id uuid not null references plm.lucasfilm_dcp_property(id) on delete restrict,
  fetch_status    text not null default 'success',
  observed_at     timestamptz not null default now(),

  constraint lucasfilm_dcp_asset_property_obs_pkey
    primary key (metadata_run_id, lucasfilm_dcp_asset_id, lucasfilm_dcp_property_id),
  constraint lucasfilm_dcp_asset_property_obs_success_chk check (fetch_status = 'success'),
  constraint lucasfilm_dcp_asset_property_obs_asset_fk
    foreign key (metadata_run_id, lucasfilm_dcp_asset_id, fetch_status)
    references plm.lucasfilm_dcp_metadata_asset (metadata_run_id, lucasfilm_dcp_asset_id, fetch_status)
    on delete cascade
);

create index idx_lucasfilm_dcp_asset_property_obs_property
  on plm.lucasfilm_dcp_asset_property_observation (lucasfilm_dcp_property_id);
create index idx_lucasfilm_dcp_asset_property_obs_run
  on plm.lucasfilm_dcp_asset_property_observation (metadata_run_id);

comment on table plm.lucasfilm_dcp_asset_property_observation is
'Asset-to-property links observed in ONE metadata run. INDEPENDENT of '
'plm.lucasfilm_dcp_asset_character_observation: the two sets are never joined, zipped or '
'cross-produced, and no foreign key, trigger or loader statement relates them. Disney '
'returns properties[] and character[] as separate unordered arrays and asserts NOTHING by '
'their co-presence. ZERO rows here beside a SUCCESSFUL metadata row means "the portal '
'returned an empty property array" -- which is a real fact, entirely different from "no '
'successful metadata row exists". The composite FK carries fetch_status pinned to '
'''success'', so a link cannot hang off a failed, pending or signed-out fetch.';

-- -------------------------------------------------------------------------------------
-- 4.2 asset -> character. INDEPENDENT OF 4.1.
-- -------------------------------------------------------------------------------------
create table plm.lucasfilm_dcp_asset_character_observation (
  metadata_run_id  uuid not null,
  lucasfilm_dcp_asset_id     uuid not null,
  lucasfilm_dcp_character_id uuid not null references plm.lucasfilm_dcp_character(id) on delete restrict,
  fetch_status     text not null default 'success',
  observed_at      timestamptz not null default now(),

  constraint lucasfilm_dcp_asset_character_obs_pkey
    primary key (metadata_run_id, lucasfilm_dcp_asset_id, lucasfilm_dcp_character_id),
  constraint lucasfilm_dcp_asset_character_obs_success_chk check (fetch_status = 'success'),
  constraint lucasfilm_dcp_asset_character_obs_asset_fk
    foreign key (metadata_run_id, lucasfilm_dcp_asset_id, fetch_status)
    references plm.lucasfilm_dcp_metadata_asset (metadata_run_id, lucasfilm_dcp_asset_id, fetch_status)
    on delete cascade
);

create index idx_lucasfilm_dcp_asset_character_obs_character
  on plm.lucasfilm_dcp_asset_character_observation (lucasfilm_dcp_character_id);
create index idx_lucasfilm_dcp_asset_character_obs_run
  on plm.lucasfilm_dcp_asset_character_observation (metadata_run_id);

comment on table plm.lucasfilm_dcp_asset_character_observation is
'Asset-to-character links observed in ONE metadata run. INDEPENDENT of '
'plm.lucasfilm_dcp_asset_property_observation -- see that table''s comment and RULE 1 in migration '
'20260811050000. An asset with many properties and one character creates many rows THERE '
'and one row HERE, and NOTHING relates them. A character is never inferred from a folder '
'or file name. ZERO rows here beside a successful metadata row means the portal returned '
'no character for this asset, which the sample proved is common and legitimate.';

-- -------------------------------------------------------------------------------------
-- 4.3 asset -> classification term
-- -------------------------------------------------------------------------------------
create table plm.lucasfilm_dcp_asset_term_observation (
  metadata_run_id uuid not null,
  lucasfilm_dcp_asset_id    uuid not null,
  lucasfilm_dcp_term_id     uuid not null references plm.lucasfilm_dcp_term(id) on delete restrict,
  fetch_status    text not null default 'success',
  observed_at     timestamptz not null default now(),

  constraint lucasfilm_dcp_asset_term_obs_pkey
    primary key (metadata_run_id, lucasfilm_dcp_asset_id, lucasfilm_dcp_term_id),
  constraint lucasfilm_dcp_asset_term_obs_success_chk check (fetch_status = 'success'),
  constraint lucasfilm_dcp_asset_term_obs_asset_fk
    foreign key (metadata_run_id, lucasfilm_dcp_asset_id, fetch_status)
    references plm.lucasfilm_dcp_metadata_asset (metadata_run_id, lucasfilm_dcp_asset_id, fetch_status)
    on delete cascade
);

create index idx_lucasfilm_dcp_asset_term_obs_term on plm.lucasfilm_dcp_asset_term_observation (lucasfilm_dcp_term_id);
create index idx_lucasfilm_dcp_asset_term_obs_run on plm.lucasfilm_dcp_asset_term_observation (metadata_run_id);

comment on table plm.lucasfilm_dcp_asset_term_observation is
'Asset-to-classification-term links (art_style, keyword) observed in ONE metadata run. The '
'term_kind lives on plm.lucasfilm_dcp_term, so one link table covers both arrays without letting a '
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
-- service_role, so guarded SECURITY DEFINER functions are the only writing path
-- still available to the loader's role, which makes it the one an UPDATE/DELETE-only
-- trigger would leave completely unguarded. The concrete hole here: metadata run R
-- finalizes with its counts reconciled, and then a plain
--     insert into plm.lucasfilm_dcp_asset_character_observation (metadata_run_id, ...) values (R, ...);
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
create or replace function plm.lucasfilm_dcp_reject_completed_metadata_change()
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
  from plm.lucasfilm_dcp_metadata_run r
  where r.metadata_run_id = v_run;

  if v_status = 'complete' then
    raise exception
      'Lucasfilm DCP Vault metadata run % is COMPLETE and its evidence is immutable; % on %.% is '
      'refused. A refresh is a NEW metadata_run_id, never an edit of an old one -- editing '
      'completed evidence destroys the only record of what the portal actually returned.',
      v_run, tg_op, tg_table_schema, tg_table_name
      using errcode = 'P0001';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

comment on function plm.lucasfilm_dcp_reject_completed_metadata_change() is
'Row trigger freezing every RUN-SCOPED plm.lucasfilm_dcp_* metadata table once its owning '
'plm.lucasfilm_dcp_metadata_run reaches status complete. FIRES ON INSERT, UPDATE AND DELETE -- all '
'three, deliberately. INSERT is not an afterthought: section 6 of migration 20260811050000 '
'revokes every direct mutation from service_role, so guarded functions are the '
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
    'lucasfilm_dcp_metadata_asset',
    'lucasfilm_dcp_asset_property_observation',
    'lucasfilm_dcp_asset_character_observation',
    'lucasfilm_dcp_asset_term_observation'
  ]
  loop
    execute format(
      'create trigger %I before insert or update or delete on plm.%I '
      'for each row execute function plm.lucasfilm_dcp_reject_completed_metadata_change()',
      'trg_' || t || '_immutable', t);
  end loop;
end;
$$;

-- -------------------------------------------------------------------------------------
-- 5.1b plm.lucasfilm_dcp_metadata_run itself -- frozen once complete.
--
-- Attached separately because the run row's own key column is metadata_run_id, so the
-- generic function above would work, but the transition INTO 'complete' must still be
-- permitted. A trigger that refused every UPDATE on a complete run would also refuse the
-- UPDATE that MAKES it complete, and finalization could never run.
-- -------------------------------------------------------------------------------------
create or replace function plm.lucasfilm_dcp_metadata_run_freeze()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'complete' then
      raise exception 'Lucasfilm DCP Vault metadata run % is COMPLETE and may not be deleted. '
        'Deleting a completed run is how the record of what the portal returned stops '
        'existing; never destroy licensed evidence as a correction.', old.metadata_run_id
        using errcode = 'P0001';
    end if;
    return old;
  end if;

  -- OLD.status = 'complete' is the frozen state. The transition running -> complete is
  -- performed while OLD is still 'running', so finalization is unaffected by this guard.
  if old.status = 'complete' then
    raise exception 'Lucasfilm DCP Vault metadata run % is COMPLETE and immutable. A re-fetch is a '
      'NEW metadata_run_id, never an edit of a finished one.', old.metadata_run_id
      using errcode = 'P0001';
  end if;

  -- A run may never leave a terminal state for a live one. Without this, a `failed` run
  -- could be quietly reopened and finalized as though it had always succeeded.
  if old.status = 'failed' and new.status <> 'failed' then
    raise exception 'Lucasfilm DCP Vault metadata run % is FAILED and may not be reopened. Start a '
      'NEW run; the failed one stays as the record of what happened.', old.metadata_run_id
      using errcode = 'P0001';
  end if;

  -- The source crawl is the run's identity as much as its own id is. Re-pointing a run at
  -- a different crawl mid-flight would invalidate every membership check already passed.
  if new.source_crawl_id is distinct from old.source_crawl_id then
    raise exception 'Lucasfilm DCP Vault metadata run %: source_crawl_id is immutable. Re-pointing a '
      'run at a different crawl invalidates every membership check its rows already '
      'passed.', old.metadata_run_id using errcode = 'P0001';
  end if;

  if new.assets_expected is distinct from old.assets_expected then
    raise exception 'Lucasfilm DCP Vault metadata run %: assets_expected is fixed at begin time and '
      'is immutable. A run that could restate its own target could always report itself '
      'complete.', old.metadata_run_id using errcode = 'P0001';
  end if;

  return new;
end;
$$;

comment on function plm.lucasfilm_dcp_metadata_run_freeze() is
'Freeze for plm.lucasfilm_dcp_metadata_run itself. Refuses UPDATE and DELETE once status is '
'complete, refuses reopening a failed run, and pins source_crawl_id and assets_expected '
'for the run''s whole life. It reads OLD.status deliberately, so the running -> complete '
'transition that finalization performs is still allowed -- a guard written against '
'NEW.status would refuse the very UPDATE that completes the run and finalization could '
'never succeed. assets_expected is pinned because a run able to restate its own target '
'could always make succeeded + failed = expected balance.';

create trigger trg_lucasfilm_dcp_metadata_run_freeze
  before update or delete on plm.lucasfilm_dcp_metadata_run
  for each row execute function plm.lucasfilm_dcp_metadata_run_freeze();

-- -------------------------------------------------------------------------------------
-- 5.2 Stable identities: SOURCE columns freeze; OUR columns stay editable.
--
-- plm.lucasfilm_dcp_property, plm.lucasfilm_dcp_character and plm.lucasfilm_dcp_term outlive any single metadata run,
-- so they are NOT frozen wholesale -- a later run re-observing the same identity is normal.
--
-- What freezes: the SOURCE columns, once the row has been observed by any COMPLETE run.
-- What stays editable forever: last_seen_metadata_run_id, updated_at, and the
-- reconciliation columns -- those are OUR decisions, made after the fact, and are the
-- entire reason these tables have them.
-- DELETE is refused outright once a complete run has seen the row.
-- -------------------------------------------------------------------------------------
create or replace function plm.lucasfilm_dcp_reject_completed_metadata_identity_change()
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
  if tg_table_name = 'lucasfilm_dcp_property' then
    select exists (
      select 1 from plm.lucasfilm_dcp_asset_property_observation o
      join plm.lucasfilm_dcp_metadata_run r on r.metadata_run_id = o.metadata_run_id
      where o.lucasfilm_dcp_property_id = old.id and r.status = 'complete'
    ) into v_seen;
  elsif tg_table_name = 'lucasfilm_dcp_character' then
    select exists (
      select 1 from plm.lucasfilm_dcp_asset_character_observation o
      join plm.lucasfilm_dcp_metadata_run r on r.metadata_run_id = o.metadata_run_id
      where o.lucasfilm_dcp_character_id = old.id and r.status = 'complete'
    ) into v_seen;
  elsif tg_table_name = 'lucasfilm_dcp_term' then
    select exists (
      select 1 from plm.lucasfilm_dcp_asset_term_observation o
      join plm.lucasfilm_dcp_metadata_run r on r.metadata_run_id = o.metadata_run_id
      where o.lucasfilm_dcp_term_id = old.id and r.status = 'complete'
    ) into v_seen;
  else
    -- An unknown table means this trigger was attached somewhere it was not designed for.
    -- FAIL LOUDLY. Returning NEW here would install a guard that silently permits
    -- everything on the new table, which is worse than no guard at all.
    raise exception 'plm.lucasfilm_dcp_reject_completed_metadata_identity_change is attached to %.% '
      'which it does not know how to evaluate. Extend the function before attaching it.',
      tg_table_schema, tg_table_name using errcode = 'P0001';
  end if;

  if not v_seen then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    raise exception 'Lucasfilm DCP Vault: %.% row % has been observed by a COMPLETE metadata run and '
      'may not be deleted. Other runs reference this identity.',
      tg_table_schema, tg_table_name, old.id using errcode = 'P0001';
  end if;

  -- `id` is compared too. Without it an observed identity could be RE-KEYED -- every other
  -- column identical, a new primary key -- which breaks every link row pointing at it while
  -- looking like nothing changed.
  if tg_table_name = 'lucasfilm_dcp_term' then
    if new.id            is distinct from old.id
    or new.source_system is distinct from old.source_system
    or new.term_kind     is distinct from old.term_kind
    or new.source_value  is distinct from old.source_value
    or new.first_seen_metadata_run_id is distinct from old.first_seen_metadata_run_id
    or new.created_at    is distinct from old.created_at then
      raise exception 'Lucasfilm DCP Vault: the SOURCE columns of %.% row % are immutable once a '
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
      raise exception 'Lucasfilm DCP Vault: the SOURCE columns of %.% row % are immutable once a '
        'COMPLETE metadata run has observed it. last_seen_metadata_run_id, updated_at and '
        'the reconciliation columns remain editable -- those are our decisions, not the '
        'portal''s.', tg_table_schema, tg_table_name, old.id using errcode = 'P0001';
    end if;
  end if;

  return new;
end;
$$;

comment on function plm.lucasfilm_dcp_reject_completed_metadata_identity_change() is
'Row trigger for the STABLE metadata identities (plm.lucasfilm_dcp_property, plm.lucasfilm_dcp_character, '
'plm.lucasfilm_dcp_term). These outlive any single run, so they are NOT frozen wholesale -- a later '
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
  foreach t in array array['lucasfilm_dcp_property','lucasfilm_dcp_character','lucasfilm_dcp_term']
  loop
    execute format(
      'create trigger %I before update or delete on plm.%I '
      'for each row execute function plm.lucasfilm_dcp_reject_completed_metadata_identity_change()',
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
-- THE POSTURE, identical to Phase 1: service_role keeps SELECT only; INSERT, UPDATE, DELETE,
-- TRUNCATE, REFERENCES, TRIGGER and MAINTAIN are revoked; public and anon get `revoke all`.
-- =====================================================================================
do $$
declare t text;
begin
  foreach t in array array[
    'lucasfilm_dcp_metadata_run','lucasfilm_dcp_metadata_asset',
    'lucasfilm_dcp_property','lucasfilm_dcp_character','lucasfilm_dcp_term',
    'lucasfilm_dcp_asset_property_observation','lucasfilm_dcp_asset_character_observation',
    'lucasfilm_dcp_asset_term_observation'
  ]
  loop
    execute format(
      'revoke insert, update, delete, truncate, references, trigger, maintain on plm.%I from service_role', t);
    execute format('revoke all on plm.%I from public', t);
    execute format('revoke all on plm.%I from anon', t);
    execute format('grant select on plm.%I to service_role', t);
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
    'lucasfilm_dcp_metadata_run','lucasfilm_dcp_metadata_asset',
    'lucasfilm_dcp_property','lucasfilm_dcp_character','lucasfilm_dcp_term',
    'lucasfilm_dcp_asset_property_observation','lucasfilm_dcp_asset_character_observation',
    'lucasfilm_dcp_asset_term_observation'
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
    'lucasfilm_dcp_metadata_asset','lucasfilm_dcp_asset_property_observation',
    'lucasfilm_dcp_asset_character_observation','lucasfilm_dcp_asset_term_observation'
  ]) as t
  where not exists (
    select 1 from information_schema.columns c
    where c.table_schema = 'plm' and c.table_name = t
      and c.column_name = 'metadata_run_id'
  );
  if v_missing is not null then
    raise exception 'DCP metadata landing self-check FAILED: table(s) % are attached to '
      'plm.lucasfilm_dcp_reject_completed_metadata_change but have no metadata_run_id column. The '
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
      and c.column_name in ('lucasfilm_dcp_property_id','lucasfilm_dcp_character_id')
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
    and table_name ~ '^lucasfilm_dcp_.*propert.*character|^lucasfilm_dcp_.*character.*propert';
  if v_count > 0 then
    raise exception 'DCP metadata landing self-check FAILED: a plm.lucasfilm_dcp_* property-character '
      'table exists. No such table may ever be created -- see RULE 1 in migration '
      '20260811050000.';
  end if;

  -- 8.4 The Phase-1 frozen hash must still exist and must NOT have been redefined into a
  -- different signature by anything in this migration. It is a ONE-WAY DOOR over ~155,900
  -- rows and this migration's contract is that it did not touch it.
  select count(*) into v_count
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'plm' and p.proname = 'lucasfilm_dcp_asset_row_hash';
  if v_count <> 1 then
    raise exception 'DCP metadata landing self-check FAILED: expected exactly ONE '
      'plm.lucasfilm_dcp_asset_row_hash, found %. The Phase-1 row hash is frozen over roughly '
      '155,900 rows; this migration must not add, replace or overload it.', v_count;
  end if;

  -- 8.5 Every one of the eight new tables must have RLS enabled AND a read policy. A
  -- GRANT is not a POLICY; a table with RLS enabled and no policy is unreadable, and a
  -- table with a policy and no RLS is wide open. Both halves are asserted.
  select string_agg(t, ', ') into v_missing
  from unnest(array[
    'lucasfilm_dcp_metadata_run','lucasfilm_dcp_metadata_asset','lucasfilm_dcp_property','lucasfilm_dcp_character','lucasfilm_dcp_term',
    'lucasfilm_dcp_asset_property_observation','lucasfilm_dcp_asset_character_observation',
    'lucasfilm_dcp_asset_term_observation'
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

  -- 8.6 service_role must hold NO direct mutating privilege on any of the eight tables.
  -- TRUNCATE above all: it fires no row trigger, so one TRUNCATE would erase a completed
  -- run's evidence with every section 5 guard silently standing by.
  select string_agg(distinct t || '/' || priv, ', ') into v_missing
  from unnest(array[
    'lucasfilm_dcp_metadata_run','lucasfilm_dcp_metadata_asset','lucasfilm_dcp_property','lucasfilm_dcp_character','lucasfilm_dcp_term',
    'lucasfilm_dcp_asset_property_observation','lucasfilm_dcp_asset_character_observation',
    'lucasfilm_dcp_asset_term_observation'
  ]) as t,
  unnest(array['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) as priv
  where has_table_privilege('service_role', 'plm.' || quote_ident(t), priv);
  if v_missing is not null then
    raise exception 'DCP metadata landing self-check FAILED: service_role still holds '
      'mutating privileges: %. TRUNCATE in particular fires NO row triggers, so every '
      'immutability guarantee in section 5 depends on these revokes.', v_missing;
  end if;

  raise notice 'DCP metadata landing self-checks passed: 8 tables, RLS + policies present, '
    'no property-character bridge, Phase-1 frozen hash untouched, service_role holds no '
    'direct mutating privilege.';
end;
$$;


-- Marvel DCP Vault
-- =====================================================================================
-- Disney Marvel DCP Vault -- source-observation landing schema.
--
-- Migration: 20260810190000_marvel_dcp_vault_source_landing.sql
-- Issue:     u2giants/shared-db #665. Object claim: #725 -- this migration owns the
--            plm.marvel_dcp_* namespace and touches NOTHING else.
-- Design:    licensor-source-data-disney/disney-dcpvault/
--            NORMALIZED-database-schema-design-20260810.md (PRIVATE repo).
-- Pattern:   20260810020000 (Paramount landing: privilege predicate, immutability
--            triggers, capture freeze), 20260810110000 (Warner: the PostgreSQL 17
--            revoke set and the RLS read gate), 20260807190000 (the read gate's origin).
-- Follows:   20260810190100 completes this build with the chunked loader protocol.
--            The two are bound by a co-presence rule in
--            scripts/production_migration_guard.py: 20260810190100 may not be promoted
--            without this migration.
--
-- SCHEMA ONLY. THIS MIGRATION LOADS NO DATA.
--
-- -------------------------------------------------------------------------------------
-- CONFIDENTIALITY. u2giants/shared-db is a PUBLIC repository. The Marvel DCP Vault extract is
-- licensor-confidential Disney data held in the PRIVATE repository
-- u2giants/licensor-source-data-disney. Not one Disney tile slug, property name,
-- franchise, style-guide folder, region, DAM path, file name or portal URL appears in
-- this file, in any comment, in any CHECK constraint, in any error message, or in the
-- contract test. Only COUNTS and SCHEMA appear, which design section 9 permits.
--     SCHEMA IN GIT. DATA OUT OF GIT.
-- Error messages below report counts and identifiers, never source values, because this
-- database's logs are not private either.
--
-- =====================================================================================
-- SECTION -1. THE FIVE DECISIONS THAT DIVERGE FROM THE DESIGN DOCUMENT, AND WHY
-- =====================================================================================
--
-- DECISION 1 -- SCHEMA AND NAMING: plm.marvel_dcp_*, NOT ingest.portal_*.
--   The design places these tables in an `ingest` schema under licensor-generic names
--   (portal_asset, portal_tile, ...). Overruled by owner ruling, for three reasons that
--   are recorded here so a future reader does not "restore" the design:
--
--   (a) PRECEDENT. Every prior licensor lands in plm.<prefix>_*: plm.pmt_* (Paramount,
--       20260810020000), plm.wb_* (Warner, 20260810030000), plm.nbcu_* (20260810070000),
--       plm.opa_* (Disney OPA, 20260807170000). A fifth licensor in a different schema
--       under a different naming convention would be the only one, and every generic
--       tool in this repo that enumerates landing tables keys on plm.
--
--   (b) THE DEFAULT-PRIVILEGE HOLE (issue #649). VERIFIED LIVE on 2026-08-10 by a
--       read-only Management API SELECT against pg_default_acl on BOTH projects
--       (production qsllyeztdwjgirsysgai and preview rjyboqwcdzcocqgmsyel, both
--       PostgreSQL 17.6). BOTH schemas currently read:
--           schema ingest, objtype r, acl {service_role=arwdDxtm/postgres}
--           schema plm,    objtype r, acl {service_role=arwdDxtm/postgres}
--       `arwdDxtm` is all eight table bits -- INSERT, SELECT, UPDATE, DELETE, TRUNCATE,
--       REFERENCES, TRIGGER and (PG17) MAINTAIN. A table created in EITHER schema is
--       BORN holding TRUNCATE for service_role, and TRUNCATE DOES NOT FIRE ROW TRIGGERS,
--       which would void every immutability guarantee in section 6 below with one
--       statement.
--
--       CORRECTION TO THE DISPATCH, RECORDED HONESTLY. The ruling that authorised this
--       migration stated that 20260810180000 has already narrowed `plm`, so plm tables
--       inherit the fix while ingest tables do not. The live read above shows
--       20260810180000 IS NOT YET APPLIED to production or to preview -- `plm` still
--       carries the full arwdDxtm default today. So the inheritance argument is a FUTURE
--       property, not a present one, and this migration DOES NOT RELY ON IT. Section 7
--       revokes the complete PostgreSQL 17 set explicitly on every table it creates,
--       immediately after creating it, and would be correct even if 20260810180000 were
--       never promoted. Reason (b) still favours plm over ingest -- plm is the schema
--       the fix is coming to and ingest is not -- but it is a tie-breaker here, not the
--       load-bearing protection. The load-bearing protection is section 7.
--
--   (c) NAMESPACE. `ingest.portal_asset` squats a licensor-generic name in a shared
--       schema. The next portal to land would have to either share these tables or pick
--       a worse name. #665's own direction is per-licensor landing.
--
-- DECISION 2 -- NO api.* VIEWS, DELIBERATELY.
--   Paramount ships 8 api.pmt_* views; this build ships ZERO, and that is a CHOICE, not
--   an omission. No application reads Marvel DCP Vault data today: there is no PopDAM screen, no
--   dflow screen and no report behind it. An api view is a published read contract that
--   must then be versioned and kept stable forever, and publishing one before a caller
--   exists fixes a shape nobody has validated. When the first reader appears, it brings
--   its required columns with it and the view is authored then, in its own migration.
--   Until then plm.marvel_dcp_* is reachable directly by the approved roles under section 8's
--   RLS gate. THIS SENTENCE EXISTS SO NOBODY LATER READS THE ABSENCE AS AN OVERSIGHT.
--
-- DECISION 3 -- crawl_section_id IS NULLABLE, AND THAT IS THE HONEST SIGNAL.
--   Design section 4.8 makes crawl_section_id the "exact query that proved the link" and
--   also warns against manufacturing a cross-product from an already-aggregated row.
--   Those two requirements collide on the CSV that exists today: that file is ALREADY
--   AGGREGATED -- one row per DAM path carrying a pipe-joined tile list and two boolean
--   listing flags -- so the specific portal query that returned each tile/file pair was
--   not preserved and CANNOT be reconstructed. Writing a section id anyway would
--   manufacture exactly the false precision 4.8 forbids; making the column NOT NULL would
--   make the backfill unloadable.
--   RESOLUTION: crawl_section_id is NULLABLE, paired with a NOT NULL `link_evidence`
--   column and a CHECK that binds the two (section 5.6). 'section_query' REQUIRES a
--   section id; 'aggregated_row' REQUIRES the id to be NULL. The first load therefore
--   records, in the data itself, that it holds lower-fidelity truth than a future
--   section-aware crawl, and a consumer that needs proven provenance filters on
--   link_evidence = 'section_query'. The alternative -- a NOT NULL column filled with a
--   synthetic "CSV backfill" section -- would have made the two grades indistinguishable
--   forever.
--
-- DECISION 4 -- file_extension IS A PLAIN LOADER-COMPUTED COLUMN, NOT GENERATED.
--   A `GENERATED ... STORED` column is populated by PostgreSQL AFTER all BEFORE-row
--   triggers have run. Every immutability trigger in section 6 is a BEFORE trigger, so it
--   would read NULL for a generated file_extension on every row, compare NULL to NULL,
--   never fire -- and the migration would apply perfectly clean while the guard did
--   nothing. The column is therefore plain, computed by the loader, and constrained by
--   CHECK to the lowercase, dot-free shape the design requires.
--
-- DECISION 5 -- NO CHANGE TO dam.style_guide_file.
--   Design section 5 and change 7 ask for a nullable dam.style_guide_file.style_guide_id
--   before promotion. Confirmed live on both projects that the column does not exist
--   today. It is OUT OF SCOPE here by owner ruling: it alters a SHARED table PopDAM
--   reads, it is on a different review track, and nothing in this landing schema needs
--   it. THIS MIGRATION CREATES NO PROMOTION PATH AT ALL -- see the reconciliation
--   boundary below.
--
-- -------------------------------------------------------------------------------------
-- RECONCILIATION BOUNDARY. Nothing here creates, renames, merges, reparents, deactivates
-- or deletes a canonical core.* or dam.* record. The nullable core_property_id and
-- core_style_guide_id pointers are READ-ONLY reconciliation columns, NULL at landing,
-- always, and set only by a later reviewed decision. Specifically, per design section 3:
--   * A portal tile is NOT a property. Nothing here may write tile text into
--     core.property, and there is no function in this migration that could.
--   * This extract captured NO file-to-character relationship. No character table, no
--     character link table, and no character column is created. Do not add one from this
--     source.
-- =====================================================================================

-- =====================================================================================
-- SECTION 0. The privilege predicate.
--
-- THE NULL-PERMISSIVE TRAP THIS AVOIDS. This shape is FORBIDDEN:
--     if not ( ... or auth.role() = 'service_role' ) then raise ...
-- Inside a migration auth.role() is NULL. `NULL = 'service_role'` is NULL, `false or NULL`
-- is NULL, and `if not NULL then` NEVER RUNS THE BODY. The guard reads strict and behaves
-- wide open. Contract: TRUE only on a NON-NULL, NON-EMPTY, POSITIVELY MATCHED identity.
--
-- It is a FUNCTION and not a DO block precisely so a contract test can CALL it and prove
-- the NULL case is rejected; an anonymous block never lands in pg_proc and cannot be
-- tested. It takes SESSION_USER, not CURRENT_USER: SECURITY DEFINER rewrites current_user
-- to the function owner, so a current_user check inside a definer function always passes
-- and guards nothing.
-- =====================================================================================
create or replace function plm.marvel_dcp_loader_privilege_ok(
  p_role         text,
  p_session_user text
)
returns boolean
language sql
immutable
-- Pinned even though this is NOT a SECURITY DEFINER function and calls only builtins.
-- An IMMUTABLE function with an unpinned search_path is the shape that becomes a problem
-- the day someone adds a schema-qualified callee to it, and pinning costs nothing today.
set search_path = pg_catalog
as $$
  select
    (p_role is not null and btrim(p_role) = 'service_role')
    or
    (p_session_user is not null
     and btrim(p_session_user) in ('postgres', 'supabase_admin'));
$$;

comment on function plm.marvel_dcp_loader_privilege_ok(text, text) is
'Privilege predicate for the Disney Marvel DCP Vault loader. TRUE only for a NON-NULL, '
'positively matched identity: JWT role service_role, or session_user postgres/'
'supabase_admin. NULL or empty on BOTH arguments returns FALSE -- which is the case that '
'holds inside a migration, where auth.role() is NULL. Written as a callable function '
'rather than a DO block so a contract test can prove the NULL case is rejected.';

revoke all on function plm.marvel_dcp_loader_privilege_ok(text, text) from public;
grant execute on function plm.marvel_dcp_loader_privilege_ok(text, text) to authenticated, service_role;

-- =====================================================================================
-- SECTION 1. THE FROZEN CANONICAL ROW-HASH SERIALIZATION
--
-- ***** THIS SPECIFICATION IS FROZEN. IT IS A ONE-WAY DOOR. *****
--
-- plm.marvel_dcp_asset_crawl.observed_row_hash is the ONLY mechanism that detects a changed row
-- between crawls. Once roughly 155,900 rows carry a hash, changing ANY detail of this
-- serialization -- the field list, their order, the separators, the null encoding, the
-- sort collation, the text encoding, the case handling -- invalidates every stored hash
-- at once. Every asset then compares unequal on the next crawl, change detection reports
-- a total rewrite that never happened, and the only correction is a FULL RE-CAPTURE of
-- the entire portal. The design mandated "a documented canonical serialization" and never
-- documented one; this section is that document, and it is normative.
--
-- DO NOT "optimise", "tidy", "simplify" or "modernise" plm.marvel_dcp_asset_row_hash. If a new
-- field must enter the hash, that is a NEW function under a NEW name and a NEW column,
-- with an explicit re-hash plan. Never a redefinition of this one.
--
-- -------------------------------------------------------------------------------------
-- THE SPECIFICATION, IN FULL
-- -------------------------------------------------------------------------------------
-- observed_row_hash = lower(encode(sha256(convert_to(S, 'UTF8')), 'hex'))
--   -- exactly 64 lowercase hexadecimal characters.
--
-- S is the concatenation of EXACTLY EIGHT slots, in EXACTLY this order, with NO other
-- content before, between or after them:
--
--   slot 1  source_system            -- as stored on plm.marvel_dcp_asset
--   slot 2  source_path              -- the full DAM path, verbatim as stored
--   slot 3  file_name                -- verbatim as stored
--   slot 4  file_extension           -- as STORED, i.e. already lowercased, no dot
--   slot 5  relative_folder_path     -- as stored; NULL is a real and expected value
--   slot 6  style_guide_source_path  -- the owning guide's full source path, as stored
--   slot 7  style_guide_source_id    -- the Disney guide id, as stored; NULL is expected
--   slot 8  tile_key_list            -- see TILE LIST below
--
-- EACH SLOT is emitted as three parts, in order:
--     presence_flag || value_text || U+001F
--   * presence_flag is the single ASCII character '+' when the value IS NOT NULL, and
--     '-' when the value IS NULL.
--   * value_text is the empty string when the value is NULL, and the value's exact
--     characters otherwise. No trimming, no case folding, no normalisation, no escaping.
--   * U+001F (ASCII 31, UNIT SEPARATOR) terminates EVERY slot INCLUDING THE EIGHTH.
--     A terminator on the last slot is deliberate: without it a trailing NULL or empty
--     value would be indistinguishable from an absent slot.
--
--   The presence flag is what makes NULL and the empty string DIFFERENT inputs. A scheme
--   that renders NULL as '' collides the two, and both occur in this data (design section
--   2 records one row with a blank folder subpath, and 88,125 files with no guide id).
--
-- CASE, AND WHERE NORMALISATION IS ALLOWED TO LIVE: every slot is hashed exactly AS
--   STORED. There is NO case folding and NO trimming anywhere in the serialization.
--   Loaders may of course normalise a value BEFORE storing it -- lowercasing an extension,
--   trimming a tile key, folding a blank folder path to NULL -- and the hash then digests
--   that stored result. file_extension is lowercase in the hash ONLY because the loader
--   stores it lowercase (a CHECK constraint enforces that), not because the hash
--   lowercases it. THE RULE THAT MATTERS: the hash never sees an input value that differs
--   from what the database holds. A caller that passes a row's raw input instead of the
--   value the upsert actually left behind has violated this specification even though the
--   function will happily hash it -- the two diverge exactly where the loader declined to
--   overwrite a stored value, which is precisely the case worth detecting.
--
-- TILE LIST (slot 8): the SET of plm.marvel_dcp_portal_tile.source_key values ACTUALLY LINKED to
--   this asset in THIS crawl -- that is, read back from plm.marvel_dcp_asset_tile_observation
--   after the links have been written, never taken from an input row's tile list before
--   they were. Duplicates removed, sorted ASCENDING using the `C` COLLATION (raw byte
--   order), and joined with a single U+001E (ASCII 30, RECORD SEPARATOR) between adjacent
--   elements, with NO leading or trailing U+001E. The distinction is not academic: a row
--   whose links are deliberately withheld (both listing flags set on an aggregated row)
--   must hash with NO tiles, because no tiles were linked.
--   * The `C` collation is REQUIRED and is not incidental. The database's default
--     collation is locale-dependent and can order the same two strings differently on a
--     different server or after a libc upgrade; a locale-sorted list would silently
--     change the hash of unchanged data. Byte order is stable forever.
--   * An asset with NO tiles in the crawl passes an EMPTY ARRAY, which serialises to
--     presence flag '+' and an empty value_text. It is NOT NULL. Passing NULL here means
--     "the tile set was not observed", which is a different fact and hashes differently.
--
-- SEPARATOR SAFETY: U+001F and U+001E are C0 control characters that cannot occur in a
--   DAM path, file name or tile slug. Rather than trust that, the function REFUSES any
--   input containing either character. Escaping was rejected on purpose: an escape rule
--   is a second thing that can be implemented differently by a future re-implementation,
--   and a hard refusal cannot be got wrong. A refused row is a load exception, not a
--   silently different hash.
--
-- WHY THE HASH IS COMPUTED IN THE DATABASE AND NOT BY THE LOADER: so there is exactly ONE
--   implementation of this specification, in one place, callable and testable. A loader
--   that computed it in JavaScript would be a second implementation, and two
--   implementations of a frozen scheme is how a frozen scheme stops being frozen.
-- =====================================================================================
create or replace function plm.marvel_dcp_asset_row_hash(
  p_source_system           text,
  p_source_path             text,
  p_file_name               text,
  p_file_extension          text,
  p_relative_folder_path    text,
  p_style_guide_source_path text,
  p_style_guide_source_id   text,
  p_tile_keys               text[]
)
returns text
language plpgsql
immutable
-- Pinned for the same reason as plm.marvel_dcp_loader_privilege_ok above: not definer, builtins
-- only today, but this is the FROZEN hash and it must never become resolution-dependent.
set search_path = pg_catalog
as $$
declare
  v_us   constant text := chr(31);   -- UNIT SEPARATOR, slot terminator
  v_rs   constant text := chr(30);   -- RECORD SEPARATOR, tile-list joiner
  v_slots text[] := array[
    p_source_system, p_source_path, p_file_name, p_file_extension,
    p_relative_folder_path, p_style_guide_source_path, p_style_guide_source_id
  ];
  v_s    text := '';
  v_tile text;
  v_join text;
  v      text;
  i      integer;
begin
  -- Separator safety, checked BEFORE any concatenation, on every slot and every tile key.
  for i in 1 .. array_length(v_slots, 1) loop
    v := v_slots[i];
    if v is not null and (position(v_us in v) > 0 or position(v_rs in v) > 0) then
      raise exception 'DCP row hash refused: field % contains a reserved separator '
        '(U+001F or U+001E). The canonical serialization does not escape; such a row must '
        'be recorded in plm.marvel_dcp_load_exception instead. No value is echoed here because '
        'this database''s logs are not private.', i using errcode = 'P0001';
    end if;
    v_s := v_s || (case when v is null then '-' else '+' end) || coalesce(v, '') || v_us;
  end loop;

  -- Slot 8. NULL array means "tile set not observed" and is NOT the same as an empty set.
  if p_tile_keys is null then
    v_s := v_s || '-' || v_us;
  else
    foreach v_tile in array p_tile_keys loop
      if v_tile is null then
        raise exception 'DCP row hash refused: the tile key array contains a NULL element. '
          'Pass an empty array for "no tiles", or NULL for "not observed"; a NULL element '
          'is neither and has no defined serialization.' using errcode = 'P0001';
      end if;
      if position(v_us in v_tile) > 0 or position(v_rs in v_tile) > 0 then
        raise exception 'DCP row hash refused: a tile key contains a reserved separator '
          '(U+001F or U+001E).' using errcode = 'P0001';
      end if;
    end loop;

    -- DISTINCT, then ORDER BY ... COLLATE "C". Both are load-bearing; see the spec above.
    select coalesce(string_agg(k, v_rs order by k collate "C"), '')
      into v_join
      from (select distinct unnest(p_tile_keys) as k) d;

    v_s := v_s || '+' || v_join || v_us;
  end if;

  return lower(encode(sha256(convert_to(v_s, 'UTF8')), 'hex'));
end;
$$;

comment on function plm.marvel_dcp_asset_row_hash(text, text, text, text, text, text, text, text[]) is
'THE FROZEN canonical row-hash serialization for plm.marvel_dcp_asset_crawl.observed_row_hash. '
'sha256, lowercase hex, over UTF-8 bytes of eight slots in a fixed order, each emitted as '
'presence-flag (''+'' present / ''-'' NULL) then the verbatim value then U+001F -- '
'terminator included on the last slot. Slot 8 is the crawl''s tile-key SET: deduplicated, '
'sorted with COLLATE "C" (byte order, locale-proof), joined with U+001E; an empty array is '
'"no tiles" and NULL is "not observed", and they hash differently. No case folding, no '
'trimming, no escaping -- a value containing a reserved separator is REFUSED so it becomes '
'a load exception rather than a silently different hash. THIS IS A ONE-WAY DOOR: about '
'155,900 rows will carry these hashes, and changing any detail invalidates all of them and '
'forces a full re-capture. Never redefine this function. A new field means a NEW function, '
'a NEW column and an explicit re-hash plan. The full normative specification is in '
'section 1 of migration 20260810190000.';

revoke all on function plm.marvel_dcp_asset_row_hash(text, text, text, text, text, text, text, text[]) from public;
grant execute on function plm.marvel_dcp_asset_row_hash(text, text, text, text, text, text, text, text[])
  to authenticated, service_role;

-- =====================================================================================
-- SECTION 2. plm.marvel_dcp_crawl -- one row per scrape run (design 4.1)
--
-- PROVENANCE ONLY. No asset data lives on this row.
-- =====================================================================================
create table plm.marvel_dcp_crawl (
  crawl_id                uuid primary key default gen_random_uuid(),

  source_system           text not null default 'marvel_dcpvault' check (source_system = 'marvel_dcpvault'),
  status                  text not null default 'planned',

  -- The SNAPSHOT date, supplied EXPLICITLY by the caller and never derived from now().
  -- This server runs America/New_York: a midnight-UTC timestamptz read back through
  -- ::date lands on the PREVIOUS day and would silently misdate the capture. Any
  -- timestamptz on these tables that is later compared as a date must be pinned to
  -- midday UTC by its writer for the same reason.
  captured_on             date not null,

  portal_base_url         text not null,          -- ORIGIN ONLY. Never a signed URL.
  crawler_version         text not null,
  account_scope           text not null,          -- non-secret entitlement description
  line_of_business        text not null,

  started_at              timestamptz not null,
  finished_at             timestamptz null,

  -- Declared UP FRONT by the loader from the extract manifest. finalize refuses unless
  -- the landed counts match. Deriving them at the end would let a truncated extract
  -- define its own expectation and certify itself.
  rows_received           integer null,
  distinct_assets_received integer null,

  captured_by             text not null,
  private_source_commit   text not null,
  failure_message         text null,
  notes                   text null,
  metadata                jsonb not null default '{}'::jsonb,

  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  constraint marvel_dcp_crawl_status_chk
    check (status in ('planned','running','partial','complete','failed')),
  constraint marvel_dcp_crawl_source_system_chk check (source_system = 'marvel_dcpvault'),
  constraint marvel_dcp_crawl_base_url_chk       check (btrim(portal_base_url) <> ''),
  constraint marvel_dcp_crawl_crawler_version_chk check (btrim(crawler_version) <> ''),
  constraint marvel_dcp_crawl_account_scope_chk  check (btrim(account_scope) <> ''),
  constraint marvel_dcp_crawl_lob_chk            check (btrim(line_of_business) <> ''),
  constraint marvel_dcp_crawl_captured_by_chk    check (btrim(captured_by) <> ''),
  constraint marvel_dcp_crawl_commit_chk         check (btrim(private_source_commit) <> ''),
  constraint marvel_dcp_crawl_counts_chk check (
    (rows_received is null or rows_received >= 0)
    and (distinct_assets_received is null or distinct_assets_received >= 0)
  ),

  -- COMPLETE is the strongest claim this schema can make, so each part of it is a CHECK
  -- and not a convention. Section completeness and gap closure are enforced by
  -- plm.finalize_marvel_dcp_crawl (20260810190100) because they are set-level facts a row CHECK
  -- cannot see; what a row CHECK CAN prove is asserted here so finalize cannot fake it.
  constraint marvel_dcp_crawl_complete_requires_evidence_chk check (
    status <> 'complete'
    or (
      finished_at is not null
      and rows_received is not null
      and distinct_assets_received is not null
      and failure_message is null
    )
  ),
  constraint marvel_dcp_crawl_failed_requires_message_chk check (
    status <> 'failed' or btrim(coalesce(failure_message, '')) <> ''
  )
);

create index idx_marvel_dcp_crawl_status on plm.marvel_dcp_crawl (status, started_at desc);
create index idx_marvel_dcp_crawl_latest_complete
  on plm.marvel_dcp_crawl (captured_on desc, crawl_id desc) where status = 'complete';

comment on table plm.marvel_dcp_crawl is
'One row per Disney Marvel DCP Vault scrape run. PROVENANCE ONLY -- no asset data lives here. '
'CRAWL-VERSIONED: every completed crawl is retained permanently and a refresh is a NEW '
'crawl_id, never an edit of an old one. SCOPE: POP Creations'' licensed Marvel DCP Vault account '
'and the portal''s CURRENT view. PRESENCE IS EVIDENCE; ABSENCE IS NOT A DELETE INSTRUCTION '
'AND NOT PROOF OF NONEXISTENCE. A crawl reaches status = complete only through '
'plm.finalize_marvel_dcp_crawl, which additionally requires every section complete and every gap '
'resolved or waived -- set-level facts no row CHECK can see. Licensor-confidential data: '
'never publish a row and NEVER commit one to this PUBLIC repository.';
comment on column plm.marvel_dcp_crawl.captured_on is
'The SNAPSHOT date, supplied explicitly and NEVER derived from now(). The server runs '
'America/New_York, so a midnight-UTC timestamp read through ::date lands on the previous '
'day and would misdate the crawl by one day, silently.';
comment on column plm.marvel_dcp_crawl.portal_base_url is
'ORIGIN ONLY (scheme + host). Never a signed download URL, never a session-bearing URL, '
'never a query string carrying a token.';
comment on column plm.marvel_dcp_crawl.rows_received is
'INPUT rows the extract claims to carry, declared UP FRONT from its manifest. Legitimately '
'EXCEEDS distinct_assets_received: the extract contains exact duplicate rows for the same '
'DAM path, which are collapsed on load. The difference is not loss.';
comment on column plm.marvel_dcp_crawl.distinct_assets_received is
'DISTINCT DAM paths the extract claims to carry, declared UP FRONT. finalize compares it '
'to what actually landed and refuses on a mismatch.';

-- =====================================================================================
-- SECTION 3. plm.marvel_dcp_portal_tile -- the portal browsing tiles (design 4.4)
--
-- Called a PORTAL TILE, never a property or a franchise. The extract proves a browse
-- category and nothing more (design section 3). There is deliberately NO allow-list
-- CHECK on source_key: see the completeness note on plm.marvel_dcp_crawl_section.
--
-- STABLE IDENTITY table: rows outlive any one crawl. first/last_seen_crawl_id are
-- convenience pointers and are ON DELETE SET NULL, so deleting an unpromoted crawl leaves
-- the identity standing (design section 7).
-- =====================================================================================
create table plm.marvel_dcp_portal_tile (
  id                  uuid primary key default gen_random_uuid(),
  source_system       text not null default 'marvel_dcpvault' check (source_system = 'marvel_dcpvault'),
  source_key          text not null,
  display_label       text null,
  source_url          text null,

  first_seen_crawl_id uuid null references plm.marvel_dcp_crawl(crawl_id) on delete set null,
  last_seen_crawl_id  uuid null references plm.marvel_dcp_crawl(crawl_id) on delete set null,

  -- READ-ONLY reconciliation pointer. NULL at landing, ALWAYS. A tile is NOT proven to be
  -- a canonical property; only an explicit reviewed mapping may ever set this.
  core_property_id    uuid null references core.property(id) on delete restrict,
  resolution_status   text not null default 'unresolved',
  resolution_reason   text null,
  resolved_at         timestamptz null,
  resolved_by         text null,

  raw                 jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint marvel_dcp_portal_tile_source_key_chk check (btrim(source_key) <> ''),
  constraint marvel_dcp_portal_tile_unique unique (source_system, source_key),
  constraint marvel_dcp_portal_tile_resolution_status_chk check (
    resolution_status in ('unresolved','matched','ambiguous','no_match','rejected')
  ),
  -- A resolved pointer without a status, or a matched status without a pointer, is a
  -- half-finished decision. Neither may sit in the table looking settled.
  constraint marvel_dcp_portal_tile_resolution_coherent_chk check (
    (resolution_status = 'matched') = (core_property_id is not null)
  )
);

comment on table plm.marvel_dcp_portal_tile is
'One row per Disney Marvel DCP Vault portal BROWSING TILE. A TILE IS NOT A PROPERTY AND NOT A '
'FRANCHISE -- the extract proves only that the portal listed a file under a browse '
'category. Nothing may write tile text into core.property, and core_property_id is a '
'read-only pointer that stays NULL until an explicit reviewed mapping sets it. '
'Deliberately carries NO allow-list of tile keys: the portal exposes more tiles than any '
'one partial crawl observes, and a CHECK pinned to what one checkpoint saw would reject '
'the rest of the portal on the next crawl.';

-- =====================================================================================
-- SECTION 4. plm.marvel_dcp_style_guide -- one row per guide path (design 4.5)
--
-- Identity is the FULL SOURCE PATH, never coalesce(source_guide_id, folder_name): folder
-- names repeat across region/year contexts, and a later id backfill would change the
-- value of such an expression and re-key existing rows.
-- =====================================================================================
create table plm.marvel_dcp_style_guide (
  id                  uuid primary key default gen_random_uuid(),
  source_system       text not null default 'marvel_dcpvault' check (source_system = 'marvel_dcpvault'),
  source_path         text not null,
  source_guide_id     text null,
  folder_name         text not null,
  region              text not null,
  year_segment        text not null,
  parent_source_path  text null,

  first_seen_crawl_id uuid null references plm.marvel_dcp_crawl(crawl_id) on delete set null,
  last_seen_crawl_id  uuid null references plm.marvel_dcp_crawl(crawl_id) on delete set null,

  -- READ-ONLY reconciliation pointer into the canonical taxonomy. NULL at landing, always.
  -- ON DELETE RESTRICT, never CASCADE: a canonical guide disappearing must not silently
  -- delete the source observation that a promotion was traced through.
  core_style_guide_id uuid null references core.style_guide(id) on delete restrict,
  resolution_status   text not null default 'unresolved',
  resolution_reason   text null,
  resolved_at         timestamptz null,
  resolved_by         text null,

  raw                 jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint marvel_dcp_style_guide_source_path_chk check (btrim(source_path) <> ''),
  constraint marvel_dcp_style_guide_folder_name_chk check (btrim(folder_name) <> ''),
  constraint marvel_dcp_style_guide_region_chk      check (btrim(region) <> ''),
  -- year_segment is TEXT and stays text: a non-numeric "no year" marker is a valid value
  -- in this source and an integer column could not hold it.
  constraint marvel_dcp_style_guide_year_chk        check (btrim(year_segment) <> ''),
  -- A blank guide id is not an id. Store NULL, so the partial unique index below means
  -- what it says.
  constraint marvel_dcp_style_guide_guide_id_chk
    check (source_guide_id is null or btrim(source_guide_id) <> ''),
  constraint marvel_dcp_style_guide_unique unique (source_system, source_path),
  constraint marvel_dcp_style_guide_resolution_status_chk check (
    resolution_status in ('unresolved','matched','ambiguous','no_match','rejected')
  ),
  constraint marvel_dcp_style_guide_resolution_coherent_chk check (
    (resolution_status = 'matched') = (core_style_guide_id is not null)
  )
);

-- Partial unique on the real Disney id. Measured safe for this extract: zero source ids
-- map to more than one guide context. It is PARTIAL because most files carry no id at
-- all, and a plain unique would collapse every id-less guide into one row.
create unique index uq_marvel_dcp_style_guide_source_guide_id
  on plm.marvel_dcp_style_guide (source_system, source_guide_id)
  where source_guide_id is not null;

create index idx_marvel_dcp_style_guide_folder_name on plm.marvel_dcp_style_guide (folder_name);
create index idx_marvel_dcp_style_guide_region_year on plm.marvel_dcp_style_guide (region, year_segment);

comment on table plm.marvel_dcp_style_guide is
'One row per Disney Marvel DCP Vault guide FOLDER PATH. IDENTITY IS THE FULL SOURCE PATH. Never '
're-key this on coalesce(source_guide_id, folder_name): folder names are reused across '
'region/year contexts, and a later id backfill would change that expression''s value and '
'silently re-identify existing rows. The Disney guide id, when present, is enforced unique '
'by a PARTIAL index -- most guides have no id, and a plain unique would collapse them all. '
'year_segment is TEXT because a non-numeric "no year" marker is a legitimate value. '
'core_style_guide_id is a read-only reconciliation pointer, NULL at landing; tile '
'membership may NEVER be used to infer it.';
comment on column plm.marvel_dcp_style_guide.parent_source_path is
'Populated ONLY where the portal actually proves nesting. Never inferred by trimming a '
'path segment: a guessed hierarchy is indistinguishable from an observed one once stored.';

-- =====================================================================================
-- SECTION 5. The file identity, its crawl membership, its tile links, and the exceptions
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- 5.1 plm.marvel_dcp_asset -- one row per Disney file identity (design 4.6)
-- -------------------------------------------------------------------------------------
create table plm.marvel_dcp_asset (
  id                    uuid primary key default gen_random_uuid(),
  source_system         text not null default 'marvel_dcpvault' check (source_system = 'marvel_dcpvault'),
  source_path           text not null,

  style_guide_id        uuid not null references plm.marvel_dcp_style_guide(id) on delete restrict,

  file_name             text not null,

  -- PLAIN COLUMN, COMPUTED BY THE LOADER. NOT `GENERATED ... STORED` -- see DECISION 4 in
  -- the header. PostgreSQL populates a generated column AFTER every BEFORE-row trigger
  -- runs, so the section 6 immutability triggers would read NULL here on every row, never
  -- fire, and leave a guard that applies cleanly and protects nothing.
  file_extension        text null,

  relative_folder_path  text null,
  source_asset_id       text null,
  file_size_bytes       bigint null,
  content_type          text null,
  checksum              text null,

  first_seen_crawl_id   uuid null references plm.marvel_dcp_crawl(crawl_id) on delete set null,
  last_seen_crawl_id    uuid null references plm.marvel_dcp_crawl(crawl_id) on delete set null,

  raw                   jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint marvel_dcp_asset_source_path_chk check (btrim(source_path) <> ''),
  constraint marvel_dcp_asset_file_name_chk   check (btrim(file_name) <> ''),
  -- Lowercase, no dot, non-blank when present. This is the shape the frozen hash slot 4
  -- assumes, so it is enforced rather than trusted.
  constraint marvel_dcp_asset_file_extension_chk check (
    file_extension is null
    or (file_extension = lower(file_extension)
        and btrim(file_extension) = file_extension
        and file_extension <> ''
        and position('.' in file_extension) = 0)
  ),
  -- A blank relative folder path is a real observed value in this source; it is stored as
  -- NULL so "no subpath" has exactly one representation and cannot hash two ways.
  constraint marvel_dcp_asset_relative_folder_chk
    check (relative_folder_path is null or btrim(relative_folder_path) <> ''),
  constraint marvel_dcp_asset_size_chk check (file_size_bytes is null or file_size_bytes >= 0),
  constraint marvel_dcp_asset_unique unique (source_system, source_path)
);

-- Design 4.6: index the guide link, the lowercased file name and the extension.
-- NEVER add a unique rule to file_name -- thousands of distinct DAM paths share one name.
create index idx_marvel_dcp_asset_style_guide on plm.marvel_dcp_asset (style_guide_id);
create index idx_marvel_dcp_asset_file_name_lower on plm.marvel_dcp_asset (lower(file_name));
create index idx_marvel_dcp_asset_file_extension on plm.marvel_dcp_asset (file_extension);

comment on table plm.marvel_dcp_asset is
'One row per Disney Marvel DCP Vault FILE IDENTITY, keyed on the full DAM path. FILE NAME IS NOT '
'AN IDENTITY: thousands of distinct paths share a name in this source, so file_name is '
'indexed and deliberately NOT unique -- never add a unique constraint to it. '
'file_extension is a PLAIN loader-computed column and must never be converted to '
'GENERATED ... STORED: a generated column is populated after BEFORE-row triggers run, '
'which would make every immutability trigger on this table read NULL and never fire. '
'THIS TABLE RECORDS NAMES AND PATHS ONLY. No file bytes, preview, PDF or image is stored '
'here or anywhere in this schema, and the presence of a row is NOT a claim that the '
'content exists locally.';
comment on column plm.marvel_dcp_asset.checksum is
'NULL unless the portal exposed one or it was computed from authorized content. Never '
'invented, and never back-filled from the row hash -- plm.marvel_dcp_asset_crawl.observed_row_hash '
'digests METADATA, not file bytes, and confusing the two would assert content integrity '
'this scrape never verified.';

-- -------------------------------------------------------------------------------------
-- 5.2 plm.marvel_dcp_crawl_section -- one row per planned tile+listing query (design 4.2)
--
-- THE COMPLETENESS GATE, and the resolution of the design's 22-versus-11 discrepancy.
--
-- Design section 6 rule 1 says the saved crawler plan has 44 base jobs from 22 portal
-- tiles plus one repair job; design section 2 measures 11 distinct tiles in the extract.
-- RECONCILED, from the crawler's own saved queue in the private source repo: the queue
-- holds 45 jobs across 22 distinct tile pages -- 22 tiles x 2 listing kinds = 44 base
-- jobs, plus exactly ONE resume job for a tile whose Assets listing was interrupted
-- mid-offset. So 44 + 1 = 45, exactly as the design says.
--
-- The 11 is not a contradiction of the 22; it is the CONSEQUENCE of the crawl being
-- PARTIAL. 22 tiles were PLANNED; the checkpoint had finished only a minority of those
-- sections, so only 11 tiles had produced any rows yet. Both numbers are true and they
-- measure different things: 22 = planned sections, 11 = tiles observed so far.
--
-- THE SCHEMA CONSEQUENCE, which is why this matters: one row per PLANNED section is
-- inserted at the START of a crawl, not at the end. A crawl that captured 11 tiles while
-- 22 were planned therefore has 11 complete sections and 11 incomplete ones ON THE
-- RECORD, cannot be finalized, and is honestly reported as partial. Had sections been
-- derived from what arrived, the same crawl would have looked 100% complete. NOTHING in
-- this schema hard-codes 11 or 22: the next crawl brings its own plan.
--
-- The repair job is recorded as a gap resolution against its existing section, NEVER as a
-- second section -- hence the unique constraint below (design section 6 rule 1).
-- -------------------------------------------------------------------------------------
create table plm.marvel_dcp_crawl_section (
  id             uuid primary key default gen_random_uuid(),
  crawl_id       uuid not null references plm.marvel_dcp_crawl(crawl_id) on delete cascade,
  portal_tile_id uuid not null references plm.marvel_dcp_portal_tile(id) on delete restrict,
  listing_kind   text not null,
  status         text not null default 'planned',
  expected_count integer null,
  captured_count integer not null default 0,
  last_offset    integer null,
  started_at     timestamptz null,
  finished_at    timestamptz null,
  notes          text null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint marvel_dcp_crawl_section_listing_kind_chk check (listing_kind in ('asset','style_guide')),
  constraint marvel_dcp_crawl_section_status_chk
    check (status in ('planned','running','complete','gapped','failed')),
  constraint marvel_dcp_crawl_section_counts_chk check (
    captured_count >= 0
    and (expected_count is null or expected_count >= 0)
    and (last_offset is null or last_offset >= 0)
  ),
  -- A section may only claim complete when it finished and, where the portal exposed a
  -- total, actually captured that total. A ZERO-row section is legitimate (a tile really
  -- can be empty) and is allowed -- but only against an expected_count of 0, so "we got
  -- nothing" can never pass as "there was nothing".
  constraint marvel_dcp_crawl_section_complete_requires_evidence_chk check (
    status <> 'complete'
    or (finished_at is not null
        and (expected_count is null or captured_count = expected_count))
  ),
  constraint marvel_dcp_crawl_section_unique unique (crawl_id, portal_tile_id, listing_kind)
);

create index idx_marvel_dcp_crawl_section_crawl on plm.marvel_dcp_crawl_section (crawl_id, status);
create index idx_marvel_dcp_crawl_section_incomplete
  on plm.marvel_dcp_crawl_section (crawl_id) where status <> 'complete';

comment on table plm.marvel_dcp_crawl_section is
'One row per PLANNED portal tile + listing kind in a crawl. Rows are inserted from the '
'crawler''s plan when the crawl OPENS, never derived from what arrived -- that is the whole '
'point. A partial crawl that reached only some of its planned tiles then carries its '
'unfinished sections on the record and CANNOT be finalized; derived sections would have '
'made the same crawl look 100 percent complete. A zero-row section is legitimate (a tile '
'can genuinely be empty) but may only be complete against an expected count of zero, so '
'"we captured nothing" can never pass as "there was nothing". A resume or repair job is '
'recorded as a gap resolution on the EXISTING section, never as a second section -- '
'enforced by the unique constraint on (crawl_id, portal_tile_id, listing_kind).';

-- -------------------------------------------------------------------------------------
-- 5.3 plm.marvel_dcp_crawl_gap -- unresolved missing ranges and request failures (design 4.3)
-- -------------------------------------------------------------------------------------
create table plm.marvel_dcp_crawl_gap (
  id               uuid primary key default gen_random_uuid(),
  crawl_section_id uuid not null references plm.marvel_dcp_crawl_section(id) on delete cascade,
  offset_from      integer not null,
  offset_to        integer not null,
  reason           text not null,
  attempt_count    integer not null default 0,
  resolved_at      timestamptz null,
  resolution_note  text null,

  -- APPROVAL TIMESTAMP. Writers MUST pin this to MIDDAY UTC (12:00:00Z), never midnight.
  -- The server runs America/New_York, so a midnight-UTC value read back through ::date --
  -- which any "was this waived on or before date D" report does -- returns the PREVIOUS
  -- day. Midday UTC is 08:00 or 07:00 local, so the date is the same in both zones and no
  -- report can disagree with another about when the waiver happened.
  waived_at        timestamptz null,
  waived_by        text null,
  waiver_reason    text null,

  created_at       timestamptz not null default now(),

  constraint marvel_dcp_crawl_gap_offsets_chk check (offset_from >= 0 and offset_to >= offset_from),
  constraint marvel_dcp_crawl_gap_reason_chk  check (btrim(reason) <> ''),
  constraint marvel_dcp_crawl_gap_attempts_chk check (attempt_count >= 0),
  -- A resolution must say what it did; a silent resolved_at is not a resolution.
  constraint marvel_dcp_crawl_gap_resolution_chk check (
    resolved_at is null or btrim(coalesce(resolution_note, '')) <> ''
  ),
  -- A WAIVER IS A DECISION AND MUST BE SIGNED. All three parts or none: who, when, why.
  -- An unsigned waiver is how a gap gets closed by nobody.
  constraint marvel_dcp_crawl_gap_waiver_chk check (
    (waived_at is null and waived_by is null and waiver_reason is null)
    or (waived_at is not null
        and btrim(coalesce(waived_by, '')) <> ''
        and btrim(coalesce(waiver_reason, '')) <> '')
  ),
  -- A gap is either resolved (it was actually re-fetched) or waived (a human accepted the
  -- loss). It may not be both: that hides which of the two actually happened.
  constraint marvel_dcp_crawl_gap_not_both_chk check (resolved_at is null or waived_at is null)
);

create index idx_marvel_dcp_crawl_gap_section on plm.marvel_dcp_crawl_gap (crawl_section_id);
create index idx_marvel_dcp_crawl_gap_open
  on plm.marvel_dcp_crawl_gap (crawl_section_id)
  where resolved_at is null and waived_at is null;

comment on table plm.marvel_dcp_crawl_gap is
'One row per unresolved missing offset range or request failure within a crawl section. A '
'crawl CANNOT be finalized while any gap is neither resolved nor waived -- enforced by '
'plm.finalize_marvel_dcp_crawl. A waiver is a signed human decision: who, when and why, all three '
'or none. WAIVED_AT MUST BE PINNED TO MIDDAY UTC by its writer: this server runs '
'America/New_York, so a midnight-UTC approval timestamp read back through ::date reports '
'the PREVIOUS day, and two reports would then disagree about when a loss was accepted.';

-- -------------------------------------------------------------------------------------
-- 5.4 plm.marvel_dcp_asset_crawl -- snapshot membership + the frozen row hash (design 4.7)
-- -------------------------------------------------------------------------------------
create table plm.marvel_dcp_asset_crawl (
  crawl_id          uuid not null references plm.marvel_dcp_crawl(crawl_id) on delete cascade,
  marvel_dcp_asset_id      uuid not null references plm.marvel_dcp_asset(id) on delete restrict,
  observed_row_hash text not null,
  observed_at       timestamptz not null default now(),

  constraint marvel_dcp_asset_crawl_pkey primary key (crawl_id, marvel_dcp_asset_id),
  -- 64 lowercase hex. The shape is enforced so a truncated, uppercased or
  -- differently-encoded digest cannot enter the column and quietly compare unequal
  -- against every honest hash forever.
  constraint marvel_dcp_asset_crawl_hash_chk check (observed_row_hash ~ '^[0-9a-f]{64}$')
);

create index idx_marvel_dcp_asset_crawl_asset on plm.marvel_dcp_asset_crawl (marvel_dcp_asset_id);

comment on table plm.marvel_dcp_asset_crawl is
'Snapshot membership: this stable asset was present in this crawl. Carries the frozen '
'canonical row hash and NOTHING ELSE about the asset -- the asset''s fields live once, on '
'plm.marvel_dcp_asset, and are not copied per crawl. Comparing observed_row_hash across two crawls '
'is the ONLY change-detection mechanism in this schema. The hash comes from '
'plm.marvel_dcp_asset_row_hash and its serialization is FROZEN (see section 1 of migration '
'20260810190000): about 155,900 rows will carry it, and redefining the scheme invalidates '
'every stored hash and forces a full re-capture. It digests METADATA and is NOT a content '
'checksum.';

-- -------------------------------------------------------------------------------------
-- 5.5 plm.marvel_dcp_load_exception -- rejected and questionable rows (owner ruling 6)
--
-- The design requires that malformed rows are REJECTED INTO AN ERROR TABLE rather than
-- silently skipped, and requires an exception report, but never defines the table. This
-- is it, and it is deliberately wider than the minimum: without crawl_section_id and
-- chunk_number an operator cannot tell WHICH query or WHICH chunk produced a bad row, and
-- without severity every advisory finding looks like a hard rejection.
--
-- A silent skip is the exact failure mode this table exists to make impossible. If the
-- loader cannot land a row, a row lands HERE. There is no third outcome.
-- -------------------------------------------------------------------------------------
create table plm.marvel_dcp_load_exception (
  id               uuid primary key default gen_random_uuid(),
  crawl_id         uuid not null references plm.marvel_dcp_crawl(crawl_id) on delete cascade,
  crawl_section_id uuid null references plm.marvel_dcp_crawl_section(id) on delete set null,
  chunk_number     integer null,
  row_number       integer null,

  severity         text not null default 'rejected',
  reason_code      text not null,
  reason           text not null,
  source_path      text null,
  raw_row          jsonb not null default '{}'::jsonb,

  resolved_at      timestamptz null,
  resolution_note  text null,
  created_at       timestamptz not null default now(),

  constraint marvel_dcp_load_exception_severity_chk check (severity in ('rejected','warning')),
  constraint marvel_dcp_load_exception_reason_code_chk check (btrim(reason_code) <> ''),
  constraint marvel_dcp_load_exception_reason_chk      check (btrim(reason) <> ''),
  constraint marvel_dcp_load_exception_row_number_chk  check (row_number is null or row_number >= 1),
  constraint marvel_dcp_load_exception_chunk_chk       check (chunk_number is null or chunk_number >= 1),
  constraint marvel_dcp_load_exception_resolution_chk check (
    resolved_at is null or btrim(coalesce(resolution_note, '')) <> ''
  )
);

create index idx_marvel_dcp_load_exception_crawl on plm.marvel_dcp_load_exception (crawl_id, severity);
create index idx_marvel_dcp_load_exception_open
  on plm.marvel_dcp_load_exception (crawl_id) where resolved_at is null and severity = 'rejected';
create index idx_marvel_dcp_load_exception_reason_code on plm.marvel_dcp_load_exception (reason_code);

comment on table plm.marvel_dcp_load_exception is
'Every input row the loader could not land, and every advisory finding it raised. THE '
'DESIGN''S RULE, MADE STRUCTURAL: a malformed row is REJECTED INTO THIS TABLE, never '
'silently skipped -- if it does not land in the landing tables it lands here, and there is '
'no third outcome. severity = rejected means the row was not loaded; warning means it was '
'loaded but something about it is worth a human''s attention. reason_code is the stable '
'machine-readable classification the exception report groups on; reason is the human '
'sentence. raw_row holds the offending input verbatim and is therefore licensor-'
'confidential like every other table here. Unresolved rejections block finalization.';
comment on column plm.marvel_dcp_load_exception.reason_code is
'Stable machine-readable classification. The loader in 20260810190100 emits, among others: '
'blank folder path, conflicting guide source id, malformed boolean, unknown listing state, '
'a reserved separator in a hashed field, and two NON-IDENTICAL rows sharing one DAM path -- '
'the last being the case the duplicate collapse must never quietly merge.';

-- -------------------------------------------------------------------------------------
-- 5.6 plm.marvel_dcp_asset_tile_observation -- the many-to-many evidence table (design 4.8)
--
-- Replaces the pipe-separated tile list and the two listing booleans that the flat
-- extract carries on each file row. One row per proven (crawl, asset, tile, listing kind).
--
-- crawl_section_id IS NULLABLE BY DESIGN -- see DECISION 3 in the header. link_evidence
-- names the fidelity and the CHECK below binds the two so they can never disagree.
-- -------------------------------------------------------------------------------------
create table plm.marvel_dcp_asset_tile_observation (
  crawl_id         uuid not null references plm.marvel_dcp_crawl(crawl_id) on delete cascade,
  marvel_dcp_asset_id     uuid not null references plm.marvel_dcp_asset(id) on delete restrict,
  portal_tile_id   uuid not null references plm.marvel_dcp_portal_tile(id) on delete restrict,
  listing_kind     text not null,
  crawl_section_id uuid null references plm.marvel_dcp_crawl_section(id) on delete restrict,
  link_evidence    text not null,
  observed_at      timestamptz not null default now(),

  constraint marvel_dcp_asset_tile_observation_pkey
    primary key (crawl_id, marvel_dcp_asset_id, portal_tile_id, listing_kind),
  constraint marvel_dcp_asset_tile_observation_listing_kind_chk
    check (listing_kind in ('asset','style_guide')),
  constraint marvel_dcp_asset_tile_observation_link_evidence_chk
    check (link_evidence in ('section_query','aggregated_row')),
  -- THE BINDING. 'section_query' asserts a specific portal query proved this link, so the
  -- section id is REQUIRED. 'aggregated_row' asserts the link came from an already-
  -- aggregated extract row whose originating query was not preserved, so the section id
  -- MUST be NULL. Neither grade can borrow the other's appearance.
  constraint marvel_dcp_asset_tile_observation_evidence_binding_chk check (
    (link_evidence = 'section_query'  and crawl_section_id is not null)
    or
    (link_evidence = 'aggregated_row' and crawl_section_id is null)
  )
);

create index idx_marvel_dcp_asset_tile_obs_asset on plm.marvel_dcp_asset_tile_observation (marvel_dcp_asset_id);
create index idx_marvel_dcp_asset_tile_obs_tile
  on plm.marvel_dcp_asset_tile_observation (portal_tile_id, listing_kind);
create index idx_marvel_dcp_asset_tile_obs_section
  on plm.marvel_dcp_asset_tile_observation (crawl_section_id) where crawl_section_id is not null;

comment on table plm.marvel_dcp_asset_tile_observation is
'The many-to-many evidence table for file-to-portal-tile links, replacing the pipe-joined '
'tile list and the two listing booleans the flat extract carries per file row. One row per '
'proven (crawl, asset, tile, listing kind); an asset listed under eight tiles produces '
'EIGHT rows here and still exactly ONE row in plm.marvel_dcp_asset. '
'FIDELITY IS RECORDED IN THE DATA, not assumed: link_evidence = section_query means a '
'specific portal query proved the link and crawl_section_id names it; '
'link_evidence = aggregated_row means the link came from an already-aggregated extract row '
'whose originating query was NOT preserved and cannot be reconstructed, so crawl_section_id '
'is NULL. The CSV backfill is entirely aggregated_row. A consumer that needs proven '
'provenance filters on section_query. Inventing a synthetic section for the aggregated case '
'would have manufactured exactly the false precision the design forbids.';
comment on column plm.marvel_dcp_asset_tile_observation.listing_kind is
'Which portal result list showed this file under this tile. It is an OBSERVATION, not part '
'of file identity. Two rows for one (crawl, asset, tile) are created only when BOTH '
'listings were genuinely queried and both returned the file -- never by expanding one '
'aggregated row into a cross-product.';

-- =====================================================================================
-- SECTION 6. IMMUTABILITY -- a completed crawl's evidence is frozen
--
-- Prose in a design document is not immutability. These are row triggers.
--
-- WHY BEFORE-ROW TRIGGERS AND WHAT DEFEATS THEM: TRUNCATE does not fire row triggers at
-- all, so every guarantee below depends on section 7 having revoked TRUNCATE from
-- service_role. The two sections are one mechanism; do not weaken either alone.
--
-- AND WHY EVERY CRAWL-SCOPED TRIGGER COVERS **INSERT** AS WELL AS UPDATE AND DELETE.
-- Read this before "simplifying" any trigger below back to `before update or delete`.
-- Section 7 revokes UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER and MAINTAIN from
-- service_role. Guarded SECURITY DEFINER functions are therefore the only writing
-- operation still available to the loader's role -- which makes it the one an
-- UPDATE/DELETE-only trigger would leave completely unguarded. The concrete hole: crawl X
-- finalizes, then a plain
--     insert into plm.marvel_dcp_asset_tile_observation (crawl_id, ...) values (X, ...);
-- adds a portal link that crawl never observed. No grant stops it and, without the INSERT
-- branch, no trigger fires either -- and the claim "a completed crawl's evidence is frozen"
-- would be false for the only operation anyone could still perform. The same hole exists
-- on marvel_dcp_asset_crawl, marvel_dcp_crawl_section, marvel_dcp_crawl_gap, marvel_dcp_load_exception and
-- marvel_dcp_chunk_ledger, so all six are covered.
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- 6.1 Crawl-scoped evidence: frozen entirely once its crawl is complete.
-- -------------------------------------------------------------------------------------
create or replace function plm.marvel_dcp_reject_completed_crawl_change()
returns trigger
language plpgsql
as $$
declare
  v_crawl  uuid;
  v_status text;
begin
  -- NEW is UNASSIGNED in a DELETE trigger; reading new.* there raises "record new is not
  -- assigned yet". The branch therefore comes BEFORE the read, never inside a coalesce
  -- over both.
  --
  -- plm.marvel_dcp_crawl_gap is the one attached table that has NO crawl_id column -- it hangs
  -- off a section, not off the crawl -- so reading new.crawl_id there would raise "record
  -- new has no field crawl_id" at runtime, on every write, while the migration itself
  -- applied perfectly clean. It is resolved through its section instead. A generic
  -- `record.crawl_id` read would have been a guard that only fails when it is used.
  if tg_table_name = 'marvel_dcp_crawl_gap' then
    select s.crawl_id into v_crawl
    from plm.marvel_dcp_crawl_section s
    where s.id = (case when tg_op = 'DELETE' then old.crawl_section_id
                       else new.crawl_section_id end);
  elsif tg_op = 'DELETE' then
    v_crawl := old.crawl_id;
  else
    v_crawl := new.crawl_id;
  end if;

  select c.status into v_status from plm.marvel_dcp_crawl c where c.crawl_id = v_crawl;

  if v_status = 'complete' then
    raise exception
      'Marvel DCP Vault crawl % is COMPLETE and its evidence is immutable; % on %.% is refused. A '
      'refresh is a NEW crawl_id, never an edit of an old one -- editing completed evidence '
      'destroys the only record of what the portal actually said.',
      v_crawl, tg_op, tg_table_schema, tg_table_name
      using errcode = 'P0001';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

comment on function plm.marvel_dcp_reject_completed_crawl_change() is
'Row trigger freezing every CRAWL-SCOPED plm.marvel_dcp_* table once its owning crawl reaches '
'status complete. FIRES ON INSERT, UPDATE AND DELETE -- all three, deliberately. INSERT is '
'not an afterthought here: section 7 revokes UPDATE, DELETE and TRUNCATE from service_role '
'but KEEPS INSERT, so INSERT is the only mutating operation still available and is '
'therefore the one an unguarded trigger would leave wide open. Without the INSERT branch a '
'plain INSERT could add a tile observation, a section, a gap or a membership row to an '
'already-completed crawl, and that crawl would then claim evidence it never observed. '
'TRUNCATE fires no row trigger at all, which is exactly why section 7 revokes it. The '
'revokes and this trigger are ONE mechanism; neither is sufficient alone.';

do $$
declare t text;
begin
  -- plm.marvel_dcp_load_exception is deliberately NOT in this list. It gets the narrower
  -- plm.marvel_dcp_load_exception_freeze below, because its resolution columns must stay
  -- writable after completion -- see the note there.
  foreach t in array array[
    'marvel_dcp_crawl_section','marvel_dcp_crawl_gap','marvel_dcp_asset_crawl',
    'marvel_dcp_asset_tile_observation'
  ]
  loop
    execute format(
      'create trigger %I before insert or update or delete on plm.%I '
      'for each row execute function plm.marvel_dcp_reject_completed_crawl_change()',
      'trg_' || t || '_immutable', t);
  end loop;
end;
$$;

-- -------------------------------------------------------------------------------------
-- 6.1b plm.marvel_dcp_load_exception -- frozen against INSERT and DELETE, but a human may still
--      RESOLVE an entry after the crawl completes.
--
-- THE DECISION, STATED SO NOBODY HAS TO GUESS WHETHER IT WAS INTENTIONAL. Freezing this
-- table wholesale (the 6.1 treatment) would mean that the moment a crawl completes, a
-- `warning` row can never be annotated, triaged or marked resolved -- which is the entire
-- purpose of its resolved_at and resolution_note columns, and those columns would be dead
-- weight from the first completed crawl onward. Warnings are, by definition, the entries
-- that DID load and that a human is expected to look at LATER; "later" is almost always
-- after the crawl finished.
--
-- So the carve-out is the same principle used for the stable-identity tables in 6.2:
-- SOURCE facts freeze, OUR later decisions do not.
--   * INSERT into a completed crawl: REFUSED. A new exception after the fact would be a
--     finding the crawl never actually produced.
--   * DELETE from a completed crawl: REFUSED. Deleting a finding is how a finding stops
--     existing.
--   * UPDATE of a completed crawl's row: only resolved_at and resolution_note may change.
--     Everything else -- severity, reason_code, reason, raw_row, the row/chunk pointers --
--     is source evidence and stays frozen.
-- Note that unresolved REJECTED rows still block finalization (finalize gate 3), so this
-- carve-out cannot be used to complete a crawl over open rejections and tidy them up
-- afterwards.
-- -------------------------------------------------------------------------------------
create or replace function plm.marvel_dcp_load_exception_freeze()
returns trigger
language plpgsql
as $$
declare
  v_crawl  uuid;
  v_status text;
begin
  -- NEW is unassigned in a DELETE trigger, so the branch precedes the read.
  if tg_op = 'DELETE' then
    v_crawl := old.crawl_id;
  else
    v_crawl := new.crawl_id;
  end if;

  select c.status into v_status from plm.marvel_dcp_crawl c where c.crawl_id = v_crawl;

  if v_status is distinct from 'complete' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'INSERT' then
    raise exception 'Marvel DCP Vault crawl % is COMPLETE; a new load exception may not be added '
      'to it. An exception recorded after the fact is a finding the crawl never produced.',
      v_crawl using errcode = 'P0001';
  end if;

  if tg_op = 'DELETE' then
    raise exception 'Marvel DCP Vault crawl % is COMPLETE; its load exceptions may not be deleted. '
      'Deleting a finding is how a finding stops existing.', v_crawl using errcode = 'P0001';
  end if;

  -- `id` is compared too. Without it a completed crawl's finding could be RE-KEYED --
  -- every other column identical, a new primary key -- which breaks any external
  -- reference to that finding while looking like nothing changed.
  if new.id               is distinct from old.id
  or new.crawl_id         is distinct from old.crawl_id
  or new.crawl_section_id is distinct from old.crawl_section_id
  or new.chunk_number     is distinct from old.chunk_number
  or new.row_number       is distinct from old.row_number
  or new.severity         is distinct from old.severity
  or new.reason_code      is distinct from old.reason_code
  or new.reason           is distinct from old.reason
  or new.source_path      is distinct from old.source_path
  or new.raw_row          is distinct from old.raw_row
  or new.created_at       is distinct from old.created_at then
    raise exception 'Marvel DCP Vault crawl % is COMPLETE: the source fields of a load exception '
      'are immutable. Only resolved_at and resolution_note may change, so a human can still '
      'triage a warning after the crawl finished.', v_crawl using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create trigger trg_marvel_dcp_load_exception_immutable
  before insert or update or delete on plm.marvel_dcp_load_exception
  for each row execute function plm.marvel_dcp_load_exception_freeze();

comment on function plm.marvel_dcp_load_exception_freeze() is
'Narrower freeze for plm.marvel_dcp_load_exception. Once the owning crawl is complete: INSERT is '
'refused (a finding the crawl never produced), DELETE is refused (deleting a finding is how '
'it stops existing), and UPDATE may change ONLY resolved_at and resolution_note. This is a '
'DELIBERATE carve-out, not an oversight: warnings are precisely the entries a human is '
'expected to triage LATER, and "later" is nearly always after the crawl finished, so the '
'wholesale 6.1 freeze would have made those two columns dead weight from the first '
'completed crawl. Unresolved REJECTED rows still block finalization, so this cannot be used '
'to complete a crawl over open rejections and tidy them afterwards.';

-- -------------------------------------------------------------------------------------
-- 6.2 Stable identities: SOURCE columns freeze; OUR columns stay editable.
--
-- plm.marvel_dcp_portal_tile, plm.marvel_dcp_style_guide and plm.marvel_dcp_asset outlive any single crawl.
-- Design section 7: deleting an unpromoted crawl must remove its observations but NOT the
-- stable identities other crawls use. So these three are NOT frozen wholesale.
--
-- What freezes: the SOURCE columns, once the row has been observed by any COMPLETE crawl.
-- What stays editable, forever: last_seen_crawl_id (a later crawl re-observing the same
-- row is normal), updated_at, and the reconciliation columns -- those are OUR decisions,
-- made after the fact, and are the entire reason these tables have them.
-- DELETE is refused outright once a complete crawl has seen the row.
-- -------------------------------------------------------------------------------------
create or replace function plm.marvel_dcp_reject_completed_source_field_change()
returns trigger
language plpgsql
as $$
declare
  v_seen boolean;
begin
  -- "Has any COMPLETE crawl observed this row?" is answered per table, from the evidence
  -- tables, not from a flag on the row -- a flag would have to be maintained and could
  -- drift out of agreement with the evidence it claims to summarise.
  if tg_table_name = 'marvel_dcp_asset' then
    select exists (
      select 1 from plm.marvel_dcp_asset_crawl ac
      join plm.marvel_dcp_crawl c on c.crawl_id = ac.crawl_id
      where ac.marvel_dcp_asset_id = old.id and c.status = 'complete'
    ) into v_seen;
  elsif tg_table_name = 'marvel_dcp_style_guide' then
    select exists (
      select 1 from plm.marvel_dcp_asset a
      join plm.marvel_dcp_asset_crawl ac on ac.marvel_dcp_asset_id = a.id
      join plm.marvel_dcp_crawl c on c.crawl_id = ac.crawl_id
      where a.style_guide_id = old.id and c.status = 'complete'
    ) into v_seen;
  elsif tg_table_name = 'marvel_dcp_portal_tile' then
    select exists (
      select 1 from plm.marvel_dcp_asset_tile_observation o
      join plm.marvel_dcp_crawl c on c.crawl_id = o.crawl_id
      where o.portal_tile_id = old.id and c.status = 'complete'
    ) into v_seen;
  else
    -- An unknown table means this trigger was attached somewhere it was not designed for.
    -- FAIL LOUDLY. Returning NEW here would install a guard that silently permits
    -- everything on the new table, which is worse than no guard at all.
    raise exception 'plm.marvel_dcp_reject_completed_source_field_change is attached to %.% which '
      'it does not know how to evaluate. Extend the function before attaching it.',
      tg_table_schema, tg_table_name using errcode = 'P0001';
  end if;

  if not v_seen then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    raise exception 'Marvel DCP Vault: %.% row % has been observed by a COMPLETE crawl and may not '
      'be deleted. Stable source identities are permanent evidence.',
      tg_table_schema, tg_table_name, old.id using errcode = 'P0001';
  end if;

  if tg_table_name = 'marvel_dcp_asset' then
    if new.source_system        is distinct from old.source_system
    or new.source_path          is distinct from old.source_path
    or new.style_guide_id       is distinct from old.style_guide_id
    or new.file_name            is distinct from old.file_name
    or new.file_extension       is distinct from old.file_extension
    or new.relative_folder_path is distinct from old.relative_folder_path
    or new.source_asset_id      is distinct from old.source_asset_id
    or new.file_size_bytes      is distinct from old.file_size_bytes
    or new.content_type         is distinct from old.content_type
    or new.checksum             is distinct from old.checksum
    or new.first_seen_crawl_id  is distinct from old.first_seen_crawl_id
    or new.raw                  is distinct from old.raw then
      raise exception 'Marvel DCP Vault: source fields of plm.marvel_dcp_asset row % are immutable once a '
        'COMPLETE crawl has observed it. Every stored row hash was computed from these '
        'exact values; changing one silently invalidates its change detection. Only '
        'last_seen_crawl_id and updated_at may change.', old.id using errcode = 'P0001';
    end if;

  elsif tg_table_name = 'marvel_dcp_style_guide' then
    if new.source_system       is distinct from old.source_system
    or new.source_path         is distinct from old.source_path
    or new.source_guide_id     is distinct from old.source_guide_id
    or new.folder_name         is distinct from old.folder_name
    or new.region              is distinct from old.region
    or new.year_segment        is distinct from old.year_segment
    or new.parent_source_path  is distinct from old.parent_source_path
    or new.first_seen_crawl_id is distinct from old.first_seen_crawl_id
    or new.raw                 is distinct from old.raw then
      raise exception 'Marvel DCP Vault: source fields of plm.marvel_dcp_style_guide row % are immutable '
        'once a COMPLETE crawl has observed it. Only last_seen_crawl_id, updated_at and the '
        'reconciliation columns may change.', old.id using errcode = 'P0001';
    end if;

  elsif tg_table_name = 'marvel_dcp_portal_tile' then
    if new.source_system       is distinct from old.source_system
    or new.source_key          is distinct from old.source_key
    or new.display_label       is distinct from old.display_label
    or new.source_url          is distinct from old.source_url
    or new.first_seen_crawl_id is distinct from old.first_seen_crawl_id
    or new.raw                 is distinct from old.raw then
      raise exception 'Marvel DCP Vault: source fields of plm.marvel_dcp_portal_tile row % are immutable '
        'once a COMPLETE crawl has observed it. Only last_seen_crawl_id, updated_at and the '
        'reconciliation columns may change.', old.id using errcode = 'P0001';
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

comment on function plm.marvel_dcp_reject_completed_source_field_change() is
'Narrower immutability trigger for the three STABLE IDENTITY tables, which outlive any one '
'crawl and therefore must not freeze wholesale. Once a COMPLETE crawl has observed a row -- '
'a fact read from the evidence tables, never from a maintainable flag that could drift -- '
'its SOURCE columns freeze and DELETE is refused, while last_seen_crawl_id, updated_at and '
'the reconciliation columns (core_property_id / core_style_guide_id and resolution_*) stay '
'editable, because reconciliation is OUR later decision and not source data. Attached to an '
'unknown table it RAISES rather than returning NEW: a guard that silently permits '
'everything is worse than no guard.';

create trigger trg_marvel_dcp_asset_source_immutable
  before update or delete on plm.marvel_dcp_asset
  for each row execute function plm.marvel_dcp_reject_completed_source_field_change();
create trigger trg_marvel_dcp_style_guide_source_immutable
  before update or delete on plm.marvel_dcp_style_guide
  for each row execute function plm.marvel_dcp_reject_completed_source_field_change();
create trigger trg_marvel_dcp_portal_tile_source_immutable
  before update or delete on plm.marvel_dcp_portal_tile
  for each row execute function plm.marvel_dcp_reject_completed_source_field_change();

-- -------------------------------------------------------------------------------------
-- 6.3 The crawl header itself.
--
-- Adapted from plm.pmt_capture_freeze. finalize's own UPDATE runs while the row is still
-- 'running', so it passes; once complete, nothing may change and the row may not be
-- deleted. Blocking the DELETE here also stops the ON DELETE CASCADE from ever reaching a
-- completed crawl's evidence.
-- -------------------------------------------------------------------------------------
create or replace function plm.marvel_dcp_crawl_freeze()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'complete' then
      raise exception 'Marvel DCP Vault crawl % is COMPLETE and may not be deleted. Completed '
        'crawls are retained permanently, and deleting one would cascade away the evidence '
        'of what the portal said.', old.crawl_id using errcode = 'P0001';
    end if;
    return old;
  end if;

  if old.status = 'complete' then
    raise exception 'Marvel DCP Vault crawl % is COMPLETE and immutable. A refresh is a NEW crawl, '
      'never an edit of a completed one.', old.crawl_id using errcode = 'P0001';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create trigger trg_marvel_dcp_crawl_freeze
  before update or delete on plm.marvel_dcp_crawl
  for each row execute function plm.marvel_dcp_crawl_freeze();

comment on function plm.marvel_dcp_crawl_freeze() is
'Freezes a COMPLETE plm.marvel_dcp_crawl row against UPDATE and DELETE, and maintains updated_at '
'while the crawl is still in flight. Refusing the DELETE also stops ON DELETE CASCADE from '
'ever reaching a completed crawl''s sections, gaps, memberships, tile observations and '
'exceptions. plm.finalize_marvel_dcp_crawl''s own UPDATE runs while the row is still running, so '
'it is unaffected.';

-- =====================================================================================
-- SECTION 7. PRIVILEGES -- revoke-first, PostgreSQL 17 complete
--
-- THE TRAP, STATED PLAINLY. The plm schema carries a standing
--     alter default privileges in schema plm grant all on tables to service_role
-- (20260710135975_reconcile_service_role_grants.sql:14). It fires at CREATE TABLE time,
-- BEFORE any GRANT in this migration could run. VERIFIED LIVE on 2026-08-10 against both
-- projects: pg_default_acl for schema plm reads {service_role=arwdDxtm/postgres} -- all
-- eight bits, INCLUDING TRUNCATE and PostgreSQL 17's MAINTAIN. So every table created
-- above was BORN holding TRUNCATE for service_role.
--
-- A NARROWER GRANT DOES NOT REMOVE A BIT. Only REVOKE does. This is exactly what
-- 20260810110000 had to repair on the Warner tables after the fact, and what #664 (the
-- missed MAINTAIN) and #649 (the default-privilege hole itself) are about.
--
-- WHY IT MATTERS HERE MORE THAN USUAL: TRUNCATE FIRES NO ROW TRIGGERS. One TRUNCATE would
-- erase a completed crawl's entire evidence without any section 6 trigger running once.
-- Every immutability guarantee in this migration rests on this revoke.
--
-- THE POSTURE, copied from 20260810110000 (Warner) verbatim as the pattern:
--   service_role keeps SELECT only; INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
--   and MAINTAIN are revoked. public and anon get `revoke all`.
--   INSERT is kept deliberately: the 20260810190100 loader functions are SECURITY DEFINER
--   and never consume service_role's table grants; the loader's security-definer path and
--   the exception table are exercised by service_role in the apply lane, and Warner's
--   shipped posture is the pattern this ruling names. It is the MUTATING bits -- above all
--   TRUNCATE -- that the immutability design cannot survive.
-- =====================================================================================
do $$
declare t text;
begin
  foreach t in array array[
    'marvel_dcp_crawl','marvel_dcp_portal_tile','marvel_dcp_style_guide','marvel_dcp_asset',
    'marvel_dcp_crawl_section','marvel_dcp_crawl_gap','marvel_dcp_asset_crawl',
    'marvel_dcp_asset_tile_observation','marvel_dcp_load_exception'
  ]
  loop
    execute format(
      'revoke insert, update, delete, truncate, references, trigger, maintain on plm.%I from service_role', t);
    execute format('revoke all on plm.%I from public', t);
    execute format('revoke all on plm.%I from anon', t);
    execute format('grant select on plm.%I to service_role', t);
    execute format('grant select on plm.%I to authenticated', t);
  end loop;
end;
$$;

-- =====================================================================================
-- SECTION 8. ROW LEVEL SECURITY
--
-- AN RLS POLICY IS NOT A GRANT, and a GRANT IS NOT A POLICY. Both are required, so both
-- are set, in loops that cannot skip a table by hand.
--
-- THE PREDICATE IS THE ROLE GATE from 20260807190000:73-81, the one Warner adopted in
-- 20260810110000. `using (true)` IS FORBIDDEN HERE. It was a live security defect on the
-- Disney OPA extract -- it made confidential licensor data readable by EVERY signed-in
-- account, including vendor and viewer principals -- and this is the same licensor's data
-- from a second portal. Note honestly what the predicate does: app.has_app_access checks
-- for a non-revoked app-access row and ignores roles entirely, so plm app access alone is
-- sufficient. Narrowing that is an owner decision affecting every table sharing this
-- pattern and is out of scope here.
-- =====================================================================================
do $$
declare t text;
begin
  foreach t in array array[
    'marvel_dcp_crawl','marvel_dcp_portal_tile','marvel_dcp_style_guide','marvel_dcp_asset',
    'marvel_dcp_crawl_section','marvel_dcp_crawl_gap','marvel_dcp_asset_crawl',
    'marvel_dcp_asset_tile_observation','marvel_dcp_load_exception'
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
-- Disney Marvel DCP Vault -- PHASE 2 metadata landing schema.
--
-- Migration: 20260811050000_marvel_dcp_vault_metadata_landing.sql
-- Issue:     u2giants/shared-db #748 (workstream). Object claim: #749 -- this migration
--            owns eight NEW plm.marvel_dcp_* tables and touches NOTHING that already exists.
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
-- CONFIDENTIALITY. u2giants/shared-db is a PUBLIC repository. The Marvel DCP Vault extract is
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
--   THE ENFORCEMENT: plm.marvel_dcp_asset_property_observation and
--   plm.marvel_dcp_asset_character_observation are separate tables with NO foreign key between
--   them, no shared surrogate, no trigger that reads one while writing the other, and no
--   function anywhere in 20260811060000 that opens both in the same statement.
--   plm.marvel_dcp_character DELIBERATELY HAS NO PROPERTY COLUMN. That absence is a locked
--   decision -- do not "finish" it. Disney OPA (plm.opa_*) is the ONLY Disney source that
--   directly asserts property-to-character, and it is a different portal with a different
--   landing schema which must not be folded into this one.
--
-- RULE 2 -- THE PATH IS THE ASSET IDENTITY. File name is NOT unique; collisions are
--   observed in this source in the thousands. The style-guide source id is NULLABLE TEXT
--   in two different observed formats. A NAME IS NEVER AN ID. This migration therefore
--   never keys anything on a name, and reaches assets only through plm.marvel_dcp_asset.id,
--   which Phase 1 keyed on (source_system, source_path).
--
-- RULE 3 -- METADATA IS TIME-VARYING OBSERVATION DATA. Every scalar and every link in
--   this migration is keyed by (metadata_run_id, marvel_dcp_asset_id) -- NEVER written onto the
--   stable plm.marvel_dcp_asset row. The source is a point-in-time portal snapshot with no
--   change feed, so overwriting one "current metadata" row loses the fact that a title,
--   owner, restriction or tag changed. A future view may select the latest complete run;
--   the landing layer keeps them all.
--
-- RULE 4 -- HTTP 200 IS NOT SUCCESS. A signed-out Marvel DCP Vault session returns HTTP 200 with
--   a tiny zero-record body. fetch_status is therefore a first-class column with its own
--   'signed_out' value, and 20260811060000 refuses to mark a response successful on
--   status code alone.
--
-- =====================================================================================
-- SECTION -0.5. WHAT THIS MIGRATION DELIBERATELY DOES NOT DO
-- =====================================================================================
--
-- (a) IT DOES NOT TOUCH plm.marvel_dcp_asset_row_hash OR ANY PHASE-1 OBJECT. The Phase-1 frozen
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
--     and for the same reason. No application reads Marvel DCP Vault data today. An api view is
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
-- SECTION 0. THE SECOND FROZEN SERIALIZATION -- plm.marvel_dcp_metadata_row_hash
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
-- IT IS A DIFFERENT FUNCTION FROM plm.marvel_dcp_asset_row_hash AND MUST STAY ONE. They digest
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
--   refused row becomes a plm.marvel_dcp_load_exception, never a silently different digest.
--
-- WHY 22 NAMED PARAMETERS AND NOT ONE text[] OF SCALARS: an array makes slot ORDER the
--   caller's responsibility, and a caller that reorders two slots produces a valid-looking
--   digest of the wrong serialization with no error anywhere. Named parameters make the
--   order the FUNCTION's responsibility, which is the whole point of computing the digest
--   in the database instead of in a loader.
-- =====================================================================================
create or replace function plm.marvel_dcp_metadata_row_hash(
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
        'a response must be recorded in plm.marvel_dcp_load_exception instead. No value is '
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

comment on function plm.marvel_dcp_metadata_row_hash(
  text, text, text, text, text, text, text, text, text, text, text,
  text, text, text, text, text, text, text, text[], text[], text[], text[]) is
'Canonical normalized-metadata digest for plm.marvel_dcp_metadata_asset.normalized_hash. sha256, '
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
'plm.marvel_dcp_asset_row_hash and must stay separate -- that one is already frozen over ~155,900 '
'Phase-1 rows. This one freezes on the first complete metadata load: change it now or '
'never. Full normative specification in section 0 of migration 20260811050000.';

revoke all on function plm.marvel_dcp_metadata_row_hash(
  text, text, text, text, text, text, text, text, text, text, text,
  text, text, text, text, text, text, text, text[], text[], text[], text[]) from public;
grant execute on function plm.marvel_dcp_metadata_row_hash(
  text, text, text, text, text, text, text, text, text, text, text,
  text, text, text, text, text, text, text, text[], text[], text[], text[])
  to authenticated, service_role;

-- =====================================================================================
-- SECTION 1. plm.marvel_dcp_metadata_run -- one row per attempt to fetch metadata for every
--            asset in ONE COMPLETED path crawl.
-- =====================================================================================
create table plm.marvel_dcp_metadata_run (
  metadata_run_id      uuid primary key default gen_random_uuid(),

  -- on delete restrict, NOT cascade: a path crawl that has metadata hanging off it is
  -- evidence a metadata run depended on, and deleting it silently would strand the
  -- interpretation of every response.
  source_crawl_id      uuid not null references plm.marvel_dcp_crawl(crawl_id) on delete restrict,

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

  constraint marvel_dcp_metadata_run_status_chk
    check (status in ('planned','running','complete','failed')),

  constraint marvel_dcp_metadata_run_captured_on_chk
    check (captured_on >= date '2026-01-01'),

  -- No scheme, no host, no query string, no whitespace. A leading '/' is required so the
  -- value cannot accidentally be a bare host name.
  constraint marvel_dcp_metadata_run_endpoint_chk check (
    btrim(endpoint_suffix) = endpoint_suffix
    and endpoint_suffix <> ''
    and left(endpoint_suffix, 1) = '/'
    and position('://' in endpoint_suffix) = 0
    and position('?' in endpoint_suffix) = 0
    and endpoint_suffix !~ '\s'
  ),

  constraint marvel_dcp_metadata_run_crawler_version_chk check (btrim(crawler_version) <> ''),
  constraint marvel_dcp_metadata_run_captured_by_chk check (btrim(captured_by) <> ''),
  -- A 40-char hex sha1 or a 64-char hex sha256. Provenance that cannot be resolved back
  -- to an exact private commit is not provenance.
  constraint marvel_dcp_metadata_run_commit_chk
    check (private_source_commit ~ '^[0-9a-f]{40}$'
        or private_source_commit ~ '^[0-9a-f]{64}$'),

  constraint marvel_dcp_metadata_run_expected_chk check (assets_expected >= 0),
  constraint marvel_dcp_metadata_run_counts_chk check (
    (fetches_succeeded is null or fetches_succeeded >= 0)
    and (fetches_failed is null or fetches_failed >= 0)
  ),

  -- THE COMPLETENESS ARITHMETIC, AS A CONSTRAINT AND NOT AS A HOPE.
  -- A run may only be `complete` when both counts are present and they add up to exactly
  -- what was expected. This is the structural form of "a missing chunk cannot assemble
  -- into a shorter complete run": the count was fixed at begin time from the source
  -- crawl's own membership, so a load that quietly dropped rows cannot balance.
  constraint marvel_dcp_metadata_run_complete_chk check (
    status <> 'complete'
    or (fetches_succeeded is not null
        and fetches_failed is not null
        and fetches_succeeded + fetches_failed = assets_expected
        and finished_at is not null)
  ),
  constraint marvel_dcp_metadata_run_failed_chk check (
    status <> 'failed' or (failure_message is not null and btrim(failure_message) <> '')
  ),
  constraint marvel_dcp_metadata_run_running_chk check (
    status = 'planned' or started_at is not null
  ),
  constraint marvel_dcp_metadata_run_finished_order_chk check (
    finished_at is null or started_at is null or finished_at >= started_at
  ),

  -- Supports the composite foreign key on plm.marvel_dcp_metadata_asset that pins a metadata row
  -- to the SAME source crawl its run declared. Redundant as a uniqueness statement --
  -- metadata_run_id is already the primary key -- and REQUIRED as a referencable target,
  -- because PostgreSQL will only accept a composite FK against a declared unique key.
  constraint marvel_dcp_metadata_run_run_crawl_unique unique (metadata_run_id, source_crawl_id)
);

-- ONE RUNNING RUN PER SOURCE CRAWL. A partial unique index, not a CHECK: the rule is
-- about the relationship BETWEEN rows, which a row constraint cannot see. Two concurrent
-- runs over one crawl would each believe they own the reconciliation and each finalize
-- against the other's rows.
create unique index idx_marvel_dcp_metadata_run_one_running
  on plm.marvel_dcp_metadata_run (source_crawl_id)
  where status = 'running';

create index idx_marvel_dcp_metadata_run_source_crawl on plm.marvel_dcp_metadata_run (source_crawl_id);
create index idx_marvel_dcp_metadata_run_status on plm.marvel_dcp_metadata_run (status);

comment on table plm.marvel_dcp_metadata_run is
'One row per attempt to fetch Marvel DCP Vault metadata for every asset in ONE COMPLETED path '
'crawl. A metadata run is NOT another path crawl: it hangs off plm.marvel_dcp_crawl and may only '
'cover assets that crawl observed. assets_expected is fixed at begin time from the source '
'crawl''s own plm.marvel_dcp_asset_crawl membership, which is what makes the completeness '
'arithmetic meaningful -- a load that silently dropped rows cannot make '
'succeeded + failed = expected balance. Only ONE run per source crawl may be `running` at '
'a time (partial unique index). A `complete` run is IMMUTABLE, including against INSERT '
'into its evidence tables.';
comment on column plm.marvel_dcp_metadata_run.endpoint_suffix is
'The RELATIVE, NON-SECRET path suffix the metadata fetch used. Never a full URL, never a '
'query string, never a cookie, session id, bearer token or signed parameter -- a CHECK '
'enforces that shape rather than trusting the caller, because a credential written here '
'would live in this shared database''s logs and backups permanently.';
comment on column plm.marvel_dcp_metadata_run.assets_expected is
'The exact plm.marvel_dcp_asset_crawl row count of the source crawl, captured at begin time by '
'plm.begin_marvel_dcp_metadata_run. NEVER a caller-supplied number and never re-derived at '
'finalization -- re-deriving it at the end would let a run that lost rows redefine its own '
'target and report itself complete.';

-- =====================================================================================
-- SECTION 2. plm.marvel_dcp_metadata_asset -- one row per expected asset per metadata run.
--
-- This is the fetch-outcome and scalar-metadata table, and it is the join point every
-- link table hangs off.
--
-- THE TWO COMPOSITE FOREIGN KEYS, AND WHY NEITHER IS REDUNDANT.
--   FK-A  (metadata_run_id, source_crawl_id) -> marvel_dcp_metadata_run(metadata_run_id, source_crawl_id)
--         pins this row's source_crawl_id to the one its RUN declared. Without it a row
--         could name run R while claiming a different source crawl, and the membership
--         check below would then be performed against the wrong crawl entirely.
--   FK-B  (source_crawl_id, marvel_dcp_asset_id) -> marvel_dcp_asset_crawl(crawl_id, marvel_dcp_asset_id)
--         proves this asset was ACTUALLY OBSERVED BY THAT CRAWL. Without it, metadata
--         could be attached to any asset in the table, including one from a different
--         crawl or a different portal section, and the run's reconciliation would still
--         appear to balance.
--   TOGETHER they make "a metadata row cannot reference an asset outside its source
--   crawl" a structural impossibility rather than a loader convention. A single FK
--   straight to plm.marvel_dcp_asset(id) -- the obvious shape -- enforces neither.
-- =====================================================================================
create table plm.marvel_dcp_metadata_asset (
  metadata_run_id  uuid not null,
  source_crawl_id  uuid not null,
  marvel_dcp_asset_id     uuid not null,

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

  constraint marvel_dcp_metadata_asset_pkey primary key (metadata_run_id, marvel_dcp_asset_id),

  -- FK-A and FK-B. See the header above; neither replaces the other.
  constraint marvel_dcp_metadata_asset_run_fk
    foreign key (metadata_run_id, source_crawl_id)
    references plm.marvel_dcp_metadata_run (metadata_run_id, source_crawl_id) on delete cascade,
  constraint marvel_dcp_metadata_asset_membership_fk
    foreign key (source_crawl_id, marvel_dcp_asset_id)
    references plm.marvel_dcp_asset_crawl (crawl_id, marvel_dcp_asset_id) on delete restrict,

  constraint marvel_dcp_metadata_asset_fetch_status_chk check (
    fetch_status in ('pending','success','not_found','signed_out','rejected','failed')
  ),
  constraint marvel_dcp_metadata_asset_attempts_chk check (attempt_count >= 0),
  constraint marvel_dcp_metadata_asset_bytes_chk check (response_bytes is null or response_bytes >= 0),
  constraint marvel_dcp_metadata_asset_http_chk check (http_status is null or http_status between 100 and 599),

  -- FAILURE-STATE COHERENCE, BOTH WAYS. A terminal failure without a code is an
  -- untriageable row; a code on a success is a contradiction that would make any
  -- "how did this run fail" query lie.
  constraint marvel_dcp_metadata_asset_failure_coherence_chk check (
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
  --   plm.finalize_marvel_dcp_metadata_run refuses to complete any run holding a successful row
  --   without BOTH digests. A missing normalized_hash is therefore transient within a
  --   single load statement and impossible in any completed run.
  constraint marvel_dcp_metadata_asset_success_evidence_chk check (
    fetch_status <> 'success'
    or (raw_metadata is not null
        and jsonb_typeof(raw_metadata) = 'object'
        and retrieved_at is not null
        and source_hash is not null)
  ),
  -- A signed-out response must NOT retain a body. Storing it would keep a page of portal
  -- chrome in a licensor-confidential table for no diagnostic value.
  constraint marvel_dcp_metadata_asset_signed_out_chk check (
    fetch_status <> 'signed_out' or raw_metadata is null
  ),
  -- Hashes exist only where a success produced them, and always in the enforced shape.
  constraint marvel_dcp_metadata_asset_source_hash_chk
    check (source_hash is null or source_hash ~ '^[0-9a-f]{64}$'),
  constraint marvel_dcp_metadata_asset_normalized_hash_chk
    check (normalized_hash is null or normalized_hash ~ '^[0-9a-f]{64}$'),
  constraint marvel_dcp_metadata_asset_hash_only_on_success_chk check (
    fetch_status = 'success' or (source_hash is null and normalized_hash is null)
  ),

  -- Interpreted values may only exist where their raw source value exists. An interpreted
  -- boolean beside a NULL raw string is a value invented by the parser.
  constraint marvel_dcp_metadata_asset_interpreted_needs_raw_chk check (
    (is_exclusive_interpreted is null or is_exclusive_raw is not null)
    and (is_embargoed_interpreted is null or is_embargoed_raw is not null)
    and (is_locked_interpreted   is null or is_locked_raw   is not null)
    and (release_date_interpreted is null or release_date_raw is not null)
    and (modified_at_interpreted  is null or modified_at_raw  is not null)
    and (file_size_bytes_interpreted is null or file_size_raw is not null)
    and (num_pages_interpreted    is null or num_pages_raw    is not null)
  ),
  constraint marvel_dcp_metadata_asset_size_chk
    check (file_size_bytes_interpreted is null or file_size_bytes_interpreted >= 0),
  constraint marvel_dcp_metadata_asset_pages_chk
    check (num_pages_interpreted is null or num_pages_interpreted >= 0),

  -- THE SUCCESS-ONLY LINK TARGET. This unique key exists for ONE reason: the three link
  -- tables carry a fetch_status column pinned to 'success' by CHECK and reference this
  -- key, which makes "a link may only hang off a SUCCESSFUL metadata row" a declarative
  -- guarantee instead of a loader promise. It also blocks the reverse hole: a row cannot
  -- be flipped from 'success' to 'failed' while links still point at it, because the FK
  -- has nothing left to reference.
  constraint marvel_dcp_metadata_asset_success_key unique (metadata_run_id, marvel_dcp_asset_id, fetch_status)
);

create index idx_marvel_dcp_metadata_asset_asset on plm.marvel_dcp_metadata_asset (marvel_dcp_asset_id);
create index idx_marvel_dcp_metadata_asset_status on plm.marvel_dcp_metadata_asset (metadata_run_id, fetch_status);
create index idx_marvel_dcp_metadata_asset_crawl on plm.marvel_dcp_metadata_asset (source_crawl_id);
-- Supports "did this asset's metadata change between runs" without scanning a run.
create index idx_marvel_dcp_metadata_asset_normalized_hash
  on plm.marvel_dcp_metadata_asset (marvel_dcp_asset_id, normalized_hash)
  where normalized_hash is not null;
-- The open-work index: which expected assets have not reached a terminal state yet.
create index idx_marvel_dcp_metadata_asset_pending
  on plm.marvel_dcp_metadata_asset (metadata_run_id)
  where fetch_status = 'pending';

comment on table plm.marvel_dcp_metadata_asset is
'One row per EXPECTED asset per metadata run: the fetch outcome plus every scalar the DCP '
'Vault metadata response exposed, each preserved as the exact source text. Scalars are '
'NEVER written onto the stable plm.marvel_dcp_asset row -- metadata is time-varying observation '
'data and overwriting it would lose the fact that a title, owner or restriction changed. '
'Two composite foreign keys, neither redundant: one pins this row to the source crawl its '
'RUN declared, the other proves that crawl actually observed this asset. Together they '
'make "metadata for an asset outside its source crawl" structurally impossible. SUCCESS '
'means a valid metadata OBJECT was stored -- it does NOT mean every Disney field is '
'present, because some assets legitimately omit fields.';
comment on column plm.marvel_dcp_metadata_asset.fetch_status is
'pending | success | not_found | signed_out | rejected | failed. HTTP 200 IS NOT SUCCESS: '
'a signed-out Marvel DCP Vault session returns 200 with a tiny zero-record body, which is why '
'signed_out is its own terminal value and why a success additionally requires raw_metadata '
'to be a JSON OBJECT. Only a `success` row may carry links.';
comment on column plm.marvel_dcp_metadata_asset.raw_metadata is
'The exact metadata response as a JSON object, kept as evidence. It is EVIDENCE, not the '
'query surface -- the normalized columns and link tables exist precisely so consumers do '
'not each write their own JSON parser over licensor data. NULL on a signed_out row by '
'CHECK: a portal sign-out page has no diagnostic value and should not be retained.';
comment on column plm.marvel_dcp_metadata_asset.source_hash is
'sha256 of the EXACT UTF-8 bytes of the successful raw response TEXT as received, before '
'any cast to jsonb. Deliberately digests the received text and not the parsed value: jsonb '
'canonicalises key order, whitespace, escaping and number form, so a digest taken after '
'the cast would be of something the portal never sent and the capture could not reproduce. '
'Case and whitespace changes in the response DO change this digest, which is the point -- '
'normalized_hash is the one that ignores them.';
comment on column plm.marvel_dcp_metadata_asset.normalized_hash is
'plm.marvel_dcp_metadata_row_hash over the 18 raw scalars and the four sorted link SETS. Changes '
'when the meaning changed; ignores array order. The *_interpreted columns are NOT in it. '
'Its serialization freezes on the first complete production load -- see section 0 of '
'migration 20260811050000.';
comment on column plm.marvel_dcp_metadata_asset.rights_parse_confident is
'FALSE by default and FALSE whenever any rights value was not a spelling the loader has '
'explicitly been taught. The business meanings of isExclusive, isEmbargoed, isLocked and '
'status are UNKNOWN and require Disney''s licensing contact. An unknown value lands raw '
'with this flag false -- it never fails the load and it never coerces to a guess.';

-- =====================================================================================
-- SECTION 3. SOURCE IDENTITIES -- plm.marvel_dcp_property, plm.marvel_dcp_character, plm.marvel_dcp_term
--
-- These three outlive any single metadata run, exactly as plm.marvel_dcp_asset outlives any
-- single path crawl. A later run re-observing the same property is normal and must not be
-- an error, so they are NOT frozen wholesale -- only their SOURCE columns freeze once a
-- COMPLETE run has seen them (section 5.2).
--
-- READ RULE 1 AT THE HEAD OF THIS FILE BEFORE TOUCHING EITHER OF THE FIRST TWO.
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- 3.1 plm.marvel_dcp_property -- one identity per distinct exact member of properties[]
-- -------------------------------------------------------------------------------------
create table plm.marvel_dcp_property (
  id                  uuid primary key default gen_random_uuid(),
  source_system       text not null default 'marvel_dcpvault' check (source_system = 'marvel_dcpvault'),
  source_id           text not null,

  -- Populated ONLY if the portal separately exposes a human label. It is NEVER parsed out
  -- of the id, and it is NEVER used as a key -- see RULE 2. A display name derived from an
  -- id would look like source truth and be our invention.
  display_name        text null,

  first_seen_metadata_run_id uuid null
    references plm.marvel_dcp_metadata_run(metadata_run_id) on delete set null,
  last_seen_metadata_run_id  uuid null
    references plm.marvel_dcp_metadata_run(metadata_run_id) on delete set null,

  -- Reconciliation only. NULL at landing, never written by any loader.
  core_property_id    uuid null,
  resolved_at         timestamptz null,
  resolved_by         text null,
  resolution_note     text null,

  raw                 jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint marvel_dcp_property_source_id_chk check (btrim(source_id) <> ''),
  constraint marvel_dcp_property_display_name_chk
    check (display_name is null or btrim(display_name) <> ''),
  constraint marvel_dcp_property_unique unique (source_system, source_id)
);

create index idx_marvel_dcp_property_core on plm.marvel_dcp_property (core_property_id)
  where core_property_id is not null;

comment on table plm.marvel_dcp_property is
'One SOURCE IDENTITY per distinct exact member of the Marvel DCP Vault metadata properties[] '
'array. A landing identity, NOT a canonical property: core_property_id is nullable, is '
'NULL at landing, and is written only by a later human-reviewed mapping -- no loader ever '
'sets it and nothing here creates, renames or deactivates a core.property row. Portal '
'TILES are not properties either; tile observations live in plm.marvel_dcp_asset_tile_observation '
'and are a browsing filter, not Disney''s asserted property list.';

-- -------------------------------------------------------------------------------------
-- 3.2 plm.marvel_dcp_character -- one identity per distinct exact member of character[]
--
-- IT HAS NO PROPERTY COLUMN AND NO PROPERTY FOREIGN KEY. THAT IS THE DESIGN, NOT AN
-- OMISSION, AND IT IS LOCKED. See RULE 1. Marvel DCP Vault never asserts which property a
-- character belongs to; adding the column would create a slot that someone eventually
-- fills by pairing the two arrays on an asset, which fabricates relationships Disney
-- never stated. Disney OPA is the only source that asserts property-to-character, it has
-- its own plm.opa_* landing, and the two must not be folded together.
-- -------------------------------------------------------------------------------------
create table plm.marvel_dcp_character (
  id                  uuid primary key default gen_random_uuid(),
  source_system       text not null default 'marvel_dcpvault' check (source_system = 'marvel_dcpvault'),
  source_id           text not null,
  display_name        text null,

  first_seen_metadata_run_id uuid null
    references plm.marvel_dcp_metadata_run(metadata_run_id) on delete set null,
  last_seen_metadata_run_id  uuid null
    references plm.marvel_dcp_metadata_run(metadata_run_id) on delete set null,

  core_character_id   uuid null,
  resolved_at         timestamptz null,
  resolved_by         text null,
  resolution_note     text null,

  raw                 jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint marvel_dcp_character_source_id_chk check (btrim(source_id) <> ''),
  constraint marvel_dcp_character_display_name_chk
    check (display_name is null or btrim(display_name) <> ''),
  constraint marvel_dcp_character_unique unique (source_system, source_id)
);

create index idx_marvel_dcp_character_core on plm.marvel_dcp_character (core_character_id)
  where core_character_id is not null;

comment on table plm.marvel_dcp_character is
'One SOURCE IDENTITY per distinct exact member of the Marvel DCP Vault metadata character[] '
'array. THIS TABLE HAS NO PROPERTY COLUMN AND NO PROPERTY FOREIGN KEY, DELIBERATELY AND '
'PERMANENTLY. Marvel DCP Vault never asserts which property a character belongs to. Adding such a '
'column creates a slot that is eventually filled by pairing properties[] with character[] '
'on the same asset -- one observed asset has NINE properties and ONE character, so that '
'pairing manufactures nine relationships Disney never stated, indistinguishable from real '
'ones forever. Disney OPA (plm.opa_*) is the only Disney source that directly asserts '
'property-to-character and must not be folded into this schema. A character is also NEVER '
'inferred from a folder or file name: assets were observed in character-named folders with '
'no character field at all, and a path is not an identifier assertion.';

-- -------------------------------------------------------------------------------------
-- 3.3 plm.marvel_dcp_term -- reusable exact vocabulary for CLASSIFICATION arrays
--
-- artStyle[] and keyword[] are classifications, not business entities, so they share one
-- vocabulary table discriminated by term_kind rather than getting a table each. If a later
-- sample proves another field is an array, widen term_kind IN A NEW MIGRATION. Do NOT
-- overload this table with properties or characters -- those are entities with their own
-- reconciliation columns and their own locked independence rule.
-- -------------------------------------------------------------------------------------
create table plm.marvel_dcp_term (
  id                  uuid primary key default gen_random_uuid(),
  source_system       text not null default 'marvel_dcpvault' check (source_system = 'marvel_dcpvault'),
  term_kind           text not null,
  source_value        text not null,

  first_seen_metadata_run_id uuid null
    references plm.marvel_dcp_metadata_run(metadata_run_id) on delete set null,
  last_seen_metadata_run_id  uuid null
    references plm.marvel_dcp_metadata_run(metadata_run_id) on delete set null,

  raw                 jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint marvel_dcp_term_kind_chk check (term_kind in ('art_style','keyword')),
  constraint marvel_dcp_term_source_value_chk check (btrim(source_value) <> ''),
  constraint marvel_dcp_term_unique unique (source_system, term_kind, source_value)
);

comment on table plm.marvel_dcp_term is
'Reusable EXACT source vocabulary for the Marvel DCP Vault classification arrays. term_kind is '
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
-- Each is keyed by (metadata_run_id, marvel_dcp_asset_id, <target>) so that:
--   * a duplicate array member collapses to ONE link (primary key) without rejecting the
--     response -- a repeated value in the source array is a source quirk, not a load
--     failure;
--   * links are per RUN, so yesterday's observation is never overwritten by today's;
--   * an EMPTY array is represented as ZERO link rows beside a SUCCESSFUL metadata row,
--     which is a completely different state from "no successful metadata row exists".
--
-- THE fetch_status COLUMN ON EACH LINK TABLE IS NOT DENORMALISATION. It is pinned to
-- 'success' by CHECK and carried into the composite foreign key against
-- marvel_dcp_metadata_asset_success_key, which makes "a link may only hang off a SUCCESSFUL
-- metadata row" a guarantee the database enforces rather than a promise the loader makes.
-- It also closes the reverse hole: a metadata row cannot be flipped away from 'success'
-- while links still reference it.
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- 4.1 asset -> property. INDEPENDENT OF 4.2.
-- -------------------------------------------------------------------------------------
create table plm.marvel_dcp_asset_property_observation (
  metadata_run_id uuid not null,
  marvel_dcp_asset_id    uuid not null,
  marvel_dcp_property_id uuid not null references plm.marvel_dcp_property(id) on delete restrict,
  fetch_status    text not null default 'success',
  observed_at     timestamptz not null default now(),

  constraint marvel_dcp_asset_property_obs_pkey
    primary key (metadata_run_id, marvel_dcp_asset_id, marvel_dcp_property_id),
  constraint marvel_dcp_asset_property_obs_success_chk check (fetch_status = 'success'),
  constraint marvel_dcp_asset_property_obs_asset_fk
    foreign key (metadata_run_id, marvel_dcp_asset_id, fetch_status)
    references plm.marvel_dcp_metadata_asset (metadata_run_id, marvel_dcp_asset_id, fetch_status)
    on delete cascade
);

create index idx_marvel_dcp_asset_property_obs_property
  on plm.marvel_dcp_asset_property_observation (marvel_dcp_property_id);
create index idx_marvel_dcp_asset_property_obs_run
  on plm.marvel_dcp_asset_property_observation (metadata_run_id);

comment on table plm.marvel_dcp_asset_property_observation is
'Asset-to-property links observed in ONE metadata run. INDEPENDENT of '
'plm.marvel_dcp_asset_character_observation: the two sets are never joined, zipped or '
'cross-produced, and no foreign key, trigger or loader statement relates them. Disney '
'returns properties[] and character[] as separate unordered arrays and asserts NOTHING by '
'their co-presence. ZERO rows here beside a SUCCESSFUL metadata row means "the portal '
'returned an empty property array" -- which is a real fact, entirely different from "no '
'successful metadata row exists". The composite FK carries fetch_status pinned to '
'''success'', so a link cannot hang off a failed, pending or signed-out fetch.';

-- -------------------------------------------------------------------------------------
-- 4.2 asset -> character. INDEPENDENT OF 4.1.
-- -------------------------------------------------------------------------------------
create table plm.marvel_dcp_asset_character_observation (
  metadata_run_id  uuid not null,
  marvel_dcp_asset_id     uuid not null,
  marvel_dcp_character_id uuid not null references plm.marvel_dcp_character(id) on delete restrict,
  fetch_status     text not null default 'success',
  observed_at      timestamptz not null default now(),

  constraint marvel_dcp_asset_character_obs_pkey
    primary key (metadata_run_id, marvel_dcp_asset_id, marvel_dcp_character_id),
  constraint marvel_dcp_asset_character_obs_success_chk check (fetch_status = 'success'),
  constraint marvel_dcp_asset_character_obs_asset_fk
    foreign key (metadata_run_id, marvel_dcp_asset_id, fetch_status)
    references plm.marvel_dcp_metadata_asset (metadata_run_id, marvel_dcp_asset_id, fetch_status)
    on delete cascade
);

create index idx_marvel_dcp_asset_character_obs_character
  on plm.marvel_dcp_asset_character_observation (marvel_dcp_character_id);
create index idx_marvel_dcp_asset_character_obs_run
  on plm.marvel_dcp_asset_character_observation (metadata_run_id);

comment on table plm.marvel_dcp_asset_character_observation is
'Asset-to-character links observed in ONE metadata run. INDEPENDENT of '
'plm.marvel_dcp_asset_property_observation -- see that table''s comment and RULE 1 in migration '
'20260811050000. An asset with many properties and one character creates many rows THERE '
'and one row HERE, and NOTHING relates them. A character is never inferred from a folder '
'or file name. ZERO rows here beside a successful metadata row means the portal returned '
'no character for this asset, which the sample proved is common and legitimate.';

-- -------------------------------------------------------------------------------------
-- 4.3 asset -> classification term
-- -------------------------------------------------------------------------------------
create table plm.marvel_dcp_asset_term_observation (
  metadata_run_id uuid not null,
  marvel_dcp_asset_id    uuid not null,
  marvel_dcp_term_id     uuid not null references plm.marvel_dcp_term(id) on delete restrict,
  fetch_status    text not null default 'success',
  observed_at     timestamptz not null default now(),

  constraint marvel_dcp_asset_term_obs_pkey
    primary key (metadata_run_id, marvel_dcp_asset_id, marvel_dcp_term_id),
  constraint marvel_dcp_asset_term_obs_success_chk check (fetch_status = 'success'),
  constraint marvel_dcp_asset_term_obs_asset_fk
    foreign key (metadata_run_id, marvel_dcp_asset_id, fetch_status)
    references plm.marvel_dcp_metadata_asset (metadata_run_id, marvel_dcp_asset_id, fetch_status)
    on delete cascade
);

create index idx_marvel_dcp_asset_term_obs_term on plm.marvel_dcp_asset_term_observation (marvel_dcp_term_id);
create index idx_marvel_dcp_asset_term_obs_run on plm.marvel_dcp_asset_term_observation (metadata_run_id);

comment on table plm.marvel_dcp_asset_term_observation is
'Asset-to-classification-term links (art_style, keyword) observed in ONE metadata run. The '
'term_kind lives on plm.marvel_dcp_term, so one link table covers both arrays without letting a '
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
-- service_role, so guarded SECURITY DEFINER functions are the only writing path
-- still available to the loader's role, which makes it the one an UPDATE/DELETE-only
-- trigger would leave completely unguarded. The concrete hole here: metadata run R
-- finalizes with its counts reconciled, and then a plain
--     insert into plm.marvel_dcp_asset_character_observation (metadata_run_id, ...) values (R, ...);
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
create or replace function plm.marvel_dcp_reject_completed_metadata_change()
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
  from plm.marvel_dcp_metadata_run r
  where r.metadata_run_id = v_run;

  if v_status = 'complete' then
    raise exception
      'Marvel DCP Vault metadata run % is COMPLETE and its evidence is immutable; % on %.% is '
      'refused. A refresh is a NEW metadata_run_id, never an edit of an old one -- editing '
      'completed evidence destroys the only record of what the portal actually returned.',
      v_run, tg_op, tg_table_schema, tg_table_name
      using errcode = 'P0001';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

comment on function plm.marvel_dcp_reject_completed_metadata_change() is
'Row trigger freezing every RUN-SCOPED plm.marvel_dcp_* metadata table once its owning '
'plm.marvel_dcp_metadata_run reaches status complete. FIRES ON INSERT, UPDATE AND DELETE -- all '
'three, deliberately. INSERT is not an afterthought: section 6 of migration 20260811050000 '
'revokes every direct mutation from service_role, so guarded functions are the '
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
    'marvel_dcp_metadata_asset',
    'marvel_dcp_asset_property_observation',
    'marvel_dcp_asset_character_observation',
    'marvel_dcp_asset_term_observation'
  ]
  loop
    execute format(
      'create trigger %I before insert or update or delete on plm.%I '
      'for each row execute function plm.marvel_dcp_reject_completed_metadata_change()',
      'trg_' || t || '_immutable', t);
  end loop;
end;
$$;

-- -------------------------------------------------------------------------------------
-- 5.1b plm.marvel_dcp_metadata_run itself -- frozen once complete.
--
-- Attached separately because the run row's own key column is metadata_run_id, so the
-- generic function above would work, but the transition INTO 'complete' must still be
-- permitted. A trigger that refused every UPDATE on a complete run would also refuse the
-- UPDATE that MAKES it complete, and finalization could never run.
-- -------------------------------------------------------------------------------------
create or replace function plm.marvel_dcp_metadata_run_freeze()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'complete' then
      raise exception 'Marvel DCP Vault metadata run % is COMPLETE and may not be deleted. '
        'Deleting a completed run is how the record of what the portal returned stops '
        'existing; never destroy licensed evidence as a correction.', old.metadata_run_id
        using errcode = 'P0001';
    end if;
    return old;
  end if;

  -- OLD.status = 'complete' is the frozen state. The transition running -> complete is
  -- performed while OLD is still 'running', so finalization is unaffected by this guard.
  if old.status = 'complete' then
    raise exception 'Marvel DCP Vault metadata run % is COMPLETE and immutable. A re-fetch is a '
      'NEW metadata_run_id, never an edit of a finished one.', old.metadata_run_id
      using errcode = 'P0001';
  end if;

  -- A run may never leave a terminal state for a live one. Without this, a `failed` run
  -- could be quietly reopened and finalized as though it had always succeeded.
  if old.status = 'failed' and new.status <> 'failed' then
    raise exception 'Marvel DCP Vault metadata run % is FAILED and may not be reopened. Start a '
      'NEW run; the failed one stays as the record of what happened.', old.metadata_run_id
      using errcode = 'P0001';
  end if;

  -- The source crawl is the run's identity as much as its own id is. Re-pointing a run at
  -- a different crawl mid-flight would invalidate every membership check already passed.
  if new.source_crawl_id is distinct from old.source_crawl_id then
    raise exception 'Marvel DCP Vault metadata run %: source_crawl_id is immutable. Re-pointing a '
      'run at a different crawl invalidates every membership check its rows already '
      'passed.', old.metadata_run_id using errcode = 'P0001';
  end if;

  if new.assets_expected is distinct from old.assets_expected then
    raise exception 'Marvel DCP Vault metadata run %: assets_expected is fixed at begin time and '
      'is immutable. A run that could restate its own target could always report itself '
      'complete.', old.metadata_run_id using errcode = 'P0001';
  end if;

  return new;
end;
$$;

comment on function plm.marvel_dcp_metadata_run_freeze() is
'Freeze for plm.marvel_dcp_metadata_run itself. Refuses UPDATE and DELETE once status is '
'complete, refuses reopening a failed run, and pins source_crawl_id and assets_expected '
'for the run''s whole life. It reads OLD.status deliberately, so the running -> complete '
'transition that finalization performs is still allowed -- a guard written against '
'NEW.status would refuse the very UPDATE that completes the run and finalization could '
'never succeed. assets_expected is pinned because a run able to restate its own target '
'could always make succeeded + failed = expected balance.';

create trigger trg_marvel_dcp_metadata_run_freeze
  before update or delete on plm.marvel_dcp_metadata_run
  for each row execute function plm.marvel_dcp_metadata_run_freeze();

-- -------------------------------------------------------------------------------------
-- 5.2 Stable identities: SOURCE columns freeze; OUR columns stay editable.
--
-- plm.marvel_dcp_property, plm.marvel_dcp_character and plm.marvel_dcp_term outlive any single metadata run,
-- so they are NOT frozen wholesale -- a later run re-observing the same identity is normal.
--
-- What freezes: the SOURCE columns, once the row has been observed by any COMPLETE run.
-- What stays editable forever: last_seen_metadata_run_id, updated_at, and the
-- reconciliation columns -- those are OUR decisions, made after the fact, and are the
-- entire reason these tables have them.
-- DELETE is refused outright once a complete run has seen the row.
-- -------------------------------------------------------------------------------------
create or replace function plm.marvel_dcp_reject_completed_metadata_identity_change()
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
  if tg_table_name = 'marvel_dcp_property' then
    select exists (
      select 1 from plm.marvel_dcp_asset_property_observation o
      join plm.marvel_dcp_metadata_run r on r.metadata_run_id = o.metadata_run_id
      where o.marvel_dcp_property_id = old.id and r.status = 'complete'
    ) into v_seen;
  elsif tg_table_name = 'marvel_dcp_character' then
    select exists (
      select 1 from plm.marvel_dcp_asset_character_observation o
      join plm.marvel_dcp_metadata_run r on r.metadata_run_id = o.metadata_run_id
      where o.marvel_dcp_character_id = old.id and r.status = 'complete'
    ) into v_seen;
  elsif tg_table_name = 'marvel_dcp_term' then
    select exists (
      select 1 from plm.marvel_dcp_asset_term_observation o
      join plm.marvel_dcp_metadata_run r on r.metadata_run_id = o.metadata_run_id
      where o.marvel_dcp_term_id = old.id and r.status = 'complete'
    ) into v_seen;
  else
    -- An unknown table means this trigger was attached somewhere it was not designed for.
    -- FAIL LOUDLY. Returning NEW here would install a guard that silently permits
    -- everything on the new table, which is worse than no guard at all.
    raise exception 'plm.marvel_dcp_reject_completed_metadata_identity_change is attached to %.% '
      'which it does not know how to evaluate. Extend the function before attaching it.',
      tg_table_schema, tg_table_name using errcode = 'P0001';
  end if;

  if not v_seen then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    raise exception 'Marvel DCP Vault: %.% row % has been observed by a COMPLETE metadata run and '
      'may not be deleted. Other runs reference this identity.',
      tg_table_schema, tg_table_name, old.id using errcode = 'P0001';
  end if;

  -- `id` is compared too. Without it an observed identity could be RE-KEYED -- every other
  -- column identical, a new primary key -- which breaks every link row pointing at it while
  -- looking like nothing changed.
  if tg_table_name = 'marvel_dcp_term' then
    if new.id            is distinct from old.id
    or new.source_system is distinct from old.source_system
    or new.term_kind     is distinct from old.term_kind
    or new.source_value  is distinct from old.source_value
    or new.first_seen_metadata_run_id is distinct from old.first_seen_metadata_run_id
    or new.created_at    is distinct from old.created_at then
      raise exception 'Marvel DCP Vault: the SOURCE columns of %.% row % are immutable once a '
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
      raise exception 'Marvel DCP Vault: the SOURCE columns of %.% row % are immutable once a '
        'COMPLETE metadata run has observed it. last_seen_metadata_run_id, updated_at and '
        'the reconciliation columns remain editable -- those are our decisions, not the '
        'portal''s.', tg_table_schema, tg_table_name, old.id using errcode = 'P0001';
    end if;
  end if;

  return new;
end;
$$;

comment on function plm.marvel_dcp_reject_completed_metadata_identity_change() is
'Row trigger for the STABLE metadata identities (plm.marvel_dcp_property, plm.marvel_dcp_character, '
'plm.marvel_dcp_term). These outlive any single run, so they are NOT frozen wholesale -- a later '
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
  foreach t in array array['marvel_dcp_property','marvel_dcp_character','marvel_dcp_term']
  loop
    execute format(
      'create trigger %I before update or delete on plm.%I '
      'for each row execute function plm.marvel_dcp_reject_completed_metadata_identity_change()',
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
-- THE POSTURE, identical to Phase 1: service_role keeps SELECT only; INSERT, UPDATE, DELETE,
-- TRUNCATE, REFERENCES, TRIGGER and MAINTAIN are revoked; public and anon get `revoke all`.
-- =====================================================================================
do $$
declare t text;
begin
  foreach t in array array[
    'marvel_dcp_metadata_run','marvel_dcp_metadata_asset',
    'marvel_dcp_property','marvel_dcp_character','marvel_dcp_term',
    'marvel_dcp_asset_property_observation','marvel_dcp_asset_character_observation',
    'marvel_dcp_asset_term_observation'
  ]
  loop
    execute format(
      'revoke insert, update, delete, truncate, references, trigger, maintain on plm.%I from service_role', t);
    execute format('revoke all on plm.%I from public', t);
    execute format('revoke all on plm.%I from anon', t);
    execute format('grant select on plm.%I to service_role', t);
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
    'marvel_dcp_metadata_run','marvel_dcp_metadata_asset',
    'marvel_dcp_property','marvel_dcp_character','marvel_dcp_term',
    'marvel_dcp_asset_property_observation','marvel_dcp_asset_character_observation',
    'marvel_dcp_asset_term_observation'
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
    'marvel_dcp_metadata_asset','marvel_dcp_asset_property_observation',
    'marvel_dcp_asset_character_observation','marvel_dcp_asset_term_observation'
  ]) as t
  where not exists (
    select 1 from information_schema.columns c
    where c.table_schema = 'plm' and c.table_name = t
      and c.column_name = 'metadata_run_id'
  );
  if v_missing is not null then
    raise exception 'DCP metadata landing self-check FAILED: table(s) % are attached to '
      'plm.marvel_dcp_reject_completed_metadata_change but have no metadata_run_id column. The '
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
      and c.column_name in ('marvel_dcp_property_id','marvel_dcp_character_id')
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
    and table_name ~ '^marvel_dcp_.*propert.*character|^marvel_dcp_.*character.*propert';
  if v_count > 0 then
    raise exception 'DCP metadata landing self-check FAILED: a plm.marvel_dcp_* property-character '
      'table exists. No such table may ever be created -- see RULE 1 in migration '
      '20260811050000.';
  end if;

  -- 8.4 The Phase-1 frozen hash must still exist and must NOT have been redefined into a
  -- different signature by anything in this migration. It is a ONE-WAY DOOR over ~155,900
  -- rows and this migration's contract is that it did not touch it.
  select count(*) into v_count
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'plm' and p.proname = 'marvel_dcp_asset_row_hash';
  if v_count <> 1 then
    raise exception 'DCP metadata landing self-check FAILED: expected exactly ONE '
      'plm.marvel_dcp_asset_row_hash, found %. The Phase-1 row hash is frozen over roughly '
      '155,900 rows; this migration must not add, replace or overload it.', v_count;
  end if;

  -- 8.5 Every one of the eight new tables must have RLS enabled AND a read policy. A
  -- GRANT is not a POLICY; a table with RLS enabled and no policy is unreadable, and a
  -- table with a policy and no RLS is wide open. Both halves are asserted.
  select string_agg(t, ', ') into v_missing
  from unnest(array[
    'marvel_dcp_metadata_run','marvel_dcp_metadata_asset','marvel_dcp_property','marvel_dcp_character','marvel_dcp_term',
    'marvel_dcp_asset_property_observation','marvel_dcp_asset_character_observation',
    'marvel_dcp_asset_term_observation'
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

  -- 8.6 service_role must hold NO direct mutating privilege on any of the eight tables.
  -- TRUNCATE above all: it fires no row trigger, so one TRUNCATE would erase a completed
  -- run's evidence with every section 5 guard silently standing by.
  select string_agg(distinct t || '/' || priv, ', ') into v_missing
  from unnest(array[
    'marvel_dcp_metadata_run','marvel_dcp_metadata_asset','marvel_dcp_property','marvel_dcp_character','marvel_dcp_term',
    'marvel_dcp_asset_property_observation','marvel_dcp_asset_character_observation',
    'marvel_dcp_asset_term_observation'
  ]) as t,
  unnest(array['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) as priv
  where has_table_privilege('service_role', 'plm.' || quote_ident(t), priv);
  if v_missing is not null then
    raise exception 'DCP metadata landing self-check FAILED: service_role still holds '
      'mutating privileges: %. TRUNCATE in particular fires NO row triggers, so every '
      'immutability guarantee in section 5 depends on these revokes.', v_missing;
  end if;

  raise notice 'DCP metadata landing self-checks passed: 8 tables, RLS + policies present, '
    'no property-character bridge, Phase-1 frozen hash untouched, service_role holds no '
    'direct mutating privilege.';
end;
$$;


-- 20th Century DCP Vault
-- =====================================================================================
-- Disney 20th Century DCP Vault -- source-observation landing schema.
--
-- Migration: 20260810190000_twentieth_century_dcp_vault_source_landing.sql
-- Issue:     u2giants/shared-db #665. Object claim: #725 -- this migration owns the
--            plm.twentieth_century_dcp_* namespace and touches NOTHING else.
-- Design:    licensor-source-data-disney/disney-dcpvault/
--            NORMALIZED-database-schema-design-20260810.md (PRIVATE repo).
-- Pattern:   20260810020000 (Paramount landing: privilege predicate, immutability
--            triggers, capture freeze), 20260810110000 (Warner: the PostgreSQL 17
--            revoke set and the RLS read gate), 20260807190000 (the read gate's origin).
-- Follows:   20260810190100 completes this build with the chunked loader protocol.
--            The two are bound by a co-presence rule in
--            scripts/production_migration_guard.py: 20260810190100 may not be promoted
--            without this migration.
--
-- SCHEMA ONLY. THIS MIGRATION LOADS NO DATA.
--
-- -------------------------------------------------------------------------------------
-- CONFIDENTIALITY. u2giants/shared-db is a PUBLIC repository. The 20th Century DCP Vault extract is
-- licensor-confidential Disney data held in the PRIVATE repository
-- u2giants/licensor-source-data-disney. Not one Disney tile slug, property name,
-- franchise, style-guide folder, region, DAM path, file name or portal URL appears in
-- this file, in any comment, in any CHECK constraint, in any error message, or in the
-- contract test. Only COUNTS and SCHEMA appear, which design section 9 permits.
--     SCHEMA IN GIT. DATA OUT OF GIT.
-- Error messages below report counts and identifiers, never source values, because this
-- database's logs are not private either.
--
-- =====================================================================================
-- SECTION -1. THE FIVE DECISIONS THAT DIVERGE FROM THE DESIGN DOCUMENT, AND WHY
-- =====================================================================================
--
-- DECISION 1 -- SCHEMA AND NAMING: plm.twentieth_century_dcp_*, NOT ingest.portal_*.
--   The design places these tables in an `ingest` schema under licensor-generic names
--   (portal_asset, portal_tile, ...). Overruled by owner ruling, for three reasons that
--   are recorded here so a future reader does not "restore" the design:
--
--   (a) PRECEDENT. Every prior licensor lands in plm.<prefix>_*: plm.pmt_* (Paramount,
--       20260810020000), plm.wb_* (Warner, 20260810030000), plm.nbcu_* (20260810070000),
--       plm.opa_* (Disney OPA, 20260807170000). A fifth licensor in a different schema
--       under a different naming convention would be the only one, and every generic
--       tool in this repo that enumerates landing tables keys on plm.
--
--   (b) THE DEFAULT-PRIVILEGE HOLE (issue #649). VERIFIED LIVE on 2026-08-10 by a
--       read-only Management API SELECT against pg_default_acl on BOTH projects
--       (production qsllyeztdwjgirsysgai and preview rjyboqwcdzcocqgmsyel, both
--       PostgreSQL 17.6). BOTH schemas currently read:
--           schema ingest, objtype r, acl {service_role=arwdDxtm/postgres}
--           schema plm,    objtype r, acl {service_role=arwdDxtm/postgres}
--       `arwdDxtm` is all eight table bits -- INSERT, SELECT, UPDATE, DELETE, TRUNCATE,
--       REFERENCES, TRIGGER and (PG17) MAINTAIN. A table created in EITHER schema is
--       BORN holding TRUNCATE for service_role, and TRUNCATE DOES NOT FIRE ROW TRIGGERS,
--       which would void every immutability guarantee in section 6 below with one
--       statement.
--
--       CORRECTION TO THE DISPATCH, RECORDED HONESTLY. The ruling that authorised this
--       migration stated that 20260810180000 has already narrowed `plm`, so plm tables
--       inherit the fix while ingest tables do not. The live read above shows
--       20260810180000 IS NOT YET APPLIED to production or to preview -- `plm` still
--       carries the full arwdDxtm default today. So the inheritance argument is a FUTURE
--       property, not a present one, and this migration DOES NOT RELY ON IT. Section 7
--       revokes the complete PostgreSQL 17 set explicitly on every table it creates,
--       immediately after creating it, and would be correct even if 20260810180000 were
--       never promoted. Reason (b) still favours plm over ingest -- plm is the schema
--       the fix is coming to and ingest is not -- but it is a tie-breaker here, not the
--       load-bearing protection. The load-bearing protection is section 7.
--
--   (c) NAMESPACE. `ingest.portal_asset` squats a licensor-generic name in a shared
--       schema. The next portal to land would have to either share these tables or pick
--       a worse name. #665's own direction is per-licensor landing.
--
-- DECISION 2 -- NO api.* VIEWS, DELIBERATELY.
--   Paramount ships 8 api.pmt_* views; this build ships ZERO, and that is a CHOICE, not
--   an omission. No application reads 20th Century DCP Vault data today: there is no PopDAM screen, no
--   dflow screen and no report behind it. An api view is a published read contract that
--   must then be versioned and kept stable forever, and publishing one before a caller
--   exists fixes a shape nobody has validated. When the first reader appears, it brings
--   its required columns with it and the view is authored then, in its own migration.
--   Until then plm.twentieth_century_dcp_* is reachable directly by the approved roles under section 8's
--   RLS gate. THIS SENTENCE EXISTS SO NOBODY LATER READS THE ABSENCE AS AN OVERSIGHT.
--
-- DECISION 3 -- crawl_section_id IS NULLABLE, AND THAT IS THE HONEST SIGNAL.
--   Design section 4.8 makes crawl_section_id the "exact query that proved the link" and
--   also warns against manufacturing a cross-product from an already-aggregated row.
--   Those two requirements collide on the CSV that exists today: that file is ALREADY
--   AGGREGATED -- one row per DAM path carrying a pipe-joined tile list and two boolean
--   listing flags -- so the specific portal query that returned each tile/file pair was
--   not preserved and CANNOT be reconstructed. Writing a section id anyway would
--   manufacture exactly the false precision 4.8 forbids; making the column NOT NULL would
--   make the backfill unloadable.
--   RESOLUTION: crawl_section_id is NULLABLE, paired with a NOT NULL `link_evidence`
--   column and a CHECK that binds the two (section 5.6). 'section_query' REQUIRES a
--   section id; 'aggregated_row' REQUIRES the id to be NULL. The first load therefore
--   records, in the data itself, that it holds lower-fidelity truth than a future
--   section-aware crawl, and a consumer that needs proven provenance filters on
--   link_evidence = 'section_query'. The alternative -- a NOT NULL column filled with a
--   synthetic "CSV backfill" section -- would have made the two grades indistinguishable
--   forever.
--
-- DECISION 4 -- file_extension IS A PLAIN LOADER-COMPUTED COLUMN, NOT GENERATED.
--   A `GENERATED ... STORED` column is populated by PostgreSQL AFTER all BEFORE-row
--   triggers have run. Every immutability trigger in section 6 is a BEFORE trigger, so it
--   would read NULL for a generated file_extension on every row, compare NULL to NULL,
--   never fire -- and the migration would apply perfectly clean while the guard did
--   nothing. The column is therefore plain, computed by the loader, and constrained by
--   CHECK to the lowercase, dot-free shape the design requires.
--
-- DECISION 5 -- NO CHANGE TO dam.style_guide_file.
--   Design section 5 and change 7 ask for a nullable dam.style_guide_file.style_guide_id
--   before promotion. Confirmed live on both projects that the column does not exist
--   today. It is OUT OF SCOPE here by owner ruling: it alters a SHARED table PopDAM
--   reads, it is on a different review track, and nothing in this landing schema needs
--   it. THIS MIGRATION CREATES NO PROMOTION PATH AT ALL -- see the reconciliation
--   boundary below.
--
-- -------------------------------------------------------------------------------------
-- RECONCILIATION BOUNDARY. Nothing here creates, renames, merges, reparents, deactivates
-- or deletes a canonical core.* or dam.* record. The nullable core_property_id and
-- core_style_guide_id pointers are READ-ONLY reconciliation columns, NULL at landing,
-- always, and set only by a later reviewed decision. Specifically, per design section 3:
--   * A portal tile is NOT a property. Nothing here may write tile text into
--     core.property, and there is no function in this migration that could.
--   * This extract captured NO file-to-character relationship. No character table, no
--     character link table, and no character column is created. Do not add one from this
--     source.
-- =====================================================================================

-- =====================================================================================
-- SECTION 0. The privilege predicate.
--
-- THE NULL-PERMISSIVE TRAP THIS AVOIDS. This shape is FORBIDDEN:
--     if not ( ... or auth.role() = 'service_role' ) then raise ...
-- Inside a migration auth.role() is NULL. `NULL = 'service_role'` is NULL, `false or NULL`
-- is NULL, and `if not NULL then` NEVER RUNS THE BODY. The guard reads strict and behaves
-- wide open. Contract: TRUE only on a NON-NULL, NON-EMPTY, POSITIVELY MATCHED identity.
--
-- It is a FUNCTION and not a DO block precisely so a contract test can CALL it and prove
-- the NULL case is rejected; an anonymous block never lands in pg_proc and cannot be
-- tested. It takes SESSION_USER, not CURRENT_USER: SECURITY DEFINER rewrites current_user
-- to the function owner, so a current_user check inside a definer function always passes
-- and guards nothing.
-- =====================================================================================
create or replace function plm.twentieth_century_dcp_loader_privilege_ok(
  p_role         text,
  p_session_user text
)
returns boolean
language sql
immutable
-- Pinned even though this is NOT a SECURITY DEFINER function and calls only builtins.
-- An IMMUTABLE function with an unpinned search_path is the shape that becomes a problem
-- the day someone adds a schema-qualified callee to it, and pinning costs nothing today.
set search_path = pg_catalog
as $$
  select
    (p_role is not null and btrim(p_role) = 'service_role')
    or
    (p_session_user is not null
     and btrim(p_session_user) in ('postgres', 'supabase_admin'));
$$;

comment on function plm.twentieth_century_dcp_loader_privilege_ok(text, text) is
'Privilege predicate for the Disney 20th Century DCP Vault loader. TRUE only for a NON-NULL, '
'positively matched identity: JWT role service_role, or session_user postgres/'
'supabase_admin. NULL or empty on BOTH arguments returns FALSE -- which is the case that '
'holds inside a migration, where auth.role() is NULL. Written as a callable function '
'rather than a DO block so a contract test can prove the NULL case is rejected.';

revoke all on function plm.twentieth_century_dcp_loader_privilege_ok(text, text) from public;
grant execute on function plm.twentieth_century_dcp_loader_privilege_ok(text, text) to authenticated, service_role;

-- =====================================================================================
-- SECTION 1. THE FROZEN CANONICAL ROW-HASH SERIALIZATION
--
-- ***** THIS SPECIFICATION IS FROZEN. IT IS A ONE-WAY DOOR. *****
--
-- plm.twentieth_century_dcp_asset_crawl.observed_row_hash is the ONLY mechanism that detects a changed row
-- between crawls. Once roughly 155,900 rows carry a hash, changing ANY detail of this
-- serialization -- the field list, their order, the separators, the null encoding, the
-- sort collation, the text encoding, the case handling -- invalidates every stored hash
-- at once. Every asset then compares unequal on the next crawl, change detection reports
-- a total rewrite that never happened, and the only correction is a FULL RE-CAPTURE of
-- the entire portal. The design mandated "a documented canonical serialization" and never
-- documented one; this section is that document, and it is normative.
--
-- DO NOT "optimise", "tidy", "simplify" or "modernise" plm.twentieth_century_dcp_asset_row_hash. If a new
-- field must enter the hash, that is a NEW function under a NEW name and a NEW column,
-- with an explicit re-hash plan. Never a redefinition of this one.
--
-- -------------------------------------------------------------------------------------
-- THE SPECIFICATION, IN FULL
-- -------------------------------------------------------------------------------------
-- observed_row_hash = lower(encode(sha256(convert_to(S, 'UTF8')), 'hex'))
--   -- exactly 64 lowercase hexadecimal characters.
--
-- S is the concatenation of EXACTLY EIGHT slots, in EXACTLY this order, with NO other
-- content before, between or after them:
--
--   slot 1  source_system            -- as stored on plm.twentieth_century_dcp_asset
--   slot 2  source_path              -- the full DAM path, verbatim as stored
--   slot 3  file_name                -- verbatim as stored
--   slot 4  file_extension           -- as STORED, i.e. already lowercased, no dot
--   slot 5  relative_folder_path     -- as stored; NULL is a real and expected value
--   slot 6  style_guide_source_path  -- the owning guide's full source path, as stored
--   slot 7  style_guide_source_id    -- the Disney guide id, as stored; NULL is expected
--   slot 8  tile_key_list            -- see TILE LIST below
--
-- EACH SLOT is emitted as three parts, in order:
--     presence_flag || value_text || U+001F
--   * presence_flag is the single ASCII character '+' when the value IS NOT NULL, and
--     '-' when the value IS NULL.
--   * value_text is the empty string when the value is NULL, and the value's exact
--     characters otherwise. No trimming, no case folding, no normalisation, no escaping.
--   * U+001F (ASCII 31, UNIT SEPARATOR) terminates EVERY slot INCLUDING THE EIGHTH.
--     A terminator on the last slot is deliberate: without it a trailing NULL or empty
--     value would be indistinguishable from an absent slot.
--
--   The presence flag is what makes NULL and the empty string DIFFERENT inputs. A scheme
--   that renders NULL as '' collides the two, and both occur in this data (design section
--   2 records one row with a blank folder subpath, and 88,125 files with no guide id).
--
-- CASE, AND WHERE NORMALISATION IS ALLOWED TO LIVE: every slot is hashed exactly AS
--   STORED. There is NO case folding and NO trimming anywhere in the serialization.
--   Loaders may of course normalise a value BEFORE storing it -- lowercasing an extension,
--   trimming a tile key, folding a blank folder path to NULL -- and the hash then digests
--   that stored result. file_extension is lowercase in the hash ONLY because the loader
--   stores it lowercase (a CHECK constraint enforces that), not because the hash
--   lowercases it. THE RULE THAT MATTERS: the hash never sees an input value that differs
--   from what the database holds. A caller that passes a row's raw input instead of the
--   value the upsert actually left behind has violated this specification even though the
--   function will happily hash it -- the two diverge exactly where the loader declined to
--   overwrite a stored value, which is precisely the case worth detecting.
--
-- TILE LIST (slot 8): the SET of plm.twentieth_century_dcp_portal_tile.source_key values ACTUALLY LINKED to
--   this asset in THIS crawl -- that is, read back from plm.twentieth_century_dcp_asset_tile_observation
--   after the links have been written, never taken from an input row's tile list before
--   they were. Duplicates removed, sorted ASCENDING using the `C` COLLATION (raw byte
--   order), and joined with a single U+001E (ASCII 30, RECORD SEPARATOR) between adjacent
--   elements, with NO leading or trailing U+001E. The distinction is not academic: a row
--   whose links are deliberately withheld (both listing flags set on an aggregated row)
--   must hash with NO tiles, because no tiles were linked.
--   * The `C` collation is REQUIRED and is not incidental. The database's default
--     collation is locale-dependent and can order the same two strings differently on a
--     different server or after a libc upgrade; a locale-sorted list would silently
--     change the hash of unchanged data. Byte order is stable forever.
--   * An asset with NO tiles in the crawl passes an EMPTY ARRAY, which serialises to
--     presence flag '+' and an empty value_text. It is NOT NULL. Passing NULL here means
--     "the tile set was not observed", which is a different fact and hashes differently.
--
-- SEPARATOR SAFETY: U+001F and U+001E are C0 control characters that cannot occur in a
--   DAM path, file name or tile slug. Rather than trust that, the function REFUSES any
--   input containing either character. Escaping was rejected on purpose: an escape rule
--   is a second thing that can be implemented differently by a future re-implementation,
--   and a hard refusal cannot be got wrong. A refused row is a load exception, not a
--   silently different hash.
--
-- WHY THE HASH IS COMPUTED IN THE DATABASE AND NOT BY THE LOADER: so there is exactly ONE
--   implementation of this specification, in one place, callable and testable. A loader
--   that computed it in JavaScript would be a second implementation, and two
--   implementations of a frozen scheme is how a frozen scheme stops being frozen.
-- =====================================================================================
create or replace function plm.twentieth_century_dcp_asset_row_hash(
  p_source_system           text,
  p_source_path             text,
  p_file_name               text,
  p_file_extension          text,
  p_relative_folder_path    text,
  p_style_guide_source_path text,
  p_style_guide_source_id   text,
  p_tile_keys               text[]
)
returns text
language plpgsql
immutable
-- Pinned for the same reason as plm.twentieth_century_dcp_loader_privilege_ok above: not definer, builtins
-- only today, but this is the FROZEN hash and it must never become resolution-dependent.
set search_path = pg_catalog
as $$
declare
  v_us   constant text := chr(31);   -- UNIT SEPARATOR, slot terminator
  v_rs   constant text := chr(30);   -- RECORD SEPARATOR, tile-list joiner
  v_slots text[] := array[
    p_source_system, p_source_path, p_file_name, p_file_extension,
    p_relative_folder_path, p_style_guide_source_path, p_style_guide_source_id
  ];
  v_s    text := '';
  v_tile text;
  v_join text;
  v      text;
  i      integer;
begin
  -- Separator safety, checked BEFORE any concatenation, on every slot and every tile key.
  for i in 1 .. array_length(v_slots, 1) loop
    v := v_slots[i];
    if v is not null and (position(v_us in v) > 0 or position(v_rs in v) > 0) then
      raise exception 'DCP row hash refused: field % contains a reserved separator '
        '(U+001F or U+001E). The canonical serialization does not escape; such a row must '
        'be recorded in plm.twentieth_century_dcp_load_exception instead. No value is echoed here because '
        'this database''s logs are not private.', i using errcode = 'P0001';
    end if;
    v_s := v_s || (case when v is null then '-' else '+' end) || coalesce(v, '') || v_us;
  end loop;

  -- Slot 8. NULL array means "tile set not observed" and is NOT the same as an empty set.
  if p_tile_keys is null then
    v_s := v_s || '-' || v_us;
  else
    foreach v_tile in array p_tile_keys loop
      if v_tile is null then
        raise exception 'DCP row hash refused: the tile key array contains a NULL element. '
          'Pass an empty array for "no tiles", or NULL for "not observed"; a NULL element '
          'is neither and has no defined serialization.' using errcode = 'P0001';
      end if;
      if position(v_us in v_tile) > 0 or position(v_rs in v_tile) > 0 then
        raise exception 'DCP row hash refused: a tile key contains a reserved separator '
          '(U+001F or U+001E).' using errcode = 'P0001';
      end if;
    end loop;

    -- DISTINCT, then ORDER BY ... COLLATE "C". Both are load-bearing; see the spec above.
    select coalesce(string_agg(k, v_rs order by k collate "C"), '')
      into v_join
      from (select distinct unnest(p_tile_keys) as k) d;

    v_s := v_s || '+' || v_join || v_us;
  end if;

  return lower(encode(sha256(convert_to(v_s, 'UTF8')), 'hex'));
end;
$$;

comment on function plm.twentieth_century_dcp_asset_row_hash(text, text, text, text, text, text, text, text[]) is
'THE FROZEN canonical row-hash serialization for plm.twentieth_century_dcp_asset_crawl.observed_row_hash. '
'sha256, lowercase hex, over UTF-8 bytes of eight slots in a fixed order, each emitted as '
'presence-flag (''+'' present / ''-'' NULL) then the verbatim value then U+001F -- '
'terminator included on the last slot. Slot 8 is the crawl''s tile-key SET: deduplicated, '
'sorted with COLLATE "C" (byte order, locale-proof), joined with U+001E; an empty array is '
'"no tiles" and NULL is "not observed", and they hash differently. No case folding, no '
'trimming, no escaping -- a value containing a reserved separator is REFUSED so it becomes '
'a load exception rather than a silently different hash. THIS IS A ONE-WAY DOOR: about '
'155,900 rows will carry these hashes, and changing any detail invalidates all of them and '
'forces a full re-capture. Never redefine this function. A new field means a NEW function, '
'a NEW column and an explicit re-hash plan. The full normative specification is in '
'section 1 of migration 20260810190000.';

revoke all on function plm.twentieth_century_dcp_asset_row_hash(text, text, text, text, text, text, text, text[]) from public;
grant execute on function plm.twentieth_century_dcp_asset_row_hash(text, text, text, text, text, text, text, text[])
  to authenticated, service_role;

-- =====================================================================================
-- SECTION 2. plm.twentieth_century_dcp_crawl -- one row per scrape run (design 4.1)
--
-- PROVENANCE ONLY. No asset data lives on this row.
-- =====================================================================================
create table plm.twentieth_century_dcp_crawl (
  crawl_id                uuid primary key default gen_random_uuid(),

  source_system           text not null default 'twentieth_century_dcpvault' check (source_system = 'twentieth_century_dcpvault'),
  status                  text not null default 'planned',

  -- The SNAPSHOT date, supplied EXPLICITLY by the caller and never derived from now().
  -- This server runs America/New_York: a midnight-UTC timestamptz read back through
  -- ::date lands on the PREVIOUS day and would silently misdate the capture. Any
  -- timestamptz on these tables that is later compared as a date must be pinned to
  -- midday UTC by its writer for the same reason.
  captured_on             date not null,

  portal_base_url         text not null,          -- ORIGIN ONLY. Never a signed URL.
  crawler_version         text not null,
  account_scope           text not null,          -- non-secret entitlement description
  line_of_business        text not null,

  started_at              timestamptz not null,
  finished_at             timestamptz null,

  -- Declared UP FRONT by the loader from the extract manifest. finalize refuses unless
  -- the landed counts match. Deriving them at the end would let a truncated extract
  -- define its own expectation and certify itself.
  rows_received           integer null,
  distinct_assets_received integer null,

  captured_by             text not null,
  private_source_commit   text not null,
  failure_message         text null,
  notes                   text null,
  metadata                jsonb not null default '{}'::jsonb,

  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  constraint twentieth_century_dcp_crawl_status_chk
    check (status in ('planned','running','partial','complete','failed')),
  constraint twentieth_century_dcp_crawl_source_system_chk check (source_system = 'twentieth_century_dcpvault'),
  constraint twentieth_century_dcp_crawl_base_url_chk       check (btrim(portal_base_url) <> ''),
  constraint twentieth_century_dcp_crawl_crawler_version_chk check (btrim(crawler_version) <> ''),
  constraint twentieth_century_dcp_crawl_account_scope_chk  check (btrim(account_scope) <> ''),
  constraint twentieth_century_dcp_crawl_lob_chk            check (btrim(line_of_business) <> ''),
  constraint twentieth_century_dcp_crawl_captured_by_chk    check (btrim(captured_by) <> ''),
  constraint twentieth_century_dcp_crawl_commit_chk         check (btrim(private_source_commit) <> ''),
  constraint twentieth_century_dcp_crawl_counts_chk check (
    (rows_received is null or rows_received >= 0)
    and (distinct_assets_received is null or distinct_assets_received >= 0)
  ),

  -- COMPLETE is the strongest claim this schema can make, so each part of it is a CHECK
  -- and not a convention. Section completeness and gap closure are enforced by
  -- plm.finalize_twentieth_century_dcp_crawl (20260810190100) because they are set-level facts a row CHECK
  -- cannot see; what a row CHECK CAN prove is asserted here so finalize cannot fake it.
  constraint twentieth_century_dcp_crawl_complete_requires_evidence_chk check (
    status <> 'complete'
    or (
      finished_at is not null
      and rows_received is not null
      and distinct_assets_received is not null
      and failure_message is null
    )
  ),
  constraint twentieth_century_dcp_crawl_failed_requires_message_chk check (
    status <> 'failed' or btrim(coalesce(failure_message, '')) <> ''
  )
);

create index idx_twentieth_century_dcp_crawl_status on plm.twentieth_century_dcp_crawl (status, started_at desc);
create index idx_twentieth_century_dcp_crawl_latest_complete
  on plm.twentieth_century_dcp_crawl (captured_on desc, crawl_id desc) where status = 'complete';

comment on table plm.twentieth_century_dcp_crawl is
'One row per Disney 20th Century DCP Vault scrape run. PROVENANCE ONLY -- no asset data lives here. '
'CRAWL-VERSIONED: every completed crawl is retained permanently and a refresh is a NEW '
'crawl_id, never an edit of an old one. SCOPE: POP Creations'' licensed 20th Century DCP Vault account '
'and the portal''s CURRENT view. PRESENCE IS EVIDENCE; ABSENCE IS NOT A DELETE INSTRUCTION '
'AND NOT PROOF OF NONEXISTENCE. A crawl reaches status = complete only through '
'plm.finalize_twentieth_century_dcp_crawl, which additionally requires every section complete and every gap '
'resolved or waived -- set-level facts no row CHECK can see. Licensor-confidential data: '
'never publish a row and NEVER commit one to this PUBLIC repository.';
comment on column plm.twentieth_century_dcp_crawl.captured_on is
'The SNAPSHOT date, supplied explicitly and NEVER derived from now(). The server runs '
'America/New_York, so a midnight-UTC timestamp read through ::date lands on the previous '
'day and would misdate the crawl by one day, silently.';
comment on column plm.twentieth_century_dcp_crawl.portal_base_url is
'ORIGIN ONLY (scheme + host). Never a signed download URL, never a session-bearing URL, '
'never a query string carrying a token.';
comment on column plm.twentieth_century_dcp_crawl.rows_received is
'INPUT rows the extract claims to carry, declared UP FRONT from its manifest. Legitimately '
'EXCEEDS distinct_assets_received: the extract contains exact duplicate rows for the same '
'DAM path, which are collapsed on load. The difference is not loss.';
comment on column plm.twentieth_century_dcp_crawl.distinct_assets_received is
'DISTINCT DAM paths the extract claims to carry, declared UP FRONT. finalize compares it '
'to what actually landed and refuses on a mismatch.';

-- =====================================================================================
-- SECTION 3. plm.twentieth_century_dcp_portal_tile -- the portal browsing tiles (design 4.4)
--
-- Called a PORTAL TILE, never a property or a franchise. The extract proves a browse
-- category and nothing more (design section 3). There is deliberately NO allow-list
-- CHECK on source_key: see the completeness note on plm.twentieth_century_dcp_crawl_section.
--
-- STABLE IDENTITY table: rows outlive any one crawl. first/last_seen_crawl_id are
-- convenience pointers and are ON DELETE SET NULL, so deleting an unpromoted crawl leaves
-- the identity standing (design section 7).
-- =====================================================================================
create table plm.twentieth_century_dcp_portal_tile (
  id                  uuid primary key default gen_random_uuid(),
  source_system       text not null default 'twentieth_century_dcpvault' check (source_system = 'twentieth_century_dcpvault'),
  source_key          text not null,
  display_label       text null,
  source_url          text null,

  first_seen_crawl_id uuid null references plm.twentieth_century_dcp_crawl(crawl_id) on delete set null,
  last_seen_crawl_id  uuid null references plm.twentieth_century_dcp_crawl(crawl_id) on delete set null,

  -- READ-ONLY reconciliation pointer. NULL at landing, ALWAYS. A tile is NOT proven to be
  -- a canonical property; only an explicit reviewed mapping may ever set this.
  core_property_id    uuid null references core.property(id) on delete restrict,
  resolution_status   text not null default 'unresolved',
  resolution_reason   text null,
  resolved_at         timestamptz null,
  resolved_by         text null,

  raw                 jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint twentieth_century_dcp_portal_tile_source_key_chk check (btrim(source_key) <> ''),
  constraint twentieth_century_dcp_portal_tile_unique unique (source_system, source_key),
  constraint twentieth_century_dcp_portal_tile_resolution_status_chk check (
    resolution_status in ('unresolved','matched','ambiguous','no_match','rejected')
  ),
  -- A resolved pointer without a status, or a matched status without a pointer, is a
  -- half-finished decision. Neither may sit in the table looking settled.
  constraint twentieth_century_dcp_portal_tile_resolution_coherent_chk check (
    (resolution_status = 'matched') = (core_property_id is not null)
  )
);

comment on table plm.twentieth_century_dcp_portal_tile is
'One row per Disney 20th Century DCP Vault portal BROWSING TILE. A TILE IS NOT A PROPERTY AND NOT A '
'FRANCHISE -- the extract proves only that the portal listed a file under a browse '
'category. Nothing may write tile text into core.property, and core_property_id is a '
'read-only pointer that stays NULL until an explicit reviewed mapping sets it. '
'Deliberately carries NO allow-list of tile keys: the portal exposes more tiles than any '
'one partial crawl observes, and a CHECK pinned to what one checkpoint saw would reject '
'the rest of the portal on the next crawl.';

-- =====================================================================================
-- SECTION 4. plm.twentieth_century_dcp_style_guide -- one row per guide path (design 4.5)
--
-- Identity is the FULL SOURCE PATH, never coalesce(source_guide_id, folder_name): folder
-- names repeat across region/year contexts, and a later id backfill would change the
-- value of such an expression and re-key existing rows.
-- =====================================================================================
create table plm.twentieth_century_dcp_style_guide (
  id                  uuid primary key default gen_random_uuid(),
  source_system       text not null default 'twentieth_century_dcpvault' check (source_system = 'twentieth_century_dcpvault'),
  source_path         text not null,
  source_guide_id     text null,
  folder_name         text not null,
  region              text not null,
  year_segment        text not null,
  parent_source_path  text null,

  first_seen_crawl_id uuid null references plm.twentieth_century_dcp_crawl(crawl_id) on delete set null,
  last_seen_crawl_id  uuid null references plm.twentieth_century_dcp_crawl(crawl_id) on delete set null,

  -- READ-ONLY reconciliation pointer into the canonical taxonomy. NULL at landing, always.
  -- ON DELETE RESTRICT, never CASCADE: a canonical guide disappearing must not silently
  -- delete the source observation that a promotion was traced through.
  core_style_guide_id uuid null references core.style_guide(id) on delete restrict,
  resolution_status   text not null default 'unresolved',
  resolution_reason   text null,
  resolved_at         timestamptz null,
  resolved_by         text null,

  raw                 jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint twentieth_century_dcp_style_guide_source_path_chk check (btrim(source_path) <> ''),
  constraint twentieth_century_dcp_style_guide_folder_name_chk check (btrim(folder_name) <> ''),
  constraint twentieth_century_dcp_style_guide_region_chk      check (btrim(region) <> ''),
  -- year_segment is TEXT and stays text: a non-numeric "no year" marker is a valid value
  -- in this source and an integer column could not hold it.
  constraint twentieth_century_dcp_style_guide_year_chk        check (btrim(year_segment) <> ''),
  -- A blank guide id is not an id. Store NULL, so the partial unique index below means
  -- what it says.
  constraint twentieth_century_dcp_style_guide_guide_id_chk
    check (source_guide_id is null or btrim(source_guide_id) <> ''),
  constraint twentieth_century_dcp_style_guide_unique unique (source_system, source_path),
  constraint twentieth_century_dcp_style_guide_resolution_status_chk check (
    resolution_status in ('unresolved','matched','ambiguous','no_match','rejected')
  ),
  constraint twentieth_century_dcp_style_guide_resolution_coherent_chk check (
    (resolution_status = 'matched') = (core_style_guide_id is not null)
  )
);

-- Partial unique on the real Disney id. Measured safe for this extract: zero source ids
-- map to more than one guide context. It is PARTIAL because most files carry no id at
-- all, and a plain unique would collapse every id-less guide into one row.
create unique index uq_twentieth_century_dcp_style_guide_source_guide_id
  on plm.twentieth_century_dcp_style_guide (source_system, source_guide_id)
  where source_guide_id is not null;

create index idx_twentieth_century_dcp_style_guide_folder_name on plm.twentieth_century_dcp_style_guide (folder_name);
create index idx_twentieth_century_dcp_style_guide_region_year on plm.twentieth_century_dcp_style_guide (region, year_segment);

comment on table plm.twentieth_century_dcp_style_guide is
'One row per Disney 20th Century DCP Vault guide FOLDER PATH. IDENTITY IS THE FULL SOURCE PATH. Never '
're-key this on coalesce(source_guide_id, folder_name): folder names are reused across '
'region/year contexts, and a later id backfill would change that expression''s value and '
'silently re-identify existing rows. The Disney guide id, when present, is enforced unique '
'by a PARTIAL index -- most guides have no id, and a plain unique would collapse them all. '
'year_segment is TEXT because a non-numeric "no year" marker is a legitimate value. '
'core_style_guide_id is a read-only reconciliation pointer, NULL at landing; tile '
'membership may NEVER be used to infer it.';
comment on column plm.twentieth_century_dcp_style_guide.parent_source_path is
'Populated ONLY where the portal actually proves nesting. Never inferred by trimming a '
'path segment: a guessed hierarchy is indistinguishable from an observed one once stored.';

-- =====================================================================================
-- SECTION 5. The file identity, its crawl membership, its tile links, and the exceptions
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- 5.1 plm.twentieth_century_dcp_asset -- one row per Disney file identity (design 4.6)
-- -------------------------------------------------------------------------------------
create table plm.twentieth_century_dcp_asset (
  id                    uuid primary key default gen_random_uuid(),
  source_system         text not null default 'twentieth_century_dcpvault' check (source_system = 'twentieth_century_dcpvault'),
  source_path           text not null,

  style_guide_id        uuid not null references plm.twentieth_century_dcp_style_guide(id) on delete restrict,

  file_name             text not null,

  -- PLAIN COLUMN, COMPUTED BY THE LOADER. NOT `GENERATED ... STORED` -- see DECISION 4 in
  -- the header. PostgreSQL populates a generated column AFTER every BEFORE-row trigger
  -- runs, so the section 6 immutability triggers would read NULL here on every row, never
  -- fire, and leave a guard that applies cleanly and protects nothing.
  file_extension        text null,

  relative_folder_path  text null,
  source_asset_id       text null,
  file_size_bytes       bigint null,
  content_type          text null,
  checksum              text null,

  first_seen_crawl_id   uuid null references plm.twentieth_century_dcp_crawl(crawl_id) on delete set null,
  last_seen_crawl_id    uuid null references plm.twentieth_century_dcp_crawl(crawl_id) on delete set null,

  raw                   jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint twentieth_century_dcp_asset_source_path_chk check (btrim(source_path) <> ''),
  constraint twentieth_century_dcp_asset_file_name_chk   check (btrim(file_name) <> ''),
  -- Lowercase, no dot, non-blank when present. This is the shape the frozen hash slot 4
  -- assumes, so it is enforced rather than trusted.
  constraint twentieth_century_dcp_asset_file_extension_chk check (
    file_extension is null
    or (file_extension = lower(file_extension)
        and btrim(file_extension) = file_extension
        and file_extension <> ''
        and position('.' in file_extension) = 0)
  ),
  -- A blank relative folder path is a real observed value in this source; it is stored as
  -- NULL so "no subpath" has exactly one representation and cannot hash two ways.
  constraint twentieth_century_dcp_asset_relative_folder_chk
    check (relative_folder_path is null or btrim(relative_folder_path) <> ''),
  constraint twentieth_century_dcp_asset_size_chk check (file_size_bytes is null or file_size_bytes >= 0),
  constraint twentieth_century_dcp_asset_unique unique (source_system, source_path)
);

-- Design 4.6: index the guide link, the lowercased file name and the extension.
-- NEVER add a unique rule to file_name -- thousands of distinct DAM paths share one name.
create index idx_twentieth_century_dcp_asset_style_guide on plm.twentieth_century_dcp_asset (style_guide_id);
create index idx_twentieth_century_dcp_asset_file_name_lower on plm.twentieth_century_dcp_asset (lower(file_name));
create index idx_twentieth_century_dcp_asset_file_extension on plm.twentieth_century_dcp_asset (file_extension);

comment on table plm.twentieth_century_dcp_asset is
'One row per Disney 20th Century DCP Vault FILE IDENTITY, keyed on the full DAM path. FILE NAME IS NOT '
'AN IDENTITY: thousands of distinct paths share a name in this source, so file_name is '
'indexed and deliberately NOT unique -- never add a unique constraint to it. '
'file_extension is a PLAIN loader-computed column and must never be converted to '
'GENERATED ... STORED: a generated column is populated after BEFORE-row triggers run, '
'which would make every immutability trigger on this table read NULL and never fire. '
'THIS TABLE RECORDS NAMES AND PATHS ONLY. No file bytes, preview, PDF or image is stored '
'here or anywhere in this schema, and the presence of a row is NOT a claim that the '
'content exists locally.';
comment on column plm.twentieth_century_dcp_asset.checksum is
'NULL unless the portal exposed one or it was computed from authorized content. Never '
'invented, and never back-filled from the row hash -- plm.twentieth_century_dcp_asset_crawl.observed_row_hash '
'digests METADATA, not file bytes, and confusing the two would assert content integrity '
'this scrape never verified.';

-- -------------------------------------------------------------------------------------
-- 5.2 plm.twentieth_century_dcp_crawl_section -- one row per planned tile+listing query (design 4.2)
--
-- THE COMPLETENESS GATE, and the resolution of the design's 22-versus-11 discrepancy.
--
-- Design section 6 rule 1 says the saved crawler plan has 44 base jobs from 22 portal
-- tiles plus one repair job; design section 2 measures 11 distinct tiles in the extract.
-- RECONCILED, from the crawler's own saved queue in the private source repo: the queue
-- holds 45 jobs across 22 distinct tile pages -- 22 tiles x 2 listing kinds = 44 base
-- jobs, plus exactly ONE resume job for a tile whose Assets listing was interrupted
-- mid-offset. So 44 + 1 = 45, exactly as the design says.
--
-- The 11 is not a contradiction of the 22; it is the CONSEQUENCE of the crawl being
-- PARTIAL. 22 tiles were PLANNED; the checkpoint had finished only a minority of those
-- sections, so only 11 tiles had produced any rows yet. Both numbers are true and they
-- measure different things: 22 = planned sections, 11 = tiles observed so far.
--
-- THE SCHEMA CONSEQUENCE, which is why this matters: one row per PLANNED section is
-- inserted at the START of a crawl, not at the end. A crawl that captured 11 tiles while
-- 22 were planned therefore has 11 complete sections and 11 incomplete ones ON THE
-- RECORD, cannot be finalized, and is honestly reported as partial. Had sections been
-- derived from what arrived, the same crawl would have looked 100% complete. NOTHING in
-- this schema hard-codes 11 or 22: the next crawl brings its own plan.
--
-- The repair job is recorded as a gap resolution against its existing section, NEVER as a
-- second section -- hence the unique constraint below (design section 6 rule 1).
-- -------------------------------------------------------------------------------------
create table plm.twentieth_century_dcp_crawl_section (
  id             uuid primary key default gen_random_uuid(),
  crawl_id       uuid not null references plm.twentieth_century_dcp_crawl(crawl_id) on delete cascade,
  portal_tile_id uuid not null references plm.twentieth_century_dcp_portal_tile(id) on delete restrict,
  listing_kind   text not null,
  status         text not null default 'planned',
  expected_count integer null,
  captured_count integer not null default 0,
  last_offset    integer null,
  started_at     timestamptz null,
  finished_at    timestamptz null,
  notes          text null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint twentieth_century_dcp_crawl_section_listing_kind_chk check (listing_kind in ('asset','style_guide')),
  constraint twentieth_century_dcp_crawl_section_status_chk
    check (status in ('planned','running','complete','gapped','failed')),
  constraint twentieth_century_dcp_crawl_section_counts_chk check (
    captured_count >= 0
    and (expected_count is null or expected_count >= 0)
    and (last_offset is null or last_offset >= 0)
  ),
  -- A section may only claim complete when it finished and, where the portal exposed a
  -- total, actually captured that total. A ZERO-row section is legitimate (a tile really
  -- can be empty) and is allowed -- but only against an expected_count of 0, so "we got
  -- nothing" can never pass as "there was nothing".
  constraint twentieth_century_dcp_crawl_section_complete_requires_evidence_chk check (
    status <> 'complete'
    or (finished_at is not null
        and (expected_count is null or captured_count = expected_count))
  ),
  constraint twentieth_century_dcp_crawl_section_unique unique (crawl_id, portal_tile_id, listing_kind)
);

create index idx_twentieth_century_dcp_crawl_section_crawl on plm.twentieth_century_dcp_crawl_section (crawl_id, status);
create index idx_twentieth_century_dcp_crawl_section_incomplete
  on plm.twentieth_century_dcp_crawl_section (crawl_id) where status <> 'complete';

comment on table plm.twentieth_century_dcp_crawl_section is
'One row per PLANNED portal tile + listing kind in a crawl. Rows are inserted from the '
'crawler''s plan when the crawl OPENS, never derived from what arrived -- that is the whole '
'point. A partial crawl that reached only some of its planned tiles then carries its '
'unfinished sections on the record and CANNOT be finalized; derived sections would have '
'made the same crawl look 100 percent complete. A zero-row section is legitimate (a tile '
'can genuinely be empty) but may only be complete against an expected count of zero, so '
'"we captured nothing" can never pass as "there was nothing". A resume or repair job is '
'recorded as a gap resolution on the EXISTING section, never as a second section -- '
'enforced by the unique constraint on (crawl_id, portal_tile_id, listing_kind).';

-- -------------------------------------------------------------------------------------
-- 5.3 plm.twentieth_century_dcp_crawl_gap -- unresolved missing ranges and request failures (design 4.3)
-- -------------------------------------------------------------------------------------
create table plm.twentieth_century_dcp_crawl_gap (
  id               uuid primary key default gen_random_uuid(),
  crawl_section_id uuid not null references plm.twentieth_century_dcp_crawl_section(id) on delete cascade,
  offset_from      integer not null,
  offset_to        integer not null,
  reason           text not null,
  attempt_count    integer not null default 0,
  resolved_at      timestamptz null,
  resolution_note  text null,

  -- APPROVAL TIMESTAMP. Writers MUST pin this to MIDDAY UTC (12:00:00Z), never midnight.
  -- The server runs America/New_York, so a midnight-UTC value read back through ::date --
  -- which any "was this waived on or before date D" report does -- returns the PREVIOUS
  -- day. Midday UTC is 08:00 or 07:00 local, so the date is the same in both zones and no
  -- report can disagree with another about when the waiver happened.
  waived_at        timestamptz null,
  waived_by        text null,
  waiver_reason    text null,

  created_at       timestamptz not null default now(),

  constraint twentieth_century_dcp_crawl_gap_offsets_chk check (offset_from >= 0 and offset_to >= offset_from),
  constraint twentieth_century_dcp_crawl_gap_reason_chk  check (btrim(reason) <> ''),
  constraint twentieth_century_dcp_crawl_gap_attempts_chk check (attempt_count >= 0),
  -- A resolution must say what it did; a silent resolved_at is not a resolution.
  constraint twentieth_century_dcp_crawl_gap_resolution_chk check (
    resolved_at is null or btrim(coalesce(resolution_note, '')) <> ''
  ),
  -- A WAIVER IS A DECISION AND MUST BE SIGNED. All three parts or none: who, when, why.
  -- An unsigned waiver is how a gap gets closed by nobody.
  constraint twentieth_century_dcp_crawl_gap_waiver_chk check (
    (waived_at is null and waived_by is null and waiver_reason is null)
    or (waived_at is not null
        and btrim(coalesce(waived_by, '')) <> ''
        and btrim(coalesce(waiver_reason, '')) <> '')
  ),
  -- A gap is either resolved (it was actually re-fetched) or waived (a human accepted the
  -- loss). It may not be both: that hides which of the two actually happened.
  constraint twentieth_century_dcp_crawl_gap_not_both_chk check (resolved_at is null or waived_at is null)
);

create index idx_twentieth_century_dcp_crawl_gap_section on plm.twentieth_century_dcp_crawl_gap (crawl_section_id);
create index idx_twentieth_century_dcp_crawl_gap_open
  on plm.twentieth_century_dcp_crawl_gap (crawl_section_id)
  where resolved_at is null and waived_at is null;

comment on table plm.twentieth_century_dcp_crawl_gap is
'One row per unresolved missing offset range or request failure within a crawl section. A '
'crawl CANNOT be finalized while any gap is neither resolved nor waived -- enforced by '
'plm.finalize_twentieth_century_dcp_crawl. A waiver is a signed human decision: who, when and why, all three '
'or none. WAIVED_AT MUST BE PINNED TO MIDDAY UTC by its writer: this server runs '
'America/New_York, so a midnight-UTC approval timestamp read back through ::date reports '
'the PREVIOUS day, and two reports would then disagree about when a loss was accepted.';

-- -------------------------------------------------------------------------------------
-- 5.4 plm.twentieth_century_dcp_asset_crawl -- snapshot membership + the frozen row hash (design 4.7)
-- -------------------------------------------------------------------------------------
create table plm.twentieth_century_dcp_asset_crawl (
  crawl_id          uuid not null references plm.twentieth_century_dcp_crawl(crawl_id) on delete cascade,
  twentieth_century_dcp_asset_id      uuid not null references plm.twentieth_century_dcp_asset(id) on delete restrict,
  observed_row_hash text not null,
  observed_at       timestamptz not null default now(),

  constraint twentieth_century_dcp_asset_crawl_pkey primary key (crawl_id, twentieth_century_dcp_asset_id),
  -- 64 lowercase hex. The shape is enforced so a truncated, uppercased or
  -- differently-encoded digest cannot enter the column and quietly compare unequal
  -- against every honest hash forever.
  constraint twentieth_century_dcp_asset_crawl_hash_chk check (observed_row_hash ~ '^[0-9a-f]{64}$')
);

create index idx_twentieth_century_dcp_asset_crawl_asset on plm.twentieth_century_dcp_asset_crawl (twentieth_century_dcp_asset_id);

comment on table plm.twentieth_century_dcp_asset_crawl is
'Snapshot membership: this stable asset was present in this crawl. Carries the frozen '
'canonical row hash and NOTHING ELSE about the asset -- the asset''s fields live once, on '
'plm.twentieth_century_dcp_asset, and are not copied per crawl. Comparing observed_row_hash across two crawls '
'is the ONLY change-detection mechanism in this schema. The hash comes from '
'plm.twentieth_century_dcp_asset_row_hash and its serialization is FROZEN (see section 1 of migration '
'20260810190000): about 155,900 rows will carry it, and redefining the scheme invalidates '
'every stored hash and forces a full re-capture. It digests METADATA and is NOT a content '
'checksum.';

-- -------------------------------------------------------------------------------------
-- 5.5 plm.twentieth_century_dcp_load_exception -- rejected and questionable rows (owner ruling 6)
--
-- The design requires that malformed rows are REJECTED INTO AN ERROR TABLE rather than
-- silently skipped, and requires an exception report, but never defines the table. This
-- is it, and it is deliberately wider than the minimum: without crawl_section_id and
-- chunk_number an operator cannot tell WHICH query or WHICH chunk produced a bad row, and
-- without severity every advisory finding looks like a hard rejection.
--
-- A silent skip is the exact failure mode this table exists to make impossible. If the
-- loader cannot land a row, a row lands HERE. There is no third outcome.
-- -------------------------------------------------------------------------------------
create table plm.twentieth_century_dcp_load_exception (
  id               uuid primary key default gen_random_uuid(),
  crawl_id         uuid not null references plm.twentieth_century_dcp_crawl(crawl_id) on delete cascade,
  crawl_section_id uuid null references plm.twentieth_century_dcp_crawl_section(id) on delete set null,
  chunk_number     integer null,
  row_number       integer null,

  severity         text not null default 'rejected',
  reason_code      text not null,
  reason           text not null,
  source_path      text null,
  raw_row          jsonb not null default '{}'::jsonb,

  resolved_at      timestamptz null,
  resolution_note  text null,
  created_at       timestamptz not null default now(),

  constraint twentieth_century_dcp_load_exception_severity_chk check (severity in ('rejected','warning')),
  constraint twentieth_century_dcp_load_exception_reason_code_chk check (btrim(reason_code) <> ''),
  constraint twentieth_century_dcp_load_exception_reason_chk      check (btrim(reason) <> ''),
  constraint twentieth_century_dcp_load_exception_row_number_chk  check (row_number is null or row_number >= 1),
  constraint twentieth_century_dcp_load_exception_chunk_chk       check (chunk_number is null or chunk_number >= 1),
  constraint twentieth_century_dcp_load_exception_resolution_chk check (
    resolved_at is null or btrim(coalesce(resolution_note, '')) <> ''
  )
);

create index idx_twentieth_century_dcp_load_exception_crawl on plm.twentieth_century_dcp_load_exception (crawl_id, severity);
create index idx_twentieth_century_dcp_load_exception_open
  on plm.twentieth_century_dcp_load_exception (crawl_id) where resolved_at is null and severity = 'rejected';
create index idx_twentieth_century_dcp_load_exception_reason_code on plm.twentieth_century_dcp_load_exception (reason_code);

comment on table plm.twentieth_century_dcp_load_exception is
'Every input row the loader could not land, and every advisory finding it raised. THE '
'DESIGN''S RULE, MADE STRUCTURAL: a malformed row is REJECTED INTO THIS TABLE, never '
'silently skipped -- if it does not land in the landing tables it lands here, and there is '
'no third outcome. severity = rejected means the row was not loaded; warning means it was '
'loaded but something about it is worth a human''s attention. reason_code is the stable '
'machine-readable classification the exception report groups on; reason is the human '
'sentence. raw_row holds the offending input verbatim and is therefore licensor-'
'confidential like every other table here. Unresolved rejections block finalization.';
comment on column plm.twentieth_century_dcp_load_exception.reason_code is
'Stable machine-readable classification. The loader in 20260810190100 emits, among others: '
'blank folder path, conflicting guide source id, malformed boolean, unknown listing state, '
'a reserved separator in a hashed field, and two NON-IDENTICAL rows sharing one DAM path -- '
'the last being the case the duplicate collapse must never quietly merge.';

-- -------------------------------------------------------------------------------------
-- 5.6 plm.twentieth_century_dcp_asset_tile_observation -- the many-to-many evidence table (design 4.8)
--
-- Replaces the pipe-separated tile list and the two listing booleans that the flat
-- extract carries on each file row. One row per proven (crawl, asset, tile, listing kind).
--
-- crawl_section_id IS NULLABLE BY DESIGN -- see DECISION 3 in the header. link_evidence
-- names the fidelity and the CHECK below binds the two so they can never disagree.
-- -------------------------------------------------------------------------------------
create table plm.twentieth_century_dcp_asset_tile_observation (
  crawl_id         uuid not null references plm.twentieth_century_dcp_crawl(crawl_id) on delete cascade,
  twentieth_century_dcp_asset_id     uuid not null references plm.twentieth_century_dcp_asset(id) on delete restrict,
  portal_tile_id   uuid not null references plm.twentieth_century_dcp_portal_tile(id) on delete restrict,
  listing_kind     text not null,
  crawl_section_id uuid null references plm.twentieth_century_dcp_crawl_section(id) on delete restrict,
  link_evidence    text not null,
  observed_at      timestamptz not null default now(),

  constraint twentieth_century_dcp_asset_tile_observation_pkey
    primary key (crawl_id, twentieth_century_dcp_asset_id, portal_tile_id, listing_kind),
  constraint twentieth_century_dcp_asset_tile_observation_listing_kind_chk
    check (listing_kind in ('asset','style_guide')),
  constraint twentieth_century_dcp_asset_tile_observation_link_evidence_chk
    check (link_evidence in ('section_query','aggregated_row')),
  -- THE BINDING. 'section_query' asserts a specific portal query proved this link, so the
  -- section id is REQUIRED. 'aggregated_row' asserts the link came from an already-
  -- aggregated extract row whose originating query was not preserved, so the section id
  -- MUST be NULL. Neither grade can borrow the other's appearance.
  constraint twentieth_century_dcp_asset_tile_observation_evidence_binding_chk check (
    (link_evidence = 'section_query'  and crawl_section_id is not null)
    or
    (link_evidence = 'aggregated_row' and crawl_section_id is null)
  )
);

create index idx_twentieth_century_dcp_asset_tile_obs_asset on plm.twentieth_century_dcp_asset_tile_observation (twentieth_century_dcp_asset_id);
create index idx_twentieth_century_dcp_asset_tile_obs_tile
  on plm.twentieth_century_dcp_asset_tile_observation (portal_tile_id, listing_kind);
create index idx_twentieth_century_dcp_asset_tile_obs_section
  on plm.twentieth_century_dcp_asset_tile_observation (crawl_section_id) where crawl_section_id is not null;

comment on table plm.twentieth_century_dcp_asset_tile_observation is
'The many-to-many evidence table for file-to-portal-tile links, replacing the pipe-joined '
'tile list and the two listing booleans the flat extract carries per file row. One row per '
'proven (crawl, asset, tile, listing kind); an asset listed under eight tiles produces '
'EIGHT rows here and still exactly ONE row in plm.twentieth_century_dcp_asset. '
'FIDELITY IS RECORDED IN THE DATA, not assumed: link_evidence = section_query means a '
'specific portal query proved the link and crawl_section_id names it; '
'link_evidence = aggregated_row means the link came from an already-aggregated extract row '
'whose originating query was NOT preserved and cannot be reconstructed, so crawl_section_id '
'is NULL. The CSV backfill is entirely aggregated_row. A consumer that needs proven '
'provenance filters on section_query. Inventing a synthetic section for the aggregated case '
'would have manufactured exactly the false precision the design forbids.';
comment on column plm.twentieth_century_dcp_asset_tile_observation.listing_kind is
'Which portal result list showed this file under this tile. It is an OBSERVATION, not part '
'of file identity. Two rows for one (crawl, asset, tile) are created only when BOTH '
'listings were genuinely queried and both returned the file -- never by expanding one '
'aggregated row into a cross-product.';

-- =====================================================================================
-- SECTION 6. IMMUTABILITY -- a completed crawl's evidence is frozen
--
-- Prose in a design document is not immutability. These are row triggers.
--
-- WHY BEFORE-ROW TRIGGERS AND WHAT DEFEATS THEM: TRUNCATE does not fire row triggers at
-- all, so every guarantee below depends on section 7 having revoked TRUNCATE from
-- service_role. The two sections are one mechanism; do not weaken either alone.
--
-- AND WHY EVERY CRAWL-SCOPED TRIGGER COVERS **INSERT** AS WELL AS UPDATE AND DELETE.
-- Read this before "simplifying" any trigger below back to `before update or delete`.
-- Section 7 revokes UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER and MAINTAIN from
-- service_role. Guarded SECURITY DEFINER functions are therefore the only writing
-- operation still available to the loader's role -- which makes it the one an
-- UPDATE/DELETE-only trigger would leave completely unguarded. The concrete hole: crawl X
-- finalizes, then a plain
--     insert into plm.twentieth_century_dcp_asset_tile_observation (crawl_id, ...) values (X, ...);
-- adds a portal link that crawl never observed. No grant stops it and, without the INSERT
-- branch, no trigger fires either -- and the claim "a completed crawl's evidence is frozen"
-- would be false for the only operation anyone could still perform. The same hole exists
-- on twentieth_century_dcp_asset_crawl, twentieth_century_dcp_crawl_section, twentieth_century_dcp_crawl_gap, twentieth_century_dcp_load_exception and
-- twentieth_century_dcp_chunk_ledger, so all six are covered.
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- 6.1 Crawl-scoped evidence: frozen entirely once its crawl is complete.
-- -------------------------------------------------------------------------------------
create or replace function plm.twentieth_century_dcp_reject_completed_crawl_change()
returns trigger
language plpgsql
as $$
declare
  v_crawl  uuid;
  v_status text;
begin
  -- NEW is UNASSIGNED in a DELETE trigger; reading new.* there raises "record new is not
  -- assigned yet". The branch therefore comes BEFORE the read, never inside a coalesce
  -- over both.
  --
  -- plm.twentieth_century_dcp_crawl_gap is the one attached table that has NO crawl_id column -- it hangs
  -- off a section, not off the crawl -- so reading new.crawl_id there would raise "record
  -- new has no field crawl_id" at runtime, on every write, while the migration itself
  -- applied perfectly clean. It is resolved through its section instead. A generic
  -- `record.crawl_id` read would have been a guard that only fails when it is used.
  if tg_table_name = 'twentieth_century_dcp_crawl_gap' then
    select s.crawl_id into v_crawl
    from plm.twentieth_century_dcp_crawl_section s
    where s.id = (case when tg_op = 'DELETE' then old.crawl_section_id
                       else new.crawl_section_id end);
  elsif tg_op = 'DELETE' then
    v_crawl := old.crawl_id;
  else
    v_crawl := new.crawl_id;
  end if;

  select c.status into v_status from plm.twentieth_century_dcp_crawl c where c.crawl_id = v_crawl;

  if v_status = 'complete' then
    raise exception
      '20th Century DCP Vault crawl % is COMPLETE and its evidence is immutable; % on %.% is refused. A '
      'refresh is a NEW crawl_id, never an edit of an old one -- editing completed evidence '
      'destroys the only record of what the portal actually said.',
      v_crawl, tg_op, tg_table_schema, tg_table_name
      using errcode = 'P0001';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

comment on function plm.twentieth_century_dcp_reject_completed_crawl_change() is
'Row trigger freezing every CRAWL-SCOPED plm.twentieth_century_dcp_* table once its owning crawl reaches '
'status complete. FIRES ON INSERT, UPDATE AND DELETE -- all three, deliberately. INSERT is '
'not an afterthought here: section 7 revokes UPDATE, DELETE and TRUNCATE from service_role '
'but KEEPS INSERT, so INSERT is the only mutating operation still available and is '
'therefore the one an unguarded trigger would leave wide open. Without the INSERT branch a '
'plain INSERT could add a tile observation, a section, a gap or a membership row to an '
'already-completed crawl, and that crawl would then claim evidence it never observed. '
'TRUNCATE fires no row trigger at all, which is exactly why section 7 revokes it. The '
'revokes and this trigger are ONE mechanism; neither is sufficient alone.';

do $$
declare t text;
begin
  -- plm.twentieth_century_dcp_load_exception is deliberately NOT in this list. It gets the narrower
  -- plm.twentieth_century_dcp_load_exception_freeze below, because its resolution columns must stay
  -- writable after completion -- see the note there.
  foreach t in array array[
    'twentieth_century_dcp_crawl_section','twentieth_century_dcp_crawl_gap','twentieth_century_dcp_asset_crawl',
    'twentieth_century_dcp_asset_tile_observation'
  ]
  loop
    execute format(
      'create trigger %I before insert or update or delete on plm.%I '
      'for each row execute function plm.twentieth_century_dcp_reject_completed_crawl_change()',
      'trg_' || t || '_immutable', t);
  end loop;
end;
$$;

-- -------------------------------------------------------------------------------------
-- 6.1b plm.twentieth_century_dcp_load_exception -- frozen against INSERT and DELETE, but a human may still
--      RESOLVE an entry after the crawl completes.
--
-- THE DECISION, STATED SO NOBODY HAS TO GUESS WHETHER IT WAS INTENTIONAL. Freezing this
-- table wholesale (the 6.1 treatment) would mean that the moment a crawl completes, a
-- `warning` row can never be annotated, triaged or marked resolved -- which is the entire
-- purpose of its resolved_at and resolution_note columns, and those columns would be dead
-- weight from the first completed crawl onward. Warnings are, by definition, the entries
-- that DID load and that a human is expected to look at LATER; "later" is almost always
-- after the crawl finished.
--
-- So the carve-out is the same principle used for the stable-identity tables in 6.2:
-- SOURCE facts freeze, OUR later decisions do not.
--   * INSERT into a completed crawl: REFUSED. A new exception after the fact would be a
--     finding the crawl never actually produced.
--   * DELETE from a completed crawl: REFUSED. Deleting a finding is how a finding stops
--     existing.
--   * UPDATE of a completed crawl's row: only resolved_at and resolution_note may change.
--     Everything else -- severity, reason_code, reason, raw_row, the row/chunk pointers --
--     is source evidence and stays frozen.
-- Note that unresolved REJECTED rows still block finalization (finalize gate 3), so this
-- carve-out cannot be used to complete a crawl over open rejections and tidy them up
-- afterwards.
-- -------------------------------------------------------------------------------------
create or replace function plm.twentieth_century_dcp_load_exception_freeze()
returns trigger
language plpgsql
as $$
declare
  v_crawl  uuid;
  v_status text;
begin
  -- NEW is unassigned in a DELETE trigger, so the branch precedes the read.
  if tg_op = 'DELETE' then
    v_crawl := old.crawl_id;
  else
    v_crawl := new.crawl_id;
  end if;

  select c.status into v_status from plm.twentieth_century_dcp_crawl c where c.crawl_id = v_crawl;

  if v_status is distinct from 'complete' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'INSERT' then
    raise exception '20th Century DCP Vault crawl % is COMPLETE; a new load exception may not be added '
      'to it. An exception recorded after the fact is a finding the crawl never produced.',
      v_crawl using errcode = 'P0001';
  end if;

  if tg_op = 'DELETE' then
    raise exception '20th Century DCP Vault crawl % is COMPLETE; its load exceptions may not be deleted. '
      'Deleting a finding is how a finding stops existing.', v_crawl using errcode = 'P0001';
  end if;

  -- `id` is compared too. Without it a completed crawl's finding could be RE-KEYED --
  -- every other column identical, a new primary key -- which breaks any external
  -- reference to that finding while looking like nothing changed.
  if new.id               is distinct from old.id
  or new.crawl_id         is distinct from old.crawl_id
  or new.crawl_section_id is distinct from old.crawl_section_id
  or new.chunk_number     is distinct from old.chunk_number
  or new.row_number       is distinct from old.row_number
  or new.severity         is distinct from old.severity
  or new.reason_code      is distinct from old.reason_code
  or new.reason           is distinct from old.reason
  or new.source_path      is distinct from old.source_path
  or new.raw_row          is distinct from old.raw_row
  or new.created_at       is distinct from old.created_at then
    raise exception '20th Century DCP Vault crawl % is COMPLETE: the source fields of a load exception '
      'are immutable. Only resolved_at and resolution_note may change, so a human can still '
      'triage a warning after the crawl finished.', v_crawl using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create trigger trg_twentieth_century_dcp_load_exception_immutable
  before insert or update or delete on plm.twentieth_century_dcp_load_exception
  for each row execute function plm.twentieth_century_dcp_load_exception_freeze();

comment on function plm.twentieth_century_dcp_load_exception_freeze() is
'Narrower freeze for plm.twentieth_century_dcp_load_exception. Once the owning crawl is complete: INSERT is '
'refused (a finding the crawl never produced), DELETE is refused (deleting a finding is how '
'it stops existing), and UPDATE may change ONLY resolved_at and resolution_note. This is a '
'DELIBERATE carve-out, not an oversight: warnings are precisely the entries a human is '
'expected to triage LATER, and "later" is nearly always after the crawl finished, so the '
'wholesale 6.1 freeze would have made those two columns dead weight from the first '
'completed crawl. Unresolved REJECTED rows still block finalization, so this cannot be used '
'to complete a crawl over open rejections and tidy them afterwards.';

-- -------------------------------------------------------------------------------------
-- 6.2 Stable identities: SOURCE columns freeze; OUR columns stay editable.
--
-- plm.twentieth_century_dcp_portal_tile, plm.twentieth_century_dcp_style_guide and plm.twentieth_century_dcp_asset outlive any single crawl.
-- Design section 7: deleting an unpromoted crawl must remove its observations but NOT the
-- stable identities other crawls use. So these three are NOT frozen wholesale.
--
-- What freezes: the SOURCE columns, once the row has been observed by any COMPLETE crawl.
-- What stays editable, forever: last_seen_crawl_id (a later crawl re-observing the same
-- row is normal), updated_at, and the reconciliation columns -- those are OUR decisions,
-- made after the fact, and are the entire reason these tables have them.
-- DELETE is refused outright once a complete crawl has seen the row.
-- -------------------------------------------------------------------------------------
create or replace function plm.twentieth_century_dcp_reject_completed_source_field_change()
returns trigger
language plpgsql
as $$
declare
  v_seen boolean;
begin
  -- "Has any COMPLETE crawl observed this row?" is answered per table, from the evidence
  -- tables, not from a flag on the row -- a flag would have to be maintained and could
  -- drift out of agreement with the evidence it claims to summarise.
  if tg_table_name = 'twentieth_century_dcp_asset' then
    select exists (
      select 1 from plm.twentieth_century_dcp_asset_crawl ac
      join plm.twentieth_century_dcp_crawl c on c.crawl_id = ac.crawl_id
      where ac.twentieth_century_dcp_asset_id = old.id and c.status = 'complete'
    ) into v_seen;
  elsif tg_table_name = 'twentieth_century_dcp_style_guide' then
    select exists (
      select 1 from plm.twentieth_century_dcp_asset a
      join plm.twentieth_century_dcp_asset_crawl ac on ac.twentieth_century_dcp_asset_id = a.id
      join plm.twentieth_century_dcp_crawl c on c.crawl_id = ac.crawl_id
      where a.style_guide_id = old.id and c.status = 'complete'
    ) into v_seen;
  elsif tg_table_name = 'twentieth_century_dcp_portal_tile' then
    select exists (
      select 1 from plm.twentieth_century_dcp_asset_tile_observation o
      join plm.twentieth_century_dcp_crawl c on c.crawl_id = o.crawl_id
      where o.portal_tile_id = old.id and c.status = 'complete'
    ) into v_seen;
  else
    -- An unknown table means this trigger was attached somewhere it was not designed for.
    -- FAIL LOUDLY. Returning NEW here would install a guard that silently permits
    -- everything on the new table, which is worse than no guard at all.
    raise exception 'plm.twentieth_century_dcp_reject_completed_source_field_change is attached to %.% which '
      'it does not know how to evaluate. Extend the function before attaching it.',
      tg_table_schema, tg_table_name using errcode = 'P0001';
  end if;

  if not v_seen then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    raise exception '20th Century DCP Vault: %.% row % has been observed by a COMPLETE crawl and may not '
      'be deleted. Stable source identities are permanent evidence.',
      tg_table_schema, tg_table_name, old.id using errcode = 'P0001';
  end if;

  if tg_table_name = 'twentieth_century_dcp_asset' then
    if new.source_system        is distinct from old.source_system
    or new.source_path          is distinct from old.source_path
    or new.style_guide_id       is distinct from old.style_guide_id
    or new.file_name            is distinct from old.file_name
    or new.file_extension       is distinct from old.file_extension
    or new.relative_folder_path is distinct from old.relative_folder_path
    or new.source_asset_id      is distinct from old.source_asset_id
    or new.file_size_bytes      is distinct from old.file_size_bytes
    or new.content_type         is distinct from old.content_type
    or new.checksum             is distinct from old.checksum
    or new.first_seen_crawl_id  is distinct from old.first_seen_crawl_id
    or new.raw                  is distinct from old.raw then
      raise exception '20th Century DCP Vault: source fields of plm.twentieth_century_dcp_asset row % are immutable once a '
        'COMPLETE crawl has observed it. Every stored row hash was computed from these '
        'exact values; changing one silently invalidates its change detection. Only '
        'last_seen_crawl_id and updated_at may change.', old.id using errcode = 'P0001';
    end if;

  elsif tg_table_name = 'twentieth_century_dcp_style_guide' then
    if new.source_system       is distinct from old.source_system
    or new.source_path         is distinct from old.source_path
    or new.source_guide_id     is distinct from old.source_guide_id
    or new.folder_name         is distinct from old.folder_name
    or new.region              is distinct from old.region
    or new.year_segment        is distinct from old.year_segment
    or new.parent_source_path  is distinct from old.parent_source_path
    or new.first_seen_crawl_id is distinct from old.first_seen_crawl_id
    or new.raw                 is distinct from old.raw then
      raise exception '20th Century DCP Vault: source fields of plm.twentieth_century_dcp_style_guide row % are immutable '
        'once a COMPLETE crawl has observed it. Only last_seen_crawl_id, updated_at and the '
        'reconciliation columns may change.', old.id using errcode = 'P0001';
    end if;

  elsif tg_table_name = 'twentieth_century_dcp_portal_tile' then
    if new.source_system       is distinct from old.source_system
    or new.source_key          is distinct from old.source_key
    or new.display_label       is distinct from old.display_label
    or new.source_url          is distinct from old.source_url
    or new.first_seen_crawl_id is distinct from old.first_seen_crawl_id
    or new.raw                 is distinct from old.raw then
      raise exception '20th Century DCP Vault: source fields of plm.twentieth_century_dcp_portal_tile row % are immutable '
        'once a COMPLETE crawl has observed it. Only last_seen_crawl_id, updated_at and the '
        'reconciliation columns may change.', old.id using errcode = 'P0001';
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

comment on function plm.twentieth_century_dcp_reject_completed_source_field_change() is
'Narrower immutability trigger for the three STABLE IDENTITY tables, which outlive any one '
'crawl and therefore must not freeze wholesale. Once a COMPLETE crawl has observed a row -- '
'a fact read from the evidence tables, never from a maintainable flag that could drift -- '
'its SOURCE columns freeze and DELETE is refused, while last_seen_crawl_id, updated_at and '
'the reconciliation columns (core_property_id / core_style_guide_id and resolution_*) stay '
'editable, because reconciliation is OUR later decision and not source data. Attached to an '
'unknown table it RAISES rather than returning NEW: a guard that silently permits '
'everything is worse than no guard.';

create trigger trg_twentieth_century_dcp_asset_source_immutable
  before update or delete on plm.twentieth_century_dcp_asset
  for each row execute function plm.twentieth_century_dcp_reject_completed_source_field_change();
create trigger trg_twentieth_century_dcp_style_guide_source_immutable
  before update or delete on plm.twentieth_century_dcp_style_guide
  for each row execute function plm.twentieth_century_dcp_reject_completed_source_field_change();
create trigger trg_twentieth_century_dcp_portal_tile_source_immutable
  before update or delete on plm.twentieth_century_dcp_portal_tile
  for each row execute function plm.twentieth_century_dcp_reject_completed_source_field_change();

-- -------------------------------------------------------------------------------------
-- 6.3 The crawl header itself.
--
-- Adapted from plm.pmt_capture_freeze. finalize's own UPDATE runs while the row is still
-- 'running', so it passes; once complete, nothing may change and the row may not be
-- deleted. Blocking the DELETE here also stops the ON DELETE CASCADE from ever reaching a
-- completed crawl's evidence.
-- -------------------------------------------------------------------------------------
create or replace function plm.twentieth_century_dcp_crawl_freeze()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'complete' then
      raise exception '20th Century DCP Vault crawl % is COMPLETE and may not be deleted. Completed '
        'crawls are retained permanently, and deleting one would cascade away the evidence '
        'of what the portal said.', old.crawl_id using errcode = 'P0001';
    end if;
    return old;
  end if;

  if old.status = 'complete' then
    raise exception '20th Century DCP Vault crawl % is COMPLETE and immutable. A refresh is a NEW crawl, '
      'never an edit of a completed one.', old.crawl_id using errcode = 'P0001';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create trigger trg_twentieth_century_dcp_crawl_freeze
  before update or delete on plm.twentieth_century_dcp_crawl
  for each row execute function plm.twentieth_century_dcp_crawl_freeze();

comment on function plm.twentieth_century_dcp_crawl_freeze() is
'Freezes a COMPLETE plm.twentieth_century_dcp_crawl row against UPDATE and DELETE, and maintains updated_at '
'while the crawl is still in flight. Refusing the DELETE also stops ON DELETE CASCADE from '
'ever reaching a completed crawl''s sections, gaps, memberships, tile observations and '
'exceptions. plm.finalize_twentieth_century_dcp_crawl''s own UPDATE runs while the row is still running, so '
'it is unaffected.';

-- =====================================================================================
-- SECTION 7. PRIVILEGES -- revoke-first, PostgreSQL 17 complete
--
-- THE TRAP, STATED PLAINLY. The plm schema carries a standing
--     alter default privileges in schema plm grant all on tables to service_role
-- (20260710135975_reconcile_service_role_grants.sql:14). It fires at CREATE TABLE time,
-- BEFORE any GRANT in this migration could run. VERIFIED LIVE on 2026-08-10 against both
-- projects: pg_default_acl for schema plm reads {service_role=arwdDxtm/postgres} -- all
-- eight bits, INCLUDING TRUNCATE and PostgreSQL 17's MAINTAIN. So every table created
-- above was BORN holding TRUNCATE for service_role.
--
-- A NARROWER GRANT DOES NOT REMOVE A BIT. Only REVOKE does. This is exactly what
-- 20260810110000 had to repair on the Warner tables after the fact, and what #664 (the
-- missed MAINTAIN) and #649 (the default-privilege hole itself) are about.
--
-- WHY IT MATTERS HERE MORE THAN USUAL: TRUNCATE FIRES NO ROW TRIGGERS. One TRUNCATE would
-- erase a completed crawl's entire evidence without any section 6 trigger running once.
-- Every immutability guarantee in this migration rests on this revoke.
--
-- THE POSTURE, copied from 20260810110000 (Warner) verbatim as the pattern:
--   service_role keeps SELECT only; INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
--   and MAINTAIN are revoked. public and anon get `revoke all`.
--   INSERT is kept deliberately: the 20260810190100 loader functions are SECURITY DEFINER
--   and never consume service_role's table grants; the loader's security-definer path and
--   the exception table are exercised by service_role in the apply lane, and Warner's
--   shipped posture is the pattern this ruling names. It is the MUTATING bits -- above all
--   TRUNCATE -- that the immutability design cannot survive.
-- =====================================================================================
do $$
declare t text;
begin
  foreach t in array array[
    'twentieth_century_dcp_crawl','twentieth_century_dcp_portal_tile','twentieth_century_dcp_style_guide','twentieth_century_dcp_asset',
    'twentieth_century_dcp_crawl_section','twentieth_century_dcp_crawl_gap','twentieth_century_dcp_asset_crawl',
    'twentieth_century_dcp_asset_tile_observation','twentieth_century_dcp_load_exception'
  ]
  loop
    execute format(
      'revoke insert, update, delete, truncate, references, trigger, maintain on plm.%I from service_role', t);
    execute format('revoke all on plm.%I from public', t);
    execute format('revoke all on plm.%I from anon', t);
    execute format('grant select on plm.%I to service_role', t);
    execute format('grant select on plm.%I to authenticated', t);
  end loop;
end;
$$;

-- =====================================================================================
-- SECTION 8. ROW LEVEL SECURITY
--
-- AN RLS POLICY IS NOT A GRANT, and a GRANT IS NOT A POLICY. Both are required, so both
-- are set, in loops that cannot skip a table by hand.
--
-- THE PREDICATE IS THE ROLE GATE from 20260807190000:73-81, the one Warner adopted in
-- 20260810110000. `using (true)` IS FORBIDDEN HERE. It was a live security defect on the
-- Disney OPA extract -- it made confidential licensor data readable by EVERY signed-in
-- account, including vendor and viewer principals -- and this is the same licensor's data
-- from a second portal. Note honestly what the predicate does: app.has_app_access checks
-- for a non-revoked app-access row and ignores roles entirely, so plm app access alone is
-- sufficient. Narrowing that is an owner decision affecting every table sharing this
-- pattern and is out of scope here.
-- =====================================================================================
do $$
declare t text;
begin
  foreach t in array array[
    'twentieth_century_dcp_crawl','twentieth_century_dcp_portal_tile','twentieth_century_dcp_style_guide','twentieth_century_dcp_asset',
    'twentieth_century_dcp_crawl_section','twentieth_century_dcp_crawl_gap','twentieth_century_dcp_asset_crawl',
    'twentieth_century_dcp_asset_tile_observation','twentieth_century_dcp_load_exception'
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
-- Disney 20th Century DCP Vault -- PHASE 2 metadata landing schema.
--
-- Migration: 20260811050000_twentieth_century_dcp_vault_metadata_landing.sql
-- Issue:     u2giants/shared-db #748 (workstream). Object claim: #749 -- this migration
--            owns eight NEW plm.twentieth_century_dcp_* tables and touches NOTHING that already exists.
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
-- CONFIDENTIALITY. u2giants/shared-db is a PUBLIC repository. The 20th Century DCP Vault extract is
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
--   THE ENFORCEMENT: plm.twentieth_century_dcp_asset_property_observation and
--   plm.twentieth_century_dcp_asset_character_observation are separate tables with NO foreign key between
--   them, no shared surrogate, no trigger that reads one while writing the other, and no
--   function anywhere in 20260811060000 that opens both in the same statement.
--   plm.twentieth_century_dcp_character DELIBERATELY HAS NO PROPERTY COLUMN. That absence is a locked
--   decision -- do not "finish" it. Disney OPA (plm.opa_*) is the ONLY Disney source that
--   directly asserts property-to-character, and it is a different portal with a different
--   landing schema which must not be folded into this one.
--
-- RULE 2 -- THE PATH IS THE ASSET IDENTITY. File name is NOT unique; collisions are
--   observed in this source in the thousands. The style-guide source id is NULLABLE TEXT
--   in two different observed formats. A NAME IS NEVER AN ID. This migration therefore
--   never keys anything on a name, and reaches assets only through plm.twentieth_century_dcp_asset.id,
--   which Phase 1 keyed on (source_system, source_path).
--
-- RULE 3 -- METADATA IS TIME-VARYING OBSERVATION DATA. Every scalar and every link in
--   this migration is keyed by (metadata_run_id, twentieth_century_dcp_asset_id) -- NEVER written onto the
--   stable plm.twentieth_century_dcp_asset row. The source is a point-in-time portal snapshot with no
--   change feed, so overwriting one "current metadata" row loses the fact that a title,
--   owner, restriction or tag changed. A future view may select the latest complete run;
--   the landing layer keeps them all.
--
-- RULE 4 -- HTTP 200 IS NOT SUCCESS. A signed-out 20th Century DCP Vault session returns HTTP 200 with
--   a tiny zero-record body. fetch_status is therefore a first-class column with its own
--   'signed_out' value, and 20260811060000 refuses to mark a response successful on
--   status code alone.
--
-- =====================================================================================
-- SECTION -0.5. WHAT THIS MIGRATION DELIBERATELY DOES NOT DO
-- =====================================================================================
--
-- (a) IT DOES NOT TOUCH plm.twentieth_century_dcp_asset_row_hash OR ANY PHASE-1 OBJECT. The Phase-1 frozen
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
--     and for the same reason. No application reads 20th Century DCP Vault data today. An api view is
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
-- SECTION 0. THE SECOND FROZEN SERIALIZATION -- plm.twentieth_century_dcp_metadata_row_hash
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
-- IT IS A DIFFERENT FUNCTION FROM plm.twentieth_century_dcp_asset_row_hash AND MUST STAY ONE. They digest
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
--   refused row becomes a plm.twentieth_century_dcp_load_exception, never a silently different digest.
--
-- WHY 22 NAMED PARAMETERS AND NOT ONE text[] OF SCALARS: an array makes slot ORDER the
--   caller's responsibility, and a caller that reorders two slots produces a valid-looking
--   digest of the wrong serialization with no error anywhere. Named parameters make the
--   order the FUNCTION's responsibility, which is the whole point of computing the digest
--   in the database instead of in a loader.
-- =====================================================================================
create or replace function plm.twentieth_century_dcp_metadata_row_hash(
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
        'a response must be recorded in plm.twentieth_century_dcp_load_exception instead. No value is '
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

comment on function plm.twentieth_century_dcp_metadata_row_hash(
  text, text, text, text, text, text, text, text, text, text, text,
  text, text, text, text, text, text, text, text[], text[], text[], text[]) is
'Canonical normalized-metadata digest for plm.twentieth_century_dcp_metadata_asset.normalized_hash. sha256, '
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
'plm.twentieth_century_dcp_asset_row_hash and must stay separate -- that one is already frozen over ~155,900 '
'Phase-1 rows. This one freezes on the first complete metadata load: change it now or '
'never. Full normative specification in section 0 of migration 20260811050000.';

revoke all on function plm.twentieth_century_dcp_metadata_row_hash(
  text, text, text, text, text, text, text, text, text, text, text,
  text, text, text, text, text, text, text, text[], text[], text[], text[]) from public;
grant execute on function plm.twentieth_century_dcp_metadata_row_hash(
  text, text, text, text, text, text, text, text, text, text, text,
  text, text, text, text, text, text, text, text[], text[], text[], text[])
  to authenticated, service_role;

-- =====================================================================================
-- SECTION 1. plm.twentieth_century_dcp_metadata_run -- one row per attempt to fetch metadata for every
--            asset in ONE COMPLETED path crawl.
-- =====================================================================================
create table plm.twentieth_century_dcp_metadata_run (
  metadata_run_id      uuid primary key default gen_random_uuid(),

  -- on delete restrict, NOT cascade: a path crawl that has metadata hanging off it is
  -- evidence a metadata run depended on, and deleting it silently would strand the
  -- interpretation of every response.
  source_crawl_id      uuid not null references plm.twentieth_century_dcp_crawl(crawl_id) on delete restrict,

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

  constraint twentieth_century_dcp_metadata_run_status_chk
    check (status in ('planned','running','complete','failed')),

  constraint twentieth_century_dcp_metadata_run_captured_on_chk
    check (captured_on >= date '2026-01-01'),

  -- No scheme, no host, no query string, no whitespace. A leading '/' is required so the
  -- value cannot accidentally be a bare host name.
  constraint twentieth_century_dcp_metadata_run_endpoint_chk check (
    btrim(endpoint_suffix) = endpoint_suffix
    and endpoint_suffix <> ''
    and left(endpoint_suffix, 1) = '/'
    and position('://' in endpoint_suffix) = 0
    and position('?' in endpoint_suffix) = 0
    and endpoint_suffix !~ '\s'
  ),

  constraint twentieth_century_dcp_metadata_run_crawler_version_chk check (btrim(crawler_version) <> ''),
  constraint twentieth_century_dcp_metadata_run_captured_by_chk check (btrim(captured_by) <> ''),
  -- A 40-char hex sha1 or a 64-char hex sha256. Provenance that cannot be resolved back
  -- to an exact private commit is not provenance.
  constraint twentieth_century_dcp_metadata_run_commit_chk
    check (private_source_commit ~ '^[0-9a-f]{40}$'
        or private_source_commit ~ '^[0-9a-f]{64}$'),

  constraint twentieth_century_dcp_metadata_run_expected_chk check (assets_expected >= 0),
  constraint twentieth_century_dcp_metadata_run_counts_chk check (
    (fetches_succeeded is null or fetches_succeeded >= 0)
    and (fetches_failed is null or fetches_failed >= 0)
  ),

  -- THE COMPLETENESS ARITHMETIC, AS A CONSTRAINT AND NOT AS A HOPE.
  -- A run may only be `complete` when both counts are present and they add up to exactly
  -- what was expected. This is the structural form of "a missing chunk cannot assemble
  -- into a shorter complete run": the count was fixed at begin time from the source
  -- crawl's own membership, so a load that quietly dropped rows cannot balance.
  constraint twentieth_century_dcp_metadata_run_complete_chk check (
    status <> 'complete'
    or (fetches_succeeded is not null
        and fetches_failed is not null
        and fetches_succeeded + fetches_failed = assets_expected
        and finished_at is not null)
  ),
  constraint twentieth_century_dcp_metadata_run_failed_chk check (
    status <> 'failed' or (failure_message is not null and btrim(failure_message) <> '')
  ),
  constraint twentieth_century_dcp_metadata_run_running_chk check (
    status = 'planned' or started_at is not null
  ),
  constraint twentieth_century_dcp_metadata_run_finished_order_chk check (
    finished_at is null or started_at is null or finished_at >= started_at
  ),

  -- Supports the composite foreign key on plm.twentieth_century_dcp_metadata_asset that pins a metadata row
  -- to the SAME source crawl its run declared. Redundant as a uniqueness statement --
  -- metadata_run_id is already the primary key -- and REQUIRED as a referencable target,
  -- because PostgreSQL will only accept a composite FK against a declared unique key.
  constraint twentieth_century_dcp_metadata_run_run_crawl_unique unique (metadata_run_id, source_crawl_id)
);

-- ONE RUNNING RUN PER SOURCE CRAWL. A partial unique index, not a CHECK: the rule is
-- about the relationship BETWEEN rows, which a row constraint cannot see. Two concurrent
-- runs over one crawl would each believe they own the reconciliation and each finalize
-- against the other's rows.
create unique index idx_twentieth_century_dcp_metadata_run_one_running
  on plm.twentieth_century_dcp_metadata_run (source_crawl_id)
  where status = 'running';

create index idx_twentieth_century_dcp_metadata_run_source_crawl on plm.twentieth_century_dcp_metadata_run (source_crawl_id);
create index idx_twentieth_century_dcp_metadata_run_status on plm.twentieth_century_dcp_metadata_run (status);

comment on table plm.twentieth_century_dcp_metadata_run is
'One row per attempt to fetch 20th Century DCP Vault metadata for every asset in ONE COMPLETED path '
'crawl. A metadata run is NOT another path crawl: it hangs off plm.twentieth_century_dcp_crawl and may only '
'cover assets that crawl observed. assets_expected is fixed at begin time from the source '
'crawl''s own plm.twentieth_century_dcp_asset_crawl membership, which is what makes the completeness '
'arithmetic meaningful -- a load that silently dropped rows cannot make '
'succeeded + failed = expected balance. Only ONE run per source crawl may be `running` at '
'a time (partial unique index). A `complete` run is IMMUTABLE, including against INSERT '
'into its evidence tables.';
comment on column plm.twentieth_century_dcp_metadata_run.endpoint_suffix is
'The RELATIVE, NON-SECRET path suffix the metadata fetch used. Never a full URL, never a '
'query string, never a cookie, session id, bearer token or signed parameter -- a CHECK '
'enforces that shape rather than trusting the caller, because a credential written here '
'would live in this shared database''s logs and backups permanently.';
comment on column plm.twentieth_century_dcp_metadata_run.assets_expected is
'The exact plm.twentieth_century_dcp_asset_crawl row count of the source crawl, captured at begin time by '
'plm.begin_twentieth_century_dcp_metadata_run. NEVER a caller-supplied number and never re-derived at '
'finalization -- re-deriving it at the end would let a run that lost rows redefine its own '
'target and report itself complete.';

-- =====================================================================================
-- SECTION 2. plm.twentieth_century_dcp_metadata_asset -- one row per expected asset per metadata run.
--
-- This is the fetch-outcome and scalar-metadata table, and it is the join point every
-- link table hangs off.
--
-- THE TWO COMPOSITE FOREIGN KEYS, AND WHY NEITHER IS REDUNDANT.
--   FK-A  (metadata_run_id, source_crawl_id) -> twentieth_century_dcp_metadata_run(metadata_run_id, source_crawl_id)
--         pins this row's source_crawl_id to the one its RUN declared. Without it a row
--         could name run R while claiming a different source crawl, and the membership
--         check below would then be performed against the wrong crawl entirely.
--   FK-B  (source_crawl_id, twentieth_century_dcp_asset_id) -> twentieth_century_dcp_asset_crawl(crawl_id, twentieth_century_dcp_asset_id)
--         proves this asset was ACTUALLY OBSERVED BY THAT CRAWL. Without it, metadata
--         could be attached to any asset in the table, including one from a different
--         crawl or a different portal section, and the run's reconciliation would still
--         appear to balance.
--   TOGETHER they make "a metadata row cannot reference an asset outside its source
--   crawl" a structural impossibility rather than a loader convention. A single FK
--   straight to plm.twentieth_century_dcp_asset(id) -- the obvious shape -- enforces neither.
-- =====================================================================================
create table plm.twentieth_century_dcp_metadata_asset (
  metadata_run_id  uuid not null,
  source_crawl_id  uuid not null,
  twentieth_century_dcp_asset_id     uuid not null,

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

  constraint twentieth_century_dcp_metadata_asset_pkey primary key (metadata_run_id, twentieth_century_dcp_asset_id),

  -- FK-A and FK-B. See the header above; neither replaces the other.
  constraint twentieth_century_dcp_metadata_asset_run_fk
    foreign key (metadata_run_id, source_crawl_id)
    references plm.twentieth_century_dcp_metadata_run (metadata_run_id, source_crawl_id) on delete cascade,
  constraint twentieth_century_dcp_metadata_asset_membership_fk
    foreign key (source_crawl_id, twentieth_century_dcp_asset_id)
    references plm.twentieth_century_dcp_asset_crawl (crawl_id, twentieth_century_dcp_asset_id) on delete restrict,

  constraint twentieth_century_dcp_metadata_asset_fetch_status_chk check (
    fetch_status in ('pending','success','not_found','signed_out','rejected','failed')
  ),
  constraint twentieth_century_dcp_metadata_asset_attempts_chk check (attempt_count >= 0),
  constraint twentieth_century_dcp_metadata_asset_bytes_chk check (response_bytes is null or response_bytes >= 0),
  constraint twentieth_century_dcp_metadata_asset_http_chk check (http_status is null or http_status between 100 and 599),

  -- FAILURE-STATE COHERENCE, BOTH WAYS. A terminal failure without a code is an
  -- untriageable row; a code on a success is a contradiction that would make any
  -- "how did this run fail" query lie.
  constraint twentieth_century_dcp_metadata_asset_failure_coherence_chk check (
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
  --   plm.finalize_twentieth_century_dcp_metadata_run refuses to complete any run holding a successful row
  --   without BOTH digests. A missing normalized_hash is therefore transient within a
  --   single load statement and impossible in any completed run.
  constraint twentieth_century_dcp_metadata_asset_success_evidence_chk check (
    fetch_status <> 'success'
    or (raw_metadata is not null
        and jsonb_typeof(raw_metadata) = 'object'
        and retrieved_at is not null
        and source_hash is not null)
  ),
  -- A signed-out response must NOT retain a body. Storing it would keep a page of portal
  -- chrome in a licensor-confidential table for no diagnostic value.
  constraint twentieth_century_dcp_metadata_asset_signed_out_chk check (
    fetch_status <> 'signed_out' or raw_metadata is null
  ),
  -- Hashes exist only where a success produced them, and always in the enforced shape.
  constraint twentieth_century_dcp_metadata_asset_source_hash_chk
    check (source_hash is null or source_hash ~ '^[0-9a-f]{64}$'),
  constraint twentieth_century_dcp_metadata_asset_normalized_hash_chk
    check (normalized_hash is null or normalized_hash ~ '^[0-9a-f]{64}$'),
  constraint twentieth_century_dcp_metadata_asset_hash_only_on_success_chk check (
    fetch_status = 'success' or (source_hash is null and normalized_hash is null)
  ),

  -- Interpreted values may only exist where their raw source value exists. An interpreted
  -- boolean beside a NULL raw string is a value invented by the parser.
  constraint twentieth_century_dcp_metadata_asset_interpreted_needs_raw_chk check (
    (is_exclusive_interpreted is null or is_exclusive_raw is not null)
    and (is_embargoed_interpreted is null or is_embargoed_raw is not null)
    and (is_locked_interpreted   is null or is_locked_raw   is not null)
    and (release_date_interpreted is null or release_date_raw is not null)
    and (modified_at_interpreted  is null or modified_at_raw  is not null)
    and (file_size_bytes_interpreted is null or file_size_raw is not null)
    and (num_pages_interpreted    is null or num_pages_raw    is not null)
  ),
  constraint twentieth_century_dcp_metadata_asset_size_chk
    check (file_size_bytes_interpreted is null or file_size_bytes_interpreted >= 0),
  constraint twentieth_century_dcp_metadata_asset_pages_chk
    check (num_pages_interpreted is null or num_pages_interpreted >= 0),

  -- THE SUCCESS-ONLY LINK TARGET. This unique key exists for ONE reason: the three link
  -- tables carry a fetch_status column pinned to 'success' by CHECK and reference this
  -- key, which makes "a link may only hang off a SUCCESSFUL metadata row" a declarative
  -- guarantee instead of a loader promise. It also blocks the reverse hole: a row cannot
  -- be flipped from 'success' to 'failed' while links still point at it, because the FK
  -- has nothing left to reference.
  constraint twentieth_century_dcp_metadata_asset_success_key unique (metadata_run_id, twentieth_century_dcp_asset_id, fetch_status)
);

create index idx_twentieth_century_dcp_metadata_asset_asset on plm.twentieth_century_dcp_metadata_asset (twentieth_century_dcp_asset_id);
create index idx_twentieth_century_dcp_metadata_asset_status on plm.twentieth_century_dcp_metadata_asset (metadata_run_id, fetch_status);
create index idx_twentieth_century_dcp_metadata_asset_crawl on plm.twentieth_century_dcp_metadata_asset (source_crawl_id);
-- Supports "did this asset's metadata change between runs" without scanning a run.
create index idx_twentieth_century_dcp_metadata_asset_normalized_hash
  on plm.twentieth_century_dcp_metadata_asset (twentieth_century_dcp_asset_id, normalized_hash)
  where normalized_hash is not null;
-- The open-work index: which expected assets have not reached a terminal state yet.
create index idx_twentieth_century_dcp_metadata_asset_pending
  on plm.twentieth_century_dcp_metadata_asset (metadata_run_id)
  where fetch_status = 'pending';

comment on table plm.twentieth_century_dcp_metadata_asset is
'One row per EXPECTED asset per metadata run: the fetch outcome plus every scalar the DCP '
'Vault metadata response exposed, each preserved as the exact source text. Scalars are '
'NEVER written onto the stable plm.twentieth_century_dcp_asset row -- metadata is time-varying observation '
'data and overwriting it would lose the fact that a title, owner or restriction changed. '
'Two composite foreign keys, neither redundant: one pins this row to the source crawl its '
'RUN declared, the other proves that crawl actually observed this asset. Together they '
'make "metadata for an asset outside its source crawl" structurally impossible. SUCCESS '
'means a valid metadata OBJECT was stored -- it does NOT mean every Disney field is '
'present, because some assets legitimately omit fields.';
comment on column plm.twentieth_century_dcp_metadata_asset.fetch_status is
'pending | success | not_found | signed_out | rejected | failed. HTTP 200 IS NOT SUCCESS: '
'a signed-out 20th Century DCP Vault session returns 200 with a tiny zero-record body, which is why '
'signed_out is its own terminal value and why a success additionally requires raw_metadata '
'to be a JSON OBJECT. Only a `success` row may carry links.';
comment on column plm.twentieth_century_dcp_metadata_asset.raw_metadata is
'The exact metadata response as a JSON object, kept as evidence. It is EVIDENCE, not the '
'query surface -- the normalized columns and link tables exist precisely so consumers do '
'not each write their own JSON parser over licensor data. NULL on a signed_out row by '
'CHECK: a portal sign-out page has no diagnostic value and should not be retained.';
comment on column plm.twentieth_century_dcp_metadata_asset.source_hash is
'sha256 of the EXACT UTF-8 bytes of the successful raw response TEXT as received, before '
'any cast to jsonb. Deliberately digests the received text and not the parsed value: jsonb '
'canonicalises key order, whitespace, escaping and number form, so a digest taken after '
'the cast would be of something the portal never sent and the capture could not reproduce. '
'Case and whitespace changes in the response DO change this digest, which is the point -- '
'normalized_hash is the one that ignores them.';
comment on column plm.twentieth_century_dcp_metadata_asset.normalized_hash is
'plm.twentieth_century_dcp_metadata_row_hash over the 18 raw scalars and the four sorted link SETS. Changes '
'when the meaning changed; ignores array order. The *_interpreted columns are NOT in it. '
'Its serialization freezes on the first complete production load -- see section 0 of '
'migration 20260811050000.';
comment on column plm.twentieth_century_dcp_metadata_asset.rights_parse_confident is
'FALSE by default and FALSE whenever any rights value was not a spelling the loader has '
'explicitly been taught. The business meanings of isExclusive, isEmbargoed, isLocked and '
'status are UNKNOWN and require Disney''s licensing contact. An unknown value lands raw '
'with this flag false -- it never fails the load and it never coerces to a guess.';

-- =====================================================================================
-- SECTION 3. SOURCE IDENTITIES -- plm.twentieth_century_dcp_property, plm.twentieth_century_dcp_character, plm.twentieth_century_dcp_term
--
-- These three outlive any single metadata run, exactly as plm.twentieth_century_dcp_asset outlives any
-- single path crawl. A later run re-observing the same property is normal and must not be
-- an error, so they are NOT frozen wholesale -- only their SOURCE columns freeze once a
-- COMPLETE run has seen them (section 5.2).
--
-- READ RULE 1 AT THE HEAD OF THIS FILE BEFORE TOUCHING EITHER OF THE FIRST TWO.
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- 3.1 plm.twentieth_century_dcp_property -- one identity per distinct exact member of properties[]
-- -------------------------------------------------------------------------------------
create table plm.twentieth_century_dcp_property (
  id                  uuid primary key default gen_random_uuid(),
  source_system       text not null default 'twentieth_century_dcpvault' check (source_system = 'twentieth_century_dcpvault'),
  source_id           text not null,

  -- Populated ONLY if the portal separately exposes a human label. It is NEVER parsed out
  -- of the id, and it is NEVER used as a key -- see RULE 2. A display name derived from an
  -- id would look like source truth and be our invention.
  display_name        text null,

  first_seen_metadata_run_id uuid null
    references plm.twentieth_century_dcp_metadata_run(metadata_run_id) on delete set null,
  last_seen_metadata_run_id  uuid null
    references plm.twentieth_century_dcp_metadata_run(metadata_run_id) on delete set null,

  -- Reconciliation only. NULL at landing, never written by any loader.
  core_property_id    uuid null,
  resolved_at         timestamptz null,
  resolved_by         text null,
  resolution_note     text null,

  raw                 jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint twentieth_century_dcp_property_source_id_chk check (btrim(source_id) <> ''),
  constraint twentieth_century_dcp_property_display_name_chk
    check (display_name is null or btrim(display_name) <> ''),
  constraint twentieth_century_dcp_property_unique unique (source_system, source_id)
);

create index idx_twentieth_century_dcp_property_core on plm.twentieth_century_dcp_property (core_property_id)
  where core_property_id is not null;

comment on table plm.twentieth_century_dcp_property is
'One SOURCE IDENTITY per distinct exact member of the 20th Century DCP Vault metadata properties[] '
'array. A landing identity, NOT a canonical property: core_property_id is nullable, is '
'NULL at landing, and is written only by a later human-reviewed mapping -- no loader ever '
'sets it and nothing here creates, renames or deactivates a core.property row. Portal '
'TILES are not properties either; tile observations live in plm.twentieth_century_dcp_asset_tile_observation '
'and are a browsing filter, not Disney''s asserted property list.';

-- -------------------------------------------------------------------------------------
-- 3.2 plm.twentieth_century_dcp_character -- one identity per distinct exact member of character[]
--
-- IT HAS NO PROPERTY COLUMN AND NO PROPERTY FOREIGN KEY. THAT IS THE DESIGN, NOT AN
-- OMISSION, AND IT IS LOCKED. See RULE 1. 20th Century DCP Vault never asserts which property a
-- character belongs to; adding the column would create a slot that someone eventually
-- fills by pairing the two arrays on an asset, which fabricates relationships Disney
-- never stated. Disney OPA is the only source that asserts property-to-character, it has
-- its own plm.opa_* landing, and the two must not be folded together.
-- -------------------------------------------------------------------------------------
create table plm.twentieth_century_dcp_character (
  id                  uuid primary key default gen_random_uuid(),
  source_system       text not null default 'twentieth_century_dcpvault' check (source_system = 'twentieth_century_dcpvault'),
  source_id           text not null,
  display_name        text null,

  first_seen_metadata_run_id uuid null
    references plm.twentieth_century_dcp_metadata_run(metadata_run_id) on delete set null,
  last_seen_metadata_run_id  uuid null
    references plm.twentieth_century_dcp_metadata_run(metadata_run_id) on delete set null,

  core_character_id   uuid null,
  resolved_at         timestamptz null,
  resolved_by         text null,
  resolution_note     text null,

  raw                 jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint twentieth_century_dcp_character_source_id_chk check (btrim(source_id) <> ''),
  constraint twentieth_century_dcp_character_display_name_chk
    check (display_name is null or btrim(display_name) <> ''),
  constraint twentieth_century_dcp_character_unique unique (source_system, source_id)
);

create index idx_twentieth_century_dcp_character_core on plm.twentieth_century_dcp_character (core_character_id)
  where core_character_id is not null;

comment on table plm.twentieth_century_dcp_character is
'One SOURCE IDENTITY per distinct exact member of the 20th Century DCP Vault metadata character[] '
'array. THIS TABLE HAS NO PROPERTY COLUMN AND NO PROPERTY FOREIGN KEY, DELIBERATELY AND '
'PERMANENTLY. 20th Century DCP Vault never asserts which property a character belongs to. Adding such a '
'column creates a slot that is eventually filled by pairing properties[] with character[] '
'on the same asset -- one observed asset has NINE properties and ONE character, so that '
'pairing manufactures nine relationships Disney never stated, indistinguishable from real '
'ones forever. Disney OPA (plm.opa_*) is the only Disney source that directly asserts '
'property-to-character and must not be folded into this schema. A character is also NEVER '
'inferred from a folder or file name: assets were observed in character-named folders with '
'no character field at all, and a path is not an identifier assertion.';

-- -------------------------------------------------------------------------------------
-- 3.3 plm.twentieth_century_dcp_term -- reusable exact vocabulary for CLASSIFICATION arrays
--
-- artStyle[] and keyword[] are classifications, not business entities, so they share one
-- vocabulary table discriminated by term_kind rather than getting a table each. If a later
-- sample proves another field is an array, widen term_kind IN A NEW MIGRATION. Do NOT
-- overload this table with properties or characters -- those are entities with their own
-- reconciliation columns and their own locked independence rule.
-- -------------------------------------------------------------------------------------
create table plm.twentieth_century_dcp_term (
  id                  uuid primary key default gen_random_uuid(),
  source_system       text not null default 'twentieth_century_dcpvault' check (source_system = 'twentieth_century_dcpvault'),
  term_kind           text not null,
  source_value        text not null,

  first_seen_metadata_run_id uuid null
    references plm.twentieth_century_dcp_metadata_run(metadata_run_id) on delete set null,
  last_seen_metadata_run_id  uuid null
    references plm.twentieth_century_dcp_metadata_run(metadata_run_id) on delete set null,

  raw                 jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint twentieth_century_dcp_term_kind_chk check (term_kind in ('art_style','keyword')),
  constraint twentieth_century_dcp_term_source_value_chk check (btrim(source_value) <> ''),
  constraint twentieth_century_dcp_term_unique unique (source_system, term_kind, source_value)
);

comment on table plm.twentieth_century_dcp_term is
'Reusable EXACT source vocabulary for the 20th Century DCP Vault classification arrays. term_kind is '
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
-- Each is keyed by (metadata_run_id, twentieth_century_dcp_asset_id, <target>) so that:
--   * a duplicate array member collapses to ONE link (primary key) without rejecting the
--     response -- a repeated value in the source array is a source quirk, not a load
--     failure;
--   * links are per RUN, so yesterday's observation is never overwritten by today's;
--   * an EMPTY array is represented as ZERO link rows beside a SUCCESSFUL metadata row,
--     which is a completely different state from "no successful metadata row exists".
--
-- THE fetch_status COLUMN ON EACH LINK TABLE IS NOT DENORMALISATION. It is pinned to
-- 'success' by CHECK and carried into the composite foreign key against
-- twentieth_century_dcp_metadata_asset_success_key, which makes "a link may only hang off a SUCCESSFUL
-- metadata row" a guarantee the database enforces rather than a promise the loader makes.
-- It also closes the reverse hole: a metadata row cannot be flipped away from 'success'
-- while links still reference it.
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- 4.1 asset -> property. INDEPENDENT OF 4.2.
-- -------------------------------------------------------------------------------------
create table plm.twentieth_century_dcp_asset_property_observation (
  metadata_run_id uuid not null,
  twentieth_century_dcp_asset_id    uuid not null,
  twentieth_century_dcp_property_id uuid not null references plm.twentieth_century_dcp_property(id) on delete restrict,
  fetch_status    text not null default 'success',
  observed_at     timestamptz not null default now(),

  constraint twentieth_century_dcp_asset_property_obs_pkey
    primary key (metadata_run_id, twentieth_century_dcp_asset_id, twentieth_century_dcp_property_id),
  constraint twentieth_century_dcp_asset_property_obs_success_chk check (fetch_status = 'success'),
  constraint twentieth_century_dcp_asset_property_obs_asset_fk
    foreign key (metadata_run_id, twentieth_century_dcp_asset_id, fetch_status)
    references plm.twentieth_century_dcp_metadata_asset (metadata_run_id, twentieth_century_dcp_asset_id, fetch_status)
    on delete cascade
);

create index idx_twentieth_century_dcp_asset_property_obs_property
  on plm.twentieth_century_dcp_asset_property_observation (twentieth_century_dcp_property_id);
create index idx_twentieth_century_dcp_asset_property_obs_run
  on plm.twentieth_century_dcp_asset_property_observation (metadata_run_id);

comment on table plm.twentieth_century_dcp_asset_property_observation is
'Asset-to-property links observed in ONE metadata run. INDEPENDENT of '
'plm.twentieth_century_dcp_asset_character_observation: the two sets are never joined, zipped or '
'cross-produced, and no foreign key, trigger or loader statement relates them. Disney '
'returns properties[] and character[] as separate unordered arrays and asserts NOTHING by '
'their co-presence. ZERO rows here beside a SUCCESSFUL metadata row means "the portal '
'returned an empty property array" -- which is a real fact, entirely different from "no '
'successful metadata row exists". The composite FK carries fetch_status pinned to '
'''success'', so a link cannot hang off a failed, pending or signed-out fetch.';

-- -------------------------------------------------------------------------------------
-- 4.2 asset -> character. INDEPENDENT OF 4.1.
-- -------------------------------------------------------------------------------------
create table plm.twentieth_century_dcp_asset_character_observation (
  metadata_run_id  uuid not null,
  twentieth_century_dcp_asset_id     uuid not null,
  twentieth_century_dcp_character_id uuid not null references plm.twentieth_century_dcp_character(id) on delete restrict,
  fetch_status     text not null default 'success',
  observed_at      timestamptz not null default now(),

  constraint twentieth_century_dcp_asset_character_obs_pkey
    primary key (metadata_run_id, twentieth_century_dcp_asset_id, twentieth_century_dcp_character_id),
  constraint twentieth_century_dcp_asset_character_obs_success_chk check (fetch_status = 'success'),
  constraint twentieth_century_dcp_asset_character_obs_asset_fk
    foreign key (metadata_run_id, twentieth_century_dcp_asset_id, fetch_status)
    references plm.twentieth_century_dcp_metadata_asset (metadata_run_id, twentieth_century_dcp_asset_id, fetch_status)
    on delete cascade
);

create index idx_twentieth_century_dcp_asset_character_obs_character
  on plm.twentieth_century_dcp_asset_character_observation (twentieth_century_dcp_character_id);
create index idx_twentieth_century_dcp_asset_character_obs_run
  on plm.twentieth_century_dcp_asset_character_observation (metadata_run_id);

comment on table plm.twentieth_century_dcp_asset_character_observation is
'Asset-to-character links observed in ONE metadata run. INDEPENDENT of '
'plm.twentieth_century_dcp_asset_property_observation -- see that table''s comment and RULE 1 in migration '
'20260811050000. An asset with many properties and one character creates many rows THERE '
'and one row HERE, and NOTHING relates them. A character is never inferred from a folder '
'or file name. ZERO rows here beside a successful metadata row means the portal returned '
'no character for this asset, which the sample proved is common and legitimate.';

-- -------------------------------------------------------------------------------------
-- 4.3 asset -> classification term
-- -------------------------------------------------------------------------------------
create table plm.twentieth_century_dcp_asset_term_observation (
  metadata_run_id uuid not null,
  twentieth_century_dcp_asset_id    uuid not null,
  twentieth_century_dcp_term_id     uuid not null references plm.twentieth_century_dcp_term(id) on delete restrict,
  fetch_status    text not null default 'success',
  observed_at     timestamptz not null default now(),

  constraint twentieth_century_dcp_asset_term_obs_pkey
    primary key (metadata_run_id, twentieth_century_dcp_asset_id, twentieth_century_dcp_term_id),
  constraint twentieth_century_dcp_asset_term_obs_success_chk check (fetch_status = 'success'),
  constraint twentieth_century_dcp_asset_term_obs_asset_fk
    foreign key (metadata_run_id, twentieth_century_dcp_asset_id, fetch_status)
    references plm.twentieth_century_dcp_metadata_asset (metadata_run_id, twentieth_century_dcp_asset_id, fetch_status)
    on delete cascade
);

create index idx_twentieth_century_dcp_asset_term_obs_term on plm.twentieth_century_dcp_asset_term_observation (twentieth_century_dcp_term_id);
create index idx_twentieth_century_dcp_asset_term_obs_run on plm.twentieth_century_dcp_asset_term_observation (metadata_run_id);

comment on table plm.twentieth_century_dcp_asset_term_observation is
'Asset-to-classification-term links (art_style, keyword) observed in ONE metadata run. The '
'term_kind lives on plm.twentieth_century_dcp_term, so one link table covers both arrays without letting a '
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
-- service_role, so guarded SECURITY DEFINER functions are the only writing path
-- still available to the loader's role, which makes it the one an UPDATE/DELETE-only
-- trigger would leave completely unguarded. The concrete hole here: metadata run R
-- finalizes with its counts reconciled, and then a plain
--     insert into plm.twentieth_century_dcp_asset_character_observation (metadata_run_id, ...) values (R, ...);
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
create or replace function plm.twentieth_century_dcp_reject_completed_metadata_change()
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
  from plm.twentieth_century_dcp_metadata_run r
  where r.metadata_run_id = v_run;

  if v_status = 'complete' then
    raise exception
      '20th Century DCP Vault metadata run % is COMPLETE and its evidence is immutable; % on %.% is '
      'refused. A refresh is a NEW metadata_run_id, never an edit of an old one -- editing '
      'completed evidence destroys the only record of what the portal actually returned.',
      v_run, tg_op, tg_table_schema, tg_table_name
      using errcode = 'P0001';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

comment on function plm.twentieth_century_dcp_reject_completed_metadata_change() is
'Row trigger freezing every RUN-SCOPED plm.twentieth_century_dcp_* metadata table once its owning '
'plm.twentieth_century_dcp_metadata_run reaches status complete. FIRES ON INSERT, UPDATE AND DELETE -- all '
'three, deliberately. INSERT is not an afterthought: section 6 of migration 20260811050000 '
'revokes every direct mutation from service_role, so guarded functions are the '
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
    'twentieth_century_dcp_metadata_asset',
    'twentieth_century_dcp_asset_property_observation',
    'twentieth_century_dcp_asset_character_observation',
    'twentieth_century_dcp_asset_term_observation'
  ]
  loop
    execute format(
      'create trigger %I before insert or update or delete on plm.%I '
      'for each row execute function plm.twentieth_century_dcp_reject_completed_metadata_change()',
      'trg_' || t || '_immutable', t);
  end loop;
end;
$$;

-- -------------------------------------------------------------------------------------
-- 5.1b plm.twentieth_century_dcp_metadata_run itself -- frozen once complete.
--
-- Attached separately because the run row's own key column is metadata_run_id, so the
-- generic function above would work, but the transition INTO 'complete' must still be
-- permitted. A trigger that refused every UPDATE on a complete run would also refuse the
-- UPDATE that MAKES it complete, and finalization could never run.
-- -------------------------------------------------------------------------------------
create or replace function plm.twentieth_century_dcp_metadata_run_freeze()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'complete' then
      raise exception '20th Century DCP Vault metadata run % is COMPLETE and may not be deleted. '
        'Deleting a completed run is how the record of what the portal returned stops '
        'existing; never destroy licensed evidence as a correction.', old.metadata_run_id
        using errcode = 'P0001';
    end if;
    return old;
  end if;

  -- OLD.status = 'complete' is the frozen state. The transition running -> complete is
  -- performed while OLD is still 'running', so finalization is unaffected by this guard.
  if old.status = 'complete' then
    raise exception '20th Century DCP Vault metadata run % is COMPLETE and immutable. A re-fetch is a '
      'NEW metadata_run_id, never an edit of a finished one.', old.metadata_run_id
      using errcode = 'P0001';
  end if;

  -- A run may never leave a terminal state for a live one. Without this, a `failed` run
  -- could be quietly reopened and finalized as though it had always succeeded.
  if old.status = 'failed' and new.status <> 'failed' then
    raise exception '20th Century DCP Vault metadata run % is FAILED and may not be reopened. Start a '
      'NEW run; the failed one stays as the record of what happened.', old.metadata_run_id
      using errcode = 'P0001';
  end if;

  -- The source crawl is the run's identity as much as its own id is. Re-pointing a run at
  -- a different crawl mid-flight would invalidate every membership check already passed.
  if new.source_crawl_id is distinct from old.source_crawl_id then
    raise exception '20th Century DCP Vault metadata run %: source_crawl_id is immutable. Re-pointing a '
      'run at a different crawl invalidates every membership check its rows already '
      'passed.', old.metadata_run_id using errcode = 'P0001';
  end if;

  if new.assets_expected is distinct from old.assets_expected then
    raise exception '20th Century DCP Vault metadata run %: assets_expected is fixed at begin time and '
      'is immutable. A run that could restate its own target could always report itself '
      'complete.', old.metadata_run_id using errcode = 'P0001';
  end if;

  return new;
end;
$$;

comment on function plm.twentieth_century_dcp_metadata_run_freeze() is
'Freeze for plm.twentieth_century_dcp_metadata_run itself. Refuses UPDATE and DELETE once status is '
'complete, refuses reopening a failed run, and pins source_crawl_id and assets_expected '
'for the run''s whole life. It reads OLD.status deliberately, so the running -> complete '
'transition that finalization performs is still allowed -- a guard written against '
'NEW.status would refuse the very UPDATE that completes the run and finalization could '
'never succeed. assets_expected is pinned because a run able to restate its own target '
'could always make succeeded + failed = expected balance.';

create trigger trg_twentieth_century_dcp_metadata_run_freeze
  before update or delete on plm.twentieth_century_dcp_metadata_run
  for each row execute function plm.twentieth_century_dcp_metadata_run_freeze();

-- -------------------------------------------------------------------------------------
-- 5.2 Stable identities: SOURCE columns freeze; OUR columns stay editable.
--
-- plm.twentieth_century_dcp_property, plm.twentieth_century_dcp_character and plm.twentieth_century_dcp_term outlive any single metadata run,
-- so they are NOT frozen wholesale -- a later run re-observing the same identity is normal.
--
-- What freezes: the SOURCE columns, once the row has been observed by any COMPLETE run.
-- What stays editable forever: last_seen_metadata_run_id, updated_at, and the
-- reconciliation columns -- those are OUR decisions, made after the fact, and are the
-- entire reason these tables have them.
-- DELETE is refused outright once a complete run has seen the row.
-- -------------------------------------------------------------------------------------
create or replace function plm.twentieth_century_dcp_reject_completed_metadata_identity_change()
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
  if tg_table_name = 'twentieth_century_dcp_property' then
    select exists (
      select 1 from plm.twentieth_century_dcp_asset_property_observation o
      join plm.twentieth_century_dcp_metadata_run r on r.metadata_run_id = o.metadata_run_id
      where o.twentieth_century_dcp_property_id = old.id and r.status = 'complete'
    ) into v_seen;
  elsif tg_table_name = 'twentieth_century_dcp_character' then
    select exists (
      select 1 from plm.twentieth_century_dcp_asset_character_observation o
      join plm.twentieth_century_dcp_metadata_run r on r.metadata_run_id = o.metadata_run_id
      where o.twentieth_century_dcp_character_id = old.id and r.status = 'complete'
    ) into v_seen;
  elsif tg_table_name = 'twentieth_century_dcp_term' then
    select exists (
      select 1 from plm.twentieth_century_dcp_asset_term_observation o
      join plm.twentieth_century_dcp_metadata_run r on r.metadata_run_id = o.metadata_run_id
      where o.twentieth_century_dcp_term_id = old.id and r.status = 'complete'
    ) into v_seen;
  else
    -- An unknown table means this trigger was attached somewhere it was not designed for.
    -- FAIL LOUDLY. Returning NEW here would install a guard that silently permits
    -- everything on the new table, which is worse than no guard at all.
    raise exception 'plm.twentieth_century_dcp_reject_completed_metadata_identity_change is attached to %.% '
      'which it does not know how to evaluate. Extend the function before attaching it.',
      tg_table_schema, tg_table_name using errcode = 'P0001';
  end if;

  if not v_seen then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    raise exception '20th Century DCP Vault: %.% row % has been observed by a COMPLETE metadata run and '
      'may not be deleted. Other runs reference this identity.',
      tg_table_schema, tg_table_name, old.id using errcode = 'P0001';
  end if;

  -- `id` is compared too. Without it an observed identity could be RE-KEYED -- every other
  -- column identical, a new primary key -- which breaks every link row pointing at it while
  -- looking like nothing changed.
  if tg_table_name = 'twentieth_century_dcp_term' then
    if new.id            is distinct from old.id
    or new.source_system is distinct from old.source_system
    or new.term_kind     is distinct from old.term_kind
    or new.source_value  is distinct from old.source_value
    or new.first_seen_metadata_run_id is distinct from old.first_seen_metadata_run_id
    or new.created_at    is distinct from old.created_at then
      raise exception '20th Century DCP Vault: the SOURCE columns of %.% row % are immutable once a '
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
      raise exception '20th Century DCP Vault: the SOURCE columns of %.% row % are immutable once a '
        'COMPLETE metadata run has observed it. last_seen_metadata_run_id, updated_at and '
        'the reconciliation columns remain editable -- those are our decisions, not the '
        'portal''s.', tg_table_schema, tg_table_name, old.id using errcode = 'P0001';
    end if;
  end if;

  return new;
end;
$$;

comment on function plm.twentieth_century_dcp_reject_completed_metadata_identity_change() is
'Row trigger for the STABLE metadata identities (plm.twentieth_century_dcp_property, plm.twentieth_century_dcp_character, '
'plm.twentieth_century_dcp_term). These outlive any single run, so they are NOT frozen wholesale -- a later '
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
  foreach t in array array['twentieth_century_dcp_property','twentieth_century_dcp_character','twentieth_century_dcp_term']
  loop
    execute format(
      'create trigger %I before update or delete on plm.%I '
      'for each row execute function plm.twentieth_century_dcp_reject_completed_metadata_identity_change()',
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
-- THE POSTURE, identical to Phase 1: service_role keeps SELECT only; INSERT, UPDATE, DELETE,
-- TRUNCATE, REFERENCES, TRIGGER and MAINTAIN are revoked; public and anon get `revoke all`.
-- =====================================================================================
do $$
declare t text;
begin
  foreach t in array array[
    'twentieth_century_dcp_metadata_run','twentieth_century_dcp_metadata_asset',
    'twentieth_century_dcp_property','twentieth_century_dcp_character','twentieth_century_dcp_term',
    'twentieth_century_dcp_asset_property_observation','twentieth_century_dcp_asset_character_observation',
    'twentieth_century_dcp_asset_term_observation'
  ]
  loop
    execute format(
      'revoke insert, update, delete, truncate, references, trigger, maintain on plm.%I from service_role', t);
    execute format('revoke all on plm.%I from public', t);
    execute format('revoke all on plm.%I from anon', t);
    execute format('grant select on plm.%I to service_role', t);
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
    'twentieth_century_dcp_metadata_run','twentieth_century_dcp_metadata_asset',
    'twentieth_century_dcp_property','twentieth_century_dcp_character','twentieth_century_dcp_term',
    'twentieth_century_dcp_asset_property_observation','twentieth_century_dcp_asset_character_observation',
    'twentieth_century_dcp_asset_term_observation'
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
    'twentieth_century_dcp_metadata_asset','twentieth_century_dcp_asset_property_observation',
    'twentieth_century_dcp_asset_character_observation','twentieth_century_dcp_asset_term_observation'
  ]) as t
  where not exists (
    select 1 from information_schema.columns c
    where c.table_schema = 'plm' and c.table_name = t
      and c.column_name = 'metadata_run_id'
  );
  if v_missing is not null then
    raise exception 'DCP metadata landing self-check FAILED: table(s) % are attached to '
      'plm.twentieth_century_dcp_reject_completed_metadata_change but have no metadata_run_id column. The '
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
      and c.column_name in ('twentieth_century_dcp_property_id','twentieth_century_dcp_character_id')
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
    and table_name ~ '^twentieth_century_dcp_.*propert.*character|^twentieth_century_dcp_.*character.*propert';
  if v_count > 0 then
    raise exception 'DCP metadata landing self-check FAILED: a plm.twentieth_century_dcp_* property-character '
      'table exists. No such table may ever be created -- see RULE 1 in migration '
      '20260811050000.';
  end if;

  -- 8.4 The Phase-1 frozen hash must still exist and must NOT have been redefined into a
  -- different signature by anything in this migration. It is a ONE-WAY DOOR over ~155,900
  -- rows and this migration's contract is that it did not touch it.
  select count(*) into v_count
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'plm' and p.proname = 'twentieth_century_dcp_asset_row_hash';
  if v_count <> 1 then
    raise exception 'DCP metadata landing self-check FAILED: expected exactly ONE '
      'plm.twentieth_century_dcp_asset_row_hash, found %. The Phase-1 row hash is frozen over roughly '
      '155,900 rows; this migration must not add, replace or overload it.', v_count;
  end if;

  -- 8.5 Every one of the eight new tables must have RLS enabled AND a read policy. A
  -- GRANT is not a POLICY; a table with RLS enabled and no policy is unreadable, and a
  -- table with a policy and no RLS is wide open. Both halves are asserted.
  select string_agg(t, ', ') into v_missing
  from unnest(array[
    'twentieth_century_dcp_metadata_run','twentieth_century_dcp_metadata_asset','twentieth_century_dcp_property','twentieth_century_dcp_character','twentieth_century_dcp_term',
    'twentieth_century_dcp_asset_property_observation','twentieth_century_dcp_asset_character_observation',
    'twentieth_century_dcp_asset_term_observation'
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

  -- 8.6 service_role must hold NO direct mutating privilege on any of the eight tables.
  -- TRUNCATE above all: it fires no row trigger, so one TRUNCATE would erase a completed
  -- run's evidence with every section 5 guard silently standing by.
  select string_agg(distinct t || '/' || priv, ', ') into v_missing
  from unnest(array[
    'twentieth_century_dcp_metadata_run','twentieth_century_dcp_metadata_asset','twentieth_century_dcp_property','twentieth_century_dcp_character','twentieth_century_dcp_term',
    'twentieth_century_dcp_asset_property_observation','twentieth_century_dcp_asset_character_observation',
    'twentieth_century_dcp_asset_term_observation'
  ]) as t,
  unnest(array['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) as priv
  where has_table_privilege('service_role', 'plm.' || quote_ident(t), priv);
  if v_missing is not null then
    raise exception 'DCP metadata landing self-check FAILED: service_role still holds '
      'mutating privileges: %. TRUNCATE in particular fires NO row triggers, so every '
      'immutability guarantee in section 5 depends on these revokes.', v_missing;
  end if;

  raise notice 'DCP metadata landing self-checks passed: 8 tables, RLS + policies present, '
    'no property-character bridge, Phase-1 frozen hash untouched, service_role holds no '
    'direct mutating privilege.';
end;
$$;


commit;
