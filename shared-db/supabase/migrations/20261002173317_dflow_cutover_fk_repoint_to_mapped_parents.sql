-- =====================================================================================
-- Issue #3882 child 2 - repoint 14 dflow foreign keys to the parents the DesignFlow
-- Cloud SQL cutover actually loads.
--
-- Claim: #3884. Reserved version 20261002173317.
--
-- WHY: the cutover maps dflow.art_piece, dflow.properties_and_characters,
-- property_character_associations and item_character_associations to dflow, but
-- loads their parents into core."merchGroup", core."licenseList", plm."divisionCode",
-- plm."SeasonCode" and plm."itemHeader". The dflow copies' FKs still point at stale
-- dflow parents. Design: #3882 comment 5955949106.
--
-- STRUCTURE ONLY. Each FK is dropped and re-added under the same name, same column,
-- same ON UPDATE/ON DELETE actions; only the referenced table changes. Live check
-- 2026-10-02 on production: zero existing child rows orphan against the new parents,
-- so validation is expected to pass. Each FK is added NOT VALID and then
-- validated in this same file (VALIDATE takes a weaker lock than a validating ADD);
-- an orphan written before apply makes VALIDATE fail and the whole file roll back.
--
-- Actions are kept exactly as today, including ON DELETE CASCADE on
-- item_character_associations: deleting a plm."itemHeader" row now removes its
-- dflow character links, exactly as deleting a dflow."itemHeader" row did before.
-- dflow."licenseList" ON DELETE RESTRICT likewise now protects core."licenseList".
--
-- A precondition block refuses to run if any of the 14 FKs is not exactly the
-- expected current definition (column, old parent, parent column, actions, not
-- deferrable).
--
-- Index coverage is unchanged: the same child columns keep the same indexes
-- (production read 2026-10-02: item_header_id, both licensor_id columns, artist_id and
-- divisioncode_id indexed; the other nine dflow.art_piece columns unindexed, as
-- today, on a ~480 kB table). Every new parent column is that parent's primary key.
--
-- Not here: plm.art_piece_attachment and app."RolePermissions" (frozen-schema
-- repoints) belong to open PR #3391 (#2110), which performs those exact swaps.
-- =====================================================================================

-- derived-from: none

do $pre$
declare r record;
begin
  for r in select * from (values
    ('dflow.art_piece', 'art_piece_licensor_id_fkey', 'licensor_id', 'dflow."merchGroup"', 'core."merchGroup"', 'mg_id', 'a', 'a'),
    ('dflow.art_piece', 'art_piece_property_id_fkey', 'property_id', 'dflow."merchGroup"', 'core."merchGroup"', 'mg_id', 'a', 'a'),
    ('dflow.art_piece', 'art_piece_style_guide_id_fkey', 'style_guide_id', 'dflow."merchGroup"', 'core."merchGroup"', 'mg_id', 'a', 'a'),
    ('dflow.art_piece', 'art_piece_big_theme_id_fkey', 'big_theme_id', 'dflow."merchGroup"', 'core."merchGroup"', 'mg_id', 'a', 'a'),
    ('dflow.art_piece', 'art_piece_little_theme_id_fkey', 'little_theme_id', 'dflow."merchGroup"', 'core."merchGroup"', 'mg_id', 'a', 'a'),
    ('dflow.art_piece', 'art_piece_art_type_id_fkey', 'art_type_id', 'dflow."merchGroup"', 'core."merchGroup"', 'mg_id', 'a', 'a'),
    ('dflow.art_piece', 'art_piece_art_source_id_fkey', 'art_source_id', 'dflow."merchGroup"', 'core."merchGroup"', 'mg_id', 'a', 'a'),
    ('dflow.art_piece', 'art_piece_artist_id_fkey', 'artist_id', 'dflow."merchGroup"', 'core."merchGroup"', 'mg_id', 'a', 'a'),
    ('dflow.art_piece', 'art_piece_age_group_id_fkey', 'age_group_id', 'dflow."merchGroup"', 'core."merchGroup"', 'mg_id', 'a', 'a'),
    ('dflow.art_piece', 'art_piece_divisioncode_id_fkey', 'divisioncode_id', 'dflow."divisionCode"', 'plm."divisionCode"', 'divCode_id', 'a', 'a'),
    ('dflow.art_piece', 'art_piece_season_code_id_fkey', 'season_code_id', 'dflow."SeasonCode"', 'plm."SeasonCode"', 'id', 'a', 'a'),
    ('dflow.properties_and_characters', 'properties_and_characters_licensor_id_fkey', 'licensor_id', 'dflow."licenseList"', 'core."licenseList"', 'licenseList_id', 'c', 'r'),
    ('dflow.property_character_associations', 'property_character_associations_licensor_id_fkey', 'licensor_id', 'dflow."licenseList"', 'core."licenseList"', 'licenseList_id', 'c', 'r'),
    ('dflow.item_character_associations', 'item_character_associations_item_header_id_fkey', 'item_header_id', 'dflow."itemHeader"', 'plm."itemHeader"', 'item_id_pk', 'c', 'c')
  ) v(t, n, col, oldp, newp, pc, upd, del) loop
    if not exists (
      select 1 from pg_catalog.pg_constraint c
      where c.contype = 'f' and c.conrelid = pg_catalog.to_regclass(r.t) and c.conname = r.n
        and c.confrelid = pg_catalog.to_regclass(r.oldp)
        and c.confupdtype = r.upd and c.confdeltype = r.del and not c.condeferrable
        and array_length(c.conkey, 1) = 1 and array_length(c.confkey, 1) = 1
        and (select attname from pg_catalog.pg_attribute where attrelid = c.conrelid and attnum = c.conkey[1]) = r.col
        and (select attname from pg_catalog.pg_attribute where attrelid = c.confrelid and attnum = c.confkey[1]) = r.pc
    ) then
      raise exception '3882: % on % is not the expected current definition', r.n, r.t;
    end if;
  end loop;
end
$pre$;

alter table dflow.art_piece drop constraint art_piece_licensor_id_fkey;
alter table dflow.art_piece add constraint art_piece_licensor_id_fkey
  foreign key (licensor_id) references core."merchGroup"(mg_id) not valid;
alter table dflow.art_piece drop constraint art_piece_property_id_fkey;
alter table dflow.art_piece add constraint art_piece_property_id_fkey
  foreign key (property_id) references core."merchGroup"(mg_id) not valid;
alter table dflow.art_piece drop constraint art_piece_style_guide_id_fkey;
alter table dflow.art_piece add constraint art_piece_style_guide_id_fkey
  foreign key (style_guide_id) references core."merchGroup"(mg_id) not valid;
alter table dflow.art_piece drop constraint art_piece_big_theme_id_fkey;
alter table dflow.art_piece add constraint art_piece_big_theme_id_fkey
  foreign key (big_theme_id) references core."merchGroup"(mg_id) not valid;
alter table dflow.art_piece drop constraint art_piece_little_theme_id_fkey;
alter table dflow.art_piece add constraint art_piece_little_theme_id_fkey
  foreign key (little_theme_id) references core."merchGroup"(mg_id) not valid;
alter table dflow.art_piece drop constraint art_piece_art_type_id_fkey;
alter table dflow.art_piece add constraint art_piece_art_type_id_fkey
  foreign key (art_type_id) references core."merchGroup"(mg_id) not valid;
alter table dflow.art_piece drop constraint art_piece_art_source_id_fkey;
alter table dflow.art_piece add constraint art_piece_art_source_id_fkey
  foreign key (art_source_id) references core."merchGroup"(mg_id) not valid;
alter table dflow.art_piece drop constraint art_piece_artist_id_fkey;
alter table dflow.art_piece add constraint art_piece_artist_id_fkey
  foreign key (artist_id) references core."merchGroup"(mg_id) not valid;
alter table dflow.art_piece drop constraint art_piece_age_group_id_fkey;
alter table dflow.art_piece add constraint art_piece_age_group_id_fkey
  foreign key (age_group_id) references core."merchGroup"(mg_id) not valid;
alter table dflow.art_piece drop constraint art_piece_divisioncode_id_fkey;
alter table dflow.art_piece add constraint art_piece_divisioncode_id_fkey
  foreign key (divisioncode_id) references plm."divisionCode"("divCode_id") not valid;
alter table dflow.art_piece drop constraint art_piece_season_code_id_fkey;
alter table dflow.art_piece add constraint art_piece_season_code_id_fkey
  foreign key (season_code_id) references plm."SeasonCode"(id) not valid;
alter table dflow.properties_and_characters drop constraint properties_and_characters_licensor_id_fkey;
alter table dflow.properties_and_characters add constraint properties_and_characters_licensor_id_fkey
  foreign key (licensor_id) references core."licenseList"("licenseList_id") on update cascade on delete restrict not valid;
alter table dflow.property_character_associations drop constraint property_character_associations_licensor_id_fkey;
alter table dflow.property_character_associations add constraint property_character_associations_licensor_id_fkey
  foreign key (licensor_id) references core."licenseList"("licenseList_id") on update cascade on delete restrict not valid;
alter table dflow.item_character_associations drop constraint item_character_associations_item_header_id_fkey;
alter table dflow.item_character_associations add constraint item_character_associations_item_header_id_fkey
  foreign key (item_header_id) references plm."itemHeader"(item_id_pk) on update cascade on delete cascade not valid;

alter table dflow.art_piece validate constraint art_piece_licensor_id_fkey;
alter table dflow.art_piece validate constraint art_piece_property_id_fkey;
alter table dflow.art_piece validate constraint art_piece_style_guide_id_fkey;
alter table dflow.art_piece validate constraint art_piece_big_theme_id_fkey;
alter table dflow.art_piece validate constraint art_piece_little_theme_id_fkey;
alter table dflow.art_piece validate constraint art_piece_art_type_id_fkey;
alter table dflow.art_piece validate constraint art_piece_art_source_id_fkey;
alter table dflow.art_piece validate constraint art_piece_artist_id_fkey;
alter table dflow.art_piece validate constraint art_piece_age_group_id_fkey;
alter table dflow.art_piece validate constraint art_piece_divisioncode_id_fkey;
alter table dflow.art_piece validate constraint art_piece_season_code_id_fkey;
alter table dflow.properties_and_characters validate constraint properties_and_characters_licensor_id_fkey;
alter table dflow.property_character_associations validate constraint property_character_associations_licensor_id_fkey;
alter table dflow.item_character_associations validate constraint item_character_associations_item_header_id_fkey;
