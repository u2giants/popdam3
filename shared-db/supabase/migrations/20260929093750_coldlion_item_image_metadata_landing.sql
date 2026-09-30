-- =====================================================================================
-- Issue #2179 - ColdLion landing UNIT 5b remainder: /itemImages METADATA.
--
-- Tracker: #2081. Plan: plan_coldlion_landing_schema_completion.md section 9 Step 6.
-- Author lane claim: #3706. Structure only; this migration loads no rows and
-- creates no loader. Sister unit #2863 (prepack_detail, prod_detail) is already live.
--
-- OWNER DECISION. 2026-09-28, Albert Hazan, in chat: "keep" - INGEST all fourteen
-- /itemImages metadata fields. Recorded field by field in
-- docs/coldlion-field-decisions-20260819.csv (feed itemImages). The two image-content
-- fields, resourceContent and thumbnail128, stay EXCLUDED under the standing
-- no-image-bytes ruling: this table has no column that could hold them.
--
-- EVIDENCE. Read-only live census 2026-09-08, private u2giants/licensor-source-data
-- commit 2e3b9420f50298d9a7ff748a5c7c7b3e56bb47e9,
-- coldlion/verification/issue-2179-remainder-endpoint-census-20260908/. The response
-- is a BARE JSON ARRAY; itemNo is a required request parameter, so the feed is
-- enumerated by harvesting item numbers from coldlion.item_header (loaded first).
-- Loader contract: docs/coldlion-item-images-loader-contract.md and
-- tools/coldlion-landing/lib/item-images-spec.mjs.
--
-- GRAIN PROOF. 75 lookups on items flagged hasImage=Y; 63 returned rows, 75 records.
--   * pkey is a REAL vendor row id: 75 distinct over 75, no missing values.
--   * resourceId is NOT an identity: 63 distinct over 75, 8 duplicate groups, max 3.
--   * (companyCode, divisionCode, itemNo, colorCode) - the documented update selector -
--     is NOT an identity either: 8 groups / 12 extra rows collide.
--   Therefore the primary key is (company_code, pkey). No guessed natural key is
--   asserted and nothing is silently de-duplicated.
--   * hasImage=Y is NOT proof a row exists: 12 of 75 flagged items returned zero rows.
--     A loader records zero-row items as evidence, never as a failure or "no image".
--
-- SOURCE RULES CARRIED FORWARD FROM THE SPINE
--   * companyCode IS in the payload; it leads the key so two tenants cannot collide.
--   * ColdLion sends '' for null. labelCode was blank on 62 of 75 rows; text columns
--     are nullable and NOT check-constrained non-blank.
--   * 1900-01-01 is the empty-date marker; source timestamps are nullable.
--   * divisionCode is recorded exactly as sent; nothing normalises casing.
--   * No EP001 exclusion (an exclusion would fail a load rather than filter it).
--   * No per-row raw archive (D5), no foreign key outside coldlion, no app grants.
-- =====================================================================================

do $$ begin
  if to_regclass('coldlion.sync_run') is null then
    raise exception 'ColdLion phase 1 spine is required before item_image_metadata';
  end if;
end $$;

create table coldlion.item_image_metadata (
  -- Identity. See GRAIN PROOF above. Both come from the payload.
  company_code text   not null,
  pkey         bigint not null,

  resource_id   bigint,
  division_code text,
  item_no       text,
  color_code    text,
  label_code    text,

  file_name       text,
  file_type       text,
  item_image_desc text,

  created_time timestamptz,
  created_user text,
  mod_time     timestamptz,
  mod_user     text,

  run_id      uuid        not null references coldlion.sync_run(id),
  fetched_at  timestamptz not null,
  source_hash text        not null check (source_hash ~ '^[0-9a-f]{64}$'),
  first_seen_at timestamptz not null,
  last_seen_at  timestamptz not null,

  primary key (company_code, pkey),
  check (last_seen_at >= first_seen_at)
);

comment on table coldlion.item_image_metadata is
  'ColdLion GET /itemImages METADATA landing table (issue #2179). One row per vendor image record, keyed by (company_code, pkey): pkey proven unique over 75 rows from 63 non-empty item lookups on 2026-09-08 with ZERO duplicate collapse, while resourceId and (company, division, item, colour) each collided (8 groups). Bare JSON array; itemNo is a required request parameter, so the feed is enumerated by harvesting items from coldlion.item_header. Fourteen metadata fields, all INGESTED by owner decision 2026-09-28. resourceContent and thumbnail128 (image bytes) are EXCLUDED and have no column.';

comment on column coldlion.item_image_metadata.pkey is
  'ColdLion pkey - a REAL vendor row id for the image record, unique on its own across the census. The only proven identity on this feed.';
comment on column coldlion.item_image_metadata.resource_id is
  'ColdLion resourceId. NOT unique: 8 duplicate groups over 75 sampled rows. Descriptive, never a key.';
comment on column coldlion.item_image_metadata.item_no is
  'The item the image belongs to, and the /itemImages request key. With division_code and color_code it forms the vendor update selector, which is NOT a row identity (it collided in the census).';
comment on column coldlion.item_image_metadata.label_code is
  'Blank on 62 of 75 sampled rows; recorded as sent.';
comment on column coldlion.item_image_metadata.file_name is
  'Source file name as sent. Metadata only: no image bytes are stored anywhere in this schema.';
comment on column coldlion.item_image_metadata.division_code is
  'Recorded exactly as sent; nothing here normalises casing.';

-- Composite identity (company_code, pkey) is the PK. The bare (pkey) index
-- serves pkey-without-company lookups used by contract tests and vendor tools;
-- (run_id) serves FK parent maintenance. Further access-path indexes wait for
-- a real loader claim.
create index item_image_metadata_pkey_idx
  on coldlion.item_image_metadata (pkey);
create index item_image_metadata_run_id_idx
  on coldlion.item_image_metadata (run_id);

alter table coldlion.item_image_metadata enable row level security;
revoke all on table coldlion.item_image_metadata from public, anon, authenticated;
grant all on table coldlion.item_image_metadata to service_role;
