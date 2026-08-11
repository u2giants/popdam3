-- =====================================================================================
-- Disney DCP Vault -- source-observation landing schema.
--
-- Migration: 20260810190000_dcp_vault_source_landing.sql
-- Issue:     u2giants/shared-db #665. Object claim: #725 -- this migration owns the
--            plm.dcp_* namespace and touches NOTHING else.
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
-- CONFIDENTIALITY. u2giants/shared-db is a PUBLIC repository. The DCP Vault extract is
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
-- DECISION 1 -- SCHEMA AND NAMING: plm.dcp_*, NOT ingest.portal_*.
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
--   an omission. No application reads DCP Vault data today: there is no PopDAM screen, no
--   dflow screen and no report behind it. An api view is a published read contract that
--   must then be versioned and kept stable forever, and publishing one before a caller
--   exists fixes a shape nobody has validated. When the first reader appears, it brings
--   its required columns with it and the view is authored then, in its own migration.
--   Until then plm.dcp_* is reachable directly by the approved roles under section 8's
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
create or replace function plm.dcp_loader_privilege_ok(
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

comment on function plm.dcp_loader_privilege_ok(text, text) is
'Privilege predicate for the Disney DCP Vault loader. TRUE only for a NON-NULL, '
'positively matched identity: JWT role service_role, or session_user postgres/'
'supabase_admin. NULL or empty on BOTH arguments returns FALSE -- which is the case that '
'holds inside a migration, where auth.role() is NULL. Written as a callable function '
'rather than a DO block so a contract test can prove the NULL case is rejected.';

revoke all on function plm.dcp_loader_privilege_ok(text, text) from public;
grant execute on function plm.dcp_loader_privilege_ok(text, text) to authenticated, service_role;

-- =====================================================================================
-- SECTION 1. THE FROZEN CANONICAL ROW-HASH SERIALIZATION
--
-- ***** THIS SPECIFICATION IS FROZEN. IT IS A ONE-WAY DOOR. *****
--
-- plm.dcp_asset_crawl.observed_row_hash is the ONLY mechanism that detects a changed row
-- between crawls. Once roughly 155,900 rows carry a hash, changing ANY detail of this
-- serialization -- the field list, their order, the separators, the null encoding, the
-- sort collation, the text encoding, the case handling -- invalidates every stored hash
-- at once. Every asset then compares unequal on the next crawl, change detection reports
-- a total rewrite that never happened, and the only correction is a FULL RE-CAPTURE of
-- the entire portal. The design mandated "a documented canonical serialization" and never
-- documented one; this section is that document, and it is normative.
--
-- DO NOT "optimise", "tidy", "simplify" or "modernise" plm.dcp_asset_row_hash. If a new
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
--   slot 1  source_system            -- as stored on plm.dcp_asset
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
-- TILE LIST (slot 8): the SET of plm.dcp_portal_tile.source_key values ACTUALLY LINKED to
--   this asset in THIS crawl -- that is, read back from plm.dcp_asset_tile_observation
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
create or replace function plm.dcp_asset_row_hash(
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
-- Pinned for the same reason as plm.dcp_loader_privilege_ok above: not definer, builtins
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
        'be recorded in plm.dcp_load_exception instead. No value is echoed here because '
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

comment on function plm.dcp_asset_row_hash(text, text, text, text, text, text, text, text[]) is
'THE FROZEN canonical row-hash serialization for plm.dcp_asset_crawl.observed_row_hash. '
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

revoke all on function plm.dcp_asset_row_hash(text, text, text, text, text, text, text, text[]) from public;
grant execute on function plm.dcp_asset_row_hash(text, text, text, text, text, text, text, text[])
  to authenticated, service_role;

-- =====================================================================================
-- SECTION 2. plm.dcp_crawl -- one row per scrape run (design 4.1)
--
-- PROVENANCE ONLY. No asset data lives on this row.
-- =====================================================================================
create table plm.dcp_crawl (
  crawl_id                uuid primary key default gen_random_uuid(),

  source_system           text not null default 'disney_dcpvault',
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

  constraint dcp_crawl_status_chk
    check (status in ('planned','running','partial','complete','failed')),
  constraint dcp_crawl_source_system_chk  check (btrim(source_system) <> ''),
  constraint dcp_crawl_base_url_chk       check (btrim(portal_base_url) <> ''),
  constraint dcp_crawl_crawler_version_chk check (btrim(crawler_version) <> ''),
  constraint dcp_crawl_account_scope_chk  check (btrim(account_scope) <> ''),
  constraint dcp_crawl_lob_chk            check (btrim(line_of_business) <> ''),
  constraint dcp_crawl_captured_by_chk    check (btrim(captured_by) <> ''),
  constraint dcp_crawl_commit_chk         check (btrim(private_source_commit) <> ''),
  constraint dcp_crawl_counts_chk check (
    (rows_received is null or rows_received >= 0)
    and (distinct_assets_received is null or distinct_assets_received >= 0)
  ),

  -- COMPLETE is the strongest claim this schema can make, so each part of it is a CHECK
  -- and not a convention. Section completeness and gap closure are enforced by
  -- plm.finalize_dcp_crawl (20260810190100) because they are set-level facts a row CHECK
  -- cannot see; what a row CHECK CAN prove is asserted here so finalize cannot fake it.
  constraint dcp_crawl_complete_requires_evidence_chk check (
    status <> 'complete'
    or (
      finished_at is not null
      and rows_received is not null
      and distinct_assets_received is not null
      and failure_message is null
    )
  ),
  constraint dcp_crawl_failed_requires_message_chk check (
    status <> 'failed' or btrim(coalesce(failure_message, '')) <> ''
  )
);

create index idx_dcp_crawl_status on plm.dcp_crawl (status, started_at desc);
create index idx_dcp_crawl_latest_complete
  on plm.dcp_crawl (captured_on desc, crawl_id desc) where status = 'complete';

comment on table plm.dcp_crawl is
'One row per Disney DCP Vault scrape run. PROVENANCE ONLY -- no asset data lives here. '
'CRAWL-VERSIONED: every completed crawl is retained permanently and a refresh is a NEW '
'crawl_id, never an edit of an old one. SCOPE: POP Creations'' licensed DCP Vault account '
'and the portal''s CURRENT view. PRESENCE IS EVIDENCE; ABSENCE IS NOT A DELETE INSTRUCTION '
'AND NOT PROOF OF NONEXISTENCE. A crawl reaches status = complete only through '
'plm.finalize_dcp_crawl, which additionally requires every section complete and every gap '
'resolved or waived -- set-level facts no row CHECK can see. Licensor-confidential data: '
'never publish a row and NEVER commit one to this PUBLIC repository.';
comment on column plm.dcp_crawl.captured_on is
'The SNAPSHOT date, supplied explicitly and NEVER derived from now(). The server runs '
'America/New_York, so a midnight-UTC timestamp read through ::date lands on the previous '
'day and would misdate the crawl by one day, silently.';
comment on column plm.dcp_crawl.portal_base_url is
'ORIGIN ONLY (scheme + host). Never a signed download URL, never a session-bearing URL, '
'never a query string carrying a token.';
comment on column plm.dcp_crawl.rows_received is
'INPUT rows the extract claims to carry, declared UP FRONT from its manifest. Legitimately '
'EXCEEDS distinct_assets_received: the extract contains exact duplicate rows for the same '
'DAM path, which are collapsed on load. The difference is not loss.';
comment on column plm.dcp_crawl.distinct_assets_received is
'DISTINCT DAM paths the extract claims to carry, declared UP FRONT. finalize compares it '
'to what actually landed and refuses on a mismatch.';

-- =====================================================================================
-- SECTION 3. plm.dcp_portal_tile -- the portal browsing tiles (design 4.4)
--
-- Called a PORTAL TILE, never a property or a franchise. The extract proves a browse
-- category and nothing more (design section 3). There is deliberately NO allow-list
-- CHECK on source_key: see the completeness note on plm.dcp_crawl_section.
--
-- STABLE IDENTITY table: rows outlive any one crawl. first/last_seen_crawl_id are
-- convenience pointers and are ON DELETE SET NULL, so deleting an unpromoted crawl leaves
-- the identity standing (design section 7).
-- =====================================================================================
create table plm.dcp_portal_tile (
  id                  uuid primary key default gen_random_uuid(),
  source_system       text not null default 'disney_dcpvault',
  source_key          text not null,
  display_label       text null,
  source_url          text null,

  first_seen_crawl_id uuid null references plm.dcp_crawl(crawl_id) on delete set null,
  last_seen_crawl_id  uuid null references plm.dcp_crawl(crawl_id) on delete set null,

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

  constraint dcp_portal_tile_source_key_chk check (btrim(source_key) <> ''),
  constraint dcp_portal_tile_unique unique (source_system, source_key),
  constraint dcp_portal_tile_resolution_status_chk check (
    resolution_status in ('unresolved','matched','ambiguous','no_match','rejected')
  ),
  -- A resolved pointer without a status, or a matched status without a pointer, is a
  -- half-finished decision. Neither may sit in the table looking settled.
  constraint dcp_portal_tile_resolution_coherent_chk check (
    (resolution_status = 'matched') = (core_property_id is not null)
  )
);

comment on table plm.dcp_portal_tile is
'One row per Disney DCP Vault portal BROWSING TILE. A TILE IS NOT A PROPERTY AND NOT A '
'FRANCHISE -- the extract proves only that the portal listed a file under a browse '
'category. Nothing may write tile text into core.property, and core_property_id is a '
'read-only pointer that stays NULL until an explicit reviewed mapping sets it. '
'Deliberately carries NO allow-list of tile keys: the portal exposes more tiles than any '
'one partial crawl observes, and a CHECK pinned to what one checkpoint saw would reject '
'the rest of the portal on the next crawl.';

-- =====================================================================================
-- SECTION 4. plm.dcp_style_guide -- one row per guide path (design 4.5)
--
-- Identity is the FULL SOURCE PATH, never coalesce(source_guide_id, folder_name): folder
-- names repeat across region/year contexts, and a later id backfill would change the
-- value of such an expression and re-key existing rows.
-- =====================================================================================
create table plm.dcp_style_guide (
  id                  uuid primary key default gen_random_uuid(),
  source_system       text not null default 'disney_dcpvault',
  source_path         text not null,
  source_guide_id     text null,
  folder_name         text not null,
  region              text not null,
  year_segment        text not null,
  parent_source_path  text null,

  first_seen_crawl_id uuid null references plm.dcp_crawl(crawl_id) on delete set null,
  last_seen_crawl_id  uuid null references plm.dcp_crawl(crawl_id) on delete set null,

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

  constraint dcp_style_guide_source_path_chk check (btrim(source_path) <> ''),
  constraint dcp_style_guide_folder_name_chk check (btrim(folder_name) <> ''),
  constraint dcp_style_guide_region_chk      check (btrim(region) <> ''),
  -- year_segment is TEXT and stays text: a non-numeric "no year" marker is a valid value
  -- in this source and an integer column could not hold it.
  constraint dcp_style_guide_year_chk        check (btrim(year_segment) <> ''),
  -- A blank guide id is not an id. Store NULL, so the partial unique index below means
  -- what it says.
  constraint dcp_style_guide_guide_id_chk
    check (source_guide_id is null or btrim(source_guide_id) <> ''),
  constraint dcp_style_guide_unique unique (source_system, source_path),
  constraint dcp_style_guide_resolution_status_chk check (
    resolution_status in ('unresolved','matched','ambiguous','no_match','rejected')
  ),
  constraint dcp_style_guide_resolution_coherent_chk check (
    (resolution_status = 'matched') = (core_style_guide_id is not null)
  )
);

-- Partial unique on the real Disney id. Measured safe for this extract: zero source ids
-- map to more than one guide context. It is PARTIAL because most files carry no id at
-- all, and a plain unique would collapse every id-less guide into one row.
create unique index uq_dcp_style_guide_source_guide_id
  on plm.dcp_style_guide (source_system, source_guide_id)
  where source_guide_id is not null;

create index idx_dcp_style_guide_folder_name on plm.dcp_style_guide (folder_name);
create index idx_dcp_style_guide_region_year on plm.dcp_style_guide (region, year_segment);

comment on table plm.dcp_style_guide is
'One row per Disney DCP Vault guide FOLDER PATH. IDENTITY IS THE FULL SOURCE PATH. Never '
're-key this on coalesce(source_guide_id, folder_name): folder names are reused across '
'region/year contexts, and a later id backfill would change that expression''s value and '
'silently re-identify existing rows. The Disney guide id, when present, is enforced unique '
'by a PARTIAL index -- most guides have no id, and a plain unique would collapse them all. '
'year_segment is TEXT because a non-numeric "no year" marker is a legitimate value. '
'core_style_guide_id is a read-only reconciliation pointer, NULL at landing; tile '
'membership may NEVER be used to infer it.';
comment on column plm.dcp_style_guide.parent_source_path is
'Populated ONLY where the portal actually proves nesting. Never inferred by trimming a '
'path segment: a guessed hierarchy is indistinguishable from an observed one once stored.';

-- =====================================================================================
-- SECTION 5. The file identity, its crawl membership, its tile links, and the exceptions
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- 5.1 plm.dcp_asset -- one row per Disney file identity (design 4.6)
-- -------------------------------------------------------------------------------------
create table plm.dcp_asset (
  id                    uuid primary key default gen_random_uuid(),
  source_system         text not null default 'disney_dcpvault',
  source_path           text not null,

  style_guide_id        uuid not null references plm.dcp_style_guide(id) on delete restrict,

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

  first_seen_crawl_id   uuid null references plm.dcp_crawl(crawl_id) on delete set null,
  last_seen_crawl_id    uuid null references plm.dcp_crawl(crawl_id) on delete set null,

  raw                   jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint dcp_asset_source_path_chk check (btrim(source_path) <> ''),
  constraint dcp_asset_file_name_chk   check (btrim(file_name) <> ''),
  -- Lowercase, no dot, non-blank when present. This is the shape the frozen hash slot 4
  -- assumes, so it is enforced rather than trusted.
  constraint dcp_asset_file_extension_chk check (
    file_extension is null
    or (file_extension = lower(file_extension)
        and btrim(file_extension) = file_extension
        and file_extension <> ''
        and position('.' in file_extension) = 0)
  ),
  -- A blank relative folder path is a real observed value in this source; it is stored as
  -- NULL so "no subpath" has exactly one representation and cannot hash two ways.
  constraint dcp_asset_relative_folder_chk
    check (relative_folder_path is null or btrim(relative_folder_path) <> ''),
  constraint dcp_asset_size_chk check (file_size_bytes is null or file_size_bytes >= 0),
  constraint dcp_asset_unique unique (source_system, source_path)
);

-- Design 4.6: index the guide link, the lowercased file name and the extension.
-- NEVER add a unique rule to file_name -- thousands of distinct DAM paths share one name.
create index idx_dcp_asset_style_guide on plm.dcp_asset (style_guide_id);
create index idx_dcp_asset_file_name_lower on plm.dcp_asset (lower(file_name));
create index idx_dcp_asset_file_extension on plm.dcp_asset (file_extension);

comment on table plm.dcp_asset is
'One row per Disney DCP Vault FILE IDENTITY, keyed on the full DAM path. FILE NAME IS NOT '
'AN IDENTITY: thousands of distinct paths share a name in this source, so file_name is '
'indexed and deliberately NOT unique -- never add a unique constraint to it. '
'file_extension is a PLAIN loader-computed column and must never be converted to '
'GENERATED ... STORED: a generated column is populated after BEFORE-row triggers run, '
'which would make every immutability trigger on this table read NULL and never fire. '
'THIS TABLE RECORDS NAMES AND PATHS ONLY. No file bytes, preview, PDF or image is stored '
'here or anywhere in this schema, and the presence of a row is NOT a claim that the '
'content exists locally.';
comment on column plm.dcp_asset.checksum is
'NULL unless the portal exposed one or it was computed from authorized content. Never '
'invented, and never back-filled from the row hash -- plm.dcp_asset_crawl.observed_row_hash '
'digests METADATA, not file bytes, and confusing the two would assert content integrity '
'this scrape never verified.';

-- -------------------------------------------------------------------------------------
-- 5.2 plm.dcp_crawl_section -- one row per planned tile+listing query (design 4.2)
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
create table plm.dcp_crawl_section (
  id             uuid primary key default gen_random_uuid(),
  crawl_id       uuid not null references plm.dcp_crawl(crawl_id) on delete cascade,
  portal_tile_id uuid not null references plm.dcp_portal_tile(id) on delete restrict,
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

  constraint dcp_crawl_section_listing_kind_chk check (listing_kind in ('asset','style_guide')),
  constraint dcp_crawl_section_status_chk
    check (status in ('planned','running','complete','gapped','failed')),
  constraint dcp_crawl_section_counts_chk check (
    captured_count >= 0
    and (expected_count is null or expected_count >= 0)
    and (last_offset is null or last_offset >= 0)
  ),
  -- A section may only claim complete when it finished and, where the portal exposed a
  -- total, actually captured that total. A ZERO-row section is legitimate (a tile really
  -- can be empty) and is allowed -- but only against an expected_count of 0, so "we got
  -- nothing" can never pass as "there was nothing".
  constraint dcp_crawl_section_complete_requires_evidence_chk check (
    status <> 'complete'
    or (finished_at is not null
        and (expected_count is null or captured_count = expected_count))
  ),
  constraint dcp_crawl_section_unique unique (crawl_id, portal_tile_id, listing_kind)
);

create index idx_dcp_crawl_section_crawl on plm.dcp_crawl_section (crawl_id, status);
create index idx_dcp_crawl_section_incomplete
  on plm.dcp_crawl_section (crawl_id) where status <> 'complete';

comment on table plm.dcp_crawl_section is
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
-- 5.3 plm.dcp_crawl_gap -- unresolved missing ranges and request failures (design 4.3)
-- -------------------------------------------------------------------------------------
create table plm.dcp_crawl_gap (
  id               uuid primary key default gen_random_uuid(),
  crawl_section_id uuid not null references plm.dcp_crawl_section(id) on delete cascade,
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

  constraint dcp_crawl_gap_offsets_chk check (offset_from >= 0 and offset_to >= offset_from),
  constraint dcp_crawl_gap_reason_chk  check (btrim(reason) <> ''),
  constraint dcp_crawl_gap_attempts_chk check (attempt_count >= 0),
  -- A resolution must say what it did; a silent resolved_at is not a resolution.
  constraint dcp_crawl_gap_resolution_chk check (
    resolved_at is null or btrim(coalesce(resolution_note, '')) <> ''
  ),
  -- A WAIVER IS A DECISION AND MUST BE SIGNED. All three parts or none: who, when, why.
  -- An unsigned waiver is how a gap gets closed by nobody.
  constraint dcp_crawl_gap_waiver_chk check (
    (waived_at is null and waived_by is null and waiver_reason is null)
    or (waived_at is not null
        and btrim(coalesce(waived_by, '')) <> ''
        and btrim(coalesce(waiver_reason, '')) <> '')
  ),
  -- A gap is either resolved (it was actually re-fetched) or waived (a human accepted the
  -- loss). It may not be both: that hides which of the two actually happened.
  constraint dcp_crawl_gap_not_both_chk check (resolved_at is null or waived_at is null)
);

create index idx_dcp_crawl_gap_section on plm.dcp_crawl_gap (crawl_section_id);
create index idx_dcp_crawl_gap_open
  on plm.dcp_crawl_gap (crawl_section_id)
  where resolved_at is null and waived_at is null;

comment on table plm.dcp_crawl_gap is
'One row per unresolved missing offset range or request failure within a crawl section. A '
'crawl CANNOT be finalized while any gap is neither resolved nor waived -- enforced by '
'plm.finalize_dcp_crawl. A waiver is a signed human decision: who, when and why, all three '
'or none. WAIVED_AT MUST BE PINNED TO MIDDAY UTC by its writer: this server runs '
'America/New_York, so a midnight-UTC approval timestamp read back through ::date reports '
'the PREVIOUS day, and two reports would then disagree about when a loss was accepted.';

-- -------------------------------------------------------------------------------------
-- 5.4 plm.dcp_asset_crawl -- snapshot membership + the frozen row hash (design 4.7)
-- -------------------------------------------------------------------------------------
create table plm.dcp_asset_crawl (
  crawl_id          uuid not null references plm.dcp_crawl(crawl_id) on delete cascade,
  dcp_asset_id      uuid not null references plm.dcp_asset(id) on delete restrict,
  observed_row_hash text not null,
  observed_at       timestamptz not null default now(),

  constraint dcp_asset_crawl_pkey primary key (crawl_id, dcp_asset_id),
  -- 64 lowercase hex. The shape is enforced so a truncated, uppercased or
  -- differently-encoded digest cannot enter the column and quietly compare unequal
  -- against every honest hash forever.
  constraint dcp_asset_crawl_hash_chk check (observed_row_hash ~ '^[0-9a-f]{64}$')
);

create index idx_dcp_asset_crawl_asset on plm.dcp_asset_crawl (dcp_asset_id);

comment on table plm.dcp_asset_crawl is
'Snapshot membership: this stable asset was present in this crawl. Carries the frozen '
'canonical row hash and NOTHING ELSE about the asset -- the asset''s fields live once, on '
'plm.dcp_asset, and are not copied per crawl. Comparing observed_row_hash across two crawls '
'is the ONLY change-detection mechanism in this schema. The hash comes from '
'plm.dcp_asset_row_hash and its serialization is FROZEN (see section 1 of migration '
'20260810190000): about 155,900 rows will carry it, and redefining the scheme invalidates '
'every stored hash and forces a full re-capture. It digests METADATA and is NOT a content '
'checksum.';

-- -------------------------------------------------------------------------------------
-- 5.5 plm.dcp_load_exception -- rejected and questionable rows (owner ruling 6)
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
create table plm.dcp_load_exception (
  id               uuid primary key default gen_random_uuid(),
  crawl_id         uuid not null references plm.dcp_crawl(crawl_id) on delete cascade,
  crawl_section_id uuid null references plm.dcp_crawl_section(id) on delete set null,
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

  constraint dcp_load_exception_severity_chk check (severity in ('rejected','warning')),
  constraint dcp_load_exception_reason_code_chk check (btrim(reason_code) <> ''),
  constraint dcp_load_exception_reason_chk      check (btrim(reason) <> ''),
  constraint dcp_load_exception_row_number_chk  check (row_number is null or row_number >= 1),
  constraint dcp_load_exception_chunk_chk       check (chunk_number is null or chunk_number >= 1),
  constraint dcp_load_exception_resolution_chk check (
    resolved_at is null or btrim(coalesce(resolution_note, '')) <> ''
  )
);

create index idx_dcp_load_exception_crawl on plm.dcp_load_exception (crawl_id, severity);
create index idx_dcp_load_exception_open
  on plm.dcp_load_exception (crawl_id) where resolved_at is null and severity = 'rejected';
create index idx_dcp_load_exception_reason_code on plm.dcp_load_exception (reason_code);

comment on table plm.dcp_load_exception is
'Every input row the loader could not land, and every advisory finding it raised. THE '
'DESIGN''S RULE, MADE STRUCTURAL: a malformed row is REJECTED INTO THIS TABLE, never '
'silently skipped -- if it does not land in the landing tables it lands here, and there is '
'no third outcome. severity = rejected means the row was not loaded; warning means it was '
'loaded but something about it is worth a human''s attention. reason_code is the stable '
'machine-readable classification the exception report groups on; reason is the human '
'sentence. raw_row holds the offending input verbatim and is therefore licensor-'
'confidential like every other table here. Unresolved rejections block finalization.';
comment on column plm.dcp_load_exception.reason_code is
'Stable machine-readable classification. The loader in 20260810190100 emits, among others: '
'blank folder path, conflicting guide source id, malformed boolean, unknown listing state, '
'a reserved separator in a hashed field, and two NON-IDENTICAL rows sharing one DAM path -- '
'the last being the case the duplicate collapse must never quietly merge.';

-- -------------------------------------------------------------------------------------
-- 5.6 plm.dcp_asset_tile_observation -- the many-to-many evidence table (design 4.8)
--
-- Replaces the pipe-separated tile list and the two listing booleans that the flat
-- extract carries on each file row. One row per proven (crawl, asset, tile, listing kind).
--
-- crawl_section_id IS NULLABLE BY DESIGN -- see DECISION 3 in the header. link_evidence
-- names the fidelity and the CHECK below binds the two so they can never disagree.
-- -------------------------------------------------------------------------------------
create table plm.dcp_asset_tile_observation (
  crawl_id         uuid not null references plm.dcp_crawl(crawl_id) on delete cascade,
  dcp_asset_id     uuid not null references plm.dcp_asset(id) on delete restrict,
  portal_tile_id   uuid not null references plm.dcp_portal_tile(id) on delete restrict,
  listing_kind     text not null,
  crawl_section_id uuid null references plm.dcp_crawl_section(id) on delete restrict,
  link_evidence    text not null,
  observed_at      timestamptz not null default now(),

  constraint dcp_asset_tile_observation_pkey
    primary key (crawl_id, dcp_asset_id, portal_tile_id, listing_kind),
  constraint dcp_asset_tile_observation_listing_kind_chk
    check (listing_kind in ('asset','style_guide')),
  constraint dcp_asset_tile_observation_link_evidence_chk
    check (link_evidence in ('section_query','aggregated_row')),
  -- THE BINDING. 'section_query' asserts a specific portal query proved this link, so the
  -- section id is REQUIRED. 'aggregated_row' asserts the link came from an already-
  -- aggregated extract row whose originating query was not preserved, so the section id
  -- MUST be NULL. Neither grade can borrow the other's appearance.
  constraint dcp_asset_tile_observation_evidence_binding_chk check (
    (link_evidence = 'section_query'  and crawl_section_id is not null)
    or
    (link_evidence = 'aggregated_row' and crawl_section_id is null)
  )
);

create index idx_dcp_asset_tile_obs_asset on plm.dcp_asset_tile_observation (dcp_asset_id);
create index idx_dcp_asset_tile_obs_tile
  on plm.dcp_asset_tile_observation (portal_tile_id, listing_kind);
create index idx_dcp_asset_tile_obs_section
  on plm.dcp_asset_tile_observation (crawl_section_id) where crawl_section_id is not null;

comment on table plm.dcp_asset_tile_observation is
'The many-to-many evidence table for file-to-portal-tile links, replacing the pipe-joined '
'tile list and the two listing booleans the flat extract carries per file row. One row per '
'proven (crawl, asset, tile, listing kind); an asset listed under eight tiles produces '
'EIGHT rows here and still exactly ONE row in plm.dcp_asset. '
'FIDELITY IS RECORDED IN THE DATA, not assumed: link_evidence = section_query means a '
'specific portal query proved the link and crawl_section_id names it; '
'link_evidence = aggregated_row means the link came from an already-aggregated extract row '
'whose originating query was NOT preserved and cannot be reconstructed, so crawl_section_id '
'is NULL. The CSV backfill is entirely aggregated_row. A consumer that needs proven '
'provenance filters on section_query. Inventing a synthetic section for the aggregated case '
'would have manufactured exactly the false precision the design forbids.';
comment on column plm.dcp_asset_tile_observation.listing_kind is
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
-- service_role but deliberately KEEPS INSERT. INSERT is therefore the ONE mutating
-- operation still available to the loader's role -- which makes it the one an
-- UPDATE/DELETE-only trigger would leave completely unguarded. The concrete hole: crawl X
-- finalizes, then a plain
--     insert into plm.dcp_asset_tile_observation (crawl_id, ...) values (X, ...);
-- adds a portal link that crawl never observed. No grant stops it and, without the INSERT
-- branch, no trigger fires either -- and the claim "a completed crawl's evidence is frozen"
-- would be false for the only operation anyone could still perform. The same hole exists
-- on dcp_asset_crawl, dcp_crawl_section, dcp_crawl_gap, dcp_load_exception and
-- dcp_chunk_ledger, so all six are covered.
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- 6.1 Crawl-scoped evidence: frozen entirely once its crawl is complete.
-- -------------------------------------------------------------------------------------
create or replace function plm.dcp_reject_completed_crawl_change()
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
  -- plm.dcp_crawl_gap is the one attached table that has NO crawl_id column -- it hangs
  -- off a section, not off the crawl -- so reading new.crawl_id there would raise "record
  -- new has no field crawl_id" at runtime, on every write, while the migration itself
  -- applied perfectly clean. It is resolved through its section instead. A generic
  -- `record.crawl_id` read would have been a guard that only fails when it is used.
  if tg_table_name = 'dcp_crawl_gap' then
    select s.crawl_id into v_crawl
    from plm.dcp_crawl_section s
    where s.id = (case when tg_op = 'DELETE' then old.crawl_section_id
                       else new.crawl_section_id end);
  elsif tg_op = 'DELETE' then
    v_crawl := old.crawl_id;
  else
    v_crawl := new.crawl_id;
  end if;

  select c.status into v_status from plm.dcp_crawl c where c.crawl_id = v_crawl;

  if v_status = 'complete' then
    raise exception
      'DCP Vault crawl % is COMPLETE and its evidence is immutable; % on %.% is refused. A '
      'refresh is a NEW crawl_id, never an edit of an old one -- editing completed evidence '
      'destroys the only record of what the portal actually said.',
      v_crawl, tg_op, tg_table_schema, tg_table_name
      using errcode = 'P0001';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

comment on function plm.dcp_reject_completed_crawl_change() is
'Row trigger freezing every CRAWL-SCOPED plm.dcp_* table once its owning crawl reaches '
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
  -- plm.dcp_load_exception is deliberately NOT in this list. It gets the narrower
  -- plm.dcp_load_exception_freeze below, because its resolution columns must stay
  -- writable after completion -- see the note there.
  foreach t in array array[
    'dcp_crawl_section','dcp_crawl_gap','dcp_asset_crawl',
    'dcp_asset_tile_observation'
  ]
  loop
    execute format(
      'create trigger %I before insert or update or delete on plm.%I '
      'for each row execute function plm.dcp_reject_completed_crawl_change()',
      'trg_' || t || '_immutable', t);
  end loop;
end;
$$;

-- -------------------------------------------------------------------------------------
-- 6.1b plm.dcp_load_exception -- frozen against INSERT and DELETE, but a human may still
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
create or replace function plm.dcp_load_exception_freeze()
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

  select c.status into v_status from plm.dcp_crawl c where c.crawl_id = v_crawl;

  if v_status is distinct from 'complete' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'INSERT' then
    raise exception 'DCP Vault crawl % is COMPLETE; a new load exception may not be added '
      'to it. An exception recorded after the fact is a finding the crawl never produced.',
      v_crawl using errcode = 'P0001';
  end if;

  if tg_op = 'DELETE' then
    raise exception 'DCP Vault crawl % is COMPLETE; its load exceptions may not be deleted. '
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
    raise exception 'DCP Vault crawl % is COMPLETE: the source fields of a load exception '
      'are immutable. Only resolved_at and resolution_note may change, so a human can still '
      'triage a warning after the crawl finished.', v_crawl using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create trigger trg_dcp_load_exception_immutable
  before insert or update or delete on plm.dcp_load_exception
  for each row execute function plm.dcp_load_exception_freeze();

comment on function plm.dcp_load_exception_freeze() is
'Narrower freeze for plm.dcp_load_exception. Once the owning crawl is complete: INSERT is '
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
-- plm.dcp_portal_tile, plm.dcp_style_guide and plm.dcp_asset outlive any single crawl.
-- Design section 7: deleting an unpromoted crawl must remove its observations but NOT the
-- stable identities other crawls use. So these three are NOT frozen wholesale.
--
-- What freezes: the SOURCE columns, once the row has been observed by any COMPLETE crawl.
-- What stays editable, forever: last_seen_crawl_id (a later crawl re-observing the same
-- row is normal), updated_at, and the reconciliation columns -- those are OUR decisions,
-- made after the fact, and are the entire reason these tables have them.
-- DELETE is refused outright once a complete crawl has seen the row.
-- -------------------------------------------------------------------------------------
create or replace function plm.dcp_reject_completed_source_field_change()
returns trigger
language plpgsql
as $$
declare
  v_seen boolean;
begin
  -- "Has any COMPLETE crawl observed this row?" is answered per table, from the evidence
  -- tables, not from a flag on the row -- a flag would have to be maintained and could
  -- drift out of agreement with the evidence it claims to summarise.
  if tg_table_name = 'dcp_asset' then
    select exists (
      select 1 from plm.dcp_asset_crawl ac
      join plm.dcp_crawl c on c.crawl_id = ac.crawl_id
      where ac.dcp_asset_id = old.id and c.status = 'complete'
    ) into v_seen;
  elsif tg_table_name = 'dcp_style_guide' then
    select exists (
      select 1 from plm.dcp_asset a
      join plm.dcp_asset_crawl ac on ac.dcp_asset_id = a.id
      join plm.dcp_crawl c on c.crawl_id = ac.crawl_id
      where a.style_guide_id = old.id and c.status = 'complete'
    ) into v_seen;
  elsif tg_table_name = 'dcp_portal_tile' then
    select exists (
      select 1 from plm.dcp_asset_tile_observation o
      join plm.dcp_crawl c on c.crawl_id = o.crawl_id
      where o.portal_tile_id = old.id and c.status = 'complete'
    ) into v_seen;
  else
    -- An unknown table means this trigger was attached somewhere it was not designed for.
    -- FAIL LOUDLY. Returning NEW here would install a guard that silently permits
    -- everything on the new table, which is worse than no guard at all.
    raise exception 'plm.dcp_reject_completed_source_field_change is attached to %.% which '
      'it does not know how to evaluate. Extend the function before attaching it.',
      tg_table_schema, tg_table_name using errcode = 'P0001';
  end if;

  if not v_seen then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    raise exception 'DCP Vault: %.% row % has been observed by a COMPLETE crawl and may not '
      'be deleted. Stable source identities are permanent evidence.',
      tg_table_schema, tg_table_name, old.id using errcode = 'P0001';
  end if;

  if tg_table_name = 'dcp_asset' then
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
      raise exception 'DCP Vault: source fields of plm.dcp_asset row % are immutable once a '
        'COMPLETE crawl has observed it. Every stored row hash was computed from these '
        'exact values; changing one silently invalidates its change detection. Only '
        'last_seen_crawl_id and updated_at may change.', old.id using errcode = 'P0001';
    end if;

  elsif tg_table_name = 'dcp_style_guide' then
    if new.source_system       is distinct from old.source_system
    or new.source_path         is distinct from old.source_path
    or new.source_guide_id     is distinct from old.source_guide_id
    or new.folder_name         is distinct from old.folder_name
    or new.region              is distinct from old.region
    or new.year_segment        is distinct from old.year_segment
    or new.parent_source_path  is distinct from old.parent_source_path
    or new.first_seen_crawl_id is distinct from old.first_seen_crawl_id
    or new.raw                 is distinct from old.raw then
      raise exception 'DCP Vault: source fields of plm.dcp_style_guide row % are immutable '
        'once a COMPLETE crawl has observed it. Only last_seen_crawl_id, updated_at and the '
        'reconciliation columns may change.', old.id using errcode = 'P0001';
    end if;

  elsif tg_table_name = 'dcp_portal_tile' then
    if new.source_system       is distinct from old.source_system
    or new.source_key          is distinct from old.source_key
    or new.display_label       is distinct from old.display_label
    or new.source_url          is distinct from old.source_url
    or new.first_seen_crawl_id is distinct from old.first_seen_crawl_id
    or new.raw                 is distinct from old.raw then
      raise exception 'DCP Vault: source fields of plm.dcp_portal_tile row % are immutable '
        'once a COMPLETE crawl has observed it. Only last_seen_crawl_id, updated_at and the '
        'reconciliation columns may change.', old.id using errcode = 'P0001';
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

comment on function plm.dcp_reject_completed_source_field_change() is
'Narrower immutability trigger for the three STABLE IDENTITY tables, which outlive any one '
'crawl and therefore must not freeze wholesale. Once a COMPLETE crawl has observed a row -- '
'a fact read from the evidence tables, never from a maintainable flag that could drift -- '
'its SOURCE columns freeze and DELETE is refused, while last_seen_crawl_id, updated_at and '
'the reconciliation columns (core_property_id / core_style_guide_id and resolution_*) stay '
'editable, because reconciliation is OUR later decision and not source data. Attached to an '
'unknown table it RAISES rather than returning NEW: a guard that silently permits '
'everything is worse than no guard.';

create trigger trg_dcp_asset_source_immutable
  before update or delete on plm.dcp_asset
  for each row execute function plm.dcp_reject_completed_source_field_change();
create trigger trg_dcp_style_guide_source_immutable
  before update or delete on plm.dcp_style_guide
  for each row execute function plm.dcp_reject_completed_source_field_change();
create trigger trg_dcp_portal_tile_source_immutable
  before update or delete on plm.dcp_portal_tile
  for each row execute function plm.dcp_reject_completed_source_field_change();

-- -------------------------------------------------------------------------------------
-- 6.3 The crawl header itself.
--
-- Adapted from plm.pmt_capture_freeze. finalize's own UPDATE runs while the row is still
-- 'running', so it passes; once complete, nothing may change and the row may not be
-- deleted. Blocking the DELETE here also stops the ON DELETE CASCADE from ever reaching a
-- completed crawl's evidence.
-- -------------------------------------------------------------------------------------
create or replace function plm.dcp_crawl_freeze()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'complete' then
      raise exception 'DCP Vault crawl % is COMPLETE and may not be deleted. Completed '
        'crawls are retained permanently, and deleting one would cascade away the evidence '
        'of what the portal said.', old.crawl_id using errcode = 'P0001';
    end if;
    return old;
  end if;

  if old.status = 'complete' then
    raise exception 'DCP Vault crawl % is COMPLETE and immutable. A refresh is a NEW crawl, '
      'never an edit of a completed one.', old.crawl_id using errcode = 'P0001';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create trigger trg_dcp_crawl_freeze
  before update or delete on plm.dcp_crawl
  for each row execute function plm.dcp_crawl_freeze();

comment on function plm.dcp_crawl_freeze() is
'Freezes a COMPLETE plm.dcp_crawl row against UPDATE and DELETE, and maintains updated_at '
'while the crawl is still in flight. Refusing the DELETE also stops ON DELETE CASCADE from '
'ever reaching a completed crawl''s sections, gaps, memberships, tile observations and '
'exceptions. plm.finalize_dcp_crawl''s own UPDATE runs while the row is still running, so '
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
--   service_role keeps SELECT and INSERT; UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
--   and MAINTAIN are revoked. public and anon get `revoke all`.
--   INSERT is kept deliberately: the 20260810190100 loader functions are SECURITY DEFINER
--   and never consume service_role's table grants, but the loader's own INSERT path and
--   the exception table are exercised by service_role in the apply lane, and Warner's
--   shipped posture is the pattern this ruling names. It is the MUTATING bits -- above all
--   TRUNCATE -- that the immutability design cannot survive.
-- =====================================================================================
do $$
declare t text;
begin
  foreach t in array array[
    'dcp_crawl','dcp_portal_tile','dcp_style_guide','dcp_asset',
    'dcp_crawl_section','dcp_crawl_gap','dcp_asset_crawl',
    'dcp_asset_tile_observation','dcp_load_exception'
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
    'dcp_crawl','dcp_portal_tile','dcp_style_guide','dcp_asset',
    'dcp_crawl_section','dcp_crawl_gap','dcp_asset_crawl',
    'dcp_asset_tile_observation','dcp_load_exception'
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
