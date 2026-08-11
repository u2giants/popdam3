-- =====================================================================================
-- Paramount Creative Library landing -- LOSSLESS CORRECTION
--
-- Migration: 20260811030000_pmt_lossless_source_ids_and_asset_metadata_value.sql
-- Issues:    #724 (lossless landing), #623 (Paramount creative library landing)
-- Claim:     #744
-- Builds on: 20260810020000_pmt_creative_library_landing.sql        (creates everything)
--            20260810090000_pmt_loader_target_guard_and_truncate_revoke.sql (guard + revokes)
--
-- Neither of those two files is edited. This migration is purely additive/corrective, as
-- AGENTS.md requires, because either may already be applied somewhere.
--
-- -------------------------------------------------------------------------------------
-- WHAT THIS FIXES, AND WHY IT IS NOT COSMETIC
--
-- FIX 1 -- SOURCE IDS ARE IDENTITIES, NOT QUANTITIES.
-- Paramount's Property, Franchise, Character, Collection and Brand IDs were landed as
-- `bigint`. They look numeric today, but they are opaque source identifiers. Storing an
-- identifier as a number silently destroys information the moment the source emits a
-- leading zero ('007' and '7' become the same row) or a value beyond 2^53 (the loader's
-- JavaScript `Number()` rounds it before PostgreSQL ever sees it). Neither failure raises
-- an error; both produce a wrong row that looks right. This migration converts all 20 such
-- columns to `text` and pins the current source format with a CHECK, so a future value that
-- does not match is REFUSED loudly rather than silently mangled.
--
-- HONEST NOTE ON WHAT THIS CAN AND CANNOT RECOVER (spec section 8.1 requires this be
-- written down): converting bigint -> text preserves whatever is already stored. It cannot
-- resurrect a leading zero that a previous load already discarded. Measured against the
-- private capture on 2026-08-11, every Paramount entity source ID is 3-8 digits, purely
-- `^[0-9]+$`, with NO leading zeroes and none anywhere near 2^53 -- so for the data captured
-- so far the conversion is information-preserving and the risk this closes is PROSPECTIVE.
-- The correct clean-slate load still comes from a fresh capture through the fixed loader.
--
-- FIX 2 -- REPEATED METADATA WAS BEING THROWN AWAY.
-- The landing tables flatten each asset's metadata into five de-duplicated link tables.
-- That is relationally correct and it is LOSSY: the source hands back an ORDERED array of
-- values per metadata element (up to 12 observed on one asset), each carrying BOTH a machine
-- `raw_value` AND a human `display_value`, and sometimes a nested element decomposition.
-- Order, the raw/display distinction, the nested decomposition, and any element that is not
-- one of the five modelled relationships are all discarded today. plm.pmt_asset_metadata_value
-- keeps every one of them, one row per value, ordinal preserved.
--
-- The `raw jsonb` columns on the entity/asset tables are left ALONE and remain empty. They
-- are NOT quietly repurposed: section 8.3 of the spec forbids keeping a field that appears
-- to promise lossless retention while sitting empty, and the honest resolution here is that
-- pmt_asset_metadata_value IS the durable lossless store. See the comment on that table.
--
-- WHAT THIS MIGRATION DOES NOT DO (scope limits, spec section 11): it does not promote any
-- Paramount row into core.*, does not resolve canonical matches, does not create a direct
-- property->franchise relationship (the co-occurrence table keeps its two pinning CHECKs
-- untouched), does not delete or rewrite any capture, and does not touch any other licensor.
-- =====================================================================================

-- =====================================================================================
-- SECTION 1. Drop the API views that read the columns about to change type.
--
-- ALTER TYPE cannot run through a dependent view, so these five come down and go back up
-- byte-identically at the end of this file except for the column types they inherit. The
-- other three api.pmt_* views (pmt_latest_capture, pmt_authorized_title_summary,
-- pmt_capture_health) touch NO source-ID column and are deliberately left in place -- a
-- needless drop/recreate is a chance to change permissions by accident, which is one of the
-- named risks in the spec.
-- =====================================================================================
drop view if exists api.pmt_property_franchise_evidence;
drop view if exists api.pmt_characters;
drop view if exists api.pmt_properties;
drop view if exists api.pmt_style_guides;
drop view if exists api.pmt_assets;

-- =====================================================================================
-- SECTION 2. Drop the capture-scoped composite foreign keys that span these columns.
--
-- Both sides of every one of these FKs changes type, so the constraint must come down
-- first and be rebuilt afterwards. Named explicitly -- no dynamic discovery -- so that a
-- constraint renamed upstream fails this migration loudly instead of being skipped.
-- =====================================================================================
alter table plm.pmt_authorized_title_property
  drop constraint pmt_authorized_title_property_property_fkey;
alter table plm.pmt_asset_property           drop constraint pmt_asset_property_property_fkey;
alter table plm.pmt_asset_franchise          drop constraint pmt_asset_franchise_franchise_fkey;
alter table plm.pmt_asset_character          drop constraint pmt_asset_character_character_fkey;
alter table plm.pmt_asset_collection         drop constraint pmt_asset_collection_collection_fkey;
alter table plm.pmt_asset_brand              drop constraint pmt_asset_brand_brand_fkey;
alter table plm.pmt_property_character       drop constraint pmt_property_character_property_fkey;
alter table plm.pmt_property_character       drop constraint pmt_property_character_character_fkey;
alter table plm.pmt_property_collection      drop constraint pmt_property_collection_property_fkey;
alter table plm.pmt_property_collection      drop constraint pmt_property_collection_collection_fkey;
alter table plm.pmt_property_franchise_evidence drop constraint pmt_pfe_property_fkey;
alter table plm.pmt_property_franchise_evidence drop constraint pmt_pfe_franchise_fkey;
alter table plm.pmt_authorized_property_asset   drop constraint pmt_apa_property_fkey;
alter table plm.pmt_property_capture_log        drop constraint pmt_pcl_property_fkey;

-- =====================================================================================
-- SECTION 3. bigint -> text, on every Paramount ENTITY SOURCE ID and nowhere else.
--
-- The `using col::text` conversion is exact for every value bigint can hold. Primary keys
-- and indexes over these columns are rebuilt automatically by PostgreSQL and keep their
-- names, so the capture-scoped key design of 20260810020000 is preserved unchanged.
--
-- DELIBERATELY NOT CONVERTED, because these are REAL QUANTITIES and must stay numeric:
--   pmt_capture_expectation.expected_count   pmt_asset.content_size_bytes
--   pmt_relationship_anomaly.anomaly_id      pmt_shrink_override.override_id/old_count/new_count
-- Converting a count to text would break every comparison that reconciles a capture.
-- =====================================================================================
alter table plm.pmt_property                 alter column property_source_id          type text using property_source_id::text;
alter table plm.pmt_franchise                alter column franchise_source_id         type text using franchise_source_id::text;
alter table plm.pmt_character                alter column character_source_id         type text using character_source_id::text;
alter table plm.pmt_collection               alter column collection_source_id        type text using collection_source_id::text;
alter table plm.pmt_brand                    alter column brand_source_id             type text using brand_source_id::text;

alter table plm.pmt_authorized_title_property alter column property_source_id         type text using property_source_id::text;
alter table plm.pmt_asset_property           alter column property_source_id          type text using property_source_id::text;
alter table plm.pmt_asset_franchise          alter column franchise_source_id         type text using franchise_source_id::text;
alter table plm.pmt_asset_character          alter column character_source_id         type text using character_source_id::text;
alter table plm.pmt_asset_collection         alter column collection_source_id        type text using collection_source_id::text;
alter table plm.pmt_asset_brand              alter column brand_source_id             type text using brand_source_id::text;

alter table plm.pmt_property_character       alter column property_source_id          type text using property_source_id::text;
alter table plm.pmt_property_character       alter column character_source_id         type text using character_source_id::text;
alter table plm.pmt_property_collection      alter column property_source_id          type text using property_source_id::text;
alter table plm.pmt_property_collection      alter column collection_source_id        type text using collection_source_id::text;
alter table plm.pmt_property_franchise_evidence alter column property_source_id       type text using property_source_id::text;
alter table plm.pmt_property_franchise_evidence alter column franchise_source_id      type text using franchise_source_id::text;

alter table plm.pmt_authorized_property_asset alter column licensed_property_source_id type text using licensed_property_source_id::text;
alter table plm.pmt_property_capture_log      alter column property_source_id          type text using property_source_id::text;

-- =====================================================================================
-- SECTION 4. Pin the source format.
--
-- `^[0-9]+$` is the format PROVEN against the private capture on 2026-08-11: 60 properties,
-- 18 franchises, 52 characters, 426 collections, 7 brands -- every source ID 3 to 8 digits,
-- all `^[0-9]+$`, none with a leading zero. The CHECK is a tripwire, not a belief: if
-- Paramount ever emits an alphanumeric ID the load FAILS LOUDLY here instead of writing a
-- value nobody validated. Widening it is then a reviewed migration, which is the point.
--
-- These CHECKs are on the *entity* identity columns only. They are deliberately NOT applied
-- to plm.pmt_asset_metadata_value.source_value, which legitimately carries non-numeric
-- values (names, brand strings) -- 36,438 of the 150,430 captured values are not `^[0-9]+$`.
--
-- NOTE the checks are written against the TEXT value directly. There is no cast to a numeric
-- type anywhere in this migration's validation: casting to validate would reintroduce exactly
-- the precision loss this migration exists to remove.
-- =====================================================================================
do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('pmt_property',                  'property_source_id',          'pmt_property_source_id_fmt_chk'),
      ('pmt_franchise',                 'franchise_source_id',         'pmt_franchise_source_id_fmt_chk'),
      ('pmt_character',                 'character_source_id',         'pmt_character_source_id_fmt_chk'),
      ('pmt_collection',                'collection_source_id',        'pmt_collection_source_id_fmt_chk'),
      ('pmt_brand',                     'brand_source_id',             'pmt_brand_source_id_fmt_chk'),
      ('pmt_authorized_title_property', 'property_source_id',          'pmt_atp_property_source_id_fmt_chk'),
      ('pmt_asset_property',            'property_source_id',          'pmt_asset_property_source_id_fmt_chk'),
      ('pmt_asset_franchise',           'franchise_source_id',         'pmt_asset_franchise_source_id_fmt_chk'),
      ('pmt_asset_character',           'character_source_id',         'pmt_asset_character_source_id_fmt_chk'),
      ('pmt_asset_collection',          'collection_source_id',        'pmt_asset_collection_source_id_fmt_chk'),
      ('pmt_asset_brand',               'brand_source_id',             'pmt_asset_brand_source_id_fmt_chk'),
      ('pmt_property_character',        'property_source_id',          'pmt_pch_property_source_id_fmt_chk'),
      ('pmt_property_character',        'character_source_id',         'pmt_pch_character_source_id_fmt_chk'),
      ('pmt_property_collection',       'property_source_id',          'pmt_pcol_property_source_id_fmt_chk'),
      ('pmt_property_collection',       'collection_source_id',        'pmt_pcol_collection_source_id_fmt_chk'),
      ('pmt_property_franchise_evidence','property_source_id',         'pmt_pfe_property_source_id_fmt_chk'),
      ('pmt_property_franchise_evidence','franchise_source_id',        'pmt_pfe_franchise_source_id_fmt_chk'),
      ('pmt_authorized_property_asset', 'licensed_property_source_id', 'pmt_apa_property_source_id_fmt_chk'),
      ('pmt_property_capture_log',      'property_source_id',          'pmt_pcl_property_source_id_fmt_chk')
    ) as v(tbl, col, cons)
  loop
    execute format(
      'alter table plm.%I add constraint %I check (%I ~ ''^[0-9]+$'')',
      r.tbl, r.cons, r.col);
  end loop;
end;
$$;

-- =====================================================================================
-- SECTION 5. Rebuild the capture-scoped composite foreign keys, unchanged in meaning.
--
-- Every one is still (capture_id, <source_id>) -> the same parent, still ON DELETE RESTRICT.
-- These are what make an orphan link impossible: a relationship row whose endpoint is not in
-- the SAME capture is rejected by the database, not by the loader's good intentions.
-- =====================================================================================
alter table plm.pmt_authorized_title_property
  add constraint pmt_authorized_title_property_property_fkey
  foreign key (capture_id, property_source_id)
  references plm.pmt_property(capture_id, property_source_id) on delete restrict;

alter table plm.pmt_asset_property
  add constraint pmt_asset_property_property_fkey
  foreign key (capture_id, property_source_id)
  references plm.pmt_property(capture_id, property_source_id) on delete restrict;

alter table plm.pmt_asset_franchise
  add constraint pmt_asset_franchise_franchise_fkey
  foreign key (capture_id, franchise_source_id)
  references plm.pmt_franchise(capture_id, franchise_source_id) on delete restrict;

alter table plm.pmt_asset_character
  add constraint pmt_asset_character_character_fkey
  foreign key (capture_id, character_source_id)
  references plm.pmt_character(capture_id, character_source_id) on delete restrict;

alter table plm.pmt_asset_collection
  add constraint pmt_asset_collection_collection_fkey
  foreign key (capture_id, collection_source_id)
  references plm.pmt_collection(capture_id, collection_source_id) on delete restrict;

alter table plm.pmt_asset_brand
  add constraint pmt_asset_brand_brand_fkey
  foreign key (capture_id, brand_source_id)
  references plm.pmt_brand(capture_id, brand_source_id) on delete restrict;

alter table plm.pmt_property_character
  add constraint pmt_property_character_property_fkey
  foreign key (capture_id, property_source_id)
  references plm.pmt_property(capture_id, property_source_id) on delete restrict;

alter table plm.pmt_property_character
  add constraint pmt_property_character_character_fkey
  foreign key (capture_id, character_source_id)
  references plm.pmt_character(capture_id, character_source_id) on delete restrict;

alter table plm.pmt_property_collection
  add constraint pmt_property_collection_property_fkey
  foreign key (capture_id, property_source_id)
  references plm.pmt_property(capture_id, property_source_id) on delete restrict;

alter table plm.pmt_property_collection
  add constraint pmt_property_collection_collection_fkey
  foreign key (capture_id, collection_source_id)
  references plm.pmt_collection(capture_id, collection_source_id) on delete restrict;

alter table plm.pmt_property_franchise_evidence
  add constraint pmt_pfe_property_fkey
  foreign key (capture_id, property_source_id)
  references plm.pmt_property(capture_id, property_source_id) on delete restrict;

alter table plm.pmt_property_franchise_evidence
  add constraint pmt_pfe_franchise_fkey
  foreign key (capture_id, franchise_source_id)
  references plm.pmt_franchise(capture_id, franchise_source_id) on delete restrict;

alter table plm.pmt_authorized_property_asset
  add constraint pmt_apa_property_fkey
  foreign key (capture_id, licensed_property_source_id)
  references plm.pmt_property(capture_id, property_source_id) on delete restrict;

alter table plm.pmt_property_capture_log
  add constraint pmt_pcl_property_fkey
  foreign key (capture_id, property_source_id)
  references plm.pmt_property(capture_id, property_source_id) on delete restrict;

-- =====================================================================================
-- SECTION 6. plm.pmt_asset_metadata_value -- the lossless repeated-metadata store
--
-- ONE ROW PER METADATA VALUE. Not one column per heading (the heading set grows, and this
-- design must absorb a new one WITHOUT a migration), and not a comma-joined string (which
-- destroys order and cannot represent a value containing a comma).
--
-- PROVEN SOURCE SHAPE, measured 2026-08-11 over 258 private metadata batches / 25,790
-- assets / 150,430 values, structure only, no row contents read into any log:
--
--   record.fields = {
--     "<METADATA_ELEMENT_ID>": [                 <- ORDERED array, up to 12 entries observed
--       { "raw_value":     <string|number>,      <- the machine value
--         "display_value": <string>,             <- the human value
--         "elements":      [ {key, source_id, display_value}, ... ]   <- 0 or 2 entries
--       }, ...
--     ], ...
--   }
--
-- The array index IS `value_ordinal`. Two values that render the same string but sit at
-- different ordinals, or arrive under different element IDs, are DIFFERENT ROWS -- spec
-- section 7 forbids de-duplicating by display name.
--
-- WHY `data_type` MATTERS MORE THAN IT LOOKS. `raw_value` arrives as a JSON *number* for
-- one element (FRANCHISE_ID, 25,116 of the 150,430 values) and as a JSON *string* for the
-- other 125,314. That distinction is itself a source fact, and it is the fingerprint of the
-- precision hazard this whole migration is about. `data_type` records which one it was, so
-- a later reader can tell "the source said 1234" from "the source said '1234'". `source_value`
-- always stores the TEXT form so nothing is re-parsed on the way in.
--
-- COLUMNS THAT ARE NULL FOR THIS CAPTURE AND ARE STILL HERE ON PURPOSE:
-- metadata_element_name, metadata_category_id, metadata_category_name, domain_id,
-- source_table_name, source_column_name, language. Paramount's current full-metadata
-- response does not carry them. They exist so a richer future response lands WITHOUT a
-- schema change, which is requirement "new metadata fields can arrive without another
-- schema redesign". They are nullable, never defaulted to a placeholder: a missing value
-- stays missing and must never become the string 'undefined'.
-- =====================================================================================
create table plm.pmt_asset_metadata_value (
  capture_id             uuid not null references plm.pmt_capture(capture_id) on delete restrict,
  asset_id               text not null,

  -- The fully-qualified source field key exactly as Paramount emits it, e.g. 'CHARACTER_ID'
  -- or 'CUSTOM.CP_CREATIVE_LIBRARY.COLLECTION_DATA_ID'. Because the key is already fully
  -- qualified (it embeds the custom table and column), one element cannot arrive twice by
  -- two different source paths, which is why the primary key below does not need to widen
  -- to include source_table_name / source_column_name. If Paramount ever splits these into
  -- separate qualifier fields, THAT is when the key widens -- in a new reviewed migration.
  metadata_element_id    text not null,
  metadata_element_name  text null,
  metadata_category_id   text null,
  metadata_category_name text null,
  domain_id              text null,
  source_table_name      text null,
  source_column_name     text null,

  -- The JSON type the source used for raw_value: 'string' or 'number'. See the note above.
  data_type              text null,

  -- Position within the source's ordered array for this element. 0-based, dense.
  value_ordinal          integer not null,

  source_value           text null,
  display_value          text null,
  language               text null,

  -- Where this value sat in the response, e.g. 'fields.CHARACTER_ID[2]'. Diagnostics only.
  source_path            text null,

  -- COMPACT and SAFE. Holds the nested `elements` decomposition and nothing else. It must
  -- NEVER hold a rendition body, thumbnail, preview, download path, signed URL, cookie,
  -- request header, credential or media bytes -- spec section 8.3, enforced by the builder
  -- and by the CHECK below.
  raw_value              jsonb null,

  source_hash            text not null,
  imported_at            timestamptz not null default now(),

  constraint pmt_asset_metadata_value_pkey
    primary key (capture_id, asset_id, metadata_element_id, value_ordinal),

  -- Capture-scoped composite FK. A metadata row for an asset that is not in the SAME
  -- capture is impossible, at the database, not in loader code.
  constraint pmt_amv_asset_fkey foreign key (capture_id, asset_id)
    references plm.pmt_asset(capture_id, asset_id) on delete restrict,

  constraint pmt_amv_element_id_chk check (btrim(metadata_element_id) <> ''),
  constraint pmt_amv_ordinal_chk    check (value_ordinal >= 0),
  constraint pmt_amv_data_type_chk  check (data_type is null or data_type in ('string','number','boolean')),
  constraint pmt_amv_source_hash_chk check (btrim(source_hash) <> ''),

  -- A value row that carries NEITHER a machine value nor a display value is not a value.
  -- Silently accepting it would let a broken builder report a full population of nothing.
  constraint pmt_amv_has_a_value_chk check (source_value is not null or display_value is not null),

  -- 'undefined' is what JavaScript prints when a field was absent. It is never a real
  -- Paramount value, and letting it in would turn a missing value into a present one.
  constraint pmt_amv_not_undefined_chk check (
    coalesce(source_value, '') <> 'undefined' and coalesce(display_value, '') <> 'undefined'
  ),

  -- raw_value is a small structured object, never a whole portal response. Anything with a
  -- URL/credential-shaped key is refused outright rather than trusted to the builder alone.
  constraint pmt_amv_raw_value_shape_chk check (
    raw_value is null or (
      jsonb_typeof(raw_value) = 'object'
      and not (raw_value ?| array[
        'url','href','uri','download_url','downloadUrl','preview','previewUrl','thumbnail',
        'thumbnailUrl','rendition','renditions','content','contentUrl','bytes','data',
        'cookie','cookies','authorization','Authorization','token','access_token','headers'
      ])
    )
  )
);

comment on table plm.pmt_asset_metadata_value is
'THE LOSSLESS STORE for Paramount asset metadata. One row per metadata VALUE, not per '
'field: the source returns an ORDERED array per element and value_ordinal preserves that '
'order exactly. Both the machine value (source_value) and the human value (display_value) '
'are kept, separately, because they are different facts. Two values are NEVER merged by '
'display name -- equal display text under different metadata_element_ids, or at different '
'ordinals, are different rows on purpose. Unknown future metadata elements land here with '
'no schema change at all, which is the whole reason this table is shaped this way instead '
'of one column per heading. THIS TABLE, not the entity-level `raw` jsonb columns, is where '
'lossless retention actually lives: those `raw` columns remain empty and make no such '
'promise. CONFIDENTIAL LICENSOR DATA -- never commit a row to this PUBLIC repository.';

comment on column plm.pmt_asset_metadata_value.metadata_element_id is
'Fully-qualified source field key exactly as Paramount emits it. Already embeds any custom '
'table/column qualifier, which is why it alone (plus ordinal) keys a value uniquely.';
comment on column plm.pmt_asset_metadata_value.value_ordinal is
'0-based position in the source''s ordered array for this element. Preserves source order, '
'which a set-valued link table destroys.';
comment on column plm.pmt_asset_metadata_value.data_type is
'The JSON type the source used for the raw value: string or number. Recorded because the '
'source emits FRANCHISE_ID as a bare JSON number and the rest as strings, and that '
'difference is exactly where numeric precision loss enters. Never used to re-parse.';
comment on column plm.pmt_asset_metadata_value.raw_value is
'COMPACT SAFE remainder only -- the nested element decomposition. Never a full portal '
'response, never media, URLs, headers or credentials; a CHECK refuses those key names. '
'Not exposed to ordinary application roles.';

create index idx_pmt_amv_asset    on plm.pmt_asset_metadata_value (capture_id, asset_id);
create index idx_pmt_amv_element  on plm.pmt_asset_metadata_value (capture_id, metadata_element_id);
create index idx_pmt_amv_capture  on plm.pmt_asset_metadata_value (capture_id);
-- Display-value filtering is a real consumer pattern ("which assets are tagged X"), but the
-- column is wide and mostly low-cardinality, so the index is scoped to (element, display)
-- rather than display alone -- a bare display index would be chosen for the wrong queries.
create index idx_pmt_amv_element_display
  on plm.pmt_asset_metadata_value (capture_id, metadata_element_id, display_value);

-- =====================================================================================
-- SECTION 7. Security for the new table -- SET EXPLICITLY, NOT INHERITED.
--
-- 20260810020000 (RLS + policies + grants) and 20260810090000 / 20260810180000 (TRUNCATE,
-- REFERENCES, TRIGGER and PostgreSQL 17 MAINTAIN revokes) all iterate a HARD-CODED list of
-- table names. A table created after them is NOT covered by any of them. On top of that,
-- `alter default privileges in schema plm ... grant all on tables to service_role` means
-- this brand-new table is handed ALL to service_role at CREATE TABLE time unless revoked
-- here. So every rule is restated for this one table, deliberately and in full.
--
-- Posture, identical to its 23 sibling landing tables:
--   anon / public : NOTHING.
--   authenticated : SELECT, and only for the four approved app roles, via RLS policy.
--                   No DML grant at all, so a policy alone can never let them write.
--   service_role  : SELECT/INSERT/UPDATE/DELETE + a policy (a GRANT is not a policy and a
--                   policy is not a GRANT -- AGENTS.md section 11), but explicitly NOT
--                   TRUNCATE / REFERENCES / TRIGGER / MAINTAIN. Those are the bits that let
--                   a caller go around the guarded loader and its triggers.
--
-- `enable`, not `force`, row level security -- matching every sibling table. FORCE would
-- subject the SECURITY DEFINER loader (running as postgres, which matches no policy) to
-- these policies and silently filter every INSERT to zero rows. That failure mode is
-- documented at length in 20260810020000 section 25 and must not be reintroduced here.
-- =====================================================================================
alter table plm.pmt_asset_metadata_value enable row level security;

create policy pmt_asset_metadata_value_read on plm.pmt_asset_metadata_value
  for select to authenticated
  using (app.has_any_role(array['administrator','sales','licensing','designer']::app.app_role[]));

create policy pmt_asset_metadata_value_service on plm.pmt_asset_metadata_value
  for all to service_role using (true) with check (true);

revoke all on plm.pmt_asset_metadata_value from public;
revoke all on plm.pmt_asset_metadata_value from anon;
grant select on plm.pmt_asset_metadata_value to authenticated;
grant select, insert, update, delete on plm.pmt_asset_metadata_value to service_role;
revoke truncate, references, trigger, maintain on plm.pmt_asset_metadata_value from service_role;

-- Proof, not intention. If any DDL-adjacent or TRUNCATE bit survived on service_role, or if
-- anon or PUBLIC hold anything at all, this migration FAILS here rather than shipping a hole.
do $$
declare
  p    text;
  v_bad text := '';
begin
  foreach p in array array['TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] loop
    if has_table_privilege('service_role', 'plm.pmt_asset_metadata_value', p) then
      v_bad := v_bad || p || ' ';
    end if;
  end loop;
  if v_bad <> '' then
    raise exception 'pmt_asset_metadata_value SECURITY FAILED: service_role still holds: %. '
      'These bits allow bypassing the guarded loader and its capture-freeze triggers.', v_bad
      using errcode = 'P0001';
  end if;

  foreach p in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] loop
    if has_table_privilege('anon', 'plm.pmt_asset_metadata_value', p) then
      raise exception 'pmt_asset_metadata_value SECURITY FAILED: anon holds % on a '
        'confidential licensor table.', p using errcode = 'P0001';
    end if;
  end loop;

  -- authenticated must have SELECT and must NOT have any write bit: the read policy is the
  -- gate, and a stray write grant would make that policy the only thing standing in the way.
  foreach p in array array['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] loop
    if has_table_privilege('authenticated', 'plm.pmt_asset_metadata_value', p) then
      raise exception 'pmt_asset_metadata_value SECURITY FAILED: authenticated holds write '
        'privilege %.', p using errcode = 'P0001';
    end if;
  end loop;
  if not has_table_privilege('authenticated', 'plm.pmt_asset_metadata_value', 'SELECT') then
    raise exception 'pmt_asset_metadata_value SECURITY FAILED: authenticated lost SELECT, so '
      'the approved app roles cannot read it at all.' using errcode = 'P0001';
  end if;

  raise notice 'pmt_asset_metadata_value privilege posture verified.';
end;
$$;

-- =====================================================================================
-- SECTION 8. plm.load_pmt_capture_chunk -- replaced whole.
--
-- Changes against the 20260810090000 body, and NOTHING else:
--   1. Every `(r->>'..._source_id')::bigint` becomes a plain `r->>'..._source_id'`. The
--      cast was the database half of the precision bug; the loader's JavaScript half is
--      fixed in tools/sync-paramount-creative-library.mjs. Both halves must go or the
--      column type change achieves nothing.
--   2. 'pmt_asset_metadata_value' joins the FIXED allow list, with its own explicit INSERT
--      branch. Still no dynamic SQL anywhere: the table name is a literal in the branch.
--
-- Everything else is preserved verbatim: allow-list-before-empty-chunk ordering, the
-- 5000-row bound, the capture-status check, the privilege check, the loud unreachable-else
-- backstop, SECURITY DEFINER with a pinned search_path.
-- =====================================================================================
create or replace function plm.load_pmt_capture_chunk(
  p_capture_id uuid,
  p_target     text,
  p_rows       jsonb
)
returns integer
language plpgsql
security definer
set search_path = plm, core, public, extensions
as $$
declare
  v_role   text := auth.role();
  v_status text;
  v_n      integer;
  v_count  integer;
  c_targets constant text[] := array[
    'pmt_capture_batch','pmt_authorized_title','pmt_property','pmt_franchise',
    'pmt_character','pmt_collection','pmt_brand','pmt_asset',
    'pmt_authorized_title_property','pmt_asset_property','pmt_asset_franchise',
    'pmt_asset_character','pmt_asset_collection','pmt_asset_brand',
    'pmt_property_character','pmt_property_collection','pmt_property_franchise_evidence',
    'pmt_authorized_property_asset','pmt_property_capture_log','pmt_relationship_anomaly',
    'pmt_asset_metadata_value'
  ];
begin
  if not plm.pmt_loader_privilege_ok(v_role, session_user) then
    raise exception 'Paramount import refused: JWT role % / session_user % may not load capture '
      'chunks.', coalesce(v_role, '<null>'), coalesce(session_user, '<null>')
      using errcode = 'P0001';
  end if;

  if p_target is null or not (p_target = any (c_targets)) then
    raise exception 'Paramount import refused: % is not a loadable target. The target list is '
      'a fixed allow list; core.* and every table outside plm.pmt_* is unreachable from here '
      'by construction, not by convention. This is checked BEFORE the empty-chunk shortcut, '
      'so a typo cannot pass as a successful load of nothing.',
      coalesce(p_target, '<null>') using errcode = 'P0001';
  end if;

  select status into v_status from plm.pmt_capture where capture_id = p_capture_id;
  if v_status is null then
    raise exception 'Paramount import refused: capture % does not exist.', p_capture_id
      using errcode = 'P0001';
  end if;
  if v_status <> 'loading' then
    raise exception 'Paramount import refused: capture % is %, not loading. A capture that has '
      'left the loading state may not receive more rows.', p_capture_id, v_status
      using errcode = 'P0001';
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Paramount import refused: rows must be a jsonb array, got %.',
      coalesce(jsonb_typeof(p_rows), 'null') using errcode = 'P0001';
  end if;

  v_n := jsonb_array_length(p_rows);
  if v_n = 0 then
    return 0;
  end if;
  if v_n > 5000 then
    raise exception 'Paramount import refused: chunk of % rows exceeds the 5000-row bound. '
      'Stream bounded chunks.', v_n using errcode = 'P0001';
  end if;

  if p_target = 'pmt_capture_batch' then
    insert into plm.pmt_capture_batch (
      capture_id, batch_number, expected_asset_count, returned_asset_count,
      first_asset_id, last_asset_id, http_status, content_was_json,
      requested_ids_sha256, returned_ids_sha256, id_sets_matched, complete,
      failure_message, captured_at, source_hash)
    select p_capture_id,
      (r->>'batch_number')::integer, (r->>'expected_asset_count')::integer,
      (r->>'returned_asset_count')::integer, r->>'first_asset_id', r->>'last_asset_id',
      (r->>'http_status')::integer, (r->>'content_was_json')::boolean,
      r->>'requested_ids_sha256', r->>'returned_ids_sha256',
      (r->>'id_sets_matched')::boolean, (r->>'complete')::boolean,
      r->>'failure_message', (r->>'captured_at')::timestamptz, md5(r::text)
    from jsonb_array_elements(p_rows) r;

  elsif p_target = 'pmt_authorized_title' then
    insert into plm.pmt_authorized_title (
      capture_id, authorized_title_key, authorized_title_name, capture_status,
      resolved_property_count, unique_asset_count, full_metadata_count, notes, source_hash)
    select p_capture_id, r->>'authorized_title_key', r->>'authorized_title_name',
      r->>'capture_status', (r->>'resolved_property_count')::integer,
      (r->>'unique_asset_count')::integer, (r->>'full_metadata_count')::integer,
      r->>'notes', md5(r::text)
    from jsonb_array_elements(p_rows) r;

  elsif p_target = 'pmt_property' then
    insert into plm.pmt_property (
      capture_id, property_source_id, property_name, is_licensed_selection, raw, source_hash)
    select p_capture_id, r->>'property_source_id', r->>'property_name',
      coalesce((r->>'is_licensed_selection')::boolean, false),
      coalesce(r->'raw', '{}'::jsonb), md5(r::text)
    from jsonb_array_elements(p_rows) r;

  elsif p_target = 'pmt_franchise' then
    insert into plm.pmt_franchise (capture_id, franchise_source_id, franchise_name, raw, source_hash)
    select p_capture_id, r->>'franchise_source_id', r->>'franchise_name',
      coalesce(r->'raw', '{}'::jsonb), md5(r::text)
    from jsonb_array_elements(p_rows) r;

  elsif p_target = 'pmt_character' then
    insert into plm.pmt_character (capture_id, character_source_id, character_name, raw, source_hash)
    select p_capture_id, r->>'character_source_id', r->>'character_name',
      coalesce(r->'raw', '{}'::jsonb), md5(r::text)
    from jsonb_array_elements(p_rows) r;

  elsif p_target = 'pmt_collection' then
    insert into plm.pmt_collection (
      capture_id, collection_source_id, collection_name, paramount_term, raw, source_hash)
    select p_capture_id, r->>'collection_source_id', r->>'collection_name',
      coalesce(r->>'paramount_term', 'Collection'), coalesce(r->'raw', '{}'::jsonb), md5(r::text)
    from jsonb_array_elements(p_rows) r;

  elsif p_target = 'pmt_brand' then
    insert into plm.pmt_brand (capture_id, brand_source_id, brand_name, raw, source_hash)
    select p_capture_id, r->>'brand_source_id', r->>'brand_name',
      coalesce(r->'raw', '{}'::jsonb), md5(r::text)
    from jsonb_array_elements(p_rows) r;

  elsif p_target = 'pmt_asset' then
    insert into plm.pmt_asset (
      capture_id, asset_id, asset_name, date_imported, date_last_updated,
      content_size_bytes, content_type, mime_type, asset_version, raw, source_hash)
    select p_capture_id, r->>'asset_id', r->>'asset_name',
      nullif(r->>'date_imported','')::timestamptz, nullif(r->>'date_last_updated','')::timestamptz,
      (r->>'content_size_bytes')::bigint, r->>'content_type', r->>'mime_type',
      (r->>'asset_version')::integer, coalesce(r->'raw', '{}'::jsonb), md5(r::text)
    from jsonb_array_elements(p_rows) r;

  elsif p_target = 'pmt_authorized_title_property' then
    insert into plm.pmt_authorized_title_property (
      capture_id, authorized_title_key, property_source_id, paramount_property_name,
      reported_asset_count, mapping_status, notes, source_hash)
    select p_capture_id, r->>'authorized_title_key', r->>'property_source_id',
      r->>'paramount_property_name', coalesce((r->>'reported_asset_count')::integer, 0),
      coalesce(r->>'mapping_status','mapped'), r->>'notes', md5(r::text)
    from jsonb_array_elements(p_rows) r;

  elsif p_target = 'pmt_asset_property' then
    insert into plm.pmt_asset_property (capture_id, asset_id, property_source_id, source_hash)
    select p_capture_id, r->>'asset_id', r->>'property_source_id', md5(r::text)
    from jsonb_array_elements(p_rows) r;

  elsif p_target = 'pmt_asset_franchise' then
    insert into plm.pmt_asset_franchise (capture_id, asset_id, franchise_source_id, source_hash)
    select p_capture_id, r->>'asset_id', r->>'franchise_source_id', md5(r::text)
    from jsonb_array_elements(p_rows) r;

  elsif p_target = 'pmt_asset_character' then
    insert into plm.pmt_asset_character (capture_id, asset_id, character_source_id, source_hash)
    select p_capture_id, r->>'asset_id', r->>'character_source_id', md5(r::text)
    from jsonb_array_elements(p_rows) r;

  elsif p_target = 'pmt_asset_collection' then
    insert into plm.pmt_asset_collection (capture_id, asset_id, collection_source_id, source_hash)
    select p_capture_id, r->>'asset_id', r->>'collection_source_id', md5(r::text)
    from jsonb_array_elements(p_rows) r;

  elsif p_target = 'pmt_asset_brand' then
    insert into plm.pmt_asset_brand (capture_id, asset_id, brand_source_id, source_hash)
    select p_capture_id, r->>'asset_id', r->>'brand_source_id', md5(r::text)
    from jsonb_array_elements(p_rows) r;

  elsif p_target = 'pmt_property_character' then
    insert into plm.pmt_property_character (
      capture_id, property_source_id, character_source_id, evidence_asset_count, source_hash)
    select p_capture_id, r->>'property_source_id', r->>'character_source_id',
      coalesce((r->>'evidence_asset_count')::integer, 0), md5(r::text)
    from jsonb_array_elements(p_rows) r;

  elsif p_target = 'pmt_property_collection' then
    insert into plm.pmt_property_collection (
      capture_id, property_source_id, collection_source_id, evidence_asset_count, source_hash)
    select p_capture_id, r->>'property_source_id', r->>'collection_source_id',
      coalesce((r->>'evidence_asset_count')::integer, 0), md5(r::text)
    from jsonb_array_elements(p_rows) r;

  elsif p_target = 'pmt_property_franchise_evidence' then
    -- evidence_kind and is_direct_source_relationship are STILL NOT accepted from the
    -- caller. They stay pinned by CHECK on the base table. Co-occurrence never becomes a
    -- direct relationship through this loader.
    insert into plm.pmt_property_franchise_evidence (
      capture_id, property_source_id, franchise_source_id, evidence_asset_count, source_hash)
    select p_capture_id, r->>'property_source_id', r->>'franchise_source_id',
      coalesce((r->>'evidence_asset_count')::integer, 0), md5(r::text)
    from jsonb_array_elements(p_rows) r;

  elsif p_target = 'pmt_authorized_property_asset' then
    insert into plm.pmt_authorized_property_asset (
      capture_id, licensed_property_source_id, asset_id, source_hash)
    select p_capture_id, r->>'licensed_property_source_id', r->>'asset_id', md5(r::text)
    from jsonb_array_elements(p_rows) r;

  elsif p_target = 'pmt_property_capture_log' then
    insert into plm.pmt_property_capture_log (
      capture_id, property_source_id, property_name, reported_asset_count,
      captured_asset_count, page_count, complete, failure_message, source_hash)
    select p_capture_id, r->>'property_source_id', r->>'property_name',
      (r->>'reported_asset_count')::integer, (r->>'captured_asset_count')::integer,
      (r->>'page_count')::integer, (r->>'complete')::boolean, r->>'failure_message', md5(r::text)
    from jsonb_array_elements(p_rows) r;

  elsif p_target = 'pmt_relationship_anomaly' then
    insert into plm.pmt_relationship_anomaly (
      capture_id, asset_id, relationship_field, raw_value, action, details, source_hash)
    select p_capture_id, r->>'asset_id', r->>'relationship_field', r->>'raw_value',
      r->>'action', r->>'details', md5(r::text)
    from jsonb_array_elements(p_rows) r;

  elsif p_target = 'pmt_asset_metadata_value' then
    -- NOTE `r->'raw_value'` (arrow, keeps jsonb) not `r->>'raw_value'` (double arrow,
    -- stringifies). The double arrow here would store the TEXT "{...}" inside a jsonb
    -- column as a JSON string and quietly defeat the shape CHECK.
    -- value_ordinal is taken from the payload, never from row order: jsonb_array_elements
    -- ordering is an implementation detail and must not become the source's meaning.
    insert into plm.pmt_asset_metadata_value (
      capture_id, asset_id, metadata_element_id, metadata_element_name,
      metadata_category_id, metadata_category_name, domain_id,
      source_table_name, source_column_name, data_type,
      value_ordinal, source_value, display_value, language, source_path,
      raw_value, source_hash)
    select p_capture_id,
      r->>'asset_id', r->>'metadata_element_id', r->>'metadata_element_name',
      r->>'metadata_category_id', r->>'metadata_category_name', r->>'domain_id',
      r->>'source_table_name', r->>'source_column_name', r->>'data_type',
      (r->>'value_ordinal')::integer, r->>'source_value', r->>'display_value',
      r->>'language', r->>'source_path',
      r->'raw_value', md5(r::text)
    from jsonb_array_elements(p_rows) r;

  else
    raise exception 'Paramount import refused: target % passed the allow list but has no '
      'INSERT branch. A name was added to c_targets without its loader.', p_target
      using errcode = 'P0001';
  end if;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function plm.load_pmt_capture_chunk(uuid, text, jsonb) is
'The ONLY row-loading entry point for a Paramount capture. Validates the target against a '
'FIXED ALLOW LIST *before* the empty-chunk shortcut, so a misspelled target is refused even '
'with zero rows behind it. Bounded to 5000 rows per call and refuses any capture not in '
'status loading. There is no dynamic table name, so no caller can reach core.* or any other '
'schema through it. Relationship rows are rejected by the capture-scoped composite foreign '
'keys when an endpoint is missing from the same capture. As of 20260811030000 it inserts '
'Paramount source IDs as EXACT TEXT -- every ::bigint cast is gone, because casting an '
'identifier to a number is how a leading zero or a >2^53 value gets destroyed without an '
'error -- and it loads plm.pmt_asset_metadata_value, the lossless repeated-metadata store.';

revoke all on function plm.load_pmt_capture_chunk(uuid, text, jsonb) from public;
revoke all on function plm.load_pmt_capture_chunk(uuid, text, jsonb) from anon, authenticated;
grant execute on function plm.load_pmt_capture_chunk(uuid, text, jsonb) to service_role;

-- =====================================================================================
-- SECTION 9. plm.validate_pmt_capture -- STRICTLY ADDITIVE. Checks 1-13 are byte-identical
-- to 20260810020000; three new checks and one new population are appended.
--
-- READ THIS BEFORE EDITING. `create or replace function` REPLACES THE WHOLE BODY. There is
-- no "add a check" syntax: any check omitted from this file is DELETED from the database,
-- silently, with no error and no diff for a reviewer to notice. An earlier draft of this
-- very migration rewrote the function from scratch and thereby dropped twelve of the
-- thirteen existing checks -- assets-covered-by-batches, batch completeness, batch ID-set
-- equality, per-property capture completeness, rights-list title coverage, the
-- co-occurrence-never-direct assertion, the anomalies-preserved assertion, unresolved
-- failures, duplicate asset IDs, and the capture-exists guard -- while ALSO renaming six
-- manifest populations (property_character_explicit, property_style_guide_explicit,
-- property_franchise_asset_cooccurrence, authorized_property_context,
-- malformed_explicit_pairs, captured_properties). Those names are emitted by
-- manifestExpectations() in tools/sync-paramount-creative-library.mjs, so the renames would
-- have left six declared expectations joining to nothing, reporting actual 0, and failing
-- every finalization forever. The function below is therefore built FROM the 20260810020000
-- text, not rewritten to resemble it.
--
-- WHAT IS GENUINELY NEW:
--   * the 'asset_metadata_values' population in the actuals CTE, reconciled against the
--     manifest, NOT a hard-coded CHECK -- spec section 8.6 is explicit that this scrape's
--     counts belong in pmt_capture_expectation where the next capture may legitimately
--     differ, and never frozen into a constraint.
--   * check 14: that expectation must be DECLARED, so an empty metadata load cannot pass
--     check 1 vacuously.
--   * check 15: every metadata row belongs to an asset in the SAME capture.
--   * check 16: every metadata row carries a source hash.
--
-- "No incomplete batch blocks finalization" (spec section 8.6) is NOT re-added here: check 4
-- already asserts it for every batch. A second copy would report the same failure twice.
-- =====================================================================================
create or replace function plm.validate_pmt_capture(p_capture_id uuid)
returns table (check_name text, expected bigint, actual bigint, ok boolean, detail text)
language plpgsql
-- SECURITY INVOKER, deliberately, unlike the import functions. This reporter is granted to
-- authenticated so an operator can read the check results, and a DEFINER function bypasses
-- RLS entirely -- which would let ANY signed-in user, including one with no app role at all,
-- read Paramount population counts through it. As invoker it is bounded by the same read
-- policy as the base tables. finalize calls it from inside a DEFINER context and is
-- unaffected.
security invoker
set search_path = plm, core, public, extensions
as $$
declare
  c plm.pmt_capture%rowtype;
begin
  select * into c from plm.pmt_capture where capture_id = p_capture_id;
  if c.capture_id is null then
    raise exception 'Paramount validation refused: capture % does not exist.', p_capture_id
      using errcode = 'P0001';
  end if;

  -- 1. Manifest expected vs actual, for every declared population.
  return query
  with actuals(population, actual) as (
    select 'licensed_business_titles', count(*)::bigint from plm.pmt_authorized_title where capture_id = p_capture_id
    union all select 'licensed_property_selections', count(*)::bigint from plm.pmt_property where capture_id = p_capture_id and is_licensed_selection
    union all select 'property_result_rows', count(*)::bigint from plm.pmt_authorized_property_asset where capture_id = p_capture_id
    union all select 'unique_authorized_assets', count(*)::bigint from plm.pmt_asset where capture_id = p_capture_id
    union all select 'metadata_batches', count(*)::bigint from plm.pmt_capture_batch where capture_id = p_capture_id
    union all select 'properties', count(*)::bigint from plm.pmt_property where capture_id = p_capture_id
    union all select 'franchises', count(*)::bigint from plm.pmt_franchise where capture_id = p_capture_id
    union all select 'characters', count(*)::bigint from plm.pmt_character where capture_id = p_capture_id
    union all select 'style_guides', count(*)::bigint from plm.pmt_collection where capture_id = p_capture_id
    union all select 'brands', count(*)::bigint from plm.pmt_brand where capture_id = p_capture_id
    union all select 'asset_property', count(*)::bigint from plm.pmt_asset_property where capture_id = p_capture_id
    union all select 'asset_franchise', count(*)::bigint from plm.pmt_asset_franchise where capture_id = p_capture_id
    union all select 'asset_character', count(*)::bigint from plm.pmt_asset_character where capture_id = p_capture_id
    union all select 'asset_style_guide', count(*)::bigint from plm.pmt_asset_collection where capture_id = p_capture_id
    union all select 'asset_brand', count(*)::bigint from plm.pmt_asset_brand where capture_id = p_capture_id
    union all select 'property_character_explicit', count(*)::bigint from plm.pmt_property_character where capture_id = p_capture_id
    union all select 'property_style_guide_explicit', count(*)::bigint from plm.pmt_property_collection where capture_id = p_capture_id
    union all select 'property_franchise_asset_cooccurrence', count(*)::bigint from plm.pmt_property_franchise_evidence where capture_id = p_capture_id
    union all select 'authorized_property_context', count(*)::bigint from plm.pmt_authorized_property_asset where capture_id = p_capture_id
    union all select 'malformed_explicit_pairs', count(*)::bigint from plm.pmt_relationship_anomaly where capture_id = p_capture_id
    union all select 'captured_properties', count(*)::bigint from plm.pmt_property_capture_log where capture_id = p_capture_id
    -- NEW in 20260811030000: the lossless repeated-metadata population, reconciled against
    -- the manifest exactly like every other one. Deliberately NOT a hard-coded CHECK --
    -- the next capture is allowed to be a different size (spec section 8.6).
    union all select 'asset_metadata_values', count(*)::bigint from plm.pmt_asset_metadata_value where capture_id = p_capture_id
  )
  select 'manifest:' || e.population, e.expected_count, coalesce(a.actual, 0),
         coalesce(a.actual, 0) = e.expected_count,
         case when a.population is null then 'no actual measured for this declared population'
              else null end
  from plm.pmt_capture_expectation e
  left join actuals a on a.population = e.population
  where e.capture_id = p_capture_id;

  -- 2. At least one expectation must exist. A capture with no declared expectations would
  --    pass check 1 vacuously, which is exactly how an empty load looks like a good one.
  return query
  select 'manifest:expectations_declared',
         1::bigint,
         (select count(*)::bigint from plm.pmt_capture_expectation where capture_id = p_capture_id),
         (select count(*) from plm.pmt_capture_expectation where capture_id = p_capture_id) > 0,
         'a capture with zero declared expectations would pass every count check vacuously';

  -- 3. Every asset has full metadata. In this schema "has full metadata" means the asset
  --    row itself exists AND appears in a complete batch's returned set; the batch table is
  --    the record of that. So: every asset must be inside the batch coverage.
  return query
  select 'assets_covered_by_batches',
         (select count(*)::bigint from plm.pmt_asset where capture_id = p_capture_id),
         (select coalesce(sum(returned_asset_count), 0)::bigint
            from plm.pmt_capture_batch where capture_id = p_capture_id and complete),
         (select count(*) from plm.pmt_asset where capture_id = p_capture_id)
           = (select coalesce(sum(returned_asset_count), 0)
                from plm.pmt_capture_batch where capture_id = p_capture_id and complete),
         'every asset must be described by a complete full-metadata batch';

  -- 4. No incomplete batches.
  return query
  select 'batches_all_complete', 0::bigint,
         (select count(*)::bigint from plm.pmt_capture_batch where capture_id = p_capture_id and not complete),
         not exists (select 1 from plm.pmt_capture_batch where capture_id = p_capture_id and not complete),
         'an incomplete batch means some asset was requested and never described';

  -- 5. Every batch passed exact ID-set validation.
  return query
  select 'batches_id_sets_matched', 0::bigint,
         (select count(*)::bigint from plm.pmt_capture_batch
           where capture_id = p_capture_id and not id_sets_matched),
         not exists (select 1 from plm.pmt_capture_batch
                      where capture_id = p_capture_id and not id_sets_matched),
         'equal counts are not proof; the requested and returned ID sets must be identical';

  -- 6. Every exact Property capture is complete.
  return query
  select 'property_captures_complete', 0::bigint,
         (select count(*)::bigint from plm.pmt_property_capture_log
           where capture_id = p_capture_id and not complete),
         not exists (select 1 from plm.pmt_property_capture_log
                      where capture_id = p_capture_id and not complete),
         'a partly-scraped Property looks identical to a Property with fewer assets';

  -- 7. All rights-list titles are represented, including the portal-unavailable ones.
  return query
  select 'rights_list_titles_present', c.licensed_title_count::bigint,
         (select count(*)::bigint from plm.pmt_authorized_title where capture_id = p_capture_id),
         (select count(*) from plm.pmt_authorized_title where capture_id = p_capture_id)
           = c.licensed_title_count,
         'every rights-list title must be a row, including titles absent from the portal view';

  -- 8. Captured titles: unique assets equal full-metadata assets. (Also a CHECK; asserted
  --    here too so the report names it rather than the load failing with a constraint code.)
  return query
  select 'captured_title_counts_agree', 0::bigint,
         (select count(*)::bigint from plm.pmt_authorized_title
           where capture_id = p_capture_id and capture_status = 'captured'
             and unique_asset_count <> full_metadata_count),
         not exists (select 1 from plm.pmt_authorized_title
                      where capture_id = p_capture_id and capture_status = 'captured'
                        and unique_asset_count <> full_metadata_count),
         null;

  -- 9. Search-result rows may EXCEED unique assets (overlapping Property scopes) but may
  --    never be fewer: fewer means the authorized scope was not fully collected.
  return query
  select 'search_rows_at_least_unique_assets',
         (select count(*)::bigint from plm.pmt_asset where capture_id = p_capture_id),
         (select count(*)::bigint from plm.pmt_authorized_property_asset where capture_id = p_capture_id),
         (select count(*) from plm.pmt_authorized_property_asset where capture_id = p_capture_id)
           >= (select count(*) from plm.pmt_asset where capture_id = p_capture_id),
         'overlap makes MORE search rows than assets legitimate; FEWER is a truncated scope';

  -- 10. No co-occurrence row claims to be direct. (CHECK-enforced; named here explicitly.)
  return query
  select 'cooccurrence_never_direct', 0::bigint,
         (select count(*)::bigint from plm.pmt_property_franchise_evidence
           where capture_id = p_capture_id
             and (is_direct_source_relationship or evidence_kind <> 'asset_cooccurrence_not_direct_pair')),
         not exists (select 1 from plm.pmt_property_franchise_evidence
                      where capture_id = p_capture_id
                        and (is_direct_source_relationship
                             or evidence_kind <> 'asset_cooccurrence_not_direct_pair')),
         null;

  -- 11. Malformed values stayed anomalies -- none of them was quietly turned into a link.
  return query
  select 'anomalies_preserved',
         (select expected_count from plm.pmt_capture_expectation
           where capture_id = p_capture_id and population = 'malformed_explicit_pairs'),
         (select count(*)::bigint from plm.pmt_relationship_anomaly where capture_id = p_capture_id),
         coalesce(
           (select count(*) from plm.pmt_relationship_anomaly where capture_id = p_capture_id)
             = (select expected_count from plm.pmt_capture_expectation
                 where capture_id = p_capture_id and population = 'malformed_explicit_pairs'),
           false),
         'a malformed value that vanished was probably repaired into a link table';

  -- 12. Unresolved failures.
  return query
  select 'no_unresolved_failures', 0::bigint, c.failure_count::bigint, c.failure_count = 0, null;

  -- 13. Duplicate asset IDs within the capture. The primary key already forbids this; the
  --     check is here so the validation REPORT covers it rather than relying on silence.
  return query
  select 'no_duplicate_asset_ids', 0::bigint,
         (select count(*)::bigint from (
            select asset_id from plm.pmt_asset where capture_id = p_capture_id
            group by asset_id having count(*) > 1) d),
         not exists (select 1 from (
            select asset_id from plm.pmt_asset where capture_id = p_capture_id
            group by asset_id having count(*) > 1) d),
         null;

  -- NOTE ON ORPHAN LINKS. There is deliberately no "orphan endpoint" count here. Every
  -- relationship table carries a capture-scoped composite FOREIGN KEY, so an orphan link
  -- cannot be inserted in the first place -- it fails at load time, loudly, instead of
  -- being counted at finalize time. Checking for something the database cannot contain
  -- would be theatre; the contract test proves the FK rejects it instead.

  -- ===================================================================================
  -- 14-16. NEW in 20260811030000 -- the metadata-value population.
  -- ===================================================================================

  -- 14. The metadata population must be DECLARED. Without this, a capture that loaded no
  --     metadata at all and declared no expectation for it would sail through check 1
  --     vacuously -- the same vacuous-pass hole check 2 exists to close, one level down.
  return query
  select 'metadata_expectation_declared',
         1::bigint,
         (select count(*)::bigint from plm.pmt_capture_expectation
           where capture_id = p_capture_id and population = 'asset_metadata_values'),
         (select count(*) from plm.pmt_capture_expectation
           where capture_id = p_capture_id and population = 'asset_metadata_values') > 0,
         'a capture with no declared asset_metadata_values expectation cannot be shown lossless';

  -- 15. Every metadata row belongs to an asset in the SAME capture. The capture-scoped
  --     composite FK makes this impossible to insert, so this can only ever report 0 --
  --     which is precisely why it is asserted: if the FK is ever dropped, finalization
  --     stops here instead of silently admitting orphans from that moment on.
  return query
  select 'metadata_rows_belong_to_capture_assets', 0::bigint,
         (select count(*)::bigint from plm.pmt_asset_metadata_value m
           where m.capture_id = p_capture_id
             and not exists (select 1 from plm.pmt_asset a
                              where a.capture_id = m.capture_id and a.asset_id = m.asset_id)),
         not exists (select 1 from plm.pmt_asset_metadata_value m
                      where m.capture_id = p_capture_id
                        and not exists (select 1 from plm.pmt_asset a
                                         where a.capture_id = m.capture_id and a.asset_id = m.asset_id)),
         'a metadata value whose asset is not in this capture is a cross-capture leak';

  -- 16. source_hash is the row's provenance. A blank one means the loader wrote a row it
  --     could not account for, which makes the count above unprovable.
  return query
  select 'metadata_source_hashes_present', 0::bigint,
         (select count(*)::bigint from plm.pmt_asset_metadata_value m
           where m.capture_id = p_capture_id and btrim(coalesce(m.source_hash, '')) = ''),
         not exists (select 1 from plm.pmt_asset_metadata_value m
                      where m.capture_id = p_capture_id and btrim(coalesce(m.source_hash, '')) = ''),
         'every metadata value must carry a source hash';

end;
$$;

comment on function plm.validate_pmt_capture(uuid) is
'Reconciles a capture against its manifest expectations and asserts the structural rules '
'finalization depends on. Counts come from plm.pmt_capture_expectation, never from a '
'hard-coded constant, so the NEXT capture is allowed to be a different size. As of '
'20260811030000 it ALSO reconciles the asset_metadata_values population and asserts that the '
'metadata expectation was declared, that every metadata row belongs to an asset in its own '
'capture, and that every metadata row carries a source hash. Checks 1-13 are unchanged from '
'20260810020000 -- this function is replaced WHOLE by every migration that touches it, so a '
'check missing from the newest migration is a check DELETED from the database.';

revoke all on function plm.validate_pmt_capture(uuid) from public;
revoke all on function plm.validate_pmt_capture(uuid) from anon;
grant execute on function plm.validate_pmt_capture(uuid) to service_role, authenticated;

-- =====================================================================================
-- SECTION 10. Recreate the five API views.
--
-- Column lists, ordering, comments, security_invoker and the join through
-- api.pmt_latest_capture are UNCHANGED. The only difference is that the source-ID columns
-- they expose are now text. Every consumer contract is otherwise identical, which is what
-- the verification gate in spec section 8.7 requires.
--
-- api.pmt_properties in particular keeps franchise_names_cooccurrence_evidence_only AND the
-- constant false flag beside it. That naming is load-bearing, not decoration.
-- =====================================================================================
create view api.pmt_assets
with (security_invoker = true) as
select
  a.capture_id, a.asset_id, a.asset_name,
  a.date_imported, a.date_last_updated,
  a.content_size_bytes, a.content_type, a.mime_type, a.asset_version,
  coalesce((select array_agg(p.property_name order by p.property_name)
              from plm.pmt_asset_property ap
              join plm.pmt_property p
                on p.capture_id = ap.capture_id and p.property_source_id = ap.property_source_id
             where ap.capture_id = a.capture_id and ap.asset_id = a.asset_id),
           array[]::text[]) as property_names,
  coalesce((select array_agg(f.franchise_name order by f.franchise_name)
              from plm.pmt_asset_franchise af
              join plm.pmt_franchise f
                on f.capture_id = af.capture_id and f.franchise_source_id = af.franchise_source_id
             where af.capture_id = a.capture_id and af.asset_id = a.asset_id),
           array[]::text[]) as franchise_names,
  coalesce((select array_agg(ch.character_name order by ch.character_name)
              from plm.pmt_asset_character ac
              join plm.pmt_character ch
                on ch.capture_id = ac.capture_id and ch.character_source_id = ac.character_source_id
             where ac.capture_id = a.capture_id and ac.asset_id = a.asset_id),
           array[]::text[]) as character_names,
  coalesce((select array_agg(cl.collection_name order by cl.collection_name)
              from plm.pmt_asset_collection acl
              join plm.pmt_collection cl
                on cl.capture_id = acl.capture_id and cl.collection_source_id = acl.collection_source_id
             where acl.capture_id = a.capture_id and acl.asset_id = a.asset_id),
           array[]::text[]) as style_guide_names,
  coalesce((select array_agg(b.brand_name order by b.brand_name)
              from plm.pmt_asset_brand ab
              join plm.pmt_brand b
                on b.capture_id = ab.capture_id and b.brand_source_id = ab.brand_source_id
             where ab.capture_id = a.capture_id and ab.asset_id = a.asset_id),
           array[]::text[]) as brand_names
from plm.pmt_asset a
join api.pmt_latest_capture lc on lc.capture_id = a.capture_id;

comment on view api.pmt_assets is
'Business-friendly asset metadata from the latest complete full capture, ONE ROW PER ASSET. '
'Relationships are ARRAYS, deliberately: joining five relationship tables would produce a '
'Cartesian product and an asset with 3 properties and 4 characters would report 12 rows, '
'inflating every count taken over this view. METADATA ONLY -- no creative bytes, no previews, '
'no download URLs. A ZIP is one asset record.';

create view api.pmt_style_guides
with (security_invoker = true) as
select
  cl.capture_id,
  cl.collection_source_id as style_guide_source_id,
  cl.collection_name      as style_guide_name,
  cl.paramount_term,
  coalesce((select array_agg(p.property_name order by p.property_name)
              from plm.pmt_property_collection pc
              join plm.pmt_property p
                on p.capture_id = pc.capture_id and p.property_source_id = pc.property_source_id
             where pc.capture_id = cl.capture_id
               and pc.collection_source_id = cl.collection_source_id),
           array[]::text[]) as property_names,
  (select count(*) from plm.pmt_asset_collection ac
    where ac.capture_id = cl.capture_id and ac.collection_source_id = cl.collection_source_id)
    as asset_count,
  (select count(distinct ach.character_source_id)
     from plm.pmt_asset_collection ac
     join plm.pmt_asset_character ach
       on ach.capture_id = ac.capture_id and ach.asset_id = ac.asset_id
    where ac.capture_id = cl.capture_id and ac.collection_source_id = cl.collection_source_id)
    as character_count,
  lc.completed_at as captured_at
from plm.pmt_collection cl
join api.pmt_latest_capture lc on lc.capture_id = cl.capture_id;

comment on view api.pmt_style_guides is
'Paramount Collections presented in OUR business vocabulary as style guides. There is no second '
'source table -- this reads plm.pmt_collection directly, so the two vocabularies can never '
'drift apart into two populations. character_count is distinct characters reached THROUGH the '
'style guide''s assets, which is why it is a count and not an array.';

create view api.pmt_properties
with (security_invoker = true) as
select
  p.capture_id, p.property_source_id, p.property_name, p.is_licensed_selection,
  coalesce((select array_agg(distinct t.authorized_title_name)
              from plm.pmt_authorized_title_property atp
              join plm.pmt_authorized_title t
                on t.capture_id = atp.capture_id and t.authorized_title_key = atp.authorized_title_key
             where atp.capture_id = p.capture_id and atp.property_source_id = p.property_source_id),
           array[]::text[]) as business_title_names,
  (select count(*) from plm.pmt_asset_property ap
    where ap.capture_id = p.capture_id and ap.property_source_id = p.property_source_id) as asset_count,
  (select count(*) from plm.pmt_property_character pch
    where pch.capture_id = p.capture_id and pch.property_source_id = p.property_source_id) as character_count,
  (select count(*) from plm.pmt_property_collection pc
    where pc.capture_id = p.capture_id and pc.property_source_id = p.property_source_id) as style_guide_count,
  coalesce((select array_agg(f.franchise_name order by f.franchise_name)
              from plm.pmt_property_franchise_evidence pfe
              join plm.pmt_franchise f
                on f.capture_id = pfe.capture_id and f.franchise_source_id = pfe.franchise_source_id
             where pfe.capture_id = p.capture_id and pfe.property_source_id = p.property_source_id),
           array[]::text[]) as franchise_names_cooccurrence_evidence_only,
  false as franchise_link_is_a_direct_source_relationship,
  p.core_property_id, p.resolution_status, p.resolution_reason, p.resolved_at
from plm.pmt_property p
join api.pmt_latest_capture lc on lc.capture_id = p.capture_id;

comment on view api.pmt_properties is
'Paramount properties from the latest complete full capture. The franchise column is named '
'franchise_names_cooccurrence_evidence_only and is accompanied by a constant false flag ON '
'PURPOSE: Paramount states no property-franchise relationship, these names come from assets '
'that happened to carry both, and a column called franchise_name would be read as authority '
'within a week. core_property_id is a reconciliation pointer, not a canonical assignment.';

create view api.pmt_characters
with (security_invoker = true) as
select
  ch.capture_id, ch.character_source_id, ch.character_name,
  coalesce((select array_agg(p.property_name order by p.property_name)
              from plm.pmt_property_character pch
              join plm.pmt_property p
                on p.capture_id = pch.capture_id and p.property_source_id = pch.property_source_id
             where pch.capture_id = ch.capture_id
               and pch.character_source_id = ch.character_source_id),
           array[]::text[]) as explicit_property_names,
  (select count(*) from plm.pmt_asset_character ac
    where ac.capture_id = ch.capture_id and ac.character_source_id = ch.character_source_id)
    as asset_count,
  coalesce((select array_agg(distinct cl.collection_name)
              from plm.pmt_asset_character ac
              join plm.pmt_asset_collection acl
                on acl.capture_id = ac.capture_id and acl.asset_id = ac.asset_id
              join plm.pmt_collection cl
                on cl.capture_id = acl.capture_id and cl.collection_source_id = acl.collection_source_id
             where ac.capture_id = ch.capture_id
               and ac.character_source_id = ch.character_source_id),
           array[]::text[]) as style_guide_names,
  ch.core_character_id, ch.resolution_status, ch.resolution_reason, ch.resolved_at
from plm.pmt_character ch
join api.pmt_latest_capture lc on lc.capture_id = ch.capture_id;

comment on view api.pmt_characters is
'Paramount characters from the latest complete full capture. explicit_property_names carries '
'ONLY the pairs Paramount states in its cascading field -- never a pair assembled by us. '
'style_guide_names is reached through the character''s assets and is therefore an observation, '
'not a Paramount statement. Characters are identified by SOURCE ID; never merge two by name.';

create view api.pmt_property_franchise_evidence
with (security_invoker = true) as
select
  pfe.capture_id,
  p.property_source_id, p.property_name,
  f.franchise_source_id, f.franchise_name,
  pfe.evidence_kind,
  pfe.evidence_asset_count,
  pfe.is_direct_source_relationship,
  'CO-OCCURRENCE ONLY. Paramount states no property-to-franchise relationship. These two appear together on some assets; that is an observation about assets, NOT an authority about ownership.'::text
    as authority_warning
from plm.pmt_property_franchise_evidence pfe
join plm.pmt_property p
  on p.capture_id = pfe.capture_id and p.property_source_id = pfe.property_source_id
join plm.pmt_franchise f
  on f.capture_id = pfe.capture_id and f.franchise_source_id = pfe.franchise_source_id
join api.pmt_latest_capture lc on lc.capture_id = pfe.capture_id;

comment on view api.pmt_property_franchise_evidence is
'Property-franchise CO-OCCURRENCE evidence. Every row carries evidence_kind, '
'is_direct_source_relationship (always false, CHECK-enforced on the base table) and a plain '
'English authority_warning, so no consumer can read this view and mistake it for a Paramount '
'statement about which franchise a property belongs to.';

-- Restate the api view posture for exactly the five views recreated above. A recreated view
-- is a NEW object with default privileges, so skipping this would silently drop the read
-- grant for the app roles (and, worse, could leave PUBLIC holding something).
--
-- There is deliberately NO api view over plm.pmt_asset_metadata_value. Spec section 8.7:
-- add one only for a real consumer need, and do not expose confidential metadata broadly by
-- default. No consumer has asked. When one does, that view must exclude raw_value.
do $$
declare
  v text;
begin
  foreach v in array array[
    'pmt_assets','pmt_style_guides','pmt_properties','pmt_characters',
    'pmt_property_franchise_evidence'
  ]
  loop
    execute format('revoke all on api.%I from public', v);
    execute format('revoke all on api.%I from anon', v);
    execute format('grant select on api.%I to authenticated, service_role', v);
  end loop;
end;
$$;

-- =====================================================================================
-- SECTION 11. Post-conditions. Prove the migration did what it says.
-- =====================================================================================
do $$
declare
  v_bigint_left integer;
  v_text_ok     integer;
begin
  -- No Paramount ENTITY source ID may still be a numeric type.
  select count(*) into v_bigint_left
  from information_schema.columns
  where table_schema = 'plm'
    and table_name like 'pmt_%'
    and (column_name like '%\_source\_id' escape '\')
    and data_type <> 'text';
  if v_bigint_left <> 0 then
    raise exception 'FAILED: % Paramount source-ID column(s) are still not text.', v_bigint_left
      using errcode = 'P0001';
  end if;

  select count(*) into v_text_ok
  from information_schema.columns
  where table_schema = 'plm' and table_name like 'pmt_%'
    and column_name like '%\_source\_id' escape '\' and data_type = 'text';
  if v_text_ok < 19 then
    raise exception 'FAILED: expected at least 19 text source-ID columns, found %.', v_text_ok
      using errcode = 'P0001';
  end if;

  if to_regclass('plm.pmt_asset_metadata_value') is null then
    raise exception 'FAILED: plm.pmt_asset_metadata_value was not created.' using errcode = 'P0001';
  end if;

  -- The five recreated views must exist again. A migration that drops a view and fails to
  -- rebuild it is the single most damaging outcome here, so it is asserted, not assumed.
  if (select count(*) from information_schema.views
       where table_schema = 'api'
         and table_name in ('pmt_assets','pmt_style_guides','pmt_properties',
                            'pmt_characters','pmt_property_franchise_evidence')) <> 5 then
    raise exception 'FAILED: not all five api.pmt_* views were recreated.' using errcode = 'P0001';
  end if;

  raise notice '20260811030000 OK: % source-ID columns are text, metadata table live, 5 views rebuilt.', v_text_ok;
end;
$$;
