-- #3894: owner rule (2026-10-02) — DCP Vault assets tagged for more than one
-- licensor are disregarded. Adds a nullable do-not-use reason to the three
-- studio-separated asset tables (NULL = usable; existing rows stay NULL).
-- The CHECK uses the repository's non-whitespace form (see
-- 20260813200000_nbcu_property_source_kind_nonwhitespace.sql), not btrim.

alter table plm.lucasfilm_dcp_asset
  add column do_not_use_reason text null,
  add constraint lucasfilm_dcp_asset_do_not_use_reason_chk
    check (do_not_use_reason is null or do_not_use_reason ~ '[^[:space:]]');

alter table plm.marvel_dcp_asset
  add column do_not_use_reason text null,
  add constraint marvel_dcp_asset_do_not_use_reason_chk
    check (do_not_use_reason is null or do_not_use_reason ~ '[^[:space:]]');

alter table plm.twentieth_century_dcp_asset
  add column do_not_use_reason text null,
  add constraint twentieth_century_dcp_asset_do_not_use_reason_chk
    check (do_not_use_reason is null or do_not_use_reason ~ '[^[:space:]]');

comment on column plm.lucasfilm_dcp_asset.do_not_use_reason is
'NULL means usable. Non-NULL marks the asset do-not-use and records why (owner rule 2026-10-02: assets tagged for multiple licensors are disregarded). Loaders must preserve it.';
comment on column plm.marvel_dcp_asset.do_not_use_reason is
'NULL means usable. Non-NULL marks the asset do-not-use and records why (owner rule 2026-10-02: assets tagged for multiple licensors are disregarded). Loaders must preserve it.';
comment on column plm.twentieth_century_dcp_asset.do_not_use_reason is
'NULL means usable. Non-NULL marks the asset do-not-use and records why (owner rule 2026-10-02: assets tagged for multiple licensors are disregarded). Loaders must preserve it.';
